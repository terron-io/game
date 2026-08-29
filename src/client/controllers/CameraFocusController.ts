import { EventBus } from "../../core/EventBus";
import { Cell } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { GameView } from "../../core/game/GameView";
import { Controller } from "../Controller";
import { SendSpawnIntentEvent } from "../Transport";
import { GoToPlayerEvent, TransformHandler } from "../TransformHandler";
import { L } from "../Utils";

// terron: наводим камеру на игрока НЕЗАВИСИМО от обучения — (1) когда он заспавнился
// (сам выбрал точку ИЛИ автоспавн), (2) когда стартовал раунд. Зумим поближе.
// Плюс: при АВТОСПАВНЕ (не успел выбрать → игра поставила через ~5с) показываем
// сообщение через HeadsUpMessage (событие show-message) — раньше об этом сообщал
// ТОЛЬКО туториал, при выключенном обучении игрок не понимал, что произошло.
// ВАЖНО: центрируем только когда у игрока уже есть nameLocation — иначе onGoToPlayer
// выходит вхолостую. На тике автоспавна территория ещё не «осела» → ретраим по тикам.
//
// ⚠️ Айфон-кейс 12.07 («мне выбрали точку, а где я — непонятно»): на медленной
// загрузке первый GoToPlayer уходил во время ДОГОНА ходов / в неготовый вьюпорт
// (canvas ещё нулевой, анимация goTo сбита) — и больше НИКОГДА не повторялся.
// Теперь фокус ПОДТВЕРЖДАЕМЫЙ: пока свой nameLocation реально не оказался на
// экране (transform.isOnScreen) — ретраим раз в 2с реального времени, максимум
// 5 попыток / 20 секунд. Если игрок сам смотрит на себя — isOnScreen подтвердит
// и ретраев не будет; сознательный уход камеры в другое место дольше 20с/5
// попыток мы не переигрываем.
const FOCUS_ZOOM = 10;
// Не центрируем повторно, если только что навели (старт раунда и спавн совпали).
const REFOCUS_GUARD_TICKS = 8;
const RETRY_INTERVAL_MS = 2000;
const RETRY_WINDOW_MS = 20_000;
const RETRY_MAX_ATTEMPTS = 5;

export class CameraFocusController implements Controller {
  private spawnFocused = false;
  private spawnedInPhase = false; // выбрал точку В фазу спавна (ручной, не авто)
  private autoNotified = false;
  private lastFocusTick = -999;

  // Подтверждение фокуса (айфон-кейс): игрок реально в кадре?
  private focusConfirmed = false;
  private retryAttempts = 0;
  private lastAttemptMs = 0;
  private firstSpawnMs = 0;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly transform: TransformHandler,
  ) {
    // ⚠️ terron 20.07: «выбор был МОЙ» определяем по факту отправки интента, а
    // не по состоянию фазы. Старая проверка («заспавнился, пока фаза идёт»)
    // врала в ОДИНОЧКЕ: там SpawnExecution в ОДНОМ тике и спавнит игрока, и
    // закрывает фазу (см. SpawnExecution: «In singleplayer, spawn ends when
    // player selects a spawn location»). К следующему тику контроллера фаза уже
    // закрыта → спавн считался автоматическим, и человек, кликнувший сразу,
    // получал «вы не успели» (репорт владельца: «почему не успел? успел»).
    this.eventBus.on(SendSpawnIntentEvent, () => {
      this.spawnedInPhase = true;
    });
  }

  tick(): void {
    const me = this.game.myPlayer();
    if (me === null) return;

    // Сетевые игры: подстраховка на случай, если интент ушёл до создания
    // контроллера — там фаза живёт своим таймером и проверка честна.
    if (me.hasSpawned() && this.game.inSpawnPhase()) {
      this.spawnedInPhase = true;
    }

    // 1) фокус при своём спавне — ручной выбор ИЛИ автоспавн (ждём nameLocation).
    if (!this.spawnFocused && me.hasSpawned() && me.nameLocation()) {
      this.spawnFocused = true;
      this.firstSpawnMs = performance.now();
      this.lastAttemptMs = this.firstSpawnMs;
      this.eventBus.emit(new GoToPlayerEvent(me, FOCUS_ZOOM));
      this.lastFocusTick = this.game.ticks();
      // Автоспавн = точку в фазу спавна так и не выбрал (поставили автоматом).
      if (!this.spawnedInPhase && !this.autoNotified) {
        this.autoNotified = true;
        window.dispatchEvent(
          new CustomEvent("show-message", {
            detail: {
              message: L(
                "Точку спавна выбрали за вас — вы не успели. Камера наведена на неё.",
                "Your spawn was picked for you — you were too slow. Camera centered on it.",
              ),
              color: "green",
              duration: 5000,
            },
          }),
        );
      }
    }

    // 1б) подтверждение фокуса: пока себя НЕ видно — ретраим (см. шапку файла).
    if (this.spawnFocused && !this.focusConfirmed) {
      const nl = me.nameLocation();
      if (nl && this.transform.isOnScreen(new Cell(nl.x, nl.y))) {
        this.focusConfirmed = true;
      } else {
        const now = performance.now();
        const expired =
          now - this.firstSpawnMs > RETRY_WINDOW_MS ||
          this.retryAttempts >= RETRY_MAX_ATTEMPTS;
        if (expired) {
          this.focusConfirmed = true; // сдаёмся — не воюем с игроком
        } else if (nl && now - this.lastAttemptMs > RETRY_INTERVAL_MS) {
          this.retryAttempts++;
          this.lastAttemptMs = now;
          this.eventBus.emit(new GoToPlayerEvent(me, FOCUS_ZOOM));
          this.lastFocusTick = this.game.ticks();
        }
      }
    }

    // 2) старт раунда — центрируем, если уже заспавнен и не навели прямо сейчас
    //    (иначе двойной рывок, когда старт и ручной спавн совпали).
    const updates = this.game.updatesSinceLastTick();
    if (
      updates &&
      (updates[GameUpdateType.SpawnPhaseEnd] ?? []).length > 0 &&
      me.hasSpawned() &&
      me.nameLocation() &&
      this.game.ticks() - this.lastFocusTick > REFOCUS_GUARD_TICKS
    ) {
      this.eventBus.emit(new GoToPlayerEvent(me, FOCUS_ZOOM));
      this.lastFocusTick = this.game.ticks();
    }
  }
}

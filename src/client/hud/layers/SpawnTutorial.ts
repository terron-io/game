import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import {
  TERRON_SPAWN_GRACE_TURNS,
  TERRON_SPAWN_PHASE_PVP_TURNS,
} from "../../../core/configuration/TerronTuning";
import { EventBus } from "../../../core/EventBus";
import { PlayerType, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { ContextMenuEvent } from "../../InputHandler";
import { isTestGroundActive } from "../../TestGround";
import {
  BuildUnitIntentEvent,
  SendAttackIntentEvent,
  SendSpawnIntentEvent,
} from "../../Transport";
import { L, renderNumber, translateText } from "../../Utils";

// иконки зданий/золота для карточек обучения (белые SVG — читаются на тёмной карточке)
const cityIcon = assetUrl("images/CityIconWhite.svg");
// terron: иконка «строительство» (ключ) — СТРОГО та же, что в радиал-меню.
const buildIcon = assetUrl("images/BuildIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");

// Пошаговое обучение со СТРОГОЙ очередью (каждый матч с нуля, localStorage не трогаем):
//
//   spawn   — выбери точку (клик). Не выбрал до старта → restart (совет перезайти).
//   expand  — расширяйся, 5 кликов. Держим минимум ~7с.
//   tribes  — атакуй племена. Триггер: прошло 7..15с И (15с ИЛИ некуда расти:
//             2+ племени у границы / ≥60% суши вокруг занято).
//   build   — когда город реально доступен: подсветка кнопки города В НИЖНЕМ баре,
//             ждём постройку города.
//   final   — молодец, обучение закончено.
//   menu    — (+5с) правая кнопка мыши = полезное меню. Гаснет по правому клику.
const ATTACKS_REQUIRED = 5;
const TRIBES_REQUIRED = 2; // квест: съесть 2 племени
// terron: сколько тиков ждём автоспавн после конца фазы спавна, прежде чем
// признать реальный провал (грейс 5с + автоспавн + буфер). 10 тиков = 1с.
const AUTOSPAWN_WAIT_TICKS = 80;
const CITY_HL_CLASS = "tut-city"; // body-класс → подсветка города в UnitDisplay
const INCOME_HL_CLASS = "tut-income"; // → подсветка фабрики/порта (шаг income)
// terron: «выпуск» из обучения — если игрок раз прожил ≥5 мин (по сути освоился,
// это же порог ачивки выживания), больше НЕ показываем спавн-подсказки. Пишем
// флаг в localStorage «раз и навсегда» (per-browser). Единственное исключение из
// «localStorage не трогаем» — осознанное, см. проверку в tick().
const TUTOR_GRADUATE_MS = 5 * 60 * 1000;
const TUTOR_GRAD_KEY = "terron-tutor-graduated";
function isTutorGraduated(): boolean {
  try {
    return localStorage.getItem(TUTOR_GRAD_KEY) === "1";
  } catch {
    return false;
  }
}

type Step =
  | "none"
  | "spawn"
  | "spawned" // точка выбрана, ждём СТАРТА матча (фаза спавна ещё идёт)
  | "autospawn" // точку НЕ выбрал — поставили автоматом на случайное место
  | "restart"
  | "expand"
  | "tribes"
  | "await_build"
  | "build"
  | "income" // город построен → построй фабрику/порт (доход)
  | "final"
  | "menu"
  | "hidden";

@customElement("spawn-tutorial")
export class SpawnTutorial extends LitElement implements Controller {
  public game!: GameView;
  public eventBus!: EventBus;

  @state() private step: Step = "none";
  @state() private attacks = 0;
  @state() private tribesEaten = 0;
  @state() private dismissed = false;
  // цена города/фабрики (из реальных buildables) — для прогресса золота
  @state() private cityCost = 0n;
  @state() private incomeCost = 0n;
  private menuShownAt = 0;
  // terron: предупреждение «не тыкай в племена» (клик по занятой суше в спавне)
  @state() private tribeWarn = false;
  @state() private warnKind: "tribe" | "nation" | "player" = "tribe";
  private tribeWarnTimer: number | null = null;
  private onTribeClick = (e: Event) => {
    if (
      this.step !== "spawn" &&
      this.step !== "spawned" &&
      this.step !== "none"
    )
      return;
    const kind = (e as CustomEvent).detail?.kind;
    this.warnKind = kind === "nation" || kind === "player" ? kind : "tribe";
    this.tribeWarn = true;
    this.dismissed = false;
    this.requestUpdate();
    if (this.tribeWarnTimer) clearTimeout(this.tribeWarnTimer);
    this.tribeWarnTimer = window.setTimeout(() => {
      this.tribeWarn = false;
      this.requestUpdate();
    }, 4500);
  };

  // wall-clock, когда локальный игрок заспавнился и жив (для «выжил 5 мин» → выпуск)
  private aliveSinceMs = 0;
  private spawnTile: TileRef | null = null;
  // тик, когда фаза спавна кончилась, а игрок ещё не заспавнен (ждём автоспавн)
  private unspawnedSince: number | null = null;
  private timer: number | null = null;
  private poll: number | null = null;
  // племена (Bot), которых касались границей (для «коснулся ≥2» и «съел ≥1»)
  private borderedBots = new Map<number, { isAlive(): boolean }>();

  createRenderRoot() {
    // справа-сверху, под панелью таймера/настроек (в одном с ней углу)
    this.style.position = "fixed";
    this.style.right = "16px";
    // terron iOS: +safe-area, иначе карточка лезет под нотч/часы (десктоп = +0)
    this.style.top = "calc(76px + env(safe-area-inset-top))";
    this.style.zIndex = "1000";
    this.style.pointerEvents = "none";
    this.style.maxWidth = "min(92vw, 360px)";
    return this;
  }

  init() {
    window.addEventListener("terron-spawn-on-tribe", this.onTribeClick);
    this.eventBus?.on(SendSpawnIntentEvent, (e) => {
      this.spawnTile = e.tile;
      // точку выбрали — но «расширяйся» показываем ТОЛЬКО после старта матча
      // (во время фазы спавна атаковать всё равно нельзя). Ждём в "spawned".
      if (this.step === "spawn" || this.step === "none") this.step = "spawned";
    });
    this.eventBus?.on(SendAttackIntentEvent, () => {
      if (this.step === "expand" && this.attacks < ATTACKS_REQUIRED) {
        this.attacks++;
      }
    });
    this.eventBus?.on(BuildUnitIntentEvent, (e) => {
      // город построен → шаг «доход» (фабрика/порт)
      if (this.step === "build" && e.unit === UnitType.City) this.go("income");
      // фабрика ИЛИ порт построены → подсказка про правую кнопку, потом финал
      else if (
        this.step === "income" &&
        (e.unit === UnitType.Port || e.unit === UnitType.Factory)
      )
        this.go("menu");
    });
    this.eventBus?.on(ContextMenuEvent, () => {
      // правый клик проматывает подсказку к поздравлению, НО только если она уже
      // повисела ≥3с — иначе обычные правые клики в игре мгновенно её проскакивают.
      if (this.step === "menu" && Date.now() - this.menuShownAt > 3000) {
        this.go("final");
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.clearTimers();
    window.removeEventListener("terron-spawn-on-tribe", this.onTribeClick);
    if (this.tribeWarnTimer) clearTimeout(this.tribeWarnTimer);
    document.body.classList.remove(CITY_HL_CLASS);
    document.body.classList.remove(INCOME_HL_CLASS);
  }

  // terron (запрос владельца 19.07): обучение подавляем (1) в РЕПЛЕЯХ — там
  // спавнить нечего, а подсказки пугали зрителя; (2) при ПОЗДНЕМ входе в уже
  // идущий матч (спектатор/догон): спавн-фаза+грейс позади, а игрок так и не
  // заспавнился. Вошёл В ГРЕЙСЕ — обучение живёт (спавн ещё возможен). Порог с
  // запасом +100 тиков, чтобы ветка автоспавна успевала отработать.
  private static readonly LATE_GATE_TICKS =
    TERRON_SPAWN_PHASE_PVP_TURNS + TERRON_SPAWN_GRACE_TURNS + 100;

  private suppressed(): boolean {
    // terron: на полигоне /test подсказки не нужны — там проверяют интерфейс,
    // а карточки обучения закрывают треть экрана.
    if (isTestGroundActive()) return true;
    try {
      if (this.game.config().isReplay()) return true;
    } catch {
      return false; // конфиг ещё не готов — решим на следующем кадре
    }
    return (
      this.game.ticks() > SpawnTutorial.LATE_GATE_TICKS &&
      this.game.myPlayer()?.hasSpawned() !== true
    );
  }

  tick() {
    if (this.step === "hidden") return;
    if (this.suppressed()) {
      this.go("hidden");
      return;
    }
    // «выпускник» (раз прожил ≥5 мин) — обучение больше не показываем.
    if (isTutorGraduated()) {
      this.go("hidden");
      return;
    }
    // Детект «выжил 5 минут» → ставим флаг выпуска и прячем подсказки навсегда.
    const me = this.game.myPlayer();
    if (me?.hasSpawned() === true && me.isAlive()) {
      if (this.aliveSinceMs === 0) this.aliveSinceMs = Date.now();
      else if (Date.now() - this.aliveSinceMs >= TUTOR_GRADUATE_MS) {
        try {
          localStorage.setItem(TUTOR_GRAD_KEY, "1");
        } catch {
          /* ignore */
        }
        this.go("hidden");
        return;
      }
    } else if (me && !me.isAlive()) {
      this.aliveSinceMs = 0; // умер до 5 мин → отсчёт заново в следующем матче
    }
    const sp = this.game.inSpawnPhase();
    const spawned = this.game.myPlayer()?.hasSpawned() === true;
    switch (this.step) {
      case "none":
        if (sp && !spawned) this.go("spawn");
        break;
      case "spawn":
        if (spawned) {
          // Шаг всё ещё "spawn" (ручной клик увёл бы в "spawned" через
          // SendSpawnIntentEvent), а игрок заспавнен → это АВТОСПАВН: точку не
          // выбрал, поставили автоматом.
          this.go("autospawn");
        } else if (!sp) {
          // Фаза кончилась, ещё не заспавнен — ЖДЁМ грейс+автоспавн, не паникуем.
          if (this.unspawnedSince === null) {
            this.unspawnedSince = this.game.ticks();
          } else if (
            this.game.ticks() - this.unspawnedSince >
            AUTOSPAWN_WAIT_TICKS
          ) {
            // Автоспавн так и не случился (карта забита) — реальный провал.
            this.go("restart");
          }
        }
        break;
      case "spawned":
        if (!sp) this.go("expand"); // матч начался → теперь можно расширяться
        break;
      case "await_build":
      case "income":
        this.requestUpdate(); // живой счётчик золота на карточке
        break;
    }
  }

  private clearTimers() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }

  // expand → tribes: после 5 кликов — ждём, пока вокруг кончится пустошь
  // (свободной суши < 30%, ВОДУ в формуле игнорируем). Тогда расти некуда —
  // пора атаковать племена. Без таймеров.
  private async checkExpandToTribes() {
    if (this.step !== "expand") return;
    if (this.game.inSpawnPhase()) return; // в фазе спавна атаковать нельзя
    if (this.attacks < ATTACKS_REQUIRED) return;
    const free = await this.freeLandFraction();
    if (this.step === "expand" && free < 0.3) {
      this.go("tribes");
    }
  }

  // Доля СВОБОДНОЙ суши вокруг границы (вода игнорируется). 0 = всё занято.
  private async freeLandFraction(): Promise<number> {
    const me = this.game.myPlayer();
    if (!me) return 1;
    try {
      const { borderTiles } = await me.borderTiles();
      const mySmall = me.smallID();
      let free = 0;
      let total = 0;
      for (const tile of borderTiles) {
        for (const n of this.game.neighbors(tile)) {
          if (!this.game.isLand(n)) continue; // воду игнорируем
          if (!this.game.hasOwner(n)) {
            free++; // ничья суша = пустошь, куда расти
            total++;
            continue;
          }
          const o = this.game.owner(n);
          if (o.isPlayer() && o.smallID() === mySmall) continue; // своя — не в счёт
          total++; // чужая занятая суша
        }
      }
      return total > 0 ? free / total : 1;
    } catch {
      return 1;
    }
  }

  // tribes → build: ТОЛЬКО по триггеру — съел TRIBES_REQUIRED племён (граничащий
  // бот умер/поглощён). Никаких таймеров.
  private async checkTribeEaten() {
    if (this.step !== "tribes") return;
    await this.scanBorderBots();
    const eaten = this.eatenBots();
    if (eaten !== this.tribesEaten) this.tribesEaten = eaten; // @state → ре-рендер
    if (this.step === "tribes" && eaten >= TRIBES_REQUIRED) {
      // terron: скип убран — ведём через карточку «строй город», даже если он уже
      // есть (чтобы юзер увидел ВСЕ карточки сам).
      // this.go(this.hasUnit(UnitType.City) ? "income" : "await_build");
      this.go("await_build");
    }
  }

  private hasUnit(t: UnitType): boolean {
    return (this.game?.myPlayer()?.units(t).length ?? 0) > 0;
  }

  // income → menu(→final): построил фабрику ИЛИ порт (ловим и заранее построенное).
  // Заодно тянем цену фабрики/порта из buildables для прогресс-бара золота.
  private async checkIncomeBuilt() {
    if (this.step !== "income") return;
    // terron: скип «уже построено» убран — переход к meню только по событию
    // постройки фабрики/порта (BuildUnitIntentEvent), чтобы карточка показалась.
    // if (this.hasUnit(UnitType.Factory) || this.hasUnit(UnitType.Port)) {
    //   this.go("menu");
    //   return;
    // }
    const p = this.game?.myPlayer();
    if (!p || this.spawnTile == null) return;
    try {
      const bs = await p.buildables(this.spawnTile, [
        UnitType.Factory,
        UnitType.Port,
      ]);
      const costs = bs.filter((b) => b.cost > 0n).map((b) => b.cost);
      if (costs.length) {
        const min = costs.reduce((a, b) => (a < b ? a : b));
        if (this.step === "income" && min !== this.incomeCost) {
          this.incomeCost = min;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Племена (Bot), которых мы касались границей. Храним ссылку на игрока, чтобы
  // потом проверить isAlive() (мёртвый = по сути съеден/поглощён).
  private async scanBorderBots(): Promise<void> {
    const me = this.game.myPlayer();
    if (!me) return;
    try {
      const { borderTiles } = await me.borderTiles();
      const mySmall = me.smallID();
      for (const tile of borderTiles) {
        for (const n of this.game.neighbors(tile)) {
          if (!this.game.hasOwner(n)) continue;
          const o = this.game.owner(n);
          if (!o.isPlayer() || o.smallID() === mySmall) continue;
          if (o.type() === PlayerType.Bot)
            this.borderedBots.set(o.smallID(), o);
        }
      }
    } catch {
      /* ignore */
    }
  }

  private eatenBots(): number {
    let n = 0;
    for (const o of this.borderedBots.values()) if (!o.isAlive()) n++;
    return n;
  }

  // Город доступен (canBuild учитывает золото И место). Проверяем НЕ только
  // стартовый тайл (он мог быть пустым/занят), а ещё и border-тайлы — тогда шаг
  // завершается ровно когда хватает золота на город.
  private async checkCityBuildable() {
    if (this.step !== "await_build") return;
    const p = this.game.myPlayer();
    if (!p) return;
    try {
      const tiles: TileRef[] = [];
      if (this.spawnTile != null) tiles.push(this.spawnTile);
      const { borderTiles } = await p.borderTiles();
      let i = 0;
      for (const t of borderTiles) {
        tiles.push(t);
        if (++i >= 10) break;
      }
      // terron: скип «уже построил город» убран — карточка «строй город»
      // показывается, переход к доходу только по событию постройки города.
      // if (this.hasUnit(UnitType.City)) {
      //   this.go("income");
      //   return;
      // }
      for (const t of tiles) {
        const bs = await p.buildables(t, [UnitType.City]);
        const city = bs.find((b) => b.type === UnitType.City);
        if (!city) continue;
        // запоминаем реальную цену города (даже если пока не по карману)
        if (city.cost > 0n && city.cost !== this.cityCost) {
          this.cityCost = city.cost;
        }
        if (this.step === "await_build" && city.canBuild !== false) {
          this.go("build");
          return;
        }
      }
    } catch {
      /* ignore */
    }
  }

  private go(step: Step) {
    this.clearTimers();
    this.dismissed = false;
    this.step = step;
    // обучение завершено → активируем трекер задач
    if (step === "hidden") {
      window.dispatchEvent(new CustomEvent("terron-tutorial-done"));
    }
    document.body.classList.toggle(CITY_HL_CLASS, step === "build");
    document.body.classList.toggle(INCOME_HL_CLASS, step === "income");

    switch (step) {
      case "autospawn":
        // показываем «выбрали за вас» 8с, потом обычное «расширяйся».
        this.timer = window.setTimeout(() => this.go("expand"), 8000);
        break;
      case "expand":
        this.attacks = 0;
        this.borderedBots.clear();
        this.poll = window.setInterval(
          () => void this.checkExpandToTribes(),
          1000,
        );
        break;
      case "tribes":
        // держим «атакуй племена», пока не съешь племя. БЕЗ таймеров.
        this.tribesEaten = 0;
        this.borderedBots.clear(); // считаем съеденных именно в этой фазе
        this.poll = window.setInterval(() => void this.checkTribeEaten(), 1000);
        break;
      case "await_build":
        this.poll = window.setInterval(
          () => void this.checkCityBuildable(),
          1500,
        );
        break;
      case "income":
        // если фабрика/порт уже есть — сразу финал; иначе ждём постройку
        this.poll = window.setInterval(() => this.checkIncomeBuilt(), 1000);
        break;
      case "menu":
        // подсказка про правую кнопку — висит подольше, чтобы успели заметить
        this.menuShownAt = Date.now();
        this.timer = window.setTimeout(() => this.go("final"), 12000);
        break;
      case "final":
        // поздравление — последний и заметный экран перед заданиями
        this.timer = window.setTimeout(() => this.go("hidden"), 11000);
        break;
    }
  }

  // Клик по карточке: на menu/final — проматываем дальше по цепочке (а не просто
  // прячем), чтобы поздравление и переход к заданиям не терялись.
  private dismiss = () => {
    if (this.step === "menu") this.go("final");
    else if (this.step === "final") this.go("hidden");
    else this.dismissed = true;
  };

  // terron: на телефоне управление другое (тап вместо мыши) — подсказки иные.
  private get mobile(): boolean {
    return (
      window.matchMedia("(max-width: 767px)").matches ||
      "ontouchstart" in window
    );
  }

  render() {
    // Страховка вторым эшелоном: даже если tick-гейт не дошёл (порядок слоёв),
    // в реплее/при позднем входе не рендерим ничего.
    if (this.suppressed()) {
      document.body.classList.toggle("tut-visible", false);
      return html``;
    }
    const visible =
      (this.step !== "none" && this.step !== "hidden" && !this.dismissed) ||
      (this.tribeWarn && this.step !== "hidden");
    // Маркер «наша подсказка видна» — HeadsUpMessage по нему сдвигается вниз,
    // чтобы не пересекаться (наши подсказки в приоритете, см. terron-theme.css).
    document.body.classList.toggle("tut-visible", visible);
    if (!visible) return html``;

    const styles = html`<style>
      @keyframes spawnTutIn {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @keyframes spawnTutWin {
        0% {
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6);
        }
        50% {
          box-shadow: 0 0 28px 6px rgba(16, 185, 129, 0.55);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
        }
      }
      .stut {
        position: relative;
        font-family: "Golos Text", system-ui, sans-serif;
        color: #fff;
        border-radius: 10px;
        padding: 14px 16px;
        background: rgba(17, 24, 39, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.5);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(2px);
        animation: spawnTutIn 0.22s ease-out both;
        pointer-events: auto;
        cursor: pointer;
      }
      .stut.win {
        background: rgba(6, 95, 70, 0.92);
        border-color: #10b981;
        animation: spawnTutWin 0.9s ease-out both;
      }
      .stut.gold {
        border-color: #d4af37;
      }
      .stut.warn {
        border-color: #f59e0b;
      }
      .stut.danger {
        background: rgba(76, 10, 10, 0.93);
        border-color: #ef4444;
      }
      .stut h4 {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.3;
      }
      /* Tailwind preflight делает img/svg block — возвращаем inline, чтобы
         иконки шли В СТРОКУ с текстом, а не падали каждая на свою строку */
      .stut img,
      .stut svg {
        display: inline-block !important;
        vertical-align: -3px;
      }
      .stut .ic {
        width: 15px;
        height: 15px;
        margin: 0 1px;
      }
      /* спрайт-имитация ОБЪЁМНОЙ клавиши (3D-кэп) */
      .stut .key {
        display: inline-block;
        min-width: 22px;
        padding: 3px 7px 4px;
        margin: 0 2px;
        font-family: ui-monospace, "SF Mono", monospace;
        font-size: 13px;
        font-weight: 800;
        line-height: 1;
        text-align: center;
        color: #1f2530;
        background: linear-gradient(#fffefb 0%, #efe9da 55%, #d4cbb4 100%);
        border: 1px solid #b6ae98;
        border-bottom-width: 3px;
        border-radius: 6px;
        box-shadow:
          0 3px 5px rgba(0, 0, 0, 0.45),
          inset 0 1px 0 #fff;
        vertical-align: middle;
      }
      /* нижняя строка с клавишами — тихая, отдельная */
      .stut .keyline {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.12);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.7;
      }
      .stut .sub {
        font-size: 12px;
        opacity: 0.85;
        margin-top: 4px;
      }
      .stut .tip {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.65;
        margin: 10px 0 4px;
      }
      .stut .x {
        position: absolute;
        top: 5px;
        right: 8px;
        font-size: 15px;
        line-height: 1;
        opacity: 0.4;
        cursor: pointer;
      }
      .stut .x:hover {
        opacity: 0.9;
      }
      .stut ul {
        margin: 0;
        padding-left: 16px;
        font-size: 13px;
        line-height: 1.5;
      }
      .stut .mrow {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 6px;
      }
      .stut-prog {
        margin-top: 10px;
        height: 5px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.15);
        overflow: hidden;
      }
      .stut-prog > i {
        display: block;
        height: 100%;
        background: #10b981;
        transition: width 0.25s ease;
      }
      /* terron: компактнее на телефоне — карточка занимала пол-экрана */
      @media (max-width: 767px) {
        .stut {
          padding: 9px 11px;
          max-width: 76vw;
          border-radius: 8px;
        }
        .stut h4 {
          font-size: 12.5px;
        }
        .stut .sub,
        .stut ul {
          font-size: 11px;
        }
        .stut .sub {
          margin-top: 3px;
        }
      }
    </style>`;

    const close = html`<div class="x" title=${L("закрыть", "close")}>✕</div>`;
    const card = (cls: string, body: unknown) =>
      html`${styles}
        <div class="stut ${cls}" @click=${this.dismiss}>${close}${body}</div>`;

    // мышь: рисуем ОБЕ кнопки — активная ярко-оранжевая, вторая серая (видно сторону)
    const mouse = (left: boolean) =>
      html`<svg
        width="20"
        height="28"
        viewBox="0 0 20 28"
        style="flex:none;vertical-align:middle"
      >
        <rect
          x="1.5"
          y="1.5"
          width="17"
          height="25"
          rx="8.5"
          fill="#0f172a"
          stroke="#94a3b8"
          stroke-width="1.4"
        />
        <path
          d="M10 2.4 L5 2.4 A6 6 0 0 0 2 7 L2 12.5 L10 12.5 Z"
          fill=${left ? "#f59e0b" : "#475569"}
        />
        <path
          d="M10 2.4 L15 2.4 A6 6 0 0 1 18 7 L18 12.5 L10 12.5 Z"
          fill=${left ? "#475569" : "#f59e0b"}
        />
        <line
          x1="10"
          y1="2.4"
          x2="10"
          y2="12.5"
          stroke="#0f172a"
          stroke-width="1.4"
        />
        <line
          x1="2"
          y1="12.5"
          x2="18"
          y2="12.5"
          stroke="#0f172a"
          stroke-width="1.4"
        />
      </svg>`;
    const mouseIcon = mouse(false); // правая кнопка
    const mouseIconLeft = mouse(true); // левая кнопка
    const tapGlyph = html`<span style="font-size:18px;line-height:1;flex:none"
      >👆</span
    >`;
    // leftHint: десктоп — левая кнопка мыши; телефон — тап (иконка авто-меняется).
    const leftHint = (text: string) =>
      html`<div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        ${this.mobile ? tapGlyph : mouseIconLeft}<span
          class="sub"
          style="margin-top:0"
          >${text}</span
        >
      </div>`;
    // выбор/обычный клик vs АТАКА (на мобиле атака = тап по земле + тап ⚔️ в центре).
    const clickText = this.mobile
      ? translateText("spawn_tut.tap")
      : translateText("spawn_tut.left_click");
    const attackText = this.mobile
      ? translateText("spawn_tut.tap_attack")
      : translateText("spawn_tut.left_click");

    // terron: тыкнул в племя/занятую сушу во время выбора спавна — ругаемся красным.
    if (this.tribeWarn) {
      const word = translateText(
        this.warnKind === "nation"
          ? "spawn_tut.warn_nation"
          : this.warnKind === "player"
            ? "spawn_tut.warn_player"
            : "spawn_tut.warn_tribe",
      );
      return card(
        "danger",
        html`<h4 style="color:#fca5a5">
            ${translateText("spawn_tut.warn_title", { what: word })}
          </h4>
          <div class="sub">${translateText("spawn_tut.warn_sub")}</div>
          ${leftHint(translateText("spawn_tut.warn_hint"))}`,
      );
    }

    switch (this.step) {
      case "spawn":
        return card(
          "",
          html`<h4>${translateText("spawn_tut.spawn_title")}</h4>
            ${leftHint(clickText)}
            <div class="tip">${translateText("spawn_tut.tip")}</div>
            <ul>
              <li>${translateText("spawn_tut.tip_green")}</li>
              <li>${translateText("spawn_tut.tip_sea")}</li>
            </ul>`,
        );
      case "spawned":
        return card(
          "",
          html`<h4>${translateText("spawn_tut.spawned_title")}</h4>
            <div class="sub">
              ${translateText(
                this.mobile
                  ? "spawn_tut.spawned_sub_m"
                  : "spawn_tut.spawned_sub",
              )}
            </div>
            ${leftHint(clickText)}`,
        );
      case "autospawn":
        return card(
          "warn",
          html`<h4>${translateText("spawn_tut.autospawn_title")}</h4>
            <div class="sub">${translateText("spawn_tut.autospawn_sub")}</div>
            <div class="sub">
              ${translateText("spawn_tut.autospawn_late")}
            </div>`,
        );
      case "restart":
        return card(
          "warn",
          html`<h4>${translateText("spawn_tut.restart_title")}</h4>
            <div class="sub">${translateText("spawn_tut.restart_sub")}</div>`,
        );
      case "expand": {
        const pct = Math.min(100, (this.attacks / ATTACKS_REQUIRED) * 100);
        const left = Math.max(0, ATTACKS_REQUIRED - this.attacks);
        return card(
          "",
          html`<h4>${translateText("spawn_tut.expand_title")}</h4>
            <div class="sub">
              ${translateText(
                this.mobile ? "spawn_tut.expand_sub_m" : "spawn_tut.expand_sub",
              )}
            </div>
            ${leftHint(attackText)}
            ${left > 0
              ? html`<div class="sub">
                    ${translateText(
                      this.mobile
                        ? "spawn_tut.expand_more_m"
                        : "spawn_tut.expand_more",
                      { n: left },
                    )}
                  </div>
                  <div class="stut-prog"><i style="width:${pct}%"></i></div>`
              : html`<div class="sub">
                  ${translateText("spawn_tut.expand_continue")}
                </div>`}
            <div class="sub" style="margin-top:6px">
              ${translateText("spawn_tut.expand_warn")}
            </div>`,
        );
      }
      case "tribes": {
        const eaten = Math.min(this.tribesEaten, TRIBES_REQUIRED);
        const pct = (eaten / TRIBES_REQUIRED) * 100;
        return card(
          "gold",
          html`<h4>${translateText("spawn_tut.tribes_title")}</h4>
            <div class="sub">${translateText("spawn_tut.tribes_sub")}</div>
            <div class="sub" style="margin-top:6px;font-weight:700">
              ${translateText("spawn_tut.tribes_eaten", {
                eaten,
                total: TRIBES_REQUIRED,
              })}
            </div>
            <div class="stut-prog"><i style="width:${pct}%"></i></div>`,
        );
      }
      case "await_build": {
        const gold = this.game.myPlayer()?.gold() ?? 0n;
        const cost = this.cityCost;
        const pct = cost > 0n ? Math.min(100, Number((gold * 100n) / cost)) : 0;
        return card(
          "gold",
          html`<h4>${translateText("spawn_tut.await_title")}</h4>
            <div class="sub">${translateText("spawn_tut.await_sub")}</div>
            ${cost > 0n
              ? html`<div
                    class="sub"
                    style="margin-top:8px;display:flex;align-items:center;gap:5px;font-weight:700"
                  >
                    <img src=${goldCoinIcon} width="14" height="14" />
                    ${renderNumber(gold)} / ${renderNumber(cost)}
                    <span style="opacity:.65;font-weight:400"
                      >${translateText("spawn_tut.await_for_city")}</span
                    >
                  </div>
                  <div class="stut-prog"><i style="width:${pct}%"></i></div>`
              : null}`,
        );
      }
      case "build":
        return card(
          "gold",
          html`<h4>
              ${translateText("spawn_tut.build_build")}
              <span style="white-space:nowrap"
                ><img class="ic" src=${cityIcon} /> ${translateText(
                  "spawn_tut.build_city",
                )}</span
              >
            </h4>
            <div class="sub">${translateText("spawn_tut.build_sub")}</div>
            <div class="sub">${translateText("spawn_tut.build_sub2")}</div>
            <div
              class="keyline"
              style=${this.mobile ? "text-transform:none" : ""}
            >
              ${this.mobile
                ? html`👆 ${translateText("spawn_tut.tap_territory")}
                    <img class="ic" src=${buildIcon} /> →
                    <img class="ic" src=${cityIcon} />`
                : html`${translateText("spawn_tut.key")}
                    <span class="key">1</span>`}
            </div>`,
        );
      case "income": {
        const igold = this.game?.myPlayer()?.gold() ?? 0n;
        const icost = this.incomeCost;
        const ipct =
          icost > 0n ? Math.min(100, Number((igold * 100n) / icost)) : 0;
        return card(
          "gold",
          html`<h4>${translateText("spawn_tut.income_title")}</h4>
            <div class="sub" style="margin-top:6px">
              ${translateText("spawn_tut.build_build")}
              <span style="white-space:nowrap"
                ><img class="ic" src=${factoryIcon} />
                <b>${translateText("spawn_tut.income_factory")}</b></span
              >
              ${translateText("spawn_tut.income_or")}
              <span style="white-space:nowrap"
                ><img class="ic" src=${portIcon} />
                <b>${translateText("spawn_tut.income_port")}</b></span
              >.
            </div>
            <div class="sub">${translateText("spawn_tut.income_gold")}</div>
            ${icost > 0n
              ? html`<div
                    class="sub"
                    style="margin-top:8px;display:flex;align-items:center;gap:5px;font-weight:700"
                  >
                    <img src=${goldCoinIcon} width="14" height="14" />
                    ${renderNumber(igold)} / ${renderNumber(icost)}
                  </div>
                  <div class="stut-prog"><i style="width:${ipct}%"></i></div>`
              : null}
            <div
              class="keyline"
              style=${this.mobile ? "text-transform:none" : ""}
            >
              ${this.mobile
                ? html`👆 ${translateText("spawn_tut.tap_territory")}
                    <img class="ic" src=${buildIcon} /> →
                    <img class="ic" src=${factoryIcon} /> /
                    <img class="ic" src=${portIcon} />`
                : html`${translateText("spawn_tut.keys")}
                    <span class="key">2</span> <span class="key">3</span>`}
            </div>`,
        );
      }
      case "final":
        return card(
          "win",
          html`<h4>${translateText("spawn_tut.final_title")}</h4>
            <div class="sub">${translateText("spawn_tut.final_sub")}</div>
            <div class="sub" style="margin-top:6px;font-weight:700">
              ${translateText("spawn_tut.final_goal")}
            </div>`,
        );
      case "menu":
        return card(
          "",
          html`<h4>${translateText("spawn_tut.menu_title")}</h4>
            <div class="mrow">
              ${this.mobile ? tapGlyph : mouseIcon}
              <div class="sub" style="margin-top:0">
                ${this.mobile
                  ? translateText("spawn_tut.tap_menu")
                  : translateText("spawn_tut.menu_sub")}
              </div>
            </div>`,
        );
      default:
        return html``;
    }
  }
}

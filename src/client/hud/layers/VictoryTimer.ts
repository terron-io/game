import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { GameMode } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { L } from "../../Utils";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";

/**
 * «Полоса победы на экране / убралась» + сколько места она реально занимает.
 *
 * terron 01.09 (репорт тестера): панель наведённого игрока рисуется ВЫШЕ этой
 * полосы по z-index и накрывала её плашку — прочитать, что происходит, было
 * негде. Панель уже умеет отступать от спавн-полосы и полосы иммунитета тем же
 * механизмом; победная полоса просто не участвовала в этом стеке.
 *
 * ⚠️ Высоту МЕРЯЕМ, а не пишем константой: плашка — текст со своим шрифтом и
 * отступами, любая правка стиля рассинхронизировала бы записанное число.
 */
/** Запасная высота плашки, когда померить её не удалось. */
const VICTORY_BAR_FALLBACK_PX = 34;

export class VictoryBarVisibleEvent implements GameEvent {
  constructor(
    public readonly visible: boolean,
    public readonly heightPx: number,
  ) {}
}

// terron 26.08 (решение владельца по опросу в ТГ): ПОБЕДА С УДЕРЖАНИЕМ.
//
// Раньше матч кончался в ту же секунду, когда лидер пересекал порог территории,
// и победа читалась как «внезапно всё выключили». Теперь порог надо удержать
// (Config.victoryHoldTurns), и всё это время сверху идёт полоса — та же
// презентация, что у спавн-фазы, иммунитета и блэкаута, чтобы игрок узнавал
// её без объяснений — плюс надпись, КТО именно дожимает.
//
// ⚠️ Полоса УБЫВАЕТ (осталось), а не наполняется: «сколько мне ещё жить» —
// более честное чтение момента, чем «сколько он уже держит».
//
// ⚠️ Остаток считается ИЗ ОКНА, приехавшего от симуляции (startTick/endTick), а
// не из локального таймера: у всех клиентов одна и та же цифра, и она не врёт
// после лага или догона.
@customElement("victory-timer")
export class VictoryTimer extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  private isVisible = false;
  private isActive = false;
  private remainingRatio = 0;
  private secondsLeft = 0;
  private holderName = "";
  private thresholdPct = 0;
  private isMine = false;
  private immunityBarVisible = false;
  private announcedBar: string | null = null;

  createRenderRoot() {
    this.style.position = "fixed";
    // Под нотч — как у соседних полос.
    this.style.top = "env(safe-area-inset-top)";
    this.style.left = "0";
    this.style.width = "100%";
    this.style.height = "7px";
    this.style.zIndex = "1000";
    this.style.pointerEvents = "none";
    return this;
  }

  init() {
    this.isVisible = true;
    this.eventBus?.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
    });
  }

  tick() {
    if (!this.game || !this.isVisible) return;

    const v = this.game.victoryCountdown();
    const now = this.game.ticks();
    if (v === null || now >= v.endTick) {
      this.setInactive();
      return;
    }

    // Стек полос: командная (в Team-режиме вне спавна) + иммунитет.
    const teamBar =
      this.game.config().gameConfig().gameMode === GameMode.Team &&
      !this.game.inSpawnPhase();
    const offset = (teamBar ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
    this.style.top = `calc(env(safe-area-inset-top) + ${offset}px)`;

    const span = Math.max(1, v.endTick - v.startTick);
    this.remainingRatio = Math.min(1, Math.max(0, (v.endTick - now) / span));
    this.secondsLeft = Math.max(0, Math.ceil((v.endTick - now) / 10));

    // Имя держателя. В командном режиме подписываем команду — она и победит.
    const holder = this.game.playerBySmallID(v.playerSmallID);
    const holderView =
      holder !== undefined && "name" in holder ? holder : undefined;
    this.holderName =
      v.teamName !== "" ? v.teamName : (holderView?.name() ?? "");
    this.isMine =
      v.teamName === ""
        ? holderView !== undefined && holderView === this.game.myPlayer()
        : this.game.myPlayer()?.team() === v.teamName;
    this.thresholdPct = v.thresholdPct;
    this.isActive = true;
    this.requestUpdate();
  }

  private setInactive() {
    if (this.isActive) {
      this.isActive = false;
      this.requestUpdate();
    }
  }

  updated() {
    // Меряем ПОСЛЕ отрисовки: до неё плашки в DOM ещё нет.
    const pill = this.querySelector("div[style*='border-radius:0 0 6px 6px']");
    // Ноль значит «померить не вышло» (вёрстка ещё не легла) — берём запасную
    // высоту, иначе панель игрока встанет вплотную и снова накроет плашку.
    const measured =
      pill instanceof HTMLElement ? pill.offsetTop + pill.offsetHeight : 0;
    const px = this.isActive
      ? Math.round(measured > 0 ? measured : VICTORY_BAR_FALLBACK_PX)
      : 0;
    const key = `${this.isActive}:${px}`;
    if (key === this.announcedBar) return;
    this.announcedBar = key;
    this.eventBus?.emit(new VictoryBarVisibleEvent(this.isActive, px));
  }

  render() {
    if (!this.isVisible || !this.isActive) {
      return html``;
    }
    const widthPercent = this.remainingRatio * 100;
    // Свой рывок к победе — золотой, чужой — тревожно-красный: цвет отвечает
    // на «это хорошая новость или плохая» раньше, чем игрок прочитает строку.
    const barColor = this.isMine
      ? "rgba(234, 179, 8, 0.95)"
      : "rgba(220, 38, 38, 0.95)";
    // ⚠️ НА ТЕЛЕФОНЕ РЕЖЕТСЯ ИМЯ, А НЕ ЦИФРА. Первый заход рисовал строку одним
    // куском с ellipsis — и на 375px обрезалось «…победа через 9», то есть ровно
    // то, ради чего полоса и заведена. Теперь ник — единственный сжимаемый
    // элемент, а остаток секунд не сжимается никогда.
    const holder = this.isMine ? L("Ты", "You") : this.holderName;
    const verb = this.isMine ? L("держишь", "hold") : L("достиг", "reached");
    const tail = L(
      `${this.thresholdPct}% территории`,
      `${this.thresholdPct}% of the map`,
    );

    return html`
      <div class="w-full h-full flex z-999">
        <div
          class="h-full transition-all duration-100 ease-in-out"
          style="width: ${widthPercent}%; background-color: ${barColor};"
        ></div>
      </div>
      <div
        style="position:absolute;top:9px;left:50%;transform:translateX(-50%);
               max-width:96vw;display:flex;align-items:baseline;gap:6px;
               padding:3px 10px;border-radius:0 0 6px 6px;
               background:rgba(17,24,39,.82);backdrop-filter:blur(4px);
               color:#fff;font-size:13px;font-weight:600;letter-spacing:.01em;
               border:1px solid ${barColor};border-top:none;
               text-shadow:0 1px 2px rgba(0,0,0,.6)"
      >
        <span
          style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          >${holder}</span
        >
        <span class="hidden sm:inline" style="white-space:nowrap;flex:0 0 auto"
          >${verb} ${tail} —</span
        >
        <span class="sm:hidden" style="white-space:nowrap;flex:0 0 auto"
          >· ${this.thresholdPct}% ·</span
        >
        <span
          style="white-space:nowrap;flex:0 0 auto;font-variant-numeric:tabular-nums"
        >
          <span class="hidden sm:inline"
            >${L("победа через", "victory in")} </span
          >${this.secondsLeft}
        </span>
      </div>
    `;
  }
}

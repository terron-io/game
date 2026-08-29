import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameMode } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";

// terron: «Небо наше» — полоса-таймер СВЕРХУ (как перемирие/иммунитет): убывает
// справа налево, показывает, сколько ещё длится блэкаут. Рисуется ВСЕМ —
// владельцу ульты И остальным (эффект глобальный, всем полезно знать, когда
// закончится). Стек под командной/иммунитет-полосами. Спека: new-units/NEBO.md
@customElement("satellite-blackout-timer")
export class SatelliteBlackoutTimer
  extends LitElement
  implements Controller
{
  public game: GameView;
  public eventBus: EventBus;

  private isVisible = false;
  private isActive = false;
  private progressRatio = 0; // доля ПРОШЕДШЕГО времени эффекта (0→1)
  private immunityBarVisible = false;

  createRenderRoot() {
    this.style.position = "fixed";
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
    // Иммунитет-полоса сообщает свою видимость → стекаем под неё.
    this.eventBus?.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
    });
  }

  tick() {
    if (!this.game || !this.isVisible) return;

    const b = this.game.satBlackoutRaw();
    const now = this.game.ticks();
    if (b === null || now < b.blastTick || now >= b.endTick) {
      this.setInactive();
      return;
    }

    // Стек: командная полоса (7px в Team-режиме вне спавна) + иммунитет-полоса.
    const teamBar =
      this.game.config().gameConfig().gameMode === GameMode.Team &&
      !this.game.inSpawnPhase();
    const offset =
      (teamBar ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
    this.style.top = `calc(env(safe-area-inset-top) + ${offset}px)`;

    const span = Math.max(1, b.endTick - b.blastTick);
    this.progressRatio = Math.min(1, Math.max(0, (now - b.blastTick) / span));
    this.isActive = true;
    this.requestUpdate();
  }

  private setInactive() {
    if (this.isActive) {
      this.isActive = false;
      this.requestUpdate();
    }
  }

  render() {
    if (!this.isVisible || !this.isActive) {
      return html``;
    }
    // Убывает 100%→0% справа налево — «сколько осталось до конца блэкаута».
    const widthPercent = (1 - this.progressRatio) * 100;
    return html`
      <div class="w-full h-full flex z-999">
        <div
          class="h-full transition-all duration-100 ease-in-out"
          style="width: ${widthPercent}%; background-color: rgba(129, 140, 248, 0.92);"
        ></div>
      </div>
    `;
  }
}

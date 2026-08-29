/**
 * terron: авиация — BeachheadTimerController.
 *
 * Рисует обратный отсчёт (30, 29, …) над десантными плацдармами ЛОКАЛЬНОГО игрока,
 * пока действует иммунитет от авто-схлопывания окружением. Симуляция сама снимает
 * плацдарм, когда иммунитет истёк ИЛИ кластер получил выход к морю/на свою землю
 * (окружение выключилось) — тогда таймер пропадает. Пушим подписи в WorldTextPass
 * через тот же канал, что и атакующие войска. Спека: airport.md.
 */
import { GameView } from "../../core/game/GameView";
import { Controller } from "../Controller";
import { GameView as WebGLGameView } from "../render/gl";
import type { AttackTroopLabel } from "../render/gl/passes/WorldTextPass";

// Янтарный — читается как таймер-предупреждение (#f5c442), тёмный контур даёт шейдер.
const R = 0xf5 / 255;
const G = 0xc4 / 255;
const B = 0x42 / 255;

export class BeachheadTimerController implements Controller {
  private labelBuf: AttackTroopLabel[] = [];

  constructor(
    private readonly game: GameView,
    private readonly view: WebGLGameView,
  ) {}

  getTickIntervalMs() {
    return 0; // каждый игровой тик (10Гц) — отсчёт меняется раз в секунду
  }

  tick() {
    const myPlayer = this.game.myPlayer();
    const beachheads = myPlayer?.airborneBeachheads();
    if (!beachheads || beachheads.length === 0) {
      if (this.labelBuf.length > 0) {
        this.labelBuf = [];
        this.view.setBeachheadLabels(this.labelBuf);
      }
      return;
    }

    const now = this.game.ticks();
    const ticksPerSecond = Math.max(
      1,
      Math.round(1000 / this.game.config().msPerTick()),
    );

    const out: AttackTroopLabel[] = [];
    for (const bh of beachheads) {
      const remaining = bh.expiryTick - now;
      if (remaining <= 0) continue;
      const seconds = Math.ceil(remaining / ticksPerSecond);
      out.push({
        x: this.game.x(bh.tile),
        y: this.game.y(bh.tile),
        text: String(seconds),
        colorR: R,
        colorG: G,
        colorB: B,
      });
    }

    this.labelBuf = out;
    this.view.setBeachheadLabels(out);
  }
}

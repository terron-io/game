import { Cell } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { TERRON_OURSKY_BLAST_DELAY_TICKS } from "../../../core/configuration/TerronTuning";
import { Controller } from "../../Controller";
import { TransformHandler } from "../../TransformHandler";

// terron: «Небо наше» — ВИЗУАЛЬНЫЙ ВЗЛЁТ ракеты. Screen-space (решение владельца:
// без ground-эффекта, чтобы не путать) — при запуске в точке эпицентра рождается
// ракета-«комета» и уходит ВВЕРХ за экран с хвостом-выхлопом. После запуска летит
// в экранных координатах, независимо от камеры (ракета покидает атмосферу).
// Триггер: satBlackoutRaw() сменил blastTick, и это СВЕЖИЙ запуск (не поздний
// join). Спека: new-units/NEBO.md
export class SatelliteLaunchFx implements Controller {
  private overlay: HTMLDivElement | null = null;
  private lastBlastTick: number | null = null;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {}

  init(): void {
    if (this.overlay) return;
    this.injectKeyframes();
    const o = document.createElement("div");
    o.style.cssText =
      "position:fixed;inset:0;z-index:1500;pointer-events:none;overflow:hidden";
    document.body.appendChild(o);
    this.overlay = o;
  }

  tick(): void {
    const b = this.game.satBlackoutRaw();
    if (b === null) return;
    if (b.blastTick === this.lastBlastTick) return;
    this.lastBlastTick = b.blastTick;
    // Только СВЕЖИЙ запуск анимируем (иначе на позднем join/резюме ракета
    // «взлетит» задним числом). Запуск = blastTick − задержка подрыва.
    const launchTick = b.blastTick - TERRON_OURSKY_BLAST_DELAY_TICKS;
    if (Math.abs(this.game.ticks() - launchTick) > 5) return;
    this.spawnRocket(this.game.x(b.epicenter), this.game.y(b.epicenter));
  }

  private spawnRocket(wx: number, wy: number): void {
    if (!this.overlay) return;
    const p = this.transformHandler.worldToScreenCoordinates(new Cell(wx, wy));
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return;

    const rocket = document.createElement("div");
    rocket.className = "terron-sat-rocket";
    rocket.style.left = `${p.x}px`;
    rocket.style.top = `${p.y}px`;
    rocket.addEventListener("animationend", () => rocket.remove());
    this.overlay.appendChild(rocket);
  }

  private injectKeyframes(): void {
    if (document.getElementById("terron-sat-rocket-kf")) return;
    const st = document.createElement("style");
    st.id = "terron-sat-rocket-kf";
    st.textContent = `
      .terron-sat-rocket {
        position: absolute;
        width: 6px;
        height: 44px;
        margin-left: -3px;
        margin-top: -22px;
        border-radius: 3px;
        /* Голова-ракета (свет) сверху, выхлоп (оранжевый→прозрачный) снизу. */
        background: linear-gradient(
          to bottom,
          rgba(255,255,255,1) 0%,
          rgba(210,225,255,0.95) 14%,
          rgba(255,180,80,0.85) 40%,
          rgba(255,120,40,0.5) 70%,
          rgba(255,90,20,0) 100%
        );
        box-shadow: 0 -2px 10px 3px rgba(180,210,255,0.85),
                    0 -1px 4px 1px rgba(255,255,255,0.9);
        transform-origin: 50% 0%;
        animation: terron-rocket-rise 1.35s cubic-bezier(0.35,0,0.7,1) forwards;
        will-change: transform, opacity;
      }
      @keyframes terron-rocket-rise {
        0%   { transform: translateY(0) scaleY(0.4); opacity: 0; }
        12%  { transform: translateY(-4vh) scaleY(1); opacity: 1; }
        70%  { opacity: 1; }
        100% { transform: translateY(-115vh) scaleY(1.6); opacity: 0; }
      }
    `;
    document.head.appendChild(st);
  }
}

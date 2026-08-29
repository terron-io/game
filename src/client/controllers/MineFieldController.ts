/**
 * terron: ультимейты — Минирование. Рендер-эффект для владельца ульты «Минирование»
 * (пассив: 50% морского десанта гибнет на минах). Пока штаб жив, вдоль СВОЕЙ границы
 * с водой рисуем РЕДКИЕ статичные морские мины В ВОДЕ (~десяток, без анимации/
 * мигания). Чисто визуал, состояние симуляции не трогаем.
 *
 * Как BunkerFireController: отдельный Canvas-2D поверх карты. Позиции мин считаем в
 * tick() (скан видимого вьюпорта со страйдом — реже танков), рисуем статично в draw().
 * Спека: new-units/ULTIMATES.md
 */
import { Cell, UnitType } from "../../core/game/Game";
import { GameView } from "../../core/game/GameView";
import { Controller } from "../Controller";
import { TransformHandler } from "../TransformHandler";

const POLL_MS = 700; // мины статичны — досеваем нечасто
const STRIDE = 4; // шаг скана вьюпорта (ищем берег)
const MIN_SPACING = 14; // минимум тайлов между минами (разрежённо)
const HARD_CAP = 40; // абсолютный предел
const SCREEN_MARGIN = 30;

export class MineFieldController implements Controller {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private glCanvas: HTMLElement | null = null;
  private active = false;
  private destroyed = false;
  private cssW = 0;
  private cssH = 0;
  // Мировые координаты тайлов-воды, где стоят мины.
  private mines: Array<[number, number]> = [];

  constructor(
    private readonly game: GameView,
    private readonly transformHandler: TransformHandler,
  ) {}

  init(): void {
    const c = document.createElement("canvas");
    c.style.cssText =
      "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:5;";
    this.canvas = c;
    this.ctx = c.getContext("2d");
    this.glCanvas = document.getElementById("webgl-debug-canvas");
    if (this.glCanvas && this.glCanvas.parentElement) {
      this.glCanvas.after(c);
    } else {
      document.body.appendChild(c);
    }
    const drive = () => {
      if (this.destroyed) return;
      if (this.glCanvas && !this.glCanvas.isConnected) {
        this.dispose();
        return;
      }
      this.draw();
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
  }

  getTickIntervalMs(): number {
    return POLL_MS;
  }

  tick(): void {
    const me = this.game.myPlayer();
    this.active = !!me && me.hasUltimate(UnitType.Mining);
    if (!me || !this.active) {
      this.mines = []; // ульта снята → мин нет
      return;
    }
    // Цель: ~10 на страну «5 минут» — масштаб от размера (∝ периметру ≈ √площади).
    const target = Math.max(
      4,
      Math.min(HARD_CAP, Math.round(Math.sqrt(me.numTilesOwned()) / 4)),
    );
    // ПЕРСИСТ: уже поставленные НЕ трогаем (не мигают). Досеваем новые вдоль
    // ВИДИМОГО берега, соблюдая интервал, пока не дойдём до цели.
    if (this.mines.length >= target) return;

    const meSmall = me.smallID();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const a = this.transformHandler.screenToWorldCoordinates(0, 0);
    const b = this.transformHandler.screenToWorldCoordinates(w, h);
    const minX = Math.floor(Math.min(a.x, b.x));
    const maxX = Math.ceil(Math.max(a.x, b.x));
    const minY = Math.floor(Math.min(a.y, b.y));
    const maxY = Math.ceil(Math.max(a.y, b.y));
    const sp2 = MIN_SPACING * MIN_SPACING;
    const farEnough = (x: number, y: number): boolean => {
      for (const [mx, my] of this.mines) {
        const dx = mx - x;
        const dy = my - y;
        if (dx * dx + dy * dy < sp2) return false;
      }
      return true;
    };

    for (let y = minY; y <= maxY && this.mines.length < target; y += STRIDE) {
      for (let x = minX; x <= maxX && this.mines.length < target; x += STRIDE) {
        if (!this.game.isValidCoord(x, y)) continue;
        const t = this.game.ref(x, y);
        if (!this.game.isLand(t)) continue;
        const o = this.game.owner(t);
        if (!o.isPlayer() || o.smallID() !== meSmall) continue;
        for (const n of this.game.neighbors(t)) {
          if (!this.game.isLand(n)) {
            const wx = this.game.x(n);
            const wy = this.game.y(n);
            if (farEnough(wx, wy)) this.mines.push([wx, wy]);
            break;
          }
        }
      }
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    const c = this.canvas;
    if (!ctx || !c) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.cssW !== w || this.cssH !== h) {
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.cssW = w;
      this.cssH = h;
    }
    ctx.clearRect(0, 0, w, h);
    if (!this.active || this.mines.length === 0) return;

    // Размер мины ∝ экранному размеру тайла (пропорционально зуму).
    const o0 = this.transformHandler.worldToScreenCoordinates(new Cell(0, 0));
    const o1 = this.transformHandler.worldToScreenCoordinates(new Cell(1, 0));
    const tilePx = Math.hypot(o1.x - o0.x, o1.y - o0.y);
    const r = Math.max(3, Math.min(16, tilePx * 0.9));

    for (const [wx, wy] of this.mines) {
      const s = this.transformHandler.worldToScreenCoordinates(new Cell(wx, wy));
      if (
        s.x < -SCREEN_MARGIN ||
        s.x > w + SCREEN_MARGIN ||
        s.y < -SCREEN_MARGIN ||
        s.y > h + SCREEN_MARGIN
      ) {
        continue;
      }
      this.drawMine(ctx, s.x, s.y, r);
    }
  }

  // Морская мина: тёмный шар + 8 шипов (статично, без анимации).
  private drawMine(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = "rgba(18,23,33,0.5)";
    ctx.fillStyle = "rgba(18,23,33,0.5)";
    ctx.lineWidth = Math.max(1.4, r * 0.32);
    ctx.lineCap = "round";
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * r * 0.85, y + Math.sin(ang) * r * 0.85);
      ctx.lineTo(x + Math.cos(ang) * r * 1.5, y + Math.sin(ang) * r * 1.5);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  dispose(): void {
    this.destroyed = true;
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
  }
}

// terron: ГОСТ МИРВа — когда игрок навёл слот МИРВ на территорию врага, она
// начинает покрываться ПЛАВАЮЩИМИ хаотичными кругами размером с ядерный взрыв —
// «вот эту страну сейчас разбомбит». Canvas-2D поверх карты (как
// BunkerFireController). У обычной ядерки гост есть, у МИРВ не было. ULTIMATES.md
import { Cell, UnitType } from "../../core/game/Game";
import { GameView, PlayerView } from "../../core/game/GameView";
import { EventBus } from "../../core/EventBus";
import { Controller } from "../Controller";
import { MouseMoveEvent, MouseOverEvent } from "../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";

const BLAST_R_TILES = 22; // ~размер ядерного взрыва (MIRVWarhead outer ≈ 18)
const DRIFT_TILES = 7; // амплитуда «плавания» круга (тайлы)
const SAMPLE_RADIUS = 130; // радиус выборки тайлов цели вокруг курсора (тайлы)
const SAMPLE_STEP = 2; // прореживание скана (дёшево)
// terron: сколько кругов рисовать = сколько боеголовок РЕАЛЬНО ляжет в эту зону.
// МИРВ раскидывает боеголовки с минимальным разбросом minimumSpread=55 (Manhattan)
// друг от друга (MIRVExecution.isOverlapping). Повторяем ту же укладку: круги
// не ближе WARHEAD_SPREAD — на малой территории влезает мало (перестало быть
// «пиздой»), на большой — до MAX_CIRCLES. Итог ≈ предсказанное число ракет.
const WARHEAD_SPREAD = 48; // мин. разброс между кругами (тайлы; sim=55, чуть плотнее)
const MAX_CIRCLES = 40; // потолок в видимой зоне (весь МИРВ до 350, но не в одном экране)
const PLACE_ATTEMPTS = 600; // попыток уложить круг с разбросом

interface Anchor {
  x: number;
  y: number;
  phase: number;
  spd: number;
}

export class MirvPreviewController implements Controller {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private glCanvas: HTMLElement | null = null;
  private destroyed = false;

  private cursorX = -1;
  private cursorY = -1;
  private targetSmallID: number | null = null;
  private anchors: Anchor[] = [];
  private lastSampleX = 0;
  private lastSampleY = 0;
  private cssW = 0;
  private cssH = 0;

  constructor(
    private readonly game: GameView,
    private readonly transformHandler: TransformHandler,
    private readonly uiState: UIState,
    private readonly eventBus: EventBus,
  ) {}

  init(): void {
    this.eventBus.on(MouseMoveEvent, (e) => {
      this.cursorX = e.x;
      this.cursorY = e.y;
    });
    this.eventBus.on(MouseOverEvent, (e) => {
      this.cursorX = e.x;
      this.cursorY = e.y;
    });

    const c = document.createElement("canvas");
    c.style.cssText =
      "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:6;";
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

  /** Раскидать NUM_CIRCLES якорей по тайлам ЦЕЛИ в радиусе вокруг курсора
   * (клиент не отдаёт полный список тайлов игрока — сканируем регион). */
  private resample(target: PlayerView, cx: number, cy: number): void {
    const owned: Array<[number, number]> = [];
    const r2 = SAMPLE_RADIUS * SAMPLE_RADIUS;
    for (let dy = -SAMPLE_RADIUS; dy <= SAMPLE_RADIUS; dy += SAMPLE_STEP) {
      for (let dx = -SAMPLE_RADIUS; dx <= SAMPLE_RADIUS; dx += SAMPLE_STEP) {
        if (dx * dx + dy * dy > r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.game.isValidCoord(x, y)) continue;
        const o = this.game.owner(this.game.ref(x, y));
        if (o.isPlayer() && (o as PlayerView).smallID() === target.smallID()) {
          owned.push([x, y]);
        }
      }
    }
    this.anchors = [];
    if (owned.length === 0) return;
    // Укладываем круги как боеголовки МИРВ: каждый новый — не ближе
    // WARHEAD_SPREAD (Manhattan) к уже поставленным. Число кругов = сколько
    // реально влезет = предсказанное число ракет в этой зоне (мелкая страна →
    // пара кругов, крупная → до MAX_CIRCLES). new-units/ULTIMATES.md
    for (
      let attempt = 0;
      attempt < PLACE_ATTEMPTS && this.anchors.length < MAX_CIRCLES;
      attempt++
    ) {
      const [x, y] = owned[Math.floor(Math.random() * owned.length)];
      let tooClose = false;
      for (const a of this.anchors) {
        if (Math.abs(x - a.x) + Math.abs(y - a.y) < WARHEAD_SPREAD) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      this.anchors.push({
        x,
        y,
        phase: Math.random() * Math.PI * 2,
        spd: 0.6 + Math.random() * 1.1,
      });
    }
  }

  private draw(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    if (this.cssW !== w || this.cssH !== h) {
      this.cssW = w;
      this.cssH = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Цель под курсором: слот МИРВ армирован + наведён на ЧУЖУЮ страну.
    const reset = () => {
      this.targetSmallID = null;
      this.anchors = [];
    };
    if (this.uiState.ghostStructure !== UnitType.MIRV || this.cursorX < 0) {
      reset();
      return;
    }
    const cell = this.transformHandler.screenToWorldCoordinates(
      this.cursorX,
      this.cursorY,
    );
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      reset();
      return;
    }
    const owner = this.game.owner(this.game.ref(cell.x, cell.y));
    const me = this.game.myPlayer();
    if (!owner.isPlayer() || !me || owner.smallID() === me.smallID()) {
      reset();
      return;
    }
    const target = owner as PlayerView;
    // Пересобираем якоря при смене цели ИЛИ значимом сдвиге курсора (круги
    // следуют за наведением); иначе — держим (плавают на месте).
    const drift =
      Math.abs(cell.x - this.lastSampleX) + Math.abs(cell.y - this.lastSampleY);
    if (
      target.smallID() !== this.targetSmallID ||
      drift > 40 ||
      this.anchors.length === 0
    ) {
      this.targetSmallID = target.smallID();
      this.lastSampleX = cell.x;
      this.lastSampleY = cell.y;
      this.resample(target, cell.x, cell.y);
    }
    if (this.anchors.length === 0) return;

    // Радиус круга в экранных пикселях: расстояние между двумя мировыми точками.
    const p0 = this.transformHandler.worldToScreenCoordinates(new Cell(0, 0));
    const p1 = this.transformHandler.worldToScreenCoordinates(
      new Cell(BLAST_R_TILES, 0),
    );
    const rPx = Math.max(4, Math.abs(p1.x - p0.x));

    const t = performance.now() / 1000;
    ctx.lineWidth = 2;
    for (const a of this.anchors) {
      // «Плавание»: круг дрейфует по синусоиде со своей фазой/скоростью.
      const dx = Math.sin(t * a.spd + a.phase) * DRIFT_TILES;
      const dy = Math.cos(t * a.spd * 0.9 + a.phase * 1.3) * DRIFT_TILES;
      const s = this.transformHandler.worldToScreenCoordinates(
        new Cell(a.x + dx, a.y + dy),
      );
      if (s.x < -rPx || s.x > w + rPx || s.y < -rPx || s.y > h + rPx) continue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, rPx, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,70,30,0.13)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,120,60,0.55)";
      ctx.stroke();
    }
  }

  dispose(): void {
    this.destroyed = true;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }
}

/**
 * terron: ультимейты — Укрепления. Рендер-эффект для владельца ульты «Укрепления»
 * (пассив: бункеры автозахватывают землю в радиусе защиты, см.
 * FortificationsExecution). Пока эффект жив, каждый ВИДИМЫЙ НА ЭКРАНЕ бункер
 * игрока «стреляет» тонкой 1px-трассой в тайл, который вот-вот заберёт — те же
 * цели, что берёт симуляция (ближайшие чужие/ничейные земельные тайлы в радиусе
 * защиты, примыкающие к нашей территории). Чисто визуал, состояние не трогаем.
 *
 * Как TankFrontController: отдельный Canvas-2D поверх карты (WebGL не трогаем),
 * жизненный цикл привязан к game-канвасу (webgl-debug-canvas). Цели считаем в
 * tick() ТОЛЬКО для бункеров на экране (дёшево — их немного), пули анимируем в
 * draw(). Спека: new-units/ULTIMATES.md
 */
import {
  TERRON_FORT_PERIOD_TICKS,
  TERRON_FORT_RANGE_MULT,
  TERRON_FORT_TILES_PER_PULSE,
} from "../../core/configuration/TerronTuning";
import { Cell, UnitType } from "../../core/game/Game";
import { GameView } from "../../core/game/GameView";
import { Controller } from "../Controller";
import { TransformHandler } from "../TransformHandler";

const POLL_MS = 250; // как часто проверяем, не пора ли залп (tick-интервал)
const FLIGHT_MS = 260; // пуля летит бункер → цель
const FLASH_MS = 130; // вспышка в тайле после попадания (= захват)
const MAX_BUNKERS = 24; // жёсткий кап на число бункеров в залпе
const MAX_BULLETS = 160; // жёсткий кап на пуль в залпе
const SCREEN_MARGIN = 40; // запас за краем экрана (px), чтоб не мигало на границе

// Одна пуля залпа: летит FLIGHT_MS, потом FLASH_MS — вспышка захвата, потом мертва.
interface Bullet {
  bx: number; // мир: бункер
  by: number;
  tx: number; // мир: цель (центроид кластера тайлов в одном направлении)
  ty: number;
  bornMs: number; // performance.now() старта полёта
  scale: number; // размер пули ∝ числу тайлов в кластере (одна пуля на сторону)
}

export class BunkerFireController implements Controller {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private glCanvas: HTMLElement | null = null;

  private active = false;
  private bullets: Bullet[] = [];
  private lastBurstTick = -Infinity; // game.ticks() последнего залпа
  private discOffsets: Array<[number, number]> = [];
  private destroyed = false;
  private cssW = 0;
  private cssH = 0;

  constructor(
    private readonly game: GameView,
    private readonly transformHandler: TransformHandler,
  ) {}

  init(): void {
    // Диск радиуса защиты, ближние тайлы первыми (как в FortificationsExecution).
    // +20% радиус (ульта Укрепления, эффект только у владельца — а контроллер и
    // работает лишь при hasUltimate). Совпадает с FortificationsExecution.
    const r = Math.round(
      this.game.config().defensePostRange() * TERRON_FORT_RANGE_MULT,
    );
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        this.discOffsets.push([dx, dy]);
      }
    }
    this.discOffsets.sort((a, b) => {
      const da = a[0] * a[0] + a[1] * a[1];
      const db = b[0] * b[0] + b[1] * b[1];
      if (da !== db) return da - db;
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0] - b[0];
    });

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
    this.active = !!me && me.hasUltimate(UnitType.Fortifications);
    if (!me || !this.active) {
      this.bullets = [];
      return;
    }

    // Дискретно: один ЗАЛП раз в такт захвата (TERRON_FORT_PERIOD_TICKS), не
    // непрерывный поток. Между залпами — пауза (пули к тому времени долетели).
    const nowTick = this.game.ticks();
    if (nowTick - this.lastBurstTick < TERRON_FORT_PERIOD_TICKS) return;
    this.lastBurstTick = nowTick;

    const meSmall = me.smallID();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const bornMs = performance.now();
    const bullets: Bullet[] = [];
    let bunkers = 0;
    for (const u of this.game.units(UnitType.DefensePost)) {
      if (bullets.length >= MAX_BULLETS || bunkers >= MAX_BUNKERS) break;
      if (!u.isActive() || u.isUnderConstruction()) continue;
      if (u.owner().smallID() !== meSmall) continue;

      const bx = this.game.x(u.tile());
      const by = this.game.y(u.tile());
      // Только бункеры, реально видимые в кадре — «навёлся камерой на территорию».
      const s = this.transformHandler.worldToScreenCoordinates(new Cell(bx, by));
      if (
        s.x < -SCREEN_MARGIN ||
        s.x > w + SCREEN_MARGIN ||
        s.y < -SCREEN_MARGIN ||
        s.y > h + SCREEN_MARGIN
      ) {
        continue;
      }

      // Цели, которые заберём (в направлении, куда ломаем фронт).
      const targets = this.nextTargets(me, meSmall, bx, by);
      if (targets.length === 0) continue;
      bunkers++;
      // Меньше пуль: группируем цели по НАПРАВЛЕНИЮ (8 секторов). Несколько тайлов
      // в одну сторону → ОДНА пуля побольше, летящая в центроид кластера.
      const sectors = new Map<number, { sx: number; sy: number; n: number }>();
      for (const [tx, ty] of targets) {
        const ang = Math.atan2(ty - by, tx - bx);
        const sec = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
        const acc = sectors.get(sec);
        if (acc) {
          acc.sx += tx;
          acc.sy += ty;
          acc.n++;
        } else {
          sectors.set(sec, { sx: tx, sy: ty, n: 1 });
        }
      }
      for (const { sx, sy, n } of sectors.values()) {
        bullets.push({
          bx,
          by,
          tx: sx / n,
          ty: sy / n,
          bornMs,
          scale: Math.min(3, 1 + 0.5 * (n - 1)),
        });
      }
    }
    this.bullets = bullets;
  }

  // Ближайшие тайлы, которые бункер вот-вот заберёт — зеркало
  // FortificationsExecution.pulse (read-only): чужая/ничейная земля в радиусе,
  // примыкающая к нашей территории.
  private nextTargets(
    me: NonNullable<ReturnType<GameView["myPlayer"]>>,
    meSmall: number,
    cx: number,
    cy: number,
  ): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const [dx, dy] of this.discOffsets) {
      if (out.length >= TERRON_FORT_TILES_PER_PULSE) break;
      const x = cx + dx;
      const y = cy + dy;
      if (!this.game.isValidCoord(x, y)) continue;
      const t = this.game.ref(x, y);
      if (!this.game.isLand(t)) continue;

      const owner = this.game.owner(t);
      if (owner.isPlayer()) {
        if (owner.smallID() === meSmall) continue;
        if (!owner.isAlive()) continue;
        if (me.isFriendly(owner)) continue;
      }

      // Примыкает ли к нашей территории (иначе бункер её пока не возьмёт).
      let borders = false;
      for (const n of this.game.neighbors(t)) {
        if (!this.game.isLand(n)) continue;
        const no = this.game.owner(n);
        if (no.isPlayer() && no.smallID() === meSmall) {
          borders = true;
          break;
        }
      }
      if (!borders) continue;
      out.push([x, y]);
    }
    return out;
  }

  private draw(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w !== this.cssW || h !== this.cssH) {
      this.cssW = w;
      this.cssH = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!this.active || this.bullets.length === 0) return;

    const now = performance.now();
    const base = Math.max(1, this.tilePx() * 0.5); // «1-пиксельная» пуля (мин 1px)
    const alive: Bullet[] = [];
    for (const bl of this.bullets) {
      const age = now - bl.bornMs;
      if (age >= FLIGHT_MS + FLASH_MS) continue; // отжила
      alive.push(bl);
      const dot = base * bl.scale; // крупнее для кластера тайлов в одну сторону

      const b = this.transformHandler.worldToScreenCoordinates(
        new Cell(bl.tx, bl.ty),
      );

      if (age < FLIGHT_MS) {
        // Фаза полёта: пуля летит бункер → цель.
        const a = this.transformHandler.worldToScreenCoordinates(
          new Cell(bl.bx, bl.by),
        );
        const p = age / FLIGHT_MS;
        const px = a.x + (b.x - a.x) * p;
        const py = a.y + (b.y - a.y) * p;
        if (px < -8 || px > w + 8 || py < -8 || py > h + 8) continue;
        // Короткая трасса-хвост за пулей.
        const qx = a.x + (b.x - a.x) * Math.max(0, p - 0.14);
        const qy = a.y + (b.y - a.y) * Math.max(0, p - 0.14);
        ctx.strokeStyle = "rgba(255,232,150,0.55)";
        ctx.lineWidth = dot;
        ctx.beginPath();
        ctx.moveTo(qx, qy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,244,196,0.95)";
        ctx.beginPath();
        ctx.arc(px, py, dot, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Фаза попадания: короткая затухающая вспышка в захваченном тайле.
        if (b.x < -8 || b.x > w + 8 || b.y < -8 || b.y > h + 8) continue;
        const f = 1 - (age - FLIGHT_MS) / FLASH_MS;
        ctx.globalAlpha = Math.max(0, f);
        ctx.fillStyle = "rgba(255,244,196,0.9)";
        ctx.beginPath();
        ctx.arc(b.x, b.y, dot * (1 + 1.6 * (1 - f)), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    this.bullets = alive;
  }

  private tilePx(): number {
    const a = this.transformHandler.worldToScreenCoordinates(new Cell(0, 0));
    const b = this.transformHandler.worldToScreenCoordinates(new Cell(1, 0));
    return Math.abs(b.x - a.x);
  }

  private dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.bullets = [];
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
  }
}

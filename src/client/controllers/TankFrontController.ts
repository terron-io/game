/**
 * terron: ультимейты — Танковый завод. Рендер-эффекты для владельца танков
 * (эффект работает, пока жив штаб «Танковый завод»):
 *
 *  #3 РЕДКО рисуем мелкие танки дулом К ВРАГУ вдоль АКТИВНОГО фронта — тайлов,
 *     которые прямо сейчас захватывают ИСХОДЯЩИЕ атаки игрока (кластеры фронта
 *     из воркера). Танки коротко живут и затухают.
 *  #4 Когда фронт игрока подходит к зоне защиты ВРАЖЕСКОГО бункера — рисуем
 *     иконку танка у бункера (танки игнорируют его защиту → «трещит»).
 *
 * Реализовано отдельным Canvas-2D поверх карты (WebGL-конвейер НЕ трогаем).
 * Активно только пока у игрока жив Танковый завод И есть исходящие атаки —
 * иначе ноль работы. Жизненный цикл привязан к game-канвасу (webgl-debug-canvas):
 * исчез (teardown матча) → сносим свой канвас и RAF. Спека: new-units/ULTIMATES.md
 */
import { assetUrl } from "../../core/AssetUrls";
import { Cell, UnitType } from "../../core/game/Game";
import { GameView } from "../../core/game/GameView";
import { Controller } from "../Controller";
import { TransformHandler } from "../TransformHandler";

const POLL_MS = 250; // как часто опрашиваем фронт (совпадает с tick-интервалом)
const SPAWN_MS = 550; // «редко»: не чаще одного танка раз в ~0.55с
const TTL_MS = 1300; // сколько живёт нарисованный танк
const FADE_IN_MS = 160;
const FADE_OUT_MS = 350;
const MAX_TANKS = 22; // жёсткий кап на число спрайтов
const TANK_TILES = 7; // размер танка ≈ N тайлов карты (масштабируется зумом)
const BUNKER_MARGIN = 12; // «фронт подошёл» = в пределах defensePostRange+margin
const MAX_BUNKER_MARKS = 6;
// Танк держим ПОЧТИ ГОРИЗОНТАЛЬНО: влево/вправо = зеркалим (как спрайт-анимация),
// вертикаль — лёгкий наклон дулом, КЛЭМП (не переворачиваем через вертикаль).
const MAX_TILT = 0.36; // ≈20°

const DIRS8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

interface Tank {
  wx: number;
  wy: number;
  angle: number;
  bornMs: number;
}
interface FrontPos {
  x: number;
  y: number;
  angle: number; // ориентация дулом к врагу (atan2, дефолт-facing танка = восток)
}

export class TankFrontController implements Controller {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private img = new Image();
  private imgReady = false;
  private glCanvas: HTMLElement | null = null;

  private hasTanks = false;
  private front: FrontPos[] = [];
  private bunkers: Array<{ x: number; y: number }> = [];
  private tanks: Tank[] = [];
  private polling = false;
  private lastSpawn = 0;
  private destroyed = false;
  private cssW = 0;
  private cssH = 0;

  constructor(
    private readonly game: GameView,
    private readonly transformHandler: TransformHandler,
  ) {}

  init(): void {
    this.img.onload = () => (this.imgReady = true);
    this.img.src = assetUrl("images/TankIconWhite.svg");

    const c = document.createElement("canvas");
    c.style.cssText =
      "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:5;";
    this.canvas = c;
    this.ctx = c.getContext("2d");
    this.glCanvas = document.getElementById("webgl-debug-canvas");
    // Кладём сразу над game-канвасом (он — firstChild body), но под HUD-панели.
    if (this.glCanvas && this.glCanvas.parentElement) {
      this.glCanvas.after(c);
    } else {
      document.body.appendChild(c);
    }

    const drive = () => {
      if (this.destroyed) return;
      // teardown матча снёс game-канвас → сносим и себя.
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
    this.hasTanks = !!me && me.hasUltimate(UnitType.TankFactory);
    if (!me || !this.hasTanks) {
      this.front = [];
      this.bunkers = [];
      return;
    }

    if (this.polling) return;
    const outIds = new Set(me.outgoingAttacks().map((a) => a.id));
    if (outIds.size === 0) {
      this.front = [];
      this.bunkers = [];
      return;
    }
    this.polling = true;
    void me
      .attackClusteredPositions()
      .then((attacks) => {
        const meSmall = me.smallID();
        const front: FrontPos[] = [];
        for (const { id, positions } of attacks) {
          if (!outIds.has(id)) continue; // только МОИ атаки (не входящие)
          for (const p of positions) {
            const angle = this.enemyAngle(p.x, p.y, meSmall);
            front.push({ x: p.x, y: p.y, angle });
          }
        }
        this.front = front;
        this.bunkers = this.computeBunkerMarks(front, me, meSmall);
      })
      .catch(() => {
        this.front = [];
        this.bunkers = [];
      })
      .finally(() => {
        this.polling = false;
      });
  }

  // Направление «к врагу» = сумма векторов к соседним тайлам, НЕ принадлежащим мне.
  private enemyAngle(x: number, y: number, meSmall: number): number {
    let sx = 0;
    let sy = 0;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.game.isValidCoord(nx, ny)) continue;
      const ref = this.game.ref(nx, ny);
      if (!this.game.isLand(ref)) continue;
      const o = this.game.owner(ref);
      const mine = o.isPlayer() && o.smallID() === meSmall;
      if (!mine) {
        sx += dx;
        sy += dy;
      }
    }
    if (sx === 0 && sy === 0) return 0;
    return Math.atan2(sy, sx);
  }

  // #4: вражеские бункеры, к чьей зоне защиты подошёл фронт.
  private computeBunkerMarks(
    front: FrontPos[],
    me: NonNullable<ReturnType<GameView["myPlayer"]>>,
    meSmall: number,
  ): Array<{ x: number; y: number }> {
    if (front.length === 0) return [];
    const range = this.game.config().defensePostRange() + BUNKER_MARGIN;
    const range2 = range * range;
    const out: Array<{ x: number; y: number }> = [];
    for (const u of this.game.units(UnitType.DefensePost)) {
      if (!u.isActive()) continue;
      const o = u.owner();
      if (o.smallID() === meSmall || me.isFriendly(o)) continue; // только врага
      const bx = this.game.x(u.tile());
      const by = this.game.y(u.tile());
      for (const f of front) {
        const dx = f.x - bx;
        const dy = f.y - by;
        if (dx * dx + dy * dy <= range2) {
          out.push({ x: bx, y: by });
          break;
        }
      }
      if (out.length >= MAX_BUNKER_MARKS) break;
    }
    return out;
  }

  private tilePx(): number {
    // Размер одного тайла карты в экранных (CSS) пикселях — через две точки,
    // чтобы не зависеть от внутренней математики масштаба.
    const a = this.transformHandler.worldToScreenCoordinates(new Cell(0, 0));
    const b = this.transformHandler.worldToScreenCoordinates(new Cell(1, 0));
    return Math.abs(b.x - a.x);
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

    if (!this.hasTanks || !this.imgReady) {
      if (this.tanks.length) this.tanks = [];
      return;
    }

    const now = performance.now();
    const tsize = this.tilePx();

    // Спавн — редко, у случайной точки активного фронта.
    if (
      this.front.length > 0 &&
      this.tanks.length < MAX_TANKS &&
      now - this.lastSpawn >= SPAWN_MS
    ) {
      const f = this.front[(Math.random() * this.front.length) | 0];
      this.tanks.push({
        wx: f.x + (Math.random() - 0.5) * 2,
        wy: f.y + (Math.random() - 0.5) * 2,
        angle: f.angle,
        bornMs: now,
      });
      this.lastSpawn = now;
    }

    // Танки на фронте (#3).
    const size = Math.max(10, tsize * TANK_TILES);
    const alive: Tank[] = [];
    for (const t of this.tanks) {
      const age = now - t.bornMs;
      if (age >= TTL_MS) continue;
      alive.push(t);
      const alpha =
        age < FADE_IN_MS
          ? age / FADE_IN_MS
          : age > TTL_MS - FADE_OUT_MS
            ? (TTL_MS - age) / FADE_OUT_MS
            : 1;
      const s = this.transformHandler.worldToScreenCoordinates(
        new Cell(t.wx, t.wy),
      );
      if (s.x < -size || s.x > w + size || s.y < -size || s.y > h + size) {
        continue; // за экраном — не рисуем, но живёт
      }
      this.drawTank(ctx, s.x, s.y, size, t.angle, alpha * 0.9);
    }
    this.tanks = alive;

    // Иконки у бункеров (#4) — мягкий пульс.
    if (this.bunkers.length > 0) {
      const pulse = 0.55 + 0.25 * Math.sin(now / 260);
      const bsize = Math.max(9, tsize * 5);
      for (const b of this.bunkers) {
        const s = this.transformHandler.worldToScreenCoordinates(
          new Cell(b.x, b.y),
        );
        if (s.x < -bsize || s.x > w + bsize || s.y < -bsize || s.y > h + bsize) {
          continue;
        }
        this.drawTank(ctx, s.x, s.y - bsize, bsize, 0, pulse);
      }
    }
  }

  private drawTank(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    angle: number,
    alpha: number,
  ): void {
    // Спрайт танка нарисован в профиль дулом ВПРАВО, башня сверху. Держим его
    // горизонтально: смотрит влево → ЗЕРКАЛИМ по X (не крутим на 180° — иначе
    // башня оказывается снизу). Вертикаль — только лёгкий наклон дулом, клэмп.
    const faceLeft = Math.cos(angle) < 0;
    let tilt = Math.atan2(-Math.sin(angle), Math.abs(Math.cos(angle)));
    tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, tilt)); // + = дулом вверх
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(x, y);
    if (faceLeft) ctx.scale(-1, 1);
    ctx.rotate(-tilt);
    // тёмная подложка для читаемости белого танка на светлой территории
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = size * 0.12;
    ctx.drawImage(this.img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  private dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.tanks = [];
    this.front = [];
    this.bunkers = [];
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
  }
}

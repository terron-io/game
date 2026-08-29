/**
 * terron: ультимейты — РАСКОЛ. Превью «флага» под курсором.
 *
 * Пока выбран ghost раскола (uiState.ghostStructure === UnitType.Split), рисуем
 * поверх карты прямоугольник будущего флага (размер = от вложенных войск, как в
 * SplitExecution) с буквой Т: КРАСНАЯ основа = «отвалится боту-сепаратисту»,
 * ЗЕЛЁНАЯ Т = «останется тебе». Так видно, что именно откалывается, ДО клика.
 *
 * Отдельный Canvas-2D поверх карты (WebGL не трогаем), как TankFrontController /
 * BunkerFireController. Работает только пока активен ghost раскола — иначе холст
 * чист. Жизненный цикл привязан к game-канвасу (webgl-debug-canvas): исчез
 * (teardown матча) → сносим свой холст и RAF. Спека: new-units/SPLIT.md
 */
import {
  TERRON_BLOCKADE_PORT_RANGE,
  TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS,
  TERRON_INDUSTRIAL_TICKS,
  TERRON_PIRACY_SHIP_COOLDOWN_TICKS,
  TERRON_RAILGUN_RANGE,
  TERRON_SPLIT_ASPECT_H,
  TERRON_SPLIT_ASPECT_W,
} from "../../core/configuration/TerronTuning";
import { EventBus } from "../../core/EventBus";
import {
  blockadeFlagSize,
  blockadeWave,
} from "../../core/game/BlockadeGeometry";
import { CAPITAL_RU, capitalLabel } from "../../core/game/CapitalNames";
import {
  Cell,
  TimedBuffs,
  TradeHubs,
  Ultimates,
  UnitType,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import type { UnitView } from "../../core/game/GameView";
import { GameView, PlayerView } from "../../core/game/GameView";
import { splitHalfHeight, splitTShape } from "../../core/game/SplitGeometry";
import { Controller } from "../Controller";
import { RELOADING_TYPES, unitCooldown } from "../Cooldowns";
import { MouseMoveEvent } from "../InputHandler";
import { predictRailPaths, RAIL_STATION_GHOSTS } from "../RailGhostPreview";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { getCurrentLang, translateText } from "../Utils";
import { blockadeShipsToSend } from "./BlockadeUi";

/** За сколько тиков до запуска Космодром начинает дымить (≈5 секунд). */
const SPACEPORT_IGNITION_TICKS = 50;
/** Сколько миллисекунд длится сам полёт ракеты вверх. */
const SPACEPORT_FLIGHT_MS = 3800;
/** На сколько пикселей ракета успевает подняться. */
const SPACEPORT_RISE_PX = 420;

/** Длительность одного цикла анимации наводки Доры, мс. */
const AIM_MS = 2000;

export class SplitPreviewController implements Controller {
  private canvas: HTMLCanvasElement | null = null;
  /** terron: буфер под объединение кругов зоны Доры (см. drawRailGunReach). */
  private reachBuffer: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private glCanvas: HTMLElement | null = null;
  private readonly mousePos = { x: 0, y: 0 };
  private destroyed = false;
  private cssW = 0;
  private cssH = 0;
  // terron: RAF крутится 60 fps, а содержимое меняется раз в тик (10 Гц) или с
  // камерой/мышью. Помним «снимок» входов и пропускаем кадр, если он не
  // изменился; drewLast — чтобы не делать clearRect полноэкранного холста
  // впустую, когда и прошлый, и этот кадр пустые.
  private drewLast = false;
  private lastTick = -1;
  private lastScale = NaN;
  private lastOffX = NaN;
  private lastOffY = NaN;
  private lastMouseX = NaN;
  private lastMouseY = NaN;
  private lastGhost: UIState["ghostStructure"] | undefined = undefined;
  private lastRatio = NaN;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly uiState: UIState,
    private readonly transformHandler: TransformHandler,
  ) {}

  init(): void {
    this.eventBus.on(MouseMoveEvent, (e) => {
      this.mousePos.x = e.x;
      this.mousePos.y = e.y;
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

  private tilePx(): number {
    const a = this.transformHandler.worldToScreenCoordinates(new Cell(0, 0));
    const b = this.transformHandler.worldToScreenCoordinates(new Cell(1, 0));
    return Math.abs(b.x - a.x);
  }

  // Экранный прямоугольник, покрывающий тайлы [x0..x1]×[y0..y1] (включительно).
  private tileRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): { x: number; y: number; w: number; h: number } {
    const p0 = this.transformHandler.worldToScreenCoordinates(new Cell(x0, y0));
    const p1 = this.transformHandler.worldToScreenCoordinates(
      new Cell(x1 + 1, y1 + 1),
    );
    return {
      x: Math.min(p0.x, p1.x),
      y: Math.min(p0.y, p1.y),
      w: Math.abs(p1.x - p0.x),
      h: Math.abs(p1.y - p0.y),
    };
  }

  private draw(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const resized = w !== this.cssW || h !== this.cssH;

    // Гейт на изменение входов: тик, камера, ghost-состояние, мышь (только пока
    // тянем превью раскола — иначе курсор ни на что не влияет).
    const th = this.transformHandler;
    const tick = this.game.ticks();
    const ghost = this.uiState.ghostStructure;
    // terron: ПИРАТСТВО — превью флага блокады под курсором, как у Раскола.
    const splitGhost =
      ghost === UnitType.Split ||
      ghost === UnitType.Blockade ||
      // terron 24.08: гост-рельсы станций тоже следуют за мышью.
      (ghost !== null && RAIL_STATION_GHOSTS.has(ghost));
    // terron 23.08: НАВОДКА — анимация сводящегося круга на цели Доры. Она
    // живёт во времени, а не в тиках, поэтому пока приказ выполняется, гейт
    // «перерисовывать только при изменениях» обязан пропускать каждый кадр.
    const aiming = this.railGunAiming();
    // terron 23.08: КОСМОДРОМ — предстартовый дым и полёт ракеты живут во
    // ВРЕМЕНИ, а не в тиках: пока идёт анимация, гейт «перерисовывать только
    // при изменениях» обязан пропускать каждый кадр.
    const spaceport = this.spaceportAnimating();
    const changed =
      resized ||
      aiming ||
      spaceport ||
      tick !== this.lastTick ||
      th.scale !== this.lastScale ||
      th.offsetX !== this.lastOffX ||
      th.offsetY !== this.lastOffY ||
      ghost !== this.lastGhost ||
      (splitGhost &&
        (this.mousePos.x !== this.lastMouseX ||
          this.mousePos.y !== this.lastMouseY ||
          this.uiState.attackRatio !== this.lastRatio));
    if (!changed) return;
    this.lastTick = tick;
    this.lastScale = th.scale;
    this.lastOffX = th.offsetX;
    this.lastOffY = th.offsetY;
    this.lastGhost = ghost;
    this.lastMouseX = this.mousePos.x;
    this.lastMouseY = this.mousePos.y;
    this.lastRatio = this.uiState.attackRatio;

    if (resized) {
      this.cssW = w;
      this.cssH = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      this.drewLast = false; // смена размера и так обнуляет холст
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.drewLast) ctx.clearRect(0, 0, w, h);

    let drew = false;
    // Цифра-таймер спасения Т — рисуется ВСЕГДА, пока активен маркер (после раскола),
    // независимо от ghost-превью под курсором.
    drew = this.drawRescueTimer(ctx) || drew;

    // terron: таймеры самоуничтожения ЗАХВАЧЕННЫХ чужих ульт (та же жёлтая
    // цифра, что таймер спасения Т) — над каждым тикающим зданием.
    drew = this.drawStructureTimers(ctx) || drew;
    // terron: ДОРА — куда орудие сможет достать ПОСЛЕ переезда.
    drew = this.drawRailGunReach(ctx) || drew;
    // terron: ДОРА — «сюда прилетит через N секунд» по принятому приказу.
    drew = this.drawRailGunTelegraph(ctx) || drew;

    // terron: СТОЛИЦЫ — имя столицы золотым над городом (реальная столица у наций,
    // рандом у игроков). Спека: CAPITALS.md
    drew = this.drawWalkPaths(ctx) || drew;
    drew = this.drawCapitalNames(ctx) || drew;

    drew = this.drawSplitPreview(ctx) || drew;
    drew = this.drawRailGhostPreview(ctx) || drew;
    // terron: ПИРАТСТВО — зоны блокады (флаги) видят все; превью под курсором.
    drew = this.drawBlockadeZones(ctx) || drew;
    drew = this.drawBlockadePreview(ctx) || drew;
    // terron: КОСМОДРОМ — разгон (дым) и уходящая вверх ракета.
    drew = this.drawSpaceportLaunch(ctx) || drew;
    this.drewLast = drew;
  }

  // terron: ПИРАТСТВО — контур реющего флага (без древка): верх/низ — синусоида
  // той же формулы, что в BlockadeGeometry.inBlockadeFlag (сим и рисунок
  // обязаны совпадать). Рисуем в экранных координатах полигоном по 24 точкам.
  private flagPath(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    hh: number,
    hw: number,
  ): void {
    const th = this.transformHandler;
    const pt = (x: number, y: number) =>
      th.worldToScreenCoordinates(new Cell(x, y));
    const N = 24;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const dx = -hw + (2 * hw * i) / N;
      const wave = blockadeWave(dx, hh, hw);
      const p = pt(cx + dx, cy - hh + wave);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = N; i >= 0; i--) {
      const dx = -hw + (2 * hw * i) / N;
      const wave = blockadeWave(dx, hh, hw);
      const p = pt(cx + dx, cy + hh + wave);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  // ═══ terron 23.08 — КОСМОДРОМ: ЗРЕЛИЩЕ ЗАПУСКА ═══════════════════════════
  //
  // Владелец: «постарайся более „ракета полетела“ — помедленнее, старт секунд
  // за 5 до взлёта, разгон, дым пошёл».
  //
  // ⚠️ Всё считается ИЗ ОТКАТА ПЛОЩАДКИ, который и так едет клиенту (очередь
  // юнита). Ни одного нового сообщения по сети: и момент старта, и фаза
  // разгона выводятся у каждого клиента одинаково, как и циферблат.
  private readonly spaceportFx = new Map<
    number,
    { prevRemaining: number; launchMs: number }
  >();

  /** Идёт ли сейчас дым/полёт хоть у одной площадки (для гейта перерисовки). */
  private spaceportAnimating(): boolean {
    const now = performance.now();
    for (const u of this.game.units(UnitType.Spaceport)) {
      const fx = this.spaceportFx.get(u.id());
      if (fx !== undefined && now - fx.launchMs < SPACEPORT_FLIGHT_MS) {
        return true;
      }
      const cd = unitCooldown(this.game, u);
      if (cd !== null && cd.remaining <= SPACEPORT_IGNITION_TICKS) return true;
    }
    return false;
  }

  private drawSpaceportLaunch(ctx: CanvasRenderingContext2D): boolean {
    const ports = this.game.units(UnitType.Spaceport);
    if (ports.length === 0) return false;
    const now = performance.now();
    const tsize = this.tilePx();
    let drew = false;

    for (const u of ports) {
      const cd = unitCooldown(this.game, u);
      const remaining = cd?.remaining ?? 0;
      const fx = this.spaceportFx.get(u.id()) ?? {
        prevRemaining: remaining,
        launchMs: -1e9,
      };
      // ⚠️ Откат ВЫРОС — значит запуск состоялся и площадка встала на новый
      // цикл. Первая версия требовала ещё и `prevRemaining > 0`, а на последнем
      // тике перед стартом откат уже ноль (`unitCooldown` отдаёт null) — из-за
      // этого момент запуска не ловился НИКОГДА и ракета не взлетала
      // (репорт владельца «вверх ничего не улетело»).
      if (remaining > fx.prevRemaining + 5) {
        fx.launchMs = now;
      }
      fx.prevRemaining = remaining;
      this.spaceportFx.set(u.id(), fx);

      const p = this.transformHandler.worldToScreenCoordinates(
        new Cell(this.game.x(u.tile()), this.game.y(u.tile())),
      );
      const scale = Math.max(6, Math.min(28, tsize * 5));

      // ФАЗА 1 — разгон: последние секунды перед стартом клубится дым.
      if (remaining > 0 && remaining <= SPACEPORT_IGNITION_TICKS) {
        const heat = 1 - remaining / SPACEPORT_IGNITION_TICKS; // 0…1
        ctx.save();
        for (let i = 0; i < 5; i++) {
          const phase = (now / 420 + i * 0.37) % 1;
          const r = scale * (0.25 + phase * 0.9) * (0.5 + heat);
          const dx = Math.sin((i * 2.1 + phase) * Math.PI * 2) * scale * 0.45;
          ctx.globalAlpha = (1 - phase) * 0.45 * (0.35 + heat);
          ctx.fillStyle = "rgba(235, 235, 245, 1)";
          ctx.beginPath();
          ctx.arc(
            p.x + dx,
            p.y + scale * 0.55 + phase * scale * 0.4,
            r,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.restore();
        drew = true;
      }

      // ФАЗА 2 — полёт: ракета медленно уходит вверх, за ней столб дыма.
      const t = now - fx.launchMs;
      if (t >= 0 && t < SPACEPORT_FLIGHT_MS) {
        const k = t / SPACEPORT_FLIGHT_MS; // 0…1
        const rise = k * k * SPACEPORT_RISE_PX; // разгон с ускорением
        const y = p.y - rise;
        const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
        ctx.save();
        // Дымный столб от площадки до ракеты.
        for (let i = 0; i < 8; i++) {
          const f = i / 8;
          const sy = p.y - rise * f;
          ctx.globalAlpha = 0.32 * (1 - f) * fade;
          ctx.fillStyle = "rgba(240, 240, 248, 1)";
          ctx.beginPath();
          ctx.arc(
            p.x + Math.sin(f * 6 + now / 600) * scale * 0.3,
            sy,
            scale * (0.5 + f * 0.55),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        // Сама ракета: корпус, нос, факел.
        const rw = Math.max(2, scale * 0.22);
        const rh = Math.max(6, scale * 0.75);
        ctx.globalAlpha = fade;
        ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
        ctx.strokeStyle = "rgba(25, 20, 10, 0.85)";
        ctx.lineWidth = Math.max(1, scale * 0.06);
        ctx.beginPath();
        ctx.moveTo(p.x, y - rh);
        ctx.lineTo(p.x + rw, y - rh * 0.45);
        ctx.lineTo(p.x + rw, y);
        ctx.lineTo(p.x - rw, y);
        ctx.lineTo(p.x - rw, y - rh * 0.45);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(255, 190, 90, 0.95)";
        ctx.beginPath();
        ctx.moveTo(p.x - rw * 0.8, y);
        ctx.lineTo(p.x + rw * 0.8, y);
        ctx.lineTo(p.x, y + rh * (0.5 + 0.25 * Math.sin(now / 60)));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        drew = true;
      }
    }

    // Чистим память по исчезнувшим площадкам.
    if (this.spaceportFx.size > ports.length) {
      const alive = new Set(ports.map((u) => u.id()));
      for (const id of this.spaceportFx.keys()) {
        if (!alive.has(id)) this.spaceportFx.delete(id);
      }
    }
    return drew;
  }

  private drawBlockadeZones(ctx: CanvasRenderingContext2D): boolean {
    const zones = this.game.blockades();
    if (zones.length === 0) return false;
    const tsize = this.tilePx();
    if (tsize <= 0) return false;
    const me = this.game.myPlayer();
    for (const z of zones) {
      const owner = this.game.playerBySmallID(z.ownerSmallID);
      const friendly =
        me !== null &&
        owner !== undefined &&
        owner.isPlayer() &&
        (owner === me || me.isFriendly(owner as PlayerView));
      const cx = this.game.x(z.tile);
      const cy = this.game.y(z.tile);
      ctx.save();
      this.flagPath(ctx, cx, cy, z.hh, z.hw);
      // terron 23.08: ЗАЯВЛЕННАЯ зона (лодки ещё в пути) — только контур,
      // бегущим пунктиром и бледнее. Работающая — с заливкой. Раньше между
      // «ткнул» и «сработало» не было НИКАКОЙ обратной связи: владелец писал
      // «нихуя не понятно, активировался скилл или нет».
      if (!z.pending) {
        ctx.fillStyle = friendly
          ? "rgba(40, 120, 220, 0.16)"
          : "rgba(220, 40, 40, 0.18)";
        ctx.fill();
      }
      ctx.setLineDash([Math.max(4, tsize * 1.2), Math.max(3, tsize)]);
      if (z.pending) {
        ctx.lineDashOffset = -((performance.now() / 55) % 1000);
      }
      ctx.lineWidth = Math.max(1.5, tsize * (z.pending ? 0.18 : 0.25));
      ctx.globalAlpha = z.pending ? 0.65 : 1;
      ctx.strokeStyle = friendly
        ? "rgba(80, 160, 255, 0.95)"
        : "rgba(240, 60, 60, 0.95)";
      ctx.stroke();
      ctx.restore();
      if (z.pending) {
        this.drawBlockadeSailing(ctx, z, cx, cy, friendly);
      } else {
        this.drawZoneLifetime(ctx, z, cx, cy, friendly);
      }
    }
    return true;
  }

  /**
   * terron 23.08: трассы лодок, идущих на точку блокады, + подпись «сбор N».
   * Пунктир от каждой своей лодки с миссией (subState 5) к центру заявки —
   * видно, что приказ принят и кто именно поплыл.
   */
  private drawBlockadeSailing(
    ctx: CanvasRenderingContext2D,
    z: { ownerSmallID: number },
    cx: number,
    cy: number,
    friendly: boolean,
  ): void {
    const tsize = this.tilePx();
    const center = this.transformHandler.worldToScreenCoordinates(
      new Cell(cx, cy),
    );
    const color = friendly
      ? "rgba(120, 190, 255, 0.85)"
      : "rgba(250, 130, 120, 0.75)";
    let sailing = 0;
    ctx.save();
    ctx.setLineDash([Math.max(3, tsize), Math.max(3, tsize)]);
    ctx.lineDashOffset = (performance.now() / 45) % 1000;
    ctx.lineWidth = Math.max(1, tsize * 0.16);
    ctx.strokeStyle = color;
    for (const u of this.game.units(UnitType.Warship)) {
      if (u.subState() !== 5) continue;
      const owner = u.owner();
      if (!owner.isPlayer() || owner.smallID() !== z.ownerSmallID) continue;
      sailing++;
      const p = this.transformHandler.worldToScreenCoordinates(
        new Cell(this.game.x(u.tile()), this.game.y(u.tile())),
      );
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(center.x, center.y);
      ctx.stroke();
    }
    ctx.restore();

    const fontPx = Math.max(11, Math.min(26, tsize * 5));
    ctx.save();
    ctx.font = `800 ${fontPx}px Oswald, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, fontPx * 0.14);
    ctx.strokeStyle = "rgba(15, 12, 4, 0.92)";
    ctx.fillStyle = color;
    const text = translateText("events_display.blockade_forming", {
      count: String(sailing),
    });
    ctx.strokeText(text, center.x, center.y);
    ctx.fillText(text, center.x, center.y);
    ctx.restore();
  }

  /**
   * terron 23.08 (просьба владельца «таймер на сам флаг, сколько он ещё
   * проживёт»): отсчёт жизни зоны в её центре. Секунды считаем ТЕМ ЖЕ
   * способом, что и остальные отсчёты в игре (client/Cooldowns.ts): тик
   * исчезновения минус текущий, поделить на длину тика.
   */
  private drawZoneLifetime(
    ctx: CanvasRenderingContext2D,
    z: { tile: number; expiresAt: number },
    cx: number,
    cy: number,
    friendly: boolean,
  ): void {
    const left = z.expiresAt - this.game.ticks();
    if (left <= 0) return;
    const seconds = Math.ceil((left * this.game.config().msPerTick()) / 1000);
    const p = this.transformHandler.worldToScreenCoordinates(new Cell(cx, cy));
    const fontPx = Math.max(12, Math.min(30, this.tilePx() * 6));
    ctx.save();
    ctx.font = `800 ${fontPx}px Oswald, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, fontPx * 0.14);
    ctx.strokeStyle = "rgba(15, 12, 4, 0.92)";
    ctx.fillStyle = friendly
      ? "rgba(150, 205, 255, 0.98)"
      : "rgba(255, 170, 160, 0.98)";
    const text = `${seconds}\u0441`;
    ctx.strokeText(text, p.x, p.y);
    ctx.fillText(text, p.x, p.y);
    ctx.restore();
  }

  private drawBlockadePreview(ctx: CanvasRenderingContext2D): boolean {
    if (this.uiState.ghostStructure !== UnitType.Blockade) return false;
    const me = this.game.myPlayer();
    if (!me || !me.isAlive()) return false;
    const ships = blockadeShipsToSend(this.game, this.uiState.attackRatio);
    const { hh, hw } = blockadeFlagSize(Math.max(1, ships));
    const center = this.transformHandler.screenToWorldCoordinates(
      this.mousePos.x,
      this.mousePos.y,
    );
    const tsize = this.tilePx();
    if (tsize <= 0) return false;
    ctx.save();
    this.flagPath(ctx, center.x, center.y, hh, hw);
    ctx.fillStyle = "rgba(40, 120, 220, 0.2)";
    ctx.fill();
    ctx.setLineDash([Math.max(4, tsize * 1.2), Math.max(3, tsize)]);
    ctx.lineWidth = Math.max(1.5, tsize * 0.25);
    ctx.strokeStyle = "rgba(80, 160, 255, 0.95)";
    ctx.stroke();
    // Подпись: сколько лодок уйдёт.
    const p = this.transformHandler.worldToScreenCoordinates(
      new Cell(center.x, center.y),
    );
    ctx.setLineDash([]);
    ctx.font = `bold ${Math.max(12, tsize * 1.6)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 3;
    ctx.strokeText(`⛵ ${ships}`, p.x, p.y);
    ctx.fillText(`⛵ ${ships}`, p.x, p.y);
    ctx.restore();
    return true;
  }

  // terron 24.08: ГОСТ-РЕЛЬСЫ (решение владельца «отображай сразу, серые»).
  // Пока висит гост станции (город/фабрика/порт/депо), рисуем серым пунктиром
  // нитки рельсов, которые построятся к соседним станциям. Предсказание — тем
  // же пафайндером, что у сима (RailGhostPreview), кэш по снап-тайлу госта.
  private railGhostTile: TileRef | null = null;
  private railGhostPaths: TileRef[][] = [];

  private drawRailGhostPreview(ctx: CanvasRenderingContext2D): boolean {
    const ghost = this.uiState.ghostStructure;
    if (ghost === null || !RAIL_STATION_GHOSTS.has(ghost)) {
      this.railGhostTile = null;
      return false;
    }
    // 24.08 (репорт владельца «если примагнитило апгрейдом — не рисуй»):
    // рельсы рисуем только когда клик даст НОВУЮ постройку. Апгрейд рельсов
    // не тянет, невалидное место — тем более. undefined = гост ещё считается.
    if (this.uiState.ghostPlacement !== "build") {
      this.railGhostTile = null;
      return false;
    }
    const me = this.game.myPlayer();
    if (!me || !me.isAlive()) return false;
    // Считаем от ФАКТИЧЕСКОГО тайла постройки (магнит-снап), а не от мыши —
    // иначе нитка стартовала из-под курсора и прыгала при переключении снапа.
    let ref = this.uiState.ghostBuildTile;
    if (ref === undefined) {
      const w = this.transformHandler.screenToWorldCoordinates(
        this.mousePos.x,
        this.mousePos.y,
      );
      if (!this.game.isValidCoord(w.x, w.y)) return false;
      ref = this.game.ref(w.x, w.y);
    }
    if (ref !== this.railGhostTile) {
      this.railGhostTile = ref;
      this.railGhostPaths = predictRailPaths(this.game, ref, ghost);
    }
    if (this.railGhostPaths.length === 0) return false;
    const tsize = this.tilePx();
    if (tsize <= 0) return false;
    ctx.save();
    // Серые, чтобы отличать будущие рельсы от построенных (просьба владельца).
    ctx.strokeStyle = "rgba(85,85,85,0.7)";
    ctx.lineWidth = Math.max(1.5, tsize * 0.45);
    ctx.setLineDash([tsize * 1.2, tsize * 0.8]);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const path of this.railGhostPaths) {
      ctx.beginPath();
      for (let i = 0; i < path.length; i++) {
        const t = path[i];
        const p = this.transformHandler.worldToScreenCoordinates(
          new Cell(this.game.x(t), this.game.y(t)),
        );
        const px = p.x + tsize / 2;
        const py = p.y + tsize / 2;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  // Превью флага раскола под курсором. Возвращает true, если что-то нарисовано.
  private drawSplitPreview(ctx: CanvasRenderingContext2D): boolean {
    if (this.uiState.ghostStructure !== UnitType.Split) return false;
    const me = this.game.myPlayer();
    if (!me || !me.isAlive()) return false;

    // Размер флага = ТОЛЬКО от доли атаки (процента), не от абсолюта войск;
    // площадь — доля СУШИ КАРТЫ (06.08), число суши то же, что у движка.
    const hh = splitHalfHeight(
      this.uiState.attackRatio,
      this.game.numLandTiles(),
    );
    const hw = Math.floor((hh * TERRON_SPLIT_ASPECT_W) / TERRON_SPLIT_ASPECT_H);

    const center = this.transformHandler.screenToWorldCoordinates(
      this.mousePos.x,
      this.mousePos.y,
    );
    const cx = center.x;
    const cy = center.y;

    // Геометрия Т (та же, что в движке): внутри флага, с рамкой основы вокруг.
    const shape = splitTShape(hh, hw);

    const tsize = this.tilePx();
    if (tsize <= 0) return false;

    // Основа (красная): «отколется в независимую нацию».
    const base = this.tileRect(cx - hw, cy - hh, cx + hw, cy + hh);
    ctx.save();
    ctx.fillStyle = "rgba(220, 60, 40, 0.22)";
    ctx.fillRect(base.x, base.y, base.w, base.h);
    ctx.setLineDash([Math.max(4, tsize * 1.2), Math.max(3, tsize)]);
    ctx.lineWidth = Math.max(1.5, tsize * 0.25);
    ctx.strokeStyle = "rgba(230, 70, 45, 0.95)";
    ctx.strokeRect(base.x, base.y, base.w, base.h);
    ctx.restore();

    // Буква Т (зелёная): «останется владельцу». Перекладина (короткие уши) + ножка.
    const bar = this.tileRect(
      cx - shape.earHalf,
      cy + shape.innerTop,
      cx + shape.earHalf,
      cy + shape.innerTop + shape.barThick - 1,
    );
    const stem = this.tileRect(
      cx - shape.stemHalf,
      cy + shape.innerTop,
      cx + shape.stemHalf,
      cy + shape.innerBottom,
    );
    ctx.save();
    ctx.fillStyle = "rgba(70, 200, 120, 0.42)";
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
    ctx.fillRect(stem.x, stem.y, stem.w, stem.h);
    ctx.setLineDash([]);
    ctx.lineWidth = Math.max(1.5, tsize * 0.28);
    ctx.strokeStyle = "rgba(120, 240, 160, 0.95)";
    ctx.strokeRect(bar.x, bar.y, bar.w, bar.h);
    ctx.strokeRect(stem.x, stem.y, stem.w, stem.h);
    ctx.restore();
    return true;
  }

  // ОДНА крупная цифра обратного отсчёта в перекрестье буквы Т (центр перекладины и
  // ножки), размер ≈ ½ ширины ножки — вместо цифры на каждом тайле. Позиция/размер/
  // таймер приходят из симуляции маркером splitRescue.
  private drawRescueTimer(ctx: CanvasRenderingContext2D): boolean {
    const me = this.game.myPlayer();
    const rescue = me?.splitRescue();
    if (!me || !rescue) return false;

    const ticksPerSec = Math.max(
      1,
      Math.round(1000 / this.game.config().msPerTick()),
    );
    const remaining = rescue.expiry - this.game.ticks();
    if (remaining <= 0) return false;
    const seconds = Math.ceil(remaining / ticksPerSec);

    const tsize = this.tilePx();
    if (tsize <= 0) return false;
    const p = this.transformHandler.worldToScreenCoordinates(
      new Cell(rescue.x, rescue.y),
    );
    const sx = p.x + tsize * 0.5;
    const sy = p.y + tsize * 0.5;
    // Шрифт ≈ ширина ножки (одна цифра ~½ ножки). Нижний клэмп для читаемости вдали.
    // terron: −30% к размеру цифры (была слишком крупной, перекрывала карту).
    const fontPx = Math.max(10, rescue.w * tsize * 0.665);

    ctx.save();
    ctx.font = `800 ${fontPx}px Oswald, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, fontPx * 0.12);
    ctx.strokeStyle = "rgba(20, 16, 4, 0.9)";
    ctx.fillStyle = "#f5c442";
    const text = String(seconds);
    ctx.strokeText(text, sx, sy);
    ctx.fillText(text, sx, sy);
    ctx.restore();
    return true;
  }

  // terron: таймер самоуничтожения ЗАХВАЧЕННОЙ чужой ульты — жёлтая цифра
  // (стиль/размер как у drawRescueTimer) над зданием. Показывается всем: срок
  // публичный (capturedTick приходит в UnitUpdate). Своя выбранная ульта
  // (тип === ultimateChoice владельца) не взрывается — таймер не рисуем.
  /**
   * terron 23.08: ДОРА — РЕАЛЬНАЯ ЗОНА ПОРАЖЕНИЯ, а не «откуда стою».
   *
   * Повод (репорт владельца): круг показывал радиус от текущей позиции, и по
   * нему нельзя было понять главное — орудие ведь ЕЗДИТ. Настоящая зона это
   * объединение кругов вокруг каждой своей станции: доехал — выстрелил.
   * Рисуем тонкими кольцами станции сети и жирным — круг от самого орудия.
   *
   * Показываем только когда игрок целится выстрелом или ставит орудие: висеть
   * постоянно эта паутина не должна.
   */
  /**
   * terron 23.08: ДОРА — ЗОНА ПОРАЖЕНИЯ «ОБЛАЧКОМ» (решение владельца).
   *
   * Настоящая зона это ОБЪЕДИНЕНИЕ кругов радиуса вокруг каждой своей станции
   * (доехал — выстрелил) плюс круг вокруг самого орудия. Рисовать их по
   * отдельности нельзя: получается паутина из внутренних дуг, по которой
   * невозможно прочитать границу.
   *
   * Поэтому объединение собирается на ОФФСКРИНЕ композицией:
   *   1) заливаем круги радиусом R+w — получаем union, раздутый на ширину канта;
   *   2) `destination-out` теми же кругами радиусом R — вырезаем середину,
   *      остаётся ровно ВНЕШНИЙ КОНТУР без единой внутренней линии;
   *   3) заливку под облачко берём отдельным проходом и переносим целиком с
   *      одной прозрачностью — иначе на пересечениях кругов она темнела бы.
   *
   * Показываем только при наведении выстрела или постройке орудия: постоянно
   * висеть такая зона не должна.
   */
  /**
   * terron 23.08 (решение владельца): приказ ПРИНЯТ — орудие едет — значит на
   * цели обязан стоять гост с красным отсчётом «через N тут ёбнет».
   *
   * Раньше после клика не происходило ВИДИМО НИЧЕГО: орудие где-то ползло по
   * рельсам, а игрок не знал, принят ли приказ вообще (и был уверен, что ульта
   * сломана). Круг = реальный радиус взрыва (тот же, что у дрона, из конфига),
   * цифра — отсчёт из сима (доезд + перезарядка), красная с «!» как у всех
   * опасных отсчётов.
   *
   * Рисуем ТОЛЬКО СВОИ приказы: подсвечивать жертве точное место прилёта —
   * отдельное решение по балансу, а не мелочь отрисовки.
   */
  /** Идёт ли сейчас наводка (принятый приказ Доры с отсчётом). */
  private railGunAiming(): boolean {
    const me = this.game.myPlayer();
    if (me === null) return false;
    for (const g of me.units(UnitType.RailGun)) {
      if (g.targetTile() !== undefined && g.railEta() > 0) return true;
    }
    return false;
  }

  private drawRailGunTelegraph(ctx: CanvasRenderingContext2D): boolean {
    const me = this.game.myPlayer();
    if (me === null) return false;
    const tsize = this.tilePx();
    if (tsize <= 0) return false;
    const ticksPerSec = Math.max(
      1,
      Math.round(1000 / this.game.config().msPerTick()),
    );
    const cfg = this.game.config();
    let drew = false;
    // ⚠️ terron 24.08: телеграф общий для ДВУХ ульт, которые «сейчас прилетит».
    //
    //  • ДОРА — свой прилёт видит ТОЛЬКО владелец (это его приказ);
    //  • СОСТАВ СМЕРТИ — круг и отсчёт видят ВСЕ, включая жертву: в этом вся
    //    ульта. Контрплей (порвать пути) невозможен, если не знаешь, куда он
    //    едет — а раньше рисовался только сам поезд, без точки прибытия
    //    (просьба владельца «пока едет — тоже гост радиуса и таймер»).
    const sources: { unit: UnitView; blast: number }[] = [];
    for (const g of me.units(UnitType.RailGun)) {
      sources.push({
        unit: g,
        blast: cfg.nukeMagnitudes(UnitType.SuicideDrone).outer,
      });
    }
    for (const t of this.game.units(UnitType.DoomTrain)) {
      sources.push({
        unit: t,
        blast: cfg.nukeMagnitudes(UnitType.DoomTrain).outer,
      });
    }
    for (const { unit: g, blast } of sources) {
      if (g.isUnderConstruction()) continue;
      const target = g.targetTile();
      const eta = g.railEta();
      if (target === undefined || eta <= 0) continue;
      const p = this.transformHandler.worldToScreenCoordinates(
        new Cell(this.game.x(target), this.game.y(target)),
      );
      const cx = p.x + tsize * 0.5;
      const cy = p.y + tsize * 0.5;
      const r = blast * tsize;
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = "#ff4d4d";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = "#ff4d4d";
      ctx.lineWidth = Math.max(1.5, tsize * 0.4);
      ctx.setLineDash([tsize * 2, tsize * 1.5]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // НАВОДКА (решение владельца 23.08): круг сводится к цели за AIM_MS и
      // начинается заново — видно, что орудие работает по этой точке, даже
      // когда цифра отсчёта меняется раз в секунду.
      const k = (performance.now() % AIM_MS) / AIM_MS;
      ctx.globalAlpha = 0.15 + 0.5 * k * k;
      ctx.lineWidth = Math.max(1, tsize * 0.3);
      ctx.beginPath();
      ctx.arc(cx, cy, r * (2.4 - 1.4 * k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const fontPx = Math.max(11, Math.min(r * 0.9, tsize * 4 * 0.665));
      ctx.font = `800 ${fontPx}px Oswald, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, fontPx * 0.12);
      ctx.strokeStyle = "rgba(20, 16, 4, 0.9)";
      ctx.fillStyle = "#ff4d4d";
      const text = `${Math.ceil(eta / ticksPerSec)}!`;
      ctx.strokeText(text, cx, cy);
      ctx.fillText(text, cx, cy);
      ctx.restore();
      drew = true;
    }
    return drew;
  }

  private drawRailGunReach(ctx: CanvasRenderingContext2D): boolean {
    // terron 23.08: зона доезда общая для ВСЕХ ульт, которые ездят по рельсам
    // (Дора и Взрывные поезда). Набор тайлов считает сим и присылает в
    // railReach — клиент только рисует. new-units/{DORA,TRAINS}.md
    const ghost = this.uiState.ghostStructure;
    const RAIL_GHOSTS = new Set<UnitType>([
      UnitType.RailGun,
      UnitType.RailGunShell,
      UnitType.TrainDepot,
      UnitType.DoomTrain,
    ]);
    const me = this.game.myPlayer();
    if (me === null) return false;

    // terron 23.08 (репорт владельца «почему радиуса у блокады нет, если она в
    // радиусе от портов — тем же методом, что и пушка кругами»): БЛОКАДА
    // ставится не дальше TERRON_BLOCKADE_PORT_RANGE от своего порта, и зона
    // рисуется ТЕМ ЖЕ облаком, что зона доезда Доры.
    if (ghost === UnitType.Blockade) {
      const centers: TileRef[] = [];
      for (const h of me.units(...TradeHubs.types)) {
        if (h.isActive() && !h.isUnderConstruction()) centers.push(h.tile());
      }
      return this.drawReachCloud(ctx, centers, TERRON_BLOCKADE_PORT_RANGE);
    }

    if (ghost === null || !RAIL_GHOSTS.has(ghost)) return false;
    const tiles: TileRef[] = [];
    const seen = new Set<TileRef>();
    for (const g of me.units(UnitType.RailGun, UnitType.TrainDepot)) {
      if (g.isUnderConstruction()) continue;
      for (const t of g.railReach()) {
        if (seen.has(t)) continue;
        seen.add(t);
        tiles.push(t);
      }
    }
    // Орудия/депо ещё нет (ставим его) — показываем всю свою сеть станций:
    // встать можно на любые свои рельсы.
    if (
      tiles.length === 0 &&
      (ghost === UnitType.RailGun || ghost === UnitType.TrainDepot)
    ) {
      for (const u of me.units()) {
        if (!u.hasTrainStation() || u.isUnderConstruction()) continue;
        tiles.push(u.tile());
      }
    }
    // ⚠️ terron 24.08 (решение владельца: «вот эти круги мелкие маленькие по
    // рельсам не нужны»): У ПОЕЗДА ЗОНЫ НЕТ ВООБЩЕ. Сеть и так нарисована на
    // карте самими путями, а облако поверх неё читалось как мусор: сперва
    // кругами радиуса выстрела (казалось, что дальность ограничена), потом
    // цепочкой мелких кругов вдоль ниток.
    //
    // У ДОРЫ облако остаётся: там оно отвечает на другой вопрос — «куда
    // достанет ВЫСТРЕЛ», и по рельсам этого не видно.
    if (ghost === UnitType.TrainDepot || ghost === UnitType.DoomTrain) {
      return false;
    }
    return this.drawReachCloud(ctx, tiles, TERRON_RAILGUN_RANGE);
  }

  /**
   * ОБЛАЧКО: объединение кругов радиуса `radius` вокруг тайлов — единой
   * прозрачностью и с ОДНИМ внешним контуром, без внутренних дуг (решение
   * владельца 23.08). Внутренние границы убираются вычитанием: рисуем
   * раздутое объединение и вырезаем из него обычное.
   */
  private drawReachCloud(
    ctx: CanvasRenderingContext2D,
    tiles: readonly TileRef[],
    radiusTiles: number,
  ): boolean {
    if (tiles.length === 0) return false;
    const tsize = this.tilePx();
    if (tsize <= 0) return false;
    const centers = tiles.map((t) =>
      this.transformHandler.worldToScreenCoordinates(
        new Cell(this.game.x(t), this.game.y(t)),
      ),
    );
    const R = radiusTiles * tsize;
    const w = Math.max(2, Math.min(4, tsize * 0.6));
    const cv = this.canvas;
    if (cv === null) return false;
    const off = this.reachBuffer ?? document.createElement("canvas");
    this.reachBuffer = off;
    if (off.width !== cv.width || off.height !== cv.height) {
      off.width = cv.width;
      off.height = cv.height;
    }
    const octx = off.getContext("2d");
    if (octx === null) return false;
    const dpr = cv.width / Math.max(1, cv.clientWidth);

    const fillAll = (radius: number) => {
      octx.beginPath();
      for (const c of centers) {
        octx.moveTo((c.x + radius) * dpr, c.y * dpr);
        octx.arc(c.x * dpr, c.y * dpr, radius * dpr, 0, Math.PI * 2);
      }
      octx.fill();
    };

    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, off.width, off.height);
    octx.globalCompositeOperation = "source-over";
    octx.fillStyle = "#8fd0ff";
    fillAll(R);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.1;
    ctx.drawImage(off, 0, 0);

    octx.clearRect(0, 0, off.width, off.height);
    octx.globalCompositeOperation = "source-over";
    fillAll(R + w);
    octx.globalCompositeOperation = "destination-out";
    fillAll(R);
    octx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.65;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
    return true;
  }

  /**
   * terron 23.08: ЕДИНЫЙ РИСОВАЛЬЩИК ТАЙМЕРОВ НАД ЗДАНИЯМИ.
   *
   * Раньше здесь был только отсчёт самоподрыва захваченной ульты. Теперь один
   * код рисует ВСЕ отсчёты одинаково — циферблатный сектор отката плюс цифра
   * секунд, — а источники перечислены в одном месте ниже. Добавили механику с
   * перезарядкой? Достаточно строки в `timerSources()`, рисование готово.
   *
   * Два ЦВЕТА, и это принципиально (решение владельца 23.08): красный —
   * «сейчас рванёт», нейтральный — «скоро смогу выстрелить». Раньше и то и
   * другое было бы жёлтой цифрой, и игрок путал бы отсчёт до взрыва с
   * перезарядкой.
   */
  private drawStructureTimers(ctx: CanvasRenderingContext2D): boolean {
    const tsize = this.tilePx();
    if (tsize <= 0) return false;
    const entries = this.timerSources();
    if (entries.length === 0) return false;

    const ticksPerSec = Math.max(
      1,
      Math.round(1000 / this.game.config().msPerTick()),
    );
    let drew = false;
    for (const e of entries) {
      const seconds = Math.ceil(e.remaining / ticksPerSec);
      if (seconds <= 0) continue;
      const p = this.transformHandler.worldToScreenCoordinates(
        new Cell(this.game.x(e.tile), this.game.y(e.tile)),
      );
      // terron 23.08 (уточнение владельца: «перемести кулдауны зданий в верхний
      // правый угол и поменьше их»): циферблат сидит В ПРАВОМ ВЕРХНЕМ УГЛУ
      // спрайта, а не по центру. По центру он закрывал саму иконку — было не
      // понять, ЧТО перезаряжается; сбоку читаются и здание, и отсчёт.
      const badge = tsize * 4 * 0.42; // диаметр значка ≈ 40 % от спрайта
      // ⚠️ ГДЕ СИДИТ ОТСЧЁТ — зависит от того, ЧТО он считает.
      //
      // • ОТКАТ ЗДАНИЯ: между зубцами звезды, выше и правее центра (просьба
      //   владельца). По центру он закрывал иконку — не понять, что заряжается.
      // • СРОК ЭФФЕКТА (баф-здание) и ОПАСНОСТЬ: держим У САМОГО ЗДАНИЯ.
      //   Вынесенный на два спрайта в сторону, отсчёт читается как отдельный
      //   объект — репорт владельца «точка с таймером очень далеко от здания».
      const far = e.kind === "cooldown";
      const sx = p.x + tsize * (far ? 5.2 : 1.6);
      const sy = p.y - tsize * (far ? 4.0 : 1.2);
      const fontPx = Math.max(8, badge);
      const danger = e.kind === "danger";
      const fill = danger
        ? "#ff4d4d"
        : e.kind === "buff"
          ? "#ffd479"
          : "#8fd0ff";

      ctx.save();
      // Циферблат: сектор «сколько ОСТАЛОСЬ», по часовой от 12 часов.
      // Точка в центре + кольцо — читается как часы, а не как индикатор HP.
      const r = fontPx * 0.62;
      const frac = Math.max(0, Math.min(1, e.remaining / e.total));
      // Тёмная подложка: циферблат лёг НА иконку, и без неё сектор тонет в
      // спрайте здания (репорт владельца «не такой бледный»).
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "rgba(12, 10, 4, 1)";
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.arc(sx, sy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = fill;
      ctx.lineWidth = Math.max(1.5, fontPx * 0.08);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = `800 ${fontPx}px Oswald, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, fontPx * 0.12);
      ctx.strokeStyle = "rgba(20, 16, 4, 0.9)";
      ctx.fillStyle = fill;
      // Восклицательный знак у опасных отсчётов: «23!» ≠ «23 до выстрела».
      const text = danger ? `${seconds}!` : String(seconds);
      ctx.strokeText(text, sx, sy);
      ctx.fillText(text, sx, sy);
      ctx.restore();
      drew = true;
    }
    return drew;
  }

  /**
   * ВСЕ источники отсчётов в одном месте. Новая механика с таймером = строка
   * здесь, рисование уже готово.
   */
  private timerSources(): {
    tile: TileRef;
    remaining: number;
    total: number;
    kind: "danger" | "cooldown" | "buff";
  }[] {
    const out: {
      tile: TileRef;
      remaining: number;
      total: number;
      kind: "danger" | "cooldown" | "buff";
    }[] = [];
    const now = this.game.ticks();

    // (1) Самоподрыв захваченной чужой ульты — КРАСНЫЙ.
    if (TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS > 0) {
      for (const u of this.game.units(...Ultimates.types)) {
        if (!u.isActive() || u.isUnderConstruction()) continue;
        const cap = u.capturedTick();
        if (cap === null) continue;
        if (u.owner()?.ultimateChoice() === u.type()) continue; // своя выбранная
        const remaining = cap + TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS - now;
        if (remaining > 0) {
          out.push({
            tile: u.tile(),
            remaining,
            total: TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS,
            kind: "danger",
          });
        }
      }
    }

    // (1.5) terron 23.08: ВРЕМЕННЫЕ БАФ-ЗДАНИЯ (Индустриальная революция и
    // всё, что появится после неё). Срок едет тем же полем, что у Доры и
    // поездов, — заводить третий канал «сколько осталось» незачем.
    for (const u of this.game.units(...TimedBuffs.types)) {
      if (!u.isActive()) continue;
      const left = u.railEta();
      if (left <= 0) continue;
      out.push({
        tile: u.tile(),
        remaining: left,
        total: TERRON_INDUSTRIAL_TICKS,
        kind: "buff",
      });
    }

    // (2) terron: ВЗРЫВНЫЕ ПОЕЗДА — тикающий состав. Отсчёт видят ВСЕ, включая
    // жертву: в этом весь смысл ульты — угроза, на которую можно ответить,
    // разорвав пути перед поездом. Красный, как все опасные отсчёты.
    for (const t of this.game.units(UnitType.DoomTrain)) {
      if (!t.isActive()) continue;
      const eta = t.railEta();
      if (eta <= 0) continue;
      out.push({
        tile: t.tile(),
        remaining: eta,
        // Полной длительности у состава нет — сектор считаем от текущего
        // максимума, иначе циферблат прыгал бы при каждом пересчёте.
        total: Math.max(eta, 1),
        kind: "danger",
      });
    }

    // (3) terron: ПИРАТСТВО — откат покупки лодок принадлежит ИГРОКУ, но
    // показываем его НА ШТАБЕ: игрок ищет отсчёт там, где стоит ульта
    // (репорт владельца «ни над ультой, ни в меню»).
    const me = this.game.myPlayer();
    if (me !== null) {
      const remaining = me.pirateShipReadyAt() - now;
      if (remaining > 0) {
        for (const hq of me.units(UnitType.Piracy)) {
          if (!hq.isActive() || hq.isUnderConstruction()) continue;
          out.push({
            tile: hq.tile(),
            remaining,
            total: TERRON_PIRACY_SHIP_COOLDOWN_TICKS,
            kind: "cooldown",
          });
        }
      }
    }

    // (4) Перезарядка стреляющих строений — ЕДИНАЯ система откатов
    // (client/Cooldowns.ts). Тот же расчёт, что на кнопках в панели, радиале и
    // мобильном интерфейсе: откат обязан выглядеть откатом ВЕЗДЕ.
    for (const type of RELOADING_TYPES) {
      for (const u of this.game.units(type)) {
        if (!u.isActive() || u.isUnderConstruction()) continue;
        const cd = unitCooldown(this.game, u);
        if (cd === null) continue;
        out.push({
          tile: u.tile(),
          remaining: cd.remaining,
          total: cd.total,
          kind: "cooldown",
        });
      }
    }
    return out;
  }

  // terron: СТОЛИЦЫ — подпись имени над городом. Рисуется у ЛЮБОГО города с именем:
  // ТЕКУЩАЯ столица — ярко-золотым, БЫВШАЯ (захвачена/демотирована, город серый) —
  // приглушённым, чтобы игрок видел, куда высаживаться и отбивать столицу назад.
  // Реальная столица у наций, рандом у игроков. RU по CAPITAL_RU (нет ключа → EN).
  // Показываем только на достаточном зуме (иначе мусор). Спека: CAPITALS.md
  /**
   * terron 25.08 (просьба владельца: «под каждым зданием ты ведь знаешь, как
   * именно пойдёт оно — надо нарисовать что-то типа рельс, линию в 1 пиксель, и
   * гост, куда оно встанет, тоже 10% прозрачности»).
   *
   * Нитка ОСТАВШЕГОСЯ маршрута + едва заметный квадрат в точке прибытия.
   * Данные — `unit.walkPath()` (видовое поле, считает сим при касте). СВОЙ
   * канал, не railReach: у того смысл «куда достанет выстрел Доры».
   */
  private drawWalkPaths(ctx: CanvasRenderingContext2D): boolean {
    const tsize = this.tilePx();
    if (tsize < 1) return false;
    const me = this.game.myPlayer();
    if (me === null) return false;
    let drew = false;

    for (const u of me.units()) {
      const path = u.walkPath();
      if (path.length === 0) continue;
      const pt = (t: number) =>
        this.transformHandler.worldToScreenCoordinates(
          new Cell(this.game.x(t), this.game.y(t)),
        );
      const half = tsize * 0.5;

      ctx.save();
      // Нитка пути: тонкая пунктирная линия от здания до точки прибытия.
      ctx.beginPath();
      const from = pt(u.tile());
      ctx.moveTo(from.x + half, from.y + half);
      for (const t of path) {
        const p = pt(t);
        ctx.lineTo(p.x + half, p.y + half);
      }
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(240, 235, 210, 0.55)";
      ctx.stroke();

      // Гост места прибытия — «едва видимо» (1 из 10).
      const dst = pt(path[path.length - 1]);
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = "#f0ebd2";
      ctx.fillRect(dst.x, dst.y, tsize, tsize);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#f0ebd2";
      ctx.strokeRect(dst.x + 0.5, dst.y + 0.5, tsize - 1, tsize - 1);
      ctx.restore();
      drew = true;
    }
    return drew;
  }

  private drawCapitalNames(ctx: CanvasRenderingContext2D): boolean {
    const tsize = this.tilePx();
    if (tsize < 3) return false; // слишком далеко — не рисуем
    const ru = getCurrentLang() === "ru";
    let drew = false;

    for (const u of this.game.units(UnitType.City)) {
      if (!u.isActive() || u.isUnderConstruction()) continue;
      const raw = u.capitalName();
      if (!raw) continue; // имя есть только у (бывших) столиц
      // Вторая и следующие столицы игрока — «Новая Зарница»: имя у игрока одно
      // на всю партию, и две одинаковые подписи читались как две столицы.
      const name = capitalLabel(
        raw,
        CAPITAL_RU[raw] ?? raw,
        ru,
        u.capitalGeneration(),
      );
      const isCap = u.isCapital(); // текущая столица (золото) vs бывшая (приглушённо)

      const tile = u.tile();
      const p = this.transformHandler.worldToScreenCoordinates(
        new Cell(this.game.x(tile), this.game.y(tile)),
      );
      const sx = p.x + tsize * 0.5;
      const sy = p.y - tsize * 1.6; // над спрайтом города
      const fontPx = Math.max(11, Math.min(tsize * 1.5, 34));

      ctx.save();
      ctx.font = `700 ${fontPx}px Oswald, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, fontPx * 0.14);
      ctx.strokeStyle = "rgba(20, 16, 4, 0.92)";
      ctx.fillStyle = isCap ? "#f5c442" : "#cbb78a"; // столица — золото, бывшая — тускло
      ctx.strokeText(name, sx, sy);
      ctx.fillText(name, sx, sy);
      ctx.restore();
      drew = true;
    }
    return drew;
  }

  private dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      this.reachBuffer = null;
    }
  }
}

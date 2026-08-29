/**
 * TrailManager — per-tile "last owner" stamp for trail rendering.
 *
 * Each tick, for each tracked unit, stamps tiles between lastPos and pos
 * (bresenham) with the owner's smallID. When a unit dies its tiles are cleared,
 * with overlapping tiles repainted from any surviving unit.
 *
 * Simpler than the original openfront-workspace TrailManager (no MotionPlanStore
 * dependency). Since we run in the main thread reading GameView directly, we
 * don't need plan-based reconstruction.
 */

import type { UnitState } from "../types";
import { UT_AIRBORNE_ASSAULT, UT_SUICIDE_DRONE } from "../types";

// terron: авиация — типы, чей след рисуется ПУНКТИРОМ (десант/дрон). Торговый транзит
// трейла НЕ имеет вовсе (не в TRAIL_TYPES) — иначе засыпал бы карту. airport.md
const DASHED_TRAIL_TYPES: ReadonlySet<string> = new Set([
  UT_AIRBORNE_ASSAULT,
  UT_SUICIDE_DRONE,
]);
// terron 23.08 (просьба владельца): ТИХИЕ ДЕСАНТЫ ПИРАТА (subState 4) чужим
// следа не оставляют вовсе, а ВЛАДЕЛЬЦУ рисуют КОРОТКИЙ хвост — по нему видно,
// где сейчас идут собственные невидимки, но карта не расчерчена трассами от
// самого порта. Хвост — «последние N тайлов», старые гасим на ходу.
const STEALTH_TRAIL_TILES = 15;
// Пунктир: DASH_ON тайлов подряд штампуем, DASH_PERIOD-DASH_ON пропускаем.
const DASH_PERIOD = 4;
const DASH_ON = 2;

interface UnitTrail {
  ownerID: number;
  tiles: Set<number>;
  lastPosStamped: number; // tile ref of the last position we stamped
  dashed: boolean; // terron: авиация — пунктирный след
  dashCounter: number; // terron: авиация — счётчик тайлов для фазы пунктира
  /** terron: потолок длины хвоста (0 — без потолка) и порядок штамповки. */
  cap: number;
  order: number[];
}

export class TrailManager {
  private readonly trailState: Uint8Array;
  private readonly unitTrails = new Map<number, UnitTrail>();
  private readonly mapW: number;

  private _dirtyRowMin = Infinity;
  private _dirtyRowMax = -1;

  constructor(mapW: number, mapH: number) {
    this.mapW = mapW;
    this.trailState = new Uint8Array(mapW * mapH);
  }

  getTrailState(): Uint8Array {
    return this.trailState;
  }

  get dirtyRowMin(): number {
    return this._dirtyRowMin;
  }
  get dirtyRowMax(): number {
    return this._dirtyRowMax;
  }

  clearDirtyRows(): void {
    this._dirtyRowMin = Infinity;
    this._dirtyRowMax = -1;
  }

  reset(): void {
    this.unitTrails.clear();
    this.trailState.fill(0);
    this._dirtyRowMin = Infinity;
    this._dirtyRowMax = -1;
  }

  /**
   * Update trails from the current unit set. Stamps tiles between lastPos and
   * pos (bresenham) for each tracked unit, and clears tiles for units that
   * have disappeared (overlapping tiles get repainted from survivors).
   */
  update(
    units: Map<number, UnitState>,
    trackedIds: number[],
    // terron: чьи хвосты обрезать. Решает ВЫЗЫВАЮЩИЙ (GameView) — у него есть
    // и тип юнита, и ульты владельца; кадровому UnitState этого знать неоткуда,
    // а по одному subState невидимка ловилась не всегда (репорт владельца
    // «шлейф всё такой же на полную длину»).
    shortIds?: ReadonlySet<number>,
  ): void {
    this.clearDeadUnits(units);
    for (const id of trackedIds) {
      const unit = units.get(id);
      if (!unit) continue;
      let trail = this.unitTrails.get(id);
      if (!trail) {
        trail = {
          ownerID: unit.ownerID,
          tiles: new Set(),
          lastPosStamped: -1,
          dashed: DASHED_TRAIL_TYPES.has(unit.unitType),
          dashCounter: 0,
          cap: shortIds?.has(id) === true ? STEALTH_TRAIL_TILES : 0,
          order: [],
        };
        this.unitTrails.set(id, trail);
      }
      trail.cap = shortIds?.has(id) === true ? STEALTH_TRAIL_TILES : 0;
      if (trail.lastPosStamped === -1) {
        // First sighting — just stamp current pos
        this.stamp(unit.pos, trail.ownerID);
        this.remember(trail, unit.pos);
        trail.lastPosStamped = unit.pos;
      } else if (trail.lastPosStamped !== unit.pos) {
        this.bresenham(trail.lastPosStamped, unit.pos, trail);
        trail.lastPosStamped = unit.pos;
      }
      this.trimTrail(trail);
    }
  }

  /** Запомнить тайл в наборе и (для ограниченных хвостов) в порядке штамповки. */
  private remember(trail: UnitTrail, ref: number): void {
    if (trail.tiles.has(ref)) return;
    trail.tiles.add(ref);
    if (trail.cap > 0) trail.order.push(ref);
  }

  /**
   * Срезать хвост до потолка: гасим самые старые тайлы. Если тайл занят
   * ЧУЖИМ следом — перекрашиваем на него, а не обнуляем (иначе короткий хвост
   * прогрызал бы дыры в чужих трассах).
   */
  private trimTrail(trail: UnitTrail): void {
    if (trail.cap <= 0) return;
    while (trail.order.length > trail.cap) {
      const ref = trail.order.shift()!;
      trail.tiles.delete(ref);
      let repaint = 0;
      for (const other of this.unitTrails.values()) {
        if (other !== trail && other.tiles.has(ref)) {
          repaint = other.ownerID;
          break;
        }
      }
      this.stamp(ref, repaint);
    }
  }

  private clearDeadUnits(units: Map<number, UnitState>): void {
    for (const [id, trail] of this.unitTrails) {
      if (units.has(id)) continue;
      const deadTiles = trail.tiles;
      for (const ref of deadTiles) this.stamp(ref, 0);
      this.unitTrails.delete(id);
      // Repaint any tiles that overlap surviving trails
      for (const other of this.unitTrails.values()) {
        for (const ref of deadTiles) {
          if (other.tiles.has(ref)) this.stamp(ref, other.ownerID);
        }
      }
    }
  }

  private stamp(ref: number, ownerID: number): void {
    this.trailState[ref] = ownerID;
    const row = (ref / this.mapW) | 0;
    if (row < this._dirtyRowMin) this._dirtyRowMin = row;
    if (row > this._dirtyRowMax) this._dirtyRowMax = row;
  }

  private bresenham(from: number, to: number, trail: UnitTrail): void {
    const w = this.mapW;
    let x0 = from % w;
    let y0 = (from - x0) / w;
    const x1 = to % w;
    const y1 = (to - x1) / w;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      const ref = y0 * w + x0;
      // terron: авиация — пунктир: штампуем DASH_ON из каждых DASH_PERIOD тайлов.
      if (!trail.dashed || trail.dashCounter % DASH_PERIOD < DASH_ON) {
        this.remember(trail, ref);
        this.stamp(ref, trail.ownerID);
      }
      if (trail.dashed) trail.dashCounter++;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
}

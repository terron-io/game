import { NukeMagnitude } from "../configuration/Config";
import {
  TERRON_SPAWN_RECT_HALF_H,
  TERRON_SPAWN_RECT_HALF_W,
} from "../configuration/TerronTuning";
import { Game, Player, Structures } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { GameView } from "../game/GameView";

export interface NukeBlastParams {
  gm: GameMap;
  targetTile: TileRef;
  magnitude: NukeMagnitude;
}

/**
 * Counts how many tiles each player has in the nuke's blast zone.
 *
 * returns Map of player ID and weighted tile count
 */
export function computeNukeBlastCounts(
  params: NukeBlastParams,
): Map<number, number> {
  const { gm, targetTile, magnitude } = params;

  const inner2 = magnitude.inner * magnitude.inner;
  const counts = new Map<number, number>();

  gm.circleSearch(targetTile, magnitude.outer, (tile: TileRef, d2: number) => {
    const ownerSmallId = gm.ownerID(tile);
    if (ownerSmallId > 0) {
      const weight = d2 <= inner2 ? 1 : 0.5;
      const prev = counts.get(ownerSmallId) ?? 0;
      counts.set(ownerSmallId, prev + weight);
    }
    return true;
  });

  return counts;
}

export interface NukeAllianceCheckParams {
  game: Game | GameView;
  targetTile: TileRef;
  magnitude: NukeMagnitude;
  allySmallIds?: Set<number>;
  threshold: number;
}

// Checks if nuking this tile would break an alliance.
// Returns true if either:
// 1. The weighted tile count for any ally exceeds the threshold
// 2. Any allied structure would be destroyed
export function wouldNukeBreakAlliance(
  params: NukeAllianceCheckParams,
): boolean {
  const { game, targetTile, magnitude, allySmallIds, threshold } = params;

  if (!allySmallIds || allySmallIds.size === 0) {
    return false;
  }

  // Check if any allied structure would be destroyed
  const wouldDestroyAlliedStructure = game.anyUnitNearby(
    targetTile,
    magnitude.outer,
    Structures.types,
    (unit) =>
      unit.owner().isPlayer() && allySmallIds.has(unit.owner().smallID()),
  );
  if (wouldDestroyAlliedStructure) return true;

  const inner2 = magnitude.inner * magnitude.inner;
  const allyTileCounts = new Map<number, number>();

  let result = false;

  game.circleSearch(
    targetTile,
    magnitude.outer,
    (tile: TileRef, d2: number) => {
      const ownerSmallId = game.ownerID(tile);
      if (ownerSmallId > 0 && allySmallIds.has(ownerSmallId)) {
        const weight = d2 <= inner2 ? 1 : 0.5;
        const newCount = (allyTileCounts.get(ownerSmallId) ?? 0) + weight;
        allyTileCounts.set(ownerSmallId, newCount);

        if (newCount > threshold) {
          result = true;
          return false; // Found one! Stop searching.
        }
      }
      return true;
    },
  );

  return result;
}

// Same as wouldNukeBreakAlliance(), but takes time to find every player
// that would be "angered" from this nuke.
// This includes unallied players!
export function listNukeBreakAlliance(
  params: NukeAllianceCheckParams,
): Set<number> {
  const { game, targetTile, magnitude, threshold } = params;

  // Collect all players that should have alliance broken:
  // either exceeds tile threshold OR has a structure in blast radius
  const playersToBreakAllianceWith = new Set<number>();

  // compute tile breakage threshold
  const blastCounts = computeNukeBlastCounts({
    gm: game,
    targetTile,
    magnitude,
  });
  for (const [playerSmallId, totalWeight] of blastCounts) {
    if (totalWeight > threshold) {
      playersToBreakAllianceWith.add(playerSmallId);
    }
  }

  // Also check if any allied structures would be destroyed
  game
    .nearbyUnits(targetTile, magnitude.outer, Structures.types)
    .forEach(({ unit }) =>
      playersToBreakAllianceWith.add(unit.owner().smallID()),
    );

  return playersToBreakAllianceWith;
}
export function getSpawnTiles(
  gm: GameMap,
  tile: TileRef,
  requireAllValid: true,
): TileRef[] | null;
export function getSpawnTiles(
  gm: GameMap,
  tile: TileRef,
  requireAllValid?: false,
): TileRef[];
export function getSpawnTiles(
  gm: GameMap,
  tile: TileRef,
  requireAllValid = false,
): TileRef[] | null {
  // terron: спавн «флагом» — стартовая территория ПРЯМОУГОЛЬНИК (а не круг
  // euclDistFN): игроки = флаги, и в прямоугольник ложится скин. bfs держит
  // связность (через воду не перепрыгнет), isLand/hasOwner фильтруют дальше.
  const cx = gm.x(tile);
  const cy = gm.y(tile);
  const spawnTiles = Array.from(
    gm.bfs(
      tile,
      (g: GameMap, n: TileRef) =>
        Math.abs(g.x(n) - cx) <= TERRON_SPAWN_RECT_HALF_W &&
        Math.abs(g.y(n) - cy) <= TERRON_SPAWN_RECT_HALF_H,
    ),
  );

  const isInvalid = (t: TileRef) => gm.hasOwner(t) || !gm.isLand(t);

  if (!requireAllValid) {
    return spawnTiles.filter((t) => !isInvalid(t));
  }

  if (spawnTiles.some(isInvalid)) {
    return null;
  }

  return spawnTiles;
}

/**
 * terron 04.09 ПЕРФ: минимальная манхэттен-дистанция от тайла до НАБОРА тайлов,
 * координаты набора посчитаны ОДИН раз в типизированные массивы. Раньше ИИ
 * наций звал closestTile(borderTiles, кандидат) на каждый из десятков
 * кандидатов места постройки — и каждый раз шёл по всей границе (тысячи тайлов)
 * через gm.manhattanDist → gm.x/gm.y. Результат тот же (те же целые), порядок
 * набора роли не играет — наружу идёт только число.
 * `stopBelow`: если нужна лишь проверка «минимум < порога», обход прерывается на
 * первом расстоянии ниже порога (возвращается оно — оно тоже < порога), а если
 * такого нет, возвращается точный минимум.
 */
export class TileDistanceIndex {
  private readonly xs: Int32Array;
  private readonly ys: Int32Array;
  readonly size: number;

  constructor(gm: GameMap, refs: Iterable<TileRef>) {
    const arr = Array.isArray(refs) ? refs : Array.from(refs);
    this.size = arr.length;
    this.xs = new Int32Array(arr.length);
    this.ys = new Int32Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      this.xs[i] = gm.x(arr[i]);
      this.ys[i] = gm.y(arr[i]);
    }
  }

  minDist(gm: GameMap, tile: TileRef, stopBelow = -1): number {
    const tx = gm.x(tile);
    const ty = gm.y(tile);
    const xs = this.xs;
    const ys = this.ys;
    let min = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - tx;
      const dy = ys[i] - ty;
      const d = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
      if (d < min) {
        min = d;
        if (min < stopBelow) return min;
      }
    }
    return min;
  }
}

export function closestTile(
  gm: GameMap,
  refs: Iterable<TileRef>,
  tile: TileRef,
): [TileRef | null, number] {
  let minDistance = Infinity;
  let minRef: TileRef | null = null;
  for (const ref of refs) {
    const distance = gm.manhattanDist(ref, tile);
    if (distance < minDistance) {
      minDistance = distance;
      minRef = ref;
    }
  }
  return [minRef, minDistance];
}

export function closestTwoTiles(
  gm: GameMap,
  x: Iterable<TileRef>,
  y: Iterable<TileRef>,
): { x: TileRef; y: TileRef } | null {
  // terron 04.09 ПЕРФ: координаты считаем ОДИН раз на тайл (раньше gm.x/gm.y
  // звались в компараторе сортировки и в каждой итерации — это заметная часть
  // 10 % тика, уходивших в GameMap.x). Порядок сортировки и результат
  // байт-в-байт прежние: компаратор сравнивает те же значения x, sort стабилен.
  const w = gm.width();
  const xs: { ref: TileRef; x: number; y: number }[] = [];
  for (const ref of x) xs.push({ ref, x: ref % w, y: (ref / w) | 0 });
  const ys: { ref: TileRef; x: number; y: number }[] = [];
  for (const ref of y) ys.push({ ref, x: ref % w, y: (ref / w) | 0 });
  xs.sort((a, b) => a.x - b.x);
  ys.sort((a, b) => a.x - b.x);

  if (xs.length === 0 || ys.length === 0) {
    return null;
  }

  let i = 0;
  let j = 0;
  let minDistance = Infinity;
  let result = { x: xs[0].ref, y: ys[0].ref };

  while (i < xs.length && j < ys.length) {
    const cx = xs[i];
    const cy = ys[j];

    const distance = Math.abs(cx.x - cy.x) + Math.abs(cx.y - cy.y);

    if (distance < minDistance) {
      minDistance = distance;
      result = { x: cx.ref, y: cy.ref };
    }

    if (i === xs.length - 1) {
      j++;
    } else if (j === ys.length - 1) {
      i++;
    } else if (cx.x < cy.x) {
      i++;
    } else {
      j++;
    }
  }

  return result;
}

/**
 * Calculates the center of a player's territory using geometric approach.
 * Uses the bounding box center and verifies ownership, falling back to nearest border tile if necessary.
 *
 * @param game - The game instance
 * @param target - The player whose territory center to calculate
 * @returns The tile reference for the territory center, or null if no valid center found
 */
export function calculateTerritoryCenter(
  game: Game,
  target: Player,
): TileRef | null {
  const borderTiles = target.borderTiles();
  if (borderTiles.size === 0) return null;

  // Calculate bounding box center in a single pass through border tiles
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;

  for (const tile of borderTiles) {
    const x = game.x(tile);
    const y = game.y(tile);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const centerX = Math.floor((minX + maxX) / 2);
  const centerY = Math.floor((minY + maxY) / 2);

  const centerTile = game.ref(centerX, centerY);

  // Verify ownership of the center tile
  if (game.owner(centerTile) === target) {
    return centerTile;
  }

  // Fall back to nearest border tile if center is not owned
  let closestTile: TileRef | null = null;
  let closestDistanceSquared = Infinity;

  for (const tile of borderTiles) {
    const dx = game.x(tile) - centerX;
    const dy = game.y(tile) - centerY;
    const distSquared = dx * dx + dy * dy;

    if (distSquared < closestDistanceSquared) {
      closestDistanceSquared = distSquared;
      closestTile = tile;
    }
  }

  return closestTile;
}

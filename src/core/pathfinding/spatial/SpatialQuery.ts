import { Game, Player, TerraNullius } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { DebugSpan } from "../../utilities/DebugSpan";
import { PathFinding } from "../PathFinder";
import { AStarWaterBounded } from "../algorithms/AStar.WaterBounded";

type Owner = Player | TerraNullius;

const REFINE_MAX_SEARCH_AREA = 100 * 100;

export class SpatialQuery {
  private boundedAStar: AStarWaterBounded | null = null;

  constructor(private game: Game) {}

  private getBoundedAStar(): AStarWaterBounded {
    this.boundedAStar ??= new AStarWaterBounded(
      this.game.map(),
      REFINE_MAX_SEARCH_AREA,
    );

    return this.boundedAStar;
  }

  /**
   * Find nearest tile matching predicate using BFS traversal.
   * Uses Manhattan distance filter, ignores terrain barriers.
   */
  private bfsNearest(
    from: TileRef,
    maxDist: number,
    predicate: (t: TileRef) => boolean,
  ): TileRef | null {
    const map = this.game.map();
    const candidates: TileRef[] = [];

    for (const tile of map.bfs(
      from,
      (_, t) => map.manhattanDist(from, t) <= maxDist,
    )) {
      if (predicate(tile)) {
        candidates.push(tile);
      }
    }

    if (candidates.length === 0) return null;

    // Sort by Manhattan distance to find actual nearest
    candidates.sort(
      (a, b) => map.manhattanDist(from, a) - map.manhattanDist(from, b),
    );

    return candidates[0];
  }

  /**
   * Find closest shore tile by land BFS.
   * Works for both players and terra nullius.
   */
  closestShore(
    owner: Owner,
    tile: TileRef,
    maxDist: number = 50,
  ): TileRef | null {
    const gm = this.game;
    const ownerId = owner.smallID();

    const isValidTile = (t: TileRef) => {
      if (!gm.isShore(t) || !gm.isLand(t)) return false;
      const tOwner = gm.ownerID(t);
      return tOwner === ownerId;
    };

    // terron ПЕРФ (08.08): БЫСТРЫЙ ПУТЬ ПО ГРАНИЦАМ ИГРОКА.
    //
    // Замер (`bench-tick.ts`) показал рывки 130+ мс, повторяющиеся ровно через
    // 58 тиков в ранней игре: нации волнами шлют десант, и КАЖДАЯ лодка при
    // создании ищет тут берег. Обход ниже проходит ВЕСЬ манхэттенский круг
    // радиусом 50 — порядка пяти тысяч тайлов, на каждом три проверки.
    //
    // Почему замена ТОЧНАЯ, а не «примерно то же». Фильтр обхода — ТОЛЬКО
    // расстояние (`manhattanDist <= maxDist`), про сушу он ничего не знает, а
    // манхэттенский круг связен по соседям. Значит обход покрывает круг
    // ЦЕЛИКОМ, и множество кандидатов = «свои береговые тайлы в радиусе»,
    // никакой связности по суше в нём нет.
    // Свой береговой тайл ВСЕГДА пограничный: `calcIsBorder` помечает тайл,
    // у которого хоть один сосед другого владельца, а у воды владельца нет.
    // Периметр игрока — сотни тайлов против пяти тысяч в круге.
    //
    // Ничейную землю оставляем на обходе: у неё нет набора тайлов, а
    // `targetTransportTile` зовёт нас и для неё (десант на пустой берег).
    // ⚠️ РАЗРЫВ НИЧЬЕЙ. Эталонный обход при нескольких РАВНОУДАЛЁННЫХ берегах
    // берёт тот, что встретился первым в его собственном порядке обхода (а он
    // depth-first: `bfs()` снимает с конца очереди). Воспроизвести этот порядок,
    // не выполняя сам обход, нельзя. Первая версия правки этого не учитывала — и
    // отпечаток детерминизма сразу разошёлся: 8f1f2c95 → 555d1923, то есть
    // менялись места высадки, а с ними и ход матча.
    // Поэтому: единственный ближайший — отвечаем сразу (результат заведомо тот
    // же); НИЧЬЯ — честно падаем в исходный обход. Ничьи редки, поэтому выигрыш
    // почти весь сохраняется, а поведение остаётся бит-в-бит прежним.
    if (owner.isPlayer()) {
      const border = (owner as Player).borderTiles();
      // terron ПЕРФ (21.08): у поздней империи/нации-гиганта периметр 15-30 тыс.
      // тайлов — это в разы БОЛЬШЕ площади манхэттенского круга радиуса maxDist
      // (2r²+2r+1 ≈ 5k при r=50), и «быстрый путь» становился медленнее
      // эталонного BFS. Оба пути дают бит-в-бит один ответ (ничьи и так уходят
      // в BFS), так что переключение по размеру детерминизма не касается.
      const circleArea = 2 * maxDist * maxDist + 2 * maxDist + 1;
      if (border.size > circleArea) {
        return this.bfsNearest(tile, maxDist, isValidTile);
      }
      let best: TileRef | null = null;
      let bestDist = Infinity;
      let bestCount = 0;
      for (const t of border) {
        const d = gm.manhattanDist(tile, t);
        if (d > maxDist || d > bestDist || !isValidTile(t)) continue;
        if (d < bestDist) {
          bestDist = d;
          best = t;
          bestCount = 1;
        } else {
          bestCount++; // равноудалённый — ничья
        }
      }
      if (best === null) return null; // берегов в радиусе нет вовсе
      if (bestCount === 1) return best;
      // Ничья — порядок решает эталон.
      return this.bfsNearest(tile, maxDist, isValidTile);
    }

    return this.bfsNearest(tile, maxDist, isValidTile);
  }

  /**
   * Find closest shore tile by water pathfinding.
   * Returns null for terra nullius (no borderTiles).
   */
  closestShoreByWater(owner: Owner, target: TileRef): TileRef | null {
    return DebugSpan.wrap("SpatialQuery.closestShoreByWater", () => {
      if (!owner.isPlayer()) return null;

      const gm = this.game;
      const player = owner as Player;

      // Target must be water or shore (land adjacent to water)
      if (!gm.isWater(target) && !gm.isShore(target)) return null;

      const targetComponent = gm.getWaterComponent(target);
      if (targetComponent === null) return null;

      const isValidTile = (t: TileRef) => {
        if (!gm.isShore(t) || !gm.isLand(t)) return false;
        const tComponent = gm.getWaterComponent(t);
        return tComponent === targetComponent;
      };

      const shores = Array.from(player.borderTiles()).filter(isValidTile);
      if (shores.length === 0) return null;

      const path = PathFinding.Water(gm).findPath(shores, target);
      if (!path || path.length === 0) return null;

      return DebugSpan.wrap("SpatialQuery.refineStartTile", () =>
        this.refineStartTile(path, shores, gm),
      );
    });
  }

  private refineStartTile(
    path: TileRef[],
    shores: TileRef[],
    gm: Game,
  ): TileRef {
    const CANDIDATE_RADIUS = 20;
    const MIN_WAYPOINT_DIST = 50;
    const MAX_WAYPOINT_DIST = 200;
    const PADDING = 10;

    if (path.length <= MIN_WAYPOINT_DIST) {
      return path[0];
    }

    const bestTile = path[0];
    const map = gm.map();

    const candidates = shores.filter(
      (s) => map.manhattanDist(s, bestTile) <= CANDIDATE_RADIUS,
    );

    if (candidates.length <= 1) return bestTile;

    // Precompute candidate bounds
    let candMinX = map.x(candidates[0]);
    let candMaxX = candMinX;
    let candMinY = map.y(candidates[0]);
    let candMaxY = candMinY;

    for (let i = 1; i < candidates.length; i++) {
      const sx = map.x(candidates[i]);
      const sy = map.y(candidates[i]);
      candMinX = Math.min(candMinX, sx);
      candMaxX = Math.max(candMaxX, sx);
      candMinY = Math.min(candMinY, sy);
      candMaxY = Math.max(candMaxY, sy);
    }

    // Binary search for furthest waypoint that keeps bounds within limit
    let lo = MIN_WAYPOINT_DIST;
    let hi = Math.min(MAX_WAYPOINT_DIST, path.length - 1);
    let bestWaypointIdx = lo;

    for (let i = 0; i < 5 && lo <= hi; i++) {
      const mid = (lo + hi) >> 1;
      const wp = path[mid];
      const wpX = map.x(wp);
      const wpY = map.y(wp);

      const minX = Math.min(candMinX, wpX) - PADDING;
      const maxX = Math.max(candMaxX, wpX) + PADDING;
      const minY = Math.min(candMinY, wpY) - PADDING;
      const maxY = Math.max(candMaxY, wpY) + PADDING;

      const area = (maxX - minX + 1) * (maxY - minY + 1);
      if (area <= REFINE_MAX_SEARCH_AREA) {
        bestWaypointIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const waypoint = path[bestWaypointIdx];
    const wpX = map.x(waypoint);
    const wpY = map.y(waypoint);

    const bounds = {
      minX: Math.max(0, Math.min(candMinX, wpX) - PADDING),
      maxX: Math.min(map.width() - 1, Math.max(candMaxX, wpX) + PADDING),
      minY: Math.max(0, Math.min(candMinY, wpY) - PADDING),
      maxY: Math.min(map.height() - 1, Math.max(candMaxY, wpY) + PADDING),
    };

    const boundsArea =
      (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
    if (boundsArea > REFINE_MAX_SEARCH_AREA) return bestTile;

    const refinedPath = this.getBoundedAStar().searchBounded(
      candidates,
      waypoint,
      bounds,
    );

    DebugSpan.set("$candidates", () => candidates);
    DebugSpan.set("$refinedPath", () => refinedPath);
    DebugSpan.set("$originalBestTile", () => bestTile);
    DebugSpan.set("$newBestTile", () => refinedPath?.[0] ?? bestTile);

    return refinedPath?.[0] ?? bestTile;
  }
}

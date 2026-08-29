// terron 24.08: ГОСТ-РЕЛЬСЫ (решение владельца: «я не понимаю, где пойдут
// рельсы во время госта фабрики — отображай сразу, серые»).
//
// Предсказание повторяет логику RailNetworkImpl.connectStation ТЕМ ЖЕ
// пафайндером (AStarRail по мини-карте + MiniMapTransformer): рядом рельс —
// станция врежется в него (ничего нового не рисуем); иначе — нитки к ближайшим
// станциям в trainStationMaxRange, минуя ближе trainStationMinRange. Это
// ПРЕВЬЮ: чистая отрисовка, сим не трогается — расхождение с фактом (лимиты
// связей, гонки за тик) не ломает ничего, кроме ожиданий.
//
// Мини-карта грузится лениво при первом госте станции (loadTerrainMap
// мемоизирован — бины уже в кэше после старта матча, парсинг копеечный).
import { UnitType } from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { GameView } from "../core/game/GameView";
import { loadTerrainMap } from "../core/game/TerrainMapLoader";
import { AStarRail } from "../core/pathfinding/algorithms/AStar.Rail";
import { PathFinderBuilder } from "../core/pathfinding/PathFinderBuilder";
import { MiniMapTransformer } from "../core/pathfinding/transformers/MiniMapTransformer";
import { PathStatus } from "../core/pathfinding/types";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

/** Гост каких построек тянет за собой рельсы (станции ж/д). */
export const RAIL_STATION_GHOSTS: ReadonlySet<UnitType> = new Set([
  UnitType.City,
  UnitType.Factory,
  UnitType.Port,
  UnitType.TrainDepot,
]);

type Finder = { findPath(from: TileRef, to: TileRef): TileRef[] | null };

let finder: Finder | null = null;
let building = false;

/** Ленивая сборка пафайндера рельсов (тот же, что в симе). */
function ensureFinder(game: GameView): void {
  if (finder !== null || building) return;
  building = true;
  const cfg = game.config().gameConfig();
  loadTerrainMap(cfg.gameMap, cfg.gameMapSize, terrainMapFileLoader)
    .then(async (data) => {
      const mini = await data.miniGameMap();
      const full = data.gameMap;
      const pf = new AStarRail(mini);
      finder = PathFinderBuilder.create(pf)
        .wrap((p) => new MiniMapTransformer(p, full, mini))
        .buildWithStepper({
          equals: (a, b) => a === b,
          distance: (a, b) => full.manhattanDist(a, b),
          preCheck: (from, to) =>
            !full.isValidRef(from) || !full.isValidRef(to)
              ? { status: PathStatus.NOT_FOUND }
              : null,
        });
    })
    .catch(() => {
      building = false; // сеть/парсинг упали — попробуем при следующем госте
    });
}

/**
 * Нитки рельсов, которые (примерно) построятся при установке станции в ghost.
 * Пусто, пока пафайндер не собран, рядом уже есть рельс или соседей нет.
 *
 * ⚠️ 24.08, разбор «гост врёт»: предиктор обязан повторять ГЕЙТЫ сима, а не
 * только его пафайндер. Правила из RailNetworkImpl/City/FactoryExecution:
 *  1) сим тянет нитки только к СТАНЦИЯМ (hasTrainStation), а не к любым
 *     зданиям — чужой город без станции нитку не получит никогда;
 *  2) МОЯ фабрика каскадом раздаёт станции СВОИМ city/port/factory/airport
 *     в радиусе — такие «будущие станции» тоже кандидаты, но только у госта
 *     фабрики/депо;
 *  3) город/порт сам становится станцией ТОЛЬКО при своей фабрике рядом —
 *     без неё у госта города рельсов не будет вовсе;
 *  4) сим пропускает станции, уже связанные сетью (графовая дистанция ≤ 4
 *     хопов) — приближаем: после первой нитки берём только кандидатов БЕЗ
 *     рельсов рядом (голая станция = другой кластер);
 *  5) connect() отбрасывает путь длиннее railroadMaxSize().
 */
export function predictRailPaths(
  game: GameView,
  ghost: TileRef,
  ghostType: UnitType,
): TileRef[][] {
  ensureFinder(game);
  if (finder === null) return [];
  // Рядом рельс → станция врежется в существующую нитку, новых не будет.
  if (game.hasRailNear(ghost, 3)) return [];
  const me = game.myPlayer();
  if (!me) return [];
  const meSmall = me.smallID();
  const cfg = game.config();
  const maxR = cfg.trainStationMaxRange();
  const minR2 = cfg.trainStationMinRange() ** 2;
  const maxLen = cfg.railroadMaxSize();

  const factoryGhost =
    ghostType === UnitType.Factory || ghostType === UnitType.TrainDepot;
  // Город/порт без СВОЕЙ фабрики в радиусе станцией не становится
  // (CityExecution.createStation) — рельсов не будет вовсе.
  if (!factoryGhost) {
    const myFactoryNear = game
      .nearbyUnits(ghost, maxR, [UnitType.Factory])
      .some((n) => n.unit.owner().smallID() === meSmall);
    if (!myFactoryNear) return [];
  }

  const near = game.nearbyUnits(ghost, maxR, [
    UnitType.City,
    UnitType.Factory,
    UnitType.Port,
    UnitType.Airport,
  ]);
  near.sort((a, b) => a.distSquared - b.distSquared);
  const out: TileRef[][] = [];
  for (const n of near) {
    if (n.distSquared <= minR2) continue;
    if (n.unit.tile() === ghost) continue;
    const isStation = n.unit.hasTrainStation();
    const mine = n.unit.owner().smallID() === meSmall;
    // Кандидат: уже-станция (сим коннектит city/factory/port; аэропорт — нет)
    // ЛИБО будущая станция из каскада моей фабрики (только свои).
    const stationCandidate = isStation && n.unit.type() !== UnitType.Airport;
    const cascadeCandidate = factoryGhost && mine && !isStation;
    if (!stationCandidate && !cascadeCandidate) continue;
    // Приближение графового отсева сима: после первой нитки — только
    // кандидаты без рельсов рядом (иначе они уже в той же сети).
    if (out.length > 0 && game.hasRailNear(n.unit.tile(), 3)) continue;
    const p = finder.findPath(ghost, n.unit.tile());
    if (p !== null && p.length > 1 && p.length < maxLen) out.push(p);
    if (out.length >= 3) break;
  }
  return out;
}

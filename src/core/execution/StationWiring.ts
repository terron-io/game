// terron 25.08: ПЕРЕЦЕПКА СТАНЦИИ — один ответ на вопрос «положена ли этому
// зданию станция ПРЯМО СЕЙЧАС и с кем связаться».
//
// Повод (репорт владельца по Шагающему городу): «по мере хода перестают
// работать фабрики… в конце вообще без рельс стоит». Причина не в самой ходьбе:
// станцию зданию создаёт ЕГО исполнитель РОВНО ОДИН РАЗ
// (`FactoryExecution.stationCreated` / `CityExecution.stationCreated` /
// `PortExecution`), поэтому переехавшее здание оставалось вне ж/д навсегда.
//
// Правила здесь — те же, что при постройке, просто собранные в одном месте:
//   • фабрика — своя станция (со спавном поездов) и подтягивает СВОИХ соседей;
//   • город/порт/аэропорт — станция, только если рядом СВОЯ фабрика.
// Любой код, который ДВИГАЕТ здание, обязан звать `rewireStation` — иначе рельсы
// останутся натянутыми к пустому месту.
import { actingAs, Game, Unit, UnitType } from "../game/Game";
import { TrainStationExecution } from "./TrainStationExecution";

/** Кого фабрика подтягивает к своему ж/д кластеру (как при постройке). */
const FACTORY_NEIGHBORS: UnitType[] = [
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.Airport,
];

/** Здание «работает как фабрика» (Депо смерти объявлено через actsAs). */
function isFactoryLike(unit: Unit): boolean {
  return actingAs(UnitType.Factory).includes(unit.type());
}

/** Рядом есть СВОЯ фабрика — значит зданию положена станция. */
function hasOwnFactoryNearby(mg: Game, unit: Unit): boolean {
  return mg.hasUnitNearby(
    unit.tile(),
    mg.config().trainStationMaxRange(),
    UnitType.Factory,
    unit.owner().id(),
  );
}

/**
 * Пересобрать станцию здания по его ТЕКУЩЕМУ месту: снять старую (вместе с
 * рельсами к прежней точке) и, если положено, создать новую.
 * Возвращает true, если зданию положена станция.
 *
 * ⚠️ Станция появляется СЛЕДУЮЩИМ тиком: `TrainStationExecution` строит
 * `TrainStation` в своём tick («Can't create new executions on init»). В тестах
 * состояние проверять после прогона тика.
 */
export function rewireStation(mg: Game, unit: Unit): boolean {
  if (!unit.isActive() || unit.isUnderConstruction()) return false;
  // Снимаем всегда: Railroad — фиксированный список тайлов, за уехавшим зданием
  // рельсы не тянутся (у станции tile() динамический, у путей — нет).
  mg.railNetwork().removeStation(unit);

  const factoryLike = isFactoryLike(unit);
  if (!factoryLike && !hasOwnFactoryNearby(mg, unit)) return false;

  mg.addExecution(new TrainStationExecution(unit, factoryLike));
  if (factoryLike) {
    // Фабрика приехала — соседи без станции цепляются к её кластеру.
    const owner = unit.owner();
    for (const { unit: n } of mg.nearbyUnits(
      unit.tile(),
      mg.config().trainStationMaxRange(),
      FACTORY_NEIGHBORS,
    )) {
      if (n === unit) continue;
      if (n.owner() !== owner || n.hasTrainStation()) continue;
      if (!n.isActive() || n.isUnderConstruction()) continue;
      mg.addExecution(new TrainStationExecution(n));
    }
  }
  return true;
}

// terron 24.08: ШАГАЮЩИЙ ГОРОД (new-units/WALKING.md) — каст «Перенос»:
// здания зоны идут в точку назначения. Сквозные тесты через
// ConstructionExecution (канон ULTIMATES.md).
import {
  TERRON_WALK_COST,
  TERRON_WALK_PICK_RADIUS,
  TERRON_WALK_STEP_TICKS,
  TERRON_WALK_STUCK_TICKS,
} from "../src/core/configuration/TerronTuning";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { isWalkingUnit } from "../src/core/execution/CityTransferExecution";
import {
  BuildableAttacks,
  CAST_UNLOCKED_BY,
  Game,
  isLockedUltimate,
  isSecretUltimate,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  Ultimates,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { constructionExecution } from "./util/utils";

let game: Game;
let a: Player;
let b: Player;

function landTiles(): number[] {
  const m = game.map();
  const out: number[] = [];
  for (let i = 0; i < m.width() * m.height(); i++) if (m.isLand(i)) out.push(i);
  return out;
}

/** Прогнать симуляцию на n тиков. */
function ticks(n: number): void {
  for (let i = 0; i < n; i++) game.executeNextTick();
}

describe("Walking City ultimate (terron)", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, "a_client", "a_id"),
      new PlayerInfo("b", PlayerType.Human, "b_client", "b_id"),
    ]);
    a = game.player("a_id");
    b = game.player("b_id");
    a.addGold(1_000_000_000n);
    b.addGold(1_000_000_000n);
    game.config().structureMinDist = () => 0;
    while (game.inSpawnPhase()) game.executeNextTick();
    while (game.isSpawnImmunityActive()) game.executeNextTick();
    // Вся суша — игроку a (отдельные тесты перекраивают сами).
    landTiles().forEach((t) => a.conquer(t));
  });

  // ⚠️ 25.08 (решения владельца): ульта СЕКРЕТНАЯ и ЗАКРЫТАЯ, каст БЕСПЛАТНЫЙ,
  // зоны нет — переносим одно здание.
  test("wiring: секретная закрытая ульта, каст Перенос бесплатный", () => {
    expect(Ultimates.has(UnitType.WalkingCity)).toBe(true);
    expect(Structures.has(UnitType.WalkingCity)).toBe(true);
    expect(isLockedUltimate(UnitType.WalkingCity)).toBe(true);
    expect(isSecretUltimate(UnitType.WalkingCity)).toBe(true);
    expect(BuildableAttacks.has(UnitType.CityTransfer)).toBe(true);
    expect(CAST_UNLOCKED_BY[UnitType.CityTransfer]?.building).toBe(
      UnitType.WalkingCity,
    );
    expect(game.config().unitInfo(UnitType.CityTransfer).cost(game, a)).toBe(
      BigInt(TERRON_WALK_COST),
    );
    expect(TERRON_WALK_COST).toBe(0);
  });

  test("здание из зоны доходит до точки назначения и там остаётся", () => {
    const mine = landTiles();
    const hqTile = mine[0];
    a.buildUnit(UnitType.WalkingCity, hqTile, {});
    // Без штаба каст недоступен — проверено обратным порядком в другом тесте.
    const m = game.map();
    const cityTile = game.ref(2, 2);
    const city = a.buildUnit(UnitType.City, cityTile, {});
    const dst = game.ref(2, Math.min(m.height() - 3, 12));
    expect(game.owner(dst)).toBe(a);
    const troops = Math.floor(a.troops() * 0.1);
    game.addExecution(
      new ConstructionExecution(
        a,
        UnitType.CityTransfer,
        cityTile,
        undefined,
        troops,
        dst,
      ),
    );
    ticks(3);
    expect(isWalkingUnit(city)).toBe(true);
    // Дистанция ≤ 20 тайлов, шаг раз в TERRON_WALK_STEP_TICKS + запас.
    ticks(25 * TERRON_WALK_STEP_TICKS);
    expect(city.tile()).toBe(dst);
    expect(isWalkingUnit(city)).toBe(false);
  });

  // terron 25.08 (репорт владельца: «по мере хода перестают работать фабрики,
  // в конце вообще без рельс стоит»). Станцию зданию создаёт его исполнитель
  // РОВНО ОДИН РАЗ, поэтому переехавшее здание оставалось вне ж/д навсегда.
  test("после переезда здание снова стоит на рельсах (и в пути тоже)", () => {
    const m = game.map();
    a.buildUnit(UnitType.WalkingCity, landTiles()[0], {});
    const dy = Math.min(m.height() - 3, 12);
    const dst = game.ref(2, dy);
    // ⚠️ Здания — ЧЕРЕЗ ConstructionExecution: только он вешает FactoryExecution/
    // CityExecution, а станции раздают именно они. С голым buildUnit станции нет
    // ни до похода, ни после, и тест проверял бы пустоту.
    constructionExecution(game, a, 4, dy, UnitType.Factory); // у точки назначения
    constructionExecution(game, a, 4, 2, UnitType.Factory); // у старого места
    constructionExecution(game, a, 2, 2, UnitType.City);
    const cityTile = game.ref(2, 2);
    const city = a.units(UnitType.City)[0];
    ticks(3);
    expect(city.hasTrainStation()).toBe(true); // исходное состояние

    game.addExecution(
      new ConstructionExecution(
        a,
        UnitType.CityTransfer,
        cityTile,
        undefined,
        Math.floor(a.troops() * 0.1),
        dst,
      ),
    );
    ticks(3);
    expect(isWalkingUnit(city)).toBe(true);
    // Путь виден клиенту (нитка + гост) — это видовое поле, не railReach.
    expect(city.walkPath().length).toBeGreaterThan(0);

    ticks(25 * TERRON_WALK_STEP_TICKS);
    // Встаёт РЯДОМ с точкой: место ищется свободное (соседняя фабрика занимает
    // зазор TERRON_WALK_PACK_GAP), поэтому точное совпадение не гарантировано.
    expect(city.tile()).not.toBe(cityTile);
    expect(game.euclideanDistSquared(city.tile(), dst)).toBeLessThan(100);
    expect(isWalkingUnit(city)).toBe(false);
    // ГЛАВНОЕ: приехали — и снова на рельсах, а нитка погашена.
    expect(city.hasTrainStation()).toBe(true);
    expect(city.walkPath().length).toBe(0);
  });

  // 25.08: каст БЕСПЛАТНЫЙ — ни золота, ни войск (решение владельца).
  test("перенос ничего не стоит: ни золота, ни войск", () => {
    const cityTile = game.ref(2, 2);
    a.buildUnit(UnitType.WalkingCity, landTiles()[0], {});
    const city = a.buildUnit(UnitType.City, cityTile, {});
    const goldBefore = a.gold();
    const troopsBefore = a.troops();
    game.addExecution(
      new ConstructionExecution(
        a,
        UnitType.CityTransfer,
        cityTile,
        undefined,
        troopsBefore, // «100%» — слайдер больше ни на что не влияет
        game.ref(2, 10),
      ),
    );
    ticks(3);
    expect(isWalkingUnit(city)).toBe(true); // поход всё же начался
    expect(a.gold()).toBe(goldBefore);
    expect(a.troops()).toBe(troopsBefore);
  });

  // 25.08: зоны нет — идёт РОВНО ОДНО здание, ближайшее к точке клика.
  test("идёт только здание под кликом; без точки назначения — отказ", () => {
    a.buildUnit(UnitType.WalkingCity, landTiles()[0], {});
    const nearTile = game.ref(2, 2);
    const near = a.buildUnit(UnitType.City, nearTile, {});
    // Дальнее здание — за радиусом прощения промаха (TERRON_WALK_PICK_RADIUS).
    const m = game.map();
    const farTile = game.ref(2, m.height() - 2);
    expect(game.euclideanDistSquared(nearTile, farTile)).toBeGreaterThan(
      TERRON_WALK_PICK_RADIUS * TERRON_WALK_PICK_RADIUS,
    );
    const far = a.buildUnit(UnitType.City, farTile, {});
    // Без dstTile: отказ, золото не списано, никто не идёт.
    const gold = a.gold();
    game.addExecution(
      new ConstructionExecution(
        a,
        UnitType.CityTransfer,
        nearTile,
        undefined,
        0,
      ),
    );
    ticks(3);
    expect(a.gold()).toBe(gold);
    expect(isWalkingUnit(near)).toBe(false);
    // С точкой: идёт только здание из зоны.
    game.addExecution(
      new ConstructionExecution(
        a,
        UnitType.CityTransfer,
        nearTile,
        undefined,
        0,
        game.ref(2, 10),
      ),
    );
    ticks(3);
    expect(isWalkingUnit(near)).toBe(true);
    expect(isWalkingUnit(far)).toBe(false);
  });

  // ⛔ 25.08 (репорт владельца «порты отказываются переноситься, пишут что нет
  // пути, хотя путь близкий к морю»): маршрут искался ПО БЕРЕГОВОЙ КРОМКЕ, а
  // она рвётся на каждом мысе. Теперь порт идёт по любой своей суше, берег
  // нужен только КОНЕЧНОЙ точке.
  test("порт идёт через сушу, а встаёт на берегу", () => {
    a.buildUnit(UnitType.WalkingCity, landTiles()[0], {});
    const m = game.map();
    // Порт ставим на берегу, цель — тоже у воды, но путь между ними пусть
    // проходит вглубь суши: важно, что каст ВООБЩЕ состоялся.
    const portTile = landTiles().find((t) => game.isShore(t));
    expect(portTile).toBeDefined();
    const port = a.buildUnit(UnitType.Port, portTile!, {});
    const dst = landTiles().find(
      (t) =>
        game.isShore(t) && game.euclideanDistSquared(t, portTile!) > 25,
    );
    expect(dst).toBeDefined();

    game.addExecution(
      new ConstructionExecution(
        a,
        UnitType.CityTransfer,
        portTile!,
        undefined,
        0,
        dst!,
      ),
    );
    ticks(3);
    expect(isWalkingUnit(port)).toBe(true); // раньше был отказ «нет пути»
    ticks(40 * TERRON_WALK_STEP_TICKS);
    expect(isWalkingUnit(port)).toBe(false);
    expect(port.tile()).not.toBe(portTile);
    // Конечная точка обязана быть берегом — иначе порт не сможет работать.
    expect(game.isShore(port.tile())).toBe(true);
  });

  test("потерял землю под маршрутом — здание ждёт и бросает поход по таймауту", () => {
    a.buildUnit(UnitType.WalkingCity, landTiles()[0], {});
    const cityTile = game.ref(2, 2);
    const city = a.buildUnit(UnitType.City, cityTile, {});
    game.addExecution(
      new ConstructionExecution(
        a,
        UnitType.CityTransfer,
        cityTile,
        undefined,
        0,
        game.ref(2, 12),
      ),
    );
    // Пара шагов — здание пошло.
    ticks(2 * TERRON_WALK_STEP_TICKS + 2);
    expect(isWalkingUnit(city)).toBe(true);
    const walked = city.tile();
    expect(walked).not.toBe(cityTile);
    // Вся оставшаяся дорога — врагу.
    landTiles().forEach((t) => {
      if (game.owner(t) === a && t !== walked) b.conquer(t);
    });
    ticks(TERRON_WALK_STUCK_TICKS + 3 * TERRON_WALK_STEP_TICKS);
    // Поход брошен: здание стоит там, где застала блокировка.
    expect(isWalkingUnit(city)).toBe(false);
    expect(city.tile()).toBe(walked);
  });
});

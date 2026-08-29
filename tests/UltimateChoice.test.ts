// terron: ультимейты — выбор одной ульты на матч (слот МИРВ): все, кроме
// МИРВ, — ЗДАНИЯ-штабы (одно на игрока, эффект пока живо). Фиксация выбора:
// первое успешное buildUnit (здание или МИРВ). Спека: new-units/ULTIMATES.md
import { AirborneAssaultExecution } from "../src/core/execution/AirborneAssaultExecution";
import { AirplaneExecution } from "../src/core/execution/AirplaneExecution";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { FortificationsExecution } from "../src/core/execution/FortificationsExecution";
import { MinistryOfTruthExecution } from "../src/core/execution/MinistryOfTruthExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { ReligionExecution } from "../src/core/execution/ReligionExecution";
import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  Ultimates,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";

let game: Game;
let player: Player;
let player2: Player;

describe("Ultimate choice + Ministry of Truth (terron)", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("player", PlayerType.Human, null, "player_id"),
      new PlayerInfo("player2", PlayerType.Human, null, "player2_id"),
    ]);
    player = game.player("player_id");
    player2 = game.player("player2_id");
    player.addGold(BigInt(100_000_000));
    player2.addGold(BigInt(100_000_000));
    game.config().structureMinDist = () => 0;
  });

  test("MIRV left the Ultimates group; Nuclear Factory replaces it", () => {
    // terron 06.08: Мин правды ВЛИТА В МЕДИА — из групп убрана (закомментирована).
    expect(Structures.has(UnitType.MinistryOfTruth)).toBe(false);
    expect(Ultimates.has(UnitType.MinistryOfTruth)).toBe(false);
    expect(Structures.has(UnitType.Media)).toBe(true);
    // terron: МИРВ БОЛЬШЕ НЕ прямой выбор ульты — его разблокирует Ядерный завод.
    expect(Ultimates.has(UnitType.MIRV)).toBe(false);
    expect(Ultimates.has(UnitType.NuclearFactory)).toBe(true);
    expect(Ultimates.has(UnitType.Media)).toBe(true);
  });

  test("Media base cost is 5M", () => {
    const cost = game.config().unitInfo(UnitType.Media).cost(game, player);
    expect(cost).toBe(5_000_000n);
  });

  test("no choice made → building ultimates buildable; MIRV needs the factory first", () => {
    const tile = game.ref(7, 10);
    player.conquer(tile);
    player.buildUnit(
      UnitType.MissileSilo,
      player.canBuild(UnitType.MissileSilo, tile) as number,
      {},
    );
    expect(player.ultimateChoice()).toBeNull();
    expect(player.canBuild(UnitType.Media, tile)).not.toBe(false);
    expect(player.canBuild(UnitType.NuclearFactory, tile)).not.toBe(false);
    // Мин правды влита в МЕДИА → отдельным зданием не строится.
    expect(player.canBuild(UnitType.MinistryOfTruth, tile)).toBe(false);
    // terron: МИРВ недоступен без живого Ядерного завода.
    expect(player.canBuild(UnitType.MIRV, tile)).toBe(false);
  });

  test("building Media fixes the choice and blocks MIRV forever", () => {
    const tile = game.ref(7, 10);
    const siloTile = game.ref(5, 10);
    player.conquer(tile);
    player.conquer(siloTile);
    // Силос есть → МИРВ был бы доступен, если бы не фиксация ульты.
    player.buildUnit(
      UnitType.MissileSilo,
      player.canBuild(UnitType.MissileSilo, siloTile) as number,
      {},
    );

    player.buildUnit(
      UnitType.Media,
      player.canBuild(UnitType.Media, tile) as number,
      {},
    );

    expect(player.ultimateChoice()).toBe(UnitType.Media);
    expect(player.canBuild(UnitType.MIRV, siloTile)).toBe(false);
  });

  test("building the Nuclear Factory fixes the choice, unlocks MIRV, blocks other ultimates", () => {
    const tile = game.ref(7, 10);
    const siloTile = game.ref(5, 10);
    player.conquer(tile);
    player.conquer(siloTile);
    player.buildUnit(
      UnitType.MissileSilo,
      player.canBuild(UnitType.MissileSilo, siloTile) as number,
      {},
    );
    // Без завода МИРВ недоступен.
    expect(player.canBuild(UnitType.MIRV, siloTile)).toBe(false);

    // Строим Ядерный завод → выбор ульты фиксируется на нём.
    player.buildUnit(
      UnitType.NuclearFactory,
      player.canBuild(UnitType.NuclearFactory, tile) as number,
      {},
    );

    expect(player.ultimateChoice()).toBe(UnitType.NuclearFactory);
    // Завод достроен (instantBuild) → МИРВ разблокирован.
    expect(player.canBuild(UnitType.MIRV, siloTile)).not.toBe(false);
    // Другая ульта после фиксации недоступна.
    expect(player.canBuild(UnitType.MinistryOfTruth, tile)).toBe(false);
  });

  // terron 06.08: было «до двух Мин правды», стало — ОДНА МЕДИА (носитель ауры).
  test("only one Media per player; the second is blocked", () => {
    const t1 = game.ref(7, 10);
    const t2 = game.ref(3, 10);
    player.conquer(t1);
    player.conquer(t2);
    player.buildUnit(
      UnitType.Media,
      player.canBuild(UnitType.Media, t1) as number,
      {},
    );
    expect(player.canBuild(UnitType.Media, t2)).toBe(false);
  });

  test("ConstructionExecution builds Media like any structure", () => {
    const tile = game.ref(7, 10);
    player.conquer(tile);
    const spawn = player.canBuild(UnitType.Media, tile);
    expect(spawn).not.toBe(false);

    const exec = new ConstructionExecution(
      player,
      UnitType.Media,
      spawn as number,
    );
    exec.init(game, 0);
    exec.tick(0); // instantBuild

    expect(player.unitCount(UnitType.Media)).toBe(1);
    expect(player.ultimateChoice()).toBe(UnitType.Media);
  });

  test("Media aura drains troops from a hostile player and feeds the owner", () => {
    const ministryTile = game.ref(3, 10);
    const enemyTile = game.ref(7, 10);
    player.conquer(ministryTile);
    player2.conquer(enemyTile);
    player.addTroops(10_000);
    player2.addTroops(100_000);

    const ministry = player.buildUnit(
      UnitType.Media,
      player.canBuild(UnitType.Media, ministryTile) as number,
      {},
    );

    const ownerBefore = player.troops();
    const victimBefore = player2.troops();

    // Через игровой цикл (тики должны идти) — без PlayerExecution нет регена,
    // изменения войск = только аура министерства.
    game.addExecution(new MinistryOfTruthExecution(ministry));
    for (let t = 0; t < 35; t++) game.executeNextTick();

    expect(player2.troops()).toBeLessThan(victimBefore);
    expect(player.troops()).toBeGreaterThan(ownerBefore);
    // Два счётчика: «враги потеряли» = дельта жертвы, «ты получил» = дельта
    // владельца (без PlayerExecution нет регена → дельты чистые).
    expect(ministry.stolenTroops()).toBe(
      Number(victimBefore - player2.troops()),
    );
    expect(ministry.gainedTroops()).toBe(Number(player.troops() - ownerBefore));
    expect(player.ultStats().stolen).toBe(ministry.stolenTroops());
    expect(player.ultStats().stolenGained).toBe(ministry.gainedTroops());
  });

  // terron: ультимейты — Укрепления: ЗДАНИЕ-штаб.
  test("building the Fortifications HQ fixes the choice and blocks others", () => {
    const tile = game.ref(7, 10);
    const other = game.ref(3, 10);
    player.conquer(tile);
    player.conquer(other);

    player.buildUnit(
      UnitType.Fortifications,
      player.canBuild(UnitType.Fortifications, tile) as number,
      {},
    );

    expect(player.ultimateChoice()).toBe(UnitType.Fortifications);
    expect(player.hasUltimate(UnitType.Fortifications)).toBe(true);
    expect(player.canBuild(UnitType.MinistryOfTruth, other)).toBe(false);
    // И второй штаб укреплений тоже нельзя.
    expect(player.canBuild(UnitType.Fortifications, other)).toBe(false);
  });

  test("Fortifications HQ: defense post seizes adjacent hostile land while HQ stands", () => {
    const hqTile = game.ref(3, 10);
    const postTile = game.ref(5, 10);
    const enemyTile = game.ref(6, 10);
    player.conquer(hqTile);
    player.conquer(postTile);
    player2.conquer(enemyTile);

    const hq = player.buildUnit(
      UnitType.Fortifications,
      player.canBuild(UnitType.Fortifications, hqTile) as number,
      {},
    );
    player.buildUnit(
      UnitType.DefensePost,
      player.canBuild(UnitType.DefensePost, postTile) as number,
      {},
    );
    game.addExecution(new FortificationsExecution(hq));

    const myTilesBefore = player.numTilesOwned();
    for (let t = 0; t < 40; t++) game.executeNextTick();

    // Фронт пополз: соседний вражеский тайл отжат, территория выросла.
    expect(game.owner(enemyTile)).toBe(player);
    expect(player.numTilesOwned()).toBeGreaterThan(myTilesBefore);
    // Метрика «захвачено бункерами» = ровно прирост территории.
    expect(player.ultStats().fortTiles).toBe(
      player.numTilesOwned() - myTilesBefore,
    );

    // Штаб снесли → автозахват прекращается.
    hq.delete(false);
    const frozen = player.numTilesOwned();
    for (let t = 0; t < 30; t++) game.executeNextTick();
    expect(player.numTilesOwned()).toBe(frozen);
  });

  // terron: ПРОВЕРКА гипотезы «бункер на воде не работает». Ставим бункер на
  // ПРИБРЕЖНЫЙ тайл (у него есть сосед-вода), а вражескую ЗЕМЛЮ — на сухопутного
  // соседа. Если захватит → позиция бункера на воде НЕ влияет (влияет только
  // сухопутная граница цели с нашей землёй).
  test("Fortifications: bunker on a water-touching tile still seizes a land-bordered enemy", () => {
    const W = game.width();
    const H = game.height();
    // Ищем тайл суши с ≥1 соседом-водой и ≥3 соседями-сушей (для нас+врага+штаб).
    let coast = -1;
    let landNbrs: number[] = [];
    for (let y = 2; y < H - 2 && coast < 0; y++) {
      for (let x = 2; x < W - 2; x++) {
        const t = game.ref(x, y);
        if (!game.isLand(t)) continue;
        const nbrs = game.neighbors(t);
        const water = nbrs.some((n) => !game.isLand(n));
        const land = nbrs.filter((n) => game.isLand(n));
        if (water && land.length >= 3) {
          coast = t;
          landNbrs = land;
          break;
        }
      }
    }
    expect(coast).toBeGreaterThanOrEqual(0); // прибрежный тайл найден
    // подтверждаем: бункерный тайл РЕАЛЬНО касается воды
    expect(game.neighbors(coast).some((n) => !game.isLand(n))).toBe(true);

    const hqTile = landNbrs[0]; // штаб — на суше рядом
    const enemyTile = landNbrs[1]; // враг — на суше, СОСЕД прибрежного тайла
    player.conquer(coast);
    player.conquer(hqTile);
    player2.conquer(enemyTile);

    const hq = player.buildUnit(
      UnitType.Fortifications,
      player.canBuild(UnitType.Fortifications, hqTile) as number,
      {},
    );
    player.buildUnit(
      UnitType.DefensePost,
      player.canBuild(UnitType.DefensePost, coast) as number,
      {},
    );
    game.addExecution(new FortificationsExecution(hq));

    for (let t = 0; t < 40; t++) game.executeNextTick();

    // Враг на суше, примыкающий к нашей земле, отжат — хотя бункер стоит у воды.
    expect(game.owner(enemyTile)).toBe(player);
  });

  // terron: ультимейты — снос и перестройка штаба (лимит 1 живой).
  test("ult HQ can be rebuilt after demolition and the effect resumes", () => {
    const t1 = game.ref(3, 10);
    const t2 = game.ref(7, 10);
    player.conquer(t1);
    player.conquer(t2);

    const hq1 = player.buildUnit(
      UnitType.CentralBank,
      player.canBuild(UnitType.CentralBank, t1) as number,
      {},
    );
    expect(player.hasUltimate(UnitType.CentralBank)).toBe(true);
    // Пока штаб жив — второй нельзя.
    expect(player.canBuild(UnitType.CentralBank, t2)).toBe(false);

    // Снесли: эффект пропал, строить можно снова.
    hq1.delete(false);
    expect(player.hasUltimate(UnitType.CentralBank)).toBe(false);
    expect(player.canBuild(UnitType.CentralBank, t2)).not.toBe(false);

    // Перестроили в другом месте — эффект вернулся (кэш _ultBuilding обновлён).
    player.buildUnit(
      UnitType.CentralBank,
      player.canBuild(UnitType.CentralBank, t2) as number,
      {},
    );
    expect(player.hasUltimate(UnitType.CentralBank)).toBe(true);
    // Выбор при этом остался зафиксирован — другие ульты по-прежнему нельзя.
    expect(player.canBuild(UnitType.MinistryOfTruth, t1)).toBe(false);
  });

  // terron: ультимейты — Центробанк.
  test("Central Bank: trade ships of the owner are protected (hasUltimate)", () => {
    const tile = game.ref(7, 10);
    player.conquer(tile);
    expect(player.hasUltimate(UnitType.CentralBank)).toBe(false);
    player.buildUnit(
      UnitType.CentralBank,
      player.canBuild(UnitType.CentralBank, tile) as number,
      {},
    );
    expect(player.hasUltimate(UnitType.CentralBank)).toBe(true);
    expect(player.ultimateChoice()).toBe(UnitType.CentralBank);
  });

  test("flyover commission: foreign player earns from overflight; Central Bank exempts", () => {
    // Аэропорты по краям, враг владеет полосой посередине — путь над ним.
    const a1t = game.ref(1, 10);
    const a2t = game.ref(7, 10);
    player.conquer(a1t);
    player.conquer(a2t);
    for (const x of [4, 5]) player2.conquer(game.ref(x, 10));

    const a1 = player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, a1t) as number,
      {},
    );
    const a2 = player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, a2t) as number,
      {},
    );

    const before2 = player2.gold();
    const exec = new AirplaneExecution(player, a1, a2);
    exec.init(game, 0);
    let t = 0;
    while (exec.isActive() && t < 300) {
      exec.tick(t);
      t++;
    }
    // Чужой игрок заработал комиссию за пролёт.
    expect(player2.gold() > before2).toBe(true);

    // Теперь с Центробанком — комиссии нет.
    const bankTile = game.ref(2, 10);
    player.conquer(bankTile);
    player.buildUnit(
      UnitType.CentralBank,
      player.canBuild(UnitType.CentralBank, bankTile) as number,
      {},
    );
    const before2b = player2.gold();
    const exec2 = new AirplaneExecution(player, a1, a2);
    exec2.init(game, 0);
    t = 0;
    while (exec2.isActive() && t < 300) {
      exec2.tick(t);
      t++;
    }
    expect(player2.gold()).toBe(before2b);
  });

  // terron: ультимейты — Авиаштаб.
  test("Air Command: airborne assaults are free and beachhead holds 60s", () => {
    const hqTile = game.ref(3, 10);
    const airportTile = game.ref(2, 10);
    const enemyTile = game.ref(7, 10);
    player.conquer(hqTile);
    player.conquer(airportTile);
    player2.conquer(enemyTile);
    player.addTroops(50_000);

    player.buildUnit(
      UnitType.AirCommand,
      player.canBuild(UnitType.AirCommand, hqTile) as number,
      {},
    );
    player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, airportTile) as number,
      {},
    );

    // Цена десанта = 0 (вместо 100k+).
    const cost = game
      .config()
      .unitInfo(UnitType.AirborneAssault)
      .cost(game, player);
    expect(cost).toBe(0n);

    const goldBefore = player.gold();
    const exec = new AirborneAssaultExecution(player, enemyTile, 5_000);
    exec.init(game, 0);
    expect(player.gold()).toBe(goldBefore); // бесплатно
    let t = 1;
    while (exec.isActive() && t < 400) {
      exec.tick(t);
      t++;
    }
    // Плацдарм живёт 60с (599-й тик ещё активен; без ульты было бы 300).
    expect(player.activeAirborneBeachheads(599).size).toBeGreaterThan(0);
  });

  // terron: ультимейты — Танковый завод (нужна НАСТОЯЩАЯ attackLogic,
  // TestConfig по умолчанию плющит её в 1/1/1).
  test("Tank Factory: attacks ignore enemy defense post bonus", async () => {
    const g = await setup(
      "half_land_half_ocean",
      { instantBuild: true },
      [
        new PlayerInfo("p1", PlayerType.Human, null, "p1_id"),
        new PlayerInfo("p2", PlayerType.Human, null, "p2_id"),
      ],
      undefined,
      UseRealAttackLogic,
    );
    const p1 = g.player("p1_id");
    const p2 = g.player("p2_id");
    p1.addGold(BigInt(100_000_000));
    p2.addGold(BigInt(100_000_000));
    g.config().structureMinDist = () => 0;

    const postTile = g.ref(6, 10);
    const targetTile = g.ref(7, 10);
    p2.conquer(postTile);
    p2.conquer(targetTile);
    p2.buildUnit(
      UnitType.DefensePost,
      p2.canBuild(UnitType.DefensePost, postTile) as number,
      {},
    );

    const lossBefore = g
      .config()
      .attackLogic(g, 10_000, p1, p2, targetTile).attackerTroopLoss;

    const hqTile = g.ref(2, 10);
    p1.conquer(hqTile);
    p1.buildUnit(
      UnitType.TankFactory,
      p1.canBuild(UnitType.TankFactory, hqTile) as number,
      {},
    );

    const lossAfter = g
      .config()
      .attackLogic(g, 10_000, p1, p2, targetTile).attackerTroopLoss;

    // С танками бонус бункера не применяется → потери атакующего меньше.
    expect(lossAfter).toBeLessThan(lossBefore);
  });

  test("Tank Factory makes the owner's attack 15% stronger (no bunker)", async () => {
    const g = await setup(
      "half_land_half_ocean",
      { instantBuild: true },
      [
        new PlayerInfo("p1", PlayerType.Human, null, "p1_id"),
        new PlayerInfo("p2", PlayerType.Human, null, "p2_id"),
      ],
      undefined,
      UseRealAttackLogic,
    );
    const p1 = g.player("p1_id");
    const p2 = g.player("p2_id");
    p1.addGold(BigInt(100_000_000));
    g.config().structureMinDist = () => 0;

    const targetTile = g.ref(7, 10);
    p2.conquer(targetTile);
    p2.conquer(g.ref(6, 10));

    // Без бункера: единственная разница — множитель танков (−15% потерь).
    const before = g
      .config()
      .attackLogic(g, 10_000, p1, p2, targetTile).attackerTroopLoss;

    const hqTile = g.ref(2, 10);
    p1.conquer(hqTile);
    p1.buildUnit(
      UnitType.TankFactory,
      p1.canBuild(UnitType.TankFactory, hqTile) as number,
      {},
    );

    const after = g
      .config()
      .attackLogic(g, 10_000, p1, p2, targetTile).attackerTroopLoss;

    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(before * 0.85, 5);
  });

  test("Ministry aura does not touch the owner's own troops", () => {
    const ministryTile = game.ref(3, 10);
    player.conquer(ministryTile);
    player.conquer(game.ref(4, 10));
    player.addTroops(50_000);

    const ministry = player.buildUnit(
      UnitType.Media,
      player.canBuild(UnitType.Media, ministryTile) as number,
      {},
    );

    const before = player.troops();
    game.addExecution(new MinistryOfTruthExecution(ministry));
    for (let t = 0; t < 35; t++) game.executeNextTick();

    expect(player.troops()).toBe(before);
  });

  // ── Религия (Religion): храм-штаб, вся территория медленно расползается ──────
  test("Religion is a structure + ultimate; base cost is 5M", () => {
    expect(Structures.has(UnitType.Religion)).toBe(true);
    expect(Ultimates.has(UnitType.Religion)).toBe(true);
    const cost = game.config().unitInfo(UnitType.Religion).cost(game, player);
    expect(cost).toBe(5_000_000n);
  });

  test("Religion temples are unlimited: building fixes the choice, a third temple is fine", () => {
    const tile = game.ref(3, 10);
    const other = game.ref(5, 10);
    const third = game.ref(7, 10);
    player.conquer(tile);
    player.conquer(other);
    player.conquer(third);

    player.buildUnit(
      UnitType.Religion,
      player.canBuild(UnitType.Religion, tile) as number,
      {},
    );

    expect(player.ultimateChoice()).toBe(UnitType.Religion);
    expect(player.hasUltimate(UnitType.Religion)).toBe(true);
    // Другой ульт-штаб недоступен (один выбор на матч)…
    expect(player.canBuild(UnitType.Fortifications, other)).toBe(false);
    // …а храмов — сколько угодно (ремейк 06.08: лимита копий больше нет).
    expect(player.canBuild(UnitType.Religion, other)).not.toBe(false);
    player.buildUnit(
      UnitType.Religion,
      player.canBuild(UnitType.Religion, other) as number,
      {},
    );
    expect(player.canBuild(UnitType.Religion, third)).not.toBe(false);
    player.buildUnit(
      UnitType.Religion,
      player.canBuild(UnitType.Religion, third) as number,
      {},
    );
    expect(player.ultimateCount(UnitType.Religion)).toBe(3);
  });

  test("Religion HQ: neutral wasteland is NOT converted (nobody there to convert)", () => {
    // Компактный кусок земли, вокруг — только ничейная суша.
    const hqTile = game.ref(3, 10);
    player.conquer(hqTile);
    player.conquer(game.ref(2, 10));
    player.conquer(game.ref(4, 10));
    player.conquer(game.ref(3, 9));
    player.conquer(game.ref(3, 11));

    const hq = player.buildUnit(
      UnitType.Religion,
      player.canBuild(UnitType.Religion, hqTile) as number,
      {},
    );
    game.addExecution(new ReligionExecution(hq));

    const before = player.numTilesOwned();
    for (let t = 0; t < 130; t++) game.executeNextTick();

    expect(player.numTilesOwned()).toBe(before);
    expect(player.ultStats().religionTiles).toBe(0);
  });

  test("Religion HQ: converts a neighbour's land quietly; deleting the HQ stops it", () => {
    // Наш блок 2×2 в углу суши, вся остальная суша — у соседа.
    for (let y = 1; y <= 2; y++)
      for (let x = 1; x <= 2; x++) player.conquer(game.ref(x, y));
    for (let y = 0; y <= 15; y++)
      for (let x = 0; x <= 7; x++) {
        const t = game.ref(x, y);
        if (game.owner(t) !== player) player2.conquer(t);
      }

    const hqTile = game.ref(1, 1);
    const hq = player.buildUnit(
      UnitType.Religion,
      player.canBuild(UnitType.Religion, hqTile) as number,
      {},
    );
    game.addExecution(new ReligionExecution(hq));

    const before = player.numTilesOwned();
    const victimBefore = player2.numTilesOwned();
    // Полный обход границы = PERIOD (100 тиков); гоняем чуть больше кольца.
    for (let t = 0; t < 130; t++) game.executeNextTick();

    const gained = player.numTilesOwned() - before;
    expect(gained).toBeGreaterThan(0);
    // Взято ровно у соседа, и метрика «обращено» = приросту.
    expect(victimBefore - player2.numTilesOwned()).toBe(gained);
    expect(player.ultStats().religionTiles).toBe(gained);

    // Снесли храм → рост немедленно прекращается.
    hq.delete(false);
    const frozen = player.numTilesOwned();
    for (let t = 0; t < 60; t++) game.executeNextTick();
    expect(player.numTilesOwned()).toBe(frozen);
  });

  test("Religion HQ: faith goes silent toward anyone with an active front", () => {
    for (let y = 1; y <= 2; y++)
      for (let x = 1; x <= 2; x++) player.conquer(game.ref(x, y));
    for (let y = 0; y <= 15; y++)
      for (let x = 0; x <= 7; x++) {
        const t = game.ref(x, y);
        if (game.owner(t) !== player) player2.conquer(t);
      }

    const hqTile = game.ref(1, 1);
    const hq = player.buildUnit(
      UnitType.Religion,
      player.canBuild(UnitType.Religion, hqTile) as number,
      {},
    );
    game.addExecution(new ReligionExecution(hq));

    // Идёт бой: сосед атакует нас → вера на него не действует.
    const attack = player2.createAttack(player, 100, null, new Set());
    const before = player.numTilesOwned();
    for (let t = 0; t < 130; t++) game.executeNextTick();
    expect(player.numTilesOwned()).toBe(before);
    expect(player.ultStats().religionTiles).toBe(0);

    // Бой кончился → со следующего обхода рост возобновляется.
    attack.delete();
    for (let t = 0; t < 130; t++) game.executeNextTick();
    expect(player.numTilesOwned()).toBeGreaterThan(before);
  });

  test("Religion: one sweep per player — a 2nd temple adds +1 tile/border, not a 2nd sweep", async () => {
    // Одинаковая расстановка в двух играх: 1 храм (квота 3) vs 2 храма (квота 4).
    // Старое поведение (свой обход у каждого храма) дало бы 3+5=8 → рост ×2.67.
    const convertedWith = async (temples: number): Promise<number> => {
      const g = await setup("half_land_half_ocean", { instantBuild: true }, [
        new PlayerInfo("a", PlayerType.Human, null, "a_id"),
        new PlayerInfo("b", PlayerType.Human, null, "b_id"),
      ]);
      g.config().structureMinDist = () => 0;
      const a = g.player("a_id");
      const b = g.player("b_id");
      a.addGold(BigInt(100_000_000));
      for (let y = 1; y <= 2; y++)
        for (let x = 1; x <= 2; x++) a.conquer(g.ref(x, y));
      for (let y = 0; y <= 15; y++)
        for (let x = 0; x <= 7; x++) {
          const t = g.ref(x, y);
          if (g.owner(t) !== a) b.conquer(t);
        }
      const spots = [g.ref(1, 1), g.ref(2, 2)];
      for (let i = 0; i < temples; i++) {
        const hq = a.buildUnit(
          UnitType.Religion,
          a.canBuild(UnitType.Religion, spots[i]) as number,
          {},
        );
        g.addExecution(new ReligionExecution(hq));
      }
      expect(a.ultimateCount(UnitType.Religion)).toBe(temples);
      // Ровно ОДИН обход: граница = 4 тайла, за тик обрабатывается один тайл
      // (perTick = max(1, len/PERIOD)) → 4 тика на обход + 1 тик прогрева
      // (исполнение включается со следующего). Карта 16×16 маленькая, дольше
      // гонять нельзя — сосед просто кончится и оба замера упрутся в потолок.
      for (let t = 0; t < 5; t++) g.executeNextTick();
      return a.ultStats().religionTiles;
    };

    // 4 пограничных тайла × квота (2+N): 1 храм → 12, 2 храма → 16.
    // Старое поведение (свой обход у каждого) дало бы 4×(3+5) = 32.
    expect(await convertedWith(1)).toBe(12);
    expect(await convertedWith(2)).toBe(16);
  });

  test("Religion HQ: tithe compounds per temple (×0.9^N) and stops when demolished", () => {
    const first = game.ref(3, 10);
    const second = game.ref(5, 10);
    player.conquer(first);
    player.conquer(second);
    player.conquer(game.ref(3, 11));

    const rate = game.config().goldAdditionRate(player);
    const afterTithe = (n: number): bigint => {
      let g = rate;
      for (let i = 0; i < n; i++) g -= g / 10n;
      return g;
    };

    const hq1 = player.buildUnit(
      UnitType.Religion,
      player.canBuild(UnitType.Religion, first) as number,
      {},
    );
    // Доход золота считается в PlayerExecution (в этих тестах спавна нет — добавляем сами).
    game.addExecution(new PlayerExecution(player));
    game.executeNextTick(); // прогрев: исполнение включается со следующего тика

    const TICKS = 10;
    // Один храм: −10% от дохода за тик.
    const base1 = player.ultStats().religionTithe;
    for (let t = 0; t < TICKS; t++) game.executeNextTick();
    expect(player.ultStats().religionTithe - base1).toBe(
      Number(rate - afterTithe(1)) * TICKS,
    );

    // Второй храм: режет ещё 10% от ТЕКУЩЕГО (100 → 90 → 81), а не −20%.
    player.buildUnit(
      UnitType.Religion,
      player.canBuild(UnitType.Religion, second) as number,
      {},
    );
    const base2 = player.ultStats().religionTithe;
    for (let t = 0; t < TICKS; t++) game.executeNextTick();
    expect(player.ultStats().religionTithe - base2).toBe(
      Number(rate - afterTithe(2)) * TICKS,
    );

    // Снесли оба храма → десятина больше не растёт (дебаф только пока храм жив).
    hq1.delete(false);
    for (const u of player.units(UnitType.Religion)) u.delete(false);
    const frozen = player.ultStats().religionTithe;
    for (let t = 0; t < 20; t++) game.executeNextTick();
    expect(player.ultStats().religionTithe).toBe(frozen);
  });

  // ── Минирование (Mining): пассив-штаб, 50% морского десанта гибнет ──────────
  test("Mining is a structure + ultimate; base cost is 5M; building fixes choice", () => {
    expect(Structures.has(UnitType.Mining)).toBe(true);
    expect(Ultimates.has(UnitType.Mining)).toBe(true);
    const cost = game.config().unitInfo(UnitType.Mining).cost(game, player);
    expect(cost).toBe(5_000_000n);

    const tile = game.ref(3, 10);
    const other = game.ref(5, 10);
    player.conquer(tile);
    player.conquer(other);
    player.buildUnit(
      UnitType.Mining,
      player.canBuild(UnitType.Mining, tile) as number,
      {},
    );
    expect(player.ultimateChoice()).toBe(UnitType.Mining);
    expect(player.hasUltimate(UnitType.Mining)).toBe(true);
    // Другой ульт-штаб теперь недоступен (один выбор на матч).
    expect(player.canBuild(UnitType.Religion, other)).toBe(false);
  });

  // terron: ульты ВЫКЛЮЧЕНЫ в лобби (все ульт-здания disabled) → МИРВ работает
  // КАК В ОРИГИНАЛЕ: только силос, без Ядерного завода. new-units/ULTIMATES.md
  test("ultimates disabled → MIRV works like the original (silo only, no factory)", async () => {
    const g = await setup(
      "half_land_half_ocean",
      {
        instantBuild: true,
        disabledUnits: [...Ultimates.types],
      },
      [
        new PlayerInfo("p1", PlayerType.Human, null, "p1_id"),
        new PlayerInfo("p2", PlayerType.Human, null, "p2_id"),
      ],
    );
    const p1 = g.player("p1_id");
    p1.addGold(BigInt(100_000_000));
    g.config().structureMinDist = () => 0;

    const siloTile = g.ref(5, 10);
    const factoryTile = g.ref(7, 10);
    p1.conquer(siloTile);
    p1.conquer(factoryTile);

    // Завод недоступен (ульты выключены).
    expect(g.config().isUnitDisabled(UnitType.NuclearFactory)).toBe(true);
    expect(p1.canBuild(UnitType.NuclearFactory, factoryTile)).toBe(false);

    // Без силоса МИРВ нельзя (базовое правило оригинала).
    expect(p1.canBuild(UnitType.MIRV, siloTile)).toBe(false);

    // Ставим силос → МИРВ доступен БЕЗ завода, как в оригинале.
    p1.buildUnit(
      UnitType.MissileSilo,
      p1.canBuild(UnitType.MissileSilo, siloTile) as number,
      {},
    );
    expect(p1.canBuild(UnitType.MIRV, siloTile)).not.toBe(false);
    // Выбор ульты при этом НЕ фиксируется (МИРВ — не ульта).
    expect(p1.ultimateChoice()).toBeNull();
  });

  test("Religion eats even an ALLY's land (unlike Fortifications)", () => {
    const hqTile = game.ref(6, 10);
    const mine = game.ref(6, 11);
    const allyTile = game.ref(6, 9); // земля союзника вплотную к нашей границе
    player.conquer(hqTile);
    player.conquer(mine);
    player2.conquer(allyTile);

    // Союз player↔player2 (сначала соседство землёй, иначе заявка невалидна).
    game.addExecution(new AllianceRequestExecution(player, player2.id()));
    game.addExecution(new AllianceRequestExecution(player2, player.id()));
    for (let t = 0; t < 3; t++) game.executeNextTick();
    expect(player.isFriendly(player2)).toBe(true);

    const hq = player.buildUnit(
      UnitType.Religion,
      player.canBuild(UnitType.Religion, hqTile) as number,
      {},
    );
    game.addExecution(new ReligionExecution(hq));

    for (let t = 0; t < 130; t++) game.executeNextTick();

    // Союзная земля всё равно обращена (вера не разбирает).
    expect(game.owner(allyTile)).toBe(player);
  });
});

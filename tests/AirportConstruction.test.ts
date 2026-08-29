// terron: авиация — фаза 1 (структура) + фаза 2 (экономика) + фаза 3 (высадка). airport.md
import { AirborneAssaultExecution } from "../src/core/execution/AirborneAssaultExecution";
import { AirplaneExecution } from "../src/core/execution/AirplaneExecution";
import { AirportExecution } from "../src/core/execution/AirportExecution";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { SAMLauncherExecution } from "../src/core/execution/SAMLauncherExecution";
import {
  detonateDroneBlast,
  SuicideDroneExecution,
} from "../src/core/execution/SuicideDroneExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;

describe("Airport construction (terron)", () => {
  let player2: Player;

  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("player", PlayerType.Human, null, "player_id"),
      new PlayerInfo("player2", PlayerType.Human, null, "player2_id"),
    ]);
    player = game.player("player_id");
    player2 = game.player("player2_id");
    player.addGold(BigInt(10_000_000));
    player2.addGold(BigInt(10_000_000));
    game.config().structureMinDist = () => 0;
  });

  test("Airport is registered as a buildable structure", () => {
    expect(Structures.has(UnitType.Airport)).toBe(true);
  });

  test("Airport has a large coverage range", () => {
    expect(game.config().airportRange()).toBeGreaterThanOrEqual(150);
  });

  test("Airport base cost is 750k", () => {
    const airportCost = game
      .config()
      .unitInfo(UnitType.Airport)
      .cost(game, player);
    expect(airportCost).toBe(750_000n);
  });

  test("Player can build an Airport on owned land", () => {
    const tile = game.ref(7, 10);
    player.conquer(tile);

    const spawn = player.canBuild(UnitType.Airport, tile);
    expect(spawn).not.toBe(false);

    const exec = new ConstructionExecution(
      player,
      UnitType.Airport,
      spawn as number,
    );
    exec.init(game, 0);
    // instantBuild → structure built + completed within a tick
    exec.tick(0);

    expect(player.unitCount(UnitType.Airport)).toBe(1);
  });

  test("Airplane between two own airports pays gold and self-destructs", () => {
    const t1 = game.ref(2, 10);
    const t2 = game.ref(7, 10);
    player.conquer(t1);
    player.conquer(t2);
    const s1 = player.canBuild(UnitType.Airport, t1);
    const s2 = player.canBuild(UnitType.Airport, t2);
    expect(s1).not.toBe(false);
    expect(s2).not.toBe(false);
    const a1 = player.buildUnit(UnitType.Airport, s1 as number, {});
    const a2 = player.buildUnit(UnitType.Airport, s2 as number, {});

    const before = player.gold();
    const exec = new AirplaneExecution(player, a1, a2);
    exec.init(game, 0);
    let t = 0;
    while (exec.isActive() && t < 300) {
      exec.tick(t);
      t++;
    }
    expect(exec.isActive()).toBe(false);
    expect(player.gold() > before).toBe(true);
    // Plane removed itself after arrival.
    expect(player.unitCount(UnitType.Airplane)).toBe(0);
  });

  test("Airport near an OWN factory joins the rail network as a station", () => {
    const fTile = game.ref(3, 10);
    const aTile = game.ref(5, 10);
    player.conquer(fTile);
    player.conquer(aTile);
    player.buildUnit(
      UnitType.Factory,
      player.canBuild(UnitType.Factory, fTile) as number,
      {},
    );
    const airport = player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, aTile) as number,
      {},
    );
    expect(airport.hasTrainStation()).toBe(false);

    const exec = new AirportExecution(airport);
    exec.init(game, 0);
    for (let t = 0; t < 5; t++) exec.tick(t);

    expect(airport.hasTrainStation()).toBe(true);
  });

  test("Airport checks for a factory ONCE (like a city), not every tick", () => {
    const aTile = game.ref(5, 10);
    player.conquer(aTile);
    const airport = player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, aTile) as number,
      {},
    );
    const exec = new AirportExecution(airport);
    exec.init(game, 0);
    // No factory at build time → the one-time check finds nothing.
    for (let t = 0; t < 5; t++) exec.tick(t);
    expect(airport.hasTrainStation()).toBe(false);

    // A factory appears later, but its FactoryExecution is NOT run (no grant).
    const fTile = game.ref(3, 10);
    player.conquer(fTile);
    player.buildUnit(
      UnitType.Factory,
      player.canBuild(UnitType.Factory, fTile) as number,
      {},
    );
    // The airport must NOT self-create a station on later ticks — exactly like a
    // city, it relies on the factory's own grant, not a per-tick radius scan.
    for (let t = 5; t < 20; t++) exec.tick(t);
    expect(airport.hasTrainStation()).toBe(false);
  });

  test("Airplane respects the dispatch delay before spawning", () => {
    const t1 = game.ref(2, 10);
    const t2 = game.ref(7, 10);
    player.conquer(t1);
    player.conquer(t2);
    const a1 = player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, t1) as number,
      {},
    );
    const a2 = player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, t2) as number,
      {},
    );

    const exec = new AirplaneExecution(player, a1, a2, 20);
    exec.init(game, 0);
    // During the delay window, no plane is airborne yet.
    for (let t = 0; t < 20; t++) exec.tick(t);
    expect(player.unitCount(UnitType.Airplane)).toBe(0);

    // After the delay it flies and pays out.
    const before = player.gold();
    let t = 20;
    while (exec.isActive() && t < 400) {
      exec.tick(t);
      t++;
    }
    expect(player.gold() > before).toBe(true);
  });

  test("Airborne assault flies troops from nearest airport onto an enemy tile", () => {
    const airportTile = game.ref(2, 10);
    const enemyTile = game.ref(7, 10);
    player.conquer(airportTile);
    player2.conquer(enemyTile);
    player.addTroops(50_000);
    player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, airportTile) as number,
      {},
    );

    const troopsBefore = player.troops();
    const exec = new AirborneAssaultExecution(player, enemyTile, 5_000);
    exec.init(game, 0);
    // Craft spawned at the airport; troops deducted from the attacker.
    expect(player.unitCount(UnitType.AirborneAssault)).toBe(1);
    expect(player.troops()).toBeLessThan(troopsBefore);

    let t = 1;
    while (exec.isActive() && t < 400) {
      exec.tick(t);
      t++;
    }
    expect(exec.isActive()).toBe(false);
    // Craft consumed on arrival (landed → conquer + attack).
    expect(game.unitCount(UnitType.AirborneAssault)).toBe(0);
  });

  test("SAM fires a missile that shoots down an enemy airborne assault", () => {
    const samTile = game.ref(4, 10);
    const airportTile = game.ref(1, 10);
    const targetTile = game.ref(7, 10);
    player.conquer(samTile);
    player.conquer(targetTile);
    player2.conquer(airportTile);
    player2.addTroops(50_000);

    const sam = player.buildUnit(
      UnitType.SAMLauncher,
      player.canBuild(UnitType.SAMLauncher, samTile) as number,
      {},
    );
    player2.buildUnit(
      UnitType.Airport,
      player2.canBuild(UnitType.Airport, airportTile) as number,
      {},
    );

    // Drive via the game's execution queue so the spawned SAM missile actually flies.
    game.addExecution(new SAMLauncherExecution(player, null, sam));
    game.addExecution(new AirborneAssaultExecution(player2, targetTile, 5_000));

    for (
      let t = 0;
      t < 400 && game.unitCount(UnitType.AirborneAssault) > 0;
      t++
    ) {
      game.executeNextTick();
    }
    // Shot down by a missile before landing: craft gone, target still ours.
    expect(game.unitCount(UnitType.AirborneAssault)).toBe(0);
    expect(game.owner(targetTile)).toBe(player);
  });

  test("Airborne assault: sent x1 deducted, only x0.5 reaches the landing", () => {
    const airportTile = game.ref(2, 10);
    const enemyTile = game.ref(7, 10);
    player.conquer(airportTile);
    player2.conquer(enemyTile);
    player.addTroops(100_000);
    player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, airportTile) as number,
      {},
    );

    const before = player.troops();
    const SEND = 40_000;
    const exec = new AirborneAssaultExecution(player, enemyTile, SEND);
    exec.init(game, 0);
    // Full amount deducted at spawn (send x1).
    expect(player.troops()).toBe(before - SEND);

    let t = 1;
    while (exec.isActive() && t < 400) {
      exec.tick(t);
      t++;
    }
    for (let i = 0; i < 60; i++) game.executeNextTick(); // resolve the AttackExecution

    // At most SEND/2 was ever committed to the attack (rear-landing penalty), so at most
    // that can retreat back — never more. No PlayerExecution here → no troop regen noise.
    expect(player.troops()).toBeLessThanOrEqual(before - SEND / 2);
  });

  // terron: регресс прод-краша 2026-07-07 «cannot conquer water» — десант,
  // отправленный в море, долетал и conquer(вода) ронял всю симуляцию.
  test("Airborne assault to a WATER tile is rejected (no crash)", () => {
    const airportTile = game.ref(2, 10);
    player.conquer(airportTile);
    player.addTroops(50_000);
    player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, airportTile) as number,
      {},
    );

    // Ищем воду на карте (half_land_half_ocean гарантирует её наличие).
    let waterTile: number | null = null;
    outer: for (let y = 0; y < game.height(); y++) {
      for (let x = 0; x < game.width(); x++) {
        const t = game.ref(x, y);
        if (!game.isLand(t)) {
          waterTile = t;
          break outer;
        }
      }
    }
    expect(waterTile).not.toBeNull();

    const troopsBefore = player.troops();
    const exec = new AirborneAssaultExecution(player, waterTile!, 5_000);
    exec.init(game, 0);
    // Отклонено на старте: борт не создан, войска не списаны, тиков не будет.
    expect(exec.isActive()).toBe(false);
    expect(player.unitCount(UnitType.AirborneAssault)).toBe(0);
    expect(player.troops()).toBe(troopsBefore);
    // И даже насильный arrive-путь не кидает (гард в arrive).
    for (let t = 0; t < 5; t++) exec.tick(t);
  });

  test("Airborne assault with no airport does nothing", () => {
    const enemyTile = game.ref(7, 10);
    player2.conquer(enemyTile);
    player.addTroops(50_000);
    const exec = new AirborneAssaultExecution(player, enemyTile, 5_000);
    exec.init(game, 0);
    expect(exec.isActive()).toBe(false);
    expect(player.unitCount(UnitType.AirborneAssault)).toBe(0);
  });

  test("Airplane to a tradeable neighbor's airport pays BOTH owners", () => {
    const mine = game.ref(2, 10);
    const theirs = game.ref(7, 10);
    player.conquer(mine);
    player2.conquer(theirs);
    expect(player.canTrade(player2)).toBe(true);

    const a1 = player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, mine) as number,
      {},
    );
    const a2 = player2.buildUnit(
      UnitType.Airport,
      player2.canBuild(UnitType.Airport, theirs) as number,
      {},
    );

    const beforeMe = player.gold();
    const beforeThem = player2.gold();
    const exec = new AirplaneExecution(player, a1, a2);
    exec.init(game, 0);
    let t = 0;
    while (exec.isActive() && t < 300) {
      exec.tick(t);
      t++;
    }
    expect(exec.isActive()).toBe(false);
    // Both the sender and the destination owner earn on arrival.
    expect(player.gold() > beforeMe).toBe(true);
    expect(player2.gold() > beforeThem).toBe(true);
    expect(game.unitCount(UnitType.Airplane)).toBe(0);
  });

  // terron: авиация — дрон-камикадзе (мини-ядерка с аэропорта). airport.md
  // (Радиус ⅓ атомной — inner4/outer10 — задан в Config.nukeMagnitudes; TestConfig
  // плющит все магнитуды в 1/1, поэтому ратио тут не проверяем, только цену.)
  test("Suicide drone base cost is 300k", () => {
    const droneCost = game
      .config()
      .unitInfo(UnitType.SuicideDrone)
      .cost(game, player);
    expect(Number(droneCost)).toBe(300_000);
  });

  test("Airborne assault gold cost scales +100k per launch, capped at 1kk", () => {
    const cfg = game.config();
    const tile = game.ref(2, 10);
    player.conquer(tile);
    player.addTroops(100_000);
    const cost = () =>
      Number(cfg.unitInfo(UnitType.AirborneAssault).cost(game, player));

    expect(cost()).toBe(100_000); // first launch
    for (let i = 1; i <= 12; i++) {
      player.buildUnit(UnitType.AirborneAssault, tile, { troops: 10 });
      expect(cost()).toBe(Math.min(1_000_000, (i + 1) * 100_000));
    }
  });

  test("Suicide drone with no airport does nothing", () => {
    const enemyTile = game.ref(7, 10);
    player2.conquer(enemyTile);
    const exec = new SuicideDroneExecution(player, enemyTile);
    exec.init(game, 0);
    expect(exec.isActive()).toBe(false);
    expect(player.unitCount(UnitType.SuicideDrone)).toBe(0);
  });

  test("Suicide drone flies from nearest airport, charges gold, and detonates", () => {
    const airportTile = game.ref(2, 10);
    const enemyTile = game.ref(7, 10);
    player.conquer(airportTile);
    player2.conquer(enemyTile);
    player2.addTroops(50_000);
    player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, airportTile) as number,
      {},
    );

    const goldBefore = player.gold();
    const exec = new SuicideDroneExecution(player, enemyTile);
    exec.init(game, 0);
    expect(player.unitCount(UnitType.SuicideDrone)).toBe(1);
    expect(Number(player.gold())).toBeLessThan(Number(goldBefore));

    let t = 1;
    while (exec.isActive() && t < 400) {
      exec.tick(t);
      t++;
    }
    expect(exec.isActive()).toBe(false);
    expect(game.unitCount(UnitType.SuicideDrone)).toBe(0);
    // Blast relinquished the target tile (no longer owned by the enemy).
    expect(game.owner(enemyTile).isPlayer()).toBe(false);
  });

  test("SAM missile shoots down an enemy suicide drone (it is removed)", () => {
    const samTile = game.ref(4, 10);
    const airportTile = game.ref(1, 10);
    const targetTile = game.ref(7, 10);
    player.conquer(samTile);
    player.conquer(targetTile);
    player2.conquer(airportTile);

    const sam = player.buildUnit(
      UnitType.SAMLauncher,
      player.canBuild(UnitType.SAMLauncher, samTile) as number,
      {},
    );
    player2.buildUnit(
      UnitType.Airport,
      player2.canBuild(UnitType.Airport, airportTile) as number,
      {},
    );

    game.addExecution(new SAMLauncherExecution(player, null, sam));
    game.addExecution(new SuicideDroneExecution(player2, targetTile));

    for (let t = 0; t < 400 && game.unitCount(UnitType.SuicideDrone) > 0; t++) {
      game.executeNextTick();
    }
    // Intercepted by a SAM missile before reaching its target.
    expect(game.unitCount(UnitType.SuicideDrone)).toBe(0);
  });

  // terron: авиация — кулдаун запуска дрона С аэропорта (1:1 как ракетная шахта).
  test("Suicide drone puts its airport on cooldown; reloads after AirportDroneCooldown", () => {
    const airportTile = game.ref(2, 10);
    const enemyTile = game.ref(7, 10);
    player.conquer(airportTile);
    player2.conquer(enemyTile);
    const airport = player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, airportTile) as number,
      {},
    );
    expect(airport.isInCooldown()).toBe(false);

    // Пуск дрона (init строит его + launch() → аэропорт в кулдауне).
    const d1 = new SuicideDroneExecution(player, enemyTile);
    d1.init(game, 0);
    expect(player.unitCount(UnitType.SuicideDrone)).toBe(1);
    expect(airport.isInCooldown()).toBe(true);
    // Пока перезаряжается — гейт постройки отказывает (все аэропорты заняты).
    expect(player.canBuild(UnitType.SuicideDrone, enemyTile)).toBe(false);
    // И новая попытка запуска не строит второй дрон.
    const dBlocked = new SuicideDroneExecution(player, enemyTile);
    dBlocked.init(game, 0);
    expect(dBlocked.isActive()).toBe(false);
    expect(player.unitCount(UnitType.SuicideDrone)).toBe(1);

    // Аэропорт освобождается через AirportDroneCooldown тиков (AirportExecution).
    const cd = game.config().AirportDroneCooldown();
    game.addExecution(new AirportExecution(airport));
    for (let i = 0; i < cd + 3; i++) game.executeNextTick();
    expect(airport.isInCooldown()).toBe(false);
    expect(player.canBuild(UnitType.SuicideDrone, enemyTile)).not.toBe(false);
  });

  test("With two airports, a busy one is skipped for the next ready airport", () => {
    const near = game.ref(6, 10); // ближе к врагу на (7,10)
    const far = game.ref(2, 10);
    const enemyTile = game.ref(7, 10);
    player.conquer(near);
    player.conquer(far);
    player2.conquer(enemyTile);
    const aNear = player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, near) as number,
      {},
    );
    const aFar = player.buildUnit(
      UnitType.Airport,
      player.canBuild(UnitType.Airport, far) as number,
      {},
    );

    // Первый дрон уходит с БЛИЖНЕГО аэропорта → он в кулдауне.
    new SuicideDroneExecution(player, enemyTile).init(game, 0);
    expect(aNear.isInCooldown()).toBe(true);
    expect(aFar.isInCooldown()).toBe(false);

    // Второй дрон СРАЗУ ЖЕ стартует — с ДАЛЬНЕГО (готового) аэропорта.
    const d2 = new SuicideDroneExecution(player, enemyTile);
    d2.init(game, 0);
    expect(d2.isActive()).toBe(true);
    expect(player.unitCount(UnitType.SuicideDrone)).toBe(2);
    expect(aFar.isInCooldown()).toBe(true);
  });

  test("detonateDroneBlast relinquishes owned tiles at the death point", () => {
    const center = game.ref(4, 10);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        player2.conquer(game.ref(4 + dx, 10 + dy));
      }
    }
    expect(game.owner(center)).toBe(player2);

    detonateDroneBlast(game, center, player);

    // The blast strips ownership at ground zero (becomes neutral, unlike a nuke → no water).
    expect(game.owner(center).isPlayer()).toBe(false);
  });
});

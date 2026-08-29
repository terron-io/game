// terron: ультимейты — НЕБО НАШЕ (антиспутник). НОВЫЙ ФЛОУ (13.07): телеграф =
// САМА постройка комплекса 60с (сносибельно = контрплей), URGENT-тревога при
// старте стройки; достроилось → ракета → SatBlackoutUpdate + состояние блэкаута
// в ядре (для ботов). Слепота — клиентская. Спека: new-units/NEBO.md
import {
  TERRON_OURSKY_BLACKOUT_TICKS,
  TERRON_OURSKY_BLAST_DELAY_TICKS,
  TERRON_OURSKY_BUILD_TICKS,
} from "../src/core/configuration/TerronTuning";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  Ultimates,
  UnitType,
} from "../src/core/game/Game";
import {
  GameUpdateType,
  SatBlackoutUpdate,
} from "../src/core/game/GameUpdates";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;
let enemy: Player;

// Строим комплекс с ЯВНОЙ длительностью стройки (instantBuild выключен), чтобы
// прогнать телеграф-фазу.
function buildOurSky(tileX: number, tileY: number) {
  const tile = game.ref(tileX, tileY);
  player.conquer(tile);
  const spawn = player.canBuild(UnitType.OurSky, tile);
  expect(spawn).not.toBe(false);
  const exec = new ConstructionExecution(
    player,
    UnitType.OurSky,
    spawn as number,
  );
  game.addExecution(exec);
}

/** Крутит тики, пока не появится SatBlackout или не кончится лимит. */
function tickUntilBlackout(maxTicks: number): SatBlackoutUpdate | null {
  for (let i = 0; i < maxTicks; i++) {
    const updates = game.executeNextTick();
    const arr = updates[GameUpdateType.SatBlackout] as SatBlackoutUpdate[];
    if (arr && arr.length > 0) return arr[0];
  }
  return null;
}

describe("Our Sky ultimate (terron)", () => {
  beforeEach(async () => {
    // instantBuild ВЫКЛЮЧЕН — комплекс строится реальные 60с (телеграф).
    game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo("player", PlayerType.Human, null, "player_id"),
      new PlayerInfo("enemy", PlayerType.Human, null, "enemy_id"),
    ]);
    player = game.player("player_id");
    enemy = game.player("enemy_id");
    player.addGold(BigInt(100_000_000));
    game.config().structureMinDist = () => 0;
    // Выйти из спавн-фазы, иначе постройка не тикает.
    while (game.inSpawnPhase()) game.executeNextTick();
  });

  test("OurSky is a structure, an ultimate, and costs 5M", () => {
    expect(Structures.has(UnitType.OurSky)).toBe(true);
    expect(Ultimates.has(UnitType.OurSky)).toBe(true);
    const cost = game.config().unitInfo(UnitType.OurSky).cost(game, player);
    expect(cost).toBe(5_000_000n);
  });

  test("build takes ~60s and is destroyable the whole time (telegraph)", () => {
    buildOurSky(7, 10);
    // Дать стройке начаться.
    for (let i = 0; i < 5; i++) game.executeNextTick();
    const hq = player.units(UnitType.OurSky)[0];
    expect(hq).toBeDefined();
    // Всю фазу телеграфа здание в underConstruction (сносибельно).
    expect(hq.isUnderConstruction()).toBe(true);
  });

  test("build completes → building consumed, SatBlackoutUpdate with correct window", () => {
    buildOurSky(7, 10);
    const blackout = tickUntilBlackout(TERRON_OURSKY_BUILD_TICKS + 20);

    expect(blackout).not.toBeNull();
    expect(blackout!.ownerSmallID).toBe(player.smallID());
    // Здание израсходовано ракетой.
    expect(player.unitCount(UnitType.OurSky)).toBe(0);
    // Окно: подрыв через BLAST_DELAY от запуска, длится BLACKOUT_TICKS.
    expect(blackout!.blastTick).toBeGreaterThan(game.ticks());
    expect(blackout!.blastTick - game.ticks()).toBeLessThanOrEqual(
      TERRON_OURSKY_BLAST_DELAY_TICKS,
    );
    expect(blackout!.endTick - blackout!.blastTick).toBe(
      TERRON_OURSKY_BLACKOUT_TICKS,
    );
    // Фиксация ульты.
    expect(player.ultimateChoice()).toBe(UnitType.OurSky);
  });

  test("global warning goes out once when construction starts", () => {
    buildOurSky(7, 10);
    let warnings = 0;
    for (let i = 0; i < 30; i++) {
      const updates = game.executeNextTick();
      for (const u of updates[GameUpdateType.DisplayEvent] ?? []) {
        if (
          (u as { message?: string }).message ===
          "events_display.satellites_threatened"
        ) {
          warnings++;
        }
      }
    }
    expect(warnings).toBe(1);
  });

  test("destroying the building mid-build cancels the launch", () => {
    buildOurSky(7, 10);
    // Дать стройке стартовать.
    for (let i = 0; i < 10; i++) game.executeNextTick();
    const hq = player.units(UnitType.OurSky)[0];
    expect(hq).toBeDefined();
    hq.delete(false);

    const blackout = tickUntilBlackout(TERRON_OURSKY_BUILD_TICKS + 20);
    expect(blackout).toBeNull();
  });

  test("core exposes blackout state; owner is not blinded, enemy is", () => {
    buildOurSky(7, 10);
    const blackout = tickUntilBlackout(TERRON_OURSKY_BUILD_TICKS + 20);
    expect(blackout).not.toBeNull();

    // Дотикать до окна блэкаута (подрыв).
    while (game.ticks() < blackout!.blastTick) game.executeNextTick();

    expect(game.satelliteBlackoutActive()).toBe(true);
    // Владелец видит (не слепнет), враг — слепнет.
    expect(game.satelliteBlackoutBlinds(player)).toBe(false);
    expect(game.satelliteBlackoutBlinds(enemy)).toBe(true);

    // После endTick окно закрыто — все снова видят.
    while (game.ticks() < blackout!.endTick) game.executeNextTick();
    expect(game.satelliteBlackoutActive()).toBe(false);
    expect(game.satelliteBlackoutBlinds(enemy)).toBe(false);
  });
});

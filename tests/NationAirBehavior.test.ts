// terron: авиация — ИИ-нации пользуются десантом и дронами с аэропортов. airport.md
import { NationAirBehavior } from "../src/core/execution/nation/NationAirBehavior";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import { Game, PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// NationAirBehavior only calls attackBehavior.findIncomingAttackPlayer(); stub it.
const attackStub = {
  findIncomingAttackPlayer: () => null,
} as unknown as AiAttackBehavior;

async function makeGame() {
  const game = await setup("big_plains", { instantBuild: true });
  game.addPlayer(new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"));
  game.addPlayer(new PlayerInfo("enemy", PlayerType.Human, null, "enemy_id"));
  const nation = game.player("nation_id");
  const enemy = game.player("enemy_id");
  for (let x = 10; x < 20; x++) {
    for (let y = 10; y < 20; y++) {
      const t = game.ref(x, y);
      if (game.map().isLand(t)) nation.conquer(t);
    }
  }
  for (let x = 24; x < 34; x++) {
    for (let y = 10; y < 20; y++) {
      const t = game.ref(x, y);
      if (game.map().isLand(t)) enemy.conquer(t);
    }
  }
  nation.addGold(50_000_000n);
  nation.addTroops(100_000);
  nation.updateRelation(enemy, -100); // hostile → valid air target
  return { game, nation, enemy };
}

function drive(game: Game, fn: () => void, times: number) {
  for (let i = 0; i < times; i++) fn();
  executeTicks(game, 2); // run queued executions (build the craft)
}

describe("NationAirBehavior (terron)", () => {
  test("no airport → nation launches no air units", async () => {
    const { game, nation } = await makeGame();
    const air = new NationAirBehavior(
      new PseudoRandom(1),
      game,
      nation,
      attackStub,
    );
    drive(
      game,
      () => {
        air.maybeAirAssault();
        air.maybeSendDrone();
      },
      300,
    );
    expect(nation.unitsConstructed(UnitType.AirborneAssault)).toBe(0);
    expect(nation.unitsConstructed(UnitType.SuicideDrone)).toBe(0);
  });

  test("with an airport → nation eventually launches an airborne assault", async () => {
    const { game, nation } = await makeGame();
    nation.buildUnit(UnitType.Airport, game.ref(15, 15), {});
    const air = new NationAirBehavior(
      new PseudoRandom(1),
      game,
      nation,
      attackStub,
    );
    drive(game, () => air.maybeAirAssault(), 300);
    expect(nation.unitsConstructed(UnitType.AirborneAssault)).toBeGreaterThan(0);
  });

  test("with an airport → nation eventually drones an enemy structure", async () => {
    const { game, nation, enemy } = await makeGame();
    nation.buildUnit(UnitType.Airport, game.ref(15, 15), {});
    enemy.buildUnit(UnitType.City, game.ref(28, 15), {});
    const air = new NationAirBehavior(
      new PseudoRandom(1),
      game,
      nation,
      attackStub,
    );
    drive(game, () => air.maybeSendDrone(), 300);
    expect(nation.unitsConstructed(UnitType.SuicideDrone)).toBeGreaterThan(0);
  });
});

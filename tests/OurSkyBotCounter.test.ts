// terron: «Небо наше» — контрплей ботов. Пока вражеский антиспутник СТРОИТСЯ
// (телеграф 60с, сносибелен), ближние враждебные нации пытаются сбить его
// ядеркой. Спека: new-units/NEBO.md
import { MissileSiloExecution } from "../src/core/execution/MissileSiloExecution";
import { NationExecution } from "../src/core/execution/NationExecution";
import {
  Cell,
  Difficulty,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

describe("NationNukeBehavior - maybeCounterOurSky (terron)", () => {
  test("nation nukes an enemy anti-satellite complex while it is under construction", async () => {
    const game = await setup("big_plains", {
      difficulty: Difficulty.Impossible,
      infiniteGold: true,
      instantBuild: true,
    });

    const nationInfo = new PlayerInfo(
      "nation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    const humanInfo = new PlayerInfo("human", PlayerType.Human, null, "human_id");
    game.addPlayer(nationInfo);
    game.addPlayer(humanInfo);

    const nation = game.player("nation_id");
    const human = game.player("human_id");

    for (let x = 10; x < 40; x++) {
      for (let y = 10; y < 40; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) nation.conquer(tile);
      }
    }
    for (let x = 55; x < 85; x++) {
      for (let y = 55; y < 85; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) human.conquer(tile);
      }
    }

    // Нация — силос + деньги/войска (infiniteGold только для людей).
    const silo = nation.buildUnit(UnitType.MissileSilo, game.ref(25, 25), {});
    game.addExecution(new MissileSiloExecution(silo));
    nation.addGold(1_000_000_000n);
    nation.addTroops(100_000);
    human.addTroops(100_000);

    // Вражеский антиспутник, застывший в фазе стройки (телеграф).
    const hqTile = game.ref(70, 70);
    const hq = human.buildUnit(UnitType.OurSky, hqTile, {});
    hq.setUnderConstruction(true);
    expect(hq.isUnderConstruction()).toBe(true);

    const testNation = new Nation(new Cell(25, 25), nation.info());
    let countered = false;

    for (let i = 0; i < 10 && !countered; i++) {
      if (i > 0) executeTicks(game, 50);
      const exec = new NationExecution(`game_${i}`, testNation);
      exec.init(game);

      for (let tick = 0; tick < 150 && !countered; tick++) {
        exec.tick(tick);
        if (tick % 10 === 0) game.executeNextTick();

        const nukes = [
          ...nation.units(UnitType.AtomBomb),
          ...nation.units(UnitType.HydrogenBomb),
        ];
        // Хотя бы одна ядерка нацелена в тайл комплекса (контр-удар).
        if (
          nukes.some((n) => {
            const t = n.targetTile();
            return t !== null && t !== undefined && t === hqTile;
          })
        ) {
          countered = true;
        }
      }
    }

    expect(countered).toBe(true);
  });
});

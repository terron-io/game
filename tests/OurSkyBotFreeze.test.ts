// terron: «Небо наше» — заморозка ботов на время блэкаута. Ослеплённая нация
// (все, кроме владельца и его команды) НЕ ведёт наступление: не кидает ракеты.
// Снятие блэкаута → поведение возвращается. Спека: new-units/NEBO.md
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

function nukeCount(p: {
  units: (t: UnitType) => unknown[];
}): number {
  return (
    p.units(UnitType.AtomBomb).length + p.units(UnitType.HydrogenBomb).length
  );
}

/** Гоняет NationExecution N внутренних тиков, ищет ЛЮБУЮ выпущенную ядерку. */
function runNationTicks(
  game: Awaited<ReturnType<typeof setup>>,
  nation: ReturnType<Awaited<ReturnType<typeof setup>>["player"]>,
  tag: string,
  ticks: number,
): boolean {
  const testNation = new Nation(new Cell(25, 25), nation.info());
  const exec = new NationExecution(tag, testNation);
  exec.init(game);
  for (let t = 0; t < ticks; t++) {
    exec.tick(t);
    if (t % 10 === 0) game.executeNextTick();
    if (nukeCount(nation) > 0) return true;
  }
  return false;
}

describe("NationExecution - satellite blackout freeze (terron)", () => {
  test("blinded nation launches no nukes; resumes once blackout clears", async () => {
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

    const silo = nation.buildUnit(UnitType.MissileSilo, game.ref(25, 25), {});
    game.addExecution(new MissileSiloExecution(silo));
    nation.addGold(1_000_000_000n);
    nation.addTroops(100_000);
    human.addTroops(100_000);

    // Строение-цель у человека — иначе Impossible-нация не бьёт по голой земле
    // (нужно, чтобы контрольная фаза «блэкаут снят» реально выпустила ядерку).
    human.buildUnit(UnitType.City, game.ref(70, 70), {});

    // Блэкаут владельца-человека активен СЕЙЧАС → нация ослеплена.
    game.setSatelliteBlackout({
      ownerSmallID: human.smallID(),
      blastTick: game.ticks(),
      endTick: game.ticks() + 100_000,
    });
    expect(game.satelliteBlackoutBlinds(nation)).toBe(true);

    // Пока ослеплена — ни одной ядерки за 150 тиков.
    const firedWhileBlinded = runNationTicks(game, nation, "blind", 150);
    expect(firedWhileBlinded).toBe(false);
    expect(nukeCount(nation)).toBe(0);

    // Снимаем блэкаут — поведение возвращается, нация начинает бить ядерками.
    game.setSatelliteBlackout(null);
    expect(game.satelliteBlackoutBlinds(nation)).toBe(false);

    let fired = false;
    for (let i = 0; i < 10 && !fired; i++) {
      if (i > 0) executeTicks(game, 50);
      fired = runNationTicks(game, nation, `open_${i}`, 150);
    }
    expect(fired).toBe(true);
  });
});

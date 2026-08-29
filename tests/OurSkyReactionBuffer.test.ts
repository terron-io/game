// terron: «Небо наше» — буфер реакции. Пока жертва ослеплена блэкаутом, бот
// отвечает на нападение не сразу, а через TERRON_OURSKY_REACTION_BUFFER_TICKS
// («узнаёт» об атаке позже). Механизм переиспользуемый. Спека: new-units/NEBO.md
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Difficulty,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const BUFFER = 50; // TERRON_OURSKY_REACTION_BUFFER_TICKS (5с)

function makeAttackBehavior(
  game: Awaited<ReturnType<typeof setup>>,
  player: Player,
): AiAttackBehavior {
  const random = new PseudoRandom(1);
  const emoji = new NationEmojiBehavior(random, game, player);
  const alliance = new NationAllianceBehavior(random, game, player, emoji);
  // triggerRatio низкий, чтобы порог войск не мешал ответке в тесте.
  return new AiAttackBehavior(random, game, player, 0.1, 0.1, 0.1, alliance, emoji);
}

/** Гоняет ответку с буфером по тику, возвращает первый тик контр-атаки (или -1). */
function firstCounterTick(
  game: Awaited<ReturnType<typeof setup>>,
  ab: AiAttackBehavior,
  attacked: Player,
  attacker: Player,
  bufferTicks: number,
  maxTicks: number,
): number {
  for (let i = 0; i < maxTicks; i++) {
    ab.maybeRetaliate(bufferTicks);
    if (
      attacker.incomingAttacks().some((a) => a.attacker() === attacked)
    ) {
      return game.ticks();
    }
    game.executeNextTick();
  }
  return -1;
}

async function scenario() {
  const game = await setup("big_plains", {
    difficulty: Difficulty.Impossible,
    instantBuild: true,
  });
  const nation = game.addPlayer(
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
  );
  const human = game.addPlayer(
    new PlayerInfo("human", PlayerType.Human, null, "human_id"),
  );

  // Смежные блоки территории (общая граница → наземная контр-атака).
  for (let x = 20; x < 45; x++) {
    for (let y = 20; y < 45; y++) {
      const t = game.ref(x, y);
      if (game.map().isLand(t)) nation.conquer(t);
    }
  }
  for (let x = 45; x < 70; x++) {
    for (let y = 20; y < 45; y++) {
      const t = game.ref(x, y);
      if (game.map().isLand(t)) human.conquer(t);
    }
  }
  nation.addTroops(500_000);
  human.addTroops(500_000);

  // Человек нападает на нацию → у нации входящая атака.
  game.addExecution(new AttackExecution(200_000, human, nation.id()));
  executeTicks(game, 2);
  expect(
    nation.incomingAttacks().some((a) => a.attacker() === human),
  ).toBe(true);

  return { game, nation, human };
}

describe("Our Sky reaction buffer (terron)", () => {
  test("with buffer the nation counter-attacks LATER than without", async () => {
    // Без буфера — отвечает почти сразу.
    const a = await scenario();
    const abNow = makeAttackBehavior(a.game, a.nation);
    const startNow = a.game.ticks();
    const counterNow = firstCounterTick(
      a.game,
      abNow,
      a.nation,
      a.human,
      0,
      BUFFER + 30,
    );
    expect(counterNow).toBeGreaterThanOrEqual(0);
    expect(counterNow - startNow).toBeLessThan(BUFFER);

    // С буфером — не раньше, чем через BUFFER тиков после первого замечания.
    const b = await scenario();
    const abBuf = makeAttackBehavior(b.game, b.nation);
    const startBuf = b.game.ticks();
    const counterBuf = firstCounterTick(
      b.game,
      abBuf,
      b.nation,
      b.human,
      BUFFER,
      BUFFER + 60,
    );
    expect(counterBuf).toBeGreaterThanOrEqual(0);
    expect(counterBuf - startBuf).toBeGreaterThanOrEqual(BUFFER);
  });
});

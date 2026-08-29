// terron: автосмерть наций-огрызков (NationCullExecution) — нация с
// ≤ TERRON_NATION_MIN_TILES тайлами капитулирует (репорты 17.07 «видно
// противника, а захватить нечего»: огрызки на микро-островах).
import { TERRON_NATION_MIN_TILES } from "../src/core/configuration/TerronTuning";
import { NationCullExecution } from "../src/core/execution/NationCullExecution";
import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;

function landTiles(g: Game, count: number): number[] {
  const out: number[] = [];
  const w = g.width();
  const h = g.height();
  for (let y = 0; y < h && out.length < count; y++) {
    for (let x = 0; x < w && out.length < count; x++) {
      const t = g.ref(x, y);
      if (g.map().isLand(t)) out.push(t);
    }
  }
  return out;
}

async function makeGame(): Promise<Game> {
  const g = await setup("big_plains", {}, [
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
    new PlayerInfo("human", PlayerType.Human, null, "human_id"),
  ]);
  while (g.inSpawnPhase()) g.executeNextTick();
  g.addExecution(new NationCullExecution());
  return g;
}

async function runTicks(g: Game, n: number): Promise<void> {
  for (let i = 0; i < n; i++) g.executeNextTick();
}

describe("NationCullExecution (terron)", () => {
  test("нация с ≤ порога тайлов умирает", async () => {
    game = await makeGame();
    const nation = game.player("nation_id");
    const tiles = landTiles(game, TERRON_NATION_MIN_TILES);
    for (const t of tiles) nation.conquer(t);
    expect(nation.isAlive()).toBe(true);
    await runTicks(game, 25); // ≥ один проход калла (шаг 20 тиков)
    expect(nation.isAlive()).toBe(false);
    expect(nation.numTilesOwned()).toBe(0);
  });

  test("нация выше порога живёт", async () => {
    game = await makeGame();
    const nation = game.player("nation_id");
    const tiles = landTiles(game, TERRON_NATION_MIN_TILES * 3);
    for (const t of tiles) nation.conquer(t);
    await runTicks(game, 25);
    expect(nation.isAlive()).toBe(true);
    expect(nation.numTilesOwned()).toBe(TERRON_NATION_MIN_TILES * 3);
  });

  test("человека с ≤ порога тайлов НЕ трогаем", async () => {
    game = await makeGame();
    const human = game.player("human_id");
    const tiles = landTiles(game, 3);
    for (const t of tiles) human.conquer(t);
    await runTicks(game, 25);
    expect(human.isAlive()).toBe(true);
  });

  test("СХЛОПНУВШАЯСЯ нация (был большой пик, теперь <5%) умирает", async () => {
    game = await makeGame();
    const nation = game.player("nation_id");
    // пик 600 тайлов
    const big = landTiles(game, 600);
    for (const t of big) nation.conquer(t);
    (nation as unknown as { _maxTilesOwned: number })._maxTilesOwned =
      nation.numTilesOwned();
    // срезаем до 20 тайлов: >10 (не «огрызок»), но <5% от 600 (=30) → схлопнулась
    const keep = new Set(big.slice(0, 20));
    for (const t of [...nation.tiles()]) if (!keep.has(t)) nation.relinquish(t);
    expect(nation.numTilesOwned()).toBe(20);
    expect(nation.isAlive()).toBe(true);
    await runTicks(game, 25);
    expect(nation.isAlive()).toBe(false); // капитулировала
  });

  test("E2E: пик трекается ЕСТЕСТВЕННО (PlayerExecution) и схлоп убивает", async () => {
    game = await makeGame();
    const nation = game.player("nation_id");
    const { PlayerExecution } = await import(
      "../src/core/execution/PlayerExecution"
    );
    game.addExecution(new PlayerExecution(nation));
    // растим до 600 и даём тикам зафиксировать пик БЕЗ ручного _maxTilesOwned
    const big = landTiles(game, 600);
    for (const t of big) nation.conquer(t);
    await runTicks(game, 3);
    expect(nation.maxTilesOwned()).toBeGreaterThanOrEqual(600);
    // «МИРВ выжег» до 20 разбросанных тайлов
    const keep = new Set(big.slice(0, 20));
    for (const t of [...nation.tiles()]) if (!keep.has(t)) nation.relinquish(t);
    await runTicks(game, 25);
    expect(nation.isAlive()).toBe(false);
  });

  test("легитимная мелкая нация (всегда была маленькой) ЖИВЁТ", async () => {
    game = await makeGame();
    const nation = game.player("nation_id");
    // пик всего 40 тайлов (< MIN_PEAK 500) — не схлопнувшаяся, просто мелкая
    const small = landTiles(game, 40);
    for (const t of small) nation.conquer(t);
    (nation as unknown as { _maxTilesOwned: number })._maxTilesOwned =
      nation.numTilesOwned();
    await runTicks(game, 25);
    expect(nation.isAlive()).toBe(true);
    expect(nation.numTilesOwned()).toBe(40);
  });
});

// terron 29.09: нельзя «прилипать» спавном к другому человеку (решение
// владельца). Ручной флаг человека ближе TERRON_SPAWN_HUMAN_GAP к точке другого
// человека не ставится; своей команде можно, нациям и ботам правило не мешает.
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Game,
  GameMode,
  GameType,
  HumansVsNations,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { spawnBlocker } from "../src/core/game/SpawnSpacing";
import { setup } from "./util/Setup";

const A = new PlayerInfo("alpha", PlayerType.Human, null, "alpha_id");
const B = new PlayerInfo("bravo", PlayerType.Human, null, "bravo_id");

function spawn(g: Game, info: PlayerInfo, x: number, y: number) {
  g.addExecution(new SpawnExecution("game", info, g.ref(x, y)));
  g.executeNextTick();
  g.executeNextTick();
}

async function game(extra = {}): Promise<Game> {
  // Public: правило живёт только в публичных матчах; фазу там закрывает таймер,
  // выбор точки её не заканчивает (в одиночке закончил бы).
  return await setup(
    "big_plains",
    { gameType: GameType.Public, ...extra },
    [A, B],
    undefined,
    undefined,
    false,
  );
}

describe("спавн не ближе 30 к другому человеку", () => {
  it("число решения — 30 клеток по манхэттену", () => {
    const dist = (a: number, b: number) => Math.abs(a - b);
    expect(spawnBlocker(129, [{ spawnTile: 100 }], dist)).not.toBeNull();
    expect(spawnBlocker(130, [{ spawnTile: 100 }], dist)).toBeNull();
  });

  it("второй человек вплотную не встаёт, вдали — встаёт", async () => {
    const g = await game();
    spawn(g, A, 50, 50);
    expect(g.player(A.id).hasSpawned()).toBe(true);
    spawn(g, B, 60, 55);
    expect(g.player(B.id).hasSpawned()).toBe(false);
    spawn(g, B, 100, 100);
    expect(g.player(B.id).hasSpawned()).toBe(true);
  });

  it("переставить свой флаг рядом со своим прежним местом можно", async () => {
    const g = await game();
    spawn(g, A, 50, 50);
    spawn(g, A, 70, 55); // 25 клеток от своего прежнего флага
    expect(g.player(A.id).spawnTile()).toBe(g.ref(70, 55));
  });

  it("отказ оставляет игрока на прежнем месте", async () => {
    const g = await game();
    spawn(g, A, 50, 50);
    spawn(g, B, 120, 120);
    spawn(g, B, 55, 55); // вплотную к A — отказ
    expect(g.player(B.id).spawnTile()).toBe(g.ref(120, 120));
    expect(g.player(B.id).numTilesOwned()).toBeGreaterThan(0);
  });

  it("в приватном лобби правило не действует", async () => {
    const g = await game({ gameType: GameType.Private });
    spawn(g, A, 50, 50);
    spawn(g, B, 60, 55);
    expect(g.player(B.id).hasSpawned()).toBe(true);
  });

  it("своей команде вплотную можно", async () => {
    const g = await game({
      gameMode: GameMode.Team,
      playerTeams: HumansVsNations,
    });
    expect(g.player(A.id).isOnSameTeam(g.player(B.id))).toBe(true);
    spawn(g, A, 50, 50);
    spawn(g, B, 60, 55);
    expect(g.player(B.id).hasSpawned()).toBe(true);
  });
});

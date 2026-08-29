// terron: фиксируем РЕАЛЬНОЕ поведение фазы спавна — оно разное по типу игры.
//
// Одиночка: SpawnTimerExecution в неё вообще не добавляется (см. GameRunner.init),
// фазу закрывает сам SpawnExecution в момент выбора точки человеком. То есть
// игрока никто не торопит и не спавнит за него — это родное поведение, и тест
// стоит здесь, чтобы его случайно не потеряли.
//
// Сетевая игра: фазу закрывает таймер, независимо от того, выбрал кто-то точку
// или нет — иначе один задумавшийся игрок держал бы весь матч.
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { SpawnTimerExecution } from "../src/core/execution/SpawnTimerExecution";
import { Game, GameType, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

const HUMAN = new PlayerInfo("human", PlayerType.Human, null, "human_id");

async function makeGame(gameType: GameType): Promise<Game> {
  // autoEndSpawnPhase=false — фазу должны закрывать сами исполнения.
  return await setup(
    "big_plains",
    { gameType },
    [],
    undefined,
    undefined,
    false,
  );
}

function firstLandTile(g: Game): number {
  for (let y = 0; y < g.height(); y++) {
    for (let x = 0; x < g.width(); x++) {
      const t = g.ref(x, y);
      if (g.map().isLand(t)) return t;
    }
  }
  throw new Error("no land on test map");
}

describe("фаза спавна в одиночке", () => {
  it("держится, пока игрок не выбрал точку (таймера нет)", async () => {
    const g = await makeGame(GameType.Singleplayer);
    for (let i = 0; i < 600; i++) g.executeNextTick();
    expect(g.inSpawnPhase()).toBe(true);
  });

  it("закрывается выбором точки — матч стартует сразу", async () => {
    const g = await makeGame(GameType.Singleplayer);
    for (let i = 0; i < 5; i++) g.executeNextTick();
    expect(g.inSpawnPhase()).toBe(true);

    g.addExecution(new SpawnExecution("game", HUMAN, firstLandTile(g)));
    g.executeNextTick(); // исполнение инициализируется
    g.executeNextTick(); // спавн применяется и закрывает фазу

    expect(g.inSpawnPhase()).toBe(false);
  });
});

describe("фаза спавна в сетевой игре", () => {
  it("закрывается таймером, даже если никто не выбрал точку", async () => {
    const g = await makeGame(GameType.Public);
    g.addExecution(new SpawnTimerExecution());
    for (let i = 0; i < 600; i++) {
      g.executeNextTick();
      if (!g.inSpawnPhase()) break;
    }
    expect(g.inSpawnPhase()).toBe(false);
  });
});

// terron 24.09: РЕБАЛАНС ПОЕЗДОВ (TerronTuning §ФАБРИКИ И ПОЕЗДА). Что сторожим:
//  • поезд выходит ПО РАСПИСАНИЮ — раз в trainIntervalTicks, а не кубиком;
//  • без других станций в сети поездов нет;
//  • маршрут — обход сети через все доступные точки;
//  • за рейс станция платит ОДИН раз (обход возвращается по своим следам);
//  • уровень фабрики = длиннее поезд и больше денег.
import { describe, expect, it } from "vitest";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { TrainExecution } from "../src/core/execution/TrainExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TrainStation } from "../src/core/game/TrainStation";
import { buildTrainTour } from "../src/core/game/TrainTour";
import { PseudoRandom } from "../src/core/PseudoRandom";
import {
  GOLD_INDEX_TRAIN_OTHER,
  GOLD_INDEX_TRAIN_SELF,
} from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

/** Своя страна на big_plains, города и фабрики с заданными уровнями. */
async function network(
  cities: [number, number][],
  factories: [number, number, number][],
): Promise<{ game: Game; me: Player }> {
  const game = await setup("big_plains", { instantBuild: true }, [
    new PlayerInfo("me", PlayerType.Human, "cl1", "me"),
  ]);
  const me = game.player("me");
  for (let x = 20; x < 190; x++) {
    for (let y = 20; y < 180; y++) {
      const t = game.ref(x, y);
      if (game.isLand(t) && !game.hasOwner(t)) me.conquer(t);
    }
  }
  me.addGold(1_000_000_000n);
  for (const [x, y] of cities) {
    game.addExecution(
      new ConstructionExecution(me, UnitType.City, game.ref(x, y)),
    );
  }
  for (let i = 0; i < 5; i++) game.executeNextTick();
  for (const [x, y] of factories) {
    game.addExecution(
      new ConstructionExecution(me, UnitType.Factory, game.ref(x, y)),
    );
  }
  for (let i = 0; i < 5; i++) game.executeNextTick();
  me.units(UnitType.Factory).forEach((f, i) => {
    for (let l = 1; l < factories[i][2]; l++) f.increaseLevel();
  });
  return { game, me };
}

const stats = (game: Game, me: Player) =>
  game.stats().getPlayerStats(me) as any;
const trainGold = (game: Game, me: Player): number => {
  const s = stats(game, me);
  return (
    Number(s?.gold?.[GOLD_INDEX_TRAIN_SELF] ?? 0) +
    Number(s?.gold?.[GOLD_INDEX_TRAIN_OTHER] ?? 0)
  );
};

describe("поезда по расписанию", () => {
  it("один поезд раз в 30 с — за 10 минут ровно 20", async () => {
    const { game, me } = await network([[100, 60]], [[60, 60, 1]]);
    const before = Number(stats(game, me)?.trainsSent ?? 0);
    const interval = game.config().trainIntervalTicks();
    for (let i = 0; i < interval * 20; i++) game.executeNextTick();
    expect(Number(stats(game, me)?.trainsSent ?? 0) - before).toBe(20);
  }, 60_000);

  it("фабрика без других станций в сети поездов не шлёт", async () => {
    const { game, me } = await network([], [[60, 60, 1]]);
    for (let i = 0; i < 1500; i++) game.executeNextTick();
    expect(Number(stats(game, me)?.trainsSent ?? 0)).toBe(0);
  }, 60_000);
});

describe("маршрут — обход сети", () => {
  it("заходит во все точки сети, возвраты не считаются новыми", async () => {
    const { game, me } = await network(
      [
        [100, 60],
        [60, 100],
        [20 + 5, 60],
      ],
      [[60, 60, 1]],
    );
    const factory = me.units(UnitType.Factory)[0];
    const station = [...game.railNetwork().stationManager().getAll()].find(
      (s: TrainStation) => s.unit === factory,
    )!;
    expect(station).toBeDefined();
    const route = buildTrainTour(station, me, new PseudoRandom(7), {
      maxStops: 10,
      maxTiles: 10_000,
    });
    const distinct = new Set(route);
    // фабрика + все три города
    expect(distinct.size).toBe(4);
    for (let i = 0; i + 1 < route.length; i++) {
      expect(route[i].getRailroadTo(route[i + 1])).not.toBeNull();
    }
    // рейс заканчивается у последней НОВОЙ станции, а не хвостом возвратов
    const last = route[route.length - 1];
    expect(route.indexOf(last)).toBe(route.length - 1);
  }, 60_000);

  it("за рейс станция платит один раз", async () => {
    const { game } = await network(
      [
        [100, 60],
        [60, 100],
        [25, 60],
      ],
      [[60, 60, 1]],
    );
    const seen = new Map<TrainExecution, TrainStation[]>();
    const orig = TrainStation.prototype.onTrainStop;
    TrainStation.prototype.onTrainStop = function (exec: TrainExecution) {
      const list = seen.get(exec) ?? [];
      list.push(this);
      seen.set(exec, list);
      return orig.call(this, exec);
    };
    try {
      for (let i = 0; i < 1500; i++) game.executeNextTick();
    } finally {
      TrainStation.prototype.onTrainStop = orig;
    }
    expect(seen.size).toBeGreaterThan(3);
    let multiStop = 0;
    for (const stops of seen.values()) {
      expect(new Set(stops).size).toBe(stops.length);
      if (stops.length > 1) multiStop++;
    }
    // обход реально собирает несколько точек за рейс
    expect(multiStop).toBeGreaterThan(0);
  }, 60_000);
});

describe("уровень фабрики — длиннее поезд", () => {
  it("ур.3 везёт больше вагонов и зарабатывает больше чем вдвое против ур.1", async () => {
    const cities: [number, number][] = [
      [100, 60],
      [140, 60],
    ];
    const l1 = await network(cities, [[60, 60, 1]]);
    const l3 = await network(cities, [[60, 60, 3]]);
    const g1 = trainGold(l1.game, l1.me);
    const g3 = trainGold(l3.game, l3.me);
    let cars1 = 0;
    let cars3 = 0;
    for (let i = 0; i < 1500; i++) {
      l1.game.executeNextTick();
      l3.game.executeNextTick();
      cars1 = Math.max(cars1, l1.me.units(UnitType.Train).length);
      cars3 = Math.max(cars3, l3.me.units(UnitType.Train).length);
    }
    const d1 = trainGold(l1.game, l1.me) - g1;
    const d3 = trainGold(l3.game, l3.me) - g3;
    expect(d1).toBeGreaterThan(0);
    expect(d3).toBeGreaterThan(d1 * 2);
    expect(cars3).toBeGreaterThan(cars1);
  }, 120_000);
});

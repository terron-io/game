// terron 26.09: НЕРФ ПОЕЗДОВ И ПОРТОВ + цена морского космодрома (дев).
// Решения владельца после двух дней беты (TerronTuning §ФАБРИКИ И ПОЕЗДА):
//  • вагонов 2 на уровень — N фабрик 1-го ур. = одна фабрика N-го (паритет);
//  • новая фабрика пускает первый поезд сразу, не дожидаясь расписания;
//  • каждая следующая платная точка рейса ×0.85, свои/чужие/союзные — ×1;
//  • порты ×0.8;
//  • морской космодром (×2) — проверка золота и цена на кнопке по цене МЕСТА
//    (репорт boom871: «пишет 5кк, а списывает всё, что есть»).
import { describe, expect, it } from "vitest";
import {
  TERRON_PORT_GOLD_MULT,
  TERRON_SPACEPORT_SEA_COST_MULT,
  TERRON_TRAIN_STOP_DECAY,
} from "../src/core/configuration/TerronTuning";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  TrainType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

async function plains(): Promise<{ game: Game; me: Player }> {
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
  return { game, me };
}

const trainsSent = (game: Game, me: Player): number =>
  Number((game.stats().getPlayerStats(me) as any)?.trainsSent ?? 0);

describe("вагоны и выплаты", () => {
  it("паритет: фабрика N-го уровня = N фабрик 1-го по вагонам", async () => {
    const { game } = await plains();
    const c = game.config();
    for (const n of [2, 3, 5, 10]) {
      expect(c.trainCars(n)).toBe(n * c.trainCars(1));
    }
  });

  it("ур.25: на карте не больше 20 вагонов, а платят все 25", async () => {
    const { game, me } = await plains();
    game.addExecution(
      new ConstructionExecution(me, UnitType.City, game.ref(150, 60)),
    );
    for (let i = 0; i < 5; i++) game.executeNextTick();
    const cfg = game.config();
    const orig = cfg.trainGold.bind(cfg);
    const paidCars: number[] = [];
    cfg.trainGold = (rel, cars, tiles, player, stopIndex = 0) => {
      paidCars.push(cars);
      return orig(rel, cars, tiles, player, stopIndex);
    };
    game.addExecution(
      new ConstructionExecution(me, UnitType.Factory, game.ref(60, 60)),
    );
    game.executeNextTick();
    game.executeNextTick();
    for (let l = 1; l < 25; l++) me.units(UnitType.Factory)[0].increaseLevel();
    let shown = 0;
    for (let i = 0; i < 400; i++) {
      game.executeNextTick();
      shown = Math.max(
        shown,
        me
          .units(UnitType.Train)
          .filter((u) => u.trainType() === TrainType.Carriage).length,
      );
    }
    expect(paidCars).toContain(25);
    expect(shown).toBeGreaterThan(10);
    expect(shown).toBe(20);
  }, 60_000);

  it("свои, чужие, союзные и командные станции платят одинаково", async () => {
    const { game, me } = await plains();
    const c = game.config();
    const self = c.trainGold("self", 2, 30, me);
    for (const rel of ["other", "ally", "team"] as const) {
      expect(c.trainGold(rel, 2, 30, me)).toBe(self);
    }
  });

  it("каждая следующая платная точка — ×0.85 от предыдущей", async () => {
    const { game, me } = await plains();
    const c = game.config();
    const g = [0, 1, 2, 3].map((i) =>
      Number(c.trainGold("self", 4, 0, me, i)),
    );
    for (let i = 1; i < g.length; i++) {
      expect(g[i]).toBeLessThan(g[i - 1]);
      expect(g[i] / g[i - 1]).toBeCloseTo(TERRON_TRAIN_STOP_DECAY, 2);
    }
  });

  it("в рейсе точки получают возрастающий номер (спад реально работает)", async () => {
    const { game, me } = await plains();
    for (const [x, y] of [
      [100, 60],
      [60, 100],
      [25, 60],
    ]) {
      game.addExecution(
        new ConstructionExecution(me, UnitType.City, game.ref(x, y)),
      );
    }
    for (let i = 0; i < 5; i++) game.executeNextTick();
    const cfg = game.config();
    const orig = cfg.trainGold.bind(cfg);
    const seen: number[] = [];
    cfg.trainGold = (rel, cars, tiles, player, stopIndex = 0) => {
      seen.push(stopIndex);
      return orig(rel, cars, tiles, player, stopIndex);
    };
    game.addExecution(
      new ConstructionExecution(me, UnitType.Factory, game.ref(60, 60)),
    );
    for (let i = 0; i < 400; i++) game.executeNextTick();
    expect(seen).toContain(0);
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("порты: выплата торгового корабля ×0.8 от апстрима", async () => {
    const { game, me } = await plains();
    const c = game.config();
    const debuff = c.tradeShipShortRangeDebuff();
    for (const d of [50, 200, 600]) {
      const upstream = 75_000 / (1 + Math.exp(-0.03 * (d - debuff))) + 50 * d;
      // число решения прибито руками: сверка с той же константой, что читает
      // код, зеленела бы при любом её значении (обратный прогон 27.09)
      expect(TERRON_PORT_GOLD_MULT).toBe(0.8);
      expect(Number(c.tradeShipGold(d, me))).toBe(Math.floor(upstream * 0.8));
    }
  });

  it("вся выплата поезда ×0.8: своя точка, 1 вагон, рядом — 8 000", async () => {
    const { game, me } = await plains();
    expect(Number(game.config().trainGold("self", 1, 0, me))).toBe(8_000);
  });

  it("поезд фабрики выходит раз в 30 секунд", async () => {
    const { game } = await plains();
    expect(game.config().trainIntervalTicks()).toBe(300);
  });
});

describe("первый поезд новой фабрики", () => {
  it("уходит сразу после постройки, не дожидаясь своей фазы", async () => {
    const { game, me } = await plains();
    game.addExecution(
      new ConstructionExecution(me, UnitType.City, game.ref(100, 60)),
    );
    for (let i = 0; i < 5; i++) game.executeNextTick();
    const interval = game.config().trainIntervalTicks();
    game.addExecution(
      new ConstructionExecution(me, UnitType.Factory, game.ref(60, 60)),
    );
    const start = game.ticks();
    for (let i = 0; i < 15; i++) game.executeNextTick();
    const factory = me.units(UnitType.Factory)[0];
    // Предусловие: по расписанию в этом окне поезд не положен — иначе тест
    // ничего бы не доказывал.
    let scheduled = false;
    for (let t = start; t <= game.ticks(); t++) {
      if ((t + factory.id()) % interval === 0) scheduled = true;
    }
    expect(scheduled).toBe(false);
    expect(trainsSent(game, me)).toBe(1);
  }, 60_000);
});

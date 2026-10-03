import { GameMode, PlayerType, UnitType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

// terron 04.09 ПЕРФ: GameImpl.unitCount кэширует глобальные счётчики и
// сбрасывает кэш на КАЖДОЙ мутации состава/уровня. Кэш обязан быть точным
// (не «раз в тик»): ПВО читает «в небе пусто» посреди тика, и запоздание на
// тик сдвинуло бы перехват — хэши боевого реплея разошлись бы. Здесь каждая
// мутация проверяется сразу после себя, без смены тика.
describe("GameImpl.unitCount cache", () => {
  test("build / level up / level down / delete are visible immediately", async () => {
    const game = await setup("plains", { gameMode: GameMode.FFA }, [
      playerInfo("p1", PlayerType.Human),
    ]);
    const p1 = game.player("p1");
    const spawn = game.ref(10, 10);
    game.executeNextTick();
    p1.conquer(spawn);

    expect(game.unitCount(UnitType.City)).toBe(0);
    const city = p1.buildUnit(UnitType.City, spawn, {});
    expect(game.unitCount(UnitType.City)).toBe(1);

    city.increaseLevel();
    expect(game.unitCount(UnitType.City)).toBe(2); // уровни суммируются
    city.setLevel(5);
    expect(game.unitCount(UnitType.City)).toBe(5);
    city.decreaseLevel();
    expect(game.unitCount(UnitType.City)).toBe(4);

    city.delete(false);
    expect(game.unitCount(UnitType.City)).toBe(0);
  });

  test("capture resets the level and the global count follows", async () => {
    const game = await setup("plains", { gameMode: GameMode.FFA }, [
      playerInfo("p1", PlayerType.Human),
      playerInfo("p2", PlayerType.Human),
    ]);
    const p1 = game.player("p1");
    const p2 = game.player("p2");
    const t = game.ref(12, 12);
    game.executeNextTick();
    p1.conquer(t);
    const city = p1.buildUnit(UnitType.City, t, {});
    city.setLevel(3);
    expect(game.unitCount(UnitType.City)).toBe(3);
    city.setOwner(p2);
    expect(city.owner()).toBe(p2);
    expect(game.unitCount(UnitType.City)).toBe(city.level());
  });
});

// terron: захват чужого ульт-здания — ПАССИВКА переходит новому владельцу, а
// АКТИВКА (пуск МИРВ / каст Раскола) остаётся по СВОЕМУ выбору. Спека: ULTIMATES.md
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let a: Player;
let b: Player;

describe("Capture ultimate: passive transfers, active stays yours (terron)", () => {
  beforeEach(async () => {
    game = await setup("big_plains", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "a_id"),
      new PlayerInfo("b", PlayerType.Human, null, "b_id"),
    ]);
    a = game.player("a_id");
    b = game.player("b_id");
    a.addGold(100_000_000n);
    b.addGold(100_000_000n);
    game.config().structureMinDist = () => 0;
    // A владеет левым блоком, B — правым.
    for (let x = 10; x < 30; x++) {
      for (let y = 10; y < 30; y++) {
        const t = game.ref(x, y);
        if (game.map().isLand(t)) a.conquer(t);
      }
    }
    for (let x = 60; x < 80; x++) {
      for (let y = 10; y < 30; y++) {
        const t = game.ref(x, y);
        if (game.map().isLand(t)) b.conquer(t);
      }
    }
  });

  test("capturing an enemy Central Bank moves its PASSIVE to the captor", () => {
    const bankTile = game.ref(15, 15);
    const bank = a.buildUnit(UnitType.CentralBank, bankTile, {});
    expect(a.hasUltimate(UnitType.CentralBank)).toBe(true);
    expect(b.hasUltimate(UnitType.CentralBank)).toBe(false);

    expect(bank.capturedTick()).toBeNull(); // построено — не захвачено

    // B захватывает здание.
    b.captureUnit(bank);
    expect(bank.owner()).toBe(b);
    expect(b.hasUltimate(UnitType.CentralBank)).toBe(true); // пассивка у нового владельца
    expect(a.hasUltimate(UnitType.CentralBank)).toBe(false); // у старого пропала
    // #3 (самоуничтожение) — архитектура: тик захвата зафиксирован (флаг
    // TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS=0 → само взрывание выкл по умолчанию).
    expect(bank.capturedTick()).not.toBeNull();
  });

  test("two owned ult buildings → two passives active at once", () => {
    // A строит Центробанк (своя ульта, выбор фиксируется на нём).
    a.buildUnit(UnitType.CentralBank, game.ref(15, 15), {});
    // B строит Танковый завод, A его захватывает.
    const tank = b.buildUnit(UnitType.TankFactory, game.ref(65, 15), {});
    a.captureUnit(tank);
    expect(a.hasUltimate(UnitType.CentralBank)).toBe(true);
    expect(a.hasUltimate(UnitType.TankFactory)).toBe(true); // 2 пассивки
  });

  test("capturing an enemy Nuclear Factory does NOT grant the MIRV active", () => {
    // A выбрал Укрепления (активка/выбор — свой). Раньше тут была Мин правды —
    // с 06.08 она влита в МЕДИА и отдельным зданием не строится.
    a.buildUnit(UnitType.Fortifications, game.ref(15, 15), {});
    expect(a.ultimateChoice()).toBe(UnitType.Fortifications);

    // B строит Ядерный завод + силос (мог бы пускать МИРВ).
    const factory = b.buildUnit(UnitType.NuclearFactory, game.ref(65, 15), {});
    b.buildUnit(UnitType.MissileSilo, game.ref(67, 15), {});
    expect(b.canBuild(UnitType.MIRV, game.ref(67, 15))).not.toBe(false);

    // A захватывает завод — получает пассивку (у завода её нет), но НЕ активку МИРВ.
    a.captureUnit(factory);
    a.buildUnit(UnitType.MissileSilo, game.ref(18, 18), {});
    expect(a.hasUltimate(UnitType.NuclearFactory)).toBe(true); // «пассивка» есть
    // но активка МИРВ НЕДОСТУПНА — выбор A = Укрепления, не завод.
    expect(a.canBuild(UnitType.MIRV, game.ref(18, 18))).toBe(false);
  });

  // terron: САМОУНИЧТОЖЕНИЕ захваченной чужой ульты (включено 18.07,
  // TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS=600): через 60с владения здание
  // взрывается «ядерным взрывом» (кратер по радиусу), своя выбранная — никогда.
  test("captured foreign ult self-destructs after the timer; own choice never does", async () => {
    const { PlayerExecution } =
      await import("../src/core/execution/PlayerExecution");
    const { TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS } =
      await import("../src/core/configuration/TerronTuning");
    expect(TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS).toBeGreaterThan(0); // фича включена

    // B выбирает свою ульту (Центробанк) — она самоуничтожаться не должна.
    const own = b.buildUnit(UnitType.CentralBank, game.ref(65, 15), {});
    // A строит Танковый завод; B завоёвывает землю под ним (иначе PlayerExecution
    // на первом же тике вернёт здание владельцу тайла) и захватывает его.
    const tank = a.buildUnit(UnitType.TankFactory, game.ref(15, 15), {});
    for (let x = 10; x < 30; x++) {
      for (let y = 10; y < 30; y++) {
        const t = game.ref(x, y);
        if (game.map().isLand(t)) b.conquer(t);
      }
    }
    b.captureUnit(tank);
    expect(tank.owner()).toBe(b);
    expect(b.hasUltimate(UnitType.TankFactory)).toBe(true);

    game.addExecution(new PlayerExecution(b));
    for (let i = 0; i < TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS + 5; i++) {
      game.executeNextTick();
    }

    // Захваченный чужой завод взорвался, своя выбранная ульта цела.
    expect(tank.isActive()).toBe(false);
    expect(b.hasUltimate(UnitType.TankFactory)).toBe(false);
    expect(own.isActive()).toBe(true);
    expect(b.hasUltimate(UnitType.CentralBank)).toBe(true);
  });
});

// terron 23.08: СЕКРЕТНЫЙ КРУГ — «ты нашёл клад» (new-units/CUBE.md).
//
// Постройки нет ни в сетке выбора, ни в вики, ни в дереве ульт: вызывается
// вводом кода 1337 прямо на сетке ульт. Тратит единственный на матч выбор
// ульты и разом выдаёт клад.
//
// Перенесено из ветки claude/secret-ults (автор — соседняя сессия) вместе с
// её разбором; Квадрат намеренно не тащили.
import { beforeEach, describe, expect, test } from "vitest";
import {
  TERRON_TREASURE_PAYOUT,
  TERRON_ULT_BUILDING_COST,
} from "../src/core/configuration/TerronTuning";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import {
  Game,
  isLockedUltimate,
  isSecretUltimate,
  Player,
  PlayerInfo,
  PlayerType,
  SECRET_ULTIMATES,
  Structures,
  Ultimates,
  UnitType,
} from "../src/core/game/Game";
import {
  TERRON_TREASURE_CODE,
  TERRON_WALKING_CODE,
} from "../src/core/configuration/TerronTuning";
import { setup } from "./util/Setup";

let game: Game;
let a: Player;

describe("Секретный круг (terron)", () => {
  beforeEach(async () => {
    game = await setup("big_plains", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "a_id"),
    ]);
    a = game.player("a_id");
    game.config().structureMinDist = () => 0;
    for (let x = 10; x < 30; x++) {
      for (let y = 10; y < 30; y++) {
        const t = game.ref(x, y);
        if (game.map().isLand(t)) a.conquer(t);
      }
    }
  });

  test("проводка: ульта-структура, помечена секретной", () => {
    const t = UnitType.SecretTreasure;
    expect(Ultimates.has(t)).toBe(true);
    expect(Structures.has(t)).toBe(true);
    expect(isSecretUltimate(t)).toBe(true);
    expect(SECRET_ULTIMATES).toContain(t);
  });

  test("стоит как ульт-штаб и выдаёт клад ровно один раз", () => {
    const tile = game.ref(15, 15);
    // Цена и есть гейт: без денег на штаб клад не построить.
    expect(a.gold()).toBe(0n);
    expect(a.canBuild(UnitType.SecretTreasure, tile)).toBe(false);

    a.addGold(BigInt(TERRON_ULT_BUILDING_COST));
    expect(a.canBuild(UnitType.SecretTreasure, tile)).not.toBe(false);

    const before = a.gold();
    game.addExecution(
      new ConstructionExecution(a, UnitType.SecretTreasure, tile),
    );
    for (let i = 0; i < 10; i++) game.executeNextTick();

    // Списали цену штаба, выдали клад — и ровно один раз, сколько бы тиков ни
    // прошло. Чистый выигрыш = выплата минус цена.
    expect(a.gold() - before).toBe(
      TERRON_TREASURE_PAYOUT - BigInt(TERRON_ULT_BUILDING_COST),
    );
    expect(a.ultimateChoice()).toBe(UnitType.SecretTreasure);
  });

  test("клад вдвое дороже собственной цены", () => {
    // Иначе обмен «слот ульты → деньги» не имеет смысла: платить 5M за 5M
    // никто не станет, а слот на матч всего один.
    expect(TERRON_TREASURE_PAYOUT).toBe(BigInt(TERRON_ULT_BUILDING_COST) * 2n);
  });
});

// terron 25.08: ШАГАЮЩИЙ ГОРОД — второй секрет, код 4444 (решение владельца
// «смотри как работает 1337»). Отличие от клада: у него ЕЩЁ И ЗАМОК —
// код показывает слот, а взять ульту сможет лишь открывший ключ.
describe("Второй секрет: Шагающий город", () => {
  test("секретный И закрытый (у клада замка нет)", () => {
    expect(isSecretUltimate(UnitType.WalkingCity)).toBe(true);
    expect(isLockedUltimate(UnitType.WalkingCity)).toBe(true);
    expect(isSecretUltimate(UnitType.SecretTreasure)).toBe(true);
    expect(isLockedUltimate(UnitType.SecretTreasure)).toBe(false);
  });

  test("коды разные и не пересекаются по префиксу", () => {
    const a = TERRON_TREASURE_CODE.join("");
    const b = TERRON_WALKING_CODE.join("");
    expect(a).not.toBe(b);
    // Набор одного кода не должен «по дороге» открывать другой.
    expect(a.startsWith(b) || b.startsWith(a)).toBe(false);
  });
});

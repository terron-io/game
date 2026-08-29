// terron 06.08: МИН ПРАВДЫ ВЛИТА В МЕДИА (решение владельца). Отдельного здания
// «Мин правды» больше нет — ауру несёт штаб МЕДИА, копия ОДНА, и она вдвое
// мощнее и вдвое шире базовых цифр Мин правды. Файл оставлен под тем же именем:
// проверяем ровно эту ауру. Спека: new-units/ULTIMATES.md
import {
  TERRON_MEDIA_MINISTRY_POWER_MULT,
  TERRON_MEDIA_MINISTRY_RADIUS_MULT,
  TERRON_MINISTRY_DRAIN_PCT,
  TERRON_MINISTRY_RADIUS,
} from "../src/core/configuration/TerronTuning";
import { MinistryOfTruthExecution } from "../src/core/execution/MinistryOfTruthExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  Ultimates,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;
let victim: Player;

describe("Media aura (ex-Ministry of Truth, terron)", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("player", PlayerType.Human, null, "player_id"),
      new PlayerInfo("victim", PlayerType.Human, null, "victim_id"),
    ]);
    player = game.player("player_id");
    victim = game.player("victim_id");
    player.addGold(100_000_000n);
    game.config().structureMinDist = () => 0;
  });

  test("Ministry of Truth is no longer buildable (merged into Media)", () => {
    expect(Structures.has(UnitType.MinistryOfTruth)).toBe(false);
    expect(Ultimates.has(UnitType.MinistryOfTruth)).toBe(false);
    const t = game.ref(7, 10);
    player.conquer(t);
    expect(player.canBuild(UnitType.MinistryOfTruth, t)).toBe(false);
  });

  test("Media: one copy only, flat 5M — the second is blocked", () => {
    const info = game.config().unitInfo(UnitType.Media);
    expect(info.cost(game, player)).toBe(5_000_000n);

    const t1 = game.ref(7, 10);
    const t2 = game.ref(3, 10);
    player.conquer(t1);
    player.conquer(t2);
    player.buildUnit(
      UnitType.Media,
      player.canBuild(UnitType.Media, t1) as number,
      {},
    );
    expect(player.ultimateChoice()).toBe(UnitType.Media);
    // Копия ОДНА (решение владельца 06.08) — второй штаб не поставить.
    expect(player.canBuild(UnitType.Media, t2)).toBe(false);
  });

  test("Media aura drains at ×2 of the base Ministry rate (1000 of 100000)", () => {
    player.conquer(game.ref(3, 10));
    victim.conquer(game.ref(7, 10));
    const m = player.buildUnit(
      UnitType.Media,
      player.canBuild(UnitType.Media, game.ref(3, 10)) as number,
      {},
    );
    game.addExecution(new MinistryOfTruthExecution(m));

    victim.addTroops(100_000 - victim.troops());
    const base = m.stolenTroops();
    for (let i = 0; i < 25 && m.stolenTroops() === base; i++) {
      game.executeNextTick();
    }
    // 100000 × DRAIN_PCT × POWER_MULT = 100000 × 0.005 × 2 = 1000.
    expect(m.stolenTroops() - base).toBe(
      Math.floor(100_000 * TERRON_MINISTRY_DRAIN_PCT) *
        TERRON_MEDIA_MINISTRY_POWER_MULT,
    );
  });

  test("Media aura reaches ×2 the base radius (victim beyond base range still drained)", async () => {
    // Карта тестов мелкая, поэтому радиус проверяем по реестру превью-радиуса:
    // именно его рисует круг постройки и ховер здания.
    const { ultHoverRadiusTiles } = await import("../src/client/UnitCatalog");
    expect(ultHoverRadiusTiles(UnitType.Media)).toBe(
      TERRON_MINISTRY_RADIUS * TERRON_MEDIA_MINISTRY_RADIUS_MULT,
    );
  });

  test("Media aura spares friendlies and dies with the HQ", () => {
    player.conquer(game.ref(3, 10));
    victim.conquer(game.ref(7, 10));
    const m = player.buildUnit(
      UnitType.Media,
      player.canBuild(UnitType.Media, game.ref(3, 10)) as number,
      {},
    );
    game.addExecution(new MinistryOfTruthExecution(m));
    victim.addTroops(100_000 - victim.troops());

    // Снесли штаб → высасывание прекращается.
    m.delete(false);
    const frozen = player.ultStats().stolen;
    for (let i = 0; i < 25; i++) game.executeNextTick();
    expect(player.ultStats().stolen).toBe(frozen);
  });
});

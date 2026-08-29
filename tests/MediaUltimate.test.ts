// terron: ультимейты — МЕДИА (штаб). Пассив: предательство НЕ карается меткой
// предателя, пока штаб жив. Разблокирует каст Раскола (1:1 старый Split), который
// БЕЗ МЕДИА недоступен. Спека: new-units/ULTIMATES.md
import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
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
let other: Player;

function ally(a: Player, b: Player) {
  game.addExecution(new AllianceRequestExecution(a, b.id()));
  game.executeNextTick();
  game.addExecution(new AllianceRequestExecution(b, a.id()));
  game.executeNextTick();
}

describe("Media ultimate (terron)", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("player", PlayerType.Human, null, "player_id"),
      new PlayerInfo("other", PlayerType.Human, null, "other_id"),
    ]);
    player = game.player("player_id");
    other = game.player("other_id");
    player.addGold(100_000_000n);
    other.addGold(100_000_000n);
    player.addTroops(1_000_000);
    game.config().structureMinDist = () => 0;
    // Игроки должны быть на карте, а фаза спавна — завершена (иначе альянсы и
    // часть логики не работают).
    player.conquer(game.ref(7, 10));
    other.conquer(game.ref(3, 10));
    while (game.inSpawnPhase()) game.executeNextTick();
  });

  test("Media is a structure, an ultimate, costs 5M; Split is NOT an ultimate", () => {
    expect(Structures.has(UnitType.Media)).toBe(true);
    expect(Ultimates.has(UnitType.Media)).toBe(true);
    expect(Ultimates.has(UnitType.Split)).toBe(false); // раскол разблокируется МЕДИА
    expect(
      game.config().unitInfo(UnitType.Media).cost(game, player),
    ).toBe(5_000_000n);
  });

  test("Split is locked without a Media building, unlocked with one", () => {
    const mTile = game.ref(7, 10);
    const splitTarget = game.ref(3, 10);
    player.conquer(mTile);
    other.conquer(splitTarget);

    // Без МЕДИА раскол недоступен.
    expect(player.canBuild(UnitType.Split, splitTarget)).toBe(false);

    // Строим МЕДИА → раскол разблокирован.
    player.buildUnit(UnitType.Media, mTile, {});
    expect(player.ultimateChoice()).toBe(UnitType.Media); // выбор зафиксирован
    expect(player.canBuild(UnitType.Split, splitTarget)).not.toBe(false);
  });

  test("betrayal is NOT punished while Media stands", () => {
    ally(player, other);
    expect(player.isAlliedWith(other)).toBe(true);

    player.conquer(game.ref(7, 10));
    player.buildUnit(UnitType.Media, game.ref(7, 10), {});

    const alliance = player.allianceWith(other);
    expect(alliance).not.toBeNull();
    player.breakAlliance(alliance!);

    // МЕДИА оправдывает — метки предателя нет.
    expect(player.isTraitor()).toBe(false);
  });

  test("betrayal IS punished without Media (control)", () => {
    ally(player, other);
    const alliance = player.allianceWith(other);
    player.breakAlliance(alliance!);
    expect(player.isTraitor()).toBe(true);
  });
});

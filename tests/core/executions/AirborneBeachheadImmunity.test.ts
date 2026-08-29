import { beforeEach, describe, expect, test } from "vitest";
import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

// terron: авиация — десантный плацдарм защищает окружённый кластер от авто-схлопывания
// (PlayerExecution.removeClusters), пока метка не истекла И тайл ещё наш. Спека: airport.md.
let game: Game;
let largePlayer: Player;
let smallPlayer: Player;

// Малый игрок = крошечный карман, полностью окружённый большим.
function surroundSmallPocket() {
  smallPlayer.conquer(game.ref(50, 50));
  smallPlayer.conquer(game.ref(50, 51));
  smallPlayer.conquer(game.ref(51, 50));
  smallPlayer.conquer(game.ref(51, 51));
  game.map().forEachTile((tile) => {
    if (game.ownerID(tile) !== smallPlayer.smallID()) {
      largePlayer.conquer(tile);
    }
  });
}

describe("Airborne beachhead immunity", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("large", PlayerType.Human, "client1", "large_id"),
        new PlayerInfo("small", PlayerType.Human, "client2", "small_id"),
      ],
    );
    largePlayer = game.player("large_id");
    smallPlayer = game.player("small_id");
    game.addExecution(new PlayerExecution(largePlayer));
    game.addExecution(new PlayerExecution(smallPlayer));
  });

  test("control: surrounded pocket without a beachhead is annexed", () => {
    surroundSmallPocket();
    expect(smallPlayer.numTilesOwned()).toBeGreaterThan(0);

    executeTicks(game, 20);
    smallPlayer.conquer(game.ref(50, 50)); // bump lastTileChange to trigger calc

    executeTicks(game, 50);
    expect(smallPlayer.numTilesOwned()).toBe(0);
  });

  test("active beachhead keeps the surrounded pocket alive", () => {
    surroundSmallPocket();
    // Immunity far beyond the test horizon (~tick 70).
    smallPlayer.addAirborneBeachhead(game.ref(50, 50), 1000);
    expect(smallPlayer.numTilesOwned()).toBeGreaterThan(0);

    executeTicks(game, 20);
    smallPlayer.conquer(game.ref(50, 50));

    executeTicks(game, 50);
    expect(smallPlayer.numTilesOwned()).toBeGreaterThan(0);
  });

  test("beachhead is kept the whole time while its cluster stays landlocked", () => {
    // Even though the pocket is not geometrically 'surrounded' every single tick
    // while it grows, a landlocked (no shore/edge) beachhead must keep its mark
    // for the full immunity window — this is the bug the fix targets.
    surroundSmallPocket();
    smallPlayer.addAirborneBeachhead(game.ref(50, 50), 100_000);

    executeTicks(game, 20);
    smallPlayer.conquer(game.ref(50, 50)); // bump lastTileChange
    executeTicks(game, 40);

    expect(smallPlayer.activeAirborneBeachheads(game.ticks()).size).toBe(1);
    expect(smallPlayer.numTilesOwned()).toBeGreaterThan(0);
  });

  test("beachhead protects the pocket even when the drop tile is interior", () => {
    // 3x3 block → center (51,51) is INTERIOR (all cardinal neighbors are own, so
    // it is not a border tile). Region-based immunity must still protect it.
    for (let x = 50; x <= 52; x++) {
      for (let y = 50; y <= 52; y++) {
        smallPlayer.conquer(game.ref(x, y));
      }
    }
    game.map().forEachTile((tile) => {
      if (game.ownerID(tile) !== smallPlayer.smallID() && game.isLand(tile)) {
        largePlayer.conquer(tile);
      }
    });
    smallPlayer.addAirborneBeachhead(game.ref(51, 51), 100_000); // interior
    expect(smallPlayer.numTilesOwned()).toBe(9);

    executeTicks(game, 20);
    smallPlayer.conquer(game.ref(51, 51)); // bump lastTileChange
    executeTicks(game, 40);

    expect(smallPlayer.numTilesOwned()).toBe(9); // survived
    expect(smallPlayer.activeAirborneBeachheads(game.ticks()).size).toBe(1);
  });

  test("beachhead is dropped once its cluster reaches the map edge", () => {
    // A cluster touching the map edge has an escape route → no longer at risk,
    // so the mark (and the timer) is cleared. Corner (0,0) is on the edge.
    smallPlayer.conquer(game.ref(0, 0));
    smallPlayer.conquer(game.ref(0, 1));
    smallPlayer.conquer(game.ref(1, 0));
    game.map().forEachTile((tile) => {
      if (game.ownerID(tile) !== smallPlayer.smallID() && game.isLand(tile)) {
        largePlayer.conquer(tile);
      }
    });
    smallPlayer.addAirborneBeachhead(game.ref(0, 0), 100_000);
    expect(smallPlayer.activeAirborneBeachheads(game.ticks()).size).toBe(1);

    executeTicks(game, 20);
    smallPlayer.conquer(game.ref(0, 0)); // bump lastTileChange
    executeTicks(game, 30);

    expect(smallPlayer.activeAirborneBeachheads(game.ticks()).size).toBe(0);
  });

  test("pocket is annexed once beachhead immunity expires", () => {
    surroundSmallPocket();
    // Expires at tick 30.
    smallPlayer.addAirborneBeachhead(game.ref(50, 50), 30);

    executeTicks(game, 20);
    smallPlayer.conquer(game.ref(50, 50)); // bump; immunity still active → survives
    executeTicks(game, 20);
    expect(smallPlayer.numTilesOwned()).toBeGreaterThan(0);

    // Past expiry: a fresh tile change re-triggers the cluster calc (in real games
    // tiles change constantly), and with no immunity the pocket is annexed.
    smallPlayer.conquer(game.ref(50, 50));
    executeTicks(game, 20);
    expect(smallPlayer.numTilesOwned()).toBe(0);
  });
});

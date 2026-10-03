import { GameUpdateType } from "src/core/game/GameUpdates";
import { vi, type Mocked } from "vitest";
import { Config } from "../../../src/core/configuration/Config";
import { TrainExecution } from "../../../src/core/execution/TrainExecution";
import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { Cluster, TrainStation } from "../../../src/core/game/TrainStation";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig } from "../../../src/core/Schemas";

vi.mock("../../../src/core/game/Game");
vi.mock("../../../src/core/execution/TrainExecution");
vi.mock("../../../src/core/PseudoRandom");

describe("TrainStation", () => {
  let game: Mocked<Game>;
  let gameStats: {
    trainExternalTrade: ReturnType<typeof vi.fn>;
    trainSelfTrade: ReturnType<typeof vi.fn>;
  };
  let unit: Mocked<Unit>;
  let player: Mocked<Player>;
  let trainExecution: Mocked<TrainExecution>;

  beforeEach(() => {
    gameStats = {
      trainExternalTrade: vi.fn(),
      trainSelfTrade: vi.fn(),
    };
    game = {
      ticks: vi.fn().mockReturnValue(123),
      config: vi.fn().mockReturnValue({
        trainGold: (rel: string, _cars: number, _tiles: number) =>
          rel !== "other" ? BigInt(1000) : BigInt(500),
      }),
      addUpdate: vi.fn(),
      addExecution: vi.fn(),
      stats: vi.fn().mockReturnValue(gameStats),
    } as any;

    player = {
      addGold: vi.fn(),
      id: 1,
      canTrade: vi.fn().mockReturnValue(true),
      isAlliedWith: vi.fn().mockReturnValue(false),
      isOnSameTeam: vi.fn().mockReturnValue(false),
      isFriendly: vi.fn().mockReturnValue(false),
    } as any;

    unit = {
      owner: vi.fn().mockReturnValue(player),
      level: vi.fn().mockReturnValue(1),
      tile: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      type: vi.fn(),
      isActive: vi.fn().mockReturnValue(true),
    } as any;

    trainExecution = {
      loadCargo: vi.fn(),
      owner: vi.fn().mockReturnValue(player),
      level: vi.fn(),
      payCars: vi.fn().mockReturnValue(3),
      paidTiles: vi.fn().mockReturnValue(0),
      paidStopIndex: vi.fn().mockReturnValue(0),
    } as any;
  });

  it("handles City stop", () => {
    unit.type.mockReturnValue(UnitType.City);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(unit.owner().addGold).toHaveBeenCalledWith(1000n, unit.tile());
  });

  it("handles allied trade", () => {
    unit.type.mockReturnValue(UnitType.City);
    player.isFriendly.mockReturnValue(true);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(unit.owner().addGold).toHaveBeenCalledWith(1000n, unit.tile());
    expect(trainExecution.owner().addGold).toHaveBeenCalledWith(
      1000n,
      unit.tile(),
    );
  });

  it("records external trade on the station owner", () => {
    const stationOwner = {
      addGold: vi.fn(),
      id: 1,
      canTrade: vi.fn().mockReturnValue(true),
      isAlliedWith: vi.fn().mockReturnValue(false),
      isOnSameTeam: vi.fn().mockReturnValue(false),
    } as any;
    const trainOwner = {
      addGold: vi.fn(),
      id: 2,
      canTrade: vi.fn().mockReturnValue(true),
      isAlliedWith: vi.fn().mockReturnValue(false),
      isOnSameTeam: vi.fn().mockReturnValue(false),
    } as any;

    unit.type.mockReturnValue(UnitType.City);
    unit.owner.mockReturnValue(stationOwner);
    trainExecution.owner.mockReturnValue(trainOwner);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(stationOwner.addGold).toHaveBeenCalledWith(500n, unit.tile());
    expect(trainOwner.addGold).toHaveBeenCalledWith(500n, unit.tile());
    expect(gameStats.trainExternalTrade).toHaveBeenCalledWith(
      stationOwner,
      500n,
    );
    expect(gameStats.trainSelfTrade).toHaveBeenCalledWith(trainOwner, 500n);
  });

  it("passes paying cars and path tiles to trainGold", () => {
    unit.type.mockReturnValue(UnitType.City);
    const trainGoldSpy = vi.fn().mockReturnValue(500n);
    (game.config as any).mockReturnValue({
      trainGold: trainGoldSpy,
    });
    (trainExecution as any).payCars = vi.fn().mockReturnValue(7);
    (trainExecution as any).paidTiles = vi.fn().mockReturnValue(42);
    (trainExecution as any).paidStopIndex = vi.fn().mockReturnValue(2);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(trainGoldSpy).toHaveBeenCalledWith(
      expect.any(String),
      7,
      42,
      expect.anything(),
      2,
    );
  });

  // terron 24.09: фабрика в сети — платная точка, как город.
  it("handles Factory stop", () => {
    unit.type.mockReturnValue(UnitType.Factory);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(unit.owner().addGold).toHaveBeenCalledWith(1000n, unit.tile());
  });

  it("checks trade availability (same owner)", () => {
    const otherUnit = {
      owner: vi.fn().mockReturnValue(unit.owner()),
    } as any;

    const station = new TrainStation(game, unit);
    const otherStation = new TrainStation(game, otherUnit);

    expect(station.tradeAvailable(otherStation.unit.owner())).toBe(true);
  });

  it("adds and retrieves neighbors", () => {
    const stationA = new TrainStation(game, unit);
    const stationB = new TrainStation(game, unit);
    const railRoad = { from: stationA, to: stationB, tiles: [] } as any;

    stationA.addRailroad(railRoad);

    const neighbors = stationA.neighbors();
    expect(neighbors).toContain(stationB);
  });

  it("removes neighboring rail", () => {
    const stationA = new TrainStation(game, unit);
    const stationB = new TrainStation(game, unit);

    const railRoad = {
      from: stationA,
      to: stationB,
      tiles: [{ x: 1, y: 1 }],
    } as any;

    stationA.addRailroad(railRoad);
    expect(stationA.getRailroads().size).toBe(1);

    stationA.removeNeighboringRails(stationB);

    expect(game.addUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: GameUpdateType.RailroadDestructionEvent,
      }),
    );
    expect(stationA.getRailroads().size).toBe(0);
  });

  it("assigns and retrieves cluster", () => {
    const cluster: Cluster = {} as Cluster;
    const station = new TrainStation(game, unit);

    station.setCluster(cluster);
    expect(station.getCluster()).toBe(cluster);
  });

  it("returns tile and active status", () => {
    const station = new TrainStation(game, unit);
    expect(station.tile()).toEqual({ x: 0, y: 0 });
    expect(station.isActive()).toBe(true);
  });
});

describe("Config.trainGold per car and distance", () => {
  let config: Config;
  let mockPlayer: Player;

  beforeEach(() => {
    const gameConfig: GameConfig = {
      gameMap: GameMapType.Asia,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Singleplayer,
      difficulty: Difficulty.Medium,
      nations: "default",
      donateGold: false,
      donateTroops: false,
      bots: 0,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      disableNavMesh: false,
      randomSpawn: false,
    };
    config = new Config(gameConfig, new UserSettings(), false);
    mockPlayer = { isLobbyCreator: () => false } as unknown as Player;
  });

  // terron 24.09: РЕБАЛАНС ПОЕЗДОВ (TerronTuning §ФАБРИКИ И ПОЕЗДА): за точку —
  // вагоны × (10 000 + 100 × тайлы, тайлов не больше 120) × отношение; нерф
  // 26.09 — вся выплата ×0.8.
  it("pays per car: base plus distance since the last paid stop", () => {
    expect(config.trainGold("self", 3, 0, mockPlayer)).toBe(24_000n);
    expect(config.trainGold("self", 3, 40, mockPlayer)).toBe(33_600n);
    expect(config.trainGold("self", 7, 40, mockPlayer)).toBe(78_400n);
  });

  it("caps paid distance", () => {
    expect(config.trainGold("self", 1, 500, mockPlayer)).toBe(
      config.trainGold("self", 1, 120, mockPlayer),
    );
    expect(config.trainGold("self", 1, 120, mockPlayer)).toBe(17_600n);
  });

  // 26.09: решение владельца «×1 и свои, и союзные».
  it("foreign, team and ally pay the same as own", () => {
    expect(config.trainGold("other", 1, 0, mockPlayer)).toBe(8_000n);
    expect(config.trainGold("team", 1, 0, mockPlayer)).toBe(8_000n);
    expect(config.trainGold("ally", 1, 0, mockPlayer)).toBe(8_000n);
  });

  it("each next paid stop is ×0.85", () => {
    expect(config.trainGold("self", 1, 0, mockPlayer, 1)).toBe(6_800n);
    expect(config.trainGold("self", 1, 0, mockPlayer, 2)).toBe(5_779n); // 8000 × 0.85² = 5779.99… → вниз
  });

  it("cars grow with factory level: one per level", () => {
    expect([1, 2, 3, 5, 30].map((l) => config.trainCars(l))).toEqual([
      1, 2, 3, 5, 30,
    ]);
  });
});

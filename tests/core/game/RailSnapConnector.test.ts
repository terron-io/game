import { UnitType } from "../../../src/core/game/Game";
import { RailNetworkImpl } from "../../../src/core/game/RailNetworkImpl";
import { Railroad } from "../../../src/core/game/Railroad";
import { Cluster } from "../../../src/core/game/TrainStation";

// terron: при «snap» новой станции к существующему рельсу новые половинки должны
// ФИЗИЧЕСКИ доходить до тайла станции (раньше обрывались у точки разреза → разрыв).
const mockStation = (id: number, tile: number): any => {
  const cluster = new Cluster();
  return {
    unit: { id, setTrainStation: vi.fn(), type: vi.fn(() => UnitType.City) },
    tile: vi.fn(() => tile),
    neighbors: vi.fn(() => []),
    getCluster: vi.fn(() => cluster),
    setCluster: vi.fn(),
    addRailroad: vi.fn(),
    removeRailroad: vi.fn(),
    getRailroads: vi.fn(() => new Set()),
    clearRailroads: vi.fn(),
  };
};

describe("RailNetwork snap connector", () => {
  test("snapped rails reach the new station tile (no gap)", () => {
    const STATION_TILE = 99;
    const RAIL_TILES = [10, 11, 12, 13, 14];

    const game: any = {
      // x: тайлы рельса = их значение; станция (99) проецируется к x=12 → ближайший
      // тайл разреза = 12 (индекс 2, внутренний). y одинаковый.
      x: vi.fn((t: number) => (t === STATION_TILE ? 12 : t)),
      y: vi.fn(() => 0),
      addUpdate: vi.fn(),
      config: () => ({ railroadMaxSize: () => 100 }),
    };
    const stationManager: any = { addStation: vi.fn() };
    const pathService: any = {
      // коннектор разрез(12) → станция(99), A* включает оба конца
      findTilePath: vi.fn((from: number, to: number) =>
        from === 12 && to === STATION_TILE ? [12, 50, STATION_TILE] : [0],
      ),
      findStationsPath: vi.fn(() => []),
    };

    const network = new RailNetworkImpl(game, stationManager, pathService);

    const fromStation = mockStation(1, 10);
    const toStation = mockStation(2, 14);
    const existingRail = new Railroad(fromStation, toStation, RAIL_TILES, 99);
    (network as any).railGrid = {
      query: vi.fn(() => new Set([existingRail])),
      unregister: vi.fn(),
      register: vi.fn(),
    };

    const newStation = mockStation(3, STATION_TILE);
    network.connectStation(newStation);

    const snap = (game.addUpdate.mock.calls as any[][])
      .map((c) => c[0])
      .find((u) => u && u.tiles1 && u.tiles2);
    expect(snap).toBeDefined();
    // обе половины обязаны дотягиваться до тайла станции
    expect(snap.tiles1).toContain(STATION_TILE);
    expect(snap.tiles2).toContain(STATION_TILE);
  });
});

// terron: проверка гейта ж/д-станций — порт/город должны получать станцию только при
// СОБСТВЕННОЙ фабрике рядом, а не при любой (в т.ч. вражеской) в радиусе. Спека: airport.md
import { AirportExecution } from "../src/core/execution/AirportExecution";
import { CityExecution } from "../src/core/execution/CityExecution";
import { PortExecution } from "../src/core/execution/PortExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let me: Player;
let enemy: Player;

describe("Rail station factory gate (terron)", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("me", PlayerType.Human, null, "me_id"),
      new PlayerInfo("enemy", PlayerType.Human, null, "enemy_id"),
    ]);
    me = game.player("me_id");
    enemy = game.player("enemy_id");
    me.addGold(BigInt(10_000_000));
    enemy.addGold(BigInt(10_000_000));
    game.config().structureMinDist = () => 0;
  });

  function runTicks(exec: { init: (g: Game, t: number) => void; tick: (t: number) => void }) {
    exec.init(game, 0);
    for (let t = 0; t < 5; t++) exec.tick(t);
  }

  test("no factory anywhere → port & city get NO station", () => {
    const portTile = game.ref(7, 9);
    const cityTile = game.ref(5, 9);
    me.conquer(portTile);
    me.conquer(cityTile);
    const port = me.buildUnit(
      UnitType.Port,
      me.canBuild(UnitType.Port, portTile) as number,
      {},
    );
    const city = me.buildUnit(
      UnitType.City,
      me.canBuild(UnitType.City, cityTile) as number,
      {},
    );
    runTicks(new PortExecution(port));
    runTicks(new CityExecution(city));
    expect(port.hasTrainStation()).toBe(false);
    expect(city.hasTrainStation()).toBe(false);
  });

  test("only an ENEMY factory nearby → own port & city must still get NO station", () => {
    const portTile = game.ref(7, 9);
    const cityTile = game.ref(5, 9);
    const enemyFactoryTile = game.ref(3, 9);
    me.conquer(portTile);
    me.conquer(cityTile);
    enemy.conquer(enemyFactoryTile);
    enemy.buildUnit(
      UnitType.Factory,
      enemy.canBuild(UnitType.Factory, enemyFactoryTile) as number,
      {},
    );
    const port = me.buildUnit(
      UnitType.Port,
      me.canBuild(UnitType.Port, portTile) as number,
      {},
    );
    const city = me.buildUnit(
      UnitType.City,
      me.canBuild(UnitType.City, cityTile) as number,
      {},
    );
    runTicks(new PortExecution(port));
    runTicks(new CityExecution(city));
    expect(port.hasTrainStation()).toBe(false);
    expect(city.hasTrainStation()).toBe(false);
  });

  test("only an ENEMY factory nearby → own airport must get NO station", () => {
    const airportTile = game.ref(6, 9);
    const enemyFactoryTile = game.ref(3, 9);
    me.conquer(airportTile);
    enemy.conquer(enemyFactoryTile);
    enemy.buildUnit(
      UnitType.Factory,
      enemy.canBuild(UnitType.Factory, enemyFactoryTile) as number,
      {},
    );
    const airport = me.buildUnit(
      UnitType.Airport,
      me.canBuild(UnitType.Airport, airportTile) as number,
      {},
    );
    runTicks(new AirportExecution(airport));
    expect(airport.hasTrainStation()).toBe(false);
  });

  test("own factory nearby → port & city DO get a station", () => {
    const portTile = game.ref(7, 9);
    const cityTile = game.ref(5, 9);
    const factoryTile = game.ref(3, 9);
    me.conquer(portTile);
    me.conquer(cityTile);
    me.conquer(factoryTile);
    const factory = me.buildUnit(
      UnitType.Factory,
      me.canBuild(UnitType.Factory, factoryTile) as number,
      {},
    );
    expect(factory).toBeDefined();
    const port = me.buildUnit(
      UnitType.Port,
      me.canBuild(UnitType.Port, portTile) as number,
      {},
    );
    const city = me.buildUnit(
      UnitType.City,
      me.canBuild(UnitType.City, cityTile) as number,
      {},
    );
    runTicks(new PortExecution(port));
    runTicks(new CityExecution(city));
    expect(port.hasTrainStation()).toBe(true);
    expect(city.hasTrainStation()).toBe(true);
  });
});

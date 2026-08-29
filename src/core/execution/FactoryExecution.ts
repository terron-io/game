import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TrainStationExecution } from "./TrainStationExecution";

export class FactoryExecution implements Execution {
  private active: boolean = true;
  private game: Game;
  private stationCreated = false;

  constructor(private factory: Unit) {}

  init(mg: Game, ticks: number): void {
    this.game = mg;
  }

  tick(ticks: number): void {
    if (!this.stationCreated) {
      this.createStation();
      this.stationCreated = true;
    }
    if (!this.factory.isActive()) {
      this.active = false;
      return;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private createStation(): void {
    const structures = this.game.nearbyUnits(
      this.factory.tile()!,
      this.game.config().trainStationMaxRange(),
      // terron: авиация — аэропорты тоже цепляем к ж/д кластеру фабрики. Спека: airport.md
      [UnitType.City, UnitType.Port, UnitType.Factory, UnitType.Airport],
    );

    this.game.addExecution(new TrainStationExecution(this.factory, true));
    const owner = this.factory.owner();
    for (const { unit } of structures) {
      // terron: цепляем к своей ж/д только СВОИ структуры (nearbyUnits отдаёт всех
      // владельцев → фабрика раздавала станции чужим). Спека: airport.md
      if (unit.owner() === owner && !unit.hasTrainStation()) {
        this.game.addExecution(new TrainStationExecution(unit));
      }
    }
  }
}

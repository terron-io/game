import {
  TERRON_TRAIN_CARS_VISUAL_MAX,
  TERRON_TRAIN_FIRST_TRY_TICKS,
  TERRON_TRAIN_MAX_ROUTE_TILES,
  TERRON_TRAIN_MAX_STOPS,
  TERRON_TRAINS_SPEED_MULT,
} from "../configuration/TerronTuning";
import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TrainStation } from "../game/TrainStation";
import { buildTrainTour } from "../game/TrainTour";
import { PseudoRandom } from "../PseudoRandom";
import { TrainExecution } from "./TrainExecution";

export class TrainStationExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  private random: PseudoRandom;
  private station: TrainStation | null = null;
  /**
   * terron 26.09: новая фабрика пускает первый поезд сразу, не дожидаясь своей
   * фазы расписания (до 30 с), — игрок видит, что она работает. Счётчик — сколько
   * тиков ещё пробуем (рельсы прорастают не мгновенно).
   */
  private firstTrainTries = 0;
  constructor(
    private unit: Unit,
    private spawnTrains?: boolean, // If set, the station will spawn trains
  ) {
    this.unit.setTrainStation(true);
  }

  isActive(): boolean {
    return this.active;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.spawnTrains) {
      this.random = new PseudoRandom(mg.ticks());
      this.firstTrainTries = TERRON_TRAIN_FIRST_TRY_TICKS;
    }
  }

  tick(ticks: number): void {
    if (this.mg === undefined) {
      throw new Error("Not initialized");
    }
    if (!this.isActive() || this.unit === undefined) {
      return;
    }
    if (this.station === null) {
      // Can't create new executions on init, so it has to be done in the tick
      this.station = new TrainStation(this.mg, this.unit);
      this.mg.railNetwork().connectStation(this.station);
    }
    if (!this.station.isActive()) {
      this.active = false;
      return;
    }
    if (this.spawnTrains) {
      this.spawnTrain(this.station, ticks);
    }
  }

  /**
   * terron 24.09: ПОЕЗД ПО РАСПИСАНИЮ (TerronTuning §ФАБРИКИ И ПОЕЗДА). Раньше —
   * кубик 1/((N+10)·15) за тик на уровень с общим на все фабрики игрока N (сумма
   * уровней): паузы до минуты, а уровни и новые фабрики почти не прибавляли.
   * Теперь каждая фабрика выпускает состав раз в `trainIntervalTicks()` со своей
   * фазой (от id юнита — все фабрики не выходят в один тик). Депо смерти («это
   * фабрика ×5», TRAINS.md) — у владельца поезда вдвое чаще.
   */
  private dueThisTick(ticks: number): boolean {
    let interval = this.mg.config().trainIntervalTicks();
    if (this.unit.owner().hasUltimate(UnitType.TrainDepot)) {
      interval = Math.max(1, Math.round(interval / TERRON_TRAINS_SPEED_MULT));
    }
    return (ticks + this.unit.id()) % interval === 0;
  }

  private spawnTrain(station: TrainStation, currentTick: number) {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (!this.spawnTrains) return;
    if (this.random === undefined) throw new Error("Not initialized");
    const first = this.firstTrainTries > 0;
    if (first) this.firstTrainTries--;
    if (!first && !this.dueThisTick(currentTick)) return;
    if (station.getCluster() === null) return;
    const owner = this.unit.owner();

    // Маршрут — обход сети через все доступные точки (TrainTour).
    const route = buildTrainTour(station, owner, this.random, {
      maxStops: TERRON_TRAIN_MAX_STOPS,
      maxTiles: TERRON_TRAIN_MAX_ROUTE_TILES,
    });
    if (route.length < 2) return;
    this.firstTrainTries = 0;

    // Уровень фабрики = длиннее поезд: платят все вагоны, рисуем не больше
    // TERRON_TRAIN_CARS_VISUAL_MAX (каждый вагон — юнит).
    const payCars = this.mg.config().trainCars(this.unit.level());
    this.mg.addExecution(
      new TrainExecution(
        this.mg.railNetwork(),
        owner,
        station,
        route[route.length - 1],
        Math.min(payCars, TERRON_TRAIN_CARS_VISUAL_MAX),
        route,
        payCars,
      ),
    );
    // terron 24.08: ключ Доры — «отправь 1000 поездов» (stats.trainsSent).
    this.mg.stats().trainSent(owner);
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

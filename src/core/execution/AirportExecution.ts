// terron: авиация — поведение аэропорта (аналог PortExecution). Периодически отправляет
// самолёт-транзит в ДРУГОЙ свой аэропорт (проверка экономики). Транзит на чужие аэропорты +
// комиссия за пролёт + ПВО — следующие фазы. Спека: airport.md
import { Execution, Game, Unit, UnitType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { AirplaneExecution } from "./AirplaneExecution";
import { TrainStationExecution } from "./TrainStationExecution";

// Вероятность отправки = 1/DISPATCH_ONE_IN за один 10-тиковый чек (при наличии назначений).
// 18 = ещё вдвое реже прежних 9 (по просьбе владельца — меньше бортов). Спека: airport.md
const DISPATCH_ONE_IN = 18;
// Случайная задержка вылета 2–7 сек (10 тиков/сек), чтобы борта не уходили синхронно.
const DISPATCH_DELAY_MIN_TICKS = 20;
const DISPATCH_DELAY_MAX_TICKS = 70;
// Доля рейсов на СВОИ аэропорты, когда доступны и свои, и чужие (иначе видно только
// торговлю с союзниками). 1/2 = ~50%. Спека: airport.md
const OWN_TRADE_ONE_IN = 2;

export class AirportExecution implements Execution {
  private active = true;
  private mg: Game;
  private random: PseudoRandom | null = null;
  private checkOffset: number | null = null;
  private stationChecked = false;

  constructor(private airport: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks() ^ this.airport.id());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (this.random === null || this.checkOffset === null) {
      throw new Error("Not initialized");
    }
    if (!this.airport.isActive()) {
      this.active = false;
      return;
    }
    if (this.airport.isUnderConstruction()) {
      return;
    }

    // terron: авиация — кулдаун запуска дрона (1:1 как MissileSiloExecution).
    // Каждый тик: если прошёл AirportDroneCooldown с момента самого раннего
    // запуска — освобождаем слот (reloadMissile → аэропорт снова готов). Спека:
    // airport.md. Проверяем ДО троттла — кулдаун точный, не раз в 10 тиков.
    const frontTime = this.airport.missileTimerQueue()[0];
    if (frontTime !== undefined) {
      const cooldown =
        this.mg.config().AirportDroneCooldown() - (this.mg.ticks() - frontTime);
      if (cooldown <= 0) {
        this.airport.reloadMissile();
      }
    }

    // terron: авиация — аэропорт цепляется к ж/д РОВНО как город: ОДНОразовая проверка своей
    // фабрики рядом при постройке (не каждый тик — иначе «сверх стандарта»). Если фабрику
    // построят позже — она сама выдаст станцию (аэропорт в списке FactoryExecution), как и
    // городу. Спека: airport.md
    if (!this.stationChecked) {
      this.stationChecked = true;
      if (!this.airport.hasTrainStation()) {
        this.maybeCreateStation();
      }
    }

    // Throttle: check every 10 ticks (staggered per airport).
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }
    if (!this.random.chance(DISPATCH_ONE_IN)) {
      return;
    }

    const { own, foreign } = this.tradeDestinations();
    if (own.length === 0 && foreign.length === 0) {
      return;
    }
    // Балансируем self↔foreign: если доступны оба — ~50% рейсов на свои аэропорты.
    const pool =
      own.length > 0 &&
      (foreign.length === 0 || this.random.chance(OWN_TRADE_ONE_IN))
        ? own
        : foreign;
    const dst = this.random.randElement(pool);
    const delay = this.random.nextInt(
      DISPATCH_DELAY_MIN_TICKS,
      DISPATCH_DELAY_MAX_TICKS + 1,
    );
    this.mg.addExecution(
      new AirplaneExecution(this.airport.owner(), this.airport, dst, delay),
    );
  }

  // terron: аэропорт получает ж/д станцию только при наличии СВОЕЙ фабрики рядом (как порт/город).
  // playerId обязателен — иначе матчилась любая (в т.ч. вражеская) фабрика. Спека: airport.md
  private maybeCreateStation(): void {
    const nearbyFactory = this.mg.hasUnitNearby(
      this.airport.tile()!,
      this.mg.config().trainStationMaxRange(),
      UnitType.Factory,
      this.airport.owner().id(),
    );
    if (nearbyFactory) {
      this.mg.addExecution(new TrainStationExecution(this.airport));
    }
  }

  // terron: пункты назначения бортов = СВОИ аэропорты (self-трейд) + аэропорты соседей,
  // с кем можно торговать (foreign-трейд, как порт↔порт — золото обеим сторонам). Спека: airport.md
  private tradeDestinations(): { own: Unit[]; foreign: Unit[] } {
    const owner = this.airport.owner();
    const valid = (a: Unit) =>
      a !== this.airport &&
      a.isActive() &&
      !a.isUnderConstruction() &&
      !a.isMarkedForDeletion();

    const own = owner.units(UnitType.Airport).filter(valid);
    const foreign = this.mg
      .players()
      .filter((p) => p !== owner && p.canTrade(owner))
      .flatMap((p) => p.units(UnitType.Airport))
      .filter(valid);

    return { own, foreign };
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

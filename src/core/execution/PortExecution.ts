import { TERRON_OILRIG_TRADE_WEIGHT } from "../configuration/TerronTuning";
import { Execution, Game, TradeHubs, Unit, UnitType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { TradeShipExecution } from "./TradeShipExecution";
import { TrainStationExecution } from "./TrainStationExecution";

// terron: self-трейд портов — пол дохода, когда торговать не с кем (острова / 1×1 с
// мёртвыми портами врага). Аналог self-трейда аэропортов. Спека CAPITALS.md.
// Шанс отправить трейд-шип К СЕБЕ, когда доступны И чужие порты (1/N). 10 = ~10%
// (foreign — «настоящая» экономика, доминирует; self — флейвор). Нет чужих → 100% self.
const PORT_SELF_TRADE_ONE_IN = 10;
// Кулдаун per-порт на self-трейд (АНТИ-РОЙ): без него кластер своих портов гонял бы
// рой кораблей друг к другу. 150 тиков = 15с (10 тиков/с). Держим как пол, не принтер.
const PORT_SELF_TRADE_COOLDOWN_TICKS = 150;

export class PortExecution implements Execution {
  private active = true;
  private mg: Game;
  private port: Unit;
  private random: PseudoRandom;
  private checkOffset: number;
  private tradeShipSpawnRejections = 0;
  // terron: тик последнего self-трейда (для кулдауна). Далёкое прошлое → первый готов.
  private lastSelfTradeTick = -PORT_SELF_TRADE_COOLDOWN_TICKS;

  constructor(port: Unit) {
    this.port = port;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.random === null || this.checkOffset === null) {
      throw new Error("Not initialized");
    }

    if (!this.port.isActive()) {
      this.active = false;
      return;
    }

    if (this.port.isUnderConstruction()) {
      return;
    }

    // terron: НЕФТЯНАЯ ВЫШКА стоит в океане — рельсы к ней не тянутся.
    // То же и для МОРСКОЙ площадки Космодрома: гейт по ВОДЕ, а не по типу,
    // иначе каждый новый «морской» узел пришлось бы вписывать сюда руками.
    if (
      this.port.type() !== UnitType.OilRig &&
      !this.mg.isOcean(this.port.tile()) &&
      !this.port.hasTrainStation()
    ) {
      this.createStation();
    }

    // Only check every 10 ticks for performance.
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    // terron 07.08 (решение владельца): НЕФТЯНАЯ ВЫШКА СВОИ рейсы НЕ отправляет —
    // она только ПРИНИМАЕТ. Компенсировано множителями выплаты и веса выбора.
    if (this.port.type() === UnitType.OilRig) {
      return;
    }

    if (!this.shouldSpawnTradeShip()) {
      return;
    }

    const target = this.pickTradeTarget();
    if (target === undefined) {
      return;
    }

    const isSelf = target.owner() === this.port.owner();
    if (isSelf) {
      this.lastSelfTradeTick = this.mg.ticks();
    }
    this.mg.addExecution(
      new TradeShipExecution(this.port.owner(), this.port, target, isSelf),
    );
  }

  // terron: выбор цели трейд-шипа. foreign = чужие порты (как раньше); own = self-трейд
  // «дальних точек». Есть чужие → PORT_SELF_TRADE_ONE_IN шанс на self (иначе foreign);
  // нет чужих → 100% self (нужно ≥2 своих порта). Self под кулдауном (анти-рой). Цель
  // self = самый ДАЛЬНИЙ свой порт (макс золото по сигмоиде tradeShipGold). Спека CAPITALS.md.
  private pickTradeTarget(): Unit | undefined {
    const foreign = this.tradingPorts();
    const selfReady =
      this.mg.ticks() - this.lastSelfTradeTick >=
      PORT_SELF_TRADE_COOLDOWN_TICKS;
    const own = selfReady ? this.ownTradePorts() : [];

    if (foreign.length > 0) {
      if (own.length > 0 && this.random.chance(PORT_SELF_TRADE_ONE_IN)) {
        return this.farthestPort(own);
      }
      return this.random.randElement(foreign);
    }
    if (own.length > 0) {
      return this.farthestPort(own);
    }
    return undefined;
  }

  // terron: свои порты на том же водном компоненте (кроме себя) — цели self-трейда.
  private ownTradePorts(): Unit[] {
    const components = this.sourceWaterComponents();
    if (components.size === 0) return [];
    return this.port
      .owner()
      .units(...TradeHubs.types) // terron: порт + нефтяная вышка
      .filter(
        (p) =>
          p !== this.port &&
          p.isActive() &&
          !p.isUnderConstruction() &&
          !p.isMarkedForDeletion() &&
          this.sharesWaterComponent(p, components),
      );
  }

  // terron: самый дальний порт из списка (макс. выплата — tradeShipGold растёт с dist).
  private farthestPort(ports: Unit[]): Unit {
    let best = ports[0];
    let bestDist = this.mg.manhattanDist(this.port.tile(), best.tile());
    for (let i = 1; i < ports.length; i++) {
      const d = this.mg.manhattanDist(this.port.tile(), ports[i].tile());
      if (d > bestDist) {
        best = ports[i];
        bestDist = d;
      }
    }
    return best;
  }

  // terron: водные компоненты, к которым примыкает ЭТОТ порт (общий хелпер для
  // tradingPorts и ownTradePorts — «достижимо ли по воде»).
  private sourceWaterComponents(): Set<number> {
    const comps = new Set<number>();
    for (const neighbor of this.mg.neighbors(this.port.tile())) {
      if (!this.mg.isWater(neighbor)) continue;
      const comp = this.mg.getWaterComponent(neighbor);
      if (comp !== null) comps.add(comp);
    }
    return comps;
  }

  private sharesWaterComponent(port: Unit, components: Set<number>): boolean {
    for (const comp of components) {
      if (this.mg.hasWaterComponent(port.tile(), comp)) return true;
    }
    return false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  shouldSpawnTradeShip(): boolean {
    const numTradeShips = this.mg.unitCount(UnitType.TradeShip);
    const spawnRate = this.mg
      .config()
      .tradeShipSpawnRate(this.tradeShipSpawnRejections, numTradeShips);
    for (let i = 0; i < this.port!.level(); i++) {
      if (this.random.chance(spawnRate)) {
        this.tradeShipSpawnRejections = 0;
        return true;
      }
      this.tradeShipSpawnRejections++;
    }
    return false;
  }

  createStation(): void {
    // terron: только СВОЯ фабрика даёт станцию (без playerId матчилась любая, в т.ч.
    // вражеская → порт/город вязались рельсами «без фабрики»). Спека: airport.md
    const nearbyFactory = this.mg.hasUnitNearby(
      this.port.tile()!,
      this.mg.config().trainStationMaxRange(),
      UnitType.Factory,
      this.port.owner().id(),
    );
    if (nearbyFactory) {
      this.mg.addExecution(new TrainStationExecution(this.port));
    }
  }

  // It's a probability list, so if an element appears twice it's because it's
  // twice more likely to be picked later.
  tradingPorts(): Unit[] {
    const sourceComponents = this.sourceWaterComponents();
    const ports = this.mg
      .players()
      .filter((p) => p !== this.port!.owner() && p.canTrade(this.port!.owner()))
      .flatMap((p) => p.units(...TradeHubs.types)) // terron: порт + вышка
      .filter((p) => this.sharesWaterComponent(p, sourceComponents))
      .sort((p1, p2) => {
        return (
          this.mg.manhattanDist(this.port!.tile(), p1.tile()) -
          this.mg.manhattanDist(this.port!.tile(), p2.tile())
        );
      });

    const weightedPorts: Unit[] = [];

    for (const [i, otherPort] of ports.entries()) {
      // terron: НЕФТЯНАЯ ВЫШКА — «десятый порт»: кладём её в список выбора
      // TERRON_OILRIG_TRADE_WEIGHT раз, значит лодки идут к ней в ×10 чаще.
      // Список с повторами — штатный механизм апстрима (уровень порта, близость,
      // дружественность добавляют копии). TerronTuning §ВЫШКА.
      const copies =
        otherPort.type() === UnitType.OilRig
          ? TERRON_OILRIG_TRADE_WEIGHT
          : otherPort.level();
      const expanded = new Array(copies).fill(otherPort);
      weightedPorts.push(...expanded);
      const tooClose =
        this.mg.manhattanDist(this.port!.tile(), otherPort.tile()) <
        this.mg.config().tradeShipShortRangeDebuff();
      const closeBonus =
        i < this.mg.config().proximityBonusPortsNb(ports.length);
      if (!tooClose && closeBonus) {
        // If the port is close, but not too close, add it again
        // to increase the chances of trading with it.
        weightedPorts.push(...expanded);
      }
      if (!tooClose && this.port!.owner().isFriendly(otherPort.owner())) {
        weightedPorts.push(...expanded);
      }
    }
    return weightedPorts;
  }
}

import {
  TERRON_OILRIG_HEAL_MULT,
  TERRON_PIRACY_SPEED_MULT,
} from "../configuration/TerronTuning";
import { fuelSpeedMult } from "../game/FuelSpeed";
import {
  actingAs,
  Execution,
  Game,
  isUnit,
  OwnerComp,
  TradeHubs,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { findMinimumBy } from "../Util";
import { ShellExecution } from "./ShellExecution";

export class WarshipExecution implements Execution {
  /** Счётчик для рассинхронизации пересборок пафайндера (см. конструктор). */
  private static _staggerCounter = 0;
  private random: PseudoRandom;
  private warship: Unit;
  private mg: Game;
  private pathfinder: WaterPathFinder;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();
  private lastManualMoveTickRetreatDisabled = 0;
  private lastObservedPatrolTile: TileRef | undefined;
  private activeHealingRemainder = 0;
  private lastEmittedCombat = false;

  constructor(
    private input: (UnitParams<UnitType.Warship> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    // terron: ПИРАТСТВО — владелец нужен поиску пути (обход чужих зон блокады);
    // юнит может ещё не существовать (спавн ниже) — берём из входа.
    const owner = isUnit(this.input) ? this.input.owner() : this.input.owner;
    // ⚠️ terron 23.08: РАССИНХРОНИЗАЦИЯ ПЕРЕСБОРОК. Здесь стоял ноль — то
    // есть КАЖДЫЙ корабль пересобирал свой пафайндер в ОДИН И ТОТ ЖЕ тик,
    // когда менялся водный граф или набор зон блокады, и все они запускали
    // полный A* одновременно («сим падает до 0»). Торговля и десант давно
    // разъезжаются счётчиком — теперь и боевые корабли тоже.
    const stagger =
      WarshipExecution._staggerCounter++ % WaterPathFinder.STAGGER_SPREAD;
    this.pathfinder = new WaterPathFinder(mg, stagger, owner);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.warship = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Warship,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn warship for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.warship = this.input.owner.buildUnit(
        UnitType.Warship,
        spawn,
        this.input,
      );
    }
    this.lastObservedPatrolTile = this.warship.warshipState().patrolTile;
  }

  tick(ticks: number): void {
    // terron: ПИРАТСТВО — пиратская лодка делает TERRON_PIRACY_SPEED_MULT шагов за
    // тик (×2 скорость). Стрельба не ускоряется: shootTarget гейтится по
    // mg.ticks(), второй шаг того же тика снаряд не добавит. TZ-ult-unlocks.md
    // terron: ТОПЛИВО ускоряет корабли тем же механизмом. Берём БОЛЬШЕЕ из
    // двух, а не произведение: ×2 пирата и ×2 топлива не должны давать ×4
    // (ульта у игрока одна, но пассив может достаться от ЗАХВАЧЕННОГО штаба).
    const steps = Math.max(
      this.warship.owner().hasUltimate(UnitType.Piracy)
        ? TERRON_PIRACY_SPEED_MULT
        : 1,
      fuelSpeedMult(this.warship.owner()),
    );
    for (let i = 0; i < steps; i++) {
      this.step(ticks, i > 0);
      if (!this.warship.isActive()) return;
    }
  }

  private step(ticks: number, extraStep = false): void {
    if (this.warship.health() <= 0) {
      this.warship.delete();
      return;
    }
    // terron: ПИРАТСТВО — лодка идёт топиться в точку блокады: ею рулит
    // BlockadeExecution, патруль и стрельба на это время выключены.
    //
    // ⚠️ У миссии ЕСТЬ ТАЙМАУТ (TERRON_BLOCKADE_SAIL_TIMEOUT_TICKS). Без него
    // повисший флаг превращал лодку в навсегда застрявшую: она молча
    // пропускала свой шаг у собственного порта и никогда больше не оживала.
    if (this.warship.blockadeMission() !== null) return;
    const isInCombat = this.warship.warshipState().isInCombat ?? false;
    if (this.lastEmittedCombat && !isInCombat) {
      this.warship.touch();
    }
    this.lastEmittedCombat = isInCombat;
    const healthBeforeHealing = this.warship.health();

    // Второй шаг пирата — только движение: лечение не удваиваем.
    if (!extraStep) this.healWarship();
    this.handleManualPatrolOverride();

    if (this.warship.warshipState().state === "docked") {
      if (this.currentRetreatPort() === undefined) {
        this.cancelRepairRetreat();
      }
      if (this.isFullyHealed()) {
        this.cancelRepairRetreat();
      }
      if (this.warship.warshipState().state === "docked") {
        return;
      }
    }

    if (this.handleRepairRetreat()) {
      return;
    }

    // Priority 1: Check if need to heal before doing anything else
    if (this.shouldStartRepairRetreat(healthBeforeHealing)) {
      this.startRepairRetreat();
      if (this.handleRepairRetreat()) {
        return;
      }
    }

    this.warship.setTargetUnit(this.findTargetUnit());

    // Priority 1: Shoot transport ship if in range
    if (this.warship.targetUnit()?.type() === UnitType.TransportShip) {
      this.shootTarget();
      this.patrol();
      return;
    }

    // Priority 2: Fight enemy warship if in range
    if (this.warship.targetUnit()?.type() === UnitType.Warship) {
      this.shootTarget();
      this.patrol();
      return;
    }

    // Priority 3: Hunt trade ship only if not healing and no enemy warship
    if (this.warship.targetUnit()?.type() === UnitType.TradeShip) {
      this.huntDownTradeShip();
      return;
    }

    this.patrol();
  }

  private healWarship(): void {
    const owner = this.warship.owner();
    const passiveHealing = this.mg.config().warshipPassiveHealing();
    const passiveHealingRange = this.mg.config().warshipPassiveHealingRange();
    const passiveHealingRangeSquared =
      passiveHealingRange * passiveHealingRange;
    const warshipTile = this.warship.tile();

    // terron: НЕФТЯНАЯ ВЫШКА чинит корабли, и в TERRON_OILRIG_HEAL_MULT раз
    // быстрее порта (решение владельца). Берём ЛУЧШИЙ множитель среди узлов в
    // радиусе: рядом и порт, и вышка → лечит вышка. TerronTuning §ВЫШКА.
    let healMult = 0;
    for (const hub of owner.units(...TradeHubs.types)) {
      const distSquared = this.mg.euclideanDistSquared(warshipTile, hub.tile());
      if (distSquared > passiveHealingRangeSquared) continue;
      const mult = hub.type() === UnitType.OilRig ? TERRON_OILRIG_HEAL_MULT : 1;
      if (mult > healMult) healMult = mult;
      if (healMult === TERRON_OILRIG_HEAL_MULT) break; // лучше уже не будет
    }

    if (healMult > 0) {
      this.warship.modifyHealth(passiveHealing * healMult);
    }

    if (this.warship.warshipState().state === "docked") {
      this.applyActiveDockedHealing();
    }
  }

  private isFullyHealed(): boolean {
    // terron: ПИРАТСТВО — у пиратской лодки свой потолок (Unit.maxHealth()).
    const maxHealth = this.warship.maxHealth();
    if (typeof maxHealth !== "number") {
      return true;
    }
    return this.warship.health() >= maxHealth;
  }

  private shouldStartRepairRetreat(
    healthBeforeHealing = this.warship.health(),
  ): boolean {
    if (this.warship.warshipState().state !== "patrolling") {
      return false;
    }
    const manualMoveRetreatDisabledDuration = 50;
    if (
      this.mg.ticks() - this.lastManualMoveTickRetreatDisabled <
      manualMoveRetreatDisabledDuration
    ) {
      return false;
    }
    // ⚠️ terron 23.08 — ПОРОГ РЕМОНТА ОТНОСИТЕЛЬНЫЙ, А НЕ АБСОЛЮТНЫЙ.
    //
    // В конфиге он задан числом (750) при базовой прочности корабля 1000 — то
    // есть «уходи чиниться ниже 75 %». У ПИРАТСКОЙ ЛОДКИ потолок 200, и
    // абсолютные 750 она не наберёт НИКОГДА: свежая лодка считала себя
    // подбитой, шла в порт, там объявлялась «полностью починенной», выходила —
    // и тут же снова шла чиниться. Снаружи: «корабль в принципе не в
    // состоянии покинуть порт» (репорт владельца; обычные корабли при этом
    // работали — у них потолок как раз 1000).
    if (healthBeforeHealing >= this.retreatThreshold()) {
      return false;
    }
    const ports = this.warship.owner().units(...actingAs(UnitType.Port)); // terron: штаб Пиратства тоже порт
    return ports.length > 0;
  }

  /**
   * Порог «пора чиниться» в единицах прочности ЭТОГО корабля: доля от его
   * собственного потолка, а не число из конфига.
   */
  private retreatThreshold(): number {
    const cfg = this.mg.config();
    const cap = this.warship.maxHealth();
    const absolute = cfg.warshipRetreatHealthThreshold();
    if (typeof cap !== "number" || cap <= 0) return absolute;
    // Доля выводится из базового корабля (1000 прочности в конфиге), поэтому
    // правка баланса ядра автоматически едет и на пиратскую лодку.
    const base = Number(cfg.unitInfo(UnitType.Warship).maxHealth ?? cap);
    const ratio = base > 0 ? absolute / base : 0.75;
    return cap * ratio;
  }

  private findNearestPort(): TileRef | undefined {
    const ports = this.warship.owner().units(...actingAs(UnitType.Port)); // terron: штаб Пиратства тоже порт
    if (ports.length === 0) {
      return undefined;
    }

    const warshipTile = this.warship.tile();
    const warshipComponent = this.mg.getWaterComponent(warshipTile);
    if (warshipComponent === null) {
      throw new Error(`Warship at tile ${warshipTile} has no water component`);
    }

    const nearest = findMinimumBy(
      ports,
      (port) => this.mg.euclideanDistSquared(warshipTile, port.tile()),
      (port) => {
        const portComponent = this.mg.getWaterComponent(port.tile());
        if (portComponent === null) {
          throw new Error(`Port at tile ${port.tile()} has no water component`);
        }
        return portComponent === warshipComponent;
      },
    );

    return nearest?.tile();
  }

  private findRetreatAggroTarget(): Unit | undefined {
    return this.findBestTarget([UnitType.TransportShip, UnitType.Warship]);
  }

  private findTargetUnit(): Unit | undefined {
    // ⚠️ terron 23.08: ЗДЕСЬ БЫЛА ПИРАТСКАЯ СПЕЦЛОГИКА — свой радиус рейда,
    // свой список типов, «держись цели». Всё удалено по решению владельца:
    // «пиратская лодка — обычный боевой корабль, просто дешевле, быстрее и
    // урон ниже». Каждая такая надстройка добавляла своё состояние и свои
    // способы застрять; поведение корабля должно быть ОДНО на всех.
    return this.findBestTarget(
      [UnitType.TransportShip, UnitType.Warship, UnitType.TradeShip],
      true,
    );
  }

  /**
   * Shared target selection: searches nearby units of given types,
   * filters common exclusions (self, friendly, docked, already-shelled),
   * picks best by type priority (lower index = higher priority) then distance.
   *
   * When `includeTradeShips` is true, applies trade-ship-specific filters
   * (safe from pirates, patrol range, water component, allied destination).
   */
  private findBestTarget(
    types: UnitType[],
    includeTradeShips = false,
  ): Unit | undefined {
    const mg = this.mg;
    const config = mg.config();
    const owner = this.warship.owner();

    const ships = mg.nearbyUnits(
      this.warship.tile(),
      config.warshipTargettingRange(),
      types,
    );

    // Trade-ship-specific state, lazily computed.
    let hasPort: boolean | undefined;
    let patrolTile: number | undefined;
    let patrolRangeSquared: number | undefined;
    let warshipComponent: number | null | undefined = undefined;

    let bestUnit: Unit | undefined = undefined;
    let bestTypePriority = 0;
    let bestDistSquared = 0;

    for (const { unit, distSquared } of ships) {
      if (
        unit === this.warship ||
        unit.owner() === owner ||
        // terron: ПОДЛОДКИ — не стрелявшую подлодку врага не видно и не взять в
        // цель (это НАСТОЯЩЕЕ правило симуляции, одинаковое у всех клиентов).
        unit.isStealthed() ||
        !owner.canAttackPlayer(unit.owner(), true) ||
        this.alreadySentShell.has(unit) ||
        (unit.type() === UnitType.Warship &&
          unit.warshipState().state === "docked")
      ) {
        continue;
      }

      const type = unit.type();

      if (includeTradeShips && type === UnitType.TradeShip) {
        if (hasPort === undefined) {
          // ⚠️ terron 23.08 (репорт владельца «пиратские корабли прижались к
          // порту и не пиратят»): здесь стоял голый UnitType.Port — и пират,
          // у которого есть только ШТАБ ПИРАТСТВА (а он и есть порт), НИ РАЗУ
          // не брал торговую лодку в цель. Ульта, объявившая себя портом,
          // считается портом — actingAs() из реестра.
          hasPort = owner.units(...actingAs(UnitType.Port)).length > 0;
          patrolTile = this.warship.warshipState().patrolTile;
          patrolRangeSquared = config.warshipPatrolRange() ** 2;
        }
        if (
          !hasPort ||
          patrolTile === undefined ||
          unit.isSafeFromPirates() ||
          unit.targetUnit()?.owner() === owner ||
          unit.targetUnit()?.owner().isFriendly(owner) ||
          // terron: ультимейты — Центробанк: лодки владельца неперехватываемы.
          // 24.08 (решение владельца при включении Топлива на проде): у
          // Топлива этот эффект УБРАН — осталась только скорость. FUEL.md
          unit.owner().hasUltimate(UnitType.CentralBank)
        ) {
          continue;
        }
        if (warshipComponent === undefined) {
          warshipComponent = mg.getWaterComponent(this.warship.tile());
        }
        if (
          warshipComponent !== null &&
          !mg.hasWaterComponent(unit.tile(), warshipComponent)
        ) {
          continue;
        }
        if (
          mg.euclideanDistSquared(patrolTile, unit.tile()) > patrolRangeSquared!
        ) {
          continue;
        }
      }

      const typePriority =
        type === UnitType.TransportShip ? 0 : type === UnitType.Warship ? 1 : 2;

      if (
        bestUnit === undefined ||
        typePriority < bestTypePriority ||
        (typePriority === bestTypePriority && distSquared < bestDistSquared)
      ) {
        bestUnit = unit;
        bestTypePriority = typePriority;
        bestDistSquared = distSquared;
      }
    }

    return bestUnit;
  }

  private startRepairRetreat(): void {
    const portTile = this.findNearestPort();
    if (portTile === undefined) {
      return;
    }
    this.warship.updateWarshipState({
      retreatPort: portTile,
      state: "retreating",
    });
    this.activeHealingRemainder = 0;
    this.warship.setTargetUnit(undefined);
  }

  private cancelRepairRetreat(clearTargetTile = true): void {
    this.activeHealingRemainder = 0;
    this.warship.updateWarshipState({
      state: "patrolling",
      retreatPort: undefined,
    });
    if (clearTargetTile) {
      this.warship.setTargetTile(undefined);
    }
  }

  private handleManualPatrolOverride(): void {
    const patrolTile = this.warship.warshipState().patrolTile;
    if (
      this.lastObservedPatrolTile !== undefined &&
      patrolTile !== this.lastObservedPatrolTile
    ) {
      this.lastManualMoveTickRetreatDisabled = this.mg.ticks();
      if (this.warship.warshipState().state !== "patrolling") {
        this.cancelRepairRetreat(false);
      }
    }
    this.lastObservedPatrolTile = patrolTile;
  }

  private handleRepairRetreat(): boolean {
    if (this.warship.warshipState().state === "patrolling") {
      return false;
    }

    const retreatAggroTarget = this.findRetreatAggroTarget();
    if (retreatAggroTarget) {
      this.warship.setTargetUnit(retreatAggroTarget);
      this.shootTarget();
      // Fall through — continue retreating toward port even while firing back.
    }

    if (!this.refreshRetreatPortTile()) {
      this.cancelRepairRetreat();
      return false;
    }

    // Only clear the target when there's no active aggro target this tick.
    if (!retreatAggroTarget) {
      this.warship.setTargetUnit(undefined);
    }

    const retreatPortTile = this.warship.warshipState().retreatPort;
    if (retreatPortTile === undefined) {
      return false;
    }

    const dockingRadius = this.mg.config().warshipDockingRange();
    const dockingRadiusSq = dockingRadius * dockingRadius;
    const distToPort = this.mg.euclideanDistSquared(
      this.warship.tile(),
      retreatPortTile,
    );

    if (distToPort <= dockingRadiusSq) {
      // Check if the port has capacity available (excluding this warship from capacity check)
      const port = this.warship
        .owner()
        .units(...actingAs(UnitType.Port))
        .find((p) => p.tile() === retreatPortTile);
      if (port && !this.isPortFullOfHealing(port, this.warship)) {
        // Port has capacity - dock here
        this.warship.setTargetTile(undefined);
        this.warship.updateWarshipState({
          state: "docked",
        });
        return true;
      } else {
        // Port is full - wait near port, but leave if already fully healed
        if (this.isFullyHealed()) {
          this.cancelRepairRetreat();
          return false;
        }
        return true;
      }
    }

    this.warship.setTargetTile(retreatPortTile);
    const result = this.pathfinder.next(this.warship.tile(), retreatPortTile);
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.warship.move(result.node);
        if (result.node === retreatPortTile) {
          this.warship.setTargetTile(undefined);
        }
        break;
      case PathStatus.NEXT:
        this.warship.move(result.node);
        break;
      case PathStatus.NOT_FOUND: {
        const newPort = this.findNearestAvailablePortTile();
        this.warship.updateWarshipState({
          retreatPort: newPort,
        });
        if (newPort === undefined) {
          this.cancelRepairRetreat();
        }
        break;
      }
    }

    return true;
  }

  private refreshRetreatPortTile(): boolean {
    const ports = this.warship.owner().units(...actingAs(UnitType.Port)); // terron: штаб Пиратства тоже порт
    if (ports.length === 0) {
      return false;
    }

    const currentRetreatPort = this.warship.warshipState().retreatPort;

    // Check if current retreat port still exists
    const currentPortExists =
      currentRetreatPort !== undefined &&
      ports.some((port) => port.tile() === currentRetreatPort);

    if (!currentPortExists) {
      const newPort = this.findNearestAvailablePortTile();
      this.warship.updateWarshipState({
        retreatPort: newPort,
      });
      return newPort !== undefined;
    }

    // Check if current port is now full of healing (not counting arrived warships)
    const currentPort = ports.find((p) => p.tile() === currentRetreatPort);
    if (currentPort && this.isPortFullOfHealing(currentPort)) {
      // Current port is at healing capacity, look for alternatives
      const alternativePort = this.findNearestAvailablePort();
      if (alternativePort) {
        this.warship.updateWarshipState({
          retreatPort: alternativePort,
        });
      }
      return this.warship.warshipState().retreatPort !== undefined;
    }

    // Check if a significantly closer port is available
    const closerPort = this.findBetterPortTile();
    if (closerPort && closerPort !== currentRetreatPort) {
      this.warship.updateWarshipState({
        retreatPort: closerPort,
      });
      return true;
    }

    return true;
  }

  private isPortFullOfHealing(port: Unit, excludeShip?: Unit): boolean {
    const maxShipsHealing = port.level();
    return this.dockedShipsAtPort(port, excludeShip).length >= maxShipsHealing;
  }

  private dockedShipsAtPort(port: Unit, excludeShip?: Unit): Unit[] {
    const dockingRadius = this.mg.config().warshipDockingRange();
    const owner = this.warship.owner();

    return this.mg
      .nearbyUnits(port.tile(), dockingRadius, [UnitType.Warship])
      .filter(({ unit: ship }) => {
        if (excludeShip && ship === excludeShip) return false;
        if (ship.owner() !== owner) return false;
        if (ship.warshipState().state === "patrolling") return false;
        if (ship.targetTile() !== undefined) return false;
        return true;
      })
      .map(({ unit }) => unit);
  }

  private applyActiveDockedHealing(): void {
    const dockedPort = this.currentRetreatPort();
    if (!dockedPort) {
      return;
    }

    const dockedShips = this.dockedShipsAtPort(dockedPort);
    if (!dockedShips.some((ship) => ship === this.warship)) {
      return;
    }

    const healingPool =
      dockedPort.level() * this.mg.config().warshipPortHealingBonusPerLevel();
    if (healingPool <= 0 || dockedShips.length === 0) {
      return;
    }

    // Preserve fractional split healing over time with a per-ship remainder.
    const activeHealing = healingPool / dockedShips.length;
    this.activeHealingRemainder += activeHealing;
    const integerHealing = Math.floor(this.activeHealingRemainder);
    if (integerHealing <= 0) {
      return;
    }

    this.activeHealingRemainder -= integerHealing;
    this.warship.modifyHealth(integerHealing);
  }

  private currentRetreatPort(): Unit | undefined {
    const retreatPort = this.warship.warshipState().retreatPort;
    if (retreatPort === undefined) {
      return undefined;
    }

    return this.warship
      .owner()
      .units(...actingAs(UnitType.Port))
      .find((port) => port.tile() === retreatPort);
  }

  private nearestAvailablePortTile(
    excludeShip?: Unit,
  ): { tile: TileRef; distSquared: number } | undefined {
    const ports = this.warship.owner().units(...actingAs(UnitType.Port)); // terron: штаб Пиратства тоже порт
    const warshipTile = this.warship.tile();
    const warshipComponent = this.mg.getWaterComponent(warshipTile);
    if (warshipComponent === null) {
      throw new Error(`Warship at tile ${warshipTile} has no water component`);
    }

    let bestTile: TileRef | undefined = undefined;
    let bestDistance = Infinity;

    for (const port of ports) {
      if (this.isPortFullOfHealing(port, excludeShip)) {
        continue;
      }

      const portTile = port.tile();
      if (!this.mg.hasWaterComponent(portTile, warshipComponent)) {
        continue;
      }

      const distance = this.mg.euclideanDistSquared(warshipTile, portTile);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTile = portTile;
      }
    }

    return bestTile !== undefined
      ? { tile: bestTile, distSquared: bestDistance }
      : undefined;
  }

  private findNearestAvailablePort(): TileRef | undefined {
    return this.nearestAvailablePortTile()?.tile;
  }

  private findBetterPortTile(): TileRef | undefined {
    const result = this.nearestAvailablePortTile();
    if (!result) return undefined;

    let currentDistance = Infinity;
    const currentRetreatPort = this.warship.warshipState().retreatPort;
    if (currentRetreatPort !== undefined) {
      currentDistance = this.mg.euclideanDistSquared(
        this.warship.tile(),
        currentRetreatPort,
      );
    }

    if (
      result.distSquared <
      currentDistance * this.mg.config().warshipPortSwitchThreshold()
    ) {
      return result.tile;
    }
    return undefined;
  }

  private findNearestAvailablePortTile(): TileRef | undefined {
    return this.nearestAvailablePortTile(this.warship)?.tile;
  }

  private shootTarget() {
    this.warship.updateWarshipState({ isInCombat: true });
    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      if (this.warship.targetUnit()?.type() !== UnitType.TransportShip) {
        // Warships don't need to reload when attacking transport ships.
        this.lastShellAttack = this.mg.ticks();
      }
      // terron: ПОДЛОДКИ — первый же выстрел засвечивает подлодку НАВСЕГДА.
      this.warship.revealSub();
      this.mg.addExecution(
        new ShellExecution(
          this.warship.tile(),
          this.warship.owner(),
          this.warship,
          this.warship.targetUnit()!,
        ),
      );
      if (!this.warship.targetUnit()!.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.warship.targetUnit()!);
        this.warship.setTargetUnit(undefined);
        return;
      }
    }
  }

  private huntDownTradeShip() {
    // terron: ультимейты — Центробанк мог достроиться, пока гнались: цель
    // становится неперехватываемой, бросаем погоню. (24.08: у Топлива
    // неперехватываемость убрана — решение владельца.)
    const prey = this.warship.targetUnit();
    if (prey !== undefined && prey.owner().hasUltimate(UnitType.CentralBank)) {
      this.warship.setTargetUnit(undefined);
      this.warship.touch();
      return;
    }
    this.warship.updateWarshipState({ isInCombat: true });
    for (let i = 0; i < 2; i++) {
      const target = this.warship.targetUnit()!;
      const targetTile = target.tile();
      const dist = this.mg.manhattanDist(this.warship.tile(), targetTile);

      if (dist <= 5) {
        this.warship.owner().captureUnit(target);
        this.warship.setTargetUnit(undefined);
        this.warship.touch();
        return;
      }

      // When close, the minimap (2x scale) produces diagonal upscaled paths that
      // make it hard to converge. Use direct greedy movement instead.
      if (dist <= 20) {
        const nextTile = this.bestNeighborToward(targetTile);
        if (nextTile !== undefined) {
          this.warship.move(nextTile);
          continue;
        }
      }

      const result = this.pathfinder.next(this.warship.tile(), targetTile, 5);
      switch (result.status) {
        case PathStatus.COMPLETE:
          this.warship.owner().captureUnit(target);
          this.warship.setTargetUnit(undefined);
          this.warship.touch();
          return;
        case PathStatus.NEXT:
          this.warship.move(result.node);
          break;
        case PathStatus.NOT_FOUND:
          console.log(`path not found to target`);
          break;
      }
    }
  }

  private bestNeighborToward(targetTile: TileRef): TileRef | undefined {
    const warshipTile = this.warship.tile();
    let best: TileRef | undefined;
    let bestDist = this.mg.manhattanDist(warshipTile, targetTile);
    this.mg.forEachNeighbor(warshipTile, (neighbor) => {
      if (!this.mg.isWater(neighbor)) return;
      const d = this.mg.manhattanDist(neighbor, targetTile);
      if (d < bestDist) {
        bestDist = d;
        best = neighbor;
      }
    });
    return best;
  }

  private patrol() {
    if (this.warship.targetTile() === undefined) {
      this.warship.setTargetTile(this.randomTile());
      if (this.warship.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathfinder.next(
      this.warship.tile(),
      this.warship.targetTile()!,
    );
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.warship.setTargetTile(undefined);
        this.warship.move(result.node);
        break;
      case PathStatus.NEXT:
        this.warship.move(result.node);
        break;
      case PathStatus.NOT_FOUND: {
        console.log(`path not found to target`);
        this.warship.setTargetTile(undefined);
        break;
      }
    }
  }

  isActive(): boolean {
    return this.warship?.isActive();
  }

  isDocked(): boolean {
    return (this.warship?.warshipState().state ?? "patrolling") === "docked";
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(allowShoreline: boolean = false): TileRef | undefined {
    let warshipPatrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand: number = 500;
    let attempts: number = 0;
    let expandCount: number = 0;

    // Get warship's water component for connectivity check
    const warshipComponent = this.mg.getWaterComponent(this.warship.tile());

    const patrolTile = this.warship.warshipState().patrolTile;
    if (patrolTile === undefined) {
      return undefined;
    }

    while (expandCount < 3) {
      const x =
        this.mg.x(patrolTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      const y =
        this.mg.y(patrolTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (
        !this.mg.isWater(tile) ||
        (!allowShoreline && this.mg.isShoreline(tile))
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          warshipPatrolRange =
            warshipPatrolRange + Math.floor(warshipPatrolRange / 2);
        }
        continue;
      }
      // Check water component connectivity
      if (
        warshipComponent !== null &&
        !this.mg.hasWaterComponent(tile, warshipComponent)
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          warshipPatrolRange =
            warshipPatrolRange + Math.floor(warshipPatrolRange / 2);
        }
        continue;
      }
      return tile;
    }
    console.warn(
      `Failed to find random tile for warship for ${this.warship.owner().name()}`,
    );
    if (!allowShoreline) {
      // If we failed to find a tile on the ocean, try again but allow shoreline
      return this.randomTile(true);
    }
    return undefined;
  }
}

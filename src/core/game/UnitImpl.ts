import {
  TERRON_PIRACY_BOAT_HEALTH,
  TERRON_PIRACY_STEALTH_REVEAL_RADIUS,
} from "../configuration/TerronTuning";
import { TERRON_SUBMARINE_REVEAL_DELAY_TICKS } from "../configuration/TerronTuning";
import { simpleHash, toInt, withinInt } from "../Util";
import {
  AllUnitParams,
  MessageType,
  Player,
  Tick,
  TrainType,
  TrajectoryTile,
  TransportShipState,
  Ultimates,
  Unit,
  UnitInfo,
  UnitType,
  WarshipState,
} from "./Game";
import { GameImpl } from "./GameImpl";
import { TileRef } from "./GameMap";
import { GameUpdateType, UnitUpdate } from "./GameUpdates";
import { PlayerImpl } from "./PlayerImpl";

export class UnitImpl implements Unit {
  private _active = true;
  private _targetTile: TileRef | undefined;
  // terron: ЗЕЛЁНЫЕ — груз борта-инспекции (см. конструктор). GREEN.md
  private _culpritSmallID = 0;
  private _catastropheSteps = 0;
  private _targetUnit: Unit | undefined;
  private _health: bigint;
  private _lastTile: TileRef;
  private _transportShipState: TransportShipState | undefined = undefined;
  private _warshipState: WarshipState | undefined = undefined;
  private _targetedBySAM = false;
  private _reachedTarget = false;
  private _wasDestroyedByEnemy: boolean = false;
  private _destroyer: Player | undefined = undefined;
  private _lastSetSafeFromPirates: number; // Only for trade ships
  private _underConstruction: boolean = false;
  private _lastOwner: PlayerImpl | null = null;
  // terron: тик последнего ЗАХВАТА (смены владельца) — для самоуничтожения
  // захваченной чужой ульты. null = не захватывалось. new-units/ULTIMATES.md
  private _capturedTick: Tick | null = null;
  // terron: ДОРА — видовые поля (см. Unit.railReach/railEta).
  private _railReach: readonly TileRef[] = [];
  private _railEta = 0;
  // terron: ШАГАЮЩИЙ ГОРОД — остаток маршрута идущего здания (видовое).
  private _walkPath: readonly TileRef[] = [];
  private _troops: number;
  // Number of missiles in cooldown, if empty all missiles are ready.
  private _missileTimerQueue: number[] = [];
  private _hasTrainStation: boolean = false;
  private _level: number = 1;
  private _targetable: boolean = true;
  private _loaded: boolean | undefined;
  private _trainType: TrainType | undefined;
  // Nuke only
  private _trajectoryIndex: number = 0;
  private _trajectory: TrajectoryTile[];
  private _deletionAt: number | null = null;
  // terron: ультимейты — Мин правды: счётчики шпиля (ховер-тултип):
  // потери врагов (сырое) и реальный приход владельцу.
  private _stolenTroops: number = 0;
  private _gainedTroops: number = 0;
  // terron: СТОЛИЦЫ — этот City является столицей игрока (золотой тинт + доход).
  // Ставится один раз при постройке ПЕРВОГО города; снимается при захвате/сносе
  // (база — без переезда). Спека: CAPITALS.md
  private _isCapital: boolean = false;
  // terron: СТОЛИЦЫ — имя столицы (EN-канон, RU накладывается на клиенте). CAPITALS.md
  private _capitalName: string | undefined = undefined;
  // terron 05.08: какая по счёту столица игрока (1 — первая). Подпись второй и
  // дальше рисуется как «Новая Зарница» — см. CapitalNames.capitalLabel.
  private _capitalGeneration = 0;

  constructor(
    private _type: UnitType,
    private mg: GameImpl,
    private _tile: TileRef,
    private _id: number,
    public _owner: PlayerImpl,
    params: AllUnitParams = {},
  ) {
    this._lastTile = _tile;
    this._health = toInt(this.maxHealth() ?? 1);
    this._targetTile =
      "targetTile" in params ? (params.targetTile ?? undefined) : undefined;
    this._trajectory = "trajectory" in params ? (params.trajectory ?? []) : [];
    this._troops = "troops" in params ? (params.troops ?? 0) : 0;
    this._lastSetSafeFromPirates =
      "lastSetSafeFromPirates" in params
        ? (params.lastSetSafeFromPirates ?? 0)
        : 0;
    // terron: ЗЕЛЁНЫЕ — гражданский борт везёт, КОГО штрафовать и на сколько
    // ступеней. Держим на юните, а не в экзекуции: по этим полям игра считает,
    // сколько бортов уже летит к данному виновнику (не больше трёх). GREEN.md
    this._culpritSmallID =
      "culpritSmallID" in params ? (params.culpritSmallID ?? 0) : 0;
    this._catastropheSteps = "steps" in params ? (params.steps ?? 0) : 0;
    if (this._type === UnitType.TransportShip) {
      this._transportShipState = { isRetreating: false, troops: 0 };
    }
    if ("patrolTile" in params) {
      this._warshipState = {
        state: "patrolling",
        patrolTile: params.patrolTile,
        lastCombatTick: -100,
      };
    }
    this._targetUnit =
      "targetUnit" in params ? (params.targetUnit ?? undefined) : undefined;
    this._loaded =
      "loaded" in params ? (params.loaded ?? undefined) : undefined;
    this._trainType = "trainType" in params ? params.trainType : undefined;

    switch (this._type) {
      case UnitType.Warship:
      case UnitType.Port:
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.SAMLauncher:
      case UnitType.City:
      case UnitType.Factory:
        this.mg.stats().unitBuild(_owner, this._type);
    }
  }

  setTargetable(targetable: boolean): void {
    if (this._targetable !== targetable) {
      this._targetable = targetable;
      this.mg.addUpdate(this.toUpdate());
    }
  }

  isTargetable(): boolean {
    return this._targetable;
  }

  isUnit(): this is Unit {
    return true;
  }

  touch(): void {
    this.mg.addUpdate(this.toUpdate());
  }
  setTileTarget(tile: TileRef | undefined): void {
    this._targetTile = tile;
  }
  tileTarget(): TileRef | undefined {
    return this._targetTile;
  }

  id() {
    return this._id;
  }

  toUpdate(): UnitUpdate {
    return {
      type: GameUpdateType.Unit,
      unitType: this._type,
      id: this._id,
      troops: this._troops,
      ownerID: this._owner.smallID(),
      lastOwnerID: this._lastOwner?.smallID(),
      isActive: this._active,
      reachedTarget: this._reachedTarget,
      warshipState:
        this._warshipState !== undefined
          ? { ...this.warshipState() }
          : undefined,
      transportShipState:
        this._transportShipState !== undefined
          ? this.transportShipState()
          : undefined,
      pos: this._tile,
      markedForDeletion: this._deletionAt ?? false,
      targetable: this._targetable,
      lastPos: this._lastTile,
      health: this.hasHealth() ? Number(this._health) : undefined,
      underConstruction: this._underConstruction,
      targetUnitId: this._targetUnit?.id() ?? undefined,
      targetTile: this.targetTile() ?? undefined,
      missileTimerQueue: this._missileTimerQueue,
      level: this.level(),
      hasTrainStation: this._hasTrainStation,
      trainType: this._trainType,
      loaded: this._loaded,
      stolenTroops: this._stolenTroops > 0 ? this._stolenTroops : undefined,
      gainedTroops: this._gainedTroops > 0 ? this._gainedTroops : undefined,
      capturedTick: this._capturedTick ?? undefined,
      railReach: this._railReach.length > 0 ? [...this._railReach] : undefined,
      walkPath: this._walkPath.length > 0 ? [...this._walkPath] : undefined,
      railEta: this._railEta > 0 ? this._railEta : undefined,
      isCapital: this._isCapital || undefined,
      capitalName: this._capitalName,
      capitalGeneration: this._capitalGeneration || undefined,
      // terron: ПОДЛОДКИ — 0/undefined = обычный корабль, 1 = подлодка засвечена,
      // 2 = подлодка ещё не стреляла (враг не видит и не берёт в цель).
      // terron: 1/2 — подлодка (засвечена/скрыта), 3 — пиратская лодка
      // (спрайт), 4 — тихий десант пирата (скрыт от врага).
      // 5 — лодка ИДЁТ на точку блокады (клиент рисует ей пунктирную трассу
      // к флагу: без этого «нихуя не понятно, активировался скилл или нет»).
      subState: this.isSubmarine()
        ? this.isStealthed()
          ? 2
          : 1
        : this._blockade !== null
          ? 5
          : this.isPirate()
            ? 3
            : this.isStealthTransport()
              ? 4
              : undefined,
      // terron: ПИРАТСТВО — потолок здоровья пиратской лодки для полоски.
      maxHealth: this.isPirate() ? this.maxHealth() : undefined,
    };
  }

  // terron: ультимейты — Мин правды: счётчики шпиля (ховер-тултип).
  stolenTroops(): number {
    return this._stolenTroops;
  }

  gainedTroops(): number {
    return this._gainedTroops;
  }

  addMinistryDrain(stolenRaw: number, gained: number): void {
    if (stolenRaw <= 0) return;
    this._stolenTroops += stolenRaw;
    this._gainedTroops += gained;
    this.mg.addUpdate(this.toUpdate());
  }

  type(): UnitType {
    return this._type;
  }

  lastTile(): TileRef {
    return this._lastTile;
  }

  move(tile: TileRef): void {
    if (tile === null) {
      throw new Error("tile cannot be null");
    }
    this._lastTile = this._tile;
    this._tile = tile;
    this.mg.onUnitMoved(this);
  }

  setTroops(troops: number): void {
    this._troops = Math.max(0, troops);
  }
  troops(): number {
    return this._troops;
  }
  health(): number {
    return Number(this._health);
  }
  hasHealth(): boolean {
    return this.info().maxHealth !== undefined;
  }

  // terron: ПИРАТСТВО — у пиратской лодки потолок TERRON_PIRACY_BOAT_HEALTH
  // (умирает от 1 снаряда обычного корабля / 2 пиратских). Штаб снесли →
  // потолок снова 1000, текущее здоровье остаётся и лечится.
  maxHealth(): number | undefined {
    const base = this.info().maxHealth;
    if (base === undefined) return undefined;
    return this.isPirate() ? TERRON_PIRACY_BOAT_HEALTH : base;
  }

  // terron: ПИРАТСТВО — миссия «Блокада» (плывёт / на якоре / рисуется ли).
  private _blockade: { target: TileRef; anchored: boolean; drawn: boolean } | null =
    null;
  blockadeMission() {
    return this._blockade;
  }
  setBlockadeMission(
    m: { target: TileRef; anchored: boolean; drawn: boolean } | null,
  ): void {
    this._blockade = m;
  }
  // terron: ПИРАТСТВО — десант стартовал из порта → тихий.
  private _stealthLaunch = false;
  setStealthLaunch(v: boolean): void {
    this._stealthLaunch = v;
  }

  // terron: ПИРАТСТВО — «тихий десант»: транспорт пирата, стартовавший ИЗ ПОРТА,
  // скрыт от врага, пока не подошёл к точке высадки ближе
  // TERRON_PIRACY_STEALTH_REVEAL_RADIUS.
  isStealthTransport(): boolean {
    if (this._type !== UnitType.TransportShip) return false;
    if (!this._stealthLaunch) return false;
    if (!this._owner.hasUltimate(UnitType.Piracy)) return false;
    const dst = this.targetTile();
    if (dst === undefined) return true;
    const r = TERRON_PIRACY_STEALTH_REVEAL_RADIUS;
    return this.mg.euclideanDistSquared(this._tile, dst) > r * r;
  }
  tile(): TileRef {
    return this._tile;
  }
  owner(): PlayerImpl {
    return this._owner;
  }

  // terron: тик последнего захвата (null = здание не меняло владельца).
  capturedTick(): Tick | null {
    return this._capturedTick;
  }

  // terron: ДОРА — видовые поля. Сеттеры сами дёргают touch() ТОЛЬКО при
  // реальном изменении: иначе орудие слало бы апдейт каждый тик впустую.
  railReach(): readonly TileRef[] {
    return this._railReach;
  }

  setRailReach(tiles: readonly TileRef[]): void {
    const same =
      tiles.length === this._railReach.length &&
      tiles.every((t, i) => t === this._railReach[i]);
    if (same) return;
    this._railReach = tiles;
    this.touch();
  }

  railEta(): number {
    return this._railEta;
  }

  setRailEta(ticks: number): void {
    if (ticks === this._railEta) return;
    this._railEta = ticks;
    this.touch();
  }

  // terron 25.08: ШАГАЮЩИЙ ГОРОД — ОСТАТОК маршрута идущего здания. Видовое
  // поле (клиент рисует нитку пути и гост в точке прибытия), сим его не читает.
  // ⚠️ Своё поле, а НЕ railReach: у того другой смысл — «куда достанет выстрел
  // Доры», и облако рисуется по нему же. Смешаешь — путь здания превратится в
  // зону обстрела (урок про честный контракт полей, см. ult-cast-atlas-contract).
  walkPath(): readonly TileRef[] {
    return this._walkPath;
  }

  setWalkPath(tiles: readonly TileRef[]): void {
    const same =
      tiles.length === this._walkPath.length &&
      tiles.every((t, i) => t === this._walkPath[i]);
    if (same) return;
    this._walkPath = tiles;
    this.touch();
  }

  // terron: СТОЛИЦЫ — является ли этот City столицей владельца. Спека: CAPITALS.md
  isCapital(): boolean {
    return this._isCapital;
  }

  setCapital(isCapital: boolean): void {
    if (this._isCapital !== isCapital) {
      this._isCapital = isCapital;
      // terron: ЗНАМЯ ПОБЕДЫ — запоминаем ОСНОВАТЕЛЯ столицы (первый владелец).
      if (isCapital && this._capitalFounder === null) {
        this._capitalFounder = this._owner;
      }
      this.mg.addUpdate(this.toUpdate());
    }
  }

  // terron: ЗНАМЯ ПОБЕДЫ — основатель столицы (для «столица жертвы под знаменем»).
  private _capitalFounder: PlayerImpl | null = null;
  capitalFounder(): Player | null {
    return this._capitalFounder;
  }

  // terron: СТОЛИЦЫ — имя столицы (EN-канон). Спека: CAPITALS.md
  capitalGeneration(): number {
    return this._capitalGeneration;
  }

  setCapitalGeneration(gen: number): void {
    if (this._capitalGeneration === gen) return;
    this._capitalGeneration = gen;
    this.mg.addUpdate(this.toUpdate());
  }

  capitalName(): string | undefined {
    return this._capitalName;
  }

  setCapitalName(name: string): void {
    if (this._capitalName !== name) {
      this._capitalName = name;
      this.mg.addUpdate(this.toUpdate());
    }
  }

  info(): UnitInfo {
    return this.mg.unitInfo(this._type);
  }

  // terron: ПОДЛОДКИ — ТИК, с которого подлодка становится видимой. null = ещё
  // не стреляла (невидима). Не булев флаг: после первого залпа даётся фора
  // TERRON_SUBMARINE_REVEAL_DELAY_TICKS, иначе враг отвечает тем же тиком и
  // преимущества нет вовсе (репорт владельца 06.08). TerronTuning §ПОДЛОДКИ.
  private _subRevealAt: number | null = null;

  // terron: ПИРАТСТВО — боевой корабль владельца с живым штабом пиратов.
  isPirate(): boolean {
    return (
      this._type === UnitType.Warship &&
      this._owner.hasUltimate(UnitType.Piracy)
    );
  }

  isSubmarine(): boolean {
    return (
      this._type === UnitType.Warship &&
      this._owner.hasUltimate(UnitType.SubmarineBase)
    );
  }

  isStealthed(): boolean {
    if (!this.isSubmarine()) return false;
    if (this._subRevealAt === null) return true;
    return this.mg.ticks() < this._subRevealAt;
  }

  /** terron: ПОДЛОДКИ — выстрелила: засветка придёт через DELAY тиков. */
  revealSub(): void {
    if (this._subRevealAt !== null) return;
    this._subRevealAt = this.mg.ticks() + TERRON_SUBMARINE_REVEAL_DELAY_TICKS;
    this.mg.addUpdate(this.toUpdate());
  }

  setOwner(newOwner: PlayerImpl): void {
    this.clearPendingDeletion();
    switch (this._type) {
      case UnitType.Warship:
      case UnitType.Port:
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.SAMLauncher:
      case UnitType.City:
      case UnitType.Factory:
        this.mg.stats().unitCapture(newOwner, this._type);
        this.mg.stats().unitLose(this._owner, this._type);
        break;
    }
    this._lastOwner = this._owner;
    this._lastOwner._units = this._lastOwner._units.filter((u) => u !== this);
    this._owner = newOwner;
    this._owner._units.push(this);
    // terron: ульт-здание сменило владельца (захват) → переносим учёт, чтобы
    // ПАССИВКА заработала у нового владельца (hasUltimate). new-units/ULTIMATES.md
    if (Ultimates.has(this._type)) {
      this._lastOwner.untrackUltBuilding(this);
      this._owner.trackUltBuilding(this);
      this._capturedTick = this.mg.ticks(); // отсчёт самоуничтожения захвата
    }
    // terron: СТОЛИЦЫ — захваченная столица ПЕРЕХОДИТ новому владельцу (бонусы ему;
    // прежний остаётся ни с чем — удар по эго, денег она даёт немного). Если у
    // захватчика УЖЕ есть столица — эта становится обычным городом (одна на игрока).
    // Спека: CAPITALS.md
    if (this._isCapital) {
      // terron: ЗНАМЯ ПОБЕДЫ — статистика трофеев (ключ ульты: 100 столиц).
      this.mg.stats().capitalCaptured(this._owner);
      if (this._lastOwner.capital() === this) this._lastOwner.setCapital(null);
      if (this._owner.capital() === null) {
        this._owner.setCapital(this); // остаётся столицей → доход захватчику
      } else if (this._owner.hasUltimate(UnitType.VictoryBanner)) {
        // terron: ЗНАМЯ ПОБЕДЫ — трофейная столица ОСТАЁТСЯ столицей (×10 доход,
        // жертва без права на новую). Демотируется, когда штаб знамени падёт
        // (CityExecution). new-units/BANNER.md
      } else {
        this._isCapital = false; // у захватчика уже есть столица → эта → обычный город
      }
    }
    // РАНЬШЕ (может вернём): захват СНИМАЛ статус, никто не наследовал —
    //   if (this._isCapital) { this._isCapital = false;
    //     if (this._lastOwner.capital() === this) this._lastOwner.setCapital(null); }
    this.mg.addUpdate(this.toUpdate());
    this.mg.displayMessage(
      "events_display.unit_captured_by_enemy",
      MessageType.UNIT_CAPTURED_BY_ENEMY,
      this._lastOwner.id(),
      undefined,
      { unit: this.type(), name: newOwner.displayName() },
      this.id(),
    );
    this.mg.displayMessage(
      "events_display.captured_enemy_unit",
      MessageType.CAPTURED_ENEMY_UNIT,
      newOwner.id(),
      undefined,
      { unit: this.type(), name: this._lastOwner.displayName() },
      this.id(),
    );
  }

  modifyHealth(delta: number, attacker?: Player): void {
    const previousHealth = this._health;
    const nextHealth = withinInt(
      this._health + toInt(delta),
      0n,
      toInt(this.maxHealth() ?? 1),
    );

    if (nextHealth === previousHealth) {
      return;
    }

    if (
      attacker !== undefined &&
      delta < 0 &&
      this._warshipState !== undefined
    ) {
      this._warshipState.lastCombatTick = this.mg.ticks();
    }
    this._health = nextHealth;
    this.mg.addUpdate(this.toUpdate());
    if (this._health === 0n) {
      this.delete(true, attacker);
    }
  }

  clearPendingDeletion(): void {
    this._deletionAt = null;
  }

  isMarkedForDeletion(): boolean {
    return this._deletionAt !== null;
  }

  markForDeletion(): void {
    if (!this.isActive()) {
      return;
    }
    this._deletionAt =
      this.mg.ticks() + this.mg.config().deletionMarkDuration();
    this.mg.addUpdate(this.toUpdate());
  }

  isOverdueDeletion(): boolean {
    if (!this.isActive()) {
      return false;
    }
    return this._deletionAt !== null && this.mg.ticks() - this._deletionAt > 0;
  }

  delete(displayMessage?: boolean, destroyer?: Player): void {
    if (!this.isActive()) {
      throw new Error(`cannot delete ${this} not active`);
    }

    // Record whether this unit was destroyed by an enemy (vs. arrived / retreated)
    this._wasDestroyedByEnemy = destroyer !== undefined;
    this._destroyer = destroyer ?? undefined;

    this._owner._units = this._owner._units.filter((b) => b !== this);
    // terron: ульт-здание снесено/уничтожено → снять учёт (пассивка гаснет).
    if (Ultimates.has(this._type)) {
      this._owner.untrackUltBuilding(this);
    }
    // terron: СТОЛИЦЫ — снос столицы обнуляет указатель владельца (доход гаснет;
    // база — без переезда, но следующий построенный город снова станет столицей).
    if (this._isCapital) {
      this._isCapital = false;
      if (this._owner.capital() === this) this._owner.setCapital(null);
    }
    this._active = false;
    this.mg.addUpdate(this.toUpdate());
    this.mg.removeUnit(this);

    if (displayMessage !== false) {
      this.displayMessageOnDeleted();
    }

    if (destroyer !== undefined) {
      switch (this._type) {
        case UnitType.TransportShip:
          this.mg
            .stats()
            .boatDestroyTroops(destroyer, this._owner, this._troops);
          break;
        case UnitType.TradeShip:
          this.mg.stats().boatDestroyTrade(destroyer, this._owner);
          break;
        case UnitType.City:
        case UnitType.DefensePost:
        case UnitType.MissileSilo:
        case UnitType.Port:
        case UnitType.SAMLauncher:
        case UnitType.Warship:
        case UnitType.Factory:
          this.mg.stats().unitDestroy(destroyer, this._type);
          this.mg.stats().unitLose(this.owner(), this._type);
          break;
      }
    }
  }

  private displayMessageOnDeleted(): void {
    if (this._type === UnitType.MIRVWarhead) {
      return;
    }

    if (this._type === UnitType.Train && this._trainType !== TrainType.Engine) {
      return;
    }

    this.mg.displayMessage(
      "events_display.unit_destroyed",
      MessageType.UNIT_DESTROYED,
      this.owner().id(),
      undefined,
      { unit: this._type },
      this.id(),
    );
  }

  isActive(): boolean {
    return this._active;
  }

  wasDestroyedByEnemy(): boolean {
    return this._wasDestroyedByEnemy;
  }

  destroyer(): Player | undefined {
    return this._destroyer;
  }

  warshipState(): WarshipState {
    if (this._warshipState === undefined) {
      throw new Error("warshipState called on non-warship unit");
    }
    this._warshipState.isInCombat = this.isInCombat();
    return this._warshipState;
  }

  updateWarshipState(update: Partial<WarshipState>): void {
    if (this._warshipState === undefined) {
      throw new Error("updateWarshipState called on non-warship unit");
    }
    if (update.isInCombat) {
      this.markInCombat();
    }
    const merged = { ...this._warshipState, ...update };
    if (
      merged.state === this._warshipState.state &&
      merged.patrolTile === this._warshipState.patrolTile &&
      merged.retreatPort === this._warshipState.retreatPort
    )
      return;
    this._warshipState = {
      state: merged.state,
      patrolTile: merged.patrolTile,
      retreatPort: merged.retreatPort,
      lastCombatTick: this._warshipState.lastCombatTick,
    };
    this.mg.addUpdate(this.toUpdate());
  }

  isInCombat(): boolean {
    return this.mg.ticks() - this._warshipState!.lastCombatTick <= 3;
  }

  private markInCombat(): void {
    const wasInCombat = this.isInCombat();
    this._warshipState!.lastCombatTick = this.mg.ticks();
    if (!wasInCombat) {
      this.mg.addUpdate(this.toUpdate());
    }
  }

  transportShipState(): TransportShipState {
    if (this._transportShipState === undefined) {
      throw new Error("transportShipState called on non-transport-ship unit");
    }
    return {
      isRetreating: this._transportShipState.isRetreating,
      troops: this._troops,
    };
  }

  updateTransportShipState(update: Partial<TransportShipState>): void {
    if (this._transportShipState === undefined) {
      throw new Error(
        "updateTransportShipState called on non-transport-ship unit",
      );
    }
    let changed = false;
    if (
      update.isRetreating !== undefined &&
      this._transportShipState.isRetreating !== update.isRetreating
    ) {
      this._transportShipState = {
        ...this._transportShipState,
        isRetreating: update.isRetreating,
      };
      changed = true;
    }
    if (changed) {
      this.mg.addUpdate(this.toUpdate());
    }
  }

  isUnderConstruction(): boolean {
    return this._underConstruction;
  }

  setUnderConstruction(underConstruction: boolean): void {
    if (this._underConstruction !== underConstruction) {
      this._underConstruction = underConstruction;
      this.mg.addUpdate(this.toUpdate());
    }
  }

  hash(): number {
    return this.tile() + simpleHash(this.type()) * this._id;
  }

  toString(): string {
    return `Unit:${this._type},owner:${this.owner().name()}`;
  }

  launch(): void {
    this._missileTimerQueue.push(this.mg.ticks());
    this.mg.addUpdate(this.toUpdate());
  }

  ticksLeftInCooldown(): Tick | undefined {
    return this._missileTimerQueue[0];
  }

  isInCooldown(): boolean {
    return this._missileTimerQueue.length === this._level;
  }

  missileTimerQueue(): number[] {
    return this._missileTimerQueue;
  }

  reloadMissile(): void {
    this._missileTimerQueue.shift();
    this.mg.addUpdate(this.toUpdate());
  }

  // terron: ЗЕЛЁНЫЕ — груз борта-инспекции. GREEN.md
  culpritSmallID(): number {
    return this._culpritSmallID;
  }

  catastropheSteps(): number {
    return this._catastropheSteps;
  }

  setTargetTile(targetTile: TileRef | undefined) {
    this._targetTile = targetTile;
  }

  targetTile(): TileRef | undefined {
    return this._targetTile;
  }

  setTrajectoryIndex(i: number): void {
    const max = this._trajectory.length - 1;
    this._trajectoryIndex = i < 0 ? 0 : i > max ? max : i;
  }

  trajectoryIndex(): number {
    return this._trajectoryIndex;
  }

  trajectory(): TrajectoryTile[] {
    return this._trajectory;
  }

  setTargetUnit(target: Unit | undefined): void {
    this._targetUnit = target;
  }

  targetUnit(): Unit | undefined {
    return this._targetUnit;
  }

  setTargetedBySAM(targeted: boolean): void {
    this._targetedBySAM = targeted;
  }

  targetedBySAM(): boolean {
    return this._targetedBySAM;
  }

  setReachedTarget(): void {
    this._reachedTarget = true;
  }

  reachedTarget(): boolean {
    return this._reachedTarget;
  }

  setSafeFromPirates(): void {
    this._lastSetSafeFromPirates = this.mg.ticks();
  }

  isSafeFromPirates(): boolean {
    return (
      this.mg.ticks() - this._lastSetSafeFromPirates <
      this.mg.config().safeFromPiratesCooldownMax()
    );
  }

  level(): number {
    // terron: ЗНАМЯ ПОБЕДЫ — уровень штаба = число удерживаемых ЧУЖИХ столиц
    // (витрина: значок/подпись; на доход не влияет). new-units/BANNER.md
    if (this._type === UnitType.VictoryBanner) {
      let n = 0;
      for (const c of this._owner.units(UnitType.City)) {
        if (c.isCapital() && c.capitalFounder() !== this._owner) n++;
      }
      return Math.max(1, n);
    }
    return this._level;
  }

  setTrainStation(trainStation: boolean): void {
    this._hasTrainStation = trainStation;
    this.mg.addUpdate(this.toUpdate());
  }

  hasTrainStation(): boolean {
    return this._hasTrainStation;
  }

  increaseLevel(): void {
    this._level++;
    if ([UnitType.MissileSilo, UnitType.SAMLauncher].includes(this.type())) {
      this._missileTimerQueue.push(this.mg.ticks());
    }
    this.mg.addUpdate(this.toUpdate());
  }

  decreaseLevel(destroyer?: Player): void {
    this._level--;
    if ([UnitType.MissileSilo, UnitType.SAMLauncher].includes(this.type())) {
      this._missileTimerQueue.pop();
    }
    if (this._level <= 0) {
      this.delete(true, destroyer);
      return;
    }
    this.mg.addUpdate(this.toUpdate());
  }

  trainType(): TrainType | undefined {
    return this._trainType;
  }

  isLoaded(): boolean | undefined {
    return this._loaded;
  }

  setLoaded(loaded: boolean): void {
    if (this._loaded !== loaded) {
      this._loaded = loaded;
      this.mg.addUpdate(this.toUpdate());
    }
  }
}

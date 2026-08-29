import { PseudoRandom } from "../PseudoRandom";
import { ClientID } from "../Schemas";
import { findClosestBy, minInt, simpleHash, toInt, within } from "../Util";
import {
  TERRON_BLOCKADE_PORT_RANGE,
  TERRON_CATASTROPHE_RECAST_COOLDOWN_TICKS,
  TERRON_GREENS_DEBUFF_MAX_STACKS,
  TERRON_RAILGUN_SNAP,
  TERRON_TRAINS_TARGET_SNAP,
  TERRON_GREENS_DEBUFF_STEP,
  TERRON_GREENS_DEBUFF_TICKS,
  TERRON_INDUSTRIAL_TICKS,
  TERRON_OILRIG_MAX_DIST_FROM_OWN,
  TERRON_PACT_RECAST_COOLDOWN_TICKS,
  TERRON_PIRACY_SHIP_COOLDOWN_TICKS,
  TERRON_REVANCHISM_MAX_BUFF,
  TERRON_REVANCHISM_SCALE,
  TERRON_TRUCE_COOLDOWN_TICKS,
  TERRON_SPACEPORT_SEA_COST_MULT,
} from "../configuration/TerronTuning";
import { AttackImpl } from "./AttackImpl";
import { economySnapshot } from "./EconomyLog";
import {
  Alliance,
  AllianceInfo,
  AllianceRequest,
  AllPlayers,
  Attack,
  BuildableUnit,
  CAST_UNLOCKED_BY,
  Cell,
  actingAs,
  ColoredTeams,
  Embargo,
  EmojiMessage,
  GameMode,
  Gold,
  MutableAlliance,
  Nukes,
  Player,
  PlayerBuildable,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  Relation,
  Structures,
  ULTIMATE_REGISTRY,
  Team,
  TerraNullius,
  Tick,
  TradeHubs,
  ULT_MAX_COUNT,
  Ultimates,
  UltStats,
  Unit,
  UnitParams,
  UnitType,
} from "./Game";
import { GameImpl } from "./GameImpl";
import { andFN, manhattanDistFN, TileRef } from "./GameMap";
import { railTilesFrom } from "./RailReach";
import { diffPlayerUpdate } from "./GameUpdateUtils";
import {
  AllianceView,
  AttackUpdate,
  GameUpdateType,
  PlayerUpdate,
} from "./GameUpdates";
import {
  bestShoreDeploymentSource,
  canBuildTransportShip,
} from "./TransportShipUtils";
import { UnitImpl } from "./UnitImpl";

interface Target {
  tick: Tick;
  target: Player;
}

class Donation {
  constructor(
    public readonly recipient: Player,
    public readonly tick: Tick,
  ) {}
}

export class PlayerImpl implements Player {
  public _lastTileChange: number = 0;
  public _pseudo_random: PseudoRandom;

  private _gold: bigint;
  private _troops: bigint;

  markedTraitorTick = -1;
  private _betrayalCount: number = 0;

  private embargoes = new Map<PlayerID, Embargo>();

  public _borderTiles: Set<TileRef> = new Set();

  public _units: Unit[] = [];
  public _tiles: Set<TileRef> = new Set();
  // terron: РЕВАНШИЗМ — исторический ПИК числа тайлов (обновляется в тике игрока).
  // Оборона всей территории растёт при потере земель от пика. См. revanchismBuff().
  public _maxTilesOwned = 0;
  // terron: сколько тайлов этого игрока откусил каждый захватчик (smallID → кол-во).
  // Нужно, чтобы золото за завоевание делить пропорционально вкладу (см. GameImpl).
  public _tilesLostTo: Map<number, number> = new Map();
  // terron: авиация — тайлы-плацдармы десанта (tile → турн истечения иммунитета от
  // авто-схлопывания окружением). См. addAirborneBeachhead/activeAirborneBeachheads.
  public _airborneBeachheads: Map<TileRef, number> = new Map();
  // terron: ультимейты — зафиксированный выбор (null = ещё не использовал ни одну).
  // ⚠️ МЕРЖ-КРИТИЧНО (терроновское структурное поле). new-units/ULTIMATES.md
  private _ultimateChoice: UnitType | null = null;

  // terron: ультимейты — выбранная ульта (фиксируется первым использованием).
  ultimateChoice(): UnitType | null {
    return this._ultimateChoice;
  }

  // terron: СТОЛИЦЫ — указатель на столицу (первый построенный City). null =
  // столицы нет → следующий построенный город станет ею. Спека: CAPITALS.md
  private _capital: Unit | null = null;

  capital(): Unit | null {
    return this._capital;
  }

  /** terron 05.08: сколько раз игрок ОСНОВЫВАЛ столицу. Нужно подписи: вторая
   *  и следующие зовутся «Новая Зарница» (имя-то у игрока всегда одно). */
  private _capitalsFounded = 0;
  foundCapital(): number {
    this._capitalsFounded += 1;
    return this._capitalsFounded;
  }

  setCapital(capital: Unit | null): void {
    this._capital = capital;
  }

  // terron: ультимейты — фиксация выбора. true ТОЛЬКО при переходе null→выбор
  // (защита от двойного спавна пассив-исполнений на повторном интенте).
  chooseUltimate(unitType: UnitType): boolean {
    if (!Ultimates.has(unitType)) return false;
    if (this._ultimateChoice !== null) return false;
    this._ultimateChoice = unitType;
    return true;
  }

  // terron: ультимейты — набор ВСЕХ ульт-зданий во владении (свои + ЗАХВАЧЕННЫЕ).
  // Захват чужого ульт-здания даёт его ПАССИВКУ (hasUltimate по типу), а АКТИВКА
  // (пуск МИРВ/каст Раскола) остаётся по СВОЕМУ выбору (_ultimateChoice). 2 здания
  // = 2 пассивки. Обычно 1-3 элемента → скан дёшев. Поддержка: buildUnit +
  // UnitImpl.setOwner/delete (track/untrack). new-units/ULTIMATES.md
  private readonly _ultBuildings = new Set<Unit>();
  // terron: ПИРАТСТВО — тик последней покупки пиратской лодки (перезарядка).
  private _lastPirateShipTick: number | null = null;
  // terron: ГОРДОСТЬ — тик последнего перемирия (кулдаун каста).
  private _lastTruceTick: number | null = null;
  // terron: ДВОРЕЦ НАЦИЙ — тик навязанного пакта по цели (PEACE.md).
  private readonly _pacts = new Map<Player, number>();
  // terron: ДВОРЕЦ НАЦИЙ — длительность текущей метки предателя (null = стандарт).
  private _traitorDurationTicks: number | null = null;
  // terron: ЗЕЛЁНЫЕ — штраф к доходу «Это катастрофа!» (new-units/GREEN.md).
  // Одна шкала на ОБА источника (пассив-возмездие за детонацию и каст-травля):
  // складывать их до −60% нельзя, это казнь без контрплея. Кап тоже общий на
  // матч — троих Зелёных быть может, −90% дохода нет.
  private _catastropheStacks = 0;
  private _catastropheUntil = -1;
  // terron: ТОПЛИВО — «Индустриальная революция» (тик окончания). FUEL.md
  private _industrialUntil = -1;
  // terron: КОСМОДРОМ — суммарный ДОХОД игрока за матч (только заработок с
  // рабочих, не любые поступления). Космодром берёт процент от ПРИРОСТА этой
  // величины за период, а не от баланса: баланс тратят, и «доход за минуту»
  // по нему не восстановить. SPACE.md
  private _incomeAccrued = 0n;
  // terron: ЗЕЛЁНЫЕ — травля «Это катастрофа!»: ОДНА жертва одновременно, на
  // ту же цель повторно — не раньше чем через RECAST после спада штрафа
  // (иначе 5M раз в две минуты держат лидера в вечном минусе, а это уже не
  // травля, а вычёркивание игрока). Приём тот же, что у Пакта. GREEN.md
  private readonly _catastropheCasts = new Map<Player, number>();

  markCatastrophe(target: Player): void {
    this._catastropheCasts.set(target, this.mg.ticks());
  }

  /** Есть ли ЖИВАЯ травля (жертва ещё под штрафом) — значит новую нельзя. */
  catastropheActive(): boolean {
    for (const [t, tick] of this._catastropheCasts) {
      if (
        this.mg.ticks() < tick + TERRON_GREENS_DEBUFF_TICKS &&
        t.catastropheStacks() > 0
      ) {
        return true;
      }
    }
    return false;
  }

  /** Кулдаун повторной травли той же цели. */
  catastropheBlocked(target: Player): boolean {
    const tick = this._catastropheCasts.get(target);
    if (tick === undefined) return false;
    return (
      this.mg.ticks() <
      tick + TERRON_GREENS_DEBUFF_TICKS + TERRON_CATASTROPHE_RECAST_COOLDOWN_TICKS
    );
  }

  // terron: ТОПЛИВО — «Индустриальная революция»: ×3 скорость и −50% прироста
  // на время. Вешается и на себя, и на чужого; повторный каст на уже
  // «революционную» страну не проходит (гейт в canSpawnUnitType). FUEL.md
  // terron: КОСМОДРОМ — накопленный доход (см. поле). SPACE.md
  addIncomeAccrued(amount: Gold): void {
    if (amount > 0n) this._incomeAccrued += amount;
  }

  incomeAccrued(): Gold {
    return this._incomeAccrued;
  }

  industrialActive(): boolean {
    return this._industrialUntil > 0 && this.mg.ticks() < this._industrialUntil;
  }

  startIndustrialRevolution(): void {
    this._industrialUntil = this.mg.ticks() + TERRON_INDUSTRIAL_TICKS;
  }

  markPact(target: Player): void {
    this._pacts.set(target, this.mg.ticks());
  }
  pactActive(): boolean {
    const dur = this.mg.config().allianceDuration();
    for (const [t, tick] of this._pacts) {
      if (this.mg.ticks() < tick + dur && this.isAlliedWith(t)) return true;
    }
    return false;
  }
  pactWith(other: Player): number | null {
    const mine = this._pacts.get(other);
    const theirs = (other as PlayerImpl)._pacts?.get(this);
    const t = mine ?? theirs;
    if (t === undefined) return null;
    return this.mg.ticks() < t + this.mg.config().allianceDuration() ? t : null;
  }
  pactBlocked(target: Player): boolean {
    const tick = this._pacts.get(target);
    if (tick === undefined) return false;
    return (
      this.mg.ticks() <
      tick +
        this.mg.config().allianceDuration() +
        TERRON_PACT_RECAST_COOLDOWN_TICKS
    );
  }
  markTruce(): void {
    this._lastTruceTick = this.mg.ticks();
  }
  // terron: ЗНАМЯ ПОБЕДЫ — держу ли столицу, основанную victim (под знаменем).
  holdsCapitalOf(victim: Player): boolean {
    if (!this.hasUltimate(UnitType.VictoryBanner)) return false;
    for (const c of this.units(UnitType.City)) {
      if (c.isActive() && c.isCapital() && c.capitalFounder() === victim) {
        return true;
      }
    }
    return false;
  }
  // terron: ЗНАМЯ ПОБЕДЫ — моя столица под чужим знаменем → новую не основать.
  capitalUnderBanner(): boolean {
    for (const p of this.mg.players()) {
      if (p === this) continue;
      if (p.holdsCapitalOf(this)) return true;
    }
    return false;
  }

  trackUltBuilding(u: Unit): void {
    this._ultBuildings.add(u);
  }
  untrackUltBuilding(u: Unit): void {
    this._ultBuildings.delete(u);
  }

  // Владею ли живым ДОСТРОЕННЫМ ульт-зданием этого типа (для ПАССИВОК; захваченные
  // считаются). Активка-гейты (МИРВ/Раскол) дополнительно требуют _ultimateChoice.
  hasUltimate(unitType: UnitType): boolean {
    for (const b of this._ultBuildings) {
      if (
        b.type() === unitType &&
        b.owner() === this &&
        b.isActive() &&
        !b.isUnderConstruction()
      ) {
        return true;
      }
    }
    return false;
  }

  // terron: СКОЛЬКО живых достроенных ульт-зданий этого типа во владении (свои +
  // ЗАХВАЧЕННЫЕ) — тот же набор, что у hasUltimate. Религия: это N и для квоты
  // роста (2+N), и для десятины (×0.9^N) — числа обязаны быть ОДНИМ и тем же.
  ultimateCount(unitType: UnitType): number {
    let n = 0;
    for (const b of this._ultBuildings) {
      if (
        b.type() === unitType &&
        b.owner() === this &&
        b.isActive() &&
        !b.isUnderConstruction()
      ) {
        n++;
      }
    }
    return n;
  }

  // terron: ультимейты — суммарные метрики за матч (тултип слота ульты).
  private _ultStats: UltStats = {
    stolen: 0,
    stolenGained: 0,
    mirvLaunches: 0,
    mirvTiles: 0,
    fortTiles: 0,
    splitTiles: 0,
    religionTiles: 0,
    religionTithe: 0,
    waterTiles: 0,
  };

  ultStats(): UltStats {
    return this._ultStats;
  }

  addUltStat(key: keyof UltStats, n: number): void {
    if (n <= 0) return;
    this._ultStats[key] += n;
  }

  public pastOutgoingAllianceRequests: AllianceRequest[] = [];
  private _expiredAlliances: Alliance[] = [];

  private targets_: Target[] = [];

  private outgoingEmojis_: EmojiMessage[] = [];
  private outgoingQuickChats_ = new Map<number, Tick>();

  private sentDonations: Donation[] = [];

  private relations = new Map<Player, number>();

  private lastDeleteUnitTick: Tick = -1;
  private lastEmbargoAllTick: Tick = -1;

  // terron: РЕВАНШИЗМ — «кто напал первым». _firstStrikeAt: МОЙ первый удар по
  // игроку (smallID → тик). _aggressors: кто ударил меня, когда я его ещё не
  // трогал. Ведём ВСЕГДА, даже без штаба-статуи: штаб только включает бонус
  // (кейс «здание достроилось ровно в момент атаки»). TerronTuning §РЕВАНШИЗМ.
  private _firstStrikeAt: Map<number, Tick> = new Map();
  private _aggressors: Set<number> = new Set();
  // terron ПЕРФ (21.08): toUpdate() зовётся на КАЖДОГО игрока КАЖДЫЙ тик, и
  // `[...this._aggressors]` давал по массиву на игрока на тик (300-400
  // аллокаций/тик к середине матча), хотя множество меняется редко. Кэш
  // сбрасывается в единственной точке записи (createAttack).
  private _aggressorsArr: number[] | null = null;

  public _incomingAttacks: Attack[] = [];
  public _outgoingAttacks: Attack[] = [];
  public _outgoingLandAttacks: Attack[] = [];

  public _alliances: MutableAlliance[] = [];

  private _spawnTile: TileRef | undefined;
  private _isDisconnected = false;

  /**
   * Last PlayerUpdate emitted for this player on the worker→main channel.
   * Used by GameImpl's tick loop to compute field-level diffs. Undefined on
   * first emission (full snapshot sent).
   */
  public lastSentUpdate: PlayerUpdate | undefined;

  constructor(
    private mg: GameImpl,
    private _smallID: number,
    private readonly playerInfo: PlayerInfo,
    startTroops: number,
    private readonly _team: Team | null,
  ) {
    this._troops = toInt(startTroops);
    this._gold = mg.config().startingGold(playerInfo);
    this._pseudo_random = new PseudoRandom(simpleHash(this.playerInfo.id));
  }

  largestClusterBoundingBox: { min: Cell; max: Cell } | null;

  /**
   * Build a PlayerUpdate for the worker→main wire.
   *
   * The first call for a player returns the full snapshot. Subsequent calls
   * return only fields that changed since the previous call (a partial
   * `{ type, id, ...changedFields }`), or `null` if nothing changed.
   *
   * `lastSentUpdate` is updated to the full snapshot on every call.
   */
  toUpdate(): PlayerUpdate | null {
    const full = this.toFullUpdate();
    const prev = this.lastSentUpdate;
    this.lastSentUpdate = full;
    if (prev === undefined) return full;
    return diffPlayerUpdate(prev, full);
  }

  private toFullUpdate(): PlayerUpdate {
    const outgoingAllianceRequests = this.outgoingAllianceRequests().map((ar) =>
      ar.recipient().id(),
    );

    return {
      type: GameUpdateType.Player,
      clientID: this.clientID(),
      name: this.name(),
      displayName: this.displayName(),
      id: this.id(),
      team: this.team() ?? undefined,
      smallID: this.smallID(),
      playerType: this.type(),
      isAlive: this.isAlive(),
      isDisconnected: this.isDisconnected(),
      tilesOwned: this.numTilesOwned(),
      gold: this._gold,
      troops: this.troops(),
      allies: this.alliances().map((a) => a.other(this).smallID()),
      embargoes: new Set([...this.embargoes.keys()].map((p) => p.toString())),
      isTraitor: this.isTraitor(),
      traitorRemainingTicks: this.getTraitorRemainingTicks(),
      targets: this.targets().map((p) => p.smallID()),
      outgoingEmojis: this.outgoingEmojis(),
      outgoingAttacks: this.outgoingAttacks().map((a) => {
        return {
          attackerID: a.attacker().smallID(),
          targetID: a.target().smallID(),
          troops: a.troops(),
          id: a.id(),
          retreating: a.retreating(),
        } satisfies AttackUpdate;
      }),
      incomingAttacks: this.incomingAttacks().map((a) => {
        return {
          attackerID: a.attacker().smallID(),
          targetID: a.target().smallID(),
          troops: a.troops(),
          id: a.id(),
          retreating: a.retreating(),
        } satisfies AttackUpdate;
      }),
      outgoingAllianceRequests: outgoingAllianceRequests,
      alliances: this.alliances().map(
        (a) =>
          ({
            id: a.id(),
            other: a.other(this).id(),
            createdAt: a.createdAt(),
            expiresAt: a.expiresAt(),
            hasExtensionRequest:
              a.expiresAt() <=
              this.mg.ticks() +
                this.mg.config().allianceExtensionPromptOffset(),
          }) satisfies AllianceView,
      ),
      hasSpawned: this.hasSpawned(),
      spawnTile: this._spawnTile,
      betrayals: this._betrayalCount,
      lastDeleteUnitTick: this.lastDeleteUnitTick,
      isLobbyCreator: this.isLobbyCreator(),
      // terron: DEV эконом-снимок для /balance (undefined когда лог выключен/нет дохода).
      econGold: economySnapshot(this._smallID),
      // terron: авиация — активные десантные плацдармы для клиентского таймера.
      airborneBeachheads: [...this._airborneBeachheads].map(
        ([tile, expiryTick]) => ({ tile, expiryTick }),
      ),
      // terron: авиация — счётчик построенных высадок (цена следующей в радиале).
      airborneAssaultsBuilt: this.unitsConstructed(UnitType.AirborneAssault),
      // terron: ультимейты — зафиксированный выбор (для слота в панели клиента).
      ultimateChoice: this._ultimateChoice ?? undefined,
      // terron: ПИРАТСТВО — когда можно будет купить следующую лодку (откат
      // игрока, а не здания). Интерфейс рисует его общим циферблатом.
      pirateShipReadyAt:
        this._lastPirateShipTick === null
          ? undefined
          : this._lastPirateShipTick + TERRON_PIRACY_SHIP_COOLDOWN_TICKS,
      // terron: ультимейты — суммарные метрики (тултип слота), 0 не возим.
      ultStolen: this._ultStats.stolen || undefined,
      ultStolenGained: this._ultStats.stolenGained || undefined,
      ultMirvLaunches: this._ultStats.mirvLaunches || undefined,
      ultMirvTiles: this._ultStats.mirvTiles || undefined,
      ultFortTiles: this._ultStats.fortTiles || undefined,
      ultSplitTiles: this._ultStats.splitTiles || undefined,
      ultReligionTiles: this._ultStats.religionTiles || undefined,
      ultReligionTithe: this._ultStats.religionTithe || undefined,
      ultWaterTiles: this._ultStats.waterTiles || undefined,
      // terron: РЕВАНШИЗМ — «на кого обиделись» (ховер статуи). Порядок = порядок
      // нападений (Set хранит вставку) → детерминирован.
      aggressors:
        this._aggressors.size > 0
          ? (this._aggressorsArr ??= [...this._aggressors])
          : undefined,
      // terron: ультимейты — Раскол: маркер одной цифры-таймера спасения Т.
      splitRescue: this._splitRescue,
    };
  }

  smallID(): number {
    return this._smallID;
  }

  name(): string {
    return this.playerInfo.name;
  }
  displayName(): string {
    return this.playerInfo.displayName;
  }

  clientID(): ClientID | null {
    return this.playerInfo.clientID;
  }

  id(): PlayerID {
    return this.playerInfo.id;
  }

  type(): PlayerType {
    return this.playerInfo.playerType;
  }

  units(...types: UnitType[]): Unit[] {
    const len = types.length;
    if (len === 0) {
      return this._units;
    }

    // Fast paths for common small arity calls to avoid Set allocation.
    if (len === 1) {
      const t0 = types[0]!;
      const out: Unit[] = [];
      for (const u of this._units) {
        if (u.type() === t0) out.push(u);
      }
      return out;
    }

    if (len === 2) {
      const t0 = types[0]!;
      const t1 = types[1]!;
      if (t0 === t1) {
        const out: Unit[] = [];
        for (const u of this._units) {
          if (u.type() === t0) out.push(u);
        }
        return out;
      }
      const out: Unit[] = [];
      for (const u of this._units) {
        const t = u.type();
        if (t === t0 || t === t1) out.push(u);
      }
      return out;
    }

    if (len === 3) {
      const t0 = types[0]!;
      const t1 = types[1]!;
      const t2 = types[2]!;
      // Keep semantics identical for duplicates in types by using direct comparisons.
      const out: Unit[] = [];
      for (const u of this._units) {
        const t = u.type();
        if (t === t0 || t === t1 || t === t2) out.push(u);
      }
      return out;
    }

    const ts = new Set(types);
    const out: Unit[] = [];
    for (const u of this._units) {
      if (ts.has(u.type())) out.push(u);
    }
    return out;
  }

  private numUnitsConstructed: Partial<Record<UnitType, number>> = {};
  private recordUnitConstructed(type: UnitType): void {
    if (this.numUnitsConstructed[type] !== undefined) {
      this.numUnitsConstructed[type]++;
    } else {
      this.numUnitsConstructed[type] = 1;
    }
  }

  // Count of units built by the player, including construction
  unitsConstructed(type: UnitType): number {
    const built = this.numUnitsConstructed[type] ?? 0;
    let constructing = 0;
    for (const unit of this._units) {
      if (unit.type() !== type) continue;
      if (!unit.isUnderConstruction()) continue;
      constructing++;
    }
    const total = constructing + built;
    return total;
  }

  // Count of units owned by the player, not including construction
  unitCount(type: UnitType): number {
    let total = 0;
    for (const unit of this._units) {
      if (unit.type() === type) {
        total += unit.level();
      }
    }
    return total;
  }

  // Count of units owned by the player, including construction
  unitsOwned(type: UnitType): number {
    let total = 0;
    for (const unit of this._units) {
      if (unit.type() === type) {
        if (unit.isUnderConstruction()) {
          total++;
        } else {
          total += unit.level();
        }
      }
    }
    return total;
  }

  sharesBorderWith(other: Player | TerraNullius): boolean {
    for (const border of this._borderTiles) {
      for (const neighbor of this.mg.map().neighbors(border)) {
        if (this.mg.map().ownerID(neighbor) === other.smallID()) {
          return true;
        }
      }
    }
    return false;
  }

  numTilesOwned(): number {
    return this._tiles.size;
  }

  maxTilesOwned(): number {
    return this._maxTilesOwned;
  }

  // terron: обновить исторический пик (зовётся детерминированно в тике игрока).
  updateMaxTiles(): void {
    const n = this._tiles.size;
    if (n > this._maxTilesOwned) this._maxTilesOwned = n;
  }

  // terron: РЕВАНШИЗМ — множитель-БАФ к защите всей территории по потере земель от
  // пика: (пик−сейчас)/пик × SCALE, кап MAX. 0 на пике/росте. Читает attackLogic
  // (защита) и UI. Детерминированно (только целые тайлы + константы).
  revanchismBuff(): number {
    const max = this._maxTilesOwned;
    if (max <= 0) return 0;
    const cur = this._tiles.size;
    if (cur >= max) return 0;
    const lostFraction = (max - cur) / max;
    return Math.min(
      TERRON_REVANCHISM_MAX_BUFF,
      lostFraction * TERRON_REVANCHISM_SCALE,
    );
  }

  tiles(): ReadonlySet<TileRef> {
    return new Set(this._tiles.values()) as Set<TileRef>;
  }

  borderTiles(): ReadonlySet<TileRef> {
    return this._borderTiles;
  }

  nearby(): (Player | TerraNullius)[] {
    const ns: Set<Player | TerraNullius> = new Set();
    for (const border of this.borderTiles()) {
      for (const neighbor of this.mg.map().neighbors(border)) {
        if (this.mg.map().isLand(neighbor)) {
          const owner = this.mg.map().ownerID(neighbor);
          if (owner !== this.smallID()) {
            ns.add(
              this.mg.playerBySmallID(owner) satisfies Player | TerraNullius,
            );
          }
        }
      }
    }
    for (const n of this.shoreReachableNeighbors()) {
      ns.add(n);
    }
    return Array.from(ns);
  }

  // Samples every 10th border tile for shore tiles, checks the tile 5 steps
  // away in each cardinal direction that immediately enters water, to detect
  // players separated by a small river (up to 4 water tiles wide)
  private shoreReachableNeighbors(): Set<Player | TerraNullius> {
    const ns: Set<Player | TerraNullius> = new Set();
    const map = this.mg.map();
    const shores = Array.from(this.borderTiles()).filter((t) => map.isShore(t));
    const directions: [number, number][] = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];

    for (let i = 0; i < shores.length; i += 10) {
      const border = shores[i];

      const bx = map.x(border);
      const by = map.y(border);

      for (const [dx, dy] of directions) {
        // Only follow directions that immediately enter water; land-adjacent
        // directions are already covered by the direct neighbors() loop.
        const x1 = bx + dx;
        const y1 = by + dy;
        if (!map.isValidCoord(x1, y1) || !map.isWater(map.ref(x1, y1)))
          continue;

        const nx = bx + dx * 5;
        const ny = by + dy * 5;
        if (!map.isValidCoord(nx, ny)) continue;
        const tile = map.ref(nx, ny);
        if (!map.isLand(tile)) continue;
        if (!map.hasOwner(tile) && map.hasFallout(tile)) continue;
        const owner = map.ownerID(tile);
        if (owner !== this.smallID()) {
          ns.add(
            this.mg.playerBySmallID(owner) satisfies Player | TerraNullius,
          );
        }
      }
    }

    return ns;
  }

  isPlayer(): this is Player {
    return true as const;
  }
  setTroops(troops: number) {
    this._troops = toInt(troops);
  }
  conquer(tile: TileRef) {
    this.mg.conquer(this, tile);
  }

  // terron: авиация — десантный плацдарм (tile → турн истечения иммунитета).
  addAirborneBeachhead(tile: TileRef, expiryTick: number) {
    this._airborneBeachheads.set(tile, expiryTick);
  }

  // Снять метку плацдарма (истёк иммунитет / кластер разокружён).
  clearAirborneBeachhead(tile: TileRef) {
    this._airborneBeachheads.delete(tile);
  }

  // terron: ультимейты — Раскол. «Тихий» иммунитет: защищает тайл от схлопывания
  // так же, как плацдарм, но НЕ попадает в airborneBeachheads-вью → цифра-таймер
  // над тайлом НЕ рисуется. Живучесть проверяется в activeAirborneBeachheads.
  public _silentImmuneTiles: Map<TileRef, number> = new Map();
  addSilentImmunity(tile: TileRef, expiryTick: number) {
    this._silentImmuneTiles.set(tile, expiryTick);
  }

  // terron: ультимейты — Раскол. Маркер ОДНОЙ цифры-таймера спасения Т (центр
  // перекрестья + ширина ножки + турн истечения). Клиент рисует крупную цифру.
  public _splitRescue: {
    x: number;
    y: number;
    w: number;
    expiry: number;
  } | null = null;
  setSplitRescue(
    v: { x: number; y: number; w: number; expiry: number } | null,
  ) {
    this._splitRescue = v;
  }

  clearSilentImmunity(tile: TileRef) {
    this._silentImmuneTiles.delete(tile);
  }

  // terron: ультимейты — Раскол: бот-сепаратист навсегда иммунен к схлопыванию.
  private _immuneToCollapse = false;
  markImmuneToCollapse() {
    this._immuneToCollapse = true;
  }
  isImmuneToCollapse(): boolean {
    return this._immuneToCollapse;
  }

  private _clusterCalcPausedUntil = 0;
  clusterCalcPausedUntil(): Tick {
    return this._clusterCalcPausedUntil;
  }
  pauseClusterCalcUntil(tick: Tick): void {
    // Только продлеваем: два раскола подряд не должны укорачивать паузу.
    if (tick > this._clusterCalcPausedUntil) this._clusterCalcPausedUntil = tick;
  }

  // Живые плацдармы: не истёкшие И всё ещё принадлежащие игроку. Попутно чистим карту.
  activeAirborneBeachheads(currentTick: number): ReadonlySet<TileRef> {
    const active = new Set<TileRef>();
    for (const [tile, expiry] of this._airborneBeachheads) {
      if (expiry <= currentTick || !this._tiles.has(tile)) {
        this._airborneBeachheads.delete(tile);
        continue;
      }
      active.add(tile);
    }
    // terron: «тихие» иммунитеты Раскола — та же защита от схлопывания, без вью-цифры.
    for (const [tile, expiry] of this._silentImmuneTiles) {
      if (expiry <= currentTick || !this._tiles.has(tile)) {
        this._silentImmuneTiles.delete(tile);
        continue;
      }
      active.add(tile);
    }
    return active;
  }

  orderRetreat(id: string) {
    const attack = this._outgoingAttacks.find((attack) => attack.id() === id);
    if (!attack) {
      console.warn(`Didn't find outgoing attack with id ${id}`);
      return;
    }
    attack.orderRetreat();
  }
  executeRetreat(id: string): void {
    const attack = this._outgoingAttacks.find((attack) => attack.id() === id);
    // Execution is delayed so it's not an error that the attack does not exist.
    if (!attack) {
      return;
    }
    attack.executeRetreat();
  }
  relinquish(tile: TileRef) {
    if (this.mg.owner(tile) !== this) {
      throw new Error(`Cannot relinquish tile not owned by this player`);
    }
    this.mg.relinquish(tile);
  }
  info(): PlayerInfo {
    return this.playerInfo;
  }

  isLobbyCreator(): boolean {
    return this.playerInfo.isLobbyCreator;
  }

  isAlive(): boolean {
    return this._tiles.size > 0;
  }

  hasSpawned(): boolean {
    return this._spawnTile !== undefined;
  }

  setSpawnTile(spawnTile: TileRef): void {
    this._spawnTile = spawnTile;
  }

  spawnTile(): TileRef | undefined {
    return this._spawnTile;
  }

  incomingAllianceRequests(): AllianceRequest[] {
    return this.mg.allianceRequests.filter((ar) => ar.recipient() === this);
  }

  outgoingAllianceRequests(): AllianceRequest[] {
    return this.mg.allianceRequests.filter((ar) => ar.requestor() === this);
  }

  alliances(): MutableAlliance[] {
    return this._alliances;
  }

  expiredAlliances(): Alliance[] {
    return [...this._expiredAlliances];
  }

  allies(): Player[] {
    return this.alliances().map((a) => a.other(this));
  }

  isAlliedWith(other: Player): boolean {
    if (other === this) {
      return false;
    }
    return this.allianceWith(other) !== null;
  }

  allianceWith(other: Player): MutableAlliance | null {
    if (other === this) {
      return null;
    }
    return (
      this.alliances().find(
        (a) => a.recipient() === other || a.requestor() === other,
      ) ?? null
    );
  }

  allianceInfo(other: Player): AllianceInfo | null {
    const alliance = this.allianceWith(other);
    if (!alliance) {
      return null;
    }
    const inExtensionWindow =
      alliance.expiresAt() <=
      this.mg.ticks() + this.mg.config().allianceExtensionPromptOffset();
    const canExtend =
      !this.isDisconnected() &&
      !other.isDisconnected() &&
      this.isAlive() &&
      other.isAlive() &&
      inExtensionWindow &&
      !alliance.agreedToExtend(this);
    return {
      expiresAt: alliance.expiresAt(),
      inExtensionWindow,
      myPlayerAgreedToExtend: alliance.agreedToExtend(this),
      otherAgreedToExtend: alliance.agreedToExtend(other),
      canExtend,
    };
  }

  canSendAllianceRequest(other: Player): boolean {
    if (this.mg.config().disableAlliances()) {
      return false;
    }
    if (other === this) {
      return false;
    }
    if (this.isDisconnected() || other.isDisconnected()) {
      // Disconnected players are marked as not-friendly even if they are allies,
      // so we need to return early if either player is disconnected.
      // Otherwise we could end up sending an alliance request to someone
      // we are already allied with.
      return false;
    }
    if (this.isFriendly(other) || !this.isAlive()) {
      return false;
    }

    const hasPending = this.outgoingAllianceRequests().some(
      (ar) => ar.recipient() === other,
    );

    if (hasPending) {
      return false;
    }

    const hasIncoming = this.incomingAllianceRequests().some(
      (ar) => ar.requestor() === other,
    );

    if (hasIncoming) {
      return true;
    }

    const recent = this.pastOutgoingAllianceRequests
      .filter((ar) => ar.recipient() === other)
      .sort((a, b) => b.createdAt() - a.createdAt());

    if (recent.length === 0) {
      return true;
    }

    const delta = this.mg.ticks() - recent[0].createdAt();

    return delta >= this.mg.config().allianceRequestCooldown();
  }

  breakAlliance(alliance: MutableAlliance): void {
    this.mg.breakAlliance(this, alliance);
  }

  removeAllAlliances(): void {
    this.mg.removeAlliancesByPlayerSilently(this);
  }

  isTraitor(): boolean {
    return this.getTraitorRemainingTicks() > 0;
  }

  getTraitorRemainingTicks(): number {
    if (this.markedTraitorTick < 0) return 0;
    const elapsed = this.mg.ticks() - this.markedTraitorTick;
    const duration =
      this._traitorDurationTicks ?? this.mg.config().traitorDuration();
    const remaining = duration - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  markTraitor(durationTicks?: number): void {
    this.markedTraitorTick = this.mg.ticks();
    this._traitorDurationTicks = durationTicks ?? null;
    this._betrayalCount++; // Keep count for Nations too

    // Record stats (only for real Humans)
    this.mg.stats().betray(this);
  }

  betrayals(): number {
    return this._betrayalCount;
  }

  // terron: ЗЕЛЁНЫЕ — ступени штрафа к доходу. Истёкшие ступени обнуляются
  // ЛЕНИВО при чтении (таймера-исполнения нет: лишний tick на каждого игрока
  // ради выключения множителя — плохой размен). GREEN.md
  catastropheStacks(): number {
    if (this._catastropheStacks === 0) return 0;
    if (this.mg.ticks() >= this._catastropheUntil) {
      this._catastropheStacks = 0;
      this._catastropheUntil = -1;
      return 0;
    }
    return this._catastropheStacks;
  }

  /**
   * Добавить ступени штрафа и ПРОДЛИТЬ его. Продление намеренное: новая
   * детонация во время действия обнуляет таймер, а не проходит впустую.
   * Кап — TERRON_GREENS_DEBUFF_MAX_STACKS, общий для пассива и каста.
   */
  addCatastropheStacks(steps: number): void {
    if (steps <= 0) return;
    const cur = this.catastropheStacks(); // важно: сначала сжечь протухшие
    this._catastropheStacks = Math.min(
      TERRON_GREENS_DEBUFF_MAX_STACKS,
      cur + steps,
    );
    this._catastropheUntil = this.mg.ticks() + TERRON_GREENS_DEBUFF_TICKS;
  }

  /** Множитель дохода от штрафа: 1 → 0.9 → 0.8 → 0.7. */
  catastropheGoldMult(): number {
    const stacks = this.catastropheStacks();
    if (stacks === 0) return 1;
    return Math.max(0, 1 - stacks * TERRON_GREENS_DEBUFF_STEP);
  }

  createAllianceRequest(recipient: Player): AllianceRequest | null {
    if (this.isAlliedWith(recipient)) {
      throw new Error(`cannot create alliance request, already allies`);
    }
    return this.mg.createAllianceRequest(this, recipient satisfies Player);
  }

  relation(other: Player): Relation {
    if (other === this) {
      throw new Error(`cannot get relation with self: ${this}`);
    }
    const relation = this.relations.get(other) ?? 0;
    return this.relationFromValue(relation);
  }

  private relationFromValue(relationValue: number): Relation {
    if (relationValue < -50) {
      return Relation.Hostile;
    }
    if (relationValue < 0) {
      return Relation.Distrustful;
    }
    if (relationValue < 50) {
      return Relation.Neutral;
    }
    return Relation.Friendly;
  }

  allRelationsSorted(): { player: Player; relation: Relation }[] {
    return Array.from(this.relations, ([k, v]) => ({ player: k, relation: v }))
      .filter((r) => r.player.isAlive())
      .sort((a, b) => a.relation - b.relation)
      .map((r) => ({
        player: r.player,
        relation: this.relationFromValue(r.relation),
      }));
  }

  updateRelation(other: Player, delta: number): void {
    if (other === this) {
      throw new Error(`cannot update relation with self: ${this}`);
    }
    const relation = this.relations.get(other) ?? 0;
    const newRelation = within(relation + delta, -100, 100);
    this.relations.set(other, newRelation);
  }

  decayRelations() {
    this.relations.forEach((r: number, p: Player) => {
      const sign = -1 * Math.sign(r);
      const delta = 0.05;
      r += sign * delta;
      if (Math.abs(r) < delta * 2) {
        r = 0;
      }
      this.relations.set(p, r);
    });
  }

  canTarget(other: Player): boolean {
    if (this === other) {
      return false;
    }
    if (this.isFriendly(other)) {
      return false;
    }
    for (const t of this.targets_) {
      if (this.mg.ticks() - t.tick < this.mg.config().targetCooldown()) {
        return false;
      }
    }
    return true;
  }

  target(other: Player): void {
    this.targets_.push({ tick: this.mg.ticks(), target: other });
    this.mg.target(this, other);
  }

  targets(): Player[] {
    return this.targets_
      .filter(
        (t) => this.mg.ticks() - t.tick < this.mg.config().targetDuration(),
      )
      .map((t) => t.target);
  }

  transitiveTargets(): Player[] {
    const ts = this.alliances()
      .map((a) => a.other(this))
      .flatMap((ally) => ally.targets());
    ts.push(...this.targets());
    return [...new Set(ts)] satisfies Player[];
  }

  sendEmoji(recipient: Player | typeof AllPlayers, emoji: string): void {
    if (recipient === this) {
      throw Error(`Cannot send emoji to oneself: ${this}`);
    }
    const msg: EmojiMessage = {
      message: emoji,
      senderID: this.smallID(),
      recipientID: recipient === AllPlayers ? recipient : recipient.smallID(),
      createdAt: this.mg.ticks(),
    };
    this.outgoingEmojis_.push(msg);
    this.mg.sendEmojiUpdate(msg);
  }

  outgoingEmojis(): EmojiMessage[] {
    return this.outgoingEmojis_
      .filter(
        (e) =>
          this.mg.ticks() - e.createdAt <
          this.mg.config().emojiMessageDuration(),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  canSendEmoji(recipient: Player | typeof AllPlayers): boolean {
    if (recipient === this) {
      return false;
    }
    const recipientID =
      recipient === AllPlayers ? AllPlayers : recipient.smallID();
    const prevMsgs = this.outgoingEmojis_.filter(
      (msg) => msg.recipientID === recipientID,
    );
    for (const msg of prevMsgs) {
      if (
        this.mg.ticks() - msg.createdAt <
        this.mg.config().emojiMessageCooldown()
      ) {
        return false;
      }
    }
    return true;
  }

  canSendQuickChat(recipient: Player): boolean {
    if (recipient === this) {
      return false;
    }
    const lastSentAt = this.outgoingQuickChats_.get(recipient.smallID());
    return (
      lastSentAt === undefined ||
      this.mg.ticks() - lastSentAt >= this.mg.config().quickChatCooldown()
    );
  }

  recordQuickChat(recipient: Player): void {
    this.outgoingQuickChats_.set(recipient.smallID(), this.mg.ticks());
  }

  canDonateGold(recipient: Player): boolean {
    if (recipient === this) {
      return false;
    }
    if (
      !this.isAlive() ||
      !recipient.isAlive() ||
      !this.isFriendly(recipient)
    ) {
      return false;
    }
    if (
      recipient.type() === PlayerType.Human &&
      this.mg.config().donateGold() === false
    ) {
      return false;
    }
    for (const donation of this.sentDonations) {
      if (donation.recipient === recipient) {
        if (
          this.mg.ticks() - donation.tick <
          this.mg.config().donateCooldown()
        ) {
          return false;
        }
      }
    }
    return true;
  }

  canDonateTroops(recipient: Player): boolean {
    if (recipient === this) {
      return false;
    }
    if (
      !this.isAlive() ||
      !recipient.isAlive() ||
      !this.isFriendly(recipient)
    ) {
      return false;
    }
    if (
      recipient.type() === PlayerType.Human &&
      this.mg.config().donateTroops() === false
    ) {
      return false;
    }
    for (const donation of this.sentDonations) {
      if (donation.recipient === recipient) {
        if (
          this.mg.ticks() - donation.tick <
          this.mg.config().donateCooldown()
        ) {
          return false;
        }
      }
    }
    return true;
  }

  donateTroops(recipient: Player, troops: number): boolean {
    // Defense-in-depth: canDonateTroops already checks this, but guard here too
    // to prevent self-donation if the method is called directly.
    if (recipient === this) return false;
    if (troops <= 0) return false;
    const removed = this.removeTroops(troops);
    if (removed === 0) return false;
    recipient.addTroops(removed);

    this.sentDonations.push(new Donation(recipient, this.mg.ticks()));
    this.mg.addUpdate({
      type: GameUpdateType.DonateEvent,
      donationType: "troops",
      senderId: this.id(),
      recipientId: recipient.id(),
      amount: BigInt(removed),
    });
    return true;
  }

  donateGold(recipient: Player, gold: Gold): boolean {
    // Defense-in-depth: canDonateGold already checks this, but guard here too
    // to prevent self-donation if the method is called directly.
    if (recipient === this) return false;
    if (gold <= 0n) return false;
    const removed = this.removeGold(gold);
    if (removed === 0n) return false;
    recipient.addGold(removed);

    this.sentDonations.push(new Donation(recipient, this.mg.ticks()));
    this.mg.addUpdate({
      type: GameUpdateType.DonateEvent,
      donationType: "gold",
      senderId: this.id(),
      recipientId: recipient.id(),
      amount: removed,
    });
    return true;
  }

  canDeleteUnit(): boolean {
    return (
      this.mg.ticks() - this.lastDeleteUnitTick >=
      this.mg.config().deleteUnitCooldown()
    );
  }

  recordDeleteUnit(): void {
    this.lastDeleteUnitTick = this.mg.ticks();
  }

  canEmbargoAll(): boolean {
    // Cooldown gate
    if (
      this.mg.ticks() - this.lastEmbargoAllTick <
      this.mg.config().embargoAllCooldown()
    ) {
      return false;
    }
    // At least one eligible player exists
    for (const p of this.mg.players()) {
      if (p.id() === this.id()) continue;
      if (p.type() === PlayerType.Bot) continue;
      if (this.isOnSameTeam(p)) continue;
      return true;
    }
    return false;
  }

  recordEmbargoAll(): void {
    this.lastEmbargoAllTick = this.mg.ticks();
  }

  hasEmbargoAgainst(other: Player): boolean {
    return this.embargoes.has(other.id());
  }

  canTrade(other: Player): boolean {
    const embargo =
      other.hasEmbargoAgainst(this) || this.hasEmbargoAgainst(other);
    return !embargo && other.id() !== this.id();
  }

  getEmbargoes(): Embargo[] {
    return [...this.embargoes.values()];
  }

  addEmbargo(other: Player, isTemporary: boolean): void {
    const embargo = this.embargoes.get(other.id());
    if (embargo !== undefined && !embargo.isTemporary) return;

    this.mg.addUpdate({
      type: GameUpdateType.EmbargoEvent,
      event: "start",
      playerID: this.smallID(),
      embargoedID: other.smallID(),
    });

    this.embargoes.set(other.id(), {
      createdAt: this.mg.ticks(),
      isTemporary: isTemporary,
      target: other,
    });
  }

  stopEmbargo(other: Player): void {
    this.embargoes.delete(other.id());
    this.mg.addUpdate({
      type: GameUpdateType.EmbargoEvent,
      event: "stop",
      playerID: this.smallID(),
      embargoedID: other.smallID(),
    });
  }

  endTemporaryEmbargo(other: Player): void {
    const embargo = this.embargoes.get(other.id());
    if (embargo !== undefined && !embargo.isTemporary) return;

    this.stopEmbargo(other);
  }

  tradingPartners(): Player[] {
    return this.mg
      .players()
      .filter((other) => other !== this && this.canTrade(other));
  }

  team(): Team | null {
    return this._team;
  }

  isOnSameTeam(other: Player): boolean {
    if (other === this) {
      return false;
    }
    if (this.team() === null || other.team() === null) {
      return false;
    }
    if (this.team() === ColoredTeams.Bot || other.team() === ColoredTeams.Bot) {
      return false;
    }
    return this._team === other.team();
  }

  isFriendly(other: Player, treatAFKFriendly: boolean = false): boolean {
    if (other === this) {
      return true;
    }
    // terron: ОЛИМПИЙСКИЕ ИГРЫ — на время всемирного мира ВСЕ ВСЕМ ДРУЗЬЯ:
    // корабли не стреляют, ПВО не целит, десант/дроны не летят (гейты по
    // isFriendly во всех боевых экзекуциях). Ракеты — отдельный путь, летят.
    if (this.mg.truceActive()) return true;
    if (other.isDisconnected() && !treatAFKFriendly) {
      return false;
    }
    return this.isOnSameTeam(other) || this.isAlliedWith(other);
  }

  gold(): Gold {
    return this._gold;
  }

  addGold(toAdd: Gold, tile?: TileRef): void {
    this._gold += toAdd;
    if (tile) {
      this.mg.addUpdate({
        type: GameUpdateType.BonusEvent,
        player: this.id(),
        tile,
        gold: Number(toAdd),
        troops: 0,
      });
    }
  }

  removeGold(toRemove: Gold): Gold {
    if (toRemove <= 0n) {
      return 0n;
    }
    const actualRemoved = minInt(this._gold, toRemove);
    this._gold -= actualRemoved;
    return actualRemoved;
  }

  troops(): number {
    return Number(this._troops);
  }

  addTroops(troops: number): void {
    if (troops < 0) {
      this.removeTroops(-1 * troops);
      return;
    }
    this._troops += toInt(troops);
  }
  removeTroops(troops: number): number {
    if (troops <= 0) {
      return 0;
    }
    const toRemove = minInt(this._troops, toInt(troops));
    this._troops -= toRemove;
    return Number(toRemove);
  }

  captureUnit(unit: Unit): void {
    if (unit.owner() === this) {
      throw new Error(`Cannot capture unit, ${this} already owns ${unit}`);
    }
    unit.setOwner(this);
  }

  buildUnit<T extends UnitType>(
    type: T,
    spawnTile: TileRef,
    params: UnitParams<T>,
  ): Unit {
    if (this.mg.config().isUnitDisabled(type)) {
      throw new Error(
        `Attempted to build disabled unit ${type} at tile ${spawnTile} by player ${this.name()}`,
      );
    }
    // terron: ПИРАТСТВО — отметка покупки пиратской лодки (перезарядка 15с).
    if (type === UnitType.Warship && this.hasUltimate(UnitType.Piracy)) {
      this._lastPirateShipTick = this.mg.ticks();
    }
    // terron: ультимейты — первое успешное использование (пуск МИРВ / закладка
    // ульт-здания) фиксирует выбор НАВСЕГДА до конца матча. canBuild выше уже
    // отсёк чужие ульты. Спека: new-units/ULTIMATES.md
    if (Ultimates.has(type) && this._ultimateChoice === null) {
      this._ultimateChoice = type;
      // Статистика пиков/винрейта ульт (только люди; /balance).
      this.mg.stats().ultimateChosen(this, type);
    }

    let cost = this.mg.unitInfo(type).cost(this.mg, this);
    // terron 23.08 (решение владельца): КОСМОДРОМ в океане стоит ВДВОЕ дороже
    // (10M против 5M на суше) и отдаёт вдвое чаще. Надбавка живёт ЗДЕСЬ, а не
    // в Config.unitInfo, потому что цена там не знает тайла, а «дорого» —
    // свойство МЕСТА, а не типа. SPACE.md
    if (type === UnitType.Spaceport && this.mg.isOcean(spawnTile)) {
      cost *= BigInt(TERRON_SPACEPORT_SEA_COST_MULT);
    }
    const b = new UnitImpl(
      type,
      this.mg,
      spawnTile,
      this.mg.nextUnitID(),
      this,
      params,
    );
    // Учёт ульт-здания (свои + захваченные — track/untrack в UnitImpl). Все ульты
    // теперь ЗДАНИЯ (МИРВ выведен из Ultimates — его разблокирует Ядерный завод).
    if (Ultimates.has(type)) {
      this.trackUltBuilding(b);
    }
    this._units.push(b);
    this.recordUnitConstructed(type);
    this.removeGold(cost);
    this.removeTroops("troops" in params ? (params.troops ?? 0) : 0);
    this.mg.addUpdate(b.toUpdate());
    this.mg.addUnit(b);

    return b;
  }

  public findUnitToUpgrade(type: UnitType, targetTile: TileRef): Unit | false {
    const unit = this.findExistingUnitToUpgrade(type, targetTile);
    if (unit === false || !this.canUpgradeUnit(unit)) {
      return false;
    }
    return unit;
  }

  private findExistingUnitToUpgrade(
    type: UnitType,
    targetTile: TileRef,
  ): Unit | false {
    // terron: ульт-здания «одно на игрока» (Укрепления) — апгрейд МАГНИТИТ на
    // единственное здание из ЛЮБОЙ точки: не нужно точно целиться в тайл (удобно
    // и на телефоне — навёл камеру, апнул). new-units/ULTIMATES.md
    if (type === UnitType.Fortifications) {
      return (
        this._units.find((u) => u.type() === type && u.isActive()) ?? false
      );
    }
    const closest = findClosestBy(
      this.mg.nearbyUnits(
        targetTile,
        this.mg.config().structureMinDist(),
        type,
        undefined,
        true,
      ),
      (entry) => entry.distSquared,
    );

    return closest?.unit ?? false;
  }

  private canBuildUnitType(
    unitType: UnitType,
    knownCost: Gold | null = null,
    // terron: апгрейд «поверх» существующего ульт-здания (форты) — это НЕ
    // постройка второго, поэтому лимит «одно на игрока» тут не применяем.
    isUpgrade = false,
  ): boolean {
    if (this.mg.config().isUnitDisabled(unitType)) {
      return false;
    }
    // terron: ЗЕЛЁНЫЕ — ядерное оружие недоступно ВООБЩЕ, пока штаб стоит
    // (решение владельца 23.08: «пока я зелёный нельзя ничо»). Гейт по
    // hasUltimate, а не по ultimateChoice, — значит и ЗАХВАЧЕННЫЕ у врага шахты
    // не стреляют: запрет нельзя обойти завоеванием. Снесли штаб — в тот же
    // тик всё возвращается. Дрон-камикадзе НЕ ядерный и остаётся доступен.
    // new-units/GREEN.md
    if (Nukes.has(unitType) && this.hasUltimate(UnitType.Greens)) {
      return false;
    }
    // terron: активки, разблокируемые зданием-ультой (Раскол←МЕДИА, МИРВ←Ядерный
    // завод) — общий гейт из реестра CAST_UNLOCKED_BY (Game.ts): требуется живое
    // здание И что оно — ТВОЙ выбор ульты (захваченное чужое здание даёт только
    // пассивку, активку не подменяем). МИРВ-нюанс: завод выключен в лобби (ульты
    // off) → гейт снят, МИРВ работает как в оригинале (только силос). ULTIMATES.md
    const castUnlock = CAST_UNLOCKED_BY[unitType];
    if (
      castUnlock !== undefined &&
      !(
        castUnlock.skipGateWhenBuildingDisabled === true &&
        this.mg.config().isUnitDisabled(castUnlock.building)
      ) &&
      !(
        this._ultimateChoice === castUnlock.building &&
        this.hasUltimate(castUnlock.building)
      )
    ) {
      return false;
    }
    // terron: ультимейты — один выбор на матч. Если выбор зафиксирован
    // (первым использованием), другие ульты строить нельзя. new-units/ULTIMATES.md
    if (
      Ultimates.has(unitType) &&
      this._ultimateChoice !== null &&
      this._ultimateChoice !== unitType
    ) {
      return false;
    }
    // terron: лимит копий ульт-здания — из реестра ULT_MAX_COUNT (default 1,
    // Мин правды 2). Общий инвариант: следующая копия — только когда предыдущие
    // ДОСТРОЕНЫ (при maxCount=1 ветка недостижима). При апгрейде пропускаем —
    // качаем то самое единственное здание.
    if (!isUpgrade && Ultimates.has(unitType)) {
      const maxCount = ULT_MAX_COUNT[unitType] ?? 1;
      const same = this._units.filter((u) => u.type() === unitType);
      if (same.length >= maxCount) return false;
      if (same.length > 0 && same.some((u) => u.isUnderConstruction())) {
        return false;
      }
    }
    // terron: ПИРАТСТВО — перезарядка между покупками пиратских лодок (экономим
    // золото ценой времени; TerronTuning). Обычных кораблей не касается.
    if (
      unitType === UnitType.Warship &&
      this.hasUltimate(UnitType.Piracy) &&
      this._lastPirateShipTick !== null &&
      this.mg.ticks() - this._lastPirateShipTick <
        TERRON_PIRACY_SHIP_COOLDOWN_TICKS
    ) {
      return false;
    }
    // terron: ГОРДОСТЬ — «уже передышка» (повторный каст бесполезен; кулдауна
    // нет — платишь войсками). Нужны войска, чтобы было что тратить.
    if (unitType === UnitType.Respite) {
      if (this.mg.respiteActive(this)) return false;
      if (this.troops() < 100) return false;
    }
    // terron: ФАНАТИЗМ — террор жрёт войска: без них кастовать нечего.
    if (unitType === UnitType.Terror && this.troops() < 100) return false;
    // terron: ДВОРЕЦ НАЦИЙ — одна навязанная цель одновременно.
    if (unitType === UnitType.Pact && this.pactActive()) return false;
    // terron: ЗЕЛЁНЫЕ — одна жертва травли одновременно. GREEN.md
    if (unitType === UnitType.Catastrophe && this.catastropheActive()) {
      return false;
    }
    // terron: ТОПЛИВО — «Индустриальную революцию» нельзя стакать: пока у
    // владельца висит своя, новую он не запускает (решение владельца 23.08).
    if (
      unitType === UnitType.IndustrialRevolution &&
      this.industrialActive()
    ) {
      return false;
    }
    // terron: ОЛИМПИЙСКИЕ ИГРЫ — кулдаун и «уже мир».
    if (unitType === UnitType.Truce) {
      if (this.mg.truceActive()) return false;
      if (
        this._lastTruceTick !== null &&
        this.mg.ticks() - this._lastTruceTick < TERRON_TRUCE_COOLDOWN_TICKS
      ) {
        return false;
      }
    }
    // terron: «Сбить спутники» — одна ракета-носитель за раз (носитель
    // расходуется запуском, потом можно собирать следующую). Каст не в
    // Ultimates, поэтому общая ветка лимита копий его не ловит. NEBO.md
    if (
      unitType === UnitType.SatelliteStrike &&
      this._units.some((u) => u.type() === UnitType.SatelliteStrike)
    ) {
      return false;
    }
    const cost = knownCost ?? this.mg.unitInfo(unitType).cost(this.mg, this);
    if (this._gold < cost) {
      return false;
    }
    if (unitType !== UnitType.MIRVWarhead && !this.isAlive()) {
      return false;
    }
    return true;
  }

  private canUpgradeUnitType(unitType: UnitType): boolean {
    return Boolean(this.mg.config().unitInfo(unitType).upgradable);
  }

  private isUnitValidToUpgrade(unit: Unit): boolean {
    if (unit.isUnderConstruction()) {
      return false;
    }
    if (unit.isMarkedForDeletion()) {
      return false;
    }
    if (unit.owner() !== this) {
      return false;
    }
    return true;
  }

  public canUpgradeUnit(unit: Unit): boolean {
    if (!this.canUpgradeUnitType(unit.type())) {
      return false;
    }
    // terron: потолок уровня (форты = 3). Достигли — апгрейд недоступен.
    const maxLevel = this.mg.config().unitInfo(unit.type()).maxLevel;
    if (maxLevel !== undefined && unit.level() >= maxLevel) {
      return false;
    }
    if (!this.canBuildUnitType(unit.type(), null, true)) {
      return false;
    }
    if (!this.isUnitValidToUpgrade(unit)) {
      return false;
    }
    return true;
  }

  upgradeUnit(unit: Unit) {
    const cost = this.mg.unitInfo(unit.type()).cost(this.mg, this);
    this.removeGold(cost);
    unit.increaseLevel();
    this.recordUnitConstructed(unit.type());
  }

  public buildableUnits(
    tile: TileRef | null,
    units: readonly PlayerBuildableUnitType[] = PlayerBuildable.types,
  ): BuildableUnit[] {
    const mg = this.mg;
    const config = mg.config();
    const rail = mg.railNetwork();
    const inSpawnPhase = mg.inSpawnPhase();

    const validTiles =
      tile !== null && units.some((u) => Structures.has(u))
        ? this.validStructureSpawnTiles(tile)
        : [];

    const len = units.length;
    const result = new Array<BuildableUnit>(len);

    for (let i = 0; i < len; i++) {
      const u = units[i];

      const cost = config.unitInfo(u).cost(mg, this);
      let canUpgrade: number | false = false;
      let canBuild: TileRef | false = false;

      if (tile !== null && !inSpawnPhase) {
        // terron: АПГРЕЙД считаем НЕЗАВИСИМО от «можно ли построить новое» —
        // иначе ульт-здания «одно на игрока» (форты) никогда не апаются
        // (canBuildUnitType=false, когда штаб уже стоит). findUnitToUpgrade сам
        // проверяет уровень/золото/валидность. new-units/ULTIMATES.md
        if (this.canUpgradeUnitType(u)) {
          const upg = this.findUnitToUpgrade(u, tile);
          if (upg !== false) {
            canUpgrade = upg.id();
          }
        }
        // Постройка НОВОГО — под своим гейтом (лимиты, выбор ульты, золото).
        if (this.canBuildUnitType(u, cost)) {
          canBuild = this.canSpawnUnitType(u, tile, validTiles);
        }
      }

      const buildNew = canBuild !== false && canUpgrade === false;

      result[i] = {
        type: u,
        canBuild,
        canUpgrade,
        cost,
        overlappingRailroads: buildNew
          ? rail.overlappingRailroads(canBuild as TileRef)
          : [],
        ghostRailPaths: buildNew
          ? rail.computeGhostRailPaths(u, canBuild as TileRef)
          : [],
      };
    }

    return result;
  }

  canBuild(
    unitType: UnitType,
    targetTile: TileRef,
    validTiles: TileRef[] | null = null,
  ): TileRef | false {
    if (!this.canBuildUnitType(unitType)) {
      return false;
    }

    return this.canSpawnUnitType(unitType, targetTile, validTiles);
  }

  private canSpawnUnitType(
    unitType: UnitType,
    targetTile: TileRef,
    validTiles: TileRef[] | null,
  ): TileRef | false {
    // terron (18.07): ВСЕ структуры, кроме порта (portSpawn ниже), — сухопутные,
    // спавн един. Выводится из группы Structures (Game.ts): новый ульт-штаб /
    // сухопутное здание сюда вписывать НЕ надо. Раньше — 15 case руками.
    // terron: НЕФТЯНАЯ ВЫШКА — единственная структура, которая строится НА ВОДЕ
    // (океан). Разбираем ДО общей сухопутной ветки и игнорируем validTiles: их
    // считает validStructureSpawnTiles по СВОЕЙ СУШЕ, к вышке это неприменимо.
    if (unitType === UnitType.OilRig) {
      return this.oilRigSpawn(targetTile);
    }
    // terron: КОСМОДРОМ — ставится на СВОЕЙ суше ИЛИ в океане (по образцу
    // вышки, решение владельца 23.08). Морская площадка дороже и отдаёт
    // больше. Океанский случай разбираем тем же spawn-ом, что у вышки.
    if (unitType === UnitType.Spaceport && this.mg.isOcean(targetTile)) {
      return this.spaceportSeaSpawn(targetTile);
    }
    // terron: ДОРА — железнодорожное орудие ставится ТОЛЬКО НА РЕЛЬСЫ
    // (решение владельца 23.08). Это не придирка, а суть ульты: орудие ездит
    // по железной дороге, и «поставить его в чистом поле» означало бы, что
    // оно там навсегда и застряло. Рельсы прорастают между зданиями игрока,
    // так что место под Дору — следствие твоей застройки. new-units/DORA.md
    // terron 24.08 (решение владельца): ДЕПО СМЕРТИ ставится СТРОГО НА РЕЛЬСЫ,
    // как и Дора. Депо — это ворота в железнодорожную сеть: стоящее в стороне
    // от путей, оно не может выпустить состав, и игрок узнаёт об этом уже
    // после постройки. Правило и магнит — ОБЩИЕ с орудием (ниже одна ветка).
    if (unitType === UnitType.RailGun || unitType === UnitType.TrainDepot) {
      // ⚠️ СТРОГО НА РЕЛЬСАХ (решение владельца 23.08): тайл обязан САМ быть
      // рельсом. Первая версия звала `overlappingRailroads(tile).length > 0`, а
      // он возвращает рельсы В РАДИУСЕ СТАНЦИИ, то есть РЯДОМ, — орудие
      // вставало возле путей, к сети не подключалось и «разучивалось ездить».
      //
      // МАГНИТ — КАК У ОБЫЧНЫХ ЗДАНИЙ (уточнение владельца 23.08): здание при
      // наведении само встаёт туда, куда может; берём ТОТ ЖЕ список валидных
      // тайлов (своя земля, отсортирован по близости к курсору) и выбираем
      // первый, лежащий на рельсах. Попасть мышью в нитку шириной в тайл
      // невозможно, а «строго» не должно значить «попади пикселем».
      const onRail = (t: TileRef) =>
        this.mg.railNetwork().overlappingRailroads(t).includes(t);
      const tiles = validTiles ?? this.validStructureSpawnTiles(targetTile);
      const snapSquared = TERRON_RAILGUN_SNAP * TERRON_RAILGUN_SNAP;
      for (const t of tiles) {
        // Список отсортирован по расстоянию: как только вышли за радиус
        // магнита — дальше смотреть незачем (и не тратим запросы к сетке).
        if (this.mg.euclideanDistSquared(targetTile, t) > snapSquared) break;
        if (onRail(t)) return t;
      }
      return false;
    }
    // terron 23.08: ульта, объявившая `actsAs`, ставится ПО ПРАВИЛАМ ТОГО
    // ЗДАНИЯ, чем она является, — вместе с его магнитом. Раньше это был
    // отдельный if на Пиратство, и «портовость» приходилось вспоминать в
    // каждом месте отдельно. Теперь родство объявлено в реестре ОДИН раз.
    const actsAs = ULTIMATE_REGISTRY.find((u) => u.type === unitType)?.actsAs;
    if (actsAs === UnitType.Port) {
      return this.portSpawn(targetTile, validTiles);
    }
    if (Structures.has(unitType) && unitType !== UnitType.Port) {
      return this.landBasedStructureSpawn(targetTile, validTiles);
    }
    switch (unitType) {
      case UnitType.MIRV:
        if (!this.mg.hasOwner(targetTile)) {
          return false;
        }
        return this.nukeSpawn(targetTile, unitType);
      // terron: ультимейты — Раскол наводится на ЧУЖУЮ (принадлежащую игроку)
      // страну; «спавн» = сам целевой тайл (юнит не строится). Валидацию
      // «свой/союзник» делает SplitExecution.
      case UnitType.Split:
        if (!this.mg.owner(targetTile).isPlayer()) {
          return false;
        }
        return targetTile;
      // terron: «Сбить спутники» — каст-ракета Неба нашего: НЕ структура
      // (канон кастов), но ставится как сухопутное здание на своей земле —
      // носитель 60с собирается и сносибелен (телеграф). NEBO.md
      case UnitType.SatelliteStrike:
        return this.landBasedStructureSpawn(targetTile, validTiles);
      // terron: «Передышка» (каст Гордости) — цели нет, любой валидный тайл;
      // юнит не строится. Truce (заготовка ООН) кастовать нельзя.
      case UnitType.Respite:
        return targetTile;
      // terron: «Олимпийские игры» (каст Стадиона) — цели нет, любой тайл.
      case UnitType.Truce:
        return targetTile;
      // terron: «Террор» (каст Фанатизма) — цель: тайл ЧУЖОЙ страны (не своей,
      // не союзной), как у МИРВ.
      case UnitType.Terror: {
        const owner = this.mg.owner(targetTile);
        if (!owner.isPlayer()) return false;
        if (owner === this || this.isFriendly(owner as Player)) return false;
        return targetTile;
      }
      // terron: «Пакт» (каст Дворца наций) — цель: тайл ЖИВОГО ИГРОКА (не
      // нация, не свой, не союзник), по которому нет свежего пакта.
      case UnitType.Pact: {
        const owner = this.mg.owner(targetTile);
        if (!owner.isPlayer()) return false;
        const p = owner as Player;
        if (p === this || p.type() !== PlayerType.Human) return false;
        if (this.isAlliedWith(p) || this.pactBlocked(p)) return false;
        if (this.mg.config().disableAlliances()) return false;
        return targetTile;
      }
      // terron: «Это катастрофа!» (каст Зелёных) — цель: тайл ЛЮБОГО игрока,
      // включая нации и тех, кто не бомбил (решение владельца: «в любой стране
      // найдётся хуёвое производство»). Нельзя по себе и по тому, кого только
      // что травили. GREEN.md
      case UnitType.Catastrophe: {
        const owner = this.mg.owner(targetTile);
        if (!owner.isPlayer()) return false;
        const p = owner as Player;
        if (p === this) return false;
        if (this.catastropheBlocked(p)) return false;
        return targetTile;
      }
      // terron: «Индустриальная революция» (каст Топлива) — цель: тайл ЛЮБОГО
      // игрока, ВКЛЮЧАЯ СЕБЯ (решение владельца: «можно кидать и на себя, и на
      // других»). На страну, где революция уже идёт, второй раз нельзя.
      case UnitType.IndustrialRevolution: {
        const owner = this.mg.owner(targetTile);
        if (!owner.isPlayer()) return false;
        if ((owner as Player).industrialActive()) return false;
        return targetTile;
      }
      // terron: «Выстрел Доры» — цель: любая СУША. Радиус тут НЕ проверяем
      // намеренно: если цель далеко, орудие само поедет по рельсам. Требуется
      // только живое орудие. DORA.md
      case UnitType.RailGunShell: {
        if (!this.mg.isLand(targetTile)) return false;
        // terron 23.08: орудие обязано СТОЯТЬ НА РЕЛЬСАХ. Пути под ним могут
        // снести (дроном, ядеркой, потерей земли) — тогда оно никуда не едет,
        // и приказ стрелять принимать нельзя: деньги бы списались, а выстрела
        // не случилось. Пути восстановили — приказы снова проходят. DORA.md
        const gun = this.units(UnitType.RailGun).find(
          (u) =>
            u.isActive() &&
            !u.isUnderConstruction() &&
            this.mg.railNetwork().overlappingRailroads(u.tile()).includes(u.tile()),
        );
        return gun === undefined ? false : targetTile;
      }
      // terron: «Состав смерти» (каст Взрывных поездов) — цель: любая СУША;
      // доехать до неё состав может и не вплотную, он идёт к ближайшей точке
      // своих рельсов. Требуется живое депо. new-units/TRAINS.md
      // terron 24.08 (решение владельца «я указываю точку прибытия, и именно
      // туда эта хуета приезжает»): цель ОБЯЗАНА лежать на достижимых своих
      // рельсах. Раньше принималась любая суша, а состав ехал к ближайшей к
      // ней точке путей и рвал ТАМ — выглядело как «поехал не туда».
      //
      // ⚠️ Магнит тот же, что у Доры: попасть мышью в нитку шириной в тайл
      // невозможно, поэтому цель притягивается к ближайшему рельсу в радиусе
      // TERRON_RAILGUN_SNAP, а дальше него — честный отказ.
      case UnitType.DoomTrain: {
        if (!this.mg.isLand(targetTile)) return false;
        const depot = this.units(UnitType.TrainDepot).find(
          (u) => u.isActive() && !u.isUnderConstruction(),
        );
        if (depot === undefined) return false;
        // ⚠️ terron 24.08 — ЦЕЛЬ: ЛЮБАЯ ТОЧКА СЕТИ, НО С МАГНИТОМ.
        //
        // Предела ДАЛЬНОСТИ нет: сеть тянется через чужие страны, и состав
        // едет куда угодно по ней. Но и «подсунуть ближайшую точку» с другого
        // конца карты нельзя — тогда игрок не знает, где рванёт. Правило
        // владельца: рядом с рельсом — магнитим, далеко — запрещаем.
        // true = включая ЧУЖИЕ перегоны: состав едет по всей соединённой
        // сети, и гейт цели обязан считать так же, иначе интерфейс разрешит
        // то, чего сим не сделает (или наоборот).
        const reach = railTilesFrom(this.mg, this, depot.tile(), true);
        if (reach.has(targetTile)) return targetTile;
        const snapSquared =
          TERRON_TRAINS_TARGET_SNAP * TERRON_TRAINS_TARGET_SNAP;
        let best: TileRef | false = false;
        let bestD = Infinity;
        for (const t of reach) {
          const d = this.mg.euclideanDistSquared(t, targetTile);
          if (d < bestD && d <= snapSquared) {
            bestD = d;
            best = t;
          }
        }
        return best;
      }
      // terron: «Перенос» (каст Шагающего города) — ОБА клика (центр зоны и
      // точка назначения) валидируются одним правилом: СВОЯ суша. Гост
      // спрашивает это правило на каждый кадр, сим — на исполнении. WALKING.md
      case UnitType.CityTransfer: {
        if (!this.mg.isLand(targetTile)) return false;
        return this.mg.owner(targetTile) === this ? targetTile : false;
      }
      // terron: «Рекультивация» (каст АЭС) — цель: ЛЮБАЯ суша, своя или чужая,
      // согласия не спрашивают. Владелец тайла не важен: пепел лежит на
      // НИЧЕЙНОЙ земле, а «чей он был» хранится отдельно. NUCLEAR.md
      case UnitType.Recultivation: {
        if (!this.mg.isLand(targetTile)) return false;
        return targetTile;
      }
      // terron: «Блокада» (каст Пиратства) — точка в ОКЕАНЕ не дальше
      // TERRON_BLOCKADE_PORT_RANGE от ближайшего СВОЕГО порта/штаба; нужна
      // хотя бы одна пиратская лодка. Юнит не строится (лодки плывут сами).
      case UnitType.Blockade: {
        if (!this.mg.isOcean(targetTile)) return false;
        if (this.units(UnitType.Warship).length === 0) return false;
        const near = this.units(...TradeHubs.types).some(
          (h) =>
            h.isActive() &&
            !h.isUnderConstruction() &&
            this.mg.manhattanDist(h.tile(), targetTile) <=
              TERRON_BLOCKADE_PORT_RANGE,
        );
        return near ? targetTile : false;
      }
      // terron: ультимейты — «Реки вспять» (WaterNuke) пускается из той же
      // шахты, что и атомная: тот же кулдаун и та же очередь. ULTIMATES.md
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.WaterNuke:
        return this.nukeSpawn(targetTile, unitType);
      case UnitType.MIRVWarhead:
        return targetTile;
      case UnitType.Port:
        return this.portSpawn(targetTile, validTiles);
      case UnitType.Warship:
        return this.warshipSpawn(targetTile);
      case UnitType.Shell:
      case UnitType.SAMMissile:
        return targetTile;
      case UnitType.TransportShip: {
        // terron: ПИРАТСТВО — высадки ТОЛЬКО из портов (решение владельца 23.08):
        // обычный приказ «высадка» у пирата стартует из БЛИЖАЙШЕГО своего
        // порта/штаба (в том же водоёме, что и цель), а не с ближайшего берега.
        // Нет порта в этом водоёме → высадки нет. Все такие высадки — тихие.
        if (this.hasUltimate(UnitType.Piracy)) {
          const comp = this.mg.getWaterComponent(targetTile);
          const hub = findClosestBy(
            this.units(...TradeHubs.types),
            (h) => this.mg.manhattanDist(h.tile(), targetTile),
            (h) =>
              h.isActive() &&
              !h.isUnderConstruction() &&
              (comp === null ||
                this.mg.hasWaterComponent(h.tile(), comp) ||
                this.mg
                  .neighbors(h.tile())
                  .some((n) => this.mg.hasWaterComponent(n, comp))),
          );
          return hub?.tile() ?? false;
        }
        return canBuildTransportShip(this.mg, this, targetTile);
      }
      case UnitType.TradeShip:
        return this.tradeShipSpawn(targetTile);
      case UnitType.Airplane: // terron: авиация — спавн у аэропорта, летит по прямой
      case UnitType.AirborneAssault: // terron: авиация — десант, спавн у аэропорта
        return targetTile;
      case UnitType.SuicideDrone: // terron: авиация — дрон-камикадзе, требует аэропорт
        return this.droneSpawn(targetTile);
      case UnitType.Train:
        return this.landBasedUnitSpawn(targetTile);
      default:
        // Структуры разобраны ДО switch (ветка Structures.has выше) — сюда
        // может попасть только новый НЕ-структурный тип, забытый в switch.
        console.warn(`canSpawnUnitType: unhandled unit type ${unitType}`);
        return false;
    }
  }

  nukeSpawn(tile: TileRef, nukeType: UnitType): TileRef | false {
    const mg = this.mg;
    if (mg.isSpawnImmunityActive()) {
      return false;
    }
    const owner = this.mg.owner(tile);
    // Allow nuking teammates after the game is over (aftergame fun)
    const gameOver = mg.getWinner() !== null;
    if (owner.isPlayer()) {
      if (this.isOnSameTeam(owner) && !gameOver) {
        return false;
      }
    }
    const config = mg.config();

    // Prevent launching nukes that would hit teammate structures (only in team games).
    // Disabled after game-over so players can nuke teammates in the aftergame.
    if (
      config.gameConfig().gameMode === GameMode.Team &&
      nukeType !== UnitType.MIRV &&
      !gameOver
    ) {
      const magnitude = config.nukeMagnitudes(nukeType);
      const wouldHitTeammate = mg.anyUnitNearby(
        tile,
        magnitude.outer,
        Structures.types,
        (unit) => unit.owner().isPlayer() && this.isOnSameTeam(unit.owner()),
      );
      if (wouldHitTeammate) {
        return false;
      }
    }

    // only get missilesilos that are not on cooldown and not under construction
    const bestSilo = findClosestBy(
      this.units(UnitType.MissileSilo),
      (silo) => mg.manhattanDist(silo.tile(), tile),
      (silo) =>
        silo.isActive() && !silo.isInCooldown() && !silo.isUnderConstruction(),
    );

    return bestSilo?.tile() ?? false;
  }

  // terron: авиация — дрон-камикадзе бьёт в точку с ближайшего аэропорта. Правила цели те же,
  // что у ядерки (нельзя по своим/тиммейту до конца игры, не в spawn-immunity), плюс нужен
  // хотя бы один готовый свой аэропорт. Возвращает целевой тайл (спавн-точку ищет Execution).
  droneSpawn(tile: TileRef): TileRef | false {
    const mg = this.mg;
    if (mg.isSpawnImmunityActive()) {
      return false;
    }
    const gameOver = mg.getWinner() !== null;
    const owner = mg.owner(tile);
    if (owner.isPlayer() && this.isOnSameTeam(owner) && !gameOver) {
      return false;
    }
    // terron: нужен хотя бы один ГОТОВЫЙ аэропорт (не в кулдауне запуска дрона —
    // ровно как ядерке нужна готовая ракетная шахта, см. nukeSpawn). Пока все
    // аэропорты «перезаряжаются» после недавнего дрона — запуск недоступен.
    const hasReadyAirport = this.units(UnitType.Airport).some(
      (a) =>
        a.isActive() &&
        !a.isUnderConstruction() &&
        !a.isMarkedForDeletion() &&
        !a.isInCooldown(),
    );
    if (!hasReadyAirport) {
      return false;
    }
    return tile;
  }

  portSpawn(tile: TileRef, validTiles: TileRef[] | null): TileRef | false {
    const spawns = Array.from(
      this.mg.bfs(
        tile,
        manhattanDistFN(tile, this.mg.config().radiusPortSpawn()),
      ),
    )
      .filter((t) => this.mg.owner(t) === this && this.mg.isShore(t))
      .sort(
        (a, b) =>
          this.mg.manhattanDist(a, tile) - this.mg.manhattanDist(b, tile),
      );
    const validTileSet = new Set(
      validTiles ?? this.validStructureSpawnTiles(tile),
    );
    for (const t of spawns) {
      if (validTileSet.has(t)) {
        return t;
      }
    }
    return false;
  }

  // terron: НЕФТЯНАЯ ВЫШКА. Ставится в ОКЕАН (не река/озеро — там isLake),
  // не ближе structureMinDist к любой другой структуре (включая чужие вышки),
  // и — если поводок включён — не дальше TERRON_OILRIG_MAX_DIST_FROM_OWN от
  // СВОЕЙ земли (0 = поводка нет, решение владельца «где угодно на воде»).
  // Захватить вышку нельзя (у воды нет владельца) — см. TerronTuning §ВЫШКА.
  oilRigSpawn(tile: TileRef): TileRef | false {
    if (!this.mg.isOcean(tile)) {
      return false;
    }
    const minDist = this.mg.config().structureMinDist();
    const nearby = this.mg.nearbyUnits(
      tile,
      minDist,
      Structures.types,
      undefined,
      true,
    );
    if (nearby.length > 0) {
      return false;
    }
    // terron: вышка — МОРСКАЯ платформа: никакой суши в радиусе
    // TERRON_OILRIG_MIN_DIST_FROM_LAND (решение владельца 07.08 — «самая
    // простая проверка наличия земли в радиусе»). Иначе её ставили бы вплотную
    // к своему берегу, а это уже порт.
    const landGuard = this.mg.config().oilRigMinDistFromLand();
    if (landGuard > 0) {
      const cx = this.mg.x(tile);
      const cy = this.mg.y(tile);
      const r2 = landGuard * landGuard;
      for (let dy = -landGuard; dy <= landGuard; dy++) {
        for (let dx = -landGuard; dx <= landGuard; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!this.mg.isValidCoord(x, y)) continue;
          if (this.mg.isLand(this.mg.ref(x, y))) return false;
        }
      }
    }
    if (TERRON_OILRIG_MAX_DIST_FROM_OWN > 0) {
      const leash = TERRON_OILRIG_MAX_DIST_FROM_OWN;
      const nearOwnLand = Array.from(
        this.mg.bfs(tile, manhattanDistFN(tile, leash)),
      ).some((t) => this.mg.owner(t) === this);
      if (!nearOwnLand) return false;
    }
    return tile;
  }

  /**
   * terron 23.08 — МОРСКАЯ ПЛОЩАДКА КОСМОДРОМА.
   *
   * ⚠️ Сперва она ставилась ТЕМ ЖЕ spawn-ом, что нефтяная вышка, и «в океане
   * поставить не вышло» (репорт владельца). У вышки есть отдельный запрет:
   * НИ ОДНОГО тайла суши в радиусе `oilRigMinDistFromLand` — она морская
   * добыча, у берега это был бы порт. Для стартовой площадки такого смысла
   * нет: её ставят у своего побережья, и берег рядом — норма.
   *
   * Остаются два общих правила: не лепить здания вплотную друг к другу и не
   * уплывать далеко от своих владений (тот же поводок, что у вышки).
   */
  spaceportSeaSpawn(tile: TileRef): TileRef | false {
    if (!this.mg.isOcean(tile)) return false;
    const nearby = this.mg.nearbyUnits(
      tile,
      this.mg.config().structureMinDist(),
      Structures.types,
      undefined,
      true,
    );
    if (nearby.length > 0) return false;
    if (TERRON_OILRIG_MAX_DIST_FROM_OWN > 0) {
      const leash = TERRON_OILRIG_MAX_DIST_FROM_OWN;
      const nearOwn = Array.from(
        this.mg.bfs(tile, manhattanDistFN(tile, leash)),
      ).some((t) => this.mg.owner(t) === this);
      if (!nearOwn) return false;
    }
    return tile;
  }

  warshipSpawn(tile: TileRef): TileRef | false {
    if (!this.mg.isWater(tile)) {
      return false;
    }

    const tileComponent = this.mg.getWaterComponent(tile);
    // terron: штаб Пиратства — тоже порт: у него спавнятся корабли.
    const bestPort = findClosestBy(
      // Порты — включая ульты, объявившие себя портом (actingAs).
      this.units(...actingAs(UnitType.Port)),
      (port) => this.mg.manhattanDist(port.tile(), tile),
      (port) =>
        port.isActive() &&
        !port.isUnderConstruction() &&
        tileComponent !== null &&
        this.mg.hasWaterComponent(port.tile(), tileComponent),
    );

    if (bestPort === null) return false;
    // ⚠️ terron 23.08 — КОРАБЛЬ РОЖДАЕТСЯ НА ВОДЕ, А НЕ НА ПРИЧАЛЕ.
    //
    // Здесь возвращался тайл САМОГО ПОРТА, то есть СУША. Дальше корабль водит
    // водный пафайндер, а старт у него — сухопутный тайл: путь ищется по
    // мини-карте (вдвое грубее), и если клетка мини-карты под причалом
    // оказывается сушей, приведение к берегу не срабатывает — путь не найден,
    // цель сбрасывается, на следующем тике берётся новая, и так вечно.
    // Снаружи это выглядело как «корабли сидят внутри здания и не едут, хотя я
    // им сказал куда» (репорт владельца, три захода).
    //
    // Теперь спавним на ближайшей ВОДЕ у причала — в том же водоёме, что цель.
    const water = this.mg
      .neighbors(bestPort.tile())
      .filter(
        (t) =>
          this.mg.isWater(t) &&
          tileComponent !== null &&
          this.mg.hasWaterComponent(t, tileComponent),
      )
      .sort(
        (x, y) => this.mg.manhattanDist(x, tile) - this.mg.manhattanDist(y, tile),
      );
    return water[0] ?? bestPort.tile();
  }

  landBasedUnitSpawn(tile: TileRef): TileRef | false {
    return this.mg.isLand(tile) ? tile : false;
  }

  landBasedStructureSpawn(
    tile: TileRef,
    validTiles: TileRef[] | null = null,
  ): TileRef | false {
    const tiles = validTiles ?? this.validStructureSpawnTiles(tile);
    if (tiles.length === 0) {
      return false;
    }
    return tiles[0];
  }

  private validStructureSpawnTiles(tile: TileRef): TileRef[] {
    if (this.mg.owner(tile) !== this) {
      return [];
    }
    const searchRadius = 15;
    const searchRadiusSquared = searchRadius ** 2;

    const nearbyUnits = this.mg.nearbyUnits(
      tile,
      searchRadius * 2,
      Structures.types,
      undefined,
      true,
    );
    const nearbyTiles = this.mg.bfs(tile, (gm, t) => {
      return (
        this.mg.euclideanDistSquared(tile, t) < searchRadiusSquared &&
        gm.ownerID(t) === this.smallID()
      );
    });
    const validSet: Set<TileRef> = new Set(nearbyTiles);

    const minDistSquared = this.mg.config().structureMinDist() ** 2;
    for (const t of nearbyTiles) {
      for (const { unit } of nearbyUnits) {
        if (this.mg.euclideanDistSquared(unit.tile(), t) < minDistSquared) {
          validSet.delete(t);
          break;
        }
      }
    }
    const valid = Array.from(validSet);
    valid.sort(
      (a, b) =>
        this.mg.euclideanDistSquared(a, tile) -
        this.mg.euclideanDistSquared(b, tile),
    );
    return valid;
  }

  tradeShipSpawn(targetTile: TileRef): TileRef | false {
    return this.units(UnitType.Port).find((u) => u.tile() === targetTile)
      ? targetTile
      : false;
  }
  lastTileChange(): Tick {
    return this._lastTileChange;
  }

  isDisconnected(): boolean {
    return this._isDisconnected;
  }

  markDisconnected(isDisconnected: boolean): void {
    this._isDisconnected = isDisconnected;
  }

  hash(): number {
    return (
      simpleHash(this.id()) * (this.troops() + this.numTilesOwned()) +
      this._units.reduce((acc, unit) => acc + unit.hash(), 0)
    );
  }
  toString(): string {
    return `Player:{name:${this.info().name},clientID:${
      this.info().clientID
    },isAlive:${this.isAlive()},troops:${
      this._troops
    },numTileOwned:${this.numTilesOwned()}}]`;
  }

  public playerProfile(): PlayerProfile {
    const rel = {
      relations: Object.fromEntries(
        this.allRelationsSorted().map(({ player, relation }) => [
          player.smallID(),
          relation,
        ]),
      ),
      alliances: this.alliances().map((a) => a.other(this).smallID()),
    };
    return rel;
  }

  createAttack(
    target: Player | TerraNullius,
    troops: number,
    sourceTile: TileRef | null,
    border: Set<number>,
  ): Attack {
    const attack = new AttackImpl(
      this._pseudo_random.nextID(),
      target,
      this,
      troops,
      sourceTile,
      border,
      this.mg,
    );
    this._outgoingAttacks.push(attack);
    if (target.isPlayer()) {
      const victim = target as PlayerImpl;
      victim._incomingAttacks.push(attack);
      // terron: РЕВАНШИЗМ — фиксируем, кто кого тронул первым.
      if (victim !== this) {
        if (!this._firstStrikeAt.has(victim.smallID())) {
          this._firstStrikeAt.set(victim.smallID(), this.mg.ticks());
        }
        // Жертва помечает меня обидчиком, ЕСЛИ сама не била первой.
        if (!victim._firstStrikeAt.has(this.smallID())) {
          victim._aggressors.add(this.smallID());
          victim._aggressorsArr = null;
        }
      }
    }
    return attack;
  }
  // terron: РЕВАНШИЗМ — напал ли `other` на меня ПЕРВЫМ (я его до этого не
  // трогал). Знание живёт независимо от штаба; бонус применяет Config.attackLogic
  // только при живой статуе. TerronTuning §РЕВАНШИЗМ.
  wasAttackedFirstBy(other: Player): boolean {
    return this._aggressors.has(other.smallID());
  }

  /** terron: кто напал на меня первым (smallID). Ховер статуи + будущая
   *  статистика «атакуемость». Порядок = порядок нападений. */
  aggressors(): number[] {
    return [...this._aggressors];
  }

  /** terron: на кого ПЕРВЫМ напал Я (smallID). Вторая половина той же пары —
   *  для будущей статистики «агрессивность». Пишется в createAttack. */
  firstStrikes(): number[] {
    return [...this._firstStrikeAt.keys()];
  }

  outgoingAttacks(): Attack[] {
    return this._outgoingAttacks;
  }
  incomingAttacks(): Attack[] {
    return this._incomingAttacks.filter((a) => a.attacker().isAlive());
  }

  public isImmune(): boolean {
    if (this.type() === PlayerType.Human) {
      return this.mg.isSpawnImmunityActive();
    }
    if (this.type() === PlayerType.Nation) {
      return this.mg.isNationSpawnImmunityActive();
    }
    return false;
  }

  public canAttackPlayer(
    player: Player,
    treatAFKFriendly: boolean = false,
  ): boolean {
    // terron: ОЛИМПИЙСКИЕ ИГРЫ — всемирное перемирие: никто никого не атакует.
    if (this.mg.truceActive()) return false;
    // terron: ГОРДОСТЬ — «Передышка»: мир вокруг кастера (его не атакуют, он
    // не атакует). Суша/десант/авиадесант идут через этот гейт; ракеты — нет.
    if (this.mg.respiteActive(this) || this.mg.respiteActive(player)) {
      return false;
    }
    if (this.type() === PlayerType.Bot) {
      // Bots are not affected by immunity
      return !this.isFriendly(player, treatAFKFriendly);
    }
    // Humans and Nations respect immunity
    return !player.isImmune() && !this.isFriendly(player, treatAFKFriendly);
  }

  public canAttack(tile: TileRef): boolean {
    const owner = this.mg.owner(tile);
    if (owner === this) {
      return false;
    }

    if (owner.isPlayer() && !this.canAttackPlayer(owner)) {
      return false;
    }

    if (!this.mg.isLand(tile)) {
      return false;
    }
    if (this.mg.hasOwner(tile)) {
      return this.sharesBorderWith(owner);
    } else {
      for (const t of this.mg.bfs(
        tile,
        andFN(
          (gm, t) => !gm.hasOwner(t) && gm.isLand(t),
          manhattanDistFN(tile, 200),
        ),
      )) {
        for (const n of this.mg.neighbors(t)) {
          if (this.mg.owner(n) === this) {
            return true;
          }
        }
      }
      return false;
    }
  }

  bestTransportShipSpawn(targetTile: TileRef): TileRef | false {
    return bestShoreDeploymentSource(this.mg, this, targetTile) ?? false;
  }
}

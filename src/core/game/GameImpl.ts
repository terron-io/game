import { renderNumber } from "../../client/Utils";
import { Config } from "../configuration/Config";
import {
  TERRON_GREENS_DEBUFF_MAX_STACKS,
  TERRON_GREENS_NUKE_WEIGHT,
 TERRON_PEACE_TRAITOR_TICKS } from "../configuration/TerronTuning";
import { SharedWaterCache } from "../execution/nation/SharedWaterCache";
import { AbstractGraph } from "../pathfinding/algorithms/AbstractGraph";
import { PathFinder } from "../pathfinding/types";
import { AllPlayersStats, ClientID, Winner } from "../Schemas";
import { ATTACK_INDEX_SENT } from "../StatsSchemas";
import { simpleHash } from "../Util";
import { AllianceImpl } from "./AllianceImpl";
import { AllianceRequestImpl } from "./AllianceRequestImpl";
import { blockadeFlagSize, inBlockadeFlag } from "./BlockadeGeometry";
import {
  Alliance,
  AllianceRequest,
  Blockade,
  Cell,
  ColoredTeams,
  Duos,
  EmojiMessage,
  Execution,
  Game,
  GameMode,
  GameUpdates,
  HumansVsNations,
  MessageType,
  MutableAlliance,
  Nation,
  Player,
  PlayerID,
  PlayerInfo,
  PlayerType,
  Quads,
  SatelliteBlackout,
  SpawnArea,
  Team,
  TeamGameSpawnAreas,
  TerrainType,
  TerraNullius,
  Trios,
  ULTIMATE_REGISTRY,
  Unit,
  UnitInfo,
  UnitType,
} from "./Game";
import { GameMap, TileRef } from "./GameMap";
import { GameUpdate, GameUpdateType } from "./GameUpdates";
import { UnitView } from "./GameView";
import { MotionPlanRecord, packMotionPlans } from "./MotionPlans";
import { PlayerImpl } from "./PlayerImpl";
import { RailNetwork } from "./RailNetwork";
import { createRailNetwork } from "./RailNetworkImpl";
import { Stats } from "./Stats";
import { StatsImpl } from "./StatsImpl";
import { assignTeams } from "./TeamAssignment";
import { TerraNulliusImpl } from "./TerraNulliusImpl";
import { UnitGrid, UnitPredicate } from "./UnitGrid";
import { WaterManager } from "./WaterManager";

export function createGame(
  humans: PlayerInfo[],
  nations: Nation[],
  gameMap: GameMap,
  miniGameMap: GameMap,
  config: Config,
  teamGameSpawnAreas?: TeamGameSpawnAreas,
): Game {
  const stats = new StatsImpl();
  return new GameImpl(
    humans,
    nations,
    gameMap,
    miniGameMap,
    config,
    stats,
    teamGameSpawnAreas,
  );
}

export type CellString = string;

import { GreenInspectionExecution } from "../execution/GreenInspectionExecution";

export class GameImpl implements Game {
  private _ticks = 0;
  private startTick: number | null = null;
  // terron: «Небо наше» — активный блэкаут спутников (для реакций ботов).
  private _satBlackout: SatelliteBlackout | null = null;

  private unInitExecs: Execution[] = [];

  _players: Map<PlayerID, PlayerImpl> = new Map<PlayerID, PlayerImpl>();
  _playersBySmallID: Player[] = [];

  private execs: Execution[] = [];
  private _width: number;
  private _height: number;
  _terraNullius: TerraNulliusImpl;

  allianceRequests: AllianceRequestImpl[] = [];

  private nextPlayerID = 1;
  private _nextUnitID = 1;

  private updates: GameUpdates = createGameUpdatesMap();
  private tileUpdatePairs: number[] = [];
  // terron: скины пепла — пары [tileRef, smallID бомбившего] за тик. Чисто
  // видовые данные (в hash не входят, симуляцию не читают) — уезжают в
  // GameUpdateViewData.packedFalloutOwners.
  private falloutOwnerPairs: number[] = [];
  private motionPlanRecords: MotionPlanRecord[] = [];
  private planDrivenUnitIds = new Set<number>();
  private unitGrid: UnitGrid;
  private _unitMap = new Map<number, Unit>();

  private playerTeams: Team[] = [];
  private botTeam: Team = ColoredTeams.Bot;
  private _railNetwork: RailNetwork = createRailNetwork(this);

  // Used to assign unique IDs to each new alliance
  private nextAllianceID: number = 0;

  private _isPaused: boolean = false;
  private _winner: Player | Team | null = null;
  private _waterManager: WaterManager;
  private _sharedWaterCache: SharedWaterCache;
  private _teamGameSpawnAreas: TeamGameSpawnAreas | undefined;

  constructor(
    private _humans: PlayerInfo[],
    private _nations: Nation[],
    private _map: GameMap,
    private miniGameMap: GameMap,
    private _config: Config,
    private _stats: Stats,
    teamGameSpawnAreas?: TeamGameSpawnAreas,
  ) {
    const constructorStart = performance.now();

    this._teamGameSpawnAreas = teamGameSpawnAreas;
    this._terraNullius = new TerraNulliusImpl();
    this._width = _map.width();
    this._height = _map.height();
    this.unitGrid = new UnitGrid(this._map);
    this._waterManager = new WaterManager(
      this._map,
      this.miniGameMap,
      _config.disableNavMesh(),
    );
    this._sharedWaterCache = new SharedWaterCache(this);

    if (_config.gameConfig().gameMode === GameMode.Team) {
      this.populateTeams();
    }
    this.addPlayers();

    console.log(
      `[GameImpl] Constructor total: ${(performance.now() - constructorStart).toFixed(0)}ms`,
    );
  }

  private populateTeams() {
    let numPlayerTeams = this._config.playerTeams();

    // HumansVsNations mode always has exactly 2 teams
    if (numPlayerTeams === HumansVsNations) {
      this.playerTeams = [ColoredTeams.Humans, ColoredTeams.Nations];
      return;
    }

    if (typeof numPlayerTeams !== "number") {
      const players = this._humans.length + this._nations.length;
      switch (numPlayerTeams) {
        case Duos:
          numPlayerTeams = Math.ceil(players / 2);
          break;
        case Trios:
          numPlayerTeams = Math.ceil(players / 3);
          break;
        case Quads:
          numPlayerTeams = Math.ceil(players / 4);
          break;
        default:
          throw new Error(`Unknown TeamCountConfig ${numPlayerTeams}`);
      }
    }
    if (numPlayerTeams < 2) {
      throw new Error(`Too few teams: ${numPlayerTeams}`);
    } else if (numPlayerTeams < 8) {
      this.playerTeams = [ColoredTeams.Red, ColoredTeams.Blue];
      if (numPlayerTeams >= 3) this.playerTeams.push(ColoredTeams.Yellow);
      if (numPlayerTeams >= 4) this.playerTeams.push(ColoredTeams.Green);
      if (numPlayerTeams >= 5) this.playerTeams.push(ColoredTeams.Purple);
      if (numPlayerTeams >= 6) this.playerTeams.push(ColoredTeams.Orange);
      if (numPlayerTeams >= 7) this.playerTeams.push(ColoredTeams.Teal);
    } else {
      this.playerTeams = [];
      for (let i = 1; i <= numPlayerTeams; i++) {
        this.playerTeams.push(`Team ${i}`);
      }
    }
  }

  private addPlayers() {
    if (this.config().gameConfig().gameMode === GameMode.FFA) {
      this._humans.forEach((p) => this.addPlayer(p));
      this._nations.forEach((n) => this.addPlayer(n.playerInfo));
      return;
    }

    if (this._config.playerTeams() === HumansVsNations) {
      this._humans.forEach((p) => this.addPlayer(p, ColoredTeams.Humans));
      this._nations.forEach((n) =>
        this.addPlayer(n.playerInfo, ColoredTeams.Nations),
      );
      return;
    }

    // Team mode
    const allPlayers = [
      ...this._humans,
      ...this._nations.map((n) => n.playerInfo),
    ];
    const playerToTeam = assignTeams(allPlayers, this.playerTeams);
    for (const [playerInfo, team] of playerToTeam.entries()) {
      if (team === "kicked") {
        console.warn(`Player ${playerInfo.name} was kicked from team`);
        continue;
      }
      this.addPlayer(playerInfo, team);
    }
  }

  isOnEdgeOfMap(ref: TileRef): boolean {
    return this._map.isOnEdgeOfMap(ref);
  }

  owner(ref: TileRef): Player | TerraNullius {
    return this.playerBySmallID(this.ownerID(ref));
  }

  playerBySmallID(id: number): Player | TerraNullius {
    if (id === 0) {
      return this.terraNullius();
    }
    return this._playersBySmallID[id - 1];
  }
  map(): GameMap {
    return this._map;
  }
  miniMap(): GameMap {
    return this.miniGameMap;
  }

  addUpdate(update: GameUpdate) {
    (this.updates[update.type] as GameUpdate[]).push(update);
  }

  nextUnitID(): number {
    const old = this._nextUnitID;
    this._nextUnitID++;
    return old;
  }

  // terron: «чья была земля» под каждым тайлом пепла (TileRef → smallID).
  // Разреженная карта: записи только у горящих тайлов и стираются вместе с
  // пеплом, так что после уборки/захвата память возвращается. GREEN.md
  private readonly _falloutPrevOwner = new Map<TileRef, number>();

  setFallout(
    tile: TileRef,
    value: boolean,
    falloutOwner?: number,
    // terron: ЧЬЯ БЫЛА ЗЕМЛЯ до взрыва (smallID). Пепел в движке лежит ТОЛЬКО
    // на ничейных тайлах (см. throw ниже) — «пепла в моих границах» не бывает
    // физически, поэтому «свой пепел» приходится помнить отдельно. Нужно
    // Зелёным (озеленение) и АЭС (кому выставлять счёт за уборку).
    // ⚠️ В ОТЛИЧИЕ от falloutOwnerPairs (чисто видовые, в hash не входят) это
    // ДАННЫЕ СИМА: по ним начисляется золото. Детерминизм держится тем, что
    // пишется оно из симуляции, одинаково на всех клиентах. GREEN.md
    prevOwner?: number,
  ) {
    if (value && this.hasOwner(tile)) {
      throw Error(`cannot set fallout, tile ${tile} has owner`);
    }
    if (this._map.hasFallout(tile)) {
      // Пепел уже есть → атрибуция «кто первый сжёг» сохраняется (ранний
      // выход не даёт перезаписать владельца) — одинаково у всех клиентов.
      return;
    }
    this._map.setFallout(tile, value);
    if (value) {
      if (falloutOwner) {
        this.falloutOwnerPairs.push(tile, falloutOwner & 0xfff);
      }
      if (prevOwner) this._falloutPrevOwner.set(tile, prevOwner);
    } else {
      this._falloutPrevOwner.delete(tile);
    }
    this.recordTileUpdate(tile);
  }

  /**
   * terron: чья земля была под этим пеплом до взрыва (0 — ничья/неизвестно).
   * Запись живёт ровно пока лежит пепел: снятие пепла (захват, вода, уборка)
   * стирает её. GREEN.md
   */
  /**
   * terron: ЗЕЛЁНЫЕ — возмездие за детонацию (new-units/GREEN.md). Зовётся из
   * NukeExecution ПОСЛЕ успешного взрыва: перехваченная ракета сюда не
   * доходит, поэтому «сбили — штрафа нет» выходит само.
   *
   * Вес по типу (решение владельца 23.08): обычная 1, водородная 2,
   * водяная 0 (затопление экологически чисто). Боеголовка МИРВ считается за 1,
   * а «МИРВ = 3 события» получается из ограничения ниже: к одному виновнику от
   * одного штаба одновременно летит не больше MAX_STACKS бортов. Так не нужно
   * тащить связь «боеголовка → её МИРВ», а десять боеголовок не поднимают
   * десять самолётов — потолок штрафа всё равно три ступени.
   *
   * Штраф встаёт НЕ здесь, а по прилёту борта (GreenInspectionExecution):
   * окно ответа — успеть снести штаб Зелёных, пока он летит.
   */
  reportNukeDetonation(culprit: Player, tile: TileRef, type: UnitType): void {
    const steps = TERRON_GREENS_NUKE_WEIGHT[type as string] ?? 0;
    if (steps <= 0) return;
    for (const hq of this.units(UnitType.Greens)) {
      if (hq.isUnderConstruction() || !hq.isActive()) continue;
      const greens = hq.owner();
      if (!greens.isAlive()) continue;
      // Сам себя Зелёные не штрафуют: ядерок у них нет по определению, но
      // ульту можно ЗАХВАТИТЬ, и тогда пассив достался бы бомбящему.
      if (greens === culprit) continue;
      const inFlight = this.units(UnitType.GreenInspection).filter(
        (u) =>
          u.owner() === greens &&
          u.culpritSmallID() === culprit.smallID(),
      ).length;
      if (inFlight >= TERRON_GREENS_DEBUFF_MAX_STACKS) continue;
      this.addExecution(
        new GreenInspectionExecution(greens, hq.tile(), tile, culprit, steps),
      );
    }
  }

  falloutPrevOwner(tile: TileRef): number {
    return this._falloutPrevOwner.get(tile) ?? 0;
  }

  /**
   * terron: снять пепел с ничейного тайла (озеленение Зелёных, рекультивация
   * АЭС). Возвращает прежнего владельца земли (0 — ничья), чтобы вызывающий
   * решил, кому платить. Тайл остаётся ничейным — территорию это не даёт.
   */
  clearFallout(tile: TileRef): number {
    if (!this._map.hasFallout(tile)) return 0;
    const prev = this._falloutPrevOwner.get(tile) ?? 0;
    this._map.setFallout(tile, false);
    this._falloutPrevOwner.delete(tile);
    this.recordTileUpdate(tile);
    return prev;
  }

  setWater(tile: TileRef): void {
    if (!this.isLand(tile)) return;
    if (this.hasOwner(tile)) {
      throw Error(`cannot set water, tile ${tile} has owner`);
    }
    // Clear fallout if present (water tiles shouldn't have fallout)
    if (this._map.hasFallout(tile)) {
      this._map.setFallout(tile, false);
    }
    this._map.setWater(tile);
    this.recordTileUpdate(tile);
  }

  // terron: ультимейты — «Реки вспять». Апстримовский путь «суша → вода» был
  // завязан ТОЛЬКО на флаг лобби waterNukes (мод «водяные ядерки»). Наша ульта
  // включает его ПОТИПНО: force=true приходит от ракеты WaterNuke и топит землю
  // независимо от настроек лобби. Всё остальное (очередь, пересчёт берегов,
  // мини-карты и водного графа) — уже готовый WaterManager. TerronTuning.
  queueWaterConversion(
    tile: TileRef,
    force = false,
    falloutOwner?: number,
    prevOwner?: number,
  ): void {
    if (!this.isLand(tile)) return;
    if (this.hasOwner(tile)) {
      throw Error(`cannot queue water conversion, tile ${tile} has owner`);
    }
    if (!force && !this._config.waterNukes()) {
      this.setFallout(tile, true, falloutOwner, prevOwner);
      return;
    }
    this._waterManager.queueTile(tile);
  }

  unit(id: number): Unit | undefined {
    return this._unitMap.get(id);
  }

  /**
   * Все юниты игры указанных типов (без типов — вообще все).
   *
   * terron ПЕРФ (08.08): раньше тело было
   *   `Array.from(this._players.values()).flatMap((p) => p.units(...types))`
   * и аллоцировало на КАЖДЫЙ вызов: массив всех игроков, плюс rest-массив
   * `types` и результирующий массив на КАЖДОГО игрока, плюс итог flatMap.
   * А зовётся это в горячем цикле: `NationWarshipBehavior` каждый тик просит
   * список всех транспортов — и делает это КАЖДАЯ нация с портом. К середине
   * матча порт есть почти у всех, поэтому при сотне наций набегало порядка ста
   * тысяч аллокаций массивов за тик, и это при том, что `_players` НИКОГДА не
   * чистится от мёртвых (см. B2/B3 в журнале аудита).
   *
   * Теперь — один проход и ОДИН результирующий массив.
   *
   * ⚠️ ДЕТЕРМИНИЗМ. Порядок обхода сохранён ДОСЛОВНО: игроки в порядке вставки
   * в `_players`, внутри игрока — в порядке его `_units`. Это ровно то, что
   * давал flatMap, и на этот порядок опирается симуляция (например, выбор цели
   * «первый подходящий»). Кэшировать результат НЕЛЬЗЯ: юниты создаются и
   * умирают ВНУТРИ тика, а смена владельца правит `_units` игроков напрямую,
   * минуя addUnit/removeUnit — устаревший список поменял бы поведение.
   */
  units(...types: UnitType[]): Unit[] {
    const out: Unit[] = [];
    if (types.length === 0) {
      for (const p of this._players.values()) {
        const us = p.units();
        for (let i = 0; i < us.length; i++) out.push(us[i]);
      }
      return out;
    }
    if (types.length === 1) {
      const t0 = types[0];
      for (const p of this._players.values()) {
        const us = p.units();
        for (let i = 0; i < us.length; i++) {
          if (us[i].type() === t0) out.push(us[i]);
        }
      }
      return out;
    }
    const wanted = new Set(types);
    for (const p of this._players.values()) {
      const us = p.units();
      for (let i = 0; i < us.length; i++) {
        if (wanted.has(us[i].type())) out.push(us[i]);
      }
    }
    return out;
  }

  unitCount(type: UnitType): number {
    let total = 0;
    for (const player of this._players.values()) {
      total += player.unitCount(type);
    }
    return total;
  }

  unitInfo(type: UnitType): UnitInfo {
    return this.config().unitInfo(type);
  }

  nations(): Nation[] {
    return this._nations;
  }

  createAllianceRequest(
    requestor: Player,
    recipient: Player,
  ): AllianceRequest | null {
    if (requestor.isAlliedWith(recipient)) {
      console.log("cannot request alliance, already allied");
      return null;
    }
    if (
      recipient
        .incomingAllianceRequests()
        .find((ar) => ar.requestor() === requestor) !== undefined
    ) {
      console.log(`duplicate alliance request from ${requestor.name()}`);
      return null;
    }
    const correspondingReq = requestor
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === recipient);
    if (correspondingReq !== undefined) {
      console.log(`got corresponding alliance requests, accepting`);
      correspondingReq.accept();
      return null;
    }
    const ar = new AllianceRequestImpl(requestor, recipient, this._ticks, this);
    this.allianceRequests.push(ar);
    this.addUpdate(ar.toUpdate());
    return ar;
  }

  acceptAllianceRequest(request: AllianceRequestImpl) {
    this.allianceRequests = this.allianceRequests.filter(
      (ar) => ar !== request,
    );

    const requestor = request.requestor();
    const recipient = request.recipient();

    const existing = requestor.allianceWith(recipient);
    if (existing) {
      throw new Error(
        `cannot accept alliance request, already allied with ${recipient.name()}`,
      );
    }

    // Create and register the new alliance
    const alliance = new AllianceImpl(
      this,
      requestor as PlayerImpl,
      recipient as PlayerImpl,
      this._ticks,
      this.nextAllianceID++,
    );
    (alliance.requestor() as PlayerImpl)._alliances.push(alliance);
    (alliance.recipient() as PlayerImpl)._alliances.push(alliance);
    // terron: учёт союзов по типу союзника (пишется у людей; у ботов нет
    // clientID/статов → no-op). Для статистики и ачивок «Друг племени/нации».
    this.stats().alliance(requestor, recipient);
    this.stats().alliance(recipient, requestor);
    (request.requestor() as PlayerImpl).pastOutgoingAllianceRequests.push(
      request,
    );

    this.addUpdate({
      type: GameUpdateType.AllianceRequestReply,
      request: request.toUpdate(),
      accepted: true,
    });
  }

  rejectAllianceRequest(request: AllianceRequestImpl) {
    this.allianceRequests = this.allianceRequests.filter(
      (ar) => ar !== request,
    );
    (request.requestor() as PlayerImpl).pastOutgoingAllianceRequests.push(
      request,
    );
    this.addUpdate({
      type: GameUpdateType.AllianceRequestReply,
      request: request.toUpdate(),
      accepted: false,
    });
  }

  hasPlayer(id: PlayerID): boolean {
    return this._players.has(id);
  }
  config(): Config {
    return this._config;
  }

  isPaused(): boolean {
    return this._isPaused;
  }

  setPaused(paused: boolean): void {
    this._isPaused = paused;
    this.addUpdate({ type: GameUpdateType.GamePaused, paused });
  }

  inSpawnPhase(): boolean {
    return this.startTick === null;
  }

  // terron: «Небо наше» — состояние блэкаута спутников (детерминированно,
  // ставится из SatelliteStrikeExecution при запуске ракеты). new-units/NEBO.md
  // terron: ПИРАТСТВО — зоны блокады «флаг» (каст «Блокада»).
  private _blockades: Blockade[] = [];
  private _blockadeVersion = 0;
  private _nextBlockadeId = 1;
  private emitBlockade(b: Blockade): void {
    this.addUpdate({
      type: GameUpdateType.Blockade,
      id: b.id,
      ownerSmallID: b.ownerSmallID,
      tile: b.tile,
      hh: b.hh,
      hw: b.hw,
      ships: b.ships,
      expiresAt: b.expiresAt,
      pending: b.pending,
    });
  }
  nextBlockadeId(): number {
    return this._nextBlockadeId++;
  }
  addBlockade(b: Blockade): void {
    this._blockades.push(b);
    this._blockadeVersion++;
    this.emitBlockade(b);
  }
  updateBlockade(
    id: number,
    ships: number,
    expiresAt: number,
    pending = false,
  ): void {
    const b = this._blockades.find((x) => x.id === id);
    if (!b) return;
    const sameSize = b.ships === ships && b.pending === pending;
    b.expiresAt = expiresAt;
    b.pending = pending;
    if (sameSize) {
      // Размер прежний, но время жизни сдвинулось — клиенту нужен отсчёт.
      this.emitBlockade(b);
      return;
    }
    const size = blockadeFlagSize(ships);
    b.ships = ships;
    const grew = size.hh !== b.hh || size.hw !== b.hw;
    b.hh = size.hh;
    b.hw = size.hw;
    // Версию (= пересборка ВСЕХ водных путей) бампаем только если зона
    // реально изменила размер, а не на каждую прибывшую лодку.
    if (grew) this._blockadeVersion++;
    this.emitBlockade(b);
  }
  removeBlockade(id: number): void {
    const b = this._blockades.find((x) => x.id === id);
    if (!b) return;
    this._blockades = this._blockades.filter((x) => x.id !== id);
    this._blockadeVersion++;
    this.emitBlockade({ ...b, ships: 0, hh: 0, hw: 0 });
  }
  blockades(): readonly Blockade[] {
    return this._blockades;
  }
  blockadeVersion(): number {
    return this._blockadeVersion;
  }
  /**
   * terron 23.08: ЗАЯВЛЕННАЯ зона (лодки ещё в пути) — только рисунок. Она
   * никого не ловит и ни для кого не блокада, пока не собран первый корпус.
   * Гейт стоит ЗДЕСЬ, в одной точке, а не в каждом вызывающем.
   */
  private blockadeAppliesTo_pendingGuard(b: Blockade): boolean {
    return !b.pending;
  }

  private blockadeAppliesTo(b: Blockade, player: Player): boolean {
    if (!this.blockadeAppliesTo_pendingGuard(b)) return false;
    if (b.ownerSmallID === player.smallID()) return false;
    const owner = this.playerBySmallID(b.ownerSmallID);
    if (!owner.isPlayer()) return true;
    return !player.isFriendly(owner as Player);
  }
  /**
   * ⚠️ terron 23.08 — ГОРЯЧИЙ ПУТЬ. Это зовётся на КАЖДЫЙ ШАГ КАЖДОЙ лодки на
   * карте, пока на карте есть хоть одна зона блокады (репорт владельца:
   * «падение симуляции до 0 ... особенно ПОСЛЕ формирования»). Раньше здесь
   * сразу считалась форма флага — с синусом внутри — для каждой зоны.
   *
   * Теперь: сперва ДЕШЁВЫЙ прямоугольник (зона всегда внутри hh×hw), и только
   * попав в него, считаем настоящую волнистую кромку.
   */
  isBlockadedFor(tile: TileRef, player: Player): boolean {
    if (this._blockades.length === 0) return false;
    const x = this.x(tile);
    const y = this.y(tile);
    for (const b of this._blockades) {
      const dx = x - this.x(b.tile);
      if (dx < -b.hw || dx > b.hw) continue;
      const dy = y - this.y(b.tile);
      if (dy < -b.hh - 2 || dy > b.hh + 2) continue;
      if (!this.blockadeAppliesTo(b, player)) continue;
      if (inBlockadeFlag(dx, dy, b.hh, b.hw)) return true;
    }
    return false;
  }
  blockadeIdsFor(player: Player): number[] {
    const out: number[] = [];
    for (const b of this._blockades) {
      if (this.blockadeAppliesTo(b, player)) out.push(b.id);
    }
    return out;
  }
  blockadedMiniTilesFor(player: Player): Set<TileRef> {
    const out = new Set<TileRef>();
    const mini = this.miniGameMap;
    for (const b of this._blockades) {
      if (!this.blockadeAppliesTo(b, player)) continue;
      const cx = Math.floor(this.x(b.tile) / 2);
      const cy = Math.floor(this.y(b.tile) / 2);
      const hh = Math.ceil(b.hh / 2) + 1;
      const hw = Math.ceil(b.hw / 2) + 1;
      for (let dy = -hh; dy <= hh; dy++) {
        for (let dx = -hw; dx <= hw; dx++) {
          const mx = cx + dx;
          const my = cy + dy;
          if (!mini.isValidCoord(mx, my)) continue;
          if (inBlockadeFlag(dx * 2, dy * 2, b.hh, b.hw))
            out.add(mini.ref(mx, my));
        }
      }
    }
    return out;
  }

  // terron: ГОРДОСТЬ — фактор отставания от лидера по территории среди ЖИВЫХ.
  prideFactor(player: Player): number {
    let leader = 0;
    for (const p of this._players.values()) {
      if (!p.isAlive()) continue;
      const n = p.numTilesOwned();
      if (n > leader) leader = n;
    }
    if (leader <= 0) return 0;
    const k = 1 - player.numTilesOwned() / leader;
    return Math.max(0, Math.min(1, k));
  }

  // terron: ГОРДОСТЬ — всемирное перемирие.
  private _truceUntil = 0;
  declareTruce(owner: Player, untilTick: number): void {
    this._truceUntil = Math.max(this._truceUntil, untilTick);
    // Все текущие атаки МЕЖДУ игроками отзываются (войска возвращаются).
    for (const p of this._players.values()) {
      for (const a of p.outgoingAttacks()) {
        if (a.target().isPlayer() && !a.retreating()) a.orderRetreat();
      }
    }
    this.displayMessage(
      "events_display.olympics_declared",
      MessageType.TRUCE,
      null,
      undefined,
      { name: owner.displayName() },
    );
  }
  truceActive(): boolean {
    return this._ticks < this._truceUntil;
  }
  // terron: ГОРДОСТЬ — «Передышка»: мир вокруг кастера.
  private _respiteUntil = new Map<number, number>();
  declareRespite(player: Player, untilTick: number): void {
    this._respiteUntil.set(player.smallID(), untilTick);
    // Атаки к нему и от него — отозвать (войска возвращаются).
    for (const a of player.outgoingAttacks()) {
      if (a.target().isPlayer() && !a.retreating()) a.orderRetreat();
    }
    for (const a of player.incomingAttacks()) {
      if (!a.retreating()) a.orderRetreat();
    }
    this.displayMessage(
      "events_display.respite_declared",
      MessageType.TRUCE,
      null,
      undefined,
      { name: player.displayName() },
    );
  }
  respiteActive(player: Player): boolean {
    const u = this._respiteUntil.get(player.smallID());
    return u !== undefined && this._ticks < u;
  }
  truceUntil(): number {
    return this._truceUntil;
  }

  setSatelliteBlackout(b: SatelliteBlackout | null): void {
    this._satBlackout = b;
  }

  satelliteBlackout(): SatelliteBlackout | null {
    return this._satBlackout;
  }

  satelliteBlackoutActive(): boolean {
    const b = this._satBlackout;
    if (b === null) return false;
    return this._ticks >= b.blastTick && this._ticks < b.endTick;
  }

  satelliteBlackoutBlinds(player: Player): boolean {
    if (!this.satelliteBlackoutActive()) return false;
    const b = this._satBlackout!;
    if (player.smallID() === b.ownerSmallID) return false;
    // Team-режим: команда владельца щадится (как на клиенте, решение 11.07).
    const owner = this.playerBySmallID(b.ownerSmallID);
    if (owner !== undefined && owner.isPlayer()) {
      const ownerPlayer = owner as Player;
      const team = player.team();
      if (team !== null && ownerPlayer.team() === team) return false;
    }
    return true;
  }

  endSpawnPhase(): void {
    if (this.startTick !== null) {
      return;
    }
    this.startTick = this._ticks;
    this.addUpdate({
      type: GameUpdateType.SpawnPhaseEnd,
      startTick: this.startTick,
    });
  }

  ticks(): number {
    return this._ticks;
  }

  executeNextTick(): GameUpdates {
    this.updates = createGameUpdatesMap();
    this.tileUpdatePairs.length = 0;
    this.execs.forEach((e) => {
      if (
        (!this.inSpawnPhase() || e.activeDuringSpawnPhase()) &&
        e.isActive()
      ) {
        e.tick(this._ticks);
      }
    });
    const inited: Execution[] = [];
    const unInited: Execution[] = [];
    this.unInitExecs.forEach((e) => {
      if (!this.inSpawnPhase() || e.activeDuringSpawnPhase()) {
        e.init(this, this._ticks);
        inited.push(e);
      } else {
        unInited.push(e);
      }
    });

    this.removeInactiveExecutions();

    this.execs.push(...inited);
    this.unInitExecs = unInited;
    for (const player of this._players.values()) {
      const update = player.toUpdate();
      if (update !== null) this.addUpdate(update);
    }
    if (this.ticks() % 10 === 0) {
      this.addUpdate({
        type: GameUpdateType.Hash,
        tick: this.ticks(),
        hash: this.hash(),
      });
      // terron: ГОРДОСТЬ — ключ «Феникс»: доля карты у людей раз в секунду
      // (пик/провал в stats.peakPct/dipPct, сотые процента).
      const land = this.numLandTiles();
      if (land > 0) {
        for (const p of this._players.values()) {
          if (p.type() !== PlayerType.Human || !p.isAlive()) continue;
          this._stats.territory(
            p,
            Math.round((p.numTilesOwned() / land) * 10_000),
          );
          // terron: ТОПЛИВО — ключ «Нефтяник»: пик одновременно стоящих
          // вышек. Считаем тут же, чтобы не заводить второй проход по
          // игрокам ради одного числа. FUEL.md
          this._stats.oilRigs(
            p,
            p.units(UnitType.OilRig).filter((u) => !u.isUnderConstruction())
              .length,
          );
          // terron 24.08: ТОПЛИВНАЯ ЦЕПОЧКА — ключ Топлива: пик СУММЫ УРОВНЕЙ
          // фабрик («100 фабрик одновременно, либо 100 лвл — суммируется любой
          // формат», решение владельца). Депо смерти весит как 5 фабрик —
          // тем же actsAsCount, что и везде.
          let factorySum = 0;
          for (const u of p.units(UnitType.Factory)) {
            if (!u.isUnderConstruction()) factorySum += u.level();
          }
          for (const reg of ULTIMATE_REGISTRY) {
            if (reg.actsAs !== UnitType.Factory) continue;
            for (const u of p.units(reg.type)) {
              if (!u.isUnderConstruction())
                factorySum += reg.actsAsCount ?? 1;
            }
          }
          this._stats.factoryLevels(p, factorySum);
        }
      }
    }
    // Flush pending water conversions + throttled graph rebuild
    const waterChangedTiles = this._waterManager.tick(this._ticks);
    for (const tile of waterChangedTiles) {
      this.recordTileUpdate(tile);
    }
    this._ticks++;
    return this.updates;
  }

  private recordTileUpdate(tile: TileRef): void {
    // Low 16 bits: tile state, bits 16-23: terrain byte
    this.tileUpdatePairs.push(
      tile,
      (this._map.tileState(tile) & 0xffff) |
        (this._map.terrainByte(tile) << 16),
    );
  }

  drainPackedTileUpdates(): Uint32Array {
    const pairs = this.tileUpdatePairs;
    const packed = new Uint32Array(pairs.length);
    for (let i = 0; i < pairs.length; i++) {
      packed[i] = pairs[i];
    }
    pairs.length = 0;
    return packed;
  }

  // terron: скины пепла — null, когда за тик взрывов не было (поле в посылке
  // тогда просто отсутствует, transfer не платится).
  drainPackedFalloutOwners(): Uint32Array | null {
    const pairs = this.falloutOwnerPairs;
    if (pairs.length === 0) return null;
    const packed = new Uint32Array(pairs.length);
    for (let i = 0; i < pairs.length; i++) {
      packed[i] = pairs[i];
    }
    pairs.length = 0;
    return packed;
  }

  recordMotionPlan(record: MotionPlanRecord): void {
    switch (record.kind) {
      case "grid":
        this.planDrivenUnitIds.add(record.unitId);
        break;
      case "train":
        this.planDrivenUnitIds.add(record.engineUnitId);
        for (const unitId of record.carUnitIds) {
          this.planDrivenUnitIds.add(unitId);
        }
        break;
    }
    this.motionPlanRecords.push(record);
  }

  private isUnitPlanDriven(unitId: number): boolean {
    return this.planDrivenUnitIds.has(unitId);
  }

  maybeAddUnitUpdate(unit: Unit): void {
    if (!this.isUnitPlanDriven(unit.id())) {
      this.addUpdate(unit.toUpdate());
    }
  }

  onUnitMoved(unit: Unit): void {
    this.updateUnitTile(unit);
    this.maybeAddUnitUpdate(unit);
  }

  drainPackedMotionPlans(): Uint32Array | null {
    const records = this.motionPlanRecords;
    if (records.length === 0) {
      return null;
    }
    const packed = packMotionPlans(records);
    records.length = 0;
    return packed;
  }

  private hash(): number {
    let hash = 1;
    this._players.forEach((p) => {
      hash += p.hash();
    });
    return hash;
  }

  terraNullius(): TerraNullius {
    return this._terraNullius;
  }

  removeInactiveExecutions(): void {
    const activeExecs: Execution[] = [];
    for (const exec of this.execs) {
      if (this.inSpawnPhase()) {
        if (exec.activeDuringSpawnPhase()) {
          if (exec.isActive()) {
            activeExecs.push(exec);
          }
        } else {
          activeExecs.push(exec);
        }
      } else {
        if (exec.isActive()) {
          activeExecs.push(exec);
        }
      }
    }
    this.execs = activeExecs;
  }

  players(): Player[] {
    return Array.from(this._players.values()).filter((p) => p.isAlive());
  }

  allPlayers(): Player[] {
    return Array.from(this._players.values());
  }

  executions(): Execution[] {
    return [...this.execs, ...this.unInitExecs];
  }

  addExecution(...exec: Execution[]) {
    this.unInitExecs.push(...exec);
  }

  removeExecution(exec: Execution) {
    this.execs = this.execs.filter((execution) => execution !== exec);
    this.unInitExecs = this.unInitExecs.filter(
      (execution) => execution !== exec,
    );
  }

  playerView(id: PlayerID): Player {
    return this.player(id);
  }

  addPlayer(playerInfo: PlayerInfo, team: Team | null = null): Player {
    const player = new PlayerImpl(
      this,
      this.nextPlayerID,
      playerInfo,
      this.config().startManpower(playerInfo),
      team ?? this.maybeAssignTeam(playerInfo),
    );
    this._playersBySmallID.push(player);
    this.nextPlayerID++;
    this._players.set(playerInfo.id, player);
    return player;
  }

  private maybeAssignTeam(player: PlayerInfo): Team | null {
    if (this._config.gameConfig().gameMode !== GameMode.Team) {
      return null;
    }
    if (player.playerType === PlayerType.Bot) {
      return this.botTeam;
    }
    const rand = simpleHash(player.id);
    return this.playerTeams[rand % this.playerTeams.length];
  }

  player(id: PlayerID): Player {
    const player = this._players.get(id);
    if (player === undefined) {
      throw new Error(`Player with id ${id} not found`);
    }
    return player;
  }

  playerByClientID(id: ClientID): Player | null {
    for (const [, player] of this._players) {
      if (player.clientID() === id) {
        return player;
      }
    }
    return null;
  }

  isOnMap(cell: Cell): boolean {
    return (
      cell.x >= 0 &&
      cell.x < this._width &&
      cell.y >= 0 &&
      cell.y < this._height
    );
  }

  neighborsWithDiag(tile: TileRef): TileRef[] {
    const x = this.x(tile);
    const y = this.y(tile);
    const ns: TileRef[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue; // Skip the center tile
        const newX = x + dx;
        const newY = y + dy;
        if (
          newX >= 0 &&
          newX < this._width &&
          newY >= 0 &&
          newY < this._height
        ) {
          ns.push(this._map.ref(newX, newY));
        }
      }
    }
    return ns;
  }

  // Zero-allocation neighbor iteration for performance-critical code
  forEachNeighborWithDiag(
    tile: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void {
    const x = this.x(tile);
    const y = this.y(tile);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue; // Skip the center tile
        const newX = x + dx;
        const newY = y + dy;
        if (
          newX >= 0 &&
          newX < this._width &&
          newY >= 0 &&
          newY < this._height
        ) {
          callback(this._map.ref(newX, newY));
        }
      }
    }
  }

  conquer(owner: PlayerImpl, tile: TileRef): void {
    if (!this.isLand(tile)) {
      throw Error(`cannot conquer water`);
    }
    const previousOwner = this.owner(tile) as TerraNullius | PlayerImpl;
    if (previousOwner.isPlayer()) {
      previousOwner._lastTileChange = this._ticks;
      previousOwner._tiles.delete(tile);
      previousOwner._borderTiles.delete(tile);
      // вклад захватчика в «съедение» этого игрока — для пропорционального дележа
      // золота за завоевание (conquerPlayer)
      const sid = owner.smallID();
      previousOwner._tilesLostTo.set(
        sid,
        (previousOwner._tilesLostTo.get(sid) ?? 0) + 1,
      );
    }
    this._map.setOwnerID(tile, owner.smallID());
    owner._tiles.add(tile);
    owner._lastTileChange = this._ticks;
    this.updateBorders(tile);
    this._map.setFallout(tile, false);
    this._falloutPrevOwner.delete(tile);
    this.recordTileUpdate(tile);
  }

  relinquish(tile: TileRef) {
    if (!this.hasOwner(tile)) {
      throw new Error(`Cannot relinquish tile because it is unowned`);
    }
    if (this.isWater(tile)) {
      throw new Error("Cannot relinquish water");
    }

    const previousOwner = this.owner(tile) as PlayerImpl;
    previousOwner._lastTileChange = this._ticks;
    previousOwner._tiles.delete(tile);
    previousOwner._borderTiles.delete(tile);

    this._map.setOwnerID(tile, 0);
    this.updateBorders(tile);
    this.recordTileUpdate(tile);
  }

  private updateBorders(tile: TileRef) {
    const updateBorderStatus = (t: TileRef) => {
      if (!this.hasOwner(t)) {
        return;
      }
      const owner = this.owner(t) as PlayerImpl;
      if (this.calcIsBorder(t)) {
        owner._borderTiles.add(t);
      } else {
        owner._borderTiles.delete(t);
      }
    };

    updateBorderStatus(tile);
    this.forEachNeighbor(tile, updateBorderStatus);
  }

  private calcIsBorder(tile: TileRef): boolean {
    if (!this.hasOwner(tile)) {
      return false;
    }
    const ownerId = this.ownerID(tile);
    const x = this.x(tile);
    const y = this.y(tile);
    if (x > 0 && this.ownerID(this._map.ref(x - 1, y)) !== ownerId) {
      return true;
    }
    if (
      x + 1 < this._width &&
      this.ownerID(this._map.ref(x + 1, y)) !== ownerId
    ) {
      return true;
    }
    if (y > 0 && this.ownerID(this._map.ref(x, y - 1)) !== ownerId) {
      return true;
    }
    if (
      y + 1 < this._height &&
      this.ownerID(this._map.ref(x, y + 1)) !== ownerId
    ) {
      return true;
    }
    return false;
  }

  target(targeter: Player, target: Player) {
    this.addUpdate({
      type: GameUpdateType.TargetPlayer,
      playerID: targeter.smallID(),
      targetID: target.smallID(),
    });
  }

  public breakAlliance(breaker: Player, alliance: MutableAlliance) {
    let other: Player;
    if (alliance.requestor() === breaker) {
      other = alliance.recipient();
    } else {
      other = alliance.requestor();
    }
    if (!breaker.isAlliedWith(other)) {
      throw new Error(
        `${breaker} not allied with ${other}, cannot break alliance`,
      );
    }
    // terron: ультимейты — МЕДИА: «наши действия оправданы» → предательство НЕ
    // карается меткой предателя, пока штаб МЕДИА жив. new-units/ULTIMATES.md
    if (
      !other.isTraitor() &&
      !other.isDisconnected() &&
      !breaker.hasUltimate(UnitType.Media)
    ) {
      // terron: ДВОРЕЦ НАЦИЙ — вероломство против владельца стоит вдвое
      // дольше (метка ГЛОБАЛЬНАЯ — минуту предателя едят все). PEACE.md
      breaker.markTraitor(
        other.hasUltimate(UnitType.PeacePalace)
          ? TERRON_PEACE_TRAITOR_TICKS
          : undefined,
      );
      // terron: ДВОРЕЦ НАЦИЙ — ключ ульты «Преданный»: считаем, сколько раз
      // предали МЕНЯ (только настоящие предательства — те же условия, что метка).
      this.stats().betrayed(other);
    }

    this.detachAlliance(alliance);

    this.addUpdate({
      type: GameUpdateType.BrokeAlliance,
      traitorID: breaker.smallID(),
      betrayedID: other.smallID(),
      allianceID: alliance.id(),
    });
  }

  public expireAlliance(alliance: Alliance) {
    const p1Set = new Set(alliance.recipient().alliances());
    const alliances = alliance
      .requestor()
      .alliances()
      .filter((a) => p1Set.has(a));
    if (alliances.length !== 1) {
      throw new Error(
        `cannot expire alliance: must have exactly one alliance, have ${alliances.length}`,
      );
    }
    this.detachAlliance(alliances[0]);
    this.addUpdate({
      type: GameUpdateType.AllianceExpired,
      player1ID: alliance.requestor().smallID(),
      player2ID: alliance.recipient().smallID(),
    });
  }

  public removeAlliancesByPlayerSilently(player: Player): void {
    // Snapshot — detachAlliance reassigns the player's _alliances as it goes.
    const removed = [...(player as PlayerImpl)._alliances];
    for (const alliance of removed) this.detachAlliance(alliance);
  }

  /** Remove an alliance from both participants' per-player alliance lists. */
  private detachAlliance(alliance: Alliance): void {
    const requestor = alliance.requestor() as PlayerImpl;
    const recipient = alliance.recipient() as PlayerImpl;
    requestor._alliances = requestor._alliances.filter((a) => a !== alliance);
    recipient._alliances = recipient._alliances.filter((a) => a !== alliance);
  }

  public isSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this.config().spawnImmunityDuration()
    );
  }

  public elapsedGameSeconds(): number {
    return this.ticksSinceStart() / 10;
  }

  public isNationSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this.config().nationSpawnImmunityDuration()
    );
  }

  private ticksSinceStart(): number {
    if (this.inSpawnPhase()) {
      return 0;
    }

    return Math.max(0, this.ticks() - this.startTick!);
  }

  sendEmojiUpdate(msg: EmojiMessage): void {
    this.addUpdate({
      type: GameUpdateType.Emoji,
      emoji: msg,
    });
  }

  setWinner(winner: Player | Team, allPlayersStats: AllPlayersStats): void {
    this._winner = winner;
    this.addUpdate({
      type: GameUpdateType.Win,
      winner: this.makeWinner(winner),
      allPlayersStats,
    });
  }

  getWinner(): Player | Team | null {
    return this._winner;
  }

  private makeWinner(winner: string | Player): Winner | undefined {
    if (typeof winner === "string") {
      return [
        "team",
        winner,
        ...this.players()
          .filter((p) => p.team() === winner && p.clientID() !== null)
          .map((p) => p.clientID()!),
      ];
    } else {
      const clientId = winner.clientID();
      if (clientId === null) {
        return ["nation", winner.name()];
      }
      return [
        "player",
        clientId,
        // TODO: Assists (vote for peace)
      ];
    }
  }

  teams(): Team[] {
    if (this._config.gameConfig().gameMode !== GameMode.Team) {
      return [];
    }
    return [this.botTeam, ...this.playerTeams];
  }

  teamSpawnArea(team: Team): SpawnArea | undefined {
    if (!this._teamGameSpawnAreas) {
      return undefined;
    }
    const numTeams = this.playerTeams.length;
    const areas = this._teamGameSpawnAreas[String(numTeams)];
    if (!areas) {
      return undefined;
    }
    const teamIndex = this.playerTeams.indexOf(team);
    if (teamIndex < 0 || teamIndex >= areas.length) {
      return undefined;
    }
    return areas[teamIndex];
  }

  displayMessage(
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
    goldAmount?: bigint,
    params?: Record<string, string | number>,
    unitID?: number,
    focusPlayerID?: PlayerID,
  ): void {
    let id: number | null = null;
    if (playerID !== null) {
      id = this.player(playerID).smallID();
    }
    const focusID =
      focusPlayerID !== undefined
        ? this.player(focusPlayerID).smallID()
        : undefined;
    this.addUpdate({
      type: GameUpdateType.DisplayEvent,
      messageType: type,
      message: message,
      playerID: id,
      goldAmount: goldAmount,
      params: params,
      unitID: unitID,
      focusPlayerID: focusID,
    });
  }

  displayChat(
    message: string,
    category: string,
    target: PlayerID | undefined,
    playerID: PlayerID | null,
    isFrom: boolean,
    recipient: string,
  ): void {
    let id: number | null = null;
    if (playerID !== null) {
      id = this.player(playerID).smallID();
    }
    this.addUpdate({
      type: GameUpdateType.DisplayChatEvent,
      key: message,
      category: category,
      target: target,
      playerID: id,
      isFrom,
      recipient: recipient,
    });
  }

  displayIncomingUnit(
    unitID: number,
    message: string,
    type: MessageType,
    playerID: PlayerID,
  ): void {
    const id = this.player(playerID).smallID();

    this.addUpdate({
      type: GameUpdateType.UnitIncoming,
      unitID: unitID,
      message: message,
      messageType: type,
      playerID: id,
    });
  }

  addUnit(u: Unit) {
    this.unitGrid.addUnit(u);
    this._unitMap.set(u.id(), u);
  }
  removeUnit(u: Unit) {
    this.unitGrid.removeUnit(u);
    this._unitMap.delete(u.id());
    this.planDrivenUnitIds.delete(u.id());
    if (u.hasTrainStation()) {
      this._railNetwork.removeStation(u);
    }
  }
  updateUnitTile(u: Unit) {
    this.unitGrid.updateUnitCell(u);
  }

  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ) {
    return this.unitGrid.hasUnitNearby(
      tile,
      searchRange,
      type,
      playerId,
      includeUnderConstruction,
    );
  }

  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: Unit) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean {
    return this.unitGrid.anyUnitNearby(
      tile,
      searchRange,
      types,
      predicate as (unit: Unit | UnitView) => boolean,
      playerId,
      includeUnderConstruction,
    );
  }

  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
    includeUnderConstruction?: boolean,
  ): Array<{ unit: Unit; distSquared: number }> {
    return this.unitGrid.nearbyUnits(
      tile,
      searchRange,
      types,
      predicate,
      includeUnderConstruction,
    ) as Array<{
      unit: Unit;
      distSquared: number;
    }>;
  }

  ref(x: number, y: number): TileRef {
    return this._map.ref(x, y);
  }
  isValidRef(ref: TileRef): boolean {
    return this._map.isValidRef(ref);
  }
  x(ref: TileRef): number {
    return this._map.x(ref);
  }
  y(ref: TileRef): number {
    return this._map.y(ref);
  }
  cell(ref: TileRef): Cell {
    return this._map.cell(ref);
  }
  width(): number {
    return this._map.width();
  }
  height(): number {
    return this._map.height();
  }
  numLandTiles(): number {
    return this._map.numLandTiles();
  }
  isValidCoord(x: number, y: number): boolean {
    return this._map.isValidCoord(x, y);
  }
  isLand(ref: TileRef): boolean {
    return this._map.isLand(ref);
  }
  isOceanShore(ref: TileRef): boolean {
    return this._map.isOceanShore(ref);
  }
  isOcean(ref: TileRef): boolean {
    return this._map.isOcean(ref);
  }
  isShoreline(ref: TileRef): boolean {
    return this._map.isShoreline(ref);
  }
  magnitude(ref: TileRef): number {
    return this._map.magnitude(ref);
  }
  terrainByte(ref: TileRef): number {
    return this._map.terrainByte(ref);
  }
  terrainRaw(): Uint8Array {
    return this._map.terrainRaw();
  }
  setShorelineBit(ref: TileRef): void {
    this._map.setShorelineBit(ref);
  }
  clearShorelineBit(ref: TileRef): void {
    this._map.clearShorelineBit(ref);
  }
  setOcean(ref: TileRef): void {
    this._map.setOcean(ref);
  }
  setMagnitude(ref: TileRef, value: number): void {
    this._map.setMagnitude(ref, value);
  }
  ownerID(ref: TileRef): number {
    return this._map.ownerID(ref);
  }
  hasOwner(ref: TileRef): boolean {
    return this._map.hasOwner(ref);
  }
  setOwnerID(ref: TileRef, playerId: number): void {
    return this._map.setOwnerID(ref, playerId);
  }
  hasFallout(ref: TileRef): boolean {
    return this._map.hasFallout(ref);
  }
  isBorder(ref: TileRef): boolean {
    return this._map.isBorder(ref);
  }
  neighbors(ref: TileRef): TileRef[] {
    return this._map.neighbors(ref);
  }
  // Zero-allocation neighbor iteration (cardinal only)
  forEachNeighbor(tile: TileRef, callback: (neighbor: TileRef) => void): void {
    const x = this.x(tile);
    const y = this.y(tile);
    if (x > 0) callback(this._map.ref(x - 1, y));
    if (x + 1 < this._width) callback(this._map.ref(x + 1, y));
    if (y > 0) callback(this._map.ref(x, y - 1));
    if (y + 1 < this._height) callback(this._map.ref(x, y + 1));
  }
  isWater(ref: TileRef): boolean {
    return this._map.isWater(ref);
  }
  isLake(ref: TileRef): boolean {
    return this._map.isLake(ref);
  }
  isShore(ref: TileRef): boolean {
    return this._map.isShore(ref);
  }
  cost(ref: TileRef): number {
    return this._map.cost(ref);
  }
  terrainType(ref: TileRef): TerrainType {
    return this._map.terrainType(ref);
  }
  forEachTile(fn: (tile: TileRef) => void): void {
    return this._map.forEachTile(fn);
  }
  manhattanDist(c1: TileRef, c2: TileRef): number {
    return this._map.manhattanDist(c1, c2);
  }
  euclideanDistSquared(c1: TileRef, c2: TileRef): number {
    return this._map.euclideanDistSquared(c1, c2);
  }
  circleSearch(
    tile: TileRef,
    radius: number,
    filter?: (tile: TileRef, d2: number) => boolean,
  ): Set<TileRef> {
    return this._map.circleSearch(tile, radius, filter);
  }
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef> {
    return this._map.bfs(tile, filter);
  }
  tileState(tile: TileRef): number {
    return this._map.tileState(tile);
  }
  tileStateBuffer(): Uint16Array {
    return this._map.tileStateBuffer();
  }
  updateTile(tile: TileRef, state: number): boolean {
    return this._map.updateTile(tile, state);
  }
  numTilesWithFallout(): number {
    return this._map.numTilesWithFallout();
  }
  stats(): Stats {
    return this._stats;
  }
  railNetwork(): RailNetwork {
    return this._railNetwork;
  }
  miniWaterHPA(): PathFinder<number> | null {
    return this._waterManager.miniWaterHPA();
  }
  miniWaterGraph(): AbstractGraph | null {
    return this._waterManager.miniWaterGraph();
  }
  waterGraphVersion(): number {
    return this._waterManager.waterGraphVersion();
  }
  getWaterComponent(tile: TileRef): number | null {
    return this._waterManager.getWaterComponent(tile);
  }
  hasWaterComponent(tile: TileRef, component: number): boolean {
    return this._waterManager.hasWaterComponent(tile, component);
  }
  sharedWaterComponents(player: Player): Set<number> | null {
    return this._sharedWaterCache.get(player);
  }
  conquerPlayer(conqueror: Player, conquered: Player) {
    if (conquered.isDisconnected() && conqueror.isOnSameTeam(conquered)) {
      const ships = conquered
        .units()
        .filter(
          (u) =>
            u.type() === UnitType.Warship ||
            u.type() === UnitType.TransportShip,
        );

      for (const ship of ships) {
        conqueror.captureUnit(ship);
      }
    }

    // Don't transfer gold when the conquered player didn't play (never attacked anyone)
    // This is especially important when starting gold is enabled
    const stats = this._stats.getPlayerStats(conquered);
    const attacksSent = stats?.attacks?.[ATTACK_INDEX_SENT] ?? 0n;
    const skipGoldTransfer =
      attacksSent === 0n && conquered.type() === PlayerType.Human;
    const gold = skipGoldTransfer ? 0n : conquered.gold();
    const goldCaptured = skipGoldTransfer
      ? 0n
      : this._config.conquerGoldAmount(conquered);
    // terron: доли получателей (не финишер) — для FX-мечей «шаринг» на клиенте.
    const conquestShares: Array<{ id: PlayerID; gold: bigint }> = [];

    if (skipGoldTransfer) {
      this.displayMessage(
        "events_display.conquered_no_gold",
        MessageType.CONQUERED_PLAYER,
        conqueror.id(),
        undefined,
        {
          name: conquered.displayName(),
        },
      );
    } else {
      // terron: золото за завоевание делим ПРОПОРЦИОНАЛЬНО тайлам, которые каждый
      // живой игрок откусил у завоёванного (а не всё тому, кто добил последним).
      const lost = (conquered as PlayerImpl)._tilesLostTo;
      const contrib: Array<{ p: Player; n: number }> = [];
      for (const [sid, n] of lost) {
        if (n <= 0) continue;
        const p = this.playerBySmallID(sid);
        if (p.isPlayer() && p.isAlive()) contrib.push({ p, n });
      }
      contrib.sort((a, b) => a.p.smallID() - b.p.smallID()); // детерминизм
      const totalTiles = contrib.reduce((s, c) => s + c.n, 0);
      let distributed = 0n;
      if (totalTiles > 0 && goldCaptured > 0n) {
        for (const { p, n } of contrib) {
          const share = (goldCaptured * BigInt(n)) / BigInt(totalTiles);
          if (share <= 0n) continue;
          p.addGold(share);
          distributed += share;
          // FX-мечи «шаринг» получателю доли (не финишеру) — на клиенте по shares
          if (share >= 500n && p.id() !== conqueror.id()) {
            conquestShares.push({ id: p.id(), gold: share });
          }
          // мелочь (<500) не засоряет ленту — золото всё равно начислено
          if (share >= 500n) {
            this.displayMessage(
              "events_display.received_gold_from_conquest",
              MessageType.CONQUERED_PLAYER,
              p.id(),
              share,
              { gold: renderNumber(share), name: conquered.displayName() },
            );
          }
        }
      }
      // остаток (округление вниз / выбывшие участники) — тому, кто добил
      const remainder = goldCaptured - distributed;
      if (remainder > 0n) {
        conqueror.addGold(remainder);
        if (remainder >= 500n) {
          this.displayMessage(
            "events_display.received_gold_from_conquest",
            MessageType.CONQUERED_PLAYER,
            conqueror.id(),
            remainder,
            { gold: renderNumber(remainder), name: conquered.displayName() },
          );
        }
      }
      conquered.removeGold(gold);

      // Record stats
      this.stats().goldWar(conqueror, conquered, goldCaptured);
    }

    // terron ФФА-рейтинг: кредит едокам, откусившим ≥40% тайлов жертвы (RATING.md).
    this.recordFFAEats(conquered);

    this.addUpdate({
      type: GameUpdateType.ConquestEvent,
      conquerorId: conqueror.id(),
      conqueredId: conquered.id(),
      gold: goldCaptured,
      shares: conquestShares.length > 0 ? conquestShares : undefined,
    });
  }

  // ФФА-рейтинг: на завоевании жертвы начисляем «съедение» каждому, кто откусил
  // ≥40% её тайлов (по _tilesLostTo, тому же источнику, что и дележ золота).
  // Статы пишутся в StatsImpl.ffaConquer; «Нации» выводятся на архиве. Людям,
  // съевшим человека, шлём «+1» в ленту.
  private recordFFAEats(conquered: Player): void {
    const lost = (conquered as PlayerImpl)._tilesLostTo;
    let total = 0;
    for (const n of lost.values()) if (n > 0) total += n;
    if (total <= 0) return;
    const victimHuman = conquered.clientID() !== null;
    for (const [sid, n] of lost) {
      if (n <= 0 || n / total < 0.4) continue;
      const eater = this.playerBySmallID(sid);
      if (!eater.isPlayer() || eater === conquered) continue;
      this.stats().ffaConquer(eater, conquered);
      if (victimHuman && eater.clientID() !== null) {
        this.displayMessage(
          "events_display.ffa_rating_gained",
          MessageType.CONQUERED_PLAYER,
          eater.id(),
          undefined,
          { name: conquered.displayName() },
        );
      }
    }
  }
}

// Or a more dynamic approach that will catch new enum values:
const createGameUpdatesMap = (): GameUpdates => {
  const map = {} as GameUpdates;
  Object.values(GameUpdateType)
    .filter((key) => !isNaN(Number(key))) // Filter out reverse mappings
    .forEach((key) => {
      map[key as GameUpdateType] = [];
    });
  return map;
};

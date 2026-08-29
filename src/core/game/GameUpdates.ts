import { AllPlayersStats, ClientID, Winner } from "../Schemas";
import { EconomyGold } from "./EconomyLog";
import {
  EmojiMessage,
  GameUpdates,
  Gold,
  MessageType,
  NameViewData,
  PlayerID,
  PlayerType,
  Team,
  Tick,
  TrainType,
  TransportShipState,
  UnitType,
  WarshipState,
} from "./Game";
import { TileRef } from "./GameMap";

export interface GameUpdateViewData {
  tick: number;
  updates: GameUpdates;
  /**
   * Packed tile updates as `[tileRef, state]` uint32 pairs.
   *
   * `tileRef` is a `TileRef` (fits in uint32), and `state` is the packed per-tile
   * state (`uint16`) stored in a `uint32` lane.
   */
  packedTileUpdates: Uint32Array;
  /**
   * Optional packed motion plan records.
   *
   * When present, this buffer is expected to be transferred worker -> main
   * (similar to `packedTileUpdates`) to avoid structured-clone copies.
   */
  packedMotionPlans?: Uint32Array;
  /**
   * terron: скины пепла — пары `[tileRef, smallID бомбившего]` за тик.
   * Присылается только на тиках со взрывами; transferable как соседние поля.
   * Чисто видовые данные («чей пепел» для каймы/паттерна), сим их не читает.
   */
  packedFalloutOwners?: Uint32Array;
  /** terron ПЕРФ (15.08): опционально — присылается только на тиках, где карта
   *  имён менялась (спавн-фаза либо пересчёт раз в 10 тиков). */
  playerNameViewData?: Record<string, NameViewData>;
  tickExecutionDuration?: number;
  pendingTurns?: number;
  /**
   * terron: периодический снимок статистики ВСЕХ игроков (раз в ~30 с).
   *
   * Зачем: до 01.08 статистика уезжала в архив ТОЛЬКО вместе с победой
   * (`setWinner(winner, stats)`). Матчи, кончившиеся без победителя (все
   * разошлись, лимит ходов, рестарт сервера), архивировались с пустой
   * статистикой — по логам прода это 221 матч из 400 за сутки. Клиент
   * пересылает снимок серверу, тот держит последний и кладёт в архив, если
   * победного не случилось.
   */
  allPlayersStats?: AllPlayersStats;
}

export interface ErrorUpdate {
  errMsg: string;
  stack?: string;
}

export enum GameUpdateType {
  // Tile updates are delivered via `packedTileUpdates` on the outer GameUpdateViewData.
  Tile,
  Unit,
  Player,
  DisplayEvent,
  DisplayChatEvent,
  AllianceRequest,
  AllianceRequestReply,
  BrokeAlliance,
  AllianceExpired,
  AllianceExtension,
  TargetPlayer,
  Emoji,
  Win,
  Hash,
  UnitIncoming,
  BonusEvent,
  RailroadDestructionEvent,
  RailroadConstructionEvent,
  RailroadSnapEvent,
  ConquestEvent,
  EmbargoEvent,
  SpawnPhaseEnd,
  GamePaused,
  DonateEvent,
  // terron: ультимейты — Небо наше: ракета ушла, спутники будут сбиты.
  SatBlackout,
  Blockade, // terron: ПИРАТСТВО — объявлена зона блокады (клиент рисует круг)
  // terron: Укрепления — бункер «выстрелил» по захваченному тайлу (снаряд-визуал).
  FortShot,
}

export type GameUpdate =
  | UnitUpdate
  | PlayerUpdate
  | AllianceRequestUpdate
  | AllianceRequestReplyUpdate
  | BrokeAllianceUpdate
  | AllianceExpiredUpdate
  | DisplayMessageUpdate
  | DisplayChatMessageUpdate
  | TargetPlayerUpdate
  | EmojiUpdate
  | WinUpdate
  | HashUpdate
  | UnitIncomingUpdate
  | AllianceExtensionUpdate
  | BonusEventUpdate
  | RailroadConstructionUpdate
  | RailroadDestructionUpdate
  | RailroadSnapUpdate
  | ConquestUpdate
  | EmbargoUpdate
  | SpawnPhaseEndUpdate
  | GamePausedUpdate
  | DonateEventUpdate
  | SatBlackoutUpdate
  | FortShotUpdate
  | BlockadeUpdate;

// terron: ПИРАТСТВО — зона блокады «флаг»: шлётся при появлении и при каждом
// изменении числа лодок (ships=0 → зона исчезла). Клиент рисует флаг на оверлее.
export interface BlockadeUpdate {
  type: GameUpdateType.Blockade;
  id: number;
  ownerSmallID: number;
  tile: TileRef;
  hh: number;
  hw: number;
  ships: number;
  /** terron 23.08: тик исчезновения зоны — на флаге рисуется отсчёт. */
  expiresAt: number;
  /** terron 23.08: зона ЗАЯВЛЕНА, но ещё не работает (лодки в пути). */
  pending: boolean;
}

// terron: ультимейты — Небо наше. Шлётся ОДИН раз в момент запуска ракеты
// (конец демонтажа). Клиенты сами включают туман всем, кроме владельца (и его
// команды в Team-режиме), в окне [blastTick, endTick). Спека: new-units/NEBO.md
export interface SatBlackoutUpdate {
  type: GameUpdateType.SatBlackout;
  ownerSmallID: number;
  epicenter: TileRef; // точка запуска — из неё расходится волна тьмы/света
  blastTick: number; // подрыв (запуск + 10с)
  endTick: number; // спутники врагов чинятся
}

// terron: Укрепления — снаряд-визуал бункера/штаба по захваченному тайлу. Шлётся
// на каждый захваченный тайл в импульсе автозахвата (FortificationsExecution).
// Клиент рисует летящую белую точку from→to (как реальный Shell). Косметика —
// видят все. Спека: new-units/ULTIMATES.md
export interface FortShotUpdate {
  type: GameUpdateType.FortShot;
  from: TileRef; // тайл бункера/штаба (откуда «выстрел»)
  to: TileRef; // захваченный тайл (куда летит снаряд)
}

export interface BonusEventUpdate {
  type: GameUpdateType.BonusEvent;
  player: PlayerID;
  tile: TileRef;
  gold: number;
  troops: number;
}

export interface RailroadConstructionUpdate {
  type: GameUpdateType.RailroadConstructionEvent;
  id: number;
  tiles: TileRef[];
}

export interface RailroadDestructionUpdate {
  type: GameUpdateType.RailroadDestructionEvent;
  id: number;
}

export interface RailroadSnapUpdate {
  type: GameUpdateType.RailroadSnapEvent;
  originalId: number;
  newId1: number;
  newId2: number;
  tiles1: TileRef[];
  tiles2: TileRef[];
}

export interface ConquestUpdate {
  type: GameUpdateType.ConquestEvent;
  conquerorId: PlayerID;
  conqueredId: PlayerID;
  gold: Gold;
  // terron: получатели ДОЛИ золота (откусили тайлы, но не добили) — чтобы и им
  // показать FX-мечи (шаринг) с их суммой, а не только финишеру.
  shares?: Array<{ id: PlayerID; gold: Gold }>;
}

export interface DonateEventUpdate {
  type: GameUpdateType.DonateEvent;
  donationType: "troops" | "gold";
  senderId: PlayerID;
  recipientId: PlayerID;
  amount: bigint;
}

export interface UnitUpdate {
  type: GameUpdateType.Unit;
  unitType: UnitType;
  troops: number;
  id: number;
  ownerID: number;
  lastOwnerID?: number;
  // TODO: make these tilerefs
  pos: TileRef;
  lastPos: TileRef;
  isActive: boolean;
  reachedTarget: boolean;
  warshipState?: WarshipState;
  transportShipState?: TransportShipState;
  targetable: boolean;
  markedForDeletion: number | false;
  targetUnitId?: number; // Only for trade ships
  targetTile?: TileRef; // Only for nukes
  health?: number;
  underConstruction?: boolean;
  missileTimerQueue: number[];
  level: number;
  hasTrainStation: boolean;
  trainType?: TrainType; // Only for trains
  loaded?: boolean; // Only for trains
  stolenTroops?: number; // terron: ультимейты — Мин правды, потеряли враги
  gainedTroops?: number; // terron: ультимейты — Мин правды, пришло владельцу
  // terron: тик захвата (смены владельца) — клиентский таймер самоуничтожения
  // захваченной чужой ульты (PlayerExecution.detonateCapturedUlt).
  capturedTick?: number;
  // terron: СТОЛИЦЫ — этот City является столицей (золотой тинт). Спека: CAPITALS.md
  isCapital?: boolean;
  capitalName?: string; // имя столицы (EN-канон, RU на клиенте)
  capitalGeneration?: number;
  // terron: ПОДЛОДКИ — 1 = подлодка засвечена, 2 = скрыта (спрайт + фора);
  // ПИРАТСТВО — 3 = пиратская лодка (спрайт), 4 = ТИХИЙ десант (скрыт от врага
  // до подхода к точке высадки, без тревоги и следа).
  subState?: number;
  // terron: ДОРА — тайлы станций, до которых орудие РЕАЛЬНО доедет по своим
  // рельсам (считает сим, рисует клиент «облачком»). Раньше клиент рисовал
  // круги вокруг ВСЕХ своих станций и врал: половина из них была отрезана
  // чужой землёй, игрок тыкал в зону и получал «орудие не достаёт». DORA.md
  railReach?: TileRef[];
  // terron: ШАГАЮЩИЙ ГОРОД — остаток маршрута идущего здания (нитка + гост).
  walkPath?: TileRef[];
  // terron: ДОРА — сколько тиков осталось до попадания по текущей цели
  // (доезд + перезарядка). Клиент рисует красный отсчёт на самой цели.
  railEta?: number;
  // terron: ПИРАТСТВО — потолок здоровья, если отличается от config.maxHealth
  // (пиратская лодка 200): полоска здоровья на клиенте считает долю от него.
  maxHealth?: number;
}

export interface AttackUpdate {
  attackerID: number;
  targetID: number;
  troops: number;
  id: string;
  retreating: boolean;
}

/**
 * Player snapshot delivered worker -> main thread.
 *
 * Only `type` and `id` are guaranteed. Every other field is omitted when its
 * value matches the previous emission for the same player. The first emission
 * for a player always includes all fields; consumers must handle subsequent
 * partial updates by merging into local state, not overwriting.
 *
 * When adding a field here, also wire it into diffPlayerUpdate() and
 * applyStateUpdate() in GameUpdateUtils.ts — otherwise it is only ever sent on
 * the first emission and later changes are silently dropped.
 */
export interface PlayerUpdate {
  type: GameUpdateType.Player;
  id: PlayerID;
  nameViewData?: NameViewData;
  clientID?: ClientID | null;
  name?: string;
  displayName?: string;
  team?: Team;
  smallID?: number;
  playerType?: PlayerType;
  isAlive?: boolean;
  isDisconnected?: boolean;
  tilesOwned?: number;
  gold?: Gold;
  troops?: number;
  allies?: number[];
  embargoes?: Set<PlayerID>;
  isTraitor?: boolean;
  traitorRemainingTicks?: number;
  targets?: number[];
  outgoingEmojis?: EmojiMessage[];
  outgoingAttacks?: AttackUpdate[];
  incomingAttacks?: AttackUpdate[];
  outgoingAllianceRequests?: PlayerID[];
  alliances?: AllianceView[];
  hasSpawned?: boolean;
  spawnTile?: TileRef;
  betrayals?: number;
  lastDeleteUnitTick?: Tick;
  isLobbyCreator?: boolean;
  // terron: DEV — кумулятивный доход по эконом-каналам (порт/фабрика/аэропорт/railExt) для
  // страницы /balance. Присутствует только когда включён extendedEconomyLog. Спека: airport.md
  econGold?: EconomyGold;
  // terron: авиация — активные десантные плацдармы (тайл + турн истечения иммунитета от
  // окружения). Клиент рисует над ними обратный отсчёт. Пусто, когда плацдармов нет.
  airborneBeachheads?: AirborneBeachheadView[];
  // terron: авиация — сколько высадок игрок построил всего (для цены следующей в радиале:
  // min(1kk, (n+1)·100k)). Кумулятивно.
  airborneAssaultsBuilt?: number;
  // terron: ультимейты — зафиксированный выбор (undefined = ещё не выбрал).
  // new-units/ULTIMATES.md
  ultimateChoice?: UnitType;
  // terron 23.08: ПИРАТСТВО — тик, когда можно будет купить следующую лодку.
  // Это ОТКАТ ИГРОКА, а не здания, поэтому едет тут; интерфейс показывает его
  // тем же циферблатом, что и перезарядку шахт (client/Cooldowns.ts).
  pirateShipReadyAt?: number;
  // terron: ультимейты — суммарные метрики за матч (тултип слота ульты).
  ultStolen?: number;
  ultStolenGained?: number;
  ultMirvLaunches?: number;
  ultMirvTiles?: number;
  ultFortTiles?: number;
  ultSplitTiles?: number;
  ultReligionTiles?: number;
  ultReligionTithe?: number;
  ultWaterTiles?: number; // terron: ультимейты — «Реки вспять» (земель затоплено)
  // terron: РЕВАНШИЗМ — smallID тех, кто напал на меня ПЕРВЫМ (ховер статуи
  // показывает, «на кого обиделись»). Пусто → поля нет.
  aggressors?: number[];
  // terron: ультимейты — Раскол. Один маркер «спасения Т» для клиента: центр буквы
  // (перекрестье полос), ширина ножки в тайлах и турн истечения — рисуем ОДНУ
  // крупную цифру-отсчёт в центре Т, а не по цифре на каждом тайле. null = нет.
  splitRescue?: SplitRescueView | null;
}

// terron: авиация — вид одного десантного плацдарма для клиента.
export interface AirborneBeachheadView {
  tile: TileRef;
  expiryTick: Tick;
}

// terron: ультимейты — Раскол. Позиция+размер+таймер одной цифры спасения Т.
export interface SplitRescueView {
  x: number; // тайл X центра (перекрестье перекладины и ножки)
  y: number; // тайл Y центра
  w: number; // ширина ножки Т в тайлах (для размера шрифта ≈ ½ ножки)
  expiry: Tick; // турн истечения окна спасения
}

export interface AllianceView {
  id: number;
  other: PlayerID;
  createdAt: Tick;
  expiresAt: Tick;
  hasExtensionRequest: boolean;
}

export interface AllianceRequestUpdate {
  type: GameUpdateType.AllianceRequest;
  requestorID: number;
  recipientID: number;
  createdAt: Tick;
}

export interface AllianceRequestReplyUpdate {
  type: GameUpdateType.AllianceRequestReply;
  request: AllianceRequestUpdate;
  accepted: boolean;
}

export interface BrokeAllianceUpdate {
  type: GameUpdateType.BrokeAlliance;
  traitorID: number;
  betrayedID: number;
  allianceID: number;
}

export interface AllianceExpiredUpdate {
  type: GameUpdateType.AllianceExpired;
  player1ID: number;
  player2ID: number;
}

export interface AllianceExtensionUpdate {
  type: GameUpdateType.AllianceExtension;
  playerID: number;
  allianceID: number;
}

export interface TargetPlayerUpdate {
  type: GameUpdateType.TargetPlayer;
  playerID: number;
  targetID: number;
}

export interface EmojiUpdate {
  type: GameUpdateType.Emoji;
  emoji: EmojiMessage;
}

export interface DisplayMessageUpdate {
  type: GameUpdateType.DisplayEvent;
  message: string;
  messageType: MessageType;
  goldAmount?: bigint;
  playerID: number | null;
  params?: Record<string, string | number>;
  unitID?: number;
  focusPlayerID?: number;
}

export type DisplayChatMessageUpdate = {
  type: GameUpdateType.DisplayChatEvent;
  key: string;
  category: string;
  target: string | undefined;
  playerID: number | null;
  isFrom: boolean;
  recipient: string;
};

export interface WinUpdate {
  type: GameUpdateType.Win;
  allPlayersStats: AllPlayersStats;
  winner: Winner;
}

export interface HashUpdate {
  type: GameUpdateType.Hash;
  tick: Tick;
  hash: number;
}

export interface UnitIncomingUpdate {
  type: GameUpdateType.UnitIncoming;
  unitID: number;
  message: string;
  messageType: MessageType;
  playerID: number;
}

export interface EmbargoUpdate {
  type: GameUpdateType.EmbargoEvent;
  event: "start" | "stop";
  playerID: number;
  embargoedID: number;
}

export interface SpawnPhaseEndUpdate {
  type: GameUpdateType.SpawnPhaseEnd;
  startTick: Tick;
}

export interface GamePausedUpdate {
  type: GameUpdateType.GamePaused;
  paused: boolean;
}

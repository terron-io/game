import type { TileRef } from "../../../core/game/GameMap";

/** TrainType enum — numeric values matching UnitState.trainType. */
export enum TrainType {
  Engine = 0,
  TailEngine = 1,
  Carriage = 2,
}

/** Numeric player type — matching PlayerStatic.playerType. */
export enum PlayerTypeEnum {
  Human = 0,
  Bot = 1,
  Nation = 2,
}

/** Static player data from the header dictionary */
export interface PlayerStatic {
  smallID: number;
  id: string;
  name: string;
  displayName: string;
  clientID: string | null;
  playerType: PlayerTypeEnum;
  team: string | null;
  isLobbyCreator: boolean;
  /** Resolved flag image URL, or undefined for no flag. */
  flag?: string;
  /** Hex color (e.g. "#ff0000"). Populated from territoryColor (live) or palette (replay). */
  color?: string;
}

export interface AttackData {
  attackerID: number;
  targetID: number;
  troops: number;
  id: string;
  retreating: boolean;
}

export interface AllianceData {
  id: number;
  other: string;
  createdAt: number;
  expiresAt: number;
  hasExtensionRequest: boolean;
}

export interface EmojiData {
  message: string;
  senderID: number;
  recipientID: number | "AllPlayers";
  createdAt: number;
}

export interface PlayerState {
  smallID: number;
  isAlive: boolean;
  isDisconnected: boolean;
  tilesOwned: number;
  gold: number;
  troops: number;
  isTraitor: boolean;
  traitorRemainingTicks: number;
  betrayals: number;
  hasSpawned: boolean;
  /** TileRef the player picked as their spawn (undefined if not yet spawned). */
  spawnTile?: number;
  lastDeleteUnitTick: number;
  allies: number[];
  embargoes: number[];
  targets: number[];
  outgoingAttacks: AttackData[];
  incomingAttacks: AttackData[];
  outgoingAllianceRequests: string[];
  alliances: AllianceData[];
  outgoingEmojis: EmojiData[];
  // terron: авиация — десантные плацдармы (тайл + турн истечения иммунитета).
  airborneBeachheads?: { tile: number; expiryTick: number }[];
  // terron: авиация — счётчик построенных высадок (цена следующей в радиале).
  airborneAssaultsBuilt?: number;
  // terron: ультимейты — зафиксированный выбор (строка UnitType).
  ultimateChoice?: string;
  /** terron: ПИРАТСТВО — тик, когда можно купить следующую лодку. */
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
  ultWaterTiles?: number; // terron: ультимейты — «Реки вспять»
  aggressors?: number[]; // terron: РЕВАНШИЗМ — кто напал первым
  // terron: ультимейты — Раскол: маркер одной цифры-таймера спасения Т (или null).
  splitRescue?: { x: number; y: number; w: number; expiry: number } | null;
}

export interface UnitState {
  id: number;
  unitType: string;
  ownerID: number;
  lastOwnerID: number | null;
  pos: number;
  lastPos: number;
  isActive: boolean;
  reachedTarget: boolean;
  retreating: boolean;
  targetable: boolean;
  markedForDeletion: number | false; // -1 -> false, else tick
  health: number | null;
  underConstruction: boolean;
  targetUnitId: number | null;
  targetTile: number | null;
  troops: number;
  missileTimerQueue: number[];
  level: number;
  hasTrainStation: boolean;
  // terron: ПОДЛОДКИ — 0/undefined обычный корабль, 1 засвечена, 2 скрыта.
  subState?: number;
  /** terron: ПИРАТСТВО — потолок здоровья, если отличается от config (лодка 200). */
  maxHealth?: number;
  trainType: number | null; // 0=Engine, 1=TailEngine, 2=Carriage
  loaded: boolean | null;
  constructionStartTick: number | null;
  stolenTroops?: number | null; // terron: ультимейты — Мин правды, потеряли враги
  gainedTroops?: number | null; // terron: ультимейты — Мин правды, пришло владельцу
  capturedTick?: number | null; // terron: тик захвата (таймер самоуничтожения ульты)
  isCapital: boolean; // terron: СТОЛИЦЫ — золотой тинт City. Спека: CAPITALS.md
  capitalName?: string | null; // terron: СТОЛИЦЫ — имя столицы (EN-канон)
  capitalGeneration?: number; // какая по счёту столица игрока (2+ → «Новая …»)
  // terron: ДОРА — станции, до которых орудие доедет по СВОИМ рельсам (зона
  // на карте) и отсчёт до попадания по текущей цели. new-units/DORA.md
  railReach?: number[] | null;
  railEta?: number;
  // terron: ШАГАЮЩИЙ ГОРОД — остаток маршрута идущего здания (нитка + гост).
  walkPath?: number[] | null;
}

/** Minimal dead-unit data needed by the FX pass. */
export interface DeadUnitFx {
  unitType: string;
  pos: number;
  reachedTarget: boolean;
  /** Ticks since the event occurred (0 = this frame, >0 = seeked past it). */
  tickAge?: number;
}

/** Conquest event data for the gold popup + sword sprite FX. */
export interface ConquestFx {
  x: number; // world tile X (conquered player's name location)
  y: number; // world tile Y
  gold: number; // gold amount awarded
  /** Ticks since the event occurred (0 = this frame, >0 = seeked past it). */
  tickAge?: number;
  /** terron: true = доля за «шаринг» (откусил, но не добил) — текст золотым. */
  share?: boolean;
}

export interface TilePair {
  ref: number;
  state: number;
}

export interface NameEntry {
  playerID: string;
  x: number;
  y: number;
  size: number;
}

/** Per-player status data for the GPU name/status-icon passes. */
export interface PlayerStatusData {
  crown: boolean;
  traitor: boolean;
  disconnected: boolean;
  alliance: boolean;
  allianceReq: boolean;
  target: boolean;
  embargo: boolean;
  nukeActive: boolean;
  nukeTargetsMe: boolean;
  traitorRemainingTicks: number;
  allianceFraction: number;
}

/** Ghost structure preview data for build-mode visualization. */
export interface GhostPreviewData {
  ghostType: string; // UnitType string ("City", "Port", etc.)
  /**
   * terron 23.08: РИСОВАТЬ ЛИ ПРИЦЕЛ-КРЕСТИК. Решает контроллер, потому что
   * только он знает, есть ли у этого госта своя картинка (звезда-строение,
   * круг радиуса, флаг блокады). Раньше CrosshairPass сам перечислял два типа
   * руками — и любой новый каст оставался вообще без госта.
   */
  crosshair?: boolean;
  tileX: number; // Hover tile X
  tileY: number; // Hover tile Y
  radiusTileX: number;
  radiusTileY: number;
  canBuild: boolean; // Valid placement?
  canUpgrade: boolean; // Upgrading existing structure?
  cost: number; // Gold cost
  /** Whether to render the cost label under the ghost (user setting). */
  showCost: boolean;
  /** True if the player has enough gold to afford this build (drives label color). */
  canAfford: boolean;
  ghostRailPaths: TileRef[][]; // TileRef paths (City/Port only)
  overlappingRailroads: TileRef[]; // TileRefs containing rails in snap zone
  ownerID: number; // Player's smallID (for color)
  /** Tile position of existing structure being upgraded (null if fresh build). */
  upgradeTargetTile: number | null;
  /** terron: уровень ПОСЛЕ апгрейда (текущий+1) — превью числа над зданием. */
  upgradeNewLevel: number | null;
  /** Range radius in tiles for the placement circle (0 = no circle). */
  rangeRadius: number;
  /** terron: внутренний радиус «мёртвой зоны» (фабрика: ближе НЕ связывает; 0 = нет). */
  rangeMinRadius: number;
  /** True if placing here would carry a penalty (e.g. nuking an ally → traitor). */
  rangeWarning: boolean;
  /** terron: если движок сдвинет постройку на другой валидный тайл — его integer-координаты,
   *  чтобы ghost рисовался ТАМ, где реально построится. null = строится под курсором. */
  snapTileX: number | null;
  snapTileY: number | null;
}

/** Nuke trajectory preview data — Bezier control points + color thresholds. */
export interface NukeTrajectoryData {
  /** Bezier control points (world-space tile coordinates). */
  p0x: number;
  p0y: number;
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
  p3x: number;
  p3y: number;
  /** t-value (0..1) where bomb leaves source's targetable range. -1 if ranges overlap. */
  tUntargetableStart: number;
  /** t-value (0..1) where bomb enters target's targetable range. -1 if ranges overlap. */
  tUntargetableEnd: number;
  /** t-value (0..1) of first SAM intercept point. 1.0 = no intercept. */
  tSamIntercept: number;
}

/** Input data for attack ring visualization. */
export interface AttackRingInput {
  x: number;
  y: number;
  unitId: number;
}

/** In-flight nuke target circle data. */
export interface NukeTelegraphData {
  x: number;
  y: number;
  innerRadius: number;
  outerRadius: number;
}

/** Lean config for constructing the GPU renderer — no replay-specific fields. */
export interface RendererConfig {
  mapWidth: number;
  mapHeight: number;
  unitTypes: string[];
  players: PlayerStatic[];
  /**
   * Pre-allocated player capacity for GPU textures.
   * Defaults to `players.length` when omitted. Set higher when players
   * arrive after construction (e.g. bots are created on tick 1).
   */
  maxPlayers?: number;
}

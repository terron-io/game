// Renderer types (units, players, tiles, names, config)
export { PlayerTypeEnum, TrainType } from "./Renderer";
export type {
  AllianceData,
  AttackData,
  AttackRingInput,
  ConquestFx,
  DeadUnitFx,
  EmojiData,
  GhostPreviewData,
  NameEntry,
  NukeTelegraphData,
  NukeTrajectoryData,
  PlayerState,
  PlayerStatic,
  PlayerStatusData,
  RendererConfig,
  TilePair,
  UnitState,
} from "./Renderer";

// Frame data — boundary contract between game integration and features
export type { FrameData } from "./FrameData";

// Frame events — per-frame ephemeral events (rendering FX + stats events)
export { EMPTY_FRAME_EVENTS } from "./FrameEvents";
export type {
  AllianceBrokenEvent,
  AllianceExpiredEvent,
  AllianceFormedEvent,
  BonusEvent,
  DisplayMessageEvent,
  EmbargoEvent,
  EmojiEvent,
  FrameEvents,
  NukeIncomingEvent,
  TargetEvent,
  WinEvent,
} from "./FrameEvents";

// Frame source — mode-agnostic subscription interface
export type { FrameSource, GameStartConfig } from "./FrameSource";

// Game update types
export type { GameStartInfo, GameUpdateViewData } from "./Game";

// Replay types (header, frames, codec helpers)
export type {
  ChunkIndexEntry,
  FrameSnapshot,
  GridPlanRecord,
  GzipFn,
  InflateFn,
  MotionPlanRecord,
  RawDelta,
  RawFrame,
  RawKeyframe,
  ReplayHeader,
  StreamableReplayInfo,
  TrainPlanRecord,
} from "./Replay";

// Game update type constants and event payloads (shared between shim + codec)
export { GameUpdateType } from "./GameUpdates";
export type {
  AllianceExpiredUpdate,
  AllianceReplyUpdate,
  AttackEventUpdate,
  BonusUpdate,
  BrokeAllianceUpdate,
  DisplayMessageUpdate,
  EmbargoUpdate,
  EmojiUpdate,
  GamePausedUpdate,
  PlayerEventUpdate,
  PlayerType,
  RailroadConstructionUpdate,
  RailroadDestructionUpdate,
  RailroadSnapUpdate,
  TargetPlayerUpdate,
  UnitEventUpdate,
  UnitIncomingUpdate,
  WinUpdate,
} from "./GameUpdates";

// Unit type string constants and derived sets
export {
  ALL_UNIT_TYPES,
  NUKE_MAGNITUDES,
  NUKE_TYPES,
  OURSKY_SAM_RADIUS_MULT, // terron: Небо наше — штаб-ПВО ×5 (дубль тюнинга)
  STRUCTURE_TYPES, // terron: ультимейты
  UT_AIRBORNE_ASSAULT,
  UT_AIRPLANE,
  UT_AIRPORT,
  UT_AIR_COMMAND,
  UT_ATOM_BOMB,
  UT_CENTRAL_BANK, // terron: ультимейты
  UT_CITY,
  UT_DOOM_TRAIN, // terron: состав смерти — своя колонка unit-atlas
  UT_TRAIN_DEPOT, // terron: депо смерти — своя колонка icon-atlas
  UT_CLOSED_COUNTRY, // terron: ультимейты — закрытая страна
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_FORTIFICATIONS, // terron: ультимейты
  UT_HYDROGEN_BOMB, // terron: ультимейты — антиспутник «Небо наше»
  UT_MEDIA, // terron: ультимейты
  UT_MINING,
  UT_MINISTRY,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_MISSILE_SILO, // terron: ультимейты — МЕДИА (штаб)
  UT_NUCLEAR_FACTORY, // terron: ультимейты — минирование
  UT_OIL_RIG, // terron: нефтяная вышка (океан)
  UT_OUR_SKY,
  UT_PIRACY, // terron: ультимейты — пиратство
  UT_PRIDE, // terron: ультимейты — гордость
  UT_OLYMPICS, // terron: ультимейты — стадион
  UT_FANATICISM, // terron: ультимейты — фанатизм
  UT_VICTORY_BANNER, // terron: ультимейты — знамя победы
  UT_PEACE_PALACE, // terron: ультимейты — дворец наций
  UT_GREENS, // terron: ультимейты — зелёные
  UT_NUCLEAR_PLANT, // terron: ультимейты — АЭС
  UT_FUEL, // terron: ультимейты — топливо
  UT_RAIL_GUN, // terron: ультимейты — Дора
  UT_SPACEPORT, // terron: ультимейты — космодром
  UT_PEACEFUL_SKY, // terron: ультимейты — мирное небо
  UT_RAIL_GUN_SHELL, // terron: каст Доры
  UT_INDUSTRIAL_REVOLUTION, // terron: каст Топлива
  UT_RECULTIVATION, // terron: каст АЭС
  UT_GREEN_INSPECTION, // terron: борт-инспекция Зелёных
  UT_CATASTROPHE, // terron: каст Зелёных
  UT_PORT, // terron: ультимейты — статуя-монумент
  UT_RELIGION, // terron: ультимейты — Ядерный завод (штаб → разблок МИРВ)
  UT_REVANCHISM,
  UT_RIVERS_BACK,
  UT_SAM_LAUNCHER,
  UT_SECRET_TREASURE, // terron: СЕКРЕТНЫЙ круг «клад»
  UT_SAM_MISSILE,
  UT_SATELLITE_STRIKE, // terron: ракета-каст Неба нашего

  UT_SHELL, // terron: ультимейты — храм
  UT_SUBMARINE_BASE, // terron: ультимейты — подводный флот
  UT_SUICIDE_DRONE,
  UT_TANK_FACTORY, // terron: ультимейты
  UT_TRADE_SHIP,
  UT_TRAIN,
  UT_TRANSPORT,
  UT_WARSHIP, // terron: ультимейты — «Реки вспять» (штаб)
  UT_WATER_NUKE,
  UT_WALKING_CITY, // terron: ультимейты — шагающий город
} from "./UnitType";

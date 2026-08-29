import quickChatData from "resources/QuickChat.json";
import { z } from "zod";
import {
  ColorPaletteSchema,
  CosmeticNameSchema,
  PatternDataSchema,
} from "./CosmeticSchemas";
import type { GameEvent } from "./EventBus";
import {
  AllPlayers,
  Difficulty,
  Duos,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  Quads,
  RankedType,
  Trios,
  UnitType,
} from "./game/Game";
import { PlayerStatsSchema } from "./StatsSchemas";
import { flattenedEmojiTable } from "./Util";

export type GameID = string;
export type ClientID = string;

export type Intent =
  | SpawnIntent
  | AttackIntent
  | CancelAttackIntent
  | BoatAttackIntent
  | AirAssaultIntent
  | CancelBoatIntent
  | AllianceRequestIntent
  | AllianceRejectIntent
  | AllianceExtensionIntent
  | BreakAllianceIntent
  | TargetPlayerIntent
  | EmojiIntent
  | DonateGoldIntent
  | DonateTroopsIntent
  | BuildUnitIntent
  | EmbargoIntent
  | QuickChatIntent
  | MoveWarshipIntent
  | MarkDisconnectedIntent
  | EmbargoAllIntent
  | UpgradeStructureIntent
  | DeleteUnitIntent
  | KickPlayerIntent
  | ClanInviteIntent
  | FriendRequestIntent
  | GetProfileIntent
  | PlayerReportIntent
  | TogglePauseIntent
  | UpdateGameConfigIntent
  | StartGameIntent
  | RequestStartIntent
  | CancelStartIntent
  | ChooseUltimateIntent;

export type AttackIntent = z.infer<typeof AttackIntentSchema>;
export type CancelAttackIntent = z.infer<typeof CancelAttackIntentSchema>;
export type SpawnIntent = z.infer<typeof SpawnIntentSchema>;
export type BoatAttackIntent = z.infer<typeof BoatAttackIntentSchema>;
export type AirAssaultIntent = z.infer<typeof AirAssaultIntentSchema>;
export type EmbargoAllIntent = z.infer<typeof EmbargoAllIntentSchema>;
export type CancelBoatIntent = z.infer<typeof CancelBoatIntentSchema>;
export type AllianceRequestIntent = z.infer<typeof AllianceRequestIntentSchema>;
export type AllianceRejectIntent = z.infer<typeof AllianceRejectIntentSchema>;
export type BreakAllianceIntent = z.infer<typeof BreakAllianceIntentSchema>;
export type TargetPlayerIntent = z.infer<typeof TargetPlayerIntentSchema>;
export type EmojiIntent = z.infer<typeof EmojiIntentSchema>;
export type DonateGoldIntent = z.infer<typeof DonateGoldIntentSchema>;
export type DonateTroopsIntent = z.infer<typeof DonateTroopIntentSchema>;
export type EmbargoIntent = z.infer<typeof EmbargoIntentSchema>;
export type BuildUnitIntent = z.infer<typeof BuildUnitIntentSchema>;
export type UpgradeStructureIntent = z.infer<
  typeof UpgradeStructureIntentSchema
>;
export type MoveWarshipIntent = z.infer<typeof MoveWarshipIntentSchema>;
export type QuickChatIntent = z.infer<typeof QuickChatIntentSchema>;
export type MarkDisconnectedIntent = z.infer<
  typeof MarkDisconnectedIntentSchema
>;
export type AllianceExtensionIntent = z.infer<
  typeof AllianceExtensionIntentSchema
>;
export type DeleteUnitIntent = z.infer<typeof DeleteUnitIntentSchema>;
export type KickPlayerIntent = z.infer<typeof KickPlayerIntentSchema>;
export type ClanInviteIntent = z.infer<typeof ClanInviteIntentSchema>;
export type FriendRequestIntent = z.infer<typeof FriendRequestIntentSchema>;
export type GetProfileIntent = z.infer<typeof GetProfileIntentSchema>;
export type PlayerReportIntent = z.infer<typeof PlayerReportIntentSchema>;
export type TogglePauseIntent = z.infer<typeof TogglePauseIntentSchema>;
export type UpdateGameConfigIntent = z.infer<
  typeof UpdateGameConfigIntentSchema
>;
export type StartGameIntent = z.infer<typeof StartGameIntentSchema>;
export type RequestStartIntent = z.infer<typeof RequestStartIntentSchema>;
export type CancelStartIntent = z.infer<typeof CancelStartIntentSchema>;
export type ChooseUltimateIntent = z.infer<typeof ChooseUltimateIntentSchema>;

export type Turn = z.infer<typeof TurnSchema>;
export type GameConfig = z.infer<typeof GameConfigSchema>;

export type ClientMessage =
  | ClientSendWinnerMessage
  | ClientDeathMessage
  | ClientPingMessage
  | ClientIntentMessage
  | ClientJoinMessage
  | ClientRejoinMessage
  | ClientLogMessage
  | ClientHashMessage
  | ClientInputModeMessage
  | ClientStatsMessage;

export type ServerMessage =
  | ServerTurnMessage
  | ServerStartGameMessage
  | ServerPingMessage
  | ServerDesyncMessage
  | ServerPrestartMessage
  | ServerErrorMessage
  | ServerLobbyInfoMessage
  | ServerClanInviteResult
  | ServerClanInvited
  | ServerFriendRequestResult
  | ServerFriendRequested
  | ServerProfileResult
  | ServerRestart
  | ServerUltLocked;
export type ServerUltLocked = z.infer<typeof ServerUltLockedSchema>;

export type ServerTurnMessage = z.infer<typeof ServerTurnMessageSchema>;
export type ServerStartGameMessage = z.infer<
  typeof ServerStartGameMessageSchema
>;
export type ServerPingMessage = z.infer<typeof ServerPingMessageSchema>;
export type ServerDesyncMessage = z.infer<typeof ServerDesyncSchema>;
export type ServerPrestartMessage = z.infer<typeof ServerPrestartMessageSchema>;
export type ServerErrorMessage = z.infer<typeof ServerErrorSchema>;
export type ServerLobbyInfoMessage = z.infer<
  typeof ServerLobbyInfoMessageSchema
>;
export type ServerClanInviteResult = z.infer<
  typeof ServerClanInviteResultSchema
>;
export type ServerClanInvited = z.infer<typeof ServerClanInvitedSchema>;
export type ServerFriendRequestResult = z.infer<
  typeof ServerFriendRequestResultSchema
>;
export type ServerFriendRequested = z.infer<typeof ServerFriendRequestedSchema>;
export type ServerProfileResult = z.infer<typeof ServerProfileResultSchema>;
export type ServerRestart = z.infer<typeof ServerRestartSchema>;
export type ClientSendWinnerMessage = z.infer<typeof ClientSendWinnerSchema>;
export type ClientPingMessage = z.infer<typeof ClientPingMessageSchema>;
export type ClientIntentMessage = z.infer<typeof ClientIntentMessageSchema>;
export type ClientJoinMessage = z.infer<typeof ClientJoinMessageSchema>;
export type ClientRejoinMessage = z.infer<typeof ClientRejoinMessageSchema>;
export type ClientLogMessage = z.infer<typeof ClientLogMessageSchema>;
export type ClientHashMessage = z.infer<typeof ClientHashSchema>;
export type ClientInputModeMessage = z.infer<typeof ClientInputModeSchema>;
export type ClientDeathMessage = z.infer<typeof ClientDeathSchema>;
export type ClientStatsMessage = z.infer<typeof ClientStatsSchema>;

export type AllPlayersStats = z.infer<typeof AllPlayersStatsSchema>;
export type Player = z.infer<typeof PlayerSchema>;
export type PlayerCosmetics = z.infer<typeof PlayerCosmeticsSchema>;
export type PlayerCosmeticRefs = z.infer<typeof PlayerCosmeticRefsSchema>;
export type PlayerPattern = z.infer<typeof PlayerPatternSchema>;
export type PlayerColor = z.infer<typeof PlayerColorSchema>;
export type PlayerSkin = z.infer<typeof PlayerSkinSchema>;
export type GameStartInfo = z.infer<typeof GameStartInfoSchema>;
export type GameInfo = z.infer<typeof GameInfoSchema>;
export type PublicGames = z.infer<typeof PublicGamesSchema>;
export type PublicGameInfo = z.infer<typeof PublicGameInfoSchema>;
export type PublicGameType = z.infer<typeof PublicGameTypeSchema>;

// terron: "golden" — ЗОЛОТОЙ МАТЧ. Отдельный тип публичного лобби: оно живёт
// ПОСТОЯННО (соседняя вкладка витрины рядом с ротационным ффа) и стартует по
// расписанию (TerronTuning TERRON_GOLDEN_*). Отдельный тип, а не «переодетое»
// ффа: у мастера свой конвейер на тип, и золотое лобби не должно попадать в
// 10-секундную карусель.
// terron: "diamond" — АЛМАЗНЫЙ МАТЧ. То же устройство, но раз в сутки и с
// наградой на порядок больше (TerronTuning TERRON_DIAMOND_*). Свой тип, а не
// «золотое лобби с флагом»: алмазное лобби должно висеть весь день, чтобы люди
// видели событие и подтягивались заранее, а золотые тем временем идут своим
// чередом.
// ⚠️ ДОБАВЛЕНИЕ КЛЮЧА СЮДА ОДИН РАЗ ПЕРЕЗАГРУЖАЕТ ОТКРЫТЫЕ ВКЛАДКИ: PublicGames
// — zod-record, старый бандл не парсит фид с незнакомым типом и витрина у него
// замирает. Лечится само (LobbySocket.maybeReloadOnProtocolMismatch), но выкат
// такого лучше не сажать на час пик.
export const PublicGameTypeSchema = z.enum([
  "ffa",
  "team",
  "special",
  "golden",
  "diamond",
]);

export const UsernameSchema = z
  .string()
  // terron: любые буквы/цифры (кириллица, латиница и т.д.) + пробел, _, ., -, '.
  // \p{M} (комбинирующие знаки) НЕ разрешаем — защита от «zalgo». Сервер строку
  // не рендерит, так что сломать его ник не может; это про читаемость на карте.
  .regex(/^(?=.*\S)[\p{L}\p{N}_ .\-']+$/u)
  .min(3)
  .max(27);

export const ClanTagSchema = z
  .string()
  // terron: latin/цифры + кириллица (U+0400–U+04FF) — теги на русском.
  .regex(/^[a-zA-Z0-9Ѐ-ӿ]{2,5}$/u)
  .nullable();

const ClientInfoSchema = z.object({
  clientID: z.string(),
  username: UsernameSchema,
  clanTag: ClanTagSchema,
  flag: z.string().nullish(), // terron: server-resolved флаг для лобби
  friends: z.array(z.string()).optional(),
});

export const GameInfoSchema = z.object({
  gameID: z.string(),
  clients: z.array(ClientInfoSchema).optional(),
  lobbyCreatorClientID: z.string().optional(),
  startsAt: z.number().optional(),
  serverTime: z.number(),
  gameConfig: z.lazy(() => GameConfigSchema).optional(),
  publicGameType: PublicGameTypeSchema.optional(),
  // terron: отсчёт старта приватного лобби (request_start/cancel_start). Пока
  // идёт — все видят таймер; по нулю сервер САМ стартует матч. Хост → 10с
  // (отменяет только хост), любой игрок → 60с (отменяет любой). См. lobby-chat.
  startCountdownEndsAt: z.number().optional(),
  startCountdownByHost: z.boolean().optional(),
  startCountdownStarter: z.string().optional(),
});

export const PublicGameInfoSchema = z.object({
  gameID: z.string(),
  numClients: z.number(),
  startsAt: z.number().optional(),
  gameConfig: z.lazy(() => GameConfigSchema).optional(),
  publicGameType: PublicGameTypeSchema,
  // terron: воркер просит мастера сменить карту (отсчёт пустого лобби дотикал
  // до нуля). Раньше мастер решал это сам по своим часам — гонка, см.
  // MasterLobbyService.maybeScheduleLobby. Клиент поле игнорирует.
  wantsMapRotation: z.boolean().optional(),
});

export const PublicGamesSchema = z.object({
  serverTime: z.number(),
  games: z.record(PublicGameTypeSchema, z.array(PublicGameInfoSchema)),
});

// Wire message sent from server to lobby WebSocket clients.
// "full" carries the complete snapshot; "counts" carries only the
// per-lobby player counts, which change far more often than the rest.
export const PublicLobbyFullSchema = z.object({
  type: z.literal("full"),
  serverTime: z.number(),
  games: z.record(PublicGameTypeSchema, z.array(PublicGameInfoSchema)),
});

export const PublicLobbyCountsSchema = z.object({
  type: z.literal("counts"),
  serverTime: z.number(),
  counts: z.record(z.string(), z.number()),
});

export const PublicLobbyMessageSchema = z.discriminatedUnion("type", [
  PublicLobbyFullSchema,
  PublicLobbyCountsSchema,
]);

export type PublicLobbyMessage = z.infer<typeof PublicLobbyMessageSchema>;

export class LobbyInfoEvent implements GameEvent {
  constructor(
    public lobby: GameInfo,
    public myClientID: ClientID,
  ) {}
}

export interface ClientInfo {
  clientID: ClientID;
  username: string;
  clanTag: string | null;
  flag?: string | null; // terron: server-resolved флаг для лобби
  friends?: ClientID[];
}
export enum LogSeverity {
  Debug = "DEBUG",
  Info = "INFO",
  Warn = "WARN",
  Error = "ERROR",
  Fatal = "FATAL",
}

//
// Utility types
//

const TeamCountConfigSchema = z.union([
  z.number(),
  z.literal(Duos),
  z.literal(Trios),
  z.literal(Quads),
  z.literal(HumansVsNations),
]);
export type TeamCountConfig = z.infer<typeof TeamCountConfigSchema>;

export const GameConfigSchema = z.object({
  gameMap: z.enum(GameMapType),
  difficulty: z.enum(Difficulty),
  donateGold: z.boolean(), // Configures donations to humans only
  donateTroops: z.boolean(), // Configures donations to humans only
  gameType: z.enum(GameType),
  gameMode: z.enum(GameMode),
  rankedType: z.enum(RankedType).optional(), // Only set for ranked games.
  gameMapSize: z.enum(GameMapSize),
  publicGameModifiers: z
    .object({
      isCompact: z.boolean().optional(),
      isRandomSpawn: z.boolean().optional(),
      isCrowded: z.boolean().optional(),
      isHardNations: z.boolean().optional(),
      startingGold: z.number().int().min(0).optional(),
      goldMultiplier: z.number().min(0.1).max(1000).optional(),
      isAlliancesDisabled: z.boolean().optional(),
      isPortsDisabled: z.boolean().optional(),
      isNukesDisabled: z.boolean().optional(),
      isSAMsDisabled: z.boolean().optional(),
      isPeaceTime: z.boolean().optional(),
      isWaterNukes: z.boolean().optional(),
    })
    .optional(),
  nations: z
    .number()
    .int()
    .min(1)
    .max(400)
    .or(z.enum(["default", "disabled"])),
  bots: z.number().int().min(0).max(400),
  infiniteGold: z.boolean(),
  infiniteTroops: z.boolean(),
  instantBuild: z.boolean(),
  disableNavMesh: z.boolean().optional(),
  // terron: туман войны — карта закрыта, видно только свою/союзную территорию
  // и окрестность своих юнитов (клиентский рендер; см. new-units/FOG.md)
  fogOfWar: z.boolean().optional(),
  // terron: ДЕВ-ПЕСОЧНИЦА ЗАМКОВ — в этом матче закрытые ульты доступны всем
  // без ачивок и покупок. Сервер выполняет ТОЛЬКО на дев-контейнере
  // (TERRON_ENV=dev; на проде переменной нет и поле игнорируется целиком).
  // Живёт в конфиге ЛОББИ, а не в настройках игрока: так «доступно» относится
  // к конкретному матчу, который создаёшь, и не требует оговорок про
  // «со следующего раза». TZ-ult-unlocks.md
  devUnlockUlts: z.boolean().optional(),
  // terron: ЗОЛОТОЙ МАТЧ — почасовое системное лобби с наградой победителю
  // (TerronTuning TERRON_GOLDEN_*). Ставит ТОЛЬКО мастер публичному лобби:
  // хосту поле недоступно (нет в HOST_UPDATABLE_CONFIG_KEYS, плюс гард в
  // конструкторе GameServer), иначе приватной игрой фармили бы алмазы.
  golden: z.boolean().optional(),
  // terron: ТИР событийного матча. golden выше = «матч с наградой» (на нём висят
  // все гарды), а тир говорит КАКОЙ именно: почасовой золотой или суточный
  // алмазный (TerronTuning TERRON_DIAMOND_*). Поле опциональное, поэтому старые
  // бандлы просто читают событие как золотое. Ставит ТОЛЬКО мастер — правила и
  // гард те же, что у golden.
  eventTier: z.enum(["golden", "diamond"]).optional(),
  // terron: обещанная награда победителю, ПТС. Едет В КОНФИГЕ, а не константой
  // клиента: цифру крутят переменной окружения игрового сервера, и бандл ради
  // этого пересобирать незачем. Ставит и перезаписывает ТОЛЬКО сервер.
  eventRewardPts: z.number().int().min(1).max(500).optional(),
  disableAlliances: z.boolean().nullable().optional(),
  disableClanTags: z.boolean().optional(),
  waterNukes: z.boolean().nullable().optional(),
  randomSpawn: z.boolean(),
  maxPlayers: z.number().optional(),
  maxTimerValue: z.number().int().min(1).max(120).nullable().optional(), // In minutes
  spawnImmunityDuration: z.number().int().min(0).nullable().optional(), // In ticks
  disabledUnits: z.enum(UnitType).array().optional(),
  playerTeams: TeamCountConfigSchema.optional(),
  goldMultiplier: z.number().min(0.1).max(1000).nullable().optional(),
  startingGold: z.number().int().min(0).max(1000000000).nullable().optional(),
  hostCheats: z
    .object({
      infiniteGold: z.boolean().optional(),
      infiniteTroops: z.boolean().optional(),
      goldMultiplier: z.number().min(0.1).max(1000).nullable().optional(),
      startingGold: z
        .number()
        .int()
        .min(0)
        .max(1000000000)
        .nullable()
        .optional(),
    })
    .optional(),
});

export const TeamSchema = z.string();

export const SafeString = z
  .string()
  .regex(
    /^([a-zA-Z0-9\s.,!?@#$%&*()\-_+=[\]{}|;:"'/\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|[üÜ])*$/u,
  )
  .max(1000);

export const PersistentIdSchema = z.uuid();
const JwtTokenSchema = z.jwt();
const TokenSchema = z
  .string()
  .refine(
    (v) =>
      PersistentIdSchema.safeParse(v).success ||
      JwtTokenSchema.safeParse(v).success,
    {
      message: "Token must be a valid UUID or JWT",
    },
  );

const EmojiSchema = z
  .number()
  .nonnegative()
  .max(flattenedEmojiTable.length - 1);

export const GAME_ID_REGEX = /^[A-Za-z0-9]{8}$/;

export const isValidGameID = (value: string): boolean =>
  GAME_ID_REGEX.test(value);

export const ID = z.string().regex(GAME_ID_REGEX);

export const AllPlayersStatsSchema = z.record(ID, PlayerStatsSchema);

export const QuickChatKeySchema = z.enum(
  Object.entries(quickChatData).flatMap(([category, entries]) =>
    entries.map((entry) => `${category}.${entry.key}`),
  ) as [string, ...string[]],
);

//
// Intents
//

export const AllianceExtensionIntentSchema = z.object({
  type: z.literal("allianceExtension"),
  recipient: ID,
});

export const AttackIntentSchema = z.object({
  type: z.literal("attack"),
  targetID: ID.nullable(),
  troops: z.number().nonnegative().nullable(),
});

export const SpawnIntentSchema = z.object({
  type: z.literal("spawn"),
  tile: z.number(),
});

export const BoatAttackIntentSchema = z.object({
  type: z.literal("boat"),
  troops: z.number().nonnegative(),
  dst: z.number(),
});

// terron: авиация — воздушная высадка десанта из ближайшего аэропорта. Спека: airport.md
export const AirAssaultIntentSchema = z.object({
  type: z.literal("air_assault"),
  troops: z.number().nonnegative(),
  dst: z.number(),
});

export const AllianceRequestIntentSchema = z.object({
  type: z.literal("allianceRequest"),
  recipient: ID,
});

export const AllianceRejectIntentSchema = z.object({
  type: z.literal("allianceReject"),
  requestor: ID,
});

export const BreakAllianceIntentSchema = z.object({
  type: z.literal("breakAlliance"),
  recipient: ID,
});

export const TargetPlayerIntentSchema = z.object({
  type: z.literal("targetPlayer"),
  target: ID,
});

export const EmojiIntentSchema = z.object({
  type: z.literal("emoji"),
  recipient: z.union([ID, z.literal(AllPlayers)]),
  emoji: EmojiSchema,
});

export const EmbargoIntentSchema = z.object({
  type: z.literal("embargo"),
  targetID: ID,
  action: z.union([z.literal("start"), z.literal("stop")]),
});

export const EmbargoAllIntentSchema = z.object({
  type: z.literal("embargo_all"),
  action: z.union([z.literal("start"), z.literal("stop")]),
});

export const DonateGoldIntentSchema = z.object({
  type: z.literal("donate_gold"),
  recipient: ID,
  gold: z.number().nonnegative().nullable(),
});

export const DonateTroopIntentSchema = z.object({
  type: z.literal("donate_troops"),
  recipient: ID,
  troops: z.number().nonnegative().nullable(),
});

export const BuildUnitIntentSchema = z.object({
  type: z.literal("build_unit"),
  unit: z.enum(UnitType),
  tile: z.number(),
  rocketDirectionUp: z.boolean().optional(),
  // terron: ультимейты — Раскол: сколько войск игрок вкладывает в «пропаганду»
  // (задаёт размер флага). Клиент считает из слайдера доли атаки.
  troops: z.number().optional(),
  // terron 24.08: «Перенос» Шагающего города — ВТОРОЙ тайл (куда идут здания).
  // tile = центр зоны, dstTile = точка назначения. new-units/WALKING.md
  dstTile: z.number().optional(),
});

export const UpgradeStructureIntentSchema = z.object({
  type: z.literal("upgrade_structure"),
  unit: z.enum(UnitType),
  unitId: z.number(),
});

export const CancelAttackIntentSchema = z.object({
  type: z.literal("cancel_attack"),
  attackID: z.string(),
});

export const CancelBoatIntentSchema = z.object({
  type: z.literal("cancel_boat"),
  unitID: z.number(),
});

export const MoveWarshipIntentSchema = z.object({
  type: z.literal("move_warship"),
  unitIds: z.array(z.number().int()).nonempty(),
  tile: z.number(),
});

export const DeleteUnitIntentSchema = z.object({
  type: z.literal("delete_unit"),
  unitId: z.number(),
});

export const QuickChatIntentSchema = z.object({
  type: z.literal("quick_chat"),
  recipient: ID,
  quickChatKey: QuickChatKeySchema,
  target: ID.optional(),
});

export const MarkDisconnectedIntentSchema = z.object({
  type: z.literal("mark_disconnected"),
  clientID: ID,
  isDisconnected: z.boolean(),
});

export const KickPlayerIntentSchema = z.object({
  type: z.literal("kick_player"),
  target: ID,
});

// terron: in-game приглашение в клан. Out-of-band (не в детерм. симуляции) —
// гейм-сервер резолвит target clientID → persistentID и зовёт platform-api.
export const ClanInviteIntentSchema = z.object({
  type: z.literal("clan_invite"),
  target: ID,
  clanTag: z.string().min(2).max(5),
});

// terron: in-game заявка в друзья. Out-of-band (как clan_invite) — гейм-сервер
// резолвит target clientID → persistentID и зовёт platform-api. См. friends.md.
export const FriendRequestIntentSchema = z.object({
  type: z.literal("friend_request"),
  target: ID,
});

// terron: in-game запрос досье игрока. Клиент знает игрока лишь по clientID —
// гейм-сервер резолвит clientID→persistentID→users.slug и шлёт назад (profile_result).
// См. friends.md (гэп «Досье in-game»).
export const GetProfileIntentSchema = z.object({
  type: z.literal("get_profile"),
  target: ID,
});

// terron: in-game жалоба на игрока. Out-of-band — гейм-сервер резолвит target
// clientID → persistentID и зовёт platform-api (клиент не знает аккаунт цели).
export const PlayerReportIntentSchema = z.object({
  type: z.literal("player_report"),
  target: ID,
  reason: z.string().max(600).default(""),
});

export const TogglePauseIntentSchema = z.object({
  type: z.literal("toggle_pause"),
  paused: z.boolean().default(false),
});

export const UpdateGameConfigIntentSchema = z.object({
  type: z.literal("update_game_config"),
  config: GameConfigSchema.partial(),
});

export const StartGameIntentSchema = z.object({
  type: z.literal("start_game"),
});

// terron: запуск отсчёта старта приватного лобби. Любой участник может послать —
// сервер сам решает длительность (хост 10с / игрок 60с) и по нулю стартует матч.
export const RequestStartIntentSchema = z.object({
  type: z.literal("request_start"),
});

// terron: отмена идущего отсчёта. Хостовый отсчёт отменяет только хост, отсчёт
// игрока — любой участник (проверка прав на сервере).
export const CancelStartIntentSchema = z.object({
  type: z.literal("cancel_start"),
});

// terron: ультимейты-ПАССИВ (напр. Реваншизм) — фиксация выбора ульты без
// постройки здания и без пуска атаки. Ядро вызывает player.chooseUltimate(unit).
export const ChooseUltimateIntentSchema = z.object({
  type: z.literal("choose_ultimate"),
  unit: z.enum(UnitType),
});

const IntentSchema = z.discriminatedUnion("type", [
  AttackIntentSchema,
  CancelAttackIntentSchema,
  SpawnIntentSchema,
  MarkDisconnectedIntentSchema,
  BoatAttackIntentSchema,
  AirAssaultIntentSchema,
  CancelBoatIntentSchema,
  AllianceRequestIntentSchema,
  AllianceRejectIntentSchema,
  BreakAllianceIntentSchema,
  TargetPlayerIntentSchema,
  EmojiIntentSchema,
  DonateGoldIntentSchema,
  DonateTroopIntentSchema,
  BuildUnitIntentSchema,
  UpgradeStructureIntentSchema,
  EmbargoIntentSchema,
  EmbargoAllIntentSchema,
  MoveWarshipIntentSchema,
  QuickChatIntentSchema,
  AllianceExtensionIntentSchema,
  DeleteUnitIntentSchema,
  KickPlayerIntentSchema,
  ClanInviteIntentSchema,
  FriendRequestIntentSchema,
  GetProfileIntentSchema,
  PlayerReportIntentSchema,
  TogglePauseIntentSchema,
  UpdateGameConfigIntentSchema,
  StartGameIntentSchema,
  RequestStartIntentSchema,
  CancelStartIntentSchema,
  ChooseUltimateIntentSchema,
]);

// StampedIntent = Intent with server-stamped clientID (used in turns and execution)
export const StampedIntentSchema = IntentSchema.and(z.object({ clientID: ID }));
export type StampedIntent = Intent & { clientID: ClientID };

//
// Server utility types
//

export const TurnSchema = z.object({
  turnNumber: z.number(),
  intents: StampedIntentSchema.array(),
  // The hash of the game state at the end of the turn.
  hash: z.number().nullable().optional(),
});

export const FlagName = z
  .string()
  .max(128)
  .refine(
    (val) => {
      if (val === undefined || val === "") return true;
      // terron: `clan:<tag>` — флаг клана (резолвится в картинку клана клиентом).
      return (
        val.startsWith("flag:") ||
        val.startsWith("country:") ||
        val.startsWith("clan:")
      );
    },
    {
      message: "Invalid flag: must start with country:, flag: or clan:",
    },
  );

export const FlagSchema = z.string();

export const PlayerPatternSchema = z.object({
  name: CosmeticNameSchema,
  patternData: PatternDataSchema,
  colorPalette: ColorPaletteSchema.optional(),
});

export const PlayerColorSchema = z.object({
  color: z.string(),
});

// Refs contain cosmetics names, will be replaced by the actual
// content in the server
// terron виральность: named-скин (custom_skins, не из реестра косметики). Несётся
// отдельным каналом — url ведёт на api.terron.io/skins/by-name/<ник>/image, режим/dim/
// плитка едут вместе, чтобы все клиенты надели текстуру владельца.
export const CustomSkinSchema = z.object({
  url: z.string(),
  mode: z.number().int(),
  dim: z.number(),
  tileTiles: z.number(),
  aspect: z.number().optional(), // imgW/imgH — для статичного mode 4
  // terron (TZ-skin-capitals.md): имя столицы «государства»-скина. Едет тем же
  // каналом косметики; сим читает его из GameStartInfo при основании столицы
  // (GameRunner → PlayerInfo). Жёсткая валидация — в Privilege.sanitize.
  capitalName: z.string().min(1).max(27).optional(),
  // terron: узор ядерного пепла (1..10 = falloutSkinMask в territory.frag.glsl).
  // ЧИСТО ВИДОВОЕ — сим его не читает, в hash не входит (как falloutOwnerPairs).
  falloutSkin: z.number().int().min(1).max(10).optional(),
});
// ⚠️ НЕ путать с Api.ts CustomSkin (это запись реестра custom_skins целиком).
// Здесь — только то, что едет по сети всем клиентам.
export type CustomSkinRef = z.infer<typeof CustomSkinSchema>;

export const PlayerCosmeticRefsSchema = z.object({
  flag: FlagName.optional(),
  color: z.string().optional(),
  patternName: CosmeticNameSchema.optional(),
  patternColorPaletteName: z.string().optional(),
  skinName: CosmeticNameSchema.optional(),
  customSkin: CustomSkinSchema.optional(),
});

export const PlayerSkinSchema = z.object({
  name: CosmeticNameSchema,
  url: z.string(),
});

// Server converts refs to the actual cosmetics here
export const PlayerCosmeticsSchema = z.object({
  flag: FlagSchema.optional(),
  pattern: PlayerPatternSchema.optional(),
  color: PlayerColorSchema.optional(),
  skin: PlayerSkinSchema.optional(),
  customSkin: CustomSkinSchema.optional(),
});

export const PlayerSchema = z.object({
  clientID: ID,
  username: UsernameSchema,
  clanTag: ClanTagSchema,
  cosmetics: PlayerCosmeticsSchema.optional(),
  isLobbyCreator: z.boolean().optional(),
  friends: z.array(ID).optional(),
  // terron: публичный хэндл аккаунта (= users.slug, тот же, что в ссылке
  // /@slug и в друзьях). Нужен клиенту, чтобы показать АВАТАРКУ игрока в
  // панели по клику. Только у залогиненных; в симуляцию не идёт — клиент
  // читает его из стартовой информации матча (client/MatchAccounts.ts).
  publicId: z.string().max(64).optional(),
});

export const GameStartInfoSchema = z.object({
  gameID: ID,
  lobbyCreatedAt: z.number(),
  visibleAt: z.number().optional(),
  config: GameConfigSchema,
  players: PlayerSchema.array(),
});

export const WinnerSchema = z
  .union([
    z.tuple([z.literal("player"), ID]).rest(ID),
    z.tuple([z.literal("team"), SafeString]).rest(ID),
    z.tuple([z.literal("nation"), SafeString]).rest(ID),
  ])
  .optional();
export type Winner = z.infer<typeof WinnerSchema>;

//
// Server
//

export const ServerTurnMessageSchema = z.object({
  type: z.literal("turn"),
  turn: TurnSchema,
});

export const ServerPingMessageSchema = z.object({
  type: z.literal("ping"),
});

export const ServerPrestartMessageSchema = z.object({
  type: z.literal("prestart"),
  gameMap: z.enum(GameMapType),
  gameMapSize: z.enum(GameMapSize),
});

export const ServerStartGameMessageSchema = z.object({
  type: z.literal("start"),
  // Turns the client missed if they are late to the game.
  turns: TurnSchema.array(),
  gameStartInfo: GameStartInfoSchema,
  lobbyCreatedAt: z.number(),
  // The clientID assigned to this connection by the server.
  // Absent for replays where the viewer has no player identity.
  myClientID: ID.optional(),
});

export const ServerDesyncSchema = z.object({
  type: z.literal("desync"),
  turn: z.number(),
  correctHash: z.number().nullable(),
  clientsWithCorrectHash: z.number(),
  totalActiveClients: z.number(),
  yourHash: z.number().optional(),
});

export const ServerErrorSchema = z.object({
  type: z.literal("error"),
  error: z.string(),
  message: z.string().optional(),
});

export const ServerLobbyInfoMessageSchema = z.object({
  type: z.literal("lobby_info"),
  lobby: GameInfoSchema,
  // The clientID assigned to this connection by the server
  myClientID: ID,
});

// terron: ЗАМКИ НА УЛЬТЫ — реле отклонило интент на закрытую ульту (нет
// владения на аккаунте). Клиенту — тост + сброс пре-выбора. TZ-ult-unlocks.md
export const ServerUltLockedSchema = z.object({
  type: z.literal("ult_locked"),
  unit: z.enum(UnitType),
  reason: z.enum(["locked", "anonymous"]),
});

// terron: результат in-game приглашения в клан — пригласившему.
export const ServerClanInviteResultSchema = z.object({
  type: z.literal("clan_invite_result"),
  status: z.enum([
    "invited",
    "already_invited",
    "pending",
    "already_member",
    "forbidden",
    "not_found",
    "error",
  ]),
  clanTag: z.string(),
  clanName: z.string().optional(),
});

// terron: уведомление приглашённому — «X зовёт в клан Y» (accept/reject в чате).
export const ServerClanInvitedSchema = z.object({
  type: z.literal("clan_invited"),
  clanTag: z.string(),
  clanName: z.string(),
  by: z.string(),
});

// terron: результат in-game заявки в друзья — отправителю (тост). См. friends.md.
export const ServerFriendRequestResultSchema = z.object({
  type: z.literal("friend_request_result"),
  status: z.enum([
    "sent",
    "already_friends",
    "already_pending",
    "limit_reached",
    "self",
    "auto_accepted",
    "target_not_found",
    "error",
  ]),
  targetName: z.string().optional(),
});

// terron: уведомление адресату — «X зовёт в друзья» (accept/reject в чате).
// requestId — id заявки для accept/decline через platform-api (bearer адресата).
export const ServerFriendRequestedSchema = z.object({
  type: z.literal("friend_requested"),
  requestId: z.string(),
  by: z.string(),
});

// terron: ответ на get_profile — отправителю. slug=null → у игрока нет аккаунта
// (аноним). target = clientID цели (чтобы клиент сматчил ответ с игроком).
export const ServerProfileResultSchema = z.object({
  type: z.literal("profile_result"),
  target: ID,
  slug: z.string().nullable(),
  name: z.string().nullable(),
});

// terron: сервер сейчас перезапустится (SIGTERM при деплое). Клиент показывает
// баннер «перезапуск → переподключение» и ждёт реконнекта. См. server-reconnect.md.
export const ServerRestartSchema = z.object({
  type: z.literal("server_restart"),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerTurnMessageSchema,
  ServerPrestartMessageSchema,
  ServerStartGameMessageSchema,
  ServerPingMessageSchema,
  ServerDesyncSchema,
  ServerErrorSchema,
  ServerLobbyInfoMessageSchema,
  ServerClanInviteResultSchema,
  ServerClanInvitedSchema,
  ServerFriendRequestResultSchema,
  ServerFriendRequestedSchema,
  ServerProfileResultSchema,
  ServerRestartSchema,
  ServerUltLockedSchema,
]);

//
// Client
//

export const ClientSendWinnerSchema = z.object({
  type: z.literal("winner"),
  winner: WinnerSchema,
  allPlayersStats: AllPlayersStatsSchema,
});

export const ClientHashSchema = z.object({
  type: z.literal("hash"),
  hash: z.number(),
  turnNumber: z.number(),
});

// terron 30.07: «меня съели». Награда за матч раньше начислялась ТОЛЬКО на
// архиве, а он приезжает в конце партии — умерший на третьей минуте сидел на
// экране смерти с пустым местом там, где обещан заработок. Но к моменту смерти
// его результат уже окончателен: дальше он ничего не наиграет. Поэтому клиент
// сообщает свой итог сразу, сервер добавляет СВОЁ время (turn) и шлёт в API.
// ⚠️ Цифры съеденного приходят от клиента — как и статистика в архиве (её тоже
// присылает клиент). Сервер их КАПИТ по составу лобби, см. routes/games.ts.
/** terron 01.08: периодический снимок статистики ВСЕХ игроков от клиента.
 *  Сервер симуляцию не считает — статистика приходила только с победой, и
 *  матчи без победителя уезжали в архив пустыми (221 из 400 за сутки на проде).
 *  Клиент шлёт снимок раз в ~30 с, сервер держит последний и кладёт в архив,
 *  если победного так и не случилось. Доверие то же, что и у сообщения
 *  "winner": статистику и там считает клиент. */
export const ClientStatsSchema = z.object({
  type: z.literal("stats"),
  allPlayersStats: AllPlayersStatsSchema,
});

export const ClientDeathSchema = z.object({
  type: z.literal("death"),
  eatenNations: z.number().int().min(0).max(1000),
  eatenPlayers: z.number().int().min(0).max(1000),
});

// terron: чем игрок РЕАЛЬНО играет — пальцем или мышью. Считается по
// pointerType живых событий (client/InputMode.ts) и шлётся, только когда
// классификация поменялась (≤3 раза за матч). Это честнее User-Agent: UA
// переключается в браузере, а тач-события подделать «мимоходом» нельзя.
// Значок 📱 в спидран-топе рисуется по нему, UA остался фолбэком.
export const InputModeSchema = z.enum(["touch", "mouse", "mixed"]);
export type InputMode = z.infer<typeof InputModeSchema>;

export const ClientInputModeSchema = z.object({
  type: z.literal("input_mode"),
  mode: InputModeSchema,
});

export const ClientLogMessageSchema = z.object({
  type: z.literal("log"),
  severity: z.enum(LogSeverity),
  log: ID,
});

export const ClientPingMessageSchema = z.object({
  type: z.literal("ping"),
});

export const ClientIntentMessageSchema = z.object({
  type: z.literal("intent"),
  intent: IntentSchema,
});

// WARNING: never send this message to clients.
// Note: clientID is NOT included - server assigns it based on persistentID from token
export const ClientJoinMessageSchema = z.object({
  type: z.literal("join"),
  token: TokenSchema, // WARNING: PII - server extracts persistentID from this
  gameID: ID,
  username: UsernameSchema,
  clanTag: ClanTagSchema,
  // Server replaces the refs with the actual cosmetic data.
  cosmetics: PlayerCosmeticRefsSchema.optional(),
  turnstileToken: z.string().nullable(),
});

export const ClientRejoinMessageSchema = z.object({
  type: z.literal("rejoin"),
  gameID: ID,
  // Note: clientID is NOT sent - server looks it up from persistentID in token
  lastTurn: z.number(),
  token: TokenSchema,
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientSendWinnerSchema,
  ClientPingMessageSchema,
  ClientIntentMessageSchema,
  ClientJoinMessageSchema,
  ClientRejoinMessageSchema,
  ClientLogMessageSchema,
  ClientHashSchema,
  ClientInputModeSchema,
  ClientDeathSchema,
  ClientStatsSchema,
]);

//
// Records
//

export const PlayerRecordSchema = PlayerSchema.extend({
  persistentID: PersistentIdSchema.nullable(), // WARNING: PII
  stats: PlayerStatsSchema,
  // terron: был ли игрок отключён к концу матча (для отметки «сбежал»/abandon
  // в финальном архиве — leave-стаба больше нет).
  disconnected: z.boolean().optional(),
  // terron: устройство по UA WebSocket-апгрейда (server/Device.ts). Клиент
  // это поле не шлёт — ставит игровой сервер при архивации. ФОЛБЭК для
  // значка в топе: основной сигнал — inputMode ниже.
  device: z.enum(["mobile", "tablet", "desktop"]).optional(),
  // terron: чем играли на самом деле (тач/мышь/смешанно) — по живым
  // pointer-событиям матча. Сильнее UA, поэтому значок «забег с телефона»
  // рисуется по нему.
  inputMode: InputModeSchema.optional(),
});
export type PlayerRecord = z.infer<typeof PlayerRecordSchema>;

export const GameEndInfoSchema = GameStartInfoSchema.extend({
  players: PlayerRecordSchema.array(),
  start: z.number(),
  end: z.number(),
  duration: z.number().nonnegative(),
  num_turns: z.number(),
  winner: WinnerSchema,
  lobbyFillTime: z.number().nonnegative(),
});
export type GameEndInfo = z.infer<typeof GameEndInfoSchema>;

const GitCommitSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{40}$/)
  .or(z.literal("DEV"));

export const PartialAnalyticsRecordSchema = z.object({
  info: GameEndInfoSchema,
  version: z.literal("v0.0.2"),
});
export type ClientAnalyticsRecord = z.infer<
  typeof PartialAnalyticsRecordSchema
>;

export const AnalyticsRecordSchema = PartialAnalyticsRecordSchema.extend({
  gitCommit: GitCommitSchema,
  subdomain: z.string(),
  domain: z.string(),
  // terron: эпоха баланса, при которой сыгран матч (TERRON_BALANCE_EPOCH).
  // Проставляет ИГРОВОЙ СЕРВЕР (Archive.finalizeGameRecord) — по ней спидран-топ
  // делится на «актуальный» и «архив». optional: старые записи без поля.
  balanceEpoch: z.number().int().nonnegative().optional(),
  balanceLabel: z.string().max(64).optional(),
});

export type AnalyticsRecord = z.infer<typeof AnalyticsRecordSchema>;

export const GameRecordSchema = AnalyticsRecordSchema.extend({
  turns: TurnSchema.array(),
});

export const PartialGameRecordSchema = PartialAnalyticsRecordSchema.extend({
  turns: TurnSchema.array(),
});

export type PartialGameRecord = z.infer<typeof PartialGameRecordSchema>;

export type GameRecord = z.infer<typeof GameRecordSchema>;

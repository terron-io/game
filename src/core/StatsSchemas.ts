import { z } from "zod";
import { UnitType } from "./game/Game";

export const bombUnits = ["abomb", "hbomb", "mirv", "mirvw"] as const;
export const BombUnitSchema = z.enum(bombUnits);
export type BombUnit = z.infer<typeof BombUnitSchema>;
export type NukeType =
  | UnitType.AtomBomb
  | UnitType.HydrogenBomb
  | UnitType.MIRV
  | UnitType.MIRVWarhead;

export const unitTypeToBombUnit = {
  [UnitType.AtomBomb]: "abomb",
  [UnitType.HydrogenBomb]: "hbomb",
  [UnitType.MIRV]: "mirv",
  [UnitType.MIRVWarhead]: "mirvw",
} as const satisfies Record<NukeType, BombUnit>;

export const boatUnits = ["trade", "trans"] as const;
export const BoatUnitSchema = z.enum(boatUnits);
export type BoatUnit = z.infer<typeof BoatUnitSchema>;
export type BoatUnitType = UnitType.TradeShip | UnitType.TransportShip;

// export const unitTypeToBoatUnit = {
//   [UnitType.TradeShip]: "trade",
//   [UnitType.TransportShip]: "trans",
// } as const satisfies Record<BoatUnitType, BoatUnit>;

export const otherUnits = [
  "city",
  "defp",
  "port",
  "wshp",
  "silo",
  "saml",
  "fact",
  "sats", // terron: запуск ракеты «Сбить спутники» (Небо наше) — пишется при ЗАПУСКЕ, не при сборке
] as const;
export const OtherUnitSchema = z.enum(otherUnits);
export type OtherUnit = z.infer<typeof OtherUnitSchema>;
export type OtherUnitType =
  | UnitType.City
  | UnitType.DefensePost
  | UnitType.MissileSilo
  | UnitType.Port
  | UnitType.SAMLauncher
  | UnitType.Warship
  | UnitType.Factory
  | UnitType.SatelliteStrike;

export const unitTypeToOtherUnit = {
  [UnitType.City]: "city",
  [UnitType.DefensePost]: "defp",
  [UnitType.MissileSilo]: "silo",
  [UnitType.Port]: "port",
  [UnitType.SAMLauncher]: "saml",
  [UnitType.Warship]: "wshp",
  [UnitType.Factory]: "fact",
  [UnitType.SatelliteStrike]: "sats",
} as const satisfies Record<OtherUnitType, OtherUnit>;

// Attacks
export const ATTACK_INDEX_SENT = 0; // Outgoing attack troops
export const ATTACK_INDEX_RECV = 1; // Incmoing attack troops
export const ATTACK_INDEX_CANCEL = 2; // Cancelled attack troops

// Player types
export const PLAYER_INDEX_HUMAN = 0;
export const PLAYER_INDEX_NATION = 1;
export const PLAYER_INDEX_BOT = 2;

// Boats
export const BOAT_INDEX_SENT = 0; // Boats launched
export const BOAT_INDEX_ARRIVE = 1; // Boats arrived
export const BOAT_INDEX_CAPTURE = 2; // Boats captured
export const BOAT_INDEX_DESTROY = 3; // Boats destroyed

// Bombs
export const BOMB_INDEX_LAUNCH = 0; // Bombs launched
export const BOMB_INDEX_LAND = 1; // Bombs landed
export const BOMB_INDEX_INTERCEPT = 2; // Bombs intercepted

// Gold
export const GOLD_INDEX_WORK = 0; // Gold earned by workers
export const GOLD_INDEX_WAR = 1; // Gold earned by conquering players
export const GOLD_INDEX_TRADE = 2; // Gold earned by trade ships
export const GOLD_INDEX_STEAL = 3; // Gold earned by capturing trade ships
export const GOLD_INDEX_TRAIN_SELF = 4; // Gold earned by own trains
export const GOLD_INDEX_TRAIN_OTHER = 5; // Gold earned by other players trains

// Other Units
export const OTHER_INDEX_BUILT = 0; // Structures and warships built
export const OTHER_INDEX_DESTROY = 1; // Structures and warships destroyed
export const OTHER_INDEX_CAPTURE = 2; // Structures captured
export const OTHER_INDEX_LOST = 3; // Structures/warships destroyed/captured by others
export const OTHER_INDEX_UPGRADE = 4; // Structures upgraded

export const BigIntStringSchema = z.preprocess((val) => {
  if (val === null) return 0n;
  if (typeof val === "string" && /^-?\d+$/.test(val)) return BigInt(val);
  if (typeof val === "bigint") return val;
  return val;
}, z.bigint());

const AtLeastOneNumberSchema = BigIntStringSchema.array().min(1);
export type AtLeastOneNumber = z.infer<typeof AtLeastOneNumberSchema>;

export const PlayerStatsSchema = z
  .object({
    attacks: AtLeastOneNumberSchema.optional(),
    betrayals: BigIntStringSchema.optional(),
    // terron: ДВОРЕЦ НАЦИЙ — сколько раз МЕНЯ предали (ключ ульты: 20 раз).
    betrayed: BigIntStringSchema.optional(),
    killedAt: BigIntStringSchema.optional(),
    conquests: AtLeastOneNumberSchema.optional(),
    // terron: союзы, индексировано по типу союзника [человек, нация, племя]
    // (как conquests). Для статистики и ачивок «Друг племени»/«Друг нации».
    alliances: AtLeastOneNumberSchema.optional(),
    boats: z.partialRecord(BoatUnitSchema, AtLeastOneNumberSchema).optional(),
    bombs: z.partialRecord(BombUnitSchema, AtLeastOneNumberSchema).optional(),
    gold: AtLeastOneNumberSchema.optional(),
    units: z.partialRecord(OtherUnitSchema, AtLeastOneNumberSchema).optional(),
    // terron ФФА-рейтинг (RATING.md): счётчики съедений с долей ≥40%.
    // Пишутся только у ЛЮДЕЙ (у ботов нет clientID/статов) — данные «Наций»
    // выводятся из этих счётчиков на архиве. См. StatsImpl.ffaConquer.
    ffaEatHumans: BigIntStringSchema.optional(), // людей съел ≥40% → мне +1
    ffaEatBots: BigIntStringSchema.optional(), // ботов съел ≥40% → «Нации» −штраф
    ffaBotEatersOfMe: BigIntStringSchema.optional(), // меня боты ≥40% → «Нации» +1
    // terron: ультимейты — зафиксированный выбор (строка UnitType) для
    // статистики пиков/винрейта на /balance. new-units/ULTIMATES.md
    ult: z.string().optional(),
    // terron: ГОРДОСТЬ — доля карты в сотых процента: пик и провал после пика
    // (ключ «Феникс»: ≥50 % → ≤10 % → победа). GameImpl раз в секунду.
    peakPct: BigIntStringSchema.optional(),
    dipPct: BigIntStringSchema.optional(),
    // terron: ЗНАМЯ ПОБЕДЫ — захвачено чужих столиц за матч (ключ: 100 за карьеру).
    capitalsCaptured: BigIntStringSchema.optional(),
    // terron: ТОПЛИВО — ключ «Нефтяник»: МАКСИМУМ одновременно стоявших
    // нефтяных вышек за матч. Именно пик, а не «построено за карьеру»
    // (решение владельца 23.08). FUEL.md
    oilRigsPeak: BigIntStringSchema.optional(),
    // terron: ДОРА — ключ «Осадный»: вражеских зданий снесено ДРОНАМИ. DORA.md
    dronedBuildings: BigIntStringSchema.optional(),
    // terron 24.08: ТОПЛИВНАЯ ЦЕПОЧКА (Топливо → Дора → Депо смерти).
    // Ключ Топлива: МАКСИМУМ суммы уровней фабрик одновременно за матч
    // (депо весит как 5 фабрик — actsAsCount из реестра).
    factoryLevelsPeak: BigIntStringSchema.optional(),
    // terron: ШАГАЮЩИЙ ГОРОД — пик суммы уровней всех зданий одновременно.
    buildingLevelsPeak: BigIntStringSchema.optional(),
    // Ключ Доры: поездов отправлено со своих станций за матч.
    trainsSent: BigIntStringSchema.optional(),
    // Ключ Депо смерти: ульт-зданий (чужих И своих) снесено выстрелами Доры.
    railgunUltKills: BigIntStringSchema.optional(),
  })
  .optional();
export type PlayerStats = z.infer<typeof PlayerStatsSchema>;

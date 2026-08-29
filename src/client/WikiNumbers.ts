import { Config } from "../core/configuration/Config";
import * as T from "../core/configuration/TerronTuning";
import { blockadeFlagSize } from "../core/game/BlockadeGeometry";
import {
  Difficulty,
  Game,
  GameMode,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../core/game/Game";
import { GameConfig } from "../core/Schemas";

/**
 * terron: ЦИФРЫ ВИКИ — ЖИВЫЕ, из тех же модулей, что кормят симуляцию.
 *
 * Зачем файл: раньше в тексте вики числа были вбиты руками («5M золота»,
 * «300 тайлов»), и после правки баланса вики молча врала. Теперь текст берёт
 * значение ОТСЮДА, а сюда оно приходит из `TerronTuning.ts` и `Config.ts` —
 * покрутил баланс, вики обновилась сама, без скрипта и без правки текстов.
 *
 * Как это работает: `Config` — обычный класс, его методы (радиусы, кулдауны,
 * цены юнитов) не требуют живой игры. Собираем инстанс на «пустом» конфиге
 * лобби и опрашиваем. Ценам нужен игрок — подсовываем заглушку, которая
 * отвечает только на то, что спрашивает `unitInfo` (сколько уже построено,
 * есть ли ульта, чит-флаги). Это ЧТЕНИЕ, симуляции тут нет.
 *
 * ⚠️ Значения, которые вывести из кода нельзя (производные вроде «кольцо за
 * 25 секунд»), считаются формулой НИЖЕ, в блоке DERIVED, — с комментарием,
 * откуда вывод. Хардкодить число в тексте карточки нельзя.
 */

// Конфиг лобби для опроса: базовый публичный ФФА без читов. Поля, которых нет,
// Config читает через `?? default` — поэтому минимального набора достаточно.
const WIKI_GAME_CONFIG = {
  gameMode: GameMode.FFA,
  difficulty: Difficulty.Medium,
  bots: 400,
  instantBuild: false,
  infiniteGold: false,
  infiniteTroops: false,
} as unknown as GameConfig;

const C = new Config(WIKI_GAME_CONFIG, null, false);

/**
 * Заглушка игрока: отвечает ровно на то, что спрашивают формулы цен.
 * `built` — сколько уже построено ИМЕННО запрошенного типа (у порта и фабрики
 * счётчик цены общий, но лестницу цен показываем «как если строить только их»).
 */
function stubPlayer(built: Partial<Record<UnitType, number>> = {}): Player {
  const count = (t: UnitType): number => built[t] ?? 0;
  return {
    type: () => PlayerType.Human,
    unitsOwned: count,
    unitsConstructed: count,
    units: () => [],
    unitCount: count,
    hasUltimate: () => false,
    isLobbyCreator: () => false,
    numTilesOwned: () => 0,
  } as unknown as Player;
}

/** Заглушка игры: нужна только цене МИРВ (счётчик уже запущенных, bigint). */
function stubGame(mirvsLaunched = 0): Game {
  return {
    stats: () => ({ numMirvsLaunched: () => BigInt(mirvsLaunched) }),
  } as unknown as Game;
}

// ── форматтеры ──────────────────────────────────────────────────────────────

/** Разряды неразрывными пробелами: 250000 → «250 000». Читается на обоих языках. */
export function n(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Золото коротко: 5000000 → «5M», 125000 → «125k», меньше — разрядами. */
export function gold(value: number | bigint): string {
  const v = Number(value);
  // Десятая доля нужна только у мелких значений: 8.3k читается, а «105.0k» —
  // это артефакт округления сигмоиды, там уместнее целое.
  const short = (x: number, unit: string): string =>
    `${x >= 10 || Number.isInteger(x) ? Math.round(x) : x.toFixed(1)}${unit}`;
  if (v >= 1_000_000) return short(v / 1_000_000, "M");
  if (v >= 1000) return short(v / 1000, "k");
  return n(v);
}

/** Тики → секунды числом: 600 → 60. */
export function toSec(ticks: number): number {
  return ticks / 10;
}

/**
 * ⚠️ ВОЙСКА: внутри симуляции они хранятся В ДЕСЯТЬ РАЗ КРУПНЕЕ, чем игрок
 * видит на экране — HUD печатает их через `renderTroops` = `число / 10`.
 * Поэтому ЛЮБОЕ значение войск из Config (потолок, прирост от города, стартовый
 * состав) обязано пройти через эту функцию, иначе вики соврёт на порядок.
 * Золото такого деления НЕ имеет — оно печатается как есть.
 */
export function troops(internal: number): string {
  return n(internal / 10);
}

/** Проценты из доли: 0.85 → «15» (для «−15 % потерь» считать снаружи). */
export function pct(fraction: number): string {
  const p = fraction * 100;
  return Number.isInteger(p) ? String(p) : p.toFixed(1).replace(".", ",");
}

// ── цены и время постройки (живые, из Config.unitInfo) ──────────────────────

/** Цена юнита при `built` уже построенных (уровнях). */
export function costOf(type: UnitType, built = 0, mirvsLaunched = 0): string {
  const info = C.unitInfo(type);
  return gold(
    info.cost(stubGame(mirvsLaunched), stubPlayer({ [type]: built })),
  );
}

/** Длительность постройки в секундах (0 — строится мгновенно). */
export function buildSec(type: UnitType): number {
  return toSec(C.unitInfo(type).constructionDuration ?? 0);
}

/** Максимальный уровень апгрейда (undefined — без ограничения). */
export function maxLevel(type: UnitType): number | undefined {
  return C.unitInfo(type).maxLevel;
}

// ── величины боя и мира (живые, из Config) ──────────────────────────────────

export const CFG = {
  tickMs: C.msPerTick(),

  // здания
  structureMinDist: C.structureMinDist(),
  defensePostRange: C.defensePostRange(),
  defensePostDefenseBonus: C.defensePostDefenseBonus(),
  defensePostSpeedBonus: C.defensePostSpeedBonus(),
  defensePostShellRate: toSec(C.defensePostShellAttackRate()),
  defensePostTargetRange: C.defensePostTargettingRange(),
  cityTroopIncrease: C.cityTroopIncrease(),

  // ПВО и шахты
  samCooldown: toSec(C.SAMCooldown()),
  siloCooldown: toSec(C.SiloCooldown()),
  samRangeL1: Math.round(C.samRange(1)),
  samRangeL5: Math.round(C.samRange(5)),
  samRangeMax: C.maxSamRange(),
  samMissileSpeed: C.defaultSamMissileSpeed(),

  // ракеты
  nukeSpeed: C.defaultNukeSpeed(),
  nukeRange: C.defaultNukeTargetableRange(),
  nukeAllianceBreak: C.nukeAllianceBreakThreshold(),
  atom: C.nukeMagnitudes(UnitType.AtomBomb),
  hydrogen: C.nukeMagnitudes(UnitType.HydrogenBomb),
  mirvWarhead: C.nukeMagnitudes(UnitType.MIRVWarhead),
  drone: C.nukeMagnitudes(UnitType.SuicideDrone),

  // флот
  boatMax: C.boatMaxNumber(),
  warshipHealth: C.unitInfo(UnitType.Warship).maxHealth ?? 0,
  shellDamage: C.unitInfo(UnitType.Shell).damage ?? 0,
  warshipShellRate: toSec(C.warshipShellAttackRate()),
  warshipPatrolRange: C.warshipPatrolRange(),
  warshipTargetRange: C.warshipTargettingRange(),
  warshipRetreatHp: C.warshipRetreatHealthThreshold(),
  warshipHealPerTick: C.warshipPassiveHealing(),
  warshipHealRange: C.warshipPassiveHealingRange(),
  warshipPortHealPerLevel: C.warshipPortHealingBonusPerLevel(),

  // авиация
  airportRange: C.airportRange(),
  airplaneSpeed: C.airplaneSpeed(),
  droneCooldown: toSec(C.AirportDroneCooldown()),

  // ж/д и торговля
  railMin: C.trainStationMinRange(),
  railMax: C.trainStationMaxRange(),
  tradeShortRange: C.tradeShipShortRangeDebuff(),

  // столица
  capitalAmount: Number(C.CapitalGoldAmount()),
  capitalIntervalSec: toSec(C.CapitalGoldIntervalTicks()),

  // мир и дипломатия
  minPlayerDist: C.minDistanceBetweenPlayers(),
  winPercentFfa: 80,
  winPercentTeam: 95,
  allianceMin: toSec(C.allianceDuration()) / 60,
  allianceRequestSec: toSec(C.allianceRequestDuration()),
  allianceRequestCooldownSec: toSec(C.allianceRequestCooldown()),
  embargoMin: toSec(C.temporaryEmbargoDuration()) / 60,
  embargoAllCooldownSec: toSec(C.embargoAllCooldown()),
  traitorSec: toSec(C.traitorDuration()),
  traitorDefense: C.traitorDefenseDebuff(),
  traitorSpeed: C.traitorSpeedDebuff(),
  donateCooldownSec: toSec(C.donateCooldown()),
  targetSec: toSec(C.targetDuration()),
  targetCooldownSec: toSec(C.targetCooldown()),
  deleteMarkSec: toSec(C.deletionMarkDuration()),
  deleteCooldownSec: toSec(C.deleteUnitCooldown()),

  // население и доход
  goldPerTickHuman: Number(C.goldAdditionRate(stubPlayer())),
  startManpowerHuman: C.startManpower({
    playerType: PlayerType.Human,
  } as PlayerInfo),
  startManpowerBot: C.startManpower({
    playerType: PlayerType.Bot,
  } as PlayerInfo),
} as const;

/** Стартовые войска нации по сложности (живой опрос Config). */
export function nationStartTroops(difficulty: Difficulty): number {
  const cfg = new Config(
    { ...WIKI_GAME_CONFIG, difficulty } as unknown as GameConfig,
    null,
    false,
  );
  return cfg.startManpower({ playerType: PlayerType.Nation } as PlayerInfo);
}

/** Оплата поезда за остановку (живой опрос Config.trainGold). */
export function trainGold(
  rel: "self" | "team" | "ally" | "other",
  citiesVisited = 0,
): string {
  return gold(C.trainGold(rel, citiesVisited, stubPlayer()));
}

/** Доход торгового корабля/самолёта на дистанции (живой опрос Config). */
export function tradeGold(dist: number): string {
  return gold(C.tradeShipGold(dist, stubPlayer()));
}

/** Ожидаемое число поездов при N фабриках (см. комментарий Config.trainSpawnRate). */
export function trainSpawnRate(factories: number): number {
  return C.trainSpawnRate(factories);
}

// ── терроновские константы (напрямую из TerronTuning) ───────────────────────

export const TUN = {
  lobbySec: T.TERRON_LOBBY_START_SECONDS,
  spawnSec: T.TERRON_SPAWN_PHASE_SECONDS,
  spawnPvpSec: T.TERRON_SPAWN_PHASE_PVP_SECONDS,
  spawnGraceSec: T.TERRON_SPAWN_GRACE_SECONDS,
  spawnW: T.TERRON_SPAWN_RECT_HALF_W * 2 + 1,
  spawnH: T.TERRON_SPAWN_RECT_HALF_H * 2 + 1,

  fogRadius: T.TERRON_FOG_VISION_RADIUS,
  fogRevealSec: toSec(T.TERRON_FOG_REVEAL_HOLD_TICKS),
  fogCollapseSec: toSec(T.TERRON_FOG_REVEAL_COLLAPSE_TICKS),

  goldenRewardPts: T.TERRON_GOLDEN_REWARD_PTS,
  goldenPeriodMin: T.goldenPeriodMin(),
  diamondRewardPts: T.diamondRewardPts(),
  diamondSchedule: T.diamondScheduleLabel(),

  nationMinTiles: T.TERRON_NATION_MIN_TILES,
  nationCollapsePeak: T.TERRON_NATION_COLLAPSE_MIN_PEAK,
  nationCollapsePct: T.TERRON_NATION_COLLAPSE_FRAC * 100,

  ultCost: T.TERRON_ULT_BUILDING_COST,
  ultBuildSec: toSec(T.TERRON_ULT_BUILDING_BUILD_TICKS),
  capturedUltSec: toSec(T.TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS),

  // terron 06.08: аура влита в МЕДИА и усилена — в вики показываем ИТОГОВЫЕ
  // цифры штаба МЕДИА (база Мин правды × множители), а не базовые.
  ministryRadius:
    T.TERRON_MINISTRY_RADIUS * T.TERRON_MEDIA_MINISTRY_RADIUS_MULT,
  ministryPeriodSec: toSec(T.TERRON_MINISTRY_PERIOD_TICKS),
  ministryDrainPct:
    T.TERRON_MINISTRY_DRAIN_PCT * T.TERRON_MEDIA_MINISTRY_POWER_MULT * 100,
  ministryConvertPct: T.TERRON_MINISTRY_CONVERT_PCT * 100,
  ministrySecondMult: T.TERRON_MINISTRY_SECOND_MULT,

  fortPeriodSec: toSec(T.TERRON_FORT_PERIOD_TICKS),
  fortTilesPulse: T.TERRON_FORT_TILES_PER_PULSE,
  fortNearPct: T.TERRON_FORT_NEAR_POWER_PCT,
  fortFarPct: T.TERRON_FORT_FAR_POWER_PCT,

  religionPeriodSec: toSec(T.TERRON_RELIGION_PERIOD_TICKS),
  religionReach: T.TERRON_RELIGION_REACH,
  religionTilesBase: T.TERRON_RELIGION_TILES_BASE,
  religionTilesPerTemple: T.TERRON_RELIGION_TILES_PER_TEMPLE,
  religionTithePct: Number(T.TERRON_RELIGION_TITHE_PCT),
  religionCostPlains: T.TERRON_RELIGION_COST_PLAINS,
  religionCostHighland: T.TERRON_RELIGION_COST_HIGHLAND,
  religionCostMountain: T.TERRON_RELIGION_COST_MOUNTAIN,

  splitBaseGold: Number(T.TERRON_SPLIT_BASE_GOLD),
  splitMinTiles: T.TERRON_SPLIT_MIN_BASE_TILES,
  splitRescueSec: toSec(T.TERRON_SPLIT_RESCUE_TURNS),
  splitAllyAttackerSec: toSec(T.TERRON_SPLIT_ALLY_TURNS_ATTACKER),
  splitAllyVictimSec: toSec(T.TERRON_SPLIT_ALLY_TURNS_VICTIM),
  splitTroopMult: T.TERRON_SPLIT_TROOP_MULT,

  miningKillPct: T.TERRON_MINING_KILL_PCT * 100,

  oilRigTradeMult: Number(T.TERRON_OILRIG_TRADE_MULT),
  oilRigBaseCost: T.TERRON_OILRIG_BASE_COST,
  oilRigLandGuard: T.TERRON_OILRIG_MIN_DIST_FROM_LAND,
  oilRigWeight: T.TERRON_OILRIG_TRADE_WEIGHT,
  oilRigHealMult: T.TERRON_OILRIG_HEAL_MULT,
  oilRigBuildSec: toSec(T.TERRON_OILRIG_BUILD_TICKS),

  riversNukeInner: T.TERRON_RIVERS_NUKE_INNER,
  riversNukeOuter: T.TERRON_RIVERS_NUKE_OUTER,
  riversNukeCost: T.TERRON_RIVERS_NUKE_COST,

  revanchismScale: T.TERRON_REVANCHISM_SCALE,
  revanchismMaxPct: T.TERRON_REVANCHISM_MAX_BUFF * 100,

  ourSkyBuildSec: toSec(T.TERRON_OURSKY_BUILD_TICKS),
  ourSkyBlastSec: toSec(T.TERRON_OURSKY_BLAST_DELAY_TICKS),
  ourSkyBlackoutSec: toSec(T.TERRON_OURSKY_BLACKOUT_TICKS),
  // terron: реворк Неба 21.08 — штаб-ПВО ×5 + пассив перезарядки + цена каста.
  ourSkySamMult: T.TERRON_OURSKY_SAM_RADIUS_MULT,
  ourSkyReloadMult: T.TERRON_OURSKY_SAM_RELOAD_MULT,
  satStrikeCost: T.TERRON_SATSTRIKE_COST,
  // terron: Пиратство — тихие высадки + блокада.
  pirateStealthRadius: T.TERRON_PIRACY_STEALTH_REVEAL_RADIUS,
  pirateStealthPortRadius: T.TERRON_PIRACY_STEALTH_PORT_RADIUS,
  blockadeCost: T.TERRON_BLOCKADE_COST,
  // terron: Гордость + перемирие.
  prideCost: T.TERRON_PRIDE_COST,
  respiteCost: T.TERRON_RESPITE_COST,
  /** Дворец наций: каст «Пакт» и пассивы (PEACE.md). */
  pactCost: T.TERRON_PACT_COST,
  pactMin: 5,
  pactRecastMin: Math.round(T.TERRON_PACT_RECAST_COOLDOWN_TICKS / 600),
  peaceTraitorSec: toSec(T.TERRON_PEACE_TRAITOR_TICKS),
  peaceNationAllies: T.TERRON_PEACE_NATION_ALLIES,
  // terron: ЗЕЛЁНЫЕ (new-units/GREEN.md)
  greensTroopPct: Math.round(T.TERRON_GREENS_TROOP_BONUS * 100),
  greensGoldPct: Math.round(T.TERRON_GREENS_GOLD_PENALTY * 100),
  greensFalloutEase: T.TERRON_GREENS_FALLOUT_EASE,
  catastropheCost: T.TERRON_CATASTROPHE_COST,
  catastropheStepPct: Math.round(T.TERRON_GREENS_DEBUFF_STEP * 100),
  catastropheMaxPct: Math.round(
    T.TERRON_GREENS_DEBUFF_STEP * T.TERRON_GREENS_DEBUFF_MAX_STACKS * 100,
  ),
  catastropheSec: Math.round(T.TERRON_GREENS_DEBUFF_TICKS / 10),
  catastropheRecastMin: Math.round(
    T.TERRON_CATASTROPHE_RECAST_COOLDOWN_TICKS / 600,
  ),
  // terron: АЭС (new-units/NUCLEAR.md)
  nuclearDiscountPct: Math.round(T.TERRON_NUCLEAR_NUKE_DISCOUNT * 100),
  nuclearFalloutEase: T.TERRON_NUCLEAR_FALLOUT_EASE,
  recultCost: T.TERRON_RECULT_COST,
  recultRadius: T.TERRON_RECULT_RADIUS,
  recultPerTile: T.TERRON_RECULT_GOLD_PER_TILE,
  chernobylSec: Math.round(T.TERRON_CHERNOBYL_DELAY_TICKS / 10),
  // terron: ТОПЛИВО (new-units/FUEL.md)
  fuelSpeedMult: T.TERRON_FUEL_SPEED_MULT,
  industrialCost: T.TERRON_INDUSTRIAL_COST,
  industrialSpeedMult: T.TERRON_INDUSTRIAL_SPEED_MULT,
  industrialTroopPct: Math.round(T.TERRON_INDUSTRIAL_TROOP_PENALTY * 100),
  industrialMin: Math.round(T.TERRON_INDUSTRIAL_TICKS / 600),
  fuelKeyOilRigs: T.TERRON_FUEL_KEY_OILRIGS,
  // terron: ДОРА (new-units/DORA.md)
  railGunRange: T.TERRON_RAILGUN_RANGE,
  trainsCost: T.TERRON_TRAINS_COST,
  railGunShotCost: T.TERRON_RAILGUN_SHOT_COST,
  railGunReloadSec: Math.round(T.TERRON_RAILGUN_RELOAD_TICKS / 10),
  railGunGraceSec: Math.round(T.TERRON_RAILGUN_FOREIGN_GRACE_TICKS / 10),
  railGunKeyDroned: T.TERRON_RAILGUN_KEY_DRONED,
  // terron: ШАГАЮЩИЙ ГОРОД (new-units/WALKING.md)
  walkCost: T.TERRON_WALK_COST,
  walkRatioMaxPct: Math.round(T.TERRON_WALK_RATIO_MAX * 100),
  // terron: КОСМОДРОМ / МИРНОЕ НЕБО / ЦЕНТРОБАНК
  spaceportPeriodSec: Math.round(T.TERRON_SPACEPORT_PERIOD_TICKS / 10),
  spaceportFlat: T.TERRON_SPACEPORT_FLAT,
  spaceportTaxPct: T.TERRON_SPACEPORT_TAX_PCT,
  spaceportSeaMult: T.TERRON_SPACEPORT_SEA_MULT,
  spaceportKeyGold: T.TERRON_SPACEPORT_KEY_GOLD,
  skySamDiscountPct: Math.round(T.TERRON_PEACEFUL_SKY_SAM_DISCOUNT * 100),
  skyKeyIntercepts: T.TERRON_PEACEFUL_SKY_KEY_INTERCEPTS,
  bankPeriodSec: Math.round(T.TERRON_CENTRALBANK_PERIOD_TICKS / 10),
  bankPct: T.TERRON_CENTRALBANK_PCT,
  bankCap: T.TERRON_CENTRALBANK_CAP,
  // terron: Знамя победы.
  bannerCapitalMult: T.TERRON_BANNER_CAPITAL_MULT,
  bannerCapitalPerMin:
    Number(C.CapitalGoldAmount()) *
    T.TERRON_BANNER_CAPITAL_MULT *
    (600 / C.CapitalGoldIntervalTicks()),
  // terron: Фанатизм + Террор.
  fanaticTroopsMult: 1 + T.TERRON_FANATICISM_TROOPS_BONUS,
  fanaticGoldMult: T.TERRON_FANATICISM_GOLD_MULT,
  fanaticAttackLoss: T.TERRON_FANATICISM_ATTACK_LOSS_MULT,
  terrorCost: T.TERRON_TERROR_COST,
  terrorSec: toSec(T.TERRON_TERROR_TICKS),
  terrorBlasts10: T.terrorBlasts(0.1),
  terrorBlasts50: T.terrorBlasts(0.5),
  terrorBlasts100: T.terrorBlasts(1),
  // terron: Олимпийские игры.
  olympicsCost: T.TERRON_OLYMPICS_COST,
  olympicsBonusPct: Math.round(T.TERRON_OLYMPICS_BONUS * 100),
  olympicsGamesBonusPct: Math.round(T.TERRON_OLYMPICS_GAMES_BONUS * 100),
  truceCost: T.TERRON_TRUCE_COST,
  truceSec: toSec(T.TERRON_TRUCE_TICKS),
  truceCooldownMin: Math.round(T.TERRON_TRUCE_COOLDOWN_TICKS / 600),
  olympicsKeyGold: 10_000_000_000,
  respite20: toSec(T.respiteTicks(0.2)),
  respite50: toSec(T.respiteTicks(0.5)),
  respite100: toSec(T.respiteTicks(1)),
  prideKeyPeak: T.TERRON_PRIDE_KEY_PEAK_PCT,
  prideKeyDip: T.TERRON_PRIDE_KEY_DIP_PCT,
  blockadePortRange: T.TERRON_BLOCKADE_PORT_RANGE,
  blockadeHw15: blockadeFlagSize(15).hw,

  tankLossPct: Math.round((1 - T.TERRON_TANK_ATTACK_MULT) * 100),

  airborneLandingPct: T.TERRON_AIRBORNE_LANDING_FACTOR * 100,
  beachheadSec: toSec(T.TERRON_AIRBORNE_BEACHHEAD_IMMUNITY_TURNS),
  beachheadUltSec: toSec(T.TERRON_AIRBORNE_BEACHHEAD_IMMUNITY_ULT_TURNS),
  airplaneTaxPct: Number(T.TERRON_AIRPLANE_TAX_PERMILLE) / 10,

  capitalPerMin:
    Number(T.TERRON_CAPITAL_GOLD_AMOUNT) *
    (600 / T.TERRON_CAPITAL_GOLD_INTERVAL_TICKS),
} as const;

// Параметры для translateText("build_menu.desc.*") — цифры баланса в описаниях
// зданий берём из тюнинга, а не хардкодим в lang-строках (ловили «50%» в тексте
// минирования при 90% в коде на деве). Передавать во ВСЕХ местах, где рендерится
// build_menu.desc с динамическим ключом.
export const BUILD_DESC_PARAMS = {
  mining_pct: TUN.miningKillPct,
} as const;

// ── DERIVED: производные величины (считаем, а не хардкодим) ─────────────────

export const DERIVED = {
  /** Пассивный доход в секунду: ставка за тик × 10 тиков. */
  goldPerSecond: CFG.goldPerTickHuman * 10,

  /** Мощность автозахвата Укреплений вплотную к бункеру, тайлов за импульс. */
  fortTilesNear: Math.round((TUN.fortTilesPulse * TUN.fortNearPct) / 100),
  fortTilesFar: Math.round((TUN.fortTilesPulse * TUN.fortFarPct) / 100),

  /**
   * Религия: полный обход границы = одно «кольцо» роста. Период обхода —
   * прямой конфиг, кольцо на его конце.
   */
  religionRingSec: TUN.religionPeriodSec,

  /** Религия: квота на пограничный тайл при N храмах = BASE + PER_TEMPLE × N. */
  religionTilesFor: (temples: number): number =>
    TUN.religionTilesBase + TUN.religionTilesPerTemple * temples,

  /**
   * Аэропорт: рейс отправляется с шансом 1/18 за проверку, проверка раз в
   * 10 тиков (1 с) → в среднем борт раз в ~18 с ожидания решения + задержка
   * вылета 2–7 с. Константы DISPATCH_ONE_IN/DELAY живут в AirportExecution.
   */
  airportDispatchOneIn: 18,
  airportDelayMinSec: 2,
  airportDelayMaxSec: 7,

  /** Порт: кулдаун самоторговли и шанс рейса «на себя» (PortExecution). */
  portSelfTradeOneIn: 10,
  portSelfTradeCooldownSec: 15,

  /** Доля своих войск в атаке по умолчанию — ползунок атаки (UserSettings). */
  attackRatioDefaultPct: 20,
  attackRatioStepPct: 10,
} as const;

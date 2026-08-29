import { z } from "zod";
import { AssetManifest } from "../AssetUrls";
import {
  Difficulty,
  Game,
  GameMode,
  Gold,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  TerrainType,
  TerraNullius,
  Tick,
  Ultimates,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";
import { GameConfig, TeamCountConfig } from "../Schemas";
import { NukeType } from "../StatsSchemas";
import { assertNever, sigmoid, toInt, within } from "../Util";
import {
  fortHqRangeMult,
  fortRangeMult,
  TERRON_AIRPORT_DRONE_COOLDOWN_TICKS,
  TERRON_BANNER_ATTACK_LOSS_MULT,
  TERRON_BLOCKADE_COST,
  TERRON_CAPITAL_GOLD_AMOUNT,
  TERRON_CAPITAL_GOLD_INTERVAL_TICKS,
  TERRON_CATASTROPHE_COST,
  TERRON_FANATICISM_ATTACK_LOSS_MULT,
  TERRON_GREENS_FALLOUT_EASE,
  TERRON_INDUSTRIAL_COST,
  TERRON_NUCLEAR_FALLOUT_EASE,
  TERRON_NUCLEAR_NUKE_DISCOUNT,
  TERRON_OILRIG_BASE_COST,
  TERRON_OILRIG_BUILD_TICKS,
  TERRON_OILRIG_MIN_DIST_FROM_LAND,
  TERRON_OLYMPICS_COST,
  TERRON_PACT_COST,
  TERRON_PEACEFUL_SKY_SAM_DISCOUNT,
  TERRON_PIRACY_SHIP_COST,
  TERRON_PRIDE_COST,
  TERRON_RAILGUN_SHOT_COST,
  TERRON_RECULT_COST,
  TERRON_RESPITE_COST,
  TERRON_REVANCHISM_REVENGE_MULT,
  TERRON_RIVERS_NUKE_COST,
  TERRON_RIVERS_NUKE_INNER,
  TERRON_RIVERS_NUKE_OUTER,
  TERRON_SATSTRIKE_COST,
  TERRON_SPAWN_PHASE_TURNS,
  TERRON_SPLIT_BASE_GOLD,
  TERRON_TANK_ATTACK_MULT,
  TERRON_TERROR_COST,
  TERRON_TRAINS_BLAST_MULT,
  TERRON_TRAINS_COST,
  TERRON_WALK_COST,
  TERRON_TREASURE_BUILD_TICKS,
  TERRON_TRUCE_COST,
  TERRON_ULT_BUILDING_BUILD_TICKS,
  TERRON_ULT_BUILDING_COST,
} from "./TerronTuning";

declare global {
  interface Window {
    BOOTSTRAP_CONFIG?: {
      gitCommit?: string;
      assetManifest?: AssetManifest;
      cdnBase?: string;
      gameEnv?: string;
      numWorkers?: number;
      turnstileSiteKey?: string;
      jwtAudience?: string;
      instanceId?: string;
    };
  }
}

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export function parseGameEnv(value: string | undefined): GameEnv {
  switch (value) {
    case "dev":
      return GameEnv.Dev;
    case "staging":
      return GameEnv.Preprod;
    case "prod":
      return GameEnv.Prod;
    default:
      throw new Error(`unsupported game env: ${value}`);
  }
}

export interface NukeMagnitude {
  inner: number;
  outer: number;
}

const DEFENSE_DEBUFF_MIDPOINT = 150_000;
const DEFENSE_DEBUFF_DECAY_RATE = Math.LN2 / 50000;
const DEFAULT_SPAWN_IMMUNITY_TICKS = 5 * 10;

export const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});

/** SAM launcher construction duration in ticks (non-instant-build). */
export const SAM_CONSTRUCTION_TICKS = 30 * 10;

export class Config {
  private unitInfoCache = new Map<UnitType, UnitInfo>();
  constructor(
    private _gameConfig: GameConfig,
    private _userSettings: UserSettings | null,
    private _isReplay: boolean,
  ) {}

  isReplay(): boolean {
    return this._isReplay;
  }

  traitorDefenseDebuff(): number {
    return 0.5;
  }
  traitorSpeedDebuff(): number {
    return 0.8;
  }
  traitorDuration(): number {
    return 30 * 10; // 30 seconds
  }
  spawnImmunityDuration(): Tick {
    return (
      this._gameConfig.spawnImmunityDuration ?? DEFAULT_SPAWN_IMMUNITY_TICKS
    );
  }
  nationSpawnImmunityDuration(): Tick {
    return DEFAULT_SPAWN_IMMUNITY_TICKS;
  }
  hasExtendedSpawnImmunity(): boolean {
    return this.spawnImmunityDuration() > DEFAULT_SPAWN_IMMUNITY_TICKS;
  }

  gameConfig(): GameConfig {
    return this._gameConfig;
  }

  userSettings(): UserSettings {
    if (this._userSettings === null) {
      throw new Error("userSettings is null");
    }
    return this._userSettings;
  }

  cityTroopIncrease(): number {
    return 250_000;
  }

  falloutDefenseModifier(falloutRatio: number): number {
    // falloutRatio is between 0 and 1
    // So defense modifier is between [5, 2.5]
    return 5 - falloutRatio * 2;
  }
  msPerTick(): number {
    return 100;
  }
  SAMCooldown(): number {
    return 90;
  }
  SiloCooldown(): number {
    return 90;
  }
  // terron: авиация — кулдаун запуска дрона С аэропорта (аналог SiloCooldown, но
  // для аэропортов/дронов). new-units — airport.md, TerronTuning.
  AirportDroneCooldown(): number {
    return TERRON_AIRPORT_DRONE_COOLDOWN_TICKS;
  }

  // terron: СТОЛИЦЫ — доход столицы: выплата CapitalGoldAmount() раз в
  // CapitalGoldIntervalTicks() (5000 / 100 тиков = 30000/мин, видимыми кусками).
  // Спека: CAPITALS.md
  CapitalGoldAmount(): Gold {
    return TERRON_CAPITAL_GOLD_AMOUNT;
  }
  CapitalGoldIntervalTicks(): number {
    return TERRON_CAPITAL_GOLD_INTERVAL_TICKS;
  }

  defensePostRange(): number {
    return 30;
  }

  // terron: авиация — радиус покрытия аэропорта (большой). Пока визуальный (превью при
  // постройке); позже — операционная зона авиации. Спека: airport.md
  airportRange(): number {
    return 300;
  }

  // terron: авиация — скорость самолёта (тайлов/тик), ×2 корабля (корабль = 1). ×3 позже.
  airplaneSpeed(): number {
    return 2;
  }

  // terron: авиация — доход самолёта-транзита = как у корабля на той же дальности (×1).
  // Баланс: аэропорт вдобавок зарабатывает как ж/д трейд-узел (поезда), поэтому авиа-бонус
  // снижен с ×2 до ×1 — итог ≈ порт/фабрика. Спека: airport.md
  airplaneGold(dist: number, player: Player | PlayerView): Gold {
    return this.tradeShipGold(dist, player);
  }

  // terron: DEV — расширенный эконом-лог (ROI порт/фабрика/аэропорт в консоль каждые 60с).
  // Собираем данные для баланса. ⚠️ ВЫКЛЮЧИТЬ перед продом (лишний console-спам). Спека: airport.md
  extendedEconomyLog(): boolean {
    return true;
  }

  defensePostDefenseBonus(): number {
    return 5;
  }

  defensePostSpeedBonus(): number {
    return 3;
  }

  playerTeams(): TeamCountConfig {
    return this._gameConfig.playerTeams ?? 0;
  }

  spawnNations(): boolean {
    return this._gameConfig.nations !== "disabled";
  }

  isUnitDisabled(unitType: UnitType): boolean {
    return this._gameConfig.disabledUnits?.includes(unitType) ?? false;
  }

  bots(): number {
    return this._gameConfig.bots;
  }
  instantBuild(): boolean {
    return this._gameConfig.instantBuild;
  }
  disableNavMesh(): boolean {
    return this._gameConfig.disableNavMesh ?? false;
  }
  disableAlliances(): boolean {
    return this._gameConfig.disableAlliances ?? false;
  }
  // terron: туман войны (опция лобби, по умолчанию выкл). Чисто клиентская
  // видимость — симуляцию не трогает.
  fogOfWar(): boolean {
    return this._gameConfig.fogOfWar ?? false;
  }
  waterNukes(): boolean {
    return this._gameConfig.waterNukes ?? false;
  }
  isRandomSpawn(): boolean {
    return this._gameConfig.randomSpawn;
  }
  infiniteGold(): boolean {
    return this._gameConfig.infiniteGold;
  }
  donateGold(): boolean {
    return this._gameConfig.donateGold;
  }
  infiniteTroops(): boolean {
    return this._gameConfig.infiniteTroops;
  }
  donateTroops(): boolean {
    return this._gameConfig.donateTroops;
  }
  goldMultiplier(): number {
    return this._gameConfig.goldMultiplier ?? 1;
  }
  startingGold(playerInfo: PlayerInfo): Gold {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 0n;
    }
    return this.startingGoldFor(playerInfo);
  }

  trainSpawnRate(numPlayerFactories: number): number {
    // hyperbolic decay, midpoint at 10 factories
    // expected number of trains = numPlayerFactories  / trainSpawnRate(numPlayerFactories)
    return (numPlayerFactories + 10) * 15;
  }
  trainGold(
    rel: "self" | "team" | "ally" | "other",
    citiesVisited: number,
    player: Player | PlayerView,
  ): Gold {
    // No penalty for the first 10 cities.
    citiesVisited = Math.max(0, citiesVisited - 9);
    let baseGold: number;
    switch (rel) {
      case "ally":
        baseGold = 35_000;
        break;
      case "team":
      case "other":
        baseGold = 25_000;
        break;
      case "self":
        baseGold = 10_000;
        break;
    }
    const distPenalty = citiesVisited * 5_000;
    const gold = Math.max(5000, baseGold - distPenalty);
    return toInt(gold * this.goldMultiplierFor(player));
  }

  trainStationMinRange(): number {
    return 15;
  }
  trainStationMaxRange(): number {
    return 110;
  }
  railroadMaxSize(): number {
    return this.trainStationMaxRange();
  }

  tradeShipGold(dist: number, player: Player | PlayerView): Gold {
    // Sigmoid: concave start, sharp S-curve middle, linear end - heavily punishes trades under range debuff.
    const debuff = this.tradeShipShortRangeDebuff();
    const baseGold =
      75_000 / (1 + Math.exp(-0.03 * (dist - debuff))) + 50 * dist;
    return BigInt(Math.floor(baseGold * this.goldMultiplierFor(player)));
  }

  // Probability of trade ship spawn = 1 / tradeShipSpawnRate
  tradeShipSpawnRate(
    tradeShipSpawnRejections: number,
    numTradeShips: number,
  ): number {
    const decayRate = Math.LN2 / 50;

    // Approaches 0 as numTradeShips increase
    const baseSpawnRate = 1 - sigmoid(numTradeShips, decayRate, 200);

    // Pity timer: increases spawn chance after consecutive rejections
    const rejectionModifier = 1 / (tradeShipSpawnRejections + 1);

    return Math.floor((100 * rejectionModifier) / baseSpawnRate);
  }

  unitInfo(type: UnitType): UnitInfo {
    const cached = this.unitInfoCache.get(type);
    if (cached !== undefined) {
      return cached;
    }

    let info: UnitInfo;
    switch (type) {
      case UnitType.TransportShip:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Warship: {
        const base = this.costWrapper(
          (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 250_000),
          UnitType.Warship,
        );
        info = {
          // terron: ПИРАТСТВО — пиратская лодка по фиксированной цене
          // (TerronTuning); перезарядка между покупками — PlayerImpl.
          cost: (game: Game, player: Player) => {
            const c = base(game, player);
            if (!player.hasUltimate(UnitType.Piracy)) return c;
            return c === 0n ? 0n : BigInt(TERRON_PIRACY_SHIP_COST);
          },
          maxHealth: 1000,
        };
        break;
      }
      case UnitType.Shell:
        info = {
          cost: () => 0n,
          damage: 250,
        };
        break;
      case UnitType.SAMMissile:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Port:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Port,
            UnitType.Factory,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          upgradable: true,
        };
        break;
      // terron: НЕФТЯНАЯ ВЫШКА — цена растёт вдвое за каждую следующую (как порт),
      // но старт и потолок выше: вышка платит ×5 за рейс. TerronTuning §ВЫШКА.
      case UnitType.OilRig:
        info = {
          // Плоские 5M за каждую вышку (решение владельца 07.08).
          cost: this.costWrapper(
            () => TERRON_OILRIG_BASE_COST,
            UnitType.OilRig,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : TERRON_OILRIG_BUILD_TICKS,
        };
        break;
      case UnitType.AtomBomb:
        info = {
          // terron: АЭС — ядерное оружие дешевле на NUCLEAR_NUKE_DISCOUNT.
          // ⚠️ Скидка участвует в инварианте «уборка дешевле пуска» — подняв
          // её, прогони NuclearPlant.test.ts. NUCLEAR.md
          cost: this.nuclearPriced(
            this.costWrapper(() => 750_000, UnitType.AtomBomb),
          ),
        };
        break;
      // terron: авиация — дрон-камикадзе: ½ цены первой атомной (375k), масштаб как у ядерки.
      case UnitType.SuicideDrone:
        info = {
          // terron: авиация — цена дрона-камикадзе 300k (решение владельца).
          cost: this.costWrapper(() => 300_000, UnitType.SuicideDrone),
        };
        break;
      // terron: ультимейты — «Реки вспять»: цена пуска водяной ракеты. Гейт
      // «нужен живой штаб RiversBack» — общий реестр CAST_UNLOCKED_BY.
      case UnitType.WaterNuke:
        info = {
          cost: this.costWrapper(
            () => TERRON_RIVERS_NUKE_COST,
            UnitType.WaterNuke,
          ),
        };
        break;
      case UnitType.HydrogenBomb:
        info = {
          // terron: АЭС — ядерное оружие дешевле на NUCLEAR_NUKE_DISCOUNT.
          // ⚠️ Скидка участвует в инварианте «уборка дешевле пуска» — подняв
          // её, прогони NuclearPlant.test.ts. NUCLEAR.md
          cost: this.nuclearPriced(
            this.costWrapper(() => 5_000_000, UnitType.HydrogenBomb),
          ),
        };
        break;
      case UnitType.MIRV:
        info = {
          // terron: АЭС — МИРВ тоже ядерное оружие и тоже со скидкой.
          cost: this.nuclearPriced((game: Game, player: Player) => {
            if (
              player.type() === PlayerType.Human &&
              this.hasInfiniteGoldFor(player)
            ) {
              return 0n;
            }
            // terron: МИРВ теперь разблокируется зданием «Ядерный завод» (5M).
            // Пуск на 5M дешевле старой цены (25→20 базы), т.к. игрок уже оплатил
            // завод: первый МИРВ суммарно = 5M(завод)+20M = 25M, как раньше.
            return 20_000_000n + game.stats().numMirvsLaunched() * 15_000_000n;
          }),
        };
        break;
      case UnitType.MIRVWarhead:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.TradeShip:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Airplane: // terron: авиация — авто-спавн, стоимость 0
        info = {
          cost: () => 0n,
        };
        break;
      // terron: авиация — десант: цена золотом 100k и +100k за каждую ПРЕДЫДУЩУЮ высадку
      // (кумулятивно по unitsConstructed — борт потребляется, поэтому не costWrapper),
      // потолок 1kk. Плюс списываются войска. airport.md
      case UnitType.AirborneAssault:
        info = {
          cost: (game: Game, player: Player) => {
            if (
              player.type() === PlayerType.Human &&
              this.hasInfiniteGoldFor(player)
            ) {
              return 0n;
            }
            // terron: ультимейты — Авиаштаб: десант бесплатный.
            if (player.hasUltimate(UnitType.AirCommand)) {
              return 0n;
            }
            const n = player.unitsConstructed(UnitType.AirborneAssault);
            return BigInt(Math.min(1_000_000, (n + 1) * 100_000));
          },
        };
        break;
      case UnitType.MissileSilo:
        info = {
          cost: this.costWrapper(() => 1_000_000, UnitType.MissileSilo),
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
          upgradable: true,
        };
        break;
      case UnitType.DefensePost:
        info = {
          cost: (game: Game, player: Player) => {
            const base = this.costWrapper(
              (numUnits: number) => Math.min(250_000, (numUnits + 1) * 50_000),
              UnitType.DefensePost,
            )(game, player);
            // terron: ульта Укрепления — бункеры владельцу на 20% дешевле.
            return player.hasUltimate(UnitType.Fortifications)
              ? (base * 4n) / 5n
              : base;
          },
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
        };
        break;
      case UnitType.SAMLauncher:
        info = {
          // terron: МИРНОЕ НЕБО — ПВО вдвое дешевле. PEACEFULSKY.md
          cost: this.peacefulSkyPriced(
            this.costWrapper(
              (numUnits: number) =>
                Math.min(3_000_000, (numUnits + 1) * 1_500_000),
              UnitType.SAMLauncher,
            ),
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : SAM_CONSTRUCTION_TICKS,
          upgradable: true,
        };
        break;
      case UnitType.City:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.City,
          ),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      case UnitType.Factory:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Factory,
            UnitType.Port,
          ),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      // terron: авиация — аэропорт. Стоимость ×2 от порта. Спека: airport.md
      case UnitType.Airport:
        info = {
          // terron: авиация — базовая цена аэропорта 750k (решение владельца), потолок 2M.
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(2_000_000, Math.pow(2, numUnits) * 750_000),
            UnitType.Airport,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
        };
        break;
      // terron: ультимейты — Мин правды. МОЖНО ДВА (2-е разблокируется после
      // 1-го, ставится в другой точке): 1-е 5M, 2-е ×2 = 10M (и ×1.5 эффект,
      // см. MinistryOfTruthExecution). new-units/ULTIMATES.md
      case UnitType.MinistryOfTruth:
        info = {
          cost: (game: Game, player: Player) => {
            const base = this.costWrapper(
              () => TERRON_ULT_BUILDING_COST,
              UnitType.MinistryOfTruth,
            )(game, player);
            // Уже есть одно → это второе, вдвое дороже.
            return player.units(UnitType.MinistryOfTruth).length >= 1
              ? base * 2n
              : base;
          },
          constructionDuration: this.instantBuild()
            ? 0
            : TERRON_ULT_BUILDING_BUILD_TICKS,
        };
        break;
      // terron (18.07): ульт-здания со СТАНДАРТНЫМ балансом (5M / 10с) больше
      // НЕ перечисляются здесь — их ловит default-ветка ниже (вывод из групп
      // Ultimates+Structures). Кастомный баланс (Мин правды ×2 за второе,
      // Форты-уровни, Небо наше 60с) — своими case.
      // terron: ультимейты — Укрепления. Апгрейд «поверх» (до 3 ур.): каждый
      // уровень +25% радиуса автозахвата бункеров (×1.5 на 3-м), цена 5M за
      // уровень (5-5-5). new-units/ULTIMATES.md
      case UnitType.Fortifications:
        info = {
          cost: this.costWrapper(
            () => TERRON_ULT_BUILDING_COST,
            UnitType.Fortifications,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : TERRON_ULT_BUILDING_BUILD_TICKS,
          upgradable: true,
          maxLevel: 3,
        };
        break;
      // terron: «Небо наше» после реворка 21.08 — СТАНДАРТНЫЙ штаб (5M/10с),
      // своего case больше нет: его ловит default-ветка Ultimates+Structures.
      // Телеграф 60с переехал на каст «Сбить спутники» (ниже). NEBO.md
      // terron: «Сбить спутники» — ракета-каст Неба нашего. Цена 1M; сборку 60с
      // (телеграф) ведёт СВОЯ экзекуция, не флоу стройки (каст — не структура).
      case UnitType.SatelliteStrike:
        info = {
          cost: this.costWrapper(
            () => TERRON_SATSTRIKE_COST,
            UnitType.SatelliteStrike,
          ),
        };
        break;
      // terron: «Блокада» — каст Пиратства: зона паники для чужой торговли.
      case UnitType.Blockade:
        info = {
          cost: this.costWrapper(() => TERRON_BLOCKADE_COST, UnitType.Blockade),
        };
        break;
      // terron: «Гордость» — самый дешёвый штаб (1M, стандартные 10с).
      case UnitType.Pride:
        info = {
          cost: this.costWrapper(() => TERRON_PRIDE_COST, UnitType.Pride),
          constructionDuration: this.instantBuild()
            ? 0
            : TERRON_ULT_BUILDING_BUILD_TICKS,
        };
        break;
      // terron: «Передышка» — каст Гордости: 1M золота (+ войска в экзекуции).
      case UnitType.Respite:
        info = {
          cost: this.costWrapper(() => TERRON_RESPITE_COST, UnitType.Respite),
        };
        break;
      // terron: «Террор» — каст Фанатизма: 5M.
      case UnitType.Terror:
        info = {
          cost: this.costWrapper(() => TERRON_TERROR_COST, UnitType.Terror),
        };
        break;
      // terron: «Пакт» — каст Дворца наций: 15M фикс (PEACE.md).
      case UnitType.Pact:
        info = {
          cost: this.costWrapper(() => TERRON_PACT_COST, UnitType.Pact),
        };
        break;
      // terron: «Выстрел Доры» — 100K фикс. Дёшево намеренно: ограничитель
      // ульты — перезарядка и подвоз по рельсам, а не золото. DORA.md
      case UnitType.RailGunShell:
        info = {
          cost: this.costWrapper(
            () => TERRON_RAILGUN_SHOT_COST,
            UnitType.RailGunShell,
          ),
        };
        break;
      // terron: «Перенос» — каст Шагающего города: 1M символически, настоящая
      // цена — войска (до 30% со слайдера, списывает экзекуция). WALKING.md
      case UnitType.CityTransfer:
        info = {
          cost: this.costWrapper(() => TERRON_WALK_COST, UnitType.CityTransfer),
        };
        break;
      // terron: «Состав смерти» — каст Взрывных поездов: 2M. Ограничитель —
      // не цена, а телеграф: состав виден и его останавливают, рвя пути.
      case UnitType.DoomTrain:
        info = {
          cost: this.costWrapper(() => TERRON_TRAINS_COST, UnitType.DoomTrain),
        };
        break;
      // terron: «Индустриальная революция» — каст Топлива: 5M фикс (FUEL.md).
      case UnitType.IndustrialRevolution:
        info = {
          cost: this.costWrapper(
            () => TERRON_INDUSTRIAL_COST,
            UnitType.IndustrialRevolution,
          ),
        };
        break;
      // terron: «Рекультивация» — каст АЭС: дешёвый намеренно. Он ДОЛЖЕН
      // окупаться на большой воронке, иначе вся экономика ульты мертва; но
      // вместе с ценой ракеты он же держит закрытой петлю самобомбёжки
      // (см. инвариант в TerronTuning §АЭС). NUCLEAR.md
      case UnitType.Recultivation:
        info = {
          cost: this.costWrapper(
            () => TERRON_RECULT_COST,
            UnitType.Recultivation,
          ),
        };
        break;
      // terron: «Это катастрофа!» — каст Зелёных: 5M фикс (GREEN.md).
      case UnitType.Catastrophe:
        info = {
          cost: this.costWrapper(
            () => TERRON_CATASTROPHE_COST,
            UnitType.Catastrophe,
          ),
        };
        break;
      // terron: ЗЕЛЁНЫЕ — гражданский борт-инспекция: не покупается игроком,
      // его поднимает сама игра при детонации. Цена 0, как у поезда.
      case UnitType.GreenInspection:
        info = {
          cost: () => 0n,
        };
        break;
      // terron: «Олимпийские игры» — каст Стадиона: 10M фикс.
      case UnitType.Truce:
        info = {
          cost: this.costWrapper(() => TERRON_TRUCE_COST, UnitType.Truce),
        };
        break;
      // terron: СТАДИОН — штаб Олимпийских игр, 10M (стандартные 10с).
      case UnitType.Olympics:
        info = {
          cost: this.costWrapper(() => TERRON_OLYMPICS_COST, UnitType.Olympics),
          constructionDuration: this.instantBuild()
            ? 0
            : TERRON_ULT_BUILDING_BUILD_TICKS,
        };
        break;
      // terron: ультимейты — Раскол: таргетная атака (не строит юнит). Базовая
      // цена золотом; вклад войск списывается отдельно в SplitExecution и задаёт
      // размер флага. ЧЕРНОВОЙ баланс — крутить в TerronTuning. new-units/SPLIT.md
      case UnitType.Split:
        info = {
          cost: (game: Game, player: Player) => {
            if (
              player.type() === PlayerType.Human &&
              this.hasInfiniteGoldFor(player)
            ) {
              return 0n;
            }
            return TERRON_SPLIT_BASE_GOLD;
          },
        };
        break;
      case UnitType.Train:
        info = {
          cost: () => 0n,
        };
        break;
      // terron 24.08 (решение владельца): КЛАД строится 50 секунд — цена
      // секрета не только золото, но и время, за которое его могут снести.
      case UnitType.SecretTreasure:
        info = {
          cost: this.costWrapper(
            () => TERRON_ULT_BUILDING_COST,
            UnitType.SecretTreasure,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : TERRON_TREASURE_BUILD_TICKS,
        };
        break;
      default:
        // terron (18.07): ульт-здание со стандартным балансом — из реестра,
        // без своего case. Новый стандартный ульт-штаб = 0 правок здесь.
        if (Ultimates.has(type) && Structures.has(type)) {
          info = {
            cost: this.costWrapper(() => TERRON_ULT_BUILDING_COST, type),
            constructionDuration: this.instantBuild()
              ? 0
              : TERRON_ULT_BUILDING_BUILD_TICKS,
          };
          break;
        }
        throw new Error(`unitInfo: no entry for unit type ${type}`);
    }

    this.unitInfoCache.set(type, info);
    return info;
  }

  private hasInfiniteGoldFor(player: Player | PlayerView): boolean {
    if (this.infiniteGold()) return true;
    const hc = this._gameConfig.hostCheats;
    return (hc?.infiniteGold ?? false) && player.isLobbyCreator();
  }

  private hasInfiniteTroopsFor(player: Player | PlayerView): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      player.isLobbyCreator()
    );
  }

  private hasInfiniteTroopsForInfo(playerInfo: PlayerInfo): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      playerInfo.isLobbyCreator
    );
  }

  private goldMultiplierFor(player: Player | PlayerView): number {
    const base = this.goldMultiplier();
    const hc = this._gameConfig.hostCheats;
    if (hc?.goldMultiplier && player.isLobbyCreator()) {
      return hc.goldMultiplier;
    }
    return base;
  }

  public conquerGoldAmount(captured: Player): Gold {
    if (
      captured.type() === PlayerType.Bot ||
      captured.type() === PlayerType.Nation
    ) {
      return captured.gold();
    } else {
      return captured.gold() / 2n;
    }
  }

  private startingGoldFor(playerInfo: PlayerInfo): Gold {
    const base = BigInt(this._gameConfig.startingGold ?? 0);
    const hc = this._gameConfig.hostCheats;
    if (hc?.startingGold && playerInfo.isLobbyCreator) {
      return base + BigInt(hc.startingGold);
    }
    return base;
  }

  /**
   * terron: АЭС — скидка на ядерное оружие (new-units/NUCLEAR.md). Обёртка
   * поверх обычной цены: бесплатным (infinite gold) не мешает, потому что 0
   * остаётся 0.
   * ⚠️ Скидка — половина инварианта «уборка воронки дешевле пуска ракеты»
   * (вторая половина — ставка рекультивации). Подняв её, прогони
   * NuclearPlant.test.ts, иначе откроется вечный двигатель самобомбёжки.
   */
  /**
   * terron: МИРНОЕ НЕБО — скидка на ПВО (new-units/PEACEFULSKY.md). Обёртка
   * поверх обычной цены; бесплатным (infinite gold) не мешает — 0 остаётся 0.
   */
  private peacefulSkyPriced(
    inner: (g: Game, p: Player) => bigint,
  ): (g: Game, p: Player) => bigint {
    return (game: Game, player: Player) => {
      const base = inner(game, player);
      if (base === 0n || !player.hasUltimate(UnitType.PeacefulSky)) {
        return base;
      }
      return BigInt(
        Math.round(Number(base) * (1 - TERRON_PEACEFUL_SKY_SAM_DISCOUNT)),
      );
    };
  }

  private nuclearPriced(
    inner: (g: Game, p: Player) => bigint,
  ): (g: Game, p: Player) => bigint {
    return (game: Game, player: Player) => {
      const base = inner(game, player);
      if (base === 0n || !player.hasUltimate(UnitType.NuclearPlant)) {
        return base;
      }
      return BigInt(
        Math.round(Number(base) * (1 - TERRON_NUCLEAR_NUKE_DISCOUNT)),
      );
    };
  }

  private costWrapper(
    costFn: (units: number) => number,
    ...types: UnitType[]
  ): (g: Game, p: Player) => bigint {
    return (game: Game, player: Player) => {
      if (
        player.type() === PlayerType.Human &&
        this.hasInfiniteGoldFor(player)
      ) {
        return 0n;
      }
      const numUnits = types.reduce(
        (acc, type) =>
          acc +
          Math.min(player.unitsOwned(type), player.unitsConstructed(type)),
        0,
      );
      return BigInt(costFn(numUnits));
    };
  }

  defaultDonationAmount(sender: Player): number {
    return Math.floor(sender.troops() / 3);
  }
  donateCooldown(): Tick {
    return 10 * 10;
  }
  embargoAllCooldown(): Tick {
    return 10 * 10;
  }
  deletionMarkDuration(): Tick {
    // terron: длительность демонтажа (клик→снос) ×3 быстрее: 30с→10с. Спека: airport.md
    return 10 * 10;
  }

  deleteUnitCooldown(): Tick {
    // terron: кулдаун между удалениями — 5с (было 30с). Спека: airport.md
    return 5 * 10;
  }
  emojiMessageDuration(): Tick {
    return 5 * 10;
  }
  emojiMessageCooldown(): Tick {
    return 5 * 10;
  }
  quickChatCooldown(): Tick {
    return 3 * 10;
  }
  targetDuration(): Tick {
    return 10 * 10;
  }
  targetCooldown(): Tick {
    return 15 * 10;
  }
  allianceRequestDuration(): Tick {
    return 20 * 10;
  }
  allianceRequestCooldown(): Tick {
    return 30 * 10;
  }
  allianceDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  temporaryEmbargoDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  minDistanceBetweenPlayers(): number {
    return 30;
  }

  percentageTilesOwnedToWin(): number {
    if (this._gameConfig.gameMode === GameMode.Team) {
      return 95;
    }
    return 80;
  }
  boatMaxNumber(): number {
    if (this.isUnitDisabled(UnitType.TransportShip)) {
      return 0;
    }
    return 3;
  }
  numSpawnPhaseTurns(): number {
    // terron: фаза выбора точки спавна — единое время из TerronTuning.
    return TERRON_SPAWN_PHASE_TURNS;
  }
  numBots(): number {
    return this.bots();
  }

  attackLogic(
    gm: Game,
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    tileToConquer: TileRef,
  ): {
    attackerTroopLoss: number;
    defenderTroopLoss: number;
    tilesPerTickUsed: number;
  } {
    let mag;
    let speed;
    const type = gm.terrainType(tileToConquer);
    switch (type) {
      case TerrainType.Plains:
        mag = 80;
        speed = 16.5;
        break;
      case TerrainType.Highland:
        mag = 100;
        speed = 20;
        break;
      case TerrainType.Mountain:
        mag = 120;
        speed = 25;
        break;
      default:
        throw new Error(`terrain type ${type} not supported`);
    }
    // terron: ультимейты — Танковый завод. Два эффекта для владельца:
    //  (1) атака игнорирует бонус защиты вражеских бункеров (mag/speed без бонуса);
    //  (2) атака на 15% сильнее — потери атакующего (mag) × TERRON_TANK_ATTACK_MULT.
    const hasTanks =
      attacker.isPlayer() && attacker.hasUltimate(UnitType.TankFactory);
    if (defender.isPlayer() && !hasTanks) {
      // terron: ульта Укрепления — владельцу бункеры бьют дальше (растёт с уровнем
      // штаба) и сильнее (+20% к бонусу защиты). САМ штаб — тоже «бункер», но с
      // радиусом ×2 от нормы. Прочим — база. new-units/ULTIMATES.md
      const fort = defender.hasUltimate(UnitType.Fortifications);
      const hq = fort ? defender.units(UnitType.Fortifications)[0] : undefined;
      const level = hq ? hq.level() : 1;
      const base = gm.config().defensePostRange();
      let defended = false;
      // Штаб защищает вокруг себя (радиус ×2).
      if (hq !== undefined) {
        const hqRange = base * fortHqRangeMult(level);
        if (
          gm.euclideanDistSquared(tileToConquer, hq.tile()) <=
          hqRange * hqRange
        ) {
          defended = true;
        }
      }
      // Обычные бункеры (радиус растёт с уровнем штаба у владельца ульты).
      if (!defended) {
        const range = base * (fort ? fortRangeMult(level) : 1);
        for (const dp of gm.nearbyUnits(
          tileToConquer,
          range,
          UnitType.DefensePost,
        )) {
          if (dp.unit.owner() === defender) {
            defended = true;
            break;
          }
        }
      }
      if (defended) {
        // terron (решение владельца 14.07): доп. бонус защиты Укреплений ОТКЛЮЧЁН
        // («не перебафать») — владелец бьётся базовым ×5, как все. Ульта усилена
        // теперь через градиентный автозахват (FortificationsExecution), а не оборону.
        // Радиус защиты (fortRangeMult) при этом сохранён — прикрывает больше площади.
        mag *= this.defensePostDefenseBonus();
        speed *= this.defensePostSpeedBonus();
      }
    }
    if (hasTanks) {
      mag *= TERRON_TANK_ATTACK_MULT;
    }
    // terron: ЗНАМЯ ПОБЕДЫ — по жертве, чья столица под моим знаменем, атака
    // на 50 % эффективнее (по каждой жертве отдельно). new-units/BANNER.md
    if (
      attacker.isPlayer() &&
      defender.isPlayer() &&
      attacker.holdsCapitalOf(defender)
    ) {
      mag *= TERRON_BANNER_ATTACK_LOSS_MULT;
    }
    // terron: ФАНАТИЗМ — атака вдвое менее эффективна: потери атакующего ×2.
    if (attacker.isPlayer() && attacker.hasUltimate(UnitType.Fanaticism)) {
      mag *= TERRON_FANATICISM_ATTACK_LOSS_MULT;
    }

    // terron: РЕВАНШИЗМ (ультимейт-ЗДАНИЕ «статуя») — пока стоит штаб-статуя,
    // теряя земли от исторического пика, защитник получает баф обороны по ВСЕЙ
    // территории (0..+200% к mag). Как бункеры, но глобально. Танки НЕ игнорируют
    // (это не бункер). См. Player.revanchismBuff() / TERRON_REVANCHISM_*.
    if (defender.isPlayer() && defender.hasUltimate(UnitType.Revanchism)) {
      const rev = defender.revanchismBuff();
      if (rev > 0) mag *= 1 + rev;
    }

    // terron: РЕВАНШИЗМ, вторая половина — МЕСТЬ. Мои атаки по тому, кто напал
    // на меня ПЕРВЫМ, идут на +50% эффективнее (mag дешевле). Список обидчиков
    // ведётся всегда, здесь лишь применяется — поэтому «штаб достроился ровно в
    // момент атаки» работает: обидчик уже в списке. TerronTuning §РЕВАНШИЗМ.
    if (
      attacker.isPlayer() &&
      defender.isPlayer() &&
      attacker.hasUltimate(UnitType.Revanchism) &&
      attacker.wasAttackedFirstBy(defender)
    ) {
      mag *= TERRON_REVANCHISM_REVENGE_MULT;
    }

    if (gm.hasFallout(tileToConquer)) {
      const falloutRatio = gm.numTilesWithFallout() / gm.numLandTiles();
      let falloutMod = this.falloutDefenseModifier(falloutRatio);
      // terron: заход в пепел штатно стоит ×3–5 войск и идёт ×3–5 медленнее.
      // ЗЕЛЁНЫЕ делят этот штраф на ×5, АЭС («ликвидаторы») — на ×3 (решение
      // владельца 23.08). Ниже 1 не опускаем: пепел не должен становиться
      // ВЫГОДНЕЕ чистой земли, иначе появится смысл бомбить перед своей же
      // атакой. GREEN.md / NUCLEAR.md
      if (attacker.isPlayer()) {
        const ease = attacker.hasUltimate(UnitType.Greens)
          ? TERRON_GREENS_FALLOUT_EASE
          : attacker.hasUltimate(UnitType.NuclearPlant)
            ? TERRON_NUCLEAR_FALLOUT_EASE
            : 1;
        if (ease > 1) falloutMod = Math.max(1, falloutMod / ease);
      }
      mag *= falloutMod;
      speed *= falloutMod;
    }

    if (attacker.isPlayer() && defender.isPlayer()) {
      if (defender.isDisconnected() && attacker.isOnSameTeam(defender)) {
        // No troop loss if defender is disconnected and on same team
        mag = 0;
      }
      if (
        (attacker.type() === PlayerType.Human ||
          attacker.type() === PlayerType.Nation) &&
        defender.type() === PlayerType.Bot
      ) {
        mag *= 0.7;
      }
    }

    if (defender.isPlayer()) {
      const defenseSig =
        1 -
        sigmoid(
          defender.numTilesOwned(),
          DEFENSE_DEBUFF_DECAY_RATE,
          DEFENSE_DEBUFF_MIDPOINT,
        );

      const largeDefenderSpeedDebuff = 0.7 + 0.3 * defenseSig;
      const largeDefenderAttackDebuff = 0.7 + 0.3 * defenseSig;

      let largeAttackBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackBonus = Math.sqrt(100_000 / attacker.numTilesOwned()) ** 0.7;
      }
      let largeAttackerSpeedBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackerSpeedBonus = (100_000 / attacker.numTilesOwned()) ** 0.6;
      }

      const defenderTroopLoss = defender.troops() / defender.numTilesOwned();
      const traitorMod = defender.isTraitor() ? this.traitorDefenseDebuff() : 1;
      const currentAttackerLoss =
        within(defender.troops() / attackTroops, 0.6, 2) *
        mag *
        0.8 *
        largeDefenderAttackDebuff *
        largeAttackBonus *
        traitorMod;
      const altAttackerLoss =
        1.3 * defenderTroopLoss * (mag / 100) * traitorMod;
      const attackerTroopLoss =
        0.6 * currentAttackerLoss + 0.4 * altAttackerLoss;

      return {
        attackerTroopLoss,
        defenderTroopLoss,
        tilesPerTickUsed:
          within(defender.troops() / (5 * attackTroops), 0.2, 1.5) *
          speed *
          largeDefenderSpeedDebuff *
          largeAttackerSpeedBonus *
          (defender.isTraitor() ? this.traitorSpeedDebuff() : 1),
      };
    } else {
      return {
        attackerTroopLoss:
          attacker.type() === PlayerType.Bot ? mag / 10 : mag / 5,
        defenderTroopLoss: 0,
        tilesPerTickUsed: within(
          (2000 * Math.max(10, speed)) / attackTroops,
          5,
          100,
        ),
      };
    }
  }

  attackTilesPerTick(
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number {
    if (defender.isPlayer()) {
      return (
        within(((5 * attackTroops) / defender.troops()) * 2, 0.01, 0.5) *
        numAdjacentTilesWithEnemy *
        3
      );
    } else {
      return numAdjacentTilesWithEnemy * 2;
    }
  }

  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number {
    return Math.floor(attacker.troops() / 5);
  }

  warshipShellLifetime(): number {
    return 20; // in ticks (one tick is 100ms)
  }

  radiusPortSpawn() {
    return 20;
  }

  tradeShipShortRangeDebuff(): number {
    return 300;
  }

  proximityBonusPortsNb(totalPorts: number) {
    return within(totalPorts / 3, 4, totalPorts);
  }

  attackAmount(attacker: Player, defender: Player | TerraNullius) {
    if (attacker.type() === PlayerType.Bot) {
      return attacker.troops() / 20;
    } else {
      return attacker.troops() / 5;
    }
  }

  startManpower(playerInfo: PlayerInfo): number {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 10_000;
    }
    if (playerInfo.playerType === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          return 12_500;
        case Difficulty.Medium:
          return 18_750;
        case Difficulty.Hard:
          return 25_000; // Like humans
        case Difficulty.Impossible:
          return 31_250;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }
    return this.hasInfiniteTroopsForInfo(playerInfo) ? 1_000_000 : 25_000;
  }

  /**
   * terron: ЗЕЛЁНЫЕ — суммарные уровни зданий, дающих население. Обычно это
   * только города; у Зелёных сюда же входят РАКЕТНЫЕ ШАХТЫ (решение владельца
   * 23.08: «шахты начинают приносить население как города», эквивалент 1:1).
   * Смысл — не запрет, а КОНВЕРСИЯ: раз пускать нечего, ракетную базу
   * переделали в жилой городок. Работает динамически: снесли штаб Зелёных —
   * шахты в тот же тик снова становятся шахтами и снова умеют стрелять.
   * new-units/GREEN.md
   */
  populationBuildingLevels(player: Player | PlayerView): number {
    const sumLevels = (t: UnitType) =>
      player
        .units(t)
        .filter((u) => !u.isUnderConstruction())
        .map((u) => u.level())
        .reduce((a, b) => a + b, 0);
    let levels = sumLevels(UnitType.City);
    if (player.hasUltimate(UnitType.Greens)) {
      levels += sumLevels(UnitType.MissileSilo);
    }
    return levels;
  }

  maxTroops(player: Player | PlayerView): number {
    const maxTroops =
      player.type() === PlayerType.Human && this.hasInfiniteTroopsFor(player)
        ? 1_000_000_000
        : 2 * (Math.pow(player.numTilesOwned(), 0.6) * 1000 + 50000) +
          this.populationBuildingLevels(player) * this.cityTroopIncrease();

    if (player.type() === PlayerType.Bot) {
      return maxTroops / 3;
    }

    if (player.type() === PlayerType.Human) {
      return maxTroops;
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return maxTroops * 0.5;
      case Difficulty.Medium:
        return maxTroops * 0.75;
      case Difficulty.Hard:
        return maxTroops * 1; // Like humans
      case Difficulty.Impossible:
        return maxTroops * 1.25;
      default:
        assertNever(this._gameConfig.difficulty);
    }
  }

  troopIncreaseRate(player: Player | PlayerView): number {
    const max = this.maxTroops(player);

    let toAdd = 10 + Math.pow(player.troops(), 0.73) / 4;

    const ratio = 1 - player.troops() / max;
    toAdd *= ratio;

    if (player.type() === PlayerType.Bot) {
      toAdd *= 0.5;
    }

    if (player.type() === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          toAdd *= 0.9;
          break;
        case Difficulty.Medium:
          toAdd *= 0.95;
          break;
        case Difficulty.Hard:
          toAdd *= 1; // Like humans
          break;
        case Difficulty.Impossible:
          toAdd *= 1.05;
          break;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }

    return Math.min(player.troops() + toAdd, max) - player.troops();
  }

  goldAdditionRate(player: Player | PlayerView): Gold {
    const multiplier = this.goldMultiplierFor(player);
    let baseRate: bigint;
    if (player.type() === PlayerType.Bot) {
      baseRate = 50n;
    } else {
      baseRate = 100n;
    }
    return BigInt(Math.floor(Number(baseRate) * multiplier));
  }

  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    switch (unitType) {
      case UnitType.MIRVWarhead:
        return { inner: 12, outer: 18 };
      case UnitType.AtomBomb:
        return { inner: 12, outer: 30 };
      case UnitType.HydrogenBomb:
        return { inner: 80, outer: 100 };
      // terron: авиация — дрон-камикадзе: радиус ⅓ атомной (inner 4 / outer 10).
      case UnitType.SuicideDrone:
        return { inner: 4, outer: 10 };
      // terron 23.08 (решение владельца): СОСТАВ СМЕРТИ везёт ядерку с ВДВОЕ
      // большим радиусом, чем базовая атомная. Считаем от неё же, чтобы связь
      // «×2 от базовой» не разъехалась при правке ядерок. TRAINS.md
      case UnitType.DoomTrain:
        return {
          inner: 12 * TERRON_TRAINS_BLAST_MULT,
          outer: 30 * TERRON_TRAINS_BLAST_MULT,
        };
      // terron: ультимейты — «Реки вспять»: воронка мельче атомной, но земля в
      // ней не выжигается, а затапливается навсегда. TerronTuning §РЕКИ ВСПЯТЬ.
      case UnitType.WaterNuke:
        return {
          inner: TERRON_RIVERS_NUKE_INNER,
          outer: TERRON_RIVERS_NUKE_OUTER,
        };
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  nukeAllianceBreakThreshold(): number {
    return 100;
  }

  defaultNukeSpeed(): number {
    return 8;
  }

  defaultNukeTargetableRange(): number {
    return 150;
  }

  defaultSamRange(): number {
    return 70;
  }

  samRange(level: number): number {
    // rational growth function (level 1 = 70, level 5 just above hydro range, asymptotically approaches 150)
    return this.maxSamRange() - 480 / (level + 5);
  }

  maxSamRange(): number {
    return 150;
  }

  defaultSamMissileSpeed(): number {
    return 12;
  }

  // Humans can be soldiers, soldiers attacking, soldiers in boat etc.
  nukeDeathFactor(
    // terron: ультимейты — «Реки вспять» пользуется той же формулой потерь
    // (не-МИРВ ветка), но в схему статистики бомб не входит. См. NukeExecution.
    nukeType: NukeType | UnitType.WaterNuke,
    humans: number,
    tilesOwned: number,
    maxTroops: number,
  ): number {
    if (nukeType !== UnitType.MIRVWarhead) {
      return (5 * humans) / Math.max(1, tilesOwned);
    }
    const targetTroops = 0.03 * maxTroops;
    const excessTroops = Math.max(0, humans - targetTroops);
    const scalingFactor = 500;

    const steepness = 2;
    const normalizedExcess = excessTroops / maxTroops;
    return scalingFactor * (1 - Math.exp(-steepness * normalizedExcess));
  }

  // terron: НЕФТЯНАЯ ВЫШКА — сколько тайлов вокруг точки должно быть БЕЗ СУШИ.
  // Через Config (а не константой напрямую), чтобы тесты могли подменить — на
  // мелких тестовых картах открытого моря просто нет. TerronTuning §ВЫШКА.
  oilRigMinDistFromLand(): number {
    return TERRON_OILRIG_MIN_DIST_FROM_LAND;
  }

  structureMinDist(): number {
    return 15;
  }

  shellLifetime(): number {
    return 50;
  }

  warshipPatrolRange(): number {
    return 100;
  }

  warshipTargettingRange(): number {
    return 130;
  }

  warshipShellAttackRate(): number {
    return 20;
  }

  warshipDockingRange(): number {
    return 5;
  }

  warshipPortHealingBonusPerLevel(): number {
    return 5;
  }

  warshipRetreatHealthThreshold(): number {
    return 750;
  }

  warshipPassiveHealing(): number {
    return 1;
  }

  warshipPassiveHealingRange(): number {
    return 150;
  }

  warshipPortSwitchThreshold(): number {
    return 0.75;
  }

  defensePostShellAttackRate(): number {
    return 100;
  }

  safeFromPiratesCooldownMax(): number {
    return 20;
  }

  defensePostTargettingRange(): number {
    return 75;
  }

  allianceExtensionPromptOffset(): number {
    return 300; // 30 seconds before expiration
  }
}

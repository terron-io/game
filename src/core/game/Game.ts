import {
  TERRON_RAILGUN_RANGE,
  TERRON_TRAINS_BLAST_MULT,
} from "../configuration/TerronTuning";
import { Config } from "../configuration/Config";
import { AbstractGraph } from "../pathfinding/algorithms/AbstractGraph";
import { PathFinder } from "../pathfinding/types";
import { AllPlayersStats, ClientID } from "../Schemas";
import { formatPlayerDisplayName } from "../Util";
import { GameMap, TileRef } from "./GameMap";
import {
  GameUpdate,
  GameUpdateType,
  PlayerUpdate,
  UnitUpdate,
} from "./GameUpdates";
import { MotionPlanRecord } from "./MotionPlans";
import { RailNetwork } from "./RailNetwork";
import { Stats } from "./Stats";
import { UnitPredicate } from "./UnitGrid";

function isEnumValue<T extends Record<string, string | number>>(
  enumObj: T,
  value: unknown,
): value is T[keyof T] {
  return Object.values(enumObj).includes(value as T[keyof T]);
}

export type PlayerID = string;
export type Tick = number;
export type Gold = bigint;

export type WarshipState = {
  state: "patrolling" | "retreating" | "docked";
  patrolTile?: TileRef;
  retreatPort?: TileRef;
  isInCombat?: boolean;
  lastCombatTick: number;
};

export type TransportShipState = {
  isRetreating: boolean;
  troops: number;
};

export const AllPlayers = "AllPlayers" as const;

// export type GameUpdates = Record<GameUpdateType, GameUpdate[]>;
// Create a type that maps GameUpdateType to its corresponding update type
type UpdateTypeMap<T extends GameUpdateType> = Extract<GameUpdate, { type: T }>;

// Then use it to create the record type
export type GameUpdates = {
  [K in GameUpdateType]: UpdateTypeMap<K>[];
};

export interface MapPos {
  x: number;
  y: number;
}

export enum Difficulty {
  Easy = "Easy",
  Medium = "Medium",
  Hard = "Hard",
  Impossible = "Impossible",
}
export const isDifficulty = (value: unknown): value is Difficulty =>
  isEnumValue(Difficulty, value);

export type Team = string;

export interface SpawnArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TeamGameSpawnAreas = Record<string, SpawnArea[]>;

export const Duos = "Duos" as const;
export const Trios = "Trios" as const;
export const Quads = "Quads" as const;
export const HumansVsNations = "Humans Vs Nations" as const;

export const ColoredTeams: Record<string, Team> = {
  Red: "Red",
  Blue: "Blue",
  Teal: "Teal",
  Purple: "Purple",
  Yellow: "Yellow",
  Orange: "Orange",
  Green: "Green",
  Bot: "Bot",
  Humans: "Humans",
  Nations: "Nations",
} as const;

export enum GameMapType {
  World = "World",
  WorldInverted = "World Inverted",
  GiantWorldMap = "Giant World Map",
  Europe = "Europe",
  EuropeClassic = "Europe Classic",
  Mena = "Mena",
  NorthAmerica = "North America",
  SouthAmerica = "South America",
  Oceania = "Oceania",
  BlackSea = "Black Sea",
  Africa = "Africa",
  Pangaea = "Pangaea",
  Asia = "Asia",
  Mars = "Mars",
  BritanniaClassic = "Britannia Classic",
  Britannia = "Britannia",
  GatewayToTheAtlantic = "Gateway to the Atlantic",
  Australia = "Australia",
  Iceland = "Iceland",
  EastAsia = "East Asia",
  BetweenTwoSeas = "Between Two Seas",
  FaroeIslands = "Faroe Islands",
  DeglaciatedAntarctica = "Deglaciated Antarctica",
  FalklandIslands = "Falkland Islands",
  Baikal = "Baikal",
  Halkidiki = "Halkidiki",
  StraitOfGibraltar = "Strait of Gibraltar",
  Italia = "Italia",
  Japan = "Japan",
  Pluto = "Pluto",
  Montreal = "Montreal",
  NewYorkCity = "New York City",
  Achiran = "Achiran",
  BaikalNukeWars = "Baikal Nuke Wars",
  FourIslands = "Four Islands",
  Svalmel = "Svalmel",
  GulfOfStLawrence = "Gulf of St. Lawrence",
  Lisbon = "Lisbon",
  Manicouagan = "Manicouagan",
  Lemnos = "Lemnos",
  Tourney1 = "Tourney 2 Teams",
  Tourney2 = "Tourney 3 Teams",
  Tourney3 = "Tourney 4 Teams",
  Tourney4 = "Tourney 8 Teams",
  Passage = "Passage",
  Sierpinski = "Sierpinski",
  TheBox = "The Box",
  TwoLakes = "Two Lakes",
  StraitOfHormuz = "Strait of Hormuz",
  Surrounded = "Surrounded",
  Didier = "Didier",
  DidierFrance = "Didier France",
  AmazonRiver = "Amazon River",
  BosphorusStraits = "Bosphorus Straits",
  BeringStrait = "Bering Strait",
  Yenisei = "Yenisei",
  TradersDream = "Traders Dream",
  Hawaii = "Hawaii",
  Alps = "Alps",
  NileDelta = "Nile Delta",
  Arctic = "Arctic",
  SanFrancisco = "San Francisco",
  Aegean = "Aegean",
  MilkyWay = "MilkyWay",
  MareNostrum = "Mare Nostrum",
  Dyslexdria = "Dyslexdria",
  GreatLakes = "Great Lakes",
  StraitOfMalacca = "Strait Of Malacca",
  Luna = "Luna",
  Conakry = "Conakry",
  Caucasus = "Caucasus",
  LosAngeles = "Los Angeles",
  BeringSea = "Bering Sea",
  Antarctica = "Antarctica",
  ArchipelagoSea = "ArchipelagoSea",
  BajaCalifornia = "Baja California",
  MiddleEast = "Middle East",
  TaiwanStrait = "Taiwan Strait",
  IndianSubcontinent = "Indian Subcontinent",
  DanishStraits = "Danish Straits",
  NorthwestPassage = "Northwest Passage",
  Venice = "Venice",
  Korea = "Korea",
  Balkans = "Balkans",
  YellowSea = "Yellow Sea",
  Labyrinth = "Labyrinth",
  Caribbean = "Caribbean",
  Onion = "Onion",
  ChoppingBlock = "Chopping Block",
  SoutheastAsia = "SoutheastAsia",
  MississippiRiver = "Mississippi River",
  // terron: обучающая карта «TERRON» (папка resources/maps/terron)
  Terron = "Terron",
  // terron: обучающая карта v2 — шире буквы, горы слева (папка resources/maps/terrontutor2)
  TerronTutor2 = "TerronTutor2",
}

export type GameMapName = keyof typeof GameMapType;

export const mapCategories: Record<string, GameMapType[]> = {
  training: [GameMapType.Terron, GameMapType.TerronTutor2],
  continental: [
    GameMapType.World,
    GameMapType.GiantWorldMap,
    GameMapType.NorthAmerica,
    GameMapType.SouthAmerica,
    GameMapType.Europe,
    GameMapType.EuropeClassic,
    GameMapType.Asia,
    GameMapType.Africa,
    GameMapType.Oceania,
    GameMapType.Antarctica,
  ],
  regional: [
    GameMapType.BritanniaClassic,
    GameMapType.Britannia,
    GameMapType.BlackSea,
    GameMapType.GatewayToTheAtlantic,
    GameMapType.BetweenTwoSeas,
    GameMapType.Iceland,
    GameMapType.EastAsia,
    GameMapType.Mena,
    GameMapType.Australia,
    GameMapType.FaroeIslands,
    GameMapType.FalklandIslands,
    GameMapType.Baikal,
    GameMapType.Halkidiki,
    GameMapType.StraitOfGibraltar,
    GameMapType.Italia,
    GameMapType.Japan,
    GameMapType.Montreal,
    GameMapType.GulfOfStLawrence,
    GameMapType.Lisbon,
    GameMapType.NewYorkCity,
    GameMapType.Manicouagan,
    GameMapType.Lemnos,
    GameMapType.TwoLakes,
    GameMapType.StraitOfHormuz,
    GameMapType.AmazonRiver,
    GameMapType.BosphorusStraits,
    GameMapType.BeringStrait,
    GameMapType.Yenisei,
    GameMapType.Hawaii,
    GameMapType.Alps,
    GameMapType.NileDelta,
    GameMapType.Arctic,
    GameMapType.SanFrancisco,
    GameMapType.Aegean,
    GameMapType.MareNostrum,
    GameMapType.GreatLakes,
    GameMapType.StraitOfMalacca,
    GameMapType.Conakry,
    GameMapType.Caucasus,
    GameMapType.LosAngeles,
    GameMapType.BeringSea,
    GameMapType.ArchipelagoSea,
    GameMapType.BajaCalifornia,
    GameMapType.Korea,
    GameMapType.MiddleEast,
    GameMapType.TaiwanStrait,
    GameMapType.Balkans,
    GameMapType.IndianSubcontinent,
    GameMapType.DanishStraits,
    GameMapType.NorthwestPassage,
    GameMapType.Venice,
    GameMapType.YellowSea,
    GameMapType.Caribbean,
    GameMapType.SoutheastAsia,
    GameMapType.MississippiRiver,
  ],
  fantasy: [
    GameMapType.Pangaea,
    GameMapType.Pluto,
    GameMapType.Mars,
    GameMapType.DeglaciatedAntarctica,
    GameMapType.Achiran,
    GameMapType.BaikalNukeWars,
    GameMapType.FourIslands,
    GameMapType.Svalmel,
    GameMapType.Surrounded,
    GameMapType.TradersDream,
    GameMapType.Passage,
    GameMapType.MilkyWay,
    GameMapType.Dyslexdria,
    GameMapType.Luna,
    GameMapType.WorldInverted,
  ],
  arcade: [
    GameMapType.TheBox,
    GameMapType.ChoppingBlock,
    GameMapType.Didier,
    GameMapType.DidierFrance,
    GameMapType.Labyrinth,
    GameMapType.Sierpinski,
    GameMapType.Onion,
  ],
  tournament: [
    GameMapType.Tourney1,
    GameMapType.Tourney2,
    GameMapType.Tourney3,
    GameMapType.Tourney4,
  ],
};

export enum GameType {
  Singleplayer = "Singleplayer",
  Public = "Public",
  Private = "Private",
}
export const isGameType = (value: unknown): value is GameType =>
  isEnumValue(GameType, value);

export enum GameMode {
  FFA = "Free For All",
  Team = "Team",
}

export enum RankedType {
  OneVOne = "1v1",
}

export const isGameMode = (value: unknown): value is GameMode =>
  isEnumValue(GameMode, value);

export enum GameMapSize {
  Compact = "Compact",
  Normal = "Normal",
}

export interface PublicGameModifiers {
  isCompact?: boolean;
  isRandomSpawn?: boolean;
  isCrowded?: boolean;
  isHardNations?: boolean;
  startingGold?: number;
  goldMultiplier?: number;
  isAlliancesDisabled?: boolean;
  isPortsDisabled?: boolean;
  isNukesDisabled?: boolean;
  isSAMsDisabled?: boolean;
  isPeaceTime?: boolean;
  isWaterNukes?: boolean;
}

export interface UnitInfo {
  cost: (game: Game, player: Player) => Gold;
  maxHealth?: number;
  damage?: number;
  constructionDuration?: number;
  upgradable?: boolean;
  // terron: ультимейты — потолок уровня апгрейда (форты: 3). Без него апгрейд
  // не ограничен (силосы/города). new-units/ULTIMATES.md
  maxLevel?: number;
}

function unitTypeGroup<T extends readonly UnitType[]>(types: T) {
  return {
    types,
    has(type: UnitType): type is T[number] {
      return (types as readonly UnitType[]).includes(type);
    },
  };
}

export enum UnitType {
  TransportShip = "Transport",
  Warship = "Warship",
  Shell = "Shell",
  SAMMissile = "SAMMissile",
  Port = "Port",
  AtomBomb = "Atom Bomb",
  HydrogenBomb = "Hydrogen Bomb",
  TradeShip = "Trade Ship",
  MissileSilo = "Missile Silo",
  DefensePost = "Defense Post",
  SAMLauncher = "SAM Launcher",
  City = "City",
  MIRV = "MIRV",
  MIRVWarhead = "MIRV Warhead",
  Train = "Train",
  Factory = "Factory",
  // terron: авиация — аэропорт (структура) + самолёт (мобильный юнит). Спека: airport.md
  Airport = "Airport",
  Airplane = "Airplane",
  AirborneAssault = "Airborne Assault",
  // terron: авиация — дрон-камикадзе: летит с ближайшего аэропорта в точку и взрывается
  // (мини-ядерка: ½ цены атомной, радиус ⅓). ПВО сбивает как десант. Спека: airport.md
  SuicideDrone = "Suicide Drone",
  // terron: ультимейты — Мин правды: аура, высасывающая население из врагов в
  // радиусе (процент от их войск → часть тебе). Спека: new-units/ULTIMATES.md
  MinistryOfTruth = "Ministry of Truth",
  // terron: ультимейты — Укрепления: ЗДАНИЕ-штаб (решение владельца 07.07:
  // все ульты кроме чистых атак = здания). Пока живо — бункеры автозахватывают
  // землю в радиусе своей защиты.
  Fortifications = "Fortifications",
  // terron: ультимейты — Центробанк: лодки владельца нельзя перехватить,
  // самолёты не платят комиссию за пролёт. new-units/ULTIMATES.md
  CentralBank = "Central Bank",
  // terron: ультимейты — Авиаштаб: десант бесплатный, высаживается 100%
  // (вместо 50%), плацдарм держится 60с (вместо 30с).
  AirCommand = "Air Command",
  // terron: ультимейты — Танковый завод: атаки владельца игнорируют защиту
  // вражеских бункеров.
  TankFactory = "Tank Factory",
  // terron: ультимейты — Раскол: таргетная «пропаганда» (не ракета). Наводишься
  // на чужую страну — «флаг» (прямоугольник 3:2 с буквой Т в центре) вырезает
  // кусок: ОСНОВА флага уходит к новому боту-сепаратисту (вечный иммунитет от
  // схлопывания), Т остаётся тебе с 60с таймером спасения. Спека: new-units/SPLIT.md
  Split = "Split",
  // terron: ультимейты — Религия: ЗДАНИЕ-храм (одно на игрока). Пока живо, ВСЯ
  // территория медленно расползается наружу (тихо съедает соседнюю землю —
  // нейтрал/врагов/друзей). Спека: new-units/ULTIMATES.md
  Religion = "Religion",
  // terron: ультимейты — Минирование: ЗДАНИЕ-штаб (пассив). Пока живо, у владельца
  // 50% вражеского МОРСКОГО десанта гибнет на минах. Спека: new-units/ULTIMATES.md
  Mining = "Mining",
  // terron: ультимейты — Реваншизм: ЧИСТЫЙ ПАССИВ (без здания/юнита, фикс через
  // choose_ultimate). Теряя землю от исторического пика, защита ВСЕЙ территории
  // растёт 0..+200% (как бункеры, но глобально). См. Config.attackLogic.
  Revanchism = "Revanchism",
  // terron: ультимейты — Небо наше: ПОСТОЯННЫЙ штаб (реворк 21.08, решение
  // владельца). Сам является гигантским ПВО (радиус ×TERRON_OURSKY_SAM_RADIUS_MULT
  // от базового) + пассив: все ПВО владельца перезаряжаются ×2 быстрее. Штаб
  // РАЗБЛОКИРУЕТ каст SatelliteStrike (ракета-ослепление). Спека: new-units/NEBO.md
  OurSky = "Our Sky",
  // terron: ультимейты — «Сбить спутники»: ракета-каст от штаба «Небо наше»
  // (реворк 21.08). Ставится на своей земле, 60с сборки = телеграф (URGENT всем,
  // сносибельна = контрплей), затем запуск: +10с волна тьмы → 60с туман войны у
  // всех, кроме владельца (team-команда щадится). Спека: new-units/NEBO.md
  SatelliteStrike = "Satellite Strike",
  // terron: ультимейты — МЕДИА: ЗДАНИЕ-штаб (одно на игрока). Пассив, пока живо —
  // предательство НЕ карается (нет метки предателя), и РАЗБЛОКИРУЕТ каст Раскола
  // (флаг-пропаганда, 1:1 старый Split) сколько угодно раз. «Наши действия
  // оправданы. Убеждает международное сообщество.» Спека: new-units/ULTIMATES.md
  Media = "Media",
  // terron: ультимейты — Ядерный завод: здание-ульта (5M), РАЗБЛОКИРУЕТ каст МИРВ
  // (как МЕДИА разблокирует Раскол). Пока завод стоит — МИРВ доступен на 5M дешевле
  // (игрок уже оплатил завод). Спека: new-units/ULTIMATES.md
  NuclearFactory = "NuclearFactory",
  // terron: ультимейты — «РЕКИ ВСПЯТЬ»: ЗДАНИЕ-штаб (одно на игрока), РАЗБЛОКИРУЕТ
  // каст WaterNuke (как МЕДИА разблокирует Раскол, а Ядерный завод — МИРВ).
  // Спека: new-units/ULTIMATES.md, цифры — TerronTuning §РЕКИ ВСПЯТЬ.
  RiversBack = "Rivers Back",
  // terron: ультимейты — ракета «Реки вспять»: пуск из шахты, как атомная, но
  // земля в радиусе не выжигается, а ЗАТАПЛИВАЕТСЯ навсегда (суша → вода).
  WaterNuke = "Water Nuke",
  // terron: НЕФТЯНАЯ ВЫШКА — обычное здание (не ульта), строится на ОКЕАНЕ и
  // работает как порт, но платит ×TERRON_OILRIG_TRADE_MULT. TerronTuning §ВЫШКА.
  OilRig = "Oil Rig",
  // terron: ультимейты — ПОДЛОДКИ: штаб, превращающий все боевые корабли
  // владельца в подлодки (спрайт + фора «не видят и не стреляют до первого
  // выстрела»). TerronTuning §ПОДЛОДКИ.
  SubmarineBase = "Submarine Base",
  // terron: ультимейты — ЗАКРЫТАЯ СТРАНА (первая ЗАКРЫТАЯ ульта, TZ-ult-unlocks.md):
  // ЗДАНИЕ-штаб (пассив). Пока стоит, для всех, кроме владельца и его команды,
  // его параметры (войска/золото/численность атак, подпись войск на карте)
  // скрыты — «???». Скрытие ЧИСТО ВИДОВОЕ (как подлодки): сим не читает.
  // Открывается ачивкой (победа в алмазном с запуском Неба) ИЛИ за 500 ПТС —
  // реестр LOCKED_ULTIMATES ниже.
  ClosedCountry = "Closed Country",
  // terron: ультимейты — ПИРАТСТВО (ЗАКРЫТАЯ ульта, TZ-ult-unlocks.md): ЗДАНИЕ-штаб
  // (пассив). Пока стоит, ВСЕ боевые корабли владельца — пиратские лодки:
  // ×2 скорость, ×⅓ урон снаряда, ×⅓ цена, свой спрайт; умирают как обычные.
  // Ключ: потопи 500 кораблей И захвати 500 (min) — или 500 ПТС.
  Piracy = "Piracy",
  // terron: «БЛОКАДА» — каст Пиратства (BuildableAttack, юнит не строится):
  // точка в океане → зона паники для чужой торговли на 3 мин. TerronTuning.
  Blockade = "Blockade",
  // terron: ультимейты — ГОРДОСТЬ (ЗАКРЫТАЯ ульта): штаб 1M; чем ниже в топе,
  // тем быстрее растёт население и доход (до ×2). Каст — Truce. TerronTuning.
  Pride = "Pride",
  // terron: «Олимпийские игры» — каст Стадиона (BuildableAttack): мир во всём
  // мире на минуту, все всем друзья. TerronTuning §ОЛИМПИЙСКИЕ ИГРЫ.
  Truce = "Truce",
  // terron: ультимейты — ОЛИМПИЙСКИЕ ИГРЫ (ЗАКРЫТАЯ ульта): СТАДИОН, штаб 10M,
  // +50 % прирост и доход; каст Truce. Ключ — 10 млрд золота за карьеру.
  Olympics = "Olympics",
  // terron: «Передышка» — каст Гордости (BuildableAttack): мир вокруг кастера,
  // длительность от доли потраченных войск (парабола). TerronTuning.
  Respite = "Respite",
  // terron: ультимейты — ФАНАТИЗМ (ЗАКРЫТАЯ ульта): штаб; войска ×3, доход ×½,
  // атака −50 %. Каст — Terror. TerronTuning §ФАНАТИЗМ.
  Fanaticism = "Fanaticism",
  // terron: «Террор» — каст Фанатизма (BuildableAttack): у страны-цели раз в
  // минуту взрывается случайное здание.
  Terror = "Terror",
  // terron: ультимейты — ЗНАМЯ ПОБЕДЫ (ЗАКРЫТАЯ ульта): штаб обезглавливания —
  // все удерживаемые столицы ×10, трофейные остаются столицами, жертве нельзя
  // основать новую, +50 % атаки по ней. new-units/BANNER.md
  VictoryBanner = "Victory Banner",
  // terron: ультимейты — ДВОРЕЦ НАЦИЙ (ЗАКРЫТАЯ ульта, new-units/PEACE.md): штаб;
  // пассивы «предавший меня — предатель 60с» и «нации не отказывают в союзе»;
  // каст — Pact.
  PeacePalace = "Peace Palace",
  // terron: «Пакт» — каст Дворца наций (BuildableAttack): навязанный союз на
  // 5 минут игроку под тайлом.
  Pact = "Pact",
  // terron: ультимейты — ЗЕЛЁНЫЕ (ЗАКРЫТАЯ ульта, new-units/GREEN.md): штаб.
  // Плата — ядерное оружие недоступно вообще; взамен +30% прироста, шахты
  // считаются городами, пепел на своей земле выветривается ×5.
  // Пассив-возмездие: детонация ядерки штрафует ТОГО, КТО ПУСТИЛ.
  Greens = "Greens",
  // terron: ЗЕЛЁНЫЕ — гражданский борт-инспекция. Летит из штаба к воронке и
  // ПО ПРИЛЁТУ вешает штраф на пустившего. ⚠️ ПВО его НЕ перехватывает
  // (решение владельца: это торговый самолёт) — контрплей в сносе штаба.
  GreenInspection = "Green Inspection",
  // terron: «Это катастрофа!» — каст Зелёных (BuildableAttack): травля любой
  // страны, включая нации-ботов, ступень штрафа в общую шкалу.
  Catastrophe = "Catastrophe",
  // terron: ультимейты — АЭС (ЗАКРЫТАЯ ульта, new-units/NUCLEAR.md): антипод
  // Зелёных. Ядерки дешевле, пепел проходится легче, уборка приносит золото,
  // а потеря штаба через минуту даёт водородный взрыв («Чернобыль»).
  NuclearPlant = "Nuclear Plant",
  // terron: «Рекультивация» — каст АЭС (BuildableAttack): снимает пепел в
  // радиусе, платит за каждый убранный тайл (со своей земли — эмиссия, с
  // чужой — списание из казны прежнего владельца).
  Recultivation = "Recultivation",
  // terron: ультимейты — ТОПЛИВО (ЗАКРЫТАЯ ульта, new-units/FUEL.md): всё, что
  // едет своим ходом, у владельца быстрее; торговые лодки неперехватываемы.
  Fuel = "Fuel",
  // terron: «Индустриальная революция» — каст Топлива (BuildableAttack):
  // наводится на любую страну, включая СЕБЯ. ×3 скорость и −50% прироста.
  IndustrialRevolution = "Industrial Revolution",
  // terron 23.08: СЕКРЕТНАЯ ПОСТРОЙКА «КРУГ» — «ты нашёл клад» (new-units/CUBE.md).
  // Её нет ни в сетке выбора, ни в вики, ни в дереве ульт: вызывается ТОЛЬКО
  // вводом кода 1337 прямо на сетке ульт (она же цифровая клавиатура).
  // Стоит как обычный ульт-штаб и разом выдаёт TERRON_TREASURE_PAYOUT.
  SecretTreasure = "Secret Treasure",
  // terron: ультимейты — ДОРА (ЗАКРЫТАЯ ульта, new-units/DORA.md): тяжёлое
  // ж/д орудие. ЕДУЩЕЕ ЗДАНИЕ: ходит по рельсам, стреляет мгновенно, его
  // можно захватить вместе с землёй. Дальнобойность = твоя застройка.
  RailGun = "Rail Gun",
  // terron: «Выстрел Доры» — каст (BuildableAttack): назначает цель. Если она
  // вне радиуса, орудие само едет по рельсам, пока не достанет.
  RailGunShell = "Rail Gun Shell",
  // terron: ультимейты — КОСМОДРОМ (ЗАКРЫТАЯ ульта, new-units/SPACE.md):
  // раз в минуту запуск, снимающий процент дохода со ВСЕХ стран. Ставится на
  // своей земле или в океане (по образцу нефтяной вышки).
  Spaceport = "Spaceport",
  // terron: ультимейты — ВЗРЫВНЫЕ ПОЕЗДА (new-units/TRAINS.md): депо, пока
  // стоит — поезда владельца вдвое быстрее; каст пускает по СВОИМ рельсам
  // тикающий состав, который взрывается в конце маршрута.
  TrainDepot = "Train Depot",
  // terron: «Состав смерти» — каст Взрывных поездов (BuildableAttack): едет по
  // рельсам к выбранной точке и детонирует. Рвут пути перед ним — рванёт там.
  DoomTrain = "Doom Train",
  // terron: ультимейты — МИРНОЕ НЕБО (ЗАКРЫТАЯ ульта,
  // new-units/PEACEFULSKY.md): ПВО вдвое дешевле, но сбивает ВСЁ чужое в
  // радиусе, включая ракеты союзников.
  PeacefulSky = "Peaceful Sky",
  // terron 24.08: ультимейты — ШАГАЮЩИЙ ГОРОД (new-units/WALKING.md): штаб
  // разблокирует каст «Перенос» — свои здания в зоне медленно ИДУТ в указанную
  // точку (1 тайл/сек) и встают там. Порты ходят вдоль воды, сухопутные — по
  // своей суше. Концепт владельца по мотивам Walking City Арчиграма.
  WalkingCity = "Walking City",
  // terron 24.08: «Перенос» — каст Шагающего города (BuildableAttack, два
  // клика: зона + куда идти; размер зоны = слайдер войск с капом 30%).
  CityTransfer = "City Transfer",
}

export enum TrainType {
  Engine = "Engine",
  TailEngine = "TailEngine",
  Carriage = "Carriage",
}

export const Nukes = unitTypeGroup([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRVWarhead,
  UnitType.MIRV,
  UnitType.WaterNuke, // terron: ультимейты — «Реки вспять» (топит землю)
] as const);

// terron: НЕФТЯНАЯ ВЫШКА — «торговые узлы»: к ним ходят торговые лодки. Порт и
// вышка взаимозаменяемы как источник И как цель рейса (вышка платит ×5).
// Используется в PortExecution (выбор цели) и TradeShipExecution (перенацел.).
export const TradeHubs = unitTypeGroup([
  UnitType.Port,
  UnitType.OilRig,
  UnitType.Piracy, // terron: штаб Пиратства — порт (решение владельца 22.08)
  // terron 23.08 (решение владельца): КОСМОДРОМ — тоже точка рейса, но КПД
  // 1:1, как обычный порт (у вышки ×5). Кораблей не строит и не чинит —
  // чисто торговый узел. Поэтому он в TradeHubs, но НЕ в actingAs(Port).
  UnitType.Spaceport,
] as const);

/**
 * terron 23.08 — ВРЕМЕННЫЕ БАФ-ЗДАНИЯ: маркеры эффектов, живущие ровно
 * длительность эффекта (см. execution/TimedBuffExecution.ts). Не строятся
 * игроком, не чинятся, не апаются; правило «одно на страну» проверяется по
 * этой группе. Новый временной эффект = запись здесь + наследник базового
 * класса, а не свой невидимый счётчик.
 */
export const TimedBuffs = unitTypeGroup([
  UnitType.IndustrialRevolution,
] as const);

export const BuildableAttacks = unitTypeGroup([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.Warship,
  UnitType.SuicideDrone, // terron: авиация — дрон-камикадзе (мини-ядерка с аэропорта)
  UnitType.Split, // terron: ультимейты — таргетная атака-раскол (не строит юнит)
  UnitType.WaterNuke, // terron: ультимейты — «Реки вспять» (каст из шахты)
  // terron: «Сбить спутники» — каст Неба нашего: ставит ракету-носитель на своей
  // земле (60с телеграф, сносибельна), НЕ структура (канон кастов). NEBO.md
  UnitType.SatelliteStrike,
  // terron: «Блокада» — каст Пиратства (зона паники торговли, юнит не строится)
  UnitType.Blockade,
  UnitType.Respite, // terron: каст Гордости (передышка: мир вокруг кастера)
  UnitType.Truce, // terron: каст Стадиона (Олимпийские игры: мир во всём мире)
  UnitType.Terror, // terron: каст Фанатизма (взрывы зданий у цели)
  UnitType.Pact, // terron: каст Дворца наций (навязанный союз)
  UnitType.Catastrophe, // terron: каст Зелёных (травля: штраф к доходу цели)
  UnitType.Recultivation, // terron: каст АЭС (уборка пепла за деньги)
  UnitType.IndustrialRevolution, // terron: каст Топлива (скорость ценой прироста)
  UnitType.RailGunShell, // terron: каст Доры (назначить цель орудию)
  UnitType.DoomTrain, // terron: каст Взрывных поездов (тикающий состав)
  UnitType.CityTransfer, // terron: каст Шагающего города (перенос зданий)
] as const);


// ═══════════════════════════════════════════════════════════════════════════
// terron 23.08: ЕДИНЫЙ РЕЕСТР УЛЬТ — ОДНА ЗАПИСЬ НА УЛЬТУ.
//
// ⚠️ ЗАЧЕМ ЭТО ПОЯВИЛОСЬ. Раньше добавление одной ульты означало правку ~16
// РУЧНЫХ СПИСКОВ в 19 файлах: Ultimates, Structures, LOCKED_ULTIMATES,
// CAST_UNLOCKED_BY, ULT_MAX_COUNT, STRUCTURE_EXECUTIONS, UNIT_CATALOG,
// ALL_UNIT_TYPES, STRUCTURE_TYPES, STRUCTURE_ORDER/алиасы, render-settings,
// i18n ×2, вики, каталог API… Забыть один — обычное дело, и 23.08 так и
// вышло: шесть ульт проехали мимо ALL_UNIT_TYPES и молча остались БЕЗ
// СПРАЙТА (ни госта при постройке, ни здания на карте), причём тест-сторож
// это пропустил, потому что искал подстроку по всему файлу.
//
// ПРАВИЛО ТЕПЕРЬ: новая ульта = ОДНА запись здесь + файл Execution.
// Всё, что можно вывести, — выводится ниже по файлу и в клиенте.
// Всё, что вывести нельзя (текст i18n, картинка иконки, логика эффекта), —
// проверяется тестом ПО ЭТОМУ РЕЕСТРУ, то есть забыть по-прежнему нельзя,
// но узнаёшь об этом от гейта, а не от игрока.
// ═══════════════════════════════════════════════════════════════════════════

/** Откуда ульта берёт колонку в icon-atlas. */
export type UltAtlas =
  /** Своя колонка (её надо нарисовать генератором new-units/gen-ult-assets.py). */
  | { own: true }
  /**
   * Колонка занята у другого типа — законный и самый частый вариант.
   * Строкой можно указать СИНТЕТИЧЕСКУЮ колонку атласа (её нет среди
   * UnitType, но она есть в развёртке PNG: "TrainEngine", "Submarine",
   * "Pirate"). Сторож всё равно проверит, что такая колонка существует.
   */
  | { alias: UnitType | string }
  /**
   * terron 23.08: У КАСТА ВООБЩЕ НЕТ СПРАЙТА — эффект применяется к стране, по
   * карте ничего не летит («Пакт», «Террор», «Передышка», «Катастрофа»…).
   *
   * ⚠️ Вариант заведён потому, что до него ВСЕ касты подряд были помечены
   * `own: true`, включая те, у которых никакой колонки нет и быть не могло.
   * Поле существовало, но ничего не значило — а значит, и не ловило ошибку:
   * ровно так «Выстрел Доры» уехал на дев вообще без спрайта. Теперь у каста
   * ровно три честных варианта, и тест проверяет, что заявленная колонка
   * действительно существует.
   */
  | { none: true };

export interface LockedUltimateDef {
  /** Цена покупки, ПТС (кровавые алмазы). */
  pricePts: number;
  /** id ачивки platform-api, дающей разблокировку бесплатно. */
  achievement: string;
  /**
   * «Родитель» в дереве ульт. null = замок ПЕРВОГО уровня (растёт из центра,
   * как базовые). ⚠️ Если родитель сам ЗАКРЫТ — это ЦЕПОЧКА (решение
   * владельца 24.08): открыть ребёнка нельзя, пока не открыт родитель, —
   * и покупкой тоже. Гейт живёт в API (buy/grant), клиент только показывает.
   */
  parent: UnitType | null;
}

export interface UltimateDef {
  /** Тип-штаб. Он же ключ реестра. */
  type: UnitType;
  /** Ключ i18n: unit_type.<key> и build_menu.desc.<key>. */
  key: string;
  /** Имя файла иконки в resources/images (без пути). */
  icon: string;
  /** Колонка атласа. */
  atlas: UltAtlas;
  /** Замок: null = базовая ульта, доступна всем навсегда. */
  locked: LockedUltimateDef | null;
  /**
   * terron 23.08: ЧЕМ ЭТА УЛЬТА ЯВЛЯЕТСЯ, КРОМЕ САМОЙ СЕБЯ.
   *
   * `null` — обычный ульт-штаб на своей земле. Иначе — тип здания, чьи правила
   * ульта наследует ЦЕЛИКОМ: правила постановки (включая магнит!) и все гейты,
   * которые спрашивают «есть ли у игрока такое здание».
   *
   * ⚠️ ЗАЧЕМ ЭТО ПОЯВИЛОСЬ (репорт владельца 23.08 по Пиратству): штаб был
   * ПОРТОМ по замыслу, но «портом» его считал только спавн кораблей. Кнопка
   * «корабль» в панели смотрела `units(UnitType.Port)` и оставалась серой, а
   * гост не магнитился к берегу. Каждое такое место надо было вспомнить
   * руками — теперь достаточно объявить родство ОДИН раз здесь.
   */
  actsAs: UnitType | null;
  /**
   * terron 24.08: СКОЛЬКО ОБЫЧНЫХ ЗДАНИЙ «стоит» эта ульта там, где считают
   * КОЛИЧЕСТВО (`actsAs` отвечает на «является ли», это — на «за сколько»).
   *
   * Депо смерти по решению владельца — «×5 прокачанная фабрика»: рельсы и
   * поезда от неё идут так, будто у игрока пять фабрик. Без отдельного поля
   * это пришлось бы вписывать руками в каждый подсчёт, а их несколько.
   * Не указано = 1.
   */
  actsAsCount?: number;
  /**
   * terron 23.08: ЧЕМ УЛЬТА ПОДМЕНЯЕТ ОБЫЧНЫЙ ЮНИТ.
   *
   * `null` — ничего не подменяет. Иначе: «пока штаб стоит, вместо `unit` игрок
   * строит вот это» — с другой иконкой и другим названием в интерфейсе.
   *
   * ⚠️ Появилось по репорту владельца 23.08: с Пиратством игрок строит уже НЕ
   * боевые корабли, а пиратские лодки — а кнопка 8 всё равно показывала
   * линкор. Раньше такая подмена жила ОДНОЙ функцией на подлодки
   * (`warshipIconFor`), и каждая следующая ульта-подменщик требовала правки
   * этой функции руками. Теперь подмена объявляется в реестре.
   */
  replaces: { unit: UnitType; icon: string; key: string } | null;
  /**
   * terron 23.08: КРУГ РАДИУСА ПРИ НАВЕДЕНИИ ПОСТРОЙКИ ШТАБА, в тайлах.
   * 0 = круга нет; "dynamic" = радиус считается на клиенте (зависит от уровня
   * здания, множителей ульты или конфига) и живёт в BuildPreviewController.
   *
   * ⚠️ ПОЛЕ ОБЯЗАТЕЛЬНОЕ — по тем же причинам, что и cast.previewRadius:
   * необъявленный гост не отличить от забытого. Ровно на этом «Дора» уехала
   * на дев с радиусом, который игрок не мог увидеть до постройки.
   * Источник правды ОДИН: число здесь ИЛИ ветка в контроллере, но не оба —
   * это держит тест «у ульты один источник круга».
   */
  hqPreviewRadius: number | "dynamic";
  /** Каст, который разблокирует штаб. Нет = ульта чисто пассивная. */
  cast?: {
    type: UnitType;
    key: string;
    icon: string;
    /** Колонка атласа каста (у кастов почти всегда алиас). */
    atlas: UltAtlas;
    /**
     * terron 23.08: ГОСТ ЗОНЫ ДЕЙСТВИЯ при наведении — радиус в тайлах.
     * 0 = у каста нет области (точечный эффект по стране), круг не нужен.
     *
     * ⚠️ ПОЛЕ ОБЯЗАТЕЛЬНОЕ, и это осознанно. Раньше гост атакующих кастов
     * нигде не объявлялся: у ядерок он был, у новых кастов его просто забыли —
     * не «решили, что не нужен», а ПРОСТО НЕ НАПИСАЛИ, и заметить это можно
     * было только в бою. Теперь при добавлении ульты компилятор заставляет
     * ответить на вопрос «какая у каста зона» явно: число или честный ноль.
     */
    previewRadius: number;
  };
  /** Сколько копий здания можно построить. По умолчанию 1. */
  maxCount?: number;
  /**
   * terron 23.08: СЕКРЕТНАЯ постройка (new-units/CUBE.md) — её нет в сетке
   * выбора, в вики и в дереве ульт; вызывается только вводом кода.
   *
   * ⚠️ Это НЕ замок: замок (`locked`) отвечает на вопрос «есть ли право», а
   * `secret` — на вопрос «показываем ли мы, что оно существует».
   */
  secret?: true;
}

/** ЕДИНЫЙ РЕЕСТР. Новая ульта = одна запись ЗДЕСЬ + файл Execution. */
export const ULTIMATE_REGISTRY: readonly UltimateDef[] = [
  {
    type: UnitType.NuclearFactory,
    key: "nuclear_factory",
    icon: "NuclearFactoryIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: null,
    cast: {
      type: UnitType.MIRV,
      key: "mirv",
      icon: "MIRVIcon.svg",
      atlas: { own: true },
      // боеголовки расходятся по всей карте — одним кругом не показать
      previewRadius: 0,
    },
  },
  {
    type: UnitType.Fortifications,
    key: "fortifications",
    // ⚠️ Файл называется FortIconWhite, а не FortificationsIconWhite — при
    // генерации реестра 23.08 сюда подставилось имя по шаблону, и иконки не
    // стало. Поймал сплошной аудит; теперь он же держит это тестом.
    icon: "FortIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: "dynamic",
    actsAs: null,
    replaces: null,
    locked: null,
  },
  {
    type: UnitType.CentralBank,
    key: "central_bank",
    icon: "BankIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: null,
  },
  {
    type: UnitType.AirCommand,
    key: "air_command",
    icon: "AirCommandIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: null,
  },
  {
    type: UnitType.TankFactory,
    key: "tank_factory",
    icon: "TankIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: null,
  },
  {
    type: UnitType.Media,
    key: "media",
    icon: "MediaIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: "dynamic",
    actsAs: null,
    replaces: null,
    locked: null,
    cast: {
      type: UnitType.Split,
      key: "split",
      icon: "SplitIconWhite.svg",
      atlas: { none: true },
      // флаг раскола рисует свой контур (SplitPreviewController)
      previewRadius: 0,
    },
  },
  {
    type: UnitType.Religion,
    key: "religion",
    icon: "ReligionIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: null,
    // terron: храмов сколько угодно: балансир не лимит, а экономика (каждый режет доход).
    maxCount: Number.POSITIVE_INFINITY,
  },
  {
    type: UnitType.Mining,
    key: "mining",
    icon: "MiningIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: null,
  },
  {
    type: UnitType.Revanchism,
    key: "revanchism",
    icon: "StatueIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: null,
  },
  {
    type: UnitType.OurSky,
    key: "our_sky",
    icon: "OurSkyIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: "dynamic",
    actsAs: null,
    replaces: null,
    locked: null,
    cast: {
      type: UnitType.SatelliteStrike,
      key: "satellite_strike",
      icon: "OurSkyIconWhite.svg",
      atlas: { alias: UnitType.OurSky },
      // ослепление всемирное, зоны нет
      previewRadius: 0,
    },
  },
  {
    type: UnitType.RiversBack,
    key: "rivers_back",
    icon: "RiversBackIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: null,
    cast: {
      type: UnitType.WaterNuke,
      key: "water_nuke",
      icon: "RiversBackIconWhite.svg",
      atlas: { alias: UnitType.AtomBomb },
      // радиус берётся из nukeMagnitudes, как у обычных ядерок
      previewRadius: 0,
    },
  },
  {
    type: UnitType.SubmarineBase,
    key: "submarine_base",
    icon: "SubmarineIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: {
      unit: UnitType.Warship,
      icon: "SubmarineIconWhite.svg",
      key: "submarine",
    },
    locked: null,
  },
  {
    type: UnitType.OilRig,
    key: "oil_rig",
    icon: "OilRigIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: "dynamic",
    actsAs: null,
    replaces: null,
    locked: null,
    // terron: вышек сколько угодно: тормозит цена, каждая следующая дороже.
    maxCount: Number.POSITIVE_INFINITY,
  },
  {
    type: UnitType.ClosedCountry,
    key: "closed_country",
    icon: "ClosedCountryIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: {
      pricePts: 500,
      achievement: "closed_country_key",
      parent: UnitType.OurSky,
    },
  },
  {
    type: UnitType.Piracy,
    key: "piracy",
    icon: "PiracyIconWhite.svg",
    // terron 23.08: СВОЯ колонка (череп с костями). До этого штаб делил
    // колонку с Подводным флотом — и на карте у пирата стояла иконка
    // ПОДЛОДКИ (репорт владельца: «у пиратства иконка подлодки на ульте»).
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: UnitType.Port,
    replaces: {
      unit: UnitType.Warship,
      icon: "PirateShipIconWhite.svg",
      key: "pirate_ship",
    },
    locked: {
      pricePts: 500,
      achievement: "pirate_key",
      parent: UnitType.SubmarineBase,
    },
    cast: {
      type: UnitType.Blockade,
      key: "blockade",
      icon: "PiracyIconWhite.svg",
      atlas: { none: true },
      // terron 23.08 (решение владельца «второй круглый гост убери на касте»):
      // у Блокады СВОЁ превью — контур реющего флага (SplitPreviewController),
      // и круг поверх него был вторым гостом об одном и том же.
      previewRadius: 0,
    },
  },
  {
    type: UnitType.Pride,
    key: "pride",
    icon: "PrideIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: {
      pricePts: 500,
      achievement: "pride_key",
      parent: UnitType.Revanchism,
    },
    cast: {
      type: UnitType.Respite,
      key: "respite",
      icon: "TruceIconWhite.svg",
      atlas: { none: true },
      // мир вокруг кастера, границы зоны нет
      previewRadius: 0,
    },
  },
  {
    type: UnitType.Olympics,
    key: "olympics",
    icon: "OlympicsIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: {
      pricePts: 500,
      achievement: "olympics_key",
      parent: UnitType.Pride,
    },
    cast: {
      type: UnitType.Truce,
      key: "truce",
      icon: "OlympicsIconWhite.svg",
      atlas: { none: true },
      // мир во всём мире
      previewRadius: 0,
    },
  },
  {
    type: UnitType.Fanaticism,
    key: "fanaticism",
    icon: "FanaticismIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: {
      pricePts: 500,
      achievement: "terror_key",
      parent: UnitType.Revanchism,
    },
    cast: {
      type: UnitType.Terror,
      key: "terror",
      icon: "TerrorIconWhite.svg",
      atlas: { none: true },
      // взрывы по стране цели, не по кругу
      previewRadius: 0,
    },
  },
  {
    type: UnitType.VictoryBanner,
    key: "victory_banner",
    icon: "VictoryBannerIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: {
      pricePts: 500,
      achievement: "banner_key",
      parent: UnitType.TankFactory,
    },
  },
  {
    type: UnitType.PeacePalace,
    key: "peace_palace",
    icon: "PeacePalaceIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: {
      pricePts: 500,
      achievement: "peace_key",
      parent: UnitType.Media,
    },
    cast: {
      type: UnitType.Pact,
      key: "pact",
      icon: "PactIconWhite.svg",
      atlas: { none: true },
      // точечно: союз со страной под курсором
      previewRadius: 0,
    },
  },
  {
    type: UnitType.Greens,
    key: "greens",
    icon: "GreensIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: {
      pricePts: 500,
      achievement: "clean_hands_key",
      parent: UnitType.CentralBank,
    },
    cast: {
      type: UnitType.Catastrophe,
      key: "catastrophe",
      icon: "CatastropheIconWhite.svg",
      atlas: { none: true },
      // точечно: штраф стране под курсором
      previewRadius: 0,
    },
  },
  {
    type: UnitType.NuclearPlant,
    key: "nuclear_plant",
    icon: "NuclearPlantIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: {
      pricePts: 500,
      achievement: "atomic_key",
      parent: UnitType.NuclearFactory,
    },
    cast: {
      type: UnitType.Recultivation,
      key: "recultivation",
      icon: "RecultivationIconWhite.svg",
      atlas: { none: true },
      // уборка пепла в радиусе — TERRON_RECULT_RADIUS
      previewRadius: 100,
    },
  },
  {
    type: UnitType.Fuel,
    key: "fuel",
    icon: "FuelIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    // terron 24.08 (решение владельца): Топливо — ЗАМОК ПЕРВОГО УРОВНЯ
    // (растёт из центра), с него начинается цепочка Топливо → Дора → Депо.
    locked: {
      pricePts: 500,
      achievement: "factory_key",
      parent: null,
    },
    cast: {
      type: UnitType.IndustrialRevolution,
      key: "industrial_revolution",
      icon: "IndustrialRevolutionIconWhite.svg",
      atlas: { none: true },
      // точечно: эффект на страну под курсором
      previewRadius: 0,
    },
  },
  {
    type: UnitType.RailGun,
    key: "rail_gun",
    icon: "RailGunIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: TERRON_RAILGUN_RANGE,
    actsAs: null,
    replaces: null,
    // terron 24.08: Дора — вторая ступень топливной цепочки. Ключ — 1000
    // отправленных поездов (стат trainsSent); прежний siege_key остался
    // обычной ачивкой-трофеем.
    locked: {
      pricePts: 500,
      achievement: "trains_key",
      parent: UnitType.Fuel,
    },
    cast: {
      type: UnitType.RailGunShell,
      key: "rail_gun_shell",
      icon: "RailGunShellIconWhite.svg",
      atlas: { alias: UnitType.Shell },
      // terron 23.08 (решение владельца): круга под курсором НЕТ — обычный
      // прицел атаки. Куда орудие достанет, показывает облачко зоны доезда, а
      // куда прилетит — красный гост с отсчётом ПОСЛЕ принятия приказа.
      previewRadius: 0,
    },
  },
  {
    type: UnitType.Spaceport,
    key: "spaceport",
    icon: "SpaceportIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    // terron 23.08 (решение владельца): площадок можно ставить ПЯТЬ — в этом
    // и смысл ульты «растёт на чужом богатстве»: одна площадка ничего не
    // решает. Морская стоит вдвое дороже и шлёт запуски вдвое чаще.
    maxCount: 5,
    // terron 24.08 (решение владельца): Космодром растёт из НЕФТЯНОЙ ВЫШКИ,
    // и открывает его нефтяной ключ — 20 вышек одновременно в одном матче.
    // Прежний space_key (20 млрд) остался обычной ачивкой-трофеем.
    locked: {
      pricePts: 500,
      achievement: "oil_baron_key",
      parent: UnitType.OilRig,
    },
  },
  {
    type: UnitType.PeacefulSky,
    key: "peaceful_sky",
    icon: "PeacefulSkyIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    locked: {
      pricePts: 500,
      achievement: "sky_key",
      parent: UnitType.OurSky,
    },
  },
  // terron 23.08 — ВЗРЫВНЫЕ ПОЕЗДА (идея владельца: «поезд, который тикает»).
  // Спека new-units/TRAINS.md. 24.08 — ЗАКРЫТА как вершина топливной цепочки:
  // ключ = 50 ульт-зданий (чужих И своих), снесённых выстрелами Доры.
  {
    type: UnitType.TrainDepot,
    key: "train_depot",
    icon: "TrainIconWhite.svg",
    // terron 24.08 (репорт владельца «почему это не выглядит как ульта»):
    // СВОЯ колонка. С алиасом на фабрику депо рисовалось обычным зданием —
    // без звезды-подложки, которая и означает «это ульта».
    atlas: { own: true },
    // Круга нет: куда доедет состав, показывает облачко зоны — оно честнее
    // круга, потому что считается по РЕЛЬСАМ, а не по прямой.
    hqPreviewRadius: 0,
    // terron 24.08 (решение владельца): депо — ЭТО ФАБРИКА, причём «×5
    // прокачанная»: и рельсы от неё растут, и поезда ходят как при пяти
    // фабриках. Объявляем родство и вес в реестре, а не в подсчётах.
    actsAs: UnitType.Factory,
    actsAsCount: 5,
    replaces: null,
    locked: {
      pricePts: 500,
      achievement: "doom_train_key",
      parent: UnitType.RailGun,
    },
    cast: {
      type: UnitType.DoomTrain,
      key: "doom_train",
      icon: "TrainIconWhite.svg",
      // terron 24.08: СВОЯ колонка (вагон с атомным символом) — раньше состав
      // ехал спрайтом обычного паровоза и от мирного не отличался.
      atlas: { own: true },
      // ⚠️ terron 24.08 (репорт владельца «ты сделал маленький гост, а нужен
      // гост размером с будущий взрыв»): круг под курсором = НАСТОЯЩИЙ радиус
      // детонации состава (ядерка ×2 = 30×2), а не декоративная десятка.
      previewRadius: 30 * TERRON_TRAINS_BLAST_MULT,
    },
  },
  // terron 24.08 — ШАГАЮЩИЙ ГОРОД (идея владельца: Walking City Арчиграма).
  // Спека new-units/WALKING.md.
  // ⚠️ 25.08 (решения владельца по обкатке): ульта СЕКРЕТНАЯ и ЗАКРЫТАЯ —
  // «тир 0, базово закрыт, правила отображения такие же, всё в ???? как у
  // круга». То есть в витрине её существование не раскрывается (`secret`), а
  // право на неё даёт ачивка `walking_city_key` (или ПТС), как у прочих замков.
  {
    type: UnitType.WalkingCity,
    key: "walking_city",
    icon: "WalkingCityIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    secret: true,
    locked: {
      pricePts: 500,
      // Ключ: держать ОДНОВРЕМЕННО 2000 уровней зданий — стат
      // buildingLevelsPeak. Вход в сетку — секретный код 4444 (SecretCodes).
      achievement: "walking_city_key",
      parent: null,
    },
    cast: {
      type: UnitType.CityTransfer,
      key: "city_transfer",
      icon: "WalkingCityIconWhite.svg",
      // По карте ничего не летит — здание идёт само (оно и есть «снаряд»).
      atlas: { none: true },
      // Зоны больше нет: переносим ОДНО здание, по которому кликнули.
      previewRadius: 0,
    },
  },
  {
    type: UnitType.SecretTreasure,
    key: "secret_treasure",
    icon: "SecretTreasureIconWhite.svg",
    atlas: { own: true },
    hqPreviewRadius: 0,
    actsAs: null,
    replaces: null,
    secret: true,
    // Замка нет: клад открывает КОД, а не аккаунт. Он тратит единственный на
    // матч выбор ульты — в этом и цена.
    locked: null,
  },
] as const;

export const Structures = unitTypeGroup([
  UnitType.City,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
  UnitType.Port,
  UnitType.Factory,
  UnitType.Airport, // terron: авиация
  // terron 06.08: Мин правды ВЛИТА В МЕДИА — здание больше не строится. Тип и
  // MinistryOfTruthExecution ЖИВЫ (enum валидирует реле интентов, удаление =
  // рестарт сервера + битые реплеи). Вернуть = раскомментировать тут, в
  // Ultimates ниже, в ULT_MAX_COUNT и в STRUCTURE_EXECUTIONS.
  // UnitType.MinistryOfTruth, // terron: ультимейты
  UnitType.Fortifications, // terron: ультимейты
  UnitType.CentralBank, // terron: ультимейты
  UnitType.AirCommand, // terron: ультимейты
  UnitType.TankFactory, // terron: ультимейты
  UnitType.Religion, // terron: ультимейты — храм (рост территории)
  UnitType.Mining, // terron: ультимейты — минирование (защита от десанта)
  UnitType.Revanchism, // terron: ультимейты — статуя-монумент (здание-штаб)
  UnitType.OurSky, // terron: ультимейты — антиспутник (Небо наше)
  UnitType.Media, // terron: ультимейты — МЕДИА (штаб: игнор предательства + каст Раскола)
  UnitType.NuclearFactory, // terron: ультимейты — Ядерный завод (штаб → разблок МИРВ)
  UnitType.RiversBack, // terron: ультимейты — «Реки вспять» (штаб → разблок водяной ракеты)
  UnitType.OilRig, // terron: нефтяная вышка (обычное здание, строится на океане)
  UnitType.SubmarineBase, // terron: ультимейты — подлодки (штаб)
  UnitType.ClosedCountry, // terron: ультимейты — закрытая страна (штаб, пассив; ЗАКРЫТАЯ ульта)
  UnitType.Piracy, // terron: ультимейты — пиратство (штаб, пассив; ЗАКРЫТАЯ ульта)
  UnitType.Pride, // terron: ультимейты — гордость (штаб, пассив; ЗАКРЫТАЯ ульта)
  UnitType.Olympics, // terron: ультимейты — стадион (штаб, пассив; ЗАКРЫТАЯ ульта)
  UnitType.Fanaticism, // terron: ультимейты — фанатизм (штаб, пассив; ЗАКРЫТАЯ ульта)
  UnitType.VictoryBanner, // terron: ультимейты — знамя победы (штаб, пассив; ЗАКРЫТАЯ ульта)
  UnitType.PeacePalace, // terron: ультимейты — дворец наций (штаб, пассив; ЗАКРЫТАЯ ульта)
  UnitType.Greens, // terron: ультимейты — зелёные (штаб, пассив; ЗАКРЫТАЯ ульта)
  UnitType.NuclearPlant, // terron: ультимейты — АЭС (штаб; ЗАКРЫТАЯ ульта)
  UnitType.Fuel, // terron: ультимейты — топливо (штаб; ЗАКРЫТАЯ ульта)
  UnitType.RailGun, // terron: ультимейты — Дора (едущее здание; ЗАКРЫТАЯ ульта)
  UnitType.Spaceport, // terron: ультимейты — космодром (ЗАКРЫТАЯ ульта)
  UnitType.PeacefulSky, // terron: ультимейты — мирное небо (ЗАКРЫТАЯ ульта)
  UnitType.TrainDepot, // terron: ультимейты — взрывные поезда (депо)
  UnitType.WalkingCity, // terron: ультимейты — шагающий город (перенос зданий)
  UnitType.SecretTreasure, // terron: СЕКРЕТНЫЙ круг «клад» (код 1337)
] as const);

// terron: ультимейты — игрок выбирает ОДИН на матч (слот МИРВ в панели).
// Первое успешное использование фиксирует выбор навсегда (PlayerImpl.ultimateChoice).
// Спека: new-units/ULTIMATES.md
// Все ульты, кроме чистых атак (МИРВ), — ЗДАНИЯ: одно на игрока, эффект
// работает пока здание живо. Фиксация выбора — первым buildUnit.
/**
 * Выводится из ULTIMATE_REGISTRY. Раньше был РУЧНОЙ список, который надо было
 * не забыть — и забывали. Теперь нет записи в реестре = ульты не существует.
 */
export const Ultimates = {
  types: ULTIMATE_REGISTRY.map((u) => u.type) as readonly UnitType[],
  has(type: UnitType): boolean {
    return ULTIMATE_REGISTRY.some((u) => u.type === type);
  },
};

// terron: ЗАМКИ НА УЛЬТЫ (TZ-ult-unlocks.md, решение владельца 21.08, «как в
// DBD»). Ульта, которой тут НЕТ, — базовая и бесплатна всем навсегда. Ульта из
// этого реестра доступна игроку, только если у его аккаунта есть запись
// владения (platform-api `ult_unlocks`): получил ачивкой ИЛИ купил за ПТС.
// Цифры/ачивки — витрина; источник истины по владению — API, проверка — на
// реле интентов игрового сервера (GameServer) + гейт в чузере клиента.
// Дубль каталога (цена, ачивка) живёт в platform-api/src/ults.ts — править ОБА.
// terron: зона блокады «реющий флаг» (каст Пиратства). Живёт, пока живы
// стоящие на якоре лодки: размер считается от их числа (BlockadeGeometry).
export interface Blockade {
  id: number;
  ownerSmallID: number;
  tile: TileRef; // центр флага (без древка)
  hh: number; // половина высоты
  hw: number; // половина ширины
  ships: number; // живых лодок на якоре
  /** terron 23.08: тик, когда зона исчезнет (клиент рисует на флаге отсчёт). */
  expiresAt: number;
  /**
   * terron 23.08 (просьба владельца «сразу рисуй территорию флага, а
   * активируется она когда корабли приплывут»): ЗАЯВЛЕННАЯ, но ещё не
   * работающая зона. Рисуется пунктиром, никого не топит и торговлю не
   * разворачивает — ровно до первого затопленного корпуса.
   */
  pending: boolean;
}

/** Выводится из ULTIMATE_REGISTRY. Руками не править — правь запись реестра. */
/**
 * terron 23.08: «какие типы юнитов СЧИТАЮТСЯ зданием `kind`» — само здание плюс
 * ульты, объявившие `actsAs: kind`.
 *
 * ⚠️ Пользоваться этим ВЕЗДЕ, где код спрашивает «есть ли у игрока порт/город/
 * фабрика», а не перечислять типы руками: ровно так штаб Пиратства (он же порт)
 * не разблокировал постройку кораблей — кнопка смотрела только на UnitType.Port.
 */
/**
 * Сколько зданий вида `kind` «стоит» у игрока с учётом ульт, объявивших
 * родство (`actsAs`) и вес (`actsAsCount`). Пользоваться ВЕЗДЕ, где решает
 * ЧИСЛО зданий, а не факт их наличия.
 */
export function actingAsCount(
  kind: UnitType,
  count: (t: UnitType) => number,
): number {
  let total = count(kind);
  for (const u of ULTIMATE_REGISTRY) {
    if (u.actsAs !== kind) continue;
    total += count(u.type) * (u.actsAsCount ?? 1);
  }
  return total;
}

export function actingAs(kind: UnitType): UnitType[] {
  return [
    kind,
    ...ULTIMATE_REGISTRY.filter((u) => u.actsAs === kind).map((u) => u.type),
  ];
}

export const LOCKED_ULTIMATES: Partial<Record<UnitType, LockedUltimateDef>> =
  Object.fromEntries(
    ULTIMATE_REGISTRY.filter((u) => u.locked !== null).map((u) => [
      u.type,
      u.locked as LockedUltimateDef,
    ]),
  ) as Partial<Record<UnitType, LockedUltimateDef>>;
export function isLockedUltimate(t: UnitType): boolean {
  return LOCKED_ULTIMATES[t] !== undefined;
}

// terron: РЕЕСТР особых свойств ультов (18.07) — вместо копипаст-if-ов в
// PlayerImpl. Новая пара «здание → активка» или лимит копий = одна строка тут.
//
// Активки, разблокируемые зданием-ультой: требуют живого здания И что оно —
// ТВОЙ выбор ульты (захваченное чужое здание активку не даёт — только пассивку).
// skipGateWhenBuildingDisabled (МИРВ): если здание-разблокировка выключено в
// лобби (ульты off), гейт снят — каст работает как в оригинале (только силос).
export const CAST_UNLOCKED_BY: Partial<
  Record<UnitType, { building: UnitType; skipGateWhenBuildingDisabled?: true }>
> = Object.fromEntries(
  ULTIMATE_REGISTRY.filter((u) => u.cast !== undefined).map((u) => [
    u.cast!.type,
    {
      building: u.type,
      // МИРВ — единственное исключение: если Ядерный завод выключен в лобби,
      // гейт снимается и МИРВ работает как в оригинале (только из шахты).
      ...(u.cast!.type === UnitType.MIRV
        ? { skipGateWhenBuildingDisabled: true as const }
        : {}),
    },
  ]),
) as Partial<
  Record<UnitType, { building: UnitType; skipGateWhenBuildingDisabled?: true }>
>;

// Сколько копий ульт-здания можно построить (default 1). Мин правды — 2, причём
// следующая копия разблокируется только когда предыдущая ДОСТРОЕНА (общий
// инвариант в PlayerImpl.canBuildUnitType).
/** Выводится из ULTIMATE_REGISTRY (поле maxCount; нет поля = 1). */
/**
 * terron 23.08: СЕКРЕТНЫЕ УЛЬТЫ — выводится из реестра (`secret: true`).
 *
 * Единственное место, обязанное знать о них «в лоб», — сетка выбора:
 * `buildUltimateGrid` вычитает их из пула, иначе секрет стоял бы в витрине.
 * Всё остальное (постройка, рендер, лимиты) работает как с обычной ультой.
 */
export const SECRET_ULTIMATES: readonly UnitType[] = ULTIMATE_REGISTRY.filter(
  (u) => u.secret === true,
).map((u) => u.type);

export function isSecretUltimate(t: UnitType): boolean {
  return SECRET_ULTIMATES.includes(t);
}

export const ULT_MAX_COUNT: Partial<Record<UnitType, number>> =
  Object.fromEntries(
    ULTIMATE_REGISTRY.filter((u) => u.maxCount !== undefined).map((u) => [
      u.type,
      u.maxCount as number,
    ]),
  ) as Partial<Record<UnitType, number>>;

// terron: ультимейты — суммарные метрики за матч (по игроку, для тултипа слота).
export type UltStats = {
  stolen: number; // войск ПОТЕРЯЛИ враги от министерств (сырое высосанное)
  stolenGained: number; // войск РЕАЛЬНО пришло владельцу (после конвертации)
  mirvLaunches: number; // ракет МИРВ запущено
  mirvTiles: number; // территорий уничтожено боеголовками МИРВ
  fortTiles: number; // территорий захвачено бункерами (Укрепления)
  splitTiles: number; // территорий откольнуто расколом (ушло боту)
  religionTiles: number; // территорий обращено ростом храма (Религия)
  religionTithe: number; // золота уплачено «десятиной» на храм (Религия)
  waterTiles: number; // земель затоплено ракетами «Реки вспять»
};

export const BuildMenus = unitTypeGroup([
  ...Structures.types,
  ...BuildableAttacks.types,
] as const);

/**
 * terron 23.08: что показываем в ПАНЕЛИ/МЕНЮ СТРОИТЕЛЬСТВА.
 *
 * ⚠️ Секретные постройки (new-units/CUBE.md) в списки не попадают НИКОГДА — ни
 * до кода, ни после (репорт владельца «какого хуя у меня круг в списке
 * построек появился»). Код не «разблокирует кнопку», он разово армит гост:
 * постройка так и остаётся тем, о чём нельзя узнать из интерфейса.
 * Строить их можно (они в `PlayerBuildable`), показывать — нет.
 */
export const VISIBLE_BUILD_TYPES = BuildMenus.types.filter(
  (t) => !isSecretUltimate(t),
) as readonly PlayerBuildableUnitType[];

export const PlayerBuildable = unitTypeGroup([
  ...BuildMenus.types,
  UnitType.TransportShip,
] as const);

export type PlayerBuildableUnitType = (typeof PlayerBuildable.types)[number];

export interface OwnerComp {
  owner: Player;
}

export type TrajectoryTile = {
  tile: TileRef;
  targetable: boolean;
};
export interface UnitParamsMap {
  [UnitType.TransportShip]: {
    troops?: number;
    targetTile?: TileRef;
  };

  [UnitType.Warship]: {
    patrolTile: TileRef;
  };

  [UnitType.Shell]: Record<string, never>;

  [UnitType.SAMMissile]: Record<string, never>;

  [UnitType.Port]: Record<string, never>;

  [UnitType.AtomBomb]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.HydrogenBomb]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.TradeShip]: {
    targetUnit: Unit;
    lastSetSafeFromPirates?: number;
  };

  [UnitType.Train]: {
    trainType: TrainType;
    targetUnit?: Unit;
    loaded?: boolean;
  };

  [UnitType.Factory]: Record<string, never>;

  [UnitType.MissileSilo]: Record<string, never>;

  [UnitType.DefensePost]: Record<string, never>;

  [UnitType.SAMLauncher]: Record<string, never>;

  [UnitType.City]: Record<string, never>;

  [UnitType.Airport]: Record<string, never>; // terron: авиация

  [UnitType.MinistryOfTruth]: Record<string, never>; // terron: ультимейты

  // terron: ультимейты — здания-штабы (одно на игрока)
  [UnitType.Fortifications]: Record<string, never>;
  [UnitType.CentralBank]: Record<string, never>;
  [UnitType.AirCommand]: Record<string, never>;
  [UnitType.TankFactory]: Record<string, never>;
  [UnitType.Religion]: Record<string, never>; // terron: ультимейты
  [UnitType.Mining]: Record<string, never>; // terron: ультимейты
  [UnitType.Revanchism]: Record<string, never>; // terron: ультимейты — пассив
  [UnitType.OurSky]: Record<string, never>; // terron: ультимейты — антиспутник
  // terron: «Сбить спутники» — ракета-каст Неба (носитель без параметров)
  [UnitType.SatelliteStrike]: Record<string, never>;

  // terron: авиация — самолёт-транзит между аэропортами
  [UnitType.Airplane]: {
    targetUnit?: Unit;
  };

  // terron: авиация — воздушный десант (высадка войск в точку)
  [UnitType.AirborneAssault]: {
    troops?: number;
    targetTile?: TileRef;
  };

  // terron: авиация — дрон-камикадзе (летит в точку, взрывается)
  [UnitType.SuicideDrone]: {
    targetTile?: TileRef;
  };

  [UnitType.MIRV]: {
    targetTile?: number;
  };

  // terron: ультимейты — Раскол (атака, юнит не строится; params на всякий случай)
  [UnitType.Split]: {
    targetTile?: number;
    troops?: number;
  };

  // terron: ультимейты — МЕДИА (здание-штаб, без параметров)
  [UnitType.Media]: Record<string, never>;
  [UnitType.NuclearFactory]: Record<string, never>; // terron: ультимейты — разблок МИРВ
  // terron: ультимейты — «Реки вспять»: штаб без параметров + ракета с целью.
  [UnitType.RiversBack]: Record<string, never>;
  [UnitType.OilRig]: Record<string, never>; // terron: нефтяная вышка
  [UnitType.SubmarineBase]: Record<string, never>; // terron: ультимейты — подлодки
  [UnitType.ClosedCountry]: Record<string, never>; // terron: ультимейты — закрытая страна
  [UnitType.Piracy]: Record<string, never>; // terron: ультимейты — пиратство
  [UnitType.Blockade]: { targetTile?: number }; // terron: каст Пиратства
  [UnitType.Pride]: Record<string, never>; // terron: ультимейты — гордость
  [UnitType.Truce]: Record<string, never>; // terron: каст Стадиона
  [UnitType.Olympics]: Record<string, never>; // terron: ультимейты — стадион
  [UnitType.Fanaticism]: Record<string, never>; // terron: ультимейты — фанатизм
  [UnitType.Terror]: { targetTile?: number; troops?: number }; // terron: каст Фанатизма
  [UnitType.VictoryBanner]: Record<string, never>; // terron: ультимейты — знамя победы
  [UnitType.PeacePalace]: Record<string, never>; // terron: ультимейты — дворец наций
  [UnitType.Pact]: { targetTile?: number }; // terron: каст Дворца наций
  [UnitType.Respite]: { troops?: number }; // terron: каст Гордости
  [UnitType.Greens]: Record<string, never>; // terron: ультимейты — зелёные
  [UnitType.Catastrophe]: { targetTile?: number }; // terron: каст Зелёных
  [UnitType.NuclearPlant]: Record<string, never>; // terron: ультимейты — АЭС
  [UnitType.Recultivation]: { targetTile?: number }; // terron: каст АЭС
  [UnitType.Fuel]: Record<string, never>; // terron: ультимейты — топливо
  [UnitType.IndustrialRevolution]: { targetTile?: number }; // terron: каст Топлива
  [UnitType.RailGun]: Record<string, never>; // terron: ультимейты — Дора
  [UnitType.RailGunShell]: { targetTile?: number }; // terron: каст Доры
  [UnitType.Spaceport]: Record<string, never>; // terron: ультимейты — космодром
  [UnitType.SecretTreasure]: Record<string, never>; // terron: секретный круг
  [UnitType.PeacefulSky]: Record<string, never>; // terron: ультимейты — мирное небо
  [UnitType.TrainDepot]: Record<string, never>; // terron: взрывные поезда (депо)
  [UnitType.DoomTrain]: { targetTile?: number }; // terron: каст — состав смерти
  [UnitType.WalkingCity]: Record<string, never>; // terron: шагающий город (штаб)
  [UnitType.CityTransfer]: { targetTile?: number; troops?: number }; // terron: каст — перенос
  // terron: ЗЕЛЁНЫЕ — гражданский борт: летит к воронке, по прилёту вешает
  // штраф на пустившего. Носим и цель (воронка), и виновника, и вес в
  // ступенях — иначе к моменту прилёта уже не восстановить, чья была ракета.
  [UnitType.GreenInspection]: {
    targetTile?: TileRef;
    culpritSmallID?: number;
    steps?: number;
  };
  [UnitType.WaterNuke]: {
    targetTile?: number;
  };

  [UnitType.MIRVWarhead]: {
    targetTile?: number;
  };
}

// Type helper to get params type for a specific unit type
export type UnitParams<T extends UnitType> = UnitParamsMap[T];

export type AllUnitParams = UnitParamsMap[keyof UnitParamsMap];

export enum Relation {
  Hostile = 0,
  Distrustful = 1,
  Neutral = 2,
  Friendly = 3,
}

export class Nation {
  constructor(
    public readonly spawnCell: Cell | undefined,
    public readonly playerInfo: PlayerInfo,
  ) {}
}

export class Cell {
  public index: number;

  private strRepr: string;

  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {
    this.strRepr = `Cell[${this.x},${this.y}]`;
  }

  pos(): MapPos {
    return {
      x: this.x,
      y: this.y,
    };
  }

  toString(): string {
    return this.strRepr;
  }
}

export enum TerrainType {
  Plains,
  Highland,
  Mountain,
  Lake,
  Ocean,
}

export enum PlayerType {
  Bot = "BOT",
  Human = "HUMAN",
  Nation = "NATION",
}

export interface Execution {
  isActive(): boolean;
  activeDuringSpawnPhase(): boolean;
  init(mg: Game, ticks: number): void;
  tick(ticks: number): void;
}

export interface Attack {
  id(): string;
  retreating(): boolean;
  retreated(): boolean;
  orderRetreat(): void;
  executeRetreat(): void;
  target(): Player | TerraNullius;
  attacker(): Player;
  troops(): number;
  setTroops(troops: number): void;
  isActive(): boolean;
  delete(): void;
  // The tile the attack originated from, mostly used for boat attacks.
  sourceTile(): TileRef | null;
  addBorderTile(tile: TileRef): void;
  removeBorderTile(tile: TileRef): void;
  clearBorder(): void;
  borderSize(): number;
  clusteredPositions(): TileRef[];
}

export interface AllianceRequest {
  accept(): void;
  reject(): void;
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
  status(): "pending" | "accepted" | "rejected";
}

export interface Alliance {
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
  expiresAt(): Tick;
  other(player: Player): Player;
}

export interface MutableAlliance extends Alliance {
  expire(): void;
  // terron: задать кастомную длительность (Раскол — короткий 60с/120с союз с сепаратистом).
  setExpiresAt(tick: Tick): void;
  other(player: Player): Player;
  bothAgreedToExtend(): boolean;
  addExtensionRequest(player: Player): void;
  id(): number;
  extend(): void;
  onlyOneAgreedToExtend(): boolean;

  agreedToExtend(player: Player): boolean;
}

export class PlayerInfo {
  public readonly displayName: string;

  constructor(
    public readonly name: string,
    public readonly playerType: PlayerType,
    // null if tribe.
    public readonly clientID: ClientID | null,
    // TODO: make player id the small id
    public readonly id: PlayerID,
    public readonly isLobbyCreator: boolean = false,
    public readonly clanTag: string | null = null,
    public readonly friends: ClientID[] = [],
    // terron (TZ-skin-capitals.md): имя столицы «государства»-скина. Приходит из
    // GameStartInfo (косметика customSkin, провалидирована реле) — вход
    // детерминирован, как name. null = имя из генератора (pickCapitalName).
    public readonly capitalName: string | null = null,
  ) {
    this.displayName = formatPlayerDisplayName(this.name, this.clanTag);
  }
}

export function isUnit(unit: unknown): unit is Unit {
  return (
    unit &&
    typeof unit === "object" &&
    "isUnit" in unit &&
    typeof unit.isUnit === "function" &&
    unit.isUnit()
  );
}

export interface Unit {
  /** terron: ПОДЛОДКИ — корабль-подлодка, ещё не стрелявший (враг его не видит
   *  и не берёт в цель). false у всего, что не корабль владельца штаба. */
  isStealthed(): boolean;
  /** terron: ПОДЛОДКИ — засветиться навсегда (вызывается при выстреле). */
  revealSub(): void;
  /** terron: ПОДЛОДКИ — подлодка ли это вообще (для спрайта; засвеченная тоже). */
  isSubmarine(): boolean;
  isUnit(): this is Unit;

  // Common properties.
  id(): number;
  type(): UnitType;
  owner(): Player;
  info(): UnitInfo;
  isMarkedForDeletion(): boolean;
  markForDeletion(): void;
  isOverdueDeletion(): boolean;
  delete(displayMessage?: boolean, destroyer?: Player): void;
  tile(): TileRef;
  lastTile(): TileRef;
  move(tile: TileRef): void;
  isActive(): boolean;
  setOwner(owner: Player): void;
  touch(): void;
  hash(): number;
  toUpdate(): UnitUpdate;
  hasTrainStation(): boolean;
  setTrainStation(trainStation: boolean): void;
  wasDestroyedByEnemy(): boolean;
  destroyer(): Player | undefined;

  // terron: ультимейты — Мин правды: счётчики шпиля для ховер-тултипа.
  // stolenTroops = сколько ПОТЕРЯЛИ враги (сырое), gainedTroops = сколько
  // РЕАЛЬНО пришло владельцу (после конвертации).
  stolenTroops(): number;
  gainedTroops(): number;
  addMinistryDrain(stolenRaw: number, gained: number): void;

  // Train
  trainType(): TrainType | undefined;
  isLoaded(): boolean | undefined;
  setLoaded(loaded: boolean): void;

  // Targeting

  // terron: ЗЕЛЁНЫЕ — груз борта-инспекции: кого штрафовать и на сколько
  // ступеней. GREEN.md
  culpritSmallID(): number;
  catastropheSteps(): number;
  setTargetTile(cell: TileRef | undefined): void;
  targetTile(): TileRef | undefined;
  setTrajectoryIndex(i: number): void;
  trajectoryIndex(): number;
  trajectory(): TrajectoryTile[];
  setTargetUnit(unit: Unit | undefined): void;
  targetUnit(): Unit | undefined;
  setTargetedBySAM(targeted: boolean): void;
  targetedBySAM(): boolean;
  setReachedTarget(): void;
  reachedTarget(): boolean;
  isTargetable(): boolean;
  setTargetable(targetable: boolean): void;

  // Health
  hasHealth(): boolean;
  // terron: потолок здоровья С УЧЁТОМ владельца (пиратская лодка — 200 против
  // 1000 у корабля). Для юнитов без здоровья — undefined.
  maxHealth(): number | undefined;
  // terron: ПИРАТСТВО — миссия «Блокада»: лодка плывёт к точке (anchored=false)
  // или стоит на якоре в зоне (anchored=true). null = обычная служба.
  blockadeMission(): { target: TileRef; anchored: boolean; drawn: boolean } | null;
  setBlockadeMission(
    m: { target: TileRef; anchored: boolean; drawn: boolean } | null,
  ): void;
  // terron: ПИРАТСТВО — десант стартовал из порта → «тихий» (без тревоги/следа).
  setStealthLaunch(v: boolean): void;
  // terron: ЗНАМЯ ПОБЕДЫ — кто ОСНОВАЛ эту столицу (null = не столица/неизвестно).
  capitalFounder(): Player | null;
  warshipState(): WarshipState;
  updateWarshipState(update: Partial<WarshipState>): void;
  transportShipState(): TransportShipState;
  updateTransportShipState(update: Partial<TransportShipState>): void;
  health(): number;
  modifyHealth(delta: number, attacker?: Player): void;

  // Troops
  setTroops(troops: number): void;
  troops(): number;

  // --- UNIT SPECIFIC ---

  // SAMs & Missile Silos
  launch(): void;
  reloadMissile(): void;
  isInCooldown(): boolean;
  missileTimerQueue(): number[];

  // Trade Ships
  setSafeFromPirates(): void; // Only for trade ships
  isSafeFromPirates(): boolean; // Only for trade ships

  // Construction phase on structures
  isUnderConstruction(): boolean;
  // terron: ДОРА — ВИДОВЫЕ поля (в hash не входят, сим их не читает):
  // куда орудие доедет по своим рельсам и через сколько тиков ударит по
  // текущей цели. Считает RailGunExecution, рисует клиент. new-units/DORA.md
  railReach(): readonly TileRef[];
  /** terron: ШАГАЮЩИЙ ГОРОД — остаток маршрута (видовое, сим не читает). */
  walkPath(): readonly TileRef[];
  setWalkPath(tiles: readonly TileRef[]): void;
  setRailReach(tiles: readonly TileRef[]): void;
  railEta(): number;
  setRailEta(ticks: number): void;
  // terron: тик последнего захвата ульт-здания (null = не захватывалось). Для
  // самоуничтожения захваченной чужой ульты. new-units/ULTIMATES.md
  capturedTick(): Tick | null;
  // terron: СТОЛИЦЫ — является ли этот City столицей владельца (золотой тинт +
  // доход). Ставится при постройке первого города. Спека: CAPITALS.md
  isCapital(): boolean;
  setCapital(isCapital: boolean): void;
  /** Какая по счёту столица игрока (1 — первая). 0 — никогда ею не была. */
  capitalGeneration(): number;
  setCapitalGeneration(gen: number): void;
  capitalName(): string | undefined;
  setCapitalName(name: string): void;
  setUnderConstruction(underConstruction: boolean): void;

  // Upgradable Structures
  level(): number;
  increaseLevel(): void;
  decreaseLevel(destroyer?: Player): void;
}

export interface TerraNullius {
  isPlayer(): false;
  id(): null;
  clientID(): ClientID;
  smallID(): number;
}

export interface Embargo {
  createdAt: Tick;
  isTemporary: boolean;
  target: Player;
}

export interface Player {
  // Basic Info
  smallID(): number;
  info(): PlayerInfo;
  name(): string;
  displayName(): string;
  clientID(): ClientID | null;
  id(): PlayerID;
  type(): PlayerType;
  isPlayer(): this is Player;
  toString(): string;
  isLobbyCreator(): boolean;

  // State & Properties
  isAlive(): boolean;
  isTraitor(): boolean;
  // terron: ДВОРЕЦ НАЦИЙ — длительность метки задаётся снаружи (предавший
  // владельца Дворца — 60с вместо 30). Без аргумента — config.traitorDuration().
  markTraitor(durationTicks?: number): void;

  // terron: ЗЕЛЁНЫЕ — штраф к доходу «Это катастрофа!». Одна шкала на пассив-
  // возмездие (детонация) и на каст-травлю, кап общий. new-units/GREEN.md
  catastropheStacks(): number;
  addCatastropheStacks(steps: number): void;
  catastropheGoldMult(): number;

  // terron: ТОПЛИВО — «Индустриальная революция»: ×3 скорость и −50% прироста
  // на время. Наводится и на себя, и на других. new-units/FUEL.md
  // terron: КОСМОДРОМ — накопленный за матч доход с рабочих. SPACE.md
  addIncomeAccrued(amount: Gold): void;
  incomeAccrued(): Gold;

  industrialActive(): boolean;
  startIndustrialRevolution(): void;
  markCatastrophe(target: Player): void;
  catastropheActive(): boolean;
  catastropheBlocked(target: Player): boolean;
  // terron: ДВОРЕЦ НАЦИЙ — учёт навязанных пактов (одна цель за раз, кулдаун
  // на повтор по той же цели после истечения).
  markPact(target: Player): void;
  pactActive(): boolean;
  pactBlocked(target: Player): boolean;
  // Тик навязанного пакта между нами (в любую сторону), иначе null.
  pactWith(other: Player): number | null;
  largestClusterBoundingBox: { min: Cell; max: Cell } | null;
  lastTileChange(): Tick;

  isDisconnected(): boolean;
  markDisconnected(isDisconnected: boolean): void;

  hasSpawned(): boolean;
  setSpawnTile(spawnTile: TileRef): void;
  spawnTile(): TileRef | undefined;

  // Territory
  tiles(): ReadonlySet<TileRef>;
  borderTiles(): ReadonlySet<TileRef>;
  numTilesOwned(): number;
  // terron: РЕВАНШИЗМ — исторический пик тайлов + баф защиты по потере земель.
  maxTilesOwned(): number;
  updateMaxTiles(): void;
  revanchismBuff(): number;
  conquer(tile: TileRef): void;
  relinquish(tile: TileRef): void;

  // terron: авиация — десантный плацдарм. Помеченный тайл защищает свой кластер от
  // авто-схлопывания окружением, пока метка не истекла И тайл ещё принадлежит игроку.
  addAirborneBeachhead(tile: TileRef, expiryTick: number): void;
  activeAirborneBeachheads(currentTick: number): ReadonlySet<TileRef>;
  clearAirborneBeachhead(tile: TileRef): void;

  // terron: ультимейты — Раскол. «Тихий» иммунитет тайла от авто-схлопывания
  // (как beachhead, но БЕЗ рисуемой цифры-таймера над тайлом). Нужен букве Т,
  // чтобы маленький анклав не схлопнулся в окно спасения, не засоряя карту «60».
  addSilentImmunity(tile: TileRef, expiryTick: number): void;
  clearSilentImmunity(tile: TileRef): void;
  // terron: ультимейты — Раскол. Маркер ОДНОЙ цифры-таймера спасения Т (или null):
  // центр перекрестья Т, ширина ножки (для размера шрифта), турн истечения.
  setSplitRescue(
    v: { x: number; y: number; w: number; expiry: number } | null,
  ): void;

  // terron: ультимейты — Раскол. Бот-сепаратист (отколотая «основа флага») навсегда
  // защищён от авто-схлопывания окружением: это уже отдельная страна, назад само
  // не срастается (только реальной атакой). Проверяется в PlayerExecution.removeClusters.
  markImmuneToCollapse(): void;
  isImmuneToCollapse(): boolean;
  /**
   * terron 28.08: до какого тика НЕ пересчитывать схлопывание анклавов.
   *
   * Ставит Раскол на ЖЕРТВУ на время «вспышки»: её территория в эти секунды
   * рвётся НАМЕРЕННО, и девять пересчётов посреди процесса — чистая трата.
   * Замер показал, что именно они, а не сам захват тайлов, роняют симуляцию.
   */
  clusterCalcPausedUntil(): Tick;
  pauseClusterCalcUntil(tick: Tick): void;

  // terron: ультимейты — зафиксированный выбор (null = ещё не использовал).
  // Фиксируется первым успешным использованием (buildUnit: постройка
  // ульт-здания или пуск МИРВ). new-units/ULTIMATES.md
  ultimateChoice(): UnitType | null;
  // true ТОЛЬКО при переходе null→выбор (повтор или конфликт = false).
  chooseUltimate(unitType: UnitType): boolean;
  // terron: СТОЛИЦЫ — столица игрока (первый построенный City) или null.
  // Обнуляется при захвате/сносе → следующий построенный город станет столицей.
  // Спека: CAPITALS.md
  capital(): Unit | null;
  setCapital(capital: Unit | null): void;
  /** terron: отметить основание столицы, вернуть её порядковый номер (1, 2, …). */
  foundCapital(): number;
  // Есть ли у игрока ЖИВОЕ достроенное ульт-здание данного типа (эффекты
  // банка/авиаштаба/танков работают только пока здание живо).
  hasUltimate(unitType: UnitType): boolean;
  // terron: ОЛИМПИЙСКИЕ ИГРЫ — отметка каста (кулдаун).
  markTruce(): void;
  // terron: ЗНАМЯ ПОБЕДЫ — держу ли под знаменем столицу, основанную victim.
  holdsCapitalOf(victim: Player): boolean;
  // terron: ЗНАМЯ ПОБЕДЫ — моя столица под чужим знаменем (новую основать нельзя).
  capitalUnderBanner(): boolean;

  /** terron: РЕВАНШИЗМ — `other` напал на меня первым (я его не трогал). */
  wasAttackedFirstBy(other: Player): boolean;
  /** terron: кто напал на меня первым (smallID) — ховер статуи + статистика. */
  aggressors(): number[];
  /** terron: на кого первым напал я (smallID) — для статистики агрессивности. */
  firstStrikes(): number[];
  // Сколько таких ЖИВЫХ ДОСТРОЕННЫХ ульт-зданий во владении (свои + захваченные).
  // Религия: N для квоты роста (2+N) и для десятины (×0.9^N) — одно число.
  ultimateCount(unitType: UnitType): number;
  // Суммарные метрики ульт за матч (тултип слота): переманено войск
  // министерствами / ракет МИРВ / территорий уничтожено МИРВ / захвачено бункерами.
  ultStats(): UltStats;
  addUltStat(key: keyof UltStats, n: number): void;

  // Resources & Troops
  gold(): Gold;
  addGold(toAdd: Gold, tile?: TileRef): void;
  removeGold(toRemove: Gold): Gold;
  troops(): number;
  setTroops(troops: number): void;
  addTroops(troops: number): void;
  removeTroops(troops: number): number;

  // Units
  units(...types: UnitType[]): Unit[];
  unitCount(type: UnitType): number;
  unitsConstructed(type: UnitType): number;
  unitsOwned(type: UnitType): number;
  buildableUnits(
    tile: TileRef | null,
    units?: readonly PlayerBuildableUnitType[],
  ): BuildableUnit[];
  canBuild(
    type: UnitType,
    targetTile: TileRef,
    validTiles?: TileRef[] | null,
  ): TileRef | false;
  buildUnit<T extends UnitType>(
    type: T,
    spawnTile: TileRef,
    params: UnitParams<T>,
  ): Unit;

  // Returns the existing unit that can be upgraded,
  // or false if it cannot be upgraded.
  // New units of the same type can upgrade existing units.
  // e.g. if a place a new city here, can it upgrade an existing city?
  findUnitToUpgrade(type: UnitType, targetTile: TileRef): Unit | false;
  canUpgradeUnit(unit: Unit): boolean;
  upgradeUnit(unit: Unit): void;
  captureUnit(unit: Unit): void;

  // Relations & Diplomacy
  nearby(): (Player | TerraNullius)[];
  sharesBorderWith(other: Player | TerraNullius): boolean;
  relation(other: Player): Relation;
  allRelationsSorted(): { player: Player; relation: Relation }[];
  updateRelation(other: Player, delta: number): void;
  decayRelations(): void;
  isOnSameTeam(other: Player): boolean;
  // Either allied or on same team.
  isFriendly(other: Player, treatAFKFriendly?: boolean): boolean;
  team(): Team | null;
  incomingAllianceRequests(): AllianceRequest[];
  outgoingAllianceRequests(): AllianceRequest[];
  alliances(): MutableAlliance[];
  expiredAlliances(): Alliance[];
  allies(): Player[];
  isAlliedWith(other: Player): boolean;
  allianceWith(other: Player): MutableAlliance | null;
  allianceInfo(other: Player): AllianceInfo | null;
  canSendAllianceRequest(other: Player): boolean;
  breakAlliance(alliance: Alliance): void;
  removeAllAlliances(): void;
  createAllianceRequest(recipient: Player): AllianceRequest | null;
  betrayals(): number;

  // Targeting
  canTarget(other: Player): boolean;
  target(other: Player): void;
  targets(): Player[];
  transitiveTargets(): Player[];

  // Communication
  canSendEmoji(recipient: Player | typeof AllPlayers): boolean;
  outgoingEmojis(): EmojiMessage[];
  sendEmoji(recipient: Player | typeof AllPlayers, emoji: string): void;
  canSendQuickChat(recipient: Player): boolean;
  recordQuickChat(recipient: Player): void;

  // Donation
  canDonateGold(recipient: Player): boolean;
  canDonateTroops(recipient: Player): boolean;
  donateTroops(recipient: Player, troops: number): boolean;
  donateGold(recipient: Player, gold: Gold): boolean;
  canDeleteUnit(): boolean;
  recordDeleteUnit(): void;
  canEmbargoAll(): boolean;
  recordEmbargoAll(): void;

  // Embargo
  hasEmbargoAgainst(other: Player): boolean;
  tradingPartners(): Player[];
  addEmbargo(other: Player, isTemporary: boolean): void;
  getEmbargoes(): Embargo[];
  stopEmbargo(other: Player): void;
  endTemporaryEmbargo(other: Player): void;
  canTrade(other: Player): boolean;

  // Attacking.
  canAttack(tile: TileRef): boolean;
  canAttackPlayer(player: Player, treatAFKFriendly?: boolean): boolean;
  isImmune(): boolean;

  createAttack(
    target: Player | TerraNullius,
    troops: number,
    sourceTile: TileRef | null,
    border: Set<number>,
  ): Attack;
  outgoingAttacks(): Attack[];
  incomingAttacks(): Attack[];
  orderRetreat(attackID: string): void;
  executeRetreat(attackID: string): void;

  // Misc
  toUpdate(): PlayerUpdate | null;
  playerProfile(): PlayerProfile;
  // WARNING: this operation is expensive.
  bestTransportShipSpawn(tile: TileRef): TileRef | false;
}

// terron: «Небо наше» — активный блэкаут спутников (детерминированное состояние
// ядра). Окно слепоты — [blastTick, endTick). Спека: new-units/NEBO.md
export interface SatelliteBlackout {
  ownerSmallID: number;
  blastTick: Tick;
  endTick: Tick;
}

export interface Game extends GameMap {
  // Map & Dimensions
  isOnMap(cell: Cell): boolean;
  width(): number;
  height(): number;
  map(): GameMap;
  miniMap(): GameMap;
  forEachTile(fn: (tile: TileRef) => void): void;
  // Zero-allocation neighbor iteration (cardinal only) to avoid creating arrays
  forEachNeighbor(tile: TileRef, callback: (neighbor: TileRef) => void): void;
  // Zero-allocation neighbor iteration for performance-critical cluster calculation
  // Alternative to neighborsWithDiag() that returns arrays
  // Avoids creating intermediate arrays and uses a callback for better performance
  forEachNeighborWithDiag(
    tile: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void;

  // Player Management
  player(id: PlayerID): Player;
  players(): Player[];
  allPlayers(): Player[];
  playerByClientID(id: ClientID): Player | null;
  playerBySmallID(id: number): Player | TerraNullius;
  hasPlayer(id: PlayerID): boolean;
  addPlayer(playerInfo: PlayerInfo): Player;
  terraNullius(): TerraNullius;
  owner(ref: TileRef): Player | TerraNullius;

  teams(): Team[];
  teamSpawnArea(team: Team): SpawnArea | undefined;

  // Alliances
  expireAlliance(alliance: Alliance): void;

  // Immunity timer
  isSpawnImmunityActive(): boolean;
  isNationSpawnImmunityActive(): boolean;
  elapsedGameSeconds(): number;

  // Game State
  ticks(): Tick;
  inSpawnPhase(): boolean;
  endSpawnPhase(): void;
  // terron: «Небо наше» — детерминированное состояние блэкаута спутников в ядре
  // (нужно ботам: слепнут, пока действует; владелец и его команда щадятся).
  // new-units/NEBO.md
  setSatelliteBlackout(b: SatelliteBlackout | null): void;
  // terron: ПИРАТСТВО — зоны блокады «флаг» (каст «Блокада»). Чужие корабли
  // обходят зону маршрутом (WaterPathFinder строит путь по карте, где флаг —
  // суша), свои и союзные владельцу — ходят. Версия растёт на каждое изменение
  // набора/размера зон (кэш водных цепочек).
  nextBlockadeId(): number;
  addBlockade(b: Blockade): void;
  updateBlockade(
    id: number,
    ships: number,
    expiresAt: number,
    pending?: boolean,
  ): void;
  removeBlockade(id: number): void;
  blockades(): readonly Blockade[];
  blockadeVersion(): number;
  isBlockadedFor(tile: TileRef, player: Player): boolean;
  /** Флаг зоны (любой владелец, не дружественный игроку) накрывает тайл мини-карты? */
  blockadedMiniTilesFor(player: Player): Set<TileRef>;
  // id зон блокады, закрытых для игрока (ключ кэша путей — дешевле набора тайлов).
  blockadeIdsFor(player: Player): number[];
  // terron: ГОРДОСТЬ — k = 1 − территория/территория лидера (0 у лидера → 1).
  prideFactor(player: Player): number;
  // terron: ОЛИМПИЙСКИЕ ИГРЫ — всемирное перемирие (все всем друзья): до какого тика.
  declareTruce(owner: Player, untilTick: number): void;
  truceActive(): boolean;
  truceUntil(): number;
  // terron: ГОРДОСТЬ — «Передышка»: мир вокруг игрока до тика.
  declareRespite(player: Player, untilTick: number): void;
  respiteActive(player: Player): boolean;
  satelliteBlackout(): SatelliteBlackout | null;
  /** Активен ли блэкаут прямо сейчас (тик в окне [blastTick, endTick)). */
  satelliteBlackoutActive(): boolean;
  /** Слепит ли активный блэкаут этого игрока (владелец/его команда — нет). */
  satelliteBlackoutBlinds(player: Player): boolean;
  executeNextTick(): GameUpdates;
  drainPackedTileUpdates(): Uint32Array;
  // terron: скины пепла — пары [tileRef, smallID бомбившего] за тик (null =
  // взрывов не было). Видовые данные, в hash не входят.
  drainPackedFalloutOwners(): Uint32Array | null;
  recordMotionPlan(record: MotionPlanRecord): void;
  drainPackedMotionPlans(): Uint32Array | null;
  setWinner(winner: Player | Team, allPlayersStats: AllPlayersStats): void;
  getWinner(): Player | Team | null;
  config(): Config;
  isPaused(): boolean;
  setPaused(paused: boolean): void;

  // Units
  unit(id: number): Unit | undefined;
  units(...types: UnitType[]): Unit[];
  unitCount(type: UnitType): number;
  unitInfo(type: UnitType): UnitInfo;
  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: Unit) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
    includeUnderConstruction?: boolean,
  ): Array<{ unit: Unit; distSquared: number }>;

  addExecution(...exec: Execution[]): void;
  displayMessage(
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
    goldAmount?: bigint,
    params?: Record<string, string | number>,
    unitID?: number,
    focusPlayerID?: PlayerID,
  ): void;
  displayIncomingUnit(
    unitID: number,
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
  ): void;

  displayChat(
    message: string,
    category: string,
    target: PlayerID | undefined,
    playerID: PlayerID | null,
    isFrom: boolean,
    recipient: string,
  ): void;

  // Nations
  nations(): Nation[];

  numTilesWithFallout(): number;
  stats(): Stats;

  addUpdate(update: GameUpdate): void;
  railNetwork(): RailNetwork;
  conquerPlayer(conqueror: Player, conquered: Player): void;
  miniWaterHPA(): PathFinder<number> | null;
  miniWaterGraph(): AbstractGraph | null;
  getWaterComponent(tile: TileRef): number | null;
  hasWaterComponent(tile: TileRef, component: number): boolean;
  /**
   * Returns the set of water components that `player` shares with at least one
   * valid trade partner (cached). Used by nation AI for port-placement
   * heuristics. `null` means no usable water body for ports.
   */
  sharedWaterComponents(player: Player): Set<number> | null;
  /** Incremented each time the water navigation graph is rebuilt (e.g. after nuke terrain change). */
  waterGraphVersion(): number;

  /** Queue a land tile for conversion to water (batched every few ticks). Tile must be unowned. */
  // terron: force=true — ракета «Реки вспять»: топим независимо от флага лобби.
  // falloutOwner — smallID бомбившего для скинов пепла (только отрисовка).
  queueWaterConversion(
    tile: TileRef,
    force?: boolean,
    falloutOwner?: number,
    // terron: чья была земля до взрыва (smallID) — нужно Зелёным (озеленение)
    // и АЭС (кому выставлять счёт за уборку). GREEN.md
    prevOwner?: number,
  ): void;

  /**
   * terron: чья земля была под этим тайлом пепла (0 — ничья/неизвестно).
   * Пепел в движке лежит ТОЛЬКО на ничейной земле, поэтому «свой пепел»
   * определяется этой записью, а не владельцем тайла. GREEN.md
   */
  /**
   * terron: ЗЕЛЁНЫЕ — поднять борт-инспекцию за успешную детонацию (штраф
   * ставится по прилёту). Зовётся из NukeExecution. GREEN.md
   */
  reportNukeDetonation(culprit: Player, tile: TileRef, type: UnitType): void;

  falloutPrevOwner(tile: TileRef): number;

  /**
   * terron: снять пепел с тайла (озеленение Зелёных / рекультивация АЭС).
   * Возвращает прежнего владельца земли — вызывающий решает, кому платить.
   * Территорию не даёт: тайл остаётся ничейным. GREEN.md
   */
  clearFallout(tile: TileRef): number;
}

export interface PlayerActions {
  canAttack: boolean;
  buildableUnits: BuildableUnit[];
  canSendEmojiAllPlayers: boolean;
  canEmbargoAll?: boolean;
  interaction?: PlayerInteraction;
}

export interface BuildableUnit {
  canBuild: TileRef | false;
  // unit id of the existing unit that can be upgraded, or false if it cannot be upgraded.
  canUpgrade: number | false;
  type: PlayerBuildableUnitType;
  cost: Gold;
  overlappingRailroads: TileRef[];
  ghostRailPaths: TileRef[][];
}

export interface PlayerProfile {
  relations: Record<number, Relation>;
  alliances: number[];
}

export interface PlayerBorderTiles {
  borderTiles: ReadonlySet<TileRef>;
}

export interface AllianceInfo {
  expiresAt: Tick;
  inExtensionWindow: boolean;
  myPlayerAgreedToExtend: boolean;
  otherAgreedToExtend: boolean;
  canExtend: boolean;
}

export interface PlayerInteraction {
  sharedBorder: boolean;
  canSendEmoji: boolean;
  canSendAllianceRequest: boolean;
  canBreakAlliance: boolean;
  canTarget: boolean;
  canDonateGold: boolean;
  canDonateTroops: boolean;
  canEmbargo: boolean;
  allianceInfo?: AllianceInfo;
}

export interface EmojiMessage {
  message: string;
  senderID: number;
  recipientID: number | typeof AllPlayers;
  createdAt: Tick;
}

export enum MessageType {
  ATTACK_FAILED,
  ATTACK_CANCELLED,
  ATTACK_REQUEST,
  CONQUERED_PLAYER,
  MIRV_INBOUND,
  NUKE_INBOUND,
  NUKE_DETONATED,
  HYDROGEN_BOMB_INBOUND,
  NAVAL_INVASION_INBOUND,
  SAM_MISS,
  SAM_HIT,
  CAPTURED_ENEMY_UNIT,
  UNIT_CAPTURED_BY_ENEMY,
  UNIT_DESTROYED,
  ALLIANCE_ACCEPTED,
  ALLIANCE_REJECTED,
  ALLIANCE_REQUEST,
  ALLIANCE_BROKEN,
  ALLIANCE_EXPIRED,
  DONATION_SENT,
  DONATION_RECEIVED,
  CHAT,
  RENEW_ALLIANCE,
  // terron: авиация — отдельный тип для дрона-камикадзе (не «атомная»). Спека: airport.md
  SUICIDE_DRONE_INBOUND,
  // terron: ультимейты — Небо наше: глобальная тревога «спутники под угрозой»
  // (демонтаж пошёл) и «спутники сбиты». Спека: new-units/NEBO.md
  SATELLITES_THREATENED,
  SATELLITES_DOWN,
  // terron: ПИРАТСТВО — объявлена блокада / рейс торговой лодки сорван зоной.
  BLOCKADE,
  // terron: ГОРДОСТЬ — передышка (мир вокруг игрока) / ОЛИМПИАДА — всемирный мир.
  TRUCE,
  // terron: ФАНАТИЗМ — террор: у цели взорвано здание / террор объявлен.
  TERROR,
  // terron: ДВОРЕЦ НАЦИЙ — навязанный пакт о ненападении (публичное событие).
  PACT,
  // terron: ЗЕЛЁНЫЕ — объявление катастрофы (штраф к доходу). GREEN.md
  CATASTROPHE,
  // terron: АЭС — «Чернобыль» и «Рекультивация». NUCLEAR.md
  CHERNOBYL,
  RECULTIVATION,
  // terron: ТОПЛИВО — «Индустриальная революция». FUEL.md
  INDUSTRIAL_REVOLUTION,
  // terron: ДОРА — выстрел и «застряла на чужой земле». DORA.md
  RAILGUN,
  // terron: КОСМОДРОМ — запуск. SPACE.md
  SPACEPORT,
  // terron: ЦЕНТРОБАНК — выплата процента. new-units/ULTIMATES.md
  CENTRAL_BANK,
  // terron: ЗОЛОТОЙ МАТЧ — объявление в начале матча и строка о победителе
  // (клиентские строки ленты, симуляция их не порождает).
  GOLDEN_MATCH,
  // terron: ШАГАЮЩИЙ ГОРОД — перенос зданий (старт/прибытие/застряло). WALKING.md
  WALKING,
}

// Message categories used for filtering events in the EventsDisplay
export enum MessageCategory {
  ATTACK = "ATTACK",
  NUKE = "NUKE",
  ALLIANCE = "ALLIANCE",
  TRADE = "TRADE",
  CHAT = "CHAT",
}

// Ensures that all message types are included in a category
export const MESSAGE_TYPE_CATEGORIES: Record<MessageType, MessageCategory> = {
  [MessageType.ATTACK_FAILED]: MessageCategory.ATTACK,
  [MessageType.ATTACK_CANCELLED]: MessageCategory.ATTACK,
  [MessageType.ATTACK_REQUEST]: MessageCategory.ATTACK,
  [MessageType.CONQUERED_PLAYER]: MessageCategory.ATTACK,
  [MessageType.MIRV_INBOUND]: MessageCategory.NUKE,
  [MessageType.NUKE_INBOUND]: MessageCategory.NUKE,
  [MessageType.SUICIDE_DRONE_INBOUND]: MessageCategory.NUKE,
  [MessageType.NUKE_DETONATED]: MessageCategory.NUKE,
  [MessageType.HYDROGEN_BOMB_INBOUND]: MessageCategory.NUKE,
  [MessageType.NAVAL_INVASION_INBOUND]: MessageCategory.ATTACK,
  [MessageType.SAM_MISS]: MessageCategory.ATTACK,
  [MessageType.SAM_HIT]: MessageCategory.ATTACK,
  [MessageType.CAPTURED_ENEMY_UNIT]: MessageCategory.ATTACK,
  [MessageType.UNIT_CAPTURED_BY_ENEMY]: MessageCategory.ATTACK,
  [MessageType.UNIT_DESTROYED]: MessageCategory.ATTACK,
  [MessageType.ALLIANCE_ACCEPTED]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_REJECTED]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_REQUEST]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_BROKEN]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_EXPIRED]: MessageCategory.ALLIANCE,
  [MessageType.RENEW_ALLIANCE]: MessageCategory.ALLIANCE,
  [MessageType.DONATION_SENT]: MessageCategory.TRADE,
  [MessageType.DONATION_RECEIVED]: MessageCategory.TRADE,
  [MessageType.CHAT]: MessageCategory.CHAT,
  // terron: ультимейты — Небо наше (антиспутник) = уровень ядерной тревоги
  [MessageType.SATELLITES_THREATENED]: MessageCategory.NUKE,
  [MessageType.SATELLITES_DOWN]: MessageCategory.NUKE,
  [MessageType.BLOCKADE]: MessageCategory.ATTACK,
  [MessageType.TRUCE]: MessageCategory.ATTACK,
  [MessageType.TERROR]: MessageCategory.ATTACK,
  [MessageType.PACT]: MessageCategory.ALLIANCE,
  // terron: ЗЕЛЁНЫЕ — катастрофа бьёт по экономике, категория ATTACK.
  [MessageType.CATASTROPHE]: MessageCategory.ATTACK,
  [MessageType.CHERNOBYL]: MessageCategory.ATTACK,
  [MessageType.RECULTIVATION]: MessageCategory.ATTACK,
  [MessageType.INDUSTRIAL_REVOLUTION]: MessageCategory.ATTACK,
  [MessageType.RAILGUN]: MessageCategory.ATTACK,
  [MessageType.SPACEPORT]: MessageCategory.ATTACK,
  [MessageType.CENTRAL_BANK]: MessageCategory.ATTACK,
  // terron: золотой матч — объявление/победитель идут общим потоком (чат).
  [MessageType.GOLDEN_MATCH]: MessageCategory.CHAT,
  // terron: шагающий город — переносы зданий видит их владелец (личные строки).
  [MessageType.WALKING]: MessageCategory.ATTACK,
} as const;

/**
 * Get the category of a message type
 */
export function getMessageCategory(messageType: MessageType): MessageCategory {
  return MESSAGE_TYPE_CATEGORIES[messageType];
}

export interface NameViewData {
  x: number;
  y: number;
  size: number;
}

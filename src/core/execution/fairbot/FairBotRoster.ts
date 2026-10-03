// terron 23.09: ЧЕСТНЫЙ БОТ — ростер имён для лобби /fair (new-units/FAIRBOT.md).
//
// Решение владельца: имена — известные полководцы и правители, лучше античности,
// не последних лет (никаких Сталиных/Путиных), на скин — флаг или символика их
// державы, никакой запрещёнки. Поэтому флаги только исторические из нашего же
// набора resources/flags (не `restricted` в countries.json), скин — тот же флаг
// без рамки, вырезанный в resources/images/fairbots (scripts/gen-fairbot-skins.py).
//
// Имя в симуляции — АНГЛИЙСКОЕ (канон-ключ, как у наций из манифеста карты), на
// экране его переводит клиент (LocalizeNames). Так имя одинаково у всех клиентов
// и в реплее, а язык у каждого свой.
import { GAME_ID_REGEX } from "../../Schemas";

export interface FairBotPersona {
  /** Ключ в конфиге матча (GameConfig.fairBots). */
  key: string;
  /** Имя в симуляции (оно же английское имя на экране). */
  en: string;
  /** Русское имя на экране. */
  ru: string;
  /** Код флага в resources/flags (без .svg). */
  flag: string;
  /** Скин территории: путь картинки в resources. */
  skin: string;
  /** Пропорции картинки скина (ширина / высота). */
  skinAspect: number;
}

// Флаги 320×200 и 200×200 за вычетом рамки по 16 px с каждой стороны.
const WIDE = 288 / 168;
const SQUARE = 1;

function persona(
  key: string,
  en: string,
  ru: string,
  flag: string,
  aspect: number,
): FairBotPersona {
  return {
    key,
    en,
    ru,
    flag,
    skin: `/images/fairbots/${key}.png`,
    skinAspect: aspect,
  };
}

export const FAIR_BOT_ROSTER: readonly FairBotPersona[] = [
  persona(
    "alexander",
    "Alexander the Great",
    "Александр Македонский",
    "Macedonia",
    WIDE,
  ),
  persona("caesar", "Julius Caesar", "Юлий Цезарь", "SPQR", WIDE),
  persona("scipio", "Scipio Africanus", "Сципион Африканский", "SPQR", WIDE),
  persona("hannibal", "Hannibal Barca", "Ганнибал Барка", "Carthage", WIDE),
  persona("leonidas", "Leonidas", "Царь Леонид", "Sparta", SQUARE),
  persona(
    "cyrus",
    "Cyrus the Great",
    "Кир Великий",
    "Achaemenid Empire",
    SQUARE,
  ),
  persona(
    "darius",
    "Darius the Great",
    "Дарий Великий",
    "Achaemenid Empire",
    SQUARE,
  ),
  persona("pericles", "Pericles", "Перикл", "Athens", WIDE),
  persona("themistocles", "Themistocles", "Фемистокл", "Athens", WIDE),
  persona(
    "nebuchadnezzar",
    "Nebuchadnezzar",
    "Навуходоносор",
    "Babylonia",
    WIDE,
  ),
  persona("ashurbanipal", "Ashurbanipal", "Ашшурбанипал", "Assyria", WIDE),
  persona(
    "shapur",
    "Shapur the Great",
    "Шапур Великий",
    "Sassanid Empire",
    SQUARE,
  ),
  persona("belisarius", "Belisarius", "Велисарий", "Byzantine Empire", WIDE),
  persona("charlemagne", "Charlemagne", "Карл Великий", "1_Franks", WIDE),
  persona("genghis", "Genghis Khan", "Чингисхан", "Mongol Empire", WIDE),
];

/** Сколько честных ботов в лобби /fair (решение владельца 23.09). */
export const FAIR_BOTS_PER_MATCH = 5;

const BY_KEY = new Map(FAIR_BOT_ROSTER.map((p) => [p.key, p]));
const BY_EN = new Map(FAIR_BOT_ROSTER.map((p) => [p.en, p]));

export function fairBotByKey(key: string): FairBotPersona | undefined {
  return BY_KEY.get(key);
}

/** Персона по имени в симуляции (для перевода и косметики на клиенте). */
export function fairBotByName(name: string): FairBotPersona | undefined {
  return BY_EN.get(name);
}

/**
 * Id игрока-бота. Детерминирован (одинаков у всех клиентов и в реплее) и
 * проходит ID-схему интентов: люди шлют ботам заявки в союз и эмодзи по id.
 */
export function fairBotPlayerId(index: number): string {
  const id = `fairbt${String(index).padStart(2, "0")}`;
  if (!GAME_ID_REGEX.test(id)) throw new Error(`bad fair bot id ${id}`);
  return id;
}

/**
 * Выбор персон на матч (СЕРВЕР, при создании лобби; сим получает готовый список
 * в конфиге). Флаги не повторяются: два одинаковых флага на карте читались бы
 * как одна страна.
 */
export function pickFairBots(
  count: number,
  rand: () => number = Math.random,
): string[] {
  const pool = [...FAIR_BOT_ROSTER];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out: string[] = [];
  const flags = new Set<string>();
  for (const p of pool) {
    if (out.length >= count) break;
    if (flags.has(p.flag)) continue;
    flags.add(p.flag);
    out.push(p.key);
  }
  return out;
}

/**
 * ВЕРСИИ МОЗГА честного бота (решение владельца 23.09: «текущих сохрани как
 * версионность, мы не знаем, станет ли лучше»). Версия едет в конфиге матча
 * (GameConfig.fairBotVersion), поэтому реплей всегда играет тем мозгом, каким
 * играли. Старую версию не трогаем: её ветки и её порядок вызовов ГСЧ — это и
 * есть её реплеи. Что отличает версии — FairBotExecution и new-units/FAIRBOT.md.
 *  • v1 (22.09) — первая: мозг наций Hard + ульта/реакции.
 *  • v2 (23.09) — по разбору побед топ-игроков (см. FAIRBOT.md §v2).
 */
export type FairBotVersion = 1 | 2;
export const FAIR_BOT_VERSIONS: readonly FairBotVersion[] = [1, 2];
/** Какую версию сервер ставит в новые лобби /fair, если окружение не сказало. */
export const FAIR_BOT_LATEST_VERSION: FairBotVersion = 2;

/** Версия из конфига. Нет поля (матчи до версий) = v1. */
export function fairBotVersionOf(v: unknown): FairBotVersion {
  return v === 2 ? 2 : 1;
}

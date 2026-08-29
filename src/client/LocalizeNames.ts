// terron: локализация ИМЁН ИИ-игроков (племён/наций) на язык клиента.
//
// Имена генерятся на сервере детерминированно (для синка) из списков, которые
// лежат в ОБЩЕМ коде. Значит клиент знает все возможные части и может разобрать
// английское имя обратно и пересобрать на своём языке. Сервер/синк не трогаем —
// английское имя остаётся каноническим ключом, каждый видит свой язык.
//
// Стадия 1: ПЛЕМЕНА — `{этноним-префикс} {суффикс-тип}` (напр. «Comanche Republics»).
//   суффикс (67 шт.) переводится через i18n (tribe.suffix.*),
//   этноним-префикс (177 шт.) транслитерируется авто-функцией (для кириллицы),
//   порядок слов — через tribe.format ({suffix} {prefix} для ru/fr).
// Нации-шутки (Cow/Snail) и страны — пока проходят как есть (стадии 2–3).

import { SPLIT_NATION_PREFIXES } from "../core/execution/SplitNames";
import {
  TRIBE_NAME_PREFIXES,
  TRIBE_NAME_SUFFIXES,
} from "../core/execution/utils/TribeNames";
import { NATION_RU } from "./NationNamesRu";
import { TRIBE_PREFIX_RU } from "./TribeNamesRu";
import { getCurrentLang, translateText } from "./Utils";

const PREFIX_SET = new Set(TRIBE_NAME_PREFIXES);
const SUFFIX_SET = new Set(TRIBE_NAME_SUFFIXES);

// EN → кириллица. Это ТРАНСЛИТ (звучание), не перевод: Comanche → Команче.
const TRANSLIT_DIGRAPHS: [string, string][] = [
  ["shch", "щ"],
  ["sch", "ш"],
  ["sh", "ш"],
  ["ch", "ч"],
  ["ph", "ф"],
  ["th", "т"],
  ["kh", "х"],
  ["gh", "г"],
  ["zh", "ж"],
  ["ts", "ц"],
  ["ya", "я"],
  ["yu", "ю"],
  ["yo", "ё"],
  ["ye", "е"],
  ["ck", "к"],
  ["qu", "кв"],
  ["oo", "у"],
  ["ee", "и"],
];
const TRANSLIT_SINGLE: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х",
  i: "и", j: "дж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
  q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс",
  y: "й", z: "з",
};

function translitWord(tok: string): string {
  const low = tok.toLowerCase();
  let out = "";
  let i = 0;
  while (i < low.length) {
    let matched = false;
    for (const [d, r] of TRANSLIT_DIGRAPHS) {
      if (low.startsWith(d, i)) {
        out += r;
        i += d.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += TRANSLIT_SINGLE[low[i]] ?? low[i];
      i++;
    }
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function transliterate(name: string): string {
  // сохраняем разделители (пробел/дефис), каждое слово — с заглавной
  return name
    .split(/([ -])/)
    .map((t) => (t === " " || t === "-" ? t : translitWord(t)))
    .join("");
}

function tryTribe(raw: string): string | null {
  const sp = raw.indexOf(" ");
  if (sp < 0) return null;
  const prefix = raw.slice(0, sp); // этноним — всегда одно слово
  const suffix = raw.slice(sp + 1); // тип — может быть из 2 слов («Grand Duchy»)
  if (!PREFIX_SET.has(prefix) || !SUFFIX_SET.has(suffix)) return null;
  // terron 29.07: сначала СЛОВАРЬ этнонимов (родительный падеж мн.ч.) — иначе
  // автотранслит выдавал «Сестринство Егйптиан» / «Орда Бхутанесе». Транслит
  // остался фолбэком для слов, которых в словаре нет.
  const dict = getCurrentLang() === "ru" ? TRIBE_PREFIX_RU[prefix] : undefined;
  const p =
    dict ??
    (translateText("tribe.translit") === "1" ? transliterate(prefix) : prefix);
  const s = translateText("tribe.suffix." + suffix);
  return translateText("tribe.format", { prefix: p, suffix: s });
}

// terron: мемо имён. localizeAIName зовётся на КАЖДОЕ событие ленты (и не
// по разу), а внутри — Unicode-регэксп + разбор + словари; имена ИИ в матче
// неизменны. Ключ — сырое имя; результат зависит ещё от языка и словаря,
// поэтому кэш сбрасываем на смене/догрузке языка (событие `terron-lang-loaded`,
// шлёт LangSelector) и страхуемся ключом языка. Потолок размера — от разрастания
// (ники живых игроков тоже пролетают сюда и возвращаются как есть).
const NAME_MEMO_MAX = 4096;
const nameMemo = new Map<string, string>();
let nameMemoLang = "";
if (typeof window !== "undefined") {
  window.addEventListener("terron-lang-loaded", () => nameMemo.clear());
}

/** Локализовать имя ИИ-игрока на текущий язык. Неузнанное — возвращаем как есть. */
export function localizeAIName(raw: string): string {
  if (!raw) return raw;
  const lang = getCurrentLang();
  if (lang !== nameMemoLang) {
    nameMemo.clear();
    nameMemoLang = lang;
  }
  const hit = nameMemo.get(raw);
  if (hit !== undefined) return hit;
  const out = computeLocalizedAIName(raw);
  if (nameMemo.size >= NAME_MEMO_MAX) nameMemo.clear();
  nameMemo.set(raw, out);
  return out;
}

function computeLocalizedAIName(raw: string): string {
  // некоторые имена идут с префиксом-эмодзи «👤 » — снимаем и возвращаем
  const m = /^(\p{Emoji_Presentation}|👤)\s+/u.exec(raw);
  const head = m ? m[0] : "";
  const body = m ? raw.slice(m[0].length) : raw;

  const tribe = tryTribe(body);
  if (tribe) return head + tribe;
  // Стадия 2: НАЦИИ (страны/регионы/исторические державы). EN — канон-ключ из
  // manifest.json карты, RU — оверлей отображения. Ключа нет (фикшн-регион,
  // нация-шутка) → отдаём EN как есть: лучше английское имя, чем автотранслит.
  if (getCurrentLang() === "ru") {
    const nation = NATION_RU[body];
    if (nation) return head + nation;
  }
  return raw;
}

// terron: локализация имени нации-сепаратиста (ульта Раскол). Имя генерится в
// воркере как «{EN-префикс} {ник/племя жертвы}» (детерминизм). На клиенте: префикс
// → RU, а БАЗУ прогоняем через localizeAIName — иначе племя-жертва оставалось на
// английском («Свободная Hungarian Colony» вместо «Свободная Колония Хунгариан»).
// Ник живого игрока localizeAIName вернёт как есть. См. SplitNames.ts, SPLIT.md
let splitPrefixEnToRu: Map<string, string> | null = null;
export function localizeSeparatistName(name: string): string {
  if (!name || getCurrentLang() !== "ru") return name;
  const sp = name.indexOf(" ");
  if (sp <= 0) return name;
  splitPrefixEnToRu ??= new Map(SPLIT_NATION_PREFIXES.map((p) => [p.en, p.ru]));
  const ru = splitPrefixEnToRu.get(name.slice(0, sp));
  if (ru === undefined) return name; // не наш префикс — не трогаем
  return ru + " " + localizeAIName(name.slice(sp + 1));
}

// terron 19.09: ПЕРЕВОД ЗАШИТЫХ СТРОК `L(ru, en)` НА ЛЮБОЙ ЯЗЫК.
//
// ~2200 строк интерфейса (вся вики, рейтинги, магазин, лобби…) написаны прямо
// в коде литералом `L("по-русски", "in English")`, без ключа в lang/*.json.
// Для ru/en этого хватало, а вьетнамец, немец и итальянец видели английский —
// каждый новый язык «переведён», а половина экрана нет.
//
// Теперь ключ строки — ОТПЕЧАТОК её английского текста: `inline.x<fnv1a>`.
// Переводы лежат в том же файле языка, секция `inline`. Строки с подстановками
// (`L(\`Ждём ${n} с\`, \`Wait ${n}s\`)`) в рантайме уже склеены, поэтому для них
// сборщик (`scripts/inline-i18n.ts`) кладёт в `InlinePatterns.generated.ts`
// английский ШАБЛОН «Wait {0}s», а здесь строка сопоставляется с шаблоном и
// значения подставляются в перевод.
//
// ⚠️ Гейт `tests/InlineI18nCoverage.test.ts` требует, чтобы у каждого языка из
// FULL_LANGS были ВСЕ строки — и из en.json, и из кода. Добавил строку в `L()` —
// прогони `npx tsx scripts/inline-i18n.ts` и переведи то, что он выпишет.
import { INLINE_PATTERNS } from "./InlinePatterns.generated";

/** FNV-1a 32 по кодовым единицам UTF-16. Тот же код — в scripts/inline-i18n.ts. */
export function inlineKey(en: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < en.length; i++) {
    h ^= en.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "inline.x" + (h >>> 0).toString(16).padStart(8, "0");
}

type Compiled = { re: RegExp; key: string; specificity: number };
let compiled: Compiled[] | null = null;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Шаблон «Wait {0}s» → регулярка `^Wait ([\s\S]*?)s$` с порядком групп. */
export function compilePattern(p: string): { re: RegExp; order: number[] } {
  const order: number[] = [];
  const src = p
    .split(/(\{\d+\})/)
    .map((part) => {
      const m = /^\{(\d+)\}$/.exec(part);
      if (m) {
        order.push(Number(m[1]));
        return "([\\s\\S]*?)";
      }
      return escapeRe(part);
    })
    .join("");
  return { re: new RegExp("^" + src + "$"), order };
}

function patterns(): Compiled[] {
  if (compiled) return compiled;
  compiled = INLINE_PATTERNS.map((p) => ({
    re: compilePattern(p).re,
    key: inlineKey(p),
    // длиннее постоянная часть — точнее шаблон, проверяем его первым
    specificity: p.replace(/\{\d+\}/g, "").length,
  })).sort((a, b) => b.specificity - a.specificity);
  return compiled;
}

let cacheDict: Record<string, string> | null = null;
let cache = new Map<string, string | null>();

/**
 * Перевод английского текста строки `L()` по словарю языка (плоский, как у
 * LangSelector). null — перевода нет, вызывающий оставит английский.
 */
export function translateInline(
  en: string,
  dict: Record<string, string> | null | undefined,
): string | null {
  if (!dict) return null;
  if (dict !== cacheDict) {
    cacheDict = dict;
    cache = new Map();
  }
  const hit = cache.get(en);
  if (hit !== undefined) return hit;

  let out: string | null = dict[inlineKey(en)] ?? null;
  if (out === null) {
    for (const p of patterns()) {
      const tr = dict[p.key];
      if (tr === undefined) continue;
      const m = p.re.exec(en);
      if (!m) continue;
      out = tr.replace(/\{(\d+)\}/g, (_, i) => m[Number(i) + 1] ?? "");
      break;
    }
  }
  if (cache.size > 5000) cache.clear();
  cache.set(en, out);
  return out;
}

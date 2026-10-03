// terron 02.09: ДИАГНОСТИКА «ИНТЕРФЕЙС СЫРЫМИ КЛЮЧАМИ» С УСТРОЙСТВА ИГРОКА.
//
// Четыре скриншота владельца из приложения ВК подряд: FLAG_INPUT.SHORT, LOBBY.ENTER,
// footer.terms — при живой сети (зонды прошли, ready дошёл) и молчащем датчике
// lang_load_failed. То есть fetch словаря НЕ падал, а ключи всё равно сырые — и
// по коду это не объяснить, нужны факты с самого устройства. Через несколько
// секунд после старта смотрим, переведён ли интерфейс; если нет — собираем всё,
// что отличает гипотезы друг от друга: что в lang-selector (язык, размер
// словаря), откуда взялся язык, стоит ли режим площадки, и ЧЕМ отвечает прямой
// запрос словаря прямо сейчас. Одно событие на страницу.
import { assetUrl } from "../core/AssetUrls";
import { reportHealth } from "./Health";

declare const __BUILD_TIME__: string | undefined;

const PROBE_DELAY_MS = 7000;
const PROBE_FETCH_TIMEOUT_MS = 6000;

function rawKeysVisible(): boolean {
  const t = document.body?.innerText ?? "";
  return /\b(LOBBY\.ENTER|MAIN\.CREATE|FLAG_INPUT\.SHORT|footer\.terms)\b/.test(t);
}

async function probeFetch(url: string): Promise<Record<string, unknown>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort("timeout"), PROBE_FETCH_TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    const text = await r.text();
    let keys = -1;
    try {
      keys = Object.keys(JSON.parse(text)).length;
    } catch {
      /* не JSON — это и есть улика */
    }
    return {
      status: r.status,
      ok: r.ok,
      type: r.type,
      ct: r.headers.get("content-type"),
      bytes: text.length,
      keys,
      head: text.slice(0, 60),
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    return {
      err: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      ms: Math.round(performance.now() - t0),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function installLangStateProbe(): void {
  setTimeout(() => void probe(), PROBE_DELAY_MS);
}

async function probe(): Promise<void> {
  try {
    const ls = document.querySelector("lang-selector") as
      | (HTMLElement & {
          translations?: Record<string, string>;
          defaultTranslations?: Record<string, string>;
          currentLang?: string;
        })
      | null;
    const tCount = ls?.translations ? Object.keys(ls.translations).length : -1;
    const raw = rawKeysVisible();
    if (!raw && tCount > 0) return; // всё в порядке — молчим
    let lsUrl = "";
    try {
      lsUrl = assetUrl("lang/ru.json");
    } catch (e) {
      lsUrl = `assetUrl threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    const meta: Record<string, unknown> = {
      b: typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "?",
      raw,
      lsInDom: !!ls,
      lang: ls?.currentLang ?? null,
      tCount,
      dCount: ls?.defaultTranslations
        ? Object.keys(ls.defaultTranslations).length
        : -1,
      saved: (() => {
        try {
          return localStorage.getItem("lang");
        } catch {
          return "n/a";
        }
      })(),
      nav: navigator.language,
      gpEmbed: document.documentElement.classList.contains("gp-embed"),
      launch: (window as unknown as { __platformLaunch?: boolean })
        .__platformLaunch === true,
      gp: !!(window as unknown as { __gp?: unknown }).__gp,
      sw: !!navigator.serviceWorker?.controller,
      online: navigator.onLine,
      url: lsUrl,
      fetch: lsUrl.startsWith("http") || lsUrl.startsWith("/")
        ? await probeFetch(lsUrl)
        : null,
    };
    reportHealth(
      "lang_state",
      `raw=${+raw} lang=${meta.lang} t=${tCount} fetch=${
        (meta.fetch as Record<string, unknown> | null)?.status ??
        (meta.fetch as Record<string, unknown> | null)?.err ??
        "-"
      }`,
      meta,
    );
  } catch (e) {
    reportHealth("lang_state", `probe failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

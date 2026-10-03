// terron 25.08: КОНТЕКСТ СЕССИИ — сайт или каталог площадки.
//
// Решение владельца: «вк игра это вк игра, сайт игра это сайт игра». Сессии
// разведены на сервере ИМЕНЕМ КУКИ (platform-api/src/auth/cookies.ts), а какой
// контекст сейчас — знает только клиент, из `gp.platform.type`. Он и сообщает
// его заголовком `X-Terron-Platform` во всех запросах авторизации.
//
// ⚠️ ГЛАВНАЯ ЛОВУШКА — ГОНКА. SDK площадки поднимается ПОЗЖЕ первого кадра, а
// обновление сессии стартует сразу. Спросив контекст слишком рано, мы отправим
// запрос без заголовка, сервер отдаст САЙТОВУЮ сессию — и внутри ВК игрок снова
// окажется под аккаунтом сайта, ровно как до разделения. Поэтому ждём SDK, но с
// потолком: вне площадки промиса `__gpReady` не существует вовсе, и ожидание
// заканчивается мгновенно.
const HEADER = "X-Terron-Platform";
const CACHE_KEY = "terron_platform_ctx";
// ⚠️ ПОТОЛОК ОЖИДАНИЯ — РАЗНЫЙ, И ЭТО ГЛАВНАЯ ПРАВКА 09.09.
// Вне площадки ждать нечего (промиса SDK нет), а НА площадке промах стоит куда
// дороже ожидания: без заголовка сервер читает САЙТОВУЮ куку, отдаёт 401,
// клиент запоминает «гость» — и дальше идёт ПОЛНЫЙ круг входа (запрос nonce,
// запись в профиль площадки, её sync, проверка у нас) вместо мгновенного
// подъёма живой сессии. Ровно отсюда «с компа моментально, с телефона десять
// секунд»: на десктопе SDK успевает за 2.5 с, в WebView приложения — нет
// (первые секунды там сеть мертва, см. ImgRetry).
const WAIT_MS_PLATFORM = 12000;

let resolved: string | null = null;
let waiting: Promise<string | null> | null = null;

/** Мы внутри каталога площадки. Признак ставит index.html СИНХРОННО (класс
 *  `gp-embed` + `__platformLaunch`), ещё до загрузки SDK.
 *  Экспортируется, чтобы про класс знал ОДИН модуль: Auth спрашивает его, а не
 *  щупает DOM сам (сторож PlatformHostFacade держит это правило). */
export function isPlatformSurface(): boolean {
  try {
    return document.documentElement.classList.contains("gp-embed");
  } catch {
    return false;
  }
}

function readCache(): string | null {
  // ⚠️ ПЕРЕЖИВАЕТ ПЕРЕЗАПУСК. Раньше кэш жил в sessionStorage, то есть в
  // приложении площадки терялся на КАЖДОМ запуске — и каждый запуск снова ждал
  // SDK, снова промахивался мимо куки и снова платил полный круг входа.
  try {
    const v = localStorage.getItem(CACHE_KEY);
    if (v) return v;
  } catch {
    /* хранилище запрещено — спросим SDK */
  }
  try {
    return sessionStorage.getItem(CACHE_KEY) || null;
  } catch {
    return null;
  }
}

function writeCache(v: string): void {
  for (const store of [
    () => localStorage,
    () => sessionStorage,
  ] as (() => Storage)[]) {
    try {
      store().setItem(CACHE_KEY, v);
    } catch {
      /* приватный режим — переживём, спросим SDK заново */
    }
  }
}

/** Тип площадки, если он уже известен. Синхронно, без ожидания.
 *  ⚠️ КЭШ ЧИТАЕТСЯ ТОЛЬКО НА ПЛОЩАДКЕ. Иначе запомненный «VK» увёл бы сессию
 *  обычного terron.io в платформенную куку — ровно то разделение, ради которого
 *  всё и делалось. */
/**
 * terron 10.09: класс `gp-platform-<тип>` на <html> — правила темы прячут разделы
 * под КОНКРЕТНУЮ площадку (зал славы на Яндексе, требование 8.4.2), не дожидаясь
 * SDK: кэш площадки применяется синхронно на втором запуске. Один класс за раз.
 */
function applyPlatformClass(t: string): void {
  try {
    const cls = document.documentElement.classList;
    const want = "gp-platform-" + t.toLowerCase();
    if (cls.contains(want)) return;
    for (const c of Array.from(cls)) {
      if (c.startsWith("gp-platform-")) cls.remove(c);
    }
    cls.add(want);
  } catch {
    /* нет DOM (тесты/ssr) */
  }
}

export function platformContext(): string | null {
  if (!isPlatformSurface()) return null;
  const t = resolved ?? readCache();
  if (t) applyPlatformClass(t);
  return t;
}

/** Дождаться готовности SDK и вернуть тип площадки (или null — мы на сайте). */
export function platformContextReady(): Promise<string | null> {
  const known = platformContext();
  if (known !== null) return Promise.resolve(known);
  if (waiting) return waiting;
  const ready = (window as unknown as { __gpReady?: Promise<unknown> })
    .__gpReady;
  if (!ready) {
    // Сниппет SDK грузится только внутри iframe площадки: его нет — мы на сайте,
    // в приложении или на itch. Ждать нечего.
    waiting = Promise.resolve(null);
    return waiting;
  }
  waiting = Promise.race([
    ready.then((gp) => {
      const t = (gp as { platform?: { type?: unknown } } | undefined)?.platform
        ?.type;
      return typeof t === "string" ? t : null;
    }),
    new Promise<null>((r) =>
      window.setTimeout(() => r(null), WAIT_MS_PLATFORM),
    ),
  ])
    .then((t) => {
      setPlatformContext(t);
      return platformContext();
    })
    .catch(() => null);
  return waiting;
}

/** Запомнить площадку (зовёт GamePushSDK, как только узнал её сам). */
/** Забыть площадку: кэш, класс на <html>, значение в памяти. Только для
 *  тест-режима (`platform=none`) — на настоящей площадке звать незачем. */
export function clearPlatformContext(): void {
  resolved = null;
  for (const store of [
    () => localStorage,
    () => sessionStorage,
  ] as (() => Storage)[]) {
    try {
      store().removeItem(CACHE_KEY);
    } catch {
      /* хранилище запрещено */
    }
  }
  try {
    const cls = document.documentElement.classList;
    for (const c of Array.from(cls)) {
      if (c.startsWith("gp-platform-")) cls.remove(c);
    }
  } catch {
    /* нет DOM */
  }
}

export function setPlatformContext(type: unknown): void {
  if (typeof type !== "string") return;
  const t = type.trim().toUpperCase();
  // NONE — песочница GamePush: площадки под нами нет, это тот же сайт.
  if (!t || t === "NONE") return;
  const changed = resolved !== t;
  resolved = t;
  writeCache(t);
  applyPlatformClass(t);
  // Сессию могли спросить раньше, чем узнали площадку (SDK опоздал) — тот запрос
  // ушёл мимо нужной куки. Сообщаем, чтобы Auth переспросил (armContextRetry).
  if (changed) {
    try {
      window.dispatchEvent(new CustomEvent("terron-platform-ctx"));
    } catch {
      /* окна нет (тесты) */
    }
  }
}

// ── Тестовый режим площадки: `?embed=1&platform=<тип>` ──────────────────────
// terron 11.09 (просьба владельца: «спец ссылки для всех платформ, текущих и
// будущих, плюс переключатель — НО ТОЛЬКО В РЕЖИМЕ, НЕ В САМИХ ПЛОЩАДКАХ»).
// Режим = маркер `embed=1` БЕЗ настоящего запуска площадки: нет параметров
// запуска (`__platformLaunch`, ставит index.html) и мы верхний документ. Внутри
// настоящей площадки ни параметр, ни переключатель не действуют. Параметр
// читается на ИМПОРТЕ модуля — роутер чистит адресную строку.
function detectEmbedTest(): boolean {
  try {
    if (!/[?&]embed=1\b/.test(window.location.search)) return false;
    if ((window as unknown as { __platformLaunch?: boolean }).__platformLaunch)
      return false;
    if (window.self !== window.top) return false;
    return true;
  } catch {
    return false;
  }
}
const EMBED_TEST: boolean = detectEmbedTest();

/** Мы в тест-режиме площадки (`?embed=1` из обычного браузера). */
export function embedTestMode(): boolean {
  return EMBED_TEST;
}

function applyEmbedPlatformParam(): void {
  if (!EMBED_TEST) return;
  let m: RegExpExecArray | null = null;
  try {
    m = /[?&]platform=([A-Za-z0-9_]+)/.exec(window.location.search);
  } catch {
    return;
  }
  if (!m) return;
  const t = m[1].toUpperCase();
  if (t === "NONE") clearPlatformContext();
  else setPlatformContext(t);
}
applyEmbedPlatformParam();
if (EMBED_TEST) {
  void import("./EmbedPlatformSwitcher")
    .then((m) => m.mountEmbedPlatformSwitcher())
    .catch(() => {
      /* переключатель — удобство, не функция игры */
    });
}

/** Заголовок контекста для запросов авторизации. Вне площадки — пусто. */
export function platformAuthHeaders(): Record<string, string> {
  const t = platformContext();
  return t ? { [HEADER]: t } : {};
}

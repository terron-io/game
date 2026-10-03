// terron аналитика/метрики сайта. Две цели одновременно (см. задачу):
//   1) Yandex.Metrika-цели (reachGoal) — клики и воронка, разрез по источнику
//      Метрика делает нативно (utm/referrer). Счётчик уже подключён в index.html.
//   2) Наша серверная воронка по источникам (/traffic/event → /stats/traffic) —
//      «качество трафика»: зашло → нажали играть → сыграли → выиграли + глубина
//      (сколько матчей и сколько времени в матче в среднем с источника).
//
// Источник (from/utm/...) сворачиваем в ОДИН токен (юзеру «похер что from что utm»):
// utm_source || from || src || utm_medium || referrer-host || "direct". First-touch.
import { getApiBase } from "./Api";
import { getDeviceID } from "./Auth";

const YM_ID = 109773286; // = index.html
const SRC_KEY = "terron_src"; // first-touch источник трафика (localStorage)
const REF_KEY = "terron_ref_full"; // first-touch ПОЛНЫЙ реферер/лендинг (для трекинга аномалий)
const VISIT_KEY = "terron_visit_sent"; // раз за сессию вкладки (sessionStorage)
const PLAT_KEY = "terron_platform"; // sticky платформа (маркер апки виден только на входе)

declare global {
  interface Window {
    ym?: (...args: unknown[]) => void;
  }
}

/** Metrica-цель. No-op, если ym ещё не загрузился / вырезан блокировщиком. */
export function track(goal: string, params?: Record<string, unknown>): void {
  try {
    window.ym?.(YM_ID, "reachGoal", goal, params);
  } catch {
    /* ignore */
  }
}

function clean(s: string): string {
  const v = s
    .toLowerCase()
    .replace(/[^a-z0-9_.\-]/g, "")
    .slice(0, 40);
  return v || "direct";
}

function deriveSource(): string {
  try {
    const p = new URL(window.location.href).searchParams;
    const raw =
      p.get("utm_source") ||
      p.get("from") ||
      p.get("src") ||
      p.get("utm_medium");
    if (raw) return clean(raw);
    const ref = document.referrer;
    if (ref) {
      const h = new URL(ref).hostname.replace(/^www\./, "");
      if (h && h !== window.location.hostname) return clean(h);
    }
  } catch {
    /* ignore */
  }
  return "direct";
}

/** Захватить источник (first-touch) на входе — вызывать один раз в Main.init. */
export function captureTrafficSource(): void {
  // Платформу считаем ЗДЕСЬ же: маркер апки живёт в адресе только до первой
  // перерисовки роутера, а Main зовёт эту функцию первым делом.
  clientPlatform();
  try {
    if (!localStorage.getItem(SRC_KEY)) {
      localStorage.setItem(SRC_KEY, deriveSource());
      // ПОЛНЫЙ реферер (first-touch) для трекинга аномалий: точный URL страницы,
      // откуда пришли (source в статистике — только хост/токен). Пусто → лендинг
      // с query (?utm/?from и т.п.). Обрезаем до 500 символов.
      const full = document.referrer || window.location.href || "";
      localStorage.setItem(REF_KEY, full.slice(0, 500));
    }
  } catch {
    /* ignore */
  }
  // Площадку спрашиваем сразу: чем раньше уточним источник, тем меньше событий
  // уедет с общим gamepush-токеном.
  void awaitPlatformSource();
}

export function getTrafficSource(): string {
  try {
    return localStorage.getItem(SRC_KEY) || "direct";
  } catch {
    return "direct";
  }
}

// ---------------------------------------------------------------------------
// terron 24.08: ПЛОЩАДКА GAMEPUSH В ИСТОЧНИКЕ ТРАФИКА.
//
// Игра на Пикабу/Яндекс.Играх/VK Play живёт в ДВОЙНОМ iframe, и реферер у
// внутреннего кадра — всегда фрейм агрегатора, причём ТОЛЬКО origin: путь с
// `?_platform-key=pikabu` режет Referrer-Policy (проверено на боевых строках
// traffic_journey — там ровно "https://s3.gamepush.com/"). Поэтому ВСЕ площадки
// сваливались в одну строку витрины `s3.gamepush.com`, и вопрос «откуда игроки»
// ответа не имел.
//
// Настоящее имя площадки знает только SDK (`gp.platform.type`), а поднимается он
// ПОЗЖЕ первого кадра. Значит источник уточняется задним числом: first-touch
// остаётся, но неопределённый gamepush-токен заменяется на `gp_pikabu` /
// `gp_yandex` / `gp_vk_play`. ⚠️ Настоящий utm/реферер не трогаем НИКОГДА —
// иначе потеряем реальный канал (человек пришёл по ссылке, а не с витрины).
// ⚠️ Визит шлём только ПОСЛЕ уточнения (или 2.5с таймаута): строка воронки
// пишется `on conflict (vid) do nothing`, то есть первый источник — навсегда.
// ---------------------------------------------------------------------------

/** Токены, поверх которых можно записать площадку: она — более точный ответ. */
const UNRESOLVED_SOURCES = new Set([
  "s3.gamepush.com",
  "gamepush.com",
  "gamepush.ru",
  // terron 03.09: хостинг GamePush для дистрибуции живёт на eponesh.com
  // (факт с кабинета: черновик — `s3.eponesh.com/games/draft/…`).
  "s3.eponesh.com",
  "gs.eponesh.com",
  "eponesh.com",
  // terron 09.09: `id.vk.ru` — страница входа VK ID, а НЕ канал привлечения.
  // Внутри ОК и ВК игрок логинится через неё, и реферер внутреннего кадра
  // становится `id.vk.ru`: весь ДЕСКТОПНЫЙ трафик Одноклассников лежал под
  // этим хостом (55 аккаунтов площадки OK за один день 09.09), а мобильный —
  // под `gp_ok`, то есть один канал был разорван надвое. Со страницы
  // авторизации в игру не приходят — перезаписать её площадкой безопасно.
  "id.vk.ru",
  "direct",
]);

/** Уточнить источник именем площадки. `type` — как у SDK: YANDEX/VK_PLAY/PIKABU. */
export function refineSourceFromPlatform(type: unknown): void {
  if (typeof type !== "string") return;
  const t = type.trim().toUpperCase();
  // NONE — песочница GamePush: площадки под нами нет, врать нечего.
  if (!t || t === "NONE") return;
  const token = clean("gp_" + t.toLowerCase());
  try {
    const cur = (localStorage.getItem(SRC_KEY) || "").toLowerCase();
    if (cur && !UNRESOLVED_SOURCES.has(cur)) return;
    if (cur === token) return;
    localStorage.setItem(SRC_KEY, token);
  } catch {
    /* ignore */
  }
  // Визит мог уже уехать с нерешённым токеном (мы его больше не задерживаем).
  // Досылаем — сервер перепишет источник, пока он остаётся нерешённым.
  resendVisitWithSource();
}

let platformSourcePromise: Promise<void> | null = null;

/** Ждём имя площадки (максимум 2.5с). Вне площадки отвечает мгновенно: промиса
 *  `__gpReady` не существует вовсе — сниппет SDK в index.html грузится только
 *  внутри iframe площадки (и никогда на itch). */
export function awaitPlatformSource(): Promise<void> {
  if (platformSourcePromise) return platformSourcePromise;
  const ready = (window as unknown as { __gpReady?: Promise<unknown> })
    .__gpReady;
  if (!ready) {
    platformSourcePromise = Promise.resolve();
    return platformSourcePromise;
  }
  platformSourcePromise = Promise.race([
    ready
      .then((gp) =>
        refineSourceFromPlatform(
          (gp as { platform?: { type?: unknown } } | undefined)?.platform?.type,
        ),
      )
      .catch(() => {
        /* SDK не поднялся — остаёмся на общем gamepush-токене */
      }),
    new Promise<void>((r) => window.setTimeout(r, 2500)),
  ]);
  return platformSourcePromise;
}

// ---------------------------------------------------------------------------
// terron 21.08: ПЛАТФОРМА КЛИЕНТА (вторая ось онлайна, см. миграцию 063).
//
// Зачем отдельно от источника: апка из Google Play / App Store приходит БЕЗ
// реферера (source='direct'), а мобильный браузер неотличим от десктопного
// (channelOf на бэкенде нарочно склеивает 'm.'-хосты). Поэтому «сколько у нас
// мобильных» из источника не вычитается никак.
//
// ⚠️ ГЛАВНАЯ ГРАБЛЯ: на origin terron.io внутри нативной апки мост Capacitor
// МОЖЕТ ОТСУТСТВОВАТЬ — он флапает в WKWebView (документировано в OFFLINE-IOS.md,
// из-за этого же чинили workerAssetBase). Значит `Capacitor.isNativePlatform()`
// — сигнал достаточный, но НЕ необходимый. Поэтому три рубежа:
//   1) мост жив → точный ответ;
//   2) маркер `?from=android_app|ios_app` из бутстрап-редиректа бандла
//      (index.html) → липнет в localStorage апки (у неё своё хранилище,
//      в Chrome/Safari не протекает). Требует релиза в сторах — у уже
//      установленных апок его нет;
//   3) форма UA WebView (`; wv` у Android, iOS без `Safari/`) → отдельный
//      токен webview-*, а НЕ native-*: там же сидят чужие ин-апп браузеры
//      (Telegram/VK), врать «это наша апка» нельзя.
// Итог для чтения графика: native-* — подтверждённый пол, native-* + webview-*
// — верхняя оценка «сколько людей не в обычном браузере».
// ---------------------------------------------------------------------------

/** Платформа по мосту Capacitor. null = моста нет (или мы в вебе). */
function capacitorPlatform(): string | null {
  try {
    const cap = (
      window as unknown as {
        Capacitor?: {
          isNativePlatform?: () => boolean;
          getPlatform?: () => string;
        };
      }
    ).Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    const p = cap.getPlatform?.();
    if (p === "ios") return "native-ios";
    if (p === "android") return "native-android";
    return "native";
  } catch {
    return null;
  }
}

/** Класс устройства по UA — тот же порядок проверок, что в server/Device.ts. */
function deviceClass(): "mobile" | "tablet" | "desktop" {
  const ua = (navigator.userAgent || "").toLowerCase();
  if (/ipad|tablet|playbook|silk|kindle/.test(ua)) return "tablet";
  if (/android/.test(ua) && !/mobile/.test(ua)) return "tablet";
  if (
    /iphone|ipod|android|windows phone|iemobile|blackberry|opera mini/.test(ua)
  ) {
    return "mobile";
  }
  return "desktop";
}

/** Похоже ли на WebView (наша апка без моста ИЛИ чужой ин-апп браузер). */
function webviewShape(): string | null {
  const ua = navigator.userAgent || "";
  if (/; wv\)/i.test(ua)) return "webview-android";
  // iOS: у настоящего Safari в хвосте есть "Safari/…", у WKWebView внутри
  // приложения его нет. Гоняем только по мобильным iOS-UA.
  if (/iphone|ipad|ipod/i.test(ua) && !/safari\//i.test(ua)) {
    return "webview-ios";
  }
  return null;
}

/**
 * Маркер апки из бутстрапа бандла. Считаем его только на мобильном/планшетном
 * UA: ссылку `?from=android_app` можно переслать и открыть на десктопе, и тогда
 * она означала бы «пришёл по ссылке из апки», а не «сидит в апке».
 */
// terron 30.08: ДЕСКТОПНАЯ ОБОЛОЧКА (Steam / скачанная с сайта). Опознаём её
// МОСТОМ, а не маркером в адресе: мост ставит preload оболочки, переслать его
// ссылкой невозможно — ровно та причина, по которой маркер апки ниже режется на
// десктопном классе устройств. Канал сообщает сама оболочка: у сборки для Steam
// это `steam`, у сборки с нашего сайта — `desktop`; путать их нельзя, от этого
// зависит в том числе, разрешена ли наша платёжка.
function desktopShellPlatform(): string | null {
  try {
    const host = (window as unknown as { terronDesktop?: { host?: string } })
      .terronDesktop?.host;
    if (host === "steam") return "steam-app";
    if (host === "desktop") return "desktop-app";
    return null;
  } catch {
    return null;
  }
}

function markerPlatform(): string | null {
  try {
    const raw = (
      new URL(window.location.href).searchParams.get("from") || ""
    ).toLowerCase();
    if (raw !== "android_app" && raw !== "ios_app") return null;
    if (deviceClass() === "desktop") return null;
    return raw === "ios_app" ? "native-ios" : "native-android";
  } catch {
    return null;
  }
}

let platformCache: string | null = null;

/**
 * Токен платформы для пульса онлайна: native-android | native-ios | native |
 * webview-android | webview-ios | web-mobile | web-tablet | web-desktop.
 * Считается один раз за загрузку (UA и мост в пределах страницы не меняются).
 */
export function clientPlatform(): string {
  if (platformCache) return platformCache;
  let sticky: string | null = null;
  try {
    sticky = localStorage.getItem(PLAT_KEY);
  } catch {
    /* приватный режим — обойдёмся без липкости */
  }
  const live =
    desktopShellPlatform() ?? capacitorPlatform() ?? markerPlatform();
  if (live) {
    if (sticky !== live) {
      try {
        localStorage.setItem(PLAT_KEY, live);
      } catch {
        /* ignore */
      }
    }
    platformCache = live;
    return live;
  }
  // Липкое значение переживает уход маркера из адреса (SPA его чистит) и
  // пропажу моста, но только внутри хранилища самой апки.
  if (sticky?.startsWith("native")) {
    platformCache = sticky;
    return sticky;
  }
  platformCache = webviewShape() ?? `web-${deviceClass()}`;
  return platformCache;
}

/** Полный first-touch реферер/лендинг (для БД; в статистике не показываем). */
export function getTrafficReferrer(): string {
  try {
    return localStorage.getItem(REF_KEY) || "";
  } catch {
    return "";
  }
}

async function trafficEvent(
  type: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(getApiBase() + "/traffic/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: getTrafficSource(),
        ref: getTrafficReferrer(), // сервер запишет только на first-touch (insert)
        vid: getDeviceID(),
        // Портрет аудитории (сервер пишет only-once, как и источник): язык
        // браузера и устройство. Страну считает сам сервер по IP — клиенту её
        // доверять нельзя, да и незачем.
        lang: browserLang(),
        platform: clientPlatform(),
        // 19.09: пояс устройства — вторая оценка страны, VPN её не меняет;
        // язык интерфейса — на чём человек играет у нас сейчас.
        tz: deviceTimeZone(),
        uiLang: interfaceLang(),
        type,
        ...extra,
      }),
      keepalive: true, // match_end может уйти при закрытии вкладки
    });
  } catch {
    /* ignore — аналитика не критична */
  }
}

/**
 * Язык браузера — то, на чём человек РЕАЛЬНО читает, а не то, что он выбрал у
 * нас в меню. Второе меняется одним кликом и врёт про аудиторию: половина
 * заходит на дефолте.
 *
 * Берём navigator.language (первый в списке предпочтений). Регион не режем
 * здесь — это делает сервер (normalizeLang), чтобы правило жило в одном месте.
 */
function browserLang(): string {
  try {
    return navigator.language || (navigator.languages ?? [])[0] || "";
  } catch {
    return "";
  }
}

/** IANA-пояс устройства (Europe/Moscow). VPN меняет IP, но не часы. */
function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/**
 * Язык, на котором реально нарисован наш интерфейс. ⚠️ Не getCurrentLang():
 * тот при непоявившемся селекторе отдаёт фолбэк "en" и записал бы англичанином
 * того, кому интерфейс ещё грузится по-русски. Нет ответа — не шлём ничего.
 */
function interfaceLang(): string {
  try {
    // translations появляются, когда доехал словарь языка игрока; до этого
    // currentLang — стартовая заглушка "en".
    const sel = document.querySelector("lang-selector") as {
      currentLang?: string;
      translations?: unknown;
    } | null;
    if (sel?.translations && sel.currentLang) return sel.currentLang;
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem("lang") ?? "";
  } catch {
    return "";
  }
}

/** Визит (раз за сессию вкладки). Metrica-цель + серверная запись. */
export function fireVisit(): void {
  try {
    if (sessionStorage.getItem(VISIT_KEY)) return;
    sessionStorage.setItem(VISIT_KEY, "1");
  } catch {
    /* ignore */
  }
  // terron 09.09: ВИЗИТ УХОДИТ СРАЗУ, а не после ожидания площадки.
  //
  // Раньше здесь стоял `awaitPlatformSource().then(...)` — то есть до 2.5с
  // ожидания SDK ПЕРЕД первой записью. В WebView мобильного приложения площадки
  // сеть первых секунд мертва, SDK поднимается медленно, а человек из каталога
  // уходит быстро: заход, который не дожил до конца ожидания, не попадал в
  // воронку ВООБЩЕ. Факт 09.09 (открытие в каталоге ОК): 289 зашедших по
  // счётчику площадки против 84 строк воронки — знаменатель терялся втрое, и
  // канал нельзя было оценить.
  //
  // Источник это не портит: уточнение площадки прилетит следующим событием
  // (сервер перезапишет ТОЛЬКО нерешённый токен, см. recordTrafficEvent), а
  // если игрок больше ничего не сделает — повторный визит пошлёт
  // refineSourceFromPlatform.
  track("site_visit", { source: getTrafficSource() });
  void trafficEvent("visit");
}

/** Переслать визит, когда площадка стала известна позже первой отправки. */
function resendVisitWithSource(): void {
  try {
    if (!sessionStorage.getItem(VISIT_KEY)) return; // визита ещё не было
  } catch {
    /* хранилище запрещено — шлём, дубль строки не создаст */
  }
  void trafficEvent("visit");
}

// Вехи между «в лобби» и «загрузился» + вовлечение после загрузки — single-fire
// на попытку входа. Сбрасываются на play_click (новая попытка) и на match_start
// (spawned всегда после старта). Разрезают провал play_click ≫ played по стадиям.
let lobbyStartedSent = false;
let spawnedSent = false;

/** Нажали «Играть» (джойн в лобби). */
export function trackPlayClick(): void {
  lobbyStartedSent = false; // новая попытка входа — вехи можно репортить заново
  spawnedSent = false;
  track("play_click", { source: getTrafficSource() });
  void trafficEvent("play_click");
}

/** Лобби стартануло — сервер прислал старт матча (отсчёт кончился). */
export function trackLobbyStarted(): void {
  if (lobbyStartedSent) return;
  lobbyStartedSent = true;
  track("lobby_started", { source: getTrafficSource() });
  void trafficEvent("lobby_started");
}

/** Игрок заспавнился — выбрал точку и получил территорию (hasSpawned). */
export function trackSpawned(): void {
  // Только в отслеживаемом матче (matchStartMs>0): реплей/одиночка не вызывают
  // trackMatchStart → matchStartMs=0 → веха не пишется (иначе воронка врала бы).
  if (spawnedSent || matchStartMs === 0) return;
  spawnedSent = true;
  track("spawned", { source: getTrafficSource() });
  void trafficEvent("spawned");
}

// Исход начатого матча — РОВНО один на матч (single-fire guard):
//   won  — победил; died — доиграл до своей смерти; lost — матч кончился, я жив,
//   но победил другой; quit — ушёл в меню посреди матча; left — закрыл вкладку/
//   ушёл с сайта посреди матча.
export type MatchOutcome = "won" | "died" | "lost" | "quit" | "left";
const OUTCOME_GOAL: Record<MatchOutcome, string> = {
  won: "game_win",
  died: "game_died",
  lost: "game_lost",
  quit: "game_quit",
  left: "game_left",
};

let matchStartMs = 0; // >0 = идёт отслеживаемый матч (не реплей/не single)
let outcomeSent = false;

/** Матч реально начался для игрока («поиграл хоть сколько-то»). */
export function trackMatchStart(): void {
  matchStartMs = Date.now();
  outcomeSent = false;
  spawnedSent = false; // спавн всегда после старта — веха ждёт этот матч
  track("game_start");
  void trafficEvent("match_start");
}

/**
 * Исход матча. Срабатывает ОДИН раз за матч — кто первый (смерть/победа/уход)
 * тот и зафиксирован; остальные вызовы игнорируются. No-op вне отслеживаемого
 * матча (single-player/реплей — там matchStartMs не выставлялся).
 */
export function trackMatchOutcome(outcome: MatchOutcome): void {
  if (matchStartMs === 0 || outcomeSent) return;
  outcomeSent = true;
  const seconds = Math.max(0, Math.round((Date.now() - matchStartMs) / 1000));
  matchStartMs = 0;
  track(OUTCOME_GOAL[outcome], { seconds });
  void trafficEvent("match_end", { seconds, won: outcome === "won", outcome });
  // terron: зеркалим прогресс в игрока площадки (чек-лист модерации GamePush —
  // «прогресс сохраняется»). Вне площадки — no-op. Импорт ленивый: Analytics
  // грузится очень рано, тянуть за собой SDK-модуль незачем.
  void import("./PlatformHost").then(({ Host }) => Host.recordMatch(outcome));
}

/**
 * terron 20.08: ПУЛЬС ОНЛАЙНА С ИСТОЧНИКОМ.
 *
 * Игровой сервер знает, сколько людей онлайн, но не знает, откуда они пришли:
 * источник живёт только здесь, в localStorage (first-touch). Поэтому вкладка
 * сама раз в минуту говорит бэкенду «я здесь, я с такого-то канала», а он
 * считает онлайн по каналам (см. /stats/online_sources).
 *
 * Пульсуем ТОЛЬКО пока вкладка видима: фоновая вкладка игроком не является, да
 * и браузер всё равно душит таймеры (та же дисциплина, что у прочих опросов).
 */
export function startOnlineHeartbeat(): void {
  let timer: number | undefined;
  const beat = () => {
    if (document.visibilityState !== "visible") return;
    void fetch(getApiBase() + "/traffic/online", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vid: getDeviceID(),
        source: getTrafficSource(),
        platform: clientPlatform(),
      }),
    }).catch(() => {
      /* аналитика не критична */
    });
  };
  const start = () => {
    if (timer !== undefined) return;
    beat();
    timer = window.setInterval(beat, 60_000);
  };
  const stop = () => {
    if (timer === undefined) return;
    window.clearInterval(timer);
    timer = undefined;
  };
  document.addEventListener("visibilitychange", () =>
    document.visibilityState === "visible" ? start() : stop(),
  );
  start();
}

// terron 30.08: инициализация Playgama Bridge.
//
// Их техтребования: «The Playgama Bridge is integrated into the game» — то есть
// мало положить скрипт, надо позвать initialize. Скрипт вставляется ТОЛЬКО в
// сборку `--mode playgama` (см. vite.config, playgamaHtml), поэтому в обычном
// вебе и в апках этот модуль ничего не делает и ни на что не влияет.
//
// ⚠️ Ошибка инициализации НЕ должна ронять игру: их SDK — обвязка площадки
// (реклама, сохранения, платежи), а играть можно и без неё. Падает — пишем в
// консоль и живём дальше, как с GamePush.
import type { MatchOutcome } from "./Analytics";
import { L } from "./Utils";

declare const __PLATFORM_BUILD__: string | undefined;

type PlatformModule = {
  id?: string;
  language?: string;
  isAudioEnabled?: boolean;
  isPaused?: boolean;
  sendMessage?: (message: string) => Promise<unknown>;
  on?: (event: string, cb: (value: boolean) => void) => void;
};
type AdModule = {
  isInterstitialSupported?: boolean;
  isRewardedSupported?: boolean;
  showInterstitial?: (placement?: string) => unknown;
  showRewarded?: (placement?: string) => unknown;
  on?: (event: string, cb: (state: unknown) => void) => void;
};
type StorageModule = {
  get?: (keys: string[]) => Promise<unknown[]>;
  set?: (keys: string[], values: unknown[]) => Promise<unknown>;
};
type Bridge = {
  initialize?: () => Promise<unknown>;
  EVENT_NAME?: Record<string, string>;
  platform?: PlatformModule;
  advertisement?: AdModule;
  storage?: StorageModule;
};

export function isPlaygamaBuild(): boolean {
  return typeof __PLATFORM_BUILD__ === "string" && __PLATFORM_BUILD__ === "playgama";
}

let started = false;

/** Зовётся один раз из Main. Ждать её не нужно — игра стартует независимо. */
export function initPlaygamaBridge(): void {
  if (!isPlaygamaBuild() || started) return;
  started = true;
  try {
    const bridge = rawBridge();
    if (!bridge?.initialize) {
      // Скрипт не догрузился (сеть площадки, блокировщик). Не наша беда — но
      // знать об этом полезно, иначе «почему у них нет рекламы» будет загадкой.
      console.warn("[playgama] SDK не загрузился — играем без него");
      return;
    }
    void bridge
      .initialize()
      .then(() => {
        bridgeReady = true;
        logDiag();
        // ⚠️ Экран аккаунта мог отрисоваться РАНЬШЕ готовности SDK — тогда он
        // решил, что входа нет, и кнопку не показал. Будим его.
        try {
          window.dispatchEvent(new CustomEvent("platform-auth-ready"));
        } catch {
          /* не критично */
        }
        // ⚠️ ОБЯЗАТЕЛЬНЫЙ СИГНАЛ. Их сертификация ждёт именно его («Waiting for
        // the Game Ready event») и без него не пускает игру на отправку. Шлём
        // сразу после инициализации: SDK грузится в конце body, то есть меню к
        // этому моменту уже отрисовано.
        // Порядок ровно их: язык → game_ready → звук и пауза (см. «Implementation
        // order» в их доке по модулю platform).
        applyPlatformLanguage();
        playgamaSend("game_ready");
        wireAudioAndPause();
        wireScreenEvents();
        wireAdSilence();
        watchGameplayState();
        void restoreProgressKey();
        // Площадка уже авторизовала игрока — возобновляем ЕГО аккаунт, но не
        // заводим новый: правило то же, что у GamePush (auth-flows.md §2).
        void playgamaLogin(false);
      })
      .catch((e: unknown) => console.warn("[playgama] init не удался", e));
  } catch (e) {
    console.warn("[playgama] init упал", e);
  }
}


// ── сигналы жизненного цикла ────────────────────────────────────────────────
//
// Площадка должна знать, что происходит в игре: когда она загрузилась, когда
// игрок в бою, когда бой кончился. От этого зависит, когда ей можно показывать
// рекламу и как считать сессию. Полный набор их сообщений: game_ready,
// in_game_loading_started/stopped, gameplay_started/stopped, level_*.
//
// ⚠️ Ошибка отправки не должна ронять игру — сигналы это отчётность площадке,
// а не часть матча.
function playgamaSend(message: string): void {
  if (!isPlaygamaBuild()) return;
  try {
    const send = bridgeOf()?.platform?.sendMessage;
    if (typeof send !== "function") return;
    void Promise.resolve(send.call(bridgeOf()?.platform, message)).catch(
      () => undefined,
    );
  } catch {
    /* сигнал не долетел — игре всё равно */
  }
}

/**
 * Когда игрок вошёл в матч и когда вышел.
 *
 * ⚠️ Смотрим на класс `in-game` у body, а не врезаемся в игровой код: этот класс
 * и так единственный признак «идёт матч» (на нём держатся тема, гейты меню и
 * датчики), и наблюдение за ним ничего не ломает ни в одной другой сборке.
 */
function watchGameplayState(): void {
  if (!isPlaygamaBuild()) return;
  try {
    watchMapLoading();
    let inGame = document.body.classList.contains("in-game");
    if (inGame) playgamaSend("gameplay_started");
    const check = () => {
      const now = document.body.classList.contains("in-game");
      if (now === inGame) return;
      inGame = now;
      playgamaSend(now ? "gameplay_started" : "gameplay_stopped");
      // ⚠️ ПАРА `level_*` ИДЁТ ВМЕСТЕ С `gameplay_*`, а не вместо: у них это
      // РАЗНЫЕ сигналы (сессия против уровня), и оба перечислены в их наборе
      // сообщений. Матч у нас и есть уровень — других уровней в игре нет.
      // Проигрыш (умер/проиграл) честно сообщается как `level_failed` — исход
      // приносит trackMatchOutcome, та же точка, что зеркалит его в GamePush.
      if (now) {
        lastOutcome = null; // новый матч — прежний исход не в счёт
        playgamaSend("level_started");
      } else {
        playgamaSend(
          lastOutcome === "died" || lastOutcome === "lost"
            ? "level_failed"
            : "level_completed",
        );
        lastOutcome = null;
      }
      // ⚠️ СОХРАНЕНИЕ ЗОВЁМ НА КАЖДОМ ПЕРЕХОДЕ, а не только при первом запуске.
      // Их проверка «Game Saves» ждёт РЕАЛЬНОГО вызова storage.set после того,
      // как игрок поиграл («Waiting for a save event via SDK methods»), и
      // разовая запись «если ключа ещё нет» её не удовлетворяет: на втором
      // заходе ключ уже лежит, и set не звался бы никогда.
      void saveProgress();
      // Матч кончился, игрок в меню — это и есть «natural pause» их правил.
      if (!now) showInterstitialOnMenuReturn();
    };
    new MutationObserver(check).observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  } catch (e) {
    console.warn("[playgama] наблюдение за матчем не встало", e);
  }
}


// ── язык площадки ───────────────────────────────────────────────────────────
//
// Их требование №1: прочитать `platform.language` и применить локализацию. Мы
// шлём то же событие, что и селектор языка в интерфейсе, — второй ветки выбора
// языка заводить незачем.
// ⚠️ Явный выбор игрока сильнее: если человек уже сам ставил язык, он лежит в
// localStorage, и перебивать его языком площадки нельзя.
function applyPlatformLanguage(): void {
  try {
    const raw = bridgeOf()?.platform?.language;
    if (typeof raw !== "string" || raw.length === 0) return;
    // ⚠️ ГЕЙТ «игрок уже выбирал язык» СНЯТ, И ЭТО ГЛАВНОЕ.
    // `language-selected` внутри ПИШЕТ выбранный язык в localStorage — то есть
    // язык, применённый нами же на первом запуске, тут же становился «явным
    // выбором игрока» и НАВСЕГДА блокировал управление языком со стороны
    // площадки. Их проверка «платформа переключает язык» этого не прощает
    // (репорт владельца 30.08). У GamePush та же грабля закрыта ровно так же —
    // ключ снимается сразу после события.
    const lang = raw.toLowerCase().slice(0, 2);
    window.dispatchEvent(
      new CustomEvent("language-selected", { detail: { lang } }),
    );
    localStorage.removeItem("lang");
    console.log("[playgama] язык площадки применён:", lang);
  } catch {
    /* язык не критичен — останется наш дефолт */
  }
}

// ── звук и пауза ────────────────────────────────────────────────────────────
//
// Их требование №3 и одновременно два пункта чек-листа модерации: звук обязан
// умолкать во время рекламы и при сворачивании вкладки. Оба случая приходят
// ОДНИМИ событиями площадки, поэтому и обработчик один — как они и советуют.
//
// ⚠️ Начальное состояние надо применить РУКАМИ: подписка ловит только
// последующие изменения (об этом прямо предупреждает их дока).
function wireAudioAndPause(): void {
  try {
    const b = bridgeOf();
    const p = b?.platform;
    if (!p) return;
    const applyAudio = (enabled: boolean) => {
      void import("./sound/AudioBus").then(({ setTransientAll }) =>
        setTransientAll(!enabled),
      );
    };
    const applyPause = (paused: boolean) => {
      void import("./sound/AudioBus").then(({ setTransientAll }) =>
        setTransientAll(paused),
      );
      // ⚠️ ЗВУКА МАЛО — ИХ ТРЕБОВАНИЕ «игра должна ВСТАТЬ». Механизм у нас давно
      // есть (`gp-platform-pause` → GameRightSidebar), но к нему был подключён
      // только GamePush, и в этой сборке пауза площадки не останавливала ничего
      // (вопрос владельца 30.08: «мы передаём их паузу в наш сингл?» — не
      // передавали). Сайдбар сам решает, где паузить можно: одиночка, обучение,
      // реплей. В сетевом матче мир идёт у всех — останавливать нечего.
      try {
        window.dispatchEvent(
          new CustomEvent("gp-platform-pause", { detail: paused }),
        );
      } catch {
        /* окна нет — не наш случай */
      }
    };
    if (p.isAudioEnabled === false) applyAudio(false);
    if (p.isPaused === true) applyPause(true);
    const ev = b?.EVENT_NAME ?? {};
    p.on?.(ev.AUDIO_STATE_CHANGED ?? "audio_state_changed", (enabled) =>
      applyAudio(enabled),
    );
    p.on?.(ev.PAUSE_STATE_CHANGED ?? "pause_state_changed", (paused) =>
      applyPause(paused),
    );
    // ⚠️ ВИДИМОСТЬ — отдельное их событие, и обходиться без него нельзя: игрок
    // ушёл на другую вкладку площадки, а у нас играла музыка и крутилась
    // одиночка. Значения: "visible" / "hidden" (строка, не булево).
    p.on?.(ev.VISIBILITY_STATE_CHANGED ?? "visibility_state_changed", (state) =>
      applyPause(String(state) === "hidden"),
    );
  } catch (e) {
    console.warn("[playgama] звук/пауза не подключились", e);
  }
}

// ── экран: ориентация и размер ──────────────────────────────────────────────
//
// Их сертификация отдельно проверяет поворот и смену размера кадра («flip
// landscape», «scale test»): интерфейс обязан перестроиться, ничего не должно
// обрезаться. Наша вёрстка это умеет — она слушает `resize`. Но площадка меняет
// РАЗМЕР КАДРА, а не окно, и события `resize` может не быть вовсе.
//
// ⚠️ Поэтому на их сигналы отвечаем тем же, чем на обычный ресайз: шлём
// `resize`, чтобы пересчитались и HUD, и канвас. Своей ветки раскладки не
// заводим — она разъехалась бы с настоящим ресайзом.
function wireScreenEvents(): void {
  try {
    const b = bridgeOf();
    const p = b?.platform;
    if (!p?.on) return;
    const ev = b?.EVENT_NAME ?? {};
    const relayout = (what: string) => (state: unknown) => {
      console.log(`[playgama] экран: ${what} →`, state);
      try {
        window.dispatchEvent(new Event("resize"));
      } catch {
        /* окна нет */
      }
    };
    p.on(ev.ORIENTATION_STATE_CHANGED ?? "orientation_state_changed", relayout("ориентация"));
    p.on(ev.SCREEN_SIZE_CHANGED ?? "screen_size_changed", relayout("размер"));
  } catch (e) {
    console.warn("[playgama] события экрана не подключились", e);
  }
}

// ── межстраничная реклама ───────────────────────────────────────────────────
//
// У них interstitial ОБЯЗАТЕЛЕН («Every game must show interstitial ads at
// natural breakpoints to qualify for platform revenue share»).
//
// ⚠️ Место показа выбрано по их же правилу «никогда посреди игры»: только при
// ВОЗВРАЩЕНИИ ИЗ МАТЧА В МЕНЮ. Это единственная настоящая пауза в нашей игре —
// матч идёт в реальном времени, и прервать его рекламой значит подставить
// игрока под чужую атаку.
// ⚠️ Интервал между показами держит их SDK (60 с по умолчанию), своего счётчика
// не заводим — разъехался бы с их.
function showInterstitialOnMenuReturn(): void {
  try {
    const ad = bridgeOf()?.advertisement;
    if (!ad?.showInterstitial) {
      console.warn("[playgama] interstitial: метода нет в SDK");
      return;
    }
    // ⚠️ ГЕЙТ ПО `isInterstitialSupported` УБРАН. Их собственный
    // `showInterstitial()` этот флаг НЕ смотрит вовсе (проверено по их SDK: он
    // отказывает только если другая реклама уже идёт), а у нас false молча
    // гасил вызов — и в их QA-инструменте «рекламы нет» при том, что мы её
    // честно звали. Пусть решает их SDK, а не наша догадка о нём.
    // ⚠️ Зовём БЕЗ своего placement: сигнатура `show(placement = null)`, и
    // произвольная строка — лишний повод для отказа. Место показа мы и так
    // выбираем сами (только возврат из матча в меню).
    console.log("[playgama] interstitial: показываю (возврат в меню)");
    ad.showInterstitial();
  } catch (e) {
    console.warn("[playgama] реклама не показалась", e);
  }
}

// ── сохранение прогресса через их storage ───────────────────────────────────
//
// Их чек-лист называет отдельной причиной отказа «progress is not saved through
// SDK methods». Наш прогресс живёт на сервере и ключуется анонимным id
// устройства — вот его и храним у площадки: вернувшись, игрок попадает в свой
// профиль, а не в чистый.
//
// ⚠️ Сохраняем ТОЛЬКО этот ключ. Класть туда игровые данные незачем: они и так
// на нашем сервере, а дублирование дало бы два расходящихся источника правды.
const PROGRESS_KEY = "terron_player_id";

async function restoreProgressKey(): Promise<void> {
  try {
    const st = bridgeOf()?.storage;
    if (!st?.get || !st?.set) return;
    const mine = await deviceKey();
    const saved = await st.get([PROGRESS_KEY]);
    const theirs = Array.isArray(saved) ? saved[0] : null;
    if (typeof theirs === "string" && theirs.length > 0 && theirs !== mine) {
      // На площадке уже играли с этого аккаунта — подхватываем прежний id,
      // иначе прогресс и награды остались бы на старом устройстве.
      localStorage.setItem("player_persistent_id", theirs);
      return;
    }
    // ⚠️ ПИШЕМ ВСЕГДА, а не только «если пусто». Их проверка «Game Saves» ловит
    // ФАКТ ВЫЗОВА storage.set, и разовая запись на первом в жизни заходе её не
    // удовлетворяет: на любом следующем прогоне ключ уже лежит, и события нет
    // вовсе («Waiting for a save event via SDK methods»). Запись идемпотентная,
    // одно короткое значение — цена нулевая. Плюс id действительно может
    // смениться: гость завёл аккаунт, и прогресс переехал на него.
    await st.set([PROGRESS_KEY], [mine]);
  } catch (e) {
    console.warn("[playgama] прогресс не синхронизирован", e);
  }
}

/** Записать прогресс площадке. Зовётся на входе в матч и на выходе из него. */
async function saveProgress(): Promise<void> {
  try {
    const st = bridgeOf()?.storage;
    if (!st?.set) return;
    await st.set([PROGRESS_KEY], [await deviceKey()]);
  } catch (e) {
    console.warn("[playgama] прогресс не сохранён", e);
  }
}

/**
 * Ключ УСТРОЙСТВА для хранилища площадки.
 *
 * ⚠️ Именно анонимный id, а НЕ `getPersistentID()`: у залогиненного тот отдаёт
 * account-uuid, и мы бы положили к площадке идентификатор аккаунта. Это и
 * бесполезно (аккаунт поднимается сессией, а не этим ключом), и опасно —
 * подставленный из хранилища account-uuid без токена сервер всё равно считает
 * анонимом, зато гостевой прогресс устройства потерялся бы.
 *
 * Гостю этот ключ и нужен: по нему его матчи, награды и незабранное находятся
 * до регистрации, а при входе `adoptGuestProgress` переносит их на аккаунт.
 */
async function deviceKey(): Promise<string> {
  const { getAnonPersistentIDs, getPersistentID } = await import("./Auth");
  return getAnonPersistentIDs()[0] ?? getPersistentID();
}

// ── вход через площадку ─────────────────────────────────────────────────────
//
// Устроено как у GamePush (см. GamePushSDK.tryLoginToBackend), но проще: сервер
// проверяет игрока сам, поэтому клиент не носит ни nonce, ни «источник id» — он
// отдаёт ровно то, что дала площадка (`player.extra`), и результат решает бэкенд.
//
// ⚠️ ГЕЙТ ПЛОЩАДОК. Их проверка работает только на playgama / msn /
// microsoft_store; на остальных сервер ответит 501, и это НОРМА, а не сбой —
// там играют анонимно. Поэтому 501 не логируем как ошибку.
type BridgePlayer = {
  id?: string | number;
  name?: string;
  isAuthorized?: boolean;
  extra?: unknown;
  authorize?: (options?: unknown) => Promise<unknown>;
};
type BridgePlatform = { id?: string };
type FullBridge = Bridge & { player?: BridgePlayer; platform?: BridgePlatform };

/**
 * ⚠️ ДО `initialize()` К МОДУЛЯМ SDK ОБРАЩАТЬСЯ НЕЛЬЗЯ. Их геттеры не бросают —
 * они ПЕЧАТАЮТ КРАСНУЮ ОШИБКУ «Before using the SDK you must initialize it» и
 * всё равно отдают модуль. То есть каждое наше раннее обращение к
 * `bridge.platform` / `bridge.player` засоряет консоль игрока чужой ошибкой, и
 * выглядит это как поломка их SDK (репорт владельца 30.08: десяток красных
 * строк на экране аккаунта). Поэтому наружу модули отдаём только после init.
 */
let bridgeReady = false;

function bridgeOf(): FullBridge | null {
  if (!bridgeReady) return null;
  return rawBridge();
}

/** Сам объект без гейта — только для самой инициализации. */
function rawBridge(): FullBridge | null {
  try {
    return (window as unknown as { bridge?: FullBridge }).bridge ?? null;
  } catch {
    return null;
  }
}

/**
 * Язык площадки для СТАРТА интерфейса — ждём инициализации Bridge.
 *
 * ⚠️ Без этого язык площадки не применялся ВООБЩЕ: `LangSelector` спрашивал его
 * только у GamePush, которого в этой сборке нет, а наш `applyPlatformLanguage`
 * догоняет уже ПОСЛЕ отрисовки меню. Их проверка «платформа переключает язык»
 * этого не прощает.
 * ⚠️ Потолок ожидания обязателен: залипший SDK не должен держать меню.
 */
export async function playgamaLanguageReady(
  timeoutMs = 1500,
): Promise<string | null> {
  if (!isPlaygamaBuild()) return null;
  const started = Date.now();
  while (!bridgeReady && Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
  try {
    const raw = bridgeOf()?.platform?.language;
    if (typeof raw !== "string" || raw.length === 0) return null;
    return raw.toLowerCase().slice(0, 2);
  } catch {
    return null;
  }
}

/** Какая площадка нас открыла (msn / y8 / discord …). */
export function playgamaPlatformId(): string {
  try {
    return String(bridgeOf()?.platform?.id ?? "").toLowerCase();
  } catch {
    return "";
  }
}

/** Уже авторизован площадкой? Тогда вход можно делать молча. */
export function playgamaAuthorized(): boolean {
  return bridgeOf()?.player?.isAuthorized === true;
}

/**
 * Отдать данные площадки нашему API. `allowCreate` работает как у GamePush:
 * тихий автовход НЕ создаёт аккаунт, явное действие игрока — создаёт.
 */
export async function playgamaLogin(
  allowCreate: boolean,
  skipAuthorizedCheck = false,
): Promise<boolean> {
  const b = bridgeOf();
  const platform = playgamaPlatformId();
  if (!isPlaygamaBuild() || !b?.player || !platform) {
    // ⚠️ Пишем, чего именно НЕ ХВАТИЛО. «Нет игрока или площадки» при живой
    // площадке — это ложный след: читающий лог начинает искать не там.
    console.warn(
      "[playgama] вход не начат:",
      !isPlaygamaBuild()
        ? "сборка не платформенная"
        : !platform
          ? "SDK не сказал площадку"
          : "SDK не дал модуль player",
    );
    return false;
  }
  // Тихий автовход по-прежнему требует уже авторизованного игрока: лезть к
  // серверу с неавторизованным гостем незачем. По кнопке проверку пропускаем.
  if (!skipAuthorizedCheck && b.player.isAuthorized !== true) return false;

  try {
    const { getApiBase } = await import("./Api");
    const { getAnonPersistentIDs } = await import("./Auth");
    const anonIds = getAnonPersistentIDs();
    const r = await fetch(`${getApiBase()}/auth/playgama`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        platform,
        // Платформенные данные авторизации — их проверяет НАШ сервер через API
        // Playgama. Сам по себе этот объект доверия не заслуживает.
        extra: b.player.extra ?? null,
        name: typeof b.player.name === "string" ? b.player.name : undefined,
        anonIds: anonIds.length > 0 ? anonIds : undefined,
        createIfMissing: allowCreate ? undefined : false,
      }),
    });
    if (r.status === 501) {
      // Площадка непроверяемая — так и задумано, там играют анонимно.
      authFailure = L(
        "На этой площадке аккаунты недоступны",
        "Accounts aren't available on this platform",
      );
      console.warn("[playgama] вход: площадку проверить нечем (501)");
      return false;
    }
    if (r.status === 204) return false; // аккаунта нет, а создавать не просили
    if (!r.ok) {
      authFailure =
        r.status === 401
          ? L(
              "Площадка не подтвердила игрока",
              "The platform didn't confirm the player",
            )
          : null;
      console.warn("[playgama] вход отклонён сервером:", r.status);
      return false;
    }
    authFailure = null;
    return true;
  } catch (e) {
    console.warn("[playgama] вход не удался", e);
    return false;
  }
}

/** Кнопка «Войти»: сперва просим площадку, затем логинимся у себя. */
export async function playgamaAuthorizeAndLogin(): Promise<boolean> {
  authFailure = null;
  const b = bridgeOf();
  if (!isPlaygamaBuild() || !b?.player?.authorize) {
    authFailure = L(
      "Эта площадка не умеет вход",
      "This platform has no sign-in",
    );
    console.warn("[playgama] вход: у SDK нет player.authorize");
    return false;
  }
  try {
    if (b.player.isAuthorized !== true) {
      // ⚠️ Их требование: authorize() только из прямого действия игрока.
      await b.player.authorize();
    }
    // ⚠️ ФЛАГ `isAuthorized` ПОСЛЕ authorize() НЕ ПРОВЕРЯЕМ. Раньше проверяли —
    // и получали МОЛЧАЛИВЫЙ отказ («Вход не удался», запрос до сервера даже не
    // уходил), если площадка обновляет флаг не мгновенно. Раз authorize() не
    // бросил — пробуем вход, а решает пусть сервер: у него настоящая проверка.
    return await playgamaLogin(true, /* skipAuthorizedCheck */ true);
  } catch (e) {
    authFailure = L(
      "Площадка не подтвердила вход",
      "The platform didn't confirm sign-in",
    );
    console.warn("[playgama] авторизация отклонена площадкой", e);
    return false;
  }
}

// ⚠️ Причина последнего неудачного входа — для ЧЕСТНОГО сообщения игроку.
// «Вход не удался, попробуй ещё раз» на отказ площадки это ложь: пробовать
// незачем, дело не в нас (репорт владельца 30.08 из их QA-инструмента).
let authFailure: string | null = null;
export function lastAuthFailure(): string | null {
  return authFailure;
}


// ── rewarded: «посмотри ролик — удвой награду» ──────────────────────────────
//
// Ровно то же, что у нас работает на GamePush (кнопка ×2 на экране итогов
// матча), только их SDK. Второй сценарий не выдумываем: игрок уже привык к
// этой кнопке, а площадке нужен ровно факт интеграции.
//
// Состояния и имена событий взяты ИЗ ИХ SDK, а не из головы:
// `rewarded_state_changed` со значениями loading/opened/closed/failed/rewarded.
const REWARD_STATE = {
  opened: "opened",
  closed: "closed",
  failed: "failed",
  rewarded: "rewarded",
} as const;

/** Есть ли сейчас ролик за награду (без него кнопку ×2 не рисуем). */
export function playgamaRewardedAvailable(): boolean {
  if (!isPlaygamaBuild()) return false;
  return bridgeOf()?.advertisement?.isRewardedSupported === true;
}

/**
 * Показать ролик. true — площадка подтвердила просмотр (награду можно удваивать).
 *
 * ⚠️ ЗАКРЫТИЕ МОЖЕТ ПРИЙТИ РАНЬШЕ НАГРАДЫ — грабля, стоившая нам ложного «ролик
 * не досмотрен» на GamePush (репорт владельца 30.07). Поэтому на `closed`
 * выжидаем грейс: пришло `rewarded` — засчитываем, промолчали — только тогда
 * отказ.
 * ⚠️ Таймаут 90 с: площадка может не ответить вовсе, а кнопка не должна висеть
 * заблокированной до конца матча.
 */
export function playgamaShowRewarded(): Promise<boolean> {
  const ad = bridgeOf()?.advertisement;
  if (!isPlaygamaBuild() || !ad?.showRewarded) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let done = false;
    let closeTimer: number | null = null;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (closeTimer !== null) clearTimeout(closeTimer);
      resolve(ok);
    };
    const CLOSE_GRACE_MS = 1500;
    try {
      const b = bridgeOf();
      const ev = b?.EVENT_NAME?.REWARDED_STATE_CHANGED ?? "rewarded_state_changed";
      b?.advertisement?.on?.(ev, (state: unknown) => {
        if (state === REWARD_STATE.rewarded) finish(true);
        else if (state === REWARD_STATE.failed) finish(false);
        else if (state === REWARD_STATE.closed && closeTimer === null) {
          closeTimer = window.setTimeout(() => finish(false), CLOSE_GRACE_MS);
        }
      });
      ad.showRewarded?.();
    } catch (e) {
      console.warn("[playgama] ролик не показался", e);
      finish(false);
    }
    setTimeout(() => finish(false), 90_000);
  });
}

// ── тишина на время рекламы ────────────────────────────────────────────────
//
// Их требование дословно: во время рекламы игра обязана молчать. Площадка ЧАСТО
// шлёт это сама (`audio_state_changed`), но не обязана — а звук поверх ролика
// это отказ на модерации. Поэтому глушим сами по состоянию рекламы; вызов
// парный с `wireAudioAndPause`, оба идут через один AudioBus, повтор безвреден.
function wireAdSilence(): void {
  try {
    const b = bridgeOf();
    const ad = b?.advertisement;
    if (!ad?.on) return;
    const mute = (on: boolean) =>
      void import("./sound/AudioBus").then(({ setTransientAll }) =>
        setTransientAll(on),
      );
    const handle = (state: unknown) => {
      // Видимый след в консоли: без него «рекламы нет» невозможно отличить от
      // «реклама не настроена у площадки» — а это разные диагнозы.
      console.log("[playgama] реклама:", state);
      if (state === REWARD_STATE.opened) mute(true);
      else if (
        state === REWARD_STATE.closed ||
        state === REWARD_STATE.failed ||
        state === REWARD_STATE.rewarded
      )
        mute(false);
    };
    const ev = b?.EVENT_NAME ?? {};
    ad.on(ev.REWARDED_STATE_CHANGED ?? "rewarded_state_changed", handle);
    ad.on(ev.INTERSTITIAL_STATE_CHANGED ?? "interstitial_state_changed", handle);
  } catch (e) {
    console.warn("[playgama] тишина на рекламе не подключилась", e);
  }
}


// ── ОДНА СТРОКА, ПО КОТОРОЙ ВИДНО ВСЁ ───────────────────────────────────────
//
// Требование владельца 30.08, дословно: «ты бы во внутренние логи такие вещи
// писал, чтобы не дебагать по сотне лет».
//
// Повод: полвечера ушло на вопросы, ответ на которые SDK знает сразу — какая
// это площадка (оказалось `qa_tool`, а не playgama и не yandex), готов ли
// bridge, почему скрыта кнопка входа, поддерживается ли реклама. Каждый раз это
// выяснялось руками из чужой консоли, а один вывод («прикидывается Яндексом»)
// оказался просто НЕВЕРНЫМ — потому что строился по соседним скриптам страницы,
// а не по факту.
//
// ⚠️ Печатаем СРАЗУ ПОСЛЕ init и ровно то, что определяет поведение: дальше
// любой репорт «не работает вход/реклама/сохранение» читается за секунду.
function logDiag(): void {
  try {
    const b = bridgeOf();
    const platform = playgamaPlatformId();
    const canLogin = VERIFIABLE_PLATFORMS.has(platform);
    console.log("[playgama] готов ·", {
      площадка: platform || "(SDK не сказал)",
      входВозможен: canLogin
        ? "да"
        : `нет — площадки «${platform}» нет в списке проверяемых (${[...VERIFIABLE_PLATFORMS].join("/")})`,
      игрокАвторизован: b?.player?.isAuthorized === true,
      реклама: {
        межстраничная: b?.advertisement?.isInterstitialSupported !== false,
        заНаграду: b?.advertisement?.isRewardedSupported === true,
      },
      хранилище: typeof b?.storage?.set === "function" ? "есть" : "НЕТ",
      хостИгры: typeof __GAME_HOST__ === "string" ? __GAME_HOST__ : "(не вшит)",
      адресБандла: location.origin + location.pathname,
    });
  } catch (e) {
    console.warn("[playgama] сводку собрать не вышло", e);
  }
}

declare const __GAME_HOST__: string | undefined;

/**
 * Площадки, игрока которых НАШ СЕРВЕР умеет подтвердить.
 *
 * ⚠️ ОДИН СПИСОК НА ВЕСЬ КЛИЕНТ — его же читает `PlatformAuth`. Второй экземпляр
 * я тут развёл сам и сразу убрал: разъехавшись, они дали бы кнопку входа там,
 * где сервер ответит 501, и «вход не удался» вернулся бы.
 * ⚠️ Дубль списка из `platform-api/src/auth/playgamaVerify.ts` остаётся: это
 * граница доверия, и на сервере она обязана быть своя.
 */
export const VERIFIABLE_PLATFORMS = new Set([
  "playgama",
  "msn",
  "microsoft_store",
]);


// ── загрузка карты = «загрузка уровня» ──────────────────────────────────────
//
// Их набор сообщений различает загрузку игры (game_ready, шлём один раз) и
// загрузку ВНУТРИ игры — `in_game_loading_started/stopped`. У нас это загрузка
// карты перед матчем: она занимает секунды и именно в это время площадке
// показывать рекламу нельзя.
//
// ⚠️ Ловим по тому же принципу, что и матч, — по факту в DOM, без врезки в
// игровой код: оверлей загрузки существует ровно пока карта грузится.
function watchMapLoading(): void {
  try {
    let loading = false;
    const check = () => {
      // ⚠️ Смотрим на НАСТОЯЩИЙ элемент экрана загрузки (`<game-starting-modal>`
      // с флагом isVisible), а не на выдуманный класс: первый вариант селектора
      // я взял из головы, и он не совпал бы ни с чем — сигнал не ушёл бы вовсе.
      const el = document.querySelector("game-starting-modal") as
        | (HTMLElement & { isVisible?: boolean })
        | null;
      const now = el?.isVisible === true;
      if (now === loading) return;
      loading = now;
      playgamaSend(now ? "in_game_loading_started" : "in_game_loading_stopped");
    };
    check();
    // ⚠️ ОПРОС, А НЕ MutationObserver: `isVisible` — реактивное СВОЙСТВО lit,
    // оно не отражается ни в атрибут, ни в детей, да и сама модалка живёт в
    // shadow DOM. Наблюдатель за body не увидел бы смену НИКОГДА (первый
    // вариант был именно таким и молчал бы). Раз в 400 мс — чтение одного поля.
    setInterval(check, 400);
  } catch (e) {
    console.warn("[playgama] наблюдение за загрузкой не встало", e);
  }
}


// ── исход матча для честного level_failed ───────────────────────────────────
//
// Зовёт `Analytics.trackMatchOutcome` — единая точка, куда стекаются
// won/lost/died из ClientGameRunner и WinModal (ровно там же исход уже
// зеркалится в GamePush). Вне платформенной сборки — безвредная запись в
// переменную, наблюдатель матча всё равно не активен.
// Тип исхода — ИЗ Analytics (единственный источник; свой список тут разъехался
// бы, что tsc и поймал дважды на "quit" и "left"). Провал уровня — только
// died/lost; выход сам ("quit"/"left") — нейтральный completed.
let lastOutcome: MatchOutcome | null = null;
export function noteMatchOutcome(outcome: MatchOutcome): void {
  lastOutcome = outcome;
}

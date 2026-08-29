// terron: интеграция GamePush — РФ-агрегатор (Yandex Игры / VK Play / Пикабу одним
// SDK). Грузит игру в iframe площадки, отдаёт нативный id игрока площадки.
//
// Зачем нам: получить НАТИВНЫЙ getUniqueID площадки (для Яндекса — его getUniqueID)
// и залинковать на НАШ аккаунт через POST /auth/ya. Ключуемся по нативному id (не
// по внутреннему gp-id) → портируемость: тот же id через GamePush сегодня / нативный
// SDK завтра = тот же юзер. Public token — публичный по дизайну (едет в клиент);
// SECRET живёт ТОЛЬКО на сервере (verify в /auth/ya), сюда не попадает.
//
// Активен только в iframe площадки. На terron.io / Capacitor — no-op.
//
// ⚠️ Точные сигнатуры GamePush SDK (init, как достать нативный id) помечены
// VERIFY-комментариями — сверить со сниппетом из панели GamePush на первом тесте.

import { getApiBase } from "./Api";
import { platformAuthHeaders, setPlatformContext } from "./PlatformContext";
import { isItchEmbed } from "./Utils";
// ⚠️ Шина звука — ТОЛЬКО статическим импортом. Динамический import() здесь
// давал ВТОРУЮ копию модуля в бандле: SDK писал мут в одну, плееры
// регистрировались в другой — «Музыка выключена» из панели не доходила до
// лобби (поймано зондом на стенде 01.08). Howler и так в главном чанке,
// статический импорт ничего не тяжелит.
import {
  platformTrackEvent,
  setPlatformReporter,
  setTransientAll,
  syncFromPlatform,
} from "./sound/AudioBus";

// terron 25.08.2026: ПАРАМЕТРЫ ЗАПУСКА ПЛОЩАДКИ — снимок на импорте модуля.
//
// ВК подмешивает в адрес игры `vk_user_id`, `vk_app_id` и подпись `sign` (по ним
// же GamePush и опознаёт площадку — сверено с их бандлом). Это ЕДИНСТВЕННОЕ
// место, где виден НАСТОЯЩИЙ id игрока ВКонтакте: `gp.player.id` — внутренний
// номер GamePush, который умрёт вместе с агрегатором.
//
// ⚠️ Снимаем НА ИМПОРТЕ, а не по требованию: наш роутер чистит адресную строку
// (`history.replaceState`) через доли секунды после старта, и к моменту входа
// параметров там уже нет.
const LAUNCH_PARAMS: URLSearchParams = (() => {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
})();

/**
 * Площадки, на которых аккаунт TERRON заводится САМ, без клика «Войти».
 *
 * Базово это те, где игрок авторизован всегда и окна входа не существует в
 * принципе (таблица «Always Authenticated» у GamePush) — там ему просто нечего
 * нажать, и без этого он оставался вечным гостем (замечание модерации ВК
 * 25.08.2026).
 *
 * ⚠️ ЯНДЕКС ДОБАВЛЕН ПОЗЖЕ И ПО ДРУГОЙ ПРИЧИНЕ (решение владельца 25.08.2026):
 * там кнопка входа возможна, но вход всё равно бесшовный — залогиненного в
 * Яндексе игрока площадка отдаёт нам сама. Прежнее правило «молча не заводим»
 * (31.07) держалось на том, что аккаунт появлялся «без единого действия»; на
 * живых площадках это оказалось помехой игроку, а не защитой.
 * ⚠️ Гостя это не задевает: гейт стоит на `isPlayerLoggedIn()` — не вошёл в
 * Яндекс, значит и аккаунта не будет.
 * ⚠️ Правило «вышел сам — тихо не перезаходим» (31.07) продолжает работать
 * поверх этого списка: см. autoLoginSuppressed().
 */
const ALWAYS_AUTHORIZED_PLATFORMS = new Set([
  "VK",
  "YANDEX",
  "OK",
  "TELEGRAM",
  "FOTOSTRANA",
  "PLAYDECK",
  "BEELINE",
]);

// Public-креды (projectId/publicToken) живут в index.html — GamePush требует свой
// сниппет ДО </body> с callback=onGPInit (см. index.html). Здесь только потребляем
// готовый инстанс через window.__gpReady.

interface GPPlayer {
  id: string | number;
  // ⚠️ getField отдаёт ОПИСАНИЕ поля, значение — только через get (проверено).
  getField(name: string): unknown;
  get?(name: string): unknown;
  // Набор полей проекта, заданный в панели GamePush (score/name/avatar + свои).
  fields?: { key?: string }[];
  // Облачное сохранение площадки: set пишет поле локально, sync отправляет на
  // сервер GamePush (чек-лист модерации: «прогресс сохраняется/загружается»).
  set?(name: string, value: unknown): void;
  sync?(options?: { override?: boolean }): Promise<unknown>;
  // Синхронизация игрока площадки с сервером GamePush. player.* трогаем ТОЛЬКО
  // после её резолва (док: «await gp.player.ready»).
  ready?: Promise<unknown>;
  // Авторизация СРЕДСТВАМИ ПЛОЩАДКИ (требование модерации: внутри iframe своей
  // формы входа быть не должно). Резолвится true, если игрок вошёл.
  login?(options?: { withSecretCode?: boolean }): Promise<boolean>;
  isLoggedIn?: boolean;
  // Вошёл именно через площадку (а не через код GamePush).
  isLoggedInByPlatform?: boolean;
  // Имя аккаунта на площадке (у гостя пусто).
  name?: string;
  // Ссылка на аватарку площадки (ВК отдаёт её всегда, у гостя пусто).
  avatar?: string;
  // Выход из аккаунта площадки (docs/authorization/api). Требование модерации:
  // кнопка «выйти» в игре обязана дёргать ИМЕННО его, иначе площадка считает
  // игрока вошедшим, а игра — нет.
  logout?(): Promise<unknown>;
}
interface GPInstance {
  player: GPPlayer;
  isDev?: boolean;
  // GamePush умеет дёргать нативный SDK площадки (для Яндекса → getUniqueID).
  callNativeSDK?(method: string): Promise<unknown>;
  // terron: обязательные по чек-листу модерации GamePush методы жизненного цикла.
  // gameStart — «игра загрузилась, меню готово» (аналог Yandex LoadingAPI.ready).
  // gameplayStart/Stop — границы РАУНДА (для POKI/CrazyGames обязательны, для
  // остальных площадок — корректная аналитика и пауза рекламы).
  gameStart?(): void;
  gameplayStart?(): void;
  gameplayStop?(): void;
  // Язык площадки (ISO 639-1). Чек-лист: язык берём ИЗ SDK, а не из браузера.
  language?: string;
  /** Сменить язык на площадке (docs/get-start/common-features). */
  changeLanguage?(iso: string): void;
  // ⚠️ ЗВУК ЖИВЁТ В ОТДЕЛЬНОМ МОДУЛЕ `gp.sounds` — и события, и флаги. Раньше
  // мы слушали ядро `gp` и читали `gp.isMuted`, которых там нет: игра не
  // реагировала на «Все звуки выключены» из панели (замечание модерации 30.07,
  // повторное). Имена сверены с бандлом SDK: bindEventsWithName(gp.sounds,
  // ["mute","unmute","mute:music","unmute:music","mute:sfx","unmute:sfx"]).
  sounds?: {
    on?(event: string, cb: (...args: unknown[]) => void): void;
    isMuted?: boolean;
    isMusicMuted?: boolean;
    isSFXMuted?: boolean;
    // Обратный канал (ТЗ владельца): наши тумблеры меняют настройки GamePush.
    muteMusic?(): void;
    unmuteMusic?(): void;
    muteSFX?(): void;
    unmuteSFX?(): void;
  };
  /** Их localStorage; `_gs_sounds` — СОХРАНЁННЫЕ настройки звука игрока
   *  (персистентный юзер-слой, в отличие от публичных флагов с временными
   *  мутами поверх). Ключ сверен с бандлом SDK. */
  _storage?: {
    getLocalRaw?(key: string): Promise<unknown>;
  };
  // События ядра: mute/unmute (+ :music/:sfx) и pause/resume — площадка просит
  // заглушить звук (реклама, сворачивание). Чек-лист: звук управляется SDK.
  on?(event: string, cb: (...args: unknown[]) => void): void;
  // Реклама. Свои события: fullscreen:start/close, rewarded:start/close/reward,
  // preloader:start/close (имена сверены с исходником SDK, не угаданы).
  ads?: {
    on?(event: string, cb: (...args: unknown[]) => void): void;
    // Показ рекламы. Preloader — на загрузке (до меню), rewarded — за награду.
    showPreloader?(): void;
    showFullscreen?(): void;
    showRewardedVideo?(): void;
    showSticky?(): void;
    closeSticky?(): void;
    isRewardedAvailable?: boolean;
    isPreloaderAvailable?: boolean;
    isStickyAvailable?: boolean;
  };
  /** Приложение: ярлык на рабочий стол, отзыв (docs/application). */
  app?: {
    canAddShortcut?: boolean;
    addShortcut?(): Promise<boolean>;
    requestReview?(): Promise<{ success?: boolean; rating?: number }>;
  };
  /** Пауза средствами площадки (docs/get-start/common-features). */
  pause?(): void;
  resume?(): void;
  /** Полноэкранный режим средствами SDK (события change/open/close). */
  fullscreen?: {
    isEnabled?: boolean;
    open?(): void;
    close?(): void;
    on?(event: string, cb: () => void): void;
  };
  // Возможности площадки — чек-лист требует ПРЯТАТЬ то, что площадка не тянет.
  platform?: {
    type?: string;
    isExternalLinksAllowed?: boolean;
    isBackendAllowed?: boolean;
    /** SDK самой площадки (для Яндекса — YaGames). В песочнице GamePush его нет. */
    getNativeSDK?: () => Promise<unknown>;
    /** Площадка авторизует сама (нативная модалка). */
    _hasAuthModal?: boolean;
    /** Есть встроенный оверлей авторизации GamePush. */
    hasIntegratedAuth?: boolean;
    /** Вход по секретному коду GamePush (запасной путь на площадках без своей авторизации). */
    isSecretCodeAuthAvailable?: boolean;
    /** Площадка умеет разлогинивать (docs/authorization/api). */
    isLogoutAvailable?: boolean;
  };
}

declare global {
  interface Window {
    // Ставится инлайн-сниппетом в index.html: onGPInit(gp) резолвит __gpReady.
    onGPInit?: (gp: GPInstance) => void;
    __gp?: GPInstance;
    __gpReady?: Promise<GPInstance>;
  }
}

// Локальная копия прогресса, зеркалимого в игрока площадки (см. loadProgress).
const PROGRESS_KEY = "terron_gp_progress";

class GamePushSDKImpl {
  private gp: GPInstance | null = null;
  private initStarted = false;

  /** Внутри iframe площадки? На terron.io/Capacitor — false (no-op). */
  isOnPlatform(): boolean {
    if (typeof window === "undefined") return false;
    // itch.io — чужой iframe, но НЕ площадка GamePush: их реклама, аналитика,
    // управление звуком и «вход через площадку» там неуместны (решение владельца
    // 17.08). Сниппет SDK туда и не грузится (гейт в index.html) — это второй
    // рубеж на случай, если __gpReady появится другим путём.
    if (isItchEmbed()) return false;
    try {
      return window.self !== window.top;
    } catch {
      return true; // cross-origin top → мы во чужом iframe (площадка).
    }
  }

  /** ⚠️ ЗАЩИТА ОТ ЧУЖОГО btoa НА КИРИЛЛИЦЕ. SDK площадки кладёт данные игрока
   *  в заголовок запроса через `btoa(JSON.stringify(...))` — а btoa умеет
   *  только Latin-1 и на русском имени бросает «characters outside of the
   *  Latin1 range» (видно в песочнице, скриншот владельца 31.07). Их запрос
   *  после этого уходит БЕЗ данных игрока. Русские ники на Яндексе — норма,
   *  так что подстилаем соломку: если строка не лезет в Latin-1, кодируем её
   *  как UTF-8 (ровно так делает их же код в другом месте бандла). ASCII
   *  проходит байт-в-байт, поведение не меняется. Пишем в консоль ОДИН раз со
   *  стеком — чтобы было видно, чей это вызов.
   *  Ставится только внутри площадки; на terron.io btoa не трогаем. */
  private hardenBtoa(): void {
    if (typeof window === "undefined" || this.btoaHardened) return;
    this.btoaHardened = true;
    const orig = window.btoa?.bind(window);
    if (!orig) return;
    let reported = false;
    window.btoa = (s: string) => {
      try {
        return orig(s);
      } catch (e) {
        if (!reported) {
          reported = true;
          console.warn(
            "[gp] чужой btoa захлебнулся не-Latin1 — кодируем как UTF-8",
            new Error("btoa trace").stack,
          );
        }
        return orig(
          Array.from(new TextEncoder().encode(s), (b) =>
            String.fromCharCode(b),
          ).join(""),
        );
      }
    };
  }
  private btoaHardened = false;

  /** Дождаться готового gp. Идемпотентно, безопасно вызывать всегда. Реальную
   *  загрузку/инициализацию SDK делает сниппет в index.html (только в iframe
   *  площадки) — здесь мы лишь ждём его callback и синхронизацию игрока. */
  async maybeInit(): Promise<void> {
    if (this.gp || this.initStarted) return;
    if (!this.isOnPlatform()) return;
    this.initStarted = true;
    this.hardenBtoa();
    const ready = window.__gpReady;
    if (!ready) return; // сниппет не грузился (не на площадке) — тихо выходим
    try {
      const gp = await ready; // onGPInit(gp) из index.html
      // ЖДЁМ синхронизацию игрока площадки с сервером ДО любого чтения player.*
      // (иначе «обращение к СДК раньше инициализации»). Док GamePush.
      if (gp.player?.ready) {
        try {
          await gp.player.ready;
        } catch {
          /* синк не удался — продолжаем гостем */
        }
      }
      this.gp = gp;
      console.log("[gp] SDK готов, платформа:", gp.platform?.type ?? "?");
      // Контекст сессии: с этого момента запросы авторизации идут в куку
      // ПЛОЩАДКИ, а не сайта (см. PlatformContext + auth/cookies.ts).
      setPlatformContext(gp.platform?.type);
      // Какой вход умеет площадка — иначе «почему нет кнопки» разбирается вслепую.
      console.log("[gp] вход:", {
        своя_модалка: gp.platform?._hasAuthModal ?? false,
        оверлей: gp.platform?.hasIntegratedAuth ?? false,
        по_коду: gp.platform?.isSecretCodeAuthAvailable ?? false,
      });
      this.wirePlatformSound();
      this.wirePlatformAds();
      this.wirePlatformLanguage();
      this.wirePlatformLogin();
      this.wirePlatformFullscreen();
      this.applyPlatformCapabilities();
      // Прогресс — сразу после player.ready: чек-лист требует, чтобы игра
      // ЗАГРУЖАЛА сохранённое на старте, а не только писала.
      this.loadProgress();
      void this.syncSessionWithPlatform();
      this.watchSessionMismatch();
      // Экраны, нарисованные до готовности SDK (аккаунт с кнопкой входа),
      // перерисовываются по этому сигналу.
      window.dispatchEvent(new CustomEvent("gp-ready"));
    } catch (e) {
      console.error("[gp] init failed:", e);
    }
  }

  /** Чек-лист модерации: «игра загрузилась» (аналог Yandex LoadingAPI.ready).
   *  Зовётся, когда меню реально готово. Идемпотентно. */
  gameStart(): void {
    if (this.gameStartSent) return;
    this.gameStartSent = true;
    try {
      this.gp?.gameStart?.();
      console.log("[gp] gameStart() отправлен");
    } catch (e) {
      console.warn("[gp] gameStart failed:", e);
    }
  }
  private gameStartSent = false;
  private gameplayActive = false;

  /** Границы РАУНДА — площадка ставит рекламу/аналитику вокруг геймплея. */
  gameplayStart(): void {
    // Парность границ раунда. Без флага двойной старт накручивал бы счётчик
    // сыгранных партий (recordMatchStarted ниже), а двойной стоп уходил бы
    // площадке уже после закрытого раунда.
    if (this.gameplayActive) return;
    this.gameplayActive = true;
    try {
      this.gp?.gameplayStart?.();
    } catch (e) {
      console.warn("[gp] gameplayStart failed:", e);
    }
    // Прогресс считаем В НАЧАЛЕ матча, а не только в конце. Причина: чек
    // «Progress should be saved» модерация ловит по РЕАЛЬНОМУ изменению полей
    // игрока. Пока счётчик стоит на 0 (партия не доиграна), sync уходит с тем же
    // значением — площадке нечего фиксировать, и проверяющий (который матч до
    // конца не играет) галку не увидит. Заход в игру = «партия начата» — это и
    // честная семантика score, и мгновенно видимое сохранение.
    this.recordMatchStarted();
  }
  gameplayStop(): void {
    if (!this.gameplayActive) return;
    this.gameplayActive = false;
    try {
      this.gp?.gameplayStop?.();
    } catch (e) {
      console.warn("[gp] gameplayStop failed:", e);
    }
  }

  /** Язык площадки (ISO 639-1) — чек-лист требует брать ИЗ SDK, не из браузера.
   *  null вне площадки → зовущий падает на свою логику (браузер/localStorage).
   *  ⚠️ ЧИТАЕМ ТОЛЬКО СВОЙ `this.gp` — инстанс, полученный ПОСЛЕ `onGPInit` и
   *  `await player.ready`. Раньше здесь был синхронный `window.__gp` «чтобы не
   *  ждать синк игрока» — именно на него ругнулась модерация 17.08 («код
   *  инициализации иногда пускает к вызову методов СДК до его инициализации»).
   *  Стартовый язык теперь берётся через `platformLanguageReady()` (ждёт SDK). */
  platformLanguage(): string | null {
    // ⚠️ В плеере itch.io НИКАКОЙ ПЛОЩАДКИ НЕТ, но сниппет GamePush в index.html
    // грузится безусловно и всё равно отдаёт язык — браузерный. На англоязычной
    // витрине это перебивало наш EN-дефолт УЖЕ ПОСЛЕ отрисовки меню (репорт
    // владельца 17.08: «сам меняется с английского на русский без перезагрузки»),
    // потому что applyPlatformLanguage догоняет язык после init SDK.
    if (isItchEmbed()) return null;
    const raw = this.gp?.language;
    if (typeof raw !== "string" || raw.length === 0) return null;
    return raw.toLowerCase().slice(0, 2);
  }

  /** Язык площадки для СТАРТА UI: дожидается инициализации SDK, а не лезет в
   *  window.__gp раньше времени. Порядок ровно как в их доке: `onGPInit(gp)`
   *  (его резолвит `__gpReady`) → `await gp.player.ready` → только потом читаем.
   *  Потолок ожидания — чтобы залипший SDK не держал меню: не успел за
   *  `timeoutMs`, стартуем на своём языке, а площадка догонит через
   *  `applyPlatformLanguage()` (он же ловит и последующий `change:language`). */
  async platformLanguageReady(timeoutMs = 1500): Promise<string | null> {
    if (!this.isOnPlatform()) return null;
    const ready = typeof window !== "undefined" ? window.__gpReady : null;
    if (!ready) return null; // сниппет не грузился — площадки нет
    const expired = Symbol("gp-lang-timeout");
    const withCap = <T>(p: Promise<T>) =>
      Promise.race([
        p.catch(() => expired),
        new Promise((r) => setTimeout(() => r(expired), timeoutMs)),
      ]);
    const gp = await withCap(ready);
    if (!gp || gp === expired) return null;
    const inst = gp as GPInstance;
    if (inst.player?.ready) await withCap(inst.player.ready);
    const raw = inst.language;
    if (typeof raw !== "string" || raw.length === 0) return null;
    return raw.toLowerCase().slice(0, 2);
  }

  /** Догнать язык площадки, если SDK инициализировался ПОЗЖЕ старта UI.
   *  ⚠️ ВНУТРИ ПЛОЩАДКИ ЯЗЫК ПРИ ЗАГРУЗКЕ ВСЕГДА ИЗ SDK — сохранённый
   *  localStorage.lang его НЕ перебивает (чек-лист: «язык определяется из
   *  SDK»; репорт владельца 31.07 — эмулировал ru, а грузился en, потому что
   *  в localStorage застрял en от прежних заходов). Ручной выбор в сессии
   *  работает до следующей загрузки. Вне площадки этот код не зовётся —
   *  там localStorage главный, как и был. */
  applyPlatformLanguage(): void {
    try {
      const lang = this.platformLanguage();
      if (!lang) return;
      window.dispatchEvent(
        new CustomEvent("language-selected", { detail: { lang } }),
      );
      // language-selected пишет lang в localStorage — снимаем, чтобы это не
      // считалось ЯВНЫМ выбором игрока (иначе площадка перестанет управлять).
      localStorage.removeItem("lang");
      console.log("[gp] язык площадки применён:", lang);
    } catch (e) {
      console.warn("[gp] applyPlatformLanguage failed:", e);
    }
  }

  /** Площадка может сменить язык В ЛЮБОЙ МОМЕНТ, БЕЗ перезагрузки iframe:
   *  `gp.changeLanguage(x)` меняет gp.language и эмитит `change:language`
   *  (проверено по исходнику SDK). Именно так работает переключатель языка в
   *  песочнице модерации — если не слушать событие, игра остаётся на старом
   *  языке и чек «Language should be detected by the SDK» проваливается вживую.
   *  Здесь команда ПЛОЩАДКИ главнее сохранённого выбора игрока (в отличие от
   *  старта, где localStorage уважается) — это явное переключение снаружи. */
  private wirePlatformLanguage(): void {
    if (typeof this.gp?.on !== "function") return;
    try {
      this.gp.on("change:language", (raw?: unknown) => {
        const next =
          typeof raw === "string" && raw.length > 0
            ? raw
            : this.platformLanguage();
        if (!next) return;
        const lang = next.toLowerCase().slice(0, 2);
        window.dispatchEvent(
          new CustomEvent("language-selected", { detail: { lang } }),
        );
        // Не считаем это ЯВНЫМ выбором игрока — площадка сохраняет управление.
        try {
          localStorage.removeItem("lang");
        } catch {
          /* приватный режим — не критично */
        }
        console.log("[gp] площадка сменила язык:", lang);
      });
    } catch (e) {
      console.warn("[gp] wirePlatformLanguage failed:", e);
    }
  }

  /** Игрок может войти не через нашу кнопку, а сам (площадка показала своё окно).
   *  SDK эмитит `login` с флагом успеха — ловим и догоняем: id игрока сменился
   *  с гостевого на аккаунтный, надо перечитать прогресс и поднять нашу сессию. */
  private wirePlatformLogin(): void {
    const player = this.gp?.player as
      | (GPPlayer & { on?: (e: string, cb: (ok: unknown) => void) => void })
      | undefined;
    const bind = player?.on ?? this.gp?.on;
    if (typeof bind !== "function") return;
    try {
      // Игрок вышел на СТОРОНЕ ПЛОЩАДКИ — наша сессия живёт отдельно (своя
      // refresh-кука) и об этом не узнает: игра продолжала считать его
      // авторизованным (замечание модерации 30.07). Гасим свою сессию следом.
      bind.call(player?.on ? player : this.gp, "logout", () => {
        console.log("[gp] игрок вышел на площадке — гасим свою сессию");
        this.noteLoginEvent("площадка: выход");
        void this.dropOurSession();
      });
      bind.call(player?.on ? player : this.gp, "login", (ok: unknown) => {
        if (ok === false) {
          this.noteLoginEvent("площадка: вход отменён");
          return;
        }
        this.noteLoginEvent("площадка: вход");
        console.log("[gp] игрок вошёл через площадку");
        this.clearExplicitLogout(); // вход на площадке = явное намерение
        this.loadProgress();
        void this.loginToBackend();
        window.dispatchEvent(new CustomEvent("gp-login"));
      });
    } catch (e) {
      console.warn("[gp] wirePlatformLogin failed:", e);
    }
  }

  /** Чек-лист: звук управляется методами SDK. Площадка шлёт mute/unmute (реклама,
   *  сворачивание вкладки) и pause/resume.
   *  terron 29.07: события идут ПО ДОРОЖКАМ — `mute:music` и `mute:sfx` помимо
   *  общего `mute` (у нас в настройках тоже две галочки), поэтому подписываемся
   *  на все три и глушим ровно то, о чём попросили. Требование чек-листа:
   *  «подвязывайтесь к общему муту; если дорожки разделены — к mute SFX и/или
   *  музыки». Пользовательские галочки не трогаем: mute накладывается поверх. */
  private wirePlatformSound(): void {
    const setMuted = (muted: boolean, kind: "all" | "music" | "sfx") => {
      // Мгновенно реагируем ТОЛЬКО на общий mute/unmute (пауза, реклама) —
      // это временный слой. Дорожечные события напрямую не применяем: сторож
      // выводит состояние из их сохранённых настроек + публичных флагов
      // (AudioBus v2) — событие просто подталкивает его.
      if (kind === "all") setTransientAll(muted);
      else platformTrackEvent(kind, muted);
    };
    // Слушаем и модуль звука, и ядро: события живут в `gp.sounds`, но пауза
    // вкладки приходит на `gp`. Лишняя подписка безвредна — вызовы идемпотентны.
    const targets = [this.gp?.sounds, this.gp];
    try {
      for (const t of targets) {
        if (typeof t?.on !== "function") continue;
        t.on("mute", () => setMuted(true, "all"));
        t.on("unmute", () => setMuted(false, "all"));
        t.on("mute:music", () => setMuted(true, "music"));
        t.on("unmute:music", () => setMuted(false, "music"));
        t.on("mute:sfx", () => setMuted(true, "sfx"));
        t.on("unmute:sfx", () => setMuted(false, "sfx"));
      }
      // Чек-лист «Pause handling»: площадка сворачивает игру → она должна ВСТАТЬ.
      // Останавливать умеем там, где симуляция наша (одиночка/обучение/реплей).
      this.gp?.on?.("pause", () => {
        setMuted(true, "all");
        this.emitGamePause(true);
      });
      this.gp?.on?.("resume", () => {
        setMuted(false, "all");
        this.emitGamePause(false);
      });

      // ⚠️ СОСТОЯНИЕ, А НЕ ТОЛЬКО СОБЫТИЯ. Модерация ставит «все звуки
      // выключены» в панели ДО загрузки игры: SDK поднимает флаг из своего
      // хранилища асинхронно и события при этом НЕ эмитит. Плюс сама панель
      // может менять флаги в обход событий — поэтому не только читаем на
      // старте, но и СЛЕДИМ за ними: короткий опрос дешевле, чем гадать, каким
      // путём площадка их поменяла.
      void this.syncMuteState();
      this.startMuteWatch();
      // ТЗ владельца: мут из игры меняет настройки GamePush. Их методы пишут
      // их сохранённые настройки; эхо сходится по равенству в стороже.
      setPlatformReporter((track, muted) => {
        const sounds = this.gp?.sounds;
        if (!sounds) return;
        if (track === "music") {
          (muted ? sounds.muteMusic : sounds.unmuteMusic)?.call(sounds);
        } else {
          (muted ? sounds.muteSFX : sounds.unmuteSFX)?.call(sounds);
        }
      });
    } catch (e) {
      console.warn("[gp] sound wiring failed:", e);
    }
  }

  /** Сторож состояния звука: раз в секунду сверяем флаги площадки со своими.
   *  Чтение трёх булевых полей — операция копеечная, зато ловит любой путь,
   *  которым площадка (или её панель отладки) поменяла звук. */
  private muteWatch: number | null = null;
  private startMuteWatch(): void {
    if (this.muteWatch !== null) return;
    this.muteWatch = window.setInterval(() => void this.syncMuteState(), 1000);
  }

  /**
   * Идёт реклама — убираем СВОИ оверлеи с дороги.
   * Ролик площадка рисует в РОДИТЕЛЬСКОМ окне, поверх нашего iframe, но наши
   * модалки (экран смерти, HUD) сидят выше по слою внутри iframe и закрывали
   * его собой: игрок видел рекламу узкой рамкой по краям (репорт владельца
   * 30.07). Скрываем на время показа классом на <html> — снимается по
   * *:close, а если площадка почему-то не пришлёт событие, страховкой служит
   * 90-секундный таймаут показа rewarded.
   */
  private setAdOpen(open: boolean): void {
    try {
      document.documentElement.classList.toggle("gp-ad-open", open);
    } catch {
      /* ignore */
    }
  }

  /** Привести звук игры к тому, что сейчас у площадки. Идемпотентно. */
  private async syncMuteState(): Promise<void> {
    const snd = this.gp?.sounds;
    if (!snd) return;
    // Два источника SDK: СОХРАНЁННЫЕ настройки игрока (их localStorage) и
    // публичные флаги (настройки + временные муты пауз/рекламы/«Все звуки»
    // поверх). Никакой памяти: всё выводится заново каждый тик — залипнуть
    // нечему (уроки 01.08 в AudioBus.ts).
    let stored: { music: boolean; sfx: boolean } | null = null;
    try {
      const raw = (await this.gp?._storage?.getLocalRaw?.("_gs_sounds")) as {
        isMusicMuted?: boolean;
        isSFXMuted?: boolean;
      } | null;
      if (raw && typeof raw === "object") {
        stored = {
          music: raw.isMusicMuted === true,
          sfx: raw.isSFXMuted === true,
        };
      }
    } catch {
      /* хранилище недоступно — деградируем ниже */
    }
    const pub = {
      music: snd.isMusicMuted === true,
      sfx: snd.isSFXMuted === true,
    };
    // Хранилище не прочиталось → считаем публичные флаги настройками
    // (временный слой не отличим, но и залипнуть он не может).
    syncFromPlatform(stored ?? pub, pub);
  }

  /** Чек-лист модерации, два обязательных пункта: прогресс СОХРАНЯЕТСЯ в игрока
   *  площадки и КОРРЕКТНО ЗАГРУЖАЕТСЯ на старте. Наш «настоящий» прогресс живёт
   *  на нашем бэкенде (ключ = нативный id площадки), но площадка обязана видеть
   *  его в своих полях — иначе облачное сохранение/лидерборды площадки пустые.
   *  Зеркалим счётчики, доступные всегда (и гостю, и офлайн): score = сыгранных
   *  матчей (растёт в ЛЮБОЙ сессии → модератор увидит изменение), wins = побед,
   *  но только если такое поле заведено в панели GamePush (у проекта 28774 сейчас
   *  есть лишь score/name/avatar — набор полей читаем из player.fields, лишнее не
   *  пишем: set по незаведённому полю площадка молча игнорирует).
   *  ⚠️ ГРАБЛЯ API: player.getField(key) отдаёт ОПИСАНИЕ поля (name/type/default),
   *  а не значение — значение берётся player.get(key). Проверено в iframe на проде.
   *  Локальная копия в localStorage — источник правды между сессиями; при заходе
   *  берём МАКСИМУМ (площадка могла сохранить больше с другого устройства). */
  private progress(): { played: number; won: number } {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      const p = raw ? JSON.parse(raw) : null;
      return {
        played: Number(p?.played) || 0,
        won: Number(p?.won) || 0,
      };
    } catch {
      return { played: 0, won: 0 };
    }
  }

  private writeProgress(p: { played: number; won: number }): void {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    } catch {
      /* приватный режим / переполнение — прогресс площадки всё равно отправим */
    }
  }

  /** Загрузка прогресса из площадки (после player.ready). Берём максимум с
   *  локальным — так «свежее устройство» подтягивает облако, а офлайн-прогресс
   *  не затирается пустым облаком. */
  private loadProgress(): void {
    const player = this.gp?.player;
    if (!player?.get) return;
    try {
      const local = this.progress();
      const cloudPlayed = Number(player.get("score")) || 0;
      const cloudWon = this.hasField("wins")
        ? Number(player.get("wins")) || 0
        : 0;
      const merged = {
        played: Math.max(local.played, cloudPlayed),
        won: Math.max(local.won, cloudWon),
      };
      this.writeProgress(merged);
      console.log("[gp] прогресс загружен:", merged);
      // Разовый save сразу после загрузки: гонит set+sync на площадку НЕ дожидаясь
      // конца матча. Иначе чек «Progress should be saved» модерация не засекает —
      // она ловит его по факту сетевого sync(), а мы раньше писали только на
      // trackMatchOutcome (нужно доиграть партию). Значения не меняются (merged
      // уже записан) → облако не портим, просто отмечаемся.
      this.saveProgress();
    } catch (e) {
      console.warn("[gp] loadProgress failed:", e);
    }
  }

  /** Матч НАЧАТ (из gameplayStart): +1 к сыгранным, сразу в облако площадки. */
  private recordMatchStarted(): void {
    const p = this.progress();
    p.played += 1;
    this.writeProgress(p);
    this.saveProgress();
  }

  /** Матч ЗАКОНЧИЛСЯ — фиксируем победу. `played` здесь НЕ трогаем: он уже
   *  посчитан в gameplayStart, иначе матч учёлся бы дважды. Зовётся из
   *  Analytics.trackMatchOutcome (единая точка исхода матча). */
  recordMatch(won: boolean): void {
    if (!won) return; // поражение/выход уже учтены инкрементом на старте
    const p = this.progress();
    p.won += 1;
    this.writeProgress(p);
    this.saveProgress();
  }

  /** Чек-лист (Required): «звук глушится, когда начинается реклама». Событий два
   *  семейства — общие mute/pause на ядре (wirePlatformSound) и СОБСТВЕННЫЕ
   *  события рекламы на gp.ads. Имена сверены с исходником SDK:
   *    fullscreen:start/close, rewarded:start/close, preloader:start/close.
   *  Вешаемся и на gp.ads, и на gp (разные площадки эмитят по-разному; повторный
   *  мьют идемпотентен). Реклама кончилась → звук возвращаем. */
  /** PRELOADER — реклама на загрузке (чек-лист: «вызов при старте игры»).
   *  Игра в это время грузится фоном, так что показ ничего не задерживает.
   *  Идемпотентно: один раз на страницу. Вне площадки — no-op. */
  showPreloaderAd(): void {
    if (this.preloaderShown) return;
    this.preloaderShown = true;
    try {
      this.gp?.ads?.showPreloader?.();
    } catch (e) {
      console.warn("[gp] showPreloader failed:", e);
    }
  }
  private preloaderShown = false;

  /** REWARDED — «посмотри ролик, получи награду». Показывается на экране итогов
   *  матча (удвоение заработка). Резолвится true ТОЛЬКО если площадка прислала
   *  `rewarded:reward`; закрыл ролик раньше / рекламы нет → false, награду не
   *  выдаём. Таймаут 90с — чтобы кнопка не висела вечно, если площадка молчит. */
  showRewardedAd(): Promise<boolean> {
    const ads = this.gp?.ads;
    if (!ads?.showRewardedVideo) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let done = false;
      let closeTimer: number | null = null;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        if (closeTimer !== null) clearTimeout(closeTimer);
        resolve(ok);
      };
      // ⚠️ ЗАКРЫТИЕ МОЖЕТ ПРИЙТИ РАНЬШЕ НАГРАДЫ. Игрок досматривает ролик и
      // жмёт «CLOSE AD» — площадка сначала шлёт `rewarded:close`, а `…:reward`
      // следом. Отвечая по первому событию, мы говорили «ролик не досмотрен»
      // ровно тогда, когда сама площадка рапортовала «successful watch»
      // (репорт владельца 30.07). Поэтому на закрытии выжидаем грейс: пришла
      // награда — засчитываем, промолчали — только тогда отказ.
      const CLOSE_GRACE_MS = 1500;
      const onReward = () => finish(true);
      const onClose = () => {
        if (done || closeTimer !== null) return;
        closeTimer = window.setTimeout(() => finish(false), CLOSE_GRACE_MS);
      };
      try {
        // Слушаем ОБА источника: SDK форвардит свои события и на gp.ads, и на
        // само ядро gp — разные площадки шлют по-разному.
        for (const t of [ads, this.gp]) {
          t?.on?.("rewarded:reward", onReward);
          t?.on?.("rewarded:close", onClose);
        }
        ads.showRewardedVideo?.();
      } catch (e) {
        console.warn("[gp] showRewardedVideo failed:", e);
        finish(false);
      }
      setTimeout(() => finish(false), 90_000);
    });
  }

  /** Доступна ли rewarded-реклама сейчас (кнопку «×2» без неё не рисуем). */
  isRewardedAvailable(): boolean {
    return this.gp?.ads?.isRewardedAvailable === true;
  }

  /**
   * STICKY-баннер — ТОЛЬКО В МЕНЮ (решение владельца 29.07: «в слоты, где у
   * оригинала висел AdSense»). Позицию баннера задаёт САМА площадка — это её
   * оверлей, а не наш DOM-элемент, поэтому «повесить слева» мы не можем;
   * управляем только тем, КОГДА он висит.
   * В матче закрываем: карта на весь экран, баннер поверх неё мешал бы игре.
   *
   * ⚠️ Владелец допускает, что позже баннер закомментируем — тогда достаточно
   * убрать два вызова showStickyAd()/hideStickyAd() из Main.ts, сам метод
   * трогать не нужно.
   */
  showStickyAd(): void {
    if (this.gp?.ads?.isStickyAvailable !== true) return;
    try {
      this.gp.ads.showSticky?.();
    } catch (e) {
      console.warn("[gp] showSticky failed:", e);
    }
  }

  hideStickyAd(): void {
    try {
      this.gp?.ads?.closeSticky?.();
    } catch (e) {
      console.warn("[gp] closeSticky failed:", e);
    }
  }

  private wirePlatformAds(): void {
    const setMuted = (muted: boolean) => {
      setTransientAll(muted); // реклама = временный общий мут
    };
    const START = ["fullscreen:start", "rewarded:start", "preloader:start"];
    const END = ["fullscreen:close", "rewarded:close", "preloader:close"];
    const targets = [this.gp?.ads, this.gp];
    for (const t of targets) {
      if (typeof t?.on !== "function") continue;
      try {
        for (const ev of START) {
          t.on(ev, () => {
            setMuted(true);
            this.emitGamePause(true); // чек-лист: реклама = игра на паузе
            this.setAdOpen(true);
          });
        }
        for (const ev of END) {
          t.on(ev, () => {
            setMuted(false);
            this.emitGamePause(false);
            this.setAdOpen(false);
          });
        }
      } catch (e) {
        console.warn("[gp] ads wiring failed:", e);
      }
    }
  }

  /** Просьба площадки остановить/продолжить игру. Само событие ничего не решает:
   *  слушатель ставит паузу только там, где симуляция локальная (одиночка,
   *  обучение, реплей) и только если игрок не поставил паузу сам. */
  private emitGamePause(paused: boolean): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("gp-platform-pause", { detail: paused }),
    );
  }

  /** Чек-лист: возможности, которых у площадки нет, нужно ПРЯТАТЬ. Флаги отдаёт
   *  сама площадка — вешаем классы на <html>, прячет CSS (terron-theme.css):
   *    isExternalLinksAllowed=false → gp-no-external (внешние ссылки: telegram,
   *      Google Play, App Store — часть площадок запрещает уводить игрока);
   *    isBackendAllowed=false → gp-no-backend (лидерборды/рейтинг/досье).
   *  Флаг только явный false: undefined = площадка не ограничивает. */
  private applyPlatformCapabilities(): void {
    const p = this.gp?.platform;
    if (!p) return;
    try {
      const root = document.documentElement;
      if (p.isExternalLinksAllowed === false)
        root.classList.add("gp-no-external");
      if (p.isBackendAllowed === false) root.classList.add("gp-no-backend");
      console.log("[gp] возможности площадки:", {
        externalLinks: p.isExternalLinksAllowed,
        backend: p.isBackendAllowed,
      });
    } catch (e) {
      console.warn("[gp] applyPlatformCapabilities failed:", e);
    }
  }

  /** Есть ли поле с таким ключом в проекте GamePush (набор задан в панели). */
  private hasField(key: string): boolean {
    const fields = this.gp?.player?.fields;
    return Array.isArray(fields) && fields.some((f) => f?.key === key);
  }

  /** Отправка прогресса в игрока площадки. Вне площадки — no-op. */
  saveProgress(): void {
    const player = this.gp?.player;
    if (!player?.set || !player.sync) return;
    const p = this.progress();
    try {
      player.set("score", p.played);
      if (this.hasField("wins")) player.set("wins", p.won);
      void Promise.resolve(player.sync())
        .then(() => console.log("[gp] прогресс сохранён:", p))
        .catch((e) => console.warn("[gp] sync failed:", e));
    } catch (e) {
      console.warn("[gp] saveProgress failed:", e);
    }
  }

  // ──────────── Авторизация СРЕДСТВАМИ ПЛОЩАДКИ ────────────
  // Требование модерации: внутри iframe у игры не должно быть СВОЕЙ формы входа
  // (почта/пароль) — вход даёт площадка. Наш email-вход остаётся на terron.io.

  /** Площадка (или сам GamePush) умеет показать окно входа. */
  canPlatformLogin(): boolean {
    const p = this.gp?.platform;
    // ⚠️ SDK ЕЩЁ НЕ ГОТОВ — НЕ ПОВОД ПРЯТАТЬ КНОПКУ. Экран аккаунта рисуется
    // один раз при открытии; если в этот момент gp не поднялся, игрок оставался
    // с текстом «можно играть без аккаунта» и БЕЗ входа — навсегда, до
    // перезагрузки (репорт владельца 31.07: «жму вход и нет входа»). Раньше это
    // маскировала перезагрузка страницы, теперь её нет. Внутри площадки вход
    // есть всегда — клик сам дождётся готовности (см. platformLogin).
    if (!p) return this.isOnPlatform();
    if (typeof this.gp?.player?.login !== "function") return false;
    return Boolean(
      p._hasAuthModal || p.hasIntegratedAuth || p.isSecretCodeAuthAvailable,
    );
  }

  /** Площадка принимает вход по СЕКРЕТНОМУ КОДУ (запасной путь GamePush для
   *  площадок без своей авторизации). По нему решаем, показывать ли кнопку
   *  «У меня есть код» — если площадка так не умеет, кнопка врала бы.
   *
   *  ⚠️ У площадок со СВОЕЙ модалкой (`_hasAuthModal` — Яндекс и т.п.) SDK
   *  открывает её и флаг withSecretCode ИГНОРИРУЕТ (сверено с бандлом SDK):
   *  кнопка «У меня есть код» привела бы ровно туда же, куда обычная. Прячем. */
  canSecretCodeLogin(): boolean {
    const p = this.gp?.platform;
    return Boolean(p?.isSecretCodeAuthAvailable && !p?._hasAuthModal);
  }

  /** Полноэкранный режим СРЕДСТВАМИ ПЛОЩАДКИ. У SDK свой модуль `fullscreen`
   *  с событиями — используем его, чтобы наша иконка не расходилась с
   *  фактическим состоянием (репорт владельца 01.08: вошёл в полный экран их
   *  кнопкой, нашей выйти не смог). ⚠️ Полный экран, включённый в
   *  РОДИТЕЛЬСКОМ окне песочницы, из iframe снять нельзя — это ограничение
   *  браузера, выход только Esc. */
  toggleFullscreen(): boolean {
    const fs = this.gp?.fullscreen;
    if (!fs) return false;
    try {
      if (fs.isEnabled) fs.close?.();
      else fs.open?.();
      return true;
    } catch (e) {
      console.warn("[gp] переключение полного экрана не удалось:", e);
      return false;
    }
  }

  isFullscreen(): boolean {
    return Boolean(this.gp?.fullscreen?.isEnabled);
  }

  private wirePlatformFullscreen(): void {
    const fs = this.gp?.fullscreen;
    if (typeof fs?.on !== "function") return;
    try {
      for (const ev of ["change", "open", "close"]) {
        fs.on(ev, () => {
          window.dispatchEvent(new CustomEvent("gp-fullscreen-changed"));
        });
      }
    } catch (e) {
      console.warn("[gp] подписка на полный экран не удалась:", e);
    }
  }

  /** ЯЗЫК В ОБЕ СТОРОНЫ. Раньше мы только слушали `change:language` от
   *  площадки; игрок менял язык у нас — она об этом не знала. По их доке за
   *  это отвечает `gp.changeLanguage(iso)` (docs/get-start/common-features).
   *  Эхо-события безопасно: применение языка идемпотентно. */
  reportLanguage(lang: string): void {
    const iso = lang.toLowerCase().slice(0, 2);
    if (!iso || this.gp?.language === iso) return;
    try {
      this.gp?.changeLanguage?.(iso);
      console.log("[gp] язык сообщён площадке:", iso);
    } catch (e) {
      console.warn("[gp] changeLanguage failed:", e);
    }
  }

  /** ПАУЗА В ОБЕ СТОРОНЫ. Их `pause/resume` мы слушали, а свою паузу (ESC,
   *  меню в одиночке/обучении) не отдавали. По доке это их точка управления:
   *  на неё завязаны реклама и аналитика. Эхо не зациклится — обработчик
   *  ставит уже стоящее состояние. */
  reportPause(paused: boolean): void {
    if (this.platformPaused === paused) return;
    this.platformPaused = paused;
    try {
      if (paused) this.gp?.pause?.();
      else this.gp?.resume?.();
    } catch (e) {
      console.warn("[gp] pause/resume failed:", e);
    }
  }
  private platformPaused = false;

  // terron 01.08: предложение ярлыка на экране победы УБРАНО (решение
  // владельца: «не требуется»). Обёртки оставлены — вызов площадки рабочий,
  // вернуть предложение = снова отрисовать блок в WinModal.
  /** Площадка умеет добавить ярлык на рабочий стол (Яндекс, VK). Флаг сам
   *  учитывает «уже добавлен» — по их доке `canAddShortcut`. */
  canAddShortcut(): boolean {
    return Boolean(this.gp?.app?.canAddShortcut);
  }

  /** Предложить добавить ярлык. true — игрок согласился. */
  async addShortcut(): Promise<boolean> {
    const app = this.gp?.app;
    if (!app?.addShortcut) return false;
    try {
      return Boolean(await app.addShortcut());
    } catch (e) {
      console.warn("[gp] addShortcut failed:", e);
      return false;
    }
  }

  /** Какая площадка под нами: YANDEX / VK_PLAY / PIKABU / … Пусто, пока SDK не
   *  поднялся, и "NONE" в песочнице — реальной площадки там нет. Используется
   *  для подписи и значка кнопки входа (components/ui/platformBadge.ts). */
  platformType(): string | undefined {
    return this.gp?.platform?.type;
  }

  /** Игрок уже авторизован на площадке (не гость). */
  isPlayerLoggedIn(): boolean {
    return Boolean(this.gp?.player?.isLoggedIn);
  }

  // ── Явный выход ─────────────────────────────────────────────────────────
  // ТЗ (31.07): «LOG OUT → никакого тихого перезахода». Площадка после нашего
  // выхода по-прежнему знает игрока, и автовход на старте немедленно возвращал
  // его в тот же аккаунт — выглядело как «выход не работает». Помечаем явный
  // выход в localStorage; снимает пометку ТОЛЬКО явное действие: клик «Войти»
  // у нас или вход на самой площадке.
  private static readonly NO_AUTOLOGIN_KEY = "terron_gp_no_autologin";
  /** terron 01.08: ВЫХОД НА ПЛОЩАДКЕ. Замечание модерации: «кнопка выйти из
   *  аккаунта в игре не вызывает Logout в СДК» — мы гасили только свою сессию,
   *  а для площадки игрок оставался вошедшим. Теперь сперва выходим у неё.
   *  Не умеет разлогинивать (isLogoutAvailable=false) — молча пропускаем,
   *  своя сессия всё равно погаснет. */
  async logoutPlatform(): Promise<boolean> {
    const player = this.gp?.player;
    if (!player?.logout) {
      this.noteLoginEvent("наш выход (площадка не умеет)");
      return false;
    }
    if (this.gp?.platform?.isLogoutAvailable === false) {
      this.noteLoginEvent("наш выход (выход запрещён площадкой)");
      return false;
    }
    try {
      await player.logout();
      this.noteLoginEvent("наш выход → logout площадки");
      return true;
    } catch (e) {
      console.warn("[gp] logout failed:", e);
      return false;
    }
  }

  /** Событие входа/выхода — в консоль и дев-плашке (DevLoginBadge слушает). */
  private noteLoginEvent(what: string): void {
    try {
      window.dispatchEvent(new CustomEvent("gp-login-event", { detail: what }));
    } catch {
      /* ssr */
    }
  }

  /** Состояние входа одной пачкой — для дев-плашки (DevLoginBadge). */
  loginDebug(): {
    onPlatform: boolean;
    sdk: boolean;
    loggedIn: boolean;
    byPlatform: boolean;
    canLogout: boolean;
    playerId: string;
    playerName: string;
    suppressed: boolean;
  } {
    const gp = this.gp;
    const p = gp?.player;
    return {
      onPlatform: this.isOnPlatform(),
      sdk: Boolean(gp),
      loggedIn: Boolean(p?.isLoggedIn),
      byPlatform: Boolean(p?.isLoggedInByPlatform),
      canLogout:
        Boolean(p?.logout) && gp?.platform?.isLogoutAvailable !== false,
      playerId: p?.id != null ? String(p.id) : "",
      playerName: (p?.name ?? "").slice(0, 24),
      suppressed: this.autoLoginSuppressed(),
    };
  }

  noteExplicitLogout(): void {
    try {
      localStorage.setItem(GamePushSDKImpl.NO_AUTOLOGIN_KEY, "1");
    } catch {}
  }
  clearExplicitLogout(): void {
    try {
      localStorage.removeItem(GamePushSDKImpl.NO_AUTOLOGIN_KEY);
    } catch {}
  }
  autoLoginSuppressed(): boolean {
    try {
      return localStorage.getItem(GamePushSDKImpl.NO_AUTOLOGIN_KEY) === "1";
    } catch {
      return false;
    }
  }

  /** Погасить НАШУ сессию: игрок вышел на площадке (или её там и не было). */
  private async dropOurSession(): Promise<void> {
    try {
      const { logOut, notifyAuthChanged } = await import("./Auth");
      const { invalidateUserMe } = await import("./Api");
      await logOut();
      invalidateUserMe();
      notifyAuthChanged();
      // ТЗ (31.07): выход закрывает личные страницы. Раньше досье оставалось
      // на экране с данными уже погашенного аккаунта.
      if (window.currentPageId === "page-profile") {
        window.showPage?.("page-play");
      }
    } catch (e) {
      console.warn("[gp] сброс сессии не удался:", e);
    }
  }

  /**
   * Сверка на старте: на площадке гость, а у нас живая сессия — значит игрок
   * вышел, пока игра не была запущена (или в другой вкладке), и события мы не
   * поймали. Событие можно пропустить, сверка отработает всегда.
   *
   * ⚠️ Гасим ТОЛЬКО сессии, заведённые через площадку. Аккаунт, в который
   * вошли почтой на самом terron.io, к состоянию площадки отношения не имеет —
   * трогать его нельзя.
   */
  private async syncSessionWithPlatform(): Promise<void> {
    if (this.isPlayerLoggedIn()) return;
    try {
      const { getMyProfile } = await import("./Api");
      const profile = await getMyProfile();
      // ⚠️ ПУСТОЙ ПРОФИЛЬ НА СТАРТЕ — НЕ ЗНАЧИТ «мы гость». Наша сессия
      // поднимается из refresh-куки ПОЗЖЕ инициализации SDK, и разовая
      // сверка успевала увидеть «профиля нет» и уйти ни с чем: после СБРОСа
      // игрока в панели игра оставалась залогиненной (репорт владельца 01.08).
      // Поэтому сверку ПОВТОРЯЕМ — по событию смены сессии и отложенно.
      if (!profile) return;
      if (profile.user.authProvider !== "gamepush") return;
      console.log("[gp] на площадке гость, а у нас сессия площадки — гасим");
      await this.dropOurSession();
      try {
        const { toast } = await import("./Toast");
        const { L } = await import("./Utils");
        toast(
          L(
            "Игрок площадки сброшен — вышли из аккаунта",
            "Platform player was reset — signed out",
          ),
          "info",
        );
      } catch {
        /* без тоста тоже переживём */
      }
    } catch (e) {
      console.warn("[gp] сверка сессии не удалась:", e);
    }
  }

  /** Сверку «на площадке гость, а у нас его сессия» гоняем не один раз:
   *  наша сессия появляется асинхронно (refresh-кука), а игрока на площадке
   *  могут сбросить в любой момент (СБРОС в панели, выход в другой вкладке).
   *  Дёшево: три отложенные попытки + реакция на смену нашей сессии. */
  private sessionWatchArmed = false;
  private watchSessionMismatch(): void {
    if (this.sessionWatchArmed) return;
    this.sessionWatchArmed = true;
    // Частые ранние попытки: наша сессия поднимается из куки за доли секунды,
    // и игрок не должен успеть увидеть чужой аккаунт (репорт владельца 01.08:
    // «сделал СБРОС — а я в старом аккаунте»).
    for (const delay of [200, 600, 1500, 3000, 6000, 12000]) {
      window.setTimeout(() => void this.syncSessionWithPlatform(), delay);
    }
    try {
      // Вкладку могли сбросить, пока она была в фоне.
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void this.syncSessionWithPlatform();
      });
    } catch {
      /* ssr */
    }
    try {
      window.addEventListener("terron-auth-changed", () => {
        // Сессия сменилась (вошли/вышли/поднялась из куки) — сверяемся снова.
        window.setTimeout(() => void this.syncSessionWithPlatform(), 300);
      });
    } catch {
      /* ssr */
    }
  }

  /**
   * Аватарка с площадки (просьба владельца 25.08.2026: «ставь мою из ВК»).
   *
   * Отдаём серверу ССЫЛКУ, а качает и перекодирует он: чужой CDN не шлёт
   * CORS-заголовков, и из браузера картинку в canvas не затащить — холст
   * «пачкается», а `toDataURL` падает.
   *
   * ⚠️ Идемпотентно: сервер НЕ перетирает аватарку, которую игрок загрузил сам,
   * и выходит до похода в сеть. Поэтому вызов на каждом входе безвреден.
   */
  /**
   * Откуда взять аватарку игрока.
   *
   * ⚠️ `gp.player.avatar` у ВК — НЕ фото из профиля: игрокам без своей картинки
   * (а на деле — всем, кого GamePush не спросил) он подставляет собственный
   * рисованный аватар с `api.dicebear.com`. Первый живой заход 25.08 принёс
   * именно его. Настоящее фото отдаёт мост самого ВК (VK Bridge), который
   * лежит в `platform.getNativeSDK()` — метод `VKWebAppGetUserInfo` доступен
   * без разрешений и без секретов, потому что мы уже внутри их окна.
   */
  async platformAvatarUrl(): Promise<string | null> {
    if (this.platformType() === "VK") {
      // 1) НАПРЯМУЮ У ОКНА ВК. Мы и так внутри их iframe, а протокол VK Bridge
      //    для веба — это обычный postMessage родителю; никакого их SDK для
      //    этого не нужно (и тащить второй SDK нам нельзя — два SDK уже
      //    подрались за postMessage в июле, см. gamepush.md §1).
      const direct = await this.vkPhotoViaBridge();
      if (direct) return direct;
      try {
        const native = (await this.gp?.platform?.getNativeSDK?.()) as
          | {
              send?: (
                method: string,
                params?: unknown,
              ) => Promise<Record<string, unknown>>;
            }
          | undefined;
        if (typeof native?.send === "function") {
          const info = await native.send("VKWebAppGetUserInfo", {});
          const photo =
            info?.photo_200 ?? info?.photo_max ?? info?.photo_100 ?? null;
          if (typeof photo === "string" && photo) return photo;
          console.warn("[gp] ВК: в ответе моста нет фото");
        } else {
          console.warn("[gp] ВК: мост площадки недоступен (нет send)");
        }
      } catch (e) {
        console.warn("[gp] ВК: мост не отдал фото:", e);
      }
    }
    const url = this.gp?.player?.avatar;
    if (!url || typeof url !== "string") return null;
    // Рисованная заглушка GamePush — не аватарка площадки, тащить нечего.
    if (/dicebear/i.test(url)) return null;
    return url;
  }

  /**
   * Фото профиля у САМОГО ВК: `VKWebAppGetUserInfo` через postMessage родителю.
   *
   * Так работает их же `vk-bridge` в вебе: наружу уходит
   * `{handler, params, type:"vk_connect"}`, обратно приходит сообщение с
   * `type:"VKWebAppGetUserInfoResult"` и данными в `data`. Разрешений не
   * требует — базовый профиль (id, имя, фото) мини-приложению отдают всегда.
   *
   * ⚠️ Ответ ждём с потолком: если ВК промолчит (другой контекст, изменённый
   * протокол), просто уходим дальше по цепочке — молча, без ошибок в игре.
   */
  private vkPhotoCache: string | null | undefined;
  private async vkPhotoViaBridge(): Promise<string | null> {
    if (this.vkPhotoCache !== undefined) return this.vkPhotoCache;
    this.vkPhotoCache = await new Promise<string | null>((resolve) => {
      let done = false;
      const finish = (v: string | null) => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onMessage);
        window.clearTimeout(timer);
        resolve(v);
      };
      const onMessage = (e: MessageEvent) => {
        const msg = e.data as
          | { type?: string; data?: Record<string, unknown> }
          | undefined;
        if (!msg || typeof msg !== "object") return;
        if (msg.type !== "VKWebAppGetUserInfoResult") {
          if (msg.type === "VKWebAppGetUserInfoFailed") finish(null);
          return;
        }
        const d = msg.data ?? {};
        const photo =
          d.photo_max_orig ?? d.photo_max ?? d.photo_200 ?? d.photo_100;
        finish(typeof photo === "string" && photo ? photo : null);
      };
      const timer = window.setTimeout(() => finish(null), 3000);
      try {
        window.addEventListener("message", onMessage);
        window.parent.postMessage(
          { handler: "VKWebAppGetUserInfo", params: {}, type: "vk_connect" },
          "*",
        );
      } catch (e) {
        console.warn("[gp] ВК: не смогли спросить фото у окна площадки:", e);
        finish(null);
      }
    });
    if (!this.vkPhotoCache) console.warn("[gp] ВК: окно площадки фото не дало");
    return this.vkPhotoCache;
  }

  private async adoptPlatformAvatar(): Promise<void> {
    const url = await this.platformAvatarUrl();
    if (!url) return;
    try {
      const { getAuthHeader } = await import("./Auth");
      const r = await fetch(`${getApiBase()}/me/avatar/platform`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) return;
      const j = (await r.json().catch(() => null)) as {
        applied?: boolean;
      } | null;
      if (!j?.applied) return;
      // Аватарка сменилась — перечитать профиль и перерисовать шапку/досье.
      const { invalidateUserMe } = await import("./Api");
      const { notifyAuthChanged } = await import("./Auth");
      invalidateUserMe();
      notifyAuthChanged();
      console.log("[gp] аватарка площадки применена");
    } catch (e) {
      console.warn("[gp] аватарка площадки не применилась:", e);
    }
  }

  /** Имя игрока на площадке (для Яндекса — имя аккаунта). Пусто у гостя.
   *  Берём как ПОЗЫВНОЙ по умолчанию: игрок вошёл через площадку и вправе
   *  ожидать, что игра знает, как его зовут. */
  platformName(): string | null {
    // terron 18.08: get("name") только если поле заведено в панели проекта —
    // иначе SDK пишет в консоль «Field "name" not exists on player model»
    // (видел модератор GamePush на демо-странице). Фолбэк player.name живёт
    // в любом случае.
    const raw = this.hasField("name")
      ? (this.gp?.player?.get?.("name") ?? this.gp?.player?.name)
      : this.gp?.player?.name;
    const s = typeof raw === "string" ? raw.trim() : "";
    return s.length > 0 ? s : null;
  }

  /** Показывает окно входа площадки. true = игрок вошёл.
   *  После входа id игрока МЕНЯЕТСЯ (гость → аккаунт площадки), поэтому сразу
   *  подтягиваем прогресс (loadProgress берёт максимум локального и облачного —
   *  наигранное гостем не теряется) и пробуем поднять нашу сессию. */
  async platformLogin(withSecretCode = false): Promise<boolean> {
    this.clearExplicitLogout(); // клик «Войти» = явное намерение
    // Клик мог прийти раньше, чем поднялся SDK (кнопку мы показываем сразу) —
    // ждём готовности, иначе вход молча не сработает.
    if (!this.gp) {
      await this.maybeInit();
      if (!this.gp && window.__gpReady) {
        try {
          this.gp = await window.__gpReady;
        } catch {
          /* SDK так и не поднялся */
        }
      }
    }
    const player = this.gp?.player;
    if (!player?.login) return false;
    try {
      // ⚠️ ЯВНО ГОВОРИМ, КАКОЙ ВХОД НУЖЕН. Без флага их оверлей сначала
      // показывает СВОЮ промежуточную модалку («Войти через GamePush» + поле
      // кода) — лишний экран поверх нашей страницы, где то же самое уже есть.
      // С флагом сразу открывается нужное окно: авторизация площадки либо ввод
      // кода (замечание владельца 31.07: «что мешает выводить это у нас»).
      const ok = await player.login({ withSecretCode });
      if (!ok) return false;
      this.loadProgress();
      await this.loginToBackend();
      return true;
    } catch (e) {
      console.warn("[gp] вход через площадку не удался:", e);
      return false;
    }
  }

  /** Площадка авторизует игрока сама и всегда (ВК, ОК, Телеграм…). */
  platformAlwaysAuthorized(): boolean {
    const type = this.platformType();
    return type ? ALWAYS_AUTHORIZED_PLATFORMS.has(type) : false;
  }

  /**
   * ИСТИННЫЙ id игрока НА САМОЙ ПЛОЩАДКЕ + имя её провайдера.
   *
   * Зачем: аккаунт TERRON ключуется по id GamePush, а он живёт ровно столько,
   * сколько мы работаем с агрегатором. Уйдём от них (или опубликуемся в ВК
   * напрямую) — игроков опознать будет нечем. Поэтому настоящий id снимаем с
   * ПЕРВОГО захода и привязываем второй identity (правило владельца 25.08.2026).
   *
   * ⚠️ Форма у каждой площадки СВОЯ: у Яндекса — метод его SDK, у ВК — параметр
   * запуска в адресе. Прежний код знал только яндексовскую форму и на ВК молча
   * уходил на внутренний gp-id.
   */
  async nativeIdentity(): Promise<{ provider: string; id: string } | null> {
    const type = this.platformType();

    // ВКонтакте: vk_user_id в адресе игры (тот же признак, по которому саму
    // площадку опознаёт GamePush). Проверяем и старую форму (viewer_id).
    if (type === "VK") {
      const vkId =
        LAUNCH_PARAMS.get("vk_user_id") ?? LAUNCH_PARAMS.get("viewer_id");
      if (vkId && /^\d+$/.test(vkId)) return { provider: "vk", id: vkId };
      // Параметров нет — молчим: подставлять сюда gp-id нельзя, второй identity
      // должен быть НАСТОЯЩИМ или отсутствовать вовсе.
      console.warn("[gp] ВК: vk_user_id в адресе не найден");
      return null;
    }

    if (type === "YANDEX") {
      const uid = await this.yandexUniqueId();
      return uid ? { provider: "yandex", id: uid } : null;
    }
    return null;
  }

  /** Нативный стабильный id игрока площадки (для Яндекса — getUniqueID).
   *  ВАЖНО: нативный, не внутренний gp-id — чтобы переезд GamePush→нативный SDK
   *  не терял базу (см. /auth/ya, ключ = (provider, нативный id)). */
  async getNativeId(): Promise<{ id: string; native: boolean } | null> {
    if (!this.gp) return null;
    // 1) НАТИВНЫЙ id площадки — то, ради чего всё затевалось. Для Яндекса это
    //    YaGames.getPlayer().getUniqueID(): он переживёт переезд с GamePush на
    //    прямую публикацию, а внутренний gp-id — нет.
    //    ⚠️ 29.07: раньше здесь звался `gp.callNativeSDK("player.getUniqueID")` —
    //    ТАКОГО МЕТОДА В SDK НЕТ (проверено в живом iframe: undefined), поэтому
    //    код МОЛЧА падал на фолбэк и база копилась на gp-id. Правильный путь —
    //    gp.platform.getNativeSDK().
    const uid = await this.yandexUniqueId();
    if (uid) return { id: uid, native: true };
    // 2) Фолбэк — внутренний id GamePush. Помечаем native:false, чтобы бэкенд
    //    (и мы в логах) отличали «настоящий id площадки» от агрегаторского.
    const gpId = this.gp.player?.id;
    return gpId != null ? { id: String(gpId), native: false } : null;
  }

  /** getUniqueID Яндекса через его нативный SDK (у других площадок метода нет). */
  private async yandexUniqueId(): Promise<string | null> {
    try {
      const native = await this.gp?.platform?.getNativeSDK?.();
      return await this.readNativeUniqueId(native);
    } catch (e) {
      console.warn("[gp] нативный id недоступен:", e);
      return null;
    }
  }

  /** Достаём getUniqueID у нативного SDK площадки. Форма отличается: у Яндекса
   *  это `ysdk.getPlayer()` → объект с getUniqueID(); у других площадок метода
   *  может не быть вовсе — тогда молча возвращаем null и уходим на фолбэк. */
  private async readNativeUniqueId(native: unknown): Promise<string | null> {
    if (!native || typeof native !== "object") return null;
    const sdk = native as {
      getPlayer?: (opts?: { scopes?: boolean }) => Promise<unknown>;
    };
    if (typeof sdk.getPlayer !== "function") return null;
    const player = (await sdk.getPlayer({ scopes: false })) as {
      getUniqueID?: () => string;
    } | null;
    const uid = player?.getUniqueID?.();
    return uid ? String(uid) : null;
  }

  /** Логинит игрока на НАШ бэкенд и поднимает нашу сессию (refresh-cookie).
   *
   *  Доказательство владения аккаунтом — ЧЕЛЛЕНДЖ, а не «поверь моему id»:
   *    1. просим у нашего API одноразовый nonce для этого gp-игрока;
   *    2. пишем его в СВОЁ поле игрока GamePush и синкаем на их сервер;
   *    3. наш сервер читает профиль игрока админским ключом и сверяет nonce.
   *  Подделать чужой id так нельзя — в чужой профиль не записать. Подробности и
   *  причина отказа от проверки authToken — в gamepush.md.
   *
   *  Гость без gp-id или незаведённое поле-челлендж → просто false (играем без
   *  нашего аккаунта, прогресс всё равно живёт на площадке). */
  async loginToBackend(opts: { allowCreate?: boolean } = {}): Promise<boolean> {
    // ⚠️ ТОЛЬКО ОДИН РЕЙС ЗА РАЗ. Вход дёргают ТРИ источника: событие SDK
    // «login», наш обработчик кнопки и старт игры. Одновременные попытки
    // соревновались за ОДИН челлендж (сервер держит по игроку один ожидаемый
    // nonce, а поле игрока — одно на площадке): первый рейс перетирал nonce
    // второго, оба получали 401 и вход «срабатывал», но сессии не давал
    // (репорт владельца 31.07, подтверждено в логах API — два запроса в одну
    // миллисекунду, оба 401). Второй звонок теперь просто ждёт первый.
    if (this.loginFlight) return this.loginFlight;
    const flight = this.runLoginToBackend(opts.allowCreate !== false);
    this.loginFlight = flight;
    // Сигналы «входим/закончили» — для КРУТИЛКИ на экране аккаунта. Вход может
    // стартовать и мимо нашей кнопки (окно площадки → событие SDK) — экран
    // обязан крутить анимацию в любом случае (репорт владельца 01.08:
    // «2 секунды тишины»).
    window.dispatchEvent(new CustomEvent("gp-login-pending"));
    try {
      return await flight;
    } finally {
      if (this.loginFlight === flight) this.loginFlight = null;
      window.dispatchEvent(new CustomEvent("gp-login-done"));
    }
  }
  private loginFlight: Promise<boolean> | null = null;

  private async runLoginToBackend(allowCreate: boolean): Promise<boolean> {
    // ⚠️ СЕССИЯ УЖЕ ЕСТЬ — ЧЕЛЛЕНДЖ НЕ НУЖЕН (25.08, репорт владельца «загрузка
    // стала заметно дольше»). Полный путь входа — это запрос к нам за nonce,
    // запись в профиль площадки, её `sync` и ещё один запрос; у GamePush
    // плавающая задержка репликации, из-за которой у нас лестница ретраев до
    // ~19 секунд. Пока аккаунта не существовало, всё это было бесплатно: сервер
    // отвечал `no_account` первым же запросом. Аккаунт появился — и цена стала
    // платиться НА КАЖДОЙ ЗАГРУЗКЕ, хотя поднимать нечего: кука жива.
    const { isLoggedIn } = await import("./Auth");
    if (await isLoggedIn()) {
      void this.adoptPlatformAvatar();
      return true;
    }
    const ident = await this.getNativeId();
    // Истинный id площадки — ОТДЕЛЬНЫМИ полями. Старые поля playerId/idSource
    // трогать нельзя: боевой API привязывает их жёстко как "yandex", и id из
    // ВК лёг бы в базу под яндексовой вывеской (правится тем же заходом).
    const native = await this.nativeIdentity();
    const player = this.gp?.player;
    const gpPlayerId = player?.id != null ? String(player.id) : "";
    if (!ident || !gpPlayerId) return false;
    // Гостевые id ЭТОГО браузера — снимаем до обращения к серверу: по ним он
    // заберёт сыгранное без аккаунта и отложенные награды.
    const { getAnonPersistentIDs } = await import("./Auth");
    const anonIds = getAnonPersistentIDs();
    const challenge = await this.passChallenge(gpPlayerId);
    if (!challenge) return false;
    const { nonce, field } = challenge;
    // ⏳ ЖДЁМ, ПОКА ПЛОЩАДКА ПОКАЖЕТ ЗАПИСЬ СВОЕМУ ЖЕ API. sync() у них
    // возвращается раньше, чем nonce виден серверному чтению профиля — наш
    // сервер читает и отвечает «nonce_not_written». Задержка ПЛАВАЮЩАЯ:
    // на стенде 31.07 один и тот же сценарий то проходил с первого раза за
    // 440 мс, то не проходил и через секунду. Поэтому повторяем ТОТ ЖЕ nonce
    // (челлендж на сервере жив до успеха) — лишних записей не делаем, просто
    // даём их репликации догнать.
    // Лестница до ~19с: живой вход владельца 31.07 не уложился в прежние 6.5с
    // (4×401 подряд) — а кнопка всё это время честно показывает «Входим…»,
    // так что ждать дольше дешевле, чем отфутболить игрока.
    const waits = [900, 1800, 3000, 5000, 8000];
    for (let attempt = 0; ; attempt++) {
      const verdict = await this.tryLoginToBackend(
        ident,
        gpPlayerId,
        nonce,
        anonIds,
        allowCreate,
        native,
      ).catch((e) => {
        console.error("[gp] loginToBackend failed:", e);
        return { ok: false as const, reason: "exception" };
      });
      if (verdict.ok) return true;
      // Тихий автовход без аккаунта — штатный случай, не ошибка: играем гостем,
      // аккаунт заведёт явный клик «Войти».
      if (verdict.reason === "no_account") {
        console.log(
          "[gp] аккаунта ещё нет — остаёмся гостем (создаст «Войти»)",
        );
        return false;
      }
      if (verdict.reason !== "nonce_not_written") return false;
      if (attempt >= waits.length) {
        console.warn("[gp] площадка так и не показала nonce своему API");
        return false;
      }
      await new Promise((r) => setTimeout(r, waits[attempt]));
      // Перед повтором пишем ТОТ ЖЕ nonce ещё раз и синкаем: «not_written»
      // значит и «их API отдал старое», и «первый sync не доехал» — повторная
      // запись закрывает второй случай, а первому не мешает (значение то же).
      try {
        const player = this.gp?.player;
        player?.set?.(field, nonce);
        await player?.sync?.();
      } catch {
        /* не синканулось — следующая проверка всё скажет */
      }
    }
  }

  private async tryLoginToBackend(
    ident: { id: string; native: boolean },
    gpPlayerId: string,
    nonce: string,
    anonIds: string[],
    allowCreate: boolean,
    native: { provider: string; id: string } | null,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const r = await fetch(`${getApiBase()}/auth/ya`, {
      method: "POST",
      // Заголовок контекста ОБЯЗАТЕЛЕН: без него сессия площадки легла бы в
      // сайтовую куку и снова склеила бы два аккаунта в один.
      headers: { "content-type": "application/json", ...platformAuthHeaders() },
      credentials: "include",
      // idSource — КАКОЙ это id: "native" (getUniqueID площадки, переживёт уход
      // от GamePush) или "gamepush" (внутренний, привязан к агрегатору). Бэкенд
      // ключует аккаунт по ПРОВЕРЕННОМУ gpPlayerId, а нативный привязывает
      // дополнительно — ради переезда на прямую публикацию.
      body: JSON.stringify({
        playerId: ident.id,
        idSource: ident.native ? "native" : "gamepush",
        gpPlayerId,
        nonce,
        // Имя с площадки — чтобы новый аккаунт не был безликим «playerNNNN».
        // Сервер применяет его ТОЛЬКО при создании аккаунта.
        name: this.platformName() ?? undefined,
        // Гость мог отыграть матчи без аккаунта, а площадка при входе выдаёт
        // ДРУГОЙ id — сервер по этим id заберёт сыгранное и отложенные
        // награды, чтобы человек не начинал с нуля.
        anonIds: anonIds.length > 0 ? anonIds : undefined,
        // Тихий автовход НЕ создаёт аккаунтов (правило auth-flows.md §2):
        // площадка авторизует сама, а аккаунт TERRON заводится по явному
        // действию игрока. ИСКЛЮЧЕНИЕ — площадки «всегда авторизован» (ВК и
        // подобные): там нажать «Войти» негде, гейт ставит Main по
        // platformAlwaysAuthorized().
        createIfMissing: allowCreate ? undefined : false,
        // Истинный id площадки (vk / yandex / …) — сервер привяжет его ВТОРОЙ
        // identity, если он ещё ничей. Старый API эти поля игнорирует.
        nativeProvider: native?.provider,
        nativeId: native?.id,
      }),
    });
    if (!r.ok) {
      // Причину отказа сервер присылает в теле — без неё «401» ничего не
      // говорит и разбор идёт вслепую (сожгло вечер 31.07).
      const reason = await r
        .json()
        .then((j: { reason?: string }) => j?.reason ?? "")
        .catch(() => "");
      console.warn("[gp] /auth/ya вернул", r.status, reason);
      return { ok: false, reason: reason || String(r.status) };
    }
    // Кука уже стоит, но клиент об этом не знает: после первого 401 гостя
    // он помечает «сессии нет» и больше не пробует обновиться. Без этого
    // шага игрок видел «Вход выполнен» и тут же «Войдите в аккаунт», а
    // помогала только перезагрузка (замечание модерации 30.07).
    const { adoptExternalSession, notifyAuthChanged } = await import("./Auth");
    await adoptExternalSession();
    // Оповестить UI ЗДЕСЬ, а не только в обработчике кнопки: вход на старте
    // игры (Main) и по событию SDK «login» проходят МИМО кнопки — без сигнала
    // шапка держала «Войти», а досье «войдите», пока игрок не сделает F5
    // (репорт владельца 31.07). Кнопочный путь делает то же самое повторно —
    // это безвредно.
    const { invalidateUserMe } = await import("./Api");
    invalidateUserMe();
    notifyAuthChanged();
    window.dispatchEvent(new CustomEvent("gp-login"));
    // Аватарку площадки ставим ФОНОМ: вход её ждать не должен, а отказ (нет
    // аватарки, чужой хост, таймаут) — не ошибка входа.
    void this.adoptPlatformAvatar();
    console.log("[gp] вход через площадку выполнен");
    return { ok: true };
  }

  /** Шаг «докажи, что аккаунт твой»: берём nonce у нашего API, пишем его в поле
   *  игрока и ДОЖИДАЕМСЯ sync (без него сервер GamePush ничего не увидит).
   *  Возвращает nonce, который сервер и будет сверять; null — не сложилось. */
  private async passChallenge(
    gpPlayerId: string,
  ): Promise<{ nonce: string; field: string } | null> {
    const player = this.gp?.player;
    if (!player?.set || !player.sync) return null;
    try {
      const r = await fetch(`${getApiBase()}/auth/platform/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gpPlayerId }),
      });
      if (!r.ok) {
        console.warn("[gp] челлендж не выдан:", r.status);
        return null;
      }
      const { nonce, field } = (await r.json()) as {
        nonce?: string;
        field?: string;
      };
      if (!nonce || !field) return null;
      // Поле должно быть заведено в панели GamePush — set по незаведённому
      // площадка молча игнорирует, и проверка честно провалится.
      if (!this.hasField(field)) {
        console.warn(`[gp] поле «${field}» не заведено в проекте — вход через
          площадку не подтвердить`);
        return null;
      }
      player.set(field, nonce);
      await player.sync();
      return { nonce, field };
    } catch (e) {
      console.warn("[gp] челлендж не пройден:", e);
      return null;
    }
  }
}

export const GamePushSDK = new GamePushSDKImpl();

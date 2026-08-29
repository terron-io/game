// terron: нативная интеграция Yandex Games SDK (без GamePush) — для публикации в
// Яндекс Играх. Минимум, который Яндекс ТРЕБУЕТ на модерации:
//   1) подключить SDK,  2) вызвать LoadingAPI.ready() когда игра готова,
//   3) уметь отдавать язык (ysdk.environment.i18n.lang).
// Авторизация (getUniqueID) — опционально, для линка на наш аккаунт через /auth/ya;
// для модерации НЕ обязательна (есть гостевой вход). Паттерн повторяет CrazyGamesSDK.ts,
// но это НАШ код, не чужой OpenFront-SDK.
//
// Включается только когда игра реально открыта внутри Яндекса (iframe). На обычном
// terron.io / в Capacitor — no-op, ничего наружу не дёргает.

declare global {
  interface Window {
    YaGames?: {
      init(): Promise<YaSDK>;
    };
  }
}

interface YaPlayer {
  getUniqueID(): string;
  getName(): string;
}

interface YaSDK {
  environment: { i18n: { lang: string } };
  features: { LoadingAPI?: { ready(): void } };
  getPlayer(options?: { scopes?: boolean }): Promise<YaPlayer>;
}

const SDK_URL = "https://yandex.ru/games/sdk/v2";

class YandexGamesSDKImpl {
  private sdk: YaSDK | null = null;
  private initStarted = false;
  private readySent = false;

  /** Запущены ли мы внутри Яндекс Игр (их iframe). На terron.io/Capacitor — false. */
  isOnYandex(): boolean {
    if (typeof window === "undefined") return false;
    try {
      // Яндекс встраивает игру в iframe на своём домене.
      return window.self !== window.top;
    } catch {
      // cross-origin доступ к top кинет — значит мы во чужом iframe (Яндекс).
      return true;
    }
  }

  /** Подгружает и инициализирует SDK. Идемпотентно. Безопасно вызывать всегда — вне
   *  Яндекса просто ничего не делает. */
  async maybeInit(): Promise<void> {
    if (this.sdk || this.initStarted) return;
    if (!this.isOnYandex()) return;
    // terron: путь публикации = GamePush (он сам мостит Яндекс через callNativeSDK).
    // Если GamePush-сниппет активен (мы в iframe площадки, он синхронно ставит
    // window.__gpReady в index.html) — нативный Яндекс-SDK НЕ грузим. Иначе ДВА SDK
    // одновременно шлют postMessage родителю: они дерутся за канал, Яндекс-SDK виснет
    // на loadEnvironment (нет реального Яндекс-окружения → таймаут 5с + ошибка), а
    // песочница GamePush из-за этого не засчитывает «SDK should initialize».
    if (typeof window !== "undefined" && window.__gpReady) return;
    this.initStarted = true;
    try {
      await this.loadScript();
      if (!window.YaGames) {
        console.warn("[ya] YaGames не появился после загрузки SDK");
        return;
      }
      this.sdk = await window.YaGames.init();
      console.log("[ya] SDK инициализирован, lang =", this.lang());
    } catch (e) {
      console.error("[ya] init failed:", e);
    }
  }

  private loadScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.YaGames) return resolve();
      const s = document.createElement("script");
      s.src = SDK_URL;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("failed to load Yandex SDK"));
      document.head.appendChild(s);
    });
  }

  /** ОБЯЗАТЕЛЬНО для модерации: сказать Яндексу, что игра загрузилась и готова.
   *  Вызывать ОДИН раз, когда основной экран отрисован/игра играбельна. */
  ready(): void {
    if (this.readySent) return;
    // terron 18.08: БЕЗ SDK — тихий no-op. Раньше лог «отправлен» печатался и
    // когда Яндекс-SDK вовсе не загружен (на площадке GamePush maybeInit глушит
    // себя, sdk = null) — модератор GamePush прочитал эту строку в консоли как
    // «игра зовёт методы SDK до его инициализации». Вызова на деле не было,
    // но лог врал. Теперь строка появляется только при настоящем вызове.
    if (!this.sdk) return;
    try {
      this.sdk.features.LoadingAPI?.ready();
      this.readySent = true;
      console.log("[ya] LoadingAPI.ready() отправлен");
    } catch (e) {
      console.error("[ya] ready() failed:", e);
    }
  }

  /** Язык окружения Яндекса ('ru' | 'en' | ...). null если не в Яндексе. */
  lang(): string | null {
    return this.sdk?.environment.i18n.lang ?? null;
  }

  /** Нативный стабильный id игрока Яндекса — ключ для линка на наш аккаунт.
   *  ВАЖНО: именно getUniqueID (не getID) — он стабилен и совпадёт при переезде
   *  с GamePush на нативный SDK (см. /auth/ya). null если не авторизован/не в Яндексе. */
  async getUniqueId(): Promise<string | null> {
    if (!this.sdk) return null;
    try {
      const player = await this.sdk.getPlayer({ scopes: false });
      return player.getUniqueID() ?? null;
    } catch (e) {
      console.warn("[ya] getPlayer failed:", e);
      return null;
    }
  }
}

export const YandexGamesSDK = new YandexGamesSDKImpl();

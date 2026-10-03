import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../core/AssetUrls";
import "./LanguageModal";
import { LanguageModal } from "./LanguageModal";
import { platformLanguage } from "./PlatformAuth";
import { NET_RETRY_EVENT, hideNetTrouble, showNetTrouble } from "./NetTrouble";
import { Host } from "./PlatformHost";
import { formatDebugTranslation } from "./Utils";

// terron (бандл-диета 18.07): en.json (82КБ) больше НЕ зашит в бандл — грузится
// тем же fetch-путём, что и остальные языки (см. loadLanguage). Он всё равно
// нужен всем как фолбэк-база, но теперь качается параллельно бандлу и кэшируется
// отдельно; до загрузки компоненты показывают ключи и перерисовываются один раз
// по notifyLangLoaded (этот механизм уже был для ru и всех остальных).
import metadata from "../../resources/lang/metadata.json";
// terron 02.09: АНГЛИЙСКИЙ СНОВА ВШИТ (решение владельца: «дефолтный английский
// используй»). Диета 18.07 вынесла его в fetch ради 82 КБ — и с тех пор до прихода
// словаря интерфейс стоял СЫРЫМИ КЛЮЧАМИ; на медленной сети WebView площадки это
// секунды. Вшитый en — мгновенный фолбэк с первого кадра, язык игрока догоняет.
import enBundled from "../../resources/lang/en.json";
// terron 02.09: ФЛАГИ ДВУХ ДЕФОЛТНЫХ ЯЗЫКОВ ВШИТЫ. Владелец: «флаг снизу грузится
// вечность» — кнопка языка в футере рисуется только после словаря и списка языков,
// то есть её <img> стартует последним, и на сети первых секунд WebView площадки
// ждёт повтора ImgRetry. Для ru и en картинка теперь data-URI из бандла: ни запроса,
// ни ожидания. Остальные 36 языков — по-прежнему по манифесту, они не дефолтные.
import flagRuRaw from "../../resources/flags/ru.svg?raw";
import flagEnRaw from "../../resources/flags/uk_us_flag.svg?raw";
const INLINE_FLAGS: Record<string, string> = {
  ru: `data:image/svg+xml;utf8,${encodeURIComponent(flagRuRaw)}`,
  uk_us_flag: `data:image/svg+xml;utf8,${encodeURIComponent(flagEnRaw)}`,
};

type LanguageMetadata = {
  code: string;
  native: string;
  en: string;
  /** terron: название языка по-русски — вторая строка карточки в русском UI. */
  ru?: string;
  svg: string;
};

// terron 02.09: потолок ожидания словаря. В WebView площадки fetch может висеть
// без ответа; 8 с — заведомо больше честной загрузки 44 КБ даже по 3G.
const LANG_FETCH_TIMEOUT_MS = 8000;
function describeLangError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 120);
  if (typeof e === "string") return e.slice(0, 120);
  return e === null || e === undefined ? "unknown" : String(e).slice(0, 120);
}

@customElement("lang-selector")
export class LangSelector extends LitElement {
  @state() public translations: Record<string, string> | undefined;
  @state() public defaultTranslations: Record<string, string> | undefined =
    flattenTranslations(enBundled as Record<string, any>);
  @state() public currentLang: string = "en";
  @state() private languageList: any[] = [];
  @state() private debugMode: boolean = false;
  @state() isVisible = true;

  private debugKeyPressed: boolean = false;
  private languageMetadata: LanguageMetadata[] = metadata;
  private languageCache = new Map<string, Record<string, string>>();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.setupDebugKey();
    this.initializeLanguage();
    window.addEventListener(
      "language-selected",
      this.handleLanguageSelected as EventListener,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      "language-selected",
      this.handleLanguageSelected as EventListener,
    );
  }

  private handleLanguageSelected = (e: CustomEvent) => {
    if (e.detail && e.detail.lang) {
      this.changeLanguage(e.detail.lang);
    }
  };

  private setupDebugKey() {
    window.addEventListener("keydown", (e) => {
      if (e.key?.toLowerCase() === "t") this.debugKeyPressed = true;
    });
    window.addEventListener("keyup", (e) => {
      if (e.key?.toLowerCase() === "t") this.debugKeyPressed = false;
    });
  }

  private getClosestSupportedLang(lang: string): string {
    if (!lang) return "en";
    if (lang === "debug") return "debug";
    const supported = new Set(this.languageMetadata.map((entry) => entry.code));
    if (supported.has(lang)) return lang;

    const base = lang.slice(0, 2);
    if (supported.has(base)) return base;
    const candidates = Array.from(supported).filter((key) =>
      key.startsWith(base),
    );
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.length - a.length); // More specific first
      return candidates[0];
    }

    return "en";
  }

  private async initializeLanguage() {
    const browserLocale = navigator.language;
    const savedLang = localStorage.getItem("lang");
    // terron: чек-лист модерации GamePush — язык должен определяться МЕТОДОМ SDK
    // площадки (Яндекс/VK отдают локаль игрока), а не только браузером. Приоритет:
    // явный выбор игрока (localStorage) → язык площадки → локаль браузера.
    // Неподдерживаемый язык падает в "en" внутри getClosestSupportedLang.
    // ⚠️ Язык площадки берём ТОЛЬКО после инициализации её SDK (модерация 17.08:
    // «код пускает к методам СДК до инициализации»). Ждём максимум 1.5с и только
    // когда своего выбора нет — игроку с сохранённым языком ждать незачем.
    // ⚠️ ЧЕРЕЗ ФАСАД: раньше язык спрашивался только у GamePush, и в сборке под
    // другую площадку (Playgama) не применялся вовсе.
    // terron 02.09: СЛОВАРЬ НЕ ЖДЁТ ПЛОЩАДКУ. Раньше стояло `await platformLanguage()`
    // ДО загрузки словаря: потолок 1.5 с на SDK + до 1.5 с на синк игрока — и всё
    // это время интерфейс рисовался СЫРЫМИ КЛЮЧАМИ (четыре скриншота владельца из
    // приложения ВК: «через 3 секунды появляется, до того всё сломано»). Теперь
    // словарь грузится сразу на лучшем известном языке, а язык площадки ждём
    // ПАРАЛЛЕЛЬНО и, если он другой, переключаемся — игрок видит перевод с
    // первого кадра. Прошлый ответ площадки помним (`lastPlatformLang`), поэтому на
    // площадке со второго захода угадываем сразу её язык, без переключения.
    const platformLangPromise: Promise<string | null> = savedLang
      ? Promise.resolve(null)
      : platformLanguage();
    // terron: внутри плеера itch.io площадка англоязычная — стартуем на английском,
    // а не на языке браузера (у русского игрока иначе открывался русский интерфейс
    // на международной витрине). Явный выбор игрока (localStorage) сильнее.
    const embedLang = Host.isItch() ? "en" : null;
    const userLang = this.getClosestSupportedLang(
      savedLang ?? embedLang ?? this.lastPlatformLang() ?? browserLocale,
    );

    // Английский уже здесь — показываем его сразу и отпускаем стартовый оверлей
    // (boot-pending ждёт terron-lang-loaded); язык игрока применится, как придёт.
    this.currentLang = "en";
    this.applyTranslation();
    LangSelector.notifyLangLoaded();

    const [defaultTranslations, translations] = await Promise.all([
      this.loadLanguage("en"),
      this.loadLanguage(userLang),
    ]);

    this.defaultTranslations = defaultTranslations;
    this.translations = translations;
    this.currentLang = userLang;

    await this.loadLanguageList();
    this.applyTranslation();
    LangSelector.notifyLangLoaded();

    // Площадка ответила позже и другим языком → переключаемся, не трогая
    // localStorage.lang (это не выбор игрока; площадка остаётся хозяином языка).
    void platformLangPromise.then((platformLang) => {
      if (!platformLang) return;
      this.rememberPlatformLang(platformLang);
      const pl = this.getClosestSupportedLang(platformLang);
      if (pl === this.currentLang || localStorage.getItem("lang")) return;
      void this.switchLanguage(pl);
    });
    // Первая загрузка пришлась на мёртвую сеть → интерфейс сырыми ключами до
    // перезагрузки. Не смиряемся: догружаем в фоне, пока не придёт.
    if (Object.keys(translations).length === 0) {
      this.retryUntilLoaded(userLang, (flat) => {
        if (this.currentLang !== userLang) return;
        this.translations = flat;
        this.applyTranslation();
        LangSelector.notifyLangLoaded();
      });
    }
    if (Object.keys(defaultTranslations).length === 0) {
      this.retryUntilLoaded("en", (flat) => {
        this.defaultTranslations = flat;
        this.applyTranslation();
      });
    }
  }

  // Последний язык, который называла площадка, — чтобы на следующем старте
  // загрузить сразу его, не дожидаясь SDK. Отдельный ключ, НЕ localStorage.lang:
  // тот означает явный выбор игрока и перебивает площадку.
  private static PLATFORM_LANG_KEY = "terron_platform_lang";
  private lastPlatformLang(): string | null {
    try {
      return localStorage.getItem(LangSelector.PLATFORM_LANG_KEY);
    } catch {
      return null;
    }
  }
  private rememberPlatformLang(lang: string): void {
    try {
      localStorage.setItem(LangSelector.PLATFORM_LANG_KEY, lang);
    } catch {
      /* хранилище недоступно — угадаем по браузеру в следующий раз */
    }
  }

  /** Переключить язык БЕЗ записи в localStorage.lang (в отличие от changeLanguage —
   *  тот фиксирует явный выбор игрока). Пустой словарь прежний не трогает. */
  private async switchLanguage(lang: string): Promise<void> {
    const loaded = await this.loadLanguage(lang);
    if (Object.keys(loaded).length === 0) {
      this.retryUntilLoaded(lang, (flat) => {
        this.translations = flat;
        this.currentLang = lang;
        this.applyTranslation();
        LangSelector.notifyLangLoaded();
      });
      return;
    }
    this.translations = loaded;
    this.currentLang = lang;
    this.applyTranslation();
    LangSelector.notifyLangLoaded();
  }

  // terron 02.09: ДОГРУЗКА СЛОВАРЯ ДО УСПЕХА.
  //
  // Зонд полосы по телефону владельца в приложении ВК: в первые секунды после
  // запуска WebView сеть мертва целиком (12:14 — ни один зонд не прошёл, 12:53 —
  // большой не прошёл, ready-бикон не дошёл в 4 загрузках из 6). Три попытки за
  // 1.6 с (loadLanguage) такое не переживают, а без словаря страница — сырые ключи
  // (скриншот: FLAG_INPUT.SHORT, LOBBY.ENTER, footer.terms).
  //
  // Поэтому: экспоненциальный бэкофф до ~минуты, плюс немедленная попытка, как
  // только браузер скажет `online` или вкладка вернётся из фона — в WebView
  // площадки именно так сеть и оживает. Одна догрузка на язык; успех применяет
  // словарь и снимает слушатели.
  private retrying = new Set<string>();
  private retryUntilLoaded(
    lang: string,
    apply: (flat: Record<string, string>) => void,
  ): void {
    if (this.retrying.has(lang)) return;
    this.retrying.add(lang);
    const delays = [2000, 4000, 8000, 15000, 30000, 30000, 30000, 30000];
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const stop = () => {
      done = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", kick);
      window.removeEventListener(NET_RETRY_EVENT, kick);
      document.removeEventListener("visibilitychange", onVisible);
      this.retrying.delete(lang);
    };
    const tryNow = async () => {
      if (done) return;
      const flat = await this.loadLanguage(lang);
      if (done) return;
      if (Object.keys(flat).length > 0) {
        stop();
        hideNetTrouble("lang");
        apply(flat);
        return;
      }
      if (attempt >= delays.length) {
        stop();
        console.error(`[lang] ${lang}: сеть так и не ожила, сдаюсь`);
        return;
      }
      timer = setTimeout(tryNow, delays[attempt++]);
    };
    const kick = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tryNow, 300);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") kick();
    };
    window.addEventListener("online", kick);
    window.addEventListener(NET_RETRY_EVENT, kick); // кнопка «Повторить» на плашке
    document.addEventListener("visibilitychange", onVisible);
    timer = setTimeout(tryNow, delays[attempt++]);
  }

  // terron: переводы грузятся async (fetch) — компоненты, отрисованные ДО загрузки,
  // залипают на сырых ключах (MAIN.NEWS, SKIN_INPUT.TITLE…). Здесь — ОДИН раз
  // перерисовываем все LitElement-ы (requestUpdate), чтобы translateText подтянул
  // значения. Перебор только light-DOM (наши компоненты так и рендерятся).
  static notifyLangLoaded(): void {
    window.dispatchEvent(new CustomEvent("terron-lang-loaded"));
    try {
      document.querySelectorAll("*").forEach((el) => {
        const u = (el as { requestUpdate?: () => void }).requestUpdate;
        if (typeof u === "function") u.call(el);
      });
    } catch {
      /* ignore */
    }
  }

  private async loadLanguage(lang: string): Promise<Record<string, string>> {
    if (!lang) return {};
    const cached = this.languageCache.get(lang);
    if (cached) return cached;
    if (lang === "en" && this.defaultTranslations) {
      // вшитый — в сеть не ходим
      this.languageCache.set("en", this.defaultTranslations);
      return this.defaultTranslations;
    }

    if (lang === "debug") {
      const empty: Record<string, string> = {};
      this.languageCache.set(lang, empty);
      return empty;
    }

    // terron 02.09: СЛОВАРЬ КАЧАЕМ С ПОВТОРАМИ. Скриншот владельца из приложения
    // ВК на телефоне: вся главная сырыми ключами (FLAG_INPUT.SHORT, LOBBY.ENTER,
    // footer.terms…) — один упавший fetch в мобильной сети, и интерфейс мёртв.
    // Две повторные попытки с паузой — как у бинов карт (FetchGameMapLoader).
    const url = assetUrl(`lang/${encodeURIComponent(lang)}.json`);
    const delays = [0, 400, 1200];
    let lastErr: unknown = null;
    for (const wait of delays) {
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      // ⚠️ fetch С ТАЙМАУТОМ. Скрины владельца из WebView ВК: картинки грузятся, а
      // словарь — нет, и SDK площадки в ту же секунду режет СВОИ запросы по
      // «Timeout 2000ms exceeded». То есть fetch там не падает, а ВИСИТ — и без
      // таймаута первая попытка висела вечно: ни повторов, ни догрузки, init не
      // завершался, страница навсегда сырыми ключами.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort("timeout"), LANG_FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, { signal: ctl.signal });
        if (!response.ok) {
          throw new Error(
            `Failed to fetch language ${lang}: ${response.status}`,
          );
        }
        const language = (await response.json()) as Record<string, any>;
        const flat = flattenTranslations(language);
        this.languageCache.set(lang, flat);
        return flat;
      } catch (err) {
        lastErr = err;
      } finally {
        clearTimeout(timer);
      }
    }
    console.error(`Failed to load language ${lang}:`, lastErr);
    // Требование модерации 03.09: отказ не молчит — плашка «Повторить /
    // Перезагрузить» (NetTrouble.ts); снимается, когда словарь доехал.
    showNetTrouble("lang");
    // Датчик: с телефона консоли нет, а «чем именно кончился запрос» — единственное,
    // что отличает мёртвую сеть от висящего fetch и от битого ответа.
    void import("./Health")
      .then(({ reportHealth }) =>
        reportHealth("lang_load_failed", `${lang} ${describeLangError(lastErr)}`),
      )
      .catch(() => undefined);
    return {};
  }

  private async loadLanguageList() {
    try {
      let list: any[] = [];

      const browserLang = new Intl.Locale(navigator.language).language;

      let debugLang: any = null;
      if (this.debugKeyPressed || this.currentLang === "debug") {
        debugLang = {
          code: "debug",
          native: "Debug",
          en: "Debug",
          ru: "Debug",
          svg: "xx",
        };
        this.debugMode = true;
      }

      for (const langData of this.languageMetadata) {
        if (langData.code === "debug" && !debugLang) continue;
        list.push({
          code: langData.code,
          native: langData.native,
          en: langData.en,
          ru: langData.ru,
          svg: langData.svg,
        });
      }

      const currentLangEntry = list.find((l) => l.code === this.currentLang);
      const browserLangEntry =
        browserLang !== this.currentLang && browserLang !== "en"
          ? list.find((l) => l.code === browserLang)
          : undefined;
      const englishEntry =
        this.currentLang !== "en"
          ? list.find((l) => l.code === "en")
          : undefined;

      list = list.filter(
        (l) =>
          l.code !== this.currentLang &&
          l.code !== browserLang &&
          l.code !== "en" &&
          l.code !== "debug",
      );

      list.sort((a, b) => a.en.localeCompare(b.en));

      const finalList: any[] = [];
      if (currentLangEntry) finalList.push(currentLangEntry);
      if (englishEntry) finalList.push(englishEntry);
      if (browserLangEntry) finalList.push(browserLangEntry);
      finalList.push(...list);
      if (debugLang) finalList.push(debugLang);

      this.languageList = finalList;
    } catch (err) {
      console.error("Failed to load language list:", err);
    }
  }

  private async changeLanguage(lang: string) {
    localStorage.setItem("lang", lang);
    // Сообщаем выбор площадке (ТЗ + их дока): язык синхронный в обе стороны.
    void import("./PlatformHost").then(({ Host }) => Host.reportLanguage(lang));
    const loaded = await this.loadLanguage(lang);
    // Пустой словарь = загрузка не удалась. Подменять им живой словарь нельзя:
    // страница разом становится сырыми ключами. Остаёмся на прежнем языке.
    if (Object.keys(loaded).length === 0 && this.translations) {
      console.warn(`[lang] ${lang} не загрузился — остаюсь на ${this.currentLang}`);
      // …но не навсегда: как сеть оживёт, язык площадки/игрока применится сам.
      this.retryUntilLoaded(lang, (flat) => {
        this.translations = flat;
        this.currentLang = lang;
        this.applyTranslation();
        LangSelector.notifyLangLoaded();
      });
      return;
    }
    this.translations = loaded;
    this.currentLang = lang;
    this.applyTranslation();
    LangSelector.notifyLangLoaded();
  }

  private applyTranslation() {
    const components = [
      "host-lobby-modal",
      "join-lobby-modal",
      "emoji-table",
      "leader-board",
      "leaderboard-player-list",
      "leaderboard-clan-table",
      "build-menu",
      "win-modal",
      "game-starting-modal",
      "top-bar",
      "player-panel",
      "replay-panel",
      "help-modal",
      "settings-modal",
      "username-input",
      "game-mode-selector",
      "user-setting",
      "o-modal",
      "o-button",
      "territory-patterns-modal",
      "store-modal",
      "pattern-input",
      "fluent-slider",
      "news-modal",
      "news-button",
      "account-modal",
      "account-settings",
      "leaderboard-modal",
      "flag-input-modal",
      "flag-input",
      "matchmaking-button",
      "token-login",
    ];

    // terron: заголовок вкладки — всегда бренд, БЕЗ перевода. Иначе в языках,
    // где main.title унаследован от апстрима (ar: «OpentFront (النسخة الأولية)»,
    // ko: «오픈 프론트», и «(ALPHA)» в десятках других), в заголовок/Метрику течёт
    // чужой бренд и «альфа». Бренд один — «terron.io».
    // terron: SEO-title вкладки под язык (Google рендерит JS → берёт rendered
    // title). Совпадает с homeTitle() в server/RenderHtml.ts. WikiPage ставит свой.
    document.title =
      this.currentLang === "ru"
        ? "TERRON — браузерная стратегия: захвати мир онлайн"
        : "TERRON — Multiplayer World Conquest Strategy Game";

    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      if (key === null) return;
      const text = this.translateText(key);
      if (text === null) {
        console.warn(`Translation key not found: ${key}`);
        return;
      }
      element.textContent = text;
    });

    const applyAttributeTranslation = (
      dataAttr: string,
      targetAttr: string,
    ): void => {
      document.querySelectorAll(`[${dataAttr}]`).forEach((element) => {
        const key = element.getAttribute(dataAttr);
        if (key === null) return;
        const text = this.translateText(key);
        if (text === null) {
          console.warn(`Translation key not found: ${key}`);
          return;
        }
        element.setAttribute(targetAttr, text);
      });
    };

    applyAttributeTranslation("data-i18n-title", "title");
    applyAttributeTranslation("data-i18n-alt", "alt");
    applyAttributeTranslation("data-i18n-aria-label", "aria-label");
    applyAttributeTranslation("data-i18n-placeholder", "placeholder");

    components.forEach((tag) => {
      document.querySelectorAll(tag).forEach((el) => {
        if (typeof (el as any).requestUpdate === "function") {
          (el as any).requestUpdate();
        }
      });
    });
  }

  public translateText(
    key: string,
    params: Record<string, string | number> = {},
  ): string {
    if (this.currentLang === "debug") {
      return formatDebugTranslation(key, params);
    }

    let text: string | undefined;
    if (this.translations && key in this.translations) {
      text = this.translations[key];
    } else if (this.defaultTranslations && key in this.defaultTranslations) {
      text = this.defaultTranslations[key];
    } else {
      console.warn(`Translation key not found: ${key}`);
      return key;
    }

    for (const param in params) {
      const value = params[param];
      text = text.replace(`{${param}}`, String(value));
    }

    return text;
  }

  private async openModal() {
    this.debugMode = this.debugKeyPressed;
    await this.loadLanguageList();

    const languageModal = document.getElementById(
      "page-language",
    ) as LanguageModal;

    if (languageModal) {
      languageModal.languageList = [...this.languageList];
      languageModal.currentLang = this.currentLang;
      // Use the navigation system
      window.showPage?.("page-language");
    }
  }

  public close() {
    this.isVisible = false;
    this.requestUpdate();
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }
    const currentLang =
      this.languageList.find((l) => l.code === this.currentLang) ??
      (this.currentLang === "debug"
        ? {
            code: "debug",
            native: "Debug",
            en: "Debug",
            svg: "xx",
          }
        : {
            native: "English",
            en: "English",
            svg: "uk_us_flag",
          });

    return html`
      <button
        id="lang-selector"
        title="Change Language"
        @click=${this.openModal}
        class="border-none bg-none cursor-pointer p-0 flex items-center justify-center transition-transform duration-200 hover:scale-[1.1] active:scale-[0.9] opacity-60 hover:opacity-100 w-[40px] h-[40px] lg:w-[56px] lg:h-[56px]"
      >
        <img
          id="lang-flag"
          class="object-contain pointer-events-none transition-all w-[40px] h-[40px] lg:w-[48px] lg:h-[48px]"
          src=${INLINE_FLAGS[currentLang.svg] ??
          assetUrl(`flags/${currentLang.svg}.svg`)}
          alt="flag"
          draggable="false"
        />
      </button>
    `;
  }
}

function flattenTranslations(
  obj: Record<string, any>,
  parentKey = "",
  result: Record<string, string> = {},
): Record<string, string> {
  for (const key in obj) {
    const value = obj[key];
    const fullKey = parentKey ? `${parentKey}.${key}` : key;

    if (typeof value === "string") {
      result[fullKey] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenTranslations(value, fullKey, result);
    } else {
      console.warn("Unknown type", typeof value, value);
    }
  }

  return result;
}

import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../core/AssetUrls";
import { GamePushSDK } from "./GamePushSDK";
import "./LanguageModal";
import { LanguageModal } from "./LanguageModal";
import { formatDebugTranslation, isItchEmbed } from "./Utils";

// terron (бандл-диета 18.07): en.json (82КБ) больше НЕ зашит в бандл — грузится
// тем же fetch-путём, что и остальные языки (см. loadLanguage). Он всё равно
// нужен всем как фолбэк-база, но теперь качается параллельно бандлу и кэшируется
// отдельно; до загрузки компоненты показывают ключи и перерисовываются один раз
// по notifyLangLoaded (этот механизм уже был для ru и всех остальных).
import metadata from "../../resources/lang/metadata.json";

type LanguageMetadata = {
  code: string;
  native: string;
  en: string;
  /** terron: название языка по-русски — вторая строка карточки в русском UI. */
  ru?: string;
  svg: string;
};

@customElement("lang-selector")
export class LangSelector extends LitElement {
  @state() public translations: Record<string, string> | undefined;
  @state() public defaultTranslations: Record<string, string> | undefined;
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
    const platformLang = savedLang
      ? null
      : await GamePushSDK.platformLanguageReady();
    // terron: внутри плеера itch.io площадка англоязычная — стартуем на английском,
    // а не на языке браузера (у русского игрока иначе открывался русский интерфейс
    // на международной витрине). Явный выбор игрока (localStorage) сильнее.
    const embedLang = isItchEmbed() ? "en" : null;
    const userLang = this.getClosestSupportedLang(
      savedLang ?? embedLang ?? platformLang ?? browserLocale,
    );

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

    if (lang === "debug") {
      const empty: Record<string, string> = {};
      this.languageCache.set(lang, empty);
      return empty;
    }

    try {
      const response = await fetch(
        assetUrl(`lang/${encodeURIComponent(lang)}.json`),
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch language ${lang}: ${response.status}`);
      }
      const language = (await response.json()) as Record<string, any>;
      const flat = flattenTranslations(language);
      this.languageCache.set(lang, flat);
      return flat;
    } catch (err) {
      console.error(`Failed to load language ${lang}:`, err);
      return {};
    }
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
    void import("./GamePushSDK").then(({ GamePushSDK }) =>
      GamePushSDK.reportLanguage(lang),
    );
    this.translations = await this.loadLanguage(lang);
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
          src=${assetUrl(`flags/${currentLang.svg}.svg`)}
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

import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { track } from "../Analytics";
import { getApiBase } from "../Api";
import { L, translateText } from "../Utils";
import { APP_STORE_URL, appleIcon, PLAY_URL, playIcon } from "./AndroidPromo";

// время сборки клиента (vite define), для «обновлено … назад» по сайту
declare const __BUILD_TIME__: number | undefined;

@customElement("page-footer")
export class Footer extends LitElement {
  @state() private online: number | null = null;
  @state() private gameUpSec: number | null = null; // аптайм game-процесса (с)
  @state() private games24h: number | null = null; // партий завершено за 24ч
  private onlineTimer = 0;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.fetchOnline();
    void this.fetchGames24h();
    this.onlineTimer = window.setInterval(() => {
      // terron: футер скрыт в матче и не виден в фоновой вкладке —
      // не дёргаем API зря (единственный поллинг, доживавший до матча).
      if (document.body.classList.contains("in-game") || document.hidden) {
        return;
      }
      void this.fetchOnline();
      void this.fetchGames24h();
    }, 30000);
    // язык грузится асинхронно — перерисуем, чтобы translateText подтянул перевод
    window.setTimeout(() => this.requestUpdate(), 800);
    window.setTimeout(() => this.requestUpdate(), 2500);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.onlineTimer);
  }

  // 1 воркер (порт 3001 → /w0). При масштабировании суммировать /w0../wN.
  private async fetchOnline(): Promise<void> {
    try {
      const r = await fetch("/w0/api/online", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { n?: number; up?: number };
      if (typeof d.n === "number") this.online = d.n;
      if (typeof d.up === "number") this.gameUpSec = d.up;
      this.requestUpdate();
    } catch {
      /* ignore */
    }
  }

  private async fetchGames24h(): Promise<void> {
    try {
      const r = await fetch(getApiBase() + "/stats/games24h", {
        cache: "no-store",
      });
      if (!r.ok) return;
      const d = (await r.json()) as { count?: number };
      if (typeof d.count === "number") {
        this.games24h = d.count;
        this.requestUpdate();
      }
    } catch {
      /* ignore */
    }
  }

  // Внутри Android-приложения (Capacitor) ссылка на Google Play не нужна.
  private get inApp(): boolean {
    return (
      typeof (window as unknown as { Capacitor?: unknown }).Capacitor !==
      "undefined"
    );
  }

  // Клик по счётчику онлайна/партий → SPA-переход на /stats (без перезагрузки).
  private openStats = (e: MouseEvent): void => {
    e.preventDefault();
    window.showPage?.("page-stats");
  };

  // относительное время из секунд
  private ago(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    if (s < 60) return translateText("footer.just_now");
    const m = Math.floor(s / 60);
    if (m < 60) return translateText("footer.ago_min", { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return translateText("footer.ago_hour", { n: h });
    return translateText("footer.ago_day", { n: Math.floor(h / 24) });
  }

  private siteAgo(): string {
    const t = typeof __BUILD_TIME__ === "number" ? __BUILD_TIME__ : Date.now();
    return this.ago((Date.now() - t) / 1000);
  }

  // terron: prod/dev-переключатель окружения УБРАН из футера (Apple Guideline 2.2 —
  // «бета-вид»). Вернём позже отдельно (вне App Store-сборки). История — в git.

  /** Открыть документ модалкой (ленивый чанк — текст качается по клику). */
  private openLegal(e: Event, doc: "privacy" | "terms") {
    e.preventDefault();
    track("footer_link", { link: doc });
    void import("../LegalModal").then(({ openLegalDoc }) => openLegalDoc(doc));
  }

  render() {
    // Инлайн-переводы (не пустые data-i18n спаны) — иначе футер мигает: lit
    // рисует пустой спан, i18n дозаполняет асинхронно.
    // До загрузки i18n translateText отдаёт СЫРОЙ ключ → копирайт мигал
    // (ключ → перевод при setTimeout-перерисовке). Стабильный фолбэк убирает мигание.
    const o = translateText("footer.online");
    const onlineLabel = o === "footer.online" ? L("онлайн", "online") : o;
    return html`
      <footer
        class="terron-footer [.in-game_&]:hidden flex items-center justify-center lg:justify-between flex-wrap gap-x-4 lg:gap-x-5 gap-y-1 py-2 px-3 lg:px-6 w-full text-[10px] lg:text-[11px] text-center lg:text-left"
      >
        <span class="opacity-60">
          <!-- terron: копирайт/гитхаб-ссылка временно убраны (вернём — AGPL). -->
          ${translateText("footer.site")}
          ${this.siteAgo()}${this.gameUpSec !== null
            ? html` · ${translateText("footer.game")}
              ${this.ago(this.gameUpSec)}`
            : ""}${this.online !== null || this.games24h !== null
            ? html` ·
                <a
                  href="/stats"
                  class="hover:underline"
                  style="cursor:pointer;color:inherit"
                  title=${L(
                    "Статистика онлайна и партий",
                    "Online & games stats",
                  )}
                  @click=${(e: MouseEvent) => {
                    track("footer_link", { link: "stats" });
                    this.openStats(e);
                  }}
                  >${this.online !== null
                    ? html`${onlineLabel}: ${this.online}`
                    : ""}${this.online !== null && this.games24h !== null
                    ? " · "
                    : ""}${this.games24h !== null
                    ? html`${translateText("footer.games24h")}: ${this.games24h}`
                    : ""}</a
                >`
            : ""}
        </span>
        <div class="flex items-center gap-x-5 gap-y-1 flex-wrap">
          <a
            href="https://t.me/terron_chat"
            target="_blank"
            rel="noopener noreferrer"
            class="t-external-link hover:underline inline-flex items-center gap-1"
            @click=${() => track("tg_click", { place: "footer" })}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              style="flex:0 0 auto;vertical-align:middle"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="12" fill="#229ED9" />
              <path
                d="M17.6 7.3 5.9 11.8c-.74.3-.73.71-.13.9l2.78.86 6.43-4.05c.3-.18.57-.08.35.12l-5.2 4.7-.2 2.85c.28 0 .41-.13.56-.28l1.35-1.3 2.8 2.06c.51.28.88.13 1-.46l1.83-8.6c.18-.74-.28-1.07-.86-.84Z"
                fill="#fff"
              />
            </svg>
            telegram
          </a>
          ${this.inApp
            ? ""
            : html`<a
                  href="${PLAY_URL}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="t-external-link hover:underline inline-flex items-center gap-1"
                  @click=${() => track("googleplay_click", { place: "footer" })}
                >
                  ${playIcon(14)} Google Play
                </a>
                <a
                  href="${APP_STORE_URL}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="t-external-link hover:underline inline-flex items-center gap-1"
                  @click=${() => track("appstore_click", { place: "footer" })}
                >
                  ${appleIcon(14)} App Store
                </a>`}
          <!-- terron: соглашение и политика открываются МОДАЛКОЙ, а не новой
               вкладкой. Внутри площадки (VK/Яндекс) новая вкладка = увод игрока
               из мини-приложения, прямое замечание модерации 25.08.2026.
               href оставлен намеренно: правый клик «открыть в новой вкладке»,
               копирование адреса и переход по прямой ссылке /privacy — /terms
               (их требуют магазины приложений) продолжают работать.
               ⚠️ data-hard-nav — «перехватчик ссылок, руки прочь»: внутри
               площадки SoftNavigate ловит клики по ссылкам в CAPTURE-фазе,
               РАНЬШЕ нашего обработчика, и уводил адрес на /privacy ещё до
               открытия модалки (поймано на проде 25.08). Сам переход при этом
               не случается — его отменяет наш preventDefault. -->
          <a
            href="/terms"
            data-hard-nav
            class="hover:underline"
            style="cursor:pointer"
            title=${translateText("main.terms_of_service")}
            @click=${(e: Event) => this.openLegal(e, "terms")}
            >${translateText("footer.terms")}</a
          >
          <a
            href="/privacy"
            data-hard-nav
            class="hover:underline"
            style="cursor:pointer"
            title=${translateText("main.privacy_policy")}
            @click=${(e: Event) => this.openLegal(e, "privacy")}
            >${translateText("footer.privacy")}</a
          >
          <a
            href="/copyrights"
            class="hover:underline"
            style="cursor:pointer"
            title=${L(
              "Авторство, лицензии и исходный код",
              "Credits, licenses & source",
            )}
            @click=${(e: Event) => {
              e.preventDefault();
              track("footer_link", { link: "credits" });
              window.showPage?.("page-copyrights");
            }}
            >${L("авторство", "credits")}</a
          >
          <a
            href="/glory"
            class="hover:underline"
            style="cursor:pointer"
            title=${L(
              "Зал славы — ютуберы и тестеры",
              "Hall of Fame — creators & testers",
            )}
            @click=${(e: Event) => {
              e.preventDefault();
              track("footer_link", { link: "glory" });
              window.showPage?.("page-hall-of-fame");
            }}
            >${L("зал славы", "hall of fame")}</a
          >
          <a
            href="/wiki"
            class="hover:underline"
            style="cursor:pointer"
            title=${L(
              "Вики: ультимейты, здания, правила спидрана",
              "Wiki: ultimates, buildings, speedrun rules",
            )}
            @click=${(e: Event) => {
              e.preventDefault();
              track("footer_link", { link: "wiki" });
              window.showPage?.("page-wiki");
            }}
            >${L("вики", "wiki")}</a
          >
          <lang-selector></lang-selector>
        </div>
      </footer>
    `;
  }
}

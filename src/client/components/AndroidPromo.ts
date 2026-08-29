import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { track } from "../Analytics";
import { Platform } from "../Platform";
import { L } from "../Utils";

export const PLAY_URL =
  "https://play.google.com/store/apps/details?id=terron.io";

// App Store БЕЗ локали в пути (`/app/…`, не `/ru/app/…`) — Apple сам отдаёт
// страницу на языке пользователя. Жёсткий `/ru/` показывал бы всем русскую.
export const APP_STORE_URL =
  "https://apps.apple.com/app/terron-io/id6782763163";

// Логотип Apple (монохром, наследует currentColor — красим чернилами темы).
export const appleIcon = (size = 26) =>
  html`<svg
    viewBox="0 0 24 24"
    width=${size}
    height=${size}
    style="flex:0 0 auto;vertical-align:middle"
    aria-hidden="true"
  >
    <path
      fill="currentColor"
      d="M16.365 1.43c0 1.14-.42 2.2-1.13 3.02-.85.98-2.24 1.74-3.4 1.65-.14-1.1.44-2.28 1.13-3.02.79-.87 2.2-1.55 3.4-1.65zM20.9 17.3c-.6 1.38-.89 2-1.66 3.22-1.08 1.7-2.6 3.82-4.48 3.83-1.67.02-2.1-1.09-4.37-1.08-2.27.01-2.74 1.1-4.42 1.09-1.88-.02-3.32-1.93-4.4-3.63C-1.02 18.06-1.3 12.7 1.15 9.87c1.06-1.24 2.73-2.02 4.3-2.02 1.6 0 2.6 1.09 4.35 1.09 1.7 0 2.73-1.09 4.6-1.09 1.4 0 2.88.76 3.93 2.08-3.45 1.89-2.89 6.82.57 8.29z"
    />
  </svg>`;

// Иконка Google Play (фирменный «треугольник»). Переиспользуется в баннере и в
// футере, чтобы значок был один и тот же. Цельный <svg> строим через html (тег
// svg в lit — для фрагментов ВНУТРИ <svg>, не для самостоятельной иконки).
export const playIcon = (size = 26) =>
  html`<svg
    viewBox="0 0 24 24"
    width=${size}
    height=${size}
    style="flex:0 0 auto;vertical-align:middle"
    aria-hidden="true"
  >
    <path
      d="M3.6 2.1 13.3 12 3.6 21.9c-.36-.2-.6-.58-.6-1.05V3.15c0-.47.24-.85.6-1.05Z"
      fill="#34a853"
    />
    <path
      d="m16.5 8.8 2.9 1.66c.93.53.93 1.55 0 2.08l-2.9 1.66L13.3 12 16.5 8.8Z"
      fill="#fbbc04"
    />
    <path
      d="M3.6 2.1c.28-.16.63-.18.98.02l11.92 6.68L13.3 12 3.6 2.1Z"
      fill="#ea4335"
    />
    <path
      d="M3.6 21.9 13.3 12l3.2 3.2L4.58 21.88c-.35.2-.7.18-.98.02Z"
      fill="#4285f4"
    />
  </svg>`;

/**
 * Фичер-баннер «скачай приложение». Приложение есть и под Android (Google Play),
 * и под iOS (App Store) — показываем ОБЕ кнопки на всех платформах-браузерах.
 * Внутри самого приложения (Capacitor) баннер не нужен.
 * В дизайне сайта: пергаментный лист, чернила, квадратные кнопки-бейджи.
 */
const DISMISS_KEY = "androidPromoDismissed";

@customElement("android-promo")
export class AndroidPromo extends LitElement {
  @state() private dismissed = (() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  })();

  createRenderRoot() {
    return this;
  }

  private get inApp(): boolean {
    return typeof (window as unknown as { Capacitor?: unknown }).Capacitor !==
      "undefined";
  }

  private dismiss = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    this.dismissed = true;
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  // Кнопка-бейдж магазина: иконка + «Доступно в / <магазин>». Квадрат, чернила.
  private storeBadge(href: string, icon: unknown, store: string) {
    // banner_click = клик по верхнему баннеру «приложение»; плюс конкретный магазин
    const goal =
      store === "App Store" ? "appstore_click" : "googleplay_click";
    return html`<a
      href="${href}"
      target="_blank"
      rel="noopener noreferrer"
      @click=${() => {
        track("banner_click", { store });
        track(goal, { place: "banner" });
      }}
      style="flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;padding:7px 12px;text-decoration:none;background:var(--t-ink,#2b2a24);color:var(--t-parchment,#fff);border:1px solid var(--t-ink,#2b2a24)"
    >
      <span style="color:var(--t-parchment,#fff)">${icon}</span>
      <span style="display:flex;flex-direction:column;line-height:1.05">
        <span style="font-size:9px;letter-spacing:.06em;opacity:.75"
          >${L("Доступно в", "Get it on")}</span
        >
        <span
          style="font-family:var(--t-display,sans-serif);font-weight:700;font-size:14px;letter-spacing:.02em"
          >${store}</span
        >
      </span>
    </a>`;
  }

  render() {
    if (this.inApp || this.dismissed) return nothing;
    return html`
      <div
        class="android-promo group relative flex items-center gap-3 w-full flex-wrap"
        style="background:var(--t-parchment,#fff);border:1px solid var(--t-ink,#2b2a24);box-shadow:var(--t-shadow-sm);padding:10px 14px"
      >
        <div style="flex:1 1 200px;min-width:0">
          <div
            style="font-family:var(--t-display,sans-serif);font-weight:700;letter-spacing:.02em;color:var(--t-ink,#2b2a24);line-height:1.1"
          >
            ${L("TERRON — приложение", "TERRON — the app")}
          </div>
          <div class="t-muted" style="font-size:12px;margin-top:1px">
            ${L(
              "Скачай на телефон — Android или iPhone",
              "Download for Android or iPhone",
            )}
          </div>
        </div>
        <div
          style="flex:0 0 auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap"
        >
          ${Platform.isIOS
            ? // на iOS App Store первым, на прочих — Google Play первым
              html`${this.storeBadge(APP_STORE_URL, appleIcon(22), "App Store")}
              ${this.storeBadge(PLAY_URL, playIcon(22), "Google Play")}`
            : html`${this.storeBadge(PLAY_URL, playIcon(22), "Google Play")}
              ${this.storeBadge(
                APP_STORE_URL,
                appleIcon(22),
                "App Store",
              )}`}
        </div>
        <!-- крестик: на телефоне всегда виден, на десктопе — по наведению -->
        <button
          @click=${this.dismiss}
          class="shrink-0 w-8 flex items-center justify-center opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
          style="color:var(--t-ink-soft,#6b6a62);background:transparent;border:none;cursor:pointer"
          aria-label=${L("Скрыть", "Hide")}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            class="w-4 h-4"
          >
            <path
              d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
            />
          </svg>
        </button>
      </div>
    `;
  }
}

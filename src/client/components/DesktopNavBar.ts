import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { isLoggedIn } from "../Auth";
import { navPath } from "../Navigation";
import { hasReferral } from "../Referral";
import { brandWordmark, isItchEmbed, L, translateText } from "../Utils";
import { NavNotificationsController } from "./NavNotificationsController";

@customElement("desktop-nav-bar")
export class DesktopNavBar extends LitElement {
  private _notifications = new NavNotificationsController(this);
  @state() private loggedIn = false;
  // Идёт вход через площадку (клик у нас ИЛИ окно площадки) — кнопка в шапке
  // обязана показывать процесс, а не молчать до смены на «досье» (репорт
  // владельца 01.08: «висит войти, потом меняется на досье»).
  @state() private signingIn = false;
  private _onLoginPending = () => {
    this.signingIn = true;
  };
  private _onLoginDone = () => {
    this.signingIn = false;
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);
    // Адреса разделов появляются после регистрации роутера — перерисуемся.
    window.addEventListener("nav-paths-ready", this._onNavPaths);
    window.addEventListener("terron-auth-changed", this._onAuthChanged);
    window.addEventListener("gp-login-pending", this._onLoginPending);
    window.addEventListener("gp-login-done", this._onLoginDone);
    void isLoggedIn().then((v) => {
      this.loggedIn = v;
    });

    const current = window.currentPageId;
    if (current) {
      // Wait for render
      this.updateComplete.then(() => {
        this._updateActiveState(current);
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("showPage", this._onShowPage);
    window.removeEventListener("nav-paths-ready", this._onNavPaths);
    window.removeEventListener("terron-auth-changed", this._onAuthChanged);
    window.removeEventListener("gp-login-pending", this._onLoginPending);
    window.removeEventListener("gp-login-done", this._onLoginDone);
  }

  // Вход через площадку не перезагружает страницу — состояние перечитываем.
  private _onAuthChanged = () => {
    void isLoggedIn().then((v) => {
      this.loggedIn = v;
    });
  };

  private _onShowPage = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this._updateActiveState(pageId);
  };

  // Адреса разделов появляются только после регистраций роутера (Main), а
  // навбар успевает отрисоваться раньше — перерисовываемся по сигналу.
  private _onNavPaths = () => this.requestUpdate();

  private _updateActiveState(pageId: string) {
    this.querySelectorAll(".nav-menu-item").forEach((el) => {
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    });
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    return html`
      <nav
        class="hidden lg:flex w-full items-center justify-between gap-4 px-8 lg:px-12 py-5 shrink-0 z-50 relative"
      >
        <div class="flex flex-col items-start justify-center">
          <a
            href="/"
            class="terron-logo"
            aria-label="terron"
            @click=${(e: Event) => {
              // Внутри площадки перезагрузка запрещена (правило SoftNavigate) —
              // лого уводит на главную мягко. Вне площадки softHome сам делает
              // обычный переход.
              e.preventDefault();
              void import("../SoftNavigate").then(({ softHome }) => softHome());
            }}
            >${brandWordmark()}</a
          >
        </div>
        <!-- Desktop Navigation Menu Items (справа) -->
        <div class="nav-items flex items-center gap-2.5">
          ${isItchEmbed()
            ? html`<a
                class="nav-menu-item nav-openout"
                href="https://terron.io/?utm_source=itchio&utm_medium=embed"
                target="_blank"
                rel="noopener"
                >↗ terron.io</a
              >`
            : ""}
          <div class="relative">
            <a
              href=${navPath("page-news")}
              class="nav-menu-item ${currentPage === "page-news"
                ? "active"
                : ""} text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
              data-page="page-news"
              data-i18n="main.news"
              @click=${this._notifications.onNewsClick}
            ></a>
            ${this._notifications.showNewsDot()
              ? html`
                  <span
                    class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping"
                  ></span>
                  <span
                    class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full"
                  ></span>
                `
              : ""}
          </div>
          <div class="relative no-crazygames">
            <a
              href=${navPath("page-shop")}
              class="nav-menu-item ${currentPage === "page-shop"
                ? "active"
                : ""} text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
              data-page="page-shop"
              data-i18n="main.store"
              @click=${this._notifications.onStoreClick}
            ></a>
            ${this._notifications.showStoreDot()
              ? html`
                  <span
                    class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping"
                  ></span>
                  <span
                    class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full"
                  ></span>
                `
              : ""}
          </div>
          <a
            href=${navPath("page-leaderboard")}
            class="nav-menu-item text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
            data-page="page-leaderboard"
          >
            ${L("Рейтинг", "Rating")}
          </a>
          <a
            href=${navPath("page-clan")}
            class="no-crazygames nav-menu-item text-white/70 hover:text-blue-500 font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-blue-500"
            data-page="page-clan"
            data-i18n="main.clans"
          ></a>
          <a
            href=${navPath("page-friends")}
            class="no-crazygames nav-menu-item text-white/70 hover:text-malibu-blue font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue"
            data-page="page-friends"
          >
            ${L("Друзья", "Friends")}
          </a>
          <a
            href=${navPath("page-propaganda")}
            class="nav-menu-item text-white/70 hover:text-malibu-blue font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue"
            data-page="page-propaganda"
          >
            ${L("Пропаганда", "Propaganda")}
          </a>
          <div class="relative">
            <a
              href=${navPath("page-help")}
              class="nav-menu-item text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
              data-page="page-help"
              data-i18n="main.help"
              @click=${this._notifications.onHelpClick}
            ></a>
            ${this._notifications.showHelpDot()
              ? html`
                  <span
                    class="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full animate-ping"
                  ></span>
                  <span
                    class="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full"
                  ></span>
                `
              : ""}
          </div>
          <!-- Настройки: только шестерня, без подложки -->
          <a
            href=${navPath("page-settings")}
            class="nav-menu-item nav-gear cursor-pointer transition-colors"
            data-page="page-settings"
            data-i18n-aria-label="main.settings"
            data-i18n-title="main.settings"
            aria-label="Настройки"
            title="Настройки"
          >
            <svg
              class="w-6 h-6"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
          </a>
          <!-- Залогинен → «Досье» (свой профиль); гость → «Вход» (аккаунт-модалка) -->
          <a
            href=${navPath(this.loggedIn ? "page-profile" : "page-account")}
            class="nav-menu-item nav-profile font-medium tracking-wider uppercase cursor-pointer"
            data-page=${this.loggedIn ? "page-profile" : "page-account"}
            title=${this.loggedIn
              ? translateText("dossier.title")
              : translateText("main.sign_in")}
          >
            ${this.signingIn
              ? html`<span class="animate-pulse"
                  >${L("входим…", "signing in…")}</span
                >`
              : this.loggedIn
                ? translateText("dossier.title")
                : translateText("main.sign_in")}
          </a>
          ${!this.loggedIn && hasReferral()
            ? html`<span
                class="nav-ref-bonus block text-center text-emerald-400 font-bold text-xs leading-none mt-0.5"
                title=${translateText("main.signup_bonus_title")}
                >${translateText("main.signup_bonus_short")}</span
              >`
            : ""}
        </div>
      </nav>
    `;
  }
}

import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { isLoggedIn } from "../Auth";
import { navPath } from "../Navigation";
import { hasReferral } from "../Referral";
import { brandWordmark, isItchEmbed, L, translateText } from "../Utils";
import { NavNotificationsController } from "./NavNotificationsController";

@customElement("mobile-nav-bar")
export class MobileNavBar extends LitElement {
  private _notifications = new NavNotificationsController(this);
  @state() private loggedIn = false;
  // Идёт вход через площадку — кнопка показывает процесс (см. DesktopNavBar).
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
    // terron: переводы грузятся асинхронно — перерисуем, иначе пункты залипают
    // на сырых ключах (MAIN.NEWS, MAIN.STORE…).
    window.setTimeout(() => this.requestUpdate(), 600);
    window.setTimeout(() => this.requestUpdate(), 2000);

    const current = window.currentPageId;
    if (current) {
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
      const inner = el.querySelector("button");
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
        inner?.classList.add("active");
      } else {
        el.classList.remove("active");
        inner?.classList.remove("active");
      }
    });
  }

  private _renderDot(color: string): TemplateResult {
    return html`<span class="relative ml-2 shrink-0 -mt-2 w-2 h-2">
      <span class="absolute inset-0 ${color} rounded-full animate-ping"></span>
      <span class="absolute inset-0 ${color} rounded-full"></span>
    </span>`;
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    return html`
      <!-- Border Segments (Custom right border with gap for button) -->
      <div
        class="absolute right-0 top-0 w-px bg-transparent"
        style="height: calc(50% - 64px)"
      ></div>
      <div
        class="absolute right-0 bottom-0 w-px bg-transparent"
        style="height: calc(50% - 64px)"
      ></div>

      <div
        class="flex-1 w-full flex flex-col justify-start overflow-y-auto lg:pt-[clamp(1rem,3vh,4rem)] lg:pb-[clamp(0.5rem,2vh,2rem)] lg:px-[clamp(1rem,1.5vw,2rem)] pt-4 pb-4 px-5 gap-4 lg:gap-[clamp(1rem,3vh,3rem)]"
      >
        <!-- Logo + Menu -->
        <div
          class="flex flex-col text-malibu-blue mb-4 ml-[clamp(0.2rem,0.4vw,0.4vh)]"
        >
          <div class="flex flex-col items-center gap-1">
            <a
              href="/"
              class="terron-logo"
              aria-label="terron"
              @click=${(e: Event) => {
                // Внутри площадки перезагрузка запрещена (правило SoftNavigate) —
                // лого уводит на главную мягко. Вне площадки softHome сам делает
                // обычный переход.
                e.preventDefault();
                void import("../SoftNavigate").then(({ softHome }) =>
                  softHome(),
                );
              }}
              >${brandWordmark()}</a
            >
            <div
              id="game-version"
              class="l-header__highlightText text-center"
            ></div>
          </div>
        </div>
        <!-- Mobile Navigation Menu Items -->
        ${isItchEmbed()
          ? html`<a
              class="nav-menu-item nav-openout block w-full text-left font-bold uppercase tracking-[0.05em] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
              href="https://terron.io/?utm_source=itchio&utm_medium=embed"
              target="_blank"
              rel="noopener"
              >↗ terron.io</a
            >`
          : ""}
        <div
          class="nav-menu-item flex items-center w-full cursor-pointer"
          data-page="page-news"
          @click=${this._notifications.onNewsClick}
        >
          <button
            class="block text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          >
            ${translateText("main.news")}
          </button>
          ${this._notifications.showNewsDot()
            ? this._renderDot("bg-red-500")
            : ""}
        </div>
        <a
          href=${navPath("page-leaderboard")}
          class="nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-leaderboard"
        >
          ${L("Рейтинг", "Rating")}
        </a>
        <a
          href=${navPath("page-clan")}
          class="no-crazygames nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-clan"
        >
          ${translateText("main.clans")}
        </a>
        <a
          href=${navPath("page-friends")}
          class="no-crazygames nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-friends"
        >
          ${L("Друзья", "Friends")}
        </a>
        <a
          href=${navPath("page-propaganda")}
          class="nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-propaganda"
        >
          ${L("Пропаганда", "Propaganda")}
        </a>
        <div
          class="no-crazygames nav-menu-item flex items-center w-full cursor-pointer"
          data-page="page-shop"
          @click=${this._notifications.onStoreClick}
        >
          <button
            class="block text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          >
            ${translateText("main.store")}
          </button>
          ${this._notifications.showStoreDot()
            ? this._renderDot("bg-red-500")
            : ""}
        </div>
        <div
          class="nav-menu-item flex items-center w-full cursor-pointer"
          data-page="page-help"
          @click=${this._notifications.onHelpClick}
        >
          <button
            class="block text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          >
            ${translateText("main.help")}
          </button>
          ${this._notifications.showHelpDot()
            ? this._renderDot("bg-yellow-400")
            : ""}
        </div>
        <!-- Настройки: шестерня без подложки -->
        <a
          href=${navPath("page-settings")}
          class="nav-menu-item nav-gear flex items-center gap-3 w-full text-left font-bold uppercase tracking-[0.05em] cursor-pointer text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-settings"
        >
          <svg
            class="w-6 h-6 shrink-0"
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
          <span>${translateText("main.settings")}</span>
        </a>
        <!-- Залогинен → «Досье»; гость → «Вход» (аккаунт-модалка) -->
        <a
          href=${navPath(this.loggedIn ? "page-profile" : "page-account")}
          class="nav-menu-item nav-profile block w-full text-left font-bold uppercase tracking-[0.05em] cursor-pointer text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page=${this.loggedIn ? "page-profile" : "page-account"}
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
              class="block text-emerald-400 font-bold text-sm -mt-1 mb-1"
              >${translateText("main.signup_bonus_badge")}</span
            >`
          : ""}
        <div
          class="flex flex-col w-full mt-auto [.in-game_&]:hidden items-end justify-end pt-4 border-t border-white/10"
        ></div>
      </div>
    `;
  }
}

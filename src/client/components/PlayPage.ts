import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getMyProfile } from "../Api";
import { L } from "../Utils";
import type { UsernameInput } from "../UsernameInput";
import "../SkinBarPreview";
import "../SkinInput";
import "./AndroidPromo";
import "./NewsBox";

@customElement("play-page")
export class PlayPage extends LitElement {
  // Вход разрешён (ник/тег валидны). Кнопка ИГРАТЬ блокируется так же, как
  // карточки лобби (источник — username-input.canPlay()).
  @state() private inputValid = true;
  // terron 25.08: аватарка игрока в углу верхней панели (просьба владельца —
  // «вот тут рисуй мою рожу»). Пусто у гостя и у тех, кто её не ставил.
  @state() private avatar: string | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    // забрать текущее значение, если username-input провалидировался раньше нас
    const ui = document.querySelector("username-input") as UsernameInput | null;
    if (ui) this.inputValid = ui.canPlay();
    void this.loadAvatar();
    // Вход/выход происходит без перезагрузки (внутри площадки её и не бывает) —
    // без этого сигнала угол держал бы человечка до F5.
    window.addEventListener("terron-auth-changed", this.onAuthChanged);
  }

  /** Аватарка берётся из профиля: у гостя запрос не уходит вовсе (нет токена). */
  private async loadAvatar(): Promise<void> {
    try {
      const p = await getMyProfile();
      this.avatar = p?.user.avatar ?? null;
    } catch {
      this.avatar = null;
    }
  }

  private onAuthChanged = () => {
    void this.loadAvatar();
  };

  disconnectedCallback() {
    window.removeEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    window.removeEventListener("terron-auth-changed", this.onAuthChanged);
    super.disconnectedCallback();
  }

  private handleValidityChange = (e: Event) => {
    this.inputValid = (e as CustomEvent).detail?.isValid ?? true;
  };

  // ИГРАТЬ → быстрый вход в основное FFA-лобби (делегируем в game-mode-selector)
  private onPlay = () => {
    if (!this.inputValid) return;
    const gms = document.querySelector("game-mode-selector") as
      | (HTMLElement & { joinFfa?: () => void })
      | null;
    gms?.joinFfa?.();
  };

  render() {
    return html`
      <div
        id="page-play"
        class="flex flex-col gap-2 w-full px-0 lg:px-4 min-h-0"
      >
        <token-login class="absolute"></token-login>

        <!-- Mobile: top bar (В ПОТОКЕ, не fixed — иначе перекрывал контент/новости) -->
        <!-- terron iOS: верхний safe-area уже даёт глобальный body{padding} в
             styles.css — тут НЕ дублируем pt, иначе «лоб» над лого. -->
        <div class="lg:hidden bg-surface border-b border-black/15">
          <div
            class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center h-14 px-2 gap-2"
          >
            <button
              id="hamburger-btn"
              style="color:var(--t-ink,#2b2a24);box-shadow:none !important;background:transparent !important"
              class="col-start-1 justify-self-start h-10 shrink-0 aspect-[4/3] flex rounded-md items-center justify-center transition-colors"
              data-i18n-aria-label="main.menu"
              aria-expanded="false"
              aria-controls="sidebar-menu"
              aria-haspopup="dialog"
              data-i18n-title="main.menu"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="size-8"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            </button>

            <div
              class="col-start-2 flex items-center justify-center min-w-0"
            >
              <span
                style="font-family:var(--t-display);font-weight:700;letter-spacing:.18em;text-transform:uppercase;font-size:20px;line-height:1;color:var(--t-ink,#2b2a24)"
                >terron</span
              >
            </div>

            <!-- terron mobile: кнопка входа справа (меню слева · лого центр · вход справа).
                 С аватаркой она становится КВАДРАТОМ ВО ВСЮ ВЫСОТУ ПАНЕЛИ и уходит
                 вплотную в угол (решение владельца 25.08): отрицательные поля
                 съедают px-2 у сетки, скругления снимаем — угол панели квадратный. -->
            <button
              style=${this.avatar
                ? "box-shadow:none !important;background:transparent !important;padding:0"
                : "box-shadow:none !important;background:transparent !important"}
              class=${this.avatar
                ? "col-start-3 justify-self-end h-14 w-14 shrink-0 flex rounded-none items-center justify-center overflow-hidden -mr-2 -my-2"
                : "col-start-3 justify-self-end h-10 shrink-0 aspect-[4/3] flex rounded-md items-center justify-center transition-colors"}
              @click=${() => window.showPage?.("page-account")}
              aria-label=${this.avatar ? L("Аккаунт", "Account") : L("Вход", "Sign in")}
              title=${this.avatar ? L("Аккаунт", "Account") : L("Вход", "Sign in")}
            >
              ${this.avatar
                ? html`<img
                    src=${this.avatar}
                    alt=""
                    style="width:100%;height:100%;object-fit:cover;display:block"
                    @error=${() => (this.avatar = null)}
                  />`
                : html`<svg
                    class="w-6 h-6"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="8" r="3.5" />
                    <path d="M5 20a7 7 0 0 1 14 0" />
                  </svg>`}
            </button>
          </div>
        </div>

        <news-box></news-box>

        <!-- Фичер «играй на Android» (ПК + Android-браузер; закрывается крестиком,
             сам решает скрыться на iOS / внутри приложения / после закрытия) -->
        <android-promo></android-promo>

        <!-- Вход в игру: [флаг] [тег] ник · СКИН + ИГРАТЬ -->
        <div class="play-row w-full flex items-stretch gap-3">
          <div class="play-id flex-1 min-w-0 flex items-center gap-2 h-14">
            <flag-input
              id="flag-input-desktop"
              class="play-flag shrink-0"
              show-select-label
            ></flag-input>
            <username-input
              class="flex-1 min-w-0 flex items-center"
            ></username-input>
            <skin-bar-preview></skin-bar-preview>
            <skin-input class="shrink-0"></skin-input>
          </div>
          <button
            class="play-cta hidden lg:flex items-center justify-center shrink-0 h-14 px-8 lg:px-14 text-lg ${!this
              .inputValid
              ? "opacity-50 cursor-not-allowed pointer-events-none"
              : ""}"
            ?disabled=${!this.inputValid}
            @click=${this.onPlay}
          >
            ${L("играть", "play")}
          </button>
        </div>

        <game-mode-selector></game-mode-selector>
      </div>
    `;
  }
}

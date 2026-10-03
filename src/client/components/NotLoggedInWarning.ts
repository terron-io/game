import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import { getUserMe, isSignedIn } from "../Api";
// ⚠️ onPlatformSurface, а НЕ фасад PlatformHost: фасада нет в прод-дереве.
import { onPlatformSurface } from "../Utils";

/**
 * Красная плашка «Вы не авторизованы» в шапке выбора флага, скинов и магазина.
 *
 * ⚠️ ТРИ БАГА ОДНОГО ЭКРАНА (замечание модерации ВК 08.09, пункт 4 — «на странице
 * выбора флага видим ошибку авторизации» при ВОШЕДШЕМ игроке):
 *  1. признак «вошёл» спрашивал про Discord/почту, которых у игрока с площадки
 *     нет никогда (починено в Api.isSignedIn);
 *  2. внутри площадки плашки не должно быть вовсе (решение владельца 09.09):
 *     вход там автоматический, кнопка «войти» никому не поможет, а красная
 *     надпись «не авторизованы» — ровно то, на что показала модерация. Тот же
 *     гейт, что у ссылок наружу и вкладки «Приглашения»;
 *  3. состояние бралось ТОЛЬКО из события `userMeResponse`, а оно улетает один
 *     раз на старте страницы — модалка открывается позже и события уже не
 *     застаёт, то есть навсегда остаётся в состоянии «не авторизован».
 *     Теперь при подключении спрашиваем текущее состояние сами (ответ
 *     закэширован в getUserMe, лишнего запроса нет).
 */
@customElement("not-logged-in-warning")
export class NotLoggedInWarning extends LitElement {
  @state() private signedIn = false;

  private _onUserMe = (event: CustomEvent<UserMeResponse | false>) => {
    this.signedIn = isSignedIn(event.detail);
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      this._onUserMe as EventListener,
    );
    void getUserMe().then((me) => {
      this.signedIn = isSignedIn(me);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(
      "userMeResponse",
      this._onUserMe as EventListener,
    );
  }

  render() {
    if (onPlatformSurface()) return html``;
    if (this.signedIn) return html``;

    return html`<div class="no-crazygames flex items-center">
      <button
        class="px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 cursor-pointer hover:bg-red-500/30"
        data-i18n="common.not_logged_in"
        @click=${() => {
          window.showPage?.("page-account");
        }}
      >
        Not logged in
      </button>
    </div>`;
  }
}

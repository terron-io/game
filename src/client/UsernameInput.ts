import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { generateCryptoRandomUUID, translateText } from "../client/Utils";
import { sanitizeClanTag } from "../core/Util";
import {
  MAX_CLAN_TAG_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_CLAN_TAG_LENGTH,
  MIN_USERNAME_LENGTH,
  validateClanTag,
  validateUsername,
} from "../core/validations/username";
import { checkClanTagOwnership } from "./ClanApi";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { UserSettings } from "../core/game/UserSettings";

interface LangSelectorLike {
  currentLang?: string;
  translations?: Record<string, string>;
  defaultTranslations?: Record<string, string>;
}

const usernameKey: string = "username";
const clanTagKey: string = "clanTag";

@customElement("username-input")
export class UsernameInput extends LitElement {
  @state() private baseUsername: string = "";
  @state() private clanTag: string = "";

  @property({ type: String }) validationError: string = "";
  // Ownership-check feedback (i18n key) shown inline beneath the tag input. Only
  // "not a member" gates the buttons (see emitValidity); the rest is advisory.
  @state() private clanTagOwnershipError: string = "";
  @state() private clanCheckPending: boolean = false;
  private _isValid: boolean = true;
  private _lastValidatedLang: string | null = null;

  // Latest in-flight ownership check. `clanCheckGen` discards stale results so
  // only the most recent keystroke updates the UI / resolves the submit value.
  private clanCheckGen = 0;
  private clanCheck: Promise<string | null> = Promise.resolve(null);
  // terron: тег, к которому относится текущая ownership-ошибка. Нужен чтобы
  // повторные проверки ТОГО ЖЕ тега (late-auth ретраи 1500/3500мс) не моргали
  // none→set→none — ошибку держим до прихода нового результата.
  private errorForTag: string | null = null;

  // Remove static styles since we're using Tailwind

  createRenderRoot() {
    // Disable shadow DOM to allow Tailwind classes to work
    return this;
  }

  public getUsername(): string {
    return this.baseUsername.trim();
  }

  // terron: внешняя установка ника (например «Надеть» скин на свой ник из /skins).
  public setUsername(name: string): void {
    this.baseUsername = name;
    this.validateAndStore();
    this.requestUpdate();
  }

  public getClanTag(): string | null {
    return this.clanTag.length >= MIN_CLAN_TAG_LENGTH &&
      this.clanTag.length <= MAX_CLAN_TAG_LENGTH &&
      validateClanTag(this.clanTag).isValid
      ? this.clanTag
      : null;
  }

  // Resolves to the clan tag to actually submit (null when it should be
  // dropped). The join flow awaits this so the ownership check — kicked off on
  // input — can run in parallel with the WebSocket handshake.
  public getClanCheck(): Promise<string | null> {
    return this.clanCheck;
  }

  private startClanCheck() {
    const gen = ++this.clanCheckGen;
    const tag = this.clanTag;
    if (tag.length === 0 || !validateClanTag(tag).isValid) {
      // тег пуст/невалиден по синтаксису → ownership-ошибку снимаем сразу
      this.clanTagOwnershipError = "";
      this.errorForTag = null;
      this.clanCheckPending = false;
      this.clanCheck = Promise.resolve(null);
      // тег пуст/невалиден → снять клан-флаг (он был от тега)
      this.clearClanFlagIfSet();
      this.emitValidity();
      return;
    }
    // terron: НЕ обнуляем ошибку при ретрае ТОГО ЖЕ тега — иначе моргает.
    // Сбрасываем только когда тег реально сменился (чужая ошибка не висит).
    if (this.errorForTag !== tag) {
      this.clanTagOwnershipError = "";
      this.errorForTag = null;
    }
    this.clanCheckPending = true;
    this.emitValidity();
    this.clanCheck = checkClanTagOwnership(tag).then((res) => {
      if (gen === this.clanCheckGen) {
        this.clanTagOwnershipError = res.error ?? "";
        this.errorForTag = res.error ? tag : null;
        this.clanCheckPending = false;
        // terron: тег принадлежит клану (член или нет) → надеваем флаг клана
        // («вижу флаг занятого тега»). Свободный тег → снимаем клан-флаг.
        const us = new UserSettings();
        if (res.isClan) {
          const ref = `clan:${tag}`;
          if (us.getFlag() !== ref) us.setFlag(ref);
        } else {
          this.clearClanFlagIfSet();
        }
        this.emitValidity();
      }
      return res.tag;
    });
  }

  // terron: снять клан-флаг, если текущий флаг — клановый (тег убрали/сменили на
  // не-клан). Страновой/косметический флаг не трогаем.
  private clearClanFlagIfSet() {
    const us = new UserSettings();
    const f = us.getFlag() ?? "";
    // `country:clan:` — легаси-форма, испорченная старой миграцией getFlag.
    if (f.startsWith("clan:") || f.startsWith("country:clan:")) {
      us.clearFlag(true);
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadStoredUsername();
    // terron: выбор клана во флаг-меню (FlagInputModal) ставит И тег, И клан-флаг.
    // Тег прилетает сюда событием — синхронизируем инпут + ownership-чек.
    window.addEventListener(
      "terron-clan-picked",
      this.onClanPicked as EventListener,
    );
    crazyGamesSDK.getUsername().then((username) => {
      if (username) {
        this.baseUsername = username;
        this.validateAndStore();
      }
    });
    crazyGamesSDK.addAuthListener((user) => {
      if (user) {
        this.baseUsername = user.username;
        this.validateAndStore();
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      "terron-clan-picked",
      this.onClanPicked as EventListener,
    );
  }

  // terron: применить тег выбранного клана (из флаг-меню). Клан-флаг ставит сам
  // FlagInputModal через UserSettings — здесь только тег + перезапуск проверки.
  private onClanPicked = (e: Event) => {
    const tag = (e as CustomEvent).detail?.tag;
    if (typeof tag !== "string" || tag.length === 0) return;
    this.clanTag = sanitizeClanTag(tag);
    this.validateAndStore();
    this.startClanCheck();
    this.requestUpdate();
  };

  protected updated(): void {
    // Re-validate when translations become available or language changes,
    // since initial validation may run before translations are loaded.
    if (this.validationError) {
      const langSelector = document.querySelector<LangSelectorLike & Element>(
        "lang-selector",
      );
      const lang = langSelector?.currentLang;
      const hasTranslations =
        langSelector?.translations ?? langSelector?.defaultTranslations;
      if (hasTranslations && lang && lang !== this._lastValidatedLang) {
        this._lastValidatedLang = lang;
        this.validateAndStore();
      }
    }
  }

  private loadStoredUsername() {
    // terron: игровой ник = ПОЗЫВНОЙ (этот инпут), НЕ имя аккаунта. Берём
    // сохранённый позывной, иначе генерим анон. Никаких аккаунт-оверрайдов.
    const storedUsername = localStorage.getItem(usernameKey);
    this.clanTag = localStorage.getItem(clanTagKey) ?? "";
    this.baseUsername = storedUsername || genAnonUsername();
    this.validateAndStore();
    this.startClanCheck();
    // terron: первый ownership-чек может прийтись на момент до готовности auth
    // (getUserMe ещё не видит сессию) → участник видел свой тег красным. После
    // того как сессия поднялась, перепроверяем сохранённый тег.
    if (this.clanTag) {
      window.setTimeout(() => this.startClanCheck(), 1500);
      window.setTimeout(() => this.startClanCheck(), 3500);
    }
  }

  render() {
    return html`
      <div class="flex items-center w-full h-full gap-2">
        <div class="relative flex items-center shrink-0">
          <input
            type="text"
            .value=${this.clanTag}
            @input=${this.handleClanTagChange}
            placeholder="${translateText("username.tag")}"
            minlength="${MIN_CLAN_TAG_LENGTH}"
            maxlength="${MAX_CLAN_TAG_LENGTH}"
            aria-busy=${this.clanCheckPending ? "true" : "false"}
            aria-invalid=${this.tagBlocked() ? "true" : "false"}
            class="w-[3.2rem] lg:w-[6rem] text-base lg:text-xl font-medium tracking-wider text-center bg-transparent text-white placeholder-white/70 focus:placeholder-transparent border-0 border-b border-white/40 focus:outline-none focus:border-white/60"
          />
          ${this.clanCheckPending
            ? html`<span
                class="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-white/30 border-t-white/80 rounded-full animate-spin pointer-events-none"
                aria-hidden="true"
              ></span>`
            : null}
        </div>
        <input
          type="text"
          .value=${this.baseUsername}
          @input=${this.handleUsernameChange}
          placeholder="${translateText("username.enter_username")}"
          minlength="${MIN_USERNAME_LENGTH}"
          maxlength="${MAX_USERNAME_LENGTH}"
          class="flex-1 min-w-0 border-0 text-lg lg:text-2xl font-medium tracking-wider text-left text-white placeholder-white/70 focus:outline-none focus:ring-0 overflow-x-auto whitespace-nowrap text-ellipsis pr-2 bg-transparent"
        />
      </div>
      ${this.validationError
        ? html`<div
            id="username-validation-error"
            class="absolute top-full left-0 z-50 w-full mt-1 px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg"
          >
            ${this.validationError}
          </div>`
        : this.clanTagOwnershipError
          ? html`<div
              id="clan-tag-validation-error"
              class="absolute top-full left-0 z-50 w-full mt-1 px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg"
            >
              ${translateText(this.clanTagOwnershipError, {
                tag: this.clanTag,
              })}
            </div>`
          : null}
    `;
  }

  private handleClanTagChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const originalValue = input.value;
    const val = sanitizeClanTag(originalValue);
    // terron: тег больше не апперкейсится — тост только если реально срезали символы.
    if (originalValue.slice(0, 5) !== val) {
      input.value = val;
      // Show toast when invalid characters are removed
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.tag_invalid_chars"),
            color: "red",
            duration: 2000,
          },
        }),
      );
    } else if (originalValue !== val) {
      // Just update the input without toast if only case changed
      input.value = val;
    }
    this.clanTag = val;
    this.validateAndStore();
    this.startClanCheck();
  }

  private handleUsernameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const originalValue = input.value;
    const val = originalValue.replace(/[[\]]/g, "");
    if (originalValue !== val) {
      input.value = val;
      // Show toast when brackets are removed
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.invalid_chars"),
            color: "red",
            duration: 2000,
          },
        }),
      );
    }
    this.baseUsername = val;
    this.validateAndStore();
  }

  private validateAndStore() {
    const trimmedBase = this.getUsername();

    // terron: сообщаем ник наружу — превью скина в полосе ника (SkinBarPreview)
    // резолвит его в зарегистрированный скин и рисует фоном. Дебаунс — на стороне слушателя.
    window.dispatchEvent(
      new CustomEvent("terron-nick-changed", { detail: { nick: trimmedBase } }),
    );

    const clanTagResult = validateClanTag(this.clanTag);
    if (!clanTagResult.isValid) {
      this._isValid = false;
      this.validationError = clanTagResult.error ?? "";
      this.emitValidity();
      return;
    }

    const result = validateUsername(trimmedBase);
    this._isValid = result.isValid;
    if (result.isValid) {
      localStorage.setItem(usernameKey, trimmedBase);
      localStorage.setItem(clanTagKey, this.getClanTag() ?? "");
      this.validationError = "";
    } else {
      this.validationError = result.error ?? "";
    }
    this.emitValidity();
  }

  // Broadcast play-eligibility so action buttons can disable themselves.
  private emitValidity() {
    window.dispatchEvent(
      new CustomEvent("username-validity-change", {
        detail: { isValid: this.canPlay() },
      }),
    );
  }

  // Play-eligibility: syntax-valid and the clan tag isn't in ANY red state
  // (not-a-member / check-failed). terron: красный тег = вход заблокирован.
  public canPlay(): boolean {
    return this._isValid && this.clanTagOwnershipError === "";
  }

  // terron: тег в ошибочном (красном) состоянии — синтаксис ИЛИ ownership.
  // Используется для подсветки текста инпута тега красным.
  private tagBlocked(): boolean {
    return (
      (this.clanTag.length > 0 && !validateClanTag(this.clanTag).isValid) ||
      this.clanTagOwnershipError !== ""
    );
  }
}

export function genAnonUsername(): string {
  const uuid = generateCryptoRandomUUID();
  const cleanUuid = uuid.replace(/-/g, "").toLowerCase();
  const decimal = BigInt(`0x${cleanUuid}`);
  const threeDigits = decimal % 1000n;
  return "Anon" + threeDigits.toString().padStart(3, "0");
}

import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  getMyProfile,
  invalidateUserMe,
  updateMe,
  type TerronProfile,
} from "./Api";
import {
  loginWithCode,
  logOut,
  notifyAuthChanged,
  sendMagicLink,
} from "./Auth";
import { platformIcon, platformLabel } from "./components/ui/platformBadge";
import { GamePushSDK } from "./GamePushSDK";
import { toast } from "./Toast";
import type { UsernameInput } from "./UsernameInput";
import { brandDisplay, L, translateText } from "./Utils";

/** Игра открыта внутри iframe площадки (Яндекс.Игры/VK/…). Класс ставит
 *  index.html синхронно, ещё до загрузки SDK — годится для первого рендера.
 *  Требование модерации: внутри площадки СВОЕЙ формы входа быть не должно. */
function isOnGamePlatform(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("gp-embed")
  );
}

/** terron: документы открываем модалкой — не уводим игрока из игры (LegalModal).
 *  ⚠️ У ссылок стоит `data-hard-nav`: внутри площадки перехватчик ссылок
 *  (SoftNavigate) срабатывает в capture-фазе РАНЬШЕ этого обработчика и уводил
 *  адрес на /privacy. Переход всё равно отменяется нашим preventDefault. */
function openLegal(e: Event, doc: "privacy" | "terms"): void {
  e.preventDefault();
  void import("./LegalModal").then(({ openLegalDoc }) => openLegalDoc(doc));
}

/**
 * Тело экрана аккаунта — ТОЛЬКО данные входа и настройки (имя, slug, выход).
 * Используется и как первый таб настроек (/settings), и как страница /account.
 * Стиль — общие .t-* классы из terron-theme.css.
 */
@customElement("account-settings")
export class AccountSettings extends LitElement {
  @state() private email = "";
  @state() private code = "";
  @state() private sent = false; // письмо отправлено → показываем поле кода
  @state() private sending = false;
  @state() private resendIn = 0; // секунды до повторной отправки
  private resendTimer?: number;
  @state() private loading = false;
  @state() private profile: TerronProfile | null = null;
  @state() private editName = "";
  @state() private editSlug = "";
  @state() private saveError = "";
  @state() private saved = false;
  @state() private saving = false;
  // согласие с условиями — базово включено (юзер может снять).
  // Apple UGC 1.2: активное согласие — по умолчанию НЕ отмечено, юзер сам ставит.
  @state() private acceptTerms = false;
  @state() private platformLoggingIn = false;
  // под-раздел из /account/<view>: "delete" → страница удаления (только залогиненным).
  @property({ type: String }) view = "";

  createRenderRoot() {
    return this; // light DOM → тема применяется
  }

  connectedCallback() {
    super.connectedCallback();
    void this.load();
    // SDK площадки поднимается асинхронно: экран мог отрисоваться раньше и
    // остаться без кнопки входа. Перерисовываемся, когда он готов.
    window.addEventListener("gp-ready", this.onGpReady);
    window.addEventListener("gp-login", this.onGpReady);
    // Сессию гасят и МИМО этой страницы (выход на площадке, сверка на старте) —
    // без подписки тут оставалась форма уже мёртвого аккаунта (ТЗ 31.07).
    window.addEventListener("terron-auth-changed", this.onGpReady);
    // Крутилка на ВЕСЬ вход, откуда бы он ни стартовал: вход через окно
    // площадки идёт мимо наших кнопок, и без сигналов SDK экран молчал
    // 2 секунды (репорт владельца 01.08).
    window.addEventListener("gp-login-pending", this.onLoginPending);
    window.addEventListener("gp-login-done", this.onLoginDone);
  }

  private onLoginPending = () => {
    this.platformLoggingIn = true;
  };
  private onLoginDone = () => {
    this.platformLoggingIn = false;
  };

  private onGpReady = () => {
    this.requestUpdate();
    void this.load();
  };

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.resendTimer) clearInterval(this.resendTimer);
    window.removeEventListener("gp-ready", this.onGpReady);
    window.removeEventListener("gp-login", this.onGpReady);
    window.removeEventListener("terron-auth-changed", this.onGpReady);
    window.removeEventListener("gp-login-pending", this.onLoginPending);
    window.removeEventListener("gp-login-done", this.onLoginDone);
  }

  private startResendCooldown(sec = 45): void {
    this.resendIn = sec;
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.resendTimer = window.setInterval(() => {
      this.resendIn -= 1;
      if (this.resendIn <= 0) {
        clearInterval(this.resendTimer);
        this.resendTimer = undefined;
        this.resendIn = 0;
      }
    }, 1000);
  }

  render(): TemplateResult {
    if (this.loading) {
      return html`<div class="t-page">
        <div class="t-muted">${L("Загрузка…", "Loading…")}</div>
      </div>`;
    }
    // /account/delete — страница удаления ТОЛЬКО для залогиненных; гость → форма входа.
    if (this.view === "delete") {
      return html`<div class="t-page">
        ${this.profile ? this.renderDeleteView() : this.renderLoginOptions()}
      </div>`;
    }
    return html`<div class="t-page">
      ${this.profile ? this.renderSettings() : this.renderLoginOptions()}
    </div>`;
  }

  // Страница «Удаление аккаунта» в нашем дизайне (terron-тема). Запрос — письмом
  // (как раньше в статике), без in-app кнопки/эндпоинта. Двуязычная.
  private renderDeleteView(): TemplateResult {
    const email = this.profile?.user.email ?? "";
    const mailto =
      "mailto:support@terron.io?subject=" +
      encodeURIComponent(
        L("Запрос на удаление аккаунта", "Account deletion request"),
      ) +
      "&body=" +
      encodeURIComponent(
        L(
          "Прошу удалить мой аккаунт terron и связанные персональные данные.",
          "Please delete my terron account and the associated personal data.",
        ) +
          (email
            ? `\n\n${L("Почта аккаунта", "Account email")}: ${email}`
            : ""),
      );
    return html`
      <h3 class="t-h3" style="margin-top:0">
        ${L("Удаление аккаунта", "Delete account")}
      </h3>
      <p class="t-muted" style="line-height:1.6">
        ${L(
          "Вы можете запросить удаление аккаунта TERRON.io и связанных персональных данных. Удаление необратимо: прогресс, рейтинг, достижения и баланс валют (ценные бумаги и кровавые алмазы) будут стёрты.",
          "You can request deletion of your TERRON.io account and the associated personal data. Deletion is irreversible: progress, rating, achievements and your currency balance (securities and blood diamonds) will be wiped.",
        )}
      </p>
      <h3 class="t-h3">${L("Как это работает", "How it works")}</h3>
      <ol class="t-muted" style="line-height:1.7;padding-left:20px">
        <li>
          ${L(
            "Вы отправляете запрос с привязанной к аккаунту почты.",
            "You send a request from the email linked to your account.",
          )}
        </li>
        <li>
          ${L(
            "Аккаунт помечается на удаление — действует льготный период 30 дней, любой вход в это время отменяет удаление.",
            "The account is marked for deletion — there is a 30-day grace period, and any sign-in during it cancels the deletion.",
          )}
        </li>
        <li>
          ${L(
            "По истечении 30 дней аккаунт и персональные данные удаляются.",
            "After 30 days the account and personal data are removed.",
          )}
        </li>
      </ol>
      <div style="margin-top:18px;display:flex;gap:12px;flex-wrap:wrap">
        <a class="t-btn danger" style="text-decoration:none" href=${mailto}>
          ${L("Запросить удаление", "Request deletion")}
        </a>
        <button
          class="t-btn ghost"
          @click=${() => {
            this.view = "";
            history.replaceState(history.state, "", "/account");
          }}
        >
          ${L("Назад", "Back")}
        </button>
      </div>
      <div
        class="t-muted"
        style="font-size:12px;margin-top:18px;line-height:1.5"
      >
        ${L(
          "Часть обезличенных/агрегированных данных и данные, которые мы обязаны хранить по закону, могут сохраняться после удаления. См.",
          "Some anonymized/aggregated data and data we are legally required to keep may be retained after deletion. See",
        )}
        <a
          href="/privacy"
          data-hard-nav
          class="t-link"
          style="cursor:pointer"
          @click=${(e: Event) => openLegal(e, "privacy")}
          >${L("Политику конфиденциальности", "Privacy Policy")}</a
        >.
      </div>
    `;
  }

  private renderSettings(): TemplateResult {
    const u = this.profile!.user;
    return html`
      <div class="t-id">
        <!-- terron 25.08: показываем САМУ аватарку, если она есть. Экран
             аккаунта рисовал ТОЛЬКО букву имени — и владелец, у которого
             аватарка с ВК уже лежала в базе, смотрел на «Р» и справедливо
             считал, что ничего не работает. Буква остаётся фолбэком. -->
        <div class="t-avatar">
          ${u.avatar
            ? html`<img
                src=${u.avatar}
                alt=""
                style="width:100%;height:100%;object-fit:cover;display:block"
              />`
            : (u.name || "?").slice(0, 1).toUpperCase()}
        </div>
        <div style="min-width:0">
          <div class="t-name">
            ${u.name}
            ${u.number
              ? html`<span
                  style="font-size:13px;font-weight:700;opacity:.5;font-family:var(--t-mono,monospace);margin-left:8px"
                  title=${L("Номер аккаунта", "Account number")}
                  >#${u.number}</span
                >`
              : ""}
          </div>
          <div class="t-slug">
            ${u.slug
              ? `@${u.slug}`
              : `#${u.number} · ${L("адрес не задан", "address not set")}`}
          </div>
        </div>
      </div>

      <h3 class="t-h3">${L("Данные входа", "Sign-in details")}</h3>
      <div class="t-stat">
        <div class="t-stat-lbl">${L("Вход через", "Sign in via")}</div>
        <div class="t-stat-val" style="font-size:16px">
          ${u.email ?? this.providerLabel(u.authProvider)}
        </div>
      </div>

      <h3 class="t-h3">${L("Настройки аккаунта", "Account settings")}</h3>
      <div class="t-field">
        <label class="t-label">${L("Отображаемое имя", "Display name")}</label>
        <input
          class="t-input"
          .value=${this.editName}
          @input=${(e: Event) => {
            this.editName = (e.target as HTMLInputElement).value;
            this.saved = false;
          }}
        />
      </div>
      <div class="t-field">
        <label class="t-label"
          >${L("Адрес профиля", "Profile address")} —
          terron.io/@${this.editSlug || u.number}</label
        >
        <input
          class="t-input"
          placeholder=${String(u.number)}
          .value=${this.editSlug}
          @input=${(e: Event) => {
            this.editSlug = (e.target as HTMLInputElement).value;
            this.saved = false;
          }}
        />
        ${(() => {
          const s = this.slugSuggestion();
          return s && s !== this.editSlug
            ? html`<div class="t-muted" style="font-size:12px;margin-top:6px">
                ${L("Не задан — открывается по", "Not set — opens via")}
                <b>#${u.number}</b>. ${L("Предложить:", "Suggest:")}
                <button
                  class="t-link"
                  style="background:none;border:none;box-shadow:none;cursor:pointer;font-size:12px;font-weight:700"
                  @click=${() => {
                    this.editSlug = s;
                    this.saved = false;
                  }}
                >
                  @${s}
                </button>
              </div>`
            : "";
        })()}
      </div>
      ${this.saveError ? html`<div class="t-err">${this.saveError}</div>` : ""}
      ${this.saved
        ? html`<div class="t-muted">${L("Сохранено ✓", "Saved ✓")}</div>`
        : ""}

      <div
        style="display:flex;align-items:center;gap:12px;margin-top:18px;flex-wrap:wrap"
      >
        <button
          class="t-btn"
          ?disabled=${this.saving}
          @click=${() => this.save()}
        >
          ${this.saving ? L("Сохранение…", "Saving…") : L("Сохранить", "Save")}
        </button>
        <a class="t-btn ghost" style="text-decoration:none" href=${u.url}>
          ${L("Открыть досье", "Open dossier")}
        </a>
        <button
          class="t-btn danger"
          style="margin-left:auto"
          @click=${() => this.handleLogout()}
        >
          ${translateText("account_modal.log_out")}
        </button>
      </div>

      <div style="margin-top:22px">
        <button
          class="t-link"
          style="background:none;border:none;box-shadow:none;cursor:pointer;color:#b23b3b;font-size:13px"
          @click=${() => {
            this.view = "delete";
            history.replaceState(history.state, "", "/account/delete");
          }}
        >
          ${L("Удалить аккаунт", "Delete account")}
        </button>
      </div>
    `;
  }

  // Предложение slug из локальной части почты (до @), очищенное под правила slug.
  private slugSuggestion(): string {
    const local = (this.profile?.user.email ?? "").split("@")[0] ?? "";
    const s = local
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 20);
    return s.length >= 3 ? s : "";
  }

  private async save(): Promise<void> {
    if (!this.profile) return;
    this.saveError = "";
    this.saved = false;
    this.saving = true;
    const patch: { name?: string; slug?: string } = {};
    if (this.editName !== this.profile.user.name) patch.name = this.editName;
    // slug задаём только если непустой и изменился (пустой = не трогаем, остаётся #номер)
    const s = this.editSlug.trim();
    if (s && s !== (this.profile.user.slug ?? "")) patch.slug = s;
    if (!patch.name && !patch.slug) {
      this.saving = false;
      return;
    }
    const r = await updateMe(patch);
    this.saving = false;
    if (!r.ok) {
      this.saveError = r.error ?? L("Не удалось сохранить", "Couldn't save");
      return;
    }
    this.saved = true;
    await this.load();
  }

  // Иконка-плюшка: маленький SVG в кружке-пергаменте (айдентика темы).
  private benefitIcon(path: string): TemplateResult {
    return html`<span
      style="flex:0 0 auto;width:38px;height:38px;display:flex;align-items:center;justify-content:center;background:var(--t-sheet,#fdfcf7);border:1px solid var(--t-line);border-radius:10px"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--t-red,#a8432b)"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d=${path}></path>
      </svg>
    </span>`;
  }

  private benefitRow(
    iconPath: string,
    title: string,
    desc: string,
  ): TemplateResult {
    return html`<div
      style="display:flex;gap:12px;align-items:center;padding:8px 0"
    >
      ${this.benefitIcon(iconPath)}
      <div style="min-width:0">
        <div
          style="font-family:var(--t-display,sans-serif);font-weight:700;color:var(--t-ink);line-height:1.15"
        >
          ${title}
        </div>
        <div class="t-muted" style="font-size:12.5px;line-height:1.3">
          ${desc}
        </div>
      </div>
    </div>`;
  }

  private renderBenefits(): TemplateResult {
    // штрихи иконок (24×24): скины/ачивки/кланы/профиль/рейтинг
    const ICON = {
      // ведро-заливка (paint bucket) — «раскрась территорию»
      skin: "M19 11l-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z M5 2l5 5 M2.5 13.2h15 M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z",
      // звезда — награда/ачивка
      ach: "M12 3.5l2.6 5.6 6.1.5-4.6 4 1.4 6L12 16.9 6.1 19.6l1.4-6-4.6-4 6.1-.5L12 3.5Z",
      // флаг-пеннант — клан-тег
      clan: "M5 21V3.5 M5 4.5h12l-2.6 3.8 2.6 3.7H5",
      // человек — профиль
      profile: "M5 21a7 7 0 0 1 14 0 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
      // столбики — рейтинг/таблица
      rating: "M4 20V11 M10 20V4 M16 20v-6 M2 20h20",
    };
    return html`<div style="flex:1 1 290px;min-width:260px">
      <div
        style="font-family:var(--t-display,sans-serif);font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--t-ink);margin-bottom:6px"
      >
        ${L("Что даёт аккаунт", "What an account gives you")}
      </div>
      ${this.benefitRow(
        ICON.skin,
        L("Скины территории", "Territory skins"),
        L("Раскрась свою землю на карте", "Paint your land on the map"),
      )}
      ${this.benefitRow(
        ICON.ach,
        L("Ачивки и награды", "Achievements & rewards"),
        L("Досье, квесты, валюты", "Dossier, quests, currencies"),
      )}
      ${this.benefitRow(
        ICON.clan,
        L("Кланы", "Clans"),
        L("Играй с друзьями под тегом", "Play with friends under a tag"),
      )}
      ${this.benefitRow(
        ICON.profile,
        L("Профиль и реплеи", "Profile & replays"),
        L("Статистика, история матчей, ник", "Stats, match history, nick"),
      )}
      ${this.benefitRow(
        ICON.rating,
        L("Рейтинг", "Rating"),
        L("Место в таблице ФФА ПВП", "Your spot in the FFA PvP ladder"),
      )}
    </div>`;
  }

  private renderLoginOptions(): TemplateResult {
    return html`
      <div style="max-width:760px;margin:0 auto">
        <!-- айдентика -->
        <div style="text-align:center;margin-bottom:6px">
          <div
            style="font-family:var(--t-display,sans-serif);font-weight:700;letter-spacing:.24em;font-size:30px;color:var(--t-ink);line-height:1"
          >
            ${brandDisplay()}
          </div>
          <div class="t-muted" style="margin-top:6px">
            ${L(
              "Войди, чтобы сохранять прогресс и забрать своё.",
              "Sign in to save your progress and claim what's yours.",
            )}
          </div>
        </div>

        <div
          style="display:flex;gap:18px;flex-wrap:wrap;align-items:stretch;margin-top:16px"
        >
          ${this.renderBenefits()}

          <!-- карточка входа -->
          <div
            style="flex:1 1 290px;min-width:260px;background:var(--t-parchment,#fff);border:1px solid var(--t-ink,#2b2a24);box-shadow:var(--t-shadow);padding:18px"
          >
            <p
              class="t-muted"
              style="margin-bottom:14px;text-align:center;font-size:13px"
            >
              ${translateText("account_modal.sign_in_desc")}
            </p>
            <!-- terron: вход через Discord временно отключён (бэкенд 404). -->
            ${isOnGamePlatform()
              ? this.renderPlatformLogin()
              : html`
                  ${this.sent
                    ? this.renderCodeStage()
                    : this.renderEmailStage()}
                  ${this.sent ? "" : this.renderTerms()}

                  <!-- успокаивающий текст: вход у НАС, не «хз где» -->
                  <div
                    class="t-muted"
                    style="font-size:11.5px;line-height:1.5;margin-top:14px;text-align:center"
                  >
                    ${L(
                      "Без пароля. Вход по коду из письма — прямо на TERRON.io, не через сторонние сервисы. Хранится только почта; играть можно и без аккаунта.",
                      "No password. Sign in with an email code — right on TERRON.io, no third parties. We store only your email; you can play without an account.",
                    )}
                  </div>
                `}
          </div>
        </div>

        <div style="text-align:center;margin-top:16px">
          <button
            class="t-link"
            style="background:none;border:none;box-shadow:none;cursor:pointer;font-size:12px"
            @click=${() => this.handleLogout()}
          >
            ${translateText("account_modal.clear_session")}
          </button>
        </div>
      </div>
    `;
  }

  /** Человеческое название способа входа. Раньше при отсутствии email тут
   *  жёстко стояло «Discord» (наследство апстрима) — вошедший через игровую
   *  площадку видел чужой сервис вместо своего (замечание модератора 30.07). */
  private providerLabel(provider?: string | null): string {
    switch (provider) {
      case "gamepush": {
        // terron 25.08: пишем ИМЯ ПЛОЩАДКИ, а не «игровую площадку» (просьба
        // владельца: «вход через вк — так и пиши»). GamePush тут посредник, и
        // игроку он ничего не говорит. Пока SDK не поднялся, тип неизвестен —
        // тогда остаётся прежняя общая фраза.
        const type = GamePushSDK.platformType();
        return type && type !== "NONE"
          ? platformLabel(type)
          : L("Игровую площадку", "the game platform");
      }
      case "yandex":
        return L("Яндекс", "Yandex");
      case "vk":
        return "VK";
      case "google":
        return "Google";
      case "discord":
        return "Discord";
      default:
        return L("Неизвестно", "Unknown");
    }
  }

  // Вход ВНУТРИ ПЛОЩАДКИ: своей формы не показываем — зовём окно площадки.
  // Если площадка входа не даёт (или мы гость без её авторизации) — честно
  // пишем, что аккаунт заводится на самом сайте.
  private renderPlatformLogin(): TemplateResult {
    // Идёт вход (нашей кнопкой ИЛИ через окно площадки) — вместо кнопок
    // крутилка: молчание на 2 секунды читалось как «ничего не происходит».
    if (this.platformLoggingIn) {
      return html`<div style="text-align:center;padding:14px 0">
        <span class="t-login-spin"></span>
        <div class="t-muted" style="margin-top:12px;font-size:13px">
          ${L("Входим…", "Signing in…")}
        </div>
      </div>`;
    }
    if (GamePushSDK.isPlayerLoggedIn()) {
      // ⚠️ ЭТОТ ЭКРАН РИСУЕТСЯ ТОЛЬКО КОГДА НАШЕЙ СЕССИИ НЕТ (залогиненным
      // показывается renderSettings). «Площадка знает игрока, а мы нет» —
      // не повод писать «всё сохраняется» и не давать НИ ОДНОЙ кнопки (тупик,
      // репорт владельца 31.07: «жму sign in и ничего не происходит»).
      // Даём дожать вход на наш бэкенд — окно площадки уже не нужно.
      return html`
        <button
          class="t-btn"
          style="width:100%"
          ?disabled=${this.platformLoggingIn}
          @click=${() => this.handleBackendRelogin()}
        >
          ${this.platformLoggingIn
            ? L("Входим…", "Signing in…")
            : L("Войти", "Sign in")}
        </button>
        <div
          class="t-muted"
          style="font-size:11.5px;line-height:1.5;margin-top:14px;text-align:center"
        >
          ${L(
            "Площадка тебя уже знает — осталось поднять аккаунт TERRON.",
            "The platform already knows you — one tap to bring up your TERRON account.",
          )}
        </div>
      `;
    }
    const canLogin = GamePushSDK.canPlatformLogin();
    // Вход по коду GamePush — ВТОРАЯ КНОПКА У НАС, а не пункт в их модалке.
    // Раньше клик по «Войти» открывал промежуточный экран площадки со списком
    // способов; мы этот выбор делаем сами (просьба владельца 31.07), а SDK
    // зовём уже с готовым ответом. Кнопку показываем только если площадка
    // код принимает — иначе она бы вела в никуда.
    const canCode = GamePushSDK.canSecretCodeLogin();
    // Имя и значок берём у площадки: «Войти через Яндекс Игры» вместо
    // обезличенного «через площадку» (просьба владельца 31.07). Незнакомая
    // площадка и момент до готовности SDK — фолбэк и в имени, и в значке.
    const pType = GamePushSDK.platformType();
    return html`
      ${canLogin
        ? html`<button
            class="t-btn"
            style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px"
            ?disabled=${this.platformLoggingIn}
            @click=${() => this.handlePlatformLogin(false)}
          >
            ${this.platformLoggingIn
              ? L("Входим…", "Signing in…")
              : html`${platformIcon(pType, 17)}
                  <span
                    >${L("Войти через", "Sign in with")}
                    ${platformLabel(pType)}</span
                  >`}
          </button>`
        : ""}
      ${canCode
        ? html`<button
            class="t-btn ghost"
            style="width:100%;margin-top:8px"
            ?disabled=${this.platformLoggingIn}
            @click=${() => this.handlePlatformLogin(true)}
          >
            ${L("У меня есть код", "I have a code")}
          </button>`
        : ""}
      <div
        class="t-muted"
        style="font-size:11.5px;line-height:1.5;margin-top:${canLogin
          ? "14px"
          : "0"};text-align:center"
      >
        ${canLogin
          ? L(
              "Вход выполняется средствами площадки — пароль и почту мы не спрашиваем.",
              "Signing in is handled by the platform — we never ask for your email or password.",
            )
          : L(
              "Играть можно без аккаунта: прогресс сохраняется на площадке.",
              "You can play without an account — progress is saved on the platform.",
            )}
      </div>
    `;
  }

  private async handlePlatformLogin(withSecretCode = false): Promise<void> {
    this.platformLoggingIn = true;
    try {
      const ok = await GamePushSDK.platformLogin(withSecretCode);
      await this.finishPlatformLogin(ok);
    } finally {
      this.platformLoggingIn = false;
    }
  }

  /** Игрок УЖЕ авторизован на площадке, а нашей сессии нет — окно площадки не
   *  нужно, дожимаем только наш бэкенд (челлендж + /auth/ya). */
  private async handleBackendRelogin(): Promise<void> {
    this.platformLoggingIn = true;
    try {
      GamePushSDK.clearExplicitLogout(); // клик «Войти» = явное намерение
      const ok = await GamePushSDK.loginToBackend();
      await this.finishPlatformLogin(ok);
    } finally {
      this.platformLoggingIn = false;
    }
  }

  private async finishPlatformLogin(ok: boolean): Promise<void> {
    if (!ok) {
      // Молчание при отказе = «жму и ничего не происходит» (репорт владельца
      // 31.07). Причина уже в консоли ([gp] /auth/ya вернул …) — игроку хватит
      // честного «не вышло, попробуй ещё».
      toast(
        L(
          "Вход не удался — попробуй ещё раз.",
          "Sign-in failed — please try again.",
        ),
        "error",
      );
      return;
    }
    toast(L("Вход выполнен", "Signed in"), "success");
    // Позывной с площадки: игрок вошёл и вправе ожидать, что игра знает его
    // имя. Свой ник НЕ перетираем — только заполняем пустой/автогенерённый.
    this.adoptPlatformName();
    invalidateUserMe();
    notifyAuthChanged(); // иначе кнопка «Войти» в шапке висит до F5
    await this.load();
    // Страница аккаунта после входа пуста (форма входа исчезла) — уводим в
    // досье, где и лежит то, ради чего входили: статистика, награды, кланы.
    window.showPage?.("page-profile");
  }

  /** Ставит имя с площадки позывным, если своего осмысленного ника ещё нет
   *  (пусто или автоген «Anon####»). Явно выбранный ник игрока не трогаем. */
  private adoptPlatformName(): void {
    const name = GamePushSDK.platformName();
    if (!name) return;
    const input = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    const current = input?.getUsername()?.trim() ?? "";
    if (current && !/^Anon\d+$/i.test(current)) return;
    input?.setUsername(name);
  }

  // Чек «принимаю условия» — базово включён; гейтит отправку кода.
  private renderTerms(): TemplateResult {
    return html`<label
      style="display:flex;gap:8px;align-items:flex-start;margin-top:12px;cursor:pointer"
    >
      <input
        type="checkbox"
        .checked=${this.acceptTerms}
        @change=${(e: Event) =>
          (this.acceptTerms = (e.target as HTMLInputElement).checked)}
        style="margin-top:2px;flex:0 0 auto;width:16px;height:16px;accent-color:var(--t-ink,#2b2a24)"
      />
      <span class="t-muted" style="font-size:12px;line-height:1.4">
        ${L("Принимаю", "I accept the")}
        <a
          href="/terms"
          data-hard-nav
          class="t-link"
          style="cursor:pointer"
          @click=${(e: Event) => openLegal(e, "terms")}
          >${L("условия соглашения", "terms")}</a
        >
        ${L("и", "and")}
        <a
          href="/privacy"
          data-hard-nav
          class="t-link"
          style="cursor:pointer"
          @click=${(e: Event) => openLegal(e, "privacy")}
          >${L("политику конфиденциальности", "privacy policy")}</a
        >.
        ${L(
          "Объектный контент и абьюз в чате запрещены — нарушителей баним.",
          "No tolerance for objectionable content or abusive behavior — offenders are banned.",
        )}
      </span>
    </label>`;
  }

  // Шаг 1 — ввод почты. Отправляем письмо (код + ссылка), затем шаг 2.
  private renderEmailStage(): TemplateResult {
    return html`
      <div class="t-field">
        <input
          class="t-input"
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          .value=${this.email}
          @input=${(e: Event) =>
            (this.email = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") this.handleSubmit();
          }}
          placeholder=${translateText("account_modal.email_placeholder")}
        />
      </div>
      <button
        class="t-btn"
        style="width:100%"
        ?disabled=${this.sending || !this.acceptTerms}
        @click=${() => this.handleSubmit()}
      >
        ${this.sending
          ? L("Отправляем…", "Sending…")
          : L("Получить код", "Get code")}
      </button>
    `;
  }

  // Шаг 2 — письмо ушло: показываем поле кода (появляется ТОЛЬКО после отправки).
  private renderCodeStage(): TemplateResult {
    return html`
      <div
        class="t-muted"
        style="text-align:center;font-size:13px;margin-bottom:12px"
      >
        ${L("Письмо отправлено на", "Email sent to")}
        <b style="color:inherit">${this.email}</b>.<br />
        ${L(
          "Войдите по ссылке из письма (с этого устройства) — либо вбейте код ниже.",
          "Open the link from the email (on this device) — or enter the code below.",
        )}
        <button
          class="t-link"
          style="background:none;border:none;box-shadow:none;cursor:pointer;font-size:12px"
          @click=${() => {
            this.sent = false;
            this.code = "";
          }}
        >
          ${L("изменить почту", "change email")}
        </button>
      </div>
      <button
        class="t-btn ghost"
        style="width:100%;margin-bottom:10px;text-decoration:none"
        @click=${() => this.openMail()}
      >
        ${L("Открыть почту", "Open mail")} (${this.mailDomain()})
      </button>
      <div style="display:flex;gap:8px">
        <input
          class="t-input code-input"
          style="flex:1;text-align:center;letter-spacing:12px;font-family:monospace;font-size:22px"
          inputmode="numeric"
          autocomplete="one-time-code"
          name="otp"
          maxlength="4"
          autofocus
          .value=${this.code}
          @input=${(e: Event) =>
            (this.code = (e.target as HTMLInputElement).value
              .replace(/\D/g, "")
              .slice(0, 4))}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") this.handleCodeLogin();
          }}
          placeholder="* * * *"
        />
        <button class="t-btn" @click=${() => this.handleCodeLogin()}>
          ${translateText("account_modal.login_with_code")}
        </button>
      </div>
      <div style="text-align:center;margin-top:12px;font-size:12px">
        ${this.resendIn > 0
          ? html`<span class="t-muted"
              >${L("Отправить ещё раз через", "Resend in")}
              ${this.resendIn}${L("с", "s")}</span
            >`
          : html`<button
              class="t-link"
              style="background:none;border:none;box-shadow:none;cursor:pointer;font-size:12px"
              ?disabled=${this.sending}
              @click=${() => this.handleSubmit()}
            >
              ${L("Отправить код ещё раз", "Resend code")}
            </button>`}
      </div>
    `;
  }

  // Домен из введённой почты (для подписи кнопки «Открыть почту (…)»).
  private mailDomain(): string {
    return this.email.trim().split("@")[1]?.toLowerCase() || L("почту", "mail");
  }

  // Веб-интерфейс провайдера по домену; неизвестный → просто https://<домен>.
  private openMail(): void {
    const d = this.mailDomain();
    const map: Record<string, string> = {
      "gmail.com": "https://mail.google.com/",
      "googlemail.com": "https://mail.google.com/",
      "yandex.ru": "https://mail.yandex.ru/",
      "yandex.com": "https://mail.yandex.ru/",
      "ya.ru": "https://mail.yandex.ru/",
      "mail.ru": "https://e.mail.ru/",
      "bk.ru": "https://e.mail.ru/",
      "inbox.ru": "https://e.mail.ru/",
      "list.ru": "https://e.mail.ru/",
      "internet.ru": "https://e.mail.ru/",
      "outlook.com": "https://outlook.live.com/mail/",
      "hotmail.com": "https://outlook.live.com/mail/",
      "live.com": "https://outlook.live.com/mail/",
      "msn.com": "https://outlook.live.com/mail/",
      "icloud.com": "https://www.icloud.com/mail",
      "me.com": "https://www.icloud.com/mail",
      "mac.com": "https://www.icloud.com/mail",
      "proton.me": "https://mail.proton.me/",
      "protonmail.com": "https://mail.proton.me/",
      "yahoo.com": "https://mail.yahoo.com/",
    };
    const url = map[d] ?? (d.includes(".") ? `https://${d}` : "");
    if (url) window.open(url, "_blank", "noopener");
  }

  private async handleSubmit(): Promise<void> {
    if (!this.acceptTerms) {
      toast(
        L("Отметьте согласие с условиями.", "Please accept the terms first."),
        "error",
      );
      return;
    }
    const email = this.email.trim();
    if (!email) {
      toast(translateText("account_modal.enter_email_address"), "error");
      return;
    }
    this.sending = true;
    const ok = await sendMagicLink(email);
    this.sending = false;
    if (ok) {
      this.sent = true;
      this.startResendCooldown(45);
      toast(
        translateText("account_modal.recovery_email_sent", { email }),
        "success",
      );
      // фокус на поле кода после ре-рендера
      void this.updateComplete.then(() => {
        (this.querySelector(".code-input") as HTMLInputElement | null)?.focus();
      });
    } else {
      toast(
        translateText("account_modal.failed_to_send_recovery_email"),
        "error",
      );
    }
  }

  private async handleCodeLogin(): Promise<void> {
    const email = this.email.trim();
    if (!email) {
      toast(translateText("account_modal.enter_email_address"), "error");
      return;
    }
    if (!/^\d{4}$/.test(this.code.trim())) {
      toast(translateText("account_modal.code_error"), "error");
      return;
    }
    const ok = await loginWithCode(email, this.code.trim());
    if (ok) {
      toast(translateText("account_modal.logged_in"), "success");
      void import("./SoftNavigate").then(({ softReload }) => softReload());
    } else {
      toast(translateText("account_modal.code_error"), "error");
    }
  }

  private async handleLogout(): Promise<void> {
    // ТЗ (31.07): выход = «вышел сам». Без пометки автовход на старте тут же
    // возвращал в тот же аккаунт — площадка-то игрока по-прежнему знает.
    GamePushSDK.noteExplicitLogout();
    // Сперва выходим У ПЛОЩАДКИ (замечание модерации: кнопка выхода обязана
    // звать Logout в СДК), потом гасим свою сессию. Порядок важен: после
    // нашего logOut клиент уже не считает себя вошедшим и мог бы пропустить
    // вызов площадки.
    await GamePushSDK.logoutPlatform();
    await logOut();
    void import("./SoftNavigate").then(({ softReload }) => softReload());
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const p = await getMyProfile();
      this.profile = p;
      if (p) {
        this.editName = p.user.name;
        this.editSlug = p.user.slug ?? "";
      }
    } finally {
      this.loading = false;
    }
  }
}

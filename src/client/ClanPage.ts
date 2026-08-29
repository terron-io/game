import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { getUserMe } from "./Api";
import {
  acceptClanInvite,
  type ClanFull,
  type ClanMember,
  declineClanInvite,
  fetchClanBySlug,
  fetchClanMembers,
  joinClan,
  leaveClan,
} from "./ClanApi";
import { bracketPair, CT, localizeClanText } from "./ClanTerm";
import { openReportDialog } from "./ReportDialog";
import { linkifySocials } from "./SocialLinks";
import { softGo } from "./SoftNavigate";
import { toast } from "./Toast";
import { L } from "./Utils";

function roleLabel(role: string): string {
  if (role === "leader") return L("Лидер", "Leader");
  if (role === "officer") return L("Офицер", "Officer");
  return L("Участник", "Member");
}

/**
 * Публичная страница клана (`/@<slug>` через ProfilePage-резолвер). Этап A:
 * просмотр + вступление/выход + список участников. Управление (для лидера) —
 * кнопка на `/clan/<slug>`. См. clans.md.
 */
@customElement("clan-page")
export class ClanPage extends LitElement {
  @property({ type: Object }) clan!: ClanFull;

  @state() private members: ClanMember[] = [];
  @state() private loggedIn = false;
  @state() private busy = false;
  private loadedFor = "";

  createRenderRoot() {
    return this; // light DOM — берём сайт-тему
  }

  updated() {
    // подгружаем участников при смене клана
    if (this.clan && this.clan.tag !== this.loadedFor) {
      this.loadedFor = this.clan.tag;
      void this.load();
    }
  }

  private async load() {
    const me = await getUserMe();
    this.loggedIn = !!me;
    const r = await fetchClanMembers(this.clan.tag);
    if (r) this.members = r.results;
  }

  // terron A11-фикс: SPA-обновление вместо window.location.reload() (жёсткая
  // перезагрузка → мигание/потеря состояния). Перечитываем клан (обновляется
  // viewerRole → правильная кнопка действия) и список участников.
  private async refresh(): Promise<void> {
    const fresh = await fetchClanBySlug(this.clan.slug);
    if (fresh) this.clan = fresh;
    await this.load();
  }

  private async join() {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await joinClan(this.clan.tag);
      if ("status" in res) {
        if (res.status === "joined") {
          await this.refresh();
        } else {
          toast(L("Заявка отправлена.", "Request sent."), "success");
        }
        return;
      }
      toast(L("Не удалось вступить.", "Couldn't join."), "error");
    } finally {
      this.busy = false;
    }
  }

  private async leave() {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await leaveClan(this.clan.tag);
      if (res === true) await this.refresh();
      else toast(L("Не удалось выйти.", "Couldn't leave."), "error");
    } finally {
      this.busy = false;
    }
  }

  private async accept() {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await acceptClanInvite(this.clan.tag);
      if (r === true) await this.refresh();
      else toast(L("Не удалось", "Failed"), "error");
    } finally {
      this.busy = false;
    }
  }
  private async decline() {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await declineClanInvite(this.clan.tag);
      if (r === true) await this.refresh();
      else toast(L("Не удалось", "Failed"), "error");
    } finally {
      this.busy = false;
    }
  }

  private renderAction(): TemplateResult {
    const role = this.clan.viewerRole;
    if (role === "leader") {
      return html`<button
        class="t-btn clan-view-manage"
        @click=${() => softGo("/clan/" + encodeURIComponent(this.clan.slug))}
      >
        ${L("Управление", "Manage")}
      </button>`;
    }
    if (role) {
      // обычный участник/офицер
      return html`<button
        class="t-btn ghost clan-view-manage"
        ?disabled=${this.busy}
        @click=${() => this.leave()}
      >
        ${L("Выйти", "Leave")}
      </button>`;
    }
    if (this.clan.viewerInvited && this.loggedIn) {
      return html`<div class="clan-view-manage clan-view-actions">
        <button
          class="t-btn"
          ?disabled=${this.busy}
          @click=${() => this.accept()}
        >
          ${L("Принять приглашение", "Accept invitation")}
        </button>
        <button
          class="t-btn ghost"
          ?disabled=${this.busy}
          @click=${() => this.decline()}
        >
          ${L("Отклонить", "Decline")}
        </button>
      </div>`;
    }
    if (!this.loggedIn) {
      return html`<button
        class="t-btn clan-view-manage"
        @click=${() => window.showPage?.("page-account")}
      >
        ${L("Войти, чтобы вступить", "Sign in to join")}
      </button>`;
    }
    return html`<button
      class="t-btn clan-view-manage"
      ?disabled=${this.busy}
      @click=${() => this.join()}
    >
      ${this.clan.isOpen
        ? L("Вступить", "Join")
        : L("Подать заявку", "Request to join")}
    </button>`;
  }

  render(): TemplateResult {
    const c = this.clan;
    const b = bracketPair(c.bracket);
    const created = c.createdAt
      ? new Date(c.createdAt).toLocaleDateString("ru-RU")
      : "";
    return html`<div class="t-page clan-view">
      <div class="clan-view-head">
        <div class="clan-view-flag">
          ${c.flag
            ? html`<img src=${c.flag} alt="flag" />`
            : html`<span class="ph">${b.l}${c.tag}${b.r}</span>`}
        </div>
        <div class="clan-view-title">
          <div class="clan-view-tag">${b.l}${c.tag}${b.r}</div>
          <div class="clan-view-name">
            ${localizeClanText(c.name, c.nameRu)}
          </div>
        </div>
        ${this.renderAction()}
      </div>

      <div class="clan-view-badges">
        <span class="clan-badge ${c.isOpen ? "open" : "closed"}">
          ${c.isOpen ? L("Открытый", "Open") : L("По заявке", "Invite-only")}
        </span>
        <span class="clan-badge">
          ${L("Участников", "Members")}: ${c.memberCount}
        </span>
        ${created
          ? html`<span class="clan-badge"
              >${L("Создан", "Created")}: ${created}</span
            >`
          : ""}
        <button
          class="t-btn ghost"
          style="margin-left:auto;padding:3px 10px;font-size:12px;color:var(--t-red,#a8432b);border-color:var(--t-red,#a8432b)"
          title=${L("Пожаловаться на клан", "Report clan")}
          @click=${() =>
            openReportDialog({
              targetSlug: c.slug,
              name: localizeClanText(c.name, c.nameRu),
              context: L("Клан", "Clan"),
            })}
        >
          🚩 ${L("Пожаловаться", "Report")}
        </button>
      </div>

      ${localizeClanText(c.description, c.descriptionRu)
        ? html`<p class="clan-view-desc">
            ${linkifySocials(localizeClanText(c.description, c.descriptionRu))}
          </p>`
        : html`<p class="clan-view-desc t-muted">
            ${L(`У ${CT.gen} пока нет описания.`, "No description yet.")}
          </p>`}

      <h3 class="t-h3">${L("Участники", "Members")}</h3>
      <div class="clan-members">
        ${this.members.map(
          (m) =>
            html`<a
              class="clan-member"
              href="/@${m.publicId}"
              @click=${(e: Event) => {
                e.preventDefault();
                softGo("/@" + encodeURIComponent(m.publicId));
              }}
            >
              <span class="clan-member-main">
                ${m.name
                  ? html`<span class="clan-member-name">${m.name}</span>`
                  : ""}
                <span class="clan-member-id">@${m.publicId}</span>
              </span>
              <span class="clan-member-role">${roleLabel(m.role)}</span>
            </a>`,
        )}
      </div>
    </div>`;
  }
}

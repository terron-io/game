import { html, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { getUserMe } from "./Api";
import { avatarFallback, avatarSrc } from "./Avatar";
import "./IdentifierInput";
import type { IdentifierInput } from "./IdentifierInput";
import {
  acceptFriendRequest,
  claimFriendRequests,
  declineFriendRequest,
  fetchFriendRequests,
  fetchFriends,
  type FriendRow,
  type IncomingFriendRequest,
  removeFriend,
  requestFriendByIdentifier,
  setFriendMuted,
  withdrawFriendRequest,
} from "./FriendsApi";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { confirmDialog, toast } from "./Toast";
import { L, translateText } from "./Utils";

/**
 * Страница «Друзья» — `/friends`. Список друзей (с текущим лобби/игрой →
 * Войти/Смотреть), входящие заявки, мут уведомлений, удаление, добавление по
 * id/ссылке/@slug. См. friends.md (Этап 5). Термин — friend.
 */
@customElement("friends-page")
export class FriendsPage extends BaseModal {
  protected routerName = "friends";

  @state() private loading = true;
  @state() private loggedIn = false;
  @state() private friends: FriendRow[] = [];
  @state() private incoming: IncomingFriendRequest[] = [];
  @state() private outgoing: IncomingFriendRequest[] = [];
  @state() private adding = false;
  @state() private tab: "friends" | "requests" = "friends";
  @query("identifier-input") private idInput?: IdentifierInput;

  protected renderHeaderSlot() {
    return modalHeader({
      title: L("Друзья", "Friends"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected async onOpen() {
    this.loading = true;
    const me = await getUserMe();
    this.loggedIn = !!me;
    if (this.loggedIn) {
      // оживить заявки, присланные пока был анонимом (по прежнему анон-pid).
      await claimFriendRequests();
      await this.reload();
    }
    this.loading = false;
  }

  private async reload() {
    const [f, r] = await Promise.all([
      fetchFriends(),
      fetchFriendRequests(),
    ]);
    this.friends = f ?? [];
    this.incoming = r?.incoming ?? [];
    this.outgoing = r?.outgoing ?? [];
  }

  /** created_at → «2 июл, 23:11» (локаль ru/en). */
  private fmtDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(L("ru-RU", "en-US"), {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // ── действия ──
  private async accept(id: string) {
    if (await acceptFriendRequest(id)) {
      toast(L("Теперь вы друзья", "You're now friends"), "success");
      await this.reload();
    } else toast(L("Не удалось", "Failed"), "error");
  }
  private async decline(id: string) {
    await declineFriendRequest(id);
    await this.reload();
  }
  private async withdraw(id: string) {
    if (await withdrawFriendRequest(id)) {
      toast(L("Заявка отозвана", "Request withdrawn"), "info");
      await this.reload();
    } else toast(L("Не удалось", "Failed"), "error");
  }
  private async toggleMute(f: FriendRow) {
    const ok = await setFriendMuted(f.id, !f.muted);
    if (ok) await this.reload();
    else toast(L("Не удалось", "Failed"), "error");
  }
  private async unfriend(f: FriendRow) {
    const yes = await confirmDialog(
      L(`Удалить ${f.name} из друзей?`, `Remove ${f.name} from friends?`),
      L("Удалить", "Remove"),
      L("Отмена", "Cancel"),
    );
    if (!yes) return;
    if (await removeFriend(f.id)) await this.reload();
    else toast(L("Не удалось", "Failed"), "error");
  }
  private async add(v: string) {
    if (!v || this.adding) return;
    this.adding = true;
    const r = await requestFriendByIdentifier(v);
    this.adding = false;
    const map: Record<string, string> = {
      sent: L("Запрос отправлен", "Request sent"),
      auto_accepted: L("Теперь вы друзья", "You're now friends"),
      already_friends: L("Вы уже друзья", "Already friends"),
      already_pending: L("Запрос уже отправлен", "Request already pending"),
      self: L("Нельзя добавить себя", "Can't add yourself"),
      target_not_found: L("Игрок не найден", "Player not found"),
      error: L("Не удалось", "Failed"),
    };
    const ok = r.status === "sent" || r.status === "auto_accepted";
    toast(map[r.status] ?? map.error, ok ? "success" : "error");
    if (ok) {
      this.idInput?.clear();
      // sent → показать в «Заявках» (отправленные); подружились → «Друзья».
      this.tab = r.status === "sent" ? "requests" : "friends";
      await this.reload();
    }
  }

  // ── рендер ──
  private presenceBtn(f: FriendRow): TemplateResult {
    const p = f.presence;
    if (!p) return html``;
    const inGame = p.state === "in_game";
    const label = inGame ? L("Смотреть", "Watch") : L("Войти", "Join");
    const where = p.map ? ` · ${p.map}` : "";
    return html`<a
      class="t-btn"
      style="padding:5px 12px;background:#16a34a;color:#fff;text-decoration:none"
      href="/game/${p.gameID}"
      title=${(inGame ? L("В игре", "In game") : L("В лобби", "In lobby")) + where}
      >${label}</a
    >`;
  }

  private renderFriend(f: FriendRow): TemplateResult {
    const handle = f.slug ? `@${f.slug}` : `#${f.id}`;
    // клик по нику/@хэндлу → досье игрока (/@slug|number). Как ссылки в лидерборде.
    const href = `/@${f.slug ?? f.id}`;
    // terron: своя аватарка друга (картинка из API), иначе базовый портрет
    // по seed. hasAvatar приходит в списке друзей — см. Avatar.avatarSrc.
    const avSrc = avatarSrc({
      seed: f.slug ?? f.id,
      slug: f.slug,
      hasAvatar: f.hasAvatar,
      size: 64,
    });
    return html`<div
      class="friend-row"
      style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--t-line,rgba(0,0,0,.12));border-radius:10px;margin-bottom:8px;background:var(--t-sheet,#fff)"
    >
      <a
        href=${href}
        style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-decoration:none;color:inherit;cursor:pointer"
        title=${L("Открыть досье", "Open dossier")}
      >
        <img
          src=${avSrc}
          alt=""
          style="width:34px;height:34px;border-radius:7px;flex:0 0 auto;border:1px solid rgba(0,0,0,.12)"
          @error=${avatarFallback(f.slug ?? f.id, 64)}
      />
        <div style="min-width:0">
          <div style="font-weight:700;color:var(--t-ink,#2b2a24);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${f.name}
          </div>
          <div style="font-size:12px;color:#6b7280">${handle}</div>
        </div>
      </a>
      ${this.presenceBtn(f)}
      <button
        class="t-btn ghost"
        style="padding:5px 10px"
        title=${f.muted ? L("Включить уведомления", "Unmute") : L("Заглушить уведомления", "Mute")}
        @click=${() => this.toggleMute(f)}
      >
        ${f.muted ? "🔕" : "🔔"}
      </button>
      <button
        class="t-btn ghost"
        style="padding:5px 10px"
        title=${L("Удалить из друзей", "Remove friend")}
        @click=${() => this.unfriend(f)}
      >
        ✕
      </button>
    </div>`;
  }

  protected renderBody(): TemplateResult {
    if (this.loading) {
      return html`<div class="t-page">
        <div class="t-skel" style="height:56px;margin-bottom:10px"></div>
        <div class="t-skel" style="height:56px"></div>
      </div>`;
    }
    if (!this.loggedIn) {
      return html`<div class="t-page">
        <div class="t-stat" style="text-align:center">
          ${L("Войдите, чтобы добавлять друзей.", "Sign in to add friends.")}
          <div style="margin-top:12px">
            <button
              class="t-btn"
              @click=${() => {
                this.close();
                window.showPage?.("page-settings");
              }}
            >
              ${L("Вход", "Sign in")}
            </button>
          </div>
        </div>
      </div>`;
    }
    return html`<div class="t-page">
      <!-- добавить друга (общий компонент, см. friends.md) -->
      <div style="margin-bottom:16px">
        <identifier-input
          .placeholder=${L("Ник, @slug, id или ссылка…", "Name, @slug, id or link…")}
          .buttonLabel=${L("Добавить", "Add")}
          ?disabled=${this.adding}
          @submit=${(e: CustomEvent) => this.add(e.detail.value)}
        ></identifier-input>
      </div>

      <!-- вкладки -->
      <div
        style="display:flex;gap:18px;margin-bottom:16px;border-bottom:1px solid var(--t-line,rgba(0,0,0,.12))"
      >
        ${this.tabBtn(
          "friends",
          `${L("Друзья", "Friends")} (${this.friends.length})`,
        )}
        ${this.tabBtn(
          "requests",
          L("Заявки", "Requests") +
            (this.incoming.length + this.outgoing.length > 0
              ? ` (${this.incoming.length + this.outgoing.length})`
              : ""),
          this.incoming.length > 0,
        )}
      </div>

      ${this.tab === "friends"
        ? this.renderFriendsTab()
        : this.renderRequestsTab()}
    </div>`;
  }

  private tabBtn(
    key: "friends" | "requests",
    label: string,
    dot = false,
  ): TemplateResult {
    const active = this.tab === key;
    return html`<button
      style="position:relative;background:none;border:none;padding:8px 2px;cursor:pointer;font-weight:700;font-size:14px;color:${active
        ? "var(--t-ink,#2b2a24)"
        : "#9ca3af"};border-bottom:2px solid ${active
        ? "var(--t-ink,#2b2a24)"
        : "transparent"}"
      @click=${() => (this.tab = key)}
    >
      ${label}${dot
        ? html`<span
            style="position:absolute;top:4px;right:-9px;width:7px;height:7px;border-radius:50%;background:#dc2626"
          ></span>`
        : ""}
    </button>`;
  }

  private renderFriendsTab(): TemplateResult {
    if (this.friends.length === 0) {
      return html`<div class="t-muted">
        ${L(
          "Пока никого. Добавьте друга по нику или в игре.",
          "No friends yet. Add someone by name or in-game.",
        )}
      </div>`;
    }
    return html`${this.friends.map((f) => this.renderFriend(f))}`;
  }

  private renderRequestsTab(): TemplateResult {
    if (this.incoming.length === 0 && this.outgoing.length === 0) {
      return html`<div class="t-muted">
        ${L("Нет активных заявок.", "No pending requests.")}
      </div>`;
    }
    return html`
      ${this.incoming.length > 0
        ? html`<h3 class="t-h3" style="margin-top:0">
              ${L("Входящие", "Incoming")}
            </h3>
            <div style="margin-bottom:18px">
              ${this.incoming.map(
                (r) => html`<div
                  style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--t-line,rgba(0,0,0,.12));border-radius:10px;margin-bottom:8px;background:var(--t-sheet,#fff)"
                >
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:700;color:var(--t-ink,#2b2a24)">
                      ${r.from.name}
                      <span style="font-weight:400;color:#6b7280;font-size:12px">
                        ${r.from.slug ? `@${r.from.slug}` : ""}</span
                      >
                    </div>
                    <div style="font-size:12px;color:#9ca3af">
                      ${this.fmtDate(r.created_at)}
                    </div>
                  </div>
                  <button class="t-btn" style="padding:5px 12px" @click=${() => this.accept(r.id)}>
                    ${L("Принять", "Accept")}
                  </button>
                  <button class="t-btn ghost" style="padding:5px 12px" @click=${() => this.decline(r.id)}>
                    ${L("Отклонить", "Decline")}
                  </button>
                </div>`,
              )}
            </div>`
        : ""}
      ${this.outgoing.length > 0
        ? html`<h3 class="t-h3" style="margin-top:0">
              ${L("Отправленные", "Sent")}
            </h3>
            <div>
              ${this.outgoing.map(
                (r) => html`<div
                  style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--t-line,rgba(0,0,0,.12));border-radius:10px;margin-bottom:8px;background:var(--t-sheet,#fff)"
                >
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:700;color:var(--t-ink,#2b2a24)">
                      ${r.from.name}
                      <span style="font-weight:400;color:#6b7280;font-size:12px">
                        ${r.from.slug ? `@${r.from.slug}` : ""}</span
                      >
                    </div>
                    <div style="font-size:12px;color:#9ca3af">
                      ${L("Отправлено", "Sent")} · ${this.fmtDate(r.created_at)}
                    </div>
                  </div>
                  <button
                    class="t-btn ghost"
                    style="padding:5px 12px;white-space:nowrap"
                    @click=${() => this.withdraw(r.id)}
                  >
                    ${L("Отозвать", "Withdraw")}
                  </button>
                </div>`,
              )}
            </div>`
        : ""}
    `;
  }
}

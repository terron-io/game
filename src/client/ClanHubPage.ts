import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ClanInfo } from "../core/ClanApiSchemas";
import { getUserMe, getWallet } from "./Api";
import {
  acceptClanInvite,
  claimClanInvites,
  declineClanInvite,
  fetchClans,
  fetchMyClanInvites,
  fetchMyClans,
  type ClanFull,
  type ClanMine,
} from "./ClanApi";
import { bracketPair, CT, localizeClanText } from "./ClanTerm";
import { BaseModal } from "./components/BaseModal";
import { coin } from "./components/ui/coin";
import { modalHeader } from "./components/ui/ModalHeader";
import { resolveFlagUrl } from "./Cosmetics";
import { softGo } from "./SoftNavigate";
import { toast } from "./Toast";
import { L, translateText } from "./Utils";

function roleLabel(role: string): string {
  if (role === "leader") return L("Лидер", "Leader");
  if (role === "officer") return L("Офицер", "Officer");
  return L("Участник", "Member");
}

/**
 * Хаб кланов — `/clan`. Заменяет мёртвую апстрим clan-modal. Этап 1: «мои кланы»
 * (список) + кнопка «создать» (→ /clan/new). Браузер/поиск чужих — позже.
 * Термин — из ClanTerm.CT. См. clans.md.
 */
@customElement("clan-hub-page")
export class ClanHubPage extends BaseModal {
  protected routerName = "clan";

  @state() private lts = 0;
  @state() private pts = 0;
  @state() private loading = true;
  @state() private loggedIn = false;
  @state() private mine: ClanMine[] = [];
  @state() private invited: ClanFull[] = []; // приглашения мне
  @state() private all: ClanInfo[] = []; // публичный браузер всех кланов
  @state() private search = "";
  // ленивая подгрузка флага-аватара по тегу (в браузере флаги не приходят —
  // тяжёлые data:image; тянем по одному через resolveFlagUrl, со скелетоном)
  @state() private flagUrls = new Map<string, string | null>();
  private loadingFlags = new Set<string>();

  private ensureFlag(tag: string) {
    const key = tag.toUpperCase();
    if (this.flagUrls.has(key) || this.loadingFlags.has(key)) return;
    this.loadingFlags.add(key);
    void resolveFlagUrl(`clan:${tag}`).then((url) => {
      this.flagUrls.set(key, url ?? null);
      this.loadingFlags.delete(key);
      this.requestUpdate();
    });
  }

  // слот аватара: скелетон пока грузится → флаг клана или плейсхолдер [tag]
  private renderFlagSlot(tag: string, label: string): TemplateResult {
    const key = tag.toUpperCase();
    if (!this.flagUrls.has(key)) {
      this.ensureFlag(tag);
      return html`<span
        class="t-skel"
        style="width:100%;height:100%;display:block;border-radius:inherit"
      ></span>`;
    }
    const url = this.flagUrls.get(key);
    return url
      ? html`<img src=${url} alt="flag" loading="lazy" />`
      : html`<span class="ph">${label}</span>`;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: L("Кланы", "Clans"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent: html`<span
        class="t-balance"
        style="display:inline-flex;align-items:center;gap:5px"
        title=${L("Золото · Серебро", "Gold · Silver")}
        >${coin("lts")} ${this.lts.toLocaleString("ru-RU")} · ${coin("pts")}
        ${this.pts.toLocaleString("ru-RU")}</span
      >`,
    });
  }

  protected async onOpen() {
    this.loading = true;
    const me = await getUserMe();
    this.loggedIn = !!me;
    const w = await getWallet();
    if (w) {
      this.lts = w.lts;
      this.pts = w.pts;
    }
    if (this.loggedIn) {
      // забрать pending-инвайты (in-game приглашения, выданные до входа)
      await claimClanInvites();
      this.mine = (await fetchMyClans()) ?? [];
      this.invited = (await fetchMyClanInvites()) ?? [];
    }
    // публичный браузер всех кланов — грузим для всех (вход нужен только чтобы вступить)
    await this.loadAll();
    this.loading = false;
  }

  private async loadAll() {
    const r = await fetchClans(this.search || undefined, 1, 24);
    this.all = r ? r.results : [];
  }

  private onSearch(e: Event) {
    this.search = (e.target as HTMLInputElement).value;
    void this.loadAll();
  }

  private async acceptInvite(tag: string) {
    const r = await acceptClanInvite(tag);
    if (r === true) {
      toast(L("Принято", "Accepted"), "success");
      void this.onOpen();
    } else toast(L("Не удалось", "Failed"), "error");
  }
  private async declineInvite(tag: string) {
    const r = await declineClanInvite(tag);
    if (r === true) {
      toast(L("Отклонено", "Declined"), "info");
      void this.onOpen();
    } else toast(L("Не удалось", "Failed"), "error");
  }

  private goCreate() {
    this.close();
    window.showPage?.("page-clan-create");
  }

  private openClan(slug: string) {
    softGo("/@" + encodeURIComponent(slug));
  }

  private renderCard(c: ClanMine): TemplateResult {
    const b = bracketPair(c.bracket);
    return html`<button
      class="clan-hub-card"
      @click=${() => this.openClan(c.slug)}
    >
      <div class="clan-hub-flag">
        ${c.flag
          ? html`<img src=${c.flag} alt="flag" />`
          : html`<span class="ph">${b.l}${c.tag}${b.r}</span>`}
      </div>
      <div class="clan-hub-meta">
        <div class="clan-hub-name">
          ${b.l}${c.tag}${b.r} ${localizeClanText(c.name, c.nameRu)}
        </div>
        <div class="clan-hub-sub">
          ${roleLabel(c.role)} · ${L("участников", "members")}: ${c.memberCount}
        </div>
      </div>
      <span class="clan-hub-arrow">→</span>
    </button>`;
  }

  // публичный браузер всех кланов — виден всем (вход нужен только для вступления,
  // которое происходит уже на странице клана `/@slug`).
  private renderBrowse(): TemplateResult {
    const b = (i: number) => bracketPair(i);
    return html`<div style="margin-top:18px">
      <h3 class="t-h3" style="margin:0 0 8px">
        ${L("Все кланы", "All clans")}
      </h3>
      <input
        class="t-input"
        style="width:100%;box-sizing:border-box;margin-bottom:10px"
        placeholder=${L(
          "Поиск по тегу или названию…",
          "Search by tag or name…",
        )}
        .value=${this.search}
        @input=${this.onSearch}
      />
      ${this.all.length === 0
        ? html`<div class="t-muted">
            ${this.search
              ? L("Ничего не найдено.", "Nothing found.")
              : L("Кланов пока нет.", "No clans yet.")}
          </div>`
        : html`<div class="clan-hub-list">
            ${this.all.map((c) => {
              const br = b(0);
              const card = html`
                <div class="clan-hub-flag">
                  ${this.renderFlagSlot(c.tag, `${br.l}${c.tag}${br.r}`)}
                </div>
                <div class="clan-hub-meta">
                  <div class="clan-hub-name">
                    ${br.l}${c.tag}${br.r} ${localizeClanText(c.name, c.nameRu)}
                  </div>
                  <div class="clan-hub-sub">
                    ${L("участников", "members")}: ${c.memberCount ?? 1} ·
                    ${c.isOpen
                      ? L("открытый", "open")
                      : L("закрытый", "private")}
                  </div>
                </div>
              `;
              return c.slug
                ? html`<button
                    class="clan-hub-card"
                    @click=${() => this.openClan(c.slug!)}
                  >
                    ${card}<span class="clan-hub-arrow">→</span>
                  </button>`
                : html`<div class="clan-hub-card" style="cursor:default">
                    ${card}
                  </div>`;
            })}
          </div>`}
    </div>`;
  }

  protected renderBody(): TemplateResult {
    if (this.loading) {
      return html`<div class="t-page">
        <div class="t-skel" style="height:64px;margin-bottom:10px"></div>
        <div class="t-skel" style="height:64px"></div>
      </div>`;
    }
    if (!this.loggedIn) {
      return html`<div class="t-page">
        <div class="t-stat" style="text-align:center">
          ${L(
            "Войдите, чтобы создавать кланы и вступать в них.",
            "Sign in to create and join clans.",
          )}
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
        ${this.renderBrowse()}
      </div>`;
    }
    return html`<div class="t-page">
      ${this.invited.length > 0
        ? html`<h3 class="t-h3" style="margin-top:0">
              ${L("Приглашения", "Invitations")}
            </h3>
            <div class="clan-hub-list">
              ${this.invited.map((c) => {
                const b = bracketPair(c.bracket);
                return html`<div class="clan-hub-card" style="cursor:default">
                  <div class="clan-hub-flag">
                    ${c.flag
                      ? html`<img src=${c.flag} alt="flag" />`
                      : html`<span class="ph">${b.l}${c.tag}${b.r}</span>`}
                  </div>
                  <div class="clan-hub-meta">
                    <div class="clan-hub-name">
                      ${b.l}${c.tag}${b.r} ${localizeClanText(c.name, c.nameRu)}
                    </div>
                    <div class="clan-hub-sub">
                      ${L("приглашение", "invitation")}
                    </div>
                  </div>
                  <div class="clan-req-act">
                    <button
                      class="t-btn"
                      style="padding:5px 12px"
                      @click=${() => this.acceptInvite(c.tag)}
                    >
                      ${L("Принять", "Accept")}
                    </button>
                    <button
                      class="t-btn ghost"
                      style="padding:5px 12px"
                      @click=${() => this.declineInvite(c.tag)}
                    >
                      ${L("Отклонить", "Decline")}
                    </button>
                  </div>
                </div>`;
              })}
            </div>`
        : ""}
      <div class="clan-hub-top">
        <h3 class="t-h3" style="margin:0">${L("Мои кланы", "My clans")}</h3>
        <button class="t-btn" @click=${() => this.goCreate()}>
          ${L(`Создать ${CT.acc}`, `Create a ${CT.en}`)}
        </button>
      </div>
      ${this.mine.length === 0
        ? html`<div class="t-muted" style="margin-top:10px">
            ${L(
              "Вы пока не состоите ни в одном клане. Создайте первый.",
              "You're not in any clan yet. Create your first.",
            )}
          </div>`
        : html`<div class="clan-hub-list">
            ${this.mine.map((c) => this.renderCard(c))}
          </div>`}
      ${this.renderBrowse()}
    </div>`;
  }
}

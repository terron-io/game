import { html, TemplateResult } from "lit";
import { resolveMarkdown } from "lit-markdown";
import { customElement, query, state } from "lit/decorators.js";
import type { TerronAchievement, TerronDailyQuest } from "./Api";
import {
  getDailyQuests,
  getMyProfile,
  getProfileBySlug,
  getUserMe,
  updateMe,
  type TerronProfile,
} from "./Api";
import { avatarSrc } from "./Avatar";
import { reportHealth } from "./Health";
import { fetchClanBySlug, type ClanFull } from "./ClanApi";
import "./ClanPage";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { uiIcon } from "./components/ui/UiIcon";
import {
  acceptFriendRequest,
  requestFriendByIdentifier,
  withdrawFriendRequest,
} from "./FriendsApi";
import {
  captureProfileReferral,
  getMyReferral,
  type MyReferral,
} from "./Referral";
import { openReportDialog } from "./ReportDialog";
import { allSkins, skinSwatchStyle } from "./Skins";
import { softGo } from "./SoftNavigate";
import { toast } from "./Toast";
import "./UltTree";
import { L, translateText } from "./Utils";

const REF_EVENT_LABELS: Record<string, string> = {
  open: "Открыли ссылку",
  play: "Сыграли матч",
  register: "Зарегались",
  win: "Выиграли матч",
};
const REF_EVENT_LABELS_EN: Record<string, string> = {
  open: "Opened link",
  play: "Played a match",
  register: "Registered",
  win: "Won a match",
};

// terron: шапка досье — игрок ГЛАВНЫЙ на странице (жалоба владельца: «заголовок
// огромный, а текст про меня никакой»). Крупный портрет + крупное имя.
// Ховер подсказывает, что аватарку можно править; на тач-экранах ховера нет —
// поэтому ещё и постоянный уголок-карандаш.
const HERO_CSS = html`<style>
  .t-hero {
    display: flex;
    gap: 18px;
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .t-av {
    position: relative;
    flex: 0 0 auto;
    width: 128px;
    height: 128px;
    border: 1px solid rgba(0, 0, 0, 0.22);
    background: #e7e0c8;
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.14);
  }
  .t-av img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }
  .t-av.edit {
    cursor: pointer;
  }
  .t-av-ov {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    background: rgba(20, 20, 18, 0.62);
    color: #fff;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 1px;
    text-transform: uppercase;
    text-align: center;
    padding: 0 4px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .t-av.edit:hover .t-av-ov {
    opacity: 1;
  }
  .t-av-badge {
    position: absolute;
    right: -1px;
    bottom: -1px;
    background: var(--t-ink, #2b2a24);
    color: #fff;
    font-size: 12px;
    line-height: 1;
    padding: 6px 8px;
  }
  .t-av.edit:hover .t-av-badge {
    opacity: 0;
  }
  .t-hero-id {
    flex: 1 1 150px;
    min-width: 0;
  }
  .t-hero-name {
    font-family: var(--t-display, inherit);
    font-size: clamp(24px, 4.6vw, 36px);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: 0.5px;
    word-break: break-word;
  }
  .t-hero-num {
    font-size: 14px;
    font-weight: 700;
    opacity: 0.45;
    font-family: var(--t-mono, monospace);
    margin-left: 8px;
    vertical-align: 3px;
  }
  .t-hero-chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin-top: 8px;
  }
  .t-chip {
    font-size: 12px;
    font-weight: 700;
    padding: 3px 10px;
    border: 1px solid rgba(0, 0, 0, 0.25);
  }
  @media (max-width: 560px) {
    .t-hero {
      gap: 12px;
    }
    .t-av {
      width: 96px;
      height: 96px;
    }
    .t-av-ov {
      font-size: 10px;
      letter-spacing: 0;
    }
  }
</style>`;

// ---- formatting ----
function n(x: number): string {
  return (x ?? 0).toLocaleString("ru-RU");
}
function dur(sec: number): string {
  if (!sec || sec <= 0) return "0с";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h && `${h}ч`, m && `${m}м`, !h && s && `${s}с`]
    .filter(Boolean)
    .join(" ");
}
function dateRu(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
const td = (k: string) => translateText(`dossier.${k}`);

// terron: редкость по тиру (как progress.petridish): 1 зелёная, 2 синяя, 3 фиол, 4+ золото.
interface TierStyle {
  c: string;
  bg: string;
  ink: string;
}
function tierStyle(tier: number): TierStyle {
  switch (tier) {
    case 1:
      return { c: "#639922", bg: "#EAF3DE", ink: "#3B6D11" };
    case 2:
      return { c: "#378ADD", bg: "#E6F1FB", ink: "#0C447C" };
    case 3:
      return { c: "#7F77DD", bg: "#EEEDFE", ink: "#3C3489" };
    default:
      return { c: "#BA7517", bg: "#FAEEDA", ink: "#854F0B" };
  }
}

const ACTIVE_TITLE_KEY = "terron_active_title";
type Tab =
  | "overview"
  | "achievements"
  | "titles"
  | "skins"
  | "invites"
  | "ults";

/**
 * Досье 2.0 — «лендинг писькомерок»: схлопнутая шапка, подменю-табы, достижения
 * сгруппированы в семейства с тирами (редкость цветом тира), звания. Маршрут
 * `/@<slug>`. Тексты — i18n (dossier.* + achievements.*).
 */
@customElement("profile-page")
export class ProfilePage extends BaseModal {
  protected routerName = "profile";

  @state() private loading = false;
  @state() private notFound = false;
  @state() private profile: TerronProfile | null = null;
  // terron: `/@<slug>` — общий namespace юзеров и кланов. Если slug не юзер, а клан —
  // рендерим клан-вид вместо досье (резолвер). См. clans.md / clans-slug.md.
  @state() private clanView: ClanFull | null = null;
  @state() private tab: Tab = "overview";
  @state() private expanded = new Set<string>();
  @state() private activeTitle = localStorage.getItem(ACTIVE_TITLE_KEY) ?? "";
  @state() private daily: TerronDailyQuest[] | null = null;
  @state() private referral: MyReferral | null = null;
  @state() private addingFriend = false;
  // Отношение к просматриваемому игроку (из API, обновляется оптимистично по кликам).
  @state() private relation:
    | "self"
    | "friends"
    | "incoming" // они прислали мне заявку → «Принять»
    | "outgoing" // я отправил → «Отправлено» + «Отозвать»
    | "none" = "none";
  private relReqId?: string; // id входящей/исходящей заявки (accept/withdraw)
  @state() private avatarDrag = false;
  @state() private avatarBusy = false;
  @state() private avatarMenu = false;
  @query('input[type="file"]') private avatarInput?: HTMLInputElement;
  private slug = "me";
  private own = false;

  protected modalConfig() {
    return { maxWidth: "920px" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: this.clanView ? this.clanView.name : td("title"),
      // terron: со страницы клана «назад» → к списку кланов (/clan), а не на
      // главную (так пришли из хаба). Профиль игрока — обычное закрытие.
      onBack: () => (this.clanView ? softGo("/clan") : this.close()),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody(): TemplateResult {
    if (this.loading) return this.renderLoadingSpinner(td("loading"));
    if (this.clanView) {
      return html`<clan-page .clan=${this.clanView}></clan-page>`;
    }
    if (this.notFound) {
      return html`<div class="t-page">
        <div class="t-stat" style="text-align:center">
          <b>@${this.slug}</b> — 404
        </div>
      </div>`;
    }
    if (!this.profile) {
      return html`<div class="t-page">
        <div class="t-stat" style="text-align:center">
          ${td("login_prompt")}
          <div style="margin-top:12px">
            <button class="t-btn" @click=${() => this.goAccount()}>
              ${td("login")}
            </button>
          </div>
        </div>
      </div>`;
    }
    return html`<div class="t-page">
      ${this.renderHeadCompact()} ${this.renderTabs()} ${this.renderTab()}
    </div>`;
  }

  // ── Схлопнутая шапка: одна строка ───────────────────────────────────────────
  private renderHeadCompact(): TemplateResult {
    const p = this.profile!;
    const st = p.stats;
    const seed =
      p.user.slug ??
      (p.user.number != null ? String(p.user.number) : p.user.name);
    const avSrc = avatarSrc({ avatar: p.user.avatar, seed, size: 72 });
    const titleAch = p.achievements.find(
      (a) => a.id === this.activeTitle && a.unlockedAt,
    );
    return html`${HERO_CSS}
      <div style="padding-bottom:14px;border-bottom:1px solid rgba(0,0,0,.14)">
        <div class="t-hero">
          <div
            class="t-av ${this.own ? "edit" : ""}"
            title=${this.own ? L("Изменить аватар", "Change avatar") : ""}
            style=${this.avatarDrag
              ? "outline:3px solid var(--t-ink,#2b2a24)"
              : ""}
            @click=${(e: Event) => {
              if (!this.own) return;
              e.stopPropagation();
              this.avatarMenu = !this.avatarMenu;
            }}
            @dragover=${(e: DragEvent) => {
              if (!this.own) return;
              e.preventDefault();
              this.avatarDrag = true;
            }}
            @dragleave=${() => (this.avatarDrag = false)}
            @drop=${(e: DragEvent) => this.onAvatarDrop(e)}
          >
            <img src=${avSrc} alt="avatar" />
            ${this.own
              ? html`<div class="t-av-ov">
                    ✎ ${this.avatarBusy ? "…" : L("Изменить", "Edit")}
                  </div>
                  <div class="t-av-badge">✎</div>`
              : ""}
            ${this.own && this.avatarMenu ? this.renderAvatarMenu() : ""}
          </div>
          ${this.own
            ? html`<input
                type="file"
                accept="image/*"
                style="display:none"
                @change=${(e: Event) => this.onAvatarPick(e)}
              />`
            : ""}
          <div class="t-hero-id">
            <div class="t-hero-name">
              ${p.user.name}
              ${p.user.number
                ? html`<span
                    class="t-hero-num"
                    title=${L("Номер аккаунта", "Account number")}
                    >#${p.user.number}</span
                  >`
                : ""}
            </div>
            <div class="t-hero-chips">
              <span class="t-chip">${st.level} ${td("lvl")}</span>
              ${titleAch ? this.titlePill(titleAch) : ""}
            </div>
            ${this.renderActions()}
          </div>
        </div>
      </div>`;
  }

  // Ряд действий под шапкой (не в flex-строке — иначе на мобиле кнопка «болтается»).
  // Своё досье → «сменить звание». Чужое → друзья (по relation) + «пожаловаться».
  private renderActions(): TemplateResult {
    const btn = "padding:4px 11px;font-size:12px";
    // Своё досье (в т.ч. открытое по своему /@slug, где own ещё не выставлен) →
    // «сменить звание», без кнопок друзей/репорта на самого себя.
    if (this.own || this.relation === "self") {
      return html`<div
        style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"
      >
        <button
          class="t-btn ghost"
          style=${btn}
          @click=${() => (this.tab = "titles")}
        >
          ${td("change_title")}
        </button>
      </div>`;
    }
    let friend: TemplateResult;
    switch (this.relation) {
      case "friends":
        friend = html`<button
          class="t-btn"
          style="${btn};opacity:.6;cursor:default"
          disabled
        >
          ${L("✓ Друзья", "✓ Friends")}
        </button>`;
        break;
      case "incoming":
        // Они прислали заявку → один клик = друзья (fix «двойного клика»).
        friend = html`<button
          class="t-btn"
          style=${btn}
          ?disabled=${this.addingFriend}
          @click=${() => this.acceptIncoming()}
        >
          👥 ${L("Принять заявку", "Accept request")}
        </button>`;
        break;
      case "outgoing":
        friend = html`<button
            class="t-btn"
            style="${btn};opacity:.6;cursor:default"
            disabled
          >
            ✓ ${L("Отправлено", "Sent")}
          </button>
          <button
            class="t-btn ghost"
            style=${btn}
            ?disabled=${this.addingFriend}
            @click=${() => this.withdrawOutgoing()}
          >
            ${L("Отозвать", "Withdraw")}
          </button>`;
        break;
      default:
        friend = html`<button
          class="t-btn"
          style=${btn}
          ?disabled=${this.addingFriend}
          @click=${() => this.addFriend()}
        >
          👥 ${L("В друзья", "Add friend")}
        </button>`;
    }
    return html`<div
      style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px"
    >
      ${friend}
      <button
        class="t-btn ghost"
        style="${btn};color:var(--t-red,#a8432b);border-color:var(--t-red,#a8432b);margin-left:auto"
        title=${L("Пожаловаться на игрока", "Report player")}
        @click=${() => this.reportPlayer()}
      >
        🚩 ${L("Пожаловаться", "Report")}
      </button>
    </div>`;
  }

  // terron: заявка в друзья со страницы чужого досье (account→account). См. friends.md.
  private async addFriend(): Promise<void> {
    if (this.addingFriend) return;
    const me = await getUserMe();
    if (!me) {
      toast(
        L("Войдите, чтобы добавлять друзей", "Sign in to add friends"),
        "info",
      );
      this.goAccount();
      return;
    }
    this.addingFriend = true;
    const r = await requestFriendByIdentifier(this.slug);
    this.addingFriend = false;
    const map: Record<string, string> = {
      sent: L("Запрос отправлен", "Request sent"),
      auto_accepted: L("Теперь вы друзья", "You're now friends"),
      already_friends: L("Вы уже друзья", "Already friends"),
      already_pending: L("Запрос уже отправлен", "Request already pending"),
      self: L("Это ваш профиль", "This is your profile"),
      target_not_found: L("Игрок не найден", "Player not found"),
      error: L("Не удалось", "Failed"),
    };
    const ok = r.status === "sent" || r.status === "auto_accepted";
    toast(map[r.status] ?? map.error, ok ? "success" : "error");
    // Оптимистично обновляем relation (кнопку), чтобы не жать повторно.
    if (r.status === "auto_accepted" || r.status === "already_friends") {
      this.relation = "friends";
    } else if (r.status === "sent" || r.status === "already_pending") {
      this.relation = "outgoing";
    }
    // requestId исходящей нам не вернули → перечитаем профиль, чтобы «Отозвать»
    // знал id заявки (иначе кнопка отзыва не сработает до перезахода).
    if (r.status === "sent") void this.load();
  }

  // Принять входящую заявку (relation=incoming) → один клик = друзья. Fix
  // «двойного клика»: с чужого досье не нужно идти в /friews→Заявки, чтобы принять.
  private async acceptIncoming(): Promise<void> {
    if (this.addingFriend || !this.relReqId) return;
    this.addingFriend = true;
    const ok = await acceptFriendRequest(this.relReqId);
    this.addingFriend = false;
    if (ok) {
      this.relation = "friends";
      this.relReqId = undefined;
      toast(L("Теперь вы друзья", "You're now friends"), "success");
    } else toast(L("Не удалось", "Failed"), "error");
  }

  // Отозвать свою исходящую заявку (relation=outgoing).
  private async withdrawOutgoing(): Promise<void> {
    if (this.addingFriend || !this.relReqId) return;
    this.addingFriend = true;
    const ok = await withdrawFriendRequest(this.relReqId);
    this.addingFriend = false;
    if (ok) {
      this.relation = "none";
      this.relReqId = undefined;
      toast(L("Заявка отозвана", "Request withdrawn"), "info");
    } else toast(L("Не удалось", "Failed"), "error");
  }

  // Пожаловаться на игрока (красный флаг) — как в игре, но со страницы досье.
  private reportPlayer(): void {
    const p = this.profile;
    if (!p) return;
    const target =
      p.user.slug ??
      (p.user.number != null ? String(p.user.number) : this.slug);
    openReportDialog({
      targetSlug: target,
      name: p.user.name,
      context: L("Досье", "Dossier"),
    });
  }

  private titlePill(a: TerronAchievement): TemplateResult {
    const s = tierStyle(a.tier);
    return html`<span
      style="font-size:12px;font-weight:700;padding:1px 9px;border-radius:6px;background:${s.bg};color:${s.ink};border:1px solid ${s.c}"
      >${translateText(`achievements.${a.id}.title`)}</span
    >`;
  }

  // ── Табы подменю ────────────────────────────────────────────────────────────
  private renderTabs(): TemplateResult {
    const tabs: [Tab, string][] = [
      ["overview", td("tab_overview")],
      ["achievements", td("tab_achievements")],
      ["titles", td("tab_titles")],
    ];
    if (this.own) tabs.push(["skins", td("tab_skins")]);
    // terron: ЗАМКИ НА УЛЬТЫ — ростер-дерево (как персонажи в DBD). TZ-ult-unlocks.md
    if (this.own) tabs.push(["ults", L("Ульты", "Ultimates")]);
    if (this.own) tabs.push(["invites", L("Приглашения", "Invites")]);
    // ⚠️ terron 26.08: полоса ОБЯЗАНА скроллиться по горизонтали. На СВОЁМ
    // досье вкладок шесть (у чужого три — потому баг и не был виден со
    // стороны), и на 375–412px они требуют ~437px при ~327px доступных:
    // «Приглашения» просто обрезалась, а доскроллить было нечем — у flex по
    // умолчанию `nowrap` и нет `overflow-x`. Плюс `flex:0 0 auto` на пунктах:
    // без него flex сжимает их и рвёт слова по буквам вместо скролла.
    // scrollbar-width:none — полоса прокрутки поверх подчёркивания активной
    // вкладки выглядела бы сломанной вёрсткой.
    return html`<div
      style="display:flex;gap:18px;padding:10px 0;font-size:13px;border-bottom:1px solid rgba(0,0,0,.1);margin-bottom:6px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch"
    >
      ${tabs.map(
        ([id, label]) =>
          html`<span
            role="button"
            tabindex="0"
            @click=${() => (this.tab = id)}
            style=${this.tab === id
              ? "flex:0 0 auto;white-space:nowrap;font-weight:700;border-bottom:2px solid var(--t-ink,#2b2a24);padding-bottom:8px;margin-bottom:-11px;cursor:pointer"
              : "flex:0 0 auto;white-space:nowrap;opacity:.55;cursor:pointer"}
            >${label}</span
          >`,
      )}
    </div>`;
  }

  private renderTab(): TemplateResult {
    switch (this.tab) {
      case "achievements":
        return this.renderAchievements();
      case "titles":
        return this.renderTitles();
      case "skins":
        return this.renderSkins();
      case "invites":
        return this.renderReferral();
      case "ults":
        return html`<ult-tree></ult-tree>`;
      default:
        return html`${this.renderOverview()} ${this.renderStatsTable()}
        ${this.renderReplays()}`;
    }
  }

  // ── Обзор ───────────────────────────────────────────────────────────────────
  private stat(label: string, value: string, accent = false): TemplateResult {
    return html`<div class="t-stat">
      <div class="t-stat-val ${accent ? "t-accent" : ""}">${value}</div>
      <div class="t-stat-lbl">${label}</div>
    </div>`;
  }

  private renderDaily(): TemplateResult {
    if (!this.own || !this.daily || this.daily.length === 0) return html``;
    return html`<h3 class="t-h3">${td("daily_title")}</h3>
      <div
        style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px"
      >
        ${this.daily.map((q) => {
          const pct = q.threshold > 0 ? q.progress / q.threshold : 0;
          const done = q.claimed;
          const c = done ? "#639922" : "#BA7517";
          return html`<div
            style="background:#fdfcf7;border:0.5px solid rgba(0,0,0,.15);border-left:3px solid ${c};border-radius:0 8px 8px 0;padding:10px 12px"
          >
            <div style="display:flex;align-items:center;gap:9px">
              <span style="font-size:18px">${q.icon}</span>
              <div style="flex:1;min-width:0">
                <div style="font-weight:700">
                  ${translateText(`daily.${q.id}.title`)}
                </div>
                <div style="font-size:12px;opacity:.7">
                  ${n(q.progress)} / ${n(q.threshold)} ·
                  <b style="color:${c}">+${q.reward} ${td("reward_lts")}</b>
                </div>
              </div>
              ${done
                ? html`<span
                    style="color:#639922;font-size:13px;font-weight:700"
                    >${td("claimed")} ${uiIcon("check", 13)}</span
                  >`
                : ""}
            </div>
            <div
              style="height:6px;border-radius:3px;background:rgba(0,0,0,.1);overflow:hidden;margin-top:8px"
            >
              <div
                style="width:${Math.round(
                  Math.min(1, pct) * 100,
                )}%;height:100%;background:${c}"
              ></div>
            </div>
          </div>`;
        })}
      </div>`;
  }

  private renderOverview(): TemplateResult {
    const st = this.profile!.stats;
    const ach = this.profile!.achievements;
    const unlocked = ach.filter((a) => a.unlockedAt).length;
    return html`
      <!-- terron: «Задачи на сегодня» убраны из досье — дейлики временные, а профиль
           вечен (renderDaily оставлен в коде, но не выводится). -->
      <div class="t-grid">
        ${this.stat(td("games"), n(st.games))}
        ${this.stat(td("wins"), n(st.wins))}
        ${this.stat(td("winrate"), `${Math.round(st.winRate * 100)}%`)}
        ${this.stat(td("losses"), n(st.deaths))}
        ${this.stat(td("abandons"), n(st.abandons), st.abandons > 0)}
        ${this.stat(td("achievements"), `${unlocked}/${ach.length}`)}
      </div>
      <h3 class="t-h3">${td("eaten")}</h3>
      <div class="t-grid">
        ${this.stat(td("players"), n(st.eatenPlayers))}
        ${this.stat(td("nations"), n(st.eatenNations))}
        ${this.stat(td("tribes"), n(st.eatenTribes))}
        ${this.stat(td("conquests"), n(st.conquests))}
      </div>
      <h3 class="t-h3">${td("alive")}</h3>
      <div class="t-grid">
        ${this.stat(td("total"), dur(st.survivalTotalSeconds))}
        ${this.stat(td("best"), dur(st.survivalBestSeconds))}
        ${this.stat(td("avg"), dur(st.survivalAvgSeconds))}
      </div>
      ${this.renderStreaks()}
    `;
  }

  // terron 27.08: СЕРИИ. Ачивка считает ЛУЧШУЮ серию (метрика движка обязана
  // быть монотонной — иначе выданное пришлось бы отзывать), поэтому в досье
  // рядом с ней обязана стоять ТЕКУЩАЯ: без неё «7/10» после проигрыша выглядит
  // как сломанный счётчик. Формат «сейчас · лучшая N» — одна плитка на ленту.
  // ⚠️ Блока нет вовсе, если API старый (поля streaks нет) или в ленте пусто:
  // четыре нуля у новичка — это шум, а «Без побед подряд: 0» ещё и оскорбление.
  private renderStreaks(): TemplateResult {
    // ⚠️ ОБЁРНУТО НАМЕРЕННО: данные приходят снаружи (поле streaks у
    // /me/profile), и кривая форма не имеет права уносить с собой всё досье —
    // блок просто не рисуется, а в хелс летит текст ошибки (streak_ui_error).
    try {
      return this.streaksBlock();
    } catch (e) {
      reportHealth("streak_ui_error", String((e as Error)?.message ?? e));
      return html``;
    }
  }

  private streaksBlock(): TemplateResult {
    const s = this.profile!.streaks;
    if (!s) return html``;
    const any =
      s.win.best + s.bad.best + s.golden.best + s.diamond.best > 0 ||
      s.win.current + s.bad.current > 0;
    if (!any) return html``;
    // ⚠️ Крупным — ТЕКУЩАЯ серия (одно число), лучшая уходит в подпись. Первая
    // версия писала «2 · лучшая 2» прямо в значение, и на узкой плитке строка
    // переносилась, отрывая цифру лучшей серии от слова: та же болячка, что уже
    // ловили у таблицы ульт и у полосы победы.
    const cell = (
      label: string,
      p: { current: number; best: number },
      warn = false,
    ) =>
      this.stat(
        `${label} · ${td("streak_best")} ${n(p.best)}`,
        n(p.current),
        warn && p.current >= 3,
      );
    return html`<h3 class="t-h3">${td("streaks")}</h3>
      <div class="t-grid">
        ${cell(td("streak_win"), s.win)}
        ${cell(td("streak_bad"), s.bad, true)}
        ${s.golden.best > 0 || s.golden.current > 0
          ? cell(td("streak_golden"), s.golden)
          : ""}
        ${s.diamond.best > 0 || s.diamond.current > 0
          ? cell(td("streak_diamond"), s.diamond)
          : ""}
      </div>`;
  }

  // terron реферальная система: отдельный таб — ссылка + сколько пригласил + награды.
  private renderReferral(): TemplateResult {
    const r = this.referral;
    if (!r) return this.renderLoadingSpinner(td("loading"));
    // Воронка наград: открыл ссылку → зарегался → сыграл → выиграл.
    const steps: { type: string; icon: string; label: string }[] = [
      { type: "open", icon: "link", label: L("Открыл ссылку", "Opened link") },
      { type: "register", icon: "pencil", label: L("Зарегался", "Registered") },
      {
        type: "play",
        icon: "swords",
        label: L("Сыграл матч", "Played a match"),
      },
      { type: "win", icon: "trophy", label: L("Выиграл", "Won") },
    ];
    const rewardOf = (t: string) =>
      r.stats.find((s) => s.type === t)?.reward ?? 0;
    const funnel = html`<div
      style="display:flex; align-items:center; gap:4px; flex-wrap:wrap; margin:0 0 16px;"
    >
      ${steps.flatMap((s, i) => [
        html`<div
          style="flex:1; min-width:84px; text-align:center; padding:10px 6px; border:1px solid var(--t-border,rgba(0,0,0,.15)); border-radius:10px; background:rgba(0,0,0,.02);"
        >
          <div
            style="line-height:1; display:flex; justify-content:center; opacity:.85;"
          >
            ${uiIcon(s.icon, 22)}
          </div>
          <div
            style="font-size:12px; font-weight:600; color:var(--t-ink); margin-top:4px;"
          >
            ${s.label}
          </div>
          <div
            style="font-size:13px; font-weight:800; color:#16a34a; margin-top:2px;"
          >
            +${rewardOf(s.type)}
          </div>
        </div>`,
        i < steps.length - 1
          ? html`<div style="font-size:18px; color:var(--t-ink); opacity:.4;">
              →
            </div>`
          : null,
      ])}
    </div>`;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(r.link);
        toast(L("Ссылка скопирована", "Link copied"), "success");
      } catch {
        toast(L("Не удалось скопировать", "Couldn't copy"), "error");
      }
    };
    return html`
      <div
        style="color: var(--t-ink); margin: 4px 0 14px; font-size: 15px; line-height: 1.55;"
      >
        ${resolveMarkdown(
          L(
            `**Другу — ${r.signupBonus} ценных бумаг** при регистрации (вместо обычных 50). **Тебе — награда за каждое действие друга:** зашёл по ссылке, сыграл, зарегался, выиграл. Лимиты на месяц — ниже.`,
            `**Your friend — ${r.signupBonus} securities** on sign-up (instead of the usual 50). **You — a reward for each friend action:** opened the link, played, registered, won. Monthly limits below.`,
          ),
        )}
      </div>
      <div
        style="color: var(--t-ink); opacity: 0.7; margin: 0 0 14px; font-size: 13px; line-height: 1.5;"
      >
        ${resolveMarkdown(
          L(
            `Три способа позвать: дай эту **ссылку**, **создай лобби и позови** (заход по ссылке лобби тоже твой), *или* просто **дай ссылку на свой профиль** (\`/@${this.slug}\`) — кто зайдёт, привяжется к тебе. Сработало — у друга под кнопкой «Вход» горит «+200 бумаг».`,
            `Three ways to invite: share this **link**, **create a lobby and invite** (joining via the lobby link counts too), *or* just **share your profile link** (\`/@${this.slug}\`) — whoever visits is tied to you. It worked if your friend sees "+200 securities" under the "Sign in" button.`,
          ),
        )}
      </div>

      ${funnel}

      <div
        style="display:flex; gap:8px; align-items:center; margin-bottom:16px; flex-wrap:wrap;"
      >
        <input
          readonly
          .value=${r.link}
          @focus=${(e: Event) => (e.target as HTMLInputElement).select()}
          style="flex:1; min-width:200px; padding:9px 11px; border:1px solid var(--t-border, rgba(0,0,0,0.2)); border-radius:8px; background:rgba(0,0,0,0.03); color:var(--t-ink); font-size:13px;"
        />
        <button
          @click=${copy}
          style="padding:9px 16px; border-radius:8px; background:#2563eb; color:#fff; font-weight:700; cursor:pointer; border:none;"
        >
          ${L("Копировать", "Copy")}
        </button>
      </div>

      <h3 class="t-h3">
        ${L("Награды за друга (в этом месяце)", "Friend rewards (this month)")}
      </h3>
      <div class="t-grid">
        ${r.stats.map((s) =>
          this.stat(
            `${L(REF_EVENT_LABELS[s.type] ?? s.type, REF_EVENT_LABELS_EN[s.type] ?? REF_EVENT_LABELS[s.type] ?? s.type)} (+${s.reward})`,
            `${n(s.current)} / ${n(s.max)}`,
          ),
        )}
      </div>
    `;
  }

  private renderStatsTable(): TemplateResult {
    const st = this.profile!.stats;
    const row = (label: string, value: string) =>
      html`<tr>
        <td>${label}</td>
        <td class="num">${value}</td>
      </tr>`;
    return html`<h3 class="t-h3">${td("combat")}</h3>
      <table class="t-table">
        ${row(td("gold"), n(st.goldEarned))}
        ${row(td("attacks"), n(st.attacksSent))}
        ${row(td("structures"), n(st.structuresBuilt))}
        ${row(td("boats"), n(st.boatsSent))}
        ${row(td("bombs_launched"), n(st.bombsLaunched))}
        ${row(td("bombs_landed"), n(st.bombsLanded))}
        ${row(td("betrayals"), n(st.betrayals))}
        ${row(td("allies_players"), n(st.alliesPlayers))}
        ${row(td("allies_nations"), n(st.alliesNations))}
        ${row(td("allies_tribes"), n(st.alliesTribes))}
      </table>`;
  }

  // ── Достижения: семейства с тирами (редкость по тиру) ────────────────────────
  private renderAchievements(): TemplateResult {
    const fams = new Map<string, TerronAchievement[]>();
    for (const a of this.profile!.achievements) {
      const arr = fams.get(a.family) ?? [];
      arr.push(a);
      fams.set(a.family, arr);
    }
    return html`<div
      style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-top:6px"
    >
      ${[...fams.entries()].map(([fam, tiers]) =>
        this.familyCard(
          fam,
          tiers.sort((a, b) => a.tier - b.tier),
        ),
      )}
    </div>`;
  }

  private familyName(fam: string, tiers: TerronAchievement[]): string {
    if (tiers.length > 1) return translateText(`achievements.family.${fam}`);
    return translateText(`achievements.${tiers[0].id}.title`);
  }

  private familyCard(fam: string, tiers: TerronAchievement[]): TemplateResult {
    const next = tiers.find((t) => !t.unlockedAt);
    const unlockedCount = tiers.filter((t) => t.unlockedAt).length;
    const curTier = unlockedCount; // сколько тиров взято
    const accentTier = next ? next.tier : tiers[tiers.length - 1].tier;
    const s = tierStyle(accentTier);
    const progress = next ? next.progress : tiers[tiers.length - 1].threshold;
    const goal = next ? next.threshold : tiers[tiers.length - 1].threshold;
    const pct = Math.max(0, Math.min(1, goal > 0 ? progress / goal : 1));
    const open = this.expanded.has(fam);
    const sub = next
      ? `${td("tier")} ${curTier} ${td("of")} ${tiers.length}`
      : td("received");
    return html`<div
      style="background:#fdfcf7;border:0.5px solid rgba(0,0,0,.15);border-left:3px solid ${s.c};border-radius:0 8px 8px 0;padding:11px 13px;${tiers.length >
      1
        ? "cursor:pointer"
        : ""}"
      @click=${() => tiers.length > 1 && this.toggle(fam)}
    >
      <div style="display:flex;align-items:center;gap:9px">
        <span style="font-size:20px;color:${s.c}">${tiers[0].icon}</span>
        <div style="min-width:0;flex:1">
          <div style="font-weight:700">
            ${this.familyName(fam, tiers)}
            <span style="font-size:12px;opacity:.5;font-weight:400"
              >· ${sub}</span
            >
          </div>
          <div style="font-size:12px;opacity:.7">
            ${next ? `${n(progress)} / ${n(goal)}` : td("all_done")}${next &&
            next.reward > 0
              ? html` ·
                  <b style="color:${s.ink}"
                    >+${next.reward} ${td("reward_lts")}</b
                  >`
              : ""}
          </div>
        </div>
        ${tiers.length > 1
          ? html`<span style="opacity:.5;font-size:13px"
              >${open ? "▴" : "▾"}</span
            >`
          : tiers[0].unlockedAt
            ? html`<span style="color:${s.c};display:inline-flex"
                >${uiIcon("check", 15)}</span
              >`
            : ""}
      </div>
      <div
        style="height:6px;border-radius:3px;background:rgba(0,0,0,.1);overflow:hidden;margin-top:9px"
      >
        <div
          style="width:${Math.round(pct * 100)}%;height:100%;background:${s.c}"
        ></div>
      </div>
      ${open
        ? html`<div
            style="display:flex;flex-direction:column;gap:6px;margin-top:10px"
            @click=${(e: Event) => e.stopPropagation()}
          >
            ${tiers.map((t) => this.tierRow(t))}
          </div>`
        : ""}
    </div>`;
  }

  private tierRow(t: TerronAchievement): TemplateResult {
    const s = tierStyle(t.tier);
    const on = !!t.unlockedAt;
    const inProgress = !on && t.progress > 0 && t.progress < t.threshold;
    return html`<div
      style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;background:${s.bg};font-size:13px"
    >
      <span style="color:${s.c};display:inline-flex"
        >${on
          ? uiIcon("check", 14)
          : inProgress
            ? html`◔`
            : uiIcon("lock", 13)}</span
      >
      <span style="color:${s.ink};font-weight:700"
        >${td("tier")} ${t.tier}</span
      >
      <span style="opacity:.75"
        >${translateText(`achievements.${t.id}.desc`)}</span
      >
      ${!on && inProgress
        ? html`<span style="opacity:.6"
            >· ${n(t.progress)}/${n(t.threshold)}</span
          >`
        : ""}
      ${t.reward > 0
        ? html`<span style="margin-left:auto;color:${s.ink}"
            >+${t.reward} ${td("reward_lts")}</span
          >`
        : ""}
    </div>`;
  }

  private toggle(fam: string): void {
    const next = new Set(this.expanded);
    next.has(fam) ? next.delete(fam) : next.add(fam);
    this.expanded = next;
  }

  // ── Звания: открытые ачивки как носибельные звания (связь — клик ведёт к ним) ─
  private renderTitles(): TemplateResult {
    const unlocked = this.profile!.achievements.filter((a) => a.unlockedAt);
    if (unlocked.length === 0) {
      return html`<div class="t-muted" style="margin-top:10px">
        ${td("no_titles")}
      </div>`;
    }
    return html`<div
      style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:6px"
    >
      ${unlocked.map((a) => this.titleCard(a))}
    </div>`;
  }

  private titleCard(a: TerronAchievement): TemplateResult {
    const s = tierStyle(a.tier);
    const worn = this.activeTitle === a.id;
    return html`<div
      style="background:${s.bg};border:1px solid ${s.c};border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:9px"
    >
      <span style="font-size:20px;color:${s.ink}">${a.icon}</span>
      <div style="min-width:0;flex:1">
        <div style="font-weight:700;color:${s.ink}">
          ${translateText(`achievements.${a.id}.title`)}
        </div>
        <div
          role="button"
          tabindex="0"
          @click=${() => this.gotoAchievement(a.family)}
          style="font-size:11px;color:${s.ink};opacity:.75;cursor:pointer;text-decoration:underline"
        >
          ${td("tab_achievements")} →
        </div>
      </div>
      ${this.own
        ? html`<button
            style=${worn
              ? `padding:3px 11px;font-size:12px;font-weight:700;border-radius:6px;background:${s.ink};color:#fff;border:1px solid ${s.ink};cursor:pointer`
              : `padding:3px 11px;font-size:12px;font-weight:700;border-radius:6px;background:transparent;color:${s.ink};border:1px solid ${s.c};cursor:pointer`}
            @click=${() => this.wear(a.id)}
          >
            ${worn ? td("worn") : td("wear")}
          </button>`
        : ""}
    </div>`;
  }

  private wear(id: string): void {
    this.activeTitle = this.activeTitle === id ? "" : id;
    if (this.activeTitle)
      localStorage.setItem(ACTIVE_TITLE_KEY, this.activeTitle);
    else localStorage.removeItem(ACTIVE_TITLE_KEY);
  }

  private gotoAchievement(fam: string): void {
    this.tab = "achievements";
    this.expanded = new Set([fam]);
  }

  private renderSkins(): TemplateResult {
    const skins = allSkins();
    return html`<h3 class="t-h3">${td("skins_unlocked")}</h3>
      <div
        class="t-grid"
        style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))"
      >
        ${skins.map(
          (sk) =>
            html`<div class="t-skincard" style="padding:6px">
              <div
                class="t-skinprev"
                style="height:56px;${skinSwatchStyle(sk)}"
              ></div>
              <div class="t-skinname" style="font-size:11px;margin-top:6px">
                ${sk.name}
              </div>
            </div>`,
        )}
      </div>`;
  }

  private renderReplays(): TemplateResult {
    const games = this.profile!.games;
    return html`<h3 class="t-h3">${td("replays")}</h3>
      ${games.length === 0
        ? html`<div class="t-muted">${td("no_matches")}</div>`
        : games.map((g) => {
            const res = g.abandoned
              ? html`<span class="t-quit">${td("quit")}</span>`
              : g.won
                ? html`<span class="t-win">${td("win")}</span>`
                : html`<span class="t-loss">${td("loss")}</span>`;
            // событийные матчи в БД идут как обычный FFA — без метки игрок их
            // не отличает от рядовых («алмазные не сторятся», репорт 13.08)
            const tier =
              g.event_tier === "diamond"
                ? `💎 ${L("Алмазный", "Diamond")}`
                : g.event_tier === "golden"
                  ? `⭐ ${L("Золотой", "Golden")}`
                  : null;
            return html`<div class="t-row">
              <div class="t-row-main">
                <b>${g.map ?? "—"}</b>
                <span class="t-muted"
                  >${tier ? html`<b>${tier}</b> · ` : ""}${g.mode ?? ""} ·
                  ${dateRu(g.started_at)}</span
                >
              </div>
              <div class="t-muted">${dur(g.survival_seconds)}</div>
              <div>${res}</div>
              <div>
                ${g.has_replay
                  ? html`<a
                      class="t-btn ghost"
                      style="padding:4px 10px;font-size:11px"
                      href="/game/${g.game_id}"
                      >${td("watch")}</a
                    >`
                  : html`<span class="t-muted" style="font-size:11px"
                      >${td("no_record")}</span
                    >`}
              </div>
            </div>`;
          })}`;
  }

  private goAccount(): void {
    this.close();
    window.showPage?.("page-settings");
  }

  // ── аватар: загрузка (клик / drag-n-drop / вставка ⌘V / URL), как у скинов ──
  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("paste", this.onAvatarPaste);
    document.addEventListener("click", this.onDocClick);
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("paste", this.onAvatarPaste);
    document.removeEventListener("click", this.onDocClick);
  }

  // клик мимо меню аватарки — закрыть (сам клик по аватарке гасит всплытие)
  private onDocClick = (): void => {
    if (this.avatarMenu) this.avatarMenu = false;
  };

  private onAvatarPaste = (e: ClipboardEvent): void => {
    // только на СВОЁМ открытом профиле
    if (!this.own || this.classList.contains("hidden")) return;
    if (window.currentPageId && window.currentPageId !== "page-profile") return;
    const items = e.clipboardData?.items;
    if (items) {
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            void this.avatarFromFile(f);
            return;
          }
        }
      }
    }
    const text = e.clipboardData?.getData("text")?.trim();
    if (text && /^https?:\/\//i.test(text)) {
      e.preventDefault();
      void this.avatarFromUrl(text);
    }
  };

  // Клик по своей аватарке → выбор: нарисовать пиксель-портрет или залить картинку.
  private renderAvatarMenu(): TemplateResult {
    const item =
      "display:block;width:100%;text-align:left;padding:7px 10px;font-size:12px;" +
      "background:none;border:0;cursor:pointer;color:inherit;font-family:inherit;white-space:nowrap";
    return html`<div
      style="position:absolute;top:100%;left:0;margin-top:4px;z-index:30;background:var(--t-sheet,#fff);
             border:1px solid rgba(0,0,0,.25);box-shadow:3px 3px 0 rgba(0,0,0,.2);min-width:170px"
      @click=${(e: Event) => e.stopPropagation()}
    >
      <button
        style=${item}
        @click=${() => {
          this.avatarMenu = false;
          void this.openPortraitEditor();
        }}
      >
        ✏ ${L("Нарисовать портрет", "Draw a portrait")}
      </button>
      <button
        style=${item}
        @click=${() => {
          this.avatarMenu = false;
          this.avatarInput?.click();
        }}
      >
        🖼 ${L("Загрузить картинку", "Upload an image")}
      </button>
      <button
        style=${item}
        @click=${() => {
          this.avatarMenu = false;
          void this.openPortraitRoll();
        }}
      >
        🎲 ${L("Перегенерировать", "Reroll portrait")}
      </button>
    </div>`;
  }

  // terron 25.08: «перегенерировать» — рулетка портретов с ходьбой ←/→ между
  // вариантами (просьба владельца). Портрет пекётся по СЛУЧАЙНОМУ seed'у и
  // сохраняется обычной аватаркой, поэтому его видно и в топах, и в матче.
  // Динамический импорт — окно в основной бандл не тащим (бандл-диета).
  private async openPortraitRoll(): Promise<void> {
    const p = this.profile;
    if (!p) return;
    const seed =
      p.user.slug ??
      (p.user.number != null ? String(p.user.number) : p.user.name);
    const { avatarSrc } = await import("./Avatar");
    const current = avatarSrc({ avatar: p.user.avatar, seed, size: 160 });
    const { openPortraitRoll } = await import("./PortraitRoll");
    const url = await openPortraitRoll({ current });
    if (url) await this.saveAvatar(url);
  }

  private async openPortraitEditor(): Promise<void> {
    const p = this.profile;
    if (!p) return;
    const seed =
      p.user.slug ??
      (p.user.number != null ? String(p.user.number) : p.user.name);
    // динамический импорт: редактор в основной бандл не тащим (бандл-диета)
    const { openPortraitEditor } = await import("./PortraitEditor");
    const url = await openPortraitEditor({ seed, current: p.user.avatar });
    if (url) await this.saveAvatar(url);
  }

  private onAvatarPick(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void this.avatarFromFile(f);
  }

  private onAvatarDrop(e: DragEvent): void {
    if (!this.own) return;
    e.preventDefault();
    this.avatarDrag = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      void this.avatarFromFile(f);
    } else {
      const url =
        e.dataTransfer?.getData("text/uri-list") ||
        e.dataTransfer?.getData("text/plain");
      if (url) void this.avatarFromUrl(url.trim());
    }
  }

  private loadImg(src: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("img"));
      img.src = src;
    });
  }

  // квадратный center-crop до 128px → webp data-URL (компактно для БД).
  private downscaleAvatar(img: HTMLImageElement): string {
    const S = 128;
    const cv = document.createElement("canvas");
    cv.width = S;
    cv.height = S;
    const ctx = cv.getContext("2d")!;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
    return cv.toDataURL("image/webp", 0.85);
  }

  private async avatarFromFile(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      toast(L("Это не картинка", "Not an image"), "error");
      return;
    }
    try {
      const url = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onerror = () => rej(new Error("read"));
        r.onload = () => res(r.result as string);
        r.readAsDataURL(file);
      });
      const img = await this.loadImg(url);
      await this.saveAvatar(this.downscaleAvatar(img));
    } catch {
      toast(
        L("Не удалось обработать картинку", "Couldn't process image"),
        "error",
      );
    }
  }

  private async avatarFromUrl(url: string): Promise<void> {
    try {
      const img = await this.loadImg(url);
      await this.saveAvatar(this.downscaleAvatar(img));
    } catch {
      toast(
        L(
          "Не удалось загрузить по ссылке (CORS?)",
          "Couldn't load from URL (CORS?)",
        ),
        "error",
      );
    }
  }

  private async saveAvatar(dataUrl: string): Promise<void> {
    if (this.avatarBusy) return;
    this.avatarBusy = true;
    const r = await updateMe({ avatar: dataUrl });
    this.avatarBusy = false;
    if (!r.ok) {
      toast(L("Не удалось сохранить аватар", "Couldn't save avatar"), "error");
      return;
    }
    // обновить локально + оповестить (навбар/другие показы аватара)
    if (this.profile)
      this.profile = {
        ...this.profile,
        user: { ...this.profile.user, avatar: dataUrl },
      };
    this.requestUpdate();
    toast(L("Аватар обновлён", "Avatar updated"), "success");
    window.dispatchEvent(new CustomEvent("terron-avatar-updated"));
  }

  // ---- lifecycle ----
  protected onOpen(args?: Record<string, unknown>): void {
    const slug = typeof args?.slug === "string" && args.slug ? args.slug : "me";
    this.own = slug === "me";
    this.slug = slug.replace(/^@/, "");
    this.tab = "overview";
    // deep-link на конкретный таб (напр. из инвайт-топа → «Приглашения»). Разовый
    // флажок в sessionStorage переживает full-nav на /@me. Применяем только к своему.
    try {
      const want = sessionStorage.getItem("terron_profile_tab");
      if (want) {
        sessionStorage.removeItem("terron_profile_tab");
        if (
          this.own &&
          (want === "invites" ||
            want === "titles" ||
            want === "skins" ||
            want === "ults")
        ) {
          this.tab = want as Tab;
        }
      }
    } catch {
      /* ignore */
    }
    void this.load();
  }

  private loadSeq = 0;
  private async load(): Promise<void> {
    // terron: каждый load получает номер; результат применяет только САМЫЙ свежий.
    // Чинит баг профиля по ссылке (/rating → /@slug): дефолтная гостевая загрузка
    // "me" возвращает null и гонкой ставила notFound=true поверх валидного профиля
    // (т.к. проверяла изменившийся this.slug, а не slug своей загрузки) → ложный 404.
    const seq = ++this.loadSeq;
    const slug = this.slug; // зафиксировать хэндл ИМЕННО этой загрузки
    this.relation = "none"; // сброс отношения при смене профиля
    this.relReqId = undefined;
    this.loading = true;
    this.notFound = false;
    this.clanView = null;
    this.requestUpdate();
    try {
      const p =
        slug === "me" ? await getMyProfile() : await getProfileBySlug(slug);
      if (seq !== this.loadSeq) return; // устарел — более новый load уже идёт
      // Не юзер → возможно клан (общий /@slug namespace).
      if (!p && slug !== "me") {
        const clan = await fetchClanBySlug(slug);
        if (seq !== this.loadSeq) return;
        if (clan) this.clanView = clan;
      }
      this.profile = p;
      this.notFound = !p && !this.clanView && slug !== "me";
      if (p) {
        if (slug === "me") this.own = true;
        // Отношение к игроку (для кнопки друзей). Своё досье → "self".
        this.relation = p.relation?.state ?? (slug === "me" ? "self" : "none");
        // terron: СВОЁ досье, открытое по прямому адресу `/@<slug>`, — тоже своё.
        // Раньше `own` включался ТОЛЬКО на `/@me`, а страница сама переписывает
        // адрес на `/@<slug>` (ниже) — после перезагрузки/захода по ссылке
        // владелец терял редактирование аватара, вкладки «Скины»/«Приглашения»
        // и дейлики. Признак владельца берём у сервера: relationTo() отдаёт
        // "self", когда зритель и есть владелец профиля.
        if (this.relation === "self") this.own = true;
        this.relReqId = p.relation?.requestId;
        // публичный хэндл: slug если задан, иначе номер (#id). Редиректим id→slug,
        // когда slug появился; новый юзер без slug остаётся на /@<номер>.
        const handle =
          p.user.slug ?? (p.user.number != null ? String(p.user.number) : "me");
        if (handle !== "me" && handle !== this.slug) {
          this.slug = handle;
          history.replaceState(history.state, "", `/@${handle}`);
        }
        // terron: зашёл на ЧУЖОЙ профиль → становится рефералом владельца (first-touch;
        // самопривязку отсекает сервер). Реферал — только по slug (если задан).
        if (!this.own && p.user.slug) captureProfileReferral(p.user.slug);
      }
      // дейлики + реферальная ссылка/статистика — только для своего досье
      if (p && this.own) {
        getDailyQuests()
          .then((d) => {
            this.daily = d?.quests ?? null;
            this.requestUpdate();
          })
          .catch(() => {});
        getMyReferral()
          .then((r) => {
            this.referral = r;
            this.requestUpdate();
          })
          .catch(() => {});
      }
    } finally {
      if (seq === this.loadSeq) {
        this.loading = false;
        this.requestUpdate();
      }
    }
  }

  protected onClose(): void {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }
}

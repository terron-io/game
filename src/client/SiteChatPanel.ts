import { Centrifuge, type Subscription } from "centrifuge";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";
import { avatarFallback, avatarSrc } from "./Avatar";
import {
  CHAT_MAX_LEN,
  chatNotifyLevel,
  fetchChats,
  fetchMessages,
  forbiddenLinkHosts,
  markChatRead,
  openClanChat,
  openDm,
  sendChatMessage,
  setChatNotifyLevel,
  setDmBlocked,
  type ChatMessage,
  type ChatNotifyLevel,
  type ChatSummary,
  type ClanSummary,
  type DmSummary,
  type OnlineState,
  type SendError,
} from "./ChatApi";
import { localizeClanText } from "./ClanTerm";
import { chatIcon } from "./components/ui/ChatIcon";
import { deviceTraceHeaders } from "./DeviceTrace";
import {
  disablePushTopic,
  enablePush,
  pushSupported,
  showPushHelp,
} from "./PushNotify";
import { openReportDialog } from "./ReportDialog";
import { siteChatAllowed } from "./SiteChatGate";
import { softGo } from "./SoftNavigate";
import { toast } from "./Toast";
import { L } from "./Utils";

// terron 22.09: ПАНЕЛЬ ЧАТОВ САЙТА — личные сообщения (друзья) и чаты кланов.
// Спека — chats.md. Устройство — как у чата лобби (LobbyChatPanel), но СПРАВА
// (слева живёт чат лобби), с двумя экранами: список диалогов ↔ переписка.
//
// Данные: список и история — REST (`/me/chats…`, источник правды — Postgres);
// живые сообщения — Centrifugo (`dm:<a>_<b>`, `clan:<id>`): подписка на ВСЕ
// свои кланы (счётчик непрочитанных) + на открытый ЛС-диалог; про новые ЛС в
// закрытых диалогах сообщает лента друзей (`friends:feed#<uid>`, событие
// `kind:"dm"` → window-событие `terron-dm` из FriendsNotifier).
//
// ⚠️ Отправка — ТОЛЬКО ручкой `/send`: публиковать в канал клиенту запрещено
// (сервер пишет журнал и сам публикует). Ссылки не парсим (текст как есть),
// а не-соцсетевые ссылки режет и клиент (подсказка), и сервер (решение).
// ⚠️ В матче (body.in-game) панель не рисуется — там свой чат.

const COOLDOWN_MS = 2000;

const CHAT_ICON = chatIcon(24);
const DESKTOP_MQ = "(min-width: 1024px)";

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "2-digit", month: "2-digit" }) +
        " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sendErrorText(e: SendError, hosts?: string[]): string {
  switch (e) {
    case "links":
      return (
        L(
          "Ссылки запрещены, кроме соцсетей",
          "Links are not allowed, except social networks",
        ) + (hosts?.length ? `: ${hosts.join(", ")}` : "")
      );
    case "too_fast":
      return L("Не так быстро", "Not so fast");
    case "daily_cap":
      return L(
        "Лимит сообщений на сегодня исчерпан",
        "Daily message limit reached",
      );
    case "duplicate":
      return L("Это же сообщение уже отправлено", "Same message was just sent");
    case "too_long":
      return L("Слишком длинное сообщение", "Message is too long");
    case "blocked":
      return L("Переписка заблокирована", "This chat is blocked");
    case "forbidden":
      return L("Писать сюда нельзя", "You can't write here");
    case "unauthorized":
      return L("Войди в аккаунт", "Sign in first");
    case "empty":
      return L("Пустое сообщение", "Empty message");
    default:
      return L("Не отправилось, попробуй ещё раз", "Not sent, try again");
  }
}

@customElement("site-chat-panel")
export class SiteChatPanel extends LitElement {
  @state() private ready = false; // залогинен и список загружен
  @state() private open = false;
  @state() private view: "list" | "conv" = "list";
  @state() private dms: DmSummary[] = [];
  @state() private clans: ClanSummary[] = [];
  @state() private current: ChatSummary | null = null;
  @state() private messages: ChatMessage[] = [];
  @state() private draft = "";
  @state() private cooldownLeft = 0;
  @state() private loadingMessages = false;
  @state() private hasMore = false;
  @state() private connected = false;
  @state() private inGame = false;
  @state() private notify: ChatNotifyLevel = chatNotifyLevel();
  @state() private pushBusy = false;

  private myUid = "";
  private centrifuge: Centrifuge | null = null;
  private subs = new Map<string, Subscription>();
  private cooldownTimer: number | null = null;
  private bodyObserver: MutationObserver | null = null;
  private started = false;

  createRenderRoot() {
    return this; // light DOM — Tailwind + тема сайта
  }

  connectedCallback() {
    super.connectedCallback();
    this.inGame = document.body.classList.contains("in-game");
    this.bodyObserver = new MutationObserver(() => {
      this.inGame = document.body.classList.contains("in-game");
    });
    this.bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addEventListener("terron-dm", this.onDmEvent);
    // Приняли/удалили друга — список диалогов перечитать (репорт владельца:
    // новые друзья в панели не появлялись до перезагрузки).
    window.addEventListener("terron-friends-changed", this.onFriendsChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.bodyObserver?.disconnect();
    window.removeEventListener("terron-dm", this.onDmEvent);
    window.removeEventListener("terron-friends-changed", this.onFriendsChanged);
    this.teardown();
  }

  /** Зовёт Main после того, как узнал, что игрок залогинен. */
  public async start(): Promise<void> {
    if (this.started || !siteChatAllowed()) return;
    this.started = true;
    await this.reload();
  }

  private async reload(): Promise<boolean> {
    const c = await fetchChats();
    if (!c) {
      this.started = false;
      return false;
    }
    this.myUid = c.me;
    this.dms = c.dms;
    this.clans = c.clans;
    // Сервер знает, подписан ли этот аккаунт на пуши о ЛС; локальный уровень
    // «в игре» при живой подписке дорастает до «+пуши» (подписка пережила
    // очистку localStorage), а «никаких» уважаем как есть.
    if (c.notify?.pushDm && this.notify === "ingame") this.notify = "push";
    if (this.current) {
      const fresh = [...c.dms, ...c.clans].find(
        (x) => x.channel === this.current?.channel,
      );
      if (fresh) this.current = fresh;
    }
    this.ready = true;
    void this.connect();
    return true;
  }

  private onFriendsChanged = (): void => {
    if (this.started) void this.reload();
  };

  // ---------- уведомления ----------

  private async setNotify(level: ChatNotifyLevel): Promise<void> {
    if (this.pushBusy) return;
    const prev = this.notify;
    if (level === "push") {
      if (!pushSupported()) {
        toast(
          L("Этот браузер не умеет пуши", "This browser doesn't support push"),
          "error",
        );
        return;
      }
      this.pushBusy = true;
      const r = await enablePush("dm");
      this.pushBusy = false;
      if (r === "denied") {
        showPushHelp();
        return;
      }
      if (r !== "ok" && r !== "already") {
        toast(L("Не удалось включить пуши", "Couldn't enable push"), "error");
        return;
      }
      toast(L("Пуши о сообщениях включены", "Message push enabled"), "success");
    } else if (prev === "push") {
      void disablePushTopic("dm");
    }
    this.notify = level;
    setChatNotifyLevel(level);
  }

  private renderNotifyBar(): TemplateResult {
    const opt = (level: ChatNotifyLevel, label: string, title: string) =>
      html`<button
        class="px-2 py-1 text-[11px] rounded border ${this.notify === level
          ? "bg-blue-600 border-blue-500 text-white"
          : "border-slate-600 text-slate-300 hover:text-white"}"
        title=${title}
        ?disabled=${this.pushBusy}
        @click=${() => this.setNotify(level)}
      >
        ${label}
      </button>`;
    return html`<div
      class="site-chat-notify flex items-center gap-1 px-3 py-2 border-b border-slate-800 shrink-0"
    >
      <span class="text-[10px] uppercase tracking-wide text-slate-500 mr-1"
        >${L("Уведомления", "Alerts")}</span
      >
      ${opt(
        "none",
        L("Нет", "None"),
        L("Ни на сайте, ни в игре", "Neither on site nor in game"),
      )}
      ${opt(
        "ingame",
        L("В игре", "In game"),
        L(
          "Подсказка на сайте и строка в ленте матча",
          "Toast on site and a line in the match feed",
        ),
      )}
      ${opt(
        "push",
        L("+ Пуши", "+ Push"),
        L(
          "Ещё и пуш в браузер, когда ты не в сети",
          "Plus a browser push when you're offline",
        ),
      )}
    </div>`;
  }

  private async toggleBlock(): Promise<void> {
    const cur = this.current;
    if (!cur || cur.kind !== "dm") return;
    const on = cur.blocked !== "by_me";
    const ok = await setDmBlocked(cur.conv, on);
    if (!ok) {
      toast(L("Не удалось", "Failed"), "error");
      return;
    }
    this.current = { ...cur, blocked: on ? "by_me" : null };
    this.dms = this.dms.map((d) =>
      d.conv === cur.conv ? { ...d, blocked: on ? "by_me" : null } : d,
    );
    toast(
      on
        ? L("Собеседник заблокирован", "User blocked")
        : L("Блок снят", "Unblocked"),
      "success",
    );
  }

  private onlineLabel(s: DmSummary): { text: string; cls: string } {
    const seen = s.pushDm
      ? L("получит пуш", "will get a push")
      : L("увидит при заходе", "will see it next time");
    switch (s.online) {
      case "in_game":
        return { text: L("в игре", "in game"), cls: "text-emerald-400" };
      case "lobby":
        return { text: L("в лобби", "in lobby"), cls: "text-emerald-400" };
      case "online":
        return { text: L("онлайн", "online"), cls: "text-emerald-400" };
      default:
        return {
          text: L("не в сети", "offline") + " · " + seen,
          cls: "text-slate-500",
        };
    }
  }

  private onlineDot(state: OnlineState): TemplateResult {
    const cls =
      state === "offline"
        ? "bg-slate-500"
        : state === "online"
          ? "bg-emerald-400"
          : "bg-amber-300";
    return html`<span
      class="inline-block w-2 h-2 rounded-full ${cls} shrink-0"
    ></span>`;
  }

  // ---------- Centrifugo ----------

  private async fetchToken(): Promise<string> {
    const res = await fetch(`${getApiBase()}/realtime/token`, {
      headers: {
        authorization: await getAuthHeader(),
        ...deviceTraceHeaders(),
      },
    });
    if (!res.ok) throw new Error("realtime token failed");
    const j = (await res.json()) as { token: string };
    return j.token;
  }

  private async connect(): Promise<void> {
    if (!this.centrifuge) {
      const wsUrl =
        getApiBase().replace(/^http/, "ws") + "/connection/websocket";
      const cf = new Centrifuge(wsUrl, { getToken: () => this.fetchToken() });
      cf.on("connected", () => (this.connected = true));
      cf.on("disconnected", () => (this.connected = false));
      this.centrifuge = cf;
      cf.connect();
    }
    // Все свои кланы слушаем постоянно — иначе непрочитанные клановые не посчитать.
    for (const c of this.clans) this.subscribe(c.channel);
  }

  private subscribe(channel: string): void {
    if (!this.centrifuge || this.subs.has(channel)) return;
    const sub = this.centrifuge.newSubscription(channel, { recoverable: true });
    sub.on("publication", (ctx) =>
      this.onLive(channel, ctx.data as ChatMessage),
    );
    sub.on("error", () => {
      /* 403 (не друг / не член) — молча, список всё равно с сервера */
    });
    this.subs.set(channel, sub);
    sub.subscribe();
  }

  private unsubscribe(channel: string): void {
    const s = this.subs.get(channel);
    if (!s) return;
    s.unsubscribe();
    this.centrifuge?.removeSubscription(s);
    this.subs.delete(channel);
  }

  private teardown(): void {
    for (const ch of [...this.subs.keys()]) this.unsubscribe(ch);
    this.centrifuge?.disconnect();
    this.centrifuge = null;
    this.connected = false;
    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }

  // Живое сообщение из канала: открыт этот диалог → в ленту (+прочитано),
  // иначе — непрочитанное в списке.
  private onLive(channel: string, m: ChatMessage): void {
    if (!m?.text) return;
    const cur = this.current;
    if (cur && cur.channel === channel && this.view === "conv") {
      if (this.messages.some((x) => x.id === m.id)) return; // своё эхо
      this.appendMessages([m]);
      this.bumpLast(channel, m, 0);
      if (m.from.uid !== this.myUid && this.chatVisible()) {
        void markChatRead(cur.kind, cur.conv, m.id);
      } else if (m.from.uid !== this.myUid) {
        this.bumpLast(channel, m, 1);
      }
      return;
    }
    if (m.from.uid !== this.myUid) this.bumpLast(channel, m, 1);
    else this.bumpLast(channel, m, 0);
  }

  // Уведомление о новом ЛС из ленты друзей (закрытый диалог или панель свёрнута).
  private onDmEvent = (e: Event): void => {
    const d = (e as CustomEvent).detail as {
      channel?: string;
      conv?: string;
      from?: ChatMessage["from"];
      preview?: string;
      id?: number;
      ts?: number;
    };
    if (!d?.channel || !d.from) return;
    // Открытый и ВИДИМЫЙ диалог получает то же сообщение из своего канала —
    // не дублируем; свёрнутая панель с тем же диалогом тост всё же показывает.
    if (
      this.current?.channel === d.channel &&
      this.view === "conv" &&
      this.open
    )
      return;
    const known = this.dms.some((x) => x.channel === d.channel);
    if (!known) {
      // Новый друг, которого в списке ещё нет — перечитать список.
      void this.reload();
      return;
    }
    this.bumpLast(
      d.channel,
      {
        id: d.id ?? 0,
        text: d.preview ?? "",
        from: d.from,
        ts: d.ts ?? Date.now(),
      },
      1,
    );
    // В матче вместо тоста — строка в ленте матча (EventsDisplay.onSiteDm).
    if (!this.open && !this.inGame && this.notify !== "none") {
      toast(
        `✉ ${d.from.name}: ${(d.preview ?? "").slice(0, 60)}`,
        "info",
        3500,
      );
    }
  };

  private bumpLast(channel: string, m: ChatMessage, unreadDelta: number): void {
    const upd = <T extends ChatSummary>(list: T[]): T[] => {
      const i = list.findIndex((x) => x.channel === channel);
      if (i === -1) return list;
      const item = {
        ...list[i],
        last: {
          text: m.text,
          ts: m.ts,
          fromUid: m.from.uid,
          fromName: m.from.name,
        },
        unread: list[i].unread + unreadDelta,
      } as T;
      const rest = list.filter((_, j) => j !== i);
      return [item, ...rest];
    };
    if (channel.startsWith("dm:")) this.dms = upd(this.dms);
    else this.clans = upd(this.clans);
  }

  private clearUnread(channel: string): void {
    const clr = <T extends ChatSummary>(list: T[]): T[] =>
      list.map((x) => (x.channel === channel ? { ...x, unread: 0 } : x));
    this.dms = clr(this.dms);
    this.clans = clr(this.clans);
  }

  private unreadTotal(): number {
    let n = 0;
    for (const d of this.dms) n += d.unread;
    for (const c of this.clans) n += c.unread;
    return Math.min(99, n);
  }

  // ---------- открытие ----------

  /** «Написать» из досье: хэндл (@slug / номер). ЛС только друзьям. */
  public async openDmWith(handle: string): Promise<void> {
    const r = await openDm(handle);
    if ("error" in r) {
      const msg =
        r.error === "not_friends"
          ? L(
              "Личные сообщения только между друзьями — сначала добавь в друзья",
              "Direct messages are friends-only — add as a friend first",
            )
          : r.error === "self"
            ? L("Это ты сам", "That's you")
            : r.error === "unauthorized"
              ? L("Войди в аккаунт", "Sign in first")
              : L("Не удалось открыть диалог", "Couldn't open the chat");
      toast(msg, "error");
      return;
    }
    if (!this.ready) await this.reload();
    if (!this.dms.some((d) => d.channel === r.channel))
      this.dms = [r, ...this.dms];
    await this.openConv(r);
  }

  /** «Чат клана» со страницы клана (тег). Только участнику. */
  public async openClanWith(tag: string): Promise<void> {
    const r = await openClanChat(tag);
    if ("error" in r) {
      toast(
        r.error === "not_member"
          ? L("Чат клана — только для участников", "Clan chat is members-only")
          : r.error === "unauthorized"
            ? L("Войди в аккаунт", "Sign in first")
            : L("Не удалось открыть чат", "Couldn't open the chat"),
        "error",
      );
      return;
    }
    if (!this.ready) await this.reload();
    if (!this.clans.some((c) => c.channel === r.channel))
      this.clans = [r, ...this.clans];
    await this.openConv(r);
  }

  private async openConv(s: ChatSummary): Promise<void> {
    // Прежний открытый ЛС-канал отписываем (кланы слушаем всегда).
    if (
      this.current &&
      this.current.kind === "dm" &&
      this.current.channel !== s.channel
    ) {
      this.unsubscribe(this.current.channel);
    }
    this.current = s;
    this.view = "conv";
    this.open = true;
    this.messages = [];
    this.hasMore = false;
    this.loadingMessages = true;
    this.clearUnread(s.channel);
    this.subscribe(s.channel);
    const list = await fetchMessages(s.kind, s.conv);
    this.loadingMessages = false;
    if (list) {
      this.messages = list;
      this.hasMore = list.length >= 50;
      this.scrollToBottom();
    }
    this.updateComplete.then(() =>
      (
        this.querySelector("#site-chat-input") as HTMLInputElement | null
      )?.focus(),
    );
  }

  private async loadMore(): Promise<void> {
    const cur = this.current;
    if (!cur || this.loadingMessages || this.messages.length === 0) return;
    this.loadingMessages = true;
    const older = await fetchMessages(cur.kind, cur.conv, this.messages[0].id);
    this.loadingMessages = false;
    if (!older) return;
    this.hasMore = older.length >= 50;
    const box = this.querySelector("#site-chat-feed");
    const before = box ? box.scrollHeight - box.scrollTop : 0;
    this.messages = [...older, ...this.messages];
    this.updateComplete.then(() => {
      if (box) box.scrollTop = box.scrollHeight - before;
    });
  }

  private backToList(): void {
    if (this.current?.kind === "dm") this.unsubscribe(this.current.channel);
    this.current = null;
    this.view = "list";
    this.messages = [];
  }

  private appendMessages(list: ChatMessage[]): void {
    this.messages = [...this.messages, ...list].slice(-300);
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    this.updateComplete.then(() => {
      const box = this.querySelector("#site-chat-feed");
      if (box) box.scrollTop = box.scrollHeight;
    });
  }

  // ---------- отправка ----------

  private async send(): Promise<void> {
    const cur = this.current;
    const text = this.draft.trim();
    if (!cur || !text || this.cooldownLeft > 0) return;
    if (text.length > CHAT_MAX_LEN) {
      toast(sendErrorText("too_long"), "error");
      return;
    }
    const bad = forbiddenLinkHosts(text);
    if (bad.length > 0) {
      toast(sendErrorText("links", bad), "error");
      return;
    }
    this.draft = "";
    this.startCooldown();
    const r = await sendChatMessage(cur.kind, cur.conv, text);
    if ("error" in r) {
      this.draft = text; // вернуть текст в поле — пусть поправит
      toast(sendErrorText(r.error, r.hosts), "error");
      return;
    }
    if (!this.messages.some((x) => x.id === r.id)) this.appendMessages([r]);
    this.bumpLast(cur.channel, r, 0);
  }

  private startCooldown(): void {
    const until = Date.now() + COOLDOWN_MS;
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      this.cooldownLeft = left;
      if (left <= 0 && this.cooldownTimer) {
        clearInterval(this.cooldownTimer);
        this.cooldownTimer = null;
      }
    };
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    tick();
    this.cooldownTimer = window.setInterval(tick, 250);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void this.send();
    }
  }

  // ---------- показ ----------

  private chatVisible(): boolean {
    const el = this.querySelector(".site-chat-card");
    return !!el && el.getBoundingClientRect().width > 0;
  }

  private toggle(): void {
    this.open = !this.open;
    if (this.open) {
      // Список мог устареть (новые друзья, онлайн-статусы) — перечитать.
      void this.reload();
      if (this.current && this.view === "conv") {
        this.clearUnread(this.current.channel);
        const last = this.messages[this.messages.length - 1];
        if (last && this.current)
          void markChatRead(this.current.kind, this.current.conv, last.id);
      }
      this.updateComplete.then(() =>
        (
          this.querySelector("#site-chat-input") as HTMLInputElement | null
        )?.focus(),
      );
    }
  }

  private report(): void {
    const cur = this.current;
    if (!cur) return;
    const lastOther = [...this.messages]
      .reverse()
      .find((m) => m.from.uid !== this.myUid);
    if (cur.kind === "dm") {
      openReportDialog({
        targetSlug: cur.peer.slug ?? cur.peer.handle,
        name: cur.peer.name,
        context:
          L("Личные сообщения", "Direct messages") +
          (lastOther ? `: «${lastOther.text.slice(0, 120)}»` : ""),
      });
    } else if (lastOther) {
      openReportDialog({
        targetSlug: lastOther.from.slug ?? lastOther.from.handle,
        name: lastOther.from.name,
        context:
          L("Чат клана", "Clan chat") + `: «${lastOther.text.slice(0, 120)}»`,
      });
    }
  }

  private titleOf(s: ChatSummary): string {
    return s.kind === "dm"
      ? s.peer.name
      : `[${s.clan.tag}] ${localizeClanText(s.clan.name, s.clan.nameRu ?? undefined)}`;
  }

  private renderHeader(): TemplateResult {
    const cur = this.current;
    return html`<div
      class="flex items-center gap-2 px-3 py-2 border-b border-slate-700 shrink-0"
    >
      ${this.view === "conv" && cur
        ? html`<button
              class="text-slate-300 hover:text-white"
              title=${L("К списку", "Back to list")}
              @click=${() => this.backToList()}
            >
              ←
            </button>
            <a
              class="font-bold truncate min-w-0 text-white hover:underline"
              href=${cur.kind === "dm"
                ? `/@${cur.peer.handle}`
                : `/clan/${cur.clan.slug}`}
              @click=${(e: Event) => {
                e.preventDefault();
                softGo(
                  cur.kind === "dm"
                    ? `/@${cur.peer.handle}`
                    : `/clan/${cur.clan.slug}`,
                );
              }}
              >${this.titleOf(cur)}</a
            >
            ${cur.kind === "dm"
              ? html`<button
                  class="ml-auto text-xs ${cur.blocked === "by_me"
                    ? "text-red-400"
                    : "text-slate-400 hover:text-red-400"}"
                  title=${cur.blocked === "by_me"
                    ? L("Снять блок", "Unblock")
                    : L("Заблокировать собеседника", "Block user")}
                  @click=${() => this.toggleBlock()}
                >
                  ${cur.blocked === "by_me" ? "🔓" : "⛔"}
                </button>`
              : html`<span class="ml-auto"></span>`}
            <button
              class="text-slate-400 hover:text-red-400 text-xs"
              title=${L("Пожаловаться", "Report")}
              @click=${() => this.report()}
            >
              🚩
            </button>`
        : html`<span class="font-bold">${L("Сообщения", "Messages")}</span>
            <span class="ml-auto"></span>`}
      <span
        class="w-2 h-2 rounded-full ${this.connected
          ? "bg-emerald-400"
          : "bg-slate-500"}"
      ></span>
      <button
        class="text-slate-400 hover:text-white"
        title=${L("Свернуть", "Collapse")}
        aria-label=${L("Свернуть", "Collapse")}
        @click=${() => this.toggle()}
      >
        ✕
      </button>
    </div>`;
  }

  private renderListRow(s: ChatSummary): TemplateResult {
    const last = s.last;
    const sub = last
      ? html`<span class="text-slate-400 text-xs truncate block"
          >${last.fromUid === this.myUid
            ? L("Вы: ", "You: ")
            : s.kind === "clan" && "fromName" in last
              ? `${last.fromName}: `
              : ""}${last.text}</span
        >`
      : html`<span class="text-slate-500 text-xs"
          >${L("Сообщений пока нет", "No messages yet")}</span
        >`;
    const avatar =
      s.kind === "dm"
        ? html`<img
            src=${avatarSrc({
              seed: s.peer.slug ?? s.peer.handle,
              slug: s.peer.slug,
              hasAvatar: s.peer.hasAvatar,
              size: 64,
            })}
            alt=""
            class="w-8 h-8 rounded shrink-0 border border-slate-600"
            @error=${avatarFallback(s.peer.slug ?? s.peer.handle, 64)}
          />`
        : html`<span
            class="w-8 h-8 rounded shrink-0 border border-slate-600 flex items-center justify-center text-[10px] font-bold text-amber-300"
            >${s.clan.tag}</span
          >`;
    return html`<button
      class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/70 border-b border-slate-800"
      @click=${() => this.openConv(s)}
    >
      ${avatar}
      <span class="min-w-0 flex-1">
        <span
          class="font-semibold text-white truncate block flex items-center gap-1"
          >${s.kind === "dm" ? this.onlineDot(s.online) : ""}<span
            class="truncate"
            >${this.titleOf(s)}</span
          >${s.kind === "dm" && s.blocked
            ? html`<span class="text-[10px] text-red-400">⛔</span>`
            : ""}</span
        >
        ${s.kind === "dm"
          ? html`<span class="text-[10px] ${this.onlineLabel(s).cls} block"
              >${this.onlineLabel(s).text}</span
            >`
          : ""}
        ${sub}
      </span>
      ${last
        ? html`<span class="text-[10px] text-slate-500 shrink-0"
            >${timeLabel(last.ts)}</span
          >`
        : ""}
      ${s.unread > 0
        ? html`<span
            class="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0"
            >${s.unread}</span
          >`
        : ""}
    </button>`;
  }

  private renderList(): TemplateResult {
    if (this.dms.length === 0 && this.clans.length === 0) {
      return html`${this.renderNotifyBar()}
        <div
          class="flex-1 min-h-0 overflow-y-auto p-4 text-slate-400 text-xs leading-relaxed"
        >
          ${L(
            "Личные сообщения доступны между друзьями, чат клана — участникам. Добавь друзей в досье или вступи в клан.",
            "Direct messages work between friends, clan chat — for members. Add friends from a dossier or join a clan.",
          )}
        </div>`;
    }
    return html`${this.renderNotifyBar()}
      <div class="flex-1 min-h-0 overflow-y-auto">
        ${this.clans.length > 0
          ? html`<div
                class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500"
              >
                ${L("Кланы", "Clans")}
              </div>
              ${this.clans.map((c) => this.renderListRow(c))}`
          : ""}
        ${this.dms.length > 0
          ? html`<div
                class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500"
              >
                ${L("Друзья", "Friends")}
              </div>
              ${this.dms.map((d) => this.renderListRow(d))}`
          : ""}
      </div>`;
  }

  private renderFeed(): TemplateResult {
    return html`<div
      id="site-chat-feed"
      class="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1"
    >
      ${this.hasMore
        ? html`<button
            class="text-xs text-slate-400 hover:text-white w-full py-1"
            ?disabled=${this.loadingMessages}
            @click=${() => this.loadMore()}
          >
            ${L("Показать раньше", "Show earlier")}
          </button>`
        : ""}
      ${this.messages.length === 0
        ? html`<div class="text-slate-500 text-xs">
            ${this.loadingMessages
              ? L("Загрузка…", "Loading…")
              : L("Сообщений пока нет…", "No messages yet…")}
          </div>`
        : this.messages.map((m) => {
            const mine = m.from.uid === this.myUid;
            // ⚠️ Текст — как есть, без linkify (решение владельца: ссылки не парсить).
            return html`<div class="leading-snug break-words">
              <span
                class="font-semibold ${mine
                  ? "text-amber-300"
                  : "text-sky-300"}"
                >${m.from.name}</span
              ><span class="text-[10px] text-slate-500 ml-1"
                >${timeLabel(m.ts)}</span
              >:
              <span class="text-white">${m.text}</span>
            </div>`;
          })}
    </div>`;
  }

  private renderComposer(): TemplateResult {
    const cur = this.current;
    if (cur?.kind === "dm" && cur.blocked) {
      return html`<div
        class="p-2 border-t border-slate-700 shrink-0 text-xs text-slate-400 text-center"
      >
        ${cur.blocked === "by_me"
          ? L("Ты заблокировал собеседника", "You blocked this user")
          : L("Переписка недоступна", "This chat is unavailable")}
      </div>`;
    }
    const status =
      cur?.kind === "dm"
        ? html`<div class="px-3 pt-1 text-[10px] ${this.onlineLabel(cur).cls}">
            ${this.onlineLabel(cur).text}
          </div>`
        : "";
    return html`${status}
      <div class="flex gap-2 p-2 border-t border-slate-700 shrink-0">
        <input
          id="site-chat-input"
          class="flex-1 bg-gray-800 text-white placeholder:text-slate-500 border border-slate-600 rounded px-2 py-1 outline-none focus:border-blue-400"
          style="font-size:16px"
          placeholder=${L("Сообщение…", "Message…")}
          maxlength=${CHAT_MAX_LEN}
          .value=${this.draft}
          @input=${(e: Event) =>
            (this.draft = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => this.onKey(e)}
        />
        <button
          class="px-3 rounded ${this.cooldownLeft > 0
            ? "bg-slate-700 text-slate-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-500 text-white"}"
          ?disabled=${this.cooldownLeft > 0}
          @click=${() => this.send()}
        >
          ${this.cooldownLeft > 0 ? html`${this.cooldownLeft}` : html`➤`}
        </button>
      </div>`;
  }

  render() {
    if (!this.ready || this.inGame || !siteChatAllowed()) return html``;
    const unread = this.unreadTotal();
    const cardCls =
      "site-chat-card flex flex-col bg-gray-900/95 backdrop-blur-sm border border-slate-600 rounded-xl shadow-2xl text-white text-sm overflow-hidden";
    const desktop = window.matchMedia(DESKTOP_MQ).matches;
    const cardStyle = desktop
      ? "position:fixed;right:12px;top:96px;bottom:96px;width:320px;z-index:100002"
      : "position:fixed;left:10px;right:10px;top:80px;bottom:80px;z-index:100002";
    return html`
      <button
        class="site-chat-fab fixed z-[100002] flex items-center justify-center"
        style="right:14px;bottom:84px;width:46px;height:46px;background:var(--t-sheet,#fdfcf7);color:var(--t-ink,#2b2a24);border:2px solid var(--t-ink,#2b2a24);box-shadow:3px 3px 0 var(--t-ink,#2b2a24)"
        title=${L("Сообщения", "Messages")}
        aria-label=${L("Сообщения", "Messages")}
        @click=${() => this.toggle()}
      >
        ${CHAT_ICON}${unread > 0
          ? html`<span
              class="absolute -top-2 -right-2 min-w-[20px] h-[20px] px-1 text-[11px] font-bold flex items-center justify-center"
              style="background:var(--t-red,#a8432b);color:#fff;border:2px solid var(--t-ink,#2b2a24)"
              >${unread}</span
            >`
          : ""}
      </button>
      ${this.open
        ? html`<div class=${cardCls} style=${cardStyle}>
            ${this.renderHeader()}
            ${this.view === "conv"
              ? html`${this.renderFeed()}${this.renderComposer()}`
              : this.renderList()}
          </div>`
        : ""}
    `;
  }
}

/** Единственный экземпляр панели (элемент лежит в index.html). */
export function siteChat(): SiteChatPanel | null {
  if (!siteChatAllowed()) return null;
  return document.querySelector("site-chat-panel") as SiteChatPanel | null;
}

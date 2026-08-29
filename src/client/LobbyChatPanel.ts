import { Centrifuge, type Subscription } from "centrifuge";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientInfo } from "../core/Schemas";
import { simpleHash } from "../core/Util";
import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";
import { humanColors } from "./theme/Colors";
import { L } from "./Utils";

interface LobbyChatMsg {
  text: string;
  from: { slug: string; name: string; cid?: string };
  ts: number;
}

// terron: цвет ника в лобби-чате. Берём из той же палитры, что и территории в
// игре (humanColors), детерминированно по игровому clientID — так ник в чате
// перекликается с цветом территории игрока. Хэш-выбор как в ColorAllocator
// (ветка random / >50 игроков).
function nickColor(cid: string | undefined): string {
  if (!cid) return "rgb(148,163,184)"; // slate-400 для анонимов без cid
  const c = humanColors[simpleHash(cid) % humanColors.length];
  return c.toRgbString();
}

// terron: чат ЛОББИ (до старта матча). ТОТ ЖЕ канал, что и внутриигровой чат —
// `game:<id>` (lobbyId === gameID), поэтому болтовня из лобби с историей
// перетекает в матч (EventsDisplay читает тот же канал). На десктопе — панель
// слева, на телефоне — плавающая кнопка + выезжающая шторка. Данные лобби
// (id/ростер/хост/мой clientID) пушат лобби-модалки через sync(); teardown — close().
@customElement("lobby-chat-panel")
export class LobbyChatPanel extends LitElement {
  @state() private active = false;
  @state() private mobileOpen = false;
  @state() private connected = false;
  @state() private messages: LobbyChatMsg[] = [];
  @state() private draft = "";
  @state() private cooldownLeft = 0;
  @state() private unread = 0;
  /**
   * terron 25.08: СВЁРНУТ ЛИ ЧАТ НА ДЕСКТОПЕ.
   *
   * Раньше десктоп-панель была «всегда развёрнута», свернуть её было нечем:
   * крестик в шапке помечен `lg:hidden`, то есть жил только в телефонной
   * шторке (репорт владельца «где скрытие чата, был же крестик»). Плюс с
   * липким лобби панель оставалась висеть поверх сайта, когда игрок уходил
   * читать вики.
   */
  @state() private deskOpen = true;
  /** Каким был десктоп-чат до ухода на другую страницу (см. collapseForNav). */
  private deskWasOpen = true;

  private lobbyId = "";
  // terron: канал чата (`game:<lobbyId>`). Отдельное поле, а не lobbyId: по нему
  // ловим смену канала и чистим ленту/счётчик непрочитанных.
  private channel = "";
  private clients: ClientInfo[] = [];
  private hostClientID = "";
  private myClientID = "";

  private centrifuge: Centrifuge | null = null;
  private sub: Subscription | null = null;
  private mySlug = "";
  private myName = "?";
  private pendingEchoes: { text: string; at: number }[] = [];
  private cooldownTimer: number | null = null;
  private static readonly COOLDOWN_MS = 5000;

  createRenderRoot() {
    return this; // light DOM для Tailwind
  }

  // Единая точка входа из лобби-модалок: id/ростер/хост/мой clientID.
  // terron 29.07: у КАЖДОГО лобби (в т.ч. золотого) свой чат — канал `game:<id>`,
  // сквозной «лобби → матч» и умирающий вместе с матчем. Проба «вечного канала
  // золотых» откачена по решению владельца: в новое золотое лобби нельзя писать
  // сообщения прошлой игры, а разделять «что переносить» — лишняя сложность.
  public sync(
    lobbyId: string,
    clients: ClientInfo[],
    hostClientID: string,
    myClientID: string,
  ): void {
    this.clients = clients;
    this.hostClientID = hostClientID || "";
    this.myClientID = myClientID || "";
    const channel = lobbyId ? `game:${lobbyId}` : "";
    if (channel && channel !== this.channel) {
      this.teardown();
      // terron: другое лобби — чужая переписка: ленту и счётчик непрочитанных
      // за собой не тащим.
      this.messages = [];
      this.unread = 0;
      this.channel = channel;
      this.lobbyId = lobbyId;
      this.active = true;
      void this.connect();
    }
    this.requestUpdate();
  }

  // Покинули лобби / матч стартовал → закрываем чат.
  public close(): void {
    this.teardown();
    this.active = false;
    this.mobileOpen = false;
    this.lobbyId = "";
    this.channel = "";
    this.messages = [];
    this.unread = 0;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.teardown();
  }

  private teardown() {
    this.sub?.unsubscribe();
    this.sub = null;
    this.centrifuge?.disconnect();
    this.centrifuge = null;
    this.connected = false;
    this.pendingEchoes = [];
    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.cooldownLeft = 0;
  }

  private async fetchToken(): Promise<string> {
    const res = await fetch(`${getApiBase()}/realtime/token`, {
      headers: { authorization: await getAuthHeader() },
    });
    if (!res.ok) throw new Error("realtime token failed");
    const j = (await res.json()) as {
      token: string;
      identity?: { slug: string; name: string };
    };
    if (j.identity) {
      this.mySlug = j.identity.slug;
      this.myName = j.identity.name;
    }
    return j.token;
  }

  private async connect() {
    if (this.centrifuge || !this.channel) return;
    const wsUrl = getApiBase().replace(/^http/, "ws") + "/connection/websocket";
    const centrifuge = new Centrifuge(wsUrl, {
      getToken: () => this.fetchToken(),
    });
    this.centrifuge = centrifuge;
    centrifuge.on("connected", () => (this.connected = true));
    centrifuge.on("disconnected", () => (this.connected = false));

    // Тот же канал, что и внутриигровой чат (lobbyId === gameID) → болтовня из
    // лобби с историей перетекает в матч (EventsDisplay читает `game:<id>`).
    const sub = centrifuge.newSubscription(this.channel, { recoverable: true });
    this.sub = sub;
    sub.on("publication", (ctx) => this.push(ctx.data as LobbyChatMsg));
    sub.on("subscribed", async () => {
      try {
        const h = await sub.history({ limit: 30 });
        // terron: история — НЕ «новые сообщения». Раньше она шла общим путём и
        // накручивала счётчик непрочитанных: заходишь в золотое лобби (оно
        // живёт до часа, канал с историей 24ч) — и на кнопке чата висит «1»,
        // хотя ничего при тебе не писали (репорт игрока 29.07).
        // Одной пачкой: 30 сообщений по одному = 30 копий массива и 30
        // прокруток ленты после рендера — вместо одной.
        this.pushBatch(
          h.publications.map((p) => p.data as LobbyChatMsg),
          true,
        );
      } catch {
        /* история может быть пуста */
      }
    });
    sub.subscribe();
    centrifuge.connect();
  }

  // Игровой ник (позывной) — из поля ввода на главной, фолбэк на identity.
  private currentNick(): string {
    const input = document.querySelector("username-input") as
      | (HTMLElement & { getUsername?: () => string })
      | null;
    const n = input?.getUsername?.()?.trim();
    return n && n.length > 0 ? n : this.myName;
  }

  // terron: пачка сообщений (история канала) — один рендер, одна прокрутка.
  private pushBatch(list: LobbyChatMsg[], fromHistory: boolean) {
    const batch: LobbyChatMsg[] = [];
    for (const m of list) {
      const silent = this.acceptIncoming(m, fromHistory);
      if (silent === null) continue;
      batch.push(m);
    }
    if (batch.length === 0) return;
    this.appendMessages(batch, true);
  }

  /**
   * Фильтр входящего: null = не показывать (дубль своего эха), иначе — флаг
   * silent для счётчика непрочитанных (история и своё — не «новые»).
   */
  private acceptIncoming(
    m: LobbyChatMsg,
    fromHistory: boolean,
  ): boolean | null {
    if (!m?.text) return null;
    // Своё сообщение уже показали оптимистично — не рисуем дважды.
    if (this.mySlug && m.from?.slug === this.mySlug) {
      const now = Date.now();
      this.pendingEchoes = this.pendingEchoes.filter((p) => now - p.at < 10000);
      const i = this.pendingEchoes.findIndex((p) => p.text === m.text);
      if (i !== -1) {
        this.pendingEchoes.splice(i, 1);
        return null;
      }
    }
    // Своё сообщение (эхо после реконнекта, когда pendingEchoes уже пуст) тоже
    // не должно светиться «непрочитанным».
    const mine = Boolean(this.mySlug) && m.from?.slug === this.mySlug;
    return fromHistory || mine;
  }

  private push(m: LobbyChatMsg, fromHistory = false) {
    const silent = this.acceptIncoming(m, fromHistory);
    if (silent === null) return;
    this.appendMessage(m, silent);
  }

  private appendMessage(m: LobbyChatMsg, silent = false) {
    this.appendMessages([m], silent);
  }

  private appendMessages(list: LobbyChatMsg[], silent: boolean) {
    this.messages = [...this.messages, ...list].slice(-100);
    // Непрочитанные — пока чат НЕ ВИДЕН (свёрнут на десктопе ИЛИ закрыта
    // шторка на телефоне), и только для ЖИВЫХ чужих сообщений (не история,
    // не своё эхо). ⚠️ Раньше условием было «шторка закрыта» — на десктопе
    // она закрыта всегда, так что счётчик тикал при открытой панели; видно
    // это не было только потому, что кнопку со счётчиком десктоп не показывал.
    if (!silent && !this.chatVisible()) {
      this.unread = Math.min(99, this.unread + list.length);
    }
    this.updateComplete.then(() => {
      const box = this.querySelector("#lobby-chat-feed");
      if (box) box.scrollTop = box.scrollHeight;
    });
  }

  private send() {
    if (this.cooldownLeft > 0) return;
    const text = this.draft.trim();
    if (!text || !this.sub) return;
    this.draft = "";
    const name = this.currentNick();
    this.pendingEchoes.push({ text, at: Date.now() });
    // silent: СВОЁ сообщение (оптимистичный эхо) не «непрочитанное» — иначе
    // написал сам, свернул шторку и видишь красный бейдж «1» без новых
    // сообщений (главная причина репорта игрока 29.07).
    this.appendMessage(
      {
        text,
        from: { slug: this.mySlug, name, cid: this.myClientID },
        ts: Date.now(),
      },
      true,
    );
    this.startCooldown();
    // cid = игровой clientID → приёмники красят ник в «цвет территории».
    this.sub.publish({ text, name, cid: this.myClientID }).catch(() => {
      /* 429/409/413 — у отправителя сообщение уже есть, глотаем */
    });
  }

  private startCooldown() {
    const until = Date.now() + LobbyChatPanel.COOLDOWN_MS;
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

  private onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  private toggleChat() {
    if (this.chatVisible()) this.collapse();
    else this.expand();
  }

  private openMobile() {
    if (this.mobileOpen) return;
    this.mobileOpen = true;
    this.unread = 0;
    this.updateComplete.then(() =>
      (this.querySelector("#lobby-chat-input") as HTMLInputElement)?.focus(),
    );
  }

  /**
   * Виден ли чат ПРЯМО СЕЙЧАС. Считаем по факту вёрстки, а не по брейкпоинту:
   * какая из двух презентаций показана (панель слева или шторка), решает CSS
   * — там и `lg:`-классы, и правила для низкого вьюпорта, и `!important` для
   * площадки. Держать копию этих условий в JS = гарантированный разъезд.
   * ⚠️ `offsetParent` тут не годится: обе презентации `position: fixed`, у них
   * он всегда null.
   */
  private isVisible(el: Element | null): boolean {
    return !!el && el.getBoundingClientRect().width > 0;
  }
  private chatVisible(): boolean {
    return (
      this.isVisible(this.querySelector(".lobby-chat-desktop")) ||
      this.isVisible(this.querySelector(".lobby-chat-drawer"))
    );
  }
  private drawerVisible(): boolean {
    return this.isVisible(this.querySelector(".lobby-chat-drawer"));
  }

  /** Свернуть чат целиком (крестик в шапке, уход со страницы). */
  public collapse(): void {
    this.mobileOpen = false;
    this.deskOpen = false;
  }

  /** Развернуть. Ставим ОБЕ презентации — какую показать, решает CSS. */
  private expand(): void {
    this.deskOpen = true;
    this.mobileOpen = true;
    this.unread = 0;
    this.updateComplete.then(() =>
      (this.querySelector("#lobby-chat-input") as HTMLInputElement)?.focus(),
    );
  }

  /**
   * terron 25.08: ушли бродить по сайту (лобби свернулось в плашку) — чат
   * сворачиваем сразу, иначе панель висит поверх вики и топов. Возврат в лобби
   * возвращает чат в то состояние, в каком игрок его оставил.
   */
  public collapseForNav(): void {
    this.deskWasOpen = this.deskOpen;
    this.collapse();
  }
  public restoreAfterNav(): void {
    this.deskOpen = this.deskWasOpen;
  }

  private closeMobile(): void {
    if (!this.mobileOpen) return;
    this.mobileOpen = false;
  }

  // Перехват «назад» из лобби-модалки (стрелка/жест-хук модалки). true = чат был
  // открыт и закрыт → действие «назад» съедено, из лобби НЕ выходим.
  public closeMobileIfOpen(): boolean {
    // Именно ШТОРКА: на десктопе «назад» обязано выводить из лобби, а не
    // закрывать панель (иначе стрелка перестаёт работать как выход).
    if (!this.drawerVisible()) return false;
    this.closeMobile();
    return true;
  }

  private renderHeader() {
    return html`<div
      class="flex items-center gap-2 px-3 py-2 border-b border-slate-700 shrink-0"
    >
      <span class="font-bold">${L("Чат лобби", "Lobby chat")}</span>
      <span
        class="w-2 h-2 rounded-full ${this.connected
          ? "bg-emerald-400"
          : "bg-slate-500"}"
      ></span>
      <button
        class="lobby-chat-close ml-auto text-slate-400 hover:text-white"
        title=${L("Свернуть чат", "Collapse chat")}
        aria-label=${L("Свернуть чат", "Collapse chat")}
        @click=${() => this.collapse()}
      >
        ✕
      </button>
    </div>`;
  }

  private renderFeed() {
    return html`<div
      id="lobby-chat-feed"
      class="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1"
    >
      ${this.messages.length === 0
        ? html`<div class="text-slate-500 text-xs">
            ${L("Сообщений пока нет…", "No messages yet…")}
          </div>`
        : this.messages.map((m) => {
            const cid = m.from?.cid;
            const isHost = !!cid && cid === this.hostClientID;
            return html`<div class="leading-snug break-words">
              <span class="font-semibold" style="color:${nickColor(cid)}"
                >${m.from?.name ?? "?"}</span
              >${isHost
                ? html`<span class="text-amber-600 text-xs font-semibold">
                    (${L("хост", "host")})</span
                  >`
                : ""}:
              <!-- terron: text-white (не slate-100) — тема :not(.in-game)
                   флипает его в чернила на белом «листе» лобби; slate-100
                   не ловился правилом → было бело-на-белом. -->
              <span class="text-white">${m.text}</span>
            </div>`;
          })}
    </div>`;
  }

  private renderComposer() {
    return html`<div class="flex gap-2 p-2 border-t border-slate-700 shrink-0">
      <input
        id="lobby-chat-input"
        class="flex-1 bg-gray-800 text-white placeholder:text-slate-500 border border-slate-600 rounded px-2 py-1 outline-none focus:border-blue-400"
        style="font-size:16px"
        placeholder=${L("Сообщение…", "Message…")}
        maxlength="500"
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

  private panelInner() {
    return html`${this.renderHeader()}${this.renderFeed()}${this.renderComposer()}`;
  }

  render() {
    if (!this.active) return html``;
    const cardCls =
      "flex flex-col bg-gray-900/95 backdrop-blur-sm border border-slate-600 rounded-xl shadow-2xl text-white text-sm overflow-hidden";
    return html`
      <!-- Десктоп: панель слева, всегда развёрнута. terron: на НИЗКОМ вьюпорте
           (iframe стора 16:9, короткие окна) прячется — там панель перекрывает
           модалку лобби; вместо неё показываем кнопку+шторку как на телефоне.
           Свап — CSS по max-height (terron-theme.css, класс lobby-chat-desktop). -->
      <div
        class="lobby-chat-desktop hidden ${this.deskOpen
          ? "lg:flex"
          : ""} ${cardCls}"
        style="position:fixed;left:12px;top:96px;bottom:96px;width:288px;z-index:100002"
      >
        ${this.panelInner()}
      </div>

      <!-- Плавающая кнопка: на телефоне всегда, на десктопе — когда панель
           свёрнута крестиком или уходом на другую страницу. Счётчик рядом —
           сколько сообщений пришло, пока чат не видно. -->
      <button
        class="lobby-chat-fab ${this.deskOpen
          ? "lg:hidden"
          : ""} fixed z-[100002] rounded-full bg-gray-800/95 hover:bg-gray-700 text-white border border-slate-600 w-12 h-12 shadow-lg flex items-center justify-center"
        style="left:12px;bottom:84px"
        title=${L("Чат лобби", "Lobby chat")}
        @click=${() => this.toggleChat()}
      >
        💬${this.unread > 0
          ? html`<span
              class="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
              >${this.unread}</span
            >`
          : ""}
      </button>

      <!-- Телефон (и низкий десктоп-вьюпорт): шторка -->
      ${this.mobileOpen
        ? html`<div
            class="lobby-chat-drawer lg:hidden ${cardCls}"
            style="position:fixed;left:10px;right:10px;top:80px;bottom:80px;z-index:100002"
          >
            ${this.panelInner()}
          </div>`
        : ""}
    `;
  }
}

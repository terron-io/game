import { Centrifuge, type Subscription } from "centrifuge";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";
import { L } from "./Utils";

interface ChatMsg {
  text: string;
  from: { slug: string; name: string };
  ts: number;
}

// terron: global realtime chat (Centrifugo). Phase 2a — text chat on the
// `global` channel. Game-event integration (alliances/quick-chat) comes next.
@customElement("chat-panel")
export class ChatPanel extends LitElement {
  @state() private messages: ChatMsg[] = [];
  @state() private collapsed = true;
  @state() private connected = false;
  @state() private draft = "";
  // Секунд до следующей отправки (0 = можно отправлять). Писать можно всегда.
  @state() private cooldownLeft = 0;

  private centrifuge: Centrifuge | null = null;
  private sub: Subscription | null = null;
  private bodyObserver: MutationObserver | null = null;

  // Своя личность в чате — чтобы отсеивать собственные broadcast-копии.
  private mySlug = "";
  private myName = "?";
  // Оптимистичные echo: тексты, которые мы уже показали у себя и которые не
  // нужно рисовать второй раз, когда придёт их broadcast-копия.
  private pendingEchoes: { text: string; at: number }[] = [];
  private cooldownTimer: number | null = null;
  private static readonly COOLDOWN_MS = 5000;

  createRenderRoot() {
    return this; // light DOM for Tailwind
  }

  // terron: чат строго привязан к сессии — существует только внутри матча
  // (body.in-game). На главной/в лобби чата нет.
  private static inGame(): boolean {
    return document.body.classList.contains("in-game");
  }

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onGlobalKey);
    // следим за входом/выходом из матча
    this.bodyObserver = new MutationObserver(() => void this.syncSession());
    this.bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    void this.syncSession();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onGlobalKey);
    this.bodyObserver?.disconnect();
    this.bodyObserver = null;
    this.teardown();
  }

  // Подключаемся при старте матча, рвём соединение при выходе. Чат доступен
  // всем, включая анонимов (токен-эндпоинт выдаёт гостевой id).
  private async syncSession() {
    if (ChatPanel.inGame()) {
      if (this.centrifuge) return;
      void this.connect();
    } else {
      this.teardown();
    }
  }

  private teardown() {
    this.sub?.unsubscribe();
    this.sub = null;
    this.centrifuge?.disconnect();
    this.centrifuge = null;
    this.connected = false;
    this.collapsed = true;
    this.messages = [];
    this.pendingEchoes = [];
    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.cooldownLeft = 0;
  }

  // Enter opens + focuses the chat (when not already typing somewhere).
  private onGlobalKey = (e: KeyboardEvent) => {
    if (!ChatPanel.inGame()) return; // на главной чата нет
    if (e.key !== "Enter" || !this.collapsed) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
    this.collapsed = false;
    this.updateComplete.then(() =>
      (this.querySelector("input") as HTMLInputElement | null)?.focus(),
    );
  };

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
    if (this.centrifuge) return;
    const wsUrl =
      getApiBase().replace(/^http/, "ws") + "/connection/websocket";
    const centrifuge = new Centrifuge(wsUrl, {
      getToken: () => this.fetchToken(),
    });
    this.centrifuge = centrifuge;
    centrifuge.on("connected", () => (this.connected = true));
    centrifuge.on("disconnected", () => (this.connected = false));

    // Chat is session-bound: inside a match → per-game channel; else global lobby.
    const m = window.location.pathname.match(/\/game\/([A-Za-z0-9_-]+)/);
    const channel = m ? `game:${m[1]}` : "global:main";
    const sub = centrifuge.newSubscription(channel, { recoverable: true });
    this.sub = sub;
    sub.on("publication", (ctx) => this.push(ctx.data as ChatMsg));
    sub.on("subscribed", async () => {
      try {
        const h = await sub.history({ limit: 30 });
        for (const p of h.publications) this.push(p.data as ChatMsg);
      } catch {
        /* history may be empty */
      }
    });
    sub.subscribe();
    centrifuge.connect();
  }

  // Входящее сообщение из сети (broadcast/history).
  private push(m: ChatMsg) {
    if (!m?.text) return;
    // Своё сообщение мы уже показали оптимистично — не рисуем второй раз.
    // (Если сервер скрытно отбросил дубль, broadcast-копии не будет вовсе —
    //  у отправителя оно остаётся, другие его не видят.)
    if (this.mySlug && m.from?.slug === this.mySlug) {
      const now = Date.now();
      this.pendingEchoes = this.pendingEchoes.filter((p) => now - p.at < 10000);
      const i = this.pendingEchoes.findIndex((p) => p.text === m.text);
      if (i !== -1) {
        this.pendingEchoes.splice(i, 1);
        return;
      }
    }
    this.appendMessage(m);
  }

  private appendMessage(m: ChatMsg) {
    this.messages = [...this.messages, m].slice(-100);
    this.updateComplete.then(() => {
      const box = this.querySelector("#chat-feed");
      if (box) box.scrollTop = box.scrollHeight;
    });
  }

  private send() {
    if (this.cooldownLeft > 0) return; // ещё не прошло 5 секунд
    const text = this.draft.trim();
    if (!text || !this.sub) return;
    this.draft = "";
    // Оптимистичный echo: отправитель всегда видит своё сообщение у себя —
    // даже если сервер его скрытно не разошлёт (дубль).
    this.pendingEchoes.push({ text, at: Date.now() });
    this.appendMessage({
      text,
      from: { slug: this.mySlug, name: this.myName },
      ts: Date.now(),
    });
    this.startCooldown();
    this.sub.publish({ text }).catch(() => {
      // 429/409/413 — отправитель уже видит сообщение локально, молча глотаем.
    });
  }

  // Таймер до следующей отправки. Печатать разрешено всегда, отправлять — нет.
  private startCooldown() {
    const until = Date.now() + ChatPanel.COOLDOWN_MS;
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

  render() {
    if (this.collapsed) {
      return html`<button
        class="fixed bottom-3 right-3 z-[1000] rounded-full bg-gray-800/90 hover:bg-gray-700 text-white border border-slate-600 w-12 h-12 shadow-lg"
        title=${L("Чат", "Chat")}
        @click=${() => (this.collapsed = false)}
      >
        💬
      </button>`;
    }
    return html`
      <div
        class="fixed bottom-3 right-3 z-[1000] w-80 max-w-[92vw] h-96 max-h-[70vh] flex flex-col bg-gray-900/95 backdrop-blur-sm border border-slate-600 rounded-xl shadow-2xl text-white text-sm"
      >
        <div
          class="flex items-center gap-2 px-3 py-2 border-b border-slate-700"
        >
          <span class="font-bold">${L("Чат", "Chat")}</span>
          <span
            class="w-2 h-2 rounded-full ${this.connected
              ? "bg-emerald-400"
              : "bg-slate-500"}"
          ></span>
          <button
            class="ml-auto text-slate-400 hover:text-white"
            @click=${() => (this.collapsed = true)}
          >
            ✕
          </button>
        </div>
        <div id="chat-feed" class="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          ${this.messages.length === 0
            ? html`<div class="text-slate-500 text-xs">${L("Сообщений пока нет…", "No messages yet…")}</div>`
            : this.messages.map(
                (m) => html`<div>
                  <span class="text-blue-300 font-semibold"
                    >${m.from?.name ?? "?"}</span
                  ><span class="text-slate-400 text-xs">@${m.from?.slug ??
                  ""}</span>: <span>${m.text}</span>
                </div>`,
              )}
        </div>
        <div class="flex gap-2 p-2 border-t border-slate-700">
          <input
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
              : "bg-blue-600 hover:bg-blue-500"}"
            ?disabled=${this.cooldownLeft > 0}
            title=${this.cooldownLeft > 0
              ? L(`Подождите ${this.cooldownLeft} с`, `Wait ${this.cooldownLeft}s`)
              : L("Отправить", "Send")}
            @click=${() => this.send()}
          >
            ${this.cooldownLeft > 0 ? html`${this.cooldownLeft}` : html`➤`}
          </button>
        </div>
      </div>
    `;
  }
}

import { Centrifuge, type Subscription } from "centrifuge";
import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";
import {
  acceptFriendRequest,
  claimFriendRequests,
  declineFriendRequest,
} from "./FriendsApi";
import { myCurrentGameID } from "./FriendsPresence";
import { L } from "./Utils";

// Сайт-уведомления о друзьях (вне игры). См. friends.md (Этап 4). Держит одно
// Centrifugo-подключение (когда залогинен), слушает `friends:feed#<uid>` и рисует
// поп-апы снизу справа: «друг зашёл в лобби/играет» + входящие заявки. В ИГРЕ
// (body.in-game) поп-апы НЕ рисуем — там их показывает EventsDisplay в чат-ленте.
// На страницах кланов/скинов/магазина — тоже не рисуем (просил владелец).

interface LobbyItem {
  gameID: string;
  name: string;
  slugOrName: string; // для снуза
  map: string | null;
  state: "lobby" | "in_game";
}
interface RequestItem {
  requestId: string;
  by: string;
}

const DENY_PREFIXES = ["/clan", "/skins", "/shop"];

class FriendsNotifierImpl {
  private started = false;
  private centrifuge: Centrifuge | null = null;
  private sub: Subscription | null = null;
  private myUid = "";
  private lobbies = new Map<string, LobbyItem>();
  private requests: RequestItem[] = [];
  private container: HTMLElement | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener("popstate", () => this.render());
    // оживить заявки, присланные пока был анонимом (по прежнему анон-pid из localStorage)
    void claimFriendRequests();
    void this.connect();
  }

  private async fetchToken(): Promise<string> {
    const res = await fetch(`${getApiBase()}/realtime/token`, {
      headers: { authorization: await getAuthHeader() },
    });
    if (!res.ok) throw new Error("token failed");
    const j = (await res.json()) as {
      token: string;
      identity?: { id?: string };
    };
    if (j.identity?.id) this.myUid = j.identity.id;
    return j.token;
  }

  private async connect(): Promise<void> {
    if (this.centrifuge) return;
    // Нужен uid → тянем токен заранее (getToken тоже его обновит).
    try {
      await this.fetchToken();
    } catch {
      this.started = false; // не залогинен / нет сети — попробуем позже
      return;
    }
    if (!this.myUid) {
      this.started = false;
      return;
    }
    const wsUrl = getApiBase().replace(/^http/, "ws") + "/connection/websocket";
    const cf = new Centrifuge(wsUrl, { getToken: () => this.fetchToken() });
    this.centrifuge = cf;
    const sub = cf.newSubscription(`friends:feed#${this.myUid}`, {
      recoverable: true,
    });
    this.sub = sub;
    sub.on("publication", (ctx) => this.onEvent(ctx.data));
    sub.on("subscribed", () => void this.reconcile());
    sub.subscribe();
    cf.connect();
  }

  // Сверка при подписке/реконнекте: какие друзья сейчас в живом лобби/игре.
  private async reconcile(): Promise<void> {
    try {
      const res = await fetch(`${getApiBase()}/me/friends/lobbies`, {
        headers: { authorization: await getAuthHeader() },
      });
      if (!res.ok) return;
      const j = (await res.json()) as {
        lobbies?: {
          id: string;
          name: string;
          slug: string | null;
          gameID: string;
          map: string | null;
          state: "lobby" | "in_game";
        }[];
      };
      this.lobbies.clear();
      for (const l of j.lobbies ?? []) {
        this.lobbies.set(l.gameID, {
          gameID: l.gameID,
          name: l.name,
          slugOrName: l.slug || l.name,
          map: l.map,
          state: l.state,
        });
      }
      this.render();
    } catch {
      /* сверка best-effort */
    }
  }

  private onEvent(data: unknown): void {
    const d = data as {
      kind?: string;
      friend?: { name?: string; slug?: string | null };
      gameID?: string;
      map?: string | null;
      state?: "lobby" | "in_game";
      requestId?: string;
      by?: string;
    };
    if (d?.kind === "friend_lobby" && d.gameID) {
      const name = d.friend?.name || L("Друг", "Friend");
      this.lobbies.set(d.gameID, {
        gameID: d.gameID,
        name,
        slugOrName: d.friend?.slug || name,
        map: d.map ?? null,
        state: d.state === "in_game" ? "in_game" : "lobby",
      });
      this.render();
    } else if (d?.kind === "friend_lobby_end" && d.gameID) {
      this.lobbies.delete(d.gameID);
      this.render();
    } else if (d?.kind === "friend_request" && d.requestId) {
      if (this.requests.some((r) => r.requestId === d.requestId)) return;
      this.requests.push({
        requestId: d.requestId,
        by: d.by || L("игрок", "player"),
      });
      this.render();
    }
  }

  // ── снуз «не показывать 2ч» (общий ключ с EventsDisplay) ──
  private snoozeKey(id: string): string {
    return `terron_friend_snooze_${id}`;
  }
  private snoozed(id: string): boolean {
    const raw = localStorage.getItem(this.snoozeKey(id));
    return !!raw && Number(raw) > Date.now();
  }
  private snooze(id: string): void {
    localStorage.setItem(
      this.snoozeKey(id),
      String(Date.now() + 2 * 60 * 60 * 1000),
    );
    this.render();
  }

  private hidden(): boolean {
    if (document.body.classList.contains("in-game")) return true;
    const path = window.location.pathname;
    return DENY_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
  }

  private ensureContainer(): HTMLElement {
    if (this.container && document.body.contains(this.container)) {
      return this.container;
    }
    // terron: гарантируем скрытие в игре через CSS, а не только через render().
    // hidden() уже отсекает in-game, но попап мог отрисоваться на меню и повиснуть
    // при входе в матч (render не перевызывается) — на мобиле он перекрывал баннеры
    // обучения. CSS-правило от тайминга не зависит.
    if (!document.getElementById("friend-notif-style")) {
      const st = document.createElement("style");
      st.id = "friend-notif-style";
      st.textContent =
        "body.in-game .friend-notif-wrap{display:none !important;}";
      document.head.appendChild(st);
    }
    const el = document.createElement("div");
    el.className = "friend-notif-wrap";
    el.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:99998;display:flex;" +
      "flex-direction:column;gap:10px;max-width:340px;font-family:" +
      "'Golos Text',system-ui,sans-serif;pointer-events:none";
    document.body.appendChild(el);
    this.container = el;
    return el;
  }

  private render(): void {
    const el = this.ensureContainer();
    if (this.hidden()) {
      el.innerHTML = "";
      return;
    }
    // не показываем лобби/матч, в котором я сам сейчас (зашёл спектатить/играю) —
    // «зайти в себя» не предлагаем. myGame берём из FriendsPresence (localStorage,
    // работает и когда игра в другой вкладке). См. friends.md.
    const myGame = myCurrentGameID();
    const lobbyCards = [...this.lobbies.values()]
      .filter((l) => !this.snoozed(l.slugOrName) && l.gameID !== myGame)
      .map((l) => this.lobbyCardHtml(l))
      .join("");
    const reqCards = this.requests.map((r) => this.reqCardHtml(r)).join("");
    el.innerHTML = reqCards + lobbyCards;
    // навесить обработчики
    el.querySelectorAll<HTMLElement>("[data-act]").forEach((btn) => {
      btn.onclick = () => this.onClick(btn.dataset.act!, btn.dataset.id!);
    });
  }

  private cardWrap(inner: string): string {
    return (
      `<div style="pointer-events:auto;background:#1f2937;color:#fff;` +
      `border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px 16px;` +
      `box-shadow:0 12px 40px rgba(0,0,0,.5)">${inner}</div>`
    );
  }
  private btn(act: string, id: string, label: string, bg: string): string {
    return (
      `<button data-act="${act}" data-id="${FriendsNotifierImpl.esc(id)}" ` +
      `style="flex:1;padding:9px;border:none;border-radius:9px;color:#fff;` +
      `font-weight:700;cursor:pointer;font-size:13px;background:${bg}">${label}</button>`
    );
  }

  private lobbyCardHtml(l: LobbyItem): string {
    const ru = L("ru", "en") === "ru";
    const name = FriendsNotifierImpl.esc(l.name);
    const where = l.map ? ` · ${FriendsNotifierImpl.esc(l.map)}` : "";
    const line =
      l.state === "in_game"
        ? ru
          ? `${name} играет${where}`
          : `${name} is playing${where}`
        : ru
          ? `${name} в лобби${where}`
          : `${name} is in a lobby${where}`;
    const joinLabel =
      l.state === "in_game"
        ? ru
          ? "Смотреть"
          : "Watch"
        : ru
          ? "Войти"
          : "Join";
    return this.cardWrap(
      `<div style="font-weight:700;font-size:14px;margin-bottom:10px">${line}</div>
      <div style="display:flex;gap:8px">
        ${this.btn("join", l.gameID, joinLabel, "#16a34a")}
        ${this.btn("snooze", l.slugOrName, ru ? "Не показывать 2 ч" : "Snooze 2h", "#ca8a04")}
        ${this.btn("dismiss-lobby", l.gameID, "✕", "rgba(255,255,255,.12)")}
      </div>`,
    );
  }

  private reqCardHtml(r: RequestItem): string {
    const ru = L("ru", "en") === "ru";
    const by = FriendsNotifierImpl.esc(r.by);
    const line = ru
      ? `${by} добавляет тебя в друзья`
      : `${by} wants to be your friend`;
    return this.cardWrap(
      `<div style="font-weight:700;font-size:14px;margin-bottom:10px">${line}</div>
      <div style="display:flex;gap:8px">
        ${this.btn("accept", r.requestId, ru ? "Принять" : "Accept", "#16a34a")}
        ${this.btn("decline", r.requestId, ru ? "Отклонить" : "Decline", "#b91c1c")}
      </div>`,
    );
  }

  private async onClick(act: string, id: string): Promise<void> {
    if (act === "join") {
      // Внутри площадки — мягко: Main перечитает адрес и войдёт в лобби сам.
      void import("./SoftNavigate").then(({ softGo }) => softGo(`/game/${id}`));
    } else if (act === "snooze") {
      this.snooze(id);
    } else if (act === "dismiss-lobby") {
      this.lobbies.delete(id);
      this.render();
    } else if (act === "accept") {
      await acceptFriendRequest(id);
      this.requests = this.requests.filter((r) => r.requestId !== id);
      this.render();
    } else if (act === "decline") {
      void declineFriendRequest(id);
      this.requests = this.requests.filter((r) => r.requestId !== id);
      this.render();
    }
  }

  private static esc(s: string): string {
    return s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  }
}

export const friendsNotifier = new FriendsNotifierImpl();

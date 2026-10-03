// terron 22.09: клиент ЛС (друзья) и чата клана. Спека — chats.md.
// Все вызовы — с Bearer аккаунта; аноним чатов не имеет.
import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";
import { socialHostAllowed } from "./SocialLinks";

export interface ChatFrom {
  uid: string;
  handle: string;
  name: string;
  slug: string | null;
}
export interface ChatMessage {
  id: number;
  text: string;
  from: ChatFrom;
  ts: number;
}
export interface DmSummary {
  kind: "dm";
  conv: string;
  channel: string;
  peer: {
    uid: string;
    handle: string;
    name: string;
    slug: string | null;
    hasAvatar: boolean;
    muted: boolean;
  };
  last: { text: string; ts: number; fromUid: string } | null;
  unread: number;
  /** Онлайн собеседника на момент запроса: сайт / лобби / матч / нет. */
  online: OnlineState;
  /** Получит ли пуш, если не в сети (подписан на тему dm). */
  pushDm: boolean;
  blocked: "by_me" | "by_peer" | null;
}
export type OnlineState = "in_game" | "lobby" | "online" | "offline";
export interface ClanSummary {
  kind: "clan";
  conv: string;
  channel: string;
  clan: {
    id: string;
    tag: string;
    name: string;
    nameRu: string | null;
    slug: string;
  };
  last: { text: string; ts: number; fromUid: string; fromName: string } | null;
  unread: number;
}
export type ChatSummary = DmSummary | ClanSummary;
export type ChatKind = "dm" | "clan";

export const CHAT_MAX_LEN = 500;

async function chatFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
      Authorization: await getAuthHeader(),
    },
  });
}

export interface ChatsResponse {
  me: string;
  dms: DmSummary[];
  clans: ClanSummary[];
  notify: { pushDm: boolean };
}

export async function fetchChats(): Promise<ChatsResponse | null> {
  try {
    const res = await chatFetch("/me/chats");
    if (!res.ok) return null;
    return (await res.json()) as ChatsResponse;
  } catch {
    return null;
  }
}

/** Блок / разблок собеседника в ЛС (дружба остаётся, писать нельзя обоим). */
export async function setDmBlocked(
  conv: string,
  on: boolean,
): Promise<boolean> {
  try {
    const res = await chatFetch(
      `/me/chats/dm/${encodeURIComponent(conv)}/block`,
      {
        method: "POST",
        body: JSON.stringify({ on }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Уровень уведомлений о ЛС (решение владельца: «никаких / уведы в игре / +пуши»).
 * Живёт в localStorage браузера: «в игре» и «пуши» — свойство устройства, а не
 * аккаунта (пуш привязан к браузеру). Пуш-подписка — на сервере, тема `dm`.
 */
export type ChatNotifyLevel = "none" | "ingame" | "push";
// ⚠️ Без точки: строку вида «chat.notify» сторож переводов (TranslationSystem)
// принимает за ключ словаря и требует её в en.json.
const NOTIFY_KEY = "terron_chat_notify";
export function chatNotifyLevel(): ChatNotifyLevel {
  try {
    const v = localStorage.getItem(NOTIFY_KEY);
    return v === "none" || v === "push" ? v : "ingame";
  } catch {
    return "ingame";
  }
}
export function setChatNotifyLevel(level: ChatNotifyLevel): void {
  try {
    localStorage.setItem(NOTIFY_KEY, level);
  } catch {
    /* хранилище может быть запрещено */
  }
}

export type OpenError =
  | "not_found"
  | "self"
  | "not_friends"
  | "not_member"
  | "unauthorized"
  | "network";

export async function openDm(
  handle: string,
): Promise<DmSummary | { error: OpenError }> {
  try {
    const res = await chatFetch("/me/chats/dm/open", {
      method: "POST",
      body: JSON.stringify({ handle }),
    });
    if (res.status === 401) return { error: "unauthorized" };
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: OpenError };
      return { error: j.error ?? "network" };
    }
    return (await res.json()) as DmSummary;
  } catch {
    return { error: "network" };
  }
}

export async function openClanChat(
  tag: string,
): Promise<ClanSummary | { error: OpenError }> {
  try {
    const res = await chatFetch("/me/chats/clan/open", {
      method: "POST",
      body: JSON.stringify({ tag }),
    });
    if (res.status === 401) return { error: "unauthorized" };
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: OpenError };
      return { error: j.error ?? "network" };
    }
    return (await res.json()) as ClanSummary;
  } catch {
    return { error: "network" };
  }
}

export async function fetchMessages(
  kind: ChatKind,
  conv: string,
  before?: number,
): Promise<ChatMessage[] | null> {
  try {
    const q = before ? `?before=${before}` : "";
    const res = await chatFetch(
      `/me/chats/${kind}/${encodeURIComponent(conv)}/messages${q}`,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { messages?: ChatMessage[] };
    return j.messages ?? [];
  } catch {
    return null;
  }
}

export type SendError =
  | "empty"
  | "too_long"
  | "too_fast"
  | "daily_cap"
  | "duplicate"
  | "links"
  | "blocked"
  | "forbidden"
  | "unauthorized"
  | "network";

export async function sendChatMessage(
  kind: ChatKind,
  conv: string,
  text: string,
): Promise<ChatMessage | { error: SendError; hosts?: string[] }> {
  try {
    const res = await chatFetch(
      `/me/chats/${kind}/${encodeURIComponent(conv)}/send`,
      {
        method: "POST",
        body: JSON.stringify({ text }),
      },
    );
    if (res.status === 401) return { error: "unauthorized" };
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: SendError;
        hosts?: string[];
      };
      return { error: j.error ?? "network", hosts: j.hosts };
    }
    const j = (await res.json()) as { message: ChatMessage };
    return j.message;
  } catch {
    return { error: "network" };
  }
}

export async function markChatRead(
  kind: ChatKind,
  conv: string,
  upTo: number,
): Promise<void> {
  try {
    await chatFetch(`/me/chats/${kind}/${encodeURIComponent(conv)}/read`, {
      method: "POST",
      body: JSON.stringify({ upTo }),
    });
  } catch {
    /* best-effort */
  }
}

// ⚠️ ЗЕРКАЛО серверной проверки (platform-api/src/chats.ts, LINK_RE +
// forbiddenLinkHosts): та же регулярка, тот же белый список. Клиент проверяет
// ДО отправки, чтобы сказать игроку причину сразу; решает всё равно сервер.
const LINK_RE =
  /(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:[a-z0-9-]{2,}\.)+[a-z]{2,10}(?:\/[^\s<>"']*)?/gi;

/** Хосты ссылок в тексте, которые НЕ из белого списка соцсетей. */
export function forbiddenLinkHosts(text: string): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    let raw = m[0];
    if (!/^https?:\/\//i.test(raw))
      raw = "http://" + raw.replace(/^www\./i, "");
    let host = "";
    try {
      host = new URL(raw).hostname;
    } catch {
      host = m[0];
    }
    if (!socialHostAllowed(host)) bad.push(host.toLowerCase());
  }
  return [...new Set(bad)];
}

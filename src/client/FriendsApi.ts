// Клиентский API системы друзей terron. См. friends.md. Все вызовы — с Bearer
// аккаунта (аноним не имеет друзей). Паттерн авторизации/фетча — как в ClanApi.
//
// ⚠️ Заменил мёртвый апстрим-стаб friends (компонент FriendsList + контракт
// /friends/* с {publicId,createdAt}, никогда не реализованный на нашем бэке).
// Наш контракт — /me/friends/* с именами/пресенсом (friends.md).
import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";

async function friendFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options?.headers,
      Authorization: await getAuthHeader(),
    },
  });
}

export interface FriendPresence {
  gameID: string;
  map: string | null;
  state: "lobby" | "in_game";
}
export interface FriendRow {
  id: string; // @slug или number друга (публичный id)
  name: string;
  slug: string | null;
  muted: boolean;
  since: string;
  // terron: своя аватарка → берём картинку из API (Avatar.customAvatarUrl),
  // иначе базовый портрет по seed.
  hasAvatar?: boolean;
  presence?: FriendPresence | null; // текущее лобби/игра (или null)
}

export interface IncomingFriendRequest {
  id: string;
  from: { id: string; name: string; slug: string | null };
  created_at: string;
}

export async function fetchFriends(): Promise<FriendRow[] | null> {
  try {
    const res = await friendFetch("/me/friends");
    if (!res.ok) return null;
    const j = (await res.json()) as { friends?: FriendRow[] };
    return j.friends ?? [];
  } catch {
    return null;
  }
}

export interface FriendRequests {
  incoming: IncomingFriendRequest[];
  outgoing: IncomingFriendRequest[];
}

export async function fetchFriendRequests(): Promise<FriendRequests | null> {
  try {
    const res = await friendFetch("/me/friends/requests");
    if (!res.ok) return null;
    const j = (await res.json()) as {
      requests?: IncomingFriendRequest[];
      incoming?: IncomingFriendRequest[];
      outgoing?: IncomingFriendRequest[];
    };
    return {
      incoming: j.incoming ?? j.requests ?? [],
      outgoing: j.outgoing ?? [],
    };
  } catch {
    return null;
  }
}

export async function acceptFriendRequest(id: string): Promise<boolean> {
  try {
    const res = await friendFetch(
      `/me/friends/requests/${encodeURIComponent(id)}/accept`,
      { method: "POST" },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function declineFriendRequest(id: string): Promise<boolean> {
  try {
    const res = await friendFetch(
      `/me/friends/requests/${encodeURIComponent(id)}/decline`,
      { method: "POST" },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Отозвать свою исходящую заявку (по её requestId). См. кнопка «Отозвать».
export async function withdrawFriendRequest(id: string): Promise<boolean> {
  try {
    const res = await friendFetch(
      `/me/friends/requests/${encodeURIComponent(id)}/withdraw`,
      { method: "POST" },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function removeFriend(id: string): Promise<boolean> {
  try {
    const res = await friendFetch(`/me/friends/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function setFriendMuted(
  id: string,
  muted: boolean,
): Promise<boolean> {
  try {
    const res = await friendFetch(
      `/me/friends/${encodeURIComponent(id)}/mute`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ muted }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export type AddFriendStatus =
  | "sent"
  | "already_friends"
  | "already_pending"
  | "limit_reached"
  | "self"
  | "auto_accepted"
  | "target_not_found"
  | "error";

/** Добавить в друзья по identifier (id/ссылка/@slug/имя) — страница /friends, досье. */
export async function requestFriendByIdentifier(
  identifier: string,
): Promise<{ status: AddFriendStatus; targetName?: string }> {
  try {
    const res = await friendFetch("/me/friends/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    if (!res.ok) return { status: "error" };
    const j = (await res.json()) as {
      status?: AddFriendStatus;
      target?: { name?: string };
    };
    return { status: j.status ?? "error", targetName: j.target?.name };
  } catch {
    return { status: "error" };
  }
}

// terron: «заявить» pending-заявки в друзья (присланные, пока я был анонимом) —
// по прежнему анон-persistentID из localStorage (остаётся и после входа). Зовём
// после логина. Возвращает число оживлённых заявок. Зеркало claimClanInvites.
export async function claimFriendRequests(): Promise<number> {
  try {
    let pid = "";
    try {
      pid = localStorage.getItem("player_persistent_id") ?? "";
    } catch {
      /* ignore */
    }
    if (!pid) return 0;
    const res = await friendFetch("/me/friends/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persistentIds: [pid] }),
    });
    if (!res.ok) return 0;
    const j = (await res.json()) as { claimed?: number };
    return j.claimed ?? 0;
  } catch {
    return 0;
  }
}

import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";

// Клиент-репортинг пресенса (лобби/игра) для системы друзей. См. friends.md
// (Этап 3). Только залогиненный (аноним не имеет друзей → getAuthHeader пуст).
// Хартбит 30с держит пресенс живым; бэк снимает по TTL (90с) при краше/закрытии.

type PresenceState = "lobby" | "in_game";
interface Presence {
  gameID: string;
  state: PresenceState;
  map?: string;
  mode?: string;
}

let current: Presence | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

// gameID матча/лобби, в котором Я сейчас нахожусь (пишем в localStorage, чтобы
// сайтовый FriendsNotifier в другой вкладке тоже мог его прочитать). Нужен, чтобы
// НЕ показывать уведомление «друг в матче» про игру, где я и так участник.
const MY_GAME_KEY = "terron_my_game";

/** gameID моего текущего лобби/матча (или null). Читается и из другой вкладки. */
export function myCurrentGameID(): string | null {
  if (current?.gameID) return current.gameID;
  try {
    return localStorage.getItem(MY_GAME_KEY);
  } catch {
    return null;
  }
}

async function post(path: string, body?: unknown): Promise<void> {
  try {
    const auth = await getAuthHeader();
    if (!auth) return; // аноним — друзей нет, пресенс не шлём
    // ⚠️ terron 26.08: Content-Type ставим ТОЛЬКО когда есть тело. Fastify
    // отбивает 400 («body cannot be empty when content-type is set to
    // application/json») на пустое тело с json-заголовком — из-за этого
    // `/me/presence/leave` (он зовётся БЕЗ тела) не срабатывал НИКОГДА, и
    // пресенс при выходе не снимался: друзья продолжали видеть игрока в
    // лобби, пока запись не истечёт сама. В консоли это был поток 400.
    await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: body
        ? { "Content-Type": "application/json", Authorization: auth }
        : { Authorization: auth },
      body: body ? JSON.stringify(body) : undefined,
      keepalive: true,
    });
  } catch {
    /* best-effort — сеть/бэк недоступны */
  }
}

/** Сообщить/обновить пресенс (при заходе в лобби и при старте матча). */
export function reportPresence(p: Presence): void {
  current = p;
  try {
    localStorage.setItem(MY_GAME_KEY, p.gameID);
  } catch {
    /* ignore */
  }
  void post("/me/presence", p);
  if (!timer) {
    timer = setInterval(() => {
      if (current) void post("/me/presence", current);
    }, 30_000);
  }
}

/** Снять пресенс (выход из лобби/игры). */
export function stopPresence(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (current) {
    void post("/me/presence/leave");
    current = null;
  }
  try {
    localStorage.removeItem(MY_GAME_KEY);
  } catch {
    /* ignore */
  }
}

// Подстраховка: при закрытии вкладки — best-effort снять пресенс (иначе TTL 90с).
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (current) {
      void post("/me/presence/leave");
      try {
        localStorage.removeItem(MY_GAME_KEY);
      } catch {
        /* ignore */
      }
    }
  });
}

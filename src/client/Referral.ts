// terron реферальная система (клиент). Привязка трекается в localStorage у
// открывшего; начисление наград отправителю — серверное (platform-api).
// Два источника реферала:
//   • профильная ссылка /invite/<code>  → terron_ref      (код аккаунта-отправителя)
//   • ссылка лобби /game/<id> (приватное) → terron_ref_lobby (id лобби; владелец = создатель)
// Конфиг наград/капов/бонусов — на сервере (platform-api/src/referral.ts).
import { getApiBase } from "./Api";
import { getAuthHeader, getPersistentID } from "./Auth";

const REF_KEY = "terron_ref"; // профильный код (кто меня привёл)
const REF_LOBBY_KEY = "terron_ref_lobby"; // id лобби, по ссылке которого пришёл
const REF_PROFILE_KEY = "terron_ref_profile"; // slug профиля, на который зашёл
const REF_OPEN_KEY = "terron_ref_open"; // источник, по которому уже сработал «open»
const CODE_RE = /^[A-Za-z0-9]{4,16}$/;

export interface RefSource {
  code?: string;
  lobby?: string;
  profile?: string; // slug владельца профиля (зашёл на /@slug → его реферал)
}

/** Текущий источник реферала. Приоритет: код > лобби > профиль (first-touch). */
export function getReferralSource(): RefSource | null {
  try {
    const code = localStorage.getItem(REF_KEY);
    if (code && CODE_RE.test(code)) return { code };
    const lobby = localStorage.getItem(REF_LOBBY_KEY);
    if (lobby) return { lobby };
    const profile = localStorage.getItem(REF_PROFILE_KEY);
    if (profile) return { profile };
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Зашёл на чужой профиль /@slug → становится рефералом владельца (если ещё нет
 * привязки — first-touch, не перебиваем код/лобби/прошлый профиль). Резолв slug→
 * аккаунт на сервере. Самопривязку (свой профиль) вызывающий не шлёт.
 */
export function captureProfileReferral(slug: string): void {
  try {
    if (!slug) return;
    if (
      localStorage.getItem(REF_KEY) ||
      localStorage.getItem(REF_LOBBY_KEY) ||
      localStorage.getItem(REF_PROFILE_KEY)
    ) {
      return; // уже есть источник
    }
    localStorage.setItem(REF_PROFILE_KEY, slug);
    fireOpen({ profile: slug });
  } catch {
    /* ignore */
  }
}

/** Есть ли активная реф-привязка (для бейджа «+200» под кнопкой входа). */
export function hasReferral(): boolean {
  return getReferralSource() !== null;
}

/**
 * Захватить профильный реф-код из URL (`/invite/<code>` или `?ref=`), сохранить,
 * дёрнуть «open» и вычистить из адресной строки. `/invite/...` уводит на главную.
 */
export function captureReferralFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    const inviteMatch = window.location.pathname.match(
      /^\/invite\/([A-Za-z0-9]{4,16})\/?$/,
    );
    const code = inviteMatch ? inviteMatch[1] : url.searchParams.get("ref");
    if (!code || !CODE_RE.test(code)) return;

    localStorage.setItem(REF_KEY, code);
    fireOpen({ code });

    url.searchParams.delete("ref");
    const path = inviteMatch ? "/" : url.pathname;
    window.history.replaceState({}, "", path + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

/**
 * Зашли по ссылке ПРИВАТНОГО лобби (/game/<id> холодной загрузкой). Владелец
 * ссылки = создатель лобби (резолвится сервером). Публичные лобби не
 * зарегистрированы → никому не начислят. Профильный код приоритетнее (не трогаем).
 */
export function captureLobbyReferral(lobbyId: string): void {
  try {
    if (!lobbyId) return;
    if (localStorage.getItem(REF_KEY)) return; // уже есть явный реф-код
    localStorage.setItem(REF_LOBBY_KEY, lobbyId);
    fireOpen({ lobby: lobbyId });
  } catch {
    /* ignore */
  }
}

function fireOpen(src: RefSource): void {
  const key = src.code ?? src.lobby ?? src.profile ?? "";
  try {
    if (localStorage.getItem(REF_OPEN_KEY) === key) return;
    localStorage.setItem(REF_OPEN_KEY, key);
  } catch {
    /* ignore */
  }
  void postEvent(src, "open");
}

/** Матч сыгран по реф-ссылке (вызывать в конце матча). `won` → ещё и «выиграл». */
export function fireReferralMatch(won: boolean): void {
  const src = getReferralSource();
  if (!src) return;
  void postEvent(src, "play");
  // win несёт pid (личность приглашённого) → сервер засчитывает «приглашённого»
  // (дедуп по человеку) для счётчика/лидерборда.
  if (won) void postEvent(src, "win", getPersistentID());
}

async function postEvent(
  src: RefSource,
  type: "open" | "play" | "win",
  pid?: string,
): Promise<void> {
  try {
    const auth = await getAuthHeader();
    await fetch(getApiBase() + "/referral/event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify({ ...src, type, ...(pid ? { pid } : {}) }),
    });
  } catch {
    /* ignore — реферальные начисления не критичны для игры */
  }
}

/** Создатель лобби регистрирует владение его ссылкой (только залогиненный). */
export async function registerLobbyOwnership(lobbyId: string): Promise<void> {
  try {
    const auth = await getAuthHeader();
    if (!auth || !lobbyId) return;
    await fetch(getApiBase() + "/referral/lobby", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ lobbyId }),
    });
  } catch {
    /* ignore */
  }
}

export interface MyReferralStat {
  type: "open" | "play" | "register" | "win";
  reward: number;
  current: number;
  max: number;
}
export interface MyReferral {
  code: string;
  link: string;
  signupBonus: number;
  invited: number;
  stats: MyReferralStat[];
}

export interface RefLeaderRow {
  slug: string;
  username: string | null;
  invited: number;
  hasAvatar?: boolean; // своя аватарка → картинка из API (см. Avatar.ts)
}

/** Лидерборд по приглашениям (друзей, выигравших ≥1 матч). Публичный. */
export async function getReferralLeaderboard(): Promise<RefLeaderRow[]> {
  try {
    const r = await fetch(getApiBase() + "/referral/leaderboard");
    if (!r.ok) return [];
    return ((await r.json()) as { rows: RefLeaderRow[] }).rows ?? [];
  } catch {
    return [];
  }
}

/** Мой реф-код + ссылка + статистика (current/max за месяц). null если не залогинен. */
export async function getMyReferral(): Promise<MyReferral | null> {
  try {
    const auth = await getAuthHeader();
    if (!auth) return null;
    const r = await fetch(getApiBase() + "/referral/me", {
      headers: { Authorization: auth },
    });
    if (!r.ok) return null;
    return (await r.json()) as MyReferral;
  } catch {
    return null;
  }
}

import { decodeJwt } from "jose";
import { UserSettings } from "src/core/game/UserSettings";
import { z } from "zod";
import { TokenPayload, TokenPayloadSchema } from "../core/ApiSchemas";
import { base64urlToUuid } from "../core/Base64";
import { getApiBase, getAudience } from "./Api";
import { platformAuthHeaders, platformContextReady } from "./PlatformContext";
import { generateCryptoRandomUUID, getCurrentLang } from "./Utils";

export type UserAuth = { jwt: string; claims: TokenPayload } | false;

const PERSISTENT_ID_KEY = "player_persistent_id";

let __jwt: string | null = null;
let __refreshPromise: Promise<void> | null = null;
let __expiresAt: number = 0;
// terron: гость (нет аккаунта) не имеет refresh-куки → /auth/refresh всегда 401.
// Раньше КАЖДЫЙ userAuth() (а его дёргают getAuthHeader/getPlayToken на каждое
// сообщение чата, лобби и т.д.) бил в /auth/refresh → спам «401 Unauthorized» в
// консоли + лишние запросы + нестабильная identity (то гость, то аккаунт →
// ломало опознание создателя лобби). Запоминаем «сессии нет» и не долбим refresh,
// пока юзер явно не залогинится (login сбрасывает флаг).
let __sessionKnownAbsent = false;

export function discordLogin() {
  const redirectUri = encodeURIComponent(window.location.href);
  window.location.href = `${getApiBase()}/auth/login/discord?redirect_uri=${redirectUri}`;
}

// Результат обмена magic-токена: ok → email; иначе expired=true означает
// ОКОНЧАТЕЛЬНЫЙ отказ (ссылка устарела/использована/невалидна — повтор не поможет),
// expired=false — временная ошибка (5xx, можно повторить).
export type TokenLoginResult =
  | { ok: true; email: string }
  | { ok: false; expired: boolean };

export async function tempTokenLogin(token: string): Promise<TokenLoginResult> {
  // terron реферал: если пришли по инвайт-ссылке (профильный код) или по ссылке
  // приватного лобби — отдаём источник при регистрации (новый аккаунт получит
  // 200 ЛТС, отправитель/владелец лобби — награду). Инлайн (без импорта Referral)
  // во избежание циклической зависимости Auth↔Referral.
  let refQ = "";
  try {
    const ref = localStorage.getItem("terron_ref");
    const refLobby = localStorage.getItem("terron_ref_lobby");
    const refProfile = localStorage.getItem("terron_ref_profile");
    if (ref && /^[A-Za-z0-9]{4,16}$/.test(ref)) {
      refQ = `&ref=${encodeURIComponent(ref)}`;
    } else if (refLobby) {
      refQ = `&reflobby=${encodeURIComponent(refLobby)}`;
    } else if (refProfile) {
      refQ = `&refprofile=${encodeURIComponent(refProfile)}`;
    }
  } catch {
    /* ignore */
  }
  const response = await fetch(
    `${getApiBase()}/auth/login/token?login-token=${token}${refQ}`,
    {
      credentials: "include",
    },
  );
  if (response.status !== 200) {
    // 400 = невалидный/просроченный/использованный токен → окончательно (не ретраить).
    // 4xx прочее тоже считаем окончательным; 5xx — временным.
    const expired = response.status >= 400 && response.status < 500;
    return { ok: false, expired };
  }
  const json = await response.json();
  const { email } = json;
  // Залогинились → разрешаем refresh снова (сессия появилась).
  __sessionKnownAbsent = false;
  return { ok: true, email };
}

export async function getAuthHeader(): Promise<string> {
  const userAuthResult = await userAuth();
  if (!userAuthResult) return "";
  const { jwt } = userAuthResult;
  return `Bearer ${jwt}`;
}

/**
 * terron ТЕЛЕМЕТРИЯ (08.08): «у этого браузера КОГДА-ТО была сессия».
 *
 * Нужен, чтобы отличить обычного ГОСТЯ от залипшей проблемы. Датчик
 * `reward_no_session` (экран итогов не смог спросить награду) заводился ради
 * второго случая — кука не доехала в iframe площадки, и залогиненный игрок
 * остался без заработка, — но срабатывал у ЛЮБОГО незалогиненного. Гостей же
 * большинство, поэтому настоящий сигнал в них тонул: 83 события в сутки, и по
 * ним нельзя было сказать, сколько из них баг.
 *
 * Ставим при успешной проверке сессии, снимаем при выходе.
 */
const HAD_SESSION_KEY = "terron_had_session";

export function markSessionSeen(): void {
  try {
    localStorage.setItem(HAD_SESSION_KEY, "1");
  } catch {
    /* private mode — переживём, просто не будет уточнения в телеметрии */
  }
}

/** Был ли у этого браузера вход. Гость без аккаунта → false. */
export function hadSessionBefore(): boolean {
  try {
    return localStorage.getItem(HAD_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export async function logOut(allSessions: boolean = false): Promise<boolean> {
  try {
    const response = await fetch(
      getApiBase() + (allSessions ? "/auth/revoke" : "/auth/logout"),
      {
        method: "POST",
        credentials: "include",
        headers: platformAuthHeaders(),
      },
    );

    if (response.ok === false) {
      console.error("Logout failed", response);
      return false;
    }
    // terron: ЗАМКИ НА УЛЬТЫ — кэш владения не должен пережить смену аккаунта
    // на одном устройстве (динамический импорт: UltUnlocks → Api → Auth).
    void import("./UltUnlocks")
      .then((m) => m.clearUltUnlocks())
      .catch(() => {});
    // terron 25.08: TERRON Prime — ровно тот же случай. Прем открывает нижний
    // ряд сетки ульт, и его кэш переживал выход: следующий игрок на этом же
    // устройстве играл с прем-рядом.
    void import("./Api").then((m) => m.clearPrimeStatus()).catch(() => {});

    return true;
  } catch (e) {
    console.error("Logout failed", e);
    return false;
  } finally {
    __jwt = null;
    localStorage.removeItem(PERSISTENT_ID_KEY);
    try {
      localStorage.removeItem(HAD_SESSION_KEY);
    } catch {
      /* ignore */
    }
    new UserSettings().clearFlag();
    new UserSettings().setSelectedPatternName(undefined);
  }
}

/**
 * Сессия появилась в обход обычного входа — например, её поставил
 * `POST /auth/ya` при входе через игровую площадку (кука прилетела на нашем
 * домене, а клиент об этом не знает).
 *
 * ⚠️ Без этого игрок видел «Вход выполнен» и тут же «Войдите в аккаунт»:
 * `__sessionKnownAbsent` взводится на первом 401 гостя (норма — не спамим
 * сервер), и дальше `userAuth()` даже не пробует обновиться. Помогала только
 * перезагрузка, которая обнуляла флаг (замечание модератора GamePush 30.07).
 */
export async function adoptExternalSession(): Promise<boolean> {
  __sessionKnownAbsent = false;
  __jwt = null;
  await refreshJwt();
  return __jwt !== null;
}

export async function isLoggedIn(): Promise<boolean> {
  const userAuthResult = await userAuth();
  return userAuthResult !== false;
}

/** Сессия сменилась (вошли/вышли) — компоненты шапки читают состояние один раз
 *  при подключении, поэтому без этого сигнала кнопка «Войти» висит до F5.
 *  Зовётся после входа через площадку; email-вход перезагружает страницу сам. */
export function notifyAuthChanged(): void {
  window.dispatchEvent(new CustomEvent("terron-auth-changed"));
}

export async function userAuth(
  shouldRefresh: boolean = true,
): Promise<UserAuth> {
  try {
    const jwt = __jwt;
    if (!jwt) {
      // Гость без сессии — не бьём в refresh повторно (иначе спам 401).
      if (!shouldRefresh || __sessionKnownAbsent) {
        return false;
      }
      await refreshJwt();
      return userAuth(false);
    }

    // Verify the JWT (requires browser support)
    // const jwks = createRemoteJWKSet(
    //   new URL(getApiBase() + "/.well-known/jwks.json"),
    // );
    // const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    //   issuer: getApiBase(),
    //   audience: getAudience(),
    // });

    const payload = decodeJwt(jwt);
    const { iss, aud } = payload;

    if (iss !== getApiBase()) {
      // JWT was not issued by the correct server
      console.error('unexpected "iss" claim value');
      logOut();
      return false;
    }
    const myAud = getAudience();
    if (myAud !== "localhost" && aud !== myAud) {
      // JWT was not issued for this website
      console.error('unexpected "aud" claim value');
      logOut();
      return false;
    }
    if (Date.now() >= __expiresAt - 3 * 60 * 1000) {
      console.log("jwt expired or about to expire");
      if (!shouldRefresh) {
        console.error("jwt expired and shouldRefresh is false");
        return false;
      }
      await refreshJwt();

      // Try to get login info again after refreshing
      return userAuth(false);
    }

    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Invalid payload", error);
      return false;
    }

    const claims = result.data;
    markSessionSeen(); // сессия подтверждена — см. hadSessionBefore()
    return { jwt, claims };
  } catch (e) {
    console.error("isLoggedIn failed", e);
    return false;
  }
}

async function refreshJwt(): Promise<void> {
  if (__refreshPromise) {
    return __refreshPromise;
  }
  __refreshPromise = doRefreshJwt();
  try {
    await __refreshPromise;
  } finally {
    __refreshPromise = null;
  }
}

async function doRefreshJwt(): Promise<void> {
  try {
    // ⚠️ Ждём, пока станет известна площадка: сессии сайта и каталога разведены
    // именем куки, и запрос без заголовка поднял бы САЙТОВУЮ сессию внутри ВК
    // (см. PlatformContext). Вне площадки ожидание мгновенное.
    await platformContextReady();
    const response = await fetch(getApiBase() + "/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: platformAuthHeaders(),
    });
    if (response.status === 401) {
      // Нет сессии (гость) — это норма, не ошибка. Запоминаем и не спамим.
      __sessionKnownAbsent = true;
      __jwt = null;
      return;
    }
    if (response.status !== 200) {
      console.error("Refresh failed", response.status);
      logOut();
      return;
    }
    const json = await response.json();
    const { jwt, expiresIn } = json;
    __expiresAt = Date.now() + expiresIn * 1000;
    __sessionKnownAbsent = false;
    __jwt = jwt;
  } catch (e) {
    console.error("Refresh failed", e);
    // if server unreachable, just clear jwt
    __jwt = null;
    return;
  }
}

export async function sendMagicLink(email: string): Promise<boolean> {
  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/auth/magic-link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        redirectDomain: window.location.origin,
        email: email,
        // язык интерфейса → письмо приходит на нём (а не всегда по-русски)
        lang: getCurrentLang(),
      }),
    });

    if (response.ok) {
      return true;
    } else {
      console.error(
        "Failed to send recovery email:",
        response.status,
        response.statusText,
      );
      return false;
    }
  } catch (error) {
    console.error("Error sending recovery email:", error);
    return false;
  }
}

// terron: вход по короткому коду из письма (когда письмо открыто на другом
// устройстве). Ставит refresh-куку как и магик-ссылка. true = успех.
export async function loginWithCode(
  email: string,
  code: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/auth/login/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...platformAuthHeaders(),
      },
      credentials: "include",
      body: JSON.stringify({ email: email.trim().toLowerCase(), code }),
    });
    // Успешный вход → сессия есть, разрешаем refresh снова.
    if (response.ok) __sessionKnownAbsent = false;
    return response.ok;
  } catch (error) {
    console.error("loginWithCode failed:", error);
    return false;
  }
}

// WARNING: DO NOT EXPOSE THIS ID
export async function getPlayToken(): Promise<string> {
  const result = await userAuth();
  if (result !== false) return result.jwt;
  return getPersistentIDFromLocalStorage();
}

// WARNING: DO NOT EXPOSE THIS ID
export function getPersistentID(): string {
  const jwt = __jwt;
  if (!jwt) return getPersistentIDFromLocalStorage();
  const payload = decodeJwt(jwt);
  const sub = payload.sub;
  if (!sub) return getPersistentIDFromLocalStorage();
  return base64urlToUuid(sub);
}

/**
 * terron: АНОНИМНЫЕ id этого браузера — для клейма наград, заработанных ДО
 * регистрации (золотой матч, выигранный анонимом). У залогиненного
 * getPersistentID() отдаёт уже account-uuid, а тут лежит прежний анонимный:
 * ключ переживает логин и стирается только при выходе.
 */
export function getAnonPersistentIDs(): string[] {
  try {
    const v = localStorage.getItem(PERSISTENT_ID_KEY);
    return v ? [v] : [];
  } catch {
    return [];
  }
}

// WARNING: DO NOT EXPOSE THIS ID
function getPersistentIDFromLocalStorage(): string {
  // Try to get existing localStorage
  const value = localStorage.getItem(PERSISTENT_ID_KEY);
  if (value) return value;

  // If no localStorage exists, create new ID and set localStorage
  const newID = generateCryptoRandomUUID();
  localStorage.setItem(PERSISTENT_ID_KEY, newID);

  return newID;
}

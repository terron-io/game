import { isDevSite } from "./Utils";
// terron: ЗАМКИ НА УЛЬТЫ — клиентский кэш «какие ЗАКРЫТЫЕ ульты открыты у
// моего аккаунта» (TZ-ult-unlocks.md). Источник истины — platform-api
// (/me/ults); тут — снимок в памяти + localStorage (чтобы чузер в матче не
// ждал сети). Проверка на РЕЛЕ игрового сервера всё равно есть — этот кэш
// только витрина/UX (замок в чузере, дерево в досье).
import { isLockedUltimate, UnitType } from "../core/game/Game";
import { getMyUlts, UltUnlockView } from "./Api";

const LS_KEY = "terron_ult_unlocks";

let _view: UltUnlockView[] | null = null;
let _owned: Set<string> = readLs();
let _inflight: Promise<UltUnlockView[] | null> | null = null;

function readLs(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeLs(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([..._owned]));
  } catch {
    /* private mode */
  }
}

// terron: ДЕВ-ПЕСОЧНИЦА ЗАМКОВ — включена ли она в ТЕКУЩЕМ матче. Ставит
// ClientGameRunner из конфига лобби; вне матча всегда false.
let _devUnlockAll = false;

/** terron: дев-песочница замков включена в этом матче. TZ-ult-unlocks.md */
export function setDevUnlockAll(on: boolean): void {
  _devUnlockAll = on;
}

/** Закрыта ли ульта ДЛЯ МЕНЯ (в реестре замков и нет владения). */
export function ultLockedForMe(t: UnitType): boolean {
  if (!isLockedUltimate(t)) return false;
  // terron: ДЕВ-ПЕСОЧНИЦА — галочка в лобби снимает замок и в интерфейсе
  // тоже, иначе висел бы 🔒 на том, что сервер уже пускает. Значение ставит
  // матч при старте (setDevUnlockAll), гейт по ХОСТУ: ClientEnv.env() тут не
  // годится — прод-игра тоже запущена с GAME_ENV=dev. TZ-ult-unlocks.md
  if (_devUnlockAll && isDevSite()) return false;
  return !_owned.has(t);
}

/** Снимок витрины (null = ещё не загружали / аноним). */
export function ultUnlocksView(): UltUnlockView[] | null {
  return _view;
}

/** Перечитать с API. Аноним/ошибка → владение не трогаем (остаётся кэш). */
export async function refreshUltUnlocks(): Promise<UltUnlockView[] | null> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const v = await getMyUlts();
      if (v === null) return null; // 401/сеть — кэш остаётся
      _view = v;
      _owned = new Set(v.filter((u) => u.unlocked).map((u) => u.id));
      writeLs();
      return v;
    } catch {
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Сброс при выходе из аккаунта (замки возвращаются). */
export function clearUltUnlocks(): void {
  _view = null;
  _owned = new Set();
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

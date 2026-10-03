// terron: предложение ульты с /ults (кнопка «Предложить +», 24.08).
// Валидация — ЗЕРКАЛО серверной (platform-api/src/routes/suggest.ts,
// suggestionProblem): мин. длина + минимум РАЗНЫХ символов («ааааа» не
// проходит). «Не придумал» в полях активки — валидный ответ (проходит и
// общие правила, спец-ветки не нужно). Менять правила — в ОБОИХ местах.
import { getApiBase } from "./Api";
import { getAuthHeader, getPersistentID } from "./Auth";
import { L } from "./Utils";

export interface UltSuggestion {
  ultName: string;
  ultDesc: string;
  castName: string;
  castDesc: string;
}

export type SuggestField = keyof UltSuggestion;

function uniqueChars(s: string): number {
  return new Set(s.toLowerCase().replace(/\s+/g, "")).size;
}

// null = всё в порядке; иначе — первое проблемное поле + человеческий текст.
export function validateUltSuggestion(
  f: UltSuggestion,
): { field: SuggestField; msg: string } | null {
  const nameOk = (v: string) => v.length >= 3 && uniqueChars(v) >= 3;
  const descOk = (v: string) => v.length >= 10 && uniqueChars(v) >= 5;
  const nameMsg = L(
    "Название: минимум 3 символа, осмысленное",
    "Name: at least 3 meaningful characters",
  );
  const descMsg = L(
    "Опиши подробнее: минимум 10 символов, не «ааааа»",
    "Describe it: at least 10 characters, no gibberish",
  );
  if (!nameOk(f.ultName.trim())) return { field: "ultName", msg: nameMsg };
  if (!descOk(f.ultDesc.trim())) return { field: "ultDesc", msg: descMsg };
  if (!nameOk(f.castName.trim())) return { field: "castName", msg: nameMsg };
  if (!descOk(f.castDesc.trim())) return { field: "castDesc", msg: descMsg };
  return null;
}

// Антифлуд (решение владельца 24.08): сервер держит ≤5/сутки с IP и с
// устройства + ≤10/час от всех (считает по БД); здесь — третий рубеж,
// счётчик в localStorage этого браузера. deviceId = persistentID игрока.
export type SubmitResult = "ok" | "limit_day" | "limit_hour" | "fail";

const LS_KEY = "terron_ult_suggest";
const PER_DAY = 5;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function sentToday(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as {
      d?: string;
      n?: number;
    };
    return raw.d === todayKey() ? (raw.n ?? 0) : 0;
  } catch {
    return 0;
  }
}

function bumpSentToday(): void {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ d: todayKey(), n: sentToday() + 1 }),
    );
  } catch {
    /* ignore */
  }
}

export async function submitUltSuggestion(
  f: UltSuggestion,
): Promise<SubmitResult> {
  if (sentToday() >= PER_DAY) return "limit_day";
  try {
    const r = await fetch(getApiBase() + "/ults/suggest", {
      method: "POST",
      headers: {
        Authorization: await getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ultName: f.ultName.trim(),
        ultDesc: f.ultDesc.trim(),
        castName: f.castName.trim(),
        castDesc: f.castDesc.trim(),
        deviceId: getPersistentID(),
      }),
    });
    if (r.ok) {
      bumpSentToday();
      return "ok";
    }
    if (r.status === 429) {
      const scope = ((await r.json().catch(() => null)) as {
        scope?: string;
      } | null)?.scope;
      if (scope === "hour") return "limit_hour";
      if (scope === "day") return "limit_day";
      // 429 без scope = минутный анти-бёрст → «попробуй чуть позже»
      return "fail";
    }
    return "fail";
  } catch {
    return "fail";
  }
}

// terron 25.08: КОНТЕКСТ СЕССИИ — сайт или каталог площадки.
//
// Решение владельца: «вк игра это вк игра, сайт игра это сайт игра». Сессии
// разведены на сервере ИМЕНЕМ КУКИ (platform-api/src/auth/cookies.ts), а какой
// контекст сейчас — знает только клиент, из `gp.platform.type`. Он и сообщает
// его заголовком `X-Terron-Platform` во всех запросах авторизации.
//
// ⚠️ ГЛАВНАЯ ЛОВУШКА — ГОНКА. SDK площадки поднимается ПОЗЖЕ первого кадра, а
// обновление сессии стартует сразу. Спросив контекст слишком рано, мы отправим
// запрос без заголовка, сервер отдаст САЙТОВУЮ сессию — и внутри ВК игрок снова
// окажется под аккаунтом сайта, ровно как до разделения. Поэтому ждём SDK, но с
// потолком: вне площадки промиса `__gpReady` не существует вовсе, и ожидание
// заканчивается мгновенно.
const HEADER = "X-Terron-Platform";
const CACHE_KEY = "terron_platform_ctx";
const WAIT_MS = 2500;

let resolved: string | null = null;
let waiting: Promise<string | null> | null = null;

function readCache(): string | null {
  try {
    return sessionStorage.getItem(CACHE_KEY) || null;
  } catch {
    return null;
  }
}

function writeCache(v: string): void {
  try {
    sessionStorage.setItem(CACHE_KEY, v);
  } catch {
    /* приватный режим — переживём, спросим SDK заново */
  }
}

/** Тип площадки, если он уже известен. Синхронно, без ожидания. */
export function platformContext(): string | null {
  return resolved ?? readCache();
}

/** Дождаться готовности SDK и вернуть тип площадки (или null — мы на сайте). */
export function platformContextReady(): Promise<string | null> {
  const known = platformContext();
  if (known !== null) return Promise.resolve(known);
  if (waiting) return waiting;
  const ready = (window as unknown as { __gpReady?: Promise<unknown> })
    .__gpReady;
  if (!ready) {
    // Сниппет SDK грузится только внутри iframe площадки: его нет — мы на сайте,
    // в приложении или на itch. Ждать нечего.
    waiting = Promise.resolve(null);
    return waiting;
  }
  waiting = Promise.race([
    ready.then((gp) => {
      const t = (gp as { platform?: { type?: unknown } } | undefined)?.platform
        ?.type;
      return typeof t === "string" ? t : null;
    }),
    new Promise<null>((r) => window.setTimeout(() => r(null), WAIT_MS)),
  ])
    .then((t) => {
      setPlatformContext(t);
      return platformContext();
    })
    .catch(() => null);
  return waiting;
}

/** Запомнить площадку (зовёт GamePushSDK, как только узнал её сам). */
export function setPlatformContext(type: unknown): void {
  if (typeof type !== "string") return;
  const t = type.trim().toUpperCase();
  // NONE — песочница GamePush: площадки под нами нет, это тот же сайт.
  if (!t || t === "NONE") return;
  resolved = t;
  writeCache(t);
}

/** Заголовок контекста для запросов авторизации. Вне площадки — пусто. */
export function platformAuthHeaders(): Record<string, string> {
  const t = platformContext();
  return t ? { [HEADER]: t } : {};
}

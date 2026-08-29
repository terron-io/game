// terron 25.08: ПУШ-УВЕДОМЛЕНИЯ ОБ АЛМАЗНОМ МАТЧЕ.
//
// ЗАЧЕМ. Замер 25.08: из 1540 новичков за месяц 73.8% играют ровно один день.
// Возвращаются только те, у кого есть аккаунт (71.7% против 19.4%), но
// залогинены лишь 18.3% партий — то есть с большинством игроков у нас нет
// НИ ОДНОГО канала связи. Алмазный матч раз в час — единственное событие с
// собственным расписанием, то есть готовый повод написать человеку.
//
// ПОЧЕМУ НЕ ONESIGNAL. Web Push — стандарт браузера; OneSignal лишь обёртка
// над ним и берёт деньги за MAU. Свой сервер уже есть, ключи VAPID свои,
// доставка бесплатная и без потолков (platform-api/src/push.ts).
//
// ⚠️ ГЛАВНОЕ ПРАВИЛО: браузер даёт спросить разрешение ОДИН РАЗ. Поймал отказ —
// повторный запрос не покажется никогда, останется только инструкция руками
// (по ней ходят единицы). Поэтому системный запрос вызывается ТОЛЬКО после
// нашего собственного «да»: сперва спрашиваем мы, и лишь потом браузер.
//
// ⚠️ Второе правило: пуш — обещание конкретной кнопки. Подписался на алмазный
// матч — получает алмазный матч. Тема едет в подписке (`topics`), и расширять
// её задним числом нельзя: это самый быстрый способ получить отписку.

import { getApiBase } from "./Api";
import { getPersistentID } from "./Auth";
import { L, getCurrentLang, isDevSite } from "./Utils";

export type PushTopic = "diamond" | "golden";

/** Что сейчас с каналом. `unsupported` — браузер не умеет вовсе. */
export type PushState = "unsupported" | "default" | "granted" | "denied";

export type EnableResult =
  | "ok"
  | "already"
  | "denied" // отказал сейчас или отказывал раньше — показываем инструкцию
  | "unsupported"
  | "no-server" // ключи VAPID не настроены на сервере
  | "error";

const SW_URL = "/sw.js";

export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function pushState(): PushState {
  if (!pushSupported()) return "unsupported";
  const p = Notification.permission;
  return p === "granted" || p === "denied" ? p : "default";
}

/**
 * Показывать ли колокольчик в лобби.
 *
 * terron 25.08 (решение владельца «во всех лобби пусть будет»): колокольчик
 * живёт в ЛЮБОМ СОБЫТИЙНОМ лобби — и золотом, и алмазном. Тема подписки едет
 * своя на каждый тир (см. topicForTier), потому что пуш — обещание конкретной
 * кнопки: подписался на золотой — получаешь золотой.
 *
 * ⚠️ В обычном ФФА/приватном лобби колокольчика НЕТ и быть не может: там нечего
 * обещать — лобби живёт десять секунд, расписания у него не существует.
 * Поэтому гейт по `tier`, а не «показывать всегда».
 *
 * ⚠️ ЗОЛОТОЙ ИДЁТ РАЗ В 10 МИНУТ. Пока рассылки нет вовсе (никто не зовёт
 * `sendTo` по расписанию), это безопасно, но КОГДА её напишут — у золотой темы
 * обязан быть свой потолок частоты, иначе игрок получит десятки уведомлений в
 * день и отпишется. Записано в BACKLOG.
 *
 * Гварды площадок НЕ ослаблены: внутри чужого iframe (GamePush → VK/Яндекс/
 * Пикабу/itch) кнопки нет — там браузер физически не даст спросить разрешение.
 */
export function showNotifyButton(
  tier: "golden" | "diamond" | null,
  state: PushState = pushState(),
  embedded: boolean = inForeignFrame(),
): boolean {
  return tier !== null && state !== "unsupported" && !embedded;
}

/** Тема подписки под тир лобби. Обещание кнопки = тема в подписке. */
export function topicForTier(tier: "golden" | "diamond" | null): PushTopic {
  return tier === "golden" ? "golden" : "diamond";
}

/**
 * Мы внутри ЧУЖОГО iframe (площадка GamePush: VK / Яндекс / Пикабу, стор,
 * itch). Класс `gp-embed` ставит бутстрап в index.html синхронно, до рендера.
 *
 * ⚠️ Колокольчик прячем во ВСЯКОМ чужом кадре, включая itch, и причина тут не
 * модерация, а физика: запрос разрешения на уведомления из cross-origin iframe
 * браузер блокирует. Кнопка, которая не может сработать, хуже отсутствующей —
 * она ещё и сожгла бы у игрока впечатление «нажал, ничего не произошло».
 * На terron.io и в наших приложениях self === top, класс не ставится.
 */
export function inForeignFrame(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("gp-embed")
  );
}

/** Ключ сервера кэшируем на сессию: ручка публичная, но дёргать её на каждый
 *  показ кнопки незачем. */
let configCache: { enabled: boolean; publicKey: string } | null = null;

async function pushConfig(): Promise<{ enabled: boolean; publicKey: string }> {
  if (configCache) return configCache;
  const r = await fetch(`${getApiBase()}/push/config`);
  if (!r.ok) throw new Error(`push/config ${r.status}`);
  configCache = (await r.json()) as { enabled: boolean; publicKey: string };
  return configCache;
}

/** base64url → Uint8Array (формат applicationServerKey у PushManager). */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  // ⚠️ Явный ArrayBuffer, а не `new Uint8Array(len)`: у второго тип буфера
  // ArrayBufferLike (может быть SharedArrayBuffer), и applicationServerKey
  // такой не принимает — tsc падает на присваивании.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function readyWorker(): Promise<ServiceWorkerRegistration | null> {
  try {
    // Регистрация обычно уже есть (её ставит бутстрап), но на /test SW снесён
    // намеренно, а в нативном бандле его нет вовсе — тогда просто выходим.
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_URL);
  } catch (e) {
    console.warn("[push] нет service worker:", e);
    return null;
  }
}

export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return Boolean(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/**
 * Полный путь подписки. Системный запрос разрешения вызывается ЗДЕСЬ, то есть
 * уже после нашего собственного диалога — см. правило в шапке файла.
 */
export async function enablePush(
  topic: PushTopic = "diamond",
): Promise<EnableResult> {
  if (!pushSupported()) return "unsupported";
  // Отказывал раньше — системный запрос молча вернёт "denied" и сожжёт вид
  // «мы спросили». Сразу отправляем в инструкцию.
  if (Notification.permission === "denied") return "denied";

  let cfg: { enabled: boolean; publicKey: string };
  try {
    cfg = await pushConfig();
  } catch {
    return "error";
  }
  if (!cfg.enabled || !cfg.publicKey) return "no-server";

  const reg = await readyWorker();
  if (!reg) return "unsupported";

  if (Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return "denied";
  }

  try {
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true, // без этого Chrome вообще не подписывает
        applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
      }));
    await sendSubscription(sub, topic);
    return existing ? "already" : "ok";
  } catch (e) {
    console.warn("[push] подписка не удалась:", e);
    return "error";
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    // Сначала говорим серверу, потом рвём подписку: наоборот — потеряли бы
    // endpoint и оставили в базе мёртвую строку, в которую будем долбиться.
    await fetch(`${getApiBase()}/push/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
      keepalive: true,
    }).catch(() => undefined);
    await sub.unsubscribe();
  } catch (e) {
    console.warn("[push] отписка не удалась:", e);
  }
}

/**
 * Отправка подписки на сервер.
 *
 * ⚠️ Часовой пояс шлём ЗДЕСЬ и обязательно: расписание алмазного задано по
 * Москве, а слать в личное окно игрока (замер 25.08: 49.2% его партий лежат в
 * ±2 часа от личного часа-пика против 20.8% случайных) без пояса нельзя —
 * разбудим Владивосток по московскому времени.
 */
/** Язык браузера как есть (`ru-RU`). Обрезает до основного тега сервер. */
function browserLanguage(): string {
  try {
    return navigator.language || (navigator.languages ?? [])[0] || "";
  } catch {
    return "";
  }
}

/**
 * Игрок выбрал язык САМ? Явный выбор пишется в `localStorage.lang` (см.
 * LangSelector) — всё остальное это наш дефолт, выведенный из браузера или
 * площадки, и выдавать его за выбор нельзя.
 */
function langChosenExplicitly(): boolean {
  try {
    return Boolean(localStorage.getItem("lang"));
  } catch {
    return false;
  }
}

async function sendSubscription(
  sub: PushSubscription,
  topic: PushTopic,
): Promise<void> {
  const json = sub.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    /* пояс не обязателен — сервер упадёт на дефолт МСК */
  }
  const r = await fetch(`${getApiBase()}/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      topics: [topic],
      tz,
      // Язык ИНТЕРФЕЙСА — то, на чём игрок читает игру прямо сейчас.
      lang: getCurrentLang(),
      // ⚠️ И ОТДЕЛЬНО язык БРАУЗЕРА, обязательно. У getCurrentLang() жёсткий
      // фолбэк "en": если селектор ещё не поднялся и выбора в localStorage нет,
      // подписка записала бы «англичанин» тому, у кого браузер русский, и пуш
      // ушёл бы не на том языке. Навигаторский язык — не догадка.
      browserLang: browserLanguage(),
      // Выбирал ли игрок язык САМ. Только тогда интерфейсный сильнее
      // навигаторского: иначе он всего лишь наш дефолт.
      langExplicit: langChosenExplicitly(),
      deviceId: getPersistentID(),
    }),
  });
  if (!r.ok) throw new Error(`push/subscribe ${r.status}`);
}

// ─────────────────────────── воронка кнопок ────────────────────────────────

/**
 * Событие воронки: увидел / ткнул / подписался (см. platform-api/pushStats.ts).
 *
 * ⚠️ ПОКАЗ ШЛЁТСЯ РАЗ ЗА СЕССИЮ НА ТИР. Кнопки живут в модалке лобби, которая
 * перерисовывается по таймеру отсчёта — без дедупа на сервер летела бы запись
 * каждую секунду, и «показы» перестали бы что-либо значить.
 *
 * ⚠️ Ключ дедупа — sessionStorage, а не поле класса: игрок за вечер открывает
 * и закрывает лобби десятки раз, каждый раз это НОВЫЙ экземпляр модалки.
 *
 * Отправка молчаливая и необязательная: это счётчик для дашборда, ронять из-за
 * него подписку нельзя.
 */
export type PushUiEvent =
  | "shown"
  | "bell_click"
  | "tg_click"
  | "subscribed"
  | "denied"
  | "unsubscribed";

export function reportPushUi(event: PushUiEvent, tier: string | null): void {
  try {
    if (event === "shown") {
      const key = `terron_push_shown_${tier ?? "none"}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    }
  } catch {
    /* приватный режим — тогда просто шлём, дубли не страшны */
  }
  try {
    void fetch(`${getApiBase()}/push/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        tier,
        deviceId: getPersistentID(),
        dev: isDevSite(),
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

// ─────────────────────────── инструкция после отказа ───────────────────────

export type BrowserGuide = { name: string; steps: string[] };

/**
 * Инструкция «как включить обратно» ДЛЯ ТЕКУЩЕГО браузера.
 *
 * ⚠️ Порядок проверок важен и обратный привычному: почти каждый движок пишет
 * в UA «Chrome» и «Safari». Сначала узкие маркеры (YaBrowser, Edg, OPR,
 * SamsungBrowser), потом Firefox, и только в конце Chrome/Safari — иначе
 * Яндекс.Браузеру (заметная доля РФ-аудитории) покажется чужая инструкция.
 */
export function browserGuide(ua = navigator.userAgent): BrowserGuide {
  const has = (s: string) => ua.includes(s);
  const android = has("Android");
  // iOS 13+ на iPad притворяется макбуком — ловим по тач-точкам.
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (has("Macintosh") &&
      typeof navigator !== "undefined" &&
      (navigator.maxTouchPoints ?? 0) > 1);
  const mobileTail = android
    ? L(
        "Вернись на вкладку и обнови страницу.",
        "Return to the tab and reload.",
      )
    : L("Обнови страницу.", "Reload the page.");

  // iOS — особый случай: пуши там работают ТОЛЬКО у установленной на «Домой»
  // веб-апки. В обычной вкладке Safari разрешения нет вовсе, и «включить» его
  // нельзя — нужно сперва установить.
  if (ios) {
    const standalone =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches ||
        (navigator as { standalone?: boolean }).standalone === true);
    if (!standalone) {
      return {
        name: "iOS",
        steps: [
          L(
            "Нажми «Поделиться» (квадрат со стрелкой) внизу Safari.",
            "Tap Share (the square with an arrow) at the bottom of Safari.",
          ),
          L(
            "Выбери «На экран «Домой»» и добавь TERRON.",
            'Choose "Add to Home Screen" and add TERRON.',
          ),
          L(
            "Открой игру с иконки на рабочем столе — уведомления работают только оттуда.",
            "Open the game from the home-screen icon — notifications only work there.",
          ),
          L(
            "Нажми колокольчик ещё раз и разреши уведомления.",
            "Tap the bell again and allow notifications.",
          ),
        ],
      };
    }
    return {
      name: "iOS",
      steps: [
        L("Открой «Настройки» телефона.", "Open the iPhone Settings app."),
        L(
          "Уведомления → TERRON → включи «Допуск уведомлений».",
          "Notifications → TERRON → turn on Allow Notifications.",
        ),
        L("Вернись в игру.", "Return to the game."),
      ],
    };
  }

  if (has("YaBrowser") || has("YaSearchBrowser")) {
    return {
      name: "Яндекс.Браузер",
      steps: android
        ? [
            L(
              "Нажми ⋮ справа от адресной строки.",
              "Tap ⋮ next to the address bar.",
            ),
            L(
              "Настройки → Сайты → Настройки сайтов → Уведомления.",
              "Settings → Sites → Site settings → Notifications.",
            ),
            L(
              "Найди terron.io и выбери «Разрешить».",
              'Find terron.io and pick "Allow".',
            ),
            mobileTail,
          ]
        : [
            L(
              "Нажми на замок слева в адресной строке.",
              "Click the lock icon on the left of the address bar.",
            ),
            L(
              "Найди «Уведомления» и переключи на «Разрешено».",
              'Find "Notifications" and switch it to "Allowed".',
            ),
            mobileTail,
          ],
    };
  }

  if (has("Edg/")) {
    return {
      name: "Microsoft Edge",
      steps: [
        L(
          "Нажми на замок слева в адресной строке.",
          "Click the lock icon on the left of the address bar.",
        ),
        L(
          "«Разрешения для этого сайта» → «Уведомления» → «Разрешить».",
          "Permissions for this site → Notifications → Allow.",
        ),
        mobileTail,
      ],
    };
  }

  if (has("OPR/") || has("Opera")) {
    return {
      name: "Opera",
      steps: [
        L(
          "Нажми на замок слева в адресной строке.",
          "Click the lock icon on the left of the address bar.",
        ),
        L(
          "«Настройки сайта» → «Уведомления» → «Разрешить».",
          "Site settings → Notifications → Allow.",
        ),
        mobileTail,
      ],
    };
  }

  if (has("SamsungBrowser")) {
    return {
      name: "Samsung Internet",
      steps: [
        L("Нажми ☰ внизу справа.", "Tap ☰ at the bottom right."),
        L(
          "Настройки → Сайты и загрузки → Уведомления → terron.io → «Разрешить».",
          "Settings → Sites and downloads → Notifications → terron.io → Allow.",
        ),
        mobileTail,
      ],
    };
  }

  if (has("Firefox") || has("FxiOS")) {
    return {
      name: "Firefox",
      steps: [
        L(
          "Нажми на замок слева в адресной строке.",
          "Click the lock icon on the left of the address bar.",
        ),
        L(
          "Убери «Заблокировано» у пункта «Отправка уведомлений».",
          'Remove the "Blocked" state from "Send Notifications".',
        ),
        mobileTail,
      ],
    };
  }

  // Safari на маке ловим ПОСЛЕ всех: строка Safari есть почти у всех движков.
  if (has("Safari") && !has("Chrome") && !has("Chromium")) {
    return {
      name: "Safari",
      steps: [
        L(
          "Меню Safari → «Настройки» → вкладка «Веб-сайты».",
          "Safari menu → Settings → Websites tab.",
        ),
        L(
          "Слева выбери «Уведомления», найди terron.io и поставь «Разрешить».",
          'Pick Notifications on the left, find terron.io and set it to "Allow".',
        ),
        mobileTail,
      ],
    };
  }

  // Chrome и всё остальное на его движке.
  return {
    name: android ? "Chrome (Android)" : "Chrome",
    steps: android
      ? [
          L(
            "Нажми ⋮ справа от адресной строки.",
            "Tap ⋮ next to the address bar.",
          ),
          L(
            "Настройки → Настройки сайтов → Уведомления.",
            "Settings → Site settings → Notifications.",
          ),
          L(
            "Найди terron.io и выбери «Разрешить».",
            'Find terron.io and pick "Allow".',
          ),
          mobileTail,
        ]
      : [
          L(
            "Нажми на замок слева в адресной строке.",
            "Click the lock icon on the left of the address bar.",
          ),
          L(
            "Найди «Уведомления» и переключи на «Разрешить».",
            'Find "Notifications" and switch it to "Allow".',
          ),
          mobileTail,
        ],
  };
}

/**
 * Модалка «как включить обратно». Обычный DOM в стиле `Toast.confirmDialog`:
 * нужна и на сайте, и поверх игрового HUD, где Lit-модалки сайта не живут.
 */
export function showPushHelp(guide: BrowserGuide = browserGuide()): void {
  const overlay = document.createElement("div");
  overlay.className = "terron-push-help";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:100001;display:flex;align-items:center;" +
    "justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(2px)";
  const card = document.createElement("div");
  card.style.cssText =
    "background:#fdfcf7;color:#2b2a24;border-radius:14px;padding:20px 22px;" +
    "max-width:min(92vw,440px);box-shadow:0 20px 60px rgba(0,0,0,.5);" +
    "font:500 14px/1.5 'Golos Text',system-ui,sans-serif";

  const title = document.createElement("div");
  title.textContent = L(
    "Уведомления заблокированы",
    "Notifications are blocked",
  );
  title.style.cssText = "font-weight:800;font-size:16px;margin-bottom:6px";

  const lead = document.createElement("div");
  lead.textContent = L(
    `Браузер больше не покажет запрос сам. Включить можно руками — ${guide.name}:`,
    `The browser will not ask again. You can turn it on manually — ${guide.name}:`,
  );
  lead.style.cssText = "color:#6b6759;font-size:13px;margin-bottom:12px";

  const list = document.createElement("ol");
  list.style.cssText = "margin:0 0 16px 18px;padding:0;display:grid;gap:6px";
  for (const step of guide.steps) {
    const li = document.createElement("li");
    li.textContent = step;
    list.appendChild(li);
  }

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:10px;justify-content:flex-end";
  const close = document.createElement("button");
  close.textContent = L("Понятно", "Got it");
  close.style.cssText =
    "padding:8px 16px;border:none;border-radius:9px;cursor:pointer;" +
    "font-weight:700;background:#2b2a24;color:#fdfcf7";

  const dismiss = () => {
    window.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") dismiss();
  };
  close.onclick = dismiss;
  overlay.onclick = (e) => {
    if (e.target === overlay) dismiss();
  };
  window.addEventListener("keydown", onKey, true);

  row.appendChild(close);
  card.append(title, lead, list, row);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

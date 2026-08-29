/**
 * terron 25.08: сторожа́ пуш-канала.
 *
 * Главный инвариант, ради которого тест и заведён: браузер даёт спросить
 * разрешение ОДИН РАЗ. Если код позовёт Notification.requestPermission у того,
 * кто уже отказал, мы сожжём вид «мы спросили» и не покажем инструкцию.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  browserGuide,
  enablePush,
  pushState,
  showNotifyButton,
  topicForTier,
  urlBase64ToUint8Array,
} from "../../src/client/PushNotify";

const UA = {
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36",
  yandex:
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 YaBrowser/24.1 Mobile Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0",
  firefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

/**
 * jsdom не знает ни PushManager, ни serviceWorker — без заглушек любой вызов
 * упирается в «браузер не умеет» и тест проверял бы только это.
 */
function setPermission(p: NotificationPermission) {
  (globalThis as unknown as { Notification: unknown }).Notification = {
    permission: p,
    requestPermission: vi.fn(async () => p),
  };
  (globalThis as unknown as { PushManager: unknown }).PushManager = class {};
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: vi.fn(async () => undefined) },
  });
}

describe("PushNotify: определение браузера для инструкции", () => {
  it("Яндекс.Браузер не путается с Chrome (в его UA есть оба слова)", () => {
    // Регресс: наивная проверка «есть Chrome» отправляла заметную долю
    // РФ-аудитории по чужой инструкции.
    expect(browserGuide(UA.yandex).name).toBe("Яндекс.Браузер");
    expect(browserGuide(UA.chromeAndroid).name).toContain("Chrome");
  });

  it("Edge не путается с Chrome", () => {
    expect(browserGuide(UA.edge).name).toBe("Microsoft Edge");
  });

  it("Firefox и Safari опознаются отдельно", () => {
    expect(browserGuide(UA.firefox).name).toBe("Firefox");
    expect(browserGuide(UA.safariMac).name).toBe("Safari");
  });

  it("iOS вне установленной веб-апки ведёт на «Домой», а не в настройки сайта", () => {
    // Пуши в Safari на iOS работают ТОЛЬКО у установленной PWA — совет
    // «разреши уведомления во вкладке» там невыполним.
    const g = browserGuide(UA.iphone);
    expect(g.name).toBe("iOS");
    expect(g.steps.join(" ")).toMatch(/Домой|Home Screen/);
  });

  it("у каждого браузера инструкция непустая", () => {
    for (const ua of Object.values(UA)) {
      const g = browserGuide(ua);
      expect(g.steps.length).toBeGreaterThan(1);
      expect(g.name.length).toBeGreaterThan(0);
    }
  });
});

describe("PushNotify: одноразовость системного запроса", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn();
  });

  it("после прошлого отказа НЕ зовёт requestPermission и не ходит на сервер", async () => {
    setPermission("denied");
    const notif = (
      globalThis as unknown as {
        Notification: { requestPermission: ReturnType<typeof vi.fn> };
      }
    ).Notification;
    const res = await enablePush("diamond");
    expect(res).toBe("denied");
    expect(notif.requestPermission).not.toHaveBeenCalled();
    // Ни одного запроса: конфиг тянуть незачем, подписаться всё равно нельзя.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("pushState отражает разрешение браузера", () => {
    setPermission("granted");
    expect(pushState()).toBe("granted");
    setPermission("denied");
    expect(pushState()).toBe("denied");
  });
});

describe("PushNotify: ключ сервера", () => {
  it("base64url разворачивается в байты (формат applicationServerKey)", () => {
    // '-' и '_' — алфавит base64url; обычный atob на них падает, а
    // PushManager принимает только Uint8Array.
    const bytes = urlBase64ToUint8Array("SGVsbG8t_w");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes.slice(0, 5))).toEqual([72, 101, 108, 108, 111]);
  });
});

describe("PushNotify: где висит колокольчик", () => {
  it("в любом СОБЫТИЙНОМ лобби — и золотом, и алмазном", () => {
    // terron 25.08, решение владельца: «во всех лобби пусть будет».
    expect(showNotifyButton("diamond", "default")).toBe(true);
    expect(showNotifyButton("golden", "default")).toBe(true);
  });

  it("в обычном лобби колокольчика нет — обещать нечего", () => {
    // ФФА/приватное живут десять секунд, расписания у них не существует:
    // подписка там обещала бы уведомление, которого не бывает.
    expect(showNotifyButton(null, "default")).toBe(false);
  });

  it("тексты колокольчика свои у каждого тира — иначе золотое лобби врёт", () => {
    // Поймано на живом деве: в ЗОЛОТОМ лобби кнопка была подписана «Напомнить
    // об АЛМАЗНОМ матче». Отдельные ключи, а не параметр: в русском тут четыре
    // разных падежа, подстановкой их не собрать.
    const ru = JSON.parse(
      readFileSync(join(__dirname, "../../resources/lang/ru.json"), "utf8"),
    ).push_notify;
    const en = JSON.parse(
      readFileSync(join(__dirname, "../../resources/lang/en.json"), "utf8"),
    ).push_notify;
    for (const base of ["on", "confirm_on", "confirm_off", "subscribed"]) {
      expect(ru[`${base}_golden`], `ru ${base}_golden`).toBeTruthy();
      expect(en[`${base}_golden`], `en ${base}_golden`).toBeTruthy();
      // золотой текст не должен упоминать алмаз, и наоборот
      expect(ru[`${base}_golden`]).not.toMatch(/алмаз/i);
      expect(ru[base]).not.toMatch(/золот/i);
    }
    // и лобби реально ходит за ними через тир
    const src = readFileSync(
      join(__dirname, "../../src/client/JoinLobbyModal.ts"),
      "utf8",
    );
    expect(src).toMatch(/eventTier\(\) === "golden" \? "_golden" : ""/);
  });

  it("тема подписки = тир лобби (пуш это обещание конкретной кнопки)", () => {
    expect(topicForTier("golden")).toBe("golden");
    expect(topicForTier("diamond")).toBe("diamond");
  });

  it("прячется там, где браузер не умеет уведомлений", () => {
    expect(showNotifyButton("diamond", "unsupported")).toBe(false);
  });

  it("после отказа кнопка ОСТАЁТСЯ — через неё показывается инструкция", () => {
    expect(showNotifyButton("diamond", "denied")).toBe(true);
  });

  it("внутри чужого iframe (площадка) колокольчика нет", () => {
    // Запрос разрешения из cross-origin iframe браузер блокирует — кнопка там
    // не смогла бы сработать вообще.
    expect(showNotifyButton("diamond", "default", true)).toBe(false);
    expect(showNotifyButton("diamond", "default", false)).toBe(true);
  });
});

describe("PushNotify: гейт площадки у ссылки на телегу", () => {
  it("иконка телеги помечена t-external-link и своей проверки не имеет", () => {
    // Прячет её ОДНО правило темы (html.gp-embed:not(.itch-embed)) — то же,
    // что у ссылок футера. Второй источник правды тут неминуемо разъедется:
    // модерация меняет требования, а правило правят в одном месте.
    const src = readFileSync(
      join(__dirname, "..", "..", "src/client/JoinLobbyModal.ts"),
      "utf8",
    );
    const btn = src.slice(
      src.indexOf("private renderTelegramButton()"),
      src.indexOf("private toggleNotify"),
    );
    expect(btn).toContain("t-external-link");
    // terron 25.08 (решение владельца): ведём на КАНАЛ, а не на бота — у бота
    // подписка есть только под алмазные матчи и живёт по-чатно, а канал один
    // на всё и одинаково работает из любого лобби.
    expect(btn).toContain("t.me/terron_io");
    expect(btn).not.toContain("TERRON_iobot");
    // и кнопка больше не заперта в алмазном лобби
    expect(btn).not.toContain('eventTier() !== "diamond") return ""');
    expect(btn).not.toContain("gp-embed");
  });
});

describe("PushNotify: воронка кнопок", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("показ шлётся ОДИН раз за сессию на тир", async () => {
    // Модалка лобби перерисовывается по таймеру отсчёта — без дедупа на сервер
    // летела бы запись каждую секунду, и «показы» перестали бы что-то значить.
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", f);
    const { reportPushUi } = await import("../../src/client/PushNotify");
    reportPushUi("shown", "diamond");
    reportPushUi("shown", "diamond");
    reportPushUi("shown", "diamond");
    expect(f).toHaveBeenCalledTimes(1);
    // другой тир — своя запись
    reportPushUi("shown", "golden");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("клики дедупом НЕ режутся — их считаем каждый", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", f);
    const { reportPushUi } = await import("../../src/client/PushNotify");
    reportPushUi("bell_click", "diamond");
    reportPushUi("bell_click", "diamond");
    reportPushUi("tg_click", "diamond");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("падение сети не роняет вызывающий код", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("no network");
      }),
    );
    const { reportPushUi } = await import("../../src/client/PushNotify");
    expect(() => reportPushUi("bell_click", "diamond")).not.toThrow();
  });
});

describe("подписка: язык", () => {
  it("шлём и язык интерфейса, и язык БРАУЗЕРА, и признак явного выбора", () => {
    // ⚠️ У getCurrentLang() жёсткий фолбэк "en": если селектор ещё не поднялся
    // и выбора в localStorage нет, подписка записала бы «англичанин» тому, у
    // кого браузер русский, и пуш ушёл бы не на том языке. Навигаторский язык —
    // не догадка, поэтому он обязателен.
    const src = readFileSync(
      join(__dirname, "..", "..", "src/client/PushNotify.ts"),
      "utf8",
    );
    const fn = src.slice(
      src.indexOf("async function sendSubscription("),
      src.indexOf("// ─────────────────────────── воронка кнопок"),
    );
    expect(fn).toContain("lang: getCurrentLang()");
    expect(fn).toContain("browserLang: browserLanguage()");
    expect(fn).toContain("langExplicit: langChosenExplicitly()");
    // навигаторский язык берётся у navigator, а не выводится из интерфейса
    expect(src).toMatch(/function browserLanguage[\s\S]{0,200}navigator\.language/);
    // «выбрал сам» = запись в localStorage.lang, а не факт непустого языка
    expect(src).toMatch(
      /function langChosenExplicitly[\s\S]{0,220}localStorage\.getItem\("lang"\)/,
    );
  });
});

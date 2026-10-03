// terron 09.09: ПОЧЕМУ ВХОД С ТЕЛЕФОНА ДЛИЛСЯ ДЕСЯТЬ СЕКУНД, А С КОМПА — НОЛЬ.
//
// Сессии сайта и каталога площадки разведены ИМЕНЕМ КУКИ, а какая это площадка —
// знает только её SDK. Поэтому первый запрос сессии ждёт SDK. На десктопе тот
// поднимается быстро и всё мгновенно; в WebView приложения первые секунды сеть
// мертва, ожидание упиралось в потолок 2.5 с, запрос уходил БЕЗ заголовка →
// сервер читал сайтовую куку → 401 → игрок «гость» → полный круг входа.
//
// Три правки: помним площадку между запусками, ждём её дольше (промах дороже
// ожидания), а если всё же промахнулись — переспрашиваем сессию.
import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const CACHE_KEY = "terron_platform_ctx";

function onPlatform(yes: boolean) {
  document.documentElement.classList.toggle("gp-embed", yes);
}

describe("площадка помнится между запусками", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    onPlatform(false);
  });

  it("запомненная площадка переживает перезапуск приложения", async () => {
    // localStorage, а не sessionStorage: в приложении ВК каждый запуск —
    // новая сессия вкладки, и кэш терялся ровно там, где он нужен.
    const m = await import("../../src/client/PlatformContext");
    m.setPlatformContext("VK");
    expect(localStorage.getItem(CACHE_KEY)).toBe("VK");

    vi.resetModules();
    const fresh = await import("../../src/client/PlatformContext");
    onPlatform(true);
    expect(fresh.platformContext()).toBe("VK");
  });

  it("вне площадки запомненное НЕ применяется", async () => {
    // Иначе сессия обычного terron.io уехала бы в платформенную куку —
    // ровно то разделение, ради которого всё делалось.
    localStorage.setItem(CACHE_KEY, "VK");
    const m = await import("../../src/client/PlatformContext");
    onPlatform(false);
    expect(m.platformContext()).toBeNull();
    expect(m.platformAuthHeaders()).toEqual({});
  });

  it("на площадке заголовок проставляется", async () => {
    localStorage.setItem(CACHE_KEY, "VK");
    const m = await import("../../src/client/PlatformContext");
    onPlatform(true);
    expect(m.platformAuthHeaders()).toEqual({ "X-Terron-Platform": "VK" });
  });

  it("узнав площадку, сообщает об этом — сессию могли спросить раньше", async () => {
    const m = await import("../../src/client/PlatformContext");
    const seen: string[] = [];
    window.addEventListener("terron-platform-ctx", () => seen.push("ok"));
    m.setPlatformContext("YANDEX");
    expect(seen.length).toBe(1);
    m.setPlatformContext("YANDEX"); // то же самое — второй раз не шумим
    expect(seen.length).toBe(1);
  });

  it("мусор и песочница NONE площадкой не считаются", async () => {
    const m = await import("../../src/client/PlatformContext");
    onPlatform(true);
    m.setPlatformContext("NONE");
    expect(m.platformContext()).toBeNull();
  });
});

describe("ожидание площадки дороже не ждать (потолок)", () => {
  it("потолок больше прежних 2.5 секунды", () => {
    const src = read("../../src/client/PlatformContext.ts");
    const m = src.match(/WAIT_MS_PLATFORM = (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(2500);
  });

  it("промах мимо куки взводит повтор запроса сессии", () => {
    const src = read("../../src/client/Auth.ts");
    const fn = src.slice(src.indexOf("async function doRefreshJwt"));
    expect(fn).toContain("armContextRetry()");
    // Повтор нужен ровно тогда, когда заголовка не было, а мы на площадке.
    expect(fn).toContain("Object.keys(headers).length === 0 && isPlatformSurface()");
    expect(src).toContain('window.addEventListener(\n    "terron-platform-ctx"');
  });
});

describe("повтор загрузки картинки работает внутри <picture>", () => {
  it("пересобирает и <source>, иначе браузер в сеть не идёт", async () => {
    vi.useFakeTimers();
    try {
      const { installImgRetry } = await import("../../src/client/ImgRetry");
      installImgRetry(document);

      const picture = document.createElement("picture");
      const source = document.createElement("source");
      source.setAttribute("srcset", "/_assets/map-sm.abc123.webp");
      const img = document.createElement("img");
      img.setAttribute("src", "/_assets/map.abc123.webp");
      picture.append(source, img);
      document.body.append(picture);

      // Наблюдаем ФАКТ пересборки атрибутов: просто «srcset на месте» ничего не
      // доказывает — он на месте и когда повтора не было вовсе.
      const seen: string[] = [];
      const origRemove = source.removeAttribute.bind(source);
      source.removeAttribute = (n: string) => {
        seen.push("source:remove:" + n);
        origRemove(n);
      };
      const origSet = source.setAttribute.bind(source);
      source.setAttribute = (n: string, v: string) => {
        seen.push("source:set:" + n);
        origSet(n, v);
      };
      const origImgSet = img.setAttribute.bind(img);
      img.setAttribute = (n: string, v: string) => {
        seen.push("img:set:" + n);
        origImgSet(n, v);
      };

      img.dispatchEvent(new Event("error", { bubbles: false }));
      // ⚠️ Первый повтор обязан быть быстрым: полторы секунды пустой рамки на
      // первом экране читаются как «игра сломалась».
      vi.advanceTimersByTime(500);

      expect(seen).toContain("source:remove:srcset");
      expect(seen).toContain("source:set:srcset");
      expect(seen).toContain("img:set:src");
      expect(source.getAttribute("srcset")).toBe("/_assets/map-sm.abc123.webp");
      expect(img.getAttribute("src")).toBe("/_assets/map.abc123.webp");
    } finally {
      vi.useRealTimers();
      document.body.innerHTML = "";
    }
  });

  it("чужие домены не трогаем", async () => {
    vi.useFakeTimers();
    try {
      const { installImgRetry } = await import("../../src/client/ImgRetry");
      installImgRetry(document);
      const img = document.createElement("img");
      img.setAttribute("src", "https://example.com/pic.png");
      document.body.append(img);
      img.dispatchEvent(new Event("error"));
      vi.advanceTimersByTime(5000);
      expect(img.dataset.retry).toBeUndefined();
    } finally {
      vi.useRealTimers();
      document.body.innerHTML = "";
    }
  });
});

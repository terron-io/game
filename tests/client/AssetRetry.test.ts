// terron 02.09: АССЕТЫ ПЕРЕЖИВАЮТ МЁРТВУЮ СЕТЬ ПЕРВЫХ СЕКУНД.
//
// Зонд полосы по телефону владельца в приложении ВК: сразу после запуска
// WebView сеть не отвечает целиком, и всё, что грузится по манифесту, падало
// навсегда — превью карт и флаг «битой картинкой», словарь пустой. Три рубежа:
// словарь догружается до успеха (LangSelector), картинки повторяются
// делегированным обработчиком (ImgRetry), а service worker повторяет сетевой
// сбой на ассете вместо мгновенной ошибки.
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

describe("словарь догружается до успеха", () => {
  const src = read("src/client/LangSelector.ts");
  it("после пустой первой загрузки запускается фоновая догрузка", () => {
    const init = src.slice(
      src.indexOf("this.defaultTranslations = defaultTranslations;"),
      src.indexOf("static notifyLangLoaded"),
    );
    expect(init).toMatch(
      /Object\.keys\(translations\)\.length === 0[\s\S]*?this\.retryUntilLoaded\(userLang/,
    );
  });
  it("догрузка слушает online и возврат вкладки — так сеть в WebView и оживает", () => {
    const body = src.slice(src.indexOf("private retryUntilLoaded("));
    expect(body).toContain('window.addEventListener("online", kick)');
    expect(body).toContain('document.addEventListener("visibilitychange", onVisible)');
    expect(body).toMatch(/const delays = \[2000, 4000, 8000/);
  });
  it("отказ смены языка тоже догружает, а не бросает навсегда", () => {
    const body = src.slice(
      src.indexOf("private async changeLanguage("),
      src.indexOf("private applyTranslation("),
    );
    expect(body).toContain("this.retryUntilLoaded(lang");
  });
});

describe("fetch словаря не может висеть вечно", () => {
  const src = read("src/client/LangSelector.ts");
  it("каждая попытка идёт с AbortController и потолком ожидания", () => {
    const body = src.slice(
      src.indexOf("private async loadLanguage("),
      src.indexOf("private async loadLanguageList("),
    );
    // Без сигнала первая попытка в WebView площадки висела вечно — ни повторов,
    // ни догрузки, init не завершался (скрины владельца: картинки есть, слов нет).
    expect(body).toMatch(/const ctl = new AbortController\(\)/);
    expect(body).toMatch(/fetch\(url, \{ signal: ctl\.signal \}\)/);
    expect(body).toMatch(/ctl\.abort\("timeout"\),\s*LANG_FETCH_TIMEOUT_MS/);
    expect(src).toMatch(/const LANG_FETCH_TIMEOUT_MS = \d{4};/);
  });
  it("финальная неудача шлёт датчик с причиной, и его знают три места", () => {
    expect(src).toMatch(/reportHealth\(\s*"lang_load_failed",\s*`\$\{lang\} \$\{describeLangError\(lastErr\)\}`,?\s*\)/);
    expect(read("src/client/Health.ts")).toContain('"lang_load_failed"');
    expect(read("../platform-api/src/clientHealth.ts").split('"lang_load_failed"').length - 1).toBe(2);
  });
});

describe("диагностика сырых ключей с устройства", () => {
  it("зонд стоит в Main и его kind знают три места", () => {
    expect(read("src/client/Main.ts")).toContain("installLangStateProbe()");
    const probe = read("src/client/LangStateProbe.ts");
    expect(probe).toMatch(/reportHealth\(\s*"lang_state"/);
    // молчит, когда всё в порядке — иначе это поток, а не датчик
    expect(probe).toMatch(/if \(!raw && tCount > 0\) return;/);
    expect(read("src/client/Health.ts")).toContain('"lang_state"');
    expect(read("../platform-api/src/clientHealth.ts").split('"lang_state"').length - 1).toBe(2);
  });
});

describe("картинки по манифесту повторяются", () => {
  it("Main ставит делегированный обработчик", () => {
    expect(read("src/client/Main.ts")).toContain("installImgRetry()");
  });

  it("упавший <img> со своим ассетом получает повтор, чужой — нет", async () => {
    vi.useFakeTimers();
    const { installImgRetry } = await import("../../src/client/ImgRetry");
    installImgRetry(document);
    const own = document.createElement("img");
    own.setAttribute("src", "/_assets/maps/japan.abc123.webp");
    document.body.appendChild(own);
    own.dispatchEvent(new Event("error"));
    expect(own.dataset.retry).toBe("1");
    own.removeAttribute("src");
    vi.advanceTimersByTime(1600);
    expect(own.getAttribute("src")).toBe("/_assets/maps/japan.abc123.webp");

    const foreign = document.createElement("img");
    foreign.setAttribute("src", "https://cdn.example.com/x.png");
    document.body.appendChild(foreign);
    foreign.dispatchEvent(new Event("error"));
    expect(foreign.dataset.retry).toBeUndefined();

    // потолок повторов: после четырёх — тишина
    // ⚠️ terron 09.09: попыток стало 4 (первая быстрая, 400 мс) — в WebView
    // площадки сеть первых секунд мертва, а пустая рамка на первом экране
    // читается как «игра сломалась».
    own.dataset.retry = "4";
    own.dispatchEvent(new Event("error"));
    expect(own.dataset.retry).toBe("4");
    vi.useRealTimers();
  });
});

describe("service worker повторяет сетевой сбой на ассете", () => {
  const sw = read("resources/sw.js");
  it("статика идёт через fetchWithRetry, а не голый fetch", () => {
    const body = sw.slice(
      sw.indexOf("// Статика оболочки"),
      sw.indexOf("ПУШ-УВЕДОМЛЕНИЯ"),
    );
    expect(body).toContain("fetchWithRetry(req)");
    expect(body).not.toMatch(/const network = fetch\(req\)/);
    expect(body).toMatch(/const ASSET_RETRY_MS = \[\d+, \d+\]/);
  });
  it("навигация НЕ тронута — там свой network-first с офлайн-фолбэком", () => {
    const nav = sw.slice(sw.indexOf("if (isNavigation) {"), sw.indexOf("// Статика оболочки"));
    expect(nav).toContain("const fresh = await fetch(req);");
    expect(nav).not.toContain("fetchWithRetry");
  });
});

// terron 10.09: третий заход Яндекса — GamePush прислал ссылку на требования
// (yandex.ru/dev/games/doc/ru/concepts/requirements). Решения владельца:
// зал славы на Яндексе не показывать; атрибуция на «авторстве» — текстом, не
// ссылкой (условие лицензии остаётся); под кнопкой входа — список «что даёт аккаунт» (1.2.1).
import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

async function ctx() {
  vi.resetModules();
  return await import("../../src/client/PlatformContext");
}

describe("класс площадки на <html> (gp-platform-<тип>)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.className = "";
  });

  it("ставится по типу из SDK и меняется при смене площадки", async () => {
    document.documentElement.classList.add("gp-embed");
    const m = await ctx();
    m.setPlatformContext("YANDEX");
    expect(document.documentElement.classList.contains("gp-platform-yandex")).toBe(true);
    m.setPlatformContext("VK");
    expect(document.documentElement.classList.contains("gp-platform-vk")).toBe(true);
    expect(document.documentElement.classList.contains("gp-platform-yandex")).toBe(false);
  });

  it("на втором запуске ставится из кэша синхронно, без SDK", async () => {
    document.documentElement.classList.add("gp-embed");
    localStorage.setItem("terron_platform_ctx", "YANDEX");
    const m = await ctx();
    expect(m.platformContext()).toBe("YANDEX");
    expect(document.documentElement.classList.contains("gp-platform-yandex")).toBe(true);
  });

  it("вне площадки класса нет даже при кэше", async () => {
    localStorage.setItem("terron_platform_ctx", "YANDEX");
    const m = await ctx();
    expect(m.platformContext()).toBeNull();
    expect(document.documentElement.className).not.toContain("gp-platform-");
  });
});

describe("зал славы на Яндексе спрятан (8.4.2)", () => {
  it("тема прячет ссылку в футере и страницу по классу площадки", () => {
    const css = read("src/client/styles/terron-theme.css");
    expect(css).toMatch(
      /html\.gp-platform-yandex \.t-glory-link,\s*html\.gp-platform-yandex \[data-page="page-hall-of-fame"\],\s*html\.gp-platform-yandex #page-hall-of-fame \{\s*display: none !important;/,
    );
    const footer = code("src/client/components/Footer.ts");
    expect(footer).toMatch(/href="\/glory"\s*class="[^"]*\bt-glory-link\b/);
  });

  it("страница сама отказывает по прямому адресу", () => {
    const src = code("src/client/HallOfFamePage.ts");
    // terron 28.09: гейт вынесен в gloryHiddenHere() (любая площадка + список).
    expect(src).toMatch(/if \(gloryHiddenHere\(\)\) \{\s*return html`/);
    expect(src).toMatch(/GLORY_HIDDEN_ON\.has\(platformContext\(\) \?\? ""\)/);
    // terron 17.09: ВК отклонил за ссылки в зале славы; ОК — то же приложение.
    for (const p of ["YANDEX", "VK", "OK"]) {
      expect(src).toMatch(new RegExp(`GLORY_HIDDEN_ON[^;]*"${p}"`));
    }
    const css = read("src/client/styles/terron-theme.css");
    for (const p of ["vk", "ok"]) {
      expect(css).toContain(`html.gp-platform-${p} .t-glory-link`);
      expect(css).toContain(`html.gp-platform-${p} #page-hall-of-fame`);
    }
  });
});

describe("атрибуция на площадке — текстом, не ссылкой", () => {
  it("CopyrightsPage.a() внутри площадки отдаёт span без href", () => {
    const src = code("src/client/CopyrightsPage.ts");
    expect(src).toMatch(
      /private a\(href: string, text: string\): TemplateResult \{\s*if \(onPlatformSurface\(\)\) \{\s*return html`<span class="t-link"[^`]*>\$\{text\}<\/span>`;/,
    );
  });
});

describe("вход на площадке объясняет, что даёт аккаунт (1.2.1)", () => {
  it("список «что даёт аккаунт» стоит рядом с карточкой входа площадки (renderLoginOptions)", () => {
    // 11.09: дубль под кнопкой убран — список и так в левой колонке того же экрана
    const src = code("src/client/AccountSettings.ts");
    const i = src.indexOf("private renderLoginOptions()");
    const j = src.indexOf("private renderPlatformLogin()");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, j)).toContain("this.renderBenefits()");
  });
});

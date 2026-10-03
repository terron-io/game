// terron 09.09: второй заход модерации Яндекса по НОВОМУ билду —
// «ссылки и название на английском» (шапка, вики, зал славы, статистика,
// соглашение) и «не полный перевод» («Нация Beijing победила!»).
// Правило Яндекса 5.1.3: имя игры одинаково везде — «ТЕРРОН.ио» по-русски.
import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

async function fresh() {
  vi.resetModules();
  return await import("../../src/client/Utils");
}

describe("имя игры внутри площадки = имя в каталоге", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("gp-embed");
  });

  it("вне площадки бренд не трогается (решение владельца: на terron.io латиница)", async () => {
    localStorage.setItem("lang", "ru");
    const u = await fresh();
    expect(u.brandText("Бой в TERRON — это")).toBe("Бой в TERRON — это");
    expect(u.brandName()).toBe("TERRON");
    expect(u.L("вики TERRON", "TERRON wiki")).toBe("вики TERRON");
  });

  it("на площадке по-русски — «ТЕРРОН.ио», и L() это делает сам", async () => {
    document.documentElement.classList.add("gp-embed");
    localStorage.setItem("lang", "ru");
    const u = await fresh();
    expect(u.L("Бой в TERRON — это", "Combat in TERRON is")).toBe(
      "Бой в ТЕРРОН.ио — это",
    );
    // «TERRON.io» не удваивается в «ТЕРРОН.ио.io»
    expect(u.brandText("сервис TERRON.io и TERRON")).toBe(
      "сервис ТЕРРОН.ио и ТЕРРОН.ио",
    );
    // строчные адреса — не имя, их не трогаем
    expect(u.brandText("terron.io/account/delete")).toBe(
      "terron.io/account/delete",
    );
    // часть другого слова — не бренд
    expect(u.brandText("TERRONIA")).toBe("TERRONIA");
  });

  it("на площадке по-английски — «TERRON.io»", async () => {
    document.documentElement.classList.add("gp-embed");
    localStorage.setItem("lang", "en");
    const u = await fresh();
    expect(u.L("вики TERRON", "TERRON wiki")).toBe("TERRON.io wiki");
    expect(u.brandText("TERRON.io wiki")).toBe("TERRON.io wiki");
  });

  it("translateText подменяет бренд, кроме штампа декора", () => {
    const src = code("src/client/Utils.ts");
    // подмена стоит на ВЫХОДЕ translateText, а не в одной из веток
    expect(src).toMatch(
      /const out = translateTextRaw\(key, params\);\s*return key === "main\.decor_brand" \? out : brandText\(out\);/,
    );
  });
});

describe("«не полный перевод»: имя нации-победителя локализуется", () => {
  it("экран победы и лента золотого матча прогоняют имя нации через localizeAIName", () => {
    const win = code("src/client/hud/layers/WinModal.ts");
    expect(win).toMatch(
      /"win_modal\.nation_won",\s*\{\s*nation:\s*localizeAIName\(wu\.winner\[1\]\)/,
    );
    const feed = code("src/client/hud/layers/EventsDisplay.ts");
    expect(feed).toContain("name = localizeAIName(String(wu.winner[1]))");
    expect(feed).not.toContain("name = String(wu.winner[1])");
  });
});

describe("шапка: логотип перерисовывается, когда словарь доехал", () => {
  for (const f of [
    "src/client/components/MobileNavBar.ts",
    "src/client/components/DesktopNavBar.ts",
  ]) {
    it(`${f.split("/").pop()} слушает terron-lang-loaded`, () => {
      const src = code(f);
      expect(src).toMatch(
        /addEventListener\("terron-lang-loaded", this\._onNavPaths\)/,
      );
      expect(src).toMatch(
        /removeEventListener\("terron-lang-loaded", this\._onNavPaths\)/,
      );
    });
  }
});

describe("«ссылки»: чужие домены и адреса не показываются внутри площадки", () => {
  it("вкладка «Трафик» статистики (таблица доменов-источников) скрыта на площадке", () => {
    const src = code("src/client/StatsPage.ts");
    expect(src).toMatch(/onPlatformSurface\(\)\s*\?\s*""\s*:\s*this\.pill\(this\.view === "traffic"/);
    // и deep-link /stats/traffic не откроет таблицу
    expect(src).toMatch(
      /onPlatformSurface\(\) && this\.view === "traffic" \? "charts" : this\.view/,
    );
  });

  it("адрес страницы удаления аккаунта в соглашении внутри площадки — словами", () => {
    const src = code("src/client/LegalModal.ts");
    expect(src).toMatch(/\/account\\\/delete\$\/\.test\(href\)/);
  });

  it("страница валют не пишет бренд мимо L()", () => {
    const src = code("src/client/CurrencyPage.ts");
    expect(src).not.toMatch(/\bTERRON\b/);
    expect(src).toContain("${brandName()}");
  });
});

// terron 11.09: превью экрана входа «как на площадке» в тест-режиме
// (`?embed=1&platform=…`): SDK там не поднят, настоящий экран падал в почтовый
// вход — владелец не видел, как это будет на площадке.
import { html, render } from "lit";
import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function boot(url: string, embed = true) {
  vi.resetModules();
  window.history.replaceState(null, "", url);
  document.documentElement.className = embed ? "gp-embed" : "";
  (window as Window & { __platformLaunch?: boolean }).__platformLaunch = false;
  localStorage.setItem("lang", "ru");
  return await import("../../src/client/PlatformLoginPreview");
}

describe("превью платформенного входа", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = "<div id='host'></div>";
  });

  it("Яндекс: кнопки выключены, развилка описывает автовход и Яндекс ID", async () => {
    const m = await boot("/?embed=1&platform=yandex");
    const tpl = m.platformLoginPreview(html`<i id="b"></i>`);
    expect(tpl).not.toBeNull();
    render(tpl!, document.getElementById("host")!);
    const btns = [...document.querySelectorAll("button")];
    expect(btns.length).toBe(2);
    expect(btns.every((b) => b.disabled)).toBe(true);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Войти через Яндекс Игры");
    expect(text).toContain("поднимется сам при загрузке");
    expect(text).toContain("Яндекс ID");
    expect(document.getElementById("b")).not.toBeNull(); // список «что даёт» на месте
  });

  it("площадка без автовхода описывается иначе", async () => {
    const m = await boot("/?embed=1&platform=crazy_games");
    render(m.platformLoginPreview(html``)!, document.getElementById("host")!);
    const text = document.body.textContent ?? "";
    expect(text).toContain("тихого автовхода нет");
    expect(text).not.toContain("поднимется сам");
  });

  it("вне тест-режима превью нет — настоящий экран не задет", async () => {
    const m = await boot("/?platform=yandex", false);
    expect(m.platformLoginPreview(html``)).toBeNull();
  });

  it("AccountSettings ставит превью ПЕРВЫМ и не дублирует «что даёт аккаунт» под кнопкой", () => {
    const src = readFileSync("src/client/AccountSettings.ts", "utf8");
    expect(src).toMatch(
      /private renderLoginOptions\(\): TemplateResult \{[\s\S]{0,400}const preview = platformLoginPreview\(this\.renderBenefits\(\)\);\s*if \(preview\) return preview;/,
    );
    const i = src.indexOf("private renderPlatformLogin()");
    const j = src.indexOf("private async handlePlatformLogin");
    expect(src.slice(i, j)).not.toContain("this.renderBenefits()");
  });
});

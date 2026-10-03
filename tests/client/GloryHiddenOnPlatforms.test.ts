// terron 28.09: веб-ВК снова отклонил игру за ссылки в зале славы — класс
// gp-platform-vk там не встал, и раздел остался виден. Решение владельца: внутри
// ЛЮБОЙ площадки раздела нет вовсе (ни ссылки в футере, ни страницы), а ссылки
// на людей рисуются только на самом сайте.
import { readFileSync } from "fs";
import { afterEach, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

// Модуль грузим ОДИН раз: повторный импорт заново регистрирует custom element.
// Обе функции читают живой класс на <html>, поэтому класс переключаем в тесте.
let mod: typeof import("../../src/client/HallOfFamePage") | null = null;
async function load() {
  mod ??= await import("../../src/client/HallOfFamePage");
  return mod;
}

describe("зал славы на площадках", () => {
  afterEach(() => {
    document.documentElement.className = "";
  });

  it("в кадре площадки (gp-embed) раздел спрятан и без ссылок — даже без типа площадки", async () => {
    document.documentElement.classList.add("gp-embed");
    const m = await load();
    expect(m.gloryHiddenHere()).toBe(true);
    expect(m.gloryLinksAllowed()).toBe(false);
  });

  it("на самом сайте раздел и ссылки на месте", async () => {
    const m = await load();
    expect(m.gloryHiddenHere()).toBe(false);
    expect(m.gloryLinksAllowed()).toBe(true);
  });

  it("тема прячет ссылку в футере и страницу в любом кадре площадки", () => {
    const css = read("src/client/styles/terron-theme.css");
    expect(css).toMatch(
      /html\.gp-embed \.t-glory-link,\s*html\.gp-embed \[data-page="page-hall-of-fame"\],\s*html\.gp-embed #page-hall-of-fame,/,
    );
    // itch тоже площадка: исключения :not(.itch-embed) у зала славы быть не должно
    expect(css).not.toMatch(/gp-embed:not\(\.itch-embed\) \.t-glory-link/);
  });

  it("карточка рисует ссылку только при gloryLinksAllowed()", () => {
    const src = read("src/client/HallOfFamePage.ts");
    expect(src).toMatch(/h\.url && gloryLinksAllowed\(\)\s*\?\s*html`<a/);
  });
});

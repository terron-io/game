import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, test } from "vitest";
import { isKnownSpaRoute } from "../../src/server/RenderHtml";

// terron 25.08 (находка соседней вкладки): /ults отдавал 404 ПРЯМЫМ заходом —
// маршрут был зарегистрирован в клиенте (ModalRouter.register), но отсутствовал
// в белом списке сервера (SPA_SEGMENTS в RenderHtml.ts). Шелл при этом
// рисовался, поэтому баг не бросался в глаза изнутри приложения — ломались
// именно ССЫЛКИ: отправить страницу другому человеку было нельзя.
//
// Так разъехалось у ДЕВЯТИ страниц сразу (ults, money, ranked, clan-create,
// clan-edit, profile, admin-*). Этот сторож держит инвариант: каждый
// register("x") в Main.ts обязан быть известным маршрутом сервера.
// Обратный прогон: убери "ults" из SPA_SEGMENTS — тест краснеет.
const MAIN_TS = join(__dirname, "../../src/client/Main.ts");

function registeredRoutes(): string[] {
  const src = readFileSync(MAIN_TS, "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/register\("([a-z0-9_-]+)"/g)) out.add(m[1]);
  return [...out];
}

describe("SPA-маршруты: клиент ↔ сервер", () => {
  test("каждый register() в Main.ts известен серверу", () => {
    const routes = registeredRoutes();
    // Санити: парсер что-то нашёл (иначе тест зеленел бы впустую).
    expect(routes.length).toBeGreaterThan(20);
    const missing = routes.filter((r) => !isKnownSpaRoute("/" + r));
    expect(missing, `нет в SPA_SEGMENTS: ${missing.join(", ")}`).toEqual([]);
  });

  test("страницы дерева ульт и кошелька открываются по прямой ссылке", () => {
    for (const p of ["/ults", "/money", "/shop", "/wiki"]) {
      expect(isKnownSpaRoute(p), p).toBe(true);
    }
  });

  // terron 26.08: /ults/stats — публичная таблица винрейта ульт. Вкладок у
  // страницы две, обе ссылками, и обе копируются игроками в чат.
  test("вкладки страницы ульт открываются по прямой ссылке", () => {
    for (const p of ["/ults", "/ults/stats", "/shop/history"]) {
      expect(isKnownSpaRoute(p), p).toBe(true);
    }
  });

  test("ссылки-приглашения событийных лобби отдают страницу, а не 404", () => {
    // ⚠️ Мимо теста выше они проходят НЕЗАМЕТНО: тот сверяет список с
    // `modalRouter.register()`, а лобби-модалки намеренно не регистрируются —
    // адрес они правят сами. Отсюда и баг: `/gold` и `/diamond` — постоянные
    // ссылки из кнопки «Позвать друзей» — сервер отдавал с 404, и превью
    // ссылки в телеграме/чатах не строилось.
    for (const p of ["/gold", "/diamond"]) {
      expect(isKnownSpaRoute(p), p).toBe(true);
    }
  });

  test("каждая статья вики открывается по прямой ссылке", () => {
    // ⚠️ Класс бага тот же, что у /gold: ДВА списка, поддерживаемых руками.
    // Список известных слагов строился из ключей WIKI_SEO (там курированные
    // title/description, их 13), а статей в вики 36 — и дерево ульт рисует
    // ссылку на каждую. Итог: 25 живых страниц отдавали 404 на проде.
    // Слаги читаем ПРЯМО ИЗ КОНТЕНТА, поэтому забытая статья валит гейт.
    const content = readFileSync(
      join(__dirname, "../../src/client/WikiContent.ts"),
      "utf8",
    );
    const slugs = [...content.matchAll(/slug:\s*"([a-z0-9_]+)"/g)].map(
      (m) => m[1],
    );
    // Санити: парсер что-то нашёл (иначе тест зеленел бы впустую).
    expect(slugs.length).toBeGreaterThan(25);
    const missing = slugs.filter((s) => !isKnownSpaRoute(`/wiki/ult/${s}`));
    expect(missing, `отдают 404: ${missing.join(", ")}`).toEqual([]);
  });

  test("мусорный путь по-прежнему 404 (сторож не открыл всё подряд)", () => {
    for (const p of ["/нетакойстраницы", "/wiki/ult/фигня", "/game/xx"]) {
      expect(isKnownSpaRoute(p), p).toBe(false);
    }
  });
});

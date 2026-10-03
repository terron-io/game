// terron 09.09: ВТОРОЙ ЗАХОД ПО ЗАМЕЧАНИЯМ ВК (владелец прошёл демо на телефоне).
//
// Что чинится этими сторожами:
//  1) битое превью карты на первой загрузке (WebView площадки роняет первые
//     запросы — вместо карты значок «битая картинка»);
//  2) вход на телефоне занимал ~10 секунд (десктоп мгновенно) — ждали ДВАЖДЫ:
//     и клиент, и сервер внутри каждой его попытки;
//  3) экран аккаунта показывал три состояния подряд («не плавно»);
//  4) «ВЫ НЕ АВТОРИЗОВАНЫ» у ВОШЕДШЕГО игрока — признак входа спрашивал про
//     Discord/почту, которых у игрока с площадки нет никогда;
//  5) вкладка «Приглашения» внутри площадки убрана целиком.
//
// ⚠️ Комментарии регуляркой НЕ срезаем: в ProfilePage/GameModeSelector шаблонные
// строки содержат `*/`, и «срез» выкусывает живой код (грабля 08.09). Ищем то,
// чего в комментарии быть не может.
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import { isSignedIn } from "../../src/client/Api";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("признак «вошёл» не зависит от Discord/почты (пункт 4)", () => {
  it("игрок с площадки (без почты и Discord) считается вошедшим", () => {
    // Ровно случай владельца: аккаунт #1400, вход через VK, ни почты, ни Discord.
    const me = { user: {}, player: { publicId: "x" } } as never;
    expect(isSignedIn(me)).toBe(true);
  });

  it("аноним — не вошёл", () => {
    expect(isSignedIn(false)).toBe(false);
  });

  it("старого имени hasLinkedAccount в коде не осталось", () => {
    // Имя врало о смысле — оно и завело нас в этот баг. ⚠️ Ищем КОД, а не
    // упоминание: слово законно стоит в комментарии рядом с новой функцией
    // (первая версия сторожа краснела на нём же).
    const api = read("../../src/client/Api.ts");
    expect(api).not.toMatch(/export function hasLinkedAccount/);
    expect(api).not.toMatch(/\bhasLinkedAccount\(/);
  });
});

describe("плашка «не авторизован» знает состояние без события (пункт 4)", () => {
  const src = read("../../src/client/components/NotLoggedInWarning.ts");

  it("спрашивает состояние сама при подключении", () => {
    // Событие userMeResponse улетает один раз на старте страницы: модалка
    // открывается позже и его уже не застаёт.
    const fn = src.slice(src.indexOf("connectedCallback()"));
    expect(fn).toContain("getUserMe()");
  });

  it("внутри площадки плашки нет вовсе", () => {
    const render = src.slice(src.indexOf("  render() {"));
    expect(render).toContain("if (onPlatformSurface()) return html``;");
    // Гейт площадки обязан стоять ПЕРВЫМ: иначе аноним на площадке всё равно
    // увидит красное «не авторизованы» — ровно замечание модерации.
    expect(render.indexOf("onPlatformSurface()")).toBeLessThan(
      render.indexOf("this.signedIn"),
    );
  });

  it("не тянет фасад PlatformHost — его нет в прод-дереве", () => {
    expect(src).not.toMatch(/from "\.\.\/PlatformHost"/);
  });
});

describe("вкладки «Приглашения» внутри площадки нет (пункт 5)", () => {
  const src = read("../../src/client/ProfilePage.ts");

  it("вкладка добавляется только вне площадки", () => {
    expect(src).toContain('if (this.own && !onPlatformSurface())');
  });

  it("deep-link не воскрешает спрятанную вкладку", () => {
    expect(src).toContain('(want === "invites" && !onPlatformSurface())');
  });
});

describe("превью карты не показывает «битую картинку» (пункт 1)", () => {
  const src = read("../../src/client/GameModeSelector.ts");

  it("обе карточки держат <img> прозрачным до загрузки", () => {
    const hidden = src.match(/opacity:0;transition:opacity/g) ?? [];
    expect(hidden.length).toBe(2);
  });

  it("картинка проявляется по load и гаснет по error", () => {
    expect((src.match(/@load=\$\{/g) ?? []).length).toBe(2);
    expect((src.match(/@error=\$\{/g) ?? []).length).toBe(2);
  });
});

describe("экран аккаунта не мигает тремя состояниями (пункт 1, «не плавно»)", () => {
  const src = read("../../src/client/AccountSettings.ts");

  it("на площадке вместо голого «Загрузка…» рисуется каркас входа", () => {
    const render = src.slice(src.indexOf("render(): TemplateResult"));
    const head = render.slice(0, render.indexOf('this.view === "delete"'));
    expect(head).toContain("onPlatformSurface()");
    expect(head).toContain("this.renderLoginOptions()");
  });

  it("спиннер «Входим…» покрывает и загрузку профиля", () => {
    // Иначе между «Загрузка…» и аккаунтом мелькает кнопка «Войти».
    expect(src).toContain(
      "if (this.loading || this.platformLoggingIn || platformLoginPending())",
    );
  });
});

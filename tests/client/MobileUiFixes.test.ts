import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(join(__dirname, "..", "..", rel), "utf8");

describe("шестерня настроек в мобильной шторке", () => {
  it("осветление в ночном режиме привязано к ДЕСКТОПНОЙ шапке", () => {
    // Правило осветляет шестерню, потому что десктопная шапка лежит поверх
    // затемнённой страницы. Мобильная шторка в ночном режиме остаётся СВЕТЛЫМ
    // листом — без привязки к поверхности шестерня там пропадала совсем
    // (#ece5d2 на #efe6c8). Репорт: «иконка настроек в бургере пропала».
    const css = read("src/client/styles/terron-theme.css");
    const dimGear = css
      .split("\n")
      .filter((l) => l.includes(".terron-dim") && l.includes("nav-gear"));
    expect(dimGear.length).toBeGreaterThan(0);
    for (const line of dimGear) {
      expect(line).toContain("desktop-nav-bar");
    }
  });
});

describe("вкладки досье на узком экране", () => {
  it("полоса скроллится, а пункты не сжимаются", () => {
    // На СВОЁМ досье вкладок шесть (у чужого три — потому баг и не был виден
    // со стороны): на 375px они требуют ~437px. Без overflow-x доскроллить до
    // «Приглашений» было нечем, а без flex:0 0 auto flex рвал слова.
    const src = read("src/client/ProfilePage.ts");
    const tabs = src.slice(
      src.indexOf("private renderTabs()"),
      src.indexOf("private renderTab()"),
    );
    expect(tabs).toContain("overflow-x:auto");
    expect(tabs).toContain("flex:0 0 auto");
    expect(tabs).toContain("white-space:nowrap");
  });
});

describe("пресенс: снятие при выходе", () => {
  it("Content-Type не ставится, когда тела нет", () => {
    // Fastify отбивает 400 на пустое тело с json-заголовком, из-за чего
    // /me/presence/leave (он без тела) не срабатывал НИКОГДА — друзья видели
    // игрока в лобби, пока запись не истечёт сама.
    const src = read("src/client/FriendsPresence.ts");
    const post = src.slice(
      src.indexOf("async function post("),
      src.indexOf("/** Сообщить"),
    );
    expect(post).toContain("headers: body");
    // безусловного json-заголовка быть не должно
    expect(post).not.toMatch(
      /headers:\s*\{\s*"Content-Type": "application\/json"/,
    );
  });
});

describe("лобби: явное сворачивание", () => {
  it("кнопка «Свернуть» есть и идёт через showPage, а не minimize() напрямую", () => {
    // Окно лобби — это .page-content: спрятать его, не показав ничего вместо,
    // значит оставить игрока на пустом экране. showPage сам вызовет minimize()
    // по гейту prefersMinimize — путь тот же, что у ухода по меню.
    const src = read("src/client/JoinLobbyModal.ts");
    const row = src.slice(
      src.indexOf("private renderLeaveRow()"),
      src.indexOf("private renderPrivateStartControls()"),
    );
    expect(row).toContain("minimizeToSite");
    expect(row).toContain("Свернуть");
    const fn = src.slice(
      src.indexOf("private minimizeToSite()"),
      src.indexOf("private minimizeToSite()") + 400,
    );
    expect(fn).toContain('showPage?.("page-play")');
    expect(fn).not.toContain("this.minimize()");
  });
});

describe("Dockerfile: карты не раздувают образ", () => {
  it("карты сносятся в build-стадии, а resources берётся оттуда", () => {
    // Слои неизменяемы: `COPY resources` + поздний `rm -rf resources/maps`
    // оставлял 362 МБ мёртвого слоя в КАЖДОМ образе игры — из-за этого 30 ГБ
    // диска кончались за день сборок, а на пике сборки прод падал в ENOSPC
    // и терял запись ходов живых матчей.
    const df = read("Dockerfile");
    expect(df).toContain("COPY --from=build /usr/src/app/resources ./resources");
    // финальная стадия НЕ должна копировать resources напрямую
    const finalStage = df.slice(df.lastIndexOf("FROM base"));
    expect(finalStage).not.toMatch(/^COPY resources \.\/resources/m);
    // и не должна удалять карты у себя (там это бесполезно)
    expect(finalStage).not.toContain("rm -rf ./resources/maps");
    // а build-стадия — должна
    const buildStage = df.slice(
      df.indexOf("FROM base AS build"),
      df.indexOf("FROM base AS prod-deps"),
    );
    expect(buildStage).toContain("rm -rf ./resources/maps");
  });
});

describe("кнопки лобби: иконки и различимость", () => {
  it("у каждой кнопки своя иконка и свой оттенок", () => {
    // Оттенок намеренно почти незаметен (8% прозрачности): подсказывает «одно
    // безопасно, другое нет», но не делает из подвала лобби светофор.
    const src = read("src/client/JoinLobbyModal.ts");
    const row = src.slice(
      src.indexOf("private renderLeaveRow()"),
      src.indexOf("private minimizeToSite()"),
    );
    expect(row).toContain("amber-300/[0.08]");
    expect(row).toContain("red-400/[0.08]");
    expect((row.match(/<svg/g) ?? []).length).toBe(2);
  });
});

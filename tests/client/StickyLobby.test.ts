// terron 25.08: ЛИПКОЕ ЛОББИ — переход по сайту НЕ выбрасывает из лобби.
//
// Репорт игрока 25.08: «пока в лобби ждёшь, хочется онлайн чекнуть или вики;
// по привычке жму command+клик, а оно не открывает вкладку и из лобби
// выбрасывает». Причина была одна на все пути: любой уход со страницы закрывал
// окно лобби (`showPage` / «одна модалка за раз»), а `close()` окна лобби шлёт
// `leave-lobby` — то есть реально покидает очередь.
//
// Здесь заперты ровно те инварианты, которые это чинят. Все три проверены
// обратным прогоном (вернул close() вместо minimize() — краснеют).
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinLobbyModal } from "../../src/client/JoinLobbyModal";

const src = (p: string) =>
  fs.readFileSync(path.join(__dirname, "../../src/client", p), "utf8");

describe("Липкое лобби: сворачиваем, а не выходим", () => {
  afterEach(() => vi.restoreAllMocks());

  it("свёрнутое окно НЕ шлёт leave-lobby", () => {
    const modal = new JoinLobbyModal();
    (modal as any).currentLobbyId = "g1";
    (modal as any).isModalOpen = true;
    const dispatched: string[] = [];
    vi.spyOn(modal, "dispatchEvent").mockImplementation((e: Event) => {
      dispatched.push(e.type);
      return true;
    });

    modal.minimize();

    expect(dispatched).not.toContain("leave-lobby");
    // ...и мы всё ещё в лобби: id не сброшен, окно только спрятано.
    expect((modal as any).currentLobbyId).toBe("g1");
    expect((modal as any).minimized).toBe(true);
  });

  it("выход из лобби по-прежнему шлёт leave-lobby", () => {
    const modal = new JoinLobbyModal();
    (modal as any).currentLobbyId = "g1";
    (modal as any).isModalOpen = true;
    const dispatched: string[] = [];
    vi.spyOn(modal, "dispatchEvent").mockImplementation((e: Event) => {
      dispatched.push(e.type);
      return true;
    });

    modal.leaveFromDock();

    expect(dispatched).toContain("leave-lobby");
  });

  it("выход правит адрес ПОСЛЕ close (иначе его затрёт закрытая страница)", () => {
    // Выйти можно с плашки, стоя на /rating: close() закрывает ту страницу, а
    // её modalRouter.syncClosed() восстанавливает «путь под ней» — адрес лобби.
    // Поймано вживую на деве: вышел из алмазного, в строке остался /diamond.
    const modal = new JoinLobbyModal();
    (modal as any).currentLobbyId = "g1";
    (modal as any).isModalOpen = true;
    const order: string[] = [];
    vi.spyOn(modal as any, "updateHistory").mockImplementation(() =>
      order.push("url"),
    );
    vi.spyOn(modal, "close").mockImplementation(() => order.push("close"));
    vi.spyOn(modal, "dispatchEvent").mockImplementation(() => true);

    modal.closeAndLeave();

    expect(order).toEqual(["close", "url"]);
  });

  it("окно в лобби просит сворачивать себя, без лобби — нет", () => {
    const modal = new JoinLobbyModal();
    (modal as any).currentLobbyId = "";
    expect(modal.prefersMinimize()).toBe(false);
    (modal as any).currentLobbyId = "g1";
    expect(modal.prefersMinimize()).toBe(true);
  });

  it("сторожа́ лобби работают и у свёрнутого окна", () => {
    // checkStuckLobby/checkForJoinTimeout гейтились видимостью окна. Свернули
    // окно — зависшее лобби перестало бы лечиться, а игрок висел бы в мёртвой
    // очереди, пока не вернётся на вкладку лобби.
    const modal = new JoinLobbyModal();
    (modal as any).isModalOpen = false;
    (modal as any).minimized = true;
    expect((modal as any).lobbySessionLive()).toBe(true);
    (modal as any).minimized = false;
    expect((modal as any).lobbySessionLive()).toBe(false);
  });

  it("разворот НЕ пересоздаёт лобби (onOpen не должен сработать)", () => {
    // Поймано вживую: вернулся в СВОЁ лобби из «Рейтинга» — сменился id, то
    // есть HostLobbyModal.onOpen создал новое, а старое осиротело. Причина:
    // restore() зовёт showPage(), а тот открывает целевую inline-модалку.
    const modal = new JoinLobbyModal();
    (modal as any).inline = true;
    (modal as any).currentLobbyId = "g1";
    (modal as any).isModalOpen = true;
    const onOpen = vi.spyOn(modal as any, "onOpen");
    // Настоящий showPage (Navigation.ts) открывает целевую inline-модалку —
    // без этого тест не воспроизводит баг вовсе.
    (window as any).showPage = (id: string) => {
      if (id === (modal.id || modal.tagName.toLowerCase())) modal.open();
    };

    modal.minimize();
    modal.restore();
    delete (window as any).showPage;

    expect(onOpen).not.toHaveBeenCalled();
    expect((modal as any).minimized).toBe(false);
  });

  it("навигация по сайту сворачивает лобби, а не закрывает", () => {
    const nav = src("Navigation.ts");
    expect(nav).toMatch(/prefersMinimize\?\.\(\)\s*&&\s*m\.minimize/);
  });

  it("«одна модалка за раз» сворачивает лобби, а не закрывает", () => {
    const base = src("components/BaseModal.ts");
    expect(base).toMatch(/if \(m\.prefersMinimize\(\)\) m\.minimize\(\);/);
  });

  it("перехватчик ссылок площадки не трогает пункты меню", () => {
    // Иначе softGo шлёт leave-lobby и внутри площадки липкость отменяется.
    expect(src("SoftNavigate.ts")).toMatch(
      /link\.closest\(["'`]\.nav-menu-item\[data-page\]["'`]\)\) return;/,
    );
  });

  it("пункты меню — настоящие ссылки (cmd+клик = новая вкладка)", () => {
    for (const f of [
      "components/DesktopNavBar.ts",
      "components/MobileNavBar.ts",
    ]) {
      const s = src(f);
      expect(s).toMatch(/href=\$\{navPath\("page-/);
      // ни одного пункта меню, оставшегося кнопкой
      expect(s).not.toMatch(/<button[^>]*data-page=/s);
    }
    // и обычный клик по-прежнему наш — без перезагрузки страницы
    expect(src("Navigation.ts")).toMatch(
      /e\.preventDefault\(\);\s*\n\s*showPage\(pageId\);/,
    );
  });
});

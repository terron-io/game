/**
 * @vitest-environment jsdom
 */
// terron 26.09: F5 в СВОЁМ приватном лобби (репорт владельца: «создал лобби,
// нажал F5 — попадаю как обычный клиент, лобби навсегда мёртвое»). Сервер
// узнаёт создателя по persistentID, и права после F5 остаются — терял их клиент.
// Сторожим: окно входа, узнав, что мы создатель приватного лобби, закрывается
// БЕЗ выхода (уход хоста закрыл бы лобби всем) и зовёт хост-окно на то же лобби;
// чужое лобби и публичное — не трогаем; хост-окно в режиме возврата не создаёт
// новое лобби.
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinLobbyModal } from "../../src/client/JoinLobbyModal";
import { GameType } from "../../src/core/game/Game";

afterEach(() => vi.restoreAllMocks());

function setup(gameType: GameType) {
  const modal = new JoinLobbyModal();
  (modal as any).currentLobbyId = "g1";
  (modal as any).isModalOpen = true;
  (modal as any).gameConfig = { gameType };
  const dispatched: string[] = [];
  vi.spyOn(modal, "dispatchEvent").mockImplementation((e: Event) => {
    dispatched.push(e.type);
    return true;
  });
  const resumed: string[] = [];
  const onResume = (e: Event) =>
    resumed.push((e as CustomEvent).detail.gameID);
  document.addEventListener("resume-host-lobby", onResume);
  return {
    modal,
    dispatched,
    resumed,
    done: () => document.removeEventListener("resume-host-lobby", onResume),
  };
}

describe("возврат хоста после F5", () => {
  it("создатель приватного лобби уходит в хост-окно без выхода из лобби", () => {
    const t = setup(GameType.Private);
    (t.modal as any).maybeHandOffToHost(
      { gameID: "g1", lobbyCreatorClientID: "me" },
      "me",
    );
    t.done();
    expect(t.resumed).toEqual(["g1"]);
    expect(t.dispatched).not.toContain("leave-lobby");
  });

  it("чужое лобби и публичное — остаёмся обычным игроком", () => {
    const a = setup(GameType.Private);
    (a.modal as any).maybeHandOffToHost(
      { gameID: "g1", lobbyCreatorClientID: "host" },
      "me",
    );
    a.done();
    expect(a.resumed).toEqual([]);
    const b = setup(GameType.Public);
    (b.modal as any).maybeHandOffToHost(
      { gameID: "g1", lobbyCreatorClientID: "me" },
      "me",
    );
    b.done();
    expect(b.resumed).toEqual([]);
  });

  it("передача — один раз на вход в лобби", () => {
    const t = setup(GameType.Private);
    const info = { gameID: "g1", lobbyCreatorClientID: "me" };
    (t.modal as any).maybeHandOffToHost(info, "me");
    (t.modal as any).maybeHandOffToHost(info, "me");
    t.done();
    expect(t.resumed).toEqual(["g1"]);
  });

  it("хост-окно в режиме возврата не создаёт новое лобби и не шлёт join-lobby", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/client/HostLobbyModal.ts"),
      "utf8",
    );
    const init = src.slice(src.indexOf("private initOnlineLobby("));
    const resume = init.slice(0, init.indexOf("this.lobbyId = generateID();"));
    expect(resume).toContain("args.resumeLobbyId");
    expect(resume).toMatch(/return;\s*\}\s*$/);
    expect(resume).not.toContain("createLobby(");
    const main = fs.readFileSync(
      path.join(__dirname, "../../src/client/Main.ts"),
      "utf8",
    );
    const listener = main.slice(main.indexOf('"resume-host-lobby", (e)'));
    const body = listener.slice(0, listener.indexOf("resumeLobbyId"));
    expect(body.length).toBeGreaterThan(0);
    // showPage открыл бы окно без аргументов, и оно создало бы новое лобби
    expect(body).not.toMatch(/showPage\?\.\(/);
  });
});

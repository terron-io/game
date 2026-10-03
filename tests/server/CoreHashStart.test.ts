// terron 28.09: сервер помнит отпечаток ядра, на котором создан матч, и шлёт его
// в старте; после выката новой сборки добавляет и текущий отпечаток сервера.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerStartGameMessageSchema } from "../../src/core/Schemas";
import { GameServer } from "../../src/server/GameServer";
import { ServerEnv } from "../../src/server/ServerEnv";

function makeGame() {
  const log: any = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const game = new GameServer("test-game", log, 12345, {
    gameType: "Private",
  } as any);
  (game as any).wireGameStartInfo = {
    gameID: "test-game",
    config: { a: 1 },
    players: [],
  };
  return game;
}

function startFor(game: GameServer) {
  const ws = { readyState: 1, OPEN: 1, send: vi.fn() } as any;
  game.activeClients.push({
    clientID: "c1",
    persistentID: "p1",
    ws,
    hashes: new Map(),
    lastPing: Date.now(),
  } as any);
  (game as any).sendStartGameMsg(ws, 0);
  return JSON.parse(ws.send.mock.calls[0][0]);
}

afterEach(() => vi.restoreAllMocks());

describe("отпечаток ядра в старте матча", () => {
  it("матч запоминает отпечаток на момент создания", () => {
    vi.spyOn(ServerEnv, "coreHash").mockReturnValue("aaaa1111aaaa1111");
    const game = makeGame();
    const msg = startFor(game);
    expect(msg.coreHash).toBe("aaaa1111aaaa1111");
    expect(msg.serverCoreHash).toBeUndefined();
    // старые клиенты лишние поля отбросят (схема не strict), новые — примут
    expect(ServerStartGameMessageSchema.shape.coreHash).toBeDefined();
    expect(ServerStartGameMessageSchema.shape.serverCoreHash).toBeDefined();
  });

  it("после выката: отпечаток матча прежний, текущий сервера — отдельным полем", () => {
    const spy = vi
      .spyOn(ServerEnv, "coreHash")
      .mockReturnValue("aaaa1111aaaa1111");
    const game = makeGame();
    spy.mockReturnValue("bbbb2222bbbb2222");
    const msg = startFor(game);
    expect(msg.coreHash).toBe("aaaa1111aaaa1111");
    expect(msg.serverCoreHash).toBe("bbbb2222bbbb2222");
  });

  it("резюм из снимка берёт отпечаток снимка, а не текущего образа", () => {
    vi.spyOn(ServerEnv, "coreHash").mockReturnValue("bbbb2222bbbb2222");
    const game = makeGame();
    const meta = (game as any).buildPersistMeta();
    expect(meta.coreHash).toBe("bbbb2222bbbb2222");
    meta.coreHash = "aaaa1111aaaa1111";
    meta.clients = [];
    meta.kickedPersistentIds = [];
    game.hydrate(meta, []);
    (game as any).wireGameStartInfo = { gameID: "test-game", players: [] };
    const msg = startFor(game);
    expect(msg.coreHash).toBe("aaaa1111aaaa1111");
    expect(msg.serverCoreHash).toBe("bbbb2222bbbb2222");
    game.end?.();
  });

  it("нет файла отпечатка — полей нет, сообщение прежнее", () => {
    vi.spyOn(ServerEnv, "coreHash").mockReturnValue(null);
    const msg = startFor(makeGame());
    expect("coreHash" in msg).toBe(false);
  });
});

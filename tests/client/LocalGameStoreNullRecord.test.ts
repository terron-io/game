// terron 28.09: пустые записи (null) в IndexedDB ломали список «Продолжить» и
// чистку — js_error «Cannot read properties of null (reading 'savedAt')».
// Бросок шёл внутри onsuccess, мимо try/catch, и промис не резолвился вовсе.
// Подставная база с таким мусором: список обязан вернуть живые партии, а
// чистка — удалить мусор по ключу.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = [string, unknown];

function fakeIndexedDb(rows: Row[]) {
  const deleted: string[] = [];
  const later = (fn: () => void) => setTimeout(fn, 0);
  const request = <T>(result: T) => {
    const r: {
      result: T;
      onsuccess: null | (() => void);
      onerror: null | (() => void);
    } = { result, onsuccess: null, onerror: null };
    later(() => r.onsuccess?.());
    return r;
  };
  const store = {
    getAll: () => request(rows.map((r) => r[1])),
    getAllKeys: () => request(rows.map((r) => r[0])),
    get: (k: string) => request(rows.find((r) => r[0] === k)?.[1]),
    delete: (k: string) => {
      deleted.push(k);
      return request(undefined);
    },
    put: () => request(undefined),
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => store }),
  };
  const idb = {
    open: () => {
      const r: {
        result: typeof db;
        onsuccess: null | (() => void);
        onupgradeneeded: null | (() => void);
        onerror: null | (() => void);
        onblocked: null | (() => void);
      } = {
        result: db,
        onsuccess: null,
        onupgradeneeded: null,
        onerror: null,
        onblocked: null,
      };
      later(() => r.onsuccess?.());
      return r;
    },
  };
  return { idb, deleted };
}

const good = (id: string, savedAt: number) => ({
  gameID: id,
  gameStartInfo: { config: { gameMap: "World" } },
  turns: [{}, {}],
  playerName: "x",
  playerClanTag: null,
  savedAt,
});

describe("LocalGameStore: пустые записи в базе", () => {
  let deleted: string[];
  beforeEach(() => {
    vi.resetModules();
    const now = Date.now();
    const fake = fakeIndexedDb([
      ["aaa", good("aaa", now - 1000)],
      ["broken-null", null],
      ["broken-shape", { gameID: "broken-shape" }],
      ["bbb", good("bbb", now - 500)],
    ]);
    deleted = fake.deleted;
    vi.stubGlobal("indexedDB", fake.idb);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("список «Продолжить» не падает и отдаёт живые партии", async () => {
    const { listLocalGames } = await import(
      "../../src/client/LocalGameStore"
    );
    const list = await listLocalGames();
    expect(list.map((g) => g.gameID)).toEqual(["bbb", "aaa"]);
  });

  it("чистка удаляет мусор по ключу и не трогает живые", async () => {
    const { pruneLocalGames } = await import("../../src/client/LocalGameStore");
    await pruneLocalGames();
    expect(deleted.sort()).toEqual(["broken-null", "broken-shape"]);
  });

  it("битая запись по id — как отсутствующая", async () => {
    const { loadLocalGame } = await import("../../src/client/LocalGameStore");
    expect(await loadLocalGame("broken-null")).toBeNull();
    expect((await loadLocalGame("aaa"))?.gameID).toBe("aaa");
  });
});

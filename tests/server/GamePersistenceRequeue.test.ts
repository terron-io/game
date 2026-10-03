// terron 29.09: 28.09 при 96 % диска одна запись ходов упала с ENOSPC, и партия
// ходов всех идущих матчей пропала (выбрасывалась). Теперь недописанное
// возвращается в очередь в прежнем порядке, а загрузчик переживает огрызок строки.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "terron-requeue-"));
  process.env.GAME_PERSIST = "1";
  process.env.GAME_PERSIST_DIR = dir;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.GAME_PERSIST;
  delete process.env.GAME_PERSIST_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const turn = (n: number) => JSON.stringify({ turnNumber: n, intents: [] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("сбой записи ходов", () => {
  it("партия не теряется: после сбоя ходы дописываются по порядку", async () => {
    const P = await import("../../src/server/GamePersistence");
    const log = join(dir, "AAAAAAAA.turns.ndjson");
    // Запись упадёт (EISDIR): на месте файла лога — каталог. Как ENOSPC, только
    // без порчи диска.
    mkdirSync(log);
    P.persistTurn("AAAAAAAA", turn(0));
    P.persistTurn("AAAAAAAA", turn(1));
    await wait(500); // первый флаш — упал
    rmSync(log, { recursive: true, force: true }); // «место освободилось»
    P.persistTurn("AAAAAAAA", turn(2)); // новый ход, пока ждём повтора
    await wait(2800); // повтор
    const raw = readFileSync(log, "utf8");
    expect(P.parseTurnLog(raw).map((t) => t.turnNumber)).toEqual([0, 1, 2]);
  }, 10_000);
});

describe("загрузчик лога", () => {
  it("огрызок строки пропускается, повторы отбрасываются", async () => {
    const P = await import("../../src/server/GamePersistence");
    const raw = [turn(0), '{"turnNu', turn(1), turn(1), turn(2)].join("\n");
    expect(P.parseTurnLog(raw).map((t) => t.turnNumber)).toEqual([0, 1, 2]);
  });
  it("на дыре в номерах останавливается", async () => {
    const P = await import("../../src/server/GamePersistence");
    const raw = [turn(0), turn(1), turn(3), turn(4)].join("\n");
    expect(P.parseTurnLog(raw).map((t) => t.turnNumber)).toEqual([0, 1]);
  });
});

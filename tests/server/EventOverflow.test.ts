// terron 28.09: алмазное забилось и стартовало на 12 с раньше слота, мастер
// создал новое на ТОТ ЖЕ слот — через секунду второй «алмазный» ушёл в матч с
// одним игроком (репорт tomsrn). Теперь новое лобби ждёт +10 минут.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setDiamondEveningOff,
  setDiamondEvery,
  setGoldenPeriodMin,
} from "../../src/core/configuration/TerronTuning";
import {
  goldenAvoidingOverflow,
  slotAfterEarlyStart,
  TERRON_EVENT_OVERFLOW_MIN,
} from "../../src/server/EventOverflow";
import { MasterLobbyService } from "../../src/server/MasterLobbyService";

vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn() }) },
}));
vi.mock("../../src/server/PollingLoop", () => ({ startPolling: vi.fn() }));

const MIN = 60_000;
const SLOT = Date.UTC(2026, 8, 28, 16, 0, 0); // 19:00 МСК
const noFair = () => {
  throw new Error("fair не нужен");
};

beforeEach(() => {
  setDiamondEvery(60);
  setGoldenPeriodMin(10);
  setDiamondEveningOff();
});
afterEach(() => vi.useRealTimers());

describe("slotAfterEarlyStart", () => {
  it("алмазное ушло раньше слота — дубль на +10 минут", () => {
    expect(slotAfterEarlyStart("diamond", SLOT, SLOT - 12_000, noFair)).toBe(
      SLOT + TERRON_EVENT_OVERFLOW_MIN * MIN,
    );
  });

  it("стартовало вовремя — обычное расписание", () => {
    expect(slotAfterEarlyStart("diamond", SLOT, SLOT + 800, noFair)).toBeNull();
    expect(
      slotAfterEarlyStart("diamond", undefined, SLOT - 12_000, noFair),
    ).toBeNull();
  });

  it("дубль тоже забился — ещё +10, но не впритык к следующему часу", () => {
    const d2 = SLOT + 10 * MIN;
    expect(slotAfterEarlyStart("diamond", d2, d2 - 5_000, noFair)).toBe(
      SLOT + 20 * MIN,
    );
    const d5 = SLOT + 50 * MIN;
    expect(slotAfterEarlyStart("diamond", d5, d5 - 5_000, noFair)).toBe(
      SLOT + 60 * MIN,
    );
  });

  it("золотое ушло раньше — следующий золотой слот, а не тот же", () => {
    const g = SLOT + 20 * MIN;
    expect(slotAfterEarlyStart("golden", g, g - 3_000, noFair)).toBe(
      SLOT + 30 * MIN,
    );
  });

  it("золотой отходит от дубль-лобби алмазного", () => {
    expect(goldenAvoidingOverflow(SLOT + 10 * MIN, SLOT + 10 * MIN)).toBe(
      SLOT + 20 * MIN,
    );
    expect(goldenAvoidingOverflow(SLOT + 30 * MIN, SLOT + 10 * MIN)).toBe(
      SLOT + 30 * MIN,
    );
    expect(goldenAvoidingOverflow(SLOT + 10 * MIN, undefined)).toBe(
      SLOT + 10 * MIN,
    );
  });
});

describe("мастер: сценарий 28.09", () => {
  function master() {
    const sent: any[] = [];
    const playlist = {
      gameConfig: vi.fn(async () => ({ gameMap: "World" })),
    } as any;
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any;
    const m = new MasterLobbyService(playlist, log) as any;
    m.sendMessageToWorker = (msg: any) => sent.push(msg);
    return { m, sent };
  }
  const lobby = (startsAt: number, numClients = 11) => ({
    gameID: "LWkQS1Vo",
    numClients,
    startsAt,
    gameConfig: {},
  });

  it("забилось в 18:59:48 → новое лобби на 19:10, и мастер его не сдвигает", async () => {
    vi.useFakeTimers();
    const { m, sent } = master();

    vi.setSystemTime(SLOT - 20_000);
    await m.maintainEventLobby("diamond", [lobby(SLOT)]);

    vi.setSystemTime(SLOT - 12_000); // лобби ушло в матч
    await m.maintainEventLobby("diamond", []);
    const created = sent.find((x) => x.type === "createGame");
    expect(created).toBeTruthy();

    // первое обновление нового лобби ставит ему время дубля
    vi.setSystemTime(SLOT - 9_000);
    await m.maintainEventLobby("diamond", [
      { gameID: created.gameID, numClients: 0, startsAt: undefined },
    ]);
    const upd = sent.filter((x) => x.type === "updateLobby").pop();
    expect(upd.startsAt).toBe(SLOT + 10 * MIN);

    // в 19:05 мастер не тянет его обратно к расписанию (19:00 / 20:00)
    const before = sent.length;
    vi.setSystemTime(SLOT + 5 * MIN);
    await m.maintainEventLobby("diamond", [
      { gameID: created.gameID, numClients: 3, startsAt: SLOT + 10 * MIN },
    ]);
    expect(sent.length).toBe(before);

    // золотой на 19:10 уезжает на 19:20
    await m.maintainEventLobby("golden", [
      { gameID: "gold1", numClients: 0, startsAt: SLOT + 10 * MIN },
    ]);
    const g = sent.filter((x) => x.type === "updateLobby").pop();
    expect(g.gameID).toBe("gold1");
    expect(g.startsAt).toBe(SLOT + 20 * MIN);
  });

  it("стартовало вовремя → следующее лобби на следующий час", async () => {
    vi.useFakeTimers();
    const { m, sent } = master();
    vi.setSystemTime(SLOT - 5_000);
    await m.maintainEventLobby("diamond", [lobby(SLOT)]);
    vi.setSystemTime(SLOT + 800);
    await m.maintainEventLobby("diamond", []);
    const created = sent.find((x) => x.type === "createGame");
    vi.setSystemTime(SLOT + 3_000);
    await m.maintainEventLobby("diamond", [
      { gameID: created.gameID, numClients: 0, startsAt: undefined },
    ]);
    expect(sent.filter((x) => x.type === "updateLobby").pop().startsAt).toBe(
      SLOT + 60 * MIN,
    );
  });
});

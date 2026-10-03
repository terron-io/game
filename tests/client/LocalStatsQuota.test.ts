/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { startGame } from "../../src/client/LocalPersistantStats";

// terron 04.09: запись «game-records» росла по объекту на каждый матч и
// упиралась в квоту localStorage — QuotaExceededError летел из setTimeout
// необработанным (js_error, 3 сессии за 3 дня). Теперь при отказе старшая
// половина записей выбрасывается и запись повторяется.
describe("LocalPersistantStats quota", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("quota error drops the oldest half and retries", () => {
    localStorage.setItem(
      "game-records",
      JSON.stringify({
        g1: { lobby: {} },
        g2: { lobby: {} },
        g3: { lobby: {} },
        g4: { lobby: {} },
      }),
    );
    const real = Storage.prototype.setItem;
    let calls = 0;
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, k: string, v: string) {
        calls++;
        if (calls === 1) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        return real.call(this, k, v);
      });

    startGame("g5", {});
    vi.runAllTimers();

    expect(spy).toHaveBeenCalledTimes(2);
    const stored = JSON.parse(localStorage.getItem("game-records") ?? "{}");
    const ids = Object.keys(stored);
    // из пяти записей выброшены три старшие, свежая осталась
    expect(ids).toEqual(["g4", "g5"]);
  });

  test("corrupt record does not throw", () => {
    localStorage.setItem("game-records", "{not json");
    expect(() => startGame("g1", {})).not.toThrow();
    vi.runAllTimers();
    expect(
      Object.keys(JSON.parse(localStorage.getItem("game-records")!)),
    ).toEqual(["g1"]);
  });
});

// terron 28.09: алмазный забивался на маленькой карте (Milky Way, 11 мест) за
// минуту до старта — остальные пролетали. Теперь у алмазного только карты от
// TERRON_DIAMOND_MIN_PLAYERS мест и лимит лобби всегда крупный, не случайный.
import { describe, expect, it, vi } from "vitest";
import {
  MapPlaylist,
  TERRON_DIAMOND_MIN_PLAYERS,
} from "../../src/server/MapPlaylist";

vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) },
}));

describe("алмазный: только вместительные карты", () => {
  it("40 лобби подряд — у каждого лимит не меньше порога", async () => {
    const p = new MapPlaylist();
    for (let i = 0; i < 40; i++) {
      const c = await p.gameConfig("diamond");
      expect(c.maxPlayers ?? 0).toBeGreaterThanOrEqual(
        TERRON_DIAMOND_MIN_PLAYERS,
      );
    }
  });

  it("у обычного ффа лимит по-прежнему случайный и бывает меньше", async () => {
    const p = new MapPlaylist();
    let small = 0;
    for (let i = 0; i < 60; i++) {
      const c = await p.gameConfig("ffa");
      if ((c.maxPlayers ?? 0) < TERRON_DIAMOND_MIN_PLAYERS) small++;
    }
    expect(small).toBeGreaterThan(0);
  });
});

// terron 02.10: минута перемирия между людьми в алмазном (запрос беты: «съедают в
// первые секунды с двух вкладок»). Золотой и обычные лобби — прежние 5 с.
import { describe, expect, it } from "vitest";
import {
  MapPlaylist,
  TERRON_DIAMOND_PVP_TRUCE_SECONDS,
} from "../../src/server/MapPlaylist";

describe("перемирие в алмазном", () => {
  it("алмазный — 60 секунд иммунитета людей после спавна", async () => {
    const c = await new MapPlaylist().gameConfig("diamond");
    expect(TERRON_DIAMOND_PVP_TRUCE_SECONDS).toBe(60);
    expect(c.spawnImmunityDuration).toBe(600);
  });
  it("золотой — прежние 5 секунд", async () => {
    expect((await new MapPlaylist().gameConfig("golden")).spawnImmunityDuration).toBe(50);
  });
});

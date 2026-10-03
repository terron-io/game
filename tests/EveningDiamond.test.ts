// terron 26.09: ВЕЧЕРНИЙ АЛМАЗНЫЙ (TerronTuning §ВЕЧЕРНИЙ). Решение владельца:
// алмазный идёт по своему расписанию, но в 20:00 и 21:00 МСК он вечерний —
// чередуются командный (2 команды, нации на карте) и соло; в соседние дни порядок
// меняется. Сторожим: расписание, сборку лобби под слот и гард на сервере.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eveningVariantAt,
  eventPerPersonOf,
  setDiamondEveningAll,
  setDiamondEveningHours,
  setDiamondDaily,
  setDiamondEveningOff,
  setDiamondEvery,
  TERRON_EVENING_SOLO_REWARD_PTS,
  TERRON_EVENING_TEAM_CAP_PTS,
  TERRON_EVENING_TEAM_POOL_PTS,
} from "../src/core/configuration/TerronTuning";
import { GameMode, GameType } from "../src/core/game/Game";
import { GameServer } from "../src/server/GameServer";
import { MapPlaylist } from "../src/server/MapPlaylist";

/** Момент ЧЧ:ММ по Москве в дату (UTC-дата, МСК = UTC+3). */
const msk = (d: number, h: number, m = 0) =>
  Date.UTC(2026, 8, d, h - 3, m, 0);

afterEach(() => {
  setDiamondEveningHours([20, 21]);
  setDiamondDaily(20, 0);
});

describe("вечерний алмазный: расписание", () => {
  it("20:00 и 21:00 — вечерние, соседние часы — обычные", () => {
    expect(eveningVariantAt(msk(26, 20))).not.toBeNull();
    expect(eveningVariantAt(msk(26, 21))).not.toBeNull();
    expect(eveningVariantAt(msk(26, 19))).toBeNull();
    expect(eveningVariantAt(msk(26, 22))).toBeNull();
    expect(eveningVariantAt(msk(26, 20, 30))).toBeNull();
  });

  it("в один вечер один командный и один соло, на следующий — наоборот", () => {
    const a = [eveningVariantAt(msk(26, 20)), eveningVariantAt(msk(26, 21))];
    const b = [eveningVariantAt(msk(27, 20)), eveningVariantAt(msk(27, 21))];
    expect(new Set(a)).toEqual(new Set(["team", "solo"]));
    expect(b).toEqual([a[1], a[0]]);
  });

  it("'*' — каждый слот вечерний, варианты чередуются; off — выключено", () => {
    setDiamondEvery(30);
    setDiamondEveningAll();
    const s1 = eveningVariantAt(msk(26, 10, 0));
    const s2 = eveningVariantAt(msk(26, 10, 30));
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
    expect(s1).not.toBe(s2);
    setDiamondEveningOff();
    expect(eveningVariantAt(msk(26, 20))).toBeNull();
  });
});

describe("вечерний алмазный: лобби под слот", () => {
  const slot = (v: "team" | "solo") =>
    [msk(26, 20), msk(26, 21)].find((t) => eveningVariantAt(t) === v)!;

  it("командный: 2 команды, нации на карте, пул и потолок на человека", async () => {
    const c = await new MapPlaylist().gameConfig("diamond", {
      eventAt: slot("team"),
    });
    expect(c.gameMode).toBe(GameMode.Team);
    expect(c.playerTeams).toBe(2);
    expect(c.nations).toBe("default");
    expect(c.eventEvening).toBe("team");
    expect(c.eventRewardPts).toBe(TERRON_EVENING_TEAM_POOL_PTS);
    expect(c.eventRewardCapPts).toBe(TERRON_EVENING_TEAM_CAP_PTS);
    expect(eventPerPersonOf(c)).toBe(TERRON_EVENING_TEAM_CAP_PTS);
    // союз с чужой командой = сговор, матч не кончается
    expect(c.disableAlliances).toBe(true);
  });

  it("соло: обычный ффа с вечерней наградой", async () => {
    const c = await new MapPlaylist().gameConfig("diamond", {
      eventAt: slot("solo"),
    });
    expect(c.gameMode).toBe(GameMode.FFA);
    expect(c.eventEvening).toBe("solo");
    expect(c.eventRewardPts).toBe(TERRON_EVENING_SOLO_REWARD_PTS);
    expect(c.disableAlliances).toBeUndefined();
  });

  it("обычный алмазный слот — без вечернего варианта", async () => {
    const c = await new MapPlaylist().gameConfig("diamond", {
      eventAt: msk(26, 15),
    });
    expect(c.eventEvening).toBeUndefined();
    expect(c.gameMode).toBe(GameMode.FFA);
  });
});

describe("вечерний алмазный: гард на сервере", () => {
  const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  log.child = vi.fn().mockReturnValue(log);
  const server = (config: any, t?: any) =>
    new GameServer("g", log, Date.now(), config, undefined, undefined, t);

  it("вариант живёт только у алмазного лобби", () => {
    const cfg = {
      gameType: GameType.Public,
      golden: true,
      gameMode: GameMode.Team,
      eventEvening: "team",
      eventRewardPts: 500,
    };
    const d = server({ ...cfg }, "diamond") as any;
    expect(d.gameConfig.eventEvening).toBe("team");
    expect(d.gameConfig.eventRewardPts).toBe(TERRON_EVENING_TEAM_POOL_PTS);
    expect(d.gameConfig.eventRewardCapPts).toBe(TERRON_EVENING_TEAM_CAP_PTS);
    const g = server({ ...cfg }, "golden") as any;
    expect(g.gameConfig.eventEvening).toBeUndefined();
    expect(g.gameConfig.eventRewardCapPts).toBeUndefined();
  });

  it("командный вариант при ффа-режиме не принимается", () => {
    const d = server(
      {
        gameType: GameType.Public,
        golden: true,
        gameMode: GameMode.FFA,
        eventEvening: "team",
      },
      "diamond",
    ) as any;
    expect(d.gameConfig.eventEvening).toBeUndefined();
  });
});

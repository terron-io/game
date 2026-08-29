import { describe, expect, it, vi } from "vitest";
import {
  diamondRewardPts,
  getDiamondSchedule,
  goldenPeriodMin,
  isNearDiamondMatch,
  nextDiamondMatchAt,
  nextGoldenMatchAt,
  setDiamondDaily,
  setDiamondEvery,
  setDiamondRewardPts,
  TERRON_DIAMOND_QUIET_MS,
} from "../src/core/configuration/TerronTuning";
import { GameType } from "../src/core/game/Game";
import { GameServer } from "../src/server/GameServer";

// terron: АЛМАЗНЫЙ МАТЧ — расписание. Тут ловятся две настоящие грабли:
//   1) МСК считается ФИКСИРОВАННЫМ сдвигом +3 от UTC (перевода часов в РФ нет).
//      Тест прибит к UTC-датам, поэтому не зависит от TZ машины/контейнера;
//   2) золотой слот, попавший в тихое окно вокруг алмазного, ДОЛЖЕН
//      пропускаться — иначе в 20:00 стартуют оба события и растащат онлайн.
describe("Алмазный матч: расписание", () => {
  // Слот считаем ОТ КОНСТАНТ, а не от «20:00»: время события временно двигают
  // для обкатки, и тест не должен от этого краснеть.
  const daily = getDiamondSchedule();
  if (daily.kind !== "daily")
    throw new Error("дефолт расписания должен быть суточным");
  const utcHourOfDiamond = (daily.hour + 24 - 3) % 24;
  const utcMinuteOfDiamond = daily.minute;

  it("ближайший алмазный — сегодня в HOUR_MSK по Москве", () => {
    // 10 августа 2026, 09:00 UTC = 12:00 МСК — до вечернего слота ещё далеко.
    const now = Date.UTC(2026, 7, 10, 0, 30, 0);
    const at = new Date(nextDiamondMatchAt(now));
    expect(at.getUTCFullYear()).toBe(2026);
    expect(at.getUTCMonth()).toBe(7);
    expect(at.getUTCDate()).toBe(10);
    expect(at.getUTCHours()).toBe(utcHourOfDiamond);
    expect(at.getUTCMinutes()).toBe(utcMinuteOfDiamond);
  });

  it("после слота уезжает на следующие сутки", () => {
    const justAfter = Date.UTC(
      2026,
      7,
      10,
      utcHourOfDiamond,
      utcMinuteOfDiamond,
      1,
    );
    const at = new Date(nextDiamondMatchAt(justAfter));
    expect(at.getUTCDate()).toBe(11);
    expect(at.getUTCHours()).toBe(utcHourOfDiamond);
  });

  it("слот строго в БУДУЩЕМ (ровно в момент старта показывает завтра)", () => {
    const exact = Date.UTC(
      2026,
      7,
      10,
      utcHourOfDiamond,
      utcMinuteOfDiamond,
      0,
    );
    expect(nextDiamondMatchAt(exact)).toBe(exact + 24 * 60 * 60 * 1000);
  });

  it("тихое окно — только вокруг алмазного слота", () => {
    const slot = Date.UTC(2026, 7, 10, utcHourOfDiamond, utcMinuteOfDiamond, 0);
    expect(isNearDiamondMatch(slot)).toBe(true);
    expect(isNearDiamondMatch(slot - TERRON_DIAMOND_QUIET_MS)).toBe(true);
    expect(isNearDiamondMatch(slot + TERRON_DIAMOND_QUIET_MS)).toBe(true);
    expect(isNearDiamondMatch(slot - TERRON_DIAMOND_QUIET_MS - 1)).toBe(false);
    expect(isNearDiamondMatch(slot + TERRON_DIAMOND_QUIET_MS + 1)).toBe(false);
    // Тихое окно суточное: та же минута накануне — тоже тишина.
    expect(isNearDiamondMatch(slot - 24 * 60 * 60 * 1000)).toBe(true);
  });

  it("золотой слот в тихом окне пропускается", () => {
    const slot = Date.UTC(2026, 7, 10, utcHourOfDiamond, utcMinuteOfDiamond, 0);
    const period = goldenPeriodMin() * 60_000;
    // Момент прямо перед алмазным: следующий золотой обязан оказаться ПОСЛЕ
    // тихого окна, а не в 20:00.
    const golden = nextGoldenMatchAt(slot - period);
    expect(isNearDiamondMatch(golden)).toBe(false);
    expect(golden).toBeGreaterThan(slot + TERRON_DIAMOND_QUIET_MS);
    // Сетка расписания при этом не сбита — слот по-прежнему кратен периоду.
    expect(golden % period).toBe(0);
  });

  it("вдали от алмазного золотое расписание не меняется", () => {
    const noon = Date.UTC(2026, 7, 10, 3, 3, 0);
    const period = goldenPeriodMin() * 60_000;
    expect(nextGoldenMatchAt(noon)).toBe(
      Math.floor(noon / period) * period + period,
    );
  });
});

// terron: ТИР — ПРОИЗВОДНАЯ ОТ ТИПА ЛОББИ, а не то, что пришло в конфиге.
// Иначе приватная игра с ботом (или подделанный клиент/старый снимок персиста)
// объявляла бы себя алмазным матчем и печатала бы алмазы по высшей ставке.
describe("Алмазный матч: гард тира в GameServer", () => {
  const log = () => {
    const l: any = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    l.child = vi.fn().mockReturnValue(l);
    return l;
  };
  const server = (config: any, publicGameType?: any) =>
    new GameServer(
      "g",
      log(),
      Date.now(),
      config,
      undefined,
      undefined,
      publicGameType,
    );

  it("лобби типа diamond — событийное с алмазным тиром", () => {
    const g = server({ gameType: GameType.Public, golden: true }, "diamond");
    expect(g.isGolden()).toBe(true);
    expect(g.eventTier()).toBe("diamond");
  });

  it("лобби типа golden не становится алмазным по чужому конфигу", () => {
    const g = server(
      { gameType: GameType.Public, golden: true, eventTier: "diamond" },
      "golden",
    );
    expect(g.eventTier()).toBe("golden");
  });

  it("приватное лобби с подсунутым флагом — не событие вообще", () => {
    const g = server({
      gameType: GameType.Private,
      golden: true,
      eventTier: "diamond",
    });
    expect(g.isGolden()).toBe(false);
    expect(g.eventTier()).toBeUndefined();
  });
});

// terron: ВРЕМЯ И НАГРАДА — РАНТАЙМ-ПАРАМЕТРЫ (env TERRON_DIAMOND_AT / _REWARD).
// Меняем их часто, поэтому проверяем оба режима расписания и отбой мусора.
describe("Алмазный матч: расписание и награда задаются на лету", () => {
  const restore = () => {
    const s = getDiamondSchedule();
    return () =>
      s.kind === "daily"
        ? setDiamondDaily(s.hour, s.minute)
        : setDiamondEvery(s.minutes);
  };

  it("суточный режим: сеттер двигает слот, мусор не проходит", () => {
    const back = restore();
    try {
      setDiamondDaily(7, 45);
      // 7:45 МСК = 4:45 UTC
      const at = new Date(nextDiamondMatchAt(Date.UTC(2026, 7, 10, 0, 0, 0)));
      expect(at.getUTCHours()).toBe(4);
      expect(at.getUTCMinutes()).toBe(45);
      expect(() => setDiamondDaily(24, 0)).toThrow();
      expect(() => setDiamondDaily(20, 60)).toThrow();
      expect(getDiamondSchedule()).toEqual({
        kind: "daily",
        hour: 7,
        minute: 45,
      });
    } finally {
      back();
    }
  });

  it("режим «каждые N минут»: слоты по сетке, тихое окно вокруг каждого", () => {
    const back = restore();
    try {
      setDiamondEvery(30);
      const base = Date.UTC(2026, 7, 10, 12, 0, 0);
      expect(nextDiamondMatchAt(base + 60_000)).toBe(base + 30 * 60_000);
      expect(nextDiamondMatchAt(base - 60_000)).toBe(base);
      expect(isNearDiamondMatch(base)).toBe(true);
      expect(isNearDiamondMatch(base + TERRON_DIAMOND_QUIET_MS + 60_000)).toBe(
        false,
      );
      // золотой слот в тихом окне вокруг такого алмазного тоже пропускается
      const golden = nextGoldenMatchAt(base - goldenPeriodMin() * 60_000);
      expect(isNearDiamondMatch(golden)).toBe(false);
      expect(() => setDiamondEvery(1)).toThrow();
    } finally {
      back();
    }
  });

  it("награда задаётся числом и отбивает мусор", () => {
    const before = diamondRewardPts();
    try {
      setDiamondRewardPts(30);
      expect(diamondRewardPts()).toBe(30);
      expect(() => setDiamondRewardPts(0)).toThrow();
      expect(() => setDiamondRewardPts(10_000)).toThrow();
      expect(diamondRewardPts()).toBe(30);
    } finally {
      setDiamondRewardPts(before);
    }
  });
});

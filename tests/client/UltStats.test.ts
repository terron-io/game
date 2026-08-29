import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetUltStatsCache,
  avgWinRate,
  liveUltRows,
  loadUltStats,
  ULT_STATS_MIN_PICKS,
  ultDelta,
  ultStatFor,
  UltStatsData,
} from "../../src/client/UltStats";

// terron 26.08: публичная статистика ульт (/ults/stats + вкладка в карточке).
// Сторожим ровно то, что делает цифры честными: точку отсчёта, порог выборки
// и параметры запроса (дефолты ручки для паблика не годятся).
function data(over: Partial<UltStatsData> = {}): UltStatsData {
  return {
    window: "30",
    gamesArchived: 1000,
    reachGames: 100,
    reachUsers: 40,
    picksTotal: 200,
    // Безультовые выигрывают редко — до слота доживает тот, кто уже побеждал.
    baseline: { players: 900, wins: 90, winRate: 10 },
    ultimates: [
      { ultimate: "Religion", picks: 100, wins: 50, winRate: 50 },
      { ultimate: "Oil Rig", picks: 100, wins: 70, winRate: 70 },
    ],
    ...over,
  };
}

describe("UltStats — точка отсчёта и порог", () => {
  it("средний считается по ВЫБРАВШИМ ульту, а не по всем игрокам", () => {
    const d = data();
    expect(avgWinRate(d)).toBe(60); // (50+70)/200
    // ⚠️ Обратный прогон: возьми baseline (10%) — и Религия из «минус десять»
    // превратится в «плюс сорок», то есть в имбу на ровном месте.
    expect(avgWinRate(d)).not.toBe(d.baseline.winRate);
  });

  it("дельта — отклонение от среднего по выбравшим", () => {
    const d = data();
    expect(ultDelta(d, d.ultimates[0])).toBe(-10);
    expect(ultDelta(d, d.ultimates[1])).toBe(10);
  });

  it("на малой выборке дельты нет вовсе", () => {
    const small = {
      ultimate: "Our Sky",
      picks: ULT_STATS_MIN_PICKS - 1,
      wins: 9,
      winRate: 75,
    };
    const d = data({ ultimates: [...data().ultimates, small] });
    expect(ultDelta(d, small)).toBeNull();
    // Ровно на пороге — уже считаем.
    expect(
      ultDelta(d, { ...small, picks: ULT_STATS_MIN_PICKS }),
    ).not.toBeNull();
  });

  it("строка ищется по СЫРОМУ значению UnitType из БД", () => {
    const d = data();
    expect(ultStatFor(d, "Oil Rig")?.winRate).toBe(70);
    expect(ultStatFor(d, "Piracy")).toBeUndefined();
    expect(ultStatFor(null, "Oil Rig")).toBeUndefined();
  });
});

describe("UltStats — что вообще попадает в публичную таблицу", () => {
  const row = (ultimate: string) => ({
    ultimate,
    picks: 40,
    wins: 20,
    winRate: 50,
  });

  it("удалённая ульта из БД не показывается", () => {
    // «Ministry of Truth» влит в МЕДИА 06.08: пики в базе есть, ульты нет —
    // в таблице она выходила сырой строкой без имени и иконки.
    const out = liveUltRows([row("Ministry of Truth"), row("Religion")]);
    expect(out.map((r) => r.ultimate)).toEqual(["Religion"]);
  });

  it("секретная ульта не показывается — таблица назвала бы скрытое имя", () => {
    const out = liveUltRows([row("Walking City"), row("Religion")]);
    expect(out.map((r) => r.ultimate)).toEqual(["Religion"]);
  });

  it("снятая с раскатки ульта не показывается", () => {
    const out = liveUltRows(
      [row("Piracy"), row("Religion")],
      new Set(["Piracy"]),
    );
    expect(out.map((r) => r.ultimate)).toEqual(["Religion"]);
  });

  it("живые ульты проходят фильтр (сторож не вырезал всё подряд)", () => {
    const live = ["Religion", "Oil Rig", "Tank Factory", "Central Bank"];
    expect(liveUltRows(live.map(row)).map((r) => r.ultimate)).toEqual(live);
  });
});

describe("UltStats — запрос", () => {
  let calls: string[];
  beforeEach(() => {
    __resetUltStatsCache();
    calls = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(String(url));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data()),
      } as Response);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("дев и матчи с ботами исключены ЯВНО (дефолты ручки другие)", async () => {
    await loadUltStats("30");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("window=30");
    // ⚠️ У ручки дев по умолчанию ВКЛЮЧЁН — без dev=0 в паблик уедут
    // полигон и дев-матчи.
    expect(calls[0]).toContain("dev=0");
    expect(calls[0]).toContain("humans=humans");
  });

  it("кэш и склейка параллельных вызовов: один запрос на окно", async () => {
    const [a, b] = await Promise.all([loadUltStats("30"), loadUltStats("30")]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
    await loadUltStats("30");
    expect(calls).toHaveLength(1); // из кэша
    await loadUltStats("all");
    expect(calls).toHaveLength(2); // другое окно — свой запрос
    expect(calls[1]).toContain("window=all");
  });

  it("сеть легла — null, а не исключение наружу", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    __resetUltStatsCache();
    await expect(loadUltStats("30")).resolves.toBeNull();
  });
});

// terron 26.08: ПУБЛИЧНАЯ СТАТИСТИКА УЛЬТ (вкладка «Статистика» в карточке
// дерева + общая таблица /ults/stats). Решение владельца: «просто в паблик их
// вывести, будто не такая секретная информация».
//
// Данные берём у СУЩЕСТВУЮЩЕЙ ручки `GET /balance/ultimates` — она и так без
// гейта (её же читает вкладка «Баланс» дашборда), кэш 60с на стороне API.
// Своей ручки не заводим: второй источник тех же цифр разъехался бы с балансной.
//
// ⚠️ ПАРАМЕТРЫ ПИНИМ ЖЁСТКО, дефолты ручки для паблика НЕ годятся:
//   dev=0     — у ручки по умолчанию дев ВКЛЮЧЁН, а полигон и дев-матчи к
//               боевому балансу отношения не имеют;
//   humans    — только матчи против живых: винрейт по ботам меряет ботов.
//
// ⚠️ ГЛАВНОЕ ПРО ЧТЕНИЕ ЦИФР. У ручки есть baseline — винрейт игроков БЕЗ ульты
// (~11%). Сравнивать ульту С НИМ НЕЛЬЗЯ: ульту выбирает тот, кто дожил до слота,
// то есть уже выигрывал — 60% против 11% это выживаемость, а не сила ульты.
// Честная точка отсчёта — СРЕДНИЙ ВИНРЕЙТ ВЫБРАВШИХ ЛЮБУЮ УЛЬТУ (avgWinRate):
// все эти игроки дошли до одного и того же места. От неё и считаем дельту.
import {
  isSecretUltimate,
  ULTIMATE_REGISTRY,
  UnitType,
} from "../core/game/Game";
import { getApiBase } from "./Api";

export interface UltStatRow {
  /** Сырое значение из БД — равно значению UnitType («Tank Factory»). */
  ultimate: string;
  picks: number;
  wins: number;
  /** Проценты, 0..100 с одним знаком. */
  winRate: number;
}

export interface UltStatsData {
  window: string;
  gamesArchived: number;
  /** Сколько партий вообще дошли до выбора ульты. */
  reachGames: number;
  reachUsers: number;
  picksTotal: number;
  baseline: { players: number; wins: number; winRate: number };
  ultimates: UltStatRow[];
}

export type UltStatsWindow = "30" | "all";

/** Ниже этого числа пиков цифру показываем, но дельту — нет: шум. */
export const ULT_STATS_MIN_PICKS = 30;

/** Средний винрейт среди ВЫБРАВШИХ ульту — точка отсчёта для дельты. */
export function avgWinRate(d: UltStatsData): number {
  const wins = d.ultimates.reduce((s, r) => s + r.wins, 0);
  return d.picksTotal > 0
    ? Math.round((wins / d.picksTotal) * 1000) / 10
    : 0;
}

/**
 * Дельта к среднему по выбравшим, в процентных пунктах. null — если выборка
 * меньше порога (иначе «+18 п.п.» на девяти матчах читается как факт).
 */
export function ultDelta(d: UltStatsData, row: UltStatRow): number | null {
  if (row.picks < ULT_STATS_MIN_PICKS) return null;
  return Math.round((row.winRate - avgWinRate(d)) * 10) / 10;
}

export function ultStatFor(
  d: UltStatsData | null,
  type: UnitType | string,
): UltStatRow | undefined {
  if (d === null) return undefined;
  return d.ultimates.find((r) => r.ultimate === type);
}

/** Ульты, существующие в игре СЕЙЧАС (значения UnitType = строки из БД). */
const LIVE_ULTS: ReadonlySet<string> = new Set(
  ULTIMATE_REGISTRY.map((u) => String(u.type)),
);

/**
 * Что показываем в публичной таблице. Отсекаем три класса строк:
 *  — УДАЛЁННЫЕ ульты (в БД лежат пики «Ministry of Truth», влитого в МЕДИА
 *    06.08): ни имени, ни иконки, выбрать нельзя;
 *  — СЕКРЕТНЫЕ: их имя в игре скрыто («????»), таблица бы его назвала;
 *  — снятые с раскатки рубильником TERRON_DISABLED_ULTS: дерево их не рисует,
 *    значит и винрейта у них для игрока не существует.
 */
export function liveUltRows(
  rows: readonly UltStatRow[],
  disabled: ReadonlySet<string> = new Set(),
): UltStatRow[] {
  return rows.filter(
    (r) =>
      LIVE_ULTS.has(r.ultimate) &&
      !isSecretUltimate(r.ultimate as UnitType) &&
      !disabled.has(r.ultimate),
  );
}

const cache = new Map<UltStatsWindow, { at: number; data: UltStatsData }>();
const inFlight = new Map<UltStatsWindow, Promise<UltStatsData | null>>();
const TTL_MS = 60_000;

/** Загрузка со своим кэшем 60с; параллельные вызовы делят один запрос. */
export async function loadUltStats(
  window: UltStatsWindow = "30",
): Promise<UltStatsData | null> {
  const hit = cache.get(window);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const running = inFlight.get(window);
  if (running) return running;
  const p = (async (): Promise<UltStatsData | null> => {
    try {
      const r = await fetch(
        `${getApiBase()}/balance/ultimates?window=${window}&humans=humans&dev=0`,
      );
      if (!r.ok) return null;
      const data = (await r.json()) as UltStatsData;
      if (!Array.isArray(data?.ultimates)) return null;
      cache.set(window, { at: Date.now(), data });
      return data;
    } catch {
      return null;
    } finally {
      inFlight.delete(window);
    }
  })();
  inFlight.set(window, p);
  return p;
}

/** Только для тестов: сбросить кэш между кейсами. */
export function __resetUltStatsCache(): void {
  cache.clear();
  inFlight.clear();
}

// terron: DEV — клиентский сборщик ROI-данных для страницы /balance.
// Читает кумулятивный доход по каналам (PlayerUpdate.econGold, приходит из воркера когда
// включён extendedEconomyLog) + считает здания из GameView, кладёт периодические снимки в
// localStorage. Страница /balance рендерит по ним скорость (в минуту) и на одно здание.
// Спека: airport.md
import type { EconomyGold } from "../core/game/EconomyLog";
import { PlayerType, UnitType } from "../core/game/Game";
import { GameUpdateType, GameUpdateViewData } from "../core/game/GameUpdates";
import type { GameView } from "./view/GameView";

export const BALANCE_LS_KEY = "terron_balance";
const SAMPLE_EVERY_TICKS = 50; // 5с при 10 тик/с
const MAX_SAMPLES = 160; // ~13 минут истории

export interface PlayerSample {
  id: string;
  name: string;
  bot: boolean;
  econ: EconomyGold;
  port: number;
  factory: number;
  airport: number;
  city: number;
}

export interface BalanceSample {
  tick: number;
  players: PlayerSample[];
}

export interface BalanceStore {
  samples: BalanceSample[];
}

const latestEcon = new Map<string, EconomyGold>();
let lastSampleTick = -1;
let lastSeenTick = -1;

function readStore(): BalanceStore {
  try {
    const raw = localStorage.getItem(BALANCE_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BalanceStore;
      if (parsed && Array.isArray(parsed.samples)) return parsed;
    }
  } catch {
    /* ignore */
  }
  return { samples: [] };
}

export function collectBalance(
  game: GameView,
  gu: GameUpdateViewData,
): void {
  const tick = gu.tick;

  // Новый матч (тики откатились) → чистим историю.
  if (tick < lastSeenTick) {
    latestEcon.clear();
    lastSampleTick = -1;
    try {
      localStorage.removeItem(BALANCE_LS_KEY);
    } catch {
      /* ignore */
    }
  }
  lastSeenTick = tick;

  // Запоминаем последний эконом-снимок каждого игрока из потока апдейтов.
  const pus = gu.updates?.[GameUpdateType.Player];
  if (pus) {
    for (const pu of pus) {
      if (pu.econGold !== undefined) latestEcon.set(pu.id, pu.econGold);
    }
  }
  if (latestEcon.size === 0) return;

  // Троттлинг: снимок раз в SAMPLE_EVERY_TICKS.
  if (lastSampleTick >= 0 && tick - lastSampleTick < SAMPLE_EVERY_TICKS) return;
  lastSampleTick = tick;

  const players: PlayerSample[] = [];
  for (const p of game.players()) {
    const econ = latestEcon.get(p.id());
    if (econ === undefined) continue;
    players.push({
      id: p.id(),
      name: p.displayName(),
      bot: p.type() === PlayerType.Bot,
      econ,
      port: p.units(UnitType.Port).length,
      factory: p.units(UnitType.Factory).length,
      airport: p.units(UnitType.Airport).length,
      city: p.units(UnitType.City).length,
    });
  }
  if (players.length === 0) return;

  const store = readStore();
  store.samples.push({ tick, players });
  if (store.samples.length > MAX_SAMPLES) {
    store.samples = store.samples.slice(-MAX_SAMPLES);
  }
  try {
    localStorage.setItem(BALANCE_LS_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota */
  }
}

// terron: DEV-инструмент — сбор ROI-данных по эконом-зданиям (порт / фабрика / аэропорт).
// НЕ влияет на симуляцию (только аккумулятор), детерминизм не трогает. Гейт —
// `config().extendedEconomyLog()`. Держит КУМУЛЯТИВНЫЙ доход по каналам на игрока (smallID);
// снимок уходит на клиент через `PlayerUpdate.econGold`, а страница `/balance` считает
// скорость (в минуту) и на одно здание. Спека: airport.md
//
// Каналы (по «фирменному» источнику дохода здания):
//   port      — прибытия торговых кораблей (море)         → уникальный доход порта
//   factory   — self-трейд поездов (рельсы)               → то, что «делает» фабрика
//   airport   — прибытия торговых самолётов (воздух)      → уникальный доход аэропорта
//   railExt   — чужие поезда, остановившиеся у ваших станций (бонус, вне 3 зданий)
import { Game, Player } from "./Game";

export type EconomySource = "port" | "factory" | "airport" | "railExt";

export interface EconomyGold {
  port: number;
  factory: number;
  airport: number;
  railExt: number;
}

// Кумулятивный доход по каналам, ключ = smallID игрока.
const cumulative = new Map<number, EconomyGold>();

function fresh(): EconomyGold {
  return { port: 0, factory: 0, airport: 0, railExt: 0 };
}

/** Зарегистрировать заработанное золото по каналу (вызывается из execution'ов дохода). */
export function recordEconomyGold(
  game: Game,
  player: Player,
  source: EconomySource,
  gold: number | bigint,
): void {
  // Optional-chain: mock configs in tests may not implement this method.
  if (!game.config().extendedEconomyLog?.()) return;
  const g = typeof gold === "bigint" ? Number(gold) : Math.floor(gold);
  if (g <= 0) return;

  // Feature-detect: skip partial mock players in unit tests.
  const id = player.smallID?.();
  if (id === undefined) return;

  let b = cumulative.get(id);
  if (b === undefined) {
    b = fresh();
    cumulative.set(id, b);
  }
  b[source] += g;
}

/** Снимок кумулятивного дохода игрока (для PlayerUpdate). undefined если ничего не заработал. */
export function economySnapshot(smallID: number): EconomyGold | undefined {
  const b = cumulative.get(smallID);
  if (b === undefined) return undefined;
  return { port: b.port, factory: b.factory, airport: b.airport, railExt: b.railExt };
}

/** Сброс аккумулятора (новый матч в том же воркере). */
export function resetEconomyLog(): void {
  cumulative.clear();
}

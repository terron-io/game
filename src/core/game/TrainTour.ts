// terron 24.09: МАРШРУТ ПОЕЗДА — ОБХОД СЕТИ (TerronTuning §ФАБРИКИ И ПОЕЗДА).
//
// Решение владельца: «если в сети фабрика, порт, аэропорт — можно проехать все
// точки и получить за каждый поинт». Поезд от фабрики идёт в глубину по рельсам
// (обход в глубину с возвратами), заходит в каждую ещё не посещённую станцию и
// возвращается по своим следам, когда ветка кончилась. Маршрут — список станций,
// где соседние связаны рельсами: его целиком получает TrainExecution и клиент
// (план движения), поэтому считаем его один раз при выпуске.
//
// Станция годится, если она жива и её владелец торгует с хозяином поезда (своя —
// всегда). Иначе поезд встал бы у неё, как у закрытой границы.
//
// Детерминизм: соседи идут в порядке рельсов станции (порядок вставки), выбор
// среди них — по ГСЧ фабрики.
import { PseudoRandom } from "../PseudoRandom";
import { Player } from "./Game";
import { TrainStation } from "./TrainStation";

export interface TrainTourLimits {
  /** Не больше стольких НОВЫХ (платных) станций за рейс. */
  maxStops: number;
  /** Не длиннее стольких тайлов рельсов за рейс. */
  maxTiles: number;
}

function railLength(a: TrainStation, b: TrainStation): number | null {
  const r = a.getRailroadTo(b);
  return r === null ? null : r.tiles.length;
}

/**
 * Маршрут от `start`: сама станция, затем обход сети. Пустой хвост из одних
 * возвратов отрезается — поезд заканчивает у последней НОВОЙ станции.
 * Меньше двух станций — ехать некуда.
 */
export function buildTrainTour(
  start: TrainStation,
  owner: Player,
  random: PseudoRandom,
  limits: TrainTourLimits,
): TrainStation[] {
  const route: TrainStation[] = [start];
  const visited = new Set<TrainStation>([start]);
  const stack: TrainStation[] = [start];
  let lastNew = 0;
  let stops = 0;
  let tiles = 0;

  while (stack.length > 0 && stops < limits.maxStops) {
    const cur = stack[stack.length - 1];
    const options = cur
      .neighbors()
      .filter(
        (n) =>
          !visited.has(n) &&
          n.isActive() &&
          n.tradeAvailable(owner) &&
          railLength(cur, n) !== null,
      );
    if (options.length === 0) {
      // Ветка кончилась — назад по своим следам.
      stack.pop();
      if (stack.length === 0) break;
      const back = stack[stack.length - 1];
      const len = railLength(cur, back);
      if (len === null || tiles + len > limits.maxTiles) break;
      route.push(back);
      tiles += len;
      continue;
    }
    const next = options[random.nextInt(0, options.length)];
    const len = railLength(cur, next)!;
    if (tiles + len > limits.maxTiles) break;
    route.push(next);
    tiles += len;
    visited.add(next);
    stack.push(next);
    stops++;
    lastNew = route.length - 1;
  }
  return route.slice(0, lastNew + 1);
}

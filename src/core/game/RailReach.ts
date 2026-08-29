/**
 * terron 23.08 — ЖЕЛЕЗНАЯ ДОРОГА КАК СРЕДА ПЕРЕДВИЖЕНИЯ (общая для всех ульт,
 * которые по ней ездят: «Дора», «Взрывные поезда», всё будущее).
 *
 * ⚠️ Вынесено в общий модуль после трёх подряд репортов по Доре. Каждый раз
 * ошибка была не в самой ульте, а в том, КАК считается доступность рельсов, —
 * и если бы такой расчёт жил в каждой ульте своей копией, чинить пришлось бы
 * трижды. Здесь ОДИН ответ на два вопроса: «куда я доеду» и «как туда ехать».
 *
 * Правила, оплаченные кровью:
 *  • ЧУЖАЯ земля перегон закрывает, НИЧЕЙНАЯ — нет. Рельсы постоянно режут
 *    ничейные проплешины; правило «owner !== me» отрезало почти всю сеть.
 *  • Связность решается ЗАЛИВКОЙ от самого объекта, а не обходом «от ближайшей
 *    станции»: при нескольких связных компонентах ближайшая по прямой станция
 *    запросто относится к другой компоненте, и обход уходит не туда.
 *  • Ходим по ВОСЬМИ соседям: рельсовые пути идут и по диагонали.
 */
import { Game, Player } from "./Game";
import { TileRef } from "./GameMap";

/** Восемь соседей тайла (в ядре есть только четырёхсвязный neighbors()). */
export function around(mg: Game, t: TileRef): TileRef[] {
  const x = mg.x(t);
  const y = mg.y(t);
  const out: TileRef[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (!mg.isValidCoord(x + dx, y + dy)) continue;
      out.push(mg.ref(x + dx, y + dy));
    }
  }
  return out;
}

/**
 * Тайлы рельсов, до которых игрок реально доедет, начиная с `from`.
 * Включает сам `from` (объект стоит на путях).
 */
export function railTilesFrom(
  mg: Game,
  player: Player,
  from: TileRef,
  /**
   * ⚠️ terron 24.08 (уточнение владельца по «взрывным поездам»): пускать ли
   * состав ПО ЧУЖИМ перегонам.
   *
   *  • ДОРА — НЕТ. Орудие возят по своей сети: заехав к соседу, оно было бы
   *    неубиваемым сюрпризом, а вся её защита вынесена на подвоз.
   *  • СОСТАВ СМЕРТИ — ДА. Это бомба, которую ВЕЗУТ соседу: «рельсы соединены
   *    — значит доставим». Раньше зона обрывалась на своей границе, поэтому
   *    состав, пущенный в чужую страну, ехал к ближайшей СВОЕЙ точке и рвал у
   *    хозяина дома (репорт владельца: «бахает только на моей территории»).
   *    Контрплей остаётся тот же и даже честнее: рвите пути — свои или его.
   */
  allowForeign = false,
): Set<TileRef> {
  const foreign = (t: TileRef): boolean => {
    const o = mg.owner(t);
    return o.isPlayer() && o !== player;
  };
  const usable = new Set<TileRef>([from]);
  const seenRails = new Set<number>();
  for (const st of mg.railNetwork().stationManager().getAll()) {
    for (const rail of st.getRailroads()) {
      if (seenRails.has(rail.id)) continue;
      seenRails.add(rail.id);
      if (!allowForeign && rail.tiles.some(foreign)) continue;
      for (const t of rail.tiles) usable.add(t);
    }
  }

  const reach = new Set<TileRef>([from]);
  const queue: TileRef[] = [from];
  for (let head = 0; head < queue.length; head++) {
    for (const n of around(mg, queue[head])) {
      if (reach.has(n) || !usable.has(n)) continue;
      reach.add(n);
      queue.push(n);
    }
  }
  return reach;
}

/**
 * Кратчайший маршрут по доступным рельсам от `from` до ПЕРВОГО тайла, на
 * котором `isGoal` вернёт true. Пустой массив = такого тайла нет.
 * Первый элемент пути — уже СЛЕДУЮЩИЙ шаг (сам `from` в путь не входит).
 */
export function railPath(
  mg: Game,
  allowed: ReadonlySet<TileRef>,
  from: TileRef,
  isGoal: (t: TileRef) => boolean,
): TileRef[] {
  const parent = new Map<TileRef, TileRef>();
  const seen = new Set<TileRef>([from]);
  const queue: TileRef[] = [from];
  let goal: TileRef | null = null;
  for (let head = 0; head < queue.length && goal === null; head++) {
    for (const n of around(mg, queue[head])) {
      if (seen.has(n) || !allowed.has(n)) continue;
      seen.add(n);
      parent.set(n, queue[head]);
      if (isGoal(n)) {
        goal = n;
        break;
      }
      queue.push(n);
    }
  }
  if (goal === null) return [];
  const path: TileRef[] = [];
  for (let t: TileRef | undefined = goal; t !== undefined; t = parent.get(t)) {
    path.push(t);
  }
  path.reverse();
  path.shift();
  return path;
}

/**
 * Прореживание набора тайлов для отправки на клиент: маленькая сеть уезжает
 * целиком, большая — не больше `max` точек (клиент рисует круг вокруг каждой).
 */
export function thinReach(
  tiles: Iterable<TileRef>,
  keep: TileRef,
  max: number,
): TileRef[] {
  const all = [...tiles].sort((a, b) => a - b);
  const step = Math.max(1, Math.ceil(all.length / max));
  const out: TileRef[] = [keep];
  for (let i = 0; i < all.length && out.length < max; i += step) {
    if (all[i] !== keep) out.push(all[i]);
  }
  out.sort((a, b) => a - b);
  return out;
}

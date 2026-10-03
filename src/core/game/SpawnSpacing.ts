// terron 29.09: запрет «прилипать» спавном к другому человеку. Одна проверка на
// симуляцию (SpawnExecution) и на клик (client/SpawnSpacingHint.ts): клиент
// заранее говорит, почему точка не встанет, а ядро гарантирует правило у всех.
import { TERRON_SPAWN_HUMAN_GAP } from "../configuration/TerronTuning";
import { TileRef } from "./GameMap";

export interface SpawnNeighbor {
  spawnTile: TileRef | undefined;
}

/**
 * Первый сосед, чья точка ближе `gap` к `center`, или null. Список соседей уже
 * отфильтрован вызывающим: только люди, не сам игрок, не его команда.
 */
export function spawnBlocker<T extends SpawnNeighbor>(
  center: TileRef,
  neighbors: readonly T[],
  dist: (a: TileRef, b: TileRef) => number,
  gap: number = TERRON_SPAWN_HUMAN_GAP,
): T | null {
  for (const n of neighbors) {
    if (n.spawnTile === undefined) continue;
    if (dist(n.spawnTile, center) < gap) return n;
  }
  return null;
}

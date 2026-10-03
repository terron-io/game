// terron 29.09: подсказка к запрету «прилипать» спавном (core/game/SpawnSpacing.ts).
// Ядро и так не поставит флаг ближе TERRON_SPAWN_HUMAN_GAP к другому человеку;
// клиент проверяет ту же функцию ДО отправки, чтобы игрок увидел причину, а не
// молчаливый отказ.
import { TERRON_SPAWN_HUMAN_GAP } from "../core/configuration/TerronTuning";
import { GameType, PlayerType } from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { spawnBlocker } from "../core/game/SpawnSpacing";
import { toast } from "./Toast";
import { L } from "./Utils";
import { GameView } from "./view/GameView";
import { PlayerView } from "./view/PlayerView";

/** Чей флаг мешает поставить спавн в `tile`; null — можно. */
export function spawnBlockedBy(
  game: GameView,
  tile: TileRef,
): PlayerView | null {
  // Как в ядре: правило только в публичных матчах.
  if (game.config().gameConfig().gameType !== GameType.Public) return null;
  const me = game.myPlayer();
  if (!me) return null;
  const others = game
    .playerViews()
    .filter(
      (p) =>
        p.id() !== me.id() &&
        p.type() === PlayerType.Human &&
        !me.isOnSameTeam(p),
    )
    .map((p) => ({ p, spawnTile: p.spawnTile() }));
  return (
    spawnBlocker(tile, others, (a, b) => game.manhattanDist(a, b))?.p ?? null
  );
}

/** true — спавн разрешён; иначе показывает причину и возвращает false. */
export function checkSpawnSpacing(game: GameView, tile: TileRef): boolean {
  const who = spawnBlockedBy(game, tile);
  if (who === null) return true;
  toast(
    L(
      `Слишком близко к ${who.displayName()} — ставь флаг не ближе ${TERRON_SPAWN_HUMAN_GAP} клеток от другого игрока`,
      `Too close to ${who.displayName()} — place your flag at least ${TERRON_SPAWN_HUMAN_GAP} tiles from another player`,
    ),
    "error",
  );
  return false;
}

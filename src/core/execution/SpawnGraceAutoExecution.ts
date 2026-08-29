import { TERRON_SPAWN_GRACE_SECONDS } from "../configuration/TerronTuning";
import { Execution, Game, PlayerType } from "../game/Game";
import { GameID } from "../Schemas";
import { SpawnExecution } from "./SpawnExecution";

// terron: авто-спавн по истечении грейса. Когда фаза спавна + грейс
// (TERRON_SPAWN_GRACE_SECONDS) закончились, а человек так и не выбрал место —
// размещаем его РАНДОМОМ в свободной зоне: форс-SpawnExecution без тайла →
// getSpawn() сам ищет центр без владельца и на дистанции
// minDistanceBetweenPlayers от чужих спавнов (т.е. подальше от игроков/наций).
// Срабатывает один раз. Детерминировано (allPlayers / elapsedGameSeconds / seed
// по id+gameID) → одинаково у всех клиентов лок-степа, сервер-авторитетно.
export class SpawnGraceAutoExecution implements Execution {
  private mg: Game;
  private done = false;

  constructor(private gameID: GameID) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    if (this.done) return;
    if (this.mg.inSpawnPhase()) return; // ждём конца фазы спавна
    // ждём, пока истечёт окно грейса (в течение него можно заспавниться вручную)
    if (this.mg.elapsedGameSeconds() < TERRON_SPAWN_GRACE_SECONDS) return;
    this.done = true;

    for (const p of this.mg.allPlayers()) {
      if (p.type() !== PlayerType.Human) continue;
      if (p.hasSpawned()) continue;
      this.mg.addExecution(
        new SpawnExecution(this.gameID, p.info(), undefined, true),
      );
    }
  }

  isActive(): boolean {
    return !this.done;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}

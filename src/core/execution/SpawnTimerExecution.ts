import { effectiveSpawnPhaseTurns } from "../configuration/TerronTuning";
import { Execution, Game, PlayerType } from "../game/Game";

export class SpawnTimerExecution implements Execution {
  private mg: Game;

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    if (this.mg.ticks() > this.spawnTurns()) {
      this.mg.endSpawnPhase();
    }
  }

  // terron: единый источник истины (effectiveSpawnPhaseTurns) — ПВП 20с / иначе 10с.
  private spawnTurns(): number {
    const humans = this.mg
      .allPlayers()
      .filter((p) => p.type() === PlayerType.Human).length;
    return effectiveSpawnPhaseTurns(
      this.mg.config().numSpawnPhaseTurns(),
      humans,
    );
  }

  isActive(): boolean {
    return this.mg.inSpawnPhase();
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}

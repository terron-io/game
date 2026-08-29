// terron: ОЛИМПИЙСКИЕ ИГРЫ — каст «Олимпийские игры» (TZ-ult-unlocks.md,
// решение владельца 23.08: «мир во всём мире на минуту, все всем союз»).
// Мгновенно: списываем 10M, ядро объявляет всемирный мир на TERRON_TRUCE_TICKS:
// текущие атаки между игроками отзываются, все всем друзья (isFriendly) —
// новые атаки, стрельба кораблей и перехваты выключены, ракеты летят. Бонус
// стадиона на это время — 100 %. Всем — строка в ленту. Кулдаун — markTruce.
import { TERRON_TRUCE_TICKS } from "../configuration/TerronTuning";
import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class TruceExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    this.active = false;
    if (this.player.canBuild(UnitType.Truce, this.tile) === false) {
      console.warn("cannot declare truce");
      return;
    }
    const cost = this.mg.unitInfo(UnitType.Truce).cost(this.mg, this.player);
    this.player.removeGold(cost);
    this.player.markTruce();
    this.mg.declareTruce(this.player, ticks + TERRON_TRUCE_TICKS);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

// terron: ГОРДОСТЬ — каст «ПЕРЕДЫШКА» (TZ-ult-unlocks.md, решение владельца
// 23.08): мир ВОКРУГ кастера на время, зависящее от доли сожжённых войск
// (парабола respiteTicks: 20 % → 1 мин, 50 % → 2, 100 % → 3). Мгновенно:
// списываем золото и войска (доля r = troops интента / войска игрока, как у
// Раскола), ядро объявляет передышку (отзыв атак к/от игрока, гейт
// canAttackPlayer), бонус Гордости ×2 на время. Кулдауна нет — платишь войсками.
import {
  respiteTicks,
  TERRON_RESPITE_MIN_RATIO,
} from "../configuration/TerronTuning";
import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class RespiteExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private player: Player,
    private tile: TileRef,
    private troops: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    this.active = false;
    if (this.player.canBuild(UnitType.Respite, this.tile) === false) {
      console.warn("cannot declare respite");
      return;
    }
    const have = this.player.troops();
    if (have <= 0) return;
    // Минимум TERRON_RESPITE_MIN_RATIO войск: иначе 1M + 1 солдат = вечная
    // неуязвимость по 30с без кулдауна (ревью 23.08).
    const spend = Math.min(
      have,
      Math.max(
        Math.ceil(have * TERRON_RESPITE_MIN_RATIO),
        Math.floor(this.troops),
      ),
    );
    const ratio = spend / have;
    const cost = this.mg.unitInfo(UnitType.Respite).cost(this.mg, this.player);
    this.player.removeGold(cost);
    this.player.removeTroops(spend);
    this.mg.declareRespite(this.player, ticks + respiteTicks(ratio));
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

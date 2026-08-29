// terron 23.08: СЕКРЕТНЫЙ КРУГ — «ты нашёл клад» (new-units/CUBE.md).
//
// Обмен «слот ульты → деньги сейчас»: постройка ничего не стоит, но занимает
// единственный на матч выбор ульты, а взамен разом выдаёт TERRON_TREASURE_PAYOUT.
//
// ⚠️ Выплата ровно ОДНА и происходит по ДОСТРОЙКЕ, а не по закладке: иначе
// снос недостроенного здания и повторная закладка печатали бы золото. Порог
// «сколько уже заработал» проверяется отдельно, в PlayerImpl.canBuildUnitType —
// там, где решается, существует ли клад для этого игрока вообще.
import { TERRON_TREASURE_PAYOUT } from "../configuration/TerronTuning";
import { Player, Unit } from "../game/Game";
import { UltimateBuildingExecution } from "./UltimateBuildingExecution";

export class TreasureExecution extends UltimateBuildingExecution {
  private paid = false;

  constructor(hq: Unit) {
    super(hq);
  }

  protected run(player: Player, _ticks: number): void {
    if (this.paid) {
      // Клад отдал своё; дальше здание просто стоит трофеем.
      this.active = false;
      return;
    }
    this.paid = true;
    player.addGold(TERRON_TREASURE_PAYOUT, this.hq.tile());
  }
}

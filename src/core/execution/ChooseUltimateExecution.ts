import { Execution, Game, Player, UnitType } from "../game/Game";

// terron: ультимейты-ПАССИВ — фиксация выбора ульты без постройки/пуска (напр.
// Реваншизм). Одноразовая: player.chooseUltimate сам защищён от повторной фиксации
// (только null→выбор), поэтому дубль-интент безвреден.
export class ChooseUltimateExecution implements Execution {
  constructor(
    private player: Player,
    private unitType: UnitType,
  ) {}

  init(mg: Game, ticks: number): void {
    this.player.chooseUltimate(this.unitType);
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

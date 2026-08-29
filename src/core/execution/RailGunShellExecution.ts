// terron: ДОРА — каст «ВЫСТРЕЛ» (new-units/DORA.md). Сам по себе он ничего не
// взрывает: он НАЗНАЧАЕТ ОРУДИЮ ЦЕЛЬ. Дальше работает RailGunExecution —
// если цель уже в радиусе, орудие бьёт по готовности перезарядки; если нет,
// оно едет по рельсам, пока не достанет.
//
// Цена списывается при НАЗНАЧЕНИИ, а не при попадании: иначе игрок ставил бы
// цели бесплатно и гонял орудие по карте туда-сюда без всяких затрат.
import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class RailGunShellExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    this.active = false;
    if (this.player.canBuild(UnitType.RailGunShell, this.tile) === false) {
      return;
    }
    const gun = this.player
      .units(UnitType.RailGun)
      .find((u) => u.isActive() && !u.isUnderConstruction());
    if (gun === undefined) return;

    const cost = this.mg
      .unitInfo(UnitType.RailGunShell)
      .cost(this.mg, this.player);
    if (this.player.gold() < cost) return;
    this.player.removeGold(cost);

    gun.setTargetTile(this.tile);
  }

  isActive(): boolean {
    return this.active;
  }

  owner(): Player {
    return this.player;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

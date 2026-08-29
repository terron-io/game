import {
  TERRON_RIVERS_CRATER_ON_INTERCEPT,
  TERRON_RIVERS_INTERCEPT_CRATER_FRAC,
} from "../configuration/TerronTuning";
import {
  Execution,
  Game,
  MessageType,
  Nukes,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { NukeType } from "../StatsSchemas";
import { floodWaterCrater } from "./NukeExecution";
import { detonateDroneBlast } from "./SuicideDroneExecution";

export class SAMMissileExecution implements Execution {
  private active = true;
  private pathFinder: SteppingPathFinder<TileRef>;
  private SAMMissile: Unit | undefined;
  private mg: Game;
  private speed: number = 0;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
    private targetTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinding.Air(mg);
    this.mg = mg;
    this.speed = this.mg.config().defaultSamMissileSpeed();
  }

  tick(ticks: number): void {
    this.SAMMissile ??= this._owner.buildUnit(
      UnitType.SAMMissile,
      this.spawn,
      {},
    );
    if (!this.SAMMissile.isActive()) {
      this.active = false;
      return;
    }
    // terron: ПВО-ракета бьёт по ЯДЕРКАМ и по авиации (десант/дрон).
    // ⚠️ 07.08 (жалоба игроков «водяную ПВО не сбивает»): список ядерок здесь был
    // ЗАХАРДКОЖЕН и новую ракету «Реки вспять» не включал. Пусковая её видела и
    // даже стреляла, а вот САМА ракета ПВО у цели разворачивалась — цель не в
    // списке. Теперь ядерки берём из группы Nukes (реестр), поэтому следующая
    // ракета будет сбиваться сама. Спека: airport.md, new-units/ULTIMATES.md
    const targetType = this.target.type();
    const canHit =
      Nukes.has(targetType) ||
      targetType === UnitType.AirborneAssault ||
      targetType === UnitType.SuicideDrone;
    if (
      !this.target.isActive() ||
      !this.ownerUnit.isActive() ||
      this.target.owner() === this.SAMMissile.owner() ||
      !canHit
    ) {
      // Clear the flag so other SAMs can re-target this target
      if (this.target.isActive()) {
        this.target.setTargetedBySAM(false);
      }
      this.SAMMissile.delete(false);
      this.active = false;
      return;
    }
    // terron: авиа-цели (десант/дрон) ДВИГАЮТСЯ → ракета самонаводится на текущий тайл цели
    // каждый тик (иначе прилетит в пустое место). Ядерки — по заранее вычисленной точке.
    const homing =
      this.target.type() === UnitType.AirborneAssault ||
      this.target.type() === UnitType.SuicideDrone;
    const dst = homing ? this.target.tile() : this.targetTile;
    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.next(this.SAMMissile.tile(), dst);
      if (result.status === PathStatus.COMPLETE) {
        this.active = false;
        this.onHit();
        this.SAMMissile.delete(false);
        return;
      } else if (result.status === PathStatus.NEXT) {
        this.SAMMissile.move(result.node);
      }
    }
  }

  // terron: контакт ракеты ПВО с целью. Дрон — детонирует в точке перехвата (всё равно
  // взрывается), десант/ядерка — уничтожаются. delete(true) даёт FX-взрыв. Спека: airport.md
  private onHit(): void {
    const type = this.target.type();
    const targetOwner = this.target.owner();
    if (type === UnitType.SuicideDrone) {
      const droneTile = this.target.tile();
      this.target.delete(true, this._owner);
      detonateDroneBlast(this.mg, droneTile, targetOwner);
      this.mg.displayMessage(
        "events_display.drone_shot_down",
        MessageType.SAM_HIT,
        this._owner.id(),
      );
      this.mg.displayMessage(
        "events_display.your_drone_shot_down",
        MessageType.ATTACK_FAILED,
        targetOwner.id(),
      );
      return;
    }
    if (type === UnitType.AirborneAssault) {
      this.target.delete(true, this._owner);
      this.mg.displayMessage(
        "events_display.air_assault_shot_down",
        MessageType.SAM_HIT,
        this._owner.id(),
      );
      this.mg.displayMessage(
        "events_display.your_air_assault_shot_down",
        MessageType.ATTACK_FAILED,
        targetOwner.id(),
      );
      return;
    }
    // Nuke — «Перехвачена ракета «…»» владельцу ПВО (обычно = жертве). Это уже
    // покрывает «ядерка сбита» в чате; отдельного дубля не добавляем.
    this.mg.displayMessage(
      "events_display.missile_intercepted",
      MessageType.SAM_HIT,
      this._owner.id(),
      undefined,
      { unit: type },
    );
    const interceptTile = this.target.tile();
    this.target.delete(true, this._owner);
    this.mg.stats().bombIntercept(this._owner, type as NukeType, 1);

    // terron 07.08 (ПРОБА по решению владельца, флаг в TerronTuning): сбитая
    // водяная ракета всё равно топит землю — В ТОЧКЕ ПЕРЕХВАТА и вдвое меньшей
    // воронкой. Остальные ракеты перехват отменяет полностью, как и раньше.
    if (type === UnitType.WaterNuke && TERRON_RIVERS_CRATER_ON_INTERCEPT) {
      floodWaterCrater(
        this.mg,
        interceptTile,
        targetOwner,
        TERRON_RIVERS_INTERCEPT_CRATER_FRAC,
      );
    }
  }

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

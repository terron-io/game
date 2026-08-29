// terron 23.08: ДОРА — ПОЛЁТ СНАРЯДА (new-units/DORA.md).
//
// Решение владельца: «сбить нельзя, просто быстрый пумк». То есть снаряд
// ВИДНО — он летит от орудия к цели, — но перехвату он не подлежит: его нет
// среди целей SAMLauncherExecution (там перечислены только ракеты), и это не
// забывчивость, а правило. Контрплей Доры живёт в путях: снеси станцию за
// орудием, и оно застрянет. У снаряда контрплея быть не должно.
//
// Летит по прямой на большой скорости: на максимальной дальности это доли
// секунды. Раньше попадание было мгновенным (телепорт), и выстрел вообще не
// читался глазом.
import {
  TERRON_RAILGUN_SHELL_SPEED,
} from "../configuration/TerronTuning";
import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { MotionPlanRecord } from "../game/MotionPlans";
import { AirPathFinder } from "../pathfinding/PathFinder.Air";
import { detonateDroneBlast } from "./SuicideDroneExecution";

export class RailGunShellFlight implements Execution {
  private active = true;
  private mg: Game;
  private shell: Unit | undefined;
  private path: TileRef[] = [];
  private idx = 0;

  constructor(
    private readonly player: Player,
    private readonly from: TileRef,
    private readonly to: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.isValidRef(this.to)) {
      this.active = false;
      return;
    }
    // Снаряд бесплатный: за выстрел уже заплачено при постановке цели.
    this.shell = this.player.buildUnit(UnitType.RailGunShell, this.from, {
      targetTile: this.to,
    });

    const pf = new AirPathFinder(this.mg);
    const full = pf.findPath(this.from, this.to) ?? [this.from];
    if (full.length === 0 || full[0] !== this.from) full.unshift(this.from);
    // Прореживаем по скорости — клиентская интерполяция обязана совпасть с симом.
    const step: TileRef[] = [];
    for (let i = 0; i < full.length; i += TERRON_RAILGUN_SHELL_SPEED) {
      step.push(full[i]);
    }
    const last = full[full.length - 1];
    if (step[step.length - 1] !== last) step.push(last);
    this.path = step;
    this.idx = 0;

    const plan: MotionPlanRecord = {
      kind: "grid",
      unitId: this.shell.id(),
      planId: 1,
      startTick: ticks + 1,
      ticksPerStep: 1,
      path: this.path,
    };
    this.mg.recordMotionPlan(plan);
  }

  tick(_ticks: number): void {
    if (this.shell === undefined) {
      this.active = false;
      return;
    }
    this.idx++;
    if (this.idx >= this.path.length) {
      this.shell.delete(false);
      this.active = false;
      // source="railgun": снесённые ульты идут в ключ Депо смерти,
      // а дроновый счётчик «Осадного» выстрел Доры больше не накручивает.
      detonateDroneBlast(
        this.mg,
        this.to,
        this.player,
        UnitType.SuicideDrone,
        "railgun",
      );
      return;
    }
    this.shell.move(this.path[this.idx]);
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

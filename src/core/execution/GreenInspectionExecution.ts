// terron: ЗЕЛЁНЫЕ — ГРАЖДАНСКИЙ БОРТ-ИНСПЕКЦИЯ (new-units/GREEN.md).
// Вылетает из штаба Зелёных к воронке свежей детонации; ПО ПРИЛЁТУ вешает на
// ТОГО, КТО ПУСТИЛ ракету, ступени штрафа к доходу («Это катастрофа!»).
//
// ⚠️ ПЕРЕХВАТУ НЕ ПОДЛЕЖИТ (решение владельца 23.08: «не надо по мирным целям
// бахать ПВО, это обычный гражданский торговый самолёт»). Поэтому его нет
// среди целей SAMLauncherExecution, и «сбить инспекцию» нельзя в принципе.
// Контрплей ровно один: СНЕСТИ ШТАБ ЗЕЛЁНЫХ, пока борт в воздухе, — тогда
// штраф не встаёт вовсе. Время полёта и есть окно ответа, поэтому дальняя
// воронка даёт жертве шанс, а ближняя — почти нет.
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { MotionPlanRecord } from "../game/MotionPlans";
import { AirPathFinder } from "../pathfinding/PathFinder.Air";

export class GreenInspectionExecution implements Execution {
  private active = true;
  private mg: Game;
  private craft: Unit | undefined;
  private path: TileRef[] = [];
  private idx = 0;
  private speed = 2;

  constructor(
    private readonly greens: Player,
    private readonly src: TileRef,
    private readonly dst: TileRef,
    private readonly culprit: Player,
    private readonly steps: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.speed = Math.max(1, mg.config().airplaneSpeed());
    if (!mg.isValidRef(this.dst) || this.steps <= 0) {
      this.active = false;
      return;
    }

    // Борт бесплатный: это не оружие, а реакция мира на детонацию. Цена ульты
    // уже уплачена штабом, брать ещё и за вылет — двойная плата.
    this.craft = this.greens.buildUnit(UnitType.GreenInspection, this.src, {
      targetTile: this.dst,
      culpritSmallID: this.culprit.smallID(),
      steps: this.steps,
    });

    const pf = new AirPathFinder(this.mg);
    const full = pf.findPath(this.src, this.dst) ?? [this.src];
    if (full.length === 0 || full[0] !== this.src) full.unshift(this.src);
    // Прореживаем по скорости, чтобы клиентская интерполяция совпала с симом.
    const step: TileRef[] = [];
    for (let i = 0; i < full.length; i += this.speed) step.push(full[i]);
    const last = full[full.length - 1];
    if (step[step.length - 1] !== last) step.push(last);
    this.path = step;
    this.idx = 0;

    const motionPlan: MotionPlanRecord = {
      kind: "grid",
      unitId: this.craft.id(),
      planId: 1,
      startTick: ticks + 1,
      ticksPerStep: 1,
      path: this.path,
    };
    this.mg.recordMotionPlan(motionPlan);
  }

  tick(_ticks: number): void {
    if (this.craft === undefined) {
      this.active = false;
      return;
    }
    // Штаб снесли (или борт удалён) — рейс сорван, штрафа НЕ будет. Это и есть
    // единственное окно контрплея, см. шапку файла.
    if (!this.craft.isActive() || !this.greens.hasUltimate(UnitType.Greens)) {
      if (this.craft.isActive()) this.craft.delete(false);
      this.active = false;
      return;
    }

    this.idx++;
    if (this.idx >= this.path.length) {
      this.arrive();
      return;
    }
    this.craft.move(this.path[this.idx]);
  }

  private arrive(): void {
    this.craft!.delete(false);
    this.active = false;
    if (!this.culprit.isAlive()) return;
    this.culprit.addCatastropheStacks(this.steps);
    const pct = Math.round(
      (1 - this.culprit.catastropheGoldMult()) * 100,
    );
    // Лента — всем: штраф обязан читаться, иначе жертва увидит просто «доход
    // упал» и не поймёт причину.
    this.mg.displayMessage(
      "events_display.catastrophe_declared",
      MessageType.CATASTROPHE,
      null,
      undefined,
      { name: this.culprit.displayName(), pct: String(pct) },
      undefined,
      this.greens.id(),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  owner(): Player {
    return this.greens;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

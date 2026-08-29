import { fuelSpeedMult } from "../game/FuelSpeed";
// terron: авиация — воздушная высадка десанта. Летит НАПРЯМУЮ (AirPathFinder) из БЛИЖАЙШЕГО
// своего аэропорта в любую точку карты; по прибытии conquer + AttackExecution (как морская
// высадка `TransportShipExecution`). Войска списываются при спавне борта; при гибели борта
// (в будущем — ПВО) войска теряются. ПВО-перехват — отдельная фаза. Спека: airport.md
import { renderTroops } from "../../client/Utils";
import {
  TERRON_AIRBORNE_BEACHHEAD_IMMUNITY_TURNS,
  TERRON_AIRBORNE_BEACHHEAD_IMMUNITY_ULT_TURNS,
  TERRON_AIRBORNE_LANDING_FACTOR,
} from "../configuration/TerronTuning";
import {
  Execution,
  Game,
  MessageType,
  Player,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { MotionPlanRecord } from "../game/MotionPlans";
import { AirPathFinder } from "../pathfinding/PathFinder.Air";
import { findClosestBy } from "../Util";
import { AttackExecution } from "./AttackExecution";

export class AirborneAssaultExecution implements Execution {
  private active = true;
  private mg: Game;
  private target: Player | TerraNullius;
  private craft: Unit | undefined;
  private path: TileRef[] = [];
  private idx = 0;
  private speed = 2;

  constructor(
    private attacker: Player,
    private dst: TileRef,
    private troops: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    // terron: ТОПЛИВО — самолёты владельца летят быстрее (дроны и ракеты —
    // НЕТ, решение владельца 23.08). FUEL.md
    this.speed = Math.max(
      1,
      mg.config().airplaneSpeed() * fuelSpeedMult(this.attacker),
    );

    if (!mg.isValidRef(this.dst)) {
      this.active = false;
      return;
    }
    // terron: фикс прод-краша «cannot conquer water» — десант в воду (клик по
    // морю) долетал и conquer ронял весь воркер. Вода = невалидная цель.
    if (!mg.isLand(this.dst)) {
      this.active = false;
      return;
    }
    this.target = mg.owner(this.dst);
    if (this.target === this.attacker) {
      this.active = false;
      return;
    }
    if (this.target.isPlayer() && !this.attacker.canAttackPlayer(this.target)) {
      this.active = false;
      return;
    }

    // Nearest OWN active airport to the drop point.
    const airport = findClosestBy(
      this.attacker.units(UnitType.Airport),
      (a) => this.mg.manhattanDist(a.tile(), this.dst),
      (a) =>
        a.isActive() && !a.isUnderConstruction() && !a.isMarkedForDeletion(),
    );
    if (airport === null) {
      this.active = false;
      return;
    }

    this.troops = Math.min(this.troops, this.attacker.troops());
    if (this.troops <= 0) {
      this.active = false;
      return;
    }

    // terron: авиация — десант теперь стоит золото (100k…1kk). Не запускаем без денег
    // (buildUnit списал бы золото в 0). airport.md
    const cost = this.mg
      .config()
      .unitInfo(UnitType.AirborneAssault)
      .cost(this.mg, this.attacker);
    if (this.attacker.gold() < cost) {
      this.active = false;
      return;
    }

    const srcTile = airport.tile();
    const spawn = this.attacker.canBuild(UnitType.AirborneAssault, srcTile);
    if (spawn === false) {
      this.active = false;
      return;
    }
    // buildUnit deducts troops from the attacker (params.troops).
    this.craft = this.attacker.buildUnit(UnitType.AirborneAssault, spawn, {
      troops: this.troops,
      targetTile: this.dst,
    });

    const pf = new AirPathFinder(this.mg);
    const full = pf.findPath(srcTile, this.dst) ?? [srcTile];
    if (full.length === 0 || full[0] !== srcTile) {
      full.unshift(srcTile);
    }
    // Decimate by speed so client interpolation matches the sim (speed tiles/tick).
    const step: TileRef[] = [];
    for (let i = 0; i < full.length; i += this.speed) {
      step.push(full[i]);
    }
    const last = full[full.length - 1];
    if (step[step.length - 1] !== last) {
      step.push(last);
    }
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

    if (this.target.id() !== mg.terraNullius().id()) {
      mg.displayIncomingUnit(
        this.craft.id(),
        `Airborne assault incoming from ${this.attacker.displayName()} (${renderTroops(this.troops)})`,
        MessageType.NAVAL_INVASION_INBOUND,
        this.target.id(),
      );
    }
  }

  tick(ticks: number): void {
    if (this.craft === undefined) {
      this.active = false;
      return;
    }
    // Shot down / removed → troops lost (already deducted at spawn).
    if (!this.craft.isActive()) {
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
    const attacker = this.attacker;
    const dst = this.dst;
    const troops = this.craft!.troops();
    // terron: успешная посадка = «долетел» → без FX-взрыва (взрыв только когда сбили ПВО,
    // тогда reachedTarget остаётся false). Спека: airport.md
    this.craft!.setReachedTarget();
    this.craft!.delete(false);
    this.active = false;

    // Landed on our own tile → just return the troops home.
    if (this.mg.owner(dst) === attacker) {
      attacker.addTroops(troops);
      return;
    }

    // terron: суша могла стать ВОДОЙ за время полёта (терратомик/конверсии
    // WaterManager) — conquer(вода) кидает исключение и валит симуляцию.
    // Борт садится в море: войска потеряны, но матч жив.
    if (!this.mg.isLand(dst)) {
      return;
    }

    attacker.conquer(dst);
    if (this.target.isPlayer() && attacker.isFriendly(this.target)) {
      attacker.addTroops(troops);
    } else {
      // terron: авиация — ШТРАФ за высадку в тылу: отправили x1, садится x0.5 (половину
      // «перестреляли пока садились»). Списаны при старте все, до боя доходит половина.
      // Ульта Авиаштаб: высадка БЕЗ потерь (100%) и плацдарм вдвое дольше.
      const hasAirCommand = attacker.hasUltimate(UnitType.AirCommand);
      const landed = hasAirCommand
        ? troops
        : Math.max(1, Math.floor(troops * TERRON_AIRBORNE_LANDING_FACTOR));
      // метим точку высадки плацдармом: её кластер временно защищён от авто-схлопывания
      // окружением (иначе десант в тылу мгновенно отбирается removeClusters). airport.md.
      attacker.addAirborneBeachhead(
        dst,
        this.mg.ticks() +
          (hasAirCommand
            ? TERRON_AIRBORNE_BEACHHEAD_IMMUNITY_ULT_TURNS
            : TERRON_AIRBORNE_BEACHHEAD_IMMUNITY_TURNS),
      );
      this.mg.addExecution(
        new AttackExecution(landed, attacker, this.target.id(), dst, false),
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

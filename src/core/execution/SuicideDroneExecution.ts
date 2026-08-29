// terron: авиация — дрон-камикадзе. Летит НАПРЯМУЮ (AirPathFinder) из БЛИЖАЙШЕГО своего
// аэропорта в указанную точку и взрывается: мини-ядерка (½ цены атомной, радиус ⅓ —
// см. Config.nukeMagnitudes(SuicideDrone) = inner4/outer10). В отличие от ядерки НЕ
// превращает землю в воду — снимает территорию (relinquish) + убивает войска + уничтожает
// юниты в радиусе. ПВО сбивает дрон ракетой (SAMMissileExecution) → дрон ВСЁ РАВНО детонирует
// в точке перехвата (detonateDroneBlast). Спека: airport.md.
import {
  Execution,
  Game,
  MessageType,
  Player,
  Structures,
  TerraNullius,
  Ultimates,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { MotionPlanRecord } from "../game/MotionPlans";
import { AirPathFinder } from "../pathfinding/PathFinder.Air";
import { PseudoRandom } from "../PseudoRandom";
import { findClosestBy } from "../Util";

export class SuicideDroneExecution implements Execution {
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
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.speed = Math.max(1, mg.config().airplaneSpeed());

    if (!mg.isValidRef(this.dst)) {
      this.active = false;
      return;
    }
    this.target = mg.owner(this.dst);

    // terron: ближайший свой ГОТОВЫЙ аэропорт (не в кулдауне запуска дрона —
    // ровно как ядерка берёт ближайшую готовую шахту). Если из аэропорта только
    // что вылетал дрон, он «занят» ещё AirportDroneCooldown → берётся следующий.
    const airport = findClosestBy(
      this.attacker.units(UnitType.Airport),
      (a) => this.mg.manhattanDist(a.tile(), this.dst),
      (a) =>
        a.isActive() &&
        !a.isUnderConstruction() &&
        !a.isMarkedForDeletion() &&
        !a.isInCooldown(),
    );
    if (airport === null) {
      this.active = false;
      return;
    }

    // Affordability guard (buildUnit deducts gold; avoid firing a free drone).
    const cost = this.mg
      .config()
      .unitInfo(UnitType.SuicideDrone)
      .cost(this.mg, this.attacker);
    if (this.attacker.gold() < cost) {
      this.active = false;
      return;
    }

    const srcTile = airport.tile();
    const spawn = this.attacker.canBuild(UnitType.SuicideDrone, this.dst);
    if (spawn === false) {
      this.active = false;
      return;
    }
    // buildUnit deducts the drone cost from the attacker.
    this.craft = this.attacker.buildUnit(UnitType.SuicideDrone, srcTile, {
      targetTile: this.dst,
    });
    // terron: ставим аэропорт на кулдаун запуска (как шахту при пуске ракеты) —
    // launch() пушит текущий тик в очередь; AirportExecution снимет по кулдауну.
    airport.launch();

    const pf = new AirPathFinder(this.mg);
    const full = pf.findPath(srcTile, this.dst) ?? [srcTile];
    if (full.length === 0 || full[0] !== srcTile) {
      full.unshift(srcTile);
    }
    // Decimate by speed so client interpolation matches the sim.
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

    if (this.target.isPlayer()) {
      mg.displayIncomingUnit(
        this.craft.id(),
        `Suicide drone incoming from ${this.attacker.displayName()}`,
        MessageType.SUICIDE_DRONE_INBOUND,
        this.target.id(),
      );
    }
  }

  tick(ticks: number): void {
    if (this.craft === undefined) {
      this.active = false;
      return;
    }
    // Сбит ПВО/удалён: сам НЕ детонируем — подрыв в точке перехвата делает SAMMissile. airport.md
    if (!this.craft.isActive()) {
      this.active = false;
      return;
    }

    this.idx++;
    if (this.idx >= this.path.length) {
      this.detonate();
      return;
    }
    this.craft.move(this.path[this.idx]);
  }

  private detonate(): void {
    this.craft!.delete(false);
    this.active = false;
    // terron: взрыв в целевой точке (нормальный подрыв). Спека: airport.md
    detonateDroneBlast(this.mg, this.dst, this.attacker);
  }

  isActive(): boolean {
    return this.active;
  }

  owner(): Player {
    return this.attacker;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

// terron: авиация — подрыв дрона-камикадзе в точке `dst` (площадь: снятие территории +
// урон войскам + уничтожение юнитов в радиусе). Вынесено, чтобы ПВО могло подорвать дрон
// в точке ПЕРЕХВАТА (сбитый дрон всё равно взрывается). Спека: airport.md
export function detonateDroneBlast(
  mg: Game,
  dst: TileRef,
  destroyer: Player,
  // terron: АЭС — «Чернобыль» переиспользует этот же взрыв, но водородного
  // калибра. По умолчанию — прежний размер дрона, поведение не меняется.
  // new-units/NUCLEAR.md
  magnitudeType: UnitType = UnitType.SuicideDrone,
  // terron 24.08: кто взорвал — для ачивок-ключей. «railgun» = выстрел Доры:
  // считает снесённые ульт-здания (ключ Депо смерти), в дроновый счётчик не
  // пишет. «selfdestruct» = самоподрыв (захваченная ульта, Дора на чужой
  // земле) — не пишет НИ В ОДИН ключ: находка ревью 24.08 — с дефолтным
  // source самоподрыв Доры в чужой застройке фармил siege_key без дронов.
  source: "drone" | "railgun" | "selfdestruct" = "drone",
): void {
  const config = mg.config();

  const magnitude = config.nukeMagnitudes(magnitudeType);
  const inner2 = magnitude.inner * magnitude.inner;
  const outer2 = magnitude.outer * magnitude.outer;
  const rand = new PseudoRandom(mg.ticks());

  // Tiles in the blast: inner ring always, outer ring 50% (matches nuke feel).
  const toDestroy = mg.bfs(dst, (_, n: TileRef) => {
    const d2 = mg.euclideanDistSquared(dst, n);
    return d2 <= outer2 && (d2 <= inner2 || rand.chance(2));
  });

  // Relinquish captured tiles (become neutral — NO water conversion, unlike a nuke).
  const tilesPerPlayers = new Map<Player, number>();
  for (const tile of toDestroy) {
    const owner = mg.owner(tile);
    if (owner.isPlayer()) {
      owner.relinquish(tile);
      tilesPerPlayers.set(owner, (tilesPerPlayers.get(owner) ?? 0) + 1);
    }
  }

  // Kill troops in the zone (same diminishing model as a nuke, type-agnostic factor).
  for (const [player, numImpacted] of tilesPerPlayers) {
    const tilesBefore = player.numTilesOwned() + numImpacted;
    const maxTroops = config.maxTroops(player);
    for (let i = 0; i < numImpacted; i++) {
      const numTilesLeft = tilesBefore - i;
      player.removeTroops(
        config.nukeDeathFactor(
          UnitType.AtomBomb,
          player.troops(),
          numTilesLeft,
          maxTroops,
        ),
      );
    }
  }

  // Destroy other units caught in the outer radius (ignore nukes/SAM missiles/drones).
  for (const unit of mg.units()) {
    const type = unit.type();
    if (
      type === UnitType.AtomBomb ||
      type === UnitType.HydrogenBomb ||
      type === UnitType.MIRVWarhead ||
      type === UnitType.MIRV ||
      type === UnitType.SAMMissile ||
      type === UnitType.SuicideDrone
    ) {
      continue;
    }
    if (mg.euclideanDistSquared(dst, unit.tile()) < outer2) {
      // terron: ключ «Осадный» считает здания, снесённые ИМЕННО дроном.
      // Гейт по калибру: этой же функцией пользуются «Чернобыль» АЭС и
      // самоподрыв захваченной ульты, их сносы в ключ идти не должны. DORA.md
      // Недострой в ключи не идёт (фундамент — не «снесённое здание»).
      if (
        source === "drone" &&
        magnitudeType === UnitType.SuicideDrone &&
        Structures.has(unit.type()) &&
        unit.owner() !== destroyer &&
        !unit.isUnderConstruction()
      ) {
        mg.stats().dronedBuilding(destroyer);
      }
      // terron 24.08: ключ Депо смерти — ульт-здания под выстрелом Доры,
      // ЧУЖИЕ И СВОИ (решение владельца: «чужих-своих»). Исключения ревью
      // 24.08: нефтяная вышка (единственная «ульта» без лимита копий —
      // свои вышки в зоне доезда фармили бы ключ за один матч) и клад.
      if (
        source === "railgun" &&
        Ultimates.has(unit.type()) &&
        unit.type() !== UnitType.OilRig &&
        unit.type() !== UnitType.SecretTreasure &&
        !unit.isUnderConstruction()
      ) {
        mg.stats().railgunUltKill(destroyer);
      }
      unit.delete(true, destroyer);
    }
  }
}

import {
  TERRON_OURSKY_SAM_RADIUS_MULT,
  TERRON_OURSKY_SAM_RELOAD_MULT,
} from "../configuration/TerronTuning";
import {
  Execution,
  Game,
  isUnit,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";

// terron: «Небо наше» (реворк 21.08) — штаб сам является ПВО с радиусом
// ×TERRON_OURSKY_SAM_RADIUS_MULT от базового. Эта экзекуция обслуживает и
// обычные ПВО, и штаб (ConstructionExecution кладёт её на юнит OurSky);
// весь расчёт радиуса обязан идти через этот хелпер. NEBO.md
export function samEffectiveRange(mg: Game, sam: Unit): number {
  const base = mg.config().samRange(sam.level());
  return sam.type() === UnitType.OurSky
    ? base * TERRON_OURSKY_SAM_RADIUS_MULT
    : base;
}

// terron: «Небо наше» — пассив: пока штаб владельца стоит (достроен, в т.ч.
// захваченный чужой — пассивки работают у захватчика), ВСЕ его ПВО
// перезаряжаются быстрее. Целые тики (детерминизм). NEBO.md
export function samEffectiveCooldown(mg: Game, owner: Player): number {
  const base = mg.config().SAMCooldown();
  return owner.hasUltimate(UnitType.OurSky)
    ? Math.round(base * TERRON_OURSKY_SAM_RELOAD_MULT)
    : base;
}

type Target = {
  unit: Unit;
  tile: TileRef;
};

type InterceptionTile = {
  tile: TileRef;
  tick: number;
};

/**
 * Smart SAM targeting system preshoting nukes so its range is strictly enforced
 */
class SAMTargetingSystem {
  // Interception tiles are computed a single time, but it may not be reachable yet.
  // Store the result so it can be intercepted at the proper time, rather than recomputing each tick.
  // Null interception tile means there are no interception tiles in range. Store it to avoid recomputing.
  private readonly precomputedNukes: Map<number, InterceptionTile | null> =
    new Map();
  private readonly missileSpeed: number;

  constructor(
    private readonly mg: Game,
    private readonly sam: Unit,
  ) {
    this.missileSpeed = this.mg.config().defaultSamMissileSpeed();
  }

  updateUnreachableNukes(nearbyUnits: { unit: Unit; distSquared: number }[]) {
    if (this.precomputedNukes.size === 0) {
      return;
    }

    // Avoid per-tick allocations for the common case where only a few nukes are tracked.
    if (this.precomputedNukes.size <= 16) {
      for (const nukeId of this.precomputedNukes.keys()) {
        let found = false;
        for (const u of nearbyUnits) {
          if (u.unit.id() === nukeId) {
            found = true;
            break;
          }
        }
        if (!found) {
          this.precomputedNukes.delete(nukeId);
        }
      }
      return;
    }

    const nearbyUnitSet = new Set<number>();
    for (const u of nearbyUnits) {
      nearbyUnitSet.add(u.unit.id());
    }
    for (const nukeId of this.precomputedNukes.keys()) {
      if (!nearbyUnitSet.has(nukeId)) {
        this.precomputedNukes.delete(nukeId);
      }
    }
  }

  private tickToReach(currentTile: TileRef, tile: TileRef): number {
    return Math.ceil(
      this.mg.manhattanDist(currentTile, tile) / this.missileSpeed,
    );
  }

  private computeInterceptionTile(
    unit: Unit,
    samTile: TileRef,
    rangeSquared: number,
  ): InterceptionTile | undefined {
    const trajectory = unit.trajectory();
    const currentIndex = unit.trajectoryIndex();
    const explosionTick: number = trajectory.length - currentIndex;
    for (let i = currentIndex; i < trajectory.length; i++) {
      const trajectoryTile = trajectory[i];
      if (
        trajectoryTile.targetable &&
        this.mg.euclideanDistSquared(samTile, trajectoryTile.tile) <=
          rangeSquared
      ) {
        const nukeTickToReach = i - currentIndex;
        const samTickToReach = this.tickToReach(samTile, trajectoryTile.tile);
        const tickBeforeShooting = nukeTickToReach - samTickToReach;
        if (samTickToReach < explosionTick && tickBeforeShooting >= 0) {
          return { tick: tickBeforeShooting, tile: trajectoryTile.tile };
        }
      }
    }
    return undefined;
  }

  public getSingleTarget(ticks: number): Target | null {
    const samTile = this.sam.tile();
    const range = samEffectiveRange(this.mg, this.sam);
    const rangeSquared = range * range;

    // Look beyond the SAM range so it can preshot nukes
    // (terron: у штаба Неба радиус ×5 — окно обнаружения обязано его покрывать)
    const detectionRange =
      Math.max(this.mg.config().maxSamRange(), range) * 2;
    const nukes = this.mg.nearbyUnits(
      samTile,
      detectionRange,
      // terron: ультимейты — «Реки вспять» перехватывается как обычная ракета
      // (контрплей: у неё необратимый эффект, значит должна быть сбиваема).
      [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.WaterNuke],
      ({ unit }) => {
        if (!isUnit(unit) || unit.targetedBySAM()) return false;
        if (unit.owner() === this.sam.owner()) return false;

        const samOwner = this.sam.owner();
        const nukeOwner = unit.owner();

        // terron: МИРНОЕ НЕБО — ПЛАТА за дешёвые ПВО: установки владельца
        // сбивают ВСЁ чужое в радиусе, включая ракеты СОЮЗНИКОВ. В обычной
        // игре союзная ракета пролетает сквозь тебя свободно (ветка ниже) —
        // здесь нет: над тобой не летает никто, и бить «через тебя» коалиция
        // больше не может. Название буквальное. new-units/PEACEFULSKY.md
        if (samOwner.hasUltimate(UnitType.PeacefulSky)) return true;
        // After game-over in team games, SAMs also target teammate nukes (aftergame fun)
        if (samOwner.isFriendly(nukeOwner)) {
          return (
            this.mg.getWinner() !== null && samOwner.isOnSameTeam(nukeOwner)
          );
        }

        return true;
      },
    );

    // Clear unreachable nukes that went out of range
    this.updateUnreachableNukes(nukes);

    let best: Target | null = null;
    for (const nuke of nukes) {
      const nukeId = nuke.unit.id();
      const cached = this.precomputedNukes.get(nukeId);
      if (cached !== undefined) {
        if (cached === null) {
          // Already computed as unreachable, skip
          continue;
        }
        if (cached.tick === ticks) {
          // Time to shoot!
          const target = { tile: cached.tile, unit: nuke.unit };
          if (
            best === null ||
            (target.unit.type() === UnitType.HydrogenBomb &&
              best.unit.type() !== UnitType.HydrogenBomb)
          ) {
            best = target;
          }
          this.precomputedNukes.delete(nukeId);
          continue;
        }
        if (cached.tick > ticks) {
          // Not due yet, skip for now.
          continue;
        }
        // Missed the planned tick (e.g was on cooldown), recompute a new interception tile if possible
        this.precomputedNukes.delete(nukeId);
      }
      const interceptionTile = this.computeInterceptionTile(
        nuke.unit,
        samTile,
        rangeSquared,
      );
      if (interceptionTile !== undefined) {
        if (interceptionTile.tick <= 1) {
          // Shoot instantly

          const target = { unit: nuke.unit, tile: interceptionTile.tile };
          if (
            best === null ||
            (target.unit.type() === UnitType.HydrogenBomb &&
              best.unit.type() !== UnitType.HydrogenBomb)
          ) {
            best = target;
          }
        } else {
          // Nuke will be reachable but not yet. Store the result.
          this.precomputedNukes.set(nukeId, {
            tick: interceptionTile.tick + ticks,
            tile: interceptionTile.tile,
          });
        }
      } else {
        // Store unreachable nukes in order to prevent useless interception computation
        this.precomputedNukes.set(nukeId, null);
      }
    }

    return best;
  }
}

export class SAMLauncherExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  // As MIRV go very fast we have to detect them very early but we only
  // shoot the one targeting very close (MIRVWarheadProtectionRadius)
  private MIRVWarheadSearchRadius = 400;
  private MIRVWarheadProtectionRadius = 50;
  private targetingSystem: SAMTargetingSystem;

  private pseudoRandom: PseudoRandom | undefined;

  constructor(
    private player: Player,
    private tile: TileRef | null,
    private sam: Unit | null = null,
  ) {
    if (sam !== null) {
      this.tile = sam.tile();
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.player === null) {
      throw new Error("Not initialized");
    }
    if (this.sam === null) {
      if (this.tile === null) {
        throw new Error("tile is null");
      }
      const spawnTile = this.player.canBuild(UnitType.SAMLauncher, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build SAM Launcher");
        this.active = false;
        return;
      }
      this.sam = this.player.buildUnit(UnitType.SAMLauncher, spawnTile, {});
    }
    this.targetingSystem ??= new SAMTargetingSystem(this.mg, this.sam);

    if (this.sam.isUnderConstruction()) {
      return;
    }

    if (!this.sam.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.sam.owner()) {
      this.player = this.sam.owner();
    }

    const frontTime = this.sam.missileTimerQueue()[0];
    if (frontTime !== undefined) {
      // terron: «Небо наше» — пассив ×2 к скорости перезарядки всех ПВО владельца.
      const cooldown =
        samEffectiveCooldown(this.mg, this.sam.owner()) -
        (this.mg.ticks() - frontTime);

      if (cooldown <= 0) {
        this.sam.reloadMissile();
      }
    }
    if (this.sam.isInCooldown()) {
      return;
    }
    // terron ПЕРФ (21.08): при пустом небе КАЖДОЕ ПВО каждый тик делало 3
    // пространственных запроса (ракеты / боеголовки МИРВ / десант+дроны) —
    // у штаба «Небо наше» окно ×5 = ~200 ячеек грида ×3. Глобальные счётчики
    // юнитов — O(игроков) без аллокаций; пустой результат запроса эквивалентен
    // пропуску, детерминизм не затронут.
    if (
      this.mg.unitCount(UnitType.AtomBomb) === 0 &&
      this.mg.unitCount(UnitType.HydrogenBomb) === 0 &&
      this.mg.unitCount(UnitType.WaterNuke) === 0 &&
      this.mg.unitCount(UnitType.MIRVWarhead) === 0 &&
      this.mg.unitCount(UnitType.AirborneAssault) === 0 &&
      this.mg.unitCount(UnitType.SuicideDrone) === 0
    ) {
      return;
    }

    // terron: авиация — ПВО пускает РАКЕТУ по ближайшему вражескому десанту/дрону в радиусе
    // (с кулдауном, как по ядеркам). Ракета летит и подрывает цель (дрон детонирует в точке
    // перехвата). Торговые самолёты НЕ трогаем (баланс отдельно). Спека: airport.md
    if (this.interceptAirborneAssaults()) {
      return;
    }

    this.pseudoRandom ??= new PseudoRandom(this.sam.id());

    // terron: у штаба Неба защитный купол от боеголовок тоже ×5 (он — большое ПВО).
    const warheadProtectionRadius =
      this.sam.type() === UnitType.OurSky
        ? this.MIRVWarheadProtectionRadius * TERRON_OURSKY_SAM_RADIUS_MULT
        : this.MIRVWarheadProtectionRadius;
    const mirvWarheadTargets = this.mg.nearbyUnits(
      this.sam.tile(),
      Math.max(this.MIRVWarheadSearchRadius, warheadProtectionRadius * 2),
      UnitType.MIRVWarhead,
      ({ unit }) => {
        if (!isUnit(unit)) return false;
        if (unit.owner() === this.player) return false;

        // After game-over in team games, SAMs also target teammate MIRVs (aftergame fun)
        const nukeOwner = unit.owner();
        if (this.player.isFriendly(nukeOwner)) {
          if (
            this.mg.getWinner() === null ||
            !this.player.isOnSameTeam(nukeOwner)
          ) {
            return false;
          }
        }

        const dst = unit.targetTile();
        return (
          this.sam !== null &&
          dst !== undefined &&
          this.mg.manhattanDist(dst, this.sam.tile()) < warheadProtectionRadius
        );
      },
    );

    let target: Target | null = null;
    if (mirvWarheadTargets.length === 0) {
      target = this.targetingSystem.getSingleTarget(ticks);
    }

    // target is already filtered to exclude nukes targeted by other SAMs
    if (target || mirvWarheadTargets.length > 0) {
      this.sam.launch();
      const type =
        mirvWarheadTargets.length > 0
          ? UnitType.MIRVWarhead
          : target?.unit.type();
      if (type === undefined) throw new Error("Unknown unit type");
      if (mirvWarheadTargets.length > 0) {
        const samOwner = this.sam.owner();

        // Message
        this.mg.displayMessage(
          "events_display.mirv_warheads_intercepted",
          MessageType.SAM_HIT,
          samOwner.id(),
          undefined,
          { count: mirvWarheadTargets.length },
        );

        mirvWarheadTargets.forEach(({ unit: u }) => {
          // Delete warheads
          u.delete();
        });

        // Record stats
        this.mg
          .stats()
          .bombIntercept(
            samOwner,
            UnitType.MIRVWarhead,
            mirvWarheadTargets.length,
          );
      } else if (target !== null) {
        target.unit.setTargetedBySAM(true);
        this.mg.addExecution(
          new SAMMissileExecution(
            this.sam.tile(),
            this.sam.owner(),
            this.sam,
            target.unit,
            target.tile,
          ),
        );
      } else {
        throw new Error("target is null");
      }
    }
  }

  // terron: авиация — пустить ОДНУ ракету ПВО по ближайшему вражескому десанту/дрону в
  // радиусе (расходует заряд + кулдаун, как по ядеркам). Возвращает true, если выстрелила.
  // Реальный подрыв цели — в SAMMissileExecution.onHit (дрон детонирует). Спека: airport.md
  private interceptAirborneAssaults(): boolean {
    if (this.sam === null) return false;
    const sam = this.sam;
    const samOwner = sam.owner();
    const range = samEffectiveRange(this.mg, sam);
    const targets = this.mg.nearbyUnits(
      sam.tile(),
      range,
      [UnitType.AirborneAssault, UnitType.SuicideDrone],
      ({ unit }) => {
        if (!isUnit(unit)) return false;
        const owner = unit.owner();
        if (owner === samOwner) return false;
        if (samOwner.isFriendly(owner)) return false;
        if (unit.targetedBySAM()) return false; // уже под прицелом другой ПВО
        return true;
      },
    );
    if (targets.length === 0) return false;

    // Ближайшая цель.
    let best = targets[0];
    for (const t of targets) {
      if (t.distSquared < best.distSquared) best = t;
    }
    const target = best.unit;

    sam.launch();
    target.setTargetedBySAM(true);
    this.mg.addExecution(
      new SAMMissileExecution(sam.tile(), samOwner, sam, target, target.tile()),
    );
    return true;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

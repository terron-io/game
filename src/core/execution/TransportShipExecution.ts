import { TERRON_PIRACY_STEALTH_PORT_RADIUS } from "../configuration/TerronTuning";
import { renderTroops } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerType,
  TerraNullius,
  Unit,
  UnitType,
  TradeHubs,
} from "../game/Game";
import { TERRON_MINING_KILL_PCT } from "../configuration/TerronTuning";
import { fuelSpeedMult } from "../game/FuelSpeed";
import { TileRef } from "../game/GameMap";
import { MotionPlanRecord } from "../game/MotionPlans";
import { targetTransportTile } from "../game/TransportShipUtils";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { AttackExecution } from "./AttackExecution";

const malusForRetreat = 25;

export class TransportShipExecution implements Execution {
  private active = true;

  // TODO: make this configurable
  private ticksPerMove = 1;
  private lastMove: number;

  private mg: Game;
  private target: Player | TerraNullius;
  private pathFinder: WaterPathFinder;

  private static _staggerCounter = 0;

  private dst: TileRef | null;
  private src: TileRef | null;
  private retreatDst: TileRef | false | null = null;
  private boat: Unit;
  private motionPlanId = 1;
  private motionPlanDst: TileRef | null = null;

  private originalOwner: Player;

  constructor(
    private attacker: Player,
    private ref: TileRef,
    private troops: number,
  ) {
    this.originalOwner = this.attacker;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!mg.isValidRef(this.ref)) {
      console.warn(`TransportShipExecution: ref ${this.ref} not valid`);
      this.active = false;
      return;
    }

    this.lastMove = ticks;
    this.mg = mg;
    this.target = mg.owner(this.ref);
    const stagger =
      TransportShipExecution._staggerCounter++ % WaterPathFinder.STAGGER_SPREAD;
    this.pathFinder = new WaterPathFinder(mg, stagger, this.attacker);

    if (
      this.attacker.unitCount(UnitType.TransportShip) >=
      mg.config().boatMaxNumber()
    ) {
      mg.displayMessage(
        "events_display.no_boats_available",
        MessageType.ATTACK_FAILED,
        this.attacker.id(),
        undefined,
        { max: mg.config().boatMaxNumber() },
      );
      this.active = false;
      return;
    }

    if (this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (
        targetPlayer.type() !== PlayerType.Bot &&
        this.attacker.type() !== PlayerType.Bot
      ) {
        this.rejectIncomingAllianceRequests(targetPlayer);
      }
    }

    if (this.target === this.attacker) {
      this.active = false;
      return;
    }

    if (this.target.isPlayer() && !this.attacker.canAttackPlayer(this.target)) {
      this.active = false;
      return;
    }

    this.troops ??= this.mg
      .config()
      .boatAttackAmount(this.attacker, this.target);
    this.troops = Math.min(this.troops, this.attacker.troops());

    this.dst = targetTransportTile(this.mg, this.ref);

    if (this.dst === null) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find target tile`,
      );
      this.active = false;
      return;
    }

    const src = this.attacker.canBuild(UnitType.TransportShip, this.dst);

    if (src === false) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find start tile`,
      );
      this.active = false;
      return;
    }

    this.src = src;

    // terron: ПИРАТСТВО — «тихий десант» ТОЛЬКО из порта/штаба (нерф владельца):
    // стартовал не дальше STEALTH_PORT_RADIUS от своего торгового узла → тихий.
    const stealth =
      this.attacker.hasUltimate(UnitType.Piracy) &&
      this.attacker
        .units(...TradeHubs.types)
        .some(
          (h) =>
            h.isActive() &&
            !h.isUnderConstruction() &&
            this.mg.manhattanDist(h.tile(), src) <=
              TERRON_PIRACY_STEALTH_PORT_RADIUS,
        );

    this.boat = this.attacker.buildUnit(UnitType.TransportShip, this.src, {
      troops: this.troops,
      targetTile: this.dst,
    });

    const fullPath = this.pathFinder.findPath(this.src, this.dst) ?? [this.src];
    if (fullPath.length === 0 || fullPath[0] !== this.src) {
      fullPath.unshift(this.src);
    }

    const motionPlan: MotionPlanRecord = {
      kind: "grid",
      unitId: this.boat.id(),
      planId: this.motionPlanId,
      startTick: ticks + this.ticksPerMove,
      ticksPerStep: this.ticksPerMove,
      path: fullPath,
    };
    this.mg.recordMotionPlan(motionPlan);
    this.motionPlanDst = this.dst;

    this.boat.setStealthLaunch(stealth);

    // Notify the target player about the incoming naval invasion
    // terron: ПИРАТСТВО — «тихий десант» (из порта) тревогу жертве не шлёт.
    if (this.target.id() !== mg.terraNullius().id() && !stealth) {
      mg.displayIncomingUnit(
        this.boat.id(),
        // TODO TranslateText
        `Naval invasion incoming from ${this.attacker.displayName()} (${renderTroops(this.boat.troops())})`,
        MessageType.NAVAL_INVASION_INBOUND,
        this.target.id(),
      );
    }

    // Record stats
    this.mg
      .stats()
      .boatSendTroops(this.attacker, this.target, this.boat.troops());
  }

  tick(ticks: number) {
    if (this.dst === null) {
      this.active = false;
      return;
    }
    if (!this.active) {
      return;
    }
    if (!this.boat.isActive()) {
      this.active = false;
      return;
    }
    if (ticks - this.lastMove < this.ticksPerMove) {
      return;
    }
    this.lastMove = ticks;

    // Team mate can conquer disconnected player and get their ships
    // captureUnit has changed the owner of the unit, now update attacker
    const boatOwner = this.boat.owner();
    if (
      this.originalOwner.isDisconnected() &&
      boatOwner !== this.originalOwner &&
      boatOwner.isOnSameTeam(this.originalOwner)
    ) {
      this.attacker = boatOwner;
      this.originalOwner = boatOwner; // for when this owner disconnects too
    }

    if (this.pathFinder.rebuilt) {
      this.motionPlanDst = null; // Force motion plan re-recording
    }

    // Auto-retreat if destination was destroyed by nuke (turned to water)
    // Checked every tick (not just on graph rebuild) because graph rebuilds
    // are throttled and the tile may already be water before the version bumps.
    if (this.dst !== null && this.mg.isWater(this.dst)) {
      if (!this.boat.transportShipState().isRetreating) {
        this.boat.updateTransportShipState({ isRetreating: true });
      }
      // Reset cached retreat destination so it's recomputed from current position
      this.retreatDst = null;
    }

    if (this.boat.transportShipState().isRetreating) {
      // Resolve retreat destination once, based on current boat location when retreat begins.
      this.retreatDst ??= this.attacker.bestTransportShipSpawn(
        this.boat.tile(),
      );

      if (this.retreatDst === false) {
        console.warn(
          `TransportShipExecution: retreating but no retreat destination found`,
        );
        this.attacker.addTroops(this.boat.troops());
        this.boat.delete(false);
        this.active = false;
        return;
      } else {
        this.dst = this.retreatDst;

        if (this.boat.targetTile() !== this.dst) {
          this.boat.setTargetTile(this.dst);
        }
      }
    }

    const result = this.pathFinder.next(this.boat.tile(), this.dst);
    switch (result.status) {
      case PathStatus.COMPLETE:
        if (this.mg.owner(this.dst) === this.attacker) {
          const deaths = this.boat.troops() * (malusForRetreat / 100);
          const survivors = this.boat.troops() - deaths;
          this.attacker.addTroops(survivors);
          this.boat.delete(false);
          this.active = false;

          // Record stats
          this.mg
            .stats()
            .boatArriveTroops(this.attacker, this.target, survivors);
          if (deaths) {
            this.mg.displayMessage(
              "events_display.attack_cancelled_retreat",
              MessageType.ATTACK_CANCELLED,
              this.attacker.id(),
              undefined,
              { troops: renderTroops(deaths) },
            );
          }
          return;
        }
        this.attacker.conquer(this.dst);
        if (this.target.isPlayer() && this.attacker.isFriendly(this.target)) {
          this.attacker.addTroops(this.boat.troops());
        } else {
          // terron: ульта «Минирование» защитника — 50% морского десанта гибнет на
          // минах ДО боя (только море: транспорт-лодка). new-units/ULTIMATES.md
          let landingTroops = this.boat.troops();
          if (
            this.target.isPlayer() &&
            (this.target as Player).hasUltimate(UnitType.Mining)
          ) {
            landingTroops = Math.floor(
              landingTroops * (1 - TERRON_MINING_KILL_PCT),
            );
          }
          this.mg.addExecution(
            new AttackExecution(
              landingTroops,
              this.attacker,
              this.target.id(),
              this.dst,
              false,
            ),
          );
        }
        this.boat.delete(false);
        this.active = false;

        // Record stats
        this.mg
          .stats()
          .boatArriveTroops(this.attacker, this.target, this.boat.troops());
        return;
      case PathStatus.NEXT: {
        this.boat.move(result.node);
        // terron: ТОПЛИВО — лишние шаги в том же тике. Если очередной шаг
        // возвращает не NEXT (прибытие/пересчёт), просто выходим: разбор
        // прибытия отработает штатно на следующем тике. Дублировать здесь
        // логику высадки нельзя — она длинная и с побочными эффектами.
        const extraSteps = fuelSpeedMult(this.attacker);
        for (let i = 1; i < extraSteps; i++) {
          const extra = this.pathFinder.next(this.boat.tile(), this.dst);
          if (extra.status !== PathStatus.NEXT) break;
          this.boat.move(extra.node);
        }
        break;
      }
      case PathStatus.NOT_FOUND: {
        // TODO: add to poisoned port list
        const map = this.mg.map();
        const boatTile = this.boat.tile();
        console.warn(
          `TransportShip path not found: boat@(${map.x(boatTile)},${map.y(boatTile)}) -> dst@(${map.x(this.dst)},${map.y(this.dst)}), attacker=${this.attacker.id()}, target=${this.target.id()}`,
        );
        this.attacker.addTroops(this.boat.troops());
        this.boat.delete(false);
        this.active = false;
        return;
      }
    }

    if (this.dst !== null && this.dst !== this.motionPlanDst) {
      this.motionPlanId++;
      const fullPath = this.pathFinder.findPath(this.boat.tile(), this.dst) ?? [
        this.boat.tile(),
      ];
      if (fullPath.length === 0 || fullPath[0] !== this.boat.tile()) {
        fullPath.unshift(this.boat.tile());
      }
      // terron: ТОПЛИВО — план движения обязан быть прорежен ровно так же,
      // как реально едет лодка, иначе клиентская интерполяция разъедется с
      // симом (юнит «телепортируется» рывками). FUEL.md
      const mult = fuelSpeedMult(this.attacker);
      const planPath: TileRef[] = [];
      for (let i = 0; i < fullPath.length; i += mult) planPath.push(fullPath[i]);
      const lastTile = fullPath[fullPath.length - 1];
      if (planPath[planPath.length - 1] !== lastTile) planPath.push(lastTile);

      this.mg.recordMotionPlan({
        kind: "grid",
        unitId: this.boat.id(),
        planId: this.motionPlanId,
        startTick: ticks + this.ticksPerMove,
        ticksPerStep: this.ticksPerMove,
        path: planPath,
      });
      this.motionPlanDst = this.dst;
    }
  }

  owner(): Player {
    return this.attacker;
  }

  isActive(): boolean {
    return this.active;
  }

  private rejectIncomingAllianceRequests(target: Player) {
    const request = this.attacker
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === target);
    if (request !== undefined) {
      request.reject();
    }
  }
}

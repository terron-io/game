import { fuelSpeedMult } from "../game/FuelSpeed";
import { renderNumber } from "../../client/Utils";
import { TERRON_OILRIG_TRADE_MULT } from "../configuration/TerronTuning";
import { recordEconomyGold } from "../game/EconomyLog";
import {
  Execution,
  Game,
  MessageType,
  Player,
  TradeHubs,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { findClosestBy } from "../Util";

/**
 * terron 23.08 — ЧУЖАЯ БЛОКАДА НА ПУТИ: как часто торговая лодка смотрит,
 * не идёт ли её рейс сквозь зону, и на сколько отрезков бьётся проверка.
 *
 * ⚠️ Почему НЕ объезд: зона как препятствие означает поиск пути по КОПИИ
 * карты без предсчитанной иерархии — то есть полный A* у каждой затронутой
 * лодки на всё время жизни зоны. Именно это клало симуляцию (см.
 * new-units/ULTIMATES.md §16). Поэтому рейс не объезжают, а ОТМЕНЯЮТ: в этом
 * и смысл блокады — торговля встаёт.
 */
const BLOCKADE_CHECK_TICKS = 10;
const BLOCKADE_SAMPLES = 24;

export class TradeShipExecution implements Execution {
  private active = true;
  private mg: Game;
  private tradeShip: Unit | undefined;
  private wasCaptured = false;
  private pathFinder: WaterPathFinder;
  private tilesTraveled = 0;
  private motionPlanId = 1;
  private motionPlanDst: TileRef | null = null;

  private static _staggerCounter = 0;
  /** Тик последней проверки «нет ли чужой блокады на маршруте». */
  private lastBlockadeCheck = -1000;

  constructor(
    private origOwner: Player,
    private srcPort: Unit,
    private _dstPort: Unit,
    // terron: НАМЕРЕННЫЙ self-трейд (порт↔свой дальний порт) — пол дохода, когда
    // торговать не с кем. Меняет два гарда ниже + выплату (одинарная). Спека CAPITALS.md.
    private selfTrade = false,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const stagger =
      TradeShipExecution._staggerCounter++ % WaterPathFinder.STAGGER_SPREAD;
    // terron: ПИРАТСТВО — владелец нужен, чтобы обходить чужие зоны блокады.
    this.pathFinder = new WaterPathFinder(mg, stagger, this.origOwner);
  }

  tick(ticks: number): void {
    if (this.pathFinder.rebuilt) {
      this.motionPlanDst = null; // Force motion plan re-recording
    }

    if (this.tradeShip === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.TradeShip,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        console.warn(`cannot build trade ship`);
        this.active = false;
        return;
      }
      this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, spawn, {
        targetUnit: this._dstPort,
        lastSetSafeFromPirates: ticks,
      });
      this.mg.stats().boatSendTrade(this.origOwner, this._dstPort.owner());
    }

    if (!this.tradeShip.isActive()) {
      this.active = false;
      return;
    }

    const tradeShipOwner = this.tradeShip.owner();
    const dstPortOwner = this._dstPort.owner();
    if (this.wasCaptured !== true && this.origOwner !== tradeShipOwner) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
      // terron: сообщения в ленту обеим сторонам в момент захвата. Точная выплата
      // ещё неизвестна (зависит от пути до порта захватчика), но текущую
      // накопленную стоимость корабля знаем — пишем её как «оценку снизу»: «{gold}+».
      // Само золото придёт при доплытии отдельным сообщением в complete().
      const worth = renderNumber(
        this.mg.config().tradeShipGold(this.tilesTraveled, tradeShipOwner),
      );
      this.mg.displayMessage(
        "events_display.captured_enemy_trade_ship",
        MessageType.CAPTURED_ENEMY_UNIT,
        tradeShipOwner.id(),
        undefined,
        { gold: worth, name: this.origOwner.displayName() },
      );
      this.mg.displayMessage(
        // terron: у ТЕБЯ угнали трейд-шип = потеря → красный (UNIT_CAPTURED_BY_ENEMY),
        // а не зелёный CAPTURED_ENEMY_UNIT. Та же категория (ATTACK), меняется только цвет.
        "events_display.trade_ship_captured_by_enemy",
        MessageType.UNIT_CAPTURED_BY_ENEMY,
        this.origOwner.id(),
        undefined,
        { gold: worth, name: tradeShipOwner.displayName() },
      );
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    // terron: для НАМЕРЕННОГО self-трейда (порт↔свой порт) dst того же владельца —
    // это норма, не удаляем. Прежнее поведение сохранено для ЧУЖОЙ торговли,
    // ставшей внутренней (src захватил dst-порт). Спека CAPITALS.md.
    if (!this.selfTrade && dstPortOwner.id() === this.srcPort.owner().id()) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    // terron: свой порт — всегда валидная цель (self-трейд). Иначе как раньше:
    // dst жив + торговля разрешена (не захвачен нами / не эмбарго / не война).
    const tradeable =
      dstPortOwner === tradeShipOwner || tradeShipOwner.canTrade(dstPortOwner);
    if (!this.wasCaptured && (!this._dstPort.isActive() || !tradeable)) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    const curTile = this.tradeShip.tile();

    if (
      this.wasCaptured &&
      (tradeShipOwner !== dstPortOwner || !this._dstPort.isActive())
    ) {
      const myComponent = this.mg.getWaterComponent(curTile);
      const nearestPort = findClosestBy(
        tradeShipOwner.units(...TradeHubs.types), // terron: порт + нефтяная вышка
        (port) => this.mg.manhattanDist(port.tile(), curTile),
        (port) =>
          port.isActive() &&
          !port.isMarkedForDeletion() &&
          !port.isUnderConstruction() &&
          myComponent !== null &&
          this.mg.hasWaterComponent(port.tile(), myComponent),
      );
      if (nearestPort === null) {
        this.tradeShip.delete(false);
        this.active = false;
        return;
      } else {
        this._dstPort = nearestPort;
        this.tradeShip.setTargetUnit(this._dstPort);
        // Plan-driven units don't emit per-tick unit updates, so force a sync for the new target.
        this.tradeShip.touch();
      }
    }

    if (curTile === this.dstPort()) {
      this.complete();
      return;
    }

    if (this.abortIfBlockaded(ticks, curTile)) return;

    const dst = this._dstPort.tile();
    const result = this.pathFinder.next(curTile, dst);

    switch (result.status) {
      case PathStatus.NEXT:
        if (dst !== this.motionPlanDst) {
          this.motionPlanId++;
          const from = result.node;
          const path = this.pathFinder.findPath(from, dst) ?? [from];
          if (path.length === 0 || path[0] !== from) {
            path.unshift(from);
          }

          // ⚠️ terron 23.08 — ТОПЛИВО НА ТОРГОВЫХ ЛОДКАХ НЕ БЫЛО ВИДНО
          // (репорт владельца «мои торговые корабли бегают, никаких
          // изменений»). Симуляция честно делала ×N шагов за тик, а вот ПЛАН
          // ДВИЖЕНИЯ для клиента писался ШАГ В ШАГ — и лодка на экране ползла
          // с обычной скоростью, догоняя себя рывками. У десанта прореживание
          // плана было, у торговой — нет. FUEL.md
          const mult = fuelSpeedMult(this.tradeShip.owner());
          const planPath: TileRef[] = [];
          for (let i = 0; i < path.length; i += mult) planPath.push(path[i]);
          const lastTile = path[path.length - 1];
          if (planPath[planPath.length - 1] !== lastTile) {
            planPath.push(lastTile);
          }

          this.mg.recordMotionPlan({
            kind: "grid",
            unitId: this.tradeShip.id(),
            planId: this.motionPlanId,
            startTick: ticks + 1,
            ticksPerStep: 1,
            path: planPath,
          });
          this.motionPlanDst = dst;
        }
        // Update safeFromPirates status
        if (this.mg.isWater(result.node) && this.mg.isShoreline(result.node)) {
          this.tradeShip.setSafeFromPirates();
        }
        this.tradeShip.move(result.node);
        this.tilesTraveled++;
        // terron: ТОПЛИВО — лишние шаги в том же тике (владелец лодки, а не
        // порта-получателя: везёт-то он). Не-NEXT прерывает цикл, прибытие
        // разберётся штатно следующим тиком. FUEL.md
        {
          const mult = fuelSpeedMult(this.tradeShip.owner());
          for (let i = 1; i < mult; i++) {
            const extra = this.pathFinder.next(this.tradeShip.tile(), dst);
            if (extra.status !== PathStatus.NEXT) break;
            this.tradeShip.move(extra.node);
            this.tilesTraveled++;
          }
        }
        break;
      case PathStatus.COMPLETE:
        this.complete();
        return;
      case PathStatus.NOT_FOUND:
        console.warn("captured trade ship cannot find route");
        if (this.tradeShip.isActive()) {
          this.tradeShip.delete(false);
        }
        this.active = false;
        return;
    }
  }

  /**
   * Рейс идёт сквозь чужую зону блокады → разворот. Лодка возвращается в
   * ближайший свой порт (золото за пройденный путь достаётся ей там), а если
   * такого нет — рейс пропал. Раньше лодка шла напрямик и просто тонула:
   * блокада работала, но выглядело это как «корабли пропадают».
   */
  private abortIfBlockaded(ticks: number, curTile: TileRef): boolean {
    if (this.tradeShip === undefined) return false;
    if (ticks - this.lastBlockadeCheck < BLOCKADE_CHECK_TICKS) return false;
    this.lastBlockadeCheck = ticks;
    if (!this.crossesBlockade(curTile, this._dstPort.tile())) return false;

    const owner = this.tradeShip.owner();
    const myComponent = this.mg.getWaterComponent(curTile);
    const home = findClosestBy(
      owner.units(...TradeHubs.types),
      (port) => this.mg.manhattanDist(port.tile(), curTile),
      (port) =>
        port.isActive() &&
        !port.isMarkedForDeletion() &&
        !port.isUnderConstruction() &&
        myComponent !== null &&
        this.mg.hasWaterComponent(port.tile(), myComponent) &&
        !this.crossesBlockade(curTile, port.tile()),
    );
    this.mg.displayMessage(
      "events_display.blockade_trade_turned_back",
      MessageType.ATTACK_FAILED,
      owner.id(),
    );
    if (home === null) {
      this.tradeShip.delete(false);
      this.active = false;
      return true;
    }
    this._dstPort = home;
    this.tradeShip.setTargetUnit(home);
    this.tradeShip.touch();
    return false;
  }

  /**
   * Пересекает ли прямая «сюда → туда» чужую зону блокады. Считаем ВЫБОРКОЙ
   * по отрезку целочисленной арифметикой: делений с плавающей точкой в симе
   * быть не должно, а 24 точек хватает — зона размером в десятки тайлов.
   */
  private crossesBlockade(from: TileRef, to: TileRef): boolean {
    const zones = this.mg.blockades();
    if (zones.length === 0 || this.tradeShip === undefined) return false;
    const owner = this.tradeShip.owner();
    const x0 = this.mg.x(from);
    const y0 = this.mg.y(from);
    const dx = this.mg.x(to) - x0;
    const dy = this.mg.y(to) - y0;
    for (const z of zones) {
      // Заявленная, но ещё не собранная зона — только рисунок: рейс её не
      // замечает, иначе блокада работала бы до прихода лодок.
      if (z.pending) continue;
      const zo = this.mg.playerBySmallID(z.ownerSmallID);
      if (!zo.isPlayer()) continue;
      const zp = zo as Player;
      if (zp === owner || owner.isFriendly(zp)) continue;
      const cx = this.mg.x(z.tile);
      const cy = this.mg.y(z.tile);
      for (let i = 0; i <= BLOCKADE_SAMPLES; i++) {
        const px = x0 + Math.trunc((dx * i) / BLOCKADE_SAMPLES);
        const py = y0 + Math.trunc((dy * i) / BLOCKADE_SAMPLES);
        if (Math.abs(px - cx) <= z.hw && Math.abs(py - cy) <= z.hh) {
          return true;
        }
      }
    }
    return false;
  }

  private complete() {
    this.active = false;
    this.tradeShip!.delete(false);
    const gold = this.mg
      .config()
      .tradeShipGold(this.tilesTraveled, this.tradeShip!.owner());

    if (this.wasCaptured) {
      this.tradeShip!.owner().addGold(gold, this._dstPort.tile());
      this.mg.displayMessage(
        "events_display.received_gold_from_captured_ship",
        MessageType.CAPTURED_ENEMY_UNIT,
        this.tradeShip!.owner().id(),
        gold,
        {
          gold: renderNumber(gold),
          name: this.origOwner.displayName(),
        },
      );
      // Record stats
      this.mg
        .stats()
        .boatCapturedTrade(this.tradeShip!.owner(), this.origOwner, gold);
    } else {
      // terron: self-трейд (порт↔свой порт) — ОДНА выплата, не двойная (иначе
      // владелец получил бы 2× → принтер). Чужая торговля — обе стороны получают
      // полное золото, как раньше. Спека CAPITALS.md.
      // terron: НЕФТЯНАЯ ВЫШКА платит ×TERRON_OILRIG_TRADE_MULT — множитель у
      // КАЖДОГО КОНЦА рейса свой (вышка↔порт: вышке ×5, порту обычное).
      const mult = (hub: Unit): bigint =>
        hub.type() === UnitType.OilRig ? TERRON_OILRIG_TRADE_MULT : 1n;
      const srcGold = gold * mult(this.srcPort);
      const dstGold = gold * mult(this._dstPort);
      const sameOwner = this.srcPort.owner() === this._dstPort.owner();
      this.srcPort.owner().addGold(srcGold, this.srcPort.tile());
      // Record stats
      this.mg
        .stats()
        .boatArriveTrade(this.srcPort.owner(), this._dstPort.owner(), gold);
      // terron: ROI-лог — доход порта (море). Спека: airport.md
      recordEconomyGold(this.mg, this.srcPort.owner(), "port", srcGold);
      if (!sameOwner) {
        this._dstPort.owner().addGold(dstGold, this._dstPort.tile());
        recordEconomyGold(this.mg, this._dstPort.owner(), "port", dstGold);
      }
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstPort(): TileRef {
    return this._dstPort.tile();
  }
}

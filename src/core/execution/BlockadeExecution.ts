// terron: ПИРАТСТВО — каст «БЛОКАДА».
//
// ⚠️ ПЕРЕДЕЛАНО 23.08 по решению владельца: «корабли приходят на точку и
// ЗАТАПЛИВАЮТСЯ, мусор там разбрасывай».
//
// Почему так, а не как было. Прежняя версия держала флотилию ЖИВОЙ на якоре:
// лодки кружили, зона считалась от числа живых, а сами они выпадали из общей
// логики корабля (флаг миссии выключал патруль и стрельбу). Это дало три беды
// подряд: лодки стояли беззащитными и их расстреливали по одной; повисший флаг
// миссии превращал лодку в НАВСЕГДА застрявшую (она молча пропускала свой шаг);
// а размер зоны менялся с каждой прибывшей лодкой и каждый раз пересобирал все
// водные пути.
//
// Теперь блокада — РАСХОДНИК: лодки доплывают до точки и топятся, оставляя
// затопленные корпуса. Зона живёт от числа ЗАТОПЛЕННЫХ и не зависит ни от чего
// живого — состояния, которое может «залипнуть», больше нет.
import {
  TERRON_BLOCKADE_ARRIVE_DIST,
  TERRON_BLOCKADE_DURATION_TICKS,
  TERRON_BLOCKADE_MAX_SHIPS,
  TERRON_BLOCKADE_SAIL_TIMEOUT_TICKS,
  TERRON_BLOCKADE_TROOP_TOLL,
} from "../configuration/TerronTuning";
import { renderTroops } from "../../client/Utils";
import { blockadeFlagSize, inBlockadeFlag } from "../game/BlockadeGeometry";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";

/** Не чаще раза в 2 секунды меняем размер зоны (это пересборка водных путей). */
const ZONE_SYNC_TICKS = 20;
/** Как часто зона проверяет, не заплыл ли в неё чужой корабль. */
const CATCH_TICKS = 5;

export class BlockadeExecution implements Execution {
  private active = true;
  private mg: Game;
  /** Лодки в пути к точке. Дошла — топится и уходит из списка. */
  private ships: Unit[] = [];
  private finders = new Map<number, WaterPathFinder>();
  private zoneId: number | null = null;
  /** Сколько лодок уже затоплено в точке — от этого размер зоны. */
  private scuttled = 0;
  /** Тик последней проверки «кто попался в зону». */
  private lastCatch = -1000;
  /** Время жизни зоны, уже доехавшее до клиента (см. syncZone). */
  private syncedExpiry = -1;
  private started = false;
  private startedAt = 0;
  /** Тик, когда зона исчезнет (продлевается каждым новым затоплением). */
  private expiresAt = 0;
  /** Когда последний раз синхронизировали РАЗМЕР зоны (см. ZONE_SYNC_TICKS). */
  private lastZoneSync = -1000;
  /** Размер, отданный симу в последний раз (чтобы не бампать версию впустую). */
  private syncedShips = 0;

  constructor(
    private player: Player,
    private tile: TileRef,
    private requested: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.startedAt = ticks;
  }

  private start(ticks: number): boolean {
    // Отказ не молчит: причин ровно две, игрок должен знать какая.
    const spawn = this.player.canBuild(UnitType.Blockade, this.tile);
    if (spawn === false) {
      this.mg.displayMessage(
        "events_display.blockade_too_far",
        MessageType.BLOCKADE,
        this.player.id(),
      );
      return false;
    }
    const free = this.player
      .units(UnitType.Warship)
      .filter((u) => u.isActive() && u.blockadeMission() === null)
      .sort(
        (a, b) =>
          this.mg.manhattanDist(a.tile(), spawn) -
          this.mg.manhattanDist(b.tile(), spawn),
      );
    if (free.length === 0) {
      this.mg.displayMessage(
        "events_display.blockade_no_ships",
        MessageType.BLOCKADE,
        this.player.id(),
      );
      return false;
    }
    const n = Math.max(
      1,
      Math.min(this.requested, free.length, TERRON_BLOCKADE_MAX_SHIPS),
    );
    const cost = this.mg.unitInfo(UnitType.Blockade).cost(this.mg, this.player);
    this.player.removeGold(cost);
    this.ships = free.slice(0, n);
    for (const s of this.ships) {
      s.setBlockadeMission({ target: spawn, anchored: false, drawn: false });
      this.finders.set(s.id(), new WaterPathFinder(this.mg, 0, this.player));
    }
    this.tile = spawn;
    this.startedAt = ticks;
    // terron 23.08 (просьба владельца «сразу рисуй территорию флага, а
    // активируется она когда корабли приплывут»): зона ЗАЯВЛЯЕТСЯ мгновенно —
    // игрок видит, куда он ткнул и какого размера будет флаг. До первого
    // затопленного корпуса она pending: никого не топит и торговлю не
    // разворачивает, только рисуется пунктиром.
    const claimed = blockadeFlagSize(n);
    this.zoneId = this.mg.nextBlockadeId();
    this.mg.addBlockade({
      id: this.zoneId,
      ownerSmallID: this.player.smallID(),
      tile: spawn,
      hh: claimed.hh,
      hw: claimed.hw,
      ships: n,
      expiresAt: 0,
      pending: true,
    });
    this.mg.displayMessage(
      "events_display.blockade_declared",
      MessageType.BLOCKADE,
      null,
      undefined,
      { name: this.player.displayName() },
    );
    return true;
  }

  /** Лодка дошла до точки: топим её (зона вырастет при следующей синхронизации). */
  private scuttle(s: Unit): void {
    s.setBlockadeMission(null);
    this.finders.delete(s.id());
    s.delete(true);
    this.scuttled++;
  }

  /**
   * ⚠️ РАЗМЕР ЗОНЫ = ПЕРЕСБОРКА ВСЕХ ВОДНЫХ ПУТЕЙ. Зона меняет проходимость
   * воды, и на каждое изменение её РАЗМЕРА пересобирается копия мини-карты —
   * причём ОТДЕЛЬНО для каждого игрока, кого эта зона касается. Лодки топятся
   * по одной, зон бывает несколько: без коалесценции это десятки полных
   * пересборок подряд, и симуляция встаёт колом (репорт владельца 23.08:
   * «скорость симуляции падает до 0 от этих флагов»).
   *
   * Поэтому размер уезжает в сим НЕ ЧАЩЕ раза в ZONE_SYNC_TICKS и только если
   * он реально изменился.
   */
  private syncZone(ticks: number): void {
    if (this.scuttled === 0) return;
    if (ticks - this.lastZoneSync < ZONE_SYNC_TICKS) return;
    if (this.scuttled === this.syncedShips && this.syncedExpiry === this.expiresAt) {
      return;
    }
    this.syncedExpiry = this.expiresAt;
    this.lastZoneSync = ticks;
    this.syncedShips = this.scuttled;
    if (this.zoneId === null) return;
    this.mg.updateBlockade(
      this.zoneId,
      this.scuttled,
      this.expiresAt,
      false, // первый затопленный корпус превращает заявку в работающую зону
    );
  }

  /**
   * terron 23.08 (решение владельца «брать мзду»): что зона делает с чужим
   * судном, которое в неё зашло. Разное по типу — в этом и смысл блокады:
   *   • ТОРГОВОЕ — УГОНЯЕТСЯ (`captureUnit`): дальше им занимается обычная
   *     механика захвата — лодка разворачивается в порт нового владельца и
   *     платит золото ему. Отсюда «массовое воровство чужих кораблей».
   *   • ДЕСАНТ — топится, но половина везомых войск ПЕРЕХОДИТ хозяину зоны
   *     (`TERRON_BLOCKADE_TROOP_TOLL`). Раньше зона десант вообще не замечала.
   *   • БОЕВОЙ КОРАБЛЬ — топится и увеличивает зону: полез сам.
   */
  private sinkCaught(ticks: number): void {
    if (this.zoneId === null) return;
    // terron 23.08: проход по ВСЕМ кораблям карты — раз в CATCH_TICKS, а не
    // каждый тик. Зона живёт минуты, лишняя секунда реакции незаметна, а
    // сканы на карте с сотнями торговых лодок складываются.
    if (ticks - this.lastCatch < CATCH_TICKS) return;
    this.lastCatch = ticks;
    const zone = this.mg.blockades().find((b) => b.id === this.zoneId);
    if (zone === undefined) return;
    // Заявка ещё не собрана — она только нарисована, ловить ею нельзя.
    if (zone.pending) return;
    for (const u of this.mg.units(
      UnitType.Warship,
      UnitType.TradeShip,
      UnitType.TransportShip,
    )) {
      if (!u.isActive()) continue;
      const owner = u.owner();
      if (!owner.isPlayer()) continue;
      if (owner === this.player || owner.isFriendly(this.player)) continue;
      const dx = this.mg.x(u.tile()) - this.mg.x(zone.tile);
      const dy = this.mg.y(u.tile()) - this.mg.y(zone.tile);
      if (!inBlockadeFlag(dx, dy, zone.hh, zone.hw)) continue;

      if (u.type() === UnitType.TradeShip) {
        this.player.captureUnit(u);
        continue;
      }
      if (u.type() === UnitType.TransportShip) {
        const toll = Math.floor(u.troops() * TERRON_BLOCKADE_TROOP_TOLL);
        u.delete(true);
        if (toll > 0) {
          this.player.addTroops(toll);
          this.mg.displayMessage(
            "events_display.blockade_troops_seized",
            MessageType.BLOCKADE,
            this.player.id(),
            undefined,
            { count: renderTroops(toll) },
          );
          this.mg.displayMessage(
            "events_display.blockade_troops_lost",
            MessageType.UNIT_CAPTURED_BY_ENEMY,
            owner.id(),
            undefined,
            { count: renderTroops(toll), name: this.player.displayName() },
          );
        }
        continue;
      }
      u.delete(true);
      this.scuttled++;
    }
  }

  /** Вернуть лодку к обычной службе (не дошла — не топим). */
  private release(s: Unit): void {
    s.setBlockadeMission(null);
    this.finders.delete(s.id());
  }

  private finish(): void {
    for (const s of this.ships) if (s.isActive()) this.release(s);
    this.ships = [];
    if (this.zoneId !== null) this.mg.removeBlockade(this.zoneId);
    this.zoneId = null;
    this.active = false;
  }

  tick(ticks: number): void {
    if (!this.started) {
      if (!this.start(ticks)) {
        this.active = false;
        return;
      }
      this.started = true;
      return;
    }

    // Штаб снесён/захвачен — зона снимается, лодки в пути возвращаются к службе.
    if (!this.player.hasUltimate(UnitType.Piracy)) {
      this.finish();
      return;
    }

    // Ведём тех, кто ещё плывёт.
    for (const s of [...this.ships]) {
      if (!s.isActive()) {
        this.ships = this.ships.filter((x) => x !== s);
        continue;
      }
      if (
        this.mg.manhattanDist(s.tile(), this.tile) <=
        TERRON_BLOCKADE_ARRIVE_DIST
      ) {
        this.ships = this.ships.filter((x) => x !== s);
        this.scuttle(s);
        this.expiresAt = ticks + TERRON_BLOCKADE_DURATION_TICKS;
        continue;
      }
      // ⚠️ ЖЁСТКИЙ ТАЙМАУТ. Лодка с висящим флагом миссии выпадает из общей
      // логики корабля — именно так появлялись «навсегда застрявшие» лодки у
      // собственного порта. Не дошла за отведённое время — снимаем миссию.
      if (ticks - this.startedAt > TERRON_BLOCKADE_SAIL_TIMEOUT_TICKS) {
        this.ships = this.ships.filter((x) => x !== s);
        this.release(s);
        continue;
      }
      const pf = this.finders.get(s.id())!;
      const res = pf.next(s.tile(), this.tile);
      if (res.status === PathStatus.NEXT) {
        s.move(res.node);
      } else if (res.status === PathStatus.COMPLETE) {
        this.ships = this.ships.filter((x) => x !== s);
        this.scuttle(s);
        this.expiresAt = ticks + TERRON_BLOCKADE_DURATION_TICKS;
      } else if (res.status === PathStatus.NOT_FOUND) {
        this.ships = this.ships.filter((x) => x !== s);
        this.release(s);
      }
    }

    this.sinkCaught(ticks);
    this.syncZone(ticks);

    // Никто не доплыл и плыть больше некому — каст выдохся.
    if (this.ships.length === 0 && this.scuttled === 0) {
      this.mg.displayMessage(
        "events_display.blockade_lost",
        MessageType.BLOCKADE,
        this.player.id(),
        undefined,
        { count: "0" },
      );
      this.active = false;
      return;
    }
    // Зона живёт своё время от последнего затопления.
    if (this.scuttled > 0 && ticks >= this.expiresAt) {
      this.finish();
    }
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

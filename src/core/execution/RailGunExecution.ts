// terron: ДОРА — тяжёлое железнодорожное орудие (new-units/DORA.md).
//
// ⚠️ ГЛАВНОЕ: дальнобойность орудия — ЭТО ТВОЯ ЗАСТРОЙКА. Само оно бьёт всего
// на TERRON_RAILGUN_RANGE, но ездит по железной дороге, а рельсы в движке
// прорастают между зданиями игрока. Хочешь достать соседа — двигай города к
// его границе. Это видно всем на карте, значит телеграф получается бесплатно,
// одной географией.
//
// ⚠️ КОНТРПЛЕЙ — НЕ В ПУШКЕ, А В ПУТЯХ: убивать надо станцию ЗА орудием, тогда
// оно застревает отрезанным от сети. Поэтому мгновенное попадание снаряда
// нормально: у снаряда контрплея нет и не должно быть, вся защита вынесена на
// этап подвоза. Снаряд — не ракета, ПВО его не касается.
import {
  TERRON_RAILGUN_FOREIGN_GRACE_TICKS,
  TERRON_RAILGUN_RANGE,
  TERRON_RAILGUN_RELOAD_TICKS,
  TERRON_RAILGUN_SPEED,
} from "../configuration/TerronTuning";
import { MessageType, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { railPath, railTilesFrom, thinReach } from "../game/RailReach";
import { RailGunShellFlight } from "./RailGunShellFlight";
import { detonateDroneBlast } from "./SuicideDroneExecution";
import { UltimateBuildingExecution } from "./UltimateBuildingExecution";

/** Как часто пересчитывать набор своих рельсов (сеть меняется небыстро). */
const RAIL_CACHE_TICKS = 10;
/** Потолок числа кругов зоны доезда на клиенте (шаг прореживания — под сеть). */
const REACH_MAX = 192;

export class RailGunExecution extends UltimateBuildingExecution {
  // terron 23.08: перезарядка идёт ЧЕРЕЗ ОБЩИЙ механизм юнита
  // (launch()/reloadMissile()/missileTimerQueue) — тот же, что у шахты, ПВО и
  // аэропорта. Своего счётчика тут больше нет специально: очередь едет на
  // клиент в UnitUpdate, и циферблат отката рисуется для Доры автоматически,
  // тем же кодом, что и для остальных. Заводить свой таймер = снова строить
  // парашу рядом с готовой системой.
  /** Маршрут по рельсам к позиции, откуда цель достанут. */
  private path: TileRef[] = [];
  private pathIdx = 0;
  private pathTarget: TileRef | null = null;
  /** Тик, когда орудие оказалось на НЕ дружественной земле (−1 — всё в порядке). */
  private foreignSince = -1;
  /** terron: рельсы под орудием снесли — стоим и приказы не принимаем. */
  private derailed = false;
  /** Кэш «свои рельсы тайлами» — нужен и маршруту, и публикации зоны. */
  private railTiles: Set<TileRef> | null = null;
  private railTilesAt = -1000;

  constructor(hq: Unit) {
    super(hq);
  }

  protected run(player: Player, ticks: number): void {
    if (this.checkForeignGround(player, ticks)) return;
    // Снимаем перезарядку, когда вышло время (как MissileSiloExecution).
    const q = this.hq.missileTimerQueue();
    if (q.length > 0 && ticks - q[0] >= TERRON_RAILGUN_RELOAD_TICKS) {
      this.hq.reloadMissile();
    }

    // terron 23.08 (репорт владельца «мне дроном сломали»): рельсы прямо под
    // орудием могут снести — дроном, ядеркой, потерей территории. Тогда оно
    // никуда не едет и приказы не принимает, пока пути не восстановят. Раньше
    // в этом состоянии орудие продолжало «ехать» по мёртвому маршруту.
    const onRail = this.onRail(this.hq.tile());
    if (!onRail && !this.derailed) {
      this.derailed = true;
      this.path = [];
      this.pathTarget = null;
      this.hq.setTargetTile(undefined);
      this.hq.setRailEta(0);
      this.mg.displayMessage(
        "events_display.railgun_derailed",
        MessageType.RAILGUN,
        player.id(),
      );
    } else if (onRail && this.derailed) {
      // Пути под орудием восстановили — оно снова в строю.
      this.derailed = false;
      this.mg.displayMessage(
        "events_display.railgun_rerailed",
        MessageType.RAILGUN,
        player.id(),
      );
    }

    this.publishReach(player, ticks);
    if (this.derailed) return;

    const target = this.hq.targetTile();
    if (target === undefined) {
      this.hq.setRailEta(0);
      return;
    }

    if (this.inRange(target)) {
      this.path = [];
      this.pathTarget = null;
      if (this.hq.isInCooldown()) {
        this.hq.setRailEta(this.cooldownLeft(ticks));
        return;
      }
      this.fire(player, target, ticks);
      return;
    }
    this.driveToward(player, target);
    this.hq.setRailEta(this.eta(ticks));
  }

  /** Тайл сам по себе является рельсом (а не «рядом с рельсами»). */
  private onRail(tile: TileRef): boolean {
    return this.mg.railNetwork().overlappingRailroads(tile).includes(tile);
  }

  private cooldownLeft(ticks: number): number {
    const q = this.hq.missileTimerQueue();
    if (q.length === 0) return 0;
    return Math.max(0, q[0] + TERRON_RAILGUN_RELOAD_TICKS - ticks);
  }

  /**
   * Через сколько тиков цель получит снаряд: доехать + дождаться перезарядки
   * (эти два процесса идут ПАРАЛЛЕЛЬНО, поэтому максимум, а не сумма).
   */
  private eta(ticks: number): number {
    const left = Math.max(0, this.path.length - this.pathIdx);
    if (left === 0 && this.pathTarget !== null && this.path.length === 0) {
      return 0; // ехать некуда — отсчёт врал бы
    }
    const travel = Math.ceil(left / Math.max(1, TERRON_RAILGUN_SPEED));
    return Math.max(travel, this.cooldownLeft(ticks));
  }

  /**
   * terron 23.08: зона доезда — ЧЕСТНАЯ. Клиент рисует облачко вокруг этих
   * тайлов, и оно обязано совпадать с тем, куда орудие реально приедет:
   * иначе игрок тыкает внутрь зоны и получает «орудие не достаёт».
   *
   * Зона = круги вокруг ВСЕХ доступных РЕЛЬСОВ, а не только станций: доехать
   * можно до любой точки пути (репорт владельца «насовал кучу рельс, а бахнуть
   * не могу»). Тайлов бывают тысячи — прореживаем: при радиусе выстрела 120
   * шаг в REACH_STEP тайлов формы облака не меняет.
   */
  private publishReach(player: Player, ticks: number): void {
    if (this.derailed) {
      this.hq.setRailReach([this.hq.tile()]);
      return;
    }
    const out = thinReach(
      this.railTilesCached(player, ticks),
      this.hq.tile(),
      REACH_MAX,
    );
    this.hq.setRailReach(out);
  }

  /**
   * Орудие можно возить по земле союзника. Разорвал союз — минута, и оно
   * взрывается на месте (решение владельца 23.08). Вернулся на дружественную
   * землю раньше — отсчёт сбрасывается.
   */
  private checkForeignGround(player: Player, ticks: number): boolean {
    const ground = this.mg.owner(this.hq.tile());
    const friendly =
      !ground.isPlayer() ||
      ground === player ||
      player.isFriendly(ground as Player);
    if (friendly) {
      this.foreignSince = -1;
      return false;
    }
    if (this.foreignSince < 0) {
      this.foreignSince = ticks;
      this.mg.displayMessage(
        "events_display.railgun_stranded",
        MessageType.RAILGUN,
        player.id(),
      );
      return false;
    }
    if (ticks - this.foreignSince < TERRON_RAILGUN_FOREIGN_GRACE_TICKS) {
      return false;
    }
    const site = this.hq.tile();
    this.hq.delete(false);
    this.active = false;
    // source="selfdestruct": взрыв Доры на чужой земле — не «снос дроном»,
    // иначе орудием в чужой застройке фармился siege_key (ревью 24.08).
    detonateDroneBlast(
      this.mg,
      site,
      player,
      UnitType.SuicideDrone,
      "selfdestruct",
    );
    return true;
  }

  private inRange(target: TileRef): boolean {
    const r = TERRON_RAILGUN_RANGE;
    return this.mg.euclideanDistSquared(this.hq.tile(), target) <= r * r;
  }

  private fire(player: Player, target: TileRef, _ticks: number): void {
    this.hq.launch(); // ставим орудие на перезарядку общим механизмом
    this.hq.setTargetTile(undefined);
    this.hq.setRailEta(0);
    // terron 23.08 (решение владельца «сбить нельзя, просто быстрый пумк»):
    // снаряд ЛЕТИТ и его видно, но перехвату он не подлежит — его нет среди
    // целей SAMLauncherExecution, там перечислены только ракеты. Прилёт
    // считает RailGunShellFlight: полёт занимает доли секунды, но выстрел
    // перестал быть телепортом.
    this.mg.addExecution(
      new RailGunShellFlight(player, this.hq.tile(), target),
    );
    this.mg.displayMessage(
      "events_display.railgun_fired",
      MessageType.RAILGUN,
      null,
      undefined,
      { name: player.displayName() },
      undefined,
      player.id(),
    );
  }

  /** Шаг по рельсам к ближайшей своей станции, откуда цель окажется в радиусе. */
  private driveToward(player: Player, target: TileRef): void {
    if (this.pathTarget !== target) {
      this.path = this.buildRailPath(player, target, this.mg.ticks());
      this.pathIdx = 0;
      this.pathTarget = target;
      // terron: цель вне радиуса И ехать некуда (нет своей станции, из которой
      // её достанут). Раньше приказ тут молча умирал: игрок ткнул, деньги
      // списались, и НИЧЕГО — выглядело как сломанная ульта (репорт владельца
      // 23.08). Теперь честно говорим и снимаем цель. new-units/DORA.md
      if (this.path.length === 0) {
        this.hq.setTargetTile(undefined);
        this.hq.setRailEta(0);
        this.mg.displayMessage(
          "events_display.railgun_unreachable",
          MessageType.RAILGUN,
          player.id(),
        );
        return;
      }
    }
    for (let i = 0; i < TERRON_RAILGUN_SPEED; i++) {
      if (this.pathIdx >= this.path.length) return;
      this.hq.move(this.path[this.pathIdx++]);
    }
  }

  /** Кэш набора своих рельсов — он нужен и маршруту, и публикации зоны. */
  private railTilesCached(player: Player, ticks: number): Set<TileRef> {
    if (
      this.railTiles === null ||
      ticks - this.railTilesAt >= RAIL_CACHE_TICKS
    ) {
      this.railTiles = railTilesFrom(this.mg, player, this.hq.tile());
      this.railTilesAt = ticks;
    }
    return this.railTiles;
  }

  /**
   * Маршрут до ближайшей точки рельсов, ОТКУДА ЦЕЛЬ УЖЕ В РАДИУСЕ: орудие
   * останавливается ровно там, где смогло достать, а не едет до станции.
   */
  private buildRailPath(
    player: Player,
    target: TileRef,
    ticks: number,
  ): TileRef[] {
    const allowed = this.railTilesCached(player, ticks);
    const r = TERRON_RAILGUN_RANGE;
    return railPath(
      this.mg,
      allowed,
      this.hq.tile(),
      (t) => this.mg.euclideanDistSquared(t, target) <= r * r,
    );
  }
}

/** Экспорт для теста: тип орудия — обычный ульт-штаб, но ЕДУЩИЙ. */
export const RAIL_GUN_TYPE = UnitType.RailGun;

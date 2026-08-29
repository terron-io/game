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
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { MirvTally, NukeExecution } from "./NukeExecution";
import { samEffectiveRange } from "./SAMLauncherExecution";

export class MirvExecution implements Execution {
  private active = true;

  private mg: Game;

  private nuke: Unit | null = null;

  private range = 1500;
  private rangeSquared = this.range * this.range;
  private minimumSpread = 55;
  private warheadCount = 350;

  private baseX: number;
  private baseY: number;

  private random: PseudoRandom;

  private pathFinder: ParabolaUniversalPathFinder;

  private targetPlayer: Player | TerraNullius;

  private separateDst: TileRef;
  private spawnTile: TileRef;

  private speed: number = -1;

  // terron: после разделения остаёмся живы «репортером» — считаем судьбу
  // боеголовок (общий счётчик у каждой NukeExecution) и в конце пишем жертве в
  // чат «сбито N/T». reportDeadline — страховка, если что-то зависнет.
  private warheadTally: MirvTally | null = null;
  private reportDeadline = 0;

  constructor(
    private player: Player,
    private dst: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.random = new PseudoRandom(mg.ticks() + simpleHash(this.player.id()));
    this.mg = mg;
    this.targetPlayer = this.mg.owner(this.dst);
    this.speed = this.mg.config().defaultNukeSpeed();
    this.pathFinder = UniversalPathFinding.Parabola(mg, {
      increment: this.speed,
    });

    // Betrayal on launch
    if (this.targetPlayer.isPlayer()) {
      const alliance = this.player.allianceWith(this.targetPlayer);
      if (alliance !== null) {
        this.player.breakAlliance(alliance);
      }
      if (this.targetPlayer !== this.player) {
        this.targetPlayer.updateRelation(this.player, -100);
        this.player.updateRelation(this.targetPlayer, -100);
      }
    }
  }

  tick(ticks: number): void {
    // terron: фаза отчёта — МИРВ разделился, ждём судьбу боеголовок и пишем
    // жертве в чат «сбито N/T» (только если хоть одну сбили). ULTIMATES.md
    if (this.warheadTally !== null) {
      const t = this.warheadTally;
      const resolved = t.intercepted + t.detonated >= t.total;
      if (resolved || this.mg.ticks() >= this.reportDeadline) {
        if (t.intercepted > 0) {
          const params = { intercepted: t.intercepted, total: t.total };
          // Жертве — «сбито N/T твоим ПВО».
          if (this.targetPlayer.isPlayer()) {
            this.mg.displayMessage(
              "events_display.mirv_intercepted",
              MessageType.CHAT,
              this.targetPlayer.id(),
              undefined,
              params,
            );
          }
          // Атакующему — «вражеское ПВО сбило N/T твоих боеголовок».
          this.mg.displayMessage(
            "events_display.mirv_intercepted_attacker",
            MessageType.CHAT,
            this.player.id(),
            undefined,
            params,
          );
        }
        this.warheadTally = null;
        this.active = false;
      }
      return;
    }
    if (this.nuke === null) {
      const spawn = this.player.canBuild(UnitType.MIRV, this.dst);
      if (spawn === false) {
        console.warn(`cannot build MIRV`);
        this.active = false;
        return;
      }
      this.spawnTile = spawn;
      this.nuke = this.player.buildUnit(UnitType.MIRV, spawn, {
        targetTile: this.dst,
      });
      // terron: как обычная ядерка — запустивший МИРВ силос уходит в перезарядку
      // (раньше МИРВ силос не «разряжал», а обычные пуски — да; NukeExecution).
      const silo = this.player
        .units(UnitType.MissileSilo)
        .find((s) => s.tile() === this.spawnTile);
      if (silo) silo.launch();
      this.mg.stats().bombLaunch(this.player, this.targetPlayer, UnitType.MIRV);
      // terron: ультимейты — метрика «ракет запущено» (тултип слота ульты).
      this.player.addUltStat("mirvLaunches", 1);
      const x = Math.floor(
        (this.mg.x(this.dst) + this.mg.x(this.nuke.tile())) / 2,
      );
      const y = Math.max(0, this.mg.y(this.dst) - 500) + 50;
      this.separateDst = this.mg.ref(x, y);

      this.mg.displayIncomingUnit(
        this.nuke.id(),
        // TODO TranslateText
        `⚠️⚠️⚠️ ${this.player.displayName()} - MIRV INBOUND ⚠️⚠️⚠️`,
        MessageType.MIRV_INBOUND,
        this.targetPlayer.id(),
      );
      // terron: запись в ЧАТ жертвы (категория CHAT, не ядерный алерт) — «в тебя
      // летел МИРВ от X». Красный алерт «в вас запущен» уже даёт displayIncomingUnit
      // (MIRV_INBOUND) справа; дублировать его в ленте не нужно — только чат-лог.
      if (this.targetPlayer.isPlayer()) {
        this.mg.displayMessage(
          "events_display.mirv_incoming",
          MessageType.CHAT,
          this.targetPlayer.id(),
          undefined,
          { name: this.player.displayName() },
        );
      }
    }

    const result = this.pathFinder.next(
      this.spawnTile,
      this.separateDst,
      this.speed,
    );
    if (result.status === PathStatus.COMPLETE) {
      this.separate();
      // НЕ выходим: separate() включил фазу отчёта (warheadTally) — держим
      // execution живым, пока не посчитаем «сбито N/T».
      // Record stats
      this.mg.stats().bombLand(this.player, this.targetPlayer, UnitType.MIRV);
      return;
    } else if (result.status === PathStatus.NEXT) {
      this.nuke.move(result.node);
    }
  }

  // terron: ПВО-щит против МИРВ. Готовые (не в перезарядке) враждебные атакующему
  // ПВО «накрывают» свой радиус: боеголовки НЕ назначаются в их зону, а каждое
  // ПВО, чья зона реально отразила хотя бы одну цель, «срабатывает» — уходит в
  // штатную перезарядку (launch), как после пуска ракеты. Итог: круг ПВО чист,
  // но батарея разряжена. Детерминизм: mg.units() стабилен, целочисленная
  // математика, порядок вызовов PseudoRandom не зависит от щита.
  private shieldX: number[] = [];
  private shieldY: number[] = [];
  private shieldR2: number[] = [];
  private shieldSams: Unit[] = [];
  private shieldFired: boolean[] = [];

  private prepareSamShield(): void {
    this.shieldX = [];
    this.shieldY = [];
    this.shieldR2 = [];
    this.shieldSams = [];
    this.shieldFired = [];
    // terron: щит держит ТОЛЬКО ПВО САМОЙ ЖЕРТВЫ (и её союзников) — это ЕЁ
    // противоракетная оборона. РАНЬШЕ брали ВСЕ враждебные атакующему ПВО на
    // карте: на карте, засеянной чужими ботами с ПВО, боеголовки исключались
    // повсюду → МИРВ бота гасился «ботным же ПВО» третьих сторон и не долетал
    // вовсе (жалоба владельца 14.07). Третьи стороны свой радиус против чужого
    // МИРВ больше НЕ подставляют.
    const target = this.targetPlayer;
    if (!target.isPlayer()) return; // цель — ничейная земля: щита нет
    // terron: «Небо наше» (реворк 21.08) — штаб сам является большим ПВО и
    // держит щит от боеголовок с радиусом ×5 (samEffectiveRange по типу юнита).
    for (const sam of this.mg.units(UnitType.SAMLauncher, UnitType.OurSky)) {
      if (sam.isUnderConstruction()) continue;
      if (sam.isInCooldown()) continue;
      const samOwner = sam.owner();
      if (samOwner === this.player) continue;
      if (samOwner.isFriendly(this.player)) continue;
      // Только ПВО жертвы или её союзников защищает жертву от МИРВ.
      if (samOwner !== target && !samOwner.isFriendly(target)) continue;
      const r = samEffectiveRange(this.mg, sam);
      this.shieldSams.push(sam);
      this.shieldX.push(this.mg.x(sam.tile()));
      this.shieldY.push(this.mg.y(sam.tile()));
      this.shieldR2.push(r * r);
      this.shieldFired.push(false);
    }
  }

  /** Тайл под зонтиком ПВО? Помечает ВСЕ накрывающие батареи как сработавшие. */
  private isShielded(x: number, y: number): boolean {
    let shielded = false;
    for (let i = 0; i < this.shieldSams.length; i++) {
      const dx = x - this.shieldX[i];
      const dy = y - this.shieldY[i];
      if (dx * dx + dy * dy <= this.shieldR2[i]) {
        shielded = true;
        this.shieldFired[i] = true;
      }
    }
    return shielded;
  }

  private fireShieldSams(): void {
    for (let i = 0; i < this.shieldSams.length; i++) {
      if (this.shieldFired[i]) {
        // штатная перезарядка — как после пуска ракеты
        this.shieldSams[i].launch();
      }
    }
  }

  private separate() {
    if (this.nuke === null) {
      throw new Error("uninitialized");
    }

    this.baseX = this.mg.x(this.dst);
    this.baseY = this.mg.y(this.dst);

    this.prepareSamShield();
    const { created, blocked } = this.selectDestinations();
    this.fireShieldSams();
    // Общий счётчик судьбы боеголовок → фаза отчёта «сбито N/T» в tick().
    // total = ВСЕ, что летели бы (created + срезанные щитом); intercepted стартует
    // с blocked (щит уже «сбил»), дальше растёт от активных перехватов ПВО.
    const tally: MirvTally = {
      total: created.length + blocked,
      intercepted: blocked,
      detonated: 0,
    };
    this.warheadTally = tally;
    this.reportDeadline = this.mg.ticks() + 900;
    for (const [i, dst] of created.entries()) {
      this.mg.addExecution(
        new NukeExecution(
          UnitType.MIRVWarhead,
          this.player,
          dst,
          this.nuke.tile(),
          15 + Math.floor((i / this.warheadCount) * 5),
          //   this.random.nextInt(5, 9),
          this.random.nextInt(0, 15),
          true,
          tally,
        ),
      );
    }
    this.nuke.delete(false);
  }

  // terron: возвращаем РАЗДЕЛЁННЫЙ результат — реально запускаемые боеголовки
  // (created) и сколько срезал ПВО-щит жертвы (blocked, для чат-отчёта «сбито N/T»).
  private selectDestinations(): { created: TileRef[]; blocked: number } {
    // 1) Куда БЫ легли боеголовки БЕЗ учёта ПВО (полная раскладка по minimumSpread).
    const wouldBe: TileRef[] = [this.dst];
    for (let attempt = 0; attempt < 1000; attempt++) {
      const target = this.tryGenerateTarget(wouldBe);
      if (target) wouldBe.push(target);
      if (wouldBe.length >= this.warheadCount) break;
    }

    // 2) ПВО-щит жертвы срезает те, что легли бы под зонтом. isShielded метит
    //    сработавшие батареи → они уходят в перезарядку (fireShieldSams).
    const created: TileRef[] = [];
    let blocked = 0;
    for (const t of wouldBe) {
      if (this.isShielded(this.mg.x(t), this.mg.y(t))) {
        blocked++;
      } else {
        created.push(t);
      }
    }

    created.sort(
      (a, b) =>
        this.mg.manhattanDist(b, this.dst) - this.mg.manhattanDist(a, this.dst),
    );
    return { created, blocked };
  }

  private tryGenerateTarget(taken: TileRef[]): TileRef | undefined {
    for (let attempt = 0; attempt < 100; attempt++) {
      const r1 = this.random.next();
      const r2 = (r1 * 15485863) % 1;

      const x = Math.round(r1 * this.range * 2 - this.range + this.baseX);
      const y = Math.round(r2 * this.range * 2 - this.range + this.baseY);

      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }

      const tile = this.mg.ref(x, y);

      if (!this.mg.isLand(tile)) {
        continue;
      }

      if ((x - this.baseX) ** 2 + (y - this.baseY) ** 2 > this.rangeSquared) {
        continue;
      }

      if (this.mg.owner(tile) !== this.targetPlayer) {
        continue;
      }

      // terron: щит на этапе раскладки НЕ отсекает цель (строим ПОЛНЫЙ «куда бы
      // легло» для отчёта «сбито N/T»), но ВЫЗЫВАЕМ isShielded ради side-effect —
      // пометить накрывающие батареи сработавшими (уйдут в перезарядку). Реальный
      // срез шита делаем в selectDestinations.
      this.isShielded(x, y);

      if (this.isOverlapping(x, y, taken)) {
        continue;
      }

      return tile;
    }
  }

  private isOverlapping(x: number, y: number, taken: TileRef[]): boolean {
    for (const existingTile of taken) {
      const existingTileX = this.mg.x(existingTile);
      const existingTileY = this.mg.y(existingTile);
      const manhattanDistance =
        Math.abs(x - existingTileX) + Math.abs(y - existingTileY);

      if (manhattanDistance < this.minimumSpread) {
        return true;
      }
    }

    return false;
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

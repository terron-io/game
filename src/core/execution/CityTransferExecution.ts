// terron 24.08: ШАГАЮЩИЙ ГОРОД — каст «Перенос» (new-units/WALKING.md).
//
// ⚠️ ПЕРЕДЕЛАНО 25.08 по обкатке владельца: зоны и цены БОЛЬШЕ НЕТ. Два клика
// (или drag) = «взял ОДНО здание» + «поставил туда»; каст бесплатный, войска не
// тратятся. Цена ульты — её замок и единственный на матч выбор ульты.
//
// ⚠️ Порт идёт по ЛЮБОЙ своей суше; берег требуется только от КОНЕЧНОЙ точки
// (репорт «порты отказываются переноситься, пишут что нет пути»): маршрут по
// береговой кромке рвался на каждом мысе.
//
// ⚠️ УРОК ULTIMATES.md №16 соблюдён: никакого влияния на общий поиск пути.
// Маршруты — одноразовые ЛОКАЛЬНЫЕ BFS при касте (с капом тайлов), дальше
// здание просто шагает по готовому списку, как Дора по рельсам.
//
// ⚠️ УРОК №20 (флаг «юнитом рулит другой код» обязан иметь таймаут): здание,
// у которого следующий тайл перестал быть своим, ждёт TERRON_WALK_STUCK_TICKS
// и БРОСАЕТ поход — остаётся стоять где стоит, флаг ходьбы снимается.
import {
  TERRON_WALK_BFS_CAP,
  TERRON_WALK_PACK_GAP,
  TERRON_WALK_PICK_RADIUS,
  TERRON_WALK_RAIL_REWIRE_STEPS,
  TERRON_WALK_STEP_TICKS,
  TERRON_WALK_STUCK_TICKS,
} from "../configuration/TerronTuning";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Structures,
  Unit,
  UnitType,
  actingAs,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { rewireStation } from "./StationWiring";

/**
 * Здания, которые УЖЕ идут (любым переносом). Гард от второго каста по тому
 * же зданию: идущее в новую зону не попадает. Чистится на прибытии, отмене
 * и смерти здания; таймаут застревания не даёт флагу жить вечно.
 */
const WALKING = new WeakSet<Unit>();

/** Для тестов и будущих гейтов: идёт ли здание прямо сейчас. */
export function isWalkingUnit(u: Unit): boolean {
  return WALKING.has(u);
}

/** Типы, которым по пути нужен БЕРЕГ (порты ходят только вдоль воды). */
const SHORE_WALKERS: ReadonlySet<UnitType> = new Set(actingAs(UnitType.Port));

interface Walker {
  unit: Unit;
  path: TileRef[];
  idx: number;
  /** Тик, с которого ждём проходимости следующего тайла (0 = не застряли). */
  stuckSince: number;
}

export class CityTransferExecution implements Execution {
  private active = true;
  private mg: Game;
  private walkers: Walker[] = [];
  private started = false;
  private startedAt = 0;
  private arrivedAny = false;

  constructor(
    private player: Player,
    private zoneCenter: TileRef,
    private dst: TileRef | null,
    private troops: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.startedAt = ticks;
  }

  tick(ticks: number): void {
    if (!this.started) {
      this.started = true;
      if (!this.start()) {
        this.active = false;
        return;
      }
    }
    // Шаг раз в TERRON_WALK_STEP_TICKS — «1 тайл в секунду ок» (владелец).
    if ((ticks - this.startedAt) % TERRON_WALK_STEP_TICKS !== 0) return;
    this.step(ticks);
    if (this.walkers.length === 0) {
      if (this.arrivedAny) {
        this.mg.displayMessage(
          "events_display.walk_arrived",
          MessageType.WALKING,
          this.player.id(),
        );
      }
      this.active = false;
    }
  }

  /** Молчаливых отказов нет (урок №15): каждая причина — строка в ленту. */
  private fail(key: string): false {
    this.mg.displayMessage(key, MessageType.WALKING, this.player.id());
    return false;
  }

  private start(): boolean {
    // Гейт каста (штаб жив, выбор ульты, золото) — общий, из canBuild.
    if (
      this.player.canBuild(UnitType.CityTransfer, this.zoneCenter) === false
    ) {
      return this.fail("events_display.walk_invalid");
    }
    // Второй клик обязателен: без точки назначения идти некуда. Сюда попадает
    // и одинарный тап мобильной панели (v1-ограничение, см. WALKING.md).
    if (
      this.dst === null ||
      !this.mg.isValidRef(this.dst) ||
      !this.mg.isLand(this.dst) ||
      this.mg.owner(this.dst) !== this.player
    ) {
      return this.fail("events_display.walk_no_target");
    }

    // ⚠️ 25.08 (решения владельца): ЗОНЫ БОЛЬШЕ НЕТ и каст БЕСПЛАТНЫЙ —
    // «убери радиус и сделай перенос бесплатным, чтобы по одному зданию
    // переносить». Слайдер войск не участвует, копится ОДИН ходок: то здание,
    // по которому кликнули (или которое схватили драгом).
    const target = this.pickBuilding(this.zoneCenter);
    if (target === null) {
      return this.fail("events_display.walk_no_buildings");
    }

    // ⚠️ Порты: БЕРЕГ ТРЕБУЕТСЯ ТОЛЬКО В КОНЦЕ (репорт владельца «порты
    // отказываются переноситься, пишут что нет пути» — маршрут искался по
    // береговой кромке, а она рвётся на первом же мысе). Идёт порт где угодно
    // по своей земле; работать он всё равно начнёт лишь на берегу, где встанет.
    const needShore = SHORE_WALKERS.has(target.type());
    const spot = this.findSpot(this.dst, needShore);
    if (spot === null) {
      return this.fail(
        needShore ? "events_display.walk_no_shore" : "events_display.walk_no_path",
      );
    }
    const path = this.findPath(target.tile(), spot);
    if (path === null) {
      return this.fail("events_display.walk_no_path");
    }
    const planned: Walker[] = [{ unit: target, path, idx: 0, stuckSince: 0 }];

    for (const w of planned) {
      WALKING.add(w.unit);
      // Рельсы за зданием не ездят: снимаем станцию на старте, дальше её
      // перецепляет rewireStation на каждом шаге и обязательно по прибытии.
      // (До 25.08 её никто не возвращал — «фабрики перестают работать».)
      if (w.unit.hasTrainStation()) {
        this.mg.railNetwork().removeStation(w.unit);
      }
      // Видовой путь: клиент рисует нитку маршрута и гост в точке прибытия.
      w.unit.setWalkPath(w.path);
    }
    this.walkers = planned;
    this.mg.displayMessage(
      "events_display.walk_started",
      MessageType.WALKING,
      this.player.id(),
      undefined,
      { count: planned.length },
    );
    return true;
  }

  /**
   * Здание под точкой каста: ровно ОДНО (зоны больше нет). Клик редко попадает
   * в тайл здания пиксель-в-пиксель, поэтому берём ближайшее в пределах
   * TERRON_WALK_PICK_RADIUS — то же прощение промаха, что у остальных кастов.
   */
  private pickBuilding(at: TileRef): Unit | null {
    const rSq = TERRON_WALK_PICK_RADIUS * TERRON_WALK_PICK_RADIUS;
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of this.player.units(...Structures.types)) {
      if (!u.isActive() || u.isUnderConstruction() || WALKING.has(u)) continue;
      if (!this.mg.isLand(u.tile())) continue;
      const d = this.mg.euclideanDistSquared(u.tile(), at);
      if (d > rSq) continue;
      // Ничья по расстоянию — по id, иначе выбор зависел бы от порядка списка.
      if (d < bestD || (d === bestD && best !== null && u.id() < best.id())) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * Куда именно встать рядом с точкой назначения: своя земля, свободная от
   * других зданий; порту — обязательно берег (это единственное место, где
   * условие берега применяется, см. комментарий в start()).
   */
  private findSpot(dst: TileRef, needShore: boolean): TileRef | null {
    const gapSq = TERRON_WALK_PACK_GAP * TERRON_WALK_PACK_GAP;
    const occupied = this.player
      .units(...Structures.types)
      .filter((u) => u.isActive())
      .map((u) => u.tile());
    for (const t of this.collectOwnLand(dst)) {
      if (needShore && !this.mg.isShore(t)) continue;
      if (occupied.some((p) => this.mg.euclideanDistSquared(p, t) < gapSq)) {
        continue;
      }
      return t;
    }
    return null;
  }

  private step(ticks: number): void {
    const survivors: Walker[] = [];
    for (const w of this.walkers) {
      const u = w.unit;
      // Здание умерло или сменило владельца — поход окончен.
      if (!u.isActive() || u.owner() !== this.player) {
        WALKING.delete(u);
        if (u.isActive()) u.setWalkPath([]); // нитка маршрута больше не наша
        continue;
      }
      if (w.idx >= w.path.length) {
        WALKING.delete(u);
        this.arrivedAny = true;
        // Прибыли — рельсы обязаны отрасти на НОВОМ месте (репорт владельца
        // «в конце вообще без рельс стоит»), и нитку маршрута гасим.
        rewireStation(this.mg, u);
        u.setWalkPath([]);
        continue;
      }
      const next = w.path[w.idx];
      const passable =
        this.mg.isLand(next) && this.mg.owner(next) === this.player;
      if (!passable) {
        // Земля под маршрутом уехала: ждём с таймаутом (урок №20).
        if (w.stuckSince === 0) w.stuckSince = ticks;
        if (ticks - w.stuckSince >= TERRON_WALK_STUCK_TICKS) {
          WALKING.delete(u);
          // Поход брошен — здание остаётся здесь, значит и рельсы ему сюда.
          rewireStation(this.mg, u);
          u.setWalkPath([]);
          this.mg.displayMessage(
            "events_display.walk_blocked",
            MessageType.WALKING,
            this.player.id(),
          );
          continue;
        }
        survivors.push(w);
        continue;
      }
      w.stuckSince = 0;
      u.move(next);
      w.idx++;
      // Рельсы идут ЗА зданием: без перецепки фабрика в пути стоит мёртвой
      // (станция снята на старте). Частота — TERRON_WALK_RAIL_REWIRE_STEPS.
      if (w.idx % TERRON_WALK_RAIL_REWIRE_STEPS === 0) {
        rewireStation(this.mg, u);
      }
      // Остаток маршрута — для нитки и госта на клиенте.
      u.setWalkPath(w.path.slice(w.idx));
      survivors.push(w);
    }
    this.walkers = survivors;
  }

  /**
   * Своя суша вокруг точки назначения в порядке удаления от неё (BFS, кап).
   * Из этого же списка берутся и береговые точки для портов.
   */
  private collectOwnLand(from: TileRef): TileRef[] {
    const out: TileRef[] = [];
    const seen = new Set<TileRef>([from]);
    const queue: TileRef[] = [from];
    let head = 0;
    while (head < queue.length && queue.length < TERRON_WALK_BFS_CAP) {
      const t = queue[head++];
      out.push(t);
      for (const n of this.mg.neighbors(t)) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (this.mg.isLand(n) && this.mg.owner(n) === this.player) {
          queue.push(n);
        }
      }
    }
    return out;
  }

  /**
   * Маршрут по СВОЕЙ суше. BFS с восстановлением пути; null = не дойти. Кап
   * тайлов защищает тик.
   *
   * ⚠️ 25.08: условия «только по берегу» здесь БОЛЬШЕ НЕТ. Порт шёл по
   * береговой кромке, а она рвётся на каждом мысе и перешейке — отсюда репорт
   * владельца «порты отказываются переноситься, пишут что нет пути, хотя путь
   * близкий к морю». Берег теперь требуется ТОЛЬКО от конечной точки (findSpot).
   */
  private findPath(from: TileRef, to: TileRef): TileRef[] | null {
    if (from === to) return [];
    const ok = (t: TileRef) =>
      this.mg.isLand(t) && this.mg.owner(t) === this.player;
    const prev = new Map<TileRef, TileRef>();
    const queue: TileRef[] = [from];
    let head = 0;
    while (head < queue.length && prev.size < TERRON_WALK_BFS_CAP) {
      const t = queue[head++];
      for (const n of this.mg.neighbors(t)) {
        if (prev.has(n) || n === from) continue;
        if (!ok(n)) continue;
        prev.set(n, t);
        if (n === to) {
          const path: TileRef[] = [n];
          let cur: TileRef = n;
          while (cur !== from) {
            cur = prev.get(cur)!;
            if (cur !== from) path.push(cur);
          }
          path.reverse();
          return path;
        }
        queue.push(n);
      }
    }
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

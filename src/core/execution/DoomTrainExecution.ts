// terron 23.08 — «СОСТАВ СМЕРТИ», каст ульты «Взрывные поезда»
// (new-units/TRAINS.md). Идея владельца дословно: «поезд, который тикает».
//
// Устройство и ПОЧЕМУ именно так:
//  • Состав едет ПО СВОИМ РЕЛЬСАМ — тот же расчёт, что у Доры (RailReach.ts).
//    По чужим не пускаем осознанно: на чужой земле он был бы неубиваемым
//    сюрпризом, а весь смысл ульты — телеграф и контрплей.
//  • Он ВИДЕН ВСЕМ и ТИКАЕТ: над ним идёт красный отсчёт до подрыва (тот же
//    единый рисовальщик таймеров, что у отката и захваченных ульт).
//  • КОНТРПЛЕЙ — РВАТЬ ПУТИ ПЕРЕД НИМ. Потерял рельсу под собой или маршрут
//    оборвался — детонирует НА МЕСТЕ, не доехав. Поэтому пускать состав вглубь
//    чужой обороны рискованно: рванёт там, где его остановили.
import {
  TERRON_TRAINS_SPEED,
  TERRON_TRAINS_TARGET_SNAP,
  TERRON_TRAINS_STEP_EVERY,
  TERRON_TRAINS_TICK_SLACK,
} from "../configuration/TerronTuning";
import { Execution, Game, MessageType, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { railPath, railTilesFrom } from "../game/RailReach";
import { detonateDroneBlast } from "./SuicideDroneExecution";

/**
 * Ближайшая к точке достижимая точка сети — НЕ ДАЛЬШЕ МАГНИТА.
 *
 * ⚠️ Предела ДАЛЬНОСТИ у ульты нет: сеть тянется через чужие страны. Но и
 * «подсунуть ближайшую точку» с другого конца карты нельзя — тогда игрок не
 * знает, где рванёт (решение владельца 24.08: «либо магнить, либо запрещать,
 * если рядом нет рельс»). Тот же порог, что в гейте цели.
 */
function nearestOnRails(
  mg: Game,
  allowed: Set<TileRef>,
  target: TileRef,
): TileRef | null {
  const limit = TERRON_TRAINS_TARGET_SNAP * TERRON_TRAINS_TARGET_SNAP;
  let best: TileRef | null = null;
  let bestD = Infinity;
  for (const t of allowed) {
    const d = mg.euclideanDistSquared(t, target);
    if (d < bestD && d <= limit) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/**
 * Как часто состав пересчитывает достижимую сеть.
 *
 * ⚠️ Считаем ПЕРЕД КАЖДЫМ ШАГОМ (шаг идёт раз в TERRON_TRAINS_STEP_EVERY
 * тиков). Раз в секунду было мало: после ускорения состав успевал проскочить
 * участок, пути на котором уже разорвали, — контрплей срабатывал через раз.
 */
const REACH_REFRESH_TICKS = TERRON_TRAINS_STEP_EVERY;

export class DoomTrainExecution implements Execution {
  private active = true;
  private mg: Game;
  private train: Unit | null = null;
  private path: TileRef[] = [];
  private idx = 0;
  private startedAt = 0;
  private depotTile: TileRef | null = null;
  /** Тик, после которого состав рванёт в любом случае (страховка). */
  private deadline = Number.MAX_SAFE_INTEGER;
  /** Куда состав ЕДЕТ (клиент рисует там круг взрыва, пока он в пути). */
  private goal: TileRef | null = null;
  /** Достижимая сеть (пересчитывается — по ней же ловим разрыв путей). */
  private allowed: Set<TileRef> = new Set();
  private allowedAt = -1000;

  constructor(
    private player: Player,
    private target: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.startedAt = ticks;

    const depot = this.player
      .units(UnitType.TrainDepot)
      .find((u) => u.isActive() && !u.isUnderConstruction());
    if (depot === undefined) {
      this.active = false;
      return;
    }
    const allowed = railTilesFrom(this.mg, this.player, depot.tile(), true);
    this.allowed = allowed;
    this.allowedAt = ticks;
    this.depotTile = depot.tile();
    // ⚠️ terron 24.08 (репорт владельца «я указываю точку прибытия, и именно
    // туда эта хуета приезжает и там взрывается; щас оно где-то по пути
    // находит точку и там бахает»): ЦЕЛЬ — ЭТО ЦЕЛЬ.
    //
    // Раньше состав ехал к ближайшей к цели точке рельсов и рвал там. Со
    // стороны это выглядело как «поехал куда-то не туда»: игрок целился в
    // конкретное место, а взрыв случался за полкарты от него.
    //
    // Теперь цель обязана лежать НА достижимых рельсах — это проверяет гейт
    // постройки (PlayerImpl), а гост при наведении липнет к ближайшему рельсу.
    // Здесь остаётся страховка: цель не в зоне — приказ не принимается вовсе,
    // деньги не списываются.
    const goal = allowed.has(this.target)
      ? this.target
      : nearestOnRails(this.mg, allowed, this.target);
    if (goal === null) {
      this.mg.displayMessage(
        "events_display.doom_train_unreachable",
        MessageType.RAILGUN,
        this.player.id(),
      );
      this.active = false;
      return;
    }
    this.path = railPath(this.mg, allowed, depot.tile(), (t) => t === goal);
    if (this.path.length === 0) {
      this.mg.displayMessage(
        "events_display.doom_train_unreachable",
        MessageType.RAILGUN,
        this.player.id(),
      );
      this.active = false;
      return;
    }
    this.goal = goal;
    // Потолок жизни — ОТ ДЛИНЫ МАРШРУТА (см. TERRON_TRAINS_TICK_SLACK): при
    // фиксированном лимите длинный рейс обрывался взрывом посреди пути.
    this.deadline =
      ticks +
      Math.ceil((this.path.length * TERRON_TRAINS_STEP_EVERY) / TERRON_TRAINS_SPEED) *
        2 +
      TERRON_TRAINS_TICK_SLACK;
    const cost = this.mg.unitInfo(UnitType.DoomTrain).cost(this.mg, this.player);
    if (this.player.gold() < cost) {
      this.active = false;
      return;
    }
    this.player.removeGold(cost);
    this.train = this.player.buildUnit(UnitType.DoomTrain, depot.tile(), {});
    // Цель едет НА ЮНИТЕ — клиент рисует по ней круг взрыва, пока состав в
    // пути (тем же полем пользуется Дора для точки прилёта).
    this.train.setTargetTile(goal);
    this.mg.displayMessage(
      "events_display.doom_train_sent",
      MessageType.RAILGUN,
      null,
      undefined,
      { name: this.player.displayName() },
      undefined,
      this.player.id(),
    );
  }

  tick(ticks: number): void {
    if (!this.active) return;
    const train = this.train;
    if (train === null || !train.isActive()) {
      this.active = false;
      return;
    }
    // Страховка от вечного состава: даже если что-то пошло не так, он рванёт.
    if (ticks > this.deadline) {
      this.detonate(train);
      return;
    }
    // Отсчёт до подрыва: сколько тиков ехать при текущей скорости. Его же
    // видит жертва — это и есть телеграф.
    const left = Math.max(0, this.path.length - this.idx);
    // Отсчёт считаем по РЕАЛЬНОЙ скорости: тайлов осталось × тиков на тайл.
    train.setRailEta(
      Math.ceil((left * TERRON_TRAINS_STEP_EVERY) / TERRON_TRAINS_SPEED),
    );

    if (left === 0) {
      this.detonate(train);
      return;
    }
    // Состав ползёт: шаг раз в TERRON_TRAINS_STEP_EVERY тиков.
    if ((ticks - this.startedAt) % TERRON_TRAINS_STEP_EVERY !== 0) return;
    for (let i = 0; i < TERRON_TRAINS_SPEED && this.idx < this.path.length; i++) {
      const next = this.path[this.idx++];
      // ⚠️ terron 24.08 — РАЗРЫВ ЛОВИМ ПО ТОЙ ЖЕ СЕТИ, ПО КОТОРОЙ СТРОИЛИ ПУТЬ.
      //
      // Здесь стоял запрос «рельсы, перекрывающие тайл», и
      // именно она рвала состав «ровно там, где кончается моя территория»
      // (репорт владельца): этот запрос ищет рельсы В РАДИУСЕ СТАНЦИИ вокруг
      // тайла, то есть в середине длинного чужого перегона отвечает пусто —
      // хотя рельс там есть и путь по нему проложен.
      //
      // Правда одна: набор достижимых рельсов (railTilesFrom). Пересчитываем
      // его раз в секунду — выпал следующий шаг, значит пути реально
      // разорвали, и состав детонирует на месте.
      if (ticks - this.allowedAt >= REACH_REFRESH_TICKS) {
        this.allowedAt = ticks;
        this.allowed = railTilesFrom(
          this.mg,
          this.player,
          this.depotTile ?? train.tile(),
          true,
        );
      }
      if (!this.allowed.has(next)) {
        this.detonate(train);
        return;
      }
      train.move(next);
    }
  }

  private detonate(train: Unit): void {
    const site = train.tile();
    train.delete(false);
    this.active = false;
    // Магнитуда — своя (ядерка ×2 радиуса), а не дронная: тип передаётся
    // третьим аргументом, весь остальной эффект взрыва тот же.
    detonateDroneBlast(this.mg, site, this.player, UnitType.DoomTrain);
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

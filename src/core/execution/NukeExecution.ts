import { TERRON_NUKE_DEATH_MULT } from "../configuration/TerronTuning";
import {
  Execution,
  Game,
  MessageType,
  NeedsWaterUnder,
  NonBombNukes,
  Nukes,
  Player,
  Structures,
  TerraNullius,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { LaunchableNukeType, NukeType } from "../StatsSchemas";
import { listNukeBreakAlliance } from "./Util";

const SPRITE_RADIUS = 16;

// terron: общий счётчик судьбы боеголовок ОДНОГО МИРВа — MIRVExecution раздаёт
// его каждой боеголовке-NukeExecution, чтобы в конце отчитаться «сбито N/T».
export interface MirvTally {
  total: number;
  intercepted: number;
  detonated: number;
}

export class NukeExecution implements Execution {
  private active = true;
  private mg: Game;
  private nuke: Unit | null = null;
  private tilesToDestroyCache: Set<TileRef> | undefined;
  private pathFinder: ParabolaUniversalPathFinder;

  constructor(
    // terron: ультимейты — «Реки вспять» ездит той же экзекуцией, но в
    // статистику бомб (NukeType/bombUnits, zod-схема архива) НЕ пишется —
    // расширять схему ради одной ульты не стали, метрика своя (waterTiles).
    private nukeType: LaunchableNukeType,
    private player: Player,
    private dst: TileRef,
    private src?: TileRef | null,
    private speed: number = -1,
    private waitTicks = 0,
    private rocketDirectionUp: boolean = true,
    // terron: только для боеголовок МИРВа — общий счётчик «сбито/долетело».
    private mirvTally?: MirvTally,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.speed === -1) {
      this.speed = this.mg.config().defaultNukeSpeed();
    }
    this.pathFinder = UniversalPathFinding.Parabola(mg, {
      increment: this.speed,
      distanceBasedHeight: this.nukeType !== UnitType.MIRVWarhead,
      directionUp: this.rocketDirectionUp,
    });
  }

  public target(): Player | TerraNullius {
    return this.mg.owner(this.dst);
  }

  /** terron: ультимейты — это ракета «Реки вспять» (топит землю, а не выжигает). */
  /**
   * Топит ли эта ракета сушу. terron 01.09: таких ракет ДВЕ — у «Рек вспять»
   * и у Терраформинга. Отличаются они только ценой и воронкой, а эффект один,
   * поэтому здесь их и объединяем: любая проверка «это затопление» обязана
   * знать про обе, иначе ракета Терраформинга просто выжжет землю.
   */
  private isWaterNuke(): boolean {
    return (
      this.nukeType === UnitType.WaterNuke ||
      this.nukeType === UnitType.TerraFlood
    );
  }

  /** terron 25.08: ТЕРРАФОРМИНГ — «Насыпь» (вода в радиусе становится сушей). */
  private isLandNuke(): boolean {
    return this.nukeType === UnitType.LandNuke;
  }

  private tilesToDestroy(): Set<TileRef> {
    if (this.tilesToDestroyCache !== undefined) {
      return this.tilesToDestroyCache;
    }
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
    const rand = new PseudoRandom(this.mg.ticks());
    const inner2 = magnitude.inner * magnitude.inner;
    const outer2 = magnitude.outer * magnitude.outer;

    // terron: ультимейты — «Реки вспять» рисует такую же неровную кромку, как
    // мод «водяные ядерки», независимо от флага лобби: иначе после затопления
    // оставались бы одиночные пиксели суши, к которым надо плыть отдельно.
    // terron 25.08: «Насыпь» рисует такую же неровную кромку, что и затопление
    // (иначе новый остров был бы идеальным кругом — видно, что это не рельеф,
    // а штамп). «Ядерный удар» кромку НЕ меняет: он обычная ядерка.
    if (
      this.mg.config().waterNukes() ||
      this.isWaterNuke() ||
      this.isLandNuke()
    ) {
      // Smooth irregular boundary for water nukes.
      // Generate random radii at angular samples, then smooth them so the
      // boundary undulates gently instead of creating spiky flower shapes.
      // This avoids scattered land pixels that players would have to boat
      // to individually in order to reclaim.
      const NUM_SAMPLES = 16;
      const radiiSq: number[] = new Array(NUM_SAMPLES);
      for (let i = 0; i < NUM_SAMPLES; i++) {
        radiiSq[i] = rand.nextFloat(inner2, outer2);
      }
      // Smooth the ring: 1 light pass (60% original, 20% each neighbour)
      const prev = [...radiiSq];
      for (let i = 0; i < NUM_SAMPLES; i++) {
        const l = (i - 1 + NUM_SAMPLES) % NUM_SAMPLES;
        const r = (i + 1) % NUM_SAMPLES;
        radiiSq[i] = prev[i] * 0.6 + prev[l] * 0.2 + prev[r] * 0.2;
      }

      const cx = this.mg.x(this.dst);
      const cy = this.mg.y(this.dst);
      const outer = magnitude.outer;

      const result = new Set<TileRef>();
      // ⚠️ 01.09 (краш с боевого дева, «Invalid coordinates: 651.4,1367.4»):
      // РАДИУС может быть дробным (у ракет Терраформинга он 7.2/12.6 — это −10%
      // от прежнего), а индекс тайла обязан быть целым. Коробка перебора
      // округляется НАРУЖУ; форму по-прежнему задаёт проверка d2 — то есть на
      // целых радиусах поведение прежнее байт-в-байт.
      const x0 = Math.max(0, Math.floor(cx - outer));
      const y0 = Math.max(0, Math.floor(cy - outer));
      const x1 = Math.min(this.mg.width() - 1, Math.ceil(cx + outer));
      const y1 = Math.min(this.mg.height() - 1, Math.ceil(cy + outer));
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = px - cx;
          const dy = py - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 > outer2) continue;
          if (d2 > inner2) {
            const angle = Math.atan2(dy, dx) + Math.PI; // [0, 2π]
            const t = (angle / (2 * Math.PI)) * NUM_SAMPLES;
            const i0 = Math.floor(t) % NUM_SAMPLES;
            const i1 = (i0 + 1) % NUM_SAMPLES;
            const frac = t - Math.floor(t);
            const threshold = radiiSq[i0] * (1 - frac) + radiiSq[i1] * frac;
            if (d2 > threshold) continue;
          }
          result.add(this.mg.ref(px, py));
        }
      }
      this.tilesToDestroyCache = result;
    } else {
      this.tilesToDestroyCache = this.mg.bfs(this.dst, (_, n: TileRef) => {
        const d2 = this.mg?.euclideanDistSquared(this.dst, n) ?? 0;
        return d2 <= outer2 && (d2 <= inner2 || rand.chance(2));
      });
    }
    return this.tilesToDestroyCache;
  }

  /**
   * Break alliances with players significantly affected by the nuke strike.
   * Uses weighted tile counting (inner=1, outer=0.5) OR if any allied structure would be destroyed.
   */
  private maybeBreakAlliances() {
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    if (this.nuke.type() === UnitType.MIRVWarhead) {
      // MIRV warheads shouldn't break alliances
      return;
    }

    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());

    const playersToBreakAllianceWith = listNukeBreakAlliance({
      game: this.mg,
      targetTile: this.dst,
      magnitude,
      threshold: this.mg.config().nukeAllianceBreakThreshold(),
    });

    // Automatically reject incoming alliance requests.
    for (const incoming of this.player.incomingAllianceRequests()) {
      if (playersToBreakAllianceWith.has(incoming.requestor().smallID())) {
        incoming.reject();
      }
    }

    for (const playerSmallId of playersToBreakAllianceWith) {
      const attackedPlayer = this.mg.playerBySmallID(playerSmallId);
      if (!attackedPlayer.isPlayer()) {
        continue;
      }

      // Resolves exploit of alliance breaking in which a pending alliance request
      // was accepted in the middle of a missile attack.
      const outgoingAllianceRequest = attackedPlayer
        .incomingAllianceRequests()
        .find((ar) => ar.requestor() === this.player);
      if (outgoingAllianceRequest) {
        outgoingAllianceRequest.reject();
        continue;
      }

      const alliance = this.player.allianceWith(attackedPlayer);
      if (alliance !== null) {
        this.player.breakAlliance(alliance);
      }
      if (attackedPlayer !== this.player) {
        attackedPlayer.updateRelation(this.player, -100);
      }
    }
  }

  tick(ticks: number): void {
    if (this.nuke === null) {
      const spawn = this.player.canBuild(this.nukeType, this.dst);
      if (spawn === false) {
        console.warn(`cannot build Nuke`);
        this.active = false;
        return;
      }
      this.src = spawn;
      this.nuke = this.player.buildUnit(this.nukeType, spawn, {
        targetTile: this.dst,
        trajectory: this.getTrajectory(this.dst),
      });
      if (this.nuke.type() !== UnitType.MIRVWarhead) {
        this.maybeBreakAlliances();
      }
      // terron 01.09: ключ Терраформинга — «50 ракет «Реки вспять» за матч».
      //
      // ⚠️ СЧИТАЕМ ЗДЕСЬ, А НЕ В БЛОКЕ НИЖЕ. Тот блок целиком под
      // `hasOwner(dst)`: обычные бомбы записываются, только когда цель —
      // ЧУЖАЯ земля. Для этой ракеты так нельзя: ею чаще правят нейтральный
      // берег, и половина пусков не засчиталась бы вовсе. Поймано
      // собственным тестом, а не в бою.
      if (this.nukeType === UnitType.WaterNuke) {
        this.mg.stats().waterNukeLaunch(this.player);
      }
      if (this.mg.hasOwner(this.dst)) {
        const target = this.mg.owner(this.dst);
        if (!target.isPlayer()) {
          // Ignore terra nullius
        } else if (this.nukeType === UnitType.AtomBomb) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            // TODO TranslateText
            `${this.player.displayName()} - atom bomb inbound`,
            MessageType.NUKE_INBOUND,
            target.id(),
          );
        } else if (this.nukeType === UnitType.HydrogenBomb) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            // TODO TranslateText
            `${this.player.displayName()} - hydrogen bomb inbound`,
            MessageType.HYDROGEN_BOMB_INBOUND,
            target.id(),
          );
        }

        // Record stats: ракеты Терраформинга в схему bombUnits не входят
        // (см. конструктор). Проверка через группу — она type predicate,
        // поэтому в else тип сужается до NukeType, как и нужно bombLaunch.
        if (!NonBombNukes.has(this.nukeType)) {
          this.mg.stats().bombLaunch(this.player, target, this.nukeType);
        }
      }

      // after sending a nuke set the missilesilo on cooldown
      const silo = this.player
        .units(UnitType.MissileSilo)
        .find((silo) => silo.tile() === spawn);
      if (silo) {
        silo.launch();
      }
      return;
    }

    // make the nuke unactive if it was intercepted
    if (!this.nuke.isActive()) {
      // terron: боеголовку МИРВа сбило ПВО → в счётчик «сбито».
      if (this.mirvTally) this.mirvTally.intercepted++;
      this.active = false;
      return;
    }

    if (this.waitTicks > 0) {
      this.waitTicks--;
      return;
    }

    // Move to next tile
    const result = this.pathFinder.next(this.src!, this.dst, this.speed);
    if (result.status === PathStatus.COMPLETE) {
      this.detonate();
      return;
    } else if (result.status === PathStatus.NEXT) {
      this.updateNukeTargetable();
      this.nuke.move(result.node);
      // Update index so SAM can interpolate future position
      this.nuke.setTrajectoryIndex(this.pathFinder.currentIndex());
    }
  }

  public getNuke(): Unit | null {
    return this.nuke;
  }

  private getTrajectory(target: TileRef): TrajectoryTile[] {
    const trajectoryTiles: TrajectoryTile[] = [];
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const allTiles = this.pathFinder.findPath(this.src!, target) ?? [];
    for (const tile of allTiles) {
      trajectoryTiles.push({
        tile,
        targetable: this.isTargetable(target, tile, targetRangeSquared),
      });
    }

    return trajectoryTiles;
  }

  private isTargetable(
    targetTile: TileRef,
    nukeTile: TileRef,
    targetRangeSquared: number,
  ): boolean {
    return (
      this.mg.euclideanDistSquared(nukeTile, targetTile) < targetRangeSquared ||
      (this.src !== undefined &&
        this.src !== null &&
        this.mg.euclideanDistSquared(this.src, nukeTile) < targetRangeSquared)
    );
  }

  private updateNukeTargetable() {
    if (this.nuke === null || this.nuke.targetTile() === undefined) {
      return;
    }
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const targetTile = this.nuke.targetTile();
    this.nuke.setTargetable(
      this.isTargetable(targetTile!, this.nuke.tile(), targetRangeSquared),
    );
  }

  private detonate() {
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }

    const mg = this.mg;
    const config = mg.config();

    const magnitude = config.nukeMagnitudes(this.nuke.type());
    const toDestroy = this.tilesToDestroy();

    // Retrieve all impacted players and the number of tiles
    const tilesPerPlayers = new Map<Player, number>();
    for (const tile of toDestroy) {
      const owner = mg.owner(tile);
      // terron: ЧЬЯ БЫЛА ЗЕМЛЯ — снимаем ДО relinquish, иначе тайл уже ничей
      // и восстановить владельца будет неоткуда. Нужно Зелёным и АЭС. GREEN.md
      const prevOwnerSmallID = owner.isPlayer() ? owner.smallID() : 0;
      if (owner.isPlayer()) {
        owner.relinquish(tile);
        tilesPerPlayers.set(owner, (tilesPerPlayers.get(owner) ?? 0) + 1);
      }

      // Queue land tiles for batched water conversion
      // terron: «Реки вспять» — force: топим независимо от флага лобби.
      // terron: скины пепла — передаём smallID бомбившего для отрисовки.
      if (mg.isLand(tile)) {
        mg.queueWaterConversion(
          tile,
          this.isWaterNuke(),
          this.player.smallID(),
          prevOwnerSmallID,
        );
      } else if (this.isLandNuke()) {
        // terron 25.08: ТЕРРАФОРМИНГ — «Насыпь». Вода в воронке становится
        // НИЧЕЙНОЙ сушей (решение владельца): её занимает тот, кто дотянется,
        // в том числе противник. По СУШЕ ракета работает как обычная ядерка
        // (ветка выше) — это полноценное оружие, а не мирная стройка.
        mg.queueLandConversion(tile);
      }
    }

    // terron: ультимейты — метрика «Рек вспять»: сколько земли затоплено
    // (СВОЯ тоже считается — топил, значит считаем; поле в тултипе слота).
    if (this.isWaterNuke()) {
      let flooded = 0;
      for (const tile of toDestroy) {
        if (mg.isLand(tile)) flooded++;
      }
      this.player.addUltStat("waterTiles", flooded);
    }
    // terron 25.08: ТЕРРАФОРМИНГ — зеркальная метрика «Насыпи».
    if (this.isLandNuke()) {
      let raised = 0;
      for (const tile of toDestroy) {
        if (!mg.isLand(tile)) raised++;
      }
      this.player.addUltStat("landTiles", raised);
    }

    // terron: ультимейты — метрика МИРВ «территорий уничтожено»: чужие
    // (не свои) тайлы, снесённые боеголовками. Тултип слота ульты.
    if (this.nuke.type() === UnitType.MIRVWarhead) {
      let destroyed = 0;
      for (const [p, n] of tilesPerPlayers) {
        if (p !== this.player) destroyed += n;
      }
      this.player.addUltStat("mirvTiles", destroyed);
    }

    // Then compute the explosion effect on each player
    for (const [player, numImpactedTiles] of tilesPerPlayers) {
      const tilesBeforeNuke = player.numTilesOwned() + numImpactedTiles;
      const transportShips = player.units(UnitType.TransportShip);
      const outgoingAttacks = player.outgoingAttacks();
      const maxTroops = config.maxTroops(player);
      // nukeDeathFactor could compute the complete fallout in a single call instead
      for (let i = 0; i < numImpactedTiles; i++) {
        // Diminishing effect as each affected tile has been nuked
        const numTilesLeft = tilesBeforeNuke - i;
        player.removeTroops(
          config.nukeDeathFactor(
            this.nukeType,
            player.troops(),
            numTilesLeft,
            maxTroops,
            TERRON_NUKE_DEATH_MULT,
          ),
        );
        for (const attack of outgoingAttacks) {
          const attackTroops = attack.troops();
          const deaths = config.nukeDeathFactor(
            this.nukeType,
            attackTroops,
            numTilesLeft,
            maxTroops,
            TERRON_NUKE_DEATH_MULT,
          );
          attack.setTroops(attackTroops - deaths);
        }
        for (const unit of transportShips) {
          const unitTroops = unit.troops();
          const deaths = config.nukeDeathFactor(
            this.nukeType,
            unitTroops,
            numTilesLeft,
            maxTroops,
            TERRON_NUKE_DEATH_MULT,
          );
          unit.setTroops(unitTroops - deaths);
        }
      }
    }

    const outer2 = magnitude.outer * magnitude.outer;
    const dst = this.dst;
    const destroyer = this.player;
    for (const unit of mg.units()) {
      const type = unit.type();
      // Ракеты в полёте взрывом не сносим — ни свои, ни чужие.
      // ⚠️ terron 06.08: раньше список типов был перечислен ЗДЕСЬ руками, и новая
      // ракета «Реки вспять» в него не попала → она попадала в СОБСТВЕННУЮ волну,
      // удаляла сама себя, а следующей строкой detonate() пытался удалить её
      // второй раз → «cannot delete Unit:Water Nuke … not active», краш матча у
      // всех. Теперь берём группу Nukes из реестра — новая ракета защищена сама.
      if (Nukes.has(type) || type === UnitType.SAMMissile) {
        continue;
      }
      if (mg.euclideanDistSquared(dst, unit.tile()) < outer2) {
        unit.delete(true, destroyer);
      }
    }

    // terron 25.08: ТЕРРАФОРМИНГ — добиваем всё, под чем ИСЧЕЗЛА ВОДА.
    // ⚠️ Волна выше сносит юниты по СТРОГОМУ `d² < outer²`, а тайлы воронки
    // берутся по нестрогому — на кольце ровно в `outer` лодка переживала взрыв
    // и оставалась стоять посреди свежей суши. Считать это арифметикой
    // радиусов бессмысленно: правило другое — «под юнитом больше нет воды».
    if (this.isLandNuke()) {
      sinkUnitsLeftOnLand(mg, dst, magnitude.outer, toDestroy, destroyer);
    }

    this.redrawBuildings(magnitude.outer + SPRITE_RADIUS);
    this.active = false;
    // terron: боеголовка МИРВа долетела и подорвалась → в счётчик «долетело».
    if (this.mirvTally) this.mirvTally.detonated++;
    this.nuke.setReachedTarget();
    this.nuke.delete(false);

    if (
      this.nukeType === UnitType.AtomBomb ||
      this.nukeType === UnitType.HydrogenBomb
    ) {
      const messageKey =
        this.nukeType === UnitType.AtomBomb
          ? "events_display.atom_bomb_detonated"
          : "events_display.hydrogen_bomb_detonated";
      for (const [impactedPlayer] of tilesPerPlayers) {
        mg.displayMessage(
          messageKey,
          MessageType.NUKE_DETONATED,
          impactedPlayer.id(),
          undefined,
          { name: this.player.displayName() },
          undefined,
          this.player.id(),
        );
      }
    }

    // Record stats
    this.mg
      .stats()
      .bombLand(this.player, this.target(), this.nuke.type() as NukeType);

    // terron: ЗЕЛЁНЫЕ — возмездие за УСПЕШНУЮ детонацию. Точка выбрана здесь
    // намеренно: перехваченная ПВО ракета сюда не доходит, значит «сбили —
    // штрафа нет» получается само, без отдельного правила. Платит ТОТ, КТО
    // ПУСТИЛ (this.player), а не владелец земли под воронкой. GREEN.md
    this.mg.reportNukeDetonation(this.player, this.dst, this.nuke.type());
  }

  private redrawBuildings(range: number) {
    const rangeSquared = range * range;
    for (const unit of this.mg.units()) {
      if (Structures.has(unit.type())) {
        if (
          this.mg.euclideanDistSquared(this.dst, unit.tile()) < rangeSquared
        ) {
          unit.touch();
        }
      }
    }
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

/**
 * terron 25.08: ТЕРРАФОРМИНГ — утопить (снести) всё, что не умеет стоять на
 * суше, на тайлах, которые ею только что стали. Один пространственный запрос
 * на подрыв: набор тайлов уже посчитан, остаётся спросить юнитов рядом.
 */
export function sinkUnitsLeftOnLand(
  mg: Game,
  center: TileRef,
  radius: number,
  raised: ReadonlySet<TileRef>,
  destroyer: Player,
): void {
  for (const { unit } of mg.nearbyUnits(
    center,
    radius + 2,
    NeedsWaterUnder.types,
  )) {
    if (!unit.isActive()) continue;
    if (!raised.has(unit.tile())) continue;
    unit.delete(true, destroyer);
  }
}

/**
 * terron: ультимейты — «РЕКИ ВСПЯТЬ». Затопление В ТОЧКЕ, без ракеты.
 * Нужно для пробы «сбитая ПВО ракета всё равно оставляет воронку» (флаг
 * TERRON_RIVERS_CRATER_ON_INTERCEPT): радиусы умножаются на frac.
 *
 * Кромка неровная — тем же приёмом, что у полноценного подрыва: рандом между
 * inner и outer, иначе по краю остаются одиночные пиксели суши. Детерминизм:
 * PseudoRandom от тика, как в detonateDroneBlast.
 */
export function floodWaterCrater(
  mg: Game,
  dst: TileRef,
  owner: Player,
  frac: number,
): void {
  const magnitude = mg.config().nukeMagnitudes(UnitType.WaterNuke);
  const inner = Math.max(1, Math.round(magnitude.inner * frac));
  const outer = Math.max(inner, Math.round(magnitude.outer * frac));
  const inner2 = inner * inner;
  const outer2 = outer * outer;
  const rand = new PseudoRandom(mg.ticks());

  const toFlood = mg.bfs(dst, (_, n: TileRef) => {
    const d2 = mg.euclideanDistSquared(dst, n);
    return d2 <= outer2 && (d2 <= inner2 || rand.chance(2));
  });

  let flooded = 0;
  for (const tile of toFlood) {
    if (!mg.isLand(tile)) continue;
    const tileOwner = mg.owner(tile);
    if (tileOwner.isPlayer()) (tileOwner as Player).relinquish(tile);
    mg.queueWaterConversion(tile, true);
    flooded++;
  }
  if (flooded > 0) owner.addUltStat("waterTiles", flooded);
}

/**
 * terron 25.08: ТЕРРАФОРМИНГ — зеркало `floodWaterCrater` для «Насыпи».
 * Сбитая ПВО ракета всё равно оставляет ПОЛОВИННЫЙ островок в точке
 * перехвата: правило «перехват не отменяет терраформинг» должно работать в
 * обе стороны, иначе одна ракета ульты сбивается «полностью», а другая нет.
 *
 * ⚠️ Юниты тут НЕ сносятся (это не подрыв, а остаточный эффект) — но вода
 * под ними может стать сушей. Лодку на такой клетке вытолкнет обычная логика
 * пути: поднятая суша попадает в мини-карту и корабли её обходят.
 */
export function raiseLandCrater(
  mg: Game,
  dst: TileRef,
  owner: Player,
  frac: number,
): void {
  const magnitude = mg.config().nukeMagnitudes(UnitType.LandNuke);
  const inner = Math.max(1, Math.round(magnitude.inner * frac));
  const outer = Math.max(inner, Math.round(magnitude.outer * frac));
  const inner2 = inner * inner;
  const outer2 = outer * outer;
  const rand = new PseudoRandom(mg.ticks());

  let raised = 0;
  const cx = mg.x(dst);
  const cy = mg.y(dst);
  // ⚠️ Прямоугольный скан, а НЕ `mg.bfs`: заливка ходит по соседям от точки,
  // а точка перехвата вполне может быть над сушей — тогда островок вырос бы
  // только с той стороны, куда заливка «пролезла». У затопления обратной
  // беды нет (там источник всегда над сушей, которую и топят).
  for (
    let py = Math.max(0, cy - outer);
    py <= Math.min(mg.height() - 1, cy + outer);
    py++
  ) {
    for (
      let px = Math.max(0, cx - outer);
      px <= Math.min(mg.width() - 1, cx + outer);
      px++
    ) {
      const dx = px - cx;
      const dy = py - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > outer2) continue;
      if (d2 > inner2 && !rand.chance(2)) continue;
      const tile = mg.ref(px, py);
      if (mg.isLand(tile)) continue;
      mg.queueLandConversion(tile);
      raised++;
    }
  }
  if (raised > 0) owner.addUltStat("landTiles", raised);
}

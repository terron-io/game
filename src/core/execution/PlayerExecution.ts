import { Config } from "../configuration/Config";
import {
  TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS,
  TERRON_FANATICISM_GOLD_MULT,
  TERRON_FANATICISM_TROOPS_BONUS,
  TERRON_GREENS_GOLD_PENALTY,
  TERRON_GREENS_TROOP_BONUS,
  TERRON_INDUSTRIAL_TROOP_PENALTY,
  TERRON_OLYMPICS_BONUS,
  TERRON_OLYMPICS_GAMES_BONUS,
  TERRON_PRIDE_MAX_BONUS,
  TERRON_PRIDE_RESPITE_BONUS_MULT,
  TERRON_RELIGION_TITHE_PCT,
} from "../configuration/TerronTuning";
import {
  Cell,
  Execution,
  Game,
  Player,
  Structures,
  Ultimates,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { calculateBoundingBox, getMode, inscribed, simpleHash } from "../Util";
import { detonateDroneBlast } from "./SuicideDroneExecution";

interface ClusterTraversalState {
  visited: Uint32Array;
  /**
   * terron ПЕРФ (08.08): принадлежность тайла набору границ — ШТАМПОМ ПОКОЛЕНИЯ,
   * а не поиском в Set. Замер внутри `removeClusters` (временная инструментация)
   * показал, что 89–92% его времени уходит на `calculateClusters`, а тот на
   * каждый пограничный тайл делает восемь проверок соседей, и каждая была
   * `borderTiles.has(tile)`. Один проход по границам заменяет тысячи
   * хеш-поисков чтением из массива.
   */
  member: Uint32Array;
  gen: number;
}

// Per-game traversal state used by calculateClusters() to avoid per-player buffers.
const traversalStates = new WeakMap<Game, ClusterTraversalState>();

// terron: авиация — пустой набор по умолчанию для removeCluster без плацдармов.
const EMPTY_TILE_SET: ReadonlySet<TileRef> = new Set<TileRef>();

export class PlayerExecution implements Execution {
  private readonly ticksPerClusterCalc = 20;

  private config: Config;
  private lastCalc = 0;
  private mg: Game;
  private active = true;

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.config = mg.config();
    this.lastCalc =
      ticks + (simpleHash(this.player.name()) % this.ticksPerClusterCalc);
  }

  tick(ticks: number) {
    this.player.decayRelations();
    // terron: РЕВАНШИЗМ — обновляем исторический пик территории (детерминированно).
    this.player.updateMaxTiles();
    for (const u of this.player.units()) {
      if (!Structures.has(u.type())) {
        continue;
      }
      // terron: НЕФТЯНАЯ ВЫШКА стоит в океане — у её тайла НЕТ владельца, и
      // общая зачистка «структура на не-своей земле → снести» убила бы её в
      // первый же тик. Захвату вышка тоже не подлежит.
      // ⚠️ НО НЕ БЕССМЕРТНА: когда владелец умирает (0 тайлов), вышки идут ко
      // дну вместе с ним — этим занимается removeOnDeath ниже (решение
      // владельца: «смерть должна приходить, если я проиграл»). §ВЫШКА.
      // terron: КОСМОДРОМ на морской площадке — тот же случай, что у вышки:
      // у тайла нет владельца, и общая зачистка снесла бы его в первый тик.
      // На суше он обычная структура и под зачистку попадает штатно. SPACE.md
      if (
        u.type() === UnitType.OilRig ||
        (u.type() === UnitType.Spaceport && this.mg!.isOcean(u.tile()))
      ) {
        continue;
      }

      const owner = this.mg!.owner(u.tile());
      if (!owner?.isPlayer()) {
        u.delete();
        continue;
      }
      if (owner === this.player) {
        continue;
      }

      const captor = this.mg!.player(owner.id());
      if (u.type() === UnitType.DefensePost) {
        u.delete(true, captor);
      } else {
        captor.captureUnit(u);
      }
    }

    // terron: ЗАХВАЧЕННАЯ ЧУЖАЯ УЛЬТА самоуничтожается «ядерным взрывом» через
    // TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS тиков владения (флаг; 0 = ВЫКЛ). Своя
    // выбранная ульта (тип === ultimateChoice) не трогается; пассивку захваченной
    // используешь, пока живо, а дальше — снеси или взорвётся. new-units/ULTIMATES.md
    if (TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS > 0) {
      for (const u of this.player.units()) {
        if (!Ultimates.has(u.type()) || u.isUnderConstruction()) continue;
        if (this.player.ultimateChoice() === u.type()) continue; // своя выбранная
        const cap = u.capturedTick();
        if (cap === null) continue; // построена самим, не захвачена
        if (ticks - cap >= TERRON_CAPTURED_ULT_SELFDESTRUCT_TICKS) {
          this.detonateCapturedUlt(u);
        }
      }
    }

    if (!this.player.isAlive()) {
      this.removeOnDeath();
      this.active = false;
      this.mg.stats().playerKilled(this.player, ticks);
      return;
    }

    let troopInc = this.config.troopIncreaseRate(this.player);
    let goldFromWorkers = this.config.goldAdditionRate(this.player);
    // terron: ГОРДОСТЬ — чем ниже в топе, тем быстрее растут население и доход:
    // ×(1 + k·MAX_BONUS), k = отставание от лидера по территории (TerronTuning).
    if (this.player.hasUltimate(UnitType.Pride)) {
      const k = this.mg.prideFactor(this.player);
      if (k > 0) {
        // На время «Передышки» бонус удваивается (окно камбэка).
        const boost = this.mg.respiteActive(this.player)
          ? TERRON_PRIDE_RESPITE_BONUS_MULT
          : 1;
        const mult = 1 + k * TERRON_PRIDE_MAX_BONUS * boost;
        troopInc = Math.round(troopInc * mult);
        goldFromWorkers = BigInt(Math.round(Number(goldFromWorkers) * mult));
      }
    }
    // terron: ФАНАТИЗМ — войска ×3, золото ×½ (TerronTuning §ФАНАТИЗМ).
    if (this.player.hasUltimate(UnitType.Fanaticism)) {
      troopInc = Math.round(troopInc * (1 + TERRON_FANATICISM_TROOPS_BONUS));
      goldFromWorkers = BigInt(
        Math.round(Number(goldFromWorkers) * TERRON_FANATICISM_GOLD_MULT),
      );
    }
    // terron: ОЛИМПИЙСКИЕ ИГРЫ — стадион: +OLYMPICS_BONUS к приросту и доходу,
    // на время Игр (всемирный мир) — +OLYMPICS_GAMES_BONUS.
    if (this.player.hasUltimate(UnitType.Olympics)) {
      const bonus = this.mg.truceActive()
        ? TERRON_OLYMPICS_GAMES_BONUS
        : TERRON_OLYMPICS_BONUS;
      troopInc = Math.round(troopInc * (1 + bonus));
      goldFromWorkers = BigInt(
        Math.round(Number(goldFromWorkers) * (1 + bonus)),
      );
    }
    // terron: ЗЕЛЁНЫЕ — +30% прироста / −10% дохода (плата за отказ от ядерного
    // оружия). ⚠️ Прирост тут складывается с конверсией «шахта = город»
    // (Config.troopIncreaseRate) — обе прибавки идут в ОДНУ величину, при
    // обкатке крутить надо пару, а не штраф по золоту. GREEN.md
    if (this.player.hasUltimate(UnitType.Greens)) {
      troopInc = Math.round(troopInc * (1 + TERRON_GREENS_TROOP_BONUS));
      goldFromWorkers = BigInt(
        Math.round(Number(goldFromWorkers) * (1 - TERRON_GREENS_GOLD_PENALTY)),
      );
    }
    // terron: «ЭТО КАТАСТРОФА!» — штраф к доходу от Зелёных. Бьёт ТОЛЬКО по
    // золоту: прирост войск не трогаем намеренно — жертва остаётся с растущей
    // армией без денег, и её выталкивает в атаку. Это смена плана, а не
    // ослабление. GREEN.md
    const catastropheMult = this.player.catastropheGoldMult();
    if (catastropheMult < 1) {
      goldFromWorkers = BigInt(
        Math.round(Number(goldFromWorkers) * catastropheMult),
      );
    }
    // terron: ТОПЛИВО — «Индустриальная революция»: пока идёт, прирост режется.
    // Скорость при этом ×3 (FuelSpeed) — в этом и размен: темп ценой армии.
    if (this.player.industrialActive()) {
      troopInc = Math.round(troopInc * (1 - TERRON_INDUSTRIAL_TROOP_PENALTY));
    }
    this.player.addTroops(troopInc);
    // terron: ульта Религия — «десятина» на содержание храмов. КАЖДЫЙ живой храм
    // режет TITHE_PCT % от ТЕКУЩЕГО дохода (100 → 90 → 81 → 72.9 → …), то есть
    // ×0.9^N. N считается ровно так же, как квота роста в ReligionExecution
    // (ultimateCount: свои + захваченные, живые и достроенные) — числа обязаны
    // совпадать, иначе разъедется обещание «за каждый храм −10%».
    const temples = this.player.ultimateCount(UnitType.Religion);
    if (temples > 0) {
      const before = goldFromWorkers;
      for (let i = 0; i < temples; i++) {
        goldFromWorkers -= (goldFromWorkers * TERRON_RELIGION_TITHE_PCT) / 100n;
      }
      this.player.addUltStat("religionTithe", Number(before - goldFromWorkers));
    }
    this.player.addGold(goldFromWorkers);
    // terron: КОСМОДРОМ — копим ИМЕННО доход с рабочих (см. PlayerImpl). SPACE.md
    this.player.addIncomeAccrued(goldFromWorkers);

    // Record stats
    this.mg.stats().goldWork(this.player, goldFromWorkers);

    for (const alliance of this.player.alliances()) {
      if (alliance.expiresAt() <= this.mg.ticks()) {
        alliance.expire();
      }
    }

    for (const embargo of this.player.getEmbargoes()) {
      if (
        embargo.isTemporary &&
        this.mg.ticks() - embargo.createdAt >
          this.mg.config().temporaryEmbargoDuration()
      ) {
        this.player.stopEmbargo(embargo.target);
      }
    }

    // terron ПЕРФ (П5, 12.07, тюнинг 13.07 по фидбэку владельца): было
    // «<100 тайлов = пересчёт КАЖДЫЙ тик» — в первые 1-2 минуты ВСЕ боты
    // мелкие, десятки флудфиллов на тик душили воркер в момент спавна.
    // Мелкие теперь раз в 5 тиков (задержка отреза куска ≤0.5с — глазом не
    // поймать), крупные — на общем интервале 20.
    const interval =
      this.player.numTilesOwned() < 100 ? 5 : this.ticksPerClusterCalc;
    // terron 28.08: во время «вспышки» раскола территория жертвы рвётся
    // намеренно — пересчитывать схлопывание анклавов посреди процесса незачем,
    // а стоит он O(границы) и на большой стране это десятки-сотни мс.
    if (ticks < this.player.clusterCalcPausedUntil()) return;
    if (ticks - this.lastCalc > interval) {
      if (this.player.lastTileChange() >= this.lastCalc) {
        this.lastCalc = ticks;
        const start = performance.now();
        this.removeClusters();
        const end = performance.now();
        if (end - start > 1000) {
          console.log(`player ${this.player.name()}, took ${end - start}ms`);
        }
      }
    }
  }

  private removeClusters() {
    // terron: ультимейты — Раскол: бот-сепаратист навсегда иммунен к
    // авто-схлопыванию окружением (отколотая страна не срастается сама).
    if (this.player.isImmuneToCollapse()) {
      return;
    }
    const clusters = this.calculateClusters();

    if (clusters.length === 0) {
      this.player.largestClusterBoundingBox = null;
      return;
    }

    // Find the largest cluster with a single linear scan (O(n)).
    let largestIndex = 0;
    let largestSize = clusters[0].size;
    for (let i = 1; i < clusters.length; i++) {
      const size = clusters[i].size;
      if (size > largestSize) {
        largestSize = size;
        largestIndex = i;
      }
    }

    const largestCluster = clusters[largestIndex];
    if (largestCluster === undefined) throw new Error("No clusters");

    // terron: авиация — активные десантные плацдармы. Иммунитет применяется РЕГИОНОМ внутри
    // removeCluster (borderTiles-кластер ≠ полный регион: тайл высадки становится ВНУТРЕННИМ,
    // когда пятно разрастается — проверять его в border-кластере нельзя). Держится весь срок
    // (30с); истечение/потеря тайла — в activeAirborneBeachheads; выход к морю/краю — ниже.
    const beachheads = this.player.activeAirborneBeachheads(this.mg.ticks());

    const largestClusterBox = calculateBoundingBox(this.mg, largestCluster);
    this.player.largestClusterBoundingBox = largestClusterBox;
    const surroundedBy = this.surroundedBySamePlayer(
      largestCluster,
      largestClusterBox,
    );
    if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
      this.removeCluster(largestCluster, beachheads);
    }

    // Process remaining clusters
    for (let i = 0; i < clusters.length; i++) {
      if (i === largestIndex) continue;
      const cluster = clusters[i];
      if (this.isSurrounded(cluster)) {
        this.removeCluster(cluster, beachheads);
      }
    }

    // terron: авиация — снять метку у плацдармов, чей регион вырвался к морю/краю карты
    // (получил выход → окружение больше не грозит → гаснут иммунитет и клиентский таймер).
    if (beachheads.size > 0) {
      for (const tile of beachheads) {
        if (this.regionReachedOpen(tile)) {
          this.player.clearAirborneBeachhead(tile);
        }
      }
    }
  }

  // terron: авиация — регион своих тайлов от `startTile` касается моря/края карты?
  // Ранний выход на первом же «открытом» тайле. Регион >CAP считаем безопасным (это не
  // хрупкий окружённый карман) → тоже «вырвался», чтобы ограничить стоимость флудфилла.
  private regionReachedOpen(startTile: TileRef): boolean {
    const OPEN_REGION_CAP = 2000;
    const myID = this.player.smallID();
    const visited = new Set<TileRef>([startTile]);
    const stack: TileRef[] = [startTile];
    while (stack.length > 0) {
      const t = stack.pop()!;
      if (this.mg.isShore(t) || this.mg.isOnEdgeOfMap(t)) return true;
      this.mg.forEachNeighbor(t, (n) => {
        if (!visited.has(n) && this.mg.ownerID(n) === myID) {
          visited.add(n);
          stack.push(n);
        }
      });
      if (visited.size > OPEN_REGION_CAP) return true;
    }
    return false;
  }

  private surroundedBySamePlayer(
    cluster: Set<TileRef>,
    clusterBox: { min: Cell; max: Cell },
  ): false | Player {
    const enemies = new Set<number>();

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const tile of cluster) {
      let hasUnownedNeighbor = false;
      if (this.mg.isOceanShore(tile) || this.mg.isOnEdgeOfMap(tile)) {
        return false;
      }
      this.mg.forEachNeighbor(tile, (n) => {
        if (!this.mg.hasOwner(n)) {
          hasUnownedNeighbor = true;
          return;
        }
        const ownerId = this.mg.ownerID(n);
        if (ownerId !== this.player.smallID()) {
          enemies.add(ownerId);
          const px = this.mg.x(n);
          const py = this.mg.y(n);
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
        }
      });
      if (hasUnownedNeighbor) {
        return false;
      }
      if (enemies.size !== 1) {
        return false;
      }
    }
    if (enemies.size !== 1) {
      return false;
    }

    const enemy = this.mg.playerBySmallID(Array.from(enemies)[0]) as Player;
    const localEnemyBox = {
      min: new Cell(minX, minY),
      max: new Cell(maxX, maxY),
    };
    if (inscribed(localEnemyBox, clusterBox)) {
      return enemy;
    }
    return false;
  }

  private isSurrounded(cluster: Set<TileRef>): boolean {
    let hasEnemy = false;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const tr of cluster) {
      if (this.mg.isShore(tr) || this.mg.isOnEdgeOfMap(tr)) {
        return false;
      }
      this.mg.forEachNeighbor(tr, (n) => {
        const owner = this.mg.owner(n);
        if (owner.isPlayer() && this.mg.ownerID(n) !== this.player.smallID()) {
          hasEnemy = true;
          const x = this.mg.x(n);
          const y = this.mg.y(n);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      });
    }
    if (!hasEnemy) {
      return false;
    }
    const clusterBox = calculateBoundingBox(this.mg, cluster);
    const enemyBox = { min: new Cell(minX, minY), max: new Cell(maxX, maxY) };
    return inscribed(enemyBox, clusterBox);
  }

  private removeCluster(
    cluster: Set<TileRef>,
    beachheads: ReadonlySet<TileRef> = EMPTY_TILE_SET,
  ) {
    for (const t of cluster) {
      if (this.mg?.ownerID(t) !== this.player?.smallID()) {
        // Other removeCluster operations could change tile owners,
        // so double check.
        return;
      }
    }

    const capturing = this.getCapturingPlayer(cluster);
    if (capturing === null) {
      return;
    }

    const firstTile = cluster.values().next().value;
    if (!firstTile) {
      return;
    }

    const tiles = this.floodFillWithGen(
      this.bumpGeneration(),
      this.traversalState().visited,
      [firstTile],
      (tile, cb) => this.mg.forEachNeighbor(tile, cb),
      (tile) => this.mg.ownerID(tile) === this.player.smallID(),
    );

    // terron: авиация — не отбираем регион, в котором есть живой десантный плацдарм
    // (иммунитет). Проверяем по РЕГИОНУ, а не по border-кластеру: тайл высадки часто
    // внутренний. Спека: airport.md.
    if (beachheads.size > 0) {
      for (const bh of beachheads) {
        if (tiles.has(bh)) return;
      }
    }

    if (this.player.numTilesOwned() === tiles.size) {
      this.mg.conquerPlayer(capturing, this.player);
    }

    for (const tile of tiles) {
      capturing.conquer(tile);
    }
  }

  private getCapturingPlayer(cluster: Set<TileRef>): Player | null {
    const neighbors = new Map<Player, number>();
    for (const t of cluster) {
      this.mg.forEachNeighbor(t, (neighbor) => {
        const owner = this.mg.owner(neighbor);
        if (
          owner.isPlayer() &&
          owner !== this.player &&
          !owner.isFriendly(this.player)
        ) {
          neighbors.set(owner, (neighbors.get(owner) ?? 0) + 1);
        }
      });
    }

    // If there are no enemies, return null
    if (neighbors.size === 0) {
      return null;
    }

    // Get the largest attack from the neighbors
    let largestNeighborAttack: Player | null = null;
    let largestTroopCount = 0;
    for (const [neighbor] of neighbors) {
      for (const attack of neighbor.outgoingAttacks()) {
        if (attack.target() === this.player) {
          if (attack.troops() > largestTroopCount) {
            largestTroopCount = attack.troops();
            largestNeighborAttack = neighbor;
          }
        }
      }
    }

    if (largestNeighborAttack !== null) {
      return largestNeighborAttack;
    }

    // There are no ongoing attacks, so find the enemy with the largest border.
    return getMode(neighbors);
  }

  private calculateClusters(): Set<TileRef>[] {
    const borderTiles = this.player.borderTiles();
    if (borderTiles.size === 0) return [];

    const state = this.traversalState();
    const currentGen = this.bumpGeneration();
    const visited = state.visited;
    const member = state.member;

    // Штампуем принадлежность ОДИН раз, дальше проверка — чтение из массива.
    // Раньше на её месте был `borderTiles.has(tile)`, и звался он на каждого из
    // восьми соседей КАЖДОГО пограничного тайла.
    for (const t of borderTiles) member[t] = currentGen;
    const isMember = (tile: TileRef) => member[tile] === currentGen;

    const clusters: Set<TileRef>[] = [];

    for (const startTile of borderTiles) {
      if (visited[startTile] === currentGen) continue;

      const cluster = this.floodFillWithGen(
        currentGen,
        visited,
        [startTile],
        (tile, cb) => this.mg.forEachNeighborWithDiag(tile, cb),
        isMember,
      );
      clusters.push(cluster);
    }
    return clusters;
  }

  owner(): Player {
    if (this.player === null) {
      throw new Error("Not initialized");
    }
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  private traversalState(): ClusterTraversalState {
    const totalTiles = this.mg.width() * this.mg.height();
    let state = traversalStates.get(this.mg);
    if (!state || state.visited.length < totalTiles) {
      state = {
        visited: new Uint32Array(totalTiles),
        member: new Uint32Array(totalTiles),
        gen: 0,
      };
      traversalStates.set(this.mg, state);
    }
    return state;
  }

  private bumpGeneration(): number {
    const state = this.traversalState();
    state.gen++;
    if (state.gen === 0xffffffff) {
      state.visited.fill(0);
      state.member.fill(0); // штампы принадлежности живут в том же поколении
      state.gen = 1;
    }
    return state.gen;
  }

  private floodFillWithGen(
    currentGen: number,
    visited: Uint32Array,
    startTiles: TileRef[],
    neighborFn: (tile: TileRef, callback: (neighbor: TileRef) => void) => void,
    includeFn: (tile: TileRef) => boolean,
  ): Set<TileRef> {
    const result = new Set<TileRef>();
    const stack: TileRef[] = [];

    for (const start of startTiles) {
      if (visited[start] === currentGen) continue;
      if (!includeFn(start)) continue;
      visited[start] = currentGen;
      result.add(start);
      stack.push(start);
    }

    while (stack.length > 0) {
      const tile = stack.pop()!;
      neighborFn(tile, (neighbor) => {
        if (visited[neighbor] === currentGen) {
          return;
        }
        if (!includeFn(neighbor)) {
          return;
        }
        visited[neighbor] = currentGen;
        result.add(neighbor);
        stack.push(neighbor);
      });
    }

    return result;
  }

  // terron: «ядерный взрыв» захваченной чужой ульты (правки владельца 18.07):
  // зона и урон — КАК У ДРОНА-КАМИКАДЗЕ (detonateDroneBlast: снятие территории,
  // урон войскам по ядерной модели, снос юнитов в радиусе — включая само здание),
  // плюс ЯДЕРНЫЙ след — фоллаут («вонючие остатки») на освободившейся суше зоны.
  // Фоллаут и включает клиентский ядерный визуал (heat/bloom по FALLOUT-флипу).
  // Флаг-гейт — в tick().
  private detonateCapturedUlt(u: Unit): void {
    const center = u.tile();
    // source="selfdestruct": самоподрыв в дроновый ключ не пишет (ревью 24.08).
    detonateDroneBlast(
      this.mg,
      center,
      this.player,
      UnitType.SuicideDrone,
      "selfdestruct",
    );
    const magnitude = this.mg.config().nukeMagnitudes(UnitType.SuicideDrone);
    const inner2 = magnitude.inner * magnitude.inner;
    const cx = this.mg.x(center);
    const cy = this.mg.y(center);
    const r = magnitude.inner;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > inner2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.mg.isValidCoord(x, y)) continue;
        const t = this.mg.ref(x, y);
        if (this.mg.isLand(t) && !this.mg.hasOwner(t)) {
          // terron: скины пепла — атрибуция взрыва владельцу захваченной ульты.
          this.mg.setFallout(t, true, this.player.smallID());
        }
      }
    }
    // Здание сносит blast (юниты в радиусе); страховка, если центр вне зоны сноса.
    if (u.isActive()) u.delete(true);
  }

  private removeOnDeath(): void {
    // Player (bot, human, nation) has no tiles
    // Delete any remaining gold, non-nuke units and alliances
    const gold = this.player.gold();
    this.player.removeGold(gold);

    // terron: сюда попадают и НЕФТЯНЫЕ ВЫШКИ — единственные строения, которые
    // переживают обычную зачистку (стоят на ничейной воде). Проиграл, тайлов
    // ноль → вышки тонут, «вечных» построек в океане не остаётся.
    this.player.units().forEach((u) => {
      if (
        u.type() !== UnitType.AtomBomb &&
        u.type() !== UnitType.HydrogenBomb &&
        u.type() !== UnitType.MIRVWarhead &&
        u.type() !== UnitType.MIRV
      ) {
        u.delete();
      }
    });

    this.player.removeAllAlliances();
  }
}

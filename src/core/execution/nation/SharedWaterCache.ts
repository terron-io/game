import { Game, Player, PlayerType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";

/**
 * Cache for "which water components does each nation share with a
 * valid trade partner". Used by nation AI to decide whether to spend cycles
 * trying to place a port on a given coastline.
 *
 * Rebuilt at most once every TTL_TICKS (3s at 10 ticks/s). Port placement is
 * not time-critical - a nation noticing a newly-valid port site a few seconds
 * late is fine and lets us amortize the O(total_border_tiles) build across
 * far more callers than a per-tick cache would.
 */
const TTL_TICKS = 30;

/** Sentinel added to a player's shared-water set to signal "touches ocean". */
const OCEAN_SENTINEL = -1;

/** Что игрок трогает по воде + когда это посчитано (для переиспользования). */
interface WaterTouch {
  hasOcean: boolean;
  lakes: Set<number>;
  builtAtTick: number;
  waterVersion: number;
}

export class SharedWaterCache {
  private tick: number = -Infinity;
  private byPlayer: Map<Player, Set<number> | null> | null = null;
  // terron 30.08 (перф): результат первого прохода по игрокам, чтобы не обходить
  // границы тех, у кого с прошлой перестройки ничего не изменилось.
  private touchCache = new Map<Player, WaterTouch>();

  // terron 30.08 (перф): «что этот тайл трогает по воде» — свойство КАРТЫ, а не
  // игрока: 0 не считано, 1 не берег, 2 берег без океана, 3 берег с океаном.
  // Между перестройками берег почти не меняется, поэтому вместо восьми проверок
  // соседей на каждый береговой тайл (а их за перестройку десятки тысяч) выходит
  // одно чтение массива. Живёт, пока не изменилась вода.
  private tileFlags: Uint8Array | null = null;
  private tileLakes = new Map<TileRef, number[]>(); // озёрные берега — редкость
  private tileWaterVersion = -1;

  /** Заполнить/прочитать флаг тайла. */
  private tileFlag(tile: TileRef): number {
    const flags = this.tileFlags!;
    const cached = flags[tile];
    if (cached !== 0) return cached;
    const game = this.game;
    if (!game.isShore(tile)) {
      flags[tile] = 1;
      return 1;
    }
    let hasOcean = false;
    let lakes: number[] | null = null;
    // forEachNeighbor вместо neighbors(): тот же обход, но без массива на тайл.
    game.forEachNeighbor(tile, (neighbor) => {
      if (!game.isWater(neighbor)) return;
      if (game.isOcean(neighbor)) {
        hasOcean = true;
        return;
      }
      const comp = game.getWaterComponent(neighbor);
      if (comp === null) return;
      lakes ??= [];
      if (!lakes.includes(comp)) lakes.push(comp);
    });
    if (lakes !== null) this.tileLakes.set(tile, lakes);
    const f = hasOcean ? 3 : 2;
    flags[tile] = f;
    return f;
  }

  constructor(private game: Game) {}

  get(player: Player): Set<number> | null {
    const tick = this.game.ticks();
    if (this.byPlayer === null || tick - this.tick >= TTL_TICKS) {
      this.byPlayer = this.build();
      this.tick = tick;
    }
    return this.byPlayer.get(player) ?? null;
  }

  private build(): Map<Player, Set<number> | null> {
    const game = this.game;

    // Pass 1: for each non-bot player, record which water bodies they touch
    // and which lakes have them as a candidate trade partner. Bots are skipped
    // entirely — nation AI is the only caller, and bots are never candidate
    // trade partners.
    const playerToWater = new Map<
      Player,
      { hasOcean: boolean; lakes: Set<number> }
    >();
    const lakePartners = new Map<number, Player[]>();

    // terron 30.08 (перф): раньше здесь безусловно обходились ГРАНИЦЫ ВСЕХ
    // не-бот игроков. Замер боевого матча tv7W7Sbi: одна перестройка стоила
    // 312 766 обращений к карте (худшая 532 918), а идёт она раз в 30 тиков
    // ЦЕЛИКОМ внутри одного тика — то есть регулярная заминка раз в 3 секунды,
    // растущая вместе со странами. На весь матч это 19.1% работы движка.
    //
    // Обход нужен только тем, у кого с прошлой перестройки изменилась
    // территория (`lastTileChange`) или под ногами изменилась вода
    // (`waterGraphVersion` — «Реки вспять»/Терраформинг). У остальных набор
    // «какую воду трогаю» измениться не мог, и он берётся готовым.
    // ⚠️ terrainVersion, а НЕ waterGraphVersion: второй бампается только при
    // пересборке графа путей (по интервалу), то есть кэш «берег ли тайл» успел бы
    // отстать от затопления на несколько тиков и бот увидел бы старую береговую линию.
    const waterVersion = game.terrainVersion();
    // Вода изменилась («Реки вспять»/Терраформинг) — тайловый кэш недействителен.
    // ⚠️ Массив ПЕРЕИСПОЛЬЗУЕТСЯ (fill вместо new): затопление бампает версию, и
    // аллокация на всю карту при каждой водной ракете съела бы весь выигрыш.
    if (this.tileFlags === null) {
      this.tileFlags = new Uint8Array(game.width() * game.height());
      this.tileWaterVersion = waterVersion;
    } else if (this.tileWaterVersion !== waterVersion) {
      this.tileFlags.fill(0);
      this.tileLakes.clear();
      this.tileWaterVersion = waterVersion;
    }
    const nextTouch = new Map<Player, WaterTouch>();
    const now = game.ticks();

    for (const player of game.players()) {
      if (player.type() === PlayerType.Bot) continue;

      const cached = this.touchCache.get(player);
      let touch: WaterTouch;
      if (
        cached !== undefined &&
        cached.waterVersion === waterVersion &&
        player.lastTileChange() < cached.builtAtTick
      ) {
        touch = cached;
      } else {
        let hasOcean = false;
        const lakes = new Set<number>();
        for (const tile of player.borderTiles()) {
          const f = this.tileFlag(tile);
          if (f === 1) continue;
          if (f === 3) hasOcean = true;
          const lk = this.tileLakes.get(tile);
          if (lk !== undefined) for (const c of lk) lakes.add(c);
        }
        touch = { hasOcean, lakes, builtAtTick: now, waterVersion };
      }
      nextTouch.set(player, touch);
      const { hasOcean, lakes } = touch;
      playerToWater.set(player, { hasOcean, lakes });

      for (const c of lakes) {
        let arr = lakePartners.get(c);
        if (arr === undefined) {
          arr = [];
          lakePartners.set(c, arr);
        }
        arr.push(player);
      }
    }

    // Pass 2: ocean is treated as always shared (nation AI short-circuits on
    // ocean neighbors). Lake components are shared only if some *other* player
    // on that component can trade with P (i.e. no mutual embargo).
    const result = new Map<Player, Set<number> | null>();
    for (const [player, { hasOcean, lakes }] of playerToWater) {
      const shared = new Set<number>();

      if (hasOcean) shared.add(OCEAN_SENTINEL);

      for (const c of lakes) {
        const partners = lakePartners.get(c);
        if (partners === undefined) continue;
        for (const other of partners) {
          if (other !== player && player.canTrade(other)) {
            shared.add(c);
            break;
          }
        }
      }

      result.set(player, shared.size > 0 ? shared : null);
    }
    // Пересоздаём карту, а не дописываем: записи выбывших игроков не копятся.
    this.touchCache = nextTouch;
    return result;
  }
}

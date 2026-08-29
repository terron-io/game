// terron: ультимейты — РЕЛИГИЯ: ЗДАНИЕ-храм (копий сколько угодно; следующий —
// только когда предыдущий достроен). Пока стоит хотя бы один храм, ВСЯ территория
// владельца очень медленно расползается наружу: за TERRON_RELIGION_PERIOD_TICKS
// обходится вся граница (снимок → обрабатываем порциями, размазывая нагрузку по
// периоду), и каждый пограничный тайл «обращает» до quota ближайших ЗЕМЕЛЬНЫХ
// тайлов в радиусе TERRON_RELIGION_REACH — тихим прямым conquer (БЕЗ «вас
// атакуют», как бункеры Укреплений).
//
// ⚠️ РЕМЕЙК 06.08 (решение владельца), см. TerronTuning §РЕЛИГИЯ:
//   • обход ОДИН НА ИГРОКА. Гоняет его СТАРЕЙШИЙ готовый храм, остальные храмы
//     только числятся в счётчике (их run() выходит сразу). Раньше у каждого
//     храма был свой обход и эффекты СКЛАДЫВАЛИСЬ (3+5=8) — это и был главный
//     разгон. Теперь квота ОБЩАЯ: BASE + PER_TEMPLE × N = 2+N (1 храм = 3, 2 = 4,
//     3 = 5, …), а платит игрок за каждый храм −10% ТЕКУЩЕГО дохода (0.9^N).
//   • НЕ трогаем пустошь (ничейную сушу), радиопепел и тех, с кем сейчас
//     АКТИВНЫЙ ФРОНТ (живая атака в любую сторону). Союзников/тиммейтов ЖРЁМ.
// Детерминизм: оффсеты диска в фиксированном порядке, граница — в порядке
// итерации Set (insertion order), счёт храмов — по _ultBuildings (порядок не важен).
// Спека: new-units/ULTIMATES.md
import {
  TERRON_RELIGION_COST_HIGHLAND,
  TERRON_RELIGION_COST_MOUNTAIN,
  TERRON_RELIGION_COST_PLAINS,
  TERRON_RELIGION_PERIOD_TICKS,
  TERRON_RELIGION_REACH,
  TERRON_RELIGION_SKIP_AT_WAR,
  TERRON_RELIGION_SPARE_ALLIES,
  TERRON_RELIGION_TAKE_FALLOUT,
  TERRON_RELIGION_TAKE_NEUTRAL,
  TERRON_RELIGION_TILES_BASE,
  TERRON_RELIGION_TILES_PER_TEMPLE,
} from "../configuration/TerronTuning";
import { Player, TerrainType, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { UltimateBuildingExecution } from "./UltimateBuildingExecution";

export class ReligionExecution extends UltimateBuildingExecution {
  // Оффсеты диска радиуса REACH, ближние первыми (стабильный порядок).
  private discOffsets: Array<[number, number]> = [];
  // Текущий «обход» границы: снимок пограничных тайлов + курсор. Обрабатываем
  // queue.length/PERIOD тайлов за тик → полный обход за ~PERIOD тиков = 1 кольцо.
  private queue: TileRef[] = [];
  private cursor = 0;
  // smallID тех, с кем сейчас активный фронт (пересобирается каждый тик обхода).
  private atWar = new Set<number>();

  protected onInit(): void {
    const r = TERRON_RELIGION_REACH;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dy === 0) continue; // сам пограничный тайл — наш
        if (dx * dx + dy * dy > r2) continue;
        this.discOffsets.push([dx, dy]);
      }
    }
    this.discOffsets.sort((a, b) => {
      const da = a[0] * a[0] + a[1] * a[1];
      const db = b[0] * b[0] + b[1] * b[1];
      if (da !== db) return da - db;
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0] - b[0];
    });
  }

  protected run(player: Player): void {
    // ОДИН обход на игрока: работает только старейший ГОТОВЫЙ храм. Порядок =
    // вставка в _units (build order; захваченный уезжает в конец), стабилен и
    // детерминирован; снесли ведущий → следующий сам подхватывает обход.
    if (!this.isLeadTemple(player)) return;

    // Обход исчерпан → делаем новый снимок границы (естественная ~PERIOD-каденция).
    if (this.cursor >= this.queue.length) {
      this.queue = Array.from(player.borderTiles());
      this.cursor = 0;
      if (this.queue.length === 0) return;
    }

    // Сколько пограничных тайлов обработать в этот тик, чтобы весь снимок
    // разошёлся за PERIOD тиков (= 1 «кольцо» роста за период).
    const perTick = Math.max(
      1,
      Math.ceil(this.queue.length / TERRON_RELIGION_PERIOD_TICKS),
    );
    // Квота на пограничный тайл ОБЩАЯ и растёт от числа живых храмов: 2+N.
    const tilesPerBorder =
      TERRON_RELIGION_TILES_BASE +
      TERRON_RELIGION_TILES_PER_TEMPLE *
        player.ultimateCount(UnitType.Religion);

    this.refreshWarSet(player);

    let processed = 0;
    let taken = 0;
    while (this.cursor < this.queue.length && processed < perTick) {
      const b = this.queue[this.cursor++];
      processed++;
      // Тайл мог перестать быть нашим после снимка — растём только от своей земли.
      if (this.mg.owner(b) !== player) continue;
      taken += this.pulse(player, b, tilesPerBorder);
    }
    if (taken > 0) player.addUltStat("religionTiles", taken);
  }

  // Ведущий храм = первый ЖИВОЙ ДОСТРОЕННЫЙ в порядке units(). Недостроенные
  // пропускаем — иначе стройка второго храма глушила бы обход на 10 секунд.
  private isLeadTemple(player: Player): boolean {
    for (const u of player.units(UnitType.Religion)) {
      if (!u.isActive() || u.isUnderConstruction()) continue;
      return u === this.hq;
    }
    return false;
  }

  // С кем сейчас активный фронт: живая атака в ЛЮБУЮ сторону (он на меня или я
  // на него). Списки атак живые (AttackImpl.delete чистит их) и короткие — 1-3
  // элемента, пересборка каждый тик дешевле, чем ловить события.
  private refreshWarSet(player: Player): void {
    this.atWar.clear();
    if (!TERRON_RELIGION_SKIP_AT_WAR) return;
    for (const a of player.incomingAttacks()) {
      const attacker = a.attacker();
      if (attacker !== player) this.atWar.add(attacker.smallID());
    }
    for (const a of player.outgoingAttacks()) {
      const target = a.target();
      if (target.isPlayer()) this.atWar.add((target as Player).smallID());
    }
  }

  /** terron: во сколько «сотых бюджета» обходится обращение тайла (рельеф). */
  private terrainCost(tile: TileRef): number {
    switch (this.mg.terrainType(tile)) {
      case TerrainType.Mountain:
        return TERRON_RELIGION_COST_MOUNTAIN;
      case TerrainType.Highland:
        return TERRON_RELIGION_COST_HIGHLAND;
      default:
        return TERRON_RELIGION_COST_PLAINS;
    }
  }

  // Один пограничный тайл «обращает» до tilesPerBorder ближайших чужих
  // земельных тайлов в радиусе. Возвращает число взятых.
  private pulse(
    player: Player,
    center: TileRef,
    tilesPerBorder: number,
  ): number {
    const cx = this.mg.x(center);
    const cy = this.mg.y(center);
    let taken = 0;
    // terron 07.08: БЮДЖЕТ вместо счётчика тайлов — по сложному рельефу вера
    // идёт медленнее (горы дороже равнины, как и у обычной атаки).
    // TerronTuning §РЕЛЬЕФ ТОРМОЗИТ ВЕРУ.
    let budget = tilesPerBorder * TERRON_RELIGION_COST_PLAINS;
    for (const [dx, dy] of this.discOffsets) {
      if (budget < TERRON_RELIGION_COST_PLAINS) break;
      const x = cx + dx;
      const y = cy + dy;
      if (!this.mg.isValidCoord(x, y)) continue;
      const t = this.mg.ref(x, y);
      if (!this.mg.isLand(t)) continue;
      // Радиопепел: «в радиоактивном пепле обращать некого». Движок кладёт пепел
      // ТОЛЬКО на ничейные тайлы (GameImpl.setFallout кидает, если есть владелец),
      // так что проверка страхует нас на случай, если пустошь снова разрешат.
      if (!TERRON_RELIGION_TAKE_FALLOUT && this.mg.hasFallout(t)) continue;

      const owner = this.mg.owner(t);
      if (owner === player) continue;
      if (!owner.isPlayer()) {
        // Пустошь: обращать некого.
        if (!TERRON_RELIGION_TAKE_NEUTRAL) continue;
      } else {
        const p = owner as Player;
        // Дохлых игроков не трогаем (тайлов у них нет, но на всякий случай).
        if (!p.isAlive()) continue;
        // Активный фронт → вера молчит, пока идёт война.
        if (this.atWar.has(p.smallID())) continue;
        // Союзников/тиммейтов по умолчанию ЖРЁМ («вера не разбирает»).
        if (TERRON_RELIGION_SPARE_ALLIES && player.isFriendly(p)) continue;
      }

      // Цена тайла по рельефу: не хватило бюджета — этот пропускаем, но, может,
      // рядом найдётся равнина подешевле.
      const cost = this.terrainCost(t);
      if (cost > budget) continue;

      // Тихий захват (прямой conquer, НЕ AttackExecution) — без «вас атакуют».
      player.conquer(t);
      budget -= cost;
      taken++;
    }
    return taken;
  }
}

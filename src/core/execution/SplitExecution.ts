// terron: ультимейты — РАСКОЛ (Split). Таргетная «пропаганда» (не ракета).
// Наводишься на чужую страну — игра рисует «флаг»: прямоугольник ASPECT_W:ASPECT_H
// с буквой Т ВНУТРИ (рамка основы со всех сторон). Тайлы ЦЕЛИ внутри флага:
//   • ОСНОВА флага (всё, кроме Т) → новой НАЦИИ-сепаратисту «Независимая {ник}»
//     (иммунна к авто-схлопыванию; сразу в КОРОТКОМ союзе с атакующим (2 мин) и с
//     жертвой (1 мин));
//   • буква Т (лояльное ядро) ОСТАЁТСЯ ЖЕРТВЕ. Пока жив союз сеп.↔жертва, Т окружена
//     СОЮЗНОЙ нацией → не схлопывается (+«тихий» иммунитет-страховка на то же окно).
//     Когда союз истечёт (RESCUE_TURNS), нация-сепаратист сама поглощает Т (коллапс
//     окружённого анклава). Выбор ЖЕРТВЫ: предать союз и отбить коридор к Т сейчас
//     (дебаф предательства) — или ждать конца союза и дозахватывать Т отдельно.
//     Спека: new-units/SPLIT.md
// Размер флага растёт от вложенных войск. Захват основы — «вспышкой» (пачками за
// PEEL_TICKS). Детерминированно: целочисленная геометрия, тайлы в фикс-порядке.
import {
  TERRON_SPLIT_ALLY_TURNS_ATTACKER,
  TERRON_SPLIT_ALLY_TURNS_VICTIM,
  TERRON_SPLIT_ASPECT_H,
  TERRON_SPLIT_ASPECT_W,
  TERRON_SPLIT_MIN_BASE_TILES,
  TERRON_SPLIT_PEEL_MAX_PER_TICK,
  TERRON_SPLIT_PEEL_TICKS,
  TERRON_SPLIT_RESCUE_TURNS,
  TERRON_SPLIT_TROOP_MULT,
} from "../configuration/TerronTuning";
import {
  Execution,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../game/Game";

import { TileRef } from "../game/GameMap";
import {
  isSplitTTile,
  splitHalfHeight,
  splitTShape,
} from "../game/SplitGeometry";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { PlayerExecution } from "./PlayerExecution";
import { SPLIT_NATION_PREFIXES } from "./SplitNames";
import { TribeExecution } from "./TribeExecution";

export class SplitExecution implements Execution {
  private active = true;
  private mg: Game;
  private random: PseudoRandom;

  // Заполняется на первом тике (фаза раскола). Пока null — раскол ещё не произошёл.
  private nation: Player | null = null;
  // «Вспышка»: очередь захвата основы нацией (пачками за TERRON_SPLIT_PEEL_TICKS).
  private peelQueue: TileRef[] = [];
  private peelBudget = 1;

  // Тик, на котором истекает окно защиты Т (иммунитет + короткий союз сеп.↔жертва).
  private rescueTick = 0;
  // Тайлы буквы Т (у жертвы) и bbox флага — по истечении окна решаем судьбу Т ЯВНО
  // (коллапс движка ленив: пересчитывается только при смене тайлов, ненадёжно).
  private tTiles: TileRef[] = [];
  private victim: Player | null = null;
  private flag: { cx: number; cy: number; hh: number; hw: number } | null =
    null;

  constructor(
    private player: Player,
    private dst: TileRef,
    private troops: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks() + simpleHash(this.player.id()));
  }

  tick(ticks: number): void {
    // Фаза 1 — подготовка раскола (один раз): валидация, нация, очередь захвата.
    if (this.nation === null) {
      this.doSplit();
      return;
    }
    // Фаза 2 — «вспышка»: пачками отдаём основу нации.
    if (this.peelQueue.length > 0) {
      this.peelStep();
      return;
    }
    // Фаза 3 — окно защиты Т истекло: снимаем цифру-маркер и ЯВНО решаем судьбу Т.
    if (this.mg.ticks() < this.rescueTick) return;
    this.resolveT();
    this.active = false;
  }

  // Судьба Т после окна: если жертва пробила коридор к своей земле (регион Т вышел за
  // прямоугольник флага) — Т остаётся жертве; иначе окружённое нацией ядро переходит
  // нации-сепаратисту. Явно (не полагаемся на ленивый коллапс removeClusters).
  private resolveT(): void {
    const mg = this.mg;
    this.player.setSplitRescue(null); // снять цифру-маркер
    const victim = this.victim;
    const nation = this.nation;
    const flag = this.flag;
    if (victim === null || nation === null || flag === null) return;
    const victimSmall = victim.smallID();
    for (const t of this.tTiles) victim.clearSilentImmunity(t);
    if (!nation.isAlive()) return;
    // Тайлы Т, всё ещё у жертвы (часть могла быть потеряна/отбита).
    const held = this.tTiles.filter((t) => mg.ownerID(t) === victimSmall);
    if (held.length === 0) return;
    // Пробит коридор к своим (регион вышел за флаг) — спасено, оставляем жертве.
    if (this.regionEscapesFlag(held, flag, victimSmall)) return;
    for (const t of held) {
      if (mg.ownerID(t) === victimSmall) nation.conquer(t);
    }
  }

  // Флуд-филл по тайлам владельца от Т: вышли за прямоугольник флага → регион соединён
  // с основной территорией (коридор пробит) → спасено.
  private regionEscapesFlag(
    seeds: TileRef[],
    flag: { cx: number; cy: number; hh: number; hw: number },
    ownerSmall: number,
  ): boolean {
    const mg = this.mg;
    const visited = new Set<TileRef>(seeds);
    const stack = [...seeds];
    while (stack.length > 0) {
      const t = stack.pop()!;
      if (
        Math.abs(mg.x(t) - flag.cx) > flag.hw ||
        Math.abs(mg.y(t) - flag.cy) > flag.hh
      ) {
        return true;
      }
      mg.forEachNeighbor(t, (n) => {
        if (!visited.has(n) && mg.ownerID(n) === ownerSmall) {
          visited.add(n);
          stack.push(n);
        }
      });
    }
    return false;
  }

  // Захват пачки основы нацией (эффект расползающегося раскола за ~1-2с).
  private peelStep(): void {
    const nation = this.nation!;
    let n = Math.min(this.peelBudget, this.peelQueue.length);
    while (n-- > 0) {
      nation.conquer(this.peelQueue.shift()!);
    }
  }

  private doSplit(): void {
    const mg = this.mg;
    const attacker = this.player;

    // Валидация: цель — живой игрок, не ты сам.
    const spawn = attacker.canBuild(UnitType.Split, this.dst);
    if (spawn === false) {
      this.active = false;
      return;
    }
    const ownerTile = mg.owner(this.dst);
    if (!ownerTile.isPlayer()) {
      this.active = false;
      return;
    }
    const victim = ownerTile as Player;
    if (victim === attacker) {
      this.active = false;
      return;
    }

    // Геометрия флага: размер ТОЛЬКО от доли атаки (процента вложенных войск от всех
    // текущих), не от абсолюта. ratio = вложено / всего (до списания). Полу-ширина —
    // по соотношению сторон. Площадь флага — доля СУШИ КАРТЫ (06.08), поэтому
    // передаём numLandTiles: превью на клиенте берёт то же число из GameView.
    const ratio = this.troops / Math.max(1, attacker.troops());
    const hh = splitHalfHeight(ratio, mg.numLandTiles());
    const hw = Math.floor((hh * TERRON_SPLIT_ASPECT_W) / TERRON_SPLIT_ASPECT_H);
    const cx = mg.x(this.dst);
    const cy = mg.y(this.dst);
    const shape = splitTShape(hh, hw);
    const victimSmall = victim.smallID();

    // Классификация тайлов ЦЕЛИ внутри флага (детерм. порядок y↓, x→).
    const baseTiles: TileRef[] = [];
    const tTiles: TileRef[] = [];
    for (let y = cy - hh; y <= cy + hh; y++) {
      const ry = y - cy;
      for (let x = cx - hw; x <= cx + hw; x++) {
        if (!mg.isValidCoord(x, y)) continue;
        const t = mg.ref(x, y);
        if (mg.ownerID(t) !== victimSmall) continue;
        if (isSplitTTile(x - cx, ry, shape)) tTiles.push(t);
        else baseTiles.push(t);
      }
    }

    // Слишком мелкая добыча — раскол не срабатывает (деньги/войска целы, выбор
    // не фиксируется). Не плодим нацию из пары тайлов.
    if (baseTiles.length < TERRON_SPLIT_MIN_BASE_TILES) {
      this.active = false;
      return;
    }

    // Списываем цену: золото + вложенные войска (войска просто сгорают — это «расход»).
    const cost = mg.unitInfo(UnitType.Split).cost(mg, attacker);
    attacker.removeGold(cost);
    const spent = Math.min(Math.max(0, this.troops), attacker.troops());
    if (spent > 0) attacker.removeTroops(spent);

    // Фиксируем выбор ульты (как buildUnit для строимых). Стат пика — раз.
    if (attacker.chooseUltimate(UnitType.Split)) {
      mg.stats().ultimateChosen(attacker, UnitType.Split);
    }

    // Население нации: пропорция «войск жертвы × доля отколотых тайлов» × множитель
    // (иначе для больших стран сепаратист выходил дохлым). Кап — войска жертвы.
    const victimTilesBefore = victim.numTilesOwned();
    let nationTroops = 0;
    if (victimTilesBefore > 0) {
      nationTroops = Math.floor(
        (victim.troops() * baseTiles.length * TERRON_SPLIT_TROOP_MULT) /
          victimTilesBefore,
      );
      if (nationTroops > 0) nationTroops = victim.removeTroops(nationTroops);
    }

    // Создаём НАЦИЮ-сепаратиста «Независимая {ник жертвы}». Первый тайл основы
    // отдаём сразу (нужен как спавн), остальное — «вспышкой» в peelStep.
    const nation = this.spawnSeparatistNation(victim);
    nation.conquer(baseTiles[0]);
    if (nationTroops > 0) nation.addTroops(nationTroops);
    nation.setSpawnTile(baseTiles[0]);
    nation.markImmuneToCollapse(); // отколотая страна назад само не срастается
    mg.addExecution(new PlayerExecution(nation));
    mg.addExecution(new TribeExecution(nation)); // ИИ по образцу племени

    this.rescueTick = mg.ticks() + TERRON_SPLIT_RESCUE_TURNS;

    // Новая нация — в КОРОТКОМ союзе (перекрываем 5-мин дефолт кастомной длительностью):
    // с атакующим 2 мин, с жертвой ровно окно защиты Т (1 мин). Пока союз с жертвой
    // жив — Т, окружённая нацией, НЕ схлопывается; истёк — нация поглощает Т сама.
    attacker.createAllianceRequest(nation)?.accept();
    attacker
      .allianceWith(nation)
      ?.setExpiresAt(mg.ticks() + TERRON_SPLIT_ALLY_TURNS_ATTACKER);
    victim.createAllianceRequest(nation)?.accept();
    victim
      .allianceWith(nation)
      ?.setExpiresAt(mg.ticks() + TERRON_SPLIT_ALLY_TURNS_VICTIM);

    // Буква Т ОСТАЁТСЯ ЖЕРТВЕ (её лояльное ядро). «Тихий» иммунитет на окно защиты —
    // держит анклав от схлопывания (без цифры на каждом тайле). Судьбу Т по истечении
    // окна решает resolveT ЯВНО (владелец → нация, если коридор не пробит).
    for (const t of tTiles) {
      victim.addSilentImmunity(t, this.rescueTick);
    }
    this.tTiles = tTiles;
    this.victim = victim;
    this.flag = { cx, cy, hh, hw };

    // Один маркер-таймер: ОДНА крупная цифра в перекрестье Т — сколько ещё защищена.
    // Рисуется на атакующем-касте (видит исход своего раскола).
    attacker.setSplitRescue({
      x: cx,
      y: cy + shape.innerTop + Math.floor(shape.barThick / 2),
      w: 2 * shape.stemHalf + 1,
      expiry: this.rescueTick,
    });

    attacker.addUltStat("splitTiles", baseTiles.length);

    // Очередь «вспышки»: оставшаяся основа → нации.
    for (let i = 1; i < baseTiles.length; i++) {
      this.peelQueue.push(baseTiles[i]);
    }
    // ⚠️ ПОТОЛОК ОБЯЗАТЕЛЕН: без него бюджет = «тайлов / 50», то есть большой
    // раскол грузит тик тем сильнее, чем он крупнее. Замер и разбор — у
    // TERRON_SPLIT_PEEL_MAX_PER_TICK.
    this.peelBudget = Math.max(
      1,
      Math.min(
        TERRON_SPLIT_PEEL_MAX_PER_TICK,
        Math.ceil(this.peelQueue.length / TERRON_SPLIT_PEEL_TICKS),
      ),
    );

    // ⚠️ Пауза схлопывания анклавов у ЖЕРТВЫ на время вспышки (+запас). Её
    // территория сейчас рвётся намеренно, а пересчёт кластеров стоит O(границы)
    // и на большой стране даёт шипы в сотни мс — именно они, а не сам захват,
    // роняли симуляцию (замер: 439 мс за 70 тиков против 4 мс без раскола).
    const peelTicks = Math.ceil(
      this.peelQueue.length / Math.max(1, this.peelBudget),
    );
    victim.pauseClusterCalcUntil(mg.ticks() + peelTicks + 10);

    this.nation = nation;
  }

  private spawnSeparatistNation(victim: Player): Player {
    // Каждый раскол = новое государство → варьируем «политический» префикс.
    // Детерминированный выбор по сиду. Канон — АНГЛИЙСКИЙ (одинаково у всех
    // клиентов); RU накладывается на клиенте (localizeSeparatistName).
    const prefix =
      SPLIT_NATION_PREFIXES[
        this.random.nextInt(0, SPLIT_NATION_PREFIXES.length)
      ].en;
    const info = new PlayerInfo(
      `${prefix} ${victim.name()}`,
      PlayerType.Nation,
      null,
      this.random.nextID(),
    );
    return this.mg.addPlayer(info);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

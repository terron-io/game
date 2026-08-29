// terron: ультимейты — Укрепления: ЗДАНИЕ-штаб (одно на игрока). Пока штаб
// жив и достроен, каждый достроенный бункер (Defense Post) владельца раз в
// TERRON_FORT_PERIOD_TICKS автозахватывает до TERRON_FORT_TILES_PER_PULSE
// ближайших вражеских/ничейных ЗЕМЕЛЬНЫХ тайлов в радиусе своей защиты —
// ближние первыми. Захватывается тайл, граничащий с НАШЕЙ землёй ИЛИ с ВОДОЙ
// (прибрежный) → фронт ползёт по суше И перепрыгивает воду на берега/островки
// (вода НЕ блокирует), но не телепортит захват вглубь чужой суши. Детерминизм:
// диск-оффсеты в фикс-порядке, бункеры в порядке units(). Спека: new-units/ULTIMATES.md
import {
  fortHqRangeMult,
  fortRangeMult,
  TERRON_FORT_FAR_POWER_PCT,
  TERRON_FORT_IDLE_RECHECK_TICKS,
  TERRON_FORT_NEAR_POWER_PCT,
  TERRON_FORT_PERIOD_TICKS,
  TERRON_FORT_TILES_PER_PULSE,
} from "../configuration/TerronTuning";
import { Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType } from "../game/GameUpdates";
import { UltimateBuildingExecution } from "./UltimateBuildingExecution";

export class FortificationsExecution extends UltimateBuildingExecution {
  private checkOffset = 0;
  // Оффсеты диска радиуса бункера (ближние первыми) + отдельный БОЛЬШИЙ диск
  // самого штаба (он тоже «бункер», радиус ×2 от нормы). Тройка [dx, dy, cost]:
  // cost — целочисленная «стоимость» захвата тайла в центи-мощности (предрасчёт
  // по расстоянию до бункера, см. buildDisc). Ближе к бункеру — дешевле → берётся
  // больше тайлов за импульс; у кромки — дороже. Рантайм строго целочисленный.
  private discOffsets: Array<[number, number, number]> = [];
  private hqDiscOffsets: Array<[number, number, number]> = [];
  // Уровень штаба, под который построены диски (апгрейд «поверх» увеличивает
  // радиус → пересобираем при смене уровня).
  private discLevel = 0;
  // Перф (идея владельца): бункеры без фронта (пульс взял 0) спят до тика —
  // холостой скан диска не гоняем каждую секунду. unitId → тик пробуждения.
  private sleepUntil = new Map<number, number>();

  protected onInit(): void {
    this.checkOffset = this.mg.ticks() % TERRON_FORT_PERIOD_TICKS;
    this.rebuildDisc(this.hq.level());
  }

  // Радиус автозахвата: базовый (defensePostRange × множитель) с ростом уровня.
  // Бункеры — fortRangeMult (×1.2..×1.8), сам штаб — fortHqRangeMult (×2..×3).
  private rebuildDisc(level: number): void {
    this.discLevel = level;
    const base = this.mg.config().defensePostRange();
    this.discOffsets = this.buildDisc(Math.round(base * fortRangeMult(level)));
    this.hqDiscOffsets = this.buildDisc(Math.round(base * fortHqRangeMult(level)));
  }

  // Диск радиуса r, оффсеты ближними первыми (стабильный детерминированный порядок).
  // Для каждого оффсета сразу считаем ЦЕЛОЧИСЛЕННУЮ стоимость захвата в центи-мощности:
  // мощность линейно падает NEAR_PCT→FAR_PCT по расстоянию d∈[0,r], cost = 10000/pct
  // (в центи-единицах бюджета TILES_PER_PULSE×100). Math.sqrt зовём ЗДЕСЬ, один раз при
  // сборке (идентично на всех клиентах) → результат целый → рантайм детерминирован.
  private buildDisc(r: number): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = [];
    const r2 = r * r;
    const span = TERRON_FORT_NEAR_POWER_PCT - TERRON_FORT_FAR_POWER_PCT;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const q = dx * dx + dy * dy;
        if (q > r2) continue;
        // pct: доля мощности на этом расстоянии (NEAR у центра → FAR у кромки).
        const frac = r > 0 ? Math.sqrt(q) / r : 0; // 0..1
        const pct = Math.max(1, Math.round(TERRON_FORT_NEAR_POWER_PCT - span * frac));
        const cost = Math.round(10000 / pct); // центи-мощность за 1 тайл
        out.push([dx, dy, cost]);
      }
    }
    out.sort((a, b) => {
      const da = a[0] * a[0] + a[1] * a[1];
      const db = b[0] * b[0] + b[1] * b[1];
      if (da !== db) return da - db;
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0] - b[0];
    });
    return out;
  }

  protected run(player: Player): void {
    // Апгрейд «поверх» поднял уровень — пересобрать диск под новый радиус.
    if (this.hq.level() !== this.discLevel) {
      this.rebuildDisc(this.hq.level());
      this.sleepUntil.clear();
    }
    if (this.mg.ticks() % TERRON_FORT_PERIOD_TICKS !== this.checkOffset) {
      return;
    }

    // САМ штаб — тоже «бункер», но радиусом ×2 (свой больший диск).
    this.pulseWithSleep(player, this.hq.id(), this.hq.tile(), this.hqDiscOffsets);
    // Обычные бункеры.
    for (const post of player.units(UnitType.DefensePost)) {
      if (post.isUnderConstruction()) continue;
      this.pulseWithSleep(player, post.id(), post.tile(), this.discOffsets);
    }
  }

  // Пульс с «засыпанием» холостых источников (перф): взял 0 → спит до тика.
  private pulseWithSleep(
    player: Player,
    id: number,
    tile: TileRef,
    disc: Array<[number, number, number]>,
  ): void {
    const now = this.mg.ticks();
    const wakeAt = this.sleepUntil.get(id);
    if (wakeAt !== undefined && now < wakeAt) return;
    const taken = this.pulse(player, tile, disc);
    if (taken === 0) {
      this.sleepUntil.set(id, now + TERRON_FORT_IDLE_RECHECK_TICKS);
    } else {
      this.sleepUntil.delete(id);
    }
  }

  // Один «импульс» бункера: захват ближайших чужих тайлов в радиусе, примыкающих
  // к нашей территории. Вместо фикс-лимита — ЦЕЛОЧИСЛЕННЫЙ бюджет мощности
  // (TILES_PER_PULSE×100 центи): дешёвые ближние тайлы дают ~NEAR_PCT%, дорогие
  // дальние ~FAR_PCT% → вблизи берётся больше тайлов, у кромки меньше. Оффсеты
  // отсортированы ближними первыми, cost монотонно растёт → как только бюджета не
  // хватает на очередной тайл, дальше только дороже — выходим. Возвращает число взятых.
  private pulse(
    player: Player,
    center: TileRef,
    disc: Array<[number, number, number]>,
  ): number {
    const cx = this.mg.x(center);
    const cy = this.mg.y(center);
    let budget = TERRON_FORT_TILES_PER_PULSE * 100; // центи-мощность
    let taken = 0;
    for (const [dx, dy, cost] of disc) {
      if (budget < cost) break;
      const x = cx + dx;
      const y = cy + dy;
      if (!this.mg.isValidCoord(x, y)) continue;
      const t = this.mg.ref(x, y);
      if (!this.mg.isLand(t)) continue;

      const owner = this.mg.owner(t);
      if (owner === player) continue;
      if (owner.isPlayer()) {
        const p = owner as Player;
        if (!p.isAlive()) continue;
        if (player.isFriendly(p)) continue;
      }

      // terron (решение владельца — «убрать зависимость от воды»): захватываем тайл,
      // если он граничит с НАШЕЙ землёй ИЛИ с ВОДОЙ (прибрежный). Так фронт растёт по
      // суше И перепрыгивает воду на вражеские берега/островки в радиусе — вода больше
      // НЕ блокирует. Но вглубь чужой суши (тайл без воды и без нашей границы рядом)
      // «телепорт»-захвата нет — иначе бункер грёб бы весь диск радиуса.
      let capturable = false;
      for (const n of this.mg.neighbors(t)) {
        if (!this.mg.isLand(n) || this.mg.owner(n) === player) {
          capturable = true;
          break;
        }
      }
      if (!capturable) continue;

      // ТИХИЙ захват: прямой conquer, а НЕ AttackExecution. Боты агрятся на
      // incomingAttacks() (см. AiAttackBehavior) — их тут нет, поэтому бункер на
      // границе с игроком/ботом НЕ шлёт «вас атакуют» и не провоцирует ответку.
      player.conquer(t);
      // terron: снаряд-визуал «выстрела» бункера/штаба по взятому тайлу (клиент
      // рисует летящую точку center→t, как реальный Shell). Косметика — видят все.
      this.mg.addUpdate({
        type: GameUpdateType.FortShot,
        from: center,
        to: t,
      });
      budget -= cost;
      taken++;
    }
    // Метрика «территорий захвачено бункерами» (тултип слота ульты).
    player.addUltStat("fortTiles", taken);
    return taken;
  }
}

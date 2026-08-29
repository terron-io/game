// terron: ультимейты — Мин правды (Ministry of Truth). Здание-аура: раз в
// TERRON_MINISTRY_PERIOD_TICKS «высасывает» долю войск у каждого ВРАЖДЕБНОГО
// игрока, чья территория попадает в радиус (процентная механика — чем больше
// населения у жертвы, тем больше сосёт), и конвертирует часть владельцу.
// Детерминизм: целочисленные floor-объёмы, скан диска фиксированным порядком
// (строки сверху вниз), игроки обрабатываются по возрастанию smallID.
// Спека: new-units/ULTIMATES.md
// ⚠️ 06.08: САМО ЗДАНИЕ «Мин правды» БОЛЬШЕ НЕ СТРОИТСЯ — ульта влита в МЕДИА
// (проводка Мин правды закомментирована, этот код жив и работает от штаба МЕДИА
// с множителями TERRON_MEDIA_MINISTRY_*). Вернуть отдельное здание =
// раскомментировать проводку, см. TerronTuning §МИН ПРАВДЫ ВЛИТА В МЕДИА.
import {
  TERRON_MEDIA_MINISTRY_POWER_MULT,
  TERRON_MEDIA_MINISTRY_RADIUS_MULT,
  TERRON_MINISTRY_CONVERT_PCT,
  TERRON_MINISTRY_DRAIN_PCT,
  TERRON_MINISTRY_PERIOD_TICKS,
  TERRON_MINISTRY_RADIUS,
  TERRON_MINISTRY_SECOND_MULT,
} from "../configuration/TerronTuning";
import { Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { UltimateBuildingExecution } from "./UltimateBuildingExecution";

export class MinistryOfTruthExecution extends UltimateBuildingExecution {
  private checkOffset = 0;
  // Диск ауры (тайлы в радиусе) — считается один раз при init.
  private auraTiles: TileRef[] = [];
  // Множитель высасывания: 2-е министерство (построенное позже — есть более
  // старое с меньшим id) на 50% эффективнее. Фиксируется при init.
  private drainMult = 1;

  protected onInit(): void {
    const mg = this.mg;
    this.checkOffset = mg.ticks() % TERRON_MINISTRY_PERIOD_TICKS;

    // Аура на штабе МЕДИА (06.08) — ×POWER к высасыванию и ×RADIUS к радиусу.
    const isMedia = this.hq.type() === UnitType.Media;
    const powerMult = isMedia ? TERRON_MEDIA_MINISTRY_POWER_MULT : 1;
    const radiusMult = isMedia ? TERRON_MEDIA_MINISTRY_RADIUS_MULT : 1;

    // Есть более старый штаб того же типа (меньший id) → это ВТОРОЙ. У МЕДИА
    // копия одна (решение владельца) → ветка спящая, оставлена для возврата.
    const owner = this.hq.owner();
    const isSecond = owner
      .units(this.hq.type())
      .some((m) => m.id() < this.hq.id());
    this.drainMult = (isSecond ? TERRON_MINISTRY_SECOND_MULT : 1) * powerMult;

    const cx = mg.x(this.hq.tile());
    const cy = mg.y(this.hq.tile());
    const r = TERRON_MINISTRY_RADIUS * radiusMult;
    const r2 = r * r;
    // Радиус большой (база 300 = авиабаза, на МЕДИА 600) → полный диск сотни
    // тысяч тайлов. Сканим сеткой с шагом 2×radiusMult (~71к тайлов при ЛЮБОМ
    // радиусе — иначе вдвое больший радиус дал бы вчетверо больше тайлов и
    // проход по ним КАЖДУЮ СЕКУНДУ): жертва = игрок с территорией в ауре, а
    // территории — сплошные пятна, блоб мельче шага не потеряем осмысленно.
    const step = 2 * radiusMult;
    for (let dy = -r; dy <= r; dy += step) {
      const y = cy + dy;
      for (let dx = -r; dx <= r; dx += step) {
        const x = cx + dx;
        if (dx * dx + dy * dy > r2) continue;
        if (!mg.isValidCoord(x, y)) continue;
        const t = mg.ref(x, y);
        if (mg.isLand(t)) this.auraTiles.push(t);
      }
    }
  }

  protected run(owner: Player): void {
    if (this.mg.ticks() % TERRON_MINISTRY_PERIOD_TICKS !== this.checkOffset) {
      return;
    }

    // Кого сосём: враждебные игроки с территорией в ауре (по smallID — детерм.).
    const victimIds = new Set<number>();
    for (const t of this.auraTiles) {
      if (!this.mg.hasOwner(t)) continue;
      const o = this.mg.owner(t);
      if (!o.isPlayer()) continue;
      victimIds.add((o as Player).smallID());
    }
    if (victimIds.size === 0) return;

    const ids = [...victimIds].sort((a, b) => a - b);
    let stolen = 0;
    for (const id of ids) {
      const victim = this.mg.playerBySmallID(id);
      if (!victim.isPlayer()) continue;
      const v = victim as Player;
      if (v === owner || !v.isAlive()) continue;
      if (owner.isFriendly(v)) continue;
      const drain = Math.floor(
        v.troops() * TERRON_MINISTRY_DRAIN_PCT * this.drainMult,
      );
      if (drain <= 0) continue;
      stolen += v.removeTroops(drain);
    }
    if (stolen > 0) {
      // Два счётчика (решение владельца 07.07): сколько ПОТЕРЯЛИ враги (сырое)
      // и сколько РЕАЛЬНО пришло владельцу (после конвертации).
      const gained = Math.floor(stolen * TERRON_MINISTRY_CONVERT_PCT);
      if (gained > 0) owner.addTroops(gained);
      this.hq.addMinistryDrain(stolen, gained);
      owner.addUltStat("stolen", stolen);
      owner.addUltStat("stolenGained", gained);
    }
  }
}

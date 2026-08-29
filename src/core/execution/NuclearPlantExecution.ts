// terron: АЭС — «ЧЕРНОБЫЛЬ» (new-units/NUCLEAR.md). Исполнение живёт при штабе
// и следит ровно за одним: пока станция цела — ничего не делает; как только
// она ПОТЕРЯНА ЛЮБЫМ СПОСОБОМ (снёс враг, снёс сам владелец, захватили
// вместе с землёй), запускается отсчёт, и через минуту на месте станции
// гремит взрыв ВОДОРОДНОЙ мощности плюс радиоактивный след.
//
// Задержка — телеграф: занявшие площадку успевают уйти, если поняли, куда
// влезли. Ручной подрыв разрешён намеренно (решение владельца 23.08), но
// стоит владельцу всей ульты, а штаб дороже ракеты — «АЭС вместо бомбы»
// само себя балансирует.
//
// ⚠️ Кто считается виновником взрыва (важно для штрафа Зелёных): тот, кто
// ВЛАДЕЕТ ЗЕМЛЁЙ под станцией в момент детонации. Захватил площадку — твой
// взрыв; снёс с дистанции и не пришёл — отвечает хозяин земли. Точнее движок
// сказать не может: «кто именно снёс здание» нигде не хранится.
import {
  TERRON_CHERNOBYL_DELAY_TICKS,
} from "../configuration/TerronTuning";
import { Execution, Game, MessageType, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { detonateDroneBlast } from "./SuicideDroneExecution";

export class NuclearPlantExecution implements Execution {
  private active = true;
  private mg: Game;
  private readonly site: TileRef;
  private readonly builder: Player;
  /** Тик, когда станция была потеряна (−1 — ещё цела). */
  private lostAt = -1;

  constructor(private readonly hq: Unit) {
    this.site = hq.tile();
    this.builder = hq.owner();
  }

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.lostAt < 0) {
      // Станция цела и всё ещё у того, кто её строил — ждём.
      if (this.hq.isActive() && this.hq.owner() === this.builder) return;
      this.lostAt = ticks;
      return;
    }
    if (ticks - this.lostAt < TERRON_CHERNOBYL_DELAY_TICKS) return;
    this.meltdown();
  }

  private meltdown(): void {
    this.active = false;
    const mg = this.mg;
    // Здание, если оно ещё стоит (случай захвата), уходит вместе со взрывом.
    if (this.hq.isActive()) this.hq.delete(false);

    const ownerNow = mg.owner(this.site);
    const culprit = ownerNow.isPlayer() ? (ownerNow as Player) : this.builder;

    detonateDroneBlast(mg, this.site, culprit, UnitType.HydrogenBomb);

    // Радиоактивный след по внутреннему радиусу — как у настоящей ядерки.
    const magnitude = mg.config().nukeMagnitudes(UnitType.HydrogenBomb);
    const r = magnitude.inner;
    const inner2 = r * r;
    const cx = mg.x(this.site);
    const cy = mg.y(this.site);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > inner2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!mg.isValidCoord(x, y)) continue;
        const t = mg.ref(x, y);
        if (mg.isLand(t) && !mg.hasOwner(t)) {
          mg.setFallout(t, true, culprit.smallID(), culprit.smallID());
        }
      }
    }

    // Штраф Зелёных за детонацию — по общему правилу «платит тот, чьими руками
    // рвануло». Ракету никто не пускал, поэтому виновник берётся как выше.
    mg.reportNukeDetonation(culprit, this.site, UnitType.HydrogenBomb);

    mg.displayMessage(
      "events_display.chernobyl",
      MessageType.CHERNOBYL,
      null,
      undefined,
      { name: this.builder.displayName() },
      undefined,
      this.builder.id(),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  owner(): Player {
    return this.builder;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

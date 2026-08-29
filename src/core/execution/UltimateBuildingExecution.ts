// terron: ультимейты — общий каркас ПАССИВНОГО ульт-ЗДАНИЯ (штаб, чей эффект
// работает пока здание живо и достроено). Раньше каждый такой Execution
// (Религия / Укрепления / Мин правды) дословно повторял один и тот же
// lifecycle-гард в tick(). Теперь гард — здесь, а сам эффект — в run().
//
// Поведение гарда бит-в-бит как было (важно: детерминизм + реплеи):
//   • здание перестало быть активным (снесли/захват-делит) → active=false,
//     исполнение умирает;
//   • здание ещё строится → просто ждём (active остаётся true, перепроверяем);
//   • владелец мёртв → пропускаем тик (не убиваем исполнение — вдруг оживёт
//     реконнектом; как было в исходниках).
// Порядок гардов сохранён: isActive → underConstruction → owner.isAlive.
//
// onInit() — опциональный хук инициализации (предрасчёт дисков/ауры и т.п.),
// вызывается из init() как раньше. Спека: new-units/ULTIMATES.md
import { Execution, Game, Player, Unit } from "../game/Game";

export abstract class UltimateBuildingExecution implements Execution {
  protected active = true;
  protected mg: Game;

  constructor(protected readonly hq: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.onInit(ticks);
  }

  tick(ticks: number): void {
    if (!this.hq.isActive()) {
      this.active = false;
      return;
    }
    if (this.hq.isUnderConstruction()) return;
    const player = this.hq.owner();
    if (!player.isAlive()) return;
    this.run(player, ticks);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  /** Предрасчёт при init (диски/аура). По умолчанию — ничего. */
  protected onInit(_ticks: number): void {}

  /** Эффект здания: вызывается только когда здание живо, достроено, владелец жив. */
  protected abstract run(player: Player, ticks: number): void;
}

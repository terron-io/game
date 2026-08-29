// terron: ТОПЛИВО — каст «ИНДУСТРИАЛЬНАЯ РЕВОЛЮЦИЯ» (new-units/FUEL.md).
// Наводится на ЛЮБУЮ страну, включая СВОЮ: на 2 минуты цель получает ×3
// скорость всего, что едет своим ходом, и −50% прироста населения.
//
// ⚠️ Это первый каст в ростере с ДВОЙНЫМ СМЫСЛОМ, и в этом весь замысел:
//   • на СЕБЯ — окно рывка: перебросить десант через полкарты за минуту,
//     заплатив армией. Инструмент темпа, а не силы;
//   • на СОЮЗНИКА — настоящий подарок, о нём просят в чате;
//   • на ТОРГОВЦА — почти подарок, он и не расстроится;
//   • на ВОЮЮЩЕГО — удавка: логистика ему не нужна, а половины прироста нет.
// Отказаться нельзя: ты не «делаешь плохо», ты навязываешь индустриализацию.
import { Game, MessageType, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { TERRON_INDUSTRIAL_TICKS } from "../configuration/TerronTuning";
import { TimedBuffExecution } from "./TimedBuffExecution";

export class IndustrialRevolutionExecution extends TimedBuffExecution {
  constructor(player: Player, tile: TileRef) {
    super(player, tile);
  }

  protected markerType(): UnitType {
    return UnitType.IndustrialRevolution;
  }

  protected durationTicks(): number {
    return TERRON_INDUSTRIAL_TICKS;
  }

  protected applyTo(target: Player): boolean {
    if (
      this.caster.canBuild(UnitType.IndustrialRevolution, this.tile) === false
    ) {
      return false;
    }
    const cost = this.mg
      .unitInfo(UnitType.IndustrialRevolution)
      .cost(this.mg, this.caster);
    if (this.caster.gold() < cost) return false;
    this.caster.removeGold(cost);
    target.startIndustrialRevolution();

    // Лента всем: соседи цели должны понимать, что её логистика на две минуты
    // стала быстрее, а армия — меньше.
    this.mg.displayMessage(
      "events_display.industrial_revolution",
      MessageType.INDUSTRIAL_REVOLUTION,
      null,
      undefined,
      { name: target.displayName() },
      undefined,
      this.caster.id(),
    );
    return true;
  }
}

// Оставлено для типизации импортов (Game используется в базовом классе).
export type { Game };

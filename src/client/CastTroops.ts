// terron 24.08: ВОЙСКА В ИНТЕНТЕ КАСТА — ОДИН источник для всех путей.
//
// Находка владельца («указал 77%, а раскол маааленький»): Раскол/Передышка/
// Террор/Блокада берут долю войск со слайдера атаки, но поле troops считал
// ТОЛЬКО путь через гост (BuildPreviewController). Панель строительства и
// мобильное прицельное управление шлют интент через BuildMenu.sendBuildOrUpgrade
// — БЕЗ troops → сим получал 0 → флаг Раскола всегда минимальный, сколько бы
// слайдер ни показывал. Теперь troops считает этот модуль, и оба пути обязаны
// звать его.
import { TERRON_WALK_RATIO_MAX } from "../core/configuration/TerronTuning";
import { UnitType } from "../core/game/Game";
import { GameView } from "../core/game/GameView";
import { UIState } from "./UIState";
import { blockadeShipsToSend } from "./controllers/BlockadeUi";

/** Сколько войск вложить в интент каста; undefined = юниту войска не нужны. */
export function castTroopsFor(
  unitType: UnitType,
  game: GameView,
  uiState: UIState,
): number | undefined {
  if (
    unitType === UnitType.Split ||
    unitType === UnitType.Respite ||
    unitType === UnitType.Terror
  ) {
    const myTroops = game.myPlayer()?.troops() ?? 0;
    return Math.floor(myTroops * uiState.attackRatio);
  }
  // Блокада: troops = число лодок (доля слайдера от свободных пиратских).
  if (unitType === UnitType.Blockade) {
    return blockadeShipsToSend(game, uiState.attackRatio);
  }
  // Перенос Шагающего города: доля слайдера, КАП 30% (решение владельца:
  // «установил 100% — потратить только 30% и эффективность максимум»).
  if (unitType === UnitType.CityTransfer) {
    const myTroops = game.myPlayer()?.troops() ?? 0;
    return Math.floor(
      myTroops * Math.min(uiState.attackRatio, TERRON_WALK_RATIO_MAX),
    );
  }
  return undefined;
}

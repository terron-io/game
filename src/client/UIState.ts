import { PlayerBuildableUnitType } from "../core/game/Game";

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  rocketDirectionUp: boolean;
  /**
   * terron 24.08: что сейчас сделает клик по госту — стройку или АПГРЕЙД
   * (магнит к своему зданию). Пишет BuildPreviewController на каждом
   * пересчёте госта; читает превью гост-рельсов (при апгрейде новых рельсов
   * не будет — рисовать нечего). undefined = гостов нет/не посчитано.
   */
  ghostPlacement?: "build" | "upgrade" | "invalid";
  /** Фактический тайл, куда встанет постройка (учёт магнита-снапа). */
  ghostBuildTile?: number;
}

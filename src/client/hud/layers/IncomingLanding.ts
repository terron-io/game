// terron 19.08: «ко мне едут» — геометрия предупреждения о десанте.
//
// Репорт владельца: чужой флот шёл к нему, сам флот был виден, а плашки входящей
// атаки не было. Разбор показал две дыры в старой схеме (набор строился только
// из одноразового события при отправке лодки):
//   • бот целится в НИЧЕЙНЫЙ тайл впритык к твоей границе — событие вообще не
//     отправляется, потому что у тайла высадки нет владельца;
//   • переподключился после отправки — событие уже прошло, индикатора нет
//     никогда, хотя десант в пути.
//
// Поэтому решение принимается ПО СОСТОЯНИЮ и по расстоянию: высадка «у меня» —
// это либо мой тайл, либо любой мой тайл в радиусе TERRON_INCOMING_LANDING_RADIUS
// от точки высадки (решение владельца 19.08: 5 тайлов).
import { TERRON_INCOMING_LANDING_RADIUS } from "../../../core/configuration/TerronTuning";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../view/GameView";
import { PlayerView } from "../../view/PlayerView";

/** Минимум, который нужен от карты — чтобы тест не поднимал весь GameView. */
export type LandingMapView = Pick<
  GameView,
  "x" | "y" | "ref" | "isValidCoord" | "owner"
>;

/**
 * Высаживается ли десант «у меня»: точка высадки принадлежит мне ИЛИ рядом с ней
 * (в радиусе `radius`, по кругу) есть мой тайл.
 *
 * Круг, а не квадрат: по квадрату угловые тайлы дальше на 40%, и предупреждение
 * срабатывало бы на заметно большем расстоянии по диагонали, чем по прямой.
 */
export function landsNearPlayer(
  game: LandingMapView,
  dst: TileRef,
  me: PlayerView,
  radius: number = TERRON_INCOMING_LANDING_RADIUS,
): boolean {
  if (game.owner(dst) === me) return true;
  if (radius <= 0) return false;

  const cx = game.x(dst);
  const cy = game.y(dst);
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue; // сам тайл уже проверен выше
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!game.isValidCoord(x, y)) continue;
      if (game.owner(game.ref(x, y)) === me) return true;
    }
  }
  return false;
}

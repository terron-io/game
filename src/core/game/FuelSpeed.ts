// terron: ТОПЛИВО — единая точка расчёта «во сколько раз быстрее ездит этот
// игрок» (new-units/FUEL.md). Держим в одном месте, потому что множитель
// применяется в ПЯТИ разных местах (боевые корабли, десант, торговые лодки,
// самолёты, поезда), и разъехавшиеся копии дали бы юниты с разной скоростью
// у одного владельца.
//
// ⚠️ Дроны и ракеты сюда НЕ подключаются: решение владельца — ускоряется всё,
// что перемещается своим ходом, но не одноразовые боеприпасы.
import {
  TERRON_FUEL_SPEED_MULT,
  TERRON_INDUSTRIAL_SPEED_MULT,
} from "../configuration/TerronTuning";
import { Player, UnitType } from "./Game";

/**
 * Множитель скорости: 1 обычно, ×FUEL при живом штабе Топлива, ×INDUSTRIAL
 * пока на игроке висит «Индустриальная революция». Революция НЕ складывается
 * с пассивом — берётся большее, иначе владелец Топлива под своим же кастом
 * улетал бы в ×6.
 */
export function fuelSpeedMult(player: Player): number {
  const passive = player.hasUltimate(UnitType.Fuel) ? TERRON_FUEL_SPEED_MULT : 1;
  const cast = player.industrialActive() ? TERRON_INDUSTRIAL_SPEED_MULT : 1;
  return Math.max(passive, cast);
}

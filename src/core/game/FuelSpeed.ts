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
/**
 * Юниты, которых Топливо реально ускоряет — то есть те, чьи исполнители зовут
 * формулу выше. Список нужен интерфейсу (дев-подсказка «×N скорости» в ховере),
 * и живёт он ЗДЕСЬ, рядом с формулой, а не в HUD: в клиенте он уже отстал —
 * самолёта и десанта в нём не было, хотя в симе они ускоряются с 23.08.
 *
 * Сторож `tests/client/FuelSpeedView.test.ts` сверяет список с исполнителями
 * ядра: завёл ускорение новому юниту — тест потребует вписать его сюда.
 */
export const FUEL_AFFECTED_UNITS: readonly UnitType[] = [
  UnitType.Warship,
  UnitType.TradeShip,
  UnitType.TransportShip,
  UnitType.Train,
  UnitType.Airplane,
  UnitType.AirborneAssault,
];

export function fuelSpeedMult(player: Player): number {
  return fuelSpeedFrom(
    player.hasUltimate(UnitType.Fuel),
    player.industrialActive(),
  );
}

/**
 * ТА ЖЕ формула, но от голых фактов — для КЛИЕНТА.
 *
 * ⚠️ Заведено по разбору боевого хелса 27.08: дев-тултип скорости звал
 * `fuelSpeedMult(unit.owner() as unknown as Player)`, а на клиенте `owner()` —
 * это `PlayerView`, у которого метода `industrialActive()` нет и быть не может
 * (флаг живёт только в симуляции). Двойной каст глушил компилятор, и в проде
 * это вылезло 1081 ошибкой «e.industrialActive is not a function».
 *
 * Правило: у клиента НЕТ объекта `Player`, поэтому он и не должен его
 * изображать — пусть передаёт то, что знает сам. Формула при этом остаётся
 * ОДНА: разъехавшиеся копии дали бы юниты с разной скоростью в симе и в
 * подсказке, то есть подсказку, которой нельзя верить.
 */
export function fuelSpeedFrom(
  hasFuelUlt: boolean,
  industrialActive: boolean,
): number {
  const passive = hasFuelUlt ? TERRON_FUEL_SPEED_MULT : 1;
  const cast = industrialActive ? TERRON_INDUSTRIAL_SPEED_MULT : 1;
  return Math.max(passive, cast);
}

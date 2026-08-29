/**
 * terron: ЗАКРЫТАЯ СТРАНА (ульта, TZ-ult-unlocks.md) — видовой фильтр юнитов.
 *
 * Решение владельца 22.08: одних скрытых цифр мало, страна прячет и СОДЕРЖИМОЕ —
 * постройки и технику. Фильтр стоит на входе рендера (GPURenderer.updateUnits/
 * updateStructures), поэтому разом исчезает всё, что кормится из этих карт:
 * сами юниты, полоски здоровья, точечный свет, круги ПВО, уровни построек,
 * ж/д-станции. Правок в отдельных пассах не требуется.
 *
 * ⚠️ Скрытие ЧИСТО ВИДОВОЕ (как невидимость подлодок и туман войны): симуляция
 * честная, в hash не входит, десинков не даёт — читерский клиент юниты увидит.
 *
 * Живёт отдельным модулем (а не приватным методом рендерера) НАМЕРЕННО: правило
 * геймплейное, его сторожит tests/client/ClosedCountryHidesUnits.test.ts, а
 * тянуть в юнит-тест WebGL и GLSL-импорты Renderer.ts незачем.
 */
import {
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_WATER_NUKE,
} from "../types";

/** Минимум, который нужен фильтру от юнита (совместим с UnitState). */
export interface OwnedUnit {
  ownerID: number;
  unitType: string;
}

/**
 * ЛЕТЯЩИЕ БОЕПРИПАСЫ НЕ ПРЯЧЕМ. Ульта закрывает страну, а не отменяет
 * предупреждение об ударе: невидимая ядерка убирает у жертвы всякий контрплей
 * (ПВО-то сим перехватит, но игрок не увидит удара и не среагирует).
 * Захотим прятать и их — убрать тип из этого набора.
 */
export const ALWAYS_VISIBLE_UNITS: ReadonlySet<string> = new Set<string>([
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_WATER_NUKE,
  UT_SAM_MISSILE,
  UT_SHELL,
]);

/**
 * Отсеять юнитов закрытых стран.
 * @param hidden smallID игроков, чьи юниты нам не показывают (себя и союзников
 *   там нет — набор собирает GameView.statsHiddenFor).
 * @returns исходную карту, если прятать некого (ноль аллокаций в обычной игре,
 *   где ульту никто не построил), иначе новую отфильтрованную.
 */
export function filterHiddenUnits<T extends OwnedUnit>(
  units: Map<number, T>,
  hidden: ReadonlySet<number>,
  scratch?: Map<number, T>,
): Map<number, T> {
  if (hidden.size === 0) return units;
  const out = scratch ?? new Map<number, T>();
  out.clear();
  for (const [id, u] of units) {
    if (hidden.has(u.ownerID) && !ALWAYS_VISIBLE_UNITS.has(u.unitType))
      continue;
    out.set(id, u);
  }
  return out;
}

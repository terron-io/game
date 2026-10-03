import { assetUrl } from "../core/AssetUrls";
import {
  CAST_SLOT_REPLACEMENTS,
  CAST_UNLOCKED_BY,
  UltCastDef,
  UnitType,
} from "../core/game/Game";
import { unitIcon, unitNameI18nKey, unitSkinFor } from "./UnitCatalog";

/**
 * terron 25.08: ПОДМЕНА КНОПОК ПАНЕЛИ УЛЬТОЙ — единый ответ на вопрос «что на
 * самом деле стоит на этой кнопке у этого игрока».
 *
 * Повод — ТЕРРАФОРМИНГ: у него ТРИ каста, а слот ульты в интерфейсе ровно
 * один. Два лишних встают на кнопки обычных ядерок (сами ядерки владельцу
 * ульты запрещены гейтом в ядре), и знать об этом обязаны все три поверхности
 * ввода: панель, радиал и прицельное управление.
 *
 * ⚠️ Ровно этот класс ошибок уже стоил двух репортов: подмена корабля
 * подлодкой жила отдельной функцией, и Пиратство осталось с иконкой линкора.
 * Поэтому пары «слот → каст» объявлены в ULTIMATE_REGISTRY (`extraCasts`), а
 * здесь только чтение — руками сюда ничего не дописывают.
 *
 * ⚠️ Это ЧИСТО ИНТЕРФЕЙС. Право построить проверяет ядро (`canBuild`); если
 * подмена и гейт разойдутся, кнопка просто окажется серой, а не «выстрелит не
 * тем».
 */
export function castForSlot(
  slot: UnitType,
  hasUltimate: (t: UnitType) => boolean,
): UltCastDef | null {
  for (const r of CAST_SLOT_REPLACEMENTS) {
    if (r.slot !== slot) continue;
    if (!hasUltimate(r.building)) continue;
    return r.cast;
  }
  return null;
}

/** Тип, который на самом деле строит эта кнопка (сам слот, если подмены нет). */
export function slotUnitType(
  slot: UnitType,
  hasUltimate: (t: UnitType) => boolean,
): UnitType {
  return castForSlot(slot, hasUltimate)?.type ?? slot;
}

/**
 * terron 01.09 — ЕДИНЫЙ ОТВЕТ НА «ЧТО ЭТА КНОПКА ПОКАЗЫВАЕТ И ЧТО СТРОИТ».
 *
 * ⚠️ `nameKey` — ВСЕГДА ПОЛНЫЙ ключ словаря (`unit_type.<…>`). Реестр хранит
 * короткие (`cast.key`, `replaces.key`), а каталог отдаёт полные, и первая
 * версия этой функции возвращала то одно, то другое: у подменённой кнопки
 * `translateText` получал «piracy_boat» вместо «unit_type.piracy_boat» и
 * печатал сырой ключ. Приводим здесь, один раз.
 *
 * Подмен у ульт ДВЕ, и они разные:
 *   • `extraCasts` — ульта занимает ЧУЖОЙ СЛОТ своим кастом (Терраформинг
 *     ставит две ракеты на кнопки обычных ядерок): меняется и картинка, и тип;
 *   • `replaces`   — ульта подменяет САМ ЮНИТ (Пиратство → пиратская лодка,
 *     Подводный флот → подлодка): тип тот же (`Warship`), меняются только
 *     картинка и название.
 *
 * ⚠️ Держать их врозь уже стоило репорта: подмена корабля жила отдельной
 * функцией (`warshipIconFor`), и Пиратство осталось с иконкой линкора. Пока
 * они врозь, любая кнопка обязана помнить про ОБЕ — а помнят не все: собирая
 * панель по единой разметке, я сам чуть не потерял подмену корабля.
 */
export function buttonFor(
  slot: UnitType,
  hasUltimate: (t: UnitType) => boolean,
): { icon: string; nameKey: string; type: UnitType } {
  // 1) чужой слот занят кастом ульты — меняется и тип, и вид;
  const cast = castForSlot(slot, hasUltimate);
  if (cast !== null)
    return {
      icon: assetUrl(`images/${cast.icon}`),
      nameKey: `unit_type.${cast.key}`,
      type: cast.type,
    };
  // 2) юнит подменён ультой — тип прежний, вид другой;
  const skin = unitSkinFor(slot, hasUltimate);
  if (skin !== null)
    return { icon: skin.icon, nameKey: `unit_type.${skin.key}`, type: slot };
  // 3) подмены нет — кнопка остаётся собой.
  return {
    icon: unitIcon(slot) ?? "",
    nameKey: unitNameI18nKey(slot) ?? String(slot),
    type: slot,
  };
}

/**
 * ЧТО СЕЙЧАС СТОИТ В СЛОТЕ УЛЬТЫ (той самой «звезде»).
 *
 * Пока выбор не зафиксирован ядром — `null` (в слоте звезда, кнопка открывает
 * чузер). После фиксации: сам штаб, пока он строится, и его КАСТ, как только
 * достроен (МЕДИА → Раскол, Ядерный завод → МИРВ, Гидроузел → Затопление).
 *
 * ⚠️ terron 01.09 — ВЫНЕСЕНО ИЗ `UnitDisplay` РАДИ ХОТКЕЯ. Слот подписан
 * клавишей `buildMIRV` (исторически он и был слотом МИРВ), а обработчик хоткея
 * переводил её в `UnitType.MIRV` — то есть у ВСЕХ ульт, кроме Ядерного завода,
 * подписанная на кнопке клавиша не делала ничего: МИРВ владельцу другой ульты
 * запрещён гейтом ядра. Панель считала «что в слоте» своим кодом, хоткей — своим.
 */
export function ultSlotUnitType(
  fixed: UnitType | null,
  hqBuilt: (t: UnitType) => boolean,
): UnitType | null {
  if (fixed === null) return null;
  for (const [cast, unlock] of Object.entries(CAST_UNLOCKED_BY)) {
    if (unlock?.building !== fixed) continue;
    return hqBuilt(fixed) ? (cast as UnitType) : fixed;
  }
  return fixed;
}

/**
 * Подменён ли этот слот у игрока — радиалу нужно ПРЯТАТЬ подменённый пункт
 * (иначе рядом с тремя ракетами ульты висят две серые обычные ядерки).
 */
export function slotIsReplaced(
  slot: UnitType,
  hasUltimate: (t: UnitType) => boolean,
): boolean {
  return castForSlot(slot, hasUltimate) !== null;
}

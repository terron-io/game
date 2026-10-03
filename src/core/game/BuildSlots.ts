/**
 * terron 01.09 — ЕДИНАЯ РАЗМЕТКА КНОПОК СТРОИТЕЛЬСТВА.
 *
 * Одна кнопка панели — это ПЯТЬ связанных вещей: что она строит, какой
 * клавишей, какая клавиша по умолчанию, какая у неё строка в настройках
 * управления и какой счётчик она показывает. Всё это лежало в ЧЕТЫРЁХ файлах
 * и велось руками:
 *
 *   • `UserSettings.defaultKeybinds`  — действие → клавиша по умолчанию;
 *   • `UserSettingModal`              — действие → строка настроек;
 *   • `UnitDisplay`                   — кнопка → действие + иконка + счётчик;
 *   • `InputHandler.resolveBuildKeybind` — действие → тип юнита.
 *
 * ⚠️ ЧЕМ ЭТО КОНЧАЛОСЬ: списки расходились МОЛЧА. Клавиша слота ульты
 * (`buildMIRV`) переводилась в `UnitType.MIRV`, доступный только владельцу
 * Ядерного завода, — то есть у 28 ульт из 29 подписанная прямо на кнопке
 * клавиша не делала ничего, и заметили это спустя месяцы. Ровно так же
 * клавиша ядерки у Терраформинга целилась в запрещённый юнит (репорт 01.09).
 *
 * Здесь ОДИН список. Иконку, название и описание кнопка берёт из
 * `client/UnitCatalog` по типу; подмену слота ультой — из `client/UltSlots`;
 * счётчик — `player.totalUnitLevels(type)`. Новая кнопка = ОДНА строка тут
 * плюс пара ключей в словаре, и она сразу появляется в панели, слушает
 * клавишу, настраивается в управлении и попадает в дефолты.
 *
 * Живёт в ядре, а не в клиенте, потому что дефолты клавиш — это
 * `core/game/UserSettings`, и второй импорт «клиент → ядро» тут был бы циклом.
 */
import { UnitType } from "./Game";

export interface BuildSlotDef {
  /** Что стоит на кнопке. Подмену ультой добавляет client/UltSlots поверх. */
  type: UnitType;
  /** Имя действия в настройках управления (оно же ключ в keybinds). */
  keybind: string;
  /** Клавиша по умолчанию; "Null" — без клавиши, назначается вручную. */
  defaultKey: string;
  /** Префикс i18n-ключей строки в настройках (`user_setting.<i18n>`). */
  i18n: string;
}

/**
 * КНОПКИ ПАНЕЛИ, в порядке слева направо.
 *
 * Порядок — решение владельца 05.07: город 1, завод 2, порт 3, щит 4,
 * аэропорт 5, шахта 6, ПВО 7, корабль 8, атом 9, водородка 0.
 */
export const BUILD_SLOTS: readonly BuildSlotDef[] = [
  {
    type: UnitType.City,
    keybind: "buildCity",
    defaultKey: "Digit1",
    i18n: "build_city",
  },
  {
    type: UnitType.Factory,
    keybind: "buildFactory",
    defaultKey: "Digit2",
    i18n: "build_factory",
  },
  {
    type: UnitType.Port,
    keybind: "buildPort",
    defaultKey: "Digit3",
    i18n: "build_port",
  },
  {
    type: UnitType.DefensePost,
    keybind: "buildDefensePost",
    defaultKey: "Digit4",
    i18n: "build_defense_post",
  },
  {
    type: UnitType.Airport,
    keybind: "buildAirport",
    defaultKey: "Digit5",
    i18n: "build_airport",
  },
  {
    type: UnitType.MissileSilo,
    keybind: "buildMissileSilo",
    defaultKey: "Digit6",
    i18n: "build_missile_silo",
  },
  {
    type: UnitType.SAMLauncher,
    keybind: "buildSamLauncher",
    defaultKey: "Digit7",
    i18n: "build_sam_launcher",
  },
  {
    type: UnitType.Warship,
    keybind: "buildWarship",
    defaultKey: "Digit8",
    i18n: "build_warship",
  },
  {
    type: UnitType.AtomBomb,
    keybind: "buildAtomBomb",
    defaultKey: "Digit9",
    i18n: "build_atom_bomb",
  },
  {
    type: UnitType.HydrogenBomb,
    keybind: "buildHydrogenBomb",
    defaultKey: "Digit0",
    i18n: "build_hydrogen_bomb",
  },
];

/**
 * КЛАВИШИ БЕЗ СВОЕЙ КНОПКИ В ПАНЕЛИ.
 *
 * ⚠️ `buildMIRV` — это клавиша СЛОТА УЛЬТЫ («звезды»), а не МИРВ. Имя
 * историческое: слот когда-то и был слотом МИРВ. Тип здесь — лишь запасной
 * ответ на случай, когда ульты выключены в лобби и в слоте действительно
 * стоит МИРВ; что там на самом деле, решает `UltSlots.ultSlotUnitType`.
 *
 * ⚠️ `buildOilRig` — вышка переехала в группу ульт (её выбирают вместо другой
 * ульты), поэтому кнопки в панели у неё нет, а клавиша осталась: цифр к тому
 * моменту не было свободных, поэтому по умолчанию она не назначена.
 */
export const EXTRA_BUILD_KEYS: readonly BuildSlotDef[] = [
  {
    type: UnitType.MIRV,
    keybind: "buildMIRV",
    defaultKey: "Null",
    i18n: "build_mirv",
  },
  {
    type: UnitType.OilRig,
    keybind: "buildOilRig",
    defaultKey: "Null",
    i18n: "build_oil_rig",
  },
];

/** Всё, что слушает клавиатура. */
export const ALL_BUILD_KEYS: readonly BuildSlotDef[] = [
  ...BUILD_SLOTS,
  ...EXTRA_BUILD_KEYS,
];

/** Клавиша слота ульты («звезды»). */
export const ULT_SLOT_KEYBIND = "buildMIRV";

/** Запись слота ульты — нужна панели, чтобы взять его дефолтную клавишу. */
export const ULT_SLOT_DEF: BuildSlotDef =
  EXTRA_BUILD_KEYS.find((s) => s.keybind === ULT_SLOT_KEYBIND) ??
  EXTRA_BUILD_KEYS[0];

/**
 * Подпись клавиши на кнопке, когда игрок ничего не переназначал.
 *
 * ⚠️ `parsedUserKeybinds()` возвращает ПУСТОЙ объект у всех, кто не лазил в
 * настройки, — поэтому фолбэк обязателен, иначе цифры пропадают с панели у
 * большинства игроков (репорт владельца 01.09). Код клавиши тут в формате
 * KeyboardEvent.code («Digit1»), а игроку показываем то, что нарисовано на
 * клавише; «Null» значит «клавиша не назначена» — тогда подписи нет.
 */
export function defaultHotkeyLabel(slot: BuildSlotDef): string {
  const c = slot.defaultKey;
  if (c === "Null" || c === "") return "";
  const digit = /^Digit(\d)$/.exec(c);
  if (digit !== null) return digit[1];
  const letter = /^Key([A-Z])$/.exec(c);
  if (letter !== null) return letter[1];
  return c;
}

/** Дефолты клавиш стройки — для `UserSettings.defaultKeybinds`. */
export const BUILD_KEYBIND_DEFAULTS: Record<string, string> =
  Object.fromEntries(ALL_BUILD_KEYS.map((s) => [s.keybind, s.defaultKey]));

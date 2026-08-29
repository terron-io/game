import { ULTIMATE_REGISTRY } from "../../../core/game/Game";

/**
 * Canonical unit type string constants.
 *
 * These match the strings the upstream game sends in UnitEventUpdate.unitType.
 * Use these instead of raw string literals to prevent typos and enable
 * find-all-references.
 */

// ---------------------------------------------------------------------------
// Individual unit type constants
// ---------------------------------------------------------------------------

// Mobile units
export const UT_TRANSPORT = "Transport" as const;
export const UT_TRADE_SHIP = "Trade Ship" as const;
export const UT_WARSHIP = "Warship" as const;
export const UT_ATOM_BOMB = "Atom Bomb" as const;
export const UT_HYDROGEN_BOMB = "Hydrogen Bomb" as const;
export const UT_MIRV = "MIRV" as const;
export const UT_SAM_MISSILE = "SAMMissile" as const;
export const UT_SHELL = "Shell" as const;
export const UT_MIRV_WARHEAD = "MIRV Warhead" as const;
export const UT_TRAIN = "Train" as const;

// Structures
export const UT_CITY = "City" as const;
export const UT_PORT = "Port" as const;
export const UT_FACTORY = "Factory" as const;
export const UT_DEFENSE_POST = "Defense Post" as const;
export const UT_SAM_LAUNCHER = "SAM Launcher" as const;
export const UT_MISSILE_SILO = "Missile Silo" as const;
export const UT_AIRPORT = "Airport" as const; // terron: авиация
export const UT_AIRPLANE = "Airplane" as const; // terron: авиация — торговый самолёт
export const UT_AIRBORNE_ASSAULT = "Airborne Assault" as const; // terron: авиация — десант
export const UT_SUICIDE_DRONE = "Suicide Drone" as const; // terron: авиация — дрон-камикадзе
export const UT_MINISTRY = "Ministry of Truth" as const; // terron: ультимейты — Мин правды
export const UT_FORTIFICATIONS = "Fortifications" as const; // terron: ультимейты
export const UT_CENTRAL_BANK = "Central Bank" as const; // terron: ультимейты
export const UT_AIR_COMMAND = "Air Command" as const; // terron: ультимейты
export const UT_TANK_FACTORY = "Tank Factory" as const; // terron: ультимейты
export const UT_RELIGION = "Religion" as const; // terron: ультимейты — храм
export const UT_MINING = "Mining" as const; // terron: ультимейты — минирование
export const UT_REVANCHISM = "Revanchism" as const; // terron: ультимейты — статуя-монумент
export const UT_OUR_SKY = "Our Sky" as const; // terron: ультимейты — антиспутник «Небо наше»
export const UT_SATELLITE_STRIKE = "Satellite Strike" as const; // terron: ракета-каст Неба (носитель, реворк 21.08)
export const UT_CLOSED_COUNTRY = "Closed Country" as const; // terron: ультимейты — закрытая страна (ЗАКРЫТАЯ ульта)
export const UT_PIRACY = "Piracy" as const; // terron: ультимейты — пиратство (ЗАКРЫТАЯ ульта)
export const UT_PRIDE = "Pride" as const; // terron: ультимейты — гордость (ЗАКРЫТАЯ ульта)
export const UT_OLYMPICS = "Olympics" as const; // terron: ультимейты — стадион (ЗАКРЫТАЯ ульта)
export const UT_FANATICISM = "Fanaticism" as const; // terron: ультимейты — фанатизм (ЗАКРЫТАЯ ульта)
export const UT_VICTORY_BANNER = "Victory Banner" as const; // terron: ультимейты — знамя победы (ЗАКРЫТАЯ ульта)
export const UT_PEACE_PALACE = "Peace Palace" as const; // terron: ультимейты — дворец наций (ЗАКРЫТАЯ ульта)
export const UT_GREENS = "Greens" as const; // terron: ультимейты — зелёные (ЗАКРЫТАЯ ульта)
export const UT_GREEN_INSPECTION = "Green Inspection" as const; // terron: борт-инспекция Зелёных
export const UT_CATASTROPHE = "Catastrophe" as const; // terron: каст Зелёных
export const UT_NUCLEAR_PLANT = "Nuclear Plant" as const; // terron: ультимейты — АЭС (ЗАКРЫТАЯ ульта)
export const UT_RECULTIVATION = "Recultivation" as const; // terron: каст АЭС
export const UT_FUEL = "Fuel" as const; // terron: ультимейты — топливо (ЗАКРЫТАЯ ульта)
export const UT_INDUSTRIAL_REVOLUTION = "Industrial Revolution" as const; // terron: каст Топлива
export const UT_RAIL_GUN = "Rail Gun" as const; // terron: ультимейты — Дора (ЗАКРЫТАЯ ульта)
export const UT_RAIL_GUN_SHELL = "Rail Gun Shell" as const; // terron: каст Доры
export const UT_TRAIN_DEPOT = "Train Depot" as const; // terron: взрывные поезда — депо
export const UT_DOOM_TRAIN = "Doom Train" as const; // terron: каст — состав смерти
export const UT_SECRET_TREASURE = "Secret Treasure" as const; // terron: СЕКРЕТНЫЙ круг (код 1337)
export const UT_SPACEPORT = "Spaceport" as const; // terron: ультимейты — космодром (ЗАКРЫТАЯ ульта)
export const UT_PEACEFUL_SKY = "Peaceful Sky" as const; // terron: ультимейты — мирное небо (ЗАКРЫТАЯ ульта)
export const UT_WALKING_CITY = "Walking City" as const; // terron: ультимейты — шагающий город (перенос зданий)

// terron: «Небо наше» (реворк 21.08) — штаб сам ПВО, радиус ×5 от базового.
// ⚠️ ДУБЛЬ симовой константы TERRON_OURSKY_SAM_RADIUS_MULT (TerronTuning.ts) —
// менять СИНХРОННО (круги радиуса/траектории считает клиент по этой копии).
export const OURSKY_SAM_RADIUS_MULT = 5;
export const UT_MEDIA = "Media" as const; // terron: ультимейты — МЕДИА (штаб, каст Раскола)
export const UT_NUCLEAR_FACTORY = "NuclearFactory" as const; // terron: ультимейты — Ядерный завод (штаб → разблок МИРВ)
export const UT_RIVERS_BACK = "Rivers Back" as const; // terron: ультимейты — «Реки вспять» (штаб → каст водяной ракеты)
export const UT_WATER_NUKE = "Water Nuke" as const;
export const UT_OIL_RIG = "Oil Rig" as const; // terron: нефтяная вышка (строится в океане)
export const UT_SUBMARINE_BASE = "Submarine Base" as const; // terron: ультимейты — подводный флот // terron: ультимейты — водяная ракета (топит землю)

// ---------------------------------------------------------------------------
// Derived sets
// ---------------------------------------------------------------------------

/**
 * terron 23.08: ульт-здания добавляются из ULTIMATE_REGISTRY автоматически —
 * по той же причине, что и в ALL_UNIT_TYPES выше.
 */
export const STRUCTURE_TYPES: ReadonlySet<string> = new Set<string>([
  UT_CITY,
  UT_PORT,
  UT_FACTORY,
  UT_DEFENSE_POST,
  UT_SAM_LAUNCHER,
  UT_MISSILE_SILO,
  UT_AIRPORT, // terron: авиация
  UT_MINISTRY, // terron: ультимейты — здания-штабы
  UT_FORTIFICATIONS,
  UT_CENTRAL_BANK,
  UT_AIR_COMMAND,
  UT_TANK_FACTORY,
  UT_RELIGION, // terron: ультимейты — храм
  UT_MINING, // terron: ультимейты — минирование
  UT_REVANCHISM, // terron: ультимейты — статуя-монумент
  UT_OUR_SKY, // terron: ультимейты — антиспутник
  UT_SATELLITE_STRIKE, // terron: ракета-каст Неба (рендерится как структура, колонка Неба)
  UT_CLOSED_COUNTRY, // terron: ультимейты — закрытая страна (штаб)
  UT_PIRACY, // terron: ультимейты — пиратство (штаб)
  UT_PRIDE, // terron: ультимейты — гордость (штаб)
  UT_OLYMPICS, // terron: ультимейты — стадион (штаб)
  UT_FANATICISM, // terron: ультимейты — фанатизм (штаб)
  UT_VICTORY_BANNER, // terron: ультимейты — знамя победы (штаб)
  UT_PEACE_PALACE, // terron: ультимейты — дворец наций (штаб)
  UT_GREENS, // terron: ультимейты — зелёные (штаб)
  UT_NUCLEAR_PLANT, // terron: ультимейты — АЭС (штаб)
  UT_FUEL, // terron: ультимейты — топливо (штаб)
  UT_RAIL_GUN, // terron: ультимейты — Дора (едущее здание)
  UT_SPACEPORT, // terron: ультимейты — космодром
  UT_SECRET_TREASURE, // terron: СЕКРЕТНЫЙ круг «клад»
  UT_PEACEFUL_SKY, // terron: ультимейты — мирное небо
  UT_MEDIA, // terron: ультимейты — МЕДИА (штаб)
  UT_NUCLEAR_FACTORY, // terron: ультимейты — Ядерный завод (штаб)
  UT_RIVERS_BACK, // terron: ультимейты — «Реки вспять» (штаб)
  UT_OIL_RIG, // terron: нефтяная вышка (структура в океане)
  UT_SUBMARINE_BASE, // terron: ультимейты — подводный флот (штаб)
  ...ULTIMATE_REGISTRY.map((u) => u.type as string),
]);

export const NUKE_TYPES: ReadonlySet<string> = new Set([
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_WATER_NUKE, // terron: ультимейты — «Реки вспять»
]);

/** Blast radii (in tiles) matching upstream DefaultConfig.nukeMagnitudes(). */
export const NUKE_MAGNITUDES: Readonly<
  Record<string, { inner: number; outer: number }>
> = {
  [UT_ATOM_BOMB]: { inner: 12, outer: 30 },
  [UT_HYDROGEN_BOMB]: { inner: 80, outer: 100 },
  [UT_MIRV_WARHEAD]: { inner: 12, outer: 18 },
  // terron: ультимейты — «Реки вспять» (TERRON_RIVERS_NUKE_INNER/OUTER).
  [UT_WATER_NUKE]: { inner: 8, outer: 14 },
};

// ---------------------------------------------------------------------------
// Ordered lists (atlas column order — used by GPU passes + header)
// ---------------------------------------------------------------------------

/** All unit type strings in the canonical order used by RendererConfig.unitTypes. */
/**
 * terron 23.08: СПИСОК ТИПОВ ДЛЯ РЕНДЕРА.
 *
 * ⚠️ Ульты и их касты БОЛЬШЕ НЕ ПЕРЕЧИСЛЯЮТСЯ РУКАМИ — они приезжают из
 * ULTIMATE_REGISTRY (ядро). Раньше это был ручной список, и 23.08 шесть ульт
 * в него не попали: эффект работал, а спрайта на карте не было вовсе — ни
 * госта при постройке, ни здания. Теперь добавить ульту и забыть про рендер
 * НЕЛЬЗЯ: нет записи в реестре — нет ульты, есть запись — тип здесь сам.
 */
const BASE_UNIT_TYPES = [
  UT_TRANSPORT,
  UT_TRADE_SHIP,
  UT_WARSHIP,
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_MIRV_WARHEAD,
  UT_CITY,
  UT_PORT,
  UT_FACTORY,
  UT_DEFENSE_POST,
  UT_SAM_LAUNCHER,
  UT_MISSILE_SILO,
  UT_AIRPORT, // terron: авиация
  UT_TRAIN,
  UT_MINISTRY, // terron: ультимейты — в КОНЦЕ (стабильность индексов атласов)
  UT_FORTIFICATIONS,
  UT_CENTRAL_BANK,
  UT_AIR_COMMAND,
  UT_TANK_FACTORY,
  UT_RELIGION, // terron: ультимейты — храм (иначе рендер скипает спрайт: нет иконки!)
  UT_MINING, // terron: ультимейты — минирование
  UT_REVANCHISM, // terron: ультимейты — статуя (колонка 14 в icon-atlas)
  UT_OUR_SKY, // terron: ультимейты — спутник (колонка 15 в icon-atlas)
  UT_MEDIA, // terron: ультимейты — рупор МЕДИА (колонка 16 в icon-atlas)
  UT_NUCLEAR_FACTORY, // terron: ультимейты — Ядерный завод (колонка 17 в icon-atlas)
  UT_RIVERS_BACK, // terron: ультимейты — «Реки вспять» (колонка 18 в icon-atlas)
  UT_WATER_NUKE, // terron: ультимейты — водяная ракета (спрайт делит с атомной)
  UT_OIL_RIG, // terron: нефтяная вышка (колонка 19 в icon-atlas)
  UT_SUBMARINE_BASE, // terron: ультимейты — подводный флот (колонка 20)
  UT_SATELLITE_STRIKE, // terron: ракета Неба (колонку атласа делит с «Our Sky», алиас в StructurePass)
  UT_CLOSED_COUNTRY, // terron: закрытая страна (колонку атласа делит с Мин правды — та больше не строится)
  UT_PIRACY, // terron: пиратство (колонку атласа делит с Подводным флотом)
  UT_PRIDE, // terron: гордость (колонку атласа делит с Реваншизмом-статуей)
  UT_OLYMPICS, // terron: стадион (колонку атласа делит с Центробанком)
  UT_FANATICISM, // terron: фанатизм (колонку атласа делит с храмом Религии)
  UT_VICTORY_BANNER, // terron: знамя победы (колонку атласа делит с башней Укреплений)
  UT_PEACE_PALACE, // terron: дворец наций (колонку атласа делит с Центробанком)
  // (ни гост при постройке, ни само здание на карте). Ровно та грабля, о
  // которой предупреждает new-units/ULTIMATES.md: «Пропуск ALL_UNIT_TYPES =
  // эффект/тултип есть, спрайта нет». Список = header.unitTypes, который
  // воркер шлёт рендеру; тип не в нём → StructurePass его пропускает.
  UT_GREENS, // terron: зелёные (колонку атласа делит с плотиной «Рек вспять»)
  UT_NUCLEAR_PLANT, // terron: АЭС (колонку делит с Ядерным заводом)
  UT_FUEL, // terron: топливо (колонку делит с нефтяной вышкой)
  UT_RAIL_GUN, // terron: Дора — СВОЯ колонка 21 (ствол на ж/д платформе)
  UT_SPACEPORT, // terron: космодром (колонку делит с нефтяной вышкой)
  UT_PEACEFUL_SKY, // terron: мирное небо (колонку делит со спутником Неба)
] as const;

const ULT_RENDER_TYPES: readonly string[] = [
  ...ULTIMATE_REGISTRY.map((u) => u.type as string),
  ...ULTIMATE_REGISTRY.filter((u) => u.cast !== undefined).map(
    (u) => u.cast!.type as string,
  ),
];

export const ALL_UNIT_TYPES: readonly string[] = [
  ...BASE_UNIT_TYPES,
  ...ULT_RENDER_TYPES.filter(
    (t) => !(BASE_UNIT_TYPES as readonly string[]).includes(t),
  ),
];

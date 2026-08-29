import { assetUrl } from "../core/AssetUrls";
import {
  TERRON_MEDIA_MINISTRY_RADIUS_MULT,
  TERRON_MINISTRY_RADIUS,
  TERRON_RAILGUN_RANGE,
} from "../core/configuration/TerronTuning";
import { ULTIMATE_REGISTRY, UnitType } from "../core/game/Game";

/**
 * ЕДИНЫЙ реестр строений и ультимейтов — иконки + i18n + ВСЁ отображение ульты
 * (стат-строки тултипов, радиус круга по ховеру). Всё, что рисует иконку,
 * счётчики или круг ульты (BuildMenu-бар, радиал, ховер структуры, BalancePage,
 * гайды…), тянет ЗДЕСЬ — не хардкодит по месту.
 *
 * ➕ НОВАЯ УЛЬТА / изменение — правь ТОЛЬКО эту запись, и всё отображение
 * подхватится системно:
 *   • иконка/ключ — `icon`/`key`;
 *   • лимит копий — ядро `ULT_MAX_COUNT` (Game.ts), апгрейд — `maxLevel` (Config);
 *     клиентский слот (`UnitDisplay.ultBuilt`) уже читает ULT_MAX_COUNT;
 *   • счётчики в тултипах (бар/радиал/ховер) — `statLines` тут;
 *   • круг радиуса по ховеру — `hoverRadiusTiles` тут (нет поля = круга нет).
 *
 * Ключ записи = значение enum `UnitType` (оно же строка, которую пишет БД — напр.
 * "Ministry of Truth"), поэтому lookup работает и по UnitType, и по сырой строке
 * из архива матча.
 */

/** Снимок ульт-счётчиков (форма PlayerView.ultStats(); для ховера Мин.правды —
 *  поля stolen/stolenGained подменяются per-unit значениями). */
export interface UltStatSnapshot {
  stolen: number;
  stolenGained: number;
  mirvLaunches: number;
  mirvTiles: number;
  fortTiles: number;
  splitTiles: number;
  religionTiles: number;
  religionTithe: number;
  waterTiles: number;
}

/** Одна строка-счётчик тултипа: i18n-ключ + как достать число из снимка. */
export interface UltStatLineSpec {
  i18nKey: string;
  pick: (s: UltStatSnapshot) => number;
}

export interface UnitMeta {
  type: UnitType;
  /** Asset URL иконки. Белые SVG (…White.svg) тинтуются в месте вывода. */
  icon: string;
  /** i18n-ключ (ultimates.<key>.name и т.п.). */
  key: string;
  /** true = ультимейт (штаб/атака), false = обычное строение. */
  ultimate: boolean;
  /** Ульт-счётчики для тултипов (бар/радиал/ховер). Пусто = без счётчиков. */
  statLines?: UltStatLineSpec[];
  /** Радиус круга действия по ховеру структуры (тайлы). Нет поля = круга нет
   *  (напр. Религия — эффект по всей территории; Форты — уже зелёное покрытие). */
  hoverRadiusTiles?: number;
}

const A = (file: string): string => assetUrl(`images/${file}`);

/**
 * terron 23.08: КЛИЕНТСКИЕ ДОБАВКИ К УЛЬТАМ — то, чего в ядре нет и быть не
 * должно: счётчики тултипов и круг радиуса по ховеру. Иконка, ключ и сам
 * факт «это ульта» приезжают из ULTIMATE_REGISTRY, дублировать их здесь
 * больше нельзя.
 */
const ULT_EXTRAS: Partial<
  Record<UnitType, Pick<UnitMeta, "statLines" | "hoverRadiusTiles">>
> = {
  [UnitType.MIRV]: {
    statLines: [
      { i18nKey: "ultimate.stat_mirv_launches", pick: (s) => s.mirvLaunches },
      { i18nKey: "ultimate.stat_mirv_tiles", pick: (s) => s.mirvTiles },
    ],
  },
  [UnitType.Fortifications]: {
    statLines: [
      { i18nKey: "ultimate.stat_fort_tiles", pick: (s) => s.fortTiles },
    ],
  },
  [UnitType.Split]: {
    statLines: [
      { i18nKey: "ultimate.stat_split_tiles", pick: (s) => s.splitTiles },
    ],
  },
  [UnitType.Religion]: {
    statLines: [
      { i18nKey: "ultimate.stat_religion_tiles", pick: (s) => s.religionTiles },
      { i18nKey: "ultimate.stat_religion_tithe", pick: (s) => s.religionTithe },
    ],
  },
  [UnitType.RailGun]: {
    hoverRadiusTiles: TERRON_RAILGUN_RANGE,
  },
  [UnitType.Media]: {
    statLines: [
      { i18nKey: "ultimate.stat_enemy_lost", pick: (s) => s.stolen },
      { i18nKey: "ultimate.stat_gained", pick: (s) => s.stolenGained },
    ],
    // ⚠️ У МЕДИА радиус ауры ВДВОЕ больше базового (влитая сюда Мин правды).
    // При переводе каталога на реестр 23.08 множитель едва не потерялся —
    // поймал тест MinistryDouble. Держать синхронно с ядром.
    hoverRadiusTiles:
      TERRON_MINISTRY_RADIUS * TERRON_MEDIA_MINISTRY_RADIUS_MULT,
  },
  [UnitType.RiversBack]: {
    statLines: [
      { i18nKey: "ultimate.stat_water_tiles", pick: (s) => s.waterTiles },
    ],
  },
  [UnitType.WaterNuke]: {
    statLines: [
      { i18nKey: "ultimate.stat_water_tiles", pick: (s) => s.waterTiles },
    ],
  },
};

/**
 * Записи ульт ВЫВОДЯТСЯ из ULTIMATE_REGISTRY (ядро) — и штабы, и их касты.
 * Раньше это были 39 записей руками, которые надо было держать в согласии с
 * реестром ядра; забыть или разойтись было делом времени.
 */
const ULT_CATALOG_ENTRIES: Partial<Record<UnitType, UnitMeta>> =
  Object.fromEntries(
    ULTIMATE_REGISTRY.flatMap((u) => {
      const rows: [UnitType, UnitMeta][] = [
        [
          u.type,
          {
            type: u.type,
            icon: A(u.icon),
            key: u.key,
            ultimate: true,
            ...(ULT_EXTRAS[u.type] ?? {}),
          },
        ],
      ];
      if (u.cast !== undefined) {
        rows.push([
          u.cast.type,
          {
            type: u.cast.type,
            icon: A(u.cast.icon),
            key: u.cast.key,
            ultimate: true,
            ...(ULT_EXTRAS[u.cast.type] ?? {}),
          },
        ]);
      }
      return rows;
    }),
  ) as Partial<Record<UnitType, UnitMeta>>;

export const UNIT_CATALOG: Partial<Record<UnitType, UnitMeta>> = {
  ...ULT_CATALOG_ENTRIES,
  // terron 06.08: Мин правды ВЛИТА В МЕДИА — отдельного здания больше нет,
  // карточка закомментирована (статлайны и радиус ауры переехали в [Media]).
  // Вернуть = раскомментировать тут + проводку в Game.ts/ConstructionExecution.
  // [UnitType.MinistryOfTruth]: {
  //   type: UnitType.MinistryOfTruth,
  //   icon: A("MinistryIconWhite.svg"),
  //   key: "ministry_of_truth",
  //   ultimate: true,
  //   statLines: [
  //     { i18nKey: "ultimate.stat_enemy_lost", pick: (s) => s.stolen },
  //     { i18nKey: "ultimate.stat_gained", pick: (s) => s.stolenGained },
  //   ],
  //   hoverRadiusTiles: TERRON_MINISTRY_RADIUS,
  // },
  [UnitType.Port]: {
    type: UnitType.Port,
    icon: A("PortIcon.svg"),
    key: "port",
    ultimate: false,
  },
  [UnitType.Factory]: {
    type: UnitType.Factory,
    icon: A("FactoryIconWhite.svg"),
    key: "factory",
    ultimate: false,
  },
  [UnitType.Airport]: {
    type: UnitType.Airport,
    icon: A("AirportIconWhite.svg"),
    key: "airport",
    ultimate: false,
  },
  [UnitType.City]: {
    type: UnitType.City,
    icon: A("CityIconWhite.svg"),
    key: "city",
    ultimate: false,
  },
  [UnitType.MissileSilo]: {
    type: UnitType.MissileSilo,
    icon: A("MissileSiloIconWhite.svg"),
    key: "missile_silo",
    ultimate: false,
  },
  [UnitType.SAMLauncher]: {
    type: UnitType.SAMLauncher,
    icon: A("SamLauncherIconWhite.svg"),
    key: "sam_launcher",
    ultimate: false,
  },
};

/**
 * terron: ПОДЛОДКИ — иконка БОЕВОГО КОРАБЛЯ зависит от игрока: со штабом
 * «Подводный флот» все его корабли — подлодки, значит и кнопка в баре, и пункт
 * радиального меню, и «гост» при постройке обязаны показывать подлодку. Иначе
 * игрок жмёт корабль, а получает лодку (репорт владельца 06.08).
 * Всё, что рисует иконку строящегося корабля, зовёт ЭТУ функцию.
 */
/**
 * terron 23.08: ПОДМЕНА ЮНИТА УЛЬТОЙ — ИЗ РЕЕСТРА.
 *
 * Раньше здесь стоял флаг «есть ли Подводный флот», и каждая следующая ульта,
 * меняющая корабли, требовала правки этой функции руками. Именно так Пиратство
 * и осталось с иконкой линкора на кнопке 8, хотя строит уже пиратские лодки
 * (репорт владельца). Теперь подмена объявлена в ULTIMATE_REGISTRY (`replaces`),
 * а интерфейс просто спрашивает: «чем этот юнит подменён у этого игрока?».
 */
export function unitSkinFor(
  unit: UnitType,
  hasUltimate: (t: UnitType) => boolean,
): { icon: string; key: string } | null {
  for (const u of ULTIMATE_REGISTRY) {
    const r = u.replaces;
    if (r === null || r.unit !== unit) continue;
    if (!hasUltimate(u.type)) continue;
    return { icon: A(r.icon), key: r.key };
  }
  return null;
}

/** Иконка корабля с учётом подмены (подлодка/пиратская лодка). */
export function warshipIconFor(
  hasUltimate: ((t: UnitType) => boolean) | boolean,
): string {
  // Back-compat: старый вызов с булевым «есть Подводный флот».
  const has =
    typeof hasUltimate === "boolean"
      ? (t: UnitType) => hasUltimate && t === UnitType.SubmarineBase
      : hasUltimate;
  return unitSkinFor(UnitType.Warship, has)?.icon ?? A("BattleshipIconWhite.svg");
}

/** Метаданные по типу или по сырой строке из БД (= значение UnitType). */
export function unitMeta(t: UnitType | string): UnitMeta | undefined {
  return UNIT_CATALOG[t as UnitType];
}

/** Только иконка (undefined, если тип не в реестре). */
export function unitIcon(t: UnitType | string): string | undefined {
  return unitMeta(t)?.icon;
}

/** Все ультимейты из реестра (для сеток/списков). */
export function ultimateCatalog(): UnitMeta[] {
  return Object.values(UNIT_CATALOG).filter(
    (m): m is UnitMeta => !!m && m.ultimate,
  );
}

/**
 * Стат-строки ульты для тултипа (бар/радиал/ховер) — ЕДИНЫЙ источник, какие
 * счётчики показывать. Формат вывода (lit-html / TooltipItem / строка) остаётся
 * за местом вызова; здесь — только «какие ключи и какие числа».
 * snapshot — снимок ultStats() владельца (для ховера Мин.правды поля stolen/
 * stolenGained подменяют per-unit значениями в месте вызова).
 */
export function ultStatLines(
  t: UnitType | string,
  snapshot: UltStatSnapshot,
): Array<{ i18nKey: string; value: number }> {
  const specs = unitMeta(t)?.statLines;
  if (!specs) return [];
  return specs.map((l) => ({ i18nKey: l.i18nKey, value: l.pick(snapshot) }));
}

/**
 * ЕДИНЫЙ маппинг «тип юнита → i18n-ключ его НАЗВАНИЯ». Ключ enum'а UnitType —
 * это английская строка ("Trade Ship"), и раньше её лепили в UI напрямую
 * (`${unit.type()}` в PlayerInfoOverlay) → на русском сайте текло «Trade Ship».
 * Претензия модерации GamePush «Юниты не локализованы» — ровно про это.
 * Часть названий живёт в `unit_type.*`, часть (корабли/боеголовка) исторически
 * в `player_stats_table.unit.*` — здесь сведено в одно место, чтобы вызывающим
 * не знать, где что лежит.
 */
const UNIT_NAME_I18N: Partial<Record<UnitType, string>> = {
  [UnitType.City]: "unit_type.city",
  [UnitType.Port]: "unit_type.port",
  [UnitType.DefensePost]: "unit_type.defense_post",
  [UnitType.SAMLauncher]: "unit_type.sam_launcher",
  [UnitType.MissileSilo]: "unit_type.missile_silo",
  [UnitType.Warship]: "unit_type.warship",
  [UnitType.Factory]: "unit_type.factory",
  [UnitType.AtomBomb]: "unit_type.atom_bomb",
  [UnitType.HydrogenBomb]: "unit_type.hydrogen_bomb",
  [UnitType.MIRV]: "unit_type.mirv",
  [UnitType.Airport]: "unit_type.airport",
  [UnitType.SuicideDrone]: "unit_type.suicide_drone",
  [UnitType.MinistryOfTruth]: "unit_type.ministry_of_truth",
  [UnitType.Fortifications]: "unit_type.fortifications",
  [UnitType.CentralBank]: "unit_type.central_bank",
  [UnitType.AirCommand]: "unit_type.air_command",
  [UnitType.TankFactory]: "unit_type.tank_factory",
  [UnitType.Split]: "unit_type.split",
  [UnitType.Religion]: "unit_type.religion",
  [UnitType.Mining]: "unit_type.mining",
  [UnitType.Revanchism]: "unit_type.revanchism",
  [UnitType.OurSky]: "unit_type.our_sky",
  [UnitType.SatelliteStrike]: "unit_type.satellite_strike",
  [UnitType.ClosedCountry]: "unit_type.closed_country",
  [UnitType.Piracy]: "unit_type.piracy",
  [UnitType.Blockade]: "unit_type.blockade",
  [UnitType.Pride]: "unit_type.pride",
  [UnitType.Respite]: "unit_type.respite",
  [UnitType.Olympics]: "unit_type.olympics",
  [UnitType.Truce]: "unit_type.truce",
  [UnitType.Fanaticism]: "unit_type.fanaticism",
  [UnitType.Terror]: "unit_type.terror",
  [UnitType.VictoryBanner]: "unit_type.victory_banner",
  [UnitType.PeacePalace]: "unit_type.peace_palace",
  [UnitType.Pact]: "unit_type.pact",
  [UnitType.Greens]: "unit_type.greens",
  [UnitType.Catastrophe]: "unit_type.catastrophe",
  [UnitType.NuclearPlant]: "unit_type.nuclear_plant",
  [UnitType.Recultivation]: "unit_type.recultivation",
  [UnitType.Fuel]: "unit_type.fuel",
  [UnitType.IndustrialRevolution]: "unit_type.industrial_revolution",
  [UnitType.RailGun]: "unit_type.rail_gun",
  [UnitType.RailGunShell]: "unit_type.rail_gun_shell",
  [UnitType.Spaceport]: "unit_type.spaceport",
  [UnitType.PeacefulSky]: "unit_type.peaceful_sky",
  [UnitType.NuclearFactory]: "unit_type.nuclear_factory",
  [UnitType.TradeShip]: "player_stats_table.unit.trade",
  [UnitType.TransportShip]: "player_stats_table.unit.trans",
  [UnitType.MIRVWarhead]: "player_stats_table.unit.mirvw",
  [UnitType.Train]: "unit_type.train",
  [UnitType.Airplane]: "unit_type.airplane",
  [UnitType.AirborneAssault]: "unit_type.airborne_assault",
};

/** i18n-ключ названия юнита (undefined — названия в словаре нет). */
export function unitNameI18nKey(t: UnitType | string): string | undefined {
  return UNIT_NAME_I18N[t as UnitType];
}

/** Радиус круга по ховеру структуры (тайлы) или undefined = круга нет. */
export function ultHoverRadiusTiles(t: UnitType | string): number | undefined {
  return unitMeta(t)?.hoverRadiusTiles;
}

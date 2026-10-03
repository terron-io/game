import { assetUrl } from "../core/AssetUrls";
import {
  TERRON_MEDIA_MINISTRY_RADIUS_MULT,
  TERRON_MINISTRY_RADIUS,
  TERRON_RAILGUN_RANGE,
} from "../core/configuration/TerronTuning";
import {
  ultCasts,
  ULTIMATE_REGISTRY,
  UltStats,
  UnitType,
} from "../core/game/Game";

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

/**
 * Снимок ульт-счётчиков (форма PlayerView.ultStats(); для ховера Мин.правды —
 * поля stolen/stolenGained подменяются per-unit значениями).
 *
 * ⚠️ terron 26.08: ядерный `UltStats` — это СУММАРНЫЕ ЗА МАТЧ счётчики, и живым
 * показаниям Реваншизма (текущее замедление / уровень монумента) там не место.
 * Поэтому снимок КЛИЕНТСКИЙ и шире ядерного типа: ядро не трогаем, а тултип
 * получает всё одним объектом.
 */
export type UltStatSnapshot = UltStats & {
  /** Насколько % медленнее идёт захват моей земли прямо сейчас. */
  revanchismSlowPct: number;
  /** Уровень стоящего монумента (1..3; 0 — монумента нет). */
  revanchismLevel: number;
  /** Сколько % срезано от исторического пика. */
  revanchismLostPct: number;
};

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
  // terron 26.08: РЕВАНШИЗМ — «показывай текущие состояния» (владелец). Одна
  // запись видна СРАЗУ В ТРЁХ местах: панель (UnitDisplay), радиал телефона
  // (RadialMenuElements) и ховер монумента на карте (StructureHoverController).
  [UnitType.Revanchism]: {
    statLines: [
      {
        i18nKey: "ultimate.stat_revanchism_slow",
        pick: (s) => s.revanchismSlowPct,
      },
      {
        i18nKey: "ultimate.stat_revanchism_level",
        pick: (s) => s.revanchismLevel,
      },
      {
        i18nKey: "ultimate.stat_revanchism_lost",
        pick: (s) => s.revanchismLostPct,
      },
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
  // terron 25.08: ТЕРРАФОРМИНГ — у штаба видно ОБА счётчика (что затопил и
  // что насыпал), у каждой ракеты — свой.
  [UnitType.RiversBack]: {
    statLines: [
      { i18nKey: "ultimate.stat_water_tiles", pick: (s) => s.waterTiles },
      { i18nKey: "ultimate.stat_land_tiles", pick: (s) => s.landTiles },
    ],
  },
  [UnitType.WaterNuke]: {
    statLines: [
      { i18nKey: "ultimate.stat_water_tiles", pick: (s) => s.waterTiles },
    ],
  },
  [UnitType.LandNuke]: {
    statLines: [
      { i18nKey: "ultimate.stat_land_tiles", pick: (s) => s.landTiles },
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
      // terron 25.08: ВСЕ касты ульты, а не только слотовый (`ultCasts`) —
      // у Терраформинга их три, и забытый каст остался бы без иконки и имени.
      for (const c of ultCasts(u)) {
        rows.push([
          c.type,
          {
            type: c.type,
            icon: A(c.icon),
            key: c.key,
            ultimate: true,
            ...(ULT_EXTRAS[c.type] ?? {}),
          },
        ]);
      }
      return rows;
    }),
  ) as Partial<Record<UnitType, UnitMeta>>;

/**
 * terron 31.08: БАЗОВЫЕ строимые юниты. Их метаданные жили ТОЛЬКО в ручной
 * раскладке меню (`buildTable` в BuildMenu.ts), а прицельное управление берёт
 * иконку отсюда — поэтому на телефоне бункер, обе ядерки, корабль и
 * дрон-камикадзе рисовались БЕЗ ИКОНКИ вовсе.
 *
 * ⚠️ Держать их здесь, а не импортировать раскладку: `BuildMenu` сам тянет этот
 * каталог, и обратный импорт замкнул бы круг. Полноту стережёт
 * `tests/client/InputSurfacesContract.test.ts` — он падает, если у строимого
 * типа нет иконки или имени.
 */
const BASE_CATALOG_ENTRIES: Partial<Record<UnitType, UnitMeta>> = {
  [UnitType.DefensePost]: {
    type: UnitType.DefensePost,
    icon: A("ShieldIconWhite.svg"),
    key: "defense_post",
    ultimate: false,
  },
  [UnitType.AtomBomb]: {
    type: UnitType.AtomBomb,
    icon: A("NukeIconWhite.svg"),
    key: "atom_bomb",
    ultimate: false,
  },
  [UnitType.HydrogenBomb]: {
    type: UnitType.HydrogenBomb,
    icon: A("MushroomCloudIconWhite.svg"),
    key: "hydrogen_bomb",
    ultimate: false,
  },
  [UnitType.Warship]: {
    type: UnitType.Warship,
    icon: A("BattleshipIconWhite.svg"),
    key: "warship",
    ultimate: false,
  },
  [UnitType.SuicideDrone]: {
    type: UnitType.SuicideDrone,
    icon: A("DroneIconWhite.svg"),
    key: "suicide_drone",
    ultimate: false,
  },
};

export const UNIT_CATALOG: Partial<Record<UnitType, UnitMeta>> = {
  ...BASE_CATALOG_ENTRIES,
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

/**
 * i18n-ключ названия юнита (undefined — названия в словаре нет).
 *
 * terron 31.08 — ПОЧЕМУ ВЫВОДИТСЯ, А НЕ ПЕРЕЧИСЛЯЕТСЯ: таблица `UNIT_NAME_I18N`
 * велась руками и разошлась с каталогом — двенадцать типов остались без имени
 * (МЕДИА, Депо смерти, Шагающий город, все три ракеты Терраформинга…), хотя
 * ключи в словаре для них ЕСТЬ. На поверхностях, которые берут имя отсюда
 * (прицельное управление на телефоне), такие кнопки подписывались сырым
 * значением enum — «Doom Train» вместо «Состав смерти».
 *
 * Теперь ключ выводится из записи каталога (`unit_type.<key>`), а ручная
 * таблица осталась ТОЛЬКО для того, чего в каталоге нет по смыслу (поезда,
 * самолёты, десант — их не строят кнопкой) и для исключений, где ключ словаря
 * не совпадает с ключом записи. Новая ульта/каст получает имя сама.
 */
export function unitNameI18nKey(t: UnitType | string): string | undefined {
  const manual = UNIT_NAME_I18N[t as UnitType];
  if (manual !== undefined) return manual;
  const key = unitMeta(t)?.key;
  return key === undefined ? undefined : `unit_type.${key}`;
}

/** Радиус круга по ховеру структуры (тайлы) или undefined = круга нет. */
export function ultHoverRadiusTiles(t: UnitType | string): number | undefined {
  return unitMeta(t)?.hoverRadiusTiles;
}

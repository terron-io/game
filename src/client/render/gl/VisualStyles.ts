/**
 * terron: ВИЗУАЛЬНЫЕ СТИЛИ КАРТЫ — каталог «как выглядит игра».
 *
 * Зачем. Весь облик матча собирается из ТРЁХ независимых источников, и до сих
 * пор каждый был прибит гвоздями:
 *   1) ПАЛИТРА РЕЛЬЕФА — LUT 256×1 в TerrainPass (вода/берег/равнины/горы);
 *   2) ЦВЕТА ИГРОКОВ — палитра, из которой красятся территория, границы,
 *      юниты, здания и ники (то есть ВСЁ цветное разом);
 *   3) ПОСТ-ОБРАБОТКА земли — MapStylePass поверх «терраин + территория».
 * Стиль = один объект, который задаёт все три сразу. Ни один пасс о стилях не
 * знает: они получают уже готовые числа (LUT, палитру, юниформы).
 *
 * ⚠️ ЭТОТ ФАЙЛ — ЧИСТЫЕ ДАННЫЕ: ни DOM, ни localStorage, ни GL. Хранение
 * выбранного стиля живёт в `client/VisualStyleStore.ts`, применение к
 * RenderSettings — в `RenderOverrides.applyVisualStyle`, GPU — в Renderer.
 *
 * ⚠️ «Классика» ОБЯЗАНА оставаться байт-в-байт прежней игрой: у неё нет ни
 * палитры (используется родная `encodeTerrainTile`), ни пост-пасса (он вообще
 * не создаётся), ни правок настроек. Это точка отсчёта для сравнения.
 */

/** Цвет 0..255. */
export type RGB = readonly [number, number, number];

/**
 * Опорные цвета рельефа. LUT строится линейной интерполяцией внутри каждой
 * полосы magnitude — ровно теми же границами, что у родной `encodeTerrainTile`
 * (равнины 0-9, нагорья 10-19, горы 20-31, вода 0-10+).
 */
export interface TerrainPalette {
  /** Песчаная кромка суши (isLand && isShoreline). */
  shore: RGB;
  /** Равнины: magnitude 0 → 9. */
  plainsLow: RGB;
  plainsHigh: RGB;
  /** Нагорья: magnitude 10 → 19. */
  highlandLow: RGB;
  highlandHigh: RGB;
  /** Горы: magnitude 20 → 31. */
  mountainLow: RGB;
  mountainHigh: RGB;
  /** Вода у берега (isShoreline без isLand). */
  shoreWater: RGB;
  /** Открытая вода: magnitude 0 (мелко) → 10+ (глубоко). */
  waterShallow: RGB;
  waterDeep: RGB;
}

/**
 * Грейд ЦВЕТОВ ИГРОКОВ (HSL). Красит разом территорию, границы, юниты, здания
 * и ники — иначе стилизованная земля соседствовала бы с «родными» кислотными
 * юнитами и стиль разваливался бы на две несогласованные половины.
 *
 * ⚠️ Игроки обязаны оставаться РАЗЛИЧИМЫМИ: тянем оттенок к общему семейству,
 * но никогда не схлопываем в один цвет — разброс светлоты сохраняется.
 */
export interface PlayerColorGrade {
  /** Множитель насыщенности (1 = как есть). */
  saturation: number;
  /** Сдвиг светлоты, доли 0..1 (может быть отрицательным). */
  lightness: number;
  /** Притянуть оттенок к `hue` на `amount` (0..1). Не задан — не трогаем. */
  hueTarget?: { hue: number; amount: number };
}

/**
 * Параметры пост-обработки земли. Все «силы» — 0 значит выключено, поэтому
 * шейдер один на все стили: он не ветвится по id стиля, а читает числа.
 */
export interface StylePostFx {
  /** Насыщенность / контраст / яркость итогового цвета земли. */
  saturation: number;
  contrast: number;
  brightness: number;
  /** Дуотон: тени → `shadow`, света → `highlight`, сила `duotone` (0..1). */
  shadow: RGB;
  highlight: RGB;
  duotone: number;
  /** Постеризация (число ступеней; 0 = выкл). */
  posterize: number;
  /** Изолинии рельефа: сила и шаг по magnitude. */
  contour: number;
  contourStep: number;
  /** Обводка береговой линии. */
  coast: number;
  /** Цвет линий (изолинии/берег/сетка). */
  lineColor: RGB;
  /** Штриховка воды (как на бумажной карте). */
  hatch: number;
  /** Координатная сетка: сила и шаг в тайлах. */
  grid: number;
  gridStep: number;
  /** Зерно: сила и скорость (0 = статичное «зерно бумаги»). */
  grain: number;
  grainSpeed: number;
  /** Строки развёртки ЭЛТ. */
  scanline: number;
  /** Виньетка по краям экрана. */
  vignette: number;
  /** Свечение ярких мест (дешёвый блум). */
  glow: number;
  /** Хроматическая аберрация, пиксели. */
  aberration: number;
}

/** Точечные правки RenderSettings — что стиль меняет в остальном рендере. */
export interface StyleRenderTweaks {
  /** Ночной композит (свет городов). */
  lighting?: boolean;
  /** Фоновая освещённость 0..1 (имеет смысл при `lighting: true`). */
  ambient?: number;
  /** Прозрачность следов кораблей/самолётов. */
  trailAlpha?: number;
  /** Ники: чёрная заливка + цветная обводка (как на светлой карте). */
  darkNames?: boolean;
  /** Здания: светлая фигура игрока + тёмный глиф (классический вид). */
  classicIcons?: boolean;
  /** Подсветка территории под курсором. */
  highlightBrighten?: number;
  /** Цвет застарелого пепла (RGB 0..1 в шейдере — тут 0..255). */
  staleNuke?: RGB;
}

export interface VisualStyle {
  id: VisualStyleId;
  /** Имя на кнопке (RU) и подпись (EN) — панель двуязычная, как весь клиент. */
  nameRu: string;
  nameEn: string;
  /** Одна строка «в чём смысл» — показывается под списком. */
  hintRu: string;
  hintEn: string;
  /** Три цвета для превью-плашки на кнопке. */
  swatch: readonly [string, string, string];
  /** Цвет «пустоты» за краем карты. */
  voidColor: RGB;
  /** null = родная палитра рельефа (классика). */
  terrain: TerrainPalette | null;
  /** null = пост-пасс не создаётся вовсе (нулевая цена). */
  fx: StylePostFx | null;
  /** Грейд цветов игроков. null = как есть. */
  players: PlayerColorGrade | null;
  /** Альфа заливки территории (0..1). Родное значение — 150/255. */
  territoryAlpha: number;
  tweaks: StyleRenderTweaks;
}

export type VisualStyleId =
  | "classic"
  | "neon"
  | "paper"
  | "orbital"
  | "crt"
  | "blueprint";

/** Родная альфа заливки территории (была захардкожена в WebGLFrameBuilder). */
export const DEFAULT_TERRITORY_ALPHA = 150 / 255;

/** Родной цвет «пустоты» вокруг карты (был захардкожен в drawBaseLayer). */
export const DEFAULT_VOID_COLOR: RGB = [10, 10, 15];

/** Заготовка «ничего не делаем» — стили правят от неё, а не пишут 20 нулей. */
const NO_FX: StylePostFx = {
  saturation: 1,
  contrast: 1,
  brightness: 0,
  shadow: [0, 0, 0],
  highlight: [255, 255, 255],
  duotone: 0,
  posterize: 0,
  contour: 0,
  contourStep: 4,
  coast: 0,
  lineColor: [0, 0, 0],
  hatch: 0,
  grid: 0,
  gridStep: 32,
  grain: 0,
  grainSpeed: 0,
  scanline: 0,
  vignette: 0,
  glow: 0,
  aberration: 0,
};

const fx = (over: Partial<StylePostFx>): StylePostFx => ({ ...NO_FX, ...over });

export const VISUAL_STYLES: readonly VisualStyle[] = [
  // ---------------------------------------------------------------- КЛАССИКА
  {
    id: "classic",
    nameRu: "Классика",
    nameEn: "Classic",
    hintRu: "Родной вид игры — точка отсчёта для сравнения.",
    hintEn: "The stock look — the baseline to compare against.",
    swatch: ["#4682b4", "#bedc8a", "#cccb9e"],
    voidColor: DEFAULT_VOID_COLOR,
    terrain: null,
    fx: null,
    players: null,
    territoryAlpha: DEFAULT_TERRITORY_ALPHA,
    tweaks: {},
  },

  // -------------------------------------------------------------------- НЕОН
  {
    id: "neon",
    nameRu: "Неон",
    nameEn: "Neon",
    hintRu: "Ночной мегаполис: тёмная земля, светящиеся владения и города.",
    hintEn: "Night city: dark land, glowing territories and city lights.",
    swatch: ["#0a1430", "#ff2fb9", "#39d7ff"],
    voidColor: [4, 6, 15],
    terrain: {
      shore: [42, 35, 64],
      plainsLow: [19, 26, 46],
      plainsHigh: [26, 33, 64],
      highlandLow: [32, 38, 74],
      highlandHigh: [45, 48, 96],
      mountainLow: [58, 53, 96],
      mountainHigh: [78, 68, 124],
      shoreWater: [16, 58, 104],
      waterShallow: [8, 18, 44],
      waterDeep: [3, 6, 20],
    },
    fx: fx({
      saturation: 1.18,
      contrast: 1.16,
      brightness: -0.02,
      glow: 0.9,
      aberration: 0.7,
      vignette: 0.38,
      grain: 0.05,
      grainSpeed: 0.6,
      grid: 0.1,
      gridStep: 32,
      coast: 0.55,
      lineColor: [57, 215, 255],
    }),
    players: { saturation: 1.55, lightness: 0.06 },
    territoryAlpha: 0.42,
    tweaks: {
      lighting: true,
      ambient: 0.55,
      highlightBrighten: 0.35,
      staleNuke: [40, 255, 120],
    },
  },

  // ------------------------------------------------------------ ШТАБНАЯ КАРТА
  {
    id: "paper",
    nameRu: "Штабная карта",
    nameEn: "War room",
    hintRu: "Бумага, чернила и штриховка — фирменный стиль TERRON.",
    hintEn: "Paper, ink and hatching — the TERRON house style.",
    swatch: ["#efe5c6", "#c6b98f", "#3a3226"],
    voidColor: [232, 220, 187],
    terrain: {
      shore: [244, 236, 210],
      plainsLow: [239, 229, 198],
      plainsHigh: [230, 218, 182],
      highlandLow: [221, 207, 164],
      highlandHigh: [210, 193, 145],
      mountainLow: [195, 174, 125],
      mountainHigh: [179, 154, 104],
      shoreWater: [206, 199, 170],
      waterShallow: [193, 186, 156],
      waterDeep: [171, 164, 132],
    },
    fx: fx({
      saturation: 0.88,
      contrast: 1.06,
      shadow: [74, 63, 42],
      highlight: [255, 246, 221],
      duotone: 0.25,
      contour: 0.5,
      contourStep: 4,
      coast: 0.85,
      lineColor: [58, 50, 38],
      hatch: 0.36,
      grid: 0.12,
      gridStep: 64,
      grain: 0.16,
      grainSpeed: 0,
      vignette: 0.3,
    }),
    players: { saturation: 0.62, lightness: 0.04 },
    territoryAlpha: 0.55,
    tweaks: {
      darkNames: true,
      classicIcons: true,
      trailAlpha: 0.42,
      staleNuke: [90, 78, 58],
    },
  },

  // ------------------------------------------------------------------ ОРБИТА
  {
    id: "orbital",
    nameRu: "Орбита",
    nameEn: "Orbital",
    hintRu: "Ночная съёмка из космоса: чёрная земля и огни городов.",
    hintEn: "Night satellite pass: black land, city lights.",
    swatch: ["#02060f", "#12324f", "#ffcf7a"],
    voidColor: [1, 3, 10],
    terrain: {
      shore: [46, 48, 40],
      plainsLow: [24, 32, 24],
      plainsHigh: [32, 42, 30],
      highlandLow: [38, 46, 34],
      highlandHigh: [50, 56, 44],
      mountainLow: [66, 68, 60],
      mountainHigh: [88, 88, 82],
      shoreWater: [10, 30, 54],
      waterShallow: [6, 18, 40],
      waterDeep: [2, 6, 16],
    },
    fx: fx({
      saturation: 1.05,
      contrast: 1.16,
      brightness: 0.01,
      glow: 0.7,
      coast: 0.5,
      lineColor: [60, 122, 176],
      grain: 0.05,
      grainSpeed: 0.4,
      vignette: 0.42,
    }),
    players: { saturation: 1.25, lightness: 0.08 },
    territoryAlpha: 0.4,
    tweaks: { lighting: true, ambient: 0.3, trailAlpha: 0.75 },
  },

  // ----------------------------------------------------------------- ФОСФОР
  {
    id: "crt",
    nameRu: "Фосфор",
    nameEn: "Phosphor",
    hintRu: "Зелёный терминал 80-х: развёртка, свечение, ступени яркости.",
    hintEn: "80s green terminal: scanlines, glow, posterized levels.",
    swatch: ["#001a06", "#0a3d17", "#7dff9a"],
    voidColor: [0, 6, 0],
    terrain: {
      shore: [18, 96, 34],
      plainsLow: [8, 56, 21],
      plainsHigh: [14, 82, 31],
      highlandLow: [17, 95, 36],
      highlandHigh: [23, 116, 43],
      mountainLow: [31, 140, 54],
      mountainHigh: [42, 170, 66],
      shoreWater: [2, 30, 16],
      waterShallow: [1, 22, 12],
      waterDeep: [0, 12, 7],
    },
    fx: fx({
      saturation: 0.9,
      contrast: 1.15,
      shadow: [0, 26, 6],
      highlight: [125, 255, 154],
      duotone: 0.9,
      posterize: 6,
      contour: 0.16,
      contourStep: 12,
      coast: 0.6,
      lineColor: [125, 255, 154],
      scanline: 0.55,
      glow: 0.75,
      grain: 0.1,
      grainSpeed: 8,
      vignette: 0.5,
      aberration: 0.35,
    }),
    players: {
      saturation: 1.2,
      lightness: 0.06,
      hueTarget: { hue: 130, amount: 0.85 },
    },
    territoryAlpha: 0.5,
    tweaks: { highlightBrighten: 0.4, staleNuke: [20, 120, 40] },
  },

  // ----------------------------------------------------------------- ЧЕРТЁЖ
  {
    id: "blueprint",
    nameRu: "Чертёж",
    nameEn: "Blueprint",
    hintRu: "Синька: белые изолинии, сетка и обводка берега.",
    hintEn: "Blueprint: white contours, grid and inked coastline.",
    swatch: ["#0b2f6b", "#cfe4ff", "#7fb2ff"],
    voidColor: [7, 31, 74],
    terrain: {
      shore: [22, 71, 138],
      plainsLow: [11, 47, 107],
      plainsHigh: [14, 55, 122],
      highlandLow: [16, 62, 133],
      highlandHigh: [20, 74, 152],
      mountainLow: [26, 88, 172],
      mountainHigh: [34, 104, 192],
      shoreWater: [8, 38, 90],
      waterShallow: [7, 33, 80],
      waterDeep: [5, 24, 62],
    },
    fx: fx({
      saturation: 0.95,
      contrast: 1.12,
      shadow: [4, 23, 58],
      highlight: [207, 228, 255],
      duotone: 0.55,
      contour: 0.5,
      contourStep: 7,
      coast: 1.0,
      lineColor: [214, 233, 255],
      hatch: 0.14,
      grid: 0.35,
      gridStep: 16,
      grain: 0.07,
      grainSpeed: 0,
      vignette: 0.22,
      glow: 0.15,
    }),
    players: { saturation: 0.75, lightness: 0.18 },
    territoryAlpha: 0.38,
    tweaks: { classicIcons: true, trailAlpha: 0.7, staleNuke: [150, 190, 235] },
  },
];

export const DEFAULT_VISUAL_STYLE_ID: VisualStyleId = "classic";

export function visualStyleById(id: string): VisualStyle {
  return (
    VISUAL_STYLES.find((s) => s.id === id) ??
    VISUAL_STYLES.find((s) => s.id === DEFAULT_VISUAL_STYLE_ID)!
  );
}

// ---------------------------------------------------------------------------
// Грейд цветов игроков
// ---------------------------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = (((h % 360) + 360) % 360) / 360;
  return [
    Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hn) * 255),
    Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  ];
}

/**
 * terron: покрасить цвет игрока под стиль.
 *
 * ⚠️ Оттенок ТЯНЕМ, а не назначаем: игроки обязаны остаться различимыми. Даже
 * у «Фосфора» (все оттенки зелёного) разброс светлоты сохраняется — иначе на
 * карте нельзя отличить свою территорию от чужой, а это уже не стиль, а баг.
 */
export function gradePlayerRgb(
  r: number,
  g: number,
  b: number,
  grade: PlayerColorGrade | null,
): [number, number, number] {
  if (grade === null) return [r, g, b];
  let [h, s, l] = rgbToHsl(r, g, b);
  if (grade.hueTarget) {
    const { hue, amount } = grade.hueTarget;
    // Кратчайшая дуга — иначе «тянем к 130°» иногда шло бы через полкруга.
    let delta = ((hue - h + 540) % 360) - 180;
    h = h + delta * amount;
  }
  s = Math.max(0, Math.min(1, s * grade.saturation));
  l = Math.max(0.05, Math.min(0.95, l + grade.lightness));
  return hslToRgb(h, s, l);
}

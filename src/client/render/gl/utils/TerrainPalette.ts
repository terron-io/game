/**
 * terron: ПАЛИТРА РЕЛЬЕФА ПОД СТИЛЬ — байт террейна → цвет по опорным точкам.
 *
 * Родная `encodeTerrainTile` (ColorUtils) считает цвет по захардкоженным
 * формулам PastelTheme. Стилям нужен ТОТ ЖЕ разбор байта, но со своими
 * цветами, поэтому здесь — вторая реализация, параметризованная
 * `TerrainPalette` (опорные цвета на границах полос magnitude).
 *
 * ⚠️ Классику этот код НЕ трогает: при `terrain: null` LUT строит родная
 * функция, как и раньше — чтобы «точка отсчёта» осталась байт-в-байт прежней.
 *
 * Раскладка байта (как в ColorUtils):
 *   бит 7 — суша, бит 6 — береговая линия, биты 0-4 — magnitude (0-31).
 */

import type { RGB, TerrainPalette } from "../VisualStyles";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(a: RGB, b: RGB, t: number, out: Uint8Array, off: number): void {
  out[off] = Math.round(lerp(a[0], b[0], t));
  out[off + 1] = Math.round(lerp(a[1], b[1], t));
  out[off + 2] = Math.round(lerp(a[2], b[2], t));
  out[off + 3] = 255;
}

/** Закодировать один байт террейна цветами стиля. */
export function encodeStyledTerrainTile(
  tb: number,
  palette: TerrainPalette,
  out: Uint8Array,
  offset: number,
): void {
  const isLand = (tb & 0x80) !== 0;
  const isShoreline = (tb & 0x40) !== 0;
  const magnitude = tb & 0x1f;

  if (isLand && isShoreline) {
    mix(palette.shore, palette.shore, 0, out, offset);
    return;
  }
  if (isLand) {
    if (magnitude < 10) {
      mix(palette.plainsLow, palette.plainsHigh, magnitude / 9, out, offset);
    } else if (magnitude < 20) {
      mix(
        palette.highlandLow,
        palette.highlandHigh,
        (magnitude - 10) / 9,
        out,
        offset,
      );
    } else {
      mix(
        palette.mountainLow,
        palette.mountainHigh,
        (magnitude - 20) / 11,
        out,
        offset,
      );
    }
    return;
  }
  if (isShoreline) {
    mix(palette.shoreWater, palette.shoreWater, 0, out, offset);
    return;
  }
  // Открытая вода: magnitude здесь — «мелководность», 10+ = дальше от берега.
  const m = Math.min(magnitude, 10);
  mix(palette.waterShallow, palette.waterDeep, m / 10, out, offset);
}

/** Собрать LUT 256×1 (RGBA8) для палитры стиля. */
export function buildStyledTerrainLut(palette: TerrainPalette): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  for (let b = 0; b < 256; b++) encodeStyledTerrainTile(b, palette, lut, b * 4);
  return lut;
}

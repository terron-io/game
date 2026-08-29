/**
 * Pure CPU text shaping — cursor position computation and number formatting.
 * No WebGL dependency.
 */

import type { GlyphTables } from "./AtlasData";
import { CHAR_RANGE, MAX_CHARS } from "./Types";

// terron: MSDF-атлас (DejaVu Sans Bold) покрывает латиницу/кириллицу/греческий/
// стрелки/символы. Слоты хранят КОМПАКТНЫЙ индекс глифа (1..N), а не юникод-код:
// layoutString маппит код-поинт → индекс через glyph.indexOf, неизвестный символ
// → glyph.tofu (□). Так на карте рисуются настоящие русские/юникод-ники.

export interface LayoutResult {
  charCodes: Uint16Array; // compact glyph index per slot (MAX_CHARS, zero-padded)
  cursors: Float32Array; // centered cursor X per slot (MAX_CHARS)
  halfWidth: number; // visual half-width in font units
}

/**
 * Lay out a string: map codepoints → compact glyph indices, compute
 * advance-based cursor X positions, then center on visual bounds.
 *
 * Writes into caller-provided buffers to avoid allocation. Iterates by Unicode
 * codepoint (handles surrogate pairs); unknown codepoints fall back to □.
 */
export function layoutString(
  text: string,
  glyph: GlyphTables,
  kernTable: Int8Array,
  charCodes: Uint16Array,
  cursors: Float32Array,
): number {
  charCodes.fill(0);
  cursors.fill(0);

  let len = 0;
  for (const cp of text) {
    if (len >= MAX_CHARS) break;
    const code = cp.codePointAt(0)!;
    charCodes[len++] = glyph.indexOf.get(code) ?? glyph.tofu;
  }
  if (len === 0) return 0;

  // Advance-based cursor positions
  let cumulative = 0;
  let prevCode = 0;
  for (let i = 0; i < len; i++) {
    const code = charCodes[i];
    cursors[i] = cumulative;
    let adv = glyph.advance[code];
    if (i > 0) {
      adv += kernTable[prevCode * CHAR_RANGE + code];
    }
    cumulative += adv;
    prevCode = code;
  }

  // Center on visual bounds (not advance bounds)
  const firstCode = charCodes[0];
  const lastCode = charCodes[len - 1];
  const visualLeft = cursors[0] + glyph.xOffset[firstCode];
  const visualRight =
    cursors[len - 1] + glyph.xOffset[lastCode] + glyph.visW[lastCode];
  const visualCenter = (visualLeft + visualRight) * 0.5;
  for (let i = 0; i < len; i++) {
    cursors[i] -= visualCenter;
  }

  return (visualRight - visualLeft) * 0.5;
}

/** Format internal troop count for display (internal values are 10x display). */
export function formatTroops(internalTroops: number): string {
  const troops = internalTroops / 10;
  if (troops >= 1_000_000) {
    return (troops / 1_000_000).toFixed(1) + "M";
  }
  if (troops >= 1_000) {
    return (troops / 1_000).toFixed(1) + "K";
  }
  return troops.toFixed(0);
}

/**
 * Atlas data parsing — extracts font metrics, glyph lookup tables,
 * kerning data, and icon atlas index maps from static JSON assets.
 */

import emojiAtlasMeta from "resources/atlases/emoji-atlas-meta.json";
import atlasData from "resources/atlases/msdf-atlas.json";
import type { BMChar, BMKerning, ParsedAtlas } from "./Types";
import { CHAR_RANGE } from "./Types";

// ---------------------------------------------------------------------------
// Atlas parsing
// ---------------------------------------------------------------------------

export function parseAtlasData(): ParsedAtlas {
  const chars = atlasData.chars as BMChar[];
  // Юникод-код → компактный индекс. Индекс 0 зарезервирован под пустой слот
  // (шейдер трактует charCode==0 как «пропустить»), поэтому нумеруем с 1.
  const indexOf = new Map<number, number>();
  chars.forEach((ch, i) => indexOf.set(ch.id, i + 1));
  const tofu = indexOf.get(0x25a1) ?? 0; // □ для неизвестных символов
  return {
    fontSize: atlasData.info.size,
    base: atlasData.common.base,
    scaleW: atlasData.common.scaleW,
    scaleH: atlasData.common.scaleH,
    distanceRange: (atlasData as any).distanceField?.distanceRange ?? 4,
    chars,
    kernings: (atlasData.kernings ?? []) as BMKerning[],
    indexOf,
    tofu,
  };
}

// ---------------------------------------------------------------------------
// CPU-side glyph lookup tables
// ---------------------------------------------------------------------------

export interface GlyphTables {
  advance: Float32Array; // [CHAR_RANGE] — xadvance per compact glyph index
  xOffset: Float32Array; // [CHAR_RANGE] — xoffset (left bearing) per compact index
  visW: Float32Array; // [CHAR_RANGE] — visible glyph width per compact index
  /** Unicode codepoint → compact glyph index (for layout). */
  indexOf: Map<number, number>;
  /** Compact index of the □ fallback glyph. */
  tofu: number;
}

export function buildGlyphTables(atlas: ParsedAtlas): GlyphTables {
  const advance = new Float32Array(CHAR_RANGE);
  const xOffset = new Float32Array(CHAR_RANGE);
  const visW = new Float32Array(CHAR_RANGE);
  for (const ch of atlas.chars) {
    const idx = atlas.indexOf.get(ch.id);
    if (idx !== undefined && idx < CHAR_RANGE) {
      advance[idx] = ch.xadvance;
      xOffset[idx] = ch.xoffset;
      visW[idx] = ch.width;
    }
  }
  return { advance, xOffset, visW, indexOf: atlas.indexOf, tofu: atlas.tofu };
}

// ---------------------------------------------------------------------------
// Kerning table (amounts are small integers: typically -7 to +4)
// ---------------------------------------------------------------------------

export function buildKernTable(atlas: ParsedAtlas): Int8Array {
  const table = new Int8Array(CHAR_RANGE * CHAR_RANGE);
  for (const k of atlas.kernings) {
    // BMFont kernings keyed by codepoint → ремапим в компактные индексы.
    const a = atlas.indexOf.get(k.first);
    const b = atlas.indexOf.get(k.second);
    if (a !== undefined && b !== undefined && a < CHAR_RANGE && b < CHAR_RANGE) {
      table[a * CHAR_RANGE + b] = k.amount;
    }
  }
  return table;
}

// ---------------------------------------------------------------------------
// Icon atlas lookups
// ---------------------------------------------------------------------------

export function buildEmojiLookup(): Map<string, number> {
  const map = new Map<string, number>();
  const meta = emojiAtlasMeta as { emojis: Record<string, number> };
  for (const [ch, idx] of Object.entries(meta.emojis)) {
    map.set(ch, idx);
  }
  return map;
}

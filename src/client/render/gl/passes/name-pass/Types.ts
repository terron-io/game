/**
 * Shared types and constants for the NamePass subsystem.
 */

// ---------------------------------------------------------------------------
// BMFont JSON types
// ---------------------------------------------------------------------------

export interface BMChar {
  id: number;
  char: string;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
  x: number;
  y: number;
  page: number;
}

export interface BMKerning {
  first: number;
  second: number;
  amount: number;
}

export interface ParsedAtlas {
  fontSize: number;
  base: number;
  scaleW: number;
  scaleH: number;
  distanceRange: number;
  chars: BMChar[];
  kernings: BMKerning[];
  /** Unicode codepoint → compact glyph index (1..N). 0 reserved = empty slot. */
  indexOf: Map<number, number>;
  /** Compact index of the □ fallback glyph (U+25A1) for unknown codepoints. */
  tofu: number;
}

// ---------------------------------------------------------------------------
// Per-player CPU-side state
// ---------------------------------------------------------------------------

export interface PlayerSlot {
  index: number;
  playerID: string;
  static: import("../../../types").PlayerStatic;

  srcX: number;
  srcY: number;
  srcScale: number;
  tgtX: number;
  tgtY: number;
  tgtScale: number;
  startTime: number;

  alive: boolean;
  nameLen: number;
  troopLen: number;
  lastTroopStr: string;
  /** URL identifying which flag this player wants (dedup key). undefined = none. */
  flagUrl: string | undefined;
  /** Layer index in FlagAtlasArray, or -1 if not loaded yet / no flag. */
  flagLayerIdx: number;
  emojiAtlasIdx: number;
  nameHalfWidth: number;

  // Status flags (individual booleans, written as 1.0/0.0 to GPU)
  crown: boolean;
  traitor: boolean;
  disconnected: boolean;
  alliance: boolean;
  allianceReq: boolean;
  target: boolean;
  embargo: boolean;
  nukeActive: boolean;
  nukeTargetsMe: boolean;
  traitorRemainingTicks: number;
  allianceFraction: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Глифы адресуются КОМПАКТНЫМ индексом (1..N), а не юникод-кодом — иначе при
// охвате до 0x2764 таблица кернинга (CHAR_RANGE²) раздулась бы до сотен МБ.
// Должно быть ≥ числа глифов в атласе + 1 (сейчас ~1056). Запас до 2048.
export const CHAR_RANGE = 2048;

/** Max characters per text line (name or troop count). */
export const MAX_CHARS = 32;

/** Lines per player: 0 = name, 1 = troop count. */
export const LINES_PER_PLAYER = 2;

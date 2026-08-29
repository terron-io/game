// terron: ультимейты — РАСКОЛ. Общая геометрия «флага» с буквой Т, чтобы движок
// (SplitExecution) и клиентское превью (SplitPreviewController) рисовали ОДНО И
// ТО ЖЕ. Флаг — прямоугольник (полу-высота hh, полу-ширина hw) с центром в цели.
// Буква Т сидит ВНУТРИ с рамкой основы со всех сторон; «уши» перекладины короче
// краёв. Спека: new-units/SPLIT.md
import {
  TERRON_SPLIT_ASPECT_H,
  TERRON_SPLIT_ASPECT_W,
  TERRON_SPLIT_MAX_HALF_HEIGHT,
  TERRON_SPLIT_MAX_LAND_PCT,
  TERRON_SPLIT_MIN_HALF_HEIGHT,
  TERRON_SPLIT_MIN_LAND_PCT,
  TERRON_SPLIT_T_BAR_FRAC,
  TERRON_SPLIT_T_EAR_HALF_FRAC,
  TERRON_SPLIT_T_MARGIN_FRAC,
  TERRON_SPLIT_T_STEM_HALF_FRAC,
} from "../configuration/TerronTuning";

// terron: размер флага = ТОЛЬКО от доли атаки (процента), не от абсолюта войск,
// и меряется В ДОЛЕ СУШИ КАРТЫ (ремейк 06.08 — раньше полу-высота была в тайлах,
// и один и тот же флаг занимал 5.5% мелкой карты и 0.23% крупной).
//   доля атаки → процент суши (линейно MIN_PCT..MAX_PCT) → площадь флага в
//   тайлах → полу-высота: площадь = (2hh)·(2hw), hw = hh·W/H ⇒ hh = √(S·H/(4W)).
// Одинаково у движка (SplitExecution) и превью (SplitPreviewController) — иначе
// нарисованный флаг разойдётся с вырезанным. ratio клэмпится [0,1].
export function splitHalfHeight(ratio: number, landTiles: number): number {
  const r = Math.max(0, Math.min(1, ratio));
  const pct =
    TERRON_SPLIT_MIN_LAND_PCT +
    r * (TERRON_SPLIT_MAX_LAND_PCT - TERRON_SPLIT_MIN_LAND_PCT);
  const area = pct * Math.max(0, landTiles);
  const hh = Math.round(
    Math.sqrt((area * TERRON_SPLIT_ASPECT_H) / (4 * TERRON_SPLIT_ASPECT_W)),
  );
  return Math.max(
    TERRON_SPLIT_MIN_HALF_HEIGHT,
    Math.min(TERRON_SPLIT_MAX_HALF_HEIGHT, hh),
  );
}

export interface SplitTShape {
  marginX: number;
  marginY: number;
  barThick: number; // толщина перекладины (рядов)
  earHalf: number; // полу-длина перекладины (уши)
  stemHalf: number; // полу-ширина ножки
  innerTop: number; // ry верхней кромки Т (после рамки сверху)
  innerBottom: number; // ry нижней кромки Т (до рамки снизу)
}

// Параметры формы Т для флага размера hh×hw (целочисленные, детерминированно).
export function splitTShape(hh: number, hw: number): SplitTShape {
  const marginX = Math.round(hw * TERRON_SPLIT_T_MARGIN_FRAC);
  const marginY = Math.round(hh * TERRON_SPLIT_T_MARGIN_FRAC);
  const barThick = Math.max(2, Math.floor(2 * hh * TERRON_SPLIT_T_BAR_FRAC));
  const stemHalf = Math.max(
    1,
    Math.floor(2 * hw * TERRON_SPLIT_T_STEM_HALF_FRAC),
  );
  const earHalf = Math.max(
    stemHalf + 1,
    Math.floor(2 * hw * TERRON_SPLIT_T_EAR_HALF_FRAC),
  );
  return {
    marginX,
    marginY,
    barThick,
    earHalf,
    stemHalf,
    innerTop: -hh + marginY,
    innerBottom: hh - marginY,
  };
}

// Принадлежит ли тайл (rx,ry относительно центра) букве Т.
export function isSplitTTile(rx: number, ry: number, s: SplitTShape): boolean {
  const inBar =
    ry >= s.innerTop &&
    ry < s.innerTop + s.barThick &&
    Math.abs(rx) <= s.earHalf;
  const inStem =
    ry >= s.innerTop && ry <= s.innerBottom && Math.abs(rx) <= s.stemHalf;
  return inBar || inStem;
}

/**
 * terron: превью узоров ядерного пепла для магазина/редактора скинов.
 *
 * ⚠️ ЗЕРКАЛО ШЕЙДЕРА: та же математика, что `falloutSkinMask` в
 * `render/gl/shaders/map-overlay/territory.frag.glsl` — правишь узор там,
 * правь здесь (иначе в магазине человек выберет одно, а в матче увидит другое).
 * Сторож — tests/client/FalloutSkinPreview.test.ts.
 */

export const FALLOUT_SKIN_COUNT = 10;

/** Названия узоров (те же, что в комментариях шейдера). */
export function falloutSkinTitle(idx: number, ru: boolean): string {
  const names: [string, string][] = [
    ["Аварийка", "Hazard"],
    ["Клетка", "Checker"],
    ["Рябь", "Ripple"],
    ["Кирпичи", "Bricks"],
    ["Трещины", "Cracks"],
    ["Горох", "Dots"],
    ["Камуфляж", "Camo"],
    ["Сетка", "Grid"],
    ["Зигзаг", "Zigzag"],
    ["Помехи", "Static"],
  ];
  const n = names[idx - 1];
  if (!n) return ru ? "Случайный" : "Random";
  return ru ? n[0] : n[1];
}

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/** Маска узора в точке мировых координат — 1:1 с falloutSkinMask в шейдере. */
export function falloutSkinMask(idx: number, x: number, y: number): number {
  switch (idx) {
    case 1: {
      const f = (x + y) / 9;
      return f - Math.floor(f) >= 0.5 ? 1 : 0;
    }
    case 2: {
      const cx = Math.floor(x / 5);
      const cy = Math.floor(y / 5);
      return (((cx + cy) % 2) + 2) % 2;
    }
    case 3:
      return Math.sin(x * 0.9) * Math.sin(y * 0.9) >= 0 ? 1 : 0;
    case 4: {
      const row = Math.floor(y / 4);
      const xx = x + (((row % 2) + 2) % 2) * 4;
      const mx = xx / 8 - Math.floor(xx / 8);
      const my = y / 4 - Math.floor(y / 4);
      return mx < 0.08 || my < 0.14 ? 1 : 0;
    }
    case 5: {
      const n = noise(x * 0.35, y * 0.35);
      const t = Math.abs(n - 0.5);
      // smoothstep(0, 0.06, t), затем 1 - результат
      const e = Math.min(1, Math.max(0, t / 0.06));
      return 1 - e * e * (3 - 2 * e);
    }
    case 6: {
      const cx = x / 6 - Math.floor(x / 6) - 0.5;
      const cy = y / 6 - Math.floor(y / 6) - 0.5;
      return Math.hypot(cx, cy) < 0.3 ? 1 : 0;
    }
    case 7:
      return noise(x * 0.22, y * 0.22) >= 0.55 ? 1 : 0;
    case 8: {
      const gx = x / 6 - Math.floor(x / 6);
      const gy = y / 6 - Math.floor(y / 6);
      return gx < 0.12 || gy < 0.12 ? 1 : 0;
    }
    case 9: {
      const t = Math.abs((x / 8 - Math.floor(x / 8)) * 2 - 1);
      const v = (y + t * 4) / 6;
      return v - Math.floor(v) >= 0.5 ? 1 : 0;
    }
    case 10:
      return hash(Math.floor(x), Math.floor(y)) >= 0.5 ? 1 : 0;
    default:
      return 0;
  }
}

// Цвета — как выглядит пепел в матче: два тона + кайма цветом владельца.
const ASH_A = "#4a4a42";
const ASH_B = "#6d6d5f";

/**
 * Плитка-превью узора: data-URL PNG. `scale` — сколько пикселей на игровой тайл
 * (в матче узор считается по мировым координатам, поэтому масштаб важен).
 */
export function falloutSkinPreviewUrl(
  idx: number,
  size = 64,
  scale = 2,
  borderColor = "#c0392b",
): string {
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(size, size);
  const a = hexToRgb(ASH_A);
  const b = hexToRgb(ASH_B);
  const brd = hexToRgb(borderColor);
  const edge = Math.max(1, Math.round(size * 0.06));
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const onEdge =
        px < edge || py < edge || px >= size - edge || py >= size - edge;
      const m = falloutSkinMask(idx, px / scale, py / scale);
      const c = onEdge ? brd : m > 0.5 ? b : a;
      const o = (py * size + px) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// terron: ПИКСЕЛЬ-ПОРТРЕТ игрока («персона»). Спека — avatar.md.
//
// Холст рисования — 48×64 (вертикальный поясной портрет).
// Запекается в КВАДРАТ 64×64 PNG: поля по бокам (по 8px) заливаются фоном.
// Зачем квадрат: все существующие показы аватарки — квадратные боксы с
// object-fit:cover; портрет 3:4 в них обрезало бы по голове. Квадрат = ноль
// правок в местах показа.
//
// PNG lossless → запечённая картинка И ЕСТЬ исходник: редактор читает её
// обратно (docFromDataUrl) и даёт дорисовать. Отдельной колонки в БД не нужно —
// портрет уезжает в users.avatar через существующий PATCH /me {avatar}.
// Вес: ~0.5–1.5КБ на портрет (при лимите 256КБ) — дёшево и для будущих топов.

export const ART_W = 48;
export const ART_H = 64;
export const BAKE = 64;
export const ART_X = (BAKE - ART_W) >> 1; // 8

/** Документ портрета: пиксели 0xRRGGBB + цвет фона (им же заливаются поля). */
export type Doc = { px: Int32Array; bg: number };

// ── утилиты цвета ────────────────────────────────────────────────────────────
const hex = (s: string): number => parseInt(s.slice(1), 16);

/** Умножить яркость (тени/подсветка). */
export function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

export function toCss(c: number): string {
  return "#" + (c >>> 0).toString(16).padStart(6, "0");
}

function hsl(h: number, s: number, l: number): number {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** Простой строковый хеш (FNV-1a-ish) → uint32. */
export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── работа с документом ──────────────────────────────────────────────────────
export function newDoc(bg: number): Doc {
  const px = new Int32Array(ART_W * ART_H);
  px.fill(bg);
  return { px, bg };
}

export function cloneDoc(d: Doc): Doc {
  return { px: Int32Array.from(d.px), bg: d.bg };
}

export function setPx(d: Doc, x: number, y: number, c: number): void {
  if (x < 0 || y < 0 || x >= ART_W || y >= ART_H) return;
  d.px[y * ART_W + x] = c;
}

export function getPx(d: Doc, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= ART_W || y >= ART_H) return d.bg;
  return d.px[y * ART_W + x];
}

function rect(
  d: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  c: number,
): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) setPx(d, i, j, c);
}

/** Заливка 4-связная (инструмент «ведро»). */
export function floodFill(d: Doc, x: number, y: number, c: number): void {
  const from = getPx(d, x, y);
  if (from === c) return;
  const stack: number[] = [x, y];
  while (stack.length) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= ART_W || cy >= ART_H) continue;
    if (d.px[cy * ART_W + cx] !== from) continue;
    d.px[cy * ART_W + cx] = c;
    stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
  }
}

// ── ПАЛИТРЫ генератора ───────────────────────────────────────────────────────
const SKIN = ["#f4cfa8", "#e6b184", "#cf9163", "#a86c43", "#7a4d2e", "#f8dfc6"].map(hex);
const HAIR = [
  "#221f1c", "#3f2a1b", "#6b4423", "#a9762f", "#d8c07a",
  "#8f8f8f", "#e6e6e6", "#7a2424", "#2f4a6b", "#4a2f6b",
].map(hex);
const COAT = [
  "#5b6b7a", "#6f5545", "#3f5a3f", "#5f4a68", "#8a7a3a",
  "#454550", "#7a3a3a", "#2f4a5a", "#2b2a24",
].map(hex);
const SHIRT = ["#e9e3cd", "#d8c8a8", "#c8d8d0", "#e2d2da", "#d2dae8", "#f1e9d2"].map(hex);
const INK = hex("#20201c");

/** Палитра редактора (тапаемые свотчи). Ряды: тон кожи / волосы / одежда / акценты. */
export const SWATCHES: number[] = [
  ...SKIN,
  ...SKIN.map((c) => shade(c, 0.82)),
  ...HAIR,
  ...COAT,
  ...SHIRT,
  hex("#20201c"), hex("#4a4a44"), hex("#8a8a80"), hex("#c8c8bc"), hex("#ffffff"),
  hex("#b23b3b"), hex("#e07a2f"), hex("#f2b705"), hex("#2e7d32"), hex("#2f6ba8"),
  hex("#7b3fa0"), hex("#d46aa0"), hex("#00897b"), hex("#8d6e63"), hex("#efe6c8"),
];

// ── ГЕНЕРАТОР («граватар в нашем стиле») ─────────────────────────────────────
//
// Фирменная черта: ГЛАЗА + НОС СКЛАДЫВАЮТСЯ В БУКВУ «Т» (как у NPC майнкрафта
// и Сквидварда — длинный нос, тяжёлая надбровная перекладина). Перекладина «Т» =
// линия глаз, ножка = нос. Это опознавательный знак террона на любой аватарке.
/** Детерминированный портрет из seed. */
export function generatePortrait(seed: string): Doc {
  const r = mulberry32(hashSeed(seed || "?"));
  const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)];
  const chance = (p: number): boolean => r() < p;

  const bg = hsl(Math.floor(r() * 360), 24, 80);
  const skin = pick(SKIN);
  const skinS = shade(skin, 0.86);
  const skinD = shade(skin, 0.72);
  const hair = pick(HAIR);
  const hairS = shade(hair, 0.75);
  const coat = pick(COAT);
  const shirt = pick(SHIRT);
  const hairStyle = Math.floor(r() * 5);
  const beard = Math.floor(r() * 4); // 0 нет / 1 усы / 2 щетина / 3 борода
  const browThick = chance(0.45);
  const gaze = Math.floor(r() * 3) - 1;
  const noseLong = chance(0.5);

  const d = newDoc(bg);

  // ── торс (плечи «лесенкой», чтобы не было кирпича) ─────────────────────────
  rect(d, 9, 42, 30, 2, coat);
  rect(d, 6, 44, 36, 2, coat);
  rect(d, 4, 46, 40, ART_H - 46, coat);
  // рубаха-клин под воротником
  for (let i = 0; i < 12; i++) {
    const y = 42 + i;
    const half = 3 + Math.floor(i * 0.7);
    rect(d, 24 - half, y, half * 2, 1, shirt);
  }
  // лацканы
  for (let i = 0; i < 12; i++) {
    const y = 42 + i;
    const half = 3 + Math.floor(i * 0.7);
    setPx(d, 24 - half - 1, y, shade(coat, 0.8));
    setPx(d, 24 + half, y, shade(coat, 0.8));
  }

  // ── шея / голова ──────────────────────────────────────────────────────────
  rect(d, 20, 36, 8, 7, skinS);
  rect(d, 12, 5, 24, 33, skin);
  rect(d, 34, 5, 2, 33, skinS); // теневая грань справа
  rect(d, 10, 20, 2, 6, skinS); // уши
  rect(d, 36, 20, 2, 6, shade(skinS, 0.94));

  // ── волосы ────────────────────────────────────────────────────────────────
  switch (hairStyle) {
    case 0: // короткая
      rect(d, 12, 4, 24, 8, hair);
      rect(d, 12, 12, 2, 6, hairS);
      rect(d, 34, 12, 2, 6, hairS);
      break;
    case 1: // длинная
      rect(d, 12, 3, 24, 10, hair);
      rect(d, 10, 10, 4, 24, hair);
      rect(d, 34, 10, 4, 24, hairS);
      break;
    case 2: // лысина
      rect(d, 12, 11, 3, 7, hairS);
      rect(d, 33, 11, 3, 7, hairS);
      break;
    case 3: // ирокез
      rect(d, 21, 1, 6, 12, hair);
      rect(d, 12, 9, 24, 3, hairS);
      break;
    default: // каре
      rect(d, 12, 4, 24, 9, hair);
      rect(d, 10, 11, 4, 17, hair);
      rect(d, 34, 11, 4, 17, hairS);
      rect(d, 14, 13, 20, 2, hairS); // чёлка
  }

  // ── «Т»: перекладина (сплошная бровь) + ножка (нос) ───────────────────────
  // Это фирменный знак террона — лицо читается буквой Т.
  const brow = hairStyle === 2 ? shade(skinD, 0.66) : hairS;
  rect(d, 14, 17, 20, browThick ? 3 : 2, brow);
  const noseBottom = noseLong ? 33 : 30;
  const noseEdge = shade(skin, 0.6);
  rect(d, 22, 17, 4, noseBottom - 17, skinD); // ножка «Т» — нос
  rect(d, 22, 20, 1, noseBottom - 20, noseEdge); // грань носа
  rect(d, 21, noseBottom - 2, 6, 2, noseEdge); // кончик

  // ── глаза (под перекладиной) ──────────────────────────────────────────────
  rect(d, 15, 20, 4, 3, 0xffffff);
  rect(d, 29, 20, 4, 3, 0xffffff);
  rect(d, 16 + gaze, 20, 2, 3, INK);
  rect(d, 30 + gaze, 20, 2, 3, INK);

  // ── рот ───────────────────────────────────────────────────────────────────
  rect(d, 21, 35, 6, 1, shade(skin, 0.42));

  // ── растительность ────────────────────────────────────────────────────────
  if (beard === 1) rect(d, 20, 33, 8, 2, hairS);
  else if (beard === 2) rect(d, 14, 32, 20, 6, shade(hair, 0.9));
  else if (beard === 3) {
    rect(d, 13, 30, 22, 8, hair);
    rect(d, 20, 33, 8, 2, hairS);
  }

  return d;
}

// ── запекание / чтение ───────────────────────────────────────────────────────
/** Doc → квадратный 64×64 PNG data-URL (поля залиты фоном). */
export function bakeDataUrl(doc: Doc): string {
  const cv = document.createElement("canvas");
  cv.width = BAKE;
  cv.height = BAKE;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(BAKE, BAKE);
  const o = img.data;
  for (let y = 0; y < BAKE; y++) {
    for (let x = 0; x < BAKE; x++) {
      const ax = x - ART_X;
      const c =
        ax >= 0 && ax < ART_W && y < ART_H ? doc.px[y * ART_W + ax] : doc.bg;
      const i = (y * BAKE + x) * 4;
      o[i] = (c >> 16) & 255;
      o[i + 1] = (c >> 8) & 255;
      o[i + 2] = c & 255;
      o[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}

/**
 * Прочитать запечённый портрет обратно в Doc (для дорисовки).
 * Возвращает null, если картинка не наша (не 64×64) — тогда редактор
 * стартует со сгенерированного портрета.
 */
export async function docFromDataUrl(src: string): Promise<Doc | null> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("img"));
      im.src = src;
    });
    if (img.naturalWidth !== BAKE || img.naturalHeight !== BAKE) return null;
    const cv = document.createElement("canvas");
    cv.width = BAKE;
    cv.height = BAKE;
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, BAKE, BAKE).data;
    const at = (x: number, y: number): number => {
      const i = (y * BAKE + x) * 4;
      return (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    };
    const doc = newDoc(at(0, 0));
    for (let y = 0; y < ART_H; y++)
      for (let x = 0; x < ART_W; x++) doc.px[y * ART_W + x] = at(x + ART_X, y);
    return doc;
  } catch {
    return null;
  }
}

/** Любая картинка → Doc (пикселизация в 48×64 «по обложке»). */
export function docFromImage(img: HTMLImageElement, bg: number): Doc {
  const cv = document.createElement("canvas");
  cv.width = ART_W;
  cv.height = ART_H;
  const ctx = cv.getContext("2d")!;
  const s = Math.max(ART_W / img.naturalWidth, ART_H / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, (ART_W - w) / 2, (ART_H - h) / 2, w, h);
  const data = ctx.getImageData(0, 0, ART_W, ART_H).data;
  const doc = newDoc(bg);
  for (let i = 0; i < ART_W * ART_H; i++) {
    const j = i * 4;
    doc.px[i] =
      data[j + 3] < 40
        ? bg
        : (data[j] << 16) | (data[j + 1] << 8) | data[j + 2];
  }
  return doc;
}

// ── кэш дефолтных портретов (рисуются в списках по 50 строк) ─────────────────
const cache = new Map<string, string>();

/** Дефолтная аватарка: детерминированный портрет по seed (data-URL PNG). */
export function generatedPortraitDataUri(seed: string): string {
  const key = seed || "?";
  const hit = cache.get(key);
  if (hit) return hit;
  const url = bakeDataUrl(generatePortrait(key));
  if (cache.size > 400) cache.clear();
  cache.set(key, url);
  return url;
}

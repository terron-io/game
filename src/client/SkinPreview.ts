import { assetUrl } from "../core/AssetUrls";

// terron: ЕДИНЫЙ рендерер превью скина — как в игре. Карта + наша территория,
// окружённая соседями ВПЛОТНУЮ (общие границы), залитая скином по режиму.
// Используется ВЕЗДЕ (редактор скинов, магазин, «мои скины») — один метод, один вид.
//
// renderSkinPreview({skinUrl, mode, dim, tileTiles}) → data-URL картинки превью.
//   mode: 1 фикс(clamp) · 2 стретч(cover) · 3 тайл(fract)
//   dim: 0..1 (видимость скина) · tileTiles: масштаб тайла (как uSkinTileTiles)
//
// Территории строятся взвешенным разбиением Вороного: игрок в центре + кольцо
// соседей вокруг → все примыкают, между владельцами видна граница (как в игре —
// территория, затемнённая по контуру). Соседи разноцветные — для контраста границ.
// Геометрия (сиды фиксированы) статична → считается один раз и кешируется; при
// таскании слайдеров пересчитывается только заливка скином.

// Логическая сетка = масштаб игры (семантика tileTiles совпадает с uSkinTileTiles).
// Рендерим с суперсэмплингом SS → силуэт/границы гладкие, не «лего».
const LW = 148;
const LH = 66;
const SS = 4;
const OW = LW * SS;
const OH = LH * SS;
const SD = 256; // квадрат сэмпла скина (cover-заливка как в атласе)

const PLAYER_COLOR = [0xca, 0xa8, 0x6f]; // базовый цвет территории игрока
// палитра соседей (разные цвета — чтобы видеть контраст границ)
const NEI_COLORS = [
  [0x7f, 0xa8, 0xd0],
  [0xcf, 0x90, 0x90],
  [0x97, 0xc4, 0x8a],
  [0xc7, 0xb0, 0x82],
  [0xb0, 0x90, 0xcc],
  [0x86, 0xc6, 0xc0],
  [0xd0, 0xb6, 0x7a],
];

// сиды (логические координаты): игрок в центре + кольцо соседей со всех сторон,
// чтобы у игрока была граница с каждой стороны. Игроку больший вес → крупнее.
const PCX = 74;
const PCY = 33;
const BASE_SEEDS: { x: number; y: number; w2: number }[] = [
  { x: PCX, y: PCY, w2: 1.5 * 1.5 }, // 0 = игрок
  { x: 30, y: 15, w2: 1 },
  { x: 74, y: 11, w2: 1 },
  { x: 118, y: 16, w2: 1 },
  { x: 124, y: 44, w2: 1 },
  { x: 96, y: 57, w2: 1 },
  { x: 50, y: 57, w2: 1 },
  { x: 24, y: 45, w2: 1 },
];

// позиции сидов с детерминированным дрожанием по сиду рандома (для ⟳-разнообразия).
// игрока (i=0) почти не двигаем — он должен оставаться в центре.
function seedsFor(seed: number): { x: number; y: number; w2: number }[] {
  return BASE_SEEDS.map((s, i) => {
    if (i === 0) return s;
    const j = seed * 1.7 + i * 2.3;
    return {
      x: s.x + Math.sin(j) * 9,
      y: s.y + Math.cos(j * 1.31 + 1.1) * 6,
      w2: s.w2 * (0.85 + 0.3 * (0.5 + 0.5 * Math.sin(j * 0.7))),
    };
  });
}

// доменный варп: смещаем координату псевдо-шумом → границы/берег становятся
// волнистыми и органичными (как пиксельные территории в игре, а не ровные дольки).
function warp(lx: number, ly: number, seed: number): [number, number] {
  const s = seed * 1.3;
  const nx =
    Math.sin(lx * 0.17 + ly * 0.05 + s) * 5.5 +
    Math.sin(ly * 0.31 - s * 1.7) * 3;
  const ny =
    Math.cos(ly * 0.19 - lx * 0.06 - s * 0.8) * 5 +
    Math.cos(lx * 0.29 + s * 1.3) * 2.5;
  return [lx + nx, ly + ny];
}

// материк: эллипс с волнистым краем (береговая линия), охватывает все сиды
function inContinent(x: number, y: number): boolean {
  const dx = (x - PCX) / 71;
  const dy = (y - PCY) / 31;
  const a = Math.atan2(y - PCY, x - PCX);
  const wob = 0.92 + 0.1 * Math.sin(a * 3 + 0.6) + 0.05 * Math.sin(a * 5 + 2);
  return dx * dx + dy * dy < wob * wob;
}

// ближайший сид (взвешенно) по варп-координате: индекс сида или -1 для океана
function ownerAt(
  lx: number,
  ly: number,
  seeds: { x: number; y: number; w2: number }[],
  seed: number,
): number {
  const [wx, wy] = warp(lx, ly, seed);
  if (!inContinent(wx, wy)) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const dx = wx - s.x;
    const dy = wy - s.y;
    const d = (dx * dx + dy * dy) / s.w2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

interface Geo {
  own: Int8Array; // владелец каждого вых.пикселя: -1 океан, 0 игрок, 1..N сосед
  border: Uint8Array; // 1 = пиксель-граница (контур владения)
  mnx: number;
  mny: number;
  mxx: number;
  mxy: number; // bbox территории игрока (логические координаты)
}
let geoCache: { seed: number; geo: Geo } | null = null;

function getGeo(seed: number): Geo {
  if (geoCache && geoCache.seed === seed) return geoCache.geo;
  const seeds = seedsFor(seed);
  const own = new Int8Array(OW * OH);
  let mnx = Infinity;
  let mny = Infinity;
  let mxx = -Infinity;
  let mxy = -Infinity;
  for (let oy = 0; oy < OH; oy++)
    for (let ox = 0; ox < OW; ox++) {
      const lx = ox / SS;
      const ly = oy / SS;
      const o = ownerAt(lx, ly, seeds, seed);
      own[oy * OW + ox] = o;
      if (o === 0) {
        if (lx < mnx) mnx = lx;
        if (lx > mxx) mxx = lx;
        if (ly < mny) mny = ly;
        if (ly > mxy) mxy = ly;
      }
    }
  // границы: пиксель — грань, если рядом (≤BR) другой владелец/океан
  const BR = 2;
  const border = new Uint8Array(OW * OH);
  for (let oy = 0; oy < OH; oy++)
    for (let ox = 0; ox < OW; ox++) {
      const idx = oy * OW + ox;
      const o = own[idx];
      if (o < 0) continue;
      let edge = false;
      for (let dy = -BR; dy <= BR && !edge; dy++)
        for (let dx = -BR; dx <= BR; dx++) {
          const nx = ox + dx;
          const ny = oy + dy;
          const no =
            nx < 0 || ny < 0 || nx >= OW || ny >= OH ? -1 : own[ny * OW + nx];
          if (no !== o) {
            edge = true;
            break;
          }
        }
      if (edge) border[idx] = 1;
    }
  const geo: Geo = { own, border, mnx, mny, mxx, mxy };
  geoCache = { seed, geo };
  return geo;
}

// карта владельцев для ховера по зонам (как в игре): owners[y*ow+x] = -1 океан,
// 0 игрок, 1..N сосед. Размер ow×oh. Геометрия кеширована — дёшево.
export function getPreviewGeo(seed = 0): {
  owners: Int8Array;
  ow: number;
  oh: number;
} {
  return { owners: getGeo(seed).own, ow: OW, oh: OH };
}

let mapImg: HTMLImageElement | null = null;
let mapLoading: Promise<HTMLImageElement | null> | null = null;
const imgCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImg(src: string): Promise<HTMLImageElement | null> {
  let p = imgCache.get(src);
  if (!p) {
    p = new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
    imgCache.set(src, p);
  }
  return p;
}

function getMap(): Promise<HTMLImageElement | null> {
  if (mapImg) return Promise.resolve(mapImg);
  if (!mapLoading) {
    mapLoading = loadImg(assetUrl("maps/africa/thumbnail.webp")).then((im) => {
      mapImg = im;
      return im;
    });
  }
  return mapLoading;
}

export async function renderSkinPreview(opts: {
  skinUrl: string;
  mode: number;
  dim: number;
  tileTiles: number;
  seed?: number;
}): Promise<string> {
  const img = await loadImg(opts.skinUrl);
  if (!img || !img.naturalWidth) return "";
  const map = await getMap();

  // фон-карта (океан + суша), сглажен — мягкий «как карта»
  const cv = document.createElement("canvas");
  cv.width = OW;
  cv.height = OH;
  const ctx = cv.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = true;
  if (map) {
    const s = Math.max(OW / map.width, OH / map.height);
    ctx.drawImage(
      map,
      (OW - map.width * s) / 2,
      (OH - map.height * s) / 2,
      map.width * s,
      map.height * s,
    );
  } else {
    ctx.fillStyle = "#5e7fa3";
    ctx.fillRect(0, 0, OW, OH);
  }
  const out = ctx.getImageData(0, 0, OW, OH);
  const od = out.data;

  // cover-заливка скина в квадрат SD (как атлас игры)
  const scv = document.createElement("canvas");
  scv.width = SD;
  scv.height = SD;
  const sctx = scv.getContext("2d");
  if (!sctx) return "";
  // как в атласе игры: mode 2 (cover-зона) и 1/3 (тайл) — STRETCH в квадрат (полная
  // картинка без обрезки; форму восстанавливает прямоугольная ячейка/пропорция ниже);
  // mode 4 (статик) — CONTAIN (letterbox); остальное — COVER. Превью = как в игре.
  if (opts.mode === 2 || opts.mode === 1 || opts.mode === 3) {
    sctx.drawImage(img, 0, 0, SD, SD);
  } else {
    const sc = (opts.mode === 4 ? Math.min : Math.max)(
      SD / img.naturalWidth,
      SD / img.naturalHeight,
    );
    sctx.drawImage(
      img,
      (SD - img.naturalWidth * sc) / 2,
      (SD - img.naturalHeight * sc) / 2,
      img.naturalWidth * sc,
      img.naturalHeight * sc,
    );
  }
  const sd = sctx.getImageData(0, 0, SD, SD).data;
  const sample = (u: number, v: number): number[] | null => {
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const sx = Math.min(SD - 1, Math.floor(u * SD));
    const sy = Math.min(SD - 1, Math.floor(v * SD));
    const i = (sy * SD + sx) * 4;
    return sd[i + 3] === 0 ? null : [sd[i], sd[i + 1], sd[i + 2], sd[i + 3]];
  };

  const { own, border, mnx, mny, mxx, mxy } = getGeo(opts.seed ?? 0);
  if (mnx === Infinity) return cv.toDataURL(); // нет территории игрока — только карта
  const ccx = (mnx + mxx) / 2;
  const ccy = (mny + mxy) / 2;
  const dim = opts.dim;
  const mode = opts.mode;
  const cells = Math.max(1, opts.tileTiles); // как uSkinTileTiles в игре

  // заливка территорий
  for (let oy = 0; oy < OH; oy++)
    for (let ox = 0; ox < OW; ox++) {
      const idx = oy * OW + ox;
      const o = own[idx];
      if (o < 0) continue; // океан — оставляем карту
      const po = idx * 4;
      if (o === 0) {
        const lx = ox / SS;
        const ly = oy / SS;
        let u: number;
        let v: number;
        if (mode === 2) {
          // COVER истинных пропорций: прямоугольник (aspect) покрывает зону по
          // меньшей стороне (как в игре). Зона всегда заполнена.
          const a = img.naturalWidth / img.naturalHeight;
          const zw = Math.max(mxx - mnx, 1);
          const zh = Math.max(mxy - mny, 1);
          const za = zw / zh;
          const rw = a >= za ? zh * a : zw;
          const rh = a >= za ? zh : zw / a;
          u = (lx - ccx) / rw + 0.5;
          v = (ly - ccy) / rh + 0.5;
        } else if (mode === 3 || mode === 1) {
          // TILE в первозданном виде: прямоугольная ячейка a:1 (как в игре) — картинка
          // в SD растянута в квадрат, тут восстанавливаем форму (период X=cells, Y=cells/a).
          const a = img.naturalWidth / img.naturalHeight;
          u = ((((lx - mnx) / cells) % 1) + 1) % 1;
          v = (((((ly - mny) * a) / cells) % 1) + 1) % 1;
        } else if (mode === 4) {
          // СТАТИЧНЫЙ: квадрат (letterbox-картинка) вписан в КАРТУ (contain), центр —
          // у территории игрока (в игре — у спавна); поля/за краями → цвет игрока.
          const a = img.naturalWidth / img.naturalHeight;
          const D = a >= 1 ? Math.min(LW, LH * a) : Math.min(LH, LW / a);
          u = (lx - (PCX - D / 2)) / D;
          v = (ly - (PCY - D / 2)) / D;
        } else {
          u = Math.min(1, Math.max(0, (lx - ccx) / cells + 0.5));
          v = Math.min(1, Math.max(0, (ly - ccy) / cells + 0.5));
        }
        let r = PLAYER_COLOR[0];
        let g = PLAYER_COLOR[1];
        let b = PLAYER_COLOR[2];
        const sk = sample(u, v);
        if (sk) {
          const af = (sk[3] / 255) * dim;
          r = Math.round(r * (1 - af) + sk[0] * af);
          g = Math.round(g * (1 - af) + sk[1] * af);
          b = Math.round(b * (1 - af) + sk[2] * af);
        }
        od[po] = r;
        od[po + 1] = g;
        od[po + 2] = b;
        od[po + 3] = 255;
      } else {
        const c = NEI_COLORS[(o - 1) % NEI_COLORS.length];
        od[po] = c[0];
        od[po + 1] = c[1];
        od[po + 2] = c[2];
        od[po + 3] = 255;
      }
    }

  // границы (как в игре: контур территории darken ≈ territoryColor.darken(0.125))
  for (let i = 0; i < border.length; i++) {
    if (!border[i]) continue;
    const po = i * 4;
    od[po] = Math.round(od[po] * 0.78);
    od[po + 1] = Math.round(od[po + 1] * 0.78);
    od[po + 2] = Math.round(od[po + 2] * 0.78);
    od[po + 3] = 255;
  }

  ctx.putImageData(out, 0, 0);
  return cv.toDataURL();
}

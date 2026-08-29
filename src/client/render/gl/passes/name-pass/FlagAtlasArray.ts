/**
 * FlagAtlasArray — runtime TEXTURE_2D_ARRAY of player flag images.
 *
 * Replaces the build-time flag atlas. Layers are assigned on demand as players
 * arrive, keyed by URL so identical flags share a layer (every "Mercia" bot
 * costs one slot, not one per player). Images are fetched async and drawn into
 * a fixed-size cell so all layers have the same dimensions.
 *
 * When a layer becomes ready, `onLayerReady(url, layer)` fires so the owning
 * pass can flip slots from -1 to the assigned layer.
 *
 * Layers are not reclaimed; if the cap is hit, further requests return -1 and
 * render no icon.
 */

const FLAG_CELL_W = 128;
const FLAG_CELL_H = 85;

/**
 * Потолок уникальных флагов в матче.
 *
 * terron ПЕРФ (07.08): было 512 — и это самый большой единичный кусок
 * видеопамяти во всей сборке GL-вида. `texStorage3D` ниже создаёт ИММУТАБЕЛЬНОЕ
 * хранилище, драйвер коммитит его целиком сразу: 128×85×4 Б = 43.5 КБ на слой,
 * ×512 ≈ 21 МиБ нулевого уровня, с мип-цепочкой ≈ 28 МиБ. Резервировалось это
 * на КАЖДОМ старте матча независимо от карты — постоянный «пьедестал» под
 * пиком аллокации, где и теряется WebGL-контекст (все потери — первый матч).
 *
 * 160 выбрано по замеру, а не на глаз:
 *   • флаги наций — максимум 107 уникальных (Гигантский мир, по манифестам карт;
 *     у World 70, у Европы 52, у большинства меньше);
 *   • флаги людей — максимум 5 уникальных за 14 дней прода, людей в матче ≤ 8.
 * Худший наблюдаемый случай = 115 слоёв, 160 даёт ~40% запаса поверх него.
 * Экономия ≈ 19 МиБ GPU на каждом матче.
 *
 * Переполнение уже обработано штатно: request() вернёт -1 и игрок останется
 * без иконки флага (см. ниже) — деградация мягкая, не краш.
 */
export const MAX_FLAG_LAYERS = 160;

// terron ПЕРФ 16.08: гард решения «потолок 160». Первый отказ включает таймер,
// через 5с шлём ОДИН репорт с числом флагов, оставшихся без слоя, — по нему
// видно, 160 не хватило на 2 флага или на 50. Счётчик на модуль (не на
// инстанс): атлас пересоздаётся на матч, а нам нужен один сигнал за сессию.
let overflowRefused = 0;
let overflowReportArmed = false;

function noteOverflow(layerCount: number): void {
  overflowRefused++;
  if (overflowReportArmed) return;
  overflowReportArmed = true;
  setTimeout(() => {
    void import("../../../../Health").then(({ reportHealth }) =>
      reportHealth(
        "flag_atlas_overflow",
        `не хватило ${overflowRefused} слоёв поверх ${layerCount}`,
        { refused: overflowRefused, layerCount },
      ),
    );
  }, 5000);
}

interface PendingEntry {
  layer: number;
  ready: boolean;
}

export class FlagAtlasArray {
  private gl: WebGL2RenderingContext;
  private tex: WebGLTexture;
  private layerCount: number;
  private nextLayer = 0;

  private entries = new Map<string, PendingEntry>();
  private onLayerReady: (url: string, layer: number) => void;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(
    gl: WebGL2RenderingContext,
    onLayerReady: (url: string, layer: number) => void,
  ) {
    this.gl = gl;
    this.onLayerReady = onLayerReady;

    const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    this.layerCount = Math.min(MAX_FLAG_LAYERS, maxLayers);

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      mipLevels(FLAG_CELL_W, FLAG_CELL_H),
      gl.RGBA8,
      FLAG_CELL_W,
      FLAG_CELL_H,
      this.layerCount,
    );
    gl.texParameteri(
      gl.TEXTURE_2D_ARRAY,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.canvas = document.createElement("canvas");
    this.canvas.width = FLAG_CELL_W;
    this.canvas.height = FLAG_CELL_H;
    // КРАШИ MALI (mali-crashes.md): willReadFrequently=true — холст живёт в ОЗУ,
    // и getImageData при аплоаде не тянет пиксели обратно с видеопамяти.
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  }

  get texture(): WebGLTexture {
    return this.tex;
  }

  /** Layer index for an already-loaded URL, or -1 if pending/missing/unassigned. */
  getLayer(url: string): number {
    const e = this.entries.get(url);
    return e && e.ready ? e.layer : -1;
  }

  /**
   * Request a flag. Returns immediately; `onLayerReady` fires once the image is
   * loaded and uploaded. Subsequent calls for the same URL are no-ops.
   */
  request(url: string): void {
    if (this.entries.has(url)) return;
    if (this.nextLayer >= this.layerCount) {
      noteOverflow(this.layerCount); // hit cap → no icon
      return;
    }

    const layer = this.nextLayer++;
    const entry: PendingEntry = { layer, ready: false };
    this.entries.set(url, entry);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Draw into a fixed-size cell to normalize the image to layer dimensions.
      // Center via aspect-fit so non-3:2 flags don't stretch.
      this.ctx.clearRect(0, 0, FLAG_CELL_W, FLAG_CELL_H);
      const srcAspect = img.width / img.height;
      const dstAspect = FLAG_CELL_W / FLAG_CELL_H;
      let dw: number, dh: number;
      if (srcAspect > dstAspect) {
        dw = FLAG_CELL_W;
        dh = FLAG_CELL_W / srcAspect;
      } else {
        dh = FLAG_CELL_H;
        dw = FLAG_CELL_H * srcAspect;
      }
      const dx = (FLAG_CELL_W - dw) * 0.5;
      const dy = (FLAG_CELL_H - dh) * 0.5;
      this.ctx.drawImage(img, dx, dy, dw, dh);

      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      // КРАШИ MALI (mali-crashes.md): грузим ПИКСЕЛИ, а не canvas — см. тот же
      // приём в SkinAtlasArray. Canvas-источник Chromium заливает GPU-блитом,
      // на котором драйвер Mali падает (glCopyTexSubImage2D в стеках).
      const pixels = this.ctx.getImageData(0, 0, FLAG_CELL_W, FLAG_CELL_H).data;
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        layer,
        FLAG_CELL_W,
        FLAG_CELL_H,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);

      entry.ready = true;
      this.onLayerReady(url, layer);
    };
    img.onerror = () => {
      // Leave entry as not-ready forever; layer is consumed but harmless.
      console.warn("Flag image failed to load:", url);
    };
    img.src = url;
  }

  dispose(): void {
    this.gl.deleteTexture(this.tex);
    this.entries.clear();
  }
}

function mipLevels(w: number, h: number): number {
  return Math.floor(Math.log2(Math.max(w, h))) + 1;
}

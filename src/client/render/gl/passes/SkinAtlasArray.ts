/**
 * SkinAtlasArray — fixed-size TEXTURE_2D_ARRAY of territory skin PNGs.
 *
 * The player set is locked at game start, so the unique skin URL count is
 * known up front. The atlas allocates exactly that many `SKIN_DIM × SKIN_DIM`
 * layers once and never resizes. Each layer is filled in asynchronously as
 * its PNG decodes; `onLayerReady(url, layer)` fires per layer so callers can
 * patch their per-player layer table.
 *
 * If `urls` is empty the atlas binds a 1×1×1 placeholder so the shader's
 * `uSkinAtlas` sampler still has something to read from (the shader's
 * skinLayer table will be all zeros, so it never actually samples).
 *
 * Sampler wrap is CLAMP_TO_EDGE — the shader treats UVs outside [0,1] as
 * transparent so the image appears as a single stamp centered at the anchor.
 */

/** Per-side dimension for every atlas layer. Larger images are downscaled. */
export const SKIN_DIM = 1024;

export class SkinAtlasArray {
  private gl: WebGL2RenderingContext;
  private tex: WebGLTexture;
  /** url → layer index. Layers are assigned in iteration order at construction. */
  private layers = new Map<string, number>();
  private onLayerReady: (url: string, layer: number) => void;
  /** terron: слои статичного скина (mode 4) — вписываются CONTAIN (letterbox,
   *  прозрачные поля), а не cover-кропом, чтобы НЕ терять края картинки. */
  private letterboxLayers = new Set<number>();
  /** terron: слои stretch-скина (mode 2) — заливаются РАСТЯЖЕНИЕМ в квадрат (полная
   *  картинка, искажение снимает шейдер прямоугольником истинных пропорций). */
  private stretchLayers = new Set<number>();

  /**
   * @param urls Unique skin URLs needed for this game. If empty, the atlas is
   *   a 1×1×1 placeholder. Order determines layer assignment.
   * @param letterboxUrls URLs, которые вписывать contain (mode 4 «статичный»).
   * @param stretchUrls URLs, которые заливать растяжением в квадрат (mode 2 cover).
   */
  constructor(
    gl: WebGL2RenderingContext,
    urls: readonly string[],
    onLayerReady: (url: string, layer: number) => void,
    letterboxUrls?: ReadonlySet<string>,
    stretchUrls?: ReadonlySet<string>,
  ) {
    this.gl = gl;
    this.onLayerReady = onLayerReady;

    if (urls.length === 0) {
      this.tex = this.makeTex(1, 1, 1);
      return;
    }

    this.tex = this.makeTex(SKIN_DIM, SKIN_DIM, urls.length);
    urls.forEach((url, layer) => {
      this.layers.set(url, layer);
      if (letterboxUrls?.has(url)) this.letterboxLayers.add(layer);
      if (stretchUrls?.has(url)) this.stretchLayers.add(layer);
      this.load(url, layer);
    });
  }

  get texture(): WebGLTexture {
    return this.tex;
  }

  /** Layer index for a URL, or -1 if this URL wasn't registered at construction. */
  getLayer(url: string): number {
    return this.layers.get(url) ?? -1;
  }

  private load(url: string, layer: number): void {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      this.uploadImage(img, layer);
      this.onLayerReady(url, layer);
    };
    img.onerror = () => {
      console.warn("Skin image failed to load:", url);
    };
    img.src = url;
  }

  /**
   * Draw image to COVER the full SKIN_DIM×SKIN_DIM cell (scale by the larger
   * factor, center, crop the overflow). Раньше картинка центрировалась в нативном
   * размере → у скинов меньше SKIN_DIM (напр. 512) вокруг оставалось ПРОЗРАЧНОЕ
   * поле, и при растяжке на территорию оно занимало бо́льшую часть зоны, а сама
   * картинка казалась мелкой по центру. cover-заливка убирает поле: UV [0,1] =
   * вся картинка, прозрачные пиксели самого файла по-прежнему пропускают цвет зоны.
   * Центр остаётся в UV 0.5 → якорь спавна (STAMP) не сдвигается.
   */
  private uploadImage(img: HTMLImageElement, layer: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = SKIN_DIM;
    canvas.height = SKIN_DIM;
    // КРАШИ MALI (mali-crashes.md): willReadFrequently=true — просим Chromium
    // держать холст в ОЗУ, а не на GPU. Иначе getImageData ниже вызывает
    // обратное чтение с видеопамяти, то есть ровно ту работу драйвера, от
    // которой мы и уходим.
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    // mode 2 (stretch): РАСТЯГИВАЕМ в квадрат (полная картинка, искажение снимет шейдер).
    // mode 4 (статичный): CONTAIN (min) — вся картинка, по краям прозрачные поля → цвет.
    // Остальные (тайлы): COVER (max) — как было.
    if (this.stretchLayers.has(layer)) {
      ctx.drawImage(img, 0, 0, SKIN_DIM, SKIN_DIM);
    } else {
      const letterbox = this.letterboxLayers.has(layer);
      const scale = (letterbox ? Math.min : Math.max)(
        SKIN_DIM / img.naturalWidth,
        SKIN_DIM / img.naturalHeight,
      );
      const drawW = (img.naturalWidth * scale) | 0;
      const drawH = (img.naturalHeight * scale) | 0;
      const offX = ((SKIN_DIM - drawW) / 2) | 0;
      const offY = ((SKIN_DIM - drawH) / 2) | 0;
      ctx.drawImage(img, offX, offY, drawW, drawH);
    }

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    // КРАШИ MALI (mali-crashes.md): грузим ПИКСЕЛИ (Uint8ClampedArray), а НЕ сам
    // canvas. Для canvas-источника Chromium идёт не прямым CPU-аплоадом, а
    // GPU-блитом — отсюда glCopyTexSubImage2D в стеках падений libGLES_mali.so.
    // С типизированным массивом путь простой: memcpy в texSubImage3D.
    // Картинка пиксель-в-пиксель та же, меняется только способ доставки.
    const pixels = ctx.getImageData(0, 0, SKIN_DIM, SKIN_DIM).data;
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      SKIN_DIM,
      SKIN_DIM,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    // БЕЗ generateMipmap: WebGL генерит мипы с CLAMP-краями (не оборачивает) → на
    // стыке тайлов мип-края не совпадают = серая СЕТКА. Без мипов тайл бесшовный.
  }

  private makeTex(w: number, h: number, layerCount: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    // 1 уровень (без мип-цепочки) — мипы давали серую сетку на стыке тайлов.
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, layerCount);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // REPEAT — для бесшовного тайла (mode 1/3 семплят по непрерывной координате →
    // GPU оборачивает билинейку через стык плиток). cover/contain/штамп (2/4/0)
    // держат uv в [0,1] и/или гейтятся inBounds → REPEAT им безвреден.
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  dispose(): void {
    this.gl.deleteTexture(this.tex);
    this.layers.clear();
  }
}

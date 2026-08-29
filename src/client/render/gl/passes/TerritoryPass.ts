/**
 * TerritoryPass — territory fill + stale-nuke ground.
 *
 * Draws only what should be darkened by the night cycle:
 *   - Owned territory (player color fill)
 *   - Any fallout tile (stale-nuke ground, overrides owned territory)
 *
 * No borders, embers, trails, or defense checkerboard — those are
 * handled by BorderStampPass and TrailPass at full brightness.
 *
 * Owns the CPU-side tile state and the drip queue that staggers tile
 * uploads across render frames.
 */

import { UserSettings } from "../../../../core/game/UserSettings";
import type { TilePair } from "../../types";
import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize } from "../utils/ColorUtils";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";
import { OWNER_MASK, TILE_DEFINES } from "../utils/TileCodec";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import territoryFragSrc from "../shaders/map-overlay/territory.frag.glsl?raw";
import { TileScatterPass } from "./TileScatterPass";

export class TerritoryPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;

  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;
  private uStaleNukeBase: WebGLUniformLocation;
  private uStaleNukeVariation: WebGLUniformLocation;
  private uStaleNukeAlpha: WebGLUniformLocation;
  private uStaleNukeColor: WebGLUniformLocation;
  private uHighlightOwner: WebGLUniformLocation;
  private uHighlightBrighten: WebGLUniformLocation;
  private uShowPatterns: WebGLUniformLocation;
  private uIsTeamMode: WebGLUniformLocation;
  private uDefenseDarken: WebGLUniformLocation;
  private uSkinTrueColor: WebGLUniformLocation;
  private userSettings = new UserSettings();
  private highlightOwner = 0;
  private isTeamMode = false;

  // terron виральность: per-owner AABB зон (для stretch mode 2). Скан карты раз в N кадров.
  private skinBBoxCpu: Float32Array; // RGBA32F per owner: minX,minY,maxX,maxY (загружается в skinBBoxTex)
  private needSkinBBox = false; // есть ли хоть один stretch-скин
  private skinBBoxThrottle = 0;
  private bboxDirty = true; // территории менялись с прошлого скана AABB

  private vao: WebGLVertexArrayObject;
  private tileTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private patternMetaTex: WebGLTexture;
  private patternDataTex: WebGLTexture;
  private skinAtlasTex: WebGLTexture;
  private skinLayerTex: WebGLTexture;
  private skinAnchorTex: WebGLTexture;
  private skinParamsTex: WebGLTexture;
  private skinBBoxTex: WebGLTexture;
  private defenseCoverageTex: WebGLTexture | null = null;
  private borderTex: WebGLTexture | null = null;

  // terron: скины пепла — R16UI «чей пепел» (smallID | skinIdx<<12) per tile.
  // Своя текстура пасса (не GPUResources): ленивая, 1×1-заглушка до первой
  // ядерки (как trail/heat — не платим 2 Б/px в мирных матчах). Источник —
  // живой буфер view/GameView, льём грязными строками.
  private falloutOwnerTex: WebGLTexture;
  private falloutOwnerFull = false;
  private falloutOwnerRef: Uint16Array | null = null;
  private foDirtyRowMin = Infinity;
  private foDirtyRowMax = -1;

  private altView = false;
  private showPatterns = true;

  /** CPU-side tile state — what is currently on the GPU (display state). */
  private cpuTileState: Uint16Array;
  private tilesDirty = false;

  /**
   * True after a full state replacement (initial load / seek). flushTileTexture
   * uploads the full cpuTileState via texSubImage2D and discards any queued
   * scatter patches — those are already covered by the full upload.
   */
  private fullUploadPending = false;

  /**
   * GPU scatter pass for per-frame patches. Replaces the old dirty-row bbox
   * upload — constant cost regardless of how spatially scattered patches are.
   */
  private scatter!: TileScatterPass;

  /**
   * Hook for forwarding tile changes to the border-compute pipeline so it can
   * incrementally repaint affected tiles instead of rebuilding the whole map.
   * Wired by the renderer to `borderPass.patchTile`.
   */
  private borderPatchConsumer: ((x: number, y: number) => void) | null = null;

  /**
   * Drip buckets — round-robin staggering of tile updates across render frames.
   * Each incoming change is hashed by tile ref to a fixed bucket (stable hash
   * preserves per-tile ordering across ticks). One bucket drains per render
   * frame, giving a ~bucketCount-frame buffer that smooths over network jitter.
   *
   * Each bucket is a flat number[] with interleaved [ref, state, ref, state, …]
   * pairs — avoids per-tile object allocation on the hot push path.
   */
  private readonly nBuckets: number;
  private dripBuckets: number[][] = [];
  private currentBucket = 0;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    paletteTex: WebGLTexture,
    patternMetaTex: WebGLTexture,
    patternDataTex: WebGLTexture,
    skinAtlasTex: WebGLTexture,
    skinLayerTex: WebGLTexture,
    skinAnchorTex: WebGLTexture,
    skinParamsTex: WebGLTexture,
    skinBBoxTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.paletteTex = paletteTex;
    this.patternMetaTex = patternMetaTex;
    this.patternDataTex = patternDataTex;
    this.skinAtlasTex = skinAtlasTex;
    this.skinLayerTex = skinLayerTex;
    this.skinAnchorTex = skinAnchorTex;
    this.skinParamsTex = skinParamsTex;
    this.skinBBoxTex = skinBBoxTex;
    this.skinBBoxCpu = new Float32Array(getPaletteSize() * 4);
    this.cpuTileState = new Uint16Array(mapW * mapH);

    this.nBuckets = Math.max(1, settings.tileDrip.bucketCount | 0);
    for (let i = 0; i < this.nBuckets; i++) this.dripBuckets.push([]);

    this.program = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(territoryFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        ...TILE_DEFINES,
      }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;
    this.uStaleNukeBase = gl.getUniformLocation(
      this.program,
      "uStaleNukeBase",
    )!;
    this.uStaleNukeVariation = gl.getUniformLocation(
      this.program,
      "uStaleNukeVariation",
    )!;
    this.uStaleNukeAlpha = gl.getUniformLocation(
      this.program,
      "uStaleNukeAlpha",
    )!;
    this.uStaleNukeColor = gl.getUniformLocation(
      this.program,
      "uStaleNukeColor",
    )!;
    this.uHighlightOwner = gl.getUniformLocation(
      this.program,
      "uHighlightOwner",
    )!;
    this.uHighlightBrighten = gl.getUniformLocation(
      this.program,
      "uHighlightBrighten",
    )!;
    this.uShowPatterns = gl.getUniformLocation(this.program, "uShowPatterns")!;
    this.uIsTeamMode = gl.getUniformLocation(this.program, "uIsTeamMode")!;
    this.uDefenseDarken = gl.getUniformLocation(
      this.program,
      "uDefenseDarken",
    )!;
    this.uSkinTrueColor = gl.getUniformLocation(
      this.program,
      "uSkinTrueColor",
    )!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPatternMeta"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPatternData"), 3);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSkinAtlas"), 4);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSkinLayer"), 5);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSkinAnchor"), 6);
    gl.uniform1i(gl.getUniformLocation(this.program, "uDefenseCoverageTex"), 7);
    gl.uniform1i(gl.getUniformLocation(this.program, "uBorderTex"), 8);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSkinParams"), 9);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSkinBBoxTex"), 10);
    gl.uniform1i(gl.getUniformLocation(this.program, "uFalloutOwnerTex"), 11);

    // terron: скины пепла — заглушка 1×1 (шейдер читает 0 → классический пепел).
    this.falloutOwnerTex = createTexture2D(gl, {
      width: 1,
      height: 1,
      internalFormat: gl.R16UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_SHORT,
      data: null,
      filter: gl.NEAREST,
    });

    this.vao = createMapQuad(gl, mapW, mapH);

    this.scatter = new TileScatterPass(gl, mapW, mapH, tileTex);
  }

  // ---------------------------------------------------------------------------
  // Tile data upload
  // ---------------------------------------------------------------------------

  /** Full tile state upload (on seek). */
  uploadFullTileState(tileState: Uint16Array): void {
    this.cpuTileState.set(tileState);
    this.clearDripBuckets();
    this.scatter.clear();
    this.fullUploadPending = true;
    this.tilesDirty = true;
  }

  /** Live-game path: snapshot the initial tile state and clear pending drip. */
  setLiveRef(tileState: Uint16Array): void {
    this.cpuTileState.set(tileState);
    this.clearDripBuckets();
    this.scatter.clear();
    this.fullUploadPending = true;
    this.tilesDirty = true;
  }

  /**
   * Wire a consumer that will be called once per tile coordinate change while
   * scatter mode is active (i.e., not during a full upload). The renderer
   * hooks this to `borderPass.patchTile` so border recompute scales with the
   * number of changed tiles instead of full map area.
   */
  setBorderPatchConsumer(fn: (x: number, y: number) => void): void {
    this.borderPatchConsumer = fn;
  }

  /** Apply tile deltas (during playback). */
  uploadDeltaTiles(changedTiles: TilePair[]): void {
    const ts = this.cpuTileState;
    const w = this.mapW;
    const pending = this.fullUploadPending;
    const borderFn = this.borderPatchConsumer;
    for (let i = 0; i < changedTiles.length; i++) {
      const tp = changedTiles[i];
      ts[tp.ref] = tp.state;
      if (!pending) {
        const x = tp.ref % w;
        const y = (tp.ref - x) / w;
        this.scatter.push(x, y, tp.state);
        if (borderFn) borderFn(x, y);
      }
    }
    this.tilesDirty = true;
  }

  // terron ПЕРФ (память, 12.07): корзины дренируются только в draw() — а draw
  // гейтится активностью/видимостью. Фоновая вкладка / залоченный телефон в
  // разгаре матча = корзины растут БЕЗ ПРЕДЕЛА (замерено 3.2М пар ≈ 25МБ за
  // ~15 минут фона) + флуд скаттера на возврате. Превысили бюджет — дешевле
  // схлопнуть всё в ПОЛНЫЙ аплоад (uploadFullTileState чистит корзины, draw
  // сделает один texSubImage всей карты + full-recompute границ).
  private static readonly DRIP_QUEUE_CAP = 200_000;
  private queuedDripPairs = 0;

  /**
   * Live delta: dispatch each changed tile into a round-robin drip bucket.
   * Stable per-ref hash means repeated updates to the same tile stay in
   * arrival order in the same bucket — last write wins when drained.
   */
  applyLiveDelta(tileState: Uint16Array, changedTiles: TilePair[]): void {
    this.queuedDripPairs += changedTiles.length;
    if (this.queuedDripPairs > TerritoryPass.DRIP_QUEUE_CAP) {
      // Рендер спит и очередь распухла — переключаемся на полный аплоад.
      this.uploadFullTileState(tileState);
      return;
    }
    const N = this.nBuckets;
    const buckets = this.dripBuckets;
    for (let i = 0; i < changedTiles.length; i++) {
      const ref = changedTiles[i].ref;
      const b = ((ref * 2654435761) >>> 0) % N;
      buckets[b].push(ref, tileState[ref]);
    }
  }

  // terron: скины пепла — дельта строк буфера «чей пепел». Первая ядерка
  // раздувает 1×1-заглушку до карты; заливаем только грязные строки: новая
  // текстура = нули, CPU-буфер вне этих строк тоже нули (8 МБ целиком на
  // большой карте = заметный фриз в момент первого взрыва).
  applyFalloutOwnerDelta(
    falloutOwnerState: Uint16Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
  ): void {
    this.falloutOwnerRef = falloutOwnerState;
    if (!this.falloutOwnerFull) {
      this.falloutOwnerFull = true;
      const gl = this.gl;
      gl.deleteTexture(this.falloutOwnerTex);
      this.falloutOwnerTex = createTexture2D(gl, {
        width: this.mapW,
        height: this.mapH,
        internalFormat: gl.R16UI,
        format: gl.RED_INTEGER,
        type: gl.UNSIGNED_SHORT,
        data: null,
        filter: gl.NEAREST,
      });
    }
    if (dirtyRowMin < this.foDirtyRowMin) this.foDirtyRowMin = dirtyRowMin;
    if (dirtyRowMax > this.foDirtyRowMax) this.foDirtyRowMax = dirtyRowMax;
  }

  /** terron: скины пепла — флаш грязных строк в GPU (зовётся из draw). */
  private flushFalloutOwnerTexture(): void {
    if (!this.falloutOwnerFull || this.foDirtyRowMax < 0) return;
    const src = this.falloutOwnerRef;
    if (!src) return;
    const gl = this.gl;
    const minRow = Math.max(0, this.foDirtyRowMin);
    const rowCount = Math.min(this.mapH - 1, this.foDirtyRowMax) - minRow + 1;
    if (rowCount <= 0) return;
    const offset = minRow * this.mapW;
    // Работаем на юните 11 (родном для этой текстуры): флаш зовётся из draw()
    // ПОСЛЕ привязки tileTex к юниту 0 — трогать TEXTURE0 здесь нельзя.
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.falloutOwnerTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      minRow,
      this.mapW,
      rowCount,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      src.subarray(offset, offset + rowCount * this.mapW),
    );
    this.foDirtyRowMin = Infinity;
    this.foDirtyRowMax = -1;
  }

  /** Drain one drip bucket into cpuTileState. Called once per render frame. */
  drainDripBucket(): void {
    const bucket = this.dripBuckets[this.currentBucket];
    if (bucket.length > 0) {
      this.queuedDripPairs = Math.max(
        0,
        this.queuedDripPairs - (bucket.length >> 1),
      );
      const ts = this.cpuTileState;
      const w = this.mapW;
      const pending = this.fullUploadPending;
      const borderFn = this.borderPatchConsumer;
      for (let i = 0; i < bucket.length; i += 2) {
        const ref = bucket[i];
        const state = bucket[i + 1];
        ts[ref] = state;
        if (!pending) {
          const x = ref % w;
          const y = (ref - x) / w;
          this.scatter.push(x, y, state);
          if (borderFn) borderFn(x, y);
        }
      }
      bucket.length = 0;
      this.tilesDirty = true;
    }
    this.currentBucket = (this.currentBucket + 1) % this.nBuckets;
  }

  /**
   * Drain every drip bucket immediately. Used during spawn phase and after
   * seek so tile state pops to current sim state without the 60Hz stagger.
   */
  flushAllDripBuckets(): void {
    let any = false;
    const ts = this.cpuTileState;
    const w = this.mapW;
    const pending = this.fullUploadPending;
    const borderFn = this.borderPatchConsumer;
    for (let b = 0; b < this.nBuckets; b++) {
      const bucket = this.dripBuckets[b];
      if (bucket.length === 0) continue;
      any = true;
      for (let i = 0; i < bucket.length; i += 2) {
        const ref = bucket[i];
        const state = bucket[i + 1];
        ts[ref] = state;
        if (!pending) {
          const x = ref % w;
          const y = (ref - x) / w;
          this.scatter.push(x, y, state);
          if (borderFn) borderFn(x, y);
        }
      }
      bucket.length = 0;
    }
    if (any) {
      this.tilesDirty = true;
    }
    this.queuedDripPairs = 0;
  }

  private clearDripBuckets(): void {
    for (let b = 0; b < this.nBuckets; b++) this.dripBuckets[b].length = 0;
    this.currentBucket = 0;
    this.queuedDripPairs = 0;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Get ownerID at a tile reference. Returns 0 for unowned.
   * Reads display state (post-drip), so queries match what's visible.
   */
  getOwnerAt(tileRef: number): number {
    const ts = this.cpuTileState;
    if (tileRef < 0 || tileRef >= ts.length) return 0;
    return ts[tileRef] & OWNER_MASK;
  }

  /** AABB of all tiles owned by ownerID. */
  /** AABB территории одного владельца (для фокуса камеры). O(карта). */
  getBBoxForOwner(
    ownerID: number,
  ): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const w = this.mapW;
    const ts = this.cpuTileState;
    for (let i = 0; i < ts.length; i++) {
      if ((ts[i] & OWNER_MASK) === ownerID) {
        const x = i % w;
        const y = (i - x) / w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
  }

  /** terron виральность: включить пересчёт per-owner AABB (нужно для stretch mode 2). */
  setNeedSkinBBox(need: boolean): void {
    this.needSkinBBox = need;
  }

  /**
   * terron виральность: один проход по карте → AABB ВСЕХ владельцев → в skinBBoxTex.
   * Заменяет старый O(карта)-на-владельца. Шейдер читает bbox только для stretch-владельцев.
   */
  private computeAllBBoxes(): void {
    const ts = this.cpuTileState;
    const w = this.mapW;
    const bb = this.skinBBoxCpu;
    for (let o = 0; o < bb.length; o += 4) {
      bb[o] = 1e9;
      bb[o + 1] = 1e9;
      bb[o + 2] = -1e9;
      bb[o + 3] = -1e9;
    }
    const maxOwner = bb.length / 4;
    for (let i = 0; i < ts.length; i++) {
      const owner = ts[i] & OWNER_MASK;
      if (owner === 0 || owner >= maxOwner) continue;
      const off = owner * 4;
      const x = i % w;
      const y = (i - x) / w;
      if (x < bb[off]) bb[off] = x;
      if (y < bb[off + 1]) bb[off + 1] = y;
      if (x + 1 > bb[off + 2]) bb[off + 2] = x + 1; // +1: AABB включает дальний тайл
      if (y + 1 > bb[off + 3]) bb[off + 3] = y + 1;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.skinBBoxTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      getPaletteSize(),
      1,
      gl.RGBA,
      gl.FLOAT,
      bb,
    );
  }

  // ---------------------------------------------------------------------------
  // GPU flush + draw
  // ---------------------------------------------------------------------------

  /**
   * Flush tile texture to GPU early (before heat update reads it).
   * Return value lets the renderer decide what downstream invalidation is
   * needed — full uploads require a full border recompute, scatter uploads
   * already pushed per-tile border patches via `borderPatchConsumer`.
   */
  flushTileTexture(): "none" | "full" | "scatter" {
    if (!this.tilesDirty) return "none";
    // terron: тайлы реально меняются → AABB зон устарел (для stretch-скинов mode 2).
    // Ставим флаг ЗДЕСЬ, а не по возвращаемому значению в draw(): flushTileTexture
    // зовётся РАНО в кадре (Renderer, для границ/heat) и сбрасывает tilesDirty — к
    // моменту draw() он уже "none", и bboxDirty не взводился → bbox застревал на
    // стартовой зоне, флаг покрывал лишь спавн-тайл, остальное = CLAMP к краю.
    this.bboxDirty = true;
    const gl = this.gl;

    if (this.fullUploadPending) {
      // Full upload (first tick, seek, replay full frame, etc.) — supersedes
      // any queued scatter patches.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        this.mapW,
        this.mapH,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        this.cpuTileState,
      );
      this.scatter.clear();
      this.fullUploadPending = false;
      this.tilesDirty = false;
      return "full";
    }
    if (this.scatter.count > 0) {
      // Per-frame patches — scatter via FBO + POINTS draw. Constant cost in
      // patch count regardless of spatial distribution.
      this.scatter.flush();
      this.tilesDirty = false;
      return "scatter";
    }

    this.tilesDirty = false;
    return "none";
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }

  setShowPatterns(show: boolean): void {
    this.showPatterns = show;
  }

  /**
   * Update the skin atlas texture handle. Called once at game start after
   * the renderer learns the locked-in skin URL set.
   */
  setSkinAtlas(tex: WebGLTexture): void {
    this.skinAtlasTex = tex;
  }

  /** Whether this game has teams (controls skin tinting). */
  setTeamMode(isTeamMode: boolean): void {
    this.isTeamMode = isTeamMode;
  }

  /** Set the hovered player's smallID for territory-fill brightening (0 = off). */
  setHighlightOwner(ownerID: number): void {
    this.highlightOwner = ownerID;
  }

  /** Defense-coverage texture (R8) — darkens the fill on defended tiles. */
  setDefenseCoverageTex(tex: WebGLTexture): void {
    this.defenseCoverageTex = tex;
  }

  /** Border flags (RGBA8) — used to skip the defense darken on border tiles. */
  setBorderTex(tex: WebGLTexture): void {
    this.borderTex = tex;
  }

  /** Draw territory fill + stale-nuke ground. Blending must be enabled by caller. */
  draw(cameraMatrix: Float32Array): void {
    // flushTileTexture сам взводит bboxDirty, когда реально флашит тайлы (см. там).
    this.flushTileTexture();

    const gl = this.gl;
    const mo = this.settings.mapOverlay;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1i(this.uAltView, this.altView ? 1 : 0);
    gl.uniform1f(this.uStaleNukeBase, mo.staleNukeBase);
    gl.uniform1f(this.uStaleNukeVariation, mo.staleNukeVariation);
    gl.uniform1f(this.uStaleNukeAlpha, mo.staleNukeAlpha);
    gl.uniform3f(
      this.uStaleNukeColor,
      mo.staleNukeR,
      mo.staleNukeG,
      mo.staleNukeB,
    );
    gl.uniform1ui(this.uHighlightOwner, this.highlightOwner);
    gl.uniform1f(this.uHighlightBrighten, mo.highlightFillBrighten);
    gl.uniform1i(
      this.uShowPatterns,
      this.settings.passEnabled.territoryPatterns && this.showPatterns ? 1 : 0,
    );
    gl.uniform1i(this.uIsTeamMode, this.isTeamMode ? 1 : 0);
    gl.uniform1f(this.uDefenseDarken, mo.territoryDefenseDarken);

    // terron: тоггл «истинные цвета скина» (читаем из настроек, кэш в памяти).
    gl.uniform1i(
      this.uSkinTrueColor,
      this.userSettings.skinTrueColors() ? 1 : 0,
    );
    // terron виральность: per-owner AABB для stretch-скинов. Скан карты ТОЛЬКО когда
    // территории менялись (bboxDirty) и не чаще раза в ~20 кадров → не лагаем.
    if (this.needSkinBBox && this.bboxDirty && this.skinBBoxThrottle-- <= 0) {
      this.skinBBoxThrottle = 20;
      this.computeAllBBoxes();
      this.bboxDirty = false;
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.patternMetaTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.patternDataTex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.skinAtlasTex);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.skinLayerTex);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.skinAnchorTex);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.skinParamsTex);
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, this.skinBBoxTex);
    // terron: скины пепла — дольём грязные строки и привяжем.
    this.flushFalloutOwnerTexture();
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.falloutOwnerTex);
    if (this.defenseCoverageTex) {
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, this.defenseCoverageTex);
    }
    if (this.borderTex) {
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, this.borderTex);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    this.scatter.dispose();
    // terron: скины пепла — текстура наша (не GPUResources), чистим сами.
    gl.deleteTexture(this.falloutOwnerTex);
    // tileTex, paletteTex, patternMetaTex, patternDataTex owned by GPUResources / renderer
  }
}

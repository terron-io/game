/**
 * StructurePass — GPU-rendered structures with icon sprites.
 *
 * Renders a filled circle in player color with a white icon overlay,
 * sampled from a pre-built 6-column sprite atlas (generate-sprite-atlases.mjs).
 *
 * Two LODs based on zoom:
 *   - zoom > 0.5: full icon with circle background
 *   - zoom <= 0.5: smaller dots (no icon detail)
 *
 * One instanced draw call per frame.
 *
 * Data flow:
 *   FrameSnapshot.units → filter structures → instance VBO → GPU
 */

import type { GhostPreviewData, RendererConfig, UnitState } from "../../types";
import {
  UT_AIR_COMMAND,
  UT_AIRPORT,
  UT_CENTRAL_BANK,
  UT_CITY,
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_FORTIFICATIONS,
  UT_MEDIA,
  UT_MINING,
  UT_MINISTRY,
  UT_MISSILE_SILO,
  UT_NUCLEAR_FACTORY,
  UT_OIL_RIG,
  UT_OUR_SKY,
  UT_PORT,
  UT_RELIGION,
  UT_REVANCHISM,
  UT_RIVERS_BACK,
  UT_SAM_LAUNCHER,
  UT_SUBMARINE_BASE,
  UT_TANK_FACTORY,
  UT_PIRACY,
  UT_RAIL_GUN,
  UT_SPACEPORT,
  UT_CLOSED_COUNTRY,
  UT_PRIDE,
  UT_OLYMPICS,
  UT_FANATICISM,
  UT_VICTORY_BANNER,
  UT_PEACE_PALACE,
  UT_GREENS,
  UT_NUCLEAR_PLANT,
  UT_FUEL,
  UT_PEACEFUL_SKY,
  UT_INDUSTRIAL_REVOLUTION,
  UT_SECRET_TREASURE,
  UT_TRAIN_DEPOT,
  UT_WALKING_CITY,
} from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize } from "../utils/ColorUtils";
import { createProgram, shaderSrc } from "../utils/GlUtils";

import { ULTIMATE_REGISTRY } from "../../../../core/game/Game";
import { assetUrl } from "src/core/AssetUrls";
import structureFragSrc from "../shaders/structure/structure.frag.glsl?raw";
import structureVertSrc from "../shaders/structure/structure.vert.glsl?raw";

const iconAtlasUrl = assetUrl("atlases/icon-atlas.png");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Structure types in atlas column order.
 * Index = atlas column index.
 */
const STRUCTURE_ORDER = [
  UT_CITY,
  UT_PORT,
  UT_FACTORY,
  UT_DEFENSE_POST,
  UT_SAM_LAUNCHER,
  UT_MISSILE_SILO,
  UT_AIRPORT, // terron: авиация — колонка 6 в icon-atlas (треугольник авто, index≥5)
  // terron: ультимейты — колонки 7-11; в шейдере index>6.5 → ЗВЕЗДА-фон
  // (scale ×2 задаётся в render-settings.shapes). new-units/ULTIMATES.md
  UT_MINISTRY, // 7 — шпиль с тарелкой
  UT_FORTIFICATIONS, // 8 — башня с зубцами
  UT_CENTRAL_BANK, // 9 — банк с колоннами
  UT_AIR_COMMAND, // 10 — истребитель топ-даун
  UT_TANK_FACTORY, // 11 — танк в профиль
  UT_RELIGION, // 12 — купольный храм (абстрактный, без религ. символов)
  UT_MINING, // 13 — морская мина (шар с шипами)
  UT_REVANCHISM, // 14 — статуя-монумент (фигура с поднятой рукой)
  UT_OUR_SKY, // 15 — спутник (Небо наше: корпус-ромб + панели + тарелка)
  UT_MEDIA, // 16 — рупор МЕДИА (плейсхолдер-мегафон)
  UT_NUCLEAR_FACTORY, // 17 — Ядерный завод (градирни + атом)
  UT_RIVERS_BACK, // 18 — «Реки вспять» (плотина с волной)
  UT_OIL_RIG, // 19 — нефтяная вышка (ульта: звезда ×2, как у прочих)
  UT_SUBMARINE_BASE, // 20 — подводный флот (подлодка с перископом)
  UT_RAIL_GUN, // 21 — Дора: ствол на ж/д платформе (была алиасом на танк —
  // на карте орудие выглядело танком, репорт владельца 23.08)
  // terron 23.08: ПИРАТСТВО — СВОЯ колонка 22 (череп с костями). Раньше
  // штаб делил колонку с Подводным флотом, и на карте у пирата стояла
  // иконка ПОДЛОДКИ (репорт владельца).
  UT_PIRACY,
  // terron 23.08: КОСМОДРОМ — СВОЯ колонка 23 (ракета). Была алиасом на
  // нефтяную вышку, и на карте площадка выглядела ЧУЖИМ зданием — репорт
  // владельца «вместо своей иконки чужая».
  UT_SPACEPORT,
  // terron 23.08 (репорт владельца «какого хуя у нас ещё есть ульты с
  // заглушками вместо спрайтов?»): колонки 24-33 — СВОИ картинки тем ультам,
  // что делили чужие. Порядок обязан совпадать с порядком колонок в
  // icon-atlas.png (см. scripts, атлас перерисован в этом же заходе).
  UT_CLOSED_COUNTRY,
  UT_PRIDE,
  UT_OLYMPICS,
  UT_FANATICISM,
  UT_VICTORY_BANNER,
  UT_PEACE_PALACE,
  UT_GREENS,
  UT_NUCLEAR_PLANT,
  UT_FUEL,
  UT_PEACEFUL_SKY,
  // terron 23.08: ВРЕМЕННОЕ БАФ-ЗДАНИЕ «Индустриальная революция» (колонка 34).
  // Это не постройка, а МАРКЕР эффекта: та же звезда, что у ульт, но живёт
  // ровно длительность эффекта и показывает отсчёт. new-units/FUEL.md
  UT_INDUSTRIAL_REVOLUTION,
  // terron 23.08: СЕКРЕТНЫЙ КРУГ «клад» (код 1337) — колонка 35, кольцо.
  UT_SECRET_TREASURE,
  // terron 24.08 (репорт владельца «почему это не выглядит как ульта»): у ДЕПО
  // СМЕРТИ теперь СВОЯ колонка (ангар с воротами и путями). С алиасом на
  // фабрику оно рисовалось обычным зданием — без звезды-подложки, которая и
  // означает «это ульта».
  UT_TRAIN_DEPOT,
  // terron 24.08: ШАГАЮЩИЙ ГОРОД — колонка 36 (дом на двух ногах),
  // new-units/gen-walking-assets.py. Спека WALKING.md.
  UT_WALKING_CITY,
] as const;

const ATLAS_COLS = STRUCTURE_ORDER.length;

/**
 * terron 23.08: тип → донор колонки атласа. ВЫВОДИТСЯ ИЗ ULTIMATE_REGISTRY.
 *
 * ⚠️ Раньше это был ручной список, и именно тут жил баг: Доре поставили алиас
 * на колонку Танкового завода, и на карте железнодорожное орудие выглядело
 * танком. Теперь донор объявляется В РЕЕСТРЕ (`atlas: { alias: ... }`) рядом с
 * самой ультой, а не в отдельном списке, о котором надо помнить.
 * Касты наследуют колонку так же — у них своё поле atlas в записи каста.
 */
const STRUCTURE_ATLAS_ALIASES: [string, string][] = ULTIMATE_REGISTRY.flatMap(
  (u) => {
    const out: [string, string][] = [];
    if ("alias" in u.atlas) out.push([u.type as string, u.atlas.alias as string]);
    if (u.cast !== undefined && "alias" in u.cast.atlas) {
      out.push([u.cast.type as string, u.cast.atlas.alias as string]);
    }
    return out;
  },
);

// ---------------------------------------------------------------------------
// Instance data layout
// ---------------------------------------------------------------------------

// Per-instance: x, y, ownerID, underConstruction, atlasIdx, markedForDeletion,
// level (terron: форты растут размером по уровню — см. шейдер + uFortIdx),
// isCapital (terron: СТОЛИЦЫ — золотой тинт City, см. шейдер). CAPITALS.md
const FLOATS_PER_INSTANCE = 8;
// terron: сглаживание движущихся строений — длительность тика симуляции и
// потолок шага, который вообще имеет смысл сглаживать (в тайлах).
const MOTION_TICK_MS = 100;
const MOTION_MAX_STEP = 4;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

// ---------------------------------------------------------------------------
// StructurePass
// ---------------------------------------------------------------------------

/** terron ПЕРФ (08.08): источники для прогрева программ, см. ProgramRegistry.
 *  ATLAS_COLS приватен модулю — берём отсюда, а не дублируем в реестре. */
export function structureProgramSources(): [string, string] {
  return [
    shaderSrc(structureVertSrc, { ATLAS_COLS }),
    shaderSrc(structureFragSrc, { PALETTE_SIZE: getPaletteSize(), ATLAS_COLS }),
  ];
}

export class StructurePass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;

  private uCamera: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uIconSize: WebGLUniformLocation;
  private uDotsThreshold: WebGLUniformLocation;
  private uDotScale: WebGLUniformLocation;
  private uScaleFactor: WebGLUniformLocation;
  private uIconGrowZoom: WebGLUniformLocation;
  private uShapeScales: WebGLUniformLocation;
  private uFortIdx: WebGLUniformLocation; // terron: колонка фортов (рост по уровню)
  private uIconFills: WebGLUniformLocation;
  private uGhostAlpha: WebGLUniformLocation;
  private uOutlineColor: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;
  private uHighlightMask: WebGLUniformLocation;
  private uHighlightOutlineW: WebGLUniformLocation;
  private uHighlightDimAlpha: WebGLUniformLocation;
  private uFillDarken: WebGLUniformLocation;
  private uBorderDarken: WebGLUniformLocation;
  private uIconAlpha: WebGLUniformLocation;
  private uIconColor: WebGLUniformLocation;

  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private ghostInstanceBuf: WebGLBuffer;

  private paletteTex: WebGLTexture;
  private atlasTex: WebGLTexture;
  private affiliationTex: WebGLTexture | null = null;
  private altView = false;

  private instanceCount = 0;
  // terron 23.08 (репорт владельца «дёргает Дору прилично»): СГЛАЖИВАНИЕ
  // ДВИЖУЩИХСЯ строений. Симуляция идёт 10 раз в секунду, и здание, которое
  // ездит (сейчас это только Дора), прыгало тайлами — на зуме это рывки.
  // Инстансы строений заливаются РАЗ В ТИК, поэтому тут отдельный список
  // «кто едет»: их слоты дозаписываются каждый кадр промежуточной позицией.
  // Обычные (неподвижные) здания в этот список не попадают — ноль накладных.
  private readonly slotById = new Map<number, number>();
  private readonly motion = new Map<
    number,
    { fx: number; fy: number; tx: number; ty: number; t0: number }
  >();
  private readonly lastPosById = new Map<number, number>();

  /** unitType string → atlas column index (0–5) */
  private typeToAtlasCol = new Map<string, number>();
  private mapW: number;

  /** Build-button hover highlight: bitmask of atlas columns (0 = off). */
  private highlightMask = 0;

  /** Ghost preview state (null = no ghost). */
  private ghost: GhostPreviewData | null = null;
  /** Scratch buffer for the single ghost instance (avoids allocation). */
  private ghostBuf = new Float32Array(FLOATS_PER_INSTANCE);

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    paletteTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = header.mapWidth;
    this.paletteTex = paletteTex;

    // Build unitType string → atlas column mapping
    for (let i = 0; i < header.unitTypes.length; i++) {
      const col = STRUCTURE_ORDER.indexOf(
        header.unitTypes[i] as (typeof STRUCTURE_ORDER)[number],
      );
      if (col >= 0) {
        this.typeToAtlasCol.set(header.unitTypes[i], col);
      }
    }
    // terron: АЛИАСЫ КОЛОНОК — типы без своей колонки в icon-atlas делят
    // спрайт (и scale из shapes) с чужой. STRUCTURE_ORDER = развёртка реального
    // PNG, новая колонка потребовала бы перегенерации атласа.
    for (const [type, donor] of STRUCTURE_ATLAS_ALIASES) {
      // Донор приходит строкой из реестра — ищем его колонку по значению.
      // Нет донора в STRUCTURE_ORDER = алиас указывает в пустоту: это ошибка
      // записи реестра, и её ловит тест UltimateWiring (не молчим здесь).
      const col = (STRUCTURE_ORDER as readonly string[]).indexOf(donor);
      if (col >= 0) this.typeToAtlasCol.set(type, col);
    }

    // Compile shaders
    this.program = createProgram(gl, ...structureProgramSources());
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uIconSize = gl.getUniformLocation(this.program, "uIconSize")!;
    this.uDotScale = gl.getUniformLocation(this.program, "uDotScale")!;
    this.uDotsThreshold = gl.getUniformLocation(
      this.program,
      "uDotsThreshold",
    )!;
    this.uScaleFactor = gl.getUniformLocation(this.program, "uScaleFactor")!;
    this.uIconGrowZoom = gl.getUniformLocation(this.program, "uIconGrowZoom")!;
    this.uShapeScales = gl.getUniformLocation(this.program, "uShapeScales")!;
    this.uFortIdx = gl.getUniformLocation(this.program, "uFortIdx")!;
    this.uIconFills = gl.getUniformLocation(this.program, "uIconFills")!;
    this.uGhostAlpha = gl.getUniformLocation(this.program, "uGhostAlpha")!;
    this.uOutlineColor = gl.getUniformLocation(this.program, "uOutlineColor")!;
    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;
    this.uHighlightMask = gl.getUniformLocation(
      this.program,
      "uHighlightMask",
    )!;
    this.uHighlightOutlineW = gl.getUniformLocation(
      this.program,
      "uHighlightOutlineW",
    )!;
    this.uHighlightDimAlpha = gl.getUniformLocation(
      this.program,
      "uHighlightDimAlpha",
    )!;
    this.uFillDarken = gl.getUniformLocation(this.program, "uFillDarken")!;
    this.uBorderDarken = gl.getUniformLocation(this.program, "uBorderDarken")!;
    this.uIconAlpha = gl.getUniformLocation(this.program, "uIconAlpha")!;
    this.uIconColor = gl.getUniformLocation(this.program, "uIconColor")!;

    // Texture unit bindings + ghost defaults
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAffiliation"), 2);
    gl.uniform1f(this.uGhostAlpha, 1.0);
    gl.uniform3f(this.uOutlineColor, 0, 0, 0);
    gl.uniform1i(this.uHighlightMask, 0);

    // Create placeholder atlas texture (1×1 white pixel)
    // Replaced asynchronously once SVGs load
    this.atlasTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Start async atlas build
    this.loadAtlas();

    // --- Instance buffers ---
    const instanceGlBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      instanceGlBuf,
      2048,
      FLOATS_PER_INSTANCE,
    );

    // Separate tiny buffer for ghost (avoids corrupting real instance data)
    this.ghostInstanceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostInstanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, BYTES_PER_INSTANCE, gl.DYNAMIC_DRAW);

    // --- VAO ---
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Attribute 0: unit quad [0,0]→[1,1]
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Attribute 1: per-instance vec4 (x, y, ownerID, underConstruction)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: per-instance vec4 (atlasIdx, markedForDeletion, level, isCapital)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  private async loadAtlas(): Promise<void> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = iconAtlasUrl;
    await img.decode();
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
  }

  updateStructures(units: Map<number, UnitState>): void {
    let count = 0;
    this.slotById.clear();
    const alive = new Set<number>();

    for (const unit of units.values()) {
      if (!unit.isActive) continue;
      const atlasIdx = this.typeToAtlasCol.get(unit.unitType);
      if (atlasIdx === undefined) continue;

      this.instanceBuf.ensureCapacity(count + 1);

      const off = count * FLOATS_PER_INSTANCE;
      const x = unit.pos % this.mapW;
      const y = (unit.pos - x) / this.mapW;

      // Сдвинулось с прошлого тика на НЕБОЛЬШОЕ расстояние — значит едет, и
      // между тиками его надо доводить плавно. Большой скачок (телепорт,
      // перестройка, первый показ) сглаживать нельзя: смазало бы через пол-карты.
      alive.add(unit.id);
      this.slotById.set(unit.id, count);
      const prev = this.lastPosById.get(unit.id);
      this.lastPosById.set(unit.id, unit.pos);
      if (prev !== undefined && prev !== unit.pos) {
        const px = prev % this.mapW;
        const py = (prev - px) / this.mapW;
        if (Math.abs(px - x) <= MOTION_MAX_STEP && Math.abs(py - y) <= MOTION_MAX_STEP) {
          this.motion.set(unit.id, {
            fx: px,
            fy: py,
            tx: x,
            ty: y,
            t0: performance.now(),
          });
        } else {
          this.motion.delete(unit.id);
        }
      }

      this.instanceBuf.float32[off + 0] = x;
      this.instanceBuf.float32[off + 1] = y;
      this.instanceBuf.float32[off + 2] = unit.ownerID;
      this.instanceBuf.float32[off + 3] = unit.underConstruction ? 1 : 0;
      this.instanceBuf.float32[off + 4] = atlasIdx;
      this.instanceBuf.float32[off + 5] =
        unit.markedForDeletion !== false ? 1 : 0;
      // terron: уровень (форты растут размером; прочие типы шейдер не масштабирует).
      this.instanceBuf.float32[off + 6] = unit.level;
      // terron: СТОЛИЦЫ — золотой тинт City (шейдер красит при isCapital>0.5).
      this.instanceBuf.float32[off + 7] = unit.isCapital ? 1 : 0;

      count++;
    }

    this.instanceCount = count;
    for (const id of this.lastPosById.keys()) {
      if (alive.has(id)) continue;
      this.lastPosById.delete(id);
      this.motion.delete(id);
    }

    if (count > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.instanceBuf.float32,
        0,
        count * FLOATS_PER_INSTANCE,
      );
    }
  }

  /**
   * terron: доводит позиции ЕДУЩИХ строений между тиками (см. поле motion).
   * Дописывает только их слоты — по 8 байт на здание, обычно одно на всю карту.
   */
  private applyMotion(): void {
    if (this.motion.size === 0) return;
    const gl = this.gl;
    const now = performance.now();
    let bound = false;
    for (const [id, m] of this.motion) {
      const slot = this.slotById.get(id);
      if (slot === undefined) {
        this.motion.delete(id);
        continue;
      }
      const k = Math.min(1, (now - m.t0) / MOTION_TICK_MS);
      const off = slot * FLOATS_PER_INSTANCE;
      this.instanceBuf.float32[off + 0] = m.fx + (m.tx - m.fx) * k;
      this.instanceBuf.float32[off + 1] = m.fy + (m.ty - m.fy) * k;
      if (!bound) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
        bound = true;
      }
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        off * 4,
        this.instanceBuf.float32,
        off,
        FLOATS_PER_INSTANCE,
      );
      if (k >= 1) this.motion.delete(id);
    }
  }

  updateGhostPreview(data: GhostPreviewData | null): void {
    this.ghost = data;
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }

  /** Highlight structures of the given types (null/empty = off). Dims all other types. */
  setHighlightTypes(unitTypes: string[] | null): void {
    let mask = 0;
    if (unitTypes) {
      for (const t of unitTypes) {
        const col = this.typeToAtlasCol.get(t);
        if (col !== undefined) mask |= 1 << col;
      }
    }
    this.highlightMask = mask;
  }
  setAffiliationTex(tex: WebGLTexture): void {
    this.affiliationTex = tex;
  }

  // terron: туман войны — рендер зданий и госта РАЗНЕСЁН: здания гаснут под
  // фог-композитом, гост рисуется ПОВЕРХ тумана отдельным вызовом (игрок
  // знает, куда ставит). mode: "all" (без тумана), "unitsOnly"/"ghostOnly".
  draw(
    cameraMatrix: Float32Array,
    zoom: number,
    mode: "all" | "unitsOnly" | "ghostOnly" = "all",
  ): void {
    const wantUnits = mode !== "ghostOnly";
    const hasGhost =
      mode !== "unitsOnly" &&
      this.ghost !== null &&
      this.typeToAtlasCol.has(this.ghost.ghostType);
    if ((!wantUnits || this.instanceCount === 0) && !hasGhost) return;

    const gl = this.gl;
    this.applyMotion();
    gl.useProgram(this.program);

    const ss = this.settings.structure;
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uIconSize, ss.iconSize);
    gl.uniform1f(this.uDotsThreshold, ss.dotsZoomThreshold);
    gl.uniform1f(this.uDotScale, ss.dotScale);
    gl.uniform1f(this.uScaleFactor, ss.iconScaleFactorZoomedOut);
    gl.uniform1f(this.uIconGrowZoom, ss.iconGrowZoom);

    // Build per-structure uniform arrays from settings, ordered by atlas column
    const scales = new Float32Array(ATLAS_COLS);
    const fills = new Float32Array(ATLAS_COLS);
    for (let i = 0; i < STRUCTURE_ORDER.length; i++) {
      const cfg = ss.shapes[STRUCTURE_ORDER[i]];
      scales[i] = cfg?.scale ?? 1.0;
      fills[i] = cfg?.iconFill ?? 0.6;
    }
    gl.uniform1fv(this.uShapeScales, scales);
    gl.uniform1fv(this.uIconFills, fills);
    // terron: колонка Укреплений — их иконка растёт с уровнем (см. шейдер).
    gl.uniform1f(this.uFortIdx, STRUCTURE_ORDER.indexOf(UT_FORTIFICATIONS));

    gl.uniform1i(
      this.uAltView,
      this.altView && this.settings.altView.recolorStructures ? 1 : 0,
    );
    gl.uniform1i(this.uHighlightMask, this.highlightMask);
    gl.uniform1f(this.uHighlightOutlineW, ss.highlightOutlineWidth);
    gl.uniform1f(this.uHighlightDimAlpha, ss.highlightDimAlpha);
    gl.uniform1f(this.uFillDarken, ss.fillDarken);
    gl.uniform1f(this.uBorderDarken, ss.borderDarken);
    gl.uniform1f(this.uIconAlpha, ss.iconAlpha);
    gl.uniform3f(this.uIconColor, ss.iconR, ss.iconG, ss.iconB);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);

    if (this.affiliationTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.affiliationTex);
    }

    gl.bindVertexArray(this.vao);

    // --- Real structures ---
    if (wantUnits && this.instanceCount > 0) {
      gl.uniform1f(this.uGhostAlpha, 1.0);
      gl.uniform3f(this.uOutlineColor, 0, 0, 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    }

    // --- Ghost structure (1 translucent instance with outline) ---
    if (hasGhost) {
      const g = this.ghost!;
      const atlasIdx = this.typeToAtlasCol.get(g.ghostType)!;

      // Temporarily rebind instance attrs to ghost buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostInstanceBuf);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);

      // -- Green highlight on existing structure being upgraded --
      if (g.canUpgrade && g.upgradeTargetTile !== null) {
        const tx = g.upgradeTargetTile % this.mapW;
        const ty = (g.upgradeTargetTile - tx) / this.mapW;
        this.ghostBuf[0] = tx;
        this.ghostBuf[1] = ty;
        this.ghostBuf[2] = g.ownerID;
        this.ghostBuf[3] = 0;
        this.ghostBuf[4] = atlasIdx;
        this.ghostBuf[5] = 0;
        this.ghostBuf[6] = 1; // level (превью — базовый размер)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.ghostBuf);

        gl.uniform1f(this.uGhostAlpha, 0.6);
        gl.uniform3f(this.uOutlineColor, 0.0, 0.8, 0.0); // green highlight
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1);
      }

      // -- Ghost icon at cursor --
      this.ghostBuf[0] = g.tileX;
      this.ghostBuf[1] = g.tileY;
      this.ghostBuf[2] = g.ownerID;
      this.ghostBuf[3] = 0;
      this.ghostBuf[4] = atlasIdx;
      this.ghostBuf[5] = 0;
      this.ghostBuf[6] = 1; // level (превью — базовый размер)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.ghostBuf);

      gl.uniform1f(this.uGhostAlpha, 0.5);
      if (g.canUpgrade) {
        gl.uniform3f(this.uOutlineColor, 0.0, 0.8, 0.0); // green tint — upgrade
      } else if (g.canBuild) {
        gl.uniform3f(this.uOutlineColor, 0, 0, 0); // no tint — valid build
      } else {
        gl.uniform3f(this.uOutlineColor, 0.8, 0.2, 0.2); // red tint — can't build
      }
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1);

      // Restore instance attrs to main buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    if (this.ghostInstanceBuf) gl.deleteBuffer(this.ghostInstanceBuf);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.atlasTex);
  }
}

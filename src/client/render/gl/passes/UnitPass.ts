/**
 * UnitPass — GPU-rendered mobile unit sprites.
 *
 * Renders all mobile (non-structure) units: boats, nukes, shells, SAM
 * missiles, and MIRV warheads. All unit types are rotationally symmetric
 * — no rotation needed. Sprites are tiny grayscale PNGs colorized on the
 * GPU using the standard 3-band gray replacement (180/130/70). MIRV
 * Warhead uses a programmatic 3×3 white square (colorized to border
 * color); Shell is a single white pixel.
 *
 * Two instanced draw calls per frame — ground units and missiles are
 * split into separate buffers for correct layer ordering:
 *   Ground/sea (boats, trains) → rendered below structures
 *   Missiles (nukes, shells, SAM, MIRV warheads) → rendered above structures
 *
 * Atlas layout (14 columns × 13px cells; cols 0–11 pre-built by
 * generate-sprite-atlases.mjs, cols 12–13 added by terron aviation PIL script):
 *   Col 0: Transport (5×5)
 *   Col 1: Trade Ship (5×5)
 *   Col 2: Warship (11×11)
 *   Col 3: Atom Bomb (7×7)
 *   Col 4: Hydrogen Bomb (9×9)
 *   Col 5: MIRV (13×13, grayscale colorized)
 *   Col 6: SAM Missile (3×3)
 *   Col 7: Shell (1×1 white pixel)
 *   Col 8: MIRV Warhead (3×3 white square)
 *   Col 9: Train Engine (5×5)
 *   Col 10: Train Carriage (5×5)
 *   Col 11: Train Carriage Loaded (5×5)
 *   Col 12: Airplane (top-down airliner) — terron: авиация
 *   Col 13: Airborne Assault (top-down fighter) — terron: авиация
 *
 * Data flow:
 *   FrameSnapshot.units → filter by typeToAtlasIdx → instance VBO → GPU
 *   Shells emit 2 instances (pos + lastPos) to match live game's 2-pixel trail.
 */

import { assetUrl } from "src/core/AssetUrls";
import type { RendererConfig, UnitState } from "../../types";
import {
  TrainType,
  UT_AIRBORNE_ASSAULT,
  UT_AIRPLANE,
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_DOOM_TRAIN,
  UT_SUICIDE_DRONE,
  UT_TRADE_SHIP,
  UT_TRAIN,
  UT_TRANSPORT,
  UT_WARSHIP,
  UT_WATER_NUKE,

  UT_GREEN_INSPECTION,
} from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import unitFragSrc from "../shaders/unit/unit.frag.glsl?raw";
import unitVertSrc from "../shaders/unit/unit.vert.glsl?raw";
import { getPaletteSize } from "../utils/ColorUtils";
import { createProgram, shaderSrc } from "../utils/GlUtils";
import { ULTIMATE_REGISTRY } from "../../../../core/game/Game";

const unitAtlasUrl = assetUrl("atlases/unit-atlas.png");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Unit types in atlas column order. Index = atlas column.
 *  TrainEngine/TrainCarriage/TrainCarriageLoaded are synthetic names —
 *  they don't match header.unitTypes directly. Train resolution is
 *  handled specially in updateUnits() via trainType + loaded fields.
 */
const UNIT_ORDER = [
  UT_TRANSPORT,
  UT_TRADE_SHIP,
  UT_WARSHIP,
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_MIRV_WARHEAD,
  "TrainEngine",
  "TrainCarriage",
  "TrainCarriageLoaded",
  UT_AIRPLANE, // terron: авиация — колонка 12 в unit-atlas
  UT_AIRBORNE_ASSAULT, // terron: авиация — колонка 13 в unit-atlas
  UT_SUICIDE_DRONE, // terron: авиация — колонка 14 в unit-atlas
  // terron: ПОДЛОДКИ — СИНТЕТИЧЕСКОЕ имя (как TrainEngine): такого типа юнита в
  // движке нет, это тот же Warship со штабом «Подводный флот». Колонка 15.
  "Submarine",
  // terron: ПИРАТСТВО — синтетическое имя: тот же Warship со штабом «Пиратство»,
  // уменьшенный силуэт корабля (колонка 16, сгенерирована из колонки 2 ×0.7).
  "Pirate",
  // terron 24.08 (просьба владельца «надо спрайт вагончика с атомным символом»):
  // СВОЯ колонка 17 у состава смерти. Раньше он ехал спрайтом обычного
  // паровоза и от мирного состава не отличался ничем, кроме отсчёта.
  UT_DOOM_TRAIN,
] as const;

const ATLAS_COLS = UNIT_ORDER.length;

/** terron: ПОДЛОДКИ — колонка спрайта подлодки (см. UNIT_ORDER). */
const SUBMARINE_COL = UNIT_ORDER.indexOf("Submarine");
/** terron: ПИРАТСТВО — колонка спрайта пиратской лодки (см. UNIT_ORDER). */
const PIRATE_COL = UNIT_ORDER.indexOf("Pirate");

/** Atlas column of the hydrogen bomb — drives the GPU glow halo. */
const HYDROGEN_BOMB_COL = UNIT_ORDER.indexOf(UT_HYDROGEN_BOMB);

// ---------------------------------------------------------------------------
// Instance data layout
// ---------------------------------------------------------------------------

/**
 * Per-instance data (16 bytes):
 *   float x, y, ownerID   — 12 bytes (3 floats)
 *   uint8 atlasIdx         —  1 byte  (atlas column 0–11)
 *   uint8 flags            —  1 byte  (0 = normal, 1 = flicker, 2 = angry, 3 = trade-friendly, 4 = retreating)
 *   2 bytes padding        — aligns to 4-byte boundary
 */
const FLOATS_PER_INSTANCE = 4;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

/** Flag values — passed as uint8, received as float in shader via normalized attribute */
const FLAG_NORMAL = 0;
const FLAG_FLICKER = 1;
const FLAG_ANGRY = 2;
const FLAG_TRADE_FRIENDLY = 3;
const FLAG_RETREATING = 4;

/** Atlas column indices for train sub-types (resolved from trainType + loaded) */
const TRAIN_ENGINE_COL = UNIT_ORDER.indexOf("TrainEngine");
const TRAIN_CARRIAGE_COL = UNIT_ORDER.indexOf("TrainCarriage");
const TRAIN_CARRIAGE_LOADED_COL = UNIT_ORDER.indexOf("TrainCarriageLoaded");

/** Nuke + warhead types — rendered with flickering hot colors */
const FLICKER_TYPES: ReadonlySet<string> = new Set([
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_WATER_NUKE, // terron: ультимейты — «Реки вспять»
]);

/** Missile/projectile types — rendered on top of structures in the layer order.
 *  Ground/sea units (boats, trains) render below structures. */
const MISSILE_TYPES: ReadonlySet<string> = new Set([
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_MIRV_WARHEAD,
  UT_WATER_NUKE, // terron: ультимейты — «Реки вспять»
]);

/** terron: авиация — типы, чьи спрайты поворачиваются по направлению полёта. */
const AVIATION_TYPES: ReadonlySet<string> = new Set([
  UT_AIRPLANE,
  UT_AIRBORNE_ASSAULT,
  UT_SUICIDE_DRONE,
]);
const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------
// Helper: create a VAO for instanced unit rendering
// ---------------------------------------------------------------------------

function createUnitVao(
  gl: WebGL2RenderingContext,
  quadBuf: WebGLBuffer,
  instanceBuf: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  // Attribute 0: unit quad [0,0]->[1,1]
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Attribute 1: per-instance vec3 (x, y, ownerID) — 3 floats at offset 0
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
  gl.vertexAttribDivisor(1, 1);

  // Attribute 2: per-instance (atlasIdx, flags) — 2 uint8s at offset 12, converted to float
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.UNSIGNED_BYTE, false, BYTES_PER_INSTANCE, 12);
  gl.vertexAttribDivisor(2, 1);

  // terron: авиация — Attribute 3: угол поворота (uint8 at offset 14, НОРМАЛИЗОВАН → [0,1]).
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, true, BYTES_PER_INSTANCE, 14);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);
  return vao;
}

// ---------------------------------------------------------------------------
// UnitPass
// ---------------------------------------------------------------------------

/** terron ПЕРФ (08.08): источники для прогрева программ, см. ProgramRegistry.
 *  ATLAS_COLS/HYDROGEN_BOMB_COL/TRAIN_ENGINE_COL выводятся из UNIT_ORDER и
 *  приватны модулю — берём отсюда, а не дублируем в реестре. */
export function unitProgramSources(): [string, string] {
  return [
    shaderSrc(unitVertSrc, { ATLAS_COLS, HYDROGEN_BOMB_COL }),
    shaderSrc(unitFragSrc, {
      PALETTE_SIZE: getPaletteSize(),
      ATLAS_COLS,
      TRAIN_MIN_COL: TRAIN_ENGINE_COL,
    }),
  ];
}

export class UnitPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;

  private uCamera: WebGLUniformLocation;
  private uTick: WebGLUniformLocation;
  private uUnitSize: WebGLUniformLocation;
  private uFlickerSpeed: WebGLUniformLocation;
  private uAngryColor: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;
  private uHBombGlowScale: WebGLUniformLocation;
  private uHBombGlowColor: WebGLUniformLocation;
  private uHBombGlowStrength: WebGLUniformLocation;
  private uHBombGlowInner: WebGLUniformLocation;

  private affiliationTex: WebGLTexture | null = null;
  private altView = false;

  // Ground/sea units (boats, trains) — render below structures
  private groundVao: WebGLVertexArrayObject;
  private groundBuf: DynamicInstanceBuffer;
  private groundCount = 0;

  // Missiles/projectiles (nukes, shells, SAM) — render above structures
  private missileVao: WebGLVertexArrayObject;
  private missileBuf: DynamicInstanceBuffer;
  private missileCount = 0;

  private quadBuf: WebGLBuffer;
  private paletteTex: WebGLTexture;
  private atlasTex: WebGLTexture;

  /** Frame tick received from renderer — drives tick-based effects */
  private frameTick = 0;

  /** unitType string → atlas column (0-11) */
  private typeToAtlasCol = new Map<string, number>();
  private mapW: number;

  // Trade-friendly detection: enemy trade ships heading to a self/allied port
  private localPlayerID = 0;
  private friendlyOwners = new Set<number>();
  private structures: Map<number, UnitState> = new Map();

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
      const col = UNIT_ORDER.indexOf(
        header.unitTypes[i] as (typeof UNIT_ORDER)[number],
      );
      if (col >= 0) {
        this.typeToAtlasCol.set(header.unitTypes[i], col);
      }
    }
    // terron: авиация — настоящие спрайты самолётов (unit-atlas колонки 12/13). Топ-даун
    // силуэты: торговый лайнер + десантный «истребитель», колоризуются цветом игрока. airport.md
    const airplaneCol = UNIT_ORDER.indexOf(UT_AIRPLANE);
    if (airplaneCol >= 0) {
      this.typeToAtlasCol.set(UT_AIRPLANE, airplaneCol);
    }
    const assaultCol = UNIT_ORDER.indexOf(UT_AIRBORNE_ASSAULT);
    if (assaultCol >= 0) {
      this.typeToAtlasCol.set(UT_AIRBORNE_ASSAULT, assaultCol);
    }
    const droneCol = UNIT_ORDER.indexOf(UT_SUICIDE_DRONE);
    if (droneCol >= 0) {
      this.typeToAtlasCol.set(UT_SUICIDE_DRONE, droneCol);
    }
    // terron 23.08: КОЛОНКИ КАСТОВ — ИЗ РЕЕСТРА, а не руками.
    //
    // Раньше каждый каст, делящий чужой спрайт, прописывался здесь отдельной
    // строкой — и «Выстрел Доры» приехал на дев вообще без спрайта, потому что
    // строку забыли. Теперь пара «каст → донорская колонка» объявляется ОДИН
    // раз в ULTIMATE_REGISTRY (поле cast.atlas), а сюда приезжает сама.
    // Донор не из UNIT_ORDER (каст рисуется как СТРОЕНИЕ) — молча пропускаем:
    // его тем же способом подхватит StructurePass.
    for (const u of ULTIMATE_REGISTRY) {
      if (u.cast === undefined || !("alias" in u.cast.atlas)) continue;
      const col = (UNIT_ORDER as readonly string[]).indexOf(
        u.cast.atlas.alias as string,
      );
      if (col >= 0) this.typeToAtlasCol.set(u.cast.type as string, col);
    }
    // terron: ЗЕЛЁНЫЕ — гражданский борт-инспекция летит спрайтом самолёта.
    if (airplaneCol >= 0) {
      this.typeToAtlasCol.set(UT_GREEN_INSPECTION, airplaneCol);
    }

    // Compile shaders
    this.program = createProgram(gl, ...unitProgramSources());
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTick = gl.getUniformLocation(this.program, "uTick")!;
    this.uUnitSize = gl.getUniformLocation(this.program, "uUnitSize")!;
    this.uFlickerSpeed = gl.getUniformLocation(this.program, "uFlickerSpeed")!;
    this.uAngryColor = gl.getUniformLocation(this.program, "uAngryColor")!;

    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;
    this.uHBombGlowScale = gl.getUniformLocation(
      this.program,
      "uHBombGlowScale",
    )!;
    this.uHBombGlowColor = gl.getUniformLocation(
      this.program,
      "uHBombGlowColor",
    )!;
    this.uHBombGlowStrength = gl.getUniformLocation(
      this.program,
      "uHBombGlowStrength",
    )!;
    this.uHBombGlowInner = gl.getUniformLocation(
      this.program,
      "uHBombGlowInner",
    )!;

    // Texture unit bindings
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAffiliation"), 2);

    // Create placeholder atlas texture (1x1 gray pixel)
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
      new Uint8Array([128, 128, 128, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Start async atlas build
    this.loadAtlas();

    // --- Shared quad buffer ---
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );

    // --- Ground instance buffer + VAO ---
    const groundGlBuf = gl.createBuffer()!;
    this.groundBuf = new DynamicInstanceBuffer(
      gl,
      groundGlBuf,
      1024,
      FLOATS_PER_INSTANCE,
    );
    this.groundVao = createUnitVao(gl, this.quadBuf, groundGlBuf);

    // --- Missile instance buffer + VAO ---
    const missileGlBuf = gl.createBuffer()!;
    this.missileBuf = new DynamicInstanceBuffer(
      gl,
      missileGlBuf,
      512,
      FLOATS_PER_INSTANCE,
    );
    this.missileVao = createUnitVao(gl, this.quadBuf, missileGlBuf);
  }

  private async loadAtlas(): Promise<void> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = unitAtlasUrl;
    await img.decode();
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  private emitGround(
    x: number,
    y: number,
    ownerID: number,
    atlasIdx: number,
    flags: number,
    angleByte: number = 0, // terron: авиация — курс (uint8), 0 = нос вверх
  ): void {
    this.groundBuf.ensureCapacity(this.groundCount + 1);
    const off = this.groundCount * FLOATS_PER_INSTANCE;
    this.groundBuf.float32[off + 0] = x;
    this.groundBuf.float32[off + 1] = y;
    this.groundBuf.float32[off + 2] = ownerID;
    const byteOff = this.groundCount * BYTES_PER_INSTANCE;
    this.groundBuf.uint8[byteOff + 12] = atlasIdx;
    this.groundBuf.uint8[byteOff + 13] = flags;
    this.groundBuf.uint8[byteOff + 14] = angleByte;
    this.groundCount++;
  }

  private emitMissile(
    x: number,
    y: number,
    ownerID: number,
    atlasIdx: number,
    flags: number,
    angleByte: number = 0,
  ): void {
    this.missileBuf.ensureCapacity(this.missileCount + 1);
    const off = this.missileCount * FLOATS_PER_INSTANCE;
    this.missileBuf.float32[off + 0] = x;
    this.missileBuf.float32[off + 1] = y;
    this.missileBuf.float32[off + 2] = ownerID;
    const byteOff = this.missileCount * BYTES_PER_INSTANCE;
    this.missileBuf.uint8[byteOff + 12] = atlasIdx;
    this.missileBuf.uint8[byteOff + 13] = flags;
    this.missileBuf.uint8[byteOff + 14] = angleByte;
    this.missileCount++;
  }

  updateUnits(units: Map<number, UnitState>, tick: number): void {
    this.frameTick = tick;
    this.groundCount = 0;
    this.missileCount = 0;

    for (const unit of units.values()) {
      if (!unit.isActive) continue;

      // terron: ПОДЛОДКИ. subState: 1 = подлодка засвечена, 2 = ещё не стреляла.
      // Не стрелявшую ЧУЖУЮ подлодку не рисуем вовсе (свои и союзные — видим).
      // ⚠️ Это ТОЛЬКО отрисовка: сама подлодка есть в состоянии у всех клиентов
      // (симуляция общая) — «невидимость» не защищена от читов, как и туман.
      if (
        (unit.subState === 2 || unit.subState === 4) &&
        unit.ownerID !== this.localPlayerID &&
        !this.friendlyOwners.has(unit.ownerID)
      ) {
        continue;
      }

      let atlasIdx = this.typeToAtlasCol.get(unit.unitType);
      // Подлодка (хоть скрытая, хоть засвеченная) рисуется своим спрайтом.
      // 1/2 — подлодка, 3 — пиратская лодка, 4 — тихий десант (обычный спрайт).
      if (unit.subState === 1 || unit.subState === 2) atlasIdx = SUBMARINE_COL;
      else if (unit.subState === 3 || unit.subState === 5) atlasIdx = PIRATE_COL;
      // 6 — лодка на якоре блокады сверх DRAW_MAX: есть в симе, не рисуем.
      else if (unit.subState === 6) continue;

      // Train sub-type resolution: "Train" isn't in UNIT_ORDER.
      // Resolve to engine/carriage/loaded carriage based on trainType + loaded fields.
      if (atlasIdx === undefined && unit.unitType === UT_TRAIN) {
        const tt = unit.trainType;
        if (tt === TrainType.Engine || tt === TrainType.TailEngine) {
          atlasIdx = TRAIN_ENGINE_COL;
        } else {
          atlasIdx = unit.loaded
            ? TRAIN_CARRIAGE_LOADED_COL
            : TRAIN_CARRIAGE_COL;
        }
      }

      if (atlasIdx === undefined) continue;

      const isRetreatingWarship =
        unit.unitType === UT_WARSHIP && unit.retreating;
      const isAngryWarship =
        unit.unitType === UT_WARSHIP && unit.targetUnitId !== null;
      const isFlicker = FLICKER_TYPES.has(unit.unitType);

      // Enemy trade ships heading to a self/allied port get FLAG_TRADE_FRIENDLY
      // so alt-view renders them yellow instead of red.
      let isTradeFriendly = false;
      if (
        unit.unitType === UT_TRADE_SHIP &&
        unit.targetUnitId !== null &&
        this.localPlayerID > 0
      ) {
        const targetPort = this.structures.get(unit.targetUnitId);
        if (targetPort) {
          const portOwner = targetPort.ownerID;
          isTradeFriendly =
            portOwner === this.localPlayerID ||
            this.friendlyOwners.has(portOwner);
        }
      }

      let flags = FLAG_NORMAL;
      if (isTradeFriendly) {
        flags = FLAG_TRADE_FRIENDLY;
      } else if (isRetreatingWarship) {
        flags = FLAG_RETREATING;
      } else if (isAngryWarship) {
        flags = FLAG_ANGRY;
      } else if (isFlicker) {
        flags = FLAG_FLICKER;
      }
      const isMissile = MISSILE_TYPES.has(unit.unitType);

      const x = unit.pos % this.mapW;
      const y = (unit.pos - x) / this.mapW;

      // terron: авиация — поворот спрайта по курсу. Берём направление НА ЦЕЛЬ — для прямого
      // полёта оно постоянно, поэтому спрайт не дёргается по-тиково (в отличие от lastPos→pos,
      // где дискретные шаги пути виляют). Цель: targetTile (десант/дрон) ЛИБО позиция
      // targetUnit-аэропорта (торговый транзит). Фолбэк — lastPos→pos. Нос атласа = вверх (-y),
      // поэтому α = atan2(dx, -dy); квантуем в uint8. Остальные типы — 0.
      let angleByte = 0;
      if (AVIATION_TYPES.has(unit.unitType)) {
        let targetPos = -1;
        if (unit.targetTile !== null) {
          targetPos = unit.targetTile;
        } else if (unit.targetUnitId !== null) {
          targetPos = this.structures.get(unit.targetUnitId)?.pos ?? -1;
        }
        let dx = 0;
        let dy = 0;
        if (targetPos >= 0 && targetPos !== unit.pos) {
          const tx = targetPos % this.mapW;
          const ty = (targetPos - tx) / this.mapW;
          dx = tx - x;
          dy = ty - y;
        } else if (unit.lastPos !== unit.pos) {
          const lx = unit.lastPos % this.mapW;
          const ly = (unit.lastPos - lx) / this.mapW;
          dx = x - lx;
          dy = y - ly;
        }
        if (dx !== 0 || dy !== 0) {
          let a = Math.atan2(dx, -dy) / TWO_PI;
          a -= Math.floor(a); // → [0,1)
          angleByte = Math.round(a * 256) & 255;
        }
      }

      if (isMissile) {
        this.emitMissile(x, y, unit.ownerID, atlasIdx, flags);

        // Shells emit a second instance at lastPos (2-pixel trail effect)
        if (unit.unitType === UT_SHELL && unit.lastPos !== unit.pos) {
          const lx = unit.lastPos % this.mapW;
          const ly = (unit.lastPos - lx) / this.mapW;
          this.emitMissile(lx, ly, unit.ownerID, atlasIdx, flags);
        }
      } else if (AVIATION_TYPES.has(unit.unitType)) {
        // terron: авиация (самолёты/десант/дрон) летит НАД иконками городов/
        // предприятий, а не под ними. Эмитим в «надстроечный» слой — тот же буфер,
        // что и ракеты (рисуется ПОСЛЕ structures, см. Renderer.drawMissiles); курс
        // (angleByte) сохраняем, чтобы спрайт по-прежнему разворачивался по полёту.
        this.emitMissile(x, y, unit.ownerID, atlasIdx, flags, angleByte);
      } else {
        this.emitGround(x, y, unit.ownerID, atlasIdx, flags, angleByte);
      }
    }

    const gl = this.gl;
    if (this.groundCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.groundBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.groundBuf.float32,
        0,
        this.groundCount * FLOATS_PER_INSTANCE,
      );
    }
    if (this.missileCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.missileBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.missileBuf.float32,
        0,
        this.missileCount * FLOATS_PER_INSTANCE,
      );
    }
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }
  setAffiliationTex(tex: WebGLTexture): void {
    this.affiliationTex = tex;
  }
  setLocalPlayer(id: number): void {
    this.localPlayerID = id;
  }
  setAllies(allies: Set<number>): void {
    this.friendlyOwners = allies;
  }
  setStructures(structs: Map<number, UnitState>): void {
    this.structures = structs;
  }

  /** Bind shared program state + uniforms (call before drawGround/drawMissiles). */
  private bindProgram(cameraMatrix: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);

    const us = this.settings.unit;
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTick, this.frameTick);
    gl.uniform1f(this.uUnitSize, us.unitSize);
    gl.uniform1f(this.uFlickerSpeed, us.flickerSpeed);
    gl.uniform3f(this.uAngryColor, us.angryR, us.angryG, us.angryB);
    gl.uniform1i(this.uAltView, this.altView ? 1 : 0);
    gl.uniform1f(this.uHBombGlowScale, us.hBombGlowScale);
    gl.uniform3f(
      this.uHBombGlowColor,
      us.hBombGlowR,
      us.hBombGlowG,
      us.hBombGlowB,
    );
    gl.uniform1f(this.uHBombGlowStrength, us.hBombGlowStrength);
    gl.uniform1f(this.uHBombGlowInner, us.hBombGlowInner);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);

    if (this.affiliationTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.affiliationTex);
    }
  }

  /** Draw ground/sea units (boats, trains). Render below structures. */
  drawGround(cameraMatrix: Float32Array): void {
    if (this.groundCount === 0) return;
    this.bindProgram(cameraMatrix);
    const gl = this.gl;
    gl.bindVertexArray(this.groundVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.groundCount);
  }

  /**
   * Draw the ABOVE-STRUCTURES instanced layer: missiles/projectiles (nukes,
   * shells, SAM, MIRV warheads) И авиация (самолёты/десант/дрон) — всё, что
   * должно рисоваться поверх иконок зданий. См. updateUnits routing.
   */
  drawMissiles(cameraMatrix: Float32Array): void {
    if (this.missileCount === 0) return;
    this.bindProgram(cameraMatrix);
    const gl = this.gl;
    gl.bindVertexArray(this.missileVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.missileCount);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.groundBuf.dispose();
    this.missileBuf.dispose();
    gl.deleteBuffer(this.quadBuf);
    gl.deleteVertexArray(this.groundVao);
    gl.deleteVertexArray(this.missileVao);
    gl.deleteTexture(this.atlasTex);
  }
}

/**
 * SpawnOverlayPass — spawn phase tile highlights + breathing rings.
 *
 * Active only during spawn phase. Renders:
 *   1. Colored highlights on unowned tiles within radius 9 of each human
 *      player's spawn center (blinks every 5th tick).
 *   2. Animated breathing rings around the local player and teammates.
 *
 * Uses a fullscreen map quad (reuses overlay.vert.glsl) so the fragment
 * shader can sample tileTex for ownership and compute distance-based
 * effects in tile-space coordinates.
 */

import {
  TERRON_SPAWN_RECT_HALF_H,
  TERRON_SPAWN_RECT_HALF_W,
} from "../../../../core/configuration/TerronTuning";
import type { RenderSettings } from "../RenderSettings";
import { createMapQuad, createProgram, shaderSrc } from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import spawnFragSrc from "../shaders/spawn-overlay/spawn-overlay.frag.glsl?raw";

const MAX_SPAWNS = 32;

export interface SpawnCenter {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  isSelf: boolean;
  isTeammate: boolean;
}

/**
 * terron ПЕРФ (08.08): источники программы отдельной функцией, чтобы их мог
 * взять прогрев (ProgramRegistry) — MAX_SPAWNS приватен для модуля, и в реестре
 * его пришлось бы дублировать. Конструктор зовёт ЭТУ ЖЕ функцию, поэтому
 * выражение живёт в одном месте и разойтись с прогревом не может.
 */
export function spawnOverlayProgramSources(): [string, string] {
  return [overlayVertSrc, shaderSrc(spawnFragSrc, { MAX_SPAWNS, ...TILE_DEFINES })];
}

export class SpawnOverlayPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private tileTex: WebGLTexture;
  private settings: RenderSettings["spawnOverlay"];

  // Uniforms
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uSpawnCount: WebGLUniformLocation;
  private uBreathRadius: WebGLUniformLocation;
  private uSpawnA: WebGLUniformLocation;
  private uSpawnB: WebGLUniformLocation;
  private uHighlightRadiusSq: WebGLUniformLocation;
  private uHighlightAlpha: WebGLUniformLocation;
  private uSelfRadii: WebGLUniformLocation;
  private uMateRadii: WebGLUniformLocation;
  private uGradientStops: WebGLUniformLocation;
  private uFlagHalf: WebGLUniformLocation;

  private mapW: number;
  private mapH: number;

  // State
  private active = false;
  private centers: SpawnCenter[] = [];
  private animTime = 0;
  private lastTime = 0;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    settings: RenderSettings["spawnOverlay"],
  ) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.settings = settings;

    this.program = createProgram(gl, ...spawnOverlayProgramSources());

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uSpawnCount = gl.getUniformLocation(this.program, "uSpawnCount")!;
    this.uBreathRadius = gl.getUniformLocation(this.program, "uBreathRadius")!;
    this.uSpawnA = gl.getUniformLocation(this.program, "uSpawnA")!;
    this.uSpawnB = gl.getUniformLocation(this.program, "uSpawnB")!;
    this.uHighlightRadiusSq = gl.getUniformLocation(
      this.program,
      "uHighlightRadiusSq",
    )!;
    this.uHighlightAlpha = gl.getUniformLocation(
      this.program,
      "uHighlightAlpha",
    )!;
    this.uSelfRadii = gl.getUniformLocation(this.program, "uSelfRadii")!;
    this.uMateRadii = gl.getUniformLocation(this.program, "uMateRadii")!;
    this.uGradientStops = gl.getUniformLocation(
      this.program,
      "uGradientStops",
    )!;
    this.uFlagHalf = gl.getUniformLocation(this.program, "uFlagHalf")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  /** Update spawn overlay state each frame. */
  update(inSpawnPhase: boolean, centers: SpawnCenter[]): void {
    this.active = inSpawnPhase && centers.length > 0;
    this.centers = centers;
  }

  draw(cameraMatrix: Float32Array): void {
    if (!this.active) return;

    const gl = this.gl;
    const s = this.settings;
    const now = performance.now();

    // Advance animation time
    if (this.lastTime > 0) {
      this.animTime += (now - this.lastTime) * s.animSpeed;
    }
    this.lastTime = now;

    const breathRadius = 0.5 + 0.5 * Math.sin(this.animTime);

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1i(this.uSpawnCount, Math.min(this.centers.length, MAX_SPAWNS));
    gl.uniform1f(this.uBreathRadius, breathRadius);

    // Settings-driven uniforms
    gl.uniform1f(
      this.uHighlightRadiusSq,
      s.highlightRadius * s.highlightRadius,
    );
    gl.uniform1f(this.uHighlightAlpha, s.highlightAlpha);
    gl.uniform4f(this.uSelfRadii, s.selfMinRad, s.selfMaxRad, 0, 0);
    gl.uniform4f(this.uMateRadii, s.mateMinRad, s.mateMaxRad, 0, 0);
    gl.uniform2f(this.uGradientStops, s.gradientInnerEdge, s.gradientSolidEnd);
    // terron: полу-размеры спавн-флага → box-спотлайт под форму флага (не круг).
    gl.uniform2f(
      this.uFlagHalf,
      TERRON_SPAWN_RECT_HALF_W,
      TERRON_SPAWN_RECT_HALF_H,
    );

    // terron: порядок отрисовки = порядок в массиве, причём РАНЬШЕ в цикле = ПОВЕРХ
    // (шейдер копит альфу «over»). Свою точку кладём ПОСЛЕДНЕЙ → её ореол уходит ПОД
    // чужие точки спавна: если кто-то налез на моё место, я вижу его поверх хало.
    const ordered = [
      ...this.centers.filter((c) => !c.isSelf),
      ...this.centers.filter((c) => c.isSelf),
    ];

    // Upload spawn center data as vec4 arrays
    const count = Math.min(ordered.length, MAX_SPAWNS);
    const dataA = new Float32Array(count * 4);
    const dataB = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const c = ordered[i];
      // terron: рамка СВОЕЙ точки спавна — АНТРАЦИТ (#2b2a24, как кнопки на
      // главной), не чистый чёрный. Свой центр рисует только пульсирующую рамку
      // вокруг флага (шейдер, isSelf-ветка). Цвет здесь = цвет рамки.
      dataA[i * 4 + 0] = c.x;
      dataA[i * 4 + 1] = c.y;
      dataA[i * 4 + 2] = c.isSelf ? 43 / 255 : c.r; // R антрацита
      dataA[i * 4 + 3] = c.isSelf ? 42 / 255 : c.g; // G
      dataB[i * 4 + 0] = c.isSelf ? 36 / 255 : c.b; // B
      dataB[i * 4 + 1] = c.isSelf ? 1 : 0;
      dataB[i * 4 + 2] = c.isTeammate ? 1 : 0;
      dataB[i * 4 + 3] = 0;
    }
    gl.uniform4fv(this.uSpawnA, dataA);
    gl.uniform4fv(this.uSpawnB, dataB);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    // tileTex owned by GPUResources
  }
}

/**
 * TerrainPass — renders the terrain map as a textured quad.
 *
 * terron ПЕРФ (память, 12.07): террейн живёт в ОБЩЕЙ R8UI-текстуре (сырые
 * байты, 1 байт/px) вместо приватной RGBA8 (4 байта/px). Цвет считает шейдер
 * через LUT 256×1 (encodeTerrainTile по всем 256 значениям байта — раз на
 * старте). Выигрыш: −3 байта/px GPU, минус transient buildTerrainRGBA
 * (4 байта/px CPU в пик загрузки: −32МБ на гигантской карте), и общая
 * текстура шарится с RailroadPass (мосты) и FogPass (рельеф под туманом) —
 * ещё −1 байт/px при ж/д. Water-nuke дельты обновляют ОДНУ текстуру байтом.
 */

import terrainFragSrc from "../shaders/terrain/terrain.frag.glsl?raw";
import terrainVertSrc from "../shaders/terrain/terrain.vert.glsl?raw";
import { encodeTerrainTile } from "../utils/ColorUtils";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";
import { buildStyledTerrainLut } from "../utils/TerrainPalette";
import type { TerrainPalette } from "../VisualStyles";

/** Родной LUT (PastelTheme) — 256 вариантов байта рельефа. */
function defaultTerrainLut(): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  for (let b = 0; b < 256; b++) encodeTerrainTile(b, lut, b * 4);
  return lut;
}

// ---------------------------------------------------------------------------
// TerrainPass
// ---------------------------------------------------------------------------

export class TerrainPass {
  private program: WebGLProgram;
  /** ОБЩАЯ R8UI-текстура сырых terrain-байтов (владелец — GPUResources). */
  private tex: WebGLTexture;
  private lutTex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private uCamera: WebGLUniformLocation;
  private mapW: number;
  private mapH: number;
  // Scratch buffer for 1×1 sub-uploads; reused across applyTerrainDelta calls.
  private readonly byteScratch = new Uint8Array(1);

  constructor(
    private gl: WebGL2RenderingContext,
    terrainTex: WebGLTexture,
    mapW: number,
    mapH: number,
  ) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.tex = terrainTex;
    this.program = createProgram(
      gl,
      shaderSrc(terrainVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      terrainFragSrc,
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTerrain"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTerrainLut"), 1);

    // LUT: все 256 вариантов terrain-байта → RGBA-цвет (та же функция, что
    // раньше красила весь массив на CPU — теперь 256 вызовов вместо 4М+).
    this.lutTex = createTexture2D(gl, {
      width: 256,
      height: 1,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: defaultTerrainLut(),
      filter: gl.NEAREST,
    });

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  /** LUT байт→цвет — FogPass красит ею приглушённый рельеф под туманом. */
  getLutTex(): WebGLTexture {
    return this.lutTex;
  }

  /**
   * terron (визуальные стили): подменить палитру рельефа. `null` — родная
   * (классика, байт-в-байт прежние цвета).
   *
   * ⚠️ Перезаливаем ТУ ЖЕ текстуру, а не создаём новую: на неё уже смотрит
   * FogPass (рельеф под туманом) — новый объект он бы не увидел, и под туманом
   * осталась бы палитра прошлого стиля.
   */
  setPalette(palette: TerrainPalette | null): void {
    const gl = this.gl;
    const lut = palette ? buildStyledTerrainLut(palette) : defaultTerrainLut();
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      256,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      lut,
    );
  }

  /**
   * Update a subset of terrain tiles in-place (e.g. land→water from a water
   * nuke). `bytes[i]` is the new terrain byte for `refs[i]` (parallel arrays).
   * Пишем СЫРОЙ байт в общую текстуру — RailroadPass/FogPass видят то же.
   */
  applyTerrainDelta(refs: readonly number[], bytes: Uint8Array): void {
    if (refs.length === 0) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const x = ref % this.mapW;
      const y = (ref - x) / this.mapW;
      this.byteScratch[0] = bytes[i];
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        x,
        y,
        1,
        1,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        this.byteScratch,
      );
    }
  }

  /**
   * terron 13.09: вся карта ОДНИМ вызовом — для перезаливки после потери
   * GL-контекста. Раньше туда шла applyTerrainDelta со ВСЕМИ тайлами: 3–8 млн
   * texSubImage2D по пикселю. Страница висела минутами, GPU-процесс захлёбывался
   * и контекст умирал второй раз прямо на пересборке (на маке владельца это
   * дважды уронило систему целиком). `bytes` — байт рельефа на КАЖДЫЙ тайл.
   */
  uploadFullTerrain(bytes: Uint8Array): void {
    if (bytes.length < this.mapW * this.mapH) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.mapW,
      this.mapH,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      bytes,
    );
  }

  /** Render the terrain. Call with depth test disabled, no blending. */
  draw(cameraMatrix: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.lutTex);
    // Общая terrain-текстура — владелец GPUResources, тут не трогаем.
    // VAO + buffer leak is acceptable on dispose (context is being destroyed)
  }
}

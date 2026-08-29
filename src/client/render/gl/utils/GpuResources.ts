/**
 * GPUResources — shared GPU textures created once, passed to all passes.
 *
 * Eliminates getter chains, setBorderTex/setHeatTex late-wiring, and
 * construction-order dependencies between passes.
 */

import { createTexture2D } from "./GlUtils";

export interface GPUResources {
  tileTex: WebGLTexture; // R16UI  — tile ownership + flags
  trailTex: WebGLTexture; // R8UI   — trail owner per tile
  paletteTex: WebGLTexture; // RGBA32F — player colors
  borderTex: WebGLTexture; // RGBA8  — border type + defense + relation (G unused)
  heatTexA: WebGLTexture; // R8     — fallout heat ping-pong A
  heatTexB: WebGLTexture; // R8     — fallout heat ping-pong B
  // terron ПЕРФ (память, 12.07): ОБЩИЙ сырой террейн (R8UI, 1 байт/px) —
  // читают TerrainPass (цвет через LUT), RailroadPass (мосты), FogPass
  // (рельеф под туманом). Раньше: RGBA8 у террейна + СВОЯ R8UI-копия у ж/д.
  terrainTex: WebGLTexture; // R8UI — raw terrain byte per tile
}

export function createGPUResources(
  gl: WebGL2RenderingContext,
  mapW: number,
  mapH: number,
  paletteTex: WebGLTexture,
  borderTex: WebGLTexture,
  terrainBytes: Uint8Array,
): GPUResources {
  const tileTex = createTexture2D(gl, {
    width: mapW,
    height: mapH,
    internalFormat: gl.R16UI,
    format: gl.RED_INTEGER,
    type: gl.UNSIGNED_SHORT,
    data: null,
    filter: gl.NEAREST,
  });

  // terron ПЕРФ (память, 12.07, Р9): trail — 1×1-заглушка; полный размер даёт
  // TrailPass.ensureFullSize() при ПЕРВОМ следе (лодка/самолёт). До него
  // −1 Б/px GPU и −1 Б/px CPU-буфера на старте.
  const trailTex = createTexture2D(gl, {
    width: 1,
    height: 1,
    internalFormat: gl.R8UI,
    format: gl.RED_INTEGER,
    type: gl.UNSIGNED_BYTE,
    data: null,
    filter: gl.NEAREST,
  });

  // terron ПЕРФ (память, 12.07): heat-текстуры создаются 1×1-заглушками —
  // полный размер им даёт HeatManager.ensureFullSize() при ПЕРВОЙ ядерке.
  // До неё фоллаута нет → 2 полнокарточные R8 (+prevTileTex R16UI в
  // HeatManager) не занимают память на старте матча (самый крашеопасный
  // момент на телефонах — median-краш 12с, fable/memory-crashes.md).
  const heatTexA = createTexture2D(gl, {
    width: 1,
    height: 1,
    internalFormat: gl.R8,
    format: gl.RED,
    type: gl.UNSIGNED_BYTE,
    data: null,
    filter: gl.NEAREST,
  });

  const heatTexB = createTexture2D(gl, {
    width: 1,
    height: 1,
    internalFormat: gl.R8,
    format: gl.RED,
    type: gl.UNSIGNED_BYTE,
    data: null,
    filter: gl.NEAREST,
  });

  const terrainTex = createTexture2D(gl, {
    width: mapW,
    height: mapH,
    internalFormat: gl.R8UI,
    format: gl.RED_INTEGER,
    type: gl.UNSIGNED_BYTE,
    data: terrainBytes,
    filter: gl.NEAREST,
  });

  return {
    tileTex,
    trailTex,
    paletteTex,
    borderTex,
    heatTexA,
    heatTexB,
    terrainTex,
  };
}

export function disposeGPUResources(
  gl: WebGL2RenderingContext,
  res: GPUResources,
): void {
  gl.deleteTexture(res.tileTex);
  gl.deleteTexture(res.trailTex);
  // paletteTex and borderTex are owned by renderer and BorderComputePass respectively
  gl.deleteTexture(res.heatTexA);
  gl.deleteTexture(res.heatTexB);
  gl.deleteTexture(res.terrainTex);
}

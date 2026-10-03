/**
 * terron: MapStylePass — пост-обработка БАЗОВОГО СЛОЯ карты под визуальный
 * стиль (см. VisualStyles.ts). Сводит «рельеф + территория» из FBO, красит их
 * по стилю и отдаёт дальше (на экран или в ночной композит).
 *
 * ⚠️ Пасс ЛЕНИВЫЙ: при «Классике» его не существует вовсе — ни программы, ни
 * лишнего прохода на пиксель. Цену платит только тот, кто включил стиль.
 *
 * ⚠️ ПОЧЕМУ ТОЛЬКО ЗЕМЛЯ, а не весь кадр. Пассы блума/света/покрытия обороны
 * по ходу отрисовки биндят СВОИ FBO и возвращаются на экран (bindFramebuffer
 * null) — снять весь кадр в текстуру, не переписав их, нельзя. Плюс так
 * читаемость не страдает: ники, юниты и здания остаются чёткими, а согласует
 * их со стилем грейд ПАЛИТРЫ ИГРОКОВ (WebGLFrameBuilder), а не пост-эффект.
 */

import type { StylePostFx } from "../VisualStyles";
import { createFullscreenQuad, createProgram } from "../utils/GlUtils";

import mapStyleFragSrc from "../shaders/map-style/map-style.frag.glsl?raw";
import fullscreenVertSrc from "../shaders/shared/fullscreen.vert.glsl?raw";

type Loc = WebGLUniformLocation | null;

export class MapStylePass {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private u: Record<string, Loc> = {};
  private fx: StylePostFx;
  private mapW: number;
  private mapH: number;
  private startedAt = performance.now();

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    private terrainTex: WebGLTexture,
    fx: StylePostFx,
  ) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;
    this.fx = fx;
    this.prog = createProgram(gl, fullscreenVertSrc, mapStyleFragSrc);
    const names = [
      "uMapSize",
      "uCamOffset",
      "uViewWorld",
      "uPixelSize",
      "uTime",
      "uSat",
      "uContrast",
      "uBrightness",
      "uShadow",
      "uHighlight",
      "uDuotone",
      "uPosterize",
      "uContour",
      "uContourStep",
      "uCoast",
      "uLineColor",
      "uHatch",
      "uGrid",
      "uGridStep",
      "uGrain",
      "uGrainSpeed",
      "uScan",
      "uVignette",
      "uGlow",
      "uAberration",
    ];
    for (const n of names) this.u[n] = gl.getUniformLocation(this.prog, n);
    gl.useProgram(this.prog);
    gl.uniform1i(gl.getUniformLocation(this.prog, "uSceneTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.prog, "uTerrainTex"), 1);
    this.vao = createFullscreenQuad(gl);
  }

  setFx(fx: StylePostFx): void {
    this.fx = fx;
  }

  /**
   * Нарисовать в ТЕКУЩИЙ фреймбуфер (экран или цель ночного композита).
   * camOffset/viewWorld — положение камеры в мировых координатах: по ним
   * шейдер сам находит тайл под пикселем (линии берега/изолинии/сетка).
   */
  draw(
    sceneTex: WebGLTexture,
    camOffsetX: number,
    camOffsetY: number,
    canvasW: number,
    canvasH: number,
    zoom: number,
  ): void {
    const gl = this.gl;
    const f = this.fx;
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);

    const z = zoom > 0.0001 ? zoom : 1;
    gl.uniform2f(this.u.uMapSize, this.mapW, this.mapH);
    gl.uniform2f(this.u.uCamOffset, camOffsetX, camOffsetY);
    gl.uniform2f(this.u.uViewWorld, canvasW / z, canvasH / z);
    gl.uniform2f(this.u.uPixelSize, 1 / canvasW, 1 / canvasH);
    gl.uniform1f(this.u.uTime, (performance.now() - this.startedAt) / 1000);

    gl.uniform1f(this.u.uSat, f.saturation);
    gl.uniform1f(this.u.uContrast, f.contrast);
    gl.uniform1f(this.u.uBrightness, f.brightness);
    gl.uniform3f(
      this.u.uShadow,
      f.shadow[0] / 255,
      f.shadow[1] / 255,
      f.shadow[2] / 255,
    );
    gl.uniform3f(
      this.u.uHighlight,
      f.highlight[0] / 255,
      f.highlight[1] / 255,
      f.highlight[2] / 255,
    );
    gl.uniform1f(this.u.uDuotone, f.duotone);
    gl.uniform1f(this.u.uPosterize, f.posterize);
    gl.uniform1f(this.u.uContour, f.contour);
    gl.uniform1f(this.u.uContourStep, f.contourStep);
    gl.uniform1f(this.u.uCoast, f.coast);
    gl.uniform3f(
      this.u.uLineColor,
      f.lineColor[0] / 255,
      f.lineColor[1] / 255,
      f.lineColor[2] / 255,
    );
    gl.uniform1f(this.u.uHatch, f.hatch);
    gl.uniform1f(this.u.uGrid, f.grid);
    gl.uniform1f(this.u.uGridStep, f.gridStep);
    gl.uniform1f(this.u.uGrain, f.grain);
    gl.uniform1f(this.u.uGrainSpeed, f.grainSpeed);
    gl.uniform1f(this.u.uScan, f.scanline);
    gl.uniform1f(this.u.uVignette, f.vignette);
    gl.uniform1f(this.u.uGlow, f.glow);
    gl.uniform1f(this.u.uAberration, f.aberration);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    this.gl.deleteProgram(this.prog);
    this.gl.deleteVertexArray(this.vao);
  }
}

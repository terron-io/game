/**
 * FxProjectilePass — маленькие летящие белые точки «выстрелов» бункеров ульты
 * Укрепления (from→to). Визуально ближе к реальному Shell (белый пиксель с
 * коротким хвостом), чем кольцо. Инстансированные квады с залитым диском
 * (projectile.frag), вершинник переиспользован от shockwave. Спека: ULTIMATES.md
 */
import { DynamicInstanceBuffer } from "../../DynamicBuffer";
import { createProgram } from "../../utils/GlUtils";

import projectileFragSrc from "../../shaders/fx/projectile.frag.glsl?raw";
import shockwaveVertSrc from "../../shaders/fx/shockwave.vert.glsl?raw";

interface FortProjectile {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startMs: number;
  durationMs: number;
}

// Инстанс: x, y, radius, alpha (как у shockwave — тот же вершинник).
const PROJECTILE_FLOATS = 4;
// Голова снаряда + 1 точка-хвост (мини-трейл, как у Shell с его 2-px следом).
const HEAD_RADIUS = 1.7;
const TRAIL_RADIUS = 1.1;
const TRAIL_LAG = 0.16; // хвост отстаёт по параметру t
// Постоянная скорость: длительность полёта ~ дистанция (мс на тайл), с клампом.
const MS_PER_TILE = 16;
const MIN_MS = 120;
const MAX_MS = 460;

export class FxProjectilePass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private drawCount = 0;

  private active: FortProjectile[] = [];
  private timeFn: () => number = () => performance.now();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, shockwaveVertSrc, projectileFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;

    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(gl, glBuf, 16, PROJECTILE_FLOATS);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  push(fromX: number, fromY: number, toX: number, toY: number): void {
    const dist = Math.hypot(toX - fromX, toY - fromY);
    const durationMs = Math.max(MIN_MS, Math.min(MAX_MS, dist * MS_PER_TILE));
    this.active.push({
      fromX,
      fromY,
      toX,
      toY,
      startMs: this.timeFn(),
      durationMs,
    });
  }

  tick(): void {
    if (this.active.length === 0) {
      this.drawCount = 0;
      return;
    }
    const now = this.timeFn();
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (now - this.active[i].startMs >= this.active[i].durationMs) {
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
      }
    }
    this.rebuildInstances(now);
  }

  private rebuildInstances(now: number): void {
    const count = this.active.length;
    // 2 инстанса на снаряд: голова + хвост.
    this.instanceBuf.ensureCapacity(count * 2);
    const data = this.instanceBuf.float32;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const p = this.active[i];
      const t = Math.min(1, (now - p.startMs) / p.durationMs);
      // Затухание к концу полёта (последние 20%).
      const fade = t > 0.8 ? Math.max(0, (1 - t) / 0.2) : 1;
      const tTrail = Math.max(0, t - TRAIL_LAG);

      const hx = p.fromX + (p.toX - p.fromX) * t;
      const hy = p.fromY + (p.toY - p.fromY) * t;
      const tx = p.fromX + (p.toX - p.fromX) * tTrail;
      const ty = p.fromY + (p.toY - p.fromY) * tTrail;

      // Хвост (рисуем первым — голова поверх).
      let off = n++ * PROJECTILE_FLOATS;
      data[off + 0] = tx;
      data[off + 1] = ty;
      data[off + 2] = TRAIL_RADIUS;
      data[off + 3] = 0.45 * fade;
      // Голова.
      off = n++ * PROJECTILE_FLOATS;
      data[off + 0] = hx;
      data[off + 1] = hy;
      data[off + 2] = HEAD_RADIUS;
      data[off + 3] = fade;
    }
    this.drawCount = n;
  }

  draw(cameraMatrix: Float32Array): void {
    if (this.drawCount === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.instanceBuf.float32,
      0,
      this.drawCount * PROJECTILE_FLOATS,
    );
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.drawCount);
  }

  setTimeFn(fn: () => number): void {
    this.timeFn = fn;
  }

  clear(): void {
    this.active.length = 0;
    this.drawCount = 0;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}

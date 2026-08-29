/**
 * FogPass — terron: ТУМАН ВОЙНЫ (опция лобби fogOfWar).
 *
 * Видимость игрока = своя/союзная территория + квадрат Чебышева радиуса
 * TERRON_FOG_VISION_RADIUS вокруг неё и вокруг каждого своего/союзного юнита
 * (лодки/самолёты/поезда дают обзор в пути). Считается на GPU раз в тик:
 *
 *   1. seed: tileTex → 1 там, где owner ∈ friendly-LUT (fog-seed.frag)
 *   2. штамп юнитов точками в ту же маску (fog-units)
 *   3. сепарабельная дилатация ±R по X, затем по Y (fog-dilate, 2 прохода)
 *
 * Композит (draw) рисуется в renderOverlays ПОСЛЕ имён/телеграфов/юнитов и
 * ПЕРЕД радиал-меню: непрозрачный тёмный квад закрывает разом ВСЕ карто-слои —
 * отдельно маскировать каждый пасс не нужно. CPU-двойник для кликов/ховера —
 * GameView.isTileVisibleUnderFog (тот же радиус из TerronTuning).
 *
 * ⚠️ Только рендер: симуляция и данные не меняются (lockstep шлёт всё всем),
 * это косметика для честных клиентов — как и весь остальной UI.
 */

import {
  TERRON_FOG_VISION_RADIUS,
  TERRON_OURSKY_WAVE_MS,
} from "../../../../core/configuration/TerronTuning";
import type { UnitState } from "../../types";
import fogCompositeFragSrc from "../shaders/fog/fog-composite.frag.glsl?raw";
import fogCompositeVertSrc from "../shaders/fog/fog-composite.vert.glsl?raw";
import fogDilateFragSrc from "../shaders/fog/fog-dilate.frag.glsl?raw";
import fogSeedFragSrc from "../shaders/fog/fog-seed.frag.glsl?raw";
import fogUnitsFragSrc from "../shaders/fog/fog-units.frag.glsl?raw";
import fogUnitsVertSrc from "../shaders/fog/fog-units.vert.glsl?raw";
import fullscreenNoUvVertSrc from "../shaders/shared/fullscreen-no-uv.vert.glsl?raw";
import {
  createFullscreenQuad,
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

/** Размер friendly-LUT = максимум smallID (OWNER_MASK 12 бит). */
const FRIENDLY_LUT_SIZE = 4096;

/** Максимум одновременных ревил-кругов (uniform-массив в композите). */
const MAX_REVEALS = 16;

// Насколько приглушить рельеф под туманом: карту «примерно видно наполовину»,
// а территории/юниты/имена скрыты полностью (решение владельца 11.07).
const FOG_TERRAIN_DIM = 0.5;

export class FogPass {
  private gl: WebGL2RenderingContext;
  private mapW: number;
  private mapH: number;
  private tileTex: WebGLTexture;
  private terrainTex: WebGLTexture;
  private terrainLut: WebGLTexture;

  // terron ПЕРФ (память): GPU-ресурсы тумана аллоцируются ЛЕНИВО — только когда
  // туман реально включается (лобби-опция ИЛИ ульта «Небо наше»). В 99% матчей
  // туман выкл → раньше 3 полнокарточные R8-текстуры + 4 шейдера висели зря
  // (на гигантской карте ~24МБ GPU впустую, вклад в OOM-краши телефонов 12.07).
  private allocated = false;
  private seedProgram!: WebGLProgram;
  private unitsProgram!: WebGLProgram;
  private dilateProgram!: WebGLProgram;
  private compositeProgram!: WebGLProgram;

  private fullscreenVao!: WebGLVertexArrayObject;
  private mapQuadVao!: WebGLVertexArrayObject;

  private seedTex!: WebGLTexture;
  private seedFbo!: WebGLFramebuffer;
  private tmpTex!: WebGLTexture;
  private tmpFbo!: WebGLFramebuffer;
  private visTex!: WebGLTexture;
  private visFbo!: WebGLFramebuffer;

  private uDilateDir!: WebGLUniformLocation;
  private uCamera!: WebGLUniformLocation;
  private uTerrainDim!: WebGLUniformLocation;
  private uWaveMode!: WebGLUniformLocation;
  private uWave!: WebGLUniformLocation;
  private uRevealCount!: WebGLUniformLocation;
  private uReveals!: WebGLUniformLocation;

  private friendlyTex!: WebGLTexture;
  private friendlyCpu = new Uint8Array(FRIENDLY_LUT_SIZE);
  private friendlyDirty = false;

  private unitsVao!: WebGLVertexArrayObject;
  private unitsBuf!: WebGLBuffer;
  private unitsXY = new Float32Array(256 * 2);
  private unitsCount = 0;
  private unitsCapacity = 256;

  private enabled = false;
  private localPlayerID = 0;
  private friendlySet: ReadonlySet<number> = new Set();
  private dirty = true;
  /** Хоть раз посчитали маску — иначе draw показал бы мусорную текстуру. */
  private computedOnce = false;

  // terron: «Небо наше» — волна тьмы (1) / света (2) из эпицентра запуска.
  // 0 = волны нет. Радиус растёт 0→диагональ карты за TERRON_OURSKY_WAVE_MS;
  // contract = радиус наоборот СХЛОПЫВАЕТСЯ (возврат тумана в фог-матче).
  private waveMode = 0;
  private waveContract = false;
  private waveCx = 0;
  private waveCy = 0;
  private waveStart = 0;
  private readonly waveMaxRadius: number;

  // terron: ревилы (окна видимости после своих ударов) — до MAX_REVEALS кругов.
  private revealsCpu = new Float32Array(MAX_REVEALS * 3);
  private revealCount = 0;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    terrainTex: WebGLTexture,
    terrainLut: WebGLTexture,
  ) {
    // Конструктор ДЁШЕВЫЙ: ни одной GPU-аллокации. Реальные текстуры/шейдеры —
    // в ensureAllocated() при первом включении тумана (память для не-фог матчей).
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.terrainTex = terrainTex;
    this.terrainLut = terrainLut;
    this.waveMaxRadius = Math.sqrt(mapW * mapW + mapH * mapH);
  }

  /** Аллоцировать GPU-ресурсы тумана (идемпотентно; вызов при первом включении). */
  private ensureAllocated(): void {
    if (this.allocated) return;
    this.allocated = true;
    const gl = this.gl;
    const mapW = this.mapW;
    const mapH = this.mapH;

    this.seedProgram = createProgram(
      gl,
      fullscreenNoUvVertSrc,
      shaderSrc(fogSeedFragSrc, { ...TILE_DEFINES }),
    );
    this.unitsProgram = createProgram(
      gl,
      shaderSrc(fogUnitsVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      fogUnitsFragSrc,
    );
    this.dilateProgram = createProgram(
      gl,
      fullscreenNoUvVertSrc,
      shaderSrc(fogDilateFragSrc, { FOG_R: TERRON_FOG_VISION_RADIUS }),
    );
    this.compositeProgram = createProgram(
      gl,
      shaderSrc(fogCompositeVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      // MAP_W/H нужны и фрагментному: волна «Неба нашего» считает дистанцию в тайлах
      shaderSrc(fogCompositeFragSrc, { MAP_W: mapW, MAP_H: mapH }),
    );

    this.uDilateDir = gl.getUniformLocation(this.dilateProgram, "uDir")!;
    this.uCamera = gl.getUniformLocation(this.compositeProgram, "uCamera")!;
    this.uTerrainDim = gl.getUniformLocation(
      this.compositeProgram,
      "uTerrainDim",
    )!;
    this.uWaveMode = gl.getUniformLocation(this.compositeProgram, "uWaveMode")!;
    this.uWave = gl.getUniformLocation(this.compositeProgram, "uWave")!;
    this.uRevealCount = gl.getUniformLocation(
      this.compositeProgram,
      "uRevealCount",
    )!;
    this.uReveals = gl.getUniformLocation(this.compositeProgram, "uReveals")!;

    gl.useProgram(this.seedProgram);
    gl.uniform1i(gl.getUniformLocation(this.seedProgram, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.seedProgram, "uFriendlyTex"), 1);
    gl.useProgram(this.dilateProgram);
    gl.uniform1i(gl.getUniformLocation(this.dilateProgram, "uSrc"), 0);
    gl.useProgram(this.compositeProgram);
    gl.uniform1i(gl.getUniformLocation(this.compositeProgram, "uVisTex"), 0);
    gl.uniform1i(
      gl.getUniformLocation(this.compositeProgram, "uTerrainTex"),
      1,
    );
    gl.uniform1i(
      gl.getUniformLocation(this.compositeProgram, "uTerrainLut"),
      2,
    );

    const makeTarget = (
      filter: number,
    ): { tex: WebGLTexture; fbo: WebGLFramebuffer } => {
      const tex = createTexture2D(gl, {
        width: mapW,
        height: mapH,
        internalFormat: gl.R8,
        format: gl.RED,
        type: gl.UNSIGNED_BYTE,
        data: null,
        filter,
      });
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        tex,
        0,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fbo };
    };

    const seed = makeTarget(gl.NEAREST);
    this.seedTex = seed.tex;
    this.seedFbo = seed.fbo;
    const tmp = makeTarget(gl.NEAREST);
    this.tmpTex = tmp.tex;
    this.tmpFbo = tmp.fbo;
    // vis — LINEAR: композит сэмплит билинейно → мягкая кромка тумана.
    const vis = makeTarget(gl.LINEAR);
    this.visTex = vis.tex;
    this.visFbo = vis.fbo;

    this.friendlyTex = createTexture2D(gl, {
      width: FRIENDLY_LUT_SIZE,
      height: 1,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: this.friendlyCpu,
      filter: gl.NEAREST,
    });

    this.fullscreenVao = createFullscreenQuad(gl);
    this.mapQuadVao = createMapQuad(gl, mapW, mapH);

    // VAO точек юнитов (динамический буфер, перезаливается на тик).
    this.unitsVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.unitsVao);
    this.unitsBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitsBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.unitsXY, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /**
   * Вкл/выкл тумана (конфиг лобби × фаза × жив × не реплей × блэкаут «Неба
   * нашего»). wave = эпицентр: переход анимируется волной тьмы (вкл) или
   * света (выкл) за TERRON_OURSKY_WAVE_MS; contract = ОБРАТНАЯ анимация
   * (круг света схлопывается в эпицентр — возврат тумана в фог-матче);
   * без wave — мгновенно.
   */
  setEnabled(
    on: boolean,
    wave?: { x: number; y: number; contract?: boolean },
  ): void {
    if (on === this.enabled) return;
    // Первое включение тумана — только тут аллоцируем GPU-ресурсы.
    if (on) this.ensureAllocated();
    if (wave !== undefined) {
      this.waveMode = on ? 1 : 2;
      this.waveContract = wave.contract === true;
      this.waveCx = wave.x;
      this.waveCy = wave.y;
      this.waveStart = performance.now();
    } else {
      this.waveMode = 0;
      this.waveContract = false;
    }
    this.enabled = on;
    this.dirty = true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * terron: окна видимости после своих ударов/высадок — круги (x, y, r) в
   * тайлах, радиус уже схлопнут CPU-стороной (GameView.fogReveals). Пер-тик.
   */
  setReveals(reveals: Array<{ x: number; y: number; r: number }>): void {
    const n = Math.min(reveals.length, MAX_REVEALS);
    for (let i = 0; i < n; i++) {
      this.revealsCpu[i * 3] = reveals[i].x;
      this.revealsCpu[i * 3 + 1] = reveals[i].y;
      this.revealsCpu[i * 3 + 2] = reveals[i].r;
    }
    this.revealCount = n;
  }

  setLocalPlayer(id: number): void {
    if (id === this.localPlayerID) return;
    this.localPlayerID = id;
    this.rebuildFriendlyLut();
  }

  /** Союзники + сокомандники локального игрока (smallID). Без самого игрока. */
  setFriendly(friendly: ReadonlySet<number>): void {
    // Дешёвая проверка на равенство — сет меняется редко.
    if (
      friendly.size === this.friendlySet.size &&
      [...friendly].every((id) => this.friendlySet.has(id))
    ) {
      return;
    }
    this.friendlySet = new Set(friendly);
    this.rebuildFriendlyLut();
  }

  private rebuildFriendlyLut(): void {
    this.friendlyCpu.fill(0);
    if (this.localPlayerID > 0 && this.localPlayerID < FRIENDLY_LUT_SIZE) {
      this.friendlyCpu[this.localPlayerID] = 1;
    }
    for (const id of this.friendlySet) {
      if (id > 0 && id < FRIENDLY_LUT_SIZE) this.friendlyCpu[id] = 1;
    }
    this.friendlyDirty = true;
    this.dirty = true;
  }

  /**
   * Пер-тик: собрать позиции своих/союзных юнитов (дают обзор в пути) и
   * пометить маску на пересчёт. Зовётся из Renderer.updateUnits.
   */
  updateUnits(units: ReadonlyMap<number, UnitState>): void {
    this.dirty = true;
    if (!this.enabled || this.localPlayerID === 0) return;
    let n = 0;
    for (const u of units.values()) {
      if (!u.isActive) continue;
      if (
        u.ownerID !== this.localPlayerID &&
        this.friendlyCpu[u.ownerID] === 0
      ) {
        continue;
      }
      if (n >= this.unitsCapacity) {
        this.unitsCapacity *= 2;
        const next = new Float32Array(this.unitsCapacity * 2);
        next.set(this.unitsXY);
        this.unitsXY = next;
      }
      this.unitsXY[n * 2] = u.pos % this.mapW;
      this.unitsXY[n * 2 + 1] = (u.pos - (u.pos % this.mapW)) / this.mapW;
      n++;
    }
    this.unitsCount = n;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Пересчёт маски видимости (3 прохода в map-res FBO). Зовётся из
   * computeTextures раз в тик (dirty-гейт). На выходе — дефолтный framebuffer;
   * viewport восстанавливает renderFrame.
   */
  compute(): void {
    // localPlayerID=0 (спавн-фаза, игрок ещё не создан) — считаем с пустым
    // LUT: маска нулевая → туман сплошной. Это ЖЕЛАЕМОЕ поведение 12.07.
    if (!this.enabled || !this.dirty) return;
    this.dirty = false;
    this.computedOnce = true;
    const gl = this.gl;

    if (this.friendlyDirty) {
      this.friendlyDirty = false;
      gl.bindTexture(gl.TEXTURE_2D, this.friendlyTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        FRIENDLY_LUT_SIZE,
        1,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        this.friendlyCpu,
      );
    }

    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.mapW, this.mapH);

    // 1. seed: своя/союзная территория
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.seedFbo);
    gl.useProgram(this.seedProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.friendlyTex);
    gl.bindVertexArray(this.fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2. штамп юнитов (точки поверх seed)
    if (this.unitsCount > 0) {
      gl.useProgram(this.unitsProgram);
      gl.bindVertexArray(this.unitsVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitsBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.unitsXY, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, this.unitsCount);
    }

    // 3. дилатация: seed → tmp (по X), tmp → vis (по Y)
    gl.useProgram(this.dilateProgram);
    gl.bindVertexArray(this.fullscreenVao);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tmpFbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.seedTex);
    gl.uniform2i(this.uDilateDir, 1, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.visFbo);
    gl.bindTexture(gl.TEXTURE_2D, this.tmpTex);
    gl.uniform2i(this.uDilateDir, 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Композит тумана поверх карто-слоёв. Зовётся из renderOverlays после
   * name/world-text и перед radial-menu; блендинг уже включён (SRC_ALPHA).
   */
  draw(cameraMatrix: Float32Array): void {
    // Волна света (выключение) дорисовывает туман снаружи круга, пока идёт.
    // localPlayerID НЕ гейтим: в спавн-фазе игрока ещё нет — туман сплошной.
    const waveActive = this.waveMode !== 0;
    if (!this.computedOnce) return;
    if (!this.enabled && !(waveActive && this.waveMode === 2)) return;

    let waveRadius = 0;
    let shaderMode = this.waveMode;
    if (waveActive) {
      const t = (performance.now() - this.waveStart) / TERRON_OURSKY_WAVE_MS;
      if (t >= 1) {
        // Волна доехала: тьма → сплошной туман, свет → туман погашен.
        this.waveMode = 0;
        shaderMode = 0;
        if (!this.enabled) return;
      } else if (this.waveContract) {
        // Обратная анимация: круг СХЛОПЫВАЕТСЯ в эпицентр. Зона инвертирована:
        // возвращающийся туман живёт СНАРУЖИ сжимающегося круга света.
        waveRadius = (1 - t) * this.waveMaxRadius;
        shaderMode = this.waveMode === 1 ? 2 : 1;
      } else {
        waveRadius = t * this.waveMaxRadius;
      }
    }

    const gl = this.gl;
    gl.useProgram(this.compositeProgram);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTerrainDim, FOG_TERRAIN_DIM);
    gl.uniform1i(this.uWaveMode, shaderMode);
    gl.uniform3f(this.uWave, this.waveCx, this.waveCy, waveRadius);
    gl.uniform1i(this.uRevealCount, this.revealCount);
    if (this.revealCount > 0) {
      gl.uniform3fv(
        this.uReveals,
        this.revealsCpu.subarray(0, this.revealCount * 3),
      );
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.visTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainLut);
    gl.bindVertexArray(this.mapQuadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    if (!this.allocated) return; // туман так и не включали — освобождать нечего
    const gl = this.gl;
    gl.deleteProgram(this.seedProgram);
    gl.deleteProgram(this.unitsProgram);
    gl.deleteProgram(this.dilateProgram);
    gl.deleteProgram(this.compositeProgram);
    gl.deleteTexture(this.seedTex);
    gl.deleteTexture(this.tmpTex);
    gl.deleteTexture(this.visTex);
    gl.deleteTexture(this.friendlyTex);
    gl.deleteFramebuffer(this.seedFbo);
    gl.deleteFramebuffer(this.tmpFbo);
    gl.deleteFramebuffer(this.visFbo);
    gl.deleteBuffer(this.unitsBuf);
  }
}

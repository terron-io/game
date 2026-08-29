/**
 * GPURenderer v2 — normalized render pipeline.
 *
 * Draw order:
 *   DATA SYNC: tile flush → heat update → border compute
 *   BASE PASS (darkened by night): terrain → territory fill + stale-nuke ground
 *   NIGHT COMPOSITE (optional): lightmap → scene × (ambient + lightmap)
 *   FULL BRIGHTNESS (always): borders → railroads → ground units → structures →
 *     structure levels → bars → bloom → trails → missiles → fx → conquest → names
 */

import type { Config } from "../../../core/configuration/Config";
import {
  fortHqRangeMult,
  fortRangeMult,
} from "../../../core/configuration/TerronTuning";
import type {
  AttackRingInput,
  BonusEvent,
  ConquestFx,
  DeadUnitFx,
  GhostPreviewData,
  NameEntry,
  NukeTelegraphData,
  NukeTrajectoryData,
  PlayerState,
  PlayerStatic,
  PlayerStatusData,
  RendererConfig,
  TilePair,
  UnitState,
} from "../types";
import { UT_SUICIDE_DRONE } from "../types";
import { Camera } from "./Camera";
import { filterHiddenUnits } from "./ClosedCountryFilter";
import type { RadialMenuItem } from "./Events";
import {
  captureCreationErrors,
  noteGlContextCreated,
  noteGlCreationFailures,
} from "./GlContext";
import { BarPass } from "./passes/BarPass";
import { BorderComputePass } from "./passes/BorderComputePass";
import { BorderStampPass } from "./passes/BorderStampPass";
import { CoordinateGridPass } from "./passes/CoordinateGridPass";
import { CrosshairPass } from "./passes/CrosshairPass";
import { DefenseCoveragePass } from "./passes/DefenseCoveragePass";
import { FalloutBloomPass } from "./passes/FalloutBloomPass";
import { FalloutLightPass } from "./passes/FalloutLightPass";
import { FogPass } from "./passes/FogPass";
import { FxPass } from "./passes/fx-pass";
import { NUKE_EXPLOSION_RADII } from "./passes/fx-pass/FxSpritePass";
import { LightmapPass } from "./passes/LightmapPass";
import { MoveIndicatorPass } from "./passes/MoveIndicatorPass";
import { NamePass } from "./passes/name-pass";
import { NightCompositePass } from "./passes/NightCompositePass";
import { NukeTelegraphPass } from "./passes/NukeTelegraphPass";
import { NukeTrajectoryPass } from "./passes/NukeTrajectoryPass";
import { PointLightPass } from "./passes/PointLightPass";
import { RadialMenuPass } from "./passes/RadialMenuPass";
import { RailroadPass } from "./passes/RailroadPass";
import { RangeCirclePass } from "./passes/RangeCirclePass";
import { SAMRadiusPass } from "./passes/SamRadiusPass";
import { SelectionBoxPass } from "./passes/SelectionBoxPass";
import { SkinAtlasArray } from "./passes/SkinAtlasArray";
import type { SpawnCenter } from "./passes/SpawnOverlayPass";
import { SpawnOverlayPass } from "./passes/SpawnOverlayPass";
import { StructureLevelPass } from "./passes/StructureLevelPass";
import { StructurePass } from "./passes/StructurePass";
import { TerrainPass } from "./passes/TerrainPass";
import { TerritoryPass } from "./passes/TerritoryPass";
import { TrailPass } from "./passes/TrailPass";
import { UnitPass } from "./passes/UnitPass";
import { WorldTextPass } from "./passes/WorldTextPass";
import { createRenderSettings, type RenderSettings } from "./RenderSettings";
import { AffiliationPalette } from "./utils/Affiliation";
import { getPaletteSize } from "./utils/ColorUtils";
import {
  createTexture2D,
  prewarmPrograms,
  prewarmShaders,
  toScreen,
  toTarget,
  type RenderTarget,
} from "./utils/GlUtils";
import {
  createGPUResources,
  disposeGPUResources,
  type GPUResources,
} from "./utils/GpuResources";
import { HeatManager } from "./utils/HeatManager";
import { eagerProgramPairs } from "./utils/ProgramRegistry";
import { FALLOUT_BIT } from "./utils/TileCodec";

/** Ghost types that trigger SAM radius overlay (matches upstream SAMRadiusLayer). */
const SAM_RADIUS_GHOST_TYPES = new Set([
  "Missile Silo",
  "SAM Launcher",
  "City",
  "Atom Bomb",
  "Hydrogen Bomb",
]);

/** Subset for build-button hover — excludes City/Silo (SAM radii irrelevant). */
const SAM_RADIUS_HIGHLIGHT_TYPES = new Set([
  "SAM Launcher",
  "Atom Bomb",
  "Hydrogen Bomb",
]);

// terron 20.07: счётчик GL-контекстов за жизнь вкладки (см. gl_context_churn)
// живёт в GlContext.ts — его читает ещё и отчёт об ошибке.

export class GPURenderer {
  private gl: WebGL2RenderingContext;
  private camera: Camera;
  private res: GPUResources;

  // Passes
  private terrainPass: TerrainPass;
  private territoryPass: TerritoryPass;
  private trailPass: TrailPass;
  private borderStampPass: BorderStampPass;
  private borderPass: BorderComputePass;
  private defenseCoveragePass: DefenseCoveragePass;
  // terron ПЕРФ (07.08): ТУМАН ВОЙНЫ — ЛЕНИВЫЙ. Это опция лобби (плюс ульта
  // «Небо наше»), в большинстве матчей выключенная, а пасс компилировал 5
  // GL-программ всегда. Строим при первом ВКЛЮЧЕНИИ тумана.
  //
  // ⚠️ Состояние приходит РАНЬШЕ включения (свой id, союзники, окна обзора),
  // поэтому копим последние значения и переигрываем их на пассе сразу после
  // постройки — иначе туман зажёгся бы «не зная» ни игрока, ни союзников.
  // Юниты не копим: updateUnits зовётся каждый тик и придёт сам следующим.
  private fogPass: FogPass | null = null;
  private fogLocalPlayer: number | null = null;
  private fogFriendly: ReadonlySet<number> | null = null;
  private fogReveals: Array<{ x: number; y: number; r: number }> | null = null;
  private fog(): FogPass {
    if (this.fogPass === null) {
      this.fogPass = new FogPass(
        this.gl,
        this.mapW,
        this.mapH,
        this.res.tileTex,
        this.res.terrainTex,
        this.terrainPass.getLutTex(),
      );
      if (this.fogLocalPlayer !== null) {
        this.fogPass.setLocalPlayer(this.fogLocalPlayer);
      }
      if (this.fogFriendly !== null) this.fogPass.setFriendly(this.fogFriendly);
      if (this.fogReveals !== null) this.fogPass.setReveals(this.fogReveals);
      if (this.lastUnits !== null) this.fogPass.updateUnits(this.lastUnits);
      this.fogPass.markDirty();
    }
    return this.fogPass;
  }
  // terron ПЕРФ (07.08): ЦЕПОЧКА ОСВЕЩЕНИЯ — ЛЕНИВАЯ. `lighting.enabled` в
  // render-settings.json = false, и переключается только в дебаг-GUI, а четыре
  // пасса компилировали 9 GL-программ у КАЖДОГО игрока в КАЖДОМ матче впустую.
  // Телеметрия: 8.7% мобильных заходов тратили на сборку рендера >2.5с
  // (медиана 3.6с, p90 7.1с) — это застывший главный поток ровно в те
  // секунды, где чаще всего теряется WebGL-контекст (все 115 потерь за 14
  // дней — на ПЕРВОМ матче сессии). Строим только когда свет реально включат.
  private pointLightPass: PointLightPass | null = null;
  private falloutLightPass: FalloutLightPass | null = null;
  private lightmapPass: LightmapPass | null = null;
  private nightCompositePass: NightCompositePass | null = null;
  private pointLight(): PointLightPass {
    return (this.pointLightPass ??= new PointLightPass(
      this.gl,
      this.header,
      this.paletteData,
      this.settings,
    ));
  }
  private falloutLight(): FalloutLightPass {
    return (this.falloutLightPass ??= new FalloutLightPass(
      this.gl,
      this.mapW,
      this.mapH,
      this.res.tileTex,
      this.heatManager,
      this.settings,
    ));
  }
  private lightmap(): LightmapPass {
    return (this.lightmapPass ??= new LightmapPass(
      this.gl,
      this.mapW,
      this.mapH,
      this.pointLight(),
      this.falloutLight(),
      this.settings,
    ));
  }
  private nightComposite(): NightCompositePass {
    return (this.nightCompositePass ??= new NightCompositePass(
      this.gl,
      this.settings,
    ));
  }
  // terron: Закрытая страна — smallID игроков, чьи юниты нам не показывают.
  private unitsHidden: ReadonlySet<number> = new Set();
  private structurePass: StructurePass;
  private structureLevelPass: StructureLevelPass;
  private unitPass: UnitPass;
  private namePass: NamePass;
  private fxPass: FxPass;
  // terron ПЕРФ (07.08): ЛЕНИВЫЕ ПАССЫ ПРЕВЬЮ-ПОСТРОЙКИ И Ж/Д (6 GL-программ).
  // Все три нужны только по действию игрока и уже умеют «спать» (draw делает
  // ранний возврат), но КОНСТРУИРОВАЛИСЬ на старте, тратя линковку программ и
  // создание ресурсов в самое узкое место — сборку GL-вида (8.7% мобильных
  // заходов дольше 2.5с). Теперь решение «нужен ли пасс» поднято сюда: строим
  // при первом реальном включении, шейдеры к тому моменту уже прогреты
  // (prewarmShaders), так что постройка по клику дешёвая.
  private rangeCirclePass: RangeCirclePass | null = null;
  private rangeCircle(): RangeCirclePass {
    return (this.rangeCirclePass ??= new RangeCirclePass(this.gl));
  }
  private samRadiusPass: SAMRadiusPass;
  private crosshairPass: CrosshairPass | null = null;
  private crosshair(): CrosshairPass {
    return (this.crosshairPass ??= new CrosshairPass(this.gl));
  }
  private railroadPass: RailroadPass | null = null;
  private railroad(): RailroadPass {
    return (this.railroadPass ??= new RailroadPass(
      this.gl,
      this.mapW,
      this.mapH,
      this.res.tileTex,
      this.paletteTex,
      this.res.terrainTex,
      this.settings,
    ));
  }
  private barPass: BarPass;
  private worldTextPass: WorldTextPass;
  // terron 20.07: ЛЕНИВЫЙ пасс — собирается при первом обращении, не на
  // старте матча. Сборка 30 GL-программ разом душила слабые машины
  // (замер: gfx 6.7с на загруженном ноуте) и роняла Intel-драйверы.
  private radialMenuPass: RadialMenuPass | null = null;
  private radialMenu(): RadialMenuPass {
    return (this.radialMenuPass ??= new RadialMenuPass(this.gl));
  }
  // terron 20.07: ЛЕНИВЫЙ пасс — собирается при первом обращении, не на
  // старте матча. Сборка 30 GL-программ разом душила слабые машины
  // (замер: gfx 6.7с на загруженном ноуте) и роняла Intel-драйверы.
  private selectionBoxPass: SelectionBoxPass | null = null;
  private selectionBox(): SelectionBoxPass {
    return (this.selectionBoxPass ??= new SelectionBoxPass(this.gl));
  }
  // terron 20.07: ЛЕНИВЫЙ пасс — собирается при первом обращении, не на
  // старте матча. Сборка 30 GL-программ разом душила слабые машины
  // (замер: gfx 6.7с на загруженном ноуте) и роняла Intel-драйверы.
  private moveIndicatorPass: MoveIndicatorPass | null = null;
  private moveIndicator(): MoveIndicatorPass {
    return (this.moveIndicatorPass ??= new MoveIndicatorPass(
      this.gl,
      this.settings,
    ));
  }
  // terron 20.07: ЛЕНИВЫЙ пасс — собирается при первом обращении, не на
  // старте матча. Сборка 30 GL-программ разом душила слабые машины
  // (замер: gfx 6.7с на загруженном ноуте) и роняла Intel-драйверы.
  private nukeTrajectoryPass: NukeTrajectoryPass | null = null;
  private nukeTrajectory(): NukeTrajectoryPass {
    return (this.nukeTrajectoryPass ??= new NukeTrajectoryPass(
      this.gl,
      this.settings,
    ));
  }
  // terron 20.07: ЛЕНИВЫЙ пасс — собирается при первом обращении, не на
  // старте матча. Сборка 30 GL-программ разом душила слабые машины
  // (замер: gfx 6.7с на загруженном ноуте) и роняла Intel-драйверы.
  // terron 20.07: ЛЕНИВЫЙ пасс — 3 GL-программы блума собираются только когда
  // после первой ядерки реально появился жар (draw и так за этим условием).
  // На старте матча они не нужны, а стоят заметную часть сборки рендера.
  private bloomPass: FalloutBloomPass | null = null;
  private bloom(): FalloutBloomPass {
    return (this.bloomPass ??= new FalloutBloomPass(
      this.gl,
      this.mapW,
      this.mapH,
      this.res.tileTex,
      this.heatManager,
      this.settings,
    ));
  }
  // terron 20.07: ЛЕНИВЫЙ пасс — сетка рисуется только при включённой сетке
  // или альт-виде; на старте не нужна.
  private coordinateGridPass: CoordinateGridPass | null = null;
  private coordinateGrid(): CoordinateGridPass {
    return (this.coordinateGridPass ??= new CoordinateGridPass(
      this.gl,
      this.mapW,
      this.mapH,
      this.settings,
    ));
  }
  private nukeTelegraphPass: NukeTelegraphPass | null = null;
  private nukeTelegraph(): NukeTelegraphPass {
    return (this.nukeTelegraphPass ??= new NukeTelegraphPass(
      this.gl,
      this.settings,
    ));
  }
  private heatManager: HeatManager;
  private affiliationPalette: AffiliationPalette;
  private spawnOverlayPass: SpawnOverlayPass;
  private inSpawnPhase = false;

  private paletteTex: WebGLTexture;
  private paletteData: Float32Array;
  /** terron ПЕРФ (07.08): нужен ленивым пассам освещения, см. pointLight(). */
  private header: RendererConfig;

  /**
   * terron ПЕРФ (08.08, пункт A2 журнала аудита): ФАЗЫ СБОРКИ GL-ВИДА, мс.
   *
   * Телеметрия говорит, что 8.7% мобильных заходов собирают вид дольше 2.5с
   * (медиана 3.6с, p90 7.1с, максимум 16с) — но НЕ говорит, из чего эти секунды
   * состоят. Локальный замер бесполезен: на разработческой машине сборка
   * быстрая. Разбивка есть в `camDiag`, но он включён только на деве и по
   * `?debug=perf`, то есть у пострадавших он выключен.
   *
   * Поэтому меряем ВСЕГДА, но дёшево: четыре `performance.now()` за всю сборку.
   * Числа уходят в meta датчика `slow_renderer_build` — и мы наконец узнаем,
   * что именно держит игрока: текстуры, прогрев шейдеров, линковка программ
   * или конструирование пассов.
   */
  private buildPhases: Record<string, number> = {};
  getBuildPhases(): Readonly<Record<string, number>> {
    return this.buildPhases;
  }
  private patternMetaTex: WebGLTexture;
  private patternDataTex: WebGLTexture;
  private skinAtlas: SkinAtlasArray;
  private skinLayerTex: WebGLTexture;
  /** CPU-side mirror of skinLayerTex (0 = no skin, otherwise layer + 1). */
  private skinLayerCpu: Uint8Array;
  /** Per-player anchor (x,y) for skin sampling. (0,0) = world-origin anchor. */
  private skinAnchorTex: WebGLTexture;
  private skinAnchorCpu: Uint16Array;
  /** terron виральность: per-owner параметры скина (RGBA32F: R=mode, G=tileTiles, B=dim). */
  private skinParamsTex: WebGLTexture;
  private skinParamsCpu: Float32Array;
  /** terron: per-owner AABB территории (RGBA32F) для stretch (mode 2). Заполняет TerritoryPass. */
  private skinBBoxTex: WebGLTexture;
  /** terron: есть ли хоть один stretch-скин (mode 2) → нужен пересчёт AABB. */
  private anyStretchSkin = false;
  private canvas: HTMLCanvasElement;
  private settings: RenderSettings;
  private sceneTarget: RenderTarget;
  private raf: typeof requestAnimationFrame;
  private caf: typeof cancelAnimationFrame;

  private animId: number | null = null;
  // Кадро-скип в простое: держим 60fps пока есть активность (данные/камера/ввод/
  // спавн) за последние GRACE мс; иначе падаем до HEARTBEAT. В активном матче
  // юниты обновляются каждый тик → grace не истекает → плавность не страдает.
  private lastActivityMs = 0;
  private lastDrawMs = 0;
  private lastCamX = NaN;
  private lastCamY = NaN;
  private lastCamZoom = NaN;
  private readonly idleGraceMs = 700;
  private readonly idleHeartbeatMs = 250;
  private frameTick = 0;
  private mapW = 0;
  private mapH = 0;

  // FPS tracking
  private frameTimes: Float64Array = new Float64Array(60);
  private frameIdx = 0;
  private frameCount = 0;
  fps = 0;
  onFrame: ((ms: number) => void) | null = null;
  afterRender: ((canvas: HTMLCanvasElement) => void) | null = null;

  // Hit-testing references
  private lastUnits: Map<number, UnitState> = new Map();
  private lastStructures: Map<number, UnitState> = new Map();

  // Local player relationship data (for SAM radius coloring)
  private localPlayerID = 0;
  private playerTeams = new Map<number, string>(); // smallID → team

  // Alt-view: affiliation recoloring (space hold)
  private altView = false;
  // Grid-view: coordinate grid overlay (M toggle)
  private gridView = false;

  // SAM radius visibility tracking (show if either source is true)
  private samGhostVisible = false;
  private samHighlightVisible = false;

  // Warship selection — supports any number of selections.
  private selectedUnitIds: number[] = [];
  /** Reusable scratch buffer of {x,y,r,g,b} for the selection-box pass. */
  private readonly selectionBoxEntries: import("./passes/SelectionBoxPass").SelectionEntry[] =
    [];

  constructor(
    canvas: HTMLCanvasElement,
    header: RendererConfig,
    terrainBytes: Uint8Array,
    paletteData: Float32Array,
    config: Config,
    raf: typeof requestAnimationFrame = requestAnimationFrame.bind(window),
    caf: typeof cancelAnimationFrame = cancelAnimationFrame.bind(window),
  ) {
    this.canvas = canvas;
    this.settings = createRenderSettings();
    this.raf = raf;
    this.caf = caf;

    // terron: часть машин (старая гибридная графика, блоклист «high-performance»
    // GPU, старый Win7+Firefox) отдаёт null на high-performance-запрос, но
    // соглашается на дефолтные атрибуты — ретраим по нисходящей вместо мгновенного
    // отказа «WebGL2 not supported». Реально спасает часть ретроградов.
    // terron ПЕРФ (память, 12.07): depth/stencil-буферы бэкбуфера ОТКЛЮЧЕНЫ —
    // рендер чисто 2D-композитный, ни один пасс не включает DEPTH_TEST
    // (проверено грепом). Дефолт depth:true стоил ~4 байта на пиксель
    // бэкбуфера нативной памяти (на телефоне с DPR 2 — ~5-7МБ впустую).
    const ctxAttrs: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
    };
    // terron 10.08: причину отказа браузер сообщает ТОЛЬКО событием
    // `webglcontextcreationerror`, и подписаться надо ДО getContext. Без него
    // репорт игрока — голое «WebGL2 not supported», по которому неотличимы
    // «нет WebGL2 на железе», «браузер выключил ускорение» и «сожжён лимит
    // контекстов» (репорт 10.08, Firefox/Win10: даже одноразовый WebGL1 не
    // создавался — то есть дело было не в нашем движке, а доказать было нечем).
    const takeCreationErrors = captureCreationErrors(canvas);
    const gl =
      canvas.getContext("webgl2", {
        ...ctxAttrs,
        powerPreference: "high-performance",
      }) ??
      canvas.getContext("webgl2", ctxAttrs) ??
      canvas.getContext("webgl2");
    const creationErrors = takeCreationErrors();
    if (!gl) {
      noteGlCreationFailures(creationErrors);
      throw new Error(
        creationErrors.length > 0
          ? `WebGL2 not supported: ${creationErrors.join(" | ")}`
          : "WebGL2 not supported (браузер не назвал причину)",
      );
    }
    // terron 20.07: считаем контексты за жизнь вкладки. Браузер даёт их ~16,
    // и раньше мы их роняли без loseContext — исчерпание выглядело как
    // «WebGL2 не поддерживается» на исправной машине. Правка от 20.07 должна
    // держать счёт единицами; всплеск здесь = утечка вернулась.
    const contextNo = noteGlContextCreated();
    if (contextNo === 4) {
      void import("../../Health").then(({ reportHealth }) =>
        reportHealth("gl_context_churn", `${contextNo} контекста`),
      );
    }
    this.gl = gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const floatExt = gl.getExtension("EXT_color_buffer_float");
    if (!floatExt)
      console.warn("EXT_color_buffer_float not available — palette may fail");

    const mapW = header.mapWidth;
    const mapH = header.mapHeight;
    this.mapW = mapW;
    this.mapH = mapH;

    this.camera = new Camera(mapW, mapH);

    // --- Terrain (static) ---
    // terron ПЕРФ (память, 12.07): TerrainPass создаётся ПОЗЖЕ, от общей
    // R8UI-текстуры из GPUResources (сырые байты + LUT в шейдере). Здесь
    // раньше жил buildTerrainRGBA — transient RGBA-массив 4 байта/px в самый
    // пик загрузки (32МБ на гигантской карте) — он удалён совсем.

    // --- Shared palette texture (RGBA32F, 4096×2) ---
    this.paletteData = paletteData;
    this.header = header;
    const palW = getPaletteSize();
    this.paletteTex = createTexture2D(gl, {
      width: palW,
      height: 2,
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      data: paletteData,
      filter: gl.NEAREST,
    });

    this.patternMetaTex = createTexture2D(gl, {
      width: palW,
      height: 1,
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      data: new Float32Array(palW * 4),
      filter: gl.NEAREST,
    });

    // terron ПЕРФ (07.08): data было `new Uint8Array(palW * 1024)` — 4 МБ
    // нулей, которые сначала зануляются на CPU, а потом целиком гонятся через
    // command buffer в самый пик сборки вида. Отдаём null: браузер зануляет
    // содержимое сам (на этом уже держится SkinAtlasArray — см. комментарий
    // «Layers are zero-initialized» в initSkinAtlas), а настоящие паттерны
    // приезжают позже точечными texSubImage2D из addPlayers().
    this.patternDataTex = createTexture2D(gl, {
      width: 1024,
      height: palW,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: null,
      filter: gl.NEAREST,
    });

    // --- Skin atlas (TEXTURE_2D_ARRAY of PNG layers) + per-player layer map ---
    this.skinLayerCpu = new Uint8Array(palW);
    this.skinLayerTex = createTexture2D(gl, {
      width: palW,
      height: 1,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: this.skinLayerCpu,
      filter: gl.NEAREST,
    });
    // Per-player skin anchor: RG16UI, 2× uint16 per player → 4 bytes each.
    // (0,0) sentinel means "no anchor" — shader uses world origin.
    this.skinAnchorCpu = new Uint16Array(palW * 2);
    this.skinAnchorTex = createTexture2D(gl, {
      width: palW,
      height: 1,
      internalFormat: gl.RG16UI,
      format: gl.RG_INTEGER,
      type: gl.UNSIGNED_SHORT,
      data: this.skinAnchorCpu,
      filter: gl.NEAREST,
    });
    // terron виральность: per-owner параметры скина (mode/tileTiles/dim) + AABB для stretch.
    this.skinParamsCpu = new Float32Array(palW * 4);
    this.skinParamsTex = createTexture2D(gl, {
      width: palW,
      height: 1,
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      data: this.skinParamsCpu,
      filter: gl.NEAREST,
    });
    this.skinBBoxTex = createTexture2D(gl, {
      width: palW,
      height: 1,
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      data: new Float32Array(palW * 4),
      filter: gl.NEAREST,
    });

    // Construct with no URLs — the real atlas is built once initSkinAtlas() is
    // called with the locked-in player skin URLs at game start.
    this.skinAtlas = new SkinAtlasArray(gl, [], () => {});

    // --- Border compute (creates its own borderTex) ---
    // Need a temporary tileTex reference for border compute — we'll create
    // GPUResources first, then wire everything.
    // But borderPass creates its own borderTex internally, so we need to
    // create GPUResources with it. Let's sequence carefully:

    // 1. Create GPUResources (creates tileTex, trailTex, heatTexA/B)
    //    borderTex placeholder — we'll get it from borderPass
    //    First create a dummy, then replace after borderPass is created.

    // Actually: borderPass creates its own internal borderTex (RG8).
    // We need tileTex to exist before borderPass. So:
    //   a) Create shared resources (tileTex, trailTex, heatA/B)
    //   b) Create borderPass with tileTex → gives us borderTex
    //   c) Store borderTex in res

    // terron 20.07 ПЕРФ: отправляем ВСЕ шейдеры на компиляцию до сборки пассов.
    // Драйвер собирает их параллельно, пока мы создаём текстуры; пассы ниже
    // забирают готовое из кэша. Раньше 74 компиляции шли в очередь по одной,
    // потому что после каждой сразу запрашивался статус (см. GlUtils).
    //
    // terron 21.07: НО на слабом интегрированном Intel параллельный залп 74
    // шейдеров САТУРИРУЕТ D3D-компилятор ANGLE — тяжёлый structure.vert (пасс #20,
    // динамическая индексация uniform-массива) падает свежей компиляцией с ПУСТЫМ
    // логом (репорт WxbE63jv), хотя в ИЗОЛЯЦИИ тот же шейдер и 60 программ подряд
    // собираются (подтверждено его же /debug). Пропускаем прогрев на таком железе
    // → компиляция идёт серийно, со статус-чеком после каждой, как в диагностике.
    // Старт на пару секунд дольше, зато не крэшит. Остальные машины — быстрый путь.
    let phaseMark = performance.now();
    if (!this.weakIntelGpu()) prewarmShaders(gl);
    this.buildPhases.шейдеры = Math.round(performance.now() - phaseMark);

    // Create shared textures except borderTex
    phaseMark = performance.now();
    this.res = createGPUResources(
      gl,
      mapW,
      mapH,
      this.paletteTex,
      null!,
      terrainBytes,
    );

    // terron ПЕРФ (08.08): отправляем на ЛИНКОВКУ все программы жадных пассов
    // ДО того, как построен первый из них. Драйвер линкует их параллельно, пока
    // мы создаём VAO/буферы/текстуры, и первый getUniformLocation ждёт ОДНУ
    // программу вместо очереди из всех (замер в GlUtils: линковка 609мс шла
    // строго последовательно). На слабом Intel/ANGLE пропускаем по той же
    // причине, что и прогрев шейдеров: параллельный залп сатурирует компилятор.
    phaseMark = performance.now();
    if (!this.weakIntelGpu()) {
      prewarmPrograms(gl, eagerProgramPairs(mapW, mapH));
    }
    this.buildPhases.программы = Math.round(performance.now() - phaseMark);
    phaseMark = performance.now(); // дальше — конструирование пассов

    // --- Terrain: рисует из общей R8UI-текстуры через LUT ---
    this.terrainPass = new TerrainPass(gl, this.res.terrainTex, mapW, mapH);

    // --- Border compute (needs tileTex) ---
    this.borderPass = new BorderComputePass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.settings,
    );
    this.res.borderTex = this.borderPass.getBorderTex();

    // --- Defense coverage (needs tileTex) — per-tile "defended by same-owner
    // post" flag, stamped one instanced circle per post. Replaces the old
    // 64-cap uniform loop; consumed by BorderStampPass. ---
    this.defenseCoveragePass = new DefenseCoveragePass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.settings,
    );

    // --- terron: туман войны (опция лобби) — маска видимости + композит ---
    // --- Туман войны: ЛЕНИВЫЙ, см. fog(). 5 GL-программ ради опции лобби,
    //     которая в подавляющем большинстве матчей выключена. ---

    // --- Heat manager (needs tileTex, heatTexA/B) ---
    this.heatManager = new HeatManager(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.res.heatTexA,
      this.res.heatTexB,
      this.settings,
    );

    // --- Territory (needs tileTex, paletteTex, patternTexs, skinTexs) ---
    this.territoryPass = new TerritoryPass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.paletteTex,
      this.patternMetaTex,
      this.patternDataTex,
      this.skinAtlas.texture,
      this.skinLayerTex,
      this.skinAnchorTex,
      this.skinParamsTex,
      this.skinBBoxTex,
      this.settings,
    );
    // Route per-tile changes to the border pass so it can scatter-recompute
    // just the affected tiles instead of rebuilding the whole map. A tile
    // changing owner can also flip its defense-coverage flag (same-owner test),
    // so mark the coverage stale too — one coalesced re-stamp happens per frame.
    this.territoryPass.setBorderPatchConsumer((x, y) => {
      this.borderPass.patchTile(x, y);
      this.defenseCoveragePass.markTileDirty(x, y);
    });
    // Territory fill darkens on interior tiles defended by a same-owner post;
    // borderTex lets the fill skip border tiles (those get the checkerboard).
    this.territoryPass.setDefenseCoverageTex(
      this.defenseCoveragePass.getCoverageTex(),
    );
    this.territoryPass.setBorderTex(this.res.borderTex);

    // --- Spawn overlay (needs tileTex) ---
    this.spawnOverlayPass = new SpawnOverlayPass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.settings.spawnOverlay,
    );

    // --- Trail (needs trailTex, paletteTex) ---
    this.trailPass = new TrailPass(
      gl,
      mapW,
      mapH,
      this.res.trailTex,
      this.paletteTex,
      this.settings,
    );

    // --- Border stamp (needs tileTex, paletteTex, borderTex) ---
    this.borderStampPass = new BorderStampPass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.paletteTex,
      this.res.borderTex,
      this.settings,
    );
    this.borderStampPass.setDefenseCoverageTex(
      this.defenseCoveragePass.getCoverageTex(),
    );

    // --- Fallout bloom: ЛЕНИВЫЙ, см. bloom() ---

    // --- Освещение (point lights / fallout light / lightmap / night composite):
    //     ЛЕНИВОЕ, см. pointLight()/falloutLight()/lightmap()/nightComposite().
    //     9 GL-программ, которые при выключенном свете не нужны вообще. ---

    // --- Railroad (needs tileTex) ---
    // --- Ж/д и круг радиуса: ЛЕНИВЫЕ, см. railroad() / rangeCircle() ---

    // --- SAM radius overlay (dashed green circles during build mode) ---
    this.samRadiusPass = new SAMRadiusPass(gl, mapW, this.settings);
    this.samRadiusPass.setPaletteData(paletteData);

    // --- Crosshair (warship placement): ЛЕНИВЫЙ, см. crosshair() ---

    // --- Remaining passes (unchanged from v1) ---
    this.structurePass = new StructurePass(
      gl,
      header,
      this.paletteTex,
      this.settings,
    );
    this.structureLevelPass = new StructureLevelPass(gl, header, this.settings);
    this.unitPass = new UnitPass(gl, header, this.paletteTex, this.settings);
    this.namePass = new NamePass(gl, header, paletteData, this.settings);
    this.fxPass = new FxPass(gl, header, this.settings, config);
    this.barPass = new BarPass(gl, header, this.settings, config);
    this.worldTextPass = new WorldTextPass(gl, this.settings, config);
    this.worldTextPass.setMapWidth(this.mapW);

    this.buildPhases.пассы = Math.round(performance.now() - phaseMark);

    // --- Scene capture target (for night composite) ---
    const sceneTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const sceneFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      sceneTex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.sceneTarget = { fbo: sceneFbo, tex: sceneTex, w: 1, h: 1 };

    // --- Alt-view passes ---
    this.affiliationPalette = new AffiliationPalette(gl, this.settings);
    const affTex = this.affiliationPalette.getTexture();
    this.borderStampPass.setAffiliationTex(affTex);
    this.unitPass.setAffiliationTex(affTex);
    this.structurePass.setAffiliationTex(affTex);
    this.trailPass.setAffiliationTex(affTex);
    // Сетка координат — ЛЕНИВАЯ, см. coordinateGrid()

    for (const p of header.players) {
      if (p.team !== null) this.playerTeams.set(p.smallID, p.team);
    }
    // Team mode = any player has a team. Drives skin tint behavior:
    // FFA shows raw skin colors; teams multiply skin by team primary color.
    this.territoryPass.setTeamMode(this.playerTeams.size > 0);

    this.startLoop();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof window !== "undefined") {
      for (const ev of this.activityEvents) {
        window.addEventListener(ev, this.bumpActivity, { passive: true });
      }
    }
  }

  // Ввод = активность (камера/радиальное меню/выделение и т.п. → полный fps).
  private readonly activityEvents = [
    "pointerdown",
    "pointermove",
    "pointerup",
    "wheel",
    "touchstart",
    "touchmove",
    "keydown",
  ];

  private renderLoop = (): void => {
    this.animId = this.raf(this.renderLoop);
    const now = performance.now();
    const cam = this.camera;
    const camMoved =
      cam.offsetX !== this.lastCamX ||
      cam.offsetY !== this.lastCamY ||
      cam.zoom !== this.lastCamZoom;
    if (camMoved) this.lastActivityMs = now;
    // активность: недавние данные/камера/ввод, ИЛИ фаза спавна (пульсация оверлея)
    const active =
      this.inSpawnPhase || now - this.lastActivityMs < this.idleGraceMs;
    if (active || now - this.lastDrawMs >= this.idleHeartbeatMs) {
      this.lastCamX = cam.offsetX;
      this.lastCamY = cam.offsetY;
      this.lastCamZoom = cam.zoom;
      this.lastDrawMs = now;
      this.draw();
    }
  };

  // Любая активность (апдейт данных/ввод) держит рендер на полной частоте grace мс.
  private bumpActivity = (): void => {
    this.lastActivityMs = performance.now();
  };

  // Скрытая вкладка/свёрнутое приложение — останавливаем цикл рисования совсем
  // (браузер троттлит RAF, но на мобиле фон всё равно может жечь). Возврат —
  // снова запускаем. Плавности в активной игре это не касается.
  private onVisibility = (): void => {
    if (typeof document !== "undefined" && document.hidden) {
      this.stopLoop();
    } else {
      // ⚠️ ВЕРНУЛИСЬ ИЗ ФОНА — ДОЛИВАЕМ ВСЮ ОЧЕРЕДЬ ТАЙЛОВ СРАЗУ.
      // Изменения территории уезжают на GPU «вёдрами»: одно ведро за кадр
      // (drainDripBucket). В скрытой вкладке кадров нет, а тики идут — очередь
      // копится, и по возвращении карта ещё долго догоняла бы по ведру за кадр,
      // показывая старые границы при уже новых цифрах в HUD (репорт владельца
      // 30.07: «цифры и фактический размер не соответствуют», смотрел из другого
      // браузера). Тот же приём уже применяется в спавн-фазе.
      this.pendingVisibilityFlush = true;
      this.startLoop();
    }
  };
  private pendingVisibilityFlush = false;

  private startLoop(): void {
    this.animId ??= this.raf(this.renderLoop);
  }

  private stopLoop(): void {
    if (this.animId !== null) {
      this.caf(this.animId);
      this.animId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Canvas / Camera
  // ---------------------------------------------------------------------------

  resize(cssWidth: number, cssHeight: number): void {
    const dpr = this.effectiveDpr();
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.camera.resize(cssWidth, cssHeight);
    // terron: смена canvas.width/height пересоздаёт бэкбуфер и очищает его. При
    // включённом idle-frame-skip очищенный кадр повиснет до heartbeat (≤250мс) →
    // тёмная вспышка (сворачивание софт-клавиатуры/чата на мобиле). Будим рендер
    // и сразу перерисовываем В ЭТОМ ЖЕ ТАСКЕ — очищенный буфер не успевает
    // скомпоноваться. Только когда цикл рисования уже идёт (animId != null).
    this.bumpActivity();
    if (this.animId !== null) this.draw();
  }

  // Кап разрешения бэкбуфера. На мобильных (coarse-pointer) DPR часто 2.5–3 →
  // бэкбуфер в 6–9× пикселей экрана, GPU жжётся каждый кадр (перегрев/лаги).
  // Капим мобилу до 2 — картинка почти не мягче, нагрузка кратно ниже. FPS НЕ
  // трогаем (плавность важна) — это лишь снижает число фрагментов на кадр.
  // Десктоп оставляем как есть.
  //
  // terron ПЕРФ (память, 12.07): АДАПТИВНЫЙ кап. Если устройство уже теряло
  // WebGL-контекст (белый экран, OOM вкладки) — флаг localStorage жмёт бэкбуфер
  // сильнее (мобила 1.5, десктоп 2), чтобы после перезагрузки та же вкладка не
  // свалилась снова. Флаг ставит GameView.onContextLost. Диагноз: median-краш
  // 12с = пик памяти при старте; экранные FBO ×DPR² — часть пика.
  static readonly GFX_LOW_KEY = "terron_gfx_low";
  private gfxLow(): boolean {
    try {
      if (localStorage.getItem(GPURenderer.GFX_LOW_KEY) === "1") return true;
    } catch {
      /* ignore */
    }
    // Превентивно (B1, 12.07): совсем слабые устройства (≤3ГБ RAM) — сразу в
    // лёгкий режим, не ждём их первого context-loss. deviceMemory нет на iOS
    // (undefined) — там решает только флаг после факта.
    const dm = (navigator as { deviceMemory?: number }).deviceMemory;
    if (typeof dm === "number" && dm <= 3) return true;
    // Превентивно (21.07): слабые ИНТЕГРИРОВАННЫЕ Intel (UHD / HD Graphics /
    // Iris) теряют D3D11-контекст под текущей нагрузкой рендера, а на десктопе
    // с 8ГБ RAM гейт выше их НЕ ловит. Репорт K3WEhR4C: диагностика чистая, а
    // в бою webglcontextlost → «WebGL2 not supported» до перезапуска браузера.
    return this.weakIntelGpu();
  }
  /** UNMASKED_RENDERER живого контекста (мемо) — слабое интегрированное Intel. */
  private weakGpuMemo: boolean | null = null;
  private weakIntelGpu(): boolean {
    if (this.weakGpuMemo !== null) return this.weakGpuMemo;
    this.weakGpuMemo = false;
    try {
      const dbg = this.gl.getExtension("WEBGL_debug_renderer_info");
      const r = dbg
        ? String(this.gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? "")
        : "";
      // «Intel … UHD Graphics / HD Graphics / Iris» = интегрированное видео.
      this.weakGpuMemo = /intel/i.test(r) && /(uhd|hd graphics|iris)/i.test(r);
    } catch {
      /* нет расширения / контекст ещё не готов — оставляем false */
    }
    return this.weakGpuMemo;
  }
  private effectiveDpr(): number {
    const dpr = window.devicePixelRatio || 1;
    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const low = this.gfxLow();
    // terron 21.07: РАНЬШЕ на десктопе (dpr ≤ 2, не coarse) флаг gfx_low НЕ
    // уменьшал бэкбуфер вообще — min(1.25, 2)=1.25 — поэтому реабилитация после
    // context-loss была ХОЛОСТОЙ, и матч ронял контекст повторно. Теперь
    // low-режим на десктопе реально режет бэкбуфер (меньше пикселей → меньше
    // давление на fill/GPU-память интегрированного Intel).
    //
    // Две ступени. Флаг terron_gfx_low=="1" выставляет ТОЛЬКО реальная потеря
    // контекста (onContextLost). Если он есть — превентивного ×0.75 НЕ хватило
    // (репорт tAgSrKG8, Intel UHD: ×0.75 пережил старт, но сдох на атаке) →
    // режем жёстче, ×0.5. Просто слабое-Intel/малоОЗУ, ещё без сброса (флаг не
    // выставлен, low пришёл от детекта) — остаётся на ×0.75.
    let hardLoss = false;
    try {
      hardLoss = localStorage.getItem(GPURenderer.GFX_LOW_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (coarse) return Math.min(dpr, low ? (hardLoss ? 1.0 : 1.5) : 2);
    if (low) return Math.min(dpr, hardLoss ? 0.5 : 0.75);
    return dpr;
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return this.camera.screenToWorld(screenX, screenY);
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return this.camera.worldToScreen(worldX, worldY);
  }

  panTo(worldX: number, worldY: number): void {
    this.camera.panTo(worldX, worldY);
  }
  panBy(dx: number, dy: number): void {
    this.camera.panBy(dx, dy);
  }
  zoomTo(level: number): void {
    this.camera.zoomTo(level);
  }
  zoomBy(factor: number): void {
    this.camera.zoomBy(factor);
  }
  zoomAtScreen(factor: number, screenX: number, screenY: number): void {
    this.camera.zoomAtScreen(factor, screenX, screenY);
  }
  fitMap(): void {
    this.camera.fitMap();
  }
  focusBBox(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    padding?: number,
  ): void {
    this.camera.focusBBox(minX, minY, maxX, maxY, padding);
  }
  getCameraState(): { x: number; y: number; z: number } {
    return {
      x: this.camera.offsetX,
      y: this.camera.offsetY,
      z: this.camera.zoom,
    };
  }
  setCameraState(x: number, y: number, z: number): void {
    this.camera.setCameraState(x, y, z);
  }
  get zoom(): number {
    return this.camera.zoom;
  }

  // ---------------------------------------------------------------------------
  // Data upload
  // ---------------------------------------------------------------------------

  applyFullFrame(
    tileState: Uint16Array,
    trailState: Uint8Array,
    nukeEvents?: Array<{ tick: number; tiles: number[] }>,
    currentTick?: number,
  ): void {
    this.bumpActivity();
    this.territoryPass.uploadFullTileState(tileState);
    this.trailPass.uploadFullState(trailState);
    this.heatManager.resetForSeek(tileState, nukeEvents, currentTick);
  }

  applyFullTiles(tileState: Uint16Array, trailState: Uint8Array): void {
    this.bumpActivity();
    this.territoryPass.uploadFullTileState(tileState);
    this.trailPass.uploadFullState(trailState);
  }

  applyDelta(changedTiles: TilePair[], trailState: Uint8Array): void {
    this.bumpActivity();
    this.territoryPass.uploadDeltaTiles(changedTiles);
    this.trailPass.uploadFullState(trailState);
  }

  uploadTileAndTrailState(
    tileState: Uint16Array,
    trailState: Uint8Array,
  ): void {
    this.bumpActivity();
    this.territoryPass.setLiveRef(tileState);
    this.trailPass.setLiveRef(trailState);
  }

  uploadLiveDelta(tileState: Uint16Array, changedTiles: TilePair[]): void {
    this.bumpActivity();
    // terron Р10.2 (12.07): страховка пробуждения heat по ФАКТУ фоллаута.
    // Основные триггеры — телеграф/взрыв (applyDeadUnits) — но если fallout
    // появился путём, который они не покрыли (новый юнит-взрыватель, edge),
    // свечение молча не появится. Цена: одна битовая проверка на изменённый
    // тайл, и ТОЛЬКО пока heat спит (после пробуждения ветка мертва).
    if (!this.heatManager.isFullSize()) {
      for (let i = 0; i < changedTiles.length; i++) {
        if ((changedTiles[i].state & FALLOUT_BIT) !== 0) {
          this.heatManager.ensureFullSize();
          break;
        }
      }
    }
    this.territoryPass.applyLiveDelta(tileState, changedTiles);
  }

  uploadLiveTrailDelta(
    trailState: Uint8Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
  ): void {
    this.bumpActivity();
    this.trailPass.applyLiveDelta(trailState, dirtyRowMin, dirtyRowMax);
  }

  // terron: скины пепла — буфер «чей пепел» в TerritoryPass (там его сэмплит
  // fallout-ветка territory.frag.glsl: кайма цветом бомбившего + узор скина).
  uploadFalloutOwners(
    falloutOwnerState: Uint16Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
  ): void {
    this.bumpActivity();
    this.territoryPass.applyFalloutOwnerDelta(
      falloutOwnerState,
      dirtyRowMin,
      dirtyRowMax,
    );
  }

  /** Re-upload palette data to the GPU texture (e.g. when players appear after initial startup). */
  updatePalette(paletteData: Float32Array): void {
    const gl = this.gl;
    // Mutate the stored array in-place so all passes sharing the reference see the update.
    this.paletteData.set(paletteData);
    // Re-upload to the GPU texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      getPaletteSize(),
      2,
      gl.RGBA,
      gl.FLOAT,
      this.paletteData,
    );
    // SAM radius pass stores its own copy
    this.samRadiusPass.setPaletteData(this.paletteData);
  }

  /** Register late-arriving players (updates palette + NamePass lookup maps). */
  addPlayers(
    players: PlayerStatic[],
    paletteData: Float32Array,
    patternMeta: Float32Array,
    patternData: Uint8Array,
  ): void {
    this.updatePalette(paletteData);

    const gl = this.gl;
    const palW = getPaletteSize();

    gl.bindTexture(gl.TEXTURE_2D, this.patternMetaTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      palW,
      1,
      gl.RGBA,
      gl.FLOAT,
      patternMeta,
    );

    gl.bindTexture(gl.TEXTURE_2D, this.patternDataTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      1024,
      palW,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      patternData,
    );

    this.namePass.addPlayers(players, this.paletteData);
    for (const p of players) {
      if (p.team !== null) this.playerTeams.set(p.smallID, p.team);
    }
    // Renderer was constructed with players: [] (real list arrives via this
    // method), so team mode must be re-evaluated whenever new players arrive
    // — otherwise team games never enable the skin-tint branch.
    this.territoryPass.setTeamMode(this.playerTeams.size > 0);
  }

  /**
   * Anchor a player's skin sampling at world coords (x, y). The center of the
   * skin image lines up with this tile. Default (0,0) anchors at world origin.
   */
  setPlayerSpawn(smallID: number, x: number, y: number): void {
    const off = smallID * 2;
    this.skinAnchorCpu[off] = x;
    this.skinAnchorCpu[off + 1] = y;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.skinAnchorTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      getPaletteSize(),
      1,
      gl.RG_INTEGER,
      gl.UNSIGNED_SHORT,
      this.skinAnchorCpu,
    );
  }

  /**
   * Allocate the skin atlas to exactly `urls.length` layers. The player set is
   * locked at game start so this is called once with the complete URL list;
   * URLs not in this set will be ignored by `setPlayerSkin`.
   *
   * Layers are zero-initialized (browsers do this for security regardless of
   * the GL spec's "undefined" wording), so players whose images haven't
   * decoded yet render with alpha=0 → falls through to base player color.
   */
  initSkinAtlas(
    urls: readonly string[],
    letterbox?: ReadonlySet<string>,
    stretch?: ReadonlySet<string>,
  ): void {
    this.skinAtlas.dispose();
    this.skinAtlas = new SkinAtlasArray(
      this.gl,
      urls,
      () => {},
      letterbox,
      stretch,
    );
    this.territoryPass.setSkinAtlas(this.skinAtlas.texture);
  }

  /**
   * Map a player to a pre-registered skin layer. URLs not registered via
   * `initSkinAtlas` are silently dropped. If the image is still decoding the
   * layer renders transparent (zero-init) until decode completes.
   */
  setPlayerSkin(smallID: number, url: string): void {
    const layer = this.skinAtlas.getLayer(url);
    if (layer < 0) return;
    this.skinLayerCpu[smallID] = layer + 1;
    this.uploadSkinLayerTex();
  }

  // terron: поздняя установка флага игрока (клан-флаги резолвятся на клиенте async).
  setPlayerFlag(smallID: number, url: string): void {
    this.namePass.setPlayerFlag(smallID, url);
  }

  // terron: Закрытая страна — скрыть подпись войск у этих игроков.
  setTroopsHidden(smallIDs: ReadonlySet<number>): void {
    this.namePass.setTroopsHidden(smallIDs);
  }

  // terron: ЗАКРЫТАЯ СТРАНА — скрыть ЮНИТЫ этих игроков (постройки и технику).
  // Решение владельца 22.08: одних цифр мало, страна прячет и содержимое.
  // Реализация — ОДИН фильтр на входе рендера: всё, что кормится из updateUnits/
  // updateStructures (сами юниты, полоски здоровья, свет, круги ПВО, уровни
  // построек, ж/д-станции), исчезает разом и без правок в каждом пассе.
  // ⚠️ Чисто ВИДОВОЕ, как подлодки и туман: сим честный, в hash не входит,
  // десинков не даёт; читерский клиент юниты увидит.
  setUnitsHidden(smallIDs: ReadonlySet<number>): void {
    this.unitsHidden = smallIDs;
  }

  // Фильтр и правило «что видно всегда» — в ClosedCountryFilter.ts
  // (там же разбор, почему летящие боеприпасы не прячем).

  private uploadSkinLayerTex(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.skinLayerTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      getPaletteSize(),
      1,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      this.skinLayerCpu,
    );
  }

  uploadRailroadState(data: Uint8Array): void {
    // Первая ж/д на карте — здесь пасс и рождается (зовётся только на изменениях).
    this.railroad().uploadRailroadState(data);
  }

  // Закрытая страна: фильтр без аллокации карты на каждый тик — два буфера
  // по очереди (прошлый ещё может читать hover/HUD до следующего тика).
  private readonly unitScratch = [
    new Map<number, UnitState>(),
    new Map<number, UnitState>(),
  ];
  private unitScratchIdx = 0;
  private readonly structScratch = [
    new Map<number, UnitState>(),
    new Map<number, UnitState>(),
  ];
  private structScratchIdx = 0;

  updateUnits(units: Map<number, UnitState>, gameTick: number): void {
    this.bumpActivity();
    this.unitScratchIdx ^= 1;
    units = filterHiddenUnits(
      units,
      this.unitsHidden,
      this.unitScratch[this.unitScratchIdx],
    );
    this.lastUnits = units;
    this.frameTick++;
    this.unitPass.updateUnits(units, this.frameTick);
    this.barPass.updateBars(units, this.lastStructures, gameTick);
    // terron ПЕРФ (07.08): не будим ленивый пасс света ради данных, которые
    // некому рисовать. Свет выключат обратно — пасс уже построен, кормим его.
    if (this.settings.lighting.enabled || this.pointLightPass !== null) {
      this.pointLight().updateLights(units);
    }
    this.heatManager.decayHeat();
    // Туман: юниты дают обзор в пути; заодно тик-хартбит пересчёта маски.
    // Спящий пасс не будим — при включении он возьмёт свежих юнитов сам.
    this.fogPass?.updateUnits(units);
  }

  updateNames(
    names: Map<string, NameEntry>,
    players: Map<number, PlayerState>,
    snap: boolean,
    statusData?: Map<number, PlayerStatusData>,
  ): void {
    this.namePass.updateNames(names, players, snap, statusData);

    // Extract local player's allies + teammates for SAM radius coloring
    if (this.localPlayerID > 0) {
      const localPS = players.get(this.localPlayerID);
      const friendly = new Set(localPS?.allies ?? []);
      const myTeam = this.playerTeams.get(this.localPlayerID);
      if (myTeam !== undefined) {
        for (const [sid, team] of this.playerTeams) {
          if (team === myTeam && sid !== this.localPlayerID) friendly.add(sid);
        }
      }
      this.samRadiusPass.setAllies(friendly);
      this.unitPass.setAllies(friendly);
      this.barPass.setAllies(friendly);
      this.fogFriendly = friendly;
      this.fogPass?.setFriendly(friendly);
    }
  }

  updateRelations(data: Uint8Array, size: number): void {
    this.borderPass.updateRelations(data, size);
    this.affiliationPalette.updateRelations(data, size);
  }

  updateStructures(units: Map<number, UnitState>): void {
    this.bumpActivity();
    this.structScratchIdx ^= 1;
    units = filterHiddenUnits(
      units,
      this.unitsHidden,
      this.structScratch[this.structScratchIdx],
    );
    this.lastStructures = units;
    this.structurePass.updateStructures(units);
    this.structureLevelPass.updateStructures(units);
    this.samRadiusPass.updateStructures(units);
    this.unitPass.setStructures(units);
    // terron: покрытие бункеров теперь per-instance по радиусу — у владельца
    // Укреплений бункер кроет дальше (растёт с уровнем штаба). Сперва карта
    // owner→уровень штаба. new-units/ULTIMATES.md
    const fortLvl = new Map<number, number>();
    for (const u of units.values()) {
      if (
        u.unitType === "Fortifications" &&
        u.isActive &&
        !u.underConstruction
      ) {
        fortLvl.set(u.ownerID, u.level);
      }
    }
    const baseRange = this.settings.mapOverlay.defensePostRange;
    const posts: { x: number; y: number; ownerID: number; range: number }[] =
      [];
    const w = this.mapW;
    for (const u of units.values()) {
      if (u.unitType === "Defense Post" && !u.underConstruction) {
        const lvl = fortLvl.get(u.ownerID);
        posts.push({
          x: u.pos % w,
          y: (u.pos - (u.pos % w)) / w,
          ownerID: u.ownerID,
          range: lvl !== undefined ? baseRange * fortRangeMult(lvl) : baseRange,
        });
      } else if (
        u.unitType === "Fortifications" &&
        u.isActive &&
        !u.underConstruction
      ) {
        // terron: сам штаб — тоже «бункер», покрытие радиусом ×2 от нормы.
        posts.push({
          x: u.pos % w,
          y: (u.pos - (u.pos % w)) / w,
          ownerID: u.ownerID,
          range: baseRange * fortHqRangeMult(u.level),
        });
      }
    }
    this.defenseCoveragePass.updateDefensePosts(posts);
  }

  applyDeadUnits(deadUnits: DeadUnitFx[]): void {
    if (deadUnits.length > 0) {
      // terron ПЕРФ (память): страховочный триггер фоллаут-цепочки — ядерный
      // юнит погиб (детонация). Основной триггер раньше — телеграфы запуска.
      for (const u of deadUnits) {
        if (
          NUKE_EXPLOSION_RADII[u.unitType] !== undefined ||
          u.unitType === UT_SUICIDE_DRONE
        ) {
          this.heatManager.ensureFullSize();
          break;
        }
      }
      this.fxPass.applyDeadUnits(deadUnits);
    }
  }

  applyRailroadDust(tileRefs: number[]): void {
    if (tileRefs.length > 0) this.fxPass.applyRailroadDust(tileRefs);
  }

  /**
   * Update terrain texels for tiles whose terrain byte changed (e.g. water
   * nukes converting land → water). `terrainBytes[i]` is the new byte for
   * `refs[i]`. Forwards to both TerrainPass (RGBA color) and RailroadPass
   * (R8UI water-detection for bridges).
   */
  applyTerrainDelta(refs: readonly number[], terrainBytes: Uint8Array): void {
    if (refs.length === 0) return;
    // Террейн теперь ОДНА общая текстура — RailroadPass/FogPass видят дельту сами.
    this.terrainPass.applyTerrainDelta(refs, terrainBytes);
  }

  applyConquestEvents(events: ConquestFx[]): void {
    if (events.length > 0) {
      this.fxPass.applyConquestEvents(events);
      this.worldTextPass.applyConquestEvents(events);
    }
  }

  setAttackTroopLabels(
    labels: import("./passes/WorldTextPass").AttackTroopLabel[],
  ): void {
    this.worldTextPass.setAttackTroopLabels(labels);
  }

  setBeachheadLabels(
    labels: import("./passes/WorldTextPass").AttackTroopLabel[],
  ): void {
    this.worldTextPass.setBeachheadLabels(labels);
  }

  applyBonusEvents(events: BonusEvent[]): void {
    if (events.length === 0) return;
    // In live game, filter to local player only. In replay (localPlayerID=0), show all.
    const filtered =
      this.localPlayerID > 0
        ? events.filter((e) => e.smallID === this.localPlayerID)
        : events;
    if (filtered.length > 0) this.worldTextPass.applyBonusEvents(filtered);
  }

  updateAttackRings(rings: AttackRingInput[]): void {
    this.fxPass.updateAttackRings(rings);
  }

  clearFx(): void {
    this.fxPass.clear();
    this.worldTextPass.clear();
  }
  setFxTimeFn(fn: () => number): void {
    this.fxPass.setTimeFn(fn);
    this.worldTextPass.setTimeFn(fn);
  }

  updateGhostPreview(data: GhostPreviewData | null): void {
    this.structurePass.updateGhostPreview(data);
    // terron ПЕРФ (07.08): будим ленивый пасс только если ему ЕСТЬ что рисовать.
    // Условия — те же, что внутри самих пассов (ранний возврат в их draw);
    // подняты сюда, иначе первый же гост строил бы все три впустую.
    // Уже построенный пасс кормим всегда — ему нужно узнать и о снятии госта.
    const railGhost =
      data !== null &&
      (data.ghostRailPaths.some((pp) => pp.length > 0) ||
        data.overlappingRailroads.length > 0);
    if (this.railroadPass !== null || railGhost) {
      this.railroad().updateGhostPreview(data);
    }
    if (
      this.rangeCirclePass !== null ||
      (data !== null && data.rangeRadius > 0)
    ) {
      this.rangeCircle().updateGhostPreview(data);
    }
    // ⚠️ terron 23.08: ЗДЕСЬ ЖИЛ ВТОРОЙ ЭКЗЕМПЛЯР ТОГО ЖЕ СПИСКА. Проход
    // создаётся лениво, и его собственный список типов расходился с тем, что
    // решает контроллер, — каст мог остаться вообще без госта. Решение одно и
    // приезжает флагом (client/UnitVisuals.ts).
    const crossGhost = data !== null && data.crosshair === true;
    if (this.crosshairPass !== null || crossGhost) {
      this.crosshair().updateGhostPreview(data);
    }
    // terron: превью будущего уровня над зданием при наведении апгрейда.
    this.structureLevelPass.setUpgradePreview(
      data && data.canUpgrade && data.upgradeTargetTile !== null
        ? data.upgradeTargetTile
        : null,
      data?.upgradeNewLevel ?? 0,
    );
    this.worldTextPass.setGhostCostLabel(
      data && data.showCost && data.cost > 0
        ? {
            tileX: data.tileX,
            tileY: data.tileY,
            cost: data.cost,
            canAfford: data.canAfford,
            canPlace: data.canBuild || data.canUpgrade,
          }
        : null,
    );
    this.samGhostVisible =
      data !== null && SAM_RADIUS_GHOST_TYPES.has(data.ghostType);
    this.samRadiusPass.setVisible(
      this.samGhostVisible || this.samHighlightVisible,
    );
  }

  updateNukeTrajectory(data: NukeTrajectoryData | null): void {
    this.nukeTrajectory().update(data);
  }

  updateNukeTelegraphs(data: NukeTelegraphData[]): void {
    // terron ПЕРФ (память): первая ядерка В ПОЛЁТЕ — разворачиваем фоллаут-
    // цепочку (heatA/B + prevTileTex были 1×1-заглушками). За секунды полёта
    // текстуры готовы, переходы фоллаут-битов при подрыве не теряются.
    if (data.length > 0) this.heatManager.ensureFullSize();
    this.nukeTelegraph().update(data);
  }

  updateSpawnOverlay(inSpawnPhase: boolean, centers: SpawnCenter[]): void {
    this.inSpawnPhase = inSpawnPhase;
    this.spawnOverlayPass.update(inSpawnPhase, centers);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  setHighlightOwner(ownerID: number): void {
    this.borderPass.setHighlightOwner(ownerID);
    this.territoryPass.setHighlightOwner(ownerID);
    this.namePass.setHighlightOwner(ownerID);
  }

  // terron: свой игрок — его ник всегда виден (см. name.vert.glsl).
  setMyOwner(ownerID: number): void {
    this.namePass.setMyOwner(ownerID);
  }
  // terron: позиция курсора (мир) для фейда ника под мышью.
  setNameHoverCursor(worldX: number, worldY: number): void {
    this.namePass.setNameHoverCursor(worldX, worldY);
  }
  setHighlightStructureTypes(unitTypes: string[] | null): void {
    this.structurePass.setHighlightTypes(unitTypes);
    this.structureLevelPass.setHighlightTypes(unitTypes);
    this.samHighlightVisible =
      unitTypes !== null &&
      unitTypes.some((t) => SAM_RADIUS_HIGHLIGHT_TYPES.has(t));
    this.samRadiusPass.setVisible(
      this.samGhostVisible || this.samHighlightVisible,
    );
  }

  // terron: ПИРАТСТВО — зоны блокады торговли (красные круги).
  setHazardCircles(list: { x: number; y: number; radius: number }[]): void {
    this.samRadiusPass.setHazardCircles(list);
  }

  // terron: круг радиуса структуры под курсором (щит/ПВО/минправды).
  setStructureHoverCircle(
    c: { x: number; y: number; radius: number; friendly: boolean } | null,
  ): void {
    this.samRadiusPass.setHoverCircle(c);
  }

  focusOwner(ownerID: number): void {
    if (ownerID !== 0) {
      const bbox = this.territoryPass.getBBoxForOwner(ownerID);
      if (bbox) {
        this.camera.focusBBox(bbox.minX, bbox.minY, bbox.maxX, bbox.maxY);
        return;
      }
    }
    this.camera.focusBBox(0, 0, this.mapW - 1, this.mapH - 1);
  }

  getOwnerAtWorld(worldX: number, worldY: number): number {
    const tx = Math.floor(worldX);
    const ty = Math.floor(worldY);
    if (tx < 0 || ty < 0 || tx >= this.mapW || ty >= this.mapH) return 0;
    return this.territoryPass.getOwnerAt(ty * this.mapW + tx);
  }

  getUnitAtWorld(
    worldX: number,
    worldY: number,
    radius: number,
  ): UnitState | null {
    let best: UnitState | null = null;
    let bestDist = radius * radius;
    const w = this.mapW;
    for (const u of this.lastUnits.values()) {
      const dx = (u.pos % w) - worldX;
      const dy = Math.floor(u.pos / w) - worldY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = u;
      }
    }
    return best;
  }

  getStructureAtWorld(
    worldX: number,
    worldY: number,
    radius: number,
  ): UnitState | null {
    let best: UnitState | null = null;
    let bestDist = radius * radius;
    const w = this.mapW;
    for (const s of this.lastStructures.values()) {
      const dx = (s.pos % w) - worldX;
      const dy = Math.floor(s.pos / w) - worldY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = s;
      }
    }
    return best;
  }

  setLocalPlayerID(id: number): void {
    if (id === this.localPlayerID) return;
    this.localPlayerID = id;
    this.samRadiusPass.setLocalPlayer(id);
    this.affiliationPalette.setLocalPlayer(id);
    this.unitPass.setLocalPlayer(id);
    this.barPass.setLocalPlayer(id);
    this.fogLocalPlayer = id;
    this.fogPass?.setLocalPlayer(id);
  }

  /** terron: туман войны — вкл/выкл (конфиг лобби × фаза × жив × не реплей ×
   * блэкаут «Неба нашего»). wave = эпицентр волны (contract = схлоп). */
  setFogOfWar(
    on: boolean,
    wave?: { x: number; y: number; contract?: boolean },
  ): void {
    // Включение — единственный момент, когда пасс тумана обязан родиться.
    // Выключение спящего игнорируем: строить 5 программ, чтобы выключить
    // то, чего нет, незачем.
    if (!on && this.fogPass === null) return;
    this.fog().setEnabled(on, wave);
  }

  /** terron: туман — окна видимости после своих ударов/высадок (5с + схлоп). */
  setFogReveals(reveals: Array<{ x: number; y: number; r: number }>): void {
    this.fogReveals = reveals;
    this.fogPass?.setReveals(reveals);
  }

  /** terron: «Небо наше» — пульс-кольцо на штабе в касте (маркер для сноса). */
  pushSatCastPing(x: number, y: number): void {
    this.fxPass.pushAlertPing(x, y);
  }

  /** terron: Укрепления — вспышка-«выстрел» бункера/штаба при захвате. */
  pushFortShot(fromX: number, fromY: number, toX: number, toY: number): void {
    this.fxPass.pushFortShot(fromX, fromY, toX, toY);
  }

  setSAMRadiusVisible(visible: boolean): void {
    this.samRadiusPass.setVisible(visible);
  }

  setSAMPerspective(playerID: number, allies: Set<number>): void {
    this.samRadiusPass.setLocalPlayer(playerID);
    this.samRadiusPass.setAllies(allies);
    this.unitPass.setLocalPlayer(playerID);
    this.unitPass.setAllies(allies);
  }

  setSAMColorMode(mode: "perspective" | "owner"): void {
    this.samRadiusPass.setColorMode(mode);
  }

  setSAMAllianceClusters(clusters: Map<number, number>): void {
    this.samRadiusPass.setAllianceClusters(clusters);
  }

  setAltView(active: boolean): void {
    this.altView = active;
    this.territoryPass.setAltView(active);
    this.borderStampPass.setAltView(active);
    this.unitPass.setAltView(active);
    this.structurePass.setAltView(active);
    this.trailPass.setAltView(active);
  }

  setShowPatterns(active: boolean): void {
    this.territoryPass.setShowPatterns(active);
  }

  /**
   * terron виральность: задать режим/тайлинг/dim скина КОНКРЕТНОМУ владельцу
   * (per-owner — у каждого игрока свой одновременно). mode 0=stamp,1=tile,2=stretch,3=tile-fract.
   */
  setPlayerSkinParams(
    smallID: number,
    mode: number,
    tileTiles: number,
    dim: number,
    aspect = 1,
  ): void {
    const off = smallID * 4;
    this.skinParamsCpu[off] = mode;
    this.skinParamsCpu[off + 1] = tileTiles;
    this.skinParamsCpu[off + 2] = dim;
    this.skinParamsCpu[off + 3] = aspect > 0.01 ? aspect : 1; // mode 4: imgW/imgH
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.skinParamsTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      getPaletteSize(),
      1,
      gl.RGBA,
      gl.FLOAT,
      this.skinParamsCpu,
    );
    // mode 2 (stretch) требует per-owner AABB → включаем пересчёт, если есть ХОТЬ ОДИН
    // stretch-скин (скины ставятся на старте; держать флаг весь матч дёшево).
    if (mode === 2) this.anyStretchSkin = true;
    this.territoryPass.setNeedSkinBBox(this.anyStretchSkin);
  }

  /** Совместимость: dev-инъекция скина локальному игроку (теперь через per-owner). */
  setSkinDemo(
    mode: number,
    tileTiles: number,
    dim: number,
    ownerSmallID: number,
  ): void {
    this.setPlayerSkinParams(ownerSmallID, mode, tileTiles, dim);
  }

  setGridView(active: boolean): void {
    this.gridView = active;
  }

  getSettings(): RenderSettings {
    return this.settings;
  }

  // ---------------------------------------------------------------------------
  // Radial menu
  // ---------------------------------------------------------------------------

  showRadialMenu(
    anchorX: number,
    anchorY: number,
    items: RadialMenuItem[],
    centerItem?: RadialMenuItem,
  ): void {
    this.radialMenu().show(anchorX, anchorY, items, centerItem);
  }

  hideRadialMenu(): void {
    this.radialMenuPass?.hide();
  }
  openRadialSubMenu(subItems: RadialMenuItem[]): void {
    this.radialMenu().openSubMenu(subItems);
  }
  goBackRadialMenu(): void {
    this.radialMenu().goBack();
  }
  setRadialMenuHover(index: number): void {
    this.radialMenu().setHover(index);
  }
  radialMenuHitTest(screenX: number, screenY: number): number {
    return this.radialMenu().hitTest(screenX, screenY);
  }
  get radialMenuVisible(): boolean {
    return this.radialMenuPass?.isVisible ?? false;
  }
  getRadialMenuItems(): readonly RadialMenuItem[] {
    return this.radialMenu().getItems();
  }
  getRadialMenuItemAt(index: number): RadialMenuItem | null {
    return this.radialMenu().getItemAt(index);
  }
  registerRadialMenuIcons(
    icons: { key: string; img: CanvasImageSource }[],
  ): void {
    this.radialMenu().registerIcons(icons);
  }

  // ---------------------------------------------------------------------------
  // Selection box (warship selection)
  // ---------------------------------------------------------------------------

  setSelectedUnit(unitId: number | null): void {
    this.setSelectedUnits(unitId === null ? [] : [unitId]);
  }

  setSelectedUnits(unitIds: readonly number[]): void {
    // Copy in (callers may mutate their array).
    this.selectedUnitIds.length = 0;
    for (let i = 0; i < unitIds.length; i++) {
      this.selectedUnitIds.push(unitIds[i]);
    }
    if (this.selectedUnitIds.length === 0) {
      this.selectionBoxPass?.hide();
    }
    // Position + color are rebuilt each frame in updateSelectionBox() from
    // lastUnits — dead units get dropped automatically.
  }

  private updateSelectionBox(): void {
    if (this.selectedUnitIds.length === 0) return;

    // Build the entries for this frame and prune dead unit IDs in place.
    const entries = this.selectionBoxEntries;
    entries.length = 0;
    let writeIdx = 0;
    for (let i = 0; i < this.selectedUnitIds.length; i++) {
      const id = this.selectedUnitIds[i];
      const unit = this.lastUnits.get(id);
      if (!unit || !unit.isActive) continue; // dead — drop
      this.selectedUnitIds[writeIdx++] = id;

      const centerX = unit.pos % this.mapW;
      const centerY = Math.floor(unit.pos / this.mapW);
      // Lighten the owner's territory color by ~20% (mix toward white).
      const off = unit.ownerID * 4;
      const r = Math.min(
        1,
        this.paletteData[off] + (1 - this.paletteData[off]) * 0.3,
      );
      const g = Math.min(
        1,
        this.paletteData[off + 1] + (1 - this.paletteData[off + 1]) * 0.3,
      );
      const b = Math.min(
        1,
        this.paletteData[off + 2] + (1 - this.paletteData[off + 2]) * 0.3,
      );
      entries.push({ centerX, centerY, r, g, b });
    }
    this.selectedUnitIds.length = writeIdx;

    this.selectionBox().setSelections(entries);
  }

  // ---------------------------------------------------------------------------
  // Move indicator (warship move-target chevrons)
  // ---------------------------------------------------------------------------

  showMoveIndicator(tileX: number, tileY: number, ownerID: number): void {
    const off = ownerID * 4;
    const r = Math.min(
      1,
      this.paletteData[off] + (1 - this.paletteData[off]) * 0.3,
    );
    const g = Math.min(
      1,
      this.paletteData[off + 1] + (1 - this.paletteData[off + 1]) * 0.3,
    );
    const b = Math.min(
      1,
      this.paletteData[off + 2] + (1 - this.paletteData[off + 2]) * 0.3,
    );
    this.moveIndicator().show(tileX, tileY, r, g, b);
  }

  // ---------------------------------------------------------------------------
  // Render — normalized draw order
  // ---------------------------------------------------------------------------

  draw(): void {
    const now = performance.now();
    this.trackFps(now);
    this.uploadTextures();
    this.computeTextures();
    this.renderFrame();
    if (this.onFrame) this.onFrame(performance.now() - now);
    if (this.afterRender) this.afterRender(this.canvas);
  }

  private trackFps(now: number): void {
    this.frameTimes[this.frameIdx] = now;
    this.frameIdx = (this.frameIdx + 1) % this.frameTimes.length;
    if (this.frameCount < this.frameTimes.length) this.frameCount++;
    if (this.frameCount > 1) {
      const oldest =
        this.frameTimes[
          (this.frameIdx - this.frameCount + this.frameTimes.length) %
            this.frameTimes.length
        ];
      this.fps = (this.frameCount - 1) / ((now - oldest) / 1000);
    }
  }

  private uploadTextures(): void {
    if (this.altView) this.affiliationPalette.flush();
    if (this.inSpawnPhase || this.pendingVisibilityFlush) {
      this.pendingVisibilityFlush = false;
      this.territoryPass.flushAllDripBuckets();
    } else {
      this.territoryPass.drainDripBucket();
    }
    // Full uploads need a full border recompute; scatter uploads already
    // pushed per-tile border patches via the wired `borderPatchConsumer`.
    if (this.territoryPass.flushTileTexture() === "full") {
      this.borderPass.markGlobalDirty();
      this.defenseCoveragePass.markDirty();
      this.fogPass?.markDirty();
    }
    this.trailPass.flushTexture();
    this.heatManager.updateHeat();
  }

  private computeTextures(): void {
    if (this.settings.passEnabled.borderCompute) this.borderPass.draw();
    // Re-stamp defense coverage if posts/territory changed (dirty-gated).
    // Leaves the default framebuffer bound; renderFrame resets the viewport.
    this.defenseCoveragePass.draw();
    // Туман войны: пересчёт маски видимости (dirty-гейт — раз в тик).
    this.fogPass?.compute();
  }

  private renderFrame(): void {
    const cam = this.camera.getMatrix();
    const zoom = this.camera.zoom;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const compositingActive = this.isLightCompositingActive();

    if (compositingActive) {
      this.resizeSceneTargetIfNeeded(cw, ch);
      const sceneTex = toTarget(this.gl, this.sceneTarget, () =>
        this.drawBaseLayer(cam),
      );
      const lightTex = this.lightmap().draw(cam, cw, ch, this.frameTick);
      toScreen(this.gl, cw, ch, () =>
        this.nightComposite().draw(sceneTex, lightTex),
      );
    } else {
      toScreen(this.gl, cw, ch, () => this.drawBaseLayer(cam));
    }

    this.renderOverlays(cam, zoom);
  }

  private isLightCompositingActive(): boolean {
    return this.settings.lighting.enabled;
  }

  private resizeSceneTargetIfNeeded(cw: number, ch: number): void {
    if (this.sceneTarget.w === cw && this.sceneTarget.h === ch) return;
    this.sceneTarget.w = cw;
    this.sceneTarget.h = ch;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      cw,
      ch,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  }

  private drawBaseLayer(cam: Float32Array): void {
    const gl = this.gl;
    const pe = this.settings.passEnabled;
    gl.clearColor(0.04, 0.04, 0.06, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    if (pe.terrain) this.terrainPass.draw(cam);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (pe.territory) this.territoryPass.draw(cam);
  }

  private renderOverlays(cam: Float32Array, zoom: number): void {
    const gl = this.gl;
    const pe = this.settings.passEnabled;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // terron: туман со спавн-фазы — свой/командные спавн-пики рисуются ПОВЕРХ
    // тумана (см. ниже), иначе оверлей как раньше, под структурами.
    const fogOn = this.fogPass?.isEnabled() ?? false;
    if (!fogOn) this.spawnOverlayPass.draw(cam);
    if (pe.borderStamp) this.borderStampPass.draw(cam);
    if (pe.railroad) this.railroadPass?.draw(cam, zoom);
    if (pe.unit) this.unitPass.drawGround(cam);
    this.samRadiusPass.draw(cam);
    if (pe.structure)
      this.structurePass.draw(cam, zoom, fogOn ? "unitsOnly" : "all");
    if (pe.structure) this.structureLevelPass.draw(cam, zoom);
    if (pe.bar) this.barPass.draw(cam);
    this.updateSelectionBox();
    this.selectionBoxPass?.draw(cam, this.frameTick);
    this.nukeTelegraphPass?.draw(cam);
    // terron ПЕРФ (Р8): 4 фулскрин-пасса блума — только когда жар реально есть
    // (после первой ядерки и пока не потух), иначе 95% кадров жгли GPU впустую.
    if (pe.falloutBloom && this.heatManager.bloomActive())
      this.bloom().draw(cam, this.frameTick);
    if (pe.trail) this.trailPass.draw(cam);
    if (pe.unit) this.unitPass.drawMissiles(cam);

    if (pe.fx) {
      this.fxPass.tick();
      this.fxPass.draw(cam, zoom);
    }

    // Grid shows on either trigger; names hide only under alt-view (space
    // hold), not under the persistent M-key gridView toggle.
    if (this.gridView || this.altView) this.coordinateGrid().draw(cam, zoom);
    if (pe.name && !this.altView)
      // terron ПЕРФ (07.08): getAmbient() — это просто чтение настройки, а не
      // GL-работа. Брать её напрямую, чтобы не строить пасс ночи ради числа.
      this.namePass.draw(cam, this.settings.lighting.ambient);

    // World text (attack-troop labels, popups, ghost cost) draws on top of
    // player names so attack callouts aren't hidden behind a centered name.
    this.worldTextPass.tick(zoom);
    this.worldTextPass.draw(cam, zoom);

    // terron: туман войны — непрозрачный слой поверх ВСЕХ карто-пассов
    // (территория/юниты/здания/имена/телеграфы гаснут разом).
    this.fogPass?.draw(cam);

    // terron: СВОИ превью — ПОВЕРХ тумана (владелец 12.07): гост постройки,
    // радиусы (ядерка/ауры), траектория ракеты, кросхэйр, чевроны движения —
    // игрок знает КУДА ставит и какой радиус, просто не видит ЧТО там. Плюс
    // спавн-оверлей (свой/командные пики) при активном тумане.
    this.rangeCirclePass?.draw(cam);
    this.nukeTrajectoryPass?.draw(cam);
    this.crosshairPass?.draw(cam);
    this.moveIndicatorPass?.draw(cam, zoom);
    if (pe.structure && fogOn) this.structurePass.draw(cam, zoom, "ghostOnly");
    if (fogOn) this.spawnOverlayPass.draw(cam);

    this.radialMenuPass?.draw();

    gl.disable(gl.BLEND);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Собрать ленивые пассы ЗАРАНЕЕ, в простое после первого хода. Иначе блум
   * собирался бы в момент первой ядерки — то есть микро-фриз ровно на зрелищном
   * событии. Шейдеры к этому моменту уже скомпилены (см. prewarmShaders), так
   * что остаётся дешёвая линковка. Идемпотентно: `??=` внутри геттеров.
   */
  warmLazyPasses(): void {
    try {
      // Всё «ядерное» — заранее: блум радиоактивного следа, траектория и
      // телеграф ракеты. Иначе первый же пуск собирал бы их на лету (запрос
      // владельца: «всё, что связано с ядеркой, готовить заранее»).
      this.bloom();
      this.nukeTrajectory();
      this.nukeTelegraph();
      this.coordinateGrid();
    } catch (e) {
      // Прогрев — необязателен: не вышло, соберётся при первом использовании.
      console.warn("[GL] прогрев ленивых пассов пропущен", e);
    }
  }

  dispose(): void {
    this.stopLoop();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof window !== "undefined") {
      for (const ev of this.activityEvents) {
        window.removeEventListener(ev, this.bumpActivity);
      }
    }
    this.terrainPass.dispose();
    this.territoryPass.dispose();
    this.trailPass.dispose();
    this.borderStampPass.dispose();
    this.borderPass.dispose();
    this.defenseCoveragePass.dispose();
    this.fogPass?.dispose();
    this.bloomPass?.dispose();
    // Ленивые пассы освещения — могли и не строиться (см. pointLight()).
    this.pointLightPass?.dispose();
    this.falloutLightPass?.dispose();
    this.lightmapPass?.dispose();
    this.nightCompositePass?.dispose();
    this.heatManager.dispose();
    this.affiliationPalette.dispose();
    this.coordinateGridPass?.dispose();
    this.spawnOverlayPass.dispose();
    this.railroadPass?.dispose();
    this.rangeCirclePass?.dispose();
    this.samRadiusPass.dispose();
    this.crosshairPass?.dispose();
    this.structurePass.dispose();
    this.structureLevelPass.dispose();
    this.unitPass.dispose();
    this.namePass.dispose();
    this.fxPass.dispose();
    this.worldTextPass.dispose();
    this.radialMenuPass?.dispose();
    this.selectionBoxPass?.dispose();
    this.moveIndicatorPass?.dispose();
    this.nukeTrajectoryPass?.dispose();
    this.nukeTelegraphPass?.dispose();
    this.barPass.dispose();
    disposeGPUResources(this.gl, this.res);
    this.gl.deleteTexture(this.paletteTex);
    this.gl.deleteTexture(this.patternMetaTex);
    this.gl.deleteTexture(this.patternDataTex);
    this.gl.deleteTexture(this.skinLayerTex);
    this.gl.deleteTexture(this.skinAnchorTex);
    this.gl.deleteTexture(this.skinParamsTex);
    this.gl.deleteTexture(this.skinBBoxTex);
    this.skinAtlas.dispose();
    this.gl.deleteFramebuffer(this.sceneTarget.fbo);
    this.gl.deleteTexture(this.sceneTarget.tex);
    this.lastUnits = new Map();
    this.lastStructures = new Map();
  }
}

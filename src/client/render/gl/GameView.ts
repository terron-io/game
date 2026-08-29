/**
 * GameView — public facade for the openfront-gl renderer.
 *
 * Wraps GPURenderer (rendering) and Camera (viewport math) as private
 * implementation details. Handles all user interaction: drag-to-pan,
 * wheel-to-zoom, click detection, hover tracking, and hit-testing.
 *
 * Consumers only touch GameView — they never import GPURenderer or Camera.
 */

import type { Config } from "../../../core/configuration/Config";
import { noteGlContextLost, releaseGlContext } from "./GlContext";
import { clearShaderCache } from "./utils/GlUtils";
// terron: телеметрия/этика потери GL-контекста (белый экран на телефонах)
import { reportIos } from "../../IosReport";
import { confirmDialog, toast } from "../../Toast";
import { L } from "../../Utils";
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
import type {
  GameViewEventMap,
  GameViewEventType,
  RadialMenuItem,
} from "./Events";
import type { SpawnCenter } from "./passes/SpawnOverlayPass";
import type { AttackTroopLabel } from "./passes/WorldTextPass";
import { GPURenderer } from "./Renderer";
import type { RenderSettings } from "./RenderSettings";

export class GameView {
  private renderer: GPURenderer | null = null;
  private resizeObs: ResizeObserver | null = null;

  private listeners = new Map<string, Set<(e: unknown) => void>>();
  private cachedIcons: { key: string; img: CanvasImageSource }[] = [];

  // Stored for context recreation
  private cachedOnFrame: ((ms: number) => void) | null = null;
  private cachedAfterRender: ((canvas: HTMLCanvasElement) => void) | null =
    null;

  constructor(
    private canvas: HTMLCanvasElement,
    private header: RendererConfig,
    private terrainBytes: Uint8Array,
    private paletteData: Float32Array,
    private config: Config,
    private raf?: typeof requestAnimationFrame,
    private caf?: typeof cancelAnimationFrame,
  ) {
    this.initRenderer();

    this.resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) this.renderer?.resize(width, height);
      }
    });
    this.resizeObs.observe(canvas);

    canvas.addEventListener("webglcontextlost", this.onContextLost, false);
    canvas.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
      false,
    );
  }

  private initRenderer = () => {
    // Кэш шейдеров держит объекты, привязанные к ПРЕЖНЕМУ контексту. После
    // потери контекста браузер возвращает тот же объект контекста, поэтому
    // сверка по ссылке подмену не увидит — чистим руками (см. GlUtils).
    clearShaderCache();
    try {
      this.renderer = new GPURenderer(
        this.canvas,
        this.header,
        this.terrainBytes,
        this.paletteData,
        this.config,
        this.raf,
        this.caf,
      );
    } catch (e) {
      // ⚠️ terron 20.07: сборка рендера упала (у слабых Intel это бывает на
      // компиляции/линковке одной из 30 программ) — контекст канваса ОСТАЁТСЯ
      // живым и держит слот из браузерного лимита (~16 на вкладку). Игрок жмёт
      // «ещё раз», и через несколько попыток WebGL перестаёт выдаваться вовсе:
      // репорт вырождается в «WebGL2 not supported» на исправной машине.
      // Отпускаем слот и пробрасываем исходную ошибку дальше — она информативна.
      releaseGlContext(
        this.canvas.getContext("webgl2") as WebGL2RenderingContext | null,
      );
      throw e;
    }

    // Restore cached state
    if (this.cachedIcons.length > 0) {
      this.renderer.registerRadialMenuIcons(this.cachedIcons);
    }
    this.renderer.onFrame = this.cachedOnFrame;
    this.renderer.afterRender = this.cachedAfterRender;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0) this.renderer.resize(rect.width, rect.height);
  };

  // terron: потеря WebGL-контекста РАНЬШЕ была немой — на слабых телефонах
  // (вебвью под давлением памяти) канвас умирал, симуляция/HUD жили, игрок
  // видел вечный белый экран без единого сигнала (репорт «Taiwan map is
  // broken» 12.07). Теперь: телеметрия в /admin/ios + тост + если restore не
  // пришёл за 10с — предлагаем перезагрузку (реджойн в матч работает).
  private ctxRestoreTimer: number | null = null;

  private onContextLost = (e: Event) => {
    e.preventDefault();
    // Счётчик за вкладку — попадает в отчёт об ошибке. Серия потерь перед
    // отказом «WebGL2 not supported» = у браузера умер GPU-процесс, а не у нас
    // кончились контексты (10.08).
    noteGlContextLost();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    reportIos("webgl_context_lost", {});
    // Телеметрия здоровья: та же потеря контекста в общей сводке /stats/health
    // (ios_reports живёт отдельно и покрывает только вебвью-репорты).
    // terron 17.08: раньше событие летело ГОЛЫМ (detail и meta пустые) — по
    // 12-18 сессиям/день нельзя было ответить ни «какая карта», ни «какое
    // железо», ни «когда в жизни вкладки». Теперь тот же контекст, что у
    // надгробий tab_died, плюс аптайм страницы: потери кучкуются в первые
    // секунды матча (пик аллокаций старта) — поле sinceLoadS это докажет
    // или опровергнет прямо по базе.
    void import("../../Health").then(({ reportHealth, matchContext }) =>
      reportHealth("webgl_context_lost", "", {
        ...matchContext(),
        sinceLoadS: Math.round(performance.now() / 1000),
      }),
    );
    // terron ПЕРФ: устройство под давлением памяти → на следующей инициализации
    // (restore/reload) рендерим с меньшим бэкбуфером (GPURenderer.effectiveDpr
    // читает этот флаг), чтобы не свалиться повторно.
    try {
      localStorage.setItem("terron_gfx_low", "1");
      // счётчик «чистых» матчей реабилитации — с нуля (см. IosReport)
      localStorage.removeItem("terron_gfx_low_ok");
    } catch {
      /* ignore */
    }
    toast(
      L(
        "Сбой графики — пытаемся восстановить…",
        "Graphics context lost — trying to recover…",
      ),
      "error",
    );
    if (this.ctxRestoreTimer !== null) clearTimeout(this.ctxRestoreTimer);
    this.ctxRestoreTimer = window.setTimeout(() => {
      this.ctxRestoreTimer = null;
      if (this.renderer !== null) return; // восстановились сами
      reportIos("webgl_context_stuck", {});
      void (async () => {
        const ok = await confirmDialog(
          L(
            "Графика не восстановилась. Перезагрузить страницу? (Матч продолжится — реконнект вернёт вас в игру.)",
            "Graphics did not recover. Reload the page? (The match continues — reconnect will bring you back.)",
          ),
          L("Перезагрузить", "Reload"),
          L("Позже", "Later"),
        );
        // Внутри площадки перезагружать нельзя (переинициализирует SDK):
        // уходим в меню — новый матч создаст новый GL-контекст.
        if (ok) {
          void import("../../SoftNavigate").then(({ softHome }) => {
            if (!softHome("/")) window.location.reload();
          });
        }
      })();
    }, 10_000);
  };

  /**
   * Прогреть ленивые пассы в простое (зовётся после первого хода). Без него
   * блум собирался бы в момент первой ядерки — микро-фриз на зрелищном событии.
   */
  warmLazyPasses(): void {
    this.renderer?.warmLazyPasses();
  }

  private onContextRestored = () => {
    if (this.ctxRestoreTimer !== null) {
      clearTimeout(this.ctxRestoreTimer);
      this.ctxRestoreTimer = null;
    }
    // terron 21.07: событие «restored» пришло, но на слабом Intel после сброса
    // D3D-устройства getContext всё равно может вернуть null → initRenderer
    // бросит «WebGL2 not supported». РАНЬШЕ это летело фаталом в модалку ошибки
    // (тупик). Теперь ловим и ведём в тот же мягкий путь, что и при
    // не-пришедшем restore: предложить перезагрузку (матч жив, реконнект вернёт;
    // на перезагрузке флаг terron_gfx_low уже поднят → DPR ×0.5, см. Renderer).
    try {
      this.initRenderer();
    } catch (e) {
      reportIos("webgl_context_restore_failed", {
        errMsg: String((e as Error)?.message ?? e),
      });
      void (async () => {
        const ok = await confirmDialog(
          L(
            "Графика не восстановилась. Перезагрузить страницу? (Матч продолжится — реконнект вернёт вас в игру.)",
            "Graphics did not recover. Reload the page? (The match continues — reconnect will bring you back.)",
          ),
          L("Перезагрузить", "Reload"),
          L("Позже", "Later"),
        );
        // Внутри площадки перезагружать нельзя (переинициализирует SDK):
        // уходим в меню — новый матч создаст новый GL-контекст.
        if (ok) {
          void import("../../SoftNavigate").then(({ softHome }) => {
            if (!softHome("/")) window.location.reload();
          });
        }
      })();
      return;
    }
    this.emit("contextrestored", { type: "restored" });
    reportIos("webgl_context_restored", {});
    toast(L("Графика восстановлена", "Graphics recovered"), "success");
  };

  // ---- Event system ----

  on<K extends GameViewEventType>(
    event: K,
    handler: (e: GameViewEventMap[K]) => void,
  ): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (e: unknown) => void);
  }

  off<K extends GameViewEventType>(
    event: K,
    handler: (e: GameViewEventMap[K]) => void,
  ): void {
    this.listeners.get(event)?.delete(handler as (e: unknown) => void);
  }

  private emit<K extends GameViewEventType>(
    event: K,
    data: GameViewEventMap[K],
  ): void {
    const set = this.listeners.get(event);
    if (set)
      for (const fn of set) (fn as (e: GameViewEventMap[K]) => void)(data);
  }

  // ---- Radial menu ----

  showRadialMenu(
    screenX: number,
    screenY: number,
    items: RadialMenuItem[],
    centerItem?: RadialMenuItem,
  ): void {
    this.renderer?.showRadialMenu(screenX, screenY, items, centerItem);
  }

  hideRadialMenu(): void {
    this.renderer?.hideRadialMenu();
  }

  openRadialSubMenu(subItems: RadialMenuItem[]): void {
    this.renderer?.openRadialSubMenu(subItems);
  }

  goBackRadialMenu(): void {
    this.renderer?.goBackRadialMenu();
  }

  get radialMenuVisible(): boolean {
    return this.renderer?.radialMenuVisible ?? false;
  }
  /**
   * terron ПЕРФ (08.08): фазы сборки GL-вида в миллисекундах — уходят в meta
   * датчика `slow_renderer_build`. Пусто, если рендерер не поднялся.
   */
  getBuildPhases(): Readonly<Record<string, number>> {
    return this.renderer?.getBuildPhases() ?? {};
  }

  registerRadialMenuIcons(
    icons: { key: string; img: CanvasImageSource }[],
  ): void {
    this.cachedIcons = icons;
    this.renderer?.registerRadialMenuIcons(icons);
  }

  // ---- Camera ----

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return this.renderer?.screenToWorld(screenX, screenY) ?? { x: 0, y: 0 };
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return this.renderer?.worldToScreen(worldX, worldY) ?? { x: 0, y: 0 };
  }

  panTo(worldX: number, worldY: number): void {
    this.renderer?.panTo(worldX, worldY);
  }
  zoomTo(level: number): void {
    this.renderer?.zoomTo(level);
  }
  fitMap(): void {
    this.renderer?.fitMap();
  }
  focusOwner(ownerID: number): void {
    this.renderer?.focusOwner(ownerID);
  }

  focusBBox(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    padding?: number,
  ): void {
    this.renderer?.focusBBox(minX, minY, maxX, maxY, padding);
  }

  getCameraState(): { x: number; y: number; z: number } {
    return this.renderer?.getCameraState() ?? { x: 0, y: 0, z: 1 };
  }

  setCameraState(x: number, y: number, z: number): void {
    this.renderer?.setCameraState(x, y, z);
  }

  getOwnerAtWorld(worldX: number, worldY: number): number {
    return this.renderer?.getOwnerAtWorld(worldX, worldY) ?? 0;
  }

  // ---- Data upload ----

  applyFullFrame(
    tileState: Uint16Array,
    trailState: Uint8Array,
    nukeEvents?: Array<{ tick: number; tiles: number[] }>,
    currentTick?: number,
  ): void {
    this.renderer?.applyFullFrame(
      tileState,
      trailState,
      nukeEvents,
      currentTick,
    );
  }

  applyFullTiles(tileState: Uint16Array, trailState: Uint8Array): void {
    this.renderer?.applyFullTiles(tileState, trailState);
  }
  applyDelta(changedTiles: TilePair[], trailState: Uint8Array): void {
    this.renderer?.applyDelta(changedTiles, trailState);
  }
  uploadLiveDelta(tileState: Uint16Array, changedTiles: TilePair[]): void {
    this.renderer?.uploadLiveDelta(tileState, changedTiles);
  }
  uploadLiveTrailDelta(
    trailState: Uint8Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
  ): void {
    this.renderer?.uploadLiveTrailDelta(trailState, dirtyRowMin, dirtyRowMax);
  }
  // terron: скины пепла — «чей пепел» (smallID | skinIdx<<12) per tile.
  uploadFalloutOwners(
    falloutOwnerState: Uint16Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
  ): void {
    this.renderer?.uploadFalloutOwners(
      falloutOwnerState,
      dirtyRowMin,
      dirtyRowMax,
    );
  }
  /** Upload full tile + trail state without resetting bloom (for live play). */
  uploadTileAndTrailState(
    tileState: Uint16Array,
    trailState: Uint8Array,
  ): void {
    this.renderer?.uploadTileAndTrailState(tileState, trailState);
  }
  updatePalette(paletteData: Float32Array): void {
    this.renderer?.updatePalette(paletteData);
  }
  addPlayers(
    players: PlayerStatic[],
    paletteData: Float32Array,
    patternMeta: Float32Array,
    patternData: Uint8Array,
  ): void {
    this.renderer?.addPlayers(players, paletteData, patternMeta, patternData);
  }
  setPlayerSkin(smallID: number, url: string): void {
    this.renderer?.setPlayerSkin(smallID, url);
  }
  // terron: поздняя установка флага (клан-флаги резолвятся на клиенте async).
  setPlayerFlag(smallID: number, url: string): void {
    this.renderer?.setPlayerFlag(smallID, url);
  }
  // terron: Закрытая страна — подписи войск скрываются у закрытых стран.
  setTroopsHidden(smallIDs: ReadonlySet<number>): void {
    this.renderer?.setTroopsHidden(smallIDs);
  }

  // terron: Закрытая страна — скрыть юниты (постройки и технику) этих игроков.
  setUnitsHidden(smallIDs: ReadonlySet<number>): void {
    this.renderer?.setUnitsHidden(smallIDs);
  }
  initSkinAtlas(
    urls: readonly string[],
    letterbox?: ReadonlySet<string>,
    stretch?: ReadonlySet<string>,
  ): void {
    this.renderer?.initSkinAtlas(urls, letterbox, stretch);
  }
  setSkinDemo(
    mode: number,
    tileTiles: number,
    dim: number,
    ownerSmallID: number,
  ): void {
    this.renderer?.setSkinDemo(mode, tileTiles, dim, ownerSmallID);
  }
  /** terron виральность: per-owner режим/тайлинг/dim/aspect скина владельца. */
  setPlayerSkinParams(
    smallID: number,
    mode: number,
    tileTiles: number,
    dim: number,
    aspect = 1,
  ): void {
    this.renderer?.setPlayerSkinParams(smallID, mode, tileTiles, dim, aspect);
  }
  setPlayerSpawn(smallID: number, x: number, y: number): void {
    this.renderer?.setPlayerSpawn(smallID, x, y);
  }
  uploadRailroadState(data: Uint8Array): void {
    this.renderer?.uploadRailroadState(data);
  }
  updateUnits(units: Map<number, UnitState>, gameTick: number): void {
    this.renderer?.updateUnits(units, gameTick);
  }
  updateNames(
    names: Map<string, NameEntry>,
    players: Map<number, PlayerState>,
    snap: boolean,
    statusData?: Map<number, PlayerStatusData>,
  ): void {
    this.renderer?.updateNames(names, players, snap, statusData);
  }
  updateRelations(data: Uint8Array, size: number): void {
    this.renderer?.updateRelations(data, size);
  }
  updateStructures(units: Map<number, UnitState>): void {
    this.renderer?.updateStructures(units);
  }
  applyDeadUnits(deadUnits: DeadUnitFx[]): void {
    this.renderer?.applyDeadUnits(deadUnits);
  }
  applyConquestEvents(events: ConquestFx[]): void {
    this.renderer?.applyConquestEvents(events);
  }
  setAttackTroopLabels(labels: AttackTroopLabel[]): void {
    this.renderer?.setAttackTroopLabels(labels);
  }
  setBeachheadLabels(labels: AttackTroopLabel[]): void {
    this.renderer?.setBeachheadLabels(labels);
  }
  applyBonusEvents(events: BonusEvent[]): void {
    this.renderer?.applyBonusEvents(events);
  }
  applyRailroadDust(tileRefs: number[]): void {
    this.renderer?.applyRailroadDust(tileRefs);
  }
  /** Refresh terrain texels whose underlying terrain byte changed (water nukes). */
  applyTerrainDelta(refs: readonly number[], terrainBytes: Uint8Array): void {
    this.renderer?.applyTerrainDelta(refs, terrainBytes);
  }
  updateAttackRings(rings: AttackRingInput[]): void {
    this.renderer?.updateAttackRings(rings);
  }
  clearFx(): void {
    this.renderer?.clearFx();
  }
  setFxTimeFn(fn: () => number): void {
    this.renderer?.setFxTimeFn(fn);
  }

  /** Update ghost structure preview (build-mode visualization). null = clear. */
  updateGhostPreview(data: GhostPreviewData | null): void {
    this.renderer?.updateGhostPreview(data);
  }

  // ---- Nuke UI ----

  /** Update nuke trajectory preview arc. null = hide. */
  updateNukeTrajectory(data: NukeTrajectoryData | null): void {
    this.renderer?.updateNukeTrajectory(data);
  }

  /** Update in-flight nuke target telegraph circles. */
  updateNukeTelegraphs(data: NukeTelegraphData[]): void {
    this.renderer?.updateNukeTelegraphs(data);
  }

  /** Update spawn phase overlay (tile highlights + breathing rings). */
  updateSpawnOverlay(inSpawnPhase: boolean, centers: SpawnCenter[]): void {
    this.renderer?.updateSpawnOverlay(inSpawnPhase, centers);
  }

  // ---- Selection box ----

  /** Show/hide the stippled selection box around a unit (warship selection). */
  setSelectedUnit(unitId: number | null): void {
    this.renderer?.setSelectedUnit(unitId);
  }

  /** Set multiple selected units (multi-select). Pass [] to clear. */
  setSelectedUnits(unitIds: readonly number[]): void {
    this.renderer?.setSelectedUnits(unitIds);
  }

  /** Flash converging-chevron animation at a warship move target. */
  showMoveIndicator(tileX: number, tileY: number, ownerID: number): void {
    this.renderer?.showMoveIndicator(tileX, tileY, ownerID);
  }

  // ---- SAM radius (replay) ----

  setSAMRadiusVisible(visible: boolean): void {
    this.renderer?.setSAMRadiusVisible(visible);
  }
  setSAMPerspective(playerID: number, allies: Set<number>): void {
    this.renderer?.setSAMPerspective(playerID, allies);
  }
  setSAMColorMode(mode: "perspective" | "owner"): void {
    this.renderer?.setSAMColorMode(mode);
  }
  setSAMAllianceClusters(clusters: Map<number, number>): void {
    this.renderer?.setSAMAllianceClusters(clusters);
  }

  // ---- Other ----

  setLocalPlayerID(id: number): void {
    this.renderer?.setLocalPlayerID(id);
  }
  // terron: туман войны — вкл/выкл композита (конфиг лобби × фаза × жив ×
  // блэкаут «Неба нашего»). wave = эпицентр волны тьмы/света;
  // contract = обратная анимация (круг схлопывается в эпицентр).
  setFogOfWar(
    on: boolean,
    wave?: { x: number; y: number; contract?: boolean },
  ): void {
    this.renderer?.setFogOfWar(on, wave);
  }
  // terron: туман — окна видимости после своих ударов/высадок (5с + схлоп).
  setFogReveals(reveals: Array<{ x: number; y: number; r: number }>): void {
    this.renderer?.setFogReveals(reveals);
  }
  // terron: «Небо наше» — пульс-кольцо на антиспутниковом штабе в касте.
  pushSatCastPing(x: number, y: number): void {
    this.renderer?.pushSatCastPing(x, y);
  }

  pushFortShot(fromX: number, fromY: number, toX: number, toY: number): void {
    this.renderer?.pushFortShot(fromX, fromY, toX, toY);
  }
  setAltView(active: boolean): void {
    this.renderer?.setAltView(active);
  }
  setGridView(active: boolean): void {
    this.renderer?.setGridView(active);
  }
  setShowPatterns(active: boolean): void {
    this.renderer?.setShowPatterns(active);
  }
  setHighlightOwner(ownerID: number): void {
    this.renderer?.setHighlightOwner(ownerID);
  }

  // terron: свой игрок — его ник не отсекается по зуму.
  setMyOwner(ownerID: number): void {
    this.renderer?.setMyOwner(ownerID);
  }
  // terron: позиция курсора (мир) для фейда ника под мышью.
  setNameHoverCursor(worldX: number, worldY: number): void {
    this.renderer?.setNameHoverCursor(worldX, worldY);
  }
  setHighlightStructureTypes(unitTypes: string[] | null): void {
    this.renderer?.setHighlightStructureTypes(unitTypes);
  }
  // terron: ПИРАТСТВО — зоны блокады торговли.
  setHazardCircles(list: { x: number; y: number; radius: number }[]): void {
    this.renderer?.setHazardCircles(list);
  }
  // terron: круг радиуса структуры под курсором (щит/ПВО/минправды).
  setStructureHoverCircle(
    c: { x: number; y: number; radius: number; friendly: boolean } | null,
  ): void {
    this.renderer?.setStructureHoverCircle(c);
  }
  getSettings(): RenderSettings {
    return this.renderer?.getSettings() ?? ({} as RenderSettings);
  }
  get fps(): number {
    return this.renderer?.fps ?? 0;
  }
  set onFrame(cb: ((ms: number) => void) | null) {
    this.cachedOnFrame = cb;
    if (this.renderer) this.renderer.onFrame = cb;
  }
  set afterRender(cb: ((canvas: HTMLCanvasElement) => void) | null) {
    this.cachedAfterRender = cb;
    if (this.renderer) this.renderer.afterRender = cb;
  }

  // ---- Lifecycle ----

  dispose(): void {
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.listeners.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    // ⚠️ terron 20.07: слот контекста отдаём браузеру ЯВНО. dispose() пассов
    // чистит только ресурсы ВНУТРИ контекста, сам контекст живёт до сборки
    // мусора — а её сроки никто не гарантирует. Матч за матчем в одной вкладке
    // слоты копились (лимит ~16), и в какой-то момент новый матч получал
    // «WebGL2 not supported» на исправной видеокарте.
    // Слушатели contextlost сняты выше — искусственная потеря никого не будит.
    releaseGlContext(
      this.canvas.getContext("webgl2") as WebGL2RenderingContext | null,
    );
  }
}

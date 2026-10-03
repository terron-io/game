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
import { toast } from "../../Toast";
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
import { contextLossDecision } from "./ContextLossPolicy";
import type {
  GameViewEventMap,
  GameViewEventType,
  RadialMenuItem,
} from "./Events";
import { FRESH_CANVAS_AFTER_MS, swapInFreshCanvas } from "./FreshCanvas";
import type { SpawnCenter } from "./passes/SpawnOverlayPass";
import type { RendererIntegritySnapshot } from "./passes/TerritoryPass";
import type { AttackTroopLabel } from "./passes/WorldTextPass";
import { GPURenderer } from "./Renderer";
import type { RenderSettings } from "./RenderSettings";
import type { VisualStyle } from "./VisualStyles";

// terron 05.09: счётчики потерь контекста за ЖИЗНЬ СТРАНИЦЫ (не за матч) —
// решение «пересобирать или сдаться» принимает ContextLossPolicy.
let contextLossNo = 0;
let lastContextLossAt = 0;
const CONTEXT_LOSS_SERIES_MS = 10 * 60_000;

// terron 25.09: телеметрия восстановления. Неделя до правки: у 200 из 378
// первых потерь вторая пришла меньше чем через 10 с — пересборка шла через
// 2.5 с, пока видеокарта ещё не оправилась. Чтобы решить, сколько ждать, нужно
// знать, КАК и ЗА СКОЛЬКО графика возвращается: сама (restored), на новом
// холсте (fresh) или никак. `gl_restore` несёт путь и миллисекунды от потери.
let lastLossPerfMs = 0;

/** Потерь графики на ЭТОМ устройстве за всё время (переживает перезагрузки). */
const DEVICE_LOSSES_KEY = "terron_gl_losses";
function bumpDeviceLosses(): number {
  try {
    const n = (Number(localStorage.getItem(DEVICE_LOSSES_KEY)) || 0) + 1;
    localStorage.setItem(DEVICE_LOSSES_KEY, String(n));
    return n;
  } catch {
    return -1;
  }
}
function deviceLosses(): number {
  try {
    return Number(localStorage.getItem(DEVICE_LOSSES_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Браузер и мажорная версия: старый драйвер и конкретная версия Chrome — разные классы. */
export function browserTag(ua: string): string {
  const m =
    /YaBrowser\/(\d+)/.exec(ua) ??
    /Edg\/(\d+)/.exec(ua) ??
    /OPR\/(\d+)/.exec(ua) ??
    /Firefox\/(\d+)/.exec(ua) ??
    /Chrome\/(\d+)/.exec(ua) ??
    /Version\/(\d+).*Safari/.exec(ua);
  if (!m) return "other";
  const name = /YaBrowser/.test(m[0])
    ? "yandex"
    : /Edg/.test(m[0])
      ? "edge"
      : /OPR/.test(m[0])
        ? "opera"
        : /Firefox/.test(m[0])
          ? "firefox"
          : /Chrome/.test(m[0])
            ? "chrome"
            : "safari";
  return `${name}${m[1]}`;
}

function reportRestore(via: "restored" | "fresh" | "failed" | "giveup"): void {
  const ms = lastLossPerfMs
    ? Math.round(performance.now() - lastLossPerfMs)
    : null;
  void import("../../Health").then(({ reportHealth }) =>
    reportHealth("gl_restore", `${via} ${ms ?? "?"}мс`, {
      via,
      ms,
      lossNo: contextLossNo,
    }),
  );
}

/**
 * terron 25.09: окно сбоя с шагами решения (GraphicsHelpDialog) вместо голого
 * «Перезагрузить?». Выбор игрока — в телеметрию; «лёгкая графика» включает ту
 * же настройку, что в шестерёнке, до перезагрузки.
 */
function offerGraphicsHelp(
  reason: "giveup" | "stuck" | "restore_failed",
): void {
  void (async () => {
    const [{ showGraphicsHelp }, health, { UserSettings }] = await Promise.all([
      import("../../GraphicsHelpDialog"),
      import("../../Health"),
      import("../../../core/game/UserSettings"),
    ]);
    const settings = new UserSettings();
    const info = {
      gpu: health.currentGpuName(),
      losses: Math.max(contextLossNo, 1),
      lightOn: settings.lightGraphics(),
    };
    const choice = await showGraphicsHelp(reason, info, (c) =>
      health.reportHealth("gl_help_choice", `${reason} ${c}`, {
        reason,
        choice: c,
        lightOn: info.lightOn,
        devLosses: deviceLosses(),
      }),
    );
    if (choice === "later") return;
    if (choice === "light" && !settings.lightGraphics()) {
      settings.toggleLightGraphics();
    }
    // Внутри площадки перезагружать нельзя (переинициализирует SDK):
    // уходим в меню — новый матч создаст новый GL-контекст.
    const { softHome } = await import("../../SoftNavigate");
    if (!softHome("/")) window.location.reload();
  })();
}

export class GameView {
  private renderer: GPURenderer | null = null;
  private resizeObs: ResizeObserver | null = null;

  private listeners = new Map<string, Set<(e: unknown) => void>>();
  private cachedIcons: { key: string; img: CanvasImageSource }[] = [];

  // Stored for context recreation
  // terron (визуальные стили): стиль переживает пересборку рендера — после
  // потери GL-контекста карта обязана вернуться в ТОМ ЖЕ стиле, а не скакнуть
  // в классику посреди матча.
  private cachedVisualStyle: VisualStyle | null = null;
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
    this.originalCanvas = canvas;
    this.initRenderer();

    this.resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) this.renderer?.resize(width, height);
      }
    });
    this.attachCanvas(canvas);
  }

  /** Холст, на котором рисует рендер сейчас (после FreshCanvas — новый). */
  get canvasElement(): HTMLCanvasElement {
    return this.canvas;
  }

  private attachCanvas(c: HTMLCanvasElement): void {
    this.resizeObs?.observe(c);
    c.addEventListener("webglcontextlost", this.onContextLost, false);
    c.addEventListener("webglcontextrestored", this.onContextRestored, false);
  }

  private detachCanvas(c: HTMLCanvasElement): void {
    this.resizeObs?.unobserve(c);
    c.removeEventListener("webglcontextlost", this.onContextLost);
    c.removeEventListener("webglcontextrestored", this.onContextRestored);
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
    if (this.cachedVisualStyle !== null) {
      this.renderer.setVisualStyle(this.cachedVisualStyle);
    }
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
  // terron 13.09: браузер не вернул графику за FRESH_CANVAS_AFTER_MS — строим
  // рендер на новом холсте (FreshCanvas). Исходный холст удаляет раннер, свой
  // новый — мы в dispose().
  private freshTimer: number | null = null;
  private readonly originalCanvas: HTMLCanvasElement;
  private disposed = false;

  private onContextLost = (e: Event) => {
    e.preventDefault();
    // Счётчик за вкладку — попадает в отчёт об ошибке. Серия потерь перед
    // отказом «WebGL2 not supported» = у браузера умер GPU-процесс, а не у нас
    // кончились контексты (10.08).
    noteGlContextLost();
    // terron 05.09: ПОЛИТИКА ПОТЕРЬ (ContextLossPolicy). Первая потеря —
    // восстанавливаемся в щадящем режиме; вторая — GL больше не трогаем и
    // сразу предлагаем перезагрузку: третий «виновный» сброс = Chrome
    // блокирует WebGL сайту до перезапуска браузера (223 сессии/нед).
    // Потери старше 10 минут не считаем серией: блок Chrome — про сбросы
    // подряд, а на площадках страница живёт без перезагрузки часами.
    if (
      lastContextLossAt !== 0 &&
      performance.now() - lastContextLossAt > CONTEXT_LOSS_SERIES_MS
    ) {
      contextLossNo = 0;
    }
    contextLossNo++;
    const sinceLastLossS =
      lastContextLossAt === 0
        ? null
        : Math.round((performance.now() - lastContextLossAt) / 1000);
    lastContextLossAt = performance.now();
    lastLossPerfMs = lastContextLossAt;
    const devLosses = bumpDeviceLosses();
    const decision = contextLossDecision(contextLossNo);
    GPURenderer.safeMode = true;
    // Снимок состояния рендера — ДО dispose, иначе снимать не с чего.
    let lossSnap: Record<string, unknown> = {};
    try {
      lossSnap = this.renderer?.lossSnapshot() ?? {};
    } catch {
      /* контекст уже мёртв — снимок не обязателен */
    }
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
        ...lossSnap,
        sinceLoadS: Math.round(performance.now() / 1000),
        lossNo: contextLossNo,
        sinceLastLossS,
        decision,
        // terron 25.09: хронический ли это компьютер, помогла ли лёгкая
        // графика, была ли вкладка скрыта и какой браузер (GraphicsHelpDialog).
        devLosses,
        lightOn: GPURenderer.lightGraphicsChosen(),
        hidden: document.hidden,
        br: browserTag(navigator.userAgent),
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
    // terron 13.09: первая потеря — ждём браузер недолго, дальше новый холст.
    if (this.freshTimer !== null) clearTimeout(this.freshTimer);
    this.freshTimer =
      decision === "rebuild-safe"
        ? window.setTimeout(this.recoverOnFreshCanvas, FRESH_CANVAS_AFTER_MS)
        : null;
    if (this.ctxRestoreTimer !== null) clearTimeout(this.ctxRestoreTimer);
    this.ctxRestoreTimer = window.setTimeout(() => {
      this.ctxRestoreTimer = null;
      if (this.renderer !== null) return; // восстановились сами
      reportIos("webgl_context_stuck", {});
      reportRestore("failed");
      offerGraphicsHelp("stuck");
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
    if (this.freshTimer !== null) {
      clearTimeout(this.freshTimer);
      this.freshTimer = null;
    }
    // terron 21.07: событие «restored» пришло, но на слабом Intel после сброса
    // D3D-устройства getContext всё равно может вернуть null → initRenderer
    // бросит «WebGL2 not supported». РАНЬШЕ это летело фаталом в модалку ошибки
    // (тупик). Теперь ловим и ведём в тот же мягкий путь, что и при
    // не-пришедшем restore: предложить перезагрузку (матч жив, реконнект вернёт;
    // на перезагрузке флаг terron_gfx_low уже поднят → DPR ×0.5, см. Renderer).
    if (contextLossDecision(contextLossNo) === "give-up") {
      // Вторая потеря за страницу: пересборка = почти наверняка третий сброс и
      // блок WebGL на весь сеанс браузера. Не трогаем GL, зовём перезагрузку.
      reportIos("webgl_context_giveup", {});
      void import("../../Health").then(({ reportHealth }) =>
        reportHealth("webgl_context_giveup", `потерь: ${contextLossNo}`),
      );
      reportRestore("giveup");
      offerGraphicsHelp("giveup");
      return;
    }
    try {
      this.initRenderer();
    } catch (e) {
      reportIos("webgl_context_restore_failed", {
        errMsg: String((e as Error)?.message ?? e),
      });
      reportRestore("failed");
      offerGraphicsHelp("restore_failed");
      return;
    }
    this.emit("contextrestored", { type: "restored" });
    reportIos("webgl_context_restored", {});
    reportRestore("restored");
    toast(L("Графика восстановлена", "Graphics recovered"), "success");
  };

  /**
   * terron 13.09: браузер не вернул контекст — пересобираем рендер на НОВОМ
   * холсте (FreshCanvas). Только после ПЕРВОЙ потери: вторая = GL не трогаем
   * (ContextLossPolicy), иначе Chrome заблокирует WebGL сайту. Не вышло —
   * остаётся таймер «графика не восстановилась» с предложением перезагрузки.
   */
  private recoverOnFreshCanvas = (): void => {
    this.freshTimer = null;
    if (this.disposed || this.renderer !== null) return;
    if (contextLossDecision(contextLossNo) === "give-up") return;
    const old = this.canvas;
    this.detachCanvas(old);
    const fresh = swapInFreshCanvas(old);
    this.canvas = fresh;
    this.attachCanvas(fresh);
    try {
      this.initRenderer();
    } catch (e) {
      reportIos("webgl_context_fresh_failed", {
        errMsg: String((e as Error)?.message ?? e),
      });
      return;
    }
    if (this.ctxRestoreTimer !== null) {
      clearTimeout(this.ctxRestoreTimer);
      this.ctxRestoreTimer = null;
    }
    this.emit("contextrestored", { type: "restored" });
    reportIos("webgl_context_fresh", {});
    reportRestore("fresh");
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
  /** terron 05.09: все лапы сборки пассов (мс) — для замера в браузере. */
  getBuildLaps(): Readonly<Record<string, number>> {
    return this.renderer?.buildLaps ?? {};
  }
  /** Ограничения щадящего режима/«Лёгкой графики» поверх пересчитанных настроек. */
  applyGraphicsCaps(): void {
    if (this.renderer)
      GPURenderer.applyGraphicsCaps(this.renderer.getSettings());
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
    dirtyRows: Uint8Array | null,
  ): void {
    this.renderer?.uploadFalloutOwners(
      falloutOwnerState,
      dirtyRowMin,
      dirtyRowMax,
      dirtyRows,
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
  markUnitsDirty(): void {
    this.renderer?.markUnitsDirty();
  }
  updateUnits(
    units: Map<number, UnitState>,
    gameTick: number,
    changedIds: readonly number[] | null = null,
  ): void {
    this.renderer?.updateUnits(units, gameTick, changedIds);
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
  /** Вся карта рельефа одним вызовом — только для перезаливки после потери контекста. */
  uploadFullTerrain(terrainBytes: Uint8Array): void {
    this.renderer?.uploadFullTerrain(terrainBytes);
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

  /** terron 12.09: датчик целостности карты — см. client/TerritoryIntegrity.ts. */
  territoryIntegrity(): RendererIntegritySnapshot | null {
    return this.renderer?.territoryIntegrity() ?? null;
  }

  territoryReadback(
    x0: number,
    y0: number,
    w: number,
    h: number,
  ): Uint16Array | null {
    return this.renderer?.territoryReadback(x0, y0, w, h) ?? null;
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
  // terron: визуальный стиль карты (палитра рельефа + пост-обработка земли).
  setVisualStyle(style: VisualStyle): void {
    this.cachedVisualStyle = style;
    this.renderer?.setVisualStyle(style);
  }
  getSettings(): RenderSettings {
    return this.renderer?.getSettings() ?? ({} as RenderSettings);
  }
  /** terron 14.09: рендер жив. Между потерей контекста и пересборкой его нет,
   *  а getSettings() отдаёт пустой объект — писать в него настройки нельзя. */
  get rendererReady(): boolean {
    return this.renderer !== null;
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
    // terron 05.09 (ревью): таймер «графика не восстановилась» не должен
    // пережить матч — иначе диалог перезагрузки всплывал уже в меню.
    if (this.ctxRestoreTimer !== null) {
      clearTimeout(this.ctxRestoreTimer);
      this.ctxRestoreTimer = null;
    }
    if (this.freshTimer !== null) {
      clearTimeout(this.freshTimer);
      this.freshTimer = null;
    }
    this.disposed = true;
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
    // Свой свежий холст (FreshCanvas) убираем сами: раннер знает только
    // исходный и удалит его, как раньше.
    if (this.canvas !== this.originalCanvas) this.canvas.remove();
  }
}

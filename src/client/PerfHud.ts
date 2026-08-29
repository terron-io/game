/**
 * terron 22.08: ЗАМЕР ПРОИЗВОДИТЕЛЬНОСТИ МАТЧА — датчик на экране (дев) +
 * ОДИН отчёт на сервер по итогам матча (везде, включая прод).
 *
 * Повод (владелец): «лагает страшно», а объективной цифры нет; и главное —
 * непонятно, «приносят ли правки победу или мы чот ухудшаем». Глазом это не
 * решается: у каждого своё железо, своя карта и свой фоновый Steam.
 *
 * ДВЕ РАЗНЫЕ ОСИ — чтобы причина читалась с одного взгляда:
 *   - КАДРЫ (fps, p95) — успевает ли рисовать GPU/главный поток;
 *   - СИМУЛЯЦИЯ (тик/с, очередь воркера) — успевает ли сим за сервером.
 * Просело и то и другое разом → машина занята посторонним (22.08 виноват был
 * качающий Steam). Только кадры → рендер. Только сим/очередь → сим или сеть.
 *
 * ПОЧЕМУ ДАННЫХ БУДЕТ МАЛО. Мы не шлём поток кадров. За матч копится
 * ГИСТОГРАММА длительностей кадра (8 счётчиков, память не растёт), и в конце
 * уходит ОДНО событие `perf_summary` со сводкой. Это ~15 чисел на матч на
 * игрока — на порядки меньше, чем посекундные замеры, но по гистограмме
 * восстанавливаются и медиана, и p95, и хвост, а распределения двух сборок
 * сравниваются честно.
 *
 * Экранный оверлей — только там, где включена перф-диагностика (`perfDiagEnabled`:
 * дев всегда, любой домен по `?debug=perf`). СБОР идёт ВЕЗДЕ: без прода вопрос
 * «стало лучше или хуже после выката» не имеет ответа.
 */
import { perfDiagEnabled } from "./CamDiag";
import { reportHealth } from "./Health";

/** Окно для ЖИВЫХ цифр на экране. 180 ≈ 3 секунды при 60fps. */
const WINDOW = 180;
/** Как часто перерисовываем текст. Чаще — рябит и само жрёт время. */
const REDRAW_MS = 500;
/** Сервер шлёт 10 ходов в секунду — эталон, с которым сравниваем симуляцию. */
const TARGET_TPS = 10;

/**
 * Границы вёдер гистограммы кадра, мс. Выбраны по смыслу, а не равномерно:
 * 8.3 = 120fps, 16.7 = 60fps, 25 = 40fps, 33.3 = 30fps, 50 = 20fps,
 * 100 = заметный рывок. Последнее ведро — «фриз».
 */
const BUCKETS = [8.3, 16.7, 25, 33.3, 50, 100, 250];

/** Короче матча отчёт не шлём: 20 секунд возни в лобби — это не замер. */
const MIN_REPORT_MS = 60_000;
/** И слишком мало кадров тоже не показатель. */
const MIN_REPORT_FRAMES = 600;

declare const __BUILD_TIME__: number;

interface MatchCtx {
  map?: string;
  players?: number;
}

class PerfMeter {
  // ---- экранная часть (только под perfDiagEnabled) ----
  private el: HTMLDivElement | null = null;
  private timer: number | null = null;
  private live = new Float32Array(WINDOW);
  private liveCount = 0;
  private liveHead = 0;
  private sortBuf = new Float32Array(WINDOW);
  private ticksSinceRedraw = 0;
  private lastRedrawAt = 0;

  // ---- замер за весь матч (идёт всегда) ----
  private running = false;
  private startedAt = 0;
  private lastFrameAt = 0;
  private hist = new Int32Array(BUCKETS.length + 1);
  private frames = 0;
  private worstFrame = 0;
  private simTicks = 0;
  private maxBacklog = 0;
  private backlog = 0;
  private longTasks = 0;
  private blockedMs = 0;
  private longTaskObs: PerformanceObserver | null = null;
  private ctx: MatchCtx = {};
  private reported = false;

  start(ctx: MatchCtx = {}): void {
    if (this.running) return;
    this.running = true;
    this.reported = false;
    this.ctx = ctx;
    this.startedAt = performance.now();
    this.lastFrameAt = 0;
    this.hist.fill(0);
    this.frames = 0;
    this.worstFrame = 0;
    this.simTicks = 0;
    this.maxBacklog = 0;
    this.backlog = 0;
    this.longTasks = 0;
    this.blockedMs = 0;
    this.liveCount = 0;
    this.liveHead = 0;
    this.ticksSinceRedraw = 0;
    this.lastRedrawAt = this.startedAt;

    try {
      this.longTaskObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration < 100) continue;
          this.longTasks++;
          this.blockedMs += e.duration;
        }
      });
      this.longTaskObs.observe({ entryTypes: ["longtask"] });
    } catch {
      this.longTaskObs = null; // Safari — просто без этой оси
    }

    if (perfDiagEnabled()) this.showHud();
  }

  /** Обновить контекст матча (число игроков известно не сразу). */
  setContext(ctx: MatchCtx): void {
    this.ctx = { ...this.ctx, ...ctx };
  }

  stop(): void {
    if (!this.running) return;
    this.report();
    this.running = false;
    this.longTaskObs?.disconnect();
    this.longTaskObs = null;
    this.hideHud();
  }

  /** Зовётся из кадрового цикла (RAF). Должно быть максимально дешёвым. */
  frame(): void {
    if (!this.running) return;
    const now = performance.now();
    if (this.lastFrameAt !== 0) {
      const dt = now - this.lastFrameAt;
      // Вкладка была скрыта (RAF стоял) — это не кадр, не портим хвост.
      if (dt > 1000) {
        this.lastFrameAt = now;
        return;
      }
      this.frames++;
      if (dt > this.worstFrame) this.worstFrame = dt;
      let b = 0;
      while (b < BUCKETS.length && dt > BUCKETS[b]) b++;
      this.hist[b]++;
      if (this.el !== null) {
        this.live[this.liveHead] = dt;
        this.liveHead = (this.liveHead + 1) % WINDOW;
        if (this.liveCount < WINDOW) this.liveCount++;
      }
    }
    this.lastFrameAt = now;
  }

  /** Зовётся на каждом обновлении из воркера симуляции. */
  simTick(pendingTurns: number | undefined): void {
    if (!this.running) return;
    this.simTicks++;
    this.ticksSinceRedraw++;
    this.backlog = pendingTurns ?? 0;
    if (this.backlog > this.maxBacklog) this.maxBacklog = this.backlog;
  }

  /**
   * ОДИН отчёт за матч. Идемпотентен — зовётся и из stop(), и из pagehide
   * (игрок закрыл вкладку, не досмотрев итоги: такие матчи как раз самые
   * тяжёлые, терять их нельзя).
   */
  report(): void {
    if (!this.running || this.reported) return;
    const dur = performance.now() - this.startedAt;
    if (dur < MIN_REPORT_MS || this.frames < MIN_REPORT_FRAMES) return;
    this.reported = true;

    const med = this.histPercentile(0.5);
    const p95 = this.histPercentile(0.95);
    const tps = this.simTicks / (dur / 1000);
    reportHealth(
      "perf_summary",
      `fps~${(1000 / Math.max(med, 0.001)).toFixed(0)} p95=${p95.toFixed(0)}мс ` +
        `сим=${tps.toFixed(1)}/с очередь_макс=${this.maxBacklog}`,
      {
        // Сводка кадров: гистограмма (по ней считаются любые перцентили) +
        // худший кадр. Ключи короткие — meta режется на сервере.
        h: Array.from(this.hist),
        f: this.frames,
        wf: Math.round(this.worstFrame),
        // Симуляция.
        t: this.simTicks,
        tps: +tps.toFixed(2),
        bl: this.maxBacklog,
        // Заблокированность главного потока — то, что ощущается как рывки
        // даже при приличном среднем fps.
        lt: this.longTasks,
        lms: Math.round(this.blockedMs),
        // Контекст: без него цифры несравнимы (большой поздний матч против
        // маленького раннего).
        d: Math.round(dur / 1000),
        map: this.ctx.map ?? null,
        pl: this.ctx.players ?? null,
        // Идентификатор сборки — ради этого всё и затевалось: сравнивать
        // распределения ДО и ПОСЛЕ выката.
        b: typeof __BUILD_TIME__ === "number" ? __BUILD_TIME__ : null,
      },
    );
  }

  /** Перцентиль по гистограмме: возвращает верхнюю границу нужного ведра. */
  private histPercentile(p: number): number {
    const target = this.frames * p;
    let acc = 0;
    for (let i = 0; i < this.hist.length; i++) {
      acc += this.hist[i];
      if (acc >= target) return i < BUCKETS.length ? BUCKETS[i] : 250;
    }
    return 250;
  }

  // ---------------------------------------------------------------- оверлей

  private showHud(): void {
    if (this.el !== null || typeof document === "undefined") return;
    const el = document.createElement("div");
    el.id = "terron-perf-hud";
    // ⚠️ z-index НАМЕРЕННО НИЗКИЙ (решение владельца 22.08): датчик обязан
    // уходить ПОД остальной интерфейс — панель скорости повтора, меню, модалки.
    // Он справочный, перекрывать им управление нельзя. pointer-events:none —
    // клики по карте не воруем.
    el.style.cssText = [
      "position:fixed",
      "top:64px",
      "right:8px",
      "z-index:1",
      "pointer-events:none",
      "font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace",
      "background:rgba(0,0,0,.55)",
      "color:#c8f7c5",
      "padding:5px 8px",
      "border-radius:6px",
      "white-space:pre",
      "text-align:right",
      "letter-spacing:.2px",
    ].join(";");
    document.body.appendChild(el);
    this.el = el;
    this.timer = window.setInterval(() => this.redraw(), REDRAW_MS);
  }

  private hideHud(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.el?.remove();
    this.el = null;
  }

  private livePercentile(p: number): number {
    const n = this.liveCount;
    if (n === 0) return 0;
    const buf = this.sortBuf.subarray(0, n);
    buf.set(this.live.subarray(0, n));
    buf.sort();
    return buf[Math.min(n - 1, Math.floor(n * p))];
  }

  private redraw(): void {
    const el = this.el;
    if (el === null) return;
    const now = performance.now();
    const elapsed = (now - this.lastRedrawAt) / 1000;
    const tps = elapsed > 0 ? this.ticksSinceRedraw / elapsed : 0;
    this.ticksSinceRedraw = 0;
    this.lastRedrawAt = now;

    const med = this.livePercentile(0.5);
    const p95 = this.livePercentile(0.95);
    const fps = med > 0 ? 1000 / med : 0;
    const bad =
      fps < 30 || p95 > 50 || tps < TARGET_TPS * 0.8 || this.backlog > 20;
    el.style.color = bad ? "#ff8a80" : "#c8f7c5";

    const lines = [
      `${fps.toFixed(0)} fps   кадр ${med.toFixed(1)} / p95 ${p95.toFixed(0)} мс`,
      `сим ${tps.toFixed(1)}/${TARGET_TPS} тик/с   очередь ${this.backlog}`,
    ];
    if (this.longTaskObs !== null) {
      lines.push(`заминок >100мс: ${this.longTasks}`);
    }
    el.textContent = lines.join("\n");
  }
}

export const perfHud = new PerfMeter();

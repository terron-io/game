/**
 * terron 12.09: ДАТЧИК ЦЕЛОСТНОСТИ КАРТЫ.
 *
 * Давний репорт владельца: сменил вкладку / свернул браузер → вернулся →
 * территория на экране застыла, а войска, золото и подписи живые. Живое
 * воспроизведение баг не повторило, поэтому ловим его у всех игроков.
 *
 * Путь тайла: воркер → зеркало карты (view/GameView) → очередь капель
 * TerritoryPass → копия рендера (cpuTileState) → текстура видеокарты → экран.
 * Датчик разводит, на каком звене застряло:
 *  • lost    — копия рендера ≠ зеркалу, и тайла НЕТ в очереди: обновление
 *              потеряно по пути в рендер (инвариант, ложных срабатываний нет);
 *  • own     — зеркало ≠ счётчику клеток игрока (он приходит целиком каждый
 *              ход): ходы потеряны ещё ДО зеркала — «карта застыла, числа живые»;
 *  • tex     — видеокарта ≠ копии рендера: запись в текстуру не долетела;
 *  • noframe — кадров нет вовсе (цикл рисования мёртв после возврата);
 *  • fp      — полная заливка висит две проверки подряд.
 * Всё чисто, а экран врёт — значит, виновата отрисовка поверх (скин, туман…);
 * это доказывают «чистые срезы» после возврата вкладки/реконнекта/догона.
 *
 * Цена: проход по тайлам карты раз в 10 с (дев) / 30 с (прод), кусками не
 * дольше ~4 мс — длинных задач нет даже на слабом телефоне и большой карте.
 * Скрытая вкладка не проверяется. Чтение видеокарты: на деве каждую проверку,
 * на проде — окно 32×32 после возврата вкладки и не чаще раза в 5 минут.
 */
import { reportHealth, reportHealthBeacon } from "./Health";
import type { RendererIntegritySnapshot } from "./render/gl/passes/TerritoryPass";
import { isDevSite } from "./Utils";

declare const __BUILD_TIME__: number | undefined;

const OWNER = 0xfff;
const MAX_STALE = 3;
const REPORT_GAP_MS = 60_000;
const AFTER_VISIBLE_MS = 1500;
const SLICE_TILES = 65_536;
const SLICE_BUDGET_MS = 4;
const NOFRAME_MS = 2000;
const META_BUDGET = 900;
const PROD_READBACK_GAP_MS = 5 * 60_000;
const PROD_READBACK_MAX = 6;
const PROD_READBACK_SLOW_MS = 8;
const SUMMARY_MIN_MS = 60_000;

export interface TerritoryScan {
  /** Копия рендера ≠ зеркалу, и тайла нет в очереди — потерянные. */
  lost: number;
  /** Из них — где один из владельцев сам игрок. */
  lostMine: number;
  /** Расхождения, которые стоят в очереди, — обычная задержка отрисовки. */
  inFlight: number;
  /** Своих тайлов в зеркале карты. */
  simMine: number;
  /** Своих тайлов в копии рендера. */
  rcMine: number;
  /** Чья земля потеряна: [smallID владельца в зеркале, число тайлов]. */
  topOwners: Array<[number, number]>;
  /** Примеры потерь: [тайл, владелец в зеркале, владелец в копии рендера]. */
  samples: Array<[number, number, number]>;
  /** Рамка своих тайлов в зеркале: minX, minY, maxX, maxY. */
  bbox: [number, number, number, number] | null;
}

interface ScanAcc {
  lost: number;
  lostMine: number;
  inFlight: number;
  simMine: number;
  rcMine: number;
  owners: Map<number, number>;
  samples: Array<[number, number, number]>;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function newAcc(): ScanAcc {
  return {
    lost: 0,
    lostMine: 0,
    inFlight: 0,
    simMine: 0,
    rcMine: 0,
    owners: new Map(),
    samples: [],
    minX: Infinity,
    minY: Infinity,
    maxX: -1,
    maxY: -1,
  };
}

/** Битовая маска «тайл стоит в очереди». Перестраивается перед каждым куском:
 *  между кусками приходят ходы и рисуются кадры, очередь меняется. */
export function markPending(
  bits: Uint32Array,
  buckets: ReadonlyArray<ReadonlyArray<number>>,
): void {
  bits.fill(0);
  for (const b of buckets) {
    for (let i = 0; i < b.length; i += 2) {
      const r = b[i];
      bits[r >>> 5] |= 1 << (r & 31);
    }
  }
}

/** Проверка тайлов [t0, t1). Инвариант потайловый — кусок верен сам по себе. */
export function scanRange(
  acc: ScanAcc,
  sim: Uint16Array,
  cpu: Uint16Array,
  bits: Uint32Array,
  me: number,
  mapW: number,
  t0: number,
  t1: number,
): void {
  const n = Math.min(t1, sim.length, cpu.length);
  let y = Math.floor(t0 / mapW);
  let x = t0 - y * mapW;
  for (let t = t0; t < n; t++) {
    const so = sim[t] & OWNER;
    const co = cpu[t] & OWNER;
    if (so === me) {
      acc.simMine++;
      if (x < acc.minX) acc.minX = x;
      if (x > acc.maxX) acc.maxX = x;
      if (y < acc.minY) acc.minY = y;
      if (y > acc.maxY) acc.maxY = y;
    }
    if (co === me) acc.rcMine++;
    if (so !== co) {
      if ((bits[t >>> 5] & (1 << (t & 31))) !== 0) {
        acc.inFlight++;
      } else {
        acc.lost++;
        if (so === me || co === me) acc.lostMine++;
        acc.owners.set(so, (acc.owners.get(so) ?? 0) + 1);
        if (acc.samples.length < 6) acc.samples.push([t, so, co]);
      }
    }
    if (++x === mapW) {
      x = 0;
      y++;
    }
  }
}

function finishAcc(acc: ScanAcc): TerritoryScan {
  return {
    lost: acc.lost,
    lostMine: acc.lostMine,
    inFlight: acc.inFlight,
    simMine: acc.simMine,
    rcMine: acc.rcMine,
    topOwners: [...acc.owners.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4),
    samples: acc.samples,
    bbox: acc.maxX >= 0 ? [acc.minX, acc.minY, acc.maxX, acc.maxY] : null,
  };
}

/** Для тестов: проход кусками обязан давать то же, что целиком. */
export { newAcc as newScanAcc, finishAcc as finishScan };

/** Вся карта одним проходом (тесты, ручная проверка из консоли). */
export function scanTerritory(
  sim: Uint16Array,
  cpu: Uint16Array,
  buckets: ReadonlyArray<ReadonlyArray<number>>,
  me: number,
  mapW: number,
  bits?: Uint32Array,
): TerritoryScan {
  const n = Math.min(sim.length, cpu.length);
  const b = bits ?? new Uint32Array((n + 31) >>> 5);
  markPending(b, buckets);
  const acc = newAcc();
  scanRange(acc, sim, cpu, b, me, mapW, 0, n);
  return finishAcc(acc);
}

/** Сколько тайлов окна в видеокарте расходится с копией рендера (owner-биты). */
export function compareReadback(
  tex: Uint16Array,
  cpu: Uint16Array,
  x0: number,
  y0: number,
  w: number,
  h: number,
  mapW: number,
): number {
  let mis = 0;
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * mapW + x0;
    const off = y * w;
    for (let x = 0; x < w; x++) {
      if ((tex[off + x] & OWNER) !== (cpu[row + x] & OWNER)) mis++;
    }
  }
  return mis;
}

/** Окно size×size вокруг тайла, прижатое к краям карты. */
export function windowAround(
  ref: number,
  mapW: number,
  mapH: number,
  size: number,
): [number, number, number, number] {
  const cx = ref % mapW;
  const cy = (ref - cx) / mapW;
  const w = Math.min(mapW, size);
  const h = Math.min(mapH, size);
  const x0 = Math.max(0, Math.min(mapW - w, cx - (w >> 1)));
  const y0 = Math.max(0, Math.min(mapH - h, cy - (h >> 1)));
  return [x0, y0, w, h];
}

/**
 * Держит meta в бюджете. Сервер режет длинную JSON-строку, битый JSON не
 * проходит в базу — и теряется вся строка события вместе с detail. Сбрасываем
 * наименее важное: localStorage скина, примеры, гистограмму, скин целиком.
 */
export function fitMeta(
  meta: Record<string, unknown>,
  budget = META_BUDGET,
): Record<string, unknown> {
  const m: Record<string, unknown> = { ...meta };
  const fits = () => JSON.stringify(m).length <= budget;
  if (fits()) return m;
  const skin = m.skin as Record<string, unknown> | undefined;
  if (skin && "ls" in skin) m.skin = { ...skin, ls: undefined };
  if (fits()) return m;
  delete m.smp;
  if (fits()) return m;
  delete m.top;
  if (fits()) return m;
  delete m.skin;
  return m;
}

interface IntegrityPlayer {
  smallID(): number;
  numTilesOwned(): number;
  cosmetics?: unknown;
}

export interface IntegritySources {
  gameID: string;
  mapW: number;
  sim(): Uint16Array;
  me(): IntegrityPlayer | null;
  tick(): number;
  snapshot(): RendererIntegritySnapshot | null;
  readback(x0: number, y0: number, w: number, h: number): Uint16Array | null;
  /** Сколько мс назад раннер рисовал кадр (−1 — ещё не рисовал). */
  frameAgeMs?(): number;
  /** Строка в дев-оверлее перфа (только дев). */
  hud?(text: string, bad: boolean): void;
}

/** Что про скин и паттерны знаем у своего игрока. */
function skinContext(me: IntegrityPlayer): Record<string, unknown> {
  let c: unknown = me.cosmetics;
  if (typeof c === "function") {
    try {
      c = (c as () => unknown).call(me);
    } catch {
      c = null;
    }
  }
  const cos = (c ?? {}) as {
    customSkin?: { mode?: unknown };
    pattern?: unknown;
  };
  const ls: Record<string, string> = {};
  try {
    for (const k of [
      "dev-skin",
      "dev-pattern",
      "settings.territoryPatterns",
      "settings.skinTrueColors",
    ]) {
      const v = localStorage.getItem(k);
      if (v !== null) ls[k] = v.slice(0, 40);
    }
  } catch {
    /* хранилище запрещено в кадре — контекст необязателен */
  }
  return {
    mode: cos.customSkin?.mode ?? null,
    pat: cos.pattern !== undefined && cos.pattern !== null,
    ls,
  };
}

interface Job {
  acc: ScanAcc;
  next: number;
  me: number;
  tick0: number;
  own0: number;
  totalMs: number;
  manual: boolean;
}

/** Состояние датчика на один матч. */
class Session {
  checks = 0;
  anomalies = 0;
  maxLost = 0;
  maxLostMine = 0;
  maxDOwn = 0;
  ownStreak = 0;
  fpStreak = 0;
  noFrames = 0;
  texChecks = 0;
  maxTex = 0;
  pChecks = 0;
  pMax = 0;
  pMaxMs = 0;
  pSlow = 0;
  lastPAt = 0;
  maxScanMs = 0;
  maxSliceMs = 0;
  inflMax = 0;
  qMax = 0;
  staleSent = 0;
  lastStaleAt = 0;
  samplesSent = 0;
  skips = { h: 0, v: 0, me: 0, snap: 0 };
  errs = 0;
  err1 = "";
  fires = 0;
  lastFireAt = 0;
  maxGapMs = 0;
  startTick = -1;
  lastTick = -1;
  lastCleanAt = 0;
  cleanTick = -1;
  lastDraws = -1;
  summarySent = false;
  readonly startedAt = performance.now();
  intervalMs: number;
  timer: ReturnType<typeof setTimeout> | null = null;
  job: Job | null = null;

  constructor(
    readonly src: IntegritySources,
    readonly token: number,
    readonly dev: boolean,
  ) {
    this.intervalMs = dev ? 10_000 : 30_000;
  }
}

export class TerritoryIntegrityProbe {
  private sessions = new Map<number, Session>();
  private active: Session | null = null;
  private nextToken = 0;
  private bits: Uint32Array | null = null;
  private listening = false;
  // Контекст страницы — общий для всех матчей вкладки.
  private hides = 0;
  private hiddenMs = 0;
  // ⚠️ «Скрыта ли» — отдельным флагом, а не нулём во времени: момент 0 —
  // законное значение performance.now() (поддельные часы тестов стартуют с него).
  private isHidden = false;
  private hiddenSince = 0;
  private lastHideMs = 0;
  private lastVisibleAt = -1;
  private connects = 0;
  private lastConnectAt = 0;
  private catchups = 0;
  private lastCatchupAt = 0;
  private cuActive = false;
  private cuDone = 0;
  private lastCuDoneAt = 0;
  private ingestErrs = 0;
  private lastIngestErrAt = 0;
  private ingestErr1 = "";
  private resyncs = 0;
  /** Повод для «чистого среза» на ближайшей проверке. */
  private pendingSample: "" | "vis" | "conn" | "cu" = "";
  /** Прод: прочитать видеокарту на первой проверке после возврата вкладки. */
  private postHideReadback = false;

  /** Запуск на матч. Возвращает жетон — им и останавливать. */
  start(src: IntegritySources): number {
    const host = typeof location !== "undefined" ? location.hostname : "";
    const dev = isDevSite() || host === "localhost" || host === "127.0.0.1";
    const token = ++this.nextToken;
    const s = new Session(src, token, dev);
    // Второй матч поверх живого (перебитый вход домонтировался позже) — живой
    // просто ставим на паузу: остановят брошенного, живой продолжит.
    if (this.active) this.pause(this.active);
    this.sessions.set(token, s);
    this.active = s;
    this.isHidden = document.hidden;
    this.hiddenSince = document.hidden ? performance.now() : 0;
    this.listen(true);
    this.schedule(s);
    if (dev) {
      (window as unknown as Record<string, unknown>).__terronMapCheck = () =>
        this.check(true);
    }
    return token;
  }

  /** Остановка. С жетоном — только свой матч (чужой датчик не трогаем). */
  stop(token?: number): void {
    const s =
      token === undefined ? this.active : (this.sessions.get(token) ?? null);
    if (!s) return;
    this.pause(s);
    this.reportSummary(s, false);
    this.sessions.delete(s.token);
    if (this.active === s) {
      const rest = [...this.sessions.values()];
      this.active = rest.length > 0 ? rest[rest.length - 1] : null;
      if (this.active) this.schedule(this.active);
    }
    if (this.sessions.size === 0) {
      this.listen(false);
      delete (window as unknown as Record<string, unknown>).__terronMapCheck;
    }
  }

  noteConnect(): void {
    this.connects++;
    this.lastConnectAt = performance.now();
    // Первое подключение матча — не событие; интересен именно ВОЗВРАТ.
    if (this.active && this.active.checks > 0) this.pendingSample = "conn";
  }

  noteCatchup(): void {
    this.catchups++;
    this.lastCatchupAt = performance.now();
  }

  /** Очередь воркера каждый ход: ≥100 — идёт догон, ≤2 — догнали. */
  noteBacklog(n: number): void {
    if (!this.cuActive && n >= 100) {
      this.cuActive = true;
    } else if (this.cuActive && n <= 2) {
      this.cuActive = false;
      this.cuDone++;
      this.lastCuDoneAt = performance.now();
      this.pendingSample = "cu";
    }
  }

  noteIngestError(msg: string): void {
    this.ingestErrs++;
    this.lastIngestErrAt = performance.now();
    if (this.ingestErr1 === "") this.ingestErr1 = msg.slice(0, 60);
  }

  noteTileResync(): void {
    this.resyncs++;
  }

  /**
   * Одна проверка целиком, синхронно. В игре проверки идут по таймеру
   * кусками; этот путь — для тестов и ручной проверки из консоли на деве
   * (`__terronMapCheck()`, manual=true — отчёт уходит всегда).
   */
  check(manual = false): TerritoryScan | null {
    const s = this.active;
    if (!s) return null;
    if (!this.beginJob(s, manual)) return null;
    return this.runJob(s, Infinity);
  }

  private pause(s: Session): void {
    if (s.timer !== null) clearTimeout(s.timer);
    s.timer = null;
    s.job = null;
  }

  private listen(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    if (on) {
      document.addEventListener("visibilitychange", this.onVisibility);
      window.addEventListener("pagehide", this.onPageHide);
    } else {
      document.removeEventListener("visibilitychange", this.onVisibility);
      window.removeEventListener("pagehide", this.onPageHide);
    }
  }

  private onVisibility = (): void => {
    const now = performance.now();
    if (document.hidden) {
      if (!this.isHidden) {
        this.isHidden = true;
        this.hiddenSince = now;
        this.hides++;
      }
      // Недоделанный проход бросаем: в фоне кадров нет, кусок будет врать.
      if (this.active) this.active.job = null;
    } else if (this.isHidden) {
      this.isHidden = false;
      this.lastHideMs = now - this.hiddenSince;
      this.hiddenMs += this.lastHideMs;
      this.lastVisibleAt = now;
      this.pendingSample = "vis";
      this.postHideReadback = true;
    }
  };

  /** Закрытие вкладки: сводку матча досылаем beacon'ом (иначе теряется ровно
   *  то, что важнее всего, — матч, из которого ушли, увидев баг). */
  private onPageHide = (): void => {
    if (this.active) this.reportSummary(this.active, true);
  };

  private schedule(s: Session): void {
    if (s.timer !== null) clearTimeout(s.timer);
    s.timer = setTimeout(() => this.onTimer(s), s.intervalMs);
  }

  private onTimer(s: Session): void {
    s.timer = null;
    if (this.active !== s) return;
    const now = performance.now();
    s.fires++;
    if (s.lastFireAt > 0) s.maxGapMs = Math.max(s.maxGapMs, now - s.lastFireAt);
    s.lastFireAt = now;
    try {
      if (this.beginJob(s, false)) {
        this.continueJob(s);
        return;
      }
    } catch (e) {
      this.noteErr(s, e);
    }
    this.schedule(s);
  }

  private continueJob(s: Session): void {
    try {
      if (this.active !== s || !s.job) return this.schedule(s);
      if (document.hidden) {
        s.skips.h++;
        s.job = null;
        return this.schedule(s);
      }
      if (this.runJob(s, SLICE_BUDGET_MS) === null && s.job) {
        s.timer = setTimeout(() => this.continueJob(s), 0);
        return;
      }
    } catch (e) {
      s.job = null;
      this.noteErr(s, e);
    }
    this.schedule(s);
  }

  private noteErr(s: Session, e: unknown): void {
    s.errs++;
    if (s.err1 === "") s.err1 = String((e as Error)?.message ?? e).slice(0, 60);
  }

  private beginJob(s: Session, manual: boolean): boolean {
    const src = s.src;
    if (document.hidden) {
      s.skips.h++;
      return false;
    }
    const now = performance.now();
    // Сразу после возврата рендер сливает ВСЮ очередь на ближайшем кадре —
    // сам момент возврата не меряем.
    if (
      !manual &&
      this.lastVisibleAt >= 0 &&
      now - this.lastVisibleAt < AFTER_VISIBLE_MS
    ) {
      s.skips.v++;
      return false;
    }
    const me = src.me();
    if (!me) {
      s.skips.me++;
      return false;
    }
    const tick = src.tick();
    if (s.startTick < 0) s.startTick = tick;
    s.job = {
      acc: newAcc(),
      next: 0,
      me: me.smallID(),
      tick0: tick,
      own0: me.numTilesOwned(),
      totalMs: 0,
      manual,
    };
    return true;
  }

  /** Кусок прохода не дольше budgetMs. Готово — итог проверки, иначе null. */
  private runJob(s: Session, budgetMs: number): TerritoryScan | null {
    const job = s.job;
    if (!job) return null;
    const src = s.src;
    const snap = src.snapshot();
    if (!snap) {
      s.skips.snap++;
      s.job = null;
      return null;
    }
    const sim = src.sim();
    const cpu = snap.cpu;
    const n = Math.min(sim.length, cpu.length);
    const words = (n + 31) >>> 5;
    if (!this.bits || this.bits.length < words) {
      this.bits = new Uint32Array(words);
    }
    const t0 = performance.now();
    markPending(this.bits, snap.buckets);
    while (job.next < n) {
      const end = Math.min(n, job.next + SLICE_TILES);
      scanRange(job.acc, sim, cpu, this.bits, job.me, src.mapW, job.next, end);
      job.next = end;
      if (performance.now() - t0 >= budgetMs) break;
    }
    const dt = performance.now() - t0;
    job.totalMs += dt;
    if (dt > s.maxSliceMs) s.maxSliceMs = dt;
    if (job.next < n) return null;
    s.job = null;
    const scan = finishAcc(job.acc);
    this.finishCheck(s, job, scan, snap, cpu);
    return scan;
  }

  private finishCheck(
    s: Session,
    job: Job,
    scan: TerritoryScan,
    snap: RendererIntegritySnapshot,
    cpu: Uint16Array,
  ): void {
    const src = s.src;
    const me = src.me();
    const now = performance.now();
    const tick1 = src.tick();
    const own1 = me ? me.numTilesOwned() : job.own0;
    s.checks++;
    s.lastTick = tick1;
    if (job.totalMs > s.maxScanMs) s.maxScanMs = job.totalMs;
    if (!s.dev) {
      // Прод: проход тяжёлый для этого устройства — реже. Куски и так
      // короткие, это про суммарное время, а не про заминки.
      s.intervalMs = job.totalMs > 80 ? 120_000 : job.totalMs > 30 ? 60_000 : 30_000;
    }

    // own: зеркало ≠ счётчику игрока. Счётчик приходит целиком каждый ход,
    // зеркало — дельтами; расходятся — ходы потеряны ДО зеркала. Проход мог
    // занять несколько задач, поэтому сравниваем с диапазоном начала/конца.
    const exact = job.tick0 === tick1;
    const tol = exact ? 2 : Math.max(8, Math.round(0.005 * Math.max(job.own0, own1)));
    const ownBad =
      scan.simMine < Math.min(job.own0, own1) - tol ||
      scan.simMine > Math.max(job.own0, own1) + tol;
    const dOwn = scan.simMine - own1;
    s.ownStreak = ownBad ? s.ownStreak + 1 : 0;
    if (Math.abs(dOwn) > Math.abs(s.maxDOwn)) s.maxDOwn = dOwn;

    // noframe: вкладка видна, а кадров нет. Счётчик кадров стоит с прошлой
    // проверки — цикл мёртв (живой рисует минимум раз в 250 мс).
    const frameAge = src.frameAgeMs?.() ?? -1;
    const noFrame =
      snap.visibilityFlushPending ||
      snap.drawAgeMs > NOFRAME_MS ||
      frameAge > NOFRAME_MS ||
      (s.lastDraws >= 0 && snap.draws === s.lastDraws);
    s.lastDraws = snap.draws;
    if (noFrame) s.noFrames++;
    s.fpStreak = snap.fullPending ? s.fpStreak + 1 : 0;
    if (scan.inFlight > s.inflMax) s.inflMax = scan.inFlight;
    if (snap.queued > s.qMax) s.qMax = snap.queued;
    if (scan.lost > s.maxLost) s.maxLost = scan.lost;
    if (scan.lostMine > s.maxLostMine) s.maxLostMine = scan.lostMine;

    const rb = this.readbackStep(s, snap, cpu, scan, job.manual);

    const r =
      scan.lost > 0
        ? "lost"
        : s.ownStreak >= 2
          ? "own"
          : rb.tex > 0
            ? "tex"
            : noFrame
              ? "noframe"
              : s.fpStreak >= 2
                ? "fp"
                : "";
    const sample = this.pendingSample;
    this.pendingSample = "";

    const meta = (): Record<string, unknown> => ({
      gameID: src.gameID,
      tick: tick1,
      sid: job.me,
      r: r || undefined,
      sim: scan.simMine,
      rc: scan.rcMine,
      own: own1,
      dOwn,
      lost: scan.lost,
      lostMine: scan.lostMine,
      inFlight: scan.inFlight,
      top: scan.topOwners,
      smp: scan.samples,
      bbox: scan.bbox,
      mw: src.mapW,
      tex: rb.tex,
      texBox: rb.box,
      texMs: rb.ms,
      q: snap.queued,
      fp: snap.fullPending ? 1 : 0,
      td: snap.tilesDirty ? 1 : 0,
      sc: snap.scatterPending,
      cap: snap.capHits,
      fu: snap.fullUploads,
      msc: snap.maxScatter,
      lf: snap.lastFlushKind
        ? `${snap.lastFlushKind}${snap.lastFlushN}@${Math.round((now - snap.lastFlushAt) / 1000)}s`
        : "",
      vf: snap.visibilityFlushPending ? 1 : 0,
      da: snap.drawAgeMs,
      dr: snap.draws,
      fa: Math.round(frameAge),
      fps: snap.fps,
      rf: snap.flags,
      ms: Math.round(job.totalMs * 10) / 10,
      sl: Math.round(s.maxSliceMs * 10) / 10,
      ...this.context(s),
    });

    if (r === "") {
      s.lastCleanAt = now;
      s.cleanTick = tick1;
      if (job.manual || (sample !== "" && s.samplesSent < (s.dev ? 3 : 1))) {
        if (!job.manual) s.samplesSent++;
        reportHealth(
          "map_check",
          `срез «${job.manual ? "manual" : sample}»: чисто | потерь 0, в пути ${scan.inFlight}` +
            (rb.tex >= 0 ? ` | текстура = копии (${rb.box?.[2]}×${rb.box?.[3]})` : ""),
          fitMeta({ ...meta(), s: job.manual ? "manual" : sample }),
        );
      }
      src.hud?.(`карта ✓  проверок ${s.checks}`, false);
      if (job.manual) console.info("[map-check] чисто", scan, rb);
      return;
    }

    s.anomalies++;
    const text =
      `${r}: свои зеркало ${scan.simMine} / копия ${scan.rcMine} / у игрока ${own1} | ` +
      `потеряно ${scan.lost} (своих ${scan.lostMine}), в пути ${scan.inFlight}` +
      (rb.tex >= 0 ? ` | текстура ≠ копии: ${rb.tex}` : "") +
      ` | кадр ${snap.drawAgeMs}мс назад` +
      ` | скрытий ${this.hides}, реконнектов ${this.connects}, догонов ${this.cuDone}`;
    src.hud?.(`карта ✗ ${r}: потеряно ${scan.lost} · свои ${dOwn > 0 ? "+" : ""}${dOwn} · текстура ${rb.tex}`, true);
    if (job.manual) console.warn("[map-check]", text, scan, rb);
    if (s.staleSent >= MAX_STALE && !job.manual) return;
    if (!job.manual && s.staleSent > 0 && now - s.lastStaleAt < REPORT_GAP_MS) return;
    if (!job.manual) s.staleSent++;
    s.lastStaleAt = now;
    reportHealth(
      "map_stale",
      text,
      fitMeta({ ...meta(), skin: me ? skinContext(me) : null }),
    );
  }

  /**
   * Чтение текстуры из видеокарты. Окно целим в ПОСЛЕДНИЙ залитый тайл: если
   * запись в текстуру не долетает, свежий тайл разойдётся с копией первым.
   * readPixels синхронный (ждёт видеокарту), поэтому на проде — редко и мало.
   */
  private readbackStep(
    s: Session,
    snap: RendererIntegritySnapshot,
    cpu: Uint16Array,
    scan: TerritoryScan,
    manual: boolean,
  ): { tex: number; box: number[] | null; ms: number } {
    const none = { tex: -1, box: null, ms: 0 };
    // Копия ещё не целиком в текстуре — расхождение законное, не читаем.
    if (snap.fullPending || snap.tilesDirty || snap.scatterPending > 0) {
      return none;
    }
    const src = s.src;
    const mapH = Math.floor(cpu.length / src.mapW);
    const now = performance.now();
    const wins: Array<[number, number, number, number]> = [];
    const ref = snap.lastFlushedRef;
    if (s.dev || manual) {
      if (ref >= 0) wins.push(windowAround(ref, src.mapW, mapH, 96));
      if (scan.bbox && (manual || s.checks % 3 === 0)) {
        const [bx0, by0, bx1, by1] = scan.bbox;
        const c = ((by0 + by1) >> 1) * src.mapW + ((bx0 + bx1) >> 1);
        wins.push(windowAround(c, src.mapW, mapH, 256));
      }
    } else {
      const due =
        this.postHideReadback || (s.lastPAt > 0 && now - s.lastPAt > PROD_READBACK_GAP_MS);
      if (!due || ref < 0 || s.pChecks >= PROD_READBACK_MAX || s.pSlow >= 2) {
        return none;
      }
      wins.push(windowAround(ref, src.mapW, mapH, 32));
    }
    if (wins.length === 0) return none;
    this.postHideReadback = false;
    let tex = 0;
    const t0 = performance.now();
    for (const [x0, y0, w, h] of wins) {
      const rb = src.readback(x0, y0, w, h);
      if (!rb) return none;
      tex += compareReadback(rb, cpu, x0, y0, w, h, src.mapW);
    }
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    if (s.dev || manual) {
      s.texChecks++;
      if (tex > s.maxTex) s.maxTex = tex;
    } else {
      s.pChecks++;
      s.lastPAt = now;
      if (tex > s.pMax) s.pMax = tex;
      if (ms > s.pMaxMs) s.pMaxMs = ms;
      if (ms > PROD_READBACK_SLOW_MS) s.pSlow++;
    }
    return { tex, box: wins[0], ms };
  }

  private context(s: Session): Record<string, unknown> {
    const now = performance.now();
    const age = (at: number) => (at > 0 ? Math.round((now - at) / 1000) : null);
    const hidden =
      this.hiddenMs + (this.isHidden ? now - this.hiddenSince : 0);
    return {
      hides: this.hides,
      hiddenS: Math.round(hidden / 1000),
      lastHideS: Math.round(this.lastHideMs / 1000),
      sinceVisS:
        this.lastVisibleAt >= 0
          ? Math.round((now - this.lastVisibleAt) / 1000)
          : null,
      conn: this.connects,
      connS: age(this.lastConnectAt),
      cu: this.catchups,
      cuS: age(this.lastCatchupAt),
      cuDone: this.cuDone,
      cuDoneS: age(this.lastCuDoneAt),
      ie: this.ingestErrs,
      ieS: age(this.lastIngestErrAt),
      ie1: this.ingestErr1 || undefined,
      rs: this.resyncs,
      cleanS: age(s.lastCleanAt),
      cleanTick: s.cleanTick,
      b: typeof __BUILD_TIME__ === "number" ? __BUILD_TIME__ : null,
    };
  }

  /** Итог за матч — знаменатель: сколько проверок шло, сколько грязных. */
  private reportSummary(s: Session, beacon: boolean): void {
    if (s.summarySent) return;
    if (s.checks === 0 && performance.now() - s.startedAt < SUMMARY_MIN_MS) {
      return;
    }
    s.summarySent = true;
    const send = beacon ? reportHealthBeacon : reportHealth;
    send(
      "map_check",
      `проверок ${s.checks}, аномалий ${s.anomalies}, ` +
        `макс потеряно ${s.maxLost} (своих ${s.maxLostMine}), свои±${s.maxDOwn}` +
        (s.texChecks > 0 ? `, текстура макс ${s.maxTex}` : "") +
        (s.pChecks > 0 ? `, видеокарта ${s.pChecks}×, макс ${s.pMax}` : "") +
        (s.noFrames > 0 ? `, без кадров ${s.noFrames}` : ""),
      fitMeta({
        gameID: s.src.gameID,
        c: s.checks,
        a: s.anomalies,
        l: s.maxLost,
        lm: s.maxLostMine,
        dOwn: s.maxDOwn,
        tc: s.texChecks,
        tx: s.maxTex,
        ptc: s.pChecks,
        ptx: s.pMax,
        pms: s.pMaxMs,
        nf: s.noFrames,
        infl: s.inflMax,
        qMax: s.qMax,
        ms: Math.round(s.maxScanMs * 10) / 10,
        sl: Math.round(s.maxSliceMs * 10) / 10,
        iv: s.intervalMs,
        dev: s.dev,
        sk: s.skips,
        errs: s.errs,
        err1: s.err1 || undefined,
        fires: s.fires,
        gapS: Math.round(s.maxGapMs / 1000),
        t0: s.startTick,
        t1: s.lastTick,
        ...this.context(s),
      }),
    );
  }
}

export const territoryIntegrity = new TerritoryIntegrityProbe();

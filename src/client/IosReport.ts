// terron: телеметрия сбоев клиента (в основном iOS/память). Ловим ДВА класса:
//  1) js_crash — исключение в симуляции (worker ErrorUpdate) → есть errMsg/stack;
//  2) abnormal_exit — страница перезагрузилась ПОСРЕДИ игры (нет исключения) =
//     вероятный memory-kill WKWebView. Детект: пишем «watch» в localStorage на
//     старте, периодически обновляем последним снапшотом (память/tick/время),
//     чистим на ЧИСТОМ выходе. На следующем бусте — если watch остался = аномалия.
// Отчёты уходят на /ios/report (best-effort). Смотреть на /admin/ios. См. iosReports.ts.
import { getApiBase } from "./Api";

const WATCH_KEY = "terron_crash_watch";

function platform(): string {
  try {
    const cap = (
      window as unknown as { Capacitor?: { getPlatform?: () => string } }
    ).Capacitor;
    return cap?.getPlatform?.() ?? "web";
  } catch {
    return "web";
  }
}

// Максимум дебага об устройстве/памяти в момент события.
export function collectDebug(): Record<string, unknown> {
  const nav = navigator as unknown as {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };
  const perf = performance as unknown as {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
      jsHeapSizeLimit?: number;
    };
  };
  const mem = perf.memory;
  const mb = (b?: number) =>
    typeof b === "number" ? Math.round(b / 1048576) : undefined;
  return {
    platform: platform(),
    ua: navigator.userAgent?.slice(0, 256),
    online: navigator.onLine,
    origin: location.hostname,
    deviceMemoryGB: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
    // JS-heap в МБ (в WebKit доступно не всегда — тогда undefined).
    heapUsedMB: mb(mem?.usedJSHeapSize),
    heapTotalMB: mb(mem?.totalJSHeapSize),
    heapLimitMB: mb(mem?.jsHeapSizeLimit),
    screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`,
    ts: Date.now(),
  };
}

// Отправить отчёт (fire-and-forget; keepalive — чтобы дошло даже при уходе страницы).
export function reportIos(
  kind: string,
  data: {
    errMsg?: string;
    stack?: string;
    gameId?: string;
    meta?: Record<string, unknown>;
  } = {},
): void {
  try {
    const body = JSON.stringify({
      kind,
      errMsg: data.errMsg,
      stack: data.stack,
      gameId: data.gameId,
      platform: platform(),
      meta: { ...collectDebug(), ...(data.meta ?? {}) },
    });
    void fetch(getApiBase() + "/ios/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* телеметрия не должна ничего ронять */
  }
}

// ── watch (детект memory-kill) ────────────────────────────────────────────────
let watchTimer = 0;
// terron ПЕРФ (память, 12.07): КОЛЬЦО heap-снапшотов раз в минуту (до 10 точек
// ≈ последние 10 минут матча). В abnormal_exit уезжает вся история — видно,
// РОС ли heap к моменту kill'а (утечка в матче) или это был внешний спайк.
// Формат точки: [минута_от_старта, heapUsedMB] — компактно для localStorage.
let memRing: Array<[number, number]> = [];
let memRingTimer = 0;

// terron ПЕРФ: старт активного матча — для зачёта «чистых» матчей gfx_low (ниже).
let gameStartedAt = 0;

export function markGameActive(
  gameId: string,
  extra?: Record<string, unknown>,
): void {
  const startedAt = Date.now();
  gameStartedAt = startedAt;
  memRing = [];
  const sampleHeap = () => {
    const d = collectDebug() as { heapUsedMB?: number };
    if (typeof d.heapUsedMB === "number") {
      memRing.push([
        Math.round((Date.now() - startedAt) / 60_000),
        d.heapUsedMB,
      ]);
      if (memRing.length > 10) memRing.shift();
    }
  };
  const snap = () => {
    try {
      localStorage.setItem(
        WATCH_KEY,
        JSON.stringify({
          gameId,
          startedAt,
          ...extra,
          last: collectDebug(),
          memRing,
        }),
      );
    } catch {
      /* ignore */
    }
  };
  sampleHeap();
  snap();
  // Периодически обновляем последний снапшот памяти/времени — чтобы при
  // аномальном выходе видеть, СКОЛЬКО памяти было перед kill'ом и как долго шла игра.
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = window.setInterval(snap, 15_000);
  if (memRingTimer) clearInterval(memRingTimer);
  memRingTimer = window.setInterval(sampleHeap, 60_000);
}

export function clearGameActive(): void {
  try {
    if (watchTimer) {
      clearInterval(watchTimer);
      watchTimer = 0;
    }
    if (memRingTimer) {
      clearInterval(memRingTimer);
      memRingTimer = 0;
    }
    memRing = [];
    localStorage.removeItem(WATCH_KEY);
    // terron ПЕРФ: РЕАБИЛИТАЦИЯ после context-loss. Флаг terron_gfx_low
    // (пониженный DPR) раньше был ВЕЧНЫМ — разовый сбой навсегда мылил
    // картинку. Теперь: 2 чистых матча подряд (без краша, длиннее 2 мин) →
    // флаг снимается. Новый context-loss сбрасывает счётчик (gl/GameView).
    if (gameStartedAt && Date.now() - gameStartedAt > 2 * 60_000) {
      if (localStorage.getItem("terron_gfx_low") === "1") {
        const ok =
          (parseInt(localStorage.getItem("terron_gfx_low_ok") ?? "0", 10) ||
            0) + 1;
        if (ok >= 2) {
          localStorage.removeItem("terron_gfx_low");
          localStorage.removeItem("terron_gfx_low_ok");
        } else {
          localStorage.setItem("terron_gfx_low_ok", String(ok));
        }
      }
    }
    gameStartedAt = 0;
  } catch {
    /* ignore */
  }
}

// На бусте: если watch остался (не почищен чистым выходом) и он свежий —
// значит игра оборвалась перезагрузкой = аномальный выход (вероятно memory-kill).
export function checkAbnormalExit(): void {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    if (!raw) return;
    localStorage.removeItem(WATCH_KEY);
    const w = JSON.parse(raw) as {
      gameId?: string;
      startedAt?: number;
      last?: Record<string, unknown>;
      memRing?: Array<[number, number]>;
    };
    // Слишком старый watch (>1ч) — не считаем (мог остаться от давнего сбоя без буста).
    if (!w.startedAt || Date.now() - w.startedAt > 3_600_000) return;
    reportIos("abnormal_exit", {
      gameId: w.gameId,
      meta: {
        elapsedMs: Date.now() - w.startedAt,
        lastSnapshot: w.last ?? null,
        // История heap по минутам: [[мин, МБ], …] — растёт → утечка в матче.
        memRing: w.memRing ?? null,
      },
    });
  } catch {
    /* ignore */
  }
}

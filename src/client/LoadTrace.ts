// terron: ТРАССИРОВКА ХОЛОДНОГО СТАРТА (запрос владельца 18.07: «трекер когда
// началась загрузка у юзеров — прям смотреть, что сколько грузилось»).
//
// Метки стадий (traceMark) расставлены по пути входа в матч (ClientGameRunner):
// join → lobby_info → prestart → start_msg → map_ready → worker_ready → first_tick.
// На первом тике собираем отчёт: длительности стадий + Resource Timing по
// ключевым ассетам (бандл / бины карты / воркер / язык) с байтами и признаком
// «из кеша» (transferSize=0). Флаг cold = первый заход браузера (localStorage).
//
// Отчёт = ОДИН health-эвент kind="load_trace" на загрузку страницы:
// detail — компактная строка для глаз в /stats/health, meta — полный JSON.
// Смотреть: curl -H "x-api-key: $GAME_API_KEY" api.terron.io/stats/health?days=1

const marks: Record<string, number> = {};
let reported = false;

// Дефолтный буфер Resource Timing = 250 записей — сотни флагов/спрайтов
// вытесняют бины карты до первого тика (в первых прод-отчётах map = 0KB у
// всех). Расширяем при загрузке модуля (бандл грузится раньше ассетов).
try {
  performance.setResourceTimingBufferSize(800);
} catch {
  /* старый браузер — отчёт уйдёт без части ресурсов */
}

/** Отметить стадию (первое срабатывание побеждает; мс от старта страницы). */
export function traceMark(stage: string): void {
  if (!(stage in marks)) marks[stage] = Math.round(performance.now());
}

// Порядок стадий пайплайна входа в матч (traceMark-ки из ClientGameRunner).
const STAGE_ORDER = [
  "join",
  "lobby_info",
  "prestart",
  "start_msg",
  "map_ready",
  "worker_ready",
  "renderer_ready",
  "first_tick",
] as const;

// terron 24.07: снимок ТЕКУЩЕЙ стадии загрузки — для датчиков выхода/обрыва
// (Health.ts обогащает exit_during_loading/conn_dropped_loading тем, ГДЕ игрок
// встал и сколько ждал). Стадия = последняя достигнутая метка пайплайна;
// "pre_join" = ещё даже не начали джойн (сидит на главной/в лобби).
export function loadStageSnapshot(): {
  stage: string;
  sincePageMs: number;
  sinceJoinMs?: number;
} {
  let stage = "pre_join";
  for (const s of STAGE_ORDER) if (s in marks) stage = s;
  const now = Math.round(performance.now());
  return {
    stage,
    sincePageMs: now,
    sinceJoinMs: marks["join"] !== undefined ? now - marks["join"] : undefined,
  };
}

// terron 20.07: разбивка инициализации ВНУТРИ воркера (map/nations/world/
// executions, мс). Именно она объясняет главный кусок экрана загрузки —
// ожидание первого тика (см. detail-строку ниже и meta.workerInit).
const workerInit: Record<string, number> = {};

export function traceWorkerInit(timings: Record<string, number>): void {
  Object.assign(workerInit, timings);
}

interface ResourceRow {
  n: string; // короткое имя
  ms: number; // duration
  kb: number; // transferSize (0 = из кеша)
  cached: boolean;
}

function keyResources(): ResourceRow[] {
  const out: ResourceRow[] = [];
  try {
    const entries = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];
    for (const e of entries) {
      const url = e.name;
      let n: string | null = null;
      if (/\/assets\/index-[^/]+\.js/.test(url)) n = "bundle";
      else if (url.includes("map.bin")) n = "map.bin";
      else if (url.includes("map4x.bin")) n = "map4x";
      else if (url.includes("map16x.bin")) n = "map16x";
      else if (url.includes("manifest.json")) n = "manifest";
      else if (/lang\/[a-z-]+\.json/.test(url)) n = "lang";
      else if (/[Ww]orker/.test(url) && url.endsWith(".js")) n = "worker";
      if (n === null) continue;
      out.push({
        n,
        ms: Math.round(e.duration),
        kb: Math.round(e.transferSize / 1024),
        cached: e.transferSize === 0 && e.decodedBodySize > 0,
      });
    }
  } catch {
    /* Resource Timing недоступен — отчёт уйдёт без ресурсов */
  }
  // Самые тяжёлые первыми, кап 12 строк (у карты может быть по 2-3 попытки).
  out.sort((a, b) => b.ms - a.ms);
  return out.slice(0, 12);
}

const sec = (ms: number | undefined): string =>
  ms === undefined ? "?" : `${(ms / 1000).toFixed(1)}s`;

/** Отправить отчёт (один раз на загрузку страницы). Зовётся на первом тике. */
export function traceLoadReport(gameID: string | undefined): void {
  if (reported) return;
  reported = true;
  traceMark("first_tick");

  let cold = false;
  try {
    cold = localStorage.getItem("terron-load-seen") === null;
    localStorage.setItem("terron-load-seen", "1");
  } catch {
    /* приватный режим — считаем тёплым */
  }

  const res = keyResources();
  const bundle = res.find((r) => r.n === "bundle");
  const mapMs = res
    .filter((r) => r.n.startsWith("map") || r.n === "manifest")
    .reduce((a, r) => Math.max(a, r.ms), 0);
  const mapKb = res
    .filter((r) => r.n.startsWith("map"))
    .reduce((a, r) => a + r.kb, 0);

  const gap = (a: string, b: string): number | undefined =>
    marks[a] !== undefined && marks[b] !== undefined
      ? marks[b] - marks[a]
      : undefined;

  const join = marks["join"];
  const total =
    join !== undefined && marks["first_tick"] !== undefined
      ? marks["first_tick"] - join
      : undefined;

  // Разбивка воркера — сразу в detail-строку: её читают глазами в /stats/health.
  const wi = Object.entries(workerInit)
    .map(([n, ms]) => `${n} ${(ms / 1000).toFixed(2)}s`)
    .join(" ");

  const detail =
    `${cold ? "COLD" : "warm"} join→tick ${sec(total)}` +
    ` | page→tick ${sec(marks["first_tick"])}` +
    // Ключевое разделение: сборка графики против ожидания первого хода.
    ` | gfx ${sec(gap("worker_ready", "renderer_ready"))}` +
    ` | wait-turn ${sec(gap("renderer_ready", "first_tick"))}` +
    ` | map ${sec(mapMs)}/${mapKb}KB` +
    (bundle ? ` | bundle ${sec(bundle.ms)}/${bundle.kb}KB` : "") +
    (wi ? ` | worker: ${wi}` : "");

  void import("./Health").then(({ reportHealth }) =>
    reportHealth("load_trace", detail, {
      gameID,
      cold,
      marks,
      workerInit,
      resources: res,
      dpr: window.devicePixelRatio,
      conn: (
        navigator as unknown as { connection?: { effectiveType?: string } }
      ).connection?.effectiveType,
    }),
  );
}

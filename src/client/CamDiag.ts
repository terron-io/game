// terron 20.07: датчик заморозки главного потока на старте матча.
//
// История: игрок жаловался, что до начала матча карта видна, но её нельзя ни
// зумить, ни таскать — «сначала успеваю покрутить, потом всё вешается».
// Ввод оказался ни при чём: замер показал ОДНУ задачу главного потока на
// 2.4–3.8с, и всё это время браузер физически не обрабатывал события.
// Виновником был подбор отличимых цветов игроков (см. ColorAllocator) —
// квадратичный по числу игроков; на 400 ботах он и съедал эти секунды.
//
// Датчик оставлен как СТРАЖ регрессии: если старт снова начнёт подвисать,
// это видно одной строкой в консоли, без подключения профайлера. Стоит он
// почти ничего — PerformanceObserver, живущий только до первого хода.

/**
 * Диагностика включена на ДЕВЕ всегда и на любом домене по `?debug=perf`.
 * Второе нужно, чтобы можно было послать игрока с жалобой на перф по ссылке и
 * попросить прислать строку из консоли. Флаг живёт в sessionStorage, потому что
 * при входе в матч адрес меняется на /game/<id> и query-параметр теряется.
 * На проде без параметра — код не выполняется совсем.
 */
const PERF_FLAG_KEY = "terron_perf_debug";

// ВАЖНО: параметр ловим ПРИ ЗАГРУЗКЕ МОДУЛЯ, а не при старте матча. К моменту
// старта адрес уже `/game/<id>` — query потерян, и проверка бы никогда не
// срабатывала (поймано на проде при проверке выката 20.07). Поэтому читаем
// сейчас и кладём в sessionStorage, чтобы флаг пережил переход в матч.
(function capturePerfFlag() {
  try {
    if (typeof location === "undefined") return;
    const p = new URLSearchParams(location.search).get("debug");
    if (p === "perf") sessionStorage.setItem(PERF_FLAG_KEY, "1");
    else if (p === "off") sessionStorage.removeItem(PERF_FLAG_KEY);
  } catch {
    /* нет location/sessionStorage — не наш случай */
  }
})();

export function perfDiagEnabled(): boolean {
  try {
    if (typeof location === "undefined") return false;
    const host = location.hostname;
    if (
      host.startsWith("dev.") ||
      host === "localhost" ||
      host === "127.0.0.1"
    ) {
      return true;
    }
    return sessionStorage.getItem(PERF_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export const camDiag = {
  /** Выставляется один раз при старте матча; при false всё ниже — no-op. */
  enabled: false,

  /** Длительности шагов старта, мс. Пусто, когда диагностика выключена. */
  steps: {} as Record<string, number>,

  /** Засечь шаг старта. Когда выключено — просто вызывает fn. */
  step<T>(name: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.steps[name] = (this.steps[name] ?? 0) + (performance.now() - t0);
    }
  },

  stepsSummary(): string {
    const parts = Object.entries(this.steps)
      .sort((a, b) => b[1] - a[1])
      .filter(([, v]) => v >= 1)
      .map(([k, v]) => `${k}=${Math.round(v)}мс`);
    return parts.length > 0 ? parts.join(" ") : "нет данных";
  },

  /** Задачи главного потока длиннее 100мс за время ожидания старта. */
  longTasks: 0,
  /** Суммарно мс, которые главный поток был ими занят. */
  blockedMs: 0,
  /** Самая длинная задача, мс. */
  worstTaskMs: 0,

  reset() {
    this.longTasks = 0;
    this.blockedMs = 0;
    this.worstTaskMs = 0;
    this.steps = {};
  },

  summary(): string {
    return (
      `задач >100мс=${this.longTasks} суммарно занято=${Math.round(this.blockedMs)}мс` +
      ` худшая=${Math.round(this.worstTaskMs)}мс`
    );
  },

  /** Считать длинные задачи, пока идёт ожидание старта. Возвращает «стоп». */
  watchLongTasks(): () => void {
    if (typeof PerformanceObserver === "undefined") return () => {};
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration < 100) continue;
          this.longTasks++;
          this.blockedMs += e.duration;
          if (e.duration > this.worstTaskMs) this.worstTaskMs = e.duration;
        }
      });
      obs.observe({ entryTypes: ["longtask"] });
      return () => obs.disconnect();
    } catch {
      return () => {};
    }
  },
};

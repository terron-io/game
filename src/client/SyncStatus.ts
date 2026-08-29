import { L } from "./Utils";

// terron: баннер статуса связи/синхронизации в игре (верх-центр). Показывает:
//  • «Сервер перезапускается…» (server_restart от сервера при SIGTERM);
//  • «Переподключение…» (WS упал, реконнект);
//  • «Синхронизация — осталось N ходов» + прогресс (догон бэклога после реконнекта
//    ИЛИ при заходе спектатором в идущий матч);
//  • скрыт, когда всё в реальном времени (live).
// Событийный: слушает `terron-sync-status {state, remaining}`. См. server-reconnect.md.

export type SyncState = "restarting" | "reconnecting" | "syncing" | "live";

/** Диспетчер статуса (зовут из ClientGameRunner/Transport). */
export function syncStatus(state: SyncState, remaining = 0): void {
  window.dispatchEvent(
    new CustomEvent("terron-sync-status", { detail: { state, remaining } }),
  );
}

let el: HTMLDivElement | null = null;
let maxRemaining = 0; // для прогресс-бара догона (пик бэклога сессии)
let hideTimer: ReturnType<typeof setTimeout> | null = null;
// текущее показанное состояние — для дедупа (runner шлёт статус КАЖДЫЙ тик).
let current: SyncState | "hidden" = "hidden";
// terron: гарантия минимального показа. Догон после Ctrl+F5 иногда пролетает за
// доли секунды → баннер мелькал незаметно. Раз активный баннер (синхронизация/
// переподключение) появился — держим его хотя бы MIN_ACTIVE_MS, только потом «live».
const MIN_ACTIVE_MS = 1500;
let activeShownAt = 0; // когда впервые показали активный баннер (0 = скрыт/live)
let liveDeferred = false; // «live» отложен до истечения минимума

function ensureEl(): HTMLDivElement {
  if (el) return el;
  el = document.createElement("div");
  el.id = "terron-sync-status";
  el.style.cssText = [
    "position:fixed",
    "top:80px", // фактический top ставит show() — под меню игрока
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:10050",
    "display:none",
    "min-width:220px",
    "max-width:92vw",
    "padding:9px 14px",
    "border-radius:10px",
    "background:rgba(17,24,39,0.96)",
    "border:1px solid rgba(212,175,55,0.4)",
    "box-shadow:0 10px 30px rgba(0,0,0,0.5)",
    "color:#fff",
    "font:600 13px/1.3 'Golos Text',system-ui,sans-serif",
    "text-align:center",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(el);
  return el;
}

// terron: баннер живёт НИЖЕ верхнего ховер-меню игрока (player-info-overlay),
// чтобы не перекрывать его: top = низ меню + отступ.
// ⚠️ Сам <player-info-overlay> — position:static обёртка ВЫСОТОЙ ВО ВЕСЬ ДОКУМЕНТ
// (его bottom = низ экрана), поэтому мерить надо РЕАЛЬНУЮ панель = fixed-ребёнка.
// Раньше мерили обёртку → баннер уезжал на ~низ экрана под нижний HUD (регресс).
// Панель схлопнута (никто не наведён) → дефолтный top.
let lastMenuBottom = 0;
function bannerTop(): number {
  const m = document.querySelector("player-info-overlay");
  const panel = (m?.firstElementChild ?? m) as HTMLElement | null;
  if (panel) {
    const r = panel.getBoundingClientRect();
    // Якоримся к панели, только если она реально показана ВВЕРХУ экрана.
    lastMenuBottom =
      r.height > 8 && r.top < window.innerHeight * 0.4 ? r.bottom : 0;
  }
  return (lastMenuBottom > 0 ? lastMenuBottom : 72) + 8;
}

// terron: пока баннер виден — раз в 500мс поправляем top (меню игрока могло
// появиться/исчезнуть ПОСЛЕ показа; статусы вроде «Переподключение…» дедупятся
// и show() повторно не зовётся — без этого пилюля наезжала на панель).
let posTimer: ReturnType<typeof setInterval> | null = null;
function startPositionTracking(): void {
  if (posTimer !== null) return;
  posTimer = setInterval(() => {
    // Самолечащийся инвариант (31.07): баннер живёт ТОЛЬКО в матче. Если матч
    // умер в обход штатного stop() (любой будущий баг teardown'а), «Переподклю-
    // чение…» не должно вечно висеть поверх меню — гасим сами.
    if (!document.body.classList.contains("in-game")) {
      current = "hidden";
      if (el) el.style.display = "none";
      stopPositionTracking();
      return;
    }
    if (el && el.style.display !== "none") {
      el.style.top = `${bannerTop()}px`;
    }
  }, 500);
}
function stopPositionTracking(): void {
  if (posTimer !== null) {
    clearInterval(posTimer);
    posTimer = null;
  }
}

function show(html: string): void {
  const e = ensureEl();
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  e.style.top = `${bannerTop()}px`;
  e.innerHTML = html;
  e.style.display = "block";
  startPositionTracking();
}

function hide(delay = 0): void {
  if (!el) return;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (el) el.style.display = "none";
    maxRemaining = 0;
    current = "hidden";
    activeShownAt = 0;
    liveDeferred = false;
    stopPositionTracking();
  }, delay);
}

// terron: «Переподключение…» с ЗАДЕРЖКОЙ — мелкие сетевые чихи (<2с) не
// показываем вовсе (решение владельца 16.07: «при мелких лагах не заёбывало»).
// Настоящий обрыв живёт дольше 2с — баннер появится; если за 2с пришло
// live/syncing — показ отменяется.
const RECONNECT_SHOW_DELAY_MS = 2000;
let reconnectPending: ReturnType<typeof setTimeout> | null = null;

function onStatus(state: SyncState, remaining: number): void {
  // догон закончился (remaining ≤ 0) → трактуем как live.
  if (state === "syncing" && remaining <= 0) state = "live";

  // Любое НЕ-reconnecting состояние отменяет отложенный показ «Переподключения».
  if (state !== "reconnecting" && reconnectPending !== null) {
    clearTimeout(reconnectPending);
    reconnectPending = null;
  }

  // Активный баннер впервые появляется (был скрыт/live) → засекаем время показа.
  if (state !== "live" && (current === "hidden" || current === "live")) {
    activeShownAt = performance.now();
    liveDeferred = false;
  }

  if (state === "restarting") {
    if (current === "restarting") return; // дедуп
    current = "restarting";
    maxRemaining = 0;
    show(
      L(
        "Сервер перезапускается — переподключаемся…",
        "Server restarting — reconnecting…",
      ),
    );
    return;
  }
  if (state === "reconnecting") {
    if (current === "reconnecting") return; // дедуп
    // Баннер скрыт/live → отложенный показ (мелкий обрыв не мигает).
    // Из restarting/syncing (уже видим) — переключаем сразу, без паузы.
    if (current === "hidden" || current === "live") {
      if (reconnectPending === null) {
        reconnectPending = setTimeout(() => {
          reconnectPending = null;
          current = "reconnecting";
          maxRemaining = 0;
          activeShownAt = performance.now();
          liveDeferred = false;
          show(L("Переподключение…", "Reconnecting…"));
        }, RECONNECT_SHOW_DELAY_MS);
      }
      return;
    }
    current = "reconnecting";
    maxRemaining = 0;
    show(L("Переподключение…", "Reconnecting…"));
    return;
  }
  if (state === "syncing") {
    current = "syncing";
    if (remaining > maxRemaining) maxRemaining = remaining;
    const pct =
      maxRemaining > 0
        ? Math.max(0, Math.min(100, 100 * (1 - remaining / maxRemaining)))
        : 0;
    const label = L(
      `Синхронизация — осталось ${remaining} ходов`,
      `Synchronizing — ${remaining} turns left`,
    );
    // terron: без спиннера (CSS-анимация подлагивала на слабых устройствах,
    // прогресс-полоса информативнее) — только текст + бар.
    show(
      `${label}
       <div style="margin-top:6px;height:4px;border-radius:3px;background:rgba(255,255,255,.15);overflow:hidden">
         <div style="height:100%;width:${pct}%;background:#d4af37;transition:width .15s linear"></div>
       </div>`,
    );
    return;
  }
  // live: гасим ТОЛЬКО если сейчас что-то показано (reconnecting/restarting/syncing).
  // Если уже live/скрыто — no-op (runner шлёт live каждый тик, не мигаем «готово»).
  if (current === "live" || current === "hidden") return;
  // Гарантия минимального показа: если активный баннер провисел < MIN_ACTIVE_MS
  // (быстрый догон), откладываем «Синхронизировано» — держим прогресс видимым.
  const elapsed = performance.now() - activeShownAt;
  if (activeShownAt > 0 && elapsed < MIN_ACTIVE_MS) {
    if (!liveDeferred) {
      liveDeferred = true;
      setTimeout(
        () => {
          liveDeferred = false;
          onStatus("live", 0);
        },
        MIN_ACTIVE_MS - elapsed + 30,
      );
    }
    return; // держим текущий активный баннер (прогресс на последнем значении)
  }
  current = "live";
  activeShownAt = 0;
  maxRemaining = 0;
  show(
    `<span style="color:#22c55e">✓</span> ${L("Синхронизировано", "Synchronized")}`,
  );
  hide(900);
}

let inited = false;
/** Одноразовая инициализация слушателя (зовётся из ClientGameRunner). */
export function initSyncStatus(): void {
  if (inited) return;
  inited = true;
  window.addEventListener("terron-sync-status", (e: Event) => {
    const d = (e as CustomEvent).detail as {
      state: SyncState;
      remaining: number;
    };
    onStatus(d.state, d.remaining ?? 0);
  });
}

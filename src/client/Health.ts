// terron: телеметрия «тихих» проблем — то, с чем игроки сталкиваются, но НЕ
// репортят (кнопка молча не сработала, самолечение что-то чинило, скрипт упал).
// Идея выросла из багов 16.07: «нет кнопки старта» и «онлайн нельзя» жили в
// проде незамеченными, потому что не оставляли следов. Теперь каждый датчик
// самолечения/фолбэка/молчаливого отказа бьёт событием сюда.
//
// Сервер: POST /client/health → таблица client_health (platform-api).
// Смотреть сводку: curl https://api.terron.io/stats/health?days=7
//
// Дисциплина: fire-and-forget (никогда не мешаем игре), жёсткие капы на
// вкладку (не заспамить БД с битого клиента), детали обрезаются.

import { getApiBase } from "./Api";
import { loadStageSnapshot } from "./LoadTrace";

// Типы событий — вайтлист, дублируется на сервере (clientHealth.ts).
export type HealthKind =
  | "js_error" // необработанное исключение window.onerror
  | "unhandled_rejection" // необработанный промис-реджект
  | "online_lie" // navigator.onLine=false при живом сокете (класс бага NaG)
  | "startbar_healed" // вотчдог пересоздал пропавший бар «СТАРТ» в лобби
  | "username_blocked" // клик Создать/Войти заблокирован невалидным ником
  | "lobby_socket_gave_up" // лобби-сокет сдался (витрина на главной заморожена)
  | "lobby_stuck_past_start" // время старта прошло, а мы всё ещё в лобби: вкладка
  //                            была свёрнута/сокет умер молча (репорт 10.08 —
  //                            «после сворачивания браузера лобби не стартует»)
  | "slow_first_tick" // оверлей загрузки снят 8с-фолбэком (воркер не тикнул)
  | "start_no_game" // нажал «Старт», 20с спустя ни матча, ни закрытия лобби
  | "game_error_modal" // модалка фатальной ошибки = игрок выбит из матча
  | "desync" // рассинхронизация с сервером (hash mismatch)
  | "webgl_error" // WebGL-ошибка в модалке (не поднялся / умер)
  | "webgl_context_lost" // потеря GL-контекста (белый экран, чаще мобилки)
  | "game_reconnect" // реконнект игрового сокета в матче
  // Выходы в ПЛОХОМ состоянии (pagehide с гейтом по контексту — обычный
  // «зашёл в меню и ушёл» НЕ шлётся, это воронка интереса, не сбой):
  | "exit_during_loading" // закрыл вкладку, пока висел экран загрузки матча
  | "exit_during_sync_trouble" // ушёл при видимом баннере «Переподключение…»
  | "exit_ingame_early" // ушёл из матча в первые 60с (⚠️ шумноватый: ранняя
  //                       смерть в FFA тоже сюда попадает — смотреть тренд)
  | "rage_click" // 4+ быстрых клика в один элемент ВНЕ матча = «не кликается»
  | "join_timeout" // «не присоединились к игре вовремя»: grace_expired (сервер
  //                  не стартовал нас за 60с) / full_lobby; серия у одного
  //                  игрока (total≫sessions) = системный сбой входа в онлайн
  | "join_refused" // сервер ЗАКРЫЛ сокет с причиной (1002: game gone /
  //                  version mismatch / forbidden) — detail = причина сервера
  | "tab_died" // вкладка умерла БЕЗ pagehide в матче/на загрузке (OOM-kill,
  //              краш браузера) — надгробие в localStorage, репорт при
  //              СЛЕДУЮЩЕМ заходе (detail = фаза и давность)
  | "ui_state_conflict" // в матче, а главное меню ВИДНО (репорт Smart Hunter
  //                       16.07: холодный офлайн-старт на медленном инете —
  //                       HUD и меню поверх друг друга)
  | "streak_ui_error" // terron 27.08: блок «Серии» в досье упал на отрисовке.
  //                     Ачивки-серии считает сервер, но данные приходят снаружи
  //                     (поле streaks у /me/profile): кривая форма НЕ должна
  //                     уносить с собой всё досье, поэтому блок обёрнут и молча
  //                     не рисуется, а сюда прилетает текст ошибки.
  | "load_trace" // трассировка холодного старта (LoadTrace.ts): стадии + байты
  | "conn_dropped_loading" // событие `offline` СРАБОТАЛО, пока висел экран
  //                          загрузки матча — прямой сигнал «не долетел до матча
  //                          из-за обрыва сети» (detail = стадия + сколько ждал)
  // --- terron 20.07: проверка сегодняшнего пакета правок в бою ---
  | "ingame_class_missing" // ЗЕРКАЛО ui_state_conflict: матч ИДЁТ (жив слой
  //                          ввода), а класса in-game на body НЕТ → меню не
  //                          спрятано и висит поверх игры (репорт 20.07,
  //                          мобильный Brave). Старый датчик это пропускал:
  //                          он требовал in-game, которого тут как раз и нет.
  | "stuck_awaiting_start" // матч создан, но мир не тикнул за 30с — игрок
  //                          сидит на «Ждём начала матча…» в никуда
  | "catchup_timeout" // пачка догона не пришла за 15с и мы просим заново
  //                     (проверка правки петли догона от 20.07)
  | "slow_renderer_build" // сборка GL-вида дольше 2.5с (проверка прогрева
  //                         шейдеров и ленивых пассов от 20.07)
  | "gl_context_churn" // вкладка создала больше 3 GL-контекстов (проверка
  //                      правки утечки контекстов от 20.07; лимит браузера ~16)
  | "gl_context_retry" // браузер отказал в контексте, но со 2-3-й попытки дал
  //                      (перезапуск GPU-процесса). Без датчика самолечение
  //                      выглядело бы как «класс ошибок исчез сам» (10.08)
  | "slow_ingest" // один ингест апдейтов дольше 800мс — главный поток замер
  | "render_frozen" // тики идут, кадров нет: картинка замерла при живых данных
  | "reward_no_session" // экран итогов не смог спросить награду — нет сессии
  | "reward_missing" // награда так и не пришла за всё окно опроса
  //                 (проверка правки подбора цветов от 20.07)
  // --- terron 20.07: F5-резюм локальных матчей + персист (LocalGameStore) ---
  | "local_resume" // подняли локальный матч из записи (F5 / список «Продолжить»);
  //                  detail = сколько ходов догоняем. Показывает, что фича
  //                  реально работает в бою и сколько истории восстанавливаем
  | "local_persist_failed" // сброс снапшота в IndexedDB упал (хранилище
  //                          заблокировано/переполнено) — резюм тихо не сработает
  | "local_resume_failed" // запись матча была, но резюм не поднялся (битый
  //                         снапшот / 0 ходов) — регресс механики резюма
  | "lobby_proto_reload" // формат фида витрины разъехался со старой вкладкой
  //                        (деплой с новым типом лобби) → вкладка сама
  //                        перезагрузилась, см. LobbySocket
  | "render_tick_error" // исключение в GPU-части ингеста (builder/renderer) —
  //                        тик пропущен и самовылечился; detail = message+стек
  //                        (репорт 17.07 «границы замёрзли навсегда»)
  // --- terron ПЕРФ 16.08: датчики к пакету правок ветки claude/perf-audit ---
  | "catchup_trace" // догон ≥300 тиков ЗАВЕРШИЛСЯ: длительность и мс/тик —
  //                   боевой замер ускорения догона (стенд давал −19%)
  | "lobby_socket_recovered" // редкий 30с-повтор витрины ДОЖАЛСЯ до коннекта
  //                            после lobby_socket_gave_up (правка 08.08);
  //                            detail = сколько минут витрина была мертва
  | "flag_atlas_overflow" // в атласе флагов кончились слои (MAX_FLAG_LAYERS)
  //                          — у части игроков пропали иконки; detail = сколько
  //                          слоёв не хватило (гард решения «потолок 160»)
  // --- terron 22.08: сводка производительности матча (PerfHud.ts) ---
  | "perf_summary"; // ОДИН отчёт по итогам матча (не поток кадров!): гистограмма
//                     длительностей кадра, тик/с симуляции, макс. очередь
//                     воркера, заминки >100мс + контекст (карта, игроки,
//                     длительность) и ИДЕНТИФИКАТОР СБОРКИ. Ради последнего всё
//                     и заведено: сравнивать распределения ДО и ПОСЛЕ выката,
//                     а не спорить об ощущениях.

/**
 * terron ПЕРФ/ТЕЛЕМЕТРИЯ (08.08). Раньше здесь был жёсткий обрыв: пять событий
 * на тип — и дальше тишина. Для РЕДКИХ типов это правильно, а для повторяющихся
 * ломало картину. Пример из данных: у `game_reconnect` за двое суток оказалось
 * **45 сессий РОВНО с пятью** переподключениями — не поведение сети, а сорок
 * пять сессий, упёршихся в лимит. Сколько их было на самом деле, узнать было
 * нельзя, причём именно у тех, кому хуже всего.
 *
 * Теперь: первые пять шлём как раньше, дальше — только ВЕХИ (10-е, 25-е, 50-е,
 * 100-е, 250-е…). Хвост виден, трафик по-прежнему ограничен: не больше девяти
 * событий на тип. В `meta.seq` кладём порядковый номер, поэтому «сколько их
 * было на самом деле» читается прямо из последнего события.
 */
const MAX_PER_KIND = 5;
const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
const MAX_TOTAL = 40;

// Случайный id вкладки — чтобы отличать «один битый клиент шумит» от
// «задело много игроков» (в сводке считаем уникальные сессии).
const sessionId = Math.random().toString(36).slice(2, 10);
const sentPerKind = new Map<string, number>();
/** Сколько раз событие ПРОИЗОШЛО (а не было отправлено) — источник meta.seq. */
const seenPerKind = new Map<string, number>();
let totalSent = 0;

/** Слать ли N-е по счёту событие этого типа: первые пять и дальше вехи. */
function shouldSend(seq: number): boolean {
  return seq <= MAX_PER_KIND || MILESTONES.includes(seq);
}

export function reportHealth(
  kind: HealthKind,
  detail = "",
  meta?: Record<string, unknown>,
): void {
  sendHealth(kind, detail, meta, false);
}

function sendHealth(
  kind: HealthKind,
  detail: string,
  meta: Record<string, unknown> | undefined,
  useBeacon: boolean,
): void {
  try {
    const seq = (seenPerKind.get(kind) ?? 0) + 1;
    seenPerKind.set(kind, seq);
    if (!shouldSend(seq) || totalSent >= MAX_TOTAL) return;
    sentPerKind.set(kind, (sentPerKind.get(kind) ?? 0) + 1);
    totalSent++;
    // Порядковый номер — чтобы «пять событий» больше не читались как «их было
    // пять»: у веховых записей seq покажет настоящий масштаб.
    meta = { ...(meta ?? {}), seq };
    const url = `${getApiBase()}/client/health`;
    const body = JSON.stringify({
      kind,
      detail: String(detail).slice(0, 300),
      path: window.location.pathname.slice(0, 80),
      isMobile: window.innerWidth < 1024,
      sessionId,
      meta,
    });
    // sendBeacon — для событий на pagehide (fetch при закрытии вкладки
    // ненадёжен даже с keepalive). ⚠️ ГРАБЛЯ: Blob с application/json
    // кросс-ориджин ТРЕБУЕТ CORS-префлайт, которого у beacon нет → Chrome
    // молча дропает. Шлём голой строкой (text/plain = safelisted, летит без
    // префлайта), сервер парсит text/plain как JSON (routes/clientHealth.ts).
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, body);
      return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body,
    }).catch(() => {});
  } catch {
    /* телеметрия не должна мешать игре */
  }
}

// terron: выходы в ПЛОХОМ состоянии. Ловим pagehide и смотрим КОНТЕКСТ:
// висел ли экран загрузки матча, был ли виден баннер синхронизации, давно ли
// игрок в матче. Обычный «зашёл на главную и ушёл» — НЕ сбой (это воронка
// интереса, её меряет traffic_journey) — такие выходы не шлём вовсе. Так
// отсекаются ложноположительные «просто не интересно».
// terron 24.07: обогащение выходов/обрывов на загрузке — ЧЕМ вызван отвал
// между «нажали Играть» и первым тиком (воронка трафика: play_click ≫ played).
// Источник трафика читаем прямо из localStorage (Analytics.captureTrafficSource
// кладёт terron_src) — без импорта Analytics, у него сетевые сайд-эффекты.
function trafficSource(): string {
  try {
    return localStorage.getItem("terron_src") || "direct";
  } catch {
    return "direct";
  }
}

interface ConnInfo {
  online: boolean;
  type?: string; // effectiveType: 4g/3g/2g/slow-2g
  downlink?: number; // Мбит/с (оценка)
  rtt?: number; // мс (оценка)
  saveData?: boolean;
}
function connInfo(): ConnInfo {
  const c = (
    navigator as unknown as {
      connection?: {
        effectiveType?: string;
        downlink?: number;
        rtt?: number;
        saveData?: boolean;
      };
    }
  ).connection;
  return {
    online: navigator.onLine,
    type: c?.effectiveType,
    downlink: c?.downlink,
    rtt: c?.rtt,
    saveData: c?.saveData,
  };
}

// Сколько раз сеть отваливалась/возвращалась за жизнь вкладки — на выходе это
// показывает, ФЛАПАЛО ли соединение (частая причина зависшей загрузки у
// РФ-мобилок под throttle: navigator.onLine скачет).
let offlineFlaps = 0;

// Текущая фаза клиента — для tombstone и exit-датчиков.
/**
 * terron ПЕРФ (08.08): КОНТЕКСТ УМИРАЮЩЕЙ ВКЛАДКИ — карта, размер, устройство.
 *
 * Зачем. Оказалось, что `tab_died` с давностью «0m» — это ПРЯМОЙ измеритель
 * крашей на телефонах: за сутки 72 из 122 мобильных смертей случились в первую
 * минуту, то есть вкладка умирала во время игры, а не была убита системой в
 * фоне через час (на десктопе таких — одна). Сигнал в разы богаче Play Vitals
 * (~72/сутки против ~5/сутки: тот видит только приложение и только тех, кто
 * согласился на аналитику) и приходит сразу.
 *
 * Но по нему нельзя было понять, ЧТО именно убивает: рапорт уходит уже на
 * СЛЕДУЮЩЕЙ загрузке, и `path` показывает новую страницу, а не мёртвый матч.
 * Поэтому кладём контекст прямо в надгробие: без него вопрос «убивают ли
 * телефоны большие карты» не проверить, а он ключевой (разброс площади карт —
 * тридцатикратный).
 */
export function matchContext(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  try {
    const m = /\/game\/([A-Za-z0-9]+)/.exec(window.location.pathname);
    if (m) ctx.gameID = m[1];
    // Карту и её площадь знает рендерер — он же кладёт их в window для
    // диагностики. Нет рендера (умерли на загрузке) — полей просто не будет.
    const w = window as unknown as {
      __terronMap?: { name?: string; w?: number; h?: number };
    };
    if (w.__terronMap?.name !== undefined) {
      ctx.map = w.__terronMap.name;
      const mw = w.__terronMap.w ?? 0;
      const mh = w.__terronMap.h ?? 0;
      if (mw > 0 && mh > 0) ctx.mapMpx = Math.round((mw * mh) / 100000) / 10;
    }
    const dm = (navigator as { deviceMemory?: number }).deviceMemory;
    if (typeof dm === "number") ctx.deviceMemory = dm;
    const hc = navigator.hardwareConcurrency;
    if (typeof hc === "number") ctx.cores = hc;
    ctx.dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
    ctx.screen = `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`;
  } catch {
    /* контекст — необязательная приправа, без него надгробие всё равно рабочее */
  }
  return ctx;
}

function currentPhase(): "ingame" | "loading" | "menu" {
  if (document.body.classList.contains("in-game")) return "ingame";
  const m = document.querySelector("game-starting-modal") as
    | (HTMLElement & { isVisible?: boolean })
    | null;
  if (m?.isVisible === true) return "loading";
  return "menu";
}

// terron: НАДГРОБИЕ — ловим смерть вкладки БЕЗ pagehide (OOM-kill на телефонах,
// краш браузера/вебвью). Раз в 5с пишем в localStorage «я жив, фаза такая-то»;
// pagehide помечает выход чистым. Следующий заход читает надгробие: если
// прошлая сессия оборвалась грязно В МАТЧЕ или НА ЗАГРУЗКЕ — репортим.
// Выход с меню без pagehide не репортим (мобильные браузеры часто убивают
// фоновые вкладки на меню — это норма, не сбой).
function installTombstoneSensor(): void {
  const KEY = "terron_tombstone";
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const t = JSON.parse(raw) as {
        clean?: boolean;
        phase?: string;
        ts?: number;
        ctx?: Record<string, unknown>;
      };
      if (
        t &&
        t.clean !== true &&
        (t.phase === "ingame" || t.phase === "loading")
      ) {
        const ageMin = Math.round((Date.now() - (t.ts ?? Date.now())) / 60000);
        // ctx — контекст ПРОШЛОЙ (умершей) сессии, см. matchContext().
        reportHealth("tab_died", `${t.phase} ${ageMin}m ago`, {
          phase: t.phase,
          ageMin,
          ...(t.ctx ?? {}),
        });
      }
    }
  } catch {
    /* localStorage может быть недоступен (private mode) */
  }
  const write = (clean: boolean): void => {
    try {
      const phase = currentPhase();
      localStorage.setItem(
        KEY,
        JSON.stringify({
          clean,
          phase,
          ts: Date.now(),
          // Контекст собираем только в матче/на загрузке — в меню он не нужен,
          // а смерть на меню мы и так не репортим.
          ...(phase === "menu" ? {} : { ctx: matchContext() }),
        }),
      );
    } catch {
      /* ignore */
    }
  };
  write(true);
  // Пульс раз в 5с: обновляем надгробие + заодно инвариант UI-состояний —
  // «в матче, а главное меню видно» (репорт Smart Hunter 16.07: холодный
  // офлайн-старт → HUD и меню поверх друг друга). Один репорт на сессию.
  let uiConflictReported = false;
  // terron 20.07: ЗЕРКАЛЬНЫЙ инвариант. Слой ввода `#game-input-overlay`
  // живёт ровно столько, сколько живёт матч (создаётся в createClientGame,
  // снимается в teardown) — значит «слой есть, а класса in-game нет» = игра
  // идёт, но меню не спрятано. Ждём два пульса (10с), чтобы не поймать
  // нормальную секунду между стартом рендера и постановкой класса.
  let noClassPulses = 0;
  let missingClassReported = false;
  window.setInterval(() => {
    write(false);
    const gameAlive = document.getElementById("game-input-overlay") !== null;
    const hasClass = document.body.classList.contains("in-game");
    if (gameAlive && !hasClass) {
      noClassPulses++;
      if (noClassPulses >= 2 && !missingClassReported) {
        missingClassReported = true;
        const modal = document.querySelector("game-starting-modal") as
          | (HTMLElement & { isVisible?: boolean })
          | null;
        reportHealth(
          "ingame_class_missing",
          `${Math.round(noClassPulses * 5)}s`,
          { loadingModalVisible: modal?.isVisible === true },
        );
      }
    } else {
      noClassPulses = 0;
    }
    if (!uiConflictReported && document.body.classList.contains("in-game")) {
      // ⚠️ у main-layout display:contents (нет бокса, offsetParent ВСЕГДА
      // null) — проверяем ОБЁРТКУ (div c in-[.in-game]:hidden): в матче она
      // обязана быть display:none; видима = меню поверх игры.
      const menuWrap = document.querySelector("main-layout")?.parentElement;
      if (menuWrap && getComputedStyle(menuWrap).display !== "none") {
        uiConflictReported = true;
        reportHealth("ui_state_conflict", "menu_visible_in_game");
      }
    }
  }, 5000);
  window.addEventListener("pagehide", () => write(true));
}

let gameEnteredAt: number | null = null;
function installExitContextSensor(): void {
  // Момент входа в матч — по появлению класса in-game на body.
  const mo = new MutationObserver(() => {
    const inGame = document.body.classList.contains("in-game");
    if (inGame && gameEnteredAt === null) gameEnteredAt = Date.now();
    if (!inGame) gameEnteredAt = null;
  });
  mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("pagehide", () => {
    const inGame = document.body.classList.contains("in-game");
    // ⚠️ game-starting-modal ВСЕГДА в DOM (index.html), прячется opacity-
    // классами, а внутренности fixed → offsetParent-проверка всегда true и
    // КАЖДЫЙ выход считался «на загрузке» (ложняк, пойман при верификации).
    // Читаем реальный Lit-стейт isVisible.
    const loadingEl = document.querySelector("game-starting-modal") as
      | (HTMLElement & { isVisible?: boolean })
      | null;
    const loading = loadingEl?.isVisible === true;
    const syncEl = document.getElementById("terron-sync-status");
    const syncTrouble = syncEl !== null && syncEl.style.display !== "none";
    if (loading) {
      // ГДЕ встал (стадия пайплайна), сколько ждал, что с сетью, откуда пришёл —
      // прежде detail был пустой, отвал на загрузке был «чёрным ящиком».
      const snap = loadStageSnapshot();
      const c = connInfo();
      const waited = Math.round((snap.sinceJoinMs ?? snap.sincePageMs) / 1000);
      sendHealth(
        "exit_during_loading",
        `${snap.stage} +${waited}s ${c.online ? "on" : "OFF"}` +
          `${offlineFlaps ? ` flap${offlineFlaps}` : ""}` +
          `${c.type ? ` ${c.type}` : ""}`,
        {
          stage: snap.stage,
          waited,
          ...c,
          offlineFlaps,
          source: trafficSource(),
        },
        true,
      );
    } else if (inGame && syncTrouble) {
      const c = connInfo();
      sendHealth(
        "exit_during_sync_trouble",
        `${c.online ? "on" : "OFF"}${offlineFlaps ? ` flap${offlineFlaps}` : ""}` +
          `${c.type ? ` ${c.type}` : ""}`,
        { ...c, offlineFlaps, source: trafficSource() },
        true,
      );
    } else if (inGame && gameEnteredAt !== null) {
      const secs = Math.round((Date.now() - gameEnteredAt) / 1000);
      if (secs < 60) {
        sendHealth(
          "exit_ingame_early",
          `${secs}s`,
          {
            source: trafficSource(),
          },
          true,
        );
      }
    }
  });
}

// terron: rage click — игрок злобно тыкает в элемент, который не реагирует.
// Прямой измеритель «всё везде кликается и работает»: ловит мёртвые кнопки,
// которые не найти аудитом кода. Гейты от ложняков: НЕ в матче (быстрые клики
// по карте = геймплей), НЕ на полях ввода (тройной клик = выделение текста),
// порог 4 клика за 1.2с по ОДНОМУ элементу.
function installRageClickSensor(): void {
  let lastTarget: EventTarget | null = null;
  let count = 0;
  let firstAt = 0;
  let reportedFor: EventTarget | null = null;
  document.addEventListener(
    "click",
    (e) => {
      if (document.body.classList.contains("in-game")) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      const now = Date.now();
      if (t === lastTarget && now - firstAt < 1200) {
        count++;
        if (count >= 4 && reportedFor !== t) {
          reportedFor = t; // один репорт на элемент за «приступ»
          const el = t.closest("button, a, [role=button]") ?? t;
          const label =
            `${el.tagName.toLowerCase()}` +
            (el.id ? `#${el.id}` : "") +
            ` «${(el.textContent ?? "").trim().slice(0, 30)}»`;
          reportHealth("rage_click", label);
        }
      } else {
        lastTarget = t;
        count = 1;
        firstAt = now;
        if (reportedFor !== t) reportedFor = null;
      }
    },
    { capture: true, passive: true },
  );
}

// Глобальные ловушки падений + датчик выхода. Зовётся один раз из Main.
export function installGlobalHealthHandlers(): void {
  installExitContextSensor();
  installRageClickSensor();
  installTombstoneSensor();
  // terron 24.07: обрыв сети ПРЯМО на экране загрузки матча. navigator.onLine
  // → false, пока висит game-starting-modal, = самый прямой ответ на «вдруг у
  // них соединение отваливается» (ловим ДО закрытия вкладки, не только на
  // выходе). Один репорт на «падение»; кап MAX_PER_KIND=5 бережёт от флап-спама.
  window.addEventListener("offline", () => {
    offlineFlaps++;
    if (currentPhase() === "loading") {
      const snap = loadStageSnapshot();
      const waited = Math.round((snap.sinceJoinMs ?? snap.sincePageMs) / 1000);
      reportHealth("conn_dropped_loading", `${snap.stage} +${waited}s`, {
        stage: snap.stage,
        waited,
        ...connInfo(),
        offlineFlaps,
        source: trafficSource(),
      });
    }
  });
  window.addEventListener("online", () => {
    offlineFlaps++; // возврат тоже флап — на выходе видно «сколько раз скакало»
  });
  window.addEventListener("error", (e: ErrorEvent) => {
    const msg = e.message || "";
    // Кросс-ориджин скрипты (расширения, SDK сторов) дают пустой "Script
    // error." без деталей — не наш код, шум.
    if (!msg || msg === "Script error.") return;
    if (
      e.filename &&
      !e.filename.includes(window.location.host) &&
      !e.filename.startsWith("blob:")
    ) {
      return;
    }
    const src = (e.filename || "").split("/").pop() ?? "";
    // Стек (2 верхних кадра) + колонка: строка минифицированного бандла
    // бесполезна (в ней пол-приложения), а имя-функции:строка:колонка из
    // стека указывает точное место (разбор «small id undefined» 17.07).
    const stack =
      e.error instanceof Error && e.error.stack
        ? ` :: ${e.error.stack.split("\n").slice(1, 3).join(" | ").replace(/\s+/g, " ").slice(0, 140)}`
        : "";
    reportHealth(
      "js_error",
      `${msg} @ ${src}:${e.lineno ?? 0}:${e.colno ?? 0}${stack}`,
    );
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const r: unknown = e.reason;
    const msg = r instanceof Error ? r.message : String(r);
    // Сетевой шум (офлайн, блокировщики, недоступный API у RU-провайдеров) —
    // не баги кода, для него есть отдельные датчики/ru-ban трекер.
    if (/failed to fetch|networkerror|load failed|abort/i.test(msg)) return;
    reportHealth("unhandled_rejection", msg.slice(0, 200));
  });
}

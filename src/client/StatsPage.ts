import { pollWhileVisible } from "./utilities/PollWhileVisible";
import { html, svg, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getApiBase } from "./Api";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { getMapName, L, translateText } from "./Utils";

interface Point {
  ts: string;
  games: number;
  online_avg: number | null;
  online_max: number | null;
}
type Gran = "hour" | "day";
type View = "charts" | "games" | "traffic";

interface TrafficRow {
  source: string;
  visitors: number;
  playClicks: number;
  lobbyStarted: number;
  players: number;
  spawned: number;
  activePlayers: number;
  matches: number;
  playSeconds: number;
  kills: number;
  winners: number;
  wins: number;
  deaths: number;
  losses: number;
  quits: number;
  lefts: number;
}

interface ActiveGame {
  gameID: string;
  gameMap?: string;
  gameMode?: string;
  maxPlayers?: number | null;
  publicGameType?: string | null;
  numClients: number;
  startTime: number | null;
  createdAt: number;
}

// terron: распределение онлайна (из /w0/api/online_breakdown).
interface OnlineBreakdown {
  total: number;
  inActiveGame: number;
  inLobby: number;
  publicActiveGames: number;
  privateActiveGames: number;
  publicLobbies: number;
  privateLobbies: number;
}

// terron: удержание по источнику (из /stats/retention).
interface RetentionPoint {
  day: number;
  eligible: number;
  retained: number;
  pct: number;
}
interface RetentionResult {
  source: string;
  cohort: number;
  points: RetentionPoint[];
}

/**
 * /stats — публичная статистика проекта: онлайн и сыгранные партии во времени.
 * Открывается кликом по счётчику в футере. Партии берём из истории матчей (всё
 * время), онлайн — из снимков (online_snapshots, копятся раз в ~5 мин).
 * Графики рисуем самодельным SVG в дизайне сайта (пергамент + --t-red/--t-ink),
 * без сторонних чарт-библиотек.
 */
@customElement("stats-page")
export class StatsPage extends BaseModal {
  protected routerName = "stats";

  @state() private gran: Gran = "hour";
  @state() private points: Point[] = [];
  // terron 19.08: визиты по КАНАЛАМ (склеенным источникам) — блок «По источникам».
  @state() private sources: { source: string; total: number; points: number[] }[] =
    [];
  // terron 20.08: живой онлайн по каналам (пульс вкладок, /stats/online_sources).
  @state() private onlineBySource: { source: string; online: number }[] = [];
  // terron 21.08: та же ручка отдаёт ВТОРУЮ ОСЬ — платформу клиента (нативные
  // апки Google Play / App Store, мобильные браузеры, десктоп). В источнике её
  // не видно: апка приходит без реферера, а мобильный браузер склеен с десктопным.
  @state() private platformHistory: {
    source: string;
    total: number;
    points: number[];
  }[] = [];
  @state() private onlineByPlatform: { source: string; online: number }[] = [];
  // Какой разрез показываем в блоке онлайна: канал привлечения или платформа.
  @state() private srcDim: "source" | "platform" = "source";
  // Свой масштаб у блока источников: история разреза копится с 20.08, на часах
  // за первые сутки видно одну-две точки — поэтому по умолчанию минуты.
  @state() private srcGran: "minute" | "hour" | "day" = "minute";
  @state() private loading = true;
  @state() private onlineNow: number | null = null;

  @state() private view: View = "charts";
  // terron: «партий за 24 часа» — то же число, что счётчик в футере
  // (клик по которому и ведёт сюда). Скользящие 24ч, не календарные сутки.
  @state() private games24h: number | null = null;
  @state() private games: ActiveGame[] = [];
  @state() private gamesLoading = false;
  // terron: распределение онлайна (где сидят подключённые клиенты).
  @state() private breakdown: OnlineBreakdown | null = null;
  @state() private traffic: TrafficRow[] = [];
  @state() private trafficLoading = false;
  // terron: удержание — выбранный источник (null = таблица) + данные.
  @state() private retentionSource: string | null = null;
  @state() private retention: RetentionResult | null = null;
  @state() private retentionLoading = false;
  // ховер на графике: какой график (key) и индекс точки под курсором
  @state() private hover: { key: string; i: number } | null = null;
  private serverTime = 0;
  private gamesTimer = 0;
  /** terron ПЕРФ (08.08): остановка опроса, гейтированного видимостью вкладки. */
  private stopGamesPoll: (() => void) | null = null;

  // Ширины колонок таблицы трафика (px), тянутся мышью за грип на границе
  // заголовка. Дефолты; «Источник» узкий-широкий, длинные имена обрезаются.
  private readonly colDefaults = [
    140, 74, 100, 104, 92, 104, 100, 84, 66, 62, 62, 92, 96, 92,
  ];
  @state() private colW: number[] = [...this.colDefaults];
  private colDrag: { idx: number; startX: number; startW: number } | null =
    null;

  private onColResizeDown(idx: number, e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.colDrag = { idx, startX: e.clientX, startW: this.colW[idx] };
    window.addEventListener("pointermove", this.onColResizeMove);
    window.addEventListener("pointerup", this.onColResizeUp);
  }
  private onColResizeMove = (e: PointerEvent): void => {
    if (!this.colDrag) return;
    const { idx, startX, startW } = this.colDrag;
    const w = Math.max(36, startW + (e.clientX - startX));
    this.colW = this.colW.map((v, i) => (i === idx ? w : v));
  };
  private onColResizeUp = (): void => {
    this.colDrag = null;
    window.removeEventListener("pointermove", this.onColResizeMove);
    window.removeEventListener("pointerup", this.onColResizeUp);
  };

  protected onOpen(): void {
    void this.loadOnlineNow();
    void this.loadGames24h();
    void this.load();
  }

  private async loadGames24h(): Promise<void> {
    try {
      const r = await fetch(`${getApiBase()}/stats/games24h`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const d = (await r.json()) as { count?: number };
      if (typeof d.count === "number") {
        this.games24h = d.count;
        this.requestUpdate();
      }
    } catch {
      /* ignore */
    }
  }

  protected onClose(): void {
    this.stopGamesPolling();
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }

  private setView(v: View): void {
    if (this.view === v) return;
    this.view = v;
    if (v === "games") {
      void this.loadGames();
      this.startGamesPolling();
    } else {
      this.stopGamesPolling();
    }
    if (v === "traffic") void this.loadTraffic();
  }

  private async loadTraffic(): Promise<void> {
    if (this.traffic.length === 0) this.trafficLoading = true;
    this.requestUpdate();
    try {
      const r = await fetch(`${getApiBase()}/stats/traffic`, {
        cache: "no-store",
      });
      const d = (await r.json()) as { rows?: TrafficRow[] };
      this.traffic = Array.isArray(d.rows) ? d.rows : [];
    } catch {
      this.traffic = [];
    }
    this.trafficLoading = false;
    this.requestUpdate();
  }

  private startGamesPolling(): void {
    this.stopGamesPolling();
    // активные матчи меняются быстро — обновляем раз в 10 c, пока вкладка открыта
    // terron ПЕРФ (08.08): в фоне не опрашиваем — вкладка со статистикой часто
    // висит свёрнутой часами, а запрос тяжёлый. Возврат во вкладку освежает сразу.
    this.stopGamesPoll = pollWhileVisible(() => void this.loadGames(), 10000);
  }

  private stopGamesPolling(): void {
    this.stopGamesPoll?.();
    this.stopGamesPoll = null;
    if (this.gamesTimer) {
      clearInterval(this.gamesTimer);
      this.gamesTimer = 0;
    }
  }

  private async loadGames(): Promise<void> {
    if (this.games.length === 0) this.gamesLoading = true;
    try {
      const r = await fetch("/w0/api/active_games", { cache: "no-store" });
      const d = (await r.json()) as {
        serverTime?: number;
        games?: ActiveGame[];
      };
      this.serverTime = d.serverTime ?? Date.now();
      this.games = Array.isArray(d.games) ? d.games : [];
    } catch {
      this.games = [];
    }
    void this.loadBreakdown();
    this.gamesLoading = false;
    this.requestUpdate();
  }

  // terron: распределение онлайна — где сидят подключённые клиенты.
  private async loadBreakdown(): Promise<void> {
    try {
      const r = await fetch("/w0/api/online_breakdown", { cache: "no-store" });
      if (!r.ok) return;
      this.breakdown = (await r.json()) as OnlineBreakdown;
      this.requestUpdate();
    } catch {
      /* ignore */
    }
  }

  // terron: сводка распределения онлайна над списком активных игр.
  private renderBreakdown(): TemplateResult {
    const b = this.breakdown;
    if (!b) return html``;
    const menuIsh =
      this.onlineNow !== null ? Math.max(0, this.onlineNow - b.total) : 0;
    const cell = (label: string, n: number) =>
      html`<div
        style="flex:1;min-width:96px;background:var(--t-parchment,#fff);border:1px solid var(--t-line);border-radius:12px;padding:10px 12px"
      >
        <div style="font-size:22px;font-weight:800;color:var(--t-ink)">
          ${n}
        </div>
        <div class="t-muted" style="font-size:12px;line-height:1.25">
          ${label}
        </div>
      </div>`;
    return html`<div
      style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px"
    >
      ${cell(L("В матчах", "In matches"), b.inActiveGame)}
      ${cell(L("В лобби", "In lobbies"), b.inLobby)}
      ${cell(L("В меню / на сайте", "In menu / on site"), menuIsh)}
      ${cell(
        L("Публ. матчей · лобби", "Public matches · lobbies"),
        b.publicActiveGames,
      )}
    </div>`;
  }

  private async loadOnlineNow(): Promise<void> {
    try {
      const r = await fetch("/w0/api/online", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { n?: number };
      if (typeof d.n === "number") {
        this.onlineNow = d.n;
        this.requestUpdate();
      }
    } catch {
      /* ignore */
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.requestUpdate();
    try {
      const r = await fetch(
        `${getApiBase()}/stats/history?granularity=${this.gran}`,
        { cache: "no-store" },
      );
      const d = (await r.json()) as { points?: Point[] };
      this.points = Array.isArray(d.points) ? d.points : [];
    } catch {
      this.points = [];
    }
    await this.loadSources();
    this.loading = false;
    this.requestUpdate();
  }

  /** Разрез онлайна по каналам — у него свой масштаб, грузится отдельно. */
  private async loadSources(): Promise<void> {
    try {
      const r = await fetch(
        `${getApiBase()}/stats/online_sources?granularity=${this.srcGran}`,
        { cache: "no-store" },
      );
      const d = (await r.json()) as {
        live?: { rows?: { source: string; online: number }[] };
        history?: { sources?: { source: string; total: number; points: number[] }[] };
        livePlatform?: { rows?: { source: string; online: number }[] };
        historyPlatform?: {
          sources?: { source: string; total: number; points: number[] }[];
        };
      };
      this.onlineBySource = Array.isArray(d.live?.rows) ? d.live!.rows! : [];
      this.sources = Array.isArray(d.history?.sources)
        ? d.history!.sources!
        : [];
      // Старый API (до выката 21.08) полей платформы не отдаёт — тогда вкладка
      // «Платформы» просто покажет «история копится», а не сломается.
      this.onlineByPlatform = Array.isArray(d.livePlatform?.rows)
        ? d.livePlatform!.rows!
        : [];
      this.platformHistory = Array.isArray(d.historyPlatform?.sources)
        ? d.historyPlatform!.sources!
        : [];
    } catch {
      this.onlineBySource = [];
      this.sources = [];
      this.onlineByPlatform = [];
      this.platformHistory = [];
    }
    this.requestUpdate();
  }

  private setSrcGran(g: "minute" | "hour" | "day"): void {
    this.srcGran = g;
    void this.loadSources();
  }

  /** Переключение оси блока онлайна (данные уже загружены — только перерисовка). */
  private setSrcDim(d: "source" | "platform"): void {
    if (this.srcDim === d) return;
    this.srcDim = d;
    this.requestUpdate();
  }

  /**
   * Человеческая подпись платформы. Токены ставит клиент
   * (Analytics.clientPlatform), см. там же, почему native-* и webview-* — разные
   * вещи: мост Capacitor на живом origin флапает, а WebView-форма UA есть и у
   * чужих ин-апп браузеров.
   */
  private platformLabel(token: string): string {
    switch (token) {
      case "native-android":
        return L("Апка Android", "Android app");
      case "native-ios":
        return L("Апка iOS", "iOS app");
      case "native":
        return L("Апка", "App");
      case "webview-android":
        return L("WebView Android", "Android WebView");
      case "webview-ios":
        return L("WebView iOS", "iOS WebView");
      case "web-mobile":
        return L("Моб. браузер", "Mobile browser");
      case "web-tablet":
        return L("Планшет", "Tablet");
      case "web-desktop":
        return L("Десктоп", "Desktop");
      case "unknown":
        return L("неизвестно", "unknown");
      default:
        return token;
    }
  }

  private setGran(g: Gran): void {
    if (this.gran === g) return;
    this.gran = g;
    void this.load();
  }

  // переключатель-«пилюля» (используется и для view-вкладок, и для часы/дни)
  private pill(active: boolean, label: string, onClick: () => void) {
    return html`<button
      class="t-btn"
      style=${`padding:5px 12px;font-size:13px;${
        active
          ? "background:var(--t-ink);color:var(--t-parchment,#fff)"
          : "background:var(--t-sheet);color:var(--t-ink)"
      }`}
      @click=${onClick}
    >
      ${label}
    </button>`;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: L("Статистика", "Statistics"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent: html`<div style="display:flex;gap:6px">
        ${this.pill(this.view === "charts", L("Графики", "Charts"), () =>
          this.setView("charts"),
        )}
        ${this.pill(
          this.view === "games",
          L("Активные игры", "Active games"),
          () => this.setView("games"),
        )}
        ${this.pill(this.view === "traffic", L("Трафик", "Traffic"), () =>
          this.setView("traffic"),
        )}
      </div>`,
    });
  }

  protected renderBody(): TemplateResult {
    return html`<div class="t-page" style="max-width:980px">
      ${this.view === "games"
        ? this.renderGames()
        : this.view === "traffic"
          ? this.renderTraffic()
          : this.renderCharts()}
    </div>`;
  }

  // «Качество трафика»: воронка по источникам (from/utm → один токен). Зашло →
  // нажали играть → сыграли → выиграли, плюс глубина (ср. матчей и ср. время в матче).
  // terron: открыть удержание по источнику (клик в таблице трафика).
  private openRetention(source: string): void {
    this.retentionSource = source;
    this.retention = null;
    this.retentionLoading = true;
    this.requestUpdate();
    void this.loadRetention(source);
  }
  private closeRetention(): void {
    this.retentionSource = null;
    this.requestUpdate();
  }
  private async loadRetention(source: string): Promise<void> {
    try {
      const r = await fetch(
        `${getApiBase()}/stats/retention?source=${encodeURIComponent(source)}`,
        { cache: "no-store" },
      );
      const d = (await r.json()) as RetentionResult;
      // Игнор устаревшего ответа, если юзер уже переключил источник.
      if (this.retentionSource === source) this.retention = d;
    } catch {
      /* ignore */
    }
    this.retentionLoading = false;
    this.requestUpdate();
  }

  // terron: график удержания источника (2/7/28 день) — столбики.
  private renderRetention(): TemplateResult {
    const src = this.retentionSource ?? "";
    return html`
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <button
          class="t-btn"
          style="padding:5px 12px;font-size:13px;background:var(--t-sheet);color:var(--t-ink)"
          @click=${() => this.closeRetention()}
        >
          ← ${L("К источникам", "Back to sources")}
        </button>
        <div style="font-weight:800;font-size:16px;color:var(--t-ink)">
          ${L("Удержание", "Retention")}: ${src || L("все", "all")}
        </div>
      </div>
      <p
        class="t-muted"
        style="font-size:12.5px;line-height:1.5;margin-bottom:14px"
      >
        ${L(
          "Доля посетителей, вернувшихся спустя N дней после первого захода. «Из скольких» — те, у кого с первого визита прошло ≥N дней (только они могут дать ретеншен N-го дня).",
          "Share of visitors still active N days after their first visit. «Of» = those whose first visit was ≥N days ago (only they can have N-day retention).",
        )}
      </p>
      ${this.retentionLoading || !this.retention
        ? html`<div
            class="t-skel"
            style="height:160px;border-radius:14px"
          ></div>`
        : this.retention.cohort === 0
          ? html`<div class="t-muted" style="padding:24px 0;text-align:center">
              ${L("Нет данных по источнику.", "No data for this source.")}
            </div>`
          : html`<div style="display:flex;gap:14px;align-items:flex-end">
                ${this.retention.points.map((p) => {
                  const h = Math.max(4, Math.round((p.pct / 100) * 150));
                  return html`<div
                    style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px"
                  >
                    <div style="font-weight:800;color:var(--t-ink)">
                      ${p.pct}%
                    </div>
                    <div
                      style="width:100%;max-width:90px;height:${h}px;background:var(--t-red,#a8432b);border-radius:8px 8px 0 0"
                    ></div>
                    <div style="font-weight:700;color:var(--t-ink)">
                      ${L(`${p.day}-й день`, `Day ${p.day}`)}
                    </div>
                    <div class="t-muted" style="font-size:12px">
                      ${p.retained} ${L("из", "of")} ${p.eligible}
                    </div>
                  </div>`;
                })}
              </div>
              <div class="t-muted" style="font-size:12px;margin-top:12px">
                ${L(
                  "Всего посетителей источника:",
                  "Total visitors of source:",
                )}
                ${this.retention.cohort}
              </div>`}
    `;
  }

  private renderTraffic(): TemplateResult {
    // Открыт источник → показываем удержание вместо таблицы.
    if (this.retentionSource !== null) return this.renderRetention();
    const pct = (a: number, b: number): string =>
      b > 0 ? `${Math.round((a / b) * 100)}%` : "—";
    const mins = (secs: number, matches: number): string =>
      matches > 0 ? `${(secs / matches / 60).toFixed(1)}` : "—";
    const avg = (a: number, b: number): string =>
      b > 0 ? (a / b).toFixed(1) : "—";
    // Колонки таблицы (data-driven — чтобы навесить грипы ресайза единообразно).
    const cols: { label: string; align: "left" | "right"; title?: string }[] = [
      { label: L("Источник", "Source"), align: "left" },
      { label: L("Зашло", "Visitors"), align: "right" },
      { label: L("Нажали играть", "Play click"), align: "right" },
      {
        label: L("Лобби старт", "Lobby start"),
        align: "right",
        title: L(
          "дождались старта лобби (отсчёт кончился)",
          "reached lobby start (countdown ended)",
        ),
      },
      {
        label: L("Загрузился", "Loaded"),
        align: "right",
        title: L(
          "загрузился в игру (первый тик матча)",
          "loaded into the game (first tick)",
        ),
      },
      {
        label: L("Заспавнился", "Spawned"),
        align: "right",
        title: L("выбрал точку и заспавнился", "picked a spot and spawned"),
      },
      {
        label: L("Сожрал бота", "Ate a bot"),
        align: "right",
        title: L(
          "сожрал ≥1 бота/нацию/игрока (произвёл активность)",
          "ate ≥1 bot/nation/player (produced activity)",
        ),
      },
      { label: L("Выиграли", "Won"), align: "right" },
      {
        label: L("Смерть", "Died"),
        align: "right",
        title: L("доиграл до смерти", "played to death"),
      },
      {
        label: L("В меню", "Quit"),
        align: "right",
        title: L("ушёл в меню посреди матча", "quit to menu mid-match"),
      },
      {
        label: L("Ушёл", "Left"),
        align: "right",
        title: L("ушёл с сайта посреди матча", "left the site mid-match"),
      },
      { label: L("Ср. матчей", "Avg matches"), align: "right" },
      { label: L("Ср. мин/матч", "Avg min/match"), align: "right" },
      {
        label: L("Ср. киллов", "Avg kills"),
        align: "right",
        title: L(
          "среднее число съеденных на игрока (загрузившегося)",
          "average eaten per loaded player",
        ),
      },
    ];
    // Грип на правой границе заголовка — тянешь мышью, колонка шире/уже.
    const grip = (i: number) => html`<span
      @pointerdown=${(e: PointerEvent) => this.onColResizeDown(i, e)}
      title=${L("Тяни — ширина колонки", "Drag to resize column")}
      style="position:absolute;top:0;right:0;width:9px;height:100%;cursor:col-resize;touch-action:none;z-index:3"
    ></span>`;
    const thBase =
      "padding:6px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative";
    // td: обрезаем переполнение, чтобы узкая колонка «закрывала» длинный текст.
    const td =
      "padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;overflow:hidden;white-space:nowrap;text-overflow:ellipsis";
    // «Источник» — обычная ячейка (без sticky/жёлтой подложки).
    const tdl =
      "padding:6px 8px;text-align:left;overflow:hidden";
    const totalW = this.colW.reduce((a, b) => a + b, 0);
    return html`
      <p
        class="t-muted"
        style="font-size:12.5px;line-height:1.5;margin-bottom:12px"
      >
        ${L(
          "Откуда пришёл трафик и что с ним стало. Источник — из ссылки (utm/from), «прямой» — без метки. % считается от «зашло». Вехи «Лобби старт / Заспавнился / Сожрал бота» пишутся с 25.07 — у более старых посетителей там нули.",
          "Where traffic came from and what became of it. Source is from the link (utm/from); “direct” has no tag. % is of visitors. The “Lobby start / Spawned / Ate a bot” milestones are recorded since Jul 25 — older visitors show zeros.",
        )}
      </p>
      ${this.trafficLoading
        ? html`<div
            class="t-skel"
            style="height:200px;border-radius:14px"
          ></div>`
        : this.traffic.length === 0
          ? html`<div class="t-muted">
              ${L("Пока нет данных.", "No data yet.")}
            </div>`
          : html`<div style="overflow-x:auto">
              <table
                style="width:${totalW}px;table-layout:fixed;border-collapse:collapse;font-size:13px"
              >
                <colgroup>
                  ${this.colW.map((w) => html`<col style="width:${w}px" />`)}
                </colgroup>
                <thead>
                  <tr style="border-bottom:2px solid var(--t-ink,#2b2a24)">
                    ${cols.map(
                      (c, i) =>
                        html`<th
                          title=${c.title ?? ""}
                          style="${thBase};text-align:${c.align}"
                        >
                          ${c.label}${grip(i)}
                        </th>`,
                    )}
                  </tr>
                </thead>
                <tbody>
                  ${this.traffic.map(
                    (r) =>
                      html`<tr
                        style="border-bottom:1px solid var(--t-line,#e5ddc7)"
                      >
                        <td style=${tdl}>
                          <button
                            @click=${() => this.openRetention(r.source)}
                            title=${L(
                              "Удержание по источнику",
                              "Retention for this source",
                            )}
                            style="background:none;border:none;padding:0;cursor:pointer;font:inherit;color:var(--t-ink,#2b2a24);text-align:left;max-width:100%;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                          >
                            ${r.source}
                          </button>
                        </td>
                        <td style=${td}>${r.visitors}</td>
                        <td style=${td}>
                          ${r.playClicks}
                          <span class="t-muted"
                            >· ${pct(r.playClicks, r.visitors)}</span
                          >
                        </td>
                        <td style=${td}>
                          ${r.lobbyStarted}
                          <span class="t-muted"
                            >· ${pct(r.lobbyStarted, r.visitors)}</span
                          >
                        </td>
                        <td style=${td}>
                          ${r.players}
                          <span class="t-muted"
                            >· ${pct(r.players, r.visitors)}</span
                          >
                        </td>
                        <td style=${td}>
                          ${r.spawned}
                          <span class="t-muted"
                            >· ${pct(r.spawned, r.visitors)}</span
                          >
                        </td>
                        <td style=${td}>
                          ${r.activePlayers}
                          <span class="t-muted"
                            >· ${pct(r.activePlayers, r.visitors)}</span
                          >
                        </td>
                        <td style=${td}>
                          ${r.winners}
                          <span class="t-muted"
                            >· ${pct(r.winners, r.players)}</span
                          >
                        </td>
                        <td style=${td}>${r.deaths}</td>
                        <td style=${td}>${r.quits}</td>
                        <td style=${td}>${r.lefts}</td>
                        <td style=${td}>${avg(r.matches, r.players)}</td>
                        <td style=${td}>${mins(r.playSeconds, r.matches)}</td>
                        <td style=${td}>${avg(r.kills, r.players)}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>`}
    `;
  }

  private renderCharts(): TemplateResult {
    return html`
      <div style="display:flex;gap:6px;margin-bottom:14px">
        ${this.pill(this.gran === "hour", L("По часам", "Hourly"), () =>
          this.setGran("hour"),
        )}
        ${this.pill(this.gran === "day", L("По дням", "Daily"), () =>
          this.setGran("day"),
        )}
      </div>
      ${this.renderSummary()}
      ${this.loading
        ? html`<div
            class="t-skel"
            style="height:240px;border-radius:14px;margin-bottom:16px"
          ></div>`
        : html`
            ${this.chartCard(
              "online",
              L("Онлайн игроков", "Players online"),
              L(
                this.gran === "hour"
                  ? "Среднее за час · последние 7 дней"
                  : "Среднее за день · за всё время",
                this.gran === "hour"
                  ? "Hourly average · last 7 days"
                  : "Daily average · all time",
              ),
              "line",
              this.points.map((p) => p.online_avg),
              "var(--t-red,#a8432b)",
              L("игроков", "online"),
            )}
            ${this.chartCard(
              "games",
              L("Сыграно партий", "Games played"),
              L(
                this.gran === "hour"
                  ? "За час · последние 7 дней"
                  : "За день · за всё время",
                this.gran === "hour"
                  ? "Per hour · last 7 days"
                  : "Per day · all time",
              ),
              "bar",
              this.points.map((p) => p.games),
              "var(--t-ink,#2b2a24)",
              L("партий", "games"),
            )}
          `}
      ${this.loading ? "" : this.renderSources()}
      <div class="t-muted" style="font-size:12px;margin-top:6px">
        ${L(
          "История партий — за всё время. История онлайна копится с момента запуска счётчика, поэтому ранние периоды могут пустовать.",
          "Game history covers all time. Online history accrues from when tracking started, so early periods may be empty.",
        )}
      </div>
    `;
  }

  // ── вкладка «Активные игры» ───────────────────────────────────────────────
  private modeLabel(g: ActiveGame): string {
    const m = (g.gameMode ?? g.publicGameType ?? "").toLowerCase();
    if (m.includes("team")) return L("Команды", "Team");
    if (m.includes("ffa") || m.includes("free")) return L("ФФА", "FFA");
    return g.gameMode ?? g.publicGameType ?? L("Матч", "Match");
  }

  private elapsed(g: ActiveGame): string {
    const base = g.startTime ?? g.createdAt;
    const m = Math.max(0, Math.floor((this.serverTime - base) / 60000));
    if (m < 1) return L("только начался", "just started");
    if (m < 60) return L(`идёт ${m} мин`, `${m} min in`);
    const h = Math.floor(m / 60);
    return L(`идёт ${h} ч ${m % 60} мин`, `${h}h ${m % 60}m in`);
  }

  private renderGames(): TemplateResult {
    // Только матчи С ЖИВЫМИ игроками (авто-FFA с 0 людей = бот-циклы, это шум),
    // больше игроков — выше.
    const list = this.games
      .filter((g) => g.numClients > 0)
      .sort((a, b) => b.numClients - a.numClients);

    if (this.gamesLoading && this.games.length === 0) {
      return html`<div
        class="t-skel"
        style="height:120px;border-radius:14px"
      ></div>`;
    }
    // Распределение онлайна — показываем ВСЕГДА (в т.ч. когда матчей с людьми
    // нет: 9 онлайн могут сидеть в лобби/меню, а не в игре).
    const list_ =
      list.length === 0
        ? html`<div
            class="t-muted"
            style="text-align:center;padding:28px 0;font-size:13px"
          >
            ${L(
              "Сейчас матчей с игроками нет.",
              "No matches with players right now.",
            )}
          </div>`
        : html`
            <div class="t-muted" style="font-size:12px;margin-bottom:10px">
              ${L(
                "Идущие публичные матчи с игроками. «Смотреть» откроет игру — зайдёшь наблюдателем (спавн-фаза уже прошла, играть нельзя, только смотреть).",
                "Public matches with players in progress. “Watch” opens the game — you join as an observer (spawn phase is over, watch only).",
              )}
            </div>
            <div style="display:flex;flex-direction:column;gap:10px">
              ${list.map((g) => this.gameRow(g))}
            </div>
          `;
    return html`${this.renderBreakdown()}${list_}`;
  }

  private gameRow(g: ActiveGame): TemplateResult {
    const map = getMapName(g.gameMap) ?? g.gameMap ?? "—";
    return html`<div
      style="display:flex;align-items:center;gap:12px;background:var(--t-parchment,#fff);border:1px solid var(--t-line);border-radius:14px;padding:12px 14px"
    >
      <div style="flex:1;min-width:0">
        <div
          style="font-family:var(--t-display);font-weight:700;font-size:16px;color:var(--t-ink);line-height:1.15"
        >
          ${map} · ${this.modeLabel(g)}
        </div>
        <div
          class="t-muted"
          style="font-size:12px;margin-top:2px;font-family:var(--t-mono,monospace)"
        >
          ${this.elapsed(g)} ·
          ${L(`${g.numClients} игроков`, `${g.numClients} players`)}
        </div>
      </div>
      <a
        href="/game/${g.gameID}"
        style="flex:0 0 auto;text-decoration:none;background:var(--t-ink,#2b2a24);color:var(--t-parchment,#fff);font-family:var(--t-display);font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:8px 16px;font-size:14px"
        >${L("Смотреть", "Watch")}</a
      >
    </div>`;
  }

  /**
   * terron 19.08: «По источникам» — визиты по крупным каналам во времени.
   *
   * ⚠️ Это ВИЗИТЫ, а не онлайн: одновременных игроков по источникам мы не
   * храним (счётчик онлайна общий, без разреза). Каналы приходят уже
   * склеенными с бэкенда (channelOf): петридиш-баннеры двух размеров — один
   * канал, ya.ru и yandex.ru — тоже.
   */
  /**
   * terron 20.08: «Онлайн по источникам» — сколько человек СЕЙЧАС на сайте с
   * каждого канала, плюс история этого разреза.
   *
   * Данные берутся из пульса вкладок (Analytics.startOnlineHeartbeat): игровой
   * сервер знает онлайн, но не знает источник, источник знает только клиент.
   * ⚠️ Поэтому число здесь НЕ обязано совпадать с общим счётчиком онлайна: там
   * вебсокеты матчей, здесь — открытые вкладки, включая тех, кто сидит в меню.
   */
  /**
   * terron 20.08: «Онлайн по источникам» — ОДИН график с линией на канал, как
   * «Источники трафика» в Метрике (референс владельца), а не карточки с цифрами.
   *
   * Данные — из пульса вкладок (Analytics.startOnlineHeartbeat): игровой сервер
   * знает онлайн, но не знает источник, источник знает только клиент.
   * ⚠️ Число не обязано совпадать с общим счётчиком онлайна: там вебсокеты
   * матчей, здесь — открытые вкладки, включая тех, кто сидит в меню.
   */
  private renderSources(): TemplateResult {
    const byPlatform = this.srcDim === "platform";
    const live = byPlatform ? this.onlineByPlatform : this.onlineBySource;
    const series = (byPlatform ? this.platformHistory : this.sources).slice(
      0,
      8,
    );
    const label = (k: string) => (byPlatform ? this.platformLabel(k) : k);
    if (
      live.length === 0 &&
      series.length === 0 &&
      this.onlineBySource.length === 0 &&
      this.sources.length === 0
    ) {
      return html``;
    }
    const palette = [
      "#7b5cd6",
      "#e0457b",
      "#1fb98a",
      "#2f8fd8",
      "#e8a33d",
      "#a8432b",
      "#2b2a24",
      "#2f6f6f",
    ];
    const onlineOf = (src: string) =>
      live.find((r) => r.source === src)?.online ?? 0;
    const period = L(
      this.srcGran === "minute"
        ? "по 5 минут · 6 часов"
        : this.srcGran === "hour"
          ? "по часам · 7 дней"
          : "по дням · 90 дней",
      this.srcGran === "minute"
        ? "5 min · 6 hours"
        : this.srcGran === "hour"
          ? "hourly · 7 days"
          : "daily · 90 days",
    );
    const totalNow = live.reduce((a, b) => a + b.online, 0);
    return html`
      <div
        style="background:var(--t-parchment,#fff);border:1px solid var(--t-line);border-radius:14px;padding:14px;margin-bottom:16px"
      >
        <div
          style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px"
        >
          <div
            style="font-family:var(--t-display);font-weight:700;font-size:17px;letter-spacing:.02em;color:var(--t-ink)"
          >
            ${byPlatform
              ? L("Онлайн по платформам", "Online by platform")
              : L("Онлайн по источникам", "Online by source")}
          </div>
          <div
            class="t-muted"
            style="font-family:var(--t-mono,monospace);font-size:12px"
          >
            ${L("сейчас: ", "now: ")}${totalNow} · ${period}
          </div>
        </div>
        <div
          style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;align-items:center"
        >
          ${this.pill(!byPlatform, L("Источники", "Sources"), () =>
            this.setSrcDim("source"),
          )}
          ${this.pill(byPlatform, L("Платформы", "Platforms"), () =>
            this.setSrcDim("platform"),
          )}
          <span
            style="width:1px;height:20px;background:var(--t-line);margin:0 2px"
          ></span>
          ${this.pill(this.srcGran === "minute", L("Минуты", "Minutes"), () =>
            this.setSrcGran("minute"),
          )}
          ${this.pill(this.srcGran === "hour", L("Часы", "Hours"), () =>
            this.setSrcGran("hour"),
          )}
          ${this.pill(this.srcGran === "day", L("Дни", "Days"), () =>
            this.setSrcGran("day"),
          )}
        </div>
        ${series.length === 0
          ? html`<div class="t-muted" style="font-size:12px;padding:26px 0">
              ${L(
                "История ещё копится — линии появятся через несколько минут.",
                "History is still accruing — lines will appear in a few minutes.",
              )}
            </div>`
          : this.renderMultiChart(
              series.map((s, i) => ({
                name: label(s.source),
                color: palette[i % palette.length],
                points: s.points,
              })),
            )}
        <div
          style="display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:8px;align-items:center"
        >
          ${series.map(
            (s, i) => html`<span
              style="display:inline-flex;align-items:center;gap:6px;font-family:var(--t-mono,monospace);font-size:12px;color:var(--t-ink)"
            >
              <span
                style="width:9px;height:9px;border-radius:50%;background:${palette[
                  i % palette.length
                ]};display:inline-block"
              ></span>
              ${label(s.source)}
              <b style="font-family:var(--t-display);font-size:13px"
                >${onlineOf(s.source)}</b
              >
            </span>`,
          )}
        </div>
        <div class="t-muted" style="font-size:11.5px;margin-top:8px">
          ${L(
            "Считается по открытым вкладкам (источник знает только клиент), поэтому число может отличаться от общего счётчика онлайна.",
            "Counted from open tabs (only the client knows the source), so it may differ from the overall online counter.",
          )}
          ${byPlatform
            ? html`<br />${L(
                "«Апка» — подтверждённая нативная сборка (мост Capacitor или маркер входа). «WebView» — браузер внутри приложения: там же и наши апки старых версий, и чужие ин-апп браузеры. «неизвестно» — клиенты, которые пульсировали до 21.08.",
                "“App” means a confirmed native build (Capacitor bridge or entry marker). “WebView” is an in-app browser: both our older app installs and third-party in-app browsers land there. “unknown” are clients that reported before Aug 21.",
              )}`
            : ""}
        </div>
      </div>
    `;
  }

  /** Мультилинейный график: одна линия на канал, общая шкала Y. */
  private renderMultiChart(
    series: { name: string; color: string; points: number[] }[],
  ): TemplateResult {
    const n = series[0]?.points.length ?? 0;
    if (n === 0) return html``;
    const W = 1000;
    const H = 220;
    const ml = 34;
    const mr = 10;
    const mt = 12;
    const mb = 22;
    const plotW = W - ml - mr;
    const plotH = H - mt - mb;
    const x1 = ml + plotW;
    const y0 = mt + plotH;
    const max = Math.max(1, ...series.flatMap((s) => s.points));
    const xOf = (i: number) => ml + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
    const yOf = (v: number) => y0 - (v / max) * plotH;
    const grid = [0, 0.5, 1].map((k) => ({
      y: y0 - k * plotH,
      label: Math.round(max * k),
    }));
    return html`<svg
      viewBox="0 0 ${W} ${H}"
      style="width:100%;height:auto;display:block"
    >
      ${grid.map(
        (g) => svg`<line x1=${ml} y1=${g.y} x2=${x1} y2=${g.y}
          stroke="var(--t-line,#d8d2bd)" stroke-width="1" />
        <text x=${ml - 6} y=${g.y + 4} text-anchor="end"
          font-family="var(--t-mono,monospace)" font-size="11"
          fill="var(--t-ink-soft,rgba(43,42,36,.55))">${g.label}</text>`,
      )}
      ${series.map(
        (s) =>
          svg`<polyline fill="none" stroke=${s.color} stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"
            points=${s.points.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ")} />`,
      )}
    </svg>`;
  }

  private renderSummary(): TemplateResult {
    const onlineVals = this.points
      .map((p) => p.online_max)
      .filter((v): v is number => typeof v === "number");
    const peak = onlineVals.length ? Math.max(...onlineVals) : null;
    const totalGames = this.points.reduce((s, p) => s + (p.games || 0), 0);
    const periodLabel = L(
      this.gran === "hour" ? "за 7 дней" : "за всё время",
      this.gran === "hour" ? "in 7 days" : "all time",
    );
    const card = (value: string, label: string) =>
      html`<div
        style="flex:1;min-width:130px;background:var(--t-parchment,#fff);border:1px solid var(--t-line);border-radius:14px;padding:12px 14px"
      >
        <div
          style="font-family:var(--t-display);font-weight:700;font-size:26px;line-height:1.1;color:var(--t-ink)"
        >
          ${value}
        </div>
        <div class="t-muted" style="font-size:12px;margin-top:2px">
          ${label}
        </div>
      </div>`;
    return html`<div
      style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px"
    >
      ${card(
        this.onlineNow !== null ? String(this.onlineNow) : "—",
        L("Сейчас онлайн", "Online now"),
      )}
      ${card(
        peak !== null ? String(peak) : "—",
        L("Пик онлайна", "Peak online"),
      )}
      ${card(
        this.games24h !== null ? this.games24h.toLocaleString("ru-RU") : "—",
        L("Партий за 24 часа", "Games in 24 hours"),
      )}
      ${card(
        totalGames.toLocaleString("ru-RU"),
        L(`Партий ${periodLabel}`, `Games ${periodLabel}`),
      )}
    </div>`;
  }

  // ── SVG-график (бар/линия) в дизайне сайта ───────────────────────────────
  private chartCard(
    key: string,
    title: string,
    sub: string,
    kind: "bar" | "line",
    values: (number | null)[],
    color: string,
    unit: string,
  ): TemplateResult {
    const hov = this.hover?.key === key ? this.hover.i : -1;
    const hv = hov >= 0 ? values[hov] : null;
    const pt = hov >= 0 ? this.points[hov] : undefined;
    return html`<div
      style="background:var(--t-parchment,#fff);border:1px solid var(--t-line);border-radius:14px;padding:14px 14px 8px;margin-bottom:16px"
    >
      <div
        style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px"
      >
        <div
          style="font-family:var(--t-display);font-weight:700;font-size:17px;letter-spacing:.02em;color:var(--t-ink)"
        >
          ${title}
        </div>
        <div class="t-muted" style="font-size:12px">${sub}</div>
      </div>
      <div style="position:relative">
        ${this.renderChart(key, kind, values, color)}
        ${hov >= 0 && pt
          ? html`<div
              style="position:absolute;left:${this.hoverLeftPct(
                hov,
              )}%;top:4px;transform:translateX(-50%);pointer-events:none;z-index:2;background:var(--t-ink,#2b2a24);color:var(--t-parchment,#fff);font-family:var(--t-mono,monospace);font-size:11px;line-height:1.35;padding:4px 8px;border-radius:8px;white-space:nowrap;box-shadow:var(--t-shadow-sm)"
            >
              <b>${hv ?? "—"}</b> ${unit}<br /><span style="opacity:.65"
                >${this.fmtTs(pt.ts)}</span
              >
            </div>`
          : ""}
      </div>
    </div>`;
  }

  // курсор → индекс точки (viewBox 1000, plot ml=40, plotW=950)
  private onChartHover(e: MouseEvent, key: string, n: number): void {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    if (rect.width === 0 || n < 1) return;
    const frac = ((e.clientX - rect.left) / rect.width) * 1000;
    let i = Math.round(((frac - 40) / 950) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    if (this.hover?.key !== key || this.hover.i !== i) {
      this.hover = { key, i };
    }
  }

  private clearHover(key: string): void {
    if (this.hover?.key === key) this.hover = null;
  }

  private hoverLeftPct(i: number): number {
    const n = this.points.length;
    const x = 40 + (n > 1 ? (i * 950) / (n - 1) : 950 / 2);
    return Math.min(92, Math.max(8, (x / 1000) * 100));
  }

  private xLabels(n: number): { i: number; text: string }[] {
    if (n === 0) return [];
    const out: { i: number; text: string }[] = [];
    const ticks = Math.min(7, n);
    for (let t = 0; t < ticks; t++) {
      const i = Math.round((t * (n - 1)) / (ticks - 1 || 1));
      const p = this.points[i];
      if (!p) continue;
      const d = new Date(p.ts);
      const text =
        this.gran === "hour"
          ? `${String(d.getDate()).padStart(2, "0")}.${String(
              d.getMonth() + 1,
            ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`
          : `${String(d.getDate()).padStart(2, "0")}.${String(
              d.getMonth() + 1,
            ).padStart(2, "0")}`;
      out.push({ i, text });
    }
    return out;
  }

  private fmtTs(ts: string): string {
    const d = new Date(ts);
    const dm = `${String(d.getDate()).padStart(2, "0")}.${String(
      d.getMonth() + 1,
    ).padStart(2, "0")}`;
    return this.gran === "hour"
      ? `${dm} ${String(d.getHours()).padStart(2, "0")}:00`
      : dm;
  }

  private renderChart(
    key: string,
    kind: "bar" | "line",
    values: (number | null)[],
    color: string,
  ): TemplateResult {
    const n = values.length;
    const W = 1000;
    const H = 240;
    const ml = 40;
    const mr = 10;
    const mt = 12;
    const mb = 26;
    const plotW = W - ml - mr;
    const plotH = H - mt - mb;
    const x1 = ml + plotW;
    const y0 = mt + plotH;

    // линия без единой точки (онлайн ещё не насобирался) → честное «нет данных»
    const hasData = kind === "bar" || values.some((v) => v !== null);
    if (n === 0 || !hasData) {
      return html`<div
        class="t-muted"
        style="text-align:center;padding:40px 0;font-size:13px"
      >
        ${L("Нет данных за период.", "No data for this period.")}
      </div>`;
    }

    const maxV = Math.max(1, ...values.map((v) => v ?? 0));
    // «красивый» потолок оси
    const niceMax = this.niceCeil(maxV);
    const yOf = (v: number) => y0 - (v / niceMax) * plotH;
    const xOf = (i: number) =>
      ml + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));

    const gridYs = [0, 0.5, 1].map((f) => ({
      y: y0 - f * plotH,
      v: Math.round(niceMax * f),
    }));

    // terron: на часовом графике — очень тонкие вертикальные линии на границах
    // суток (точка 00:00 локального времени), чтобы видеть, где день сменился.
    const dayBounds: number[] = [];
    if (this.gran === "hour") {
      for (let i = 1; i < n; i++) {
        const p = this.points[i];
        if (p && new Date(p.ts).getHours() === 0) dayBounds.push(i);
      }
    }

    const body =
      kind === "bar"
        ? this.barShapes(values, n, ml, plotW, y0, yOf)
        : this.lineShapes(values, color, xOf, yOf, y0);

    // маркер под курсором (пунктир + точка) для этого графика
    const hov = this.hover?.key === key ? this.hover.i : -1;
    const hovV = hov >= 0 ? values[hov] : null;

    return html`<svg
      viewBox="0 0 ${W} ${H}"
      preserveAspectRatio="xMidYMid meet"
      style="width:100%;height:auto;display:block;font-family:var(--t-mono,monospace);touch-action:none"
      role="img"
      @mousemove=${(e: MouseEvent) => this.onChartHover(e, key, n)}
      @mouseleave=${() => this.clearHover(key)}
    >
      ${gridYs.map(
        (g) => svg`<line x1=${ml} y1=${g.y} x2=${x1} y2=${g.y}
          stroke="var(--t-line)" stroke-width="1" />
        <text x=${ml - 6} y=${g.y + 3} text-anchor="end"
          font-size="11" fill="var(--t-ink-soft,#6b6a62)">${g.v}</text>`,
      )}
      ${dayBounds.map(
        (i) => svg`<line x1=${xOf(i)} y1=${mt} x2=${xOf(i)} y2=${y0}
          stroke="var(--t-ink,#2b2a24)" stroke-width="0.75" opacity="0.14" />`,
      )}
      ${body}
      ${this.xLabels(n).map(
        (l) => svg`<text x=${xOf(l.i)} y=${H - 8} text-anchor="middle"
          font-size="11" fill="var(--t-ink-soft,#6b6a62)">${l.text}</text>`,
      )}
      ${hov >= 0
        ? svg`<line x1=${xOf(hov)} y1=${mt} x2=${xOf(hov)} y2=${y0}
            stroke=${color} stroke-width="1" stroke-dasharray="3 3" opacity="0.5" />
          ${
            hovV !== null
              ? svg`<circle cx=${xOf(hov)} cy=${yOf(hovV)} r="3.5" fill=${color} />`
              : ""
          }`
        : ""}
    </svg>`;
  }

  private barShapes(
    values: (number | null)[],
    n: number,
    ml: number,
    plotW: number,
    y0: number,
    yOf: (v: number) => number,
  ): TemplateResult[] {
    const slot = plotW / n;
    const bw = Math.max(1, Math.min(slot * 0.7, 22));
    return values.map((v, i) => {
      const val = v ?? 0;
      const x = ml + i * slot + (slot - bw) / 2;
      const y = yOf(val);
      const h = Math.max(val > 0 ? 1 : 0, y0 - y);
      return svg`<rect x=${x} y=${y} width=${bw} height=${h} rx="2"
        fill="var(--t-ink,#2b2a24)" opacity=${val > 0 ? 0.85 : 0}>
        <title>${this.fmtTs(this.points[i].ts)} · ${val}</title>
      </rect>`;
    });
  }

  private lineShapes(
    values: (number | null)[],
    color: string,
    xOf: (i: number) => number,
    yOf: (v: number) => number,
    y0: number,
  ): TemplateResult[] {
    // разбиваем на сегменты по пропускам (null) — линия не «провисает» в 0
    const segs: { i: number; v: number }[][] = [];
    let cur: { i: number; v: number }[] = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (cur.length) segs.push(cur);
        cur = [];
      } else cur.push({ i, v });
    });
    if (cur.length) segs.push(cur);

    const out: TemplateResult[] = [];
    for (const seg of segs) {
      if (seg.length === 1) {
        out.push(
          svg`<circle cx=${xOf(seg[0].i)} cy=${yOf(seg[0].v)} r="2.5"
            fill=${color} />`,
        );
        continue;
      }
      const d = seg
        .map((p, k) => `${k === 0 ? "M" : "L"}${xOf(p.i)},${yOf(p.v)}`)
        .join(" ");
      const area =
        `M${xOf(seg[0].i)},${y0} ` +
        seg.map((p) => `L${xOf(p.i)},${yOf(p.v)}`).join(" ") +
        ` L${xOf(seg[seg.length - 1].i)},${y0} Z`;
      out.push(
        svg`<path d=${area} fill=${color} opacity="0.10" />
          <path d=${d} fill="none" stroke=${color} stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round" />`,
      );
    }
    // невидимые хит-точки с подсказкой (значение при наведении)
    values.forEach((v, i) => {
      if (v === null) return;
      out.push(
        svg`<circle cx=${xOf(i)} cy=${yOf(v)} r="6" fill="transparent">
          <title>${this.fmtTs(this.points[i].ts)} · ${v}</title>
        </circle>`,
      );
    });
    return out;
  }

  private niceCeil(v: number): number {
    if (v <= 5) return 5;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  }
}

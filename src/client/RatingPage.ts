import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Difficulty } from "../core/game/Game";
import {
  getMyExcludedSpeedruns,
  getRatingLeaderboard,
  getSpeedrunEpochs,
  getSpeedrunLeaderboard,
  getTestersLeaderboard,
  type BalanceEpoch,
  type ExcludedRun,
  type RatingRow,
  type SpeedrunRow,
  type TesterRow,
} from "./Api";
import { isLoggedIn } from "./Auth";
import { avatarFallback, avatarSrc } from "./Avatar";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { uiIcon } from "./components/ui/UiIcon";
import { getReferralLeaderboard, type RefLeaderRow } from "./Referral";
import { softGo } from "./SoftNavigate";
import { L, translateText } from "./Utils";

const SPEEDRUN_DIFFICULTIES: Difficulty[] = [
  Difficulty.Easy,
  Difficulty.Medium,
  Difficulty.Hard,
  Difficulty.Impossible,
];
// Перевод МАШИННЫХ кодов отказа из platform-api (speedrunConfigViolations).
// Формат кода: `ключ` или `ключ=значение`. Бэкенд намеренно шлёт коды, а не
// готовый текст — база языка английская, RU идёт оверлеем (см. multilang.md).
const VIOLATION_LABEL = (code: string): string => {
  const eq = code.indexOf("=");
  const key = eq === -1 ? code : code.slice(0, eq);
  const raw = eq === -1 ? "" : code.slice(eq + 1);
  // «1000000000» глазами не читается — бьём на разряды (ru: пробел, en: запятая).
  // Не-числа (nations=disabled, pgm=isCompact) оставляем как есть.
  const val = /^\d+$/.test(raw)
    ? Number(raw).toLocaleString(L("ru-RU", "en-US"))
    : raw;
  switch (key) {
    case "bots":
      return L(`ботов ${val} вместо 400`, `${val} bots instead of 400`);
    case "nations":
      return L(`нации: ${val}`, `nations: ${val}`);
    case "hostCheats":
      return L("включены читы хоста", "host cheats enabled");
    case "startingGold":
    case "pgmstartingGold":
      return L(`стартовое золото ${val}`, `starting gold ${val}`);
    case "goldMultiplier":
    case "pgmgoldMultiplier":
      return L(`множитель золота ×${val}`, `gold multiplier ×${val}`);
    case "infiniteGold":
      return L("бесконечное золото", "infinite gold");
    case "infiniteTroops":
      return L("бесконечные войска", "infinite troops");
    case "instantBuild":
      return L("мгновенная стройка", "instant build");
    case "disabledUnits":
      return L(`отключено юнитов: ${val}`, `${val} unit type(s) disabled`);
    case "spawnImmunity": {
      // ВАЖНО: считаем по raw, а не по val — val уже разбит на разряды
      // («3 000»), и Number() от него вернёт NaN.
      const sec = Math.round(Number(raw) / 10);
      return L(
        `иммунитет спавна ${sec}с вместо 5с`,
        `spawn immunity ${sec}s instead of 5s`,
      );
    }
    case "donations":
      return L("включены донаты", "donations enabled");
    case "randomSpawn":
      return L("случайный спавн", "random spawn");
    case "fogOfWar":
      return L("туман войны", "fog of war");
    case "alliancesOff":
      return L("альянсы выключены", "alliances disabled");
    case "waterNukes":
      return L("ядерки по воде", "water nukes");
    case "navMeshOff":
      return L("navmesh выключен", "navmesh disabled");
    case "matchTimer":
      return L(`таймер матча ${val} мин`, `match timer ${val} min`);
    case "mapSize":
      return L(`размер карты ${val}`, `map size ${val}`);
    case "map":
      return L(`карта ${val}`, `map ${val}`);
    case "mode":
      return L(`режим ${val}`, `mode ${val}`);
    case "singleplayer":
      return L("одиночная игра", "singleplayer");
    case "pgm":
      return L(`модификатор лобби ${val}`, `lobby modifier ${val}`);
    case "noConfig":
      return L("конфиг матча не сохранён", "match config not stored");
    default:
      return code; // новый код с бэкенда — показываем как есть, не молчим
  }
};

// terron: ЭПОХИ БАЛАНСА спидрана. Метка приходит с бэкенда английской (её
// проставил игровой сервер, TERRON_BALANCE_LABEL) — RU кладём оверлеем, как
// требует multilang.md. Незнакомая метка показывается как есть; нет метки —
// «#N». Новая эпоха → добавить сюда русскую строку.
const EPOCH_RU: Record<string, string> = {
  Ultimates: "Ультимейты",
  Capitals: "Столицы",
};
const EPOCH_NAME = (e: { epoch: number; label: string | null }): string => {
  if (!e.label) return `#${e.epoch}`;
  return L(EPOCH_RU[e.label] ?? e.label, e.label);
};
const EPOCH_TITLE = (e: {
  epoch: number;
  label: string | null;
  runs: number;
  current: boolean;
}): string => {
  const name = EPOCH_NAME(e);
  return e.current
    ? L(
        `Актуальные правила (${name}) · забегов: ${e.runs}`,
        `Current ruleset (${name}) · runs: ${e.runs}`,
      )
    : L(
        `Прежние правила (${name}) · забегов: ${e.runs}`,
        `Former ruleset (${name}) · runs: ${e.runs}`,
      );
};

const DIFFICULTY_LABEL = (d: Difficulty): string =>
  d === Difficulty.Easy
    ? L("Лёгкая", "Easy")
    : d === Difficulty.Medium
      ? L("Средняя", "Medium")
      : d === Difficulty.Hard
        ? L("Сложная", "Hard")
        : L("Невозможная", "Impossible");

/**
 * /rating (алиас /ffa-rating) — наши таблицы лидеров (заменяют движковый
 * leaderboard-modal). Две вкладки:
 *  - «Рейтинги» — ФФА ПВП рейтинг, сорт по рейтингу;
 *  - «Игроки» — все с ≥10 матчей, сорт по числу матчей, с винрейтом.
 * Гейт ≥10 матчей — на стороне API. См. RATING.md.
 */
/**
 * ХЭНДЛ ДЛЯ ССЫЛКИ НА ДОСЬЕ. terron 26.08 (репорт владельца «переход на игроков
 * отвалился»): списки строили `/@` + сырой `slug`, а слага нет у большинства
 * аккаунтов (264 из 425 на 26.08) — выходило `/@null`, досье отвечало 404.
 * Сервер теперь отдаёт `handle` (слаг ИЛИ номер, `publicHandleOf`), а здесь —
 * единственное место, которое решает «ссылка вообще возможна?».
 * ⚠️ `slug` в фолбэке — ради старого API, если бандл окажется свежее сервера.
 */
function profileHandle(row: {
  handle?: string | null;
  slug?: string | null;
}): string | null {
  const h = row.handle ?? row.slug ?? null;
  return h && h !== "null" && h !== "nations" ? h : null;
}

@customElement("rating-page")
export class RatingPage extends BaseModal {
  protected routerName = "leaderboard"; // переиспользуем слот/роут лидерборда

  @state() private rows: RatingRow[] = [];
  @state() private refRows: RefLeaderRow[] = [];
  @state() private loading = true;
  // terron: сортировка по клику на заголовок (рейтинг/матчи/винрейт), тоггл ▼/▲.
  @state() private sortKey: "rating" | "matches" | "winrate" | null = null;
  @state() private sortDir: "asc" | "desc" = "desc";
  // terron спидран: выбранная категория (сложность × соло/несколько) + строки.
  @state() private srDifficulty: Difficulty = Difficulty.Easy;
  @state() private srSolo = true;
  @state() private srRows: SpeedrunRow[] = [];
  @state() private excludedRows: ExcludedRun[] = [];
  @state() private srLoading = false;
  // terron: эпохи баланса. srEpoch = что показываем (null = актуальная, её
  // номер придёт в srEpochs). Рекорд сравним только с рекордом на тех же
  // правилах — при бампе баланса старый топ уезжает в «Архив».
  @state() private srEpochs: BalanceEpoch[] = [];
  @state() private srEpoch: number | null = null;
  // terron: мобильное меню строки спидрана (клик по нику → профиль/смотреть).
  @state() private srMenuIdx: number | null = null;
  // terron: рейтинг тестировщиков (минуты на дев-сервере). Ленивая загрузка.
  @state() private testerRows: TesterRow[] = [];
  @state() private testersLoading = false;
  private testersLoaded = false;
  // Тач-устройство → меню по клику на ник; десктоп → кнопка «смотреть» в ряду.
  private readonly srCoarse: boolean =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(pointer: coarse)").matches ?? false);
  private sortBy(key: "rating" | "matches" | "winrate") {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === "desc" ? "asc" : "desc";
    } else {
      this.sortKey = key;
      this.sortDir = "desc";
    }
  }
  private sortArrow(key: string) {
    if (this.sortKey !== key) return "";
    return this.sortDir === "desc" ? " ▼" : " ▲";
  }

  protected modalConfig() {
    return {
      tabs: [
        // terron: вкладки «Рейтинги» и «Игроки» убраны по просьбе юзера —
        // «Рейтинги» дублировал PvP, а «Игроки» (сорт по числу матчей) почти
        // бесполезен. Теперь PvP показывает ПОЛНЫЙ рейтинг-вид (колонка рейтинга,
        // сорт по рейтингу) — см. isRatings в renderBody. Код вкладок оставлен
        // закомментированным на случай возврата.
        // { key: "ratings", label: translateText("rating_page.tab_ratings") },
        // { key: "players", label: translateText("rating_page.tab_players") },
        { key: "pvp", label: "PvP" },
        { key: "pve", label: "PvE" },
        { key: "speedrun", label: L("Спидран", "Speedrun") },
        { key: "testers", label: L("Тестеры", "Testers") },
        { key: "invites", label: translateText("rating_page.tab_invites") },
      ],
    };
  }

  private srLoaded = false;
  // Ленивая загрузка спидрана при первом открытии вкладки.
  public setActiveTab(key: string): void {
    super.setActiveTab(key);
    if (key === "speedrun" && !this.srLoaded) {
      this.srLoaded = true;
      void this.loadSpeedrun();
      void this.loadSpeedrunEpochs();
      void this.loadExcluded();
    }
    if (key === "testers" && !this.testersLoaded) {
      this.testersLoaded = true;
      void this.loadTesters();
    }
  }

  // terron: загрузка рейтинга тестировщиков (минуты на дев-сервере).
  private async loadTesters(): Promise<void> {
    this.testersLoading = true;
    this.requestUpdate();
    this.testerRows = await getTestersLeaderboard();
    this.testersLoading = false;
    this.requestUpdate();
  }

  // terron: часы/минуты из секунд для рейтинга тестировщиков.
  private fmtDuration(sec: number): string {
    const totalMin = Math.floor(sec / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return L(`${h} ч ${m} мин`, `${h}h ${m}m`);
    return L(`${m} мин`, `${m}m`);
  }

  // terron: вкладка «Тестеры» — таблица наигранного на дев-сервере времени.
  private renderTesters(): TemplateResult {
    if (this.testersLoading) {
      return html`<div class="t-muted" style="text-align:center;padding:24px">
        ${translateText("rating_page.loading")}
      </div>`;
    }
    return html`
      <div
        class="t-muted"
        style="font-size:12px;padding:2px 8px 12px;line-height:1.4"
      >
        ${L(
          "Наигранное время на дев-сервере (dev.terron.io). 1 час → звание «Тестер», 10 часов → «Главный тестер». Считается только у залогиненных.",
          "Time played on the dev server (dev.terron.io). 1 hour → the «Tester» title, 10 hours → «Chief Tester». Counts for signed-in players only.",
        )}
      </div>
      ${this.testerRows.length === 0
        ? html`<div class="t-muted" style="text-align:center;padding:24px">
            ${L("Пока никто не тестировал.", "No testers yet.")}
          </div>`
        : html`<div style="overflow-x:auto">
            <table
              class="w-full border-collapse text-sm"
              style="color:var(--t-ink)"
            >
              <thead>
                <tr
                  class="t-muted"
                  style="text-align:left;border-bottom:1px solid var(--t-line,#0002)"
                >
                  <th style="padding:6px 8px;width:2.5rem">#</th>
                  <th style="padding:6px 8px">
                    ${translateText("rating_page.col_player")}
                  </th>
                  <th style="padding:6px 8px;text-align:right">
                    ${L("На дев-сервере", "On dev server")}
                  </th>
                </tr>
              </thead>
              <tbody>
                ${this.testerRows.map(
                  (row, i) =>
                    html`<tr
                      style="border-bottom:1px solid var(--t-line,#0001)"
                    >
                      <td style="padding:6px 8px">${i + 1}</td>
                      <td style="padding:6px 8px">
                        ${profileHandle(row)
                          ? html`${this.av(
                                profileHandle(row),
                                row.username,
                                20,
                                row.hasAvatar,
                              )}<a
                                href="/@${profileHandle(row)}"
                                style="color:inherit;text-decoration:none"
                                >${row.username ||
                                `@${profileHandle(row)}`}</a
                              >`
                          : row.username || "—"}
                      </td>
                      <td
                        style="padding:6px 8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums"
                      >
                        ${this.fmtDuration(row.seconds)}
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </div>`}
    `;
  }

  // «Мои исключённые матчи» — только для залогиненных; аноним раздела не видит.
  // Список не зависит от выбранной категории (это ЛИЧНАЯ история), поэтому
  // грузится один раз при открытии вкладки, а не на каждый переключатель.
  private async loadExcluded(): Promise<void> {
    if (!(await isLoggedIn())) return;
    this.excludedRows = await getMyExcludedSpeedruns();
    this.requestUpdate();
  }

  // terron: загрузка лидерборда спидрана по выбранной категории.
  private async loadSpeedrun(): Promise<void> {
    this.srLoading = true;
    this.srMenuIdx = null;
    this.requestUpdate();
    this.srRows = await getSpeedrunLeaderboard(
      this.srDifficulty,
      this.srSolo,
      this.srEpoch ?? undefined,
    );
    this.srLoading = false;
    this.requestUpdate();
  }

  // Список эпох грузим один раз вместе с первой таблицей. Пока их меньше двух,
  // переключатель не рисуем — делить нечего.
  private async loadSpeedrunEpochs(): Promise<void> {
    this.srEpochs = await getSpeedrunEpochs();
    this.requestUpdate();
  }

  private setSrDifficulty(d: Difficulty) {
    if (this.srDifficulty === d) return;
    this.srDifficulty = d;
    void this.loadSpeedrun();
  }
  private setSrSolo(solo: boolean) {
    if (this.srSolo === solo) return;
    this.srSolo = solo;
    void this.loadSpeedrun();
  }
  private setSrEpoch(epoch: number | null) {
    if (this.srEpoch === epoch) return;
    this.srEpoch = epoch;
    void this.loadSpeedrun();
  }

  // «Создать лобби» — только залогиненным. Открываем хост-лобби с пресетом
  // (карта Мира + выбранная сложность + стандарт); юзер выбирает приват/паблик.
  private async createSpeedrunLobby() {
    if (!(await isLoggedIn())) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: L(
              "Войдите в аккаунт, чтобы создать спидран-лобби",
              "Sign in to create a speedrun lobby",
            ),
            color: "red",
            duration: 3500,
          },
        }),
      );
      return;
    }
    this.close();
    window.dispatchEvent(
      new CustomEvent("terron-open-speedrun-lobby", {
        detail: { difficulty: this.srDifficulty },
      }),
    );
  }

  private fmtTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("rating_page.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected onOpen(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.requestUpdate();
    [this.rows, this.refRows] = await Promise.all([
      getRatingLeaderboard(),
      getReferralLeaderboard(),
    ]);
    this.loading = false;
    this.requestUpdate();
  }

  // terron: подсказка «как попасть в инвайт-топ» → ведёт в блок приглашений
  // своего досье (таб «Приглашения»), где реф-ссылка и правила начисления.
  private renderInviteHint(): TemplateResult {
    return html`<div
      style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;padding:10px 12px;border:1px solid var(--t-line,#0002);border-radius:8px;background:var(--t-sheet,#fff);color:var(--t-ink)"
    >
      <span style="flex:1;min-width:180px;font-size:13px">
        ${L(
          "Приглашай друзей своей ссылкой — как только приглашённый выиграет матч, ты попадёшь в топ.",
          "Invite friends with your link — once an invitee wins a match, you enter the top.",
        )}
      </span>
      <button
        class="t-btn"
        style="padding:5px 12px;font-size:13px;white-space:nowrap"
        @click=${() => this.openMyInvites()}
      >
        ${L("Моя ссылка приглашения →", "My invite link →")}
      </button>
    </div>`;
  }

  private openMyInvites(): void {
    try {
      sessionStorage.setItem("terron_profile_tab", "invites");
    } catch {
      /* ignore */
    }
    softGo("/@me");
  }

  // terron: лидерборд по приглашениям (друзей, выигравших ≥1 матч).
  private renderInvites(): TemplateResult {
    if (this.refRows.length === 0) {
      return html`<div>
        ${this.renderInviteHint()}
        <div class="t-muted" style="text-align:center;padding:24px">
          ${translateText("rating_page.no_invites")}
        </div>
      </div>`;
    }
    return html`
      ${this.renderInviteHint()}
      <div style="overflow-x:auto">
        <table
          class="w-full border-collapse text-sm"
          style="color:var(--t-ink)"
        >
          <thead>
            <tr
              class="t-muted"
              style="text-align:left;border-bottom:1px solid var(--t-line,#0002)"
            >
              <th style="padding:6px 8px;width:2.5rem">#</th>
              <th style="padding:6px 8px">
                ${translateText("rating_page.col_player")}
              </th>
              <th style="padding:6px 8px;text-align:right">
                ${translateText("rating_page.col_invited")}
              </th>
            </tr>
          </thead>
          <tbody>
            ${this.refRows.map(
              (row, i) =>
                html`<tr style="border-bottom:1px solid var(--t-line,#0001)">
                  <td style="padding:6px 8px">${i + 1}</td>
                  <td style="padding:6px 8px">
                    ${this.av(
                      row.slug,
                      row.username,
                      20,
                      row.hasAvatar,
                    )}${row.username || `@${row.slug}`}
                  </td>
                  <td style="padding:6px 8px;text-align:right;font-weight:700">
                    ${row.invited}
                  </td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  // terron: аватарка в топах. Кастомную API в выдачах топов не отдаёт → рисуем
  /**
   * Ник игрока в строке списка: аватарка + ссылка на досье. ⚠️ Ссылка рисуется
   * ТОЛЬКО когда есть хэндл — у аккаунта без слага и без номера досье просто
   * не существует, и `/@null` уводил в 404 (репорт 26.08).
   */
  private playerName(row: {
    handle?: string | null;
    slug?: string | null;
    name: string;
    hasAvatar?: boolean;
  }) {
    const h = profileHandle(row);
    return html`${this.av(h, row.name, 22, row.hasAvatar)}${this.nameLink(
      h,
      row.name,
    )}`;
  }

  /** Ник ссылкой (есть хэндл) или обычным текстом (досье нет). */
  private nameLink(handle: string | null, name: string) {
    return handle
      ? html`<a
          href=${"/@" + handle}
          style="color:var(--t-ink);text-decoration:none;font-weight:700"
          >${name}</a
        >`
      : html`<span style="font-weight:700">${name}</span>`;
  }

  // дефолтный пиксель-портрет по seed (тот же seed, что в досье — slug).
  // Пока API не отдаёт users.avatar в топах, у нарисовавших свой портрет тут
  // будет сгенерированный — см. avatar.md, «топы».
  // ⚠️ display:inline-block обязателен — Tailwind-preflight делает img блочным,
  // иначе ник уезжает под аватарку. seed: slug, а у безслаговых — ник.
  // terron: аватарка в строке таблицы. `hasAvatar` приходит из API списка —
  // при нём берём КАРТИНКУ игрока (Avatar.customAvatarUrl, кешируется
  // браузером), иначе рисуем базовый портрет по seed. Сами data-URL в списках
  // не гоняем: сотня строк весила бы сотни килобайт.
  private av(
    slug: string | null | undefined,
    name?: string | null,
    size = 22,
    hasAvatar?: boolean,
  ): TemplateResult | string {
    const seed = slug ?? name;
    if (!seed || slug === "nations") return "";
    return html`<img
      src=${avatarSrc({ seed, size, slug, hasAvatar })}
      alt=""
      @error=${avatarFallback(seed, size)}
      style="width:${size}px;height:${size}px;border-radius:5px;margin-right:6px;
             display:inline-block;vertical-align:-6px;border:1px solid rgba(0,0,0,.15)"
    />`;
  }

  private fmtRating(r: number): string {
    return r.toFixed(2).replace(/\.00$/, "");
  }

  // terron: вкладка «Спидран» — выбор категории (сложность × соло/несколько),
  // кнопка создания стандартного лобби и таблица лучших времён.
  private renderSpeedrun(): TemplateResult {
    const seg = (active: boolean) =>
      "padding:5px 11px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;border:1px solid var(--t-line,#0002);" +
      (active
        ? "background:var(--t-ink);color:var(--t-parchment,#fff)"
        : "background:transparent;color:var(--t-ink)");
    return html`
      <div
        class="t-muted"
        style="font-size:12px;padding:2px 8px 10px;line-height:1.4"
      >
        ${L(
          "Лучшее время «спавн→победа» на карте Мира. Только онлайн-лобби (приват/паблик), стандартные настройки, для залогиненных. Офлайн не считается.",
          "Best spawn→victory time on the World map. Online lobbies only (private/public), standard settings, signed-in players. Offline doesn't count.",
        )}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 8px 8px">
        ${SPEEDRUN_DIFFICULTIES.map(
          (d) =>
            html`<button
              style=${seg(this.srDifficulty === d)}
              @click=${() => this.setSrDifficulty(d)}
            >
              ${DIFFICULTY_LABEL(d)}
            </button>`,
        )}
      </div>
      ${this.renderDifficultyInfo()}
      <div style="display:flex;gap:6px;padding:0 8px 10px">
        <button style=${seg(this.srSolo)} @click=${() => this.setSrSolo(true)}>
          ${L("Соло", "Solo")}
        </button>
        <button
          style=${seg(!this.srSolo)}
          @click=${() => this.setSrSolo(false)}
        >
          ${L("Несколько", "Multiplayer")}
        </button>
      </div>
      <div style="padding:0 8px 12px">
        <button
          @click=${() => this.createSpeedrunLobby()}
          style="width:100%;padding:11px;border:none;border-radius:10px;background:var(--t-accent,#a8432b);color:#fff;font-weight:800;cursor:pointer"
        >
          ${L("Создать лобби", "Create lobby")} ·
          ${DIFFICULTY_LABEL(this.srDifficulty)}
        </button>
      </div>
      ${this.renderEpochSwitch()} ${this.renderSpeedrunTable()}
      ${this.renderExcluded()}
    `;
  }

  // «Мои исключённые матчи»: победы на World FFA, не попавшие в топ, с причиной.
  // Раньше отказ был молчаливым — игрок выигрывал и просто не находил себя.
  // Раздел личный: аноним и игрок без отказов его не видят вовсе.
  private renderExcluded(): TemplateResult {
    if (this.excludedRows.length === 0) return html``;
    return html`
      <div style="margin-top:18px;border-top:1px solid var(--t-line,#0002)">
        <div
          style="padding:12px 8px 4px;font-weight:800;font-size:14px;color:var(--t-ink)"
        >
          ${L("Мои исключённые матчи", "My excluded matches")}
        </div>
        <div
          class="t-muted"
          style="font-size:12px;padding:0 8px 10px;line-height:1.4"
        >
          ${L(
            "Победы на карте Мира, не попавшие в топ: настройки лобби отличались от базовых.",
            "Wins on the World map that didn't make the leaderboard — lobby settings differed from the standard ones.",
          )}
        </div>
        <div style="overflow-x:auto">
          <table
            class="w-full border-collapse text-sm"
            style="color:var(--t-ink)"
          >
            <tbody>
              ${this.excludedRows.map(
                (r) => html`
                  <tr style="border-top:1px solid var(--t-line,#0002)">
                    <td style="padding:7px 8px;white-space:nowrap">
                      <div style="font-weight:700">
                        ${this.fmtTime(r.durationSeconds)}
                      </div>
                      <div class="t-muted" style="font-size:11px">
                        ${DIFFICULTY_LABEL(r.difficulty as Difficulty)} ·
                        ${r.solo ? L("соло", "solo") : L("неск.", "multi")}
                      </div>
                    </td>
                    <td style="padding:7px 8px;width:100%">
                      <div
                        style="display:flex;flex-wrap:wrap;gap:4px;align-items:center"
                      >
                        ${r.reasons.map(
                          (c) =>
                            html`<span
                              style="display:inline-block;padding:2px 7px;border:1px solid var(--t-line,#0003);font-size:11px;background:var(--t-parchment,#fff)"
                              >${VIOLATION_LABEL(c)}</span
                            >`,
                        )}
                      </div>
                    </td>
                    <td style="padding:7px 8px;text-align:right">
                      <a
                        href="/game/${r.gameId}"
                        class="t-muted"
                        style="font-size:11px;text-decoration:underline"
                        >${L("матч", "match")}</a
                      >
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // terron: чем реально отличаются сложности (факты из core Config.ts:
  // startManpower / maxTroops / troopIncreaseRate для наций). Мелкие племена-
  // боты от сложности НЕ зависят — сложность крутит именно НАЦИИ.
  private renderDifficultyInfo(): TemplateResult {
    const row = (label: string, start: string, cap: string, rate: string) =>
      html`<tr style="border-bottom:1px solid var(--t-line,#0001)">
        <td style="padding:4px 8px;font-weight:700">${label}</td>
        <td style="padding:4px 8px;text-align:right">${start}</td>
        <td style="padding:4px 8px;text-align:right">${cap}</td>
        <td style="padding:4px 8px;text-align:right">${rate}</td>
      </tr>`;
    return html`<details style="margin:0 8px 10px">
      <summary
        class="t-muted"
        style="cursor:pointer;font-size:12px;user-select:none"
      >
        ${L(
          "Чем отличаются сложности ботов?",
          "What do bot difficulties change?",
        )}
      </summary>
      <div
        style="margin-top:8px;background:var(--t-sheet,#f6f0dd);border:1px solid var(--t-line,#0002);border-radius:10px;padding:10px 8px;font-size:12px;color:var(--t-ink)"
      >
        <div style="margin:0 8px 8px;line-height:1.45">
          ${L(
            "Сложность влияет на НАЦИИ (крупные ИИ-государства с флагами). Мелкие серые племена всегда одинаковые: стартуют с 10 000 войск, копят вдвое медленнее и держат втрое меньший потолок армии.",
            "Difficulty affects NATIONS (large AI states with flags). Small grey tribes are always the same: they start with 10,000 troops, grow half as fast and cap at a third of the army size.",
          )}
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;min-width:340px">
            <thead>
              <tr
                class="t-muted"
                style="text-align:right;border-bottom:1px solid var(--t-line,#0002)"
              >
                <th style="padding:4px 8px;text-align:left">
                  ${L("Нации", "Nations")}
                </th>
                <th style="padding:4px 8px">
                  ${L("Старт. войска", "Start troops")}
                </th>
                <th style="padding:4px 8px">
                  ${L("Потолок армии", "Army cap")}
                </th>
                <th style="padding:4px 8px">${L("Прирост", "Growth")}</th>
              </tr>
            </thead>
            <tbody>
              ${row(L("Лёгкая", "Easy"), "12 500", "50%", "×0.9")}
              ${row(L("Средняя", "Medium"), "18 750", "75%", "×0.95")}
              ${row(
                L("Сложная", "Hard"),
                L("25 000 (как игрок)", "25,000 (like you)"),
                "100%",
                "×1.0",
              )}
              ${row(L("Невозможная", "Impossible"), "31 250", "125%", "×1.05")}
            </tbody>
          </table>
        </div>
        <div class="t-muted" style="margin:8px 8px 0;line-height:1.45">
          ${L(
            "Потолок и прирост — относительно игрока-человека при той же территории. На «невозможной» нации стартуют с большей армией, чем ты, растут быстрее и держат армию на четверть больше твоей.",
            "Cap and growth are relative to a human player with the same territory. On Impossible, nations start with a bigger army than yours, grow faster and cap 25% higher.",
          )}
        </div>
      </div>
    </details>`;
  }

  // terron: значок «играл пальцем». Основной сигнал — inputMode: клиент весь
  // матч считает pointerdown по канвасу (client/InputMode.ts), это честнее
  // User-Agent, который переключается в браузере в два клика. UA (device)
  // остался ФОЛБЭКОМ для строк без сигнала — там подпись слабее («по данным
  // браузера»). «Смешанно» (был и палец, и мышь) значка не получает — мышь
  // у человека была. Десктопу значка нет: иконка в каждой строке = шум.
  private deviceBadge(row: SpeedrunRow): TemplateResult | string {
    const uaTouch = row.device === "mobile" || row.device === "tablet";
    if (row.inputMode !== "touch" && !(row.inputMode == null && uaTouch)) {
      return "";
    }
    const title =
      row.inputMode === "touch"
        ? L("Забег с сенсорного экрана", "Run played on a touchscreen")
        : row.device === "tablet"
          ? L(
              "Забег с планшета (по данным браузера)",
              "Run on a tablet (per browser data)",
            )
          : L(
              "Забег с телефона (по данным браузера)",
              "Run on a phone (per browser data)",
            );
    return html`<span
      title=${title}
      aria-label=${title}
      style="margin-left:6px;font-size:12px;opacity:${row.inputMode === "touch"
        ? ".85"
        : ".5"}"
      >📱</span
    >`;
  }

  // Переключатель эпох баланса. Появляется, только когда эпох больше одной:
  // до первого бампа делить нечего.
  private renderEpochSwitch(): TemplateResult | string {
    if (this.srEpochs.length < 2) return "";
    const current = this.srEpochs.find((e) => e.current);
    const seg = (active: boolean) =>
      "padding:4px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;border:1px solid var(--t-line,#0002);" +
      (active
        ? "background:var(--t-ink);color:var(--t-parchment,#fff)"
        : "background:transparent;color:var(--t-ink)");
    const shown = this.srEpoch ?? current?.epoch ?? null;
    const viewingArchive = shown !== null && shown !== current?.epoch;
    return html`
      <div
        style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:0 8px 8px"
      >
        <span class="t-muted" style="font-size:12px"
          >${L("Правила:", "Ruleset:")}</span
        >
        ${this.srEpochs.map(
          (e) =>
            html`<button
              style=${seg(shown === e.epoch)}
              @click=${() => this.setSrEpoch(e.current ? null : e.epoch)}
              title=${EPOCH_TITLE(e)}
            >
              ${e.current
                ? L("Актуальные", "Current")
                : L("Архив · ", "Archive · ") + EPOCH_NAME(e)}
            </button>`,
        )}
      </div>
      ${viewingArchive
        ? html`<div
            class="t-muted"
            style="font-size:12px;padding:0 8px 10px;line-height:1.4"
          >
            ${L(
              "Архивный топ: с тех пор баланс менялся, эти времена несравнимы с актуальными.",
              "Archived leaderboard: the balance has changed since, so these times aren't comparable to current ones.",
            )}
          </div>`
        : ""}
    `;
  }

  private renderSpeedrunTable(): TemplateResult {
    if (this.srLoading) {
      return html`<div class="t-muted" style="text-align:center;padding:24px">
        ${translateText("rating_page.loading")}
      </div>`;
    }
    if (this.srRows.length === 0) {
      return html`<div class="t-muted" style="text-align:center;padding:24px">
        ${L(
          "Пока нет рекордов в этой категории",
          "No records in this category yet",
        )}
      </div>`;
    }
    return html`<div style="overflow-x:auto">
      <table class="w-full border-collapse text-sm" style="color:var(--t-ink)">
        <thead>
          <tr
            class="t-muted"
            style="text-align:left;border-bottom:1px solid var(--t-line,#0002)"
          >
            <th style="padding:6px 8px;width:2.5rem">#</th>
            <th style="padding:6px 8px">
              ${translateText("rating_page.col_player")}
            </th>
            <th style="padding:6px 8px;text-align:right">
              ${L("Время", "Time")}
            </th>
            <th style="padding:6px 8px;text-align:right">
              ${L("Забеги", "Runs")}
            </th>
            ${this.srCoarse
              ? ""
              : html`<th style="padding:6px 8px;width:6.5rem"></th>`}
          </tr>
        </thead>
        <tbody>
          ${this.srRows.map((row, i) => {
            const place = i + 1;
            const medalColor =
              place === 1
                ? "#F2B705"
                : place === 2
                  ? "#B7C0CC"
                  : place === 3
                    ? "#CD7F32"
                    : "";
            // terron: «смотреть» = реплей матча, давшего лучшее время.
            // Если реплей недоступен (старый матч без turns) — кнопки нет.
            const watchHref =
              row.hasReplay && row.gameId ? `/game/${row.gameId}` : null;
            const menuOpen = this.srCoarse && this.srMenuIdx === i;
            return html`<tr
              style="border-bottom:1px solid var(--t-line,#0001);${place % 2 ===
              0
                ? "background:rgba(0,0,0,.03)"
                : ""}"
            >
              <td
                style="padding:8px;text-align:center;font-weight:700;${medalColor
                  ? `color:${medalColor}`
                  : "color:var(--t-muted,#888)"}"
              >
                ${place}
              </td>
              <td style="padding:8px">
                ${this.av(
                  profileHandle(row),
                  row.name,
                  22,
                  row.hasAvatar,
                )}${this.srCoarse && watchHref
                  ? html`<button
                        style="background:none;border:none;padding:0;color:var(--t-ink);font-weight:700;font-size:inherit;font-family:inherit;cursor:pointer;text-align:left"
                        @click=${() => {
                          this.srMenuIdx = menuOpen ? null : i;
                        }}
                      >
                        ${row.name} <span style="opacity:.45">▾</span>
                      </button>
                      ${menuOpen
                        ? html`<div style="display:flex;gap:6px;margin-top:6px">
                            ${profileHandle(row)
                              ? html`<a
                                  href=${"/@" + profileHandle(row)}
                                  style="text-decoration:none;font-size:12px;font-weight:700;padding:4px 10px;border:1px solid var(--t-line,#0002);border-radius:8px;color:var(--t-ink);background:var(--t-sheet,#f6f0dd)"
                                  >${L("Профиль", "Profile")}</a
                                >`
                              : ""}
                            <a
                              href=${watchHref}
                              style="text-decoration:none;font-size:12px;font-weight:700;padding:4px 10px;border-radius:8px;color:var(--t-parchment,#fff);background:var(--t-ink,#2b2a24)"
                              >${L("Смотреть матч", "Watch match")}</a
                            >
                          </div>`
                        : ""}`
                  : this.nameLink(
                      profileHandle(row),
                      row.name,
                    )}${this.deviceBadge(row)}
              </td>
              <td
                style="padding:8px;text-align:right;font-weight:800;font-variant-numeric:tabular-nums"
              >
                ${this.fmtTime(row.best)}
              </td>
              <td
                style="padding:8px;text-align:right;font-variant-numeric:tabular-nums"
              >
                ${row.runs}
              </td>
              ${this.srCoarse
                ? ""
                : html`<td style="padding:8px;text-align:right">
                    ${watchHref
                      ? html`<a
                          href=${watchHref}
                          title=${L(
                            "Посмотреть реплей лучшего забега",
                            "Watch the best run replay",
                          )}
                          style="text-decoration:none;font-size:12px;font-weight:700;padding:4px 10px;border-radius:8px;color:var(--t-parchment,#fff);background:var(--t-ink,#2b2a24);white-space:nowrap"
                          >${L("Смотреть", "Watch")}</a
                        >`
                      : ""}
                  </td>`}
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
  }

  // terron: однострочное описание под каждой вкладкой — что именно ранжирует
  // (юзеры жаловались, что вкладок много и неясно, чем отличаются).
  private tabDesc(tab: string): TemplateResult {
    const txt =
      tab === "ratings"
        ? L(
            "Соревновательный рейтинг FFA (старт 1500): +за съедение крупных, −за смерть. Игроки с 10+ матчами против людей.",
            "Competitive FFA rating (starts at 1500): + for eating big players, − for dying. Players with 10+ matches vs humans.",
          )
        : tab === "players"
          ? L(
              "Самые активные: сортировка по числу сыгранных матчей. Все игроки с 10+ матчами.",
              "Most active: ranked by matches played. All players with 10+ matches.",
            )
          : tab === "pvp"
            ? L(
                "Соревновательный рейтинг FFA (старт 1500): +за съедение крупных, −за смерть. Винрейт против реальных игроков. Игроки с 10+ PvP-матчами.",
                "Competitive FFA rating (starts at 1500): + for eating big players, − for dying. Win rate vs real players. Players with 10+ PvP matches.",
              )
            : tab === "pve"
              ? L(
                  "Винрейт против ботов (10+ PvE-матчей).",
                  "Win rate vs bots (10+ PvE matches).",
                )
              : L(
                  "Кто привёл больше друзей, выигравших хотя бы один матч.",
                  "Who invited the most friends that won at least one match.",
                );
    return html`<div
      class="t-muted"
      style="font-size:12px;padding:2px 8px 10px;line-height:1.4"
    >
      ${txt}
    </div>`;
  }

  protected renderBody(tab: string): TemplateResult {
    if (tab === "speedrun") return this.renderSpeedrun();
    if (tab === "testers") return this.renderTesters();
    if (this.loading) {
      return html`<div class="t-muted" style="text-align:center;padding:24px">
        ${translateText("rating_page.loading")}
      </div>`;
    }
    if (tab === "invites")
      return html`${this.tabDesc("invites")}${this.renderInvites()}`;
    if (this.rows.length === 0) {
      return html`<div class="t-muted" style="text-align:center;padding:24px">
        ${translateText("rating_page.empty_min10")}
      </div>`;
    }

    // terron: PvP теперь показывает ПОЛНЫЙ рейтинг-вид (колонка рейтинга, сорт
    // по рейтингу), как раньше делала убранная вкладка «Рейтинги». Колонки
    // матчей/винрейта остаются PvP-специфичными (pick() ниже).
    const isRatings = tab === "ratings" || tab === "pvp";
    // какие матчи/винрейт показывать в этой вкладке
    const pick = (r: RatingRow) =>
      tab === "pvp"
        ? { m: r.pvpMatches, wr: r.pvpWinRate }
        : tab === "pve"
          ? { m: r.pveMatches, wr: r.pveWinRate }
          : { m: r.matches, wr: r.winRate };

    // Гейт ≥10 матчей В РЕЖИМЕ: PvE — 10+ против ботов, PvP — 10+ с игроками.
    // Рейтинг (FFA) тоже про игроков → ≥10 PvP. Игроки — ≥10 всего (из запроса).
    let rows = [...this.rows];
    if (tab === "pvp" || tab === "ratings")
      rows = rows.filter((r) => r.pvpMatches >= 10);
    if (tab === "pve") rows = rows.filter((r) => r.pveMatches >= 10);
    const key = this.sortKey ?? (isRatings ? "rating" : "matches");
    const dir = this.sortKey ? this.sortDir : "desc";
    const val = (r: RatingRow) =>
      key === "rating" ? r.rating : key === "winrate" ? pick(r).wr : pick(r).m;
    rows.sort((a, b) => (dir === "desc" ? val(b) - val(a) : val(a) - val(b)));

    if (rows.length === 0) {
      return html`<div class="t-muted" style="text-align:center;padding:24px">
        ${tab === "pvp"
          ? translateText("rating_page.no_pvp")
          : translateText("rating_page.empty")}
      </div>`;
    }

    return html`
      ${this.tabDesc(tab)}
      <div style="overflow-x:auto">
        <table
          class="w-full border-collapse text-sm"
          style="color:var(--t-ink)"
        >
          <thead>
            <tr
              class="t-muted"
              style="text-align:left;border-bottom:1px solid var(--t-line,#0002)"
            >
              <th style="padding:6px 8px;width:2.5rem">#</th>
              <th style="padding:6px 8px">
                ${translateText("rating_page.col_player")}
              </th>
              ${isRatings
                ? html`<th
                    style="padding:6px 8px;text-align:right;cursor:pointer;user-select:none"
                    @click=${() => this.sortBy("rating")}
                  >
                    ${translateText("rating_page.col_rating")}${this.sortArrow(
                      "rating",
                    )}
                  </th>`
                : ""}
              <th
                style="padding:6px 8px;text-align:right;cursor:pointer;user-select:none"
                @click=${() => this.sortBy("matches")}
              >
                ${translateText("rating_page.col_matches")}${this.sortArrow(
                  "matches",
                )}
              </th>
              <th
                style="padding:6px 8px;text-align:right;cursor:pointer;user-select:none"
                @click=${() => this.sortBy("winrate")}
              >
                ${translateText("rating_page.col_winrate")}${this.sortArrow(
                  "winrate",
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, i) => {
              const d = pick(row);
              return this.renderRow(row, i + 1, isRatings, d.m, d.wr);
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderRow(
    row: RatingRow,
    place: number,
    isRatings: boolean,
    matches: number,
    winRate: number,
  ) {
    const isNations = row.slug === "nations";
    // медаль цветом ранга: золото/серебро/бронза (иконка одинаковая, цвет — смысл)
    const medalColor =
      place === 1
        ? "#F2B705"
        : place === 2
          ? "#B7C0CC"
          : place === 3
            ? "#CD7F32"
            : "";
    const medal = medalColor
      ? html`<span style="color:${medalColor};display:inline-flex"
          >${uiIcon("medal", 18)}</span
        >`
      : null;
    const name = isNations
      ? html`<span
          style="font-weight:700;display:inline-flex;align-items:center;gap:5px"
          >${uiIcon("robot", 15)} ${L("Нации", "Nations")}</span
        >`
      : this.playerName(row);
    const wr = Math.round(winRate * 100);
    const wrColor = wr >= 60 ? "#2e7d32" : wr >= 35 ? "#9a7d0a" : "#b23b3b";
    return html`
      <tr
        style="border-bottom:1px solid var(--t-line,#0001);${place % 2 === 0
          ? "background:rgba(0,0,0,.03)"
          : ""}"
      >
        <td
          style="padding:8px;text-align:center;font-weight:700;${medal
            ? "font-size:16px"
            : "color:var(--t-muted,#888)"}"
        >
          ${medal ?? place}
        </td>
        <td style="padding:8px">${name}</td>
        ${isRatings
          ? html`<td
              style="padding:8px;text-align:right;font-weight:800;font-variant-numeric:tabular-nums"
            >
              ${this.fmtRating(row.rating)}
            </td>`
          : ""}
        <td
          style="padding:8px;text-align:right;font-variant-numeric:tabular-nums"
        >
          ${matches}
        </td>
        <td
          style="padding:8px;text-align:right;font-weight:700;color:${wrColor};font-variant-numeric:tabular-nums"
        >
          ${wr}%
        </td>
      </tr>
    `;
  }
}

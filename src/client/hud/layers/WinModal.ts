import { html, LitElement, svg, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  getMapName,
  L,
  plural,
  renderNumber,
  translateText,
} from "../../../client/Utils";
import { assetUrl } from "../../../core/AssetUrls";
import { eventRewardOf } from "../../../core/configuration/TerronTuning";
import { EventBus } from "../../../core/EventBus";
import {
  GameMapType,
  GameType,
  PlayerType,
  RankedType,
} from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { trackMatchOutcome } from "../../Analytics";
import {
  doubleMatchReward,
  getMatchReward,
  getSpeedrunLeaderboard,
  type MatchReward,
} from "../../Api";
import { isLoggedIn, hadSessionBefore } from "../../Auth";
import "../../components/Difficulties";
import { coin } from "../../components/ui/coin";
import { statIcon } from "../../components/ui/statIcons";
import { Controller } from "../../Controller";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { GamePushSDK } from "../../GamePushSDK";
import { softHome } from "../../SoftNavigate";
import { isMuted, setMutedByUser } from "../../sound/AudioBus";
import {
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
} from "../../sound/Sounds";
import { toast } from "../../Toast";
import { PlayerDiedEvent, SendWinnerEvent } from "../../Transport";
import {
  launchTutorial,
  markRealWin,
  shouldShowTutorialEntry,
  tutorialButton,
} from "../../Tutorial";

// terron: кровавый алмаз (ПТС) — награда за победу в золотом матче.
const bloodDiamondIcon = assetUrl("images/BloodDiamondIcon.svg");

@customElement("win-modal")
export class WinModal extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  private hasShownDeathModal = false;

  // terron 29.07: ЗАРАБОТОК ЗА МАТЧ на экране итогов (победа/смерть/выход) +
  // кнопка «×2 за рекламу». Цифры приходят С СЕРВЕРА (леджер) — клиент их не
  // считает. ⚠️ Начисление происходит при АРХИВЕ матча, а он доезжает не мгновенно,
  // поэтому опрашиваем с ретраями (см. loadMatchReward).
  @state() private reward: MatchReward | null = null;
  @state() private rewardBusy = false;
  private rewardLoadedFor: string | null = null;

  // terron: пики за матч (для модалки смерти — текущее у мёртвого = 0, бесполезно).
  private aliveTicks = 0; // 10 тиков/сек → выживание = aliveTicks/10
  private maxTroops = 0;
  private maxGold = 0n;
  private maxTiles = 0;

  @state()
  isVisible = false;

  @state()
  showButtons = false;

  // terron: окно открыто по ESC живым игроком (пауза) — кнопка «Продолжить»
  // вместо «Наблюдать», заголовок «Пауза».
  @state()
  private pauseMode = false;
  /** terron 01.08: окно открыто как МЕНЮ по ESC (а не экран итогов матча).
   *  Ползунки звука раньше гейтились на pauseMode — а он false, пока игрок не
   *  заспавнился или уже погиб: жмёшь ESC в спавн-фазе, а настроек звука нет
   *  (репорт владельца). Меню = настройки есть всегда. */
  private menuMode = false;
  private userSettings = new UserSettings();

  @state()
  private isWin = false;

  // terron: позиция в спидране (карта Мир, победа) — «(#N)» у времени. null = н/д.
  @state()
  private _speedrunRank: number | null = null;

  // terron: прогресс count-up статов на экране победы (0→1). См. render()/show().
  @state()
  private celebrateProgress = 1;

  // terron: это экран СМЕРТИ (не пауза/победа) — гейтит оффер обучения.
  @state()
  private isDeath = false;

  @state()
  private isRankedGame = false;

  // terron: mute (ESC-меню) хранится в UserSettings (settings.musicMuted/…) —
  // персистит между сессиями; позиция ползунка громкости сохраняется отдельно.

  private _title: string;

  private rand = Math.random();

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
  }

  // terron 30.07: СЧЁТ СЪЕДЕННЫХ ПО ХОДУ МАТЧА. Полная статистика
  // (`allPlayersStats`) приезжает клиенту только вместе с концом партии, а
  // награду мы теперь начисляем сразу после гибели — значит цифры нужны раньше.
  // Считаем сами по событиям завоевания: они приходят каждый тик.
  private eatenNations = 0;
  private eatenPlayers = 0;
  private trackConquests(): void {
    const me = this.game?.myPlayer();
    if (!me) return;
    const updates = this.game.updatesSinceLastTick();
    if (updates === null) return;
    for (const c of updates[GameUpdateType.ConquestEvent] ?? []) {
      if (c.conquerorId !== me.id()) continue;
      const victim = this.game.player(c.conqueredId);
      // Племена (Bot) в награду не идут — их едят десятками за матч.
      if (victim.type() === PlayerType.Nation) this.eatenNations++;
      else if (victim.type() === PlayerType.Human) this.eatenPlayers++;
    }
  }

  // terron 30.07: МАКСИМАЛЬНАЯ ДОЛЯ МИРА за матч. Сначала показывали лучшую
  // ПОЗИЦИЮ, но она вырождалась в «#1» у каждого: игрок спавнится
  // прямоугольником (~45 тайлов), а нации и племена начинают с одного — в
  // первые секунды первым оказывается кто угодно (репорт владельца: «почему я
  // номер первый, я вообще не развивался»). Доля от суши такого изъяна не
  // имеет: 0.4% честно читается как 0.4%.
  private maxWorldPct = 0;
  private updateWorldShare(me: PlayerView): void {
    if (this.aliveTicks % 10 !== 0) return;
    const land = this.game.numLandTiles();
    if (land <= 0) return;
    const pct = (me.numTilesOwned() / land) * 100;
    if (pct > this.maxWorldPct) this.maxWorldPct = pct;
  }

  /** Доля мира с адекватной точностью. Один знак (как в лидерборде) для
   *  начинающего бесполезен: 47 тайлов на большой карте — это «0.0%», то есть
   *  ноль вместо результата. Поэтому знаков ровно столько, сколько нужно
   *  величине: «23%», «4.2%», «0.35%», «<0.01%». */
  private worldPctLabel(): string {
    const p = this.maxWorldPct;
    if (p <= 0) return "0%";
    if (p >= 10) return `${Math.round(p)}%`;
    if (p >= 1) return `${p.toFixed(1)}%`;
    if (p >= 0.01) return `${p.toFixed(2)}%`;
    return "<0.01%";
  }

  // копим пики и время выживания, пока локальный игрок жив (вызывается из tick()).
  private trackPeaks(): void {
    const me = this.game?.myPlayer();
    if (!me || !me.isAlive() || !me.hasSpawned()) return;
    this.aliveTicks++;
    this.updateWorldShare(me);
    const t = Math.round(me.troops());
    if (t > this.maxTroops) this.maxTroops = t;
    const g = me.gold();
    if (g > this.maxGold) this.maxGold = g;
    const tiles = me.numTilesOwned();
    if (tiles > this.maxTiles) this.maxTiles = tiles;
  }

  // terron: событийный матч (системное лобби по расписанию с наградой). Флаг
  // едет в конфиге матча — ставит его только мастер публичному лобби.
  private isGoldenMatch(): boolean {
    return this.game?.config()?.gameConfig()?.golden === true;
  }

  /** terron: алмазный матч — событие раз в сутки, награда на порядок больше. */
  private isDiamondMatch(): boolean {
    return (
      this.isGoldenMatch() &&
      this.game?.config()?.gameConfig()?.eventTier === "diamond"
    );
  }

  // terron: победитель БЕЗ АККАУНТА. Алмазы ему всё равно откладываются (сервер
  // держит их по persistentID браузера, см. миграцию 058), но забрать их можно
  // только заведя аккаунт — об этом и говорим прямо на экране победы. null =
  // ещё не проверили.
  @state()
  private _loggedIn: boolean | null = null;

  private async checkLoginForGoldenPrize(): Promise<void> {
    if (!this.isWin || !this.isGoldenMatch()) return;
    try {
      this._loggedIn = await isLoggedIn();
    } catch {
      this._loggedIn = null;
    }
  }

  /** id матча берём из адреса — в матче он всегда `/game/<id>`. */
  private currentGameId(): string | null {
    const m = /^\/game\/([A-Za-z0-9_-]+)/.exec(window.location.pathname);
    return m?.[1] ?? null;
  }

  /**
   * Подтянуть заработок за матч. Награду начисляет API на АРХИВЕ матча, а он
   * приходит с игрового сервера через секунду-другую после конца — поэтому
   * опрашиваем несколько раз, пока не увидим ненулевой результат.
   * Гостям (не залогинен) ничего не показываем: начислять некому.
   */
  private async loadMatchReward(): Promise<void> {
    const gameId = this.currentGameId();
    if (!gameId || this.rewardLoadedFor === gameId) return;
    this.rewardLoadedFor = gameId;
    if (!(await isLoggedIn().catch(() => false))) {
      // Без сессии награду не спросить. Датчик заводился ради ОДНОГО случая:
      // кука не доехала в iframe площадки, и залогиненный игрок остался без
      // заработка. Но срабатывал он у ЛЮБОГО незалогиненного, а гостей
      // большинство — настоящий сигнал в них тонул (83 события в сутки, и по
      // ним нельзя было сказать, сколько из них баг).
      //
      // terron ТЕЛЕМЕТРИЯ (08.08): рапортуем ТОЛЬКО когда у браузера КОГДА-ТО
      // была сессия. Гость без аккаунта — это норма, а не сбой: начислять ему
      // нечего и незачем тратить на него бюджет событий (он ограничен).
      if (hadSessionBefore()) {
        void import("../../Health").then(({ reportHealth }) =>
          reportHealth("reward_no_session", gameId, { hadSession: true }),
        );
      }
      return;
    }
    // ⚠️ Награда появляется в API только на АРХИВЕ матча. Победителю это секунды,
    // а СЪЕДЕННОМУ в середине — сколько ещё продлится чужая партия: он сидит на
    // экране смерти с пустым местом там, где обещан заработок. Поэтому сначала
    // частые попытки (обычный конец матча), потом редкие — пока игрок смотрит.
    const delays = [0, 1500, 2000, 2500, 3000, 4000];
    const SLOW_MS = 10_000;
    // terron: было 6 минут = до ~36 запросов на матч у каждого, кому награда
    // честно не положена (капы/дев/ноль за матч) — API не отличает «архив ещё
    // не пришёл» от «архив был, начислять нечего». 90с покрывает нормальный
    // лаг архива с запасом (секунды); дольше — почти всегда именно ноль.
    const DEADLINE_MS = 90_000;
    const started = Date.now();
    for (let attempt = 0; Date.now() - started < DEADLINE_MS; attempt++) {
      const r = await getMatchReward(gameId);
      // Держим даже НУЛЕВОЙ ответ: из него виден `doublePending` — посмотрел ли
      // игрок рекламу до начисления. Иначе после просмотра кнопка вернулась бы.
      if (r) {
        this.reward = r;
        this.requestUpdate();
        if (r.lts > 0 || r.pts > 0) return;
        // Оба суточных потолка выбраны → ответ ОКОНЧАТЕЛЬНЫЙ: начислять больше
        // нечего ни в одной валюте, дальнейший опрос не изменит ничего.
        if (
          (r.dailyLtsCap ?? 0) > 0 &&
          (r.dailyLts ?? 0) >= (r.dailyLtsCap ?? 0) &&
          (r.dailyPtsCap ?? 0) > 0 &&
          (r.dailyPts ?? 0) >= (r.dailyPtsCap ?? 0)
        ) {
          return;
        }
      }
      if (!this.isVisible) return; // окно закрыли — перестаём дёргать API
      await new Promise((res) => setTimeout(res, delays[attempt] ?? SLOW_MS));
    }
    // Опрос выдохся, а награды так и нет — сигнал в телеметрию: либо начисление
    // не доехало, либо матч не дал ничего. Разбираться по цифрам, не по памяти.
    void import("../../Health").then(({ reportHealth }) =>
      reportHealth("reward_missing", gameId),
    );
  }

  /** «×2» — показать rewarded и, если площадка подтвердила просмотр, удвоить. */
  private async onDoubleReward(): Promise<void> {
    const gameId = this.currentGameId();
    if (!gameId || this.rewardBusy) return;
    this.rewardBusy = true;
    this.requestUpdate();
    try {
      const watched = await GamePushSDK.showRewardedAd();
      if (!watched) {
        // Ролик закрыли раньше времени — молчать нельзя, иначе выглядит как
        // будто кнопка не сработала.
        toast(
          L(
            "Ролик не досмотрен — награда не удвоена",
            "Ad wasn't finished — reward not doubled",
          ),
          "info",
        );
        return;
      }
      const updated = await doubleMatchReward(gameId);
      if (!updated) {
        toast(
          L("Не удалось удвоить награду", "Couldn't double the reward"),
          "error",
        );
        return;
      }
      this.reward = updated;
      // Говорим ИТОГ, а не прибавку: игрок смотрел ролик ради конкретной суммы —
      // пусть видит, сколько у него стало (просьба владельца 30.07).
      const lts = updated.lts + updated.doubledLts;
      const pts = updated.pts + updated.doubledPts;
      const parts: string[] = [];
      if (lts > 0)
        parts.push(
          `${lts} ${plural(lts, "бумага", "бумаги", "бумаг", "securities")}`,
        );
      if (pts > 0)
        parts.push(
          `${pts} ${plural(pts, "алмаз", "алмаза", "алмазов", "diamonds")}`,
        );
      toast(
        `${L("Награда удвоена", "Reward doubled")}: ${parts.join(" · ")}`,
        "success",
      );
    } finally {
      this.rewardBusy = false;
      this.requestUpdate();
    }
  }

  /**
   * Плашка «сколько заработал» на экране итогов. Показывается при ЛЮБОМ исходе
   * (победа, смерть, выход) — раньше игрок вообще не видел, что ему что-то
   * начислили. Кнопка «×2» рисуется, только если сервер разрешил удвоение
   * (`canDouble`) и площадка реально может показать rewarded.
   */
  private renderMatchReward() {
    const r = this.reward;
    // Цифры ТОЛЬКО с сервера: считать награду на клиенте нельзя. Ждать конца
    // матча больше не нужно — гибель игрока сама начисляет заработок
    // (GameServer «death» → POST /game/:id/death), поэтому сумма приезжает
    // через секунду после смерти и оговорки «начислим потом» не требуется.
    // Награды нет. Чаще всего это не сбой, а выбранный дневной лимит — молча
    // прятать плашку нельзя, игрок решит, что его обсчитали (репорт владельца
    // 30.07: «и где предложение рекламу посмотреть?» при 150/150 за сутки).
    if (!r || (r.lts <= 0 && r.pts <= 0)) {
      const capped =
        r !== null &&
        r.dailyLtsCap !== undefined &&
        (r.dailyLts ?? 0) >= r.dailyLtsCap;
      if (!capped) return null;
      return html`
        <div class="reward-row">
          <div class="reward-tile">
            <div class="reward-lbl">
              ${L("Дневной лимит выбран", "Daily limit reached")} —
              ${r.dailyLts}/${r.dailyLtsCap} ${coin("lts", 14)}
            </div>
          </div>
        </div>
      `;
    }
    const totalLts = r.lts + r.doubledLts;
    const totalPts = r.pts + r.doubledPts;
    const doubled = r.doubledLts > 0 || r.doubledPts > 0;
    // Ролик посмотрели раньше начисления (редкий случай: обрыв связи в момент
    // смерти) — удвоение применится вместе с наградой, повторно не предлагаем.
    const doublePending = r.doublePending === true;
    const canDouble =
      r.canDouble && !doublePending && GamePushSDK.isRewardedAvailable();
    // Иконка ролика вместо надписи «×2 за рекламу»: подпись занимала всю
    // ширину кнопки, а сама кнопка ушла ВБОК от суммы (решение владельца 30.07).
    const adIcon = html`<svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M10 9 L15 12 L10 15 Z" fill="currentColor" />
    </svg>`;
    return html`
      <div class="reward-row">
        <div class="reward-tile">
          <div class="reward-sum">
            ${totalLts > 0 ? html`${totalLts} ${coin("lts", 22)}` : null}
            ${totalPts > 0 ? html`${totalPts} ${coin("pts", 22)}` : null}
          </div>
          <div class="reward-lbl">
            ${doubled
              ? L("Заработок ×2", "Earned ×2")
              : doublePending
                ? L("Заработок · ×2 засчитано", "Earned · ×2 counted")
                : L("Заработок", "Earned")}
          </div>
        </div>
        ${canDouble
          ? html`<button
              class="reward-x2"
              ?disabled=${this.rewardBusy}
              title=${L("Удвоить за просмотр рекламы", "Double it for an ad")}
              @click=${() => void this.onDoubleReward()}
            >
              ${this.rewardBusy ? L("…", "…") : html`×2 ${adIcon}`}
            </button>`
          : null}
      </div>
    `;
  }

  private survivedLabel(): string {
    const s = Math.floor(this.aliveTicks / 10);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  // terron: ранг в спидране (карта Мир, победа). Ранг = сколько времён строго
  // быстрее моего + 1 (лидерборд по возрастанию `best`, сек). Best-effort; при
  // ошибке/не-Мир/не-победе — null (не показываем «#»).
  private async maybeFetchSpeedrunRank(): Promise<void> {
    this._speedrunRank = null;
    try {
      if (!this.isWin) return;
      const cfg = this.game?.config()?.gameConfig();
      if (cfg?.gameMap !== GameMapType.World) return;
      const diff = String(cfg.difficulty ?? "");
      const solo = cfg.gameType === GameType.Singleplayer;
      const rows = await getSpeedrunLeaderboard(diff, solo);
      if (rows.length === 0) return;
      const mySec = Math.floor(this.aliveTicks / 10);
      const better = rows.filter((r) => r.best < mySec).length;
      this._speedrunRank = better + 1;
      this.requestUpdate();
    } catch {
      this._speedrunRank = null;
    }
  }

  render() {
    if (!this.isVisible) return html``;
    const mapName =
      getMapName(this.game?.config()?.gameConfig()?.gameMap) ?? "";
    // terron: ключ сложности → скуллы (тот же <difficulty-display>, что в лобби).
    const difficultyKey = String(
      this.game?.config()?.gameConfig()?.difficulty ?? "",
    );
    // ПИКИ за матч (не текущее — у мёртвого ноль). Пауза живым тоже видит пики.
    const troops = this.maxTroops;
    const gold = this.maxGold;
    const tiles = this.maxTiles;
    // count-up статов при победе (0→1 за ~1.2с) — «казино»-накрутка чисел.
    const cp = this.isWin ? this.celebrateProgress : 1;
    // меню по ESC (жив) — «Продолжить»; погиб/конец — «Наблюдать»
    const resume = this.pauseMode;

    const iconHome = html`<svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
    >
      <path d="M3 11 L12 3 L21 11" />
      <path d="M5 10 V20 H19 V10" />
      <path d="M10 20 V14 H14 V20" />
    </svg>`;
    const iconEye = html`<svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
    >
      <path d="M2 12 C5 6 19 6 22 12 C19 18 5 18 2 12 Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>`;
    const iconPlay = html`<svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
    >
      <path d="M7 5 L19 12 L7 19 Z" />
    </svg>`;
    // белый флаг — «Покинуть» (живой матч = сдаться/уйти)
    const iconFlag = html`<svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M5 22 V3" />
      <path d="M5 4 C9 1.5 13 6 17.5 3.5 L17.5 13 C13 15.5 9 11 5 13.5" />
    </svg>`;
    // «Покинуть» (флаг) — ТОЛЬКО когда матч идёт и открыто меню по ESC (живой
    // бой бросаем). Победа/смерть/конец игры → «На главную» (домик).
    const leaveIcon = this.pauseMode ? iconFlag : iconHome;
    const leaveLabel = this.pauseMode
      ? translateText("win_modal.leave")
      : translateText("win_modal.to_home");

    return html`
      <style>
        .pause-ov {
          position: fixed;
          inset: 0;
          z-index: 10010;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(2, 4, 12, 0.55);
          backdrop-filter: blur(3px);
        }
        .pause-card {
          width: min(92vw, 440px);
          font-family: "Golos Text", system-ui, sans-serif;
          color: #fff;
          background: rgba(17, 24, 39, 0.96);
          border: 1px solid rgba(212, 175, 55, 0.4);
          border-radius: 14px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
          padding: 22px 22px 18px;
          text-align: center;
        }
        .pause-card h2 {
          margin: 0;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: 0.01em;
        }
        .pause-map {
          margin-top: 4px;
          font-size: 13px;
          color: #d4af37;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }
        .pause-stats {
          display: flex;
          gap: 10px;
          margin: 18px 0;
        }
        .pause-stat {
          flex: 1;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          padding: 12px 8px;
        }
        .pause-stat .v {
          font-size: 20px;
          font-weight: 800;
          line-height: 1;
        }
        .pause-stat .l {
          font-size: 11px;
          opacity: 0.6;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-top: 6px;
        }
        /* подпись под позицией — обычным текстом, не капсом (это «45K тайлов») */
        .pause-stat .l.sub {
          text-transform: none;
          letter-spacing: 0;
          font-size: 11.5px;
        }
        /* Награда: сумма крупно по центру, кнопка ×2 узкой колонкой справа. */
        .reward-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          margin: 0 0 14px;
        }
        .reward-tile {
          background: rgba(212, 175, 55, 0.13);
          border: 1px solid rgba(212, 175, 55, 0.34);
          border-radius: 10px;
          padding: 12px 8px;
          text-align: center;
        }
        .reward-sum {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 26px;
          font-weight: 800;
          line-height: 1;
          color: #f7dd8a;
          font-variant-numeric: tabular-nums;
        }
        .reward-lbl {
          font-size: 11px;
          opacity: 0.65;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-top: 7px;
        }
        .reward-x2 {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          min-width: 76px;
          padding: 0 14px;
          border: 0;
          border-radius: 10px;
          background: #d4af37;
          color: #241f10;
          font-weight: 800;
          font-size: 16px;
          cursor: pointer;
        }
        .reward-x2:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .hdr-sep {
          opacity: 0.5;
        }
        .hdr-time {
          color: #e9e7df;
          font-variant-numeric: tabular-nums;
        }
        .pause-vol {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin: 0 0 16px;
        }
        .pause-vol-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .pause-vol-ic {
          width: 20px;
          text-align: center;
          font-size: 15px;
        }
        .pause-vol-row input[type="range"] {
          flex: 1;
          accent-color: #d4af37;
          cursor: pointer;
        }
        .pause-vol-val {
          width: 38px;
          text-align: right;
          font-size: 12px;
          opacity: 0.7;
        }
        .pause-btns {
          display: flex;
          gap: 10px;
        }
        .pause-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 13px 10px;
          border-radius: 10px;
          font-family: "Golos Text", system-ui, sans-serif;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          border: 1px solid transparent;
          transition:
            transform 0.05s ease,
            filter 0.15s ease;
        }
        .pause-btn:active {
          transform: translateY(1px);
        }
        .pause-btn.secondary {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
          border-color: rgba(255, 255, 255, 0.18);
        }
        .pause-btn.secondary:hover {
          filter: brightness(1.25);
        }
        .pause-btn.home {
          background: #2b2a24;
          color: #f2efe5;
          border-color: #d4af37;
        }
        .pause-btn.home:hover {
          filter: brightness(1.3);
        }
        .pause-wait {
          opacity: 0.5;
          font-size: 13px;
          padding: 6px 0 2px;
        }

        /* ─── terron: ПОБЕДА — «казино»-празднование ─── */
        .pause-ov.win {
          background:
            radial-gradient(
              circle at 50% 38%,
              rgba(212, 175, 55, 0.28),
              rgba(2, 4, 12, 0.72) 60%
            ),
            rgba(2, 4, 12, 0.72);
          animation: winFlash 0.5s ease-out;
        }
        @keyframes winFlash {
          0% {
            background-color: rgba(212, 175, 55, 0.5);
          }
          100% {
          }
        }
        .pause-card.win {
          border: 2px solid transparent;
          border-radius: 16px;
          background:
            linear-gradient(rgba(20, 16, 6, 0.97), rgba(20, 16, 6, 0.97))
              padding-box,
            linear-gradient(120deg, #d4af37, #fff4c2, #d4af37, #a67c00, #d4af37)
              border-box;
          background-size:
            100% 100%,
            300% 300%;
          animation:
            winPop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1),
            winBorder 4s linear infinite;
          box-shadow:
            0 24px 70px rgba(0, 0, 0, 0.7),
            0 0 60px rgba(212, 175, 55, 0.35);
        }
        @keyframes winPop {
          0% {
            transform: scale(0.7);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes winBorder {
          0% {
            background-position:
              0 0,
              0% 50%;
          }
          100% {
            background-position:
              0 0,
              300% 50%;
          }
        }
        .win-crown {
          font-size: 44px;
          line-height: 1;
          margin-bottom: 2px;
          display: inline-block;
          filter: drop-shadow(0 4px 12px rgba(212, 175, 55, 0.6));
          animation: crownBounce 1.6s ease-in-out infinite;
        }
        @keyframes crownBounce {
          0%,
          100% {
            transform: translateY(0) rotate(-6deg);
          }
          50% {
            transform: translateY(-7px) rotate(6deg);
          }
        }
        .pause-card.win h2 {
          font-size: 40px;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          background: linear-gradient(
            180deg,
            #fff6cf 0%,
            #f5cf4e 45%,
            #c8901a 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          filter: drop-shadow(0 2px 10px rgba(212, 175, 55, 0.55));
          animation: winTitle 1.8s ease-in-out infinite;
        }
        @keyframes winTitle {
          0%,
          100% {
            transform: scale(1);
            filter: drop-shadow(0 2px 10px rgba(212, 175, 55, 0.55));
          }
          50% {
            transform: scale(1.06);
            filter: drop-shadow(0 2px 22px rgba(255, 220, 90, 0.95));
          }
        }
        .pause-card.win .pause-stat {
          background: rgba(212, 175, 55, 0.1);
          border-color: rgba(212, 175, 55, 0.4);
          animation: winPop 0.6s cubic-bezier(0.2, 1.4, 0.4, 1) both;
        }
        .pause-card.win .pause-stat:nth-child(1) {
          animation-delay: 0.15s;
        }
        .pause-card.win .pause-stat:nth-child(2) {
          animation-delay: 0.3s;
        }
        .pause-card.win .pause-stat:nth-child(3) {
          animation-delay: 0.45s;
        }
        .pause-card.win .pause-stat .v {
          color: #ffe08a;
          text-shadow: 0 0 14px rgba(255, 210, 90, 0.5);
        }
        /* лучи из-за карточки */
        .win-rays {
          position: absolute;
          inset: 0;
          margin: auto;
          width: 120vmax;
          height: 120vmax;
          pointer-events: none;
          background: repeating-conic-gradient(
            from 0deg,
            rgba(212, 175, 55, 0.13) 0deg 8deg,
            transparent 8deg 20deg
          );
          animation: raySpin 22s linear infinite;
          z-index: -1;
          opacity: 0.7;
        }
        @keyframes raySpin {
          to {
            transform: rotate(360deg);
          }
        }
        /* конфетти */
        .confetti {
          position: fixed;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          z-index: 10011;
        }
        .confetti i {
          position: absolute;
          top: -12vh;
          width: 9px;
          height: 14px;
          opacity: 0.95;
          border-radius: 1px;
          animation: confFall linear infinite;
        }
        @keyframes confFall {
          0% {
            transform: translateY(-12vh) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(112vh) rotate(720deg);
            opacity: 0.85;
          }
        }
      </style>
      ${this.isWin ? this.renderConfetti() : null}
      <div
        class="pause-ov ${this.isWin ? "win" : ""}"
        @click=${this.onOverlayClick}
      >
        <div class="pause-card ${this.isWin ? "win" : ""}">
          ${this.isWin ? html`<div class="win-rays"></div>` : null}
          ${this.isWin ? html`<div class="win-crown">🏆</div>` : null}
          <h2>${this._title || ""}</h2>
          ${mapName
            ? html`<div
                class="pause-map"
                style="display:flex;align-items:center;justify-content:center;gap:8px"
              >
                <span>${mapName}</span>
                ${difficultyKey
                  ? html`<span class="hdr-sep">·</span
                      ><span
                        style="display:inline-flex;align-items:center;gap:2px"
                        ><difficulty-display
                          .difficultyKey=${difficultyKey}
                        ></difficulty-display
                      ></span>`
                  : null}
                <!-- terron 30.07: время матча переехало СЮДА из отдельной
                     строки под статами — экран смерти и так высокий, а карта,
                     сложность и время читаются одной строкой. -->
                <span class="hdr-sep">·</span
                ><span class="hdr-time">${this.survivedLabel()}</span>
                ${this.isWin && this._speedrunRank
                  ? html`<span class="hdr-sep">·</span
                      ><span class="hdr-time" style="color:#fbbf24"
                        >#${this._speedrunRank}</span
                      >`
                  : null}
              </div>`
            : null}
          <!-- terron: ЗОЛОТОЙ МАТЧ — плашка о награде победителю. Алмазы и
               ачивку начисляет API на архиве матча (см. platform-api
               routes/games.ts), здесь только объявление. -->
          ${this.isWin && this.isGoldenMatch()
            ? html`<div
                style=${this.isDiamondMatch()
                  ? "margin:10px 0 2px;padding:8px 10px;border:1px solid #4aa8d8;background:rgba(74,168,216,0.16);color:#bfe6fa;font-weight:700;font-size:14px"
                  : "margin:10px 0 2px;padding:8px 10px;border:1px solid #d4af37;background:rgba(212,175,55,0.14);color:#f7dd8a;font-weight:700;font-size:14px"}
              >
                ${this.isDiamondMatch()
                  ? L("💎 Алмазный матч выигран", "💎 Diamond match won")
                  : L("⭐ Золотой матч выигран", "⭐ Golden match won")}
                (+${eventRewardOf(this.game?.config()?.gameConfig())}
                <img
                  src=${bloodDiamondIcon}
                  alt=""
                  style="display:inline-block;width:15px;height:15px;vertical-align:-3px;object-fit:contain"
                />)
                <!-- terron: играл без аккаунта — награда СОХРАНЕНА за этим
                     браузером и придёт сразу после регистрации (миграция 058). -->
                ${this._loggedIn === false
                  ? html`<div
                      style="margin-top:6px;font-weight:600;font-size:12.5px;color:#e8d9a8"
                    >
                      ${L(
                        "Награда сохранена — заведи аккаунт, и алмазы придут на него",
                        "Reward is saved — create an account and the diamonds are yours",
                      )}
                    </div>`
                  : null}
              </div>`
            : null}
          <!-- terron 30.07: подписи заменены игровыми иконками (единый
               источник — components/ui/statIcons.ts), а вместо текущей
               территории — МАКСИМАЛЬНАЯ доля мира за матч: перед гибелью игрок
               всегда в хвосте, интересен пик. Тайлы ушли в подпись. -->
          <div class="pause-stats">
            <div class="pause-stat">
              <div class="v">${renderNumber(Math.round(troops * cp))}</div>
              <div class="l">${statIcon("troops", 15)}</div>
            </div>
            <div class="pause-stat">
              <div class="v">
                ${renderNumber(
                  this.isWin ? Math.round(Number(gold) * cp) : gold,
                )}
              </div>
              <div class="l">${statIcon("gold", 15)}</div>
            </div>
            <div class="pause-stat">
              <div class="v">${this.worldPctLabel()}</div>
              <div class="l sub">
                ${renderNumber(Math.round(tiles * cp))} ${L("тайлов", "tiles")}
              </div>
            </div>
          </div>

          <!-- Заработок ПОД показателями (макет М1): сначала итоги боя,
               затем сколько за них дали. -->
          ${this.renderMatchReward()}

          <!-- terron 30.07: ползунки звука — ТОЛЬКО в меню по ESC. На экране
               итогов матч уже кончился, крутить громкость там незачем, а место
               они занимали заметное (решение владельца, макет М1).
               01.08: гейт с pauseMode переехал на menuMode — в спавн-фазе и
               после смерти ESC тоже меню, звук там нужен. -->
          <div class="pause-vol" ?hidden=${!this.menuMode}>
            <div class="pause-vol-row">
              <button
                class="pause-vol-ic"
                style="background:none;border:none;cursor:pointer;padding:0;opacity:${isMuted(
                  "music",
                )
                  ? 0.45
                  : 1}"
                title=${isMuted("music")
                  ? L("Включить звук", "Unmute")
                  : L("Выключить звук", "Mute")}
                @click=${this.toggleMusicMute}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="currentColor"
                  style="display:block;color:#e9e7df"
                >
                  <path
                    d="M9 5l12-2v3L9 8zM9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <rect x="8" y="4" width="1.6" height="14" rx="0.8" />
                  <rect x="19.4" y="2" width="1.6" height="14" rx="0.8" />
                  ${isMuted("music")
                    ? svg`<line x1="2" y1="2" x2="22" y2="22" stroke="#e25555" stroke-width="2.6" stroke-linecap="round" />`
                    : ""}
                </svg>
              </button>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                .value=${String(
                  this.userSettings.backgroundMusicVolume() * 100,
                )}
                @input=${this.onMusicVolume}
              />
              <span class="pause-vol-val"
                >${Math.round(
                  this.userSettings.backgroundMusicVolume() * 100,
                )}%</span
              >
            </div>
            <div class="pause-vol-row">
              <button
                class="pause-vol-ic"
                style="background:none;border:none;cursor:pointer;padding:0;opacity:${isMuted(
                  "sfx",
                )
                  ? 0.45
                  : 1}"
                title=${isMuted("sfx")
                  ? L("Включить звук", "Unmute")
                  : L("Выключить звук", "Mute")}
                @click=${this.toggleSfxMute}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="currentColor"
                  style="display:block;color:#e9e7df"
                >
                  <path d="M4 9v6h4l5 4V5L8 9H4z" />
                  <path
                    d="M16 8.5a4.5 4.5 0 010 7"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                  />
                  <path
                    d="M18.5 6a8 8 0 010 12"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                  />
                  ${isMuted("sfx")
                    ? svg`<line x1="2" y1="2" x2="22" y2="22" stroke="#e25555" stroke-width="2.6" stroke-linecap="round" />`
                    : ""}
                </svg>
              </button>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                .value=${String(this.userSettings.soundEffectsVolume() * 100)}
                @input=${this.onSfxVolume}
              />
              <span class="pause-vol-val"
                >${Math.round(
                  this.userSettings.soundEffectsVolume() * 100,
                )}%</span
              >
            </div>
          </div>
          ${this.renderTutorialOffer()}
          ${this.showButtons
            ? html`<div class="pause-btns">
                <button class="pause-btn secondary" @click=${this.hide}>
                  ${resume ? iconPlay : iconEye}
                  ${resume
                    ? translateText("win_modal.resume")
                    : translateText("win_modal.spectate")}
                </button>
                <button class="pause-btn home" @click=${this._handleExit}>
                  ${leaveIcon} ${leaveLabel}
                </button>
              </div>`
            : html`<div class="pause-wait">…</div>`}
        </div>
      </div>
    `;
  }

  // terron: оффер обучения на экране смерти. Показываем ВСЕГДА, пока игрок не
  // прошёл обучение / не получил ачивку (триггер в shouldShowTutorialEntry, см.
  // TUTORIAL.md). Запускает офлайн-песочницу на карте TERRON.
  private renderTutorialOffer(): TemplateResult | null {
    if (!this.isDeath || !shouldShowTutorialEntry()) return null;
    return html`
      <div class="text-center mb-4 bg-black/30 p-3 rounded-sm">
        <p class="text-white mb-2">
          ${L(
            "Тяжёлый старт? Освой основы — это быстро.",
            "Rough start? Learn the basics — it's quick.",
          )}
        </p>
        ${tutorialButton(() => void launchTutorial(this))}
      </div>
    `;
  }

  // terron: конфетти для экрана победы — ~70 падающих кусочков (CSS-анимация).
  private renderConfetti(): TemplateResult {
    const colors = [
      "#d4af37",
      "#ffe08a",
      "#fff4c2",
      "#e23b3b",
      "#3b82f6",
      "#22c55e",
      "#ffffff",
    ];
    const pieces = Array.from({ length: 70 }, (_, i) => {
      const left = (i * 37 + ((i * i) % 13) * 7) % 100; // псевдо-разброс
      const dur = 2.4 + ((i * 7) % 22) / 10; // 2.4–4.6с
      const delay = ((i * 13) % 30) / 10; // 0–3с
      const color = colors[i % colors.length];
      const w = 6 + (i % 4) * 2;
      return html`<i
        style="left:${left}%;width:${w}px;height:${w +
        6}px;background:${color};animation-duration:${dur}s;animation-delay:${delay}s"
      ></i>`;
    });
    return html`<div class="confetti">${pieces}</div>`;
  }

  async show() {
    this.pauseMode = false; // game-over/смерть — не пауза
    this.menuMode = false; // это экран итогов, а не меню по ESC
    // Победа в НАСТОЯЩЕМ матче (обучение не считается) — предложение обучения
    // больше не показываем нигде. См. Tutorial.shouldShowTutorialEntry.
    if (this.isWin) markRealWin();
    crazyGamesSDK.gameplayStop();
    void this.checkLoginForGoldenPrize(); // выиграл золотой без аккаунта?
    void this.loadMatchReward(); // сколько заработал за матч (+ можно ли ×2)
    // count-up статов при победе (казино): 0→1 за ~1.2с через rAF.
    if (this.isWin) {
      this.celebrateProgress = 0;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 1200);
        // easeOutCubic
        this.celebrateProgress = 1 - Math.pow(1 - t, 3);
        this.requestUpdate();
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    // terron: позиция в спидране (только карта Мир + победа).
    void this.maybeFetchSpeedrunRank();
    // Check if this is a ranked game
    this.isRankedGame =
      this.game.config().gameConfig().rankedType === RankedType.OneVOne;
    this.isVisible = true;
    this.requestUpdate();
    setTimeout(() => {
      this.showButtons = true;
      this.requestUpdate();
    }, 3000);
  }

  // terron: клик по подложке (мимо карточки) закрывает меню ВСЕГДА — это единый
  // скрипт закрытия для ОДНОГО окна-меню во всех состояниях (пауза по ESC, экран
  // смерти, победа). Раньше гейтилось на pauseMode, и после смерти (pauseMode=
  // false) кликмимо не работало. Закрыл — снова открываешь по ESC.
  private onOverlayClick = (e: Event) => {
    if (e.target === e.currentTarget) {
      this.hide();
    }
  };

  hide() {
    this.isVisible = false;
    this.showButtons = false;
    this.pauseMode = false;
    this.menuMode = false;
    this.requestUpdate();
  }

  /**
   * Выход в меню. Вне площадки — простая навигация (браузер сам чисто рвёт
   * игру), как в апстриме.
   *
   * ⚠️ ВНУТРИ ПЛОЩАДКИ ПЕРЕЗАГРУЖАТЬ СТРАНИЦУ НЕЛЬЗЯ (требование модерации
   * GamePush 30.07): полный рефреш переинициализирует их SDK — снова крутится
   * прелоадер-реклама, рвётся синхронизация с площадкой и сохранения. Поэтому
   * там уходим мягко, тем же путём, что «покинуть лобби»: событие leave-lobby
   * останавливает матч с полным teardown графики (Main.handleLeaveLobby →
   * lobbyHandle.stop) и возвращает адрес на «/» через history, без загрузки.
   */
  private _handleExit() {
    this.hide();
    if (this.leaveSoftly()) return;
    window.location.href = "/";
  }

  private _handleRequeue() {
    this.hide();
    if (this.leaveSoftly()) {
      document.dispatchEvent(new CustomEvent("open-matchmaking"));
      return;
    }
    // Navigate to homepage and open matchmaking modal
    window.location.href = "/?requeue";
  }

  /** Мягкий выход без перезагрузки. true — ушли, false — не наш случай.
   *  Своей копии больше не держим: `softHome` делает то же самое, но ещё
   *  помечает уход как `cause:"user-nav"` (иначе выход в окне старта матча
   *  игнорируется) и возвращает адрес на «/» — без этого меню оставалось с
   *  адресом мёртвого матча, и следующий F5 уводил в никуда. */
  private leaveSoftly(): boolean {
    if (!GamePushSDK.isOnPlatform()) return false;
    softHome("/");
    return true;
  }

  connectedCallback() {
    // Площадка сменила звук → иконки в паузе обязаны показать факт СРАЗУ
    // (правило владельца 01.08: сигнал площадки — синхронно везде).
    window.addEventListener("platform-audio-changed", this.onPlatformAudio);
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey);
    // terron: back-жест/кнопка (Main.ts onPopState) шлёт это событие → то же меню.
    window.addEventListener("terron-open-pause-menu", this.toggleMenu);
  }

  disconnectedCallback() {
    window.removeEventListener("platform-audio-changed", this.onPlatformAudio);
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("terron-open-pause-menu", this.toggleMenu);
  }

  // ESC — единое окно: открыт → закрыть (продолжить/наблюдать); закрыт и жив →
  // показать как ПАУЗУ. В реплее и до спавна не трогаем.
  private onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    this.toggleMenu();
  };

  // Открыть/закрыть ESC-меню (общая логика для Escape и back-жеста).
  private toggleMenu = () => {
    if (this.isVisible) {
      this.hide();
      return;
    }
    // terron: на ГЛАВНОЙ (не в игре) не открываем игровое «Меню».
    if (!document.body.classList.contains("in-game")) return;
    // terron: меню в ЛЮБОМ состоянии — спавн, синхронизация, бой, гибель,
    // наблюдение И РЕПЛЕЙ. Раньше реплей гейтился → кнопка выхода в реплее была
    // МЁРТВОЙ (пауза-меню = единственный путь «На главную»). В реплее myPlayer
    // пуст → pauseMode false → «Наблюдать»/«На главную» (выход работает).
    this.showPause();
  };

  // Меню по ESC: то же окно, кнопки сразу. pauseMode (=«Продолжить»/«Покинуть»)
  // только если игрок жив и в активном бою; иначе «Наблюдать»/«На главную».
  showPause() {
    const me = this.game?.myPlayer();
    this.pauseMode = !!(
      me &&
      me.isAlive() &&
      me.hasSpawned() &&
      this.game &&
      !this.game.inSpawnPhase()
    );
    this.menuMode = true;
    this._title = translateText("win_modal.pause_title");
    this.isVisible = true;
    this.showButtons = true;
    this.requestUpdate();
  }

  private onMusicVolume = (e: Event) => {
    const v = Number((e.target as HTMLInputElement).value) / 100;
    this.userSettings.setMusicMuted(false); // драг слайдера снимает mute
    this.userSettings.setBackgroundMusicVolume(v);
    this.eventBus?.emit(new SetBackgroundMusicVolumeEvent(v));
    this.requestUpdate();
  };

  private onSfxVolume = (e: Event) => {
    const v = Number((e.target as HTMLInputElement).value) / 100;
    this.userSettings.setSoundEffectsMuted(false);
    this.userSettings.setSoundEffectsVolume(v);
    this.eventBus?.emit(new SetSoundEffectsVolumeEvent(v));
    this.requestUpdate();
  };

  // клик по иконке: mute/unmute — громкость в 0 или назад на позицию слайдера,
  // САМ слайдер (userSettings.*Volume) не трогаем.
  private onPlatformAudio = () => {
    this.requestUpdate();
  };

  private toggleMusicMute = () => {
    // terron 01.08: ГРОМКОСТЬ ЗДЕСЬ НЕ ТРОГАЕМ. Раньше мут гасил её в ноль —
    // и снятие мута площадкой (оно поднимает только Howl.mute) оставляло
    // нулевую громкость: «включил музыку обратно, а её нет». Мут живёт в шине,
    // громкость — только на ползунке.
    setMutedByUser("music", !isMuted("music"));
    this.requestUpdate();
  };

  private toggleSfxMute = () => {
    setMutedByUser("sfx", !isMuted("sfx"));
    this.requestUpdate();
  };

  /**
   * НОВЫЙ МАТЧ — СБРАСЫВАЕМ ВСЁ СОСТОЯНИЕ ПРЕДЫДУЩЕГО.
   *
   * ⚠️ Раньше сбрасывался только `isDeath`, и этого хватало: выход в меню
   * перезагружал страницу, элемент создавался заново. С 30.07 внутри площадки
   * страница НЕ перезагружается (требование модерации GamePush), поэтому
   * состояние потекло из матча в матч — и ломало главное:
   *   • `hasShownDeathModal` оставался true → во ВТОРОЙ партии экран смерти не
   *     показывался вовсе, а вместе с ним не уходил `PlayerDiedEvent` — сервер
   *     не узнавал о гибели и НЕ НАЧИСЛЯЛ награду (репорт владельца 30.07);
   *   • пики (время, войска, золото, доля мира) и счёт съеденных копились
   *     поверх прошлого матча, то есть итоги показывали чужие цифры.
   */
  init() {
    this.isDeath = false;
    this.hasShownDeathModal = false;
    this.isWin = false;
    this.pauseMode = false;
    this.menuMode = false;
    this._loggedIn = null;
    this._speedrunRank = null;
    // пики и счётчики матча
    this.aliveTicks = 0;
    this.maxTroops = 0;
    this.maxGold = 0n;
    this.maxTiles = 0;
    this.maxWorldPct = 0;
    this.eatenNations = 0;
    this.eatenPlayers = 0;
    // награда прошлого матча не должна светиться в новом
    this.reward = null;
    this.rewardLoadedFor = null;
    this.rewardBusy = false;
  }

  tick() {
    this.trackPeaks(); // terron: пики/время за матч (для модалки смерти)
    this.trackConquests(); // кого съел — для награды сразу после гибели
    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this.isDeath = true;
      // Итог игрока окончателен — просим сервер начислить награду немедленно,
      // не дожидаясь конца чужой партии. Время сервер поставит своё.
      this.eventBus.emit(
        new PlayerDiedEvent(this.eatenNations, this.eatenPlayers),
      );
      // terron аналитика: доиграл до своей смерти (может быть до конца матча).
      trackMatchOutcome("died");
      // terron: оффер обучения после смерти — считаем смерти; показываем оффер
      // первые 5 раз, дальше молчим (обучение остаётся в гайдах на главной).
      try {
        const c = Number(localStorage.getItem("terron-tut-offer") ?? "0") + 1;
        localStorage.setItem("terron-tut-offer", String(c));
      } catch {
        /* localStorage недоступен — не критично */
      }
      this._title = translateText("win_modal.died");
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];
    winUpdates.forEach((wu) => {
      if (wu.winner === undefined) {
        // ...
      } else if (wu.winner[0] === "team") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
          this.isWin = true;
          crazyGamesSDK.happytime();
          trackMatchOutcome("won"); // terron аналитика: доиграл до победы
        } else {
          this._title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
          this.isWin = false;
        }
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "nation") {
        this._title = translateText("win_modal.nation_won", {
          nation: wu.winner[1],
        });
        this.isWin = false;
        this.show();
      } else {
        const winner = this.game.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          this.eventBus.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        if (
          winnerClient !== null &&
          winnerClient === this.game.myPlayer()?.clientID()
        ) {
          this._title = translateText("win_modal.you_won");
          this.isWin = true;
          crazyGamesSDK.happytime();
          trackMatchOutcome("won"); // terron аналитика: доиграл до победы
        } else {
          this._title = translateText("win_modal.other_won", {
            player: winner.displayName(),
          });
          this.isWin = false;
        }
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      }
    });
  }
}

import { Colord } from "colord";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { effectiveSpawnPhaseTurns } from "../../../core/configuration/TerronTuning";
import { EventBus } from "../../../core/EventBus";
import { GameMode, PlayerType, Team } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { themeProvider } from "../../theme/ThemeProvider";
import { SendWinnerEvent } from "../../Transport";
import { getTranslatedPlayerTeamLabel, L, translateText } from "../../Utils";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
import { isDevSite } from "../../Utils";
const leaderboardRegularIcon = assetUrl(
  "images/LeaderboardIconRegularWhite.svg",
);
const teamRegularIcon = assetUrl("images/TeamIconRegularWhite.svg");
const teamSolidIcon = assetUrl("images/TeamIconSolidWhite.svg");

@customElement("game-left-sidebar")
export class GameLeftSidebar extends LitElement implements Controller {
  @state()
  private isLeaderboardShow = false;
  @state()
  private isTeamLeaderboardShow = false;
  @state()
  private isVisible = false;
  @state()
  private isPlayerTeamLabelVisible = false;
  @state()
  private playerTeam: Team | null = null;
  @state()
  private spawnBarVisible = false;
  @state()
  private immunityBarVisible = false;
  // Таймер игры перенесён сюда (к иконке топа), симметрично правому блоку.
  @state()
  private timer = 0;
  private hasWinner = false;

  private playerColor: Colord = new Colord("#FFFFFF");
  public game: GameView;
  public eventBus: EventBus;
  private _shownOnInit = false;

  // Persisted per-user preference for the in-game leaderboard.
  // Default: hidden. The player's toggle choice is remembered across games.
  private static readonly LEADERBOARD_PREF_KEY = "terron:leaderboardVisible";

  private readLeaderboardPref(): boolean {
    try {
      return (
        localStorage.getItem(GameLeftSidebar.LEADERBOARD_PREF_KEY) === "true"
      );
    } catch {
      return false;
    }
  }

  private writeLeaderboardPref(value: boolean): void {
    try {
      localStorage.setItem(
        GameLeftSidebar.LEADERBOARD_PREF_KEY,
        String(value),
      );
    } catch {
      // ignore storage errors (e.g. private mode)
    }
  }

  createRenderRoot() {
    return this;
  }

  init() {
    this.isVisible = true;
    this.eventBus.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
    });
    this.eventBus.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
    });
    this.eventBus.on(SendWinnerEvent, () => {
      this.hasWinner = true;
    });
    if (this.isTeamGame) {
      this.isPlayerTeamLabelVisible = true;
    }
    // Leaderboard is hidden by default; only reveal (after spawn phase) if the
    // player previously enabled it. Preference persists via localStorage.
    if (this.readLeaderboardPref()) {
      this._shownOnInit = true;
    }
    this.requestUpdate();
  }

  tick() {
    if (!this.playerTeam && this.game.myPlayer()?.team()) {
      this.playerTeam = this.game.myPlayer()!.team();
      if (this.playerTeam) {
        this.playerColor = themeProvider.current().teamColor(this.playerTeam);
        this.requestUpdate();
      }
    }

    if (this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = false;
      this.isLeaderboardShow = true;
      this.requestUpdate();
    }

    if (!this.game.inSpawnPhase() && this.isPlayerTeamLabelVisible) {
      this.isPlayerTeamLabelVisible = false;
      this.requestUpdate();
    }

    // Таймер (перенесён из правого бара). @state → присвоение само ре-рендерит.
    if (this.game.inSpawnPhase()) {
      const humans = this.game
        .playerViews()
        .filter((p) => p.type() === PlayerType.Human).length;
      const spawnPhaseDurationTicks = effectiveSpawnPhaseTurns(
        this.game.config().numSpawnPhaseTurns(),
        humans,
      );
      const remainingTicks = spawnPhaseDurationTicks - this.game.ticks();
      this.timer = Math.max(0, Math.ceil(remainingTicks / 10));
    } else if (!this.hasWinner) {
      const elapsedSeconds = Math.floor(this.game.elapsedGameSeconds());
      const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
      this.timer =
        maxTimerValue !== null && maxTimerValue !== undefined
          ? Math.max(0, maxTimerValue * 60 - elapsedSeconds)
          : elapsedSeconds;
    }
  }

  private secondsToHms = (d: number): string => {
    const pad = (n: number) => (n < 10 ? `0${n}` : n);
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);
    return h !== 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  private get barOffset(): number {
    return (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
  }

  // terron: кнопка топа — это ТОГЛ (открыть/закрыть), всегда. Если топа два
  // (командная игра) — показываем ПО ОЧЕРЕДИ: открыл один → второй прячется.
  private toggleLeaderboard(): void {
    this.isLeaderboardShow = !this.isLeaderboardShow;
    if (this.isLeaderboardShow) this.isTeamLeaderboardShow = false;
    this.writeLeaderboardPref(this.isLeaderboardShow);
  }

  private toggleTeamLeaderboard(): void {
    this.isTeamLeaderboardShow = !this.isTeamLeaderboardShow;
    if (this.isTeamLeaderboardShow) this.isLeaderboardShow = false;
  }

  private get isTeamGame(): boolean {
    return this.game?.config().gameConfig().gameMode === GameMode.Team;
  }

  render() {
    const maxTimer = this.game?.config?.().gameConfig?.().maxTimerValue;
    const timerColor =
      maxTimer !== null && maxTimer !== undefined && this.timer < 60
        ? "text-red-400"
        : "";
    return html`
      <aside
        class=${`fixed top-[env(safe-area-inset-top)] min-[1200px]:top-4 left-[env(safe-area-inset-left)] min-[1200px]:left-4 z-900 flex flex-col max-h-[55vh] min-[1200px]:max-h-[calc(100vh-80px)] overflow-y-auto transition-all duration-300 ease-out transform ${
          this.isVisible ? "translate-x-0" : "hidden"
        }`}
        style="margin-top: ${this.barOffset}px;"
      >
        <!-- terron: плашка-тогл топа — СООСНА правой панели (таймер/настройки):
             та же высота/фон/скругление (py-2 px-3 bg-gray-800/75 rounded-lg),
             иконки 20px, флеш в угол top-4/left-4. Активный топ = иконка ярче. -->
        <div
          class="w-fit flex items-center gap-3 py-2 px-3 bg-gray-800/75 backdrop-blur-sm shadow-xs rounded-br-lg min-[1200px]:rounded-lg text-white mb-1"
        >
          <div
            class="cursor-pointer transition-opacity p-1.5 -m-1.5 ${this
              .isLeaderboardShow
              ? "opacity-100"
              : "opacity-70 hover:opacity-100"}"
            @click=${this.toggleLeaderboard}
            role="button"
            tabindex="0"
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " " || e.code === "Space") {
                e.preventDefault();
                this.toggleLeaderboard();
              }
            }}
          >
            <img
              class="w-5 h-5"
              src=${leaderboardRegularIcon}
              alt=${translateText("help_modal.icon_alt_player_leaderboard") ||
              "Player Leaderboard Icon"}
              width="20"
              height="20"
            />
          </div>
          ${this.isTeamGame
            ? html`
                <div
                  class="cursor-pointer transition-opacity p-1.5 -m-1.5 ${this
                    .isTeamLeaderboardShow
                    ? "opacity-100"
                    : "opacity-70 hover:opacity-100"}"
                  @click=${this.toggleTeamLeaderboard}
                  role="button"
                  tabindex="0"
                  @keydown=${(e: KeyboardEvent) => {
                    if (
                      e.key === "Enter" ||
                      e.key === " " ||
                      e.code === "Space"
                    ) {
                      e.preventDefault();
                      this.toggleTeamLeaderboard();
                    }
                  }}
                >
                  <img
                    class="w-5 h-5"
                    src=${this.isTeamLeaderboardShow
                      ? teamSolidIcon
                      : teamRegularIcon}
                    alt=${translateText(
                      "help_modal.icon_alt_team_leaderboard",
                    ) || "Team Leaderboard Icon"}
                    width="20"
                    height="20"
                  />
                </div>
              `
            : null}
          <!-- terron: таймер игры — у иконки топа, симметрично правому блоку.
               leading-none: бокс текста не выше иконки (20px) → высота плашки
               совпадает с правым блоком. -->
          <!-- terron: клик по таймеру тоже тоглит топ (как иконка топа). -->
          <div
            class="flex items-center leading-none cursor-pointer ${timerColor}"
            style="font-variant-numeric:tabular-nums"
            title=${L("Показать/скрыть топ", "Toggle leaderboard")}
            @click=${this.toggleLeaderboard}
          >
            ${this.secondsToHms(this.timer)}
          </div>
          ${
            // terron 23.08 (просьба владельца): НА ДЕВЕ — кнопка «ещё раз».
            // Полигон приходится перезапускать десятки раз за сессию, а руками
            // это адрес + перезагрузка. Стрелка рядом с часами уводит на /test,
            // где кэш сбрасывается сам (см. registerServiceWorker).
            isDevSite()
              ? html`<a
                  href="/test"
                  class="flex items-center leading-none opacity-70 hover:opacity-100"
                  title=${L("Перезапустить полигон", "Restart test ground")}
                  >⟳</a
                >`
              : null
          }
          <!-- terron: ID игры переехал в строку со стрелкой внизу лидерборда -->
        </div>
        ${this.isPlayerTeamLabelVisible
          ? html`
              <div
                class="flex items-center w-full text-white mt-2"
                @contextmenu=${(e: Event) => e.preventDefault()}
              >
                ${translateText("help_modal.ui_your_team")}
                <span
                  style="--color: ${this.playerColor.toRgbString()}"
                  class="text-(--color)"
                >
                  &nbsp;${getTranslatedPlayerTeamLabel(this.playerTeam)}
                  &#10687;
                </span>
              </div>
            `
          : null}
        <div
          class=${`block lg:flex flex-wrap overflow-x-auto min-w-0 w-full ${this.isLeaderboardShow && this.isTeamLeaderboardShow ? "gap-2" : ""}`}
        >
          <leader-board
            .visible=${this.isLeaderboardShow}
            .gameId=${this.game?.gameID() ?? ""}
            .onToggle=${() => this.toggleLeaderboard()}
          ></leader-board>
          <team-stats
            class="flex-1"
            .visible=${this.isTeamLeaderboardShow && this.isTeamGame}
          ></team-stats>
        </div>
        <slot></slot>
      </aside>
    `;
  }
}

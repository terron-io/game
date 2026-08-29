import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import exitFullscreenRaw from "../../../../resources/images/ExitFullscreenIconWhite.svg?raw";
import exitRaw from "../../../../resources/images/ExitIconWhite.svg?raw";
import fastForwardRaw from "../../../../resources/images/FastForwardIconSolidWhite.svg?raw";
import fullscreenRaw from "../../../../resources/images/FullscreenIconWhite.svg?raw";
import pauseRaw from "../../../../resources/images/PauseIconWhite.svg?raw";
import playRaw from "../../../../resources/images/PlayIconWhite.svg?raw";
import settingsRaw from "../../../../resources/images/SettingIconWhite.svg?raw";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { GamePushSDK } from "../../GamePushSDK";
import { TogglePauseIntentEvent } from "../../InputHandler";
import { PauseGameIntentEvent, SendWinnerEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import { svgDataUrl } from "./inlineSvg";
import { ShowReplayPanelEvent } from "./ReplayPanel";
import { ShowSettingsModalEvent } from "./SettingsModal";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
// terron: иконки контролов вшиты в data:-URL (build-time) — не зависят от origin/сети,
// не пропадают в офлайн-бандле и при онлайн↔офлайн переходах. См. OFFLINE-IOS.md.
const exitIcon = svgDataUrl(exitRaw);
const FastForwardIconSolid = svgDataUrl(fastForwardRaw);
const pauseIcon = svgDataUrl(pauseRaw);
const playIcon = svgDataUrl(playRaw);
const settingsIcon = svgDataUrl(settingsRaw);
const fullscreenIcon = svgDataUrl(fullscreenRaw);
const exitFullscreenIcon = svgDataUrl(exitFullscreenRaw);

interface BatteryLike {
  level: number;
  charging: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

@customElement("game-right-sidebar")
export class GameRightSidebar extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private _isSinglePlayer: boolean = false;

  @state()
  private _isReplayVisible: boolean = false;

  @state()
  private _isVisible: boolean = true;

  @state()
  private isPaused: boolean = false;

  @state()
  private isFullscreen: boolean = false;

  // Заряд устройства — показываем в правом меню у таймера НА ЛЮБОМ устройстве, где
  // есть батарея (веб + приложение). В приложении системную строку прячем, так
  // что это единственный индикатор заряда. На десктопах без батареи API не отдаёт
  // данные → не показываем.
  @state() private batteryLevel: number | null = null;
  @state() private batteryCharging = false;
  private battery: BatteryLike | null = null;

  private hasWinner = false;
  private isLobbyCreator = false;
  private spawnBarVisible = false;
  private immunityBarVisible = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this._isSinglePlayer =
      this.game?.config()?.gameConfig()?.gameType === GameType.Singleplayer ||
      this.game.config().isReplay();
    this._isVisible = true;

    this.eventBus.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
      this.updateParentOffset();
    });
    this.eventBus.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
      this.updateParentOffset();
    });

    this.eventBus.on(SendWinnerEvent, () => {
      this.hasWinner = true;
      this.requestUpdate();
    });

    this.eventBus.on(TogglePauseIntentEvent, () => {
      const isReplayOrSingleplayer =
        this._isSinglePlayer || this.game?.config()?.isReplay();
      if (isReplayOrSingleplayer || this.isLobbyCreator) {
        this.onPauseButtonClick();
      }
    });

    this.requestUpdate();
  }

  private onFullscreenChange = () => {
    // Внутри площадки состояние спрашиваем у SDK: полный экран может включить
    // и она сама, а её событие приходит отдельно (репорт владельца 01.08).
    this.isFullscreen = GamePushSDK.isOnPlatform()
      ? GamePushSDK.isFullscreen() || !!document.fullscreenElement
      : !!document.fullscreenElement;
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    window.addEventListener("gp-fullscreen-changed", this.onFullscreenChange);
    window.addEventListener("terron-tut-pause", this.onTutPause);
    window.addEventListener("gp-platform-pause", this.onPlatformPause);
    this.onFullscreenChange();
    void this.initBattery();
  }

  // terron: площадка (Яндекс/VK через GamePush) просит остановить игру — реклама
  // или свёрнутая вкладка. Чек-лист модерации требует, чтобы игра при этом ВСТАЛА.
  // Ставим паузу ТОЛЬКО там, где симуляция локальная (одиночка/обучение/реплей):
  // в сетевом матче мир идёт у всех, останавливать нечего. Паузу, поставленную
  // самим игроком, не трогаем — снимаем только свою.
  private pausedByPlatform = false;
  private onPlatformPause = (e: Event) => {
    const wants = (e as CustomEvent).detail === true;
    if (!this._isSinglePlayer && !this.game?.config()?.isReplay()) return;
    if (wants) {
      if (this.isPaused) return; // игрок уже на паузе — не наша забота
      this.pausedByPlatform = true;
    } else {
      if (!this.pausedByPlatform) return;
      this.pausedByPlatform = false;
    }
    this.isPaused = wants;
    this.eventBus.emit(new PauseGameIntentEvent(wants));
    this.requestUpdate();
  };

  // terron: обучение ставит/снимает паузу напрямую — синхронизируем иконку кнопки
  private onTutPause = (e: Event) => {
    const v = (e as CustomEvent).detail === true;
    if (this.isPaused !== v) {
      this.isPaused = v;
      this.requestUpdate();
    }
  };

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    window.removeEventListener(
      "gp-fullscreen-changed",
      this.onFullscreenChange,
    );
    window.removeEventListener("terron-tut-pause", this.onTutPause);
    window.removeEventListener("gp-platform-pause", this.onPlatformPause);
    if (this.battery) {
      this.battery.removeEventListener("levelchange", this.onBatteryChange);
      this.battery.removeEventListener("chargingchange", this.onBatteryChange);
      this.battery = null;
    }
  }

  private onBatteryChange = (): void => {
    if (!this.battery) return;
    this.batteryLevel = this.battery.level;
    this.batteryCharging = this.battery.charging;
    this.requestUpdate();
  };

  private async initBattery(): Promise<void> {
    try {
      const getBattery = (
        navigator as unknown as {
          getBattery?: () => Promise<BatteryLike>;
        }
      ).getBattery;
      if (typeof getBattery !== "function") return; // нет API (Safari/FF) → скрыто
      const b = await getBattery.call(navigator);
      this.battery = b;
      this.onBatteryChange();
      b.addEventListener("levelchange", this.onBatteryChange);
      b.addEventListener("chargingchange", this.onBatteryChange);
    } catch {
      /* нет батареи / доступ закрыт — просто не показываем индикатор */
    }
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    // terron: таймер игры переехал в левый бар (GameLeftSidebar) — к иконке топа.
    // Здесь осталась только проверка «я создатель лобби» (для replay-кнопок).
    if (!this.isLobbyCreator && this.game.myPlayer()?.isLobbyCreator()) {
      this.isLobbyCreator = true;
      this.requestUpdate();
    }
  }

  private updateParentOffset(): void {
    const offset =
      (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
    const parent = this.parentElement as HTMLElement;
    if (parent) {
      parent.style.marginTop = `${offset}px`;
    }
  }

  private toggleReplayPanel(): void {
    this._isReplayVisible = !this._isReplayVisible;
    this.eventBus.emit(
      new ShowReplayPanelEvent(this._isReplayVisible, this._isSinglePlayer),
    );
  }

  private onPauseButtonClick() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      crazyGamesSDK.gameplayStop();
    } else {
      crazyGamesSDK.gameplayStart();
    }
    this.eventBus.emit(new PauseGameIntentEvent(this.isPaused));
  }

  private onExitButtonClick() {
    // terron: кнопка выхода ⤴ открывает наше единое ESC-меню (время/золото/войска
    // + Продолжить/Наблюдать/На главную), а не голый confirm. Выйти — из меню.
    window.dispatchEvent(new CustomEvent("terron-open-pause-menu"));
  }

  private onSettingsButtonClick() {
    this.eventBus.emit(
      new ShowSettingsModalEvent(true, this._isSinglePlayer, this.isPaused),
    );
  }

  // terron: в нативной оболочке (iOS/Android) кнопка «раскрыть» не нужна —
  // приложение и так на весь экран, браузерный Fullscreen API там лишний.
  private isNativeApp(): boolean {
    return !!(
      window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor?.isNativePlatform?.();
  }

  private onFullscreenButtonClick() {
    // На площадке — её же API (у SDK свой модуль fullscreen с событиями),
    // чтобы состояние не разъезжалось с игрой. Вернул false — SDK недоступен,
    // работаем браузерным путём.
    if (GamePushSDK.isOnPlatform() && GamePushSDK.toggleFullscreen()) return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn("Failed to enter fullscreen:", err);
      });
    } else {
      document.exitFullscreen().catch((err) => {
        console.warn("Failed to exit fullscreen:", err);
      });
    }
  }

  render() {
    if (this.game === undefined) return html``;

    return html`
      <aside
        class=${`w-fit flex flex-row items-center gap-3 py-2 px-3 bg-gray-800/75 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg rounded-bl-lg transition-transform duration-300 ease-out transform text-white ${
          this._isVisible ? "translate-x-0" : "translate-x-full"
        }`}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <!-- Заряд устройства (если есть батарея) -->
        ${this.renderBattery()}

        <!-- Buttons (кликзона p-1.5 — крупнее иконки, легче попадать) -->
        ${this.maybeRenderReplayButtons()}

        <div
          class="cursor-pointer p-1.5 -my-1.5"
          @click=${this.onSettingsButtonClick}
        >
          <img src=${settingsIcon} alt="settings" width="20" height="20" />
        </div>

        ${document.fullscreenEnabled && !this.isNativeApp()
          ? html`<div
              class="cursor-pointer p-1.5 -my-1.5"
              @click=${this.onFullscreenButtonClick}
            >
              <img
                src=${this.isFullscreen ? exitFullscreenIcon : fullscreenIcon}
                alt=${this.isFullscreen
                  ? translateText("fullscreen.exit")
                  : translateText("fullscreen.enter")}
                width="20"
                height="20"
              />
            </div>`
          : ""}

        <div
          class="cursor-pointer p-1.5 -my-1.5"
          @click=${this.onExitButtonClick}
        >
          <img src=${exitIcon} alt="exit" width="20" height="20" />
        </div>
      </aside>
    `;
  }

  private renderBattery() {
    if (this.batteryLevel === null) return "";
    const pct = Math.round(this.batteryLevel * 100);
    // Заливка идёт от x=3; макс. ширина 16 → правый край заливки x=19, что
    // оставляет зазор до внутренней стенки корпуса (~20.3) и не «вытекает»
    // вправо при 100%.
    const fillW = Math.max(1, Math.min(16, Math.round((pct / 100) * 16)));
    // зарядка → зелёная; иначе <10% красная, <20% жёлтая, иначе светлая
    const col = this.batteryCharging
      ? "#4ade80"
      : pct < 10
        ? "#f87171"
        : pct < 20
          ? "#facc15"
          : "#e5e7eb";
    return html`<div
      class="flex items-center select-none"
      title=${`${pct}%${this.batteryCharging ? " ⚡" : ""}`}
    >
      <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">
        <rect
          x="1"
          y="2.5"
          width="20"
          height="9"
          rx="2"
          fill="none"
          stroke="#e5e7eb"
          stroke-width="1.3"
        />
        <rect x="22.2" y="5" width="2.4" height="4" rx="1" fill="#e5e7eb" />
        <rect x="3" y="4.4" width=${fillW} height="5.2" rx="1" fill=${col} />
      </svg>
    </div>`;
  }

  maybeRenderReplayButtons() {
    const isReplayOrSingleplayer =
      this._isSinglePlayer || this.game?.config()?.isReplay();
    const showPauseButton = isReplayOrSingleplayer || this.isLobbyCreator;

    return html`
      ${isReplayOrSingleplayer
        ? html`
            <div
              class="cursor-pointer p-1.5 -my-1.5"
              @click=${this.toggleReplayPanel}
            >
              <img
                src=${FastForwardIconSolid}
                alt="replay"
                width="20"
                height="20"
              />
            </div>
          `
        : ""}
      ${showPauseButton
        ? html`
            <div
              class="cursor-pointer p-1.5 -my-1.5"
              @click=${this.onPauseButtonClick}
            >
              <img
                src=${this.isPaused ? playIcon : pauseIcon}
                alt="play/pause"
                width="20"
                height="20"
              />
            </div>
          `
        : ""}
    `;
  }
}

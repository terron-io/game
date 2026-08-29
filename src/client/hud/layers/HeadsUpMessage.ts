import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { translateText } from "../../Utils";

@customElement("heads-up-message")
export class HeadsUpMessage extends LitElement implements Controller {
  public game: GameView;

  @state()
  private isVisible = false;

  @state()
  private isPaused = false;

  @state()
  private isImmunityActive = false;

  // terron: полупрозрачный «Синхронизация…» (catching_up) УБРАН — его полностью
  // заменил баннер SyncStatus с прогрессом («осталось N ходов»), дубль мозолил
  // глаза поверх карты. Спавн/пауза/иммунитет остаются.

  @state()
  private toastMessage: string | import("lit").TemplateResult | null = null;
  @state()
  private toastColor: "green" | "red" = "green";
  private toastTimeout: number | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      "show-message",
      this.handleShowMessage as EventListener,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      "show-message",
      this.handleShowMessage as EventListener,
    );
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
  }

  private handleShowMessage = (event: CustomEvent) => {
    const { message, duration, color } = event.detail ?? {};
    if (
      typeof message === "string" ||
      (message && typeof message.values === "object")
    ) {
      this.toastMessage = message;
      this.toastColor = color === "red" ? "red" : "green";
      this.requestUpdate();
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
      }
      this.toastTimeout = window.setTimeout(
        () => {
          this.toastMessage = null;
          this.requestUpdate();
        },
        typeof duration === "number" ? (duration ?? 2000) : 2000,
      );
    }
  };

  init() {
    this.isVisible = true;
    this.requestUpdate();
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    const pauseUpdates = updates?.[GameUpdateType.GamePaused];
    if (pauseUpdates && pauseUpdates.length > 0) {
      this.isPaused = pauseUpdates[pauseUpdates.length - 1].paused;
    }

    const showImmunityHudDuration = 10 * 10;
    const spawnEnd = this.game.config().numSpawnPhaseTurns();
    const ticksSinceSpawnEnd = this.game.ticks() - spawnEnd;

    this.isImmunityActive =
      this.game.config().hasExtendedSpawnImmunity() &&
      !this.game.inSpawnPhase() &&
      this.game.isSpawnImmunityActive() &&
      ticksSinceSpawnEnd < showImmunityHudDuration;

    this.isVisible =
      this.game.inSpawnPhase() || this.isPaused || this.isImmunityActive;
    this.requestUpdate();
  }

  // terron 20.07 (запрос владельца): пока матч не начался, показываем не просто
  // текст, а живой индикатор — иначе «кадр, когда ничего не происходит»
  // выглядит как зависание.
  private get isAwaitingStart(): boolean {
    return !this.isPaused && !this.isImmunityActive && this.game.ticks() === 0;
  }

  private getMessage(): string {
    if (this.isPaused) {
      if (this.game.config().gameConfig().gameType === GameType.Singleplayer) {
        return translateText("heads_up_message.singleplayer_game_paused");
      } else {
        return translateText("heads_up_message.multiplayer_game_paused");
      }
    }
    if (this.isImmunityActive) {
      return translateText("heads_up_message.pvp_immunity_active", {
        seconds: Math.round(this.game.config().spawnImmunityDuration() / 10),
      });
    }
    // terron 20.07: карта показывается ДО первого хода (см. renderer_ready) —
    // и раньше игрок видел «Выберите местоположение» на мёртвом экране, где
    // клик ещё не работает. Пока мир не тикнул, честно пишем, что ждём старта.
    if (this.game.ticks() === 0) {
      return translateText("heads_up_message.awaiting_start");
    }
    return this.game.config().isRandomSpawn()
      ? translateText("heads_up_message.random_spawn")
      : translateText("heads_up_message.choose_spawn");
  }

  render() {
    return html`
      <style>
        @keyframes terron-hud-spin {
          to {
            transform: rotate(360deg);
          }
        }
      </style>
      <div style="pointer-events: none;">
        ${this.toastMessage
          ? html`
              <div
                class="fixed top-[76px] right-3 z-[800] px-4 py-3 rounded-xl transition-all duration-300 animate-fade-in-out"
                style="max-width: min(90vw, 340px); text-align: center;
                  background: ${this.toastColor === "red"
                  ? "rgba(90,24,24,0.94)"
                  : "rgba(20,58,34,0.94)"};
                  border: 1px solid ${this.toastColor === "red"
                  ? "rgba(239,68,68,0.6)"
                  : "rgba(34,197,94,0.6)"};
                  color: white;
                  box-shadow: 0 0 30px 0 ${this.toastColor === "red"
                  ? "rgba(239,68,68,0.3)"
                  : "rgba(34,197,94,0.3)"};
                  backdrop-filter: blur(12px);"
                @contextmenu=${(e: MouseEvent) => e.preventDefault()}
              >
                ${typeof this.toastMessage === "string"
                  ? html`<span class="font-medium">${this.toastMessage}</span>`
                  : this.toastMessage}
              </div>
            `
          : null}
        ${this.isVisible
          ? html`
              <div
                class="hud-msg fixed top-[15%] left-1/2 -translate-x-1/2 z-[799]
                            inline-flex items-center justify-center min-h-8 lg:min-h-10
                            w-fit max-w-[90vw]
                            bg-gray-800/70 rounded-md lg:rounded-lg
                            backdrop-blur-xs text-white text-md lg:text-xl px-3 lg:px-4 py-1
                            text-center break-words"
                style="word-wrap: break-word; hyphens: auto;"
                @contextmenu=${(e: MouseEvent) => e.preventDefault()}
              >
                ${this.isAwaitingStart
                  ? html`<span
                      style="display:inline-block;width:1em;height:1em;margin-right:.5em;
                             border:2px solid rgba(255,255,255,.35);border-top-color:#fff;
                             border-radius:50%;animation:terron-hud-spin .9s linear infinite;
                             vertical-align:-.15em"
                    ></span>`
                  : null}
                ${this.getMessage()}
              </div>
            `
          : null}
      </div>
    `;
  }
}

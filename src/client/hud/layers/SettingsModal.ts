import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { crazyGamesSDK } from "src/client/CrazyGamesSDK";
import { PauseGameIntentEvent } from "src/client/Transport";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { AimLayout, UserSettings } from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import {
  AlternateViewEvent,
  RefreshGraphicsEvent,
  ToggleRenderDebugGuiEvent,
} from "../../InputHandler";
import { isNativeApp } from "../../Platform";
import { softHome } from "../../SoftNavigate";
import {
  launchTutorial,
  shouldShowTutorialEntry,
  tutorialButton,
} from "../../Tutorial";
import { L, translateText, isDevSite } from "../../Utils";
import { isMuted, setMutedByUser } from "../../sound/AudioBus";
import {
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
} from "../../sound/Sounds";
import { ShowGraphicsSettingsModalEvent } from "./GraphicsSettingsModal";

// terron: подписи раскладок управления (ленивые — L() читает язык в момент вызова)
const AIM_LAYOUT_LABELS: [AimLayout, () => string][] = [
  ["classic", () => L("Классика", "Classic")],
  ["g", () => L("Г-панель", "L-pad")],
  ["flanks", () => L("Два фланга", "Two flanks")],
  ["fan", () => L("Веер", "Fan")],
];
const aimIcon = assetUrl("images/TargetIconWhite.svg");
const cursorPriceIcon = assetUrl("images/CursorPriceIconWhite.svg");
const darkModeIcon = assetUrl("images/DarkModeIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const exitIcon = assetUrl("images/ExitIconWhite.svg");
const mouseIcon = assetUrl("images/MouseIconWhite.svg");
const ninjaIcon = assetUrl("images/NinjaIconWhite.svg");
const settingsIcon = assetUrl("images/SettingIconWhite.svg");
const sirenIcon = assetUrl("images/SirenIconWhite.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");
const treeIcon = assetUrl("images/TreeIconWhite.svg");
const musicIcon = assetUrl("images/music.svg");

export class ShowSettingsModalEvent {
  constructor(
    public readonly isVisible: boolean = true,
    public readonly shouldPause: boolean = false,
    public readonly isPaused: boolean = false,
  ) {}
}

@customElement("settings-modal")
export class SettingsModal extends LitElement implements Controller {
  public eventBus: EventBus;
  public userSettings: UserSettings;
  public game?: GameView; // terron: для escape-открытия в фазе спавна

  @state()
  private isVisible: boolean = false;

  @state()
  private alternateView: boolean = false;

  // terron: mute хранится в UserSettings (settings.musicMuted/soundEffectsMuted) —
  // персистит между сессиями; позиция ползунка громкости — отдельно.

  @query(".modal-overlay")
  private modalOverlay!: HTMLElement;

  @property({ type: Boolean })
  shouldPause = false;

  @property({ type: Boolean })
  wasPausedWhenOpened = false;

  init() {
    this.eventBus.on(ShowSettingsModalEvent, (event) => {
      this.isVisible = event.isVisible;
      this.shouldPause = event.shouldPause;
      this.wasPausedWhenOpened = event.isPaused;
      this.pauseGame(true);
    });
  }

  createRenderRoot() {
    return this;
  }

  private onPlatformAudio = () => {
    this.requestUpdate();
  };

  connectedCallback() {
    super.connectedCallback();
    // Площадка сменила звук → иконки показывают факт (правило 01.08).
    window.addEventListener("platform-audio-changed", this.onPlatformAudio);
    window.addEventListener("click", this.handleOutsideClick, true);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("platform-audio-changed", this.onPlatformAudio);
    window.removeEventListener("click", this.handleOutsideClick, true);
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private handleOutsideClick = (event: MouseEvent) => {
    if (
      this.isVisible &&
      this.modalOverlay &&
      event.target === this.modalOverlay
    ) {
      this.closeModal();
    }
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // terron: единое ESC-меню = WinModal («Меню»: Продолжить/Покинуть + громкость).
    // Эти настройки по ESC НЕ открываем (иначе лезут два окна). Только закрываем,
    // если уже открыты (например через кнопку Graphics Settings внутри «Меню»).
    if (this.isVisible) {
      this.closeModal();
    }
  };

  public openModal() {
    this.isVisible = true;
    this.requestUpdate();
  }

  public closeModal({ keepPause = false }: { keepPause?: boolean } = {}) {
    this.isVisible = false;
    this.requestUpdate();
    if (!keepPause) this.pauseGame(false);
  }

  private pauseGame(pause: boolean) {
    if (this.shouldPause && !this.wasPausedWhenOpened) {
      if (pause) {
        crazyGamesSDK.gameplayStop();
      } else {
        crazyGamesSDK.gameplayStart();
      }
      this.eventBus.emit(new PauseGameIntentEvent(pause));
    }
  }

  private onTerrainButtonClick() {
    this.alternateView = !this.alternateView;
    this.eventBus.emit(new AlternateViewEvent(this.alternateView));
    this.requestUpdate();
  }

  private onToggleEmojisButtonClick() {
    this.userSettings.toggleEmojis();
    this.requestUpdate();
  }

  private onToggleAlertFrameButtonClick() {
    this.userSettings.toggleAlertFrame();
    this.requestUpdate();
  }

  private onToggleDarkModeButtonClick() {
    this.userSettings.toggleDarkMode();
    this.eventBus.emit(new RefreshGraphicsEvent());
    this.requestUpdate();
  }

  private onToggleRandomNameModeButtonClick() {
    this.userSettings.toggleRandomName();
    this.requestUpdate();
  }

  // terron: схема управления (эксперимент) — см. layers/AimControl.ts

  private onPickAimLayout(layout: AimLayout) {
    this.userSettings.setAimLayout(layout);
    this.requestUpdate();
  }

  private onToggleLeftClickOpensMenu() {
    this.userSettings.toggleLeftClickOpenMenu();
    this.requestUpdate();
  }

  private onToggleCursorCostLabelButtonClick() {
    this.userSettings.toggleCursorCostLabel();
    this.requestUpdate();
  }

  private onToggleSkinTrueColors() {
    this.userSettings.toggleSkinTrueColors();
    this.requestUpdate();
  }

  private onToggleAttackingTroopsOverlayButtonClick() {
    this.userSettings.toggleAttackingTroopsOverlay();
    this.requestUpdate();
  }

  private onTogglePerformanceOverlayButtonClick() {
    this.userSettings.togglePerformanceOverlay();
    this.requestUpdate();
  }

  private onRenderDebugGuiButtonClick() {
    this.eventBus.emit(new ToggleRenderDebugGuiEvent());
    this.closeModal();
  }

  private onGraphicsSettingsButtonClick() {
    this.eventBus.emit(
      new ShowGraphicsSettingsModalEvent(
        true,
        this.shouldPause,
        this.wasPausedWhenOpened,
      ),
    );
    this.closeModal({ keepPause: true });
  }

  private onExitButtonClick() {
    // ⚠️ Внутри площадки перезагрузка запрещена (переинициализирует их SDK —
    // прелоадер, разрыв синхронизации, потеря сохранений; жалоба модерации
    // «проиграл забег → вернулся в меню → опять прелоадер»). Мягкий уход
    // останавливает матч и правит адрес через history. Вне площадки — как было.
    if (softHome("/")) return;
    window.location.href = "/";
  }

  private onVolumeChange(event: Event) {
    const volume = parseFloat((event.target as HTMLInputElement).value) / 100;
    this.userSettings.setMusicMuted(false); // драг слайдера снимает mute
    this.userSettings.setBackgroundMusicVolume(volume);
    this.eventBus.emit(new SetBackgroundMusicVolumeEvent(volume));
    this.requestUpdate();
  }

  private onSoundEffectsVolumeChange(event: Event) {
    const volume = parseFloat((event.target as HTMLInputElement).value) / 100;
    this.userSettings.setSoundEffectsMuted(false);
    this.userSettings.setSoundEffectsVolume(volume);
    this.eventBus.emit(new SetSoundEffectsVolumeEvent(volume));
    this.requestUpdate();
  }

  // клик по иконке: mute/unmute — громкость в 0 или назад на позицию слайдера,
  // САМ слайдер (userSettings.*Volume) не меняем.
  private toggleMusicMute() {
    // terron 01.08: ГРОМКОСТЬ ЗДЕСЬ НЕ ТРОГАЕМ. Раньше мут гасил её в ноль —
    // и снятие мута площадкой (оно поднимает только Howl.mute) оставляло
    // нулевую громкость: «включил музыку обратно, а её нет». Мут живёт в шине,
    // громкость — только на ползунке.
    setMutedByUser("music", !isMuted("music")); // шина: плееры + иконки + площадка
    this.requestUpdate();
  }

  private toggleSfxMute() {
    setMutedByUser("sfx", !isMuted("sfx")); // шина: плееры + иконки + площадка
    this.requestUpdate();
  }

  render() {
    if (!this.isVisible) {
      return null;
    }

    return html`
      <div
        class="modal-overlay fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center p-4"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="bg-slate-800 border border-slate-600 rounded-lg max-w-md w-full max-h-[80vh] overflow-y-auto"
        >
          <div
            class="flex items-center justify-between p-4 border-b border-slate-600"
          >
            <div class="flex items-center gap-2">
              <img
                src=${settingsIcon}
                alt="settings"
                width="24"
                height="24"
                class="align-middle"
              />
              <h2 class="text-xl font-semibold text-white">
                ${translateText("user_setting.tab_basic")}
              </h2>
            </div>
            <button
              class="text-slate-400 hover:text-white text-2xl font-bold leading-none"
              @click=${this.closeModal}
            >
              ×
            </button>
          </div>

          <div class="p-4 flex flex-col gap-3">
            ${shouldShowTutorialEntry()
              ? tutorialButton(() => {
                  this.closeModal();
                  void launchTutorial(this);
                })
              : ""}
            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onGraphicsSettingsButtonClick}"
            >
              <img
                src=${settingsIcon}
                alt="graphicsSettings"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.graphics_settings_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.graphics_settings_desc")}
                </div>
              </div>
            </button>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <button
                class="relative shrink-0"
                title=${isMuted("music")
                  ? L("Включить звук", "Unmute")
                  : L("Выключить звук", "Mute")}
                @click=${() => this.toggleMusicMute()}
              >
                <img
                  src=${musicIcon}
                  alt="musicIcon"
                  width="20"
                  height="20"
                  style="opacity:${isMuted("music") ? 0.35 : 1}"
                />
                ${isMuted("music")
                  ? html`<span
                      style="position:absolute;left:-2px;top:9px;width:24px;height:2px;background:#e25555;transform:rotate(-45deg);border-radius:2px"
                    ></span>`
                  : ""}
              </button>
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.background_music_volume")}
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  .value=${this.userSettings.backgroundMusicVolume() * 100}
                  @input=${this.onVolumeChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400">
                ${Math.round(this.userSettings.backgroundMusicVolume() * 100)}%
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <button
                class="relative shrink-0"
                title=${isMuted("sfx")
                  ? L("Включить звук", "Unmute")
                  : L("Выключить звук", "Mute")}
                @click=${() => this.toggleSfxMute()}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="currentColor"
                  style="opacity:${isMuted("sfx") ? 0.35 : 1}"
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
                </svg>
                ${isMuted("sfx")
                  ? html`<span
                      style="position:absolute;left:-2px;top:9px;width:24px;height:2px;background:#e25555;transform:rotate(-45deg);border-radius:2px"
                    ></span>`
                  : ""}
              </button>
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.sound_effects_volume")}
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  .value=${this.userSettings.soundEffectsVolume() * 100}
                  @input=${this.onSoundEffectsVolumeChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400">
                ${Math.round(this.userSettings.soundEffectsVolume() * 100)}%
              </div>
            </div>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onTerrainButtonClick}"
            >
              <img src=${treeIcon} alt="treeIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.toggle_terrain")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.toggle_view_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.alternateView
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleEmojisButtonClick}"
            >
              <img src=${emojiIcon} alt="emojiIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.emojis_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.emojis_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.emojis()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleDarkModeButtonClick}"
            >
              <img
                src=${darkModeIcon}
                alt="darkModeIcon"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.dark_mode_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.dark_mode_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.darkMode()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleAlertFrameButtonClick}"
            >
              <img src=${sirenIcon} alt="alertFrame" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.alert_frame_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.alert_frame_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.alertFrame()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleSkinTrueColors}"
            >
              <img
                src=${darkModeIcon}
                alt="skinTrueColors"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${L("Истинные цвета скинов", "True skin colors")}
                </div>
                <div class="text-sm text-slate-400">
                  Флаги/скины в чистом цвете — без затемнения и тинта территории
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.skinTrueColors()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleAttackingTroopsOverlayButtonClick}"
            >
              <img src=${swordIcon} alt="swordIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText(
                    "user_setting.attacking_troops_overlay_label",
                  )}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.attacking_troops_overlay_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.attackingTroopsOverlay()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleCursorCostLabelButtonClick}"
            >
              <img
                src=${cursorPriceIcon}
                alt="cursorCostLabel"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.cursor_cost_label_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.cursor_cost_label_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.cursorCostLabel()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleRandomNameModeButtonClick}"
            >
              <img src=${ninjaIcon} alt="ninjaIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.anonymous_names_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.anonymous_names_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.anonymousNames()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <div class="p-3">
              <div class="flex gap-3 items-center">
                <img src=${aimIcon} alt="aimIcon" width="20" height="20" />
                <div class="flex-1">
                  <div class="font-medium text-white">
                    ${L("Управление", "Controls")}
                  </div>
                  <div class="text-sm text-slate-400">
                    ${L(
                      "Классика — как было всегда. Остальное: прицел по центру экрана, кнопки внизу под пальцем.",
                      "Classic is the usual radial menu. The rest put a crosshair in the middle and the buttons under your thumb.",
                    )}
                  </div>
                </div>
              </div>
              <div class="flex flex-wrap gap-2 mt-2">
                ${AIM_LAYOUT_LABELS.map(
                  ([id, label]) =>
                    html`<button
                      class="px-3 py-2 rounded-sm text-sm border transition-colors ${this.userSettings.aimLayout() ===
                      id
                        ? "bg-slate-600 border-amber-400 text-white"
                        : "bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700"}"
                      @click=${() => this.onPickAimLayout(id)}
                    >
                      ${label()}
                    </button>`,
                )}
              </div>
            </div>

            ${isNativeApp()
              ? ""
              : html`<button
                  class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                  @click="${this.onToggleLeftClickOpensMenu}"
                >
                  <img
                    src=${mouseIcon}
                    alt="mouseIcon"
                    width="20"
                    height="20"
                  />
                  <div class="flex-1">
                    <div class="font-medium">
                      ${translateText("user_setting.left_click_menu")}
                    </div>
                    <div class="text-sm text-slate-400">
                      ${translateText("user_setting.left_click_desc")}
                    </div>
                  </div>
                  <div class="text-sm text-slate-400">
                    ${this.userSettings.leftClickOpensMenu()
                      ? translateText("user_setting.on")
                      : translateText("user_setting.off")}
                  </div>
                </button>`}
            ${isNativeApp()
              ? ""
              : html`<div class="border-t border-slate-600 pt-3 mt-4">
                  <div
                    class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider"
                  >
                    ${translateText("user_setting.development_only")}
                  </div>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onTogglePerformanceOverlayButtonClick}"
                  >
                    <img
                      src=${settingsIcon}
                      alt="performanceIcon"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText(
                          "user_setting.performance_overlay_label",
                        )}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText(
                          "user_setting.performance_overlay_desc",
                        )}
                      </div>
                    </div>
                    <div class="text-sm text-slate-400">
                      ${this.userSettings.performanceOverlay()
                        ? translateText("user_setting.on")
                        : translateText("user_setting.off")}
                    </div>
                  </button>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onRenderDebugGuiButtonClick}"
                  >
                    <img
                      src=${settingsIcon}
                      alt="renderDebugGui"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.render_debug_gui")}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText("user_setting.render_debug_gui_desc")}
                      </div>
                    </div>
                  </button>
                </div>`}

            <div class="border-t border-slate-600 pt-3 mt-4">
              <button
                class="flex gap-3 items-center w-full text-left p-3 hover:bg-red-600/20 rounded-sm text-red-400 transition-colors"
                @click="${this.onExitButtonClick}"
              >
                <img src=${exitIcon} alt="exitIcon" width="20" height="20" />
                <div class="flex-1">
                  <div class="font-medium">
                    ${translateText("user_setting.exit_game_label")}
                  </div>
                  <div class="text-sm text-slate-400">
                    ${translateText("user_setting.exit_game_info")}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

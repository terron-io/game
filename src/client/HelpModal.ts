import { html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { L, translateText, TUTORIAL_VIDEO_URL } from "../client/Utils";
import { assetUrl } from "../core/AssetUrls";
import { UserSettings } from "../core/game/UserSettings";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import { modalHeader } from "./components/ui/ModalHeader";
import { GamePushSDK } from "./GamePushSDK";
import { isNativeApp, Platform } from "./Platform";
import { TroubleshootingModal } from "./TroubleshootingModal";
import { launchTutorial, tutorialButton } from "./Tutorial";

/** Прятать ли скриншоты справки (см. комментарий у HelpModal.shot).
 *  Вынесено из компонента, чтобы условие было под тестом, а не проверялось
 *  «на глаз» после каждого выката на площадку. */
export function helpScreenshotsHidden(): boolean {
  return GamePushSDK.platformType() === "YANDEX";
}

@customElement("help-modal")
export class HelpModal extends BaseModal {
  protected routerName = "help";

  @state() private keybinds: Record<string, string> = this.getKeybinds();
  @query("#tutorial-video-iframe") private videoIframe?: HTMLIFrameElement;

  // terron 25.08: СКРИНШОТЫ СПРАВКИ ПРЯЧЕМ НА ЯНДЕКС.ИГРАХ (временно).
  //
  // Все 15 картинок сняты с АНГЛИЙСКОГО интерфейса апстрима: «Troops/Gold»,
  // «Attack Ratio», латинские имена стран («Fatimid Realm», «Rabbit») — причём
  // имена наций мы давно локализовали, то есть картинки устарели и по сути.
  // Модерация Яндекса требует, чтобы материалы были на языке площадки, и
  // придирается именно к ним. Текст справки переведён полностью и без картинок
  // читается — поэтому там их не рисуем вовсе.
  //
  // ⚠️ ТОЛЬКО Яндекс (`gp.platform.type`): на VK/OK, itch, в приложении и на
  // своём сайте картинки остаются. Гейт временный — снять, когда переснимем
  // скриншоты на русском интерфейсе (удобнее всего на полигоне /test).
  private shot(src: string, alt: string, cls: string) {
    if (helpScreenshotsHidden()) return nothing;
    return html`<img
      src=${assetUrl(src)}
      alt=${alt}
      class=${cls}
      loading="lazy"
    />`;
  }

  // Площадка отвечает ПОЗЖЕ первого кадра: если справку успели открыть до
  // готовности SDK, перерисовываем её, когда тип площадки станет известен.
  connectedCallback(): void {
    super.connectedCallback();
    const ready = (window as unknown as { __gpReady?: Promise<unknown> })
      .__gpReady;
    void ready?.then(() => this.requestUpdate()).catch(() => {});
  }

  private getKeybinds(): Record<string, string> {
    return new UserSettings().keybinds(Platform.isMac);
  }

  private getKeyLabel(code: string): string {
    if (!code) return "";

    const specialLabels: Record<string, string> = {
      ShiftLeft: "⇧ Shift",
      ShiftRight: "⇧ Shift",
      ControlLeft: "Ctrl",
      ControlRight: "Ctrl",
      AltLeft: "Alt",
      AltRight: "Alt",
      MetaLeft: "⌘",
      MetaRight: "⌘",
      Space: "Space",
      Escape: "Esc",
      Enter: "↵ Return",
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Period: ">",
      Comma: "<",
    };

    if (specialLabels[code]) return specialLabels[code];
    if (code.startsWith("Key") && code.length === 4) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;

    return code;
  }

  private renderKey(code: string) {
    const label = this.getKeyLabel(code);
    return html`<span
      class="inline-block min-w-[32px] text-center px-2 py-1 rounded font-mono text-xs font-bold mx-0.5"
      style="background:#2b2a24;color:#fff;border-bottom:2px solid #14130f"
      >${label}</span
    >`;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("main.help"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody() {
    const keybinds = this.keybinds;

    return html`
      <style>
        /* terron: белые моно-иконки на светлой теме были бледными — затемняем.
           Скриншоты (webp без "Icon"/"White" в src) не трогаем. */
        .help-content img[src*="Icon"],
        .help-content img[src*="White"] {
          filter: brightness(0);
        }
      </style>
      <div
        class="help-content prose prose-base max-w-none px-6 py-3
          [&_a]:text-blue-700 [&_a:hover]:text-blue-900 [&_a]:underline transition-colors
          [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-gray-900 [&_h1]:border-b [&_h1]:border-black/10 [&_h1]:pb-2
          [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-blue-800
          [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-blue-700
          [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1.5
          [&_li]:text-gray-800 [&_li]:leading-relaxed [&_li]:text-[15px]
          [&_p]:text-gray-800 [&_p]:mb-3 [&_p]:leading-relaxed [&_p]:text-[15px]
          [&_strong]:text-gray-900 [&_strong]:font-bold"
      >
          <!-- terron: видео-туториал по OpenFront убран -->

          <!-- terron: Обучающая песочница (карта TERRON, слабые боты) -->
          <div class="flex items-center gap-3 mb-3">
            <div class="text-blue-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </div>
            <h3
              class="text-xl font-bold uppercase tracking-widest text-white/90"
            >
              ${L("Обучение", "Tutorial")}
            </h3>
            <div
              class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
            ></div>
          </div>
          <section>
            <div class="w-full flex flex-col items-center gap-2">
              <p class="mb-3 text-white/70 text-sm">
                ${L(
                  "Спокойная песочница с ботами — освой основы без риска проиграть.",
                  "A calm sandbox against bots — learn the basics with nothing to lose.",
                )}
              </p>
              ${tutorialButton(this.startTutorial)}
            </div>
          </section>

          <!-- Troubleshooting Section -->
          <div class="flex items-center gap-3 mb-3">
            <div class="text-blue-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M2 20 L12 0 L22 20 L2 20"></path>
                <line x1="12" y1="8" x2="12" y2="14"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
            </div>
            <h3
              class="text-xl font-bold uppercase tracking-widest text-white/90"
            >
              ${translateText("main.troubleshooting")}
            </h3>
            <div
              class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
            ></div>
          </div>
          <section>
            <div class="w-full flex flex-col items-center">
              <p class="mb-6 text-white/70 text-sm">
                ${translateText("help_modal.troubleshooting_desc")}
              </p>
              <button
                id="troubleshooting-button"
                class="hover:bg-black/[0.1] px-6 py-2 text-sm font-bold transition-all duration-200 rounded-lg uppercase tracking-widest bg-black/[0.05] border border-black/15"
                style="color:var(--t-ink,#fff)"
                data-page="page-troubleshooting"
                @click="${this.openTroubleshooting}"
                data-i18n="main.go_to_troubleshooting"
              >
                <span
                  class="relative z-10"
                  style="color:var(--t-ink,#fff)"
                  data-i18n="main.go_to_troubleshooting"
                ></span>
              </button>
            </div>
          </section>
          <!-- Hotkeys Section — скрыто в нативном приложении (Apple Guideline 4:
               клавиатурные подсказки на мобиле). На сайте остаётся. -->
          ${
            isNativeApp()
              ? ""
              : html`<details class="mb-8">
                  <summary
                    class="flex items-center gap-3 mb-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden"
                  >
                    <div class="text-blue-400">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="w-5 h-5 text-blue-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <rect
                          x="2"
                          y="4"
                          width="20"
                          height="16"
                          rx="2"
                          ry="2"
                        ></rect>
                        <path d="M6 8h.001"></path>
                        <path d="M10 8h.001"></path>
                        <path d="M14 8h.001"></path>
                        <path d="M18 8h.001"></path>
                        <path d="M6 12h.001"></path>
                        <path d="M10 12h.001"></path>
                        <path d="M14 12h.001"></path>
                        <path d="M18 12h.001"></path>
                        <path d="M6 16h12"></path>
                      </svg>
                    </div>
                    <h3
                      class="text-xl font-bold uppercase tracking-widest text-white/90"
                    >
                      ${translateText("help_modal.hotkeys")}
                    </h3>
                    <span class="text-white/50 text-lg leading-none">▾</span>
                    <div
                      class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
                    ></div>
                  </summary>
                  <section
                    class="bg-white/5 rounded-xl border border-white/10 overflow-hidden"
                  >
                    <div class="pt-2 pb-4 px-4 overflow-x-auto">
                      <table
                        class="w-full text-sm border-separate border-spacing-y-1"
                      >
                        <thead>
                          <tr
                            class="text-white/40 text-xs uppercase tracking-wider text-left"
                          >
                            <th class="pb-2 pl-4">
                              ${translateText("help_modal.table_key")}
                            </th>
                            <th class="pb-2">
                              ${translateText("help_modal.table_action")}
                            </th>
                          </tr>
                        </thead>
                        <tbody class="text-white/80">
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              ${this.renderKey("Escape")}
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_esc")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              ${this.renderKey("Enter")}
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_enter")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              ${this.renderKey(keybinds.toggleView)}
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_alt_view")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              ${this.renderKey(keybinds.coordinateGrid)}
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText(
                                "help_modal.action_coordinate_grid",
                              )}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              ${this.renderKey(keybinds.swapDirection)}
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.bomb_direction")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              <div class="inline-flex items-center gap-2">
                                ${this.renderKey(keybinds.shiftKey)}
                                <span class="text-white/40 font-bold">+</span>
                                <div
                                  class="w-5 h-8 border border-black/45 rounded-full relative"
                                >
                                  <div
                                    class="absolute top-0 left-0 w-1/2 h-1/2 bg-red-500/80 rounded-tl-full"
                                  ></div>
                                  <div
                                    class="w-0.5 h-1.5 bg-black/45 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"
                                  ></div>
                                </div>
                              </div>
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText(
                                "help_modal.action_attack_altclick",
                              )}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              <div class="inline-flex items-center gap-2">
                                ${this.renderKey(keybinds.buildMenuModifier)}
                                <span class="text-white/40 font-bold">+</span>
                                <div
                                  class="w-5 h-8 border border-black/45 rounded-full relative"
                                >
                                  <div
                                    class="absolute top-0 left-0 w-1/2 h-1/2 bg-red-500/80 rounded-tl-full"
                                  ></div>
                                  <div
                                    class="w-0.5 h-1.5 bg-black/45 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"
                                  ></div>
                                </div>
                              </div>
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_build")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              <div class="inline-flex items-center gap-2">
                                ${this.renderKey(keybinds.emojiMenuModifier)}
                                <span class="text-white/40 font-bold">+</span>
                                <div
                                  class="w-5 h-8 border border-black/45 rounded-full relative"
                                >
                                  <div
                                    class="absolute top-0 left-0 w-1/2 h-1/2 bg-red-500/80 rounded-tl-full"
                                  ></div>
                                  <div
                                    class="w-0.5 h-1.5 bg-black/45 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"
                                  ></div>
                                </div>
                              </div>
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_emote")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              ${this.renderKey(keybinds.centerCamera)}
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_center")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              ${this.renderKey(keybinds.pauseGame)}
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_pause_game")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              <div class="flex flex-wrap gap-2">
                                ${this.renderKey(keybinds.gameSpeedDown)}
                                ${this.renderKey(keybinds.gameSpeedUp)}
                              </div>
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_game_speed")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              <div class="flex flex-wrap gap-2">
                                ${this.renderKey(keybinds.zoomOut)}
                                ${this.renderKey(keybinds.zoomIn)}
                              </div>
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_zoom")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              <div class="flex flex-wrap gap-1 max-w-[200px]">
                                ${this.renderKey(keybinds.moveUp)}
                                ${this.renderKey(keybinds.moveLeft)}
                                ${this.renderKey(keybinds.moveDown)}
                                ${this.renderKey(keybinds.moveRight)}
                              </div>
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_move_camera")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              <div class="flex flex-wrap gap-2">
                                ${this.renderKey(keybinds.attackRatioDown)}
                                ${this.renderKey(keybinds.attackRatioUp)}
                              </div>
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_ratio_change")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              <div class="inline-flex items-center gap-2">
                                ${this.renderKey(keybinds.shiftKey)}
                                <span class="text-white/40 font-bold">+</span>
                                <div class="flex items-center gap-1">
                                  <div
                                    class="w-5 h-8 border border-black/45 rounded-full relative"
                                  >
                                    <div
                                      class="w-0.5 h-2 bg-red-400 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"
                                    ></div>
                                  </div>
                                  <div
                                    class="flex flex-col text-[10px] text-white/50"
                                  >
                                    <span>↑</span>
                                    <span>↓</span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_ratio_change")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              <div class="inline-flex items-center gap-2">
                                ${this.renderKey(keybinds.altKey)}
                                <span class="text-white/40 font-bold">+</span>
                                ${this.renderKey(keybinds.resetGfx)}
                              </div>
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_reset_gfx")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              <div
                                class="w-5 h-8 border border-black/45 rounded-full relative"
                              >
                                <div
                                  class="w-0.5 h-2 bg-red-400 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"
                                ></div>
                              </div>
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText("help_modal.action_auto_upgrade")}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              <div class="inline-flex items-center gap-2">
                                ${this.renderKey(keybinds.shiftKey)}
                                <span class="text-white/40 font-bold">+</span>
                                <span class="text-white/50 text-xs"
                                  >${translateText("help_modal.drag")}</span
                                >
                              </div>
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText(
                                "help_modal.action_warship_multiselect",
                              )}
                            </td>
                          </tr>
                          <tr class="hover:bg-white/5 transition-colors">
                            <td class="py-3 pl-4 border-b border-white/5">
                              ${this.renderKey(keybinds.selectAllWarships)}
                            </td>
                            <td
                              class="py-3 border-b border-white/5 text-white/70"
                            >
                              ${translateText(
                                "help_modal.action_warship_selectall",
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </section>
                </details>`
          }

          <!-- UI Interface Section -->
          <section class="mb-8 mt-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="3" y1="9" x2="21" y2="9"></line>
                  <line x1="9" y1="21" x2="9" y2="9"></line>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.ui_section")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <div class="grid grid-cols-1 gap-6">
              <!-- Leaderboard -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_leaderboard")}</span
                  >
                  ${this.shot("images/helpModal/leaderboard2.webp", "Leaderboard", "rounded-lg shadow-lg border border-white/20 max-w-[200px]")}
                </div>
                <div
                  class="flex items-center text-white/70 text-sm leading-relaxed"
                >
                  <p>${translateText("help_modal.ui_leaderboard_desc")}</p>
                </div>
              </div>

              <!-- Control Panel -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_control")}</span
                  >
                  ${this.shot("images/helpModal/controlPanel.webp", "Control Panel", "rounded-lg shadow-lg border border-white/20 max-w-[200px]")}
                </div>
                <div class="flex flex-col justify-center text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.ui_control_desc")}
                  </p>
                  <ul class="space-y-2 list-disc pl-4 text-white/60">
                    <li>${translateText("help_modal.ui_gold")}</li>
                    <li>${translateText("help_modal.ui_attack_ratio")}</li>
                  </ul>
                </div>
              </div>

              <!-- Events Panel -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_events")}</span
                  >
                  <div class="flex flex-col gap-2">
                    ${this.shot("images/helpModal/eventsPanel.webp", "Events", "rounded-lg shadow-lg border border-white/20 max-w-[200px]")}
                    ${this.shot("images/helpModal/eventsPanelAttack.webp", "Events Attack", "rounded-lg shadow-lg border border-white/20 max-w-[200px]")}
                  </div>
                </div>
                <div class="flex flex-col justify-center text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.ui_events_desc")}
                  </p>
                  <ul class="space-y-2 list-disc pl-4 text-white/60">
                    <li>${translateText("help_modal.ui_events_alliance")}</li>
                    <li>${translateText("help_modal.ui_events_attack")}</li>
                    <li>${translateText("help_modal.ui_events_quickchat")}</li>
                  </ul>
                </div>
              </div>

              <!-- Options -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_options")}</span
                  >
                  ${this.shot("images/helpModal/options2.webp", "Options", "rounded-lg shadow-lg border border-white/20 max-w-[200px]")}
                </div>
                <div class="flex flex-col justify-center text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.ui_options_desc")}
                  </p>
                  <ul class="space-y-2 list-disc pl-4 text-white/60">
                    <li>${translateText("help_modal.option_timer")}</li>
                    <li>${translateText("help_modal.option_speed")}</li>
                    <li>${translateText("help_modal.option_pause")}</li>
                    <li>${translateText("help_modal.option_settings")}</li>
                    <li>${translateText("help_modal.option_exit")}</li>
                  </ul>
                </div>
              </div>

              <!-- Player Overlay -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_playeroverlay")}</span
                  >
                  ${this.shot("images/helpModal/playerInfoOverlay.webp", "Player Info", "rounded-lg shadow-lg border border-white/20 max-w-[200px]")}
                </div>
                <div
                  class="flex items-center text-white/70 text-sm leading-relaxed"
                >
                  <p>${translateText("help_modal.ui_playeroverlay_desc")}</p>
                </div>
              </div>
            </div>
          </section>

          <!-- Radial Menu Section -->
          <section class="mb-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.radial_title")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <div
              class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
            >
              <div class="flex flex-col gap-4 shrink-0">
                ${this.shot("images/helpModal/radialMenu2.webp", "Radial Menu", "rounded-lg shadow-lg border border-white/20 max-w-[200px]")}
                ${this.shot("images/helpModal/radialMenuAlly.webp", "Radial Menu Ally", "rounded-lg shadow-lg border border-white/20 max-w-[200px]")}
              </div>
              <div class="text-white/70 text-sm">
                <p class="mb-4 leading-relaxed">
                  ${translateText("help_modal.radial_desc")}
                </p>
                <ul class="space-y-3">
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/BuildIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span>${translateText("help_modal.radial_build")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/InfoIcon.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span>${translateText("help_modal.radial_info")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/BoatIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span>${translateText("help_modal.radial_boat")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/AllianceIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span>${translateText("help_modal.info_alliance")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/TraitorIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span>${translateText("help_modal.ally_betray")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/DonateTroopIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span
                      >${translateText("help_modal.radial_donate_troops")}</span
                    >
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src=${assetUrl("images/DonateGoldIconWhite.svg")}
                      class="w-8 h-8 scale-75 origin-left"
                    />
                    <span
                      >${translateText("help_modal.radial_donate_gold")}</span
                    >
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <!-- Info/Ally Panels Section -->
          <section class="mb-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.info_title")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <!-- Enemy Info -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.info_enemy_panel")}</span
                  >
                  ${this.shot("images/helpModal/infoMenu2.webp", "Enemy Info", "rounded-lg shadow-lg border border-white/20 max-w-[240px]")}
                </div>
                <div class="text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.info_enemy_desc")}
                  </p>
                  <ul class="space-y-3">
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/ChatIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.info_chat")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/TargetIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.info_target")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/AllianceIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.info_alliance")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/EmojiIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.info_emoji")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/StopIconWhite.png")}
                        class="w-8 h-8 scale-75 origin-left"
                        loading="lazy"
                      />
                      <span>${translateText("help_modal.info_trade")}</span>
                    </li>
                  </ul>
                </div>
              </div>

              <!-- Ally Info -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.info_ally_panel")}</span
                  >
                  ${this.shot("images/helpModal/infoMenu2Ally.webp", "Ally Info", "rounded-lg shadow-lg border border-white/20 max-w-[240px]")}
                </div>
                <div class="text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.info_ally_desc")}
                  </p>
                  <ul class="space-y-3">
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/TraitorIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.ally_betray")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/DonateTroopIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span>${translateText("help_modal.ally_donate")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <img
                        src=${assetUrl("images/DonateGoldIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                      <span
                        >${translateText("help_modal.ally_donate_gold")}</span
                      >
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <!-- Build Menu Section -->
          <section class="mb-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path>
                  <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path>
                  <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.build_menu_title")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <p class="mb-4 text-white/70 text-sm">
              ${translateText("help_modal.build_menu_desc")}
            </p>

            <div class="overflow-hidden rounded-xl border border-white/10">
              <table class="w-full border-collapse">
                <thead class="bg-white/10">
                  <tr>
                    <th
                      class="py-3 pl-4 text-left text-xs font-bold uppercase tracking-wider text-blue-300 w-[20%]"
                    >
                      ${translateText("help_modal.build_name")}
                    </th>
                    <th
                      class="py-3 text-left text-xs font-bold uppercase tracking-wider text-blue-300 w-[8%]"
                    >
                      ${translateText("help_modal.build_icon")}
                    </th>
                    <th
                      class="py-3 text-left text-xs font-bold uppercase tracking-wider text-blue-300"
                    >
                      ${translateText("help_modal.build_desc")}
                    </th>
                  </tr>
                </thead>
                <tbody class="text-white/80">
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_city")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/CityIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_city_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_defense")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/ShieldIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_defense_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_port")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/PortIcon.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_port_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_factory")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/FactoryIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_factory_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_warship")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/BattleshipIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_warship_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_silo")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/MissileSiloIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_silo_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_sam")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/SamLauncherIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_sam_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_atom")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/NukeIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_atom_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_hydrogen")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/MushroomCloudIconWhite.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_hydrogen_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_mirv")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <img
                        src=${assetUrl("images/MIRVIcon.svg")}
                        class="w-8 h-8 scale-75 origin-left"
                      />
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_mirv_desc")}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Player Icons Section -->
          <section class="mb-4">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.player_icons")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <p class="mb-6 text-white/70 text-sm">
              ${translateText("help_modal.icon_desc")}
            </p>

            <div class="grid grid-cols-2 md:grid-cols-3 gap-6">
              <!-- Crown -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                ${this.shot("images/helpModal/crown.webp", "Rank 1", "rounded shadow-lg border border-white/10 h-24 w-auto object-contain")}
                <span
                  class="text-xs font-bold uppercase tracking-wider text-white text-center"
                >
                  ${translateText("help_modal.icon_crown")}
                </span>
              </div>

              <!-- Traitor -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                ${this.shot("images/helpModal/traitor2.webp", "Traitor", "rounded shadow-lg border border-white/10 h-24 w-auto object-contain")}
                <span
                  class="text-xs font-bold uppercase tracking-wider text-white text-center"
                >
                  ${translateText("help_modal.icon_traitor")}
                </span>
              </div>

              <!-- Ally -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                ${this.shot("images/helpModal/ally2.webp", "Ally", "rounded shadow-lg border border-white/10 h-24 w-auto object-contain")}
                <span
                  class="text-xs font-bold uppercase tracking-wider text-white text-center"
                >
                  ${translateText("help_modal.icon_ally")}
                </span>
              </div>

              <!-- Embargo -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                ${this.shot("images/helpModal/embargo.webp", "Embargo", "rounded shadow-lg border border-white/10 h-24 w-auto object-contain")}
                <span
                  class="text-xs font-bold uppercase tracking-wider text-white text-center"
                >
                  ${translateText("help_modal.icon_embargo")}
                </span>
              </div>

              <!-- Alliance Request -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                ${this.shot("images/helpModal/allianceRequest.webp", "Request", "rounded shadow-lg border border-white/10 h-24 w-auto object-contain")}
                <span
                  class="text-xs font-bold uppercase tracking-wider text-white text-center"
                >
                  ${translateText("help_modal.icon_request")}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
  }

  private startTutorial = () => {
    void launchTutorial(this);
    this.close();
  };

  openTroubleshooting() {
    const troubleshootingModal = document.querySelector(
      "troubleshooting-modal",
    ) as TroubleshootingModal;
    if (
      !troubleshootingModal ||
      !(troubleshootingModal instanceof TroubleshootingModal)
    ) {
      console.warn("Troubleshooting modal element not found");
      return;
    }
    troubleshootingModal.open();
  }

  protected onOpen(): void {
    this.keybinds = this.getKeybinds();
    // Restore the video src when modal opens
    if (this.videoIframe) {
      this.videoIframe.src = TUTORIAL_VIDEO_URL;
    }
  }

  protected onClose(): void {
    // Clear the iframe src to stop video playback
    if (this.videoIframe) {
      this.videoIframe.src = "";
    }
  }
}

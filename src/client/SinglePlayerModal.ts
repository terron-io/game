import { isDevSite } from "./Utils";
import { TemplateResult, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { L, translateText } from "../client/Utils";
import { UserMeResponse } from "../core/ApiSchemas";
import { assetUrl } from "../core/AssetUrls";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "../core/game/Game";
import { listCachedMapNames } from "../core/game/MapCache";
import { TeamCountConfig } from "../core/Schemas";
import { generateID } from "../core/Util";
import { hasLinkedAccount } from "./Api";
import { prefetchLobbyMap } from "./ClientGameRunner";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/GameConfigSettings";
import "./components/ToggleInputCard";
import { modalHeader } from "./components/ui/ModalHeader";
import { getLocalStartCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import { isBundledOfflineMap, isOffline, onOfflineChange } from "./Offline";
import { toast } from "./Toast";
import { UsernameInput } from "./UsernameInput";
import {
  getBotsForCompactMap,
  getNationsForCompactMap,
  getRandomMapType,
  getUpdatedDisabledUnits,
  parseBoundedFloatFromInput,
  parseBoundedIntegerFromInput,
  preventDisallowedKeys,
  sliderToNationsConfig,
  toOptionalNumber,
} from "./utilities/GameConfigHelpers";

import { terrainMapFileLoader } from "./TerrainMapFileLoader";

const DEFAULT_OPTIONS = {
  selectedMap: GameMapType.World,
  selectedDifficulty: Difficulty.Easy,
  bots: 400,
  infiniteGold: false,
  infiniteTroops: false,
  compactMap: false,
  maxTimer: false,
  maxTimerValue: undefined as number | undefined,
  instantBuild: false,
  randomSpawn: false,
  useRandomMap: false,
  gameMode: GameMode.FFA,
  teamCount: 2 as TeamCountConfig,
  goldMultiplier: false,
  goldMultiplierValue: undefined as number | undefined,
  startingGold: false,
  startingGoldValue: undefined as number | undefined,
  disabledUnits: [] as UnitType[],
  disableAlliances: false,
  waterNukes: false,
  fogOfWar: false,
  // terron: ДЕВ-ПЕСОЧНИЦА ЗАМКОВ (только на dev). TZ-ult-unlocks.md
  devUnlockUlts: false,
} as const;

@customElement("single-player-modal")
export class SinglePlayerModal extends BaseModal {
  protected routerName = "single-player";

  @state() private selectedMap: GameMapType = DEFAULT_OPTIONS.selectedMap;
  @state() private selectedDifficulty: Difficulty =
    DEFAULT_OPTIONS.selectedDifficulty;
  @state() private nations: number = 0;
  @state() private defaultNationCount: number = 0;
  @state() private bots: number = DEFAULT_OPTIONS.bots;
  @state() private infiniteGold: boolean = DEFAULT_OPTIONS.infiniteGold;
  @state() private infiniteTroops: boolean = DEFAULT_OPTIONS.infiniteTroops;
  @state() private compactMap: boolean = DEFAULT_OPTIONS.compactMap;
  @state() private maxTimer: boolean = DEFAULT_OPTIONS.maxTimer;
  @state() private maxTimerValue: number | undefined =
    DEFAULT_OPTIONS.maxTimerValue;
  @state() private instantBuild: boolean = DEFAULT_OPTIONS.instantBuild;
  @state() private randomSpawn: boolean = DEFAULT_OPTIONS.randomSpawn;
  @state() private useRandomMap: boolean = DEFAULT_OPTIONS.useRandomMap;
  @state() private gameMode: GameMode = DEFAULT_OPTIONS.gameMode;
  @state() private teamCount: TeamCountConfig = DEFAULT_OPTIONS.teamCount;
  @state() private showAchievements: boolean = false;
  @state() private mapWins: Map<GameMapType, Set<Difficulty>> = new Map();
  @state() private userMeResponse: UserMeResponse | false = false;
  @state() private goldMultiplier: boolean = DEFAULT_OPTIONS.goldMultiplier;
  @state() private goldMultiplierValue: number | undefined =
    DEFAULT_OPTIONS.goldMultiplierValue;
  @state() private startingGold: boolean = DEFAULT_OPTIONS.startingGold;
  @state() private startingGoldValue: number | undefined =
    DEFAULT_OPTIONS.startingGoldValue;

  @state() private disabledUnits: UnitType[] = [
    ...DEFAULT_OPTIONS.disabledUnits,
  ];
  @state() private disableAlliances: boolean = DEFAULT_OPTIONS.disableAlliances;
  @state() private waterNukes: boolean = DEFAULT_OPTIONS.waterNukes;
  @state() private fogOfWar: boolean = DEFAULT_OPTIONS.fogOfWar;
  @state() private devUnlockUlts: boolean = DEFAULT_OPTIONS.devUnlockUlts;
  @state() private offline: boolean = isOffline();

  private mapLoader = terrainMapFileLoader;
  private offlineUnsub: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    this.offline = isOffline();
    this.offlineUnsub = onOfflineChange((off) => {
      this.offline = off;
    });
    void this.loadNationCount();
  }

  disconnectedCallback() {
    document.removeEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    this.offlineUnsub?.();
    this.offlineUnsub = null;
    super.disconnectedCallback();
  }

  private toggleAchievements = () => {
    this.showAchievements = !this.showAchievements;
  };

  private handleUserMeResponse = (
    event: CustomEvent<UserMeResponse | false>,
  ) => {
    this.userMeResponse = event.detail;
    this.applyAchievements(event.detail);
  };

  private renderNotLoggedInBanner(): TemplateResult {
    if (crazyGamesSDK.isOnCrazyGames()) {
      return html``;
    }
    return html`<button
      class="px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 whitespace-nowrap shrink-0 cursor-pointer hover:bg-yellow-500/30"
      @click=${() => {
        this.close();
        window.showPage?.("page-account");
      }}
    >
      ${translateText("single_modal.sign_in_for_achievements")}
    </button>`;
  }

  private applyAchievements(userMe: UserMeResponse | false) {
    if (!userMe) {
      this.mapWins = new Map();
      return;
    }

    const completions = userMe.player.achievements.singleplayerMap;

    const winsMap = new Map<GameMapType, Set<Difficulty>>();
    for (const entry of completions) {
      const { mapName, difficulty } = entry ?? {};
      const isValidMap =
        typeof mapName === "string" &&
        Object.values(GameMapType).includes(mapName as GameMapType);
      const isValidDifficulty =
        typeof difficulty === "string" &&
        Object.values(Difficulty).includes(difficulty as Difficulty);
      if (!isValidMap || !isValidDifficulty) continue;

      const map = mapName as GameMapType;
      const set = winsMap.get(map) ?? new Set<Difficulty>();
      set.add(difficulty as Difficulty);
      winsMap.set(map, set);
    }

    this.mapWins = winsMap;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("main.solo") || "Solo",
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent: hasLinkedAccount(this.userMeResponse)
        ? html`<button
            @click=${this.toggleAchievements}
            class="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all shrink-0 ${this
              .showAchievements
              ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
              : "text-white/60"}"
          >
            <img
              src=${assetUrl("images/MedalIconWhite.svg")}
              class="w-4 h-4 opacity-80 shrink-0"
              style="${this.showAchievements ? "" : "filter: grayscale(1);"}"
            />
            <span
              class="text-xs font-bold uppercase tracking-wider whitespace-nowrap"
              >${translateText("single_modal.toggle_achievements")}</span
            >
          </button>`
        : // terron: «авторизуйся для ачивок» убран из соло-модалки (по просьбе)
          html``,
    });
  }

  protected renderBody() {
    const inputCards = [
      html`<toggle-input-card
        .labelKey=${"single_modal.max_timer"}
        .checked=${this.maxTimer}
        .inputId=${"end-timer-value"}
        .inputMin=${1}
        .inputMax=${120}
        .inputValue=${this.maxTimerValue}
        .inputAriaLabel=${translateText("single_modal.max_timer")}
        .inputPlaceholder=${translateText("single_modal.max_timer_placeholder")}
        .defaultInputValue=${30}
        .minValidOnEnable=${1}
        .onToggle=${this.handleMaxTimerToggle}
        .onInput=${this.handleMaxTimerValueChanges}
        .onKeyDown=${this.handleMaxTimerValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"single_modal.gold_multiplier"}
        .checked=${this.goldMultiplier}
        .inputId=${"gold-multiplier-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.goldMultiplierValue}
        .inputAriaLabel=${translateText("single_modal.gold_multiplier")}
        .inputPlaceholder=${translateText(
          "single_modal.gold_multiplier_placeholder",
        )}
        .defaultInputValue=${2}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleGoldMultiplierToggle}
        .onChange=${this.handleGoldMultiplierValueChanges}
        .onKeyDown=${this.handleGoldMultiplierValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"single_modal.starting_gold"}
        .checked=${this.startingGold}
        .inputId=${"starting-gold-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.startingGoldValue}
        .inputAriaLabel=${translateText("single_modal.starting_gold")}
        .inputPlaceholder=${translateText(
          "single_modal.starting_gold_placeholder",
        )}
        .defaultInputValue=${5}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleStartingGoldToggle}
        .onChange=${this.handleStartingGoldValueChanges}
        .onKeyDown=${this.handleStartingGoldValueKeyDown}
      ></toggle-input-card>`,
    ];

    return html`
      <div class="mx-auto w-full max-w-5xl px-6 pt-4 pb-28">
        <game-config-settings
          class="block"
          .sectionGapClass=${"space-y-6"}
          .settings=${{
            map: {
              selected: this.selectedMap,
              useRandom: this.useRandomMap,
              showMedals: this.showAchievements,
              mapWins: this.mapWins,
            },
            difficulty: {
              selected: this.selectedDifficulty,
              disabled: this.nations === 0,
            },
            gameMode: {
              selected: this.gameMode,
            },
            teamCount: {
              selected: this.teamCount,
            },
            options: {
              titleKey: "single_modal.options_title",
              bots: {
                value: this.bots,
                labelKey: "single_modal.bots",
                disabledKey: "single_modal.bots_disabled",
              },
              nations: {
                value: this.nations,
                defaultValue: this.defaultNationCount,
                labelKey: "single_modal.nations",
                disabledKey: "single_modal.nations_disabled",
              },
              toggles: [
                {
                  labelKey: "single_modal.instant_build",
                  checked: this.instantBuild,
                },
                {
                  labelKey: "single_modal.random_spawn",
                  checked: this.randomSpawn,
                },
                {
                  labelKey: "single_modal.infinite_gold",
                  checked: this.infiniteGold,
                },
                {
                  labelKey: "single_modal.infinite_troops",
                  checked: this.infiniteTroops,
                },
                {
                  labelKey: "single_modal.compact_map",
                  checked: this.compactMap,
                },
                {
                  labelKey: "single_modal.disable_alliances",
                  checked: this.disableAlliances,
                },
                {
                  labelKey: "single_modal.water_nukes",
                  checked: this.waterNukes,
                },
                {
                  labelKey: "single_modal.fog_of_war",
                  checked: this.fogOfWar,
                },
                // terron: видна только на деве — на проде снимать нечего.
                ...(isDevSite()
                  ? [
                      {
                        labelKey: "single_modal.dev_unlock_ults",
                        checked: this.devUnlockUlts,
                      },
                    ]
                  : []),
              ],
              inputCards,
            },
            unitTypes: {
              titleKey: "single_modal.enables_title",
              disabledUnits: this.disabledUnits,
            },
          }}
          @map-selected=${this.handleConfigMapSelected}
          @random-map-selected=${this.handleConfigRandomMapSelected}
          @difficulty-selected=${this.handleConfigDifficultySelected}
          @game-mode-selected=${this.handleConfigGameModeSelected}
          @team-count-selected=${this.handleConfigTeamCountSelected}
          @bots-changed=${this.handleBotsChange}
          @nations-changed=${this.handleNationsChange}
          @option-toggle-changed=${this.handleConfigOptionToggleChanged}
          @unit-toggle-changed=${this.handleConfigUnitToggleChanged}
        ></game-config-settings>
        <!-- Предупреждения остаются в скролле; кнопка «Старт» — в фикс-баре
               (showStartBar в document.body, как HostLobbyModal: всегда внизу). -->
        ${this.offline
          ? html`<div
              class="mt-5 px-4 py-3 rounded-xl bg-sky-100 border border-sky-400 text-sky-900 text-xs font-bold uppercase tracking-wider text-center"
            >
              ${L(
                "Офлайн-режим: награды (валюты, ачивки, рейтинг) не начисляются",
                "Offline mode: no rewards (currencies, achievements, rating)",
              )}
            </div>`
          : null}
        ${hasLinkedAccount(this.userMeResponse) && this.hasOptionsChanged()
          ? html`<div
              class="mt-3 px-4 py-3 rounded-xl bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-bold uppercase tracking-wider text-center"
            >
              ${translateText("single_modal.options_changed_no_achievements")}
            </div>`
          : null}
      </div>
    `;
  }

  // terron: кнопка «Старт» вынесена в ФИКС-БАР в document.body (как HostLobbyModal)
  // — это единственный надёжный способ держать её внизу на iPad-WKWebView
  // (slot/sticky внутри o-modal не срабатывали). show в onOpen, hide в onClose.
  private startBarEl: HTMLDivElement | null = null;
  private showStartBar(): void {
    if (this.startBarEl) return;
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:100000;" +
      "padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));" +
      "background:rgba(17,24,39,.97);border-top:1px solid rgba(255,255,255,.12);" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);" +
      "display:flex;justify-content:center";
    const btn = document.createElement("button");
    btn.textContent = translateText("single_modal.start");
    btn.style.cssText =
      "width:100%;max-width:64rem;padding:15px;border:0;border-radius:10px;" +
      "background:#16a34a;color:#fff;cursor:pointer;" +
      "font:700 16px/1.2 'Golos Text',system-ui,sans-serif;" +
      "text-transform:uppercase;letter-spacing:.04em";
    btn.addEventListener("click", () => void this.startGame());
    bar.appendChild(btn);
    document.body.appendChild(bar);
    this.startBarEl = bar;
  }
  private hideStartBar(): void {
    this.startBarEl?.remove();
    this.startBarEl = null;
  }

  // terron: оверлей «Загрузка карты…» на время синхронной загрузки карты
  // (иначе немой фриз 3-6с). Снимается в Main.ts когда игра реально загрузилась
  // (document.getElementById("terron-loading")?.remove()).
  private showLoadingOverlay(): void {
    if (document.getElementById("terron-loading")) return;
    const o = document.createElement("div");
    o.id = "terron-loading";
    o.style.cssText =
      "position:fixed;inset:0;z-index:100001;display:flex;flex-direction:column;" +
      "align-items:center;justify-content:center;gap:14px;background:rgba(10,12,18,.93);" +
      "color:#fff;font:700 18px/1.3 'Golos Text',system-ui,sans-serif;letter-spacing:.03em";
    const spin = document.createElement("div");
    spin.style.cssText =
      "width:34px;height:34px;border:3px solid rgba(255,255,255,.25);" +
      "border-top-color:#16a34a;border-radius:50%;animation:terron-spin 0.8s linear infinite";
    if (!document.getElementById("terron-spin-kf")) {
      const st = document.createElement("style");
      st.id = "terron-spin-kf";
      st.textContent = "@keyframes terron-spin{to{transform:rotate(360deg)}}";
      document.head.appendChild(st);
    }
    const txt = document.createElement("div");
    txt.textContent = L("Загрузка карты…", "Loading map…");
    o.appendChild(spin);
    o.appendChild(txt);
    document.body.appendChild(o);
  }

  // Check if any options other than map and difficulty have been changed from defaults
  private hasOptionsChanged(): boolean {
    return (
      this.nations !== this.defaultNationCount ||
      this.bots !== DEFAULT_OPTIONS.bots ||
      this.infiniteGold !== DEFAULT_OPTIONS.infiniteGold ||
      this.infiniteTroops !== DEFAULT_OPTIONS.infiniteTroops ||
      this.compactMap !== DEFAULT_OPTIONS.compactMap ||
      this.maxTimer !== DEFAULT_OPTIONS.maxTimer ||
      this.instantBuild !== DEFAULT_OPTIONS.instantBuild ||
      this.randomSpawn !== DEFAULT_OPTIONS.randomSpawn ||
      this.gameMode !== DEFAULT_OPTIONS.gameMode ||
      this.goldMultiplier !== DEFAULT_OPTIONS.goldMultiplier ||
      this.startingGold !== DEFAULT_OPTIONS.startingGold ||
      this.disableAlliances !== DEFAULT_OPTIONS.disableAlliances ||
      this.waterNukes !== DEFAULT_OPTIONS.waterNukes ||
      this.fogOfWar !== DEFAULT_OPTIONS.fogOfWar ||
      this.disabledUnits.length > 0
    );
  }

  protected onClose(): void {
    this.hideStartBar();
    // Reset all transient form state to ensure clean slate
    this.selectedMap = DEFAULT_OPTIONS.selectedMap;
    this.selectedDifficulty = DEFAULT_OPTIONS.selectedDifficulty;
    this.gameMode = DEFAULT_OPTIONS.gameMode;
    this.useRandomMap = DEFAULT_OPTIONS.useRandomMap;
    this.bots = DEFAULT_OPTIONS.bots;
    this.nations = 0;
    this.defaultNationCount = 0;
    this.infiniteGold = DEFAULT_OPTIONS.infiniteGold;
    this.infiniteTroops = DEFAULT_OPTIONS.infiniteTroops;
    this.compactMap = DEFAULT_OPTIONS.compactMap;
    this.maxTimer = DEFAULT_OPTIONS.maxTimer;
    this.maxTimerValue = DEFAULT_OPTIONS.maxTimerValue;
    this.instantBuild = DEFAULT_OPTIONS.instantBuild;
    this.randomSpawn = DEFAULT_OPTIONS.randomSpawn;
    this.teamCount = DEFAULT_OPTIONS.teamCount;
    this.disabledUnits = [...DEFAULT_OPTIONS.disabledUnits];
    this.goldMultiplier = DEFAULT_OPTIONS.goldMultiplier;
    this.goldMultiplierValue = DEFAULT_OPTIONS.goldMultiplierValue;
    this.startingGold = DEFAULT_OPTIONS.startingGold;
    this.startingGoldValue = DEFAULT_OPTIONS.startingGoldValue;
    this.disableAlliances = DEFAULT_OPTIONS.disableAlliances;
    this.waterNukes = DEFAULT_OPTIONS.waterNukes;
    this.fogOfWar = DEFAULT_OPTIONS.fogOfWar;
    this.devUnlockUlts = DEFAULT_OPTIONS.devUnlockUlts;
  }

  protected onOpen(): void {
    void this.loadNationCount();
    this.showStartBar();
    // terron: симметрия с онлайн-лобби — карту греем с ОТКРЫТИЯ модалки
    // (как prefetchLobbyMap на lobby_info), а не по кнопке «Старт». Иначе на
    // медленном инете 10-20МБ бинов качались уже «в игре» (баг холодного старта).
    if (!isOffline()) prefetchLobbyMap(this.selectedMap);
  }

  private handleSelectRandomMap() {
    this.useRandomMap = true;
    this.selectedMap = getRandomMapType();
    void this.loadNationCount();
    if (!isOffline()) prefetchLobbyMap(this.selectedMap);
  }

  private handleConfigRandomMapSelected = () => {
    this.handleSelectRandomMap();
  };

  private handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
    void this.loadNationCount();
    if (!isOffline()) prefetchLobbyMap(value);
  }

  private handleConfigMapSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ map: GameMapType }>;
    this.handleMapSelection(customEvent.detail.map);
  };

  private handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
  }

  private handleConfigDifficultySelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ difficulty: Difficulty }>;
    this.handleDifficultySelection(customEvent.detail.difficulty);
  };

  private handleConfigGameModeSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ mode: GameMode }>;
    this.handleGameModeSelection(customEvent.detail.mode);
  };

  private handleConfigTeamCountSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ count: TeamCountConfig }>;
    this.handleTeamCountSelection(customEvent.detail.count);
  };

  private handleCompactMapChange(val: boolean) {
    this.compactMap = val;
    this.bots = getBotsForCompactMap(this.bots, val);
    this.nations = getNationsForCompactMap(
      this.nations,
      this.defaultNationCount,
      val,
    );
  }

  private handleConfigOptionToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{
      labelKey: string;
      checked: boolean;
    }>;
    const { labelKey, checked } = customEvent.detail;

    switch (labelKey) {
      case "single_modal.instant_build":
        this.instantBuild = checked;
        break;
      case "single_modal.random_spawn":
        this.randomSpawn = checked;
        break;
      case "single_modal.infinite_gold":
        this.infiniteGold = checked;
        break;
      case "single_modal.infinite_troops":
        this.infiniteTroops = checked;
        break;
      case "single_modal.compact_map":
        this.handleCompactMapChange(checked);
        break;
      case "single_modal.disable_alliances":
        this.disableAlliances = checked;
        break;
      case "single_modal.water_nukes":
        this.waterNukes = checked;
        break;
      case "single_modal.fog_of_war":
        this.fogOfWar = checked;
        break;
      case "single_modal.dev_unlock_ults":
        this.devUnlockUlts = checked;
        break;
      default:
        break;
    }
  };

  private handleConfigUnitToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{ unit: UnitType; checked: boolean }>;
    const { unit, checked } = customEvent.detail;
    this.disabledUnits = getUpdatedDisabledUnits(
      this.disabledUnits,
      unit,
      checked,
    );
  };

  private handleBotsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.bots = value;
  };

  private handleNationsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.nations = value;
  };

  private handleMaxTimerToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.maxTimer = checked;
    this.maxTimerValue = toOptionalNumber(value);
  };

  private handleGoldMultiplierToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.goldMultiplier = checked;
    this.goldMultiplierValue = toOptionalNumber(value);
  };

  private handleStartingGoldToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.startingGold = checked;
    this.startingGoldValue = toOptionalNumber(value);
  };

  private handleMaxTimerValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private getEndTimerInput(): HTMLInputElement | null {
    return (
      (this.renderRoot.querySelector(
        "#end-timer-value",
      ) as HTMLInputElement | null) ??
      (this.querySelector("#end-timer-value") as HTMLInputElement | null)
    );
  }

  private handleMaxTimerValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 1,
      max: 120,
      stripPattern: /[e+-]/gi,
    });

    this.maxTimerValue = value;
  };

  private handleGoldMultiplierValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["+", "-", "e", "E"]);
  };

  private handleGoldMultiplierValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, { min: 0.1, max: 1000 });

    if (value === undefined) {
      this.goldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.goldMultiplierValue = value;
    }
  };

  private handleStartingGoldValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleStartingGoldValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, {
      min: 0.1,
      max: 1000,
    });

    if (value === undefined) {
      this.startingGoldValue = undefined;
      input.value = "";
    } else {
      this.startingGoldValue = value;
    }
  };

  private handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
  }

  private handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
  }

  // terron: гард от двойного старта (см. HostLobbyModal.offlineStarting).
  private spStarting = false;

  private async startGame() {
    if (this.spStarting) return;
    this.spStarting = true;
    try {
      await this.startGameInner();
    } finally {
      this.spStarting = false;
    }
  }

  private async startGameInner() {
    // terron: офлайн — играбельны ТОЛЬКО закешированные карты (World прегрет +
    // сыгранные онлайн). Иначе движок уйдёт fetch'ить map.bin и упадёт
    // «Connection error». Поэтому проверяем доступность ДО старта.
    if (isOffline()) {
      const cached = await listCachedMapNames();
      const folderOf = (m: GameMapType): string =>
        (
          Object.keys(GameMapType).find(
            (k) => GameMapType[k as keyof typeof GameMapType] === m,
          ) ?? ""
        ).toLowerCase();
      // карта играбельна офлайн если: закеширована (MapCache) ИЛИ вшита в
      // нативный бандл (Capacitor-апка — локальные файлы).
      const playableOffline = (m: GameMapType): boolean =>
        cached.has(folderOf(m)) || isBundledOfflineMap(folderOf(m));
      if (this.useRandomMap) {
        const avail = (Object.values(GameMapType) as GameMapType[]).filter(
          playableOffline,
        );
        if (avail.length === 0) {
          toast(
            L(
              "Офлайн-карты ещё не загружены — зайдите один раз онлайн.",
              "No offline maps yet — go online once.",
            ),
          );
          return;
        }
        this.selectedMap = avail[Math.floor(Math.random() * avail.length)];
      } else if (!playableOffline(this.selectedMap)) {
        toast(
          L(
            "Эта карта недоступна офлайн. Сыграйте в неё раз онлайн (Мир кешируется автоматически).",
            "This map isn't available offline. Play it once online (World is cached automatically).",
          ),
        );
        return;
      }
    }

    // Validate and clamp maxTimer setting before starting
    let finalMaxTimerValue: number | undefined = undefined;
    if (this.maxTimer) {
      if (!this.maxTimerValue || this.maxTimerValue <= 0) {
        console.error("Max timer is enabled but no valid value is set");
        toast(
          translateText("single_modal.max_timer_invalid") ||
            "Please enter a valid max timer value (1-120 minutes)",
        );
        // Focus the input
        const input = this.getEndTimerInput();
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      // Clamp value to valid range
      finalMaxTimerValue = Math.max(1, Math.min(120, this.maxTimerValue));
    }

    console.log(
      `Starting single player game with map: ${GameMapType[this.selectedMap as keyof typeof GameMapType]}${this.useRandomMap ? " (Randomly selected)" : ""}`,
    );
    const clientID = generateID();
    const gameID = generateID();

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;

    await crazyGamesSDK.requestMidgameAd();

    // terron: офлайн-старт грузит карту синхронно (3-6с на старом iPad) → показываем
    // оверлей «Загрузка карты…», иначе немой фриз. Снимается в Main.ts при старте.
    this.showLoadingOverlay();

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: gameID,
          gameStartInfo: {
            gameID: gameID,
            players: [
              {
                clientID,
                username: usernameInput.getUsername(),
                clanTag: usernameInput.getClanTag() ?? null,
                cosmetics: await getLocalStartCosmetics(
                  usernameInput.getUsername(),
                ),
              },
            ],
            config: {
              gameMap: this.selectedMap,
              gameMapSize: this.compactMap
                ? GameMapSize.Compact
                : GameMapSize.Normal,
              gameType: GameType.Singleplayer,
              gameMode: this.gameMode,
              playerTeams: this.teamCount,
              difficulty: this.selectedDifficulty,
              maxTimerValue: finalMaxTimerValue,
              bots: this.bots,
              infiniteGold: this.infiniteGold,
              donateGold: this.gameMode === GameMode.Team,
              donateTroops: this.gameMode === GameMode.Team,
              infiniteTroops: this.infiniteTroops,
              instantBuild: this.instantBuild,
              randomSpawn: this.randomSpawn,
              disabledUnits: this.disabledUnits
                .map((u) => Object.values(UnitType).find((ut) => ut === u))
                .filter((ut): ut is UnitType => ut !== undefined),
              nations: sliderToNationsConfig(
                this.nations,
                this.defaultNationCount,
              ),
              ...(this.goldMultiplier && this.goldMultiplierValue
                ? { goldMultiplier: this.goldMultiplierValue }
                : {}),
              ...(this.startingGold && this.startingGoldValue !== undefined
                ? {
                    startingGold: Math.round(
                      this.startingGoldValue * 1_000_000,
                    ),
                  }
                : {}),
              ...(this.disableAlliances ? { disableAlliances: true } : {}),
              ...(this.waterNukes ? { waterNukes: true } : {}),
              ...(this.fogOfWar ? { fogOfWar: true } : {}),
              ...(this.devUnlockUlts ? { devUnlockUlts: true } : {}),
            },
            lobbyCreatedAt: Date.now(), // ms; server should be authoritative in MP
          },
          source: "singleplayer",
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }

  private async loadNationCount() {
    const currentMap = this.selectedMap;
    try {
      const mapData = this.mapLoader.getMapData(currentMap);
      const manifest = await mapData.manifest();
      // Only update if the map hasn't changed
      if (this.selectedMap === currentMap) {
        this.defaultNationCount = manifest.nations.length;
        this.nations = this.compactMap
          ? Math.max(0, Math.floor(manifest.nations.length * 0.25))
          : manifest.nations.length;
      }
    } catch (error) {
      console.warn("Failed to load nation count", error);
      // Leave existing values unchanged so the UI stays consistent
    }
  }
}

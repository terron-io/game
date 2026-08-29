import { EventBus } from "../../core/EventBus";
import { GameView } from "../../core/game/GameView";
import { UserSettings } from "../../core/game/UserSettings";
import { Controller } from "../Controller";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { AttackingTroopsController } from "../controllers/AttackingTroopsController";
import { BeachheadTimerController } from "../controllers/BeachheadTimerController";
import { BuildPreviewController } from "../controllers/BuildPreviewController";
import { BunkerFireController } from "../controllers/BunkerFireController";
import { CameraFocusController } from "../controllers/CameraFocusController";
import { HoverHighlightController } from "../controllers/HoverHighlightController";
import { MineFieldController } from "../controllers/MineFieldController";
import { MirvPreviewController } from "../controllers/MirvPreviewController";
import { MyNameController } from "../controllers/MyNameController";
import { SoundEffectController } from "../controllers/SoundEffectController";
import { SplitPreviewController } from "../controllers/SplitPreviewController";
import { StructureHighlightController } from "../controllers/StructureHighlightController";
import { StructureHoverController } from "../controllers/StructureHoverController";
import { TankFrontController } from "../controllers/TankFrontController";
import { ViewModeController } from "../controllers/ViewModeController";
import { WarshipPreviewController } from "../controllers/WarshipPreviewController";
import { WarshipSelectionController } from "../controllers/WarshipSelectionController";
import { GameView as WebGLGameView } from "../render/gl";
import { FrameProfiler } from "./FrameProfiler";
import { ActionableEvents } from "./layers/ActionableEvents";
import { AimControl } from "./layers/AimControl";
import { AlertFrame } from "./layers/AlertFrame";
import { AttacksDisplay } from "./layers/AttacksDisplay";
import { BuildMenu } from "./layers/BuildMenu";
import { ChatDisplay } from "./layers/ChatDisplay";
import { ChatModal } from "./layers/ChatModal";
import { ControlPanel } from "./layers/ControlPanel";
import { EmojiTable } from "./layers/EmojiTable";
import { EventsDisplay } from "./layers/EventsDisplay";
import { GameLeftSidebar } from "./layers/GameLeftSidebar";
import { GameRightSidebar } from "./layers/GameRightSidebar";
import { GraphicsSettingsModal } from "./layers/GraphicsSettingsModal";
import { HeadsUpMessage } from "./layers/HeadsUpMessage";
import { ImmunityTimer } from "./layers/ImmunityTimer";
import { Leaderboard } from "./layers/Leaderboard";
import { MainRadialMenu } from "./layers/MainRadialMenu";
import { MultiTabModal } from "./layers/MultiTabModal";
import { PerformanceOverlay } from "./layers/PerformanceOverlay";
import { PlayerInfoOverlay } from "./layers/PlayerInfoOverlay";
import { PlayerPanel } from "./layers/PlayerPanel";
import { ReplayPanel } from "./layers/ReplayPanel";
import { SatelliteBlackoutTimer } from "./layers/SatelliteBlackoutTimer";
import { SatelliteLaunchFx } from "./layers/SatelliteLaunchFx";
import { SettingsModal } from "./layers/SettingsModal";
import { SpawnTimer } from "./layers/SpawnTimer";
import { SpawnTutorial } from "./layers/SpawnTutorial";
import { TaskTracker } from "./layers/TaskTracker";
import { TeamStats } from "./layers/TeamStats";
import { TutorialCards } from "./layers/TutorialCards";
import { UnitDisplay } from "./layers/UnitDisplay";
import { WinModal } from "./layers/WinModal";

export function createRenderer(
  inputEl: HTMLElement,
  game: GameView,
  eventBus: EventBus,
  playerRole: string | null,
  view: WebGLGameView,
): GameRenderer {
  const transformHandler = new TransformHandler(game, eventBus, inputEl);
  const userSettings = new UserSettings();

  const uiState: UIState = {
    attackRatio: 20,
    ghostStructure: null,
    rocketDirectionUp: true,
  };

  // terron: оверлей загрузки здесь больше НЕ снимаем — раньше hide() звался тут,
  // синхронно ДО первого кадра/тика, и юзер видел «замёрзший» экран. Теперь его
  // снимает ClientGameRunner на ПЕРВОМ тике воркера (см. hideStartingModal там).

  // TODO maybe append this to document instead of querying for them?
  const emojiTable = document.querySelector("emoji-table") as EmojiTable;
  if (!emojiTable || !(emojiTable instanceof EmojiTable)) {
    console.error("EmojiTable element not found in the DOM");
  }
  emojiTable.transformHandler = transformHandler;
  emojiTable.game = game;
  emojiTable.initEventBus(eventBus);

  const buildMenu = document.querySelector("build-menu") as BuildMenu;
  if (!buildMenu || !(buildMenu instanceof BuildMenu)) {
    console.error("BuildMenu element not found in the DOM");
  }
  buildMenu.game = game;
  buildMenu.eventBus = eventBus;
  buildMenu.uiState = uiState;
  buildMenu.transformHandler = transformHandler;

  // terron: прицельное управление — добавочный слой поверх обычного HUD.
  // Старое управление не трогаем: слой сам ничего не рисует, пока выключен
  // в настройках (UserSettings.aimControl).
  const aimControl = document.querySelector("aim-control") as AimControl;
  if (!aimControl || !(aimControl instanceof AimControl)) {
    console.error("AimControl element not found in the DOM");
  }
  aimControl.game = game;
  aimControl.eventBus = eventBus;
  aimControl.uiState = uiState;
  aimControl.transformHandler = transformHandler;
  aimControl.userSettings = userSettings;
  aimControl.buildMenu = buildMenu;

  const leaderboard = document.querySelector("leader-board") as Leaderboard;
  if (!leaderboard || !(leaderboard instanceof Leaderboard)) {
    console.error("LeaderBoard element not found in the DOM");
  }
  leaderboard.eventBus = eventBus;
  leaderboard.game = game;

  const gameLeftSidebar = document.querySelector(
    "game-left-sidebar",
  ) as GameLeftSidebar;
  if (!gameLeftSidebar || !(gameLeftSidebar instanceof GameLeftSidebar)) {
    console.error("GameLeftSidebar element not found in the DOM");
  }
  gameLeftSidebar.game = game;
  gameLeftSidebar.eventBus = eventBus;

  const teamStats = document.querySelector("team-stats") as TeamStats;
  if (!teamStats || !(teamStats instanceof TeamStats)) {
    console.error("TeamStats element not found in the DOM");
  }
  teamStats.eventBus = eventBus;
  teamStats.game = game;

  const controlPanel = document.querySelector("control-panel") as ControlPanel;
  if (!(controlPanel instanceof ControlPanel)) {
    console.error("ControlPanel element not found in the DOM");
  }
  controlPanel.eventBus = eventBus;
  controlPanel.uiState = uiState;
  controlPanel.game = game;

  const eventsDisplay = document.querySelector(
    "events-display",
  ) as EventsDisplay;
  if (!(eventsDisplay instanceof EventsDisplay)) {
    console.error("events display not found");
  }
  eventsDisplay.eventBus = eventBus;
  eventsDisplay.game = game;
  eventsDisplay.uiState = uiState;

  const actionableEvents = document.querySelector(
    "actionable-events",
  ) as ActionableEvents;
  if (!(actionableEvents instanceof ActionableEvents)) {
    console.error("actionable events not found");
  }
  actionableEvents.eventBus = eventBus;
  actionableEvents.game = game;
  actionableEvents.uiState = uiState;

  const attacksDisplay = document.querySelector(
    "attacks-display",
  ) as AttacksDisplay;
  if (!(attacksDisplay instanceof AttacksDisplay)) {
    console.error("attacks display not found");
  }
  attacksDisplay.eventBus = eventBus;
  attacksDisplay.game = game;
  attacksDisplay.uiState = uiState;

  const chatDisplay = document.querySelector("chat-display") as ChatDisplay;
  if (!(chatDisplay instanceof ChatDisplay)) {
    console.error("chat display not found");
  }
  chatDisplay.eventBus = eventBus;
  chatDisplay.game = game;

  const playerInfo = document.querySelector(
    "player-info-overlay",
  ) as PlayerInfoOverlay;
  if (!(playerInfo instanceof PlayerInfoOverlay)) {
    console.error("player info overlay not found");
  }
  playerInfo.eventBus = eventBus;
  playerInfo.transform = transformHandler;
  playerInfo.game = game;

  const winModal = document.querySelector("win-modal") as WinModal;
  if (!(winModal instanceof WinModal)) {
    console.error("win modal not found");
  }
  winModal.eventBus = eventBus;
  winModal.game = game;

  const replayPanel = document.querySelector("replay-panel") as ReplayPanel;
  if (!(replayPanel instanceof ReplayPanel)) {
    console.error("replay panel not found");
  }
  replayPanel.eventBus = eventBus;
  replayPanel.game = game;

  const gameRightSidebar = document.querySelector(
    "game-right-sidebar",
  ) as GameRightSidebar;
  if (!(gameRightSidebar instanceof GameRightSidebar)) {
    console.error("Game Right bar not found");
  }
  gameRightSidebar.game = game;
  gameRightSidebar.eventBus = eventBus;

  const settingsModal = document.querySelector(
    "settings-modal",
  ) as SettingsModal;
  if (!(settingsModal instanceof SettingsModal)) {
    console.error("settings modal not found");
  }
  settingsModal.userSettings = userSettings;
  settingsModal.eventBus = eventBus;
  settingsModal.game = game;

  const graphicsSettingsModal = document.querySelector(
    "graphics-settings-modal",
  ) as GraphicsSettingsModal;
  if (!(graphicsSettingsModal instanceof GraphicsSettingsModal)) {
    console.error("graphics settings modal not found");
  }
  graphicsSettingsModal.userSettings = userSettings;
  graphicsSettingsModal.eventBus = eventBus;

  const unitDisplay = document.querySelector("unit-display") as UnitDisplay;
  if (!(unitDisplay instanceof UnitDisplay)) {
    console.error("unit display not found");
  }
  unitDisplay.game = game;
  unitDisplay.eventBus = eventBus;
  unitDisplay.uiState = uiState;

  const playerPanel = document.querySelector("player-panel") as PlayerPanel;
  if (!(playerPanel instanceof PlayerPanel)) {
    console.error("player panel not found");
  }
  playerPanel.g = game;
  playerPanel.initEventBus(eventBus);
  playerPanel.emojiTable = emojiTable;
  playerPanel.uiState = uiState;

  playerPanel.setRole(playerRole);

  const chatModal = document.querySelector("chat-modal") as ChatModal;
  if (!(chatModal instanceof ChatModal)) {
    console.error("chat modal not found");
  }
  chatModal.g = game;
  chatModal.initEventBus(eventBus);

  const multiTabModal = document.querySelector(
    "multi-tab-modal",
  ) as MultiTabModal;
  if (!(multiTabModal instanceof MultiTabModal)) {
    console.error("multi-tab modal not found");
  }
  multiTabModal.game = game;

  const headsUpMessage = document.querySelector(
    "heads-up-message",
  ) as HeadsUpMessage;
  if (!(headsUpMessage instanceof HeadsUpMessage)) {
    console.error("heads-up message not found");
  }
  headsUpMessage.game = game;

  const performanceOverlay = document.querySelector(
    "performance-overlay",
  ) as PerformanceOverlay;
  if (!(performanceOverlay instanceof PerformanceOverlay)) {
    console.error("performance overlay not found");
  }
  performanceOverlay.eventBus = eventBus;
  performanceOverlay.userSettings = userSettings;

  const alertFrame = document.querySelector("alert-frame") as AlertFrame;
  if (!(alertFrame instanceof AlertFrame)) {
    console.error("alert frame not found");
  }
  alertFrame.game = game;

  const spawnTimer = document.querySelector("spawn-timer") as SpawnTimer;
  if (!(spawnTimer instanceof SpawnTimer)) {
    console.error("spawn timer not found");
  }
  spawnTimer.game = game;
  spawnTimer.eventBus = eventBus;
  spawnTimer.transformHandler = transformHandler;

  // terron: одноразовое обучение спавну для нового игрока
  const spawnTutorial = document.querySelector(
    "spawn-tutorial",
  ) as SpawnTutorial;
  if (!(spawnTutorial instanceof SpawnTutorial)) {
    console.error("spawn tutorial not found");
  }
  spawnTutorial.game = game;
  spawnTutorial.eventBus = eventBus;

  // terron: обучающие карточки (полароид поверх карты) — активны только в
  // обучающей игре; для обычных инертны (см. TutorialCards / TUTORIAL.md)
  const tutorialCards = document.querySelector(
    "tutorial-cards",
  ) as TutorialCards;
  if (!(tutorialCards instanceof TutorialCards)) {
    console.error("tutorial cards not found");
  }
  tutorialCards.game = game;
  tutorialCards.eventBus = eventBus;
  tutorialCards.transformHandler = transformHandler;

  // terron: трекер задач (после обучения)
  const taskTracker = document.querySelector("task-tracker") as TaskTracker;
  if (!(taskTracker instanceof TaskTracker)) {
    console.error("task tracker not found");
  }
  taskTracker.game = game;
  taskTracker.eventBus = eventBus;

  const immunityTimer = document.querySelector(
    "immunity-timer",
  ) as ImmunityTimer;
  if (!(immunityTimer instanceof ImmunityTimer)) {
    console.error("immunity timer not found");
  }
  immunityTimer.game = game;
  immunityTimer.eventBus = eventBus;

  const satelliteBlackoutTimer = document.querySelector(
    "satellite-blackout-timer",
  ) as SatelliteBlackoutTimer;
  if (!(satelliteBlackoutTimer instanceof SatelliteBlackoutTimer)) {
    console.error("satellite blackout timer not found");
  }
  satelliteBlackoutTimer.game = game;
  satelliteBlackoutTimer.eventBus = eventBus;

  const layers: Controller[] = [
    // terron: «Небо наше» — screen-space взлёт ракеты в точке эпицентра
    new SatelliteLaunchFx(game, transformHandler),
    new WarshipSelectionController(game, eventBus, transformHandler, view),
    new BuildPreviewController(
      game,
      eventBus,
      uiState,
      transformHandler,
      view,
      userSettings,
    ),
    new HoverHighlightController(game, eventBus, transformHandler, view),
    new MyNameController(game, view),
    // terron: ховер структур на карте (тултип минправды + круги радиусов)
    new StructureHoverController(game, eventBus, transformHandler, view),
    // terron: ультимейты — танки на активном фронте + иконка у зоны бункера
    new TankFrontController(game, transformHandler),
    new BunkerFireController(game, transformHandler),
    // terron: гост МИРВа — плавающие круги по территории цели при наведении
    new MirvPreviewController(game, transformHandler, uiState, eventBus),
    // terron: гост корабля — иконка корабля под курсором при выборе постройки
    new WarshipPreviewController(game, eventBus, uiState),
    // terron: ультимейты — Минирование: мины в воде вдоль своих берегов
    new MineFieldController(game, transformHandler),
    // terron: ультимейты — Раскол: превью «флага» с буквой Т под курсором
    new SplitPreviewController(game, eventBus, uiState, transformHandler),
    new StructureHighlightController(eventBus, view),
    new ViewModeController(eventBus, view),
    new AttackingTroopsController(game, eventBus, userSettings, view),
    new BeachheadTimerController(game, view),
    new SoundEffectController(game, eventBus),
    new CameraFocusController(game, eventBus, transformHandler),
    eventsDisplay,
    actionableEvents,
    attacksDisplay,
    chatDisplay,
    buildMenu,
    aimControl,
    new MainRadialMenu(
      eventBus,
      game,
      transformHandler,
      emojiTable as EmojiTable,
      buildMenu,
      uiState,
      playerPanel,
      userSettings,
    ),
    spawnTimer,
    spawnTutorial,
    tutorialCards,
    taskTracker,
    immunityTimer,
    satelliteBlackoutTimer,
    leaderboard,
    gameLeftSidebar,
    unitDisplay,
    gameRightSidebar,
    controlPanel,
    playerInfo,
    winModal,
    replayPanel,
    settingsModal,
    graphicsSettingsModal,
    teamStats,
    playerPanel,
    headsUpMessage,
    multiTabModal,
    alertFrame,
    performanceOverlay,
  ];

  return new GameRenderer(
    transformHandler,
    uiState,
    layers,
    performanceOverlay,
  );
}

export class GameRenderer {
  private layerTickState = new Map<Controller, { lastTickAtMs: number }>();

  constructor(
    public transformHandler: TransformHandler,
    public uiState: UIState,
    private layers: Controller[],
    private performanceOverlay: PerformanceOverlay,
  ) {}

  /**
   * terron ПЕРФ/УТЕЧКА (08.08): чем снимать слушатели окна на teardown.
   * `initialize()` зовётся на КАЖДЫЙ матч, а слушатели не снимались никогда —
   * за сессию из K матчей их накапливалось 3K, и каждое замыкание держало
   * `transformHandler` → `GameView` со всеми полнокарточными буферами уже
   * умершего матча. AbortController снимает все разом и идемпотентен.
   */
  private listenerAbort: AbortController | null = null;

  initialize() {
    // Повторный initialize() без dispose() (защита от двойной инициализации):
    // снимаем прошлые, иначе продублируем их на том же объекте.
    this.disposeListeners();
    const abort = new AbortController();
    this.listenerAbort = abort;
    const { signal } = abort;

    this.layers.forEach((l) => l.init?.());

    const refreshRect = () => this.transformHandler.updateCanvasBoundingRect();
    window.addEventListener("resize", refreshRect, { signal });
    // terron: iOS-клавиатура меняет visualViewport, а window.resize может не
    // стрельнуть → кэш boundingRect устаревает и тап уезжает («тапаю по нолику,
    // срабатывает крестик»). Обновляем rect и на visualViewport-события.
    // requestAnimationFrame — дать лэйауту устаканиться перед чтением rect.
    if (window.visualViewport) {
      const vvRefresh = () => requestAnimationFrame(refreshRect);
      window.visualViewport.addEventListener("resize", vvRefresh, { signal });
      window.visualViewport.addEventListener("scroll", vvRefresh, { signal });
    }

    //show whole map on startup
    this.transformHandler.centerAll(0.9);
  }

  private disposeListeners(): void {
    this.listenerAbort?.abort();
    this.listenerAbort = null;
  }

  /**
   * Teardown рендерера HUD. Зовётся из `disposeGraphics` в ClientGameRunner —
   * там сведён весь teardown графики, и он идемпотентен.
   */
  dispose(): void {
    this.disposeListeners();
    // Слоям тоже даём убраться, если умеют (интерфейс Controller опционален).
    for (const l of this.layers) {
      try {
        (l as { dispose?: () => void }).dispose?.();
      } catch (e) {
        console.error("GameRenderer.dispose: слой не убрался", e);
      }
    }
  }

  tick() {
    const nowMs = performance.now();
    const shouldProfileTick = FrameProfiler.isEnabled();

    const tickLayerDurations: Record<string, number> = {};

    for (const layer of this.layers) {
      if (!layer.tick) {
        continue;
      }

      const state = this.layerTickState.get(layer) ?? {
        lastTickAtMs: -Infinity,
      };

      const intervalMs = layer.getTickIntervalMs?.() ?? 0;
      if (intervalMs > 0 && nowMs - state.lastTickAtMs < intervalMs) {
        this.layerTickState.set(layer, state);
        continue;
      }

      state.lastTickAtMs = nowMs;
      this.layerTickState.set(layer, state);

      const tickStart = shouldProfileTick ? performance.now() : 0;
      layer.tick();
      if (shouldProfileTick && tickStart !== 0) {
        const duration = performance.now() - tickStart;
        const label = layer.constructor?.name ?? "UnknownLayer";
        tickLayerDurations[label] = (tickLayerDurations[label] ?? 0) + duration;
      }
    }

    if (shouldProfileTick) {
      this.performanceOverlay.updateTickLayerMetrics(tickLayerDurations);
    }
  }
}

import { setDevUnlockAll } from "./UltUnlocks";
import { Config } from "src/core/configuration/Config";
import { translateText } from "../client/Utils";
import { EventBus, EventConstructor, GameEvent } from "../core/EventBus";
import {
  ClientID,
  GameID,
  GameRecord,
  GameStartInfo,
  LobbyInfoEvent,
  PlayerCosmeticRefs,
  PlayerRecord,
  ServerMessage,
  Turn,
} from "../core/Schemas";
import { createPartialGameRecord, findClosestBy, replacer } from "../core/Util";
import { TERRON_SPAWN_GRACE_SECONDS } from "../core/configuration/TerronTuning";
import {
  BuildableUnit,
  GameMapType,
  GameType,
  PlayerType,
  Structures,
  UnitType,
} from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { GameMapLoader } from "../core/game/GameMapLoader";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
  HashUpdate,
  WinUpdate,
} from "../core/game/GameUpdates";
import { GameView, PlayerView } from "../core/game/GameView";
import {
  clearTerrainMapCache,
  loadTerrainMap,
  TerrainMapData,
} from "../core/game/TerrainMapLoader";
import {
  DARK_MODE_KEY,
  GRAPHICS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../core/game/UserSettings";
import { WorkerClient } from "../core/worker/WorkerClient";
import {
  trackLobbyStarted,
  trackMatchOutcome,
  trackMatchStart,
  trackSpawned,
} from "./Analytics";
import { getPersistentID } from "./Auth";
import { camDiag, perfDiagEnabled } from "./CamDiag";
import { reportPresence, stopPresence } from "./FriendsPresence";
import { installHideUiMode, resetHideUiMode } from "./HideUiMode";
import {
  AutoUpgradeEvent,
  DoBoatAttackEvent,
  DoBreakAllianceEvent,
  DoGroundAttackEvent,
  DoRequestAllianceEvent,
  DoRetaliateAttackEvent,
  InputHandler,
  MouseMoveEvent,
  MouseUpEvent,
  TickMetricsEvent,
  ToggleRenderDebugGuiEvent,
} from "./InputHandler";
import { startInputModeTracking, stopInputModeTracking } from "./InputMode";
import { clearGameActive, markGameActive, reportIos } from "./IosReport";
import { traceLoadReport, traceMark, traceWorkerInit } from "./LoadTrace";
import { endGame, startGame, startTime } from "./LocalPersistantStats";
import { clearMatchAccounts, setMatchAccounts } from "./MatchAccounts";
import { netConstrained, popNetBusy, pushNetBusy } from "./NetPriority";
import { perfHud } from "./PerfHud";
import { fireReferralMatch } from "./Referral";
import { initSyncStatus, syncStatus } from "./SyncStatus";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { toast } from "./Toast";
import { GoToPlayerEvent } from "./TransformHandler";
import {
  MoveWarshipIntentEvent,
  SendAllianceExtensionIntentEvent,
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendHashEvent,
  SendSpawnIntentEvent,
  SendUpgradeStructureIntentEvent,
  Transport,
} from "./Transport";
import { createCanvas, getCurrentLang, L } from "./Utils";
import { WebGLFrameBuilder } from "./WebGLFrameBuilder";
import { createRenderer, GameRenderer } from "./hud/GameRenderer";
import {
  applyDarkModeOverride,
  applyGraphicsOverrides,
  createDebugGui,
  createRenderSettings,
  deepAssign,
  glContextStats,
  probeGlContext,
  releaseGlContext,
  GameView as WebGLGameView,
} from "./render/gl";
import { prewarmStats } from "./render/gl/utils/GlUtils";
import { ALL_UNIT_TYPES, UnitState } from "./render/types";
import { isMuted } from "./sound/AudioBus";
import { SoundManager, warmDefaultMusic } from "./sound/SoundManager";
import { themeProvider } from "./theme/ThemeProvider";

// terron: РАННИЙ прогрев карты лобби. Штатный прелоад (loadTerrainMap) включался
// только на сообщении `prestart` — а оно прилетает за пару секунд до `start`,
// чего на мобильном не хватает скачать ~5 МБ бинов → карта догружается уже в
// игре. Карта известна уже на `lobby_info` (lobby.gameConfig.gameMap), поэтому
// греем бины СРАЗУ при входе в лобби — на весь отсчёт. Фетч кладёт данные в
// HTTP-кеш браузера (карты хешированы → immutable) + в MapCache, так что
// последующий loadTerrainMap резолвится мгновенно. Дедуп по карте (в привате
// хост может сменить — догреем новую).
// Экспорт: SinglePlayerModal греет карту ТАК ЖЕ при открытии/смене карты —
// офлайн-старт симметричен онлайну (раньше 10-20МБ качались только по «Старт»).
// terron 30.07: ДАТЧИК «КАРТА ЗАМЕРЛА». Репорт владельца: «цифры шли, где меня
// жрали, а территория оставалась той же» — то есть симуляция тикала, а картинка
// не обновлялась. Такое мы уже ловили (фриз границ в фоновой вкладке, потеря
// GL-контекста), но вслепую: датчика не было, диагноз держался на описании.
// Здесь фиксируем время ПОСЛЕДНЕГО отрисованного кадра (RAF `driveFrame`), а
// тик-цикл сверяет его с собой. Вкладку в фоне браузер тротлит RAF законно —
// поэтому сигналим только при ВИДИМОЙ вкладке.
let lastFrameDrawnAt = 0;
const RENDER_FROZEN_MS = 5000;

let prefetchedLobbyMap: GameMapType | null = null;
export function prefetchLobbyMap(map: GameMapType | undefined): void {
  if (!map || map === prefetchedLobbyMap) return;
  prefetchedLobbyMap = map;
  try {
    const d = terrainMapFileLoader.getMapData(map);
    // terron: на время скачивания бинов канал помечен занятым (NetPriority) —
    // фоновый OfflinePrefetch уступает мобильный интернет карте лобби.
    pushNetBusy();
    // terron: музыку греем СТРОГО ПОСЛЕ бинов карты (карта — приоритет №1)
    // и только если музыка у игрока включена. best-effort, ошибки глотаем.
    void Promise.allSettled([
      d.mapBin(),
      d.map4xBin(),
      d.map16xBin(),
      d.manifest(),
    ]).then(() => {
      popNetBusy();
      try {
        // Мут спрашиваем у ШИНЫ (она же состояние площадки), а не у локального
        // зеркала: временный мут площадки в зеркало не пишется, и прогрев
        // качал бы mp3 во время её рекламы.
        const us = new UserSettings();
        if (!isMuted("music") && us.backgroundMusicVolume() > 0) {
          warmDefaultMusic();
        }
      } catch {
        // ignore
      }
    });
  } catch {
    prefetchedLobbyMap = null;
  }
}

export interface LobbyConfig {
  cosmetics: PlayerCosmeticRefs;
  playerName: string;
  playerClanTag: string | null;
  // In-flight clan-tag ownership check; resolves to the tag to submit (null if
  // it failed). Runs parallel to the WS handshake — only the join waits on it.
  clanTagCheck?: Promise<string | null>;
  playerRole: string | null;
  gameID: GameID;
  turnstileToken: string | null;
  // GameStartInfo only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
  // terron 20.07: сыгранные ходы локального матча для F5-резюма (LocalGameStore).
  // Есть только когда поднимаем сохранённую одиночку с /game/<id>.
  resumeTurns?: Turn[];
}

export interface JoinLobbyResult {
  stop: (force?: boolean) => boolean;
  prestart: Promise<void>;
  join: Promise<void>;
}

export function joinLobby(
  eventBus: EventBus,
  lobbyConfig: LobbyConfig,
): JoinLobbyResult {
  // Mutable clientID state — assigned by server (multiplayer) or derived from gameStartInfo (singleplayer)
  let clientID: ClientID | undefined;
  // terron (друзья): пресенс шлём только для МУЛЬТИПЛЕЕРА (друг сможет зайти).
  // Синглплеер узнаётся по наличию gameStartInfo уже на входе (у MP он приходит
  // только на `start`). Карту/режим запоминаем с lobby_info для повтора на старте.
  const isSingleplayer = !!lobbyConfig.gameStartInfo;
  let presenceMap: string | undefined;
  let presenceMode: string | undefined;

  let resolvePrestart: () => void;
  let resolveJoin: () => void;
  const prestartPromise = new Promise<void>((r) => (resolvePrestart = r));
  const joinPromise = new Promise<void>((r) => (resolveJoin = r));

  console.log(`joining lobby: gameID: ${lobbyConfig.gameID}`);

  const userSettings: UserSettings = new UserSettings();
  themeProvider.reset(); // fresh colour allocators for this game
  traceMark("join"); // terron: трассировка холодного старта (LoadTrace)
  startGame(lobbyConfig.gameID, lobbyConfig.gameStartInfo?.config ?? {});

  const transport = new Transport(lobbyConfig, eventBus);

  let currentGameRunner: ClientGameRunner | null = null;

  const onconnect = async () => {
    // Drop the tag if the ownership check failed; the server re-checks anyway.
    if (lobbyConfig.clanTagCheck !== undefined) {
      lobbyConfig.playerClanTag = await lobbyConfig.clanTagCheck;
    }
    // Always send join - server will detect reconnection via persistentID
    console.log(`Joining game lobby ${lobbyConfig.gameID}`);
    transport.joinGame();
  };
  let terrainLoad: Promise<TerrainMapData> | null = null;

  const onmessage = (message: ServerMessage) => {
    if (message.type === "lobby_info") {
      traceMark("lobby_info");
      // Server tells us our assigned clientID
      clientID = message.myClientID;
      // terron: греем карту лобби заранее (на весь отсчёт), а не на prestart.
      prefetchLobbyMap(message.lobby.gameConfig?.gameMap);
      eventBus.emit(new LobbyInfoEvent(message.lobby, message.myClientID));
      // terron (друзья): я в лобби → пресенс «lobby» (друзья видят [Войти]).
      if (!isSingleplayer) {
        presenceMap = message.lobby.gameConfig?.gameMap
          ? String(message.lobby.gameConfig.gameMap)
          : undefined;
        presenceMode = message.lobby.gameConfig?.gameType
          ? String(message.lobby.gameConfig.gameType)
          : undefined;
        reportPresence({
          gameID: lobbyConfig.gameID,
          state: "lobby",
          map: presenceMap,
          mode: presenceMode,
        });
      }
      return;
    }
    if (message.type === "prestart") {
      traceMark("prestart");
      console.log(
        `lobby: game prestarting: ${JSON.stringify(message, replacer)}`,
      );
      terrainLoad = loadTerrainMap(
        message.gameMap,
        message.gameMapSize,
        terrainMapFileLoader,
      );
      resolvePrestart();
    }
    if (message.type === "start") {
      traceMark("start_msg");
      // terron воронка: «лобби стартануло» — отсчёт кончился, сервер прислал
      // старт (веха между play_click и загрузкой в игру). Не реплей/не одиночка.
      if (!isSingleplayer && lobbyConfig.gameRecord === undefined) {
        trackLobbyStarted();
      }
      // Trigger prestart for singleplayer games
      resolvePrestart();
      console.log(
        `lobby: game started: ${JSON.stringify(message, replacer, 2)}`,
      );
      // Server tells us our assigned clientID (also sent on start for late joins)
      clientID = message.myClientID;
      resolveJoin();
      // terron (друзья): матч стартовал → пресенс «in_game» (друзья видят [Смотреть]).
      if (!isSingleplayer) {
        reportPresence({
          gameID: lobbyConfig.gameID,
          state: "in_game",
          map: presenceMap,
          mode: presenceMode,
        });
      }
      // For multiplayer games, GameStartInfo is not known until game starts.
      lobbyConfig.gameStartInfo = message.gameStartInfo;
      createClientGame(
        lobbyConfig,
        clientID,
        eventBus,
        transport,
        userSettings,
        terrainLoad,
        terrainMapFileLoader,
      )
        .then((r) => {
          currentGameRunner = r;
          r.start();
        })
        .catch((e) => {
          console.error("error creating client game", e);

          currentGameRunner = null;

          const startingModal = document.querySelector(
            "game-starting-modal",
          ) as HTMLElement;
          if (startingModal) {
            startingModal.classList.add("hidden");
          }
          // terron: снять оверлей «Загрузка карты…», иначе при ошибке старта он
          // зависнет на экране (показывается в Single/HostLobby перед стартом).
          document.getElementById("terron-loading")?.remove();
          showErrorModal(
            e.message,
            e.stack,
            lobbyConfig.gameID,
            clientID,
            true,
            false,
            "error_modal.connection_error",
          );
        });
    }
    if (message.type === "error") {
      if (message.error === "full-lobby") {
        document.dispatchEvent(
          new CustomEvent("leave-lobby", {
            detail: { lobby: lobbyConfig.gameID, cause: "full-lobby" },
            bubbles: true,
            composed: true,
          }),
        );
      } else if (message.error === "kick_reason.host_left") {
        toast(translateText("kick_reason.host_left"));
        document.dispatchEvent(
          new CustomEvent("leave-lobby", {
            detail: { lobby: lobbyConfig.gameID, cause: "host-left" },
            bubbles: true,
            composed: true,
          }),
        );
      } else {
        showErrorModal(
          message.error,
          message.message,
          lobbyConfig.gameID,
          clientID,
          true,
          false,
          "error_modal.connection_error",
        );
      }
    }
  };
  transport.connect(onconnect, onmessage);
  return {
    stop: (force: boolean = false) => {
      if (!force && currentGameRunner?.shouldPreventWindowClose()) {
        console.log("Player is active, prevent leaving game");
        return false;
      }
      console.log("leaving game");
      stopPresence(); // terron (друзья): снять пресенс лобби/игры
      if (currentGameRunner) {
        currentGameRunner.stop();
        currentGameRunner = null;
      } else {
        transport.leaveGame();
      }
      return true;
    },
    prestart: prestartPromise,
    join: joinPromise,
  };
}

// Build the WebGL view + its glCanvas. Must run before createRenderer so the
// controllers can be wired directly to the view.
function createWebGLView(
  terrainMap: TerrainMapData,
  config: Config,
): {
  view: WebGLGameView;
  glCanvas: HTMLCanvasElement;
  cachedWebGLFrameCallback: { current: FrameRequestCallback | null };
} {
  const gameMap = terrainMap.gameMap;
  const mapWidth = gameMap.width();
  const mapHeight = gameMap.height();

  // terron ПЕРФ (08.08): публикуем карту и её размер для НАДГРОБИЯ (Health.ts,
  // matchContext). Датчик `tab_died` с давностью «0m» — это прямой измеритель
  // крашей на телефонах, но без карты по нему нельзя понять, ЧТО убивает:
  // рапорт уходит уже на следующей загрузке. Разброс площади карт
  // тридцатикратный, так что это первое, что надо знать.
  (
    window as unknown as {
      __terronMap?: { name?: string; w: number; h: number };
    }
  ).__terronMap = {
    name: String(config.gameConfig().gameMap ?? ""),
    w: mapWidth,
    h: mapHeight,
  };

  // terron ПЕРФ (07.08): БЕЗ КОПИИ ВООБЩЕ. Раньше здесь был линейный цикл с
  // вызовом terrainByte(i) на каждый тайл — на Гигантском мире это 8 млн
  // вызовов метода и лишние 8 МБ, причём ровно в пик сборки GL-вида, где и
  // теряется контекст. Это была единственная стартовая работа, растущая с
  // ПЛОЩАДЬЮ карты (карты различаются по площади в 30 раз), — тем самым и
  // объяснялась связь размера карты с частотой потери контекста.
  //
  // Массив нужен ровно для одной операции: texImage2D читает его один раз при
  // создании terrain-текстуры. Потребители (GpuResources, ColorUtils, GameView)
  // его только ЧИТАЮТ — записи нет ни одной, поэтому ссылка безопасна.
  // Побочно чинится восстановление GL-контекста: перезаливка теперь берёт
  // АКТУАЛЬНЫЙ террейн, а не снимок на момент старта (важно после водяных
  // ядерок, которые превращают сушу в воду).
  const terrainBytes = gameMap.terrainRaw();

  const glCanvas = createCanvas();
  glCanvas.id = "webgl-debug-canvas";
  glCanvas.style.pointerEvents = "none";
  document.body.insertBefore(glCanvas, document.body.firstChild);

  // Capture the WebGL renderer's animation-frame callback rather than letting
  // it run its own RAF loop. Two independent RAF loops race: when the user
  // pans, the WebGL renderer can draw with one-frame-stale camera state
  // because its RAF fires before canvas2D's RAF (which would have synced the
  // camera). Driving WebGL's draw synchronously from canvas2D's onPreRender
  // hook locks them to the same frame.
  const cachedWebGLFrameCallback: { current: FrameRequestCallback | null } = {
    current: null,
  };
  const captureRaf = (cb: FrameRequestCallback): number => {
    cachedWebGLFrameCallback.current = cb;
    return 0;
  };
  const captureCaf = (_id: number): void => {
    cachedWebGLFrameCallback.current = null;
  };

  const palette = new Float32Array(4096 * 2 * 4);
  let view: WebGLGameView;
  try {
    view = camDiag.step(
      "сборка_GL_вида",
      () =>
        new WebGLGameView(
          glCanvas,
          {
            mapWidth,
            mapHeight,
            unitTypes: [...ALL_UNIT_TYPES],
            players: [],
            // Pre-allocate renderer textures for up to 1024 players. We add players
            // dynamically via view.addPlayers() as they come in from the simulation,
            // but the NamePass / palette / relation matrix all need a static upper
            // bound at construction time.
            maxPlayers: 1024,
          },
          terrainBytes,
          palette,
          config,
          captureRaf,
          captureCaf,
        ),
    );
  } catch (e) {
    // terron 10.08: контекст не создался — канвас остаётся висеть в DOM и
    // держать слот из браузерного лимита. При повторной попытке (ретрай ниже
    // или «играть ещё раз») такие сироты копились.
    glCanvas.remove();
    throw e;
  }

  (window as unknown as { __webglView?: unknown }).__webglView = view;

  // terron: снимок карты (WebGL-слой) БЕЗ интерфейсов — для /propaganda «Мои
  // скриншоты». Контекст без preserveDrawingBuffer → рисуем доп-кадр и читаем
  // СИНХРОННО, до уступки компоновщику (иначе буфер уже очищен → пусто).
  (
    window as unknown as {
      __terronCaptureMap?: (
        maxW?: number,
      ) => { dataUrl: string; width: number; height: number } | null;
    }
  ).__terronCaptureMap = (maxW = 1600) => {
    try {
      const cb = cachedWebGLFrameCallback.current;
      if (cb) cb(performance.now());
      const sw = glCanvas.width;
      const sh = glCanvas.height;
      if (!sw || !sh) return null;
      const scale = Math.min(1, maxW / sw);
      const dw = Math.max(1, Math.round(sw * scale));
      const dh = Math.max(1, Math.round(sh * scale));
      const c = document.createElement("canvas");
      c.width = dw;
      c.height = dh;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(glCanvas, 0, 0, dw, dh);
      return { dataUrl: c.toDataURL("image/jpeg", 0.9), width: dw, height: dh };
    } catch {
      return null;
    }
  };

  return { view, glCanvas, cachedWebGLFrameCallback };
}

/**
 * terron 10.08: ПОВТОРНАЯ попытка поднять GL-вид, если браузер отказал в
 * контексте.
 *
 * Зачем. Отказ «WebGL2 not supported» бывает не только «навсегда» (нет
 * железа/выключено ускорение), но и ВРЕМЕННЫМ: у Firefox WebGL живёт в
 * отдельном GPU-процессе, и пока тот падает и перезапускается, `getContext`
 * секунду-две отдаёт null на исправной машине. Раньше это был мгновенный
 * фатал с модалкой; теперь ждём и пробуем ещё раз.
 *
 * Цена ошибки нулевая: паузы платит ТОЛЬКО уже сорвавшийся старт, здоровый
 * путь идёт с первой попытки. Больше двух повторов не делаем — если браузер
 * выключил ускорение совсем, ожидание ничего не изменит, а игрок смотрит в
 * пустой экран.
 */
const GL_RETRY_ATTEMPTS = 3;
const GL_RETRY_DELAY_MS = 900;

async function createWebGLViewWithRetry(
  terrainMap: TerrainMapData,
  config: Config,
): Promise<ReturnType<typeof createWebGLView> & { waitedMs: number }> {
  let waitedMs = 0;
  let lastError: unknown;
  for (let attempt = 1; attempt <= GL_RETRY_ATTEMPTS; attempt++) {
    try {
      const built = createWebGLView(terrainMap, config);
      if (attempt > 1) {
        // Самолечение состоялось — это надо видеть в сводке, иначе мы просто
        // перестанем получать репорты и решим, что класс исчез сам.
        void import("./Health").then(({ reportHealth }) =>
          reportHealth(
            "gl_context_retry",
            `контекст поднялся с ${attempt}-й попытки (${waitedMs}мс ожидания)`,
          ),
        );
      }
      return { ...built, waitedMs };
    } catch (e) {
      lastError = e;
      const msg = String((e as Error)?.message ?? e);
      // Ретраим ТОЛЬКО отказ в контексте. Падение компиляции шейдера или
      // линковки программы — детерминированное свойство драйвера, повтор даст
      // ровно тот же результат и только задержит модалку с полезным текстом.
      if (!/WebGL2 not supported/i.test(msg)) throw e;
      if (attempt === GL_RETRY_ATTEMPTS) break;
      console.warn(
        `[gl] контекст не создан (попытка ${attempt}/${GL_RETRY_ATTEMPTS}): ${msg}`,
      );
      await new Promise((r) => setTimeout(r, GL_RETRY_DELAY_MS));
      waitedMs += GL_RETRY_DELAY_MS;
    }
  }
  throw lastError;
}

function mountWebGLFrameLoop(
  terrainMap: TerrainMapData,
  view: WebGLGameView,
  glCanvas: HTMLCanvasElement,
  cachedWebGLFrameCallback: { current: FrameRequestCallback | null },
  transformHandler: import("./TransformHandler").TransformHandler,
  gameView: GameView,
  eventBus: EventBus,
): { builder: WebGLFrameBuilder; stopFrameLoop: () => void } {
  const gameMap = terrainMap.gameMap;
  const mapWidth = gameMap.width();
  const mapHeight = gameMap.height();

  // Cache canvas dimensions to avoid forced reflows every frame. Reading
  // clientWidth/clientHeight flushes pending layout — at 60fps that's a
  // measurable cost. Only update on resize events from the observer.
  let cachedCanvasW = glCanvas.clientWidth;
  let cachedCanvasH = glCanvas.clientHeight;
  const resizeObs = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        cachedCanvasW = width;
        cachedCanvasH = height;
      }
    }
  });
  resizeObs.observe(glCanvas);

  const syncCamera = (): void => {
    const scale = transformHandler.scale;
    const dpr = window.devicePixelRatio || 1;
    const centerX =
      transformHandler.offsetX +
      mapWidth / 2 +
      (cachedCanvasW - mapWidth) / (2 * scale);
    const centerY =
      transformHandler.offsetY +
      mapHeight / 2 +
      (cachedCanvasH - mapHeight) / (2 * scale);
    view.setCameraState(centerX, centerY, scale * dpr);
    // Invoke the WebGL renderer's frame callback synchronously, with the just-
    // updated camera state. The callback re-arms itself via captureRaf, so
    // we'll get a fresh callback ready for the next canvas2D frame.
    const cb = cachedWebGLFrameCallback.current;
    cachedWebGLFrameCallback.current = null;
    cb?.(performance.now());
  };

  // Move-target chevrons: when the player issues a warship move, show the
  // animated chevron pass at the target tile. The renderer needs the target's
  // tile x/y and the warship's owner smallID (so the chevrons use the right
  // color).
  // terron (F1): именованный хендлер — чтобы снять его в stopFrameLoop (bind/
  // анонимку с общего EventBus не отписать, замыкание держало бы view/gameView
  // живыми после матча).
  const onMoveWarship = (e: MoveWarshipIntentEvent): void => {
    const tile = e.tile;
    const tx = gameView.x(tile);
    const ty = gameView.y(tile);
    // Resolve owner via the first unit in the move set.
    const firstUnit = gameView.unit(e.unitIds[0]);
    if (firstUnit === undefined) return;
    view.showMoveIndicator(tx, ty, firstUnit.owner().smallID());
  };
  eventBus.on(MoveWarshipIntentEvent, onMoveWarship);

  // Self-driving RAF: syncCamera reads the latest camera state from
  // TransformHandler, pushes it to WebGL, and synchronously invokes the
  // renderer's captured frame callback (which draws). One RAF = one
  // synchronized camera-update + WebGL render.
  // terron (F1): флаг останова — раньше цикл жил ВЕЧНО (на K-й матч без
  // перезагрузки крутилось K параллельных RAF с мёртвыми view).
  let frameLoopStopped = false;
  const driveFrame = (): void => {
    if (frameLoopStopped) return;
    syncCamera();
    lastFrameDrawnAt = performance.now(); // отметка для датчика «карта замерла»
    perfHud.frame(); // дев-датчик fps (no-op на проде)
    requestAnimationFrame(driveFrame);
  };
  requestAnimationFrame(driveFrame);
  // terron 22.08: замер производительности матча. Идёт ВЕЗДЕ (и на проде) —
  // без этого нельзя ответить, помогают правки или вредят. Оверлей на экране
  // при этом только под perfDiagEnabled (дев / ?debug=perf).
  // Реплеи (скорость ×4/×8, перемотка) в сравнение сборок не кладём.
  if (!gameView.config().isReplay()) {
    perfHud.start({
      map: String(gameView.config().gameConfig().gameMap ?? ""),
    });
  }
  // terron: ДЕВ-ПЕСОЧНИЦА ЗАМКОВ — берём флаг из конфига ЭТОГО матча, чтобы
  // чузер не рисовал 🔒 на том, что сервер уже пускает. TZ-ult-unlocks.md
  setDevUnlockAll(
    gameView.config().gameConfig().devUnlockUlts === true,
  );
  // Матчи, из которых уходят не досмотрев итоги, — как раз самые тяжёлые.
  // Терять их замер нельзя, поэтому досылаем сводку на закрытии вкладки.
  const onPageHidePerf = (): void => perfHud.report();
  window.addEventListener("pagehide", onPageHidePerf);

  const stopFrameLoop = (): void => {
    frameLoopStopped = true;
    perfHud.stop();
    window.removeEventListener("pagehide", onPageHidePerf);
    resizeObs.disconnect();
    eventBus.off(MoveWarshipIntentEvent, onMoveWarship);
  };

  const builder = new WebGLFrameBuilder(view);

  // When context is lost and restored, WebGL loses all textures and geometry.
  // Force a full re-upload of the simulation state.
  view.on("contextrestored", () => {
    builder.clearCaches();

    // Full upload of terrain, territory & trail state
    const mapSize = mapWidth * mapHeight;
    const allRefs = new Array(mapSize);
    const allTerrain = new Uint8Array(mapSize);
    for (let i = 0; i < mapSize; i++) {
      allRefs[i] = i;
      allTerrain[i] = gameView.terrainByte(i);
    }
    view.applyTerrainDelta(allRefs, allTerrain);

    const frameData = gameView.frameData();
    view.uploadTileAndTrailState(frameData.tileState, frameData.trailState);

    // Structures and railroads normally skip GPU upload unless marked dirty, now force
    view.updateStructures(frameData.units as Map<number, UnitState>);
    view.uploadRailroadState(frameData.railroadState);
    // terron: скины пепла — текстура «чей пепел» тоже сгорела с контекстом,
    // а грузится она только грязными строками → переливаем целиком.
    const fo = gameView.falloutOwnersFull();
    if (fo !== null) view.uploadFalloutOwners(fo, 0, mapHeight - 1);
    // terron ПЕРФ (Р10.1): relations теперь грузятся только по dirty-флагу —
    // новая GPU-текстура отношений пуста, форсим пересборку на ближайший тик.
    gameView.markRelationsDirty();

    builder.update(gameView);
  });

  return { builder, stopFrameLoop };
}

async function createClientGame(
  lobbyConfig: LobbyConfig,
  clientID: ClientID | undefined,
  eventBus: EventBus,
  transport: Transport,
  userSettings: UserSettings,
  terrainLoad: Promise<TerrainMapData> | null,
  mapLoader: GameMapLoader,
): Promise<ClientGameRunner> {
  if (lobbyConfig.gameStartInfo === undefined) {
    throw new Error("missing gameStartInfo");
  }
  // Диагностику перфа включаем В САМОМ НАЧАЛЕ старта: сборка графики и
  // инициализация рендера идут ДО того, как поднимется InputHandler, и иначе
  // не попадали бы в разбор шагов. Сбрасываем накопленное от прошлого матча.
  camDiag.enabled = perfDiagEnabled();
  camDiag.reset();
  const config = new Config(
    lobbyConfig.gameStartInfo.config,
    userSettings,
    lobbyConfig.gameRecord !== undefined,
  );
  let gameMap: TerrainMapData;

  if (terrainLoad) {
    gameMap = await terrainLoad;
  } else {
    gameMap = await loadTerrainMap(
      lobbyConfig.gameStartInfo.config.gameMap,
      lobbyConfig.gameStartInfo.config.gameMapSize,
      mapLoader,
    );
  }
  traceMark("map_ready"); // бины скачаны и распарсены
  const worker = new WorkerClient(lobbyConfig.gameStartInfo, clientID);
  await worker.initialize();
  traceMark("worker_ready");
  traceWorkerInit(worker.initTimings);
  const gameView = new GameView(
    worker,
    config,
    gameMap,
    clientID,
    lobbyConfig.playerName,
    lobbyConfig.playerClanTag,
    lobbyConfig.gameStartInfo.gameID,
    lobbyConfig.gameStartInfo.players,
  );

  // Transparent fullscreen overlay used purely as the pointer-event /
  // bounding-rect target for InputHandler + TransformHandler. The actual
  // map drawing happens on the WebGL canvas created in createWebGLView.
  const inputOverlay = document.createElement("div");
  inputOverlay.id = "game-input-overlay";
  inputOverlay.style.position = "fixed";
  inputOverlay.style.left = "0";
  inputOverlay.style.top = "0";
  // terron 20.07: РАЗМЕР ОТ ОКНА, не в процентах. Проценты считаются от
  // родителя, а в окне ожидания старта у html/body высота 0 → слой ввода
  // схлопывался в 0×0 и не ловил ни колесо, ни перетаскивание: игрок видел
  // карту, но не мог ни двигать её, ни зумить, пока не пойдут ходы (репорт
  // владельца 20.07). vw/vh от родителя не зависят.
  inputOverlay.style.width = "100vw";
  inputOverlay.style.height = "100vh";
  inputOverlay.style.touchAction = "none";
  document.body.appendChild(inputOverlay);

  const soundManager = new SoundManager(eventBus, userSettings);
  try {
    const glBuildStart = performance.now();
    const { view, glCanvas, cachedWebGLFrameCallback, waitedMs } =
      await createWebGLViewWithRetry(gameMap, config);
    // terron 20.07: сборка GL-вида — это компиляция и линковка ~30 программ,
    // главный поток на это время стоит. До прогрева шейдеров было ~1.4с;
    // датчик ловит машины, где правка не помогла (порог 2.5с). Паузы между
    // повторными попытками вычитаем — они не сборка, а ожидание браузера.
    const glBuildMs = Math.round(performance.now() - glBuildStart - waitedMs);
    if (glBuildMs > 2500) {
      // terron ПЕРФ (08.08, A2): шлём не только ИТОГ, но и РАЗБИВКУ по фазам.
      // Само по себе «3.6с» не говорит, что чинить: текстуры, прогрев шейдеров,
      // линковка программ или конструирование пассов — это четыре разные
      // правки. camDiag такую разбивку даёт, но он включён лишь на деве и по
      // ?debug=perf, то есть ровно у пострадавших выключен. Здесь — всегда,
      // ценой четырёх performance.now() за всю сборку.
      const phases = view.getBuildPhases();
      const detail =
        `${glBuildMs}мс` +
        (Object.keys(phases).length > 0
          ? ` (${Object.entries(phases)
              .map(([k, v]) => `${k} ${v}`)
              .join(", ")})`
          : "");
      void import("./Health").then(({ reportHealth }) =>
        reportHealth("slow_renderer_build", detail, {
          totalMs: glBuildMs,
          phases,
          // Сколько программ взято из прогрева, а сколько слинковано мимо:
          // hits≈0 = прогрев не сработал (чинить его), hits≈все = медленно
          // само железо/текстуры (чинить другое).
          prewarm: prewarmStats(),
        }),
      );
    }

    // terron 20.07: рендер собран (30 GL-программ) — отсюда до первого тика
    // остаётся ТОЛЬКО ожидание первого хода. Замер разделяет «мы долго
    // собираем графику» и «мы долго ждём ход» — раньше это был один кусок.
    traceMark("renderer_ready");
    const graphicsListenerAbort = new AbortController();

    view.setShowPatterns(userSettings.territoryPatterns());
    // terron (F1): раньше этот листенер висел БЕЗ signal → жил вечно и держал
    // view после матча (соседние ниже signal имели). Теперь на общем abort.
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.territoryPatterns`,
      (e) => view.setShowPatterns((e as CustomEvent<string>).detail === "true"),
      { signal: graphicsListenerAbort.signal },
    );

    const regenerateRenderSettings = (): void => {
      const live = view.getSettings();
      deepAssign(live, createRenderSettings());
      applyGraphicsOverrides(live, userSettings.graphicsOverrides());
      applyDarkModeOverride(live, userSettings.darkMode());
    };
    regenerateRenderSettings();
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${GRAPHICS_KEY}`,
      regenerateRenderSettings,
      { signal: graphicsListenerAbort.signal },
    );
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${DARK_MODE_KEY}`,
      regenerateRenderSettings,
      { signal: graphicsListenerAbort.signal },
    );

    let debugGui: ReturnType<typeof createDebugGui> | null = null;
    // terron (F1): именованный — отписываем в disposeGraphics.
    const onToggleDebugGui = (): void => {
      if (debugGui === null) {
        debugGui = createDebugGui(view.getSettings());
        debugGui.open();
      } else {
        debugGui.destroy();
        debugGui = null;
      }
    };
    eventBus.on(ToggleRenderDebugGuiEvent, onToggleDebugGui);

    const gameRenderer = createRenderer(
      inputOverlay,
      gameView,
      eventBus,
      lobbyConfig.playerRole,
      view,
    );

    const { builder: webglBuilder, stopFrameLoop } = mountWebGLFrameLoop(
      gameMap,
      view,
      glCanvas,
      cachedWebGLFrameCallback,
      gameRenderer.transformHandler,
      gameView,
      eventBus,
    );

    // terron (F1, «краш второго матча»): полный teardown графики на stop().
    // Раньше НИЧЕГО из этого не чистилось → каждый матч без перезагрузки
    // стекал WebGL-контекст (+60-120МБ GPU) + вечный RAF + DOM-ноды.
    // Идемпотентно; каждая ступень изолирована try/catch.
    let graphicsDisposed = false;
    const disposeGraphics = (): void => {
      if (graphicsDisposed) return;
      graphicsDisposed = true;
      try {
        stopFrameLoop();
      } catch (e) {
        console.error("disposeGraphics: stopFrameLoop failed", e);
      }
      try {
        eventBus.off(ToggleRenderDebugGuiEvent, onToggleDebugGui);
        debugGui?.destroy();
        debugGui = null;
      } catch (e) {
        console.error("disposeGraphics: debug gui teardown failed", e);
      }
      try {
        view.dispose(); // все пассы/текстуры/FBO/программы + context-листенеры
      } catch (e) {
        console.error("disposeGraphics: view.dispose failed", e);
      }
      try {
        glCanvas.remove();
        inputOverlay.remove();
      } catch (e) {
        console.error("disposeGraphics: DOM cleanup failed", e);
      }
      // terron ПЕРФ (память, 12.07): модульный кэш распарсенных карт держал
      // 24-30МБ на КАЖДУЮ сыгранную карту навсегда. Хуже: GameMapImpl в нём
      // МУТИРУЕТСЯ матчем (owner-биты + терраформинг ядерок) → второй матч
      // на той же карте без перезагрузки стартовал бы с призрачными
      // территориями. Чистим на teardown; следующий матч парсит заново
      // (байты карты мгновенно отдаёт SW/MapCache).
      try {
        clearTerrainMapCache();
      } catch (e) {
        console.error("disposeGraphics: terrain cache clear failed", e);
      }
      // terron ПЕРФ/УТЕЧКА (08.08): HUD-рендерер вешал на КАЖДЫЙ матч три
      // слушателя окна (resize + visualViewport resize/scroll) и не снимал их.
      // Каждое замыкание держало transformHandler -> GameView со всеми
      // полнокарточными буферами мёртвого матча.
      try {
        gameRenderer.dispose();
      } catch (e) {
        console.error("disposeGraphics: gameRenderer.dispose failed", e);
      }
      (window as unknown as { __webglView?: unknown }).__webglView = null;
    };

    console.log(
      `creating private game got difficulty: ${lobbyConfig.gameStartInfo.config.difficulty}`,
    );

    return new ClientGameRunner(
      lobbyConfig,
      clientID,
      eventBus,
      gameRenderer,
      new InputHandler(gameView, gameRenderer.uiState, inputOverlay, eventBus),
      transport,
      worker,
      gameView,
      soundManager,
      userSettings,
      webglBuilder,
      graphicsListenerAbort,
      disposeGraphics,
    );
  } catch (err) {
    soundManager.dispose();
    throw err;
  }
}

export class ClientGameRunner {
  private myPlayer: PlayerView | null = null;
  private isActive = false;

  private turnsSeen = 0;
  // terron: порог догона ходов — выше него показываем «осталось N» (SyncStatus),
  // ниже считаем «догнали» (live). Дедуп/скрытие — в SyncStatus.
  // terron: порог показа «Синхронизация — осталось N ходов». 30 ходов = ~3с
  // отставания: мелкие лаги догоняются молча, баннер — только когда реально
  // есть что догонять (решение владельца 16.07, было 15).
  private static readonly SYNC_THRESHOLD = 30;
  // terron: самолечение дырки в ходах — таймштамп последнего перезапроса
  // догона (rejoin), чтобы не спамить сервер чаще раза в N мс.
  private lastGapCatchupMs = 0;
  // terron 20.07: догон УЖЕ запрошен и ещё не прогнан. Без этого флага клиент,
  // отставший на сотни ходов, входил в петлю: попросил догон → пока прогоняет
  // пачку, приходят живые ходы → снова «разрыв» → снова просит догон С НАЧАЛА.
  // Счётчик синхронизации скакал (31 → 1349 → 342) и не сходился никогда, а мир
  // стоял: игрок атакует, границы не двигаются (репорт владельца 20.07).
  private catchupPending = false;
  // terron 20.07: ходы, пришедшие ВПЕРЁД (пока едет догон). Раньше они молча
  // отбрасывались («got wrong turn»), а сервер их больше не присылал — значит
  // сразу после догона у клиента снова была дырка, и он просил догон опять.
  // Теперь держим их здесь и применяем, как только номер совпадёт.
  private pendingTurns = new Map<number, Turn>();
  // terron 22.08: контекст замера перфа ставится один раз за матч.
  private perfCtxSent = false;
  private catchupSentAt = 0;
  // terron ПЕРФ 16.08: боевой замер догона. Стенд показал −19% на пачке
  // 3400 тиков (бюджет времени в воркере + пропуск placeName + троттлинг
  // ингеста по backlog), но в проде это никто не измерял. Эпизод: backlog
  // воркера (gu.pendingTurns) поднялся выше порога → ждём, пока рассосётся,
  // → один health-репорт catchup_trace за сессию с мс/тик.
  private catchupEpStartMs = 0;
  private catchupEpStartTick = 0;
  private catchupTraceReported = false;
  // terron 20.07: сторож класса in-game (см. start()) + флаг «уже отчитались».
  private inGameClassWatch: number | null = null;
  private inGameClassHealed = false;
  // Страховка: если пачка догона так и не пришла (потерялась/сервер молчит),
  // через это время разрешаем запросить её заново — иначе флаг залипнет и
  // клиент застрянет молча навсегда.
  private static readonly CATCHUP_TIMEOUT_MS = 15_000;
  private static readonly GAP_CATCHUP_THROTTLE_MS = 5000;
  private lastMousePosition: { x: number; y: number } | null = null;

  private lastMessageTime: number = 0;
  private connectionCheckInterval: NodeJS.Timeout | null = null;
  /** Отложенный запуск сторожа связи — снимается в stop(), см. там же. */
  private connectionCheckStartTimer: NodeJS.Timeout | null = null;
  private goToPlayerTimeout: NodeJS.Timeout | null = null;

  private lastTickReceiveTime: number = 0;
  private currentTickDelay: number | undefined = undefined;

  constructor(
    private lobby: LobbyConfig,
    private clientID: ClientID | undefined,
    private eventBus: EventBus,
    private renderer: GameRenderer,
    private input: InputHandler,
    private transport: Transport,
    private worker: WorkerClient,
    private gameView: GameView,
    private soundManager: SoundManager,
    private userSettings: UserSettings,
    private webglBuilder: WebGLFrameBuilder | null = null,
    private graphicsListenerAbort: AbortController | null = null,
    private disposeGraphics: (() => void) | null = null,
  ) {
    this.lastMessageTime = Date.now();
  }

  // terron (F1): подписки start() на ОБЩИЙ eventBus (живёт между матчами) —
  // копим ссылки, чтобы отписать в stop(). Раньше .bind(this) делал отписку
  // невозможной → K матчей = K комплектов обработчиков + удержание CGR в памяти.
  private busSubs: Array<[EventConstructor, (event: GameEvent) => void]> = [];
  private sub<T extends GameEvent>(
    type: EventConstructor<T>,
    fn: (e: T) => void,
  ): void {
    this.eventBus.on(type, fn);
    this.busSubs.push([type, fn as (event: GameEvent) => void]);
  }

  // terron: обновить баннер догона ходов. remaining = принято ходов от сервера
  // (turnsSeen) − симулировано тиков (gameView.ticks()). Показываем «осталось N»,
  // пока догоняем (реконнект после ребута / спектатор зашёл в идущий матч).
  private updateSyncProgress(): void {
    // terron 04.08: В РЕПЛЕЕ БАННЕРА СИНХРОНИЗАЦИИ НЕТ. Запись проигрывается
    // из локального файла, «догон» тут — нормальный ход воспроизведения, а не
    // проблема связи: плашка «осталось N ходов» висела почти весь просмотр и
    // только мешала (репорт владельца). Гасим один раз и выходим.
    if (this.gameView.config().isReplay()) {
      syncStatus("live", 0);
      return;
    }
    const remaining = this.turnsSeen - this.gameView.ticks();
    // Шлём КАЖДЫЙ тик — SyncStatus дедупит. Важно слать «live» даже когда мы НЕ
    // «syncing»: баннер мог быть поднят Transport'ом («reconnecting») при малом
    // догоне (remaining ≤ порога) — иначе он завис бы навсегда (см. фикс 2026-07-03).
    if (remaining > ClientGameRunner.SYNC_THRESHOLD) {
      syncStatus("syncing", remaining);
    } else {
      syncStatus("live", 0);
    }
  }

  // terron 26.07: замер догона в консоль — «сколько тиков разгребали и за
  // сколько». Нужен, чтобы правки скорости догона можно было сравнивать
  // цифрами, а не на ощупь. Пишем только на входе/выходе из режима догона.
  /** Симуляция тикает, а кадров нет — картинка «замерла» при живых данных.
   *  Сигналим один раз за сессию (reportHealth сам держит лимит по kind).
   *  Фоновая вкладка не в счёт: там RAF тротлится браузером законно. */
  private renderFrozenReported = false;
  /**
   * terron ПЕРФ (08.08): ЛОЖНЫЕ СРАБАТЫВАНИЯ ДАТЧИКА «КАРТА ЗАМЕРЛА».
   *
   * Проверка видимости была ТОЧЕЧНОЙ — «видима ли вкладка ПРЯМО СЕЙЧАС», — но
   * не учитывала, что весь простой мог пройти в ФОНЕ, где браузер тротлит RAF
   * совершенно законно. Игрок возвращался во вкладку, видимость становилась
   * `visible`, и датчик рапортовал всё время фона как заморозку.
   *
   * В данных это видно прямо: при пороге 5с приходили значения 70с, 960с и
   * даже 1416с — «23 минуты матча с замершей картинкой», чего не бывает: столько
   * игрок бы не терпел. Из-за этого метрика с 05.08 выглядела новой регрессией
   * (0 событий 31.07–04.08, затем 1.6–3.5% заходов), а сколько там настоящих
   * заморозок — было неизвестно.
   *
   * Чиним отсечкой по МОМЕНТУ ВОЗВРАТА: пока вкладка скрыта, копим отметку
   * ухода в фон, а вернувшись — считаем простой не от последнего кадра, а от
   * возврата. Настоящая заморозка видимой вкладки при этом ловится как прежде.
   */
  private hiddenSince = 0;
  private lastVisibleAt = 0;
  private onVisibilityForFrozen = (): void => {
    if (document.visibilityState === "visible") {
      this.lastVisibleAt = performance.now();
      this.hiddenSince = 0;
    } else if (this.hiddenSince === 0) {
      this.hiddenSince = performance.now();
    }
  };
  // terron ПЕРФ 16.08: один репорт catchup_trace за сессию — сколько занял
  // догон (F5/реконнект в идущий матч). Эпизод начинается, когда backlog
  // воркера ≥100 ходов, и заканчивается, когда рассосался до ≤2. Мелкие догоны
  // (<300 тиков) не шлём: их длительность — секунды, шум. gu.pendingTurns —
  // это очередь ВОРКЕРА (симуляции), т.е. меряется именно пересимуляция,
  // а не сеть.
  private traceCatchupEpisode(gu: GameUpdateViewData): void {
    if (this.catchupTraceReported) return;
    const backlog = gu.pendingTurns ?? 0;
    if (this.catchupEpStartMs === 0) {
      if (backlog >= 100) {
        this.catchupEpStartMs = performance.now();
        this.catchupEpStartTick = gu.tick;
      }
      return;
    }
    if (backlog > 2) return;
    const ms = Math.round(performance.now() - this.catchupEpStartMs);
    const ticks = gu.tick - this.catchupEpStartTick;
    this.catchupEpStartMs = 0;
    if (ticks < 300 || ms <= 0) return;
    this.catchupTraceReported = true;
    const msPerTick = +(ms / ticks).toFixed(2);
    void import("./Health").then(({ reportHealth }) =>
      reportHealth(
        "catchup_trace",
        `${ticks} тиков за ${ms}мс (${msPerTick} мс/тик)`,
        { ticks, ms, msPerTick },
      ),
    );
  }

  private checkRenderFrozen(): void {
    if (this.renderFrozenReported || lastFrameDrawnAt === 0) return;
    if (document.visibilityState !== "visible") return;
    // Простой считаем от ПОЗДНЕЙШЕГО из двух: последнего кадра и момента
    // возврата во вкладку. Иначе фоновая пауза утекает в метрику целиком.
    const since = Math.max(lastFrameDrawnAt, this.lastVisibleAt);
    const stale = performance.now() - since;
    if (stale < RENDER_FROZEN_MS) return;
    this.renderFrozenReported = true;
    void import("./Health").then(({ reportHealth }) =>
      reportHealth("render_frozen", `${Math.round(stale)}мс без кадра`, {
        tick: this.gameView?.ticks?.() ?? -1,
      }),
    );
  }

  /**
   * Determines whether window closing should be prevented.
   *
   * Used to show a confirmation dialog when the user attempts to close
   * the window or navigate away during an active game session.
   *
   * @returns {boolean} `true` if the window close should be prevented
   * (when the player is alive in the game), `false` otherwise
   * (when the player is not alive or doesn't exist)
   */
  public shouldPreventWindowClose(): boolean {
    // Show confirmation dialog if player is alive in the game
    return !!this.myPlayer?.isAlive();
  }

  private async saveGame(update: WinUpdate) {
    if (!this.clientID) {
      return;
    }
    const players: PlayerRecord[] = [
      {
        persistentID: getPersistentID(),
        username: this.lobby.playerName,
        clanTag: this.lobby.playerClanTag ?? null,
        clientID: this.clientID,
        stats: update.allPlayersStats[this.clientID],
      },
    ];

    if (this.lobby.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    const record = createPartialGameRecord(
      this.lobby.gameStartInfo.gameID,
      this.lobby.gameStartInfo.config,
      players,
      // Not saving turns locally
      [],
      startTime(),
      Date.now(),
      update.winner,
      this.lobby.gameStartInfo.lobbyCreatedAt,
      this.lobby.gameStartInfo.visibleAt,
    );
    endGame(record);

    // terron реферал: матч сыгран по реф-ссылке → награда отправителю (не считаем
    // одиночные — это локальная песочница, легко фармить). win — победа игрока.
    if (this.lobby.gameStartInfo.config.gameType !== GameType.Singleplayer) {
      const won =
        update.winner?.[0] === "player" && update.winner[1] === this.clientID;
      fireReferralMatch(won);
      // terron аналитика: матч завершился естественно. won → победа; иначе матч
      // кончился, а я не победил и (ещё) не «умер» → «lost» (died фиксирует
      // WinModal раньше, в момент смерти; single-fire guard не даст задвоить).
      trackMatchOutcome(won ? "won" : "lost");
    }
  }

  public start() {
    // terron ПЕРФ (владелец 12.07): музыку стартуем ПОСТФАКТУМ, не здесь.
    // Раньше play() первой строкой → Howler (preload:false, html5) сразу
    // стримил tactical-glaciers.mp3 (2.4МБ), а warmNextTrack следом тянул
    // war-map-hum.mp3 (4.2МБ) — до 6.6МБ mp3 конкурировали с map.bin/воркером
    // ровно в окно загрузки (айфон-кейс «всё грузилось вечно»). Теперь музыка
    // включается через 15с ПОСЛЕ первого тика (зажатая сеть — 60с), когда
    // канал уже свободен. Лобби-прогрев (warmDefaultMusic) остаётся как был.
    console.log("starting client game");

    // terron аналитика: реальный матч начался (не реплей, не одиночный) →
    // «поиграл хоть сколько-то» в воронке трафика.
    if (
      this.lobby.gameRecord === undefined &&
      this.lobby.gameStartInfo?.config.gameType !== GameType.Singleplayer
    ) {
      trackMatchStart();
    }

    this.isActive = true;
    // terron: считаем, ЧЕМ играют (палец/мышь) — значок «забег с телефона» в
    // спидран-топе честнее User-Agent. Репортим только смену классификации.
    startInputModeTracking((mode) => this.transport.sendInputMode(mode));
    // terron: clientID → аккаунт (slug) для аватарок в панели игрока.
    setMatchAccounts(this.lobby.gameStartInfo);
    // terron: пометить игру активной (детект memory-kill: если страница
    // перезагрузится посреди игры без чистого выхода — на бусте зарепортим
    // abnormal_exit с последним снапшотом памяти). См. IosReport.
    try {
      const cfg = this.lobby.gameStartInfo?.config;
      markGameActive(this.lobby.gameStartInfo?.gameID ?? "?", {
        map: cfg?.gameMap,
        bots: cfg?.bots,
        gameType: cfg?.gameType,
      });
    } catch {
      /* телеметрия не критична */
    }
    this.lastMessageTime = Date.now();

    // terron: СОБЫТИЙНЫЙ МАТЧ — рамка вокруг всего интерфейса на весь матч
    // (стили body.golden-match / body.diamond-match в terron-theme.css).
    // Классы снимаем в stop().
    if (this.lobby.gameStartInfo?.config?.golden === true) {
      document.body.classList.add(
        this.lobby.gameStartInfo?.config?.eventTier === "diamond"
          ? "diamond-match"
          : "golden-match",
      );
    }

    // terron 20.07: САМОЛЕЧЕНИЕ инварианта «идёт матч → на body класс in-game».
    // Репорт 20.07 (мобильный Brave): игра работала, а класса не было — меню
    // не пряталось и висело поверх матча, играть невозможно. Класс ставился
    // ровно один раз в Main (join.then), поэтому ЛЮБОЙ путь, снявший его при
    // живом матче, ломал экран навсегда. Кто именно снимает — пока не доказано,
    // и чинить вслепую хуже, чем держать инвариант: раз в 2с проверяем и
    // возвращаем. Каждый случай уходит в телеметрию (detail=healed) вместе с
    // адресом — по ним и найдём виновный путь, не гадая.
    this.inGameClassWatch = window.setInterval(() => {
      if (!this.isActive) return;
      if (document.body.classList.contains("in-game")) return;
      document.body.classList.add("in-game");
      if (this.inGameClassHealed) return;
      this.inGameClassHealed = true;
      const where = window.location.pathname.slice(0, 60);
      void import("./Health").then(({ reportHealth }) =>
        reportHealth("ingame_class_missing", `healed @ ${where}`, {
          ticks: this.gameView.ticks(),
        }),
      );
    }, 2000);

    // terron 20.07: сторож «матч создан, но мир не тикнул». Игрок в этом
    // состоянии видит «Ждём начала матча…» и ничего больше — снаружи выглядит
    // как зависание, а следов не оставалось. Реплей не считаем: там ходы
    // проигрываются сами и своя механика старта.
    if (!this.gameView.config().isReplay()) {
      setTimeout(() => {
        if (!this.isActive || this.gameView.ticks() > 0) return;
        void import("./Health").then(({ reportHealth }) =>
          reportHealth("stuck_awaiting_start", `seen ${this.turnsSeen}`, {
            catchupPending: this.catchupPending,
            pendingTurns: this.pendingTurns.size,
            // Давность последнего сообщения от сервера отличает «сервер молчит»
            // от «сообщения идут, а мир всё равно стоит».
            lastMsgAgeMs: Date.now() - this.lastMessageTime,
            isLocal: this.transport.isLocal,
          }),
        );
      }, 30_000);
    }

    // terron ПЕРФ/УТЕЧКА (08.08): отложенный старт сторожа связи НАДО СНИМАТЬ.
    // Таймаут не отменялся в stop(), поэтому выход из матча в первые 20 секунд
    // (а спавн-фаза ровно 20с — уход «не понравилась карта» попадает точно в
    // это окно) оставлял вечный секундный интервал: он дёргал onConnectionCheck
    // на уже закрытом сокете и копился по матчам. Держим id и гасим в stop();
    // плюс гард isActive — на случай, если stop() успел пройти между тиками.
    // Датчик «карта замерла» должен знать про уходы в фон — см. checkRenderFrozen.
    document.addEventListener("visibilitychange", this.onVisibilityForFrozen);
    this.lastVisibleAt = performance.now();

    this.connectionCheckStartTimer = setTimeout(() => {
      this.connectionCheckStartTimer = null;
      if (!this.isActive) return;
      this.connectionCheckInterval = setInterval(
        () => this.onConnectionCheck(),
        1000,
      );
    }, 20000);

    // terron (F1): через this.sub — отписываемся в stop() (bind-подписки на
    // общем шине копились между матчами).
    this.sub(MouseUpEvent, this.inputEvent.bind(this));
    this.sub(MouseMoveEvent, this.onMouseMove.bind(this));
    this.sub(AutoUpgradeEvent, this.autoUpgradeEvent.bind(this));
    this.sub(DoBoatAttackEvent, this.doBoatAttackUnderCursor.bind(this));
    this.sub(DoGroundAttackEvent, this.doGroundAttackUnderCursor.bind(this));
    this.sub(
      DoRetaliateAttackEvent,
      this.doRetaliateAttackMostRecent.bind(this),
    );
    this.sub(
      DoRequestAllianceEvent,
      this.doRequestAllianceUnderCursor.bind(this),
    );
    this.sub(DoBreakAllianceEvent, this.doBreakAllianceUnderCursor.bind(this));

    camDiag.step("инициализация_рендера", () => this.renderer.initialize());
    this.input.initialize();
    initSyncStatus();
    installHideUiMode(); // клавиша H — чистый кадр для скриншотов

    // terron 20.07 (задача владельца): снимаем затемнение ЗДЕСЬ, а не раньше.
    // Раньше я убирал его сразу после сборки графики — карта появлялась, но
    // мышь подключается только сейчас, и игрок видел живую картинку, которую
    // нельзя ни двигать, ни зумить («не могу шевелиться пока загрузка идёт»).
    // Теперь момент показа карты = момент, когда камера уже слушается.
    // Клик по точке спавна всё ещё ждёт первого хода (firstTickRendered).
    (
      document.querySelector("game-starting-modal") as
        | (HTMLElement & { hide?: () => void })
        | null
    )?.hide?.();

    // terron: оверлей загрузки теперь снимаем на ПЕРВОМ тике воркера (раньше —
    // синхронно в createRenderer, ДО первого кадра → «фриз при снятом оверлее»).
    // Фолбэк 8с — на случай зависшего воркера оверлей не должен висеть вечно.
    this.hideOverlayFallback = window.setTimeout(() => {
      if (!this.firstTickRendered) {
        console.warn(
          "[GameStart] fallback: hiding loading overlay after 8s without first tick",
        );
        // Телеметрия: воркер не тикнул за 8с — игрок смотрел на замёрзший
        // экран загрузки (класс жалоб «загрузка висит»). Динамический импорт —
        // не тащим Health в вес игрового бандла на здоровом пути.
        void import("./Health").then(({ reportHealth }) =>
          reportHealth("slow_first_tick"),
        );
        this.hideStartingModal();
      }
    }, 8000);

    this.worker.start((gu: GameUpdateViewData | ErrorUpdate) => {
      // terron (F1): после stop() графика disposed — поздние сообщения
      // терминированного воркера (уже в очереди event-loop) игнорируем.
      if (!this.isActive) return;
      if (this.lobby.gameStartInfo === undefined) {
        throw new Error("missing gameStartInfo");
      }
      if ("errMsg" in gu) {
        // terron: телеметрия JS-краша симуляции (стек + память/устройство) → /admin/ios.
        reportIos("js_crash", {
          errMsg: gu.errMsg,
          stack: gu.stack,
          gameId: this.lobby.gameStartInfo.gameID,
        });
        // terron: снять оверлей, иначе модалка ошибки окажется под ним
        this.hideStartingModal();
        showErrorModal(
          gu.errMsg,
          gu.stack ?? "missing",
          this.lobby.gameStartInfo.gameID,
          this.clientID,
        );
        console.error(gu.stack);
        this.stop();
        return;
      }
      this.transport.turnComplete();
      gu.updates[GameUpdateType.Hash].forEach((hu: HashUpdate) => {
        this.eventBus.emit(new SendHashEvent(hu.tick, hu.hash));
      });
      camDiag.step("ингест_состояния", () => this.gameView.update(gu));
      this.traceCatchupEpisode(gu);
      // дев-датчик + сбор сводки: тик/с и очередь воркера
      perfHud.simTick(gu.pendingTurns);
      if (!this.perfCtxSent) {
        // Число игроков к первому ингесту уже известно; шлём ОДИН раз —
        // контекст нужен, чтобы цифры разных матчей были сравнимы.
        this.perfCtxSent = true;
        perfHud.setContext({ players: this.gameView.playerViews().length });
      }
      // terron воронка: игрок заспавнился (веха вовлечения после загрузки).
      // single-fire + no-op вне отслеживаемого матча (реплей/одиночка). Дёшево:
      // myPlayer() — быстрый геттер, trackSpawned гаснет после первого раза.
      if (this.gameView.myPlayer()?.hasSpawned() === true) trackSpawned();
      // terron: GPU-часть ингеста под гардом. Раньше исключение здесь (напр.
      // «small id undefined» на недоингещённом игроке) убивало WEBGL-обновления
      // НАВСЕГДА: CPU-стейт жил (имена/панели обновлялись), а территория/границы
      // замерзали + спавн-штриховка оставалась висеть (репорт 17.07 «границы не
      // обновляются, артефакты на пустых землях»). Билдер на каждом тике
      // пересинхронизируется от ПОЛНОГО стейта — пропущенный тик самолечится.
      try {
        // 🔴 terron 29.07 — ТРОТТЛИНГ ДОГОНА ОТКАЧЕН (репорт владельца: после
        // F5 в идущий матч и в архиве «карту рвёт», куски территорий не
        // дорисованы; при резюме «с текущего момента» всё цело — там догона
        // нет). Правка 20.07/26.07 пропускала GL-ингест, пока backlog воркера
        // велик, и опиралась на ЛОЖНОЕ допущение «билдер каждый тик
        // пересинхронизируется от ПОЛНОГО состояния». На деле территории
        // уезжают на GPU ДЕЛЬТОЙ (`frame.changedTiles`, render/frame/Upload.ts)
        // — тайлы, изменившиеся ИМЕННО на этом тике. Пропустили ингест → дельта
        // потеряна НАВСЕГДА. Чем длиннее догон, тем больше дыр.
        // Лечить полной перезаливкой раз в 100мс тоже нельзя: она строит
        // массивы на ВСЮ карту и на догоне в сотни ходов вешает страницу
        // (проверено — «Synchronizing — 399 turns left» намертво).
        // Вывод: ингест обязан идти КАЖДЫЙ тик. Ускорять догон — только
        // оптимизацией самого ингеста, не выбрасыванием кадров.
        camDiag.step("ингест_графики", () =>
          this.webglBuilder?.update(this.gameView),
        );
        camDiag.step("тик_рендера", () => this.renderer.tick());
        this.checkRenderFrozen();
      } catch (err) {
        console.error("render ingest tick failed (self-heals next tick):", err);
        void import("./Health").then(({ reportHealth }) =>
          reportHealth(
            "render_tick_error",
            err instanceof Error
              ? `${err.message} :: ${(err.stack ?? "").split("\n").slice(1, 3).join(" | ").replace(/\s+/g, " ").slice(0, 140)}`
              : String(err),
          ),
        );
      }

      // terron: первый тик отрисован — данные в GL-очереди, ждём кадр и
      // снимаем оверлей. Экран к этому моменту реально живой.
      if (!this.firstTickRendered) {
        this.firstTickRendered = true;
        // terron: трассировка холодного старта — отчёт load_trace (один на страницу).
        traceLoadReport(this.lobby.gameStartInfo?.gameID);
        requestAnimationFrame(() => this.hideStartingModal());
        // terron 20.07: ленивые GL-пассы (блум, сетка) дособираем В ПРОСТОЕ,
        // когда матч уже пошёл. На старте они не нужны и стоили заметную часть
        // сборки рендера; собирать их в момент первой ядерки — микро-фриз на
        // зрелищном событии. Здесь оба минуса сняты.
        const warm = () => this.webglBuilder?.warmLazyPasses();
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(warm, { timeout: 5000 });
        } else {
          setTimeout(warm, 1500);
        }
        // Музыка — постфактум: канал в первые секунды принадлежит карте.
        this.scheduleMusicStart();
      }

      // terron: индикатор догона. remaining = принято ходов − симулировано тиков.
      // >порога (реконнект после ребута ИЛИ заход спектатором в идущий матч) →
      // баннер «осталось N ходов»; догнал → «live». См. SyncStatus / server-reconnect.md.
      this.updateSyncProgress();

      // Emit tick metrics event for performance overlay
      this.eventBus.emit(
        new TickMetricsEvent(gu.tickExecutionDuration, this.currentTickDelay),
      );

      // Reset tick delay for next measurement
      this.currentTickDelay = undefined;

      // terron 01.08: снимок статистики из симуляции (раз в ~30 с) — пересылаем
      // серверу. Матчи без победителя иначе архивируются с пустой статистикой
      // (см. ClientStatsSchema): 221 из 400 матчей за сутки на проде.
      if (gu.allPlayersStats) {
        this.transport.sendStatsSnapshot(gu.allPlayersStats);
      }

      if (gu.updates[GameUpdateType.Win].length > 0) {
        this.saveGame(gu.updates[GameUpdateType.Win][0]);
      }
    });

    const onconnect = () => {
      console.log("Connected to game server!");
      this.transport.rejoinGame(this.turnsSeen);
    };

    let hasGoneToPlayer = false;
    const onmessage = (message: ServerMessage) => {
      this.lastMessageTime = Date.now();
      if (message.type === "server_restart") {
        // террон: сервер перезапускается (деплой) → баннер; клиент сам реконнектится
        // и догонит ходы по lastTurn. См. SyncStatus / server-reconnect.md.
        syncStatus("restarting");
        return;
      }
      if (message.type === "start") {
        console.log("starting game! in client game runner");

        if (this.gameView.config().isRandomSpawn()) {
          const goToPlayer = () => {
            const myPlayer = this.gameView.myPlayer();

            if (this.gameView.inSpawnPhase() && !myPlayer?.hasSpawned()) {
              this.goToPlayerTimeout = setTimeout(goToPlayer, 1000);
              return;
            }

            if (!myPlayer) {
              return;
            }

            if (!this.gameView.inSpawnPhase() && !myPlayer.hasSpawned()) {
              showErrorModal(
                "spawn_failed",
                translateText("error_modal.spawn_failed.description"),
                this.lobby.gameID,
                this.clientID,
                true,
                false,
                translateText("error_modal.spawn_failed.title"),
              );
              return;
            }

            this.eventBus.emit(new GoToPlayerEvent(myPlayer, 10));
          };

          goToPlayer();
        }

        for (const turn of message.turns) {
          if (turn.turnNumber < this.turnsSeen) {
            continue;
          }
          while (turn.turnNumber - 1 > this.turnsSeen) {
            this.worker.sendTurn({
              turnNumber: this.turnsSeen,
              intents: [],
            });
            this.turnsSeen++;
          }
          this.worker.sendTurn(turn);
          this.turnsSeen++;
        }
        // Пачка догона прогнана — доклеиваем придержанные живые ходы и снова
        // разрешаем запрашивать догон при разрыве.
        this.drainPendingTurns();
        this.catchupPending = false;
      }
      if (message.type === "desync") {
        // terron (18.07): в РЕПЛЕЕ попап о десинке — шум: «других игроков» нет
        // (totalActiveClients=1), а старая запись закономерно расходится с
        // симом после балансных правок (спавн-таймер, ульты). Вместо модалки —
        // ОДНО спокойное уведомление сверху (текст владельца). Живые матчи не
        // трогаем: там десинк — настоящая тревога (модалка+телеметрия).
        if (this.lobby.gameRecord !== undefined) {
          console.warn(
            "replay hash drift (запись старее текущего сима):",
            JSON.stringify(message),
          );
          if (!this.replayDriftNoticeShown) {
            this.replayDriftNoticeShown = true;
            toast(
              L(
                "Это старый реплей: с этого хода из-за правок баланса симуляция может отличаться от оригинального матча.",
                "Old replay: from this turn on, balance updates may make the simulation differ from the original match.",
              ),
              "info",
              12_000,
            );
          }
          return;
        }
        if (this.lobby.gameStartInfo === undefined) {
          throw new Error("missing gameStartInfo");
        }
        showErrorModal(
          `desync from server: ${JSON.stringify(message)}`,
          "",
          this.lobby.gameStartInfo.gameID,
          this.clientID,
          true,
          false,
          "error_modal.desync_notice",
        );
      }
      if (message.type === "error") {
        showErrorModal(
          message.error,
          message.message,
          this.lobby.gameID,
          this.clientID,
          true,
          false,
          "error_modal.connection_error",
        );
      }
      // terron: ЗАМКИ НА УЛЬТЫ — реле отклонило интент на закрытую ульту.
      if (message.type === "ult_locked") {
        toast(
          message.reason === "anonymous"
            ? translateText("ultimate.locked_anon")
            : translateText("ultimate.locked_hint"),
          "error",
        );
        return;
      }
      if (message.type === "clan_invite_result") {
        const map: Record<string, string> = {
          invited: L("Приглашение отправлено", "Invitation sent"),
          already_invited: L(
            "Игрок уже приглашён",
            "Player is already invited",
          ),
          pending: L(
            "Игрок не в аккаунте — приглашение придёт после входа.",
            "Player has no account — invite arrives when they sign in.",
          ),
          already_member: L("Уже в клане", "Already in the clan"),
          forbidden: L(
            "Приглашать может только лидер",
            "Only the leader can invite",
          ),
          not_found: L("Клан не найден", "Clan not found"),
          error: L("Не удалось пригласить", "Couldn't invite"),
        };
        toast(
          map[message.status] ?? map.error,
          message.status === "invited" || message.status === "pending"
            ? "success"
            : "error",
        );
      }
      if (message.type === "clan_invited") {
        // уведомление приглашённому → в чат-ленту с accept/reject
        window.dispatchEvent(
          new CustomEvent("terron-clan-invited", {
            detail: {
              clanTag: message.clanTag,
              clanName: message.clanName,
              by: message.by,
            },
          }),
        );
      }
      if (message.type === "friend_request_result") {
        const map: Record<string, string> = {
          sent: L("Запрос в друзья отправлен", "Friend request sent"),
          already_friends: L("Вы уже друзья", "You're already friends"),
          already_pending: L("Запрос уже отправлен", "Request already pending"),
          limit_reached: L(
            "Лимит запросов этому игроку в матче",
            "Request limit for this player this match",
          ),
          auto_accepted: L("Теперь вы друзья", "You're now friends"),
          self: L("Нельзя добавить себя", "Can't add yourself"),
          target_not_found: L(
            "Игрок без аккаунта — нельзя добавить",
            "Player has no account — can't add",
          ),
          error: L("Не удалось отправить запрос", "Couldn't send request"),
        };
        const ok =
          message.status === "sent" || message.status === "auto_accepted";
        toast(map[message.status] ?? map.error, ok ? "success" : "error");
        // допом к тосту — строка в чат-ленте (просил владелец)
        if (ok) {
          window.dispatchEvent(
            new CustomEvent("terron-friend-request-sent", {
              detail: {
                status: message.status,
                targetName: message.targetName,
              },
            }),
          );
        }
      }
      if (message.type === "friend_requested") {
        // уведомление адресату → в чат-ленту с accept/reject
        window.dispatchEvent(
          new CustomEvent("terron-friend-requested", {
            detail: { requestId: message.requestId, by: message.by },
          }),
        );
      }
      if (message.type === "profile_result") {
        // ответ на запрос досье → EventsDisplay откроет /@slug (или тост).
        window.dispatchEvent(
          new CustomEvent("terron-profile-result", {
            detail: {
              target: message.target,
              slug: message.slug,
              name: message.name,
            },
          }),
        );
      }
      if (message.type === "turn") {
        if (
          !this.gameView.inSpawnPhase() &&
          !hasGoneToPlayer &&
          this.gameView.myPlayer() &&
          this.userSettings.goToPlayer()
        ) {
          hasGoneToPlayer = true;
          this.eventBus.emit(new GoToPlayerEvent(this.gameView.myPlayer()!, 8));
        }

        // Track when we receive the turn to calculate delay
        const now = Date.now();
        if (this.lastTickReceiveTime > 0) {
          // Calculate delay between receiving turn messages
          this.currentTickDelay = now - this.lastTickReceiveTime;
        }
        this.lastTickReceiveTime = now;

        if (this.turnsSeen !== message.turn.turnNumber) {
          // terron 20.07: это НЕ ошибка. Ход из будущего мы придерживаем
          // (pendingTurns) и применим после догона, ход из прошлого —
          // безвредный дубль. Красные строки пугали и выглядели как
          // «синхронизация сломана», хотя мир тикал нормально.
          console.debug(
            `turn out of order: have ${this.turnsSeen}, received ${message.turn.turnNumber}`,
          );
          // terron (12.07): САМОЛЕЧЕНИЕ. Раньше дырка в ходах (стартовый
          // догон потерялся/зарейсился, live-ход проскочил) была ФАТАЛЬНОЙ:
          // клиент вечно спамил эту ошибку, сим стоял на нуле, карта пустая.
          // Теперь при пропуске вперёд перезапрашиваем догон с turnsSeen
          // (сервер шлёт start с turns.slice(lastTurn); обработчик start
          // дедупит уже виденные). Троттлинг — раз в 5с. Ход ПОЗАДИ
          // (дубль после реплея догона) — норм, просто не применяем.
          // Ход из будущего — придержим (иначе он потерян навсегда).
          if (message.turn.turnNumber > this.turnsSeen) {
            this.pendingTurns.set(message.turn.turnNumber, message.turn);
          }
          if (
            message.turn.turnNumber > this.turnsSeen &&
            (!this.catchupPending ||
              Date.now() - this.catchupSentAt >
                ClientGameRunner.CATCHUP_TIMEOUT_MS) &&
            Date.now() - this.lastGapCatchupMs >
              ClientGameRunner.GAP_CATCHUP_THROTTLE_MS
          ) {
            // terron 20.07: пришли сюда С УЖЕ ЗАПРОШЕННЫМ догоном = пачка не
            // доехала за таймаут. Ровно этот случай правка от 20.07 и должна
            // сделать редким — датчик показывает, так ли это в бою.
            if (this.catchupPending) {
              const seen = this.turnsSeen;
              const pending = this.pendingTurns.size;
              const turn = message.turn.turnNumber;
              void import("./Health").then(({ reportHealth }) =>
                reportHealth("catchup_timeout", `turn ${turn} > seen ${seen}`, {
                  pending,
                }),
              );
            }
            this.lastGapCatchupMs = Date.now();
            this.catchupPending = true;
            this.catchupSentAt = Date.now();
            console.warn(
              `turn gap detected — requesting catch-up from turn ${this.turnsSeen}`,
            );
            this.transport.rejoinGame(this.turnsSeen);
          }
        } else {
          this.worker.sendTurn(
            // Filter out pause intents in replays
            this.gameView.config().isReplay()
              ? {
                  ...message.turn,
                  intents: message.turn.intents.filter(
                    (i) => i.type !== "toggle_pause",
                  ),
                }
              : message.turn,
          );
          this.turnsSeen++;
          this.drainPendingTurns();
        }
      }
    };
    this.transport.updateCallback(onconnect, onmessage);
    console.log("sending join game");
    // Rejoin game from the start so we don't miss any turns.
    this.transport.rejoinGame(0);
  }

  // terron: снятие загрузочного оверлея (см. start) — идемпотентно.
  private firstTickRendered = false;
  // terron: уведомление «старый реплей разошёлся с симом» — показываем один раз.
  private replayDriftNoticeShown = false;
  private hideOverlayFallback: number | null = null;

  // terron ПЕРФ: отложенный старт музыки (см. коммент в start()). 15с после
  // первого тика; на зажатой сети (Save-Data/2g) — 60с. mp3 больше не
  // конкурируют с map.bin/воркером в окно загрузки.
  private musicStartTimer: number | null = null;
  private scheduleMusicStart(): void {
    if (this.musicStartTimer !== null) return;
    const delay = netConstrained() ? 60_000 : 15_000;
    this.musicStartTimer = window.setTimeout(() => {
      this.musicStartTimer = null;
      if (!this.isActive) return;
      this.soundManager.playBackgroundMusic();
    }, delay);
  }

  // Применяет придержанные ходы, пока их номера идут подряд от turnsSeen.
  private drainPendingTurns(): void {
    while (this.pendingTurns.has(this.turnsSeen)) {
      const turn = this.pendingTurns.get(this.turnsSeen)!;
      this.pendingTurns.delete(this.turnsSeen);
      this.worker.sendTurn(turn);
      this.turnsSeen++;
    }
    // Всё, что осталось позади, уже неактуально — не копим память.
    for (const n of this.pendingTurns.keys()) {
      if (n < this.turnsSeen) this.pendingTurns.delete(n);
    }
  }

  private hideStartingModal(): void {
    if (this.hideOverlayFallback !== null) {
      clearTimeout(this.hideOverlayFallback);
      this.hideOverlayFallback = null;
    }
    const modal = document.querySelector("game-starting-modal") as
      | (HTMLElement & { hide?: () => void })
      | null;
    modal?.hide?.();
    // страховка: лоадер офлайн/хост-пути, если остался
    document.getElementById("terron-loading")?.remove();
  }

  public stop() {
    // terron: перестаём слать «палец/мышь» — транспорт этого матча уходит.
    stopInputModeTracking();
    clearMatchAccounts();
    // terron: обработанный выход (чистый лив ИЛИ js_crash) → снять watch. Останется
    // он только при memory-kill (stop() тогда не зовётся) → abnormal_exit на бусте.
    clearGameActive();
    // terron: рамка событийного матча (золотой/алмазный)
    document.body.classList.remove("golden-match", "diamond-match");
    resetHideUiMode(); // иначе меню осталось бы скрытым после выхода из матча
    // terron 20.07: сторож класса in-game снимаем ПЕРВЫМ делом — матч кончился,
    // и его тик не должен вернуть класс уже вышедшему в меню игроку (это был
    // бы ровно тот же сломанный экран, только наоборот).
    if (this.inGameClassWatch !== null) {
      clearInterval(this.inGameClassWatch);
      this.inGameClassWatch = null;
    }
    if (this.hideOverlayFallback !== null) {
      clearTimeout(this.hideOverlayFallback);
      this.hideOverlayFallback = null;
    }
    if (this.musicStartTimer !== null) {
      clearTimeout(this.musicStartTimer);
      this.musicStartTimer = null;
    }
    this.soundManager.dispose();
    this.graphicsListenerAbort?.abort();
    // terron (F1): отписка bus-подписок матча + полный teardown графики
    // (WebGL view/пассы/текстуры, RAF-цикл, glCanvas/inputOverlay из DOM,
    // __webglView=null). ДО isActive-гейта — stop() мог прийти и до start().
    for (const [type, fn] of this.busSubs) {
      try {
        this.eventBus.off(type, fn);
      } catch {
        /* ignore */
      }
    }
    this.busSubs = [];
    try {
      this.disposeGraphics?.();
    } catch (e) {
      console.error("stop: disposeGraphics failed", e);
    }
    this.disposeGraphics = null;

    // ⚠️ СЕТЬ И ТАЙМЕРЫ ГАСИМ ВСЕГДА, а не только у «активного» раннера.
    // isActive снимается, когда матч закончился сам, — и при выходе в меню
    // stop() выходил ЗДЕСЬ, оставляя живой транспорт: он продолжал стучаться и
    // рисовал «Reconnecting…» поверх меню (репорт владельца 30.07 после того,
    // как выход внутри площадки перестал перезагружать страницу).
    // leaveGame идемпотентен, лишний вызов безвреден.
    this.transport.leaveGame();
    syncStatus("live"); // снять баннер «Переподключение…», если он висел
    document.removeEventListener(
      "visibilitychange",
      this.onVisibilityForFrozen,
    );
    if (this.connectionCheckStartTimer) {
      clearTimeout(this.connectionCheckStartTimer);
      this.connectionCheckStartTimer = null;
    }
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    if (this.goToPlayerTimeout) {
      clearTimeout(this.goToPlayerTimeout);
      this.goToPlayerTimeout = null;
    }
    if (!this.isActive) return;

    this.isActive = false;
    this.worker.cleanup();
  }

  // terron: можно ли сейчас кликом выбрать точку спавна.
  // В фазе спавна — да. После старта — ещё TERRON_SPAWN_GRACE_SECONDS секунд грейса
  // для тех, кто не успел заспавниться (проебал своё время — всё равно сыграет).
  private canSpawnNow(): boolean {
    if (this.gameView.inSpawnPhase()) {
      return true;
    }
    const me = this.gameView.myPlayer();
    return (
      !!me &&
      !me.hasSpawned() &&
      this.gameView.elapsedGameSeconds() <= TERRON_SPAWN_GRACE_SECONDS
    );
  }

  private inputEvent(event: MouseUpEvent) {
    if (!this.isActive || this.renderer.uiState.ghostStructure !== null) {
      return;
    }
    const cell = this.renderer.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.gameView.isValidCoord(cell.x, cell.y)) {
      return;
    }
    console.log(`clicked cell ${cell}`);
    const tile = this.gameView.ref(cell.x, cell.y);
    if (
      this.gameView.isLand(tile) &&
      !this.gameView.hasOwner(tile) &&
      // Карта показана до первого хода (см. renderer_ready) — но симуляция ещё
      // не тикнула, и спавн-интент утёк бы в никуда. Осматриваться можно,
      // ставить точку — нет.
      this.firstTickRendered &&
      this.canSpawnNow() &&
      !this.gameView.config().isRandomSpawn()
    ) {
      this.eventBus.emit(new SendSpawnIntentEvent(tile));
      return;
    }
    if (this.gameView.inSpawnPhase()) {
      // terron: клик по ЗАНЯТОЙ суше в фазе спавна — не точка спавна. Сигналим
      // обучению с типом владельца, чтобы текст был «не тыкай в племена/нации/игроков».
      if (this.gameView.isLand(tile) && this.gameView.hasOwner(tile)) {
        const owner = this.gameView.owner(tile);
        let kind: "tribe" | "nation" | "player" = "tribe";
        if (owner.isPlayer()) {
          const t = owner.type();
          kind =
            t === PlayerType.Human
              ? "player"
              : t === PlayerType.Nation
                ? "nation"
                : "tribe";
        }
        window.dispatchEvent(
          new CustomEvent("terron-spawn-on-tribe", { detail: { kind } }),
        );
      }
      return;
    }
    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }
    this.myPlayer.actions(tile, [UnitType.TransportShip]).then((actions) => {
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            this.myPlayer!.troops() * this.renderer.uiState.attackRatio,
          ),
        );
      } else if (this.canAutoBoat(actions.buildableUnits, tile)) {
        this.sendBoatAttackIntent(tile);
      }
    });
  }

  private autoUpgradeEvent(event: AutoUpgradeEvent) {
    if (!this.isActive) {
      return;
    }

    const cell = this.renderer.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.gameView.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const tile = this.gameView.ref(cell.x, cell.y);

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    if (this.gameView.inSpawnPhase()) {
      return;
    }

    this.findAndUpgradeNearestBuilding(tile);
  }

  private findAndUpgradeNearestBuilding(clickedTile: TileRef) {
    this.myPlayer!.actions(clickedTile, Structures.types).then((actions) => {
      const upgradeUnits: {
        unitId: number;
        unitType: UnitType;
        distance: number;
      }[] = [];

      for (const bu of actions.buildableUnits) {
        if (bu.canUpgrade !== false) {
          const existingUnit = this.gameView
            .units()
            .find((unit) => unit.id() === bu.canUpgrade);
          if (existingUnit) {
            const distance = this.gameView.manhattanDist(
              clickedTile,
              existingUnit.tile(),
            );

            upgradeUnits.push({
              unitId: bu.canUpgrade,
              unitType: bu.type,
              distance: distance,
            });
          }
        }
      }

      if (upgradeUnits.length === 0) {
        return;
      }

      // Upgrade the closest affordable building. But if there's an unaffordable
      // building (any type) that's closer to clickedTile than the best candidate,
      // do nothing — the player clicked on that unaffordable building intending
      // to upgrade it, and we must not spend their gold on a different building.
      const bestUpgrade = findClosestBy(upgradeUnits, (u) => u.distance);
      if (!bestUpgrade) {
        return;
      }

      // Check if any unaffordable building is closer than bestUpgrade
      for (const bu of actions.buildableUnits) {
        if (bu.canUpgrade === false && bu.type !== bestUpgrade.unitType) {
          const myPlayerID = this.myPlayer!.id();
          const closestOfType = this.gameView
            .nearbyUnits(
              clickedTile,
              this.gameView.config().structureMinDist(),
              bu.type,
            )
            .filter(({ unit }) => unit.owner().id() === myPlayerID)
            .sort((a, b) => a.distSquared - b.distSquared)[0];

          if (closestOfType) {
            const dist = this.gameView.manhattanDist(
              clickedTile,
              closestOfType.unit.tile(),
            );
            if (dist <= bestUpgrade.distance) {
              // An unaffordable building of type bu.type is at least as close
              // as bestUpgrade — player clicked on it, not on bestUpgrade.
              return;
            }
          }
        }
      }

      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          bestUpgrade.unitId,
          bestUpgrade.unitType,
        ),
      );
    });
  }

  private doBoatAttackUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null) {
      return;
    }

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    this.myPlayer
      .buildables(tile, [UnitType.TransportShip])
      .then((buildables) => {
        if (this.canBoatAttack(buildables) !== false) {
          this.sendBoatAttackIntent(tile);
        } else {
          console.warn(
            "Boat attack triggered but can't send Transport Ship to tile",
          );
        }
      });
  }

  private doGroundAttackUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null) {
      return;
    }

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    this.myPlayer.actions(tile, null).then((actions) => {
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            this.myPlayer!.troops() * this.renderer.uiState.attackRatio,
          ),
        );
      }
    });
  }

  private doRetaliateAttackMostRecent(): void {
    if (!this.isActive || this.gameView.inSpawnPhase()) {
      return;
    }

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    const incomingAttacks = this.myPlayer.incomingAttacks().filter((a) => {
      // terron: гард от битой записи (attackerID undefined / неизвестный
      // smallID) — playerBySmallID кидается, а это хоткей-путь контратаки
      // (краш-луп «small id undefined» 17.07). Битую атаку пропускаем.
      if (a.attackerID === undefined) return false;
      try {
        const t = (
          this.gameView.playerBySmallID(a.attackerID) as PlayerView
        ).type();
        return t !== PlayerType.Bot;
      } catch {
        return false;
      }
    });

    if (incomingAttacks.length === 0) return;

    const mostRecentAttack = incomingAttacks[incomingAttacks.length - 1];

    const attacker = this.gameView.playerBySmallID(
      mostRecentAttack.attackerID,
    ) as PlayerView;
    if (!attacker) return;

    const counterTroops = Math.min(
      mostRecentAttack.troops,
      this.renderer.uiState.attackRatio * this.myPlayer.troops(),
    );
    this.eventBus.emit(new SendAttackIntentEvent(attacker.id(), counterTroops));
  }

  private doRequestAllianceUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null) return;

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    const myPlayer = this.myPlayer;

    const tileOwner = this.gameView.owner(tile);
    if (!tileOwner.isPlayer()) return;
    const recipient = tileOwner as PlayerView;

    myPlayer.actions(tile).then((actions) => {
      if (actions.interaction?.canSendAllianceRequest) {
        this.eventBus.emit(
          new SendAllianceRequestIntentEvent(myPlayer, recipient),
        );
      } else if (actions.interaction?.allianceInfo?.canExtend) {
        this.eventBus.emit(new SendAllianceExtensionIntentEvent(recipient));
      }
    });
  }

  private doBreakAllianceUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null) return;

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    const myPlayer = this.myPlayer;

    const tileOwner = this.gameView.owner(tile);
    if (!tileOwner.isPlayer()) return;
    const recipient = tileOwner as PlayerView;

    myPlayer.actions(tile).then((actions) => {
      if (actions.interaction?.canBreakAlliance) {
        this.eventBus.emit(
          new SendBreakAllianceIntentEvent(myPlayer, recipient),
        );
      }
    });
  }

  private getTileUnderCursor(): TileRef | null {
    if (!this.isActive || !this.lastMousePosition) {
      return null;
    }
    if (this.gameView.inSpawnPhase()) {
      return null;
    }
    const cell = this.renderer.transformHandler.screenToWorldCoordinates(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
    );
    if (!this.gameView.isValidCoord(cell.x, cell.y)) {
      return null;
    }
    return this.gameView.ref(cell.x, cell.y);
  }

  private canBoatAttack(buildables: BuildableUnit[]): false | TileRef {
    const bu = buildables.find((bu) => bu.type === UnitType.TransportShip);
    return bu?.canBuild ?? false;
  }

  private sendBoatAttackIntent(tile: TileRef) {
    if (!this.myPlayer) return;

    this.eventBus.emit(
      new SendBoatAttackIntentEvent(
        tile,
        this.myPlayer.troops() * this.renderer.uiState.attackRatio,
      ),
    );
  }

  private canAutoBoat(buildables: BuildableUnit[], tile: TileRef): boolean {
    if (!this.gameView.isLand(tile)) return false;

    const canBuild = this.canBoatAttack(buildables);
    if (canBuild === false) return false;

    // TODO: Global enable flag
    // TODO: Global limit autoboat to nearby shore flag
    // if (!enableAutoBoat) return false;
    // if (!limitAutoBoatNear) return true;
    const distanceSquared = this.gameView.euclideanDistSquared(tile, canBuild);
    const limit = 100;
    const limitSquared = limit * limit;
    return distanceSquared < limitSquared;
  }

  private onMouseMove(event: MouseMoveEvent) {
    this.lastMousePosition = { x: event.x, y: event.y };
  }

  private onConnectionCheck() {
    if (this.transport.isLocal) {
      return;
    }
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    if (timeSinceLastMessage > 5000) {
      console.log(
        `No message from server for ${timeSinceLastMessage} ms, reconnecting`,
      );
      this.lastMessageTime = now;
      this.transport.reconnect();
    }
  }
}

// terron: инфа об устройстве для баг-репортов (браузер/ОС/видеокарта/экран).
// БЕЗ IP и прочих сетевых данных. Особенно важна GPU-строка: «Program link error»
// и WebGL2-падения почти всегда = слабая/софтверная видеокарта или драйвер.
//
// ⚠️ 10.08: строка «GPU: WebGL-контекст не создан» оказалась ТУПИКОМ. Репорт
// Firefox/Win10 сообщал ровно её — и по нему нельзя было сказать ничего: ни
// какая видеокарта, ни жив ли WebGL1, ни что именно ответил браузер. Поэтому
// WebGL2 и WebGL1 теперь пробуются ПОРОЗНЬ, у каждого пишется причина отказа
// словами браузера, плюс отдельно проверяется обычный 2D-канвас и наличие
// WebGPU — это отделяет «сломана вся графика вкладки» от «нет только WebGL2».
function collectDeviceInfo(): string[] {
  const lines: string[] = [];
  try {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      hardwareConcurrency?: number;
    };
    lines.push(`UA: ${navigator.userAgent}`);
    if (navigator.platform) lines.push(`OS/Platform: ${navigator.platform}`);
    if (navigator.language) lines.push(`Lang: ${navigator.language}`);
    if (nav.hardwareConcurrency)
      lines.push(`CPU cores: ${nav.hardwareConcurrency}`);
    if (nav.deviceMemory) lines.push(`RAM (approx): ${nav.deviceMemory} GB`);
    lines.push(
      `Screen: ${screen.width}x${screen.height} @${window.devicePixelRatio}x`,
    );
    lines.push(
      `Страница: ${Math.round(performance.now() / 1000)}с, вкладка ${document.visibilityState}`,
    );
  } catch {
    /* nav info недоступна — пропускаем */
  }
  try {
    const two = probeGlContext("webgl2");
    if (two.ok) {
      lines.push(
        `GPU: ${two.renderer ?? "?"}${two.vendor ? ` — ${two.vendor}` : ""}${two.software ? "  ⚠️ СОФТВЕРНЫЙ РАСТЕРИЗАТОР" : ""}`,
      );
      lines.push(`WebGL2: есть (${two.version ?? "?"})`);
      lines.push(`GL limits: ${collectGlLimits()}`);
    } else {
      lines.push(`WebGL2: НЕТ — ${two.reason || "браузер не назвал причину"}`);
      // Если WebGL1 при этом живёт, у игрока «слишком старая графика», а если
      // и он мёртв — ускорение вырубил САМ браузер (упавший GPU-процесс,
      // выключённое HW-ускорение, webgl.disabled).
      const one = probeGlContext("webgl");
      if (one.ok) {
        lines.push(
          `WebGL1: есть — ${one.renderer ?? "?"} (движку нужен WebGL2)`,
        );
      } else {
        lines.push(
          `WebGL1: НЕТ — ${one.reason || "браузер не назвал причину"}`,
        );
        lines.push(
          "⇒ WebGL выключен во всём браузере, а не в игре: перезапустить браузер, включить аппаратное ускорение, обновить драйвер",
        );
      }
      let canvas2d = false;
      try {
        canvas2d = !!document.createElement("canvas").getContext("2d");
      } catch {
        /* и это упало — значит графика вкладки мертва целиком */
      }
      lines.push(
        `Canvas2D: ${canvas2d ? "работает" : "НЕТ"}; WebGPU: ${"gpu" in navigator ? "есть" : "нет"}`,
      );
    }
  } catch {
    lines.push("GPU: не удалось определить");
  }
  // Счётчики за вкладку. Много созданных = мы течём контекстами (лимит ~16);
  // много потерянных перед отказом = у браузера падает GPU-процесс.
  try {
    const st = glContextStats();
    lines.push(
      `GL-контексты за вкладку: создано ${st.created}, потеряно ${st.lost}` +
        (st.failures.length > 0 ? `; отказы: ${st.failures.join(" | ")}` : "") +
        (localStorage.getItem("terron_gfx_low") === "1"
          ? "; режим gfx_low"
          : ""),
    );
  } catch {
    /* localStorage может быть заблокирован — не критично */
  }
  return lines;
}

/** Лимиты железа — отсекают класс «шейдер не влез» одним замером. */
function collectGlLimits(): string {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  if (!gl) return "недоступны";
  try {
    return [
      ["fragUnif", gl.MAX_FRAGMENT_UNIFORM_VECTORS],
      ["vertUnif", gl.MAX_VERTEX_UNIFORM_VECTORS],
      ["varying", gl.MAX_VARYING_VECTORS],
      ["texUnits", gl.MAX_TEXTURE_IMAGE_UNITS],
      ["vertTex", gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS],
      ["texSize", gl.MAX_TEXTURE_SIZE],
    ]
      .map(([n, p]) => `${n}=${gl.getParameter(p as number)}`)
      .join(" ");
  } catch {
    return "недоступны";
  } finally {
    // ⚠️ terron 20.07: контекст ОБЯЗАТЕЛЬНО отпускаем — сбор данных идёт на
    // КАЖДЫЙ показ окна ошибки, и без освобождения серия ошибок съедала лимит
    // живых контекстов: дальше у игрока не создавался НИ ОДИН, и падало уже
    // «WebGL2 not supported». То есть наша диагностика сама добивала игрока.
    releaseGlContext(gl);
  }
}

function showErrorModal(
  error: string,
  message: string | undefined,
  gameID: GameID,
  clientID: ClientID | undefined,
  closable = false,
  showDiscord = true,
  heading = "error_modal.crashed",
) {
  if (document.querySelector("#error-modal")) {
    return;
  }

  // terron: телеметрия — модалка фатальной ошибки = игрок ВЫБИТ из матча.
  // Единая воронка всех игровых смертей: краш воркера, десинк, обрыв
  // соединения, WebGL. Классифицируем по тексту, чтобы в сводке было видно,
  // ЧЕМ именно умирают матчи. Динамический импорт — не грузим Health зря.
  const blob = `${error} ${message ?? ""}`;
  // «Program link error» / shader-ошибки = тот же GPU/драйвер-класс, что WebGL
  // (репорт 18.07: Intel UHD + ANGLE, модалка врала «Ошибка соединения»).
  const isGpuClass = /webgl|program link|shader/i.test(blob);
  const kind = /desync/i.test(blob)
    ? "desync"
    : isGpuClass
      ? "webgl_error"
      : "game_error_modal";
  // terron 10.08: у GPU-класса шлём в meta ВЕСЬ блок про устройство. Раньше
  // техданные жили только в тексте, который игрок мог скопировать (а мог и
  // не скопировать) — в базе оставалась одна строка «WebGL2 not supported»,
  // по которой разбирать было нечего. meta на сервере обрезается до 1000
  // символов, блок в него укладывается.
  const deviceLines = collectDeviceInfo();
  void import("./Health").then(({ reportHealth }) =>
    reportHealth(kind, String(error).slice(0, 200), {
      gameID,
      ...(isGpuClass ? { device: deviceLines.join(" ⏎ ").slice(0, 900) } : {}),
    }),
  );

  const translatedError = translateText(error);
  const displayError = translatedError === error ? error : translatedError;

  const modal = document.createElement("div");
  modal.id = "error-modal";

  // terron: WebGL2 не поднялся (старый GPU/драйвер/выключен) — даём прямую
  // кликабельную ссылку на полноценный гайд-страницу с решением, а не только
  // «шлите отчёт». Ловим по строке ошибки/сообщения.
  // + program link/shader: сбой графического драйвера — гайд тот же (обновить
  // драйвер / перезапустить браузер / включить аппаратное ускорение).
  const isWebGl2Error =
    /webgl2/i.test(error) ||
    /webgl2/i.test(message ?? "") ||
    /program link|shader/i.test(blob);
  if (isWebGl2Error) {
    const isRu = getCurrentLang() === "ru";
    const banner = document.createElement("p");
    banner.className = "error-modal-webgl2";
    banner.style.cssText =
      "margin:0 0 10px;padding:10px 12px;border:2px solid #b91c1c;border-radius:4px;background:#fef2f2;color:#111;font-weight:600;";
    const before = isRu
      ? "Похоже, сбоит графика (WebGL/драйвер). Часто лечится перезапуском браузера или обновлением драйвера видеокарты. Инструкция — "
      : "Looks like a graphics (WebGL/driver) failure. Restarting the browser or updating the GPU driver usually fixes it. Guide — ";
    const linkText = isRu ? "открыть инструкцию" : "open the guide";
    const gLink = document.createElement("a");
    gLink.href = "/webgl2-not-supported";
    gLink.target = "_blank";
    gLink.rel = "noopener noreferrer";
    gLink.textContent = linkText;
    gLink.style.cssText =
      "color:#1d4ed8;font-weight:800;text-decoration:underline;";
    banner.appendChild(document.createTextNode(before));
    banner.appendChild(gLink);
    modal.appendChild(banner);
  }

  // terron: строка-инструкция вынесена из копируемого блока — она стала кликабельной
  // шапкой со ссылкой на ТГ-чат. В <pre> (буфер обмена) — только техданные.
  // terron 10.08: у сбоя графики заголовок «Ошибка соединения!» уводил в
  // ложный след — и игрока, и нас (репорт 10.08 читался как проблема сети).
  const shownHeading =
    isGpuClass && heading === "error_modal.connection_error"
      ? "error_modal.graphics_error"
      : heading;

  const content = [
    translateText(shownHeading),
    `game id: ${gameID}`,
    `client id: ${clientID}`,
    `Error: ${displayError}`,
    message ? `Message: ${message}` : null,
    "--- device ---",
    ...deviceLines,
  ]
    .filter(Boolean)
    .join("\n");

  // terron: кликабельная шапка со ссылкой на связь. RU → Telegram-чат @terron_chat,
  // остальные языки (EN-база) → Discord-сервер. Токен-«хэндл» внутри строки i18n
  // заменяем на настоящую ссылку.
  if (showDiscord) {
    const isRu = getCurrentLang() === "ru";
    const notice = document.createElement("p");
    notice.className = "error-modal-notice";
    const noticeText = translateText("error_modal.paste_discord");
    const handle = isRu ? "@terron_chat" : "Discord";
    const link = document.createElement("a");
    link.href = isRu
      ? "https://t.me/terron_chat"
      : "https://discord.gg/XUyw6EtcHX";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = handle;
    link.style.color = "#2563eb";
    link.style.fontWeight = "700";
    const idx = noticeText.indexOf(handle);
    if (idx >= 0) {
      notice.appendChild(document.createTextNode(noticeText.slice(0, idx)));
      notice.appendChild(link);
      notice.appendChild(
        document.createTextNode(noticeText.slice(idx + handle.length)),
      );
    } else {
      notice.appendChild(document.createTextNode(noticeText + " "));
      notice.appendChild(link);
    }
    modal.appendChild(notice);
  }

  // Create elements
  const pre = document.createElement("pre");
  pre.textContent = content;

  const button = document.createElement("button");
  button.textContent = translateText("error_modal.copy_clipboard");
  button.className = "copy-btn";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(content);
      button.textContent = translateText("error_modal.copied");
    } catch {
      button.textContent = translateText("error_modal.failed_copy");
    }
  });

  // terron 21.08: кнопка «Перезагрузить» (решение владельца — везде, не только
  // в приложении). В нативе F5 нет вовсе: overscroll-behavior:none глушит
  // pull-to-refresh, а в WKWebView его и не существует без плагина.
  const reloadBtn = document.createElement("button");
  reloadBtn.textContent = translateText("error_modal.reload");
  reloadBtn.className = "copy-btn";
  reloadBtn.addEventListener("click", () => window.location.reload());

  // Add to modal
  modal.appendChild(pre);
  modal.appendChild(reloadBtn);
  modal.appendChild(button);
  if (closable) {
    const closeButton = document.createElement("button");
    closeButton.textContent = "X";
    closeButton.className = "close-btn";
    closeButton.addEventListener("click", () => {
      modal.remove();
    });
    modal.appendChild(closeButton);
  }

  document.body.appendChild(modal);
}

import version from "resources/version.txt?raw";
import { ClientEnv } from "src/client/ClientEnv";
import { UserMeResponse } from "../core/ApiSchemas";
import { EventBus } from "../core/EventBus";
import {
  GAME_ID_REGEX,
  GameInfo,
  GameRecord,
  GameStartInfo,
  PublicGameInfo,
  Turn,
} from "../core/Schemas";
import { GameEnv } from "../core/configuration/Config";
import { GameType } from "../core/game/Game";
import {
  DARK_MODE_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../core/game/UserSettings";
import "./AccountModal";
import "./CopyrightsPage";
import "./CurrencyPage";
import "./GuidePage";
import "./HallOfFamePage";
import { setNativeStatusBarHidden } from "./NativeStatusBar";
import { schedulePostGamePrefetch } from "./OfflinePrefetch";
import "./ProfilePage";
import "./PropagandaPage";
import "./ShopPage";
import "./SkinsPage";
import "./StatsPage";
import { installShowMessageBridge, toast } from "./Toast";
import "./WikiPage";
import "./hud/layers/ScreenshotButton";
import "./registerServiceWorker";
// terron: страница /money временно убрана — import "./MoneyPage";
import {
  claimPendingRewards,
  clearPrimeStatus,
  getApiBase,
  getUserMe,
  invalidateUserMe,
  refreshPrimeStatus,
} from "./Api";
import { getAnonPersistentIDs, userAuth } from "./Auth";
// terron: ChatPanel влит в EventsDisplay (единая лента) — отдельный чат удалён.
// import "./ChatPanel";
import {
  captureTrafficSource,
  fireVisit,
  startOnlineHeartbeat,
  trackMatchOutcome,
  trackPlayClick,
} from "./Analytics";
import "./ClanCreatePage";
import "./ClanHubPage";
import { joinLobby, type JoinLobbyResult } from "./ClientGameRunner";
import { getPlayerCosmeticsRefs } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import "./DailyFlyout";
import { refreshDisabledUlts } from "./DisabledUlts";
import "./FlagInput";
import { FlagInput } from "./FlagInput";
import "./FlagInputModal";
import { FlagInputModal } from "./FlagInputModal";
import { friendsNotifier } from "./FriendsNotifier";
import "./FriendsPage";
import { GameInfoModal } from "./GameInfoModal";
import "./GameModeSelector";
import { GameModeSelector } from "./GameModeSelector";
import { GamePushSDK } from "./GamePushSDK";
import { GameStartingModal } from "./GameStartingModal";
import { HelpModal } from "./HelpModal";
import { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { checkAbnormalExit } from "./IosReport";
import { JoinLobbyModal } from "./JoinLobbyModal";
import "./LangSelector";
import { LangSelector } from "./LangSelector";
import { initLayout } from "./Layout";
import "./LobbyChatPanel";
import "./LobbyDock";
import { loadLocalGame, pruneLocalGames } from "./LocalGameStore";
import { applyNamedSkinWithTimeout, namedSkinRef } from "./NamedSkin";
import { captureLobbyReferral, captureReferralFromUrl } from "./Referral";
import { launchTestGround, TEST_GROUND_PATH } from "./TestGround";
import { launchTutorial } from "./Tutorial";
import { YandexGamesSDK } from "./YandexGamesSDK";
// terron: движковый сайт-лидерборд заменён нашими рейтинг-таблицами (RATING.md).
// import "./LeaderboardModal";
import { installGlobalHealthHandlers, reportHealth } from "./Health";
import "./Matchmaking";
import { MatchmakingModal } from "./Matchmaking";
import { modalRouter } from "./ModalRouter";
import { initNavigation } from "./Navigation";
import "./NewsModal";
import "./PatternInput";
import "./RatingPage";
import { StoreModal } from "./Store";
import "./TerritoryPatternsModal";
import { TerritoryPatternsModal } from "./TerritoryPatternsModal";
import { TokenLoginModal } from "./TokenLoginModal";
import {
  SendCancelStartEvent,
  SendKickPlayerIntentEvent,
  SendRequestStartEvent,
  SendStartGameEvent,
  SendUpdateGameConfigIntentEvent,
} from "./Transport";
import { UserSettingModal } from "./UserSettingModal";
import "./UsernameInput";
import { genAnonUsername, UsernameInput } from "./UsernameInput";
import {
  getDiscordAvatarUrl,
  getMapName,
  incrementGamesPlayed,
  isDevSite,
  isInIframe,
  L,
  translateText,
} from "./Utils";
import { installSafariPinchZoomBlocker } from "./utilities/DisableSafariPinchZoom";

import "./components/DesktopNavBar";
import "./components/Footer";
import "./components/MainLayout";
import "./components/MobileNavBar";
import "./components/PlayPage";
import "./components/RankedModal";
import "./components/TerronAmbient";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./styles.css";
import "./styles/core/typography.css";
import "./styles/core/variables.css";
import "./styles/layout/container.css";
import "./styles/layout/header.css";
import "./styles/modal/chat.css";
import "./styles/terron-theme.css";

// terron: «остатки сайта дошли»-бикон воронки РФ-блокировок. Стреляет в момент,
// когда ОСНОВНОЙ БАНДЛ доехал и начал исполняться (это модульный top-level — код
// живёт в бандле, значит бандл скачался). boot-бикон летит раньше, инлайн из
// <head>, на первых байтах HTML. Дроп = boot без этого = «первый ответ прошёл, а
// дальше (главная JS-нагрузка, которую душит DPI) не докачалась». НЕ про «доиграл»
// — только про то, доехали ли остатки сайта. Разбор: /admin/ru-ban.
try {
  const sid = (window as unknown as { __tLbSid?: string }).__tLbSid;
  if (sid) {
    new Image().src =
      "/api/lb?s=" + encodeURIComponent(sid) + "&e=ready&t=" + Date.now();
  }
} catch {
  /* аналитика не должна ничего ронять */
}

// terron: пропорции картинки (imgW/imgH) — для статичного mode 4. Считаем НА КЛИЕНТЕ
// terron: резолв НИК → скин переехал в NamedSkin.ts — он нужен ещё и локальным
// стартам (одиночка/хост-офлайн/обучение), которые раньше скин не резолвили вовсе.

function updateAccountNavButton(userMeResponse: UserMeResponse | false) {
  const button = document.getElementById("nav-account-button");
  if (!button) return;

  const avatarEl = document.getElementById("nav-account-avatar") as
    | (HTMLImageElement & { _navToken?: symbol })
    | null;
  const personIconEl = document.getElementById(
    "nav-account-person-icon",
  ) as SVGElement | null;
  const emailBadgeEl = document.getElementById(
    "nav-account-email-badge",
  ) as HTMLElement | null;
  const signInTextEl = document.getElementById(
    "nav-account-signin-text",
  ) as HTMLSpanElement | null;

  // Unique token for this update call
  const navToken = Symbol();
  if (avatarEl) avatarEl._navToken = navToken;

  const showAvatar = (src: string, alt?: string) => {
    if (avatarEl) {
      avatarEl.alt = alt ?? translateText("main.discord_avatar_alt");
      // If the avatar fails to load (bad URL / CDN issue / offline), fall back
      // to the default sign-in UI instead of leaving a broken image.
      avatarEl.onerror = () => {
        if (avatarEl._navToken !== navToken) return;
        avatarEl.onerror = null;
        avatarEl.src = "https://cdn.discordapp.com/embed/avatars/0.png";
      };
      avatarEl.onload = () => {
        // Only handle if this is the latest update
        if (avatarEl._navToken !== navToken) return;
        // Clear error handler after a successful load.
        avatarEl.onerror = null;
      };
      avatarEl.src = src;
      avatarEl.classList.remove("hidden");
    }
    personIconEl?.classList.add("hidden");
    emailBadgeEl?.classList.add("hidden");
    signInTextEl?.classList.add("hidden");
    button?.classList.remove("border", "border-white/20");
  };

  const showSignIn = () => {
    avatarEl?.classList.add("hidden");
    personIconEl?.classList.remove("hidden");
    emailBadgeEl?.classList.add("hidden");
    signInTextEl?.classList.remove("hidden");
    // Restore border when showing signin state
    button?.classList.add("border", "border-white/20");
  };

  const showEmailLoggedIn = () => {
    avatarEl?.classList.add("hidden");
    personIconEl?.classList.remove("hidden");
    emailBadgeEl?.classList.remove("hidden");
    signInTextEl?.classList.add("hidden");
    button?.classList.add("border", "border-white/20");
  };

  const discord =
    userMeResponse !== false ? userMeResponse.user.discord : undefined;
  if (discord && avatarEl) {
    const avatarAlt = translateText("main.user_avatar_alt", {
      username: discord.username,
    });
    const url = getDiscordAvatarUrl(discord);
    if (url) {
      showAvatar(url, avatarAlt);
      return;
    }
  }

  const email =
    userMeResponse !== false ? userMeResponse.user.email : undefined;
  if (email) {
    showEmailLoggedIn();
    return;
  }

  showSignIn();
}

declare global {
  interface Window {
    turnstile: any;
    // terron: реклама удалена (Playwire RAMP/PageOS/Bolt, Google AdSense/Ad Manager) — см. ADS.md
    __terronInTutorial?: boolean; // «мы в обучающей песочнице» (TaskTracker глушит квесты)
    currentPageId?: string;
    showPage?: (pageId: string) => void;
  }

  // Extend the global interfaces to include your custom events
  interface DocumentEventMap {
    "join-lobby": CustomEvent<JoinLobbyEvent>;
    "kick-player": CustomEvent;
    "start-game": CustomEvent;
    "join-changed": CustomEvent;
    "open-matchmaking": CustomEvent<undefined>;
    userMeResponse: CustomEvent<UserMeResponse | false>;
    "leave-lobby": CustomEvent;
    "update-game-config": CustomEvent;
  }

  // Fixes the globalThis.addEventListener errors
  interface WindowEventMap {
    "event:user-settings-changed:settings.darkMode": CustomEvent<string>;
  }
}

export interface JoinLobbyEvent {
  // Multiplayer games only have gameID, gameConfig is not known until game starts.
  gameID: string;
  // GameConfig only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
  source?:
    | "public"
    | "private"
    | "host"
    | "matchmaking"
    | "singleplayer"
    | "tutorial";
  publicLobbyInfo?: GameInfo | PublicGameInfo;
  // terron 20.07: F5-резюм локального матча — сыгранные ходы из LocalGameStore.
  resumeTurns?: Turn[];
}

class Client {
  private lobbyHandle: JoinLobbyResult | null = null;
  private eventBus: EventBus = new EventBus();

  private currentUrl: string | null = null;

  private usernameInput: UsernameInput | null = null;
  private flagInput: FlagInput | null = null;

  private hostModal: HostPrivateLobbyModal;
  private joinModal: JoinLobbyModal;
  private gameModeSelector: GameModeSelector;
  // terron: окно перехода лобби→игра (prestart…join). В этот момент закрытие
  // хост-модалки может ложно дёрнуть leave-lobby (сервер сам стартует по отсчёту,
  // хост не проходит через startGame) → игрок вылетал из СВОЕГО матча ровно на
  // старте. Гейтим leave на это окно. Сбрасывается на join и по таймауту-страховке.
  private gameStarting = false;
  private gameStartingResetTimer: ReturnType<typeof setTimeout> | null = null;
  // terron: «запуск матча уже идёт» — от команды джойна до появления
  // lobbyHandle. В этом окне живут await'ы (auth, скин, косметика, turnstile),
  // и раньше оно было НЕЗАЩИЩЁННЫМ: прилетевший popstate разбирал адрес
  // /game/<id> заново и уводил на главную поверх грузящегося матча.
  private joinInFlight = false;
  private joinInFlightTimer: ReturnType<typeof setTimeout> | null = null;
  private userSettings: UserSettings = new UserSettings();
  private storeModal: StoreModal;
  private tokenLoginModal: TokenLoginModal;
  private matchmakingModal: MatchmakingModal;
  private mostRecentJoinEvent: number;

  private turnstileTokenPromise: Promise<{
    token: string;
    createdAt: number;
  }> | null = null;

  async initialize(): Promise<void> {
    // terron 20.07: почистить старые/лишние снапшоты локальных матчей (F5-резюм).
    // Отложено на 4с: prune открывает readwrite-транзакцию IndexedDB, а на старте
    // handleUrl → tryResumeLocalGame читает ту же базу. Чистке незачем лезть в
    // критический путь загрузки/резюма — гигиена, а не срочность. Fire-and-forget.
    setTimeout(() => void pruneLocalGames(), 4000);
    crazyGamesSDK.maybeInit();
    // terron: нативный Yandex Games SDK — ПАРКОВАН, путь публикации = GamePush.
    // maybeInit сам себя глушит, если активен GamePush-сниппет (window.__gpReady):
    // иначе два SDK дерутся за postMessage-канал к родителю и ломают детект
    // песочницы GamePush. Реально грузится только если игру встроят в Яндекс БЕЗ
    // GamePush (сейчас такого пути нет). Вне iframe (terron.io/Capacitor) — no-op.
    YandexGamesSDK.maybeInit().then(() => YandexGamesSDK.ready());
    // terron: GamePush (РФ-путь) — init в iframe площадки + логин нативным id на наш
    // бэкенд (/auth/ya). Вне площадки (terron.io/Capacitor) — no-op.
    // Дев-плашка состояния звука (на проде не появляется) — чтобы «дошёл ли
    // сигнал площадки» проверялось скриншотом, а не спором.
    // Гейт по хосту ЗДЕСЬ, а не только внутри модуля: иначе прод качает чанк,
    // чтобы тот сам сказал «не дев» — лишний запрос на каждом холодном старте.
    if (isDevSite()) {
      void import("./sound/DevAudioBadge").then(({ mountDevAudioBadge }) =>
        mountDevAudioBadge(),
      );
    }
    GamePushSDK.maybeInit().then(() => {
      // Чек-лист модерации GamePush: «игра загрузилась» — шлём СРАЗУ после init
      // (меню на этот момент уже смонтировано), затем логиним игрока площадки.
      GamePushSDK.gameStart();
      // Язык площадки: если SDK доинициализировался ПОЗЖЕ старта UI — догоняем
      // (при явном выборе игрока в настройках — no-op).
      GamePushSDK.applyPlatformLanguage();
      // Чек-лист: PRELOADER-реклама «при старте игры». Показываем сразу после
      // init — карта и бандл в это время догружаются фоном, так что ролик
      // ничего не задерживает (решение владельца: «пусть посмотрят рекламку»).
      GamePushSDK.showPreloaderAd();
      // Sticky-баннер висит ТОЛЬКО в меню (решение владельца): в матче карта на
      // весь экран, баннер поверх неё мешал бы. Прячем на старте матча и
      // возвращаем при выходе в меню.
      GamePushSDK.showStickyAd();
      // Поднимаем СВОЮ сессию только под УЖЕ вошедшим на площадке игроком.
      // У гостя вход всё равно не пройдёт (нечего подтверждать), а челлендж
      // сгорит и столкнётся с настоящим входом секундой позже — ровно так
      // ломался вход в песочнице 31.07.
      // После ЯВНОГО выхода тихо не перезаходим (ТЗ 31.07): площадка игрока
      // по-прежнему знает, и без этой проверки «выход» жил до первой загрузки.
      // allowCreate:false — автовход ВОЗОБНОВЛЯЕТ аккаунт, но не создаёт:
      // Яндекс авторизует игрока сам, и без этого первый заход молча заводил
      // аккаунт без единого действия (репорт владельца 31.07).
      // ⚠️ 25.08.2026, замечание модерации ВК: на площадках, где игрок
      // авторизован ВСЕГДА (ВК, ОК, Телеграм — «Always Authenticated» у
      // GamePush), окна входа не существует, нажать «Войти» игроку негде, и
      // правило «не заводим молча» превращало его в вечного гостя. Там аккаунт
      // ЗАВОДИМ сразу. Яндекс и остальные — как раньше: только возобновление.
      if (
        GamePushSDK.isPlayerLoggedIn() &&
        !GamePushSDK.autoLoginSuppressed()
      ) {
        void GamePushSDK.loginToBackend({
          allowCreate: GamePushSDK.platformAlwaysAuthorized(),
        });
      }
    });

    // terron реферал: захватить реф-код из URL (/invite/<код> или ?ref=) ДО
    // обработки token-login — чтобы регистрация по ссылке дала бонус 200 ЛТС.
    // Навбар сам покажет «+200» под кнопкой входа (читает localStorage).
    captureReferralFromUrl();

    // terron 24.08: прогрев рубильника раскатки ульт (TERRON_DISABLED_ULTS) —
    // одиночка читает кэш синхронно в LocalServer.start().
    void refreshDisabledUlts();

    // terron: если прошлая игра оборвалась перезагрузкой (memory-kill WKWebView и
    // т.п.) — на бусте зарепортить abnormal_exit с последним снапшотом памяти. См.
    // IosReport / /admin/ios.
    checkAbnormalExit();

    // terron аналитика: захватить источник трафика (from/utm, first-touch) и
    // отметить визит (Metrica-цель + серверная воронка /stats/traffic).
    captureTrafficSource();
    fireVisit();
    // Пульс «я здесь, я с такого-то канала» — единственный источник данных для
    // разреза онлайна по источникам (сервер источника не знает). Analytics.ts.
    startOnlineHeartbeat();

    // Register modals with the URL router. Lobby modals (join/host) and
    // matchmaking are intentionally omitted — they own their own URL state
    // (path-based) or none at all.
    modalRouter.register("store", {
      tag: "store-modal",
      pageId: "page-item-store",
    });
    modalRouter.register("settings", {
      tag: "user-setting",
      pageId: "page-settings",
    });
    modalRouter.register("leaderboard", {
      tag: "rating-page",
      pageId: "page-leaderboard",
    });
    // terron: /clan = наш хаб кланов (заменил мёртвую апстрим clan-modal).
    modalRouter.register("clan", { tag: "clan-hub-page", pageId: "page-clan" });
    // terron: /friends = страница друзей (список/заявки/добавление). См. friends.md.
    modalRouter.register("friends", {
      tag: "friends-page",
      pageId: "page-friends",
    });
    // Создание клана — /clan/new (алиасы /clan/create, /new). См. ClanCreatePage / clans.md.
    modalRouter.register("clan-create", {
      tag: "clan-create-page",
      pageId: "page-clan-create",
    });
    // Редактирование клана — /clan/<slug>, тот же компонент в режиме правки.
    modalRouter.register("clan-edit", {
      tag: "clan-create-page",
      pageId: "page-clan-create",
    });
    modalRouter.register("account", {
      tag: "account-modal",
      pageId: "page-account",
    });
    // Профиль игрока — путь `/@<slug>` (и `/@me` → свой профиль).
    modalRouter.register("profile", {
      tag: "profile-page",
      pageId: "page-profile",
    });
    // Скины — /skins (управление) и /skins/add (загрузка).
    modalRouter.register("skins", {
      tag: "skins-page",
      pageId: "page-skins",
    });
    // Магазин — /shop (заглушка с балансом ПТС).
    modalRouter.register("shop", {
      tag: "shop-page",
      pageId: "page-shop",
    });
    // Валюты — /currency (публичный лор: золото/бумаги/алмазы).
    modalRouter.register("currency", {
      tag: "currency-page",
      pageId: "page-currency",
    });
    // terron: /ults — дерево ульт с замками (TZ-ult-unlocks.md), ленивый чанк.
    modalRouter.register("ults", {
      tag: "ult-tree-page",
      load: () => import("./UltTreePage"),
      pageId: "page-ults",
    });
    // TERRON Prime — /prime (что даёт, откуда берётся; ссылка из магазина).
    modalRouter.register("prime", {
      tag: "prime-page",
      load: () => import("./PrimePage"),
      pageId: "page-prime",
    });
    // Гайды — /guide (/guide/stack: выгодно ли стакать здания).
    modalRouter.register("guide", {
      tag: "guide-page",
      pageId: "page-guide",
    });
    // Вики — /wiki (раздел ультов /wiki/ult + деталь /wiki/ult/<slug>).
    modalRouter.register("wiki", {
      tag: "wiki-page",
      pageId: "page-wiki",
    });
    // Статистика — /stats (онлайн и партии во времени; клик из футера).
    modalRouter.register("stats", {
      tag: "stats-page",
      pageId: "page-stats",
    });
    // Пропаганда — /propaganda (баннеры + пресскит-тексты для шеринга).
    modalRouter.register("propaganda", {
      tag: "propaganda-page",
      pageId: "page-propaganda",
    });
    // Авторство и лицензии — /copyrights (атрибуция AGPL/CC, родословная, исходник).
    modalRouter.register("copyrights", {
      tag: "copyrights-page",
      pageId: "page-copyrights",
    });
    // Зал славы — /glory (алиасы /слава, /fame, /hall-of-fame): ютуберы + тестеры.
    modalRouter.register("glory", {
      tag: "hall-of-fame-page",
      pageId: "page-hall-of-fame",
    });
    // terron 28.08: АДМИНКА И МОДЕРАЦИЯ ВЫНЕСЕНЫ ИЗ ИГРОВОГО КЛИЕНТА в отдельное
    // приложение (свой репозиторий, свой контейнер, свой домен). Здесь были восемь
    // регистраций: /admin, /admin/balance, /admin/news, /admin/petri-bonus,
    // /admin/ru-ban, /admin/ios, /moder-skin, /moder-achievements. Причины:
    // (1) игровой бандл публикуется под AGPL — модерации и админ-инструментам в
    // открытом коде делать нечего; (2) страницы ехали в бандл каждому игроку.
    // Настоящий гейт всегда был на сервере (platform-api отдаёт 403/404
    // не-админу) — он не изменился.
    // terron: страница /money временно убрана (закомментирована).
    // Деньги — /money (баланс ЛТС/ПТС, правила начислений, тест-кнопки).
    // modalRouter.register("money", {
    //   tag: "money-page",
    //   pageId: "page-money",
    // });
    modalRouter.register("help", { tag: "help-modal", pageId: "page-help" });
    modalRouter.register("news", { tag: "news-modal", pageId: "page-news" });
    modalRouter.register("language", {
      tag: "language-modal",
      pageId: "page-language",
    });
    // terron: ranked (matchmaking) бэкенд ещё не готов (api /matchmaking → 404).
    // Apple 2.2 цепляется к недоделанным фичам → роут /ranked НЕ регистрируем, чтобы
    // фича была полностью недостижима. Вернём вместе с бэкендом матчмейкинга.
    // modalRouter.register("ranked", { tag: "ranked-modal", pageId: "page-ranked" });
    modalRouter.register("troubleshooting", {
      tag: "troubleshooting-modal",
      pageId: "page-troubleshooting",
    });
    modalRouter.register("territory-patterns", {
      tag: "territory-patterns-modal",
    });
    modalRouter.register("flag-input", { tag: "flag-input-modal" });
    // terron 25.08: навбары рисуются РАНЬШЕ этих регистраций (Lit поднимает их
    // на импорте модуля, а initialize() бежит по DOMContentLoaded), поэтому в
    // первом рендере адресов разделов ещё нет. Сообщаем — они перерисуются и
    // проставят href (см. Navigation.navPath).
    window.dispatchEvent(new CustomEvent("nav-paths-ready"));

    // Prefetch turnstile token so it is available when
    // the user joins a lobby.
    // terron: НЕ префетчим в GameEnv.Dev (наш прод!) — при джойне токен там
    // всё равно null (см. getTurnstileToken(lobby)), сервер его не проверяет
    // (Worker.ts гейт `!== Dev`), а виджет Cloudflare гонялся ВХОЛОСТУЮ:
    // challenges.cloudflare.com у части RU-мобилок блокируется → тост
    // «Turnstile error 300030» и сорванный вход (телеметрия client_health
    // поймала таких игроков). Убираем театр — убираем и поломку.
    if (ClientEnv.env() !== GameEnv.Dev) {
      this.turnstileTokenPromise = getTurnstileToken();
    }

    // Wait for components to render before setting version
    await customElements.whenDefined("mobile-nav-bar");
    await customElements.whenDefined("desktop-nav-bar");

    // terron: proprietary display font removed; UI falls back to Inter/sans-serif.

    const versionElements = document.querySelectorAll(
      "#game-version, .game-version-display",
    );
    if (versionElements.length === 0) {
      console.warn("Game version element not found");
    } else {
      const trimmed = version.trim();
      const displayVersion = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
      versionElements.forEach((el) => {
        (el as HTMLElement).style.fontFamily = "Inter, sans-serif";
        el.textContent = displayVersion;
      });
    }

    const langSelector = document.querySelector(
      "lang-selector",
    ) as LangSelector;
    if (!langSelector) {
      console.warn("Lang selector element not found");
    }

    this.flagInput = document.querySelector("flag-input") as FlagInput;
    if (!this.flagInput) {
      console.warn("Flag input element not found");
    }

    this.usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!this.usernameInput) {
      console.warn("Username input element not found");
    }

    this.gameModeSelector = document.querySelector(
      "game-mode-selector",
    ) as GameModeSelector;

    window.addEventListener("beforeunload", async () => {
      console.log("Browser is closing");
      if (this.lobbyHandle !== null) {
        // terron аналитика: ушёл с сайта посреди матча (no-op, если матч уже
        // закончился/зафиксирован; single-fire guard).
        trackMatchOutcome("left");
        this.lobbyHandle.stop(true);
        await crazyGamesSDK.gameplayStop();
      }
    });

    // terron спидран: из рейтинга «Создать лобби» → открыть хост-лобби с
    // пресетом (карта Мира + сложность + стандарт). См. RatingPage/HostLobbyModal.
    window.addEventListener("terron-open-speedrun-lobby", (e: Event) => {
      const d = (e as CustomEvent).detail?.difficulty;
      window.showPage?.("page-host-lobby");
      this.hostModal?.open({ speedrunDifficulty: d });
    });

    document.addEventListener("join-lobby", this.handleJoinLobby.bind(this));
    document.addEventListener("leave-lobby", this.handleLeaveLobby.bind(this));
    // Позывной привязан к аккаунту: вход под ДРУГИМ аккаунтом заменяет ник в
    // лобби именем нового аккаунта. Раньше localStorage-ник жил поверх любой
    // сессии — сменил аккаунт, а в лобби остался чужой позывной (репорт 31.07).
    window.addEventListener("terron-auth-changed", () => {
      void this.syncNickWithAccount();
    });
    void this.syncNickWithAccount();
    document.addEventListener("kick-player", this.handleKickPlayer.bind(this));
    document.addEventListener("start-game", this.handleStartGame.bind(this));
    document.addEventListener("request-start", () => {
      this.eventBus?.emit(new SendRequestStartEvent());
    });
    document.addEventListener("cancel-start", () => {
      this.eventBus?.emit(new SendCancelStartEvent());
    });
    document.addEventListener(
      "update-game-config",
      this.handleUpdateGameConfig.bind(this),
    );
    document.addEventListener(
      "open-matchmaking",
      this.handleOpenMatchmaking.bind(this),
    );

    const hlpModal = document.querySelector("help-modal") as HelpModal;
    if (!hlpModal || !(hlpModal instanceof HelpModal)) {
      console.warn("Help modal element not found");
    }
    const giModal = document.querySelector("game-info-modal") as GameInfoModal;
    if (!giModal || !(giModal instanceof GameInfoModal)) {
      console.warn("Game info modal element not found");
    }
    const helpButton = document.getElementById("help-button");
    if (helpButton) {
      helpButton.addEventListener("click", () => {
        if (hlpModal && hlpModal instanceof HelpModal) {
          hlpModal.open();
        }
      });
    }

    const flagInputModal = document.querySelector(
      "flag-input-modal",
    ) as FlagInputModal;
    if (!flagInputModal || !(flagInputModal instanceof FlagInputModal)) {
      console.warn("Flag input modal element not found");
    }

    // Attach listener to any flag-input component (desktop or potentially others)
    document.querySelectorAll("flag-input").forEach((flagInput) => {
      flagInput.addEventListener("flag-input-click", () => {
        if (flagInputModal && flagInputModal instanceof FlagInputModal) {
          flagInputModal.open();
        }
      });
    });

    this.storeModal = document.getElementById("page-item-store") as StoreModal;
    if (!this.storeModal || !(this.storeModal instanceof StoreModal)) {
      console.warn("Store modal element not found");
    }

    const patternsModal = document.getElementById(
      "territory-patterns-modal",
    ) as TerritoryPatternsModal;
    if (!patternsModal || !(patternsModal instanceof TerritoryPatternsModal)) {
      console.warn("Patterns modal element not found");
    }

    // Attach listener to any pattern-input component
    document.querySelectorAll("pattern-input").forEach((patternInput) => {
      patternInput.addEventListener("pattern-input-click", () => {
        patternsModal.open();
      });
    });

    if (isInIframe()) {
      const mobilePat = document.getElementById("pattern-input-mobile");
      if (mobilePat) mobilePat.style.display = "none";
    }

    if (!this.storeModal || !(this.storeModal instanceof StoreModal)) {
      console.warn("Store modal element not found");
    }

    // We no longer need to manually manage the preview button as PatternInput handles it component-side.
    // However, we still want to ensure the modal can be opened.
    // The setupPatternInput above handles the click event for the new buttons.

    this.storeModal.refresh();

    window.addEventListener("showPage", (e: any) => {
      if (typeof e?.detail === "string" && e.detail === "page-play") {
        setTimeout(() => {
          this.storeModal.refresh();
        }, 50);
      }
    });

    this.tokenLoginModal = document.querySelector(
      "token-login",
    ) as TokenLoginModal;
    if (
      !this.tokenLoginModal ||
      !(this.tokenLoginModal instanceof TokenLoginModal)
    ) {
      console.warn("Token login modal element not found");
    }

    this.matchmakingModal = document.querySelector(
      "matchmaking-modal",
    ) as MatchmakingModal;
    if (
      !this.matchmakingModal ||
      !(this.matchmakingModal instanceof MatchmakingModal)
    ) {
      console.warn("Matchmaking modal element not found");
    }

    const onUserMe = async (userMeResponse: UserMeResponse | false) => {
      updateAccountNavButton(userMeResponse);
      // terron: приложение НЕ показывает рекламу — весь ad-код удалён (см. ADS.md).
      document.dispatchEvent(
        new CustomEvent("userMeResponse", {
          detail: userMeResponse,
          bubbles: true,
          cancelable: true,
        }),
      );

      if (userMeResponse !== false) {
        // Authorized
        console.log(
          `Your player ID is ${userMeResponse.player.publicId}\n` +
            "Sharing this ID will allow others to view your game history and stats.",
        );
        // terron (друзья): сайт-уведомления «друг зашёл в лобби» / входящие заявки.
        friendsNotifier.start();
      }
    };

    if ((await userAuth()) === false) {
      // Not logged in
      onUserMe(false);
      // terron: аноним не может быть премом — гасим кэш прошлого хозяина
      // устройства (иначе ему достаётся прем-ряд сетки ульт).
      clearPrimeStatus();
    } else {
      // JWT appears to be valid
      // TODO: Add caching
      getUserMe().then(onUserMe);
      void refreshPrimeStatus(); // terron: кэшируем статус TERRON Prime для сетки ульт
      void this.claimPendingRewardsOnce(); // terron: награды, добытые ещё анонимом
    }

    const settingsModal = document.querySelector(
      "user-setting",
    ) as UserSettingModal;
    if (!settingsModal || !(settingsModal instanceof UserSettingModal)) {
      console.warn("User settings modal element not found");
    }
    document
      .getElementById("settings-button")
      ?.addEventListener("click", () => {
        if (settingsModal && settingsModal instanceof UserSettingModal) {
          settingsModal.open();
        }
      });

    this.hostModal = document.querySelector(
      "host-lobby-modal",
    ) as HostPrivateLobbyModal;
    if (!this.hostModal || !(this.hostModal instanceof HostPrivateLobbyModal)) {
      console.warn("Host private lobby modal element not found");
    } else {
      this.hostModal.eventBus = this.eventBus;
    }

    this.joinModal = document.querySelector(
      "join-lobby-modal",
    ) as JoinLobbyModal;
    if (!this.joinModal || !(this.joinModal instanceof JoinLobbyModal)) {
      console.warn("Join lobby modal element not found");
    } else {
      this.joinModal.eventBus = this.eventBus;
    }

    const applyDarkMode = (isDark: boolean) => {
      if (isDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };

    applyDarkMode(this.userSettings.darkMode());

    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${DARK_MODE_KEY}`,
      (e: CustomEvent<string>) => {
        const isDark = e.detail === "true";
        applyDarkMode(isDark);
      },
    );

    // Attempt to join lobby
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.handleUrl());
    } else {
      this.handleUrl();
    }

    const onHashUpdate = () => {
      // Router-managed hash changes (#modal=...) are handled by the router
      // syncing in/out; we don't need to tear down the lobby state for them.
      if (modalRouter.isHashRouted()) {
        modalRouter.routeFromHash();
        return;
      }

      // Reset the UI to its initial state
      this.joinModal?.close();

      onJoinChanged();
    };

    const onPopState = () => {
      if (this.currentUrl !== null && this.lobbyHandle !== null) {
        // terron: back-жест/кнопка в игре → откатываем навигацию и открываем
        // наше ESC-меню (Продолжить / Наблюдать / На главную / громкость) вместо
        // голого exit-конфирма. Выйти из игры можно прямо из меню.
        history.pushState(null, "", this.currentUrl);
        window.dispatchEvent(new CustomEvent("terron-open-pause-menu"));
      } else {
        console.info("Game not active, handle hash update");

        onHashUpdate();
      }
    };

    const onJoinChanged = () => {
      if (this.lobbyHandle !== null) {
        this.handleLeaveLobby();
      }

      // Attempt to join lobby
      this.handleUrl();
    };

    // Handle browser navigation & manual hash edits
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashUpdate);
    window.addEventListener("join-changed", onJoinChanged);

    function updateSliderProgress(slider: HTMLInputElement) {
      const percent =
        ((Number(slider.value) - Number(slider.min)) /
          (Number(slider.max) - Number(slider.min))) *
        100;
      slider.style.setProperty("--progress", `${percent}%`);
    }

    document
      .querySelectorAll<HTMLInputElement>(
        "#bots-count, #private-lobby-bots-count",
      )
      .forEach((slider) => {
        updateSliderProgress(slider);
        slider.addEventListener("input", () => updateSliderProgress(slider));
      });
  }

  /**
   * terron: забрать награды, заработанные ЕЩЁ АНОНИМОМ (золотой матч, выигранный
   * до регистрации). Сервер хранит их «на предъявителя» по анонимному
   * persistentID браузера; он переживает логин, поэтому после входа просто
   * предъявляем его. Раз за загрузку и только у залогиненного — сервер вернёт
   * нули, если забирать нечего.
   */
  private async claimPendingRewardsOnce(): Promise<void> {
    try {
      if (sessionStorage.getItem("terron-rewards-claimed") === "1") return;
      sessionStorage.setItem("terron-rewards-claimed", "1");
    } catch {
      return; // без sessionStorage дёргать на каждой загрузке не будем
    }
    const ids = getAnonPersistentIDs();
    if (ids.length === 0) return;
    const got = await claimPendingRewards(ids);
    if (got.pts > 0 || got.lts > 0) {
      const parts = [
        got.pts > 0 ? `+${got.pts} 💎` : "",
        got.lts > 0 ? `+${got.lts}` : "",
      ].filter(Boolean);
      toast(
        L(
          `Награда за золотой матч зачислена: ${parts.join(" ")}`,
          `Golden match reward credited: ${parts.join(" ")}`,
        ),
        "success",
      );
    }
  }

  private async handleUrl() {
    // Wait for modal custom elements to be defined
    await Promise.all([
      customElements.whenDefined("join-lobby-modal"),
      customElements.whenDefined("host-lobby-modal"),
    ]);

    // Check if CrazyGames SDK is enabled first (no hash needed in CrazyGames)
    if (crazyGamesSDK.isOnCrazyGames()) {
      const lobbyId = await crazyGamesSDK.getInviteGameId();
      console.log("got game id", lobbyId);
      if (lobbyId && GAME_ID_REGEX.test(lobbyId)) {
        console.log("game parsed successfully");
        // Wait 2 seconds to ensure all elements are actually loaded,
        // On low end-chromebooks the join modal was not registered in time.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        window.showPage?.("page-join-lobby");
        this.joinModal?.open({ lobbyId });
        console.log(`CrazyGames: joining lobby ${lobbyId} from invite param`);
        return;
      }
    }
    crazyGamesSDK.isInstantMultiplayer().then((isInstant) => {
      if (isInstant) {
        console.log(
          `CrazyGames: joining instant multiplayer lobby from CrazyGames`,
        );
        this.hostModal.open();
      }
    });

    const strip = () =>
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );

    const alertAndStrip = (message: string) => {
      toast(message);
      strip();
    };

    const hash = window.location.hash;

    // Decode the hash first to handle encoded characters
    const decodedHash = decodeURIComponent(hash);
    const params = new URLSearchParams(decodedHash.split("?")[1] || "");

    // Handle different hash sections
    if (decodedHash.startsWith("#purchase-completed")) {
      // Parse params after the ?
      const status = params.get("status");

      if (status !== "true") {
        alertAndStrip("purchase failed");
        return;
      }

      const type = params.get("type");
      if (type === "currency_pack") {
        alertAndStrip(translateText("store.currency_pack_purchase_success"));
        return;
      }

      if (type === "subscription_tier") {
        toast(translateText("store.subscription_purchase_success"));
        strip();
        invalidateUserMe();
        void import("./SoftNavigate").then(({ softReload }) => softReload());
        return;
      }

      const cosmeticName = params.get("cosmetic");
      if (!cosmeticName) {
        toast("Something went wrong. Please contact support.");
        console.error("purchase-completed but no pattern name");
        return;
      }

      const setCosmetic = () => {
        if (cosmeticName.startsWith("pattern:")) {
          this.userSettings.setSelectedPatternName(cosmeticName);
        } else if (cosmeticName.startsWith("flag:")) {
          this.userSettings.setFlag(cosmeticName);
        }
      };
      const token = params.get("login-token");

      if (token) {
        strip();
        window.addEventListener("beforeunload", () => {
          // The page reloads after token login, so we need to save the pattern name
          // in case it is unset during reload.
          setCosmetic();
        });
        this.tokenLoginModal.openWithToken(token);
      } else {
        alertAndStrip(`purchase succeeded: ${cosmeticName}`);
        setCosmetic();
        this.storeModal.refresh();
      }
      return;
    }

    if (decodedHash.startsWith("#token-login")) {
      const token = params.get("token-login");

      if (!token) {
        alertAndStrip(
          `login failed! Please try again later or contact support.`,
        );
        return;
      }

      strip();
      this.tokenLoginModal.openWithToken(token);
      return;
    }

    // terron: /test — полигон: одиночка с бесконечным золотом/войсками, мгновенной
    // стройкой и слабыми ботами. Нужен, чтобы щупать интерфейс в ЖИВОМ матче, а не
    // ждать лобби и не умирать на второй минуте. Спека — TestGround.ts.
    if (TEST_GROUND_PATH.test(window.location.pathname)) {
      if (this.lobbyHandle !== null || this.gameStarting || this.joinInFlight) {
        return;
      }
      void launchTestGround(document.body);
      return;
    }

    // terron: /tutorial — сразу запускаем обучающую песочницу (без лобби/модалок)
    if (/^\/(?:w\d+\/)?tutorial\/?$/.test(window.location.pathname)) {
      void launchTutorial(document.body);
      return;
    }

    // terron: /singleplayer — адрес одиночной игры (его же ставит запуск сингла,
    // см. handleJoinLobby). Заход/перезагрузка по нему открывает окно создания
    // игры в режиме ОФЛАЙН с сохранёнными настройками игрока: локальный матч
    // после F5 не восстановить, но вернуть человека ровно туда, откуда он
    // стартовал — можно. Матч уже идёт (или запускается) — не трогаем.
    if (/^\/(?:w\d+\/)?singleplayer\/?$/.test(window.location.pathname)) {
      if (this.lobbyHandle !== null || this.gameStarting || this.joinInFlight) {
        return;
      }
      window.showPage?.("page-host-lobby");
      this.hostModal?.open({ skipShareCopy: true, forceOffline: true });
      return;
    }

    const pathMatch = window.location.pathname.match(
      /^\/(?:w\d+\/)?game\/([^/]+)/,
    );
    const lobbyId =
      pathMatch && GAME_ID_REGEX.test(pathMatch[1]) ? pathMatch[1] : null;
    if (lobbyId) {
      // terron: матч уже идёт или ЗАПУСКАЕТСЯ — не перебиваем его джойном по
      // адресу. Гейт на lobbyHandle один не спасал: между стартом и его
      // присвоением есть окно ожиданий (auth + косметика до 1.5с), а адрес
      // /game/<id> уже стоит. Прилетевший в это окно popstate уводил на главную
      // с «Лобби больше не активно» поверх грузящегося матча.
      if (this.lobbyHandle !== null || this.gameStarting || this.joinInFlight) {
        console.info("game in progress/starting — ignoring /game url join");
        return;
      }
      // terron 20.07: сперва пробуем ПОДНЯТЬ локальный матч из LocalGameStore
      // (F5 в одиночке / возврат по ссылке). Нашлась запись → резюмим её и НЕ
      // идём джойнить: серверного лобби с этим id нет, попытка дала бы «Лобби
      // не активно». Записи нет → обычный путь ниже (серверное лобби / реплей).
      if (await this.tryResumeLocalGame(lobbyId)) return;
      // terron реферал: заход по ссылке ПРИВАТНОГО лобби (холодная загрузка) →
      // привязка к создателю-владельцу ссылки (резолв на сервере; публичные лобби
      // не зарегистрированы и никому не начислят). Профильный код приоритетнее.
      captureLobbyReferral(lobbyId);
      window.showPage?.("page-join-lobby");
      this.joinModal.open({ lobbyId });
      console.log(`joining lobby ${lobbyId}`);
      return;
    }
    if (modalRouter.routeFromPath()) {
      return;
    }
    if (modalRouter.routeFromHash()) {
      return;
    }
    if (decodedHash.startsWith("#affiliate=")) {
      const affiliateCode = decodedHash.replace("#affiliate=", "");
      strip();
      if (affiliateCode) {
        this.storeModal?.open({ affiliateCode });
      }
    }
    if (decodedHash.startsWith("#refresh")) {
      void import("./SoftNavigate").then(({ softHome }) => softHome("/"));
    }

    if (this.consumeRequeueUrl()) {
      document.dispatchEvent(new CustomEvent("open-matchmaking"));
    }
  }

  private consumeRequeueUrl(): boolean {
    const searchParams = new URLSearchParams(window.location.search);
    if (!searchParams.has("requeue")) {
      return false;
    }

    searchParams.delete("requeue");
    const newUrl =
      window.location.pathname +
      (searchParams.toString() ? `?${searchParams.toString()}` : "") +
      window.location.hash;
    history.replaceState(null, "", newUrl);
    return true;
  }

  // terron: жив ли ещё game на game-сервере (та же проверка, что в JoinLobbyModal).
  // Возвращает true только на явный exists:true — при любой ошибке/недоступности
  // НЕ блокируем (false негативы хуже, чем один заход в мёртвую игру).
  private async publicLobbyExists(gameID: string): Promise<boolean> {
    try {
      const url = `/${ClientEnv.workerPath(gameID)}/api/game/${gameID}/exists`;
      const r = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) return true; // сеть/сервер шалит — не мешаем джойну
      if (!(r.headers.get("content-type") ?? "").includes("application/json"))
        return true;
      const info = (await r.json()) as { exists?: boolean };
      return info.exists !== false;
    } catch {
      return true; // не смогли проверить — пропускаем как раньше
    }
  }

  // terron 20.07: поднять локальный (одиночный/офлайн) матч из LocalGameStore.
  // Возвращает true, если запись нашлась и матч запущен (дальше джойнить не
  // надо). false — записи нет, идём обычным путём (серверное лобби / реплей).
  private async tryResumeLocalGame(gameID: string): Promise<boolean> {
    let snap: Awaited<ReturnType<typeof loadLocalGame>>;
    try {
      snap = await loadLocalGame(gameID);
    } catch {
      return false; // хранилище шалит — не мешаем обычному пути
    }
    if (!snap) return false;
    // Резюм = обычный локальный старт с source "singleplayer", но с уже
    // сыгранными ходами: handleJoinLobby → LocalServer прогонит их и продолжит
    // живую игру (тот же путь, что онлайн-догон). Пустой пул ходов (0 ходов
    // сохранилось) не резюмим — запись битая (персист копит с 20-го хода),
    // фиксируем как регресс механики и создаёмся заново.
    if (snap.turns.length === 0) {
      reportHealth("local_resume_failed", "0 ходов в записи");
      return false;
    }
    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: snap.gameID,
          gameStartInfo: snap.gameStartInfo,
          source: "singleplayer",
          resumeTurns: snap.turns,
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    return true;
  }

  // Страховка: если запуск оборвался исключением, флаг не должен залипнуть —
  // иначе входы по ссылке перестанут работать до перезагрузки страницы.
  private setJoinInFlight(active: boolean) {
    this.joinInFlight = active;
    if (this.joinInFlightTimer !== null) {
      clearTimeout(this.joinInFlightTimer);
      this.joinInFlightTimer = null;
    }
    if (active) {
      this.joinInFlightTimer = setTimeout(() => {
        this.joinInFlight = false;
        this.joinInFlightTimer = null;
      }, 30_000);
    }
  }

  private async handleJoinLobby(event: CustomEvent<JoinLobbyEvent>) {
    const lobby = event.detail;
    this.mostRecentJoinEvent = event.timeStamp;
    // terron аналитика: «нажал играть» (воронка трафика + Metrica-цель).
    trackPlayClick();
    // terron: всегда берём ЖИВОЙ инпут позывного из DOM. Кэш с init может
    // указывать на пересозданный Lit'ом элемент со старым значением (тогда в
    // игру уходил устаревший ник / имя аккаунта вместо набранного позывного).
    const liveUsernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    if (liveUsernameInput) this.usernameInput = liveUsernameInput;
    if (this.usernameInput && !this.usernameInput.canPlay()) {
      // terron: раньше тут был немой return — хост открывал лобби, но в игру
      // не подключался (невалидный ник) и потом «Старт» молчал без объяснения.
      // Теперь подсказываем причину и фокусируем ввод позывного.
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.fix_to_play"),
            color: "red",
            duration: 3500,
          },
        }),
      );
      (this.usernameInput as unknown as HTMLElement)
        ?.querySelector("input")
        ?.focus();
      return;
    }

    console.log(`joining lobby ${lobby.gameID}`);
    if (this.lobbyHandle !== null) {
      console.log("joining lobby, stopping existing game");
      this.lobbyHandle.stop(true);
      document.body.classList.remove("in-game");
      setNativeStatusBarHidden(false); // iOS: статус-бар обратно в меню
    }
    if (lobby.source === "public") {
      // terron КРИТ: витрина публичных лобби — in-memory реестр на platform-api с
      // TTL, он НЕ знает правду game-сервера. Карточка может протухнуть (хост закрыл
      // вкладку без DELETE / игра стартовала-кончилась / сервер перезапустился) и
      // повести в мёртвую игру → WS 1002 → «Game not found». Поэтому ПЕРЕД джойном
      // проверяем существование; если игры нет — снимаем карточку с витрины и мягко
      // сообщаем, вместо захода в пустоту.
      const exists = await this.publicLobbyExists(lobby.gameID);
      if (!exists) {
        void fetch(`${getApiBase()}/lobbies/public/${lobby.gameID}`, {
          method: "DELETE",
        }).catch(() => {});
        document.dispatchEvent(new CustomEvent("public-lobbies-refresh"));
        window.dispatchEvent(
          new CustomEvent("show-message", {
            detail: {
              message: L(
                "Лобби больше не активно — обновляю список",
                "Lobby is no longer active — refreshing list",
              ),
              color: "red",
              duration: 3500,
            },
          }),
        );
        return;
      }
      this.joinModal?.open({
        lobbyId: lobby.gameID,
        lobbyInfo: lobby.publicLobbyInfo,
      });
    }
    // Only update URL immediately for private lobbies, not public ones
    this.setJoinInFlight(true);
    if (lobby.source === "tutorial") {
      // terron: обучение живёт в одной сессии, без адреса лобби — просто /tutorial
      history.replaceState(null, "", "/tutorial");
    } else if (lobby.source === "singleplayer") {
      // terron 20.07: адрес одиночки — снова /game/<id> (восстановлено). Игра
      // ЛОКАЛЬНАЯ (LocalServer), на сервере её нет, но id теперь известен
      // LocalGameStore: заход по этому адресу (F5, «назад», ссылка) сперва ищет
      // локальную запись и ПОДНИМАЕТ матч из неё, а не идёт джойнить в пустоту
      // (см. handleUrl → tryResumeLocalGame). Поэтому «ссылки в никуда» больше
      // нет: адрес копируемый (после матча отдаст серверный реплей), а фальшивый
      // джойн закрыт наличием записи. Замена /singleplayer, который ломал шеринг.
      history.replaceState(null, "", `/game/${lobby.gameID}`);
    } else if (lobby.publicLobbyInfo?.gameConfig?.golden === true) {
      // terron: СОБЫТИЙНЫЙ МАТЧ — адрес ожидания = ПОСТОЯННАЯ ссылка /gold или
      // /diamond (её же копирует кнопка «Позвать»). Зашёл с витрины — можешь
      // просто скопировать адрес из строки, и он приведёт друга сюда же (лобби
      // живут всегда). На старте матча адрес всё равно станет /game/<id> —
      // реконнект цел.
      history.replaceState(
        null,
        "",
        lobby.publicLobbyInfo?.gameConfig?.eventTier === "diamond"
          ? "/diamond"
          : "/gold",
      );
    } else if (lobby.source !== "public") {
      this.updateJoinUrlForShare(lobby.gameID);
    }
    const auth = await userAuth();
    const playerRole = auth !== false ? (auth.claims.role ?? null) : null;
    // terron (чашка-виральность): резолвим НИК → зарегистрированный скин ДО старта
    // игры и кладём в активный скин (его подхватит рендер). Любой ник с зарегистрированным
    // скином → территория надевается им. Нет — оставляем ручной dev-скин как есть.
    const nick = this.usernameInput?.getUsername() ?? genAnonUsername();
    const namedSkin = await applyNamedSkinWithTimeout(nick);
    const cosmeticRefs = await getPlayerCosmeticsRefs();
    if (namedSkin) {
      // terron виральность: кладём свой named-скин в косметику → сервер раздаёт ВСЕМ →
      // другие видят мою текстуру.
      cosmeticRefs.customSkin = namedSkinRef(namedSkin);
    }
    const newLobbyHandle = joinLobby(this.eventBus, {
      gameID: lobby.gameID,
      cosmetics: cosmeticRefs,
      turnstileToken: await this.getTurnstileToken(lobby),
      playerName: nick,
      playerClanTag: this.usernameInput?.getClanTag() ?? null,
      clanTagCheck: this.usernameInput?.getClanCheck(),
      playerRole,
      gameStartInfo: lobby.gameStartInfo ?? lobby.gameRecord?.info,
      gameRecord: lobby.gameRecord,
      resumeTurns: lobby.resumeTurns,
    });

    if (this.mostRecentJoinEvent !== event.timeStamp) {
      newLobbyHandle.stop(true);
      console.warn("Join requested, but was superseded");
      this.setJoinInFlight(false);
      return;
    }

    this.lobbyHandle = newLobbyHandle;
    // Дальше матч защищён самим lobbyHandle.
    this.setJoinInFlight(false);

    this.lobbyHandle.prestart.then(() => {
      // terron: вошли в окно старта — гейтим ложный leave-lobby от закрытия
      // хост-модалки. Страховка: снять гейт через 20с, если join так и не пришёл.
      this.gameStarting = true;
      if (this.gameStartingResetTimer !== null) {
        clearTimeout(this.gameStartingResetTimer);
      }
      this.gameStartingResetTimer = setTimeout(() => {
        this.gameStarting = false;
        this.gameStartingResetTimer = null;
      }, 20000);
      // terron воронка: успешный вход в приватное/хост-лобби (для разрыва
      // «создал → зайти нельзя», см. prerealise.md). Публичные/туториал не считаем.
      if (lobby.source === "host" || lobby.source === "private") {
        try {
          void fetch(`${getApiBase()}/lobby/event`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            body: JSON.stringify({ stage: "enter", gameId: lobby.gameID }),
          }).catch(() => {});
        } catch {
          /* аналитика не должна мешать игре */
        }
      }
      console.log("Closing modals");
      document.getElementById("settings-button")?.classList.add("hidden");
      if (this.usernameInput) {
        // fix edge case where username-validation-error is re-rendered and hidden tag removed
        this.usernameInput.validationError = "";
      }
      document
        .getElementById("username-validation-error")
        ?.classList.add("hidden");
      this.joinModal?.closeWithoutLeaving();
      // terron: хост-модалку закрываем БЕЗ выхода из лобби — при серверном
      // отсчёте старта хост не проходит через startGame(), и обычный close()
      // выкинул бы его из собственного лобби ровно на старте матча.
      this.hostModal?.closeWithoutLeaving();
      [
        "game-starting-modal",
        "game-top-bar",
        "help-modal",
        "user-setting",
        "troubleshooting-modal",
        "territory-patterns-modal",
        "store-modal",
        "language-modal",
        "news-modal",
        "flag-input-modal",
        "account-button",
        "leaderboard-button",
        "token-login",
        "matchmaking-modal",
        "clan-hub-page",
        "lang-selector",
      ].forEach((tag) => {
        const modal = document.querySelector(tag) as HTMLElement & {
          close?: () => void;
          isModalOpen?: boolean;
        };
        if (modal?.close) {
          modal.close();
        } else if (modal && "isModalOpen" in modal) {
          modal.isModalOpen = false;
        }
      });
      this.gameModeSelector.stop();
      document.querySelectorAll(".ad").forEach((ad) => {
        (ad as HTMLElement).style.display = "none";
      });

      crazyGamesSDK.loadingStart();

      // show when the game loads
      const startingModal = document.querySelector(
        "game-starting-modal",
      ) as GameStartingModal;
      if (startingModal && startingModal instanceof GameStartingModal) {
        // terron: показываем КАКУЮ карту грузим (из конфига лобби/синглплеера).
        const mapType =
          lobby.gameStartInfo?.config?.gameMap ??
          lobby.publicLobbyInfo?.gameConfig?.gameMap;
        startingModal.show(mapType ? getMapName(mapType) : null);
      }
    });

    this.lobbyHandle.join.then(() => {
      // terron: игра реально стартовала — окно перехода закрыто, гейт leave снят.
      this.gameStarting = false;
      if (this.gameStartingResetTimer !== null) {
        clearTimeout(this.gameStartingResetTimer);
        this.gameStartingResetTimer = null;
      }
      this.joinModal?.closeWithoutLeaving();
      this.gameModeSelector.stop();
      incrementGamesPlayed();

      crazyGamesSDK.loadingStop();
      crazyGamesSDK.gameplayStart();
      GamePushSDK.gameplayStart(); // границы раунда для площадки (чек-лист)
      GamePushSDK.hideStickyAd(); // баннер не висит поверх карты
      // terron: снять оверлей «Загрузка карты…» (показан в HostLobbyModal на офлайн-старте)
      document.getElementById("terron-loading")?.remove();
      document.body.classList.add("in-game");
      setNativeStatusBarHidden(true); // iOS: статус-бар скрыт в игре

      // Ensure there's a homepage entry in history before adding the lobby entry
      if (window.location.hash === "" || window.location.hash === "#") {
        history.replaceState(null, "", window.location.origin + "#refresh");
      }
      const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
      history.pushState(
        null,
        "",
        lobby.source === "tutorial"
          ? // terron: обучение — адрес всегда /tutorial, без id лобби
            "/tutorial"
          : lobby.source === "singleplayer"
            ? // terron 20.07: одиночка — снова /game/<id> (восстановлено; см.
              // handleJoinLobby выше). Локальный матч резюмится из
              // LocalGameStore, шеринг реплея работает.
              `/game/${lobby.gameID}`
            : lobbyIdHidden
              ? "/streamer-mode"
              : // terron: чистый адрес — воркер и live/replay резолвятся внутри
                `/game/${lobby.gameID}`,
      );

      // Store current URL for popstate confirmation
      this.currentUrl = window.location.href;
    });
  }

  private updateJoinUrlForShare(lobbyId: string) {
    const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
    const targetUrl = lobbyIdHidden ? "/streamer-mode" : `/game/${lobbyId}`;
    const currentUrl = window.location.pathname;

    if (currentUrl !== targetUrl) {
      history.replaceState(null, "", targetUrl);
    }
  }

  /** Смена аккаунта → позывной нового аккаунта. Тот же аккаунт (или гость) —
   *  позывной не трогаем: свой выбранный ник дороже. Владельца помним в
   *  localStorage по user.id. */
  private async syncNickWithAccount(): Promise<void> {
    try {
      const { getMyProfile } = await import("./Api");
      const me = await getMyProfile();
      if (!me?.user) return; // гость — не трогаем
      // terron 01.08: заодно переносим в локальное зеркало факты, по которым
      // прячем предложение обучения (пройдено / есть победы). Иначе на новом
      // устройстве оно всплыло бы у ветерана заново.
      void import("./Tutorial").then(({ syncTutorialFlagsFromAccount }) =>
        syncTutorialFlagsFromAccount({
          tutorialDone: me.user.tutorialDone,
          wins: me.stats?.wins,
        }),
      );
      // Идентичность аккаунта: публичный номер (#1228) — стабилен и уникален.
      const uid = me.user.number != null ? String(me.user.number) : "";
      if (!uid) return;
      const KEY = "terron_nick_owner";
      const prevOwner = localStorage.getItem(KEY);
      if (prevOwner === uid) return; // тот же аккаунт — ник его
      localStorage.setItem(KEY, uid);
      const name = (me.user.name ?? "").trim();
      if (!name) return;
      const input = document.querySelector("username-input") as {
        setUsername?: (n: string) => void;
      } | null;
      input?.setUsername?.(name);
      console.log("[auth] аккаунт сменился — позывной обновлён:", name);
    } catch {
      /* сеть/гость — ничего не меняем */
    }
  }

  private async handleLeaveLobby(event?: CustomEvent) {
    if (this.lobbyHandle === null) {
      return;
    }
    // terron: не выходим из лобби в окне перехода лобби→игра (prestart…join).
    // Закрытие хост-модалки на серверном старте по отсчёту ложно дёргало leave →
    // хост вылетал из своего матча, оставался голодный клиент → 22с реконнект →
    // мимо спавн-фазы. Реальный выход игрока происходит уже ПОСЛЕ join.
    // Гейт только для АВТО-leave (закрытие хост-модалки на серверном старте).
    // Явный уход игрока (softHome, cause:"user-nav") исполняется всегда —
    // иначе матч продолжает жить за кадром поверх меню (репорт 31.07).
    if (this.gameStarting && event?.detail?.cause !== "user-nav") {
      console.log("ignoring leave-lobby during game start transition");
      return;
    }
    console.log("leaving lobby, cancelling game");
    // terron аналитика: ушёл в меню посреди матча (no-op, если матч уже
    // закончился — died/won/lost зафиксированы раньше; single-fire guard).
    trackMatchOutcome("quit");
    this.lobbyHandle.stop(true);
    this.lobbyHandle = null;
    this.currentUrl = null;

    try {
      history.replaceState(null, "", "/");
    } catch (e) {
      console.warn("Failed to restore URL on leave:", e);
    }

    document.body.classList.remove("in-game");
    setNativeStatusBarHidden(false); // iOS: статус-бар обратно в меню
    GamePushSDK.gameplayStop(); // конец раунда для площадки (чек-лист)
    GamePushSDK.showStickyAd(); // вернулись в меню — баннер снова уместен

    // terron: юзер сыграл матч и вышел в меню → теперь (и только теперь) уместно
    // догреть офлайн-кэш (World/иконки). См. политику в OfflinePrefetch.ts.
    schedulePostGamePrefetch();

    if (this.joinModal.isOpen()) {
      this.joinModal.close();
      if (event?.detail.cause === "full-lobby") {
        // Телеметрия: второй путь «не присоединились вовремя» (лобби набилось,
        // пока клиент подключался). Серия у одного игрока = системный сбой входа.
        reportHealth("join_timeout", "full_lobby");
        window.dispatchEvent(
          new CustomEvent("show-message", {
            detail: {
              message: translateText("public_lobby.join_timeout"),
              color: "red",
              duration: 3500,
            },
          }),
        );
      }
    }

    crazyGamesSDK.gameplayStop();
    void import("./SoftNavigate").then(({ closeInGameOverlays }) =>
      closeInGameOverlays(),
    );
  }

  private handleOpenMatchmaking(_event: CustomEvent<undefined>) {
    this.matchmakingModal?.open();
  }

  private handleKickPlayer(event: CustomEvent) {
    const { target } = event.detail;

    // Forward to eventBus if available
    if (this.eventBus) {
      this.eventBus.emit(new SendKickPlayerIntentEvent(target));
    }
  }

  private handleStartGame() {
    if (this.eventBus) {
      this.eventBus.emit(new SendStartGameEvent());
    }
  }

  private handleUpdateGameConfig(event: CustomEvent) {
    const { config } = event.detail;

    // Forward to eventBus if available
    if (this.eventBus) {
      this.eventBus.emit(new SendUpdateGameConfigIntentEvent(config));
    }
  }

  private async getTurnstileToken(
    lobby: JoinLobbyEvent,
  ): Promise<string | null> {
    if (
      ClientEnv.env() === GameEnv.Dev ||
      lobby.gameStartInfo?.config.gameType === GameType.Singleplayer
    ) {
      return null;
    }

    // Always request a new token on crazygames.
    if (this.turnstileTokenPromise === null || crazyGamesSDK.isOnCrazyGames()) {
      console.log("No prefetched turnstile token, getting new token");
      return (await getTurnstileToken())?.token ?? null;
    }

    const token = await this.turnstileTokenPromise;
    // Clear promise so a new token is fetched next time
    this.turnstileTokenPromise = null;
    if (!token) {
      console.log("No turnstile token");
      return null;
    }

    const tokenTTL = 3 * 60 * 1000;
    if (Date.now() < token.createdAt + tokenTTL) {
      console.log("Prefetched turnstile token is valid");

      return token.token;
    } else {
      console.log("Turnstile token expired, getting new token");
      return (await getTurnstileToken())?.token ?? null;
    }
  }
}

// Hide elements with no-crazygames class if on CrazyGames
const hideCrazyGamesElements = () => {
  if (crazyGamesSDK.isOnCrazyGames()) {
    document.querySelectorAll(".no-crazygames").forEach((el) => {
      (el as HTMLElement).style.display = "none";
    });
  }
};

// terron: если нас увели с /game/:id из-за исчезнувшей игры — показать мягкий
// тост вместо нативного браузерного диалога (см. Transport onclose 1002).
function showGameGoneToast(): void {
  let reason: string | null = null;
  try {
    reason = sessionStorage.getItem("terron-game-gone");
    if (reason) sessionStorage.removeItem("terron-game-gone");
  } catch {
    /* ignore */
  }
  if (!reason) return;
  const el = document.createElement("div");
  // L сам резолвит язык (селектор→localStorage→navigator, фолбэк EN), поэтому
  // работает и на раннем bootstrap, когда <lang-selector> ещё не в DOM.
  el.textContent = L(
    "Игра не найдена — сервер мог перезапуститься.",
    "Game not found — the server may have restarted.",
  );
  el.style.cssText =
    "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;" +
    "background:rgba(20,22,30,.95);color:#fff;padding:10px 16px;border-radius:10px;" +
    "font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4);" +
    "transition:opacity .5s ease";
  document.body.appendChild(el);
  setTimeout(() => (el.style.opacity = "0"), 4000);
  setTimeout(() => el.remove(), 4600);
}

// Initialize the client when the DOM is loaded
const bootstrap = () => {
  // terron: ловушки необработанных ошибок → телеметрия client_health
  // (проблемы, которые игроки не репортят). Ставим ПЕРВЫМИ — чтобы поймать
  // падения самой инициализации.
  installGlobalHealthHandlers();

  // Prevent Safari's page-level pinch-zoom, which ignores `user-scalable=no`
  // on iOS and can softlock the HUD. See issue #2330.
  installSafariPinchZoomBlocker();

  // Внутри площадки перезагружать страницу нельзя (переинициализирует их SDK),
  // а обычная ссылка `<a href="/wiki">` делает ровно это. Один перехватчик на
  // весь документ вместо правки каждой ссылки — см. SoftNavigate.
  // terron: дев-плашка логина — чанк не качаем вне дева (см. DevAudioBadge).
  if (isDevSite()) {
    void import("./DevLoginBadge").then(({ mountDevLoginBadge }) =>
      mountDevLoginBadge(),
    );
  }

  void import("./SoftNavigate").then(({ installSoftLinkInterceptor }) =>
    installSoftLinkInterceptor(),
  );

  initLayout();
  new Client().initialize();
  initNavigation();
  installShowMessageBridge();
  showGameGoneToast();

  // Hide elements immediately
  hideCrazyGamesElements();

  // Also hide elements after a short delay to catch late-rendered components
  setTimeout(hideCrazyGamesElements, 100);
  setTimeout(hideCrazyGamesElements, 500);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}

async function getTurnstileToken(): Promise<{
  token: string;
  createdAt: number;
}> {
  // Wait for Turnstile script to load (handles slow connections)
  let attempts = 0;
  while (typeof window.turnstile === "undefined" && attempts < 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  if (typeof window.turnstile === "undefined") {
    throw new Error("Failed to load Turnstile script");
  }

  const widgetId = window.turnstile.render("#turnstile-container", {
    sitekey: ClientEnv.turnstileSiteKey(),
    size: "normal",
    appearance: "interaction-only",
    theme: "light",
  });

  return new Promise((resolve, reject) => {
    window.turnstile.execute(widgetId, {
      callback: (token: string) => {
        window.turnstile.remove(widgetId);
        console.log(`Turnstile token received: ${token}`);
        resolve({ token, createdAt: Date.now() });
      },
      "error-callback": (errorCode: string) => {
        window.turnstile.remove(widgetId);
        console.error(`Turnstile error: ${errorCode}`);
        toast(`Turnstile error: ${errorCode}. Please refresh and try again.`);
        reject(new Error(`Turnstile failed: ${errorCode}`));
      },
    });
  });
}

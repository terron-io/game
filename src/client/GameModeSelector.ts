import { pollWhileVisible } from "./utilities/PollWhileVisible";
import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import { assetUrl } from "../core/AssetUrls";
import {
  eventRewardOf,
  TERRON_DIAMOND_ENABLED,
  TERRON_DIAMOND_FEATURE_LEAD_MS,
  TERRON_GOLDEN_ENABLED,
  TERRON_GOLDEN_FEATURE_LEAD_MS,
  TERRON_SPAWN_GRACE_SECONDS,
  TERRON_SPAWN_PHASE_PVP_SECONDS,
} from "../core/configuration/TerronTuning";
import {
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../core/game/Game";
import { PublicGameInfo, PublicGames } from "../core/Schemas";
import { getApiBase } from "./Api";
import "./components/IOSAddToHomeScreenBanner";
import { uiIcon } from "./components/ui/UiIcon";
import { reportHealth } from "./Health";
import { HostLobbyModal } from "./HostLobbyModal";
import { JoinLobbyModal } from "./JoinLobbyModal";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { isOffline, onOfflineChange } from "./Offline";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { UsernameInput } from "./UsernameInput";
import {
  calculateServerTimeOffset,
  getMapName,
  getModifierLabels,
  getSecondsUntilServerTimestamp,
  getServerNow,
  L,
  renderDuration,
  showToast,
  translateText,
} from "./Utils";

const CARD_BG = "bg-surface";

// terron: вкладки витрины. Событийные (золотой/алмазный матч) живут постоянно
// рядом с ротационным ффа — см. блок «СОБЫТИЙНЫЕ МАТЧИ на витрине» ниже.
type EventTab = "golden" | "diamond";
type TabKind = "ffa" | EventTab;

// terron: кровавый алмаз (ПТС) — награда за победу в золотом матче. Та же
// иконка, что в магазине/кошельке (components/ui/coin.ts).
const bloodDiamondIcon = assetUrl("images/BloodDiamondIcon.svg");

interface UserLobby {
  gameID: string;
  name: string;
  map?: string;
  gameMode?: string;
}

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  @state() private mapAspectRatios: Map<GameMapType, number> = new Map();
  @state() private inputValid: boolean = true;
  // terron: публичные ПОЛЬЗОВАТЕЛЬСКИЕ лобби (витрина рядом с системным FFA).
  @state() private userLobbies: UserLobby[] = [];
  @state() private offline: boolean = isOffline();
  private offlineUnsub: (() => void) | null = null;
  // terron ПЕРФ (08.08): опрос идёт только при ВИДИМОЙ вкладке — свёрнутая
  // больше не дёргает сеть (см. pollWhileVisible). Храним функции остановки.
  private stopUserLobbiesPoll: (() => void) | null = null;
  private staleWatchTimer = 0;
  private serverTimeOffset: number = 0;
  private defaultLobbyTime: number = 0;

  private lobbySocket = new PublicLobbySocket((lobbies) =>
    this.handleLobbiesUpdate(lobbies),
  );

  createRenderRoot() {
    return this;
  }

  // terron: раньше был «silent backstop» (кнопки якобы задизейблены при
  // невалидном нике) — по факту игроки ловили молчаливый отказ: клик по
  // «Создать/Войти» не делал НИЧЕГО, без объяснений. Теперь объясняем тостом,
  // фокусируем ввод ника и бьём телеметрией (сколько людей в это влетает).
  // quiet=true — для программных вызовов (авто-открытие из обучения).
  private validateUsername(quiet = false): boolean {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    const ok = usernameInput ? usernameInput.canPlay() : true;
    if (!ok && !quiet) {
      showToast(translateText("username.fix_to_play"), "red");
      (usernameInput as unknown as HTMLElement | null)
        ?.querySelector("input")
        ?.focus();
      reportHealth("username_blocked");
    }
    return ok;
  }

  connectedCallback() {
    super.connectedCallback();
    this.lobbySocket.start();
    void this.fetchUserLobbies();
    // terron: возврат из обучения по кнопке «В живой матч» → сразу открыть окно
    // создания лобби (игрок сам жмёт СТАРТ). Флаг ставит TutorialCards.
    try {
      if (sessionStorage.getItem("terron-open-host") === "1") {
        sessionStorage.removeItem("terron-open-host");
        window.setTimeout(() => {
          if (!this.validateUsername(true)) return;
          // skipShareCopy: без жеста пользователя авто-копирование ссылки триггерит
          // запрос доступа к буферу обмена — пропускаем его.
          (document.querySelector("host-lobby-modal") as HostLobbyModal)?.open({
            skipShareCopy: true,
          });
        }, 400);
      }
    } catch {
      // ignore
    }
    // Сетевой опрос лобби: в фоне молчит, при возврате во вкладку освежает
    // сразу — иначе игрок смотрел бы на протухшую витрину до следующего тика.
    this.stopUserLobbiesPoll = pollWhileVisible(
      () => void this.fetchUserLobbies(),
      4000,
    );
    // terron: сторож протухшей витрины (см. checkStaleLobbies) — раз в секунду.
    this.staleWatchTimer = window.setInterval(this.checkStaleLobbies, 1000);
    this.defaultLobbyTime = ClientEnv.gameCreationRate() / 1000;
    this.offline = isOffline();
    this.offlineUnsub = onOfflineChange((off) => {
      const wasOffline = this.offline;
      this.offline = off;
      if (wasOffline === off) return;
      // terron: смена связи → НЕ держим устаревший снапшот лобби (иначе «уже
      // стартовало»). Сбрасываем на спиннер; сокет (см. LobbySocket online-хук)
      // переподключится и пришлёт свежий full. Заодно обновляем юзер-лобби.
      this.lobbies = null;
      if (!off) {
        void this.fetchUserLobbies();
      } else {
        this.userLobbies = [];
      }
    });
    window.addEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    // terron: мгновенно обновить витрину, когда кто-то снял протухшее лобби
    // (см. Main.publicLobbyExists → DELETE). Иначе ждали бы до 4с следующего пула.
    document.addEventListener(
      "public-lobbies-refresh",
      this.handleLobbiesRefresh,
    );
    // Pick up the current value in case username-input validated before us.
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    if (usernameInput) {
      this.inputValid = usernameInput.canPlay();
    }
  }

  disconnectedCallback() {
    this.stop();
    this.offlineUnsub?.();
    this.offlineUnsub = null;
    window.removeEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    document.removeEventListener(
      "public-lobbies-refresh",
      this.handleLobbiesRefresh,
    );
    super.disconnectedCallback();
  }

  private handleValidityChange = (e: Event) => {
    this.inputValid = (e as CustomEvent).detail?.isValid ?? true;
  };

  private handleLobbiesRefresh = () => {
    void this.fetchUserLobbies();
  };

  public stop() {
    this.lobbySocket.stop();
    this.stopUserLobbiesPoll?.();
    this.stopUserLobbiesPoll = null;
    if (this.staleWatchTimer) {
      window.clearInterval(this.staleWatchTimer);
      this.staleWatchTimer = 0;
    }
  }

  private async fetchUserLobbies(): Promise<void> {
    try {
      const r = await fetch(getApiBase() + "/lobbies/public", {
        cache: "no-store",
      });
      if (!r.ok) return;
      const d = (await r.json()) as { lobbies?: UserLobby[] };
      this.userLobbies = d.lobbies ?? [];
    } catch {
      /* витрина не критична */
    }
  }

  private renderUserLobbyCard(l: UserLobby) {
    const mapType = l.map ? (l.map as GameMapType) : undefined;
    const mapImageSrc = mapType
      ? terrainMapFileLoader.getMapData(mapType).webpPath
      : "";
    const mapImageSmallSrc = mapType
      ? terrainMapFileLoader.getMapData(mapType).webpSmallPath
      : "";
    const mapName = mapType ? getMapName(mapType) : "";
    return html`
      <button
        @click=${() => this.joinUserLobby(l.gameID)}
        ?disabled=${!this.inputValid}
        class="lobby-card group block w-full h-32 text-left ${!this.inputValid
          ? "opacity-50 cursor-not-allowed pointer-events-none"
          : ""}"
      >
        <!-- iOS Safari: display:flex на <button> не работает → раскладка во внутреннем div. -->
        <div class="flex flex-col w-full h-full text-left">
          <div
            class="lobby-sheet-hdr flex items-stretch text-[11px] tracking-[0.18em] shrink-0"
          >
            <!-- terron: та же «закладка», что у большой карточки (общий стиль
               .lobby-tab), иначе после ухода паддинга в CSS текст лип к краю. -->
            <span class="lobby-tab is-active truncate min-w-0"
              >${uiIcon("world", 14)}
              ${l.name || translateText("lobby.public")}</span
            >
          </div>
          <div class="lobby-map flex-1 min-h-0 p-2">
            <div class="lobby-map-frame relative w-full h-full overflow-hidden">
              ${mapImageSrc
                ? html`<!-- terron: display:contents — иначе нулевой бокс <picture>
                     ломает позиционирование/видимость абсолютного <img>.
                     loading=eager: карточка лобби всегда в первом экране, а
                     lazy откладывал ПОДМЕНУ превью при ротации карты («картинка
                     догоняет смену»). -->
                    <picture class="contents">
                      <source
                        media="(max-width: 1024px)"
                        srcset="${mapImageSmallSrc}"
                      />
                      <img
                        src="${mapImageSrc}"
                        alt="${mapName}"
                        draggable="false"
                        loading="eager"
                        decoding="async"
                        class="absolute inset-0 w-full h-full object-cover object-center [image-rendering:auto]"
                      />
                    </picture>`
                : null}
            </div>
          </div>
          <div
            class="lobby-foot flex items-center justify-between gap-3 px-3 py-1.5 shrink-0"
          >
            <div class="lobby-name truncate">${mapName || "—"}</div>
            <span class="lobby-join arrow"
              >${translateText("lobby.enter")}</span
            >
          </div>
        </div>
      </button>
    `;
  }

  // Войти в пользовательское публичное лобби (cold-join по /game/<id>).
  private joinUserLobby(gameID: string) {
    if (!this.validateUsername()) return;
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: { gameID, source: "public" } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleLobbiesUpdate(lobbies: PublicGames) {
    const prevEvent = `${this.eventLobby("golden")?.gameID}:${
      this.eventLobby("diamond")?.gameID
    }`;
    this.lobbies = lobbies;
    this.serverTimeOffset = calculateServerTimeOffset(lobbies.serverTime);
    // terron: событийное лобби сменилось (прежнее ушло в матч) → забываем ручной
    // выбор вкладки: следующий цикл снова показывает обычный ффа по умолчанию.
    const nowEvent = `${this.eventLobby("golden")?.gameID}:${
      this.eventLobby("diamond")?.gameID
    }`;
    if (prevEvent !== nowEvent) {
      this.tabPick = null;
    }
    this.maybeJoinEventFromUrl();
    document.dispatchEvent(
      new CustomEvent("public-lobbies-update", {
        detail: { payload: lobbies },
      }),
    );
    this.requestUpdate();

    const allGames = Object.values(lobbies.games ?? {}).flat();
    for (const game of allGames) {
      const mapType = game.gameConfig?.gameMap as GameMapType;
      if (mapType && !this.mapAspectRatios.has(mapType)) {
        // New Map reference triggers Lit reactivity; placeholder ratio 1 lets
        // has() guard against duplicate in-flight fetches.
        this.mapAspectRatios = new Map(this.mapAspectRatios).set(mapType, 1);
        terrainMapFileLoader
          .getMapData(mapType)
          .manifest()
          .then((m: any) => {
            if (m?.map?.width && m?.map?.height) {
              this.mapAspectRatios = new Map(this.mapAspectRatios).set(
                mapType,
                m.map.width / m.map.height,
              );
            }
          })
          .catch((e) =>
            console.error(`Failed to load manifest for ${mapType}`, e),
          );
      }
    }
  }

  render() {
    // terron: офлайн → мультиплеер недоступен (лобби-сервер не отвечает, список
    // вечно крутил бы спиннер). Показываем чистый экран с одиночной игрой.
    if (this.offline) {
      return this.renderOffline();
    }

    // terron: только НЕ стартовавшее FFA (protухшее/уже начатое не рисуем — иначе
    // джойн в середину матча без спавна, см. isSpawnClosed).
    const ffa = this.joinableFfa();
    // terron: показываем только FFA (онлайна нет — нет смысла сплитить). Вернуть:
    // const teams = this.lobbies?.games?.["team"]?.[0];
    // const special = this.lobbies?.games?.["special"]?.[0];

    // terron: СОБЫТИЙНЫЕ МАТЧИ — соседние вкладки той же карточки. Живут
    // постоянно, стартуют по расписанию (золотой — раз в час, алмазный — раз в
    // сутки); за свой FEATURE_LEAD до старта вкладка встаёт первой и становится
    // активной (см. activeTab).
    const gold = this.eventLobby("golden");
    const diamond = this.eventLobby("diamond");
    const tab = this.activeTab(ffa, gold, diamond);
    const shown = tab === "ffa" ? ffa : tab === "golden" ? gold : diamond;

    return html`
      <div class="flex flex-col gap-4 w-full px-4 sm:px-0 mx-auto pb-4 sm:pb-0">
        <!-- Game cards grid -->
        ${this.lobbies === null
          ? html`<div
              class="flex items-center justify-center h-72 lg:h-[20rem]"
            >
              <span
                class="w-24 h-24 border-[6px] border-blue-500/30 border-t-blue-500 rounded-full animate-spin"
              ></span>
            </div>`
          : html`<div class="flex flex-col lg:flex-row gap-4">
              <!-- Системное FFA — крупная карточка слева/сверху -->
              <div class="flex-1 min-w-0">
                ${shown
                  ? this.renderLobbyCard(
                      shown,
                      this.renderLobbyTabs(ffa, gold, diamond, tab),
                      true,
                    )
                  : nothing}
              </div>
              <!-- terron: витрина ПУБЛИЧНЫХ юзер-лобби — мелкие карточки справа
                   (десктоп) / ниже (мобила). -->
              ${this.userLobbies.length > 0
                ? html`<div
                    class="flex flex-col gap-3 lg:w-72 lg:shrink-0 lg:h-[20rem] lg:overflow-y-auto custom-scrollbar"
                  >
                    ${this.userLobbies.map((l) => this.renderUserLobbyCard(l))}
                  </div>`
                : ""}
            </div>`}

        <!-- terron: действия (Создать/Войти) ПОД картами — на всех размерах -->
        <div class="block">${this.renderActions()}</div>
      </div>
    `;
  }

  // terron: экран без сети — только одиночная игра (мультиплеер требует сервер).
  private renderOffline() {
    return html`
      <div class="flex flex-col gap-4 w-full px-4 sm:px-0 mx-auto pb-4 sm:pb-0">
        <div
          class="flex flex-col items-center justify-center gap-3 h-72 lg:h-[20rem] rounded-lg bg-white/5 border border-white/10 text-center px-6"
        >
          <span class="inline-flex text-white/70"
            >${uiIcon("wifi-off", 40)}</span
          >
          <div class="text-white font-bold uppercase tracking-wider">
            ${L("Нет подключения к сети", "No network connection")}
          </div>
          <div class="text-white/60 text-sm max-w-sm">
            ${L(
              "Мультиплеер недоступен офлайн. Можно сыграть одиночную партию с ботами — награды не начисляются.",
              "Multiplayer is unavailable offline. You can play a singleplayer game vs bots — no rewards are granted.",
            )}
          </div>
        </div>
        <div class="block">
          <button
            @click=${this.openHostLobby}
            ?disabled=${!this.inputValid}
            class="flex items-center justify-center w-full h-14 rounded-lg bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 transition-all duration-200 text-sm lg:text-base font-medium text-white uppercase tracking-wider text-center ${!this
              .inputValid
              ? "opacity-50 cursor-not-allowed pointer-events-none"
              : ""}"
          >
            ${L("Играть офлайн", "Play offline")}
          </button>
        </div>
      </div>
    `;
  }

  // ── terron: СОБЫТИЙНЫЕ МАТЧИ на витрине ────────────────────────────────────
  // Золотой и алмазный живут постоянно — СОСЕДНИМИ ВКЛАДКАМИ той же карточки
  // (обычная ффа-карусель — первая). За свой FEATURE_LEAD до старта событийная
  // вкладка встаёт первой и становится активной. Обычной карусели это не
  // касается: сервер про вкладки не знает вообще (см. TerronTuning).

  /** Явно выбранная игроком вкладка (null = по расписанию). */
  @state() private tabPick: TabKind | null = null;

  // terron: /gold и /diamond — ПОСТОЯННЫЕ ссылки на событийные матчи (их и
  // шарит кнопка в лобби). Лобби живут всегда, поэтому ссылки не протухают: как
  // только фид принёс лобби — заходим в него. Ждём фид, а не дёргаем HTTP:
  // GameModeSelector и так на сокете витрины.
  private eventPending: EventTab | null = /^\/(?:w\d+\/)?gold\/?$/.test(
    window.location.pathname,
  )
    ? "golden"
    : /^\/(?:w\d+\/)?diamond\/?$/.test(window.location.pathname)
      ? "diamond"
      : null;

  private maybeJoinEventFromUrl() {
    if (this.eventPending === null) return;
    const lobby = this.eventLobby(this.eventPending);
    if (!lobby) return; // фид ещё без события — ждём следующего обновления
    this.tabPick = this.eventPending;
    this.eventPending = null;
    this.validateAndJoin(lobby);
  }

  private eventLobby(kind: EventTab): PublicGameInfo | undefined {
    if (kind === "golden" && !TERRON_GOLDEN_ENABLED) return undefined;
    if (kind === "diamond" && !TERRON_DIAMOND_ENABLED) return undefined;
    const l = this.lobbies?.games?.[kind]?.[0];
    return l && !this.isSpawnClosed(l) ? l : undefined;
  }

  /** Событийный матч вот-вот → он главный на витрине. */
  private eventIsFeatured(
    kind: EventTab,
    lobby: PublicGameInfo | undefined,
  ): boolean {
    if (lobby?.startsAt === undefined) return false;
    const left = lobby.startsAt - getServerNow(this.serverTimeOffset);
    return (
      left <=
      (kind === "diamond"
        ? TERRON_DIAMOND_FEATURE_LEAD_MS
        : TERRON_GOLDEN_FEATURE_LEAD_MS)
    );
  }

  private activeTab(
    ffa: PublicGameInfo | undefined,
    gold: PublicGameInfo | undefined,
    diamond: PublicGameInfo | undefined,
  ): TabKind {
    const available: TabKind[] = [];
    if (ffa) available.push("ffa");
    if (gold) available.push("golden");
    if (diamond) available.push("diamond");
    if (available.length === 0) return "ffa";
    if (this.tabPick !== null && available.includes(this.tabPick)) {
      return this.tabPick;
    }
    // Алмазный старше золотого: если оба на подходе, главный — алмазный.
    if (diamond && this.eventIsFeatured("diamond", diamond)) return "diamond";
    if (gold && this.eventIsFeatured("golden", gold)) return "golden";
    return available[0];
  }

  private lobbyTimeLabel(lobby: PublicGameInfo): string {
    const left =
      lobby.startsAt === undefined
        ? undefined
        : getSecondsUntilServerTimestamp(lobby.startsAt, this.serverTimeOffset);
    if (left === undefined) return renderDuration(this.defaultLobbyTime);
    if (left <= 0) return translateText("public_lobby.starting_game");
    const mm = String(Math.floor((left % 3600) / 60)).padStart(2, "0");
    const ss = String(left % 60).padStart(2, "0");
    // Часы — у алмазного лобби: оно висит весь день, «4:12:30».
    if (left >= 3600) return `${Math.floor(left / 3600)}:${mm}:${ss}`;
    // Минуты — у золотого лобби (обычная карусель = 10с): «7:43», а не «7min 43s».
    return left >= 60
      ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
      : renderDuration(left);
  }

  /** Название режима лобби для вкладки: FFA / Команды. */
  private modeLabel(lobby: PublicGameInfo): string {
    return lobby.gameConfig?.gameMode === GameMode.Team
      ? L("КОМАНДЫ", "TEAMS")
      : "FFA";
  }

  /** Подпись событийной вкладки. compact — когда вкладок три и место дорого. */
  private eventTabLabel(
    kind: EventTab,
    lobby: PublicGameInfo,
    compact: boolean,
  ) {
    // Цифру награды крутят на сервере (env), поэтому берём её из конфига лобби.
    const reward = eventRewardOf(lobby.gameConfig);
    const title =
      kind === "diamond"
        ? compact
          ? L("АЛМАЗНЫЙ", "DIAMOND")
          : L("АЛМАЗНЫЙ МАТЧ", "DIAMOND MATCH")
        : compact
          ? L("ЗОЛОТОЙ", "GOLD")
          : L("ЗОЛОТОЙ МАТЧ", "GOLDEN MATCH");
    // Без лишних пробелов: на телефоне вкладка обрезала таймер (репорт владельца
    // 29.07). Иконка алмаза + «+N» и так читаются как награда.
    // ⚠️ На узком экране вкладок ТРИ, и слово в каждую не влезает — там вместо
    // названия остаётся только значок события (.lobby-tab-short в теме), а
    // награда прячется совсем. Обе подписи рендерим всегда, выбирает CSS:
    // media-запрос переживает поворот экрана, а замер ширины в JS — нет.
    return html`<span class="lobby-tab-full">${title}</span>
      <span class="lobby-tab-short">${kind === "diamond" ? "💎" : "⭐"}</span>
      <span class="golden-note-reward"
        >+${reward}<img class="golden-gem" src=${bloodDiamondIcon} alt=""
      /></span>`;
  }

  private renderTab(
    kind: TabKind,
    lobby: PublicGameInfo,
    active: boolean,
    compact = false,
  ) {
    // Вкладка живёт ВНУТРИ <button> карточки — вложенных кнопок быть не должно,
    // поэтому span + stopPropagation (иначе переключение вкладки = вход в лобби).
    return html`<span
      class="lobby-tab ${active ? "is-active" : ""} ${kind === "golden"
        ? "gold"
        : kind === "diamond"
          ? "diamond"
          : ""}"
      role="tab"
      aria-selected=${active}
      @click=${(e: Event) => {
        if (active) return;
        e.stopPropagation();
        e.preventDefault();
        this.tabPick = kind;
      }}
      >${kind === "ffa"
        ? // обычная вкладка = НАЗВАНИЕ РЕЖИМА этого лобби (FFA / Команды)
          this.modeLabel(lobby)
        : this.eventTabLabel(kind, lobby, compact)}
      <b class="lobby-sheet-start">${this.lobbyTimeLabel(lobby)}</b></span
    >`;
  }

  private renderLobbyTabs(
    ffa: PublicGameInfo | undefined,
    gold: PublicGameInfo | undefined,
    diamond: PublicGameInfo | undefined,
    active: TabKind,
  ) {
    const present: [TabKind, PublicGameInfo][] = [];
    if (ffa) present.push(["ffa", ffa]);
    if (gold) present.push(["golden", gold]);
    if (diamond) present.push(["diamond", diamond]);
    // Три вкладки в одну строку влезают только с короткими подписями.
    const compact = present.length > 2;
    const tabs = present.map(([kind, lobby]) =>
      this.renderTab(kind, lobby, active === kind, compact),
    );
    // Перед стартом событийная вкладка встаёт ПЕРВОЙ. Алмазный старше золотого:
    // если на подходе оба, вперёд выходит он.
    const featuredKind: TabKind | null = this.eventIsFeatured(
      "diamond",
      diamond,
    )
      ? "diamond"
      : this.eventIsFeatured("golden", gold)
        ? "golden"
        : null;
    const featured = present.findIndex(([kind]) => kind === featuredKind);
    const order =
      featured > 0
        ? [tabs[featured], ...tabs.filter((_, i) => i !== featured)]
        : tabs;
    return html`${order}`;
  }

  // terron: карточка «спец»-лобби. Сейчас на витрине не показывается (см.
  // render), но метод оставлен рабочим — вернуть режим = один вызов.
  private renderSpecialLobbyCard(lobby: PublicGameInfo, featured = false) {
    return this.renderLobbyCard(
      lobby,
      html`<span class="lobby-tab is-active"
        >${L("СПЕЦ", "SPECIAL")}
        <b class="lobby-sheet-start">${this.lobbyTimeLabel(lobby)}</b></span
      >`,
      featured,
    );
  }

  private openRankedMenu = () => {
    if (!this.validateUsername()) return;
    window.showPage?.("page-ranked");
  };

  private openHostLobby = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("host-lobby-modal") as HostLobbyModal)?.open();
  };

  private openJoinLobby = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("join-lobby-modal") as JoinLobbyModal)?.open();
  };

  // terron: «Создать» — сразу создаём лобби. Нет сети → соло с ботами (оффлайн).
  // Публично/приватно НЕ спрашиваем здесь — переключается в настройках лобби на лету.
  private openCreate = () => {
    if (!this.validateUsername()) return;
    // terron: одно окно на онлайн и офлайн — HostLobbyModal сам определит офлайн
    // (форсит локальную игру, скрывает хостинг). SinglePlayerModal убран.
    this.openHostLobby();
  };

  // Ряд действий: 2 кнопки — Создать / Войти.
  private renderActions() {
    return html`<div class="grid grid-cols-2 gap-4 h-14">
      ${this.renderSmallActionCard(
        "+ " + translateText("main.create"),
        this.openCreate,
        "bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 hover:scale-y-105 hover:scale-x-[1.01]",
      )}
      ${this.renderSmallActionCard(
        "› " + translateText("main.join"),
        this.openJoinLobby,
      )}
    </div>`;
  }

  private renderSmallActionCard(
    title: string,
    onClick: () => void,
    bgClass: string = CARD_BG,
  ) {
    return html`
      <button
        @click=${onClick}
        ?disabled=${!this.inputValid}
        class="flex items-center justify-center w-full h-full rounded-lg ${bgClass} transition-all duration-200 text-sm lg:text-base font-medium text-white uppercase tracking-wider text-center ${!this
          .inputValid
          ? "opacity-50 cursor-not-allowed pointer-events-none"
          : ""}"
      >
        ${title}
      </button>
    `;
  }

  private renderLobbyCard(
    lobby: PublicGameInfo,
    // terron: шапка приходит СНАРУЖИ — там живут вкладки «обычный | золотой»
    // (см. renderLobbyTabs), а у мелких юзер-лобби своя однострочная закладка.
    header: TemplateResult,
    featured = false,
  ) {
    const mapType = lobby.gameConfig!.gameMap as GameMapType;
    const mapImageSrc = terrainMapFileLoader.getMapData(mapType).webpPath;
    const mapImageSmallSrc =
      terrainMapFileLoader.getMapData(mapType).webpSmallPath;
    const aspectRatio = this.mapAspectRatios.get(mapType);
    // Use object-contain for extreme aspect ratios (e.g. Amazon River ~20:1) so
    // the full map is visible instead of being cropped by object-cover.
    const useContain =
      aspectRatio !== undefined && (aspectRatio > 4 || aspectRatio < 0.25);

    const mapName = getMapName(lobby.gameConfig?.gameMap);

    const modifierLabels = getModifierLabels(
      lobby.gameConfig?.publicGameModifiers,
    );
    // Sort by length for visual consistency (shorter labels first)
    if (modifierLabels.length > 1) {
      modifierLabels.sort((a, b) => a.length - b.length);
    }

    // terron: событийный матч — карточка целиком в цвете события
    // (см. .lobby-card.golden / .lobby-card.diamond).
    const eventClass =
      lobby.gameConfig?.golden !== true
        ? ""
        : lobby.gameConfig?.eventTier === "diamond"
          ? "diamond"
          : "golden";
    return html`
      <button
        @click=${() => this.validateAndJoin(lobby)}
        ?disabled=${!this.inputValid}
        class="lobby-card group block w-full h-72 lg:h-[20rem] text-left ${eventClass} ${!this
          .inputValid
          ? "opacity-50 cursor-not-allowed pointer-events-none"
          : ""}"
      >
        <!-- iOS Safari игнорирует display:flex на <button> → колонка схлопывается
             (карта в тонкую полоску, картинка исчезает). Держим раскладку во
             внутреннем div. -->
        <div class="flex flex-col w-full h-full text-left">
          <!-- Header: ЗАКЛАДКИ «обычный | золотой» (как ярлычки в папке), приходят
             снаружи. Отдельной полосы-анонса над витриной нет — она съедала
             высоту экрана (карточка и так фиксированной высоты). -->
          <div
            class="lobby-sheet-hdr flex items-stretch text-[11px] tracking-[0.18em] shrink-0"
          >
            ${header}
          </div>
          <!-- Карта в рамке -->
          <div class="lobby-map flex-1 min-h-0 p-2">
            <div class="lobby-map-frame relative w-full h-full overflow-hidden">
              ${mapImageSrc
                ? html`<!-- terron: display:contents — иначе нулевой бокс <picture>
                     ломает позиционирование/видимость абсолютного <img>.
                     loading=eager: карточка лобби всегда в первом экране, а
                     lazy откладывал ПОДМЕНУ превью при ротации карты («картинка
                     догоняет смену»). -->
                    <picture class="contents">
                      <source
                        media="(max-width: 1024px)"
                        srcset="${mapImageSmallSrc}"
                      />
                      <img
                        src="${mapImageSrc}"
                        alt="${mapName ?? lobby.gameConfig?.gameMap ?? "map"}"
                        draggable="false"
                        loading="eager"
                        decoding="async"
                        class="absolute inset-0 w-full h-full ${useContain
                          ? "object-contain"
                          : "object-cover object-center"} [image-rendering:auto]"
                      />
                    </picture>`
                : null}
              ${modifierLabels.length > 0
                ? html`<div
                    class="absolute left-2 top-2 z-10 flex flex-col items-start gap-1"
                  >
                    ${modifierLabels.map(
                      (label) =>
                        html`<span
                          class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-malibu-blue text-white"
                          >${label}</span
                        >`,
                    )}
                  </div>`
                : nothing}
            </div>
          </div>
          <!-- Футер: название · игроков · ВОЙТИ -->
          <div
            class="lobby-foot flex items-center justify-between gap-3 px-3 py-2 shrink-0"
          >
            <div class="min-w-0">
              <div class="lobby-name">${mapName ?? "—"}</div>
              <div class="lobby-count">
                ${lobby.numClients}/${lobby.gameConfig?.maxPlayers}
                ${translateText("lobby.players")}
              </div>
            </div>
            <span class="lobby-join ${featured ? "" : "arrow"}"
              >${featured ? translateText("lobby.enter") : "→"}</span
            >
          </div>
        </div>
      </button>
    `;
  }

  // terron: закрыто ли уже окно спавна у публичного лобби. startsAt в прошлом
  // дольше, чем spawn-фаза (ПВП 25с) + грейс 5с → новый игрок УЖЕ не успеет выбрать
  // точку («точка спавна не выбрана»). В здоровом режиме сервер убирает
  // стартовавшую игру из витрины за ~1с, поэтому лобби так далеко за startsAt =
  // ПРОТУХШИЙ снапшот (мёртвый лобби-сокет заморозил список — «уже стартовало»).
  private isSpawnClosed(lobby: PublicGameInfo): boolean {
    if (lobby.startsAt === undefined) return false;
    const msSinceStart = getServerNow(this.serverTimeOffset) - lobby.startsAt;
    const spawnWindowMs =
      (TERRON_SPAWN_PHASE_PVP_SECONDS + TERRON_SPAWN_GRACE_SECONDS) * 1000;
    return msSinceStart > spawnWindowMs;
  }

  // terron: у РЕАЛЬНО стартующего лобби (внутри есть игроки и отсчёт дошёл)
  // карточку переключаем на СЛЕДУЮЩЕЕ — показывать «Запуск…» бессмысленно
  // (владелец 17.07: «за каким мне игра, которая уже запустилась»). ПУСТОЕ
  // лобби на нуле НЕ прячем: его ноль означает смену карты (мастер ротирует
  // через секунду) — прятание давало мигание карточки на второе лобби.
  private static readonly LAUNCH_HIDE_MS = 1000;

  // Публичное FFA-лобби НА ВИТРИНУ. Фолбэк — если стартующее лобби
  // единственное (щель в пару секунд до появления нового в фиде), показываем
  // его, пока открыто spawn-окно: не мигаем пустотой, джойн ещё валиден.
  private joinableFfa(): PublicGameInfo | undefined {
    const list = this.lobbies?.games?.["ffa"] ?? [];
    const now = getServerNow(this.serverTimeOffset);
    const fresh = list.find(
      (l) =>
        l.startsAt === undefined ||
        (l.numClients === 0 && !this.isSpawnClosed(l)) ||
        l.startsAt - now > GameModeSelector.LAUNCH_HIDE_MS,
    );
    if (fresh) return fresh;
    const fallback = list[0];
    return fallback && !this.isSpawnClosed(fallback) ? fallback : undefined;
  }

  // Быстрый вход (кнопка ИГРАТЬ): основное FFA-лобби.
  public joinFfa() {
    const ffa = this.joinableFfa();
    if (ffa) {
      this.validateAndJoin(ffa);
    } else {
      this.recoverStaleLobbies(true);
    }
  }

  // Протухшая витрина: гасим в спиннер и тянем свежий снапшот (сокет мог сдаться).
  // notify=true — сообщаем тостом (реакция на КЛИК игрока); watchdog чинит молча.
  private recoverStaleLobbies(notify: boolean) {
    this.lobbies = null;
    this.lobbySocket.refresh();
    document.dispatchEvent(new CustomEvent("public-lobbies-refresh"));
    if (notify) {
      showToast(
        L(
          "Игра уже началась — ищу новую",
          "Game already started — finding a new one",
        ),
        "red",
      );
    }
  }

  // Периодический сторож: стартовавшее FFA убираем с витрины (и чиним сокет),
  // чтобы карточка «уже стартовало» не висела кликабельной при мёртвом сокете.
  // ВАЖНО: НЕ работаем в матче (body.in-game) и в фоне — иначе замороженный
  // список лобби вечно «протух» → refresh() дёргал бы лобби-сокет КАЖДУЮ секунду
  // прямо во время игры (лишний WS-churn, дестабилизирует связь в iframe).
  private lastEventTickLabel = "";
  private checkStaleLobbies = () => {
    // terron: заодно — секундный тик отсчёта на событийных вкладках (золотая/
    // алмазная): их таймер идёт часами, а фид лобби перерисовать витрину не
    // обязан. Перерисовываем ТОЛЬКО если видимая подпись реально сменилась —
    // иначе вся витрина (карточки, превью) перерендеривалась каждую секунду
    // впустую, в т.ч. когда событийных лобби нет вовсе.
    if (!document.hidden && !document.body.classList.contains("in-game")) {
      const gold = this.eventLobby("golden");
      const diamond = this.eventLobby("diamond");
      const label = `${gold ? this.lobbyTimeLabel(gold) : ""}|${
        diamond ? this.lobbyTimeLabel(diamond) : ""
      }`;
      if (label !== this.lastEventTickLabel) {
        this.lastEventTickLabel = label;
        this.requestUpdate();
      }
    }
    if (this.lobbies === null) return;
    if (document.body.classList.contains("in-game")) return;
    if (document.hidden) return;
    // Не дёргаем сокет, пока игрок в модалке лобби (создал/зашёл и ждёт старт) —
    // витрину он не видит, а churn может дестабилизировать связь лобби в iframe.
    if (this.lobbyModalOpen()) return;
    const ffa = this.lobbies.games?.["ffa"]?.[0];
    if (ffa && this.isSpawnClosed(ffa)) {
      this.recoverStaleLobbies(false);
    }
  };

  private lobbyModalOpen(): boolean {
    const host = document.querySelector("host-lobby-modal") as
      | (HTMLElement & { isModalOpen?: boolean })
      | null;
    const join = document.querySelector("join-lobby-modal") as
      | (HTMLElement & { isModalOpen?: boolean })
      | null;
    return Boolean(host?.isModalOpen || join?.isModalOpen);
  }

  private validateAndJoin(lobby: PublicGameInfo) {
    if (!this.validateUsername()) return;

    // terron: не заходить в УЖЕ СТАРТОВАВШУЮ игру (джойн привёл бы в середину
    // матча без фазы спавна — «точка спавна не выбрана», см. isSpawnClosed).
    if (this.isSpawnClosed(lobby)) {
      this.recoverStaleLobbies(true);
      return;
    }

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobby.gameID,
          source: "public",
          publicLobbyInfo: lobby,
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private getLobbyTitle(lobby: PublicGameInfo): string {
    const config = lobby.gameConfig!;
    if (config.gameMode === GameMode.FFA) {
      return translateText("game_mode.ffa");
    }

    if (config?.gameMode === GameMode.Team) {
      const totalPlayers = config.maxPlayers ?? lobby.numClients ?? undefined;
      const formatTeamsOf = (
        teamCount: number | undefined,
        playersPerTeam: number | undefined,
        label?: string,
      ) => {
        if (!teamCount)
          return label ?? translateText("mode_selector.teams_title");
        const baseTitle = playersPerTeam
          ? translateText("mode_selector.teams_of", {
              teamCount: String(teamCount),
              playersPerTeam: String(playersPerTeam),
            })
          : translateText("mode_selector.teams_count", {
              teamCount: String(teamCount),
            });
        return `${baseTitle}${label ? ` (${label})` : ""}`;
      };

      switch (config.playerTeams) {
        case Duos: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 2)
            : undefined;
          return formatTeamsOf(teamCount, 2);
        }
        case Trios: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 3)
            : undefined;
          return formatTeamsOf(teamCount, 3);
        }
        case Quads: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 4)
            : undefined;
          return formatTeamsOf(teamCount, 4);
        }
        case HumansVsNations: {
          const humanSlots = config.maxPlayers ?? lobby.numClients;
          return humanSlots
            ? translateText("public_lobby.teams_hvn_detailed", {
                num: String(humanSlots),
              })
            : translateText("public_lobby.teams_hvn");
        }
        default:
          if (typeof config.playerTeams === "number") {
            const teamCount = config.playerTeams;
            const playersPerTeam =
              totalPlayers && teamCount > 0
                ? Math.floor(totalPlayers / teamCount)
                : undefined;
            return formatTeamsOf(teamCount, playersPerTeam);
          }
      }
    }

    return "";
  }
}

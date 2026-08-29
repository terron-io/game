import { TemplateResult, html, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import { L, getMapName, isInIframe, translateText } from "../client/Utils";
import { assetUrl } from "../core/AssetUrls";
import { EventBus } from "../core/EventBus";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
  isDifficulty,
} from "../core/game/Game";
import { listCachedMapNames } from "../core/game/MapCache";
import { UserSettings } from "../core/game/UserSettings";
import {
  ClientInfo,
  GameConfig,
  GameInfo,
  LobbyInfoEvent,
  TeamCountConfig,
  isValidGameID,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import { getApiBase } from "./Api";
import { getPlayToken, userAuth } from "./Auth";
import { prefetchLobbyMap } from "./ClientGameRunner";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import { CopyButton } from "./components/CopyButton";
import "./components/GameConfigSettings";
import "./components/LobbyPlayerView";
import "./components/ToggleInputCard";
import { modalHeader } from "./components/ui/ModalHeader";
import { getLocalStartCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { reportHealth } from "./Health";
import type { LobbyChatPanel } from "./LobbyChatPanel";
import {
  LocalGameBrief,
  listLocalGames,
  loadLocalGame,
} from "./LocalGameStore";
import { JoinLobbyEvent } from "./Main";
import {
  OFFLINE_CHANGE_EVENT,
  isBundledOfflineMap,
  isOffline,
} from "./Offline";
import { Platform } from "./Platform";
import { registerLobbyOwnership } from "./Referral";
import { LobbyMusic } from "./sound/LobbyMusic";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
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
import { isDevSite } from "./Utils";

@customElement("host-lobby-modal")
export class HostLobbyModal extends BaseModal {
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private selectedDifficulty: Difficulty = Difficulty.Easy;
  @state() private nations: number = 0;
  @state() private defaultNationCount: number = 0;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private teamCount: TeamCountConfig = 2;

  constructor() {
    super();
    this.id = "page-host-lobby";
  }
  @state() private bots: number = 400;
  @state() private spawnImmunity: boolean = false;
  @state() private spawnImmunityDurationMinutes: number | undefined = undefined;
  @state() private infiniteGold: boolean = false;
  @state() private donateGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private donateTroops: boolean = false;
  @state() private maxTimer: boolean = false;
  @state() private maxTimerValue: number | undefined = undefined;
  @state() private instantBuild: boolean = false;
  @state() private randomSpawn: boolean = false;
  @state() private compactMap: boolean = false;
  @state() private goldMultiplier: boolean = false;
  @state() private goldMultiplierValue: number | undefined = undefined;
  @state() private startingGold: boolean = false;
  @state() private startingGoldValue: number | undefined = undefined;
  @state() private disableAlliances: boolean = false;
  @state() private waterNukes: boolean = false;
  @state() private fogOfWar: boolean = false;
  // terron: ДЕВ-ПЕСОЧНИЦА ЗАМКОВ — только на dev. TZ-ult-unlocks.md
  @state() private devUnlockUlts: boolean = false;
  @state() private lobbyId = "";
  @state() private lobbyUrlSuffix = "";
  @state() private clients: ClientInfo[] = [];
  // terron: статус лобби. Страница/настройки ОДНИ И ТЕ ЖЕ — меняется только статус.
  // offline = локальная игра (без сети), private/public = серверное лобби.
  @state() private lobbyMode: "offline" | "private" | "public" = "private";
  // Публикация с отсрочкой: клик «Публично» запускает 5-сек отсчёт (можно отменить,
  // кликнув назад). По нулю — публикуется и БЛОКИРУЕТСЯ (назад уже нельзя).
  @state() private publishCountdown: number | null = null;
  @state() private publishLocked: boolean = false;
  private publishTimer = 0;
  // terron 20.07: незаконченные локальные (одиночные) матчи для «Продолжить» в
  // офлайн-режиме. Список + флаг раскрытия. Заполняется при открытии модалки.
  @state() private localGames: LocalGameBrief[] = [];
  @state() private showResumeList = false;
  @state() private useRandomMap: boolean = false;
  // terron спидран: лобби открыто из рейтинга — поля заблокированы (кроме
  // сложности), в адресе стоит ?speedrun. Снимается кнопкой в плашке.
  @state() private speedrunLocked: boolean = false;
  @state() private disabledUnits: UnitType[] = [];
  @state() private hostCheatsEnabled: boolean = false;
  @state() private hostCheatInfiniteGold: boolean = false;
  @state() private hostCheatInfiniteTroops: boolean = false;
  @state() private hostCheatGoldMultiplier: boolean = false;
  @state() private hostCheatGoldMultiplierValue: number | undefined = undefined;
  @state() private hostCheatStartingGold: boolean = false;
  @state() private hostCheatStartingGoldValue: number | undefined = undefined;
  @state() private lobbyCreatorClientID: string = "";

  @property({ attribute: false }) eventBus: EventBus | null = null;
  // Timers for debouncing slider changes
  private botsUpdateTimer: number | null = null;
  private nationsUpdateTimer: number | null = null;
  private mapLoader = terrainMapFileLoader;
  private userSettings = new UserSettings();

  // terron: музыка в лобби «Создать игру» + тумблер (иконка в шапке).
  private readonly lobbyMusic = new LobbyMusic(this.userSettings);
  @state() private musicOn = false; // ставится из LobbyMusic (см. syncMusicIcon)
  // подписка на смену состояния плеера (мут площадки и т.п.) — см. connectedCallback

  private leaveLobbyOnClose = true;

  // terron: лобби создаётся на сервере с ДЕФОЛТ-конфигом, а сохранённые
  // настройки хоста раньше доезжали только когда он что-то потрогал (первый
  // putGameConfig) — «настройки уехали» (грабля из CLAUDE.md). Теперь пушим
  // конфиг безусловно на ПЕРВОМ lobby_info своего лобби (ws уже соединён).
  private sentInitialConfig = false;

  private readonly handleLobbyInfo = (event: LobbyInfoEvent) => {
    const lobby = event.lobby;
    if (!this.lobbyId || lobby.gameID !== this.lobbyId) {
      return;
    }
    if (!this.sentInitialConfig) {
      this.sentInitialConfig = true;
      void this.putGameConfig();
    }
    this.lobbyCreatorClientID = lobby.lobbyCreatorClientID ?? "";
    // terron: свой clientID сервер сообщает КАЖДОМУ клиенту персонально
    // (event.myClientID) — это надёжный способ узнать «себя», в отличие от
    // lobbyCreatorClientID, который может не резолвиться при рассинхроне
    // persistentID. Нужно, чтобы не показывать себе крестик «кикнуть» и
    // подсвечивать свой ряд. (JoinLobbyModal делает так же.)
    if (event.myClientID) this.myClientID = event.myClientID;
    if (lobby.clients) {
      // terron: звук, когда в твоё лобби кто-то ВОШЁЛ (рост числа клиентов,
      // не считая первичной установки самого хоста).
      const n = lobby.clients.length;
      if (n > this.lastClientCount && this.lastClientCount >= 1) {
        this.playJoinSound();
      }
      this.lastClientCount = n;
      this.clients = lobby.clients;
    }
    // terron: отсчёт старта из lobby_info → обновляем кнопку-бар.
    this.startCountdownEndsAt =
      lobby.startCountdownEndsAt && lobby.startCountdownEndsAt > Date.now()
        ? lobby.startCountdownEndsAt
        : null;
    this.updateStartBar();
    // terron: кормим лобби-чат (id/ростер/хост/мой clientID).
    this.lobbyChat()?.sync(
      lobby.gameID,
      lobby.clients ?? [],
      this.lobbyCreatorClientID,
      this.myClientID || this.lobbyCreatorClientID,
    );
  };

  private lobbyChat(): LobbyChatPanel | null {
    return document.querySelector("lobby-chat-panel") as LobbyChatPanel | null;
  }

  private lastClientCount = 0;
  // terron: свой clientID (из event.myClientID) — для распознавания «себя».
  @state() private myClientID = "";
  // terron: отсчёт старта (endsAt из lobby_info). null = отсчёта нет.
  private startCountdownEndsAt: number | null = null;
  private playJoinSound(): void {
    try {
      const a = new Audio(assetUrl("sounds/effects/message.mp3"));
      a.volume = 0.6;
      void a.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  private getRandomString(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  }

  private async buildLobbyUrl(): Promise<string> {
    if (crazyGamesSDK.isOnCrazyGames()) {
      const link = crazyGamesSDK.createInviteLink(this.lobbyId);
      if (link !== null) {
        return link;
      }
    }
    // terron: чистый URL-бар хоста /game/ID (это history.replaceState — только
    // отображение; воркер для API резолвится отдельно). Раньше: /w0/...?lobby&s=random.
    return `${window.location.origin}/game/${this.lobbyId}`;
  }

  private async constructUrl(): Promise<string> {
    this.lobbyUrlSuffix = this.getRandomString();
    return await this.buildLobbyUrl();
  }

  private updateHistory(url: string): void {
    if (crazyGamesSDK.isOnCrazyGames()) {
      return;
    }
    history.replaceState(null, "", url);
  }

  private updateLobbyHistory(lobbyUrl: string): void {
    if (crazyGamesSDK.isOnCrazyGames()) {
      return;
    }
    const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
    const base = lobbyIdHidden ? "/streamer-mode" : lobbyUrl;
    // terron спидран: этот метод — ЕДИНСТВЕННЫЙ владелец адреса лобби, он
    // зовётся на каждом putGameConfig и затирал бы метку режима. Поэтому метку
    // дописываем здесь, а не отдельным replaceState (тот проигрывал гонку).
    history.replaceState(null, "", this.withSpeedrunMark(base));
  }

  // Дописать ?speedrun=<сложность> к адресу лобби, пока режим включён.
  private withSpeedrunMark(url: string): string {
    if (!this.speedrunLocked) return url;
    try {
      const u = new URL(url, window.location.origin);
      u.searchParams.set("speedrun", this.selectedDifficulty);
      return u.pathname + u.search;
    } catch {
      return url;
    }
  }

  private startLobbyUpdates() {
    this.stopLobbyUpdates();
    if (!this.eventBus) {
      console.warn(
        "HostLobbyModal: eventBus not set, cannot subscribe to lobby updates",
      );
      return;
    }
    this.eventBus.on(LobbyInfoEvent, this.handleLobbyInfo);
  }

  private stopLobbyUpdates() {
    this.eventBus?.off(LobbyInfoEvent, this.handleLobbyInfo);
  }

  // terron: тумблер музыки лобби (иконка в шапке).
  private toggleMusic = () => {
    this.lobbyMusic.toggle();
    this.syncMusicIcon();
  };

  // Иконка ♫ показывает ФАКТ (учитывая мут площадки), а не только галку юзера.
  private syncMusicIcon = () => {
    this.musicOn = this.lobbyMusic.effectivelyOn;
  };

  private renderMusicButton() {
    const label = this.musicOn
      ? translateText("lobby_music.mute")
      : translateText("lobby_music.unmute");
    return html`
      <button
        class="p-1.5 rounded-lg text-gray-600 hover:text-black hover:bg-black/5 transition"
        title=${label}
        aria-label=${label}
        @click=${this.toggleMusic}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
          <g style="opacity:${this.musicOn ? 1 : 0.4}">
            <path
              d="M9 5l12-2v3L9 8zM9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <rect x="8" y="4" width="1.6" height="14" rx="0.8" />
            <rect x="19.4" y="2" width="1.6" height="14" rx="0.8" />
          </g>
          ${this.musicOn
            ? ""
            : svg`<line x1="2.5" y1="2.5" x2="21.5" y2="21.5" stroke="#e25555" stroke-width="3" stroke-linecap="round" />`}
        </svg>
      </button>
    `;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("host_modal.title"),
      onBack: () => {
        // terron: открыта шторка чата на телефоне → «назад» закрывает ЧАТ и
        // возвращает в лобби, а не выходит из него (частая ошибка — рефлекс).
        if (this.lobbyChat()?.closeMobileIfOpen()) return;
        this.leaveLobbyOnClose = true;
        this.close();
      },
      ariaLabel: translateText("common.back"),
      rightContent: this.renderMusicButton(),
      // terron: код+копирование перенесены в строку настроек лобби (renderLobbyMode).
      // rightContent: html`
      //   <copy-button
      //     .lobbyId=${this.lobbyId}
      //     .lobbySuffix=${this.lobbyUrlSuffix}
      //     include-lobby-query
      //   ></copy-button>
      // `,
    });
  }

  // Смена статуса. Публикация — с 5-сек отсрочкой: пока идёт отсчёт, можно
  // вернуться назад; после публикации (lock) — назад уже нельзя.
  private setLobbyMode(m: "offline" | "private" | "public"): void {
    if (this.publishLocked) return; // опубликовано → менять нельзя
    // terron: без сети хостинг невозможен — режим залочен на offline.
    if (isOffline() && m !== "offline") return;
    // terron: открылись в форс-офлайне (navigator.onLine врал / сети не было),
    // сеть ожила и юзер уходит в онлайн-режим — лобби на сервере ещё НЕ создано
    // (onOpen ранний return). Досоздаём, иначе «Старт» уходил в пустой lobbyId.
    if (m !== "offline" && !this.lobbyId) {
      this.initOnlineLobby({ skipShareCopy: true });
    }
    // terron: адрес следует за РЕЖИМОМ, который выбрал игрок (не за статусом
    // сети). Офлайн — делиться нечем: убираем /game/<id> из строки, иначе она
    // указывает на лобби, в которое никто не попадёт. Вернулся в приват/паблик
    // — возвращаем прежнюю ссылку (lobbyId сохраняется, новый суффикс НЕ
    // генерим: buildLobbyUrl, а не constructUrl).
    this.syncModeUrl(m);
    if (m === "public") {
      if (this.lobbyMode === "public") return;
      this.lobbyMode = "public";
      this.startPublishCountdown();
      return;
    }
    // назад на offline/private — отменяем отсчёт публикации
    this.cancelPublishCountdown();
    this.lobbyMode = m;
    // terron: офлайн-старт качает карту только по «Начать игру» — греем её с
    // момента выбора офлайн-режима (симметрия с онлайн-лобби/одиночкой).
    if (m === "offline" && !isOffline()) prefetchLobbyMap(this.selectedMap);
  }

  // Синхронизация адреса с выбранным режимом лобби. Ошибки глушим: адресная
  // строка — косметика, ронять из-за неё выбор режима нельзя.
  private syncModeUrl(m: "offline" | "private" | "public"): void {
    try {
      if (m === "offline") {
        this.updateHistory("/");
        return;
      }
      if (!this.lobbyId) return; // лобби ещё создаётся — адрес поставит onOpen
      void this.buildLobbyUrl().then((url) => this.updateLobbyHistory(url));
    } catch {
      /* адрес не критичен */
    }
  }

  private startPublishCountdown(): void {
    this.cancelPublishCountdown();
    this.publishCountdown = 5;
    this.publishTimer = window.setInterval(() => {
      if (this.publishCountdown === null) return;
      this.publishCountdown -= 1;
      if (this.publishCountdown <= 0) {
        window.clearInterval(this.publishTimer);
        this.publishTimer = 0;
        this.publishCountdown = null;
        this.publishLocked = true;
        void this.registerPublicLobby(); // витрина на главной
        this.startPublishHeartbeat();
      }
    }, 1000);
  }

  // terron 20.07: БЭКСТОП-пульс витрины против «карточек-призраков». Основное
  // снятие — МГНОВЕННОЕ, на игровом сервере (WS-close хоста → removePublicLobby).
  // Этот пульс страхует случай, когда сокет НЕ закрылся начисто (сеть отвалилась,
  // half-open TCP — сервер close не видит): пока хост сидит в опубликованном
  // лобби, переregistrируем каждые 3с (POST идемпотентен, повторный POST метит
  // лобби pinged → API даёт короткий TTL ~8с). Пульс встал → карточка за ≤8с.
  private publishHeartbeat = 0;
  private startPublishHeartbeat(): void {
    this.stopPublishHeartbeat();
    this.publishHeartbeat = window.setInterval(() => {
      if (!this.publishLocked || !this.lobbyId) {
        this.stopPublishHeartbeat();
        return;
      }
      void this.registerPublicLobby();
    }, 3_000);
  }
  private stopPublishHeartbeat(): void {
    if (this.publishHeartbeat) {
      window.clearInterval(this.publishHeartbeat);
      this.publishHeartbeat = 0;
    }
  }
  private cancelPublishCountdown(): void {
    if (this.publishTimer) {
      window.clearInterval(this.publishTimer);
      this.publishTimer = 0;
    }
    this.publishCountdown = null;
  }

  // Регистрация лобби в публичной витрине главной (после публикации).
  private async registerPublicLobby(): Promise<void> {
    try {
      if (!this.lobbyId) return;
      const usernameInput = document.querySelector(
        "username-input",
      ) as UsernameInput | null;
      await fetch(getApiBase() + "/lobbies/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameID: this.lobbyId,
          name: usernameInput?.getUsername?.() ?? "",
          map: String(this.selectedMap),
          gameMode: this.gameMode,
        }),
      });
    } catch {
      /* витрина не критична */
    }
  }
  private unregisterPublicLobby(): void {
    this.stopPublishHeartbeat();
    if (!this.publishLocked || !this.lobbyId) return;
    try {
      void fetch(`${getApiBase()}/lobbies/public/${this.lobbyId}`, {
        method: "DELETE",
      });
    } catch {
      /* ignore */
    }
  }

  // terron: ЗАМЕТНАЯ секция статуса лобби — сверху карточки, над игровыми
  // настройками. Страница и настройки ОДНИ И ТЕ ЖЕ — меняется только статус;
  // решается на «Старт»: offline → локальная игра, private/public → хостинг.
  private renderLobbyMode() {
    // Назад на offline/private нельзя ТОЛЬКО после публикации (lock). Во время
    // отсчёта — можно (клик отменяет публикацию).
    const back = this.publishLocked;
    // terron: без сети хостинг недоступен — приват/паблик залочены, активен offline.
    const off = isOffline();
    const seg = (active: boolean) =>
      `flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold uppercase tracking-wider transition-all ${
        active
          ? "bg-malibu-blue text-white shadow-lg"
          : "text-white/55 hover:text-white/80"
      }`;
    const hint =
      this.publishCountdown !== null
        ? translateText("lobby.publishing_hint", {
            n: String(this.publishCountdown),
          })
        : this.publishLocked
          ? translateText("lobby.published_hint")
          : this.lobbyMode === "public"
            ? translateText("lobby.public_hint")
            : this.lobbyMode === "offline"
              ? translateText("lobby.offline_hint")
              : translateText("lobby.private_hint");
    return html`<div class="mb-8">
      <div class="text-xs uppercase tracking-[0.15em] text-white/45 mb-2">
        ${translateText("lobby.lobby_settings")}
      </div>
      <div
        class="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/30 border border-white/10"
      >
        <button
          class=${seg(this.lobbyMode === "offline")}
          ?disabled=${back}
          @click=${() => this.setLobbyMode("offline")}
        >
          📴 ${translateText("lobby.offline")}
        </button>
        <button
          class=${seg(this.lobbyMode === "private")}
          ?disabled=${back || off}
          @click=${() => this.setLobbyMode("private")}
        >
          🔒 ${translateText("lobby.private")}
        </button>
        <button
          class=${seg(this.lobbyMode === "public")}
          ?disabled=${this.publishLocked || off}
          @click=${() => this.setLobbyMode("public")}
        >
          🌐 ${translateText("lobby.public")}
        </button>
      </div>
      <div class="text-xs text-white/45 mt-2 leading-snug">${hint}</div>
      <!-- terron: код+копирование ссылки — здесь (для приват/публ), а не в шапке.
           В офлайне делиться нечем → на этом месте «Продолжить» незаконченный
           локальный матч (список из LocalGameStore). -->
      ${this.lobbyMode !== "offline"
        ? html`<div class="mt-3">
            <copy-button
              .lobbyId=${this.lobbyId}
              .lobbySuffix=${this.lobbyUrlSuffix}
              include-lobby-query
              full-width
            ></copy-button>
          </div>`
        : this.renderResumeOffline()}
    </div>`;
  }

  // terron 20.07: «Продолжить» — список незаконченных локальных матчей в офлайн-
  // режиме (там, где у онлайна код лобби). Пусто → секции нет.
  private renderResumeOffline() {
    if (this.localGames.length === 0) return "";
    // terron 21.07: светлая тема сайта. text-white тема флипает в тёмный ink
    // (см. terron-theme.css [class*="text-white"]), bg-black/N НЕ оверрайдится
    // → светлая подложка + тёмный текст. ⚠️ НЕ использовать классы с "blue"
    // (button[class*="bg-blue"] делает кнопку тёмной ink+белый текст = «белое на
    // белом» на светлой модалке) и arbitrary-значения bg-black/[0.03] (не
    // компилятся). Репорт владельца 21.07.
    return html`<div class="mt-3">
      <button
        class="w-full flex items-center justify-between py-3 px-4 rounded-lg
          bg-black/10 border border-black/20 text-white text-sm font-bold
          hover:bg-black/20 transition-all"
        @click=${() => (this.showResumeList = !this.showResumeList)}
      >
        <span
          >↻ ${L("Продолжить незаконченную", "Resume unfinished")}
          <span class="opacity-60 font-normal"
            >(${this.localGames.length})</span
          ></span
        >
        <span class="opacity-60">${this.showResumeList ? "▲" : "▼"}</span>
      </button>
      ${this.showResumeList
        ? html`<div class="mt-1 flex flex-col gap-1">
            ${this.localGames.map(
              (g) =>
                html`<button
                  class="flex items-center justify-between py-2.5 px-4 rounded-lg
                  bg-black/5 border border-black/20 text-white text-left
                  hover:bg-black/15 transition-all"
                  @click=${() => void this.resumeLocalGame(g.gameID)}
                >
                  <span class="text-sm font-semibold"
                    >${g.gameMap
                      ? getMapName(g.gameMap as GameMapType)
                      : L("Карта", "Map")}</span
                  >
                  <span class="opacity-60 text-xs font-medium"
                    >${g.turns} ${L("ходов", "turns")}</span
                  >
                </button>`,
            )}
          </div>`
        : ""}
    </div>`;
  }

  // Оффлайн-старт: локальная игра (GameType.Singleplayer) с ТЕМИ ЖЕ настройками
  // лобби. Лобби не хостим, сервер не нужен.
  // terron: гард от двойного старта (клик «Начать игру», пока первый ещё
  // собирается) — второй джойн убивал первую игру («двойной звук», баг 18.07).
  private offlineStarting = false;

  private async startOfflineGame(): Promise<void> {
    if (this.offlineStarting) return;
    this.offlineStarting = true;
    try {
      await this.startOfflineGameInner();
    } finally {
      this.offlineStarting = false;
    }
  }

  private async startOfflineGameInner(): Promise<void> {
    // terron: офлайн — играбельны ТОЛЬКО закешированные (MapCache) или вшитые в
    // нативный бандл карты. Иначе движок уйдёт fetch'ить map.bin и упадёт. Проверяем
    // ДО старта и тостим, если карта недоступна. (Порт из SinglePlayerModal.)
    if (isOffline()) {
      const cached = await listCachedMapNames();
      const folderOf = (m: GameMapType): string =>
        (
          Object.keys(GameMapType).find(
            (k) => GameMapType[k as keyof typeof GameMapType] === m,
          ) ?? ""
        ).toLowerCase();
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

    const finalMaxTimerValue =
      this.maxTimer && this.maxTimerValue ? this.maxTimerValue : undefined;
    const clientID = generateID();
    const gameID = generateID();
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    const spawnImmunityTicks = this.spawnImmunityDurationMinutes
      ? this.spawnImmunityDurationMinutes * 60 * 10
      : 0;
    this.leaveLobbyOnClose = false;
    // terron: офлайн-старт грузит карту синхронно (фриз 3-4с) → показываем оверлей
    // «Загрузка…» и даём 2 кадра на отрисовку ДО тяжёлой загрузки, иначе юзер видит
    // немое зависание. Снимается в Main.ts на join (#terron-loading).
    this.showLoadingOverlay();
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID,
          gameStartInfo: {
            gameID,
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
              donateGold: this.donateGold,
              donateTroops: this.donateTroops,
              infiniteTroops: this.infiniteTroops,
              instantBuild: this.instantBuild,
              randomSpawn: this.randomSpawn,
              spawnImmunityDuration: this.spawnImmunity
                ? spawnImmunityTicks
                : null,
              disabledUnits: this.disabledUnits,
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
            lobbyCreatedAt: Date.now(),
          },
          source: "singleplayer",
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }

  protected renderBody() {
    const inputCards = [
      html`<toggle-input-card
        .labelKey=${"host_modal.max_timer"}
        .checked=${this.maxTimer}
        .inputMin=${1}
        .inputMax=${120}
        .inputValue=${this.maxTimerValue}
        .inputAriaLabel=${translateText("host_modal.max_timer")}
        .inputPlaceholder=${translateText("host_modal.mins_placeholder")}
        .defaultInputValue=${30}
        .minValidOnEnable=${1}
        .onToggle=${this.handleMaxTimerToggle}
        .onInput=${this.handleMaxTimerValueChanges}
        .onKeyDown=${this.handleMaxTimerValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"host_modal.player_immunity_duration"}
        .checked=${this.spawnImmunity}
        .inputMin=${0}
        .inputMax=${120}
        .inputStep=${1}
        .inputValue=${this.spawnImmunityDurationMinutes}
        .inputAriaLabel=${translateText("host_modal.player_immunity_duration")}
        .inputPlaceholder=${translateText("host_modal.mins_placeholder")}
        .defaultInputValue=${5}
        .minValidOnEnable=${0}
        .onToggle=${this.handleSpawnImmunityToggle}
        .onInput=${this.handleSpawnImmunityDurationInput}
        .onKeyDown=${this.handleSpawnImmunityDurationKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"host_modal.gold_multiplier"}
        .checked=${this.goldMultiplier}
        .inputId=${"gold-multiplier-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.goldMultiplierValue}
        .inputAriaLabel=${translateText("host_modal.gold_multiplier")}
        .inputPlaceholder=${translateText(
          "host_modal.gold_multiplier_placeholder",
        )}
        .defaultInputValue=${2}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleGoldMultiplierToggle}
        .onChange=${this.handleGoldMultiplierValueChanges}
        .onKeyDown=${this.handleGoldMultiplierValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"host_modal.starting_gold"}
        .checked=${this.startingGold}
        .inputId=${"starting-gold-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.startingGoldValue}
        .inputAriaLabel=${translateText("host_modal.starting_gold")}
        .inputPlaceholder=${translateText(
          "host_modal.starting_gold_placeholder",
        )}
        .defaultInputValue=${5}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleStartingGoldToggle}
        .onChange=${this.handleStartingGoldValueChanges}
        .onKeyDown=${this.handleStartingGoldValueKeyDown}
      ></toggle-input-card>`,
    ];

    const hostCheatInputCards = [
      html`<toggle-input-card
        .labelKey=${"host_modal.gold_multiplier"}
        .checked=${this.hostCheatGoldMultiplier}
        .inputId=${"host-cheat-gold-multiplier-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.hostCheatGoldMultiplierValue}
        .inputAriaLabel=${translateText("host_modal.gold_multiplier")}
        .inputPlaceholder=${translateText(
          "host_modal.gold_multiplier_placeholder",
        )}
        .defaultInputValue=${2}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleHostCheatGoldMultiplierToggle}
        .onChange=${this.handleHostCheatGoldMultiplierValueChanges}
        .onKeyDown=${this.handleHostCheatGoldMultiplierValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"host_modal.starting_gold"}
        .checked=${this.hostCheatStartingGold}
        .inputId=${"host-cheat-starting-gold-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.hostCheatStartingGoldValue}
        .inputAriaLabel=${translateText("host_modal.starting_gold")}
        .inputPlaceholder=${translateText(
          "host_modal.starting_gold_placeholder",
        )}
        .defaultInputValue=${5}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleHostCheatStartingGoldToggle}
        .onChange=${this.handleHostCheatStartingGoldValueChanges}
        .onKeyDown=${this.handleHostCheatStartingGoldValueKeyDown}
      ></toggle-input-card>`,
    ];

    return html`
      <div class="p-6 pb-32 mx-auto w-full max-w-5xl">
        ${isOffline()
          ? html`<div
              class="mb-5 px-4 py-2.5 rounded-lg bg-malibu-blue/15 border border-malibu-blue/30 text-sm font-semibold text-center"
            >
              ${L(
                "Офлайн-режим — игра с ботами, без сети",
                "Offline mode — play vs bots, no network",
              )}
            </div>`
          : ""}
        ${this.renderLobbyMode()}
        ${this.publishLocked
          ? html`<div
              class="mb-6 px-4 py-3 rounded-lg bg-yellow-500/15 border border-yellow-500/30 text-sm font-medium"
            >
              🔒 ${translateText("lobby.locked_settings")}
            </div>`
          : ""}
        ${this.speedrunLocked ? this.renderSpeedrunBanner() : ""}
        <div
          class=${this.publishLocked
            ? "pointer-events-none opacity-60 select-none"
            : ""}
        >
          <game-config-settings
            class="block"
            .sectionGapClass=${"space-y-10"}
            .lockedExceptDifficulty=${this.speedrunLocked}
            .settings=${{
              map: {
                selected: this.selectedMap,
                useRandom: this.useRandomMap,
                randomMapDivider: true,
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
                titleKey: "host_modal.options_title",
                bots: {
                  value: this.bots,
                  labelKey: "host_modal.bots",
                  disabledKey: "host_modal.bots_disabled",
                },
                nations: {
                  value: this.nations,
                  defaultValue: this.defaultNationCount,
                  labelKey: "host_modal.nations",
                  disabledKey: "host_modal.nations_disabled",
                },
                toggles: [
                  {
                    labelKey: "host_modal.instant_build",
                    checked: this.instantBuild,
                  },
                  {
                    labelKey: "host_modal.random_spawn",
                    checked: this.randomSpawn,
                  },
                  {
                    labelKey: "host_modal.donate_gold",
                    checked: this.donateGold,
                  },
                  {
                    labelKey: "host_modal.donate_troops",
                    checked: this.donateTroops,
                  },
                  {
                    labelKey: "host_modal.infinite_gold",
                    checked: this.infiniteGold,
                  },
                  {
                    labelKey: "host_modal.infinite_troops",
                    checked: this.infiniteTroops,
                  },
                  {
                    labelKey: "host_modal.compact_map",
                    checked: this.compactMap,
                  },
                  {
                    labelKey: "host_modal.disable_alliances",
                    checked: this.disableAlliances,
                  },
                  {
                    labelKey: "host_modal.water_nukes",
                    checked: this.waterNukes,
                  },
                  {
                    labelKey: "host_modal.fog_of_war",
                    checked: this.fogOfWar,
                  },
                  // terron: галочка видна ТОЛЬКО на деве — на проде замки
                  // снимать нечем и незачем. TZ-ult-unlocks.md
                  ...(isDevSite()
                    ? [
                        {
                          labelKey: "host_modal.dev_unlock_ults",
                          checked: this.devUnlockUlts,
                        },
                      ]
                    : []),
                  {
                    labelKey: "host_modal.host_cheats",
                    checked: this.hostCheatsEnabled,
                  },
                ],
                inputCards,
              },
              hostCheats: {
                titleKey: "host_modal.host_cheats",
                visible: this.hostCheatsEnabled,
                toggles: [
                  {
                    labelKey: "host_modal.infinite_gold",
                    checked: this.hostCheatInfiniteGold,
                  },
                  {
                    labelKey: "host_modal.infinite_troops",
                    checked: this.hostCheatInfiniteTroops,
                  },
                ],
                inputCards: hostCheatInputCards,
              },
              unitTypes: {
                titleKey: "host_modal.enables_title",
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
            @host-cheat-toggle-changed=${this
              .handleConfigHostCheatToggleChanged}
            @unit-toggle-changed=${this.handleConfigUnitToggleChanged}
          ></game-config-settings>
        </div>

        <lobby-player-view
          class="mt-10"
          .gameMode=${this.gameMode}
          .clients=${this.clients}
          .lobbyCreatorClientID=${this.lobbyCreatorClientID}
          .currentClientID=${this.myClientID || this.lobbyCreatorClientID}
          .teamCount=${this.teamCount}
          .nationCount=${this.nations}
          .onKickPlayer=${(clientID: string) => this.kickPlayer(clientID)}
        ></lobby-player-view>
      </div>
    `;
    // terron: кнопка «Старт» вынесена ВООБЩЕ из модалки — фикс-бар в document.body
    // (showStartBar/onOpen). Внутри меню её нет: никакого sticky/скролла, всегда видна.
  }

  // terron: настройки лобби тянутся из localStorage при каждом создании.
  private static readonly SETTINGS_KEY = "terron_lobby_settings";
  private saveLobbySettings(): void {
    try {
      const s = {
        selectedMap: this.selectedMap,
        useRandomMap: this.useRandomMap,
        selectedDifficulty: this.selectedDifficulty,
        gameMode: this.gameMode,
        teamCount: this.teamCount,
        bots: this.bots,
        infiniteGold: this.infiniteGold,
        infiniteTroops: this.infiniteTroops,
        instantBuild: this.instantBuild,
        randomSpawn: this.randomSpawn,
        donateGold: this.donateGold,
        donateTroops: this.donateTroops,
        compactMap: this.compactMap,
        disableAlliances: this.disableAlliances,
        waterNukes: this.waterNukes,
        fogOfWar: this.fogOfWar,
        // terron: это ЗАПОМИНАНИЕ галочки в localStorage, НЕ отправка
        // конфига на сервер — та живёт в putGameConfig. TZ-ult-unlocks.md
        devUnlockUlts: this.devUnlockUlts,
        maxTimer: this.maxTimer,
        maxTimerValue: this.maxTimerValue,
        goldMultiplier: this.goldMultiplier,
        goldMultiplierValue: this.goldMultiplierValue,
        startingGold: this.startingGold,
        startingGoldValue: this.startingGoldValue,
        spawnImmunity: this.spawnImmunity,
        spawnImmunityDurationMinutes: this.spawnImmunityDurationMinutes,
        disabledUnits: this.disabledUnits,
      };
      localStorage.setItem(HostLobbyModal.SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }
  private loadLobbySettings(): void {
    try {
      const raw = localStorage.getItem(HostLobbyModal.SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<HostLobbyModal>;
      Object.assign(this, s);
    } catch {
      /* ignore */
    }
  }

  // terron спидран: ПОЛНЫЙ сброс к базовому конфигу — открытие из рейтинга
  // обязано дать лобби, которое ТОЧНО зачтётся. Раньше пресет трогал только 12
  // полей, а всё остальное приезжало из сохранённых настроек прошлого лобби:
  // игрок выигрывал и узнавал постфактум, что были включены донаты (репорт
  // 22.07). Поэтому сбрасываем ВСЁ, что проверяет серверный предикат
  // (platform-api speedrunConfigViolations) — держать списки синхронно.
  // Плашка «конфиг зафиксирован» + честная кнопка выхода из режима: игрок
  // вправе доиграть эту же партию как обычную, просто без зачёта.
  private renderSpeedrunBanner(): TemplateResult {
    return html`<div
      class="mb-6 px-4 py-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-sm font-medium flex items-center justify-between gap-3 flex-wrap"
    >
      <span>
        ⏱️
        ${L(
          "Режим спидрана: настройки зафиксированы, чтобы забег зачёлся. Менять можно только сложность.",
          "Speedrun mode: settings are locked so the run counts. Only difficulty can be changed.",
        )}
      </span>
      <button
        class="px-3 py-1.5 rounded-lg border border-white/25 hover:bg-white/10 whitespace-nowrap"
        @click=${this.unlockSpeedrun}
      >
        ${L("Разблокировать (без зачёта)", "Unlock (won't count)")}
      </button>
    </div>`;
  }

  // Метка режима в адресе: видно глазами и переживает перезагрузку.
  private markSpeedrunUrl(d: Difficulty): void {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get("speedrun") === d) return;
      u.searchParams.set("speedrun", d);
      window.history.replaceState({}, "", u.pathname + u.search);
    } catch {
      /* ignore */
    }
  }

  private unlockSpeedrun = () => {
    this.speedrunLocked = false;
    // Убираем метку из адреса — лобби перестало быть спидран-лобби.
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("speedrun")) {
        u.searchParams.delete("speedrun");
        window.history.replaceState({}, "", u.pathname + u.search);
      }
    } catch {
      /* ignore */
    }
  };

  private async applySpeedrunPreset(d: Difficulty): Promise<void> {
    this.speedrunLocked = true;
    this.useRandomMap = false;
    this.selectedMap = GameMapType.World;
    this.selectedDifficulty = d;
    this.gameMode = GameMode.FFA;
    this.compactMap = false;
    // соперники
    this.bots = 400;
    // читы/экономика
    this.infiniteGold = false;
    this.infiniteTroops = false;
    this.instantBuild = false;
    this.goldMultiplier = false;
    this.goldMultiplierValue = undefined;
    this.startingGold = false;
    this.startingGoldValue = undefined;
    // читы хоста — отдельный блок конфига (hostCheats), тоже валится предикатом
    this.hostCheatsEnabled = false;
    this.hostCheatInfiniteGold = false;
    this.hostCheatInfiniteTroops = false;
    this.hostCheatGoldMultiplier = false;
    this.hostCheatGoldMultiplierValue = undefined;
    this.hostCheatStartingGold = false;
    this.hostCheatStartingGoldValue = undefined;
    // правила матча
    this.donateGold = false;
    this.donateTroops = false;
    this.disabledUnits = [];
    this.spawnImmunity = false;
    this.spawnImmunityDurationMinutes = undefined;
    this.maxTimer = false;
    this.maxTimerValue = undefined;
    this.disableAlliances = false;
    this.waterNukes = false;
    this.fogOfWar = false;
    this.devUnlockUlts = false;
    this.randomSpawn = false;
    this.lobbyMode = "private";
    // Нации: конфиг шлёт "default" ТОЛЬКО если nations === defaultNationCount.
    // Оба числа знает манифест карты, и он грузится асинхронно — без этого
    // вызова при первом открытии nations=0 → "disabled", то есть матч без наций
    // и гарантированный отказ. Ставим ПОСЛЕ selectedMap/compactMap: внутри есть
    // гард «карта не сменилась», и параллельная загрузка другой карты нас не
    // перебьёт.
    await this.loadNationCount();
    // Манифест грузится асинхронно, а конфиг уезжает на сервер по первому
    // lobby_info — если лобби уже создано, оно могло получить старые значения.
    // Дописываем конфиг ПОСЛЕ того, как нации стали верными (последняя запись
    // побеждает). Если лобби ещё нет — его создадут позже и запушат уже это.
    if (this.lobbyId) void this.putGameConfig();
    // Метку в адрес ставим ЗДЕСЬ, а не в onOpen: BaseModal.open() уже после
    // onOpen зовёт modalRouter.syncOpened → pushPath(pathFor(...)), а тот
    // собирает путь без query и стёр бы метку. Мы за await'ом — значит после
    // всей синхронной цепочки открытия.
    this.markSpeedrunUrl(d);
  }

  protected onOpen(args?: Record<string, unknown>): void {
    this.showStartBar();
    this.loadLobbySettings();
    this.lobbyMusic.start(); // terron: музыка лобби с fade-in (если не заглушено)
    // terron спидран: открытие из рейтинга с пресетом — карта Мира + выбранная
    // сложность + стандартные настройки (без читов). Применяем ПОСЛЕ загрузки
    // сохранённых настроек, чтобы пресет победил.
    // Сложность берём из аргумента, а если его нет — из адреса (?speedrun=Easy):
    // тогда режим переживает F5 и ссылку можно скинуть словами.
    this.speedrunLocked = false; // обычное лобби не должно унаследовать лок
    let sd: unknown = args?.speedrunDifficulty;
    if (typeof sd !== "string") {
      try {
        sd = new URL(window.location.href).searchParams.get("speedrun");
      } catch {
        /* ignore */
      }
    }
    if (typeof sd === "string" && isDifficulty(sd)) {
      void this.applySpeedrunPreset(sd);
    }
    // terron: без сети хостинг невозможен — окно работает как локальная игра.
    // Форсим offline-режим и НЕ дёргаем сервер (createLobby/ownership/copy-url
    // упали бы и впустую палили в сеть). «Старт» → startOfflineGame().
    // Если сеть вернётся (или navigator.onLine врал и лобби-сокет докажет жизнь
    // — reportNetworkAlive), сегменты Приватно/Публично оживут, а лобби
    // досоздастся в setLobbyMode (initOnlineLobby).
    // terron: forceOffline — открытие по адресу /singleplayer (владелец 20.07:
    // «открывай лобби по этому адресу с текущими настройками, режим офлайн»).
    // Ведём себя как при отсутствии сети: локальная игра, лобби на сервере НЕ
    // создаём. Переключит на Приватно/Публично — лобби досоздастся в
    // setLobbyMode (initOnlineLobby), это уже работает.
    if (isOffline() || args?.forceOffline === true) {
      this.lobbyMode = "offline";
      if (this.modalEl) {
        this.modalEl.onClose = () => {
          this.close();
        };
      }
      this.loadNationCount();
      // Карту греем сразу — офлайн-старт качает её только по «Начать игру».
      if (!isOffline()) prefetchLobbyMap(this.selectedMap);
      return;
    }
    this.initOnlineLobby(args);
  }

  // terron: онлайн-часть открытия лобби (создание на сервере, ссылка, воронка).
  // Вынесена из onOpen: зовётся и при позднем выходе из форс-офлайна
  // (открылись «офлайн» из-за вранья navigator.onLine → сеть ожила →
  // переключение на Приватно/Публично БЕЗ созданного лобби раньше давало
  // «Старт» в никуда — lobbyId был пуст).
  private initOnlineLobby(args?: Record<string, unknown>): void {
    this.startLobbyUpdates();
    this.lobbyId = generateID();
    this.sentInitialConfig = false; // новое лобби → снова пушим конфиг на первом lobby_info
    // Note: clientID will be assigned by server when we join the lobby
    // lobbyCreatorClientID stays empty until then

    // Copy immediately so the host can share the link without waiting for the
    // server. If lobby creation fails, clear the clipboard to avoid a dead link.
    void this.constructUrl().then(async (url) => {
      this.updateLobbyHistory(url);
      await this.updateComplete;
      // terron: программное открытие (напр. из обучения «В живой матч») БЕЗ жеста
      // пользователя → авто-копирование ссылки триггерит запрос доступа к буферу.
      // Пропускаем копирование в этом случае. А в iframe стора (Яндекс/VK) буфер
      // обмена кросс-ориджин ЗАБЛОКИРОВАН → авто-копия падала тостом «Error copying
      // game id» (ссылка внутри стора всё равно бесполезна) — тоже пропускаем.
      if (args?.skipShareCopy || isInIframe()) return;
      void (this.querySelector("copy-button") as CopyButton)?.handleCopy();
    });

    // terron воронка: аноним/протухший JWT → create_game 401 в проде → лобби НЕ создаётся,
    // а раньше ошибка глоталась молча (дохлая ссылка). Фиксируем шаги, чтобы видеть разрыв.
    const beaconMeta = {
      gameId: this.lobbyId,
      mode: String(this.gameMode),
      map: String(this.selectedMap),
      isMobile: Platform.isMobileWidth,
    };
    void userAuth().then((a) =>
      beaconLobby("attempt", { ...beaconMeta, authed: a !== false }),
    );

    // Pass auth token for creator identification (server extracts persistentID from it)
    createLobby(this.lobbyId)
      .then(async (lobby) => {
        this.lobbyId = lobby.gameID;
        if (!isValidGameID(this.lobbyId)) {
          throw new Error(`Invalid lobby ID format: ${this.lobbyId}`);
        }
        beaconLobby("create_ok", { ...beaconMeta, gameId: this.lobbyId });
        crazyGamesSDK.showInviteButton(this.lobbyId);
        // terron реферал: создатель автоматически владелец ссылки лобби — кто зайдёт
        // по ней, привяжется к нему (только если залогинен, награды идут на аккаунт).
        void registerLobbyOwnership(this.lobbyId);
      })
      .then(() => {
        this.dispatchEvent(
          new CustomEvent("join-lobby", {
            detail: {
              gameID: this.lobbyId,
              source: "host",
            } as JoinLobbyEvent,
            bubbles: true,
            composed: true,
          }),
        );
      })
      .catch((err: unknown) => {
        // terron: не глотаем молча — фиксируем статус и говорим хосту, что лобби не создалось.
        const m = /status:\s*(\d+)/.exec(String(err));
        beaconLobby("create_fail", {
          ...beaconMeta,
          httpStatus: m ? Number(m[1]) : undefined,
        });
        void userAuth().then((a) => {
          if (a === false) {
            toast(
              L(
                "Не удалось создать лобби. Похоже, вы не вошли в аккаунт — войдите и попробуйте снова.",
                "Couldn't create the lobby. You may be signed out — sign in and try again.",
              ),
              "error",
            );
          } else {
            toast(
              L(
                "Не удалось создать лобби, попробуйте ещё раз.",
                "Couldn't create the lobby, please try again.",
              ),
              "error",
            );
          }
        });
        // Clear clipboard so the host doesn't accidentally share a dead link
        void navigator.clipboard.writeText("").catch(() => {});
      });
    if (this.modalEl) {
      this.modalEl.onClose = () => {
        this.close();
      };
    }
    this.loadNationCount();
  }

  private leaveLobby() {
    if (!this.lobbyId) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.lobbyId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  public confirmBeforeClose(): boolean {
    // terron: пустое лобби (только хост) — выходим сразу на главную, без диалога.
    // Подтверждаем только если кто-то реально присоединился.
    if (this.clients.length <= 1) return true;
    return confirm(translateText("host_modal.leave_confirmation"));
  }

  // terron: СИНК бара «СТАРТ» — инвариант «бар существует ⇔ страница лобби
  // ВИДНА». Бар живёт вне модалки (фикс-див на body), исторически показывался
  // в onOpen / снимался в onClose — и это хрупко: модалка INLINE (видимость =
  // класс hidden от showPage, НЕ isModalOpen), а close() зовут скрытые пути
  // (реконнект в iframe стора, «одна модалка за раз» в BaseModal.open чужой
  // модалки) — бар снимался, лобби оставалось видимым, «кнопки СТАРТ нет».
  // Обратная утечка тоже была возможна: Navigation прячет страницу классом БЕЗ
  // close() → бар оставался на чужой странице. Синк держит инвариант в обе
  // стороны. Зовётся из updated() (каждый Lit-рендер) И вотчдогом раз в 1с —
  // вотчдог обязателен: в ОФЛАЙН-режиме лобби нет поллинга → ре-рендеров нет,
  // одного updated() мало. offsetParent===null когда страница скрыта (класс
  // hidden) или мы в матче (body.in-game). showStartBar идемпотентна.
  private startBarWatchdog: number | null = null;
  private syncStartBar(): void {
    const pageVisible = this.offsetParent !== null;
    if (pageVisible) {
      // Телеметрия: открытое лобби видно, а бара нет — значит какой-то путь
      // его сорвал и вотчдог сейчас чинит. Само починится, но мы хотим ЗНАТЬ,
      // как часто игроки в это влетают (класс бага «нет кнопки старта» 16.07).
      const healed =
        this.isModalOpen && (!this.startBarEl || !this.startBarEl.isConnected);
      this.showStartBar(); // сам пересоздаст, если бар выкинут из DOM
      if (healed) reportHealth("startbar_healed", this.lobbyMode);
    } else if (this.startBarEl) {
      this.hideStartBar();
    }
  }
  protected updated(): void {
    this.syncStartBar();
  }
  // terron: смена онлайн/офлайн (включая «navigator.onLine врал, сокет доказал
  // жизнь» — reportNetworkAlive) → перерисовать сегменты Приватно/Публично,
  // они дизейблятся по isOffline() в рендере.
  private onOfflineFlip = () => this.requestUpdate();
  connectedCallback(): void {
    this.lobbyMusic.onStateChange = this.syncMusicIcon;
    window.addEventListener("platform-audio-changed", this.syncMusicIcon);
    super.connectedCallback();
    this.startBarWatchdog = window.setInterval(() => this.syncStartBar(), 1000);
    window.addEventListener(OFFLINE_CHANGE_EVENT, this.onOfflineFlip);
    void this.refreshLocalGames();
  }

  // terron 20.07: подтянуть незаконченные локальные матчи (для «Продолжить»).
  private async refreshLocalGames(): Promise<void> {
    try {
      this.localGames = await listLocalGames();
    } catch {
      this.localGames = [];
    }
  }

  // terron 20.07: продолжить локальный матч из списка — тянем ходы и запускаем
  // тем же путём, что F5-резюм (join-lobby с resumeTurns). Модалку закрываем.
  private async resumeLocalGame(gameID: string): Promise<void> {
    const snap = await loadLocalGame(gameID);
    if (!snap || snap.turns.length === 0) {
      toast(L("Запись матча не найдена", "Match record not found"), "error");
      void import("./Health").then(({ reportHealth }) =>
        reportHealth("local_resume_failed", "из списка: запись пуста/битая"),
      );
      void this.refreshLocalGames();
      return;
    }
    this.close();
    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: snap.gameID,
          gameStartInfo: snap.gameStartInfo,
          source: "singleplayer",
          resumeTurns: snap.turns,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
  disconnectedCallback(): void {
    window.removeEventListener("platform-audio-changed", this.syncMusicIcon);
    if (this.startBarWatchdog !== null) {
      window.clearInterval(this.startBarWatchdog);
      this.startBarWatchdog = null;
    }
    window.removeEventListener(OFFLINE_CHANGE_EVENT, this.onOfflineFlip);
    this.stopPublishHeartbeat();
    this.hideStartBar();
    super.disconnectedCallback();
  }

  protected onClose(): void {
    console.log("Closing host lobby modal");
    // Закрылись по-настоящему (вышли или начался матч) — плашку снимаем,
    // иначе она осталась бы висеть с мёртвыми данными.
    this.minimized = false;
    this.dispatchLobbyDock();
    this.hideStartBar();
    this.stopLobbyUpdates();
    this.lobbyChat()?.close(); // terron: свернуть лобби-чат
    this.startCountdownEndsAt = null;
    this.lobbyMusic.stop(); // terron: закрыли лобби / старт → глушим музыку
    if (this.leaveLobbyOnClose) {
      this.leaveLobby();
      this.updateHistory("/"); // Reset URL to base
    }
    crazyGamesSDK.hideInviteButton();

    // Clean up timers and resources
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
      this.botsUpdateTimer = null;
    }
    if (this.nationsUpdateTimer !== null) {
      clearTimeout(this.nationsUpdateTimer);
      this.nationsUpdateTimer = null;
    }

    // Reset all transient form state to ensure clean slate
    this.selectedMap = GameMapType.World;
    this.selectedDifficulty = Difficulty.Easy;
    this.nations = 0;
    this.defaultNationCount = 0;
    this.gameMode = GameMode.FFA;
    this.teamCount = 2;
    this.bots = 400;
    this.spawnImmunity = false;
    this.spawnImmunityDurationMinutes = undefined;
    this.infiniteGold = false;
    this.donateGold = false;
    this.infiniteTroops = false;
    this.donateTroops = false;
    this.maxTimer = false;
    this.maxTimerValue = undefined;
    this.instantBuild = false;
    this.randomSpawn = false;
    this.compactMap = false;
    this.useRandomMap = false;
    this.disabledUnits = [];
    // terron: снять с витрины ДО обнуления lobbyId — у unregisterPublicLobby
    // гард `if (!this.lobbyId) return`, поэтому DELETE не уходил вовсе (баг:
    // публичное лобби висело на главной до 8-мин TTL). Сначала DELETE, потом сброс.
    this.unregisterPublicLobby(); // ушёл из лобби → снять с витрины
    this.lobbyId = ""; // не показывать старый код при следующем открытии (stale-копи)
    this.clients = [];
    this.lastClientCount = 0;
    this.lobbyMode = "private";
    this.cancelPublishCountdown();
    this.publishLocked = false;
    this.lobbyCreatorClientID = "";
    this.goldMultiplier = false;
    this.goldMultiplierValue = undefined;
    this.startingGold = false;
    this.startingGoldValue = undefined;
    this.disableAlliances = false;
    this.waterNukes = false;
    this.fogOfWar = false;
    this.devUnlockUlts = false;
    this.hostCheatsEnabled = false;
    this.hostCheatInfiniteGold = false;
    this.hostCheatInfiniteTroops = false;
    this.hostCheatGoldMultiplier = false;
    this.hostCheatGoldMultiplierValue = undefined;
    this.hostCheatStartingGold = false;
    this.hostCheatStartingGoldValue = undefined;

    this.leaveLobbyOnClose = true;
  }

  private async handleSelectRandomMap() {
    this.useRandomMap = true;
    this.selectedMap = getRandomMapType();
    if (this.lobbyMode === "offline" && !isOffline()) {
      prefetchLobbyMap(this.selectedMap);
    }
    await this.loadNationCount();
    this.putGameConfig();
  }

  private handleConfigRandomMapSelected = () => {
    void this.handleSelectRandomMap();
  };

  private async handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
    if (this.lobbyMode === "offline" && !isOffline()) {
      prefetchLobbyMap(value); // офлайн-режим: онлайн-прогрева lobby_info нет
    }
    await this.loadNationCount();
    this.putGameConfig();
  }

  private handleConfigMapSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ map: GameMapType }>;
    void this.handleMapSelection(customEvent.detail.map);
  };

  private async handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
    this.putGameConfig();
  }

  private handleConfigDifficultySelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ difficulty: Difficulty }>;
    void this.handleDifficultySelection(customEvent.detail.difficulty);
  };

  private handleConfigGameModeSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ mode: GameMode }>;
    void this.handleGameModeSelection(customEvent.detail.mode);
  };

  private handleConfigTeamCountSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ count: TeamCountConfig }>;
    void this.handleTeamCountSelection(customEvent.detail.count);
  };

  private handleConfigOptionToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{
      labelKey: string;
      checked: boolean;
    }>;
    const { labelKey, checked } = customEvent.detail;

    switch (labelKey) {
      case "host_modal.instant_build":
        this.handleInstantBuildChange(checked);
        break;
      case "host_modal.random_spawn":
        this.handleRandomSpawnChange(checked);
        break;
      case "host_modal.donate_gold":
        this.handleDonateGoldChange(checked);
        break;
      case "host_modal.donate_troops":
        this.handleDonateTroopsChange(checked);
        break;
      case "host_modal.infinite_gold":
        this.handleInfiniteGoldChange(checked);
        break;
      case "host_modal.infinite_troops":
        this.handleInfiniteTroopsChange(checked);
        break;
      case "host_modal.compact_map":
        this.handleCompactMapChange(checked);
        break;
      case "host_modal.disable_alliances":
        this.disableAlliances = checked;
        this.putGameConfig();
        break;
      case "host_modal.water_nukes":
        this.waterNukes = checked;
        this.putGameConfig();
        break;
      case "host_modal.fog_of_war":
        this.fogOfWar = checked;
        this.putGameConfig();
        break;
      case "host_modal.dev_unlock_ults":
        this.devUnlockUlts = checked;
        this.putGameConfig();
        break;
      case "host_modal.host_cheats":
        this.hostCheatsEnabled = checked;
        this.putGameConfig();
        break;
      default:
        break;
    }
  };

  private handleConfigHostCheatToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{
      labelKey: string;
      checked: boolean;
    }>;
    const { labelKey, checked } = customEvent.detail;

    switch (labelKey) {
      case "host_modal.infinite_gold":
        this.hostCheatInfiniteGold = checked;
        this.putGameConfig();
        break;
      case "host_modal.infinite_troops":
        this.hostCheatInfiniteTroops = checked;
        this.putGameConfig();
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
    this.putGameConfig();
  };

  // Modified to include debouncing
  private handleBotsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }

    // Update the display value immediately
    this.bots = value;

    // Clear any existing timer
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
    }

    // Set a new timer to call putGameConfig after 300ms of inactivity
    this.botsUpdateTimer = window.setTimeout(() => {
      this.putGameConfig();
      this.botsUpdateTimer = null;
    }, 300);
  };

  private handleInstantBuildChange = (val: boolean) => {
    this.instantBuild = val;
    this.putGameConfig();
  };

  private handleMaxTimerToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.maxTimer = checked;
    this.maxTimerValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleSpawnImmunityToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.spawnImmunity = checked;
    this.spawnImmunityDurationMinutes = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleGoldMultiplierToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.goldMultiplier = checked;
    this.goldMultiplierValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleStartingGoldToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.startingGold = checked;
    this.startingGoldValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleSpawnImmunityDurationKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleSpawnImmunityDurationInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, { min: 0, max: 120 });
    if (value === undefined) {
      return;
    }
    this.spawnImmunityDurationMinutes = value;
    this.putGameConfig();
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
    this.putGameConfig();
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
    this.putGameConfig();
  };

  private handleHostCheatGoldMultiplierToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.hostCheatGoldMultiplier = checked;
    this.hostCheatGoldMultiplierValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleHostCheatGoldMultiplierValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["+", "-", "e", "E"]);
  };

  private handleHostCheatGoldMultiplierValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, { min: 0.1, max: 1000 });

    if (value === undefined) {
      this.hostCheatGoldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.hostCheatGoldMultiplierValue = value;
    }
    this.putGameConfig();
  };

  private handleHostCheatStartingGoldToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.hostCheatStartingGold = checked;
    this.hostCheatStartingGoldValue = toOptionalNumber(value);
    this.putGameConfig();
  };

  private handleHostCheatStartingGoldValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleHostCheatStartingGoldValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, {
      min: 0.1,
      max: 1000,
    });

    if (value === undefined) {
      this.hostCheatStartingGoldValue = undefined;
      input.value = "";
    } else {
      this.hostCheatStartingGoldValue = value;
    }
    this.putGameConfig();
  };

  private handleRandomSpawnChange = (val: boolean) => {
    this.randomSpawn = val;
    this.putGameConfig();
  };

  private handleInfiniteGoldChange = (val: boolean) => {
    this.infiniteGold = val;
    this.putGameConfig();
  };

  private handleDonateGoldChange = (val: boolean) => {
    this.donateGold = val;
    this.putGameConfig();
  };

  private handleInfiniteTroopsChange = (val: boolean) => {
    this.infiniteTroops = val;
    this.putGameConfig();
  };

  private handleCompactMapChange = (val: boolean) => {
    this.compactMap = val;
    this.bots = getBotsForCompactMap(this.bots, val);
    this.nations = getNationsForCompactMap(
      this.nations,
      this.defaultNationCount,
      val,
    );
    this.putGameConfig();
  };

  private handleDonateTroopsChange = (val: boolean) => {
    this.donateTroops = val;
    this.putGameConfig();
  };

  private handleMaxTimerValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private handleMaxTimerValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 1,
      max: 120,
      stripPattern: /[e+-]/gi,
    });

    if (value === undefined) {
      return;
    }
    this.maxTimerValue = value;
    this.putGameConfig();
  };

  private handleNationsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.nations = value;

    if (this.nationsUpdateTimer !== null) {
      clearTimeout(this.nationsUpdateTimer);
    }
    this.nationsUpdateTimer = window.setTimeout(() => {
      this.putGameConfig();
      this.nationsUpdateTimer = null;
    }, 300);
  };

  private async handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
    if (this.gameMode === GameMode.Team) {
      this.donateGold = true;
      this.donateTroops = true;
    } else {
      this.donateGold = false;
      this.donateTroops = false;
    }
    this.putGameConfig();
  }

  private async handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
    this.putGameConfig();
  }

  private async putGameConfig() {
    this.saveLobbySettings(); // настройки тянутся в следующее создание лобби
    const spawnImmunityTicks = this.spawnImmunityDurationMinutes
      ? this.spawnImmunityDurationMinutes * 60 * 10
      : 0;
    const url = await this.constructUrl();
    this.updateLobbyHistory(url);
    this.dispatchEvent(
      new CustomEvent("update-game-config", {
        detail: {
          config: {
            gameMap: this.selectedMap,
            gameMapSize: this.compactMap
              ? GameMapSize.Compact
              : GameMapSize.Normal,
            difficulty: this.selectedDifficulty,
            bots: this.bots,
            infiniteGold: this.infiniteGold,
            donateGold: this.donateGold,
            infiniteTroops: this.infiniteTroops,
            donateTroops: this.donateTroops,
            instantBuild: this.instantBuild,
            randomSpawn: this.randomSpawn,
            gameMode: this.gameMode,
            disabledUnits: this.disabledUnits,
            spawnImmunityDuration: this.spawnImmunity
              ? spawnImmunityTicks
              : null,
            playerTeams: this.teamCount,
            nations: sliderToNationsConfig(
              this.nations,
              this.defaultNationCount,
            ),
            maxTimerValue: this.maxTimer === true ? this.maxTimerValue : null,
            goldMultiplier:
              this.goldMultiplier === true ? this.goldMultiplierValue : null,
            startingGold:
              this.startingGold === true && this.startingGoldValue !== undefined
                ? Math.round(this.startingGoldValue * 1_000_000)
                : null,
            disableAlliances: this.disableAlliances || null,
            waterNukes: this.waterNukes ? true : null,
            // fogOfWar в схеме .optional() (не nullable) — null не слать;
            // false шлём ЯВНО, иначе выключение тогла не доедет до сервера
            // (updateGameConfig копирует только !== undefined).
            fogOfWar: this.fogOfWar,
            // terron: ДЕВ-ПЕСОЧНИЦА ЗАМКОВ — по той же причине шлём ЯВНО
            // (false тоже), иначе снятая галочка не доедет. TZ-ult-unlocks.md
            devUnlockUlts: this.devUnlockUlts,
            hostCheats: this.hostCheatsEnabled
              ? {
                  infiniteGold: this.hostCheatInfiniteGold || undefined,
                  infiniteTroops: this.hostCheatInfiniteTroops || undefined,
                  goldMultiplier:
                    this.hostCheatGoldMultiplier === true
                      ? this.hostCheatGoldMultiplierValue
                      : null,
                  startingGold:
                    this.hostCheatStartingGold === true &&
                    this.hostCheatStartingGoldValue !== undefined
                      ? Math.round(this.hostCheatStartingGoldValue * 1_000_000)
                      : null,
                }
              : undefined,
          } satisfies Partial<GameConfig>,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // terron: «Старт» вынесен ИЗ модалки — фикс-бар в document.body (вне scroll/transform,
  // всегда виден внизу экрана пока открыто лобби). showStartBar в onOpen, hide в onClose.
  private startBarEl: HTMLDivElement | null = null;
  private startBarBtn: HTMLButtonElement | null = null;
  // terron: полоса-заливка (осталось) + текст — отдельными слоями, чтобы ширину
  // заливки можно было ПЛАВНО интерполировать через CSS transition (не дёргалось).
  private startBarFill: HTMLDivElement | null = null;
  private startBarText: HTMLSpanElement | null = null;
  private startBarTicker: number | null = null;
  // terron: макс. длительность текущего отсчёта (ms) — для полосы-лоадера в баре.
  private startBarMaxMs = 0;
  private showStartBar(): void {
    // terron: если бар помечен живым, но был ВЫКИНУТ из DOM (реконнект/пересборка
    // лобби в iframe стора мог оставить флаг без элемента) — чистим и пересоздаём,
    // иначе «кнопка СТАРТ пропала и лобби не стартануть».
    if (this.startBarEl && !this.startBarEl.isConnected) {
      this.hideStartBar();
    }
    if (this.startBarEl) return;
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:100000;" +
      "padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));" +
      "background:rgba(17,24,39,.97);border-top:1px solid rgba(255,255,255,.12);" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);" +
      "display:flex;justify-content:center";
    const btn = document.createElement("button");
    btn.style.cssText =
      "position:relative;overflow:hidden;" +
      "width:100%;max-width:64rem;padding:15px;border:0;border-radius:10px;" +
      "color:#fff;cursor:pointer;" +
      "font:700 16px/1.2 'Golos Text',system-ui,sans-serif;" +
      "text-transform:uppercase;letter-spacing:.04em";
    // terron: заливка «осталось» — плавно интерполируется по ширине (transition).
    const fill = document.createElement("div");
    fill.style.cssText =
      "position:absolute;left:0;top:0;bottom:0;width:100%;background:#ef4444;" +
      "transition:width 0.12s linear;z-index:0;pointer-events:none";
    const text = document.createElement("span");
    text.style.cssText = "position:relative;z-index:1";
    btn.appendChild(fill);
    btn.appendChild(text);
    this.startBarFill = fill;
    this.startBarText = text;
    // terron: старт/отмена решаются по состоянию отсчёта в момент клика.
    btn.addEventListener("click", () => {
      if (this.startCountdownEndsAt !== null) {
        this.dispatchEvent(
          new CustomEvent("cancel-start", { bubbles: true, composed: true }),
        );
      } else {
        void this.requestStart();
      }
    });
    bar.appendChild(btn);
    document.body.appendChild(bar);
    this.startBarEl = bar;
    this.startBarBtn = btn;
    this.updateStartBar();
    // Тикер 100мс — плавная полоса-лоадер + «старт через Ns», пока идёт отсчёт.
    this.startBarTicker = window.setInterval(() => {
      if (this.startCountdownEndsAt !== null) this.updateStartBar();
    }, 100);
  }
  // terron: единый рендер кнопки-бара под текущий отсчёт (Старт / Отмена · Ns).
  private updateStartBar(): void {
    const btn = this.startBarBtn;
    const fill = this.startBarFill;
    const text = this.startBarText;
    if (!btn || !fill || !text) return;
    if (this.startCountdownEndsAt !== null) {
      const remMs = Math.max(0, this.startCountdownEndsAt - Date.now());
      const secs = Math.ceil(remMs / 1000);
      text.textContent = L(
        `Отмена · старт через ${secs} с`,
        `Cancel · start in ${secs}s`,
      );
      // terron: тёмная база (прошло) + светлая заливка (осталось) убывает ВЛЕВО.
      // Ширину заливки меняем шагами по 100мс, но CSS transition их
      // ИНТЕРПОЛИРУЕТ → плавно, без дёрганья. Максимум фиксирует первый тик.
      if (remMs > this.startBarMaxMs) this.startBarMaxMs = remMs;
      const frac =
        this.startBarMaxMs > 0
          ? Math.max(0, Math.min(1, remMs / this.startBarMaxMs))
          : 1;
      btn.style.background = "#7f1d1d"; // red-900 (прошло)
      fill.style.display = "block";
      fill.style.background = "#ef4444"; // red-500 (осталось)
      fill.style.width = `${(frac * 100).toFixed(2)}%`;
    } else {
      text.textContent = translateText("host_modal.start");
      btn.style.background = "#16a34a"; // green-600
      fill.style.display = "none";
      this.startBarMaxMs = 0;
    }
  }
  private hideStartBar(): void {
    if (this.startBarTicker !== null) {
      clearInterval(this.startBarTicker);
      this.startBarTicker = null;
    }
    this.startBarEl?.remove();
    this.startBarEl = null;
    this.startBarBtn = null;
    this.startBarFill = null;
    this.startBarText = null;
  }

  // terron: оверлей «Загрузка…» на время синхронной загрузки карты в офлайне
  // (иначе немой фриз 3-4с). Снимается в Main.ts когда игра реально загрузилась.
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
    txt.textContent = L("Загрузка карты", "Loading map");
    o.appendChild(spin);
    o.appendChild(txt);
    // terron: показываем КАКУЮ карту грузим (название снизу, как в меню паузы).
    const name = getMapName(this.selectedMap);
    if (name) {
      const mapEl = document.createElement("div");
      mapEl.textContent = name;
      mapEl.style.cssText =
        "font:800 22px/1.1 'Golos Text',system-ui,sans-serif;" +
        "text-transform:uppercase;letter-spacing:.05em;color:#fbbf24";
      o.appendChild(mapEl);
    }
    document.body.appendChild(o);
  }

  // terron: клик по «Старт». Оффлайн → сразу локальная игра (без отсчёта).
  // Приват/публ → запускаем СЕРВЕРНЫЙ отсчёт (хост = 10с). По нулю сервер сам
  // стартует матч; кнопка на время отсчёта превращается в «Отмена» (см.
  // updateStartBar). Отмену/дожатие обрабатывает сервер — здесь только интент.
  private async requestStart() {
    // Телеметрия «старт в никуда»: если через 20с после нажатия мы ВСЁ ЕЩЁ
    // сидим в видимом лобби и не в матче — старт молча провалился (пустой
    // lobbyId, краш конфига, оборванный сокет…). Игрок такое не репортит —
    // он просто уходит. Штатные пути не срабатывают: prestart закрывает
    // модалку (offsetParent=null), отмена отсчёта обнуляет startCountdownEndsAt.
    const mode = this.lobbyMode;
    window.setTimeout(() => {
      const stuckInLobby =
        this.offsetParent !== null &&
        !document.body.classList.contains("in-game") &&
        (mode === "offline" || this.startCountdownEndsAt !== null);
      if (stuckInLobby) {
        reportHealth("start_no_game", mode, { lobbyId: this.lobbyId || "" });
      }
    }, 20_000);
    if (this.lobbyMode === "offline") {
      await this.startOfflineGame();
      return;
    }
    await this.putGameConfig(); // зафиксировать актуальный конфиг до старта
    this.dispatchEvent(
      new CustomEvent("request-start", { bubbles: true, composed: true }),
    );
  }

  // terron: закрыть модалку хоста БЕЗ выхода из лобби (матч стартует). Аналог
  // JoinLobbyModal.closeWithoutLeaving — зовётся из Main на prestart.
  public closeWithoutLeaving(): void {
    this.leaveLobbyOnClose = false;
    this.close();
  }

  // ── ЛИПКОЕ ЛОББИ (terron 25.08) ────────────────────────────────────────────
  // Хост ждёт своих дольше всех, и уйти посмотреть онлайн ему нужно не меньше,
  // чем гостю. Окно сворачивается, лобби живёт: его держит сокет в
  // Main.lobbyHandle, а карточку на витрине — пульс `startPublishHeartbeat`,
  // который завязан на `publishLocked`/`lobbyId`, а НЕ на видимость окна.
  // ⚠️ Бар «СТАРТ» гаснет сам: `syncStartBar` держит инвариант «бар есть ⇔
  // страница лобби видна» (`offsetParent`), а вотчдог раз в секунду вернёт бар
  // при развороте — специально ничего снимать/ставить не нужно.
  private minimized = false;

  public override prefersMinimize(): boolean {
    // Офлайн-режим — это экран настройки локальной игры, лобби за ним нет.
    return this.lobbyId !== "" && this.lobbyMode !== "offline";
  }

  protected override onMinimize(): void {
    this.minimized = true;
    this.lobbyChat()?.collapseForNav();
    this.dispatchLobbyDock();
  }

  protected override onRestore(): void {
    this.minimized = false;
    this.lobbyChat()?.restoreAfterNav();
    this.dispatchLobbyDock();
  }

  private dispatchLobbyDock(): void {
    document.dispatchEvent(
      new CustomEvent("lobby-dock", {
        detail: this.minimized
          ? {
              source: "host",
              lobbyId: this.lobbyId,
              map: String(this.selectedMap),
              players: this.clients.length,
              maxPlayers: null,
              mode: L("Твоё лобби", "Your lobby"),
              // Хост стартует сам; отсчёт есть только когда он его запустил.
              startsAt: this.startCountdownEndsAt ?? null,
              serverTimeOffset: 0,
              tier: null,
            }
          : null,
      }),
    );
  }

  /** Вернуть свёрнутое окно лобби (кнопка на плашке). */
  public reopenFromDock(): void {
    this.restore();
  }

  /** Выйти из своего лобби прямо с плашки. */
  public leaveFromDock(): void {
    this.close(); // leaveLobbyOnClose=true → leaveLobby() + адрес на «/»
    // ⚠️ Как и у join-модалки: выйти можно, стоя на другой странице сайта, а её
    // `modalRouter.syncClosed()` при закрытии восстанавливает «путь под ней» —
    // то есть адрес лобби. Поэтому последнее слово за нами.
    try {
      this.updateHistory("/");
    } catch (error) {
      console.warn("Failed to restore URL on leave:", error);
    }
  }

  private kickPlayer(clientID: string) {
    // Dispatch event to be handled by WebSocket instead of HTTP
    this.dispatchEvent(
      new CustomEvent("kick-player", {
        detail: { target: clientID },
        bubbles: true,
        composed: true,
      }),
    );
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

// terron: воронка создания лобби — тихий beacon в platform-api (не роняет клиент).
// Ищем разрыв «создал лобби → зайти нельзя». Спека: prerealise.md §лобби-баг.
function beaconLobby(
  stage: "attempt" | "create_ok" | "create_fail" | "enter",
  d: Record<string, unknown> = {},
): void {
  try {
    void fetch(`${getApiBase()}/lobby/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ stage, ...d }),
    }).catch(() => {});
  } catch {
    /* аналитика не должна мешать игре */
  }
}

async function createLobby(gameID: string): Promise<GameInfo> {
  // Send JWT token for creator identification - server extracts persistentID from it
  // persistentID should never be exposed to other clients
  const token = await getPlayToken();
  try {
    const response = await fetch(
      `/${ClientEnv.workerPath(gameID)}/api/create_game/${gameID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Server error response:", errorText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Success:", data);

    return data as GameInfo;
  } catch (error) {
    console.error("Error creating lobby:", error);
    throw error;
  }
}

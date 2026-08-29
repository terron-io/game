import ipAnonymize from "ip-anonymize";
import { Logger } from "winston";
import WebSocket from "ws";
import { z } from "zod";
import { isAdminRole } from "../core/ApiSchemas";
import { GameEnv } from "../core/configuration/Config";
import { eventRewardPts } from "../core/configuration/TerronTuning";
import {
  GameType,
  isLockedUltimate,
  LOCKED_ULTIMATES,
  UnitType,
} from "../core/game/Game";
import {
  AllPlayersStats,
  AllPlayersStatsSchema,
  ClientID,
  ClientMessageSchema,
  ClientSendWinnerMessage,
  GameConfig,
  GameInfo,
  GameStartInfo,
  GameStartInfoSchema,
  InputModeSchema,
  PlayerRecord,
  PublicGameType,
  ServerDesyncSchema,
  ServerErrorMessage,
  ServerPrestartMessageSchema,
  StampedIntent,
  Turn,
} from "../core/Schemas";
import { createPartialGameRecord, replacer } from "../core/Util";
import {
  archive,
  fetchUnlockedUlts,
  finalizeGameRecord,
  friendRequestByPid,
  inviteToClanByPid,
  profileByPid,
  removePublicLobby,
  reportDeath,
  reportPlayerByPid,
} from "./Archive";
import { Client } from "./Client";
import { ClientMsgRateLimiter } from "./ClientMsgRateLimiter";
import { isDeviceKind } from "./Device";
import {
  type GameMeta,
  persistDelete,
  persistEnabled,
  persistMeta,
  persistTurn,
} from "./GamePersistence";
import { disabledUltsFromEnv, ServerEnv } from "./ServerEnv";
export enum GamePhase {
  Lobby = "LOBBY",
  Active = "ACTIVE",
  Finished = "FINISHED",
}

const KICK_REASON_DUPLICATE_SESSION = "kick_reason.duplicate_session";
const KICK_REASON_LOBBY_CREATOR = "kick_reason.lobby_creator";
const KICK_REASON_ADMIN = "kick_reason.admin";
const KICK_REASON_HOST_LEFT = "kick_reason.host_left";
const KICK_REASON_TOO_MUCH_DATA = "kick_reason.too_much_data";
const KICK_REASON_INVALID_MESSAGE = "kick_reason.invalid_message";

export class GameServer {
  private sentDesyncMessageClients = new Set<ClientID>();

  private intentRateLimiter = new ClientMsgRateLimiter();

  private maxGameDuration = 3 * 60 * 60 * 1000; // 3 hours

  private disconnectedTimeout = 1 * 30 * 1000; // 30 seconds

  // terron 20.07: грейс на уход ХОСТА в фазе лобби (до старта матча). Раньше
  // дисконнект хоста ЗАКРЫВАЛ лобби мгновенно — F5 в лобби выкидывал на главную
  // (у начатого матча F5 реконнектится, у лобби нет — асимметрия, репорт 20.07).
  // Теперь ждём: вернулся за это время (F5) → лобби живёт; не вернулся → закрываем.
  private hostGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private hostGraceMs = 20 * 1000;

  private turns: Turn[] = [];
  // terron ПЕРФ (21.08): параллельный массив JSON каждого хода (1:1 с turns).
  // Ход сериализуется ОДИН раз в endTurn и дальше только конкатенируется:
  // броадкаст тика, лог персиста, start-сообщение реконнекта (раньше F5 на
  // 40-й минуте = stringify всего массива ходов с нуля, многие МБ, синхронно
  // в WS-хендлере → стопор тиков у всех матчей воркера) и тело архива.
  // Инвариант: turnJson[i] === JSON.stringify(turns[i]) — при дописывании
  // hash в ход (setTurnHash) строка пересобирается.
  private turnJson: string[] = [];
  // Дедуп lobby_info (см. broadcastLobbyInfo): отпечаток последнего снимка,
  // кто из сокетов его уже получил, и когда слали последний раз (keepalive).
  private lobbyInfoFingerprint = "";
  private lobbyInfoSentTo = new WeakSet<WebSocket>();
  private lobbyInfoLastSentAt = 0;
  private intents: StampedIntent[] = [];
  public activeClients: Client[] = [];
  private allClients: Map<ClientID, Client> = new Map();
  // terron: ЗАМКИ НА УЛЬТЫ — кэш «что открыто у persistentID» (TZ-ult-unlocks.md).
  // Греется при джойне (fire-and-forget), читается СИНХРОННО на реле интента:
  // интенты в тике нельзя задерживать (порядок = детерминизм). Нет записи →
  // fail-open (матч важнее замка) + догрев. null в кэше = API ответил ошибкой.
  private readonly ultUnlocksByPid = new Map<string, Set<string> | null>();
  private warmUltUnlocks(persistentID: string): void {
    if (this.ultUnlocksByPid.has(persistentID)) return;
    if (Object.keys(LOCKED_ULTIMATES).length === 0) return;
    void fetchUnlockedUlts(persistentID).then((list) => {
      this.ultUnlocksByPid.set(
        persistentID,
        list === null ? null : new Set(list),
      );
      // API лёг → fail-open, но не навсегда: через 30с пробуем снова.
      if (list === null) {
        const t = setTimeout(() => {
          if (this.ultUnlocksByPid.get(persistentID) === null) {
            this.ultUnlocksByPid.delete(persistentID);
          }
        }, 30_000);
        t.unref?.();
      }
    });
  }
  // Можно ли этому клиенту трогать ульту `unit`. Базовые (вне реестра) — всегда.
  private ultIntentVerdict(
    client: Client,
    unit: UnitType,
  ): "ok" | "locked" | "anonymous" | "disabled" {
    // terron 24.08 (решение владельца «сервер не должен позволять что-то
    // делать с ультами, которые мы ещё не врубили»): рубильник раскатки
    // (TERRON_DISABLED_ULTS) жёстче любого замка — интент не ретранслируется
    // НИКОМУ и НИКОГДА, включая резюмнутые матчи со старым конфигом
    // (enforceUltimateGate живёт только на старте матча и их не догоняет —
    // так Террор просочился в прод-матч). На деве список пуст.
    if (GameServer.forcedDisabledUnits().includes(unit)) return "disabled";
    if (!isLockedUltimate(unit)) return "ok";
    // terron: ДЕВ-ПЕСОЧНИЦА — в лобби включена галочка «открыть все ульты».
    // Гейт по TERRON_ENV: на проде переменной нет, значит подсунутое поле
    // конфига там ничего не откроет. Выключил галочку — замки работают как в
    // бою, и сам механизм открытия тоже тестируется. TZ-ult-unlocks.md
    // ⚠️ 23.08 (просьба владельца «дай хоть на деве потестить и в фри лобби»):
    // на ДЕВЕ замки открыты ПО УМОЛЧАНИЮ — во всех лобби, включая публичные.
    // Смысл дева в том, чтобы новые ульты трогали руками; проверять сам
    // механизм замков можно, СНЯВ галочку в настройках лобби (она теперь
    // работает как выключатель песочницы). На проде переменной TERRON_ENV нет,
    // поэтому подсунутое поле конфига там по-прежнему ничего не открывает.
    if (
      process.env.TERRON_ENV === "dev" &&
      this.gameConfig.devUnlockUlts !== false
    ) {
      return "ok";
    }
    // Аноним (сырой persistentID без JWT) владеть не может — и кэш по его
    // persistentID НЕ смотрим: на GAME_ENV=dev сырой UUID принимается, и
    // подставленный чужой users.id грел бы чужой список владения.
    if (client.claims === null) return "anonymous";
    const cached = this.ultUnlocksByPid.get(client.persistentID);
    if (cached === undefined) {
      this.warmUltUnlocks(client.persistentID);
      return "ok"; // ещё не знаем — пускаем (fail-open), догреем к следующему
    }
    if (cached === null) return "ok"; // API лёг — fail-open
    if (cached.has(unit)) return "ok";
    // Без аккаунта записи быть не может: анониму — своё сообщение.
    return client.claims === null ? "anonymous" : "locked";
  }

  // Map persistentID to clientID for reconnection lookup
  private persistentIdToClientId: Map<string, ClientID> = new Map();
  private clientsDisconnectedStatus: Map<ClientID, boolean> = new Map();
  // terron: «отсчёт пустого лобби дотикал до нуля» — заявка мастеру на смену
  // карты. Снимается, когда свежий конфиг доехал (rotateLobbyConfig).
  private _wantsMapRotation = false;
  private _rotationAskedAt = 0;
  // Сколько ждём ответа мастера, прежде чем перезарядить таймер самим.
  private static readonly ROTATION_WAIT_MS = 2_000;
  // terron: момент, когда не осталось НИ ОДНОГО живого коннекта (null = есть).
  // Матч сворачивается только если коннектов нет дольше emptyGraceMs — смерть
  // или AFK игрока матч НЕ глушат (можно смотреть за ботами).
  private emptySince: number | null = null;
  private readonly emptyGraceMs = 60 * 1000;
  // terron: момент, когда ВСЕ люди помечены отключёнными (пинги встали). Матч
  // завершаем не сразу, а только если так держится дольше abandonGraceMs — иначе
  // заблокировал телефон на минуту → игра погибла → при разблокировке rejoin
  // ловит «game not found». Любой вернувшийся коннект сбрасывает счётчик.
  private allDisconnectedSince: number | null = null;
  private readonly abandonGraceMs = 2 * 60 * 1000;
  private _hasStarted = false;
  private _startTime: number | null = null;
  private hasReachedMaxPlayerCount: boolean = false;

  private endTurnIntervalID: ReturnType<typeof setInterval> | undefined;

  private lastPingUpdate = 0;

  private winner: ClientSendWinnerMessage | null = null;
  /** terron 01.08: последние снимки статистики ПО КЛИЕНТАМ — фолбэк архиву,
   *  когда матч кончился без победителя (см. case "stats"). Держим по одному
   *  на клиента, а в архив кладём тот вариант, который прислало БОЛЬШЕ ВСЕГО
   *  клиентов: симуляция детерминированная, у честных совпадёт побайтово, а
   *  один подкрученный клиент остаётся в меньшинстве. Победный пакет свой
   *  кворум имеет (handleWinner), у снимка он был бы иначе бесплатным. */
  private statsByClient = new Map<string, string>();

  // Note: This can be undefined if accessed before the game starts.
  private gameStartInfo!: GameStartInfo;
  // Wire-only copy of gameStartInfo sent to clients. Identical to
  // gameStartInfo unless disableClanTags is set, in which case clan tags
  // are stripped from players. Archive uses the original gameStartInfo.
  private wireGameStartInfo!: GameStartInfo;

  private log: Logger;

  private _hasPrestarted = false;

  private kickedPersistentIds: Set<string> = new Set();
  private outOfSyncClients: Set<ClientID> = new Set();

  private isPaused = false;

  private websockets: Set<WebSocket> = new Set();

  // SECURITY (C2/H3): кворум по persistentID, НЕ по IP. По IP игроки за одним
  // NAT считались за один голос (под-счёт), а Sybil через ~4 прокси мог
  // доминировать мелкое лобби (кап 3/IP обходился). persistentID = один реальный
  // игрок = один голос.
  private winnerVotes: Map<
    string,
    { winner: ClientSendWinnerMessage; voters: Set<string> }
  > = new Map();

  private _hasEnded = false;

  private lobbyInfoIntervalId: ReturnType<typeof setInterval> | null = null;

  private visibleAt?: number;

  // terron: серверный отсчёт старта приватного лобби (request_start/cancel_start).
  // Пока идёт — все клиенты видят таймер (endsAt в lobby_info); по нулю сервер САМ
  // зовёт start(). byHost решает, кто может отменять (хост / любой).
  private startCountdownTimer: ReturnType<typeof setTimeout> | null = null;
  private startCountdownEndsAt: number | null = null;
  private startCountdownByHost = false;
  private startCountdownStarter = "";

  constructor(
    public readonly id: string,
    readonly log_: Logger,
    public readonly createdAt: number,
    public gameConfig: GameConfig,
    private creatorPersistentID?: string,
    private startsAt?: number,
    private publicGameType?: PublicGameType,
  ) {
    this.log = log_.child({ gameID: id });
    if (startsAt !== undefined) {
      this.visibleAt = Date.now();
    }
    // terron: СОБЫТИЙНЫМ (с наградой) бывает ТОЛЬКО публичное лобби типа golden
    // или diamond — их создаёт мастер по расписанию. Флаг, пришедший откуда-то
    // ещё (конфиг лобби от хоста, снимок персиста чужой сборки), сбрасываем:
    // иначе приватной игрой с ботом фармили бы алмазы за победу.
    // См. TerronTuning TERRON_GOLDEN_* / TERRON_DIAMOND_*.
    const isEventLobby =
      publicGameType === "golden" || publicGameType === "diamond";
    if (this.gameConfig.golden && !isEventLobby) {
      this.gameConfig.golden = false;
    }
    // Тир — производная от типа лобби, а не то, что пришло снаружи: иначе
    // «золотое» лобби с подсунутым eventTier:"diamond" платило бы по алмазной
    // ставке.
    this.gameConfig.eventTier = isEventLobby
      ? (publicGameType as "golden" | "diamond")
      : undefined;
    // Награда — тоже производная: иначе подсунутым полем обещали бы (и платили)
    // сколько угодно. Значение берём из тюнинга/окружения этого же сервера.
    this.gameConfig.eventRewardPts = isEventLobby
      ? eventRewardPts(publicGameType)
      : undefined;
  }

  /**
   * terron: СОБЫТИЙНЫЙ матч — золотой или алмазный (награда победителю).
   * Только лобби типов golden/diamond; на этом флаге висят все гарды события
   * (не крутить карту в ожидании, не двигать startsAt, чат в лобби, рамка).
   * Размер награды и оформление берутся из eventTier().
   */
  public isGolden(): boolean {
    return this.gameConfig.golden === true;
  }

  /** terron: тир событийного матча ("golden" | "diamond"), иначе undefined. */
  public eventTier(): "golden" | "diamond" | undefined {
    return this.isGolden()
      ? (this.gameConfig.eventTier ?? "golden")
      : undefined;
  }

  // Публичная сводка для витрины «Активные игры» (/stats): без приватных данных,
  // только то, что и так видно joinнувшемуся (карта/режим/игроки/сколько идёт).
  public liveInfo() {
    return {
      gameID: this.id,
      gameMap: this.gameConfig.gameMap,
      gameMode: this.gameConfig.gameMode,
      maxPlayers: this.gameConfig.maxPlayers ?? null,
      publicGameType: this.publicGameType ?? null,
      numClients: this.activeClients.length,
      startTime: this._startTime,
      createdAt: this.createdAt,
    };
  }

  private get lobbyCreatorID(): ClientID | undefined {
    return this.creatorPersistentID
      ? this.persistentIdToClientId.get(this.creatorPersistentID)
      : undefined;
  }

  // terron: может ли клиент управлять лобби (старт/конфиг/кик). Обычно — только
  // создатель или админ. НО: persistentID, записанный при create_game, и
  // persistentID при ws-джойне могут разойтись (флип гость⇄аккаунт между
  // созданием и входом) → создатель не резолвится (lobbyCreatorID undefined) и
  // хост не мог стартовать СВОЁ приватное лобби. Фоллбэк: если создатель так и
  // не опознан, в ПРИВАТНОМ лобби разрешаем управление — хост обязан уметь
  // запустить игру всегда, хоть один. (Public — авто-старт, фоллбэк не трогает.)
  private canControlLobby(client: {
    clientID: ClientID;
    role: string | null;
  }): boolean {
    if (client.clientID === this.lobbyCreatorID) return true;
    if (isAdminRole(client.role)) return true;
    if (this.lobbyCreatorID === undefined && !this.isPublic()) return true;
    return false;
  }

  // terron: белый список полей, которые хост может менять через update_game_config.
  // Раньше — 22 ручных if (новое поле конфига = правка руками; fogOfWar на этом
  // ловили) и БЕЗУСЛОВНОЕ присваивание hostCheats (апдейт без этого поля затирал
  // его в undefined — работало только потому, что клиент всегда шлёт всё поле).
  // Теперь: один список + цикл. Новое хост-поле = одна строка здесь.
  // Серверные поля (gameType, maxPlayers и т.п.) в списке НЕ появляются осознанно.
  private static readonly HOST_UPDATABLE_CONFIG_KEYS = [
    "gameMap",
    "gameMapSize",
    "difficulty",
    "nations",
    "bots",
    "infiniteGold",
    "donateGold",
    "infiniteTroops",
    "donateTroops",
    "maxTimerValue",
    "instantBuild",
    "randomSpawn",
    "spawnImmunityDuration",
    "gameMode",
    "disabledUnits",
    "playerTeams",
    "goldMultiplier",
    "startingGold",
    "disableAlliances",
    "waterNukes",
    "fogOfWar",
    "devUnlockUlts", // terron: дев-песочница замков (гейт по TERRON_ENV ниже)
    "hostCheats",
  ] as const satisfies readonly (keyof GameConfig)[];

  public updateGameConfig(gameConfig: Partial<GameConfig>): void {
    for (const key of GameServer.HOST_UPDATABLE_CONFIG_KEYS) {
      const value = gameConfig[key];
      if (value === undefined) continue;
      // null от клиента = «сбросить поле» (nullable-поля схемы) → undefined
      (this.gameConfig as Record<string, unknown>)[key] = value ?? undefined;
    }
  }

  // terron 24.08: kill-switch поэтапной раскатки ульт переведён с константы
  // сборки на ENV TERRON_DISABLED_ULTS (решение владельца: включать ульты на
  // проде поштучно правкой .env, без пересборки). Список валидируется по
  // enum'у; на DEV гейт не действует (disabledUltsFromEnv сама возвращает []).
  static forcedDisabledUnits(): UnitType[] {
    const valid = new Set<string>(Object.values(UnitType));
    const out: UnitType[] = [];
    for (const name of disabledUltsFromEnv()) {
      if (valid.has(name)) out.push(name as UnitType);
      else
        console.warn(
          `[terron] TERRON_DISABLED_ULTS: неизвестный юнит "${name}" — пропускаю`,
        );
    }
    return out;
  }

  private enforceUltimateGate(): void {
    const forced = GameServer.forcedDisabledUnits();
    if (forced.length === 0) return;
    const cur = this.gameConfig.disabledUnits ?? [];
    const add = forced.filter((u) => !cur.includes(u));
    if (add.length > 0) this.gameConfig.disabledUnits = [...cur, ...add];
  }

  private isKicked(clientID: ClientID): boolean {
    const persistentID = this.allClients.get(clientID)?.persistentID;
    return (
      persistentID !== undefined && this.kickedPersistentIds.has(persistentID)
    );
  }

  // Get existing clientID for this persistentID, or null if new player
  public getClientIdForPersistentId(persistentID: string): ClientID | null {
    const clientID = this.persistentIdToClientId.get(persistentID);
    if (!clientID) return null;
    if (this.kickedPersistentIds.has(persistentID)) return null;
    return clientID;
  }

  public joinClient(client: Client): "joined" | "kicked" | "rejected" {
    if (this.kickedPersistentIds.has(client.persistentID)) {
      return "kicked";
    }

    if (
      this.gameConfig.maxPlayers &&
      this.activeClients.length >= this.gameConfig.maxPlayers
    ) {
      this.log.warn(`cannot add client, game full`, {
        clientID: client.clientID,
      });

      client.ws.send(
        JSON.stringify({
          type: "error",
          error: "full-lobby",
        } satisfies ServerErrorMessage),
      );
      return "rejected";
    }

    this.log.info("client joining game", {
      clientID: client.clientID,
      persistentID: client.persistentID,
      clientIP: ipAnonymize(client.ip),
    });

    if (
      this.gameConfig.gameType === GameType.Public &&
      this.activeClients.filter(
        (c) => c.ip === client.ip && c.clientID !== client.clientID,
      ).length >= 3
    ) {
      this.log.warn("cannot add client, already have 3 ips", {
        clientID: client.clientID,
        clientIP: ipAnonymize(client.ip),
      });
      return "rejected";
    }

    if (ServerEnv.env() === GameEnv.Prod) {
      // Prevent multiple clients from using the same account in prod
      const conflicting = this.activeClients.find(
        (c) =>
          c.persistentID === client.persistentID &&
          c.clientID !== client.clientID,
      );
      if (conflicting !== undefined) {
        this.log.warn("client ids do not match", {
          clientID: client.clientID,
          clientIP: ipAnonymize(client.ip),
          clientPersistentID: client.persistentID,
          existingIP: ipAnonymize(conflicting.ip),
          existingPersistentID: conflicting.persistentID,
        });
        // Kick the existing client instead of the new one, because this was causing issues when
        // a client wanted to replay the game afterwards.
        this.kickClient(conflicting.clientID, KICK_REASON_DUPLICATE_SESSION);
      }
    }

    // Client connection accepted
    this.websockets.add(client.ws);
    this.persistentIdToClientId.set(client.persistentID, client.clientID);
    this.activeClients.push(client);
    client.lastPing = Date.now();
    this.markClientDisconnected(client.clientID, false);
    this.allClients.set(client.clientID, client);
    this.warmUltUnlocks(client.persistentID);
    this.emptySince = null; // появился коннект — сбрасываем счётчик пустоты
    this.addListeners(client);
    this.startLobbyInfoBroadcast();

    if (this.activeClients.length >= (this.gameConfig.maxPlayers ?? Infinity)) {
      this.hasReachedMaxPlayerCount = true;
    }

    // In case a client joined the game late and missed the start message.
    if (this._hasStarted) {
      this.sendStartGameMsg(client.ws, 0);
      // ростер изменился (поздний коннект/спектатор) — пере-снимок для резюма.
      this.persistSnapshot();
    }

    return "joined";
  }

  // Attempt to reconnect a client by persistentID. Returns true if successful.
  // WebSocket is always updated. Optional identity updates are applied only
  // before the game has started.
  public rejoinClient(
    ws: WebSocket,
    persistentID: string,
    lastTurn: number = 0,
    identityUpdate?: { username: string; clanTag: string | null },
  ): boolean {
    const clientID = this.getClientIdForPersistentId(persistentID);
    if (!clientID) return false;
    const client = this.allClients.get(clientID);
    if (!client) return false;
    // terron: ЗАМКИ НА УЛЬТЫ — после рестарта воркера кэш пуст, греем на рейджойне.
    if (client.claims !== null) this.warmUltUnlocks(client.persistentID);

    this.websockets.add(ws);
    this.log.info("client rejoining", { clientID, lastTurn });

    // Close old WebSocket to prevent resource leaks
    if (client.ws !== ws) {
      client.ws.removeAllListeners();
      client.ws.close();
    }

    this.activeClients = this.activeClients.filter(
      (c) => c.clientID !== client.clientID,
    );
    this.activeClients.push(client);
    if (identityUpdate && !this.hasStarted()) {
      client.username = identityUpdate.username;
      client.clanTag = identityUpdate.clanTag;
    }
    client.lastPing = Date.now();
    this.markClientDisconnected(client.clientID, false);

    client.ws = ws;
    this.addListeners(client);
    this.startLobbyInfoBroadcast();

    if (this._hasStarted) {
      this.sendStartGameMsg(client.ws, lastTurn);
    }
    return true;
  }

  private addListeners(client: Client) {
    client.ws.removeAllListeners("message");
    client.ws.on("message", async (message: string) => {
      try {
        let json: unknown;
        try {
          json = JSON.parse(message);
        } catch (e) {
          this.log.warn(`Failed to parse client message JSON, kicking`, {
            clientID: client.clientID,
            error: String(e),
          });
          this.kickClient(client.clientID, KICK_REASON_INVALID_MESSAGE);
          return;
        }
        const parsed = ClientMessageSchema.safeParse(json);
        if (!parsed.success) {
          this.log.warn(`Failed to parse client message, kicking`, {
            clientID: client.clientID,
            error: z.prettifyError(parsed.error),
          });
          this.kickClient(client.clientID, KICK_REASON_INVALID_MESSAGE);
          return;
        }
        const clientMsg = parsed.data;
        const bytes = Buffer.byteLength(message, "utf8");
        const rateResult = this.intentRateLimiter.check(
          client.clientID,
          clientMsg.type,
          bytes,
        );
        if (rateResult === "kick") {
          this.log.warn(`Client rate limit exceeded, kicking`, {
            clientID: client.clientID,
            type: clientMsg.type,
          });
          this.kickClient(client.clientID, KICK_REASON_TOO_MUCH_DATA);
          return;
        }
        if (rateResult === "limit") {
          this.log.warn(`Client message rate limit exceeded, dropping`, {
            clientID: client.clientID,
            type: clientMsg.type,
          });
          return;
        }
        switch (clientMsg.type) {
          case "rejoin": {
            // Client is already connected, no auth required, send start game message if game has started
            if (this._hasStarted) {
              this.sendStartGameMsg(client.ws, clientMsg.lastTurn);
            }
            break;
          }
          case "intent": {
            // Server stamps clientID from the authenticated connection
            const stampedIntent = {
              ...clientMsg.intent,
              clientID: client.clientID,
            };
            switch (stampedIntent.type) {
              // terron: ЗАМКИ НА УЛЬТЫ — закрытую ульту (реестр LOCKED_ULTIMATES)
              // можно выбрать/строить только с владением на аккаунте. Проверка ДО
              // ретрансляции: интент либо уходит всем, либо никому (иначе десинк).
              case "choose_ultimate":
              case "build_unit": {
                const verdict = this.ultIntentVerdict(
                  client,
                  stampedIntent.unit,
                );
                if (verdict !== "ok") {
                  this.log.info(`ult intent rejected (${verdict})`, {
                    clientID: client.clientID,
                    unit: stampedIntent.unit,
                  });
                  try {
                    client.ws.send(
                      JSON.stringify({
                        type: "ult_locked",
                        unit: stampedIntent.unit,
                        reason: verdict,
                      }),
                    );
                  } catch {
                    /* ws закрыт */
                  }
                  return;
                }
                // Don't process intents while game is paused (как в default)
                if (!this.isPaused) {
                  this.addIntent(stampedIntent);
                }
                break;
              }
              case "mark_disconnected": {
                this.log.warn(
                  `Should not receive mark_disconnected intent from client`,
                );
                return;
              }

              // Handle kick_player intent via WebSocket
              case "kick_player": {
                const isLobbyCreator = client.clientID === this.lobbyCreatorID;
                const isAdmin = isAdminRole(client.role);

                // Check if the authenticated client is the lobby creator or admin
                // (canControlLobby adds a private-lobby fallback when the creator
                // never resolved — see helper).
                if (!this.canControlLobby(client)) {
                  this.log.warn(
                    `Only lobby creator or admin can kick players`,
                    {
                      clientID: client.clientID,
                      creatorID: this.lobbyCreatorID,
                      target: stampedIntent.target,
                      gameID: this.id,
                    },
                  );
                  return;
                }

                // Don't allow kicking yourself
                if (client.clientID === stampedIntent.target) {
                  this.log.warn(`Cannot kick yourself`, {
                    clientID: client.clientID,
                  });
                  return;
                }

                // Log and execute the kick
                this.log.info(`Player initiated kick`, {
                  kickerID: client.clientID,
                  isAdmin,
                  target: stampedIntent.target,
                  gameID: this.id,
                  kickMethod: "websocket",
                });

                this.kickClient(
                  stampedIntent.target,
                  isAdmin && !isLobbyCreator
                    ? KICK_REASON_ADMIN
                    : KICK_REASON_LOBBY_CREATOR,
                );
                return;
              }
              // terron: in-game приглашение в клан. Out-of-band (НЕ в симуляцию).
              // Сервер знает persistentID игроков → зовёт platform-api по pid.
              case "clan_invite": {
                const target = this.allClients.get(stampedIntent.target);
                const inviterPid = client.persistentID;
                const targetPid = target?.persistentID;
                const clanTag = stampedIntent.clanTag;
                if (inviterPid && targetPid) {
                  void (async () => {
                    const res = await inviteToClanByPid(
                      clanTag,
                      inviterPid,
                      targetPid,
                    );
                    // результат — пригласившему
                    try {
                      client.ws.send(
                        JSON.stringify({
                          type: "clan_invite_result",
                          status: res.status,
                          clanTag,
                          clanName: res.clanName,
                        }),
                      );
                    } catch {
                      /* ws закрыт */
                    }
                    // уведомление приглашённому (реальный инвайт аккаунту)
                    if (res.status === "invited" && target) {
                      try {
                        target.ws.send(
                          JSON.stringify({
                            type: "clan_invited",
                            clanTag,
                            clanName: res.clanName ?? "",
                            by: client.username,
                          }),
                        );
                      } catch {
                        /* ws закрыт */
                      }
                    }
                  })();
                }
                return;
              }
              // terron: in-game заявка в друзья. Out-of-band (как clan_invite).
              // Сервер знает persistentID обоих → зовёт platform-api по pid.
              case "friend_request": {
                const target = this.allClients.get(stampedIntent.target);
                const requesterPid = client.persistentID;
                const targetPid = target?.persistentID;
                if (requesterPid && targetPid) {
                  void (async () => {
                    const res = await friendRequestByPid(
                      requesterPid,
                      targetPid,
                      this.id,
                    );
                    // результат — отправителю (тост)
                    try {
                      client.ws.send(
                        JSON.stringify({
                          type: "friend_request_result",
                          status: res.status,
                          targetName: res.targetName,
                        }),
                      );
                    } catch {
                      /* ws закрыт */
                    }
                    // уведомление адресату (только если заявка реально создана)
                    if (res.status === "sent" && res.requestId && target) {
                      try {
                        target.ws.send(
                          JSON.stringify({
                            type: "friend_requested",
                            requestId: res.requestId,
                            by: client.username,
                          }),
                        );
                      } catch {
                        /* ws закрыт */
                      }
                    }
                  })();
                }
                return;
              }
              // terron: in-game запрос досье. Out-of-band — резолвим target pid →
              // users.slug и шлём назад отправителю. Клиент знает лишь clientID.
              case "get_profile": {
                const target = this.allClients.get(stampedIntent.target);
                const targetPid = target?.persistentID;
                const targetClientID = stampedIntent.target;
                void (async () => {
                  const prof = targetPid
                    ? await profileByPid(targetPid)
                    : { slug: null, name: null };
                  try {
                    client.ws.send(
                      JSON.stringify({
                        type: "profile_result",
                        target: targetClientID,
                        slug: prof.slug,
                        name: prof.name ?? target?.username ?? null,
                      }),
                    );
                  } catch {
                    /* ws закрыт */
                  }
                })();
                return;
              }
              // terron: in-game жалоба. Out-of-band — резолвим target pid и шлём
              // в platform-api. Жалующийся знает игрока лишь по clientID.
              case "player_report": {
                const target = this.allClients.get(stampedIntent.target);
                const reporterPid = client.persistentID;
                const targetPid = target?.persistentID;
                // terron: нельзя жаловаться на СЕБЯ. clientID у репортёра и цели
                // могут различаться (два клиента/вкладки), но это ОДИН аккаунт —
                // сверяем persistentID, а не clientID. Иначе self-report засорял
                // бы модерацию и позволял абуз.
                if (
                  reporterPid &&
                  targetPid &&
                  target &&
                  reporterPid !== targetPid
                ) {
                  void reportPlayerByPid(
                    reporterPid,
                    targetPid,
                    target.username,
                    this.id,
                    stampedIntent.reason ?? "",
                  );
                }
                return;
              }
              case "update_game_config": {
                // Only lobby creator (or fallback host) can update config
                if (!this.canControlLobby(client)) {
                  this.log.warn(`Only lobby creator can update game config`, {
                    clientID: client.clientID,
                    creatorID: this.lobbyCreatorID,
                    gameID: this.id,
                  });
                  return;
                }

                if (this.isPublic()) {
                  this.log.warn(`Cannot update public game via WebSocket`, {
                    gameID: this.id,
                    clientID: client.clientID,
                  });
                  return;
                }

                if (this.hasStarted()) {
                  this.log.warn(
                    `Cannot update game config after it has started`,
                    {
                      gameID: this.id,
                      clientID: client.clientID,
                    },
                  );
                  return;
                }

                if (stampedIntent.config.gameType === GameType.Public) {
                  this.log.warn(`Cannot update game to public via WebSocket`, {
                    gameID: this.id,
                    clientID: client.clientID,
                  });
                  return;
                }

                this.log.info(
                  `Lobby creator updated game config via WebSocket`,
                  {
                    creatorID: client.clientID,
                    gameID: this.id,
                  },
                );

                this.updateGameConfig(stampedIntent.config);
                return;
              }
              case "start_game": {
                if (!this.canControlLobby(client)) {
                  this.log.warn(`Only lobby creator can start game`, {
                    clientID: client.clientID,
                    creatorID: this.lobbyCreatorID,
                    gameID: this.id,
                  });
                  return;
                }
                if (this.isPublic()) {
                  this.log.warn(`Cannot start public game via WebSocket`, {
                    gameID: this.id,
                  });
                  return;
                }
                if (this.hasStarted()) {
                  this.log.warn(`Cannot start game that has already started`, {
                    gameID: this.id,
                    clientID: client.clientID,
                  });
                  return;
                }
                this.log.info(`Lobby creator starting game via WebSocket`, {
                  creatorID: client.clientID,
                  gameID: this.id,
                });
                this.startPrivateWithPrestart();
                return;
              }
              // terron: любой участник может запустить отсчёт старта. Сервер сам
              // решает длительность (хост 10с / игрок 60с) и по нулю зовёт start().
              case "request_start": {
                if (this.isPublic() || this.hasStarted()) return;
                this.beginStartCountdown(client);
                return;
              }
              // terron: отмена отсчёта. Хостовый отсчёт отменяет только хост,
              // отсчёт игрока — любой участник.
              case "cancel_start": {
                if (this.startCountdownEndsAt === null) return;
                if (
                  this.startCountdownByHost &&
                  !this.canControlLobby(client)
                ) {
                  return;
                }
                this.cancelStartCountdown();
                return;
              }
              case "toggle_pause": {
                // Only lobby creator can pause/resume
                if (client.clientID !== this.lobbyCreatorID) {
                  this.log.warn(`Only lobby creator can toggle pause`, {
                    clientID: client.clientID,
                    creatorID: this.lobbyCreatorID,
                    gameID: this.id,
                  });
                  return;
                }

                if (stampedIntent.paused) {
                  // Pausing: send intent and complete current turn before pause takes effect
                  this.addIntent(stampedIntent);
                  this.endTurn();
                  this.isPaused = true;
                } else {
                  // Unpausing: clear pause flag before sending intent so next turn can execute
                  this.isPaused = false;
                  this.addIntent(stampedIntent);
                  this.endTurn();
                }

                this.log.info(`Game ${this.isPaused ? "paused" : "resumed"}`, {
                  clientID: client.clientID,
                  gameID: this.id,
                });
                break;
              }
              default: {
                // Don't process intents while game is paused
                if (!this.isPaused) {
                  this.addIntent(stampedIntent);
                }
                break;
              }
            }
            break;
          }
          case "ping": {
            this.lastPingUpdate = Date.now();
            client.lastPing = Date.now();
            break;
          }
          case "hash": {
            client.hashes.set(clientMsg.turnNumber, clientMsg.hash);
            break;
          }
          case "winner": {
            this.handleWinner(client, clientMsg);
            break;
          }
          // terron: «играю пальцем / мышью» (client/InputMode.ts). Клиент шлёт
          // это 1-3 раза за матч, на смену классификации. В симуляцию НЕ идёт
          // (детерминизм не трогаем) — только в архив, для значка в топе.
          // terron 30.07: игрока съели — награду начисляем СРАЗУ, не дожидаясь
          // конца чужой партии (его результат уже окончателен). Время берём
          // своё, съеденных — из сообщения; API их капит по составу лобби.
          // Один раз на клиента: повтор игнорируем, чтобы не мигать в леджер.
          case "death": {
            if (client.deathReported) break;
            client.deathReported = true;
            void reportDeath(this.id, {
              clientID: client.clientID,
              persistentID: client.persistentID,
              username: client.username ?? null,
              turn: this.turns.length,
              eatenNations: clientMsg.eatenNations,
              eatenPlayers: clientMsg.eatenPlayers,
              map: this.gameConfig.gameMap ?? null,
              mode: this.gameConfig.gameMode ?? null,
            });
            break;
          }
          // terron 01.08: снимок статистики всех игроков (клиент шлёт раз в
          // ~30 с). Сервер симуляцию не считает, а статистика раньше ехала
          // ТОЛЬКО с победой — матчи, кончившиеся без победителя, уезжали в
          // архив пустыми (221 «Unable to find stats» из 400 за сутки).
          // Держим последний снимок и подставляем его в архив как фолбэк.
          case "stats": {
            try {
              this.statsByClient.set(
                client.clientID,
                JSON.stringify(clientMsg.allPlayersStats, replacer),
              );
            } catch {
              /* битый снимок — просто игнорируем */
            }
            break;
          }
          case "input_mode": {
            if (client.inputMode === clientMsg.mode) break;
            client.inputMode = clientMsg.mode;
            // Пере-снимок: иначе рестарт контейнера посреди матча воскресил бы
            // игру БЕЗ уже собранного сигнала (клиент шлёт его только на смену
            // классификации и заново не повторит). Смен за матч 1-3 — дёшево.
            this.persistSnapshot();
            break;
          }
          default: {
            this.log.warn(`Unknown message type: ${(clientMsg as any).type}`, {
              clientID: client.clientID,
            });
            break;
          }
        }
      } catch (error) {
        this.log.info(
          `error handling websocket request in game server: ${error}`,
          {
            clientID: client.clientID,
          },
        );
      }
    });
    client.ws.on("close", () => {
      this.log.info("client disconnected", {
        clientID: client.clientID,
        persistentID: client.persistentID,
      });
      this.activeClients = this.activeClients.filter(
        (c) => c.clientID !== client.clientID,
      );

      // terron: уход/дисконнект НЕ пишем отдельным абандон-стабом. Статистика
      // всех игроков (в т.ч. ушедших) фиксируется финальным архивом в конце
      // матча (gameStartInfo.players). F5/AFK — игрок просто ждёт конца матча.

      if (!this._hasStarted) {
        // Remove persistentId if the game has not started to prevent going over max players
        this.persistentIdToClientId.delete(client.persistentID);
        // Close lobby when host leaves before game starts
        if (
          !this.isPublic() &&
          client.persistentID === this.creatorPersistentID
        ) {
          // terron 20.07: МГНОВЕННОЕ снятие «карточки-призрака» с витрины. Хост
          // опубликовал лобби (на сервере оно осталось Private — публикация не
          // флипает gameType), а потом вкладка УМЕРЛА/закрылась. ОС рвёт WS →
          // этот хук срабатывает СРАЗУ, снимаем с публичной витрины без ожидания
          // TTL. Для неопубликованного лобби — no-op (id нет в сторе). Делаем
          // всегда: если хост вернётся (F5), клиент опубликует заново.
          removePublicLobby(this.id);
          // terron 20.07: НЕ закрываем лобби сразу — даём хосту грейс на возврат
          // (F5 в лобби реконнектится за секунды). Не вернулся за hostGraceMs →
          // закрываем. Один таймер на лобби (гард).
          if (this.hostGraceTimer === null) {
            this.log.info("Host disconnected, lobby grace started", {
              gameID: this.id,
            });
            this.hostGraceTimer = setTimeout(() => {
              this.hostGraceTimer = null;
              if (this._hasStarted || this._hasEnded) return;
              // Хост вернулся за грейс (F5) → лобби живёт.
              const hostBack = this.activeClients.some(
                (c) => c.persistentID === this.creatorPersistentID,
              );
              if (hostBack) {
                this.log.info("Host reconnected within grace, lobby kept", {
                  gameID: this.id,
                });
                return;
              }
              this.log.info("Host left (grace expired), closing lobby", {
                gameID: this.id,
              });
              removePublicLobby(this.id);
              for (const c of [...this.activeClients]) {
                this.kickClient(c.clientID, KICK_REASON_HOST_LEFT);
              }
              this._hasEnded = true;
            }, this.hostGraceMs);
          }
        }
      }
    });
    client.ws.on("error", (error: Error) => {
      if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
        client.ws.close(1002, "WS_ERR_UNEXPECTED_RSV_1");
      }
    });

    // Check if WebSocket already closed before we added the listener (race condition)
    if (client.ws.readyState >= 2) {
      this.log.info("client WebSocket already closing/closed, removing", {
        clientID: client.clientID,
        readyState: client.ws.readyState,
      });
      this.activeClients = this.activeClients.filter(
        (c) => c.clientID !== client.clientID,
      );
      // Remove persistentId if the game has not started to prevent going over max players
      if (!this._hasStarted) {
        this.persistentIdToClientId.delete(client.persistentID);
      }
    }
  }

  public setStartsAt(startsAt: number) {
    this.startsAt = startsAt;
    // Record when the lobby first became visible to players, used to measure lobby fill time.
    this.visibleAt ??= Date.now();
  }

  // terron: ротация карты ПУСТОГО публичного лобби (мастер шлёт свежий конфиг
  // из плейлиста, пока лобби некому стартовать — иначе карта на витрине висит
  // часами). Гард: не стартовало и никого нет — чужой сетап не перетираем;
  // гонка «игрок зашёл, пока конфиг летел по IPC» отсекается здесь же.
  // terron 20.07: «сюда уже идёт игрок» — ставится, когда клиент проверяет
  // лобби перед входом (/exists). Между этой проверкой и реальным подключением
  // проходит ~1.5с (auth, косметика), и ротация карты успевала сработать: игрок
  // кликал по Байкалу, а попадал в Mare Nostrum (репорт владельца 20.07).
  private rotationHoldUntil = 0;

  public holdRotation(ms = 5_000): void {
    this.rotationHoldUntil = Math.max(this.rotationHoldUntil, Date.now() + ms);
  }

  public rotateLobbyConfig(gameConfig: GameConfig) {
    if (this.hasStarted() || this.activeClients.length > 0) return;
    if (Date.now() < this.rotationHoldUntil) return;
    // terron: событийное лобби ЖДЁТ своего времени — карту не крутим (иначе игроки,
    // пришедшие «на Байкал к 19:00», к 19:00 увидят другую карту). Меняем её
    // ТОЛЬКО по собственной заявке: слот прошёл впустую → новый цикл, новая
    // карта. Сравнивать со startsAt тут нельзя — мастер шлёт новое время И
    // конфиг одним сообщением, время применяется первым и всегда оказывается
    // в будущем, из-за чего карта не менялась НИКОГДА.
    if (this.isGolden() && !this._wantsMapRotation) return;
    this._wantsMapRotation = false;
    this.gameConfig = gameConfig;
    // Флаг события и его тир — свойство ЛОББИ, а не карты: пережидают ротацию.
    if (this.publicGameType === "golden" || this.publicGameType === "diamond") {
      this.gameConfig.golden = true;
      this.gameConfig.eventTier = this.publicGameType;
      this.gameConfig.eventRewardPts = eventRewardPts(this.publicGameType);
    }
    this.log.info("lobby map rotated", {
      gameID: this.id,
      gameMap: gameConfig.gameMap,
    });
  }

  public numClients(): number {
    return this.activeClients.length;
  }

  public wantsMapRotation(): boolean {
    return this._wantsMapRotation;
  }

  // terron: разослать «сервер перезапускается» активным клиентам. Возвращает
  // число оповещённых. См. GameManager.broadcastServerRestart / server-reconnect.md.
  public broadcastServerRestart(): number {
    const msg = JSON.stringify({ type: "server_restart" });
    let n = 0;
    for (const c of this.activeClients) {
      if (c.ws.readyState === WebSocket.OPEN) {
        try {
          c.ws.send(msg);
          n++;
        } catch {
          /* ws закрыт */
        }
      }
    }
    return n;
  }

  public numDesyncedClients(): number {
    return this.outOfSyncClients.size;
  }

  // terron: длительности отсчёта старта приватного лобби.
  private static readonly HOST_COUNTDOWN_MS = 5_000;
  private static readonly PLAYER_COUNTDOWN_MS = 60_000;

  // Запускаем отсчёт (если он ещё не идёт). Хост → 10с (отменяет только хост),
  // обычный игрок → 60с (отменяет любой). По нулю сервер сам стартует матч.
  private beginStartCountdown(client: {
    clientID: ClientID;
    role: string | null;
    username: string;
  }): void {
    if (this.startCountdownEndsAt !== null) return; // уже идёт
    const byHost = this.canControlLobby(client);
    const dur = byHost
      ? GameServer.HOST_COUNTDOWN_MS
      : GameServer.PLAYER_COUNTDOWN_MS;
    this.startCountdownByHost = byHost;
    this.startCountdownStarter = client.username;
    this.startCountdownEndsAt = Date.now() + dur;
    this.log.info("lobby start countdown began", {
      gameID: this.id,
      byHost,
      dur,
    });
    this.startCountdownTimer = setTimeout(() => {
      this.startCountdownTimer = null;
      this.startCountdownEndsAt = null;
      this.startPrivateWithPrestart();
    }, dur);
    // Мгновенный broadcast — не ждём следующего 1с-тика lobby_info.
    this.broadcastLobbyInfo();
  }

  // terron: старт приватного лобби ПО ТРЕБОВАНИЮ (кнопка хоста / серверный отсчёт).
  // КАК В GameManager.tick для публичных игр: сперва prestart() — клиент грузит
  // карту и ПОДКЛЮЧАЕТ игровой сокет (весь переход клиента в игру висит на
  // lobbyHandle.prestart.then, см. Main.ts), — и только через 2с грейс start().
  // Прямой start() без prestart НЕ резолвил prestart-промис клиента: турн-луп
  // уходил вперёд без подключённого клиента → 22с голодовки → реконнект → мимо
  // спавн-фазы, боты уже развились (баг «дев-vs-прод», private-лобби).
  private startPrivateWithPrestart(): void {
    if (this.hasStarted()) return;
    this.prestart();
    setTimeout(() => {
      try {
        // ВАЖНО: зовём start() НАПРЯМУЮ, как GameManager.tick. НЕ гейтить через
        // hasStarted() — она true после prestart (`_hasStarted||_hasPrestarted`),
        // и гейт молча пропускал старт → игра вечно на «Загрузке карты». start()
        // сам защищён сырым `_hasStarted||_hasEnded`.
        this.start();
      } catch (error) {
        this.log.error(`error starting game ${this.id} after prestart`, {
          gameID: this.id,
          err: String((error as Error)?.stack ?? error).slice(0, 300),
        });
      }
    }, 2000);
  }

  private cancelStartCountdown(): void {
    if (this.startCountdownTimer !== null) {
      clearTimeout(this.startCountdownTimer);
      this.startCountdownTimer = null;
    }
    if (this.startCountdownEndsAt === null) return;
    this.startCountdownEndsAt = null;
    this.startCountdownByHost = false;
    this.startCountdownStarter = "";
    this.log.info("lobby start countdown cancelled", { gameID: this.id });
    this.broadcastLobbyInfo();
  }

  public prestart() {
    // terron 21.08: и после end() — таймер отсчёта/грейса мог пережить
    // завершение и дёрнуть prestart у мёртвого лобби (теперь end() их гасит,
    // но гард дешёвый и закрывает любой иной путь).
    if (this.hasStarted() || this._hasEnded) {
      return;
    }
    this._hasPrestarted = true;

    // terron: игра стартует → снимаем её с витрины ПУБЛИЧНЫХ лобби (реестр
    // platform-api). Раньше это делал только клиент хоста на уходе → стартовавшее
    // пользовательское лобби висело до 8-мин TTL, и игроки заходили в уже
    // идущий матч без спавна («Точка спавна не выбрана», репорт 17.07).
    if (this.gameConfig.gameType === GameType.Public) {
      removePublicLobby(this.id);
    }

    const prestartMsg = ServerPrestartMessageSchema.safeParse({
      type: "prestart",
      gameMap: this.gameConfig.gameMap,
      gameMapSize: this.gameConfig.gameMapSize,
    });

    if (!prestartMsg.success) {
      console.error(
        `error creating prestart message for game ${this.id}, ${prestartMsg.error}`.substring(
          0,
          250,
        ),
      );
      return;
    }

    const msg = JSON.stringify(prestartMsg.data);
    this.activeClients.forEach((c) => {
      this.log.info("sending prestart message", {
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(msg);
      }
    });
  }

  private startLobbyInfoBroadcast() {
    if (this._hasStarted || this._hasEnded) {
      return;
    }
    if (this.lobbyInfoIntervalId !== null) {
      return;
    }
    this.broadcastLobbyInfo();
    this.lobbyInfoIntervalId = setInterval(() => {
      if (
        this._hasStarted ||
        this._hasEnded ||
        this.activeClients.length === 0
      ) {
        this.stopLobbyInfoBroadcast();
        return;
      }
      this.broadcastLobbyInfo(true);
    }, 1000);
  }

  private stopLobbyInfoBroadcast() {
    if (this.lobbyInfoIntervalId === null) {
      return;
    }
    clearInterval(this.lobbyInfoIntervalId);
    this.lobbyInfoIntervalId = null;
  }

  // terron ПЕРФ (21.08): keepalive-период дедупа lobby_info. Секундный тик
  // слал полный снимок (конфиг+ростер, >1КБ → отдельный deflate на каждого)
  // КАЖДОМУ клиенту, хотя менялся в нём только serverTime. Клиент отсчёт
  // считает сам (startsAt/startCountdownEndsAt минус локальные часы с
  // offset'ом, свои 100/250мс-тикеры в Join/HostLobbyModal), от секундной
  // каденции ничего не зависит → шлём при ИЗМЕНЕНИИ снимка или раз в 5с.
  private static readonly LOBBY_INFO_KEEPALIVE_MS = 5000;

  /**
   * @param onlyIfChanged true — из секундного тика: слать только тем, кто
   *   текущий снимок ещё не видел (новый/переподключившийся сокет получает
   *   его на ближайшем тике, как раньше), либо всем по keepalive. false
   *   (событийные вызовы: отсчёт, кик, конфиг…) — всем и сразу, как было.
   */
  private broadcastLobbyInfo(onlyIfChanged = false) {
    const lobbyInfo = this.gameInfo();
    // terron ПЕРФ (15.08): снимок лобби сериализуется ОДИН раз, а не на каждого
    // клиента (раньше — O(клиенты × размер снимка) каждую секунду; в людном
    // лобби золотого/алмазного это десятки полных stringify конфига+ростера).
    // Персональное поле одно — myClientID — подставляем конкатенацией.
    // JSON эквивалентен пообъектному stringify (порядок ключей для парсера не
    // значим; clientID экранируем как строку через JSON.stringify).
    const lobbyJson = JSON.stringify(lobbyInfo);
    // Отпечаток — тот же JSON без единственного «тикающего» поля serverTime.
    const fingerprint = lobbyJson.replace(/"serverTime":\d+/, "");
    const now = Date.now();
    if (fingerprint !== this.lobbyInfoFingerprint) {
      this.lobbyInfoFingerprint = fingerprint;
      this.lobbyInfoSentTo = new WeakSet<WebSocket>();
    }
    const keepalive =
      now - this.lobbyInfoLastSentAt >= GameServer.LOBBY_INFO_KEEPALIVE_MS;
    let sentAny = false;
    this.activeClients.forEach((c) => {
      if (c.ws.readyState !== WebSocket.OPEN) return;
      if (onlyIfChanged && !keepalive && this.lobbyInfoSentTo.has(c.ws)) {
        return;
      }
      const msg =
        '{"type":"lobby_info","lobby":' +
        lobbyJson +
        ',"myClientID":' +
        JSON.stringify(c.clientID) +
        "}";
      c.ws.send(msg);
      this.lobbyInfoSentTo.add(c.ws);
      sentAny = true;
    });
    if (sentAny && (keepalive || !onlyIfChanged)) {
      this.lobbyInfoLastSentAt = now;
    }
  }

  public start() {
    if (this._hasStarted || this._hasEnded) {
      return;
    }
    // terron: гасим возможный отсчёт (старт мог прийти иным путём).
    if (this.startCountdownTimer !== null) {
      clearTimeout(this.startCountdownTimer);
      this.startCountdownTimer = null;
    }
    this.startCountdownEndsAt = null;
    // terron 20.07: матч стартовал — гасим грейс ухода хоста (дальше reconnect
    // ведёт себя как у любого начатого матча, отдельный лобби-грейс не нужен).
    if (this.hostGraceTimer !== null) {
      clearTimeout(this.hostGraceTimer);
      this.hostGraceTimer = null;
    }
    this._hasStarted = true;
    this._startTime = Date.now();
    // Set last ping to start so we don't immediately stop the game
    // if no client connects/pings.
    this.lastPingUpdate = Date.now();

    const friendsFor = this.buildFriendsLookup();
    this.enforceUltimateGate(); // прод: оставить только 3 ульты (см. метод)

    const result = GameStartInfoSchema.safeParse({
      gameID: this.id,
      lobbyCreatedAt: this.createdAt,
      visibleAt: this.visibleAt,
      config: this.gameConfig,
      players: this.activeClients.map((c) => ({
        username: c.username,
        clanTag: c.clanTag ?? null,
        clientID: c.clientID,
        cosmetics: c.cosmetics,
        isLobbyCreator: this.lobbyCreatorID === c.clientID,
        friends: friendsFor(c),
        // terron: публичный хэндл аккаунта — по нему клиент показывает
        // аватарку в панели игрока. У анонимов его нет.
        publicId: c.publicId,
      })),
    });
    if (!result.success) {
      const error = z.prettifyError(result.error);
      this.log.error("Error parsing game start info", {
        gameID: this.id,
        message: error,
      });
      return;
    }
    this.gameStartInfo = result.data satisfies GameStartInfo;
    this.wireGameStartInfo = this.gameConfig.disableClanTags
      ? {
          ...this.gameStartInfo,
          players: this.gameStartInfo.players.map((p) => ({
            ...p,
            clanTag: null,
          })),
        }
      : this.gameStartInfo;

    this.endTurnIntervalID = setInterval(
      () => this.endTurn(),
      ServerEnv.turnIntervalMs(),
    );
    // terron: снимок для резюма после рестарта (флаг-гейтед). См. GamePersistence.
    this.persistSnapshot();
    // terron ПЕРФ (15.08): общая часть start-сообщения (turns с нуля + полный
    // ростер с косметикой) сериализуется ОДИН раз на матч, а не на каждого
    // клиента — раньше в людном событийном лобби это был десяток полных
    // stringify самого тяжёлого сообщения протокола подряд, в один тик старта.
    // Персональное поле одно — myClientID — подставляется конкатенацией
    // (для парсера JSON порядок ключей не значим; id экранируем).
    // Ветки реконнекта (lastTurn > 0) не касаемся: там срез ходов у каждого свой.
    const sharedStart =
      '{"type":"start","turns":' +
      this.turnsJsonSlice(0) +
      ',"gameStartInfo":' +
      JSON.stringify(this.wireGameStartInfo) +
      ',"lobbyCreatedAt":' +
      JSON.stringify(this.createdAt) +
      ',"myClientID":';
    this.activeClients.forEach((c) => {
      this.log.info("sending start message", {
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(sharedStart + JSON.stringify(c.clientID) + "}");
      }
    });
  }

  // terron: собрать метаданные игры для персиста (роль/старт/ростер/pid-мапа).
  private buildPersistMeta(): GameMeta {
    return {
      id: this.id,
      createdAt: this.createdAt,
      visibleAt: this.visibleAt,
      startsAt: this.startsAt,
      startTime: this._startTime ?? undefined,
      creatorPersistentID: this.creatorPersistentID,
      publicGameType: this.publicGameType,
      gameConfig: this.gameConfig,
      gameStartInfo: this.gameStartInfo,
      wireGameStartInfo: this.wireGameStartInfo,
      clients: [...this.allClients.values()].map((c) => ({
        clientID: c.clientID,
        persistentID: c.persistentID,
        username: c.username,
        clanTag: c.clanTag ?? null,
        role: c.role,
        cosmetics: c.cosmetics,
        publicId: c.publicId,
        friends: c.friends,
        ip: c.ip,
        device: c.device,
        inputMode: c.inputMode,
      })),
      kickedPersistentIds: [...this.kickedPersistentIds],
    };
  }

  private persistSnapshot(): void {
    if (!persistEnabled() || !this._hasStarted) return;
    persistMeta(this.buildPersistMeta());
  }

  // terron: воскресить УЖЕ НАЧАВШУЮСЯ игру из снимка (после рестарта воркера).
  // Клиенты сами реконнектятся и догоняются по lastTurn. См. GamePersistence.
  public hydrate(meta: GameMeta, turns: Turn[]): void {
    this.visibleAt = meta.visibleAt;
    this.startsAt = meta.startsAt;
    this._startTime = meta.startTime ?? null;
    this._hasStarted = true;
    this._hasPrestarted = true;
    this.gameStartInfo = meta.gameStartInfo;
    this.wireGameStartInfo = meta.wireGameStartInfo;
    this.turns = turns;
    // один раз на резюме (не в хендлере) — дальше только конкатенация.
    this.turnJson = turns.map((t) => JSON.stringify(t));
    this.kickedPersistentIds = new Set(meta.kickedPersistentIds);
    // роутинг реконнекта: pid→clientID + стабы Client (ws заменится на rejoin).
    const deadWs = {
      readyState: 3,
      send() {},
      close() {},
      on() {},
      once() {},
      removeAllListeners() {},
    } as unknown as WebSocket;
    for (const pc of meta.clients) {
      const client = new Client(
        pc.clientID,
        pc.persistentID,
        null,
        pc.role,
        undefined,
        pc.ip,
        pc.username,
        pc.clanTag,
        deadWs,
        pc.cosmetics,
        pc.publicId,
        pc.friends,
        isDeviceKind(pc.device) ? pc.device : undefined,
      );
      const restoredMode = InputModeSchema.safeParse(pc.inputMode);
      if (restoredMode.success) client.inputMode = restoredMode.data;
      this.allClients.set(pc.clientID, client);
      this.persistentIdToClientId.set(pc.persistentID, pc.clientID);
      // все считаются отключёнными, пока не реконнектятся (rejoin снимет флаг).
      this.clientsDisconnectedStatus.set(pc.clientID, true);
    }
    this.lastPingUpdate = Date.now();
    this.emptySince = null;
    this.allDisconnectedSince = null;
    // возобновляем тик ходов — клиенты, реконнектясь, догонят пустые ходы паузы.
    this.endTurnIntervalID = setInterval(
      () => this.endTurn(),
      ServerEnv.turnIntervalMs(),
    );
    this.log.info("hydrated game from snapshot", {
      gameID: this.id,
      turns: turns.length,
      clients: meta.clients.length,
    });
  }

  private addIntent(intent: StampedIntent) {
    this.intents.push(intent);
  }

  private sendStartGameMsg(ws: WebSocket, lastTurn: number) {
    // Find which client this websocket belongs to
    const client = this.activeClients.find((c) => c.ws === ws);
    if (!client) {
      this.log.warn("Could not find client for websocket in sendStartGameMsg");
      return;
    }

    this.log.info(`Sending start message to client`, {
      clientID: client.clientID,
      lobbyCreatorID: this.lobbyCreatorID,
      isLobbyCreator: this.lobbyCreatorID === client.clientID,
    });

    try {
      if (ws.readyState !== WebSocket.OPEN) {
        this.log.warn(`WebSocket not open, skipping start message`, {
          clientID: client.clientID,
          readyState: ws.readyState,
        });
        return;
      }
      // terron ПЕРФ (21.08): ходы не сериализуем заново — склеиваем готовые
      // строки (см. turnJson). Порядок ключей = прежнему объектному литералу
      // (type, turns, gameStartInfo, lobbyCreatedAt, myClientID), поэтому
      // текст сообщения побайтово тот же; тест — tests/server/TurnSerialization.
      ws.send(
        '{"type":"start","turns":' +
          this.turnsJsonSlice(lastTurn) +
          ',"gameStartInfo":' +
          JSON.stringify(this.wireGameStartInfo) +
          ',"lobbyCreatedAt":' +
          JSON.stringify(this.createdAt) +
          ',"myClientID":' +
          JSON.stringify(client.clientID) +
          "}",
      );
    } catch (error) {
      this.log.error(`error sending start message for game ${this.id}`, {
        clientID: client.clientID,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** JSON-массив ходов начиная с lastTurn — склейка готовых строк turnJson.
   *  Эквивалентно JSON.stringify(this.turns.slice(lastTurn)). */
  private turnsJsonSlice(lastTurn: number): string {
    if (lastTurn <= 0) return "[" + this.turnJson.join(",") + "]";
    return "[" + this.turnJson.slice(lastTurn).join(",") + "]";
  }

  /** Дописать hash в уже разосланный ход, удерживая инвариант turnJson. */
  private setTurnHash(
    turnIndex: number,
    hash: number | null | undefined,
  ): void {
    const turn = this.turns[turnIndex];
    if (turn === undefined) return;
    turn.hash = hash;
    if (turnIndex < this.turnJson.length) {
      this.turnJson[turnIndex] = JSON.stringify(turn);
    }
  }

  private endTurn() {
    // Skip turn execution if game is paused
    if (this.isPaused) {
      return;
    }

    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];
    // terron ПЕРФ (21.08): ход сериализуется ОДИН раз (раньше — дважды: в
    // persistTurn и для броадкаста). Строка кладётся в turnJson и дальше
    // только склеивается. JSON сообщения равен JSON.stringify({type,turn})
    // (порядок ключей тот же) — см. tests/server/TurnSerialization.test.ts.
    const turnJson = JSON.stringify(pastTurn);
    this.turnJson.push(turnJson);
    persistTurn(this.id, turnJson); // террон: лог ходов для резюма (флаг-гейтед)

    this.handleSynchronization();
    this.checkDisconnectedStatus();

    const msg = '{"type":"turn","turn":' + turnJson + "}";
    this.activeClients.forEach((c) => {
      if (c.ws.readyState === c.ws.OPEN) {
        c.ws.send(msg);
      }
    });
  }

  async end() {
    this._hasEnded = true;
    persistDelete(this.id); // террон: игра завершена — снимок больше не нужен
    // Close all WebSocket connections
    if (this.endTurnIntervalID) {
      clearInterval(this.endTurnIntervalID);
      this.endTurnIntervalID = undefined;
    }
    // terron 21.08: таймеры лобби переживали end() — отсчёт старта мог дёрнуть
    // startPrivateWithPrestart/prestart у завершённой игры, грейс хоста — кики
    // и removePublicLobby. Гасим оба (и lobby_info-тик, пока не его очередь).
    if (this.startCountdownTimer !== null) {
      clearTimeout(this.startCountdownTimer);
      this.startCountdownTimer = null;
    }
    this.startCountdownEndsAt = null;
    if (this.hostGraceTimer !== null) {
      clearTimeout(this.hostGraceTimer);
      this.hostGraceTimer = null;
    }
    this.stopLobbyInfoBroadcast();
    this.websockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "game has ended");
      }
    });
    if (!this._hasPrestarted && !this._hasStarted) {
      this.log.info(`game not started, not archiving game`);
      return;
    }
    this.log.info(`ending game with ${this.turns.length} turns`);
    try {
      if (this.allClients.size === 0) {
        this.log.info("no clients joined, not archiving game", {
          gameID: this.id,
        });
      } else if (this.winner !== null) {
        this.log.info("game already archived", {
          gameID: this.id,
        });
      } else {
        this.archiveGame();
      }
    } catch (error) {
      let errorDetails;
      if (error instanceof Error) {
        errorDetails = {
          message: error.message,
          stack: error.stack,
        };
      } else if (Array.isArray(error)) {
        errorDetails = error; // Now we'll actually see the array contents
      } else {
        try {
          errorDetails = JSON.stringify(error, null, 2);
        } catch (e) {
          errorDetails = String(error);
        }
      }

      this.log.error("Error archiving game record details:", {
        gameId: this.id,
        errorType: typeof error,
        error: errorDetails,
      });
    }
  }

  phase(): GamePhase {
    const now = Date.now();
    const alive: Client[] = [];
    for (const client of this.activeClients) {
      if (now - client.lastPing > 60_000) {
        this.log.info("no pings received, terminating connection", {
          clientID: client.clientID,
          persistentID: client.persistentID,
        });
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close(1000, "no heartbeats received, closing connection");
        }
      } else {
        alive.push(client);
      }
    }
    this.activeClients = alive;
    if (now > this.createdAt + this.maxGameDuration) {
      this.log.warn("game past max duration", {
        gameID: this.id,
      });
      return GamePhase.Finished;
    }

    // terron: сворачиваем матч ТОЛЬКО когда живых коннектов нет дольше грейса
    // (а не по «живым игрокам»). Пока кто-то подключён — матч жив, даже если
    // игрок умер и просто смотрит за ботами.
    if (this.activeClients.length === 0) {
      this.emptySince ??= now;
    } else {
      this.emptySince = null;
    }
    const noConnectionsLongEnough =
      this.emptySince !== null && now - this.emptySince >= this.emptyGraceMs;

    if (this.gameConfig.gameType !== GameType.Public) {
      if (this._hasStarted) {
        if (noConnectionsLongEnough) {
          this.log.info("private game complete (no connections)", {
            gameID: this.id,
          });
          return GamePhase.Finished;
        } else {
          return GamePhase.Active;
        }
      } else if (this._hasEnded) {
        return GamePhase.Finished;
      } else {
        return GamePhase.Lobby;
      }
    }

    // Public Games

    const lessThanLifetime = this.startsAt ? Date.now() < this.startsAt : true;
    if (
      lessThanLifetime &&
      !this.hasStarted() &&
      !this.hasReachedMaxPlayerCount
    ) {
      return GamePhase.Lobby;
    }
    // terron: НЕ стартуем публичное лобби с 0 ЖИВЫХ игроков. Иначе конвейер
    // мастера (2 лобби/тип × 3 типа, старт через gameCreationRate) плодил
    // пул пустых игр: каждое стартовало пустым, крутило 400 ботов ~60-90с и
    // само гасло → стоячие ~12 пустых «матчей» (жгли CPU, раздували счётчик,
    // «онлайн есть — игр нет»). Пока никто не зашёл — продлеваем таймер и
    // держим как ЛОББИ; стартанёт нормальным отсчётом, когда придёт человек.
    // (Начавшиеся игры, опустевшие по ходу, идут дальше по noConnections →
    // Finished — этот гейт их не трогает, т.к. hasStarted.)
    if (!this.hasStarted() && this.activeClients.length === 0) {
      // terron: отсчёт дотикал до нуля, а лобби пустое → просим мастера сменить
      // карту. Раньше мастер ловил этот момент сам, сравнивая свои часы с
      // закэшированным startsAt — но воркер продлевает startsAt ПЕРЕД отправкой
      // lobbyList, так что мастер почти никогда не видел истёкший таймер.
      // Ротация держалась на узком окне IPC-лага и намертво вставала, стоило
      // фазе таймера сдвинуться (репорт 20.07: заход-выход в лобби → «Марс
      // висит вечно»). Теперь момент фиксирует тот, кто его знает точно.
      if (!this._wantsMapRotation) {
        this._wantsMapRotation = true;
        this._rotationAskedAt = now;
      }
      // Таймер перезаряжает ТОТ ЖЕ, кто меняет карту (мастер шлёт startsAt
      // вместе с конфигом) — иначе таймер прыгает на полный отсчёт сразу, а превью
      // догоняет следующим бродкастом, и это видно глазом. Страховка: если
      // мастер молчит дольше ROTATION_WAIT_MS (перегрузка, рестарт), таймер
      // продлеваем сами — лобби не должно залипнуть на нуле.
      // terron: у СОБЫТИЙНОГО лобби время старта — сетка расписания, а не «ещё
      // 10 секунд»: двигает его только мастер (maintainEventLobby). Иначе
      // пропущенный слот превращал золотой матч в обычную карусель и он
      // стартовал в произвольную минуту (репорт владельца 28.07).
      if (
        !this.isGolden() &&
        now - this._rotationAskedAt > GameServer.ROTATION_WAIT_MS
      ) {
        this.startsAt = now + ServerEnv.gameCreationRate();
        this._rotationAskedAt = now;
      }
      return GamePhase.Lobby;
    }
    const warmupOver = now > this.startsAt! + 30 * 1000;
    if (noConnectionsLongEnough && warmupOver) {
      return GamePhase.Finished;
    }

    return GamePhase.Active;
  }

  hasStarted(): boolean {
    return this._hasStarted || this._hasPrestarted;
  }

  public gameInfo(): GameInfo {
    const friendsFor = this.buildFriendsLookup();
    const hideClanTags = this.gameConfig.disableClanTags ?? false;
    return {
      gameID: this.id,
      clients: this.activeClients.map((c) => ({
        username: c.username,
        clanTag: hideClanTags ? null : (c.clanTag ?? null),
        clientID: c.clientID,
        flag: c.cosmetics?.flag ?? null, // terron: флаг в лобби
        friends: friendsFor(c),
      })),
      lobbyCreatorClientID: this.lobbyCreatorID,
      gameConfig: this.gameConfig,
      startsAt: this.startsAt,
      serverTime: Date.now(),
      publicGameType: this.publicGameType,
      startCountdownEndsAt: this.startCountdownEndsAt ?? undefined,
      startCountdownByHost: this.startCountdownEndsAt
        ? this.startCountdownByHost
        : undefined,
      startCountdownStarter: this.startCountdownEndsAt
        ? this.startCountdownStarter
        : undefined,
    };
  }

  // Maps each active client's publicId-based friends list to in-game
  // clientIDs, dropping friends not present in this game. Returns undefined
  // when no friends are present so the field can be omitted from the wire
  // payload.
  private buildFriendsLookup(): (client: Client) => ClientID[] | undefined {
    const publicIdToClientID = new Map<string, ClientID>();
    for (const c of this.activeClients) {
      if (c.publicId) publicIdToClientID.set(c.publicId, c.clientID);
    }
    return (client: Client) => {
      const friendClientIDs = client.friends
        .map((pid) => publicIdToClientID.get(pid))
        .filter((id): id is ClientID => id !== undefined);
      return friendClientIDs.length > 0 ? friendClientIDs : undefined;
    };
  }

  public isPublic(): boolean {
    return this.gameConfig.gameType === GameType.Public;
  }

  public kickClient(
    clientID: ClientID,
    reasonKey: string = KICK_REASON_DUPLICATE_SESSION,
  ): void {
    if (this.isKicked(clientID)) {
      this.log.warn(`cannot kick client, already kicked`, {
        clientID,
        reasonKey,
      });
      return;
    }

    const clientToKick = this.allClients.get(clientID);
    if (!clientToKick) {
      this.log.warn(`cannot kick client, not found in game`, {
        clientID,
        reasonKey,
      });
      return;
    }

    this.kickedPersistentIds.add(clientToKick.persistentID);

    const client = this.activeClients.find((c) => c.clientID === clientID);
    if (client) {
      this.log.info("Kicking client from game", {
        clientID: client.clientID,
        persistentID: client.persistentID,
        reasonKey,
      });
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(
          JSON.stringify({
            type: "error",
            error: reasonKey,
          } satisfies ServerErrorMessage),
        );
        client.ws.close(1000, reasonKey);
      }
      this.activeClients = this.activeClients.filter(
        (c) => c.clientID !== clientID,
      );
    } else {
      this.log.warn(`cannot kick client, not found in game`, {
        clientID,
        reasonKey,
      });
    }
  }

  private checkDisconnectedStatus() {
    if (this.turns.length % 5 !== 0) {
      return;
    }

    const now = Date.now();
    for (const [clientID, client] of this.allClients) {
      const isDisconnected = this.isClientDisconnected(clientID);
      if (!isDisconnected && now - client.lastPing > this.disconnectedTimeout) {
        // terron: помечаем игрока отключённым в симуляции (игровая механика),
        // но абандон-стаб в БД НЕ пишем — статистику даст финальный архив.
        this.markClientDisconnected(clientID, true);
      } else if (
        isDisconnected &&
        now - client.lastPing < this.disconnectedTimeout
      ) {
        this.markClientDisconnected(clientID, false);
      }
    }

    // terron: if every human has left a live match, end it now (don't keep a
    // bot-only game running). Stats can't be computed server-side without a
    // client, so abandons above already captured what we can.
    const allHumansDisconnected =
      this._hasStarted &&
      !this._hasEnded &&
      this.allClients.size > 0 &&
      [...this.allClients.keys()].every((id) => this.isClientDisconnected(id));
    if (allHumansDisconnected) {
      this.allDisconnectedSince ??= now;
      // Грейс: даём заблокированному/свернувшему телефон шанс вернуться (rejoin)
      // прежде чем глушить матч. Сбрасывается, как только кто-то снова на связи.
      if (now - this.allDisconnectedSince >= this.abandonGraceMs) {
        this.log.info("all humans disconnected past grace, ending game", {
          gameID: this.id,
        });
        void this.end();
      }
    } else {
      this.allDisconnectedSince = null;
    }
  }

  public isClientDisconnected(clientID: string): boolean {
    return this.clientsDisconnectedStatus.get(clientID) ?? true;
  }

  private markClientDisconnected(clientID: string, isDisconnected: boolean) {
    this.clientsDisconnectedStatus.set(clientID, isDisconnected);
    this.addIntent({
      type: "mark_disconnected",
      clientID: clientID,
      isDisconnected: isDisconnected,
    });
  }

  /** terron 01.08: снимок статистики, который прислало БОЛЬШЕ ВСЕГО клиентов.
   *  Симуляция детерминированная — у честных строки совпадают побайтово. */
  private consensusStats(): AllPlayersStats | null {
    if (this.statsByClient.size === 0) return null;
    const tally = new Map<string, number>();
    for (const raw of this.statsByClient.values()) {
      tally.set(raw, (tally.get(raw) ?? 0) + 1);
    }
    let best = "";
    let bestCount = 0;
    for (const [raw, count] of tally) {
      if (count > bestCount) {
        best = raw;
        bestCount = count;
      }
    }
    const parsed = AllPlayersStatsSchema.safeParse(JSON.parse(best));
    if (!parsed.success) {
      this.log.warn("consensus stats failed schema", { gameID: this.id });
      return null;
    }
    return parsed.data;
  }

  private archiveGame() {
    // terron: игра могла завершиться, ТАК И НЕ стартовав (напр. хост ушёл во
    // время prestart→start), тогда gameStartInfo не заполнен — архивировать
    // нечего, а `.players` на undefined роняло воркер (был краш в логах).
    if (this.gameStartInfo === undefined) {
      this.log.info("skip archiving never-started game", { gameID: this.id });
      return;
    }
    this.log.info("archiving game", {
      gameID: this.id,
      winner: this.winner?.winner,
    });

    const consensusStats = this.consensusStats();

    // Players must stay in the same order as the game start info.
    const playerRecords: PlayerRecord[] = this.gameStartInfo.players.map(
      (player) => {
        // Победный пакет — самый полный; если победителя не случилось (все
        // разошлись, матч оборвался), берём снимок большинства клиентов.
        const stats =
          this.winner?.allPlayersStats[player.clientID] ??
          consensusStats?.[player.clientID];
        if (stats === undefined) {
          this.log.warn(`Unable to find stats for clientID ${player.clientID}`);
        }
        return {
          clientID: player.clientID,
          username: player.username,
          clanTag: player.clanTag,
          persistentID:
            this.allClients.get(player.clientID)?.persistentID ?? "",
          stats,
          cosmetics: player.cosmetics,
          // terron: отключён ли к концу матча (для отметки «сбежал»).
          disconnected:
            this.clientsDisconnectedStatus.get(player.clientID) === true,
          // terron: с чего играл (значок в спидран-топе, см. Device.ts) —
          // device по UA (фолбэк), inputMode по живым тач/мышь-событиям.
          device: this.allClients.get(player.clientID)?.device,
          inputMode: this.allClients.get(player.clientID)?.inputMode,
        } satisfies PlayerRecord;
      },
    );
    // terron ПЕРФ (21.08): archive() теперь уступает event-loop до сериализации
    // (setImmediate) — за это время endTurn может дописать ход, поэтому
    // отдаём СРЕЗЫ (дешёвые, массивы ссылок/строк): запись = момент вызова,
    // как при прежнем синхронном stringify. Готовые JSON ходов идут третьим
    // аргументом — архив не сериализует десятки тысяч ходов заново.
    const turnsSnapshot = this.turns.slice();
    const turnJsonSnapshot = this.turnJson.slice();
    void archive(
      finalizeGameRecord(
        createPartialGameRecord(
          this.id,
          this.gameStartInfo.config,
          playerRecords,
          turnsSnapshot,
          this._startTime ?? 0,
          Date.now(),
          this.winner?.winner,
          this.createdAt,
          this.visibleAt,
        ),
      ),
      undefined,
      turnJsonSnapshot.length === turnsSnapshot.length
        ? turnJsonSnapshot
        : undefined,
    );
  }

  private handleSynchronization() {
    if (this.activeClients.length <= 1) {
      return;
    }
    if (this.turns.length % 10 !== 0 || this.turns.length < 10) {
      // Check hashes every 10 turns
      return;
    }

    const lastHashTurn = this.turns.length - 10;

    const { mostCommonHash, outOfSyncClients } =
      this.findOutOfSyncClients(lastHashTurn);

    // terron ПЕРФ/ПАМЯТЬ (15.08): хеши растут по записи в секунду с КАЖДОГО
    // клиента весь матч, а читается всегда ровно ОДИН ход — lastHashTurn,
    // и он монотонно растёт. Проверенное больше не нужно никому (клиент в
    // догоне после F5 шлёт старые тики — они тоже уже неинтересны). Чистим.
    // В часовом матче это ~3600 записей на клиента, которые копились зря.
    for (const client of this.activeClients) {
      for (const t of client.hashes.keys()) {
        if (t <= lastHashTurn) client.hashes.delete(t);
      }
    }

    if (outOfSyncClients.length === 0) {
      this.setTurnHash(lastHashTurn, mostCommonHash);
      return;
    }

    const serverDesync = ServerDesyncSchema.safeParse({
      type: "desync",
      turn: lastHashTurn,
      correctHash: mostCommonHash,
      clientsWithCorrectHash:
        this.activeClients.length - outOfSyncClients.length,
      totalActiveClients: this.activeClients.length,
    });
    if (!serverDesync.success) {
      this.log.warn("failed to create desync message", {
        gameID: this.id,
        error: serverDesync.error,
      });
      return;
    }

    const desyncMsg = JSON.stringify(serverDesync.data);
    for (const c of outOfSyncClients) {
      this.outOfSyncClients.add(c.clientID);
      if (this.sentDesyncMessageClients.has(c.clientID)) {
        continue;
      }
      this.sentDesyncMessageClients.add(c.clientID);
      this.log.info("sending desync to client", {
        gameID: this.id,
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(desyncMsg);
      }
    }
  }

  findOutOfSyncClients(turnNumber: number): {
    mostCommonHash: number | null;
    outOfSyncClients: Client[];
  } {
    const counts = new Map<number, number>();

    // Count occurrences of each hash
    for (const client of this.activeClients) {
      if (client.hashes.has(turnNumber)) {
        const clientHash = client.hashes.get(turnNumber)!;
        counts.set(clientHash, (counts.get(clientHash) ?? 0) + 1);
      }
    }

    // Find the most common hash
    let mostCommonHash: number | null = null;
    let maxCount = 0;

    for (const [hash, count] of counts.entries()) {
      if (count > maxCount) {
        mostCommonHash = hash;
        maxCount = count;
      }
    }

    // Create a list of clients whose hash doesn't match the most common one
    let outOfSyncClients: Client[] = [];

    for (const client of this.activeClients) {
      if (client.hashes.has(turnNumber)) {
        const clientHash = client.hashes.get(turnNumber)!;
        if (clientHash !== mostCommonHash) {
          outOfSyncClients.push(client);
        }
      }
    }

    // If strict majority clients out of sync assume all are out of sync.
    if (outOfSyncClients.length > Math.floor(this.activeClients.length / 2)) {
      outOfSyncClients = this.activeClients;
    }

    return {
      mostCommonHash,
      outOfSyncClients,
    };
  }

  private handleWinner(client: Client, clientMsg: ClientSendWinnerMessage) {
    if (
      this.outOfSyncClients.has(client.clientID) ||
      this.isKicked(client.clientID) ||
      this.winner !== null ||
      client.reportedWinner !== null
    ) {
      return;
    }
    client.reportedWinner = clientMsg.winner;

    // Add client vote (quorum by persistentID — see winnerVotes decl)
    const winnerKey = JSON.stringify(clientMsg.winner);
    if (!this.winnerVotes.has(winnerKey)) {
      this.winnerVotes.set(winnerKey, { voters: new Set(), winner: clientMsg });
    }
    const potentialWinner = this.winnerVotes.get(winnerKey)!;
    potentialWinner.voters.add(client.persistentID);

    const activeVoters = new Set(this.activeClients.map((c) => c.persistentID));

    const ratio = `${potentialWinner.voters.size}/${activeVoters.size}`;
    this.log.info(
      `received winner vote ${clientMsg.winner}, ${ratio} votes for this winner`,
      {
        clientID: client.clientID,
      },
    );

    if (potentialWinner.voters.size * 2 < activeVoters.size) {
      return;
    }

    // Vote succeeded
    this.winner = potentialWinner.winner;
    this.log.info(
      `Winner determined by ${potentialWinner.voters.size}/${activeVoters.size} active players`,
      {
        winnerKey: winnerKey,
      },
    );
    this.archiveGame();
  }
}

import { ClientEnv } from "src/client/ClientEnv";
import { z } from "zod";
import { EventBus, EventConstructor, GameEvent } from "../core/EventBus";
import {
  AllPlayers,
  GameType,
  Gold,
  PlayerID,
  Tick,
  UnitType,
} from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { PlayerView } from "../core/game/GameView";
import {
  AllPlayersStats,
  ClientDeathMessage,
  ClientHashMessage,
  ClientInputModeMessage,
  ClientIntentMessage,
  ClientJoinMessage,
  ClientMessage,
  ClientPingMessage,
  ClientRejoinMessage,
  ClientSendWinnerMessage,
  ClientStatsMessage,
  GameConfig,
  InputMode,
  Intent,
  ServerMessage,
  ServerMessageSchema,
  Winner,
} from "../core/Schemas";
import { replacer } from "../core/Util";
import { getPlayToken } from "./Auth";
import { LobbyConfig } from "./ClientGameRunner";
import { currentInputMode } from "./InputMode";
import { IntentOutbox, RELIABLE_INTENT_TYPES } from "./IntentOutbox";
import { LocalServer } from "./LocalServer";
import { syncStatus } from "./SyncStatus";

// terron: куда открывать игровой вебсокет. В вебе/деве — текущий хост (как было).
// В нативном офлайн-бандле (Capacitor, Фаза B) location.host == localhost/
// capacitor → wss://localhost мёртв, поэтому ходим на абсолютный прод-хост по
// wss. Пока приложение грузит ЖИВОЙ сайт (host уже terron.io) — ветка не
// срабатывает, поведение 1:1 как раньше. Активируется само, когда webDir
// переключим на локальный бандл.
declare const __GAME_HOST__: string | undefined;

function resolveRemoteWs(): { host: string; protocol: string } {
  // Бандл на ЧУЖОМ хостинге (Playgama и подобные): хост игры вшит при сборке,
  // потому что в адресе — домен площадки, а не наш.
  if (typeof __GAME_HOST__ === "string" && __GAME_HOST__.length > 0) {
    return { host: __GAME_HOST__, protocol: "wss:" };
  }
  const host = window.location.host;
  const isNative = !!(
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor?.isNativePlatform?.();
  const isLocalOrigin =
    /^(localhost|127\.0\.0\.1|capacitor)/i.test(host) ||
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "file:";
  if (isNative && isLocalOrigin) {
    return { host: "terron.io", protocol: "wss:" };
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return { host, protocol };
}

export class PauseGameIntentEvent implements GameEvent {
  constructor(public readonly paused: boolean) {}
}

export class SendAllianceRequestIntentEvent implements GameEvent {
  constructor(
    public readonly requestor: PlayerView,
    public readonly recipient: PlayerView,
  ) {}
}

export class SendBreakAllianceIntentEvent implements GameEvent {
  constructor(
    public readonly requestor: PlayerView,
    public readonly recipient: PlayerView,
  ) {}
}

export class SendUpgradeStructureIntentEvent implements GameEvent {
  constructor(
    public readonly unitId: number,
    public readonly unitType: UnitType,
  ) {}
}

export class SendAllianceRejectIntentEvent implements GameEvent {
  constructor(public readonly requestor: PlayerView) {}
}

export class SendAllianceExtensionIntentEvent implements GameEvent {
  constructor(public readonly recipient: PlayerView) {}
}

export class SendSpawnIntentEvent implements GameEvent {
  constructor(public readonly tile: TileRef) {}
}

export class SendAttackIntentEvent implements GameEvent {
  constructor(
    public readonly targetID: PlayerID | null,
    public readonly troops: number,
  ) {}
}

export class SendBoatAttackIntentEvent implements GameEvent {
  constructor(
    public readonly dst: TileRef,
    public readonly troops: number,
  ) {}
}

// terron: авиация — воздушная высадка десанта. Спека: airport.md
export class SendAirAssaultIntentEvent implements GameEvent {
  constructor(
    public readonly dst: TileRef,
    public readonly troops: number,
  ) {}
}

export class BuildUnitIntentEvent implements GameEvent {
  constructor(
    public readonly unit: UnitType,
    public readonly tile: TileRef,
    public readonly rocketDirectionUp?: boolean,
    // terron: ультимейты — Раскол: вложенные войска (размер флага).
    public readonly troops?: number,
    // terron 24.08: «Перенос» Шагающего города — второй тайл (куда идти).
    public readonly dstTile?: TileRef,
  ) {}
}

// terron: ультимейты-пассив (Реваншизм) — коммит выбора без постройки/пуска.
export class SendChooseUltimateIntentEvent implements GameEvent {
  constructor(public readonly unit: UnitType) {}
}

export class SendTargetPlayerIntentEvent implements GameEvent {
  constructor(public readonly targetID: PlayerID) {}
}

export class SendEmojiIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView | typeof AllPlayers,
    public readonly emoji: number,
  ) {}
}

export class SendDonateGoldIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly gold: Gold | null,
  ) {}
}

export class SendDonateTroopsIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly troops: number | null,
  ) {}
}

export class SendQuickChatEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly quickChatKey: string,
    public readonly target?: PlayerID,
  ) {}
}

export class SendEmbargoIntentEvent implements GameEvent {
  constructor(
    public readonly target: PlayerView,
    public readonly action: "start" | "stop",
  ) {}
}

export class SendEmbargoAllIntentEvent implements GameEvent {
  constructor(public readonly action: "start" | "stop") {}
}

export class SendDeleteUnitIntentEvent implements GameEvent {
  constructor(public readonly unitId: number) {}
}

export class CancelAttackIntentEvent implements GameEvent {
  constructor(public readonly attackID: string) {}
}

export class CancelBoatIntentEvent implements GameEvent {
  constructor(public readonly unitID: number) {}
}

/** terron 30.07: локального игрока съели. Несёт его итог по съеденным —
 *  сервер добавит время и попросит API начислить награду сразу. */
export class PlayerDiedEvent implements GameEvent {
  constructor(
    public readonly eatenNations: number,
    public readonly eatenPlayers: number,
  ) {}
}

export class SendWinnerEvent implements GameEvent {
  constructor(
    public readonly winner: Winner,
    public readonly allPlayersStats: AllPlayersStats,
  ) {}
}
export class SendHashEvent implements GameEvent {
  constructor(
    public readonly tick: Tick,
    public readonly hash: number,
  ) {}
}

export class MoveWarshipIntentEvent implements GameEvent {
  constructor(
    public readonly unitIds: number[],
    public readonly tile: number,
  ) {}
}

export class SendKickPlayerIntentEvent implements GameEvent {
  constructor(public readonly target: string) {}
}

export class SendClanInviteIntentEvent implements GameEvent {
  constructor(
    public readonly target: string,
    public readonly clanTag: string,
  ) {}
}

export class SendFriendRequestIntentEvent implements GameEvent {
  constructor(public readonly target: string) {}
}

export class SendPlayerReportIntentEvent implements GameEvent {
  constructor(
    public readonly target: string,
    public readonly reason: string,
  ) {}
}

// terron: запрос досье игрока (резолв clientID→slug на сервере). См. friends.md.
export class SendGetProfileIntentEvent implements GameEvent {
  constructor(public readonly target: string) {}
}

export class SendUpdateGameConfigIntentEvent implements GameEvent {
  constructor(public readonly config: Partial<GameConfig>) {}
}

export class SendStartGameEvent implements GameEvent {}

// terron: запуск/отмена отсчёта старта приватного лобби (см. lobby-chat).
export class SendRequestStartEvent implements GameEvent {}
export class SendCancelStartEvent implements GameEvent {}

export class Transport {
  private socket: WebSocket | null = null;

  private localServer: LocalServer;

  private buffer: string[] = [];
  /** terron 04.09: слить буфер интентов после первого сообщения сервера (см. onopen). */
  private flushBufferOnAck = false;
  private flushBufferAfterAck(): void {
    this.flushBufferOnAck = false;
    const s = this.socket;
    if (s === null || s.readyState !== WebSocket.OPEN) return;
    while (this.buffer.length > 0) {
      const msg = this.buffer.shift();
      if (msg === undefined) continue;
      s.send(msg);
    }
    // Приказы, отданные, пока (re)join ждал ответа, — на ТОМ ЖЕ сокете их
    // можно слать сразу. На новом сокете ждём первого хода после start
    // (см. noteServerMessage), чтобы сохранить исходный порядок с досылкой.
    if (!this.resendPending && !this.resendOnNextTurn) this.sendOutbox(false);
  }

  /** terron 12.09: приказы ждут ЭХА сервера в ходах (см. IntentOutbox). */
  private outbox = new IntentOutbox();
  private myClientID: string | null = null;
  /** Открыт новый сокет: досылка «под вопросом» — после его start-сообщения. */
  private resendPending = false;
  /** start на новом сокете пришёл: досылаем на первом ходе после него. */
  private resendOnNextTurn = false;

  private noteServerMessage(msg: ServerMessage): void {
    if (msg.type === "lobby_info") {
      this.myClientID = msg.myClientID;
      return;
    }
    if (msg.type === "start") {
      if (msg.myClientID) this.myClientID = msg.myClientID;
      if (this.outbox.size > 0) {
        for (const t of msg.turns) this.outbox.ack(t.intents, this.myClientID);
      }
      if (this.resendPending) {
        this.resendPending = false;
        this.resendOnNextTurn = true;
      }
      return;
    }
    if (msg.type === "turn") {
      if (this.outbox.size > 0) {
        this.outbox.ack(msg.turn.intents, this.myClientID);
      }
      if (this.resendOnNextTurn) {
        this.resendOnNextTurn = false;
        this.sendOutbox(true);
      }
    }
  }

  private sendOutbox(withStale: boolean): void {
    const s = this.socket;
    if (s === null || s.readyState !== WebSocket.OPEN) return;
    if (this.outbox.size === 0) return;
    const { wires, dropped } = this.outbox.take(Date.now(), withStale);
    for (const w of wires) s.send(w);
    if (wires.length > 0 || dropped > 0) {
      console.info(
        `[outbox] дослано приказов после обрыва: ${wires.length}, просрочено: ${dropped}`,
      );
    }
  }

  private onconnect: () => void;
  private onmessage: (msg: ServerMessage) => void;

  private pingInterval: number | null = null;
  public readonly isLocal: boolean;

  /**
   * terron ПЕРФ (07.08): токены отписки от шины. `EventBus.off` требует ТУ ЖЕ
   * ссылку на функцию, а подписки здесь — инлайн-стрелки, чью ссылку иначе не
   * достать. Поэтому подписываемся только через sub(): она и вешает
   * обработчик, и запоминает, как его снять (см. leaveGame).
   */
  private busSubs: Array<() => void> = [];
  private sub<T extends GameEvent>(
    type: EventConstructor<T>,
    cb: (event: T) => void,
  ): void {
    this.eventBus.on(type, cb);
    this.busSubs.push(() => this.eventBus.off(type, cb));
  }

  constructor(
    private lobbyConfig: LobbyConfig,
    private eventBus: EventBus,
  ) {
    // If gameRecord is not null, we are replaying an archived game.
    // For multiplayer games, GameConfig is not known until game starts.
    this.isLocal =
      lobbyConfig.gameRecord !== undefined ||
      lobbyConfig.gameStartInfo?.config.gameType === GameType.Singleplayer;

    this.sub(SendAllianceRequestIntentEvent, (e) =>
      this.onSendAllianceRequest(e),
    );
    this.sub(SendAllianceRejectIntentEvent, (e) =>
      this.onAllianceRejectUIEvent(e),
    );
    this.sub(SendAllianceExtensionIntentEvent, (e) =>
      this.onSendAllianceExtensionIntent(e),
    );
    this.sub(SendBreakAllianceIntentEvent, (e) =>
      this.onBreakAllianceRequestUIEvent(e),
    );
    this.sub(SendSpawnIntentEvent, (e) => this.onSendSpawnIntentEvent(e));
    this.sub(SendAttackIntentEvent, (e) => this.onSendAttackIntent(e));
    this.sub(SendUpgradeStructureIntentEvent, (e) =>
      this.onSendUpgradeStructureIntent(e),
    );
    this.sub(SendBoatAttackIntentEvent, (e) => this.onSendBoatAttackIntent(e));
    this.sub(SendAirAssaultIntentEvent, (e) => this.onSendAirAssaultIntent(e));
    this.sub(SendTargetPlayerIntentEvent, (e) =>
      this.onSendTargetPlayerIntent(e),
    );
    this.sub(SendEmojiIntentEvent, (e) => this.onSendEmojiIntent(e));
    this.sub(SendDonateGoldIntentEvent, (e) => this.onSendDonateGoldIntent(e));
    this.sub(SendDonateTroopsIntentEvent, (e) =>
      this.onSendDonateTroopIntent(e),
    );
    this.sub(SendQuickChatEvent, (e) => this.onSendQuickChatIntent(e));
    this.sub(SendEmbargoIntentEvent, (e) => this.onSendEmbargoIntent(e));
    this.sub(SendEmbargoAllIntentEvent, (e) => this.onSendEmbargoAllIntent(e));
    this.sub(BuildUnitIntentEvent, (e) => this.onBuildUnitIntent(e));
    this.sub(SendChooseUltimateIntentEvent, (e) =>
      this.onSendChooseUltimate(e),
    );

    this.sub(PauseGameIntentEvent, (e) => this.onPauseGameIntent(e));
    this.sub(SendWinnerEvent, (e) => this.onSendWinnerEvent(e));
    this.sub(PlayerDiedEvent, (e) =>
      this.sendDeath(e.eatenNations, e.eatenPlayers),
    );
    this.sub(SendHashEvent, (e) => this.onSendHashEvent(e));
    this.sub(CancelAttackIntentEvent, (e) => this.onCancelAttackIntentEvent(e));
    this.sub(CancelBoatIntentEvent, (e) => this.onCancelBoatIntentEvent(e));

    this.sub(MoveWarshipIntentEvent, (e) => {
      this.onMoveWarshipEvent(e);
    });

    this.sub(SendDeleteUnitIntentEvent, (e) => this.onSendDeleteUnitIntent(e));

    this.sub(SendKickPlayerIntentEvent, (e) => this.onSendKickPlayerIntent(e));

    this.sub(SendClanInviteIntentEvent, (e) => this.onSendClanInviteIntent(e));
    this.sub(SendFriendRequestIntentEvent, (e) =>
      this.onSendFriendRequestIntent(e),
    );
    this.sub(SendPlayerReportIntentEvent, (e) =>
      this.onSendPlayerReportIntent(e),
    );
    this.sub(SendGetProfileIntentEvent, (e) => this.onSendGetProfileIntent(e));

    this.sub(SendUpdateGameConfigIntentEvent, (e) =>
      this.onSendUpdateGameConfigIntent(e),
    );

    this.sub(SendStartGameEvent, () => this.onSendStartGame());

    this.sub(SendRequestStartEvent, () =>
      this.sendIntent({ type: "request_start" }),
    );
    this.sub(SendCancelStartEvent, () =>
      this.sendIntent({ type: "cancel_start" }),
    );
  }

  // terron 16.09: СВЁРНУТАЯ ВКЛАДКА ВЫЛЕТАЛА ИЗ ЛОББИ МОЛЧА (жалоба беты:
  // KDaniilW в алмазном лобби). Пинг шёл только таймером раз в 5 с, а Chrome
  // у вкладки, скрытой дольше 5 минут, будит такие таймеры раз в МИНУТУ —
  // ровно порог сервера «60 с без пинга» (GameServer.phase). Сервер закрывал
  // сокет кодом 1000, а onclose считал 1000 штатным закрытием и НЕ
  // переподключался: игрок исчезал из лобби, вкладка показывала лобби дальше,
  // старт матча проходил мимо. За сутки на проде так осиротели 10 из 11
  // лобби-обрывов. Лечим тремя рубежами:
  //  1) пинг ещё и на ПРИХОД сообщения сервера (lobby_info-keepalive раз в 5 с,
  //     ходы в матче) — события сокета таймерным троттлингом не режутся;
  //  2) серверное «no heartbeats» (1000) — это обрыв, переподключаемся;
  //  3) вернулся на вкладку, а сокет уже закрыт — переподключаемся сразу.
  private static readonly PING_EVERY_MS = 5 * 1000;
  private lastPingSentAt = 0;
  /** Сервер закрыл сокет НАМЕРЕННО (матч кончился, кик, игры нет) — возврат
   *  на вкладку не должен переподключать в чужое/закрытое. */
  private closedOnPurpose = false;
  private onVisibilityPing: (() => void) | null = null;

  private sendPingIfDue(): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - this.lastPingSentAt < Transport.PING_EVERY_MS) return;
    this.lastPingSentAt = now;
    this.sendMsg({
      type: "ping",
    } satisfies ClientPingMessage);
  }

  private startPing() {
    if (this.isLocal) return;
    this.pingInterval ??= window.setInterval(
      () => this.sendPingIfDue(),
      Transport.PING_EVERY_MS,
    );
    if (this.onVisibilityPing === null && typeof document !== "undefined") {
      this.onVisibilityPing = () => {
        if (document.visibilityState !== "visible") return;
        const sock = this.socket;
        if (
          sock !== null &&
          !this.closedOnPurpose &&
          (sock.readyState === WebSocket.CLOSED ||
            sock.readyState === WebSocket.CLOSING)
        ) {
          this.lastCloseCode = 4900;
          this.lastCloseReason = "closed while hidden";
          this.scheduleReconnect();
          return;
        }
        this.sendPingIfDue();
      };
      document.addEventListener("visibilitychange", this.onVisibilityPing);
    }
  }

  private stopPing() {
    if (this.pingInterval) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.onVisibilityPing !== null) {
      document.removeEventListener("visibilitychange", this.onVisibilityPing);
      this.onVisibilityPing = null;
    }
  }

  /** Сервер закрыл нас за молчание (GameServer.phase, код 1000) — это обрыв,
   *  а не штатный выход: переподключаться. Прочие 1000 («game has ended»,
   *  кики с ключом причины) — штатные. */
  static isHeartbeatDrop(code: number, reason: string): boolean {
    return code === 1000 && /heartbeat/i.test(reason || "");
  }

  public connect(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    if (this.isLocal) {
      this.connectLocal(onconnect, onmessage);
    } else {
      this.connectRemote(onconnect, onmessage);
    }
  }

  public updateCallback(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    if (this.isLocal) {
      this.localServer.updateCallback(onconnect, onmessage);
    } else {
      this.onconnect = onconnect;
      this.onmessage = onmessage;
    }
  }

  private connectLocal(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    this.localServer = new LocalServer(
      this.lobbyConfig,
      this.lobbyConfig.gameRecord !== undefined,
      this.eventBus,
      this.lobbyConfig.resumeTurns,
    );
    this.localServer.updateCallback(onconnect, onmessage);
    this.localServer.start();
  }

  private connectRemote(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    this.startPing();
    this.killExistingSocket();
    // Всё, что ушло в прежний сокет и не вернулось эхом, теперь под вопросом.
    this.outbox.newSocket();
    const { host: wsHost, protocol: wsProtocol } = resolveRemoteWs();
    const workerPath = ClientEnv.workerPath(this.lobbyConfig.gameID);
    this.socket = new WebSocket(`${wsProtocol}//${wsHost}/${workerPath}`);
    this.onconnect = onconnect;
    this.onmessage = onmessage;
    this.socket.onopen = () => {
      console.log("Connected to game server!");
      // Сокет открылся — серия обрывов кончилась, следующий обрыв снова
      // получит быструю первую попытку.
      this.reconnectAttempts = 0;
      this.closedOnPurpose = false;
      if (this.socket === null) {
        console.error("socket is null");
        return;
      }
      // terron 04.09: БУФЕР — ПОСЛЕ ПОДТВЕРЖДЕНИЯ ДЖОЙНА, А НЕ ДО НЕГО.
      // Раньше накопленные за обрыв интенты уходили в сокет ЗДЕСЬ, раньше
      // rejoin из onconnect(), и сервер отбрасывал их с «Invalid message
      // before join» (39 раз за двое суток в логе прода) — то есть действия
      // игрока, сделанные во время обрыва, терялись молча. Сливаем на первом
      // разобранном сообщении сервера после открытия: это и есть доказательство,
      // что (re)join принят (см. flushBufferOnAck в onmessage).
      // (Порядок слива по-прежнему FIFO — A1-фикс, shift() а не pop().)
      this.flushBufferOnAck = this.buffer.length > 0;
      this.resendPending = true;
      this.resendOnNextTurn = false;
      onconnect();
    };
    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data);
        const result = ServerMessageSchema.safeParse(parsed);
        if (!result.success) {
          const error = z.prettifyError(result.error);
          console.error("Error parsing server message", error);
          return;
        }
        // terron ПЕРФ/БАГ (07.08): ВЕЧНЫЙ REJOIN В МЁРТВУЮ ИГРУ.
        // Счётчик попыток сбрасывался в socket.onopen — но сокет открывается
        // УСПЕШНО, а отказ «game not found» прилетает уже после. Значит лимит в
        // три попытки не исчерпывался НИКОГДА: вкладка, забытая на завершённом
        // матче, слала rejoin каждые ~3с бесконечно (факт с прода 07.08: игра
        // 25F6JpAL заархивирована в 05:36, в 08:29 клиент всё ещё долбился —
        // 29 пар строк за 3 минуты, и каждая попытка это WS-апгрейд плюс
        // проверка JWT на сервере).
        // Сбрасываем там, где есть ДОКАЗАТЕЛЬСТВО принятого реконнекта, —
        // на первом успешно разобранном сообщении сервера. Сценарий, ради
        // которого ретраи вводились (перезапуск игрового сервера: соединения
        // уже принимает, матч из снимка ещё не поднял), закрыт по-прежнему —
        // там сервер отвечает штатно и счётчик обнуляется.
        this.goneRetries = 0;
        this.sendPingIfDue();
        if (this.flushBufferOnAck) this.flushBufferAfterAck();
        this.noteServerMessage(result.data);
        this.onmessage(result.data);
      } catch (e) {
        console.error("Error in onmessage handler:", e, event.data);
        return;
      }
    };
    this.socket.onerror = (err) => {
      console.error("Socket encountered error: ", err, "Closing socket");
      if (this.socket === null) return;
      this.socket.close();
    };
    this.socket.onclose = (event: CloseEvent) => {
      console.log(
        `WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`,
      );
      // по умолчанию закрытие считаем намеренным; ветка обрыва ниже снимает флаг
      this.closedOnPurpose = true;
      if (event.code === 1002 && this.retryGameGone(event.reason)) {
        return;
      }
      if (event.code === 1002) {
        // terron: игра не существует (закончилась / сервер перезапущен). БЕЗ
        // нативного браузерного alert — мягко уводим на главную (со страницы
        // /game/:id играть уже нечего). Флаг → главная покажет тост-причину.
        console.warn("connection refused (game gone):", event.reason);
        try {
          sessionStorage.setItem("terron-game-gone", event.reason || "1");
        } catch {
          /* ignore */
        }
        // terron (телеметрия 18.07): 14/16 «Game not found» за сутки — возврат
        // в УЖЕ ЗАВЕРШЁННЫЙ матч (вкладка спала, матч кончился и заархивирован).
        // Вместо выброса на главную грузим /game/<id> заново — checkArchivedGame
        // предложит реплей/итоги. Один заход на игру (sessionStorage-гард):
        // запись не нашлась → второй 1002 → главная, как раньше. Без цикла.
        let target = "/";
        const gid = this.lobbyConfig.gameID;
        if (gid && /not found/i.test(event.reason || "")) {
          try {
            const key = "terron-gone-redirect";
            if (sessionStorage.getItem(key) !== gid) {
              sessionStorage.setItem(key, gid);
              target = `/game/${gid}`;
            }
          } catch {
            /* приватный режим — ведём на главную */
          }
        }
        // Телеметрия: отказ сервера с ПРИЧИНОЙ (game gone / version mismatch /
        // forbidden) — серия у одного игрока = системно не пускает в онлайн.
        // toReplay — увели ли в реплей (отсечка 18.07: различаем классы).
        void import("./Health").then(({ reportHealth }) =>
          reportHealth("join_refused", event.reason || "1002", {
            gameID: gid,
            toReplay: target !== "/",
          }),
        );
        // ⚠️ ВНУТРИ ПЛОЩАДКИ БЕЗ ПЕРЕЗАГРУЗКИ. Раньше здесь был жёсткий
        // редирект — и модератор поймал ровно это: «победил, играл, и вдруг
        // выкинуло в меню с прелоадером» (перезагрузка переинициализирует их
        // SDK). Уходим мягко; вне площадки поведение прежнее.
        // softGo, а не softHome: по адресу /game/<id> Main должен ЗАНОВО его
        // разобрать (checkArchivedGame → реплей/итоги). softHome только правит
        // адрес — игрок остался бы в меню, а ссылка вела бы в никуда.
        void import("./SoftNavigate").then(({ softGo }) => softGo(target));
      } else if (
        event.code !== 1000 ||
        Transport.isHeartbeatDrop(event.code, event.reason)
      ) {
        this.closedOnPurpose = false;
        console.log(`received error code ${event.code}, reconnecting`);
        // terron 04.09: код и причина закрытия — в датчик game_reconnect, иначе
        // «обрывы» не разделить на сеть (1006), сервер (1008/1011) и наши коды.
        this.lastCloseCode = event.code;
        this.lastCloseReason = (event.reason || "").slice(0, 60);
        this.scheduleReconnect();
      }
    };
  }

  /** terron 01.08: «Game not found» ≠ «игра мертва навсегда».
   *
   *  Сервер перезапускается (деплой, падение) и поднимает свои матчи из
   *  снимков — но между «принимает соединения» и «игра восстановлена» есть
   *  окно, и клиент, попавший в него, получал 1002 и УХОДИЛ ИЗ МАТЧА
   *  насовсем. Репорт владельца 01.08: «победил, сижу строю, и бац —
   *  выкинуло в меню», ровно в момент выката дев-сборки.
   *
   *  Поэтому сперва честно ждём и пробуем вернуться (3 попытки, ~2/5/10 с);
   *  игрок видит баннер «переподключение», а не выброс. Не помогло —
   *  дальше прежний путь (реплей/итоги/меню). Считаем только этот матч:
   *  счётчик сбрасывается на успешном подключении.
   *
   *  Только для ИДУЩЕГО матча: в лобби возвращаться некуда. */
  private goneRetries = 0;
  private static readonly GONE_RETRY_DELAYS_MS = [2000, 5000, 10000];

  /** terron 04.09: РЕКОННЕКТ С ПАУЗОЙ, А НЕ В УПОР.
   *
   *  Обрыв сокета (код ≠ 1000/1002) звал reconnect() НЕМЕДЛЕННО, и любой
   *  отказ на рукопожатии (502 от прокси при пересоздании контейнера, отбитый
   *  апгрейд, мёртвая сеть) давал петлю без единой паузы: за 3 дня 1999 пар
   *  реконнектов быстрее 0.5 с, у 393 сессий ровно шесть за три секунды.
   *  При выкате все открытые вкладки долбили сервер разом, а на телефоне с
   *  провалившейся сетью батарея уходила в попытки.
   *
   *  Первая попытка по-прежнему сразу (одиночный обрыв лечится за миг), дальше
   *  250 мс × 2ⁿ с разбросом ±50 %, потолок 8 с. Счётчик сбрасывает успешное
   *  открытие сокета. Таймер гасится вместе с транспортом (leaveGame). */
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private lastCloseCode = 0;
  private lastCloseReason = "";
  private static readonly RECONNECT_BASE_MS = 250;
  private static readonly RECONNECT_MAX_MS = 8000;
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const n = this.reconnectAttempts++;
    if (n === 0) {
      this.reconnect();
      return;
    }
    const base = Math.min(
      Transport.RECONNECT_MAX_MS,
      Transport.RECONNECT_BASE_MS * 2 ** (n - 1),
    );
    const delay = Math.round(base * (0.5 + Math.random()));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnect();
    }, delay);
  }
  private cancelScheduledReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  private retryGameGone(reason: string): boolean {
    if (this.isLocal) return false;
    if (!/not found/i.test(reason || "")) return false;
    if (!this.lobbyConfig.gameID) return false;
    const delay = Transport.GONE_RETRY_DELAYS_MS[this.goneRetries];
    if (delay === undefined) return false;
    this.goneRetries++;
    console.warn(
      `game not found — попытка вернуться ${this.goneRetries}/` +
        `${Transport.GONE_RETRY_DELAYS_MS.length} через ${delay} мс`,
    );
    syncStatus("reconnecting");
    this.killExistingSocket();
    window.setTimeout(() => {
      if (this.socket !== null) return; // уже переподключились сами
      this.connect(this.onconnect, this.onmessage);
    }, delay);
    return true;
  }

  public reconnect() {
    // террон: баннер «переподключение» (кроме локального/реплей-транспорта).
    if (!this.isLocal) {
      syncStatus("reconnecting");
      // Телеметрия: реконнекты в матче (обрыв игрового сокета). Кап на тип
      // внутри reportHealth (≤5/вкладку) — реконнект-шторм не зальёт БД.
      const code = this.lastCloseCode;
      const reason = this.lastCloseReason;
      const attempt = this.reconnectAttempts;
      void import("./Health").then(({ reportHealth }) =>
        reportHealth("game_reconnect", code === 0 ? "" : `${code} ${reason}`, {
          gameID: this.lobbyConfig.gameID,
          code,
          attempt,
        }),
      );
    }
    this.connect(this.onconnect, this.onmessage);
  }

  public turnComplete() {
    if (this.isLocal) {
      this.localServer.turnComplete();
    }
  }

  async joinGame() {
    this.sendMsg({
      type: "join",
      gameID: this.lobbyConfig.gameID,
      // Note: clientID is not sent - server assigns it based on persistentID
      username: this.lobbyConfig.playerName,
      clanTag: this.lobbyConfig.playerClanTag ?? null,
      cosmetics: this.lobbyConfig.cosmetics,
      turnstileToken: this.lobbyConfig.turnstileToken,
      token: await getPlayToken(),
    } satisfies ClientJoinMessage);
    // Как и у rejoin: до первого ответа сервера всё копится в буфер.
    if (!this.isLocal) this.flushBufferOnAck = true;
  }

  async rejoinGame(lastTurn: number) {
    this.sendMsg({
      type: "rejoin",
      gameID: this.lobbyConfig.gameID,
      // Note: clientID is not sent - server looks it up from persistentID in token
      lastTurn: lastTurn,
      token: await getPlayToken(),
    } satisfies ClientRejoinMessage);
    // Всё, что уйдёт до первого ответа сервера, копится в буфер (см. onopen):
    // rejoin обрабатывается асинхронно, и сообщение сразу за ним сервер
    // считал «до джойна».
    if (!this.isLocal) this.flushBufferOnAck = true;
    // terron: повторяем «палец/мышь» — сервер мог перезапуститься и потерять
    // сигнал, а сам клиент шлёт его только при СМЕНЕ классификации.
    const mode = currentInputMode();
    if (mode !== null) this.sendInputMode(mode);
  }

  leaveGame() {
    // terron 04.09: отложенный реконнект не должен пережить транспорт.
    this.cancelScheduledReconnect();
    // terron ПЕРФ (07.08): СНЯТЬ ПОДПИСКИ С ШИНЫ. Transport вешал 35
    // обработчиков на ОБЩУЮ шину (одна на всю сессию, Main.eventBus) и не
    // снимал ни одного: после K матчей каждый интент игрока обрабатывался K
    // раз, мёртвые транспорты пытались слать в закрытые сокеты («WebSocket is
    // not open… attempting reconnect» в консоли) и держали себя живыми для GC.
    // leaveGame идемпотентен и зовётся на всех путях teardown — здесь и место.
    // ВАЖНО: до раннего return для локальной игры, иначе одиночка не чистится.
    for (const un of this.busSubs) un();
    this.busSubs.length = 0;
    if (this.isLocal) {
      this.localServer.endGame();
      return;
    }
    this.stopPing();
    if (this.socket === null) return;
    if (this.socket.readyState === WebSocket.OPEN) {
      console.log("on stop: leaving game");
      this.killExistingSocket();
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket.readyState,
      );
      console.error("attempting reconnect");
      this.killExistingSocket();
    }
  }

  private onSendAllianceRequest(event: SendAllianceRequestIntentEvent) {
    this.sendIntent({
      type: "allianceRequest",
      recipient: event.recipient.id(),
    });
  }

  private onAllianceRejectUIEvent(event: SendAllianceRejectIntentEvent) {
    this.sendIntent({
      type: "allianceReject",
      requestor: event.requestor.id(),
    });
  }

  private onBreakAllianceRequestUIEvent(event: SendBreakAllianceIntentEvent) {
    this.sendIntent({
      type: "breakAlliance",
      recipient: event.recipient.id(),
    });
  }

  private onSendAllianceExtensionIntent(
    event: SendAllianceExtensionIntentEvent,
  ) {
    this.sendIntent({
      type: "allianceExtension",
      recipient: event.recipient.id(),
    });
  }

  private onSendSpawnIntentEvent(event: SendSpawnIntentEvent) {
    this.sendIntent({
      type: "spawn",
      tile: event.tile,
    });
  }

  // terron: ультимейты-пассив (Реваншизм) — фиксация выбора ульты.
  private onSendChooseUltimate(event: SendChooseUltimateIntentEvent) {
    this.sendIntent({
      type: "choose_ultimate",
      unit: event.unit,
    });
  }

  private onSendAttackIntent(event: SendAttackIntentEvent) {
    this.sendIntent({
      type: "attack",
      targetID: event.targetID,
      troops: event.troops,
    });
  }

  private onSendBoatAttackIntent(event: SendBoatAttackIntentEvent) {
    this.sendIntent({
      type: "boat",
      troops: event.troops,
      dst: event.dst,
    });
  }

  // terron: авиация — воздушная высадка десанта. Спека: airport.md
  private onSendAirAssaultIntent(event: SendAirAssaultIntentEvent) {
    this.sendIntent({
      type: "air_assault",
      troops: event.troops,
      dst: event.dst,
    });
  }

  private onSendUpgradeStructureIntent(event: SendUpgradeStructureIntentEvent) {
    this.sendIntent({
      type: "upgrade_structure",
      unit: event.unitType,
      unitId: event.unitId,
    });
  }

  private onSendTargetPlayerIntent(event: SendTargetPlayerIntentEvent) {
    this.sendIntent({
      type: "targetPlayer",
      target: event.targetID,
    });
  }

  private onSendEmojiIntent(event: SendEmojiIntentEvent) {
    this.sendIntent({
      type: "emoji",
      recipient:
        event.recipient === AllPlayers ? AllPlayers : event.recipient.id(),
      emoji: event.emoji,
    });
  }

  private onSendDonateGoldIntent(event: SendDonateGoldIntentEvent) {
    this.sendIntent({
      type: "donate_gold",
      recipient: event.recipient.id(),
      gold: event.gold ? Number(event.gold) : null,
    });
  }

  private onSendDonateTroopIntent(event: SendDonateTroopsIntentEvent) {
    this.sendIntent({
      type: "donate_troops",
      recipient: event.recipient.id(),
      troops: event.troops,
    });
  }

  private onSendQuickChatIntent(event: SendQuickChatEvent) {
    this.sendIntent({
      type: "quick_chat",
      recipient: event.recipient.id(),
      quickChatKey: event.quickChatKey,
      target: event.target,
    });
  }

  private onSendEmbargoIntent(event: SendEmbargoIntentEvent) {
    this.sendIntent({
      type: "embargo",
      targetID: event.target.id(),
      action: event.action,
    });
  }

  private onSendEmbargoAllIntent(event: SendEmbargoAllIntentEvent) {
    this.sendIntent({
      type: "embargo_all",
      action: event.action,
    });
  }

  private onBuildUnitIntent(event: BuildUnitIntentEvent) {
    this.sendIntent({
      type: "build_unit",
      unit: event.unit,
      tile: event.tile,
      rocketDirectionUp: event.rocketDirectionUp,
      troops: event.troops,
      dstTile: event.dstTile, // terron: «Перенос» Шагающего города
    });
  }

  private onPauseGameIntent(event: PauseGameIntentEvent) {
    // Сообщаем площадке (их дока: gp.pause()/gp.resume() — точка управления
    // рекламой и аналитикой). Их собственные pause/resume мы уже слушаем,
    // так что канал теперь двусторонний.
    void import("./PlatformHost").then(({ Host }) =>
      Host.reportPause(event.paused),
    );
    this.sendIntent({
      type: "toggle_pause",
      paused: event.paused,
    });
  }

  private onSendWinnerEvent(event: SendWinnerEvent) {
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg({
        type: "winner",
        winner: event.winner,
        allPlayersStats: event.allPlayersStats,
      } satisfies ClientSendWinnerMessage);
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket?.readyState,
      );
      console.log("attempting reconnect");
    }
  }

  /** terron 30.07: «меня съели» — итог игрока окончателен, награду можно
   *  начислять сразу, не дожидаясь конца чужой партии. Шлём один раз. */
  sendDeath(eatenNations: number, eatenPlayers: number): void {
    if (this.deathSent) return;
    this.deathSent = true;
    if (!this.isLocal && this.socket?.readyState !== WebSocket.OPEN) return;
    this.sendMsg({
      type: "death",
      eatenNations,
      eatenPlayers,
    } satisfies ClientDeathMessage);
  }
  private deathSent = false;

  /** terron 01.08: снимок статистики всех игроков (раз в ~30 с из симуляции).
   *  Нужен архиву матчей, которые кончаются БЕЗ победителя — см.
   *  ClientStatsSchema. Шлём только по живому сокету, молча пропускаем иначе. */
  sendStatsSnapshot(allPlayersStats: AllPlayersStats): void {
    if (!this.isLocal && this.socket?.readyState !== WebSocket.OPEN) return;
    this.sendMsg({
      type: "stats",
      allPlayersStats,
    } satisfies ClientStatsMessage);
  }

  // terron: «играю пальцем / мышью» (client/InputMode.ts). Зовётся только на
  // СМЕНУ классификации, поэтому за матч это 1-3 сообщения. Если сокет не
  // готов — молча пропускаем: сигнал справочный, реконнект-буфер им забивать
  // незачем, следующая смена (или следующий матч) донесёт.
  public sendInputMode(mode: InputMode) {
    const msg = { type: "input_mode", mode } satisfies ClientInputModeMessage;
    // terron 04.09: пока (re)join не подтверждён сервером, сообщение ждёт в
    // буфере — иначе оно обгоняло проверку токена на сервере и падало в лог
    // «Invalid message before join» (47 раз за 3 часа на проде, всё input_mode).
    if (!this.isLocal && this.flushBufferOnAck) {
      this.buffer.push(JSON.stringify(msg, replacer));
      return;
    }
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg(msg);
    }
  }

  private onSendHashEvent(event: SendHashEvent) {
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg({
        type: "hash",
        turnNumber: event.tick,
        hash: event.hash,
      } satisfies ClientHashMessage);
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket?.readyState,
      );
      console.log("attempting reconnect");
    }
  }

  private onCancelAttackIntentEvent(event: CancelAttackIntentEvent) {
    this.sendIntent({
      type: "cancel_attack",
      attackID: event.attackID,
    });
  }

  private onCancelBoatIntentEvent(event: CancelBoatIntentEvent) {
    this.sendIntent({
      type: "cancel_boat",
      unitID: event.unitID,
    });
  }

  private onMoveWarshipEvent(event: MoveWarshipIntentEvent) {
    this.sendIntent({
      type: "move_warship",
      unitIds: event.unitIds,
      tile: event.tile,
    });
  }

  private onSendDeleteUnitIntent(event: SendDeleteUnitIntentEvent) {
    this.sendIntent({
      type: "delete_unit",
      unitId: event.unitId,
    });
  }

  private onSendKickPlayerIntent(event: SendKickPlayerIntentEvent) {
    this.sendIntent({
      type: "kick_player",
      target: event.target,
    });
  }

  private onSendClanInviteIntent(event: SendClanInviteIntentEvent) {
    this.sendIntent({
      type: "clan_invite",
      target: event.target,
      clanTag: event.clanTag,
    });
  }

  private onSendFriendRequestIntent(event: SendFriendRequestIntentEvent) {
    this.sendIntent({
      type: "friend_request",
      target: event.target,
    });
  }

  private onSendGetProfileIntent(event: SendGetProfileIntentEvent) {
    this.sendIntent({
      type: "get_profile",
      target: event.target,
    });
  }

  private onSendPlayerReportIntent(event: SendPlayerReportIntentEvent) {
    this.sendIntent({
      type: "player_report",
      target: event.target,
      reason: event.reason,
    });
  }

  // terron 04.09: второй рубеж от шторма конфига (первый — коалесцер в
  // HostLobbyModal.putGameConfig). Тот же конфиг, что ушёл меньше секунды назад,
  // повторно не шлём: сервер всё равно ничего не поменял бы, а лимит интентов
  // (10/с) он тратит и режет им НАСТОЯЩИЕ действия хоста.
  private lastConfigJson = "";
  private lastConfigSentAt = 0;
  private onSendUpdateGameConfigIntent(event: SendUpdateGameConfigIntentEvent) {
    const json = JSON.stringify(event.config, replacer);
    const now = Date.now();
    if (json === this.lastConfigJson && now - this.lastConfigSentAt < 1000) {
      return;
    }
    this.lastConfigJson = json;
    this.lastConfigSentAt = now;
    this.sendIntent({
      type: "update_game_config",
      config: event.config,
    });
  }

  private onSendStartGame() {
    this.sendIntent({ type: "start_game" });
  }

  private sendIntent(intent: Intent) {
    // terron 12.09: ИГРОВОЙ ПРИКАЗ БЕЗ СВЯЗИ НЕ ВЫБРАСЫВАЕМ. Раньше при закрытом
    // сокете эта функция печатала «WebSocket is not open» и теряла приказ —
    // буфер до подтверждения джойна (04.09) жил в sendMsg, куда приказы не
    // доходили. Теперь каждый игровой приказ ждёт эха сервера в ходах, а без
    // связи — переподключения (см. IntentOutbox). Проверено тестом владельца
    // на деве 12.09: атака, отданная без Wi-Fi, пропадала.
    if (!this.isLocal && RELIABLE_INTENT_TYPES.has(intent.type)) {
      const wire = JSON.stringify(
        { type: "intent", intent } satisfies ClientIntentMessage,
        replacer,
      );
      const s = this.socket;
      const live =
        s !== null &&
        s.readyState === WebSocket.OPEN &&
        !this.flushBufferOnAck &&
        !this.resendOnNextTurn;
      this.outbox.track(intent, wire, Date.now(), live);
      if (live) {
        s.send(wire);
        return;
      }
      console.info(
        `[outbox] нет связи — приказ ${intent.type} ждёт переподключения`,
      );
      if (
        s === null ||
        s.readyState === WebSocket.CLOSED ||
        s.readyState === WebSocket.CLOSING
      ) {
        this.scheduleReconnect();
      }
      return;
    }
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      const msg = {
        type: "intent",
        intent: intent,
      } satisfies ClientIntentMessage;
      this.sendMsg(msg);
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket?.readyState,
      );
      console.log("attempting reconnect");
    }
  }

  private sendMsg(msg: ClientMessage) {
    if (this.isLocal) {
      // Forward message to local server
      this.localServer.onMessage(msg);
      return;
    } else if (this.socket === null) {
      // Socket missing, do nothing
      return;
    }
    const str = JSON.stringify(msg, replacer);
    // terron 04.09: CONNECTING/CLOSING — тоже «не открыт»: send() на таком
    // сокете бросает InvalidStateError. Копим в буфер, он сольётся после (re)join.
    if (this.socket.readyState === WebSocket.CONNECTING) {
      this.buffer.push(str);
      return;
    }
    if (
      this.socket.readyState === WebSocket.CLOSED ||
      this.socket.readyState === WebSocket.CLOSING
    ) {
      // Buffer message
      console.warn("socket not ready, closing and trying later");
      this.socket.close();
      this.socket = null;
      // terron 04.09: раньше КАЖДОЕ сообщение на закрытом сокете само звало
      // connectRemote — вторая петля рядом с onclose. Теперь через тот же
      // планировщик с паузой; буфер сольётся на открытии.
      this.buffer.push(str);
      this.scheduleReconnect();
    } else if (
      this.flushBufferOnAck &&
      msg.type !== "join" &&
      msg.type !== "rejoin" &&
      msg.type !== "ping"
    ) {
      // terron 28.09: сокет открыт, но (re)join ещё не подтверждён сервером —
      // всё, кроме самого джойна, ждёт в буфере (сольётся на первом ответе,
      // flushBufferAfterAck). Раньше сюда проскакивали hash и неигровые
      // приказы (старт и пауза хоста, кик): сервер отбрасывал их с «Invalid
      // message before join» — 105 hash и 8 «старт» за сутки на проде, то есть
      // нажатие хоста во время переподключения терялось молча. input_mode
      // буферился так же ещё с 04.09, теперь правило общее.
      this.buffer.push(str);
    } else {
      // Send the message directly
      this.socket.send(str);
    }
  }

  private killExistingSocket(): void {
    if (this.socket === null) {
      return;
    }
    // Remove all event listeners
    this.socket.onmessage = null;
    this.socket.onopen = null;
    this.socket.onclose = null;
    this.socket.onerror = null;

    // Close the connection if it's still open or still connecting
    try {
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close();
      }
    } catch (e) {
      console.warn("Error while closing WebSocket:", e);
    }

    this.socket = null;
  }
}

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
import { LocalServer } from "./LocalServer";
import { syncStatus } from "./SyncStatus";

// terron: куда открывать игровой вебсокет. В вебе/деве — текущий хост (как было).
// В нативном офлайн-бандле (Capacitor, Фаза B) location.host == localhost/
// capacitor → wss://localhost мёртв, поэтому ходим на абсолютный прод-хост по
// wss. Пока приложение грузит ЖИВОЙ сайт (host уже terron.io) — ветка не
// срабатывает, поведение 1:1 как раньше. Активируется само, когда webDir
// переключим на локальный бандл.
function resolveRemoteWs(): { host: string; protocol: string } {
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
    this.sub(SendSpawnIntentEvent, (e) =>
      this.onSendSpawnIntentEvent(e),
    );
    this.sub(SendAttackIntentEvent, (e) => this.onSendAttackIntent(e));
    this.sub(SendUpgradeStructureIntentEvent, (e) =>
      this.onSendUpgradeStructureIntent(e),
    );
    this.sub(SendBoatAttackIntentEvent, (e) =>
      this.onSendBoatAttackIntent(e),
    );
    this.sub(SendAirAssaultIntentEvent, (e) =>
      this.onSendAirAssaultIntent(e),
    );
    this.sub(SendTargetPlayerIntentEvent, (e) =>
      this.onSendTargetPlayerIntent(e),
    );
    this.sub(SendEmojiIntentEvent, (e) => this.onSendEmojiIntent(e));
    this.sub(SendDonateGoldIntentEvent, (e) =>
      this.onSendDonateGoldIntent(e),
    );
    this.sub(SendDonateTroopsIntentEvent, (e) =>
      this.onSendDonateTroopIntent(e),
    );
    this.sub(SendQuickChatEvent, (e) => this.onSendQuickChatIntent(e));
    this.sub(SendEmbargoIntentEvent, (e) =>
      this.onSendEmbargoIntent(e),
    );
    this.sub(SendEmbargoAllIntentEvent, (e) =>
      this.onSendEmbargoAllIntent(e),
    );
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
    this.sub(CancelAttackIntentEvent, (e) =>
      this.onCancelAttackIntentEvent(e),
    );
    this.sub(CancelBoatIntentEvent, (e) =>
      this.onCancelBoatIntentEvent(e),
    );

    this.sub(MoveWarshipIntentEvent, (e) => {
      this.onMoveWarshipEvent(e);
    });

    this.sub(SendDeleteUnitIntentEvent, (e) =>
      this.onSendDeleteUnitIntent(e),
    );

    this.sub(SendKickPlayerIntentEvent, (e) =>
      this.onSendKickPlayerIntent(e),
    );

    this.sub(SendClanInviteIntentEvent, (e) =>
      this.onSendClanInviteIntent(e),
    );
    this.sub(SendFriendRequestIntentEvent, (e) =>
      this.onSendFriendRequestIntent(e),
    );
    this.sub(SendPlayerReportIntentEvent, (e) =>
      this.onSendPlayerReportIntent(e),
    );
    this.sub(SendGetProfileIntentEvent, (e) =>
      this.onSendGetProfileIntent(e),
    );

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

  private startPing() {
    if (this.isLocal) return;
    this.pingInterval ??= window.setInterval(() => {
      if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
        this.sendMsg({
          type: "ping",
        } satisfies ClientPingMessage);
      }
    }, 5 * 1000);
  }

  private stopPing() {
    if (this.pingInterval) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
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
    const { host: wsHost, protocol: wsProtocol } = resolveRemoteWs();
    const workerPath = ClientEnv.workerPath(this.lobbyConfig.gameID);
    this.socket = new WebSocket(`${wsProtocol}//${wsHost}/${workerPath}`);
    this.onconnect = onconnect;
    this.onmessage = onmessage;
    this.socket.onopen = () => {
      console.log("Connected to game server!");
      if (this.socket === null) {
        console.error("socket is null");
        return;
      }
      // terron A1-фикс: буфер копится push()-ем (FIFO), сливать надо тем же
      // порядком — shift(), а не pop() (LIFO). Иначе интенты, накопленные за
      // обрыв связи, переигрывались в ОБРАТНОМ порядке → рассинхрон при реконнекте.
      while (this.buffer.length > 0) {
        console.log("sending dropped message");
        const msg = this.buffer.shift();
        if (msg === undefined) {
          console.warn("msg is undefined");
          continue;
        }
        this.socket.send(msg);
      }
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
      } else if (event.code !== 1000) {
        console.log(`received error code ${event.code}, reconnecting`);
        this.reconnect();
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
      void import("./Health").then(({ reportHealth }) =>
        reportHealth("game_reconnect", "", { gameID: this.lobbyConfig.gameID }),
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
  }

  async rejoinGame(lastTurn: number) {
    this.sendMsg({
      type: "rejoin",
      gameID: this.lobbyConfig.gameID,
      // Note: clientID is not sent - server looks it up from persistentID in token
      lastTurn: lastTurn,
      token: await getPlayToken(),
    } satisfies ClientRejoinMessage);
    // terron: повторяем «палец/мышь» — сервер мог перезапуститься и потерять
    // сигнал, а сам клиент шлёт его только при СМЕНЕ классификации.
    const mode = currentInputMode();
    if (mode !== null) this.sendInputMode(mode);
  }

  leaveGame() {
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
    void import("./GamePushSDK").then(({ GamePushSDK }) =>
      GamePushSDK.reportPause(event.paused),
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
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg({
        type: "input_mode",
        mode,
      } satisfies ClientInputModeMessage);
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

  private onSendUpdateGameConfigIntent(event: SendUpdateGameConfigIntentEvent) {
    this.sendIntent({
      type: "update_game_config",
      config: event.config,
    });
  }

  private onSendStartGame() {
    this.sendIntent({ type: "start_game" });
  }

  private sendIntent(intent: Intent) {
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
    if (this.socket.readyState === WebSocket.CLOSED) {
      // Buffer message
      console.warn("socket not ready, closing and trying later");
      this.socket.close();
      this.socket = null;
      this.connectRemote(this.onconnect, this.onmessage);
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

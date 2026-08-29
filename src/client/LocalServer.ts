import { ClientEnv } from "src/client/ClientEnv";
import { z } from "zod";
import { EventBus } from "../core/EventBus";
import {
  AllPlayersStats,
  ClientID,
  ClientMessage,
  ClientSendWinnerMessage,
  PartialGameRecordSchema,
  PlayerRecord,
  ServerMessage,
  ServerStartGameMessage,
  StampedIntent,
  Turn,
} from "../core/Schemas";
import {
  createPartialGameRecord,
  decompressGameRecord,
  replacer,
} from "../core/Util";
import { GameType, UnitType } from "../core/game/Game";
import { getPersistentID, getPlayToken } from "./Auth";
import { LobbyConfig } from "./ClientGameRunner";
import { disabledUltsSync } from "./DisabledUlts";
import {
  GameSpeedDownIntentEvent,
  GameSpeedUpIntentEvent,
  ReplaySpeedChangeEvent,
} from "./InputHandler";
import { deleteLocalGame, saveLocalGame } from "./LocalGameStore";
import { isTestGroundActive } from "./TestGround";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "./utilities/ReplaySpeedMultiplier";

// Order: 0.5, 1, 2, max (same as ReplayPanel)
const SPEED_ORDER: ReplaySpeedMultiplier[] = [
  ReplaySpeedMultiplier.slow,
  ReplaySpeedMultiplier.normal,
  ReplaySpeedMultiplier.fast,
  ReplaySpeedMultiplier.fastest,
];

// build a small backlog so MAX can catch up.
const MAX_REPLAY_BACKLOG_TURNS = 60;

export class LocalServer {
  // All turns from the game record on replay.
  private replayTurns: Turn[] = [];

  private turns: Turn[] = [];

  private intents: StampedIntent[] = [];
  private startedAt: number;

  private paused = false;
  // terron 24.08 (просьба владельца «ставь на тесте базовую скорость игры
  // ×2»): на полигоне игра идёт вдвое быстрее с первого тика — там проверяют
  // механики, а не сидят в реальном времени. Множитель это ИНТЕРВАЛ ХОДА,
  // поэтому «вдвое быстрее» = 0.5 (ReplaySpeedMultiplier.fast).
  private replaySpeedMultiplier = isTestGroundActive()
    ? ReplaySpeedMultiplier.fast
    : defaultReplaySpeedMultiplier;

  private clientID: ClientID | undefined;
  private winner: ClientSendWinnerMessage | null = null;
  private allPlayersStats: AllPlayersStats = {};

  private turnsExecuted = 0;
  private turnStartTime = 0;

  private turnCheckInterval: NodeJS.Timeout;
  private clientConnect: () => void;
  private clientMessage: (message: ServerMessage) => void;

  // terron 20.07: ходы уже сыгранной части матча (F5-резюм из IndexedDB).
  // Пусто на свежем старте. См. LocalGameStore + start()/persist().
  private resumeTurns: Turn[];
  // Персист локалки дорог только по объёму (сотни КБ), поэтому не каждый ход, а
  // раз в PERSIST_EVERY ходов — теряется максимум пара секунд игры при F5.
  private static readonly PERSIST_EVERY = 20;

  constructor(
    private lobbyConfig: LobbyConfig,
    private isReplay: boolean,
    private eventBus: EventBus,
    resumeTurns?: Turn[],
  ) {
    this.resumeTurns = resumeTurns ?? [];
  }

  // Матч, который ИМЕЕТ смысл персистить: локальная одиночка/офлайн, не реплей.
  private get isPersistable(): boolean {
    return (
      !this.isReplay &&
      !this.lobbyConfig.gameRecord &&
      this.lobbyConfig.gameStartInfo?.config.gameType === GameType.Singleplayer
    );
  }

  // Сбросить снапшот матча в IndexedDB (F5-резюм). Fire-and-forget: ошибки
  // хранилища не должны трогать игру.
  private persist(): void {
    if (!this.isPersistable) return;
    const info = this.lobbyConfig.gameStartInfo;
    if (!info) return;
    void saveLocalGame({
      gameID: info.gameID,
      gameStartInfo: info,
      // Копия ссылки на массив — IndexedDB структурно клонирует при записи,
      // так что последующие push в this.turns снапшот не портят.
      turns: this.turns,
      playerName: this.lobbyConfig.playerName,
      playerClanTag: this.lobbyConfig.playerClanTag ?? null,
      savedAt: Date.now(),
    });
  }

  public updateCallback(
    clientConnect: () => void,
    clientMessage: (message: ServerMessage) => void,
  ) {
    this.clientConnect = clientConnect;
    this.clientMessage = clientMessage;
  }

  start() {
    console.log("local server starting");
    // terron 24.08: рубильник раскатки ульт действует и на ЛОКАЛЬНЫЕ игры
    // (одиночка/офлайн/полигон): онлайн-лобби гейтит сервер, а здесь конфиг
    // собирает клиент — подмешиваем кэшированный список из /api/version.
    // Реплеи НЕ трогаем: их сим обязан идти на конфиге записи.
    if (!this.isReplay && !this.lobbyConfig.gameRecord) {
      const cfg = this.lobbyConfig.gameStartInfo?.config;
      if (cfg) {
        const valid = new Set<string>(Object.values(UnitType));
        const forced = disabledUltsSync().filter((u) => valid.has(u));
        if (forced.length > 0) {
          const cur = cfg.disabledUnits ?? [];
          const add = forced.filter(
            (u) => !cur.includes(u as UnitType),
          ) as UnitType[];
          if (add.length > 0) cfg.disabledUnits = [...cur, ...add];
        }
      }
    }
    this.turnCheckInterval = setInterval(() => {
      const turnIntervalMs =
        ClientEnv.turnIntervalMs() * this.replaySpeedMultiplier;
      const backlog = Math.max(0, this.turns.length - this.turnsExecuted);
      const allowReplayBacklog =
        this.replaySpeedMultiplier === ReplaySpeedMultiplier.fastest &&
        this.lobbyConfig.gameRecord !== undefined;
      const maxBacklog = allowReplayBacklog ? MAX_REPLAY_BACKLOG_TURNS : 0;

      const canQueueNextTurn =
        backlog === 0 || (maxBacklog > 0 && backlog < maxBacklog);
      if (
        canQueueNextTurn &&
        Date.now() > this.turnStartTime + turnIntervalMs
      ) {
        this.turnStartTime = Date.now();
        // End turn on the server means the client will start processing the turn.
        this.endTurn();
      }
    }, 5);

    this.eventBus.on(ReplaySpeedChangeEvent, (event) => {
      this.replaySpeedMultiplier = event.replaySpeedMultiplier;
    });

    if (!this.isReplay) {
      this.eventBus.on(GameSpeedUpIntentEvent, () => {
        const idx = SPEED_ORDER.indexOf(this.replaySpeedMultiplier);
        if (idx < 0 || idx >= SPEED_ORDER.length - 1) return;
        this.replaySpeedMultiplier = SPEED_ORDER[idx + 1];
        this.eventBus.emit(
          new ReplaySpeedChangeEvent(this.replaySpeedMultiplier),
        );
      });

      this.eventBus.on(GameSpeedDownIntentEvent, () => {
        const idx = SPEED_ORDER.indexOf(this.replaySpeedMultiplier);
        if (idx <= 0) return;
        this.replaySpeedMultiplier = SPEED_ORDER[idx - 1];
        this.eventBus.emit(
          new ReplaySpeedChangeEvent(this.replaySpeedMultiplier),
        );
      });
    }

    this.startedAt = Date.now();
    this.clientConnect();
    if (this.lobbyConfig.gameRecord) {
      this.replayTurns = decompressGameRecord(
        this.lobbyConfig.gameRecord,
      ).turns;
    }
    if (this.lobbyConfig.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    this.clientID = this.lobbyConfig.gameStartInfo.players[0]?.clientID;
    if (!this.clientID) {
      throw new Error("missing clientID");
    }
    // terron 20.07: F5-резюм. Отдаём клиенту уже сыгранные ходы тем же «start»
    // с непустым turns, каким сервер догоняет онлайн-реконнект — клиент их
    // детерминированно прогонит (восстановит мир), а turnCheckInterval выше не
    // выпустит НОВЫЙ ход, пока backlog не съеден (canQueueNextTurn при
    // backlog>0 = false). Дальше живая игра продолжается с this.turns.length.
    if (this.resumeTurns.length > 0) {
      this.turns = this.resumeTurns;
      const n = this.resumeTurns.length;
      void import("./Health").then(({ reportHealth }) =>
        reportHealth("local_resume", `${n} ходов`),
      );
    }
    this.clientMessage({
      type: "start",
      gameStartInfo: this.lobbyConfig.gameStartInfo,
      turns: this.turns,
      lobbyCreatedAt: this.lobbyConfig.gameStartInfo.lobbyCreatedAt,
      // Don't send myClientID for replays — viewer has no player identity.
      myClientID: this.lobbyConfig.gameRecord ? undefined : this.clientID,
    } satisfies ServerStartGameMessage);
  }

  onMessage(clientMsg: ClientMessage) {
    if (clientMsg.type === "rejoin") {
      if (!this.clientID) {
        throw new Error("missing clientID");
      }
      this.clientMessage({
        type: "start",
        gameStartInfo: this.lobbyConfig.gameStartInfo!,
        turns: this.turns,
        lobbyCreatedAt: this.lobbyConfig.gameStartInfo!.lobbyCreatedAt,
        myClientID: this.lobbyConfig.gameRecord ? undefined : this.clientID,
      } satisfies ServerStartGameMessage);
    }
    if (clientMsg.type === "intent") {
      // Server stamps clientID - client doesn't send it
      const stampedIntent = {
        ...clientMsg.intent,
        clientID: this.clientID!,
      };
      if (stampedIntent.type === "toggle_pause") {
        if (stampedIntent.paused) {
          // Pausing: add intent and end turn before pause takes effect
          this.intents.push(stampedIntent);
          this.endTurn();
          this.paused = true;
        } else {
          // Unpausing: clear pause flag before adding intent so next turn can execute
          this.paused = false;
          this.intents.push(stampedIntent);
          this.endTurn();
        }
        return;
      }
      // Don't process non-pause intents during replays or while paused
      if (this.lobbyConfig.gameRecord || this.paused) {
        return;
      }

      this.intents.push(stampedIntent);
    }
    if (clientMsg.type === "hash") {
      if (!this.lobbyConfig.gameRecord) {
        if (clientMsg.turnNumber % 100 === 0) {
          // In singleplayer, only store hash every 100 turns to reduce size of game record.
          const turn = this.turns[clientMsg.turnNumber];
          if (turn) {
            turn.hash = clientMsg.hash;
          }
        }
        return;
      }
      // If we are replaying a game then verify hash.
      // terron: гард (телеметрия 17.07, js_error «reading 'hash'»): в обрезанной/
      // битой записи хода с таким номером может не быть — не роняем реплей.
      const archivedHash = this.replayTurns[clientMsg.turnNumber]?.hash;
      if (!archivedHash) {
        console.warn(
          `no archived hash found for turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}`,
        );
        return;
      }
      if (archivedHash !== clientMsg.hash) {
        console.error(
          `desync detected on turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}, server hash: ${archivedHash}`,
        );
        this.clientMessage({
          type: "desync",
          turn: clientMsg.turnNumber,
          correctHash: archivedHash,
          clientsWithCorrectHash: 0,
          totalActiveClients: 1,
          yourHash: clientMsg.hash,
        });
      } else {
        console.log(
          `hash verified on turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}, server hash: ${archivedHash}`,
        );
      }
    }
    if (clientMsg.type === "winner") {
      this.winner = clientMsg;
      this.allPlayersStats = clientMsg.allPlayersStats;
    }
  }

  // This is so the client can tell us when it finished processing the turn.
  public turnComplete() {
    this.turnsExecuted++;
  }

  // endTurn in this context means the server has collected all the intents
  // and will send the turn to the client.
  private endTurn() {
    if (this.paused) {
      return;
    }
    if (this.replayTurns.length > 0) {
      if (this.turns.length >= this.replayTurns.length) {
        this.endGame();
        return;
      }
      this.intents = this.replayTurns[this.turns.length].intents;
    }
    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];
    this.clientMessage({
      type: "turn",
      turn: pastTurn,
    });
    // terron 20.07: сброс снапшота в IndexedDB раз в PERSIST_EVERY ходов (F5-
    // резюм). ⚠️ ПЕРВЫЕ ходы пишем КАЖДЫЙ (n<=5), дальше раз в PERSIST_EVERY:
    // иначе ранний F5 (первые ~2с, а при лагах и дольше) не находил записи и
    // кидал на главную — репорт владельца 21.07 «офлайн F5 → главная». Малые
    // ранние записи копеечные; при F5 теряется максимум пара секунд игры.
    // Во время реплея НЕ трогаем (isPersistable).
    const n = this.turns.length;
    if (n <= 5 || n % LocalServer.PERSIST_EVERY === 0) {
      this.persist();
    }
  }

  public endGame() {
    console.log("local server ending game");
    clearInterval(this.turnCheckInterval);
    if (this.isReplay) {
      return;
    }
    const players: PlayerRecord[] = [
      {
        persistentID: getPersistentID(),
        username: this.lobbyConfig.playerName,
        clanTag: this.lobbyConfig.playerClanTag ?? null,
        clientID: this.clientID!,
        stats: this.allPlayersStats[this.clientID!],
        cosmetics: this.lobbyConfig.gameStartInfo?.players[0].cosmetics,
      },
    ];
    if (this.lobbyConfig.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    const record = createPartialGameRecord(
      this.lobbyConfig.gameStartInfo.gameID,
      this.lobbyConfig.gameStartInfo.config,
      players,
      this.turns,
      this.startedAt,
      Date.now(),
      this.winner?.winner,
    );

    const result = PartialGameRecordSchema.safeParse(record);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Error parsing game record", error);
      return;
    }
    const workerPath = ClientEnv.workerPath(
      this.lobbyConfig.gameStartInfo.gameID,
    );

    const jsonString = JSON.stringify(result.data, replacer);

    Promise.all([compress(jsonString), getPlayToken()])
      .then(([compressedData, token]) => {
        return fetch(`/${workerPath}/api/archive_singleplayer_game`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
            // SECURITY (C3): сервер требует токен и сверяет persistentID игрока
            // с sub токена перед архивацией/начислением.
            Authorization: `Bearer ${token}`,
          },
          body: compressedData,
          keepalive: true, // Ensures request completes even if page unloads
        });
      })
      .then((res) => {
        // terron 20.07: локальную копию (F5-резюм) убираем ТОЛЬКО когда матч
        // РЕАЛЬНО завершён (есть победитель) И архив подтверждён. endGame()
        // зовётся и при выходе/перезагрузке ПОСРЕДИ игры (leaveGame →
        // архивируется незаконченная партия) — вот там запись обязана выжить,
        // иначе F5 нечего резюмить (ловля дева 20.07: запись стиралась на
        // reload). Не завершён / архив не подтвердился → запись живёт, prune
        // уберёт её через сутки, а до тех пор /game/<id> резюмится.
        if (
          res?.ok &&
          this.winner != null &&
          this.isPersistable &&
          this.lobbyConfig.gameStartInfo
        ) {
          void deleteLocalGame(this.lobbyConfig.gameStartInfo.gameID);
        }
      })
      .catch((error) => {
        console.error("Failed to archive singleplayer game:", error);
      });
  }
}

async function compress(data: string): Promise<ArrayBuffer> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  // Write the data to the compression stream
  writer.write(new TextEncoder().encode(data));
  writer.close();

  // Read the compressed data
  const chunks: Uint8Array[] = [];
  let done = false;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (value) {
      chunks.push(value);
    }
  }

  // Combine all chunks into a single Uint8Array
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const compressedData = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressedData.set(chunk, offset);
    offset += chunk.length;
  }

  return compressedData.buffer;
}

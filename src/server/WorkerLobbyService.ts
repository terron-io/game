import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import {
  PublicGameInfo,
  PublicGames,
  PublicLobbyMessage,
} from "../core/Schemas";
import { GameManager } from "./GameManager";
import {
  MasterMessageSchema,
  WorkerLobbyList,
  WorkerReady,
} from "./IPCBridgeSchema";
import { logger } from "./Logger";

export class WorkerLobbyService {
  private readonly lobbiesWss: WebSocketServer;
  private readonly lobbyClients: Set<WebSocket> = new Set();
  // Most recent snapshot from master, serialized on demand for new
  // connections so they don't have to wait for the next broadcast.
  private lastPublicGames: PublicGames | null = null;
  // Sorted gameIDs of the last full we broadcast, or null if we've never
  // broadcast one. When the set changes we send a fresh full; otherwise a
  // counts-only delta is enough. This relies on master creating a new lobby
  // whenever it sets startsAt on the previous one, so structural state
  // (startsAt, gameConfig) rides along with a gameID change. Null (not "")
  // is used so that an empty-lobby first broadcast still emits a full.
  private lastFullGameIds: string | null = null;

  constructor(
    private readonly server: http.Server,
    private readonly gameWss: WebSocketServer,
    private readonly gm: GameManager,
    private readonly log: typeof logger,
  ) {
    this.lobbiesWss = new WebSocketServer({
      noServer: true,
      maxPayload: 256 * 1024,
      // terron perf (E1): лобби-фид = крупные повторяющиеся JSON-снапшоты,
      // сжатие даёт кратную экономию трафика главной страницы.
      perMessageDeflate: {
        threshold: 1024,
        zlibDeflateOptions: { level: 6, memLevel: 7 },
        serverMaxWindowBits: 12,
        clientNoContextTakeover: true,
        concurrencyLimit: 4,
      },
    });
    this.setupUpgradeHandler();
    this.setupLobbiesWebSocket();
    this.setupIPCListener();
  }

  private setupIPCListener() {
    process.on("message", (raw: unknown) => {
      const result = MasterMessageSchema.safeParse(raw);
      if (!result.success) {
        this.log.error("Invalid IPC message from master:", raw);
        return;
      }

      const msg = result.data;
      switch (msg.type) {
        case "lobbiesBroadcast":
          this.lastPublicGames = msg.publicGames;
          // Forward message to all clients
          this.broadcastLobbiesToClients(msg.publicGames);
          // Update master with my lobby info
          this.sendMyLobbiesToMaster();
          break;
        case "createGame": {
          if (this.gm.game(msg.gameID) !== null) {
            this.log.warn(`Game ${msg.gameID} already exists, skipping create`);
            return;
          }
          this.log.info(`Creating public game ${msg.gameID} from master`);
          const game = this.gm.createGame(
            msg.gameID,
            msg.gameConfig,
            undefined,
            undefined,
            msg.publicGameType,
          );
          if (game === null) {
            this.log.warn(`Game ${msg.gameID} already exists, skipping create`);
          }
          break;
        }
        case "updateLobby": {
          const game = this.gm.game(msg.gameID);
          if (!game) {
            this.log.warn("cannot update game, not found", {
              gameID: msg.gameID,
            });
            return;
          }
          // terron: гонка по IPC — пока сообщение летело, игра могла стартовать
          // (игрок зашёл в последнюю секунду). Стартовавшую не трогаем вовсе:
          // ни таймер, ни карту.
          if (game.hasStarted()) {
            break;
          }
          game.setStartsAt(msg.startsAt);
          // terron: ротация карты пустого лобби (см. IPCBridgeSchema); внутри
          // свой гард «0 клиентов» — занятому лобби карту не меняем.
          if (msg.gameConfig) {
            game.rotateLobbyConfig(msg.gameConfig);
            // Новая карта уже применена — отдаём её мастеру немедленно, иначе
            // витрина ждёт очередного lobbyList (+до 500мс к «Запуск…»).
            this.sendMyLobbiesToMaster();
          }
          break;
        }
      }
    });
  }

  sendReady(workerId: number) {
    const msg: WorkerReady = { type: "workerReady", workerId };
    process.send?.(msg);
  }

  // terron: отпечаток «кто просит ротацию» с прошлой отправки. Заявка на смену
  // карты не должна ждать следующего бродкаста (до 500мс) — иначе к задержке
  // мастера прибавляется ещё и наша, и превью на витрине меняется заметно
  // ПОЗЖЕ нуля на таймере (репорт владельца 20.07).
  private lastRotationWants = "";

  private sendMyLobbiesToMaster() {
    const lobbies = this.gm.publicLobbies().map((g) => {
      const gi = g.gameInfo();
      return {
        gameID: gi.gameID,
        numClients: gi.clients?.length ?? 0,
        startsAt: gi.startsAt,
        gameConfig: gi.gameConfig,
        publicGameType: gi.publicGameType!,
        wantsMapRotation: g.wantsMapRotation(),
      } satisfies PublicGameInfo;
    });
    this.lastRotationWants = lobbies
      .filter((l) => l.wantsMapRotation)
      .map((l) => l.gameID)
      .join(",");
    process.send?.({ type: "lobbyList", lobbies } satisfies WorkerLobbyList);
  }

  // Тикает чаще бродкастов: как только у какого-то лобби поднялся флаг смены
  // карты — отдаём список мастеру немедленно, не дожидаясь очереди.
  pollRotationRequests() {
    const wants = this.gm
      .publicLobbies()
      .filter((g) => g.wantsMapRotation())
      .map((g) => g.id)
      .join(",");
    if (wants !== "" && wants !== this.lastRotationWants) {
      this.sendMyLobbiesToMaster();
    }
  }

  private setupUpgradeHandler() {
    this.server.on("upgrade", (request, socket, head) => {
      const pathname = request.url ?? "";
      if (pathname === "/lobbies" || pathname.endsWith("/lobbies")) {
        this.lobbiesWss.handleUpgrade(request, socket, head, (ws) => {
          this.lobbiesWss.emit("connection", ws, request);
        });
      } else {
        this.gameWss.handleUpgrade(request, socket, head, (ws) => {
          this.gameWss.emit("connection", ws, request);
        });
      }
    });
  }

  private setupLobbiesWebSocket() {
    this.lobbiesWss.on("connection", (ws: WebSocket) => {
      this.lobbyClients.add(ws);
      // Prime the new client with the most recent snapshot — otherwise it
      // would only see counts-only deltas (which it can't apply without a
      // base) until the next structural change.
      if (this.lastPublicGames !== null) {
        const fullJson = JSON.stringify({
          type: "full",
          serverTime: this.lastPublicGames.serverTime,
          games: this.lastPublicGames.games,
        } satisfies PublicLobbyMessage);
        ws.send(fullJson);
      }
      ws.on("message", () => {
        ws.terminate();
      });
      ws.on("close", () => {
        this.lobbyClients.delete(ws);
      });

      ws.on("error", (error) => {
        this.log.error(`Lobbies WebSocket error:`, error);
        this.lobbyClients.delete(ws);
        try {
          if (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
          ) {
            ws.close(1011, "WebSocket internal error");
          }
        } catch (closeError) {
          this.log.error("Error closing lobbies WebSocket:", closeError);
        }
      });
    });
  }

  private broadcastLobbiesToClients(publicGames: PublicGames) {
    // terron: полный снапшот — при ЛЮБОМ видимом клиенту изменении, а не только
    // при смене набора gameID. Раньше отпечаток был по одним id → (1) ротация
    // карты пустого лобби (тот же id, новый конфиг) НЕ доезжала до открытых
    // вкладок — «карта висит часами»; (2) продления startsAt холдом пустого
    // лобби тоже не доезжали — таймер у клиента дотикивал до нуля и замерзал
    // на «Запуск…» при живом лобби (репорты 17.07). В отпечатке всё, что
    // рендерит карточка: карта/размер/режим/лимит/startsAt. Цена: во время
    // холда startsAt продлевается ~раз в секунду → full раз в секунду вместо
    // counts; полный снапшот — единицы КБ на горстку клиентов витрины, с
    // perMessageDeflate это копейки.
    const parts: string[] = [];
    for (const list of Object.values(publicGames.games)) {
      for (const lobby of list) {
        const c = lobby.gameConfig;
        parts.push(
          `${lobby.gameID}:${c?.gameMap}:${c?.gameMapSize}:${c?.gameMode}:${c?.maxPlayers}:${c?.golden === true ? (c?.eventTier ?? "G") : ""}:${lobby.startsAt}`,
        );
      }
    }
    parts.sort();
    const fingerprint = parts.join(",");
    const shouldSendFull = fingerprint !== this.lastFullGameIds;

    let payload: PublicLobbyMessage;
    if (shouldSendFull) {
      payload = {
        type: "full",
        serverTime: publicGames.serverTime,
        games: publicGames.games,
      };
      this.lastFullGameIds = fingerprint;
    } else {
      const counts: Record<string, number> = {};
      for (const list of Object.values(publicGames.games)) {
        for (const lobby of list) {
          counts[lobby.gameID] = lobby.numClients;
        }
      }
      payload = {
        type: "counts",
        serverTime: publicGames.serverTime,
        counts,
      };
    }
    const json = JSON.stringify(payload);

    const clientsToRemove: WebSocket[] = [];
    this.lobbyClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      } else {
        clientsToRemove.push(client);
      }
    });

    clientsToRemove.forEach((client) => {
      this.lobbyClients.delete(client);
    });
  }
}

import { Logger } from "winston";
import WebSocket from "ws";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../core/game/Game";
import { GameConfig, GameID, PublicGameType } from "../core/Schemas";
import { Client } from "./Client";
import { loadForWorker, persistEnabled } from "./GamePersistence";
import { GamePhase, GameServer } from "./GameServer";

export class GameManager {
  private games: Map<GameID, GameServer> = new Map();

  constructor(private log: Logger) {
    this.resumePersistedGames();
    setInterval(() => this.tick(), 1000);
  }

  // terron: воскресить свои (по workerIndex) игры из снимков после рестарта
  // воркера/контейнера. Флаг-гейтед GAME_PERSIST. См. GamePersistence / server-reconnect.md.
  private resumePersistedGames(): void {
    if (!persistEnabled()) return;
    let loaded;
    try {
      loaded = loadForWorker();
    } catch (e) {
      this.log.error(`error loading persisted games: ${e}`);
      return;
    }
    for (const { meta, turns } of loaded) {
      try {
        if (this.games.has(meta.id)) continue;
        const game = new GameServer(
          meta.id,
          this.log,
          meta.createdAt,
          meta.gameConfig,
          meta.creatorPersistentID,
          meta.startsAt,
          meta.publicGameType,
        );
        game.hydrate(meta, turns);
        this.games.set(meta.id, game);
      } catch (e) {
        this.log.error(`error hydrating game ${meta.id}: ${e}`);
      }
    }
    if (loaded.length > 0) {
      this.log.info(`resumed ${loaded.length} persisted game(s) after restart`);
    }
  }

  public game(id: GameID): GameServer | null {
    return this.games.get(id) ?? null;
  }

  public publicLobbies(): GameServer[] {
    return Array.from(this.games.values()).filter(
      (g) => g.phase() === GamePhase.Lobby && g.isPublic(),
    );
  }

  // Идущие публичные матчи (для витрины «Активные игры» в /stats). Приватные
  // игры НЕ включаем — их id не светим.
  public activeGamesInfo() {
    return Array.from(this.games.values())
      .filter((g) => g.phase() === GamePhase.Active && g.isPublic())
      .map((g) => g.liveInfo());
  }

  joinClient(
    client: Client,
    gameID: GameID,
  ): "joined" | "kicked" | "rejected" | "not_found" {
    const game = this.games.get(gameID);
    if (!game) return "not_found";
    return game.joinClient(client);
  }

  rejoinClient(
    ws: WebSocket,
    persistentID: string,
    gameID: GameID,
    lastTurn: number = 0,
    identityUpdate?: { username: string; clanTag: string | null },
  ): boolean {
    const game = this.games.get(gameID);
    if (!game) return false;
    return game.rejoinClient(ws, persistentID, lastTurn, identityUpdate);
  }

  createGame(
    id: GameID,
    gameConfig: GameConfig | undefined,
    creatorPersistentID?: string,
    startsAt?: number,
    publicGameType?: PublicGameType,
  ): GameServer | null {
    if (this.games.has(id)) {
      this.log.warn("cannot create game, id already exists", { gameID: id });
      return null;
    }

    const game = new GameServer(
      id,
      this.log,
      Date.now(),
      {
        donateGold: false,
        donateTroops: false,
        gameMap: GameMapType.World,
        gameType: GameType.Private,
        gameMapSize: GameMapSize.Normal,
        difficulty: Difficulty.Easy,
        nations: "default",
        infiniteGold: false,
        infiniteTroops: false,
        maxTimerValue: undefined,
        instantBuild: false,
        randomSpawn: false,
        gameMode: GameMode.FFA,
        bots: 400,
        disabledUnits: [],
        ...gameConfig,
      },
      creatorPersistentID,
      startsAt,
      publicGameType,
    );
    this.games.set(id, game);
    return game;
  }

  // terron: разослать всем клиентам «сервер перезапускается» (SIGTERM при деплое).
  // Клиент покажет баннер и подождёт реконнекта. См. server-reconnect.md.
  broadcastServerRestart(): void {
    let n = 0;
    for (const game of this.games.values()) {
      n += game.broadcastServerRestart();
    }
    this.log.info(`broadcast server_restart to ${n} client(s)`);
  }

  activeGames(): number {
    return this.games.size;
  }

  activeClients(): number {
    let totalClients = 0;
    this.games.forEach((game: GameServer) => {
      totalClients += game.activeClients.length;
    });
    return totalClients;
  }

  // terron: распределение онлайна для /stats — где сидят подключённые клиенты
  // (идущие матчи vs лобби-ожидание, публичные vs приватные). Меню-онли
  // посетители сюда НЕ входят (они не в сокете ни одного GameServer).
  public clientsBreakdown() {
    let inActiveGame = 0;
    let inLobby = 0;
    let publicActiveGames = 0;
    let privateActiveGames = 0;
    let publicLobbies = 0;
    let privateLobbies = 0;
    for (const g of this.games.values()) {
      const n = g.activeClients.length;
      const isActive = g.phase() === GamePhase.Active;
      const pub = g.isPublic();
      if (isActive) {
        inActiveGame += n;
        if (pub) publicActiveGames++;
        else privateActiveGames++;
      } else {
        inLobby += n;
        if (pub) publicLobbies++;
        else privateLobbies++;
      }
    }
    return {
      total: inActiveGame + inLobby,
      inActiveGame,
      inLobby,
      publicActiveGames,
      privateActiveGames,
      publicLobbies,
      privateLobbies,
    };
  }

  desyncCount(): number {
    return [...this.games.values()].reduce(
      (acc, game) => acc + game.numDesyncedClients(),
      0,
    );
  }

  tick() {
    const active = new Map<GameID, GameServer>();
    for (const [id, game] of this.games) {
      const phase = game.phase();
      if (phase === GamePhase.Active) {
        if (!game.hasStarted()) {
          // Prestart tells clients to start loading the game.
          game.prestart();
          // Start game on delay to allow time for clients to connect.
          setTimeout(() => {
            try {
              game.start();
            } catch (error) {
              this.log.error(`error starting game ${id}: ${error}`);
            }
          }, 2000);
        }
      }

      if (phase === GamePhase.Finished) {
        try {
          game.end();
        } catch (error) {
          this.log.error(`error ending game ${id}: ${error}`);
        }
      } else {
        active.set(id, game);
      }
    }
    this.games = active;
  }
}

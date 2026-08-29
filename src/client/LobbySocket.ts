import { toast } from "./Toast";
import { ClientEnv } from "src/client/ClientEnv";
import { PublicGames, PublicLobbyMessageSchema } from "../core/Schemas";
import { reportHealth } from "./Health";
import { reportNetworkAlive } from "./Offline";

interface LobbySocketOptions {
  reconnectDelay?: number;
  maxWsAttempts?: number;
  pollIntervalMs?: number;
}

function getRandomWorkerPath(numWorkers: number): string {
  const workerIndex = Math.floor(Math.random() * numWorkers);
  return `/w${workerIndex}`;
}

export class PublicLobbySocket {
  private ws: WebSocket | null = null;
  private wsReconnectTimeout: number | null = null;
  /** Пауза между редкими попытками после исчерпания лимита — см. handleClose. */
  private static readonly SLOW_RETRY_MS = 30_000;
  // terron ПЕРФ 16.08: момент, когда витрина сдалась и перешла на редкий
  // 30с-повтор. Успешный коннект после этого = «правка 08.08 реально оживила
  // витрину» → один репорт lobby_socket_recovered с длительностью простоя.
  private gaveUpAtMs = 0;
  private wsConnectionAttempts = 0;
  private wsAttemptCounted = false;
  private workerPath: string = "";
  private stopped = true;
  // Latest full snapshot, used as the base for applying counts-only deltas.
  private lastFull: PublicGames | null = null;

  private readonly reconnectDelay: number;
  private readonly maxWsAttempts: number;

  constructor(
    private onLobbiesUpdate: (data: PublicGames) => void,
    options?: LobbySocketOptions,
  ) {
    this.reconnectDelay = options?.reconnectDelay ?? 3000;
    this.maxWsAttempts = options?.maxWsAttempts ?? 3;
  }

  async start() {
    this.stopped = false;
    this.wsConnectionAttempts = 0;
    // Get config to determine number of workers, then pick a random one
    this.workerPath = getRandomWorkerPath(ClientEnv.numWorkers());
    // terron: при возврате связи переподключаемся и тянем СВЕЖИЙ снапшот. Без
    // этого после офлайна сокет сдаётся (maxWsAttempts) и на главной висит
    // протухшее лобби («уже стартовало»). online-событие в WKWebView ненадёжно,
    // но на вебе работает; вреда нет.
    window.addEventListener("online", this.handleOnline);
    this.connectWebSocket();
  }

  stop() {
    this.stopped = true;
    this.lastFull = null;
    window.removeEventListener("online", this.handleOnline);
    this.disconnectWebSocket();
  }

  // terron: принудительно переподключиться и вытянуть СВЕЖИЙ снапшот — даже если
  // сокет уже «сдался» по maxWsAttempts (иначе на главной висит протухшее лобби
  // «уже стартовало»). Зовём при обнаружении протухшей витрины (GameModeSelector).
  refresh() {
    if (this.stopped) return;
    this.wsConnectionAttempts = 0;
    if (this.wsReconnectTimeout !== null) {
      clearTimeout(this.wsReconnectTimeout);
      this.wsReconnectTimeout = null;
    }
    this.connectWebSocket();
  }

  // Связь вернулась → сбрасываем счётчик попыток и переподключаемся немедленно
  // (даже если уже «сдались» по maxWsAttempts). Сервер пришлёт свежий full.
  private handleOnline = () => {
    if (this.stopped) return;
    this.wsConnectionAttempts = 0;
    if (this.wsReconnectTimeout !== null) {
      clearTimeout(this.wsReconnectTimeout);
      this.wsReconnectTimeout = null;
    }
    this.connectWebSocket();
  };

  private connectWebSocket() {
    try {
      // Clean up existing WebSocket before creating a new one
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      // Drop any cached snapshot — the server primes new connections with a
      // fresh full message, and a stale base could mis-merge incoming deltas.
      this.lastFull = null;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}${this.workerPath}/lobbies`;

      this.ws = new WebSocket(wsUrl);
      this.wsAttemptCounted = false;

      this.ws.addEventListener("open", () => this.handleOpen());
      this.ws.addEventListener("message", (event) => this.handleMessage(event));
      this.ws.addEventListener("close", () => this.handleClose());
      this.ws.addEventListener("error", (error) => this.handleError(error));
    } catch (error) {
      this.handleConnectError(error);
    }
  }

  private handleOpen() {
    console.log("WebSocket connected: lobby updating");
    // terron: живой сокет = сеть работает, что бы ни думал navigator.onLine
    // (он врёт на Windows с виртуальными адаптерами — см. Offline.ts).
    reportNetworkAlive();
    if (this.gaveUpAtMs !== 0) {
      const deadMin = Math.round((Date.now() - this.gaveUpAtMs) / 60_000);
      this.gaveUpAtMs = 0;
      reportHealth("lobby_socket_recovered", `витрина ожила через ~${deadMin} мин`, {
        deadMin,
      });
    }
    this.wsConnectionAttempts = 0;
    if (this.wsReconnectTimeout !== null) {
      clearTimeout(this.wsReconnectTimeout);
      this.wsReconnectTimeout = null;
    }
  }

  private handleMessage(event: MessageEvent) {
    reportNetworkAlive();
    try {
      const message = PublicLobbyMessageSchema.parse(
        JSON.parse(event.data as string),
      );
      if (message.type === "full") {
        this.lastFull = {
          serverTime: message.serverTime,
          games: message.games,
        };
        this.onLobbiesUpdate(this.lastFull);
        return;
      }
      // counts: patch numClients onto the last full snapshot. If we have no
      // base yet (shouldn't happen — server primes on connect), ignore it
      // and wait for the next full.
      if (this.lastFull === null) {
        return;
      }
      const patchedGames = { ...this.lastFull.games };
      for (const type of Object.keys(patchedGames) as Array<
        keyof typeof patchedGames
      >) {
        const list = patchedGames[type];
        if (!list) continue;
        patchedGames[type] = list.map((lobby) => {
          const next = message.counts[lobby.gameID];
          return next === undefined || next === lobby.numClients
            ? lobby
            : { ...lobby, numClients: next };
        });
      }
      this.lastFull = {
        serverTime: message.serverTime,
        games: patchedGames,
      };
      this.onLobbiesUpdate(this.lastFull);
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
      this.maybeReloadOnProtocolMismatch();
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.close();
        } catch (closeError) {
          console.error(
            "Error closing WebSocket after parse failure:",
            closeError,
          );
        }
      }
    }
  }

  // terron: ПРОТОКОЛ ФИДА РАЗЪЕХАЛСЯ. Открытая со вчера вкладка держит старую
  // схему сообщений; выкатили сервер с новым типом лобби (28.07 — "golden") —
  // и её парсер падает на КАЖДОМ сообщении: витрина замирает намертво, игрок
  // видит вечное «Запуск…» и не может зайти. Реконнект тут не лечит (проблема
  // не в сокете), лечит только свежий бандл — перезагружаем вкладку сами.
  // Гарды: не в матче, вкладка на виду, три отказа подряд и не чаще раза в
  // 5 минут (иначе цикл перезагрузок, если причина не в версии).
  private static readonly PROTO_RELOAD_KEY = "terron-lobby-proto-reload";
  private parseFailures = 0;

  private maybeReloadOnProtocolMismatch(): void {
    this.parseFailures++;
    if (this.parseFailures < 3) return;
    if (document.body.classList.contains("in-game")) return;
    if (document.hidden) return;
    try {
      const key = PublicLobbySocket.PROTO_RELOAD_KEY;
      const last = Number(sessionStorage.getItem(key) ?? "0");
      if (Date.now() - last < 5 * 60 * 1000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      return; // нет sessionStorage — лучше замереть, чем крутить перезагрузки
    }
    reportHealth("lobby_proto_reload", "lobby feed schema mismatch");
    // Внутри площадки перезагружать страницу нельзя (переинициализирует SDK):
    // там довольствуемся мягким возвратом в меню — фид подхватится заново.
    void import("./SoftNavigate").then(({ softReload }) => softReload());
  }

  private handleClose() {
    if (this.stopped) return;
    console.log("WebSocket disconnected, attempting to reconnect...");
    if (!this.wsAttemptCounted) {
      this.wsAttemptCounted = true;
      this.wsConnectionAttempts++;
    }
    if (this.wsConnectionAttempts >= this.maxWsAttempts) {
      console.error("Max WebSocket attempts reached");
      // Телеметрия: витрина лобби на главной замёрзла (класс бага «джойн в
      // протухшее лобби»).
      reportHealth("lobby_socket_gave_up", "close");
      if (this.gaveUpAtMs === 0) this.gaveUpAtMs = Date.now();
      // terron (08.08): РАНЬШЕ ЗДЕСЬ БЫЛА ВЕЧНАЯ СДАЧА — и витрина замирала до
      // перезагрузки страницы. Обе «двери» восстановления оказались условными:
      //   • хук `online` срабатывает лишь при СМЕНЕ состояния сети, а сокет чаще
      //     закрывает СЕРВЕР (перезапуск контейнера) — сеть при этом не меняется;
      //   • сторож витрины (`GameModeSelector.checkStaleLobbies`) оживляет только
      //     когда в кэше УЖЕ лежит явно протухшее лобби. Если сокет умер сразу
      //     после свежих данных, витрина выглядит нормальной — просто замершей, —
      //     и сторож молчит. А если снимка не было вовсе (`lobbies === null`,
      //     страница открылась во время перезапуска), он выходит по первой же
      //     строке, и витрина пуста НАВСЕГДА.
      // По телеметрии это ~15-20 сессий в сутки, почти все десктопные (долгие
      // вкладки чаще ловят серверный перезапуск). Лимит попыток оставляем —
      // он и нужен, чтобы не долбить сервер, — но добавляем редкий повтор:
      // раз в полминуты, пока не получится. Успешный коннект сбрасывает счётчик
      // в handleOpen, и всё возвращается к обычному режиму.
      this.scheduleReconnect(PublicLobbySocket.SLOW_RETRY_MS);
    } else {
      this.scheduleReconnect();
    }
  }

  private handleError(error: Event) {
    console.error("WebSocket error:", error);
  }

  private handleConnectError(error: unknown) {
    console.error("Error connecting WebSocket:", error);
    if (!this.wsAttemptCounted) {
      this.wsAttemptCounted = true;
      this.wsConnectionAttempts++;
    }
    if (this.wsConnectionAttempts >= this.maxWsAttempts) {
      toast("error connecting to game service");
      reportHealth("lobby_socket_gave_up", "connect");
      if (this.gaveUpAtMs === 0) this.gaveUpAtMs = Date.now();
      // Тот же редкий повтор, что и при close: без него витрина мертва до F5.
      this.scheduleReconnect(PublicLobbySocket.SLOW_RETRY_MS);
    } else {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(delayMs?: number) {
    if (this.wsReconnectTimeout !== null) return;
    this.wsReconnectTimeout = window.setTimeout(() => {
      this.wsReconnectTimeout = null;
      this.connectWebSocket();
    }, delayMs ?? this.reconnectDelay);
  }

  private disconnectWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.wsReconnectTimeout !== null) {
      clearTimeout(this.wsReconnectTimeout);
      this.wsReconnectTimeout = null;
    }
  }
}

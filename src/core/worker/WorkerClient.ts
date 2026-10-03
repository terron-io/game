import { camDiag } from "../../client/CamDiag";
import { getCdnBase } from "../AssetUrls";
import {
  BuildableUnit,
  Cell,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerProfile,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import { ClientID, GameStartInfo, Turn } from "../Schemas";
import { generateID } from "../Util";
import { WorkerMessage } from "./WorkerMessages";

/**
 * terron 12.09: пачку ходов от воркера раздаём ПО ОДНОМУ ходу под своим
 * try. Раньше исключение на k-м ходе обрывало цикл, и ходы k+1..n молча
 * выбрасывались: зеркало карты навсегда теряло их тайлы, а числа интерфейса
 * (игрок приходит целиком каждый ход) оставались верными — ровно «карта
 * застыла, войска живые». Первую ошибку пробрасываем отдельной задачей,
 * чтобы её увидели глобальные датчики. Возвращает число упавших ходов.
 */
export function dispatchUpdateBatch<T>(
  items: readonly T[],
  cb: (item: T) => void,
  rethrow: (err: unknown) => void = (err) =>
    setTimeout(() => {
      throw err;
    }, 0),
): number {
  let failed = 0;
  let first: unknown = null;
  for (const item of items) {
    try {
      cb(item);
    } catch (err) {
      if (failed === 0) first = err;
      failed++;
    }
  }
  if (failed > 0) rethrow(first);
  return failed;
}

// terron (офлайн-iOS): база ассетов для воркера. Воркер — инлайн-Blob; его
// self.location = blob:… → корне-относительный fetch ("/_assets/…") из blob-
// воркера НЕ резолвится → "Failed to parse URL" → бины/манифест карт не грузятся
// → init виснет/падает, игра застревает, HUD пустой.
// Поэтому когда cdn ПУСТ (бандл/same-origin), отдаём АБСОЛЮТНЫЙ origin страницы —
// тогда assetUrl в воркере даёт абсолютный URL и fetch бьёт по тому же origin.
// РАНЬШЕ это делалось только при Capacitor.isNativePlatform(), но мост в WKWebView
// ФЛАПАЕТ (не всегда инжектится) → возвращался "" → воркер падал. Убрали
// зависимость от Capacitor: origin берём всегда, если он http(s)/локальный.
function workerAssetBase(): string {
  const cdn = getCdnBase();
  if (cdn) return cdn;
  try {
    // ВАЖНО: нативный origin на iOS = "capacitor://localhost" (НЕ https). Нельзя
    // фильтровать по http(s) — это отрезало бы натив и воркер падал бы на
    // относительном пути. Берём ЛЮБОЙ валидный origin (capacitor://, https://,
    // http://), отсекаем лишь "null"/blob: (контексты без нормального origin).
    if (
      typeof location !== "undefined" &&
      location.origin &&
      location.origin !== "null" &&
      !location.origin.startsWith("blob:")
    ) {
      return location.origin;
    }
  } catch {
    /* нет location — не наш случай */
  }
  return "";
}
// terron ПЕРФ (21.08): воркер больше НЕ инлайнится в главный бандл (см.
// vite.config.ts, entry `simworker`). Грузим модульный воркер по абсолютному
// same-origin URL (та же база, что у fetch'ей внутри воркера). Если CDN когда-
// нибудь окажется на чужом origin, `new Worker(url)` кинет SecurityError — тогда
// заводим воркер из blob с одной строкой `import "<abs url>"` (модульный импорт
// cross-origin разрешён при CORS), это и есть штатный обход ограничения.
declare const __PLATFORM_BUILD__: string | undefined;

/**
 * Откуда брать САМ ФАЙЛ воркера — это НЕ то же, что база ассетов.
 *
 * ⚠️ В сборке под чужую площадку (Playgama) ассеты идут с нашего домена
 * (cdnBase), а вот КОД воркера обязан грузиться ЛОКАЛЬНО, из самого бандла.
 * Иначе так: прямой `new Worker(https://terron.io/...)` падает SecurityError
 * (cross-origin), включается blob-фолбэк, а тот тянет с terron.io чанки ТОЙ
 * сборки — которых там нет, потому что у сайта свои хэши. Итог — «Worker init
 * failed: Failed to fetch» и матч, зависший на загрузке (поймано живой
 * проверкой бандла на стороннем origin).
 */
function isPlatformBuild(): boolean {
  return (
    typeof __PLATFORM_BUILD__ === "string" && __PLATFORM_BUILD__.length > 0
  );
}

function workerScriptBase(): string {
  const isPlatform = isPlatformBuild();
  if (isPlatform) {
    try {
      return location.origin && location.origin !== "null"
        ? location.origin
        : "";
    } catch {
      return "";
    }
  }
  return workerAssetBase();
}

declare const __BUILD_TIME__: number | undefined;
function createGameWorker(): Worker {
  if (import.meta.env.DEV) {
    // dev-сервер Vite отдаёт .ts воркера как ES-модуль напрямую.
    return new Worker("/src/core/worker/Worker.worker.ts", { type: "module" });
  }
  const v = typeof __BUILD_TIME__ === "number" ? `?v=${__BUILD_TIME__}` : "";
  // ⚠️ В ПЛАТФОРМЕННОЙ СБОРКЕ АДРЕС СЧИТАЕМ ОТ САМОГО СЕБЯ, а не от origin.
  // Площадка кладёт игру в СВОЮ ПОДПАПКУ (`/<id-игры>/assets/…`), поэтому
  // `${location.origin}/assets/simworker.js` уходил в КОРЕНЬ домена, получал 404
  // и воркер не поднимался вовсе — «Error: Worker initialization timeout» и матч,
  // навсегда застрявший на «загрузке карты» (репорт владельца 30.08 из их
  // QA-инструмента). `import.meta.url` — это URL текущего чанка, он всегда лежит
  // рядом с simworker.js, в какой бы подпапке площадка нас ни разместила.
  // ⚠️ БАЗУ СЧИТАЕМ СТРОКОЙ, а не через `new URL(..., import.meta.url)`.
  // Rolldown распознаёт этот шаблон как ссылку на ассет и подменяет его своим
  // `import.meta.glob(...)`, который на нашем `?v=` ключе даёт undefined —
  // проверено грепом собранного бандла. Обычная строковая арифметика бандлеру
  // не видна и делает ровно то, что нужно.
  const selfUrl = import.meta.url;
  const dir = selfUrl.slice(0, selfUrl.lastIndexOf("/") + 1);
  const url = isPlatformBuild()
    ? `${dir}simworker.js${v}`
    : `${workerScriptBase()}/assets/simworker.js${v}`;
  try {
    return new Worker(url, { type: "module" });
  } catch (e) {
    console.warn(
      "[worker] прямой запуск не удался, фолбэк через blob-import",
      e,
    );
    const blob = new Blob([`import ${JSON.stringify(url)};`], {
      type: "text/javascript",
    });
    return new Worker(URL.createObjectURL(blob), { type: "module" });
  }
}

export class WorkerClient {
  private worker: Worker;
  private isInitialized = false;
  private messageHandlers: Map<string, (message: WorkerMessage) => void>;
  private gameUpdateCallback?: (
    update: GameUpdateViewData | ErrorUpdate,
  ) => void;

  constructor(
    private gameStartInfo: GameStartInfo,
    private clientID: ClientID | undefined,
  ) {
    this.worker = createGameWorker();
    this.messageHandlers = new Map();

    // Set up global message handler
    this.worker.addEventListener(
      "message",
      this.handleWorkerMessage.bind(this),
    );
  }

  private handleWorkerMessage(event: MessageEvent<WorkerMessage>) {
    const message = event.data;

    switch (message.type) {
      case "game_update":
        if (this.gameUpdateCallback && message.gameUpdate) {
          this.gameUpdateCallback(message.gameUpdate);
        }
        break;
      case "game_update_batch":
        if (this.gameUpdateCallback && message.gameUpdates) {
          const cb = this.gameUpdateCallback;
          dispatchUpdateBatch(message.gameUpdates, (gu) => cb(gu));
        }
        break;
      case "game_error":
        if (this.gameUpdateCallback && message.error) {
          this.gameUpdateCallback(message.error);
        }
        break;

      case "initialized":
      default:
        if (message.id && this.messageHandlers.has(message.id)) {
          const handler = this.messageHandlers.get(message.id)!;
          handler(message);
          this.messageHandlers.delete(message.id);
        }
        break;
    }
  }

  // Разбивка этапов инициализации внутри воркера (мс): map / nations / world /
  // executions. Заполняется при initialize(), читается трассировкой загрузки.
  public initTimings: Record<string, number> = {};

  initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (message.type === "initialized") {
          if (message.error) {
            reject(new Error(`Worker init failed: ${message.error}`));
            return;
          }
          this.isInitialized = true;
          // terron 20.07: разбивка инициализации воркера → в общую трассировку
          // загрузки (LoadTrace). Замер уже сделан, тут только передача.
          if (message.timings) this.initTimings = message.timings;
          resolve();
        }
      });

      this.worker.postMessage({
        type: "init",
        id: messageId,
        gameStartInfo: this.gameStartInfo,
        clientID: this.clientID,
        cdnBase: workerAssetBase(),
      });

      setTimeout(() => {
        if (!this.isInitialized) {
          this.messageHandlers.delete(messageId);
          reject(new Error("Worker initialization timeout"));
        }
      }, 60000);
    });
  }

  start(gameUpdate: (gu: GameUpdateViewData | ErrorUpdate) => void) {
    if (!this.isInitialized) {
      throw new Error("Failed to initialize pathfinder");
    }
    // Первые пакеты состояния меряем отдельно: именно во втором сидела
    // многосекундная заморозка старта (см. CamDiag.ts). Когда диагностика
    // выключена, step() просто зовёт колбэк.
    let measured = 0;
    this.gameUpdateCallback = (gu) => {
      if (!camDiag.enabled || measured >= 3) return gameUpdate(gu);
      measured++;
      return camDiag.step(`приём_пакета_${measured}`, () => gameUpdate(gu));
    };
  }

  sendTurn(turn: Turn) {
    if (!this.isInitialized) {
      throw new Error("Worker not initialized");
    }

    this.worker.postMessage({
      type: "turn",
      turn,
    });
  }

  playerProfile(playerID: number): Promise<PlayerProfile> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_profile_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.worker.postMessage({
        type: "player_profile",
        id: messageId,
        playerID: playerID,
      });
    });
  }

  playerBorderTiles(playerID: PlayerID): Promise<PlayerBorderTiles> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_border_tiles_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.worker.postMessage({
        type: "player_border_tiles",
        id: messageId,
        playerID: playerID,
      });
    });
  }

  playerInteraction(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[] | null,
  ): Promise<PlayerActions> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_actions_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.worker.postMessage({
        type: "player_actions",
        id: messageId,
        playerID,
        x,
        y,
        units,
      });
    });
  }

  playerBuildables(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[],
  ): Promise<BuildableUnit[]> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_buildables_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.worker.postMessage({
        type: "player_buildables",
        id: messageId,
        playerID,
        x,
        y,
        units,
      });
    });
  }

  attackClusteredPositions(
    playerID: number,
    attackID?: string,
  ): Promise<{ id: string; positions: Cell[] }[]> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      const timeout = setTimeout(() => {
        this.messageHandlers.delete(messageId);
        reject(new Error("attack_clustered_positions request timed out"));
      }, 5000);

      this.messageHandlers.set(messageId, (message) => {
        clearTimeout(timeout);
        if (message.type !== "attack_clustered_positions_result") {
          reject(
            new Error(
              `Unexpected message type for attackClusteredPositions: ${message.type}`,
            ),
          );
          return;
        }
        resolve(
          message.attacks.map((a) => ({
            id: a.id,
            positions: a.positions.map((c) => new Cell(c.x, c.y)),
          })),
        );
      });

      this.worker.postMessage({
        type: "attack_clustered_positions",
        id: messageId,
        playerID,
        attackID,
      });
    });
  }

  transportShipSpawn(
    playerID: PlayerID,
    targetTile: TileRef,
  ): Promise<TileRef | false> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "transport_ship_spawn_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.worker.postMessage({
        type: "transport_ship_spawn",
        id: messageId,
        playerID: playerID,
        targetTile: targetTile,
      });
    });
  }

  cleanup() {
    this.worker.terminate();
    this.messageHandlers.clear();
    this.gameUpdateCallback = undefined;
  }
}

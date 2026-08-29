// terron 20.07: персист локальных (одиночных/офлайн) матчей в IndexedDB.
//
// Зачем: локальная игра живёт ТОЛЬКО в памяти вкладки (LocalServer) — F5 или
// смерть вкладки убивали её безвозвратно, и адрес /game/<id> вёл «в никуда».
// Теперь LocalServer сбрасывает сюда {gameStartInfo, turns} по ходу партии, а
// заход на /game/<id> сначала смотрит эту базу: нашлась запись → поднимаем матч
// РОВНО так же, как онлайн-клиент догоняет сервер (прогон сохранённых ходов,
// дальше живая игра). Наличие записи здесь = «это МОЯ локальная игра», поэтому
// отдельный список id не нужен: клиент по нему же отличает свою локалку от
// попытки зайти в чужое серверное лобби.
//
// Формат ходов — тот же массив Turn[], что уходит в архив в конце партии, так
// что одна структура обслуживает и резюм, и архивацию. Самый длинный одиночный
// матч в проде — ~4600 ходов / ~324КБ JSON, в IndexedDB влезает без вопросов.

import { GameStartInfo, Turn } from "../core/Schemas";

export interface LocalGameSnapshot {
  gameID: string;
  gameStartInfo: GameStartInfo;
  turns: Turn[];
  playerName: string;
  playerClanTag: string | null;
  savedAt: number;
}

const DB_NAME = "terron";
const STORE = "local_games";
const DB_VERSION = 1;
// Держим только последние партии игрока — чистим устаревшие, лишние по числу и
// по объёму, чтобы база не пухла (у каждого матча свои сотни КБ ходов).
const MAX_GAMES = 10;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // потолок объёма всех записей
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // месяц
// Оценка веса записи без сериализации: ~70 байт/ход (замер прода: 4648 ходов ≈
// 324КБ JSON). Для бюджета этого достаточно, точный размер считать дорого.
const BYTES_PER_TURN = 70;
function estBytes(g: { turns: unknown[] }): number {
  return g.turns.length * BYTES_PER_TURN;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (!globalThis.indexedDB) {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "gameID" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      // Приватный режим / заблокированное хранилище — не падаем, просто без
      // персиста (локалка тогда работает как раньше: живёт до F5).
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** Сохранить/обновить снапшот матча. Тихо no-op, если хранилище недоступно. */
export async function saveLocalGame(snap: LocalGameSnapshot): Promise<void> {
  const db = await openDb();
  if (!db) {
    reportPersistFailed("db недоступна");
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const req = tx(db, "readwrite").put(snap);
      req.onsuccess = () => resolve();
      req.onerror = () => {
        // Переполнение квоты / заблокированное хранилище: резюм тихо не
        // сработает, поэтому фиксируем в телеметрии (один репорт на вкладку —
        // капы Health не дадут спамить).
        reportPersistFailed(req.error?.name ?? "put error");
        resolve();
      };
    } catch (e) {
      reportPersistFailed(e instanceof Error ? e.name : "throw");
      resolve();
    }
  });
}

let persistFailReported = false;
function reportPersistFailed(reason: string): void {
  if (persistFailReported) return;
  persistFailReported = true;
  void import("./Health").then(({ reportHealth }) =>
    reportHealth("local_persist_failed", reason),
  );
}

/** Достать снапшот по id (null — нет записи / хранилище недоступно). */
export async function loadLocalGame(
  gameID: string,
): Promise<LocalGameSnapshot | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<LocalGameSnapshot | null>((resolve) => {
    try {
      const req = tx(db, "readonly").get(gameID);
      req.onsuccess = () => {
        const v = req.result as LocalGameSnapshot | undefined;
        // Просроченную запись отдаём как отсутствующую (и она уберётся при
        // ближайшем prune) — не поднимаем матч суточной давности.
        if (!v || Date.now() - v.savedAt > MAX_AGE_MS) {
          resolve(null);
          return;
        }
        resolve(v);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export interface LocalGameBrief {
  gameID: string;
  gameMap: string | undefined;
  turns: number;
  savedAt: number;
}

/**
 * Список незаконченных локальных игр (свежие сначала) — для «Продолжить». Отдаём
 * ТОЛЬКО метаданные, без массива ходов: список может быть на десяток партий, а
 * ходы каждой — сотни КБ, тянуть их все в UI незачем.
 */
export async function listLocalGames(): Promise<LocalGameBrief[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise<LocalGameBrief[]>((resolve) => {
    try {
      const req = tx(db, "readonly").getAll();
      req.onsuccess = () => {
        const all = (req.result as LocalGameSnapshot[]) ?? [];
        const now = Date.now();
        resolve(
          all
            .filter((g) => now - g.savedAt <= MAX_AGE_MS && g.turns.length > 0)
            .sort((a, b) => b.savedAt - a.savedAt)
            .map((g) => ({
              gameID: g.gameID,
              gameMap: g.gameStartInfo?.config?.gameMap,
              turns: g.turns.length,
              savedAt: g.savedAt,
            })),
        );
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Удалить запись матча (партия доиграла → уехала в архив, локальная копия не нужна). */
export async function deleteLocalGame(gameID: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const req = tx(db, "readwrite").delete(gameID);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Чистка: удалить просроченные и оставить свежайшие в пределах ДВУХ лимитов —
 * не больше MAX_GAMES штук И суммарно не больше MAX_TOTAL_BYTES. Идём от самой
 * свежей записи и набираем, пока оба бюджета не исчерпаны; остальное удаляем.
 */
export async function pruneLocalGames(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const store = tx(db, "readwrite");
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as LocalGameSnapshot[]) ?? [];
        const now = Date.now();
        const fresh = all
          .filter((g) => now - g.savedAt <= MAX_AGE_MS)
          .sort((a, b) => b.savedAt - a.savedAt); // свежие сначала
        const keep = new Set<string>();
        let bytes = 0;
        for (const g of fresh) {
          if (keep.size >= MAX_GAMES) break;
          const b = estBytes(g);
          // Первую (самую свежую) держим всегда, даже если одна перевешивает
          // бюджет — иначе только что доигранный/идущий матч не сохранить.
          if (keep.size > 0 && bytes + b > MAX_TOTAL_BYTES) break;
          keep.add(g.gameID);
          bytes += b;
        }
        for (const g of all) {
          if (!keep.has(g.gameID)) {
            try {
              store.delete(g.gameID);
            } catch {
              /* ignore */
            }
          }
        }
        resolve();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

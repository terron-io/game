import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { appendFile, rename, rm, writeFile } from "fs/promises";
import { join } from "path";
import {
  ClientID,
  GameConfig,
  GameID,
  GameStartInfo,
  PlayerCosmetics,
  PublicGameType,
  Turn,
} from "../core/Schemas";
import { ServerEnv } from "./ServerEnv";

// terron: ПЕРСИСТ ЛОГА ХОДОВ на диск-volume → игры переживают рестарт воркера/
// контейнера (деплой без потери матчей). Флаг-гейтед `GAME_PERSIST=1` (default OFF
// — прод не трогаем). Каждая игра: <id>.meta.json (снимок роли/старта, редко) +
// <id>.turns.ndjson (append по ходу, поток). На старте воркер перечитывает СВОИ
// (по workerIndex) снимки и воскрешает GameServer'ы; клиенты авто-реконнектятся и
// догоняются по lastTurn. Voшло — удаляем файлы. См. server-reconnect.md.

export interface PersistedClient {
  clientID: ClientID;
  persistentID: string;
  username: string;
  clanTag: string | null;
  role: string | null;
  cosmetics: PlayerCosmetics | undefined;
  publicId: string | undefined;
  friends: string[];
  ip: string;
  // terron: устройство (Device.ts) — переживает пересоздание контейнера, иначе
  // после резюма матча значок в спидран-топе терялся бы у всех.
  device?: string;
  // terron: «палец/мышь» по живым событиям (client/InputMode.ts). Клиент
  // пришлёт заново только при СМЕНЕ классификации, так что без сохранения
  // резюм матча стирал бы уже собранный сигнал.
  inputMode?: string;
}

export interface GameMeta {
  id: GameID;
  createdAt: number;
  visibleAt?: number;
  startsAt?: number;
  startTime?: number;
  creatorPersistentID?: string;
  publicGameType?: PublicGameType;
  gameConfig: GameConfig;
  gameStartInfo: GameStartInfo;
  wireGameStartInfo: GameStartInfo;
  clients: PersistedClient[];
  kickedPersistentIds: string[];
}

export interface LoadedGame {
  meta: GameMeta;
  turns: Turn[];
}

export function persistEnabled(): boolean {
  return process.env.GAME_PERSIST === "1";
}

function persistDir(): string {
  return process.env.GAME_PERSIST_DIR ?? "/data/games";
}

function ensureDir(): void {
  const d = persistDir();
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// Первую ошибку записи логируем ГРОМКО (частая грабля: volume root:root, а сервер
// бежит под user=node → EACCES; раньше глоталось молча и резюм тихо не работал).
let warnedWriteFail = false;
function warnOnce(where: string, e: unknown): void {
  if (warnedWriteFail) return;
  warnedWriteFail = true;
  console.error(
    `[GamePersistence] write failed in ${where} (проверь права ${persistDir()} — сервер под user=node): ${e}`,
  );
}

function metaPath(id: GameID): string {
  return join(persistDir(), `${id}.meta.json`);
}
function turnsPath(id: GameID): string {
  return join(persistDir(), `${id}.turns.ndjson`);
}

// terron ПЕРФ (21.08): persistMeta звался из WS-хендлеров (join/rejoin/кик,
// input_mode…) и делал writeFileSync+renameSync ПРЯМО в обработчике — синхронный
// диск-I/O в event-loop воркера = джиттер тиков у ВСЕХ его матчей (как S1 с
// ходами). Теперь снимки КОАЛЕСЦИРУЮТСЯ: на игру держится один отложенный
// объект meta, пишется раз в META_FLUSH_MS асинхронно (temp+rename — атомарно,
// формат файла тот же). Сериализуем в момент флаша: meta держит ссылки на живой
// конфиг/ростер, так что в файл попадает САМОЕ свежее состояние. SIGTERM:
// persistFlushSync дописывает хвост синхронно (вместе с ходами).
const META_FLUSH_MS = 250;
const pendingMeta = new Map<GameID, GameMeta>();
let metaTimer: NodeJS.Timeout | null = null;
let metaChain: Promise<void> = Promise.resolve();
// Игры, удалённые persistDelete, пока их meta ещё могла быть в полёте: writer
// проверяет набор ПЕРЕД rename, чтобы завершённый матч не «воскрес» на резюме.
const deletedIds = new Set<GameID>();

function takePendingMeta(): Array<[GameID, string]> {
  const out: Array<[GameID, string]> = [];
  for (const [id, meta] of pendingMeta) {
    out.push([id, JSON.stringify(meta)]);
  }
  pendingMeta.clear();
  return out;
}

function flushMetaAsync(): void {
  const batch = takePendingMeta();
  if (batch.length === 0) return;
  metaChain = metaChain.then(async () => {
    try {
      if (!dirEnsured) {
        ensureDir();
        dirEnsured = true;
      }
      for (const [id, json] of batch) {
        if (deletedIds.has(id)) continue;
        const tmp = metaPath(id) + ".tmp";
        await writeFile(tmp, json);
        if (deletedIds.has(id)) {
          await rm(tmp, { force: true });
          continue;
        }
        await rename(tmp, metaPath(id)); // атомарно
      }
    } catch (e) {
      warnOnce("flushMetaAsync", e);
    }
  });
}

/** Снимок метаданных игры (при старте и при изменении ростера — редко).
 *  Асинхронный и коалесцированный — см. коммент выше. */
export function persistMeta(meta: GameMeta): void {
  if (!persistEnabled()) return;
  deletedIds.delete(meta.id); // игра снова жива (hydrate/повторный старт)
  pendingMeta.set(meta.id, meta);
  if (metaTimer === null) {
    metaTimer = setTimeout(() => {
      metaTimer = null;
      flushMetaAsync();
    }, META_FLUSH_MS);
  }
}

// Кэш «директория для игры создана» — чтобы не звать ensureDir на каждый ход.
let dirEnsured = false;

// terron perf (S1, 2026-07-05): раньше persistTurn писал appendFileSync НА КАЖДЫЙ
// ход (~10/с × каждая игра) — синхронный диск-I/O блокировал event-loop воркера
// со ВСЕМИ его матчами (джиттер тиков под диск-нагрузкой). Теперь ходы копятся в
// памяти и пишутся батчем раз в FLUSH_MS асинхронно (fs/promises.appendFile,
// последовательная цепочка — записи в файл не перемешиваются).
// Durability-компромисс: при ЖЁСТКОМ краше (kill -9/OOM) теряется до FLUSH_MS
// хвоста лога → этот матч на резюме может десинкнуть (= потерян, как до персиста).
// Штатный рестарт (SIGTERM от docker/деплоя) БЕЗ потерь: gracefulShutdown в
// Worker.ts зовёт persistFlushSync().
const FLUSH_MS = 250;
const pendingTurns = new Map<GameID, string[]>();
let flushTimer: NodeJS.Timeout | null = null;
let flushChain: Promise<void> = Promise.resolve();

function takePending(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [id, lines] of pendingTurns) {
    out.push([turnsPath(id), lines.join("\n") + "\n"]);
  }
  pendingTurns.clear();
  return out;
}

function flushPendingAsync(): void {
  const batch = takePending();
  if (batch.length === 0) return;
  flushChain = flushChain.then(async () => {
    try {
      if (!dirEnsured) {
        ensureDir();
        dirEnsured = true;
      }
      for (const [p, data] of batch) {
        await appendFile(p, data);
      }
    } catch (e) {
      warnOnce("flushPendingAsync", e);
    }
  });
}

/** Дозапись хода в лог (батчится, см. коммент выше).
 *  terron ПЕРФ (21.08): принимает УЖЕ сериализованный ход (`JSON.stringify(turn)`)
 *  — GameServer.endTurn сериализует ход один раз и для броадкаста, и сюда.
 *  Строка в файл ложится как есть → формат ndjson побайтово прежний. */
export function persistTurn(id: GameID, turnJson: string): void {
  if (!persistEnabled()) return;
  let arr = pendingTurns.get(id);
  if (arr === undefined) {
    arr = [];
    pendingTurns.set(id, arr);
  }
  arr.push(turnJson);
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPendingAsync();
    }, FLUSH_MS);
  }
}

/** Синхронный флаш остатка — звать ПЕРЕД выходом процесса (graceful shutdown). */
export function persistFlushSync(): void {
  if (!persistEnabled()) return;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (metaTimer !== null) {
    clearTimeout(metaTimer);
    metaTimer = null;
  }
  try {
    if (!dirEnsured) {
      ensureDir();
      dirEnsured = true;
    }
    // meta — первой: без снимка лог ходов на резюме никому не нужен.
    for (const [id, json] of takePendingMeta()) {
      const tmp = metaPath(id) + ".tmp";
      writeFileSync(tmp, json);
      renameSync(tmp, metaPath(id));
    }
    for (const [p, data] of takePending()) {
      appendFileSync(p, data);
    }
  } catch (e) {
    warnOnce("persistFlushSync", e);
  }
}

/** Удалить снимок завершённой игры (стереть файлы + недописанный хвост). */
export function persistDelete(id: GameID): void {
  if (!persistEnabled()) return;
  pendingTurns.delete(id);
  pendingMeta.delete(id);
  deletedIds.add(id);
  try {
    rmSync(metaPath(id), { force: true });
    rmSync(turnsPath(id), { force: true });
  } catch {
    /* ignore */
  }
  // Снимок мог быть В ПОЛЁТЕ (writeFile уже ушёл в threadpool, rename следом):
  // добиваем ещё раз ПОСЛЕ текущей цепочки записи, чтобы файл не пережил игру.
  metaChain = metaChain.then(async () => {
    try {
      await rm(metaPath(id), { force: true });
      await rm(metaPath(id) + ".tmp", { force: true });
    } catch {
      /* ignore */
    }
  });
}

/** Загрузить снимки игр, принадлежащих ЭТОМУ воркеру (по workerIndex(id)). */
export function loadForWorker(): LoadedGame[] {
  if (!persistEnabled()) return [];
  const out: LoadedGame[] = [];
  let myWorker: number;
  try {
    myWorker = ServerEnv.workerId() ?? 0;
  } catch {
    return out;
  }
  let files: string[];
  try {
    ensureDir();
    files = readdirSync(persistDir());
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.endsWith(".meta.json")) continue;
    const id = f.slice(0, -".meta.json".length);
    let meta: GameMeta;
    try {
      if (ServerEnv.workerIndex(id) !== myWorker) continue;
      meta = JSON.parse(
        readFileSync(join(persistDir(), f), "utf8"),
      ) as GameMeta;
    } catch {
      continue;
    }
    const turns: Turn[] = [];
    try {
      const raw = existsSync(turnsPath(id))
        ? readFileSync(turnsPath(id), "utf8")
        : "";
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (t) turns.push(JSON.parse(t) as Turn);
      }
    } catch {
      /* повреждённый хвост лога — берём что распарсилось */
    }
    out.push({ meta, turns });
  }
  return out;
}

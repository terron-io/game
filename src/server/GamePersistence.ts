import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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
  /** terron 28.09: отпечаток ядра, на котором матч начался (ServerEnv.coreHash). */
  coreHash?: string;
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

// terron 29.09: у каких игр прошлая запись упала посреди строки (ENOSPC и т. п.).
// Следующая запись начинается с перевода строки: огрызок остаётся отдельной
// битой строкой, её пропускает загрузчик, а не склеивает с целым ходом.
const brokenTail = new Set<GameID>();

function takePendingBatch(): Array<[GameID, string[]]> {
  const out: Array<[GameID, string[]]> = [];
  for (const [id, lines] of pendingTurns) out.push([id, lines]);
  pendingTurns.clear();
  return out;
}

function takePending(): Array<[string, string]> {
  return takePendingBatch().map(([id, lines]) => [
    turnsPath(id),
    chunkFor(id, lines),
  ]);
}

function chunkFor(id: GameID, lines: string[]): string {
  const head = brokenTail.has(id) ? "\n" : "";
  return head + lines.join("\n") + "\n";
}

/**
 * Вернуть недописанное в НАЧАЛО очереди (до ходов, пришедших за время записи):
 * порядок ходов в логе обязан сохраниться, иначе резюм после рестарта разойдётся.
 * terron 29.09: раньше партия при ошибке просто выбрасывалась — 28.09 при 96 %
 * диска так пропала секунда ходов всех идущих матчей.
 */
function requeue(rest: Array<[GameID, string[]]>): void {
  for (const [id, lines] of rest) {
    if (deletedIds.has(id)) continue;
    brokenTail.add(id);
    const newer = pendingTurns.get(id) ?? [];
    pendingTurns.set(id, [...lines, ...newer]);
  }
  if (flushTimer === null && pendingTurns.size > 0) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPendingAsync();
    }, RETRY_MS);
  }
}
const RETRY_MS = 2000;

function flushPendingAsync(): void {
  const batch = takePendingBatch();
  if (batch.length === 0) return;
  flushChain = flushChain.then(async () => {
    let i = 0;
    try {
      if (!dirEnsured) {
        ensureDir();
        dirEnsured = true;
      }
      for (; i < batch.length; i++) {
        const [id, lines] = batch[i];
        if (deletedIds.has(id)) continue;
        await appendFile(turnsPath(id), chunkFor(id, lines));
        brokenTail.delete(id);
      }
    } catch (e) {
      warnOnce("flushPendingAsync", e);
      requeue(batch.slice(i));
    }
  });
}

/** Дозапись хода в лог (батчится, см. коммент выше).
 *  terron ПЕРФ (21.08): принимает УЖЕ сериализованный ход (`JSON.stringify(turn)`)
 *  — GameServer.endTurn сериализует ход один раз и для броадкаста, и сюда.
 *  Строка в файл ложится как есть → формат ndjson побайтово прежний. */
export function persistTurn(id: GameID, turnJson: string): void {
  if (!persistEnabled()) return;
  // terron 29.09: ход после persistDelete (игра кончилась, а endTurn ещё тикнул)
  // раньше ложился в новый файл без снимка — за июль–сентябрь 1429 сирот.
  if (deletedIds.has(id)) return;
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
  // terron 29.09: логи ходов без снимка никогда не резюмятся — это хвосты
  // закончившихся игр. Старше суток — удаляем (свежие не трогаем: снимок
  // пишется с задержкой, и соседний воркер мог только что начать игру).
  const names = new Set(files);
  for (const f of files) {
    if (!f.endsWith(".turns.ndjson")) continue;
    const id = f.slice(0, -".turns.ndjson".length);
    if (names.has(`${id}.meta.json`)) continue;
    try {
      const p = join(persistDir(), f);
      if (Date.now() - statSync(p).mtimeMs > 24 * 3600_000)
        rmSync(p, { force: true });
    } catch {
      /* не наше дело — пропускаем */
    }
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
      turns.push(...parseTurnLog(raw));
    } catch {
      /* файл не прочитался — резюмим без ходов, как раньше */
    }
    out.push({ meta, turns });
  }
  return out;
}

/**
 * terron 29.09: разбор лога ходов для резюма. Битые строки (огрызок записи,
 * упавшей посреди строки) пропускаем, повторы отбрасываем, на ДЫРЕ в номерах
 * останавливаемся: ходы после пропуска без него бесполезны — симуляция разошлась бы.
 */
export function parseTurnLog(raw: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let turn: Turn;
    try {
      turn = JSON.parse(t) as Turn;
    } catch {
      continue;
    }
    if (typeof turn?.turnNumber !== "number") continue;
    if (turn.turnNumber < turns.length) continue;
    if (turn.turnNumber > turns.length) break;
    turns.push(turn);
  }
  return turns;
}

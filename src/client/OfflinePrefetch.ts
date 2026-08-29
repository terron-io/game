import { assetUrl, getAssetManifest } from "../core/AssetUrls";
import { GameMapType } from "../core/game/Game";
import { netBusy, netConstrained } from "./NetPriority";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

// terron: офлайн-прегрев при наличии сети. Делает офлайн-режим целостным:
//  1) World — единственная ПОЛНОСТЬЮ играбельная карта офлайн (её бины кладём в
//     MapCache). Остальные играбельны только после онлайн-партии.
//  2) ВСЕ UI-иконки (images/*.svg) — чтобы HUD/чат/иконки карт не были битыми
//     офлайн (их кеширует service worker по факту запроса; прегреваем заранее).
//  3) Featured-карты: манифест (→MapCache) + тумба (→SW) — чтобы пикер офлайн был
//     полным (превью на месте), хоть и помечен «недоступно» без бинов.
//
// ⚠️ ПОЛИТИКА ЗАПУСКА (2026-07-05, переработана по замечанию владельца):
// «кэшировать надо то, что скачали ПОКА ИГРАЛИ, а не лить всё при заходе».
// Пассивное кэширование и так работает само (MapCache network-first + SW по
// факту запроса) — сыгранный матч оставляет карту и иконки в кэше. Поэтому:
//  - обычная веб-вкладка: прегрев ТОЛЬКО ПОСЛЕ первого сыгранного матча
//    (schedulePostGamePrefetch из Main при выходе в меню) — докачиваем дыры:
//    World (если играл не на нём) и незапрошенные иконки. Случайный посетитель
//    не тратит ни байта мобильного трафика на офлайн, которым не пользуется;
//  - нативная апка и PWA-standalone (кандидаты на офлайн): прегрев вскоре
//    после запуска (registerServiceWorker) — там это уместно/дёшево.
// ДИСЦИПЛИНА СЕТИ: перед каждым куском и между запросами уступаем, если игровой
// трафик занят (netBusy: лобби греет карту или идёт матч); на Save-Data/2g не
// качаем вообще; параллелизм срезан, чтобы не душить канал.

const FEATURED: GameMapType[] = [
  GameMapType.World,
  GameMapType.Europe,
  GameMapType.NorthAmerica,
  GameMapType.SouthAmerica,
  GameMapType.Asia,
  GameMapType.Africa,
  GameMapType.Japan,
];

// Пауза-перепроверка, когда канал занят игровым трафиком.
const BACKOFF_MS = 10_000;
// После выхода из матча даём пост-матчевым экранам/статистике дозагрузиться.
const POST_GAME_DELAY_MS = 15_000;

let done = false;
let postGameScheduled = false;

/** Прегрев после первого сыгранного матча (зовёт Main при выходе в меню).
 *  Идемпотентно; сам уступает канал, если юзер тут же зашёл в новое лобби. */
export function schedulePostGamePrefetch(): void {
  if (done || postGameScheduled) return;
  postGameScheduled = true;
  setTimeout(() => {
    postGameScheduled = false;
    void prefetchOfflineMaps();
  }, POST_GAME_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Уступить канал: пока игровой трафик занят — ждём. best-effort, без дедлайна
// (матч может идти долго; прегрев спокойно продолжится после выхода в меню).
async function yieldToGame(): Promise<void> {
  while (netBusy()) {
    await sleep(BACKOFF_MS);
  }
}

async function fetchQuiet(url: string): Promise<void> {
  try {
    await fetch(url);
  } catch {
    /* нет сети — не критично */
  }
}

// Ограничитель параллелизма + уступание игровому трафику между задачами.
async function runPool(
  tasks: Array<() => Promise<void>>,
  limit = 3,
): Promise<void> {
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (i < tasks.length) {
        if (netBusy()) {
          await sleep(BACKOFF_MS);
          continue;
        }
        await tasks[i++]();
      }
    },
  );
  await Promise.all(workers);
}

export async function prefetchOfflineMaps(): Promise<void> {
  if (done) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  // Экономный режим (Save-Data / 2g): фоновые мегабайты не качаем вовсе.
  if (netConstrained()) return;
  done = true;

  await yieldToGame();

  try {
    // 1) World целиком (бины + манифест + тумба)
    const w = terrainMapFileLoader.getMapData(GameMapType.World);
    await Promise.all([w.mapBin(), w.map4xBin(), w.map16xBin(), w.manifest()]);
    await fetchQuiet(w.webpPath);
  } catch {
    done = false; // World не прогрелся — позволим повторить
    return;
  }

  // 2) Все UI-иконки (best-effort, в фоне)
  await yieldToGame();
  try {
    const manifest = getAssetManifest();
    const iconTasks = Object.keys(manifest)
      .filter((k) => /^images\/.*\.svg$/.test(k))
      .map((k) => () => fetchQuiet(assetUrl(k)));
    await runPool(iconTasks, 3);
  } catch {
    /* нет манифеста — пропустим */
  }

  // 3) Featured-карты: манифест + тумба (без тяжёлых бинов)
  await yieldToGame();
  const mapTasks = FEATURED.map((m) => async () => {
    try {
      const d = terrainMapFileLoader.getMapData(m);
      await d.manifest();
      await fetchQuiet(d.webpPath);
    } catch {
      /* пропустим */
    }
  });
  await runPool(mapTasks, 2);
}

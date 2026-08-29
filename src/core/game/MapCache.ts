// terron: офлайн-кеш карт. Бинарники/манифесты карт, загруженные во время игры,
// складываем в Cache Storage с бюджетом 50 МБ и вытеснением по LRU (без TTL —
// карта живёт в кеше пока её не вытеснит более свежая по достижении лимита).
// Это даёт «сыграл на Луне → Луна осталась офлайн». Карта World в офлайне
// доступна и без этого кеша: она прекешена service worker'ом (веб) и/или лежит
// в нативном бандле.
//
// Работает и в окне, и в Worker'е — Cache Storage доступен в обоих контекстах.
// Индекс размеров/времён хранится отдельной записью внутри того же кеша (чтобы
// не зависеть от localStorage, которого в Worker'е нет).

const CACHE_NAME = "terron-map-cache-v1";
// Синтетический ключ для индекса. Same-origin не требуется для записи в Cache,
// но используем явно «локальный» хост, чтобы не пересечься с реальным URL карты.
const INDEX_KEY = "https://terron.local/__map_cache_index__";
const BUDGET_BYTES = 50 * 1024 * 1024; // 50 МБ на устройстве

interface IndexEntry {
  size: number; // байт
  used: number; // Date.now() последнего обращения (для LRU)
}
type CacheIndex = Record<string, IndexEntry>;

function cachesAvailable(): boolean {
  try {
    return typeof caches !== "undefined";
  } catch {
    return false;
  }
}

async function readIndex(cache: Cache): Promise<CacheIndex> {
  try {
    const res = await cache.match(INDEX_KEY);
    if (!res) return {};
    return (await res.json()) as CacheIndex;
  } catch {
    return {};
  }
}

async function writeIndex(cache: Cache, index: CacheIndex): Promise<void> {
  try {
    await cache.put(
      INDEX_KEY,
      new Response(JSON.stringify(index), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch {
    /* кеш переполнен/недоступен — не критично */
  }
}

/** Имена папок карт, чьи бинарники реально лежат в офлайн-кеше (по map.bin).
 *  Используется, чтобы офлайн показывать/разрешать только доступные карты. */
export async function listCachedMapNames(): Promise<Set<string>> {
  const names = new Set<string>();
  if (!cachesAvailable()) return names;
  try {
    const cache = await caches.open(CACHE_NAME);
    const index = await readIndex(cache);
    for (const url in index) {
      // .../maps/<folder>/<любой>.bin → folder доступен офлайн. Имя бина может
      // быть захешировано при сборке (map.07f4….bin), поэтому матчим любой .bin.
      const m = url.match(/\/maps\/([^/]+)\/[^/]*\.bin(?:$|\?)/);
      if (m) names.add(m[1]);
    }
  } catch {
    /* нет доступа к кешу */
  }
  return names;
}

/** Достать ресурс карты из офлайн-кеша (null, если нет). Обновляет LRU-метку. */
export async function mapCacheGet(url: string): Promise<Response | null> {
  if (!cachesAvailable()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(url);
    if (!res) return null;
    // touch: помечаем как недавно использованный
    const index = await readIndex(cache);
    if (index[url]) {
      index[url].used = Date.now();
      void writeIndex(cache, index);
    }
    return res;
  } catch {
    return null;
  }
}

/** Положить ресурс карты в офлайн-кеш и при необходимости вытеснить старое. */
export async function mapCachePut(
  url: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  if (!cachesAvailable()) return;
  const size = body.byteLength;
  // Одиночный ресурс крупнее всего бюджета не кешируем (не бывает у карт, но
  // на всякий случай — иначе вытеснение зациклится).
  if (size > BUDGET_BYTES) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      url,
      new Response(body, { headers: { "Content-Type": contentType } }),
    );
    const index = await readIndex(cache);
    index[url] = { size, used: Date.now() };
    await enforceBudget(cache, index);
    await writeIndex(cache, index);
  } catch {
    /* кеш недоступен/переполнен — офлайн просто не сработает, не падаем */
  }
}

/** Вытеснить самые старые записи (LRU), пока суммарный объём > бюджета. */
async function enforceBudget(cache: Cache, index: CacheIndex): Promise<void> {
  let total = 0;
  for (const key in index) total += index[key].size;
  if (total <= BUDGET_BYTES) return;
  // по возрастанию used → самые давно использованные первыми
  const oldestFirst = Object.keys(index).sort(
    (a, b) => index[a].used - index[b].used,
  );
  for (const key of oldestFirst) {
    if (total <= BUDGET_BYTES) break;
    total -= index[key].size;
    delete index[key];
    try {
      await cache.delete(key);
    } catch {
      /* игнор */
    }
  }
}

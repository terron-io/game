import { GameMapType } from "./Game";
import { GameMapLoader, MapData } from "./GameMapLoader";
import { mapCacheGet, mapCachePut } from "./MapCache";

// terron: мемоизация промиса загрузки. Раньше каждый вызов mapBin() = НОВЫЙ
// fetch: префетч лобби + loadTerrainMap качали одни и те же бины параллельно
// (HTTP-кеш дедупит только ЗАВЕРШЁННЫЕ ответы) — на медленной сети канал
// делился надвое ровно у тех, кому и так тяжело. Ошибка сбрасывает кэш, чтобы
// следующий вызов пробовал заново (иначе один обрыв = карта мертва навсегда).
function memoAsync<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    p ??= fn().catch((e: unknown) => {
      p = null;
      throw e;
    });
    return p;
  };
}

const RETRY_DELAYS_MS = [1000, 3000];

export class FetchGameMapLoader implements GameMapLoader {
  private maps: Map<GameMapType, MapData>;

  public constructor(
    private readonly pathResolver: string | ((path: string) => string),
  ) {
    this.maps = new Map<GameMapType, MapData>();
  }

  public getMapData(map: GameMapType): MapData {
    const cachedMap = this.maps.get(map);
    if (cachedMap) {
      return cachedMap;
    }

    const key = Object.keys(GameMapType).find(
      (k) => GameMapType[k as keyof typeof GameMapType] === map,
    );
    const fileName = key?.toLowerCase();

    if (!fileName) {
      throw new Error(`Unknown map: ${map}`);
    }

    const mapData = {
      mapBin: memoAsync(() => this.loadBinaryFromUrl(this.url(fileName, "map.bin"))),
      map4xBin: memoAsync(() =>
        this.loadBinaryFromUrl(this.url(fileName, "map4x.bin")),
      ),
      map16xBin: memoAsync(() =>
        this.loadBinaryFromUrl(this.url(fileName, "map16x.bin")),
      ),
      manifest: memoAsync(() =>
        this.loadJsonFromUrl(this.url(fileName, "manifest.json")),
      ),
      webpPath: this.url(fileName, "thumbnail.webp"),
      webpSmallPath: this.url(fileName, "thumbnail-sm.webp"),
    } satisfies MapData;

    this.maps.set(map, mapData);
    return mapData;
  }

  private resolveUrl(path: string): string {
    if (typeof this.pathResolver === "function") {
      return this.pathResolver(path);
    }
    return `${this.pathResolver}/${path}`;
  }

  private url(map: string, path: string) {
    return this.resolveUrl(`${map}/${path}`);
  }

  private async fetchOnce(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  // terron: обрыв TCP посреди 2-10МБ на рваной мобильной сети раньше = сразу
  // исключение → у первого запуска пустой MapCache → «Connection error» («90%
  // первых запусков не работают»). Ретраим с бэкоффом; таймаута нет намеренно —
  // медленная, но живая закачка не должна убиваться. Зовётся ТОЛЬКО когда кеша
  // нет (офлайн-фолбэк проверяется раньше и не ждёт ретрай-пауз).
  private async retryFetch(url: string, firstErr: unknown): Promise<ArrayBuffer> {
    let lastErr = firstErr;
    for (const delay of RETRY_DELAYS_MS) {
      await new Promise((r) => setTimeout(r, delay));
      console.warn(`[MapLoader] retry ${url}`);
      try {
        return await this.fetchOnce(url);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  // terron: network-first с офлайн-фолбэком. Онлайн → грузим свежее с сети и
  // кладём в офлайн-кеш (50 МБ LRU, см. MapCache). Сеть упала/нет интернета →
  // отдаём из кеша, если карта там есть; кеша нет → ретраи (рваная сеть,
  // первый запуск). World в офлайне доступен через service worker / нативный бандл.
  private async loadBinaryFromUrl(url: string) {
    const startTime = performance.now();
    let data: ArrayBuffer;
    try {
      data = await this.fetchOnce(url);
    } catch (e) {
      const cached = await mapCacheGet(url);
      if (cached) {
        console.log(`[MapLoader] ${url}: офлайн (из кеша)`);
        return new Uint8Array(await cached.arrayBuffer());
      }
      data = await this.retryFetch(url, e);
    }
    void mapCachePut(url, data, "application/octet-stream");
    console.log(
      `[MapLoader] ${url}: ${(performance.now() - startTime).toFixed(0)}ms`,
    );
    return new Uint8Array(data);
  }

  private async loadJsonFromUrl(url: string) {
    let data: ArrayBuffer;
    try {
      data = await this.fetchOnce(url);
    } catch (e) {
      const cached = await mapCacheGet(url);
      if (cached) return cached.json();
      data = await this.retryFetch(url, e);
    }
    void mapCachePut(url, data, "application/json");
    return JSON.parse(new TextDecoder().decode(data));
  }
}

import { GameMapSize, GameMapType, TeamGameSpawnAreas } from "./Game";
import { GameMap, GameMapImpl } from "./GameMap";
import { GameMapLoader } from "./GameMapLoader";

export type TerrainMapData = {
  nations: Nation[];
  additionalNations: AdditionalNation[];
  gameMap: GameMap;
  /**
   * terron ПЕРФ (память, 12.07): мини-карта ЛЕНИВАЯ (мемоизированная фабрика).
   * Она нужна только симуляции (пасфайндинг лодок в воркере) — главный поток
   * её никогда не трогает, а раньше парсил и держал зря (на гиганте ~6МБ кучи
   * + лишняя загрузка map4x-бинаря в самый пик старта).
   */
  miniGameMap: () => Promise<GameMap>;
  teamGameSpawnAreas?: TeamGameSpawnAreas;
};

const loadedMaps = new Map<string, TerrainMapData>();

/**
 * terron ПЕРФ (память, 12.07): сброс кэша распарсенных карт. Зовётся из
 * teardown матча на главном потоке (ClientGameRunner.disposeGraphics):
 * 1) кэш копил 24-30МБ кучи на каждую сыгранную карту навсегда;
 * 2) GameMapImpl в кэше мутируется матчем (owner-стейт, терраформинг) —
 *    повторный матч на той же карте получил бы грязную карту.
 * Воркер живёт один матч и умирает вместе со своим кэшем — ему не нужно.
 */
export function clearTerrainMapCache(): void {
  loadedMaps.clear();
}

export interface MapMetadata {
  width: number;
  height: number;
  num_land_tiles: number;
}

export interface MapManifest {
  name: string;
  map: MapMetadata;
  map4x: MapMetadata;
  map16x: MapMetadata;
  nations: Nation[];
  // Optional pool of fallback nation names used when a game requests more
  // nations than the manifest defines. Picked at random; if still not enough,
  // the remainder is generated procedurally.
  additionalNations?: AdditionalNation[];
  teamGameSpawnAreas?: TeamGameSpawnAreas;
}

export interface Nation {
  coordinates?: [number, number];
  flag?: string;
  name: string;
}

export interface AdditionalNation {
  coordinates?: [number, number];
  flag?: string;
  name: string;
}

export async function loadTerrainMap(
  map: GameMapType,
  mapSize: GameMapSize,
  terrainMapFileLoader: GameMapLoader,
): Promise<TerrainMapData> {
  const cacheKey = `${map}:${mapSize}`;
  const cached = loadedMaps.get(cacheKey);
  if (cached !== undefined) return cached;
  const mapFiles = terrainMapFileLoader.getMapData(map);
  const manifest = await mapFiles.manifest();

  const gameMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(manifest.map, await mapFiles.mapBin())
      : await genTerrainFromBin(manifest.map4x, await mapFiles.map4xBin());

  // Мини-карта — лениво: качаем и парсим только при первом вызове (воркер,
  // init симуляции). Мемоизация промисом — повторные вызовы бесплатны.
  let miniMapPromise: Promise<GameMap> | null = null;
  const miniGameMap = (): Promise<GameMap> => {
    miniMapPromise ??=
      mapSize === GameMapSize.Normal
        ? mapFiles
            .map4xBin()
            .then((bin) => genTerrainFromBin(manifest.map4x, bin))
        : mapFiles
            .map16xBin()
            .then((bin) => genTerrainFromBin(manifest.map16x, bin));
    return miniMapPromise;
  };

  if (mapSize === GameMapSize.Compact) {
    manifest.nations.forEach((nation) => {
      if (nation.coordinates !== undefined) {
        nation.coordinates = [
          Math.floor(nation.coordinates[0] / 2),
          Math.floor(nation.coordinates[1] / 2),
        ];
      }
    });
    manifest.additionalNations?.forEach((nation) => {
      if (nation.coordinates !== undefined) {
        nation.coordinates = [
          Math.floor(nation.coordinates[0] / 2),
          Math.floor(nation.coordinates[1] / 2),
        ];
      }
    });
  }

  // Scale spawn areas for compact maps
  let teamGameSpawnAreas = manifest.teamGameSpawnAreas;
  if (mapSize === GameMapSize.Compact && teamGameSpawnAreas) {
    const scaled: TeamGameSpawnAreas = {};
    for (const [key, areas] of Object.entries(teamGameSpawnAreas)) {
      scaled[key] = areas.map((a) => ({
        x: Math.floor(a.x / 2),
        y: Math.floor(a.y / 2),
        width: Math.max(1, Math.floor(a.width / 2)),
        height: Math.max(1, Math.floor(a.height / 2)),
      }));
    }
    teamGameSpawnAreas = scaled;
  }

  const result = {
    nations: manifest.nations,
    additionalNations: manifest.additionalNations ?? [],
    gameMap: gameMap,
    miniGameMap,
    teamGameSpawnAreas,
  };
  loadedMaps.set(cacheKey, result);
  return result;
}

export async function genTerrainFromBin(
  mapData: MapMetadata,
  data: Uint8Array,
): Promise<GameMap> {
  if (data.length !== mapData.width * mapData.height) {
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${mapData.width}x${mapData.height} terrain plus 4 bytes for dimensions.`,
    );
  }

  return new GameMapImpl(
    mapData.width,
    mapData.height,
    data,
    mapData.num_land_tiles,
  );
}

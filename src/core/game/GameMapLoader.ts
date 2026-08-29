import { GameMapType } from "./Game";
import { MapManifest } from "./TerrainMapLoader";

export interface GameMapLoader {
  getMapData(map: GameMapType): MapData;
}

export interface MapData {
  mapBin: () => Promise<Uint8Array>;
  map4xBin: () => Promise<Uint8Array>;
  map16xBin: () => Promise<Uint8Array>;
  manifest: () => Promise<MapManifest>;
  webpPath: string;
  // terron: лёгкая копия превью (480px) для узких экранов — карточка лобби
  // отдаёт её через <picture media>. Полный 1200px остаётся десктопу, где слот
  // карточки 855 CSS px и мылить нельзя. Генерится scripts/regen-thumbnails.py.
  webpSmallPath: string;
}

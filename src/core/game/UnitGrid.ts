import { PlayerID, Unit, UnitType } from "./Game";
import { GameMap, TileRef } from "./GameMap";
import { UnitView } from "./GameView";

export type UnitPredicate = (value: {
  unit: Unit | UnitView;
  distSquared: number;
}) => boolean;

export class UnitGrid {
  private grid: Map<UnitType, Set<Unit | UnitView>>[][];
  private readonly cellSize = 100;
  // terron 11.09 ПЕРФ: ширина карты — для координат арифметикой по ref.
  // `gm.x()/gm.y()` через интерфейс были 2.4 с из 66 на боевом реплее, 40 % —
  // из updateUnitCell (каждый ход каждого корабля/поезда), 22 % — из nearbyUnits.
  // Формула та же, что в GameMapImpl (`ref % w`, `(ref / w) | 0`) — результат
  // байт-в-байт, хэш симуляции не задет.
  private readonly w: number;

  constructor(private gm: GameMap) {
    this.w = gm.width();
    this.grid = Array(Math.ceil(gm.height() / this.cellSize))
      .fill(null)
      .map(() =>
        Array(Math.ceil(gm.width() / this.cellSize))
          .fill(null)
          .map(() => new Map<UnitType, Set<Unit | UnitView>>()),
      );
  }

  // Get grid coordinates from pixel coordinates
  private getGridCoords(x: number, y: number): [number, number] {
    return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
  }

  /** Колонка ячейки сетки по тайлу — без кортежа и без вызова GameMap. */
  private cellX(tile: TileRef): number {
    return Math.floor((tile % this.w) / this.cellSize);
  }
  private cellY(tile: TileRef): number {
    return Math.floor(((tile / this.w) | 0) / this.cellSize);
  }

  // Add a unit to the grid
  addUnit(unit: Unit | UnitView) {
    const tile = unit.tile();
    const gridX = this.cellX(tile);
    const gridY = this.cellY(tile);

    if (this.isValidCell(gridX, gridY)) {
      const unitSet = this.grid[gridY][gridX].get(unit.type());
      if (unitSet !== undefined) {
        unitSet.add(unit);
      } else {
        this.grid[gridY][gridX].set(
          unit.type(),
          new Set<Unit | UnitView>([unit]),
        );
      }
    }
  }

  // Remove a unit from the grid
  removeUnit(unit: Unit | UnitView) {
    const tile = unit.tile();
    this.removeUnitByTile(unit, tile);
  }

  removeUnitByTile(unit: Unit | UnitView, tile: TileRef) {
    const gridX = this.cellX(tile);
    const gridY = this.cellY(tile);

    if (this.isValidCell(gridX, gridY)) {
      const unitSet = this.grid[gridY][gridX].get(unit.type());
      if (unitSet !== undefined) {
        unitSet.delete(unit);
      }
    }
  }

  /**
   * Move an unit to its new cell if it changed
   */
  updateUnitCell(unit: Unit | UnitView) {
    const newTile = unit.tile();
    const oldTile = unit.lastTile();
    // Тот же тайл — та же ячейка, дальше считать нечего (стоящие юниты).
    if (oldTile === newTile) return;
    const gridX = this.cellX(oldTile);
    const gridY = this.cellY(oldTile);
    const newGridX = this.cellX(newTile);
    const newGridY = this.cellY(newTile);
    if (gridX !== newGridX || gridY !== newGridY) {
      this.removeUnitByTile(unit, oldTile);
      this.addUnit(unit);
    }
  }

  private isValidCell(gridX: number, gridY: number): boolean {
    return (
      gridX >= 0 &&
      gridX < this.grid[0].length &&
      gridY >= 0 &&
      gridY < this.grid.length
    );
  }

  // Compute the exact cells in range of tile
  private getCellsInRange(tile: TileRef, range: number) {
    const x = this.gm.x(tile);
    const y = this.gm.y(tile);
    const cellSize = this.cellSize;
    const [gridX, gridY] = this.getGridCoords(x, y);
    const startGridX = Math.max(
      0,
      gridX - Math.ceil((range - (x % cellSize)) / cellSize),
    );
    const endGridX = Math.min(
      this.grid[0].length - 1,
      gridX + Math.ceil((range - (cellSize - (x % cellSize))) / cellSize),
    );
    const startGridY = Math.max(
      0,
      gridY - Math.ceil((range - (y % cellSize)) / cellSize),
    );
    const endGridY = Math.min(
      this.grid.length - 1,
      gridY + Math.ceil((range - (cellSize - (y % cellSize))) / cellSize),
    );

    return { startGridX, endGridX, startGridY, endGridY };
  }

  private squaredDistanceFromTile(
    unit: Unit | UnitView,
    tile: TileRef,
  ): number {
    const x = this.gm.x(tile);
    const y = this.gm.y(tile);
    const tileX = this.gm.x(unit.tile());
    const tileY = this.gm.y(unit.tile());
    const dx = tileX - x;
    const dy = tileY - y;
    const distSquared = dx * dx + dy * dy;
    return distSquared;
  }

  // Get all units within range of a point
  // Returns [unit, distanceSquared] pairs for efficient filtering
  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[] | UnitType,
    predicate?: UnitPredicate,
    includeUnderConstruction: boolean = false,
  ): Array<{ unit: Unit | UnitView; distSquared: number }> {
    const nearby: Array<{ unit: Unit | UnitView; distSquared: number }> = [];
    const w = this.w;
    const x = tile % w;
    const y = (tile / w) | 0;
    const { startGridX, endGridX, startGridY, endGridY } = this.getCellsInRange(
      tile,
      searchRange,
    );
    const rangeSquared = searchRange * searchRange;

    if (Array.isArray(types)) {
      for (let cy = startGridY; cy <= endGridY; cy++) {
        for (let cx = startGridX; cx <= endGridX; cx++) {
          const cell = this.grid[cy][cx];
          for (const type of types) {
            const unitSet = cell.get(type);
            if (unitSet === undefined) continue;
            for (const unit of unitSet) {
              if (!unit.isActive()) continue;
              // Exclude units under construction by default (e.g., defense posts being built)
              // But include them for spacing checks
              if (!includeUnderConstruction && unit.isUnderConstruction())
                continue;
              const unitTile = unit.tile();
              const dx = (unitTile % w) - x;
              const dy = ((unitTile / w) | 0) - y;
              const distSquared = dx * dx + dy * dy;
              if (distSquared > rangeSquared) continue;
              const value = { unit, distSquared };
              if (predicate !== undefined && !predicate(value)) continue;
              nearby.push(value);
            }
          }
        }
      }
      return nearby;
    }

    const type = types;
    for (let cy = startGridY; cy <= endGridY; cy++) {
      for (let cx = startGridX; cx <= endGridX; cx++) {
        const unitSet = this.grid[cy][cx].get(type as UnitType);
        if (unitSet === undefined) continue;
        for (const unit of unitSet) {
          if (!unit.isActive()) continue;
          // Exclude units under construction by default (e.g., defense posts being built)
          // But include them for spacing checks
          if (!includeUnderConstruction && unit.isUnderConstruction()) continue;
          const unitTile = unit.tile();
          const dx = (unitTile % w) - x;
          const dy = ((unitTile / w) | 0) - y;
          const distSquared = dx * dx + dy * dy;
          if (distSquared > rangeSquared) continue;
          const value = { unit, distSquared };
          if (predicate !== undefined && !predicate(value)) continue;
          nearby.push(value);
        }
      }
    }
    return nearby;
  }

  private unitIsInRange(
    unit: Unit | UnitView,
    tile: TileRef,
    rangeSquared: number,
    playerId?: PlayerID,
    includeUnderConstruction: boolean = false,
  ): boolean {
    if (!unit.isActive()) {
      return false;
    }
    // Exclude units under construction by default (e.g., defense posts being built)
    // But include them for spacing checks
    if (!includeUnderConstruction && unit.isUnderConstruction()) {
      return false;
    }
    if (playerId !== undefined && unit.owner().id() !== playerId) {
      return false;
    }
    const distSquared = this.squaredDistanceFromTile(unit, tile);
    return distSquared <= rangeSquared;
  }

  // Return true if it finds an owned specific unit in range
  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction: boolean = false,
  ): boolean {
    const { startGridX, endGridX, startGridY, endGridY } = this.getCellsInRange(
      tile,
      searchRange,
    );
    const rangeSquared = searchRange * searchRange;
    for (let cy = startGridY; cy <= endGridY; cy++) {
      for (let cx = startGridX; cx <= endGridX; cx++) {
        const unitSet = this.grid[cy][cx].get(type);
        if (unitSet === undefined) continue;
        for (const unit of unitSet) {
          if (
            this.unitIsInRange(
              unit,
              tile,
              rangeSquared,
              playerId,
              includeUnderConstruction,
            )
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // Return true if any unit of the given types matches the predicate
  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: Unit | UnitView) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction: boolean = false,
  ): boolean {
    const { startGridX, endGridX, startGridY, endGridY } = this.getCellsInRange(
      tile,
      searchRange,
    );
    const rangeSquared = searchRange * searchRange;
    for (let cy = startGridY; cy <= endGridY; cy++) {
      for (let cx = startGridX; cx <= endGridX; cx++) {
        for (const type of types) {
          const unitSet = this.grid[cy][cx].get(type);
          if (unitSet === undefined) continue;
          for (const unit of unitSet) {
            if (
              !this.unitIsInRange(
                unit,
                tile,
                rangeSquared,
                playerId,
                includeUnderConstruction,
              )
            ) {
              continue;
            }
            if (predicate(unit)) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }
}

// terron: авиация — ИИ-нации пользуются авиацией с аэропортов: воздушная высадка десанта
// (AirborneAssaultExecution) и дрон-камикадзе (SuicideDroneExecution). Спека: airport.md
import {
  Game,
  Gold,
  Player,
  Relation,
  Structures,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { AirborneAssaultExecution } from "../AirborneAssaultExecution";
import { SuicideDroneExecution } from "../SuicideDroneExecution";
import { AiAttackBehavior } from "../utils/AiAttackBehavior";
import { randTerritoryTileArray } from "./NationUtils";

// Макс. манхеттен-дальность аэропорт→цель: борта дорогие, не гоняем через всю карту.
const MAX_AIR_RANGE = 250;
// Доля войск, уходящая в десант (остальное — на оборону/экспансию).
const ASSAULT_TROOP_RATIO = 0.3;
// Не пускаем десант, если войск совсем мало (иначе нация раздевается догола).
const MIN_ASSAULT_TROOPS = 5_000;
// Частота (1/N за «ход» нации ≈ 30–70 тиков): десант ~реже, дрон ~реже нюков.
const ASSAULT_ONE_IN = 8;
const DRONE_ONE_IN = 10;

export class NationAirBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private attackBehavior: AiAttackBehavior,
  ) {}

  // Воздушная высадка десанта в тыл врага с ближайшего аэропорта.
  maybeAirAssault(): void {
    if (this.game.config().isUnitDisabled(UnitType.AirborneAssault)) return;
    const airports = this.activeAirports();
    if (airports.length === 0) return;
    if (!this.random.chance(ASSAULT_ONE_IN)) return;
    if (this.player.gold() < this.cost(UnitType.AirborneAssault)) return;

    const troops = Math.floor(this.player.troops() * ASSAULT_TROOP_RATIO);
    if (troops < MIN_ASSAULT_TROOPS) return;

    const target = this.findAirTarget();
    if (target === null) return;

    // Ближайший к нашим аэропортам тайл территории цели (в пределах дальности).
    const tiles = randTerritoryTileArray(this.random, this.game, target, 10);
    let best: TileRef | null = null;
    let bestDist = MAX_AIR_RANGE;
    for (const t of tiles) {
      if (this.game.owner(t) !== target) continue;
      const d = this.nearestAirportDist(t, airports);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (best === null) return;

    this.game.addExecution(
      new AirborneAssaultExecution(this.player, best, troops),
    );
  }

  // Дрон-камикадзе (мини-ядерка) по вражескому сооружению с ближайшего аэропорта.
  maybeSendDrone(): void {
    if (this.game.config().isUnitDisabled(UnitType.SuicideDrone)) return;
    const airports = this.activeAirports();
    if (airports.length === 0) return;
    if (!this.random.chance(DRONE_ONE_IN)) return;
    if (this.player.gold() < this.cost(UnitType.SuicideDrone)) return;

    const target = this.findAirTarget();
    if (target === null) return;

    // Дрон = мини-ядерка → бьём по сооружению врага в пределах дальности.
    const structures = target.units(...Structures.types);
    let best: TileRef | null = null;
    let bestDist = MAX_AIR_RANGE;
    for (const s of structures) {
      const t = s.tile();
      const d = this.nearestAirportDist(t, airports);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (best === null) return;

    this.game.addExecution(new SuicideDroneExecution(this.player, best));
  }

  private activeAirports(): Unit[] {
    return this.player
      .units(UnitType.Airport)
      .filter((a) => a.isActive() && !a.isUnderConstruction());
  }

  private cost(type: UnitType): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player);
  }

  private nearestAirportDist(tile: TileRef, airports: Unit[]): number {
    let best = Infinity;
    for (const a of airports) {
      const d = this.game.manhattanDist(a.tile(), tile);
      if (d < best) best = d;
    }
    return best;
  }

  // Кого атаковать авиацией: сначала тот, кто нападает на нас; иначе — враждебный сосед.
  private findAirTarget(): Player | null {
    const incoming = this.attackBehavior.findIncomingAttackPlayer();
    if (
      incoming !== null &&
      incoming !== this.player &&
      !this.player.isFriendly(incoming) &&
      incoming.numTilesOwned() > 0
    ) {
      return incoming;
    }
    for (const rel of this.player.allRelationsSorted()) {
      if (rel.relation !== Relation.Hostile) continue;
      const other = rel.player;
      if (other === this.player || this.player.isFriendly(other)) continue;
      if (other.numTilesOwned() === 0) continue;
      return other;
    }
    return null;
  }
}

// terron: ЗЕЛЁНЫЕ — пассив «ОЗЕЛЕНЕНИЕ»: радиация сама отступает от границ
// владельца вглубь пепельного поля (new-units/GREEN.md, решение владельца
// 23.08 — «раньше так религия работала»).
//
// ⚠️ Почему обход, а не таймер на тайле: в движке пепел лежит ТОЛЬКО на
// ничейной суше и не выветривается сам НИКОГДА (снимается лишь захватом тайла
// либо превращением в воду). Поэтому чистка — активный обход от границы.
//
// ⚠️ Почему BFS идёт и по УЖЕ ОЧИЩЕННОЙ земле: снятие пепла территорию не даёт,
// граница владельца не двигается. Ходи мы только по соседям границы — фронт
// встал бы после первого кольца, и воронка глубиной больше тайла не убиралась
// бы никогда. Глубина ограничена REACH, объём — PER_PASS/VISIT_CAP.
import {
  TERRON_GREENS_CLEANUP_PER_PASS,
  TERRON_GREENS_CLEANUP_PERIOD_TICKS,
  TERRON_GREENS_CLEANUP_REACH,
  TERRON_GREENS_CLEANUP_VISIT_CAP,
} from "../configuration/TerronTuning";
import { Player, Unit } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { UltimateBuildingExecution } from "./UltimateBuildingExecution";

export class GreensExecution extends UltimateBuildingExecution {
  constructor(hq: Unit) {
    super(hq);
  }

  protected run(player: Player, ticks: number): void {
    if (ticks % TERRON_GREENS_CLEANUP_PERIOD_TICKS !== 0) return;
    this.greenify(player);
  }

  private greenify(player: Player): void {
    const mg = this.mg;
    // Обход стартует с ничейной суши, примыкающей к границе владельца.
    const visited = new Set<TileRef>();
    let frontier: TileRef[] = [];
    for (const border of player.borderTiles()) {
      for (const n of mg.neighbors(border)) {
        if (!mg.isLand(n) || mg.hasOwner(n)) continue;
        if (visited.has(n)) continue;
        visited.add(n);
        frontier.push(n);
      }
    }

    let cleared = 0;
    let depth = 0;
    while (
      frontier.length > 0 &&
      depth < TERRON_GREENS_CLEANUP_REACH &&
      cleared < TERRON_GREENS_CLEANUP_PER_PASS &&
      visited.size < TERRON_GREENS_CLEANUP_VISIT_CAP
    ) {
      const next: TileRef[] = [];
      for (const tile of frontier) {
        if (mg.hasFallout(tile)) {
          mg.clearFallout(tile);
          cleared++;
          if (cleared >= TERRON_GREENS_CLEANUP_PER_PASS) break;
        }
        for (const n of mg.neighbors(tile)) {
          // Идём только по ничейной суше: чужую и свою территорию не трогаем,
          // воду не пересекаем (радиация через море не отступает).
          if (!mg.isLand(n) || mg.hasOwner(n)) continue;
          if (visited.has(n)) continue;
          visited.add(n);
          next.push(n);
          if (visited.size >= TERRON_GREENS_CLEANUP_VISIT_CAP) break;
        }
      }
      frontier = next;
      depth++;
    }
  }
}

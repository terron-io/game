import {
  TERRON_NATION_COLLAPSE_FRAC,
  TERRON_NATION_COLLAPSE_MIN_PEAK,
  TERRON_NATION_MIN_TILES,
} from "../configuration/TerronTuning";
import { Execution, Game, PlayerType } from "../game/Game";

// terron: автосмерть НАЦИЙ-огрызков. Нация, ужатая до ≤ TERRON_NATION_MIN_TILES
// тайлов (обычно 1-2-пиксельные острова), капитулирует: тайлы отпускаются →
// isAlive()=false → штатный removeOnDeath в PlayerExecution приберёт юниты.
// Причина (репорты 17.07 «видно противника, а захватить нечего»): живые огрызки
// наций на микро-островах — их видно в топе, а добить можно только лодкой
// в 1 пиксель. Цвета territoriй починены отдельно (ColorAllocator), это —
// добивание самих огрызков. Людей и ботов-племена НЕ трогаем: люди сами решают,
// когда сдаваться, племена малы by design. Работает после спавн-фазы.
export class NationCullExecution implements Execution {
  private mg: Game | null = null;
  private active = true;

  init(mg: Game, _ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (ticks % 20 !== 0) return; // раз в ~2с — дёшево и достаточно
    if (this.mg === null) throw new Error("Not initialized");
    if (this.mg.inSpawnPhase()) return;
    for (const p of this.mg.players()) {
      if (p.type() !== PlayerType.Nation) continue;
      if (!p.isAlive()) continue;
      const n = p.numTilesOwned();
      if (n === 0) continue;
      // (A) огрызок: ≤ N тайлов (микро-остров).
      const tinyRemnant = n <= TERRON_NATION_MIN_TILES;
      // (B) СХЛОПНУВШАЯСЯ: была большой (пик ≥ MIN_PEAK), теперь < FRAC от пика.
      // Ловит «нация с 0.0% земли, но горой войск» — землю срезали, войска и
      // жизнь остались; абсолютный порог (A) их не берёт (у них сотни тайлов).
      const peak = p.maxTilesOwned();
      const collapsed =
        peak >= TERRON_NATION_COLLAPSE_MIN_PEAK &&
        n < peak * TERRON_NATION_COLLAPSE_FRAC;
      if (!tinyRemnant && !collapsed) continue;
      // Копия сета: relinquish мутирует p.tiles() по ходу итерации.
      for (const t of [...p.tiles()]) {
        p.relinquish(t);
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

// terron 23.08: КОСМОДРОМ — период между запусками. ОДНА функция на сим и на
// клиент: циферблат отката обязан показывать то же число, по которому реально
// уходит запуск, иначе морская площадка «врёт» вдвое. SPACE.md
import {
  TERRON_SPACEPORT_PERIOD_TICKS,
  TERRON_SPACEPORT_SEA_RATE_MULT,
} from "../configuration/TerronTuning";
import { TileRef } from "./GameMap";

/** Мини-интерфейс: и Game, и GameView отвечают на этот вопрос одинаково. */
interface OceanQuery {
  isOcean(tile: TileRef): boolean;
}

/**
 * Морская площадка отправляет запуски ВДВОЕ чаще сухопутной (решение владельца
 * 23.08): она и стоит вдвое дороже.
 */
export function spaceportPeriodTicks(
  game: OceanQuery,
  tile: TileRef,
): number {
  return game.isOcean(tile)
    ? Math.max(1, Math.floor(TERRON_SPACEPORT_PERIOD_TICKS / TERRON_SPACEPORT_SEA_RATE_MULT))
    : TERRON_SPACEPORT_PERIOD_TICKS;
}

// terron 23.08 — ВЗРЫВНЫЕ ПОЕЗДА, штаб «Депо» (new-units/TRAINS.md).
//
// Само депо ничего не взрывает: оно (1) ускоряет поезда владельца — это
// делает TrainExecution по hasUltimate, и (2) считает, куда по СВОИМ рельсам
// доедет состав, и отдаёт эту зону клиенту тем же полем railReach, что и
// «Дора». Расчёт общий (game/RailReach.ts) — именно ради второй едущей по
// рельсам ульты он и вынесен в модуль.
import { TERRON_TRAINS_REACH_MAX } from "../configuration/TerronTuning";
import { Player } from "../game/Game";
import { railTilesFrom, thinReach } from "../game/RailReach";
import { UltimateBuildingExecution } from "./UltimateBuildingExecution";

/** Сеть меняется небыстро — пересчитываем раз в секунду. */
const CACHE_TICKS = 10;

export class TrainDepotExecution extends UltimateBuildingExecution {
  private at = -1000;

  protected run(player: Player, ticks: number): void {
    if (ticks - this.at < CACHE_TICKS) return;
    this.at = ticks;
    // true = вместе с чужими перегонами: состав ходит по ВСЕЙ соединённой
    // сети, и облако зоны обязано показывать ровно её.
    const tiles = railTilesFrom(this.mg, player, this.hq.tile(), true);
    this.hq.setRailReach(
      thinReach(tiles, this.hq.tile(), TERRON_TRAINS_REACH_MAX),
    );
  }
}

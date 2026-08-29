// terron: ультимейты — «СБИТЬ СПУТНИКИ» (ракета-каст Неба нашего). Спека:
// new-units/NEBO.md, реворк 21.08 (решение владельца): штаб «Небо наше» стал
// ПОСТОЯННЫМ (сам — гигантское ПВО + пассив перезарядки), а ракета-ослепление
// вынесена в этот отдельный каст (CAST_UNLOCKED_BY: доступен, пока штаб стоит).
//
// Флоу: интент → ConstructionExecution (каст = не структура, мгновенная
// делегация) → сюда. Ставим юнит-носитель на своей земле (buildUnit списывает
// TERRON_SATSTRIKE_COST), 60с сборки = телеграф: URGENT-тревога всем, ракета
// всё это время сносибельна (снос/потеря земли под ней = отмена, деньги не
// возвращаются). Собралась → запуск: юнит исчезает, SatBlackoutUpdate уходит
// клиентам (подрыв через BLAST_DELAY, слепота BLACKOUT_TICKS) + ставится
// детерминированное состояние блэкаута в ядро (реакции ботов, NationExecution).
// Сам туман — клиентский (FogPass): владелец видит всё, team-команда щадится.
import {
  TERRON_OURSKY_BLACKOUT_TICKS,
  TERRON_OURSKY_BLAST_DELAY_TICKS,
  TERRON_OURSKY_BUILD_TICKS,
} from "../configuration/TerronTuning";
import { Execution, Game, MessageType, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType } from "../game/GameUpdates";

export class SatelliteStrikeExecution implements Execution {
  private active = true;
  private mg: Game;
  private rocket: Unit | null = null;
  private ticksUntilLaunch = TERRON_OURSKY_BUILD_TICKS;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.rocket === null) {
      const spawn = this.player.canBuild(UnitType.SatelliteStrike, this.tile);
      if (spawn === false) {
        console.warn("cannot build Satellite Strike rocket");
        this.active = false;
        return;
      }
      this.rocket = this.player.buildUnit(UnitType.SatelliteStrike, spawn, {});
      // Вся жизнь носителя — «сборка»: телеграф-вид + сносибельность.
      this.rocket.setUnderConstruction(true);
      this.mg.displayMessage(
        "events_display.satellites_threatened",
        MessageType.SATELLITES_THREATENED,
        null,
        undefined,
        { name: this.player.displayName() },
      );
      return;
    }

    // Снесли (ядеркой/захватом юнита) = отмена запуска.
    if (!this.rocket.isActive()) {
      this.active = false;
      return;
    }
    // Ракета — не структура, смену владельца тайла ей никто не транслирует:
    // землю под носителем отжали → сборка сорвана (аналог сноса).
    if (this.mg.owner(this.rocket.tile()) !== this.rocket.owner()) {
      this.rocket.delete(false);
      this.active = false;
      return;
    }

    if (this.ticksUntilLaunch > 0) {
      this.ticksUntilLaunch--;
      return;
    }

    const owner = this.rocket.owner();
    const epicenter = this.rocket.tile();
    // Носитель израсходован запуском (без «разрушено врагом»).
    this.rocket.delete(false);
    // Статистика: ЗАПУСК (не сборка — снесённый носитель не считается). По
    // этому счётчику (stats.units.sats) platform-api даёт ачивку-ключ
    // «Закрытой страны»: победа в алмазном с запуском Неба. TZ-ult-unlocks.md
    this.mg.stats().unitBuild(owner, UnitType.SatelliteStrike);

    const blastTick = ticks + TERRON_OURSKY_BLAST_DELAY_TICKS;
    const endTick = blastTick + TERRON_OURSKY_BLACKOUT_TICKS;

    // Детерминированное состояние блэкаута в ядре (для реакций ботов).
    this.mg.setSatelliteBlackout({
      ownerSmallID: owner.smallID(),
      blastTick,
      endTick,
    });

    this.mg.addUpdate({
      type: GameUpdateType.SatBlackout,
      ownerSmallID: owner.smallID(),
      epicenter,
      blastTick,
      endTick,
    });
    this.mg.displayMessage(
      "events_display.satellites_down",
      MessageType.SATELLITES_DOWN,
      null,
      undefined,
      { name: owner.displayName() },
    );
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

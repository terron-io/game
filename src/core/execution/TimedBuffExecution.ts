// terron 23.08 — ОБЩИЙ МЕХАНИЗМ ВРЕМЕННЫХ БАФ-ЗДАНИЙ.
//
// Требование владельца (23.08): «когда мы кастуем индустриальную революцию,
// надо создавать здание, которое уничтожится, когда таймер кончится… и кейс,
// когда она уже висит на цели, надо покрывать… тоже унифицируй код, чтобы
// говнище не разводить, это вроде тупо наследование».
//
// ЗАЧЕМ. Раньше каждый временной эффект (Индустриальная революция, Передышка,
// Пакт, Олимпиада) жил невидимым счётчиком внутри игрока: снаружи не понять,
// висит он или нет, и повторный каст каждый раз решался по-своему. Теперь у
// эффекта есть ФИЗИЧЕСКИЙ МАРКЕР на карте — звезда с иконкой каста и отсчётом,
// живущая ровно длительность эффекта.
//
// ⚠️ ПРАВИЛО ПОВТОРА (решение владельца, «пока что»): единовременно у цели
// может существовать ОДНО баф-здание. Второй каст на ту же страну не
// продлевает и не стакается — он просто не проходит. Правило живёт ЗДЕСЬ,
// в одной точке, а не в каждом касте.
import { Execution, Game, MessageType, Player, TimedBuffs, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export abstract class TimedBuffExecution implements Execution {
  protected active = true;
  protected mg: Game;
  protected marker: Unit | null = null;
  private expiresAt = -1;

  constructor(
    protected caster: Player,
    protected tile: TileRef,
  ) {}

  /** Тип юнита-маркера (он же даёт иконку звезды). */
  protected abstract markerType(): UnitType;
  /** Сколько тиков живёт эффект. */
  protected abstract durationTicks(): number;
  /** Применить эффект к цели. Вернуть false — каст не состоялся. */
  protected abstract applyTo(target: Player): boolean;
  /** Снять эффект (по умолчанию ничего: эффекты сами истекают по времени). */
  protected removeFrom(_target: Player): void {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.marker === null) {
      this.start(ticks);
      return;
    }
    // Маркер снесли (ядеркой, захватом территории) — эффект переживает его:
    // здание показывает срок, но не является его источником.
    if (!this.marker.isActive()) {
      this.active = false;
      return;
    }
    const left = this.expiresAt - ticks;
    this.marker.setRailEta(Math.max(0, left));
    if (left <= 0) {
      this.marker.delete(false);
      this.marker = null;
      this.active = false;
      const owner = this.mg.owner(this.tile);
      if (owner.isPlayer()) this.removeFrom(owner as Player);
    }
  }

  private start(ticks: number): void {
    const owner = this.mg.owner(this.tile);
    if (!owner.isPlayer()) {
      this.active = false;
      return;
    }
    const target = owner as Player;

    // Правило «одно баф-здание единовременно» — по ЦЕЛИ, а не по кастеру:
    // навязать вторую революцию одной и той же стране нельзя, а разным
    // странам — можно.
    if (this.buffAlreadyOn(target)) {
      this.mg.displayMessage(
        "events_display.buff_already_active",
        MessageType.ATTACK_FAILED,
        this.caster.id(),
      );
      this.active = false;
      return;
    }

    if (!this.applyTo(target)) {
      this.active = false;
      return;
    }

    this.expiresAt = ticks + this.durationTicks();
    this.marker = this.caster.buildUnit(this.markerType(), this.tile, {});
    this.marker.setRailEta(this.durationTicks());
  }

  /** Стоит ли уже баф-здание на земле этой страны. */
  private buffAlreadyOn(target: Player): boolean {
    for (const u of this.mg.units(...TimedBuffs.types)) {
      if (!u.isActive()) continue;
      const ground = this.mg.owner(u.tile());
      if (ground.isPlayer() && (ground as Player) === target) return true;
    }
    return false;
  }

  isActive(): boolean {
    return this.active;
  }

  owner(): Player {
    return this.caster;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

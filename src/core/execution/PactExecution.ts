// terron: ДВОРЕЦ НАЦИЙ — каст «ПАКТ» (new-units/PEACE.md): игроку под тайлом
// насильно навязывается союз на обычные allianceDuration (5 мин). Симметричный —
// кастер тоже не бьёт жертву. Идущие атаки НЕ отзываются (добивающий удар не
// украсть кнопкой). Жертва может порвать пакт только предательством — и под
// пассивом Дворца проживёт предателем минуту. Публичная строка ленты всем:
// соседи жертвы должны понимать, что её армия сейчас развернётся к ним.
import { Execution, Game, MessageType, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class PactExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    this.active = false;
    if (this.player.canBuild(UnitType.Pact, this.tile) === false) return;
    const owner = this.mg.owner(this.tile);
    if (!owner.isPlayer()) return;
    const target = owner as Player;
    const cost = this.mg.unitInfo(UnitType.Pact).cost(this.mg, this.player);
    this.player.removeGold(cost);

    // Союз «в лоб»: встречная заявка жертвы → принять её; иначе создать свою и
    // принять за жертву. Зеркальные заявки движок схлопывает сам (accept внутри).
    const theirs = target
      .outgoingAllianceRequests()
      .find((r) => r.recipient() === this.player);
    if (theirs !== undefined) {
      theirs.accept();
    } else {
      const mine = this.player.createAllianceRequest(target);
      if (mine !== null) {
        mine.accept();
      } else {
        target
          .incomingAllianceRequests()
          .find((r) => r.requestor() === this.player)
          ?.accept();
      }
    }
    if (!this.player.isAlliedWith(target)) return;
    this.player.markPact(target);
    this.mg.displayMessage(
      "events_display.pact_imposed",
      MessageType.PACT,
      null,
      undefined,
      { name: this.player.displayName(), target: target.displayName() },
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

// terron: ФАНАТИЗМ — каст «ТЕРРОР» (TZ-ult-unlocks.md, карточка владельца:
// «на территории врага взрывается рандомное здание, после этого 5с блокируется
// производство войск»). Цель — страна под тайлом (как у МИРВ). Списываем
// TERROR_COST и ДОЛЮ ВОЙСК (troops интента / войска игрока, как Передышка):
// доля задаёт ЧИСЛО взрывов за TERROR_TICKS (terrorBlasts: 50 % = 10, 100 % = 15),
// взрывы идут равномерно. Каждый взрыв: случайное достроенное здание жертвы
// гибнет (PseudoRandom от тика каста). Первый взрыв — сразу при касте.
// Рекаст в ту же цель — параллельная экзекуция. Цель умерла / штаб снесён — стоп.
import {
  TERRON_TERROR_TICKS,
  terrorBlasts,
} from "../configuration/TerronTuning";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Structures,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";

export class TerrorExecution implements Execution {
  private active = true;
  private mg: Game;
  private target: Player | null = null;
  private untilTick = 0;
  private period = 0;
  private nextBlast = 0;
  private random: PseudoRandom;

  constructor(
    private player: Player,
    private tile: TileRef,
    private troops: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(ticks + this.tile);
  }

  tick(ticks: number): void {
    if (this.target === null) {
      if (this.player.canBuild(UnitType.Terror, this.tile) === false) {
        this.active = false;
        return;
      }
      const owner = this.mg.owner(this.tile);
      if (!owner.isPlayer()) {
        this.active = false;
        return;
      }
      const have = this.player.troops();
      if (have <= 0) {
        this.active = false;
        return;
      }
      const spend = Math.max(1, Math.min(have, Math.floor(this.troops)));
      const ratio = spend / have;
      this.target = owner as Player;
      const cost = this.mg.unitInfo(UnitType.Terror).cost(this.mg, this.player);
      this.player.removeGold(cost);
      this.player.removeTroops(spend);
      const blasts = terrorBlasts(ratio);
      this.period = Math.max(1, Math.floor(TERRON_TERROR_TICKS / blasts));
      this.untilTick = ticks + TERRON_TERROR_TICKS;
      this.nextBlast = ticks + 1; // первый взрыв — сразу
      this.mg.displayMessage(
        "events_display.terror_declared",
        MessageType.TERROR,
        this.target.id(),
        undefined,
        { name: this.player.displayName() },
      );
      return;
    }

    if (
      ticks >= this.untilTick ||
      !this.target.isAlive() ||
      !this.player.hasUltimate(UnitType.Fanaticism)
    ) {
      this.active = false;
      return;
    }
    if (ticks < this.nextBlast) return;
    this.nextBlast = ticks + this.period;

    const buildings = this.target
      .units(...Structures.types)
      .filter((u) => u.isActive() && !u.isUnderConstruction());
    if (buildings.length === 0) return;
    const victim = buildings[this.random.nextInt(0, buildings.length)];
    victim.delete(true, this.player);
    this.mg.displayMessage(
      "events_display.terror_blast",
      MessageType.TERROR,
      this.target.id(),
      undefined,
      { name: this.player.displayName() },
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

// terron: ЗЕЛЁНЫЕ — каст «ЭТО КАТАСТРОФА!» (new-units/GREEN.md).
// Травля ЛЮБОЙ страны, включая нации-ботов и тех, кто вообще не бомбил
// (решение владельца 23.08: «в любой стране можно найти хуёвое производство»).
//
// Ступень штрафа льётся в ТУ ЖЕ шкалу, что и пассив-возмездие за детонацию, и
// кап у них ОБЩИЙ. Отсюда полезное следствие: на закоренелого бомбилу каст
// тратить бессмысленно — он и так в полу от пассива. То есть каст экономически
// «предназначен» мирным, и ульта сама подсказывает, как ей играть.
//
// Бьёт ТОЛЬКО по золоту: прирост войск не трогаем намеренно (см. PlayerExecution) —
// жертва остаётся с растущей армией без денег, и её выталкивает в атаку.
import { Execution, Game, MessageType, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class CatastropheExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    this.active = false;
    if (this.player.canBuild(UnitType.Catastrophe, this.tile) === false) return;
    const owner = this.mg.owner(this.tile);
    if (!owner.isPlayer()) return;
    const target = owner as Player;
    if (target === this.player) return;
    if (this.player.catastropheBlocked(target)) return;

    const cost = this.mg
      .unitInfo(UnitType.Catastrophe)
      .cost(this.mg, this.player);
    if (this.player.gold() < cost) return;
    this.player.removeGold(cost);

    target.addCatastropheStacks(1);
    this.player.markCatastrophe(target);

    const pct = Math.round((1 - target.catastropheGoldMult()) * 100);
    // Лента — всем: штраф обязан читаться. Без строки жертва увидит только
    // «доход упал» и будет искать причину не там.
    this.mg.displayMessage(
      "events_display.catastrophe_declared",
      MessageType.CATASTROPHE,
      null,
      undefined,
      { name: target.displayName(), pct: String(pct) },
      undefined,
      this.player.id(),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  owner(): Player {
    return this.player;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

// terron: АЭС — каст «РЕКУЛЬТИВАЦИЯ» (new-units/NUCLEAR.md). Мгновенно снимает
// радиопепел в радиусе вокруг указанного тайла. Наводится КУДА УГОДНО — и на
// свою землю, и на чужую страну, согласия не спрашивают.
//
// За каждый убранный тайл платят:
//   • земля была ТВОЯ  → золото печатается (ты прибрал за собой);
//   • земля была ЧУЖАЯ → золото СПИСЫВАЕТСЯ из казны того, чья это была земля
//     («мы вам почистили — с вас счёт»). Если у него столько нет — берём
//     сколько есть;
//   • земля была ничья → не платят ничего: убирать пустошь никто не просил.
//
// Прежний владелец берётся из GameImpl.falloutPrevOwner: пепел в движке лежит
// ТОЛЬКО на ничейной суше, и «чей он» иначе установить нечем. Платит владелец
// ЗЕМЛИ, а не тот, кто бомбил — то есть прилетело чужой ракетой, а счёт за
// уборку всё равно тебе.
//
// ⚠️ ИНВАРИАНТ (тест NuclearPlant.test.ts): выплата за полностью убранную
// воронку обязана быть НИЖЕ цены той же ракеты со скидкой АЭС — иначе
// открывается вечный двигатель «бомблю свою пустошь → убираю → богатею».
import {
  TERRON_RECULT_GOLD_PER_TILE,
  TERRON_RECULT_RADIUS,
} from "../configuration/TerronTuning";
import { Execution, Game, MessageType, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class RecultivationExecution implements Execution {
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
    if (this.player.canBuild(UnitType.Recultivation, this.tile) === false) {
      return;
    }
    const cost = this.mg
      .unitInfo(UnitType.Recultivation)
      .cost(this.mg, this.player);
    if (this.player.gold() < cost) return;
    this.player.removeGold(cost);

    const mg = this.mg;
    const r = TERRON_RECULT_RADIUS;
    const inner2 = r * r;
    const cx = mg.x(this.tile);
    const cy = mg.y(this.tile);
    const perTile = BigInt(TERRON_RECULT_GOLD_PER_TILE);

    let cleared = 0;
    let minted = 0n;
    // Счета по игрокам копим и списываем ОДНИМ движением на каждого: иначе на
    // большой воронке было бы 30 тысяч отдельных операций с казной.
    const bills = new Map<number, bigint>();

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > inner2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!mg.isValidCoord(x, y)) continue;
        const t = mg.ref(x, y);
        if (!mg.hasFallout(t)) continue;
        const prev = mg.clearFallout(t);
        cleared++;
        if (prev === 0) continue; // ничейная пустошь — уборка бесплатна
        if (prev === this.player.smallID()) {
          minted += perTile;
        } else {
          bills.set(prev, (bills.get(prev) ?? 0n) + perTile);
        }
      }
    }
    if (cleared === 0) return;

    let earned = minted;
    for (const [smallID, amount] of bills) {
      const victim = mg.playerBySmallID(smallID);
      if (!victim.isPlayer()) continue;
      const v = victim as Player;
      // Берём сколько есть: пустая казна не должна уходить в минус.
      const take = v.gold() < amount ? v.gold() : amount;
      if (take <= 0n) continue;
      v.removeGold(take);
      earned += take;
    }
    this.player.addGold(earned);

    mg.displayMessage(
      "events_display.recultivation",
      MessageType.RECULTIVATION,
      this.player.id(),
      undefined,
      { tiles: String(cleared), gold: String(earned) },
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

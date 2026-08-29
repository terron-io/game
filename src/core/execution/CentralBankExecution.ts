// terron: ЦЕНТРОБАНК — экономика (реворк 23.08, решение владельца: «10% от
// текущих денег каждые 20 секунд»). Прежние эффекты штаба СОХРАНЕНЫ
// (неперехватываемые лодки, самолёты без комиссии) — они живут по hasUltimate
// в других местах; здесь только выплата.
//
// ⚠️ ЭТО СЛОЖНЫЙ ПРОЦЕНТ. Без ограничения +10 % каждые 20 с дают ×1.33 за
// минуту, ×17 за десять и ×300 за двадцать — к середине долгого матча у
// владельца было бы больше золота, чем у всей карты вместе. Поэтому выплата
// упирается в TERRON_CENTRALBANK_CAP: процент приятен на средних балансах и
// перестаёт расти в бесконечность на больших. Крутить надо КАП, а не процент.
import {
  TERRON_CENTRALBANK_CAP,
  TERRON_CENTRALBANK_PCT,
  TERRON_CENTRALBANK_PERIOD_TICKS,
} from "../configuration/TerronTuning";
import { MessageType, Player, Unit } from "../game/Game";
import { UltimateBuildingExecution } from "./UltimateBuildingExecution";

export class CentralBankExecution extends UltimateBuildingExecution {
  private lastPayout = -1;

  constructor(hq: Unit) {
    super(hq);
  }

  protected onInit(ticks: number): void {
    this.lastPayout = ticks;
  }

  protected run(player: Player, ticks: number): void {
    if (this.lastPayout < 0) this.lastPayout = ticks;
    if (ticks - this.lastPayout < TERRON_CENTRALBANK_PERIOD_TICKS) return;
    this.lastPayout = ticks;

    let payout = (player.gold() * BigInt(TERRON_CENTRALBANK_PCT)) / 100n;
    if (payout <= 0n) return;
    const cap = BigInt(TERRON_CENTRALBANK_CAP);
    if (payout > cap) payout = cap;
    player.addGold(payout);

    this.mg.displayMessage(
      "events_display.central_bank_payout",
      MessageType.CENTRAL_BANK,
      player.id(),
      undefined,
      { gold: String(payout) },
    );
  }
}

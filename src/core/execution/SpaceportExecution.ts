// terron: КОСМОДРОМ (new-units/SPACE.md). Раз в минуту с площадки уходит
// запуск: владелец получает фиксированную сумму плюс процент ДОХОДА, который
// каждая страна заработала за этот период — и этот процент с них СПИСЫВАЕТСЯ.
//
// ⚠️ Процент берётся от ДОХОДА за период, а не от баланса. Баланс тратят, по
// нему «сколько ты заработал за минуту» не восстановить; и главное — процент
// от баланса даёт сложный процент, то есть экспоненту. Доход же величина
// ограниченная, и ульта остаётся линейной.
//
// Единственная ульта в ростере, которая растёт от ЧУЖОГО богатства. Запуск
// объявляется в ленте ВСЕМ и с цифрой: ненависть к владельцу должна быть
// адресной, иначе процент никто не заметит и драмы не выйдет.
import { renderNumber } from "../../client/Utils";
import { GameUpdateType } from "../game/GameUpdates";
import {
  TERRON_SPACEPORT_FLAT,
  TERRON_SPACEPORT_SEA_MULT,
  TERRON_SPACEPORT_TAX_PCT,
} from "../configuration/TerronTuning";
import {
  Gold,
  MessageType,
  Player,
  PlayerType,
  Unit,
  UnitType,
} from "../game/Game";
import { spaceportPeriodTicks } from "../game/SpaceportTiming";
import { PortExecution } from "./PortExecution";
import { UltimateBuildingExecution } from "./UltimateBuildingExecution";

export class SpaceportExecution extends UltimateBuildingExecution {
  /** Накопленный доход каждой страны на момент прошлого запуска. */
  private readonly seen = new Map<Player, Gold>();

  constructor(hq: Unit) {
    super(hq);
  }

  protected onInit(_ticks: number): void {
    // terron 23.08 (решение владельца «подключай космодромы к рельсам и делай
    // их точками портов»): и станцию, и торговые рейсы даёт ОДНА И ТА ЖЕ
    // экзекуция порта — на общих условиях и с обычным КПД (у вышки ×5, тут 1:1).
    // terron 23.08: площадка ЖИВЁТ КАК ТОРГОВЫЙ УЗЕЛ — сама шлёт и принимает
    // рейсы (та же экзекуция, что у порта и нефтяной вышки), выплата 1:1.
    //
    // ⚠️ При этом она НЕ порт для ФЛОТА: её нет в `actingAs(UnitType.Port)`,
    // значит корабли у неё не строятся и не чинятся — «чисто торговый»,
    // как и просил владелец. Родство «здание X является Y» объявляется
    // ровно одним полем реестра, и это тот случай, когда его объявлять НЕ надо.
    this.mg.addExecution(new PortExecution(this.hq));
    // Площадка начинает с ПОЛНОГО отката: первый запуск — через период, а не
    // мгновенно после постройки.
    this.hq.launch();
  }

  /**
   * ⚠️ terron 23.08: отсчёт до запуска идёт ЧЕРЕЗ ОБЩИЙ механизм юнита
   * (launch/reloadMissile/missileTimerQueue) — тот же, что у шахты, ПВО, аэро-
   * порта и Доры. Свой приватный счётчик тут был, и именно поэтому владелец
   * не видел «таймера отправки в космос»: единая система откатов (Cooldowns.ts)
   * читает очередь юнита, а про приватное поле экзекуции знать не может.
   */
  protected run(player: Player, ticks: number): void {
    const period = spaceportPeriodTicks(this.mg, this.hq.tile());
    const q = this.hq.missileTimerQueue();
    if (q.length === 0) {
      this.hq.launch();
      return;
    }
    if (ticks - q[0] < period) return;
    this.hq.reloadMissile();
    this.hq.launch();
    this.launch(player);
  }

  private launch(player: Player): void {
    // Морская площадка дороже и отдаёт больше (см. TerronTuning §КОСМОДРОМ).
    const mult = this.mg.isOcean(this.hq.tile())
      ? TERRON_SPACEPORT_SEA_MULT
      : 1;

    let taken = 0n;
    for (const other of this.mg.players()) {
      if (other === player) continue;
      if (!other.isAlive()) continue;
      if (other.type() === PlayerType.Bot) continue; // племена не платят
      const before = this.seen.get(other) ?? 0n;
      const now = other.incomeAccrued();
      this.seen.set(other, now);
      const earned = now - before;
      if (earned <= 0n) continue;
      let due = (earned * BigInt(TERRON_SPACEPORT_TAX_PCT)) / 100n;
      if (due <= 0n) continue;
      if (due > other.gold()) due = other.gold();
      if (due <= 0n) continue;
      other.removeGold(due);
      taken += due;
    }

    const payout =
      BigInt(TERRON_SPACEPORT_FLAT) * BigInt(mult) + taken * BigInt(mult);
    player.addGold(payout);

    // terron 23.08 (просьба владельца «пуск хотя бы старый верни»): быстрый
    // снаряд вверх тем же каналом FX, что у выстрела бункера. Он идёт ВМЕСТЕ с
    // клиентской анимацией ракеты — снаряд читается мгновенно, ракета летит
    // следом и медленно.
    const sky = this.skyTile();
    if (sky !== null) {
      this.mg.addUpdate({
        type: GameUpdateType.FortShot,
        from: this.hq.tile(),
        to: sky,
      });
    }

    this.mg.displayMessage(
      "events_display.spaceport_launch",
      MessageType.SPACEPORT,
      null,
      undefined,
      { name: player.displayName(), gold: renderNumber(payout) },
      undefined,
      player.id(),
    );
  }

  /** Точка «в небе» над площадкой — куда уходит визуальный снаряд запуска. */
  private skyTile(): number | null {
    const x = this.mg.x(this.hq.tile());
    const y = this.mg.y(this.hq.tile());
    const top = Math.max(0, y - SKY_TILES);
    if (top === y) return null;
    return this.mg.ref(x, top);
  }
}

/** На сколько тайлов вверх уходит визуальный снаряд запуска. */
const SKY_TILES = 40;

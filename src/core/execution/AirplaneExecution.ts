import { fuelSpeedMult } from "../game/FuelSpeed";
// terron: авиация — самолёт-транзит между аэропортами. Летит НАПРЯМУЮ (AirPathFinder),
// по прибытии начисляет золото владельцу (×2 от заработка корабля на той же дальности).
// КОМИССИЯ ЗА ПРОЛЁТ (airport.md §2.4): тик над территорией ЧУЖОГО живого
// игрока → тот получает долю карго (карго тает). Центробанк (ульта)
// освобождает самолёты владельца от комиссии. Спека: airport.md
import { TERRON_AIRPLANE_TAX_PERMILLE } from "../configuration/TerronTuning";
import { recordEconomyGold } from "../game/EconomyLog";
import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { MotionPlanRecord } from "../game/MotionPlans";
import { AirPathFinder } from "../pathfinding/PathFinder.Air";

export class AirplaneExecution implements Execution {
  private active = true;
  private mg: Game;
  private plane: Unit | undefined;
  private path: TileRef[] = [];
  private idx = 0;
  private distTiles = 0;
  private speed = 2;
  private delayTicks = 0;
  // terron: карго рейса (база выплаты) — комиссия за пролёт тает отсюда.
  private cargo: bigint = 0n;
  // Комиссия копится БАТЧЕМ, пока летим над одним игроком, и зачисляется при
  // выходе из его территории/конце рейса (по-тиковый addGold с tile флудил
  // попапами «+N» на карте — решение владельца 07.07).
  private pendingTaxOwner: Player | null = null;
  private pendingTax: bigint = 0n;

  constructor(
    private owner: Player,
    private srcAirport: Unit,
    private dstAirport: Unit,
    delayTicks = 0,
  ) {
    this.delayTicks = Math.max(0, delayTicks);
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    // terron: ТОПЛИВО — самолёты владельца летят быстрее (дроны и ракеты —
    // НЕТ, решение владельца 23.08). FUEL.md
    this.speed = Math.max(
      1,
      mg.config().airplaneSpeed() * fuelSpeedMult(this.owner),
    );
  }

  tick(ticks: number): void {
    // terron: случайная задержка вылета — держим борт на земле delayTicks тиков.
    if (this.delayTicks > 0) {
      this.delayTicks--;
      // Пока ждём — если аэропорт-источник исчез, отменяем рейс.
      if (
        !this.srcAirport.isActive() ||
        this.srcAirport.isUnderConstruction()
      ) {
        this.active = false;
      }
      return;
    }
    // Spawn on first tick.
    if (this.plane === undefined) {
      if (
        !this.srcAirport.isActive() ||
        this.srcAirport.isUnderConstruction() ||
        !this.dstAirport.isActive() ||
        this.dstAirport.isUnderConstruction()
      ) {
        this.active = false;
        return;
      }
      const srcTile = this.srcAirport.tile();
      const dstTile = this.dstAirport.tile();
      const spawn = this.owner.canBuild(UnitType.Airplane, srcTile);
      if (spawn === false) {
        this.active = false;
        return;
      }
      this.plane = this.owner.buildUnit(UnitType.Airplane, spawn, {
        targetUnit: this.dstAirport,
      });

      const pf = new AirPathFinder(this.mg);
      const full = pf.findPath(srcTile, dstTile) ?? [srcTile];
      if (full.length === 0 || full[0] !== srcTile) {
        full.unshift(srcTile);
      }
      this.distTiles = full.length;

      // Decimate by speed so the client motion-plan interpolation matches the
      // sim, which advances `speed` tiles per tick.
      const step: TileRef[] = [];
      for (let i = 0; i < full.length; i += this.speed) {
        step.push(full[i]);
      }
      const last = full[full.length - 1];
      if (step[step.length - 1] !== last) {
        step.push(last);
      }
      this.path = step;
      this.idx = 0;
      // Карго считаем на старте: комиссия за пролёт будет таять отсюда.
      this.cargo = this.mg.config().airplaneGold(this.distTiles, this.owner);

      const motionPlan: MotionPlanRecord = {
        kind: "grid",
        unitId: this.plane.id(),
        planId: 1,
        startTick: ticks + 1,
        ticksPerStep: 1,
        path: this.path,
      };
      this.mg.recordMotionPlan(motionPlan);
      return;
    }

    if (!this.plane.isActive()) {
      this.flushTax(); // сбили — накопленная комиссия всё равно заработана
      this.active = false;
      return;
    }

    // Destination airport gone, or trade no longer allowed (captured by us /
    // embargo / war) → abort flight. Own airports are always a valid destination.
    const dstOwner = this.dstAirport.owner();
    const tradeable = dstOwner === this.owner || this.owner.canTrade(dstOwner);
    if (!this.dstAirport.isActive() || !tradeable) {
      this.flushTax();
      this.plane.delete(false);
      this.active = false;
      return;
    }

    this.idx++;
    if (this.idx >= this.path.length) {
      this.flushTax();
      // Arrived — pay out. Foreign trade (like port↔port): BOTH the sender and
      // the destination owner receive the full gold (что осталось от карго
      // после комиссий за пролёт). Own→own: single payout.
      const gold = this.cargo;
      this.owner.addGold(gold, this.dstAirport.tile());
      recordEconomyGold(this.mg, this.owner, "airport", gold);
      if (dstOwner !== this.owner) {
        dstOwner.addGold(gold, this.dstAirport.tile());
        recordEconomyGold(this.mg, dstOwner, "airport", gold);
      }
      this.plane.delete(false);
      this.active = false;
      return;
    }
    this.plane.move(this.path[this.idx]);

    // terron: комиссия за пролёт (§2.4) — O(1)/тик: владелец тайла под бортом
    // (чужой ЖИВОЙ игрок) зарабатывает долю карго. Центробанк освобождает.
    // Копим батчем и зачисляем при смене владельца под бортом (см. flushTax).
    const over = this.mg.owner(this.plane.tile());
    let taxOwner: Player | null = null;
    if (
      over.isPlayer() &&
      over !== this.owner &&
      (over as Player).isAlive() &&
      !this.owner.hasUltimate(UnitType.CentralBank)
    ) {
      taxOwner = over as Player;
    }
    if (taxOwner !== this.pendingTaxOwner) this.flushTax();
    if (taxOwner !== null) {
      // Целочисленная доля; минимум 1 голда за тик, пока карго не иссякло
      // (иначе короткие рейсы с мелким карго летали бы беспошлинно).
      let tax = (this.cargo * TERRON_AIRPLANE_TAX_PERMILLE) / 1000n;
      if (tax === 0n && this.cargo > 0n) tax = 1n;
      if (tax > 0n) {
        this.cargo -= tax;
        this.pendingTaxOwner = taxOwner;
        this.pendingTax += tax;
      }
    }
  }

  // terron: зачисление накопленной комиссии. БЕЗ tile → без попапа на карте
  // (зелёный «+N» у счётчика золота клиент покажет сам по дельте).
  private flushTax(): void {
    if (this.pendingTaxOwner !== null && this.pendingTax > 0n) {
      this.pendingTaxOwner.addGold(this.pendingTax);
      recordEconomyGold(
        this.mg,
        this.pendingTaxOwner,
        "airport",
        this.pendingTax,
      );
    }
    this.pendingTaxOwner = null;
    this.pendingTax = 0n;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

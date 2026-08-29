import { TERRON_BANNER_CAPITAL_MULT } from "../configuration/TerronTuning";
import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TrainStationExecution } from "./TrainStationExecution";

export class CityExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  private stationCreated = false;

  constructor(private city: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.stationCreated) {
      this.createStation();
      this.stationCreated = true;
    }
    if (!this.city.isActive()) {
      this.active = false;
      return;
    }
    // terron: СТОЛИЦЫ — базовый доход столицы ВИДИМЫМИ КУСКАМИ: 5000 раз в 10с
    // (=30000/мин). addGold с tile → всплывает «+5000» над столицей. Спека: CAPITALS.md
    // terron: ЗНАМЯ ПОБЕДЫ — трофейная столица без знамени (штаб снесён) →
    // демотируется в обычный город (единственная столица игрока остаётся).
    if (
      this.city.isCapital() &&
      this.city.capitalFounder() !== null &&
      this.city.capitalFounder() !== this.city.owner() &&
      this.city.owner().capital() !== this.city &&
      !this.city.owner().hasUltimate(UnitType.VictoryBanner)
    ) {
      this.city.setCapital(false);
    }
    if (
      this.city.isCapital() &&
      !this.city.isUnderConstruction() &&
      ticks % this.mg.config().CapitalGoldIntervalTicks() === 0
    ) {
      this.city
        .owner()
        .addGold(
          // terron: ЗНАМЯ ПОБЕДЫ — все столицы под контролем ×10.
          this.city.owner().hasUltimate(UnitType.VictoryBanner)
            ? this.mg.config().CapitalGoldAmount() *
                BigInt(TERRON_BANNER_CAPITAL_MULT)
            : this.mg.config().CapitalGoldAmount(),
          this.city.tile(),
        );
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private createStation(): void {
    // terron: только СВОЯ фабрика даёт станцию (без playerId матчилась любая, в т.ч.
    // вражеская в радиусе 110 → порт/город вязались рельсами «без фабрики»). Спека: airport.md
    const nearbyFactory = this.mg.hasUnitNearby(
      this.city.tile()!,
      this.mg.config().trainStationMaxRange(),
      UnitType.Factory,
      this.city.owner().id(),
    );
    if (nearbyFactory) {
      this.mg.addExecution(new TrainStationExecution(this.city));
    }
  }
}

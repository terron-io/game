import { pickCapitalName } from "../game/CapitalNames";
import {
  Execution,
  Game,
  Player,
  PlayerType,
  Structures,
  Tick,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AirportExecution } from "./AirportExecution";
import { BlockadeExecution } from "./BlockadeExecution";
import { CityExecution } from "./CityExecution";
import { DefensePostExecution } from "./DefensePostExecution";
import { FactoryExecution } from "./FactoryExecution";
import { GreensExecution } from "./GreensExecution";
import { NuclearPlantExecution } from "./NuclearPlantExecution";
import { CentralBankExecution } from "./CentralBankExecution";
import { RailGunExecution } from "./RailGunExecution";
import { SpaceportExecution } from "./SpaceportExecution";
import { TreasureExecution } from "./TreasureExecution";
import { FortificationsExecution } from "./FortificationsExecution";
import { MinistryOfTruthExecution } from "./MinistryOfTruthExecution";
import { MirvExecution } from "./MIRVExecution";
import { MissileSiloExecution } from "./MissileSiloExecution";
import { NukeExecution } from "./NukeExecution";
import { PortExecution } from "./PortExecution";
import { ReligionExecution } from "./ReligionExecution";
import { SAMLauncherExecution } from "./SAMLauncherExecution";
import { SatelliteStrikeExecution } from "./SatelliteStrikeExecution";
import { SplitExecution } from "./SplitExecution";
import { SuicideDroneExecution } from "./SuicideDroneExecution";
import { CatastropheExecution } from "./CatastropheExecution";
import { IndustrialRevolutionExecution } from "./IndustrialRevolutionExecution";
import { RailGunShellExecution } from "./RailGunShellExecution";
import { RecultivationExecution } from "./RecultivationExecution";
import { PactExecution } from "./PactExecution";
import { RespiteExecution } from "./RespiteExecution";
import { TerrorExecution } from "./TerrorExecution";
import { TruceExecution } from "./TruceExecution";
import { WarshipExecution } from "./WarshipExecution";
import { TrainDepotExecution } from "./TrainDepotExecution";
import { DoomTrainExecution } from "./DoomTrainExecution";
import { CityTransferExecution } from "./CityTransferExecution";

// terron (18.07): РЕЕСТР «структура → исполнитель после стройки» вместо
// switch-простыни. null = пассивный штаб (эффект через Player.hasUltimate,
// тика зданию не нужно). Record ТИПИЗИРОВАН ПОЛНОСТЬЮ по группе Structures
// (Game.ts): добавил юнит в Structures и забыл строку здесь — ошибка КОМПИЛЯЦИИ,
// а не молчаливый баг на проде. Новое здание = 1 строка.
type StructureType = (typeof Structures.types)[number];
const STRUCTURE_EXECUTIONS: Record<
  StructureType,
  ((structure: Unit) => Execution) | null
> = {
  [UnitType.Port]: (s) => new PortExecution(s),
  // terron: НЕФТЯНАЯ ВЫШКА — «порт в океане»: тот же исполнитель (шлёт торговые
  // лодки), разница в месте постройки и в множителе выплаты. TerronTuning §ВЫШКА.
  [UnitType.OilRig]: (s) => new PortExecution(s),
  [UnitType.MissileSilo]: (s) => new MissileSiloExecution(s),
  [UnitType.DefensePost]: (s) => new DefensePostExecution(s),
  [UnitType.SAMLauncher]: (s) => new SAMLauncherExecution(s.owner(), null, s),
  [UnitType.City]: (s) => new CityExecution(s),
  [UnitType.Factory]: (s) => new FactoryExecution(s),
  // terron: авиация — аэропорт авто-отправляет самолёты между аэропортами.
  [UnitType.Airport]: (s) => new AirportExecution(s),
  // terron: ультимейты — Мин правды: аура высасывания населения врагов.
  // ⚠️ 06.08 ВЛИТА В МЕДИА (решение владельца) — здание больше не строится,
  // запись закомментирована вместе с членством в Structures/Ultimates (Game.ts).
  // Вернуть = раскомментировать тут и там. Сам Execution жив и работает от МЕДИА.
  // [UnitType.MinistryOfTruth]: (s) => new MinistryOfTruthExecution(s),
  // terron: ультимейты — штаб укреплений: бункеры автозахватывают землю.
  [UnitType.Fortifications]: (s) => new FortificationsExecution(s),
  // terron: ультимейты — храм: вся территория медленно расползается.
  [UnitType.Religion]: (s) => new ReligionExecution(s),
  // terron: ультимейты — Небо наше (реворк 21.08): ПОСТОЯННЫЙ штаб, сам —
  // гигантское ПВО (радиус ×TERRON_OURSKY_SAM_RADIUS_MULT, учитывается внутри
  // SAMLauncherExecution по типу юнита). Ракета — отдельный каст SatelliteStrike.
  [UnitType.OurSky]: (s) => new SAMLauncherExecution(s.owner(), null, s),
  // Пассивные штабы — эффект в точках применения (Player.hasUltimate).
  // terron: ЦЕНТРОБАНК — реворк 23.08: к прежним пассивам (неперехватываемые
  // лодки, самолёты без комиссии, они по hasUltimate) добавлена выплата
  // процента с капом. new-units/ULTIMATES.md
  [UnitType.CentralBank]: (s) => new CentralBankExecution(s),
  [UnitType.AirCommand]: null,
  [UnitType.TankFactory]: null,
  [UnitType.Mining]: null,
  [UnitType.Revanchism]: null,
  // terron 06.08: МЕДИА = три эффекта разом — аура высасывания (влитая сюда Мин
  // правды, ×2 мощности и ×2 радиуса) + игнор предательства + разблок Раскола.
  // Последние два — пассивки по hasUltimate, ауру несёт этот Execution.
  [UnitType.Media]: (s) => new MinistryOfTruthExecution(s),
  [UnitType.NuclearFactory]: null, // разблок МИРВ — по hasUltimate
  // terron: ультимейты — «Реки вспять»: штаб пассивный, вся работа в касте
  // WaterNuke (разблок по CAST_UNLOCKED_BY). TerronTuning §РЕКИ ВСПЯТЬ.
  [UnitType.RiversBack]: null,
  // terron: ультимейты — ПОДЛОДКИ: пассив, эффект в WarshipExecution/рендере.
  [UnitType.SubmarineBase]: null,
  // terron: ЗАКРЫТАЯ СТРАНА — пассив: скрытие параметров чисто видовое (клиент
  // читает Player.hasUltimate), сим не трогаем. TZ-ult-unlocks.md
  [UnitType.ClosedCountry]: null,
  // terron: ГОРДОСТЬ — пассив (множители в PlayerExecution по hasUltimate).
  [UnitType.Pride]: null,
  // terron: ОЛИМПИЙСКИЕ ИГРЫ — стадион, пассив (множители в PlayerExecution).
  [UnitType.Olympics]: null,
  // terron: ФАНАТИЗМ — штаб, пассив (PlayerExecution + Config.attackLogic).
  [UnitType.Fanaticism]: null,
  // terron: ЗЕЛЁНЫЕ — этот Execution несёт ТОЛЬКО «озеленение» (отступание
  // радиации от границ). Остальные пассивы — в точках применения по
  // hasUltimate: запрет ядерок (PlayerImpl.canBuildUnitType), шахта=город
  // (Config.populationBuildingLevels), прирост/доход (PlayerExecution),
  // дешёвый заход в пепел (Config.attackLogic). GREEN.md
  [UnitType.Greens]: (s) => new GreensExecution(s),
  // terron: АЭС — этот Execution несёт только «Чернобыль» (сторож потери
  // штаба). Скидка на ядерки и ликвидаторы — в Config по hasUltimate,
  // уборка — в касте Рекультивации. NUCLEAR.md
  [UnitType.NuclearPlant]: (s) => new NuclearPlantExecution(s),
  // terron: ТОПЛИВО — чистый пассив: множитель скорости читается в точках
  // движения (FuelSpeed.fuelSpeedMult), неперехватываемость лодок — в
  // WarshipExecution по hasUltimate. FUEL.md
  [UnitType.Fuel]: null,
  // terron: ДОРА — едущее здание: движение по рельсам, стрельба и подрыв на
  // чужой земле живут в RailGunExecution. DORA.md
  [UnitType.RailGun]: (s) => new RailGunExecution(s),
  // terron: КОСМОДРОМ — запуск раз в минуту, снимающий процент дохода со всех.
  [UnitType.Spaceport]: (s) => new SpaceportExecution(s),
  // terron 23.08: СЕКРЕТНЫЙ КРУГ — вся механика в разовой выплате по достройке.
  [UnitType.SecretTreasure]: (s) => new TreasureExecution(s),
  // terron: МИРНОЕ НЕБО — чистый пассив: скидка на ПВО в Config, а «сбиваем
  // всё, включая союзное» — фильтр целей в SAMLauncherExecution.
  [UnitType.PeacefulSky]: null,
  // terron: ВЗРЫВНЫЕ ПОЕЗДА — депо считает зону доезда состава.
  [UnitType.TrainDepot]: (s: Unit) => new TrainDepotExecution(s),
  // terron: ЗНАМЯ ПОБЕДЫ — штаб, пассив (CityExecution ×10, UnitImpl захват,
  // Config.attackLogic +50 %). new-units/BANNER.md
  [UnitType.VictoryBanner]: null,
  // terron: ДВОРЕЦ НАЦИЙ — штаб, пассив (GameImpl.breakAlliance +
  // NationAllianceBehavior). new-units/PEACE.md
  [UnitType.PeacePalace]: null,
  // terron: ПИРАТСТВО — пассив: эффекты в WarshipExecution/ShellExecution/Config
  // по Player.hasUltimate(Piracy), рендер по UnitImpl.subState. TZ-ult-unlocks.md
  // terron: штаб Пиратства — ПОРТ (шлёт торговые лодки, спавнит корабли).
  [UnitType.Piracy]: (s) => new PortExecution(s),
  // terron: ШАГАЮЩИЙ ГОРОД — пассива у штаба нет, вся работа в касте
  // «Перенос» (CityTransferExecution). new-units/WALKING.md
  [UnitType.WalkingCity]: null,
};

export class ConstructionExecution implements Execution {
  private structure: Unit | null = null;
  private active: boolean = true;
  private mg: Game;

  private ticksUntilComplete: Tick;

  constructor(
    private player: Player,
    private constructionType: UnitType,
    private tile: TileRef,
    private rocketDirectionUp?: boolean,
    private troops?: number, // terron: ультимейты — вклад войск в Раскол
    private dstTile?: number, // terron: «Перенос» — куда идут здания (WALKING.md)
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    if (this.mg.config().isUnitDisabled(this.constructionType)) {
      console.warn(
        `cannot build construction ${this.constructionType} because it is disabled`,
      );
      this.active = false;
      return;
    }

    if (!this.mg.isValidRef(this.tile)) {
      console.warn(`cannot build construction invalid tile ${this.tile}`);
      this.active = false;
      return;
    }
  }

  tick(ticks: number): void {
    if (this.structure === null) {
      const info = this.mg.unitInfo(this.constructionType);
      // For non-structure units (nukes/warship), charge once and delegate to specialized executions.
      const isStructure = this.isStructure(this.constructionType);
      if (!isStructure) {
        // Defer validation and gold deduction to the specific execution
        this.completeConstruction();
        this.active = false;
        return;
      }

      // Structures: build real unit and mark under construction
      const spawnTile = this.player.canBuild(this.constructionType, this.tile);
      if (spawnTile === false) {
        console.warn(`cannot build ${this.constructionType}`);
        this.active = false;
        return;
      }
      this.structure = this.player.buildUnit(
        this.constructionType,
        spawnTile,
        {},
      );
      const duration = info.constructionDuration ?? 0;
      if (duration > 0) {
        this.structure.setUnderConstruction(true);
        this.ticksUntilComplete = duration;
        return;
      }
      // No construction time
      this.completeConstruction();
      this.active = false;
      return;
    }

    if (!this.structure.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.structure.owner()) {
      this.player = this.structure.owner();
    }

    if (this.ticksUntilComplete === 0) {
      this.player = this.structure.owner();
      this.completeConstruction();
      this.active = false;
      return;
    }
    this.ticksUntilComplete--;
  }

  private completeConstruction() {
    if (this.structure) {
      this.structure.setUnderConstruction(false);
    }
    const player = this.player;
    const type = this.constructionType;

    // Структуры — исполнитель из реестра (или null = пассивный штаб).
    if (this.structure !== null && Structures.has(type)) {
      const factory = STRUCTURE_EXECUTIONS[type];
      if (factory !== null) {
        this.mg.addExecution(factory(this.structure));
      }
      // terron: СТОЛИЦЫ — первый построенный City игрока (нет живой столицы)
      // становится СТОЛИЦЕЙ: золотой тинт + доход (в CityExecution). Потерял
      // столицу → capital()===null → следующий город снова станет ею. CAPITALS.md
      // ТОЛЬКО у наций и живых игроков; у ПЛЕМЁН (ботов) столиц НЕТ (решение владельца).
      // terron: ЗНАМЯ ПОБЕДЫ — пока моя столица под чужим знаменем, новую не
      // основать (new-units/BANNER.md).
      if (
        type === UnitType.City &&
        player.type() !== PlayerType.Bot &&
        player.capital() === null &&
        !player.capitalUnderBanner()
      ) {
        this.structure.setCapital(true);
        // Вторая и следующие столицы игрока подписываются как «Новая …» —
        // имя-то одно и то же (сеется id игрока), и две одинаковые подписи на
        // карте читались как «у меня две столицы» (репорт владельца 05.08).
        this.structure.setCapitalGeneration(player.foundCapital());
        // terron (TZ-skin-capitals.md): у «государства»-скина своё имя столицы
        // (PlayerInfo.capitalName, из косметики через GameStartInfo); без него —
        // генератор. Кастомное имя — само себе канон: CAPITAL_RU его не знает,
        // и capitalLabel на рендере честно падает на raw.
        this.structure.setCapitalName(
          player.info().capitalName ??
            pickCapitalName(
              player.name(),
              player.type() === PlayerType.Nation,
              player.id(),
            ),
        );
        player.setCapital(this.structure);
      }
      return;
    }

    // Мгновенные действия (юнит не строится — списали золото и делегировали).
    switch (type) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      // terron: ультимейты — «Реки вспять»: та же ракета-экзекуция, разница
      // только в типе (NukeExecution топит землю вместо выжигания).
      case UnitType.WaterNuke:
        this.mg.addExecution(
          new NukeExecution(
            type,
            player,
            this.tile,
            null,
            -1,
            0,
            this.rocketDirectionUp,
          ),
        );
        break;
      case UnitType.MIRV:
        this.mg.addExecution(new MirvExecution(player, this.tile));
        break;
      // terron: ультимейты — Раскол: таргетная атака (юнит не строится, эффект мгновенный).
      case UnitType.Split:
        this.mg.addExecution(
          new SplitExecution(player, this.tile, this.troops ?? 0),
        );
        break;
      // terron: «Сбить спутники» — ракета Неба нашего: своя экзекуция ставит
      // носитель на своей земле и ведёт 60с телеграф-сборку. NEBO.md
      case UnitType.SatelliteStrike:
        this.mg.addExecution(new SatelliteStrikeExecution(player, this.tile));
        break;
      // terron: «Блокада» — каст Пиратства: зона паники торговли в океане.
      case UnitType.Blockade:
        this.mg.addExecution(
          new BlockadeExecution(player, this.tile, this.troops ?? 1),
        );
        break;
      // terron: «Передышка» — каст Гордости (мир вокруг кастера, доля войск).
      case UnitType.Respite:
        this.mg.addExecution(
          new RespiteExecution(player, this.tile, this.troops ?? 0),
        );
        break;
      // terron: «Террор» — каст Фанатизма (взрывы зданий у цели).
      case UnitType.Terror:
        this.mg.addExecution(
          new TerrorExecution(player, this.tile, this.troops ?? 0),
        );
        break;
      // terron: «Пакт» — каст Дворца наций (навязанный союз).
      case UnitType.Pact:
        this.mg.addExecution(new PactExecution(player, this.tile));
        break;
      // terron: «Это катастрофа!» — каст Зелёных (травля: штраф к доходу).
      case UnitType.Catastrophe:
        this.mg.addExecution(new CatastropheExecution(player, this.tile));
        break;
      // terron: «Рекультивация» — каст АЭС (уборка пепла за деньги).
      case UnitType.Recultivation:
        this.mg.addExecution(new RecultivationExecution(player, this.tile));
        break;
      // terron: «Индустриальная революция» — каст Топлива.
      case UnitType.IndustrialRevolution:
        this.mg.addExecution(
          new IndustrialRevolutionExecution(player, this.tile),
        );
        break;
      // terron: «Выстрел Доры» — назначить цель орудию (оно доедет и выстрелит).
      case UnitType.RailGunShell:
        this.mg.addExecution(new RailGunShellExecution(player, this.tile));
        break;
      // terron: «Состав смерти» — каст Взрывных поездов (тикающий состав).
      case UnitType.DoomTrain:
        this.mg.addExecution(new DoomTrainExecution(player, this.tile));
        break;
      // terron: «Перенос» — каст Шагающего города: здания зоны идут в точку.
      case UnitType.CityTransfer:
        this.mg.addExecution(
          new CityTransferExecution(
            player,
            this.tile,
            this.dstTile ?? null,
            this.troops ?? 0,
          ),
        );
        break;
      // terron: «Олимпийские игры» — каст Стадиона (всемирный мир).
      case UnitType.Truce:
        this.mg.addExecution(new TruceExecution(player, this.tile));
        break;
      // terron: авиация — дрон-камикадзе: летит с ближайшего аэропорта в точку и взрывается.
      case UnitType.SuicideDrone:
        this.mg.addExecution(new SuicideDroneExecution(player, this.tile));
        break;
      case UnitType.Warship:
        this.mg.addExecution(
          new WarshipExecution({ owner: player, patrolTile: this.tile }),
        );
        break;
      default:
        console.warn(`unit type ${type} cannot be constructed`);
        break;
    }
  }

  // terron: «строение» = идёт через флоу стройки (реальный юнит + underConstruction),
  // а не мгновенное действие (ядерка/варшип/раскол/дрон). Это ровно группа
  // Structures из Game.ts — держим ОДИН источник, а не параллельный список здесь
  // (иначе рассинхрон со списком в completeConstruction = молчаливый баг).
  private isStructure(type: UnitType): boolean {
    return Structures.has(type);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

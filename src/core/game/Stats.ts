import { AllPlayersStats } from "../Schemas";
import { NukeType, OtherUnitType, PlayerStats } from "../StatsSchemas";
import { Player, TerraNullius } from "./Game";

export interface Stats {
  getPlayerStats(player: Player): PlayerStats | null;
  stats(): AllPlayersStats;

  numMirvsLaunched(): bigint;

  // Player attacks target
  attack(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player cancels attack on target
  attackCancel(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player betrays another player
  betray(player: Player): void;
  // terron: ДВОРЕЦ НАЦИЙ — игрока предали (ключ ульты «Преданный»: 20 раз).
  betrayed(player: Player): void;

  // terron: ГОРДОСТЬ — доля карты (сотые %), раз в секунду: пик и провал после пика.
  territory(player: Player, pct100: number): void;
  // terron: ЗНАМЯ ПОБЕДЫ — захвачена чужая столица (ключ ульты: 100 столиц).
  capitalCaptured(player: Player): void;
  // terron: ТОПЛИВО — пик одновременно стоящих нефтяных вышек. FUEL.md
  oilRigs(player: Player, count: number): void;
  // terron: ДОРА — вражеское здание снесено дроном. DORA.md
  dronedBuilding(player: Player): void;
  // terron 24.08: топливная цепочка. Пик суммы уровней фабрик за матч.
  factoryLevels(player: Player, sum: number): void;
  // Поезд отправлен со своей станции.
  trainSent(player: Player): void;
  // Ульт-здание (чужое или своё) снесено выстрелом Доры.
  railgunUltKill(player: Player): void;

  // terron: player формирует союз с ally. Счётчик пишется у player, индекс — по
  // типу ally (человек/нация/племя), как в conquests. Для статистики и ачивок
  // «Друг племени»/«Друг нации».
  alliance(player: Player, ally: Player): void;

  // Time between lobby creation and game start (ms)
  lobbyFillTime(fillTimeMs: number): void;

  // Player sends a trade ship to target
  boatSendTrade(player: Player, target: Player): void;

  // Player's trade ship arrives at target, both players earn gold
  boatArriveTrade(player: Player, target: Player, gold: number | bigint): void;

  // Player's trade ship, captured from target, arrives. Player earns gold.
  boatCapturedTrade(
    player: Player,
    target: Player,
    gold: number | bigint,
  ): void;

  // Player destroys target's trade ship
  boatDestroyTrade(player: Player, target: Player): void;

  // Player sends a transport ship to target with troops
  boatSendTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player's transport ship arrives at target with troops
  boatArriveTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player destroys target's transport ship with troops
  boatDestroyTroops(
    player: Player,
    target: Player,
    troops: number | bigint,
  ): void;

  // Player launches bomb at target
  bombLaunch(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void;

  // Player's bomb lands at target
  bombLand(player: Player, target: Player | TerraNullius, type: NukeType): void;

  // Player's SAM intercepts a bomb from attacker
  bombIntercept(player: Player, type: NukeType, count: number | bigint): void;

  // Player earns gold from conquering tiles or trade ships from captured
  goldWar(player: Player, captured: Player, gold: number | bigint): void;

  // terron ФФА-рейтинг: eater откусил ≥40% тайлов victim (на завоевании victim).
  // Записывает счётчики у людей-участников (RATING.md). Вызывается на каждого
  // квалифицированного едока конкретной жертвы.
  ffaConquer(eater: Player, victim: Player): void;

  // Player earns gold from workers
  goldWork(player: Player, gold: number | bigint): void;

  // Player builds a unit of type
  unitBuild(player: Player, type: OtherUnitType): void;

  // Player captures a unit of type
  unitCapture(player: Player, type: OtherUnitType): void;

  // Player upgrades a unit of type
  unitUpgrade(player: Player, type: OtherUnitType): void;

  // Player destroys a unit of type
  unitDestroy(player: Player, type: OtherUnitType): void;

  // Player loses a unit of type
  unitLose(player: Player, type: OtherUnitType): void;

  // player was killed (0 tiles)
  playerKilled(player: Player, tick: number): void;

  // Player's train arrives at any station, generating gold
  trainSelfTrade(player: Player, gold: number | bigint): void;

  // Another player's train arrives at own station
  trainExternalTrade(player: Player, goldPlayer: number | bigint): void;

  // terron: ультимейты — игрок зафиксировал выбор ульты (для статистики
  // пиков/винрейта на /balance). new-units/ULTIMATES.md
  ultimateChosen(player: Player, ult: string): void;
}

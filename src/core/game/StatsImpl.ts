import { AllPlayersStats } from "../Schemas";
import {
  ATTACK_INDEX_CANCEL,
  ATTACK_INDEX_RECV,
  ATTACK_INDEX_SENT,
  BOAT_INDEX_ARRIVE,
  BOAT_INDEX_CAPTURE,
  BOAT_INDEX_DESTROY,
  BOAT_INDEX_SENT,
  BoatUnit,
  BOMB_INDEX_INTERCEPT,
  BOMB_INDEX_LAND,
  BOMB_INDEX_LAUNCH,
  GOLD_INDEX_STEAL,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_TRAIN_OTHER,
  GOLD_INDEX_TRAIN_SELF,
  GOLD_INDEX_WAR,
  GOLD_INDEX_WORK,
  NukeType,
  OTHER_INDEX_BUILT,
  OTHER_INDEX_CAPTURE,
  OTHER_INDEX_DESTROY,
  OTHER_INDEX_LOST,
  OTHER_INDEX_UPGRADE,
  OtherUnitType,
  PLAYER_INDEX_BOT,
  PLAYER_INDEX_HUMAN,
  PLAYER_INDEX_NATION,
  PlayerStats,
  unitTypeToBombUnit,
  unitTypeToOtherUnit,
} from "../StatsSchemas";
import { Player, PlayerType, TerraNullius, UnitType } from "./Game";
import { Stats } from "./Stats";

type BigIntLike = bigint | number;
function _bigint(value: BigIntLike): bigint {
  switch (typeof value) {
    case "bigint":
      return value;
    case "number":
      return BigInt(Math.floor(value));
  }
}

const conquest_by_type: Record<PlayerType, number> = {
  [PlayerType.Human]: PLAYER_INDEX_HUMAN,
  [PlayerType.Nation]: PLAYER_INDEX_NATION,
  [PlayerType.Bot]: PLAYER_INDEX_BOT,
};

export class StatsImpl implements Stats {
  private readonly data: AllPlayersStats = {};

  private _numMirvLaunched: bigint = 0n;

  numMirvsLaunched(): bigint {
    return this._numMirvLaunched;
  }

  getPlayerStats(player: Player): PlayerStats {
    const clientID = player.clientID();
    if (clientID === null) return undefined;
    return this.data[clientID];
  }

  stats() {
    return this.data;
  }

  private _makePlayerStats(player: Player): PlayerStats {
    const clientID = player.clientID();
    if (clientID === null) return undefined;
    if (clientID in this.data) {
      return this.data[clientID];
    }
    const data = {} satisfies PlayerStats;
    this.data[clientID] = data;
    return data;
  }

  private _addAttack(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.attacks ??= [0n];
    while (p.attacks.length <= index) p.attacks.push(0n);
    p.attacks[index] += _bigint(value);
  }

  private _addBetrayal(player: Player, value: BigIntLike) {
    const data = this._makePlayerStats(player);
    if (data === undefined) return;
    data.betrayals ??= 0n;
    data.betrayals += _bigint(value);
  }

  private _addBoat(
    player: Player,
    type: BoatUnit,
    index: number,
    value: BigIntLike,
  ) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.boats ??= { [type]: [0n] };
    p.boats[type] ??= [0n];
    while (p.boats[type].length <= index) p.boats[type].push(0n);
    p.boats[type][index] += _bigint(value);
  }

  private _addBomb(
    player: Player,
    nukeType: NukeType,
    index: number,
    value: BigIntLike,
  ): void {
    const type = unitTypeToBombUnit[nukeType];
    // terron 06.08: тип ракеты, которого НЕТ в таблице кодов бомб (abomb/hbomb/
    // mirv/mirvw), статистику не пишет вовсе. Повод: «Реки вспять» сознательно
    // не заводили в zod-схему архива, а вызовы приводили тип через `as NukeType`
    // → в записи появлялся ключ "undefined", сервер отвергал сообщение клиента
    // и КИКАЛ его из матча (kick_reason.invalid_message). Гард ОДИН здесь —
    // закрывает все точки вызова (пуск/попадание/перехват) разом.
    if (type === undefined) return;
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.bombs ??= { [type]: [0n] };
    p.bombs[type] ??= [0n];
    while (p.bombs[type].length <= index) p.bombs[type].push(0n);
    p.bombs[type][index] += _bigint(value);
  }

  private _addGold(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.gold ??= [0n];
    while (p.gold.length <= index) p.gold.push(0n);
    p.gold[index] += _bigint(value);
  }

  private _addOtherUnit(
    player: Player,
    otherUnitType: OtherUnitType,
    index: number,
    value: BigIntLike,
  ) {
    const type = unitTypeToOtherUnit[otherUnitType];
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.units ??= { [type]: [0n] };
    p.units[type] ??= [0n];
    while (p.units[type].length <= index) p.units[type].push(0n);
    p.units[type][index] += _bigint(value);
  }

  private _addConquest(player: Player, index: number) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.conquests ??= [0n];
    while (p.conquests.length <= index) p.conquests.push(0n);
    p.conquests[index] += _bigint(1);
  }

  private _addAlliance(player: Player, index: number) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.alliances ??= [0n];
    while (p.alliances.length <= index) p.alliances.push(0n);
    p.alliances[index] += _bigint(1);
  }

  private _addPlayerKilled(player: Player, tick: number) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.killedAt = _bigint(tick);
  }

  attack(
    player: Player,
    target: Player | TerraNullius,
    troops: BigIntLike,
  ): void {
    this._addAttack(player, ATTACK_INDEX_SENT, troops);
    if (target.isPlayer()) {
      this._addAttack(target, ATTACK_INDEX_RECV, troops);
    }
  }

  attackCancel(
    player: Player,
    target: Player | TerraNullius,
    troops: BigIntLike,
  ): void {
    this._addAttack(player, ATTACK_INDEX_CANCEL, troops);
    this._addAttack(player, ATTACK_INDEX_SENT, -troops);
    if (target.isPlayer()) {
      this._addAttack(target, ATTACK_INDEX_RECV, -troops);
    }
  }

  // terron: ГОРДОСТЬ — peakPct = максимум за матч, dipPct = минимум ПОСЛЕ пика
  // (сброс в момент нового пика). Для ключа «Феникс» (≥50 % → ≤10 % → победа).
  territory(player: Player, pct100: number): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    const v = BigInt(pct100);
    const peak = p.peakPct ?? 0n;
    if (v > peak) {
      p.peakPct = v;
      p.dipPct = v;
    } else if (p.dipPct === undefined || v < p.dipPct) {
      p.dipPct = v;
    }
  }

  // terron: ТОПЛИВО — пик одновременно стоявших нефтяных вышек за матч.
  oilRigs(player: Player, count: number): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    const v = BigInt(count);
    if ((p.oilRigsPeak ?? 0n) < v) p.oilRigsPeak = v;
  }

  // terron: ДОРА — счётчик вражеских зданий, снесённых дронами.
  dronedBuilding(player: Player): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.dronedBuildings = (p.dronedBuildings ?? 0n) + 1n;
  }

  // terron 24.08: топливная цепочка (Топливо → Дора → Депо смерти).
  factoryLevels(player: Player, sum: number): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    const v = BigInt(sum);
    if ((p.factoryLevelsPeak ?? 0n) < v) p.factoryLevelsPeak = v;
  }

  // terron 25.08: ключ Шагающего города — пик суммы уровней всех зданий.
  buildingLevels(player: Player, sum: number): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    const v = BigInt(sum);
    if ((p.buildingLevelsPeak ?? 0n) < v) p.buildingLevelsPeak = v;
  }

  trainSent(player: Player): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.trainsSent = (p.trainsSent ?? 0n) + 1n;
  }

  railgunUltKill(player: Player): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.railgunUltKills = (p.railgunUltKills ?? 0n) + 1n;
  }

  // terron: ЗНАМЯ ПОБЕДЫ — счётчик захваченных столиц.
  capitalCaptured(player: Player): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.capitalsCaptured = (p.capitalsCaptured ?? 0n) + 1n;
  }

  betray(player: Player): void {
    this._addBetrayal(player, 1);
  }

  betrayed(player: Player): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.betrayed = (p.betrayed ?? 0n) + 1n;
  }

  alliance(player: Player, ally: Player): void {
    const index = conquest_by_type[ally.type()];
    if (index !== undefined) this._addAlliance(player, index);
  }

  boatSendTrade(player: Player, target: Player): void {
    this._addBoat(player, "trade", BOAT_INDEX_SENT, 1);
  }

  boatArriveTrade(player: Player, target: Player, gold: BigIntLike): void {
    this._addBoat(player, "trade", BOAT_INDEX_ARRIVE, 1);
    this._addGold(player, GOLD_INDEX_TRADE, gold);
    this._addGold(target, GOLD_INDEX_TRADE, gold);
  }

  boatCapturedTrade(player: Player, target: Player, gold: BigIntLike): void {
    this._addBoat(player, "trade", BOAT_INDEX_CAPTURE, 1);
    this._addGold(player, GOLD_INDEX_STEAL, gold);
  }

  boatDestroyTrade(player: Player, target: Player): void {
    this._addBoat(player, "trade", BOAT_INDEX_DESTROY, 1);
  }

  boatSendTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: BigIntLike,
  ): void {
    this._addBoat(player, "trans", BOAT_INDEX_SENT, 1);
  }

  boatArriveTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: BigIntLike,
  ): void {
    this._addBoat(player, "trans", BOAT_INDEX_ARRIVE, 1);
  }

  boatDestroyTroops(player: Player, target: Player, troops: BigIntLike): void {
    this._addBoat(player, "trans", BOAT_INDEX_DESTROY, 1);
  }

  bombLaunch(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void {
    if (type === UnitType.MIRV) {
      this._numMirvLaunched++;
    }
    this._addBomb(player, type, BOMB_INDEX_LAUNCH, 1);
  }

  bombLand(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void {
    this._addBomb(player, type, BOMB_INDEX_LAND, 1);
  }

  bombIntercept(player: Player, type: NukeType, count: BigIntLike): void {
    this._addBomb(player, type, BOMB_INDEX_INTERCEPT, count);
  }

  goldWork(player: Player, gold: BigIntLike): void {
    this._addGold(player, GOLD_INDEX_WORK, gold);
  }

  goldWar(player: Player, captured: Player, gold: BigIntLike): void {
    this._addGold(player, GOLD_INDEX_WAR, gold);
    const conquestType = conquest_by_type[captured.type()];
    if (conquestType !== undefined) {
      this._addConquest(player, conquestType);
    }
  }

  private _bumpFfa(
    player: Player,
    key: "ffaEatHumans" | "ffaEatBots" | "ffaBotEatersOfMe",
  ): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return; // нет clientID (бот) — статов нет
    p[key] = (p[key] ?? 0n) + 1n;
  }

  ffaConquer(eater: Player, victim: Player): void {
    const eaterHuman = eater.clientID() !== null;
    const victimHuman = victim.clientID() !== null;
    if (eaterHuman) {
      // человек-едок: пишем счётчик ему. Человека съел → +1; бота → «Нации» −штраф.
      this._bumpFfa(eater, victimHuman ? "ffaEatHumans" : "ffaEatBots");
    } else if (victimHuman) {
      // бот съел человека → «Нации» +1; пишем у жертвы-человека.
      this._bumpFfa(victim, "ffaBotEatersOfMe");
    }
    // бот съел бота → ничего (RATING.md).
  }

  unitBuild(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_BUILT, 1);
  }

  unitCapture(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_CAPTURE, 1);
  }

  unitUpgrade(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_UPGRADE, 1);
  }

  unitDestroy(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_DESTROY, 1);
  }

  unitLose(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_LOST, 1);
  }

  playerKilled(player: Player, tick: number): void {
    this._addPlayerKilled(player, tick);
  }

  trainSelfTrade(player: Player, gold: BigIntLike): void {
    this._addGold(player, GOLD_INDEX_TRAIN_SELF, gold);
  }

  trainExternalTrade(player: Player, gold: BigIntLike): void {
    this._addGold(player, GOLD_INDEX_TRAIN_OTHER, gold);
  }

  // terron: ультимейты — фиксация выбора (у ботов нет clientID → _makePlayerStats
  // вернёт undefined и запись не произойдёт; статистика только по людям).
  ultimateChosen(player: Player, ult: string): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.ult = ult;
  }

  lobbyFillTime(fillTimeMs: number): void {}
}

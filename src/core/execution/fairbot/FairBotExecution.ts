// terron 22.09: ЧЕСТНЫЙ БОТ (fair bot) — «симуляция настоящего онлайна».
// Спека, решения владельца и что не сделано — new-units/FAIRBOT.md.
//
// ВЕРСИИ (23.09, FairBotRoster.FairBotVersion): v1 — как было 22.09, его ветки
// и порядок вызовов ГСЧ НЕ ТРОГАТЬ (на них держатся реплеи v1-матчей). v2 —
// поправки по разбору побед топ-игроков, помечены `this.v2`.
//
// ⚠️ НИКУДА НЕ ПОДКЛЮЧЁН (решение владельца 22.09: «сделай, но никуда не
// добавляй, подумаем»). Его не создаёт ни ExecutionManager, ни лобби, ни
// плейлист — только headless-арена (scripts/fairbot-arena.ts) и тесты.
//
// Чем отличается от нации:
//  * РЕСУРСЫ 1к1 С ИГРОКОМ. Игрок типа Human: без множителей сложности к
//    потолку войск, приросту и золоту (Config.maxTroops/troopIncreaseRate).
//  * ТЕМП ЧЕЛОВЕКА. Реакции раз в 1–3 с, волна атаки и стройка раз в 4–6 с
//    (свои периоды и сдвиги от сида), а не каждый тик. Это же условие перфа:
//    бот считается на каждом телефоне.
//  * ДЕЙСТВУЕТ ТОЛЬКО ПУТЁМ ИГРОКА. Постройка и пуск — ConstructionExecution
//    (он же исполняет интент build_unit), выбор ульты — ChooseUltimateExecution
//    (интент choose_ultimate), атака — AttackExecution. Своих обходов нет, поэтому
//    бот не может того, чего не может человек, и не «крашит» ульты.
//  * УЛЬТЫ. Своя сетка из 6 базовых, выбор по сигналам карты (FairBotPlaybook).
//  * РЕАКЦИИ, которые и делают его похожим на живого: ядерка по чужой нефтевышке
//    (её убивает только ядерка), удар по слабому соседу, занятому другим
//    фронтом, отказ в союзе владельцу Религии.
import { TERRON_OURSKY_REACTION_BUFFER_TICKS } from "../../configuration/TerronTuning";
import {
  Execution,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { GameID } from "../../Schemas";
import { simpleHash } from "../../Util";
import { ChooseUltimateExecution } from "../ChooseUltimateExecution";
import { ConstructionExecution } from "../ConstructionExecution";
import { NationAirBehavior } from "../nation/NationAirBehavior";
import { NationAllianceBehavior } from "../nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../nation/NationEmojiBehavior";
import { NationMIRVBehavior } from "../nation/NationMIRVBehavior";
import { NationNukeBehavior } from "../nation/NationNukeBehavior";
import { NationStructureBehavior } from "../nation/NationStructureBehavior";
import { randTerritoryTileArray } from "../nation/NationUtils";
import { NationWarshipBehavior } from "../nation/NationWarshipBehavior";
import { SpawnExecution } from "../SpawnExecution";
import { TileDistanceIndex } from "../Util";
import { AiAttackBehavior } from "../utils/AiAttackBehavior";
import { gameWithBotDifficulty } from "./FairBotDifficulty";
import { FairBotPerception } from "./FairBotPerception";
import {
  drawUltGrid,
  FAIR_BOT_PLAYBOOK,
  fairBotUltPool,
  pickUltimate,
} from "./FairBotPlaybook";
import { FairBotVersion } from "./FairBotRoster";

/** Период РЕАКЦИЙ: 10–30 тиков = 1–3 с (у человека реакция того же порядка). */
const THINK_MIN_TICKS = 10;
const THINK_MAX_TICKS = 30;
/**
 * Период МАКРО (волна атаки, стройка, флот, ракеты): 40–60 тиков = 4–6 с.
 * ⚠️ Замер арены 22.09: с макро на темпе реакций (1–3 с) бот слал волну
 * экспансии каждую секунду, держал войска у нижней планки резерва (там они и
 * растут медленнее) и проигрывал контрольной группе с мозгом нации на всех
 * трёх сидах. Живой игрок тоже кликает атаку раз в несколько секунд, а не
 * каждую: быстрыми остаются только реакции.
 */
const MACRO_MIN_TICKS = 40;
const MACRO_MAX_TICKS = 60;
/** Ульту выбираем через 60–120 с после спавна: соседи к этому времени видны. */
const ULT_DECIDE_MIN_TICKS = 600;
const ULT_DECIDE_MAX_TICKS = 1200;
/** Начинаем копить на штаб, когда набрано столько от его цены. */
const HQ_SAVE_FROM = 0.4;
/** Ядерка по нефтевышке — не чаще раза в 30 с. */
const RIG_STRIKE_COOLDOWN_TICKS = 300;
/** Удар по слабому соседу: он слабее нас во столько раз… */
const OPPORTUNIST_WEAK_RATIO = 0.5;
/** …и нам есть чем бить (доля от потолка войск). */
const OPPORTUNIST_MIN_OWN_RATIO = 0.5;
/**
 * …и не в дебюте. ⚠️ Замер арены 22.09: в первые минуты все расширяются друг в
 * друга, «сосед занят фронтом» верно почти всегда, и бот объявлял войну раньше,
 * чем вставал на ноги, — а потом огребал ответку. Живой игрок в дебюте тоже
 * жрёт ничейную землю, а не соседей.
 */
const OPPORTUNIST_AFTER_TICKS = 1800;
/** По одному и тому же соседу — не чаще раза в 15 с. */
const OPPORTUNIST_COOLDOWN_TICKS = 150;
/** Бункерная линия Укреплений: не больше стольких бункеров. */
const BUNKER_LINE_MAX = 8;

// ---------- v2 (23.09): по разбору 15 побед топ-игроков, FAIRBOT.md §v2 ----------
/**
 * Наступать на ЧЕЛОВЕКА — только если у него не больше этой доли наших войск.
 * Топы: 10 % атак по людям, медиана «войска жертвы / свои» 0.26; остальные
 * игроки лезут на тех, кто вдвое СИЛЬНЕЕ (2.18), и проигрывают.
 */
const V2_HUMAN_RATIO = 0.3;
/** На другого честного бота — ещё строже: не грызть друг друга (репорт Smart). */
const V2_FAIRBOT_RATIO = 0.2;
// ⚠️ Волну (копить до 50–60 % потолка, держать 30–40 %) v2 берёт у v1. Проба
// «как топы» (42–48 / 30–35) на арене провалилась: волна выходила ~12 %
// потолка, нации её отбивали, и лучший бот падал с 36 % суши до 8 %
// (перебор правок по одной, FAIRBOT.md §v2). Топам низкий запас сходит с рук
// за счёт десятков городов, у бота их нет.
/** Ядерка по тому, на кого наступаем, — не раньше (топы: первая на ~9-й мин). */
const V2_OFFENSIVE_NUKE_AFTER_TICKS = 4800;
/**
 * Десант + суша: наш десант в стольких тайлах от высадки (лодка идёт тайл за
 * тик, это ~8–10 с) — бьём по той же стране и по суше. Идея Smart из беты.
 */
const V2_COMBO_DIST = 80;
const V2_COMBO_COOLDOWN_TICKS = 150;
/** Союз не даём лидеру (больше второго в столько раз)… */
const V2_LEADER_LEAD = 1.5;
/** …и тому, у кого уже столько союзов с ИИ (идея KDaniilW из беты). */
const V2_AI_ALLIES_LIMIT = 3;

/**
 * v2: годится ли игрок в цель НАСТУПЛЕНИЯ по нашей инициативе. Нации и племена —
 * всегда (топы: 81 % атак по ним); человек — только заметно слабее нас; другой
 * честный бот (Human без клиента) — ещё слабее. `theirTroops === null` —
 * войска не видны («Закрытая страна»): не лезем вслепую.
 */
export function fairV2Targetable(
  target: { type: PlayerType; isFairBot: boolean },
  theirTroops: number | null,
  myTroops: number,
): boolean {
  if (target.type !== PlayerType.Human) return true;
  if (theirTroops === null) return false;
  const k = target.isFairBot ? V2_FAIRBOT_RATIO : V2_HUMAN_RATIO;
  return theirTroops <= myTroops * k;
}

/** Что бот сделал за матч — для арены и тестов (в симуляцию не влияет). */
export interface FairBotStats {
  grid: UnitType[];
  ult: UnitType | null;
  ultDecidedTick: number | null;
  hqBuiltTicks: number[];
  rigStrikes: number;
  opportunistStrikes: number;
  refusedReligion: number;
  bunkers: number;
  /** v2: удар по суше вслед за своим десантом. */
  comboStrikes: number;
  /** v2: ядерка нацелена на того, на кого наступаем. */
  focusNukes: number;
  /** v2: отказ в союзе лидеру / собирателю союзов с ИИ. */
  refusedLeader: number;
}

export class FairBotExecution implements Execution {
  private active = true;
  private mg!: Game;
  private player: Player | null = null;
  private readonly random: PseudoRandom;
  private readonly thinkEvery: number;
  private readonly thinkOffset: number;
  private readonly macroEvery: number;
  private readonly macroOffset: number;
  private readonly ultDecideAfter: number;
  private spawnQueued = false;
  private spawnEndTick: number | null = null;
  private ready = false;

  private perception!: FairBotPerception;
  private emoji!: NationEmojiBehavior;
  private alliance!: NationAllianceBehavior;
  private attack!: AiAttackBehavior;
  private structures!: NationStructureBehavior;
  private nukes!: NationNukeBehavior;
  private mirv!: NationMIRVBehavior;
  private warships!: NationWarshipBehavior;
  private air!: NationAirBehavior;

  private lastRigStrike = -Infinity;
  private readonly lastStrikeOn = new Map<Player, number>();

  readonly stats: FairBotStats = {
    grid: [],
    ult: null,
    ultDecidedTick: null,
    hqBuiltTicks: [],
    rigStrikes: 0,
    opportunistStrikes: 0,
    refusedReligion: 0,
    bunkers: 0,
    comboStrikes: 0,
    focusNukes: 0,
    refusedLeader: 0,
  };
  private readonly v2: boolean;
  private readonly lastComboOn = new Map<Player, number>();

  constructor(
    private readonly gameID: GameID,
    private readonly info: PlayerInfo,
    readonly version: FairBotVersion = 1,
  ) {
    if (info.playerType !== PlayerType.Human) {
      // Честность ресурсов держится именно на типе Human (см. шапку файла).
      throw new Error("FairBot must be a Human-type player");
    }
    this.v2 = version === 2;
    this.random = new PseudoRandom(simpleHash(info.id) + simpleHash(gameID));
    this.thinkEvery = this.random.nextInt(THINK_MIN_TICKS, THINK_MAX_TICKS + 1);
    this.thinkOffset = this.random.nextInt(0, this.thinkEvery);
    this.macroEvery = this.random.nextInt(MACRO_MIN_TICKS, MACRO_MAX_TICKS + 1);
    this.macroOffset = this.random.nextInt(0, this.macroEvery);
    this.ultDecideAfter = this.random.nextInt(
      ULT_DECIDE_MIN_TICKS,
      ULT_DECIDE_MAX_TICKS + 1,
    );
  }

  init(mg: Game): void {
    this.mg = mg;
    this.player = mg.hasPlayer(this.info.id)
      ? mg.player(this.info.id)
      : mg.addPlayer(this.info);
  }

  tick(ticks: number): void {
    const player = this.player;
    if (player === null) return;

    if (this.mg.inSpawnPhase()) {
      // Место выбираем так же, как игрок без выбора: случайной свободной сушей.
      if (!this.spawnQueued) {
        this.mg.addExecution(new SpawnExecution(this.gameID, this.info));
        this.spawnQueued = true;
      }
      return;
    }
    if (!player.hasSpawned()) return;
    if (!player.isAlive()) {
      this.active = false;
      return;
    }
    this.spawnEndTick ??= ticks;

    if (!this.ready) {
      this.initBehaviors(player);
      // Первый ход — как у всех: занять свободную землю вокруг.
      this.attack.forceSendAttack(this.mg.terraNullius());
      return;
    }

    if ((ticks + this.thinkOffset) % this.thinkEvery === 0) {
      this.react(player, ticks);
    }
    const phase = (ticks + this.macroOffset) % this.macroEvery;
    if (phase === 0) {
      this.macro(player);
    } else if (
      phase === Math.floor(this.macroEvery / 3) ||
      phase === Math.floor((this.macroEvery * 2) / 3)
    ) {
      // Как у наций: стройка ещё дважды между волнами, иначе золото копится
      // быстрее, чем тратится.
      if (!this.savingForHq(player)) this.structures.handleStructures();
    }
  }

  private initBehaviors(player: Player): void {
    const r = this.random;
    this.perception = new FairBotPerception(this.mg, player);
    // Поведения наций читают сложность лобби; решения бота — всегда на уровне
    // FAIR_BOT_DIFFICULTY (ресурсы не трогает, см. FairBotDifficulty.ts).
    const g = gameWithBotDifficulty(this.mg);
    this.emoji = new NationEmojiBehavior(r, g, player);
    this.alliance = new NationAllianceBehavior(r, g, player, this.emoji);
    // Доли войск — посередине диапазона наций, без разброса по сложности.
    this.attack = new AiAttackBehavior(
      r,
      g,
      player,
      r.nextInt(50, 60) / 100,
      r.nextInt(30, 40) / 100,
      r.nextInt(10, 20) / 100,
      this.alliance,
      this.emoji,
    );
    if (this.v2) {
      this.attack.setTargetFilter((p) =>
        fairV2Targetable(
          { type: p.type(), isFairBot: p.clientID() === null },
          this.perception.troopsOf(p),
          player.troops(),
        ),
      );
    }
    this.structures = new NationStructureBehavior(r, g, player);
    this.nukes = new NationNukeBehavior(r, g, player, this.attack, this.emoji);
    this.mirv = new NationMIRVBehavior(r, g, player, this.emoji);
    this.warships = new NationWarshipBehavior(r, g, player, this.emoji);
    this.air = new NationAirBehavior(r, g, player, this.attack);
    this.ready = true;
  }

  /** Быстрый контур (1–3 с): дипломатия, ульта, реакции на соседей. */
  private react(player: Player, ticks: number): void {
    this.refuseReligionAlliances(player);
    if (this.v2) this.refuseLeaderAlliances(player);
    this.alliance.handleAllianceRequests();
    this.alliance.handleAllianceExtensionRequests();
    // «Небо наше»: ослеплённый не наступает и не пускает ракеты.
    const blinded = this.mg.satelliteBlackoutBlinds(player);
    // Одно «крупное» решение за раз: ульта ИЛИ реакция.
    if (!this.ultStep(player, ticks) && !blinded) {
      if (
        !this.rigStrike(player, ticks) &&
        !(this.v2 && this.comboStrike(player, ticks))
      ) {
        this.opportunistStrike(player, ticks);
      }
    }
    this.bunkerLine(player);
  }

  /** Медленный контур (4–6 с): волна атаки, стройка, флот, ракеты. */
  private macro(player: Player): void {
    const blinded = this.mg.satelliteBlackoutBlinds(player);
    this.emoji.maybeSendCasualEmoji();
    if (blinded) {
      this.attack.maybeRetaliate(TERRON_OURSKY_REACTION_BUFFER_TICKS);
    } else {
      this.attack.maybeAttack();
    }
    if (!this.savingForHq(player)) this.structures.handleStructures();
    if (player.unitsConstructed(UnitType.Port)) {
      this.warships.trackShipsAndRetaliate();
    }
    this.warships.maybeSpawnWarship();
    this.warships.counterWarshipInfestation();
    if (!blinded) {
      // МИРВ — только если это НАШ выбор ульты: иначе поведение наций само
      // построило бы Ядерный завод и зафиксировало ульту за нас.
      if (this.stats.ult === UnitType.NuclearFactory) this.mirv.considerMIRV();
      this.nukes.maybeSendNuke(this.v2 ? this.focusTarget(player) : null);
      this.air.maybeAirAssault();
      this.air.maybeSendDrone();
    }
  }

  // ---------- ульта ----------

  /** true — мысль потрачена на ульту (выбор или постройку штаба). */
  private ultStep(player: Player, ticks: number): boolean {
    if (this.stats.ultDecidedTick === null) {
      if (ticks - (this.spawnEndTick ?? ticks) < this.ultDecideAfter) {
        return false;
      }
      this.stats.ultDecidedTick = ticks;
      // Выбор уже зафиксирован (например, захватом чужого штаба не фиксируется,
      // а вот своим прошлым решением — да) — уважаем его.
      const fixed = player.ultimateChoice();
      if (fixed !== null) {
        this.stats.ult = fixed;
        return false;
      }
      this.stats.grid = drawUltGrid(
        fairBotUltPool(this.mg.config()),
        this.random,
      );
      const pick = pickUltimate(
        this.stats.grid,
        this.perception.signals(),
        this.random,
      );
      this.stats.ult = pick;
      if (pick === null) return false;
      // v2: выбор НЕ объявляем — он зафиксируется постройкой штаба
      // (PlayerImpl.buildUnit), когда хватит денег. Репорт KDaniilW: v1
      // объявлял ульту на 1–2-й минуте, а штаб ставил к 12-й — всё это время
      // ульта висела в панели «без эффекта».
      if (this.v2) return false;
      this.mg.addExecution(new ChooseUltimateExecution(player, pick));
      return true;
    }

    let ult = this.stats.ult;
    if (ult === null) return false;
    if (this.v2) {
      // Пока мы копили, выбор мог зафиксироваться иначе — уважаем его.
      const fixed = player.ultimateChoice();
      if (fixed !== null && fixed !== ult) {
        this.stats.ult = ult = fixed;
      }
    }
    const play = FAIR_BOT_PLAYBOOK[ult];
    if (play === undefined) return false;
    const own = player.units(ult);
    if (own.length >= play.copies) return false;
    if (own.some((u) => u.isUnderConstruction())) return false;
    const cost = this.readyCost(player, ult);
    if (player.gold() < cost) return false;
    const tile = this.deepTile(player, ult);
    if (tile === null) return false;
    this.mg.addExecution(new ConstructionExecution(player, ult, tile));
    this.stats.hqBuiltTicks.push(ticks);
    return true;
  }

  /** Копим на штаб: пока не хватает, обычную стройку не ведём. */
  private savingForHq(player: Player): boolean {
    const ult = this.stats.ult;
    if (ult === null) return false;
    const play = FAIR_BOT_PLAYBOOK[ult];
    if (play === undefined) return false;
    if (player.units(ult).length >= play.copies) return false;
    const cost = this.readyCost(player, ult);
    return (
      player.gold() >= (cost * BigInt(Math.round(HQ_SAVE_FROM * 100))) / 100n
    );
  }

  /**
   * terron 28.09: сколько золота нужно, чтобы поставить штаб И сразу пустить
   * ульту в дело (плейбук `readyWith`). Для МИРВ нужна шахта — нет своей,
   * докидываем и её цену.
   */
  private readyCost(player: Player, ult: UnitType): bigint {
    let cost = this.mg.unitInfo(ult).cost(this.mg, player);
    const extra = FAIR_BOT_PLAYBOOK[ult]?.readyWith ?? [];
    for (const t of extra) {
      cost += this.mg.unitInfo(t).cost(this.mg, player);
      if (
        (t === UnitType.MIRV || t === UnitType.AtomBomb) &&
        player.units(UnitType.MissileSilo).length === 0
      ) {
        cost += this.mg.unitInfo(UnitType.MissileSilo).cost(this.mg, player);
      }
    }
    return cost;
  }

  /** Штаб — в глубине страны: подальше от любой границы. */
  private deepTile(player: Player, type: UnitType): TileRef | null {
    const border = new TileDistanceIndex(this.mg.map(), player.borderTiles());
    let best: TileRef | null = null;
    let bestDist = -1;
    for (const t of randTerritoryTileArray(this.random, this.mg, player, 30)) {
      const d = border.size === 0 ? 0 : border.minDist(this.mg.map(), t);
      if (d <= bestDist) continue;
      if (player.canBuild(type, t) === false) continue;
      best = t;
      bestDist = d;
    }
    return best;
  }

  /** Укрепления: бункеры у самой границы с людьми и нациями — они «едят» землю. */
  private bunkerLine(player: Player): void {
    const ult = this.stats.ult;
    if (ult === null || FAIR_BOT_PLAYBOOK[ult]?.bunkerLine !== true) return;
    if (!player.hasUltimate(ult)) return;
    if (this.mg.config().isUnitDisabled(UnitType.DefensePost)) return;
    if (player.units(UnitType.DefensePost).length >= BUNKER_LINE_MAX) return;
    const cost = this.mg.unitInfo(UnitType.DefensePost).cost(this.mg, player);
    if (player.gold() < cost) return;
    const me = player.smallID();
    const front: TileRef[] = [];
    for (const t of player.borderTiles()) {
      for (const n of this.mg.neighbors(t)) {
        if (!this.mg.isLand(n)) continue;
        const oid = this.mg.ownerID(n);
        if (oid === me || oid === 0) continue;
        const o = this.mg.playerBySmallID(oid);
        if (
          o.isPlayer() &&
          o.type() !== PlayerType.Bot &&
          !player.isFriendly(o)
        ) {
          front.push(t);
          break;
        }
      }
    }
    for (let i = 0; i < 12 && front.length > 0; i++) {
      const t = front[this.random.nextInt(0, front.length)];
      if (player.canBuild(UnitType.DefensePost, t) === false) continue;
      this.mg.addExecution(
        new ConstructionExecution(player, UnitType.DefensePost, t),
      );
      this.stats.bunkers++;
      return;
    }
  }

  // ---------- реакции ----------

  /** Отказ в союзе владельцу Религии: его вера всё равно ест твою границу. */
  private refuseReligionAlliances(player: Player): void {
    for (const req of [...player.incomingAllianceRequests()]) {
      if (req.requestor().hasUltimate(UnitType.Religion)) {
        req.reject();
        this.stats.refusedReligion++;
      }
    }
  }

  /**
   * Ядерка по видимой чужой нефтевышке. Вышку не захватить и не расстрелять
   * кораблём — только ядеркой, поэтому живой игрок бьёт по ней именно так.
   * Не бьём туда, где стоит чужое ПВО: выстрел в купол — подарок врагу.
   */
  private rigStrike(player: Player, ticks: number): boolean {
    if (ticks - this.lastRigStrike < RIG_STRIKE_COOLDOWN_TICKS) return false;
    if (player.units(UnitType.MissileSilo).length === 0) return false;
    const bomb = UnitType.AtomBomb;
    if (this.mg.config().isUnitDisabled(bomb)) return false;
    const cost = this.mg.unitInfo(bomb).cost(this.mg, player);
    if (player.gold() < cost) return false;
    const sams = this.perception.visibleEnemyUnits(UnitType.SAMLauncher);
    for (const rig of this.perception.visibleEnemyUnits(UnitType.OilRig)) {
      if (rig.owner().type() === PlayerType.Bot) continue;
      const covered = sams.some(
        (s) =>
          this.mg.euclideanDistSquared(s.tile(), rig.tile()) <=
          this.mg.config().samRange(s.level()) ** 2,
      );
      if (covered) continue;
      if (player.canBuild(bomb, rig.tile()) === false) continue;
      this.mg.addExecution(new ConstructionExecution(player, bomb, rig.tile()));
      this.lastRigStrike = ticks;
      this.stats.rigStrikes++;
      return true;
    }
    return false;
  }

  /**
   * Сосед-ИГРОК слаб и занят другим фронтом — бить сейчас («нападать, когда у
   * тебя мало войск» — ТЗ владельца). Войска соседа — только видимые: у
   * «Закрытой страны» их нет, и бот на неё так не нападает.
   */
  private opportunistStrike(player: Player, ticks: number): boolean {
    if (ticks - (this.spawnEndTick ?? ticks) < OPPORTUNIST_AFTER_TICKS) {
      return false;
    }
    const max = this.mg.config().maxTroops(player);
    if (player.troops() < max * OPPORTUNIST_MIN_OWN_RATIO) return false;
    for (const n of this.perception.landNeighbors()) {
      // ТОЛЬКО ПО ИГРОКАМ-ЛЮДЯМ (и другим честным ботам). ⚠️ Замер арены
      // 22.09: удар по занятой НАЦИИ включает у неё ответку (retaliate — первый
      // приоритет ИИ) и втягивает бота в войну, которую он проигрывает: с этой
      // реакцией по нациям боты к 15-й минуте почти все погибали, без неё —
      // брали 1–2 место. Против наций хватает обычной логики атаки.
      if (n.type() !== PlayerType.Human) continue;
      if (player.isFriendly(n) || player.isOnSameTeam(n)) continue;
      const last = this.lastStrikeOn.get(n);
      if (last !== undefined && ticks - last < OPPORTUNIST_COOLDOWN_TICKS) {
        continue;
      }
      const their = this.perception.troopsOf(n);
      if (their === null) continue;
      if (their >= player.troops() * OPPORTUNIST_WEAK_RATIO) continue;
      const busy = n.incomingAttacks().some((a) => a.attacker() !== player);
      if (!busy) continue;
      if (!this.attack.sendAttack(n, true)) continue;
      this.lastStrikeOn.set(n, ticks);
      this.stats.opportunistStrikes++;
      return true;
    }
    return false;
  }

  // ---------- v2 ----------

  /**
   * v2: на кого нацелить ядерку — страна, на которую идёт самая большая НАША
   * атака по суше. Топы бьют ядерками именно так: чаще всего по нации, с
   * которой уже воюют. Племена и честные боты — нет (их берут войсками).
   */
  private focusTarget(player: Player): Player | null {
    if (
      this.spawnEndTick === null ||
      this.mg.ticks() - this.spawnEndTick < V2_OFFENSIVE_NUKE_AFTER_TICKS
    ) {
      return null;
    }
    let best: Player | null = null;
    let bestTroops = 0;
    for (const a of player.outgoingAttacks()) {
      const t = a.target();
      if (!t.isPlayer()) continue;
      if (t.type() === PlayerType.Bot) continue;
      if (t.type() === PlayerType.Human && t.clientID() === null) continue;
      if (a.troops() > bestTroops) {
        best = t;
        bestTroops = a.troops();
      }
    }
    if (best !== null) this.stats.focusNukes++;
    return best;
  }

  /**
   * v2: десант + суша. Наш десант подходит к стране, с которой у нас есть
   * сухопутная граница, — бьём её и по суше, чтобы защита делилась на два
   * фронта. Цель — по тем же правилам, что у наступления (fairV2Targetable).
   */
  private comboStrike(player: Player, ticks: number): boolean {
    const neighbors = this.perception.landNeighbors();
    if (neighbors.length === 0) return false;
    for (const boat of player.units(UnitType.TransportShip)) {
      const dst = boat.targetTile();
      if (dst === undefined) continue;
      const owner = this.mg.owner(dst);
      if (!owner.isPlayer() || owner === player) continue;
      if (!neighbors.includes(owner)) continue;
      if (player.isFriendly(owner) || player.isOnSameTeam(owner)) continue;
      const last = this.lastComboOn.get(owner);
      if (last !== undefined && ticks - last < V2_COMBO_COOLDOWN_TICKS) {
        continue;
      }
      if (
        this.mg.euclideanDistSquared(boat.tile(), dst) >
        V2_COMBO_DIST * V2_COMBO_DIST
      ) {
        continue;
      }
      if (
        !fairV2Targetable(
          { type: owner.type(), isFairBot: owner.clientID() === null },
          this.perception.troopsOf(owner),
          player.troops(),
        )
      ) {
        continue;
      }
      if (!this.attack.sendAttack(owner)) continue;
      this.lastComboOn.set(owner, ticks);
      this.stats.comboStrikes++;
      return true;
    }
    return false;
  }

  /**
   * v2: не вступать в союз с лидером матча и с тем, кто уже собрал союзы с
   * ИИ (нации и честные боты). Идея KDaniilW из беты: иначе лидер обкладывается
   * союзами и спокойно доедает остальных.
   */
  private refuseLeaderAlliances(player: Player): void {
    const reqs = player.incomingAllianceRequests();
    if (reqs.length === 0) return;
    let first: Player | null = null;
    let second = 0;
    for (const p of this.mg.players()) {
      const n = p.numTilesOwned();
      if (first === null || n > first.numTilesOwned()) {
        second = first === null ? 0 : first.numTilesOwned();
        first = p;
      } else if (n > second) {
        second = n;
      }
    }
    for (const req of [...reqs]) {
      const from = req.requestor();
      if (from.type() !== PlayerType.Human || from.clientID() === null) {
        continue;
      }
      const leader =
        from === first && from.numTilesOwned() >= second * V2_LEADER_LEAD;
      const aiAllies = from
        .allies()
        .filter(
          (a) => a.type() !== PlayerType.Human || a.clientID() === null,
        ).length;
      if (leader || aiAllies >= V2_AI_ALLIES_LIMIT) {
        req.reject();
        this.stats.refusedLeader++;
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}

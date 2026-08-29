import { placeName, placeSpawnName } from "../client/hud/NameBoxCalculator";
import { Config } from "./configuration/Config";
import { Executor } from "./execution/ExecutionManager";
import { NationCullExecution } from "./execution/NationCullExecution";
import { RecomputeRailClusterExecution } from "./execution/RecomputeRailClusterExecution";
import { SpawnTimerExecution } from "./execution/SpawnTimerExecution";
import { WinCheckExecution } from "./execution/WinCheckExecution";
import {
  AllPlayers,
  BuildableUnit,
  Game,
  GameType,
  GameUpdates,
  NameViewData,
  Player,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  UnitType,
} from "./game/Game";
import { createGame } from "./game/GameImpl";
import { TileRef } from "./game/GameMap";
import { GameMapLoader } from "./game/GameMapLoader";
import { ErrorUpdate, GameUpdateViewData } from "./game/GameUpdates";
import { createNationsForGame } from "./game/NationCreation";
import { loadTerrainMap as loadGameMap } from "./game/TerrainMapLoader";
import { PseudoRandom } from "./PseudoRandom";
import { ClientID, GameStartInfo, Turn } from "./Schemas";
import { simpleHash } from "./Util";

export async function createGameRunner(
  gameStart: GameStartInfo,
  clientID: ClientID | undefined,
  mapLoader: GameMapLoader,
  callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
  // terron 20.07: замер этапов инициализации (мс на этап). Нужен, чтобы знать,
  // что именно держит игрока на экране загрузки — скачивание/разбор карты,
  // раскладка наций или сборка мира. Необязателен: тесты и headless-прогоны
  // передают undefined и ничего не платят.
  onPhase?: (name: string, ms: number) => void,
): Promise<GameRunner> {
  const phaseStart = () => performance.now();
  let mark = phaseStart();
  const phase = (name: string) => {
    const now = phaseStart();
    onPhase?.(name, Math.round(now - mark));
    mark = now;
  };

  const config = new Config(gameStart.config, null, false);
  const gameMap = await loadGameMap(
    gameStart.config.gameMap,
    gameStart.config.gameMapSize,
    mapLoader,
  );
  phase("map"); // скачивание + разбор бинаря карты
  const random = new PseudoRandom(simpleHash(gameStart.gameID));

  const humans = gameStart.players.map((p) => {
    // terron (TZ-skin-capitals.md): имя столицы скина едет в косметике, но для
    // сима это обычный детерминированный вход из GameStartInfo (одинаков у всех
    // клиентов и в реплее, как username). Реле его валидирует; локальные старты
    // строят start info сами — поэтому здесь свой страховочный фильтр.
    const rawCap = (p.cosmetics?.customSkin?.capitalName ?? "").trim();
    const capitalName = /^(?=.*\S)[\p{L}\p{N}_ .\-']{3,27}$/u.test(rawCap)
      ? rawCap
      : null;
    return new PlayerInfo(
      p.username,
      PlayerType.Human,
      p.clientID,
      random.nextID(),
      p.isLobbyCreator ?? false,
      p.clanTag,
      p.friends ?? [],
      capitalName,
    );
  });

  const nations = createNationsForGame(
    gameStart,
    gameMap.nations,
    gameMap.additionalNations,
    humans.length,
    random,
  );
  phase("nations"); // раскладка наций по карте

  // terron ПЕРФ (память, 12.07): мини-карта теперь ленивая фабрика — парсится
  // только здесь, в воркере (пасфайндинг); главный поток её не строит вовсе.
  const game: Game = createGame(
    humans,
    nations,
    gameMap.gameMap,
    await gameMap.miniGameMap(),
    config,
    gameMap.teamGameSpawnAreas,
  );

  phase("world"); // сборка мира + мини-карта для пасфайндинга

  const gr = new GameRunner(
    game,
    new Executor(game, gameStart.gameID, clientID),
    callBack,
  );
  gr.init();
  phase("executions"); // регистрация исполнений (нации, боты, спавн-таймер…)
  return gr;
}

// Как часто класть снимок статистики в апдейт (10 тиков = 1 с → 300 = 30 с).
const STATS_SNAPSHOT_TICKS = 300;

export class GameRunner {
  private turns: Turn[] = [];
  private currTurn = 0;
  private isExecuting = false;

  private playerViewData: Record<PlayerID, NameViewData> = {};
  // terron ПЕРФ (12.07): тик последнего батч-пересчёта имён — игроки без
  // изменений территории с тех пор пропускаются (см. executeNextTick).
  private lastNamesTick = -1;
  // terron ПЕРФ ДОГОНА (26.07, возвращено 21.08): backlog ходов, выше которого
  // считаем, что «догоняем» и можем экономить на ВИДОВОЙ работе. 20 тиков = 2с
  // отставания: сетевые лаги под порог не попадают, режим включается только на
  // реальном догоне (реконнект/F5/поздний вход).
  private static readonly CATCHUP_TURNS = 20;
  private wasCatchingUp = false;

  constructor(
    public game: Game,
    private execManager: Executor,
    private callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
  ) {}

  init() {
    if (this.game.config().gameConfig().gameType !== GameType.Singleplayer) {
      this.game.addExecution(new SpawnTimerExecution());
      // terron: авто-спавн рандомом для тех, кто не выбрал место за грейс.
      this.game.addExecution(this.execManager.spawnGraceAuto());
    }
    if (this.game.config().spawnNations()) {
      this.game.addExecution(...this.execManager.nationExecutions());
    }
    if (this.game.config().isRandomSpawn()) {
      this.game.addExecution(...this.execManager.spawnPlayers());
    }
    if (this.game.config().bots() > 0) {
      this.game.addExecution(
        ...this.execManager.spawnTribes(this.game.config().bots()),
      );
    }
    this.game.addExecution(new WinCheckExecution());
    // terron: добивание наций-огрызков (≤ TERRON_NATION_MIN_TILES тайлов).
    if (this.game.config().spawnNations()) {
      this.game.addExecution(new NationCullExecution());
    }
    if (!this.game.config().isUnitDisabled(UnitType.Factory)) {
      this.game.addExecution(
        new RecomputeRailClusterExecution(this.game.railNetwork()),
      );
    }
  }

  public addTurn(turn: Turn): void {
    this.turns.push(turn);
  }

  public executeNextTick(pendingTurns?: number): boolean {
    if (this.isExecuting) {
      return false;
    }
    if (this.currTurn >= this.turns.length) {
      return false;
    }
    this.isExecuting = true;

    this.game.addExecution(
      ...this.execManager.createExecs(this.turns[this.currTurn]),
    );
    this.currTurn++;

    const wasInSpawnPhase = this.game.inSpawnPhase();
    let updates: GameUpdates;
    let tickExecutionDuration: number;

    try {
      const startTime = performance.now();
      updates = this.game.executeNextTick();
      const endTime = performance.now();
      tickExecutionDuration = endTime - startTime;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Game tick error:", error.message);
        this.callBack({
          errMsg: error.message,
          stack: error.stack,
        } as ErrorUpdate);
      } else {
        console.error("Game tick error:", error);
      }
      this.isExecuting = false;
      return false;
    }

    // terron ПЕРФ (15.08): флаг «карта имён менялась в ЭТОМ тике» — только
    // тогда её и шлём в главный поток (см. payload ниже). Раньше ПОЛНАЯ карта
    // всех игроков клонировалась structured clone КАЖДЫЙ тик, хотя пересчёт
    // идёт раз в 10 тиков: 9 из 10 клонов возили байты без единого изменения.
    let namesChanged = false;
    if (this.game.inSpawnPhase()) {
      namesChanged = true; // спавн-имена обновляются каждый тик
      for (const p of this.game.players()) {
        if (p.type() !== PlayerType.Human && p.type() !== PlayerType.Nation) {
          continue;
        }
        if (p.spawnTile() === undefined) continue;
        this.playerViewData[p.id()] = placeSpawnName(this.game, p);
      }
    }

    const spawnJustEnded = wasInSpawnPhase && !this.game.inSpawnPhase();
    // terron ПЕРФ ДОГОНА: пока разгребаем backlog, позиции ников НЕ считаем —
    // это чисто видовая работа (grid + поиск максимального прямоугольника на
    // игрока; замер 26.07: −9-11% времени тика), на СОСТОЯНИЕ игры она не
    // влияет (placeName только читает мир). Новым игрокам без записи позицию
    // считаем всегда (иначе PlayerView родится без nameData), а на выходе из
    // догона — один форс-пересчёт всех, ники встают на места сразу.
    const catchingUp = (pendingTurns ?? 0) > GameRunner.CATCHUP_TURNS;
    const catchupJustEnded = this.wasCatchingUp && !catchingUp;
    this.wasCatchingUp = catchingUp;
    if (
      spawnJustEnded ||
      catchupJustEnded ||
      this.game.ticks() < 3 ||
      this.game.ticks() % 10 === 0
    ) {
      // terron ПЕРФ (12.07): раньше место ника пересчитывалось для ВСЕХ
      // игроков каждые 30 тиков — сотни ботов × (грид + поиск максимального
      // прямоугольника) = периодический спайк воркера каждые 3с весь матч.
      // Ник двигается только когда меняется территория → гейт по
      // lastTileChange. Форс — старт/конец спавна и первый пересчёт игрока.
      // (NameViewData = только x/y/size; текст ника клиент берёт из
      // PlayerView, так что смена имени/предателя тут не при чём.)
      const force = spawnJustEnded || catchupJustEnded || this.game.ticks() < 3;
      // terron: playerViewData — накопительная мапа позиций имён. game.players()
      // возвращает только ЖИВЫХ, поэтому мёртвые в ней ЗАВИСАЛИ навсегда и
      // слались клиенту каждый тик (в матче на 400 наций — сотни мёртвых
      // записей до конца игры; name-pass их прячет по isAlive, но это лишний
      // payload+память). Чистим: перед пересчётом выкидываем мёртвых.
      const alive = new Set<PlayerID>();
      for (const p of this.game.players()) {
        alive.add(p.id());
        if (
          force ||
          this.playerViewData[p.id()] === undefined ||
          // В догоне периодический пересчёт пропускаем — только тем, у кого
          // записи ещё нет вообще.
          (!catchingUp && p.lastTileChange() >= this.lastNamesTick)
        ) {
          this.playerViewData[p.id()] = placeName(this.game, p);
        }
      }
      for (const id of Object.keys(this.playerViewData)) {
        if (!alive.has(id)) delete this.playerViewData[id];
      }
      this.lastNamesTick = this.game.ticks();
      namesChanged = true;
    }

    const packedTileUpdates = this.game.drainPackedTileUpdates();
    const packedMotionPlans = this.game.drainPackedMotionPlans();
    // terron: скины пепла — пары [tile, smallID бомбившего] (null = не было).
    const packedFalloutOwners = this.game.drainPackedFalloutOwners();

    // terron: снимок статистики раз в ~30 с (300 тиков) — страховка архива
    // для матчей, которые кончаются БЕЗ победителя (см. GameUpdateViewData).
    const tick = this.game.ticks();
    const statsSnapshot =
      tick > 0 && tick % STATS_SNAPSHOT_TICKS === 0
        ? this.game.stats().stats()
        : undefined;

    this.callBack({
      tick,
      packedTileUpdates,
      ...(packedMotionPlans ? { packedMotionPlans } : {}),
      ...(packedFalloutOwners ? { packedFalloutOwners } : {}),
      updates: updates,
      // Приёмник (view/GameView) держит последнюю позицию имени сам:
      // отсутствие поля = «без изменений», см. гейт nextNameData !== undefined.
      ...(namesChanged ? { playerNameViewData: this.playerViewData } : {}),
      tickExecutionDuration: tickExecutionDuration,
      pendingTurns: pendingTurns ?? 0,
      ...(statsSnapshot ? { allPlayersStats: statsSnapshot } : {}),
    });
    this.isExecuting = false;
    return true;
  }

  public pendingTurns(): number {
    return Math.max(0, this.turns.length - this.currTurn);
  }

  public playerBuildables(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[],
  ): BuildableUnit[] {
    const player = this.game.player(playerID);
    const tile =
      x !== undefined && y !== undefined ? this.game.ref(x, y) : null;
    return player.buildableUnits(tile, units);
  }

  public playerActions(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[] | null,
  ): PlayerActions {
    const player = this.game.player(playerID);
    const tile =
      x !== undefined && y !== undefined ? this.game.ref(x, y) : null;
    const actions = {
      canAttack: tile !== null && player.canAttack(tile),
      buildableUnits: units === null ? [] : player.buildableUnits(tile, units),
      canSendEmojiAllPlayers: player.canSendEmoji(AllPlayers),
      canEmbargoAll: player.canEmbargoAll(),
    } as PlayerActions;

    if (tile !== null && this.game.hasOwner(tile)) {
      const other = this.game.owner(tile) as Player;
      actions.interaction = {
        sharedBorder: player.sharesBorderWith(other),
        canSendEmoji: player.canSendEmoji(other),
        canTarget: player.canTarget(other),
        canSendAllianceRequest: player.canSendAllianceRequest(other),
        canBreakAlliance: player.isAlliedWith(other),
        canDonateGold: player.canDonateGold(other),
        canDonateTroops: player.canDonateTroops(other),
        canEmbargo: !player.hasEmbargoAgainst(other),
        allianceInfo: player.allianceInfo(other) ?? undefined,
      };
    }

    return actions;
  }

  public playerProfile(playerID: number): PlayerProfile {
    const player = this.game.playerBySmallID(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return player.playerProfile();
  }
  public playerBorderTiles(playerID: PlayerID): PlayerBorderTiles {
    const player = this.game.player(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return {
      borderTiles: player.borderTiles(),
    } as PlayerBorderTiles;
  }

  public attackClusteredPositions(
    playerID: number,
    attackID?: string,
  ): { id: string; positions: { x: number; y: number }[] }[] {
    const player = this.game.playerBySmallID(playerID);
    if (!player.isPlayer())
      throw new Error(`player with id ${playerID} not found`);
    const all = [...player.outgoingAttacks(), ...player.incomingAttacks()];
    const attacks = attackID ? all.filter((a) => a.id() === attackID) : all;

    return attacks.map((a) => ({
      id: a.id(),
      positions: a.clusteredPositions().map((tile) => ({
        x: this.game.map().x(tile),
        y: this.game.map().y(tile),
      })),
    }));
  }

  public bestTransportShipSpawn(
    playerID: PlayerID,
    targetTile: TileRef,
  ): TileRef | false {
    const player = this.game.player(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return player.bestTransportShipSpawn(targetTile);
  }
}

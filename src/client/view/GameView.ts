import { Config } from "../../core/configuration/Config";
import {
  TERRON_FOG_REVEAL_COLLAPSE_TICKS,
  TERRON_FOG_REVEAL_HOLD_TICKS,
  TERRON_FOG_REVEAL_MARGIN,
  TERRON_FOG_VISION_RADIUS,
} from "../../core/configuration/TerronTuning";
import {
  Cell,
  GameUpdates,
  PlayerID,
  TerrainType,
  TerraNullius,
  Tick,
  Unit,
  UnitInfo,
  UnitType,
} from "../../core/game/Game";
import { GameMap, TileRef } from "../../core/game/GameMap";
import {
  BlockadeUpdate,
  FortShotUpdate,
  GameUpdateType,
  GameUpdateViewData,
  SatBlackoutUpdate,
  SpawnPhaseEndUpdate,
} from "../../core/game/GameUpdates";
import {
  MotionPlanRecord,
  unpackMotionPlans,
} from "../../core/game/MotionPlans";
import { TerrainMapData } from "../../core/game/TerrainMapLoader";
import { TerraNulliusImpl } from "../../core/game/TerraNulliusImpl";
import { UnitGrid, UnitPredicate } from "../../core/game/UnitGrid";
import { ClientID, GameID, Player, PlayerCosmetics } from "../../core/Schemas";
import { formatPlayerDisplayName } from "../../core/Util";
import { WorkerClient } from "../../core/worker/WorkerClient";
import { collectBalance } from "../BalanceCollector";
import { localizeSeparatistName } from "../LocalizeNames";
import { computeAllianceClusters } from "../render/frame/derive/AllianceClusters";
import { extractAttackRings } from "../render/frame/derive/AttackRings";
import { extractNukeTelegraphs } from "../render/frame/derive/NukeTelegraphs";
import { computePlayerStatus } from "../render/frame/derive/PlayerStatus";
import { buildRelationMatrix } from "../render/frame/derive/RelationMatrix";
import { RailroadCache } from "../render/frame/RailroadCache";
import { TrailManager } from "../render/frame/TrailManager";
import type { FrameData, NameEntry, TilePair } from "../render/types";
import { STRUCTURE_TYPES } from "../render/types";
import { PlayerView } from "./PlayerView";
import { UnitView } from "./UnitView";

const TRAIL_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.TransportShip,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.MIRVWarhead,
  UnitType.AirborneAssault, // terron: авиация — след десантного борта
  UnitType.SuicideDrone, // terron: авиация — след дрона-камикадзе
]);

type TrainPlanState = {
  planId: number;
  startTick: number;
  speed: number;
  spacing: number;
  carUnitIds: Uint32Array;
  path: Uint32Array;
  cursor: number;
  usedTilesBuf: Uint32Array;
  usedHead: number;
  usedLen: number;
  lastAdvancedTick: Tick;
};

export class GameView implements GameMap {
  private lastUpdate: GameUpdateViewData | null;
  private startTick: Tick | null = null;
  // terron: ульта «Небо наше» — последний запуск антиспутниковой ракеты
  // (окно слепоты). НЕ чистим по концу окна: эпицентр нужен волне возврата.
  private _satBlackout: SatBlackoutUpdate | null = null;
  private _blockades: BlockadeUpdate[] = [];

  // terron: ПИРАТСТВО — активные зоны блокады (для рендера кругов).
  blockades(): readonly BlockadeUpdate[] {
    return this._blockades;
  }

  // terron: свой/союзный/командный игрок относительно меня (для видовых скрытий).
  isFriendlyToMe(p: PlayerView): boolean {
    const me = this._myPlayer;
    if (me === null) return false;
    return me === p || me.isFriendly(p);
  }
  // terron: Укрепления — снаряды-«выстрелы» бункеров текущего тика (from→to).
  // Транзиентно: перезаписывается каждый update(), WebGLFrameBuilder читает раз/тик.
  private _fortShots: FortShotUpdate[] = [];
  // terron ПЕРФ (Р10.1): союзы/эмбарго менялись → пересобрать матрицу отношений.
  // Стартуем true: первый кадр обязан загрузить матрицу.
  private _relationsDirty = true;
  private smallIDToID = new Map<number, PlayerID>();
  private _players = new Map<PlayerID, PlayerView>();
  private _units = new Map<number, UnitView>();
  /**
   * Long-lived state maps (renderer's plain-object shape). Each entry shares
   * its identity with the corresponding PlayerView.state / UnitView.state, so
   * mutations through either path are visible everywhere.
   */
  private _playerStates = new Map<
    number,
    import("../render/types").PlayerState
  >();
  private _unitStates = new Map<number, import("../render/types").UnitState>();
  private updatedTiles: TileRef[] = [];
  private updatedTerrainTiles: TileRef[] = [];

  // ── FrameData accumulators (renderer-bound state) ─────────────────────
  private trailManager!: TrailManager;
  private railroadCache!: RailroadCache;
  /** Long-lived NameEntry map for the renderer's NamePass. */
  private _names = new Map<string, NameEntry>();
  /** Reusable scratch buffers for per-tick deltas. */
  private readonly _changedTilesScratch: TilePair[] = [];
  private readonly _trailIdsScratch: number[] = [];
  /** terron: чьи хвосты рисуем коротко (пиратские десанты владельца). */
  private readonly _shortTrailScratch = new Set<number>();

  // terron: скины пепла — «чей пепел» per tile: биты 0-11 smallID бомбившего,
  // биты 12-15 индекс скина (1..10, 0 = без узора). Ленивая аллокация при
  // первой ядерке (карта 4.19М тайлов = 8МБ — не платим в мирных матчах).
  // Индекс скина считается детерминированно от smallID → одинаков у всех
  // клиентов без протокола; при магазине скинов заменить на выбор игрока.
  private _falloutOwners: Uint16Array | null = null;
  // smallID → индекс узора пепла (косметика скина либо хэш). Косметика за матч
  // не меняется, а ингест зовёт это на каждый тайл воронки.
  private _falloutSkinCache = new Map<number, number>();
  private _foDirtyRowMin = Infinity;
  private _foDirtyRowMax = -1;
  /**
   * The single long-lived FrameData object. Fields are mutated in place each
   * tick by update(). Renderer reads this each frame via frameData().
   */
  private _frame: FrameData;
  private _structuresDirty = false;
  /** True until first populateFrame() — controls full-vs-delta tile upload. */
  private _firstPopulate = true;

  private _myPlayer: PlayerView | null = null;

  private unitGrid: UnitGrid;
  private unitMotionPlans = new Map<
    number,
    {
      planId: number;
      startTick: number;
      ticksPerStep: number;
      path: Uint32Array;
    }
  >();
  private trainMotionPlans = new Map<number, TrainPlanState>();
  private trainUnitToEngine = new Map<number, number>();

  private toDelete = new Set<number>();

  private _cosmetics: Map<string, PlayerCosmetics> = new Map();

  private _map: GameMap;

  constructor(
    public worker: WorkerClient,
    private _config: Config,
    private _mapData: TerrainMapData,
    private _myClientID: ClientID | undefined,
    private _myUsername: string,
    private _myClanTag: string | null,
    private _gameID: GameID,
    humans: Player[],
  ) {
    this._map = this._mapData.gameMap;
    this.lastUpdate = null;
    this.unitGrid = new UnitGrid(this._map);
    this._cosmetics = new Map(
      humans.map((h) => [h.clientID, h.cosmetics ?? {}]),
    );
    for (const nation of this._mapData.nations) {
      // Nations don't have client ids, so we use their name as the key instead.
      this._cosmetics.set(nation.name, {
        flag: nation.flag ? `/flags/${nation.flag}.svg` : undefined,
      } satisfies PlayerCosmetics);
    }
    for (const extra of this._mapData.additionalNations) {
      // Only set if not already provided by a manifest nation with the same name.
      if (this._cosmetics.has(extra.name)) continue;
      this._cosmetics.set(extra.name, {
        flag: extra.flag ? `/flags/${extra.flag}.svg` : undefined,
      } satisfies PlayerCosmetics);
    }

    const mapW = this._map.width();
    const mapH = this._map.height();
    this.trailManager = new TrailManager(mapW, mapH);
    this.railroadCache = new RailroadCache(mapW, mapH);

    // Long-lived FrameData. Most fields are mutable references to long-lived
    // buffers (tileState, trailState, etc.); some (_changedTilesScratch,
    // derived arrays) are reused each tick. Properties marked `readonly` on
    // FrameData only prevent reassignment, not mutation through the reference.
    // events: fresh arrays we own; cleared and repopulated each tick. (Don't
    // spread EMPTY_FRAME_EVENTS — that would share the module-level arrays.)
    this._frame = {
      tick: 0,
      inSpawnPhase: true,
      tileState: this._map.tileStateBuffer(),
      trailState: this.trailManager.getTrailState(),
      railroadState: this.railroadCache.railroadState,
      units: this._unitStates,
      players: this._playerStates,
      names: this._names,
      events: {
        deadUnits: [],
        conquestEvents: [],
        unitUpdates: [],
        playerUpdates: [],
        allianceFormed: [],
        allianceBroken: [],
        allianceExpired: [],
        embargoEvents: [],
        targetEvents: [],
        bonusEvents: [],
        nukeIncoming: [],
        emojis: [],
        displayMessages: [],
        wins: [],
        gamePaused: null,
      },
      changedTiles: this._changedTilesScratch,
      railroadDirty: false,
      revealedRailTiles: this.railroadCache.revealedRailTiles,
      trailDirtyRowMin: 0,
      trailDirtyRowMax: -1,
      falloutOwnerState: null,
      falloutOwnerDirtyRowMin: 0,
      falloutOwnerDirtyRowMax: -1,
      // Derived data — populated each tick by populateFrame(). Empty defaults
      // here so the type is satisfied before the first update().
      playerStatus: new Map(),
      relationMatrix: new Uint8Array(0),
      relationSize: 0,
      relationsDirty: false,
      allianceClusters: new Map(),
      nukeTelegraphs: [],
      attackRings: [],
      structuresDirty: false,
      tileMode: "live",
    };
  }

  isOnEdgeOfMap(ref: TileRef): boolean {
    return this._map.isOnEdgeOfMap(ref);
  }

  public updatesSinceLastTick(): GameUpdates | null {
    return this.lastUpdate?.updates ?? null;
  }

  /**
   * terron ПЕРФ (Р10.1): форс пересборки матрицы отношений на следующем тике.
   * Нужен при context-restore — GPU-текстура отношений создаётся заново пустой,
   * без форса границы остались бы «нейтральными» до первой смены союзов.
   */
  public markRelationsDirty(): void {
    this._relationsDirty = true;
  }

  public motionPlans(): ReadonlyMap<
    number,
    {
      planId: number;
      startTick: number;
      ticksPerStep: number;
      path: Uint32Array;
    }
  > {
    return this.unitMotionPlans;
  }

  private motionPlannedUnitIdsCache: number[] = [];
  private motionPlannedUnitIdsDirty = true;

  private markMotionPlannedUnitIdsDirty(): void {
    this.motionPlannedUnitIdsDirty = true;
  }

  private rebuildMotionPlannedUnitIdsCacheIfDirty(): void {
    if (!this.motionPlannedUnitIdsDirty) {
      return;
    }
    this.motionPlannedUnitIdsDirty = false;

    const out = this.motionPlannedUnitIdsCache;
    out.length = 0;

    for (const unitId of this.unitMotionPlans.keys()) {
      out.push(unitId);
    }
    for (const [engineId, plan] of this.trainMotionPlans) {
      out.push(engineId);
      for (let i = 0; i < plan.carUnitIds.length; i++) {
        const id = plan.carUnitIds[i] >>> 0;
        if (id !== 0) out.push(id);
      }
    }
  }

  public motionPlannedUnitIds(): number[] {
    this.rebuildMotionPlannedUnitIdsCacheIfDirty();
    return this.motionPlannedUnitIdsCache;
  }

  public isCatchingUp(): boolean {
    return (this.lastUpdate?.pendingTurns ?? 0) > 1;
  }

  public update(gu: GameUpdateViewData) {
    this.toDelete.forEach((id) => {
      this._units.delete(id);
      this._unitStates.delete(id);
    });
    this.toDelete.clear();

    this.lastUpdate = gu;

    this.updatedTiles = [];
    this.updatedTerrainTiles = [];
    const packed = this.lastUpdate.packedTileUpdates;
    for (let i = 0; i + 1 < packed.length; i += 2) {
      const tile = packed[i];
      const state = packed[i + 1];
      const terrainChanged = this.updateTile(tile, state);
      this.updatedTiles.push(tile);
      if (terrainChanged) {
        this.updatedTerrainTiles.push(tile);
      }
    }

    if (gu.packedMotionPlans) {
      const records = unpackMotionPlans(gu.packedMotionPlans);
      this.applyMotionPlanRecords(records);
    }

    if (gu.packedFalloutOwners) {
      this.applyFalloutOwners(gu.packedFalloutOwners);
    }

    if (gu.updates === null) {
      throw new Error("lastUpdate.updates not initialized");
    }

    const spawnPhaseEndUpdate = gu.updates[GameUpdateType.SpawnPhaseEnd][0] as
      | SpawnPhaseEndUpdate
      | undefined;
    if (spawnPhaseEndUpdate) {
      this.startTick = spawnPhaseEndUpdate.startTick;
    }

    // terron: ульта «Небо наше» — запуск антиспутниковой ракеты. Запоминаем
    // окно слепоты; сам туман включает клиент (fogOfWarActive/WebGLFrameBuilder).
    const satBlackout = gu.updates[GameUpdateType.SatBlackout]?.[0] as
      | SatBlackoutUpdate
      | undefined;
    if (satBlackout) {
      this._satBlackout = satBlackout;
    }

    // terron: ПИРАТСТВО — зоны блокады торговли (каст «Блокада»): копим,
    // протухшие выкидываем по тику. Клиент рисует красные круги.
    const blockades = gu.updates[GameUpdateType.Blockade] as
      | BlockadeUpdate[]
      | undefined;
    if (blockades && blockades.length > 0) {
      for (const b of blockades) {
        this._blockades = this._blockades.filter((x) => x.id !== b.id);
        if (b.ships > 0) this._blockades.push(b);
      }
    }

    // terron: Укрепления — снаряды-«выстрелы» бункеров этого тика (from→to).
    // Собираем в буфер, WebGLFrameBuilder заберёт и запушит в FX (анимирует
    // летящую точку по кадрам). Буфер живёт до следующего update().
    const fortShots = gu.updates[GameUpdateType.FortShot] as
      | FortShotUpdate[]
      | undefined;
    this._fortShots = fortShots ?? [];

    const myDisplayName = formatPlayerDisplayName(
      this._myUsername,
      this._myClanTag,
    );

    // Pass 1: ensure every player exists with up-to-date PlayerState. We need
    // all smallIDs registered before pass 2 can translate embargo PlayerIDs.
    // PlayerUpdate is now partial: only `id` is guaranteed; everything else
    // is present only when its value changed since the last emission.
    gu.updates[GameUpdateType.Player].forEach((pu) => {
      // First-emission (new player) — must have all static fields populated.
      // Subsequent emissions for an existing player carry only changed fields.
      const existing = this._players.get(pu.id);

      // terron: имя нации-сепаратиста (Раскол) приходит с АНГЛ. префиксом (канон
      // из воркера) — на ru-локали подменяем на русский тут, в единой точке входа
      // апдейтов игроков → локализация доходит до карты/лидерборда/ленты разом.
      // Поля name/displayName статичны (только на первом апдейте) → почти всегда
      // undefined, накладных нет. См. localizeSeparatistName.
      if (pu.name !== undefined) pu.name = localizeSeparatistName(pu.name);
      if (pu.displayName !== undefined) {
        pu.displayName = localizeSeparatistName(pu.displayName);
      }

      // Replace the local player's name/displayName with their own stored values.
      // This way the user does not know they are being censored. clientID is
      // static — present only on first emission — so this branch only runs once.
      if (pu.clientID !== undefined && pu.clientID === this._myClientID) {
        pu.name = this._myUsername;
        pu.displayName = myDisplayName;
      }

      if (pu.smallID !== undefined) {
        this.smallIDToID.set(pu.smallID, pu.id);
      }

      // terron ПЕРФ (Р10.1): матрицу отношений пересобираем ТОЛЬКО когда в
      // тике реально менялись союзы/эмбарго/команда или появился игрок —
      // diff-апдейты несут эти поля только при изменении (сигнал готов).
      if (
        existing === undefined ||
        pu.allies !== undefined ||
        pu.embargoes !== undefined ||
        pu.team !== undefined
      ) {
        this._relationsDirty = true;
      }

      if (existing !== undefined) {
        existing.applyUpdate(pu);
        const nextNameData = gu.playerNameViewData?.[pu.id];
        if (nextNameData !== undefined) {
          existing.nameData = nextNameData;
        }
      } else {
        const player = new PlayerView(
          this,
          pu,
          gu.playerNameViewData?.[pu.id],
          // First check human by clientID, then check nation by name.
          this._cosmetics.get(pu.clientID ?? "") ??
            this._cosmetics.get(pu.name!) ??
            {},
        );
        this._players.set(pu.id, player);
        this._playerStates.set(pu.smallID!, player.state);
      }
    });

    // Pass 2: translate engine embargoes (Set<PlayerID>) → renderer-format
    // smallIDs. Only re-translate when embargoes changed (field present);
    // unchanged sets stay at the previously-computed renderer-format list.
    gu.updates[GameUpdateType.Player].forEach((pu) => {
      if (pu.embargoes === undefined) return;
      const player = this._players.get(pu.id);
      if (player === undefined) return;
      const smallIDs: number[] = [];
      for (const otherPlayerID of pu.embargoes) {
        const otherPV = this._players.get(otherPlayerID);
        if (otherPV !== undefined) {
          smallIDs.push(otherPV.smallID());
        }
      }
      player.setEmbargoSmallIDs(smallIDs);
    });

    if (this._myClientID) {
      this._myPlayer ??= this.playerByClientID(this._myClientID);
    }

    for (const unit of this._units.values()) {
      unit._wasUpdated = false;
      // terron ПЕРФ (15.08): slice(-1) на массиве длины ≤1 — аллокация копии
      // ради ничего, а цикл идёт по ВСЕМ юнитам каждый тик. Гейт по длине даёт
      // тот же результат (потребители массив не мутируют, только читают).
      if (unit.lastPos.length > 1) unit.lastPos = unit.lastPos.slice(-1);
    }
    gu.updates[GameUpdateType.Unit].forEach((update) => {
      let unit = this._units.get(update.id);
      const isStructure = STRUCTURE_TYPES.has(update.unitType);
      if (unit !== undefined) {
        // Structure changes that affect rendering: owner changed (captured),
        // level changed, became inactive, or construction state flipped
        // (проверяем в ОБЕ стороны — односторонний чек терял снятие стройки).
        // ⚠️ terron 23.08: сюда добавлена ПОЗИЦИЯ. Раньше строения считались
        // неподвижными, и сместившееся здание НЕ помечалось грязным — сетка
        // инстансов не переливалась. С появлением ДОРЫ (едущее здание) это
        // вылезло как «дёргает по рельсам»: орудие прыгало на новое место
        // только тогда, когда какое-нибудь ДРУГОЕ строение меняло владельца
        // или уровень. new-units/DORA.md
        if (
          isStructure &&
          (unit.state.ownerID !== update.ownerID ||
            unit.state.pos !== update.pos ||
            unit.state.level !== update.level ||
            unit.state.isActive !== update.isActive ||
            unit.state.underConstruction !==
              (update.underConstruction ?? false))
        ) {
          this._structuresDirty = true;
        }
        // terron: туман — окно видимости после СВОЕГО удара/высадки: мой снаряд
        // долетел (reachedTarget) и погас → ревил-круг на 5с + схлоп. Флаг
        // «долетел» приходит ТЕМ ЖЕ апдейтом, что и деактивация — проверяем
        // состояние ПОСЛЕ update().
        const wasActive = unit.state.isActive;
        unit.update(update);
        if (wasActive && !unit.state.isActive) this.maybeAddFogReveal(unit);
      } else {
        unit = new UnitView(this, update);
        this._units.set(update.id, unit);
        this._unitStates.set(update.id, unit.state);
        this.unitGrid.addUnit(unit);
        if (isStructure) this._structuresDirty = true;
      }
      if (!update.isActive) {
        this.unitGrid.removeUnit(unit);
      } else if (unit.tile() !== unit.lastTile()) {
        this.unitGrid.updateUnitCell(unit);
      }
      if (!unit.isActive()) {
        // Wait until next tick to delete the unit.
        this.toDelete.add(unit.id());
        if (this.unitMotionPlans.delete(unit.id())) {
          this.markMotionPlannedUnitIdsDirty();
        }
        this.clearTrainPlanForUnit(unit.id());
      }
    });

    this.advanceMotionPlannedUnits(gu.tick);
    this.rebuildMotionPlannedUnitIdsCacheIfDirty();

    // terron: DEV — сбор ROI-данных для страницы /balance (троттлинг внутри). Спека: airport.md
    collectBalance(this, gu);

    this.populateFrame(gu);
  }

  // ── FrameData population ────────────────────────────────────────────────

  /**
   * Populate the long-lived FrameData from this tick's updates and current
   * state. Runs at the end of update() once all engine-driven mutations are
   * complete. Mutates _frame fields in place; never reassigns them.
   */
  private populateFrame(gu: GameUpdateViewData): void {
    // Reset trail dirty markers for this tick. The trailManager.update() pass
    // below repaints rows and re-sets these as it goes.
    this.trailManager.clearDirtyRows();

    // Railroad events accumulate into the cache; revealedRailTiles is cleared
    // at the start of apply().
    // terron 25.08: ШАГАЮЩИЙ ГОРОД — под этой ультой рельсы кладутся МГНОВЕННО
    // (просьба владельца). Здание перецепляет станцию на каждом шаге, а
    // анимация прокладки (~3 тайла/тик с двух концов) не успевала добежать —
    // ветка вечно оставалась недорисованной. Отрисовка, сим не трогаем.
    const me = this.myPlayer();
    this.railroadCache.setInstant(
      me !== null && me.hasUltimate(UnitType.WalkingCity),
    );
    this.railroadCache.apply(gu);

    // Trail update: walk active trail-type units and stamp/decay.
    this._trailIdsScratch.length = 0;
    this._shortTrailScratch.clear();
    for (const u of this._units.values()) {
      // terron: ПИРАТСТВО — тихий десант (subState 4) следа чужим не оставляет.
      if (
        u.isActive() &&
        TRAIL_TYPES.has(u.type()) &&
        !(u.subState() === 4 && !this.isFriendlyToMe(u.owner()))
      ) {
        this._trailIdsScratch.push(u.id());
        // terron 23.08: ПИРАТСКИЙ ДЕСАНТ — свой короткий хвост (15 тайлов),
        // чтобы владелец видел, где идут его невидимки, но карта не была
        // расчерчена трассами от самого порта. Считаем по УЛЬТЕ владельца, а
        // не по subState: у засветившейся лодки subState слетает, и хвост
        // снова становился бесконечным.
        const owner = u.owner();
        if (
          u.type() === UnitType.TransportShip &&
          owner.isPlayer() &&
          (owner as PlayerView).hasUltimate(UnitType.Piracy)
        ) {
          this._shortTrailScratch.add(u.id());
        }
      }
    }
    this.trailManager.update(
      this._unitStates as Map<number, import("../render/types").UnitState>,
      this._trailIdsScratch,
      this._shortTrailScratch,
    );

    // Changed-tile delta refs (zero-copy: state field unused in live mode).
    this._changedTilesScratch.length = 0;
    for (let i = 0; i < this.updatedTiles.length; i++) {
      this._changedTilesScratch.push({ ref: this.updatedTiles[i], state: 0 });
    }

    // Names map — rebuilt every tick. Cheap (one entry per player, no big
    // arrays). Entry order is irrelevant for the renderer.
    this._names.clear();
    for (const p of this._players.values()) {
      this._names.set(p.id(), {
        playerID: p.id(),
        x: p.nameData?.x ?? 0,
        y: p.nameData?.y ?? 0,
        size: p.nameData?.size ?? 0,
      });
    }

    // FrameEvents — clear arrays, then re-populate from this tick's updates.
    this.buildFrameEvents(gu);

    // Update FrameData fields. Derived data is computed once per tick and
    // stored directly on _frame (no intermediate copy). The renderer's
    // `readonly` modifier on FrameData is just an external API hint —
    // not enforced at runtime; we cast off to assign here.
    const f = this._frame as {
      -readonly [K in keyof FrameData]: FrameData[K];
    };
    f.tick = gu.tick;
    f.inSpawnPhase = this.startTick === null;
    f.railroadDirty = this.railroadCache.railroadDirty;
    f.trailDirtyRowMin = this.trailManager.dirtyRowMin;
    f.trailDirtyRowMax = this.trailManager.dirtyRowMax;

    // terron: скины пепла — грязные строки буфера «чей пепел» за тик(и).
    // Сброс после копирования в кадр (симметрично trail): ингест GL идёт
    // каждый тик (троттлинг догона откачен 29.07), потери дельты нет.
    f.falloutOwnerState = this._falloutOwners;
    f.falloutOwnerDirtyRowMin =
      this._foDirtyRowMin === Infinity ? 0 : this._foDirtyRowMin;
    f.falloutOwnerDirtyRowMax = this._foDirtyRowMax;
    this._foDirtyRowMin = Infinity;
    this._foDirtyRowMax = -1;

    f.playerStatus = computePlayerStatus(this._playerStates, this._unitStates, {
      localPlayerSmallID: this._myPlayer?.smallID() ?? 0,
      localPlayerID: this._myPlayer?.id() ?? "",
      inSpawnPhase: this.inSpawnPhase(),
      tileState: this._map.tileStateBuffer(),
      tick: gu.tick,
      allianceDuration: this._config.allianceDuration(),
      isTransitiveTarget: (sid) =>
        this._myPlayer?.hasTransitiveTarget(sid) ?? false,
    });
    // terron ПЕРФ (Р10.1): пересборка матрицы (1МБ fill) + кластеров — только
    // при смене союзов/эмбарго; потребитель (Upload) по этому же флагу гейтит
    // GPU-загрузку и полнокарточный пересчёт границ.
    f.relationsDirty = this._relationsDirty;
    if (this._relationsDirty) {
      this._relationsDirty = false;
      const rel = buildRelationMatrix(this._playerStates);
      f.relationMatrix = rel.matrix;
      f.relationSize = rel.size;
      f.allianceClusters = computeAllianceClusters(this._playerStates);
    }
    f.nukeTelegraphs = extractNukeTelegraphs(
      this._unitStates,
      this._map.width(),
    );
    f.attackRings = this._myPlayer
      ? extractAttackRings(
          this._unitStates,
          this._map.width(),
          this._myPlayer.smallID(),
        )
      : [];
    f.structuresDirty = this._structuresDirty;

    // First populate: signal "full upload required" by nulling changedTiles.
    // uploadFrameData() treats null as "no delta info; do a full tile+trail
    // upload" — needed because the renderer's GPU buffers are empty.
    if (this._firstPopulate) {
      f.changedTiles = null;
      f.structuresDirty = true; // force initial structure upload
      this._firstPopulate = false;
    } else {
      f.changedTiles = this._changedTilesScratch;
    }

    // Reset transient flags for next tick.
    this.railroadCache.clearDirty();
    this._structuresDirty = false;
  }

  /** Clear and repopulate _frame.events arrays from this tick's gu.updates. */
  private buildFrameEvents(gu: GameUpdateViewData): void {
    const ev = this._frame.events;
    ev.deadUnits.length = 0;
    ev.conquestEvents.length = 0;
    ev.bonusEvents.length = 0;

    for (const u of gu.updates[GameUpdateType.Unit] ?? []) {
      if (u.isActive) continue;
      ev.deadUnits.push({
        unitType: u.unitType,
        pos: u.pos,
        reachedTarget: u.reachedTarget,
      });
    }
    const myID = this._myPlayer?.id();
    for (const c of gu.updates[GameUpdateType.ConquestEvent] ?? []) {
      const conquered = this._players.get(c.conqueredId);
      if (conquered === undefined) continue;
      const loc = conquered.nameLocation();
      if (loc === undefined) continue; // имя ещё не размещено — FX некуда ставить
      if (c.conquerorId === myID) {
        // финишер — FX мечей + золото (как было)
        ev.conquestEvents.push({ x: loc.x, y: loc.y, gold: Number(c.gold) });
      } else if (c.shares) {
        // terron: я откусил, но не добил → моя ДОЛЯ тоже даёт FX-мечи (золотой текст)
        const mine = c.shares.find((s) => s.id === myID);
        if (mine) {
          ev.conquestEvents.push({
            x: loc.x,
            y: loc.y,
            gold: Number(mine.gold),
            share: true,
          });
        }
      }
    }
    for (const b of gu.updates[GameUpdateType.BonusEvent] ?? []) {
      const player = this._players.get(b.player);
      if (player === undefined) continue;
      ev.bonusEvents.push({
        playerID: b.player,
        smallID: player.smallID(),
        tile: b.tile,
        gold: Number(b.gold),
        troops: b.troops,
      });
    }
  }

  /** Public accessor: the renderer reads this and uploads to the GPU. */
  frameData(): FrameData {
    return this._frame;
  }

  private advanceMotionPlannedUnits(currentTick: Tick): void {
    for (const [unitId, plan] of this.unitMotionPlans) {
      const unit = this._units.get(unitId);
      if (!unit || !unit.isActive()) {
        if (this.unitMotionPlans.delete(unitId)) {
          this.markMotionPlannedUnitIdsDirty();
        }
        continue;
      }

      const oldTile = unit.tile();
      const dt = currentTick - plan.startTick;
      const stepIndex =
        dt <= 0 ? 0 : Math.floor(dt / Math.max(1, plan.ticksPerStep));
      const lastIndex = plan.path.length - 1;
      const idx = Math.max(0, Math.min(lastIndex, stepIndex));
      const newTile = plan.path[idx] as TileRef;

      if (newTile !== oldTile) {
        unit.applyDerivedPosition(newTile);
        this.unitGrid.updateUnitCell(unit);
        continue;
      }

      // Once a plan is past its final step, `newTile` remains clamped to the last path tile.
      // Drop finished plans to avoid repeatedly marking static units as updated each tick.
      if (dt > 0 && stepIndex >= lastIndex) {
        if (this.unitMotionPlans.delete(unitId)) {
          this.markMotionPlannedUnitIdsDirty();
        }
      }
    }

    this.advanceTrainMotionPlannedUnits(currentTick);
  }

  private clearTrainPlanForUnit(unitId: number): void {
    const engineId =
      this.trainUnitToEngine.get(unitId) ??
      (this.trainMotionPlans.has(unitId) ? unitId : null);
    if (engineId === null) {
      return;
    }
    const plan = this.trainMotionPlans.get(engineId);
    if (!plan) {
      this.trainUnitToEngine.delete(unitId);
      return;
    }
    if (this.trainMotionPlans.delete(engineId)) {
      this.markMotionPlannedUnitIdsDirty();
    }
    this.trainUnitToEngine.delete(engineId);
    for (let i = 0; i < plan.carUnitIds.length; i++) {
      const id = plan.carUnitIds[i] >>> 0;
      if (id !== 0) this.trainUnitToEngine.delete(id);
    }
  }

  private advanceTrainMotionPlannedUnits(currentTick: Tick): void {
    const staleEngineIds: number[] = [];
    for (const [engineId, plan] of this.trainMotionPlans) {
      const engine = this._units.get(engineId);
      if (!engine || !engine.isActive()) {
        staleEngineIds.push(engineId);
        continue;
      }

      const steps = currentTick - plan.lastAdvancedTick;
      if (steps <= 0) {
        continue;
      }

      const path = plan.path;
      const lastIndex = path.length - 1;
      const cap = plan.usedTilesBuf.length;

      const pushUsed = (tile: TileRef) => {
        if (cap === 0) return;
        if (plan.usedLen < cap) {
          const idx = (plan.usedHead + plan.usedLen) % cap;
          plan.usedTilesBuf[idx] = tile >>> 0;
          plan.usedLen++;
        } else {
          plan.usedTilesBuf[plan.usedHead] = tile >>> 0;
          plan.usedHead = (plan.usedHead + 1) % cap;
          plan.usedLen = cap;
        }
      };

      const usedGet = (index: number): TileRef | null => {
        if (index < 0 || index >= plan.usedLen || cap === 0) return null;
        const idx = (plan.usedHead + index) % cap;
        return plan.usedTilesBuf[idx] as TileRef;
      };

      let didMove = false;
      for (let step = 0; step < steps; step++) {
        const cursor = plan.cursor;
        if (cursor >= lastIndex) {
          break;
        }
        for (let i = 0; i < plan.speed && cursor + i < path.length; i++) {
          pushUsed(path[cursor + i] as TileRef);
        }

        plan.cursor = Math.min(lastIndex, cursor + plan.speed);

        for (let i = plan.carUnitIds.length - 1; i >= 0; --i) {
          const carId = plan.carUnitIds[i] >>> 0;
          if (carId === 0) continue;
          const car = this._units.get(carId);
          if (!car || !car.isActive()) {
            continue;
          }
          const carTileIndex = (i + 1) * plan.spacing + 2;
          const tile = usedGet(carTileIndex);
          if (tile !== null) {
            const oldTile = car.tile();
            if (tile !== oldTile) {
              car.applyDerivedPosition(tile);
              this.unitGrid.updateUnitCell(car);
              didMove = true;
            }
          }
        }

        const newEngineTile = path[plan.cursor] as TileRef;
        const oldEngineTile = engine.tile();
        if (newEngineTile !== oldEngineTile) {
          engine.applyDerivedPosition(newEngineTile);
          this.unitGrid.updateUnitCell(engine);
          didMove = true;
        }
      }

      plan.lastAdvancedTick = currentTick;

      // Preserve the final-step redraw (plan remains for the tick where motion ends),
      // then clear once the train has settled and no longer moves.
      // Note: trains are currently deleted at the end of TrainExecution, and the ensuing
      // `Unit` update (isActive=false) also clears any associated motion plan records.
      // This expiry is defensive to avoid keeping stale plans around if that behavior changes.
      if (!didMove && plan.cursor >= lastIndex) {
        staleEngineIds.push(engineId);
      }
    }

    for (const engineId of staleEngineIds) {
      this.clearTrainPlanForUnit(engineId);
    }
  }

  private applyMotionPlanRecords(records: readonly MotionPlanRecord[]): void {
    for (const record of records) {
      switch (record.kind) {
        case "grid": {
          if (record.ticksPerStep < 1 || record.path.length < 1) {
            break;
          }
          const existing = this.unitMotionPlans.get(record.unitId);
          if (existing && record.planId <= existing.planId) {
            break;
          }

          const path =
            record.path instanceof Uint32Array
              ? record.path
              : Uint32Array.from(record.path);

          this.unitMotionPlans.set(record.unitId, {
            planId: record.planId,
            startTick: record.startTick,
            ticksPerStep: record.ticksPerStep,
            path,
          });
          this.markMotionPlannedUnitIdsDirty();
          break;
        }
        case "train": {
          if (record.speed < 1 || record.path.length < 1) {
            break;
          }
          const existing = this.trainMotionPlans.get(record.engineUnitId);
          if (existing && record.planId <= existing.planId) {
            break;
          }
          if (existing) {
            this.clearTrainPlanForUnit(record.engineUnitId);
          }

          const carUnitIds =
            record.carUnitIds instanceof Uint32Array
              ? record.carUnitIds
              : Uint32Array.from(record.carUnitIds);
          const path =
            record.path instanceof Uint32Array
              ? record.path
              : Uint32Array.from(record.path);

          const usedCap = carUnitIds.length * record.spacing + 3;
          const usedTilesBuf = new Uint32Array(Math.max(0, usedCap));

          this.trainMotionPlans.set(record.engineUnitId, {
            planId: record.planId,
            startTick: record.startTick,
            speed: record.speed,
            spacing: record.spacing,
            carUnitIds,
            path,
            cursor: 0,
            usedTilesBuf,
            usedHead: 0,
            usedLen: 0,
            lastAdvancedTick: record.startTick,
          });
          this.markMotionPlannedUnitIdsDirty();

          this.trainUnitToEngine.set(record.engineUnitId, record.engineUnitId);
          for (let i = 0; i < carUnitIds.length; i++) {
            const carId = carUnitIds[i] >>> 0;
            if (carId !== 0)
              this.trainUnitToEngine.set(carId, record.engineUnitId);
          }
          break;
        }
      }
    }
  }

  recentlyUpdatedTiles(): TileRef[] {
    return this.updatedTiles;
  }

  recentlyUpdatedTerrainTiles(): TileRef[] {
    return this.updatedTerrainTiles;
  }

  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
  ): Array<{ unit: UnitView; distSquared: number }> {
    return this.unitGrid.nearbyUnits(
      tile,
      searchRange,
      types,
      predicate,
    ) as Array<{
      unit: UnitView;
      distSquared: number;
    }>;
  }

  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ) {
    return this.unitGrid.hasUnitNearby(
      tile,
      searchRange,
      type,
      playerId,
      includeUnderConstruction,
    );
  }

  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: UnitView) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean {
    return this.unitGrid.anyUnitNearby(
      tile,
      searchRange,
      types,
      predicate as (unit: Unit | UnitView) => boolean,
      playerId,
      includeUnderConstruction,
    );
  }

  myClientID(): ClientID | undefined {
    return this._myClientID;
  }

  myPlayer(): PlayerView | null {
    return this._myPlayer;
  }

  // terron: ЗАКРЫТАЯ СТРАНА (ульта-пассив, TZ-ult-unlocks.md). Параметры игрока
  // (войска/золото/численность атак/подпись на карте) скрыты от ВСЕХ, кроме него
  // самого и его команды, пока стоит его штаб. Чисто видовой гейт (как подлодки):
  // сим честный, молчит только чужой интерфейс. Единая точка для HUD/рендера.
  // Владельцы достроенной Закрытой страны — ОДИН скан юнитов на тик, а не
  // полный проход по всем юнитам на каждый вызов (лидерборд звал ×2 на игрока
  // каждый тик). Ревью 23.08.
  private _ccTick = -1;
  private _ccOwners: Set<number> = new Set();
  private closedCountryOwners(): Set<number> {
    const t = this.ticks();
    if (t !== this._ccTick) {
      this._ccTick = t;
      const s = new Set<number>();
      for (const u of this.units(UnitType.ClosedCountry)) {
        if (!u.isUnderConstruction()) s.add(u.owner().smallID());
      }
      this._ccOwners = s;
    }
    return this._ccOwners;
  }

  statsHiddenFor(target: PlayerView | null | undefined): boolean {
    if (!target) return false;
    const owners = this.closedCountryOwners();
    if (owners.size === 0 || !owners.has(target.smallID())) return false;
    const me = this._myPlayer;
    if (me === null) return true; // наблюдатель/реплей — тоже «все остальные»
    if (me === target) return false;
    return !me.isOnSameTeam(target);
  }

  player(id: PlayerID): PlayerView {
    const player = this._players.get(id);
    if (player === undefined) {
      throw Error(`player id ${id} not found`);
    }
    return player;
  }

  players(): PlayerView[] {
    return Array.from(this._players.values());
  }

  playerBySmallID(id: number): PlayerView | TerraNullius {
    if (id === 0) {
      return new TerraNulliusImpl();
    }
    const playerId = this.smallIDToID.get(id);
    if (playerId === undefined) {
      throw new Error(`small id ${id} not found`);
    }
    return this.player(playerId);
  }

  playerByClientID(id: ClientID): PlayerView | null {
    const player =
      Array.from(this._players.values()).filter(
        (p) => p.clientID() === id,
      )[0] ?? null;
    if (player === null) {
      return null;
    }
    return player;
  }
  hasPlayer(id: PlayerID): boolean {
    return false;
  }
  playerViews(): PlayerView[] {
    return Array.from(this._players.values());
  }

  owner(tile: TileRef): PlayerView | TerraNullius {
    return this.playerBySmallID(this.ownerID(tile));
  }

  ticks(): Tick {
    if (this.lastUpdate === null) return 0;
    return this.lastUpdate.tick;
  }
  inSpawnPhase(): boolean {
    return this.startTick === null;
  }

  isSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this._config.spawnImmunityDuration()
    );
  }
  isNationSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this._config.nationSpawnImmunityDuration()
    );
  }

  elapsedGameSeconds(): number {
    return this.ticksSinceStart() / 10;
  }

  ticksSinceStart(): Tick {
    if (this.inSpawnPhase()) {
      return 0;
    }

    return Math.max(0, this.ticks() - this.startTick!);
  }
  config(): Config {
    return this._config;
  }

  // ── terron: туман войны — CPU-двойник GL-маски (FogPass) ────────────────
  // Для гейтов кликов/ховера/HUD. Радиус и условия ДОЛЖНЫ совпадать с
  // FogPass/WebGLFrameBuilder.syncFog, иначе клик «видит» не то, что глаз.

  // ── terron: туман — РЕВИЛЫ после своих ударов/высадок (владелец 12.07) ──
  // Мой снаряд долетел / десант высадился → круг видимости 5с, потом схлоп 3с.
  private readonly _fogReveals: Array<{
    x: number;
    y: number;
    r: number;
    born: Tick;
  }> = [];

  private static readonly FOG_REVEAL_RADIUS: Record<string, number> = {
    "Atom Bomb": 30, // outer-радиус взрыва (Config.nukeMagnitudes)
    "Hydrogen Bomb": 100,
    "MIRV Warhead": 18,
    "Suicide Drone": 12,
    "Airborne Assault": TERRON_FOG_VISION_RADIUS,
    Transport: TERRON_FOG_VISION_RADIUS, // морская высадка
  };

  private maybeAddFogReveal(unit: UnitView): void {
    if (!this._config.fogOfWar() && this._satBlackout === null) return;
    const base = GameView.FOG_REVEAL_RADIUS[unit.state.unitType];
    if (base === undefined) return;
    const me = this.myPlayer();
    if (me === null || unit.state.ownerID !== me.smallID()) return;
    if (!unit.state.reachedTarget) return; // сбитое/погибшее не раскрывает
    const t = unit.tile();
    this._fogReveals.push({
      x: this.x(t),
      y: this.y(t),
      r: base + TERRON_FOG_REVEAL_MARGIN,
      born: this.ticks(),
    });
  }

  /** Активные ревилы с ТЕКУЩИМ (схлопывающимся) радиусом; чистит истёкшие. */
  fogReveals(): Array<{ x: number; y: number; r: number }> {
    const now = this.ticks();
    const out: Array<{ x: number; y: number; r: number }> = [];
    for (let i = this._fogReveals.length - 1; i >= 0; i--) {
      const rv = this._fogReveals[i];
      const age = now - rv.born;
      if (age < TERRON_FOG_REVEAL_HOLD_TICKS) {
        out.push({ x: rv.x, y: rv.y, r: rv.r });
      } else if (
        age <
        TERRON_FOG_REVEAL_HOLD_TICKS + TERRON_FOG_REVEAL_COLLAPSE_TICKS
      ) {
        const k =
          1 -
          (age - TERRON_FOG_REVEAL_HOLD_TICKS) /
            TERRON_FOG_REVEAL_COLLAPSE_TICKS;
        out.push({ x: rv.x, y: rv.y, r: rv.r * k });
      } else {
        this._fogReveals.splice(i, 1);
      }
    }
    return out;
  }

  /** terron: «Небо наше» — последний запуск (сырой, живёт и после окна). */
  satBlackoutRaw(): SatBlackoutUpdate | null {
    return this._satBlackout;
  }

  // terron: снаряды-«выстрелы» бункеров этого тика (Укрепления). Читается раз/тик.
  fortShots(): FortShotUpdate[] {
    return this._fortShots;
  }

  /** Блэкаут-окно активно СЕЙЧАС (подрыв был, конец не настал)? */
  satBlackoutActive(): boolean {
    const b = this._satBlackout;
    if (b === null) return false;
    const t = this.ticks();
    return t >= b.blastTick && t < b.endTick;
  }

  /** Слепит ли активный блэкаут МЕНЯ (владелец и его команда в Team — нет). */
  satBlackoutBlindsMe(): boolean {
    if (!this.satBlackoutActive()) return false;
    const b = this._satBlackout!;
    const me = this.myPlayer();
    if (me === null) return false;
    if (me.smallID() === b.ownerSmallID) return false;
    // Team-режим: команда владельца щадится (решение владельца 11.07).
    const owner = this.playerBySmallID(b.ownerSmallID);
    if (owner instanceof PlayerView) {
      const myTeam = me.team();
      if (myTeam !== null && owner.team() === myTeam) return false;
    }
    return true;
  }

  /** Туман сейчас реально действует для локального игрока? */
  fogOfWarActive(): boolean {
    if (this._config.isReplay()) return false;
    // Спавн-фаза: туман СО СТАРТА (владелец 12.07) — точку выбирают вслепую,
    // чужие пики не видны (спавн-оверлей фильтруется и рисуется ПОВЕРХ тумана).
    if (this.inSpawnPhase()) return this._config.fogOfWar();
    const me = this.myPlayer();
    if (me === null || !me.isAlive()) return false;
    if (this.satBlackoutActive()) {
      // «Небо наше»: спутники остались только у владельца.
      if (this.satBlackoutBlindsMe()) return true;
      // Владелец на время блэкаута видит ВСЁ — даже в матче с лобби-туманом.
      if (me.smallID() === this._satBlackout!.ownerSmallID) return false;
      // Пощажённый сокомандник — остаётся при своём (лобби-туман как был).
    }
    return this._config.fogOfWar();
  }

  private _fogFriendlyTick = -1;
  private readonly _fogFriendly = new Set<number>();
  /** Я + союзники + сокомандники (smallID). Кэш на тик. */
  private fogFriendlySet(me: PlayerView): ReadonlySet<number> {
    const t = this.ticks();
    if (t === this._fogFriendlyTick) return this._fogFriendly;
    this._fogFriendlyTick = t;
    const s = this._fogFriendly;
    s.clear();
    s.add(me.smallID());
    for (const a of me.state.allies) s.add(a);
    const myTeam = me.team();
    if (myTeam !== null) {
      for (const p of this.players()) {
        if (p.team() === myTeam) s.add(p.smallID());
      }
    }
    return s;
  }

  /**
   * Видим ли тайл под туманом: в квадрате Чебышева R есть своя/союзная земля
   * ИЛИ свой/союзный юнит в радиусе R. Без тумана — всегда true. Скан
   * (2R+1)² тайлов — для редких запросов (клик/ховер), не для циклов по карте.
   */
  isTileVisibleUnderFog(tile: TileRef): boolean {
    if (!this.fogOfWarActive()) return true;
    const cx = this.x(tile);
    const cy = this.y(tile);
    // Спавн-фаза: myPlayer может ещё не существовать — видимости нет нигде.
    const me = this.myPlayer();
    if (me !== null) {
      const friendly = this.fogFriendlySet(me);
      const R = TERRON_FOG_VISION_RADIUS;
      const w = this.width();
      const x0 = Math.max(0, cx - R);
      const x1 = Math.min(w - 1, cx + R);
      const y0 = Math.max(0, cy - R);
      const y1 = Math.min(this.height() - 1, cy + R);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const owner = this.ownerID(this.ref(xx, yy));
          if (owner !== 0 && friendly.has(owner)) return true;
        }
      }
      for (const u of this._units.values()) {
        if (!u.isActive()) continue;
        if (!friendly.has(u.owner().smallID())) continue;
        const ut = u.tile();
        if (Math.abs(this.x(ut) - cx) <= R && Math.abs(this.y(ut) - cy) <= R) {
          return true;
        }
      }
    }
    // Ревилы после своих ударов/высадок (круги, евклид).
    for (const rv of this.fogReveals()) {
      const dx = rv.x - cx;
      const dy = rv.y - cy;
      if (dx * dx + dy * dy <= rv.r * rv.r) return true;
    }
    return false;
  }

  units(...types: UnitType[]): UnitView[] {
    // terron: горячий путь (зовётся из контроллеров/HUD каждый кадр) — один
    // проход без промежуточного Array.from; порядок = порядок Map.
    const out: UnitView[] = [];
    if (types.length === 0) {
      for (const u of this._units.values()) if (u.isActive()) out.push(u);
    } else if (types.length === 1) {
      const t = types[0];
      for (const u of this._units.values()) {
        if (u.isActive() && u.type() === t) out.push(u);
      }
    } else {
      const set = new Set(types);
      for (const u of this._units.values()) {
        if (u.isActive() && set.has(u.type())) out.push(u);
      }
    }
    return out;
  }
  unit(id: number): UnitView | undefined {
    return this._units.get(id);
  }
  unitInfo(type: UnitType): UnitInfo {
    return this._config.unitInfo(type);
  }

  /**
   * Long-lived map of UnitState records, keyed by unit ID. Mutated in place
   * each tick by `update()`. Renderer code reads from this directly — the
   * UnitView wrapping each entry shares the same UnitState reference.
   *
   * Includes inactive units; renderer filters by `state.isActive`.
   */
  unitStates(): ReadonlyMap<number, import("../render/types").UnitState> {
    return this._unitStates;
  }

  /**
   * Long-lived map of PlayerState records, keyed by smallID. Mutated in place
   * each tick by `update()`. Renderer code reads from this directly.
   */
  playerStates(): ReadonlyMap<number, import("../render/types").PlayerState> {
    return this._playerStates;
  }

  ref(x: number, y: number): TileRef {
    return this._map.ref(x, y);
  }
  isValidRef(ref: TileRef): boolean {
    return this._map.isValidRef(ref);
  }
  // terron 24.08: есть ли РЕЛЬС в радиусе radius тайлов от ref — для
  // гост-превью рельсов у госта фабрики (рядом с рельсом станция врежется в
  // него, новые нитки к соседям не строятся). Читает railroadState рендера.
  hasRailNear(ref: TileRef, radius: number): boolean {
    const w = this._map.width();
    const h = this._map.height();
    const state = this.railroadCache.railroadState;
    const cx = this.x(ref);
    const cy = this.y(ref);
    for (let dy = -radius; dy <= radius; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= w) continue;
        if (state[y * w + x] > 0) return true;
      }
    }
    return false;
  }

  x(ref: TileRef): number {
    return this._map.x(ref);
  }
  y(ref: TileRef): number {
    return this._map.y(ref);
  }
  cell(ref: TileRef): Cell {
    return this._map.cell(ref);
  }
  width(): number {
    return this._map.width();
  }
  height(): number {
    return this._map.height();
  }
  numLandTiles(): number {
    return this._map.numLandTiles();
  }
  isValidCoord(x: number, y: number): boolean {
    return this._map.isValidCoord(x, y);
  }
  isLand(ref: TileRef): boolean {
    return this._map.isLand(ref);
  }
  isOceanShore(ref: TileRef): boolean {
    return this._map.isOceanShore(ref);
  }
  isOcean(ref: TileRef): boolean {
    return this._map.isOcean(ref);
  }
  isShoreline(ref: TileRef): boolean {
    return this._map.isShoreline(ref);
  }
  magnitude(ref: TileRef): number {
    return this._map.magnitude(ref);
  }
  terrainByte(ref: TileRef): number {
    return this._map.terrainByte(ref);
  }
  terrainRaw(): Uint8Array {
    return this._map.terrainRaw();
  }
  setWater(ref: TileRef): void {
    this._map.setWater(ref);
  }
  setShorelineBit(ref: TileRef): void {
    this._map.setShorelineBit(ref);
  }
  clearShorelineBit(ref: TileRef): void {
    this._map.clearShorelineBit(ref);
  }
  setOcean(ref: TileRef): void {
    this._map.setOcean(ref);
  }
  setMagnitude(ref: TileRef, value: number): void {
    this._map.setMagnitude(ref, value);
  }
  ownerID(ref: TileRef): number {
    return this._map.ownerID(ref);
  }
  hasOwner(ref: TileRef): boolean {
    return this._map.hasOwner(ref);
  }
  setOwnerID(ref: TileRef, playerId: number): void {
    return this._map.setOwnerID(ref, playerId);
  }
  hasFallout(ref: TileRef): boolean {
    return this._map.hasFallout(ref);
  }
  setFallout(ref: TileRef, value: boolean): void {
    return this._map.setFallout(ref, value);
  }

  // terron: скины пепла — ингест пар [tile, smallID] из воркера. Значение в
  // буфере: smallID | skinIdx<<12. Грязные строки копятся до populateFrame.
  /** Полный буфер «чей пепел» (для переливки после потери GL-контекста). */
  falloutOwnersFull(): Uint16Array | null {
    return this._falloutOwners;
  }

  /**
   * Узор пепла владельца: КУПЛЕННЫЙ (косметика скина-«государства») либо, если
   * не выбран, прежний детерминированный хэш от smallID. Кэш обязателен —
   * зовётся на КАЖДЫЙ тайл пепла при ингесте, а косметика за матч не меняется.
   */
  private falloutSkinOf(ownerSmallId: number): number {
    if (ownerSmallId === 0) return 0;
    const hit = this._falloutSkinCache.get(ownerSmallId);
    if (hit !== undefined) return hit;
    let idx = falloutSkinIndexFor(ownerSmallId);
    try {
      const p = this.playerBySmallID(ownerSmallId);
      const chosen = (p as PlayerView).cosmetics?.customSkin?.falloutSkin;
      if (
        typeof chosen === "number" &&
        chosen >= 1 &&
        chosen <= FALLOUT_SKIN_COUNT
      ) {
        idx = chosen;
      }
    } catch {
      /* игрок ещё не доингещён — берём хэш, кэш не портим */
      return idx;
    }
    this._falloutSkinCache.set(ownerSmallId, idx);
    return idx;
  }

  private applyFalloutOwners(packed: Uint32Array): void {
    const w = this._map.width();
    if (!this._falloutOwners) {
      this._falloutOwners = new Uint16Array(w * this._map.height());
    }
    for (let i = 0; i + 1 < packed.length; i += 2) {
      const tile = packed[i];
      const owner = packed[i + 1] & 0xfff;
      this._falloutOwners[tile] = owner | (this.falloutSkinOf(owner) << 12);
      const row = (tile / w) | 0;
      if (row < this._foDirtyRowMin) this._foDirtyRowMin = row;
      if (row > this._foDirtyRowMax) this._foDirtyRowMax = row;
    }
  }
  isBorder(ref: TileRef): boolean {
    return this._map.isBorder(ref);
  }
  neighbors(ref: TileRef): TileRef[] {
    return this._map.neighbors(ref);
  }
  isWater(ref: TileRef): boolean {
    return this._map.isWater(ref);
  }
  isLake(ref: TileRef): boolean {
    return this._map.isLake(ref);
  }
  isShore(ref: TileRef): boolean {
    return this._map.isShore(ref);
  }
  cost(ref: TileRef): number {
    return this._map.cost(ref);
  }
  terrainType(ref: TileRef): TerrainType {
    return this._map.terrainType(ref);
  }
  forEachTile(fn: (tile: TileRef) => void): void {
    return this._map.forEachTile(fn);
  }
  manhattanDist(c1: TileRef, c2: TileRef): number {
    return this._map.manhattanDist(c1, c2);
  }
  euclideanDistSquared(c1: TileRef, c2: TileRef): number {
    return this._map.euclideanDistSquared(c1, c2);
  }
  circleSearch(
    tile: TileRef,
    radius: number,
    filter?: (tile: TileRef, d2: number) => boolean,
  ): Set<TileRef> {
    return this._map.circleSearch(tile, radius, filter);
  }
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef> {
    return this._map.bfs(tile, filter);
  }
  tileState(tile: TileRef): number {
    return this._map.tileState(tile);
  }
  tileStateBuffer(): Uint16Array {
    return this._map.tileStateBuffer();
  }
  updateTile(tile: TileRef, state: number): boolean {
    return this._map.updateTile(tile, state);
  }
  numTilesWithFallout(): number {
    return this._map.numTilesWithFallout();
  }
  gameID(): GameID {
    return this._gameID;
  }

  focusedPlayer(): PlayerView | null {
    return this.myPlayer();
  }
}

// terron: скины пепла — 10 процедурных узоров (индексы 1..10, см.
// falloutSkinMask в territory.frag.glsl; 0 = гладкий пепел без узора).
// Пока магазина нет, «выбор» скина — детерминированный хэш от smallID:
// одинаков у всех клиентов без единого байта протокола, разным игрокам
// достаются разные узоры (обкатка на деве). При магазине заменить на
// выбор игрока из косметики (той же точкой — здесь, при ингесте).
export const FALLOUT_SKIN_COUNT = 10;
function falloutSkinIndexFor(ownerSmallId: number): number {
  if (ownerSmallId === 0) return 0;
  return (
    ((Math.imul(ownerSmallId, 2654435761) >>> 16) % FALLOUT_SKIN_COUNT) + 1
  );
}

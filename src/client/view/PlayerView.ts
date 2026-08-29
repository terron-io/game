import { Colord, colord } from "colord";
import { base64url } from "jose";
import { ColorPalette } from "../../core/CosmeticSchemas";
import { PatternDecoder } from "../../core/PatternDecoder";
import { ClientID, PlayerCosmetics } from "../../core/Schemas";
import { createRandomName } from "../../core/Util";
import {
  BuildableUnit,
  Cell,
  EmojiMessage,
  Gold,
  NameViewData,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerProfile,
  PlayerType,
  Team,
  Tick,
  UnitType,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { applyStateUpdate } from "../../core/game/GameUpdateUtils";
import {
  AllianceView,
  AttackUpdate,
  PlayerUpdate,
} from "../../core/game/GameUpdates";
import { UserSettings } from "../../core/game/UserSettings";
import { localizeAIName } from "../LocalizeNames";
import { PlayerState, PlayerStatic, PlayerTypeEnum } from "../render/types";
import { themeProvider } from "../theme/ThemeProvider";
import { GameView } from "./GameView";
import { UnitView } from "./UnitView";

const userSettings: UserSettings = new UserSettings();

const FRIENDLY_TINT_TARGET = { r: 0, g: 255, b: 0, a: 1 };
const EMBARGO_TINT_TARGET = { r: 255, g: 0, b: 0, a: 1 };
const BORDER_TINT_RATIO = 0.35;

function gamePlayerTypeToEnum(t: PlayerType): PlayerTypeEnum {
  switch (t) {
    case PlayerType.Human:
      return PlayerTypeEnum.Human;
    case PlayerType.Bot:
      return PlayerTypeEnum.Bot;
    case PlayerType.Nation:
      return PlayerTypeEnum.Nation;
    default:
      return PlayerTypeEnum.Bot;
  }
}

// First-emission updates from the engine always include every field; these
// builders assert non-null for that contract. Subsequent diffs are partial
// and flow through applyStateUpdate() below.
function staticFromUpdate(pu: PlayerUpdate): PlayerStatic {
  const playerType = gamePlayerTypeToEnum(pu.playerType!);
  // terron: локализуем имена ИИ-игроков (племён/наций) на язык клиента.
  // Ники живых людей не трогаем. Делается на статике (один раз), т.к. map-рендер
  // читает static.displayName напрямую, а не через геттер.
  const isAI = playerType !== PlayerTypeEnum.Human;
  return {
    smallID: pu.smallID!,
    id: pu.id,
    name: isAI ? localizeAIName(pu.name!) : pu.name!,
    displayName: isAI ? localizeAIName(pu.displayName!) : pu.displayName!,
    clientID: pu.clientID ?? null,
    playerType,
    team: pu.team ?? null,
    isLobbyCreator: pu.isLobbyCreator!,
  };
}

function stateFromUpdate(pu: PlayerUpdate): PlayerState {
  // embargoes: Set<PlayerID strings> on the wire, but the renderer stores
  // smallIDs (numbers). GameView fills these in via setEmbargoes() because
  // it has the PlayerID → smallID lookup table.
  return {
    smallID: pu.smallID!,
    isAlive: pu.isAlive!,
    isDisconnected: pu.isDisconnected!,
    tilesOwned: pu.tilesOwned!,
    gold: Number(pu.gold!),
    troops: pu.troops!,
    isTraitor: pu.isTraitor!,
    traitorRemainingTicks: Math.max(0, pu.traitorRemainingTicks ?? 0),
    betrayals: pu.betrayals!,
    hasSpawned: pu.hasSpawned!,
    spawnTile: pu.spawnTile,
    lastDeleteUnitTick: pu.lastDeleteUnitTick!,
    allies: pu.allies!.slice(),
    embargoes: [],
    targets: pu.targets!.slice(),
    outgoingAttacks: pu.outgoingAttacks!,
    incomingAttacks: pu.incomingAttacks!,
    outgoingAllianceRequests: pu.outgoingAllianceRequests!.slice(),
    alliances: pu.alliances!,
    outgoingEmojis: pu.outgoingEmojis!,
    airborneBeachheads: pu.airborneBeachheads?.slice() ?? [],
    airborneAssaultsBuilt: pu.airborneAssaultsBuilt ?? 0,
    // terron: ультимейты — зафиксированный выбор (undefined = не выбран).
    ultimateChoice: pu.ultimateChoice,
    pirateShipReadyAt: pu.pirateShipReadyAt, // terron: ПИРАТСТВО — откат лодок
    // terron: ультимейты — суммарные метрики (тултип слота).
    ultStolen: pu.ultStolen,
    ultStolenGained: pu.ultStolenGained,
    ultMirvLaunches: pu.ultMirvLaunches,
    ultMirvTiles: pu.ultMirvTiles,
    ultFortTiles: pu.ultFortTiles,
    ultSplitTiles: pu.ultSplitTiles,
    ultReligionTiles: pu.ultReligionTiles,
    ultReligionTithe: pu.ultReligionTithe,
    ultWaterTiles: pu.ultWaterTiles,
    aggressors: pu.aggressors,
    // terron: ультимейты — Раскол: маркер одной цифры-таймера спасения Т.
    splitRescue: pu.splitRescue ?? null,
  };
}

export class PlayerView {
  public anonymousName: string | null = null;
  private decoder?: PatternDecoder;

  /** Long-lived renderer state — mutated in place by applyUpdate(). */
  public state: PlayerState;
  /** Static header data — set once at construction, never mutated. */
  public static: PlayerStatic;

  private _territoryColor: Colord;
  private _borderColor: Colord;
  // Update here to include structure light and dark colors.
  // terron 20.07: считается ЛЕНИВО. theme.structureColors() крутит до 50
  // итераций с LAB-конверсиями и delta-E — на матче с 400 ботами вызов из
  // конструктора съедал ~2.4с ГЛАВНОГО ПОТОКА в первом же пакете состояния
  // (замер: ингест_игроки=2370мс из 2375мс всего ингеста). Страница на эти
  // секунды замирала: карта видна, но ни зума, ни протяжки — репорт владельца
  // «сначала успеваю покрутить, потом всё вешается». Цвета строений нужны лишь
  // когда у игрока реально рисуется здание, а у большинства ботов его нет.
  private _structureColorsCache: { light: Colord; dark: Colord } | null = null;

  // Pre-computed border color variants
  private _borderColorNeutral: Colord;
  private _borderColorFriendly: Colord;
  private _borderColorEmbargo: Colord;
  private _borderColorDefendedNeutral: { light: Colord; dark: Colord };
  private _borderColorDefendedFriendly: { light: Colord; dark: Colord };
  private _borderColorDefendedEmbargo: { light: Colord; dark: Colord };

  constructor(
    private game: GameView,
    data: PlayerUpdate,
    // terron (15.08): тип стал честным — у нового игрока до ближайшего
    // пересчёта (раз в 10 тиков) позиции имени НЕТ; потребители и раньше
    // защищались (`?? 0`, `if (!nameLocation)`), теперь это видит компилятор.
    public nameData: NameViewData | undefined,
    public cosmetics: PlayerCosmetics,
  ) {
    this.state = stateFromUpdate(data);
    this.static = staticFromUpdate(data);

    // First emission always carries name + playerType (see staticFromUpdate).
    if (data.clientID === game.myClientID()) {
      this.anonymousName = data.name!;
    } else {
      this.anonymousName = createRandomName(data.name!, data.playerType!);
    }

    const theme = themeProvider.current();

    const defaultTerritoryColor = theme.territoryColor(this);
    const defaultBorderColor = theme.borderColor(defaultTerritoryColor);

    const pattern = userSettings.territoryPatterns()
      ? this.cosmetics.pattern
      : undefined;
    if (pattern) {
      pattern.colorPalette ??= {
        name: "",
        primaryColor: defaultTerritoryColor.toHex(),
        secondaryColor: defaultBorderColor.toHex(),
      } satisfies ColorPalette;
    }

    if (this.team() === null) {
      this._territoryColor = colord(
        this.cosmetics.color?.color ??
          pattern?.colorPalette?.primaryColor ??
          defaultTerritoryColor.toHex(),
      );
    } else {
      this._territoryColor = defaultTerritoryColor;
    }

    // цвета строений — лениво, см. _structureColorsCache

    const maybeFocusedBorderColor =
      this.game.myClientID() === data.clientID
        ? theme.focusedBorderColor()
        : defaultBorderColor;

    this._borderColor = new Colord(
      pattern?.colorPalette?.secondaryColor ??
        this.cosmetics.color?.color ??
        maybeFocusedBorderColor.toHex(),
    );

    const baseRgb = this._borderColor.toRgb();

    this._borderColorNeutral = this._borderColor;

    this._borderColorFriendly = colord({
      r: Math.round(
        baseRgb.r * (1 - BORDER_TINT_RATIO) +
          FRIENDLY_TINT_TARGET.r * BORDER_TINT_RATIO,
      ),
      g: Math.round(
        baseRgb.g * (1 - BORDER_TINT_RATIO) +
          FRIENDLY_TINT_TARGET.g * BORDER_TINT_RATIO,
      ),
      b: Math.round(
        baseRgb.b * (1 - BORDER_TINT_RATIO) +
          FRIENDLY_TINT_TARGET.b * BORDER_TINT_RATIO,
      ),
      a: baseRgb.a,
    });

    this._borderColorEmbargo = colord({
      r: Math.round(
        baseRgb.r * (1 - BORDER_TINT_RATIO) +
          EMBARGO_TINT_TARGET.r * BORDER_TINT_RATIO,
      ),
      g: Math.round(
        baseRgb.g * (1 - BORDER_TINT_RATIO) +
          EMBARGO_TINT_TARGET.g * BORDER_TINT_RATIO,
      ),
      b: Math.round(
        baseRgb.b * (1 - BORDER_TINT_RATIO) +
          EMBARGO_TINT_TARGET.b * BORDER_TINT_RATIO,
      ),
      a: baseRgb.a,
    });

    this._borderColorDefendedNeutral = theme.defendedBorderColors(
      this._borderColorNeutral,
    );
    this._borderColorDefendedFriendly = theme.defendedBorderColors(
      this._borderColorFriendly,
    );
    this._borderColorDefendedEmbargo = theme.defendedBorderColors(
      this._borderColorEmbargo,
    );

    // terron: гард (телеметрия 17.07, js_error «reading 'slice'» из new
    // PatternDecoder): битый/пустой patternData чужого скина ронял конструктор
    // PlayerView → падал весь ингест игроков. Не декодится — без паттерна.
    let decoder: PatternDecoder | undefined;
    if (pattern !== undefined) {
      try {
        decoder = new PatternDecoder(pattern, base64url.decode);
      } catch (e) {
        console.warn("PatternDecoder failed, ignoring territory pattern", e);
      }
    }
    this.decoder = decoder;
  }

  /**
   * Update mutable state in place. Called by GameView.update() each tick the
   * player appears in the PlayerUpdate stream.
   */
  applyUpdate(pu: PlayerUpdate): void {
    applyStateUpdate(this.state, pu);
  }

  /** Set the renderer-format embargoes (smallIDs). */
  setEmbargoSmallIDs(smallIDs: number[]): void {
    this.state.embargoes = smallIDs;
  }

  territoryColor(tile?: TileRef): Colord {
    if (tile === undefined || this.decoder === undefined) {
      return this._territoryColor;
    }
    const isPrimary = this.decoder.isPrimary(
      this.game.x(tile),
      this.game.y(tile),
    );
    return isPrimary ? this._territoryColor : this._borderColor;
  }

  structureColors(): { light: Colord; dark: Colord } {
    this._structureColorsCache ??= themeProvider
      .current()
      .structureColors(this._territoryColor);
    return this._structureColorsCache;
  }

  /**
   * Border color for a tile:
   * - Tints by neighbor relations (embargo → red, friendly → green, else neutral).
   * - If defended, applies theme checkerboard to the tinted color.
   */
  borderColor(tile?: TileRef, isDefended: boolean = false): Colord {
    if (tile === undefined) {
      return this._borderColor;
    }

    const { hasEmbargo, hasFriendly } = this.borderRelationFlags(tile);

    let baseColor: Colord;
    let defendedColors: { light: Colord; dark: Colord };

    if (hasEmbargo) {
      baseColor = this._borderColorEmbargo;
      defendedColors = this._borderColorDefendedEmbargo;
    } else if (hasFriendly) {
      baseColor = this._borderColorFriendly;
      defendedColors = this._borderColorDefendedFriendly;
    } else {
      baseColor = this._borderColorNeutral;
      defendedColors = this._borderColorDefendedNeutral;
    }

    if (!isDefended) {
      return baseColor;
    }

    const x = this.game.x(tile);
    const y = this.game.y(tile);
    const lightTile =
      (x % 2 === 0 && y % 2 === 0) || (y % 2 === 1 && x % 2 === 1);
    return lightTile ? defendedColors.light : defendedColors.dark;
  }

  /**
   * Border relation flags for a tile, used by both CPU and WebGL renderers.
   */
  borderRelationFlags(tile: TileRef): {
    hasEmbargo: boolean;
    hasFriendly: boolean;
  } {
    const mySmallID = this.smallID();
    let hasEmbargo = false;
    let hasFriendly = false;

    for (const n of this.game.neighbors(tile)) {
      if (!this.game.hasOwner(n)) {
        continue;
      }

      const otherOwner = this.game.owner(n);
      if (!otherOwner.isPlayer() || otherOwner.smallID() === mySmallID) {
        continue;
      }

      if (this.hasEmbargo(otherOwner)) {
        hasEmbargo = true;
        break;
      }

      if (this.isFriendly(otherOwner) || otherOwner.isFriendly(this)) {
        hasFriendly = true;
      }
    }
    return { hasEmbargo, hasFriendly };
  }

  async actions(
    tile?: TileRef,
    units?: readonly PlayerBuildableUnitType[] | null,
  ): Promise<PlayerActions> {
    return this.game.worker.playerInteraction(
      this.id(),
      tile && this.game.x(tile),
      tile && this.game.y(tile),
      units,
    );
  }

  async buildables(
    tile?: TileRef,
    units?: readonly PlayerBuildableUnitType[],
  ): Promise<BuildableUnit[]> {
    return this.game.worker.playerBuildables(
      this.id(),
      tile && this.game.x(tile),
      tile && this.game.y(tile),
      units,
    );
  }

  async borderTiles(): Promise<PlayerBorderTiles> {
    return this.game.worker.playerBorderTiles(this.id());
  }

  outgoingAttacks(): AttackUpdate[] {
    return this.state.outgoingAttacks;
  }

  incomingAttacks(): AttackUpdate[] {
    return this.state.incomingAttacks;
  }

  // terron: авиация — активные десантные плацдармы (тайл + турн истечения иммунитета).
  airborneBeachheads(): { tile: number; expiryTick: number }[] {
    return this.state.airborneBeachheads ?? [];
  }

  // terron: ультимейты — Раскол: маркер одной цифры-таймера спасения Т (или null).
  splitRescue(): { x: number; y: number; w: number; expiry: number } | null {
    return this.state.splitRescue ?? null;
  }

  // terron: ультимейты — живое достроенное ульт-здание (зеркало
  // PlayerImpl.hasUltimate для клиентских расчётов цен).
  hasUltimate(unitType: UnitType): boolean {
    return this.units(unitType).some((u) => !u.isUnderConstruction());
  }

  // terron: авиация — цена СЛЕДУЮЩЕЙ высадки: min(1kk, (построено+1)·100k).
  // Авиаштаб (ульта) — бесплатно.
  nextAirAssaultCost(): number {
    if (this.hasUltimate(UnitType.AirCommand)) return 0;
    const n = this.state.airborneAssaultsBuilt ?? 0;
    return Math.min(1_000_000, (n + 1) * 100_000);
  }

  // terron: ультимейты — зафиксированный выбор (null = ещё не использовал).
  ultimateChoice(): UnitType | null {
    return (this.state.ultimateChoice as UnitType | undefined) ?? null;
  }

  /** terron: ПИРАТСТВО — тик, когда можно купить следующую лодку (0 — можно). */
  pirateShipReadyAt(): number {
    return this.state.pirateShipReadyAt ?? 0;
  }

  // terron: ультимейты — суммарные метрики за матч (тултип слота ульты).
  ultStats(): {
    stolen: number;
    stolenGained: number;
    mirvLaunches: number;
    mirvTiles: number;
    fortTiles: number;
    splitTiles: number;
    religionTiles: number;
    religionTithe: number;
    waterTiles: number;
  } {
    return {
      stolen: this.state.ultStolen ?? 0,
      stolenGained: this.state.ultStolenGained ?? 0,
      mirvLaunches: this.state.ultMirvLaunches ?? 0,
      mirvTiles: this.state.ultMirvTiles ?? 0,
      fortTiles: this.state.ultFortTiles ?? 0,
      splitTiles: this.state.ultSplitTiles ?? 0,
      religionTiles: this.state.ultReligionTiles ?? 0,
      religionTithe: this.state.ultReligionTithe ?? 0,
      waterTiles: this.state.ultWaterTiles ?? 0,
    };
  }

  async attackClusteredPositions(
    attackID?: string,
  ): Promise<{ id: string; positions: Cell[] }[]> {
    return this.game.worker.attackClusteredPositions(this.smallID(), attackID);
  }

  units(...types: UnitType[]): UnitView[] {
    return this.game
      .units(...types)
      .filter((u) => u.owner().smallID() === this.smallID());
  }

  // terron: примерное время (сек) до освобождения ближайшей лодки, когда все
  // boatMaxNumber транспортов в пути. Грубо: манхэттен до цели / скорость (~1
  // тайл/тик, 10 тиков/с). 0 = слот свободен (лодок меньше лимита). Для таймера
  // на иконке лодки в радиальном меню.
  boatFreeCooldown(): number {
    const max = this.game.config().boatMaxNumber();
    const boats = this.units(UnitType.TransportShip);
    if (max <= 0 || boats.length < max) return 0;
    let minTiles = Infinity;
    for (const b of boats) {
      const dst = b.targetTile();
      if (dst === undefined) continue;
      const d =
        Math.abs(this.game.x(b.tile()) - this.game.x(dst)) +
        Math.abs(this.game.y(b.tile()) - this.game.y(dst));
      if (d < minTiles) minTiles = d;
    }
    return Number.isFinite(minTiles) ? minTiles / 10 : 0;
  }

  nameLocation(): NameViewData | undefined {
    return this.nameData;
  }

  smallID(): number {
    return this.state.smallID;
  }

  name(): string {
    return this.anonymousName !== null && userSettings.anonymousNames()
      ? this.anonymousName
      : this.static.name;
  }
  /**
   * terron: РЕВАНШИЗМ — «на кого обиделись»: те, кто напал на меня ПЕРВЫМ.
   * Показывается в ховере статуи. Порядок = порядок нападений.
   */
  aggressorNames(): string[] {
    const ids = this.state.aggressors ?? [];
    const out: string[] = [];
    for (const id of ids) {
      const p = this.game.playerBySmallID(id) as PlayerView | undefined;
      if (p) out.push(p.displayName());
    }
    return out;
  }

  displayName(): string {
    return this.anonymousName !== null && userSettings.anonymousNames()
      ? this.anonymousName
      : this.static.displayName;
  }

  clientID(): ClientID | null {
    return this.static.clientID;
  }
  id(): PlayerID {
    return this.static.id;
  }
  team(): Team | null {
    return this.static.team;
  }
  type(): PlayerType {
    // Map PlayerStatic's numeric enum back to engine string enum.
    switch (this.static.playerType) {
      case PlayerTypeEnum.Human:
        return PlayerType.Human;
      case PlayerTypeEnum.Bot:
        return PlayerType.Bot;
      case PlayerTypeEnum.Nation:
        return PlayerType.Nation;
      default:
        return PlayerType.Bot;
    }
  }
  isAlive(): boolean {
    return this.state.isAlive;
  }
  isPlayer(): this is PlayerView {
    return true;
  }
  numTilesOwned(): number {
    return this.state.tilesOwned;
  }
  allies(): PlayerView[] {
    return this.state.allies.map(
      (a) => this.game.playerBySmallID(a) as PlayerView,
    );
  }
  targets(): PlayerView[] {
    return this.state.targets.map(
      (id) => this.game.playerBySmallID(id) as PlayerView,
    );
  }
  gold(): Gold {
    // Engine Gold is bigint; renderer state stores number. Convert back at the
    // accessor for game-code that still expects bigint semantics.
    return BigInt(this.state.gold);
  }

  troops(): number {
    return this.state.troops;
  }

  totalUnitLevels(type: UnitType): number {
    return this.units(type)
      .filter((unit) => !unit.isUnderConstruction())
      .map((unit) => unit.level())
      .reduce((a, b) => a + b, 0);
  }

  isMe(): boolean {
    return this.smallID() === this.game.myPlayer()?.smallID();
  }

  isLobbyCreator(): boolean {
    return this.static.isLobbyCreator;
  }

  isAlliedWith(other: PlayerView): boolean {
    return this.state.allies.some((n) => other.smallID() === n);
  }

  isOnSameTeam(other: PlayerView): boolean {
    return this.static.team !== null && this.static.team === other.static.team;
  }

  isFriendly(other: PlayerView): boolean {
    return this.isAlliedWith(other) || this.isOnSameTeam(other);
  }

  isRequestingAllianceWith(other: PlayerView) {
    return this.state.outgoingAllianceRequests.some((id) => other.id() === id);
  }

  alliances(): AllianceView[] {
    return this.state.alliances;
  }

  hasEmbargoAgainst(other: PlayerView): boolean {
    return this.state.embargoes.includes(other.smallID());
  }

  hasEmbargo(other: PlayerView): boolean {
    return this.hasEmbargoAgainst(other) || other.hasEmbargoAgainst(this);
  }

  profile(): Promise<PlayerProfile> {
    return this.game.worker.playerProfile(this.smallID());
  }

  bestTransportShipSpawn(targetTile: TileRef): Promise<TileRef | false> {
    return this.game.worker.transportShipSpawn(this.id(), targetTile);
  }

  transitiveTargets(): PlayerView[] {
    const result: PlayerView[] = [];

    // Add own targets
    for (const id of this.state.targets) {
      result.push(this.game.playerBySmallID(id) as PlayerView);
    }

    // Add allies' targets
    for (const allyID of this.state.allies) {
      const ally = this.game.playerBySmallID(allyID) as PlayerView;
      for (const targetId of ally.state.targets) {
        result.push(this.game.playerBySmallID(targetId) as PlayerView);
      }
    }

    // Add teammates' targets
    const myTeam = this.static.team;
    if (myTeam !== null) {
      for (const p of this.game.playerViews()) {
        if (p !== this && p.static.team === myTeam) {
          for (const targetId of p.state.targets) {
            result.push(this.game.playerBySmallID(targetId) as PlayerView);
          }
        }
      }
    }

    return result;
  }

  hasTransitiveTarget(sid: number): boolean {
    if (this.state.targets.includes(sid)) return true;

    for (const allyID of this.state.allies) {
      const ally = this.game.playerBySmallID(allyID) as PlayerView;
      if (ally && ally.state.targets.includes(sid)) {
        return true;
      }
    }

    const myTeam = this.static.team;
    if (myTeam !== null) {
      for (const p of this.game.playerViews()) {
        if (
          p !== this &&
          p.static.team === myTeam &&
          p.state.targets.includes(sid)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  isTraitor(): boolean {
    return this.state.isTraitor;
  }
  getTraitorRemainingTicks(): number {
    return this.state.traitorRemainingTicks;
  }
  betrayals(): number {
    return this.state.betrayals;
  }
  outgoingEmojis(): EmojiMessage[] {
    return this.state.outgoingEmojis;
  }

  hasSpawned(): boolean {
    return this.state.hasSpawned;
  }
  isDisconnected(): boolean {
    return this.state.isDisconnected;
  }

  lastDeleteUnitTick(): Tick {
    return this.state.lastDeleteUnitTick;
  }

  deleteUnitCooldown(): number {
    return (
      Math.max(
        0,
        this.game.config().deleteUnitCooldown() -
          (this.game.ticks() + 1 - this.lastDeleteUnitTick()),
      ) / 10
    );
  }
}

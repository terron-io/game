/**
 * BuildPreviewController — build-ghost state machine + click-to-build flow.
 *
 * All rendering for the build ghost (outline, range circle, rail snap,
 * crosshair) lives in the WebGL renderer. This controller owns the state:
 * it queries buildables for the cursor tile, tracks whether the placement
 * is valid, and pushes preview data straight to the WebGL view.
 */

import {
  fortHqRangeMult,
  fortRangeMult,
  TERRON_MEDIA_MINISTRY_RADIUS_MULT,
  TERRON_MINISTRY_RADIUS,
  TERRON_OURSKY_SAM_RADIUS_MULT,
  TERRON_WALK_RATIO_MAX,
  walkZoneRadius,
} from "../../core/configuration/TerronTuning";
import { EventBus } from "../../core/EventBus";
import { wouldNukeBreakAlliance } from "../../core/execution/Util";
import {
  BuildableUnit,
  PlayerBuildableUnitType,
  Structures,
  ULTIMATE_REGISTRY,
  UnitType,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { GameView } from "../../core/game/GameView";
import { UserSettings } from "../../core/game/UserSettings";
import { castTroopsFor } from "../CastTroops";
import { Controller } from "../Controller";
import {
  ConfirmGhostStructureEvent,
  MouseMoveEvent,
  MouseDownEvent,
  MouseUpEvent,
} from "../InputHandler";
import { buildNukeTrajectory, GameView as WebGLGameView } from "../render/gl";
import type { SAMInfo } from "../render/gl/utils/NukeTrajectory";
import type { GhostPreviewData } from "../render/types";
import { TransformHandler } from "../TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../Transport";
import { UIState } from "../UIState";
import { ghostKindFor } from "../UnitVisuals";

/** True for nuke types (AtomBomb, HydrogenBomb): ghost is preserved after placement so user can place multiple or keep selection (Enter/key confirm). */
export function shouldPreserveGhostAfterBuild(unitType: UnitType): boolean {
  return (
    unitType === UnitType.AtomBomb ||
    unitType === UnitType.HydrogenBomb ||
    unitType === UnitType.WaterNuke // terron: «Реки вспять» — тоже ракета
  );
}

/**
 * terron 24.08: КАСТЫ, у которых гост липнет туда, куда ядро сдвинуло цель.
 * Пока только состав смерти: его цель — конечная точка маршрута, и промах по
 * нитке рельсов означал бы взрыв не там, куда целился игрок.
 */
const SNAP_CASTS: ReadonlySet<UnitType> = new Set([UnitType.DoomTrain]);

export class BuildPreviewController implements Controller {
  /** Current ghost (null when no build type is active). */
  private ghostUnit: { buildableUnit: BuildableUnit } | null = null;
  private readonly connectedAllySmallIds: Set<number> = new Set();
  private readonly mousePos = { x: 0, y: 0 };
  private lastGhostQueryAt: number = 0;
  private pendingConfirm: MouseUpEvent | null = null;

  // Buildable validation runs on the snapped tile under the cursor, but the
  // rendered icon follows the cursor at sub-tile precision so motion is
  // continuous instead of stepping tile-to-tile. cursorLoop re-emits each
  // frame with the current cursor world position.
  private lastGhostData: GhostPreviewData | null = null;

  // terron 24.08: «Перенос» Шагающего города — ДВУХФАЗНЫЙ каст (WALKING.md).
  // Первый клик запоминает центр зоны (круг от слайдера), второй шлёт интент
  // с обоими тайлами. null = ждём первый клик. Сбрасывается со сбросом госта.
  private transferZone: TileRef | null = null;
  /** Экранная точка, где схватили здание (drag-n-drop «Переноса»). */
  private transferDragFrom: { x: number; y: number } | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    public uiState: UIState,
    private transformHandler: TransformHandler,
    private view: WebGLGameView,
    private userSettings: UserSettings,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.moveGhost(e));
    this.eventBus.on(MouseUpEvent, (e) => this.requestConfirmStructure(e));
    // terron 25.08: ШАГАЮЩИЙ ГОРОД — drag-n-drop («дёргаю здание и дропаю на
    // новом месте, будто заново строю»). Нажатие при взведённом касте = «взял
    // здание», отпускание = «поставил». Обычный клик-клик тоже работает: если
    // палец/курсор не сдвинулся, срабатывает прежний двухфазный путь.
    this.eventBus.on(MouseDownEvent, (e) => this.onTransferPickup(e));
    this.eventBus.on(ConfirmGhostStructureEvent, () =>
      this.requestConfirmStructure(
        new MouseUpEvent(this.mousePos.x, this.mousePos.y),
      ),
    );

    // Re-emit the ghost each render frame at the cursor's current world
    // position (sub-tile). Buildable validation still runs on the snapped
    // tile in renderGhost(); this loop just keeps the icon under the cursor
    // so motion is continuous instead of stepping tile-to-tile.
    // The shader treats (tileX + 0.5, tileY + 0.5) as the icon center (so an
    // integer tile coord centers on that tile), so we subtract 0.5 here to
    // place the icon exactly under the cursor.
    const cursorLoop = () => {
      if (this.lastGhostData !== null) {
        const g = this.lastGhostData;
        // terron: если постройку сдвинет на другой тайл — рисуем ghost ТАМ (снап на integer-
        // тайл), а не под курсором. Иначе — плавно следуем за курсором. Спека: airport.md
        if (g.snapTileX !== null && g.snapTileY !== null) {
          this.view.updateGhostPreview({
            ...g,
            tileX: g.snapTileX,
            tileY: g.snapTileY,
          });
        } else {
          const w = this.transformHandler.screenToWorldCoordinatesFloat(
            this.mousePos.x,
            this.mousePos.y,
          );
          this.view.updateGhostPreview({
            ...g,
            tileX: w.x - 0.5,
            tileY: w.y - 0.5,
          });
        }
      }
      requestAnimationFrame(cursorLoop);
    };
    requestAnimationFrame(cursorLoop);
  }

  tick() {
    // Re-query buildables periodically (world state can change — tiles may
    // become buildable as troops/territory move).
    this.syncGhostState();
    this.renderGhost();
  }

  /**
   * Reconcile our internal ghost state with uiState.ghostStructure. Other
   * UI bits (build menu, key bindings) toggle uiState; we mirror it here.
   */
  private syncGhostState(): void {
    const target = this.uiState.ghostStructure;
    if (this.ghostUnit) {
      if (target === null) {
        this.removeGhostStructure();
      } else if (target !== this.ghostUnit.buildableUnit.type) {
        this.clearGhostStructure();
        this.createGhostStructure(target);
      }
    } else if (target !== null) {
      this.createGhostStructure(target);
    }
  }

  renderGhost() {
    if (!this.ghostUnit) return;

    const now = performance.now();
    if (now - this.lastGhostQueryAt < 50) return;
    this.lastGhostQueryAt = now;
    let tileRef: TileRef | undefined;
    const tile = this.transformHandler.screenToWorldCoordinates(
      this.mousePos.x,
      this.mousePos.y,
    );
    if (this.game.isValidCoord(tile.x, tile.y)) {
      tileRef = this.game.ref(tile.x, tile.y);
    }

    // Check if targeting an ally (for nuke warning visual)
    let targetingAlly = false;
    const myPlayer = this.game.myPlayer();
    const nukeType = this.ghostUnit.buildableUnit.type;
    if (
      tileRef &&
      myPlayer &&
      // terron 06.08: «Реки вспять» топит землю союзника так же необратимо —
      // предупреждение о попадании по своим ей тоже нужно.
      (nukeType === UnitType.AtomBomb ||
        nukeType === UnitType.HydrogenBomb ||
        nukeType === UnitType.WaterNuke)
    ) {
      this.connectedAllySmallIds.clear();
      const allies = myPlayer.allies();
      for (let i = 0; i < allies.length; i++) {
        const ally = allies[i];
        if (!ally.isDisconnected()) {
          this.connectedAllySmallIds.add(ally.smallID());
        }
      }

      if (this.connectedAllySmallIds.size > 0) {
        targetingAlly = wouldNukeBreakAlliance({
          game: this.game,
          targetTile: tileRef,
          magnitude: this.game.config().nukeMagnitudes(nukeType),
          allySmallIds: this.connectedAllySmallIds,
          threshold: this.game.config().nukeAllianceBreakThreshold(),
        });
      }
    }

    this.game
      ?.myPlayer()
      ?.buildables(tileRef, [this.ghostUnit?.buildableUnit.type])
      .then((buildables) => {
        if (!this.ghostUnit) {
          this.pendingConfirm = null;
          this.emitGhostPreview(tileRef, targetingAlly);
          return;
        }

        const unit = buildables.find(
          (u) => u.type === this.ghostUnit!.buildableUnit.type,
        );
        if (!unit) {
          Object.assign(this.ghostUnit.buildableUnit, {
            canBuild: false,
            canUpgrade: false,
          });
          this.pendingConfirm = null;
          this.emitGhostPreview(tileRef, targetingAlly);
          return;
        }

        this.ghostUnit.buildableUnit = unit;

        if (this.pendingConfirm !== null) {
          const ev = this.pendingConfirm;
          this.pendingConfirm = null;
          if (this.isGhostReadyForConfirm()) {
            this.createStructure(ev);
          }
        }

        this.emitGhostPreview(tileRef, targetingAlly);
      });
  }

  /**
   * Push a GhostPreviewData snapshot to the WebGL view (StructurePass /
   * RangeCirclePass / RailroadPass / CrosshairPass all read it). null when
   * the ghost can't be placed. smoothLoop interpolates displayed position
   * toward the target tile each frame.
   */
  private emitGhostPreview(
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
  ): void {
    const data = this.buildGhostPreviewData(tileRef, targetingAlly);
    if (data === null) {
      this.uiState.ghostPlacement = undefined;
      this.uiState.ghostBuildTile = undefined;
      this.lastGhostData = null;
      this.view.updateGhostPreview(null);
    } else {
      this.lastGhostData = data;
    }
    this.updateNukeTrajectoryPreview(tileRef);
  }

  /**
   * For AtomBomb / HydrogenBomb ghosts, push the Bezier trajectory preview
   * (closest player-owned silo → target, accounting for non-allied SAMs).
   * Cleared whenever the ghost isn't a nuke, has no target, or the player
   * has no silos.
   */
  private updateNukeTrajectoryPreview(tileRef: TileRef | undefined): void {
    if (!this.ghostUnit || tileRef === undefined) {
      this.view.updateNukeTrajectory(null);
      return;
    }
    const type = this.ghostUnit.buildableUnit.type;
    if (
      type !== UnitType.AtomBomb &&
      type !== UnitType.HydrogenBomb &&
      type !== UnitType.WaterNuke // terron: «Реки вспять» — рисуем траекторию
    ) {
      this.view.updateNukeTrajectory(null);
      return;
    }
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      this.view.updateNukeTrajectory(null);
      return;
    }

    // terron: ВАЖНО — выбор силоса должен совпадать с сервером (PlayerImpl.nukeSpawn):
    // только активные, НЕ на кулдауне и НЕ в постройке, и ближайший по MANHATTAN
    // (а не евклиду). Иначе превью рисует траекторию от одного силоса, а ракета
    // реально летит из другого → визуально мимо, нуки в трубу.
    const silos = myPlayer
      .units(UnitType.MissileSilo)
      .filter(
        (u) => u.isActive() && !u.isInCooldown() && !u.isUnderConstruction(),
      );
    if (silos.length === 0) {
      this.view.updateNukeTrajectory(null);
      return;
    }

    const dstX = this.game.x(tileRef);
    const dstY = this.game.y(tileRef);
    let bestSilo = silos[0];
    let bestDist = Infinity;
    for (const s of silos) {
      const sx = this.game.x(s.tile());
      const sy = this.game.y(s.tile());
      const d = Math.abs(sx - dstX) + Math.abs(sy - dstY);
      if (d < bestDist) {
        bestDist = d;
        bestSilo = s;
      }
    }
    const srcX = this.game.x(bestSilo.tile());
    const srcY = this.game.y(bestSilo.tile());

    // Non-allied SAMs threaten the trajectory; own + allied SAMs don't.
    const allyIds = new Set<number>();
    for (const a of myPlayer.allies()) allyIds.add(a.smallID());
    const sams: SAMInfo[] = [];
    // terron: «Небо наше» (реворк 21.08) — вражеский штаб сам ПВО ×5, его
    // купол тоже угрожает траектории.
    for (const s of this.game.units(UnitType.SAMLauncher, UnitType.OurSky)) {
      if (!s.isActive()) continue;
      const owner = s.owner();
      if (owner === myPlayer) continue;
      if (allyIds.has(owner.smallID())) continue;
      const r =
        this.game.config().samRange(s.level()) *
        (s.type() === UnitType.OurSky ? TERRON_OURSKY_SAM_RADIUS_MULT : 1);
      sams.push({
        x: this.game.x(s.tile()),
        y: this.game.y(s.tile()),
        rangeSq: r * r,
      });
    }

    this.view.updateNukeTrajectory(
      buildNukeTrajectory(
        srcX,
        srcY,
        dstX,
        dstY,
        this.game.height(),
        this.uiState.rocketDirectionUp,
        sams,
      ),
    );
  }

  private buildGhostPreviewData(
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
  ): GhostPreviewData | null {
    if (!this.ghostUnit) return null;
    if (tileRef === undefined) return null;
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return null;

    const u = this.ghostUnit.buildableUnit;

    // Upgrade-target tile — only when upgrading an existing unit.
    let upgradeTargetTile: number | null = null;
    // terron: уровень после апгрейда (для превью числа над зданием).
    let upgradeNewLevel: number | null = null;
    if (u.canUpgrade !== false) {
      const tgt = this.game.unit(u.canUpgrade);
      upgradeTargetTile = tgt?.tile() ?? null;
      upgradeNewLevel = tgt ? tgt.level() + 1 : null;
    }

    // Range circle: SAM placement preview shows targetable radius; nuke
    // previews show the outer blast radius at the target tile.
    let rangeRadius = 0;
    // terron 23.08: ГОСТ ЗОНЫ КАСТА — из ULTIMATE_REGISTRY, а не из ручного
    // switch ниже. Раньше у новых кастов госта просто не было: его нигде не
    // объявляли, и заметить пропажу можно было только в бою. Теперь радиус —
    // обязательное поле записи, и сюда он приезжает сам. 0 = зоны нет.
    for (const ult of ULTIMATE_REGISTRY) {
      if (ult.cast?.type === u.type && ult.cast.previewRadius > 0) {
        rangeRadius = ult.cast.previewRadius;
        break;
      }
      // terron 23.08: то же и для ШТАБА ульты. Число в реестре = круг при
      // наведении постройки; "dynamic" = радиус зависит от уровня/множителей и
      // считается ниже в switch. Один источник на ульту: либо число, либо
      // ветка, но не оба (сторож — тест «один источник круга»).
      if (ult.type === u.type && typeof ult.hqPreviewRadius === "number") {
        rangeRadius = ult.hqPreviewRadius;
        break;
      }
    }
    // terron: для фабрики — внутренний радиус «мёртвой зоны» (ближе него станции НЕ
    // связываются). Кольцо снаружи градиентом green→yellow (дальше = путь длиннее).
    let rangeMinRadius = 0;
    switch (u.type) {
      // terron 25.08: зоны у «Переноса» БОЛЬШЕ НЕТ (решение владельца «убери
      // радиус… по одному зданию переносить») — круга не рисуем ни в одной
      // фазе: берём здание под курсором и ставим его в точку.
      case UnitType.CityTransfer:
        rangeRadius = 0;
        break;
      case UnitType.SAMLauncher: {
        const level = this.resolveGhostRangeLevel(u) ?? 1;
        rangeRadius = this.game.config().samRange(level);
        break;
      }
      // terron: «Небо наше» (реворк 21.08) — штаб сам ПВО ×5: превью-круг
      // показывает будущий купол.
      case UnitType.OurSky:
        rangeRadius =
          this.game.config().samRange(1) * TERRON_OURSKY_SAM_RADIUS_MULT;
        break;
      // terron 06.08: водяная ракета «Реки вспять» — тот же круг радиуса, что у
      // обычной ядерки (радиус берётся из nukeMagnitudes по типу).
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.WaterNuke:
        rangeRadius = this.game.config().nukeMagnitudes(u.type).outer;
        break;
      case UnitType.Factory:
        rangeRadius = this.game.config().trainStationMaxRange();
        rangeMinRadius = this.game.config().trainStationMinRange();
        break;
      case UnitType.DefensePost: {
        // terron: у владельца Укреплений бункер бьёт дальше (растёт с ур. штаба).
        const hq = this.game
          .myPlayer()
          ?.units(UnitType.Fortifications)
          .find((f) => !f.isUnderConstruction());
        rangeRadius =
          this.game.config().defensePostRange() *
          (hq ? fortRangeMult(hq.level()) : 1);
        break;
      }
      // terron: ультимейты — Укрепления: штаб сам «бункер» с радиусом ×2 от
      // нормы. Превью-круг = этот радиус; при апгрейде — по НОВОМУ уровню.
      case UnitType.Fortifications:
        rangeRadius =
          this.game.config().defensePostRange() *
          fortHqRangeMult(u.canUpgrade !== false ? (upgradeNewLevel ?? 2) : 1);
        break;
      case UnitType.Airport: // terron: авиация — радиус покрытия при постройке
        rangeRadius = this.game.config().airportRange();
        break;
      // terron 23.08 (решение владельца «гост дефолтный оставь, крестик
      // атаки»): у ВЫСТРЕЛА ДОРЫ своего круга нет вовсе. Куда она достанет,
      // показывает облачко зоны доезда (SplitPreviewController), а под
      // курсором должен быть обычный прицел атаки — как у всех атак.
      // terron 07.08 (просьба владельца «радиус покажи юзеру»): у НЕФТЯНОЙ ВЫШКИ
      // круг означает не зону действия, а ЗАПРЕТ: внутри него не должно быть ни
      // одного тайла суши, иначе ставить нельзя. Показываем при наведении, чтобы
      // игрок видел, насколько далеко от берега надо уйти. TerronTuning §ВЫШКА.
      case UnitType.OilRig:
        rangeRadius = this.game.config().oilRigMinDistFromLand();
        break;
      // terron 06.08: аура Мин правды влита в МЕДИА (×2 радиуса).
      case UnitType.Media:
        rangeRadius =
          TERRON_MINISTRY_RADIUS * TERRON_MEDIA_MINISTRY_RADIUS_MULT;
        break;
    }
    let radiusTileX = this.game.x(tileRef);
    let radiusTileY = this.game.y(tileRef);
    if (
      rangeRadius > 0 &&
      u.canUpgrade !== false &&
      upgradeTargetTile !== null
    ) {
      radiusTileX = this.game.x(upgradeTargetTile);
      radiusTileY = this.game.y(upgradeTargetTile);
    }

    // terron: если движок сдвинет постройку на другой валидный тайл — снапим ghost туда,
    // чтобы игрок сразу видел, КУДА реально построится (авто-сдвиг). Спека: airport.md
    // ВАЖНО: магнит ТОЛЬКО для строящихся ЗДАНИЙ (Structures). Для кораблей и ядерок
    // (Warship/дрон/AtomBomb/HydrogenBomb/MIRV) снапа быть НЕ должно — цель строго под
    // курсором (иначе ломался таргет и пропадал радиус ядерки). Регресс-фикс 08.07.
    let snapTileX: number | null = null;
    let snapTileY: number | null = null;
    // terron 24.08 (решение владельца по составу смерти: «чтобы я точно знал,
    // где бахнет»): КАСТ тоже может магнититься, если ядро сдвинуло цель.
    // Список именной: у ядерок и кораблей снапа быть НЕ должно — там цель
    // строго под курсором (регресс-фикс 08.07).
    const snapCast = SNAP_CASTS.has(u.type);
    if (
      (Structures.has(u.type) || snapCast) &&
      u.canBuild !== false &&
      u.canBuild !== tileRef &&
      u.canUpgrade === false
    ) {
      snapTileX = this.game.x(u.canBuild);
      snapTileY = this.game.y(u.canBuild);
      if (rangeRadius > 0) {
        radiusTileX = snapTileX;
        radiusTileY = snapTileY;
      }
    }

    // terron 24.08: состояние госта для превью гост-рельсов (рисуются только
    // при НОВОЙ постройке; магнит-апгрейд и невалидное место — не рисуем).
    this.uiState.ghostPlacement =
      u.canUpgrade !== false
        ? "upgrade"
        : u.canBuild !== false
          ? "build"
          : "invalid";
    this.uiState.ghostBuildTile = u.canBuild !== false ? u.canBuild : undefined;

    const cost = u.cost;
    return {
      ghostType: u.type,
      // terron 23.08 (решение владельца «дефолтный гост — просто + прицел»):
      // крестик рисуем ТОЛЬКО когда у госта нет своей картинки. У строений
      // есть звезда с иконкой, у Блокады — контур флага, у ядерок и части
      // кастов — круг радиуса. Двух гостов об одном и том же быть не должно.
      crosshair: ghostKindFor(u.type, rangeRadius) === "crosshair",
      tileX: this.game.x(tileRef),
      tileY: this.game.y(tileRef),
      radiusTileX,
      radiusTileY,
      snapTileX,
      snapTileY,
      canBuild: u.canBuild !== false,
      canUpgrade: u.canUpgrade !== false,
      cost: Number(cost),
      showCost: this.userSettings.cursorCostLabel(),
      canAfford: myPlayer.gold() >= cost,
      ghostRailPaths: u.ghostRailPaths,
      overlappingRailroads: u.overlappingRailroads,
      ownerID: myPlayer.smallID(),
      upgradeTargetTile,
      upgradeNewLevel,
      rangeRadius,
      rangeMinRadius,
      // terron 24.08 (решение владельца: «если запрещаешь ставить — гостом
      // показывай, что сюда нельзя… гост серый или красный, а не как
      // обычный»): круг превью краснеет и когда ЯДРО ОТКАЗАЛО в постановке.
      // У зданий это давно так (красный тинт спрайта), у кастов с кругом —
      // не было, и «нельзя» выглядело ровно как «можно».
      rangeWarning: targetingAlly || u.canBuild === false,
    };
  }

  private isGhostReadyForConfirm(): boolean {
    if (!this.ghostUnit) return false;
    const bu = this.ghostUnit.buildableUnit;
    return bu.canBuild !== false || bu.canUpgrade !== false;
  }

  /**
   * terron 25.08: «взял здание» — нажатие при взведённом «Переносе». Точку
   * захвата запоминаем и как ЗОНУ (её читает сим: он берёт ближайшее своё
   * здание), и как экранную координату — чтобы на отпускании отличить ПЕРЕТАСК
   * от обычного клика.
   */
  private onTransferPickup(e: MouseDownEvent): void {
    if (this.uiState.ghostStructure !== UnitType.CityTransfer) return;
    if (this.transferZone !== null) return; // фаза 2 клик-клика — не мешаем
    this.transferDragFrom = { x: e.x, y: e.y };
    const tile = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (tile !== null && this.game.isValidCoord(tile.x, tile.y)) {
      this.transferZone = this.game.ref(tile.x, tile.y);
    }
  }

  private requestConfirmStructure(e: MouseUpEvent): void {
    // Перетаск: отпустили далеко от точки захвата → это дроп, ставим здание
    // сюда. Отпустили на месте → сбрасываем захват и работаем клик-кликом.
    if (
      this.uiState.ghostStructure === UnitType.CityTransfer &&
      this.transferDragFrom !== null
    ) {
      const moved =
        Math.abs(e.x - this.transferDragFrom.x) +
        Math.abs(e.y - this.transferDragFrom.y);
      this.transferDragFrom = null;
      if (moved < 12) this.transferZone = null; // клик, а не перетаск
    }
    if (!this.ghostUnit && !this.uiState.ghostStructure) return;
    if (this.isGhostReadyForConfirm()) {
      this.createStructure(e);
    } else {
      this.pendingConfirm = e;
    }
  }

  private createStructure(e: MouseUpEvent) {
    if (!this.ghostUnit) return;
    if (
      this.ghostUnit.buildableUnit.canBuild === false &&
      this.ghostUnit.buildableUnit.canUpgrade === false
    ) {
      this.removeGhostStructure();
      return;
    }
    const tile = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (this.ghostUnit.buildableUnit.canUpgrade !== false) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          this.ghostUnit.buildableUnit.canUpgrade,
          this.ghostUnit.buildableUnit.type,
        ),
      );
      this.removeGhostStructure();
    } else if (this.ghostUnit.buildableUnit.canBuild) {
      const unitType = this.ghostUnit.buildableUnit.type;
      const rocketDirectionUp =
        unitType === UnitType.AtomBomb || unitType === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;
      // terron: войска каста (Раскол/Передышка/Террор/Блокада) — ОДИН
      // источник castTroopsFor, общий с панелью строительства (24.08:
      // панель слала интент без troops, и флаг Раскола жался в минимум).
      const troops = castTroopsFor(unitType, this.game, this.uiState);
      // terron 24.08: «Перенос» Шагающего города — двухфазный (WALKING.md).
      // Первый клик фиксирует ЦЕНТР ЗОНЫ и интент НЕ шлёт: гост остаётся
      // взведённым (крестиком) и ждёт второй клик — точку назначения.
      if (unitType === UnitType.CityTransfer && this.transferZone === null) {
        this.transferZone = this.ghostUnit.buildableUnit.canBuild as TileRef;
        return;
      }
      const dstTile =
        unitType === UnitType.CityTransfer && this.transferZone !== null
          ? this.game.ref(tile.x, tile.y)
          : undefined;
      const intentTile =
        unitType === UnitType.CityTransfer && this.transferZone !== null
          ? this.transferZone
          : this.game.ref(tile.x, tile.y);
      this.eventBus.emit(
        new BuildUnitIntentEvent(
          unitType,
          intentTile,
          rocketDirectionUp,
          troops,
          dstTile,
        ),
      );
      if (!shouldPreserveGhostAfterBuild(unitType)) {
        this.removeGhostStructure();
      }
    } else {
      this.removeGhostStructure();
    }
  }

  private moveGhost(e: MouseMoveEvent) {
    this.mousePos.x = e.x;
    this.mousePos.y = e.y;
  }

  private createGhostStructure(type: PlayerBuildableUnitType | null) {
    if (type === null) return;
    if (this.game.myPlayer() === null) return;
    this.ghostUnit = {
      buildableUnit: {
        type,
        canBuild: false,
        canUpgrade: false,
        cost: 0n,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
    };
  }

  private clearGhostStructure() {
    this.pendingConfirm = null;
    this.ghostUnit = null;
    this.lastGhostData = null;
    this.transferZone = null; // terron: сброс фазы «Переноса» вместе с гостом
    this.uiState.ghostPlacement = undefined;
    this.uiState.ghostBuildTile = undefined;
    this.view.updateGhostPreview(null);
    this.view.updateNukeTrajectory(null);
  }

  private removeGhostStructure() {
    this.clearGhostStructure();
    this.uiState.ghostStructure = null;
  }

  private resolveGhostRangeLevel(
    buildableUnit: BuildableUnit,
  ): number | undefined {
    if (buildableUnit.type !== UnitType.SAMLauncher) return undefined;
    if (buildableUnit.canUpgrade !== false) {
      const existing = this.game.unit(buildableUnit.canUpgrade);
      if (existing) {
        return existing.level() + 1;
      } else {
        console.error("Failed to find existing SAMLauncher for upgrade");
      }
    }
    return 1;
  }
}

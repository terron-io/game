import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  PlayerProfile,
  PlayerType,
  Relation,
  Unit,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { AllianceView } from "../../../core/game/GameUpdates";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { flagImageUrl, flagImageUrlSync } from "../../Cosmetics";
import { unitMeta } from "../../UnitCatalog";
import {
  ContextMenuEvent,
  MouseMoveEvent,
  TouchEvent,
} from "../../InputHandler";
import { themeProvider } from "../../theme/ThemeProvider";
import { TransformHandler } from "../../TransformHandler";
import { unitNameI18nKey } from "../../UnitCatalog";
import {
  getTranslatedPlayerTeamLabel,
  renderDuration,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";
import {
  EMOJI_ICON_KIND,
  getFirstPlacePlayer,
  getPlayerIcons,
  IMAGE_ICON_KIND,
} from "../PlayerIcons";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import { CloseRadialMenuEvent } from "./RadialMenu";
import "./RelationSmiley";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
import { fuelSpeedMult } from "../../../core/game/FuelSpeed";
import type { Player } from "../../../core/game/Game";
import {
  NAME_TWO_LINE_THRESHOLD,
  splitClanName,
} from "../../../core/Util";
import { isDevSite } from "../../Utils";

/** terron: юниты, на которых распространяется пассив Топлива (FUEL.md). */
const FUEL_AFFECTED: UnitType[] = [
  UnitType.Warship,
  UnitType.TradeShip,
  UnitType.TransportShip,
  UnitType.Train,
];
const soldierIconAquarius = assetUrl("images/SoldierIconAquarius.svg");
const allianceIcon = assetUrl("images/AllianceIcon.svg");
const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const samLauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const soldierIcon = assetUrl("images/SoldierIcon.svg");

/**
 * terron: НАЗВАНИЕ ЮНИТА в ховер-карточке. Раньше сюда лился сырой `unit.type()`
 * — то есть значение enum'а ("Trade Ship"), и на русском сайте юниты оставались
 * английскими (претензия модерации GamePush «Юниты не локализованы»). Ключ берём
 * из общего реестра UnitCatalog; если названия в словаре нет или перевод не
 * загрузился (translateText возвращает сам ключ) — честно падаем на исходный тип,
 * чтобы карточка не осталась пустой.
 */
function unitDisplayName(type: UnitType | string): string {
  const key = unitNameI18nKey(type);
  if (key === undefined) return String(type);
  const translated = translateText(key);
  return translated === key ? String(type) : translated;
}

function euclideanDistWorld(
  coord: { x: number; y: number },
  tileRef: TileRef,
  game: GameView,
): number {
  const x = game.x(tileRef);
  const y = game.y(tileRef);
  const dx = coord.x - x;
  const dy = coord.y - y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distSortUnitWorld(coord: { x: number; y: number }, game: GameView) {
  return (a: Unit | UnitView, b: Unit | UnitView) => {
    const distA = euclideanDistWorld(coord, a.tile(), game);
    const distB = euclideanDistWorld(coord, b.tile(), game);
    return distA - distB;
  };
}

@customElement("player-info-overlay")
export class PlayerInfoOverlay extends LitElement implements Controller {
  @property({ type: Object })
  public game!: GameView;

  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public transform!: TransformHandler;

  @state()
  private player: PlayerView | null = null;

  @state()
  private playerProfile: PlayerProfile | null = null;

  @state()
  private unit: UnitView | null = null;

  @state()
  private _isInfoVisible: boolean = false;

  // terron 20.07: готовая ссылка на флаг наведённого игрока. Клан-флаг
  // (`clan:tag`) требует async-резолва — держим результат в состоянии и
  // перерисовываемся, когда он доедет. Ключ — сырое значение флага, чтобы не
  // показать чужой флаг при быстрой смене наведения.
  @state()
  private flagUrl: string | undefined = undefined;
  private flagUrlRef: string | null = null;

  @state()
  private spawnBarVisible = false;
  @state()
  private immunityBarVisible = false;

  private _isActive = false;

  private get barOffset(): number {
    return (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
  }

  private lastMouseUpdate = 0;

  init() {
    this.eventBus.on(MouseMoveEvent, (e: MouseMoveEvent) =>
      this.onMouseEvent(e),
    );
    this.eventBus.on(ContextMenuEvent, (e: ContextMenuEvent) =>
      this.maybeShow(e.x, e.y),
    );
    this.eventBus.on(TouchEvent, (e: TouchEvent) => this.maybeShow(e.x, e.y));
    this.eventBus.on(CloseRadialMenuEvent, () => this.hide());
    this.eventBus.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
    });
    this.eventBus.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
    });
    this._isActive = true;
  }

  private onMouseEvent(event: MouseMoveEvent) {
    const now = Date.now();
    if (now - this.lastMouseUpdate < 100) {
      return;
    }
    this.lastMouseUpdate = now;
    this.maybeShow(event.x, event.y);
  }

  public hide() {
    this.setVisible(false);
    this.unit = null;
    this.player = null;
  }

  /** Ссылка на флаг: готовое — сразу, `clan:`/`flag:` — когда доедет резолв. */
  private updateFlagUrl(flagRef: string | null) {
    this.flagUrlRef = flagRef;
    this.flagUrl = flagImageUrlSync(flagRef);
    if (flagRef === null || this.flagUrl !== undefined) return;
    void flagImageUrl(flagRef)
      .then((url) => {
        // наведение уже сменилось — чужой флаг не показываем
        if (this.flagUrlRef === flagRef) this.flagUrl = url;
      })
      .catch(() => {});
  }

  public maybeShow(x: number, y: number) {
    this.hide();
    // terron perf: в фазе спавна оверлей игрока не нужен — не сканируем юниты
    // на каждый ховер (units().filter по всем юнитам карты).
    if (this.game.inSpawnPhase()) return;
    const worldCoord = this.transform.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(worldCoord.x, worldCoord.y)) {
      return;
    }

    const tile = this.game.ref(worldCoord.x, worldCoord.y);
    if (!tile) return;

    // terron: туман войны — по закрытому тайлу ничего не показываем.
    if (!this.game.isTileVisibleUnderFog(tile)) return;

    const owner = this.game.owner(tile);

    if (owner && owner.isPlayer()) {
      this.player = owner as PlayerView;
      this.updateFlagUrl(this.player.cosmetics.flag ?? null);
      this.player.profile().then((p) => {
        this.playerProfile = p;
      });
      this.setVisible(true);
    } else if (!this.game.isLand(tile)) {
      const units = this.game
        .units(UnitType.Warship, UnitType.TradeShip, UnitType.TransportShip)
        .filter((u) => euclideanDistWorld(worldCoord, u.tile(), this.game) < 50)
        .sort(distSortUnitWorld(worldCoord, this.game));

      if (units.length > 0) {
        this.unit = units[0];
        this.setVisible(true);
      }
    }
  }

  tick() {
    // terron perf (Р2): скрытый оверлей не перерендериваем каждый тик.
    if (!this._isInfoVisible && !this.immunityBarVisible) return;
    this.requestUpdate();
  }

  setVisible(visible: boolean) {
    this._isInfoVisible = visible;
    this.requestUpdate();
  }

  private getPlayerNameColor(isFriendly: boolean): string {
    if (isFriendly) return "text-green-500";
    return "text-white";
  }

  private getRelationSmiley(
    player: PlayerView,
    myPlayer: PlayerView | null | undefined,
  ): TemplateResult | string {
    if (!myPlayer || myPlayer === player || player.type() !== PlayerType.Nation)
      return "";
    const relation =
      this.playerProfile?.relations[myPlayer.smallID()] ?? Relation.Neutral;
    if (relation === Relation.Neutral) return "";
    return html`<relation-smiley .relation=${relation}></relation-smiley>`;
  }

  private getRelationName(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return translateText("relation.hostile");
      case Relation.Distrustful:
        return translateText("relation.distrustful");
      case Relation.Neutral:
        return translateText("relation.neutral");
      case Relation.Friendly:
        return translateText("relation.friendly");
      default:
        return translateText("relation.default");
    }
  }

  private displayUnitCount(player: PlayerView, type: UnitType, icon: string) {
    return !this.game.config().isUnitDisabled(type)
      ? html`<div
          class="flex items-center justify-center gap-0.5 lg:gap-1 p-0.5 lg:p-1 border rounded-md border-gray-500 text-[10px] lg:text-xs w-9 lg:w-12 h-6 lg:h-7"
          translate="no"
        >
          <img
            src=${icon}
            class="w-3 h-3 lg:w-4 lg:h-4 object-contain shrink-0"
          />
          <span>${player.totalUnitLevels(type)}</span>
        </div>`
      : "";
  }

  private allianceExpirationText(alliance: AllianceView) {
    const { expiresAt } = alliance;
    const remainingTicks = expiresAt - this.game.ticks();
    let remainingSeconds = 0;
    if (remainingTicks > 0) {
      remainingSeconds = Math.max(0, Math.floor(remainingTicks / 10)); // 10 ticks per second
    }
    return renderDuration(remainingSeconds);
  }

  private renderPlayerNameIcons(player: PlayerView) {
    const firstPlace = getFirstPlacePlayer(this.game);
    const icons = getPlayerIcons({
      game: this.game,
      player,
      // Because we already show the alliance icon next to the alliance expiration timer, we don't need to show it a second time in this render
      includeAllianceIcon: false,
      firstPlace,
      alliancesDisabled: this.game.config().disableAlliances(),
    });

    if (icons.length === 0) {
      return html``;
    }

    return html`<span class="flex items-center gap-1 ml-1 shrink-0">
      ${icons.map((icon) =>
        icon.kind === EMOJI_ICON_KIND && icon.text
          ? html`<span class="text-sm shrink-0" translate="no"
              >${icon.text}</span
            >`
          : icon.kind === IMAGE_ICON_KIND && icon.src
            ? html`<img src=${icon.src} alt="" class="w-4 h-4 shrink-0" />`
            : html``,
      )}
    </span>`;
  }

  // terron (решение владельца 22.08): в ховере видно, КАКАЯ у игрока ульта —
  // иконка из UnitCatalog с подписью. Показываем только зафиксированный выбор.
  private renderUltBadge(player: PlayerView) {
    const t = player.ultimateChoice();
    if (t === null) return html``;
    const meta = unitMeta(t);
    if (!meta) return html``;
    const name = translateText("unit_type." + meta.key);
    return html`<span
      class="inline-flex items-center gap-1 px-1 py-0.5 rounded-sm border border-yellow-500/60 bg-yellow-600/20 text-[11px] font-bold text-yellow-200"
      title=${name}
    >
      <img src=${meta.icon} class="w-4 h-4" alt="" />
      <span class="hidden lg:inline">${name}</span>
    </span>`;
  }

  private renderPlayerInfo(player: PlayerView) {
    const myPlayer = this.game.myPlayer();
    const isFriendly = myPlayer?.isFriendly(player);
    const isAllied = myPlayer?.isAlliedWith(player);
    let allianceHtml: TemplateResult | null = null;
    const maxTroops = this.game.config().maxTroops(player);
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);
    const totalTroops = player.troops();
    // terron: Закрытая страна — цифры чужой закрытой страны скрыты («???»).
    const hidden = this.game.statsHiddenFor(player);
    const num = (v: number | bigint, troops = false): string =>
      hidden ? "???" : troops ? renderTroops(Number(v)) : renderNumber(v);

    if (isAllied) {
      const alliance = myPlayer
        ?.alliances()
        .find((alliance) => alliance.other === player.id());
      if (alliance !== undefined) {
        allianceHtml = html` <div
          class="flex items-center ml-auto mr-0 gap-1 text-sm font-bold leading-tight"
        >
          <img src=${allianceIcon} width="20" height="20" />
          ${this.allianceExpirationText(alliance)}
        </div>`;
      }
    }
    let playerType = "";
    switch (player.type()) {
      case PlayerType.Bot:
        playerType = translateText("player_type.bot");
        break;
      case PlayerType.Nation:
        playerType = translateText("player_type.nation");
        break;
      case PlayerType.Human:
        playerType = translateText("player_type.player");
        break;
    }
    const playerTeam = getTranslatedPlayerTeamLabel(player.team());

    return html`
      <div class="flex items-start gap-1 lg:gap-2 p-1 lg:p-1.5">
        <!-- Left: Gold & Troop bar -->
        <div class="flex flex-col gap-1 shrink-0 w-28 md:w-36">
          <div class="flex items-center gap-1">
            <div
              class="flex flex-1 items-center justify-center px-1 py-0.5 border rounded-md border-yellow-400 font-bold text-yellow-400 text-sm lg:gap-1"
              translate="no"
            >
              <img src=${goldCoinIcon} width="13" height="13" />
              <span class="px-0.5">${num(player.gold())}</span>
            </div>
            <div
              class="flex flex-1 flex-col items-center justify-center text-xs font-bold ${attackingTroops >
              0
                ? "text-aquarius"
                : "text-white/40"} drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
              translate="no"
            >
              <span class="flex items-center gap-px leading-none text-xs"
                ><img
                  class="w-2.5 h-2.5 inline-block ${attackingTroops > 0
                    ? ""
                    : "brightness-0 invert opacity-40"}"
                  src=${attackingTroops > 0 ? soldierIconAquarius : soldierIcon}
                  alt=""
                  aria-hidden="true"
                />↑</span
              >
              <span class="tabular-nums leading-none text-sm mt-0.5"
                >${num(attackingTroops, true)}</span
              >
            </div>
          </div>
          <div class="w-28 md:w-36" translate="no">
            ${this.renderTroopBar(
              totalTroops,
              attackingTroops,
              maxTroops,
              hidden,
            )}
          </div>
        </div>
        <!-- Right: Player identity + Units below -->
        <div class="flex flex-col justify-between self-stretch">
          <div
            class="flex items-center gap-2 font-bold text-sm lg:text-lg ${this.getPlayerNameColor(
              isFriendly ?? false,
            )}"
          >
            ${this.renderName(player.displayName())}
            ${this.renderUltBadge(player)}
            ${this.getRelationSmiley(player, myPlayer)}
            ${playerTeam !== "" && player.type() !== PlayerType.Bot
              ? html`<div class="flex flex-col leading-tight">
                  <span class="text-gray-400 text-xs font-normal"
                    >${playerType}</span
                  >
                  <span class="text-xs font-normal text-gray-400"
                    >[<span
                      style="color: ${themeProvider
                        .current()
                        .teamColor(player.team()!)
                        .toHex()}"
                      >${playerTeam}</span
                    >]</span
                  >
                </div>`
              : html`<span class="text-gray-400 text-xs font-normal"
                  >${playerType}</span
                >`}
            ${this.renderPlayerNameIcons(player)} ${allianceHtml ?? ""}
          </div>
          <div class="flex gap-0.5 lg:gap-1 items-center mt-0.5">
            ${this.displayUnitCount(player, UnitType.City, cityIcon)}
            ${this.displayUnitCount(player, UnitType.Factory, factoryIcon)}
            ${this.displayUnitCount(player, UnitType.Port, portIcon)}
            ${this.displayUnitCount(
              player,
              UnitType.MissileSilo,
              missileSiloIcon,
            )}
            ${this.displayUnitCount(
              player,
              UnitType.SAMLauncher,
              samLauncherIcon,
            )}
            ${this.displayUnitCount(player, UnitType.Warship, warshipIcon)}
          </div>
        </div>
      </div>
    `;
  }

  private renderTroopBar(
    totalTroops: number,
    attackingTroops: number,
    maxTroops: number,
    // terron: Закрытая страна — ни цифр, ни заливки (пропорция тоже утечка).
    hidden = false,
  ) {
    const num = (v: number): string => (hidden ? "???" : renderTroops(v));
    const base = Math.max(maxTroops, 1);
    const greenPercentRaw = hidden ? 0 : (totalTroops / base) * 100;
    const orangePercentRaw = hidden ? 0 : (attackingTroops / base) * 100;

    const greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    const orangePercent = Math.max(
      0,
      Math.min(100 - greenPercent, orangePercentRaw),
    );

    return html`
      <div
        class="w-full h-5 lg:h-6 border border-gray-600 rounded-md bg-gray-900/60 overflow-hidden relative"
      >
        <div class="h-full flex">
          ${greenPercent > 0
            ? html`<div
                class="h-full bg-sky-700 transition-[width] duration-200"
                style="width: ${greenPercent}%;"
              ></div>`
            : ""}
          ${orangePercent > 0
            ? html`<div
                class="h-full bg-malibu-blue transition-[width] duration-200"
                style="width: ${orangePercent}%;"
              ></div>`
            : ""}
        </div>
        <div
          class="absolute inset-0 flex items-center justify-between px-1.5 text-sm font-bold leading-none pointer-events-none"
          translate="no"
        >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${num(totalTroops)}</span
          >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${num(maxTroops)}</span
          >
        </div>
        <img
          src=${soldierIcon}
          alt=""
          aria-hidden="true"
          width="14"
          height="14"
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 brightness-0 invert drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] pointer-events-none"
        />
      </div>
    `;
  }

  /**
   * terron 23.08 (решение владельца): длинное имя с клан-тегом рисуем В ДВЕ
   * СТРОКИ — тег сверху, ник под ним. Браузер сам рвёт по последнему
   * влезающему пробелу, и выходило «[ZBS] Galactic / Empire»: тег склеивался
   * с половиной ника, а вторая половина висела отдельно.
   *
   * Короткое имя остаётся одной строкой — иначе плашка станет двухэтажной у
   * всех подряд.
   */
  private renderName(display: string) {
    // terron 23.08 (решение владельца «флаг тоже перед тегом клана, логичнее
    // будет»): флаг живёт ВНУТРИ имени, а не отдельной колонкой слева. При
    // двух строках он встаёт в первую, к тегу, — иначе центрировался по
    // высоте обеих и висел напротив пустоты между строк.
    const flag = this.flagUrl
      ? html`<img class="h-6 object-contain shrink-0" src=${this.flagUrl} />`
      : html``;
    const { clanTag, username } = splitClanName(display);
    if (clanTag === null || display.length <= NAME_TWO_LINE_THRESHOLD) {
      return html`<span class="flex items-center gap-2 min-w-0">
        ${flag}<span class="break-words">${display}</span>
      </span>`;
    }
    return html`<span class="flex flex-col leading-tight min-w-0">
      <span class="flex items-center gap-2">
        ${flag}<span class="text-xs font-normal opacity-80">[${clanTag}]</span>
      </span>
      <span class="break-words">${username}</span>
    </span>`;
  }

  private renderUnitInfo(unit: UnitView) {
    // terron 23.08 (репорт владельца «мои кораблики не пишутся, что они мои»):
    // ЗЕЛЁНЫМ красились и свои, и союзные юниты — по цвету не отличить своё от
    // чужого. Теперь у своего юнита есть явная подпись, а союзник — голубой.
    const me = this.game.myPlayer();
    const isMine = me !== null && unit.owner() === me;
    const isAlly = !isMine && (me?.isFriendly(unit.owner()) ?? false);
    const nameCls = isMine
      ? "text-green-400"
      : isAlly
        ? "text-sky-300"
        : "text-white";

    return html`
      <div class="p-2">
        <div class="font-bold mb-1 ${nameCls}">
          ${unit.owner().displayName()}${isMine
            ? html`<span class="ml-1 text-xs opacity-80"
                >· ${translateText("unit_info.yours")}</span
              >`
            : ""}
        </div>
        <div class="mt-1">
          <div class="text-sm opacity-80">${unitDisplayName(unit.type())}</div>
          ${unit.hasHealth()
            ? html` <div class="text-sm">
                ${translateText("unit_info.health")}: ${unit.health()}
              </div>`
            : ""}
          ${unit.type() === UnitType.TransportShip
            ? html`
                <div class="text-sm">
                  ${translateText("unit_info.troops")}:
                  ${renderTroops(unit.troops())}
                </div>
              `
            : ""}
          ${
            // terron 23.08: ДИАГНОСТИКА КОРАБЛЯ, ТОЛЬКО НА ДЕВЕ. Репорт
            // владельца «они просто сидят внутри здания» повторялся трижды, и
            // каждый раз я гадал, ПОЧЕМУ он стоит: патрулирует, состыкован,
            // уходит на ремонт или занят миссией блокады. Теперь это видно
            // сразу при наведении — на проде строки нет вовсе.
            isDevSite() && unit.type() === UnitType.Warship
              ? html`<div class="text-xs opacity-70 mt-1">
                  ${unit.warshipState().state}${unit.targetTile() !== undefined
                    ? " · цель есть"
                    : " · цели нет"}
                </div>`
              : ""
          }
          ${
            // terron 23.08: ТОПЛИВО — множитель скорости ЭТОГО юнита, только
            // на деве. Репорт владельца «для поездов эффект вижу, для торговых
            // кораблей нет» проверить было нечем: скорость на глаз не мерится,
            // а владелец лодки под курсором может быть вообще чужим (на его
            // скринах наведение было на ТОРГОВЫЙ КОРАБЛЬ СОСЕДА).
            isDevSite() && FUEL_AFFECTED.includes(unit.type())
              ? html`<div class="text-xs opacity-70 mt-1">
                  скорость ×${fuelSpeedMult(unit.owner() as unknown as Player)}
                </div>`
              : ""
          }
        </div>
      </div>
    `;
  }

  render() {
    if (!this._isActive) {
      return html``;
    }

    const containerClasses = this._isInfoVisible
      ? "opacity-100 visible"
      : "opacity-0 invisible pointer-events-none";

    return html`
      <div
        class="fixed top-[env(safe-area-inset-top)] left-0 right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[1001]"
        style="margin-top: ${this.barOffset}px;"
        @click=${() => this.hide()}
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg sm:rounded-b-lg shadow-lg text-white text-lg lg:text-base w-full sm:w-[500px] overflow-hidden ${containerClasses}"
        >
          ${this.player !== null ? this.renderPlayerInfo(this.player) : ""}
          ${this.unit !== null ? this.renderUnitInfo(this.unit) : ""}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}

import { assetUrl } from "../../../core/AssetUrls";
import { Config } from "../../../core/configuration/Config";
import {
  AllPlayers,
  BuildableAttacks,
  CAST_UNLOCKED_BY,
  PlayerActions,
  PlayerBuildableUnitType,
  Structures,
  Ultimates,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { Emoji, findClosestBy, flattenedEmojiTable } from "../../../core/Util";
import { refreshUltimates } from "../../Api";
import { actionCooldown, buttonShowsCooldown } from "../../Cooldowns";
import { isUltRollDisabled } from "../../DisabledUlts";
import { feedSecretDigit } from "../../SecretCodes";
import { toast } from "../../Toast";
import { BuildUnitIntentEvent } from "../../Transport";
import { UIState } from "../../UIState";
import {
  buildUltimateGrid,
  getUltRefreshOffset,
  bumpUltRefreshOffset,
  effectiveUltSeed,
  ultimateMeta,
  ultPrimeUnlocked,
  ultRefreshDisplayPrice,
} from "../../UltimateGrid";
import { syncUltRefreshOnce } from "../../UltRefreshSync";
import { ultLockedForMe } from "../../UltUnlocks";
import { ultStatLines, warshipIconFor } from "../../UnitCatalog";
import { L, renderNumber, translateText } from "../../Utils";
import { BUILD_DESC_PARAMS } from "../../WikiNumbers";
import { BuildItemDisplay, BuildMenu, flattenedBuildTable } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { donateOffByMode, donateOffText } from "./DonateGate";
import { EmojiTable } from "./EmojiTable";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerPanel } from "./PlayerPanel";
import { TooltipItem } from "./RadialMenu";

import { EventBus } from "../../../core/EventBus";
const allianceIcon = assetUrl("images/AllianceIconWhite.svg");
const boatIcon = assetUrl("images/BoatIconWhite.svg");
const airportIcon = assetUrl("images/AirportIconWhite.svg"); // terron: авиация
const buildIcon = assetUrl("images/BuildIconWhite.svg");
const chatIcon = assetUrl("images/ChatIconWhite.svg");
const donateGoldIcon = assetUrl("images/DonateGoldIconWhite.svg");
const donateTroopIcon = assetUrl("images/DonateTroopIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const infoIcon = assetUrl("images/InfoIcon.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");
const ultimateStarIcon = assetUrl("images/UltimateIconWhite.svg"); // terron: звезда-ульта
const targetIcon = assetUrl("images/TargetIconWhite.svg");
const traitorIcon = assetUrl("images/TraitorIconWhite.svg");
const xIcon = assetUrl("images/XIcon.svg");

export interface MenuElementParams {
  myPlayer: PlayerView;
  selected: PlayerView | null;
  tile: TileRef;
  playerActions: PlayerActions;
  game: GameView;
  buildMenu: BuildMenu;
  emojiTable: EmojiTable;
  playerActionHandler: PlayerActionHandler;
  playerPanel: PlayerPanel;
  chatIntegration: ChatIntegration;
  eventBus: EventBus;
  uiState?: UIState;
  closeMenu: () => void;
}

export interface MenuElement {
  id: string;
  name: string;
  displayed?: boolean | ((params: MenuElementParams) => boolean);
  color?: string | ((params: MenuElementParams) => string);
  icon?: string;
  text?: string;
  fontSize?: string;
  // terron: мелкая полупрозрачная подпись ПОД иконкой слайса (напр. цена постройки —
  // на мобиле tooltip не виден, а цену знать надо).
  subLabel?: (params: MenuElementParams) => string;
  tooltipItems?: TooltipItem[];
  tooltipKeys?: TooltipKey[];

  cooldown?: (params: MenuElementParams) => number;
  disabled: (params: MenuElementParams) => boolean;
  action?: (params: MenuElementParams) => void; // For leaf items that perform actions
  subMenu?: (params: MenuElementParams) => MenuElement[]; // For non-leaf items that open submenus

  // terron: УДЕРЖАНИЕ для активации (ульты): тап = показать описание (tooltip),
  // ЛОНГ-ТАП (заливка снизу вверх ~1.2с) = выполнить action. Обычные пункты — как есть.
  holdToActivate?: boolean;
  // terron: заголовок над под-радиалом (i18n-ключ), напр. «Выбери свою ульту».
  subMenuTitle?: string;
  // terron: ПОЛОСА-КНОПКА снизу под-радиала (на всю ширину колеса), видна пока
  // открыт ЭТОТ под-радиал. Тап → onTap; вернул true (сетка изменилась) →
  // перерисовать текущий уровень радиала. Напр. «ресет ультов за ЛТС».
  // ult-refresh-economy.
  cornerAction?: {
    label: (params: MenuElementParams) => string;
    onTap: (params: MenuElementParams) => Promise<boolean>;
  };

  /**
   * terron 23.08: ТАП по пункту (только у `holdToActivate`) — то есть нажатие,
   * которое НЕ активировало пункт, а лишь показало описание.
   *
   * Заведено под секретные коды (new-units/CUBE.md): на телефоне цифра кода —
   * это именно тап по сектору, и он обязан быть безопасным (ульту не строит,
   * колесо не закрывает). Обычным пунктам поле не нужно.
   */
  onTap?: (params: MenuElementParams) => boolean | void;

  /**
   * terron 23.08: НОМЕР СЛОТА, печатается мелким в углу сектора — ровно как
   * цифры на десктопной сетке. Без него код на телефоне набирается вслепую:
   * позиция и есть цифра. new-units/CUBE.md
   */
  slotDigit?: number;

  renderType?: string;

  timerFraction?: (params: MenuElementParams) => number; // 0..1, for arc timer overlay
}

export interface TooltipKey {
  key: string;
  className: string;
  params?: Record<string, string | number>;
}

export interface CenterButtonElement {
  disabled: (params: MenuElementParams) => boolean;
  action: (params: MenuElementParams) => void;
}

export const COLORS = {
  build: "#e6c74a",
  building: "#1e3a5f",
  boat: "#2a82c9",
  ally: "#4ade80",
  breakAlly: "#dc2626",
  breakAllyNoDebuff: "#d97706",
  delete: "#ef4444",
  info: "#475569",
  target: "#ef4444",
  attack: "#ef4444",
  infoDetails: "#7f8c8d",
  infoEmoji: "#fbbf24",
  trade: "#0891b2",
  embargo: "#7c3aed",
  tooltip: {
    cost: "#f59e0b",
    count: "#94a3b8",
  },
  chat: {
    default: "#6366f1",
    help: "#22c55e",
    attack: "#ef4444",
    defend: "#3b82f6",
    greet: "#f97316",
    misc: "#a855f7",
    warnings: "#fbbf24",
  },
};

export enum Slot {
  Info = "info",
  Boat = "boat",
  Build = "build",
  Attack = "attack",
  Ally = "ally",
  Back = "back",
  Delete = "delete",
}

function isFriendlyTarget(params: MenuElementParams): boolean {
  const selectedPlayer = params.selected;
  if (selectedPlayer === null) return false;
  const isFriendly = (selectedPlayer as PlayerView).isFriendly;
  if (typeof isFriendly !== "function") return false;
  return isFriendly.call(selectedPlayer, params.myPlayer);
}

function isDisconnectedTarget(params: MenuElementParams): boolean {
  const selectedPlayer = params.selected;
  if (selectedPlayer === null) return false;
  const isDisconnected = (selectedPlayer as PlayerView).isDisconnected;
  if (typeof isDisconnected !== "function") return false;
  return isDisconnected.call(selectedPlayer);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoChatElement: MenuElement = {
  id: "info_chat",
  name: "chat",
  disabled: () => false,
  color: COLORS.chat.default,
  icon: chatIcon,
  subMenu: (params: MenuElementParams) =>
    params.chatIntegration
      .createQuickChatMenu(params.selected!)
      .map((item) => ({
        ...item,
        action: item.action
          ? (_params: MenuElementParams) => item.action!(params)
          : undefined,
      })),
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyTargetElement: MenuElement = {
  id: "ally_target",
  name: "target",
  disabled: (params: MenuElementParams): boolean => {
    if (params.selected === null) return true;
    return !params.playerActions.interaction?.canTarget;
  },
  color: COLORS.target,
  icon: targetIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleTargetPlayer(params.selected!.id());
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyTradeElement: MenuElement = {
  id: "ally_trade",
  name: "trade",
  disabled: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  color: COLORS.trade,
  text: translateText("player_panel.start_trade"),
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "stop");
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyEmbargoElement: MenuElement = {
  id: "ally_embargo",
  name: "embargo",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  color: COLORS.embargo,
  text: translateText("player_panel.stop_trade"),
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "start");
    params.closeMenu();
  },
};

const allyRequestElement: MenuElement = {
  id: "ally_request",
  name: "request",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canSendAllianceRequest,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  color: COLORS.ally,
  icon: allianceIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleAllianceRequest(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
};

const allyExtendElement: MenuElement = {
  id: "ally_extend",
  name: "extend",
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.allianceInfo?.inExtensionWindow,
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.allianceInfo?.canExtend,
  color: COLORS.ally,
  icon: allianceIcon,
  action: (params: MenuElementParams) => {
    if (!params.playerActions?.interaction?.allianceInfo?.canExtend) return;
    params.playerActionHandler.handleExtendAlliance(params.selected!);
    params.closeMenu();
  },
  timerFraction: (params: MenuElementParams): number => {
    const interaction = params.playerActions?.interaction;
    if (!interaction?.allianceInfo) return 1;
    const remaining = Math.max(
      0,
      interaction.allianceInfo.expiresAt - params.game.ticks(),
    );
    const extensionWindow = Math.max(
      1,
      params.game.config().allianceExtensionPromptOffset(),
    );
    return Math.max(0, Math.min(1, remaining / extensionWindow));
  },
  renderType: "allyExtend",
};

const allyBreakElement: MenuElement = {
  id: "ally_break",
  name: "break",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canBreakAlliance,
  color: (params: MenuElementParams) =>
    params.selected?.isTraitor() || params.selected?.isDisconnected()
      ? COLORS.breakAllyNoDebuff
      : COLORS.breakAlly,
  icon: traitorIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleBreakAlliance(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyDonateGoldElement: MenuElement = {
  id: "ally_donate_gold",
  name: "donate gold",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canDonateGold,
  color: COLORS.ally,
  icon: donateGoldIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleDonateGold(params.selected!);
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyDonateTroopsElement: MenuElement = {
  id: "ally_donate_troops",
  name: "donate troops",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canDonateTroops,
  color: COLORS.ally,
  icon: donateTroopIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleDonateTroops(params.selected!);
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoPlayerElement: MenuElement = {
  id: "info_player",
  name: "player",
  disabled: () => false,
  color: COLORS.info,
  icon: infoIcon,
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoEmojiElement: MenuElement = {
  id: "info_emoji",
  name: "emoji",
  disabled: () => false,
  color: COLORS.infoEmoji,
  icon: emojiIcon,
  subMenu: (params: MenuElementParams) => {
    const emojiElements: MenuElement[] = [
      {
        id: "emoji_more",
        name: "more",
        disabled: () => false,
        color: COLORS.infoEmoji,
        icon: emojiIcon,
        action: (params: MenuElementParams) => {
          params.emojiTable.showTable((emoji) => {
            const targetPlayer =
              params.selected === params.game.myPlayer()
                ? AllPlayers
                : params.selected;
            params.playerActionHandler.handleEmoji(
              targetPlayer!,
              flattenedEmojiTable.indexOf(emoji as Emoji),
            );
            params.emojiTable.hideTable();
          });
        },
      },
    ];

    const emojiCount = 8;
    for (let i = 0; i < emojiCount; i++) {
      emojiElements.push({
        id: `emoji_${i}`,
        name: flattenedEmojiTable[i],
        text: flattenedEmojiTable[i],
        disabled: () => false,
        fontSize: "25px",
        action: (params: MenuElementParams) => {
          const targetPlayer =
            params.selected === params.game.myPlayer()
              ? AllPlayers
              : params.selected;
          params.playerActionHandler.handleEmoji(targetPlayer!, i);
          params.closeMenu();
        },
      });
    }

    return emojiElements;
  },
};

export const infoMenuElement: MenuElement = {
  id: Slot.Info,
  name: "info",
  disabled: (params: MenuElementParams) =>
    !params.selected || params.game.inSpawnPhase(),
  icon: infoIcon,
  color: COLORS.info,
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
};

function getAllEnabledUnits(
  myPlayer: boolean,
  config: Config,
): Set<PlayerBuildableUnitType> {
  const units: Set<PlayerBuildableUnitType> =
    new Set<PlayerBuildableUnitType>();

  const addIfEnabled = (unitType: PlayerBuildableUnitType) => {
    if (!config.isUnitDisabled(unitType)) {
      units.add(unitType);
    }
  };

  if (myPlayer) {
    Structures.types.forEach(addIfEnabled);
  } else {
    BuildableAttacks.types.forEach(addIfEnabled);
  }

  return units;
}

/**
 * Прятать ли пункт каста. Чистое правило — вынесено, чтобы его можно было
 * проверить тестом: на телефоне радиал ЕДИНСТВЕННЫЙ способ применить каст.
 *
 * ⚠️ РАЗЛИЧАЕМ ДВА РАЗНЫХ «ВЫКЛЮЧЕНО», и это главное здесь:
 *  • выключены ВСЕ ульты (режим лобби «без ульт») — тогда МИРВ обязан остаться
 *    доступным как обычная ядерка, это поведение оригинала;
 *  • выключена ОТДЕЛЬНАЯ ульта (рубильник `TERRON_DISABLED_ULTS` на проде) —
 *    тогда её каст прятать, иначе в меню висит кнопка ульты, которой в матче
 *    не существует. Раньше это не было видно только потому, что таких кастов
 *    вообще не было в ручной раскладке меню.
 */
export function castHiddenByGate(
  t: UnitType,
  isUnitDisabled: (u: UnitType) => boolean,
  hasUltimate: (u: UnitType) => boolean,
): boolean {
  const unlock = CAST_UNLOCKED_BY[t];
  if (unlock === undefined) return false;
  if (!isUnitDisabled(unlock.building)) {
    return !hasUltimate(unlock.building);
  }
  // Здание выключено: показываем каст, только если выключены ульты ЦЕЛИКОМ.
  const allUltsOff = Ultimates.types.every((u) => isUnitDisabled(u));
  return !allUltsOff;
}

function createMenuElements(
  params: MenuElementParams,
  filterType: "attack" | "build",
  elementIdPrefix: string,
): MenuElement[] {
  // terron 17.08: СТРОЙКА НА ВОДЕ (репорт владельца: «нефтевышку с телефона
  // не построить — в море в норме нет возможности что-то строить»). На таче
  // тап НИКОГДА не подтверждает ghost (см. InputHandler: «стройка на мобиле
  // идёт через радиал»), а радиалка строит В ТАПНУТЫЙ тайл и на воде вообще
  // не давала слота стройки. Теперь на воде подменю стройки = ОДИН ульт-слот
  // (его добавляет buildMenuElement ниже) — через него и строится вышка,
  // прямо в тапнутый океанский тайл. Сухопутный список на воде не показываем
  // (весь был бы серым шумом), корабль уже живёт в подменю АТАКИ.
  const isWaterTile =
    filterType === "build" && !params.game.isLand(params.tile);
  const unitTypes: Set<PlayerBuildableUnitType> = isWaterTile
    ? new Set()
    : getAllEnabledUnits(
        params.selected === params.myPlayer,
        params.game.config(),
      );

  // terron 07.08: КАСТ УЛЬТЫ виден в АТАКЕ только ПОСЛЕ постройки его здания —
  // как слот-своп на десктопе. Пара берётся из реестра CAST_UNLOCKED_BY (МИРВ ←
  // Ядерный завод, Раскол ← МЕДИА, водяная ракета ← Гидроузел), а не хардкодом:
  // раньше здесь был только МИРВ, поэтому Раскол и водяную ракету на мобиле
  // применить было НЕЛЬЗЯ вообще. Ульты выключены в лобби (здание disabled) →
  // гейт снят, каст показываем сразу (для МИРВ это поведение «как в оригинале»).
  const castHidden = (t: UnitType): boolean => {
    return castHiddenByGate(
      t,
      (u) => params.game.config().isUnitDisabled(u as never),
      (u) => params.myPlayer.hasUltimate(u),
    );
  };
  return flattenedBuildTable
    .filter(
      (item) =>
        unitTypes.has(item.unitType) &&
        (filterType === "attack"
          ? BuildableAttacks.has(item.unitType)
          : !BuildableAttacks.has(item.unitType)) &&
        !castHidden(item.unitType),
    )
    .map((item: BuildItemDisplay) => {
      return {
        id: `${elementIdPrefix}_${item.unitType}`,
        name: item.key
          ? item.key.replace("unit_type.", "")
          : item.unitType.toString(),
        disabled: (p: MenuElementParams) =>
          !p.buildMenu.canBuildOrUpgrade(item),
        color: (p: MenuElementParams) =>
          p.buildMenu.canBuildOrUpgrade(item)
            ? filterType === "attack"
              ? COLORS.attack
              : COLORS.building
            : COLORS.building,
        // terron: ПОДЛОДКИ — со штабом «Подводный флот» пункт «корабль» в
        // радиали показывает подлодку (то же, что кнопка 8 в баре).
        // terron 23.08: подмена юнита ультой — из реестра (`replaces`), а не
        // хардкодом на Подводный флот: с Пиратством тут пиратская лодка.
        icon:
          item.unitType === UnitType.Warship
            ? warshipIconFor(
                (t: UnitType) => params.myPlayer?.hasUltimate(t) ?? false,
              )
            : item.icon,
        // цена под иконкой (полупрозрачно) — видно без tooltip, важно на мобиле.
        // Убираем хвостовой ".0"/".00" (renderNumber даёт 3 знач. цифры: 50.0K → 50K,
        // 5.00M → 5M; но 1.50M → 1.5M и 750K не трогаем).
        // terron 23.08 — ЕДИНАЯ система откатов (client/Cooldowns.ts): пока
        // стволы перезаряжаются, под иконкой стоят секунды вместо цены, а
        // сектор сегмента показывает готовность. Тот же расчёт, что на карте
        // и в панели: откат обязан выглядеть откатом ВЕЗДЕ.
        subLabel: (p: MenuElementParams) => {
          const cd = actionCooldown(p.game, item.unitType as UnitType);
          if (cd !== null) return `${cd.seconds}\u2009c`;
          return renderNumber(p.buildMenu.cost(item)).replace(
            /\.(\d*?)0+([KMB]?)$/,
            (_m, f, s) => (f ? "." + f : "") + s,
          );
        },
        timerFraction: buttonShowsCooldown(item.unitType as UnitType)
          ? (p: MenuElementParams) => {
              const cd = actionCooldown(p.game, item.unitType as UnitType);
              return cd === null ? 1 : 1 - cd.frac;
            }
          : undefined,
        tooltipItems: [
          { text: translateText(item.key ?? ""), className: "title" },
          {
            text: translateText(item.description ?? ""),
            className: "description",
          },
          {
            text: `${renderNumber(params.buildMenu.cost(item))} ${translateText("player_panel.gold")}`,
            className: "cost",
          },
          item.countable
            ? { text: `${params.buildMenu.count(item)}x`, className: "count" }
            : null,
        ].filter(
          (tooltipItem): tooltipItem is TooltipItem => tooltipItem !== null,
        ),
        action: (params: MenuElementParams) => {
          const buildableUnit = params.playerActions.buildableUnits.find(
            (bu) => bu.type === item.unitType,
          );
          if (buildableUnit === undefined) {
            return;
          }
          if (params.buildMenu.canBuildOrUpgrade(item)) {
            params.buildMenu.sendBuildOrUpgrade(buildableUnit, params.tile);
          }
          params.closeMenu();
        },
      };
    });
}

// terron: авиация — воздушная высадка десанта с БЛИЖАЙШЕГО своего аэропорта в цель.
// Живёт в подменю «атака» (там, где ядерки/варшип). Доступно, если есть ≥1 аэропорт. airport.md
export const airAssaultMenuElement: MenuElement = {
  id: "attack_air_assault",
  name: "air_assault",
  disabled: (params: MenuElementParams) =>
    params.game.inSpawnPhase() ||
    params.myPlayer.units(UnitType.Airport).length === 0 ||
    // terron: авиация — гасим, если не хватает золота на следующую высадку.
    params.myPlayer.gold() < BigInt(params.myPlayer.nextAirAssaultCost()),
  icon: airportIcon,
  color: COLORS.attack,
  // terron: авиация — цена следующей высадки под иконкой (как у построек). airport.md
  subLabel: (params: MenuElementParams) =>
    renderNumber(params.myPlayer.nextAirAssaultCost()).replace(
      /\.(\d*?)0+([KMB]?)$/,
      (_m, f, s) => (f ? "." + f : "") + s,
    ),
  // terron: ленивые tooltipKeys (резолв при наведении), НЕ энергичный translateText:
  // модуль грузится раньше <lang-selector> → eager-вызов кэшировал бы сырой ключ.
  tooltipKeys: [
    { key: "air_assault.title", className: "title" },
    { key: "air_assault.desc", className: "description" },
  ],
  action: async (params: MenuElementParams) => {
    params.playerActionHandler.handleAirAssault(params.myPlayer, params.tile);
    params.closeMenu();
  },
};

// terron: МОБИЛА — «звезда» ульты в подменю Атаки И Стройки; обе открывают ОДИН
// набор ульт (сетка 3×3 из UltimateGrid, но радиалом). MIRV первый, нижний ряд —
// TERRON Prime (залочен). Действие — стандартный sendBuildOrUpgrade (как у любого
// строимого/атаки). Ядро само фиксирует ОДИН выбор на матч. new-units/ULTIMATES.md
function trimCost(n: string): string {
  return n.replace(/\.(\d*?)0+([KMB]?)$/, (_m, f, s) => (f ? "." + f : "") + s);
}

// terron: стат-строки ульты в тултип слайса (паритет с десктоп-баром UnitDisplay).
// Показываем ТОЛЬКО когда ульта реально работает (построена) — иначе в чузере
// висели бы нули. Ключи те же, что на баре (ultimate.stat_*).
function ultStatTooltipItems(
  params: MenuElementParams,
  t: UnitType,
): TooltipItem[] {
  if (!params.myPlayer.hasUltimate(t)) return [];
  // terron: какие счётчики — из реестра UnitCatalog (единый источник, паритет с баром).
  return ultStatLines(t, params.myPlayer.ultStats()).map(
    ({ i18nKey, value }) => ({
      text: translateText(i18nKey, { n: renderNumber(value) }),
      className: "cost",
    }),
  );
}

// terron: один слайс ульты для радиала. Используется И в звезде-чузере (hold=true:
// тап=описание, лонг-тап=выбрать), И как ПРЯМОЙ слайс выбранной ульты в стройке
// после фиксации выбора (hold=false: обычный тап строит/качает, как любой build-слайс;
// серый строго при исчерпании canBuild И canUpgrade). Раскол/МИРВ тут не участвуют —
// они BuildableAttacks, живут в подменю атаки. new-units/ULTIMATES.md
function ultRadialItem(
  params: MenuElementParams,
  t: UnitType,
  locked: boolean,
  hold: boolean,
  // terron: ЗАМКИ НА УЛЬТЫ — замок по владению (иначе считаем прем-замком).
  keyLocked = false,
  // terron 23.08: цифра секретного кода (позиция слота 1–9), null = не из сетки.
  digit: number | null = null,
): MenuElement {
  const meta = ultimateMeta(t);
  const findBU = (p: MenuElementParams) =>
    p.playerActions?.buildableUnits?.find((b) => b.type === t);
  return {
    id: `ultimate_${t}`,
    name: `ultimate_${meta.key}`,
    icon: meta.icon,
    holdToActivate: hold,
    // Тап = описание И цифра кода. Установка на телефоне — только удержание,
    // так что набор кода и реальную постройку не спутать. new-units/CUBE.md
    //
    // ⚠️ terron 23.08 (репорт «не могут с телефона»): код, сошедшийся В РАДИАЛЕ,
    // СРАЗУ СТРОИТ по тайлу, на котором радиал открыт. Гостом тут не обойтись:
    // на телефоне радиал занимает пол-экрана, армленный гост под ним не виден,
    // а «закрой меню и ткни ещё раз» — это ещё два действия после того, как
    // игрок уже угадал код.
    onTap:
      digit === null
        ? undefined
        : (p: MenuElementParams) => {
            const revealed = feedSecretDigit(digit);
            if (revealed === null) return false;
            p.eventBus.emit(new BuildUnitIntentEvent(revealed, p.tile));
            p.closeMenu();
            // true = «нажатие СЪЕДЕНО кодом»: пункт активировать нельзя, иначе
            // тем же кликом встанет обычная ульта слота (репорт владельца).
            return true;
          },
    slotDigit: digit ?? undefined,
    // terron: фон ульт-кнопок ЗОЛОТОЙ (как звезда), залоченные — тусклое золото.
    color: locked ? "#8a7a3a" : COLORS.build,
    disabled: (p: MenuElementParams) => {
      if (locked) return true;
      const bu = findBU(p);
      return !bu || (bu.canBuild === false && bu.canUpgrade === false);
    },
    subLabel: (p: MenuElementParams) => {
      if (locked) return keyLocked ? "🔒" : "PRIME";
      const bu = findBU(p);
      return bu ? trimCost(renderNumber(bu.cost)) : "";
    },
    tooltipItems: [
      { text: translateText("unit_type." + meta.key), className: "title" },
      {
        text: translateText("build_menu.desc." + meta.key, BUILD_DESC_PARAMS),
        className: "description",
      },
      locked
        ? {
            text: translateText(
              keyLocked ? "ultimate.locked_hint" : "ultimate.prime_locked",
            ),
            className: "description",
          }
        : null,
      ...ultStatTooltipItems(params, t),
    ].filter((x): x is TooltipItem => x !== null),
    action: (p: MenuElementParams) => {
      if (!locked) {
        const bu = findBU(p);
        if (bu && (bu.canBuild !== false || bu.canUpgrade !== false)) {
          p.buildMenu.sendBuildOrUpgrade(bu, p.tile);
        }
      }
      p.closeMenu();
    },
  };
}

function buildUltimateRadialItems(params: MenuElementParams): MenuElement[] {
  const pool = Ultimates.types.filter(
    (t) => !params.game.config().isUnitDisabled(t) && !isUltRollDisabled(t),
  );
  // Второй рубеж того же синка: обычно счётчик уже подтянут тиком панели
  // (UnitDisplay.tick), но если её на экране нет — спросит радиал. Колбэка
  // перерисовки тут нет намеренно: колесо рисуется по открытию, а ответ к
  // этому моменту давно пришёл (ульта стоит 5M — это не первая минута матча).
  syncUltRefreshOnce();
  const prime = ultPrimeUnlocked();
  // terron 24.08: замки аккаунта не занимают выбираемые слоты — та же
  // раскладка, что в десктопном чузере (и тот же порядок цифр кода).
  const grid = buildUltimateGrid(
    pool,
    effectiveUltSeed(params.myPlayer.smallID()),
    false,
    ultLockedForMe,
    prime,
    // terron 26.08: МИРВ прибит к слоту 0 только в БАЗОВОМ наборе — после
    // рефреша его в сетке нет вовсе (см. UltimateGrid).
    getUltRefreshOffset() === 0,
  );
  const items: MenuElement[] = [];
  // ⚠️ Цифра кода = ПОЗИЦИЯ В СЕТКЕ (grid), а не порядок видимых пунктов:
  // пустые слоты тут пропускаются, и по видимому порядку раскладка разъехалась
  // бы с десктопной. new-units/CUBE.md
  grid.forEach((slot, i) => {
    if (slot.type === null) return;
    const keyLocked = ultLockedForMe(slot.type);
    const locked = (slot.premium && !prime) || keyLocked;
    items.push(
      ultRadialItem(params, slot.type, locked, true, keyLocked, i + 1),
    );
  });
  return items;
}

// terron: доступные к постройке ульты (buildableUnit'ы) — для цены/активности звезды.
function ultBuildables(params: MenuElementParams) {
  const pool = Ultimates.types.filter(
    (t) => !params.game.config().isUnitDisabled(t) && !isUltRollDisabled(t),
  );
  return pool
    .map((t) => params.playerActions?.buildableUnits?.find((b) => b.type === t))
    .filter((b): b is NonNullable<typeof b> => b !== undefined);
}

export const ultimateMenuElement: MenuElement = {
  id: "ultimate",
  name: "radial_ultimate",
  // terron 22.07: звезда БОЛЬШЕ НЕ гаснет из-за нехватки золота. Раньше при
  // деньгах меньше цены ульты (5M) она была disabled → подменю не открывалось,
  // и посмотреть, что за ульты вообще есть, было НЕЛЬЗЯ — на мобиле это
  // единственный способ их увидеть. Само строительство по-прежнему невозможно:
  // каждый ульт-пункт внутри остаётся disabled, а его action проверяет canBuild.
  disabled: (params: MenuElementParams) => {
    if (params.game.inSpawnPhase()) return true;
    return buildUltimateRadialItems(params).length === 0;
  },
  icon: ultimateStarIcon,
  color: COLORS.build,
  // Заголовок над под-радиалом ульт («Выбери свою ульту»).
  subMenuTitle: "ultimate.chooser_title",
  // Цена под звездой — МИНИМАЛЬНАЯ среди доступных ульт + «+» (напр. «5M+»).
  subLabel: (params: MenuElementParams) => {
    const bs = ultBuildables(params);
    if (bs.length === 0) return "";
    let min = bs[0].cost;
    for (const b of bs) if (b.cost < min) min = b.cost;
    return trimCost(renderNumber(min)) + "+";
  },
  // tooltipKeys (не tooltipItems!) — переводятся при РЕНДЕРЕ, а не при загрузке
  // модуля (иначе i18n ещё не готов → сырой ключ «ultimate.chooser_title»).
  tooltipKeys: [{ key: "ultimate.chooser_title", className: "title" }],
  subMenu: (params: MenuElementParams) => buildUltimateRadialItems(params),
  // terron: РЕСЕТ УЛЬТ за ЛТС — кнопка в углу колеса (пока открыт чузер). Тап
  // перемешивает сетку заново (и разблокирует прем-ряд не-прему). Цена — сервер.
  cornerAction: {
    label: () =>
      L(
        `↻ Обновить ульты · ${ultRefreshDisplayPrice()} ЛТС`,
        `↻ Refresh ultimates · ${ultRefreshDisplayPrice()} LTS`,
      ),
    onTap: async (params: MenuElementParams) => {
      // terron 23.08: полоса под колесом — «ноль» секретного кода, ровно как
      // строка рефреша под десктопной сеткой. Рефреш при этом происходит
      // по-настоящему (решение владельца). new-units/CUBE.md
      //
      // Если код сошёлся ИМЕННО НУЛЁМ — строим тут же, как и по цифре сектора:
      // иначе поведение зависело бы от того, какая цифра оказалась последней.
      const revealedByZero = feedSecretDigit(0);
      if (revealedByZero !== null) {
        params.eventBus.emit(
          new BuildUnitIntentEvent(revealedByZero, params.tile),
        );
        params.closeMenu();
        return false;
      }
      const gid = (() => {
        try {
          return location.pathname.split("/game/")[1] ?? "";
        } catch {
          return "";
        }
      })();
      if (!gid) {
        toast(L("Рефреш недоступен", "Refresh unavailable"), "error");
        return false;
      }
      try {
        const res = await refreshUltimates(gid);
        if (res.ok) {
          bumpUltRefreshOffset();
          toast(
            L(
              `Ульты обновлены · остаток ${res.lts ?? "?"} ЛТС`,
              `Ultimates refreshed · ${res.lts ?? "?"} LTS left`,
            ),
            "success",
          );
          return true;
        }
        if (res.error === "insufficient") {
          toast(L("Не хватает ЛТС", "Not enough LTS"), "error");
        } else if (res.error === "unauthorized") {
          toast(L("Войдите в аккаунт", "Log in first"), "error");
        } else {
          toast(L("Ошибка рефреша", "Refresh failed"), "error");
        }
        return false;
      } catch {
        toast(L("Ошибка рефреша", "Refresh failed"), "error");
        return false;
      }
    },
  },
};

export const attackMenuElement: MenuElement = {
  id: Slot.Attack,
  name: "radial_attack",
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: swordIcon,
  color: COLORS.attack,

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    const items = createMenuElements(params, "attack", "attack");
    // terron: авиация — добавляем «высадку» в подменю атаки, если есть аэропорт
    if (params.myPlayer.units(UnitType.Airport).length > 0) {
      items.push(airAssaultMenuElement);
    }
    // terron: звезду-ульту из АТАКИ УБРАЛИ — выбор/постройка ульты живёт в
    // СТРОЙКЕ (звезда там). В атаке появляется только МИРВ и только ПОСЛЕ
    // постройки «Ядерного завода» (фильтр в createMenuElements). ULTIMATES.md
    return items;
  },
};

// terron 22.08: слот доната в FFA был просто СЕРЫМ без объяснения (на таче
// tooltip недоступен вовсе) — игроки читали это как поломку. Если донат
// закрыт НАСТРОЙКОЙ ЛОББИ, слот остаётся живым, а тап печатает причину.
// Кулдаун/спавн-фаза гасят слот как раньше.
const donateGoldOffByMode = (params: MenuElementParams): boolean =>
  params.selected !== null &&
  donateOffByMode(params.game, params.myPlayer, params.selected, "gold");

const donateGoldRadialElement: MenuElement = {
  id: Slot.Attack,
  name: "radial_donate_gold",
  disabled: (params: MenuElementParams) =>
    params.game.inSpawnPhase() ||
    (!params.playerActions?.interaction?.canDonateGold &&
      !donateGoldOffByMode(params)),
  icon: donateGoldIcon,
  color: "#f59e0b",
  action: (params: MenuElementParams) => {
    if (!params.selected) return;
    if (!params.playerActions?.interaction?.canDonateGold) {
      toast(donateOffText(), "info");
      params.closeMenu();
      return;
    }
    params.playerPanel.openSendGoldModal(
      params.playerActions,
      params.tile,
      params.selected,
    );
  },
};

export const deleteUnitElement: MenuElement = {
  id: Slot.Delete,
  name: "delete",
  cooldown: (params: MenuElementParams) => params.myPlayer.deleteUnitCooldown(),
  disabled: (params: MenuElementParams) => {
    const tileOwner = params.game.owner(params.tile);
    const isLand = params.game.isLand(params.tile);

    if (!tileOwner.isPlayer() || tileOwner.id() !== params.myPlayer.id()) {
      return true;
    }

    if (!isLand) {
      return true;
    }

    if (params.game.inSpawnPhase()) {
      return true;
    }

    if (params.myPlayer.deleteUnitCooldown() > 0) {
      return true;
    }

    const DELETE_SELECTION_RADIUS = 5;
    const myUnits = params.myPlayer
      .units()
      .filter(
        (unit) =>
          !unit.isUnderConstruction() &&
          unit.markedForDeletion() === false &&
          params.game.manhattanDist(unit.tile(), params.tile) <=
            DELETE_SELECTION_RADIUS,
      );

    return myUnits.length === 0;
  },
  icon: xIcon,
  color: COLORS.delete,
  tooltipKeys: [
    {
      key: "radial_menu.delete_unit_title",
      className: "title",
    },
    {
      key: "radial_menu.delete_unit_description",
      className: "description",
    },
  ],
  action: (params: MenuElementParams) => {
    const DELETE_SELECTION_RADIUS = 5;
    const myUnits = params.myPlayer
      .units()
      .filter(
        (unit) =>
          params.game.manhattanDist(unit.tile(), params.tile) <=
          DELETE_SELECTION_RADIUS,
      );

    const closestUnit = findClosestBy(myUnits, (unit) =>
      params.game.manhattanDist(unit.tile(), params.tile),
    );
    if (closestUnit) {
      params.playerActionHandler.handleDeleteUnit(closestUnit.id());
    }

    params.closeMenu();
  },
};

export const buildMenuElement: MenuElement = {
  id: Slot.Build,
  name: "build",
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: buildIcon,
  color: COLORS.build,

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    const items = createMenuElements(params, "build", "build");
    // terron: ульта-слот в стройке. ДО фиксации выбора — звезда-чузер (выбери ульту).
    // ПОСЛЕ (первое здание построено → ultimateChoice фиксирован) — ПРЯМОЙ слайс
    // выбранной ульты: её иконка + обычный тап строит/качает (второй храм, уровень
    // форта, вторая мин.правды), серый строго при достижении лимита. Раскол/МИРВ
    // не тут (BuildableAttacks → атака). new-units/ULTIMATES.md
    const choice = params.myPlayer.ultimateChoice();
    if (
      choice !== null &&
      Ultimates.has(choice) &&
      !params.game.config().isUnitDisabled(choice)
    ) {
      items.push(ultRadialItem(params, choice, false, false));
    } else {
      items.push(ultimateMenuElement);
    }
    return items;
  },
};

export const boatMenuElement: MenuElement = {
  id: Slot.Boat,
  name: "boat",
  disabled: (params: MenuElementParams) =>
    !params.playerActions.buildableUnits.some(
      (unit) => unit.type === UnitType.TransportShip && unit.canBuild,
    ),
  // когда все лодки в пути — таймер (сек) до освобождения ближайшей под иконкой
  cooldown: (params: MenuElementParams) => params.myPlayer.boatFreeCooldown(),
  icon: boatIcon,
  color: COLORS.boat,

  action: async (params: MenuElementParams) => {
    params.playerActionHandler.handleBoatAttack(params.myPlayer, params.tile);

    params.closeMenu();
  },
};

export const centerButtonElement: CenterButtonElement = {
  disabled: (params: MenuElementParams): boolean => {
    const tileOwner = params.game.owner(params.tile);
    const isLand = params.game.isLand(params.tile);
    if (!isLand) {
      return true;
    }
    if (params.game.inSpawnPhase()) {
      if (params.game.config().isRandomSpawn()) {
        return true;
      }
      if (tileOwner.isPlayer()) {
        return true;
      }
      return false;
    }

    if (isFriendlyTarget(params) && !isDisconnectedTarget(params)) {
      return !params.playerActions.interaction?.canDonateTroops;
    }

    return !params.playerActions.canAttack;
  },
  action: (params: MenuElementParams) => {
    if (params.game.inSpawnPhase()) {
      params.playerActionHandler.handleSpawn(params.tile);
    } else {
      if (isFriendlyTarget(params) && !isDisconnectedTarget(params)) {
        const selectedPlayer = params.selected as PlayerView;
        const ratio = params.uiState?.attackRatio ?? 1;
        const troopsToDonate = Math.floor(ratio * params.myPlayer.troops());
        if (troopsToDonate > 0) {
          params.playerActionHandler.handleDonateTroops(
            selectedPlayer,
            troopsToDonate,
          );
        }
      } else {
        params.playerActionHandler.handleAttack(
          params.myPlayer,
          params.selected?.id() ?? null,
        );
      }
    }
    params.closeMenu();
  },
};

export const rootMenuElement: MenuElement = {
  id: "root",
  name: "root",
  disabled: () => false,
  icon: infoIcon,
  color: COLORS.info,
  subMenu: (params: MenuElementParams) => {
    const isAllied = params.selected?.isAlliedWith(params.myPlayer);
    const isDisconnected = isDisconnectedTarget(params);

    const tileOwner = params.game.owner(params.tile);
    const isOwnTerritory =
      tileOwner.isPlayer() &&
      (tileOwner as PlayerView).id() === params.myPlayer.id();

    const inExtensionWindow =
      params.playerActions.interaction?.allianceInfo?.inExtensionWindow;

    const menuItems: (MenuElement | null)[] = [
      infoMenuElement,
      ...(isOwnTerritory
        ? [deleteUnitElement, allyRequestElement, buildMenuElement]
        : [
            isAllied && !isDisconnected ? allyBreakElement : boatMenuElement,
            inExtensionWindow ? allyExtendElement : allyRequestElement,
            isFriendlyTarget(params) && !isDisconnected
              ? donateGoldRadialElement
              : attackMenuElement,
            // terron 17.08: на воде слот «строить» — иначе с телефона нельзя
            // поставить нефтевышку: на таче ghost-постановка мертва (см.
            // InputHandler), а радиалка строит в тапнутый тайл. selected ===
            // null проверяем ПЕРВЫМ: у воды владельца нет, а на чужой
            // территории слот не появляется (и isLand там даже не зовётся).
            ...(params.selected === null && !params.game.isLand(params.tile)
              ? [buildMenuElement]
              : []),
          ]),
    ];

    return menuItems.filter((item): item is MenuElement => item !== null);
  },
};

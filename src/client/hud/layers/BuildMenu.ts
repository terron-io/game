import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  BuildableUnit,
  Gold,
  PlayerBuildableUnitType,
  ULTIMATE_REGISTRY,
  UnitType,
  VISIBLE_BUILD_TYPES,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { castTroopsFor } from "../../CastTroops";
import { Controller } from "../../Controller";
import {
  CloseViewEvent,
  MouseDownEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
} from "../../InputHandler";
import { TransformHandler } from "../../TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { renderNumber } from "../../Utils";
import { tutBlocked, tutHighlighted } from "../tutHighlight";
const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const splitIcon = assetUrl("images/SplitIconWhite.svg"); // terron: каст МЕДИА
const waterNukeIcon = assetUrl("images/RiversBackIconWhite.svg"); // terron: каст гидроузла
const satStrikeIcon = assetUrl("images/OurSkyIconWhite.svg"); // terron: каст Неба нашего
const blockadeIcon = assetUrl("images/PiracyIconWhite.svg"); // terron: каст Пиратства
const respiteIcon = assetUrl("images/TruceIconWhite.svg"); // terron: каст Гордости
const olympicsIcon = assetUrl("images/OlympicsIconWhite.svg"); // terron: каст Стадиона
const terrorIcon = assetUrl("images/TerrorIconWhite.svg"); // terron: каст Фанатизма
const pactIcon = assetUrl("images/PactIconWhite.svg"); // terron: каст Дворца наций
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const mirvIcon = assetUrl("images/MIRVIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const hydrogenBombIcon = assetUrl("images/MushroomCloudIconWhite.svg");
const atomBombIcon = assetUrl("images/NukeIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const airportIcon = assetUrl("images/AirportIconWhite.svg"); // terron: авиация
const droneIcon = assetUrl("images/DroneIconWhite.svg"); // terron: авиация
const samlauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const shieldIcon = assetUrl("images/ShieldIconWhite.svg");

export interface BuildItemDisplay {
  unitType: PlayerBuildableUnitType;
  icon: string;
  description?: string;
  key?: string;
  countable?: boolean;
}

export const buildTable: BuildItemDisplay[][] = [
  [
    {
      unitType: UnitType.AtomBomb,
      icon: atomBombIcon,
      description: "build_menu.desc.atom_bomb",
      key: "unit_type.atom_bomb",
      countable: false,
    },
    {
      unitType: UnitType.MIRV,
      icon: mirvIcon,
      description: "build_menu.desc.mirv",
      key: "unit_type.mirv",
      countable: false,
    },
    {
      unitType: UnitType.HydrogenBomb,
      icon: hydrogenBombIcon,
      description: "build_menu.desc.hydrogen_bomb",
      key: "unit_type.hydrogen_bomb",
      countable: false,
    },
    // terron 07.08: КАСТЫ УЛЬТ (Раскол ← МЕДИА, водяная ракета ← Гидроузел) —
    // ОБЯЗАНЫ быть здесь. Радиальное меню атак строится из ЭТОЙ таблицы, а на
    // мобиле радиаль — единственный интерфейс: без записи каст применить НЕЛЬЗЯ
    // вообще (репорт тестера 07.08: «Раскола в мобильной менюшке атаки нет»).
    // Показ гейтится по CAST_UNLOCKED_BY в RadialMenuElements — пока здание не
    // построено, пункт скрыт.
    {
      unitType: UnitType.Split,
      icon: splitIcon,
      description: "build_menu.desc.split",
      key: "unit_type.split",
      countable: false,
    },
    {
      unitType: UnitType.WaterNuke,
      icon: waterNukeIcon,
      description: "build_menu.desc.water_nuke",
      key: "unit_type.water_nuke",
      countable: false,
    },
    // terron 25.08: ТЕРРАФОРМИНГ — две другие ракеты ульты. На мобиле радиал
    // единственный интерфейс: без записи здесь каст применить НЕЛЬЗЯ вообще.
    {
      // terron: «Сбить спутники» — каст Неба нашего (реворк 21.08): ставит
      // ракету-носитель на своей земле, 60с телеграф → блэкаут всем врагам.
      unitType: UnitType.SatelliteStrike,
      icon: satStrikeIcon,
      description: "build_menu.desc.satellite_strike",
      key: "unit_type.satellite_strike",
      countable: false,
    },
    {
      // terron: «Блокада» — каст Пиратства: точка в океане → 3 мин зоны паники
      // для чужой торговли (радиус как у атомки).
      unitType: UnitType.Blockade,
      icon: blockadeIcon,
      description: "build_menu.desc.blockade",
      key: "unit_type.blockade",
      countable: false,
    },
    {
      // terron: «Передышка» — каст Гордости: мир вокруг кастера, длительность
      // от доли сожжённых войск (слайдер атаки).
      unitType: UnitType.Respite,
      icon: respiteIcon,
      description: "build_menu.desc.respite",
      key: "unit_type.respite",
      countable: false,
    },
    {
      // terron: «Олимпийские игры» — каст Стадиона: мир во всём мире на минуту.
      unitType: UnitType.Truce,
      icon: olympicsIcon,
      description: "build_menu.desc.truce",
      key: "unit_type.truce",
      countable: false,
    },
    {
      // terron: «Террор» — каст Фанатизма: цель — чужая страна.
      unitType: UnitType.Terror,
      icon: terrorIcon,
      description: "build_menu.desc.terror",
      key: "unit_type.terror",
      countable: false,
    },
    {
      // terron: «Пакт» — каст Дворца наций: цель — живой игрок.
      unitType: UnitType.Pact,
      icon: pactIcon,
      description: "build_menu.desc.pact",
      key: "unit_type.pact",
      countable: false,
    },
    {
      // terron: авиация — дрон-камикадзе (мини-ядерка с ближайшего аэропорта)
      unitType: UnitType.SuicideDrone,
      icon: droneIcon,
      description: "build_menu.desc.suicide_drone",
      key: "unit_type.suicide_drone",
      countable: false,
    },
    {
      unitType: UnitType.Warship,
      icon: warshipIcon,
      description: "build_menu.desc.warship",
      key: "unit_type.warship",
      countable: true,
    },
    {
      // terron: авиация — аэропорт. Спека: airport.md
      unitType: UnitType.Airport,
      icon: airportIcon,
      description: "build_menu.desc.airport",
      key: "unit_type.airport",
      countable: true,
    },
    {
      unitType: UnitType.MissileSilo,
      icon: missileSiloIcon,
      description: "build_menu.desc.missile_silo",
      key: "unit_type.missile_silo",
      countable: true,
    },
    {
      unitType: UnitType.SAMLauncher,
      icon: samlauncherIcon,
      description: "build_menu.desc.sam_launcher",
      key: "unit_type.sam_launcher",
      countable: true,
    },
    {
      unitType: UnitType.DefensePost,
      icon: shieldIcon,
      description: "build_menu.desc.defense_post",
      key: "unit_type.defense_post",
      countable: true,
    },
    {
      unitType: UnitType.City,
      icon: cityIcon,
      description: "build_menu.desc.city",
      key: "unit_type.city",
      countable: true,
    },
    {
      unitType: UnitType.Factory,
      icon: factoryIcon,
      description: "build_menu.desc.factory",
      key: "unit_type.factory",
      countable: true,
    },
    {
      unitType: UnitType.Port,
      icon: portIcon,
      description: "build_menu.desc.port",
      key: "unit_type.port",
      countable: true,
    },
  ],
];

// ═══════════════════════════════════════════════════════════════════════════
// terron 27.08: КАСТЫ УЛЬТ ДОБИРАЮТСЯ ИЗ РЕЕСТРА, А НЕ ПИШУТСЯ РУКАМИ.
//
// ⚠️ РЕПОРТ С ПРОДА: «с Доры на мобилке стрелять не смог — кнопки нет».
// Причина: радиальное меню (единственный способ применить каст с телефона)
// строится из `flattenedBuildTable`, а `buildTable` выше — РУЧНАЯ раскладка.
// Каждый новый каст надо было вписать туда отдельной строкой, и конструктор
// ульт про этот список не знал. Забыли шесть: выстрел Доры, состав смерти,
// перенос города, травля Зелёных, рекультивация АЭС, индустриальная революция —
// все они на телефоне не применялись ВООБЩЕ, при живой кнопке на десктопе
// (там панель берёт пункты из UNIT_CATALOG, то есть из реестра).
//
// Теперь недостающее выводится: завёл каст в ULTIMATE_REGISTRY — он появился
// на всех поверхностях ввода сам. Сторож — tests/client/CastOnAllInputs.test.ts.
//
// ⚠️ Ручную `buildTable` НЕ трогаем: это РАСКЛАДКА десктопного меню (ряды и
// порядок), а не каталог. Выведенные касты дописываются только в плоский
// список, который читает радиал.
const MANUAL_BUILD_TYPES: ReadonlySet<UnitType> = new Set(
  buildTable.flat().map((i) => i.unitType as UnitType),
);

// ⚠️ ПРОД-ВЕРСИЯ: здесь `u.cast`, а не `ultCasts(u)`, потому что функции
// `ultCasts` (и дополнительных кастов `extraCasts`) в прод-ядре ещё нет —
// они приезжают вместе с Терраформингом, который пока дев-онли. На проде у
// ульты ровно один каст, так что список полный. ⚠️ КОГДА ТЕРРАФОРМИНГ УЕДЕТ
// НА ПРОД, этот файл обязан приехать из дев-дерева ЦЕЛИКОМ — иначе
// дополнительные касты снова не попадут в радиал, то есть вернётся ровно тот
// баг, который здесь и чинится.
const DERIVED_CAST_ITEMS: BuildItemDisplay[] = ULTIMATE_REGISTRY.flatMap((u) =>
  u.cast === undefined ? [] : [u.cast],
)
  .filter((c) => !MANUAL_BUILD_TYPES.has(c.type))
  .map((c) => ({
    unitType: c.type as PlayerBuildableUnitType,
    icon: assetUrl(`images/${c.icon}`),
    description: `build_menu.desc.${c.key}`,
    key: `unit_type.${c.key}`,
    countable: false,
  }));

export const flattenedBuildTable = [
  ...buildTable.flat(),
  ...DERIVED_CAST_ITEMS,
];

@customElement("build-menu")
export class BuildMenu extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private clickedTile: TileRef;
  public playerBuildables: BuildableUnit[] | null = null;
  private filteredBuildTable: BuildItemDisplay[][] = buildTable;
  public transformHandler: TransformHandler;

  init() {
    this.eventBus.on(ShowBuildMenuEvent, (e) => {
      if (!this.game.myPlayer()?.isAlive()) {
        return;
      }
      if (!this._hidden) {
        // Players sometimes hold control while building a unit,
        // so if the menu is already open, ignore the event.
        return;
      }
      const clickedCell = this.transformHandler.screenToWorldCoordinates(
        e.x,
        e.y,
      );
      if (!this.game.isValidCoord(clickedCell.x, clickedCell.y)) {
        return;
      }
      const tile = this.game.ref(clickedCell.x, clickedCell.y);
      this.showMenu(tile);
    });
    this.eventBus.on(CloseViewEvent, () => this.hideMenu());
    this.eventBus.on(ShowEmojiMenuEvent, () => this.hideMenu());
    this.eventBus.on(MouseDownEvent, () => this.hideMenu());
  }

  tick() {
    if (!this._hidden) {
      this.refresh();
    }
  }

  static styles = css`
    :host {
      display: block;
    }
    /* terron: подсветка кнопки города во время обучения (shadow DOM,
       поэтому стиль живёт ВНУТРИ компонента; класс tut-hl ставится в render) */
    @keyframes tutCityGlow {
      0%,
      100% {
        box-shadow: 0 0 0 0 rgba(212, 175, 55, 0);
        border-color: #d4af37;
      }
      50% {
        box-shadow:
          0 0 0 3px #d4af37,
          0 0 22px 6px rgba(212, 175, 55, 0.8);
        border-color: #ffe07a;
      }
    }
    .build-button.tut-hl {
      animation: tutCityGlow 1.1s ease-in-out infinite;
    }
    .build-menu {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999;
      background-color: #1e1e1e;
      padding: 15px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 95vw;
      max-height: 95vh;
      overflow-y: auto;
    }
    .build-description {
      font-size: 0.6rem;
    }
    .build-row {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      width: 100%;
    }
    .build-button {
      position: relative;
      width: 120px;
      height: 140px;
      border: 2px solid #444;
      background-color: #2c2c2c;
      color: white;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      margin: 8px;
      padding: 10px;
      gap: 5px;
    }
    .build-button:not(:disabled):not(.unaffordable):hover {
      background-color: #3a3a3a;
      transform: scale(1.05);
      border-color: #666;
    }
    .build-button:not(:disabled):not(.unaffordable):active {
      background-color: #4a4a4a;
      transform: scale(0.95);
    }
    .build-button:disabled,
    .build-button.unaffordable {
      background-color: #1a1a1a;
      border-color: #333;
      cursor: not-allowed;
      opacity: 0.7;
    }
    .build-button:disabled img,
    .build-button.unaffordable img {
      opacity: 0.5;
    }
    .build-button:disabled .build-cost,
    .build-button.unaffordable .build-cost {
      color: #ff4444;
    }
    .build-icon {
      font-size: 40px;
      margin-bottom: 5px;
    }
    .build-name {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 5px;
      text-align: center;
    }
    .build-cost {
      font-size: 14px;
    }
    .hidden {
      display: none !important;
    }
    .build-count-chip {
      position: absolute;
      top: -10px;
      right: -10px;
      background-color: #2c2c2c;
      color: white;
      padding: 2px 10px;
      border-radius: 10000px;
      transition: all 0.3s ease;
      font-size: 12px;
      display: flex;
      justify-content: center;
      align-content: center;
      border: 1px solid #444;
    }
    .build-button:not(:disabled):hover > .build-count-chip {
      background-color: #3a3a3a;
      border-color: #666;
    }
    .build-button:not(:disabled):active > .build-count-chip {
      background-color: #4a4a4a;
    }
    .build-button:disabled > .build-count-chip,
    .build-button.unaffordable > .build-count-chip {
      background-color: #1a1a1a;
      border-color: #333;
      cursor: not-allowed;
    }
    .build-count {
      font-weight: bold;
      font-size: 14px;
    }

    @media (max-width: 768px) {
      .build-menu {
        padding: 10px;
        max-height: 80vh;
        width: 80vw;
      }
      .build-button {
        width: 140px;
        height: 120px;
        margin: 4px;
        padding: 6px;
        gap: 5px;
      }
      .build-icon {
        font-size: 28px;
      }
      .build-name {
        font-size: 12px;
        margin-bottom: 3px;
      }
      .build-cost {
        font-size: 11px;
      }
      .build-count {
        font-weight: bold;
        font-size: 10px;
      }
      .build-count-chip {
        padding: 1px 5px;
      }
    }

    @media (max-width: 480px) {
      .build-menu {
        padding: 8px;
        max-height: 70vh;
      }
      .build-button {
        width: calc(50% - 6px);
        height: 100px;
        margin: 3px;
        padding: 4px;
        border-width: 1px;
      }
      .build-icon {
        font-size: 24px;
      }
      .build-name {
        font-size: 10px;
        margin-bottom: 2px;
      }
      .build-cost {
        font-size: 9px;
      }
      .build-count {
        font-weight: bold;
        font-size: 8px;
      }
      .build-count-chip {
        padding: 0 3px;
      }
      .build-button img {
        width: 24px;
        height: 24px;
      }
      .build-cost img {
        width: 10px;
        height: 10px;
      }
    }
  `;

  @state()
  private _hidden = true;

  public canBuildOrUpgrade(item: BuildItemDisplay): boolean {
    if (this.game?.myPlayer() === null || this.playerBuildables === null) {
      return false;
    }
    const unit = this.playerBuildables.find((u) => u.type === item.unitType);
    return unit ? unit.canBuild !== false || unit.canUpgrade !== false : false;
  }

  public cost(item: BuildItemDisplay): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item.unitType) {
        return bu.cost;
      }
    }
    return 0n;
  }

  public count(item: BuildItemDisplay): string {
    const player = this.game?.myPlayer();
    if (!player) {
      return "?";
    }

    return player.totalUnitLevels(item.unitType).toString();
  }

  public sendBuildOrUpgrade(buildableUnit: BuildableUnit, tile: TileRef): void {
    if (buildableUnit.canUpgrade !== false) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          buildableUnit.canUpgrade,
          buildableUnit.type,
        ),
      );
    } else if (buildableUnit.canBuild) {
      const rocketDirectionUp =
        buildableUnit.type === UnitType.AtomBomb ||
        buildableUnit.type === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;
      // terron 24.08: Раскол/Передышка/Террор/Блокада без troops = сим
      // получает 0 и жмёт эффект в минимум («раскол маааленький» при 77%
      // на слайдере). Считаем той же функцией, что путь через гост.
      this.eventBus.emit(
        new BuildUnitIntentEvent(
          buildableUnit.type,
          tile,
          rocketDirectionUp,
          castTroopsFor(buildableUnit.type, this.game, this.uiState),
        ),
      );
    }
    this.hideMenu();
  }

  render() {
    return html`
      <div
        class="build-menu ${this._hidden ? "hidden" : ""}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        ${this.filteredBuildTable.map(
          (row) => html`
            <div class="build-row">
              ${row.map((item) => {
                const buildableUnit = this.playerBuildables?.find(
                  (bu) => bu.type === item.unitType,
                );
                if (buildableUnit === undefined) {
                  return html``;
                }
                const enabled =
                  buildableUnit.canBuild !== false ||
                  buildableUnit.canUpgrade !== false;
                const tutHl = enabled && tutHighlighted(item.unitType);
                const tutBlock = tutBlocked(item.unitType);
                return html`
                  <button
                    class="build-button ${tutHl ? "tut-hl" : ""} ${tutBlock
                      ? "tut-blocked"
                      : ""} ${enabled ? "" : "unaffordable"}"
                    data-unit=${item.unitType}
                    @click=${() => {
                      if (tutBlock) return; // обучение: строить лишнее нельзя
                      if (!enabled) return; // не хватает золота — только смотрим
                      this.sendBuildOrUpgrade(buildableUnit, this.clickedTile);
                    }}
                    ?disabled=${tutBlock}
                    title=${!enabled
                      ? translateText("build_menu.not_enough_money")
                      : ""}
                  >
                    <img
                      src=${item.icon}
                      alt="${item.unitType}"
                      width="40"
                      height="40"
                    />
                    <span class="build-name"
                      >${item.key && translateText(item.key)}</span
                    >
                    <span class="build-description"
                      >${item.description &&
                      translateText(item.description)}</span
                    >
                    <span class="build-cost" translate="no">
                      ${renderNumber(
                        this.game && this.game.myPlayer() ? this.cost(item) : 0,
                      )}
                      <img
                        src=${goldCoinIcon}
                        alt="gold"
                        width="12"
                        height="12"
                        class="align-middle"
                      />
                    </span>
                    ${item.countable
                      ? html`<div class="build-count-chip">
                          <span class="build-count">${this.count(item)}</span>
                        </div>`
                      : ""}
                  </button>
                `;
              })}
            </div>
          `,
        )}
      </div>
    `;
  }

  hideMenu() {
    this._hidden = true;
    this.requestUpdate();
  }

  showMenu(clickedTile: TileRef) {
    this.clickedTile = clickedTile;
    this._hidden = false;
    this.refresh();
  }

  private refresh() {
    this.game
      .myPlayer()
      ?.buildables(this.clickedTile, VISIBLE_BUILD_TYPES)
      .then((buildables) => {
        this.playerBuildables = buildables;
        this.requestUpdate();
      });

    // remove disabled buildings from the buildtable
    this.filteredBuildTable = this.getBuildableUnits();
  }

  private getBuildableUnits(): BuildItemDisplay[][] {
    return buildTable.map((row) =>
      row.filter((item) => !this.game?.config()?.isUnitDisabled(item.unitType)),
    );
  }

  get isVisible() {
    return !this._hidden;
  }
}

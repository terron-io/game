import { LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { PlayerActions } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { TransformHandler } from "../../TransformHandler";
import { UIState } from "../../UIState";
import { BuildMenu } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { EmojiTable } from "./EmojiTable";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerPanel } from "./PlayerPanel";
import { RadialMenu, RadialMenuConfig } from "./RadialMenu";
import {
  centerButtonElement,
  COLORS,
  MenuElementParams,
  rootMenuElement,
} from "./RadialMenuElements";
const donateTroopIcon = assetUrl("images/DonateTroopIconWhite.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");
// terron: контекстные иконки центра радиалки (вода/своя территория)
const boatIcon = assetUrl("images/BoatIconWhite.svg");
const selfIcon = assetUrl("images/InfoIconSolidWhite.svg");

import { UserSettings } from "../../../core/game/UserSettings";
import { ContextMenuEvent } from "../../InputHandler";

@customElement("main-radial-menu")
export class MainRadialMenu extends LitElement implements Controller {
  private radialMenu: RadialMenu;

  private playerActionHandler: PlayerActionHandler;
  private chatIntegration: ChatIntegration;

  private clickedTile: TileRef | null = null;

  getTickIntervalMs() {
    return 500;
  }

  constructor(
    private eventBus: EventBus,
    private game: GameView,
    private transformHandler: TransformHandler,
    private emojiTable: EmojiTable,
    private buildMenu: BuildMenu,
    private uiState: UIState,
    private playerPanel: PlayerPanel,
    private userSettings: UserSettings,
  ) {
    super();

    const menuConfig: RadialMenuConfig = {
      centerButtonIcon: swordIcon,
      tooltipStyle: `
        .radial-tooltip .cost {
          margin-top: 4px;
          color: ${COLORS.tooltip.cost};
        }
        .radial-tooltip .count {
          color: ${COLORS.tooltip.count};
        }
      `,
    };

    this.radialMenu = new RadialMenu(
      this.eventBus,
      rootMenuElement,
      centerButtonElement,
      menuConfig,
    );

    this.playerActionHandler = new PlayerActionHandler(
      this.eventBus,
      this.uiState,
    );

    this.chatIntegration = new ChatIntegration(this.game, this.eventBus);
  }

  init() {
    this.radialMenu.init();
    this.eventBus.on(ContextMenuEvent, (event) => {
      // terron: прицельное управление — радиал по клику НЕ открываем: он
      // раскрывается вокруг пальца и закрывает ровно ту цель, по которой
      // целятся, а это то самое, от чего режим и уводит. Длинное нажатие на
      // таче радиал по-прежнему открывает — там живёт дипломатия (союз,
      // эмодзи, кик), которой в панели нет.
      if (this.userSettings.aimControl()) return;
      const worldCoords = this.transformHandler.screenToWorldCoordinates(
        event.x,
        event.y,
      );
      if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) {
        return;
      }
      if (this.game.myPlayer() === null) {
        return;
      }
      this.clickedTile = this.game.ref(worldCoords.x, worldCoords.y);
      this.game
        .myPlayer()!
        .actions(this.clickedTile)
        .then((actions) => {
          this.updatePlayerActions(
            this.game.myPlayer()!,
            actions,
            this.clickedTile!,
            event.x,
            event.y,
          );
        });
    });
  }

  private async updatePlayerActions(
    myPlayer: PlayerView,
    actions: PlayerActions,
    tile: TileRef,
    screenX: number | null = null,
    screenY: number | null = null,
  ) {
    this.buildMenu.playerBuildables = actions.buildableUnits;

    const tileOwner = this.game.owner(tile);
    const recipient = tileOwner.isPlayer() ? (tileOwner as PlayerView) : null;

    if (myPlayer && recipient) {
      this.chatIntegration.setupChatModal(myPlayer, recipient);
    }

    const params: MenuElementParams = {
      myPlayer,
      selected: recipient,
      tile,
      playerActions: actions,
      game: this.game,
      buildMenu: this.buildMenu,
      emojiTable: this.emojiTable,
      playerActionHandler: this.playerActionHandler,
      playerPanel: this.playerPanel,
      chatIntegration: this.chatIntegration,
      uiState: this.uiState,
      closeMenu: () => this.closeMenu(),
      eventBus: this.eventBus,
    };

    const isFriendlyTarget =
      recipient !== null &&
      recipient.isFriendly(myPlayer) &&
      !recipient.isDisconnected();

    // terron: контекстный центр радиалки — вместо непонятного серого меча показываем,
    // ЧТО под курсором: союзник → донат, своя территория → инфо, вода → кораблик,
    // враг/ничьё → меч. Снимает путаницу «серый меч = вода? я? союзник?».
    // (в фазе спавна центр = «заспавниться», иконку не меняем.)
    const inSpawn = this.game.inSpawnPhase();
    const isSelfTerritory =
      !inSpawn &&
      recipient !== null &&
      myPlayer !== null &&
      recipient.id() === myPlayer.id();
    const isWaterTile = !inSpawn && !this.game.isLand(tile);

    let centerIcon = swordIcon;
    let centerColor = "#0f2744";
    let centerScale = 1;
    if (isFriendlyTarget) {
      centerIcon = donateTroopIcon;
      centerColor = "#22d3ee";
      centerScale = 0.75;
    } else if (isSelfTerritory) {
      centerIcon = selfIcon;
      centerColor = "#475569";
      centerScale = 0.8;
    } else if (isWaterTile) {
      centerIcon = boatIcon;
      centerColor = "#2a82c9";
      centerScale = 0.8;
    }
    this.radialMenu.setCenterButtonAppearance(
      centerIcon,
      centerColor,
      this.radialMenu.getDefaultCenterIconSize() * centerScale,
    );

    this.radialMenu.setParams(params);
    if (screenX !== null && screenY !== null) {
      this.radialMenu.showRadialMenu(screenX, screenY);
    } else {
      this.radialMenu.refresh();
    }
  }

  async tick() {
    if (!this.radialMenu.isMenuVisible() || this.clickedTile === null) return;
    this.game
      .myPlayer()!
      .actions(this.clickedTile)
      .then((actions) => {
        this.updatePlayerActions(
          this.game.myPlayer()!,
          actions,
          this.clickedTile!,
        );
      });
  }

  closeMenu() {
    if (this.radialMenu.isMenuVisible()) {
      this.radialMenu.hideRadialMenu();
    }

    if (this.buildMenu.isVisible) {
      this.buildMenu.hideMenu();
    }

    if (this.emojiTable.isVisible) {
      this.emojiTable.hideTable();
    }

    if (this.playerPanel.isVisible) {
      this.playerPanel.hide();
    }
  }
}

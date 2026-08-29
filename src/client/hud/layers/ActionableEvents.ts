import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { UIState } from "../../UIState";

// terron: actionable-события (запросы/продления союзов с кнопками) ВЛИТЫ в единую
// ленту <events-display>. Этот компонент оставлен пустышкой, чтобы не дублировать
// карточки и не трогать HUD-шаблон/регистрацию слоёв в GameRenderer.
// Вся логика — в EventsDisplay (onAllianceRequestEvent / checkForAllianceExpirations).
@customElement("actionable-events")
export class ActionableEvents extends LitElement implements Controller {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  createRenderRoot() {
    return this;
  }

  tick() {
    /* no-op: см. EventsDisplay */
  }

  render() {
    return html``;
  }
}

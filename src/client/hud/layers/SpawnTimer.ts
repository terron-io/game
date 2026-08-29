import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { effectiveSpawnPhaseTurns } from "../../../core/configuration/TerronTuning";
import { GameMode, GameType, PlayerType, Team } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { themeProvider } from "../../theme/ThemeProvider";
import { TransformHandler } from "../../TransformHandler";

export class SpawnBarVisibleEvent implements GameEvent {
  constructor(public readonly visible: boolean) {}
}

@customElement("spawn-timer")
export class SpawnTimer extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public transformHandler: TransformHandler;

  private ratios = [0];
  private _barVisible = false;
  private colors = [
    "rgba(31, 41, 55, 0.75)",
    "rgba(0, 0, 0, 0.5)",
  ];

  private isVisible = false;

  createRenderRoot() {
    this.style.position = "fixed";
    // terron iOS: под нотч, иначе полоса фазы спавна уезжает под вырез
    this.style.top = "env(safe-area-inset-top)";
    this.style.left = "0";
    this.style.width = "100%";
    this.style.height = "7px";
    this.style.zIndex = "1000";
    this.style.pointerEvents = "none";
    return this;
  }

  init() {
    this.isVisible = true;
  }

  // terron: единый источник истины (effectiveSpawnPhaseTurns) — синхрон с сервером.
  private spawnTurns(): number {
    const humans = this.game
      .playerViews()
      .filter((p) => p.type() === PlayerType.Human).length;
    return effectiveSpawnPhaseTurns(
      this.game.config().numSpawnPhaseTurns(),
      humans,
    );
  }

  tick() {
    if (
      this.game.config().gameConfig().gameType === GameType.Singleplayer &&
      this.game.inSpawnPhase()
    ) {
      // Singleplayer has no spawn countdown.
      this.ratios = [];
      this.colors = [];
      this.requestUpdate();
      return;
    }

    if (this.game.inSpawnPhase()) {
      // During spawn phase, only one segment filling full width
      this.ratios = [this.game.ticks() / this.spawnTurns()];
      this.colors = ["rgba(31, 41, 55, 0.75)"];
    } else {
      this.ratios = [];
      this.colors = [];

      if (this.game.config().gameConfig().gameMode === GameMode.Team) {
        const teamTiles: Map<Team, number> = new Map();
        for (const player of this.game.players()) {
          const team = player.team();
          if (team === null) continue;
          const tiles = teamTiles.get(team) ?? 0;
          teamTiles.set(team, tiles + player.numTilesOwned());
        }

        const theme = themeProvider.current();
        const total = sumIterator(teamTiles.values());
        if (total > 0) {
          for (const [team, count] of teamTiles) {
            const ratio = count / total;
            this.ratios.push(ratio);
            this.colors.push(theme.teamColor(team).toRgbString());
          }
        }
      }
    }

    this.requestUpdate();
    this.emitBarVisibility();
  }

  private emitBarVisibility() {
    const nowVisible = this.isVisible && this.ratios.length > 0;
    if (nowVisible !== this._barVisible) {
      this._barVisible = nowVisible;
      this.eventBus?.emit(new SpawnBarVisibleEvent(this._barVisible));
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    if (this.ratios.length === 0 || this.colors.length === 0) {
      return html``;
    }

    if (
      !this.game.inSpawnPhase() &&
      this.game.config().gameConfig().gameMode !== GameMode.Team
    ) {
      return html``;
    }

    return html`
      <div class="w-full h-full flex z-999">
        ${this.ratios.map((ratio, i) => {
          const color = this.colors[i] || "rgba(0, 0, 0, 0.5)";
          return html`
            <div
              class="h-full transition-all duration-100 ease-in-out w-(--width) bg-(--bg)"
              style="--width: ${ratio * 100}%; --bg: ${color};"
            ></div>
          `;
        })}
      </div>
    `;
  }
}

function sumIterator(values: MapIterator<number>) {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

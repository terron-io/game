import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { renderTroops, translateText } from "../../../client/Utils";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { PlayerType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { uiIcon } from "../../components/ui/UiIcon";
import { Controller } from "../../Controller";
import { GoToPlayerEvent } from "../../TransformHandler";
import { formatPercentage, L, renderNumber } from "../../Utils";

// terron: Закрытая страна — плейсхолдер скрытого параметра.
const HIDDEN_STAT = "???";

// terron: иконки колонок топа — те же, что в нижнем HUD (золото/войска).
const goldIcon = assetUrl("images/GoldCoinIcon.svg");
const troopIcon = assetUrl("images/TroopIconWhite.svg");
const chartIcon = assetUrl("images/LeaderboardIconSolidWhite.svg");

interface Entry {
  name: string;
  position: number;
  score: string;
  gold: string;
  maxTroops: string;
  isMyPlayer: boolean;
  isOnSameTeam: boolean;
  player: PlayerView;
}

@customElement("leader-board")
export class Leaderboard extends LitElement implements Controller {
  public game: GameView | null = null;
  public eventBus: EventBus | null = null;

  players: Entry[] = [];

  @property({ type: Boolean }) visible = false;
  @property({ type: String }) gameId = "";
  @property({ attribute: false }) onToggle: () => void = () => {};
  // terron: высота списка в px (drag-ресайз как у чата). null → дефолт.
  @state() private listMaxPx: number | null = null;
  private resizeStartY = 0;
  private resizeStartPx = 0;
  // terron: липкая «моя строка» — показываем внизу с позицией, ПОКА мой ряд не
  // виден в окне скролла (IntersectionObserver). Виден → прячем (я и так в топе).
  @state() private myRowVisible = true;
  private myRowData: Entry | null = null;
  private meObserver: IntersectionObserver | null = null;
  private observedMeEl: Element | null = null;

  private onResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    const el = this.querySelector(".lb-scroll") as HTMLElement | null;
    this.resizeStartPx = el?.getBoundingClientRect().height ?? 140;
    this.resizeStartY = e.clientY;
    window.addEventListener("pointermove", this.onResizeMove);
    window.addEventListener("pointerup", this.onResizeEnd);
  };
  private onResizeMove = (e: PointerEvent) => {
    // ручка снизу: тянем ВНИЗ (dy>0) → список выше
    const dy = e.clientY - this.resizeStartY;
    this.listMaxPx = Math.max(
      40,
      Math.min(window.innerHeight * 0.8, this.resizeStartPx + dy),
    );
  };
  private onResizeEnd = () => {
    window.removeEventListener("pointermove", this.onResizeMove);
    window.removeEventListener("pointerup", this.onResizeEnd);
  };

  @state()
  private _sortKey: "tiles" | "gold" | "maxtroops" = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";

  createRenderRoot() {
    return this; // use light DOM for Tailwind support
  }

  init() {}

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("visible") && this.visible) {
      this.updateLeaderboard();
    }
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    if (this.game === null) throw new Error("Not initialized");
    if (!this.visible) return;
    if (this.game.fogOfWarActive()) {
      this.requestUpdate(); // показать/держать заглушку тумана
      return;
    }
    this.updateLeaderboard();
  }

  private setSort(key: "tiles" | "gold" | "maxtroops") {
    if (this._sortKey === key) {
      this._sortOrder = this._sortOrder === "asc" ? "desc" : "asc";
    } else {
      this._sortKey = key;
      this._sortOrder = "desc";
    }
    this.updateLeaderboard();
  }

  private updateLeaderboard() {
    if (this.game === null) throw new Error("Not initialized");
    const myPlayer = this.game.myPlayer();

    let sorted = this.game.playerViews();

    const compare = (a: number, b: number) =>
      this._sortOrder === "asc" ? a - b : b - a;

    const maxTroops = (p: PlayerView) => this.game!.config().maxTroops(p);

    switch (this._sortKey) {
      case "gold":
        sorted = sorted.sort((a, b) =>
          compare(Number(a.gold()), Number(b.gold())),
        );
        break;
      case "maxtroops":
        sorted = sorted.sort((a, b) => compare(maxTroops(a), maxTroops(b)));
        break;
      default:
        sorted = sorted.sort((a, b) =>
          compare(a.numTilesOwned(), b.numTilesOwned()),
        );
    }

    // terron: убираем ПЛЕМЕНА (боты) из топа — их сотни, только засоряют. Нации
    // и люди остаются. Позиции считаются уже без племён.
    sorted = sorted.filter((player) => player.type() !== PlayerType.Bot);

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();

    const alivePlayers = sorted.filter((player) => player.isAlive());
    // terron: показываем ВСЕХ — высоту регулирует drag-ресайз (как чат).
    const playersToShow = alivePlayers;

    this.players = playersToShow.map((player, index) => {
      const maxTroops = this.game!.config().maxTroops(player);
      return {
        name: player.displayName(),
        position: index + 1,
        score: formatPercentage(
          player.numTilesOwned() / numTilesWithoutFallout,
        ),
        // terron: Закрытая страна — цифры скрыты от чужих («???»).
        gold: this.game!.statsHiddenFor(player)
          ? HIDDEN_STAT
          : renderNumber(player.gold()),
        maxTroops: this.game!.statsHiddenFor(player)
          ? HIDDEN_STAT
          : renderTroops(maxTroops),
        isMyPlayer: player === myPlayer,
        isOnSameTeam:
          myPlayer !== null &&
          (player === myPlayer || player.isOnSameTeam(myPlayer)),
        player: player,
      };
    });

    if (
      myPlayer !== null &&
      this.players.find((p) => p.isMyPlayer) === undefined
    ) {
      let place = 0;
      for (const p of sorted) {
        place++;
        if (p === myPlayer) {
          break;
        }
      }

      if (myPlayer.isAlive()) {
        const myPlayerMaxTroops = this.game!.config().maxTroops(myPlayer);
        this.players.pop();
        this.players.push({
          name: myPlayer.displayName(),
          position: place,
          score: formatPercentage(
            myPlayer.numTilesOwned() / this.game.numLandTiles(),
          ),
          gold: renderNumber(myPlayer.gold()),
          maxTroops: renderTroops(myPlayerMaxTroops),
          isMyPlayer: true,
          isOnSameTeam: true,
          player: myPlayer,
        });
      }
    }

    this.myRowData = this.players.find((p) => p.isMyPlayer) ?? null;

    this.requestUpdate();
  }

  // Следим, виден ли мой ряд в окне скролла → решаем, показывать ли липкую строку.
  updated(): void {
    const scroll = this.querySelector(".lb-scroll");
    const meEl = this.querySelector("[data-me-row]");
    if (!scroll || !meEl) {
      this.observedMeEl = null;
      this.meObserver?.disconnect();
      if (!this.myRowVisible) this.myRowVisible = true;
      return;
    }
    if (meEl === this.observedMeEl) return; // уже наблюдаем этот же элемент
    this.meObserver?.disconnect();
    this.meObserver = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        const vis = e.isIntersecting && e.intersectionRatio >= 0.5;
        if (this.myRowVisible !== vis) this.myRowVisible = vis;
      },
      { root: scroll, threshold: [0, 0.5, 1] },
    );
    this.meObserver.observe(meEl);
    this.observedMeEl = meEl;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.meObserver?.disconnect();
    this.meObserver = null;
    this.observedMeEl = null;
  }

  private handleRowClickPlayer(player: PlayerView) {
    if (this.eventBus === null) return;
    this.eventBus.emit(new GoToPlayerEvent(player));
  }

  // terron: клик по НИКУ в топе → то же меню игрока, что в чате (Смотреть/
  // Упомянуть). Меню живёт в EventsDisplay — зовём его глобальным событием.
  // stopPropagation, чтобы клик по нику не сработал как фокус-ряд (глаз слева).
  private handleNameClickPlayer(e: Event, player: PlayerView) {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent("terron-open-player-menu", { detail: { player } }),
    );
  }

  private sortArrow(key: "tiles" | "gold" | "maxtroops") {
    if (this._sortKey !== key) return "";
    return html`<span class="text-[9px] opacity-60"
      >${this._sortOrder === "asc" ? "▲" : "▼"}</span
    >`;
  }

  render() {
    if (!this.visible) {
      return html``;
    }
    // terron: туман войны — топ игроков = глобальная разведка, скрываем.
    if (this.game?.fogOfWarActive()) {
      return html`<div
        class="text-white/80 text-[11px] lg:text-sm bg-gray-800/80 backdrop-blur-sm rounded-lg px-3 py-2"
      >
        ${L("Разведданные скрыты: туман войны", "Intel hidden: fog of war")}
      </div>`;
    }
    // глобус (территория) — инлайн SVG в текущем цвете (белый)
    const globe = html`<svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      style="display:inline-block;vertical-align:-2px"
    >
      <circle cx="12" cy="12" r="9"></circle>
      <path
        d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"
      ></path>
    </svg>`;
    const hcell = (
      icon: unknown,
      key: "tiles" | "gold" | "maxtroops",
      tip: string,
    ) =>
      html`<div
        class="py-1 text-center border-b border-white/10 cursor-pointer flex items-center justify-center gap-0.5"
        title=${tip}
        @click=${() => this.setSort(key)}
      >
        ${icon}${this.sortArrow(key)}
      </div>`;

    const cols =
      "minmax(16px,22px) minmax(44px,96px) minmax(28px,40px) minmax(32px,44px) minmax(32px,44px)";
    return html`
      <div
        class="text-white text-[11px] lg:text-sm"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div class="bg-gray-800/80 backdrop-blur-sm rounded-lg overflow-hidden">
          <!-- шапка (фикс): иконка-идентичность + заголовки-иконки -->
          <div
            class="grid font-bold bg-gray-700/60"
            style="grid-template-columns:${cols}"
          >
            <!-- иконка топа = ТОГЛ: клик полностью скрывает/показывает топ -->
            <div
              class="flex items-center justify-center py-1 border-b border-white/10 cursor-pointer hover:bg-white/10"
              title=${L("Скрыть топ", "Hide leaderboard")}
              @click=${() => this.onToggle()}
            >
              <img src=${chartIcon} class="w-4 h-4" />
            </div>
            <div class="py-1 border-b border-white/10"></div>
            ${hcell(globe, "tiles", translateText("leaderboard.owned"))}
            ${hcell(
              html`<img src=${goldIcon} class="w-3.5 h-3.5 inline-block" />`,
              "gold",
              translateText("leaderboard.gold"),
            )}
            ${hcell(
              html`<img src=${troopIcon} class="w-3.5 h-3.5 inline-block" />`,
              "maxtroops",
              translateText("leaderboard.maxtroops"),
            )}
          </div>
          <!-- список: скролл + ресайз (как чат) -->
          <div
            class="lb-scroll overflow-y-auto"
            style="max-height:${this.listMaxPx ?? 140}px"
          >
            ${repeat(
              this.players,
              (p) => p.player.id(),
              (player) => {
                // СВОЙ ряд — жирный + нейтральная подложка (НЕ цвет: цвета продаём).
                const me = player.isMyPlayer;
                const hl = me ? "bg-white/15" : "";
                const bold = me || player.isOnSameTeam ? "font-bold" : "";
                // per-row grid + group → ховер подсвечивает ряд и показывает глаз.
                return html`
                  <div
                    class="group grid items-center cursor-pointer ${bold} hover:bg-white/5"
                    style="grid-template-columns:${cols}"
                    ?data-me-row=${me}
                    @click=${() => this.handleRowClickPlayer(player.player)}
                  >
                    <div
                      class="py-0.5 flex items-center justify-center ${me
                        ? "text-white"
                        : "text-slate-400"} ${hl}"
                    >
                      <span class="group-hover:hidden">${player.position}</span>
                      <span class="hidden group-hover:flex text-sky-300"
                        >${uiIcon("eye", 13)}</span
                      >
                    </div>
                    <div class="py-0.5 pl-1.5 truncate ${hl}">
                      <span
                        class="hover:underline underline-offset-2"
                        @click=${(e: Event) =>
                          this.handleNameClickPlayer(e, player.player)}
                        >${player.name}</span
                      >
                    </div>
                    <div class="py-0.5 text-center ${hl}">${player.score}</div>
                    <div class="py-0.5 text-center ${hl}">${player.gold}</div>
                    <div class="py-0.5 text-center ${hl}">
                      ${player.maxTroops}
                    </div>
                  </div>
                `;
              },
            )}
          </div>
          ${!this.myRowVisible && this.myRowData
            ? html`<div
                class="grid items-center cursor-pointer bg-gray-700/95 border-t border-white/25"
                style="grid-template-columns:${cols}"
                title=${L("Твоя позиция", "Your position")}
                @click=${() =>
                  this.myRowData &&
                  this.handleRowClickPlayer(this.myRowData.player)}
              >
                <div class="py-0.5 text-center text-white font-bold">
                  ${this.myRowData.position}
                </div>
                <div class="py-0.5 pl-1.5 truncate font-bold text-white">
                  ${this.myRowData.name}
                </div>
                <div class="py-0.5 text-center">${this.myRowData.score}</div>
                <div class="py-0.5 text-center">${this.myRowData.gold}</div>
                <div class="py-0.5 text-center">
                  ${this.myRowData.maxTroops}
                </div>
              </div>`
            : ""}
        </div>

        <!-- полоса растягивания (drag, на месте бывшей иконки) + ID игры -->
        <div class="flex items-center gap-2 px-1 mt-0.5 leading-none">
          <div
            class="flex-1 h-2.5 flex items-center cursor-ns-resize select-none touch-none"
            title=${L(
              "Тяни — изменить высоту топа",
              "Drag to resize leaderboard",
            )}
            @pointerdown=${this.onResizeStart}
          >
            <div class="w-10 h-1 rounded-full bg-white/40"></div>
          </div>
          ${this.gameId
            ? html`<span
                class="text-[10px] text-slate-500 select-all leading-none"
                title="ID"
                >${this.gameId}</span
              >`
            : ""}
        </div>
      </div>
    `;
  }
}

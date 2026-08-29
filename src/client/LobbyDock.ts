// terron 25.08: ПЛАШКА «ТЫ В ЛОББИ» — нижняя полоса, живущая ВНЕ окна лобби.
//
// Повод (репорт игрока 25.08): «пока в лобби ждёшь, хочется онлайн чекнуть,
// вики или что-то ещё, а переход по сайту выбрасывает из лобби». Раньше так и
// было: любой showPage закрывал окно лобби, а его close() шлёт leave-lobby.
// Теперь окно СВОРАЧИВАЕТСЯ (BaseModal.minimize), членство в лобби держит
// сокет в Main.lobbyHandle, а игрок видит внизу, где он и сколько осталось.
//
// ⚠️ Плашка НЕ подписывается на шину событий и ничего не знает про лобби сама:
// снимок ей присылает окно лобби событием `lobby-dock` (detail=null — снять).
// Один источник правды: то же состояние, что рисует само окно. Иначе пришлось
// бы вторично разбирать lobby_info и держать две расходящиеся картины мира.
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../core/AssetUrls";
import { getServerNow, L } from "./Utils";

const bloodDiamondIcon = assetUrl("images/BloodDiamondIcon.svg");

/** Окно, которое умеет сворачиваться в плашку (join- и host-лобби). */
interface DockableLobby extends HTMLElement {
  reopenFromDock(): void;
  leaveFromDock(): void;
}

export interface LobbyDockState {
  /** Чьё лобби показываем — окно «войти» или окно «создать». */
  source: "join" | "host";
  lobbyId: string;
  map: string | null;
  players: number;
  maxPlayers: number | null;
  /** Короткая подпись режима («ФФА», «Команды») — когда лобби не событийное. */
  mode: string | null;
  startsAt: number | null;
  serverTimeOffset: number;
  tier: "golden" | "diamond" | null;
}

@customElement("lobby-dock")
export class LobbyDock extends LitElement {
  @state() private info: LobbyDockState | null = null;
  private tick: number | null = null;

  // Плашка живёт в общем DOM (не в shadow), чтобы её красила тема сайта.
  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("lobby-dock", this.onDock as EventListener);
  }

  disconnectedCallback(): void {
    document.removeEventListener("lobby-dock", this.onDock as EventListener);
    document.body.classList.remove("lobby-docked");
    this.stopTick();
    super.disconnectedCallback();
  }

  private readonly onDock = (e: CustomEvent<LobbyDockState | null>) => {
    this.info = e.detail ?? null;
    if (this.info) this.startTick();
    else this.stopTick();
  };

  // Отсчёт тикает раз в секунду и ТОЛЬКО пока плашка видна: свёрнутое лобби и
  // так пересчитывает себя, второй частый таймер тут не нужен.
  private startTick(): void {
    if (this.tick !== null) return;
    this.tick = window.setInterval(() => this.requestUpdate(), 1000);
  }
  private stopTick(): void {
    if (this.tick === null) return;
    clearInterval(this.tick);
    this.tick = null;
  }

  /**
   * Плашка фиксирована у нижнего края и перекрывала подвал сайта (ссылки
   * telegram/соглашения переставали нажиматься). Поднимаем подвал ровно на её
   * ФАКТИЧЕСКУЮ высоту: на узком экране она в полтора раза выше, чем на
   * широком, поэтому константой не обойтись.
   */
  protected updated(): void {
    const dock = this.querySelector(".lobby-dock") as HTMLElement | null;
    document.body.classList.toggle("lobby-docked", dock !== null);
    if (dock) {
      document.body.style.setProperty(
        "--lobby-dock-h",
        `${Math.round(dock.getBoundingClientRect().height)}px`,
      );
    } else {
      document.body.style.removeProperty("--lobby-dock-h");
    }
  }

  private modal(): DockableLobby | null {
    const tag =
      this.info?.source === "host" ? "host-lobby-modal" : "join-lobby-modal";
    return document.querySelector(tag) as DockableLobby | null;
  }

  private secondsLeft(): number | null {
    if (!this.info?.startsAt) return null;
    return Math.max(
      0,
      Math.floor(
        (this.info.startsAt - getServerNow(this.info.serverTimeOffset)) / 1000,
      ),
    );
  }

  private countdown(): string {
    const left = this.secondsLeft();
    if (left === null) return "";
    if (left === 0) return L("запуск игры", "starting");
    const pad = (n: number) => String(n).padStart(2, "0");
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    return h > 0
      ? `${h}:${pad(m)}:${pad(left % 60)}`
      : `${pad(m)}:${pad(left % 60)}`;
  }

  /**
   * Слева — ЧТО это за лобби, одним взглядом: у событийных значок (💎/⭐), у
   * обычных короткая подпись режима. Название карты не пишем: в плашке важно
   * «где я стою и сколько ждать», а не что за карта — она видна в самом лобби.
   */
  private renderBadge() {
    const i = this.info;
    if (i?.tier === "diamond") {
      return html`<img
        class="lobby-dock-gem"
        src=${bloodDiamondIcon}
        alt=${L("Алмазный матч", "Diamond match")}
        title=${L("Алмазный матч", "Diamond match")}
      />`;
    }
    if (i?.tier === "golden") {
      return html`<span
        class="lobby-dock-star"
        title=${L("Золотой матч", "Golden match")}
        >★</span
      >`;
    }
    return html`<span class="lobby-dock-mode"
      >${i?.mode || L("Лобби", "Lobby")}</span
    >`;
  }

  render() {
    const i = this.info;
    if (!i) return html``;
    const left = this.secondsLeft();
    return html`
      <div class="lobby-dock" role="status">
        <div class="lobby-dock-body">
          <span class="lobby-dock-dot" aria-hidden="true"></span>
          ${this.renderBadge()}
          ${left !== null
            ? html`<span class="lobby-dock-time">${this.countdown()}</span>`
            : ""}
          <span class="lobby-dock-count"
            >${i.players}${i.maxPlayers ? `/${i.maxPlayers}` : ""}</span
          >
          <span class="lobby-dock-spacer"></span>
          <button
            class="lobby-dock-btn primary"
            @click=${() => this.modal()?.reopenFromDock()}
          >
            ${L("Вернуться в лобби", "Back to lobby")}
          </button>
          <button
            class="lobby-dock-btn lobby-dock-x"
            title=${L("Выйти из лобби", "Leave lobby")}
            aria-label=${L("Выйти из лобби", "Leave lobby")}
            @click=${() => this.modal()?.leaveFromDock()}
          >
            ✕
          </button>
        </div>
      </div>
    `;
  }
}

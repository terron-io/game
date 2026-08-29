import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getDailyQuests, type TerronDailyQuest } from "./Api";
import { L, translateText } from "./Utils";

const td = (k: string) => translateText(`dossier.${k}`);
const n = (v: number) => v.toLocaleString("ru-RU");

// terron: выезжающая панель дейликов у ПРАВОГО края (верхняя половина экрана). Касание
// правого края → панель почти мгновенно выезжает (CSS :hover), увод курсора → уезжает.
// Чисто CSS-ховер (без JS-стейта показа) = моментально. На главной; в игре скрыта.
@customElement("terron-daily-flyout")
export class DailyFlyout extends LitElement {
  @state() private quests: TerronDailyQuest[] | null = null;
  @state() private loading = false;
  private lastFetch = 0;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.fetch();
  }

  // подтянуть дейлики (троттл 20с — на случай частых наведений)
  private async fetch(): Promise<void> {
    if (this.loading) return;
    if (this.quests !== null && Date.now() - this.lastFetch < 20000) return;
    this.loading = true;
    try {
      const r = await getDailyQuests();
      this.quests = r?.quests ?? [];
    } catch {
      this.quests = this.quests ?? [];
    } finally {
      this.loading = false;
      this.lastFetch = Date.now();
      this.requestUpdate();
    }
  }

  private renderQuest(q: TerronDailyQuest) {
    const pct = q.threshold > 0 ? Math.min(1, q.progress / q.threshold) : 0;
    const done = q.claimed;
    const c = done ? "#639922" : "#BA7517";
    return html`<div
      style="background:#fdfcf7;border:0.5px solid rgba(0,0,0,.15);border-left:3px solid ${c};padding:12px 14px"
    >
      <div style="display:flex;align-items:center;gap:11px">
        <span style="font-size:19px">${q.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px;color:#1a1a1a">
            ${translateText(`daily.${q.id}.title`)}
          </div>
          <div style="font-size:12px;color:#1a1a1a;opacity:.7;margin-top:2px">
            ${n(q.progress)} / ${n(q.threshold)} ·
            <b style="color:${c}">+${q.reward} ${td("reward_lts")}</b>
          </div>
        </div>
        ${done
          ? html`<span style="color:#639922;font-size:12px;font-weight:700"
              >${td("claimed")} ✓</span
            >`
          : ""}
      </div>
      <div style="height:6px;background:rgba(0,0,0,.1);overflow:hidden;margin-top:10px">
        <div style="width:${Math.round(pct * 100)}%;height:100%;background:${c}"></div>
      </div>
    </div>`;
  }

  render() {
    const has = this.quests && this.quests.length > 0;
    return html`
      <style>
        .tdf-wrap {
          position: fixed;
          top: 0;
          right: 0;
          height: 100vh;
          z-index: 9000;
          pointer-events: none;
          font-family: inherit;
        }
        /* язычок «задачи» — по ЦЕНТРУ правого края (не у верха), вертикальный */
        .tdf-handle {
          position: absolute;
          top: 50%;
          right: 0;
          transform: translateY(-50%);
          pointer-events: auto;
          cursor: pointer;
          writing-mode: vertical-rl;
          text-orientation: mixed;
          background: #2b2a24;
          color: #f5f1e6;
          font-family: var(--t-display, inherit);
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 12px;
          font-weight: 700;
          padding: 16px 7px;
          box-shadow: -4px 0 16px rgba(0, 0, 0, 0.25);
          transition: opacity 0.16s;
        }
        body.in-game .tdf-wrap {
          display: none;
        }
        /* hover-флайаут бесполезен на тач/узких экранах — прячем (там торчал как
           «кнопка в воздухе»). Дейлики на мобиле доступны в досье/загрузке. */
        @media (hover: none), (max-width: 1023px) {
          .tdf-wrap {
            display: none !important;
          }
        }
        .tdf-panel {
          position: absolute;
          top: 50%;
          right: 0;
          width: 320px;
          max-width: 86vw;
          pointer-events: auto;
          background: #f5f1e6;
          color: #1a1a1a;
          border: 1px solid rgba(0, 0, 0, 0.18);
          border-right: none;
          box-shadow: -14px 0 44px rgba(0, 0, 0, 0.3);
          padding: 20px 20px 18px;
          transform: translate(102%, -50%);
          transition: transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .tdf-wrap:hover .tdf-panel {
          transform: translate(0, -50%);
        }
        .tdf-wrap:hover .tdf-handle {
          opacity: 0;
        }
        .tdf-ttl {
          font-family: var(--t-display, inherit);
          text-transform: uppercase;
          letter-spacing: 0.03em;
          font-weight: 800;
          font-size: 15px;
          margin-bottom: 14px;
        }
      </style>
      <div
        class="tdf-wrap"
        @mouseenter=${() => void this.fetch()}
      >
        ${has || this.loading
          ? html`<div class="tdf-handle">${L("задачи", "tasks")}</div>
              <div class="tdf-panel">
                <div class="tdf-ttl">
                  ${translateText("game_starting_modal.quests_title")}
                </div>
                ${has
                  ? html`<div style="display:flex;flex-direction:column;gap:11px">
                      ${this.quests!.map((q) => this.renderQuest(q))}
                    </div>`
                  : html`<div style="opacity:.55;font-size:13px">…</div>`}
              </div>`
          : ""}
      </div>
    `;
  }
}

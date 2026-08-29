import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getDailyQuests, type TerronDailyQuest } from "./Api";
import { L, translateText } from "./Utils";

const td = (k: string) => translateText(`dossier.${k}`);
const n = (v: number) => v.toLocaleString("ru-RU");

// terron: единый загрузочный экран в нашем дизайне. Заменил две «благодарности»
// (кредиты + лицензия) на один экран: «Загрузка карты…» + текущие квесты на сегодня.
// AGPL/OpenFront-атрибуция сохранена компактным футером (требование лицензии).
@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state() isVisible = false;
  @state() private quests: TerronDailyQuest[] | null = null;
  @state() private questsLoading = false;
  @state() private mapName: string | null = null;

  createRenderRoot() {
    return this;
  }

  private renderQuest(q: TerronDailyQuest) {
    const pct = q.threshold > 0 ? Math.min(1, q.progress / q.threshold) : 0;
    const done = q.claimed;
    const c = done ? "#639922" : "#BA7517";
    return html`<div
      style="background:#fdfcf7;border:0.5px solid rgba(0,0,0,.15);border-left:3px solid ${c};border-radius:0;padding:15px 17px"
    >
      <div style="display:flex;align-items:center;gap:13px">
        <span style="font-size:21px">${q.icon}</span>
        <div style="flex:1;min-width:0;text-align:left">
          <div style="font-weight:700;font-size:15px;color:#1a1a1a">
            ${translateText(`daily.${q.id}.title`)}
          </div>
          <div style="font-size:12.5px;color:#1a1a1a;opacity:.7;margin-top:2px">
            ${n(q.progress)} / ${n(q.threshold)} ·
            <b style="color:${c}">+${q.reward} ${td("reward_lts")}</b>
          </div>
        </div>
        ${done
          ? html`<span style="color:#639922;font-size:13px;font-weight:700"
              >${td("claimed")} ✓</span
            >`
          : ""}
      </div>
      <div
        style="height:7px;background:rgba(0,0,0,.1);overflow:hidden;margin-top:12px"
      >
        <div style="width:${Math.round(pct * 100)}%;height:100%;background:${c}"></div>
      </div>
    </div>`;
  }

  render() {
    const isVisible = this.isVisible;
    const hasQuests = this.quests && this.quests.length > 0;
    return html`
      <style>
        @keyframes terron-load-dots {
          0%,
          80%,
          100% {
            opacity: 0.2;
          }
          40% {
            opacity: 1;
          }
        }
        .terron-load-dot {
          display: inline-block;
          animation: terron-load-dots 1.2s infinite ease-in-out both;
        }
        .terron-load-dot:nth-child(2) {
          animation-delay: 0.15s;
        }
        .terron-load-dot:nth-child(3) {
          animation-delay: 0.3s;
        }
      </style>
      <div
        class="fixed inset-0 bg-black/55 backdrop-blur-[4px] z-[9998] transition-all duration-300 ${isVisible
          ? "opacity-100 visible"
          : "opacity-0 invisible"}"
      ></div>
      <div
        class="fixed top-1/2 left-1/2 z-[9999] transition-all duration-300 -translate-x-1/2 ${isVisible
          ? "opacity-100 visible -translate-y-1/2"
          : "opacity-0 invisible -translate-y-[48%]"}"
        style="width:min(92vw,480px);background:#f5f1e6;color:#1a1a1a;border:1px solid rgba(0,0,0,.18);border-radius:0;box-shadow:0 24px 70px rgba(0,0,0,.45);padding:40px 38px 34px;text-align:center"
      >
        <div
          style="font-family:var(--t-display,inherit);text-transform:uppercase;letter-spacing:.04em;font-weight:800;font-size:25px;line-height:1.1"
        >
          ${translateText("game_starting_modal.loading_map")}<span
            class="terron-load-dot"
            >.</span
          ><span class="terron-load-dot">.</span
          ><span class="terron-load-dot">.</span>
        </div>
        ${this.mapName
          ? html`<div
              style="margin-top:10px;font-family:var(--t-display,inherit);text-transform:uppercase;letter-spacing:.05em;font-weight:800;font-size:18px;color:#BA7517"
            >
              ${this.mapName}
            </div>`
          : ""}

        ${this.questsLoading
          ? html`<div style="margin-top:30px;opacity:.55;font-size:13px">
              ${translateText("game_starting_modal.quests_title")}…
            </div>`
          : hasQuests
            ? html`<div style="margin-top:30px">
                <div
                  style="font-family:var(--t-display,inherit);text-transform:uppercase;letter-spacing:.03em;font-weight:700;font-size:13px;opacity:.6;margin-bottom:14px;text-align:left"
                >
                  ${translateText("game_starting_modal.quests_title")}
                </div>
                <div style="display:flex;flex-direction:column;gap:12px">
                  ${this.quests!.map((q) => this.renderQuest(q))}
                </div>
              </div>`
            : ""}
        <a
          href="/copyrights"
          target="_blank"
          rel="noopener noreferrer"
          style="display:block;margin-top:28px;font-size:11px;opacity:.4;color:inherit;text-decoration:none;letter-spacing:.02em"
          >${L(
            "Авторство и лицензии",
            "Credits & licenses",
          )}</a
        >
      </div>
    `;
  }

  show(mapName?: string | null) {
    this.isVisible = true;
    this.mapName = mapName ?? null;
    // подтянуть квесты на сегодня (только если ещё не загружены в этой сессии)
    if (this.quests === null && !this.questsLoading) {
      this.questsLoading = true;
      void getDailyQuests()
        .then((r) => {
          this.quests = r?.quests ?? [];
        })
        .catch(() => {
          this.quests = [];
        })
        .finally(() => {
          this.questsLoading = false;
          this.requestUpdate();
        });
    }
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }
}

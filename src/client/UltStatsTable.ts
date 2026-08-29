// terron 26.08: /ults/stats — ОБЩАЯ ТАБЛИЦА ВИНРЕЙТА УЛЬТ, публичная
// (решение владельца: «просто в паблик их вывести… не такая секретная
// информация»). Вторая вкладка страницы дерева ульт; та же ручка и тот же
// кэш, что у вкладки «Статистика» в карточке узла (UltStats.ts).
//
// ⚠️ ЧЕСТНОСТЬ ЧИСЕЛ — ГЛАВНОЕ ТРЕБОВАНИЕ К ЭТОЙ СТРАНИЦЕ:
//  1) сравниваем со СРЕДНИМ ПО ВЫБРАВШИМ УЛЬТУ, а не с винрейтом безультовых:
//     до слота доживает тот, кто уже выигрывал (см. шапку UltStats.ts);
//  2) рядом с процентом ВСЕГДА стоит число выборов — «75% на 12 матчах» без
//     него читается как имба и приносит волну «нерфи»;
//  3) при выборке меньше порога дельту не рисуем вовсе.
// ⚠️ Секретные ульты в таблицу не пускаем: их имя скрыто в самой игре («????»).
import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { refreshDisabledUlts } from "./DisabledUlts";
import { softGo } from "./SoftNavigate";
import {
  avgWinRate,
  liveUltRows,
  loadUltStats,
  ULT_STATS_MIN_PICKS,
  ultDelta,
  UltStatsData,
  UltStatsWindow,
} from "./UltStats";
import { unitMeta } from "./UnitCatalog";
import { L, translateText } from "./Utils";

type SortBy = "picks" | "winRate";

const STYLE_ID = "ult-stats-styles";

/**
 * ⚠️ На телефоне таблица не влезала, и за край уезжал САМЫЙ НУЖНЫЙ столбец —
 * винрейт (человек ровно за ним и пришёл). Горизонтальный скролл есть, но
 * листать вбок ради главной цифры — не ответ. Прячем «Долю»: она справочная,
 * а число выборов рядом и так стоит.
 */
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
    /* Короткая «Δ» — только на узком экране; на десктопе шапка полная. */
    .ult-delta-short { display: none }
    @media (max-width: 620px) {
      .ult-share-col { display: none }
      .ult-delta-long { display: none }
      .ult-delta-short { display: inline }
      /* ⚠️ !important не для красоты: тема скоупит таблицу селектором
         body:not(.in-game) .t-table td — он специфичнее любого одиночного
         класса, и без этого отступы 14px остаются, а Δ уезжает за край. */
      .ult-stats-tbl th, .ult-stats-tbl td {
        padding: 9px 6px !important; font-size: 12.5px !important;
      }
    }`;
  document.head.appendChild(st);
}

@customElement("ult-stats-table")
export class UltStatsTable extends LitElement {
  @state() private data: UltStatsData | null = null;
  @state() private loading = true;
  @state() private win: UltStatsWindow = "30";
  @state() private sortBy: SortBy = "picks";
  @state() private offUlts = new Set<string>();

  createRenderRoot() {
    return this; // light DOM — наследуем тему сайта
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensureStyles();
    void this.load();
    // Рубильник раскатки (TERRON_DISABLED_ULTS): выключенные ульты дерево не
    // рисует вовсе — в таблице их тоже быть не должно, иначе игрок увидит
    // винрейт того, чего в игре нет. Сеть легла → показываем всё.
    void refreshDisabledUlts().then((list) => {
      if (list.length > 0) this.offUlts = new Set(list);
    });
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.data = await loadUltStats(this.win);
    this.loading = false;
  }

  private setWindow(w: UltStatsWindow) {
    if (this.win === w) return;
    this.win = w;
    void this.load();
  }

  private nameOf(raw: string): string {
    const key = unitMeta(raw)?.key;
    return key === undefined ? raw : translateText("unit_type." + key);
  }

  private rows() {
    const d = this.data;
    if (d === null) return [];
    const rows = liveUltRows(d.ultimates, this.offUlts);
    return this.sortBy === "picks"
      ? [...rows].sort((a, b) => b.picks - a.picks)
      : [...rows].sort((a, b) => b.winRate - a.winRate);
  }

  private renderToggle(): TemplateResult {
    const btn = (
      on: boolean,
      label: string,
      onClick: () => void,
    ): TemplateResult => html`<button
      @click=${onClick}
      style="padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid var(--t-ink,#2b2a24);background:${on
        ? "var(--t-ink,#2b2a24)"
        : "transparent"};color:${on ? "#fff" : "var(--t-ink,#2b2a24)"}"
    >
      ${label}
    </button>`;
    return html`<div
      style="display:flex;gap:14px;flex-wrap:wrap;margin:10px 0 14px"
    >
      <div style="display:flex">
        ${btn(this.win === "30", L("30 дней", "30 days"), () =>
          this.setWindow("30"),
        )}
        ${btn(this.win === "all", L("всё время", "all time"), () =>
          this.setWindow("all"),
        )}
      </div>
      <div style="display:flex">
        ${btn(this.sortBy === "picks", L("по выборам", "by picks"), () => {
          this.sortBy = "picks";
        })}
        ${btn(this.sortBy === "winRate", L("по винрейту", "by win rate"), () => {
          this.sortBy = "winRate";
        })}
      </div>
    </div>`;
  }

  render(): TemplateResult {
    if (this.loading && this.data === null) {
      return html`<p style="opacity:.6">${L("Считаю…", "Crunching…")}</p>`;
    }
    const d = this.data;
    if (d === null) {
      return html`<p style="opacity:.7">
        ${L("Статистика недоступна.", "Stats unavailable.")}
      </p>`;
    }
    const avg = avgWinRate(d);
    const rows = this.rows();
    return html`<div style="max-width:820px">
      <p style="font-size:13.5px;line-height:1.6;margin:0">
        ${L(
          "Что игроки берут в слот ульты и чем это кончается. Только матчи против живых игроков, дев-сервер и полигон не в счёт.",
          "What players put in the ultimate slot, and how it ends. Live-player matches only; the dev server and test ground are excluded.",
        )}
      </p>
      ${this.renderToggle()}
      <div style="font-size:12px;opacity:.7;line-height:1.6;margin-bottom:10px">
        ${L(
          `Партий с выбранной ультой: ${d.reachGames} · игроков: ${d.reachUsers} · выборов: ${d.picksTotal}. Средний винрейт выбравших любую ульту — ${avg}%.`,
          `Games with an ultimate picked: ${d.reachGames} · players: ${d.reachUsers} · picks: ${d.picksTotal}. Average win rate across all picked ultimates — ${avg}%.`,
        )}
      </div>
      <div style="overflow-x:auto">
        <table class="t-table ult-stats-tbl" style="width:100%">
          <thead>
            <tr>
              <th style="text-align:left">${L("Ульта", "Ultimate")}</th>
              <th style="text-align:right">${L("Выборов", "Picks")}</th>
              <th class="ult-share-col" style="text-align:right">
                ${L("Доля", "Share")}
              </th>
              <th style="text-align:right">${L("Винрейт", "Win rate")}</th>
              <th style="text-align:right">
                <span class="ult-delta-long"
                  >${L("Δ к среднему", "Δ vs avg")}</span
                ><span class="ult-delta-short">Δ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => {
              const delta = ultDelta(d, r);
              const icon = unitMeta(r.ultimate)?.icon;
              const share =
                d.picksTotal > 0
                  ? Math.round((r.picks / d.picksTotal) * 1000) / 10
                  : 0;
              return html`<tr>
                <td>
                  <span style="display:inline-flex;align-items:center;gap:8px">
                    ${icon
                      ? html`<span
                          style="width:24px;height:24px;border-radius:50%;background:var(--t-ink,#2b2a24);display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto"
                          ><img src=${icon} alt="" style="width:15px;height:15px"
                        /></span>`
                      : ""}
                    <span style="font-weight:700"
                      >${this.nameOf(r.ultimate)}</span
                    >
                  </span>
                </td>
                <td style="text-align:right">${r.picks}</td>
                <td class="ult-share-col" style="text-align:right;opacity:.7">
                  ${share}%
                </td>
                <td style="text-align:right;font-weight:800">${r.winRate}%</td>
                <td style="text-align:right">
                  ${delta === null
                    ? html`<span
                        style="opacity:.45"
                        title=${L(
                          `Нужно от ${ULT_STATS_MIN_PICKS} выборов`,
                          `${ULT_STATS_MIN_PICKS}+ picks needed`,
                        )}
                        >—</span
                      >`
                    : html`<span
                        style="font-weight:800;color:${delta >= 0
                          ? "#2e7d32"
                          : "var(--t-red,#c0392b)"}"
                        >${delta > 0 ? "+" : ""}${delta}</span
                      >`}
                </td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
      <div
        style="font-size:11.5px;opacity:.65;line-height:1.6;margin-top:14px;border-top:1px solid rgba(0,0,0,.12);padding-top:10px"
      >
        <p style="margin:0 0 6px">
          ${L(
            `Δ — разница с ${avg}%, средним винрейтом среди тех, кто ульту вообще выбрал. Именно с ним и надо сравнивать: у игроков без ульты винрейт ${d.baseline.winRate}%, но это не слабость «безультовых» — просто до слота доживает тот, кто уже побеждал.`,
            `Δ is the gap to ${avg}%, the average win rate among players who picked any ultimate. That is the fair yardstick: players with no ultimate win ${d.baseline.winRate}% of the time, but that is survivorship, not weakness — you only reach the slot if you were already winning.`,
          )}
        </p>
        <p style="margin:0">
          ${L(
            `Строки с выборкой меньше ${ULT_STATS_MIN_PICKS} выборов идут без Δ. Ульты, которых нет в таблице, за период никто не выбирал — либо их сейчас нет в игре.`,
            `Rows with fewer than ${ULT_STATS_MIN_PICKS} picks show no Δ. Ultimates missing from the table were not picked in this period — or are not in the game right now.`,
          )}
        </p>
      </div>
      <div style="margin-top:12px;font-size:12.5px">
        <a
          href="/ults"
          @click=${(e: Event) => {
            if (softGo("/ults")) e.preventDefault();
          }}
          style="color:var(--t-red,#c0392b);font-weight:700"
          >${L("← К дереву ульт", "← Back to the ultimate tree")}</a
        >
      </div>
    </div>`;
  }
}

// terron 26.08: /history — ПРОТОТИП «История монарха».
//
// Идея владельца: пять точек биографии (где родился, где вырос, где учился,
// где работал, как пришёл к власти), у каждой пять вариантов, каждый вариант —
// мелкий баф (0.5–2 %). Собранные куски складываются и в сумму бонусов, и в
// связный текст: «Родился …, вырос …, учился …» — прогресс, который читается
// как биография, а не как список цифр.
//
// ⚠️ ЭТО ПРОТОТИП: выбор живёт ТОЛЬКО в localStorage этого браузера, на
// симуляцию не влияет вообще. Сервера, валидации и цены здесь нет намеренно —
// сперва смотрим, работает ли сама сборка на глаз.
import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { L, translateText } from "./Utils";

/** Двуязычная строка. ⚠️ L() в константах модуля фиксирует язык ДО выбора
 *  игрока — поэтому в данных лежат обе строки, а L() зовётся при отрисовке. */
type Bi = { ru: string; en: string };
const t = (x: Bi): string => L(x.ru, x.en);

/** Статы, на которые ложатся бафы. Набор нарочно маленький — это витрина. */
type StatKey =
  | "income"
  | "pop"
  | "attack"
  | "defense"
  | "mountains"
  | "build"
  | "navy";

const STATS: Record<StatKey, Bi & { icon: string }> = {
  income: { ru: "Доход", en: "Income", icon: "🪙" },
  pop: { ru: "Прирост населения", en: "Population growth", icon: "👥" },
  attack: { ru: "Сила атаки", en: "Attack", icon: "⚔️" },
  defense: { ru: "Защита", en: "Defense", icon: "🛡️" },
  mountains: { ru: "Проходимость по горам", en: "Mountain movement", icon: "⛰️" },
  build: { ru: "Дешевле постройки", en: "Cheaper buildings", icon: "🧱" },
  navy: { ru: "Скорость флота", en: "Fleet speed", icon: "⛵" },
};

const STAT_ORDER: StatKey[] = [
  "income",
  "pop",
  "attack",
  "defense",
  "mountains",
  "build",
  "navy",
];

type Choice = {
  id: string;
  /** Короткое имя карточки. */
  title: Bi;
  /** Кусок биографии — читается подряд с остальными выбранными. */
  line: Bi;
  buffs: Partial<Record<StatKey, number>>;
};

type Stage = {
  id: string;
  /** Заголовок этапа. */
  title: Bi;
  /** Вопрос над рядом карточек. */
  question: Bi;
  choices: Choice[];
};

const STAGES: Stage[] = [
  {
    id: "born",
    title: { ru: "Рождение", en: "Birth" },
    question: { ru: "Где родился", en: "Where they were born" },
    choices: [
      {
        id: "mountains",
        title: { ru: "Горное селение", en: "A mountain village" },
        line: {
          ru: "Родился в горном селении, где тропы знают раньше, чем буквы.",
          en: "Born in a mountain village, where trails are learned before letters.",
        },
        buffs: { mountains: 2 },
      },
      {
        id: "port",
        title: { ru: "Портовый город", en: "A port city" },
        line: {
          ru: "Родился в портовом городе, под крик чаек и скрип снастей.",
          en: "Born in a port city, under gulls and creaking rigging.",
        },
        buffs: { navy: 1.5 },
      },
      {
        id: "capital",
        title: { ru: "Столица", en: "The capital" },
        line: {
          ru: "Родился в столице, в двух кварталах от казначейства.",
          en: "Born in the capital, two blocks from the treasury.",
        },
        buffs: { income: 1 },
      },
      {
        id: "steppe",
        title: { ru: "Степное кочевье", en: "A steppe camp" },
        line: {
          ru: "Родился в кочевье: первый дом — седло, первая дорога — на восход.",
          en: "Born in a nomad camp: first home a saddle, first road eastward.",
        },
        buffs: { pop: 1, attack: 0.5 },
      },
      {
        id: "ashes",
        title: { ru: "Пепелище войны", en: "War ashes" },
        line: {
          ru: "Родился на пепелище — деревню отстроили в тот же год, но выше стенами.",
          en: "Born in the ashes — the village was rebuilt that year, with taller walls.",
        },
        buffs: { defense: 1.5 },
      },
    ],
  },
  {
    id: "raised",
    title: { ru: "Взросление", en: "Upbringing" },
    question: { ru: "Где вырос", en: "Where they grew up" },
    choices: [
      {
        id: "barracks",
        title: { ru: "Гарнизонная казарма", en: "A garrison barracks" },
        line: {
          ru: "Вырос при гарнизоне, среди чужой брани и чужих ран.",
          en: "Grew up in a garrison, among other men's oaths and wounds.",
        },
        buffs: { attack: 1 },
      },
      {
        id: "merchant",
        title: { ru: "Купеческий дом", en: "A merchant house" },
        line: {
          ru: "Вырос в купеческом доме, где счёт вели раньше молитвы.",
          en: "Grew up in a merchant house, where the ledger came before the prayer.",
        },
        buffs: { income: 1.5 },
      },
      {
        id: "village",
        title: { ru: "Крестьянская община", en: "A farming commune" },
        line: {
          ru: "Вырос в общине — там знают, сколько ртов кормит одно поле.",
          en: "Grew up in a commune, where everyone knows how many mouths one field feeds.",
        },
        buffs: { pop: 1.5 },
      },
      {
        id: "monastery",
        title: { ru: "Монастырь", en: "A monastery" },
        line: {
          ru: "Вырос за монастырской стеной, в тишине и распорядке.",
          en: "Grew up behind a monastery wall, in silence and routine.",
        },
        buffs: { defense: 1, pop: 0.5 },
      },
      {
        id: "smugglers",
        title: { ru: "Среди контрабандистов", en: "Among smugglers" },
        line: {
          ru: "Вырос на пристани у контрабандистов: товар без бумаг, ночь без огней.",
          en: "Grew up on smugglers' docks: cargo without papers, nights without lanterns.",
        },
        buffs: { navy: 1, income: 0.5 },
      },
    ],
  },
  {
    id: "studied",
    title: { ru: "Учение", en: "Schooling" },
    question: { ru: "Где учился", en: "Where they studied" },
    choices: [
      {
        id: "academy",
        title: { ru: "Военная академия", en: "A war academy" },
        line: {
          ru: "Учился в военной академии и запомнил, что манёвр дешевле штурма.",
          en: "Studied at a war academy and learned that a manoeuvre costs less than an assault.",
        },
        buffs: { attack: 1.5 },
      },
      {
        id: "university",
        title: { ru: "Университет", en: "A university" },
        line: {
          ru: "Учился в университете — на чертежах, а не на плацу.",
          en: "Studied at a university — over blueprints, not on the parade ground.",
        },
        buffs: { build: 1.5 },
      },
      {
        id: "guides",
        title: { ru: "У горных проводников", en: "With mountain guides" },
        line: {
          ru: "Учился у проводников: перевал зимой — тоже наука.",
          en: "Studied with mountain guides: a winter pass is a science too.",
        },
        buffs: { mountains: 2 },
      },
      {
        id: "seminary",
        title: { ru: "Духовная семинария", en: "A seminary" },
        line: {
          ru: "Учился в семинарии и понял, что слово держит строй не хуже копья.",
          en: "Studied at a seminary and learned that a word holds a line as well as a spear.",
        },
        buffs: { pop: 1, defense: 0.5 },
      },
      {
        id: "selftaught",
        title: { ru: "Нигде — самоучка", en: "Nowhere — self-taught" },
        line: {
          ru: "Нигде не учился: всё, что знает, взято из чужих ошибок.",
          en: "Studied nowhere: everything known was taken from other people's mistakes.",
        },
        buffs: {
          income: 0.5,
          pop: 0.5,
          attack: 0.5,
          defense: 0.5,
          mountains: 0.5,
          build: 0.5,
          navy: 0.5,
        },
      },
    ],
  },
  {
    id: "worked",
    title: { ru: "Ремесло", en: "Trade" },
    question: { ru: "Кем работал", en: "What they did for a living" },
    choices: [
      {
        id: "shipwright",
        title: { ru: "Инженер на верфи", en: "A shipyard engineer" },
        line: {
          ru: "Работал на верфи и спускал на воду то, что сам считал на бумаге.",
          en: "Worked at a shipyard, launching what they had calculated on paper.",
        },
        buffs: { navy: 2 },
      },
      {
        id: "taxman",
        title: { ru: "Сборщик податей", en: "A tax collector" },
        line: {
          ru: "Работал сборщиком податей — и знает, где казна течёт.",
          en: "Worked as a tax collector — and knows where the treasury leaks.",
        },
        buffs: { income: 2 },
      },
      {
        id: "officer",
        title: { ru: "Офицер пограничья", en: "A frontier officer" },
        line: {
          ru: "Служил на границе, где гарнизон меньше, чем нужно, всегда.",
          en: "Served on the frontier, where the garrison is always smaller than needed.",
        },
        buffs: { defense: 1.5, attack: 0.5 },
      },
      {
        id: "mine",
        title: { ru: "Управляющий рудником", en: "A mine overseer" },
        line: {
          ru: "Управлял рудником: камень, смета и сотня людей под землёй.",
          en: "Ran a mine: stone, budgets and a hundred people underground.",
        },
        buffs: { build: 1, mountains: 1 },
      },
      {
        id: "healer",
        title: { ru: "Лекарь", en: "A healer" },
        line: {
          ru: "Работал лекарем и считал людей поимённо, а не полками.",
          en: "Worked as a healer and counted people by name, not by regiment.",
        },
        buffs: { pop: 2 },
      },
    ],
  },
  {
    id: "power",
    title: { ru: "Власть", en: "Power" },
    question: { ru: "Как стал лидером", en: "How they came to power" },
    choices: [
      {
        id: "coup",
        title: { ru: "Военный переворот", en: "A military coup" },
        line: {
          ru: "Пришёл к власти переворотом — за одну ночь и без объяснений.",
          en: "Took power in a coup — in one night and with no explanations.",
        },
        buffs: { attack: 2 },
      },
      {
        id: "uprising",
        title: { ru: "Народное восстание", en: "A popular uprising" },
        line: {
          ru: "Поднят на щит восстанием: страну привели к нему, а не он к ней.",
          en: "Raised up by an uprising: the country came to them, not the other way round.",
        },
        buffs: { pop: 2 },
      },
      {
        id: "council",
        title: { ru: "Голосование совета", en: "A council vote" },
        line: {
          ru: "Избран советом — большинством в один голос, и его помнят все.",
          en: "Elected by the council — by a single vote, and everyone remembers it.",
        },
        buffs: { income: 1, build: 1 },
      },
      {
        id: "throne",
        title: { ru: "Наследовал трон", en: "Inherited the throne" },
        line: {
          ru: "Унаследовал трон вместе с долгами и удачно составленным завещанием.",
          en: "Inherited the throne along with the debts and a well-drafted will.",
        },
        buffs: { income: 2 },
      },
      {
        id: "outlived",
        title: { ru: "Пережил соперников", en: "Outlived the rivals" },
        line: {
          ru: "Просто пережил всех соперников — и это оказалось стратегией.",
          en: "Simply outlived every rival — and that turned out to be a strategy.",
        },
        buffs: { defense: 2 },
      },
    ],
  },
];

const STORAGE_KEY = "terron_history_proto";

/** Ряд этапа: пять карточек одной строкой, на узком экране складывается.
 *  ⚠️ Стили ставит сам компонент — общий terron-theme.css правят соседние
 *  сессии, а этот класс нужен ровно одной странице. */
function ensureHistoryStyles(): void {
  if (document.getElementById("terron-history-styles")) return;
  const el = document.createElement("style");
  el.id = "terron-history-styles";
  el.textContent = `
    .hist-row{display:grid;gap:8px;grid-template-columns:repeat(5,minmax(0,1fr))}
    @media (max-width:820px){.hist-row{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media (max-width:520px){.hist-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(el);
}

function loadPicks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function savePicks(picks: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
  } catch {
    /* приват-режим — прототипу переживём */
  }
}

/** Проценты печатаем без хвоста: 1.5 → «1,5», 2 → «2». */
function pct(n: number): string {
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return L(s.replace(".", ","), s);
}

@customElement("history-page")
export class HistoryPage extends BaseModal {
  protected routerName = "history";

  @state() private picks: Record<string, string> = {};

  protected modalConfig() {
    return { title: L("История монарха", "Ruler's history") };
  }

  protected onOpen(): void {
    ensureHistoryStyles();
    this.picks = loadPicks();
    this.requestUpdate();
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: L("История монарха", "Ruler's history"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  private pick(stageId: string, choiceId: string): void {
    const next = { ...this.picks };
    if (next[stageId] === choiceId) delete next[stageId];
    else next[stageId] = choiceId;
    this.picks = next;
    savePicks(next);
    this.requestUpdate();
  }

  private reset(): void {
    this.picks = {};
    savePicks({});
    this.requestUpdate();
  }

  private chosen(stage: Stage): Choice | null {
    const id = this.picks[stage.id];
    return stage.choices.find((c) => c.id === id) ?? null;
  }

  /** Сумма бафов по всем выбранным кускам. */
  private totals(): Partial<Record<StatKey, number>> {
    const acc: Partial<Record<StatKey, number>> = {};
    for (const stage of STAGES) {
      const c = this.chosen(stage);
      if (!c) continue;
      for (const [k, v] of Object.entries(c.buffs)) {
        const key = k as StatKey;
        acc[key] = (acc[key] ?? 0) + (v ?? 0);
      }
    }
    return acc;
  }

  private renderBuffTags(
    buffs: Partial<Record<StatKey, number>>,
    small = true,
  ): TemplateResult[] {
    return STAT_ORDER.filter((k) => (buffs[k] ?? 0) > 0).map(
      (k) => html`<span
        style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--t-ink);background:rgba(180,40,40,.08);padding:${small
          ? "1px 5px"
          : "3px 8px"};font-size:${small ? "11px" : "13px"};font-weight:700;white-space:nowrap"
        title=${t(STATS[k])}
      >
        ${STATS[k].icon} +${pct(buffs[k] ?? 0)}%
      </span>`,
    );
  }

  private renderCard(stage: Stage, choice: Choice): TemplateResult {
    const active = this.picks[stage.id] === choice.id;
    return html`<button
      @click=${() => this.pick(stage.id, choice.id)}
      style="
        text-align:left;
        border:1px solid var(--t-ink);
        background:${active ? "var(--t-ink)" : "var(--t-sheet)"};
        color:${active ? "var(--t-bg)" : "var(--t-ink)"};
        padding:8px 10px;
        display:flex;flex-direction:column;gap:6px;
        cursor:pointer;
        min-height:92px;
        box-shadow:${active ? "3px 3px 0 rgba(0,0,0,.25)" : "none"};
      "
    >
      <span
        style="font-family:var(--t-display);text-transform:uppercase;font-size:12.5px;line-height:1.25;letter-spacing:.02em"
      >
        ${t(choice.title)}
      </span>
      <span style="display:flex;flex-wrap:wrap;gap:4px;margin-top:auto">
        ${this.renderBuffTags(choice.buffs)}
      </span>
    </button>`;
  }

  private renderStage(stage: Stage, index: number): TemplateResult {
    const c = this.chosen(stage);
    return html`<section style="margin-bottom:18px">
      <div
        style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;border-bottom:1px solid var(--t-ink);padding-bottom:4px"
      >
        <span
          style="font-family:var(--t-display);font-size:13px;color:var(--t-red);font-weight:700"
          >${index + 1}/5</span
        >
        <span
          style="font-family:var(--t-display);text-transform:uppercase;font-size:15px;letter-spacing:.03em"
          >${t(stage.question)}</span
        >
        ${c
          ? html`<span
              style="margin-left:auto;font-size:12px;color:var(--t-muted,#6b6858)"
              >${t(c.title)}</span
            >`
          : html`<span
              style="margin-left:auto;font-size:12px;color:var(--t-muted,#6b6858)"
              >${L("не выбрано", "not chosen")}</span
            >`}
      </div>
      <div class="hist-row">
        ${stage.choices.map((ch) => this.renderCard(stage, ch))}
      </div>
    </section>`;
  }

  /** Собранная биография — то, ради чего всё и затевалось. */
  private renderStory(): TemplateResult {
    const lines = STAGES.map((s) => this.chosen(s)).filter(
      (c): c is Choice => c !== null,
    );
    const done = lines.length;
    return html`<div
      style="border:1px solid var(--t-ink);background:var(--t-parchment,var(--t-sheet));padding:12px 14px;margin-bottom:14px"
    >
      <div
        style="font-family:var(--t-display);text-transform:uppercase;font-size:13px;letter-spacing:.03em;margin-bottom:6px;display:flex;justify-content:space-between;gap:8px"
      >
        <span>${L("Летопись", "Chronicle")}</span>
        <span style="color:var(--t-red)">${done}/5</span>
      </div>
      ${done === 0
        ? html`<div
            style="font-size:13.5px;line-height:1.6;color:var(--t-muted,#6b6858);font-style:italic"
          >
            ${L(
              "Пока пусто. Выбери по одному эпизоду в каждой из пяти частей — они сложатся в биографию и в набор бонусов.",
              "Empty so far. Pick one episode in each of the five parts — they add up to a biography and to a set of bonuses.",
            )}
          </div>`
        : html`<div style="font-size:14px;line-height:1.7">
            ${lines.map((c) => html`${t(c.line)} `)}
          </div>`}
    </div>`;
  }

  private renderTotals(): TemplateResult {
    const totals = this.totals();
    const any = STAT_ORDER.some((k) => (totals[k] ?? 0) > 0);
    return html`<div
      style="border:1px solid var(--t-ink);background:var(--t-sheet);padding:12px 14px"
    >
      <div
        style="font-family:var(--t-display);text-transform:uppercase;font-size:13px;letter-spacing:.03em;margin-bottom:8px"
      >
        ${L("Итого к статам", "Total bonuses")}
      </div>
      ${any
        ? html`<div style="display:flex;flex-direction:column;gap:4px">
            ${STAT_ORDER.filter((k) => (totals[k] ?? 0) > 0).map(
              (k) => html`<div
                style="display:flex;align-items:center;gap:8px;font-size:13.5px"
              >
                <span style="width:20px;text-align:center">
                  ${STATS[k].icon}
                </span>
                <span style="flex:1 1 auto">${t(STATS[k])}</span>
                <span
                  style="font-weight:800;color:var(--t-red);font-variant-numeric:tabular-nums"
                >
                  +${pct(totals[k] ?? 0)}%
                </span>
              </div>`,
            )}
          </div>`
        : html`<div style="font-size:13px;color:var(--t-muted,#6b6858)">
            ${L("Ничего не выбрано.", "Nothing chosen yet.")}
          </div>`}
      <button
        @click=${() => this.reset()}
        style="margin-top:12px;width:100%;border:1px solid var(--t-ink);background:transparent;color:var(--t-ink);padding:6px 10px;font-family:var(--t-display);text-transform:uppercase;font-size:12px;letter-spacing:.05em;cursor:pointer"
      >
        ${L("Переписать историю", "Rewrite history")}
      </button>
    </div>`;
  }

  protected renderBody(): TemplateResult {
    return html`<div
      class="t-page"
      style="max-width:920px;color:var(--t-ink);font-size:14px"
    >
      <div
        style="border:1px dashed var(--t-ink);padding:6px 10px;margin-bottom:14px;font-size:12px;color:var(--t-muted,#6b6858)"
      >
        ${L(
          "Прототип. Выбор хранится только в этом браузере и на матчи пока не влияет.",
          "Prototype. Choices live in this browser only and do not affect matches yet.",
        )}
      </div>

      ${this.renderStory()}
      ${STAGES.map((s, i) => this.renderStage(s, i))}
      ${this.renderTotals()}
    </div>`;
  }
}

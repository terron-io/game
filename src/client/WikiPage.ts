import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UnitType } from "../core/game/Game";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  AI_BLOCKS,
  BUILDINGS,
  BUILDINGS_BLOCKS,
  Bi,
  Block,
  COMBAT_BLOCKS,
  DIPLOMACY_BLOCKS,
  ECONOMY_BLOCKS,
  Entry,
  Row,
  Skill,
  ULTS,
  ULT_RULES_BLOCKS,
  WORLD_BLOCKS,
  iconOf,
} from "./WikiContent";
import { L, translateText } from "./Utils";

// terron: /wiki — публичная БАЗА ЗНАНИЙ по игре («как устроено»). Не путать с
// /guide — тот про «как играть». Уровни адресов:
//   /wiki                — хаб разделов
//   /wiki/<section>      — раздел (ult, buildings, economy, combat, world, ai,
//                          diplomacy, speedrun)
//   /wiki/ult/<slug>     — карточка ульта или здания
//
// Этот файл — ТОЛЬКО роутинг и вёрстка. Весь текст и цифры живут в
// `WikiContent.ts`, а цифры туда приходят из `WikiNumbers.ts` (тот тянет их
// из Config/TerronTuning напрямую — правка баланса обновляет вики сама).
// Стиль — светлая тема сайта (body:not(.in-game)), как GuidePage.

const t = (b: Bi): string => L(b.ru, b.en);

const entryBySlug = (slug: string): Entry | undefined =>
  ULTS.find((u) => u.slug === slug) ?? BUILDINGS.find((u) => u.slug === slug);

// Старые/прямые ссылки на способности → на страницу их здания.
const SKILL_TO_BUILDING: Record<string, string> = {
  mirv: "nuclear_factory",
  split: "media",
};

// terron: разделы вики. Порядок = порядок карточек на /wiki. Новый раздел =
// строка здесь + ветка в renderSection().
interface WikiSection {
  id: string;
  title: () => string;
  hint: () => string;
}
const SECTIONS: WikiSection[] = [
  {
    id: "world",
    title: () => L("Мир и территория", "World and territory"),
    hint: () =>
      L(
        "Тайлы, рельеф, окружение, начало и конец матча, туман войны.",
        "Tiles, terrain, encirclement, match start and end, fog of war.",
      ),
  },
  {
    id: "economy",
    title: () => L("Экономика", "Economy"),
    hint: () =>
      L(
        "Откуда берутся деньги: доход, поезда, морская и воздушная торговля.",
        "Where money comes from: income, trains, sea and air trade.",
      ),
  },
  {
    id: "buildings",
    title: () => L("Здания", "Buildings"),
    hint: () =>
      L(
        "Цены, время постройки, стакинг уровней, столица и военные постройки.",
        "Prices, build times, level stacking, the capital and military structures.",
      ),
  },
  {
    id: "combat",
    title: () => L("Бой", "Combat"),
    hint: () =>
      L(
        "Как считается захват: рельеф, укрепления, ядерное оружие, флот, десант.",
        "How capture is calculated: terrain, fortifications, nukes, fleet, landings.",
      ),
  },
  {
    id: "ult",
    title: () => L("Ультимейты", "Ultimates"),
    hint: () =>
      L(
        "Одна мощная способность на матч: здания-штабы и то, что они открывают.",
        "One powerful ability per match: HQ buildings and what they unlock.",
      ),
  },
  {
    id: "ai",
    title: () => L("Нации и племена", "Nations and tribes"),
    hint: () =>
      L(
        "Чем нация отличается от племени и что меняет сложность.",
        "How a nation differs from a tribe and what difficulty changes.",
      ),
  },
  {
    id: "diplomacy",
    title: () => L("Дипломатия", "Diplomacy"),
    hint: () =>
      L(
        "Союзы, предательство, эмбарго, донаты и метки целей.",
        "Alliances, betrayal, embargoes, donations and target marks.",
      ),
  },
  {
    id: "speedrun",
    title: () => L("Спидран", "Speedrun"),
    hint: () =>
      L(
        "Правила зачёта забега: какие настройки лобби считаются базовыми.",
        "How a run qualifies: which lobby settings count as standard.",
      ),
  },
];

@customElement("wiki-page")
export class WikiPage extends BaseModal {
  protected routerName = "wiki";

  // "" = хаб; иначе id раздела.
  @state() private section = "";
  // "" = индекс раздела, иначе slug открытой карточки.
  @state() private ult = "";

  protected onOpen(args?: Record<string, unknown>): void {
    let slug = typeof args?.ult === "string" ? args.ult : "";
    slug = SKILL_TO_BUILDING[slug] ?? slug; // /wiki/ult/mirv → nuclear_factory
    this.ult = entryBySlug(slug) ? slug : "";
    if (this.ult) {
      // Карточки зданий живут в разделе «Здания», ульты — в своём.
      this.section = BUILDINGS.some((b) => b.slug === this.ult)
        ? "buildings"
        : "ult";
    } else {
      const s = typeof args?.section === "string" ? args.section : "";
      this.section = SECTIONS.some((x) => x.id === s) ? s : "";
    }
    this.syncTitle();
  }

  private goSection(id: string): void {
    this.section = SECTIONS.some((x) => x.id === id) ? id : "";
    this.ult = "";
    history.replaceState(
      history.state,
      "",
      this.section ? `/wiki/${this.section}` : "/wiki",
    );
    this.syncTitle();
  }

  // «Назад»: карточка → раздел, раздел → хаб, хаб → закрыть вики.
  private goBack(): void {
    if (this.ult) this.goSection(this.section || "ult");
    else if (this.section) this.goSection("");
    else this.close();
  }

  // Закрыли вики → вернуть брендовый заголовок (LangSelector держит "terron.io").
  protected onClose(): void {
    document.title = "terron.io";
  }

  private go(slug: string): void {
    this.ult = entryBySlug(slug) ? slug : "";
    history.replaceState(
      history.state,
      "",
      this.ult ? `/wiki/ult/${this.ult}` : `/wiki/${this.section || "ult"}`,
    );
    this.syncTitle();
  }

  // terron: заголовок вкладки/JS-краулеров (сервер уже кладёт его в сырой HTML
  // для OG-краулеров; LangSelector в i18n-цикле сбрасывает на "terron.io",
  // поэтому переустанавливаем — сразу И отложенно, чтобы выиграть гонку у
  // i18n-цикла при прямом заходе/refresh на /wiki/ult/<slug>).
  private syncTitle(): void {
    const e = this.ult ? entryBySlug(this.ult) : undefined;
    const sec = SECTIONS.find((x) => x.id === this.section);
    const title = e
      ? `${t(e.name)} — ${sec ? sec.title() : L("Вики", "Wiki")} · terron.io`
      : sec
        ? `${sec.title()} — ${L("вики TERRON", "TERRON wiki")} · terron.io`
        : `${L("Вики TERRON — гайд по игре", "TERRON Wiki — game guide")} · terron.io`;
    document.title = title;
    // Пока вики открыта — держим заголовок против пост-инициализационного
    // сброса LangSelector'ом (одноразовый отложенный ре-ассерт).
    requestAnimationFrame(() => {
      if (this.isOpen() && document.title !== title) document.title = title;
    });
    setTimeout(() => {
      if (this.isOpen() && document.title !== title) document.title = title;
    }, 400);
  }

  protected modalConfig() {
    return { title: L("Вики", "Wiki") };
  }

  private headerTitle(): string {
    const e = this.ult ? entryBySlug(this.ult) : undefined;
    if (e) return t(e.name);
    const sec = SECTIONS.find((x) => x.id === this.section);
    return sec ? sec.title() : L("Вики", "Wiki");
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: this.headerTitle(),
      onBack: () => this.goBack(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody(): TemplateResult {
    return html`<div
      class="t-page"
      style="max-width:680px;font-size:14px;line-height:1.65;color:var(--t-ink)"
    >
      ${this.ult
        ? this.renderDetail(this.ult)
        : this.section
          ? this.renderSection(this.section)
          : this.renderHub()}
    </div>`;
  }

  // Тёмный «чип» с белой SVG-иконкой (белые ассеты HUD не видны на светлом
  // фоне сайта — кладём на антрацитовый квадрат, как в лобби). Принимает и тип
  // юнита, и готовый URL (понятия без своего UnitType — столица, союз…).
  private iconChip(src: UnitType | string, size: number): TemplateResult {
    const icon =
      typeof src === "string" && src.includes("/") ? src : iconOf(src as UnitType);
    const pad = Math.round(size * 0.22);
    return html`<span
      style="display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:${size}px;height:${size}px;background:var(--t-ink,#2b2a24);border-radius:${Math.round(
        size * 0.18,
      )}px"
    >
      ${icon
        ? html`<img
            src=${icon}
            alt=""
            style="width:${size - pad * 2}px;height:${size - pad * 2}px"
          />`
        : ""}
    </span>`;
  }

  // ── /wiki — хаб разделов ──────────────────────────────────────────────────
  private renderHub(): TemplateResult {
    return html`
      <div
        style="padding:12px 14px;border-radius:12px;background:var(--t-sheet);font-weight:700;margin-bottom:14px"
      >
        ${L(
          "База знаний по TERRON: как устроены мир, экономика, бой и ультимейты — с точными цифрами из самой игры. Если ищешь советы «как играть», это в разделе «Обучение».",
          "The TERRON knowledge base: how the world, economy, combat and ultimates actually work — with exact numbers taken from the game itself. If you're after \"how to play\" advice, that's in the Guide.",
        )}
      </div>
      ${SECTIONS.map(
        (sec) => html`<button
          class="t-btn"
          style="display:flex;gap:12px;align-items:center;text-align:left;width:100%;padding:14px;margin-bottom:10px;color:var(--t-parchment,#fff)"
          @click=${() => this.goSection(sec.id)}
        >
          <span style="min-width:0">
            <span
              style="display:block;font-family:var(--t-display,sans-serif);font-weight:800;font-size:15px;color:var(--t-parchment,#fff)"
              >${sec.title()}</span
            >
            <span style="font-size:12.5px;color:rgba(255,255,255,.65)"
              >${sec.hint()}</span
            >
          </span>
          <span style="margin-left:auto;color:#e6a07a;font-size:20px">›</span>
        </button>`,
      )}
    `;
  }

  private renderSection(id: string): TemplateResult {
    switch (id) {
      case "buildings":
        return this.renderBlocks(BUILDINGS_BLOCKS);
      case "economy":
        return this.renderBlocks(ECONOMY_BLOCKS);
      case "combat":
        return this.renderBlocks(COMBAT_BLOCKS);
      case "world":
        return this.renderBlocks(WORLD_BLOCKS);
      case "ai":
        return this.renderBlocks(AI_BLOCKS);
      case "diplomacy":
        return this.renderBlocks(DIPLOMACY_BLOCKS);
      case "speedrun":
        return this.renderSpeedrun();
      default:
        return this.renderUltIndex();
    }
  }

  // ── рендер блоков контента ────────────────────────────────────────────────
  private renderBlocks(blocks: Block[]): TemplateResult {
    return html`${blocks.map((b) => this.renderBlock(b))}`;
  }

  private renderBlock(b: Block): TemplateResult {
    switch (b.kind) {
      case "lead":
        return html`<div
          style="padding:12px 14px;border-radius:12px;background:var(--t-sheet);font-weight:700;margin-bottom:14px"
        >
          ${t(b.text)}
        </div>`;
      case "h":
        return this.sectionHeading(t(b.text));
      case "p":
        return html`<p style="margin:0 0 12px;color:var(--t-ink)">
          ${t(b.text)}
        </p>`;
      case "ul":
        return html`<ul style="padding-left:20px;margin:0 0 14px;list-style:disc">
          ${b.items.map((i) => html`<li style="margin-bottom:7px">${t(i)}</li>`)}
        </ul>`;
      case "rows":
        return html`<div style="margin:0 0 14px">
          ${b.rows.map((r) => this.renderRow(r))}
        </div>`;
      case "note":
        return html`<div
          style="margin:0 0 14px;padding:12px 14px;border-radius:12px;background:rgba(43,42,36,.05);border-left:4px solid var(--t-red,#a8432b);font-size:13.5px;line-height:1.6"
        >
          ${b.title
            ? html`<div
                style="font-family:var(--t-display,sans-serif);font-weight:800;font-size:14px;margin-bottom:4px"
              >
                ${t(b.title)}
              </div>`
            : ""}
          ${t(b.text)}
        </div>`;
      case "cards":
        return html`<div
          style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px;margin:0 0 18px"
        >
          ${b.slugs
            .map((s) => entryBySlug(s))
            .filter((e): e is Entry => e !== undefined)
            .map((e) => this.gridCard(e.type, t(e.name), () => this.go(e.slug)))}
        </div>`;
    }
  }

  // Строка «показатель → значение» с иконкой слева.
  private renderRow(r: Row): TemplateResult {
    return html`<div
      style="display:flex;gap:11px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:var(--t-sheet);margin-bottom:8px"
    >
      ${r.icon !== undefined ? this.iconChip(r.icon, 30) : ""}
      <div style="min-width:0">
        <div
          style="font-family:var(--t-display,sans-serif);font-weight:800;font-size:13.5px;color:var(--t-ink);margin-bottom:2px"
        >
          ${t(r.k)}
        </div>
        <div style="font-size:13.5px;line-height:1.55;color:var(--t-ink)">
          ${t(r.v)}
        </div>
      </div>
    </div>`;
  }

  private sectionHeading(label: string): TemplateResult {
    return html`<div
      style="display:flex;align-items:center;gap:8px;margin:26px 0 10px;font-family:var(--t-display,sans-serif);font-weight:800;font-size:16px;color:var(--t-ink)"
    >
      <span
        style="display:inline-block;width:4px;height:18px;border-radius:2px;background:var(--t-red,#a8432b)"
      ></span>
      ${label}
    </div>`;
  }

  // ── /wiki/speedrun — правила зачёта забега ────────────────────────────────
  // Цифры и список отклонений держим В СООТВЕТСТВИИ с серверным предикатом
  // platform-api/src/speedrun.ts (speedrunConfigViolations) — он источник истины.
  private renderSpeedrun(): TemplateResult {
    const rules: string[] = [
      L("карта — Мир, режим — каждый против каждого", "map World, Free For All mode"),
      L("онлайн-лобби: приватное или публичное (офлайн не считается)", "an online lobby: private or public (offline doesn't count)"),
      L("400 ботов и нации по умолчанию", "400 bots and default nations"),
      L("без читов хоста, стартового золота и множителей", "no host cheats, starting gold or multipliers"),
      L("без отключённых юнитов, донатов и тумана войны", "no disabled units, donations or fog of war"),
      L("иммунитет спавна — стандартные 5 секунд", "spawn immunity at the standard 5 seconds"),
      L("ты в аккаунте и победил, матч длился дольше минуты", "you are signed in and won, and the match lasted over a minute"),
    ];
    return html`
      <div
        style="padding:12px 14px;border-radius:12px;background:var(--t-sheet);font-weight:700;margin-bottom:14px"
      >
        ${L(
          "Спидран — лучшее время от спавна до победы. Категории: четыре сложности × соло / несколько игроков.",
          "A speedrun is your best spawn-to-victory time. Categories: four difficulties × solo / multiplayer.",
        )}
      </div>
      ${this.sectionHeading(L("Забег засчитывается, если", "A run counts when"))}
      <ul style="padding-left:20px;margin:0 0 14px;list-style:disc">
        ${rules.map((r) => html`<li style="margin-bottom:6px">${r}</li>`)}
      </ul>
      <div
        style="padding:12px 14px;border-radius:12px;background:var(--t-sheet);font-size:13.5px;line-height:1.6"
      >
        ${L(
          "Любое отклонение от базовых настроек — и матч в топ не идёт: настройки проверяются на сервере по сохранённому конфигу. Чтобы не гадать, создавай лобби кнопкой «Создать лобби» на вкладке «Спидран» — она открывает игру с базовым конфигом и блокирует поля, кроме сложности. Если победа всё же не попала в топ, причина будет видна в разделе «Мои исключённые матчи» там же.",
          "Any deviation from the standard settings keeps the match out of the leaderboard: the server validates the stored config. To avoid guessing, use the \"Create lobby\" button on the Speedrun tab — it opens a game with the standard config and locks every field except difficulty. If a win still misses the leaderboard, the reason is listed under \"My excluded matches\" on the same tab.",
        )}
      </div>
    `;
  }

  // ── /wiki/ult — сетка ульт-зданий + подраздел активных способностей ────────
  private renderUltIndex(): TemplateResult {
    const skills = ULTS.filter((u) => u.skill);
    return html`
      <div
        style="padding:12px 14px;border-radius:12px;background:var(--t-sheet);font-weight:700;margin-bottom:14px"
      >
        ${L(
          "Ультимейт — мощная способность, одна на матч. Выбор фиксируется первым использованием. Почти все ульты — это ЗДАНИЯ-штабы: эффект работает, пока штаб жив. Нажми на иконку, чтобы прочитать детали с точными цифрами.",
          "An ultimate is a powerful once-per-match ability. Your choice locks in on first use. Almost every ultimate is an HQ BUILDING — the effect works while the HQ stands. Tap an icon to read the details with exact numbers.",
        )}
      </div>
      <div
        style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px"
      >
        ${ULTS.map((u) => this.gridCard(u.type, t(u.name), () => this.go(u.slug)))}
      </div>

      ${this.sectionHeading(L("Активные способности", "Active abilities"))}
      <div class="t-muted" style="margin:0 0 12px;font-size:13px">
        ${L(
          "Не строятся напрямую — их разблокирует здание-штаб. Открой его страницу, чтобы прочитать про способность.",
          "Not built directly — an HQ building unlocks them. Open its page to read about the ability.",
        )}
      </div>
      ${skills.map((u) => {
        const s = u.skill!;
        return html`<button
          class="t-btn"
          style="display:flex;gap:12px;align-items:center;text-align:left;width:100%;padding:12px 14px;margin-bottom:10px;color:var(--t-parchment,#fff)"
          @click=${() => this.go(u.slug)}
        >
          ${this.iconChip(s.type, 40)}
          <span style="min-width:0">
            <span
              style="display:block;font-family:var(--t-display,sans-serif);font-weight:800;font-size:15px;color:var(--t-parchment,#fff)"
              >${t(s.name)}</span
            >
            <span style="font-size:12.5px;color:rgba(255,255,255,.65)"
              >${L("Чтобы использовать — постройте", "To use it, build")}
              «${t(u.name)}»</span
            >
          </span>
          <span style="margin-left:auto;color:#e6a07a;font-size:20px">›</span>
        </button>`;
      })}

      ${this.renderBlocks(ULT_RULES_BLOCKS)}
    `;
  }

  private gridCard(
    type: UnitType,
    label: string,
    onClick: () => void,
  ): TemplateResult {
    return html`<button
      class="t-btn"
      style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 8px;text-align:center;color:var(--t-parchment,#fff)"
      @click=${onClick}
    >
      ${this.iconChip(type, 48)}
      <span
        style="font-family:var(--t-display,sans-serif);font-weight:800;font-size:12.5px;line-height:1.2;color:var(--t-parchment,#fff)"
        >${label}</span
      >
    </button>`;
  }

  // ── /wiki/ult/<slug> — детальная страница ─────────────────────────────────
  private renderDetail(slug: string): TemplateResult {
    const e = entryBySlug(slug);
    if (!e) return this.renderUltIndex();
    return html`
      <div
        style="display:flex;gap:14px;align-items:center;padding:14px;border-radius:12px;background:var(--t-sheet);margin-bottom:14px"
      >
        ${this.iconChip(e.type, 64)}
        <div style="min-width:0">
          <div
            style="font-family:var(--t-display,sans-serif);font-weight:800;font-size:20px;color:var(--t-ink)"
          >
            ${t(e.name)}
          </div>
          <div class="t-muted" style="font-size:13px;margin-top:2px">
            ${t(e.kind)}
          </div>
          <div
            style="font-size:12.5px;margin-top:4px;font-weight:700;color:var(--t-ink)"
          >
            ${t(e.cost)}
          </div>
        </div>
      </div>

      <div style="font-weight:800;color:var(--t-ink);margin:6px 0 6px">
        ${L("Что делает", "What it does")}
      </div>
      <div style="color:var(--t-ink)">${t(e.what)}</div>

      ${e.skill ? this.renderSkillBlock(e.skill) : ""}
      ${e.ref ? this.renderRefBlock(e.ref) : ""}

      <button
        class="t-btn"
        style="margin-top:18px;padding:10px 14px;color:var(--t-parchment,#fff)"
        @click=${() => this.goSection(this.section || "ult")}
      >
        ← ${L("Ко всем", "Back to all")}
      </button>
    `;
  }

  // Сноска-референс: на основе какой части истории родилась идея ульты.
  private renderRefBlock(ref: Bi): TemplateResult {
    return html`
      <div
        style="margin-top:16px;padding:12px 14px;border-radius:12px;background:rgba(43,42,36,.05);border:1px solid var(--t-line,rgba(43,42,36,.15))"
      >
        <div
          class="t-muted"
          style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px"
        >
          📎 ${L("Историческая справка", "Historical note")}
        </div>
        <div
          class="t-muted"
          style="font-size:13px;line-height:1.55;font-style:italic"
        >
          ${t(ref)}
        </div>
      </div>
    `;
  }

  // Блок разблокируемой активной способности (на странице её здания).
  private renderSkillBlock(s: Skill): TemplateResult {
    return html`
      <div
        style="margin-top:16px;padding:14px;border-radius:12px;background:rgba(58,125,68,.10);border-left:4px solid #3a7d44"
      >
        <div
          style="display:flex;gap:12px;align-items:center;margin-bottom:8px"
        >
          ${this.iconChip(s.type, 40)}
          <div>
            <div class="t-muted" style="font-size:12px">
              🔓 ${L("Разблокирует способность", "Unlocks ability")}
            </div>
            <div
              style="font-family:var(--t-display,sans-serif);font-weight:800;font-size:16px;color:var(--t-ink)"
            >
              ${t(s.name)}
            </div>
          </div>
        </div>
        <div style="color:var(--t-ink)">${t(s.what)}</div>
      </div>
    `;
  }
}

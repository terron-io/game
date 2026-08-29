import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { L, translateText } from "./Utils";

type GuideView =
  | ""
  | "start"
  | "upgrade"
  | "city"
  | "factory"
  | "port"
  | "defense"
  | "silo"
  | "sam"
  | "airport"
  | "ministry"
  | "fort"
  | "bank"
  | "aircmd"
  | "tanks"
  | "religion";

const GUIDE_VIEWS: GuideView[] = [
  "start",
  "upgrade",
  "city",
  "factory",
  "port",
  "defense",
  "silo",
  "sam",
  "airport",
  "ministry",
  "fort",
  "bank",
  "aircmd",
  "tanks",
  "religion",
];

// terron: /guide — хаб гайдов. /guide/start (как спавниться), /guide/upgrade
// (апгрейд/стак зданий). Текст апгрейда — по реальному конфигу: цена = pow(2,N)*
// 125k (кап 1M), N = сумма уровней → стак и разброс эквивалентны по цене/эффекту.
// Стиль — «карточный»/цветной (акценты --t-red, зелёные/янтарные callout'ы).
@customElement("guide-page")
export class GuidePage extends BaseModal {
  protected routerName = "guide";

  @state() private view: GuideView = "";

  protected onOpen(args?: Record<string, unknown>): void {
    const tab = typeof args?.tab === "string" ? args.tab : "";
    this.view = (GUIDE_VIEWS as string[]).includes(tab)
      ? (tab as GuideView)
      : "";
  }

  private go(view: GuideView): void {
    this.view = view;
    history.replaceState(history.state, "", view ? `/guide/${view}` : "/guide");
  }

  protected modalConfig() {
    return { title: L("Гайды", "Guides") };
  }

  private headerTitle(): string {
    switch (this.view) {
      case "start":
        return L("Старт: как заспавниться", "Start: how to spawn");
      case "upgrade":
        return L("Апгрейд зданий", "Upgrading buildings");
      case "city":
        return L("Город", "City");
      case "factory":
        return L("Фабрика", "Factory");
      case "port":
        return L("Порт", "Port");
      case "defense":
        return L("Оборонительный пост", "Defense Post");
      case "silo":
        return L("Ракетная шахта", "Missile Silo");
      case "sam":
        return L("ПВО (SAM)", "SAM Launcher");
      case "airport":
        return L("Аэропорт", "Airport");
      // terron 06.08: Мин правды влита в МЕДИА. Внутренний id темы оставлен
      // "ministry" (это же адрес /guide/ministry) — переименован только текст.
      case "ministry":
        return L("МЕДИА", "Media");
      case "fort":
        return L("Укрепления", "Fortifications");
      case "bank":
        return L("Центробанк", "Central Bank");
      case "aircmd":
        return L("Авиаштаб", "Air Command");
      case "tanks":
        return L("Танковый завод", "Tank Factory");
      case "religion":
        return L("Религия", "Religion");
      default:
        return L("Гайды", "Guides");
    }
  }

  protected renderHeaderSlot() {
    return modalHeader({
      // из под-гайда «назад» ведёт в хаб, из хаба — закрывает
      title: this.headerTitle(),
      onBack: () => (this.view === "" ? this.close() : this.go("")),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody(): TemplateResult {
    return html`<div
      class="t-page"
      style="max-width:680px;font-size:14px;line-height:1.65;color:var(--t-ink)"
    >
      ${this.view === "start"
        ? this.renderStart()
        : this.view === "upgrade"
          ? this.renderUpgrade()
          : this.view === ""
            ? this.renderIndex()
            : this.renderBuilding(this.view)}
    </div>`;
  }

  // ── общие «цветные» кирпичики ─────────────────────────────────────────────
  private section(
    text: string,
    accent = "var(--t-red,#a8432b)",
  ): TemplateResult {
    return html`<div
      style="display:flex;align-items:center;gap:8px;margin:20px 0 10px;font-family:var(--t-display,sans-serif);font-weight:800;font-size:16px;color:var(--t-ink)"
    >
      <span
        style="display:inline-block;width:4px;height:18px;border-radius:2px;background:${accent}"
      ></span>
      ${text}
    </div>`;
  }

  // callout: info (синий), tip (зелёный), warn (янтарный)
  private callout(
    kind: "info" | "tip" | "warn",
    content: string | TemplateResult,
  ): TemplateResult {
    const c =
      kind === "tip"
        ? ["#3a7d44", "rgba(58,125,68,.10)", "💡"]
        : kind === "warn"
          ? ["#b8860b", "rgba(184,134,11,.12)", "⚠️"]
          : ["#2f6fb0", "rgba(47,111,176,.10)", "ℹ️"];
    return html`<div
      style="display:flex;gap:10px;padding:10px 12px;border-radius:12px;background:${c[1]};border-left:4px solid ${c[0]};margin:8px 0"
    >
      <span style="font-size:16px;line-height:1.4">${c[2]}</span>
      <div>${content}</div>
    </div>`;
  }

  private step(n: number, title: string, body: string | TemplateResult) {
    return html`<div
      style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--t-line)"
    >
      <span
        style="flex:0 0 auto;width:26px;height:26px;border-radius:50%;background:var(--t-red,#a8432b);color:#fff;font-family:var(--t-display,sans-serif);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:14px"
        >${n}</span
      >
      <div>
        <div style="font-weight:800;color:var(--t-ink)">${title}</div>
        <div class="t-muted" style="font-size:13.5px;line-height:1.5">
          ${body}
        </div>
      </div>
    </div>`;
  }

  // ── хаб ───────────────────────────────────────────────────────────────────
  private guideCard(
    icon: string,
    title: string,
    desc: string,
    view: GuideView,
  ): TemplateResult {
    return html`<button
      class="t-btn"
      style="display:flex;gap:12px;align-items:center;text-align:left;width:100%;padding:14px;margin-bottom:10px;color:var(--t-parchment,#fff)"
      @click=${() => this.go(view)}
    >
      <span style="font-size:26px;line-height:1">${icon}</span>
      <span style="min-width:0">
        <span
          style="display:block;font-family:var(--t-display,sans-serif);font-weight:800;font-size:16px;color:var(--t-parchment,#fff)"
          >${title}</span
        >
        <span style="font-size:13px;color:rgba(255,255,255,.6)">${desc}</span>
      </span>
      <span style="margin-left:auto;color:#e6a07a;font-size:20px">›</span>
    </button>`;
  }

  private renderIndex(): TemplateResult {
    return html`
      <div
        style="padding:12px 14px;border-radius:12px;background:var(--t-sheet);font-weight:700;margin-bottom:6px"
      >
        ${L(
          "TERRON — стратегия захвата территории: расширяйся, строй города, фабрики и порты, воюй и заключай союзы. Эти гайды — короткая выжимка по главному.",
          "TERRON is a territory-conquest strategy: expand, build cities, factories and ports, fight and forge alliances. These guides are a short rundown of the essentials.",
        )}
      </div>
      <div class="t-muted" style="margin:0 0 12px;font-size:13px">
        ${L("С чего начать — по порядку:", "Where to start, in order:")}
      </div>
      ${this.guideCard(
        "🚀",
        L("Старт: как заспавниться", "Start: how to spawn"),
        L(
          "Первые шаги: выбор точки и расширение",
          "First steps: pick a spot and expand",
        ),
        "start",
      )}
      ${this.guideCard(
        "🏙️",
        L("Апгрейд зданий", "Upgrading buildings"),
        L("Стак или разброс — что выгоднее", "Stack or spread — what's better"),
        "upgrade",
      )}
      ${this.section(L("Здания", "Buildings"))}
      ${this.guideCard(
        "🏙️",
        L("Город", "City"),
        L("Растит население (армию)", "Grows population (your army)"),
        "city",
      )}
      ${this.guideCard(
        "🏭",
        L("Фабрика", "Factory"),
        L("Железные дороги и поезда → золото", "Railroads & trains → gold"),
        "factory",
      )}
      ${this.guideCard(
        "⚓",
        L("Порт", "Port"),
        L("Торговые корабли → золото", "Trade ships → gold"),
        "port",
      )}
      ${this.guideCard(
        "🛡️",
        L("Оборонительный пост", "Defense Post"),
        L("Защищает границу вокруг себя", "Shields the border around it"),
        "defense",
      )}
      ${this.guideCard(
        "🚀",
        L("Ракетная шахта", "Missile Silo"),
        L("Запуск ядерных ракет", "Launches nukes"),
        "silo",
      )}
      ${this.guideCard(
        "📡",
        L("ПВО (SAM)", "SAM Launcher"),
        L("Сбивает чужие ракеты", "Shoots down incoming nukes"),
        "sam",
      )}
      ${this.guideCard(
        "✈️",
        L("Аэропорт", "Airport"),
        L(
          "Торговые самолёты, десант и дроны",
          "Trade planes, airborne assaults & drones",
        ),
        "airport",
      )}
      ${this.section(L("Ультимейты", "Ultimates"))}
      <div class="t-muted" style="margin:0 0 10px;font-size:13px">
        ${L(
          "Один выбор на матч — слот справа в панели стройки. МИРВ или одно из зданий-штабов; выбор фиксируется первым применением.",
          "One pick per match — the rightmost slot in the build panel. MIRV or one of the HQ buildings; the pick locks in on first use.",
        )}
      </div>
      ${this.guideCard(
        "🏛️",
        L("МЕДИА", "Media"),
        L(
          "Переманивает население врагов, прикрывает предательство, даёт Раскол",
          "Lures enemy population, covers betrayal, unlocks Split",
        ),
        "ministry",
      )}
      ${this.guideCard(
        "🏰",
        L("Укрепления", "Fortifications"),
        L(
          "Бункеры дешевле, сильнее и сами тихо отжимают землю",
          "Cheaper, stronger posts that quietly seize land",
        ),
        "fort",
      )}
      ${this.guideCard(
        "🏦",
        L("Центробанк", "Central Bank"),
        L(
          "Лодки без перехвата, самолёты без пошлин",
          "Uninterceptable ships, toll-free planes",
        ),
        "bank",
      )}
      ${this.guideCard(
        "🛩️",
        L("Авиаштаб", "Air Command"),
        L(
          "Бесплатный десант без потерь",
          "Free airborne assaults at full strength",
        ),
        "aircmd",
      )}
      ${this.guideCard(
        "🛡️",
        L("Танковый завод", "Tank Factory"),
        L(
          "Атаки игнорируют вражеские бункеры",
          "Attacks ignore enemy defense posts",
        ),
        "tanks",
      )}
      ${this.guideCard(
        "⛩️",
        L("Религия", "Religion"),
        L(
          "Вся территория медленно расползается наружу сама",
          "Your whole territory slowly spreads outward on its own",
        ),
        "religion",
      )}
    `;
  }

  // ── /guide/<building> — гайды на здания (по реальному конфигу) ──────────────
  private buildingHero(icon: string, text: string): TemplateResult {
    return html`<div
      style="display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:12px;background:var(--t-sheet)"
    >
      <span style="font-size:30px;line-height:1">${icon}</span>
      <div style="font-weight:700">${text}</div>
    </div>`;
  }

  private fact(k: string, v: string | TemplateResult): TemplateResult {
    return html`<li style="margin-bottom:6px">
      <b>${k}:</b> <span class="t-muted">${v}</span>
    </li>`;
  }

  private renderBuilding(view: GuideView): TemplateResult {
    const ru = L("ru", "en") === "ru";
    switch (view) {
      case "city":
        return html`
          ${this.buildingHero(
            "🏙️",
            L(
              "Город увеличивает максимум населения — твою армию.",
              "A city raises your max population — your army.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Население", "Population"),
              L(
                "Каждый уровень города даёт +250k к лимиту войск (поверх прироста от территории).",
                "Each city level adds +250k to your troop cap (on top of territory growth).",
              ),
            )}
            ${this.fact(
              L("Цена", "Cost"),
              L(
                "Растёт по сумме уровней: 125k → 250k → 500k → 1M (кап). Свой счётчик, отдельный от порта/фабрики.",
                "Scales with total levels: 125k → 250k → 500k → 1M (cap). Own counter, separate from port/factory.",
              ),
            )}
          </ul>
          ${this.callout(
            "tip",
            L(
              "Города — основа армии. Строй их в тылу: потеря города = минус население.",
              "Cities are your army's backbone. Build them in the rear: losing one cuts your population.",
            ),
          )}
        `;
      case "factory":
        return html`
          ${this.buildingHero(
            "🏭",
            L(
              "Фабрика тянет железную дорогу; поезда между станциями приносят золото.",
              "A factory lays railroad; trains between stations earn gold.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Рельсы", "Rail"),
              L(
                "Соединяет твои здания ж/д в радиусе до 110 тайлов (мин. 15). Больше фабрик в разных местах = шире сеть.",
                "Connects your buildings by rail within ~110 tiles (min 15). More factories in more places = wider network.",
              ),
            )}
            ${this.fact(
              L("Доход", "Income"),
              L(
                "Поезда курсируют по сети и приносят золото; рельсы также быстро перебрасывают войска.",
                "Trains run the network and earn gold; rail also moves troops quickly.",
              ),
            )}
            ${this.fact(
              L("Цена", "Cost"),
              L(
                "Порт и фабрика делят счётчик цены (строишь порт — дорожает фабрика).",
                "Port and factory share a price counter (a port makes factories pricier too).",
              ),
            )}
          </ul>
          ${this.callout(
            "tip",
            L(
              "Ставь фабрики так, чтобы их радиусы связали города и порты в одну ж/д сеть.",
              "Place factories so their radii link cities and ports into one rail network.",
            ),
          )}
        `;
      case "port":
        return html`
          ${this.buildingHero(
            "⚓",
            L(
              "Порт шлёт торговые корабли к чужим портам — это золото.",
              "A port sends trade ships to other ports — that's gold.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Торговля", "Trade"),
              L(
                "Корабли плывут между твоим портом и портами других игроков. Чем длиннее маршрут — тем больше золота (до ~75k за рейс); короткие рейсы штрафуются.",
                "Ships sail between your port and other players' ports. Longer routes pay more (up to ~75k per trip); short trips are penalized.",
              ),
            )}
            ${this.fact(
              L("Где строить", "Where"),
              L("Только на побережье.", "Only on the coast."),
            )}
            ${this.fact(
              L("Цена", "Cost"),
              L(
                "Делит счётчик цены с фабрикой.",
                "Shares a price counter with the factory.",
              ),
            )}
          </ul>
          ${this.callout(
            "tip",
            L(
              "Порты на разных побережьях ловят больше маршрутов — шире торговля.",
              "Ports on different coastlines catch more routes — wider trade.",
            ),
          )}
        `;
      case "defense":
        return html`
          ${this.buildingHero(
            "🛡️",
            L(
              "Оборонительный пост держит границу вокруг себя.",
              "A defense post holds the border around it.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Радиус", "Range"),
              L("30 тайлов вокруг поста.", "30 tiles around the post."),
            )}
            ${this.fact(
              L("Защита", "Defense"),
              ru
                ? html`Атака по тайлам в радиусе <b>×5</b> дороже для врага и
                    его войска идут <b>×3</b> медленнее.`
                : html`Attacks on tiles in range cost the enemy <b>×5</b> more
                    and their troops move <b>×3</b> slower.`,
            )}
            ${this.fact(
              L("Наложение", "Overlap"),
              ru
                ? html`Бонус НЕ складывается: тайл под <b>двумя+</b> постами
                    защищён так же, как под одним (те же ×5 / ×3). Пересечение
                    радиусов — впустую; разноси посты, чтобы прикрыть
                    <b>больше</b> границы.`
                : html`Bonuses do NOT stack: a tile covered by <b>two+</b> posts
                    is defended the same as by one (still ×5 / ×3). Overlapping
                    radii are wasted — spread posts out to cover
                    <b>more</b> border.`,
            )}
          </ul>
          ${this.callout(
            "tip",
            L(
              "Ставь на стыках с агрессивными соседями и в узких проходах — там пост держит дольше всего. Не лепи посты вплотную: радиусы перекрываются впустую.",
              "Place on borders with aggressive neighbors and in choke points — that's where it holds best. Don't clump posts: overlapping radii are wasted.",
            ),
          )}
        `;
      case "silo":
        return html`
          ${this.buildingHero(
            "🚀",
            L(
              "Ракетная шахта запускает ядерные ракеты.",
              "A missile silo launches nukes.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Пуски", "Launches"),
              L(
                "Из шахты запускаешь атомную, водородную бомбу и MIRV (если хватает золота).",
                "From the silo you launch atom, hydrogen bombs and MIRV (if you can afford it).",
              ),
            )}
            ${this.fact(
              L("Перезарядка", "Cooldown"),
              L(
                "~9 секунд между пусками из одной шахты.",
                "~9 seconds between launches per silo.",
              ),
            )}
            ${this.fact(L("Цена", "Cost"), L("1M золота.", "1M gold."))}
          </ul>
          ${this.callout(
            "warn",
            L(
              "Шахта — приоритетная цель. Прячь её в тылу и прикрывай ПВО.",
              "A silo is a priority target. Keep it in the rear and cover it with SAM.",
            ),
          )}
        `;
      case "sam":
        return html`
          ${this.buildingHero(
            "📡",
            L(
              "ПВО (SAM) сбивает чужие ракеты в радиусе.",
              "SAM shoots down incoming nukes within its radius.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Перехват", "Intercept"),
              L(
                "Автоматически сбивает входящие ядерные ракеты в радиусе.",
                "Automatically downs incoming nukes inside its radius.",
              ),
            )}
            ${this.fact(
              L("Радиус", "Range"),
              L(
                "70 тайлов на 1 уровне, растёт с апгрейдом (до ~150).",
                "70 tiles at level 1, grows with upgrades (up to ~150).",
              ),
            )}
            ${this.fact(
              L("Перезарядка", "Cooldown"),
              L(
                "~9 секунд между перехватами.",
                "~9 seconds between intercepts.",
              ),
            )}
          </ul>
          ${this.callout(
            "tip",
            L(
              "Прикрывай ПВО города и шахты. Один SAM бьёт по одной ракете за раз — против залпа ставь несколько.",
              "Cover cities and silos with SAM. One SAM handles one missile at a time — against a salvo, build several.",
            ),
          )}
        `;
      case "airport":
        return html`
          ${this.buildingHero(
            "✈️",
            L(
              "Аэропорт открывает воздух: торговля, десант и дроны-камикадзе.",
              "The airport opens the skies: trade, airborne assaults and kamikaze drones.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Торговые самолёты", "Trade planes"),
              L(
                "Автоматически летают между аэропортами (своими и союзными) и приносят золото — как порт, только по воздуху и вдвое доходнее на той же дальности.",
                "Fly automatically between airports (yours and allies') and earn gold — like a port, but airborne and twice as profitable per distance.",
              ),
            )}
            ${this.fact(
              L("Десант", "Airborne assault"),
              L(
                "Высаживает войска в ЛЮБУЮ точку карты с ближайшего аэропорта. Половина гибнет при высадке, плацдарм 30с защищён от схлопывания. Стоит золото (дорожает с каждым разом).",
                "Drops troops ANYWHERE on the map from your nearest airport. Half are lost on landing; the beachhead is protected from collapse for 30s. Costs gold (price grows per use).",
              ),
            )}
            ${this.fact(
              L("Дрон-камикадзе", "Kamikaze drone"),
              L(
                "Мини-ядерка с ближайшего аэропорта: снимает территорию в точке удара, не превращая её в воду.",
                "A mini-nuke from your nearest airport: strips territory at the impact point without turning it into water.",
              ),
            )}
            ${this.fact(
              L("Пошлина за пролёт", "Flyover toll"),
              L(
                "Чужие торговые самолёты платят долю карго за пролёт над твоей территорией — земля на трассах приносит пассивное золото.",
                "Foreign trade planes pay a share of their cargo for crossing your land — territory under air routes earns passive gold.",
              ),
            )}
          </ul>
          ${this.callout(
            "warn",
            L(
              "ПВО сбивает десант и дроны. Перед высадкой проверь, нет ли рядом вражеского SAM.",
              "SAMs shoot down assaults and drones. Check for enemy SAM coverage before dropping.",
            ),
          )}
        `;
      case "ministry":
        return html`
          ${this.buildingHero(
            "🏛️",
            L(
              "МЕДИА — ульта: переманивает население врагов, прикрывает предательство и даёт Раскол.",
              "Media — an ultimate: it lures away enemy population, covers your betrayals and unlocks Split.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Аура", "Aura"),
              L(
                "Каждую секунду высасывает долю войск у КАЖДОГО врага, чья территория попала в радиус (вдвое больше радиуса авиабазы). Половина высосанного приходит тебе.",
                "Every second drains a share of troops from EVERY enemy whose land is inside the radius (twice the airport's). Half of the drained amount comes to you.",
              ),
            )}
            ${this.fact(
              L("Процент", "Percentage"),
              L(
                "Дренаж процентный: чем жирнее сосед — тем больше утекает.",
                "The drain is percentage-based: the fatter the neighbor, the more flows out.",
              ),
            )}
            ${this.fact(
              L("Предательство без метки", "Betrayal without the mark"),
              L(
                "Пока штаб стоит, разрыв союза НЕ вешает на тебя метку предателя.",
                "While the HQ stands, breaking an alliance does NOT brand you a traitor.",
              ),
            )}
            ${this.fact(
              L("Разблокирует Раскол", "Unlocks Split"),
              L(
                "Каст «Раскол» — сколько угодно раз, пока МЕДИА жива.",
                'Cast "Split" as many times as you like while Media stands.',
              ),
            )}
          </ul>
          ${this.callout(
            "tip",
            L(
              "Ставь штаб в гуще жирных соседей. Наведи мышь на здание — увидишь, сколько враги потеряли и сколько получил ты.",
              "Plant the HQ amid fat neighbors. Hover it to see how much enemies lost and how much you gained.",
            ),
          )}
        `;
      case "fort":
        return html`
          ${this.buildingHero(
            "🏰",
            L(
              "Укрепления — ульта: пока штаб стоит, твои бункеры сами отжимают землю.",
              "Fortifications — an ultimate: while the HQ stands, your defense posts seize land on their own.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Автозахват (тихо)", "Auto-capture (silent)"),
              L(
                "Каждый достроенный бункер раз в секунду захватывает ближайшие вражеские/ничейные тайлы в радиусе своей защиты — «куда достанет», в т.ч. ЧЕРЕЗ ВОДУ (прибрежные тайлы, островки). Захват ТИХИЙ: сосед не получает уведомления об атаке и не идёт в ответку.",
                "Every completed defense post grabs the nearest hostile/neutral tiles inside its protection radius each second — wherever it can reach, including ACROSS WATER (coastal tiles, islets). The capture is SILENT: the neighbor gets no attack alert and won't retaliate.",
              ),
            )}
            ${this.fact(
              L("Бонусы владельцу", "Owner perks"),
              L(
                "Бункеры на 20% дешевле, +20% к эффективности защиты и радиусу. Бонусы только у владельца штаба.",
                "Defense posts cost 20% less and gain +20% defense effectiveness and radius. Perks apply only to the HQ owner.",
              ),
            )}
            ${this.fact(
              L("Условие", "Condition"),
              L(
                "Работает только пока штаб укреплений жив. Снесли штаб — бункеры снова просто защищают.",
                "Works only while the Fortifications HQ is alive. HQ destroyed — posts go back to just defending.",
              ),
            )}
          </ul>
          ${this.callout(
            "tip",
            L(
              "Ставь бункеры у фронта или на берегу напротив врага — они отжимают всё, до чего дотянется радиус, даже островки через пролив.",
              "Place posts near the front or on a shore facing the enemy — they seize anything the radius reaches, even islets across a strait.",
            ),
          )}
        `;
      case "bank":
        return html`
          ${this.buildingHero(
            "🏦",
            L(
              "Центробанк — ульта: экономика под защитой.",
              "Central Bank — an ultimate: your economy, protected.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Лодки", "Trade ships"),
              L(
                "Твои торговые суда НЕЛЬЗЯ перехватить — военные корабли врага их игнорируют.",
                "Your trade ships CANNOT be intercepted — enemy warships ignore them.",
              ),
            )}
            ${this.fact(
              L("Самолёты", "Planes"),
              L(
                "Твои торговые самолёты не платят пошлину за пролёт над чужой территорией.",
                "Your trade planes pay no flyover tolls over foreign land.",
              ),
            )}
          </ul>
          ${this.callout(
            "tip",
            L(
              "Сильнее всего у морских/воздушных торговых империй с длинными маршрутами.",
              "Strongest for sea/air trade empires with long routes.",
            ),
          )}
        `;
      case "aircmd":
        return html`
          ${this.buildingHero(
            "🛩️",
            L(
              "Авиаштаб — ульта: десант становится главным оружием.",
              "Air Command — an ultimate: airborne assaults become your main weapon.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Цена", "Cost"),
              L(
                "Десант БЕСПЛАТНЫЙ (обычно 100k+ и дорожает с каждым разом).",
                "Assaults are FREE (normally 100k+ and rising per use).",
              ),
            )}
            ${this.fact(
              L("Высадка", "Landing"),
              L(
                "Садится 100% войск вместо половины.",
                "100% of troops land instead of half.",
              ),
            )}
            ${this.fact(
              L("Плацдарм", "Beachhead"),
              L(
                "Держится 60 секунд вместо 30 — время закрепиться вдвое больше.",
                "Holds for 60 seconds instead of 30 — twice the time to dig in.",
              ),
            )}
          </ul>
          ${this.callout(
            "warn",
            L(
              "ПВО по-прежнему сбивает десант — борт с войсками теряется целиком.",
              "SAMs still shoot down assaults — the craft and its troops are lost.",
            ),
          )}
        `;
      case "tanks":
        return html`
          ${this.buildingHero(
            "🛡️",
            L(
              "Танковый завод — ульта: броня не замечает бункеров.",
              "Tank Factory — an ultimate: armor ignores bunkers.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Мощь +15%", "Power +15%"),
              L(
                "Пока стоит Танковый завод, все твои атаки на 15% сильнее — меньше потерь войск.",
                "While the Tank Factory stands, all your attacks are 15% stronger — fewer troop losses.",
              ),
            )}
            ${this.fact(
              L("Прорыв", "Breakthrough"),
              L(
                "Твои атаки полностью игнорируют бонус защиты вражеских оборонительных постов — и по потерям, и по скорости.",
                "Your attacks fully ignore enemy defense post bonuses — both losses and speed.",
              ),
            )}
          </ul>
          ${this.callout(
            "tip",
            L(
              "Идеален против «черепах», обвешанных бункерами по всей границе.",
              "Perfect against turtles lining their whole border with defense posts.",
            ),
          )}
        `;
      case "religion":
        return html`
          ${this.buildingHero(
            "⛩️",
            L(
              "Религия — ульта: вера сама расширяет твои земли.",
              "Religion — an ultimate: faith expands your lands by itself.",
            ),
          )}
          ${this.section(L("Что даёт", "What it does"))}
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            ${this.fact(
              L("Тихий рост", "Silent growth"),
              L(
                "Пока стоит храм, ВСЯ твоя граница очень медленно расползается наружу — тихо, без «вас атакуют».",
                "While the temple stands, your ENTIRE border slowly creeps outward — quietly, with no attack alert.",
              ),
            )}
            ${this.fact(
              L("Обращает людей, не пустыри", "Converts people, not wasteland"),
              L(
                "Поглощает чужие земли — вражеские и даже союзные (вера не разбирает). Ничейную пустошь и радиоактивный пепел не трогает: обращать там некого.",
                "Absorbs foreign land — enemy and even allied (faith makes no distinction). Empty wasteland and radioactive fallout are left alone: nobody there to convert.",
              ),
            )}
            ${this.fact(
              L("Война глушит веру", "War silences faith"),
              L(
                "На того, с кем у тебя прямо сейчас идёт бой, вера не действует — ни когда он атакует тебя, ни когда ты его. Бой кончился — рост возобновится.",
                "Faith has no effect on anyone you are currently fighting — whether they attack you or you attack them. Once the fighting stops, the growth resumes.",
              ),
            )}
            ${this.fact(
              L("Храмов сколько угодно", "Build as many as you like"),
              L(
                "Каждый следующий храм ускоряет обращение на один тайл: 3 тайла с одним храмом, 4 с двумя, 5 с тремя. Строить можно по одному — следующий только после достройки предыдущего.",
                "Each extra temple adds one more tile: 3 tiles with one temple, 4 with two, 5 with three. One at a time though — the next can only start once the previous is finished.",
              ),
            )}
            ${this.fact(
              L("Через воду — узко", "Water — only narrow"),
              L(
                "Перешагивает узкую воду (реку, пролив), но не море к другому континенту или острову.",
                "Steps over narrow water (a river, a strait), but not the sea to another continent or island.",
              ),
            )}
            ${this.fact(
              L("Десятина: −10% за храм", "Tithe: −10% per temple"),
              L(
                "Цена веры: каждый храм срезает 10% от текущего дохода золота — 100 → 90 → 81 → 73. Жрецов надо на что-то содержать.",
                "The price of faith: every temple cuts 10% off your current gold income — 100 → 90 → 81 → 73. The clergy won't feed itself.",
              ),
            )}
          </ul>
          ${this.callout(
            "tip",
            L(
              "Медленно, но неотвратимо. Поставь храм в безопасном тылу — снесут здание, рост остановится.",
              "Slow but relentless. Place the temple in a safe rear — destroy the building and the growth stops.",
            ),
          )}
        `;
      default:
        return this.renderIndex();
    }
  }

  // ── /guide/start — как заспавниться ────────────────────────────────────────
  private renderStart(): TemplateResult {
    const ru = L("ru", "en") === "ru";
    return html`
      <div
        style="padding:12px 14px;border-radius:12px;background:var(--t-sheet);font-weight:700"
      >
        ${L(
          "В начале матча идёт фаза спавна — нужно выбрать, где появиться. После старта расширяешься, захватывая соседнюю землю.",
          "Each match starts with a spawn phase — you choose where to appear. After the start you expand by taking neighboring land.",
        )}
      </div>

      ${this.section(L("Шаги", "Steps"))}
      ${this.step(
        1,
        L("Дождись фазы спавна", "Wait for the spawn phase"),
        L(
          "Сверху идёт таймер спавна. Пока он идёт — выбираешь точку появления.",
          "A spawn timer runs at the top. While it ticks — you pick your spawn spot.",
        ),
      )}
      ${this.step(
        2,
        L("Тапни по суше", "Tap on land"),
        ru
          ? html`Нажми на любую <b>сушу</b> на карте — там появится твоя
              стартовая клетка. Тапни в другое место — точка
              <b>перенесётся</b> (пока не кончился таймер).`
          : html`Tap any <b>land</b> on the map — your starting cell appears
              there. Tap elsewhere to <b>move</b> it (until the timer runs out).`,
      )}
      ${this.step(
        3,
        L("Выбирай место с умом", "Pick the spot wisely"),
        L(
          "Лучше подальше от крупных соседей, ближе к воде и свободной земле — есть куда расти.",
          "Better away from big neighbors, near water and open land — room to grow.",
        ),
      )}
      ${this.step(
        4,
        L("Старт — расширяйся", "Start — expand"),
        ru
          ? html`Когда таймер кончится, игра началась.
              <b>Тапай по соседней земле</b> — туда уходят войска и захватывают
              её.`
          : html`When the timer ends, the game is on.
              <b>Tap neighboring land</b> — your troops go there and capture it.`,
      )}
      ${this.callout(
        "warn",
        L(
          "Не трать все войска на расширение — оставь часть на оборону, иначе тебя быстро съедят.",
          "Don't spend all troops expanding — keep some for defense, or you'll be eaten fast.",
        ),
      )}
      ${this.callout(
        "tip",
        L(
          "Захватывай нейтральную землю и слабых соседей в начале — это самый дешёвый прирост.",
          "Grab neutral land and weak neighbors early — it's the cheapest growth.",
        ),
      )}

      <div style="margin-top:18px">
        <button class="t-btn" @click=${() => this.go("upgrade")}>
          ${L("Дальше: апгрейд зданий →", "Next: upgrading buildings →")}
        </button>
      </div>
    `;
  }

  // ── /guide/upgrade — стак vs разброс (текст сохранён, оформлен в новый стиль) ─
  private renderUpgrade(): TemplateResult {
    const ru = L("ru", "en") === "ru";
    return html`
      ${this.callout(
        "info",
        L(
          "Короткий ответ: по золоту и населению стак и разброс — одно и то же. Решает позиция: стак экономит место, разброс надёжнее и шире покрытие.",
          "Short answer: in gold and population, stacking and spreading are the same. Position decides: stacking saves space, spreading is safer with wider coverage.",
        ),
      )}
      ${this.section(
        L("Цена считается по сумме уровней", "Cost scales with total levels"),
      )}
      <p style="margin:0 0 10px">
        ${ru
          ? html`Цена здания зависит от <b>суммы уровней</b> построек этого типа
              и удваивается: при сумме 0 — 125k, 1 — 250k, 2 — 500k, 3 и дальше
              — 1M (потолок). Поставить здание на такое же — это
              <b>апгрейд</b> (уровень +1), и для цены он считается как
              <b>ещё одна постройка</b>. То есть город ур. 3 для цены = три
              города.`
          : html`A building's price depends on the <b>sum of levels</b> of that
              type and doubles: at sum 0 — 125k, 1 — 250k, 2 — 500k, 3 and on —
              1M (cap). Placing a building on an identical one is an
              <b>upgrade</b> (level +1), and for pricing it counts as
              <b>another building</b>. So a level-3 city costs like three
              cities.`}
      </p>

      ${this.section(
        L("Стак vs разброс — цена одинакова", "Stack vs spread — same cost"),
      )}
      <ul style="margin:0 0 8px;padding-left:18px;line-height:1.8">
        <li>
          ${L("Стак до ур. 5", "Stack to lvl 5")}: 125k+250k+500k+1M+1M =
          <b>2.875M</b>
        </li>
        <li>
          ${L("5 городов вразброс", "5 separate cities")}: 125k+250k+500k+1M+1M
          = <b>2.875M</b>
        </li>
      </ul>
      <p style="margin:0 0 10px">
        ${L(
          "Ровно столько же. Экономии на стаке нет — для цены апгрейд = новая постройка.",
          "Exactly the same. No savings from stacking — an upgrade is priced like a new build.",
        )}
      </p>

      ${this.section(
        L("Население растёт так же?", "Does population still grow?"),
      )}
      <p style="margin:0 0 10px">
        ${L(
          "Да. Максимум войск = сумма уровней городов × 250k (плюс прирост от территории). Стак или вразброс — население одинаковое.",
          "Yes. Max troops = sum of city levels × 250k (plus territory growth). Stacked or spread — the population is the same.",
        )}
      </p>

      ${this.section(
        L("Тогда что решает? Позиция", "So what decides? Position"),
      )}
      <ul style="margin:0 0 10px;padding-left:18px;line-height:1.8">
        <li>
          ${ru
            ? html`<b>Стак:</b> экономит тайлы (одно здание вместо пяти). Но это
                <b>одна цель</b> — захватят или занюкают тайл, теряешь все
                уровни разом.`
            : html`<b>Stack:</b> saves tiles (one building instead of five). But
                it's <b>a single target</b> — capture or nuke that tile and you
                lose every level at once.`}
        </li>
        <li>
          ${ru
            ? html`<b>Разброс:</b> устойчивее (потерял одно — остальные целы) и
                даёт <b>покрытие</b>: фабрики тянут рельсы только в своём
                радиусе (больше фабрик в разных местах = шире ж/д), порты ловят
                торговлю с разных побережий.`
            : html`<b>Spread:</b> more resilient (lose one — the rest stand) and
                gives <b>coverage</b>: factories lay rail only within their
                radius (more factories in more places = wider rail), and ports
                catch trade from several coastlines.`}
        </li>
      </ul>

      ${this.section(
        L("Разные здания на один тайл?", "Different buildings on one tile?"),
      )}
      <p style="margin:0 0 10px">
        ${ru
          ? html`Нельзя. Апгрейд работает <b>только для того же типа</b>. Город,
              фабрику и порт ставишь на отдельные тайлы. Нюанс:
              <b>порт и фабрика делят счётчик цены</b> (строишь порт — дорожает
              и фабрика), у города счётчик свой.`
          : html`You can't. Upgrade works <b>only for the same type</b>. City,
              factory and port go on separate tiles. Note:
              <b>ports and factories share a price counter</b> (a port also
              makes factories pricier); cities have their own.`}
      </p>

      ${this.section(L("Итог", "Bottom line"))}
      <ul style="margin:0 0 4px;padding-left:18px;line-height:1.8">
        <li>
          ${L(
            "По золоту и населению — без разницы.",
            "In gold and population — no difference.",
          )}
        </li>
        <li>
          ${L(
            "По умолчанию разбрасывай: надёжность + покрытие (рельсы, побережья).",
            "Spread by default: resilience + coverage (rail, coastlines).",
          )}
        </li>
        <li>
          ${L(
            "Стак — когда мало места или хочешь сжать оборону в один кулак.",
            "Stack — when tile-constrained or concentrating your defense.",
          )}
        </li>
      </ul>
    `;
  }
}

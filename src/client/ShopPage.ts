import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../core/AssetUrls";
import {
  buyItem,
  createPayment,
  getCatalog,
  getPayPacks,
  getEconomyRules,
  getMyNamedSkins,
  getWallet,
  getWalletHistory,
  nameSkin,
  type PayPacks,
  type EconomyRules,
  type NamedSkin,
  type ShopItem,
  type WalletTx,
} from "./Api";
import { ourPaymentsAllowed } from "./PayGate";
import { BaseModal } from "./components/BaseModal";
import { coin } from "./components/ui/coin";
import { gemPile } from "./components/ui/gemPile";
import { reportPayFunnel } from "./PayFunnel";
import { modalHeader } from "./components/ui/ModalHeader";
import { uiIcon } from "./components/ui/UiIcon";
import { renderSkinPreview } from "./SkinPreview";
import { L, translateText } from "./Utils";

// terron: имя скина магазина по i18n-ключу shop_skins.<sku> (масштабируемо на
// любое число языков, без titleEn/titleAr/…), фолбэк на серверный RU title.
function skinTitle(i: { sku?: string; title?: string }): string {
  const sku = i?.sku;
  if (!sku) return i?.title ?? "";
  const k = "shop_skins." + sku;
  const t = translateText(k);
  return t === k ? (i?.title ?? "") : t;
}

/**
 * /shop — Магазин: готовые товары за ЛТС/ПТС (пресет-скины, слоты, потом паки).
 * Создание/редактура своих скинов — отдельно, в «Скины» (/skins). Куплённое
 * можно взять основой в редакторе и дать ему имя.
 */
/**
 * terron 25.08: ПОДАРОЧНЫЙ PRIME В ВИТРИНЕ. Любой донат включает TERRON Prime
 * (лестница по пакетам — platform-api/src/orders.ts), и покупатель обязан это
 * видеть ДО оплаты, а не узнавать постфактум.
 *
 * ⚠️ Подпись собирается здесь, а не берётся из серверного `primeLabel`: тот
 * только по-русски, а витрина двуязычна. Числительные — руками: translateText
 * умеет лишь простую подстановку, ICU-плюралей у нас нет (память
 * icu-plurals-not-supported), а тут винительный падеж («на неделю», «на 2
 * недели», «на 5 недель»).
 */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Ссылка на страницу «что такое Prime». terron 26.08: слово Prime встречалось
 * только подписью на карточке — игрок платил и нигде не мог прочитать, что ему
 * дали. ⚠️ Настоящий `href` обязателен (cmd+клик, правый клик, краулеры), но
 * обычный клик ведём внутри SPA — перезагружать магазин незачем.
 */
function primeLink(text: string): TemplateResult {
  return html`<a
    href="/prime"
    style="color:var(--t-red);font-weight:700;text-decoration:underline;text-underline-offset:2px"
    @click=${(e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      window.showPage?.("page-prime");
    }}
    >${text}</a
  >`;
}

export function primeGiftLabel(days: number): string {
  if (days <= 0) return "";
  // Ровные месяцы (60/120 дней) показываем месяцами — «на 4 месяца» читается
  // лучше, чем «на 17 недель». Остальное — недели.
  if (days % 30 === 0) {
    const m = days / 30;
    return L(
      `+ Prime на ${m} ${ruPlural(m, "месяц", "месяца", "месяцев")}`,
      `+ Prime for ${m} month${m === 1 ? "" : "s"}`,
    );
  }
  const w = Math.max(1, Math.round(days / 7));
  return L(
    `+ Prime на ${w === 1 ? "" : w + " "}${ruPlural(w, "неделю", "недели", "недель")}`,
    `+ Prime for ${w === 1 ? "a week" : `${w} weeks`}`,
  );
}

@customElement("shop-page")
export class ShopPage extends BaseModal {
  protected routerName = "shop";

  @state() private lts = 0;
  @state() private pts = 0;
  @state() private items: ShopItem[] = [];
  @state() private loading = true;
  @state() private busy = "";
  @state() private msg = "";
  @state() private tab: "catalog" | "mine" | "earn" | "history" | "topup" =
    "catalog";
  // terron 21.08: ПОПОЛНЕНИЕ ЖИВЁТ В МАГАЗИНЕ (решение владельца). Серверная
  // страница /pay/topup остаётся как запасной вход по прямой ссылке, но игрок
  // должен покупать ПТС в нашем интерфейсе, а не на чужой вёрстке.
  @state() private pay: PayPacks | null = null;
  @state() private buying: string | null = null;
  // каталог: фильтр по ТИПУ (режиму) + по тегу (флаги/мемы)
  @state() private catType: "tile" | "stretch" | "static" = "tile";
  @state() private catTag: string | null = null;
  @state() private mine: NamedSkin[] = [];
  @state() private rules: EconomyRules | null = null;
  @state() private preview: ShopItem | null = null;
  @state() private previewUrl = "";
  @state() private search = ""; // поиск по каталогу (мультиязычный)
  @state() private namingId = ""; // id черновика, которому задаём ник
  @state() private nameInput = "";
  // terron: ИСТОРИЯ КОШЕЛЬКА (/shop/history). Игрок должен видеть, откуда
  // взялись бумаги и алмазы — «кажется, за игру дали 9, а не 10» проверяется
  // только выпиской (репорт владельца 29.07). Данные уже отдаёт API
  // (/me/wallet/history), тут только показ.
  @state() private history: WalletTx[] = [];
  @state() private historyLoading = false;

  private async openPreview(i: ShopItem): Promise<void> {
    this.preview = i;
    this.previewUrl = "";
    this.requestUpdate();
    if (!i.url) return;
    const url = await renderSkinPreview({
      skinUrl: assetUrl(i.url),
      mode: i.mode ?? 2,
      dim: i.dim ?? 0.85,
      tileTiles: i.tileTiles ?? 8,
    });
    if (this.preview === i) {
      this.previewUrl = url;
      this.requestUpdate();
    }
  }

  protected renderHeaderSlot() {
    // вкладка-тогл рядом с балансом: клик по активной → назад в каталог
    //
    // terron 26.08 (просьба владельца «щас это блок и кнопка, должно быть блок,
    // внутри которой +»): баланс и «плюс» — ОДНА плитка с общей рамкой. Число
    // ведёт в выписку («откуда это?»), плюс — в пополнение; у каждой валюты
    // свой путь пополнения, поэтому подсказки разные.
    // ⚠️ Вложенных <button> в <button> не бывает — обёртка это <span> с рамкой,
    // а половинки внутри (стили .t-balance-chip в terron-theme.css).
    const balanceChip = (
      kind: "lts" | "pts",
      value: number,
      onPlus: (() => void) | null,
      plusTitle: string,
    ) => html`<span class="t-balance t-balance-chip">
      <button
        title=${L("История начислений", "Balance history")}
        @click=${() => this.openTab("history")}
      >
        ${coin(kind)} ${value.toLocaleString("ru-RU")}
      </button>
      ${onPlus
        ? html`<button
            class="t-balance-plus"
            title=${plusTitle}
            aria-label=${plusTitle}
            @click=${onPlus}
          >
            +
          </button>`
        : ""}
    </span>`;
    const navBtn = (
      id: "mine" | "earn" | "history" | "topup",
      label: string,
    ) => html`<button
      class="t-btn"
      style=${`padding:5px 10px;font-size:13px;${
        this.tab === id
          ? ""
          : "background:var(--t-sheet);color:var(--t-ink)"
      }`}
      @click=${() => this.openTab(this.tab === id ? "catalog" : id)}
    >
      ${label}
    </button>`;
    return modalHeader({
      title: L("Магазин", "Store"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent: html`<div
        style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end"
      >
        <button
          class="t-btn"
          style="padding:5px 10px;font-size:13px"
          title=${L("Создать свой скин", "Create your own skin")}
          @click=${this.openEditor}
        >
          ${L("+ Создать", "+ Create")}
        </button>
        ${navBtn("mine", L("Мои скины", "My skins"))}
        ${navBtn("history", L("История", "History"))}
        ${this.embedded ? "" : navBtn("topup", L("Пополнить", "Top up"))}
        <!-- terron: баланс кликабельный — ведёт в выписку (/shop/history).
             Самый ожидаемый жест: «откуда это число?». Плюс живёт в той же
             плитке: у ЛТС покупки нет и не будет (их только зарабатывают),
             поэтому он ведёт в «Заработать», а не в пополнение. -->
        <span style="display:inline-flex;align-items:center;gap:6px">
          ${balanceChip(
            "lts",
            this.lts,
            () => this.openTab("earn"),
            L("Как получить ЛТС", "How to earn LTS"),
          )}
          ${balanceChip(
            "pts",
            this.pts,
            this.embedded ? null : () => this.openTab("topup"),
            L("Пополнить ПТС", "Top up PTS"),
          )}
        </span>
      </div>`,
    });
  }

  protected renderBody(): TemplateResult {
    return html`<div class="t-page">
      ${this.msg
        ? html`<div
            style="margin-bottom:12px;padding:8px 12px;border-radius:8px;background:rgba(58,125,68,.12);color:#3a7d44;font-weight:600"
          >
            ${this.msg}
          </div>`
        : ""}
      ${this.loading
        ? this.renderSkeleton()
        : this.tab === "catalog"
          ? this.renderCatalog()
          : this.tab === "mine"
            ? this.renderMine()
            : this.tab === "history"
              ? this.renderHistory()
              : this.tab === "topup"
                ? this.renderTopup()
                : this.renderEarn()}
      ${this.namingId ? this.renderNameModal() : ""}
    </div>`;
  }

  // скелетон-сетка: интерфейс появляется мгновенно, не ждём JSON каталога.
  private renderSkeleton(): TemplateResult {
    return html`<div
      class="t-grid"
      style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))"
    >
      ${Array.from({ length: 8 }).map(
        () => html`<div
          class="t-skel"
          style="height:150px;border-radius:12px"
        ></div>`,
      )}
    </div>`;
  }

  /**
   * terron 21.08: вкладка «Пополнить» — пакеты ПТС за рубли в нашем дизайне.
   *
   * Раньше единственным входом была серверная страница /pay/topup: чужая
   * вёрстка вне магазина (замечание владельца). Теперь покупка живёт здесь, а
   * та страница остаётся запасным входом по прямой ссылке.
   *
   * ⚠️ Внутри iframe площадки вкладка не показывается вовсе (см. embedded):
   * просить оплату в GamePush и связанных площадках нельзя. Бэкенд то же самое
   * подтверждает отказом, но игрок не должен и видеть кнопку.
   */
  private renderTopup(): TemplateResult {
    if (this.embedded) return html``;
    const pay = this.pay;
    if (!pay) {
      return html`<div
        class="t-grid"
        style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))"
      >
        ${Array.from({ length: 6 }).map(
          () => html`<div class="t-skel" style="height:120px;border-radius:12px"></div>`,
        )}
      </div>`;
    }
    if (!pay.enabled) {
      return html`<div class="t-muted" style="font-size:13px;padding:20px 0">
        ${L(
          "Пополнение временно недоступно.",
          "Top-up is temporarily unavailable.",
        )}
      </div>`;
    }
    return html`
      <div
        class="t-muted"
        style="font-size:12.5px;line-height:1.5;margin-bottom:12px"
      >
        ${pay.bonus
          ? L(
              `Первая покупка в этом месяце — ПТС в ${pay.multiplier} раза больше.`,
              `First purchase this month — ${pay.multiplier}× the PTS.`,
            )
          : L(
              "ПТС тратятся на скины и слоты. Оплата картой или через СБП.",
              "PTS buy skins and slots. Card or SBP payment.",
            )}
      </div>
      <!-- terron 26.08 (просьба владельца): пакетов ровно шесть, поэтому сетка
           ЖЁСТКО 3×2, а не auto-fill — иначе на широком экране выходило 4+2, и
           «лестница» пакетов читалась как случайная россыпь. Узкие экраны
           складываются в 2 и 1 колонку (класс .pay-grid в теме). -->
      <div class="t-grid pay-grid">
        ${pay.packs.map((p) => {
          const pts = pay.bonus ? p.pts * pay.multiplier : p.pts;
          const busy = this.buying === p.sku;
          // Карточка ровно та же, что у скинов (.t-skincard + .t-skinprev +
          // .t-skinname + сплит-кнопка цены) — витрина должна выглядеть одним
          // магазином, а не двумя разными (замечание владельца 21.08).
          return html`<div class="t-skincard">
            <!-- ⚠️ terron 26.08: ГОРКА, а не одна цифра. Разницу между 50 и
                 2000 глаз ловит по РАЗМЕРУ кучи, а число рядом её называет —
                 поэтому оставлены оба (components/ui/gemPile.ts). -->
            <div
              class="t-skinprev"
              style="background:linear-gradient(135deg,#2b2a24,#4a4230);display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;padding:8px 8px 6px;position:relative;overflow:hidden"
            >
              <div style="flex:1 1 auto;min-height:0;width:100%;display:flex;align-items:flex-end;justify-content:center">
                ${gemPile(pts)}
              </div>
              <span
                style="display:inline-flex;align-items:center;gap:5px;font-family:var(--t-display);font-weight:700;font-size:19px;line-height:1;color:var(--t-parchment,#fdfcf7)"
                >${coin("pts", 14)} ${pts.toLocaleString("ru-RU")}</span
              >
              ${pay.bonus
                ? html`<span
                    style="position:absolute;right:5px;top:5px;background:var(--t-red);color:#fff;font-family:var(--t-mono,monospace);font-size:11px;padding:1px 5px"
                    >×${pay.multiplier}</span
                  >`
                : p.badge
                  ? html`<span
                      style="position:absolute;right:5px;top:5px;background:var(--t-parchment,#fdfcf7);color:var(--t-ink);font-family:var(--t-mono,monospace);font-size:11px;padding:1px 5px"
                      >${p.badge}</span
                    >`
                  : ""}
            </div>
            <div class="t-skinname">
              ${pay.bonus
                ? L(`${p.pts} + бонус`, `${p.pts} + bonus`)
                : L(`${p.pts} алмазов`, `${p.pts} diamonds`)}
            </div>
            ${p.primeDays
              ? html`<div
                  style="font-family:var(--t-mono,monospace);font-size:11px;padding:0 8px 6px;text-align:center"
                >
                  ${primeLink(primeGiftLabel(p.primeDays))}
                </div>`
              : ""}
            <div class="shop-split">
              <button
                class="shop-half pts"
                ?disabled=${busy}
                @click=${() => void this.startPayment(p.sku)}
              >
                ${busy
                  ? L("Открываем…", "Opening…")
                  : `${p.priceRub.toLocaleString("ru-RU")} ₽`}
              </button>
            </div>
          </div>`;
        })}
      </div>
      <!-- terron 26.08 (просьба владельца): прямым текстом под ВСЕМИ пакетами —
           прем даётся за каждое пополнение, а не за какой-то особенный. Подписи
           на карточках это показывают, но их читают как «акцию у этого пакета». -->
      <div
        style="margin-top:14px;border:1px solid var(--t-ink);background:var(--t-sheet);padding:10px 14px;font-size:13px;line-height:1.6"
      >
        ${L(
          "Любое пополнение включает TERRON Prime на указанный у пакета срок. Если Prime уже действует — дни прибавляются к остатку.",
          "Every top-up switches on TERRON Prime for the time shown on the pack. If Prime is already running, the days are added to what is left.",
        )}
        ${primeLink(L("Что даёт Prime →", "What Prime does →"))}
      </div>
      <div class="t-muted" style="font-size:11.5px;margin-top:12px">
        ${L(
          "Оплата проходит на стороне платёжного сервиса — карточные данные к нам не попадают. ПТС зачисляются автоматически после подтверждения оплаты.",
          "Payment is handled by the payment provider — card details never reach us. PTS are credited automatically once the payment is confirmed.",
        )}
      </div>
    `;
  }

  // terron: ВЫПИСКА по кошельку (/shop/history). Показываем ОБЕ валюты одним
  // потоком: у каждой строки своя иконка, знак и баланс ПОСЛЕ операции — по
  // нему видно, что ничего не потерялось (именно этого не хватало владельцу:
  // «дали 9 или 10?»). Причины переводим в человеческие названия.
  private static reasonLabel(reason: string): string {
    const map: Record<string, string> = {
      kill: L("Съеденные игроки и нации", "Players and nations eaten"),
      win: L("Победа в матче", "Match win"),
      golden_win: L("Победа в золотом матче", "Golden match win"),
      golden_win_claim: L(
        "Золотой матч (награда забрана)",
        "Golden match (reward claimed)",
      ),
      diamond_win: L("Победа в алмазном матче", "Diamond match win"),
      diamond_win_claim: L(
        "Алмазный матч (награда забрана)",
        "Diamond match (reward claimed)",
      ),
      achievement: L("Достижение", "Achievement"),
      purchase: L("Покупка", "Purchase"),
      ult_refresh: L("Переролл ультиматов", "Ultimate reroll"),
      grant: L("Начисление вручную", "Manual grant"),
      dev: L("Тестовая правка", "Dev adjustment"),
      ref_open: L("Реферал: переход", "Referral: visit"),
      ref_play: L("Реферал: сыграл", "Referral: played"),
      ref_register: L("Реферал: регистрация", "Referral: signup"),
      ref_win: L("Реферал: победа", "Referral: win"),
    };
    return map[reason] ?? reason;
  }

  /**
   * terron 21.08: на странице баланса — отдельный вход в пополнение (просьба
   * владельца). Валюты разные по сути: ПТС покупаются, ЛТС только
   * зарабатываются, поэтому и кнопки ведут в разные места, а не одна общая.
   */
  private renderWalletActions(): TemplateResult {
    return html`<div
      style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px"
    >
      ${this.embedded
        ? ""
        : html`<button
            class="t-btn"
            style="padding:6px 12px;font-size:13px;background:var(--t-ink);color:var(--t-parchment,#fff)"
            @click=${() => this.openTab("topup")}
          >
            ${L("+ Пополнить ПТС", "+ Top up PTS")}
          </button>`}
      <button
        class="t-btn"
        style="padding:6px 12px;font-size:13px;background:var(--t-sheet);color:var(--t-ink)"
        @click=${() => this.openTab("earn")}
      >
        ${L("Как получить ЛТС", "How to earn LTS")}
      </button>
    </div>`;
  }

  private renderHistory(): TemplateResult {
    if (this.historyLoading) {
      return html`${this.renderWalletActions()}
        <div class="t-muted" style="padding:24px 0">
          ${L("Загрузка…", "Loading…")}
        </div>`;
    }
    if (this.history.length === 0) {
      return html`${this.renderWalletActions()}
        <div class="t-muted" style="padding:24px 0">
          ${L(
            "Пока пусто. Играй матчи — начисления появятся здесь.",
            "Nothing yet. Play matches and your earnings show up here.",
          )}
        </div>`;
    }
    const td = "padding:7px 8px;white-space:nowrap";
    return html`
      ${this.renderWalletActions()}
      <div class="t-muted" style="font-size:13px;margin-bottom:10px">
        ${L(
          "Каждая строка — одна операция. Справа баланс сразу после неё.",
          "One row per operation. On the right — the balance right after it.",
        )}
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${this.history.map(
            (t) => html`<tr
              style="border-bottom:1px solid var(--t-line,#e5e0cf)"
            >
              <td style="${td};white-space:normal">
                ${ShopPage.reasonLabel(t.reason)}
              </td>
              <td
                style="${td};text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:${t.amount >=
                0
                  ? "#3a7d44"
                  : "#a8432b"}"
              >
                ${t.amount >= 0 ? "+" : ""}${t.amount}
                ${coin(t.currency === "pts" ? "pts" : "lts", 14)}
              </td>
              <td
                class="t-muted"
                style="${td};text-align:right;font-variant-numeric:tabular-nums"
                title=${L("Баланс после операции", "Balance after")}
              >
                ${t.balance_after.toLocaleString("ru-RU")}
              </td>
              <td class="t-muted" style="${td};text-align:right">
                ${new Date(t.created_at).toLocaleString(undefined, {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
            </tr>`,
          )}
        </table>
      </div>
    `;
  }

  /**
   * terron 21.08: ЕДИНАЯ страница «как получить валюты» (решение владельца).
   * Отдельной вкладки «Заработать» в шапке больше нет — сюда ведёт «+» у ЛТС и
   * кнопка на странице баланса: вопрос звучит как «где взять валюту», а не
   * «открой раздел».
   *
   * ⚠️ Цифры берём из /economy/rules ПО ФАКТИЧЕСКИМ полям. Раньше тут стоял
   * несуществующий `ltsPerKill`, и страница печатала «+undefined».
   */
  private renderEarn(): TemplateResult {
    const r = this.rules;
    const row = (iconName: string, title: string, desc: string) => html`<div
      style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:var(--t-sheet)"
    >
      <div style="line-height:1;opacity:.85">${uiIcon(iconName, 22)}</div>
      <div>
        <div style="font-weight:700">${title}</div>
        <div class="t-muted" style="font-size:13px">${desc}</div>
      </div>
    </div>`;
    const head = (text: string, sub: string) => html`<div style="margin-top:6px">
      <div
        style="font-family:var(--t-display);font-weight:700;font-size:15px;letter-spacing:.02em;color:var(--t-ink)"
      >
        ${text}
      </div>
      <div class="t-muted" style="font-size:12.5px">${sub}</div>
    </div>`;
    return html`<div
      style="display:flex;flex-direction:column;gap:10px;max-width:560px"
    >
      ${head(
        L("Ценные бумаги (ЛТС)", "Securities (LTS)"),
        L(
          "Купить нельзя — только заработать в матчах.",
          "Cannot be bought — earned in matches only.",
        ),
      )}
      ${row(
        "swords",
        L("За время в матче", "For time in a match"),
        r
          ? L(
              `+${r.rates.ltsPerMinute} за минуту игры, минимум +${r.rates.ltsMinPerMatch} за матч · до ${r.caps.ltsPerDay}/день`,
              `+${r.rates.ltsPerMinute} per minute, at least +${r.rates.ltsMinPerMatch} per match · up to ${r.caps.ltsPerDay}/day`,
            )
          : L("за игру в матчах", "for playing matches"),
      )}
      ${row(
        "trophy",
        L("За съеденные нации", "For eaten nations"),
        r
          ? L(
              `+${r.rates.ltsPerNation} за каждую нацию`,
              `+${r.rates.ltsPerNation} per nation`,
            )
          : L("за съеденные нации", "for eaten nations"),
      )}
      ${row(
        "medal",
        L("За достижения", "For achievements"),
        r
          ? L(
              `+${r.rates.ltsPerAchievement} за каждую новую ачивку`,
              `+${r.rates.ltsPerAchievement} per new achievement`,
            )
          : L("за новые достижения", "for new achievements"),
      )}
      ${head(
        L("Кровавые алмазы (ПТС)", "Blood diamonds (PTS)"),
        L(
          "За них берут скины. Зарабатываются в матчах или пополняются.",
          "They buy skins. Earned in matches or topped up.",
        ),
      )}
      ${row(
        "trophy",
        L("За победу", "For a win"),
        r
          ? L(
              `+${r.rates.ptsPerWin} за победу в матче · до ${r.caps.ptsPerDayFree}/день`,
              `+${r.rates.ptsPerWin} per match win · up to ${r.caps.ptsPerDayFree}/day`,
            )
          : L("за победы в матчах", "for match wins"),
      )}
      ${row(
        "swords",
        L("За съеденных игроков", "For eaten players"),
        r
          ? L(
              `+${r.rates.ptsPerPlayerKill} за живого игрока`,
              `+${r.rates.ptsPerPlayerKill} per human player`,
            )
          : L("за съеденных игроков", "for eaten players"),
      )}
      ${this.embedded
        ? ""
        : html`<button
            class="t-btn"
            style="align-self:flex-start;margin-top:4px;padding:7px 14px;font-size:13px;background:var(--t-ink);color:var(--t-parchment,#fff)"
            @click=${() => this.openTab("topup")}
          >
            ${L("+ Пополнить ПТС", "+ Top up PTS")}
          </button>`}
    </div>`;
  }

  private static readonly TYPES: ["tile" | "stretch" | "static", string][] = [
    ["tile", "Плитка"],
    ["stretch", "Растягиваются"],
    ["static", "Статические"],
  ];
  // EN-метки типов (резолв при рендере; static-инициализатор L() заморозил бы язык)
  private static readonly TYPE_LABELS_EN: Record<string, string> = {
    tile: "Tiled",
    stretch: "Stretched",
    static: "Static",
  };
  private static readonly TYPE_MODES: Record<string, number[]> = {
    tile: [1, 3],
    stretch: [2],
    static: [4],
  };
  // Теги-подфильтр (ниже типов). Метки для известных тегов.
  private static readonly TAG_LABELS: Record<string, string> = {
    flag: "Флаги",
    meme: "Мемы",
  };
  private static readonly TAG_LABELS_EN: Record<string, string> = {
    flag: "Flags",
    meme: "Memes",
  };

  private grid(items: ShopItem[]): TemplateResult {
    return html`<div
      class="t-grid"
      style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))"
    >
      ${items.map((i) => this.card(i))}
    </div>`;
  }

  private matchesSearch(i: ShopItem): boolean {
    const q = this.search.trim().toLowerCase();
    if (!q) return true;
    const hay = `${i.title} ${i.search ?? ""}`.toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  private renderSearchBox(): TemplateResult {
    return html`<input
      class="t-input"
      style="width:100%;margin-bottom:14px"
      placeholder=${L("Поиск: флаг, сша, россия, плитка…", "Search: flag, usa, tiled…")}
      .value=${this.search}
      @input=${(e: Event) =>
        (this.search = (e.target as HTMLInputElement).value)}
    />`;
  }

  private renderCatalog(): TemplateResult {
    const skins = this.items.filter((i) => i.kind === "skin");
    const slots = this.items.filter((i) => i.kind === "slot");
    // при активном поиске — плоский список найденного (по всем группам)
    if (this.search.trim()) {
      const found = skins.filter((i) => this.matchesSearch(i));
      return html`
        ${this.renderSearchBox()}
        ${found.length === 0
          ? html`<div class="t-muted" style="text-align:center;padding:14px">
              ${L("Ничего не найдено.", "Nothing found.")}
            </div>`
          : this.grid(found)}
        ${this.preview ? this.renderPreview(this.preview) : ""}
      `;
    }
    // items текущего ТИПА (по режиму)
    const modes = ShopPage.TYPE_MODES[this.catType];
    const typed = skins.filter((i) => modes.includes(i.mode ?? 2));
    // теги, реально присутствующие в этом типе (минус тип-теги) → подфильтр
    const tags = [
      ...new Set(typed.flatMap((i) => i.tags ?? [])),
    ].filter((t) => !["tile", "whole", "free"].includes(t));
    const shown = this.catTag
      ? typed.filter((i) => (i.tags ?? []).includes(this.catTag!))
      : typed;

    // чип типа: при выборе — плотнее подсветка (var(--t-skin)/инк)
    const typeChip = (id: "tile" | "stretch" | "static", label: string) => {
      const on = this.catType === id;
      return html`<button
        class="t-btn"
        style=${on
          ? "background:var(--t-ink);color:var(--t-parchment,#fdfcf7)"
          : "background:var(--t-sheet);color:var(--t-ink)"}
        @click=${() => {
          this.catType = id;
          this.catTag = null;
        }}
      >
        ${label}
      </button>`;
    };
    const tagChip = (id: string | null, label: string) => {
      const on = this.catTag === id;
      return html`<button
        class="t-btn"
        style=${`padding:4px 10px;font-size:13px;${
          on
            ? "background:var(--t-ink);color:var(--t-parchment,#fdfcf7)"
            : "background:var(--t-sheet);color:var(--t-ink)"
        }`}
        @click=${() => {
          this.catTag = id;
        }}
      >
        ${label}
      </button>`;
    };

    return html`
      ${this.renderSearchBox()}
      <div
        style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap"
      >
        ${ShopPage.TYPES.map(([id, label]) =>
          typeChip(id, L(label, ShopPage.TYPE_LABELS_EN[id] ?? label)),
        )}
        <button
          class="t-btn"
          style="margin-left:auto;background:var(--t-skin);color:#fff;font-weight:700"
          title=${L("Создать/загрузить свой скин", "Create/upload your own skin")}
          @click=${this.openEditor}
        >
          ${L("Свой скин", "Custom skin")}
        </button>
      </div>
      ${tags.length > 0
        ? html`<div
            style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap"
          >
            ${tagChip(null, L("Все", "All"))}
            ${tags.map((t) =>
              tagChip(
                t,
                L(
                  ShopPage.TAG_LABELS[t] ?? t,
                  ShopPage.TAG_LABELS_EN[t] ?? ShopPage.TAG_LABELS[t] ?? t,
                ),
              ),
            )}
          </div>`
        : ""}
      ${shown.length === 0
        ? html`<div class="t-muted" style="text-align:center;padding:14px">
            ${L("Пока пусто в этой категории.", "Nothing here yet.")}
          </div>`
        : this.grid(shown)}
      ${slots.length > 0
        ? html`<div style="margin-top:18px">
            <div style="font-weight:800;margin:0 0 8px;font-size:15px">
              ${L("Свой скин", "Custom skin")}
            </div>
            ${this.grid(slots)}
          </div>`
        : ""}
      ${this.preview ? this.renderPreview(this.preview) : ""}
    `;
  }

  private renderPreview(i: ShopItem): TemplateResult {
    return html`<div
      style="position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)"
      @click=${() => {
        this.preview = null;
      }}
    >
      <div
        @click=${(e: Event) => e.stopPropagation()}
        style="background:var(--t-bg,#fdfcf7);color:var(--t-ink);border-radius:14px;padding:18px;max-width:min(92vw,520px);box-shadow:0 20px 60px rgba(0,0,0,.4)"
      >
        <div style="font-weight:800;margin-bottom:10px">
          ${skinTitle(i)} ${L("— как в игре", "— in game")}
        </div>
        <div
          style="width:100%;aspect-ratio:148/66;background:#5e7fa3;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center"
        >
          ${this.previewUrl
            ? html`<img
                src=${this.previewUrl}
                style="width:100%;height:100%;object-fit:contain;image-rendering:auto"
              />`
            : html`<span class="t-muted" style="font-size:13px"
                >${L("Рендер…", "Rendering…")}</span
              >`}
        </div>
        <div class="t-muted" style="font-size:12px;margin-top:8px">
          ${L(
            "Точь-в-точь как в игре: твоя территория на карте, залитая скином.",
            "Exactly as in game: your territory on the map, filled with the skin.",
          )}
        </div>
        <button
          class="t-btn"
          style="width:100%;margin-top:10px"
          @click=${() => {
            this.preview = null;
          }}
        >
          ${L("Закрыть", "Close")}
        </button>
      </div>
    </div>`;
  }

  private renderMine(): TemplateResult {
    if (this.mine.length === 0) {
      return html`<div class="t-muted" style="text-align:center;padding:14px">
        ${L("Пока нет своих скинов.", "No custom skins yet.")}
        <button class="skin-sheet-manage" @click=${this.openEditor}>
          ${L("Создать →", "Create →")}
        </button>
      </div>`;
    }
    return html`<div
      class="t-grid"
      style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))"
    >
      ${this.mine.map((s) => this.mineCard(s))}
    </div>`;
  }

  private mineCard(s: NamedSkin): TemplateResult {
    const src = s.data_url.startsWith("data:")
      ? s.data_url
      : assetUrl(s.data_url);
    const bgPos =
      s.mode === 4
        ? "center/contain no-repeat"
        : s.mode === 2
          ? "center/cover no-repeat"
          : "0 0 / 34px 34px repeat";
    const named = !!s.name;
    const worn =
      named &&
      (localStorage.getItem("username") ?? "").toLowerCase() ===
        s.name!.toLowerCase();
    return html`<div class="t-skincard">
      <div
        class="t-skinprev"
        style=${`background:#cdbb93 url("${src}") ${bgPos}`}
      ></div>
      ${named
        ? html`<div class="t-skinname">
            ${s.name}${worn ? html` ${uiIcon("check", 13)}` : ""}
          </div>`
        : html`<button
            class="t-skinname"
            style="background:none;border:none;color:#c0392b;font-weight:700;cursor:pointer;padding:0;text-align:left"
            @click=${() => this.startNaming(s)}
          >
            ${L("Задай имя →", "Set a name →")}
          </button>`}
      <div style="display:flex;gap:6px;margin-top:6px">
        ${named
          ? html`<button
              class="t-btn"
              style="flex:1"
              ?disabled=${worn}
              @click=${() => this.wear(s)}
            >
              ${worn ? L("Надет", "Worn") : L("Надеть", "Wear")}
            </button>`
          : html`<button
              class="t-btn"
              style="flex:1;background:#c0392b;color:#fff"
              @click=${() => this.startNaming(s)}
            >
              ${L("Задать имя", "Set name")}
            </button>`}
        <button
          class="t-btn"
          style="background:var(--t-sheet);color:var(--t-ink);flex:0 0 auto;width:40px;padding:0;display:flex;align-items:center;justify-content:center;align-self:stretch;font-size:15px;line-height:1"
          title=${L("Изменить", "Edit")}
          @click=${() => this.editSkinExternal(s)}
        >
          ${uiIcon("pencil", 16)}
        </button>
      </div>
    </div>`;
  }

  private startNaming(s: NamedSkin): void {
    this.namingId = s.id;
    this.nameInput = s.name ?? "";
    this.requestUpdate();
  }

  private editSkinExternal(s: NamedSkin): void {
    const sp = document.querySelector("skins-page") as
      | (HTMLElement & { startEdit?: (x: NamedSkin) => void; open?: () => void })
      | null;
    this.close();
    window.showPage?.("page-skins");
    sp?.open?.();
    setTimeout(() => sp?.startEdit?.(s), 60);
  }

  private wear(s: NamedSkin): void {
    if (!s.name) return this.startNaming(s); // безымянный → сначала задать ник
    const name = s.name;
    try {
      localStorage.setItem("username", name);
    } catch {
      /* ignore */
    }
    const ui = document.querySelector("username-input") as
      | (HTMLElement & { setUsername?: (n: string) => void })
      | null;
    ui?.setUsername?.(name);
    this.msg = L(
      `«${name}» надет — играй под этим ником.`,
      `“${name}” is on — play under this nick.`,
    );
    this.requestUpdate();
  }

  private openEditor = (): void => {
    // Метка для SkinsPage: «назад» из редактора вернёт СЮДА, а не на главную
    // (репорт владельца 21.08: «магазин → создать → назад закрывает окно»).
    try {
      sessionStorage.setItem("terron_skins_from_shop", "1");
    } catch {
      /* приватный режим — просто закроемся как раньше */
    }
    // ⚠️ Репорт владельца 25.08: редактор на /skins ОДИН и его состояние живёт.
    // Правил скин → пошёл «создать новый» → открывался редактор ПРОШЛОГО скина
    // («Редактируешь X», чужая картинка). Явно просим чистый лист.
    const sp = document.querySelector("skins-page") as
      | (HTMLElement & { startNew?: () => void })
      | null;
    sp?.startNew?.();
    this.close();
    window.showPage?.("page-skins");
  };

  private card(i: ShopItem): TemplateResult {
    const isSkin = i.kind === "skin";
    // плитка (1/3) → повтор фоном (таких пресетов мало, грузим сразу);
    // флаг/статик (2/4) → ОТДЕЛЬНЫЙ <img loading="lazy"> ниже (их много и они
    // сетевые SVG → ленивая загрузка = не тянем все разом, магазин открывается быстро).
    const isTile = i.mode === 1 || i.mode === 3;
    const lazyImg = isSkin && i.url && !isTile;
    const prevStyle = !isSkin
      ? "background:linear-gradient(135deg,#2b2a24,#4a4230);display:flex;align-items:center;justify-content:center;font-size:30px"
      : isTile && i.url
        ? `background:#cdbb93 url("${assetUrl(i.url)}") 0 0 / 38px 38px repeat`
        : "background:#cdbb93";
    const tagLabel: Record<string, string> = {
      free: L("бесплатно", "free"),
      tile: L("плитка", "tiled"),
      whole: L("цельный", "whole"),
      flag: L("флаг", "flag"),
    };
    return html`<div class="t-skincard">
      <div
        class="t-skinprev"
        style=${prevStyle + (isSkin ? ";cursor:pointer;position:relative" : "")}
        title=${isSkin ? L("Превью как в игре", "In-game preview") : ""}
        @click=${() => {
          if (isSkin) void this.openPreview(i);
        }}
      >
        ${lazyImg
          ? html`<img
              src=${assetUrl(i.url!)}
              loading="lazy"
              decoding="async"
              alt=""
              style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain"
            />`
          : ""}
        ${isSkin
          ? html`<span
              style="position:absolute;right:4px;bottom:4px;background:rgba(0,0,0,.45);border-radius:6px;padding:2px 4px;display:inline-flex"
              >${uiIcon("eye", 14)}</span
            >`
          : uiIcon("ticket", 22)}
      </div>
      <div class="t-skinname">${skinTitle(i)}</div>
      ${isSkin && i.tags?.length
        ? html`<div
            style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0 2px"
          >
            ${i.tags.map(
              (tg) => html`<span
                style="font-size:10px;padding:1px 6px;border-radius:999px;background:var(--t-sheet);color:var(--t-muted,#777)"
                >${tagLabel[tg] ?? tg}</span
              >`,
            )}
          </div>`
        : ""}
      ${i.owned
        ? html`<button
            class="t-btn"
            style="width:100%;margin-top:8px;background:var(--t-sheet);color:var(--t-ink)"
            disabled
          >
            ${L("Куплено", "Owned")}
          </button>`
        : this.priceSplit(i)}
    </div>`;
  }

  // Сплит-кнопка цены: ВСЕГДА пополам. Слева ЛТС (серебро), справа ПТС (золото).
  // «—» где валюта недоступна — чтобы моментально считывалось, что и какой стороной.
  private priceSplit(i: ShopItem): TemplateResult {
    const half = (
      n: number | null | undefined,
      cur: "lts" | "pts",
      left: boolean,
    ) => {
      const has = n != null;
      return html`<button
        class="shop-half ${cur}${has ? "" : " off"}"
        style=${left ? "border-right:1px solid var(--t-ink)" : ""}
        ?disabled=${!has || this.busy !== ""}
        @click=${() => has && this.buy(i.sku, cur)}
      >
        ${has ? html`${n} ${coin(cur)}` : "—"}
      </button>`;
    };
    return html`<div class="shop-split">
      ${half(i.priceLts, "lts", true)}${half(i.pricePts, "pts", false)}
    </div>`;
  }

  private async buy(sku: string, currency: "lts" | "pts"): Promise<void> {
    this.busy = sku;
    this.msg = "";
    this.requestUpdate();
    const r = await buyItem(sku, currency);
    if (!r.ok) {
      this.msg =
        r.error === "insufficient funds"
          ? L("Недостаточно средств.", "Insufficient funds.")
          : r.error === "unauthorized"
            ? L("Войди в аккаунт.", "Sign in to your account.")
            : r.error === "already owned"
              ? L("Уже куплено.", "Already owned.")
              : L(`Ошибка: ${r.error ?? "?"}`, `Error: ${r.error ?? "?"}`);
    } else {
      this.msg = L("Куплено!", "Purchased!");
      await this.load();
      // купленный скин = черновик без ника → сразу предлагаем задать имя
      if (r.skinId) {
        this.namingId = r.skinId;
        this.nameInput = "";
        this.tab = "mine";
      }
    }
    this.busy = "";
    this.requestUpdate();
  }

  // модалка «задай ник скину» (сохранить сейчас или позже)
  private renderNameModal(): TemplateResult {
    return html`<div
      style="position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)"
      @click=${() => {
        this.namingId = "";
      }}
    >
      <div
        @click=${(e: Event) => e.stopPropagation()}
        style="background:var(--t-bg,#fdfcf7);color:var(--t-ink);border-radius:14px;padding:18px;max-width:min(92vw,420px);box-shadow:0 20px 60px rgba(0,0,0,.4)"
      >
        <div style="font-weight:800;margin-bottom:6px">
          ${L("Задай имя скину", "Name your skin")}
        </div>
        <div class="t-muted" style="font-size:12px;margin-bottom:10px">
          ${L(
            "Скин надевается на ник: играя под этим именем, увидишь скин. Можно задать позже — он будет ждать в «Мои скины».",
            "A skin is tied to a nick: play under this name to see it. You can set it later — it'll wait in “My skins”.",
          )}
        </div>
        <input
          class="t-input"
          style="width:100%;margin-bottom:10px"
          placeholder=${L("Имя = ник (3–27)", "Name = nick (3–27)")}
          maxlength="27"
          .value=${this.nameInput}
          @input=${(e: Event) =>
            (this.nameInput = (e.target as HTMLInputElement).value)}
        />
        <div style="display:flex;gap:8px">
          <button
            class="t-btn"
            style="flex:1"
            ?disabled=${this.busy !== "" || this.nameInput.trim().length < 3}
            @click=${() => this.saveName()}
          >
            ${L("Сохранить", "Save")}
          </button>
          <button
            class="t-btn"
            style="flex:1;background:var(--t-sheet);color:var(--t-ink)"
            @click=${() => {
              this.namingId = "";
            }}
          >
            ${L("Позже", "Later")}
          </button>
        </div>
      </div>
    </div>`;
  }

  private async saveName(): Promise<void> {
    this.busy = "name";
    this.requestUpdate();
    const r = await nameSkin(this.namingId, this.nameInput.trim());
    if (!r.ok) {
      this.msg =
        r.error === "name taken"
          ? L("Это имя уже занято.", "That name is already taken.")
          : r.error === "bad name"
            ? L(
                "Имя = ник: 3–27 (буквы/цифры/_/пробел/./кириллица).",
                "Name = nick: 3–27 (letters/digits/_/space/./Cyrillic).",
              )
            : L(`Ошибка: ${r.error ?? "?"}`, `Error: ${r.error ?? "?"}`);
    } else {
      this.msg = L("Имя задано — скин готов.", "Name set — skin is ready.");
      this.namingId = "";
      await this.load();
    }
    this.busy = "";
    this.requestUpdate();
  }

  protected onOpen(args?: Record<string, unknown>): void {
    // /shop/history — роутер кладёт второй сегмент пути в args.tab.
    if (args?.tab === "history") this.openTab("history");
    if (args?.tab === "topup") this.openTab("topup");
    this.showPayResult();
    void this.load();
  }

  /** Переключить вкладку и подтянуть данные, если нужно. */
  private openTab(
    tab: "catalog" | "mine" | "earn" | "history" | "topup",
  ): void {
    this.tab = tab;
    if (tab === "history") void this.loadHistory();
    if (tab === "topup") {
      void this.loadPay();
      // terron 28.08: верх воронки платежей. Раз за сессию (дедуп внутри) —
      // считаем ЛЮДЕЙ, увидевших витрину, а не число заходов во вкладку.
      reportPayFunnel("topup_open");
    }
  }

  /**
   * Покупку не предлагаем там, где это запрещено правилами хозяина: в каталоге
   * площадки (VK/Яндекс/Пикабу через GamePush) и в наших апках из Google Play /
   * App Store. Ответ ОДИН на весь клиент — client/PayGate.ts; сервер проверяет
   * то же самое сам, по заголовкам хоста.
   *
   * ⚠️ Имя оставлено прежним (`embedded`), потому что для вёрстки смысл тот же
   * «прячем блок оплаты», но признак теперь шире класса `gp-embed`.
   */
  private get embedded(): boolean {
    return !ourPaymentsAllowed();
  }

  private async loadPay(): Promise<void> {
    if (this.embedded) return;
    this.pay = await getPayPacks();
    this.requestUpdate();
  }

  /** Возврат с оплаты: провайдер приводит на /shop?pay=ok|fail. */
  private showPayResult(): void {
    try {
      const p = new URLSearchParams(window.location.search).get("pay");
      if (p !== "ok" && p !== "fail") return;
      this.msg =
        p === "ok"
          ? L(
              "Оплата принята. ПТС зачислятся в течение минуты.",
              "Payment accepted. Your PTS will arrive within a minute.",
            )
          : L("Оплата не прошла.", "Payment failed.");
      // Убираем параметр, чтобы сообщение не всплывало при каждом возврате назад.
      const url = new URL(window.location.href);
      url.searchParams.delete("pay");
      window.history.replaceState({}, "", url.toString());
      // Баланс мог измениться — перечитываем чуть позже (постбек может отстать).
      window.setTimeout(() => void this.load(), 4000);
    } catch {
      /* ignore */
    }
  }

  private async startPayment(sku: string): Promise<void> {
    // Вторая ступень воронки: витрину видели многие, ткнули пакет — единицы.
    reportPayFunnel("pack_click", sku);
    if (this.buying) return;
    this.buying = sku;
    this.requestUpdate();
    const url = await createPayment(sku);
    this.buying = null;
    if (!url) {
      this.msg = L(
        "Не удалось создать заказ. Попробуй ещё раз.",
        "Could not create the order. Please try again.",
      );
      this.requestUpdate();
      return;
    }
    window.location.href = url;
  }

  private async loadHistory(): Promise<void> {
    this.historyLoading = this.history.length === 0;
    this.requestUpdate();
    this.history = await getWalletHistory(80);
    this.historyLoading = false;
    this.requestUpdate();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.requestUpdate();
    // ОСНОВНОЕ (каталог + кошелёк) — показываем как можно раньше, НЕ ждём
    // тяжёлый /me/skins (~сотни КБ inline) и правила, иначе магазин «висит».
    const [items, wallet] = await Promise.all([getCatalog(), getWallet()]);
    this.items = items;
    if (wallet) {
      this.lts = wallet.lts;
      this.pts = wallet.pts;
    }
    this.loading = false;
    this.requestUpdate();
    // ВТОРОСТЕПЕННОЕ (для вкладок «Мои скины» / «Заработать») — догружаем в фоне.
    const [mine, rules] = await Promise.all([
      getMyNamedSkins().catch(() => [] as NamedSkin[]),
      getEconomyRules().catch(() => null),
    ]);
    this.mine = mine;
    this.rules = rules;
    this.requestUpdate();
  }

  protected onClose(): void {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }
}

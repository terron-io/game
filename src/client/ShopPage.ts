import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../core/AssetUrls";
import {
  buyItem,
  claimPlatformPurchase,
  primeUntilMs,
  recoverPlatformPurchases,
  refreshPrimeStatus,
  createPayment,
  getCatalog,
  getEconomyRules,
  getMyNamedSkins,
  getPayPacks,
  getWalletStatus,
  getWalletHistory,
  nameSkin,
  checkBonusCode,
  redeemBonusCode,
  type BonusCodeFailure,
  type BonusCodeRefusal,
  type BonusCodeReward,
  type EconomyRules,
  type NamedSkin,
  type PayPacks,
  type ShopItem,
  type WalletTx,
} from "./Api";
import { BaseModal } from "./components/BaseModal";
import { coin } from "./components/ui/coin";
import { gemPile } from "./components/ui/gemPile";
import { modalHeader } from "./components/ui/ModalHeader";
import { uiIcon } from "./components/ui/UiIcon";
import { openPageFrom } from "./PageReturn";
import { reportPayFunnel } from "./PayFunnel";
import { ourPaymentsAllowed, payHost } from "./PayGate";
import {
  platformConsume,
  platformPendingPtsTags,
  platformPtsProducts,
  platformPurchase,
  platformPurchasesAvailable,
  ptsOf,
} from "./PlatformPay";
import { renderSkinPreview } from "./SkinPreview";
import { isDevSite, L, translateText } from "./Utils";

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
      // «назад» со страницы Prime обязано вернуть в магазин, а не на главную
      openPageFrom("page-shop", "page-prime");
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
  /** terron 20.09: отказ рисуется красным, а не зелёной плашкой успеха
   *  («Покупка не завершена» в зелёном читалась как удача). */
  private badMsg = "";
  private fail(text: string): void {
    this.badMsg = text;
    this.msg = text;
  }
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
    ) =>
      html`<span class="t-balance t-balance-chip">
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
    const navBtn = (id: "mine" | "earn" | "history" | "topup", label: string) =>
      html`<button
        class="t-btn"
        style=${`padding:5px 10px;font-size:13px;${
          this.tab === id ? "" : "background:var(--t-sheet);color:var(--t-ink)"
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
        ${this.codesAvailable
          ? html`<button
              class="t-btn"
              style="padding:5px 10px;font-size:13px;background:var(--t-sheet);color:var(--t-ink)"
              title=${L("Ввести бонус-код", "Enter a bonus code")}
              @click=${() => this.openCode()}
            >
              🎁 ${L("Код", "Code")}
            </button>`
          : ""}
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
        ${this.topupAvailable ? navBtn("topup", L("Пополнить", "Top up")) : ""}
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
            this.topupAvailable ? () => this.openTab("topup") : null,
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
            style="margin-bottom:12px;padding:8px 12px;border-radius:8px;font-weight:600;${this.msg ===
            this.badMsg
              ? "background:rgba(179,38,30,.10);color:#b3261e"
              : "background:rgba(58,125,68,.12);color:#3a7d44"}"
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
      ${this.codeOpen ? this.renderCodeModal() : ""}
      ${this.topupDone ? this.renderTopupDone(this.topupDone) : ""}
    </div>`;
  }

  // скелетон-сетка: интерфейс появляется мгновенно, не ждём JSON каталога.
  private renderSkeleton(): TemplateResult {
    return html`<div
      class="t-grid"
      style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))"
    >
      ${Array.from({ length: 8 }).map(
        () =>
          html`<div
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
    if (this.platformShop) return this.renderPlatformTopup();
    if (this.embedded) return html``;
    const pay = this.pay;
    if (!pay) {
      return html`<div
        class="t-grid"
        style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))"
      >
        ${Array.from({ length: 6 }).map(
          () =>
            html`<div
              class="t-skel"
              style="height:120px;border-radius:12px"
            ></div>`,
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
      ${this.renderBonusNote(
        L(
          "ПТС тратятся на скины и слоты. Оплата картой или через СБП.",
          "PTS buy skins and slots. Card or SBP payment.",
        ),
      )}
      <!-- terron 26.08 (просьба владельца): пакетов ровно шесть, поэтому сетка
           ЖЁСТКО 3×2, а не auto-fill — иначе на широком экране выходило 4+2, и
           «лестница» пакетов читалась как случайная россыпь. Узкие экраны
           складываются в 2 и 1 колонку (класс .pay-grid в теме). -->
      <div class="t-grid pay-grid">
        ${pay.packs.map((p) => {
          const busy = this.buying === p.sku;
          return this.renderPackCard({
            nominal: p.pts,
            badge: p.badge,
            primeDays: p.primeDays ?? 0,
            price: busy
              ? L("Открываем…", "Opening…")
              : `${p.priceRub.toLocaleString("ru-RU")} ₽`,
            disabled: busy,
            onBuy: () => void this.startPayment(p.sku),
          });
        })}
      </div>
      ${this.renderPrimeNote()}
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
      bonus_code: L("Бонус-код", "Bonus code"),
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
      ${!this.topupAvailable
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
            (t) =>
              html`<tr style="border-bottom:1px solid var(--t-line,#e5e0cf)">
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
    const row = (iconName: string, title: string, desc: string) =>
      html`<div
        style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:var(--t-sheet)"
      >
        <div style="line-height:1;opacity:.85">${uiIcon(iconName, 22)}</div>
        <div>
          <div style="font-weight:700">${title}</div>
          <div class="t-muted" style="font-size:13px">${desc}</div>
        </div>
      </div>`;
    const head = (text: string, sub: string) =>
      html`<div style="margin-top:6px">
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
      ${!this.topupAvailable
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
      placeholder=${L(
        "Поиск: флаг, сша, россия, плитка…",
        "Search: flag, usa, tiled…",
      )}
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
    const tags = [...new Set(typed.flatMap((i) => i.tags ?? []))].filter(
      (t) => !["tile", "whole", "free"].includes(t),
    );
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
          title=${L(
            "Создать/загрузить свой скин",
            "Create/upload your own skin",
          )}
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
      | (HTMLElement & {
          startEdit?: (x: NamedSkin) => void;
          open?: () => void;
        })
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
              (tg) =>
                html`<span
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
  // ── terron 16.09: БОНУС-КОДЫ ────────────────────────────────────────────
  // Ввёл код — на аккаунт падают ПТС/ЛТС/скины (сервер: platform-api/src/bonusCodes.ts).
  // ⚠️ В нативных апках поля нет: App Store (3.1.1) запрещает свои механизмы
  // разблокировки содержимого (промокоды, ключи) в обход их покупок — тот же
  // гейт хоста, что прячет пополнение. На сайте и площадках — есть.
  @state() private codeOpen = false;
  @state() private codeInput = "";
  // отказ рисуется ВНУТРИ окна кода: общий this.msg живёт на странице под
  // затемнением, и игрок его не видит, пока окно открыто
  @state() private codeError = "";
  // шаг 2 окна: код проверен, игрок видит награду и решает — забрать или отказаться
  @state() private codePreview: { code: string; rewards: BonusCodeReward[] } | null = null;

  private get codesAvailable(): boolean {
    return payHost().kind !== "native";
  }

  private openCode(): void {
    this.codeInput = "";
    this.codeError = "";
    this.codePreview = null;
    this.codeOpen = true;
  }

  private static codeRefusalText(r: BonusCodeRefusal): string {
    switch (r) {
      case "unauthorized":
        return L(
          "Войди в аккаунт — награда по коду зачисляется на него.",
          "Sign in — code rewards go to your account.",
        );
      case "already_redeemed":
        return L("Ты уже активировал этот код.", "You've already used this code.");
      case "used_up":
        return L("Этот код уже использован.", "This code has already been used.");
      case "expired":
        return L("Срок действия кода истёк.", "This code has expired.");
      case "not_started":
        return L("Код ещё не действует — попробуй позже.", "This code isn't active yet.");
      case "too_many_attempts":
        return L(
          "Лимит неудачных попыток на сутки исчерпан.",
          "Daily limit of failed attempts reached.",
        );
      case "skin_name_taken":
        return L(
          "Ник скина из этого кода уже кем-то занят — напиши нам, заменим.",
          "The skin nickname in this code is already taken — contact us.",
        );
      case "network":
        return L("Нет связи с сервером — попробуй ещё раз.", "Can't reach the server — try again.");
      default:
        return L("Такого кода нет.", "No such code.");
    }
  }

  /** Текст отказа + сколько попыток осталось / когда можно снова. */
  private static codeFailureText(f: BonusCodeFailure): string {
    let t = ShopPage.codeRefusalText(f.reason);
    if (f.reason === "too_many_attempts" && f.retryAt) {
      const at = new Date(f.retryAt);
      if (!Number.isNaN(at.getTime())) {
        t += L(" Попробуй после ", " Try again after ") +
          at.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + ".";
      }
    } else if (typeof f.attemptsLeft === "number" && f.attemptsLeft <= 3) {
      t += L(` Осталось попыток на сутки: ${f.attemptsLeft}.`, ` Attempts left today: ${f.attemptsLeft}.`);
    }
    return t;
  }

  // Шаг 1: проверить код — показать награду, ничего не выдавая.
  private async submitCode(): Promise<void> {
    const code = this.codeInput.trim();
    if (code.length < 4 || this.busy) return;
    this.busy = "code";
    this.requestUpdate();
    const r = await checkBonusCode(code);
    this.busy = "";
    if (!r.ok) {
      this.codeError = ShopPage.codeFailureText(r);
      this.requestUpdate();
      return;
    }
    this.codeError = "";
    this.codePreview = { code: r.code, rewards: r.rewards };
    this.requestUpdate();
  }

  // Шаг 2: забрать.
  private async claimCode(): Promise<void> {
    const p = this.codePreview;
    if (!p || this.busy) return;
    this.busy = "code";
    this.requestUpdate();
    const r = await redeemBonusCode(p.code);
    this.busy = "";
    if (!r.ok) {
      // код успели погасить/выключить между шагами — возвращаем на ввод с причиной
      this.codePreview = null;
      this.codeError = ShopPage.codeFailureText(r);
      this.requestUpdate();
      return;
    }
    const g = r.granted;
    this.lts = r.balances.lts;
    this.pts = r.balances.pts;
    const parts: string[] = [];
    if (g.pts) parts.push(`+${g.pts.toLocaleString("ru-RU")} ${L("ПТС", "PTS")}`);
    if (g.lts) parts.push(`+${g.lts.toLocaleString("ru-RU")} ${L("ЛТС", "LTS")}`);
    for (const s of g.skins) {
      const title = skinTitle({ sku: s.sku });
      parts.push(
        s.name
          ? L(`скин «${title}» на ник ${s.name}`, `skin “${title}” for ${s.name}`)
          : L(`скин «${title}»`, `skin “${title}”`),
      );
    }
    const unnamed = g.skins.some((s) => !s.name);
    this.msg =
      L("Код активирован: ", "Code redeemed: ") +
      parts.join(", ") +
      (unnamed
        ? L(
            ". Задай скину ник в «Мои скины».",
            ". Give the skin a nick in “My skins”.",
          )
        : "");
    this.codeOpen = false;
    this.codePreview = null;
    if (g.skins.length) void this.load();
    this.requestUpdate();
  }

  private renderCodeReward(p: { code: string; rewards: BonusCodeReward[] }): TemplateResult {
    const skins = p.rewards.filter(
      (r): r is Extract<BonusCodeReward, { type: "skin" }> => r.type === "skin",
    );
    const sum = (t: "pts" | "lts") =>
      p.rewards.reduce((a, r) => (r.type === t ? a + r.amount : a), 0);
    const pts = sum("pts");
    const lts = sum("lts");
    return html`
      <div style="font-weight:800;margin-bottom:2px;color:#2e7d32">
        ✓ ${L("Верный код", "Valid code")}
      </div>
      <div class="t-muted" style="font-size:12px;margin-bottom:12px;letter-spacing:.06em">
        ${p.code}
      </div>
      <div style="font-weight:700;margin-bottom:8px">${L("Награда", "Reward")}</div>
      ${skins.length
        ? html`<div
            style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:10px"
          >
            ${skins.map((sk) => {
              const item = this.items.find((i) => i.sku === sk.sku);
              // та же подача, что в карточке витрины: плитка — повтором фоном
              const tile = item?.url && (item.mode === 1 || item.mode === 3);
              return html`<div
                style="border:1px solid rgba(0,0,0,.15);padding:6px;background:var(--t-sheet)"
              >
                <div
                  style=${"position:relative;aspect-ratio:4/3;" +
                  (tile
                    ? `background:#cdbb93 url("${assetUrl(item!.url!)}") 0 0 / 30px 30px repeat`
                    : "background:#cdbb93")}
                >
                  ${item?.url && !tile
                    ? html`<img
                        src=${assetUrl(item.url)}
                        alt=""
                        style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
                      />`
                    : ""}
                </div>
                <div style="font-weight:700;font-size:13px;margin-top:4px">
                  ${skinTitle(item ?? { sku: sk.sku })}
                </div>
                <div class="t-muted" style="font-size:11px">
                  ${sk.name
                    ? L(`ник: ${sk.name}`, `nick: ${sk.name}`)
                    : L("ник задашь сам", "you pick the nick")}
                </div>
              </div>`;
            })}
          </div>`
        : ""}
      ${pts || lts
        ? html`<div
            style="display:flex;gap:14px;flex-wrap:wrap;font-weight:800;font-size:18px;margin-bottom:14px"
          >
            ${pts
              ? html`<span>+${pts.toLocaleString("ru-RU")} ${coin("pts", 18)}</span>`
              : ""}
            ${lts
              ? html`<span>+${lts.toLocaleString("ru-RU")} ${coin("lts", 18)}</span>`
              : ""}
          </div>`
        : ""}
      <div style="display:flex;gap:8px">
        <button
          class="t-btn"
          style="flex:1"
          ?disabled=${this.busy !== ""}
          @click=${() => this.claimCode()}
        >
          ${this.busy === "code" ? L("Забираем…", "Claiming…") : L("Забрать", "Claim")}
        </button>
        <button
          class="t-btn"
          style="flex:1;background:var(--t-sheet);color:var(--t-ink)"
          ?disabled=${this.busy !== ""}
          @click=${() => {
            this.codeOpen = false;
            this.codePreview = null;
          }}
        >
          ${L("Отказаться", "Decline")}
        </button>
      </div>
    `;
  }

  private renderCodeModal(): TemplateResult {
    return html`<div
      style="position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)"
      @click=${() => {
        this.codeOpen = false;
      }}
    >
      <div
        @click=${(e: Event) => e.stopPropagation()}
        style="background:var(--t-bg,#fdfcf7);color:var(--t-ink);border-radius:14px;padding:18px;width:min(92vw,420px);box-shadow:0 20px 60px rgba(0,0,0,.4)"
      >
        ${this.codePreview ? this.renderCodeReward(this.codePreview) : this.renderCodeInput()}
      </div>
    </div>`;
  }

  private renderCodeInput(): TemplateResult {
    return html`
        <div style="font-weight:800;margin-bottom:6px">
          🎁 ${L("Бонус-код", "Bonus code")}
        </div>
        <div class="t-muted" style="font-size:12px;margin-bottom:10px">
          ${L(
            "Введи код — сначала покажем, что он даёт.",
            "Enter a code — we'll show what it gives first.",
          )}
        </div>
        <input
          class="t-input"
          style="width:100%;margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em"
          placeholder="XXXX-XXXX-XXXX"
          maxlength="40"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          .value=${this.codeInput}
          @input=${(e: Event) => {
            this.codeInput = (e.target as HTMLInputElement).value;
            this.codeError = "";
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") void this.submitCode();
          }}
        />
        ${this.codeError
          ? html`<div
              role="alert"
              style="margin:-4px 0 10px;font-size:13px;font-weight:600;color:#b3261e"
            >
              ${this.codeError}
            </div>`
          : ""}
        <div style="display:flex;gap:8px">
          <button
            class="t-btn"
            style="flex:1"
            ?disabled=${this.busy !== "" || this.codeInput.trim().length < 4}
            @click=${() => this.submitCode()}
          >
            ${this.busy === "code"
              ? L("Проверяем…", "Checking…")
              : L("Проверить", "Check")}
          </button>
          <button
            class="t-btn"
            style="flex:1;background:var(--t-sheet);color:var(--t-ink)"
            @click=${() => {
              this.codeOpen = false;
            }}
          >
            ${L("Отмена", "Cancel")}
          </button>
        </div>
    `;
  }

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
    if (args?.tab === "code" && this.codesAvailable) this.openCode();
    if (args?.tab === "topup") this.openTab("topup");
    this.showPayResult();
    void this.load();
    // terron 17.09: на площадке provider спрашиваем ПРИ КАЖДОМ ОТКРЫТИИ. Раньше —
    // один раз в connectedCallback, а элемент живёт в index.html и подключается
    // ДО готовности SDK: `platformPurchasesAvailable()` был false, запрос не
    // уходил вовсе, и витрина площадки не появлялась никогда.
    if (this.embedded) void this.loadPay();
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

  /**
   * terron 12.09: ВИТРИНА ПЛОЩАДКИ. Внутри площадки своя платёжка запрещена
   * (embedded), но покупать можно ЧЕРЕЗ площадку — каталог отдаёт её SDK
   * (PlatformPay), факт оплаты подтверждает наш сервер. Показываем, когда
   * площадка отдаёт покупки и в каталоге есть наши пакеты; сама кнопка «купить»
   * работает только если сервер ответил provider = "gamepush" (рубильник).
   */
  connectedCallback(): void {
    super.connectedCallback();
    // площадка: узнать provider (рубильник покупок) до первого рендера вкладок
    if (this.embedded) void this.loadPay(); // площадка: узнать provider
    // SDK поднимается позже страницы — переспрашиваем, когда он готов.
    window.addEventListener("gp-ready", this.onGpReady);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("gp-ready", this.onGpReady);
  }

  private onGpReady = (): void => {
    if (this.embedded) void this.loadPay();
  };

  private get platformShop(): boolean {
    // ⚠️ Витрина площадки видна ТОЛЬКО по слову сервера (рубильник
    // GAMEPUSH_PAYMENTS_ENABLED): товары в панели GamePush уже заведены, и без
    // этого гейта вкладка с ценами всплыла бы на живых ОК/Пикабу раньше, чем
    // владелец включил покупки (требование 12.09: «везде всё скрыто до выката»).
    return (
      this.embedded &&
      this.pay?.provider === "gamepush" &&
      platformPurchasesAvailable() &&
      platformPtsProducts().length > 0
    );
  }

  /** Вкладка «Пополнить» есть либо у своей платёжки, либо у витрины площадки. */
  private get topupAvailable(): boolean {
    return !this.embedded || this.platformShop;
  }

  @state() private platformBuying: string | null = null;
  /** terron 20.09: окно «баланс пополнен» — строка над витриной терялась
   *  («можешь не между делом кусок текста, а поздравляем, баланс пополнен?»). */
  @state() private topupDone: {
    gained: number;
    balance: number;
    /** Сколько дней Prime принесла покупка и до какого числа он теперь. */
    primeDays: number;
    primeUntil: number | null;
  } | null = null;

  /** Дни Prime за пакет — из той же лестницы `/pay/packs`, что на карточках. */
  private primeDaysOf(tag: string): number {
    const t = tag.toLowerCase();
    return this.pay?.packs.find((p) => p.sku === t)?.primeDays ?? 0;
  }

  /** Сколько реально пришло — по РАЗНИЦЕ баланса: в неё входит и бонус первой
   *  покупки, которого в ответе сервера нет (там номинал пакета). */
  private async celebrateTopup(
    before: number,
    atLeast: number,
    primeDays: number,
  ): Promise<void> {
    // Срок Prime перечитываем у сервера: дни ПРИБАВЛЯЮТСЯ к остатку, и дату
    // «активен до» клиент сам не посчитает.
    // …и /pay/packs: бонус первой покупки после неё гаснет, значки ×2 обязаны уйти.
    const [, , pay] = await Promise.all([
      this.load(),
      primeDays > 0 ? refreshPrimeStatus() : null,
      getPayPacks(),
    ]);
    if (pay) this.pay = pay;
    this.topupDone = {
      gained: Math.max(this.pts - before, atLeast),
      balance: this.pts,
      primeDays,
      primeUntil: primeDays > 0 ? primeUntilMs() : null,
    };
  }

  private renderTopupDone(d: NonNullable<ShopPage["topupDone"]>): TemplateResult {
    const close = () => {
      this.topupDone = null;
    };
    return html`<div
      style="position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)"
      @click=${close}
    >
      <div
        @click=${(e: Event) => e.stopPropagation()}
        style="background:var(--t-bg,#fdfcf7);color:var(--t-ink);border:2px solid var(--t-ink);padding:22px 22px 18px;width:min(92vw,380px);text-align:center;box-shadow:6px 6px 0 rgba(0,0,0,.35)"
      >
        <div class="t-muted" style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">
          ${L("Поздравляем", "Congratulations")}
        </div>
        <div style="font-family:Oswald,sans-serif;font-size:26px;letter-spacing:.04em;text-transform:uppercase;margin-top:4px">
          ${L("Баланс пополнен", "Balance topped up")}
        </div>
        <div style="height:120px;margin:14px auto 6px;max-width:220px;background:linear-gradient(135deg,#2b2a24,#4a4130);display:flex;align-items:flex-end;justify-content:center;overflow:hidden">
          ${gemPile(d.gained)}
        </div>
        <div style="font-family:Oswald,sans-serif;font-size:34px;color:var(--t-red,#b3261e);margin-top:8px">
          +${d.gained.toLocaleString("ru-RU")}
        </div>
        <div class="t-muted" style="font-size:13px;margin-top:2px">
          ${L("кровавых алмазов", "blood diamonds")} ·
          ${L("на счету", "balance")}: <b style="color:var(--t-ink)">${d.balance.toLocaleString("ru-RU")}</b>
        </div>
        ${d.primeDays > 0
          ? html`<div
              style="margin-top:14px;padding:10px 12px;border:1px solid var(--t-ink);background:rgba(179,38,30,.06);font-size:13.5px;line-height:1.45"
            >
              <div style="font-weight:700">
                ${primeLink(primeGiftLabel(d.primeDays).replace(/^\+\s*/, "TERRON "))}
              </div>
              ${d.primeUntil
                ? html`<div class="t-muted" style="font-size:12px;margin-top:2px">
                    ${L("активен до", "active until")}
                    ${new Date(d.primeUntil).toLocaleDateString(
                      L("ru-RU", "en-GB"),
                      { day: "numeric", month: "long", year: "numeric" },
                    )}
                  </div>`
                : ""}
            </div>`
          : ""}
        <button class="t-btn" style="width:100%;margin-top:16px" @click=${close}>
          ${L("Отлично", "Great")}
        </button>
      </div>
    </div>`;
  }

  private renderPlatformTopup(): TemplateResult {
    const products = platformPtsProducts();
    const live = this.pay?.provider === "gamepush";
    return html`
      ${live
        ? this.pay?.bonus
          ? this.renderBonusNote("")
          : ""
        : html`<div
            class="t-muted"
            style="font-size:12.5px;line-height:1.5;margin-bottom:12px"
          >
            ${L(
              "Покупки через площадку скоро откроются — пока витрина только показывает цены.",
              "Platform purchases are opening soon — for now the showcase only shows prices.",
            )}
          </div>`}
      <div class="t-grid pay-grid">
        ${products.map((p) => {
          const busy = this.platformBuying === p.tag;
          const price = `${p.price ?? "?"} ${p.currencySymbol ?? p.currency ?? ""}`.trim();
          // Значок «хит» и срок Prime — из той же лестницы /pay/packs, что на
          // сайте: тег товара площадки = наш sku.
          const pack = this.pay?.packs.find((k) => k.sku === (p.tag ?? "").toLowerCase());
          return this.renderPackCard({
            nominal: ptsOf(p),
            badge: pack?.badge,
            primeDays: pack?.primeDays ?? 0,
            price: busy ? L("Покупаем…", "Buying…") : price,
            disabled: !live || busy || this.platformBuying !== null,
            onBuy: () => void this.buyOnPlatform(p.tag ?? ""),
          });
        })}
      </div>
      ${live ? this.renderPrimeNote() : ""}
    `;
  }

  /**
   * terron 20.09: ОДНА карточка пакета на обе витрины — сайт (Pally) и площадку
   * (GamePush). Репорт владельца: «где информация про прайм, про удвоение? у нас
   * единая система должна быть, какого у нас другое окно?» — витрина площадки
   * была отдельной копией и отстала: ни ×2, ни срока Prime, ни «хита».
   * Разное у витрин только цена на кнопке и то, что делает клик.
   */
  private renderPackCard(o: {
    nominal: number;
    badge?: string | null;
    primeDays: number;
    price: string;
    disabled: boolean;
    onBuy: () => void;
  }): TemplateResult {
    const bonus = this.pay?.bonus === true;
    const mult = this.pay?.multiplier ?? 1;
    const pts = bonus ? o.nominal * mult : o.nominal;
    // Карточка ровно та же, что у скинов (.t-skincard + .t-skinprev +
    // .t-skinname + сплит-кнопка цены) — витрина должна выглядеть одним
    // магазином, а не двумя разными (замечание владельца 21.08).
    return html`<div class="t-skincard">
      <!-- ⚠️ terron 26.08: ГОРКА, а не одна цифра. Разницу между 50 и 2000
           глаз ловит по РАЗМЕРУ кучи, а число рядом её называет. -->
      <div
        class="t-skinprev"
        style="background:linear-gradient(135deg,#2b2a24,#4a4230);display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;padding:8px 8px 6px;position:relative;overflow:hidden"
      >
        <div
          style="flex:1 1 auto;min-height:0;width:100%;display:flex;align-items:flex-end;justify-content:center"
        >
          ${gemPile(pts)}
        </div>
        <span
          style="display:inline-flex;align-items:center;gap:5px;font-family:var(--t-display);font-weight:700;font-size:19px;line-height:1;color:var(--t-parchment,#fdfcf7)"
          >${coin("pts", 14)} ${pts.toLocaleString("ru-RU")}</span
        >
        ${bonus
          ? html`<span
              style="position:absolute;right:5px;top:5px;background:var(--t-red);color:#fff;font-family:var(--t-mono,monospace);font-size:11px;padding:1px 5px"
              >×${mult}</span
            >`
          : o.badge
            ? html`<span
                style="position:absolute;right:5px;top:5px;background:var(--t-parchment,#fdfcf7);color:var(--t-ink);font-family:var(--t-mono,monospace);font-size:11px;padding:1px 5px"
                >${o.badge}</span
              >`
            : ""}
      </div>
      <!-- terron 20.09 (решение владельца): сверху на картинке — ИТОГ (100), снизу
           под ней — из чего он сложился, пока бонус действует: «50 + 50». Было
           «50 + бонус» — слово без цифры. Без бонуса — просто «50 алмазов». -->
      <div class="t-skinname">
        ${bonus
          ? html`${o.nominal.toLocaleString("ru-RU")}
              <span style="color:var(--t-red)"
                >+ ${(pts - o.nominal).toLocaleString("ru-RU")}</span
              >`
          : L(
              `${o.nominal.toLocaleString("ru-RU")} алмазов`,
              `${o.nominal.toLocaleString("en-US")} diamonds`,
            )}
      </div>
      ${o.primeDays
        ? html`<div
            style="font-family:var(--t-mono,monospace);font-size:11px;padding:0 8px 6px;text-align:center"
          >
            ${primeLink(primeGiftLabel(o.primeDays))}
          </div>`
        : ""}
      <div class="shop-split">
        <button class="shop-half pts" ?disabled=${o.disabled} @click=${o.onBuy}>
          ${o.price}
        </button>
      </div>
    </div>`;
  }

  /** Строка про бонус первой покупки — одна на обе витрины. */
  private renderBonusNote(fallback: string): TemplateResult {
    const pay = this.pay;
    return html`<div
      class="t-muted"
      style="font-size:12.5px;line-height:1.5;margin-bottom:12px"
    >
      ${pay?.bonus
        ? L(
            `Первая покупка в этом месяце — ПТС в ${pay.multiplier} раза больше.`,
            `First purchase this month — ${pay.multiplier}× the PTS.`,
          )
        : fallback}
    </div>`;
  }

  /** terron 26.08 (просьба владельца): прямым текстом под ВСЕМИ пакетами — прем
   *  даётся за каждое пополнение, а не за какой-то особенный. */
  private renderPrimeNote(): TemplateResult {
    return html`<div
      style="margin-top:14px;border:1px solid var(--t-ink);background:var(--t-sheet);padding:10px 14px;font-size:13px;line-height:1.6"
    >
      ${L(
        "Любое пополнение включает TERRON Prime на указанный у пакета срок. Если Prime уже действует — дни прибавляются к остатку.",
        "Every top-up switches on TERRON Prime for the time shown on the pack. If Prime is already running, the days are added to what is left.",
      )}
      ${primeLink(L("Что даёт Prime →", "What Prime does →"))}
    </div>`;
  }

  /**
   * Покупка через площадку. Порядок жёсткий: окно площадки → id покупки →
   * наш сервер проверяет её у GamePush и начисляет → ТОЛЬКО потом погашение.
   * Клиент нигде не начисляет сам.
   */
  private async buyOnPlatform(tag: string): Promise<void> {
    if (!tag || this.platformBuying || this.pay?.provider !== "gamepush") return;
    reportPayFunnel("pack_click", tag);
    this.platformBuying = tag;
    const before = this.pts;
    try {
      const purchaseId = await platformPurchase(tag);
      if (!purchaseId) {
        // terron 20.09: «Отмена» в окне площадки — не событие. Игрок ничего не
        // платил, напоминать ему об этом плашкой незачем (решение владельца).
        this.msg = "";
        return;
      }
      const r = await claimPlatformPurchase(purchaseId);
      if (!r || r.refused !== undefined) {
        // terron 17.09: на деве причину отказа пишем дословно — иначе проверку
        // платежей приходится вести по серверным логам.
        if (r?.refused !== undefined && isDevSite()) {
          this.fail(`Сервер не зачислил покупку: ${r.refused} (id ${purchaseId})`);
          return;
        }
        this.msg = L(
          "Оплата принята площадкой, но сервер её ещё не подтвердил — алмазы придут в течение минуты.",
          "The platform accepted the payment but our server hasn't confirmed it yet — diamonds will arrive within a minute.",
        );
        return;
      }
      if (r.credited) {
        await platformConsume(tag);
        this.msg = "";
        await this.celebrateTopup(before, r.pts, this.primeDaysOf(tag));
      } else {
        this.msg = L("Эта покупка уже была зачислена.", "This purchase was already credited.");
        await platformConsume(tag);
      }
    } finally {
      this.platformBuying = null;
    }
  }

  private async loadPay(): Promise<void> {
    // На площадке /pay/packs спрашиваем всегда: ответ говорит, включены ли
    // покупки через площадку (provider), без него витрины площадки нет.
    if (this.embedded && !platformPurchasesAvailable()) return;
    this.pay = await getPayPacks();
    this.requestUpdate();
    void this.recoverPlatformPurchases();
  }

  /**
   * terron 20.09: оплаченная, но не погашенная покупка = прошлый claim не
   * дошёл. Пока она висит, площадка не даст купить тот же пакет снова, а
   * алмазов у игрока нет. Сервер добирает сам (идемпотентно), мы гасим.
   */
  private recoveringPurchases = false;
  private async recoverPlatformPurchases(): Promise<void> {
    if (this.recoveringPurchases || this.pay?.provider !== "gamepush") return;
    if (platformPendingPtsTags().length === 0) return;
    this.recoveringPurchases = true;
    const before = this.pts;
    try {
      const items = await recoverPlatformPurchases();
      if (!items || items.length === 0) return;
      let pts = 0;
      let primeDays = 0;
      for (const it of items) {
        if (it.credited) {
          pts += it.pts;
          primeDays += this.primeDaysOf(it.tag);
        }
        await platformConsume(it.tag);
      }
      if (pts > 0) await this.celebrateTopup(before, pts, primeDays);
    } finally {
      this.recoveringPurchases = false;
    }
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
    const [items, ws] = await Promise.all([getCatalog(), getWalletStatus()]);
    this.items = items;
    if (ws.wallet) {
      this.lts = ws.wallet.lts;
      this.pts = ws.wallet.pts;
    } else if (ws.signedOut) {
      // Сессии нет — чужой/прошлый баланс на экране оставлять нельзя. При сбое
      // сети (signedOut=false) цифры не трогаем.
      this.lts = 0;
      this.pts = 0;
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

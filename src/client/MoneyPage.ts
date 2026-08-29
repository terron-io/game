import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  getEconomyRules,
  getWallet,
  getWalletHistory,
  type EconomyRules,
  type WalletBalances,
  type WalletTx,
} from "./Api";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

/**
 * /money — страница экономики: баланс ЛТС/ПТС, правила начислений (из
 * /economy/rules — тот же источник, что и фаунтан), история транзакций.
 *
 * ⚠️ УСТАРЕВШИЙ ДУБЛЬ, НЕ ПОДКЛЮЧЁН (проверено 28.08.2026).
 * Ни импорта, ни регистрации роутера, ни контейнера в index.html — в бандл не
 * попадает вовсе. Её заменила вкладка «История» в магазине (`/shop/history`,
 * выкат 29.07): там та же выписка по кошельку и баланс в шапке.
 *
 * Оставлена НАМЕРЕННО (решение владельца 28.08) как готовая разметка на случай,
 * если вернём отдельную страницу экономики. Захочешь включить обратно — нужны
 * ТРИ вещи разом: `import "./MoneyPage"` в Main.ts, `modalRouter.register("money",
 * {tag:"money-page", pageId:"page-money"})` и элемент `<money-page id="page-money">`
 * в index.html (без последнего роут открывается в пустоту — см. сторож
 * tests/client/RegisteredPagesHaveHost.test.ts).
 *
 * ⚠️ Прежняя шапка обещала «ТЕСТ-кнопки ± через /me/wallet/dev-adjust» — их в
 * файле НЕТ уже давно, комментарий врал. Сама ручка на сервере жива и закрыта
 * админ-гейтом (`isAdmin` → 403) с капом 100K, накрутить баланс ею нельзя.
 */
@customElement("money-page")
export class MoneyPage extends BaseModal {
  protected routerName = "money";

  @state() private bal: WalletBalances = { lts: 0, pts: 0 };
  @state() private rules: EconomyRules | null = null;
  @state() private history: WalletTx[] = [];

  protected modalConfig() {
    return { title: "Деньги" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: "Деньги (тест)",
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected onOpen(): void {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const [b, r, h] = await Promise.all([
      getWallet(),
      getEconomyRules(),
      getWalletHistory(40),
    ]);
    if (b) this.bal = b;
    this.rules = r;
    this.history = h;
  }

  private static reasonLabel(reason: string): string {
    return (
      {
        kill: "киллы",
        win: "победа",
        achievement: "ачивка",
        purchase: "покупка",
        grant: "выдача",
        dev: "тест",
      }[reason] ?? reason
    );
  }

  protected renderBody(): TemplateResult {
    const r = this.rules;
    return html`<div class="t-page">
      <!-- балансы -->
      <div style="display:flex;gap:14px;margin-bottom:16px">
        <div class="t-skincard" style="flex:1;text-align:center">
          <div class="t-muted">Ценные бумаги · игровые</div>
          <div style="font-size:30px;font-weight:800;line-height:1.1">
            ${this.bal.lts.toLocaleString("ru-RU")}
          </div>
        </div>
        <div class="t-skincard" style="flex:1;text-align:center">
          <div class="t-muted">Кровавые алмазы · платные</div>
          <div style="font-size:30px;font-weight:800;line-height:1.1">
            ${this.bal.pts.toLocaleString("ru-RU")}
          </div>
        </div>
      </div>

      <!-- правила начислений -->
      <h3 style="margin:0 0 8px;font-weight:800">Как начисляется</h3>
      ${r
        ? html`<ul style="margin:0 0 16px;padding-left:18px;line-height:1.7">
            <li>
              <b>+${r.rates.ltsPerMinute} бумаг</b> за минуту в матче (минимум
              +${r.rates.ltsMinPerMatch} за матч) и
              <b>+${r.rates.ltsPerNation}</b> за съеденную нацию
              <span class="t-muted">(кап ${r.caps.ltsPerDay} бумаг/сутки)</span>
            </li>
            <li>
              <b>+${r.rates.ptsPerWin} алмазов</b> за победу в матче
              <span class="t-muted"
                >(кап ${r.caps.ptsPerDayFree}/сутки без према,
                ${r.caps.ptsPerDayPremium} с премом)</span
              >
            </li>
            <li>
              <b>+${r.rates.ltsPerAchievement} бумаг</b> за каждую новую ачивку
            </li>
          </ul>`
        : html`<div class="t-muted" style="margin-bottom:16px">
            Правила недоступны (войди в аккаунт).
          </div>`}

      <!-- история -->
      <h3 style="margin:0 0 8px;font-weight:800">История</h3>
      ${this.history.length === 0
        ? html`<div class="t-muted">Пусто.</div>`
        : html`<table class="t-table" style="width:100%">
            ${this.history.map(
              (t) => html`<tr>
                <td>${MoneyPage.reasonLabel(t.reason)}</td>
                <td
                  class="num"
                  style="color:${t.amount >= 0 ? "#3a7d44" : "#a8432b"}"
                >
                  ${t.amount >= 0 ? "+" : ""}${t.amount}
                  ${t.currency.toUpperCase()}
                </td>
                <td class="num t-muted">
                  ${new Date(t.created_at).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
              </tr>`,
            )}
          </table>`}
    </div>`;
  }
}

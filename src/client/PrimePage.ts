// terron 26.08: /prime — что такое TERRON Prime и откуда он берётся.
//
// Просьба владельца: «дай ссылки где прайм — мол прайм на 3 недели — и сделай
// страницу /prime, там объясни чо делает». Раньше слово «Prime» встречалось
// только в подписи пакета: игрок платил, получал что-то с непонятным именем и
// нигде не мог прочитать, что именно ему дали.
//
// ⚠️ ПИШЕМ ТОЛЬКО ТО, ЧТО РАБОТАЕТ СЕГОДНЯ. Планы по бафам према лежат в
// BACKLOG.md §«БАФ ПРЕМА» и на этой странице их нет: обещание в магазине — это
// обещание за деньги. Появится баф — сюда добавится строка.
import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getPayPacks, primeUntilMs, type PayPacks } from "./Api";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { isTerronPrime } from "./UltimateGrid";
import { L, translateText } from "./Utils";

/** Срок в человеческих словах — тот же счёт, что в витрине магазина. */
function daysLabel(days: number): string {
  if (days % 30 === 0) {
    const m = days / 30;
    return L(`${m} мес.`, `${m} mo`);
  }
  const w = Math.max(1, Math.round(days / 7));
  return L(`${w} нед.`, `${w} wk`);
}

@customElement("prime-page")
export class PrimePage extends BaseModal {
  protected routerName = "prime";

  @state() private pay: PayPacks | null = null;

  protected modalConfig() {
    return { title: "TERRON Prime" };
  }

  protected onOpen(): void {
    // Лестницу сроков не хардкодим: она живёт в platform-api (PTS_PACKS) и
    // уже едет клиенту витриной пакетов. Второй список разъехался бы.
    void this.loadPacks();
  }

  private async loadPacks(): Promise<void> {
    this.pay = await getPayPacks();
    this.requestUpdate();
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: "TERRON Prime",
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  /** Плашка «у тебя он есть/нет» — первый вопрос зашедшего. */
  private renderStatus(): TemplateResult {
    const active = isTerronPrime();
    const until = primeUntilMs();
    const date = until
      ? new Date(until).toLocaleDateString(undefined, {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;
    return html`<div
      style="border:1px solid var(--t-ink);background:${active
        ? "rgba(58,125,68,.12)"
        : "var(--t-sheet)"};padding:10px 14px;margin-bottom:16px;font-weight:600"
    >
      ${active
        ? date
          ? L(`Prime активен — до ${date}.`, `Prime is active — until ${date}.`)
          : L("Prime активен.", "Prime is active.")
        : L(
            "Prime сейчас не активен.",
            "Prime is not active right now.",
          )}
    </div>`;
  }

  private renderLadder(): TemplateResult {
    const packs = (this.pay?.packs ?? []).filter((p) => (p.primeDays ?? 0) > 0);
    if (packs.length === 0) return html``;
    return html`<div
      class="t-grid"
      style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin:10px 0 4px"
    >
      ${packs.map(
        (p) => html`<div
          style="border:1px solid var(--t-ink);background:var(--t-sheet);padding:8px 10px;display:flex;justify-content:space-between;gap:8px;font-size:13px"
        >
          <span style="font-weight:700">
            ${p.priceRub.toLocaleString("ru-RU")} ₽
          </span>
          <span style="color:var(--t-red);font-weight:700">
            ${daysLabel(p.primeDays ?? 0)}
          </span>
        </div>`,
      )}
    </div>`;
  }

  protected renderBody(): TemplateResult {
    const h2 =
      "font-family:var(--t-display);text-transform:uppercase;font-size:15px;margin:18px 0 6px";
    return html`<div
      class="t-page"
      style="max-width:640px;font-size:14px;line-height:1.65;color:var(--t-ink)"
    >
      ${this.renderStatus()}

      <p>
        ${L(
          "Prime — это статус аккаунта. Он включается сам за любое пополнение и действует указанное время; покупать его отдельно не нужно.",
          "Prime is an account status. Any top-up switches it on for the stated time — there is nothing separate to buy.",
        )}
      </p>

      <div style=${h2}>${L("Что он даёт", "What it does")}</div>
      <p>
        ${L(
          "Расширенный выбор ульты в матче: нижний ряд сетки открыт, и выбираешь из девяти вариантов вместо шести. Это работает в каждом матче, пока Prime активен — и в первом наборе, и после платного переролла.",
          "A wider ultimate choice in a match: the bottom row of the grid is unlocked, so you pick from nine options instead of six. It applies to every match while Prime is active — both in the first roll and after a paid re-roll.",
        )}
      </p>
      <p style="color:var(--t-muted,#6b6858)">
        ${L(
          "Больше привилегий пока нет — не хотим обещать за деньги то, чего в игре ещё не существует. Появятся — будут описаны здесь.",
          "There are no other perks yet — we would rather not promise things the game does not have. When they arrive, they will be listed here.",
        )}
      </p>

      <div style=${h2}>${L("Как получить", "How to get it")}</div>
      <p>
        ${L(
          "Пополни баланс алмазов на любую сумму. Чем больше пакет, тем дольше действует Prime:",
          "Top up your diamonds by any amount. The bigger the pack, the longer Prime lasts:",
        )}
      </p>
      ${this.renderLadder()}

      <div style=${h2}>${L("Сроки складываются", "Time adds up")}</div>
      <p>
        ${L(
          "Пополнил, когда Prime ещё действует, — новые дни прибавляются к остатку, а не заменяют его. Срок никогда не сгорает из-за второй покупки.",
          "Topping up while Prime is still running adds the new days to what is left rather than replacing it. A second purchase never burns your remaining time.",
        )}
      </p>

      <div style=${h2}>${L("Когда закончится", "When it runs out")}</div>
      <p>
        ${L(
          "Всё, что куплено за алмазы, остаётся у тебя навсегда — Prime влияет только на выбор ульты. Кончился — сетка снова показывает шесть вариантов, аккаунт и покупки не меняются.",
          "Everything bought with diamonds stays yours forever — Prime only affects the ultimate choice. Once it ends, the grid shows six options again; your account and purchases are untouched.",
        )}
      </p>
    </div>`;
  }
}

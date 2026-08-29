import { html, TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { L, translateText } from "./Utils";

// terron: /glory (алиасы /слава, /fame, /hall-of-fame) — ЗАЛ СЛАВЫ. Почётный список
// тех, кто помог TERRON на раннем этапе: ютуберы/стримеры и важные тестеры/контрибьюторы.
//
// ✏️ КАК ДОБАВИТЬ ГЕРОЯ: впиши запись в YOUTUBERS или CONTRIBUTORS ниже.
//   { name: "Позывной", note: "за что", url: "https://…" (необяз.), tag: "канал"|"тестер"|… }
// Пустой раздел показывает «список формируется» — как только впишешь, покажется карточка.

interface Honoree {
  name: string; // имя/позывной
  note?: string; // за что в зале славы (кратко)
  url?: string; // ссылка (канал/профиль), необязательно
  tag?: string; // короткий бейдж (напр. «канал», «стрим», «тестер»)
}

// ⚠️ Массивы — функции: L() должен вызываться при РЕНДЕРЕ (константа модуля
// зафиксировала бы язык на момент загрузки бандла, до выбора языка).

// ── Дружественные проекты ─────────────────────────────────────────────────────
const PROJECTS = (): Honoree[] => [
  {
    name: "Petri Dish",
    note: L(
      "игра-побратим — подарила TERRON множество игроков и бесценный опыт",
      "sister game — gave TERRON a wave of players and priceless experience",
    ),
    url: "https://petridish.pw/",
    tag: L("игра", "game"),
  },
];

// ── Ранние ютуберы и стримеры ─────────────────────────────────────────────────
const YOUTUBERS = (): Honoree[] => [
  {
    name: "BassetH",
    note: L(
      "реклама в своём Telegram-чате привела первых игроков — и море фидбэка",
      "an ad in his Telegram chat brought the first players — and a sea of feedback",
    ),
    url: "https://www.youtube.com/@BassetH",
    tag: L("стрим", "stream"),
  },
];

// ── Тестеры и контрибьюторы ───────────────────────────────────────────────────
const CONTRIBUTORS = (): Honoree[] => [
  // { name: "Позывной", note: L("ловил баги спавна и авиации", "caught spawn and aviation bugs"), tag: L("тестер", "tester") },
];

@customElement("hall-of-fame-page")
export class HallOfFamePage extends BaseModal {
  protected routerName = "glory";

  protected modalConfig() {
    return { title: L("Зал славы", "Hall of Fame") };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: L("Зал славы", "Hall of Fame"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  private section(t: string): TemplateResult {
    return html`<div
      style="display:flex;align-items:center;gap:8px;margin:22px 0 10px;font-family:var(--t-display,sans-serif);font-weight:800;font-size:16px;color:var(--t-ink)"
    >
      <span
        style="display:inline-block;width:4px;height:18px;border-radius:2px;background:var(--t-red,#a8432b)"
      ></span>
      ${t}
    </div>`;
  }

  private card(h: Honoree): TemplateResult {
    const name = h.url
      ? html`<a
          href=${h.url}
          target="_blank"
          rel="noopener noreferrer"
          class="t-link"
          style="font-weight:800"
          >${h.name}</a
        >`
      : html`<span style="font-weight:800">${h.name}</span>`;
    return html`<div
      style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--t-sheet);border:1px solid var(--t-border,#0001)"
    >
      <span
        style="flex:0 0 auto;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--t-red,#a8432b);color:#fff;font-weight:800;font-size:13px"
        >★</span
      >
      <div style="min-width:0">
        <div style="font-size:14px;color:var(--t-ink)">
          ${name}
          ${h.tag
            ? html`<span
                style="margin-left:6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:6px;background:var(--t-red,#a8432b);color:#fff;vertical-align:middle"
                >${h.tag}</span
              >`
            : ""}
        </div>
        ${h.note
          ? html`<div class="t-muted" style="font-size:12px;line-height:1.4">
              ${h.note}
            </div>`
          : ""}
      </div>
    </div>`;
  }

  private list(items: Honoree[], emptyMsg: string): TemplateResult {
    if (items.length === 0) {
      return html`<div
        class="t-muted"
        style="font-size:13px;padding:12px 14px;border-radius:10px;background:var(--t-sheet);border:1px dashed var(--t-border,#0002)"
      >
        ${emptyMsg}
      </div>`;
    }
    return html`<div style="display:flex;flex-direction:column;gap:8px">
      ${items.map((h) => this.card(h))}
    </div>`;
  }

  protected renderBody(): TemplateResult {
    return html`<div
      class="t-page"
      style="max-width:640px;font-size:14px;line-height:1.65;color:var(--t-ink)"
    >
      <div
        style="padding:14px 16px;border-radius:12px;background:var(--t-sheet);font-weight:700"
      >
        ${L(
          "TERRON построен не в одиночку. Здесь — люди, которые поверили в проект на раннем этапе: рассказывали о нём, ломали и чинили, спорили о балансе и не давали забросить. Спасибо каждому.",
          "TERRON wasn't built alone. This is for the people who believed in the project early: spread the word, broke and fixed things, argued about balance and kept it alive. Thank you all.",
        )}
      </div>

      ${this.section(L("Дружественные проекты", "Friendly projects"))}
      ${this.list(
        PROJECTS(),
        L(
          "Раздел формируется — здесь появятся проекты, которые помогли TERRON вырасти.",
          "This section is forming — projects that helped TERRON grow will appear here.",
        ),
      )}

      ${this.section(L("Ютуберы и стримеры", "YouTubers & streamers"))}
      ${this.list(
        YOUTUBERS(),
        L(
          "Раздел формируется — здесь появятся авторы, что первыми показали TERRON.",
          "This section is forming — early creators who first featured TERRON will appear here.",
        ),
      )}

      ${this.section(L("Тестеры и контрибьюторы", "Testers & contributors"))}
      ${this.list(
        CONTRIBUTORS(),
        L(
          "Раздел формируется — здесь появятся те, кто ловил баги и помогал с балансом.",
          "This section is forming — those who caught bugs and shaped the balance will appear here.",
        ),
      )}

      <div class="t-muted" style="font-size:12px;margin-top:20px;line-height:1.5">
        ${L(
          "Хочешь сюда попасть? Помогай проекту — тестируй, репорти баги, рассказывай о TERRON.",
          "Want to be here? Help the project — test, report bugs, tell people about TERRON.",
        )}
      </div>
    </div>`;
  }

  protected onClose(): void {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }
}

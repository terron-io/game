import { LitElement, PropertyValues, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";

const ACTIVE_CARD =
  "bg-malibu-blue/20 border-malibu-blue/50 shadow-[var(--shadow-malibu-blue)]";
// terron: светлая тема сайта — чекбокс/рамки на белом были невидимы; делаем тёмными
const INACTIVE_CARD =
  "bg-black/[0.02] border-black/15 hover:bg-black/[0.05] hover:border-black/30";
const INPUT_CLASS =
  "w-full text-center rounded bg-black/60 text-white text-sm font-bold border border-white/20 focus:outline-none focus:border-malibu-blue p-1 my-1";
const CARD_LABEL_CLASS =
  "text-xs uppercase font-bold tracking-wider leading-tight break-words hyphens-auto";

function cardClass(active: boolean, extra = ""): string {
  return `w-full h-full rounded-xl border cursor-pointer transition-all duration-200 active:scale-95 ${extra} ${active ? ACTIVE_CARD : INACTIVE_CARD}`;
}

@customElement("toggle-input-card")
export class ToggleInputCard extends LitElement {
  @property({ attribute: false }) labelKey = "";
  @property({ type: Boolean, attribute: false }) checked = false;
  @property({ attribute: false }) inputId?: string;
  @property({ attribute: false }) inputType = "number";
  @property({ attribute: false }) inputMin?: number | string;
  @property({ attribute: false }) inputMax?: number | string;
  @property({ attribute: false }) inputStep?: number | string;
  @property({ attribute: false }) inputValue?: number | string;
  @property({ attribute: false }) inputAriaLabel?: string;
  @property({ attribute: false }) inputPlaceholder?: string;
  @property({ attribute: false }) defaultInputValue?: number | string;
  @property({ attribute: false }) minValidOnEnable?: number;
  @property({ attribute: false }) onToggle?: (
    checked: boolean,
    value: number | string | undefined,
  ) => void;
  @property({ attribute: false }) onInput?: (e: Event) => void;
  @property({ attribute: false }) onChange?: (e: Event) => void;
  @property({ attribute: false }) onKeyDown?: (e: KeyboardEvent) => void;

  createRenderRoot() {
    return this;
  }

  protected updated(changedProperties: PropertyValues<this>) {
    if (!changedProperties.has("checked")) return;
    const previousChecked = changedProperties.get("checked");
    if (previousChecked === false && this.checked && this.toggledByUser) {
      this.toggledByUser = false;
      const input = this.querySelector("input");
      // Фокус — да (игрок сам включил тогл, чтобы ввести число), выделение —
      // НЕТ: именно оно поднимает браузерные подсказки над полем.
      if (input) input.focus();
    }
  }

  private toOptionalNumber(
    value: number | string | undefined,
  ): number | undefined {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric : undefined;
    }
    return undefined;
  }

  private resolveValueOnEnable(): number | string | undefined {
    const currentValue = this.inputValue;

    if (
      currentValue === undefined ||
      currentValue === null ||
      currentValue === ""
    ) {
      return this.defaultInputValue;
    }

    if (this.minValidOnEnable === undefined) {
      return currentValue;
    }

    const numericValue = this.toOptionalNumber(currentValue);
    if (numericValue === undefined || numericValue < this.minValidOnEnable) {
      return this.defaultInputValue;
    }

    return numericValue;
  }

  private emitToggle() {
    const nextChecked = !this.checked;
    const nextValue = nextChecked ? this.resolveValueOnEnable() : undefined;
    this.onToggle?.(nextChecked, nextValue);
  }

  /**
   * terron 23.08: было ли включение РУКАМИ ИГРОКА. Без этого флага карточка
   * фокусировала и ВЫДЕЛЯЛА поле при восстановлении сохранённых настроек
   * лобби: игрок открывал «Создать игру», а браузер тут же предлагал
   * редактировать число (в Яндекс.Браузере — всплывашкой «Найти в Яндексе»).
   * Репорт владельца: «поле для редактуры открывать не требуется».
   */
  private toggledByUser = false;

  private handleCardClick = () => {
    this.toggledByUser = true;
    this.emitToggle();
  };

  render() {
    return html`
      <div class="${cardClass(this.checked, "relative overflow-hidden")}">
        <button
          type="button"
          aria-pressed=${this.checked}
          @click=${this.handleCardClick}
          class="w-full h-full p-3 flex flex-col items-center justify-between gap-2 focus:outline-none"
        >
          <!-- terron: тогл-слайдер вместо чекбокса — явно вкл/выкл -->
          <div
            class="h-5 w-10 rounded-full mt-1 transition-colors ${this.checked
              ? "bg-blue-500"
              : "bg-black/25"}"
            style="padding:2px"
          >
            <div
              class="h-4 w-4 rounded-full bg-white shadow transition-transform"
              style="transform:translateX(${this.checked ? "20px" : "0"})"
            ></div>
          </div>

          ${this.checked
            ? html`<div class="h-[30px] my-1"></div>`
            : html`<div class="h-[2px] w-4 rounded my-3 bg-black/30"></div>`}

          <span
            class="${CARD_LABEL_CLASS} text-center ${this.checked
              ? "text-white"
              : "text-white/60"}"
          >
            ${translateText(this.labelKey)}
          </span>
        </button>

        ${this.checked
          ? html`
              <div
                class="absolute left-3 right-3 top-1/2 -translate-y-1/2 z-10"
              >
                <input
                  type=${this.inputType}
                  id=${this.inputId ?? nothing}
                  min=${this.inputMin ?? nothing}
                  max=${this.inputMax ?? nothing}
                  step=${this.inputStep ?? nothing}
                  .value=${String(this.inputValue ?? "")}
                  class=${INPUT_CLASS}
                  aria-label=${this.inputAriaLabel ?? nothing}
                  placeholder=${this.inputPlaceholder ?? nothing}
                  @input=${this.onInput}
                  @change=${this.onChange}
                  @keydown=${this.onKeyDown}
                />
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

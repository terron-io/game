import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

/**
 * Общий ввод «identifier» (id / @slug / имя / ссылка) — поле + кнопка. Эмитит
 * событие `submit` с `detail.value` (обрезанное). Серверный резолвер общий
 * (`findUserByIdentifier`). Используется в /friends и в инвайт-секции кланов —
 * НЕ клонируем логику ввода. См. friends.md (бэклог «общий IdentifierInput»).
 *
 * Light DOM (createRenderRoot=this), чтобы работали глобальные классы `.t-input`/
 * `.t-btn` (в shadow DOM они не проходят).
 */
@customElement("identifier-input")
export class IdentifierInput extends LitElement {
  @property() placeholder = "";
  @property() buttonLabel = "";
  @property({ type: Boolean }) disabled = false;
  @state() private value = "";

  protected createRenderRoot() {
    return this;
  }

  /** Очистить поле (звать из родителя после успешной отправки). */
  clear(): void {
    this.value = "";
  }

  private submit(): void {
    const v = this.value.trim();
    if (!v || this.disabled) return;
    this.dispatchEvent(
      new CustomEvent("submit", { detail: { value: v }, bubbles: false }),
    );
  }

  render(): TemplateResult {
    return html`<div style="display:flex;gap:8px">
      <input
        class="t-input"
        style="flex:1;box-sizing:border-box"
        placeholder=${this.placeholder}
        .value=${this.value}
        ?disabled=${this.disabled}
        @input=${(e: Event) =>
          (this.value = (e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter") this.submit();
        }}
      />
      <button
        class="t-btn"
        ?disabled=${this.disabled}
        @click=${() => this.submit()}
      >
        ${this.buttonLabel}
      </button>
    </div>`;
  }
}

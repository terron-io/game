import { LitElement, TemplateResult, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";

// terron 22.08: булевы настройки лобби писались словами «Включено/Выключено»
// одним цветом с остальными чипами — длинно и не читается взглядом. Теперь у
// таких чипов не `value`, а `state`: короткое «Да ✓» / «Нет ✗» приглушённым
// зелёным/красным (агрессивные тона на пергаменте темы выглядят тревогой).
// ⚠️ Класса text-white тут быть НЕ должно: тема перекрашивает всё, что им
// помечено, в чернила через `!important` (terron-theme.css) — цвет пропал бы.
const STATE_COLOR = {
  on: "var(--t-green, #3f7a4a)",
  off: "var(--t-red, #a8432b)",
} as const;

@customElement("lobby-config-item")
export class LobbyConfigItem extends LitElement {
  @property({ type: String }) label = "";
  @property({ attribute: false }) value: string | TemplateResult = "";
  /** «Да ✓» / «Нет ✗»; задаётся вместо value у булевых настроек. */
  @property({ type: String }) state: "on" | "off" | "" = "";

  createRenderRoot() {
    return this;
  }

  private renderValue() {
    if (this.state !== "on" && this.state !== "off") {
      return html`<span
        class="text-white font-bold text-sm w-full break-words hyphens-auto"
        >${this.value}</span
      >`;
    }
    const on = this.state === "on";
    return html`<span
      class="font-bold text-sm w-full break-words hyphens-auto"
      style="color: ${STATE_COLOR[this.state]}"
      >${translateText(on ? "common.yes" : "common.no")}
      ${on ? "✓" : "✗"}</span
    >`;
  }

  render() {
    return html`
      <div
        class="bg-white/5 border border-white/10 rounded-lg p-3 flex flex-col items-center justify-center gap-1 text-center min-w-[100px]"
      >
        <span
          class="text-white/40 text-[10px] font-bold uppercase tracking-wider"
          >${this.label}</span
        >
        ${this.renderValue() ?? nothing}
      </div>
    `;
  }
}

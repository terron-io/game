// terron 26.09: «ЧЕСТНЫЕ РАЗМЕРЫ» — переключатель равновеликих версий карт в
// пикере (решение владельца: вариант «А», справа от заголовка «Карта»).
// Карточка остаётся одна: при включённом переключателе пикер показывает и выбирает
// её равновеликую пару (EQUAL_AREA_OF в Game.ts), у карт без пары ничего не
// меняется. Выбор помнится на устройстве; переключатель и пикер синхронизируются
// событием окна.
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classicOf, equalAreaOf, GameMapType } from "../core/game/Game";
import { L } from "./Utils";

const KEY = "terron_equal_area_maps";
export const EQUAL_AREA_EVENT = "terron-equal-area-maps";

export function equalAreaOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setEqualAreaOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // хранилище запрещено — переключатель живёт до перезагрузки
  }
  window.dispatchEvent(new CustomEvent(EQUAL_AREA_EVENT, { detail: on }));
}

/** Какую карту показать и выбрать вместо `map` при текущем положении переключателя. */
export function displayMap(map: GameMapType, on = equalAreaOn()): GameMapType {
  if (on) return equalAreaOf(map) ?? map;
  return classicOf(map) ?? map;
}

@customElement("equal-area-toggle")
export class EqualAreaToggle extends LitElement {
  @state() private on = equalAreaOn();

  createRenderRoot() {
    return this;
  }

  private sync = (e: Event) => {
    this.on = (e as CustomEvent<boolean>).detail;
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.on = equalAreaOn();
    window.addEventListener(EQUAL_AREA_EVENT, this.sync);
  }

  disconnectedCallback(): void {
    window.removeEventListener(EQUAL_AREA_EVENT, this.sync);
    super.disconnectedCallback();
  }

  render() {
    const hint = L(
      "Страны в настоящую величину: Африка больше, Гренландия меньше (проекция Equal Earth)",
      "Countries at their true size: Africa bigger, Greenland smaller (Equal Earth projection)",
    );
    // ⚠️ Не <button> и без классов с «rounded»: тема сайта даёт любой кнопке
    // «печатную» тень со сдвигом, а всему rounded — рамку, и тумблер съезжал
    // (скрин владельца 26.09). Стили — свои, в квадратной манере темы.
    const ink = "var(--t-ink, #2b2a24)";
    const paper = "var(--t-sheet, #fdfcf7)";
    const toggle = () => setEqualAreaOn(!this.on);
    return html`<span
      class="flex items-center gap-3 cursor-pointer select-none"
      title=${hint}
      @click=${toggle}
    >
      <span class="text-sm font-bold text-white/80 uppercase tracking-wider"
        >${L("Честные размеры", "True size")}</span
      >
      <span
        role="switch"
        tabindex="0"
        aria-checked=${this.on}
        aria-label=${hint}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle();
          }
        }}
        style="position:relative;display:inline-block;width:40px;height:22px;box-sizing:border-box;border:2px solid ${ink};background:${this
          .on
          ? ink
          : paper};transition:background .15s"
      >
        <span
          style="position:absolute;top:2px;${this.on
            ? "left:20px"
            : "left:2px"};width:14px;height:14px;background:${this.on
            ? paper
            : ink};transition:left .15s"
        ></span>
      </span>
    </span>`;
  }
}

import { html, type TemplateResult } from "lit";

/**
 * terron 22.09: значок «сообщения» — пузырь с полосками, в духе штабной темы
 * (штрих, без эмодзи: ✉ владелец забраковал). Один на все кнопки чата: панель,
 * досье, друзья. Цельный svg-шаблон — фрагменты <path> вне svg lit рисует в
 * HTML-неймспейсе и они пропадают (урок OsIcons).
 */
export function chatIcon(size = 24): TemplateResult {
  return html`<svg
    viewBox="0 0 24 24"
    width=${size}
    height=${size}
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="square"
    stroke-linejoin="miter"
    aria-hidden="true"
    style="display:inline-block;vertical-align:middle"
  >
    <path d="M3 4h18v12H9l-6 4z"></path>
    <path d="M7 8h10M7 12h7"></path>
  </svg>`;
}

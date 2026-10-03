// terron 30.08: значки систем для страницы /download и ссылки в футере.
//
// Монохром на currentColor — красятся чернилами темы, как остальные значки.
// Apple-логотип не дублируем: он живёт в AndroidPromo рядом со ссылкой на
// App Store, второй экземпляр разъехался бы с первым.
//
// ⚠️ КАЖДАЯ ИКОНКА — ОДИН ЦЕЛЬНЫЙ ШАБЛОН, без общей функции-обёртки. Первая
// версия собирала `svg(size, html`<path…>`)` — и Windows с Linux не рисовались
// вовсе (0×0): lit создаёт вложенный шаблон в HTML-неймспейсе, а <path> обязан
// быть в SVG. То же предупреждение стоит в AndroidPromo. Поймано глазами уже на
// проде; сторож — tests/client/OsIcons.test.ts.
import { html, TemplateResult } from "lit";

/** Windows — четыре плитки «окна». */
export const windowsIcon = (size = 16): TemplateResult =>
  html`<svg
    viewBox="0 0 24 24"
    width=${size}
    height=${size}
    style="flex:0 0 auto;vertical-align:middle"
    aria-hidden="true"
  >
    <path
      fill="currentColor"
      d="M3 5.6 10.4 4.6v6.6H3V5.6ZM11.6 4.4 21 3v8.2h-9.4V4.4ZM3 12.8h7.4v6.6L3 18.4v-5.6ZM11.6 12.8H21V21l-9.4-1.4v-6.8Z"
    />
  </svg>`;

/** Linux — пингвин силуэтом: голова с клювом, тело, лапы. */
export const linuxIcon = (size = 16): TemplateResult =>
  html`<svg
    viewBox="0 0 24 24"
    width=${size}
    height=${size}
    style="flex:0 0 auto;vertical-align:middle"
    aria-hidden="true"
  >
    <path
      fill="currentColor"
      d="M12 2c2.2 0 3.7 1.7 3.7 3.9 0 1-.2 1.7-.2 2.4 0 .9.6 1.5 1.3 2.6.9 1.4 1.9 3 1.9 4.9 0 1.4-.5 2.5-1.3 3.2l1.3 2.3c.2.4 0 .7-.4.7h-4.1c-.3 0-.5-.2-.6-.5l-.2-.7c-.4.1-.9.2-1.4.2s-1-.1-1.4-.2l-.2.7c-.1.3-.3.5-.6.5H5.7c-.4 0-.6-.3-.4-.7L6.6 19c-.8-.7-1.3-1.8-1.3-3.2 0-1.9 1-3.5 1.9-4.9.7-1.1 1.3-1.7 1.3-2.6 0-.7-.2-1.4-.2-2.4C8.3 3.7 9.8 2 12 2Zm-1.5 3.1c-.5 0-.9.5-.9 1.1s.4 1.1.9 1.1.9-.5.9-1.1-.4-1.1-.9-1.1Zm3 0c-.5 0-.9.5-.9 1.1s.4 1.1.9 1.1.9-.5.9-1.1-.4-1.1-.9-1.1ZM12 8.2c-.8 0-1.6.4-2 .9-.2.2-.1.4.1.5l1.6.8c.2.1.4.1.6 0l1.6-.8c.2-.1.3-.3.1-.5-.4-.5-1.2-.9-2-.9Z"
    />
  </svg>`;

import { html, TemplateResult } from "lit";
import { brandWordmark } from "../../Utils";

/**
 * terron 11.09: логотип-wordmark = ИМЯ + домен. Внутри площадки словарь отдаёт
 * «ТЕРРОН.ио» (правило Яндекса 5.1.3 — как в каталоге), но название игры —
 * ТЕРРОН, а «.ио» лишь домен: рисуем его легче (класс `.terron-logo-tld`,
 * стиль в теме). На самом terron.io домена в wordmark нет — текст как есть.
 */
export function brandLogoParts(wordmark: string): {
  name: string;
  tld: string;
} {
  const dot = wordmark.indexOf(".");
  if (dot <= 0) return { name: wordmark, tld: "" };
  return { name: wordmark.slice(0, dot), tld: wordmark.slice(dot) };
}

export function brandLogo(): TemplateResult {
  const { name, tld } = brandLogoParts(brandWordmark());
  if (!tld) return html`${name}`;
  return html`${name}<span class="terron-logo-tld">${tld}</span>`;
}

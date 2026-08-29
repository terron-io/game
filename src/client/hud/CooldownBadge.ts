/**
 * terron 23.08 — ОДИН циферблат отката на все интерфейсы (панель строительства,
 * радиальное меню, прицельное управление на телефоне).
 *
 * Требование владельца: «чтобы если кулдаун есть, он ВЕЗДЕ являлся кулдауном».
 * Поэтому слой рисуется ОДНОЙ функцией и стилями строго инлайн — панель живёт в
 * обычном DOM с Tailwind, а прицельное управление в shadow DOM, куда классы
 * страницы не долетают. Инлайн работает в обоих.
 *
 * Данные — из client/Cooldowns.ts, откуда их берёт и карта.
 */
import { html, TemplateResult } from "lit";
import { Cooldown } from "../Cooldowns";

/**
 * Полупрозрачный «часовой» сектор поверх иконки + секунды.
 * Родитель обязан быть position:relative (у всех трёх мест он такой).
 */
export function cooldownOverlay(cd: Cooldown | null): TemplateResult | null {
  if (cd === null) return null;
  const deg = Math.round(cd.frac * 360);
  return html`<div
    style="position:absolute;inset:0;display:flex;align-items:center;
           justify-content:center;pointer-events:none;border-radius:2px;
           background:conic-gradient(rgba(6,10,16,0.72) ${deg}deg, rgba(6,10,16,0.18) 0);"
  >
    <span
      style="font:800 11px/1 Oswald, system-ui, sans-serif;color:#8fd0ff;
             text-shadow:0 1px 2px #000, 0 0 3px #000;"
      >${cd.seconds}</span
    >
  </div>`;
}

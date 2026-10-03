/**
 * terron: ПЕРЕКЛЮЧАЛКА ВИЗУАЛОВ — панель полигона `/v2`.
 *
 * Зачем отдельная панель, а не пункт в настройках: стили выбираются ГЛАЗАМИ и
 * сравниваются подряд, за секунды. Пять кликов через модалку настроек — это уже
 * не сравнение, а археология. Панель висит поверх карты, переключение
 * мгновенное (пересборки матча не требует), рядом — снимок карты без
 * интерфейса, чтобы стили можно было положить рядом картинками.
 *
 * ⚠️ Обычный DOM, без Lit и без регистрации custom element: панель живёт только
 * на полигоне и создаётся руками из VisualLab. Так её не надо вписывать в
 * index.html (а тот на проде правится хирургически — см. CLAUDE.md).
 *
 * ⚠️ Горячие клавиши БЕЗ ЦИФР: 1…0 в матче строят здания. Стиль листается
 * клавишей V (Shift+V — назад) и скобками [ ].
 */

import { VISUAL_STYLES } from "../render/gl/VisualStyles";
import { L } from "../Utils";
import {
  currentVisualStyleId,
  onVisualStyleChange,
  setVisualStyleId,
} from "../VisualStyleStore";

const PANEL_ID = "terron-v2-switcher";
const STYLE_ID = "terron-v2-switcher-css";
const COLLAPSED_KEY = "terron_v2_panel_collapsed";

let root: HTMLElement | null = null;
let abort: AbortController | null = null;

function collapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function setCollapsed(v: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
  } catch {
    /* приватный режим — переживём */
  }
  root?.classList.toggle("tv2-collapsed", v);
}

function injectCss(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
#${PANEL_ID}{
  position:fixed; left:8px; top:50%; transform:translateY(-50%);
  z-index:3000; width:232px; pointer-events:auto;
  font:12px/1.35 "Golos Text",system-ui,-apple-system,sans-serif;
  color:#eae6dc; background:rgba(12,14,18,.78);
  border:1px solid rgba(255,255,255,.16);
  box-shadow:0 10px 30px rgba(0,0,0,.45);
  backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  user-select:none;
}
#${PANEL_ID} .tv2-head{
  display:flex; align-items:center; justify-content:space-between;
  padding:7px 9px; cursor:pointer;
  border-bottom:1px solid rgba(255,255,255,.12);
  font:600 11px/1 "Oswald",system-ui,sans-serif;
  letter-spacing:.12em; text-transform:uppercase; color:#fff;
}
#${PANEL_ID} .tv2-head span.tv2-tag{ opacity:.5; font-size:10px; letter-spacing:.08em; }
#${PANEL_ID} .tv2-body{ padding:6px; display:flex; flex-direction:column; gap:3px; }
#${PANEL_ID}.tv2-collapsed{ width:auto; }
#${PANEL_ID}.tv2-collapsed .tv2-body,
#${PANEL_ID}.tv2-collapsed .tv2-foot{ display:none; }
#${PANEL_ID} .tv2-item{
  display:flex; align-items:center; gap:8px; padding:6px 7px;
  background:rgba(255,255,255,.04); border:1px solid transparent;
  cursor:pointer; transition:background .12s ease,border-color .12s ease;
}
#${PANEL_ID} .tv2-item:hover{ background:rgba(255,255,255,.10); }
#${PANEL_ID} .tv2-item.tv2-on{
  background:rgba(255,255,255,.13); border-color:rgba(255,255,255,.35);
}
#${PANEL_ID} .tv2-sw{ display:flex; width:26px; height:16px; flex:0 0 auto;
  outline:1px solid rgba(0,0,0,.5); }
#${PANEL_ID} .tv2-sw i{ flex:1; }
#${PANEL_ID} .tv2-name{ flex:1; min-width:0; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
#${PANEL_ID} .tv2-item.tv2-on .tv2-name{ font-weight:600; }
#${PANEL_ID} .tv2-mark{ opacity:.35; font:10px/1 ui-monospace,Menlo,monospace; }
#${PANEL_ID} .tv2-item.tv2-on .tv2-mark{ opacity:.9; }
#${PANEL_ID} .tv2-foot{ padding:7px 9px 9px; border-top:1px solid rgba(255,255,255,.12); }
#${PANEL_ID} .tv2-hint{ opacity:.62; font-size:11px; min-height:2.6em; }
#${PANEL_ID} .tv2-keys{ opacity:.4; font:10px/1.4 ui-monospace,Menlo,monospace;
  margin-top:6px; }
#${PANEL_ID} .tv2-shot{
  margin-top:7px; width:100%; padding:6px; cursor:pointer;
  background:rgba(255,255,255,.07); color:#eae6dc;
  border:1px solid rgba(255,255,255,.22);
  font:600 11px/1 "Oswald",system-ui,sans-serif; letter-spacing:.1em;
  text-transform:uppercase;
}
#${PANEL_ID} .tv2-shot:hover{ background:rgba(255,255,255,.14); }
@media (max-width:900px){ #${PANEL_ID}{ width:190px; font-size:11px; } }
`;
  document.head.appendChild(el);
}

function shiftStyle(step: number): void {
  const ids = VISUAL_STYLES.map((s) => s.id);
  const i = ids.indexOf(currentVisualStyleId());
  const next = ids[(i + step + ids.length) % ids.length];
  setVisualStyleId(next);
}

/** Снимок карты БЕЗ интерфейса (та же ручка, что у кнопки-фотика в игре). */
function shoot(): void {
  const cap = (
    window as unknown as {
      __terronCaptureMap?: (maxW?: number) => { dataUrl: string } | null;
    }
  ).__terronCaptureMap?.(2000);
  if (!cap) return;
  const a = document.createElement("a");
  a.href = cap.dataUrl;
  a.download = `terron-${currentVisualStyleId()}.png`;
  a.click();
}

function render(): void {
  if (root === null) return;
  const active = currentVisualStyleId();
  const style = VISUAL_STYLES.find((s) => s.id === active) ?? VISUAL_STYLES[0];
  const items = VISUAL_STYLES.map(
    (s) => `
    <div class="tv2-item ${s.id === active ? "tv2-on" : ""}" data-style="${s.id}">
      <span class="tv2-sw">${s.swatch
        .map((c) => `<i style="background:${c}"></i>`)
        .join("")}</span>
      <span class="tv2-name">${L(s.nameRu, s.nameEn)}</span>
      <span class="tv2-mark">${s.id === active ? "●" : "○"}</span>
    </div>`,
  ).join("");

  root.innerHTML = `
    <div class="tv2-head" data-act="collapse">
      <span>${L("Визуал", "Visuals")}</span>
      <span class="tv2-tag">/v2 ${root.classList.contains("tv2-collapsed") ? "▸" : "▾"}</span>
    </div>
    <div class="tv2-body">${items}</div>
    <div class="tv2-foot">
      <div class="tv2-hint">${L(style.hintRu, style.hintEn)}</div>
      <button class="tv2-shot" data-act="shot">${L("Снимок карты", "Capture map")}</button>
      <div class="tv2-keys">V / Shift+V · [ ]</div>
    </div>`;
}

export function mountVisualSwitcher(): void {
  if (root !== null || typeof document === "undefined") return;
  injectCss();
  root = document.createElement("div");
  root.id = PANEL_ID;
  if (collapsed()) root.classList.add("tv2-collapsed");
  document.body.appendChild(root);
  render();

  abort = new AbortController();
  const signal = abort.signal;

  root.addEventListener(
    "click",
    (e) => {
      const t = e.target as HTMLElement;
      const item = t.closest<HTMLElement>("[data-style]");
      if (item?.dataset.style) {
        setVisualStyleId(
          item.dataset.style as (typeof VISUAL_STYLES)[number]["id"],
        );
        return;
      }
      const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "collapse") {
        setCollapsed(!root!.classList.contains("tv2-collapsed"));
        render();
      } else if (act === "shot") {
        shoot();
      }
    },
    { signal },
  );

  window.addEventListener(
    "keydown",
    (e) => {
      // ⚠️ Не перехватываем ввод в полях (чат лобби, ник) — иначе буква «v»
      // в сообщении листала бы стиль.
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // ⚠️ Смотрим и code, и key. `code` — физическая клавиша (работает на
      // русской раскладке, где V печатает «м»), но у синтетических событий его
      // может не быть вовсе; `key` закрывает этот случай.
      const key = e.key.toLowerCase();
      if (e.code === "KeyV" || key === "v" || key === "м") {
        shiftStyle(e.shiftKey ? -1 : 1);
      } else if (e.code === "BracketRight" || key === "]") {
        shiftStyle(1);
      } else if (e.code === "BracketLeft" || key === "[") {
        shiftStyle(-1);
      }
    },
    // ⚠️ capture: игровой обработчик ввода живёт на слое над картой и гасит
    // всплытие — на обычном слушателе клавиша до панели не доходила (проверено
    // в живом матче). preventDefault НЕ зовём: чужие бинды не ломаем.
    { signal, capture: true },
  );

  onVisualStyleChange(() => render(), signal);
  // ⚠️ Язык интерфейса резолвится ПОЗЖЕ первой отрисовки (селектор языка
  // поднимается асинхронно) — без этого панель залипала на английском при
  // русском клиенте. Тот же приём, что у остальных ранних элементов.
  window.addEventListener("language-selected", () => render(), { signal });
  window.setTimeout(() => render(), 600);
}

export function unmountVisualSwitcher(): void {
  abort?.abort();
  abort = null;
  root?.remove();
  root = null;
}

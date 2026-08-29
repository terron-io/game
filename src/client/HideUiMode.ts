import { L } from "./Utils";

// terron 04.08: РЕЖИМ «УБРАТЬ ИНТЕРФЕЙС» — для скриншотов (просьба владельца).
//
// Кнопка-фотик снимает ТОЛЬКО карту (GL-канвас), интерфейс в неё не попадает
// в принципе. А вот системный снимок экрана (Cmd+Shift+4 / PrtScr) берёт всё
// как есть — для промо-материалов площадок нужен чистый кадр. Отсюда режим.
//
// Скрываем всё, кроме самого канваса: он вставлен ПЕРВЫМ ребёнком body
// (`#webgl-debug-canvas`, см. ClientGameRunner), поэтому одно CSS-правило
// накрывает и HUD, и модалки, и тосты — включая те, что появятся потом.
//
// Клавиша H. Через систему биндов не пошли намеренно: это инструмент для
// скриншотов, а не игровое действие, и он не должен занимать место в
// настройках управления. Работает только в матче.

const CLASS = "terron-hide-ui";
const STYLE_ID = "terron-hide-ui-style";
const HINT_ID = "terron-hide-ui-hint";

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent =
    `body.${CLASS} > *:not(#webgl-debug-canvas):not(#${HINT_ID})` +
    `:not(script):not(style):not(noscript) { display: none !important; }`;
  document.head.appendChild(st);
}

/** Короткая подсказка «как вернуть». Гаснет сама, чтобы не попасть в кадр. */
function showHint(): void {
  const old = document.getElementById(HINT_ID);
  if (old) old.remove();
  const el = document.createElement("div");
  el.id = HINT_ID;
  el.textContent = L("H — вернуть интерфейс", "H — bring the UI back");
  el.style.cssText = [
    "position:fixed",
    "left:50%",
    "top:12px",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "background:rgba(20,22,30,.85)",
    "color:#fff",
    "font:600 12px/1.4 system-ui,sans-serif",
    "padding:6px 12px",
    "border-radius:8px",
    "pointer-events:none",
    "transition:opacity .4s ease",
  ].join(";");
  document.body.appendChild(el);
  window.setTimeout(() => (el.style.opacity = "0"), 1300);
  window.setTimeout(() => el.remove(), 1800);
}

function toggle(): void {
  ensureStyle();
  const on = document.body.classList.toggle(CLASS);
  if (on) showHint();
  else document.getElementById(HINT_ID)?.remove();
}

let installed = false;

/** Повесить горячую клавишу (зовётся один раз из ClientGameRunner). */
export function installHideUiMode(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  // Слушаем в фазе ПЕРЕХВАТА на window: игровой ввод (InputHandler) ставит свои
  // обработчики раньше и гасит событие до всплытия — обычный слушатель на
  // document клавишу не видел (проверено на деве).
  window.addEventListener(
    "keydown",
    (e) => {
      // code — основной признак (не зависит от раскладки: на кириллице это
      // та же клавиша «р»). key — запасной: часть эмуляторов ввода шлёт
      // событие вообще без code.
      const isH =
        e.code === "KeyH" || (!e.code && e.key?.toLowerCase() === "h");
      if (!isH) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      // Не воруем клавишу у чата и любых полей ввода.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      if (!document.body.classList.contains("in-game")) return;
      e.preventDefault();
      e.stopPropagation();
      toggle();
    },
    true,
  );
}

/** Снять режим (уход из матча) — иначе меню осталось бы невидимым. */
export function resetHideUiMode(): void {
  document.body.classList.remove(CLASS);
  document.getElementById(HINT_ID)?.remove();
}

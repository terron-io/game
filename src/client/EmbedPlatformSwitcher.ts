import { platformLabel, platformTypes } from "./components/ui/platformBadge";
import { embedTestMode, platformContext } from "./PlatformContext";
import { L } from "./Utils";

/**
 * terron 11.09: переключатель площадки в ТЕСТ-РЕЖИМЕ (`?embed=1`). Плашка
 * «GamePush › Яндекс Игры ▾» сверху по центру: выбрал площадку — страница
 * перезагружается с `?embed=1&platform=<тип>`, и игра ведёт себя как при
 * детекте этой площадки (класс `gp-platform-<тип>`, кука сессии площадки,
 * гейты разделов). Список — все площадки из `platformBadge` + «другая…»
 * (будущие: тип вводится руками). Внутри настоящей площадки не рисуется
 * никогда: гейт — `embedTestMode()`.
 */
const ID = "terron-embed-switch";
const CUSTOM = "__custom";

function go(type: string): void {
  const t = type.trim();
  if (!t) return;
  window.location.href =
    window.location.pathname +
    "?embed=1&platform=" +
    encodeURIComponent(t.toLowerCase());
}

function build(): void {
  if (document.getElementById(ID)) return;
  const current = platformContext() ?? "NONE";
  const types = platformTypes();
  if (current !== "NONE" && !types.includes(current)) types.push(current);

  const box = document.createElement("div");
  box.id = ID;
  box.setAttribute(
    "style",
    // Внизу по центру, а не сверху: сверху плашка закрывала логотип в мобильной
    // шапке — ровно то, что в тест-режиме и смотрят.
    "position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:100000;" +
      "display:flex;align-items:center;gap:6px;padding:3px 8px;border-radius:6px;" +
      "white-space:nowrap;max-width:calc(100vw - 16px);" +
      "background:rgba(17,17,17,.88);color:#fff;font:11px/1.2 'IBM Plex Mono',monospace;" +
      "box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:auto",
  );
  const label = document.createElement("span");
  label.textContent = L("тест · GamePush ›", "test · GamePush ›");
  const sel = document.createElement("select");
  sel.setAttribute(
    "style",
    "background:#222;color:#fff;border:1px solid #555;border-radius:4px;font:inherit;padding:2px 4px;max-width:200px",
  );
  const opt = (value: string, text: string) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    if (value === current) o.selected = true;
    sel.appendChild(o);
  };
  opt("NONE", L("без площадки", "no platform"));
  for (const t of types) opt(t, `${platformLabel(t)} (${t})`);
  opt(CUSTOM, L("другая…", "other…"));
  sel.addEventListener("change", () => {
    if (sel.value === CUSTOM) {
      const v = window.prompt(
        L(
          "Тип площадки GamePush (например YANDEX):",
          "GamePush platform type (e.g. YANDEX):",
        ),
        "",
      );
      if (v) go(v);
      else sel.value = current;
      return;
    }
    go(sel.value);
  });
  box.append(label, sel);
  document.body.appendChild(box);
}

export function mountEmbedPlatformSwitcher(): void {
  if (!embedTestMode()) return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build, { once: true });
  } else {
    build();
  }
}

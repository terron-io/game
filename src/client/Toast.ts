// terron: единый ин-апп тост/подтверждение в НАШЕМ дизайне вместо нативных
// браузерных alert()/confirm() (их запрещено использовать — см. CLAUDE.md).
// alert(msg)   → toast(msg)
// confirm(msg) → await confirmDialog(msg)

import { L } from "./Utils";

let toastWrap: HTMLDivElement | null = null;

function ensureWrap(): HTMLDivElement {
  if (toastWrap && document.body.contains(toastWrap)) return toastWrap;
  const w = document.createElement("div");
  w.style.cssText =
    "position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:100000;" +
    "display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none";
  document.body.appendChild(w);
  toastWrap = w;
  return w;
}

export type ToastKind = "info" | "error" | "success";

const KIND_BG: Record<ToastKind, string> = {
  info: "rgba(20,22,30,.96)",
  error: "rgba(120,30,30,.96)",
  success: "rgba(28,70,40,.96)",
};

/** Ненавязчивое уведомление (замена alert). Автоскрытие. */
export function toast(message: string, kind: ToastKind = "info", ms = 4200): void {
  const el = document.createElement("div");
  el.textContent = message;
  el.style.cssText =
    `background:${KIND_BG[kind]};color:#fff;padding:10px 16px;border-radius:10px;` +
    "font:600 13px/1.35 'Golos Text',system-ui,sans-serif;max-width:min(92vw,560px);" +
    "box-shadow:0 8px 28px rgba(0,0,0,.45);transition:opacity .4s ease,transform .4s ease;" +
    "transform:translateY(-6px);opacity:0;pointer-events:auto;text-align:center";
  ensureWrap().appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px)";
    setTimeout(() => el.remove(), 450);
  }, ms);
}

// ── Мост legacy-уведомлений ─────────────────────────────────────────────────
// Utils.showToast() шлёт CustomEvent "show-message", который слушает ТОЛЬКО
// HUD-слой <heads-up-message> — он смонтирован лишь в игре. На сайте (аккаунт,
// лобби, кланы) эти тосты раньше уходили в пустоту. Мост ловит событие и на
// сайте рисует его нашим toast(); в игре молчит (рисует HUD) — без дубля.
let bridgeInstalled = false;
export function installShowMessageBridge(): void {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  window.addEventListener("show-message", (e: Event) => {
    if (document.querySelector("heads-up-message")) return; // в игре рисует HUD
    const d = (e as CustomEvent).detail ?? {};
    if (typeof d.message !== "string") return; // TemplateResult — только HUD
    toast(d.message, d.color === "red" ? "error" : "success", d.duration ?? 4200);
  });
}

/** Модальное подтверждение в нашем дизайне (замена confirm). Возвращает Promise<boolean>. */
export function confirmDialog(
  message: string,
  okLabel = L("Да", "Yes"),
  cancelLabel = L("Отмена", "Cancel"),
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:100001;display:flex;align-items:center;" +
      "justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(2px)";
    const card = document.createElement("div");
    card.style.cssText =
      "background:#fdfcf7;color:#2b2a24;border-radius:14px;padding:20px 22px;" +
      "max-width:min(92vw,420px);box-shadow:0 20px 60px rgba(0,0,0,.5);" +
      "font:500 14px/1.45 'Golos Text',system-ui,sans-serif";
    const msg = document.createElement("div");
    msg.textContent = message;
    msg.style.marginBottom = "16px";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;justify-content:flex-end";
    const mkBtn = (label: string, primary: boolean) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        "padding:8px 16px;border:none;border-radius:9px;cursor:pointer;font-weight:700;" +
        (primary
          ? "background:#2b2a24;color:#fdfcf7"
          : "background:#e7e1cf;color:#2b2a24");
      return b;
    };
    const ok = mkBtn(okLabel, true);
    const cancel = mkBtn(cancelLabel, false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close(false);
      else if (ev.key === "Enter") close(true);
    };
    const close = (val: boolean) => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(val);
    };
    ok.onclick = () => close(true);
    cancel.onclick = () => close(false);
    overlay.onclick = (e) => {
      if (e.target === overlay) close(false);
    };
    window.addEventListener("keydown", onKey, true);
    row.append(cancel, ok);
    card.append(msg, row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    ok.focus();
  });
}

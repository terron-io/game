// terron: диалог «Пожаловаться» для САЙТОВЫХ страниц (досье, клан) — светлая
// тема, в отличие от внутриигрового openReportPopup (тёмный HUD). Пишет в тот же
// эндпоинт /moderation/report (→ chat_reports + ТГ модерации). Взято по смыслу из
// EventsDisplay.openReportPopup, но под тему сайта и без игрового контекста.
import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";
import { toast } from "./Toast";
import { L } from "./Utils";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

let openEl: HTMLElement | null = null;
function close() {
  openEl?.remove();
  openEl = null;
}

/**
 * Открыть жалобу на игрока/клан. targetSlug — @slug/номер (обяз.), name — для показа,
 * context — метка что за объект («Досье», «Клан»). Отправляет причину в модерацию.
 */
export function openReportDialog(opts: {
  targetSlug: string;
  name: string;
  context: string;
}): void {
  close();
  const ru = L("ru", "en") === "ru";
  const wrap = document.createElement("div");
  openEl = wrap;
  wrap.style.cssText =
    "position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:20px;font-family:'Golos Text',system-ui,sans-serif";
  wrap.innerHTML = `<div style="width:340px;max-width:92vw;background:var(--t-sheet,#fdfcf7);color:var(--t-ink,#2b2a24);border:1px solid var(--t-ink,#2b2a24);box-shadow:0 12px 40px rgba(0,0,0,.35);padding:18px">
    <div style="font-weight:800;font-size:16px;margin-bottom:4px">${ru ? "Пожаловаться" : "Report"}</div>
    <div style="font-size:13px;color:var(--t-ink-soft,#6b6a62);margin-bottom:12px;word-break:break-word">${esc(opts.context)}: <b>${esc(opts.name)}</b></div>
    <textarea id="t-rep-reason" rows="3" placeholder="${ru ? "Причина жалобы…" : "Reason…"}"
      style="width:100%;box-sizing:border-box;resize:vertical;font:inherit;padding:8px 10px;border:1px solid var(--t-line,rgba(0,0,0,.25));background:#fff;color:var(--t-ink,#2b2a24)"></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button id="t-rep-cancel" style="font:inherit;padding:7px 14px;border:1px solid var(--t-line,rgba(0,0,0,.25));background:transparent;color:var(--t-ink,#2b2a24);cursor:pointer">${ru ? "Отмена" : "Cancel"}</button>
      <button id="t-rep-send" style="font:inherit;font-weight:700;padding:7px 14px;border:1px solid var(--t-ink,#2b2a24);background:var(--t-ink,#2b2a24);color:var(--t-parchment,#fff);cursor:pointer">${ru ? "Отправить" : "Send"}</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);

  const reason = wrap.querySelector<HTMLTextAreaElement>("#t-rep-reason");
  reason?.focus();
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  wrap
    .querySelector("#t-rep-cancel")
    ?.addEventListener("click", () => close());
  wrap.querySelector("#t-rep-send")?.addEventListener("click", async () => {
    const text = (reason?.value ?? "").trim();
    if (!text) {
      reason?.focus();
      return;
    }
    close();
    try {
      const res = await fetch(`${getApiBase()}/moderation/report`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await getAuthHeader(),
        },
        body: JSON.stringify({
          targetSlug: opts.targetSlug,
          targetName: opts.name,
          messageText: text,
          reason: opts.context,
        }),
      });
      toast(
        res.ok
          ? L("Жалоба отправлена", "Report sent")
          : L("Не удалось отправить", "Failed to send"),
        res.ok ? "success" : "error",
      );
    } catch {
      toast(L("Не удалось отправить", "Failed to send"), "error");
    }
  });
}

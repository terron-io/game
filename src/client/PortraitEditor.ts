// terron: РЕДАКТОР пиксель-портрета (аватарка-персона). Спека — avatar.md.
//
// Открывается по клику на аватарку в досье. Не Lit-компонент намеренно: canvas +
// частая перерисовка плохо дружат с реактивным рендером, а редактор нужен
// самодостаточным (грузится динамическим import'ом, чтобы не пухнул бандл).
//
// Мобилка — требование, а не приятность:
//  • 1 палец = рисовать, 2 пальца = зум+пан (pinch), touch-action:none на канвасе,
//    иначе страница уезжает под пальцем;
//  • инструменты и палитра ВНИЗУ (зона большого пальца), хиты ≥44px;
//  • отмена — отдельной крупной кнопкой (промахи пальцем постоянны).

import {
  ART_H,
  ART_W,
  bakeDataUrl,
  cloneDoc,
  docFromDataUrl,
  docFromImage,
  floodFill,
  generatePortrait,
  getPx,
  setPx,
  SWATCHES,
  toCss,
  type Doc,
} from "./PortraitArt";
import { L } from "./Utils";

const ACK_KEY = "terron_portrait_ack";
const STYLE_ID = "terron-portrait-editor-css";

type Tool = "pen" | "eraser" | "fill" | "pick";

const CSS = `
.pe-back{position:fixed;inset:0;z-index:10000;background:rgba(20,20,18,.72);
  display:flex;align-items:center;justify-content:center;padding:8px}
.pe-sheet{background:var(--t-sheet,#fff);color:var(--t-ink,#2b2a24);width:100%;
  max-width:460px;max-height:calc(100dvh - 16px);display:flex;flex-direction:column;
  overflow:hidden;position:relative;
  border:1px solid rgba(0,0,0,.25);box-shadow:6px 6px 0 rgba(0,0,0,.25)}
.pe-head{display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.15)}
.pe-title{font-weight:800;letter-spacing:1px;font-size:13px;text-transform:uppercase}
.pe-x{background:none;border:0;font-size:22px;line-height:1;cursor:pointer;
  padding:0 6px;color:inherit}
/* Красная плашка живёт 5с и уезжает: полоса-таймер тает СПРАВА НАЛЕВО (как
   отсчёт в лобби), потом строка схлопывается. */
.pe-warn{background:#b23b3b;color:#fff;font-size:11px;line-height:1.35;padding:6px 10px;
  font-weight:700;position:relative;overflow:hidden;flex:0 0 auto;
  transition:opacity .35s,max-height .35s,padding .35s;max-height:90px}
.pe-warn.gone{opacity:0;max-height:0;padding-top:0;padding-bottom:0}
.pe-warn-bar{position:absolute;left:0;right:0;bottom:0;height:3px;
  background:rgba(255,255,255,.7);transform-origin:left center;
  animation:pe-drain 5s linear forwards}
@keyframes pe-drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.pe-stage{flex:1 1 auto;height:min(52vh,440px);min-height:200px;overflow:hidden;
  display:flex;align-items:center;justify-content:center;background:#cfc9b4;
  touch-action:none;position:relative}
.pe-holder{position:relative;will-change:transform}
/* ⚠️ terron-theme.css гасит ЛЮБОЙ canvas вне игры (opacity:0 !important — так
   убирали фоновую карту OpenFront на главной). Наш холст надо вернуть силой. */
.pe-back .pe-cv{display:block;image-rendering:pixelated;touch-action:none;
  cursor:crosshair;opacity:1!important}
.pe-grid{position:absolute;inset:0;pointer-events:none;display:none}
.pe-grid.on{display:block}
.pe-tools{display:flex;flex-wrap:wrap;gap:4px;padding:6px;flex:0 0 auto;
  border-top:1px solid rgba(0,0,0,.12)}
.pe-b{min-width:44px;height:40px;padding:0 8px;background:var(--t-parchment,#f5efdc);
  border:1px solid rgba(0,0,0,.25);color:inherit;font-size:15px;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:4px;
  font-family:inherit;line-height:1}
.pe-b small{font-size:9px;letter-spacing:.4px;text-transform:uppercase;opacity:.7}
.pe-b.on{background:var(--t-ink,#2b2a24);color:#fff}
.pe-b:disabled{opacity:.35;cursor:default}
.pe-pal{display:grid;grid-template-columns:repeat(14,1fr);gap:3px;padding:0 6px 6px;
  flex:0 0 auto}
.pe-sw{height:22px;border:1px solid rgba(0,0,0,.28);cursor:pointer;padding:0}
.pe-sw.on{outline:3px solid var(--t-ink,#2b2a24);outline-offset:-1px}
.pe-foot{display:flex;gap:6px;padding:8px;border-top:1px solid rgba(0,0,0,.15)}
.pe-foot button{flex:1;height:44px;font-weight:800;font-size:13px;cursor:pointer;
  border:1px solid rgba(0,0,0,.3);background:var(--t-parchment,#f5efdc);color:inherit;
  font-family:inherit;text-transform:uppercase;letter-spacing:1px}
.pe-foot .ok{background:var(--t-ink,#2b2a24);color:#fff}
.pe-gate{position:absolute;inset:0;background:rgba(20,20,18,.94);color:#fff;z-index:2;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:14px;padding:24px;text-align:center}
/* ⚠️ НЕ использовать h1/h2/h3: terron-theme перекрашивает их в var(--t-ink)
   с !important → на тёмном гейте заголовок становился нечитаемым. */
.pe-gate .pe-gate-h{color:#ff6b6b;font-size:17px;font-weight:800;line-height:1.4;
  text-transform:uppercase;letter-spacing:.5px}
.pe-gate .pe-gate-p{font-size:14px;line-height:1.55;color:#fff;max-width:400px}
.pe-gate button{height:46px;padding:0 26px;font-weight:800;font-size:13px;
  border:1px solid #fff;background:none;color:#fff;cursor:pointer;font-family:inherit;
  text-transform:uppercase;letter-spacing:1px}
.pe-gate button:disabled{opacity:.4;cursor:default}
@media (max-height:560px){.pe-stage{min-height:120px}}
`;

function ensureCss(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

function btn(label: string, title: string, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "pe-b " + cls;
  b.innerHTML = label;
  b.title = title;
  b.type = "button";
  return b;
}

/**
 * Открыть редактор. Резолвится data-URL запечённого портрета (сохранять —
 * дело вызывающего) или null, если отменили.
 */
export function openPortraitEditor(opts: {
  seed: string;
  current?: string | null;
}): Promise<string | null> {
  ensureCss();
  return new Promise<string | null>((resolve) => {
    // ── состояние ───────────────────────────────────────────────────────────
    let doc: Doc = generatePortrait(opts.seed);
    let tool: Tool = "pen";
    let color = 0x20201c;
    let mirror = false;
    let grid = false;
    let zoom = 1;
    let fit = 4;
    let panX = 0;
    let panY = 0;
    const undo: Doc[] = [];
    const redo: Doc[] = [];

    // ── каркас ──────────────────────────────────────────────────────────────
    const back = document.createElement("div");
    back.className = "pe-back";
    const sheet = document.createElement("div");
    sheet.className = "pe-sheet";
    back.appendChild(sheet);

    const head = document.createElement("div");
    head.className = "pe-head";
    const title = document.createElement("div");
    title.className = "pe-title";
    title.textContent = L("Портрет персоны", "Persona portrait");
    const close = document.createElement("button");
    close.className = "pe-x";
    close.innerHTML = "&times;";
    close.title = L("Закрыть", "Close");
    head.append(title, close);

    const warn = document.createElement("div");
    warn.className = "pe-warn";
    const warnText = document.createElement("div");
    warnText.textContent = L(
      "Любая мразь на аватарке (нацистская символика, порнография, чужие лица) — БАН аккаунта без разбора. Ты предупреждён.",
      "Any filth here (nazi symbols, porn, other people's faces) = account BAN, no appeal. You have been warned.",
    );
    const warnBar = document.createElement("div");
    warnBar.className = "pe-warn-bar";
    warn.append(warnText, warnBar);
    // Плашка уезжает через 5с (полоса дотаяла) — дальше не мешает рисовать.
    // Если открыт гейт-предупреждение, отсчёт стартует ПОСЛЕ него, иначе плашка
    // истечёт за спиной гейта и её никто не прочитает.
    let warnTimer = 0;
    const startWarn = (): void => {
      warnBar.style.animationPlayState = "running";
      warnTimer = window.setTimeout(() => {
        warn.classList.add("gone");
        window.setTimeout(() => warn.remove(), 400);
      }, 5000);
    };

    const stage = document.createElement("div");
    stage.className = "pe-stage";
    const holder = document.createElement("div");
    holder.className = "pe-holder";
    const cv = document.createElement("canvas");
    cv.className = "pe-cv";
    cv.width = ART_W;
    cv.height = ART_H;
    const gridEl = document.createElement("div");
    gridEl.className = "pe-grid";
    holder.append(cv, gridEl);
    stage.appendChild(holder);

    const tools = document.createElement("div");
    tools.className = "pe-tools";
    const pal = document.createElement("div");
    pal.className = "pe-pal";
    const foot = document.createElement("div");
    foot.className = "pe-foot";

    sheet.append(head, warn, stage, tools, pal, foot);
    document.body.appendChild(back);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // ── отрисовка ───────────────────────────────────────────────────────────
    const ctx = cv.getContext("2d")!;
    const imgData = ctx.createImageData(ART_W, ART_H);
    function paint(): void {
      const o = imgData.data;
      for (let i = 0; i < ART_W * ART_H; i++) {
        const c = doc.px[i];
        const j = i * 4;
        o[j] = (c >> 16) & 255;
        o[j + 1] = (c >> 8) & 255;
        o[j + 2] = c & 255;
        o[j + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
    }

    function layout(): void {
      const w = stage.clientWidth - 12;
      const h = stage.clientHeight - 12;
      fit = Math.max(1, Math.floor(Math.min(w / ART_W, h / ART_H)));
      const s = fit * zoom;
      cv.style.width = ART_W * s + "px";
      cv.style.height = ART_H * s + "px";
      gridEl.style.backgroundImage =
        s >= 6
          ? `linear-gradient(to right,rgba(0,0,0,.18) 1px,transparent 1px),
             linear-gradient(to bottom,rgba(0,0,0,.18) 1px,transparent 1px)`
          : "none";
      gridEl.style.backgroundSize = `${s}px ${s}px`;
      holder.style.transform = `translate(${panX}px,${panY}px)`;
    }

    // ── история ─────────────────────────────────────────────────────────────
    function snapshot(): void {
      undo.push(cloneDoc(doc));
      if (undo.length > 40) undo.shift();
      redo.length = 0;
      syncButtons();
    }

    // ── рисование ───────────────────────────────────────────────────────────
    function put(x: number, y: number): void {
      const c = tool === "eraser" ? doc.bg : color;
      setPx(doc, x, y, c);
      if (mirror) setPx(doc, ART_W - 1 - x, y, c);
    }

    function line(x0: number, y0: number, x1: number, y1: number): void {
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        put(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    }

    function toPixel(e: PointerEvent): { x: number; y: number } {
      const r = cv.getBoundingClientRect();
      return {
        x: Math.floor(((e.clientX - r.left) / r.width) * ART_W),
        y: Math.floor(((e.clientY - r.top) / r.height) * ART_H),
      };
    }

    // ── ввод: 1 палец рисует, 2 — зум/пан ──────────────────────────────────
    const pointers = new Map<number, { x: number; y: number }>();
    let drawing = false;
    let last: { x: number; y: number } | null = null;
    let pinch: { dist: number; cx: number; cy: number } | null = null;

    cv.addEventListener("pointerdown", (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        drawing = false;
        last = null;
        startPinch();
        return;
      }
      cv.setPointerCapture(e.pointerId);
      const p = toPixel(e);
      if (tool === "pick") {
        setColor(getPx(doc, p.x, p.y));
        return;
      }
      snapshot();
      if (tool === "fill") {
        floodFill(doc, p.x, p.y, color);
        if (mirror) floodFill(doc, ART_W - 1 - p.x, p.y, color);
        paint();
        return;
      }
      drawing = true;
      last = p;
      put(p.x, p.y);
      paint();
    });

    function startPinch(): void {
      const [a, b] = [...pointers.values()];
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
    }

    cv.addEventListener("pointermove", (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        if (!pinch) startPinch();
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        if (pinch && pinch.dist > 8) {
          zoom = Math.max(1, Math.min(8, zoom * (dist / pinch.dist)));
          panX += cx - pinch.cx;
          panY += cy - pinch.cy;
          layout();
        }
        pinch = { dist, cx, cy };
        return;
      }
      if (!drawing || !last) return;
      const p = toPixel(e);
      if (p.x === last.x && p.y === last.y) return;
      line(last.x, last.y, p.x, p.y);
      last = p;
      paint();
    });

    const endPointer = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        drawing = false;
        last = null;
      }
    };
    cv.addEventListener("pointerup", endPointer);
    cv.addEventListener("pointercancel", endPointer);
    cv.addEventListener("pointerleave", endPointer);
    stage.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();
      zoom = Math.max(1, Math.min(8, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      layout();
    });

    // ── инструменты ─────────────────────────────────────────────────────────
    const bPen = btn("✎", L("Карандаш", "Pencil"), "on");
    const bEra = btn("▨", L("Ластик (фон)", "Eraser (background)"));
    const bFill = btn("◍", L("Заливка", "Fill"));
    const bPick = btn("◎", L("Пипетка", "Color picker"));
    const bMir = btn("⇄", L("Зеркало по вертикали", "Mirror horizontally"));
    const bGrid = btn("#", L("Сетка", "Grid"));
    const bUndo = btn("↶", L("Отменить", "Undo"));
    const bRedo = btn("↷", L("Вернуть", "Redo"));
    const bGen = btn("🎲", L("Сгенерировать заново", "Generate new"));
    const bImg = btn("🖼", L("Из картинки", "From image"));
    const bZero = btn("⟲", L("Сбросить масштаб", "Reset zoom"));
    tools.append(bPen, bEra, bFill, bPick, bMir, bGrid, bUndo, bRedo, bGen, bImg, bZero);

    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*";
    file.style.display = "none";
    sheet.appendChild(file);

    function setTool(t: Tool): void {
      tool = t;
      for (const [b, k] of [
        [bPen, "pen"],
        [bEra, "eraser"],
        [bFill, "fill"],
        [bPick, "pick"],
      ] as [HTMLButtonElement, Tool][])
        b.classList.toggle("on", k === t);
    }
    bPen.onclick = () => setTool("pen");
    bEra.onclick = () => setTool("eraser");
    bFill.onclick = () => setTool("fill");
    bPick.onclick = () => setTool("pick");
    bMir.onclick = () => {
      mirror = !mirror;
      bMir.classList.toggle("on", mirror);
    };
    bGrid.onclick = () => {
      grid = !grid;
      gridEl.classList.toggle("on", grid);
      bGrid.classList.toggle("on", grid);
    };
    bUndo.onclick = () => {
      const d = undo.pop();
      if (!d) return;
      redo.push(cloneDoc(doc));
      doc = d;
      paint();
      syncButtons();
    };
    bRedo.onclick = () => {
      const d = redo.pop();
      if (!d) return;
      undo.push(cloneDoc(doc));
      doc = d;
      paint();
      syncButtons();
    };
    bGen.onclick = () => {
      snapshot();
      doc = generatePortrait(
        opts.seed + ":" + Math.floor(Math.random() * 1e9).toString(36),
      );
      paint();
    };
    bImg.onclick = () => file.click();
    bZero.onclick = () => {
      zoom = 1;
      panX = 0;
      panY = 0;
      layout();
    };
    file.onchange = () => {
      const f = file.files?.[0];
      file.value = "";
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        const im = new Image();
        im.onload = () => {
          snapshot();
          doc = docFromImage(im, doc.bg);
          paint();
        };
        im.src = fr.result as string;
      };
      fr.readAsDataURL(f);
    };

    function syncButtons(): void {
      bUndo.disabled = undo.length === 0;
      bRedo.disabled = redo.length === 0;
    }

    // ── палитра ─────────────────────────────────────────────────────────────
    const swEls: HTMLButtonElement[] = [];
    function setColor(c: number): void {
      color = c;
      swEls.forEach((el, i) => el.classList.toggle("on", SWATCHES[i] === c));
      if (tool === "pick" || tool === "eraser") setTool("pen");
    }
    for (const c of SWATCHES) {
      const b = document.createElement("button");
      b.className = "pe-sw";
      b.type = "button";
      b.style.background = toCss(c);
      b.onclick = () => setColor(c);
      pal.appendChild(b);
      swEls.push(b);
    }
    const bBg = btn(
      "<small>" + L("фон", "bg") + "</small>",
      L("Сделать текущий цвет фоном", "Set current color as background"),
    );
    bBg.onclick = () => {
      snapshot();
      const old = doc.bg;
      for (let i = 0; i < doc.px.length; i++) if (doc.px[i] === old) doc.px[i] = color;
      doc.bg = color;
      paint();
    };
    tools.appendChild(bBg);

    // ── низ ─────────────────────────────────────────────────────────────────
    const bCancel = document.createElement("button");
    bCancel.textContent = L("Отмена", "Cancel");
    const bSave = document.createElement("button");
    bSave.className = "ok";
    bSave.textContent = L("Сохранить", "Save");
    foot.append(bCancel, bSave);

    // ── закрытие ────────────────────────────────────────────────────────────
    let done = false;
    function finish(url: string | null): void {
      if (done) return;
      done = true;
      window.clearTimeout(warnTimer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", layout);
      document.body.style.overflow = prevOverflow;
      back.remove();
      resolve(url);
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") finish(null);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        (e.shiftKey ? bRedo : bUndo).click();
      }
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", layout);
    close.onclick = () => finish(null);
    bCancel.onclick = () => finish(null);
    bSave.onclick = () => finish(bakeDataUrl(doc));
    back.addEventListener("pointerdown", (e) => {
      if (e.target === back) finish(null);
    });

    // ── гейт-предупреждение (первый раз на устройстве) ─────────────────────
    const needGate = localStorage.getItem(ACK_KEY) !== "1";
    if (needGate) warnBar.style.animationPlayState = "paused";
    else startWarn();
    if (needGate) {
      const gate = document.createElement("div");
      gate.className = "pe-gate";
      const h3 = document.createElement("div");
      h3.className = "pe-gate-h";
      h3.textContent = L(
        "ВНИМАНИЕ: аватарку видят все игроки",
        "WARNING: every player sees your avatar",
      );
      const p = document.createElement("div");
      p.className = "pe-gate-p";
      p.textContent = L(
        "Нацистская символика, порнография, оскорбления, чужие лица и прочая мразь — " +
          "мгновенный БАН аккаунта без возврата покупок. Модерация приходит после публикации: " +
          "нарисовал хуету — потерял аккаунт. Ты меня понял?",
        "Nazi symbols, porn, slurs, other people's faces and similar filth = instant account " +
          "BAN with no refunds. Moderation happens after publishing: draw filth, lose the account. " +
          "Are we clear?",
      );
      const ok = document.createElement("button");
      ok.disabled = true;
      let left = 5;
      ok.textContent = L(`Понял (${left})`, `Got it (${left})`);
      const timer = window.setInterval(() => {
        left--;
        if (left <= 0) {
          window.clearInterval(timer);
          ok.disabled = false;
          ok.textContent = L("Понял, рисую", "Got it, let me draw");
        } else {
          ok.textContent = L(`Понял (${left})`, `Got it (${left})`);
        }
      }, 1000);
      ok.onclick = () => {
        localStorage.setItem(ACK_KEY, "1");
        gate.remove();
        startWarn();
        layout();
      };
      gate.append(h3, p, ok);
      sheet.style.position = "relative";
      sheet.appendChild(gate);
    }

    // ── старт: подхватить текущий портрет, если он наш ──────────────────────
    syncButtons();
    setColor(color);
    paint();
    requestAnimationFrame(layout);
    const cur = opts.current?.trim();
    if (cur && cur.startsWith("data:image/")) {
      void docFromDataUrl(cur).then((d) => {
        if (d && !done) {
          doc = d;
          paint();
        }
      });
    }
  });
}

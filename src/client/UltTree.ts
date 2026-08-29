// terron: ДЕРЕВО УЛЬТ (TZ-ult-unlocks.md, решение владельца 21.08: «как дерево
// перков в PoE, лишь бы на телефонах удобно»). Центр — звезда (слот ульты),
// первое кольцо — БАЗОВЫЕ ульты (бесплатны всем навсегда), наружу от родителя
// растут ЗАКРЫТЫЕ (реестр LOCKED_ULTIMATES в ядре): замок, пока не открыты на
// аккаунте ачивкой ИЛИ покупкой за ПТС. Тап по узлу — поповер прямо на карте.
// Данные владения/прогресса — /me/ults (UltUnlocks.ts), аноним видит дерево с
// замками и призывом войти. Один элемент — и страница /ults, и вкладка досье.
import { html, LitElement, svg, SVGTemplateResult, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../core/AssetUrls";
import {
  isLockedUltimate,
  isSecretUltimate,
  LOCKED_ULTIMATES,
  ULTIMATE_REGISTRY,
  Ultimates,
  UnitType,
} from "../core/game/Game";
import { buyUlt, UltUnlockView } from "./Api";
import { isLoggedIn } from "./Auth";
import { refreshDisabledUlts } from "./DisabledUlts";
import { softGo } from "./SoftNavigate";
import { confirmDialog, toast } from "./Toast";
import { ultLore } from "./UltLore";
import {
  avgWinRate,
  loadUltStats,
  ULT_STATS_MIN_PICKS,
  ultDelta,
  ultStatFor,
  UltStatsData,
  UltStatRow,
} from "./UltStats";
import { refreshUltUnlocks, ultUnlocksView } from "./UltUnlocks";
import { unitMeta } from "./UnitCatalog";
import { L, translateText } from "./Utils";
import { BUILD_DESC_PARAMS } from "./WikiNumbers";

const starIcon = assetUrl("images/UltimateIconWhite.svg");
const goldIcon = assetUrl("images/GoldCoinIcon.svg");

interface Node {
  type: UnitType;
  x: number;
  y: number;
  locked: boolean; // в реестре замков (независимо от владения)
  parent: UnitType | null;
  // Кольца 0 (секрет) и 1 (первый уровень) расставлены равномерно и при
  // расклейке не двигаются; наружные цепочки — двигаются.
  fixed: boolean;
}

const R_SECRET = 72;
const R_BASE = 155;
const RING_STEP = 100;
const NODE_R = 24;

// Модель колец (решение владельца 24.08): кольцо 0 — секретные («????? на
// нулевом круге»); кольцо 1 — первый уровень, БАЗОВО ОТКРЫТЫЕ и БАЗОВО
// ЗАКРЫТЫЕ (замок с parent: null, как Топливо); дальше — ЦЕПОЧКИ: ребёнок
// растёт из родителя и требует его открыть (Топливо → Дора → Депо смерти).
//
// hiddenUlts — рубильник раскатки (TERRON_DISABLED_ULTS через /api/version):
// выключенная ульта не рисуется ВООБЩЕ, вместе со всей цепочкой потомков.
function layout(hiddenUlts?: ReadonlySet<string>): Node[] {
  const isHidden = (t: UnitType): boolean => {
    if (!hiddenUlts || hiddenUlts.size === 0) return false;
    let cur: UnitType | null = t;
    for (let hops = 0; cur !== null && hops < 10; hops++) {
      if (hiddenUlts.has(cur)) return true;
      cur = LOCKED_ULTIMATES[cur]?.parent ?? null;
    }
    return false;
  };
  const nodes: Node[] = [];
  const angleOf = new Map<UnitType, { a: number; ring: number }>();

  const secret = Ultimates.types.filter(
    (t) => isSecretUltimate(t) && !isHidden(t),
  );
  secret.forEach((t, i) => {
    const a = (i / secret.length) * Math.PI * 2 - Math.PI / 2;
    nodes.push({
      type: t,
      x: Math.cos(a) * R_SECRET,
      y: Math.sin(a) * R_SECRET,
      locked: false,
      parent: null,
      fixed: true,
    });
  });

  const ring1 = Ultimates.types.filter(
    (t) =>
      !isSecretUltimate(t) &&
      !isHidden(t) &&
      (!isLockedUltimate(t) || LOCKED_ULTIMATES[t]!.parent === null),
  );
  ring1.forEach((t, i) => {
    const a = (i / ring1.length) * Math.PI * 2 - Math.PI / 2;
    angleOf.set(t, { a, ring: 1 });
    nodes.push({
      type: t,
      x: Math.cos(a) * R_BASE,
      y: Math.sin(a) * R_BASE,
      locked: isLockedUltimate(t),
      parent: null,
      fixed: true,
    });
  });

  // Цепочки: волнами — ребёнок ставится, когда размещён родитель. Родитель
  // вне дерева (не ульта) — фолбэк-угол по очереди, чтобы не падать в точку.
  const pending = (
    Object.entries(LOCKED_ULTIMATES) as [
      UnitType,
      (typeof LOCKED_ULTIMATES)[UnitType],
    ][]
  ).filter(
    ([t, def]) =>
      def && def.parent !== null && !isSecretUltimate(t) && !isHidden(t),
  );
  let orphanIdx = 0;
  for (let wave = 0; wave < 5 && pending.length > 0; wave++) {
    const placedNow: number[] = [];
    // Веер братьев вокруг родителя — считаем братьев в этой волне.
    const siblings = new Map<UnitType, UnitType[]>();
    for (const [t, def] of pending) {
      if (def!.parent !== null && !angleOf.has(def!.parent) && wave < 4)
        continue;
      const arr = siblings.get(def!.parent!) ?? [];
      arr.push(t);
      siblings.set(def!.parent!, arr);
    }
    for (const [parent, kids] of siblings) {
      const p = angleOf.get(parent);
      const a0 = p?.a ?? -Math.PI / 2 + 0.7 * orphanIdx++;
      const ring = (p?.ring ?? 1) + 1;
      kids.forEach((t, i) => {
        const spread =
          kids.length === 1 ? 0 : (i - (kids.length - 1) / 2) * 0.32;
        const a = a0 + spread;
        const r = R_BASE + RING_STEP * (ring - 1);
        angleOf.set(t, { a, ring });
        nodes.push({
          type: t,
          x: Math.cos(a) * r,
          y: Math.sin(a) * r,
          locked: true,
          parent,
          fixed: false,
        });
        placedNow.push(pending.findIndex(([pt]) => pt === t));
      });
    }
    for (const idx of placedNow.sort((x, y) => y - x)) pending.splice(idx, 1);
  }
  // Расклейка (репорт владельца «часть ультов слиплась»): дети соседних
  // родителей на одном радиусе наезжали друг на друга. Кольца 0–1 не
  // трогаем — расталкиваем только цепочки, детерминированной релаксацией.
  const MIN_D = NODE_R * 2 + 12;
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.fixed && b.fixed) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= MIN_D) continue;
        const push = (MIN_D - Math.max(d, 0.001)) / 2;
        // Совпали точка-в-точку — направление из нуля не выведешь,
        // берём детерминированный угол от индексов.
        const ux = d > 0.001 ? dx / d : Math.cos(i * 2.399 + j);
        const uy = d > 0.001 ? dy / d : Math.sin(i * 2.399 + j);
        if (!a.fixed && !b.fixed) {
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        } else if (!b.fixed) {
          b.x += ux * push * 2;
          b.y += uy * push * 2;
        } else {
          a.x -= ux * push * 2;
          a.y -= uy * push * 2;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return nodes;
}

// Вкладки карточки узла (26.08): сама ульта / реальный прототип / цифры.
type CardTab = "ult" | "lore" | "stats";

@customElement("ult-tree")
export class UltTree extends LitElement {
  @state() private view: UltUnlockView[] | null = ultUnlocksView();
  @state() private selected: UnitType | null = null;
  // Ховер-подсказка ПРЯМО НА КАРТЕ (решение владельца 24.08): плавающая
  // карточка у узла под курсором. px/py — в пикселях контейнера, below —
  // узел у верхней кромки, подсказку рисуем ПОД ним.
  @state() private hover: {
    type: UnitType;
    px: number;
    py: number;
    below: boolean;
  } | null = null;
  // Пин-поповер по клику: полная карточка у самого узла на карте.
  // maxH — потолок по месту в карте; тексты подрезаны так, чтобы влезать
  // целиком, скролл внутри — только страховка.
  @state() private pinned: {
    type: UnitType;
    px: number;
    py: number;
    below: boolean;
    maxH: number;
  } | null = null;
  // terron 26.08: ВКЛАДКИ КАРТОЧКИ (решение владельца: «нужно добавить вкладку
  // история и вкладку статистика»). Вкладка одна на всю карточку — и на панели
  // десктопа, и в поповере на телефоне (это один и тот же renderCardBody).
  // Сбрасывается в «Ульта» при выборе другого узла: игрок пришёл смотреть
  // новую ульту, а не остаться в чужой истории.
  @state() private cardTab: CardTab = "ult";
  @state() private stats: UltStatsData | null = null;
  @state() private statsLoading = false;
  @state() private loggedIn: boolean | null = null;
  @state() private busy = false;
  // Десктоп (решение владельца 24.08): слева ПАНЕЛЬ с карточкой, справа
  // карта — узлы ничем не перекрываются, ховер/клик меняют панель. На
  // телефоне остаётся поповер на карте.
  @state() private panelMode =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(min-width: 1000px)").matches ?? false);
  private mq: MediaQueryList | null = null;
  private readonly onMq = (e: MediaQueryListEvent) => {
    this.panelMode = e.matches;
    if (this.panelMode) this.pinned = null;
  };
  // Пан/зум через viewBox (пальцем тянуть, кнопками ±).
  @state() private vb = { x: -400, y: -400, w: 800, h: 800 };
  private drag: { x: number; y: number; vx: number; vy: number } | null = null;
  // Пан закончился над узлом → click всё равно прилетает; игнорируем его.
  private dragMoved = false;
  private nodes: Node[] = layout();

  createRenderRoot() {
    return this; // light DOM — наследуем тему сайта
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.mq = window.matchMedia?.("(min-width: 1000px)") ?? null;
    this.mq?.addEventListener?.("change", this.onMq);
    void isLoggedIn()
      .then((v) => (this.loggedIn = v))
      .catch(() => (this.loggedIn = false));
    void refreshUltUnlocks().then((v) => {
      if (v) this.view = v;
    });
    // Рубильник раскатки (TERRON_DISABLED_ULTS): сервер отдаёт список в
    // /api/version — выключенные ульты на карте не рисуем вовсе. Сеть легла
    // или поле пустое (дев) → полное дерево. Кэш общий с LocalServer
    // (одиночка гейтится тем же списком).
    void refreshDisabledUlts().then((list) => {
      if (list.length === 0) return;
      this.nodes = layout(new Set(list));
      const sel = this.selected;
      if (sel !== null && !this.nodes.some((n) => n.type === sel)) {
        this.selected = this.nodes.find((n) => n.locked)?.type ?? null;
      }
      this.requestUpdate();
    });
    // По умолчанию выделяем первую закрытую — про неё тут главный разговор.
    const firstLocked = this.nodes.find((n) => n.locked);
    this.selected = firstLocked?.type ?? this.nodes[0]?.type ?? null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.mq?.removeEventListener?.("change", this.onMq);
    this.mq = null;
  }

  private info(t: UnitType): UltUnlockView | undefined {
    return this.view?.find((u) => u.id === t);
  }

  private isOwned(t: UnitType): boolean {
    if (!isLockedUltimate(t)) return true;
    return this.info(t)?.unlocked ?? false;
  }

  // Один источник «как показывать ульту»: имя/описание с маской секрета.
  // Им пользуются карточка, ховер-подсказка и список.
  private displayOf(t: UnitType): {
    secret: boolean;
    name: string;
    desc: string;
  } {
    const secret = isSecretUltimate(t);
    const key = unitMeta(t)?.key ?? "";
    const name = secret ? "????" : translateText("unit_type." + key);
    const desc = secret
      ? "????????"
      : translateText("build_menu.desc." + key, BUILD_DESC_PARAMS);
    return { secret, name, desc };
  }

  private castOf(t: UnitType) {
    return ULTIMATE_REGISTRY.find((u) => u.type === t)?.cast;
  }

  private select(t: UnitType) {
    if (this.selected !== t) this.cardTab = "ult";
    this.selected = t;
  }

  // Позиция подсказки — от указателя, в координатах контейнера страницы.
  private placeHover(t: UnitType, e: PointerEvent) {
    const r = this.getBoundingClientRect();
    const px = Math.max(150, Math.min(e.clientX - r.left, r.width - 150));
    const py = e.clientY - r.top;
    this.hover = { type: t, px, py, below: py < 170 };
  }

  // Пин по клику: карточка шире тултипа — клэмп и порог «сверху/снизу» свои.
  // Сторона — та, где БОЛЬШЕ места (текст обязан влезть целиком).
  private pin(t: UnitType, e: MouseEvent, svgRect: DOMRect) {
    const r = this.getBoundingClientRect();
    // ⚠️ Клэмп по ПОЛОВИНЕ ФАКТИЧЕСКОЙ ширины карточки, а не по зашитым 230:
    // карточка `min(440px, 90vw)`, и на телефоне она уже 440 — с константой
    // её правый край уезжал за экран (видно на 375px, вкладка «Статистика»
    // упиралась в кромку).
    const half = Math.min(440, window.innerWidth * 0.9) / 2;
    const px = Math.max(
      half + 4,
      Math.min(e.clientX - r.left, r.width - half - 4),
    );
    const py = e.clientY - r.top;
    const roomBelow = svgRect.bottom - e.clientY - 44;
    const roomAbove = e.clientY - svgRect.top - 44;
    const below = roomBelow >= roomAbove;
    const maxH = Math.max(220, Math.min(680, below ? roomBelow : roomAbove));
    if (this.pinned?.type !== t) this.cardTab = "ult";
    this.pinned = { type: t, px, py, below, maxH };
  }

  // ── пан/зум ─────────────────────────────────────────────────────────────
  private onDown(e: PointerEvent) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, vx: this.vb.x, vy: this.vb.y };
    this.dragMoved = false;
    this.hover = null; // на таче тап не даёт pointerleave — прячем сами
    // Клик по пустой карте/пан закрывает поповер; клик ПО УЗЛУ откроет его
    // заново уже в @click (он приходит после pointerdown).
    this.pinned = null;
  }
  private onMove(e: PointerEvent) {
    if (!this.drag) return;
    const svg = e.currentTarget as SVGSVGElement;
    if (
      Math.abs(e.clientX - this.drag.x) + Math.abs(e.clientY - this.drag.y) >
      4
    )
      this.dragMoved = true;
    // 1 пиксель мыши = 1 пиксель карты (репорт владельца «перестань
    // мультиплицировать мышку»). Масштаб у meet-вьюбокса задаёт КОРОТКАЯ
    // сторона — раньше делили по ширине, и на широком экране карта ехала
    // быстрее курсора.
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / this.vb.w, rect.height / this.vb.h);
    if (scale <= 0) return;
    const k = 1 / scale;
    this.vb = {
      ...this.vb,
      x: this.drag.vx - (e.clientX - this.drag.x) * k,
      y: this.drag.vy - (e.clientY - this.drag.y) * k,
    };
  }
  private onUp(e: PointerEvent) {
    const wasDrag = this.drag !== null;
    this.drag = null;
    if (!wasDrag || this.dragMoved || e.type !== "pointerup") return;
    // Клик без пана = пин-карточка у узла. ⚠️ Обычный @click на <g> тут НЕ
    // срабатывает: setPointerCapture в onDown уводит pointerup на svg, и
    // click браузер отдаёт svg (общему предку down/up), а не узлу. Поэтому
    // узел ищем руками — переводим точку клика в координаты viewBox
    // (preserveAspectRatio meet: буквы по короткой стороне) и берём ближайший.
    const svgEl = e.currentTarget as SVGSVGElement;
    const rect = svgEl.getBoundingClientRect();
    const scale = Math.min(rect.width / this.vb.w, rect.height / this.vb.h);
    if (scale <= 0) return;
    const ox = (rect.width - this.vb.w * scale) / 2;
    const oy = (rect.height - this.vb.h * scale) / 2;
    const vx = this.vb.x + (e.clientX - rect.left - ox) / scale;
    const vy = this.vb.y + (e.clientY - rect.top - oy) / scale;
    let best: Node | null = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - vx, n.y - vy);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best && bestD <= NODE_R + 6) {
      this.select(best.type);
      if (!this.panelMode) this.pin(best.type, e, rect);
      this.hover = null;
    }
  }
  private zoom(f: number) {
    const cx = this.vb.x + this.vb.w / 2;
    const cy = this.vb.y + this.vb.h / 2;
    const w = Math.max(220, Math.min(1600, this.vb.w * f));
    this.vb = { x: cx - w / 2, y: cy - w / 2, w, h: w };
  }

  // Колесо = зум К КУРСОРУ, как в гугл-картах (решение владельца 24.08:
  // «скролл вверх-вниз крутил»). Страницу под картой колесо не крутит.
  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const svgEl = e.currentTarget as SVGSVGElement;
    const rect = svgEl.getBoundingClientRect();
    const scale = Math.min(rect.width / this.vb.w, rect.height / this.vb.h);
    if (scale <= 0) return;
    const ox = (rect.width - this.vb.w * scale) / 2;
    const oy = (rect.height - this.vb.h * scale) / 2;
    const vx = this.vb.x + (e.clientX - rect.left - ox) / scale;
    const vy = this.vb.y + (e.clientY - rect.top - oy) / scale;
    const f = Math.exp(e.deltaY * 0.0016);
    const w = Math.max(220, Math.min(1600, this.vb.w * f));
    const k = w / this.vb.w;
    if (k === 1) return;
    this.hover = null;
    this.vb = {
      x: vx - (vx - this.vb.x) * k,
      y: vy - (vy - this.vb.y) * k,
      w,
      h: w,
    };
  }

  // ── покупка ─────────────────────────────────────────────────────────────
  private async buy(t: UnitType) {
    const def = LOCKED_ULTIMATES[t];
    if (!def) return;
    const name = translateText("unit_type." + (unitMeta(t)?.key ?? ""));
    const ok = await confirmDialog(
      L(
        `Открыть «${name}» за ${def.pricePts} кровавых алмазов?`,
        `Unlock "${name}" for ${def.pricePts} blood diamonds?`,
      ),
      L("Открыть", "Unlock"),
      L("Отмена", "Cancel"),
    );
    if (!ok) return;
    this.busy = true;
    const r = await buyUlt(t);
    this.busy = false;
    if (r.ok) {
      toast(L("Ульта открыта!", "Ultimate unlocked!"), "success");
      const v = await refreshUltUnlocks();
      if (v) this.view = v;
    } else {
      const msg =
        r.error === "insufficient funds"
          ? L("Не хватает алмазов", "Not enough diamonds")
          : r.error === "already owned"
            ? L("Уже открыта", "Already unlocked")
            : L("Не удалось купить", "Purchase failed");
      toast(msg, "error");
    }
  }

  // ── рендер ──────────────────────────────────────────────────────────────
  // ⚠️ Вложенные SVG-фрагменты обязаны идти через тег svg`` (не html``):
  // html-фрагмент внутри <svg> парсится в XHTML-namespace и браузер его
  // молча не рисует — так дерево месяц стояло «одна звезда без узлов».
  private renderNode(n: Node): SVGTemplateResult {
    // Секретные ульты (new-units/CUBE.md): существование дразним, но не
    // раскрываем — «?» вместо иконки, без имени и без замка.
    const secret = isSecretUltimate(n.type);
    const meta = unitMeta(n.type);
    const owned = this.isOwned(n.type);
    const sel = this.selected === n.type;
    const fill = !n.locked
      ? "var(--t-ink,#2b2a24)"
      : owned
        ? "#b8860b"
        : "#9a968c";
    const ring = sel
      ? "var(--t-red,#c0392b)"
      : owned && n.locked
        ? "#ffd166"
        : "transparent";
    return svg`<g
      transform="translate(${n.x} ${n.y})"
      style="cursor:pointer"
      @pointerenter=${(e: PointerEvent) => {
        if (this.drag) return;
        this.select(n.type);
        // В панель-режиме описание живёт в панели — тултип не нужен.
        if (!this.panelMode && this.pinned?.type !== n.type)
          this.placeHover(n.type, e);
      }}
      @pointermove=${(e: PointerEvent) => {
        if (!this.drag && !this.panelMode && this.pinned?.type !== n.type)
          this.placeHover(n.type, e);
      }}
      @pointerleave=${() => {
        this.hover = null;
      }}
    >
      <circle r=${NODE_R + 4} fill=${ring} opacity="0.9"></circle>
      <circle r=${NODE_R} fill=${fill} stroke="#fff" stroke-width="2"></circle>
      ${
        secret
          ? svg`<text
            x="0"
            y="1"
            font-size="26"
            font-weight="800"
            fill="#fff"
            text-anchor="middle"
            dominant-baseline="middle"
          >?</text>`
          : meta
            ? svg`<image
            href=${meta.icon}
            x=${-14}
            y=${-14}
            width="28"
            height="28"
            opacity=${n.locked && !owned ? 0.55 : 1}
          ></image>`
            : ""
      }
      ${
        n.locked && !owned && !secret
          ? svg`<text
            x="14"
            y="-12"
            font-size="16"
            text-anchor="middle"
            dominant-baseline="middle"
          >
            🔒
          </text>`
          : ""
      }
    </g>`;
  }

  private renderSvg(): TemplateResult {
    const { x, y, w, h } = this.vb;
    return html`<svg
      viewBox="${x} ${y} ${w} ${h}"
      style="width:100%;height:clamp(380px,calc(100dvh - 400px),1100px);display:block;margin:0 auto;touch-action:none;background:var(--t-sheet,#fff);border:1px solid rgba(0,0,0,.12);border-radius:12px;user-select:none"
      @pointerdown=${this.onDown}
      @pointermove=${this.onMove}
      @pointerup=${this.onUp}
      @pointercancel=${this.onUp}
      @wheel=${this.onWheel}
    >
      ${this.nodes.map((n) => {
        const p = n.parent ? this.nodes.find((m) => m.type === n.parent) : null;
        const px = p ? p.x : 0;
        const py = p ? p.y : 0;
        const owned = this.isOwned(n.type);
        return svg`<line
          x1=${px}
          y1=${py}
          x2=${n.x}
          y2=${n.y}
          stroke=${n.locked && !owned ? "#bbb" : "var(--t-ink,#2b2a24)"}
          stroke-width=${n.locked ? 3 : 2}
          stroke-dasharray=${n.locked && !owned ? "6 6" : "none"}
          opacity="0.6"
        ></line>`;
      })}
      <g>
        <circle r="34" fill="#c9971c" stroke="#fff" stroke-width="3"></circle>
        <image href=${starIcon} x="-18" y="-18" width="36" height="36"></image>
      </g>
      ${this.nodes.map((n) => this.renderNode(n))}
    </svg>`;
  }

  // Тело карточки поповера (решение владельца 24.08): БЕЗ табов — секции
  // «ШТАБ» и «АКТИВ» через линию, а под ними ВСЕГДА видимая разблокировка
  // (кнопка покупки — конверсионная, прятать нельзя).
  private renderCardBody(t: UnitType): TemplateResult {
    const meta = unitMeta(t);
    if (!meta) return html``;
    // Секрет: ни имени, ни описания, ни секций — только «????».
    const { secret, name, desc } = this.displayOf(t);
    const cast = secret ? undefined : this.castOf(t);
    const locked = isLockedUltimate(t) && !secret;
    const def = LOCKED_ULTIMATES[t];
    const info = this.info(t);
    const owned = this.isOwned(t);
    const pct =
      info && info.threshold > 0
        ? Math.min(100, Math.round((info.progress / info.threshold) * 100))
        : 0;
    const hr = html`<div
      style="height:1px;background:rgba(0,0,0,.12);margin:11px 0"
    ></div>`;
    return html`<div>
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:11px">
        <div
          style="width:40px;height:40px;border-radius:50%;background:var(--t-ink,#2b2a24);display:flex;align-items:center;justify-content:center;flex:0 0 auto"
        >
          ${secret
            ? html`<span style="color:#fff;font-weight:800;font-size:20px"
                >?</span
              >`
            : html`<img
                src=${meta.icon}
                alt=""
                style="width:24px;height:24px"
              />`}
        </div>
        <div style="font-weight:800;font-size:17px;min-width:0">${name}</div>
      </div>
      ${secret ? "" : this.renderCardTabs(t)}
      ${!secret && this.cardTab === "lore"
        ? this.renderLoreTab(t)
        : !secret && this.cardTab === "stats"
          ? this.renderStatsTab(t)
          : html`${secret
        ? html`<p style="font-size:14px;line-height:1.5;margin:0">${desc}</p>`
        : html`<p style="font-size:13.5px;line-height:1.5;margin:0">${desc}</p>
            ${cast
              ? (() => {
                  // Цена из скобок в начале описания — рисуем ЧИПОМ с монетой
                  // (решение владельца 24.08: «100К и иконка золота»), текст
                  // идёт без скобок.
                  const raw = translateText(
                    "build_menu.desc." + cast.key,
                    BUILD_DESC_PARAMS,
                  );
                  const m = /^\(([^)]{1,40})\)\s*/.exec(raw);
                  const costText = m?.[1] ?? null;
                  const body = m ? raw.slice(m[0].length) : raw;
                  const castIcon = unitMeta(cast.type)?.icon;
                  return html`${hr}
                    <div
                      style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap"
                    >
                      ${castIcon
                        ? html`<span
                            style="width:26px;height:26px;border-radius:50%;background:var(--t-ink,#2b2a24);display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto"
                            ><img
                              src=${castIcon}
                              alt=""
                              style="width:16px;height:16px"
                          /></span>`
                        : ""}
                      <span
                        style="font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.55"
                        >${L("Актив", "Active")} ·
                        ${translateText("unit_type." + cast.key)}</span
                      >
                      ${costText
                        ? html`<span
                            style="display:inline-flex;align-items:center;gap:4px;border:1.5px solid rgba(0,0,0,.25);border-radius:8px;padding:2px 8px;font-weight:800;font-size:11.5px;flex:0 0 auto"
                            ><img
                              src=${goldIcon}
                              alt=""
                              style="width:12px;height:12px"
                            />${costText}</span
                          >`
                        : ""}
                    </div>
                    <p style="font-size:13.5px;line-height:1.5;margin:0">
                      ${body}
                    </p>`;
                })()
              : ""}
            ${locked && def && !owned
              ? html`${hr}
                  <div style="font-size:13px">
                    <div style="margin-bottom:8px">
                      🏆
                      ${translateText(`achievements.${def.achievement}.title`)}
                      —
                      <span style="opacity:.8"
                        >${translateText(
                          `achievements.${def.achievement}.desc`,
                        )}</span
                      >
                      ${info
                        ? html`<div
                              style="margin-top:6px;height:6px;border-radius:3px;background:rgba(0,0,0,.1);overflow:hidden"
                            >
                              <div
                                style="height:100%;width:${pct}%;background:var(--t-red,#c0392b)"
                              ></div>
                            </div>
                            <div
                              style="font-size:11px;opacity:.7;margin-top:2px"
                            >
                              ${info.progress}/${info.threshold}
                            </div>`
                        : ""}
                      <div style="font-size:11px;opacity:.65;margin-top:5px">
                        ⚠️
                        ${L(
                          "Считаются только онлайн-матчи (одиночка и полигон — нет); ключи за победы и захваты — при 2+ живых игроках.",
                          "Online matches only (singleplayer and the test ground don't count); win/capture keys need 2+ live players.",
                        )}
                      </div>
                    </div>
                    <div
                      style="text-align:center;font-size:12px;opacity:.6;margin:2px 0 8px"
                    >
                      ${L("— или —", "— or —")}
                    </div>
                    ${this.loggedIn
                      ? html`<button
                          class="t-btn"
                          ?disabled=${this.busy}
                          @click=${() => this.buy(t)}
                          style="font-weight:800;padding:9px 16px;border:2px solid var(--t-ink,#2b2a24);background:var(--t-ink,#2b2a24);color:#fff;cursor:pointer;width:100%"
                        >
                          ${L(
                            `Открыть за ${def.pricePts} 💎`,
                            `Unlock for ${def.pricePts} 💎`,
                          )}
                        </button>`
                      : html`<button
                          class="t-btn"
                          @click=${() => softGo("/settings")}
                          style="font-weight:800;padding:9px 16px;border:2px solid var(--t-ink,#2b2a24);background:var(--t-ink,#2b2a24);color:#fff;cursor:pointer;width:100%"
                        >
                          ${L(
                            `Войти и открыть за ${def.pricePts} 💎`,
                            `Log in to unlock for ${def.pricePts} 💎`,
                          )}
                        </button>`}
                  </div>`
              : ""}
            ${locked && owned
              ? html`${hr}
                  <div style="font-size:13px">
                    ${info?.source === "purchase"
                      ? L("Открыта ✓ (куплена)", "Unlocked ✓ (purchased)")
                      : L("Открыта ✓ (ачивкой)", "Unlocked ✓ (achievement)")}
                  </div>`
              : ""}
            <div style="margin-top:10px;font-size:12px">
              <a
                href="/wiki/ult/${meta.key}"
                @click=${(e: Event) => {
                  if (softGo(`/wiki/ult/${meta.key}`)) e.preventDefault();
                }}
                style="color:var(--t-red,#c0392b);font-weight:700"
                >${L("Подробнее в вики →", "More in the wiki →")}</a
              >
            </div>`}`}
    </div>`;
  }

  // ── вкладки карточки (26.08) ────────────────────────────────────────────
  private setCardTab(tab: CardTab) {
    this.cardTab = tab;
    if (tab === "stats") void this.ensureStats();
  }

  /** Цифры тянем ТОЛЬКО когда на них смотрят: сеть за вкладку, которую не открыли, не платим. */
  private async ensureStats(): Promise<void> {
    if (this.stats !== null || this.statsLoading) return;
    this.statsLoading = true;
    const d = await loadUltStats("30");
    this.stats = d;
    this.statsLoading = false;
  }

  private renderCardTabs(t: UnitType): TemplateResult {
    const key = unitMeta(t)?.key ?? "";
    // Вкладку «История» рисуем только там, где история написана: пустая
    // вкладка хуже её отсутствия (у новой ульты лора появится позже).
    const tabs: [CardTab, string][] = [["ult", L("Ульта", "Ultimate")]];
    if (ultLore(key) !== null) tabs.push(["lore", L("История", "History")]);
    tabs.push(["stats", L("Статистика", "Stats")]);
    if (tabs.length < 2) return html``;
    return html`<div
      style="display:flex;gap:16px;font-size:12.5px;border-bottom:1px solid rgba(0,0,0,.12);margin:0 0 11px;padding-bottom:8px"
    >
      ${tabs.map(
        ([id, label]) =>
          html`<span
            role="button"
            tabindex="0"
            @click=${() => this.setCardTab(id)}
            style=${this.cardTab === id
              ? "font-weight:800;border-bottom:2px solid var(--t-ink,#2b2a24);padding-bottom:8px;margin-bottom:-10px;cursor:pointer"
              : "opacity:.55;cursor:pointer"}
            >${label}</span
          >`,
      )}
    </div>`;
  }

  /** Реальный исторический прототип ульты (UltLore.ts). */
  private renderLoreTab(t: UnitType): TemplateResult {
    const lore = ultLore(unitMeta(t)?.key ?? "");
    if (lore === null) return html``;
    return html`<div>
      <div
        style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;opacity:.55;margin-bottom:6px"
      >
        ${lore.about}
      </div>
      <p style="font-size:13.5px;line-height:1.6;margin:0">${lore.text}</p>
    </div>`;
  }

  private renderStatsTab(t: UnitType): TemplateResult {
    if (this.statsLoading && this.stats === null) {
      return html`<p style="font-size:13px;opacity:.6;margin:0">
        ${L("Считаю…", "Crunching…")}
      </p>`;
    }
    const d = this.stats;
    if (d === null) {
      return html`<p style="font-size:13px;opacity:.6;margin:0">
        ${L("Статистика недоступна", "Stats unavailable")}
      </p>`;
    }
    const row = ultStatFor(d, t);
    if (row === undefined || row.picks === 0) {
      return html`<p style="font-size:13px;opacity:.7;margin:0">
        ${L(
          "За последние 30 дней эту ульту не выбирал никто.",
          "Nobody picked this ultimate in the last 30 days.",
        )}
      </p>`;
    }
    return html`<div>
      ${this.renderStatNumbers(d, row)}
      <div style="font-size:11.5px;opacity:.6;line-height:1.5;margin-top:10px">
        ${L(
          `За 30 дней, только матчи против живых игроков. Средний винрейт выбравших любую ульту — ${avgWinRate(d)}%.`,
          `Last 30 days, matches against live players only. Average win rate across all picked ultimates — ${avgWinRate(d)}%.`,
        )}
      </div>
      <div style="margin-top:8px;font-size:12px">
        <a
          href="/ults/stats"
          @click=${(e: Event) => {
            if (softGo("/ults/stats")) e.preventDefault();
          }}
          style="color:var(--t-red,#c0392b);font-weight:700"
          >${L("Все ульты таблицей →", "All ultimates in a table →")}</a
        >
      </div>
    </div>`;
  }

  /** Три числа и дельта — общий блок вкладки «Статистика». */
  private renderStatNumbers(
    d: UltStatsData,
    row: UltStatRow,
  ): TemplateResult {
    const delta = ultDelta(d, row);
    const share =
      d.picksTotal > 0 ? Math.round((row.picks / d.picksTotal) * 1000) / 10 : 0;
    const cell = (v: string, label: string) => html`<div>
      <div style="font-weight:800;font-size:19px;line-height:1.2">${v}</div>
      <div style="font-size:11px;opacity:.6;margin-top:2px">${label}</div>
    </div>`;
    return html`<div>
      <div style="display:flex;gap:22px;flex-wrap:wrap">
        ${cell(`${row.winRate}%`, L("винрейт", "win rate"))}
        ${cell(String(row.picks), L("выборов", "picks"))}
        ${cell(`${share}%`, L("доля пиков", "pick share"))}
      </div>
      <div style="margin-top:9px;font-size:12.5px">
        ${delta === null
          ? html`<span style="opacity:.6"
              >${L(
                `Мало данных для сравнения (нужно от ${ULT_STATS_MIN_PICKS} выборов).`,
                `Too few picks to compare (${ULT_STATS_MIN_PICKS}+ needed).`,
              )}</span
            >`
          : html`<span
              style="font-weight:800;color:${delta >= 0
                ? "#2e7d32"
                : "var(--t-red,#c0392b)"}"
              >${delta > 0 ? "+" : ""}${delta}
              ${L("п.п.", "pp")}</span
            >
            <span style="opacity:.6"
              >${L(
                "к среднему по выбравшим ульту",
                "vs. the average picked ultimate",
              )}</span
            >`}
      </div>
    </div>`;
  }

  // Пин-поповер: та же карточка с табами, но ПРЯМО НА КАРТЕ у кликнутого
  // узла (решение владельца 24.08: «какой смысл снизу, если я не вижу»).
  // Закрывается крестиком, кликом по пустой карте или паном.
  private renderPinned(): TemplateResult {
    const p = this.pinned;
    if (!p) return html``;
    const shift = p.below
      ? "translate(-50%, 22px)"
      : "translate(-50%, calc(-100% - 22px))";
    return html`<div
      class="ult-pop"
      style="position:absolute;left:${p.px}px;top:${p.py}px;transform:${shift};z-index:7;width:min(440px,90vw);max-height:${p.maxH}px;overflow-y:auto;overscroll-behavior:contain;padding:12px 14px;border-radius:12px;background:var(--t-sheet,#fff);border:2px solid var(--t-ink,#2b2a24);box-shadow:0 14px 40px rgba(0,0,0,.3);color:var(--t-ink,#2b2a24)"
    >
      <button
        @click=${() => (this.pinned = null)}
        aria-label=${L("Закрыть", "Close")}
        style="position:sticky;top:0;float:right;width:26px;height:26px;border:none;background:transparent;font-weight:800;font-size:15px;cursor:pointer;color:var(--t-ink,#2b2a24)"
      >
        ✕
      </button>
      ${this.renderCardBody(p.type)}
    </div>`;
  }

  private renderHoverTip(): TemplateResult {
    const h = this.hover;
    if (!h) return html``;
    const d = this.displayOf(h.type);
    const shift = h.below
      ? "translate(-50%, 18px)"
      : "translate(-50%, calc(-100% - 18px))";
    return html`<div
      style="position:absolute;left:${h.px}px;top:${h.py}px;transform:${shift};pointer-events:none;z-index:6;width:max-content;max-width:300px;background:var(--t-ink,#2b2a24);color:#fff;padding:10px 12px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35)"
    >
      <div style="font-weight:800;font-size:14px">${d.name}</div>
      <div style="font-size:12px;line-height:1.45;margin-top:5px">
        ${d.desc}
      </div>
    </div>`;
  }

  render() {
    const map = html`<div style="position:relative;flex:1 1 auto;min-width:0">
      ${this.renderSvg()}
      ${this.panelMode
        ? ""
        : html`${this.renderHoverTip()} ${this.renderPinned()}`}
      <div
        style="position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:6px"
      >
        <button
          @click=${() => this.zoom(0.8)}
          style="width:34px;height:34px;border:1px solid rgba(0,0,0,.2);background:var(--t-sheet,#fff);font-weight:800;cursor:pointer"
        >
          +
        </button>
        <button
          @click=${() => this.zoom(1.25)}
          style="width:34px;height:34px;border:1px solid rgba(0,0,0,.2);background:var(--t-sheet,#fff);font-weight:800;cursor:pointer"
        >
          −
        </button>
      </div>
    </div>`;
    return html`<div>
      <div style="display:flex;gap:16px;align-items:stretch">
        ${this.panelMode
          ? html`<div
              class="ult-pop"
              style="flex:0 0 390px;height:clamp(380px,calc(100dvh - 400px),1100px);overflow-y:auto;overscroll-behavior:contain;padding:14px 16px;border-radius:12px;background:var(--t-sheet,#fff);border:2px solid var(--t-ink,#2b2a24);color:var(--t-ink,#2b2a24)"
            >
              ${this.selected !== null
                ? this.renderCardBody(this.selected)
                : html`<p style="font-size:13px;opacity:.6;margin:0">
                    ${L(
                      "Наведи или кликни узел на карте",
                      "Hover or click a node on the map",
                    )}
                  </p>`}
            </div>`
          : ""}
        ${map}
      </div>
      <div style="text-align:center;font-size:12px;opacity:.6;margin-top:6px">
        ${L(
          "Тяни дерево пальцем · тап по узлу — описание",
          "Drag to pan · tap a node for details",
        )}
      </div>
    </div>`;
  }
}

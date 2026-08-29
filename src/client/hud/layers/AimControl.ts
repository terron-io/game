import { html, LitElement, TemplateResult } from "lit";
import { actionCooldown } from "../../Cooldowns";
import { cooldownOverlay } from "../CooldownBadge";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  BuildableAttacks,
  BuildableUnit,
  CAST_UNLOCKED_BY,
  Gold,
  PlayerActions,
  Structures,
  Ultimates,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { AimLayout, UserSettings } from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import { ContextMenuEvent, MouseUpEvent, TouchEvent } from "../../InputHandler";
import { TransformHandler } from "../../TransformHandler";
import { UIState } from "../../UIState";
import { unitIcon, unitNameI18nKey } from "../../UnitCatalog";
import { L, renderNumber, translateText } from "../../Utils";
import { BuildMenu } from "./BuildMenu";
import { PlayerActionHandler } from "./PlayerActionHandler";

/**
 * terron: ПРИЦЕЛЬНОЕ УПРАВЛЕНИЕ (эксперимент; классика — дефолт).
 *
 * Зачем: на телефоне палец закрывает ровно тот тайл, по которому целишься, а
 * радиал раскрывается вокруг пальца и закрывает ещё больше. Тут цель и касание
 * разнесены — прицел стоит в центре экрана (тап переносит), карта ездит под
 * ним, кнопки живут внизу постоянными местами, под большим пальцем.
 *
 * ЧТО ПОД ПРИЦЕЛОМ, ТО И В КНОПКАХ: своя земля → постройки, чужая/ничья/вода →
 * атаки. «Можно ли» и «сколько стоит» берём ТОЛЬКО из `PlayerView.actions(tile)`
 * — тем же вызовом живёт радиал, поэтому разъехаться с ядром нечему.
 *
 * ⚠️ НАБОР КНОПОК СТАБИЛЕН, меняется только доступность. Слоты берутся из
 * каталога (`Structures`/`BuildableAttacks` минус выключенное в лобби), а не из
 * ответа ядра: иначе кнопка «Порт» на берегу есть, а в шаге от воды исчезает —
 * и рука бьёт по «Ядерке» на её месте. Это же даёт раскладку «Два фланга», где
 * стройка и атаки видны одновременно.
 *
 * Старое управление НЕ трогается: слой добавочный, гейт `UserSettings.aimLayout`.
 */

const attackIcon = assetUrl("images/TargetIconWhite.svg");
const boatIcon = assetUrl("images/BoatIconWhite.svg");

/** Сколько держать кнопку, мс (защита от промаха пальцем). */
export const HOLD_MS = 100;
export const HOLD_DANGER_MULT = 3;
/** Как часто перезапрашивать действия у воркера, если прицел не двигался. */
const ACTIONS_REFRESH_MS = 500;

/** Порядок слотов стройки. Что не перечислено — приедет следом само. */
const BUILD_ORDER: readonly UnitType[] = [
  UnitType.City,
  UnitType.Port,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
  UnitType.Factory,
  UnitType.Airport,
  // ⚠️ Нефтяной вышки тут нет НАМЕРЕННО: в ядре она в группе Ultimates (её
  // выбирают вместо другой ульты), поэтому едет в золотой слот, а не в сетку.
];

/** Порядок слотов атаки (без наземной атаки и десанта — те всегда первыми). */
const ATTACK_ORDER: readonly UnitType[] = [
  UnitType.Warship,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.SuicideDrone,
];

/** Необратимое — держать втрое дольше. */
const DANGEROUS: ReadonlySet<UnitType> = new Set([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.WaterNuke,
  UnitType.SatelliteStrike,
  UnitType.Split,
  UnitType.SuicideDrone,
]);

/** Одна кнопка панели. */
interface PadItem {
  id: string;
  label: string;
  icon: string;
  cost: Gold | null;
  enabled: boolean;
  /** ульта/каст — золотая кайма */
  gold?: boolean;
  /** необратимое — тройное удержание */
  danger?: boolean;
  /** тип юнита — по нему кнопка сама показывает откат (единая система) */
  unit?: UnitType;
  run: () => void;
}

@customElement("aim-control")
export class AimControl extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public transformHandler: TransformHandler;
  public uiState: UIState;
  public userSettings: UserSettings;
  public buildMenu: BuildMenu;

  private handler: PlayerActionHandler;
  private cursor = { x: 0, y: 0 };
  private tile: TileRef | null = null;
  private actions: PlayerActions | null = null;
  private pending = false;
  private lastReqAt = 0;
  private lastTileReq: TileRef | null = null;
  private active = false;
  /** таймеры удержания по id кнопки */
  private holds = new Map<string, ReturnType<typeof setTimeout>>();
  /** что было под прицелом на прошлом тике — по смене отменяем удержания */
  private lastKind: string | null = null;
  /** последняя сообщённая высота панели (чтобы не мерить каждый кадр) */
  private lastPadH = -1;
  /** каталог слотов считаем один раз за матч (лобби может гасить юниты) */
  private buildSlots: UnitType[] | null = null;
  private attackSlots: UnitType[] | null = null;
  /** выбранная игроком ульта и её каст — запоминаем, слот не должен мигать */
  private ultType: UnitType | null = null;
  private castType: UnitType | null = null;

  createRenderRoot() {
    this.style.position = "fixed";
    this.style.inset = "0";
    this.style.zIndex = "800";
    this.style.pointerEvents = "none";
    return this;
  }

  init() {
    this.handler = new PlayerActionHandler(this.eventBus, this.uiState);
    this.centerCursor();
    // Тап по карте переносит прицел: иначе до края экрана не дотянуться, не
    // уводя взгляд с фронта панорамированием.
    // ⚠️ На ТАЧЕ тап приходит отдельным TouchEvent (MouseUpEvent там не
    // эмитится вовсе, см. InputHandler) — а мобилка тут главный клиент.
    const moveTo = (x: number, y: number) => {
      if (!this.enabled()) return;
      this.cursor = { x, y };
      this.lastTileReq = null;
    };
    this.eventBus.on(MouseUpEvent, (e) => moveTo(e.x, e.y));
    this.eventBus.on(TouchEvent, (e) => moveTo(e.x, e.y));
    // ⚠️ При включённой настройке «левый клик открывает меню» (дефолт) клик по
    // карте НЕ даёт MouseUpEvent вовсе — только ContextMenuEvent. Без этой
    // подписки прицел на десктопе стоял бы намертво в центре.
    this.eventBus.on(ContextMenuEvent, (e) => moveTo(e.x, e.y));
    window.addEventListener("resize", this.onResize);
  }

  private onResize = () => {
    this.cursor.x = Math.min(this.cursor.x, window.innerWidth - 4);
    this.cursor.y = Math.min(this.cursor.y, window.innerHeight - 4);
  };

  private centerCursor() {
    this.cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  private layout(): AimLayout {
    return this.userSettings?.aimLayout() ?? "classic";
  }

  private enabled(): boolean {
    return this.layout() !== "classic";
  }

  tick() {
    const my = this.game?.myPlayer() ?? null;
    const on =
      this.enabled() &&
      my !== null &&
      my.isAlive() &&
      !this.game.inSpawnPhase();
    if (!on) {
      if (this.active) {
        this.active = false;
        this.actions = null;
        this.cancelHolds();
        this.releaseSpace();
        this.requestUpdate();
      }
      return;
    }
    if (!this.active) {
      this.active = true;
      this.centerCursor();
    }
    document.body.classList.add("aim-mode");

    const cell = this.transformHandler.screenToWorldCoordinates(
      this.cursor.x,
      this.cursor.y,
    );
    this.tile = this.game.isValidCoord(cell.x, cell.y)
      ? this.game.ref(cell.x, cell.y)
      : null;

    // ⚠️ Цель сменилась, пока кнопку держат (соседа съели, отбили тайл, увели
    // прицел тапом) — удержание отменяем. Иначе палец, начатый на «строить
    // город», досчитывается уже по чужой земле и уходит не туда.
    const kind = this.contextKind();
    if (this.lastKind !== null && kind !== this.lastKind) this.cancelHolds();
    this.lastKind = kind;

    const now = Date.now();
    const stale = now - this.lastReqAt > ACTIONS_REFRESH_MS;
    if (
      this.tile !== null &&
      !this.pending &&
      (this.tile !== this.lastTileReq || stale)
    ) {
      this.pending = true;
      this.lastReqAt = now;
      this.lastTileReq = this.tile;
      my!
        .actions(this.tile)
        .then((a) => {
          this.actions = a;
          // буферы радиала кормим тем же ответом — иначе он покажет стухшее
          this.buildMenu.playerBuildables = a.buildableUnits;
          this.rememberUltimates(a);
        })
        .catch(() => {})
        .finally(() => {
          this.pending = false;
        });
    }
    this.requestUpdate();
  }

  /** Ульта выбирается один раз за матч — её слот не должен мигать по контексту. */
  private rememberUltimates(a: PlayerActions) {
    for (const bu of a.buildableUnits ?? []) {
      if (Ultimates.has(bu.type) && Structures.has(bu.type)) {
        this.ultType = bu.type;
      }
      if (CAST_UNLOCKED_BY[bu.type] !== undefined) {
        this.castType = bu.type;
      }
    }
  }

  // ── что под прицелом ───────────────────────────────────────────────
  private ownerView(): PlayerView | null {
    if (this.tile === null) return null;
    const o = this.game.owner(this.tile);
    return o.isPlayer() ? (o as PlayerView) : null;
  }

  private isMyLand(): boolean {
    const my = this.game.myPlayer();
    const o = this.ownerView();
    return my !== null && o !== null && o.id() === my.id();
  }

  private contextKind(): "own" | "ally" | "foe" | "water" | "none" {
    if (this.tile === null) return "none";
    if (this.isMyLand()) return "own";
    if (!this.game.isLand(this.tile)) return "water";
    const o = this.ownerView();
    const my = this.game.myPlayer();
    if (o !== null && my !== null && o.isFriendly(my)) return "ally";
    return "foe";
  }

  private contextLabel(): { title: string; sub: string } {
    switch (this.contextKind()) {
      case "none":
        return { title: L("вне карты", "off map"), sub: "" };
      case "own":
        return {
          title: L("твоя земля", "your land"),
          sub: L("можно строить", "you can build"),
        };
      case "water":
        return { title: L("вода", "water"), sub: L("море", "sea") };
      default: {
        const o = this.ownerView();
        if (o === null) {
          return {
            title: L("пустошь", "wasteland"),
            sub: L("ничья — можно занять", "unclaimed — can be taken"),
          };
        }
        return {
          title: o.displayName(),
          sub: L("войск ", "troops ") + renderNumber(o.troops()),
        };
      }
    }
  }

  // ── каталог слотов ─────────────────────────────────────────────────
  private slots(
    order: readonly UnitType[],
    group: readonly UnitType[],
  ): UnitType[] {
    const disabled = (t: UnitType) =>
      this.game.config?.()?.isUnitDisabled?.(t as never) === true;
    const all = (group as readonly UnitType[]).filter(
      (t) =>
        !disabled(t) && !Ultimates.has(t) && CAST_UNLOCKED_BY[t] === undefined,
    );
    const known = order.filter((t) => all.includes(t));
    const rest = all.filter((t) => !known.includes(t));
    return [...known, ...rest];
  }

  private buildCatalog(): UnitType[] {
    this.buildSlots ??= this.slots(BUILD_ORDER, Structures.types);
    return this.buildSlots;
  }

  private attackCatalog(): UnitType[] {
    this.attackSlots ??= this.slots(ATTACK_ORDER, BuildableAttacks.types);
    return this.attackSlots;
  }

  private buildable(t: UnitType): BuildableUnit | undefined {
    return this.actions?.buildableUnits?.find((b) => b.type === t);
  }

  private unitItem(t: UnitType, gold = false): PadItem {
    const bu = this.buildable(t);
    const key = unitNameI18nKey(t);
    return {
      id: "u:" + t,
      label: key ? translateText(key) : String(t),
      icon: unitIcon(t) ?? "",
      cost: bu?.cost ?? null,
      enabled:
        bu !== undefined && (bu.canBuild !== false || bu.canUpgrade !== false),
      gold,
      unit: t,
      danger: DANGEROUS.has(t),
      run: () => {
        if (this.tile === null || bu === undefined) return;
        this.buildMenu.sendBuildOrUpgrade(bu, this.tile);
      },
    };
  }

  /** Постройки: обычные — в сетку, ульт-штаб — в золотой слот. */
  private buildItems(): { grid: PadItem[]; gold: PadItem[] } {
    const own = this.contextKind() === "own";
    const grid = this.buildCatalog().map((t) => {
      const item = this.unitItem(t);
      if (!own) item.enabled = false;
      return item;
    });
    const gold: PadItem[] = [];
    if (this.ultType !== null) {
      const item = this.unitItem(this.ultType, true);
      if (!own) item.enabled = false;
      gold.push(item);
    }
    return { grid, gold };
  }

  /** Атаки: наземная + десант + строимые атаки; каст ульты — в золотой слот. */
  private attackItems(): { grid: PadItem[]; gold: PadItem[] } {
    const my = this.game.myPlayer()!;
    const kind = this.contextKind();
    const foreign = kind === "foe" || kind === "water" || kind === "ally";
    const grid: PadItem[] = [
      {
        id: "attack",
        label: L("Атака", "Attack"),
        icon: attackIcon,
        cost: null,
        enabled: foreign && this.actions?.canAttack === true,
        run: () => {
          const o = this.ownerView();
          this.handler.handleAttack(my, o ? o.id() : null);
        },
      },
      {
        id: "boat",
        label: L("Десант", "Boat"),
        icon: boatIcon,
        cost: null,
        // десант высаживается на СУШУ через воду — цель по воде смысла не имеет
        enabled: kind === "foe" || kind === "ally",
        run: () => {
          if (this.tile === null) return;
          const dst = this.tile;
          this.handler
            .findBestTransportShipSpawn(my, dst)
            .then((spawn) => {
              if (spawn !== false) this.handler.handleBoatAttack(my, dst);
            })
            .catch(() => {});
        },
      },
    ];
    for (const t of this.attackCatalog()) {
      const item = this.unitItem(t);
      if (!foreign) item.enabled = false;
      grid.push(item);
    }
    const gold: PadItem[] = [];
    if (this.castType !== null) {
      const item = this.unitItem(this.castType, true);
      if (!foreign) item.enabled = false;
      gold.push(item);
    }
    return { grid, gold };
  }

  // ── удержание ──────────────────────────────────────────────────────
  private holdStart(e: PointerEvent, item: PadItem) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    if (!item.enabled) {
      el.classList.add("aimc-nope");
      setTimeout(() => el.classList.remove("aimc-nope"), 250);
      return;
    }
    const need = HOLD_MS * (item.danger ? HOLD_DANGER_MULT : 1);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* синтетические события без указателя — не беда */
    }
    const bar = el.querySelector(".aimc-fill") as HTMLElement | null;
    if (bar) {
      bar.style.transition = `transform ${need}ms linear`;
      bar.style.transform = "scaleX(1)";
    }
    this.holdEnd(item.id);
    this.holds.set(
      item.id,
      setTimeout(() => {
        this.holds.delete(item.id);
        this.resetFill(el);
        navigator.vibrate?.(18);
        item.run();
      }, need),
    );
  }

  private resetFill(el: HTMLElement) {
    const bar = el.querySelector(".aimc-fill") as HTMLElement | null;
    if (bar) {
      bar.style.transition = "none";
      bar.style.transform = "scaleX(0)";
    }
  }

  /** Снять все удержания (смена цели, выключение слоя). */
  private cancelHolds() {
    for (const t of this.holds.values()) clearTimeout(t);
    this.holds.clear();
    for (const el of this.querySelectorAll(".aimc-btn")) {
      this.resetFill(el as HTMLElement);
      el.classList.remove("aimc-armed");
    }
  }

  private holdEnd(id: string, el?: HTMLElement) {
    const t = this.holds.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      this.holds.delete(id);
    }
    if (el) this.resetFill(el);
  }

  // ── отрисовка ──────────────────────────────────────────────────────
  private renderBtn(item: PadItem, extra = ""): TemplateResult {
    return html`<button
      class="aimc-btn ${item.gold ? "aimc-gold" : ""} ${item.enabled
        ? ""
        : "aimc-off"} ${extra}"
      title=${item.label}
      data-aim-id=${item.id}
      @pointerdown=${(e: PointerEvent) => this.holdStart(e, item)}
      @pointerup=${(e: PointerEvent) =>
        this.holdEnd(item.id, e.currentTarget as HTMLElement)}
      @pointercancel=${(e: PointerEvent) =>
        this.holdEnd(item.id, e.currentTarget as HTMLElement)}
      @pointerleave=${(e: PointerEvent) =>
        this.holdEnd(item.id, e.currentTarget as HTMLElement)}
    >
      <span class="aimc-fill"></span>
      <span style="position:relative;display:inline-flex">
        <img class="aimc-ic" src=${item.icon} alt="" />
        ${item.unit === undefined
          ? null
          : cooldownOverlay(actionCooldown(this.game, item.unit))}
      </span>
      <span class="aimc-lbl">${item.label}</span>
      ${item.cost === null
        ? ""
        : html`<span class="aimc-cost">${renderNumber(item.cost)}</span>`}
    </button>`;
  }

  /** Г-панель: ряды во всю ширину, ульта золотой колонкой сбоку. */
  private renderG(set: { grid: PadItem[]; gold: PadItem[] }): TemplateResult {
    const half = Math.ceil(set.grid.length / 2);
    const rows =
      set.grid.length > 5
        ? [set.grid.slice(0, half), set.grid.slice(half)]
        : [set.grid, []];
    const cols = Math.max(rows[0].length, rows[1].length, 1);
    const legW = set.gold.length ? 62 : 0;
    return html`<div
      class="aimc-pad aimc-g"
      style="--aimc-cols:${cols};--aimc-legw:${legW}px;--aimc-rows:${rows[1]
        .length
        ? 2
        : 1}"
    >
      <div class="aimc-rows">
        <div class="aimc-row">${rows[0].map((i) => this.renderBtn(i))}</div>
        ${rows[1].length
          ? html`<div class="aimc-row">
              ${rows[1].map((i) => this.renderBtn(i))}
            </div>`
          : ""}
      </div>
      ${set.gold.length
        ? html`<div class="aimc-leg">
            ${set.gold.map((i) => this.renderBtn(i, "aimc-tall"))}
          </div>`
        : ""}
    </div>`;
  }

  /** Два фланга: стройка слева, атаки справа — всё видно всегда. */
  private renderFlanks(
    build: { grid: PadItem[]; gold: PadItem[] },
    attack: { grid: PadItem[]; gold: PadItem[] },
  ): TemplateResult {
    const left = [...build.grid, ...build.gold];
    // Правый фланг заполняется СНИЗУ ВВЕРХ (grid льёт колонками сверху вниз,
    // поэтому список переворачиваем): «Атака» обязана быть в нижнем правом
    // углу, под большим пальцем, а редкие ядерки — дальше от него.
    const right = [...attack.grid, ...attack.gold].reverse();
    return html`<div class="aimc-pad aimc-flanks">
      <div class="aimc-rows">
        <div class="aimc-row aimc-fixed" style="--aimc-cols:3">
          ${left.map((i) => this.renderBtn(i))}
        </div>
      </div>
      <div class="aimc-leg">${right.map((i) => this.renderBtn(i))}</div>
    </div>`;
  }

  /**
   * Веер: круглые кнопки дугами от нижнего угла — под радиус большого пальца.
   * Радиус подбирается так, чтобы кнопки не наезжали, а центр дуги смещён
   * внутрь экрана на полкнопки, иначе крайние срезает краем.
   */
  private renderFan(set: { grid: PadItem[]; gold: PadItem[] }): TemplateResult {
    const B = 56;
    const gap = B + 4;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const ox = W - B / 2 - 6;
    const oy = H - B / 2 - 10;
    const half = Math.ceil(set.grid.length / 2);
    const rings: PadItem[][] = [
      set.grid.slice(0, half),
      set.grid.slice(half),
      set.gold,
    ].filter((r) => r.length > 0);
    let R = B * 1.7;
    const placed: TemplateResult[] = [];
    for (const ring of rings) {
      const n = ring.length;
      let step = 0;
      if (n > 1) {
        const maxStep = (88 / (n - 1)) * (Math.PI / 180);
        R = Math.max(R, gap / (2 * Math.sin(maxStep / 2)));
        step = 2 * Math.asin(Math.min(0.95, gap / (2 * R)));
      }
      ring.forEach((item, i) => {
        const a = (136 * Math.PI) / 180 + (i - (n - 1) / 2) * step;
        const x = Math.max(
          4,
          Math.min(W - B - 4, ox + Math.cos(a) * R - B / 2),
        );
        const y = Math.max(
          4,
          Math.min(H - B - 6, oy - Math.sin(a) * R - B / 2),
        );
        placed.push(
          html`<div class="aimc-fan-cell" style="left:${x}px;top:${y}px">
            ${this.renderBtn(item, "aimc-round")}
          </div>`,
        );
      });
      R += B + 4;
    }
    return html`<div class="aimc-pad aimc-fan">${placed}</div>`;
  }

  /**
   * ⚠️ Панель садится ровно туда, где на телефоне живут ползунок войск
   * (control-panel) и лента событий. Кто-то должен уступить — уступает старый
   * HUD: большой палец достаёт до низа, а лента справочная. Поднимаем его на
   * фактическую высоту панели (меряем после отрисовки, потому что рядов бывает
   * один или два), стили — в terron-theme/ingame через класс body.aim-mode.
   */
  updated() {
    if (!this.active) return;
    // ⚠️ Меряем по САМОЙ ВЕРХНЕЙ кнопке, а не по контейнеру рядов: у веера
    // кнопки лежат абсолютно, а у «двух флангов» правая колонка выше левой
    // сетки. По контейнеру веер вообще не двигал старый HUD (поймано вживую).
    let top = Infinity;
    const btns = this.querySelectorAll(".aimc-btn");
    btns.forEach((b) => {
      top = Math.min(top, (b as HTMLElement).getBoundingClientRect().top);
    });
    const h =
      btns.length > 0 && top < Infinity
        ? Math.max(0, Math.round(window.innerHeight - top) + 10)
        : 0;
    // Только на смену: отрисовка идёт каждый тик (10/с), а лишний
    // setProperty дёргает пересчёт стилей всему документу.
    if (h === this.lastPadH) return;
    this.lastPadH = h;
    document.documentElement.style.setProperty("--aim-pad-h", h + "px");
  }

  private releaseSpace() {
    this.lastPadH = -1;
    document.body.classList.remove("aim-mode");
    document.documentElement.style.removeProperty("--aim-pad-h");
  }

  render() {
    if (!this.active) return html``;
    const layout = this.layout();
    const own = this.contextKind() === "own";
    const ctx = this.contextLabel();
    const build = this.buildItems();
    const attack = this.attackItems();
    const set = own ? build : attack;

    return html`
      ${AIM_STYLE}
      <div
        class="aimc-cross aimc-${this.contextKind()}"
        style="left:${this.cursor.x}px;top:${this.cursor.y}px"
      >
        <svg viewBox="0 0 96 96" aria-hidden="true">
          <circle class="aimc-halo" cx="48" cy="48" r="17"></circle>
          <circle class="aimc-ring" cx="48" cy="48" r="17"></circle>
          <circle class="aimc-ring" cx="48" cy="48" r="2.5"></circle>
          <path
            class="aimc-halo"
            d="M48 20V31M48 65V76M20 48H31M65 48H76"
          ></path>
          <path
            class="aimc-tick"
            d="M48 20V31M48 65V76M20 48H31M65 48H76"
          ></path>
        </svg>
      </div>
      <div
        class="aimc-ctx"
        style="left:${this.cursor.x}px;top:${this.cursor.y + 54}px"
      >
        ${ctx.title}<s>${ctx.sub}</s>
      </div>
      ${layout === "flanks"
        ? this.renderFlanks(build, attack)
        : layout === "fan"
          ? this.renderFan(set)
          : this.renderG(set)}
    `;
  }
}

/** Светлый DOM — поэтому все классы с префиксом aimc-. */
const AIM_STYLE = html`<style>
  /* Старый нижний HUD уступает место панели (см. updated()). */
  body.aim-mode control-panel,
  body.aim-mode unit-display,
  body.aim-mode events-display {
    /* ⚠️ display обязателен: custom element по умолчанию inline, а к
       НЕзамещаемым инлайновым элементам transform не применяется вовсе —
       проверено вживую на dev, сдвигалась только лента. */
    display: block;
    transform: translateY(calc(-1 * var(--aim-pad-h, 0px)));
  }
  aim-control .aimc-cross {
    position: absolute;
    width: 96px;
    height: 96px;
    margin: -48px 0 0 -48px;
  }
  aim-control .aimc-cross svg {
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  aim-control .aimc-ring {
    fill: none;
    stroke: #fff;
    stroke-opacity: 0.85;
    stroke-width: 1.5;
  }
  aim-control .aimc-tick {
    stroke: #fff;
    stroke-opacity: 0.9;
    stroke-width: 2;
  }
  aim-control .aimc-halo {
    fill: none;
    stroke: #000;
    stroke-opacity: 0.45;
    stroke-width: 4;
  }
  aim-control .aimc-own .aimc-ring,
  aim-control .aimc-own .aimc-tick {
    stroke: #7de0ab;
  }
  aim-control .aimc-foe .aimc-ring,
  aim-control .aimc-foe .aimc-tick {
    stroke: #ff8f86;
  }
  aim-control .aimc-ally .aimc-ring,
  aim-control .aimc-ally .aimc-tick {
    stroke: #67e8f9;
  }
  aim-control .aimc-water .aimc-ring,
  aim-control .aimc-water .aimc-tick {
    stroke: #8ec6f2;
  }
  aim-control .aimc-ctx {
    position: absolute;
    transform: translate(-50%, 0);
    white-space: nowrap;
    background: rgba(20, 24, 16, 0.9);
    border: 1px solid #3c4630;
    color: #ece7d5;
    padding: 3px 8px;
    font:
      500 11px/1.2 Oswald,
      sans-serif;
    text-align: center;
  }
  aim-control .aimc-ctx s {
    display: block;
    text-decoration: none;
    font: 500 10px/1.3 monospace;
    color: #9aa088;
  }
  aim-control .aimc-pad {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  aim-control .aimc-rows,
  aim-control .aimc-leg {
    position: absolute;
    display: flex;
    gap: 6px;
    bottom: calc(6px + env(safe-area-inset-bottom));
  }
  aim-control .aimc-rows {
    flex-direction: column;
    left: 6px;
  }
  aim-control .aimc-g .aimc-rows {
    right: calc(6px + var(--aimc-legw, 0px));
  }
  aim-control .aimc-leg {
    right: 6px;
  }
  /* На широком экране сетка упирается в потолок ширины, и нога, прижатая к
     правому краю, оказывалась в другом конце экрана. Ставим её сразу за
     сеткой; на телефоне min() возвращает прежний правый край. */
  aim-control .aimc-g .aimc-leg {
    left: min(calc(12px + var(--aimc-cols, 4) * 92px), calc(100% - 62px));
    right: auto;
    flex-direction: column-reverse;
    align-items: stretch;
  }
  aim-control .aimc-row {
    display: grid;
    grid-template-columns: repeat(var(--aimc-cols, 4), 1fr);
    gap: 6px;
    grid-auto-rows: 56px;
    /* На телефоне ячейки тянутся во всю ширину (так легче попадать), а на
       широком экране растягиваться некуда — упираем в разумный потолок, иначе
       кнопка «Город» становится в пол-экрана. */
    max-width: calc(var(--aimc-cols, 4) * 92px);
  }
  /* фланги: ячейки своей ширины (не тянутся на весь экран) и сетка в 3 колонки */
  aim-control .aimc-row.aimc-fixed {
    grid-template-columns: repeat(var(--aimc-cols, 3), 56px);
    grid-auto-rows: 56px;
  }
  /* правый фланг: максимум 4 кнопки в столбец, дальше — второй столбец левее.
     Одной колонкой из 7 кнопок он накрывал ленту событий (проверено вживую). */
  aim-control .aimc-flanks .aimc-leg {
    display: grid;
    grid-template-rows: repeat(4, 56px);
    grid-auto-flow: column;
    gap: 6px;
  }
  aim-control .aimc-btn {
    position: relative;
    height: 56px;
    min-width: 0;
    background: rgba(20, 24, 16, 0.9);
    border: 1px solid #3c4630;
    color: #ece7d5;
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    pointer-events: auto;
    cursor: pointer;
    touch-action: none;
  }
  aim-control .aimc-leg .aimc-btn {
    width: 56px;
  }
  aim-control .aimc-btn.aimc-tall {
    height: calc(var(--aimc-rows, 1) * 56px + (var(--aimc-rows, 1) - 1) * 6px);
  }
  aim-control .aimc-fan-cell {
    position: absolute;
    width: 56px;
    height: 56px;
  }
  aim-control .aimc-btn.aimc-round {
    width: 56px;
    border-radius: 50%;
  }
  aim-control .aimc-btn.aimc-round .aimc-cost {
    position: static;
    font-size: 8px;
    line-height: 1;
  }
  aim-control .aimc-btn.aimc-round .aimc-ic {
    width: 21px;
    height: 21px;
  }
  aim-control .aimc-ic {
    width: 26px;
    height: 26px;
  }
  aim-control .aimc-lbl {
    font:
      500 8px/1 Oswald,
      sans-serif;
    color: #9aa088;
    max-width: 94%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  aim-control .aimc-cost {
    position: absolute;
    right: 2px;
    bottom: 1px;
    font: 500 8px/1 monospace;
    color: #d9a441;
  }
  aim-control .aimc-gold {
    border-color: #d9a441;
    border-width: 2px;
  }
  aim-control .aimc-off {
    opacity: 0.34;
    filter: saturate(0.3);
  }
  aim-control .aimc-fill {
    position: absolute;
    inset: 0;
    background: rgba(217, 164, 65, 0.35);
    transform: scaleX(0);
    transform-origin: left center;
    pointer-events: none;
  }
  aim-control .aimc-nope {
    animation: aimcShake 0.25s;
  }
  @keyframes aimcShake {
    25% {
      transform: translateX(-3px);
    }
    75% {
      transform: translateX(3px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    aim-control .aimc-nope {
      animation: none;
    }
  }
</style>`;

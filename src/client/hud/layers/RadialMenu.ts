import * as d3 from "d3";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { Controller } from "../../Controller";
import { CloseViewEvent } from "../../InputHandler";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { getSvgAspectRatio, translateText } from "../../Utils";
import { UnitType } from "../../../core/game/Game";
import { inlineIconHref } from "./inlineRadialIcon";
import {
  CenterButtonElement,
  MenuElement,
  MenuElementParams,
  TooltipKey,
} from "./RadialMenuElements";
import { tutBuildActive, tutHighlighted } from "../tutHighlight";
const backIcon = assetUrl("images/BackIconWhite.svg");

function resolveColor(
  item: MenuElement,
  params: MenuElementParams | null,
): string | undefined {
  if (typeof item.color === "function") {
    return params ? item.color(params) : undefined;
  }
  return item.color;
}

export class CloseRadialMenuEvent implements GameEvent {
  constructor() {}
}

export interface TooltipItem {
  text: string;
  className: string;
}

export interface RadialMenuConfig {
  menuSize?: number;
  submenuScale?: number;
  centerButtonSize?: number;
  iconSize?: number;
  centerIconSize?: number;
  disabledColor?: string;
  menuTransitionDuration?: number;
  mainMenuInnerRadius?: number;
  centerButtonIcon?: string;
  maxNestedLevels?: number;
  innerRadiusIncrement?: number;
  tooltipStyle?: string;
}

type CenterButtonState = "default" | "back";

type RequiredRadialMenuConfig = Required<RadialMenuConfig>;

// terron iOS/Android: тач генерирует синтетический `click` ~300мс после тача —
// он прилетает на свежеоткрытый центр радиала и мгновенно подтверждает действие
// («тап = атака без меню»). Ловим момент ЛЮБОГО тача глобально; в click-хендлерах
// глушим клик, прилетевший вскоре после тача (= синтетический). Реальный тап
// подтверждения идёт мгновенно через touchstart-хендлеры — без задержек.
let lastTouchAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener(
    "touchstart",
    () => {
      lastTouchAt = Date.now();
    },
    { capture: true, passive: true },
  );
  // ⚠️ И от ОТПУСКАНИЯ тоже: синтетический click приходит после touchend, а
  // палец на секторе легко держат дольше окна — тогда «синтетика» переставала
  // считаться синтетикой и активировала пункт (репорт владельца 23.08).
  window.addEventListener(
    "touchend",
    () => {
      lastTouchAt = Date.now();
    },
    { capture: true, passive: true },
  );
}
function isSynthClickAfterTouch(): boolean {
  return Date.now() - lastTouchAt < 700;
}

export class RadialMenu implements Controller {
  private static readonly TOOLTIP_STYLE_ID = "radial-tooltip-style";
  private menuElement: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  private tooltipElement: HTMLDivElement | null = null;
  private isVisible: boolean = false;

  private currentLevel: number = 0; // Current menu level (0 = main menu, 1 = submenu, etc.)
  private menuStack: MenuElement[][] = []; // Stack to track menu navigation history
  private currentMenuItems: MenuElement[] = []; // Current active menu items (changes based on level)

  private readonly config: RequiredRadialMenuConfig;
  private readonly backIconSize: number;

  private centerButtonState: CenterButtonState = "default";

  private isTransitioning: boolean = false;
  private lastHideTime: number = 0;
  private reopenCooldownMs: number = 300;

  private anchorX = 0;
  private anchorY = 0;

  private menuGroups: Map<
    number,
    d3.Selection<SVGGElement, unknown, null, undefined>
  > = new Map();
  private menuPaths: Map<
    string,
    d3.Selection<SVGPathElement, unknown, null, undefined>
  > = new Map();
  private menuIcons: Map<
    string,
    d3.Selection<SVGImageElement, unknown, null, undefined>
  > = new Map();

  private selectedItemId: string | null = null;
  private submenuHoverTimeout: number | null = null;
  private backButtonHoverTimeout: number | null = null;
  private navigationInProgress: boolean = false;
  private originalCenterButtonIcon: string = "";
  private readonly defaultCenterButtonColor = "#0f2744";
  private centerButtonColor: string;
  private centerButtonIconSize: number;

  private params: MenuElementParams | null = null;

  // terron: удержание для активации (ульты). Тап=описание, лонг-тап=выбрать.
  /**
   * Удержание НА ТАЧЕ: длинное намеренно — палец закрывает сектор, а случайная
   * постройка ульты стоит матча.
   */
  private static readonly HOLD_MS = 1200;
  /**
   * terron 23.08 (просьба владельца «для десктопа 0.2 сек вместо 1.2»):
   * МЫШЬЮ держать секунду незачем — курсор виден, промахнуться нечем.
   * Клик по-прежнему работает мгновенно; это порог для «зажал и держу».
   */
  private static readonly HOLD_MS_MOUSE = 200;
  /** Каким вводом идёт текущее удержание (от него зависит порог). */
  private holdIsMouse = false;
  /**
   * ⚠️ СЛЕДУЮЩИЙ `click` ГАСИМ. Ставится в двух случаях:
   *
   *  • удержание мышью сработало — иначе один жест «зажал и отпустил»
   *    активировал бы пункт ДВАЖДЫ (по заполнению сектора и потом кликом);
   *  • нажатие оказалось ТАПОМ (короткое) — а тап обязан быть безопасным.
   *
   * Второе и было багом с телефона (репорт владельца: «если 7 доступна, то
   * ставится то, что было в 7»). Синтетический click после тача глушился
   * окном 700 мс ОТ touchstart — а игрок держит палец на секторе дольше,
   * разглядывая описание. Окно истекало, click доезжал и строил пункт.
   */
  private suppressNextClick = false;
  private pressStartTime: number | null = null;
  private holdState: {
    d: d3.PieArcDatum<MenuElement>;
    pathId: string;
    raf: number;
    start: number;
    rect: d3.Selection<SVGRectElement, unknown, null, undefined>;
    overlay: d3.Selection<SVGPathElement, unknown, null, undefined>;
  } | null = null;
  // terron: заголовок над под-радиалом («Выбери свою ульту»).
  private subMenuTitleElement: HTMLDivElement | null = null;
  private pendingSubMenuTitle: string | null = null;
  // terron: угловая кнопка под-радиала (ресет ультов за ЛТС). Видна пока открыт
  // под-радиал с cornerAction; тап → onTap → перерисовка текущего уровня.
  private cornerButtonElement: HTMLDivElement | null = null;
  private pendingCornerAction: MenuElement["cornerAction"] | null = null;
  private currentSubMenuParent: MenuElement | null = null;
  private cornerBusy = false;

  constructor(
    private eventBus: EventBus,
    private rootMenu: MenuElement,
    private centerButtonElement: CenterButtonElement,
    config: RadialMenuConfig = {},
  ) {
    this.config = {
      menuSize: config.menuSize ?? 190,
      submenuScale: config.submenuScale ?? 1.5,
      centerButtonSize: config.centerButtonSize ?? 30,
      iconSize: config.iconSize ?? 32,
      centerIconSize: config.centerIconSize ?? 48,
      disabledColor: config.disabledColor ?? d3.rgb(128, 128, 128).toString(),
      menuTransitionDuration: config.menuTransitionDuration ?? 300,
      mainMenuInnerRadius: config.mainMenuInnerRadius ?? 40,
      centerButtonIcon: config.centerButtonIcon ?? "",
      maxNestedLevels: config.maxNestedLevels ?? 3,
      innerRadiusIncrement: config.innerRadiusIncrement ?? 20,
      tooltipStyle: config.tooltipStyle ?? "",
    };
    this.originalCenterButtonIcon = this.config.centerButtonIcon;
    this.backIconSize = this.config.centerIconSize * 0.8;
    this.centerButtonColor = this.defaultCenterButtonColor;
    this.centerButtonIconSize = this.config.centerIconSize;
  }

  init() {
    this.createMenuElement();
    this.createTooltipElement();
    this.eventBus.on(CloseViewEvent, (e) => {
      this.hideRadialMenu();
    });
  }

  /**
   * terron ПЕРФ/УТЕЧКА (08.08): убрать свои узлы из DOM.
   * `init()` зовётся на КАЖДЫЙ матч (HUD-слои живут всю сессию и не
   * пересоздаются), поэтому без этого в `body` оседал полноэкранный
   * fixed-контейнер меню и div подсказки — по паре на матч, вместе с
   * навешанными на них обработчиками d3, которые держали сам слой живым.
   * Общий `<style>` НЕ трогаем: он один на страницу (гардится по id) и
   * переживает матчи намеренно.
   */
  dispose(): void {
    try {
      this.hideRadialMenu(); // сначала спрятать: удалять открытое меню нельзя
    } catch {
      /* меню могло быть и не открыто — не мешает удалению */
    }
    this.menuElement?.remove();
    this.tooltipElement?.remove();
  }

  private createMenuElement() {
    RadialMenu.ensureTutPulseStyle();
    // Create an overlay to catch clicks outside the menu
    this.menuElement = d3
      .select(document.body)
      .append("div")
      .attr("class", "radial-menu-container")
      .style("position", "fixed")
      .style("display", "none")
      .style("z-index", "9999")
      .style("touch-action", "none")
      .style("top", "0")
      .style("left", "0")
      .style("width", "100vw")
      .style("height", "100vh")
      .on("click", () => {
        this.hideRadialMenu();
        this.eventBus.emit(new CloseRadialMenuEvent());
      })
      .on("contextmenu", (e) => {
        e.preventDefault();
        this.hideRadialMenu();
        this.eventBus.emit(new CloseRadialMenuEvent());
      });

    // Calculate the total svg size needed for all potential nested menus
    const totalSize =
      this.config.menuSize *
      Math.pow(this.config.submenuScale, this.config.maxNestedLevels - 1);

    const svg = this.menuElement
      .append("svg")
      .attr("width", totalSize)
      .attr("height", totalSize)
      .style("position", "absolute")
      .style("top", "50%")
      .style("left", "50%")
      .style("transform", "translate(-50%, -50%)")
      .style("pointer-events", "all")
      .on("click", (event) => this.hideRadialMenu());

    const container = svg
      .append("g")
      .attr("class", "menu-container")
      .attr("transform", `translate(${totalSize / 2},${totalSize / 2})`);

    // Add glow filter for hover effects
    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "glow");
    filter
      .append("feGaussianBlur")
      .attr("stdDeviation", "2")
      .attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    const centerButton = container.append("g").attr("class", "center-button");

    centerButton
      .append("circle")
      .attr("class", "center-button-hitbox")
      .attr("r", this.config.centerButtonSize)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("click", (event) => {
        event.stopPropagation();
        if (isSynthClickAfterTouch()) return; // синтетический click после тача
        this.handleCenterButtonClick();
      })
      .on("touchstart", (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handleCenterButtonClick();
      })
      .on("mouseover", () => this.onCenterButtonHover(true))
      .on("mouseout", () => this.onCenterButtonHover(false));

    centerButton
      .append("circle")
      .attr("class", "center-button-visible")
      .attr("r", this.config.centerButtonSize)
      .attr("fill", this.centerButtonColor)
      .style("pointer-events", "none");

    centerButton
      .append("image")
      .attr("class", "center-button-icon")
      .attr("xlink:href", inlineIconHref(this.config.centerButtonIcon))
      .attr("width", this.centerButtonIconSize)
      .attr("height", this.centerButtonIconSize)
      .attr("x", -this.centerButtonIconSize / 2)
      .attr("y", -this.centerButtonIconSize / 2)
      .style("pointer-events", "none");
  }

  private createTooltipElement() {
    this.tooltipElement = document.createElement("div");
    this.tooltipElement.className = "radial-tooltip";
    this.tooltipElement.style.position = "absolute";
    this.tooltipElement.style.pointerEvents = "none";
    // terron: описание ульты не должно читаться как «вас атакуют» — золотой акцент
    // слева + мягкий фон, чтобы это было явно «инфо», а не тревога.
    this.tooltipElement.style.background = "rgba(24, 34, 52, 0.94)";
    this.tooltipElement.style.color = "#f4f0e4";
    this.tooltipElement.style.borderLeft = "4px solid #e6c74a";
    this.tooltipElement.style.padding = "7px 11px";
    this.tooltipElement.style.borderRadius = "8px";
    this.tooltipElement.style.fontSize = "12px";
    this.tooltipElement.style.zIndex = "10000";
    this.tooltipElement.style.maxWidth = "250px";
    this.tooltipElement.style.display = "none";
    document.body.appendChild(this.tooltipElement);

    // terron ПЕРФ/УТЕЧКА (08.08): у стиля есть id — init() зовётся на КАЖДЫЙ
    // матч, и без него в <head> копились дубликаты. Стиль общий и статичный,
    // поэтому хватает одного на страницу (тот же приём, что в
    // ensureTutPulseStyle).
    const existing = document.getElementById(RadialMenu.TOOLTIP_STYLE_ID);
    if (existing !== null) return;
    const style = document.createElement("style");
    style.id = RadialMenu.TOOLTIP_STYLE_ID;
    style.textContent = `
      .radial-tooltip .title {
        font-weight: bold;
        font-size: 14px;
        margin-bottom: 4px;
        color: #e6c74a;
      }

      ${this.config.tooltipStyle}
    `;
    document.head.appendChild(style);
  }

  private getInnerRadiusForLevel(level: number): number {
    return level === 0 ? 40 : 50 + 25;
  }

  private getOuterRadiusForLevel(level: number): number {
    const innerRadius = this.getInnerRadiusForLevel(level);
    let arcWidth = 55;
    if (level !== 0) {
      arcWidth = 65;
    }
    return innerRadius + arcWidth;
  }

  private renderMenuItems(items: MenuElement[], level: number) {
    const container = this.menuElement.select(".menu-container");
    container.selectAll(`.menu-level-${level}`).remove();

    const menuGroup = container
      .append("g")
      .attr("class", `menu-level-${level}`);

    // Set initial animation styles only for submenus (level > 0)
    if (level === 0) {
      // Main menu appears immediately without animation
      menuGroup.style("opacity", 1).style("transform", "scale(1)");
    } else {
      // Submenus get the expansion animation
      menuGroup.style("opacity", 0).style("transform", "scale(0.5)");
    }

    this.menuGroups.set(level, menuGroup as any);

    const offset = -Math.PI / items.length;

    const pie = d3
      .pie<MenuElement>()
      .value(() => 1)
      .padAngle(0.03)
      .startAngle(offset)
      .endAngle(2 * Math.PI + offset);

    const innerRadius = this.getInnerRadiusForLevel(level);
    const outerRadius = this.getOuterRadiusForLevel(level);

    const arc = d3
      .arc<d3.PieArcDatum<MenuElement>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius);

    const arcs = menuGroup
      .selectAll(".menu-item")
      .data(pie(items))
      .enter()
      .append("g")
      .attr("class", "menu-item-group");

    this.renderPaths(arcs, arc, level);
    this.setupEventHandlers(arcs, level);
    this.renderIconsAndText(arcs, arc);
    this.setupAnimations(menuGroup);

    return menuGroup;
  }

  // terron (обучение): мигать нужным пунктом. Когда идёт шаг постройки (body.tut-*),
  // мигаем слотом «Стройка» на верхнем уровне и целевой постройкой (город/порт/…)
  // в подменю. Источник истины — те же body-классы, что и у кнопок снизу (tutHighlight).
  private shouldTutPulse(item: MenuElement): boolean {
    // шаг высадки: мигаем слотом «Корабль» на верхнем уровне радиала
    if (item.id === "boat" && document.body.classList.contains("tut-ship")) {
      return true;
    }
    if (!tutBuildActive()) return false;
    if (item.id === "build") return true; // верхний уровень → открой стройку
    if (item.id.startsWith("build_")) {
      return tutHighlighted(item.id.slice("build_".length) as UnitType);
    }
    return false;
  }

  private static ensureTutPulseStyle() {
    if (document.getElementById("radial-tut-pulse-style")) return;
    const s = document.createElement("style");
    s.id = "radial-tut-pulse-style";
    // stroke/filter через CSS перекрывают presentation-атрибут stroke="none" —
    // получаем мигающий яркий контур + свечение на нужном секторе радиала.
    s.textContent =
      ".radial-tut-pulse{animation:radialTutPulse .85s ease-in-out infinite;}" +
      "@keyframes radialTutPulse{" +
      "0%,100%{stroke:rgba(255,240,150,0);stroke-width:0;" +
      "filter:drop-shadow(0 0 0 rgba(255,220,90,0));}" +
      "50%{stroke:rgba(255,240,150,.95);stroke-width:3px;" +
      "filter:drop-shadow(0 0 7px rgba(255,220,90,.9));}}";
    document.head.appendChild(s);
  }

  private renderPaths(
    arcs: d3.Selection<
      SVGGElement,
      d3.PieArcDatum<MenuElement>,
      SVGGElement,
      unknown
    >,
    arc: d3.Arc<any, d3.PieArcDatum<MenuElement>>,
    level: number,
  ) {
    arcs
      .append("path")
      .attr("class", (d) =>
        this.shouldTutPulse(d.data)
          ? "menu-item-path radial-tut-pulse"
          : "menu-item-path",
      )
      .attr("d", arc)
      .attr("fill", (d) => {
        const disabled = this.params === null || d.data.disabled(this.params);
        const color = disabled
          ? this.config.disabledColor
          : (resolveColor(d.data, this.params) ?? "#1e3a5f");
        const opacity = disabled ? 0.4 : 0.82;

        if (d.data.id === this.selectedItemId && this.currentLevel > level) {
          return color;
        }

        return d3.color(color)?.copy({ opacity: opacity })?.toString() ?? color;
      })
      .attr("stroke", "none")
      .style("cursor", (d) =>
        this.params === null || d.data.disabled(this.params)
          ? "not-allowed"
          : "pointer",
      )
      .style("opacity", (d) =>
        this.params === null || d.data.disabled(this.params) ? 0.5 : 1,
      )
      .style(
        "transition",
        `filter ${this.config.menuTransitionDuration / 2}ms, fill ${this.config.menuTransitionDuration / 2}ms`,
      )
      .attr("data-id", (d) => d.data.id);

    // Timer gradient for items with timerFraction
    arcs.each((d) => {
      if (d.data.timerFraction && this.params) {
        const fraction = d.data.timerFraction(this.params);
        const disabled = this.params === null || d.data.disabled(this.params);
        const baseColor = disabled
          ? this.config.disabledColor
          : (resolveColor(d.data, this.params) ?? "#1e3a5f");
        const opacity = disabled ? 0.4 : 0.82;

        const normalColor =
          d3.color(baseColor)?.copy({ opacity: opacity })?.toString() ??
          baseColor;
        const interpolated = d3.color(
          d3.interpolateRgb(baseColor, "white")(0.4),
        );
        const fadedColor =
          interpolated?.copy({ opacity })?.toString() ?? normalColor;

        const gradientId = `timer-gradient-${d.data.id}`;
        const defs = this.menuElement.select("defs");
        defs.select(`#${gradientId}`).remove();

        const offset = 1 - fraction;
        const gradient = defs
          .append("linearGradient")
          .attr("id", gradientId)
          .attr("x1", 0)
          .attr("y1", 0)
          .attr("x2", 0)
          .attr("y2", 1);

        gradient
          .append("stop")
          .attr("class", "timer-stop-faded")
          .attr("offset", offset)
          .attr("stop-color", fadedColor);

        gradient
          .append("stop")
          .attr("class", "timer-stop-normal")
          .attr("offset", offset)
          .attr("stop-color", normalColor);

        const path = d3.select(`path[data-id="${d.data.id}"]`);
        path.attr("fill", `url(#${gradientId})`);
      }
    });

    arcs.each((d) => {
      const pathId = d.data.id;
      const path = d3.select(`path[data-id="${pathId}"]`);
      this.menuPaths.set(pathId, path as any);

      if (
        pathId === this.selectedItemId &&
        level === 0 &&
        this.currentLevel > 0
      ) {
        path.attr("filter", "url(#glow)");

        const color =
          this.params === null || d.data.disabled(this.params)
            ? this.config.disabledColor
            : (resolveColor(d.data, this.params) ?? "#1e3a5f");
        path.attr("fill", color);
      }
    });

    // Disable pointer events on previous menu levels
    this.menuGroups.forEach((group, menuLevel) => {
      if (menuLevel < this.currentLevel) {
        group.selectAll("path").each(function () {
          const pathElement = d3.select(this);
          pathElement.style("pointer-events", "none");
        });
      } else if (menuLevel === this.currentLevel) {
        group.selectAll("path").style("pointer-events", "auto");
      }
    });
  }

  private setupEventHandlers(
    arcs: d3.Selection<
      SVGGElement,
      d3.PieArcDatum<MenuElement>,
      SVGGElement,
      unknown
    >,
    level: number,
  ) {
    const onHover = (d: d3.PieArcDatum<MenuElement>, path: any) => {
      const disabled = this.params === null || d.data.disabled(this.params);
      if (d.data.tooltipItems && d.data.tooltipItems.length > 0) {
        this.showTooltip(d.data.tooltipItems);
      } else if (d.data.tooltipKeys && d.data.tooltipKeys.length > 0) {
        this.showTooltip(d.data.tooltipKeys);
      }
      if (
        disabled ||
        (this.currentLevel > 0 && this.currentLevel !== level) ||
        this.navigationInProgress
      ) {
        return;
      }

      path.style("filter", "brightness(1.5)");
    };

    const onMouseOut = (d: d3.PieArcDatum<MenuElement>, path: any) => {
      const disabled = this.params === null || d.data.disabled(this.params);
      if (this.submenuHoverTimeout !== null) {
        window.clearTimeout(this.submenuHoverTimeout);
        this.submenuHoverTimeout = null;
      }

      this.hideTooltip();

      if (
        disabled ||
        (this.currentLevel > 0 &&
          level === 0 &&
          d.data.id === this.selectedItemId)
      )
        return;
      path.style("filter", null);
      const color = disabled
        ? this.config.disabledColor
        : (resolveColor(d.data, this.params) ?? "#333333");
      const opacity = disabled ? 0.4 : 0.82;

      if (d.data.timerFraction) {
        path.attr("fill", `url(#timer-gradient-${d.data.id})`);
      } else {
        path.attr(
          "fill",
          d3.color(color)?.copy({ opacity: opacity })?.toString() ?? color,
        );
      }
    };

    const onClick = (d: d3.PieArcDatum<MenuElement>, event: Event) => {
      event.stopPropagation();
      // Глушим синтетический click после тача (touchstart идёт отдельно, мгновенно).
      if (event.type === "click" && isSynthClickAfterTouch()) return;
      // ...и click, который прилетает следом за успешным удержанием мышью.
      if (event.type === "click" && this.suppressNextClick) {
        this.suppressNextClick = false;
        return;
      }
      if (
        this.params === null ||
        d.data.disabled(this.params) ||
        this.navigationInProgress
      )
        return;
      // ⚠️ terron 23.08 (просьба владельца «при введении кода… точно
      // перезаписывать установку текущего»): КЛИК МЫШЬЮ тоже вводит цифру, и
      // если код сошёлся именно им — пункт НЕ активируем. Иначе тем же кликом
      // встанет обычная ульта слота, а выбор ульты на матч всего один.
      if (event.type === "click" && d.data.onTap?.(this.params) === true) {
        return;
      }
      this.eventBus.emit(new PlaySoundEffectEvent("click"));

      if (
        this.currentLevel > 0 &&
        level === 0 &&
        d.data.id !== this.selectedItemId
      )
        return;

      const subMenu = d.data.subMenu?.(this.params);
      if (subMenu && subMenu.length > 0) {
        this.navigationInProgress = true;
        this.selectedItemId = d.data.id;
        this.pendingSubMenuTitle = d.data.subMenuTitle ?? null; // terron
        this.pendingCornerAction = d.data.cornerAction ?? null; // terron
        this.currentSubMenuParent = d.data; // terron
        this.navigateToSubMenu(subMenu);
        this.updateCenterButtonState("back");
      } else {
        d.data.action?.(this.params);
        // Force transition state to false to ensure menu hides
        this.isTransitioning = false;
        this.hideRadialMenu();
      }
    };

    function handleMouseMove(event: MouseEvent) {
      const tooltipEl = document.querySelector(
        ".radial-tooltip",
      ) as HTMLElement;
      if (tooltipEl && tooltipEl.style.display !== "none") {
        tooltipEl.style.left = event.pageX + 10 + "px";
        tooltipEl.style.top = event.pageY + 10 + "px";
      }
    }

    arcs.each((d) => {
      const pathId = d.data.id;
      const path = d3.select(`path[data-id="${pathId}"]`);

      path.on("mouseover", function () {
        onHover(d, path);
      });

      path.on("mouseout", function () {
        onMouseOut(d, path);
      });

      path.on("mousemove", function (event) {
        handleMouseMove(event as MouseEvent);
      });

      if (d.data.holdToActivate) {
        // terron: ДЕСКТОП — ховер=описание (onHover), КЛИК=активация (onClick).
        // МОБИЛА — тап=описание (onHoldUp), ЛОНГ-ТАП (заливка)=выбрать.
        const begin = (event: Event) => {
          event.preventDefault(); // гасит синтетический click после тача
          event.stopPropagation();
          this.hideTooltip();
          this.pressStartTime = performance.now();
          if (
            this.params &&
            !d.data.disabled(this.params) &&
            !this.navigationInProgress
          ) {
            this.startHold(d, pathId);
          }
        };
        const end = (event: Event) => {
          event.stopPropagation();
          this.onHoldUp(d, event);
        };
        path.on("touchstart", (event: Event) => {
          this.holdIsMouse = false;
          begin(event);
        });
        path.on("touchend", end);
        path.on("touchcancel", () => this.cancelHold());
        // terron 23.08: НА ДЕСКТОПЕ РАБОТАЮТ ОБА ЖЕСТА — клик ставит сразу
        // (так было всегда), а «зажал мышью» заполняет сектор за
        // HOLD_MS_MOUSE. Раньше подсказка «Зажми — выбрать» показывалась и на
        // десктопе, хотя удержание там не обрабатывалось вовсе, — владелец
        // ждал секунду, ничего не происходило, и он жал ещё раз.
        path.on("mousedown", (event: Event) => {
          // Синтетическая мышь после тача — не удержание: настоящий палец уже
          // отработал через touchstart/touchend.
          if (isSynthClickAfterTouch()) return;
          this.holdIsMouse = true;
          begin(event);
        });
        path.on("mouseup", (event: Event) => {
          event.stopPropagation();
          this.cancelHold();
        });
        path.on("mouseleave", () => this.cancelHold());
        path.on("click", function (event) {
          onClick(d, event);
        });
      } else {
        path.on("click", function (event) {
          onClick(d, event);
        });

        path.on("touchstart", function (event) {
          event.preventDefault();
          event.stopPropagation();
          onClick(d, event);
        });
      }
    });
  }

  private isItemDisabled(item: MenuElement): boolean {
    return (
      this.params === null ||
      this.params.game.inSpawnPhase() ||
      item.disabled(this.params)
    );
  }

  private renderIconsAndText(
    arcs: d3.Selection<
      SVGGElement,
      d3.PieArcDatum<MenuElement>,
      SVGGElement,
      unknown
    >,
    arc: d3.Arc<any, d3.PieArcDatum<MenuElement>>,
  ) {
    arcs
      .append("g")
      .attr("class", "menu-item-content")
      .style("pointer-events", "none")
      .attr("data-id", (d) => d.data.id)
      .attr("data-cx", (d) => arc.centroid(d)[0].toString())
      .attr("data-cy", (d) => arc.centroid(d)[1].toString())
      .each((d) => {
        const contentId = d.data.id;
        const content = d3.select(`g[data-id="${contentId}"]`);
        const disabled = this.isItemDisabled(d.data);

        if (d.data.renderType && this.params) {
          const stateKey = this.getStateKeyByType(
            d.data.renderType,
            disabled,
            this.params,
          );
          if (stateKey) {
            content.attr("data-prev-state", stateKey);
          }
          if (d.data.renderType === "allyExtend") {
            this.renderAllyExtendIcon(
              content.node()! as SVGGElement,
              arc.centroid(d)[0],
              arc.centroid(d)[1],
              this.config.iconSize,
              disabled,
              this.params,
              d.data.icon,
            );
          }
        } else if (d.data.text) {
          content
            .append("text")
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .attr("x", arc.centroid(d)[0])
            .attr("y", arc.centroid(d)[1])
            .attr("fill", "white")
            .attr("font-size", d.data.fontSize ?? "12px")
            .attr("font-family", "Arial, sans-serif")
            .style("opacity", disabled ? 0.5 : 1)
            .text(d.data.text);
        } else {
          const imgSel = content
            .append("image")
            .attr("xlink:href", inlineIconHref(d.data.icon!))
            .attr("width", this.config.iconSize)
            .attr("height", this.config.iconSize)
            .attr("x", arc.centroid(d)[0] - this.config.iconSize / 2)
            .attr("y", arc.centroid(d)[1] - this.config.iconSize / 2)
            .attr("opacity", disabled ? 0.5 : 1);

          getSvgAspectRatio(inlineIconHref(d.data.icon!)).then((aspect) => {
            if (!aspect || aspect === 1) return;

            let width = this.config.iconSize;
            let height = this.config.iconSize;
            const biggerLength = Math.round(width * aspect);
            if (aspect > 1) {
              width = biggerLength;
            } else {
              height = biggerLength;
            }

            imgSel
              .attr("width", width)
              .attr("height", height)
              .attr("x", arc.centroid(d)[0] - width / 2)
              .attr("y", arc.centroid(d)[1] - height / 2);
          });

          if (this.params && d.data.cooldown?.(this.params)) {
            const cooldown = Math.ceil(d.data.cooldown?.(this.params));
            content
              .append("text")
              .attr("class", `cooldown-text`)
              .text(cooldown + "s")
              .attr("fill", "white")
              .attr("opacity", disabled ? 0.5 : 1)
              .attr("font-size", "14px")
              .attr("font-weight", "bold")
              .attr("x", arc.centroid(d)[0] - this.config.iconSize / 4)
              .attr("y", arc.centroid(d)[1] + this.config.iconSize / 2 + 16);
          }

          // terron 23.08: НОМЕР СЛОТА мелким — над иконкой и левее, как цифры
          // в углу десктопных ячеек. Это раскладка секретных кодов: позиция и
          // есть цифра, а на телефоне её иначе не увидеть. new-units/CUBE.md
          if (d.data.slotDigit !== undefined) {
            content
              .append("text")
              .attr("text-anchor", "middle")
              .attr("dominant-baseline", "hanging")
              .text(String(d.data.slotDigit))
              .attr("fill", "white")
              .attr("opacity", disabled ? 0.25 : 0.45)
              .attr("font-size", "9px")
              .attr("font-family", "Arial, sans-serif")
              .attr("x", arc.centroid(d)[0] - this.config.iconSize / 2 - 2)
              .attr("y", arc.centroid(d)[1] - this.config.iconSize / 2 - 10);
          }

          // terron: цена (или иная подпись) ПОД иконкой, полупрозрачно — видно без
          // tooltip (на мобиле его нет).
          if (this.params && d.data.subLabel) {
            const label = d.data.subLabel(this.params);
            if (label) {
              content
                .append("text")
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "hanging")
                .text(label)
                .attr("fill", "white")
                .attr("opacity", disabled ? 0.3 : 0.6)
                .attr("font-size", "10px")
                .attr("font-family", "Arial, sans-serif")
                .attr("x", arc.centroid(d)[0])
                .attr("y", arc.centroid(d)[1] + this.config.iconSize / 2 + 4);
            }
          }
        }

        this.menuIcons.set(contentId, content as any);
      });
  }

  private setupAnimations(
    menuGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  ) {
    menuGroup
      .transition()
      .duration(this.config.menuTransitionDuration * 0.8)
      .style("opacity", 1)
      .style("transform", "scale(1)")
      .on("start", () => {
        this.isTransitioning = true;
      })
      .on("end", () => {
        this.isTransitioning = false;
      });
  }

  private navigateToSubMenu(children: MenuElement[]) {
    this.isTransitioning = true;

    this.menuStack.push(this.currentMenuItems);
    this.currentMenuItems = children;
    this.currentLevel++;

    this.clampAndSetMenuPositionForLevel(this.currentLevel);
    this.renderMenuItems(this.currentMenuItems, this.currentLevel);
    this.updateMenuGroupVisibility();
    this.animatePreviousMenu();
    this.showSubMenuTitle(this.pendingSubMenuTitle); // terron
    this.showCornerButton(); // terron
  }

  private updateMenuGroupVisibility() {
    this.updateMenuVisibility("forward");
  }

  private updateMenuVisibility(direction: "forward" | "backward" = "backward") {
    this.menuGroups.forEach((menuGroup, level) => {
      if (level === this.currentLevel) {
        // Current level - always visible and interactive
        menuGroup.style("display", "block");
        menuGroup
          .transition()
          .duration(this.config.menuTransitionDuration * 0.8)
          .style("transform", "scale(1)")
          .style("opacity", 1);

        // Enable pointer events for current level
        menuGroup.selectAll("path").style("pointer-events", "auto");
      } else if (level === this.currentLevel - 1 && this.currentLevel > 0) {
        // Previous level - visible but scaled down
        menuGroup.style("display", "block");
        menuGroup
          .transition()
          .duration(this.config.menuTransitionDuration * 0.8)
          .style(
            "transform",
            `scale(${this.currentLevel === 1 ? "0.65" : "0.5"})`,
          )
          .style("opacity", 0.8);

        // Disable pointer events for previous level when going forward
        if (direction === "forward") {
          menuGroup.selectAll("path").each(function () {
            const pathElement = d3.select(this);
            pathElement.style("pointer-events", "none");
          });
        }
      } else if (level !== this.currentLevel + 1) {
        // Hide all other levels
        menuGroup
          .transition()
          .duration(this.config.menuTransitionDuration * 0.5)
          .style("transform", "scale(0.5)")
          .style("opacity", 0)
          .on("end", function () {
            d3.select(this).style("display", "none");
          });
      }
    });
  }

  private animatePreviousMenu() {
    const container = this.menuElement.select(".menu-container");
    const currentMenu = container.select(
      `.menu-level-${this.currentLevel - 1}`,
    );

    currentMenu
      .transition()
      .duration(this.config.menuTransitionDuration * 0.8)
      .style("transform", `scale(${this.currentLevel === 1 ? "0.65" : "0.5"})`)
      .style("opacity", 0.8)
      .on("end", () => {
        this.navigationInProgress = false;
      });
  }

  private navigateBack() {
    if (this.menuStack.length === 0) {
      return;
    }

    this.isTransitioning = true;
    // terron: назад из под-радиала ульт → убрать заголовок и отменить заливку.
    this.cancelHold();
    this.hideTooltip();
    this.pendingSubMenuTitle = null;
    this.hideSubMenuTitle();
    this.pendingCornerAction = null; // terron
    this.currentSubMenuParent = null; // terron
    this.hideCornerButton(); // terron

    this.updateMenuLevels();
    this.clampAndSetMenuPositionForLevel(this.currentLevel);
    this.clearSelectedItemHoverState();
    this.updateMenuVisibility("backward");
    this.animateMenuTransitions();
  }

  private updateMenuLevels() {
    const previousItems = this.menuStack.pop();
    const previousLevel = this.currentLevel - 1;
    this.currentLevel = previousLevel;

    if (previousLevel === 0) {
      this.selectedItemId = null;
    }

    this.currentMenuItems = previousItems ?? [];

    if (this.currentLevel === 0) {
      this.updateCenterButtonState("default");
    }
  }

  private clearSelectedItemHoverState() {
    // Clear the hover state on the item that opened the submenu
    if (this.selectedItemId) {
      const selectedPath = this.menuPaths.get(this.selectedItemId);
      if (selectedPath) {
        selectedPath.attr("filter", null);
      }
    }
    // Use refresh() to update all item appearances consistently
    this.refresh();
  }

  private animateMenuTransitions() {
    const container = this.menuElement.select(".menu-container");
    const currentSubmenu = container.select(
      `.menu-level-${this.currentLevel + 1}`,
    );
    const previousMenu = container.select(`.menu-level-${this.currentLevel}`);

    // Animate the current submenu (sliding out)
    currentSubmenu
      .transition()
      .duration(this.config.menuTransitionDuration * 0.8)
      .style("transform", "scale(0.5)")
      .style("opacity", 0)
      .on("end", function () {
        d3.select(this).remove();
      });

    // Handle previous menu animation
    if (previousMenu.empty()) {
      this.renderAndAnimateNewMenu();
    } else {
      this.animateExistingMenu(previousMenu);
    }
  }

  private renderAndAnimateNewMenu() {
    const menu = this.renderMenuItems(this.currentMenuItems, this.currentLevel);
    menu
      .style("transform", "scale(0.8)")
      .style("opacity", 0.3)
      .transition()
      .duration(this.config.menuTransitionDuration * 0.8)
      .style("transform", "scale(1)")
      .style("opacity", 1)
      .on("end", () => {
        this.isTransitioning = false;
        this.navigationInProgress = false;
      });
  }

  private animateExistingMenu(
    previousMenu: d3.Selection<any, unknown, null, undefined>,
  ) {
    previousMenu
      .transition()
      .duration(this.config.menuTransitionDuration * 0.8)
      .style("transform", "scale(1)")
      .style("opacity", 1)
      .on("end", () => {
        this.isTransitioning = false;
        this.navigationInProgress = false;
      });

    previousMenu.selectAll("path").style("pointer-events", "auto");
  }

  public showRadialMenu(x: number, y: number) {
    if (!this.isReopeningAllowed()) return;

    this.resetMenu();
    this.isTransitioning = false;
    this.selectedItemId = null;
    this.anchorX = x;
    this.anchorY = y;

    this.menuElement.style("display", "block");
    this.clampAndSetMenuPositionForLevel(this.currentLevel);

    this.isVisible = true;

    this.renderMenuItems(this.currentMenuItems, this.currentLevel);
    this.onCenterButtonHover(true);
    window.addEventListener("resize", this.handleResize);
  }

  public hideRadialMenu() {
    if (!this.isVisible) {
      return;
    }

    // Force transition state to false to ensure menu hides
    this.isTransitioning = false;

    this.menuElement.style("display", "none");
    this.isVisible = false;
    this.selectedItemId = null;
    this.hideTooltip();
    this.cancelHold(); // terron
    this.hideSubMenuTitle(); // terron
    this.pendingSubMenuTitle = null;
    this.hideCornerButton(); // terron
    this.pendingCornerAction = null; // terron
    this.currentSubMenuParent = null; // terron

    this.resetMenu();
    this.isTransitioning = false;

    this.menuGroups.clear();
    this.menuPaths.clear();
    this.menuIcons.clear();

    this.lastHideTime = Date.now();
    window.removeEventListener("resize", this.handleResize);
  }

  private handleCenterButtonClick() {
    if (this.centerButtonState === "default") {
      if (this.params && this.isCenterButtonEnabled()) {
        this.centerButtonElement?.action(this.params);
      }
      return;
    }

    if (this.centerButtonState === "back") {
      this.navigationInProgress = true;
      this.navigateBack();
      return;
    }
  }

  public disableAllButtons() {
    this.updateCenterButtonState("default");
    this.refresh();
  }

  public updateCenterButtonState(state: CenterButtonState) {
    this.centerButtonState = state;
    if (state === "back") {
      const backButtonSize = this.config.centerButtonSize * 0.8; // Make back button 20% smaller
      this.menuElement
        .select(".center-button-hitbox")
        .transition()
        .duration(0)
        .attr("r", backButtonSize);
      this.menuElement
        .select(".center-button-visible")
        .transition()
        .duration(0)
        .attr("r", backButtonSize);

      const backIconImg = this.menuElement.select(".center-button-icon");
      backIconImg
        .attr("xlink:href", inlineIconHref(backIcon))
        .attr("width", this.backIconSize)
        .attr("height", this.backIconSize)
        .attr("x", -this.backIconSize / 2)
        .attr("y", -this.backIconSize / 2);
    }
    if (state === "default") {
      // Restore original button size
      this.menuElement
        .select(".center-button-hitbox")
        .transition()
        .duration(0)
        .attr("r", this.config.centerButtonSize);
      this.menuElement
        .select(".center-button-visible")
        .transition()
        .duration(0)
        .attr("r", this.config.centerButtonSize);

      const iconImg = this.menuElement.select(".center-button-icon");
      iconImg
        .attr("xlink:href", inlineIconHref(this.originalCenterButtonIcon))
        .attr("width", this.centerButtonIconSize)
        .attr("height", this.centerButtonIconSize)
        .attr("x", -this.centerButtonIconSize / 2)
        .attr("y", -this.centerButtonIconSize / 2);
    }

    const centerButton = this.menuElement.select(".center-button");

    const enabled = this.isCenterButtonEnabled();

    centerButton
      .select(".center-button-hitbox")
      .style("cursor", enabled ? "pointer" : "not-allowed");

    // Use default color for back button, otherwise use the current center button color
    const buttonColor =
      state === "back" ? this.defaultCenterButtonColor : this.centerButtonColor;
    centerButton
      .select(".center-button-visible")
      .attr("fill", enabled ? buttonColor : "#999999");

    centerButton
      .select(".center-button-icon")
      .style("opacity", enabled ? 1 : 0.5);

    // terron (обучение): на шагах атаки (body.tut-attack) мигаем ЦЕНТРАЛЬНОЙ
    // кнопкой (меч = атака) — по аналогии со «Стройкой»/«Кораблём» в слотах.
    // Только когда это реально кнопка атаки (state=default) и она активна.
    const attackPulse =
      state === "default" &&
      enabled &&
      document.body.classList.contains("tut-attack");
    centerButton
      .select(".center-button-visible")
      .classed("radial-tut-pulse", attackPulse);
  }

  private isCenterButtonEnabled(): boolean {
    // Back button should always be enabled when in submenu levels
    if (this.currentLevel > 0) {
      return true;
    }

    if (this.params && this.centerButtonElement) {
      return !this.centerButtonElement.disabled(this.params);
    }
    return false;
  }

  private onCenterButtonHover(isHovering: boolean) {
    if (!this.isCenterButtonEnabled()) return;

    const scale = isHovering ? 1.2 : 1;

    this.menuElement
      .select(".center-button-hitbox")
      .transition()
      .duration(200)
      .attr("r", this.config.centerButtonSize * scale);

    this.menuElement
      .select(".center-button-visible")
      .transition()
      .duration(200)
      .attr("r", this.config.centerButtonSize * scale);
  }

  public isMenuVisible(): boolean {
    return this.isVisible;
  }

  public getCurrentLevel(): number {
    return this.currentLevel;
  }

  public setParams(params: MenuElementParams) {
    this.params = params;
  }

  public getDefaultCenterIconSize(): number {
    return this.config.centerIconSize;
  }

  public setCenterButtonAppearance(
    icon: string,
    color?: string,
    iconSize?: number,
  ) {
    this.originalCenterButtonIcon = icon;
    this.centerButtonColor = color ?? this.defaultCenterButtonColor;
    this.centerButtonIconSize = iconSize ?? this.config.centerIconSize;

    if (!this.menuElement) return;

    const iconImg = this.menuElement.select(".center-button-icon");
    iconImg
      .attr("xlink:href", inlineIconHref(icon))
      .attr("width", this.centerButtonIconSize)
      .attr("height", this.centerButtonIconSize)
      .attr("x", -this.centerButtonIconSize / 2)
      .attr("y", -this.centerButtonIconSize / 2);

    this.menuElement
      .select(".center-button-visible")
      .attr(
        "fill",
        this.isCenterButtonEnabled() ? this.centerButtonColor : "#999999",
      );

    this.updateCenterButtonState(this.centerButtonState);
  }

  private findMenuItem(id: string): MenuElement | undefined {
    return this.currentMenuItems.find((item) => item.id === id);
  }

  private resetMenu() {
    this.currentLevel = 0;
    this.menuStack = [];

    this.currentMenuItems = this.rootMenu.subMenu!(this.params!);

    this.navigationInProgress = false;

    this.menuGroups.clear();
    this.menuPaths.clear();
    this.menuIcons.clear();

    const menuContainer = this.menuElement?.select(".menu-container");
    if (menuContainer) {
      menuContainer.selectAll("[class^='menu-level-']").remove();
    }

    this.updateCenterButtonState("default");

    if (this.submenuHoverTimeout !== null) {
      window.clearTimeout(this.submenuHoverTimeout);
      this.submenuHoverTimeout = null;
    }

    if (this.backButtonHoverTimeout !== null) {
      window.clearTimeout(this.backButtonHoverTimeout);
      this.backButtonHoverTimeout = null;
    }
  }

  public refreshMenu() {
    if (!this.isVisible) return;
    this.renderMenuItems(this.currentMenuItems, this.currentLevel);
  }

  public refresh() {
    if (!this.isVisible || !this.params) return;

    // Refresh the disabled state of all menu items
    this.menuPaths.forEach((path, itemId) => {
      const item = this.findMenuItem(itemId);
      if (item) {
        const disabled = this.isItemDisabled(item);
        const color = disabled
          ? this.config.disabledColor
          : (resolveColor(item, this.params) ?? "#333333");
        const opacity = disabled ? 0.4 : 0.82;

        // Update path appearance (skip fill for timer items — gradient handles it)
        if (!item.timerFraction) {
          path.attr(
            "fill",
            d3.color(color)?.copy({ opacity: opacity })?.toString() ?? color,
          );
        }
        path.style("opacity", disabled ? 0.5 : 1);
        path.style("cursor", disabled ? "not-allowed" : "pointer");

        // terron (обучение): держим мигание слота в АКТУАЛЬНОМ состоянии. Класс
        // radial-tut-pulse ставится один раз при renderPaths, а body-классы обучения
        // между открытиями меню меняются (tut-income → tut-factory/tut-port). refresh
        // арки не пересоздаёт → без этого мигал СТАРЫЙ набор («оба здания» на шаге
        // «построй второе»). Пересинхроним по текущим классам.
        path.classed("radial-tut-pulse", this.shouldTutPulse(item));

        // Update icon/text appearance using the same logic as renderIconsAndText
        const icon = this.menuIcons.get(itemId);
        if (icon) {
          if (item.renderType === "allyExtend" && this.params) {
            this.refreshAllyExtendIcon(item, disabled, icon);
          } else {
            // Update text opacity
            const textElement = icon.select("text");
            if (!textElement.empty()) {
              textElement.style("opacity", disabled ? 0.5 : 1);
            }

            // Update image opacity
            const imageElement = icon.select("image");
            if (!imageElement.empty()) {
              imageElement.attr("opacity", disabled ? 0.5 : 1);
            }

            // Update cooldown text if applicable
            const cooldownElement = icon.select(".cooldown-text");
            if (this.params && !cooldownElement.empty() && item.cooldown) {
              const cooldown = Math.ceil(item.cooldown(this.params));
              if (cooldown <= 0) {
                cooldownElement.remove();
              } else {
                cooldownElement.text(cooldown + "s");
              }
            }
          }

          // Update timer gradient
          this.maybeUpdateTimerGradient(item, color, opacity);
        }
      }
    });

    // Refresh center button state
    this.updateCenterButtonState(this.centerButtonState);
  }

  private refreshAllyExtendIcon(
    item: MenuElement,
    disabled: boolean,
    icon: d3.Selection<SVGImageElement, unknown, null, undefined>,
  ): void {
    if (item.renderType !== "allyExtend" || !this.params) {
      return;
    }

    const stateKey = this.getStateKeyByType(
      item.renderType,
      disabled,
      this.params,
    );
    const prevState = icon.attr("data-prev-state");

    if (stateKey && stateKey === prevState) {
      // State unchanged, skip re-render to preserve animations
    } else {
      const cx = parseFloat(icon.attr("data-cx") || "0");
      const cy = parseFloat(icon.attr("data-cy") || "0");

      if (stateKey) {
        icon.attr("data-prev-state", stateKey);
      } else {
        icon.selectAll("*").remove();
      }

      this.renderAllyExtendIcon(
        icon.node()! as SVGGElement,
        cx,
        cy,
        this.config.iconSize,
        disabled,
        this.params,
        item.icon,
        true,
      );
    }
  }

  private maybeUpdateTimerGradient(
    item: MenuElement,
    color: string,
    opacity: number,
  ): void {
    if (!item.timerFraction || !this.params) {
      return;
    }

    const fraction = item.timerFraction(this.params);
    const gradient = this.menuElement.select(`#timer-gradient-${item.id}`);
    if (!gradient.empty()) {
      const offset = 1 - fraction;
      const normalColor =
        d3.color(color)?.copy({ opacity: opacity })?.toString() ?? color;
      const interpolated = d3.color(d3.interpolateRgb(color, "white")(0.4));
      const fadedColor =
        interpolated?.copy({ opacity })?.toString() ?? normalColor;

      gradient
        .select(".timer-stop-faded")
        .attr("offset", offset)
        .attr("stop-color", fadedColor);
      gradient
        .select(".timer-stop-normal")
        .attr("offset", offset)
        .attr("stop-color", normalColor);
    }
  }

  private getStateKeyByType(
    type: string,
    disabled: boolean,
    params: MenuElementParams,
  ): string | null {
    switch (type) {
      case "allyExtend":
        return this.getAllyExtendStateKey(disabled, params);
      default:
        return null;
    }
  }

  private getAllyExtendStateKey(
    disabled: boolean,
    params: MenuElementParams,
  ): string {
    const interaction = params.playerActions?.interaction;
    const myAgreed = interaction?.allianceInfo?.myPlayerAgreedToExtend ?? false;
    const otherAgreed = interaction?.allianceInfo?.otherAgreedToExtend ?? false;
    return `${disabled}:${myAgreed}:${otherAgreed}`;
  }

  private renderAllyExtendIcon(
    content: SVGGElement,
    cx: number,
    cy: number,
    iconSize: number,
    disabled: boolean,
    params: MenuElementParams,
    icon?: string,
    update?: boolean,
  ): void {
    if (update) {
      while (content.firstChild) content.removeChild(content.firstChild);
    }

    const interaction = params.playerActions?.interaction;
    const myAgreed = interaction?.allianceInfo?.myPlayerAgreedToExtend ?? false;
    const otherAgreed = interaction?.allianceInfo?.otherAgreedToExtend ?? false;

    const ns = "http://www.w3.org/2000/svg";
    const smallSize = iconSize * 0.8;
    const iconUrl = inlineIconHref(icon);

    getSvgAspectRatio(iconUrl).then((ratio) => {
      const width = smallSize * (ratio ?? 1);
      const gap = 2;
      const totalWidth = width * 2 + gap;

      // Left handshake = me
      const leftImg = document.createElementNS(ns, "image");
      leftImg.setAttribute("href", iconUrl);
      leftImg.setAttribute("width", width.toString());
      leftImg.setAttribute("height", smallSize.toString());
      leftImg.setAttribute("x", (cx - totalWidth / 2).toString());
      leftImg.setAttribute("y", (cy - smallSize / 2).toString());
      leftImg.setAttribute("opacity", disabled ? "0.5" : "1");

      if (!myAgreed) {
        const animLeft = document.createElementNS(ns, "animate");
        animLeft.setAttribute("attributeName", "opacity");
        animLeft.setAttribute("values", disabled ? "0.5;0.1;0.5" : "1;0.2;1");
        animLeft.setAttribute("dur", "1.5s");
        animLeft.setAttribute("repeatCount", "indefinite");
        leftImg.appendChild(animLeft);
      }

      content.appendChild(leftImg);

      // Right handshake = them
      const rightImg = document.createElementNS(ns, "image");
      rightImg.setAttribute("href", iconUrl);
      rightImg.setAttribute("width", width.toString());
      rightImg.setAttribute("height", smallSize.toString());
      rightImg.setAttribute(
        "x",
        (cx - totalWidth / 2 + width + gap).toString(),
      );
      rightImg.setAttribute("y", (cy - smallSize / 2).toString());
      rightImg.setAttribute("opacity", disabled ? "0.5" : "1");

      if (!otherAgreed) {
        const animRight = document.createElementNS(ns, "animate");
        animRight.setAttribute("attributeName", "opacity");
        animRight.setAttribute("values", disabled ? "0.5;0.1;0.5" : "1;0.2;1");
        animRight.setAttribute("dur", "1.5s");
        animRight.setAttribute("repeatCount", "indefinite");
        rightImg.appendChild(animRight);
      }

      content.appendChild(rightImg);
    });
  }

  private isReopeningAllowed(): boolean {
    const now = Date.now();
    const timeSinceHide = now - this.lastHideTime;
    return timeSinceHide >= this.reopenCooldownMs;
  }

  // terron: НАЖАЛИ на ульту → начинаем «заливку» кнопки снизу вверх. Заполнилась
  // за HOLD_MS → выполняем action. Отпустили раньше → это ТАП (см. onHoldUp).
  /** Порог удержания для текущего ввода: мышь — короткий, палец — длинный. */
  private holdMs(): number {
    return this.holdIsMouse ? RadialMenu.HOLD_MS_MOUSE : RadialMenu.HOLD_MS;
  }

  private startHold(d: d3.PieArcDatum<MenuElement>, pathId: string): void {
    if (this.params === null || d.data.disabled(this.params)) return;
    this.cancelHold();
    const node = document.querySelector(
      `path[data-id="${pathId}"]`,
    ) as SVGPathElement | null;
    if (!node || node.parentNode === null) return;
    const bbox = node.getBBox();
    const dAttr = node.getAttribute("d") ?? "";
    const defs = this.menuElement.select("defs");
    const clipId = `hold-clip-${pathId}`;
    defs.select(`#${clipId}`).remove();
    const rect = defs
      .append("clipPath")
      .attr("id", clipId)
      .attr("clipPathUnits", "userSpaceOnUse")
      .append("rect")
      .attr("x", bbox.x)
      .attr("width", bbox.width)
      .attr("y", bbox.y + bbox.height)
      .attr("height", 0) as unknown as d3.Selection<
      SVGRectElement,
      unknown,
      null,
      undefined
    >;
    const overlay = d3
      .select(node.parentNode as SVGGElement)
      .append("path")
      .attr("d", dAttr)
      .attr("fill", "rgba(255,255,255,0.6)")
      .attr("clip-path", `url(#${clipId})`)
      .attr("pointer-events", "none") as unknown as d3.Selection<
      SVGPathElement,
      unknown,
      null,
      undefined
    >;
    this.holdState = {
      d,
      pathId,
      raf: 0,
      start: performance.now(),
      rect,
      overlay,
    };
    const step = () => {
      if (!this.holdState) return;
      const p = Math.min(
        1,
        (performance.now() - this.holdState.start) / this.holdMs(),
      );
      this.holdState.rect
        .attr("y", bbox.y + bbox.height * (1 - p))
        .attr("height", bbox.height * p);
      if (p >= 1) {
        this.completeHold();
        return;
      }
      this.holdState.raf = requestAnimationFrame(step);
    };
    this.holdState.raf = requestAnimationFrame(step);
  }

  private cancelHold(): void {
    if (!this.holdState) return;
    cancelAnimationFrame(this.holdState.raf);
    this.holdState.overlay.remove();
    this.menuElement.select(`#hold-clip-${this.holdState.pathId}`).remove();
    this.holdState = null;
  }

  private completeHold(): void {
    if (!this.holdState) return;
    const d = this.holdState.d;
    this.suppressNextClick = true;
    this.cancelHold();
    if (this.params && !d.data.disabled(this.params)) {
      this.eventBus.emit(new PlaySoundEffectEvent("click"));
      d.data.action?.(this.params);
      this.isTransitioning = false;
      this.hideRadialMenu();
    }
  }

  // terron: отпустили ДО заливки (или тап по залоченной) → показать ОПИСАНИЕ.
  private onHoldUp(d: d3.PieArcDatum<MenuElement>, event: Event): void {
    const elapsed =
      this.pressStartTime !== null
        ? performance.now() - this.pressStartTime
        : 0;
    this.pressStartTime = null;
    this.cancelHold();
    if (elapsed > 0 && elapsed < this.holdMs()) {
      // ⚠️ Нажатие оказалось ТАПОМ — значит пункт активировать НЕЛЬЗЯ, что бы
      // ни прилетело следом. Браузер шлёт синтетический click уже после
      // touchend, и на длинном тапе окно 700 мс от touchstart его не ловит.
      this.suppressNextClick = true;
      window.setTimeout(() => {
        this.suppressNextClick = false;
      }, 1000);
      // terron 23.08: тап (не удержание) — сообщаем пункту. На этом держатся
      // секретные коды: цифра вводится тапом, а строит только удержание.
      if (this.params !== null && d.data.onTap?.(this.params) === true) {
        return; // код сошёлся — описание не показываем, колесо уже закрыто
      }
      const items = d.data.tooltipItems ?? d.data.tooltipKeys;
      if (items && items.length > 0) {
        this.showTooltip(items);
        const pt = this.eventPoint(event);
        if (pt && this.tooltipElement) {
          const tw = this.tooltipElement.offsetWidth;
          let x = pt.x + 12;
          if (x + tw > window.innerWidth - 6) x = pt.x - tw - 12;
          this.tooltipElement.style.left = Math.max(6, x) + "px";
          this.tooltipElement.style.top = pt.y + 14 + "px";
        }
      }
    }
  }

  private eventPoint(event: Event): { x: number; y: number } | null {
    const e = event as MouseEvent & { changedTouches?: TouchList };
    if (e.changedTouches && e.changedTouches.length > 0) {
      return {
        x: e.changedTouches[0].pageX,
        y: e.changedTouches[0].pageY,
      };
    }
    if (typeof e.pageX === "number") return { x: e.pageX, y: e.pageY };
    return null;
  }

  // terron: заголовок над под-радиалом (создаётся лениво).
  private showSubMenuTitle(key: string | null): void {
    if (!key) {
      this.hideSubMenuTitle();
      return;
    }
    if (!this.subMenuTitleElement) {
      const el = document.createElement("div");
      // terron: translateY(-100%) — блок висит ПОЛНОСТЬЮ над точкой top, чтобы
      // подсказка не наползала на само колесо (top = верх колеса − зазор).
      el.style.cssText =
        "position:fixed;z-index:10001;transform:translate(-50%,-100%);" +
        "pointer-events:none;background:rgba(12,35,64,0.92);color:#fff;" +
        "padding:5px 12px;border-radius:8px;font-size:13px;font-weight:700;" +
        "white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.4);";
      document.body.appendChild(el);
      this.subMenuTitleElement = el;
    }
    this.subMenuTitleElement.innerHTML = "";
    const titleLine = document.createElement("div");
    titleLine.textContent = translateText(key);
    this.subMenuTitleElement.appendChild(titleLine);
    const hintLine = document.createElement("div");
    // terron 23.08: подсказка ПО ВВОДУ. На десктопе висело «Зажми — выбрать»,
    // хотя удержание там не обрабатывалось вовсе — владелец честно держал и
    // ждал. Теперь мышь читает про клик, палец — про удержание.
    const touch =
      typeof window !== "undefined" &&
      (("ontouchstart" in window) || navigator.maxTouchPoints > 0);
    hintLine.textContent = translateText(
      touch ? "ultimate.hold_hint" : "ultimate.hold_hint_mouse",
    );
    hintLine.style.cssText =
      "font-size:10px;font-weight:400;opacity:0.8;margin-top:2px;";
    this.subMenuTitleElement.appendChild(hintLine);
    const r = this.getOuterRadiusForLevel(this.currentLevel);
    this.subMenuTitleElement.style.left = this.anchorX + "px";
    this.subMenuTitleElement.style.top = this.anchorY - r - 12 + "px";
    this.subMenuTitleElement.style.display = "block";
  }

  private hideSubMenuTitle(): void {
    if (this.subMenuTitleElement) {
      this.subMenuTitleElement.style.display = "none";
    }
  }

  // terron: полоса-кнопка ПОД под-радиалом (на всю ширину колеса), напр. ресет
  // ультов за ЛТС. Видна пока открыт под-радиал с cornerAction. Тап → onTap →
  // перерисовка текущего уровня. Стиль — как десктоп-кнопка «↻ Обновить ульты».
  private showCornerButton(): void {
    const action = this.pendingCornerAction;
    if (!action || !this.params) {
      this.hideCornerButton();
      return;
    }
    if (!this.cornerButtonElement) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:fixed;z-index:10001;pointer-events:auto;cursor:pointer;" +
        "box-sizing:border-box;text-align:center;white-space:nowrap;" +
        "background:rgba(30,41,59,0.92);color:#fde68a;" +
        "border:1px solid rgba(202,138,4,0.65);border-radius:7px;" +
        "padding:8px 10px;font-size:13px;font-weight:700;line-height:1;" +
        "box-shadow:0 2px 10px rgba(0,0,0,.45);user-select:none;" +
        "transform:translateX(-50%);overflow:hidden;text-overflow:ellipsis;";
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.onCornerTap();
      });
      el.addEventListener("click", (e) => e.stopPropagation());
      document.body.appendChild(el);
      this.cornerButtonElement = el;
    }
    const el = this.cornerButtonElement;
    el.textContent = action.label(this.params);
    const r = this.getOuterRadiusForLevel(this.currentLevel);
    // На всю ширину колеса (диаметр), по центру под ним.
    el.style.width = Math.min(2 * r, window.innerWidth - 16) + "px";
    el.style.left = this.anchorX + "px";
    el.style.top = this.anchorY + r + 10 + "px";
    el.style.opacity = "1";
    el.style.display = "block";
  }

  private hideCornerButton(): void {
    if (this.cornerButtonElement) {
      this.cornerButtonElement.style.display = "none";
    }
  }

  private async onCornerTap(): Promise<void> {
    const action = this.pendingCornerAction;
    const parent = this.currentSubMenuParent;
    if (!action || !parent || !this.params || this.cornerBusy) return;
    this.cornerBusy = true;
    if (this.cornerButtonElement) this.cornerButtonElement.style.opacity = "0.5";
    try {
      const changed = await action.onTap(this.params);
      if (changed && this.pendingCornerAction && this.params) {
        // Сетка изменилась → перерисовать ТЕКУЩИЙ уровень новыми пунктами.
        const fresh = parent.subMenu?.(this.params) ?? [];
        this.currentMenuItems = fresh;
        this.renderMenuItems(fresh, this.currentLevel);
        this.updateMenuVisibility("forward");
        this.showCornerButton(); // обновить цену (оффсет вырос)
      }
    } finally {
      this.cornerBusy = false;
      if (this.cornerButtonElement) this.cornerButtonElement.style.opacity = "1";
    }
  }

  private showTooltip(items: TooltipItem[] | TooltipKey[]) {
    if (!this.tooltipElement) return;

    this.tooltipElement.innerHTML = "";

    for (const item of items) {
      const div = document.createElement("div");
      div.className = item.className;

      if ("key" in item) {
        div.textContent = translateText(item.key, item.params);
      } else {
        div.textContent = item.text;
      }

      this.tooltipElement.appendChild(div);
    }

    this.tooltipElement.style.display = "block";
  }

  private hideTooltip() {
    if (this.tooltipElement) {
      this.tooltipElement.style.display = "none";
    }
  }

  // Ensure the menu's SVG center stays within viewport given the current level's outer radius
  private clampAndSetMenuPositionForLevel(level: number) {
    const outerRadius = this.getOuterRadiusForLevel(level);
    const margin = Math.max(outerRadius, this.config.centerButtonSize) + 10;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // If the menu cannot fully fit on an axis, pin it to the viewport center on that axis.
    const clampedX =
      2 * margin > vw
        ? vw / 2
        : Math.min(Math.max(this.anchorX, margin), vw - margin);
    const clampedY =
      2 * margin > vh
        ? vh / 2
        : Math.min(Math.max(this.anchorY, margin), vh - margin);

    const svgSel = this.menuElement.select("svg");
    svgSel.style("top", `${clampedY}px`).style("left", `${clampedX}px`);
  }

  private handleResize = () => {
    if (this.isVisible) this.clampAndSetMenuPositionForLevel(this.currentLevel);
  };
}

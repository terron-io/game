/**
 * terron: ГОСТ КОРАБЛЯ. Пока выбран ghost корабля (uiState.ghostStructure ===
 * UnitType.Warship) — под курсором рисуем иконку того, что реально построится.
 * Корабль не здание → в структурный атлас WebGL-госта он не входит
 * (StructurePass рисует только атласные структуры), поэтому иконку кладём
 * отдельным Canvas-2D поверх карты. Владелец: «чисто иконку корабля повторяй
 * под мышкой и всё».
 *
 * ⚠️ 23.08: ЗДЕСЬ БЫЛИ ДВЕ ЗАХАРДКОЖЕННЫЕ КАРТИНКИ — линкор и подлодка, с
 * ручным `if (hasUltimate(SubmarineBase))`. Поэтому у Пиратства под курсором
 * оставался ЛИНКОР, хотя строится пиратская лодка: подмену юнита знал реестр
 * (`ULTIMATE_REGISTRY.replaces`), а этот контроллер — нет. Теперь иконка
 * берётся ИЗ РЕЕСТРА той же функцией, что кормит кнопку 8 и радиальное меню
 * (`warshipIconFor`), и грузится лениво по её адресу: новая ульта-подменщик
 * подхватится здесь сама.
 */
import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import { GameView } from "../../core/game/GameView";
import { Controller } from "../Controller";
import { MouseMoveEvent, MouseOverEvent } from "../InputHandler";
import { UIState } from "../UIState";
import { warshipIconFor } from "../UnitCatalog";
import { ghostKindFor } from "../UnitVisuals";

const ICON_PX = 30; // размер иконки под курсором

export class WarshipPreviewController implements Controller {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private glCanvas: HTMLElement | null = null;
  private destroyed = false;
  private readonly mousePos = { x: -1, y: -1 };
  private cssW = 0;
  private cssH = 0;

  /** Кэш загруженных картинок по URL: адрес даёт реестр подмен. */
  private readonly icons = new Map<string, HTMLImageElement>();

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly uiState: UIState,
  ) {}

  /** Картинка по адресу; грузится один раз, до загрузки ничего не рисуем. */
  private iconFor(url: string): HTMLImageElement | null {
    const cached = this.icons.get(url);
    if (cached !== undefined) {
      return cached.complete && cached.naturalWidth > 0 ? cached : null;
    }
    const img = new Image();
    img.src = url;
    this.icons.set(url, img);
    return null;
  }

  init(): void {
    this.eventBus.on(MouseMoveEvent, (e) => {
      this.mousePos.x = e.x;
      this.mousePos.y = e.y;
    });
    this.eventBus.on(MouseOverEvent, (e) => {
      this.mousePos.x = e.x;
      this.mousePos.y = e.y;
    });

    const c = document.createElement("canvas");
    c.style.cssText =
      "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:6;";
    this.canvas = c;
    this.ctx = c.getContext("2d");
    this.glCanvas = document.getElementById("webgl-debug-canvas");
    if (this.glCanvas && this.glCanvas.parentElement) {
      this.glCanvas.after(c);
    } else {
      document.body.appendChild(c);
    }

    const drive = () => {
      if (this.destroyed) return;
      if (this.glCanvas && !this.glCanvas.isConnected) {
        this.dispose();
        return;
      }
      this.draw();
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
  }

  private draw(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w !== this.cssW || h !== this.cssH) {
      this.cssW = w;
      this.cssH = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // ⚠️ Рисуем ТОЛЬКО если единый решатель гостов сказал «этому юниту —
    // иконка» (client/UnitVisuals.ts). Правило владельца: ОДИН гост на юнит,
    // если не сказано иное; тип с иконкой крестика уже не получает.
    const ghost = this.uiState.ghostStructure;
    if (
      ghost === null ||
      this.mousePos.x < 0 ||
      ghostKindFor(ghost as UnitType, 0) !== "icon"
    ) {
      return;
    }
    const me = this.game.myPlayer();
    if (!me || !me.isAlive()) return;

    // Иконка — ИЗ РЕЕСТРА ПОДМЕН: Подводный флот → подлодка, Пиратство →
    // пиратская лодка, иначе линкор. Ровно то же, что на кнопке 8.
    const icon = this.iconFor(
      warshipIconFor((t: UnitType) => me.hasUltimate(t)),
    );
    if (icon === null) return;

    const x = this.mousePos.x;
    const y = this.mousePos.y;

    // Только иконка под курсором (без круглого фона). Лёгкая тень — чтобы белый
    // корабль не терялся на светлой воде.
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = 4;
    ctx.drawImage(icon, x - ICON_PX / 2, y - ICON_PX / 2, ICON_PX, ICON_PX);
    ctx.restore();
  }

  private dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
  }
}

/**
 * terron: StructureHoverController — ховер структур на карте (десктоп-мышь).
 *
 * При наведении курсора на структуру:
 *  - Мин правды → DOM-тултип «украдено войск: N» (счётчик едет с юнитом,
 *    UnitUpdate.stolenTroops) + круг радиуса ауры;
 *  - Щит (Defense Post) / ПВО → круг радиуса действия (SamRadiusPass,
 *    setStructureHoverCircle) + тултип с именем и уровнем.
 *
 * Тултип клэмпится в экран (уводится влево, если справа некуда, и наоборот).
 * Спека: new-units/ULTIMATES.md
 */

import {
  fortRangeMult,
  TERRON_OURSKY_SAM_RADIUS_MULT,
} from "../../core/configuration/TerronTuning";
import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import { GameView, PlayerView, UnitView } from "../../core/game/GameView";
import { Controller } from "../Controller";
import { MouseMoveEvent } from "../InputHandler";
import { GameView as WebGLGameView } from "../render/gl";
import { TransformHandler } from "../TransformHandler";
import { ultHoverRadiusTiles, ultStatLines } from "../UnitCatalog";
import { renderNumber, translateText } from "../Utils";

// Типы, на которые реагируем, и радиус попадания курсора (в тайлах).
const HOVER_TYPES = [
  UnitType.Media, // terron: ультимейты — штаб МЕДИА (аура влитой Мин правды)
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.Religion, // terron: ультимейты — храм (обращено земель + десятина)
  UnitType.Fortifications, // terron: ультимейты — штаб (круг эффективного радиуса)
  UnitType.Revanchism, // terron: ультимейты — статуя (список обидчиков)
  UnitType.OurSky, // terron: Небо наше (реворк 21.08) — штаб-ПВО, круг ×5 радиуса
];
const PICK_DIST2 = 6 * 6;
const THROTTLE_MS = 80;

export class StructureHoverController implements Controller {
  private el: HTMLDivElement | null = null;
  private lastCheck = 0;
  private lastUnitId: number | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private view: WebGLGameView,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.onMouseMove(e));
  }

  private ensureEl(): HTMLDivElement {
    if (this.el) return this.el;
    const d = document.createElement("div");
    d.style.cssText =
      "position:fixed;z-index:60;display:none;pointer-events:none;" +
      "background:rgba(31,41,55,.92);color:#e5e7eb;font-size:12px;" +
      "padding:4px 8px;border:1px solid rgba(255,255,255,.15);" +
      "border-radius:2px;max-width:240px;line-height:1.35;";
    document.body.appendChild(d);
    this.el = d;
    return d;
  }

  private hide(): void {
    if (this.lastUnitId === null) return;
    this.lastUnitId = null;
    if (this.el) this.el.style.display = "none";
    this.view.setStructureHoverCircle(null);
  }

  // terron: множитель радиуса бункеров владельца по уровню его штаба Укреплений
  // (1 — если штаба нет). new-units/ULTIMATES.md
  private fortMultFor(owner: PlayerView): number {
    const hq = owner
      .units(UnitType.Fortifications)
      .find((u) => !u.isUnderConstruction());
    return hq ? fortRangeMult(hq.level()) : 1;
  }

  private onMouseMove(e: MouseMoveEvent): void {
    // terron: фейд ника под курсором — шлём позицию курсора (мир) в name-pass
    // КАЖДЫЙ mousemove (дёшево, без троттла), чтобы фейд плавно следовал за мышью.
    // Курсор вне карты → уводим далеко, чтобы ник перестал тускнеть.
    const nameCell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (this.game.isValidCoord(nameCell.x, nameCell.y)) {
      this.view.setNameHoverCursor(nameCell.x, nameCell.y);
    } else {
      this.view.setNameHoverCursor(-1e9, -1e9);
    }

    const now = performance.now();
    if (now - this.lastCheck < THROTTLE_MS) return;
    this.lastCheck = now;

    if (this.game.inSpawnPhase()) {
      this.hide();
      return;
    }
    const cell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      this.hide();
      return;
    }

    // Ближайшая интересная структура в радиусе попадания.
    let best: UnitView | null = null;
    let bestD2 = PICK_DIST2 + 1;
    for (const u of this.game.units(...HOVER_TYPES)) {
      if (!u.isActive()) continue;
      const t = u.tile();
      const dx = this.game.x(t) - cell.x;
      const dy = this.game.y(t) - cell.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = u;
      }
    }
    if (best === null) {
      this.hide();
      return;
    }

    // Круг радиуса действия. SAM/Щит — свои формулы; ульты — из реестра
    // UnitCatalog (Мин.правды = число; Религия/Форты не задают hoverRadiusTiles →
    // круга нет: у религии эффект по всей территории, у фортов уже зелёное покрытие).
    const type = best.type();
    let radius: number | null;
    if (type === UnitType.SAMLauncher) {
      radius = this.game.config().samRange(best.level());
    } else if (type === UnitType.OurSky) {
      // terron: штаб Неба — гигантское ПВО (реворк 21.08).
      radius =
        this.game.config().samRange(best.level()) *
        TERRON_OURSKY_SAM_RADIUS_MULT;
    } else if (type === UnitType.DefensePost) {
      // terron: у владельца Укреплений бункер бьёт дальше (растёт с ур.)
      radius =
        this.game.config().defensePostRange() * this.fortMultFor(best.owner());
    } else {
      radius = ultHoverRadiusTiles(type) ?? null;
    }
    if (radius === null) {
      this.view.setStructureHoverCircle(null);
    } else {
      const friendly =
        best.owner() === this.game.myPlayer() ||
        (this.game.myPlayer()?.isFriendly(best.owner()) ?? false);
      this.view.setStructureHoverCircle({
        x: this.game.x(best.tile()),
        y: this.game.y(best.tile()),
        radius,
        friendly,
      });
    }

    // Тултип.
    const key =
      type === UnitType.SAMLauncher
        ? "sam_launcher"
        : type === UnitType.DefensePost
          ? "defense_post"
          : type === UnitType.Religion
            ? "religion"
            : type === UnitType.Fortifications
              ? "fortifications"
              : type === UnitType.Revanchism
                ? "revanchism"
                : "media";
    const lvl = best.level() > 1 ? ` [${best.level()}]` : "";
    let html = `<b>${translateText("unit_type." + key)}${lvl}</b>`;
    // Счётчики — из реестра UnitCatalog (единый источник, паритет с баром/радиалом).
    // Ауру (МЕДИА) показываем PER-UNIT (счётчик едет с юнитом) — подменяем поля снимка.
    let snap = best.owner().ultStats();
    if (type === UnitType.Media) {
      snap = {
        ...snap,
        stolen: best.stolenTroops(),
        stolenGained: best.gainedTroops(),
      };
    }
    for (const { i18nKey, value } of ultStatLines(type, snap)) {
      html += `<br>${translateText(i18nKey, { n: renderNumber(value) })}`;
    }

    // terron: РЕВАНШИЗМ — прямо в ховере статуи пишем, НА КОГО МЫ ОБИДЕЛИСЬ
    // (кто напал первым): по ним у нас +50% атаки. Запрос владельца 06.08.
    if (type === UnitType.Revanchism) {
      const names = best.owner().aggressorNames();
      html += `<br>${translateText("ultimate.revenge_list", {
        n:
          names.length > 0
            ? names.join(", ")
            : translateText("ultimate.revenge_none"),
      })}`;
    }

    const el = this.ensureEl();
    el.innerHTML = html;
    el.style.display = "block";
    // Клэмп в экран: по умолчанию справа-снизу от курсора; если не влезает —
    // зеркалим на другую сторону.
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = e.x + 14;
    let y = e.y + 16;
    if (x + w > window.innerWidth - 4) x = e.x - w - 14;
    if (y + h > window.innerHeight - 4) y = e.y - h - 12;
    el.style.left = `${Math.max(4, x)}px`;
    el.style.top = `${Math.max(4, y)}px`;
    this.lastUnitId = best.id();
  }
}

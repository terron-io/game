import { html, LitElement, nothing, svg, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  Cell,
  PlayerBuildableUnitType,
  PlayerType,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { ReplaySpeedChangeEvent } from "../../InputHandler";
import { confirmDialog, toast } from "../../Toast";
import { GoToPositionEvent, TransformHandler } from "../../TransformHandler";
import {
  BuildUnitIntentEvent,
  PauseGameIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendSpawnIntentEvent,
} from "../../Transport";
import { isTutorialActive, setTutorialActive,
  markTutorialDone,
} from "../../Tutorial";
import { ReplaySpeedMultiplier } from "../../utilities/ReplaySpeedMultiplier";
import { L, renderNumber, renderTroops, translateText } from "../../Utils";

// terron: ОБУЧАЮЩИЕ КАРТОЧКИ (см. TUTORIAL.md). Отдельный аддитивный слой, активен
// ТОЛЬКО в обучающей игре. Тема сайта: квадрат, жёсткая тень, антрацит, Oswald/Golos.
// Контент про мышь/тап/расширение переиспользован из spawn_tut.* (SpawnTutorial).

const INK = "#2b2a24";
const SHEET = "#fdfcf7";
const RED = "#a8432b";
const AMBER = "#b7791f";
const GREEN = "#2f7d32";
const WATER = "#2f6db0";
const EXPAND_CLICKS = 5; // как в spawn-туторе
const TRIBES_REQUIRED = 2; // сколько племён «сожрать» на этапе tribes
const CLICK_RATIO = 0.2; // доля войск на клик-атаку (дефолт attackRatio); фолбэк, если панель не читается
const SHIP_MAX = 3; // сколько транспортов можно держать одновременно (для подсказки)
// troops() — внутренние единицы (renderTroops делит на 10). 20000 = «2000» на экране.
const RECOVER_TROOPS = 20000;
// анти-спам: столько атак за окно = «пригасись» (уведомляем каждый залп, без лимита)
const SPAM_WINDOW_MS = 2000;
const SPAM_CLICKS = 4;

const isMobile = () =>
  window.matchMedia("(max-width: 767px)").matches || "ontouchstart" in window;

// иконка порта (inline — PortIcon.svg белый, на светлой карточке невидим; красим ink)
const portGlyph = svg`<svg viewBox="0 0 100 100" class="tut-port"><path fill="currentColor" d="M86.946 70.119l-2.417-15.098c-.286-1.419-1.511-2.495-2.982-2.495-.899 0-1.687.385-2.268.997L68.104 63.997c-.176.156-.352.338-.515.56-1.049 1.433-.749 3.465.684 4.527.273.215.573.345.866.462l2.808.931c-2.697 7.641-9.313 13.45-17.417 15.059l.014-45.638h5.992c1.889 0 3.412-1.538 3.412-3.426 0-1.875-1.523-3.413-3.412-3.413h-5.992v-6.78c3.979-1.687 6.721-5.634 6.721-10.206C61.264 9.95 56.314 5 50.192 5c-6.097 0-11.073 4.95-11.073 11.073 0 4.578 2.847 8.52 6.8 10.206l.007 6.78h-6.468c-1.882 0-3.413 1.538-3.413 3.413 0 1.889 1.531 3.426 3.413 3.426h6.468l.021 45.71c-8.292-1.485-15.15-7.354-17.926-15.131l2.827-.931c.299-.117.6-.247.879-.456 1.427-1.067 1.753-3.1.671-4.533-.155-.222-.313-.404-.508-.554L20.706 53.524c-.553-.612-1.361-.997-2.246-.997-1.486 0-2.743 1.075-3.009 2.495L13.027 70.12c-.053.241-.064.508-.064.762 0 1.791 1.446 3.236 3.229 3.236.339 0 .658-.032.959-.137l2.624-.853C23.956 85.816 35.901 95 49.997 95s26.053-9.184 30.221-21.891l2.619.872c.299.105.618.137.963.137 1.785 0 3.237-1.446 3.237-3.236 0-.255-.025-.522-.091-.763M45.659 16.073c0-2.521 2.044-4.553 4.533-4.553 2.527 0 4.552 2.032 4.552 4.553 0 2.514-2.024 4.559-4.552 4.559-2.489 0-4.533-2.046-4.533-4.559"/></svg>`;

const swordGlyph = svg`<svg viewBox="0 0 512 512" class="tut-sword"><path d="M486.5-.5h17c3.641 1.64121 6.308 4.30788 8 8v17l-6.5 60c-2.279 7.2245-5.612 13.8911-10 20L226.5 373c-6.667 4.667-13.333 4.667-20 0L187 353.5c-3.333-6.333-3.333-12.667 0-19l225-225c2.815-6.703.649-10.7028-6.5-12-2.291.1221-4.291.9554-6 2.5l-223 223c-5.34 3.613-11.007 4.28-17 2-7.803-6.802-15.303-13.969-22.5-21.5-3.698-7.415-3.031-14.415 2-21L407.5 15c7.148-5.27457 15.148-8.60791 24-10 18.516-1.51524 36.849-3.34857 55-5.5z" opacity=".979"/><path d="M18.5 279.5c16.3367-.167 32.6701 0 49 .5 2.1079.36 4.1079 1.027 6 2L226 433.5c1.586 2.17 2.92 4.504 4 7 .667 18.333.667 36.667 0 55-6.43 10.856-14.764 12.522-25 5-1.275-2.217-2.275-4.551-3-7l-1-43-39.5-39.5c-12.412 6.36-24.412 13.694-36 22-3.202 1.483-6.536 1.817-10 1-5.705-9.063-12.372-17.397-20-25-6.2553-4.378-12.422-8.878-18.5-13.5-.6667-2.333-.6667-4.667 0-7 6.4154-11.166 13.0821-22.166 20-33 1.5899-2.15 2.2566-4.483 2-7L59.5 309l-44-1c-9.22703-3.984-12.06036-10.818-8.5-20.5 2.82328-4.312 6.6566-6.979 11.5-8z" opacity=".963"/><path d="M56.5 511.5h-20c-19.3333-5.333-31.66667-17.667-37-37v-20c12.0559-32.525 34.7225-43.359 68-32.5 26.8247 17.455 32.991 40.622 18.5 69.5-2.5402 2.205-4.7068 4.705-6.5 7.5-6.8651 5.764-14.5317 9.93-23 12.5z" opacity=".975"/></svg>`;

// иконка «расширяться» — диагональные стрелки наружу (arrows-out)
const growGlyph = svg`<svg viewBox="0 0 256 256" class="tut-grow"><path fill="currentColor" d="M144 48a8 8 0 0 1 8-8h48a8 8 0 0 1 8 8v48a8 8 0 0 1-16 0V67.3l-42.3 42.4a8 8 0 0 1-11.4-11.4L180.7 56H152a8 8 0 0 1-8-8ZM98.3 146.3 56 188.7V160a8 8 0 0 0-16 0v48a8 8 0 0 0 8 8h48a8 8 0 0 0 0-16H67.3l42.4-42.3a8 8 0 0 0-11.4-11.4Z"/></svg>`;

// солдат/войска — тот же значок, что в нижнем меню (SoldierIcon.svg, инлайн: assetUrl-картинка
// на светлой карточке белая/невидима; у path нет fill → красим через CSS fill).
const soldierGlyph = svg`<svg viewBox="0 0 1200 1200" class="tut-soldier"><path d="m417.86 237.12v-237.12h-40.664v432.45h78.738v-195.34z"/><path d="m708.33 392.05h302.69v69.617l38.762-0.14453-0.046875-5.3555s-0.5-48.523-0.5-68.785c0-113.14-85.332-204.45-189.74-204.45-104.5 0-190.45 93.094-190.45 206.26 0 20.477-0.5 70.215-0.5 70.238l-0.046875 2.0703h39.809z"/><path d="m735.59 418.45c-0.26172 2.9062-0.66797 5.7852-0.66797 8.7383 0 68.832 55.809 124.57 124.59 124.57 68.785 0 124.55-55.762 124.55-124.57 0-2.9766-0.45312-5.8555-0.64453-8.7383z"/><path d="m1030.2 573.67h-331.57c-96.855 0-169.98 56.047-169.98 154.98v409.93c0 33.191 26.953 60.023 60.094 60.023 33.191 0 60.047-26.883 60.047-60.023l0.046875-367.07h37.738v428.5h355.53v-428.52h37.547l0.19141 367.07c0 33.191 26.953 60.023 60.023 60.023 33.238 0 60.094-26.883 60.094-60.023v-409.95c0.046875-98.926-72.953-154.93-169.76-154.93zm-47.5 207-48.785-25.668-48.762 25.668 9.3086-54.309-39.43-38.43 54.5-7.9297 24.383-49.406 24.355 49.406 54.523 7.9297-39.453 38.43z"/><path d="m489.07 1162-0.90625-396.02-30.668 0.070312-0.71094-311.24-78.523 0.19141 0.71484 293.79s-24.262 41.57-100.19 41.57c-69.332 0-225.52-90.809-225.52-90.809l-53.262 131.71s112.19 55.883 173.67 65.43c23 3.5938 47.617 5.1172 71.191 5.4766-13.883 15.453-22.547 35.668-22.547 58.023 0 28.168 13.617 52.953 34.383 68.953l-133.91 67.977 55.07 97.906 136.24-93.93s13.93-9.8555 26.285-3.332c11.117 5.8828 12.617 20.57 12.617 20.57l0.11719 44.047 46.07-0.30859-0.57031 37.191h53.309l-0.023437-37.262zm-180-159.05c-23.43 0-42.406-19-42.406-42.406s18.977-42.406 42.406-42.406c18.023 0 33.332 11.309 39.477 27.168h-43.57v33.477h42.238c-6.832 14.238-21.262 24.168-38.145 24.168z"/></svg>`;

// монета золота (GoldCoinIcon.svg, собственные цвета — инлайн как есть)
const coinGlyph = svg`<svg viewBox="0 0 48 48" class="tut-coin"><polygon points="9,23 17,15 45,15 37,23" fill="#F4D44E"/><polygon points="9,23 37,23 34,35 12,35" fill="#D9A520"/><polygon points="9,23 17,15 19,17 11,25" fill="#FBE88A"/><polygon points="37,23 34,35 36,34 39,22" fill="#B9860E"/></svg>`;

// иконки построек/юнитов — ТЕ ЖЕ (белые), что на кнопках снизу. Кладём в тёмный
// чип `.tut-chip` (белое на тёмном), чтобы совпадало с игровыми кнопками.
const cityIconUrl = assetUrl("images/CityIconWhite.svg");
const factoryIconUrl = assetUrl("images/FactoryIconWhite.svg");
const portIconUrl = assetUrl("images/PortIcon.svg");
const boatIconUrl = assetUrl("images/BoatIconWhite.svg");
const warshipIconUrl = assetUrl("images/BattleshipIconWhite.svg");
const buildIconUrl = assetUrl("images/BuildIconWhite.svg");
const defenseIconUrl = assetUrl("images/ShieldIconWhite.svg");
const siloIconUrl = assetUrl("images/MissileSiloIconWhite.svg");
const samIconUrl = assetUrl("images/SamLauncherIconWhite.svg");

// белая иконка в тёмном чипе (как кнопка постройки снизу)
const chip = (url: string) =>
  html`<span class="tut-chip"
    ><img src=${url} width="13" height="13" alt=""
  /></span>`;

// финальный справочник по юнитам (карусель карточек-«товаров»)
const UNIT_CATALOG: {
  icon: string;
  key: string;
  title: () => string;
  desc: () => string;
  coin?: boolean; // показать иконку золота в описании
}[] = [
  {
    icon: siloIconUrl,
    key: "5",
    title: () => L("Ракетная шахта", "Missile silo"),
    desc: () =>
      L(
        "Отсюда запускаешь ракеты по врагам. У ракет перезарядка, летят они по дуге — вражеское ПВО может их сбить. Выбирай с умом, откуда бить.",
        "Launch missiles at enemies from here. Missiles have a reload, fly in an arc, and enemy SAMs can shoot them down — pick your launch spot wisely.",
      ),
  },
  {
    icon: samIconUrl,
    key: "6",
    title: () => L("ПВО", "SAM launcher"),
    desc: () =>
      L(
        "Сбивает вражеские ракеты в своём радиусе. Ставь у важных зданий и границ — так же с умом выбирай место.",
        "Shoots down enemy missiles within its range. Place it near key buildings and borders — choose the spot with care.",
      ),
  },
  {
    icon: warshipIconUrl,
    key: "7",
    title: () => L("Варшип", "Warship"),
    desc: () =>
      L(
        "Воюет с чужими кораблями, сбивает морские высадки и захватывает торговые корабли — забирает их золото.",
        "Fights enemy ships, downs sea landings, and captures trade ships — taking their gold.",
      ),
    coin: true,
  },
];

type Card = {
  x: number;
  y: number;
  scale?: number;
  accent: string;
  title: () => string;
  body: () => TemplateResult;
};

const CARD_SCALE = 1.7;

const CARDS: Card[] = [
  {
    x: 272,
    y: 320,
    accent: RED,
    title: () => L("Горы", "Mountains"),
    body: () =>
      html`${L(
          "Белые земли — горы. Захватывать их сложнее и дольше — ",
          "White land is mountains — capturing it is slower and costlier, ",
        )}<b style="color:${RED}">×1.5</b>.`,
  },
  {
    x: 750,
    y: 320,
    accent: AMBER,
    title: () => L("Возвышенность", "Highland"),
    body: () =>
      html`${L(
          "Песочные земли — возвышенность. Захват дороже равнины — ",
          "Sandy land is highland — costlier to capture than plains, ",
        )}<b style="color:${AMBER}">×1.25</b>.`,
  },
  {
    x: 1228,
    y: 320,
    accent: GREEN,
    title: () => L("Равнина", "Plains"),
    body: () =>
      html`${L(
          "Зелёные земли — равнина. Расширяться легко и быстро — ",
          "Green land is plains — easy and fast to expand, ",
        )}<b style="color:${GREEN}">×1</b>.`,
  },
];

const HUD_TAGS = [
  "control-panel",
  "leader-board",
  "team-stats",
  "game-left-sidebar",
  "game-right-sidebar",
  "build-menu",
  "unit-display",
  "player-info-overlay",
  "player-panel",
  "spawn-timer",
  "spawn-tutorial",
  "task-tracker",
  "immunity-timer",
  "events-display",
  "chat-display",
  "actionable-events",
  "heads-up-message",
  "replay-panel",
];
const HUD_HIDE_CLASS = "terron-tut-hud-hidden";
const HUD_HL_CLASS = "terron-tut-hl";
const HIDE_STYLE_ID = "terron-tut-hide-style";

type Phase =
  | "intro"
  | "cards"
  | "spawnInfo"
  | "spawnClick"
  | "expand"
  | "ratioSet"
  | "attackNow"
  | "lesson"
  | "ratioBack"
  | "recover"
  | "expandMore"
  | "contact"
  | "tribes"
  | "awaitBuild"
  | "buildCity"
  | "income"
  | "incomeExplain"
  | "income2"
  | "incomeExplain2"
  | "fillLetter"
  | "ship"
  | "shipWarning"
  | "bunker"
  | "upgradeChoice"
  | "upgrade"
  | "catalog"
  | "dead"
  | "graduation";

@customElement("tutorial-cards")
export class TutorialCards extends LitElement implements Controller {
  public game!: GameView;
  public eventBus!: EventBus;
  public transformHandler!: TransformHandler;

  @state() private active = false;
  @state() private phase: Phase = "cards";
  @state() private index = 0;
  @state() private paused = false;
  @state() private attacks = 0;
  @state() private tribesEaten = 0;
  @state() private cityCost = 0n; // цена города (из buildables) для прогресса золота
  @state() private incomeCost = 0n; // цена фабрики/порта — для прогресса на шаге дохода
  @state() private catIndex = 0; // текущая карточка справочника юнитов (финал)
  private incomeFirst: UnitType | null = null; // что построил первым (фабрика/порт)
  private spawned = false;
  private ratioPoll = 0;
  private contactPoll = 0;
  private buildPoll = 0;
  private botScanPoll = 0; // постоянный скан граничащих племён (с фазы expand)
  private deathPoll = 0; // следим, не погиб ли игрок (после спавна) → карточка «умер»
  private spawnTile: TileRef | null = null;
  // племена (Bot), которых касались границей — считаем съеденных (мёртвых) «со старта»
  private borderedBots = new Map<number, { isAlive(): boolean }>();
  // тайл встреченного соседа (для маркера на карте) + rAF-цикл слежения за камерой
  private contactPoint: { x: number; y: number } | null = null;
  private markerRaf = 0;
  // анти-спам: времена последних атак (для детекта залпа)
  private spamTimes: number[] = [];
  // задержка кнопки (напр. lesson — 3с нельзя жать); карточку прячем на «вздох» (hush)
  @state() private btnReadyAt = 0;
  @state() private hush = false;
  private contactDelayTimer = 0; // 5с задержка показа контакта
  private shipSeen = false; // видели транспорт в воде → ждём высадку (кол-во→0)
  private baseCityLevels = 0; // уровни городов на входе в upgrade (рост = апгрейд)
  @state() private upgradeCost = 0n; // цена апгрейда города (для полосы)
  private upgradeBuilding = false; // уже поставили паузу+мигание на апгрейд
  @state() private expandMoreDone = false; // сделал 5 доп.расширений → прячем карточку

  createRenderRoot() {
    return this;
  }

  init() {
    this.ensureHideStyle();
    this.active = false;
    this.phase = "cards";
    this.paused = false;
    this.spawned = false;
    this.attacks = 0;
    this.clearRatioPoll();
    this.clearContactPoll();
    this.stopMarkerLoop();
    this.contactPoint = null;
    this.spamTimes = [];
    this.btnReadyAt = 0;
    this.hush = false;
    this.shipSeen = false;
    if (this.contactDelayTimer) {
      clearTimeout(this.contactDelayTimer);
      this.contactDelayTimer = 0;
    }
    this.stopBotScan();
    this.clearBuildPoll();
    this.borderedBots.clear();
    this.tribesEaten = 0;
    this.cityCost = 0n;
    this.incomeCost = 0n;
    this.spawnTile = null;
    this.clearBuildClasses();
    this.hideHud(false);
    this.highlightBottomMenu(false);

    const isTut = isTutorialActive();
    setTutorialActive(false);
    // флаг «мы в обучающей песочнице» — по нему TaskTracker глушит квесты, и т.п.
    window.__terronInTutorial = isTut;
    if (!isTut) return;

    this.eventBus?.on(SendSpawnIntentEvent, (e) => {
      this.spawnTile = e.tile;
      this.onSpawned();
    });
    this.eventBus?.on(SendAttackIntentEvent, () => this.onAttack());
    this.eventBus?.on(BuildUnitIntentEvent, (e) => {
      const isIncome = e.unit === UnitType.Factory || e.unit === UnitType.Port;
      if (this.phase === "buildCity" && e.unit === UnitType.City) {
        // terron: шаг «займи свою букву» ОТКЛЮЧЁН (toFillLetter/checkLetterFilled —
        // мёртвый код). Сразу к высадке: 5с «вздох» после города, потом ship.
        this.pause(false);
        this.revealFullHud();
        this.clearBuildPoll();
        this.breather(5000);
        window.setTimeout(() => {
          if (this.phase === "buildCity") this.toShip();
        }, 5000);
      } else if (this.phase === "income" && isIncome) {
        this.incomeFirst = e.unit;
        this.toIncomeExplain();
      } else if (
        this.phase === "income2" &&
        isIncome &&
        e.unit !== this.incomeFirst
      ) {
        this.toIncomeExplain2();
      } else if (this.phase === "bunker" && e.unit === UnitType.DefensePost) {
        this.onBunkerBuilt();
      }
    });
    this.eventBus?.on(SendBoatAttackIntentEvent, () => {
      if (this.phase === "ship") this.toShipWarning();
    });
    window.setTimeout(() => this.begin(), 900);
  }

  private ensureHideStyle() {
    if (document.getElementById(HIDE_STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = HIDE_STYLE_ID;
    s.textContent =
      `.${HUD_HIDE_CLASS}{display:none !important;}` +
      `.${HUD_HL_CLASS}{outline:3px solid ${RED} !important;outline-offset:4px !important;` +
      `animation:terronTutHl 1s steps(2,start) infinite;}` +
      `@keyframes terronTutHl{50%{outline-color:rgba(168,67,43,.3) !important;}}`;
    document.head.appendChild(s);
  }

  private begin() {
    this.active = true;
    this.phase = "intro";
    this.index = 0;
    this.hideHud(true);
    this.pause(true);
    // terron: ускоряем симуляцию ×2 (fast=0.5 = половина интервала хода)
    this.eventBus?.emit(new ReplaySpeedChangeEvent(ReplaySpeedMultiplier.fast));
    toast(
      L("Для обучения игра ускорена ×2", "Tutorial runs at ×2 speed"),
      "info",
    );
    this.goToCard(0);
    this.requestUpdate();
  }

  // интро → к биом-карточкам
  private introDone = () => {
    this.phase = "cards";
    this.index = 0;
    this.goToCard(0);
    this.requestUpdate();
  };

  private pause(v: boolean) {
    if (this.paused === v) return;
    this.paused = v;
    this.eventBus?.emit(new PauseGameIntentEvent(v));
    // синхронизируем иконку паузы/старт в правом баре (иначе она рассинхронится)
    window.dispatchEvent(new CustomEvent("terron-tut-pause", { detail: v }));
  }

  private hideHud(v: boolean) {
    for (const tag of HUD_TAGS) {
      document
        .querySelectorAll(tag)
        .forEach((el) => el.classList.toggle(HUD_HIDE_CLASS, v));
    }
  }

  private revealBottomMenu() {
    document
      .querySelectorAll("control-panel")
      .forEach((el) => el.classList.remove(HUD_HIDE_CLASS));
  }

  private highlightBottomMenu(v: boolean) {
    document
      .querySelectorAll("control-panel")
      .forEach((el) => el.classList.toggle(HUD_HL_CLASS, v));
  }

  private clearRatioPoll() {
    if (this.ratioPoll) {
      clearInterval(this.ratioPoll);
      this.ratioPoll = 0;
    }
  }

  private clearContactPoll() {
    if (this.contactPoll) {
      clearInterval(this.contactPoll);
      this.contactPoll = 0;
    }
  }

  private ratio(): number {
    const cp = document.querySelector("control-panel") as unknown as {
      attackRatio?: number;
    } | null;
    return cp?.attackRatio ?? 0;
  }

  private goToCard(i: number) {
    const c = CARDS[i];
    if (!c || !this.transformHandler) return;
    this.transformHandler.scale = c.scale ?? CARD_SCALE;
    this.eventBus?.emit(new GoToPositionEvent(c.x, c.y));
  }

  private next = () => {
    if (this.index >= CARDS.length - 1) {
      this.phase = "spawnInfo";
      this.requestUpdate();
      return;
    }
    this.index += 1;
    this.goToCard(this.index);
  };

  private back = () => {
    if (this.index <= 0) return;
    this.index -= 1;
    this.goToCard(this.index);
  };

  private spawnInfoOk = () => {
    this.phase = "spawnClick";
    this.pause(false);
    this.requestUpdate();
  };

  private spawnInfoBack = () => {
    this.phase = "cards";
    this.index = CARDS.length - 1;
    this.goToCard(this.index);
    this.requestUpdate();
  };

  private onSpawned() {
    if (this.spawned || this.phase !== "spawnClick") return;
    this.spawned = true;
    // Секунда — и расширение: ставим паузу, ПЕРВЫЙ клик игрока снимает её и
    // сразу идёт как расширение (он «начинает первым»).
    window.setTimeout(() => {
      this.phase = "expand";
      this.attacks = 0;
      this.pause(true);
      // показываем нижнее меню уже здесь — чтобы игрок видел полосу процентов
      // (она же — источник числа в «каждый клик — 20% (504 🪖)»).
      this.revealBottomMenu();
      // с этого момента постоянно сканируем граничащие племена — чтобы съеденные
      // ещё во время расширения зачлись на этапе «сожри племена».
      this.startBotScan();
      this.startDeathWatch();
      this.armFirstClickUnpause("expand");
      // realtime % войск на клик: если игрок двигает ползунок — обновляем карточку
      this.clearRatioPoll();
      this.ratioPoll = window.setInterval(() => {
        if (this.phase !== "expand") return this.clearRatioPoll();
        this.requestUpdate();
      }, 300);
      this.requestUpdate();
    }, 1000);
  }

  // первый клик по карте в указанной фазе снимает паузу (клик = «начал»/«активировал»)
  private armFirstClickUnpause(phase: Phase) {
    const handler = () => {
      if (this.phase === phase) this.pause(false);
    };
    window.addEventListener("pointerdown", handler, {
      once: true,
      capture: true,
    });
  }

  // terron: следим, не погиб ли игрок в песочнице (съели/потерял всю землю).
  // Погиб = заспавнен, но больше не живой. Показываем карточку «умер» с рестартом.
  private startDeathWatch() {
    if (this.deathPoll) return;
    this.deathPoll = window.setInterval(() => {
      if (this.phase === "dead" || this.phase === "graduation") return;
      const me = this.game?.myPlayer();
      if (me && me.hasSpawned() && !me.isAlive()) this.onDeath();
    }, 700);
  }

  private clearDeathWatch() {
    if (this.deathPoll) {
      clearInterval(this.deathPoll);
      this.deathPoll = 0;
    }
  }

  private onDeath() {
    this.clearDeathWatch();
    this.clearRatioPoll();
    this.clearContactPoll();
    this.clearBuildPoll();
    this.stopBotScan();
    this.stopMarkerLoop();
    this.pause(false);
    this.clearBuildClasses();
    this.revealFullHud();
    this.hush = false;
    this.phase = "dead";
    this.requestUpdate();
  }

  private static BUILD_CLASSES = [
    "tut-city",
    "tut-income",
    "tut-factory",
    "tut-port",
    "tut-defense",
  ];

  private clearBuildClasses() {
    for (const c of TutorialCards.BUILD_CLASSES) {
      document.body.classList.remove(c);
    }
    document.body.classList.remove("tut-ship"); // шаг высадки (мигание «Корабль»)
    document.body.classList.remove("tut-attack"); // шаги атаки (мигание «Меч»)
  }

  // Начать шаг постройки: подсветить НУЖНУЮ кнопку (bodyClass) и поставить паузу
  // (чтобы клики по карте = атаки НЕ тратили войска — на паузе интенты дропаются).
  // Паузу снимаем в момент, когда игрок ТАПАЕТ по меню стройки — СИНХРОННО, в
  // capture-фазе pointerdown, ДО того как тап-действие эмитит BuildUnitIntentEvent.
  // Это критично: pause(false) синхронен (eventBus→Transport→LocalServer СРАЗУ ставит
  // paused=false), поэтому к моменту build-интента игра уже «живая» и он не дропается
  // (был баг: на паузе LocalServer роняет интент → здание не строится). Меню стройки:
  // радиал (.radial-menu-container — SVG-DOM, и на телефоне тоже) / DOM build-menu /
  // unit-display на десктопе. Просто тап по карте (canvas) паузу НЕ снимает.
  private beginBuild(phase: Phase, bodyClass: string) {
    this.clearBuildClasses();
    document.body.classList.add(bodyClass);
    this.revealFullHud();
    this.pause(true);
    const unpause = () => {
      if (this.phase !== phase) return cleanup();
      this.pause(false);
      cleanup();
    };
    const onDown = (e: PointerEvent) => {
      if (this.phase !== phase) return cleanup();
      const t = e.target as Element | null;
      if (t?.closest?.(".radial-menu-container, build-menu, unit-display")) {
        unpause();
      }
      // тап по карте (попытка атаки) → мигаем подсказкой в onAttack, не здесь
    };
    // десктоп-фолбэк: цифра-хоткей стройки тоже снимает паузу (тоже ДО постановки).
    const onKey = (e: KeyboardEvent) => {
      if (this.phase !== phase) return cleanup();
      if (/^[0-9]$/.test(e.key)) unpause();
    };
    const cleanup = () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
  }

  // мигнуть карточкой-подсказкой (кликнул не туда во время постройки)
  private flashHint() {
    const el = this.querySelector(".tut-msg") as HTMLElement | null;
    if (!el) return;
    el.classList.remove("tut-flash");
    void el.offsetWidth; // рестарт анимации
    el.classList.add("tut-flash");
    window.setTimeout(() => el.classList.remove("tut-flash"), 700);
  }

  private static BUILD_PHASES: Phase[] = [
    "buildCity",
    "income",
    "income2",
    "bunker",
    "upgrade",
  ];

  private onAttack() {
    this.maybeWarnSpam();
    // во время постройки попытка атаки = ошибка → мигаем подсказкой. НО только когда
    // денег уже хватает (мы на паузе с мигающей кнопкой). Пока копим — атаковать можно.
    if (TutorialCards.BUILD_PHASES.includes(this.phase)) {
      if (this.paused) this.flashHint();
      return;
    }
    if (this.phase === "recover") {
      this.flashHint(); // копим войска — не отправляй
      return;
    }
    if (this.phase === "expand") {
      this.attacks += 1;
      if (this.attacks >= EXPAND_CLICKS) this.toRatioSet();
    } else if (this.phase === "attackNow") {
      this.onFinalAttack();
    } else if (this.phase === "expandMore") {
      // после ещё EXPAND_CLICKS расширений прячем карточку «продолжай расширяться»
      this.attacks += 1;
      if (this.attacks >= EXPAND_CLICKS && !this.expandMoreDone) {
        this.expandMoreDone = true;
        this.requestUpdate();
      }
    }
  }

  // Пассивный анти-спам: если игрок частит атаками — мягко предупреждаем, что так
  // он спустит все войска. Работает на ЛЮБОЙ фазе, КАЖДЫЙ раз при новом залпе (без лимита).
  private maybeWarnSpam() {
    if (!this.active) return;
    const now = Date.now();
    this.spamTimes.push(now);
    this.spamTimes = this.spamTimes.filter((t) => now - t < SPAM_WINDOW_MS);
    if (this.spamTimes.length >= SPAM_CLICKS) {
      this.spamTimes = []; // сброс окна — следующее предупреждение за новый залп
      toast(
        L(
          "Притормози — так ты спустишь все войска и останешься без подкрепления.",
          "Ease up — spamming attacks drains your troops and leaves no reserves.",
        ),
        "error",
      );
    }
  }

  private toRatioSet() {
    this.phase = "ratioSet";
    this.pause(true); // ползунок — это UI, работает на паузе
    this.revealBottomMenu();
    this.highlightBottomMenu(true);
    this.clearRatioPoll();
    this.ratioPoll = window.setInterval(() => {
      this.requestUpdate(); // живой % на карточке
      // terron: засчитываем 75%+ (не требуем ровно 100% — на телефоне точно попасть
      // в максимум ползунком тяжело).
      if (this.ratio() >= 0.75) {
        this.clearRatioPoll();
        this.phase = "attackNow";
        // остаёмся на ПАУЗЕ: показываем окно «теперь атакуй», первый клик
        // игрока снимает паузу и сразу идёт атакой.
        this.armFirstClickUnpause("attackNow");
        this.requestUpdate();
      }
    }, 250);
    this.requestUpdate();
  }

  private onFinalAttack() {
    this.phase = "lesson";
    this.highlightBottomMenu(false);
    this.lockBtn(3000); // «Дальше» на уроке нельзя жать сразу — 3с на прочтение
    window.setTimeout(() => {
      this.pause(true);
      this.requestUpdate();
    }, 1000);
    this.requestUpdate();
  }

  // Урок понят → просим вернуть войска на ~20% (принимаем 10–30%)
  private toRatioBack = () => {
    this.phase = "ratioBack";
    this.pause(true);
    this.revealBottomMenu();
    this.highlightBottomMenu(true);
    this.clearRatioPoll();
    this.ratioPoll = window.setInterval(() => {
      this.requestUpdate(); // живой %
      const r = this.ratio();
      if (r >= 0.1 && r <= 0.3) {
        this.clearRatioPoll();
        this.toRecover();
      }
    }, 250);
    this.requestUpdate();
  };

  // ratioBack → recover: «не совершай больше ошибок, подождём пока накопится
  // RECOVER_TROOPS войск» (полоса прогресса, не отправляй войска). Игра идёт.
  private toRecover() {
    this.phase = "recover";
    this.pause(false);
    this.clearRatioPoll();
    this.ratioPoll = window.setInterval(() => {
      this.requestUpdate(); // живой прогресс войск
      const t = this.game?.myPlayer()?.troops() ?? 0;
      if (this.phase === "recover" && t >= RECOVER_TROOPS) {
        this.clearRatioPoll();
        this.toExpandMore();
      }
    }, 400);
    this.requestUpdate();
  }

  // «Продолжай расширяться» → размораживаем, ждём касания ЛЮБОГО клана/нации.
  // Грейс 2с — дать прочитать карточку и походить, потом начинаем ловить контакт.
  private toExpandMore() {
    this.phase = "expandMore";
    this.highlightBottomMenu(false);
    this.attacks = 0;
    this.expandMoreDone = false;
    // держим паузу, пока игрок не кликнет (клик = «продолжил») — как в фазе expand
    this.pause(true);
    this.armFirstClickUnpause("expandMore");
    this.clearContactPoll();
    window.setTimeout(() => {
      if (this.phase !== "expandMore") return;
      this.contactPoll = window.setInterval(
        () => void this.checkClanContact(),
        700,
      );
    }, 2000);
    this.requestUpdate();
  }

  // касание клана/нации: граница игрока соседствует с чужим игроком.
  // Запоминаем первый чужой тайл — по нему рисуем маркер и наводим камеру.
  private async checkClanContact() {
    if (this.phase !== "expandMore") return;
    // гвард: пока игрок не кликнул (не снял паузу) — карточку «продолжай
    // расширяться» НЕ подменяем контактом, даже если сосед уже рядом.
    if (this.paused) return;
    const me = this.game?.myPlayer();
    if (!me) return;
    try {
      const { borderTiles } = await me.borderTiles();
      const mySmall = me.smallID();
      for (const tile of borderTiles) {
        for (const n of this.game.neighbors(tile)) {
          if (!this.game.hasOwner(n)) continue;
          const o = this.game.owner(n);
          if (o.isPlayer() && o.smallID() !== mySmall) {
            this.contactPoint = { x: this.game.x(n), y: this.game.y(n) };
            this.scheduleContact();
            return;
          }
        }
      }
    } catch {
      // borderTiles() асинхронный — временная ошибка, следующий тик повторит
    }
  }

  // встретил соседа → даём 5с продолжить, потом показываем карточку контакта
  private scheduleContact() {
    this.clearContactPoll();
    if (this.contactDelayTimer) return;
    this.contactDelayTimer = window.setTimeout(() => {
      this.contactDelayTimer = 0;
      if (this.phase === "expandMore") this.onClanContact();
    }, 5000);
  }

  // принудительно снять паузу (клик по индикатору «Пауза» / кнопке ▶)
  private forceUnpause = () => {
    this.pause(false);
    this.requestUpdate();
  };

  // прячем карточку на `ms` (дать игроку увидеть новое здание/состояние)
  private breather(ms: number) {
    this.hush = true;
    this.requestUpdate();
    window.setTimeout(() => {
      this.hush = false;
      this.requestUpdate();
    }, ms);
  }

  private btnLocked(): boolean {
    return Date.now() < this.btnReadyAt;
  }

  // заблокировать кнопку карточки на `ms` (напр. lesson — 3с) + тикать отсчёт
  private lockBtn(ms: number) {
    this.btnReadyAt = Date.now() + ms;
    const iv = window.setInterval(() => {
      this.requestUpdate();
      if (!this.btnLocked()) clearInterval(iv);
    }, 350);
  }

  private onClanContact() {
    this.clearContactPoll();
    this.phase = "contact";
    this.pause(true);
    this.lockBtn(3000); // «Я выбрал» нельзя жать сразу — 3с на прочтение
    // навести камеру на встреченного соседа и запустить слежение маркера
    if (this.contactPoint) {
      this.eventBus?.emit(
        new GoToPositionEvent(this.contactPoint.x, this.contactPoint.y),
      );
      this.startMarkerLoop();
    }
    this.requestUpdate();
  }

  // Маркер — DOM-элемент поверх карты. Мир→экран через transformHandler,
  // обновляем каждый кадр (камера/зум двигаются независимо от паузы игры).
  private startMarkerLoop() {
    this.stopMarkerLoop();
    const tick = () => {
      if (
        this.phase !== "contact" ||
        !this.contactPoint ||
        !this.transformHandler
      ) {
        this.markerRaf = 0;
        return;
      }
      const el = this.querySelector(".tut-marker") as HTMLElement | null;
      if (el) {
        const cell = new Cell(this.contactPoint.x, this.contactPoint.y);
        const p = this.transformHandler.worldToScreenCoordinates(cell);
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
        el.style.opacity = this.transformHandler.isOnScreen(cell) ? "1" : "0";
      }
      this.markerRaf = requestAnimationFrame(tick);
    };
    this.markerRaf = requestAnimationFrame(tick);
  }

  private stopMarkerLoop() {
    if (this.markerRaf) {
      cancelAnimationFrame(this.markerRaf);
      this.markerRaf = 0;
    }
  }

  // ── этап «сожри племена» → «построй город» ──────────────────────────────────
  // Скан граничащих ботов (племён). Копим ссылки, чтобы потом считать мёртвых
  // (= съеденных). Логика 1:1 из SpawnTutorial.scanBorderBots.
  private async scanBorderBots() {
    const me = this.game?.myPlayer();
    if (!me) return;
    try {
      const { borderTiles } = await me.borderTiles();
      const mySmall = me.smallID();
      for (const tile of borderTiles) {
        for (const n of this.game.neighbors(tile)) {
          if (!this.game.hasOwner(n)) continue;
          const o = this.game.owner(n);
          if (!o.isPlayer() || o.smallID() === mySmall) continue;
          if (o.type() === PlayerType.Bot)
            this.borderedBots.set(o.smallID(), o);
        }
      }
    } catch {
      // borderTiles() асинхронный — временная ошибка, следующий тик повторит
    }
  }

  private eatenBots(): number {
    let n = 0;
    for (const o of this.borderedBots.values()) if (!o.isAlive()) n++;
    return n;
  }

  private startBotScan() {
    if (this.botScanPoll) return;
    this.botScanPoll = window.setInterval(
      () => void this.scanBorderBots(),
      900,
    );
  }

  private stopBotScan() {
    if (this.botScanPoll) {
      clearInterval(this.botScanPoll);
      this.botScanPoll = 0;
    }
  }

  private clearBuildPoll() {
    if (this.buildPoll) {
      clearInterval(this.buildPoll);
      this.buildPoll = 0;
    }
  }

  // Цена города из реальных buildables (по спавн-тайлу или border-тайлам).
  private async probeCityCost() {
    const p = this.game?.myPlayer();
    if (!p) return;
    try {
      const tiles: TileRef[] = [];
      if (this.spawnTile !== null) tiles.push(this.spawnTile);
      const { borderTiles } = await p.borderTiles();
      let i = 0;
      for (const t of borderTiles) {
        tiles.push(t);
        if (++i >= 8) break;
      }
      for (const t of tiles) {
        const bs = await p.buildables(t, [UnitType.City]);
        const city = bs.find((b) => b.type === UnitType.City);
        if (city && city.cost > 0n) {
          if (city.cost !== this.cityCost) this.cityCost = city.cost;
          return;
        }
      }
    } catch {
      // ignore
    }
  }

  // contact → tribes: показать полный HUD (нужны реальные контролы), спрятать
  // маркер, снять паузу. Если игрок УЖЕ съел достаточно племён — сразу к городу.
  private toTribes = () => {
    this.stopMarkerLoop();
    this.contactPoint = null;
    this.phase = "tribes";
    this.pause(false);
    this.revealFullHud();
    void this.scanBorderBots();
    this.clearBuildPoll();
    this.buildPoll = window.setInterval(() => void this.checkTribes(), 900);
    this.requestUpdate();
  };

  private async checkTribes() {
    if (this.phase !== "tribes") return;
    await this.scanBorderBots();
    await this.probeCityCost();
    const eaten = this.eatenBots();
    if (eaten !== this.tribesEaten) this.tribesEaten = eaten;
    const gold = this.game?.myPlayer()?.gold() ?? 0n;
    const richEnough = this.cityCost > 0n && gold >= this.cityCost;
    if (this.phase === "tribes" && (eaten >= TRIBES_REQUIRED || richEnough)) {
      this.toAwaitBuild();
    }
  }

  // tribes → awaitBuild: копим золото на город. Прогресс золота на карточке,
  // город снизу ещё НЕ мигает (мигание — только когда реально по карману).
  private toAwaitBuild() {
    this.stopBotScan();
    this.phase = "awaitBuild";
    this.pause(false);
    this.revealFullHud();
    this.clearBuildPoll();
    this.buildPoll = window.setInterval(
      () => void this.checkCityBuildable(),
      1000,
    );
    this.requestUpdate();
  }

  // awaitBuild → buildCity: как только город реально доступен (canBuild = хватает
  // золота И есть место) — включаем подсветку кнопки города (body.tut-city, её
  // ловит UnitDisplay и мигает `tut-hl-city`), ждём событие постройки. 1:1 с
  // SpawnTutorial.checkCityBuildable.
  private async checkCityBuildable() {
    if (this.phase !== "awaitBuild") return;
    const p = this.game?.myPlayer();
    if (!p) return;
    try {
      const tiles: TileRef[] = [];
      if (this.spawnTile !== null) tiles.push(this.spawnTile);
      const { borderTiles } = await p.borderTiles();
      let i = 0;
      for (const t of borderTiles) {
        tiles.push(t);
        if (++i >= 10) break;
      }
      for (const t of tiles) {
        const bs = await p.buildables(t, [UnitType.City]);
        const city = bs.find((b) => b.type === UnitType.City);
        if (!city) continue;
        if (city.cost > 0n && city.cost !== this.cityCost) {
          this.cityCost = city.cost;
        }
        if (this.phase === "awaitBuild" && city.canBuild !== false) {
          this.toBuildCity();
          return;
        }
      }
      this.requestUpdate(); // живой прогресс золота
    } catch {
      // ignore
    }
  }

  private toBuildCity() {
    this.phase = "buildCity";
    this.clearBuildPoll(); // дальше ждём событие постройки
    this.beginBuild("buildCity", "tut-city"); // пауза+мигание города, клик мимо → мигаем
    this.requestUpdate();
  }

  // buildCity → income: город построен. 5с БЕЗ карточки (дать увидеть город), затем
  // шаг «доход» — копим золото (полоса прогресса), и КАК НАКОПИМ → пауза+мигание.
  private toIncome = () => {
    this.phase = "income";
    this.pause(false);
    this.clearBuildClasses();
    this.revealFullHud();
    // прячем карточку, пока не пробьём цену → баннер и полоса появятся ВМЕСТЕ
    this.hush = true;
    this.incomeCost = 0n;
    this.clearBuildPoll();
    window.setTimeout(() => {
      if (this.phase !== "income") return;
      this.buildPoll = window.setInterval(
        () =>
          void this.checkIncomeAfford(
            "income",
            [UnitType.Factory, UnitType.Port],
            "tut-income",
          ),
        600,
      );
    }, 1200);
    this.requestUpdate();
  };

  // ждём накопления золота на постройку; тянем цену для полосы; как хватит →
  // пауза + мигание нужной кнопки (beginBuild). Пока нет — игра идёт, полоса растёт.
  private async checkIncomeAfford(
    phase: Phase,
    types: readonly PlayerBuildableUnitType[],
    cls: string,
  ) {
    if (this.phase !== phase) return;
    const { cost, canBuild } = await this.probeBuild(types);
    if (cost > 0n && cost !== this.incomeCost) this.incomeCost = cost;
    if (cost > 0n && this.hush) this.hush = false; // цена есть → карточка+полоса вместе
    this.requestUpdate();
    if (this.phase === phase && canBuild) {
      this.clearBuildPoll();
      this.beginBuild(phase, cls);
    }
  }

  // минимальная цена + доступность для набора типов (скан spawn+border тайлов)
  private async probeBuild(
    types: readonly PlayerBuildableUnitType[],
  ): Promise<{ cost: bigint; canBuild: boolean }> {
    const p = this.game?.myPlayer();
    let cost = 0n;
    let canBuild = false;
    if (!p) return { cost, canBuild };
    try {
      const tiles: TileRef[] = [];
      if (this.spawnTile !== null) tiles.push(this.spawnTile);
      const { borderTiles } = await p.borderTiles();
      let i = 0;
      for (const t of borderTiles) {
        tiles.push(t);
        if (++i >= 10) break;
      }
      for (const t of tiles) {
        const bs = await p.buildables(t, types);
        for (const b of bs) {
          if (b.cost > 0n && (cost === 0n || b.cost < cost)) cost = b.cost;
          if (b.canBuild !== false) canBuild = true;
        }
      }
    } catch {
      // ignore
    }
    return { cost, canBuild };
  }

  // income → incomeExplain: построил первое → объяснение. Показываем 10с, потом
  // ПРИНУДИТЕЛЬНО ведём строить ДРУГОЕ (или кнопкой раньше).
  private toIncomeExplain() {
    this.phase = "incomeExplain";
    this.pause(false);
    this.clearBuildClasses();
    this.clearBuildPoll();
    window.setTimeout(() => {
      if (this.phase === "incomeExplain") this.toIncome2();
    }, 10000);
    this.requestUpdate();
  }

  // incomeExplain → income2: просим построить ДРУГОЕ; копим золото → пауза+мигание.
  private toIncome2 = () => {
    this.phase = "income2";
    this.pause(false);
    this.clearBuildClasses();
    this.revealFullHud();
    this.hush = true; // баннер+полоса вместе
    this.incomeCost = 0n;
    const other =
      this.incomeFirst === UnitType.Factory ? UnitType.Port : UnitType.Factory;
    const cls = other === UnitType.Port ? "tut-port" : "tut-factory";
    this.clearBuildPoll();
    window.setTimeout(() => {
      if (this.phase !== "income2") return;
      this.buildPoll = window.setInterval(
        () => void this.checkIncomeAfford("income2", [other], cls),
        600,
      );
    }, 1200);
    this.requestUpdate();
  };

  // income2 → incomeExplain2: построил второе → объясняем 10с, потом к бункеру.
  private toIncomeExplain2() {
    this.phase = "incomeExplain2";
    this.pause(false);
    this.clearBuildClasses();
    this.clearBuildPoll();
    window.setTimeout(() => {
      if (this.phase === "incomeExplain2") this.toBunker();
    }, 10000);
    this.requestUpdate();
  }

  // income → fillLetter: доход построен. Ждём, пока игрок займёт ВСЮ свою букву
  // (буквы — отдельные острова; свободной суши у границы не осталось → занял).
  private toFillLetter = () => {
    this.phase = "fillLetter";
    this.pause(false);
    this.revealFullHud();
    this.breather(2000); // дать увидеть построенную фабрику/порт
    this.clearBuildPoll();
    this.buildPoll = window.setInterval(
      () => void this.checkLetterFilled(),
      1000,
    );
    this.requestUpdate();
  };

  private async checkLetterFilled() {
    if (this.phase !== "fillLetter") return;
    const free = await this.freeLandCount();
    if (this.phase === "fillLetter" && free === 0) this.toShip();
  }

  // Сколько СВОБОДНОЙ (ничьей) суши примыкает к границе игрока. 0 = букву заняли.
  private async freeLandCount(): Promise<number> {
    const me = this.game?.myPlayer();
    if (!me) return 1;
    try {
      const { borderTiles } = await me.borderTiles();
      let free = 0;
      for (const tile of borderTiles) {
        for (const n of this.game.neighbors(tile)) {
          if (!this.game.isLand(n)) continue; // воду не считаем
          if (!this.game.hasOwner(n)) free++;
        }
      }
      return free;
    } catch {
      return 1;
    }
  }

  // fillLetter → ship: высадка на соседний остров. Открыть меню действий на земле
  // за морем → корабль (морская атака). Ждём SendBoatAttackIntentEvent.
  private toShip() {
    this.phase = "ship";
    this.pause(false);
    this.clearBuildClasses();
    document.body.classList.add("tut-ship"); // → мигаем «Корабль» в радиале
    this.revealFullHud();
    this.shipSeen = false;
    this.clearBuildPoll();
    // realtime % войск в лодке: если игрок двигает ползунок — обновляем карточку
    this.clearRatioPoll();
    this.ratioPoll = window.setInterval(() => {
      if (this.phase !== "ship") return this.clearRatioPoll();
      this.requestUpdate();
    }, 300);
    this.requestUpdate();
  }

  // ship → shipWarning: корабль отправлен. Отдельной карточкой (не флудим в одну)
  // предупреждаем про лимит транспортов и варшипы. Параллельно ловим ВЫСАДКУ
  // (кол-во транспортов было ≥1 и стало 0) → шаг «бункер».
  private toShipWarning() {
    this.phase = "shipWarning";
    this.pause(false);
    document.body.classList.remove("tut-ship"); // корабль отправлен — гасим мигание
    this.clearBuildPoll();
    this.buildPoll = window.setInterval(() => this.checkShipLanded(), 700);
    this.requestUpdate();
  }

  private checkShipLanded() {
    if (this.phase !== "shipWarning") return;
    const n = this.game?.myPlayer()?.units(UnitType.TransportShip).length ?? 0;
    if (n >= 1) this.shipSeen = true;
    if (this.shipSeen && n === 0) this.toIncome(); // после высадки → доход
  }

  // income2 → bunker: учим ставить бункер (DefensePost, клавиша 4). Копим золото
  // (полоса), пауза+мигание — ТОЛЬКО когда хватило (как у фабрики/города).
  private toBunker = () => {
    this.phase = "bunker";
    this.pause(false);
    this.clearBuildClasses();
    this.revealFullHud();
    this.incomeCost = 0n;
    this.hush = true; // баннер+полоса появятся вместе
    this.clearBuildPoll();
    window.setTimeout(() => {
      if (this.phase !== "bunker") return;
      this.buildPoll = window.setInterval(
        () =>
          void this.checkIncomeAfford(
            "bunker",
            [UnitType.DefensePost],
            "tut-defense",
          ),
        600,
      );
    }, 1200);
    this.requestUpdate();
  };

  // bunker → upgradeChoice: развилка «строить вширь vs апгрейдить в одной точке».
  // бункер построен → 5с полюбоваться, потом развилка «как строить».
  private onBunkerBuilt() {
    this.clearBuildClasses();
    this.clearBuildPoll();
    this.pause(false);
    this.breather(5000);
    window.setTimeout(() => {
      if (this.phase === "bunker") this.toUpgradeChoice();
    }, 5000);
  }

  private toUpgradeChoice() {
    this.phase = "upgradeChoice";
    this.clearBuildClasses();
    this.pause(true);
    this.clearBuildPoll();
    this.lockBtn(3000); // «Ок, понял» нельзя жать сразу — 3с на прочтение
    this.requestUpdate();
  }

  // upgradeChoice → upgrade: заставляем проапгрейдить город (город НА город = ур.2).
  // Копим золото на апгрейд (полоса ~250к), КАК ХВАТИТ → пауза+мигание кнопки города.
  private toUpgrade = () => {
    this.phase = "upgrade";
    this.clearBuildClasses();
    this.pause(false); // ВАЖНО: снять паузу с развилки — иначе золото не копится
    this.revealFullHud();
    this.baseCityLevels = this.cityLevels();
    this.upgradeCost = 0n;
    this.upgradeBuilding = false;
    this.clearBuildPoll();
    this.buildPoll = window.setInterval(
      () => void this.checkUpgradeStep(),
      700,
    );
    this.requestUpdate();
  };

  private cityLevels(): number {
    return this.game?.myPlayer()?.totalUnitLevels(UnitType.City) ?? 0;
  }

  private async checkUpgradeStep() {
    if (this.phase !== "upgrade") return;
    const p = this.game?.myPlayer();
    if (!p) return;
    // (a) апгрейд случился? суммарные уровни выросли И > числа городов (есть ур.2+)
    const levels = this.cityLevels();
    if (
      levels > this.baseCityLevels &&
      levels > p.units(UnitType.City).length
    ) {
      this.clearBuildPoll();
      this.clearBuildClasses();
      this.pause(false);
      this.breather(5000); // 5с полюбоваться городом ур.2, потом каталог
      window.setTimeout(() => {
        if (this.phase === "upgrade") this.toCatalog();
      }, 5000);
      return;
    }
    // (b) цена апгрейда (buildables по тайлу города) + доступность → пауза+мигание
    if (this.spawnTile === null) return;
    try {
      const bs = await p.buildables(this.spawnTile, [UnitType.City]);
      const city = bs.find((b) => b.type === UnitType.City);
      if (city && city.cost > 0n) {
        if (city.cost !== this.upgradeCost) this.upgradeCost = city.cost;
        const affordable = (p.gold() ?? 0n) >= city.cost;
        if (affordable && !this.upgradeBuilding) {
          this.upgradeBuilding = true;
          this.beginBuild("upgrade", "tut-city");
        }
      }
    } catch {
      // ignore
    }
    this.requestUpdate();
  }

  // upgrade → catalog: ОБЯЗАТЕЛЬНО читаем про остальные здания (без пропуска).
  private toCatalog() {
    this.catIndex = 0;
    this.phase = "catalog";
    this.clearBuildClasses();
    this.pause(true);
    this.clearBuildPoll();
    this.requestUpdate();
  }

  // catalog → graduation: поздравляем + выбор (остаться / в живой матч).
  private toGraduation = () => {
    this.phase = "graduation";
    this.pause(true);
    this.requestUpdate();
  };

  // «В живой матч» — выходим на главную и открываем окно создания лобби; игрок сам
  // настроит и нажмёт СТАРТ (флаг читает GameModeSelector после загрузки главной).
  private startLiveMatch = () => {
    markTutorialDone(); // дошёл до финала — предложение обучения больше не нужно
    try {
      sessionStorage.setItem("terron-open-host", "1");
    } catch {
      // ignore
    }
    // Внутри площадки — без перезагрузки (требование модерации GamePush).
    void import("../../SoftNavigate").then(({ softHome }) => {
      if (softHome("/")) return;
      window.location.href = "/";
    });
  };

  private catNext = () => {
    if (this.catIndex < UNIT_CATALOG.length - 1) this.catIndex += 1;
    this.requestUpdate();
  };

  private catPrev = () => {
    if (this.catIndex > 0) this.catIndex -= 1;
    this.requestUpdate();
  };

  // Показать игровой HUD, но НЕ карточку старого spawn-tutorial (он в HUD_TAGS).
  // В обучении чат и лидерборд (с выбором отображаемых групп) не нужны и мешают —
  // держим их скрытыми ВСЕГДА, даже когда раскрываем полный HUD для шага постройки.
  private static ALWAYS_HIDDEN = [
    "chat-display",
    "leader-board",
    "spawn-tutorial",
  ];

  private revealFullHud() {
    this.hideHud(false);
    for (const tag of TutorialCards.ALWAYS_HIDDEN) {
      document
        .querySelectorAll(tag)
        .forEach((el) => el.classList.add(HUD_HIDE_CLASS));
    }
  }

  private finishTutorial = () => {
    markTutorialDone();
    this.clearRatioPoll();
    this.clearContactPoll();
    this.stopMarkerLoop();
    this.stopBotScan();
    this.clearBuildPoll();
    this.clearDeathWatch();
    this.clearBuildClasses(); // снять tut-* (в т.ч. tut-ship) — иначе мигание зависнет
    if (this.contactDelayTimer) {
      clearTimeout(this.contactDelayTimer);
      this.contactDelayTimer = 0;
    }
    this.hush = false;
    this.contactPoint = null;
    this.clearBuildClasses();
    this.highlightBottomMenu(false);
    this.pause(false);
    this.active = false;
    this.hideHud(false);
    document
      .querySelectorAll("spawn-tutorial")
      .forEach((el) => el.classList.add(HUD_HIDE_CLASS));
    this.requestUpdate();
  };

  private restart = async () => {
    const ok = await confirmDialog(
      L("Начать обучение заново?", "Restart the tutorial?"),
      L("Заново", "Restart"),
      L("Отмена", "Cancel"),
    );
    if (!ok) return;
    toast(L("Загрузка…", "Loading…"), "info");
    // terron: мягкий рестарт (launchTutorial поверх живой игры) оставлял хвосты
    // прежней сессии — перезагружаем страницу целиком на /tutorial (авто-старт
    // обучения в Main.handleUrl). Чистый старт без остаточного состояния.
    const onTut = /^\/(?:w\d+\/)?tutorial\/?$/.test(window.location.pathname);
    // ⚠️ Внутри площадки перезагрузка запрещена (переинициализирует их SDK —
    // прелоадер и потеря синхронизации). Там уходим мягко и запускаем обучение
    // поверх чистого меню; вне площадки — прежний чистый рестарт страницей.
    void import("../../SoftNavigate").then(({ softGo }) => {
      // softGo, а не softHome: адрес /tutorial мало поставить — Main по нему
      // ЗАПУСКАЕТ песочницу (handleUrl), иначе внутри площадки рестарт просто
      // бросал бы игрока в меню.
      if (softGo("/tutorial")) return;
      if (onTut) window.location.reload();
      else window.location.href = "/tutorial";
    });
  };

  // мышь с подсвеченной кнопкой: left → левая красная, иначе правая красная
  private mouseGlyph(left = true): TemplateResult {
    return html`<svg
      width="20"
      height="28"
      viewBox="0 0 20 28"
      style="flex:none"
    >
      <rect
        x="1.5"
        y="1.5"
        width="17"
        height="25"
        rx="8.5"
        fill="#0f172a"
        stroke="#94a3b8"
        stroke-width="1.4"
      />
      <path
        d="M10 2.4 L5 2.4 A6 6 0 0 0 2 7 L2 12.5 L10 12.5 Z"
        fill=${left ? RED : "#475569"}
      />
      <path
        d="M10 2.4 L15 2.4 A6 6 0 0 1 18 7 L18 12.5 L10 12.5 Z"
        fill=${left ? "#475569" : RED}
      />
      <line
        x1="10"
        y1="2.4"
        x2="10"
        y2="12.5"
        stroke="#0f172a"
        stroke-width="1.4"
      />
      <line
        x1="2"
        y1="12.5"
        x2="18"
        y2="12.5"
        stroke="#0f172a"
        stroke-width="1.4"
      />
    </svg>`;
  }

  // маленькая клавиша-кэп для десктопных подсказок («Клавиша 1»)
  private keyCap(k: string): TemplateResult {
    return html`<span class="tut-key">${k}</span>`;
  }

  // attack=true → это шаг АТАКИ: на телефоне атака = тап по земле → тап по 🗡️ в
  // центре радиала (ключ spawn_tut.tap_attack). Обычный «захват» земли = spawn_tut.tap.
  private clickHint(attack = false): TemplateResult {
    const glyph = isMobile()
      ? html`<span style="font-size:18px;line-height:1;flex:none">👆</span>`
      : this.mouseGlyph();
    const text = isMobile()
      ? translateText(attack ? "spawn_tut.tap_attack" : "spawn_tut.tap")
      : translateText("spawn_tut.left_click");
    return html`<span class="ci">${glyph}<span>${text}</span></span>`;
  }

  // Шаги, где игрок атакует по карте (расширяется/атакует/жрёт племена) — на них
  // мигаем центральной кнопкой (меч) в WebGL-радиале, как «Стройка»/«Корабль».
  private static ATTACK_PHASES = new Set<Phase>([
    "expand",
    "expandMore",
    "attackNow",
    "tribes",
  ]);

  updated() {
    const wantAttack =
      this.active && TutorialCards.ATTACK_PHASES.has(this.phase);
    document.body.classList.toggle("tut-attack", wantAttack);
    // tut-active — пока идёт обучение: по нему опускаем баннер «игра приостановлена»
    // (HeadsUpMessage) на телефоне, чтобы он не прятался ПОД верхними карточками.
    document.body.classList.toggle("tut-active", this.active);
    this.positionCorner();
  }

  // Пауза/рестарт (.tut-corner) на телефоне должны стоять ПОД верхней карточкой-
  // действием, а не залезать на неё. Высота карточки динамическая → меряем её и
  // ставим угол по нижней кромке. Обе в координатах вьюпорта (.tut-corner=fixed,
  // карточка=absolute внутри .tut-root fixed inset:0), поэтому getBoundingClientRect
  // → top напрямую. Нет верхней карточки (центр-модалка/низ-полоса) или десктоп →
  // сбрасываем inline, CSS ставит угол в верх-слева.
  private positionCorner() {
    const corner = this.querySelector<HTMLElement>(".tut-corner");
    if (!corner) return;
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const topCard = this.querySelector<HTMLElement>(
      ".tut-tr, .tut-top, .tut-banner",
    );
    if (mobile && topCard) {
      const bottom = topCard.getBoundingClientRect().bottom;
      corner.style.top = `${Math.round(bottom) + 8}px`;
      corner.style.bottom = "auto";
    } else {
      corner.style.top = "";
      corner.style.bottom = "";
    }
  }

  render() {
    if (!this.active) return nothing;
    // hush — короткий «вздох» без карточки, чтобы игрок увидел новое состояние
    const card = this.hush ? nothing : this.renderPhase();
    return html`${this.styles()}${card}${this.renderCorner()}`;
  }

  private renderPhase(): TemplateResult {
    switch (this.phase) {
      case "intro":
        return this.renderIntro();
      case "cards":
        return this.renderCards();
      case "spawnInfo":
        return this.renderSpawnInfo();
      case "spawnClick":
        return this.renderSpawnClick();
      case "expand":
        return this.renderExpand();
      case "ratioSet":
        return this.renderRatioSet();
      case "attackNow":
        return this.renderAttackNow();
      case "lesson":
        return this.renderLesson();
      case "ratioBack":
        return this.renderRatioBack();
      case "recover":
        return this.renderRecover();
      case "expandMore":
        return this.renderExpandMore();
      case "contact":
        return this.renderContact();
      case "tribes":
        return this.renderTribes();
      case "awaitBuild":
        return this.renderAwaitBuild();
      case "buildCity":
        return this.renderBuildCity();
      case "income":
        return this.renderIncome();
      case "incomeExplain":
        return this.renderIncomeExplain(this.incomeFirst);
      case "income2":
        return this.renderIncome2();
      case "incomeExplain2":
        return this.renderIncomeExplain(
          this.incomeFirst === UnitType.Factory
            ? UnitType.Port
            : UnitType.Factory,
        );
      case "fillLetter":
        return this.renderFillLetter();
      case "ship":
        return this.renderShip();
      case "shipWarning":
        return this.renderShipWarning();
      case "bunker":
        return this.renderBunker();
      case "upgradeChoice":
        return this.renderUpgradeChoice();
      case "upgrade":
        return this.renderUpgrade();
      case "graduation":
        return this.renderGraduation();
      case "catalog":
        return this.renderCatalog();
      case "dead":
        return this.renderDead();
    }
  }

  private renderDead() {
    return html`
      <div class="tut-root cards">
        <div class="tut-msg tut-dead">
          <h4>${L("Ты погиб в обучении", "You died in the tutorial")}</h4>
          <p class="tut-body">
            ${L(
              "Так тоже бывает — тебя съели. Ничего страшного, это тренировка. Перезапустим?",
              "It happens — you got eaten. No worries, it’s just practice. Restart?",
            )}
          </p>
          <button class="tut-btn ok" @click=${this.restart}>
            ${L("Перезапустить", "Restart")}
          </button>
        </div>
      </div>
    `;
  }

  private renderCorner() {
    return html`
      <div class="tut-corner">
        ${this.paused
          ? html`<button
              class="tut-resume"
              title=${L("Продолжить", "Resume")}
              @click=${this.forceUnpause}
            >
              <span class="dot"></span>${L("Пауза", "Paused")}
              <span class="tut-resume-play">▶</span>
            </button>`
          : nothing}
        <button class="tut-restart" @click=${this.restart}>
          ${L("Рестарт", "Restart")}
        </button>
      </div>
    `;
  }

  private renderIntro() {
    return html`
      <div class="tut-root cards">
        <div class="tut-msg">
          <h4>${L("Привет, завоеватель!", "Hello, conqueror!")}</h4>
          <p class="tut-body">
            ${L(
              "Это игра про захват территорий. Ты растёшь из маленькой точки в империю, которая должна пожрать весь мир. Другие игроки и боты заняты тем же.",
              "This is a game about conquering territory. You grow from a tiny dot into an empire that must devour the whole world. Other players and bots are doing the same.",
            )}
          </p>
          <p class="tut-body">
            ${L(
              "Сейчас объясним базовые механики. Начнём с выбора места для появления — погнали.",
              "We’ll walk you through the basics. Let’s start by choosing where to spawn — let’s go.",
            )}
          </p>
          <div class="tut-nav">
            <button class="tut-btn ok" @click=${this.introDone}>
              ${L("Погнали", "Let’s go")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderCards() {
    const c = CARDS[this.index];
    const isFirst = this.index === 0;
    const isLast = this.index === CARDS.length - 1;
    return html`
      <div class="tut-root cards">
        <div class="tut-polaroid">
          <div class="tut-window"></div>
          <div class="tut-caption">
            <div class="tut-progress">
              ${CARDS.map(
                (_, i) =>
                  html`<span
                    class="tut-dot ${i === this.index ? "on" : ""}"
                  ></span>`,
              )}
            </div>
            <p class="tut-title" style="color:${c.accent}">${c.title()}</p>
            <p class="tut-body">${c.body()}</p>
            <div class="tut-nav">
              <button
                class="tut-btn back"
                ?disabled=${isFirst}
                @click=${this.back}
              >
                ${L("Назад", "Back")}
              </button>
              <button class="tut-btn ok" @click=${this.next}>
                ${isLast ? L("Дальше", "Next") : L("Ок", "OK")}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderSpawnInfo() {
    return html`
      <div class="tut-root cards">
        <div class="tut-msg">
          <h4>${L("Выбери свободное место", "Choose a free spot")}</h4>
          <div class="tut-hint">
            <div class="tut-hint-dots">
              <span class="rd"></span><span class="rd"></span
              ><span class="rd"></span>
            </div>
            <p>
              ${L(
                "Точки на карте — это нации и игроки. Не тыкай на них — это им не нравится.",
                "The dots are nations and players. Don’t click them — they don’t like it.",
              )}
            </p>
          </div>
          <p class="tut-body">
            ${L("Строй у ", "Build near ")}<b style="color:${WATER}"
              >${L("воды", "water")}</b
            >${L(" — рядом ставят ", " — you can place a ")}${portGlyph}${L(
              " порт, он приносит золото.",
              " port for gold.",
            )}
          </p>
          <div class="tut-nav">
            <button class="tut-btn back" @click=${this.spawnInfoBack}>
              ${L("Назад", "Back")}
            </button>
            <button class="tut-btn ok" @click=${this.spawnInfoOk}>
              ${L("Ок", "OK")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderSpawnClick() {
    return html`
      <div class="tut-root pass">
        <div class="tut-banner">
          <span
            >${L(
              "Займи свободную землю — и поскорее:",
              "Grab a free patch of land — quickly:",
            )}</span
          >
          ${this.clickHint()}
        </div>
      </div>
    `;
  }

  private renderExpand() {
    const left = Math.max(0, EXPAND_CLICKS - this.attacks);
    const pct = Math.min(100, Math.round((this.attacks / EXPAND_CLICKS) * 100));
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4>${translateText("spawn_tut.expand_title")}</h4>
          <p class="tut-body">
            ${translateText(
              isMobile() ? "spawn_tut.expand_sub_m" : "spawn_tut.expand_sub",
            )}
          </p>
          <div class="tut-clickrow">
            ${this.clickHint(true)}
            <span class="tut-count">${this.attacks}/${EXPAND_CLICKS}</span>
          </div>
          <div class="tut-prog-row">
            <div class="tut-prog"><i style="width:${pct}%"></i></div>
          </div>
          ${this.clickCostLine()}
          ${left > 0
            ? nothing
            : html`<p class="tut-body">
                ${translateText("spawn_tut.expand_continue")}
              </p>`}
        </div>
      </div>
    `;
  }

  private renderRatioSet() {
    const pct = Math.round(this.ratio() * 100);
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-br tut-ratio">
          <h4>${L("Сколько войск в атаке", "Attack strength")}</h4>
          <p class="tut-body">
            ${L(
              "Ползунок ниже — сейчас ",
              "The slider below — now ",
            )}<b>${pct}%</b>${L(
              " войск идёт в атаку. Для примера ",
              " of troops attack. For this demo ",
            )}<b style="color:${RED}"
              >${L("перетащи его на 100%", "drag it to 100%")}</b
            >.
          </p>
        </div>
      </div>
    `;
  }

  private renderRatioBack() {
    const pct = Math.round(this.ratio() * 100);
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-br tut-ratio">
          <h4>${L("Верни назад", "Set it back")}</h4>
          <p class="tut-body">
            ${L("Сейчас ", "Now ")}<b>${pct}%</b>.
            ${L(
              "Верни ползунок примерно на ",
              "Drag the slider back to about ",
            )}<b style="color:${GREEN}">20%</b>${L(
              " — так безопаснее.",
              " — that’s safer.",
            )}
          </p>
        </div>
      </div>
    `;
  }

  private renderRecover() {
    const t = Math.floor(this.game?.myPlayer()?.troops() ?? 0);
    const pct = Math.min(100, (t / RECOVER_TROOPS) * 100);
    // root=pass → НЕ блокируем зум/пан. Попытку атаки ловим в onAttack → мигаем.
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4>${L("Мы совершили ошибку", "That was a mistake")}</h4>
          <p class="tut-body">
            ${L(
              "Слили все войска. Давай восстановим армию и больше так не делаем — подожди, НЕ отправляй войска.",
              "We spent all our troops. Let’s rebuild the army and not do that again — wait, DON’T send troops.",
            )}
          </p>
          <div class="tut-prog-row">
            <span class="tut-costnum"
              ><span class="tut-soldier-wrap">${soldierGlyph}</span
              >${renderTroops(t)} / ${renderTroops(RECOVER_TROOPS)}</span
            >
            <div class="tut-prog"><i style="width:${pct}%"></i></div>
          </div>
        </div>
      </div>
    `;
  }

  private renderExpandMore() {
    if (this.expandMoreDone) return nothing as unknown as TemplateResult;
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4>${L("Продолжай расширяться", "Keep expanding")}</h4>
          <p class="tut-body">
            ${L(
              "Захватывай землю вокруг, пока не упрёшься в соседа.",
              "Capture land around you until you meet a neighbor.",
            )}
          </p>
          <div class="tut-clickrow">${this.clickHint(true)}</div>
          <p class="tut-wait">
            <span class="tut-soldier-wrap">${soldierGlyph}</span>
            ${L(
              "Не спеши: дай войскам накопиться и посылай их аккуратно, а не спамь кликами.",
              "Don’t rush: let troops build up and send them deliberately — don’t spam clicks.",
            )}
          </p>
        </div>
      </div>
    `;
  }

  // «Каждый клик — 20% (504 🪖)». Процент/число читаем живьём из панели (this.ratio),
  // фолбэк — CLICK_RATIO. Число = доля × текущие войска, формат как в нижнем меню.
  private clickCostLine(): TemplateResult {
    const r = this.ratio();
    const ratio = r > 0 ? r : CLICK_RATIO;
    const troops = this.game?.myPlayer()?.troops() ?? 0;
    const cost = Math.round(troops * ratio);
    const pct = Math.round(ratio * 100);
    // на телефоне атака = тап по 🗡️ в центре радиала → показываем иконку атаки,
    // а не «клик» (мыши на телефоне нет).
    const each = isMobile()
      ? html`${L("Каждый ", "Each ")}<span class="tut-atk-ic">🗡️</span>${L(
            " — ",
            " — ",
          )}`
      : L("Каждый клик — ", "Each click — ");
    return html`<p class="tut-cost">
      ${each}<b>${pct}%</b>${L(" войск ", " of troops ")}<span
        class="tut-costnum"
        >${renderTroops(cost)}<span class="tut-soldier-wrap"
          >${soldierGlyph}</span
        ></span
      >
    </p>`;
  }

  private renderContact() {
    return html`
      <div class="tut-marker" style="opacity:0">
        <span class="tut-marker-ring"></span>
        <span class="tut-marker-badge">${swordGlyph}</span>
        <span class="tut-marker-label">${L("Сосед", "Neighbor")}</span>
      </div>
      <div class="tut-root cards">
        <div class="tut-msg tut-contact">
          <h4>${L("Ты встретил соседа!", "You’ve met a neighbor!")}</h4>
          <p class="tut-body tut-sub">
            ${L("У тебя два выбора:", "You have two choices:")}
          </p>
          <div class="tut-cols">
            <div class="tut-col grow">
              <div class="tut-col-h">
                <span class="tut-choice-ic grow">${growGlyph}</span>
                ${L("Расширяться в свободную зону", "Expand into open land")}
              </div>
              <ul>
                <li>${L("Безопасно", "Safe")}</li>
                <li>${L("Дешевле по войскам", "Cheaper on troops")}</li>
              </ul>
            </div>
            <div class="tut-col eat">
              <div class="tut-col-h">
                <span class="tut-choice-ic eat">${swordGlyph}</span>
                ${L("Атаковать соседа", "Attack the neighbor")}
              </div>
              <ul>
                <li>${L("Может ответить", "They may fight back")}</li>
                <li>${L("Тратит войска на войну", "Spends troops on war")}</li>
                <li class="gold">
                  <span class="tut-coin-wrap">${coinGlyph}</span>
                  ${L(
                    "Победишь — получишь МНОГО золота!",
                    "Win — and get LOTS of gold!",
                  )}
                </li>
              </ul>
            </div>
          </div>
          <div class="tut-nav">
            <button
              class="tut-btn ok"
              ?disabled=${this.btnLocked()}
              @click=${this.toTribes}
            >
              ${this.btnLocked()
                ? html`${L("Я выбрал", "I’ve chosen")}
                  (${Math.ceil((this.btnReadyAt - Date.now()) / 1000)})`
                : L("Я выбрал", "I’ve chosen")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderTribes() {
    const eaten = Math.min(this.tribesEaten, TRIBES_REQUIRED);
    const pct = (eaten / TRIBES_REQUIRED) * 100;
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4>${L("Атакуй племена", "Attack the tribes")}</h4>
          <p class="tut-body">
            ${L(
              "Захватывай земли соседних племён (серые рядом) — за это дают золото ",
              "Capture neighboring tribes’ land (the grey ones nearby) — it gives gold ",
            )}<span class="tut-coin-wrap">${coinGlyph}</span>.
          </p>
          <div class="tut-tip">
            <span class="tut-coin-wrap">${coinGlyph}</span>
            ${L(
              "В настоящей игре спавнись ПОБЛИЖЕ к племенам — успеешь захватить их золото первым.",
              "In a real match, spawn CLOSE to tribes — grab their gold before anyone else.",
            )}
          </div>
          <div class="tut-prog-row">
            <span class="tut-count">${eaten}/${TRIBES_REQUIRED}</span>
            <div class="tut-prog"><i style="width:${pct}%"></i></div>
          </div>
        </div>
      </div>
    `;
  }

  private renderAwaitBuild() {
    const gold = this.game?.myPlayer()?.gold() ?? 0n;
    const cost = this.cityCost;
    const pct = cost > 0n ? Math.min(100, Number((gold * 100n) / cost)) : 0;
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4>${L("Продолжай захватывать!", "Keep capturing!")}</h4>
          <p class="tut-body">
            ${L(
              "Чем больше территория — тем быстрее растут войска и выше их предел.",
              "The bigger your territory, the faster troops are made and the higher their cap.",
            )}
          </p>
          ${cost > 0n
            ? html`<div class="tut-prog-row">
                <span class="tut-costnum"
                  ><span class="tut-coin-wrap">${coinGlyph}</span
                  >${renderNumber(gold)} / ${renderNumber(cost)}</span
                >
                <span class="tut-count" style="font-weight:400"
                  >${L("на город", "for a city")}</span
                >
                <div class="tut-prog"><i style="width:${pct}%"></i></div>
              </div>`
            : nothing}
        </div>
      </div>
    `;
  }

  private renderBuildCity() {
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4 class="tut-h4ic">
            ${L("Построй", "Build a")} ${chip(cityIconUrl)}
            <b style="color:${AMBER}">${L("город", "city")}</b>
          </h4>
          <p class="tut-body">
            ${L(
              "Поставь его на своей земле. Город поднимает предел населения и его рост.",
              "Place it on your territory. A city raises max population and its growth.",
            )}
          </p>
          <div class="tut-keyline">
            ${isMobile()
              ? html`👆 ${L("тап по своей земле", "tap your territory")}
                  <span class="tut-keyicons"
                    >${chip(buildIconUrl)} → ${chip(cityIconUrl)}</span
                  >`
              : html`${L("Клавиша", "Key")} ${this.keyCap("1")}`}
          </div>
        </div>
      </div>
    `;
  }

  private renderIncome() {
    const gold = this.game?.myPlayer()?.gold() ?? 0n;
    const cost = this.incomeCost;
    const pct = cost > 0n ? Math.min(100, Number((gold * 100n) / cost)) : 0;
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4>${L("Теперь — доход", "Now — income")}</h4>
          <p class="tut-body">
            ${L("Построй ", "Build a ")}${chip(factoryIconUrl)}
            <b>${L("фабрику", "factory")}</b> ${L("или", "or")}
            ${chip(portIconUrl)} <b>${L("порт", "port")}</b>${L(
              " — они дают золото ",
              " — they give gold ",
            )}<span class="tut-coin-wrap">${coinGlyph}</span>.
          </p>
          <p class="tut-body">
            ${L(
              "Фабрику ставь так, чтобы соединить свои здания рельсами.",
              "Place the factory so it links your buildings by rails.",
            )}
          </p>
          ${cost > 0n
            ? html`<div class="tut-prog-row">
                <span class="tut-costnum"
                  ><span class="tut-coin-wrap">${coinGlyph}</span
                  >${renderNumber(gold)} / ${renderNumber(cost)}</span
                >
                <div class="tut-prog"><i style="width:${pct}%"></i></div>
              </div>`
            : nothing}
          <div class="tut-keyline">
            ${isMobile()
              ? html`👆 ${L("тап по своей земле", "tap your territory")}
                  <span class="tut-keyicons"
                    >${chip(buildIconUrl)} → ${chip(factoryIconUrl)} /
                    ${chip(portIconUrl)}</span
                  >`
              : html`${L("Клавиши", "Keys")} ${this.keyCap("2")}
                ${this.keyCap("3")}`}
          </div>
        </div>
      </div>
    `;
  }

  private renderIncomeExplain(type: UnitType | null) {
    const isFactory = type === UnitType.Factory;
    const next =
      this.phase === "incomeExplain2" ? this.toBunker : this.toIncome2;
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4 class="tut-h4ic">
            ${chip(isFactory ? factoryIconUrl : portIconUrl)}
            <b>${isFactory ? L("Фабрика", "Factory") : L("Порт", "Port")}</b>
          </h4>
          <p class="tut-body">
            ${isFactory
              ? html`${chip(factoryIconUrl)}${L(
                    " Фабрики соединяются рельсами с городами и портами и приносят золото ",
                    " Factories link by rails to cities and ports and bring gold ",
                  )}<span class="tut-coin-wrap">${coinGlyph}</span>${L(
                    ". Больше связей — больше дохода.",
                    ". More links, more income.",
                  )}`
              : html`${L("Порт шлёт ", "The port sends ")}${chip(
                    boatIconUrl,
                  )}${L(
                    " торговые корабли к чужим портам — каждый возвращается с золотом ",
                    " trade ships to other players’ ports — each returns with gold ",
                  )}<span class="tut-coin-wrap">${coinGlyph}</span>${L(
                    ". Дальше маршрут — больше золота.",
                    ". The longer the route, the more gold.",
                  )}`}
          </p>
          <div class="tut-nav">
            <button class="tut-btn ok" @click=${next}>
              ${L("Понятно", "Got it")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderIncome2() {
    const isPort = this.incomeFirst === UnitType.Factory;
    const gold = this.game?.myPlayer()?.gold() ?? 0n;
    const cost = this.incomeCost;
    const pct = cost > 0n ? Math.min(100, Number((gold * 100n) / cost)) : 0;
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4 class="tut-h4ic">
            ${L("Теперь построй", "Now build")}
            ${chip(isPort ? portIconUrl : factoryIconUrl)}
            <b>${isPort ? L("порт", "a port") : L("фабрику", "a factory")}</b>
          </h4>
          <p class="tut-body">
            ${L(
              "Второе здание дохода — больше золота.",
              "Your second income building — more gold.",
            )}
          </p>
          ${isPort
            ? nothing
            : html`<p class="tut-body">
                ${L(
                  "Фабрику ставь так, чтобы соединить свои здания рельсами.",
                  "Place the factory so it links your buildings by rails.",
                )}
              </p>`}
          ${cost > 0n
            ? html`<div class="tut-prog-row">
                <span class="tut-costnum"
                  ><span class="tut-coin-wrap">${coinGlyph}</span
                  >${renderNumber(gold)} / ${renderNumber(cost)}</span
                >
                <div class="tut-prog"><i style="width:${pct}%"></i></div>
              </div>`
            : nothing}
          <div class="tut-keyline">
            ${isMobile()
              ? html`👆 ${L("тап по своей земле", "tap your territory")}
                  <span class="tut-keyicons"
                    >${chip(buildIconUrl)} →
                    ${chip(isPort ? portIconUrl : factoryIconUrl)}</span
                  >`
              : html`${L("Клавиша", "Key")} ${this.keyCap(isPort ? "3" : "2")}`}
          </div>
        </div>
      </div>
    `;
  }

  private renderFillLetter() {
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4>${L("Займи всю свою букву", "Fill your whole letter")}</h4>
          <p class="tut-body">
            ${L(
              "Расширяйся до края острова — забери всю свободную сушу своей буквы.",
              "Expand to the island’s edge — take all the free land of your letter.",
            )}
          </p>
          <div class="tut-clickrow">${this.clickHint()}</div>
        </div>
      </div>
    `;
  }

  private renderShip() {
    const r = this.ratio();
    const ratio = r > 0 ? r : CLICK_RATIO;
    const troops = this.game?.myPlayer()?.troops() ?? 0;
    const perBoat = Math.round(troops * ratio);
    const pct = Math.round(ratio * 100);
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4>
            ${L("Высадись на соседний остров", "Land on a neighboring island")}
          </h4>
          <p class="tut-body">
            ${L(
              "Открой меню действий на земле за морем и выбери ",
              "Open the action menu on land across the sea and pick the ",
            )}${chip(boatIconUrl)} <b>${L("корабль", "ship")}</b>.
          </p>
          <p class="tut-cost">
            ${L("В лодке — ", "Each boat carries — ")}<b>${pct}%</b>${L(
              " войск ",
              " of troops ",
            )}<span class="tut-costnum"
              >${renderTroops(perBoat)}<span class="tut-soldier-wrap"
                >${soldierGlyph}</span
              ></span
            >
          </p>
          <div class="tut-clickrow">
            <span>${L("Открыть меню:", "Open the menu:")}</span>
            ${isMobile()
              ? html`<span class="ci"
                  ><span style="font-size:18px;line-height:1;flex:none"
                    >👆</span
                  >
                  <span
                    >${L(
                      "тап по земле за морем",
                      "tap land across the sea",
                    )}</span
                  >
                  <span style="opacity:.7;flex:none">→</span>
                  ${chip(boatIconUrl)}</span
                >`
              : html`<span class="ci"
                  >${this.mouseGlyph(false)}
                  <span>${L("правый клик", "right-click")}</span></span
                >`}
          </div>
        </div>
      </div>
    `;
  }

  private renderShipWarning() {
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4>${L("Высадка пошла!", "Landing away!")}</h4>
          <p class="tut-body">
            ${L("Одновременно можно держать до ", "You can keep up to ")}<b
              >${SHIP_MAX}</b
            >
            ${chip(boatIconUrl)}
            ${L("кораблей", "ships")}${L(
              ". Их могут перехватить вражеские ",
              " at once. Enemy ",
            )}${chip(warshipIconUrl)}
            <b>${L("варшипы", "warships")}</b>${L(
              " (строятся в порту).",
              " (built at a port) can intercept them.",
            )}
          </p>
          <div class="tut-nav">
            <button class="tut-btn ok" @click=${this.toIncome}>
              ${L("Понятно", "Got it")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderBunker() {
    const gold = this.game?.myPlayer()?.gold() ?? 0n;
    const cost = this.incomeCost;
    const pct = cost > 0n ? Math.min(100, Number((gold * 100n) / cost)) : 0;
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4 class="tut-h4ic">
            ${L("Поставь", "Build a")} ${chip(defenseIconUrl)}
            <b style="color:${GREEN}">${L("бункер", "bunker")}</b>
            ${L("на границе", "on your border")}
          </h4>
          <p class="tut-body">
            ${L(
              "Годится и для защиты, и для наступления: в его радиусе враг тратит ",
              "Good for both defense and attack: within its radius the enemy spends ",
            )}<b style="color:${RED}">×5</b>${L(
              " войск на атаку и наступает втрое медленнее.",
              " troops to attack and advances 3× slower.",
            )}
          </p>
          ${cost > 0n
            ? html`<div class="tut-prog-row">
                <span class="tut-costnum"
                  ><span class="tut-coin-wrap">${coinGlyph}</span
                  >${renderNumber(gold)} / ${renderNumber(cost)}</span
                >
                <div class="tut-prog"><i style="width:${pct}%"></i></div>
              </div>`
            : nothing}
          <div class="tut-keyline">
            ${isMobile()
              ? html`👆 ${L("тап по своей земле", "tap your territory")}
                  <span class="tut-keyicons"
                    >${chip(buildIconUrl)} → ${chip(defenseIconUrl)}</span
                  >`
              : html`${L("Клавиша", "Key")} ${this.keyCap("4")}`}
          </div>
        </div>
      </div>
    `;
  }

  private renderUpgradeChoice() {
    return html`
      <div class="tut-root cards">
        <div class="tut-msg tut-contact">
          <h4>
            ${L("Ещё выбор: как строить", "One more choice: how to build")}
          </h4>
          <p class="tut-body tut-sub">
            ${L(
              "Здания можно ставить по-разному. Параметры одинаковые — вопрос в позиционке:",
              "You can place buildings two ways. Same stats — it’s about positioning:",
            )}
          </p>
          <div class="tut-cols">
            <div class="tut-col neutral">
              <div class="tut-col-h">
                <span class="tut-choice-ic neutral">${growGlyph}</span>
                ${L("Вширь — много зданий", "Wide — many buildings")}
              </div>
              <ul>
                <li>
                  ${L("Сложнее снести всё разом", "Hard to wipe all at once")}
                </li>
                <li>
                  ${L(
                    "Но защищать дорого — нужно много ПВО",
                    "But costly to defend — needs many SAMs",
                  )}
                </li>
              </ul>
            </div>
            <div class="tut-col neutral">
              <div class="tut-col-h">
                <span class="tut-choice-ic neutral">${chip(cityIconUrl)}</span>
                ${L("В точку — апгрейд (ур. 2+)", "Stacked — upgrade (lvl 2+)")}
              </div>
              <ul>
                <li>${L("Защищать проще", "Easier to defend")}</li>
                <li>
                  ${L(
                    "Но захватят или накроют залпом ракет",
                    "But can be captured or nuked by a missile salvo",
                  )}
                </li>
              </ul>
            </div>
          </div>
          <div class="tut-nav">
            <button
              class="tut-btn ok"
              ?disabled=${this.btnLocked()}
              @click=${this.toUpgrade}
            >
              ${this.btnLocked()
                ? html`${L("Ок, понял", "Got it")}
                  (${Math.ceil((this.btnReadyAt - Date.now()) / 1000)})`
                : L("Ок, понял", "Got it")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderUpgrade() {
    const gold = this.game?.myPlayer()?.gold() ?? 0n;
    const cost = this.upgradeCost;
    const pct = cost > 0n ? Math.min(100, Number((gold * 100n) / cost)) : 0;
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-tr">
          <h4 class="tut-h4ic">
            ${L("Прокачай", "Upgrade a")} ${chip(cityIconUrl)}
            <b style="color:${AMBER}">${L("город", "city")}</b>
          </h4>
          <p class="tut-body">
            ${L("Поставь ещё один город ", "Build another city ")}<b
              style="text-decoration:underline"
              >${L("ПОВЕРХ", "ON TOP")}</b
            >${L(
              " своего города — он станет уровня 2 (мигает снизу).",
              " of your existing city — it becomes level 2 (highlighted below).",
            )}
          </p>
          ${cost > 0n
            ? html`<div class="tut-prog-row">
                <span class="tut-costnum"
                  ><span class="tut-coin-wrap">${coinGlyph}</span
                  >${renderNumber(gold)} / ${renderNumber(cost)}</span
                >
                <div class="tut-prog"><i style="width:${pct}%"></i></div>
              </div>`
            : nothing}
          <div class="tut-keyline">
            ${isMobile()
              ? html`👆 ${L("тап по городу", "tap your city")}
                  <span class="tut-keyicons"
                    >${chip(buildIconUrl)} → ${chip(cityIconUrl)}</span
                  >`
              : html`${L("Клавиша", "Key")} ${this.keyCap("1")}`}
          </div>
        </div>
      </div>
    `;
  }

  private renderGraduation() {
    return html`
      <div class="tut-root cards">
        <div class="tut-msg tut-grad">
          <div class="tut-grad-badge">🎉</div>
          <h4>${L("Поздравляем!", "Congratulations!")}</h4>
          <p class="tut-body">
            ${L(
              "Ты выучил основы: расширение, войска, город и апгрейд, доход, границы, высадка и здания. Готов к реальным матчам!",
              "You’ve learned the basics: expansion, troops, cities and upgrades, income, borders, landings and buildings. Ready for real matches!",
            )}
          </p>
          <div class="tut-nav tut-nav-col">
            <button class="tut-btn green" @click=${this.startLiveMatch}>
              ${L("В живой матч", "Play a real match")}
            </button>
            <button class="tut-btn ok" @click=${this.finishTutorial}>
              ${L("Остаться в песочнице", "Stay in the sandbox")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderCatalog() {
    const item = UNIT_CATALOG[this.catIndex];
    const last = this.catIndex === UNIT_CATALOG.length - 1;
    return html`
      <div class="tut-root cards">
        <div class="tut-msg tut-catalog">
          <div class="tut-cat-head">
            <div class="tut-cat-icon"><img src=${item.icon} alt="" /></div>
            <div>
              <div class="tut-cat-title">${item.title()}</div>
              <div class="tut-cat-key">
                ${L("Клавиша", "Key")} ${this.keyCap(item.key)}
              </div>
            </div>
          </div>
          <p class="tut-body">
            ${item.desc()}${item.coin
              ? html` <span class="tut-coin-wrap">${coinGlyph}</span>`
              : nothing}
          </p>
          <div class="tut-cat-dots">
            ${UNIT_CATALOG.map(
              (_, i) =>
                html`<span
                  class="tut-dot ${i === this.catIndex ? "on" : ""}"
                ></span>`,
            )}
          </div>
          <div class="tut-nav">
            <button
              class="tut-btn back"
              ?disabled=${this.catIndex === 0}
              @click=${this.catPrev}
            >
              ${L("Назад", "Back")}
            </button>
            ${last
              ? html`<button class="tut-btn green" @click=${this.toGraduation}>
                  ${L("Готово", "Done")}
                </button>`
              : html`<button class="tut-btn ok" @click=${this.catNext}>
                  ${L("Дальше", "Next")}
                </button>`}
          </div>
        </div>
      </div>
    `;
  }

  private renderAttackNow() {
    return html`
      <div class="tut-root pass">
        <div class="tut-msg tut-top">
          <h4>${L("Теперь атакуй", "Now attack")}</h4>
          <p class="tut-body">
            ${isMobile()
              ? L(
                  "Тапни по соседней земле, потом по 🗡️ в центре — отправишь войска в атаку.",
                  "Tap neighboring land, then 🗡️ in the center to send your troops in.",
                )
              : L(
                  "Кликни по соседней земле — отправишь войска в атаку.",
                  "Click neighboring land to send your troops in.",
                )}
          </p>
          <div class="tut-clickrow">${this.clickHint(true)}</div>
        </div>
      </div>
    `;
  }

  private renderLesson() {
    return html`
      <div class="tut-root cards">
        <div class="tut-msg">
          <h4>${L("Отлично, ты молодец!", "Nice, well done!")}</h4>
          <div class="tut-yellow">
            ${L(
              "НО НИКОГДА ТАК НЕ ДЕЛАЙ без причины.",
              "BUT NEVER DO THIS without a reason.",
            )}
          </div>
          <p class="tut-body">
            ${L(
              "Теперь на базе не осталось войск, население не растёт, защита — ноль. В реальной игре тебя атакуют ",
              "Your base has no troops left, population won’t grow, defense is zero. In a real game they’ll attack you ",
            )}${swordGlyph}${L(
              " без промедления. Твои войска — твоя защита. Фактическая и психологическая.",
              " instantly. Your troops are your defense — real and psychological.",
            )}
          </p>
          <div class="tut-nav">
            <button
              class="tut-btn ok"
              ?disabled=${this.btnLocked()}
              @click=${this.toRatioBack}
            >
              ${this.btnLocked()
                ? html`${L("Дальше", "Next")}
                  (${Math.ceil((this.btnReadyAt - Date.now()) / 1000)})`
                : L("Дальше", "Next")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private styles(): TemplateResult {
    return html`
      <style>
        .tut-root {
          position: fixed;
          inset: 0;
          z-index: 3000;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: "Golos Text", system-ui, sans-serif;
          color: ${INK};
        }
        .tut-root.cards {
          pointer-events: auto;
        }
        .tut-root.pass {
          pointer-events: none;
        }
        .tut-polaroid {
          display: flex;
          flex-direction: column;
          transform: translateY(-3%);
        }
        .tut-window {
          width: min(76vw, 390px);
          height: min(76vw, 390px);
          box-sizing: border-box;
          background: transparent;
          border: 12px solid ${SHEET};
          border-bottom: 8px solid ${SHEET};
          box-shadow:
            0 0 0 100vmax rgba(20, 22, 26, 0.55),
            inset 0 0 0 2px ${INK};
        }
        .tut-caption {
          position: relative;
          z-index: 2;
          width: min(76vw, 390px);
          box-sizing: border-box;
          padding: 12px 14px 14px;
          border-left: 12px solid ${SHEET};
          border-right: 12px solid ${SHEET};
          border-bottom: 12px solid ${SHEET};
          background: ${SHEET};
          box-shadow: 7px 7px 0 rgba(43, 42, 36, 0.9);
          pointer-events: auto;
        }
        .tut-msg {
          max-width: min(92vw, 420px);
          background: ${SHEET};
          border: 1px solid ${INK};
          box-shadow: 7px 7px 0 rgba(43, 42, 36, 0.9);
          padding: 16px 18px;
          pointer-events: auto;
        }
        .tut-top {
          position: absolute;
          top: calc(18px + env(safe-area-inset-top));
          left: 50%;
          transform: translateX(-50%);
        }
        .tut-bottom {
          position: absolute;
          bottom: calc(120px + env(safe-area-inset-bottom));
          left: 50%;
          transform: translateX(-50%);
        }
        /* над нижним меню процентов (десктоп справа, мобилка по центру) */
        .tut-br {
          position: absolute;
          right: calc(16px + env(safe-area-inset-right));
          bottom: calc(120px + env(safe-area-inset-bottom));
          max-width: min(92vw, 340px);
        }
        @media (max-width: 767px) {
          .tut-br {
            right: auto;
            left: 50%;
            transform: translateX(-50%);
            bottom: calc(150px + env(safe-area-inset-bottom));
          }
        }
        /* справа-сверху — как карточка spawn-tutorial (этапы tribes/buildCity) */
        .tut-tr {
          position: absolute;
          top: calc(76px + env(safe-area-inset-top));
          right: calc(16px + env(safe-area-inset-right));
          max-width: min(92vw, 340px);
        }
        @media (max-width: 767px) {
          .tut-tr {
            right: auto;
            left: 50%;
            transform: translateX(-50%);
            max-width: 84vw;
          }
        }
        /* прогресс-бар (племена/золото) */
        .tut-prog-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 4px;
        }
        .tut-prog {
          flex: 1;
          height: 6px;
          background: rgba(43, 42, 36, 0.15);
          overflow: hidden;
        }
        .tut-prog > i {
          display: block;
          height: 100%;
          background: ${GREEN};
          transition: width 0.25s ease;
        }
        .tut-msg h4 {
          font-family: "Oswald", sans-serif;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-size: 1.2rem;
          margin: 0 0 8px;
        }
        .tut-hint {
          display: flex;
          gap: 12px;
          align-items: center;
          background: rgba(168, 67, 43, 0.08);
          border: 1px solid rgba(168, 67, 43, 0.35);
          padding: 10px 12px;
          margin: 4px 0 12px;
        }
        .tut-hint-dots {
          flex: none;
          width: 58px;
          height: 42px;
          background: #c9bd93;
          border: 1px solid rgba(43, 42, 36, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
        }
        .rd {
          width: 11px;
          height: 11px;
          border-radius: 50%;
          background: ${RED};
          box-shadow: 0 0 0 2px rgba(168, 67, 43, 0.35);
          animation: tutBlink 1s steps(2, start) infinite;
        }
        .tut-hint p {
          margin: 0;
          font-size: 0.86rem;
          line-height: 1.35;
          color: ${INK};
        }
        .tut-progress {
          display: flex;
          gap: 6px;
          margin: 0 0 8px;
        }
        .tut-dot {
          width: 8px;
          height: 8px;
          background: rgba(43, 42, 36, 0.22);
        }
        .tut-dot.on {
          background: ${INK};
        }
        .tut-title {
          font-family: "Oswald", sans-serif;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-size: 1.2rem;
          margin: 0 0 4px;
        }
        .tut-body {
          font-size: 0.92rem;
          line-height: 1.4;
          margin: 0 0 12px;
          color: rgba(43, 42, 36, 0.85);
        }
        .tut-body.warn {
          color: ${RED};
        }
        .tut-port {
          display: inline-block;
          width: 1.1em;
          height: 1.1em;
          vertical-align: -0.18em;
          margin: 0 2px;
          color: ${INK};
        }
        .tut-sword {
          display: inline-block;
          width: 1.05em;
          height: 1.05em;
          vertical-align: -0.15em;
          margin: 0 2px;
          fill: ${INK};
        }
        /* жёлтый блок-предупреждение (как хинт с точками, но жёлтый) */
        .tut-yellow {
          background: rgba(183, 121, 31, 0.14);
          border: 1px solid rgba(183, 121, 31, 0.5);
          color: ${RED};
          font-family: "Oswald", sans-serif;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          font-size: 0.95rem;
          padding: 10px 12px;
          margin: 0 0 12px;
        }
        .tut-nav {
          display: flex;
          gap: 8px;
        }
        .tut-btn {
          pointer-events: auto;
          flex: 1;
          padding: 0.55rem 0.8rem;
          font-family: "Oswald", sans-serif;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-size: 0.92rem;
          border: 1px solid ${INK};
          cursor: pointer;
        }
        .tut-btn.back {
          background: ${SHEET};
          color: ${INK};
        }
        .tut-btn.back:hover {
          background: #eee7d2;
        }
        .tut-btn.back:disabled {
          opacity: 0.35;
          cursor: default;
        }
        .tut-btn.ok {
          background: ${INK};
          color: ${SHEET};
        }
        .tut-btn.ok:hover {
          background: #3c3a31;
        }
        .tut-btn.ok:disabled {
          background: #b8b2a0;
          color: #f1ece0;
          cursor: default;
        }
        .tut-btn.green {
          background: ${GREEN};
          color: #fff;
        }
        .tut-btn.green:hover {
          background: #276b2a;
        }
        .tut-nav-col {
          flex-direction: column;
        }
        /* финал: поздравление */
        .tut-grad {
          text-align: center;
          max-width: min(92vw, 380px);
        }
        .tut-grad-badge {
          font-size: 40px;
          line-height: 1;
          margin: 2px 0 6px;
        }
        .tut-tip {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          text-align: left;
          margin: 0 0 12px;
          padding: 10px 12px;
          background: rgba(183, 121, 31, 0.12);
          border: 1px solid rgba(183, 121, 31, 0.45);
          font-size: 0.84rem;
          line-height: 1.4;
          color: ${INK};
        }
        .tut-tip .tut-coin-wrap {
          flex: none;
          margin-top: 1px;
        }
        /* справочник юнитов: карточка-«товар» */
        .tut-catalog {
          max-width: min(92vw, 380px);
        }
        .tut-cat-head {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0 0 10px;
        }
        .tut-cat-icon {
          flex: none;
          width: 56px;
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #111827;
          border: 1px solid #64748b;
          border-radius: 8px;
          padding: 10px;
          box-sizing: border-box;
        }
        .tut-cat-icon img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: brightness(0) invert(1);
        }
        .tut-cat-title {
          font-family: "Oswald", sans-serif;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          font-size: 1.15rem;
          color: ${INK};
          line-height: 1.1;
        }
        .tut-cat-key {
          margin-top: 4px;
          font-size: 0.78rem;
          color: rgba(43, 42, 36, 0.7);
        }
        .tut-cat-dots {
          display: flex;
          gap: 6px;
          justify-content: center;
          margin: 4px 0 12px;
        }
        .tut-banner {
          position: absolute;
          bottom: calc(90px + env(safe-area-inset-bottom));
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 12px;
          background: ${SHEET};
          border: 1px solid ${INK};
          box-shadow: 5px 5px 0 rgba(43, 42, 36, 0.9);
          padding: 10px 16px;
          font-size: 0.95rem;
          font-weight: 600;
        }
        .ci {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .tut-clickrow {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0 0 4px;
        }
        .tut-count {
          font-family: "IBM Plex Mono", monospace;
          font-weight: 700;
          color: ${INK};
        }
        .tut-corner {
          position: fixed;
          left: calc(16px + env(safe-area-inset-left));
          bottom: calc(16px + env(safe-area-inset-bottom));
          z-index: 3001;
          display: flex;
          align-items: center;
          gap: 10px;
          background: ${SHEET};
          border: 1px solid ${INK};
          box-shadow: 5px 5px 0 rgba(43, 42, 36, 0.9);
          padding: 8px 10px;
          pointer-events: auto;
        }
        /* индикатор паузы = КНОПКА «продолжить» (клик снимает паузу) */
        .tut-resume {
          pointer-events: auto;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: "IBM Plex Mono", monospace;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: rgba(43, 42, 36, 0.85);
          background: transparent;
          border: 1px solid ${GREEN};
          padding: 4px 8px;
        }
        .tut-resume:hover {
          background: ${GREEN};
          color: #fff;
        }
        .tut-resume .dot {
          width: 8px;
          height: 8px;
          background: ${RED};
          animation: tutBlink 1.1s steps(2, start) infinite;
        }
        .tut-resume-play {
          font-size: 0.8rem;
          color: ${GREEN};
        }
        .tut-resume:hover .tut-resume-play {
          color: #fff;
        }
        @keyframes tutBlink {
          50% {
            opacity: 0.25;
          }
        }
        /* мигание карточки при клике «не туда» во время постройки */
        .tut-flash {
          animation: tutFlash 0.6s ease-out;
        }
        @keyframes tutFlash {
          0%,
          100% {
            box-shadow: 7px 7px 0 rgba(43, 42, 36, 0.9);
            transform: translateX(0);
          }
          20% {
            box-shadow:
              0 0 0 3px ${RED},
              7px 7px 0 rgba(43, 42, 36, 0.9);
            transform: translateX(-3px);
          }
          60% {
            transform: translateX(3px);
          }
        }
        .tut-restart {
          pointer-events: auto;
          border: 1px solid ${RED};
          color: ${RED};
          background: transparent;
          padding: 4px 10px;
          font-family: "Oswald", sans-serif;
          font-weight: 600;
          font-size: 0.78rem;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .tut-restart:hover {
          background: ${RED};
          color: #fff;
        }
        /* развилка «съесть/расширяться» */
        .tut-choice {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          margin: 0 0 10px;
        }
        .tut-choice-ic {
          flex: none;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid ${INK};
        }
        .tut-choice-ic.eat {
          background: ${RED};
        }
        .tut-choice-ic.eat .tut-sword {
          fill: #fff;
          width: 16px;
          height: 16px;
          margin: 0;
        }
        .tut-choice-ic.grow {
          background: ${GREEN};
        }
        .tut-grow {
          display: inline-block;
          color: #fff;
          width: 18px;
          height: 18px;
        }
        .tut-choice > div {
          font-size: 0.9rem;
          line-height: 1.35;
          color: rgba(43, 42, 36, 0.9);
        }
        /* инлайн-иконки войск/золота */
        .tut-soldier {
          fill: ${INK};
          display: inline-block;
          width: 1em;
          height: 1em;
          vertical-align: -0.14em;
        }
        .tut-soldier-wrap {
          display: inline-flex;
        }
        .tut-coin {
          display: inline-block;
          width: 1.15em;
          height: 1.15em;
          vertical-align: -0.2em;
        }
        .tut-coin-wrap {
          display: inline-flex;
        }
        /* чип с игровой иконкой — как кнопка снизу (белая иконка на тёмном) */
        .tut-chip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: none;
          width: 19px;
          height: 19px;
          background: #111827;
          border: 1px solid #64748b;
          border-radius: 3px;
          vertical-align: middle;
          overflow: hidden;
          box-sizing: border-box;
          padding: 2px;
        }
        .tut-chip img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: brightness(0) invert(1);
        }
        /* заголовок с иконкой-чипом — flex, чтобы иконка не «плыла» по вертикали */
        .tut-h4ic {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        /* клавиша-кэп и строка-подсказка (как в SpawnTutorial) */
        .tut-key {
          display: inline-block;
          min-width: 20px;
          padding: 2px 6px 3px;
          margin: 0 2px;
          font-family: "IBM Plex Mono", ui-monospace, monospace;
          font-size: 12px;
          font-weight: 800;
          line-height: 1;
          text-align: center;
          color: ${INK};
          background: linear-gradient(#fffefb 0%, #efe7d3 60%, #ddd2b6 100%);
          border: 1px solid ${INK};
          border-bottom-width: 3px;
          vertical-align: middle;
        }
        .tut-keyline {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 10px;
          padding-top: 8px;
          border-top: 1px solid rgba(43, 42, 36, 0.15);
          font-size: 0.82rem;
          color: rgba(43, 42, 36, 0.85);
        }
        /* иконки-действия (🔧 → 🏙) держим единой не-рвущейся группой */
        .tut-keyicons {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          white-space: nowrap;
        }
        /* «каждый клик — 20% (504 🪖)» */
        .tut-cost {
          margin: 2px 0 8px;
          font-size: 0.86rem;
          color: rgba(43, 42, 36, 0.9);
        }
        .tut-cost b {
          color: ${RED};
        }
        .tut-costnum {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-family: "IBM Plex Mono", monospace;
          font-weight: 700;
          color: ${INK};
        }
        /* синий блок-совет «дай войскам накопиться» */
        .tut-wait {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          margin: 8px 0 0;
          padding: 8px 10px;
          background: rgba(47, 109, 176, 0.08);
          border: 1px solid rgba(47, 109, 176, 0.35);
          font-size: 0.82rem;
          line-height: 1.35;
          color: ${INK};
        }
        .tut-wait .tut-soldier-wrap {
          flex: none;
        }
        .tut-wait .tut-soldier {
          fill: ${WATER};
          width: 1.05em;
          height: 1.05em;
        }
        /* карточка contact: сравнение в 2 колонки */
        .tut-contact {
          max-width: min(94vw, 460px);
        }
        .tut-sub {
          margin: 0 0 10px;
          font-weight: 600;
          color: ${INK};
        }
        .tut-cols {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border: 1px solid ${INK};
          margin: 0 0 14px;
        }
        .tut-col {
          padding: 10px 12px;
        }
        .tut-col.grow {
          background: rgba(47, 125, 50, 0.07);
        }
        .tut-col.eat {
          background: rgba(168, 67, 43, 0.06);
          border-left: 1px solid ${INK};
        }
        /* нейтральные колонки (равноценные варианты, без зелёного/красного) */
        .tut-col.neutral {
          background: rgba(43, 42, 36, 0.04);
        }
        .tut-cols .tut-col.neutral + .tut-col.neutral {
          border-left: 1px solid rgba(43, 42, 36, 0.2);
        }
        .tut-col.neutral .tut-col-h {
          color: ${INK};
        }
        .tut-choice-ic.neutral {
          background: #111827;
          border: 1px solid #64748b;
        }
        .tut-choice-ic.neutral .tut-grow {
          color: #fff;
        }
        .tut-col-h {
          display: flex;
          align-items: center;
          gap: 7px;
          font-family: "Oswald", sans-serif;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          font-size: 0.82rem;
          line-height: 1.1;
          margin: 0 0 8px;
        }
        .tut-col.grow .tut-col-h {
          color: ${GREEN};
        }
        .tut-col.eat .tut-col-h {
          color: ${RED};
        }
        .tut-col-h .tut-choice-ic {
          width: 22px;
          height: 22px;
        }
        .tut-col-h .tut-choice-ic.eat .tut-sword {
          width: 12px;
          height: 12px;
        }
        .tut-col-h .tut-choice-ic.grow .tut-grow {
          width: 14px;
          height: 14px;
        }
        .tut-col ul {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .tut-col li {
          position: relative;
          padding-left: 12px;
          margin: 0 0 5px;
          font-size: 0.82rem;
          line-height: 1.3;
          color: rgba(43, 42, 36, 0.9);
        }
        .tut-col li::before {
          content: "·";
          position: absolute;
          left: 2px;
        }
        .tut-col li.gold {
          margin-top: 7px;
          padding-left: 0;
          font-weight: 700;
          color: ${AMBER};
          display: flex;
          align-items: flex-start;
          gap: 5px;
        }
        .tut-col li.gold::before {
          content: none;
        }
        .tut-col li.gold .tut-coin-wrap {
          flex: none;
          margin-top: 1px;
        }
        /* маркер соседа на карте (позицию двигает rAF, см. startMarkerLoop) */
        .tut-marker {
          position: fixed;
          left: 0;
          top: 0;
          z-index: 2999;
          pointer-events: none;
          will-change: transform;
        }
        .tut-marker-ring {
          display: block;
          width: 52px;
          height: 52px;
          border-radius: 50%;
          border: 3px solid ${RED};
          animation: tutMarkerPulse 1.2s ease-out infinite;
        }
        .tut-marker-badge {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: ${RED};
        }
        .tut-marker-badge .tut-sword {
          fill: #fff;
          width: 15px;
          height: 15px;
          margin: 0;
        }
        .tut-marker-label {
          position: absolute;
          left: 50%;
          top: calc(100% + 6px);
          transform: translateX(-50%);
          white-space: nowrap;
          font-family: "Oswald", sans-serif;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-size: 0.72rem;
          color: #fff;
          background: ${RED};
          padding: 2px 7px;
        }
        @keyframes tutMarkerPulse {
          0% {
            box-shadow: 0 0 0 0 rgba(168, 67, 43, 0.5);
          }
          70% {
            box-shadow: 0 0 0 16px rgba(168, 67, 43, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(168, 67, 43, 0);
          }
        }
        /* terron: мобильная вёрстка обучалки. На узком экране media-query
           ре-центрирует позиционные карточки — они превращались в большой
           блок по центру и перекрывали именно ту зону карты, куда надо
           тапать (тап идёт СКВОЗЬ прозрачный .tut-root.pass, но не сквозь
           саму карточку). Здесь: (1) компактим все карточки; (2) прижимаем
           интерактивные tut-tr/tut-br к краю и ограничиваем высоту, чтобы
           противоположная половина карты оставалась тапабельной. Блок идёт
           последним в каскаде → переопределяет базовые правила без !important. */
        @media (max-width: 767px) {
          .tut-msg {
            padding: 11px 13px;
            max-width: min(90vw, 360px);
          }
          .tut-msg h4,
          .tut-title {
            font-size: 1rem;
            margin-bottom: 5px;
          }
          .tut-body {
            font-size: 0.83rem;
            line-height: 1.32;
            margin-bottom: 8px;
          }
          .tut-hint {
            padding: 7px 9px;
            margin: 3px 0 8px;
            gap: 9px;
          }
          .tut-hint p {
            font-size: 0.76rem;
            line-height: 1.28;
          }
          .tut-hint-dots {
            width: 44px;
            height: 32px;
          }
          .tut-yellow {
            font-size: 0.8rem;
            padding: 7px 9px;
            margin-bottom: 8px;
          }
          .tut-tip,
          .tut-wait {
            font-size: 0.72rem;
            line-height: 1.28;
            padding: 7px 9px;
          }
          .tut-tip {
            gap: 6px;
            margin-bottom: 8px;
          }
          .tut-cost {
            font-size: 0.8rem;
            margin-bottom: 6px;
          }
          .tut-keyline {
            font-size: 0.76rem;
            margin-top: 8px;
            padding-top: 6px;
          }
          .tut-prog-row {
            margin-top: 2px;
          }
          .tut-btn {
            font-size: 0.85rem;
            padding: 0.5rem 0.7rem;
          }
          .tut-catalog,
          .tut-grad {
            max-width: min(90vw, 360px);
          }
          /* подсказки-действия (расширяйся/строй/атакуй/высадка/…): верхняя
             плашка на ВСЮ ширину телефона, с отступами под вырез камеры. */
          .tut-tr,
          .tut-top {
            top: calc(6px + env(safe-area-inset-top));
            left: calc(6px + env(safe-area-inset-left));
            right: calc(6px + env(safe-area-inset-right));
            bottom: auto;
            transform: none;
            max-width: none;
            width: auto;
            max-height: 60vh;
            overflow-y: auto;
          }
          .tut-br {
            bottom: calc(150px + env(safe-area-inset-bottom));
            left: 50%;
            right: auto;
            transform: translateX(-50%);
            max-width: 90vw;
            max-height: 52vh;
            overflow-y: auto;
          }
          /* карточка про ползунок атаки: НЕ по центру, а прижата к правому краю
             прямо НАД нижней полосой (там и живёт слайдер на телефоне) — чтобы
             подсказка была рядом с тем, что двигаешь. Идёт после .tut-br → выигрывает. */
          .tut-ratio {
            left: auto;
            right: calc(6px + env(safe-area-inset-right));
            transform: none;
            bottom: calc(58px + env(safe-area-inset-bottom));
            max-width: 82vw;
          }
          /* баннер «займи землю» — тоже наверх, на всю ширину */
          .tut-banner {
            top: calc(6px + env(safe-area-inset-top));
            left: calc(6px + env(safe-area-inset-left));
            right: calc(6px + env(safe-area-inset-right));
            bottom: auto;
            transform: none;
            justify-content: center;
          }
          /* пауза/рестарт: базово ВЕРХ-СЛЕВА (центр-модалка / низ-полоса). Когда
             сверху висит карточка-действие — positionCorner() инлайном опускает
             угол ПОД неё (высота карточки динамическая, CSS её не знает). */
          .tut-corner {
            left: calc(6px + env(safe-area-inset-left));
            top: calc(8px + env(safe-area-inset-top));
            bottom: auto;
          }
          /* баннер «игра приостановлена» (HeadsUpMessage) при обучении — ниже, чтобы
             не оказаться ПОД верхними карточками (по умолчанию он top-15%). */
          body.tut-active .hud-msg {
            top: 55% !important;
          }
          /* чат/лента (events-display) на телефоне в обучении не нужна — прячем весь
             блок (кнопка «Написать» + полоса групп-иконок). revealFullHud возвращает
             events-display (его нет в ALWAYS_HIDDEN), поэтому давим CSS-ом. Десктоп
             не трогаем — там чат = chat-display, уже скрыт. */
          body.tut-active events-display {
            display: none !important;
          }
        }
      </style>
    `;
  }
}

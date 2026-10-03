import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  BUILD_SLOTS,
  BuildSlotDef,
  defaultHotkeyLabel,
  ULT_SLOT_DEF,
  ULT_SLOT_KEYBIND,
} from "../../../core/game/BuildSlots";
import {
  actingAs,
  BuildableUnit,
  Gold,
  Nukes,
  PlayerBuildableUnitType,
  ULT_MAX_COUNT,
  Ultimates,
  UnitType,
  VISIBLE_BUILD_TYPES,
} from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { refreshUltimates } from "../../Api";
import { isLoggedIn } from "../../Auth";
import { Controller } from "../../Controller";
import { actionCooldown } from "../../Cooldowns";
import { isUltRollDisabled } from "../../DisabledUlts";
import { ToggleStructureEvent } from "../../InputHandler";
import { feedSecretDigit } from "../../SecretCodes";
import { isTestGroundActive } from "../../TestGround";
import { toast } from "../../Toast";
import { UIState } from "../../UIState";
import {
  buildUltimateGrid,
  bumpUltRefreshOffset,
  effectiveUltSeed,
  getUltRefreshOffset,
  UltGridSlot,
  ultPrimeUnlocked,
  ultRefreshDisplayPrice,
} from "../../UltimateGrid";
import { syncUltRefreshOnce } from "../../UltRefreshSync";
import { buttonFor, ultSlotUnitType } from "../../UltSlots";
import { refreshUltUnlocks, ultLockedForMe } from "../../UltUnlocks";
import { ultStatLines, unitMeta } from "../../UnitCatalog";
import { L, renderNumber, translateText } from "../../Utils";
import { BUILD_DESC_PARAMS } from "../../WikiNumbers";
import { cooldownOverlay } from "../CooldownBadge";
import { tutBlocked, tutHighlighted } from "../tutHighlight";
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
// terron: ультимейты — звезда слота выбора. Иконки самих ульт-зданий/атак
// берём из ЕДИНОГО реестра UnitCatalog (unitMeta), а не дублируем здесь.
// new-units/ULTIMATES.md
const ultimateIcon = assetUrl("images/UltimateIconWhite.svg");

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private playerBuildables: BuildableUnit[] | null = null;
  private keybinds: Record<string, { value: string; key: string }> = {};
  /** Уровни построенного по типу кнопки (счётчик на кнопке). */
  private builtLevels = new Map<UnitType, number>();
  private allDisabled = false;
  private _hoveredUnit: PlayerBuildableUnitType | null = null;
  // terron: ультимейты — локальный пре-выбор до фиксации ядром (первое
  // использование → PlayerImpl.ultimateChoice, приходит через PlayerView).
  private _ministries = 0;
  private _pendingUltimate: UnitType | null = null;
  private _ultimateChooserOpen = false;
  // terron: РЕФРЕШ УЛЬТ — платный переролл сетки за ЛТС (только залогиненным).
  // Оффсет/сид/разблок — в ОБЩЕМ сторе UltimateGrid (синк десктоп↔мобильный
  // радиал). Цену считает сервер (по леджеру за матч).
  @state() private _loggedIn: boolean | null = null; // null = ещё проверяем
  private _loginChecking = false;
  @state() private _ultRefreshBusy = false;
  // terron: ховер по ячейке чузера ульты → МГНОВЕННЫЙ кастомный тултип (нативный
  // title тормозил ~1с). null = ничего не наведено.
  @state() private _hoveredUltCell: UnitType | null = null;
  // terron: выравнивание ховер-тултипа (клэмп в экран у краёв панели).
  private _tooltipAlign: "center" | "left" | "right" = "center";

  createRenderRoot() {
    return this;
  }

  // terron: десктоп-хоткей ульты («-»/Minus, эмитит InputHandler). Если ульта уже
  // ВЫБРАНА (зафиксирована / пре-выбор / единственная доступная) — «-» АКТИВИРУЕТ
  // её (арм постройки-штаба или атаки МИРВ, тоггл — как клик по слоту). Если не
  // выбрана — открывает чузер.
  private onUltHotkey = () => {
    const fixed = this.game?.myPlayer()?.ultimateChoice?.() ?? null;
    const available = Ultimates.types.filter(
      (t) => !this.game.config().isUnitDisabled(t) && !isUltRollDisabled(t),
    );
    const chosen: UnitType | null =
      fixed ??
      this._pendingUltimate ??
      (available.length === 1 ? available[0] : null);
    if (chosen !== null) {
      // Активировать: тоггл ghost постройки/атаки (как клик по слоту-юниту).
      // Штаб достроен → в слоте его КАСТ (тот же расчёт, что у кнопки).
      const inSlot: UnitType =
        ultSlotUnitType(chosen, (t) => this.hqBuilt(t)) ?? chosen;
      this.uiState.ghostStructure =
        this.uiState.ghostStructure === inSlot
          ? null
          : (inSlot as PlayerBuildableUnitType);
      this._ultimateChooserOpen = false;
    } else {
      this._ultimateChooserOpen = !this._ultimateChooserOpen;
    }
    this.requestUpdate();
  };

  // terron: id текущего матча из URL (тот же источник, что у matchUltSeed) —
  // нужен серверу для счётчика рефрешей за матч.
  private currentGameId(): string {
    try {
      return location.pathname.split("/game/")[1] ?? "";
    } catch {
      return "";
    }
  }

  // Проверка логина один раз при открытии чузера (кнопка рефреша — только вошедшим).
  private ensureLoginChecked() {
    if (this._loggedIn !== null || this._loginChecking) return;
    this._loginChecking = true;
    isLoggedIn()
      .then((v) => {
        this._loggedIn = v;
        this.requestUpdate();
      })
      .catch(() => {
        this._loggedIn = false;
        this.requestUpdate();
      })
      .finally(() => {
        this._loginChecking = false;
      });
  }

  // terron: РЕФРЕШ УЛЬТ — списать ЛТС и перемешать сетку заново. Успех → бампаем
  // offset (новый seed + разблок прем на матч). Ошибки → тост.
  private onUltRefresh = async () => {
    if (this._ultRefreshBusy) return;
    const gameId = this.currentGameId();
    if (!gameId) {
      toast(L("Рефреш недоступен", "Refresh unavailable"), "error");
      return;
    }
    this._ultRefreshBusy = true;
    this.requestUpdate();
    try {
      const res = await refreshUltimates(gameId);
      if (res.ok) {
        bumpUltRefreshOffset();
        toast(
          L(
            `Ульты обновлены · остаток ${res.lts ?? "?"} ЛТС`,
            `Ultimates refreshed · ${res.lts ?? "?"} LTS left`,
          ),
          "success",
        );
      } else if (res.error === "insufficient") {
        toast(L("Не хватает ЛТС", "Not enough LTS"), "error");
      } else if (res.error === "unauthorized") {
        this._loggedIn = false;
        toast(L("Войдите в аккаунт", "Log in first"), "error");
      } else {
        toast(L("Ошибка рефреша", "Refresh failed"), "error");
      }
    } finally {
      this._ultRefreshBusy = false;
      this.requestUpdate();
    }
  };

  // terron 13.09 (тест владельца): шаг обучения меняет body-класс (tut-city →
  // tut-income …), а на этом шаге игра стоит на ПАУЗЕ — тиков слоя нет, и панель
  // держала блокировку прошлого шага: фабрика серая и без мигания, пока наведение
  // мыши не перерисует. Смена шага = немедленный перезапрос и перерисовка.
  private _tutKey = "";
  private _tutObserver: MutationObserver | null = null;
  private readonly onBodyClass = (): void => {
    let key = "";
    for (const c of document.body.classList) {
      if (c.startsWith("tut-")) key += c + " ";
    }
    if (key === this._tutKey) return;
    this._tutKey = key;
    this.refreshBuildables();
    this.requestUpdate();
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("terron-toggle-ultimate-chooser", this.onUltHotkey);
    this._tutObserver = new MutationObserver(this.onBodyClass);
    this._tutObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  disconnectedCallback() {
    window.removeEventListener(
      "terron-toggle-ultimate-chooser",
      this.onUltHotkey,
    );
    this._tutObserver?.disconnect();
    this._tutObserver = null;
    super.disconnectedCallback();
  }

  /** Спросить воркер, что сейчас можно строить, и перерисоваться по ответу.
   *  Ответ асинхронный: без перерисовки в .then он ждал следующего тика, а на
   *  паузе следующего тика нет. */
  private refreshBuildables(): void {
    const player = this.game?.myPlayer();
    if (!player) return;
    player.buildables(undefined, VISIBLE_BUILD_TYPES).then((buildables) => {
      this.playerBuildables = buildables;
      this.requestUpdate();
    });
  }

  init() {
    const config = this.game.config();
    const userSettings = new UserSettings();

    this.keybinds = userSettings.parsedUserKeybinds();

    this.allDisabled = VISIBLE_BUILD_TYPES.every((u) =>
      config.isUnitDisabled(u),
    );
    this.requestUpdate();
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  }

  // terron: ультимейты — штаб уже стоит (или строится) → слот блокируется.
  // Лимит копий берём из ТОГО ЖЕ реестра, что и ядро (ULT_MAX_COUNT): Мин правды 2,
  // Религия 2, прочие 1; следующая копия — только когда предыдущие достроены
  // (зеркало PlayerImpl.canBuildUnitType). Форты — отдельный случай (апгрейд поверх).
  private ultBuilt(item: UnitType): boolean {
    if (!Ultimates.has(item)) return false;
    const mine = this.game?.myPlayer()?.units(item) ?? [];
    // terron: Укрепления качаются «поверх» до макс. ур. — слот НЕ глушим, пока есть
    // куда качать (клик по штабу апгрейдит его). Блок только на максимуме.
    if (item === UnitType.Fortifications) {
      const maxLevel = this.game?.config().unitInfo(item).maxLevel ?? Infinity;
      return mine.length > 0 && mine.every((u) => u.level() >= maxLevel);
    }
    const maxCount = ULT_MAX_COUNT[item] ?? 1;
    if (mine.length >= maxCount) return true;
    if (mine.length > 0 && mine.some((u) => u.isUnderConstruction()))
      return true;
    return false;
  }

  // terron: Укрепления — подсказка «кликни по штабу, чтобы улучшить», пока форт
  // не на максимальном уровне. new-units/ULTIMATES.md
  private fortUpgradeable(item: UnitType): boolean {
    if (item !== UnitType.Fortifications) return false;
    const mine = this.game?.myPlayer()?.units(item) ?? [];
    const maxLevel = this.game?.config().unitInfo(item).maxLevel ?? Infinity;
    return mine.length > 0 && mine.some((u) => u.level() < maxLevel);
  }

  private canBuild(item: UnitType): boolean {
    if (this.game?.config().isUnitDisabled(item)) return false;
    if (this.ultBuilt(item)) return false; // лимит 1: снеси старый штаб
    const player = this.game?.myPlayer();
    switch (item) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
      // terron 25.08: ТЕРРАФОРМИНГ — три ракеты ульты пускаются из шахты и
      // подчиняются тому же правилу «шахта должна быть ДОСТРОЕНА».
      case UnitType.WaterNuke:
      case UnitType.LandNuke:
      case UnitType.BlastNuke:
        // terron: ядерка доступна (иконка белая), только когда силос ДОСТРОЕН —
        // не считаем силосы в стройке (иначе МИРВ/бомба «активны» сразу при
        // постановке силоса, хотя пуск нельзя — sim требует !isUnderConstruction).
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player
            ?.units(UnitType.MissileSilo)
            .some((s) => !s.isUnderConstruction()) ??
            false)
        );
      case UnitType.Warship:
        // terron: корабль доступен (иконка белая), только когда порт ДОСТРОЕН —
        // не считаем порты в стройке (раньше становился белым при постановке).
        //
        // ⚠️ 23.08: «портом» здесь считается и УЛЬТА, объявившая себя портом
        // (штаб Пиратства). Раньше стоял голый UnitType.Port, и пират с одним
        // лишь штабом смотрел на серую кнопку корабля, хотя ядро постройку
        // разрешало (репорт владельца). Родство берём из реестра — actingAs().
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player
            ?.units(...actingAs(UnitType.Port))
            .some((p) => !p.isUnderConstruction()) ??
            false)
        );
      default:
        return this.cost(item) <= (player?.gold() ?? 0n);
    }
  }

  // terron perf (Р1): счётчики юнитов меняются редко — 2 обновления/с хватает,
  // вместо buildables()-запроса и Lit-рендера на каждый тик.
  getTickIntervalMs(): number {
    return 500;
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    // ⚠️ terron 26.08: счётчик рефрешей подтягиваем С СЕРВЕРА один раз за матч,
    // и делаем это ЗАРАНЕЕ (на тике), а не при открытии чузера: ответ должен
    // быть на месте к первому же показу сетки — иначе кнопка успеет соврать
    // цену. Тем же счётчиком пользуется мобильный радиал (стор общий).
    syncUltRefreshOnce(() => this.requestUpdate());
    // terron 23.08: табло выбора ульт живёт до УСТАНОВКИ (см. pickUltimate).
    // Ядро фиксирует выбор первой постройкой — вот по этому и закрываем.
    if (this._ultimateChooserOpen && player.ultimateChoice() !== null) {
      this._ultimateChooserOpen = false;
    }
    this.refreshBuildables();
    // terron 01.09: счётчики кнопок — по той же разметке, что и сами кнопки.
    for (const slot of BUILD_SLOTS) {
      this.builtLevels.set(slot.type, player.totalUnitLevels(slot.type));
    }
    // terron 06.08: Мин правды влита в МЕДИА — счётчик считаем по МЕДИА.
    this._ministries = player.totalUnitLevels(UnitType.Media);
    this.requestUpdate();
  }

  /**
   * terron 23.08 (репорт владельца «тултип поломался, надо чтобы всегда
   * вмещался в экран»): подсказки висят абсолютом относительно своей кнопки,
   * и у краёв панели их срезает окном. Грубое выравнивание по краю КНОПКИ не
   * спасает: ширина подсказки больше кнопки в разы.
   *
   * Меряем ПОСЛЕ отрисовки и двигаем ровно настолько, насколько вылезло.
   * Работает при любой ширине окна и любом языке (у RU-текста длина другая).
   */
  updated(): void {
    const tips = this.querySelectorAll<HTMLElement>(".js-screen-tip");
    for (const tip of tips) {
      tip.style.marginLeft = "0px";
      const r = tip.getBoundingClientRect();
      const pad = 6;
      let dx = 0;
      if (r.left < pad) dx = pad - r.left;
      else if (r.right > window.innerWidth - pad) {
        dx = window.innerWidth - pad - r.right;
      }
      if (dx !== 0) tip.style.marginLeft = `${Math.round(dx)}px`;
    }
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (
      !this.game ||
      !myPlayer ||
      this.game.inSpawnPhase() ||
      !myPlayer.isAlive()
    ) {
      return null;
    }
    if (this.allDisabled) {
      return null;
    }

    return html`
      <div class="border-t border-white/10 p-0.5 w-full">
        <!-- terron: ОДИН ряд (flex-nowrap), ширина по контенту (w-max) → панель
             снаружи прижата вправо и растёт влево при росте счётчиков. -->
        <div class="flex flex-nowrap justify-end gap-0.5 w-max ml-auto">
          ${BUILD_SLOTS.map((s) => this.renderBuildSlot(s))}
          ${this.renderUltimateSlot()}
        </div>
      </div>
    `;
  }

  /**
   * terron 01.09: ОДНА кнопка панели по записи единой разметки
   * (`core/game/BuildSlots`). Иконка и название — из общего каталога (с учётом
   * подмены ультой), счётчик — уровни построенного, клавиша — из настроек по
   * имени действия из той же записи.
   *
   * ⚠️ Раньше все десять кнопок были выписаны здесь руками, и каждая несла
   * СВОЮ пару «иконка + имя действия» — то есть панель и обработчик клавиш
   * договаривались вслепую. Именно так слот ульты остался с мёртвой клавишей.
   */
  private renderBuildSlot(slot: BuildSlotDef) {
    // Обе подмены ульты (чужой слот кастом и подмена самого юнита) — ОДНИМ
    // ответом: иначе кнопка корабля у Пиратства снова покажет линкор.
    const btn = buttonFor(slot.type, (t) => this.hasUlt(t));
    // ⚠️ 01.09 — РЕГРЕССИЯ, найденная владельцем: раньше у каждой кнопки был
    // ЖЁСТКИЙ фолбэк на свою цифру (`?? "1"`, `?? "2"` …), а единый рендер
    // падал в ПУСТУЮ строку. `parsedUserKeybinds()` возвращает {} у всех, кто
    // клавиши не переназначал, — то есть цифры пропали с панели практически у
    // ВСЕХ игроков. Фолбэк теперь берётся из того же реестра, где живут
    // дефолты клавиатуры, — второй копии цифр нет.
    const hotkey = this.keybinds[slot.keybind]?.key ?? defaultHotkeyLabel(slot);
    // Счётчик — у всего, что НАКАПЛИВАЕТСЯ (города, порты, корабли…). У ракет
    // его нет и быть не может: их не держат, их пускают.
    // ⚠️ Первая версия правила была `Structures.has(...)` и молча убрала
    // счётчик у КОРАБЛЯ — он юнит, а не строение. Поймал сторож.
    const count = Nukes.has(slot.type)
      ? null
      : (this.builtLevels.get(slot.type) ?? 0);
    return this.renderUnitItem(
      btn.icon,
      count,
      btn.type as PlayerBuildableUnitType,
      btn.nameKey,
      hotkey,
    );
  }

  // terron: ультимейты — метаданные карточки ульты (иконка/i18n-ключ/счётчик).
  /** Есть ли у меня эта ульта (короткая форма для реестра подмен). */
  private hasUlt(t: UnitType): boolean {
    return this.game?.myPlayer()?.hasUltimate(t) ?? false;
  }

  /** Штаб этой ульты у меня ДОСТРОЕН (не в стройке). */
  private hqBuilt(t: UnitType): boolean {
    return (
      this.game
        ?.myPlayer()
        ?.units(t)
        .some((u) => !u.isUnderConstruction()) ?? false
    );
  }

  private ultimateMeta(t: UnitType): {
    icon: string;
    key: string;
    count: number | null;
  } {
    // Иконка+ключ — из ЕДИНОГО реестра UnitCatalog (добавил ульт туда → он
    // подхватится здесь автоматически). Раньше был свой switch на 13 кейсов,
    // и новый ульт без кейса маскировался под «второй МИРВ» (ловили 12.07 с
    // Небом нашим) — теперь этого не случится, т.к. реестр полный.
    // Фолбэк = МИРВ (звезда/слот по умолчанию для типов вне реестра).
    const meta = unitMeta(t) ?? unitMeta(UnitType.MIRV)!;
    // Счётчик показываем только у МЕДИА (носитель влитой ауры Мин правды).
    const count = t === UnitType.Media ? this._ministries : null;
    return { icon: meta.icon, key: meta.key, count };
  }

  // terron: ультимейты — слот МИРВ стал слотом ульты. До выбора — звезда,
  // клик открывает чузер; выбор в чузере лишь локальный пре-выбор (кнопка
  // ПОЛНОСТЬЮ заменяется на юнит, смена — ПКМ по слоту), фиксация — при первом
  // РЕАЛЬНОМ использовании (ядро, PlayerImpl.ultimateChoice: постройка
  // ульт-здания или пуск МИРВ). После фиксации чузер недоступен навсегда.
  // Спека: new-units/ULTIMATES.md
  private renderUltimateSlot() {
    const fixed = this.game?.myPlayer()?.ultimateChoice() ?? null;
    // Клавиша слота — из той же разметки, что и остальные кнопки.
    const hotkey =
      this.keybinds[ULT_SLOT_KEYBIND]?.key ?? defaultHotkeyLabel(ULT_SLOT_DEF);

    // Хост мог выключить ульты в лобби: одна доступная (обычно «базовый»
    // МИРВ) → обычная кнопка без чузера; ноль — слота нет вовсе.
    const available = Ultimates.types.filter(
      (t) => !this.game.config().isUnitDisabled(t) && !isUltRollDisabled(t),
    );
    // terron: ульты выключены в лобби → ульт-зданий (в т.ч. Ядерного завода) нет,
    // но МИРВ — базовое оружие: показываем его прямой кнопкой КАК В ОРИГИНАЛЕ
    // (без завода, только силос). ULTIMATES.md
    if (
      available.length === 0 &&
      !this.game.config().isUnitDisabled(UnitType.MIRV)
    ) {
      const m = this.ultimateMeta(UnitType.MIRV);
      return this.renderUnitItem(
        m.icon,
        m.count,
        UnitType.MIRV as PlayerBuildableUnitType,
        m.key,
        hotkey,
      );
    }
    if (available.length === 0) return null;
    // ⚠️ terron 30.09 (репорт tomsrn «где кнопка раскола?», лобби с одной МЕДИА):
    // единственная доступная ульта рисовалась ЗДАНИЕМ всегда — и после постройки
    // тоже, поэтому каст (Раскол) в слот не вставал никогда. Как только ядро
    // зафиксировало выбор, идём общим путём ниже — там подмена слота на каст.
    if (available.length === 1 && fixed === null) {
      const m = this.ultimateMeta(available[0]);
      return this.renderUnitItem(
        m.icon,
        m.count,
        available[0] as PlayerBuildableUnitType,
        m.key,
        hotkey,
      );
    }

    // terron: на панель ульта встаёт ТОЛЬКО после фиксации ядром (первая
    // постройка/пуск). Пре-выбор в чузере (_pendingUltimate) панель НЕ меняет —
    // слот остаётся звездой, но клик по карточке уже армит постройку (ghost).
    // Решение владельца: «выбираю → строю → только тогда встаёт на панель».
    const current = fixed;
    if (current !== null) {
      // terron: «ЗАМЕНА СКИЛЛА». Пока штаб СТРОИТСЯ — слот показывает здание;
      // как только достроен — слот превращается в его КАСТ (МЕДИА → Раскол,
      // Ядерный завод → МИРВ, Гидроузел → водяная ракета), кастовать можно
      // сколько угодно раз, пока штаб стоит.
      //
      // ⚠️ 06.08: раньше эти пары были ЗАХАРДКОЖЕНЫ двумя if-ами, и «Реки
      // вспять» в них не попали — штаб строился, а слот так и оставался
      // зданием («уже построено, снеси чтобы передвинуть»), то есть каст был
      // недоступен ВООБЩЕ. Теперь пара берётся из того же реестра, что и гейт
      // в ядре (CAST_UNLOCKED_BY), — новый каст-ульт больше не требует правок
      // здесь. new-units/ULTIMATES.md
      // terron 01.09: расчёт «что в слоте» переехал в UltSlots — его же читает
      // обработчик хоткея, иначе клавиша и кнопка расходятся (см. UltSlots).
      const slotType: UnitType =
        ultSlotUnitType(current, (t) => this.hqBuilt(t)) ?? current;
      const m = this.ultimateMeta(slotType);
      // ПКМ по слоту — смена выбора, пока ядро его не зафиксировало.
      return html`
        <div
          class="relative"
          @contextmenu=${(e: Event) => {
            if (fixed !== null) return;
            e.preventDefault();
            this._ultimateChooserOpen = !this._ultimateChooserOpen;
            this.requestUpdate();
          }}
        >
          ${this.renderUnitItem(
            m.icon,
            m.count,
            slotType as PlayerBuildableUnitType,
            m.key,
            hotkey,
          )}
          ${this.renderUltimateChooser()}
        </div>
      `;
    }

    // terron: пре-выбор сделан, но ядро ещё не зафиксировало → слот-звезда
    // подсвечивается («выбрано, построй/пусти чтобы закрепить»). На панель ульта
    // не встаёт до фиксации.
    const armed = this._pendingUltimate !== null;
    return html`
      <div class="flex flex-col items-center relative">
        ${this.renderUltimateChooser()}
        <div
          title=${translateText(
            armed ? "ultimate.armed_hint" : "ultimate.slot_hint",
          )}
          class="border rounded-sm px-1 pb-0.5 pt-0.5 flex items-center justify-center cursor-pointer hover:bg-yellow-500/30 text-white ${armed
            ? "border-yellow-400 bg-yellow-500/30"
            : "border-yellow-500/70 bg-yellow-600/25"} ${this
            ._ultimateChooserOpen
            ? "bg-slate-400/20"
            : ""}"
          @click=${() => {
            this._ultimateChooserOpen = !this._ultimateChooserOpen;
            this.requestUpdate();
          }}
        >
          <img src=${ultimateIcon} alt="ultimate" class="align-middle size-5" />
        </div>
      </div>
    `;
  }

  // terron: ультимейты — строки суммарных метрик за матч в тултипе слота
  // (войск переманено / ракет + территорий / захвачено бункерами).
  private renderUltimateStatLines(t: UnitType) {
    const s = this.game?.myPlayer()?.ultStats();
    if (!s) return null;
    // terron: какие счётчики показывать — из реестра UnitCatalog (единый источник).
    const lines = ultStatLines(t, s);
    if (lines.length === 0) return null;
    return html`
      <div
        class="mt-1 px-2 py-1 text-[10px] text-amber-200 border-t border-white/10 text-left"
      >
        ${lines.map(
          ({ i18nKey, value }) =>
            html`<div>
              ${translateText(i18nKey, { n: renderNumber(value) })}
            </div>`,
        )}
      </div>
    `;
  }

  // terron: ультимейты — СЕТКА ВЫБОРА 3×3 (UltimateGrid). MIRV всегда лево-верх,
  // нижний ряд — TERRON Prime (серый если не прем). Прижата к ПРАВОМУ краю слота
  // и поднята ВЫШЕ (mb-28) — чтобы не перекрывать логи атак справа.
  private renderUltimateChooser() {
    if (!this._ultimateChooserOpen) return null;
    this.ensureLoginChecked();
    this.ensureUltUnlocks();
    // terron 24.08 (репорт владельца «террор там какого хуя забыл»): ролл
    // фильтруется и КЛИЕНТСКИМ кэшем рубильника — резюмнутые матчи со старым
    // конфигом не знают TERRON_DISABLED_ULTS, а ролл обязан совпадать с /ults.
    const pool = Ultimates.types.filter(
      (t) => !this.game.config().isUnitDisabled(t) && !isUltRollDisabled(t),
    );
    // Рефреш перемешивает сетку заново — сид/разблок из ОБЩЕГО стора (синк с
    // мобильным радиалом). effectiveUltSeed = матч-сид ⊕ смещение рефрешей.
    // terron: полигон (/test) — показываем ВЕСЬ список ульт, без рулетки.
    const showAll =
      // ⚠️ terron 23.08 — ТОЛЬКО ПОЛИГОН (репорт владельца «почему у нас везде
      // все ульты отображаются, а не только по тест-ссылке»). Раньше признаком
      // был `devUnlockUlts`, но 23.08 замки на деве открыли ПО УМОЛЧАНИЮ во
      // всех лобби — и полный список поехал в каждый дев-матч. Признак
      // полигона — это флаг полигона, а не побочный эффект настройки замков.
      isTestGroundActive();
    // Прем-ряд (нижние три слота) — только у TERRON Prime: непрем выбирает из
    // шести, прем из девяти, и платный рефреш этого НЕ меняет (25.08).
    const unlocked = ultPrimeUnlocked();
    // terron 24.08: замки аккаунта НЕ занимают выбираемые слоты (см.
    // buildUltimateGrid) — закрытые ульты живут только в прем-слотах непрема.
    const grid = buildUltimateGrid(
      pool,
      effectiveUltSeed(this.game?.myPlayer()?.smallID() ?? 0),
      showAll,
      ultLockedForMe,
      unlocked,
      // terron 26.08: МИРВ прибит к слоту 0 только в БАЗОВОМ наборе — после
      // рефреша его в сетке нет вовсе (см. UltimateGrid).
      getUltRefreshOffset() === 0,
    );
    return html`
      <div
        class="absolute bottom-full right-0 mb-28 z-[110] bg-gray-900/95 border border-yellow-600/50 rounded-sm p-2 w-max shadow-lg"
      >
        <div class="text-[10px] text-yellow-300 text-center mb-1.5 font-bold">
          ${translateText("ultimate.chooser_title")}
        </div>
        <div
          class="grid gap-1 ${showAll
            ? "grid-cols-5 max-h-[60vh] overflow-y-auto"
            : "grid-cols-3"}"
        >
          ${grid.map((slot, i) =>
            this.renderUltimateGridCell(slot, unlocked, i),
          )}
        </div>
        ${this.renderUltRefreshRow()}
        <div class="text-[9px] text-gray-400 text-center mt-1.5 max-w-[220px]">
          ${L("1 выбор на игру", "1 pick per game")}
        </div>
      </div>
    `;
  }

  // terron: ЗАМКИ НА УЛЬТЫ — один раз за матч подтянуть владение (кэш в
  // localStorage уже отвечает синхронно; сеть — уточнение).
  private _ultUnlocksChecked = false;
  private ensureUltUnlocks() {
    if (this._ultUnlocksChecked) return;
    this._ultUnlocksChecked = true;
    void refreshUltUnlocks().then(() => this.requestUpdate());
  }

  /**
   * terron 23.08: нажали «цифру» секретного кода (new-units/CUBE.md).
   * Код сошёлся — постройка появляется слотом в углу сетки, а на десктопе
   * сразу армится гост, чтобы можно было ставить не глядя.
   */
  private onSecretDigit(digit: number): UnitType | null {
    const revealed = feedSecretDigit(digit);
    if (revealed === null) return null;
    // ⚠️ terron 23.08 (уточнение владельца: «не надо менять какие-то кнопки,
    // сразу гост показывай круга»): код сошёлся — НЕМЕДЛЕННО армим гост и
    // закрываем табло. Первая версия подменяла последний слот сетки, и это
    // приходилось ещё и заметить: секрет должен ощущаться как «сработало»,
    // а не как «поищи, что изменилось».
    this._pendingUltimate = revealed;
    this._ultimateChooserOpen = false;
    if (this.canBuild(revealed)) {
      this.uiState.ghostStructure = revealed as PlayerBuildableUnitType;
      toast(
        L("Ты нашёл клад — ставь", "You found a treasure — place it"),
        "success",
      );
    } else {
      toast(
        L(
          "Клад найден, но не хватает золота",
          "Treasure found — not enough gold",
        ),
        "info",
      );
    }
    // ⚠️ И ДОЖИМАЕМ ПОСЛЕ КЛИКА (просьба владельца: «надо при введении кода
    // ждать и потом делать секретный ульт, чтобы точно перезаписывать
    // установку текущего»). Тот же клик, которым набрана последняя цифра,
    // тянет за собой обычный выбор ячейки — и он затирал гост секрета. Ниже
    // выбор пропускается, а это второй рубеж: что бы ни успело армиться в
    // этом же кадре, последним словом остаётся секретная постройка.
    window.setTimeout(() => {
      if (this._pendingUltimate !== revealed) return;
      if (this.canBuild(revealed)) {
        this.uiState.ghostStructure = revealed as PlayerBuildableUnitType;
        this.requestUpdate();
      }
    }, 60);
    this.requestUpdate();
    return revealed;
  }

  // terron: строка платного рефреша сетки ульт (за ЛТС, только залогиненным).
  private renderUltRefreshRow() {
    if (this._loggedIn === null) return null; // ещё проверяем логин
    if (this._loggedIn === false) {
      // terron: у анонима кнопки нет, но ПОЛОСА ПОД СЕТКОЙ всё равно «ноль» —
      // иначе коды с нулём незалогиненным не набрать вообще.
      return html`<div
        class="text-[9px] text-gray-500 text-center mt-1.5 max-w-[220px] cursor-pointer"
        @click=${() => this.onSecretDigit(0)}
      >
        ${L("Рефреш ульт — войдите в аккаунт", "Refresh — log in first")}
      </div>`;
    }
    return html`
      <button
        ?disabled=${this._ultRefreshBusy}
        @click=${() => {
          // «Ноль» кода. Решение владельца 23.08: рефреш при этом РЕАЛЬНО
          // происходит и тратит ЛТС — это часть цены за секрет.
          this.onSecretDigit(0);
          void this.onUltRefresh();
        }}
        class="mt-1.5 w-full text-[10px] font-bold px-2 py-1 rounded-sm border border-yellow-600/60 text-yellow-200 bg-slate-800/70 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-wait cursor-pointer"
      >
        ${this._ultRefreshBusy
          ? L("Обновляю…", "Refreshing…")
          : L(
              `↻ Обновить ульты · ${ultRefreshDisplayPrice()} ЛТС`,
              `↻ Refresh · ${ultRefreshDisplayPrice()} LTS`,
            )}
      </button>
    `;
  }

  // terron: одна ячейка сетки выбора ульт. Пустая / залоченная (прем) / кликабельная.
  // `unlocked` = TERRON Prime. ⚠️ 25.08 рефреш прем-ряд больше НЕ открывает
  // (решение владельца: «реролл у премов 9 ультов, у остальных 6»).
  private renderUltimateGridCell(
    slot: UltGridSlot,
    unlocked: boolean,
    index: number,
  ) {
    // terron 23.08: СЕКРЕТНЫЕ КОДЫ (new-units/CUBE.md) — сетка это цифровая
    // клавиатура, слот = цифра по ПОЗИЦИИ. Цифру принимаем ДО всех гейтов:
    // пустые и залоченные слоты обязаны нажиматься, иначе часть кодов набрать
    // нельзя вообще.
    const digit = () => this.onSecretDigit(index + 1);
    // terron 23.08 (вопрос владельца «а циферки-селекторы сверху слева ты
    // добавил?»): номер слота печатается В УГЛУ ячейки. Без него код надо
    // набирать вслепую, считая позиции глазами, — а позиция это и есть цифра.
    const digitBadge = html`<div
      class="absolute top-0 left-0 px-[3px] text-[8px] leading-none text-slate-400/80 pointer-events-none select-none"
    >
      ${index + 1}
    </div>`;
    if (slot.type === null) {
      return html`<div
        class="relative w-16 h-[68px] border border-slate-700/40 rounded-sm bg-black/20"
        @click=${digit}
      >
        ${digitBadge}
      </div>`;
    }
    const t = slot.type;
    // terron: ЗАМКИ НА УЛЬТЫ — закрытая ульта без владения залочена так же,
    // как прем-слот, но с другой подписью (🔒 + «открыть в досье»).
    const keyLocked = ultLockedForMe(t);
    const locked = (slot.premium && !unlocked) || keyLocked;
    const m = this.ultimateMeta(t);
    const selected = this._pendingUltimate === t;
    const stateClass = locked
      ? "border-slate-700 opacity-40 grayscale cursor-not-allowed"
      : selected
        ? "border-yellow-500 bg-slate-400/20 cursor-pointer"
        : "border-slate-600 cursor-pointer hover:bg-gray-700";
    const hovered = this._hoveredUltCell === t;
    return html`
      <div
        class="relative w-16 h-[68px] flex flex-col items-center justify-center gap-0.5 border rounded-sm p-1 ${stateClass}"
        @mouseenter=${() => {
          this._hoveredUltCell = t;
        }}
        @mouseleave=${() => {
          this._hoveredUltCell = null;
        }}
        @click=${(e: Event) => {
          // Код сошёлся именно этим кликом — обычный выбор ячейки
          // ПРОПУСКАЕМ: иначе он тут же затирал гост секрета (репорт
          // владельца «если 7 доступна, ставится то, что было в 7»).
          if (digit() !== null) {
            e.stopPropagation();
            return;
          }
          if (!locked) this.pickUltimate(e, t);
        }}
      >
        ${digitBadge}
        ${hovered
          ? html`<div
              class="js-screen-tip absolute bottom-full left-1/2 -translate-x-1/2 mb-1 w-max max-w-[240px] text-left text-gray-200 text-xs bg-gray-800/95 backdrop-blur-xs rounded-sm p-2 z-[120] shadow-lg pointer-events-none"
            >
              <div class="font-bold text-sm mb-1 text-yellow-200">
                ${translateText("unit_type." + m.key)}
              </div>
              <div>
                ${translateText("build_menu.desc." + m.key, BUILD_DESC_PARAMS)}
              </div>
              ${locked
                ? html`<div class="mt-1 text-[10px] text-amber-400 font-bold">
                    ${translateText(
                      keyLocked
                        ? "ultimate.locked_hint"
                        : "ultimate.prime_locked",
                    )}
                  </div>`
                : ""}
            </div>`
          : ""}
        <img src=${m.icon} class="size-6" alt=${m.key} />
        <div class="text-[9px] text-gray-200 text-center leading-tight">
          ${translateText("unit_type." + m.key)}
        </div>
        ${locked
          ? html`<div class="text-[8px] text-amber-400 font-bold">
              ${keyLocked ? "🔒 500 💎" : "PRIME"}
            </div>`
          : html`<div
              class="flex items-center gap-0.5 text-[9px] text-yellow-300"
            >
              <img src=${goldCoinIcon} width="9" height="9" />
              ${renderNumber(this.cost(t))}
            </div>`}
      </div>
    `;
  }

  // terron: ультимейты — клик по карточке: лишь локальный пре-выбор (слот
  // становится кнопкой юнита). Фиксация — первым реальным использованием.
  private pickUltimate(e: Event, t: UnitType) {
    e.stopPropagation();
    this._pendingUltimate = t;
    // terron 23.08 (решение владельца): табло 1–0 остаётся ОТКРЫТЫМ, пока
    // здание не поставлено. Раньше оно закрывалось первым же кликом — а на нём
    // набирают секретные коды (new-units/CUBE.md), и после каждой цифры чузер
    // приходилось бы открывать заново. Закрываем в tick(), когда ядро
    // зафиксировало выбор ульты, то есть постройка реально состоялась.
    // terron: клик по карточке СРАЗУ армит постройку/пуск (ghost-превью), но
    // слот остаётся звездой — ульта встанет на панель только при фиксации ядром
    // (первая постройка/пуск). Так «выбираю → строю → тогда встаёт на панель».
    if (this.canBuild(t)) {
      this.uiState.ghostStructure = t as PlayerBuildableUnitType;
    }
    this.requestUpdate();
  }

  private renderUnitItem(
    icon: string,
    number: number | null,
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
  ) {
    if (this.game.config().isUnitDisabled(unitType)) {
      return html``;
    }
    // ⚠️ terron 01.09 — БОЕВОЙ БАГ: в тултипе печаталось
    // «unit_type.unit_type.city» и «build_menu.desc.unit_type.city».
    // Этот метод клеит префиксы САМ и ждёт КОРОТКИЙ ключ, а единый
    // `UltSlots.buttonFor` отдаёт ПОЛНЫЙ (`unit_type.<…>`) — ровно та же
    // «две формы одного ключа», из-за которой раньше кнопка подмены печатала
    // сырой ключ. Приводим здесь, в одном месте: метод принимает ЛЮБУЮ форму.
    structureKey = structureKey.replace(/^unit_type\./, "");
    const selected = this.uiState.ghostStructure === unitType;
    const hovered = this._hoveredUnit === unitType;
    const displayHotkey = hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();

    // terron: клэмп тултипа в экран — у краёв панели центрирование уводило
    // его за экран (лечим выравниванием по нужному краю кнопки).
    const alignCls =
      this._tooltipAlign === "right"
        ? "right-0"
        : this._tooltipAlign === "left"
          ? "left-0"
          : "left-1/2 -translate-x-1/2";
    return html`
      <div
        class="flex flex-col items-center relative"
        @mouseenter=${(e: MouseEvent) => {
          this._hoveredUnit = unitType;
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const cx = r.left + r.width / 2;
          this._tooltipAlign =
            window.innerWidth - cx < 140
              ? "right"
              : cx < 140
                ? "left"
                : "center";
          this.requestUpdate();
        }}
        @mouseleave=${() => {
          this._hoveredUnit = null;
          this.requestUpdate();
        }}
      >
        ${hovered
          ? html`
              <div
                class="js-screen-tip absolute bottom-full ${alignCls} mb-1 text-gray-200 text-center w-max max-w-[250px] text-xs bg-gray-800/90 backdrop-blur-xs rounded-sm p-1 z-[100] shadow-lg pointer-events-none"
              >
                <div class="font-bold text-sm mb-1">
                  ${translateText("unit_type." + structureKey)}${displayHotkey
                    ? ` [${displayHotkey}]`
                    : ""}
                </div>
                <div class="p-2">
                  ${translateText(
                    "build_menu.desc." + structureKey,
                    BUILD_DESC_PARAMS,
                  )}
                </div>
                ${unitType === UnitType.Warship
                  ? html`<div
                      class="mt-1 px-2 py-1 text-[10px] text-cyan-300 border-t border-white/10"
                    >
                      ⇧ ${translateText("build_menu.warship_shift_hint")}
                    </div>`
                  : null}
                ${this.ultBuilt(unitType)
                  ? html`<div
                      class="mt-1 px-2 py-1 text-[10px] text-amber-300 border-t border-white/10"
                    >
                      ${translateText("ultimate.rebuild_hint")}
                    </div>`
                  : this.fortUpgradeable(unitType)
                    ? html`<div
                        class="mt-1 px-2 py-1 text-[10px] text-green-300 border-t border-white/10"
                      >
                        ${translateText("ultimate.fort_upgrade_hint")}
                      </div>`
                    : null}
                ${this.renderUltimateStatLines(unitType)}
                <div class="flex items-center justify-center gap-1">
                  <img src=${goldCoinIcon} width="13" height="13" />
                  <span class="text-yellow-300"
                    >${renderNumber(this.cost(unitType))}</span
                  >
                </div>
              </div>
            `
          : null}
        <div
          class="${this.canBuild(unitType) ? "" : "opacity-40"} ${this.canBuild(
            unitType,
          ) && tutHighlighted(unitType)
            ? "tut-hl-city"
            : ""} ${tutBlocked(unitType)
            ? "tut-blocked"
            : ""} border border-slate-500 rounded-sm px-0.5 pb-0.5 flex items-center gap-0.5 cursor-pointer
             ${selected ? "hover:bg-gray-400/10" : "hover:bg-gray-800"}
             rounded-sm text-white ${selected ? "bg-slate-400/20" : ""}"
          @click=${() => {
            if (tutBlocked(unitType)) return; // обучение: строить лишнее нельзя
            if (selected) {
              this.uiState.ghostStructure = null;
            } else if (this.canBuild(unitType)) {
              this.uiState.ghostStructure = unitType;
            }
            this.requestUpdate();
          }}
          @mouseenter=${() => {
            switch (unitType) {
              case UnitType.AtomBomb:
              case UnitType.HydrogenBomb:
              // terron 25.08: терраформинг — ракеты ульты подсвечивают те же
              // шахты и ПВО, что обычные ядерки.
              case UnitType.WaterNuke:
              case UnitType.LandNuke:
              case UnitType.BlastNuke:
                this.eventBus?.emit(
                  new ToggleStructureEvent([
                    UnitType.MissileSilo,
                    UnitType.SAMLauncher,
                  ]),
                );
                break;
              case UnitType.Warship:
                this.eventBus?.emit(new ToggleStructureEvent([UnitType.Port]));
                break;
              default:
                this.eventBus?.emit(new ToggleStructureEvent([unitType]));
            }
          }}
          @mouseleave=${() =>
            this.eventBus?.emit(new ToggleStructureEvent(null))}
        >
          ${html`<div class="ml-0.5 text-[10px] relative -top-1 text-gray-400">
            ${displayHotkey}
          </div>`}
          <div class="flex items-center gap-0.5 pt-0.5 relative">
            <img src=${icon} alt=${structureKey} class="align-middle size-5" />
            ${cooldownOverlay(actionCooldown(this.game, unitType as UnitType))}
            ${number !== null
              ? html`<span class="text-xs">${renderNumber(number)}</span>`
              : null}
          </div>
        </div>
      </div>
    `;
  }
}

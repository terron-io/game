import { Centrifuge, type Subscription } from "centrifuge";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import { eventRewardOf } from "../../../core/configuration/TerronTuning";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  GameType,
  getMessageCategory,
  MessageCategory,
  MessageType,
  PlayerType,
  Tick,
  UnitType,
} from "../../../core/game/Game";
import {
  AllianceExpiredUpdate,
  AllianceExtensionUpdate,
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  BrokeAllianceUpdate,
  DisplayChatMessageUpdate,
  DisplayMessageUpdate,
  DonateEventUpdate,
  EmojiUpdate,
  GameUpdateType,
  TargetPlayerUpdate,
  UnitIncomingUpdate,
} from "../../../core/game/GameUpdates";
import type { Winner } from "../../../core/Schemas";
import { isValidGameID } from "../../../core/Schemas";
import { getApiBase } from "../../Api";
import { getAuthHeader } from "../../Auth";
import {
  acceptClanInvite,
  type ClanMine,
  declineClanInvite,
  fetchMyClans,
} from "../../ClanApi";
import { bracketPair } from "../../ClanTerm";
import { Controller } from "../../Controller";
import { acceptFriendRequest, declineFriendRequest } from "../../FriendsApi";
import { myCurrentGameID } from "../../FriendsPresence";
import { toast } from "../../Toast";
import {
  SendAllianceExtensionIntentEvent,
  SendAllianceRejectIntentEvent,
  SendAllianceRequestIntentEvent,
  SendClanInviteIntentEvent,
  SendFriendRequestIntentEvent,
  SendGetProfileIntentEvent,
  SendPlayerReportIntentEvent,
} from "../../Transport";

import { assetUrl } from "../../../core/AssetUrls";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { onlyImages } from "../../../core/Util";
import { uiIcon } from "../../components/ui/UiIcon";
import { GoToPlayerEvent, GoToUnitEvent } from "../../TransformHandler";

// terron: иконки построек/юнитов для ленты — те же ассеты, что в меню стройки.
// Рисуются прямым Lit-<img> (НЕ через onlyImages-санитайзер: src из нашего кода,
// не пользовательский ввод) → безопасно и нужного размера.
const UNIT_ICONS: Partial<Record<UnitType, string>> = {
  [UnitType.City]: assetUrl("images/CityIconWhite.svg"),
  [UnitType.Port]: assetUrl("images/PortIcon.svg"),
  [UnitType.Factory]: assetUrl("images/FactoryIconWhite.svg"),
  [UnitType.MissileSilo]: assetUrl("images/MissileSiloIconWhite.svg"),
  [UnitType.DefensePost]: assetUrl("images/ShieldIconWhite.svg"),
  [UnitType.SAMLauncher]: assetUrl("images/SamLauncherIconWhite.svg"),
  [UnitType.Warship]: assetUrl("images/BattleshipIconWhite.svg"),
  // terron: авиация — самолёт/десант = иконка самолёта, дрон = квадрокоптер. airport.md
  [UnitType.Airport]: assetUrl("images/AirportIconWhite.svg"),
  [UnitType.Airplane]: assetUrl("images/AirportIconWhite.svg"),
  [UnitType.AirborneAssault]: assetUrl("images/AirportIconWhite.svg"),
  [UnitType.SuicideDrone]: assetUrl("images/DroneIconWhite.svg"),
  // terron: ультимейты — здания-штабы. Спека: new-units/ULTIMATES.md
  [UnitType.MinistryOfTruth]: assetUrl("images/MinistryIconWhite.svg"),
  [UnitType.Fortifications]: assetUrl("images/FortIconWhite.svg"),
  [UnitType.CentralBank]: assetUrl("images/BankIconWhite.svg"),
  [UnitType.AirCommand]: assetUrl("images/AirCommandIconWhite.svg"),
  [UnitType.TankFactory]: assetUrl("images/TankIconWhite.svg"),
  [UnitType.Religion]: assetUrl("images/ReligionIconWhite.svg"),
  [UnitType.Mining]: assetUrl("images/MiningIconWhite.svg"),
  [UnitType.NuclearFactory]: assetUrl("images/NuclearFactoryIconWhite.svg"),
  [UnitType.OurSky]: assetUrl("images/OurSkyIconWhite.svg"),
  [UnitType.Piracy]: assetUrl("images/PiracyIconWhite.svg"), // terron: блокада
  [UnitType.Respite]: assetUrl("images/TruceIconWhite.svg"), // terron: передышка
  [UnitType.Olympics]: assetUrl("images/OlympicsIconWhite.svg"), // terron: олимпиада
  [UnitType.Terror]: assetUrl("images/TerrorIconWhite.svg"), // terron: террор
  [UnitType.PeacePalace]: assetUrl("images/PeacePalaceIconWhite.svg"), // terron: пакт
};
const nukeIcon = assetUrl("images/NukeIconWhite.svg");
// terron: ЕДИНЫЙ источник иконки МИРВ — всё, что про МИРВ (лента/алерт/чат),
// берёт иконку отсюда, чтобы менять в одном месте (владелец: «источник один»).
const mirvIcon = assetUrl("images/MIRVIcon.svg");
// terron: иконки и локализованные имена ракет для ленты «перехвачено» —
// сырой UnitType («Hydrogen Bomb») юзеру непонятен, показываем перевод + иконку.
const NUKE_FEED_ICONS: Record<string, string> = {
  [UnitType.AtomBomb]: assetUrl("images/NukeIconWhite.svg"),
  // terron: ультимейты — «Реки вспять» (штаб и его ракета).
  [UnitType.RiversBack]: assetUrl("images/RiversBackIconWhite.svg"),
  [UnitType.WaterNuke]: assetUrl("images/RiversBackIconWhite.svg"),
  [UnitType.HydrogenBomb]: assetUrl("images/MushroomCloudIconWhite.svg"),
  [UnitType.MIRV]: mirvIcon,
  [UnitType.MIRVWarhead]: mirvIcon,
};
const NUKE_NAME_KEYS: Record<string, string> = {
  [UnitType.AtomBomb]: "unit_type.atom_bomb",
  [UnitType.RiversBack]: "unit_type.rivers_back",
  [UnitType.WaterNuke]: "unit_type.water_nuke",
  [UnitType.HydrogenBomb]: "unit_type.hydrogen_bomb",
  [UnitType.MIRV]: "unit_type.mirv",
  [UnitType.MIRVWarhead]: "player_stats_table.unit.mirvw",
};
const boatIcon = assetUrl("images/BoatIconWhite.svg");
// terron: авиация — иконка дрона-камикадзе для ленты «дрон летит». Спека: airport.md
const droneIcon = assetUrl("images/DroneIconWhite.svg");
// terron: золото в ленте — та же иконка, что у параметра золота (ControlPanel/
// лидерборд используют GoldCoinIcon.svg).
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
// terron: нюк/альянс в тогглах — РОДНЫЕ игровые иконки (узнаваемы из меню):
// NukeIconRed = знак радиации (красный трилистник), AllianceIconBlack — чёрный
// для светлого чипа.
const nukeRedIcon = assetUrl("images/NukeIconRed.svg");
const allianceBlackIcon = assetUrl("images/AllianceIconBlack.svg");
const CHIP_IMG_ICONS: Record<string, string> = {
  gold: goldCoinIcon,
  nuke: nukeRedIcon,
  alliance: allianceBlackIcon,
};
// terron: кровавый алмаз (ПТС) — награда за победу в золотом матче. Иконку
// показываем везде, где упоминаются алмазы (решение владельца 28.07).
const goldenGem = () =>
  html`<img
    src=${assetUrl("images/BloodDiamondIcon.svg")}
    alt=""
    style="height:1.05em;width:auto;display:inline-block;vertical-align:-0.16em"
  />`;

const feedIco = (url: string) =>
  html`<img
    src=${url}
    alt=""
    style="height:1.1em;width:auto;display:inline-block;vertical-align:-0.18em"
  />`;

// terron: иконка для уведомлений о зданиях/скиллах в ленте — единый список по типу
// события. Для подрыва бомбы тип один (NUKE_DETONATED), различаем по ключу текста
// (атом/водород). Возвращает URL иконки или undefined (тогда рисуем без иконки).
function messageIcon(type: MessageType, message: string): string | undefined {
  if (
    type === MessageType.SATELLITES_THREATENED ||
    type === MessageType.SATELLITES_DOWN
  ) {
    return UNIT_ICONS[UnitType.OurSky];
  }
  if (type === MessageType.BLOCKADE) {
    return UNIT_ICONS[UnitType.Piracy];
  }
  if (type === MessageType.TERROR) {
    return UNIT_ICONS[UnitType.Terror];
  }
  if (type === MessageType.TRUCE) {
    return UNIT_ICONS[UnitType.Respite];
  }
  if (type === MessageType.PACT) {
    return UNIT_ICONS[UnitType.PeacePalace];
  }
  if (type === MessageType.CATASTROPHE) {
    return UNIT_ICONS[UnitType.Greens];
  }
  if (type === MessageType.CHERNOBYL || type === MessageType.RECULTIVATION) {
    return UNIT_ICONS[UnitType.NuclearPlant];
  }
  if (type === MessageType.INDUSTRIAL_REVOLUTION) {
    return UNIT_ICONS[UnitType.Fuel];
  }
  if (type === MessageType.RAILGUN) {
    return UNIT_ICONS[UnitType.RailGun];
  }
  if (type === MessageType.WALKING) {
    return UNIT_ICONS[UnitType.WalkingCity];
  }
  if (type === MessageType.SPACEPORT) {
    return UNIT_ICONS[UnitType.Spaceport];
  }
  if (type === MessageType.CENTRAL_BANK) {
    return UNIT_ICONS[UnitType.CentralBank];
  }
  if (type === MessageType.NUKE_DETONATED) {
    return message.includes("hydrogen")
      ? NUKE_FEED_ICONS[UnitType.HydrogenBomb]
      : nukeIcon;
  }
  return undefined;
}

import { localizeAIName } from "../../LocalizeNames";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { UIState } from "../../UIState";
import {
  getMessageTypeClasses,
  L,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";

// terron: единая лента сообщений (бывш. EventsDisplay + ActionableEvents).
// Всё в одном полупрозрачном потоке старое→новое: чат игроков/фракций, инфа
// (захваты/атаки/золото), союзы (с кнопками принять/отклонить инлайн). Сверху —
// тоглы категорий (что показывать). Срочные предупреждения (ядерка/вторжение)
// дополнительно всплывают транзитным флешем над лентой.

interface FeedButton {
  text: string;
  icon?: string; // имя uiIcon перед текстом (вместо эмодзи)
  kind: "accept" | "reject" | "gray";
  action: () => void;
  preventClose?: boolean;
}

// Свободный чат (Centrifugo). from.name = ИГРОВОЙ ник (штампует сервер из publish).
interface ChatMsg {
  text: string;
  // cid = игровой clientID автора (best-effort, для точного резолва игрока в меню
  // при одинаковых никах). slug/name — как раньше (slug server-stamped).
  from: { slug: string; name: string; cid?: string };
  ts: number;
}

interface FeedItem {
  id: number;
  description: string | TemplateResult;
  unsafeDescription?: boolean;
  type: MessageType;
  category: MessageCategory;
  highlight?: boolean;
  createdAt: number;
  onDelete?: () => void;
  focusID?: number;
  unitView?: UnitView;
  buttons?: FeedButton[];
  duration?: Tick; // actionable-итемы (запрос союза) живут ограниченно
  allianceID?: number;
  // terron (Apple UGC 1.2): для чужих чат-сообщений — автор, чтобы показать
  // «Пожаловаться»/«Заблокировать». Для своих/инфо-строк отсутствует.
  chat?: { slug: string; name: string; text: string; cid?: string };
  // terron (друзья): карточка «друг зашёл в лобби» — снимается по gameID на leave.
  friendLobbyGameID?: string;
}

// Срочные предупреждения — всплывают отдельным флешем (и дублируются в ленте).
const URGENT_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.NUKE_INBOUND,
  MessageType.HYDROGEN_BOMB_INBOUND,
  MessageType.MIRV_INBOUND,
  MessageType.NAVAL_INVASION_INBOUND,
  // terron: «Небо наше» — глобальная тревога уровня ядерной
  MessageType.SATELLITES_THREATENED,
  MessageType.SATELLITES_DOWN,
]);

// Прилетающие ядерки — отдельный заметный алерт снизу-справа (красным).
const NUKE_INBOUND_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.NUKE_INBOUND,
  MessageType.HYDROGEN_BOMB_INBOUND,
  MessageType.MIRV_INBOUND,
  // terron: авиация — дрон-камикадзе тоже срочная угроза (красный алерт). Спека: airport.md
  MessageType.SUICIDE_DRONE_INBOUND,
]);

// Тоглы категорий: [категория, иконка, имя_ru, имя_en (для подсказки)]. Порядок = порядок чипов.
const CATEGORY_LABELS: ReadonlyArray<
  [MessageCategory, string, string, string]
> = [
  // terron: 2-е поле — id UI-иконки (uiIcon), кроме "gold" → картинка-монета
  // (GoldCoinIcon, как у параметра золота). Эмодзи убраны (разнобой по платформам).
  [MessageCategory.CHAT, "message", "Чат", "Chat"],
  [MessageCategory.ATTACK, "swords", "Бой", "Battle"],
  [MessageCategory.NUKE, "nuke", "Ядерки", "Nukes"],
  [MessageCategory.ALLIANCE, "alliance", "Союзы", "Alliances"],
  [MessageCategory.TRADE, "gold", "Золото", "Gold"],
];

/**
 * terron 29.07: перекладка сообщений между вкладками ленты ПО КЛЮЧУ, а не по
 * типу. Причина: типы в ядре общие — `CONQUERED_PLAYER` несёт и «съел игрока», и
 * «получил золото за завоевание», а `CAPTURED_ENEMY_UNIT` — и трейд-шип, и
 * захваченное здание. Сменить категорию у типа = утащить лишнее.
 *
 * «Золото» = всё про деньги: перехваты торговых кораблей (свои и чужие) и
 * съедание игроков/ботов — главный источник флуда в «Бою» (репорт владельца:
 * «очень много флуда и оно мешает играть»).
 * «Союзы» = донаты: донатить можно ТОЛЬКО союзнику (canDonateGold → isFriendly).
 */
const FEED_CATEGORY_OVERRIDE: Readonly<Record<string, MessageCategory>> = {
  // деньги: торговые корабли
  "events_display.captured_enemy_trade_ship": MessageCategory.TRADE,
  "events_display.trade_ship_captured_by_enemy": MessageCategory.TRADE,
  "events_display.received_gold_from_captured_ship": MessageCategory.TRADE,
  // деньги: съел игрока/бота
  "events_display.conquered_no_gold": MessageCategory.TRADE,
  "events_display.received_gold_from_conquest": MessageCategory.TRADE,
  "events_display.ffa_rating_gained": MessageCategory.TRADE,
  // союзное действие: донат золота
  "events_display.donation_sent": MessageCategory.ALLIANCE,
  "events_display.donation_received": MessageCategory.ALLIANCE,
};

function feedCategoryOverride(message: string): MessageCategory | undefined {
  return FEED_CATEGORY_OVERRIDE[message];
}

const HIDDEN_LS_KEY = "terron-feed-hidden";
const FEED_CAP = 120;
const URGENT_TTL = 80; // тиков (~8с) держим флеш

@customElement("events-display")
export class EventsDisplay extends LitElement implements Controller {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  private active: boolean = false;
  private feed: FeedItem[] = [];
  private urgent: FeedItem[] = [];
  private _nextId = 1;
  // allianceID -> tick последней проверки (для prompt'ов продления)
  private alliancesCheckedAt = new Map<number, Tick>();

  @state() private _isVisible: boolean = false;
  @state() private hiddenCats: Set<MessageCategory> = new Set();

  // ── свободный чат (Centrifugo) ВЛИТ в ленту (единое окно) ──
  @state() private draft = "";
  @state() private chatConnected = false;
  // terron: пользовательская высота ленты (тянем верхнюю границу). null = дефолт (vh).
  @state() private feedMaxPx: number | null = null;
  // terron mobile: на телефоне лента/чат свёрнуты в кнопку по умолчанию (как OpenFront).
  @state() private collapsed = window.innerWidth < 768;
  // мобила: строка ввода показывается только по кнопке «Написать» (не держим лишнюю строку).
  @state() private chatOpen = false;
  // terron: в одиночной игре (офлайн/боты) писать некому — прячем чат-ввод.
  // gameType известен сразу на старте → дёшево. Лента событий остаётся.
  private get chatEnabled(): boolean {
    try {
      return (
        this.game?.config()?.gameConfig()?.gameType !== GameType.Singleplayer
      );
    } catch {
      return true;
    }
  }
  private get isMobile(): boolean {
    return window.matchMedia("(max-width: 767px)").matches;
  }
  private focusChatInput() {
    this.updateComplete.then(() => {
      (
        this.querySelector(".feed-chat-input") as HTMLInputElement | null
      )?.focus();
    });
  }
  // terron: лента и строка ввода — единое целое. Открыл ленту → сразу можно
  // писать; скрыл → ввод исчезает. «Написать» отдельно от ленты больше не живёт.
  private toggleFeed = () => {
    this.collapsed = !this.collapsed;
    this.chatOpen = !this.collapsed;
    if (this.chatOpen) this.focusChatInput();
  };
  // «Написать» = открыть ленту + ввод и сфокусироваться (а не «ввод без ленты»).
  private toggleChatInput = () => {
    if (!this.ensureChatAck()) return;
    this.collapsed = false;
    this.chatOpen = true;
    this.focusChatInput();
  };

  // terron (Apple UGC 1.2): окно-предупреждение перед первым письмом в чат —
  // следи за базаром, объектный контент/абьюз = бан. Подтверждение разовое (на
  // устройство). Возвращает true, если уже подтверждал.
  private chatAcked = localStorage.getItem("terron-chat-ack") === "1";
  // окно рендерим в document.body (НЕ в компоненте) — иначе position:fixed
  // ловится трансформированным нижним HUD и окно вылезает коробкой поверх ленты.
  private chatWarnEl: HTMLElement | null = null;
  private ensureChatAck(): boolean {
    if (this.chatAcked) return true;
    this.showChatRulesModal();
    return false;
  }
  private showChatRulesModal(): void {
    if (this.chatWarnEl) return;
    const ru = L("ru", "en") === "ru";
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);padding:20px;font-family:'Golos Text',system-ui,sans-serif";
    const title = ru ? "Правила чата" : "Chat rules";
    const body = ru
      ? "Следи за выражениями. Оскорбления, разжигание ненависти, объектный контент и абьюз запрещены — нарушителей баним без предупреждения. Жалобы рассматриваем в течение 24 часов."
      : "Mind your language. Harassment, hate speech, objectionable content and abuse are not tolerated — offenders are banned without warning. Reports are reviewed within 24 hours.";
    wrap.innerHTML = `<div style="max-width:360px;background:#1f2937;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:20px 18px;box-shadow:0 12px 40px rgba(0,0,0,.5)">
      <div style="font-weight:800;font-size:16px;margin-bottom:8px">${title}</div>
      <div style="font-size:13px;line-height:1.55;opacity:.85">${body}</div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button data-act="agree" style="flex:1;padding:10px;border:none;border-radius:9px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer">${ru ? "Согласен" : "I agree"}</button>
        <button data-act="cancel" style="padding:10px 14px;border:none;border-radius:9px;background:rgba(255,255,255,.08);color:#fff;cursor:pointer">${ru ? "Отмена" : "Cancel"}</button>
      </div>
    </div>`;
    wrap.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const act = t.dataset?.act;
      if (act === "agree") this.agreeChat();
      else if (t === wrap || act === "cancel") this.hideChatRulesModal();
    });
    document.body.appendChild(wrap);
    this.chatWarnEl = wrap;
  }
  private hideChatRulesModal(): void {
    this.chatWarnEl?.remove();
    this.chatWarnEl = null;
  }
  private agreeChat = () => {
    this.chatAcked = true;
    localStorage.setItem("terron-chat-ack", "1");
    this.hideChatRulesModal();
    this.collapsed = false;
    this.chatOpen = true;
    this.focusChatInput();
  };
  private resizeStartY = 0;
  private resizeStartPx = 0;

  private onResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    const feedEl = this.querySelector(
      ".events-container",
    ) as HTMLElement | null;
    this.resizeStartPx = feedEl?.getBoundingClientRect().height ?? 200;
    this.resizeStartY = e.clientY;
    window.addEventListener("pointermove", this.onResizeMove);
    window.addEventListener("pointerup", this.onResizeEnd);
  };
  private onResizeMove = (e: PointerEvent) => {
    // верхняя граница: тянем вверх (dy>0) → лента выше, вниз → ниже
    const dy = this.resizeStartY - e.clientY;
    this.feedMaxPx = Math.max(
      60,
      Math.min(window.innerHeight * 0.8, this.resizeStartPx + dy),
    );
  };
  private onResizeEnd = () => {
    window.removeEventListener("pointermove", this.onResizeMove);
    window.removeEventListener("pointerup", this.onResizeEnd);
  };
  private centrifuge: Centrifuge | null = null;
  private chatSub: Subscription | null = null;
  private friendSub: Subscription | null = null; // персональный канал друзей
  private mySlug = "";
  private myUid = ""; // аккаунт UUID (для канала friends:feed#<uid>)
  private pendingEchoes: { text: string; at: number }[] = [];
  // terron (Apple UGC 1.2): локальный блок-лист авторов чата (по slug). Сообщения
  // заблокированных мгновенно скрываются из ленты; переживает перезагрузку.
  private blocked = new Set<string>(
    (() => {
      try {
        return JSON.parse(
          localStorage.getItem("terron-chat-blocked") ?? "[]",
        ) as string[];
      } catch {
        return [];
      }
    })(),
  );

  @query(".events-container")
  private _eventsContainer?: HTMLDivElement;
  private _shouldScrollToBottom = true;

  constructor() {
    super();
    this.feed = [];
    try {
      const raw = localStorage.getItem(HIDDEN_LS_KEY);
      if (raw) this.hiddenCats = new Set(JSON.parse(raw) as MessageCategory[]);
    } catch {
      /* ignore */
    }
  }

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(
      SendAllianceRequestIntentEvent,
      this.onAllianceRequestSentConfirmation.bind(this),
    );
    window.addEventListener("keydown", this.onChatKey);
    window.addEventListener(
      "terron-open-player-menu",
      this.onOpenPlayerMenuFromTop,
    );
    window.addEventListener("terron-clan-invited", this.onClanInvited);
    window.addEventListener("terron-friend-requested", this.onFriendRequested);
    window.addEventListener(
      "terron-friend-request-sent",
      this.onFriendRequestSent,
    );
    window.addEventListener("terron-profile-result", this.onProfileResult);
    if (this.chatEnabled) void this.connectChat();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onChatKey);
    window.removeEventListener(
      "terron-open-player-menu",
      this.onOpenPlayerMenuFromTop,
    );
    window.removeEventListener("terron-clan-invited", this.onClanInvited);
    window.removeEventListener(
      "terron-friend-requested",
      this.onFriendRequested,
    );
    window.removeEventListener(
      "terron-friend-request-sent",
      this.onFriendRequestSent,
    );
    window.removeEventListener("terron-profile-result", this.onProfileResult);
    this.closePlayerMenu();
    this.teardownChat();
  }

  // Enter (когда не печатаешь в поле) — фокус в строку чата.
  private onChatKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || !this._isVisible) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
    if (this.collapsed) this.collapsed = false; // разворачиваем перед фокусом
    this.chatOpen = true; // на мобиле инпут показывается только при chatOpen
    // ждём перерисовку, затем фокус в инпут
    this.updateComplete.then(() => {
      (
        this.querySelector(".feed-chat-input") as HTMLInputElement | null
      )?.focus();
    });
  };

  private async connectChat(): Promise<void> {
    if (this.centrifuge) return;
    try {
      const wsUrl =
        getApiBase().replace(/^http/, "ws") + "/connection/websocket";
      const cf = new Centrifuge(wsUrl, {
        getToken: () => this.fetchChatToken(),
      });
      this.centrifuge = cf;
      cf.on("connected", () => (this.chatConnected = true));
      cf.on("disconnected", () => (this.chatConnected = false));
      const m = window.location.pathname.match(/\/game\/([A-Za-z0-9_-]+)/);
      const channel = m ? `game:${m[1]}` : "global:main";
      const sub = cf.newSubscription(channel, { recoverable: true });
      this.chatSub = sub;
      sub.on("publication", (ctx) => this.pushChat(ctx.data as ChatMsg));
      sub.on("subscribed", async () => {
        try {
          const h = await sub.history({ limit: 30 });
          for (const p of h.publications) this.pushChat(p.data as ChatMsg);
        } catch {
          /* история может быть пустой */
        }
      });
      sub.subscribe();
      cf.connect();
    } catch {
      /* чат необязателен — лента работает и без него */
    }
  }

  private async fetchChatToken(): Promise<string> {
    const res = await fetch(`${getApiBase()}/realtime/token`, {
      headers: { authorization: await getAuthHeader() },
    });
    if (!res.ok) throw new Error("realtime token failed");
    const j = (await res.json()) as {
      token: string;
      identity?: { slug: string; id?: string };
    };
    if (j.identity) this.mySlug = j.identity.slug;
    // terron (друзья): узнали свой аккаунт UUID → подписка на персональный канал.
    if (j.identity?.id) {
      this.myUid = j.identity.id;
      this.ensureFriendSub();
    }
    return j.token;
  }

  // terron: подписка на персональный канал друзей `friends:feed#<uid>` (пуш
  // «друг зашёл в лобби» / leave). Создаётся один раз, как узнали uid. Канал
  // user-limited (#uid) — Centrifugo пускает только владельца токена.
  private ensureFriendSub(): void {
    if (!this.centrifuge || !this.myUid || this.friendSub) return;
    try {
      const sub = this.centrifuge.newSubscription(
        `friends:feed#${this.myUid}`,
        { recoverable: true },
      );
      this.friendSub = sub;
      sub.on("publication", (ctx) => this.onFriendPush(ctx.data));
      sub.subscribe();
    } catch {
      /* канал друзей необязателен — лента/чат работают без него */
    }
  }

  // Пуш из канала друзей: друг зашёл в лобби/игру или вышел.
  private onFriendPush(data: unknown): void {
    const d = data as {
      kind?: string;
      friend?: { name?: string; slug?: string | null };
      gameID?: string;
      map?: string | null;
      state?: string;
    };
    if (!d?.gameID) return;
    if (d.kind === "friend_lobby_end") {
      this.feed = this.feed.filter((e) => e.friendLobbyGameID !== d.gameID);
      this.requestUpdate();
      return;
    }
    if (d.kind !== "friend_lobby") return;
    // Не показываем «друг в матче», если это ТА ЖЕ игра, где я сам сейчас
    // (зашёл спектатить/играю) — «зайти в себя» не предлагаем. См. friends.md.
    if (d.gameID === myCurrentGameID()) return;
    const name = d.friend?.name || L("Друг", "Friend");
    // снуз «не показывать 2ч» по slug/имени друга
    if (this.isFriendSnoozed(d.friend?.slug || name)) return;
    // не дублируем карточку того же лобби
    if (this.feed.some((e) => e.friendLobbyGameID === d.gameID)) return;
    const gameID = d.gameID;
    const inGame = d.state === "in_game";
    const where = d.map ? ` · ${d.map}` : "";
    this.addEvent({
      description: inGame
        ? L(`${name} играет${where}`, `${name} is playing${where}`)
        : L(`${name} в лобби${where}`, `${name} is in a lobby${where}`),
      type: MessageType.ALLIANCE_ACCEPTED,
      highlight: true,
      createdAt: this.game.ticks(),
      friendLobbyGameID: gameID,
      buttons: [
        {
          text: inGame ? L("Смотреть", "Watch") : L("Войти", "Join"),
          icon: "handshake",
          kind: "accept",
          action: () => {
            void import("../../SoftNavigate").then(({ softGo }) =>
              softGo(`/game/${gameID}`),
            );
          },
        },
        {
          text: L("Не показывать 2 ч", "Snooze 2h"),
          icon: "x",
          kind: "gray",
          action: () => this.snoozeFriend(d.friend?.slug || name),
        },
      ],
    });
  }

  private friendSnoozeKey(id: string): string {
    return `terron_friend_snooze_${id}`;
  }
  private isFriendSnoozed(id: string): boolean {
    const raw = localStorage.getItem(this.friendSnoozeKey(id));
    return !!raw && Number(raw) > Date.now();
  }
  private snoozeFriend(id: string): void {
    localStorage.setItem(
      this.friendSnoozeKey(id),
      String(Date.now() + 2 * 60 * 60 * 1000),
    );
  }

  private teardownChat(): void {
    this.chatSub?.unsubscribe();
    this.chatSub = null;
    this.friendSub?.unsubscribe();
    this.friendSub = null;
    this.centrifuge?.disconnect();
    this.centrifuge = null;
    this.chatConnected = false;
  }

  private pushChat(m: ChatMsg): void {
    if (!m?.text) return;
    const slug = m.from?.slug ?? "";
    // заблокированного автора не показываем вовсе (Apple UGC 1.2)
    if (slug && this.blocked.has(slug)) return;
    // своё сообщение уже показано оптимистично — не дублируем
    if (this.mySlug && slug === this.mySlug) {
      const now = Date.now();
      this.pendingEchoes = this.pendingEchoes.filter((p) => now - p.at < 10000);
      const i = this.pendingEchoes.findIndex((p) => p.text === m.text);
      if (i !== -1) {
        this.pendingEchoes.splice(i, 1);
        return;
      }
    }
    const name = m.from?.name ?? "?";
    const cid = typeof m.from?.cid === "string" ? m.from.cid : undefined;
    // мета автора кладём только для ЧУЖИХ сообщений (свои блочить/репортить незачем)
    const chat =
      slug && slug !== this.mySlug
        ? { slug, name, text: m.text, cid }
        : undefined;
    this.addChatLine(name, m.text, chat);
  }

  // terron: цвет ника в чате = цвет ТЕРРИТОРИИ игрока, но осветлённый к белому,
  // чтобы читался на тёмном фоне ленты и не сливался («белый с наложением цвета»).
  // cid нет (свой echo) → берём своего игрока. Нет игрока/цвета → дефолт.
  private nickColorHex(cid?: string, name?: string): string {
    const DEFAULT = "#e2e8f0";
    try {
      let player = cid
        ? (this.game.players().find((p) => p.clientID() === cid) as
            | PlayerView
            | undefined)
        : undefined;
      // cid со старых клиентов не приходит → фолбэк по имени (с тегом и без).
      if (!player && name) {
        player = this.game.players().find((p) => {
          const pv = p as PlayerView;
          return pv.name?.() === name || pv.displayName?.() === name;
        }) as PlayerView | undefined;
      }
      const hex = player?.territoryColor?.()?.toHex?.();
      if (!hex) return DEFAULT;
      // подмешиваем к белому (~55%) — сохраняем оттенок команды, но всегда светло.
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (!m) return DEFAULT;
      const n = parseInt(m[1], 16);
      const mix = (c: number) => Math.round(c * 0.45 + 255 * 0.55);
      const r = mix((n >> 16) & 255);
      const g = mix((n >> 8) & 255);
      const b = mix(n & 255);
      return `rgb(${r},${g},${b})`;
    } catch {
      return DEFAULT;
    }
  }

  private addChatLine(
    name: string,
    text: string,
    chat?: { slug: string; name: string; text: string; cid?: string },
  ): void {
    // Цвет ника применяется в renderRow (ветка e.chat) — description тут не
    // используется для чата, но держим осмысленным на всякий случай.
    this.addEvent({
      description: `${name}: ${text}`,
      type: MessageType.CHAT,
      createdAt: this.game.ticks(),
      highlight: true,
      chat,
    });
  }

  // terron (Apple UGC 1.2): заблокировать автора — мгновенно убрать его сообщения
  // из ленты, запомнить в localStorage. Блок локальный (как и просили).
  private blockChatAuthor(slug: string, name: string, text?: string): void {
    if (!slug) return;
    this.blocked.add(slug);
    localStorage.setItem(
      "terron-chat-blocked",
      JSON.stringify([...this.blocked]),
    );
    this.feed = this.feed.filter((e) => e.chat?.slug !== slug);
    this.requestUpdate();
    // Apple Guideline 1.2: блокировка ДОЛЖНА уведомлять разработчика о контенте
    // (не только репорт). Шлём тихий сигнал модерации в ТГ — best-effort, без
    // тоста (у блока свой тост ниже). Контент убран из ленты мгновенно (выше).
    void this.notifyModeration({
      slug,
      name,
      text: text ?? "",
      reason: "🚫 заблокирован игроком (UGC block)",
    });
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: L(`Игрок ${name} заблокирован`, `Blocked ${name}`),
          color: "gray",
          duration: 2500,
        },
      }),
    );
  }

  // terron: тихий сигнал модерации (для авто-уведомлений вроде блокировки).
  // Тот же эндпоинт, что «Жалоба» (→ запись в БД + ТГ модерации), без UI.
  private async notifyModeration(d: {
    slug: string;
    name: string;
    text: string;
    reason: string;
  }): Promise<void> {
    const gameId =
      window.location.pathname.match(/\/game\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
    try {
      await fetch(`${getApiBase()}/moderation/report`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await getAuthHeader(),
        },
        body: JSON.stringify({
          targetSlug: d.slug,
          targetName: d.name,
          messageText: d.text || "(сообщение скрыто)",
          gameId,
          reason: d.reason,
        }),
      });
    } catch {
      /* best-effort — не роняем UI */
    }
  }

  // terron: поп-ап жалобы — юзер пишет ПРИЧИНУ (на что жалуется), потом отправка.
  // Два пути: из чата (subtitle = текст сообщения, отправка по slug автора) и из
  // меню игрока в топе (без сообщения, отправка по clientID через гейм-сервер).
  private reportEl: HTMLElement | null = null;
  private openReportPopup(opts: {
    name: string;
    subtitle?: string;
    submit: (reason: string) => void;
  }): void {
    this.closeReportPopup();
    const ru = L("ru", "en") === "ru";
    const sub = opts.subtitle
      ? `<div style="font-size:13px;color:#cbd5e1;margin-bottom:10px;word-break:break-word">${EventsDisplay.escHtml(opts.name)}: «${EventsDisplay.escHtml(opts.subtitle)}»</div>`
      : `<div style="font-size:13px;color:#cbd5e1;margin-bottom:10px;word-break:break-word">${EventsDisplay.escHtml(opts.name)}</div>`;
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:20px;font-family:'Golos Text',system-ui,sans-serif";
    wrap.innerHTML = `<div style="width:320px;max-width:92vw;background:#1f2937;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.5)">
      <div style="font-weight:800;font-size:16px;margin-bottom:4px">${ru ? "Жалоба на игрока" : "Report player"}</div>
      ${sub}
      <textarea data-field="reason" rows="3" maxlength="600"
        placeholder="${ru ? "На что жалуетесь? (опишите)" : "What's the problem? (describe)"}"
        style="width:100%;box-sizing:border-box;resize:vertical;background:#111827;color:#fff;border:1px solid #374151;border-radius:9px;padding:9px;font-size:16px;font-family:inherit;outline:none"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button data-act="send" style="flex:1;padding:11px;border:none;border-radius:10px;background:#b91c1c;color:#fff;font-weight:700;cursor:pointer">${ru ? "Отправить" : "Send"}</button>
        <button data-act="cancel" style="padding:11px 14px;border:none;border-radius:10px;background:rgba(255,255,255,.08);color:#fff;cursor:pointer">${ru ? "Отмена" : "Cancel"}</button>
      </div>
    </div>`;
    wrap.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const act = t.dataset?.act;
      if (act === "send") {
        const ta = wrap.querySelector(
          "textarea[data-field=reason]",
        ) as HTMLTextAreaElement | null;
        const reason = (ta?.value ?? "").trim();
        opts.submit(reason);
        this.closeReportPopup();
      } else if (act === "cancel" || t === wrap) {
        this.closeReportPopup();
      }
    });
    document.body.appendChild(wrap);
    this.reportEl = wrap;
    this.updateComplete.then(() =>
      (wrap.querySelector("textarea") as HTMLTextAreaElement | null)?.focus(),
    );
  }

  // terron: подтверждение «жалоба отправлена» — по центру (HUD-лента вверху-слева
  // не видна). Общий тост для обоих путей жалобы.
  private reportSentToast(): void {
    const toast = document.createElement("div");
    toast.textContent = L(
      "Жалоба отправлена модератору ✓",
      "Report sent to moderators ✓",
    );
    toast.style.cssText =
      "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:100002;" +
      "background:rgba(22,101,52,.97);color:#fff;padding:14px 22px;border-radius:12px;" +
      "font:700 16px/1.35 'Golos Text',system-ui,sans-serif;text-align:center;max-width:80vw;" +
      "box-shadow:0 14px 44px rgba(0,0,0,.5);pointer-events:none;transition:opacity .35s";
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    }, 2300);
  }
  private closeReportPopup(): void {
    this.reportEl?.remove();
    this.reportEl = null;
  }

  // terron: пожаловаться — летит на бэкенд (запись в БД + уведомление в
  // Telegram-чат модерации). Реакция за 24ч.
  private async reportChatMessage(
    chat: { slug: string; name: string; text: string },
    reason: string,
  ): Promise<void> {
    const gameId =
      window.location.pathname.match(/\/game\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
    try {
      await fetch(`${getApiBase()}/moderation/report`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await getAuthHeader(),
        },
        body: JSON.stringify({
          targetSlug: chat.slug,
          targetName: chat.name,
          messageText: chat.text,
          gameId,
          reason,
        }),
      });
    } catch {
      /* жалоба не должна падать в UI — best-effort */
    }
    this.reportSentToast();
  }

  private sendChat(): void {
    const text = this.draft.trim();
    if (!text || !this.chatSub) return;
    // бэкстоп: если ввод открыли минуя «Написать» — показать предупреждение
    // и не отправлять, пока юзер не согласится (черновик сохраняем).
    if (!this.ensureChatAck()) return;
    this.draft = "";
    // Спектатор (нет myPlayer) — подписываемся ником с главной страницы,
    // а если он пуст — нейтральным «Спектатор» (не «Гость»).
    const saved = localStorage.getItem("username")?.trim();
    const nick =
      this.game.myPlayer()?.displayName() ??
      (saved && saved.length > 0 ? saved : L("Спектатор", "Spectator"));
    // name = игровой ник; сервер штампует его как from.name (полу-аноним).
    // cid = мой игровой clientID (для точного резолва игрока в меню при
    // одинаковых никах). Спектатор без clientID — не шлём (undefined отсеётся).
    const myCid = this.game.myClientID() ?? undefined;
    this.pendingEchoes.push({ text, at: Date.now() });
    // terron: echo своих сообщений — с метаданными (slug=свой, cid=свой), чтобы
    // ник красился цветом территории (в renderRow свой ник = цветной спан без
    // клик-меню). Раньше echo шёл без chat → рендерился серым.
    this.addChatLine(nick, text, {
      slug: this.mySlug,
      name: nick,
      text,
      cid: myCid,
    });
    this.chatSub.publish({ text, name: nick, cid: myCid }).catch(() => {
      /* 429/413 — у себя уже видим, молча глотаем */
    });
  }

  updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (this._eventsContainer && this._shouldScrollToBottom) {
      this._eventsContainer.scrollTop = this._eventsContainer.scrollHeight;
    }
  }

  private updateMap = [
    [GameUpdateType.DisplayEvent, this.onDisplayMessageEvent.bind(this)],
    [GameUpdateType.DisplayChatEvent, this.onDisplayChatEvent.bind(this)],
    [GameUpdateType.AllianceRequest, this.onAllianceRequestEvent.bind(this)],
    [
      GameUpdateType.AllianceRequestReply,
      this.onAllianceRequestReplyEvent.bind(this),
    ],
    [GameUpdateType.BrokeAlliance, this.onBrokeAllianceEvent.bind(this)],
    [
      GameUpdateType.AllianceExtension,
      this.onAllianceExtensionEvent.bind(this),
    ],
    [GameUpdateType.TargetPlayer, this.onTargetPlayerEvent.bind(this)],
    [GameUpdateType.Emoji, this.onEmojiMessageEvent.bind(this)],
    [GameUpdateType.UnitIncoming, this.onUnitIncomingEvent.bind(this)],
    [GameUpdateType.AllianceExpired, this.onAllianceExpiredEvent.bind(this)],
    [GameUpdateType.DonateEvent, this.onDonateEvent.bind(this)],
    // terron: ЗОЛОТОЙ МАТЧ — строка о победителе прямо в ленте (её видят все,
    // а не только победитель в своём окне итогов).
    [GameUpdateType.Win, this.onGoldenWin.bind(this)],
  ] as const;

  // terron: СОБЫТИЙНЫЙ МАТЧ — объявление один раз за матч, после фазы спавна.
  private goldenAnnounced = false;

  private isGoldenMatch(): boolean {
    return this.game.config().gameConfig().golden === true;
  }

  /** terron: алмазный матч — тот же событийный, но со своей наградой. */
  private isDiamondMatch(): boolean {
    return (
      this.isGoldenMatch() &&
      this.game.config().gameConfig().eventTier === "diamond"
    );
  }

  private eventReward(): number {
    return eventRewardOf(this.game.config().gameConfig());
  }

  private onGoldenWin(wu: { winner?: Winner }) {
    if (!this.isGoldenMatch() || wu.winner === undefined) return;
    let name: string;
    if (wu.winner[0] === "player") {
      const p = this.game.playerByClientID(wu.winner[1]);
      if (!p?.isPlayer()) return;
      name = p.displayName();
    } else {
      name = String(wu.winner[1]);
    }
    this.addEvent({
      description: html`${this.isDiamondMatch()
        ? L(
            `💎 Алмазный матч выигран: ${name}`,
            `💎 Diamond match won by ${name}`,
          )
        : L(
            `⭐ Золотой матч выигран: ${name}`,
            `⭐ Golden match won by ${name}`,
          )}
      (+${this.eventReward()} ${goldenGem()})`,
      createdAt: this.game.ticks(),
      highlight: true,
      type: MessageType.GOLDEN_MATCH,
    });
  }

  tick() {
    this.active = true;

    // terron: объявление событийного матча — как только лента стала видимой
    // (после спавна). Реплей не глушим: запись матча тоже событийная.
    if (
      !this.goldenAnnounced &&
      !this.game.inSpawnPhase() &&
      this.isGoldenMatch()
    ) {
      this.goldenAnnounced = true;
      this.addEvent({
        // Про достижение НЕ пишем (решение владельца 30.07): ачивка выдаётся не
        // всегда (первая победа / серия), а обещание в ленте выглядит как долг.
        // Обещаем только кристаллы — они начисляются каждому победителю.
        description: html`${this.isDiamondMatch()
          ? L("💎 АЛМАЗНЫЙ МАТЧ.", "💎 DIAMOND MATCH.")
          : L("⭐ ЗОЛОТОЙ МАТЧ.", "⭐ GOLDEN MATCH.")}
        ${L("Победитель получит", "The winner gets")} +${this.eventReward()}
        ${goldenGem()}`,
        createdAt: this.game.ticks(),
        highlight: true,
        type: MessageType.GOLDEN_MATCH,
      });
    }

    if (this._eventsContainer) {
      const el = this._eventsContainer;
      this._shouldScrollToBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    } else {
      this._shouldScrollToBottom = true;
    }

    // Видна всегда после фазы спавна (в т.ч. зрителям/после гибели — это чат+история).
    const visible = !this.game.inSpawnPhase();
    if (visible !== this._isVisible) {
      this._isVisible = visible;
      this.requestUpdate();
    }

    // myPlayer нужен для фильтрации «моих» сообщений; до его появления — пропускаем.
    const myPlayer = this.game.myPlayer();
    if (myPlayer) {
      if (myPlayer.isAlive()) this.checkForAllianceExpirations();

      const updates = this.game.updatesSinceLastTick();
      if (updates) {
        for (const [ut, fn] of this.updateMap) {
          updates[ut]?.forEach(fn as (event: unknown) => void);
        }
      }
    }

    // actionable-итемы (запрос/продление союза) истекают по duration; флеш — по TTL.
    const now = this.game.ticks();
    const feedKept = this.feed.filter((e) => {
      const inboundGone =
        e.unitView !== undefined &&
        URGENT_TYPES.has(e.type) &&
        !e.unitView.isActive();
      const expiredAction =
        e.duration !== undefined && now - e.createdAt >= e.duration;
      const keep = !inboundGone && !expiredAction;
      if (!keep && e.onDelete) e.onDelete();
      return keep;
    });
    const capped =
      feedKept.length > FEED_CAP ? feedKept.slice(-FEED_CAP) : feedKept;
    if (capped.length !== this.feed.length) this.feed = capped;

    const urgentKept = this.urgent.filter(
      (e) => now - e.createdAt < URGENT_TTL,
    );
    if (urgentKept.length !== this.urgent.length) this.urgent = urgentKept;

    this.requestUpdate();
  }

  // ── приём событий ───────────────────────────────────────────────────────────
  private addEvent(
    e: Omit<FeedItem, "id" | "category"> & {
      category?: MessageCategory;
      // terron: только во флеш-алерт (справа), НЕ в ленту — чтобы не дублировать
      // строку, которую уже пишем отдельным чат-сообщением (МИРВ-запуск).
      urgentOnly?: boolean;
    },
  ) {
    const { urgentOnly, ...rest } = e;
    const item: FeedItem = {
      ...rest,
      id: this._nextId++,
      category: rest.category ?? getMessageCategory(rest.type),
    };
    if (!urgentOnly) this.feed = [...this.feed, item];
    if (URGENT_TYPES.has(item.type)) {
      this.urgent = [...this.urgent, item];
    }
    this.requestUpdate();
  }

  private onAllianceRequestSentConfirmation(e: SendAllianceRequestIntentEvent) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || e.requestor.id() !== myPlayer.id()) return;
    this.addEvent({
      description: translateText("events_display.alliance_request_sent", {
        name: e.recipient.name(),
      }),
      type: MessageType.ALLIANCE_REQUEST,
      createdAt: this.game.ticks(),
    });
  }

  // terron: компактные сообщения с ИКОНКАМИ (флаг захвата + золото-монета как у
  // параметра золота). Lit-шаблон → минуя санитайзер (src/иконки из нашего кода).
  private compactTemplate(
    key: string,
    params?: Record<string, string | number>,
  ): TemplateResult | null {
    const p = params ?? {};
    const nm = localizeAIName(String(p.name ?? ""));
    switch (key) {
      case "events_display.received_gold_from_conquest":
        return html`${uiIcon("flag", 15)} ${nm} +${p.gold}
        ${feedIco(goldCoinIcon)}`;
      case "events_display.conquered_no_gold":
        return html`${uiIcon("flag", 15)} ${nm}`;
      // terron: «Перехвачена ракета …» — иконка сбитой ракеты + переведённое
      // имя (иначе в ленте сырое «Hydrogen Bomb», юзер спросит «чо за хидроген»).
      case "events_display.missile_intercepted": {
        const unit = String(p.unit ?? "");
        const nameKey = NUKE_NAME_KEYS[unit];
        const label = nameKey ? translateText(nameKey) : unit;
        const ico = NUKE_FEED_ICONS[unit];
        const txt = translateText("events_display.missile_intercepted", {
          unit: label,
        });
        return ico ? html`${feedIco(ico)} ${txt}` : html`${txt}`;
      }
      // terron: МИРВ-сообщения (запуск / сбито N/T жертве и атакующему) — ЕДИНАЯ
      // иконка МИРВ вместо эмодзи ☢️ (владелец: «источник иконок один»).
      case "events_display.mirv_incoming":
        return html`${feedIco(mirvIcon)}
        ${translateText("events_display.mirv_incoming", { name: nm })}`;
      case "events_display.mirv_intercepted":
        return html`${feedIco(mirvIcon)}
        ${translateText("events_display.mirv_intercepted", {
          intercepted: p.intercepted ?? 0,
          total: p.total ?? 0,
        })}`;
      case "events_display.mirv_intercepted_attacker":
        return html`${feedIco(mirvIcon)}
        ${translateText("events_display.mirv_intercepted_attacker", {
          intercepted: p.intercepted ?? 0,
          total: p.total ?? 0,
        })}`;
      // Пер-ПВО «перехвачено N боеголовок РГЧ ИН» (редко — щит обычно разряжает
      // батарею раньше) — тоже иконка МИРВ.
      case "events_display.mirv_warheads_intercepted":
        return html`${feedIco(mirvIcon)}
        ${translateText("events_display.mirv_warheads_intercepted", {
          count: p.count ?? 0,
        })}`;
      default:
        return null;
    }
  }

  // Захват юнита/постройки. Пиратство (🏴‍☠️ + 🚢) — ТОЛЬКО трейд-шип; постройки
  // (город/порт/силос/…) — их иконка из меню стройки. Рендерится Lit-шаблоном
  // (src иконок из нашего кода, не пользовательский ввод → безопасно, минуя санитайзер).
  private captureTemplate(
    key: string,
    params?: Record<string, string | number>,
  ): TemplateResult | null {
    const p = params ?? {};
    const name = localizeAIName(String(p.name ?? ""));
    const unit = String(p.unit ?? "");
    const isTrade = unit === UnitType.TradeShip;
    const isNuke =
      unit === UnitType.AtomBomb ||
      unit === UnitType.HydrogenBomb ||
      unit === UnitType.MIRV;
    const isBoat = isTrade || unit === UnitType.TransportShip;
    const iconUrl = UNIT_ICONS[unit as UnitType];
    // пиратство (трейд-шип) → 🏴‍☠️🚢; постройка → её иконка из меню
    const mark = isTrade
      ? html`${uiIcon("skull", 15)} ${feedIco(boatIcon)}`
      : iconUrl
        ? feedIco(iconUrl)
        : null;
    // terron: захват трейд-шипа — ОДНО компактное сообщение с золотом в трюме.
    // (общий captured_enemy_unit для трейд-шипа подавляется в onDisplayMessageEvent,
    //  чтобы не было дубля.)  🚢 {gold}+ 🪙 захвачено у {name}
    if (key === "events_display.captured_enemy_trade_ship") {
      return html`${feedIco(boatIcon)} ${p.gold}+ ${feedIco(goldCoinIcon)}
      ${translateText("events_display.feed_you_captured", { name })}`;
    }
    // обратное: у тебя угнали трейд-шип. 🚢 {gold}+ 🪙 украдено игроком {name}
    if (key === "events_display.trade_ship_captured_by_enemy") {
      return html`${feedIco(boatIcon)} ${p.gold}+ ${feedIco(goldCoinIcon)}
      ${translateText("events_display.feed_ship_stolen_by", { name })}`;
    }
    if (key === "events_display.captured_enemy_unit") {
      const txt = translateText("events_display.feed_you_captured", { name });
      return mark ? html`${mark} ${txt}` : html`${txt}`;
    }
    if (key === "events_display.unit_captured_by_enemy") {
      const txt = translateText("events_display.feed_lost_captured", { name });
      return mark ? html`${txt} ${mark}` : html`${txt}`;
    }
    if (key === "events_display.unit_destroyed") {
      if (isNuke)
        return html`${feedIco(NUKE_FEED_ICONS[unit] ?? nukeIcon)}
        ${translateText("events_display.feed_intercepted")}`;
      const url = isBoat ? boatIcon : iconUrl;
      const ic = url ? feedIco(url) : html`💥`;
      return html`💥 ${ic} ${translateText("events_display.feed_destroyed")}`;
    }
    // terron: авиация — ЕДИНЫЙ вид «сбит ПВО» с иконкой юнита (самолёт/дрон), без дубля.
    // «Ваш ✈ сбит ПВО» (красный) / «✈ сбит вражеский» (зелёный). airport.md
    if (
      key === "events_display.your_air_assault_shot_down" ||
      key === "events_display.your_drone_shot_down" ||
      key === "events_display.air_assault_shot_down" ||
      key === "events_display.drone_shot_down"
    ) {
      const url = key.includes("drone")
        ? UNIT_ICONS[UnitType.SuicideDrone]
        : UNIT_ICONS[UnitType.AirborneAssault];
      const ic = url ? feedIco(url) : html`💥`;
      const mine = key.startsWith("events_display.your_");
      return mine
        ? html`${translateText("events_display.feed_your")} ${ic}
          ${translateText("events_display.feed_shot_down_sam")}`
        : html`${ic} ${translateText("events_display.feed_shot_down_enemy")}`;
    }
    return null;
  }

  onDisplayMessageEvent(event: DisplayMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    // terron 29.07 (решение владельца): вкладка «Золото» = ВСЁ ПРО ДЕНЬГИ, а
    // «Бой» — только то, на что надо реагировать. Съедание ботов и перехваты
    // торговых кораблей флудили боевую ленту и мешали играть, поэтому уводим их
    // сюда. Донаты, наоборот, переезжают в «Союзы»: донатить можно ТОЛЬКО
    // союзнику (PlayerImpl.canDonateGold → isFriendly), это союзное действие.
    // Переопределяем КАТЕГОРИЮ ПО КЛЮЧУ сообщения, а не тип в ядре: типы
    // CAPTURED_ENEMY_UNIT / CONQUERED_PLAYER общие (ими же ходит захват зданий),
    // и смена категории у типа утащила бы в «Золото» лишнее. Плюс правка
    // остаётся клиентской — без пересборки ядра.
    const catOverride = feedCategoryOverride(event.message);
    if (
      event.playerID !== null &&
      (!myPlayer || myPlayer.smallID() !== event.playerID)
    ) {
      return;
    }
    // terron: туман войны — глобальные «мировые новости» (playerID === null:
    // кто кого съел, кто что запустил) в ленту не пускаем, это разведка.
    // Личные события (playerID = я: союзы, атаки на меня, донаты) и чат живут.
    if (
      event.playerID === null &&
      this.game.fogOfWarActive() &&
      !URGENT_TYPES.has(event.messageType) &&
      event.focusPlayerID !== myPlayer?.smallID()
    ) {
      return;
    }
    if (event.message === "events_display.received_gold_from_captured_ship") {
      return;
    }
    // terron: трейд-шип уже освещается отдельным сообщением с золотом
    // (captured_enemy_trade_ship / trade_ship_captured_by_enemy) — общий
    // unit-capture для него ПОДАВЛЯЕМ, чтобы не было дубля в ленте.
    if (
      (event.message === "events_display.captured_enemy_unit" ||
        event.message === "events_display.unit_captured_by_enemy") &&
      String(event.params?.unit ?? "") === UnitType.TradeShip
    ) {
      return;
    }
    const unitView2 =
      event.unitID !== undefined ? this.game.unit(event.unitID) : undefined;
    // Захват юнита/постройки — Lit-шаблон с иконкой (не через санитайзер).
    const capTmpl = this.captureTemplate(event.message, event.params);
    if (capTmpl) {
      this.addEvent({
        description: capTmpl,
        createdAt: this.game.ticks(),
        highlight: true,
        type: event.messageType,
        category: catOverride,
        unsafeDescription: false,
        unitView: unitView2,
        focusID: event.focusPlayerID,
      });
      return;
    }
    // Компактный иконочный вид (флаг + золото) — Lit-шаблон, не через санитайзер.
    const compTmpl = this.compactTemplate(event.message, event.params);
    if (compTmpl) {
      this.addEvent({
        description: compTmpl,
        createdAt: this.game.ticks(),
        highlight: true,
        type: event.messageType,
        category: catOverride,
        unsafeDescription: false,
        unitView: unitView2,
        focusID: event.focusPlayerID,
      });
      return;
    }
    // Прочие сообщения — обычный перевод.
    // terron: локализуем имя фракции в параметрах, как на карте.
    const params = event.params
      ? {
          ...event.params,
          ...(event.params.name !== undefined
            ? { name: localizeAIName(String(event.params.name)) }
            : {}),
        }
      : {};
    const description = event.message.startsWith("events_display.")
      ? translateText(event.message, params)
      : event.message;
    const unitView =
      event.unitID !== undefined ? this.game.unit(event.unitID) : undefined;
    // terron: иконка перед уведомлением о ските/здании (Небо наше, подрыв бомбы) —
    // как у прочих событий ленты. Узнаётся по типу/ключу события. Текст рисуем
    // Lit-шаблоном (авто-экранирование), поэтому unsafeDescription:false.
    const notifIcon = messageIcon(event.messageType, event.message);
    if (notifIcon) {
      this.addEvent({
        description: html`${feedIco(notifIcon)} ${description}`,
        createdAt: this.game.ticks(),
        highlight: true,
        type: event.messageType,
        category: catOverride,
        unsafeDescription: false,
        unitView,
        focusID: event.focusPlayerID,
      });
      return;
    }
    this.addEvent({
      description,
      createdAt: this.game.ticks(),
      highlight: true,
      type: event.messageType,
      category: catOverride,
      unsafeDescription: true,
      unitView,
      focusID: event.focusPlayerID,
    });
  }

  onDisplayChatEvent(event: DisplayChatMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID === null ||
      !myPlayer ||
      myPlayer.smallID() !== event.playerID
    ) {
      return;
    }
    const baseMessage = translateText(`chat.${event.category}.${event.key}`);
    let translatedMessage = baseMessage;
    if (event.target) {
      try {
        const targetPlayer = this.game.player(event.target);
        const targetName = targetPlayer?.displayName() ?? event.target;
        translatedMessage = baseMessage.replace("[P1]", targetName);
      } catch (e) {
        console.warn(
          `Failed to resolve player for target '${event.target}'`,
          e,
        );
        return;
      }
    }
    let otherPlayerDisplayName = "";
    if (event.recipient !== null) {
      const player = this.game.player(event.recipient);
      otherPlayerDisplayName = player ? player.displayName() : "";
    }
    this.addEvent({
      description: translateText(event.isFrom ? "chat.from" : "chat.to", {
        user: otherPlayerDisplayName,
        msg: translatedMessage,
      }),
      createdAt: this.game.ticks(),
      highlight: true,
      type: MessageType.CHAT,
      unsafeDescription: false,
    });
    this.eventBus.emit(new PlaySoundEffectEvent("message"));
  }

  // Входящий запрос союза — actionable: кнопки принять/отклонить инлайн в ленте.
  onAllianceRequestEvent(update: AllianceRequestUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || update.recipientID !== myPlayer.smallID()) return;

    const requestor = this.game.playerBySmallID(
      update.requestorID,
    ) as PlayerView;
    const recipient = this.game.playerBySmallID(
      update.recipientID,
    ) as PlayerView;

    if (!requestor.isAlliedWith(recipient)) {
      this.eventBus.emit(new PlaySoundEffectEvent("alliance-suggested"));
    }
    // Тип предлагающего + сколько у него войск (бот это «Нация», иначе игрок).
    const typeLabel =
      requestor.type() === PlayerType.Nation
        ? L("Нация", "Nation")
        : requestor.type() === PlayerType.Bot
          ? L("бот", "bot")
          : L("игрок", "player");
    this.addEvent({
      description:
        translateText("events_display.request_alliance", {
          name: requestor.displayName(),
        }) + ` · ${typeLabel} · ⚔ ${renderTroops(requestor.troops())}`,
      type: MessageType.ALLIANCE_REQUEST,
      createdAt: this.game.ticks(),
      duration: this.game.config().allianceRequestDuration(),
      focusID: update.requestorID,
      buttons: [
        {
          text: "",
          icon: "eye",
          kind: "gray",
          action: () => this.eventBus.emit(new GoToPlayerEvent(requestor)),
          preventClose: true, // «посмотреть» не закрывает запрос
        },
        {
          text: translateText("events_display.accept_alliance"),
          icon: "handshake",
          kind: "accept",
          action: () =>
            this.eventBus.emit(
              new SendAllianceRequestIntentEvent(recipient, requestor),
            ),
        },
        {
          text: translateText("events_display.reject_alliance"),
          icon: "x",
          kind: "reject",
          action: () =>
            this.eventBus.emit(new SendAllianceRejectIntentEvent(requestor)),
        },
      ],
    });
  }

  onAllianceRequestReplyEvent(update: AllianceRequestReplyUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || update.request.requestorID !== myPlayer.smallID()) return;
    const recipient = this.game.playerBySmallID(
      update.request.recipientID,
    ) as PlayerView;
    this.addEvent({
      description: translateText("events_display.alliance_request_status", {
        name: recipient.displayName(),
        status: update.accepted
          ? translateText("events_display.alliance_accepted")
          : translateText("events_display.alliance_rejected"),
      }),
      type: update.accepted
        ? MessageType.ALLIANCE_ACCEPTED
        : MessageType.ALLIANCE_REJECTED,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: update.request.recipientID,
    });
  }

  onBrokeAllianceEvent(update: BrokeAllianceUpdate) {
    // Сначала — снять открытый prompt продления для этого союза.
    this.removeAllianceRenewalEvents(update.allianceID);
    this.alliancesCheckedAt.delete(update.allianceID);

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    const betrayed = this.game.playerBySmallID(update.betrayedID) as PlayerView;
    const traitor = this.game.playerBySmallID(update.traitorID) as PlayerView;
    if (betrayed.isDisconnected()) return;

    if (!betrayed.isTraitor() && traitor === myPlayer) {
      this.eventBus.emit(new PlaySoundEffectEvent("alliance-broken"));
      // terron: МЕДИА — «наши действия оправданы»: предательство НЕ карается
      // (метки нет), поэтому и текст другой. new-units/ULTIMATES.md
      if (myPlayer.hasUltimate(UnitType.Media)) {
        this.addEvent({
          description: translateText("events_display.betrayal_media", {
            name: betrayed.displayName(),
          }),
          type: MessageType.ALLIANCE_BROKEN,
          highlight: true,
          createdAt: this.game.ticks(),
          focusID: update.betrayedID,
        });
        return;
      }
      const malusPercent = Math.round(
        (1 - this.game.config().traitorDefenseDebuff()) * 100,
      );
      const traitorDuration = Math.floor(
        this.game.config().traitorDuration() * 0.1,
      );
      const durationText =
        traitorDuration === 1
          ? translateText("events_display.duration_second")
          : translateText("events_display.duration_seconds_plural", {
              seconds: traitorDuration,
            });
      this.addEvent({
        description: translateText("events_display.betrayal_description", {
          name: betrayed.displayName(),
          malusPercent,
          durationText,
        }),
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.betrayedID,
      });
    } else if (betrayed === myPlayer) {
      this.eventBus.emit(new PlaySoundEffectEvent("alliance-broken"));
      this.addEvent({
        description: translateText("events_display.betrayed_you", {
          name: traitor.displayName(),
        }),
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.traitorID,
      });
    }
  }

  private onAllianceExtensionEvent(update: AllianceExtensionUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || myPlayer.smallID() !== update.playerID) return;
    this.removeAllianceRenewalEvents(update.allianceID);
  }

  onAllianceExpiredEvent(update: AllianceExpiredUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    const otherID =
      update.player1ID === myPlayer.smallID()
        ? update.player2ID
        : update.player2ID === myPlayer.smallID()
          ? update.player1ID
          : null;
    if (otherID === null) return;
    const other = this.game.playerBySmallID(otherID) as PlayerView;
    if (!other || !myPlayer.isAlive() || !other.isAlive()) return;
    this.addEvent({
      description: translateText("events_display.alliance_expired", {
        name: other.displayName(),
      }),
      type: MessageType.ALLIANCE_EXPIRED,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: otherID,
    });
  }

  onDonateEvent(update: DonateEventUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    const isRecipient = update.recipientId === myPlayer.id();
    const isSender = update.senderId === myPlayer.id();
    if (!isRecipient && !isSender) return;
    const other = isRecipient
      ? (this.game.player(update.senderId) as PlayerView)
      : (this.game.player(update.recipientId) as PlayerView);
    const isGold = update.donationType === "gold";
    const messageKey = isRecipient
      ? isGold
        ? "events_display.received_gold_from_player"
        : "events_display.received_troops_from_player"
      : isGold
        ? "events_display.sent_gold_to_player"
        : "events_display.sent_troops_to_player";
    const params: Record<string, string | number> = {
      name: other.displayName(),
      [isGold ? "gold" : "troops"]: renderNumber(update.amount),
    };
    this.addEvent({
      description: translateText(messageKey, params),
      type: isRecipient
        ? MessageType.DONATION_RECEIVED
        : MessageType.DONATION_SENT,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: other.smallID(),
    });
  }

  onTargetPlayerEvent(event: TargetPlayerUpdate) {
    const other = this.game.playerBySmallID(event.playerID) as PlayerView;
    const myPlayer = this.game.myPlayer() as PlayerView;
    if (!myPlayer || !myPlayer.isFriendly(other)) return;
    const target = this.game.playerBySmallID(event.targetID) as PlayerView;
    this.addEvent({
      description: translateText("events_display.attack_request", {
        name: other.displayName(),
        target: target.displayName(),
      }),
      type: MessageType.ATTACK_REQUEST,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: event.targetID,
    });
  }

  onEmojiMessageEvent(update: EmojiUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    // terron: гард (телеметрия 17.07, render_tick_error «small id undefined not
    // found»): эмодзи со ссылкой на игрока, которого ещё/уже нет в PlayerView-кэше
    // (недоингещён/ушёл), роняло весь рендер-тик. Не резолвится — молча скипаем.
    let recipient: typeof AllPlayers | PlayerView;
    let sender: PlayerView;
    try {
      recipient =
        update.emoji.recipientID === AllPlayers
          ? AllPlayers
          : (this.game.playerBySmallID(update.emoji.recipientID) as PlayerView);
      sender = this.game.playerBySmallID(update.emoji.senderID) as PlayerView;
    } catch {
      return;
    }
    if (!sender || !recipient) return;
    if (recipient === myPlayer) {
      this.addEvent({
        description: `${sender.displayName()}: ${update.emoji.message}`,
        unsafeDescription: true,
        type: MessageType.CHAT,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.emoji.senderID,
      });
    } else if (sender === myPlayer && recipient !== AllPlayers) {
      this.addEvent({
        description: translateText("events_display.sent_emoji", {
          name: (recipient as PlayerView).displayName(),
          emoji: update.emoji.message,
        }),
        unsafeDescription: true,
        type: MessageType.CHAT,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: recipient.smallID(),
      });
    }
  }

  // Сервер шлёт сырую англ. строку, но тип известен — собираем красивый шаблон с
  // иконкой и отправителем (имя парсим из строки). Высадка → лодка; ядерки → ☢️.
  private incomingTemplate(
    type: MessageType,
    rawMsg: string,
  ): TemplateResult | string {
    if (type === MessageType.NAVAL_INVASION_INBOUND) {
      const m = rawMsg.match(/from (.+?) \((.+)\)/);
      const who = m?.[1] ?? rawMsg;
      const troops = m?.[2] ?? "";
      const txt = translateText("events_display.feed_naval_incoming", {
        name: who,
      });
      return html`${feedIco(boatIcon)} ${txt}${troops ? ` · ${troops}` : ""}`;
    }
    // terron: авиация — дрон-камикадзе = своя иконка (квадрокоптер) + текст, БЕЗ «атомная».
    if (type === MessageType.SUICIDE_DRONE_INBOUND) {
      const who = rawMsg
        .replace(/⚠️/g, "")
        .replace(/^Suicide drone incoming from\s*/i, "")
        .split(" - ")[0]
        .trim();
      return html`${feedIco(droneIcon)}
      ${translateText("events_display.feed_drone_incoming", { name: who })}`;
    }
    if (
      type === MessageType.NUKE_INBOUND ||
      type === MessageType.HYDROGEN_BOMB_INBOUND ||
      type === MessageType.MIRV_INBOUND
    ) {
      const who = rawMsg.replace(/⚠️/g, "").split(" - ")[0].trim();
      const kind = translateText(
        type === MessageType.NUKE_INBOUND
          ? "events_display.feed_kind_atomic"
          : type === MessageType.HYDROGEN_BOMB_INBOUND
            ? "events_display.feed_kind_hydrogen"
            : "events_display.feed_kind_mirv",
      );
      // terron: МИРВ — своя иконка (не радиация), остальные ядерки — нюк.
      const ico = type === MessageType.MIRV_INBOUND ? mirvIcon : nukeIcon;
      return html`${feedIco(ico)}
      ${translateText("events_display.feed_nuke_incoming", { name: who, kind })}`;
    }
    return rawMsg;
  }

  onUnitIncomingEvent(event: UnitIncomingUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || myPlayer.smallID() !== event.playerID) return;
    const unitView = this.game.unit(event.unitID);
    this.addEvent({
      description: this.incomingTemplate(event.messageType, event.message),
      type: event.messageType,
      unsafeDescription: false,
      highlight: true,
      createdAt: this.game.ticks(),
      unitView,
      // terron: МИРВ-запуск уже пишем отдельной чат-строкой «В тебя запущен МИРВ
      // от X» (mirv_incoming) — в ленту дубль не добавляем, только флеш-алерт.
      urgentOnly: event.messageType === MessageType.MIRV_INBOUND,
    });
  }

  // ── prompt'ы продления союзов (бывш. ActionableEvents) ───────────────────────
  private checkForAllianceExpirations() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer?.isAlive()) return;
    const currentAllianceIds = new Set<number>();
    for (const alliance of myPlayer.alliances()) {
      currentAllianceIds.add(alliance.id);
      if (
        alliance.expiresAt >
        this.game.ticks() + this.game.config().allianceExtensionPromptOffset()
      ) {
        continue;
      }
      if (
        (this.alliancesCheckedAt.get(alliance.id) ?? 0) >=
        this.game.ticks() - this.game.config().allianceExtensionPromptOffset()
      ) {
        continue;
      }
      this.alliancesCheckedAt.set(alliance.id, this.game.ticks());
      const other = this.game.player(alliance.other) as PlayerView;
      this.addEvent({
        description: translateText("events_display.about_to_expire", {
          name: other.displayName(),
        }),
        type: MessageType.RENEW_ALLIANCE,
        createdAt: this.game.ticks(),
        focusID: other.smallID(),
        allianceID: alliance.id,
        buttons: [
          {
            text: translateText("events_display.renew_alliance", {
              name: other.displayName(),
            }),
            kind: "accept",
            action: () =>
              this.eventBus.emit(new SendAllianceExtensionIntentEvent(other)),
          },
          {
            text: translateText("events_display.ignore"),
            kind: "gray",
            action: () => {},
          },
        ],
      });
    }
    for (const [allianceId] of this.alliancesCheckedAt) {
      if (!currentAllianceIds.has(allianceId)) {
        this.removeAllianceRenewalEvents(allianceId);
        this.alliancesCheckedAt.delete(allianceId);
      }
    }
  }

  private removeAllianceRenewalEvents(allianceID: number) {
    const before = this.feed.length;
    this.feed = this.feed.filter(
      (e) =>
        !(e.type === MessageType.RENEW_ALLIANCE && e.allianceID === allianceID),
    );
    if (this.feed.length !== before) this.requestUpdate();
  }

  // ── навигация ────────────────────────────────────────────────────────────────
  private emitGoToPlayerEvent(focusID: number) {
    const target = this.game.playerBySmallID(focusID) as PlayerView;
    if (target) this.eventBus.emit(new GoToPlayerEvent(target));
  }
  private emitGoToUnitEvent(unit: UnitView) {
    this.eventBus.emit(new GoToUnitEvent(unit));
  }

  // ── фильтры ───────────────────────────────────────────────────────────────────
  private toggleCategory(cat: MessageCategory) {
    const next = new Set(this.hiddenCats);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    this.hiddenCats = next;
    try {
      localStorage.setItem(HIDDEN_LS_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
    this.requestUpdate();
  }

  private getEventDescription(
    e: FeedItem,
  ): string | TemplateResult | DirectiveResult<typeof UnsafeHTMLDirective> {
    // TemplateResult (наши сообщения с иконками) рендерим напрямую; строки с
    // unsafeDescription — через строгий onlyImages (чат/эмодзи юзера).
    if (typeof e.description !== "string") return e.description;
    return e.unsafeDescription
      ? unsafeHTML(onlyImages(e.description))
      : e.description;
  }

  // terron: меню игрока — открывается тапом по нику в чате. Ник + ресурсы
  // (если игрок жив в матче) + действия: упомянуть / мут / жалоба. Кнопки модер.
  // тут (а не на каждом сообщении). Рендерим в document.body, чтобы fixed не
  // ловился трансформированным нижним HUD (как у модалки правил).
  private playerMenuEl: HTMLElement | null = null;
  // terron: состояние единого меню игрока (для шага выбора клана при инвайте).
  private menuState: {
    name: string;
    player?: PlayerView;
    chat?: { slug: string; text: string; cid?: string };
    clans: ClanMine[];
    picker: boolean;
  } | null = null;
  // terron: clientID игрока, чьё досье запросили (ждём profile_result). См. friends.md.
  private pendingDossier: string | null = null;
  private static escHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  // terron: единое меню игрока — из чата (тап по нику) и из топа (клик по нику,
  // через событие terron-open-player-menu). Из чата есть `chat` (slug+text) →
  // доступны Мут/Жалоба; из топа их нет → только Смотреть/Упомянуть.
  private openPlayerMenu(opts: {
    name: string;
    player?: PlayerView;
    chat?: { slug: string; text: string; cid?: string };
  }): void {
    this.closePlayerMenu();
    // игрок: передан напрямую (из топа) либо резолвим из чата. Меню чата и топа
    // должно быть ОДИНАКОВЫМ. Резолв:
    //  1) по clientID (cid) из чат-сообщения — НАДЁЖНО при одинаковых никах;
    //  2) фолбэк по нику без тега/регистра (аноним/старые сообщения без cid).
    let player = opts.player;
    const cid = opts.chat?.cid;
    if (!player && cid) {
      try {
        player = this.game.players().find((pl) => pl.clientID() === cid);
      } catch {
        /* нет такого клиента (ушёл) — упадём в фолбэк по нику */
      }
    }
    if (!player) {
      const norm = (s: string) =>
        s
          .replace(/^\s*\[[^\]]*\]\s*/, "") // убрать ведущий [tag]
          .trim()
          .toLowerCase();
      const target = norm(opts.name);
      try {
        player = this.game
          .players()
          .find(
            (pl) =>
              norm(pl.displayName()) === target || norm(pl.name()) === target,
          );
      } catch {
        /* игрок не найден (спектатор/ушёл/ник не совпал) */
      }
    }
    this.menuState = {
      name: opts.name,
      player,
      chat: opts.chat,
      clans: [],
      picker: false,
    };
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);padding:20px;font-family:'Golos Text',system-ui,sans-serif";
    wrap.addEventListener("click", (e) => this.onPlayerMenuClick(e, wrap));
    document.body.appendChild(wrap);
    this.playerMenuEl = wrap;
    this.renderPlayerMenu();
    // Подгрузить мои кланы (где я лидер) для кнопки «Пригласить в клан» — только
    // для реального человека и не себя. Перерисовать, когда придут.
    const notMe =
      !!player &&
      !!player.clientID() &&
      player.clientID() !== this.game.myClientID();
    if (player && player.type() === PlayerType.Human && notMe) {
      void fetchMyClans().then((mine) => {
        if (!this.menuState) return;
        this.menuState.clans = (mine ?? []).filter((c) => c.role === "leader");
        this.renderPlayerMenu();
      });
    }
  }

  private renderPlayerMenu(): void {
    const wrap = this.playerMenuEl;
    const st = this.menuState;
    if (!wrap || !st) return;
    const ru = L("ru", "en") === "ru";
    const pri =
      "padding:11px;border:none;border-radius:10px;color:#fff;font-weight:700;cursor:pointer;font-size:14px";
    const player = st.player;
    const name = EventsDisplay.escHtml(st.name);
    const resLine = player
      ? `<div style="display:flex;gap:14px;margin-top:6px;font-size:13px;color:#cbd5e1">
          <span>⚔ ${renderNumber(player.troops())}</span>
          <span><img src="${goldCoinIcon}" style="width:14px;height:14px;vertical-align:-2px"> ${renderNumber(player.gold())}</span>
        </div>`
      : "";
    let body: string;
    if (st.picker) {
      // шаг выбора клана
      const list = st.clans
        .map((c) => {
          const b = bracketPair(c.bracket);
          const label = EventsDisplay.escHtml(`${b.l}${c.tag}${b.r} ${c.name}`);
          const tag = EventsDisplay.escHtml(c.tag);
          return `<button data-act="invclan" data-tag="${tag}" style="${pri};background:#2563eb;text-align:left">${label}</button>`;
        })
        .join("");
      body = `${list}<button data-act="back" style="${pri};background:rgba(255,255,255,.10);color:#e5e7eb">${ru ? "Назад" : "Back"}</button>`;
    } else {
      const watchBtn = player
        ? `<button data-act="watch" style="${pri};background:#0f766e">${ru ? "👁 Смотреть на карте" : "👁 View on map"}</button>`
        : "";
      const inviteBtn =
        st.clans.length > 0
          ? `<button data-act="invite" style="${pri};background:#0ea5e9">🛡 ${ru ? "Пригласить в клан" : "Invite to clan"}</button>`
          : "";
      // на себя жаловаться/мутить/дружить нельзя
      const isMe = !!player && player.clientID() === this.game.myClientID();
      // Заявка в друзья: реальный человек с валидным clientID, не я. Гейм-сервер
      // резолвит аккаунт по clientID (клиент аккаунт цели не знает) — как жалоба.
      const canAddFriend =
        !!player &&
        player.type() === PlayerType.Human &&
        !isMe &&
        isValidGameID(player.clientID() ?? "");
      const addFriendBtn = canAddFriend
        ? `<button data-act="addfriend" style="${pri};background:#7c3aed">👥 ${ru ? "Добавить в друзья" : "Add friend"}</button>`
        : "";
      // Досье: человек с валидным clientID (в т.ч. я). Сервер резолвит clientID→slug
      // и вернёт profile_result → откроем /@slug (или тост, если нет аккаунта).
      const canDossier =
        !!player &&
        player.type() === PlayerType.Human &&
        isValidGameID(player.clientID() ?? "");
      const dossierBtn = canDossier
        ? `<button data-act="dossier" style="${pri};background:#0369a1">📋 ${ru ? "Досье" : "Dossier"}</button>`
        : "";
      // Жалоба: из чата — по slug автора (с текстом); из топа — по clientID через
      // гейм-сервер (он резолвит аккаунт). На игрока из топа жалоба возможна
      // ТОЛЬКО если это человек с валидным clientID — у ботов (Нации/Трайбы)
      // clientID нет, а невалидный target кикал клиента (invalid_message).
      const canReportPlayer =
        !!player &&
        player.type() === PlayerType.Human &&
        isValidGameID(player.clientID() ?? "");
      // Мут — только для чата (это про скрытие сообщений автора).
      const reportBtn =
        (st.chat || canReportPlayer) && !isMe
          ? `<button data-act="report" style="flex:1;${pri};background:#b91c1c">🚩 ${ru ? "Жалоба" : "Report"}</button>`
          : "";
      const muteBtn = st.chat
        ? `<button data-act="mute" style="flex:1;${pri};background:rgba(255,255,255,.10);color:#e5e7eb">🔇 ${ru ? "Мут" : "Mute"}</button>`
        : "";
      const modRow =
        reportBtn || muteBtn
          ? `<div style="display:flex;gap:8px">${muteBtn}${reportBtn}</div>`
          : "";
      body = `${watchBtn}
        <button data-act="mention" style="${pri};background:#2563eb">💬 ${ru ? "Упомянуть" : "Mention"}</button>
        ${addFriendBtn}${dossierBtn}${inviteBtn}${modRow}`;
    }
    wrap.innerHTML = `<div style="width:300px;max-width:92vw;background:#1f2937;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.5)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="font-weight:800;font-size:17px;word-break:break-word;line-height:1.2">${name}</div>
        <button data-act="close" style="background:none;border:none;color:#9aa3af;font-size:18px;cursor:pointer;line-height:1">✕</button>
      </div>
      ${resLine}
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
        ${body}
      </div>
    </div>`;
  }

  private onPlayerMenuClick(e: Event, wrap: HTMLElement): void {
    const t = e.target as HTMLElement;
    const act = t.dataset?.act;
    const st = this.menuState;
    if (!st) {
      if (t === wrap) this.closePlayerMenu();
      return;
    }
    if (act === "watch") {
      if (st.player) this.eventBus.emit(new GoToPlayerEvent(st.player));
      this.closePlayerMenu();
    } else if (act === "mention") {
      this.mentionPlayer(st.name);
      this.closePlayerMenu();
    } else if (act === "addfriend") {
      const target = st.player?.clientID();
      if (target) {
        // результат (отправлено / уже друзья / лимит) придёт от сервера тостом.
        this.eventBus.emit(new SendFriendRequestIntentEvent(target));
      }
      this.closePlayerMenu();
    } else if (act === "dossier") {
      const target = st.player?.clientID();
      if (target) {
        // сервер резолвит clientID→slug и вернёт profile_result → onProfileResult.
        this.pendingDossier = target;
        this.eventBus.emit(new SendGetProfileIntentEvent(target));
      }
      this.closePlayerMenu();
    } else if (act === "invite") {
      st.picker = true;
      this.renderPlayerMenu();
    } else if (act === "back") {
      st.picker = false;
      this.renderPlayerMenu();
    } else if (act === "invclan") {
      const tag = t.dataset?.tag;
      const target = st.player?.clientID();
      if (tag && target) {
        // результат (отправлено / уже приглашён / уже в клане) придёт от сервера
        // одним тостом — оптимистичный тут НЕ показываем (был дубль-попап).
        this.eventBus.emit(new SendClanInviteIntentEvent(target, tag));
      }
      this.closePlayerMenu();
    } else if (act === "mute" && st.chat) {
      this.blockChatAuthor(st.chat.slug, st.name, st.chat.text);
      this.closePlayerMenu();
    } else if (act === "report") {
      const name = st.name;
      if (st.chat) {
        // из чата — жалоба по slug автора + текст сообщения
        const chat = st.chat;
        this.closePlayerMenu();
        this.openReportPopup({
          name,
          subtitle: chat.text,
          submit: (reason) =>
            void this.reportChatMessage(
              { slug: chat.slug, name, text: chat.text },
              reason,
            ),
        });
      } else if (st.player) {
        // из топа — жалоба по clientID через гейм-сервер (резолвит аккаунт).
        // target ДОЛЖЕН быть валидным clientID (8 симв.) — иначе сервер отвергнет
        // интент и кикнет клиента (invalid_message). Боты сюда не доходят (кнопки нет).
        const target = st.player.clientID();
        this.closePlayerMenu();
        if (!target || !isValidGameID(target)) return;
        this.openReportPopup({
          name,
          submit: (reason) => {
            this.eventBus.emit(new SendPlayerReportIntentEvent(target, reason));
            this.reportSentToast();
          },
        });
      }
    } else if (act === "close" || t === wrap) {
      this.closePlayerMenu();
    }
  }

  // terron: меня пригласили в клан (in-game) → строка в ленте с Принять/Отклонить.
  private onClanInvited = (e: Event) => {
    const d = (e as CustomEvent).detail as {
      clanTag?: string;
      clanName?: string;
      by?: string;
    };
    const clanTag = d?.clanTag;
    if (!clanTag) return;
    const clanName = d.clanName || clanTag;
    const by = d.by || "";
    this.addEvent({
      description: by
        ? L(
            `${by} зовёт тебя в клан «${clanName}»`,
            `${by} invites you to clan "${clanName}"`,
          )
        : L(
            `Приглашение в клан «${clanName}»`,
            `Invitation to clan "${clanName}"`,
          ),
      type: MessageType.ALLIANCE_REQUEST,
      highlight: true,
      createdAt: this.game.ticks(),
      buttons: [
        {
          text: L("Принять", "Accept"),
          icon: "handshake",
          kind: "accept",
          action: async () => {
            const r = await acceptClanInvite(clanTag);
            toast(
              r === true
                ? L("Ты вступил в клан", "You joined the clan")
                : L("Не удалось вступить", "Couldn't join"),
              r === true ? "success" : "error",
            );
          },
        },
        {
          text: L("Отклонить", "Decline"),
          icon: "x",
          kind: "reject",
          action: () => void declineClanInvite(clanTag),
        },
      ],
    });
  };

  // terron: меня зовут в друзья (in-game) → строка в ленте с Принять/Отклонить.
  // requestId — id заявки; accept/decline идут в platform-api под токеном адресата.
  private onFriendRequested = (e: Event) => {
    const d = (e as CustomEvent).detail as { requestId?: string; by?: string };
    const requestId = d?.requestId;
    if (!requestId) return;
    const by = d.by || "";
    const who = by || L("игрок", "player");
    this.addEvent({
      description: by
        ? L(`${by} добавляет тебя в друзья`, `${by} wants to be your friend`)
        : L("Запрос в друзья", "Friend request"),
      type: MessageType.ALLIANCE_REQUEST,
      highlight: true,
      createdAt: this.game.ticks(),
      buttons: [
        {
          text: L("Принять", "Accept"),
          icon: "handshake",
          kind: "accept",
          action: async () => {
            const ok = await acceptFriendRequest(requestId);
            toast(
              ok
                ? L("Теперь вы друзья", "You're now friends")
                : L("Не удалось принять", "Couldn't accept"),
              ok ? "success" : "error",
            );
            // итог — строкой в ленте (просил владелец)
            if (ok) {
              this.addEvent({
                description: L(
                  `Вы добавили ${who} в друзья`,
                  `You added ${who} as a friend`,
                ),
                type: MessageType.ALLIANCE_ACCEPTED,
                createdAt: this.game.ticks(),
              });
            }
          },
        },
        {
          text: L("Отклонить", "Decline"),
          icon: "x",
          kind: "reject",
          action: () => {
            void declineFriendRequest(requestId);
            this.addEvent({
              description: L(
                `Вы отклонили заявку ${who}`,
                `You declined ${who}'s request`,
              ),
              type: MessageType.ALLIANCE_REJECTED,
              createdAt: this.game.ticks(),
            });
          },
        },
      ],
    });
  };

  // terron: я ОТПРАВИЛ заявку в друзья → строка в ленте (допом к тосту).
  private onFriendRequestSent = (e: Event) => {
    const d = (e as CustomEvent).detail as {
      status?: string;
      targetName?: string;
    };
    const who = d?.targetName || L("игрок", "player");
    const desc =
      d?.status === "auto_accepted"
        ? L(`Теперь вы друзья с ${who}`, `You're now friends with ${who}`)
        : L(`Запрос в друзья отправлен: ${who}`, `Friend request sent: ${who}`);
    this.addEvent({
      description: desc,
      type: MessageType.ALLIANCE_ACCEPTED,
      createdAt: this.game.ticks(),
    });
  };

  // terron: ответ на запрос досье (get_profile) → открыть /@slug в новой вкладке,
  // или тост, если у игрока нет аккаунта. Реагируем только на СВОЙ запрос.
  private onProfileResult = (e: Event) => {
    const d = (e as CustomEvent).detail as {
      target?: string;
      slug?: string | null;
      name?: string | null;
    };
    if (!this.pendingDossier || d?.target !== this.pendingDossier) return;
    this.pendingDossier = null;
    if (d.slug) {
      window.open(`/@${d.slug}`, "_blank");
    } else {
      toast(L("У игрока нет профиля", "Player has no profile"), "info");
    }
  };

  // terron: топ зовёт меню глобальным событием (player передаётся ссылкой).
  private onOpenPlayerMenuFromTop = (e: Event) => {
    const d = (e as CustomEvent).detail as { player?: PlayerView };
    const p = d?.player;
    if (!p) return;
    // terron: меню игрока (Смотреть/Упомянуть/Жалоба) — ТОЛЬКО на реальных людей.
    // Боты (Нации/Трайбы) не имеют аккаунта/clientID → жаловаться не на кого, а
    // пустой player_report с невалидным target кикал клиента (invalid_message).
    // Клик по нику бота в топе = просто навестись на него на карте.
    if (p.type() !== PlayerType.Human) {
      this.eventBus.emit(new GoToPlayerEvent(p));
      return;
    }
    this.openPlayerMenu({ name: p.displayName(), player: p });
  };
  private closePlayerMenu(): void {
    this.playerMenuEl?.remove();
    this.playerMenuEl = null;
    this.menuState = null;
  }
  // terron: «Упомянуть» — открыть чат и подставить «Ник, » в ввод, дальше пишет юзер.
  private mentionPlayer(name: string): void {
    this.collapsed = false;
    this.chatOpen = true;
    this.draft = `${name}, `;
    this.focusChatInput();
  }

  private renderRow(e: FeedItem) {
    const cls = getMessageTypeClasses(e.type);
    // terron: чат ДРУГИХ игроков — ник кликабельный (тап → меню игрока с
    // мут/жалоба/упомянуть). Никаких кнопок на каждом сообщении (просили убрать).
    if (e.chat) {
      const c = e.chat;
      // terron: ник цветом ТЕРРИТОРИИ игрока, осветлённым к белому (читаемо на
      // тёмном фоне ленты, не сливается). Резолв по cid, фолбэк по имени.
      const nickColor = this.nickColorHex(c.cid, c.name);
      // Своё сообщение (slug == мой) — цветной СПАН без клик-меню (мут/жалоба на
      // себя не нужны). Чужое — кнопка, открывающая меню игрока.
      const isMine = !!this.mySlug && c.slug === this.mySlug;
      const nickEl = isMine
        ? html`<span style="color:${nickColor};font-weight:700"
            >${c.name}</span
          >`
        : html`<button
            class="text-left hover:underline underline-offset-2"
            style="color:${nickColor};cursor:pointer;font-weight:700"
            title=${L("Меню игрока", "Player menu")}
            @click=${() =>
              this.openPlayerMenu({
                name: c.name,
                chat: { slug: c.slug, text: c.text, cid: c.cid },
              })}
          >
            ${c.name}
          </button>`;
      return html`<div class="px-2 py-0.5 leading-snug ${cls}">
        ${nickEl}<span>: ${c.text}</span>
      </div>`;
    }
    const desc = this.getEventDescription(e);
    const clickable = e.focusID !== undefined || e.unitView !== undefined;
    const onClick = () => {
      if (e.focusID !== undefined) this.emitGoToPlayerEvent(e.focusID);
      else if (e.unitView) this.emitGoToUnitEvent(e.unitView);
    };
    // Строки с кнопками (заявки в друзья/клан/союз) — в рамке, чтобы не выглядели
    // «пусто»: подложка + бордер + скругление + отступ.
    const framed = !!e.buttons && e.buttons.length > 0;
    return html`
      <div
        class="leading-snug ${cls} ${framed
          ? "mx-2 my-1 px-3 py-2 rounded-md border border-white/20 bg-white/8 shadow-sm"
          : "px-2 py-0.5"}"
      >
        ${clickable
          ? html`<button class="text-left w-full" @click=${onClick}>
              ${desc}
            </button>`
          : html`<span>${desc}</span>`}
        ${e.buttons && e.buttons.length > 0
          ? html`<div class="flex flex-wrap gap-1.5 mt-1 mb-1">
              ${e.buttons.map(
                (btn) => html`
                  <button
                    class="px-3 py-1 rounded-sm text-xs text-white cursor-pointer transition-colors
                      ${btn.kind === "reject"
                      ? "bg-red-600 hover:bg-red-700"
                      : btn.kind === "gray"
                        ? "bg-gray-500 hover:bg-gray-600"
                        : "bg-green-600 hover:bg-green-700"}"
                    @click=${() => {
                      btn.action();
                      if (!btn.preventClose) {
                        this.feed = this.feed.filter((x) => x.id !== e.id);
                      }
                      this.requestUpdate();
                    }}
                    style="display:inline-flex;align-items:center;gap:4px"
                  >
                    ${btn.icon ? uiIcon(btn.icon, 14) : ""}${btn.text}
                  </button>
                `,
              )}
            </div>`
          : ""}
      </div>
    `;
  }

  // Окно «предатель»: таймер дебаффа + пояснение что это.
  private renderBetrayalBox() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isTraitor()) return html``;
    const remainingSeconds = Math.ceil(
      myPlayer.getTraitorRemainingTicks() / 10,
    );
    if (remainingSeconds <= 0) return html``;
    const malusPercent = Math.round(
      (1 - this.game.config().traitorDefenseDebuff()) * 100,
    );
    return html`<div
      class="bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-lg border-l-4 border-yellow-400 text-white px-2 py-1.5 text-xs lg:text-sm"
    >
      <div class="font-semibold text-yellow-300 flex items-center gap-1">
        ${uiIcon("alert", 14)} Предатель — оборона −${malusPercent}% ещё
        ${remainingSeconds}с
      </div>
      <div class="text-gray-300 text-[11px] lg:text-xs mt-0.5">
        Ты разорвал союз. Пока действует метка предателя, твоя территория
        защищается слабее. Таймер тикает до снятия штрафа.
      </div>
    </div>`;
  }

  render() {
    if (!this.active || !this._isVisible) return html``;

    const visibleFeed = this.feed.filter(
      (e) => !this.hiddenCats.has(e.category),
    );
    const nukeAlerts = this.urgent.filter((e) =>
      NUKE_INBOUND_TYPES.has(e.type),
    );
    const mobile = this.isMobile;

    const nukeTpl =
      nukeAlerts.length > 0
        ? html`<div
            class="fixed bottom-[calc(11rem+env(safe-area-inset-bottom))] sm:bottom-28 right-4 z-[10000] flex flex-col gap-1.5 items-end pointer-events-none"
          >
            ${nukeAlerts.slice(-4).map(
              (e) =>
                html`<div
                  class="bg-red-950/85 backdrop-blur-sm border border-red-500/70 rounded-lg px-3 py-2 text-red-200 font-bold text-sm lg:text-base shadow-[0_4px_20px_rgba(0,0,0,.5)] animate-pulse"
                >
                  <span class="inline-flex items-center gap-1"
                    >${this.getEventDescription(e)}</span
                  >
                </div>`,
            )}
          </div>`
        : "";

    // terron mobile: интегрированная полоса НАД ресурс-баром (как OpenFront, не оверлей).
    // terron mobile: ПЛОСКАЯ панель, слитая с ресурс-баром (как OpenFront) — один тёмный
    // блок без зазоров/скруглений. Сверху лента, снизу полоса иконок + «Написать»/«Скрыть».
    if (mobile) {
      return html`
        ${nukeTpl}
        <div
          class="flex flex-col w-full bg-gray-800/92 backdrop-blur-sm pointer-events-auto border-t border-white/10"
        >
          <!-- terron: ресайз-ручка чата (как на десктопе, но МЕНЬШЕ — экран уже).
               Видна, когда чат открыт; тянешь вверх/вниз → меняется высота ленты. -->
          ${!this.collapsed
            ? html`<div
                class="flex items-center justify-center py-1 cursor-ns-resize touch-none select-none"
                @pointerdown=${this.onResizeStart}
                title=${L(
                  "Тяни, чтобы изменить высоту чата",
                  "Drag to resize the chat",
                )}
              >
                <div class="w-6 h-1 rounded-full bg-white/40"></div>
              </div>`
            : ""}
          ${this.renderBetrayalBox()}
          ${!this.collapsed &&
          (visibleFeed.length > 0 || this.feedMaxPx !== null)
            ? html`<div
                class="overflow-y-auto text-white text-xs events-container max-h-[26vh]"
                style=${this.feedMaxPx === null
                  ? ""
                  : `height:${this.feedMaxPx}px`}
              >
                ${visibleFeed.map((e) => this.renderRow(e))}
              </div>`
            : ""}
          ${this.chatOpen && this.chatEnabled
            ? html`<div
                class="flex gap-1 w-full px-2 py-1.5 border-t border-white/10"
              >
                <input
                  class="feed-chat-input flex-1 bg-gray-900/70 text-white placeholder:text-slate-500 border border-slate-600 rounded px-2 py-1 text-base lg:text-sm outline-none focus:border-blue-400"
                  style="font-size:16px"
                  placeholder=${L("Сообщение…", "Message…")}
                  maxlength="500"
                  .value=${this.draft}
                  @input=${(e: Event) =>
                    (this.draft = (e.target as HTMLInputElement).value)}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      this.sendChat();
                    }
                  }}
                />
                <button
                  class="px-3 rounded bg-blue-600 text-white text-sm flex items-center"
                  @click=${() => this.sendChat()}
                >
                  ${uiIcon("send", 16)}
                </button>
              </div>`
            : ""}
          <div
            class="flex items-center gap-3 px-2.5 py-2 border-t border-white/10"
          >
            <div class="flex gap-3">
              ${CATEGORY_LABELS.map(([cat, icon, ru, en]) => {
                const off = this.hiddenCats.has(cat);
                return html`<button
                  class="w-7 h-7 flex items-center justify-center rounded-full ${off
                    ? "opacity-30 grayscale"
                    : ""}"
                  @click=${() => this.toggleCategory(cat)}
                  title=${L(ru, en)}
                >
                  ${CHIP_IMG_ICONS[icon]
                    ? html`<img
                        src=${CHIP_IMG_ICONS[icon]}
                        alt=""
                        style="width:17px;height:17px;display:block;object-fit:contain"
                      />`
                    : uiIcon(icon, 17)}
                </button>`;
              })}
            </div>
            <div class="flex-1"></div>
            <button
              class="text-white/90 text-sm font-medium"
              @click=${this.toggleFeed}
            >
              ${this.collapsed ? L("Чат", "Chat") : L("Скрыть", "Hide")}
            </button>
          </div>
        </div>
      `;
    }

    return html`
      ${nukeTpl}
      <div
        class="flex flex-col gap-1 w-full max-w-[92vw] lg:w-[324px] min-[1200px]:w-[270px] pointer-events-auto"
      >
        <!-- транзитный флеш срочного (ядерки/вторжения) ОТКЛЮЧЁН по просьбе:
             дублирование не нравится, идея на доработке. События всё равно идут
             в ленту ниже (категории Бой/Ядерки). this.urgent пока не рендерим.
        ${this.urgent.length > 0
          ? html`<div
              class="bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-lg border-l-4 border-red-500 text-white text-sm lg:text-base font-semibold"
            >
              ${this.urgent
                .slice(-3)
                .map(
                  (e) =>
                    html`<div
                      class="px-2 py-1 ${getMessageTypeClasses(e.type)}"
                    >
                      ${this.getEventDescription(e)}
                    </div>`,
                )}
            </div>`
          : ""}
        -->

        <!-- окно предателя (таймер + пояснение) -->
        ${this.renderBetrayalBox()}

        <!-- ряд: иконки категорий слева; на мобиле справа «Написать» + «✕» (как OpenFront),
             на десктопе — drag-ручка высоты ленты -->
        <div class="flex items-center gap-1">
          <div class="flex flex-wrap gap-1">
            ${CATEGORY_LABELS.map(([cat, icon, ru, en]) => {
              const off = this.hiddenCats.has(cat);
              return html`<button
                class="w-7 h-7 flex items-center justify-center rounded-full cursor-pointer transition-all
                  ${off
                  ? "bg-gray-700/50 opacity-40 grayscale text-gray-100"
                  : "bg-gray-200/90 text-gray-800"}"
                @click=${() => this.toggleCategory(cat)}
                title="${L(ru, en)} — ${off
                  ? L("показать", "show")
                  : L("скрыть", "hide")}"
              >
                ${CHIP_IMG_ICONS[icon]
                  ? html`<img
                      src=${CHIP_IMG_ICONS[icon]}
                      alt=""
                      style="width:17px;height:17px;display:block;object-fit:contain"
                    />`
                  : uiIcon(icon, 17)}
              </button>`;
            })}
          </div>
          <!-- terron: кнопка-фотик (снимок карты без интерфейса) — справа от
               иконок категорий, только на десктопе (на мобиле — «Написать»/«✕»). -->
          ${!mobile
            ? html`<screenshot-button
                class="shrink-0 pointer-events-auto"
              ></screenshot-button>`
            : ""}
          ${mobile
            ? html`<div class="flex-1"></div>
                ${this.chatEnabled
                  ? html`<button
                      class="px-3 h-7 rounded-full bg-blue-600 text-white text-xs font-bold shrink-0"
                      @click=${this.toggleChatInput}
                      title=${L("Написать сообщение", "Write a message")}
                    >
                      ${L("Написать", "Write")}
                    </button>`
                  : ""}
                <button
                  class="w-7 h-7 flex items-center justify-center rounded-full bg-gray-700/70 text-white text-sm shrink-0"
                  @click=${this.toggleFeed}
                  title=${this.collapsed
                    ? L("Показать ленту", "Show feed")
                    : L("Скрыть ленту", "Hide feed")}
                >
                  ${this.collapsed ? uiIcon("chevron-up", 16) : uiIcon("x", 16)}
                </button>`
            : html`<div
                class="flex-1 self-stretch min-w-10 flex items-center justify-end pr-1 cursor-ns-resize select-none touch-none"
                @pointerdown=${this.onResizeStart}
                title=${L(
                  "Тяни, чтобы изменить высоту ленты",
                  "Drag to resize the feed",
                )}
              >
                <div class="w-10 h-1 rounded-full bg-white/40"></div>
              </div>`}
        </div>

        <!-- лента: на мобиле прячется при collapsed (полоса остаётся над баром). -->
        ${(!mobile || !this.collapsed) &&
        (visibleFeed.length > 0 || this.feedMaxPx !== null)
          ? html`<div
              class="bg-gray-800/80 backdrop-blur-sm overflow-y-auto rounded-lg text-white text-xs lg:text-sm events-container ${this
                .feedMaxPx === null
                ? "max-h-[26vh] lg:max-h-[34vh]"
                : ""}"
              style=${this.feedMaxPx === null
                ? ""
                : `height:${this.feedMaxPx}px`}
            >
              ${visibleFeed.map((e) => this.renderRow(e))}
            </div>`
          : ""}

        <!-- единый чат: на десктопе всегда; на мобиле — по кнопке «Написать».
             В синглплеере (офлайн/боты) ввод скрыт — писать некому. -->
        ${(!mobile || this.chatOpen) && this.chatEnabled
          ? html`<div
              class="flex gap-1 w-full bg-gray-800/80 backdrop-blur-sm rounded-lg p-1"
            >
              <input
                class="feed-chat-input flex-1 bg-gray-900/70 text-white placeholder:text-slate-500 border border-slate-600 rounded px-2 py-1 text-base lg:text-sm outline-none focus:border-blue-400"
                placeholder=${L("Сообщение…", "Message…")}
                maxlength="500"
                .value=${this.draft}
                @input=${(e: Event) =>
                  (this.draft = (e.target as HTMLInputElement).value)}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChat();
                  }
                }}
              />
              <button
                class="px-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm"
                title=${L("Отправить", "Send")}
                @click=${() => this.sendChat()}
              >
                ➤
              </button>
            </div>`
          : ""}
      </div>
    `;
  }
}

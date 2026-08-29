import { html, svg, TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import {
  calculateServerTimeOffset,
  getCurrentLang,
  getMapName,
  getSecondsUntilServerTimestamp,
  getServerNow,
  isDevSite,
  L,
  onTranslationsReady,
  renderDuration,
  translateText,
} from "../client/Utils";
import { assetUrl } from "../core/AssetUrls";
import { EventBus } from "../core/EventBus";
import {
  ClientInfo,
  GAME_ID_REGEX,
  GameConfig,
  GameInfo,
  GameRecordSchema,
  LobbyInfoEvent,
  PublicGameInfo,
} from "../core/Schemas";
import {
  eventRewardOf,
  nextDiamondMatchAt,
  nextGoldenMatchAt,
} from "../core/configuration/TerronTuning";
import {
  Difficulty,
  GameMapSize,
  GameMode,
  GameType,
  HumansVsNations,
} from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { getApiBase } from "./Api";
import { avatarFallback, avatarSrc } from "./Avatar";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { reportHealth } from "./Health";
import type { LobbyChatPanel } from "./LobbyChatPanel";
import { JoinLobbyEvent } from "./Main";
import {
  browserGuide,
  disablePush,
  enablePush,
  isSubscribed,
  pushState,
  reportPushUi,
  showNotifyButton,
  showPushHelp,
  topicForTier,
} from "./PushNotify";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { confirmDialog, toast } from "./Toast";
import { normaliseMapKey } from "./Utils";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/LobbyConfigItem";
import "./components/LobbyPlayerView";
import { modalHeader } from "./components/ui/ModalHeader";
import { LobbyMusic } from "./sound/LobbyMusic";
import { nationsConfigToSlider } from "./utilities/GameConfigHelpers";

// terron: витрина алмазного матча — клиентское зеркало ответа GET /stats/diamond
// (platform-api/src/diamondMatch.ts). Ручка публичная, кэш 60с на стороне API.
interface DiamondWinner {
  name: string;
  /**
   * Хэндл для ссылки `/@…`: слаг ИЛИ номер аккаунта (сервер — publicHandleOf).
   * ⚠️ 26.08: раньше сюда шёл сырой слаг, которого нет у большинства игроков —
   * строка победителя вела на `/@null`. Опционален: старый API его не отдаёт.
   */
  handle?: string | null;
  slug: string | null;
  hasAvatar: boolean;
  wins: number;
}

/** Хэндл победителя для ссылки на досье. null = аккаунта нет (аноним). */
function winnerHandle(w: { handle?: string | null; slug: string | null }) {
  const h = w.handle ?? w.slug ?? null;
  return h && h !== "null" ? h : null;
}
interface DiamondBoard {
  last: {
    gameId: string;
    startedAt: string | null;
    map: string | null;
    durationSeconds: number | null;
    humans: number;
    hasReplay: boolean;
    winner: DiamondWinner | null;
  } | null;
  top: DiamondWinner[];
}

// terron: кровавый алмаз (ПТС) — награда за победу в событийном матче.
const bloodDiamondIcon = assetUrl("images/BloodDiamondIcon.svg");

@customElement("join-lobby-modal")
export class JoinLobbyModal extends BaseModal {
  @query("#lobbyIdInput") private lobbyIdInput!: HTMLInputElement;

  @property({ attribute: false }) eventBus: EventBus | null = null;

  @state() private players: ClientInfo[] = [];
  @state() private playerCount: number = 0;
  // terron: «сгорающая» полоска отсчёта в плашке статуса. Трекаем максимум
  // виденного отсчёта → доля = текущее/макс (бар убывает справа налево).
  private countdownMaxSec = 0;
  @state() private gameConfig: GameConfig | null = null;
  @state() private currentLobbyId: string = "";
  @state() private currentClientID: string = "";
  @state() private nationCount: number = 0;
  @state() private lobbyStartAt: number | null = null;
  @state() private serverTimeOffset: number = 0;
  @state() private isConnecting: boolean = true;
  @state() private lobbyCreatorClientID: string | null = null;

  // terron 10.08: СТОРОЖ ЗАВИСШЕГО ЛОББИ. Репорт игроков (и владельца): «свернул
  // браузер — лобби не стартует». Механика: свёрнутая вкладка троттлится, пинги
  // не уходят, сервер закрывает её сокет («no pings received») и в матч уже не
  // зовёт; вкладка при этом показывает последний снимок лобби ВЕЧНО — таймер
  // застывает на нуле. Ловим по факту: время старта прошло на STALE_AFTER_MS, а
  // мы всё ещё в окне лобби → шлём датчик и перезагружаем страницу (адрес
  // /diamond|/gold|/game/<id> сам заведёт куда надо). Только ПУБЛИЧНЫЕ лобби:
  // у приватного startsAt живёт своей жизнью (отсчёт хоста можно отменить).
  //
  // ⚠️ ПОРОГ ЗАВЕДОМО БОЛЬШЕ ЧЕСТНОГО СТАРТА. На startsAt сервер только НАЧИНАЕТ
  // (prestart → докачка карты), а по load_trace хвост загрузки карты бывает
  // 24-50с. С порогом 30с сторож мог перезагрузить страницу человеку, у которого
  // матч в этот момент ЧЕСТНО грузился. Держим 90с (у checkForJoinTimeout грейс
  // 60с) и вдобавок выходим, если старт уже пошёл: висит оверлей загрузки или на
  // body уже класс in-game.
  private static readonly STALE_AFTER_MS = 90_000;
  private staleHandled = false;

  private leaveLobbyOnClose = true;
  /**
   * terron 25.08: ЛИПКОЕ ЛОББИ — окно свёрнуто, но мы ВСЁ ЕЩЁ В ЛОББИ.
   * Игрок ушёл бродить по сайту (вики, топы, онлайн), внизу висит
   * <lobby-dock>. Членство держит не окно, а `Main.lobbyHandle` (сокет к
   * игровому серверу), поэтому прятать окно безопасно — лишь бы не звать
   * close(), который шлёт leave-lobby.
   */
  private minimized = false;
  private countdownTimerId: number | null = null;
  private countdownTimerPeriod = 0;
  private handledJoinTimeout = false;
  // terron: серверный отсчёт старта приватного лобби (из lobby_info). null = нет.
  @state() private startCountdownEndsAt: number | null = null;
  @state() private startCountdownByHost = false;
  private startCountdownTick: number | null = null;

  // terron: музыка в лобби + тумблер (иконка в шапке). musicOn — для реактивного
  // рендера кнопки; состояние мута — общее, в AudioBus (синхрон с площадкой).
  // (отдельно от игровой музыки, по умолчанию ВЫКЛ — см. LobbyMusic).
  private readonly lobbyMusic = new LobbyMusic(new UserSettings());
  @state() private musicOn = false; // ставится из LobbyMusic (см. syncMusicIcon)
  // terron 25.08: подписан ли этот браузер на пуш об алмазном матче. Считается
  // при открытии окна (см. syncPushIcon) — синхронного способа узнать нет,
  // PushManager.getSubscription асинхронный.
  @state() private pushOn = false;

  /** Мы в лобби: окно открыто ЛИБО свёрнуто (см. minimized). */
  private lobbySessionLive(): boolean {
    return this.isModalOpen || this.minimized;
  }

  private isPrivateLobby(): boolean {
    return this.gameConfig?.gameType === GameType.Private;
  }

  private readonly handleLobbyInfo = (event: LobbyInfoEvent) => {
    const lobby = event.lobby;
    this.currentClientID = event.myClientID;
    // Only stop showing spinner when we have player info
    if (this.isConnecting && lobby.clients) {
      this.isConnecting = false;
      // terron: вошли в лобби (спиннер снят) → музыка с fade-in (если не заглушено).
      this.lobbyMusic.start();
    }
    this.updateFromLobby({
      ...lobby,
      startsAt: lobby.startsAt ?? undefined,
    });
  };

  protected renderHeaderSlot() {
    if (!this.currentLobbyId) {
      return modalHeader({
        title: translateText("private_lobby.title"),
        onBack: () => this.closeAndLeave(),
        ariaLabel: translateText("common.close"),
      });
    }
    return modalHeader({
      // terron: у алмазного в заголовке — само событие, а не «ожидание игры»:
      // ждут тут часами, и окно должно называться тем, ради чего открыто.
      title:
        this.eventTier() === "diamond"
          ? L("Алмазный матч", "Diamond match")
          : translateText("public_lobby.title"),
      // terron: открыта шторка чата на телефоне → «назад» закрывает ЧАТ и
      // возвращает в лобби, а не выходит из него (частая ошибка — рефлекс).
      onBack: () => {
        if (this.lobbyChat()?.closeMobileIfOpen()) return;
        this.closeAndLeave();
      },
      ariaLabel: translateText("common.close"),
      rightContent: this.currentLobbyId
        ? html`<div class="flex items-center gap-2">
            ${this.isPrivateLobby()
              ? html`<copy-button
                  .lobbyId=${this.currentLobbyId}
                ></copy-button>`
              : ""}
            ${this.renderGoldenShare()}${this.renderTelegramButton()}${this.renderNotifyButton()}${this.renderMusicButton()}
          </div>`
        : undefined,
    });
  }

  /** terron: тир событийного лобби (золотой/алмазный матч) или null. */
  private eventTier(): "golden" | "diamond" | null {
    if (this.gameConfig?.golden !== true) return null;
    return this.gameConfig?.eventTier === "diamond" ? "diamond" : "golden";
  }

  // terron: СОБЫТИЙНЫЙ МАТЧ — толстая рамка вокруг окна ожидания (5px, без
  // свечения): золото у золотого, лёд у алмазного. Панель живёт в shadow DOM
  // <o-modal>, поэтому красим через CSS-переменную на хосте: переменные
  // наследуются внутрь shadow DOM.
  private appliedBorderTier: "golden" | "diamond" | null | undefined =
    undefined;
  protected updated(changed: Map<string, unknown>): void {
    super.updated?.(changed);
    const tier = this.eventTier();
    // terron: updated() зовётся на КАЖДЫЙ рендер (таймер лобби — 10 раз/с),
    // а рамка меняется только со сменой тира — стиль трогаем лишь тогда.
    if (tier === this.appliedBorderTier) return;
    this.appliedBorderTier = tier;
    this.style.setProperty(
      "--t-modal-border",
      tier === "diamond"
        ? "5px solid #4aa8d8"
        : tier === "golden"
          ? "5px solid #d4af37"
          : "none",
    );
  }

  // terron: СОБЫТИЙНЫЙ МАТЧ — «позвать народ». Копирует ПОСТОЯННУЮ ссылку /gold
  // или /diamond, а не /game/<id>: событийные лобби живут всегда, поэтому
  // ссылка не протухает — кинул в чат один раз, работает и на следующий матч.
  // terron: мемо подписей события. Обе зовут toLocaleTimeString (= создание
  // Intl.DateTimeFormat) на КАЖДЫЙ рендер, а рендер идёт 10 раз/с весь срок
  // ожидания в лобби (алмазное — часами). Ключ — всё, от чего текст зависит:
  // время старта, тир, награда, язык; день (для «сегодня/завтра») — в ключе
  // подписи отдельно. Меняется ключ → пересчёт, иначе строка из кэша.
  private inviteTextMemo: { key: string; text: string } | null = null;
  private startLabelMemo: { key: string; text: string } | null = null;

  private eventMemoKey(): string {
    return `${this.lobbyStartAt}|${this.eventTier()}|${eventRewardOf(
      this.gameConfig,
    )}|${getCurrentLang()}`;
  }

  /** Текст приглашения. Время — в поясе ПРИГЛАШАЮЩЕГО (см. eventStartLabel). */
  private eventInviteText(): string {
    // Без lobbyStartAt время берётся из расписания «от сейчас» — кэшировать
    // нечего, ключ на каждый вызов новый (слот меняется редко, но пусть считает).
    const key = this.lobbyStartAt === null ? null : this.eventMemoKey();
    if (key !== null && this.inviteTextMemo?.key === key) {
      return this.inviteTextMemo.text;
    }
    const text = this.computeEventInviteText();
    if (key !== null) this.inviteTextMemo = { key, text };
    return text;
  }

  private computeEventInviteText(): string {
    const diamond = this.eventTier() === "diamond";
    const startAt =
      this.lobbyStartAt ??
      (diamond
        ? nextDiamondMatchAt(Date.now())
        : nextGoldenMatchAt(Date.now()));
    const at = new Date(startAt).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    const reward = eventRewardOf(this.gameConfig);
    const link = `${window.location.origin}/${diamond ? "diamond" : "gold"}`;
    return diamond
      ? L(
          `💎 Алмазный матч в ${at}, победителю +${reward} алмазов → ${link}`,
          `💎 Diamond match at ${at}, winner gets +${reward} diamonds → ${link}`,
        )
      : L(
          `⭐ Золотой матч в ${at}, победителю +${reward} алмазов → ${link}`,
          `⭐ Golden match at ${at}, winner gets +${reward} diamonds → ${link}`,
        );
  }

  private renderGoldenShare() {
    // У алмазного «позвать» живёт в шапке ожидания крупной кнопкой
    // (renderDiamondHero) — дублировать её в заголовке окна незачем.
    if (this.eventTier() !== "golden") return "";
    return html`<copy-button
      .copyText=${this.eventInviteText()}
      .displayText=${L("Позвать", "Invite")}
      .showVisibilityToggle=${false}
      .compact=${true}
    ></copy-button>`;
  }

  // terron: кнопка-иконка вкл/выкл музыки лобби (нота / нота с перечёркиванием).
  private renderMusicButton() {
    const label = this.musicOn
      ? translateText("lobby_music.mute")
      : translateText("lobby_music.unmute");
    return html`
      <button
        class="p-1.5 rounded-lg text-gray-600 hover:text-black hover:bg-black/5 transition"
        title=${label}
        aria-label=${label}
        @click=${this.toggleMusic}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
          <g style="opacity:${this.musicOn ? 1 : 0.4}">
            <path
              d="M9 5l12-2v3L9 8zM9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <rect x="8" y="4" width="1.6" height="14" rx="0.8" />
            <rect x="19.4" y="2" width="1.6" height="14" rx="0.8" />
          </g>
          ${this.musicOn
            ? ""
            : svg`<line x1="2.5" y1="2.5" x2="21.5" y2="21.5" stroke="#e25555" stroke-width="3" stroke-linecap="round" />`}
        </svg>
      </button>
    `;
  }

  /**
   * terron 25.08: КОЛОКОЛЬЧИК — напоминание о следующем алмазном матче.
   *
   * Только у алмазного лобби. Золотой идёт раз в 10 минут — напоминать о нём
   * значит слать десятки пушей в день, то есть гарантированно получить
   * отписку; алмазный раз в час и есть единственное событие с расписанием,
   * ради которого стоит писать человеку.
   *
   * ⚠️ Системный запрос разрешения вызывается ТОЛЬКО после нашего «да»
   * (см. шапку PushNotify.ts): у браузера одна попытка на всю жизнь домена.
   */
  /**
   * terron 25.08: тексты колокольчика ЗАВИСЯТ ОТ ТИРА.
   *
   * Пока кнопка жила только в алмазном лобби, тексты были прибиты к нему
   * («Напомнить об алмазном матче»). Теперь она есть и в золотом — и подпись
   * «об алмазном матче» на золотом лобби прямо врёт (поймано на деве).
   * Отдельные ключи, а не подстановка `{матч}`: в русском тут четыре разных
   * падежа («об алмазнОМ матчЕ», «перед алмазнЫМ матчЕМ», «об алмазнЫХ
   * матчАХ») — одним параметром это не собрать.
   */
  private pushText(base: string): string {
    const suffix = this.eventTier() === "golden" ? "_golden" : "";
    return translateText(`push_notify.${base}${suffix}`);
  }

  private renderNotifyButton() {
    if (!showNotifyButton(this.eventTier())) return "";
    // Воронка: «увидел». Дедуп раз-за-сессию живёт в reportPushUi — модалка
    // перерисовывается по таймеру отсчёта, иначе тут был бы поток записей.
    reportPushUi("shown", this.eventTier());
    const label = this.pushOn
      ? translateText("push_notify.off")
      : this.pushText("on");
    return html`
      <button
        class="p-1.5 rounded-lg text-gray-600 hover:text-black hover:bg-black/5 transition"
        title=${label}
        aria-label=${label}
        @click=${this.toggleNotify}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
          <g style="opacity:${this.pushOn ? 1 : 0.4}">
            <path
              d="M12 2a6 6 0 00-6 6v3.6L4.4 15a1 1 0 00.9 1.5h13.4a1 1 0 00.9-1.5L18 11.6V8a6 6 0 00-6-6z"
            />
            <path d="M9.8 18a2.2 2.2 0 004.4 0z" />
          </g>
          ${this.pushOn
            ? ""
            : svg`<line x1="2.5" y1="2.5" x2="21.5" y2="21.5" stroke="#e25555" stroke-width="3" stroke-linecap="round" />`}
        </svg>
      </button>
    `;
  }

  /**
   * terron 25.08: ссылка на телеграм-бота с диплинком на подписку.
   *
   * Стоит рядом с колокольчиком намеренно: это тот же товар (напоминание о
   * матче) другим каналом. Телега работает там, где пуши не работают вовсе —
   * в Safari на iOS без установки на «Домой», — и не тратит одноразовое
   * разрешение браузера.
   *
   * ⚠️ Гейт площадки — класс `t-external-link`, ТОТ ЖЕ, что у ссылок футера:
   * правило `html.gp-embed:not(.itch-embed)` в terron-theme.css прячет его
   * внутри VK/Яндекса/Пикабу (замечание модерации «сторонние ссылки») и
   * оставляет на сайте, в наших приложениях и на itch. Своей проверки тут
   * нарочно НЕТ: второй источник правды разъехался бы с первым.
   */
  private renderTelegramButton() {
    // terron 25.08 (решение владельца «во всех лобби, везде и тг и пуши»):
    // кнопка живёт в любом лобби. Телега — самый живучий канал: работает там,
    // где пуши не работают вовсе (Safari на iOS без установки на «Домой»), и
    // не тратит одноразовое разрешение браузера.
    //
    // ⚠️ Ведём на КАНАЛ @terron_io, а не на бота (решение владельца 25.08).
    // У бота подписка на анонсы есть только для алмазных матчей и живёт
    // по-чатно; канал же один на всё и работает одинаково из любого лобби —
    // никаких диплинков и никаких обещаний, которых нельзя сдержать.
    const label = translateText("push_notify.telegram");
    return html`
      <a
        href="https://t.me/terron_io"
        target="_blank"
        rel="noopener noreferrer"
        class="t-external-link p-1.5 rounded-lg text-gray-600 hover:text-black hover:bg-black/5 transition"
        @click=${() => reportPushUi("tg_click", this.eventTier())}
        title=${label}
        aria-label=${label}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
          <path
            d="M21.3 3.2 2.9 10.3c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.4c.3.8 1.3 1 1.9.4l2.5-2.4 4.6 3.4c.7.5 1.6.1 1.8-.7l3.1-14.7c.2-.9-.7-1.6-1.5-1.3zM9.6 14.1l8.3-5.6-6.9 6.6-.3 3z"
          />
        </svg>
      </a>
    `;
  }

  /**
   * Разговор с игроком идёт ДО браузера: сперва наш вопрос, и только на «да»
   * системный запрос. Уже отказал раньше — сразу инструкция для его браузера,
   * потому что повторный системный запрос не покажется никогда.
   */
  private toggleNotify = async () => {
    reportPushUi("bell_click", this.eventTier());
    if (this.pushOn) {
      const off = await confirmDialog(
        this.pushText("confirm_off"),
        translateText("push_notify.yes_off"),
        translateText("common.cancel"),
      );
      if (!off) return;
      await disablePush();
      this.pushOn = false;
      reportPushUi("unsubscribed", this.eventTier());
      toast(translateText("push_notify.turned_off"), "info");
      return;
    }
    if (pushState() === "denied") {
      reportPushUi("denied", this.eventTier());
      showPushHelp(browserGuide());
      return;
    }
    const yes = await confirmDialog(
      this.pushText("confirm_on"),
      translateText("push_notify.yes_on"),
      translateText("push_notify.no_thanks"),
    );
    if (!yes) return;
    const res = await enablePush(topicForTier(this.eventTier()));
    if (res === "ok" || res === "already") {
      this.pushOn = true;
      reportPushUi("subscribed", this.eventTier());
      toast(this.pushText("subscribed"), "success");
    } else if (res === "denied") {
      reportPushUi("denied", this.eventTier());
      showPushHelp(browserGuide());
    } else if (res === "unsupported") {
      toast(translateText("push_notify.unsupported"), "error");
    } else {
      toast(translateText("push_notify.failed"), "error");
    }
  };

  /** Состояние подписки читается асинхронно — при открытии окна. */
  private syncPushIcon = () => {
    void isSubscribed()
      .then((on) => {
        this.pushOn = on;
      })
      .catch(() => undefined);
  };

  protected renderBody() {
    // Pre-join state: show lobby ID input form
    if (!this.currentLobbyId) {
      return this.renderJoinForm();
    }

    // Post-join state: show lobby info (identical for public & private)
    const secondsRemaining =
      this.lobbyStartAt !== null
        ? getSecondsUntilServerTimestamp(
            this.lobbyStartAt,
            this.serverTimeOffset,
          )
        : null;
    // terron: у АЛМАЗНОГО отсчёт живёт в шапке ожидания (renderDiamondHero) —
    // внизу пишем, чего ждём на самом деле: людей. Два таймера с разной
    // разрядностью на одном экране читаются как рассинхрон.
    const heroOwnsCountdown = this.eventTier() === "diamond";
    const statusLabel =
      secondsRemaining === null || heroOwnsCountdown
        ? translateText("public_lobby.waiting_for_players")
        : secondsRemaining > 0
          ? translateText("public_lobby.starting_in", {
              time: renderDuration(secondsRemaining),
            })
          : translateText("public_lobby.started");
    // terron: доля для «сгорающей» полоски (трекер макс. отсчёта). Долю берём
    // из МИЛЛИСЕКУНД до старта, а не из secondsRemaining — тот целочисленный
    // (Math.floor) и давал ступеньки. В паре с учащённым тиком (см.
    // syncCountdownTimer) полоса едет плавно, без опоры на CSS-transition.
    if (secondsRemaining === null) {
      this.countdownMaxSec = 0;
    } else if (secondsRemaining > this.countdownMaxSec) {
      this.countdownMaxSec = secondsRemaining;
    }
    const msRemaining =
      this.lobbyStartAt !== null
        ? Math.max(0, this.lobbyStartAt - getServerNow(this.serverTimeOffset))
        : 0;
    const countdownFrac =
      this.countdownMaxSec > 0
        ? Math.max(0, Math.min(1, msRemaining / (this.countdownMaxSec * 1000)))
        : 0;
    const maxPlayers = this.gameConfig?.maxPlayers ?? 0;
    const playerCount = this.players?.length ?? 0;
    const hostClientID = this.isPrivateLobby()
      ? (this.lobbyCreatorClientID ?? "")
      : "";
    return html`
      <div class="flex flex-col h-full">
        <div class="flex-1 custom-scrollbar p-6 space-y-4 mr-1">
          ${this.isConnecting
            ? html`
                <div
                  class="min-h-[240px] flex flex-col items-center justify-center gap-4"
                >
                  <div
                    class="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin"
                  ></div>
                  <p class="text-center text-white/80 text-sm">
                    ${translateText("public_lobby.connecting")}
                  </p>
                </div>
              `
            : html`
                ${this.renderDiamondHero()}${this.renderDiamondStrip()}
                ${this.gameConfig ? this.renderGameConfig() : html``}
                ${this.players.length > 0
                  ? html`
                      <lobby-player-view
                        class="mt-6"
                        .gameMode=${this.gameConfig?.gameMode ?? GameMode.FFA}
                        .clients=${this.players}
                        .lobbyCreatorClientID=${hostClientID}
                        .currentClientID=${this.currentClientID}
                        .teamCount=${this.gameConfig?.playerTeams ?? 2}
                        .isPublicGame=${this.gameConfig?.gameType ===
                        GameType.Public}
                        .nationCount=${nationsConfigToSlider(
                          this.gameConfig?.nations ?? "default",
                          this.nationCount,
                        )}
                      ></lobby-player-view>
                    `
                  : ""}
              `}
        </div>

        ${this.isPrivateLobby()
          ? html`
              <div
                class="p-6 lg:p-6 border-t border-white/10 bg-black/20 shrink-0"
              >
                ${this.renderPrivateStartControls()}${this.renderLeaveRow()}
              </div>
            `
          : html`
              <div
                class="p-6 lg:p-6 border-t border-white/10 bg-black/20 shrink-0"
              >
                <div
                  class="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex flex-col">
                      <span
                        class="text-[10px] font-bold uppercase tracking-widest text-white/40"
                        >${translateText("public_lobby.status")}</span
                      >
                      <span class="text-sm font-bold text-white"
                        >${statusLabel}</span
                      >
                    </div>
                    ${maxPlayers > 0
                      ? html`
                          <div
                            class="flex items-center gap-2 text-white/80 text-xs font-bold uppercase tracking-widest"
                          >
                            <span>${playerCount}/${maxPlayers}</span>
                            <svg
                              class="w-4 h-4 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.972 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
                              ></path>
                            </svg>
                          </div>
                        `
                      : html``}
                  </div>
                  ${secondsRemaining !== null && !heroOwnsCountdown
                    ? html`<div
                        class="mt-2.5 h-1 rounded-full bg-white/10 overflow-hidden"
                      >
                        <div
                          class="h-full bg-white/70"
                          style="width:${countdownFrac *
                          100}%;transition:width 0.15s linear"
                        ></div>
                      </div>`
                    : html``}
                </div>
                ${this.renderLeaveRow()}
              </div>
            `}
      </div>
    `;
  }

  // terron: кнопки старта для приватного лобби. Любой участник может запустить
  // отсчёт (хост → 10с, игрок → 60с — решает сервер). Пока идёт отсчёт — «Старт
  // через Ns» + «Отмена» (для игрока-отсчёта отменяет любой; для хост-отсчёта —
  // только хост). Сам старт делает сервер по нулю.
  // ── terron: АЛМАЗНЫЙ МАТЧ — «кто выиграл прошлый» + доска почёта ───────────
  // Алмазное лобби висит весь день, и зашедший заранее сидит в нём подолгу.
  // Показываем, за что тут сидят: прошлого победителя (со ссылкой на досье и
  // реплеем матча) и тех, у кого таких побед больше всех. Данные — публичная
  // ручка API /stats/diamond (кэш 60с на стороне API).
  @state() private diamondBoard: DiamondBoard | null = null;
  private diamondFetched = false;

  private async loadDiamondBoard(): Promise<void> {
    if (this.diamondFetched) return;
    this.diamondFetched = true;
    try {
      // Дев-сайт просит СВОЮ половину архива: иначе на dev.terron.io витрина
      // вечно пустая (все тамошние матчи помечены is_dev) и проверить её нечем.
      const r = await fetch(
        `${getApiBase()}/stats/diamond${isDevSite() ? "?dev=1" : ""}`,
      );
      if (!r.ok) return;
      this.diamondBoard = (await r.json()) as DiamondBoard;
    } catch {
      /* витрина необязательная — молча без неё */
    }
  }

  private renderDiamondWinnerName(w: DiamondWinner) {
    // Аноним ссылки на досье не имеет — показываем просто ник.
    const h = winnerHandle(w);
    return h
      ? html`<a
          href="/@${h}"
          class="underline decoration-dotted hover:text-white"
          >${w.name}</a
        >`
      : html`<span>${w.name}</span>`;
  }

  /**
   * terron: время старта — ВСЕГДА В ЧАСОВОМ ПОЯСЕ ИГРОКА (решение владельца
   * 10.08). Расписание задано по Москве, но писать «20:00 МСК» человеку из
   * Новосибирска бессмысленно — он и так видит у себя 00:00. Считаем от
   * lobbyStartAt (это метка эпохи), формат отдаём браузеру.
   */
  private eventStartLabel(): string {
    // «сегодня/завтра» зависит от текущей даты — день входит в ключ, чтобы
    // через полночь подпись честно переключилась.
    const key =
      this.lobbyStartAt === null
        ? null
        : `${this.eventMemoKey()}|${new Date().toDateString()}`;
    if (key !== null && this.startLabelMemo?.key === key) {
      return this.startLabelMemo.text;
    }
    const text = this.computeEventStartLabel();
    if (key !== null) this.startLabelMemo = { key, text };
    return text;
  }

  private computeEventStartLabel(): string {
    const ms = this.lobbyStartAt ?? nextDiamondMatchAt(Date.now());
    const at = new Date(ms);
    const time = at.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    const midnight = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round(
      (midnight(at) - midnight(new Date())) / (24 * 60 * 60 * 1000),
    );
    if (days <= 0) return L(`сегодня в ${time}`, `today at ${time}`);
    if (days === 1) return L(`завтра в ${time}`, `tomorrow at ${time}`);
    return L(`в ${time}`, `at ${time}`);
  }

  /** Секунд до старта (0 = пора стартовать). */
  private eventSecondsLeft(): number {
    if (this.lobbyStartAt === null) return 0;
    return Math.max(
      0,
      Math.floor(
        (this.lobbyStartAt - getServerNow(this.serverTimeOffset)) / 1000,
      ),
    );
  }

  /** Отсчёт до старта: «8:56:23» у алмазного, «07:42» у события покороче. */
  private eventCountdown(): string {
    const left = this.eventSecondsLeft();
    const pad = (n: number) => String(n).padStart(2, "0");
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    return h > 0
      ? `${h}:${pad(m)}:${pad(left % 60)}`
      : `${pad(m)}:${pad(left % 60)}`;
  }

  /**
   * terron: АЛМАЗНОЕ ЛОББИ — ШАПКА ОЖИДАНИЯ. Сюда заходят за часы до старта и
   * сидят в пустом лобби, поэтому первым экраном идёт ровно то, за чем пришли:
   * сколько ждать, во сколько (по СВОИМ часам) и кнопка позвать своих. Отсчёт
   * в статус-баре внизу при этом гасится — два таймера на одном экране читаются
   * как ошибка.
   */
  private renderDiamondHero() {
    if (this.eventTier() !== "diamond") return "";
    return html`
      <div
        class="border p-4 text-center"
        style="border-color:#4aa8d8;background:#e2f2fa"
      >
        <div
          class="text-[10px] font-bold uppercase tracking-[0.2em]"
          style="color:#14536f"
        >
          ${L("До старта", "Starts in")}
        </div>
        <!-- ⚠️ На нуле пишем СЛОВО, а не «00:00»: сервер стартует матч в эту же
             секунду, и застывший ноль читается как «сломалось» (репорт 10.08). -->
        <div
          class="text-4xl font-bold leading-tight"
          style="font-family:var(--t-mono);font-variant-numeric:tabular-nums;color:#2b2a24"
        >
          ${this.eventSecondsLeft() > 0
            ? this.eventCountdown()
            : html`<span class="text-2xl"
                >${translateText("public_lobby.starting_game")}</span
              >`}
        </div>
        <div class="text-xs" style="color:#6b6759">
          ${this.eventStartLabel()} · ${L("победителю", "winner gets")}
          +${eventRewardOf(this.gameConfig)}
          <img
            src=${bloodDiamondIcon}
            alt=""
            style="display:inline-block;width:13px;height:13px;vertical-align:-2px;object-fit:contain"
          />
        </div>
        <div class="mt-3">
          <copy-button
            .copyText=${this.eventInviteText()}
            .displayText=${L("Позвать друзей", "Invite friends")}
            .showVisibilityToggle=${false}
            .fullWidth=${true}
          ></copy-button>
        </div>
      </div>
    `;
  }

  /**
   * terron: прошлый победитель — ОДНОЙ СТРОКОЙ под шапкой ожидания. Полный блок
   * с аватаркой и доской почёта отсюда убран (решение владельца 10.08: «в потоке
   * не нравится») — в окне, где главное таймер, победитель это справка, а не
   * герой. Всё остальное про него игрок дочитает в досье по ссылке.
   */
  private renderDiamondStrip() {
    if (this.eventTier() !== "diamond") return "";
    void this.loadDiamondBoard();
    const last = this.diamondBoard?.last ?? null;
    const winner = last?.winner ?? null;
    if (!winner) return "";
    // Дату НЕ пишем: событие суточное, прошлый матч всегда «вчера» — строка
    // на 375px дороже этой справки (ник от неё ужимался до «Хмуры…»).
    return html`
      <div
        class="flex items-center gap-2 border px-3 py-2 text-sm"
        style="border-color:rgba(74,168,216,0.55);background:rgba(74,168,216,0.10)"
      >
        <!-- ⚠️ Цвета ТЁМНЫЕ: окно лобби — светлая сайтовая модалка. Классы
             text-white/* тема флипает в чернила сама, а инлайн-цвет — нет. -->
        <span class="text-xs shrink-0" style="color:#6b6759"
          >${L("💎 Прошлый:", "💎 Last won by:")}</span
        >
        <img
          src=${avatarSrc({
            hasAvatar: winner.hasAvatar,
            slug: winnerHandle(winner),
            seed: winnerHandle(winner) ?? winner.name,
            size: 22,
          })}
          alt=""
          class="w-[22px] h-[22px] shrink-0 object-cover"
          @error=${avatarFallback(winnerHandle(winner) ?? winner.name, 22)}
        />
        <!-- flex-1 + min-w-0: без них ник в строке ужимается до одной буквы —
             дата и кнопка «смотреть» забирают всю ширину (проверено на 375px). -->
        <span class="flex-1 min-w-0 truncate font-bold">
          ${this.renderDiamondWinnerName(winner)}
        </span>
        ${winner.wins > 1
          ? html`<span
              class="text-xs shrink-0"
              style="color:#6b6759"
              title=${L(
                `Побед в алмазных матчах: ${winner.wins}`,
                `Diamond match wins: ${winner.wins}`,
              )}
              >×${winner.wins}</span
            >`
          : ""}
        <!-- ⚠️ Реплей — ЗНАЧКОМ, а не словом «смотреть»: на 375px кнопка со
             словом съедала строку, и ник ужимался до одной буквы. -->
        ${last?.hasReplay
          ? html`<a
              href="/game/${last.gameId}"
              class="shrink-0 grid place-items-center w-6 h-6 text-[11px]"
              style="background:#4aa8d8;color:#10202b"
              title=${L("Смотреть реплей", "Watch the replay")}
              aria-label=${L("Смотреть реплей", "Watch the replay")}
              >▶</a
            >`
          : ""}
      </div>
    `;
  }

  /**
   * terron 25.08: ЯВНАЯ КНОПКА «ВЫЙТИ ИЗ ЛОББИ» (просьба игрока).
   * Раньше выход был только стрелкой «назад» в шапке — а с липким лобби
   * (переход по сайту больше не выбрасывает) уйти стало нечем: рефлекс
   * «нажму назад» перестал работать как выход. Рядом — подсказка, что по
   * сайту теперь можно ходить, не теряя место в лобби.
   */
  /**
   * terron 26.08: ЯВНАЯ КНОПКА «СВЕРНУТЬ» — рядом с выходом.
   *
   * ЗАЧЕМ. Свернуть лобби умели только НЕЯВНО: `minimize()` зовут навигация по
   * сайту и реестр «одна модалка за раз». На десктопе этого хватало — окно не
   * во весь экран, и уйти в «Рейтинг» очевидно. А на ТЕЛЕФОНЕ окно занимает
   * экран целиком, и оба его органа управления (стрелка «назад» и крестик) идут
   * в `close()`, то есть ВЫХОДЯТ ИЗ ЛОББИ. Игрок, желающий «глянуть онлайн и
   * вернуться», прямого способа не имел вовсе — только через бургер куда-нибудь
   * уйти. Подсказка под кнопкой обещала ровно то, чего нельзя было сделать.
   *
   * ⚠️ Сворачиваем ЧЕРЕЗ ПЕРЕХОД НА ГЛАВНУЮ, а не вызовом `minimize()` напрямую:
   * окно лобби — это `.page-content`, и спрятать его, не показав ничего вместо,
   * значит оставить игрока на пустом экране. `showPage` сам вызовет `minimize()`
   * (гейт `prefersMinimize`) и покажет главную — то есть путь один и тот же, что
   * у ухода по меню, и второй ветки поведения не появляется.
   */
  private renderLeaveRow(): TemplateResult {
    return html`
      <div class="mt-3 flex flex-col items-center gap-1.5">
        <div class="flex w-full gap-2">
          <button
            class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5
                   rounded-xl border border-amber-300/30 bg-amber-300/[0.08]
                   text-white text-xs font-bold uppercase tracking-widest
                   hover:bg-amber-300/[0.16] transition-colors"
            @click=${() => this.minimizeToSite()}
          >
            <svg
              class="w-3.5 h-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <!-- стрелка вниз в полку: «убрать вниз, остаться» -->
              <path d="M12 4v9" />
              <path d="M8 9l4 4 4-4" />
              <path d="M5 19h14" />
            </svg>
            ${L("Свернуть", "Minimize")}
          </button>
          <button
            class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5
                   rounded-xl border border-red-400/30 bg-red-400/[0.08]
                   text-white/85 text-xs font-bold uppercase tracking-widest
                   hover:bg-red-400/[0.16] hover:text-white transition-colors"
            @click=${() => this.closeAndLeave()}
          >
            <svg
              class="w-3.5 h-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <!-- выход из двери: «уйти совсем» -->
              <path d="M10 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
              <path d="M16 16l4-4-4-4" />
              <path d="M20 12H10" />
            </svg>
            ${L("Выйти", "Leave")}
          </button>
        </div>
        <span class="text-[10px] text-white/40 text-center">
          ${L(
            "Свернёшь — место в лобби останется, плашка снизу вернёт назад",
            "Minimize and your spot is kept — the bar below brings you back",
          )}
        </span>
      </div>
    `;
  }

  /** Свернуть окно и показать сайт (см. комментарий у renderLeaveRow). */
  private minimizeToSite(): void {
    window.showPage?.("page-play");
    try {
      this.updateHistory("/");
    } catch (error) {
      console.warn("Failed to update URL on minimize:", error);
    }
  }

  private renderPrivateStartControls(): TemplateResult {
    const amIHost =
      !!this.currentClientID &&
      this.currentClientID === (this.lobbyCreatorClientID ?? "");
    const active =
      this.startCountdownEndsAt !== null &&
      this.startCountdownEndsAt > Date.now();

    if (!active) {
      return html`
        <button
          class="w-full py-4 text-sm font-bold text-white uppercase tracking-widest bg-malibu-blue hover:bg-aquarius rounded-xl transition-all shadow-lg shadow-sky-900/20 hover:shadow-sky-900/40 hover:-translate-y-0.5 active:translate-y-0"
          @click=${() => this.requestStart()}
        >
          ${L("Старт", "Start")}
        </button>
        <p class="mt-2 text-center text-white/40 text-xs">
          ${L(
            "Хост стартует за 10 с, любой игрок — за 60 с (можно отменить).",
            "Host starts in 10s, any player in 60s (cancellable).",
          )}
        </p>
      `;
    }

    const secs = Math.max(
      0,
      Math.ceil((this.startCountdownEndsAt! - Date.now()) / 1000),
    );
    const canCancel = !this.startCountdownByHost || amIHost;
    return html`
      <div class="flex flex-col gap-3">
        <div
          class="w-full py-3 text-center text-sm font-bold text-white uppercase tracking-widest bg-emerald-600/20 border border-emerald-500/40 rounded-xl"
        >
          ${L(`Старт через ${secs} с`, `Starting in ${secs}s`)}
        </div>
        ${canCancel
          ? html`<button
              class="w-full py-3 text-sm font-bold text-white uppercase tracking-widest bg-red-600 hover:bg-red-500 rounded-xl transition-all"
              @click=${() => this.cancelStart()}
            >
              ${L("Отменить", "Cancel")}
            </button>`
          : html`<p class="text-center text-white/40 text-xs">
              ${L(
                "Отсчёт запустил хост — отменить может только он.",
                "Host started the countdown — only the host can cancel.",
              )}
            </p>`}
      </div>
    `;
  }

  private renderJoinForm() {
    return html`
      <form @submit=${this.joinLobbyFromInput} class="custom-scrollbar p-6 space-y-4 mr-1">
          <div class="flex flex-col gap-3">
            <div class="flex gap-2">
              <input
                type="text"
                id="lobbyIdInput"
                placeholder=${translateText("private_lobby.enter_id")}
                @keyup=${this.handleChange}
                class="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono text-sm tracking-wider"
              />
              <o-button
                variant="ghost"
                size="md"
                iconPosition="only"
                .title=${translateText("common.paste")}
                .icon=${html`<svg
                  stroke="currentColor"
                  fill="currentColor"
                  stroke-width="0"
                  viewBox="0 0 32 32"
                  height="18px"
                  width="18px"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M 15 3 C 13.742188 3 12.847656 3.890625 12.40625 5 L 5 5 L 5 28 L 13 28 L 13 30 L 27 30 L 27 14 L 25 14 L 25 5 L 17.59375 5 C 17.152344 3.890625 16.257813 3 15 3 Z M 15 5 C 15.554688 5 16 5.445313 16 6 L 16 7 L 19 7 L 19 9 L 11 9 L 11 7 L 14 7 L 14 6 C 14 5.445313 14.445313 5 15 5 Z M 7 7 L 9 7 L 9 11 L 21 11 L 21 7 L 23 7 L 23 14 L 13 14 L 13 26 L 7 26 Z M 15 16 L 25 16 L 25 28 L 15 28 Z"
                  ></path>
                </svg>`}
                @click=${this.pasteFromClipboard}
              ></o-button>
            </div>
            <o-button
              title=${translateText("private_lobby.join_lobby")}
              width="block"
              submit
            ></o-button>
          </div>
        </div>
      </form>
    `;
  }

  protected onOpen(args?: Record<string, unknown>): void {
    const lobbyId = typeof args?.lobbyId === "string" ? args.lobbyId : "";
    const lobbyInfo = args?.lobbyInfo as GameInfo | PublicGameInfo | undefined;
    if (lobbyId) {
      this.startTrackingLobby(lobbyId, lobbyInfo);
      // If opened with lobbyId but no lobbyInfo (URL join case), auto-join the lobby
      if (!lobbyInfo) {
        this.handleUrlJoin(lobbyId);
      }
    }
  }

  private async handleUrlJoin(lobbyId: string): Promise<void> {
    try {
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (gameExists) return;

      // Active lobby not found, check if it's an archived game
      switch (await this.checkArchivedGame(lobbyId)) {
        case "success":
          return;
        case "not_found":
          // terron реферал: лобби протухло. Реф-привязка к создателю уже записана
          // (Main.handleUrl → captureLobbyReferral ДО джойна), так что надбавки не
          // теряются. Сообщаем и уводим на главную — там «Играть» = найти матч.
          this.resetTrackingState();
          this.showMessage(
            L(
              "Лобби больше не активно — найди новый матч на главной",
              "Lobby is no longer active — find a new match on the home page",
            ),
            "red",
          );
          window.showPage?.("page-play");
          return;
        case "version_mismatch":
          this.resetTrackingState();
          this.showMessageKey("private_lobby.version_mismatch", "red");
          return;
        case "error":
          this.resetTrackingState();
          this.showMessageKey("private_lobby.error", "red");
          return;
      }
    } catch (error) {
      console.error("Error checking lobby from URL:", error);
      this.resetTrackingState();
      this.showMessageKey("private_lobby.error", "red");
    }
  }

  private startTrackingLobby(
    lobbyId: string,
    lobbyInfo?: GameInfo | PublicGameInfo,
  ) {
    this.currentLobbyId = lobbyId;
    // clientID will be assigned by server via lobby_info message
    this.currentClientID = "";
    this.gameConfig = null;
    this.players = [];
    this.nationCount = 0;
    this.lobbyStartAt = null;
    this.serverTimeOffset = 0;
    this.lobbyCreatorClientID = null;
    this.isConnecting = true;
    this.handledJoinTimeout = false;
    this.startLobbyUpdates();
    if (lobbyInfo) {
      this.updateFromLobby(lobbyInfo);
      // Only stop showing spinner when we have player info
      if ("clients" in lobbyInfo && lobbyInfo.clients) {
        this.isConnecting = false;
      }
    }
  }

  private resetTrackingState() {
    this.stopLobbyUpdates();
    this.currentLobbyId = "";
    this.currentClientID = "";
    this.isConnecting = false;
  }

  private leaveLobby() {
    if (!this.currentLobbyId) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.currentLobbyId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  public confirmBeforeClose(): boolean {
    if (!this.currentLobbyId) return true;
    return confirm(translateText("host_modal.leave_confirmation"));
  }

  protected onClose(): void {
    this.clearCountdownTimer();
    if (this.startCountdownTick !== null) {
      clearInterval(this.startCountdownTick);
      this.startCountdownTick = null;
    }
    this.startCountdownEndsAt = null;
    this.lobbyChat()?.close(); // terron: свернуть лобби-чат
    this.stopLobbyUpdates();
    // terron: покинули лобби / старт матча → глушим лобби-музыку.
    this.lobbyMusic.stop();

    if (this.leaveLobbyOnClose) {
      this.leaveLobby();
      this.updateHistory("/");
    }

    if (this.lobbyIdInput) this.lobbyIdInput.value = "";
    this.gameConfig = null;
    this.players = [];
    this.currentLobbyId = "";
    this.currentClientID = "";
    this.nationCount = 0;
    this.lobbyStartAt = null;
    this.serverTimeOffset = 0;
    this.lobbyCreatorClientID = null;
    this.isConnecting = true;
    this.leaveLobbyOnClose = true;
    // Окно закрыто по-настоящему (вышли из лобби или начался матч) — плашку
    // снимаем, иначе она осталась бы висеть с мёртвыми данными.
    this.minimized = false;
    this.dispatchLobbyDock();
  }

  // terron: подписки на состояние звука — при ПОДКЛЮЧЕНИИ. Раньше они по ошибке
  // вешались в disconnectedCallback: иконка ♫ не синхронилась, пока окно живо,
  // а на каждом отключении на window оседал лишний слушатель (утечка).
  connectedCallback() {
    super.connectedCallback();
    this.lobbyMusic.onStateChange = this.syncMusicIcon;
    window.addEventListener("platform-audio-changed", this.syncMusicIcon);
    this.syncPushIcon();
  }

  disconnectedCallback() {
    window.removeEventListener("platform-audio-changed", this.syncMusicIcon);
    this.lobbyMusic.onStateChange = null;
    this.clearCountdownTimer();
    this.stopLobbyUpdates();
    this.lobbyMusic.dispose(); // terron: выгружаем лобби-музыку
    super.disconnectedCallback();
  }

  // terron: тумблер музыки (иконка в шапке лобби) — общий выключатель.
  private toggleMusic = () => {
    this.lobbyMusic.toggle();
    this.syncMusicIcon();
  };

  // Иконка ♫ показывает ФАКТ (учитывая мут площадки), а не только галку юзера.
  private syncMusicIcon = () => {
    this.musicOn = this.lobbyMusic.effectivelyOn;
  };

  public closeAndLeave() {
    this.leaveLobby();
    this.leaveLobbyOnClose = false;
    this.close();
    // ⚠️ Адрес правим ПОСЛЕ close(), а не до. Выйти можно и с плашки, стоя на
    // другой странице сайта, — а `close()` закрывает ту страницу, и её
    // `modalRouter.syncClosed()` восстанавливает «путь под ней», то есть
    // адрес лобби (`/diamond`), который мы только что стёрли. Поймано вживую
    // на деве: вышел из алмазного со страницы рейтинга, а в строке остался
    // `/diamond` — F5 возвращал бы в покинутое лобби.
    try {
      this.updateHistory("/");
    } catch (error) {
      console.warn("Failed to restore URL on leave:", error);
    }
  }

  public closeWithoutLeaving() {
    this.leaveLobbyOnClose = false;
    this.close();
  }

  /**
   * Пока мы в лобби — окно можно только СВОРАЧИВАТЬ. Если лобби ещё нет (форма
   * ввода id), закрываемся как обычная модалка.
   */
  public override prefersMinimize(): boolean {
    return this.currentLobbyId !== "";
  }

  protected override onMinimize(): void {
    this.minimized = true;
    // Свёрнутое окно перерисовывать 10 раз в секунду незачем — сбрасываем
    // таймер на секундный период (сторожа́ от периода не зависят).
    this.clearCountdownTimer();
    this.syncCountdownTimer();
    // Ушли бродить по сайту — чат сворачиваем сразу (иначе панель висит поверх
    // вики и топов), непрочитанные копятся на значке.
    this.lobbyChat()?.collapseForNav();
    this.dispatchLobbyDock();
  }

  protected override onRestore(): void {
    this.minimized = false;
    this.lobbyChat()?.restoreAfterNav();
    this.clearCountdownTimer();
    this.syncCountdownTimer();
    this.dispatchLobbyDock();
  }

  /**
   * Сообщить плашке внизу экрана текущее состояние лобби. Плашка не лезет в
   * шину событий сама: снимок собирается здесь, где он и так есть, — один
   * источник правды на окно и на плашку.
   */
  private dispatchLobbyDock(): void {
    document.dispatchEvent(
      new CustomEvent("lobby-dock", {
        detail: this.minimized
          ? {
              source: "join",
              lobbyId: this.currentLobbyId,
              map: this.gameConfig?.gameMap ?? null,
              players: this.players.length,
              maxPlayers: this.gameConfig?.maxPlayers ?? null,
              mode: this.lobbyModeLabel(),
              startsAt: this.lobbyStartAt,
              serverTimeOffset: this.serverTimeOffset,
              tier: this.eventTier(),
            }
          : null,
      }),
    );
  }

  /** Короткая подпись режима для плашки: «ФФА» / «Команды». */
  private lobbyModeLabel(): string {
    return this.gameConfig?.gameMode === GameMode.Team
      ? L("Команды", "Teams")
      : L("ФФА", "FFA");
  }

  /** Вернуться в свёрнутое окно лобби (кнопка на плашке). */
  public reopenFromDock(): void {
    this.restore();
  }

  /** Выйти из лобби прямо с плашки, не разворачивая окно. */
  public leaveFromDock(): void {
    this.closeAndLeave();
  }

  private updateHistory(url: string): void {
    if (!crazyGamesSDK.isOnCrazyGames()) {
      history.replaceState(null, "", url);
    }
  }

  // --- Game config rendering ---

  private renderGameConfig(): TemplateResult {
    if (!this.gameConfig) return html``;

    const c = this.gameConfig;
    const mapName = getMapName(c.gameMap);
    const normalizedMap = normaliseMapKey(c.gameMap);
    // Превью здесь всегда 80×80 CSS — полный 1200px файл тут не нужен.
    const thumbnailUrl = assetUrl(
      `maps/${encodeURIComponent(normalizedMap)}/thumbnail-sm.webp`,
    );
    const isTeam = c.gameMode === GameMode.Team;

    let modeSubtitle: string;
    if (!isTeam) {
      modeSubtitle = translateText("game_mode.ffa");
    } else if (c.playerTeams === HumansVsNations) {
      modeSubtitle = translateText("host_modal.teams_Humans Vs Nations");
    } else if (typeof c.playerTeams === "string") {
      modeSubtitle = translateText("host_modal.teams_" + c.playerTeams);
    } else if (typeof c.playerTeams === "number") {
      modeSubtitle = translateText("public_lobby.teams", {
        num: c.playerTeams,
      });
    } else {
      modeSubtitle = translateText("game_mode.ffa");
    }

    const pm = c.publicGameModifiers;
    const cards: TemplateResult[] = [];
    if (pm?.isCrowded)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.crowded")}
          .state=${"on"}
        ></lobby-config-item>`,
      );
    if (
      pm?.isHardNations ||
      (c.gameType === GameType.Private && c.difficulty !== Difficulty.Easy)
    )
      cards.push(
        html`<lobby-config-item
          .label=${translateText("difficulty.difficulty")}
          .value=${translateText(`difficulty.${c.difficulty.toLowerCase()}`)}
        ></lobby-config-item>`,
      );
    if (c.infiniteTroops)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.infinite_troops")}
          .state=${"on"}
        ></lobby-config-item>`,
      );
    if (c.infiniteGold)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.infinite_gold")}
          .state=${"on"}
        ></lobby-config-item>`,
      );
    if (c.instantBuild)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.instant_build")}
          .state=${"on"}
        ></lobby-config-item>`,
      );
    if (c.randomSpawn)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.random_spawn")}
          .state=${"on"}
        ></lobby-config-item>`,
      );
    if (c.fogOfWar)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.fog_of_war")}
          .state=${"on"}
        ></lobby-config-item>`,
      );
    // terron: СОБЫТИЙНЫЙ МАТЧ — чип в ожидании старта, чтобы зашедший видел, за
    // что играет (награду начисляет API победителю, см. TerronTuning
    // TERRON_GOLDEN_* / TERRON_DIAMOND_*). У алмазного награда уже написана в
    // шапке ожидания (renderDiamondHero) — второй раз тем же экраном не пишем.
    if (c.golden && c.eventTier !== "diamond")
      cards.push(
        html`<lobby-config-item
          .label=${L("⭐ Золотой матч", "⭐ Golden match")}
          .value=${html`+${eventRewardOf(c)}
            <img
              src=${bloodDiamondIcon}
              alt=""
              style="display:inline-block;width:15px;height:15px;vertical-align:-3px;object-fit:contain"
            />
            ${L("за победу", "for the win")}`}
        ></lobby-config-item>`,
      );
    if (c.maxTimerValue)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("private_lobby.game_length")}
          .value=${`${c.maxTimerValue} min`}
        ></lobby-config-item>`,
      );
    if (
      c.spawnImmunityDuration &&
      Math.round(c.spawnImmunityDuration / 10) !== 5
    ) {
      const totalSeconds = Math.round(c.spawnImmunityDuration / 10);
      const immunityValue =
        totalSeconds < 60
          ? `${totalSeconds}s`
          : totalSeconds % 60 > 0
            ? `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
            : `${Math.floor(totalSeconds / 60)} min`;
      cards.push(
        html`<lobby-config-item
          .label=${translateText("private_lobby.pvp_immunity")}
          .value=${immunityValue}
        ></lobby-config-item>`,
      );
    }
    if (c.startingGold)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("private_lobby.starting_gold")}
          .value=${`${parseFloat((c.startingGold / 1_000_000).toPrecision(12))}M`}
        ></lobby-config-item>`,
      );
    if (c.goldMultiplier)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.gold_multiplier")}
          .value=${`x${c.goldMultiplier}`}
        ></lobby-config-item>`,
      );
    if (c.disableAlliances)
      cards.push(
        html`<lobby-config-item
          .label=${translateText(
            "public_game_modifier.disable_alliances_label",
          )}
          .state=${"off"}
        ></lobby-config-item>`,
      );
    if (c.waterNukes)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("public_game_modifier.water_nukes_label")}
          .state=${"on"}
        ></lobby-config-item>`,
      );
    // terron 22.08: раньше чип рисовался ТОЛЬКО когда настройка отличается от
    // дефолта режима — а в FFA донат игрокам выключен ВСЕГДА (MapPlaylist), то
    // есть это и есть дефолт, и чипа не было НИКОГДА. Игрок видел лишь, что у
    // нации кнопка доната есть, а у союзника-человека нет (гейт в
    // PlayerImpl.canDonate* смотрит только на PlayerType.Human), и считал это
    // багом — два репорта в ТГ. Теперь режим доната виден в карточке лобби
    // ВСЕГДА: одним чипом, если обе настройки совпадают, иначе двумя.
    if (c.donateGold === c.donateTroops) {
      cards.push(
        html`<lobby-config-item
          .label=${translateText("public_game_modifier.donate_players_label")}
          .state=${c.donateGold ? "on" : "off"}
        ></lobby-config-item>`,
      );
    } else {
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.donate_gold")}
          .state=${c.donateGold ? "on" : "off"}
        ></lobby-config-item>`,
      );
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.donate_troops")}
          .state=${c.donateTroops ? "on" : "off"}
        ></lobby-config-item>`,
      );
    }
    const isCompact =
      c.gameMapSize === GameMapSize.Compact || c.publicGameModifiers?.isCompact;
    if (isCompact)
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.compact_map")}
          .state=${"on"}
        ></lobby-config-item>`,
      );
    {
      const defaultBots = isCompact ? 100 : 400;
      if (c.bots !== defaultBots)
        cards.push(
          html`<lobby-config-item
            .label=${translateText("host_modal.bots")}
            .value=${String(c.bots)}
          ></lobby-config-item>`,
        );
    }
    {
      const defaultNations = isCompact
        ? Math.max(0, Math.floor(this.nationCount * 0.25))
        : this.nationCount;
      if (typeof c.nations === "number" && c.nations !== defaultNations)
        cards.push(
          html`<lobby-config-item
            .label=${translateText("host_modal.nations")}
            .value=${String(c.nations)}
          ></lobby-config-item>`,
        );
    }
    if (c.nations === "disabled" && !(c.gameType === GameType.Public && isTeam))
      cards.push(
        html`<lobby-config-item
          .label=${translateText("host_modal.nations")}
          .state=${"off"}
        ></lobby-config-item>`,
      );

    return html`
      <div class="flex items-center gap-3 mb-6">
        <img
          src=${thumbnailUrl}
          alt=${mapName ?? c.gameMap}
          class="w-20 h-20 rounded-lg object-cover border border-white/10 shrink-0"
          @error=${(e: Event) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div class="flex flex-col gap-1">
          <span class="text-lg font-bold text-white">${mapName}</span>
          <span class="text-sm text-white/60">${modeSubtitle}</span>
        </div>
      </div>
      ${cards.length > 0
        ? html`<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
            ${cards}
          </div>`
        : html``}
      ${this.renderDisabledUnits()} ${this.renderHostCheats()}
    `;
  }

  private renderDisabledUnits(): TemplateResult {
    if (
      !this.gameConfig ||
      !this.gameConfig.disabledUnits ||
      this.gameConfig.disabledUnits.length === 0
    ) {
      return html``;
    }

    const unitKeys: Record<string, string> = {
      City: "unit_type.city",
      Port: "unit_type.port",
      "Defense Post": "unit_type.defense_post",
      "SAM Launcher": "unit_type.sam_launcher",
      "Missile Silo": "unit_type.missile_silo",
      Warship: "unit_type.warship",
      Factory: "unit_type.factory",
      "Atom Bomb": "unit_type.atom_bomb",
      "Hydrogen Bomb": "unit_type.hydrogen_bomb",
      MIRV: "unit_type.mirv",
      "Trade Ship": "player_stats_table.unit.trade",
      Transport: "player_stats_table.unit.trans",
      "MIRV Warhead": "player_stats_table.unit.mirvw",
    };

    return html`
      <div
        class="mt-4 mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg"
      >
        <div
          class="text-xs font-bold text-red-400 uppercase tracking-widest mb-2"
        >
          ${translateText("private_lobby.disabled_units")}
        </div>
        <div class="flex flex-wrap gap-2">
          ${this.gameConfig.disabledUnits.map((unit) => {
            const key = unitKeys[unit];
            const name = key ? translateText(key) : unit;
            return html`
              <span
                class="px-2 py-1 bg-red-500/20 text-red-200 text-xs rounded font-bold border border-red-500/30"
              >
                ${name}
              </span>
            `;
          })}
        </div>
      </div>
    `;
  }

  private renderHostCheats(): TemplateResult {
    if (!this.gameConfig?.hostCheats) {
      return html``;
    }

    const hc = this.gameConfig.hostCheats;
    const items: TemplateResult[] = [];

    if (hc.infiniteGold)
      items.push(
        html`<span
          class="px-2 py-1 bg-yellow-500/20 text-yellow-200 text-xs rounded font-bold border border-yellow-500/30"
        >
          ${translateText("host_modal.infinite_gold")}
        </span>`,
      );
    if (hc.infiniteTroops)
      items.push(
        html`<span
          class="px-2 py-1 bg-yellow-500/20 text-yellow-200 text-xs rounded font-bold border border-yellow-500/30"
        >
          ${translateText("host_modal.infinite_troops")}
        </span>`,
      );
    if (hc.goldMultiplier)
      items.push(
        html`<span
          class="px-2 py-1 bg-yellow-500/20 text-yellow-200 text-xs rounded font-bold border border-yellow-500/30"
        >
          ${translateText("host_modal.gold_multiplier")}: x${hc.goldMultiplier}
        </span>`,
      );
    if (hc.startingGold)
      items.push(
        html`<span
          class="px-2 py-1 bg-yellow-500/20 text-yellow-200 text-xs rounded font-bold border border-yellow-500/30"
        >
          ${translateText("private_lobby.starting_gold")}:
          ${parseFloat((hc.startingGold / 1_000_000).toPrecision(12))}M
        </span>`,
      );

    if (items.length === 0) return html``;

    return html`
      <div
        class="mt-4 mb-6 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg"
      >
        <div
          class="text-xs font-bold text-yellow-400 uppercase tracking-widest mb-2"
        >
          ${translateText("private_lobby.host_cheats")}
        </div>
        <div class="flex flex-wrap gap-2">${items}</div>
      </div>
    `;
  }

  // --- Lobby event handling ---

  private updateFromLobby(lobby: GameInfo | PublicGameInfo) {
    this.players = "clients" in lobby ? (lobby.clients ?? []) : [];
    if ("serverTime" in lobby && typeof lobby.serverTime === "number") {
      this.serverTimeOffset = calculateServerTimeOffset(lobby.serverTime);
    }
    this.lobbyStartAt = lobby.startsAt ?? null;
    this.syncCountdownTimer();
    if (lobby.gameConfig) {
      const mapChanged = this.gameConfig?.gameMap !== lobby.gameConfig.gameMap;
      this.gameConfig = lobby.gameConfig;
      if (mapChanged) {
        this.loadNationCount();
      }
    }

    this.lobbyCreatorClientID =
      "lobbyCreatorClientID" in lobby
        ? (lobby.lobbyCreatorClientID ?? null)
        : null;

    // terron: отсчёт старта — только у приватного лобби (request_start/cancel_start).
    if (this.isPrivateLobby()) {
      const cd =
        "startCountdownEndsAt" in lobby
          ? lobby.startCountdownEndsAt
          : undefined;
      this.startCountdownEndsAt = cd && cd > Date.now() ? cd : null;
      this.startCountdownByHost = Boolean(
        "startCountdownByHost" in lobby && lobby.startCountdownByHost,
      );
      this.syncStartCountdownTick();
    }
    // terron: ЛОББИ-ЧАТ — приватные лобби И ЗОЛОТОЙ МАТЧ. В обычном публичном
    // чата нет намеренно: оно живёт 10 секунд. А в золотом народ ждёт минутами
    // (собираются заранее по ссылке /gold) — там есть о чём поговорить и кого
    // дождаться (вопрос владельца 28.07: «чего в золотом лобби нет чата?»).
    if (this.isPrivateLobby() || this.gameConfig?.golden === true) {
      this.lobbyChat()?.sync(
        lobby.gameID,
        this.players,
        this.lobbyCreatorClientID ?? "",
        this.currentClientID,
      );
    }
  }

  private lobbyChat(): LobbyChatPanel | null {
    return document.querySelector("lobby-chat-panel") as LobbyChatPanel | null;
  }

  // Тикер 250мс, пока идёт отсчёт — чтобы «старт через Ns» убывал.
  private syncStartCountdownTick() {
    if (this.startCountdownEndsAt === null) {
      if (this.startCountdownTick !== null) {
        clearInterval(this.startCountdownTick);
        this.startCountdownTick = null;
      }
      return;
    }
    if (this.startCountdownTick !== null) return;
    this.startCountdownTick = window.setInterval(() => {
      if (
        this.startCountdownEndsAt === null ||
        this.startCountdownEndsAt <= Date.now()
      ) {
        clearInterval(this.startCountdownTick!);
        this.startCountdownTick = null;
      }
      this.requestUpdate();
    }, 250);
  }

  private requestStart() {
    this.dispatchEvent(
      new CustomEvent("request-start", { bubbles: true, composed: true }),
    );
  }

  private cancelStart() {
    this.dispatchEvent(
      new CustomEvent("cancel-start", { bubbles: true, composed: true }),
    );
  }

  private startLobbyUpdates() {
    this.stopLobbyUpdates();
    if (!this.eventBus) {
      console.warn(
        "JoinLobbyModal: eventBus not set, cannot subscribe to lobby updates",
      );
      return;
    }
    this.eventBus.on(LobbyInfoEvent, this.handleLobbyInfo);
  }

  private stopLobbyUpdates() {
    this.eventBus?.off(LobbyInfoEvent, this.handleLobbyInfo);
  }

  // --- Countdown timer ---

  private syncCountdownTimer() {
    if (this.lobbyStartAt === null) {
      this.clearCountdownTimer();
      return;
    }
    // ⚠️ updateFromLobby ставит lobbyStartAt ДО gameConfig — на первом вызове
    // тир ещё неизвестен; поэтому таймер пересоздаём, если нужный период сменился.
    const period =
      this.minimized || this.eventTier() === "diamond" ? 1000 : 100;
    if (this.countdownTimerId !== null) {
      if (this.countdownTimerPeriod === period) return;
      this.clearCountdownTimer();
    }
    this.countdownTimerPeriod = period;
    // terron: 100мс (не 1000) — чтобы «сгорающая» полоса отсчёта ехала плавно
    // (доля считается из мс). checkForJoinTimeout дешёвый и идемпотентный.
    // У АЛМАЗНОГО полосы нет (heroOwnsCountdown: отсчёт в шапке с точностью до
    // секунды), а ждут там часами — хватает 1000мс, иначе окно перерисовывается
    // 10 раз/с впустую. checkStuckLobby ходит в DOM (querySelector) — не чаще
    // раза в секунду; его порог (STALE_AFTER_MS) от частоты опроса не зависит.
    let lastStuckCheck = 0;
    this.countdownTimerId = window.setInterval(() => {
      this.checkForJoinTimeout();
      const now = Date.now();
      if (now - lastStuckCheck >= 1000) {
        lastStuckCheck = now;
        this.checkStuckLobby();
      }
      this.requestUpdate();
    }, period);
  }

  /** См. STALE_AFTER_MS: время старта прошло, а мы всё ещё в лобби = мы вылетели. */
  private checkStuckLobby() {
    // ⚠️ Гейт по СЕССИИ, а не по видимости окна: свёрнутое лобби обязано
    // лечиться так же, как открытое (иначе игрок, ушедший на /leaders,
    // остаётся в мёртвом лобби навсегда).
    if (this.staleHandled || this.isConnecting || !this.lobbySessionLive())
      return;
    if (this.lobbyStartAt === null || !this.currentLobbyId) return;
    if (this.gameConfig?.gameType !== GameType.Public) return;
    // Старт уже идёт (грузится карта / матч поднялся) — не наше дело.
    if (document.body.classList.contains("in-game")) return;
    const loading = document.querySelector(
      "game-starting-modal",
    ) as HTMLElement | null;
    if (loading !== null && loading.style.display !== "none") return;
    const past = getServerNow(this.serverTimeOffset) - this.lobbyStartAt;
    if (past < JoinLobbyModal.STALE_AFTER_MS) return;
    this.staleHandled = true;
    reportHealth(
      "lobby_stuck_past_start",
      `${Math.round(past / 1000)}s past start`,
      {
        lobbyId: this.currentLobbyId,
        tier: this.eventTier() ?? "plain",
        players: this.players.length,
        hidden: document.visibilityState === "hidden",
      },
    );
    // Петля перезагрузок исключена: на лобби разрешаем ровно одну попытку.
    try {
      const key = `terron-stuck-${this.currentLobbyId}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* приватный режим — тогда просто перезагрузимся один раз за жизнь окна */
    }
    window.location.reload();
  }

  private clearCountdownTimer() {
    if (this.countdownTimerId === null) {
      return;
    }
    clearInterval(this.countdownTimerId);
    this.countdownTimerId = null;
  }

  private checkForJoinTimeout() {
    if (
      this.handledJoinTimeout ||
      !this.isConnecting ||
      this.lobbyStartAt === null ||
      !this.lobbySessionLive()
    ) {
      return;
    }
    // terron: «решает СЕРВЕР». Переход в игру идёт по серверному prestart/start
    // (ClientGameRunner), а не по тому, что клиентский таймер упёрся в startsAt.
    // На startsAt сервер только НАЧИНАЕТ старт (prestart + загрузка карты) — это
    // занимает секунды. Раньше клиент тут же выкидывал из лобби → «таймер 00, а
    // время ещё есть». Даём грейс: считаем за провал старта только если сервер так
    // и не стартовал спустя большой запас. (Офлайн: lobbyStartAt=null → выходим выше.)
    const JOIN_START_GRACE_MS = 60000;
    if (
      getServerNow(this.serverTimeOffset) <
      this.lobbyStartAt + JOIN_START_GRACE_MS
    ) {
      return;
    }
    this.handledJoinTimeout = true;
    // Телеметрия: «не присоединились к игре вовремя» — сервер не стартовал нас
    // спустя грейс. Серия у ОДНОГО игрока (total≫sessions в сводке) = его
    // клиент системно не может войти в онлайн (жалоба NaG 16.07). Динамический
    // импорт — Health не в критическом пути джойна.
    void import("./Health").then(({ reportHealth }) =>
      reportHealth("join_timeout", "grace_expired", {
        gameID: this.currentLobbyId,
      }),
    );
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: translateText("public_lobby.join_timeout"),
          color: "red",
          duration: 3500,
        },
      }),
    );
    this.closeAndLeave();
  }

  // --- Nation count ---

  private async loadNationCount() {
    if (!this.gameConfig) {
      this.nationCount = 0;
      return;
    }
    const currentMap = this.gameConfig.gameMap;
    try {
      const mapData = terrainMapFileLoader.getMapData(currentMap);
      const manifest = await mapData.manifest();
      if (this.gameConfig?.gameMap === currentMap) {
        this.nationCount = manifest.nations.length;
      }
    } catch (error) {
      console.warn("Failed to load nation count", error);
      if (this.gameConfig?.gameMap === currentMap) {
        this.nationCount = 0;
      }
    }
  }

  // --- Private lobby join flow (lobby ID input) ---

  private isValidLobbyId(value: string): boolean {
    return GAME_ID_REGEX.test(value);
  }

  private normalizeLobbyId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const extracted = this.extractLobbyIdFromUrl(trimmed).trim();
    if (!this.isValidLobbyId(extracted)) return null;
    return extracted;
  }

  private sanitizeForLog(value: string): string {
    return value.replace(/[\r\n]/g, "");
  }

  private extractLobbyIdFromUrl(input: string): string {
    if (!input.startsWith("http")) {
      return input;
    }

    try {
      const url = new URL(input);
      const match = url.pathname.match(/game\/([^/]+)/);
      const candidate = match?.[1];
      if (candidate && GAME_ID_REGEX.test(candidate)) return candidate;

      return input;
    } catch (error) {
      console.warn("Failed to parse lobby URL", error);
      return input;
    }
  }

  private setLobbyId(id: string) {
    if (this.lobbyIdInput) {
      this.lobbyIdInput.value = this.extractLobbyIdFromUrl(id);
    }
  }

  private handleChange(e: Event) {
    const value = (e.target as HTMLInputElement).value.trim();
    this.setLobbyId(value);
  }

  private async pasteFromClipboard() {
    try {
      const clipText = await navigator.clipboard.readText();
      this.setLobbyId(clipText);
    } catch (err) {
      console.error("Failed to read clipboard contents: ", err);
    }
  }

  private async joinLobbyFromInput(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const lobbyId = this.normalizeLobbyId(this.lobbyIdInput.value);
    if (!lobbyId) {
      this.showMessageKey("private_lobby.not_found", "red");
      return;
    }

    this.lobbyIdInput.value = lobbyId;
    console.log(`Joining lobby with ID: ${this.sanitizeForLog(lobbyId)}`);

    // Initialize tracking state before checking/joining
    this.startTrackingLobby(lobbyId);

    try {
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (gameExists) return;

      switch (await this.checkArchivedGame(lobbyId)) {
        case "success":
          return;
        case "not_found":
          this.resetTrackingState();
          this.showMessageKey("private_lobby.not_found", "red");
          return;
        case "version_mismatch":
          this.resetTrackingState();
          this.showMessageKey("private_lobby.version_mismatch", "red");
          return;
        case "error":
          this.resetTrackingState();
          this.showMessageKey("private_lobby.error", "red");
          return;
      }
    } catch (error) {
      console.error("Error checking lobby existence:", error);
      this.resetTrackingState();
      this.showMessageKey("private_lobby.error", "red");
    }
  }

  private showMessage(message: string, color: "green" | "red" = "green") {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: { message, duration: 3000, color },
      }),
    );
  }

  /**
   * То же, но текст берётся ПО КЛЮЧУ и только когда словарь доехал. Тост
   * рисуется один раз и не перерисовывается, поэтому ранний перевод «залипал»
   * сырым ключом при холодном заходе по ссылке на лобби (репорт 29.07:
   * `private_lobby.joined_waiting` на экране). См. onTranslationsReady.
   */
  private showMessageKey(key: string, color: "green" | "red" = "green") {
    onTranslationsReady(() => this.showMessage(translateText(key), color));
  }

  // terron ПЕРФ/UX (П6б, 12.07): заход по ссылке раньше мог ВИСНУТЬ МОЛЧА —
  // проверки лобби/архива шли без таймаутов. Теперь 10с AbortController:
  // обрыв → throw → catch у вызывающих показывает внятную ошибку.
  private async fetchWithTimeout(url: string, ms = 10_000): Promise<Response> {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), ms);
    try {
      return await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async checkActiveLobby(lobbyId: string): Promise<boolean> {
    const url = `/${ClientEnv.workerPath(lobbyId)}/api/game/${lobbyId}/exists`;

    const response = await this.fetchWithTimeout(url);

    if (!response.ok) {
      return false;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return false;
    }

    let gameInfo: { exists?: boolean };
    try {
      gameInfo = await response.json();
    } catch (error) {
      console.warn("Failed to parse active lobby response", error);
      return false;
    }

    if (gameInfo.exists) {
      this.showMessageKey("private_lobby.joined_waiting");

      // Use the clientID that was already set by startTrackingLobby in open()
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            source: "private",
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );

      // Event tracking is already started by open() -> startTrackingLobby()
      // LobbyInfoEvents will update the UI as they arrive
      return true;
    }

    return false;
  }

  private async checkArchivedGame(
    lobbyId: string,
  ): Promise<"success" | "not_found" | "version_mismatch" | "error"> {
    const archiveResponse = await this.fetchWithTimeout(
      `${getApiBase()}/game/${lobbyId}`,
    );

    if (archiveResponse.status === 404) {
      return "not_found";
    }
    if (archiveResponse.status !== 200) {
      return "error";
    }

    const archiveData = await archiveResponse.json();
    const parsed = GameRecordSchema.safeParse(archiveData);
    if (!parsed.success) {
      return "version_mismatch";
    }

    const gitCommit = ClientEnv.gitCommit();
    if (gitCommit !== "DEV" && parsed.data.gitCommit !== gitCommit) {
      const safeLobbyId = this.sanitizeForLog(lobbyId);
      console.warn(
        `Git commit hash mismatch for game ${safeLobbyId}`,
        archiveData.details,
      );
      return "version_mismatch";
    }

    // If the modal closes as part of joining the replay, do not leave/reset URL
    this.leaveLobbyOnClose = false;

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobbyId,
          gameRecord: parsed.data,
          source: "private",
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    return "success";
  }
}

import IntlMessageFormat from "intl-messageformat";
import {
  Duos,
  GameMode,
  HumansVsNations,
  MessageType,
  PublicGameModifiers,
  Quads,
  Team,
  Trios,
} from "../core/game/Game";
import { GameConfig } from "../core/Schemas";
import type { LangSelector } from "./LangSelector";
import { Platform } from "./Platform";

export const TUTORIAL_VIDEO_URL = "https://www.youtube.com/embed/EN2oOog3pSs";

/**
 * terron: мы на ДЕВ-контуре (dev.terron.io)?
 * ⚠️ `ClientEnv.env() === GameEnv.Dev` для этого НЕ годится: прод-игра тоже
 * запущена с GAME_ENV=dev (историческое решение — так пускают анонимов), т.е.
 * этот флаг верен и на terron.io. Отличаем контуры по ХОСТУ — единственному,
 * что действительно различается. Нужно, чтобы обкатывать пробные фичи на деве,
 * катая при этом ОДИН И ТОТ ЖЕ бандл в оба контура.
 */
export function isDevSite(): boolean {
  try {
    return window.location.hostname.startsWith("dev.");
  } catch {
    return false;
  }
}

/**
 * terron: игра открыта ВНУТРИ плеера itch.io (publoapp.itch.io/terron)?
 * Там мы лежим в чужом iframe (лоадер на html-classic.itch.zone, а он — во фрейме
 * страницы itch.io), поэтому в шапке нужна ссылка «открыть на terron.io» отдельной
 * вкладкой: внутри плеера у игрока нет ни адресной строки, ни нашего домена.
 *
 * Метку ставит САМ лоадер (`?embed=itch` в src фрейма) — это надёжнее, чем нюхать
 * ancestorOrigins (в Firefox их нет) или referrer (у itch два разных CDN-хоста).
 * Значение кладём в sessionStorage: SPA-переходы стирают query, а шапка живёт дальше.
 */
const ITCH_HOST = /(^|\.)itch\.(io|zone)$/;
// Считаем ОДИН раз при импорте модуля и держим в памяти: query до нас успевает
// подчистить SPA-роутер, а sessionStorage в стороннем iframe может быть просто
// запрещён (блокировка сторонних данных) — на них полагаться нельзя.
const IS_ITCH_EMBED: boolean = (() => {
  try {
    if (new URLSearchParams(window.location.search).get("embed") === "itch") {
      return true;
    }
  } catch {
    /* нет window/URLSearchParams — не в браузере */
  }
  try {
    if (window.self === window.top) return false;
    const chain = window.location.ancestorOrigins;
    if (chain && chain.length > 0) {
      for (let i = 0; i < chain.length; i++) {
        if (ITCH_HOST.test(new URL(chain[i]).hostname)) return true;
      }
      return false;
    }
    // Firefox: ancestorOrigins нет — остаётся ссылающийся документ.
    if (!document.referrer) return false;
    return ITCH_HOST.test(new URL(document.referrer).hostname);
  } catch {
    return false;
  }
})();

export function isItchEmbed(): boolean {
  return IS_ITCH_EMBED;
}

export function normaliseMapKey(mapName: string): string {
  return mapName.toLowerCase().replace(/[\s.]+/g, "");
}

export function getMapName(mapName: string | undefined): string | null {
  if (!mapName) return null;
  return translateText(`map.${normaliseMapKey(mapName)}`);
}

/**
 * Returns a display label for the game mode (e.g. "FFA", "4 Teams", "Duos").
 */
export function getGameModeLabel(gameConfig: GameConfig): string {
  const { gameMode, playerTeams, maxPlayers } = gameConfig;

  if (gameMode !== GameMode.Team) {
    return translateText("game_mode.ffa");
  }

  // Humans vs Nations
  if (playerTeams === HumansVsNations) {
    if (maxPlayers) {
      return translateText("public_lobby.teams_hvn_detailed", {
        num: maxPlayers,
      });
    }
    return translateText("public_lobby.teams_hvn");
  }

  // Named team types (Duos, Trios, Quads)
  if (typeof playerTeams === "string") {
    const teamKey = `public_lobby.teams_${playerTeams}`;
    const teamCount = getTeamCount(playerTeams, maxPlayers ?? 0);
    const translated = translateText(teamKey, { team_count: teamCount });
    if (translated !== teamKey) {
      return translated;
    }
  }

  // Numeric team count (e.g. "5 teams of 20")
  const teamCount =
    typeof playerTeams === "number"
      ? playerTeams
      : getTeamCount(playerTeams, maxPlayers ?? 0);
  const teamSize =
    teamCount > 0 ? Math.floor((maxPlayers ?? 0) / teamCount) : 0;

  // If the computed team size matches a named format, use that label instead
  const namedTeamType =
    teamSize === 2
      ? Duos
      : teamSize === 3
        ? Trios
        : teamSize === 4
          ? Quads
          : null;
  if (namedTeamType) {
    const teamKey = `public_lobby.teams_${namedTeamType}`;
    const translated = translateText(teamKey, { team_count: teamCount });
    if (translated !== teamKey) {
      return translated;
    }
  }

  const teamsLabel = translateText("public_lobby.teams", { num: teamCount });
  if (teamSize > 0) {
    return `${teamsLabel} ${translateText("public_lobby.players_per_team", { num: teamSize })}`;
  }
  return teamsLabel;
}

function getTeamCount(
  playerTeams: string | number | undefined,
  maxPlayers: number,
): number {
  if (typeof playerTeams === "number") return playerTeams;
  const teamSize = getTeamSize(playerTeams, maxPlayers);
  return teamSize > 0 ? Math.floor(maxPlayers / teamSize) : 0;
}

function getTeamSize(
  playerTeams: string | number | undefined,
  maxPlayers: number,
): number {
  if (playerTeams === Duos) return 2;
  if (playerTeams === Trios) return 3;
  if (playerTeams === Quads) return 4;
  if (playerTeams === HumansVsNations) return maxPlayers;
  if (typeof playerTeams === "number" && playerTeams > 0) {
    return Math.floor(maxPlayers / playerTeams);
  }
  return 0;
}

export interface ModifierInfo {
  /** Translation key for detailed label (e.g. "host_modal.random_spawn") */
  labelKey: string;
  /** Translation key for badge/short label (e.g. "public_game_modifier.random_spawn") */
  badgeKey: string;
  /** Parameters to pass to translateText for the badge key */
  badgeParams?: Record<string, string | number>;
  /** The raw value if applicable (e.g. startingGold amount) */
  value?: number;
  /** Pre-formatted display string (used instead of renderNumber when provided) */
  formattedValue?: string;
}

/**
 * Returns structured modifier info for both detailed config display and badges.
 */
export function getActiveModifiers(
  modifiers: PublicGameModifiers | undefined,
): ModifierInfo[] {
  if (!modifiers) return [];
  const result: ModifierInfo[] = [];
  if (modifiers.isRandomSpawn) {
    result.push({
      labelKey: "host_modal.random_spawn",
      badgeKey: "public_game_modifier.random_spawn",
    });
  }
  if (modifiers.isCompact) {
    result.push({
      labelKey: "host_modal.compact_map",
      badgeKey: "public_game_modifier.compact_map",
    });
  }
  if (modifiers.isCrowded) {
    result.push({
      labelKey: "host_modal.crowded",
      badgeKey: "public_game_modifier.crowded",
    });
  }
  if (modifiers.isHardNations) {
    result.push({
      labelKey: "host_modal.hard_nations",
      badgeKey: "public_game_modifier.hard_nations",
    });
  }
  if (modifiers.startingGold) {
    const millions = parseFloat(
      (modifiers.startingGold / 1_000_000).toPrecision(12),
    );
    result.push({
      labelKey: "public_game_modifier.starting_gold_label",
      badgeKey: "public_game_modifier.starting_gold",
      badgeParams: {
        amount: millions,
      },
      value: modifiers.startingGold,
      formattedValue: `${millions}M`,
    });
  }
  if (modifiers.goldMultiplier) {
    result.push({
      labelKey: "host_modal.gold_multiplier",
      badgeKey: "public_game_modifier.gold_multiplier",
      badgeParams: {
        amount: modifiers.goldMultiplier,
      },
      value: modifiers.goldMultiplier,
      formattedValue: `x${modifiers.goldMultiplier}`,
    });
  }
  if (modifiers.isAlliancesDisabled) {
    result.push({
      labelKey: "public_game_modifier.disable_alliances_label",
      badgeKey: "public_game_modifier.disable_alliances",
      formattedValue: translateText("common.disabled"),
    });
  }
  if (modifiers.isPortsDisabled) {
    result.push({
      labelKey: "public_game_modifier.ports_disabled_label",
      badgeKey: "public_game_modifier.ports_disabled",
    });
  }
  if (modifiers.isNukesDisabled) {
    result.push({
      labelKey: "public_game_modifier.nukes_disabled_label",
      badgeKey: "public_game_modifier.nukes_disabled",
    });
  }
  if (modifiers.isSAMsDisabled) {
    result.push({
      labelKey: "public_game_modifier.sams_disabled_label",
      badgeKey: "public_game_modifier.sams_disabled",
    });
  }
  if (modifiers.isPeaceTime) {
    result.push({
      labelKey: "public_game_modifier.peace_time_label",
      badgeKey: "public_game_modifier.peace_time",
    });
  }
  if (modifiers.isWaterNukes) {
    result.push({
      labelKey: "public_game_modifier.water_nukes_label",
      badgeKey: "public_game_modifier.water_nukes",
    });
  }
  return result;
}

/**
 * Returns an array of translated modifier labels for badge display.
 */
export function getModifierLabels(
  modifiers: PublicGameModifiers | undefined,
): string[] {
  return getActiveModifiers(modifiers).map((m) =>
    translateText(m.badgeKey, m.badgeParams),
  );
}

export function renderDuration(totalSeconds: number): string {
  // Floor once so fractional inputs don't leak through to the seconds
  // component (e.g. `0.5` → `"0.5s"`).
  const whole = Math.floor(totalSeconds);
  if (whole <= 0) return `0${translateText("common.duration_second_short")}`;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  // Build largest-first, dropping trailing-zero components so 3600s reads
  // as "1h" rather than "1h 0min 0s", and 60s as "1min" rather than
  // "1min 0s". Sub-minute durations still surface seconds.
  const parts: string[] = [];
  if (hours > 0)
    parts.push(`${hours}${translateText("common.duration_hour_short")}`);
  if (minutes > 0)
    parts.push(`${minutes}${translateText("common.duration_minute_short")}`);
  if (seconds > 0 || parts.length === 0)
    parts.push(`${seconds}${translateText("common.duration_second_short")}`);
  return parts.join(" ");
}

export function renderTroops(troops: number): string {
  return renderNumber(troops / 10);
}

export async function copyToClipboard(
  text: string,
  onSuccess?: () => void,
  onReset?: () => void,
  timeout = 2000,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    if (onSuccess) onSuccess();
    if (onReset) {
      setTimeout(() => {
        onReset();
      }, timeout);
    }
  } catch (err) {
    console.warn("Failed to copy to clipboard", err);
  }
}

export function renderNumber(
  num: number | bigint,
  fixedPoints?: number,
): string {
  num = Number(num);
  num = Math.max(num, 0);

  if (num >= 10_000_000) {
    const value = Math.floor(num / 100000) / 10;
    return value.toFixed(fixedPoints ?? 1) + "M";
  } else if (num >= 1_000_000) {
    const value = Math.floor(num / 10000) / 100;
    return value.toFixed(fixedPoints ?? 2) + "M";
  } else if (num >= 100000) {
    return Math.floor(num / 1000) + "K";
  } else if (num >= 10000) {
    const value = Math.floor(num / 100) / 10;
    return value.toFixed(fixedPoints ?? 1) + "K";
  } else if (num >= 1000) {
    const value = Math.floor(num / 10) / 100;
    return value.toFixed(fixedPoints ?? 2) + "K";
  } else {
    return Math.floor(num).toString();
  }
}

export function formatPercentage(value: number): string {
  const perc = value * 100;
  if (Number.isNaN(perc)) return "0%";
  return perc.toFixed(1) + "%";
}

/**
 * Formats a keyboard key code for user-friendly display.
 * Handles empty values, spaces, and normalizes key codes like "Digit1" and "KeyA".
 *
 * @param value - The key code to format (e.g., "Digit1", "KeyA", "Space")
 * @returns The formatted key for display (e.g., "1", "A", "Space")
 *
 * @example
 * formatKeyForDisplay("Digit5") // returns "5"
 * formatKeyForDisplay("KeyA") // returns "A"
 * formatKeyForDisplay("Space") // returns "Space"
 * formatKeyForDisplay(" ") // returns "Space"
 * formatKeyForDisplay("ArrowUp") // returns "Arrowup"
 * formatKeyForDisplay("") // returns ""
 */
export function formatKeyForDisplay(value: string): string {
  // Handle empty string
  if (!value) return "";

  // Handle Shift+ prefix: format as "Shift+X"
  if (value.startsWith("Shift+")) {
    return "Shift+" + formatKeyForDisplay(value.slice(6));
  }

  // Handle space character or "Space" key
  if (value === " " || value === "Space") return "Space";

  // Handle DigitN pattern (e.g., "Digit1" -> "1")
  if (/^Digit\d$/.test(value)) {
    return value.replace("Digit", "");
  }

  // Handle KeyX pattern (e.g., "KeyA" -> "A")
  if (/^Key[A-Z]$/.test(value)) {
    return value.replace("Key", "");
  }

  // Fallback: capitalize first letter
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");

  // Set canvas style to fill the screen
  canvas.style.position = "fixed";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";

  return canvas;
}
/**
 * A polyfill for crypto.randomUUID that provides fallback implementations
 * for older browsers, particularly Safari versions < 15.4
 */
export function generateCryptoRandomUUID(): string {
  // Type guard to check if randomUUID is available
  if (crypto !== undefined && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  // Fallback using crypto.getRandomValues
  if (crypto !== undefined && "getRandomValues" in crypto) {
    return (([1e7] as any) + -1e3 + -4e3 + -8e3 + -1e11).replace(
      /[018]/g,
      (c: number): string =>
        (
          c ^
          (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
        ).toString(16),
    );
  }

  // Last resort fallback using Math.random
  // Note: This is less cryptographically secure but ensures functionality
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (c: string): string => {
      const r: number = (Math.random() * 16) | 0;
      const v: number = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    },
  );
}

export function formatDebugTranslation(
  key: string,
  params: Record<string, string | number>,
): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return key;
  const serializedParams = entries
    .map(([paramKey, value]) => `${paramKey}=${String(value)}`)
    .join(",");
  return `${key}::${serializedParams}`;
}

const EMPTY_TRANSLATION_PARAMS: Record<string, string | number> = {};

function getCachedLangSelector(): LangSelector | null {
  const self = translateText as any;
  const cached = self.langSelector as LangSelector | null | undefined;
  if (cached && cached.isConnected) return cached;

  const found = document.querySelector("lang-selector") as LangSelector | null;
  self.langSelector = found ?? null;
  return found;
}

// Билингвальный литерал для UI-строк без ключа в lang/*.json (массовая
// локализация хардкода terron). Язык: <lang-selector> → localStorage("lang").
// Фолбэк строго АНГЛИЙСКИЙ. РАНЬШЕ был «колхоз»: при отсутствии явного выбора
// падали на navigator.language — и у пользователей с ru-локалью браузера РУССКИЙ
// протекал в АНГЛИЙСКИЙ интерфейс (выбран EN, а L() отдавал RU). Убрано: язык
// берём ТОЛЬКО из явного выбора (селектор/localStorage), иначе EN.
// Для html-веток заворачивай в resolveMarkdown(L("**ru**…","**en**…")).
export const L = (ru: string, en: string): string => {
  return getCurrentLang() === "ru" ? ru : en;
};

// terron: код текущего языка интерфейса (явный выбор: селектор/localStorage).
// Фолбэк "en". Нужен напр. для письма входа — чтобы оно пришло на языке UI.
export function getCurrentLang(): string {
  let lang = getCachedLangSelector()?.currentLang ?? "";
  if (!lang) {
    try {
      lang = localStorage.getItem("lang") ?? "";
    } catch {
      /* ignore */
    }
  }
  return lang || "en";
}

/**
 * terron 29.07: словарь грузится АСИНХРОННО (fetch lang/<code>.json), а
 * translateText синхронный — пока файл не доехал, он честно возвращает сам ключ.
 * Для текста, который рисуется один раз и больше не перерисовывается (тосты,
 * баннеры), это значит «на экране навсегда остался `private_lobby.joined_waiting`»
 * — ровно этот репорт и прилетел с холодного захода по ссылке на лобби
 * (со второго раза словарь уже в кэше, поэтому баг «плавающий»).
 * Здесь — единая точка ожидания: колбэк выполнится сразу, если словарь готов,
 * иначе один раз по событию `terron-lang-loaded` (шлёт LangSelector).
 */
export function translationsReady(): boolean {
  const langSelector = getCachedLangSelector();
  if (!langSelector) return false;
  return Boolean(langSelector.translations ?? langSelector.defaultTranslations);
}

export function onTranslationsReady(cb: () => void): void {
  if (translationsReady()) {
    cb();
    return;
  }
  window.addEventListener("terron-lang-loaded", () => cb(), { once: true });
}

export const translateText = (
  key: string,
  params?: Record<string, string | number>,
): string => {
  const self = translateText as any;
  self.formatterCache ??= new Map();
  self.lastLang ??= null;

  const langSelector = getCachedLangSelector();
  if (!langSelector) {
    return key;
  }

  const resolvedParams = params ?? EMPTY_TRANSLATION_PARAMS;

  if (langSelector.currentLang === "debug") {
    return formatDebugTranslation(key, resolvedParams);
  }

  const translations = langSelector.translations;
  const defaultTranslations = langSelector.defaultTranslations;
  if (!translations && !defaultTranslations) return key;

  if (self.lastLang !== langSelector.currentLang) {
    self.formatterCache.clear();
    self.lastLang = langSelector.currentLang;
  }

  let message = translations?.[key];
  const hasPrimaryTranslation = message !== undefined;

  message ??= defaultTranslations?.[key];

  if (message === undefined) return key;

  // Fast path: no params and no ICU placeholders.
  if (
    resolvedParams === EMPTY_TRANSLATION_PARAMS &&
    message.indexOf("{") === -1
  ) {
    return message;
  }

  try {
    const locale =
      !hasPrimaryTranslation && langSelector.currentLang !== "en"
        ? "en"
        : langSelector.currentLang;
    const cacheKey = `${key}:${locale}:${message}`;
    let formatter = self.formatterCache.get(cacheKey);

    if (!formatter) {
      formatter = new IntlMessageFormat(message, locale);
      self.formatterCache.set(cacheKey, formatter);
    }

    return formatter.format(resolvedParams) as string;
  } catch (e) {
    console.warn("ICU format error", e);
    return message;
  }
};

export function getTranslatedPlayerTeamLabel(team: Team | null): string {
  if (!team) return "";
  const translationKey = `team_colors.${team.toLowerCase()}`;
  const translated = translateText(translationKey);
  return translated === translationKey ? team : translated;
}

/**
 * Severity colors mapping for message types
 */
export const severityColors: Record<string, string> = {
  fail: "text-red-400",
  warn: "text-yellow-400",
  success: "text-green-400",
  info: "text-gray-200",
  blue: "text-blue-400",
  white: "text-white",
  // terron: золотой матч — строки объявления/победителя в ленте
  golden: "text-amber-300",
};

/**
 * Gets the CSS classes for styling message types based on their severity
 * @param type The message type to get styling for
 * @returns CSS class string for the message type
 */
export function getMessageTypeClasses(type: MessageType): string {
  switch (type) {
    case MessageType.SAM_HIT:
    case MessageType.CAPTURED_ENEMY_UNIT:
    case MessageType.CONQUERED_PLAYER:
    case MessageType.DONATION_RECEIVED:
    case MessageType.ALLIANCE_ACCEPTED:
      return severityColors["success"];
    case MessageType.ATTACK_FAILED:
    case MessageType.ALLIANCE_REJECTED:
    case MessageType.ALLIANCE_BROKEN:
    case MessageType.UNIT_CAPTURED_BY_ENEMY:
    case MessageType.UNIT_DESTROYED:
    case MessageType.NUKE_DETONATED:
      return severityColors["fail"];
    case MessageType.ATTACK_CANCELLED:
    case MessageType.ATTACK_REQUEST:
    case MessageType.DONATION_SENT:
      return severityColors["blue"];
    case MessageType.MIRV_INBOUND:
    case MessageType.NUKE_INBOUND:
    case MessageType.SUICIDE_DRONE_INBOUND:
    case MessageType.HYDROGEN_BOMB_INBOUND:
    case MessageType.SAM_MISS:
    case MessageType.ALLIANCE_EXPIRED:
    case MessageType.NAVAL_INVASION_INBOUND:
    case MessageType.RENEW_ALLIANCE:
    // terron: «Небо наше» — тревога антиспутника (жёлтая, как ядерная)
    case MessageType.SATELLITES_THREATENED: // eslint-disable-line no-fallthrough
    case MessageType.SATELLITES_DOWN:
    // terron: ПИРАТСТВО — блокада торговли (жёлтая тревога)
    case MessageType.BLOCKADE:
    // terron: ФАНАТИЗМ — террор (тревога жертве)
    case MessageType.TERROR:
      return severityColors["warn"];
    // terron: ГОРДОСТЬ — всемирное перемирие (информационное)
    case MessageType.TRUCE:
    // terron: ДВОРЕЦ НАЦИЙ — навязанный пакт (информационное)
    case MessageType.PACT:
      return severityColors["info"];
    // terron: ЗЕЛЁНЫЕ — объявление катастрофы: это удар по экономике цели,
    // поэтому предупреждение, а не нейтральная строка. GREEN.md
    case MessageType.CATASTROPHE:
      return severityColors["warn"];
    // terron: АЭС — взрыв реактора: это ядерное событие, самый громкий уровень.
    case MessageType.CHERNOBYL:
      return severityColors["fail"];
    // terron: АЭС — уборка пепла: информационная строка владельцу.
    case MessageType.RECULTIVATION:
      return severityColors["info"];
    // terron: ТОПЛИВО — навязанная индустриализация: двойственный эффект,
    // поэтому не «плохо» и не «хорошо», а предупреждение.
    case MessageType.INDUSTRIAL_REVOLUTION:
      return severityColors["warn"];
    // terron: ДОРА — выстрел орудия: удар, самый громкий уровень.
    case MessageType.RAILGUN:
      return severityColors["fail"];
    // terron: КОСМОДРОМ — запуск виден всем и с цифрой: это чужие деньги.
    case MessageType.SPACEPORT:
      return severityColors["warn"];
    // terron: ЦЕНТРОБАНК — выплата процента владельцу (личная строка).
    case MessageType.CENTRAL_BANK:
      return severityColors["info"];
    case MessageType.CHAT:
    case MessageType.ALLIANCE_REQUEST:
      return severityColors["info"];
    // terron: золотой матч — объявление в начале и строка о победителе
    case MessageType.GOLDEN_MATCH:
      return severityColors["golden"];
    // terron: шагающий город — служебные строки переноса зданий (владельцу).
    case MessageType.WALKING:
      return severityColors["info"];
    default:
      console.warn(`Message type ${type} has no explicit color`);
      return severityColors["white"];
  }
}

export function getModifierKey(): string {
  return Platform.isMac ? "⌘" : "Ctrl";
}

export function getAltKey(): string {
  return Platform.isMac ? "⌥" : "Alt";
}

export function getGamesPlayed(): number {
  try {
    return parseInt(localStorage.getItem("gamesPlayed") ?? "0", 10) || 0;
  } catch (error) {
    console.warn("Failed to read games played from localStorage:", error);
    return 0;
  }
}

export function incrementGamesPlayed(): void {
  try {
    localStorage.setItem("gamesPlayed", (getGamesPlayed() + 1).toString());
  } catch (error) {
    console.warn("Failed to increment games played in localStorage:", error);
  }
}

export function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch (e) {
    // If we can't access window.top due to cross-origin restrictions,
    // we're definitely in an iframe
    return true;
  }
}

/**
 * terron: НАЗВАНИЕ ИГРЫ в шапке. На своём terron.io бренд всегда латиницей —
 * это домен и логотип. НО модерация GamePush требует локализованное название
 * внутри площадки, поэтому в iframe площадки (класс gp-embed ставится в
 * index.html ещё до рендера) отдаём написание из словаря: ru → «террон»
 * (CSS .terron-logo поднимает в верхний регистр → «ТЕРРОН»), en → «terron».
 * Вне площадки поведение не меняется.
 */
export function brandWordmark(): string {
  try {
    if (!document.documentElement.classList.contains("gp-embed")) {
      return "terron";
    }
    const localized = translateText("main.brand_wordmark");
    // translateText отдаёт сам ключ, если словарь ещё не загрузился.
    return localized === "main.brand_wordmark" ? "terron" : localized;
  } catch {
    return "terron";
  }
}

/**
 * Русское склонение по числу: 1 бумага / 2 бумаги / 5 бумаг.
 * ⚠️ ICU-плюрали у нас НЕ работают — translateText делает простую подстановку
 * `{param}`, а конструкции `{count, plural, ...}` утекают в интерфейс сырыми.
 * Английская форма одна: для 1 берётся `one`, иначе `en`.
 */
export function plural(
  n: number,
  one: string,
  few: string,
  many: string,
  en: string,
): string {
  if (getCurrentLang() !== "ru") return n === 1 ? en.replace(/s$/, "") : en;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Название игры ЗАГЛАВНЫМИ для крупных заголовков интерфейса.
 *  Внутри площадки отдаём локализованное («ТЕРРОН» на русском): модерация
 *  GamePush требует, чтобы название было переведено в меню и в игре. На своём
 *  сайте бренд остаётся латиницей — это решение владельца, площадки оно не
 *  касается. Пара к brandWordmark() (тот же гейт, но строчными для навбара). */
export function brandDisplay(): string {
  try {
    if (!document.documentElement.classList.contains("gp-embed")) {
      return "TERRON";
    }
    const localized = translateText("main.decor_brand");
    return localized === "main.decor_brand" ? "TERRON" : localized;
  } catch {
    return "TERRON";
  }
}

export async function getSvgAspectRatio(src: string): Promise<number | null> {
  const self = getSvgAspectRatio as any;
  self.svgAspectRatioCache ??= new Map();

  const cached = self.svgAspectRatioCache.get(src);
  if (cached !== undefined) return cached;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(src, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    const text = await resp.text();

    // Try parse viewBox
    const vbMatch = text.match(/viewBox="([^"]+)"/i);
    if (vbMatch) {
      const parts = vbMatch[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
        const [, , vbW, vbH] = parts;
        if (vbW > 0 && vbH > 0) {
          const ratio = vbW / vbH;
          self.svgAspectRatioCache.set(src, ratio);
          return ratio;
        }
      }
    }

    // Fallback to width/height attributes (may be with units; strip px)
    const widthMatch = text.match(/<svg[^>]*\swidth="([^"]+)"/i);
    const heightMatch = text.match(/<svg[^>]*\sheight="([^"]+)"/i);
    if (widthMatch && heightMatch) {
      const parseNum = (s: string) => Number(s.replace(/[^0-9.]/g, ""));
      const w = parseNum(widthMatch[1]);
      const h = parseNum(heightMatch[1]);
      if (w > 0 && h > 0) {
        const ratio = w / h;
        self.svgAspectRatioCache.set(src, ratio);
        return ratio;
      }
    }
    // Not an SVG or no usable metadata
  } catch (e) {
    // fetch may fail due to CORS or non-SVG..
  }

  const imgRatio = await new Promise<number | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve(img.naturalWidth / img.naturalHeight);
      } else {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

  if (imgRatio !== null) {
    self.svgAspectRatioCache.set(src, imgRatio);
    return imgRatio;
  }

  return null;
}

export function getDiscordAvatarUrl(user: {
  id: string;
  avatar: string | null;
  discriminator?: string;
}): string | null {
  if (user.avatar) {
    // - id is a Discord numeric string
    // - avatar is a hash, optionally prefixed with "a_" for animated avatars
    const validId = /^\d+$/.test(user.id);
    const validAvatar =
      /^[a-f0-9]+$/.test(user.avatar) || /^a_[a-f0-9]+$/.test(user.avatar);

    if (validId && validAvatar) {
      const extension = user.avatar.startsWith("a_") ? "gif" : "png";
      return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.${extension}?size=64`;
    }
  }

  if (user.discriminator !== undefined) {
    const idx = Number(user.discriminator) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  }

  return null;
}
export function calculateServerTimeOffset(
  serverTimeMs: number,
  localNowMs: number = Date.now(),
): number {
  return serverTimeMs - localNowMs;
}

export function getServerNow(
  serverTimeOffsetMs: number,
  localNowMs: number = Date.now(),
): number {
  return localNowMs + serverTimeOffsetMs;
}

export function showToast(
  message: string,
  color: "red" | "green",
  duration = 3500,
): void {
  window.dispatchEvent(
    new CustomEvent("show-message", {
      detail: { message, color, duration },
    }),
  );
}

export function getSecondsUntilServerTimestamp(
  targetServerTimestampMs: number,
  serverTimeOffsetMs: number,
  localNowMs: number = Date.now(),
): number {
  return Math.max(
    0,
    Math.floor(
      (targetServerTimestampMs - getServerNow(serverTimeOffsetMs, localNowMs)) /
        1000,
    ),
  );
}

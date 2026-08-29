import { html, svg, TemplateResult } from "lit";
import { L } from "../../Utils";

// terron 31.07: НАЗВАНИЕ И ЗНАЧОК ПЛОЩАДКИ для кнопки входа.
//
// Раньше кнопка была обезличенной — «Войти через площадку», без значка: одна
// сборка едет на все площадки, а какая под нами — до старта SDK неизвестно.
// После старта известно: `gp.platform.type`. Здесь этот тип превращается в
// человеческое имя и значок.
//
// ⚠️ ЗНАЧКИ РИСУЕМ САМИ, монохромно — буквой в рамке. Тащить чужие логотипы
// (с их CDN или файлами в репо) не стоит: чужие торговые марки, внешние
// запросы из iframe и лишний вес. Буква узнаётся не хуже и принадлежит нам.
//
// Покрыт ВЕСЬ перечень `PlatformType` их API — 38 значений (сверено запросом к
// схеме 31.07). Фолбэк всё равно оставлен: они добавляют площадки, и незнакомый
// тип должен давать грамотную фразу и общий значок, а не пустоту.

interface PlatformBadge {
  /** Имя для фразы «Войти через …». */
  name: string;
  /** Метка внутри значка: буква или пара букв. */
  glyph: string;
}

/** Полная карта площадок GamePush. Ключи — значения enum PlatformType. */
function badges(): Record<string, PlatformBadge> {
  return {
    // ── РФ и СНГ ────────────────────────────────────────────────
    YANDEX: { name: L("Яндекс Игры", "Yandex Games"), glyph: "Я" },
    VK: { name: "VK", glyph: "VK" },
    VK_PLAY: { name: "VK Play", glyph: "VP" },
    OK: { name: L("Одноклассники", "OK"), glyph: "OK" },
    MOI_MIR: { name: L("Мой Мир", "Moi Mir"), glyph: "М" },
    PIKABU: { name: L("Пикабу", "Pikabu"), glyph: "П" },
    FOTOSTRANA: { name: L("Фотострану", "Fotostrana"), glyph: "Ф" },
    SMARTMARKET: { name: L("Сбер", "SmartMarket"), glyph: "S" },
    RUSTORE: { name: "RuStore", glyph: "RU" },
    BEELINE: { name: L("Билайн", "Beeline"), glyph: "Б" },
    WG_PLAYGROUND: { name: "WG Playground", glyph: "WG" },
    PLAYGAMA: { name: "Playgama", glyph: "PG" },
    PLAYDECK: { name: "PlayDeck", glyph: "PD" },
    TELEGRAM: { name: "Telegram", glyph: "TG" },

    // ── Западные веб-порталы ────────────────────────────────────
    CRAZY_GAMES: { name: "CrazyGames", glyph: "CG" },
    POKI: { name: "Poki", glyph: "PK" },
    Y8: { name: "Y8", glyph: "Y8" },
    GAMEPIX: { name: "GamePix", glyph: "GX" },
    KONGREGATE: { name: "Kongregate", glyph: "K" },
    ARKADIUM: { name: "Arkadium", glyph: "A" },
    COOLMATH: { name: "Coolmath Games", glyph: "CM" },
    PLAYDIA: { name: "Playdia", glyph: "PL" },
    GAME_MONETIZE: { name: "GameMonetize", glyph: "GM" },
    GAME_DISTRIBUTION: { name: "GameDistribution", glyph: "GD" },
    JIO_GAMES: { name: "JioGames", glyph: "JG" },
    YOUTUBE: { name: "YouTube Playables", glyph: "YT" },
    FB: { name: "Facebook", glyph: "FB" },

    // ── Магазины приложений ─────────────────────────────────────
    GOOGLE_PLAY: { name: "Google Play", glyph: "GP" },
    APP_GALLERY: { name: "AppGallery", glyph: "AG" },
    GALAXY_STORE: { name: "Galaxy Store", glyph: "GS" },
    ONE_STORE: { name: "ONE Store", glyph: "1S" },
    AMAZON_APPSTORE: { name: "Amazon Appstore", glyph: "AZ" },
    XIAOMI_GETAPPS: { name: "Xiaomi GetApps", glyph: "MI" },
    XIAOMI_GAMECENTER: { name: "Xiaomi Game Center", glyph: "MG" },
    APTOIDE: { name: "Aptoide", glyph: "AP" },
    ANDROID: { name: "Android", glyph: "AD" },

    // ── Служебные: своя сборка / партнёр / вне площадки ─────────
    CUSTOM: { name: L("свою площадку", "your platform"), glyph: "" },
    PARTNER: { name: L("площадку партнёра", "the partner platform"), glyph: "" },
    NONE: { name: L("площадку", "the platform"), glyph: "" },
  };
}

/**
 * «Яндекс Игры» / «VK Play» / … Незнакомая площадка (они их добавляют) —
 * общее слово, чтобы фраза «Войти через …» осталась грамотной.
 */
export function platformLabel(type: string | undefined): string {
  return badges()[type ?? ""]?.name ?? L("площадку", "the platform");
}

/**
 * Значок площадки: буква в рамке. Служебным типам и незнакомой площадке —
 * джойстик; он же показывается, пока SDK ещё не сказал, где мы.
 */
export function platformIcon(
  type: string | undefined,
  size = 16,
): TemplateResult {
  const glyph = badges()[type ?? ""]?.glyph ?? "";
  const label = platformLabel(type);
  const body = glyph
    ? svg`<rect x="1.5" y="1.5" width="21" height="21" rx="5"
            fill="none" stroke="currentColor" stroke-width="1.6"/>
          <text x="12" y="16.4" text-anchor="middle" fill="currentColor"
            font-family="Oswald, sans-serif" font-weight="600"
            font-size=${glyph.length > 1 ? 9 : 12}>${glyph}</text>`
    : // Фолбэк — джойстик: читается как «игровая площадка» без букв.
      svg`<rect x="2" y="7" width="20" height="11" rx="5" fill="none"
            stroke="currentColor" stroke-width="1.6"/>
          <path d="M7 10.5v4M5 12.5h4" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round"/>
          <circle cx="16.5" cy="11.8" r="1.1" fill="currentColor"/>
          <circle cx="18.8" cy="14.2" r="1.1" fill="currentColor"/>`;
  return html`<svg
    viewBox="0 0 24 24"
    width=${size}
    height=${size}
    role="img"
    aria-label=${label}
    style="display:inline-block;vertical-align:-3px;flex:0 0 auto"
  >
    ${body}
  </svg>`;
}

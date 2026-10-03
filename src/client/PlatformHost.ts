/**
 * terron 05.09 — ОДИН ОТВЕТ НА ВОПРОС «ГДЕ МЫ ЗАПУЩЕНЫ».
 *
 * До этого признак площадки жил в семи местах и трёх формах: класс `html.gp-embed`
 * (бутстрап index.html), флаг `window.__platformLaunch`, `self !== top`, сборочная
 * константа `__PLATFORM_BUILD__`, `isItchEmbed()`, `GamePushSDK.isOnPlatform()`,
 * `isPlaygamaBuild()`. Каждая новая площадка (ВК, ОК, Яндекс, GamePush-хостинг,
 * Playgama, itch, апки, десктоп) добавляла ещё одну ветку в ещё одном файле — и
 * половина багов модерации 08–09.2026 была ровно «одно место знало, другое нет».
 *
 * Правило: ВЕСЬ остальной клиент спрашивает `Host`, а не SDK и не DOM. Сторож —
 * tests/client/PlatformHostFacade.test.ts (вне белого списка SDK-модулей запрещены
 * прямые `GamePushSDK.`, `PlaygamaBridge`, `gp-embed`, `__PLATFORM_BUILD__`,
 * `__platformLaunch`, `self !== top`, `isItchEmbed(`).
 *
 * Семантика трёх «мы на площадке», которые НЕ одно и то же (и это осознанно):
 *  - `inPlatformFrame()` — класс `gp-embed`: чужой кадр/WebView площадки, включая itch.
 *    Гейтит косметику и внешние ссылки (тема, футер, колокольчик, документы).
 *  - `isPlatform()` — платформенная СБОРКА (залитый бандл) ИЛИ `gp-embed`: там нельзя
 *    перезагружать страницу (SDK площадки умрёт) — мягкая навигация.
 *  - `isGamePush()` — SDK GamePush активен (флаг запуска или чужой iframe, не itch):
 *    реклама, автовход, сигналы раунда.
 */
import { GamePushSDK } from "./GamePushSDK";
import {
  initPlaygamaBridge,
  isPlaygamaBuild,
  lastAuthFailure,
  noteMatchOutcome,
  playgamaPlatformId,
} from "./PlaygamaBridge";
import { isItchEmbed } from "./Utils";

declare const __PLATFORM_BUILD__: string | undefined;

export type HostKind = "site" | "itch" | "gamepush" | "playgama";
export type MatchOutcome = "won" | "lost" | "died" | "quit" | "left";

function htmlHas(cls: string): boolean {
  try {
    return document.documentElement.classList.contains(cls);
  } catch {
    return false;
  }
}

export const Host = {
  /** Платформенная сборка (`vite build --mode playgama|gamepush`). */
  isPlatformBuild(): boolean {
    try {
      return (
        typeof __PLATFORM_BUILD__ === "string" && __PLATFORM_BUILD__.length > 0
      );
    } catch {
      return false;
    }
  },
  isPlaygama(): boolean {
    return isPlaygamaBuild();
  },
  isItch(): boolean {
    return isItchEmbed();
  },
  isGamePush(): boolean {
    return GamePushSDK.isOnPlatform();
  },
  kind(): HostKind {
    if (isPlaygamaBuild()) return "playgama";
    if (isItchEmbed()) return "itch";
    if (GamePushSDK.isOnPlatform()) return "gamepush";
    return "site";
  },
  /** Чужой кадр/WebView площадки (класс `gp-embed` из бутстрапа), включая itch. */
  inPlatformFrame(): boolean {
    return htmlHas("gp-embed");
  },
  /** Платформенная сборка ИЛИ чужой кадр — перезагрузка страницы запрещена. */
  isPlatform(): boolean {
    return Host.isPlatformBuild() || htmlHas("gp-embed");
  },
  /** Ссылки наружу (сторы, телега, скачивание): площадки за них карают; itch — нет. */
  externalLinksAllowed(): boolean {
    return !(htmlHas("gp-embed") && !htmlHas("itch-embed"));
  },
  /** Id площадки как его знает SDK: "VK", "YANDEX", "OK", playgama-id… */
  platformId(): string | null {
    if (isPlaygamaBuild()) return playgamaPlatformId() || null;
    const t = GamePushSDK.platformType();
    return t && t !== "NONE" ? t : null;
  },
  isYandex(): boolean {
    return GamePushSDK.platformType() === "YANDEX";
  },
  /** Имя игрока с площадки (ник ВК/Яндекса) или null. */
  platformName(): string | null {
    return GamePushSDK.platformName();
  },

  // ---- жизненный цикл (сигналы площадке) --------------------------------------
  /** Точка входа Main: SDK площадок, реклама меню, тихий автовход. */
  bootstrap(): void {
    initPlaygamaBridge();
    void GamePushSDK.maybeInit().then(() => {
      GamePushSDK.gameStart();
      GamePushSDK.applyPlatformLanguage();
      GamePushSDK.showPreloaderAd();
      GamePushSDK.showStickyAd();
      if (
        GamePushSDK.isPlayerLoggedIn() &&
        !GamePushSDK.autoLoginSuppressed()
      ) {
        void GamePushSDK.loginToBackend({
          allowCreate: GamePushSDK.platformAlwaysAuthorized(),
        });
      }
    });
  },
  /** Матч начался: границы раунда для площадки, баннер не висит поверх карты. */
  gameplayStart(): void {
    GamePushSDK.gameplayStart();
    GamePushSDK.hideStickyAd();
  },
  /**
   * Матч кончился. `ads: true` — возврат в меню: единственный перерыв, где площадки
   * разрешают полноэкранный ролик и баннер снова уместен. `ads: false` — только
   * закрыть раунд (мягкий уход по сайту; вызов парный, повтор безвреден).
   */
  gameplayStop(ads: boolean): void {
    GamePushSDK.gameplayStop();
    if (ads) {
      GamePushSDK.showFullscreenAd();
      GamePushSDK.showStickyAd();
    }
  },
  reportPause(paused: boolean): void {
    GamePushSDK.reportPause(paused);
  },
  reportLanguage(lang: string): void {
    GamePushSDK.reportLanguage(lang);
  },
  /** Исход матча — в счётчики обеих площадок (GamePush recordMatch, Playgama level_*). */
  recordMatch(outcome: MatchOutcome): void {
    GamePushSDK.recordMatch(outcome === "won");
    noteMatchOutcome(outcome);
  },

  // ---- полноэкранный режим площадки ------------------------------------------
  fullscreenSupported(): boolean {
    return GamePushSDK.isOnPlatform();
  },
  isFullscreen(): boolean {
    return GamePushSDK.isFullscreen();
  },
  /** true — площадка взяла переключение на себя. */
  toggleFullscreen(): boolean {
    return GamePushSDK.isOnPlatform() && GamePushSDK.toggleFullscreen();
  },

  // ---- вход через площадку (экран аккаунта) ----------------------------------
  /** У площадки своё окно входа (не только код) — см. GamePushSDK.canNativeLogin. */
  canNativeLogin(): boolean {
    return isPlaygamaBuild() ? true : GamePushSDK.canNativeLogin();
  },
  canSecretCodeLogin(): boolean {
    return !isPlaygamaBuild() && GamePushSDK.canSecretCodeLogin();
  },
  /** Клик «Войти через площадку» (с кодом — механика GamePush). */
  async platformLogin(withSecretCode = false): Promise<boolean> {
    if (isPlaygamaBuild()) {
      const { platformSignIn } = await import("./PlatformAuth");
      return platformSignIn();
    }
    return GamePushSDK.platformLogin(withSecretCode);
  },
  lastAuthFailure(): string | null {
    return lastAuthFailure();
  },
  /** Явный выход: пометка «сам вышел» (автовход молчит) + выход у площадки. */
  async logoutPlatform(): Promise<void> {
    GamePushSDK.noteExplicitLogout();
    await GamePushSDK.logoutPlatform();
  },
  loginDebug() {
    return GamePushSDK.loginDebug();
  },
};

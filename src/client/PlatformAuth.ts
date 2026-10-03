// terron 30.08: ОДИН ОТВЕТ НА ВОПРОС «можно ли войти через площадку и как».
//
// Кнопка «Войти через площадку» на экране аккаунта звала GamePush напрямую. В
// сборке под Playgama его SDK нет вовсе, а кнопка всё равно показывалась —
// потому что признак «мы на площадке» у GamePush это просто «мы в чужом
// iframe». Итог: игрок жмёт «Войти» и получает «Вход не удался» (репорт
// владельца 30.08 из их QA-инструмента).
//
// ⚠️ Тот же приём, что у рекламы (PlatformAds): площадку выбирает ЭТОТ модуль.
// Иначе на каждой следующей площадке придётся править экран аккаунта, а условия
// «показывать кнопку» и «что она делает» разъедутся — ровно как сейчас.
import { GamePushSDK } from "./GamePushSDK";
import {
  VERIFIABLE_PLATFORMS,
  isPlaygamaBuild,
  playgamaAuthorizeAndLogin,
  playgamaAuthorized,
  playgamaLanguageReady,
  playgamaPlatformId,
} from "./PlaygamaBridge";

/** Есть ли вообще вход через площадку в этой сборке. */
export function platformAuthAvailable(): boolean {
  if (isPlaygamaBuild()) {
    // ⚠️ Только там, где НАШ СЕРВЕР может проверить игрока (playgama/msn/
    // microsoft_store — см. auth/playgamaVerify.ts). На остальных площадках
    // Playgama проверить некого, аккаунтов там нет вовсе, и кнопка вела бы в
    // тупик с той же ошибкой, которую мы сейчас и чиним.
    return VERIFIABLE_PLATFORMS.has(playgamaPlatformId());
  }
  return GamePushSDK.canPlatformLogin();
}

/** Даст ли площадка этого типа тихий автовход (игрок уже вошёл в неё → аккаунт
 *  поднимается без кнопки). Для превью тест-режима: SDK там не поднят. */
export function platformAutoLoginFor(type: string): boolean {
  if (isPlaygamaBuild()) return false;
  return GamePushSDK.platformAlwaysAuthorizedFor(type);
}

/** Площадка есть, но её SDK ещё поднимается — вход вот-вот начнётся сам. */
export function platformLoginPending(): boolean {
  if (isPlaygamaBuild()) return false;
  return GamePushSDK.platformInitPending();
}

/** Площадка уже знает игрока — окно входа не нужно, дожимаем только наш бэкенд. */
export function platformAlreadyAuthorized(): boolean {
  if (isPlaygamaBuild()) return playgamaAuthorized();
  return GamePushSDK.isPlayerLoggedIn();
}

/** Выполнить вход. true — наша сессия поднята. */
export async function platformSignIn(): Promise<boolean> {
  if (isPlaygamaBuild()) return playgamaAuthorizeAndLogin();
  GamePushSDK.clearExplicitLogout(); // клик «Войти» = явное намерение
  return GamePushSDK.loginToBackend();
}

/**
 * Язык площадки для старта интерфейса.
 *
 * ⚠️ Тот же фасад, что у рекламы и входа: `LangSelector` спрашивал язык ТОЛЬКО
 * у GamePush, поэтому в сборке под другую площадку язык не применялся вовсе
 * (репорт владельца 30.08: «переключение языков ты проебал»).
 */
export async function platformLanguage(
  timeoutMs = 1500,
): Promise<string | null> {
  if (isPlaygamaBuild()) return playgamaLanguageReady(timeoutMs);
  return GamePushSDK.platformLanguageReady(timeoutMs);
}

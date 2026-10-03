// terron 30.08: ОДИН ОТВЕТ НА ВОПРОС «есть ли ролик за награду и как его показать».
//
// Кнопка «×2» на экране итогов матча появилась под GamePush и звала его SDK
// напрямую. В сборке под Playgama того SDK нет вовсе — то есть кнопка там не
// появилась бы никогда, а их сертификация ровно этого и требует («Certification
// requires at least one type of advertising»).
//
// ⚠️ Поэтому площадку выбирает ЭТОТ модуль, а не экран победы. Иначе на каждой
// следующей площадке пришлось бы править WinModal, и разъехались бы условия
// показа: где-то кнопка есть, а ролик не показывается.
//
// Сценарий один и тот же на всех площадках: досмотрел ролик → сервер удваивает
// награду за матч. Второго сценария не заводим — игрок к этой кнопке привык.
import { GamePushSDK } from "./GamePushSDK";
import {
  isPlaygamaBuild,
  playgamaRewardedAvailable,
  playgamaShowRewarded,
} from "./PlaygamaBridge";

/** Можно ли прямо сейчас предложить ролик (без него кнопку ×2 не рисуем). */
export function rewardedAvailable(): boolean {
  if (isPlaygamaBuild()) return playgamaRewardedAvailable();
  return GamePushSDK.isRewardedAvailable();
}

/** Показать ролик. true — площадка подтвердила просмотр. */
export function showRewarded(): Promise<boolean> {
  if (isPlaygamaBuild()) return playgamaShowRewarded();
  return GamePushSDK.showRewardedAd();
}

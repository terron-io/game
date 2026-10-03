// terron 28.09: МАТЧ НАЧАЛСЯ НА ДРУГОЙ ВЕРСИИ ЯДРА. Выкат посреди матча: сервер
// резюмирует игру, и кто НЕ перезагружал вкладку, играет дальше на прежней
// симуляции, а кто перезагрузил — получает новый бандл и новое ядро. Его картина
// тихо расходится с остальными (21:04 28.09, вечерний алмазный: у tomsrn
// «население в ноль», у всех остальных и в реплее — нет). Сервер помнит, на каком
// ядре матч создан, и присылает отпечаток в старте; не совпал — говорим игроку
// сразу, а не через десять минут модалкой «рассинхрон».
import { reportHealth } from "./Health";
import { toast } from "./Toast";
import { translateText } from "./Utils";

declare const __CORE_HASH__: string | undefined;

let mismatch = false;

/** Отпечаток ядра этого бандла (vite define); вне сборки — null. */
export function myCoreHash(): string | null {
  return typeof __CORE_HASH__ === "string" && __CORE_HASH__.length > 0
    ? __CORE_HASH__
    : null;
}

/** Отпечатки известны оба и разные. Нет любого — не знаем, молчим. */
export function isCoreMismatch(
  matchHash: string | undefined,
  mine: string | null = myCoreHash(),
): boolean {
  return !!matchHash && !!mine && matchHash !== mine;
}

/** Уже предупредили в этом матче — модалка рассинхрона объясняет причину. */
export function coreMismatchNoticed(): boolean {
  return mismatch;
}

/**
 * Обновление вышло посреди матча, а эта вкладка ещё на версии матча: её надо
 * просто НЕ перезагружать до конца (иначе получит новое ядро и разойдётся).
 */
export function shouldWarnNoReload(
  matchHash: string | undefined,
  serverHash: string | undefined,
  mine: string | null = myCoreHash(),
): boolean {
  return (
    !!matchHash &&
    !!serverHash &&
    !!mine &&
    matchHash === mine &&
    serverHash !== mine
  );
}

/** Зовётся на старт-сообщении живого матча (не реплей, не одиночка). */
export function noteMatchCoreHash(
  matchHash: string | undefined,
  gameID: string,
  serverHash?: string,
): void {
  if (shouldWarnNoReload(matchHash, serverHash)) {
    toast(translateText("error_modal.update_dont_reload"), "info", 20_000);
  }
  mismatch = isCoreMismatch(matchHash);
  if (!mismatch) return;
  toast(translateText("error_modal.desync_update_notice"), "info", 20_000);
  reportHealth("core_mismatch", `match ${matchHash} · mine ${myCoreHash()}`, {
    gameID,
  });
}

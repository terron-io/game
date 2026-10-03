// terron 12.09: ОДИН ОТВЕТ НА ВОПРОС «как купить через площадку» — по образцу
// PlatformAds/PlatformAuth: площадку выбирает этот модуль, витрина магазина о
// SDK не знает. Сегодня покупки умеет только GamePush; у Playgama платёжки в
// нашей сборке нет (гейт оплаты там прячет магазин целиком).
//
// ⚠️ Факт оплаты клиент НЕ устанавливает: после purchase() он лишь сообщает
// серверу id покупки (POST /gp/purchase/claim), а тот проверяет её у GamePush
// и начисляет. Погашение (consume) — ТОЛЬКО после ответа сервера.
import { GamePushSDK, type GPProduct } from "./GamePushSDK";
import { isPlaygamaBuild } from "./PlaygamaBridge";

export type PlatformProduct = GPProduct;

/** Площадка отдаёт покупки (SDK поднят и платежи на ней есть). */
export function platformPurchasesAvailable(): boolean {
  if (isPlaygamaBuild()) return false;
  return GamePushSDK.paymentsAvailable();
}

/** Наши пакеты ПТС в каталоге площадки: тег = sku (pts_50 … pts_2000). */
export function platformPtsProducts(): PlatformProduct[] {
  if (isPlaygamaBuild()) return [];
  return GamePushSDK.paymentProducts()
    .filter((p) => /^pts_\d+$/i.test(p.tag ?? ""))
    .sort((a, b) => ptsOf(a) - ptsOf(b));
}

export function ptsOf(p: PlatformProduct): number {
  const m = /^pts_(\d+)$/i.exec(p.tag ?? "");
  return m ? Number(m[1]) : 0;
}

/** Открыть окно оплаты площадки; вернуть id покупки у GamePush или null. */
export function platformPurchase(tag: string): Promise<string | null> {
  if (isPlaygamaBuild()) return Promise.resolve(null);
  return GamePushSDK.purchase(tag);
}

/** terron 20.09: оплаченные, но не погашенные пакеты (прошлый claim не дошёл). */
export function platformPendingPtsTags(): string[] {
  if (isPlaygamaBuild()) return [];
  return GamePushSDK.unconsumedPtsTags();
}

/** Погасить покупку после начисления сервером. */
export function platformConsume(tag: string): Promise<boolean> {
  if (isPlaygamaBuild()) return Promise.resolve(false);
  return GamePushSDK.consume(tag);
}

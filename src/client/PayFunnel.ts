// terron 28.08: ВЕРХ ВОРОНКИ ПЛАТЕЖЕЙ.
//
// Запрос владельца: «открыли корзину и тд тп, конверсия». Считать это было не
// из чего: первая запись про деньги — уже созданный заказ, то есть обрыв
// «зашёл в витрину и передумал» не виден вовсе.
//
// ⚠️ Событие «открыл витрину» шлётся РАЗ ЗА СЕССИЮ (дедуп в sessionStorage, а
// не в поле модуля — страница магазина пересоздаётся). Иначе на каждый вход во
// вкладку летела бы запись, и «сколько людей видело витрину» превратилось бы в
// «сколько раз кликнули».
//
// ⚠️ Запись НИ НА ЧТО не влияет: ни на валюту, ни на заказы. Поэтому ошибки
// глушим молча — аналитика не имеет права мешать игроку платить.
import { getApiBase } from "./Api";
import { getPersistentID } from "./Auth";
import { isDevSite } from "./Utils";

export type PayFunnelEvent = "topup_open" | "pack_click";

export function reportPayFunnel(kind: PayFunnelEvent, sku?: string): void {
  try {
    if (kind === "topup_open") {
      const key = "terron_topup_seen";
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    }
  } catch {
    /* приватный режим — шлём как есть, дубли не страшны */
  }
  try {
    void fetch(`${getApiBase()}/pay/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        sku: sku ?? null,
        deviceId: getPersistentID(),
        dev: isDevSite(),
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

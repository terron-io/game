// terron 03.09: БАННЕР «НЕ УДАЛОСЬ ЗАГРУЗИТЬ ДАННЫЕ» НА ГЛАВНОЙ.
//
// Требование модерации (Яндекс через GamePush), дословно: «игра должна прозрачно
// коммуницировать с пользователем, если не удалось получить данные с внешних
// ресурсов: дать информативное сообщение и предложить действие — кнопку
// повторного запроса или перезагрузку страницы».
//
// До этого оба главных отказа главной были НЕМЫМИ: сокет витрины сдавался
// (lobby_socket_gave_up) с английским тостом или вовсе молча и тихо ретраил раз в
// полминуты; словарь после всех попыток (lang_load_failed) просто оставлял сырые
// ключи. Игрок видел замершую витрину и не знал, ждать или перезагружать.
//
// ОДИН механизм на оба случая: плашка с текстом и двумя кнопками. «Повторить»
// шлёт событие NET_RETRY_EVENT — его слушают сами загрузчики (сокет витрины
// переподключается сразу, словарь делает попытку сразу), второй копии логики
// повтора тут нет. «Перезагрузить» — на площадке мягкий возврат (жёсткая
// перезагрузка переинициализирует их SDK), иначе location.reload().
// Плашка снимается сама, когда источник ожил (hideNetTrouble). В матче не
// рисуется — там свой модал ошибки с кнопкой «Перезагрузить».
import { Host } from "./PlatformHost";
import { L } from "./Utils";

export type NetTroubleSource = "lobby" | "lang";
export const NET_RETRY_EVENT = "terron-net-retry";
const ID = "terron-net-trouble";

const active = new Set<NetTroubleSource>();

export function showNetTrouble(source: NetTroubleSource): void {
  if (typeof document === "undefined") return;
  active.add(source);
  render();
}

export function hideNetTrouble(source: NetTroubleSource): void {
  if (typeof document === "undefined") return;
  active.delete(source);
  render();
}

/** Что сейчас сломано (для тестов и датчиков). */
export function netTroubleSources(): NetTroubleSource[] {
  return [...active];
}

function render(): void {
  const existing = document.getElementById(ID);
  const inGame = document.body?.classList.contains("in-game");
  if (active.size === 0 || inGame) {
    existing?.remove();
    return;
  }
  if (existing) return; // уже показана — не мигать
  const box = document.createElement("div");
  box.id = ID;
  box.setAttribute("role", "alert");
  box.style.cssText =
    "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:100000;" +
    "max-width:min(94vw,560px);display:flex;flex-wrap:wrap;gap:10px;align-items:center;" +
    "background:#fdfcf7;color:#2b2a24;border:2px solid #2b2a24;padding:10px 14px;" +
    "box-shadow:6px 6px 0 rgba(43,42,36,.25);font:500 13px/1.4 'Golos Text',system-ui,sans-serif";
  const msg = document.createElement("div");
  msg.style.cssText = "flex:1 1 220px";
  msg.textContent = L(
    "Не удалось загрузить данные с сервера. Проверь соединение и попробуй ещё раз.",
    "Couldn't load data from the server. Check your connection and try again.",
  );
  const mkBtn = (label: string, primary: boolean) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText =
      "padding:7px 12px;border:2px solid #2b2a24;cursor:pointer;font-weight:700;" +
      "font:700 12px 'Oswald',system-ui,sans-serif;text-transform:uppercase;" +
      (primary
        ? "background:#2b2a24;color:#fdfcf7"
        : "background:transparent;color:#2b2a24");
    return b;
  };
  const retry = mkBtn(L("Повторить", "Retry"), true);
  retry.dataset.action = "retry";
  retry.onclick = () => {
    retry.disabled = true;
    setTimeout(() => (retry.disabled = false), 3000);
    window.dispatchEvent(new CustomEvent(NET_RETRY_EVENT));
  };
  const reload = mkBtn(L("Перезагрузить", "Reload"), false);
  reload.dataset.action = "reload";
  reload.onclick = () => {
    void import("./SoftNavigate").then(async ({ softReload }) => {
      if (Host.isPlatform() && (await softReload())) return;
      window.location.reload();
    });
  };
  box.append(msg, retry, reload);
  document.body.appendChild(box);
}

// terron 28.09: ЛС и чат клана — ТОЛЬКО на сайте (решение владельца). Внутри
// площадок (ВК, ОК, Яндекс, Пикабу — GamePush-кадр, itch, Playgama) и в
// приложениях из Google Play / App Store чата нет вовсе: свободный текст между
// игроками там — отдельные требования модерации (UGC), и рисковать публикацией
// ради чата незачем. Один гейт на всё: панель, кнопки «Написать» в досье, у
// друзей и в клане, строка о новом ЛС в ленте матча.
import { payHost } from "./PayGate";
import { Host } from "./PlatformHost";

export function siteChatAllowed(): boolean {
  if (Host.isPlatform()) return false;
  // WebView считаем апкой (PayGate.TREAT_WEBVIEW_AS_NATIVE): лучше лишний раз
  // спрятать чат в ин-апп браузере, чем показать его в приложении из стора.
  return payHost().kind === "site";
}

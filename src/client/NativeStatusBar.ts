// terron iOS: статус-бар скрываем ТОЛЬКО в игре. Шлём сообщение нативному
// WKScriptMessageHandler "statusBar" (см. MainViewController.swift), который
// переключает prefersStatusBarHidden. Без Capacitor-плагина (он давал рекурсию).
// В браузере/Android window.webkit.messageHandlers нет → молча no-op.
export function setNativeStatusBarHidden(hidden: boolean): void {
  const handler = (
    window as unknown as {
      webkit?: { messageHandlers?: { statusBar?: { postMessage: (m: unknown) => void } } };
    }
  ).webkit?.messageHandlers?.statusBar;
  if (!handler) return;
  try {
    handler.postMessage({ hidden });
  } catch {
    /* недоступно — не критично */
  }
  // Класс только когда статус-бар РЕАЛЬНО скрыт (iOS-нативка) → CSS поднимает
  // верхний игровой HUD в освободившуюся зону. На Android/браузере handler'а
  // нет → класса нет → HUD остаётся под нотчем (бар там на месте).
  document.body.classList.toggle("sb-hidden", hidden);
}

import { isNativeApp } from "./Platform";

// terron: короткая тактильная отдача в НАТИВНОМ приложении (iOS Taptic / Android
// вибро). Зовём рантайм-прокси Capacitor (window.Capacitor.Plugins.Haptics),
// чтобы веб-сборка НЕ зависела от плагина: натив-плагин добавляется отдельно при
// сборке приложения (`npm i @capacitor/haptics && npx cap sync ios android`).
// На сайте-в-браузере — no-op (isNativeApp() === false). Никогда не роняет UI.
type Buzz = "light" | "medium" | "heavy";

export function buzz(kind: Buzz = "light"): void {
  if (!isNativeApp()) return;
  try {
    const haptics = (
      window as unknown as {
        Capacitor?: { Plugins?: { Haptics?: { impact?: (o: unknown) => void } } };
      }
    ).Capacitor?.Plugins?.Haptics;
    if (haptics?.impact) {
      // ImpactStyle enum плагина = строки HEAVY/MEDIUM/LIGHT.
      const style = kind === "heavy" ? "HEAVY" : kind === "medium" ? "MEDIUM" : "LIGHT";
      haptics.impact({ style });
      return;
    }
    // Фоллбэк (Android WebView без плагина): короткая вибрация Web-API.
    (navigator as unknown as { vibrate?: (ms: number) => void }).vibrate?.(
      kind === "heavy" ? 45 : kind === "medium" ? 25 : 15,
    );
  } catch {
    /* тактилка не критична */
  }
}

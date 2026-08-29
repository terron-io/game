import { GamePushSDK } from "./GamePushSDK";
import { isDevSite } from "./Utils";

// terron 01.08: ПЛАШКА СОСТОЯНИЯ ВХОДА — ТОЛЬКО НА ДЕВЕ.
//
// Сестра DevAudioBadge и заведена по той же причине: со звуком спор «дошёл
// сигнал или нет» решался вслепую, пока факт не вывели на экран. С входом
// ровно так же — «вошёл, а игра просит войти», «сделал СБРОС, а я в старом
// аккаунте». Здесь ОБЕ стороны сразу: что думает площадка и что думаем мы.
//
// Показывается по `?login=1` (запоминается на браузер), гасится `?login=0`.
// На проде не появляется никогда (гейт по хосту dev.*).

let el: HTMLDivElement | null = null;
let lastEvent = "—";
let ourAccount = "…";

/** Наш аккаунт: номер и через что вошёл. Тянем редко — это сетевой запрос. */
async function refreshOurAccount(): Promise<void> {
  try {
    const { getMyProfile } = await import("./Api");
    const me = await getMyProfile();
    ourAccount = me?.user
      ? `#${me.user.number ?? "?"} (${me.user.authProvider ?? "—"})`
      : "гость";
  } catch {
    ourAccount = "ошибка запроса";
  }
  render();
}

function render(): void {
  if (!el) return;
  const d = GamePushSDK.loginDebug();
  const platform = d.sdk
    ? `${d.loggedIn ? "ВОШЁЛ" : "гость"}` +
      (d.playerId ? ` #${d.playerId}` : "") +
      (d.playerName ? ` «${d.playerName}»` : "") +
      (d.byPlatform ? " (через площадку)" : "")
    : "SDK нет";
  el.textContent =
    `вход · площадка: ${platform}` +
    ` · наш аккаунт: ${ourAccount}` +
    ` · logout умеет: ${d.canLogout ? "да" : "НЕТ"}` +
    ` · автовход: ${d.suppressed ? "ЗАПРЕЩЁН (вышел сам)" : "разрешён"}` +
    ` · событие: ${lastEvent}`;
}

function badgeRequested(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get("login");
    if (q === "1") {
      localStorage.setItem("terron_login_badge", "1");
      return true;
    }
    if (q === "0") {
      localStorage.removeItem("terron_login_badge");
      return false;
    }
    return localStorage.getItem("terron_login_badge") === "1";
  } catch {
    return false;
  }
}

/** Показать плашку (зовётся из Main на старте). Вне дева — no-op. */
export function mountDevLoginBadge(): void {
  if (el || typeof document === "undefined" || !isDevSite()) return;
  if (!badgeRequested()) return;
  el = document.createElement("div");
  el.id = "dev-login-badge";
  el.style.cssText = [
    "position:fixed",
    "left:8px",
    "bottom:30px", // над звуковой плашкой, чтобы обе были видны разом
    "z-index:2147483647",
    "background:rgba(18,22,34,0.9)",
    "color:#cfe2ff",
    "font:11px/1.5 ui-monospace,SFMono-Regular,monospace",
    "padding:4px 9px",
    "border:1px solid #3d4a63",
    "border-radius:4px",
    "pointer-events:none",
    "white-space:nowrap",
  ].join(";");
  document.body.appendChild(el);
  render();
  void refreshOurAccount();

  // Наша сессия меняется — перечитываем профиль (событие шлёт Auth).
  window.addEventListener("terron-auth-changed", () => {
    lastEvent = "наша сессия сменилась";
    void refreshOurAccount();
  });
  // События площадки: их шлёт GamePushSDK, дублируя себе в window (см. ниже).
  window.addEventListener("gp-login-event", (e) => {
    lastEvent = String((e as CustomEvent).detail ?? "?");
    void refreshOurAccount();
  });
  // Флаги площадки меняются молча (её панель, СБРОС, вход в другой вкладке) —
  // раз в секунду перечитываем. Профиль при этом НЕ дёргаем, только SDK.
  window.setInterval(render, 1000);
}

import { isDevSite } from "../Utils";
import { isMuted, mutedByPlatform } from "./AudioBus";

// terron 01.08: ПЛАШКА СОСТОЯНИЯ ЗВУКА — ТОЛЬКО НА ДЕВЕ.
//
// Зачем: спор «дошёл ли сигнал площадки до игры» третий раз решался вслепую по
// симптомам. Владельцу нужен ФАКТ на экране, который можно заскринить: какой
// бандл крутится и что игра думает о звуке ПРЯМО СЕЙЧАС. Обновляется на каждое
// изменение (событие шины `platform-audio-changed`).
//
// На проде не появляется никогда (гейт по хосту dev.*).

let el: HTMLDivElement | null = null;

function bundleTag(): string {
  try {
    // Собственный URL модуля = URL бандла: assets/index-XXXX.js
    const m = /index-([A-Za-z0-9_-]+)\.js/.exec(import.meta.url);
    if (m) return m[1];
    const src = document.querySelector<HTMLScriptElement>(
      'script[src*="index-"]',
    )?.src;
    return /index-([A-Za-z0-9_-]+)\.js/.exec(src ?? "")?.[1] ?? "?";
  } catch {
    return "?";
  }
}

function render(): void {
  if (!el) return;
  const bus = (
    globalThis as {
      __terronAudioBus?: {
        transientAll: boolean;
        sinks: Set<unknown>;
      };
    }
  ).__terronAudioBus;
  const state = (m: boolean, byPlatform = false) =>
    m ? (byPlatform ? "ВЫКЛ(площадка)" : "ВЫКЛ") : "вкл";
  // Сырые флаги САМОГО SDK — чтобы отличать «панель не прислала сигнал» от
  // «прислала, а мы не применили». Первое лечится галкой «Настройки
  // разработчика активны» в их панели, второе — нашим кодом.
  const snd = (
    globalThis as {
      __gp?: {
        sounds?: {
          isMuted?: boolean;
          isMusicMuted?: boolean;
          isSFXMuted?: boolean;
        };
      };
    }
  ).__gp?.sounds;
  const sdk = snd
    ? `SDK[муз ${snd.isMusicMuted ? "1" : "0"} эфф ${snd.isSFXMuted ? "1" : "0"}` +
      ` всё ${snd.isMuted ? "1" : "0"}]`
    : "SDK[нет]";
  // Состояние ИГРОКА ПЛОЩАДКИ — чтобы «почему я снова в старом аккаунте»
  // читалось со скриншота: СБРОС в их панели чистит локальные данные, но НЕ
  // разлогинивает (игрок возвращается с их сервера). Разлогин — «ВЫЙТИ ИЗ
  // АККАУНТА» (репорт владельца 01.08).
  const gp = (
    globalThis as {
      __gp?: { player?: { id?: string | number; isLoggedIn?: boolean } };
    }
  ).__gp;
  const who = gp?.player
    ? `${gp.player.isLoggedIn ? "вошёл" : "гость"} #${gp.player.id ?? "?"}`
    : "нет";
  el.textContent =
    `сборка ${bundleTag()} · игрок ${who}` +
    ` · музыка ${state(isMuted("music"), mutedByPlatform("music"))}` +
    ` · эффекты ${state(isMuted("sfx"), mutedByPlatform("sfx"))}` +
    ` · мут площадки ${bus?.transientAll ? "ДА" : "нет"}` +
    ` · плееров ${bus?.sinks.size ?? 0} · ${sdk}`;
}

/** Плашку просили показать: `?audio=1` в адресе (запоминается на сессию) или
 *  `terron_audio_badge=1` в localStorage. terron 01.08: раньше она висела на
 *  ВСЁМ деве, а модерация GamePush смотрит именно дев — диагностика в углу
 *  экрана им не нужна. `?audio=0` гасит. */
function badgeRequested(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get("audio");
    if (q === "1") {
      localStorage.setItem("terron_audio_badge", "1");
      return true;
    }
    if (q === "0") {
      localStorage.removeItem("terron_audio_badge");
      return false;
    }
    return localStorage.getItem("terron_audio_badge") === "1";
  } catch {
    return false;
  }
}

/** Показать плашку (зовётся из Main на старте). Вне дева — no-op. */
export function mountDevAudioBadge(): void {
  if (el || typeof document === "undefined" || !isDevSite()) return;
  if (!badgeRequested()) return;
  el = document.createElement("div");
  el.id = "dev-audio-badge";
  el.style.cssText = [
    "position:fixed",
    "left:8px",
    "bottom:8px",
    "z-index:2147483647",
    "background:rgba(20,20,18,0.88)",
    "color:#e9e7df",
    "font:11px/1.5 ui-monospace,SFMono-Regular,monospace",
    "padding:4px 9px",
    "border:1px solid #4a4a44",
    "border-radius:4px",
    "pointer-events:none",
    "white-space:nowrap",
  ].join(";");
  document.body.appendChild(el);
  render();
  window.addEventListener("platform-audio-changed", render);
  // Панель площадки меняет свои флаги молча — перерисовываем раз в секунду,
  // чтобы плашка всегда показывала правду без перезагрузки.
  window.setInterval(render, 1000);
}

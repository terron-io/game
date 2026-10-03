import { html, TemplateResult } from "lit";
import { platformIcon, platformLabel } from "./components/ui/platformBadge";
import { platformAutoLoginFor } from "./PlatformAuth";
import { embedTestMode, platformContext } from "./PlatformContext";
import { brandDisplay, L } from "./Utils";

/**
 * terron 11.09: ПРЕВЬЮ экрана входа «как на площадке» для тест-режима
 * (`?embed=1&platform=<тип>`). SDK площадки там не поднят, поэтому настоящий
 * экран честно падает в почтовый вход — а владельцу нужно видеть ПЕРВОЕ
 * состояние платформенного экрана и понимать развилку (просьба 11.09: «отобразить
 * первое состояние интерфейса, а потом текстом описать развилку»). Кнопки
 * рисуются, но выключены; развилка — текстом в дебаг-плашке.
 * Вне тест-режима возвращает null — настоящий экран не задет.
 */
export function platformLoginPreview(
  benefits: TemplateResult,
): TemplateResult | null {
  if (!embedTestMode()) return null;
  const type = platformContext();
  if (!type) return null;
  const label = platformLabel(type);
  const auto = platformAutoLoginFor(type);
  const yandex = type === "YANDEX";

  const debug = html`<div
    style="margin-top:14px;padding:10px 12px;border:1px dashed #b23b3b;border-radius:6px;font:11.5px/1.5 'IBM Plex Mono',monospace;color:var(--t-ink);background:rgba(178,59,59,.06)"
  >
    <div style="font-weight:700;color:#b23b3b;margin-bottom:4px">
      ${L(
        "ТЕСТ-РЕЖИМ · SDK площадки не загружен, кнопки не работают",
        "TEST MODE · platform SDK not loaded, buttons are inert",
      )}
    </div>
    <div>${L(`Что будет на «${label}»:`, `On ${label}:`)}</div>
    <ul style="margin:4px 0 0 16px;padding:0;list-style:disc">
      ${auto
        ? html`<li>
              ${L(
                `игрок уже вошёл в «${label}» → аккаунт ${brandDisplay()} поднимется сам при загрузке, без нажатий; этот экран он увидит уже с аккаунтом`,
                `player already signed in to ${label} → the ${brandDisplay()} account comes up on load, no clicks; they see this screen already signed in`,
              )}
            </li>
            <li>
              ${L(
                `не вошёл → кнопка «Войти через ${label}» откроет окно входа площадки${yandex ? " (Яндекс ID, только по нажатию — п. 1.2.1)" : ""}; после подтверждения аккаунт создаётся сам`,
                `not signed in → the “Sign in with ${label}” button opens the platform sign-in${yandex ? " (Yandex ID, only on click — rule 1.2.1)" : ""}; the account is created after confirmation`,
              )}
            </li>`
        : html`<li>
            ${L(
              `тихого автовхода нет: аккаунт появляется только по кнопке «Войти через ${label}» → окно входа площадки`,
              `no silent sign-in: the account appears only via “Sign in with ${label}” → the platform sign-in window`,
            )}
          </li>`}
      <li>
        ${L(
          "«У меня есть код» — вход по коду GamePush с другого устройства или площадки",
          "“I have a code” — GamePush code sign-in from another device or platform",
        )}
      </li>
    </ul>
  </div>`;

  return html`
    <div style="max-width:760px;margin:0 auto">
      <div style="text-align:center;margin-bottom:6px">
        <div
          style="font-family:var(--t-display,sans-serif);font-weight:700;letter-spacing:.24em;font-size:30px;color:var(--t-ink);line-height:1"
        >
          ${brandDisplay()}
        </div>
        <div class="t-muted" style="margin-top:6px">
          ${L(
            "Войди, чтобы сохранять прогресс и забрать своё.",
            "Sign in to save your progress and claim what's yours.",
          )}
        </div>
      </div>
      <div
        style="display:flex;gap:18px;flex-wrap:wrap;align-items:stretch;margin-top:16px"
      >
        ${benefits}
        <div
          style="flex:1 1 290px;min-width:260px;background:var(--t-parchment,#fff);border:1px solid var(--t-ink,#2b2a24);box-shadow:var(--t-shadow);padding:18px"
        >
          <button
            class="t-btn"
            style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px"
            disabled
            title=${L("тест-режим: SDK площадки нет", "test mode: no platform SDK")}
          >
            ${platformIcon(type, 17)}
            <span>${L("Войти через", "Sign in with")} ${label}</span>
          </button>
          <button
            class="t-btn ghost"
            style="width:100%;margin-top:8px"
            disabled
            title=${L("тест-режим: SDK площадки нет", "test mode: no platform SDK")}
          >
            ${L("У меня есть код", "I have a code")}
          </button>
          <div
            class="t-muted"
            style="font-size:11.5px;line-height:1.5;margin-top:14px;text-align:center"
          >
            ${L(
              "Вход выполняется средствами площадки — пароль и почту мы не спрашиваем.",
              "Signing in is handled by the platform — we never ask for your email or password.",
            )}
          </div>
          ${debug}
        </div>
      </div>
    </div>
  `;
}

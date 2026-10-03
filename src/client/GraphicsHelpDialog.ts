// terron 25.09 — ОКНО «ВИДЕОКАРТА СБРОСИЛА ГРАФИКУ» С ШАГАМИ РЕШЕНИЯ.
//
// ПОВОД. Отзыв с Пикабу (Balexeika, Intel UHD, 25.09): «через минуты 3 сбой
// графики и экран белый». Телеметрия за неделю: 378 сессий потеряли WebGL,
// у 214 восстановление не удалось — и всё, что они видели, было окно
// «Графика сбоила дважды… Перезагрузить?». Игрок перезагружал, играл ещё
// пару минут и получал тот же сбой. Решение владельца: объяснить игроку, что
// помогает, и дать почитать инструкцию.
//
// КАК УСТРОЕНО.
//  • Советы — по порядку от простого; у каждого «Как?» открывает раздел гайда
//    /graphics-help МОДАЛКОЙ ПОВЕРХ МАТЧА (LegalModal, doc "graphics"): игрок не
//    уходит из игры, а внутри площадки не появляется ссылки наружу.
//  • Главная кнопка — «Лёгкая графика и перезагрузить»: та же настройка, что в
//    шестерёнке, чтобы следующий матч сразу шёл в облегчённом режиме. Если она
//    уже включена — главной становится обычная перезагрузка.
//  • Совет про драйвер называет производителя по имени видеокарты (Intel/AMD/
//    NVIDIA); у Apple драйвер обновляется вместе с системой.
//  • Внизу «код для поддержки» — пришлёт скриншот, и сразу видно железо.
//  • Выбор игрока уходит в телеметрию (`gl_help_choice`): помогают ли советы и
//    доходят ли до гайда.
//
// Стиль — как у Toast.confirmDialog: обычный DOM без Lit, окно живёт и поверх
// HUD, и на сайте. z-index ниже модалки гайда, чтобы гайд открывался сверху.

import { openLegalDoc } from "./LegalModal";
import { L } from "./Utils";

export type GraphicsHelpReason = "giveup" | "stuck" | "restore_failed";
export type GraphicsHelpChoice = "light" | "reload" | "later";
export type GpuVendor = "intel" | "amd" | "nvidia" | "apple" | null;

export interface GraphicsHelpInfo {
  gpu: string;
  losses: number;
  lightOn: boolean;
}

/** Производитель по строке UNMASKED_RENDERER (ANGLE (Intel, …) и т. п.). */
export function gpuVendorOf(gpu: string): GpuVendor {
  const g = gpu.toLowerCase();
  if (/intel/.test(g)) return "intel";
  if (/nvidia|geforce|quadro|rtx|gtx/.test(g)) return "nvidia";
  if (/amd|radeon|ati /.test(g)) return "amd";
  if (/apple/.test(g)) return "apple";
  return null;
}

/** Короткое имя видеокарты для кода поддержки: без обёртки ANGLE и Direct3D. */
export function shortGpuName(gpu: string): string {
  // «ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0,
  // D3D11)» → «Intel UHD»: берём второе поле ANGLE целиком (до запятой — внутри
  // есть скобки) и срезаем товарные знаки, id устройства и хвост API.
  const inner = /ANGLE \([^,]+,\s*([^,]+)/.exec(gpu)?.[1] ?? gpu;
  return inner
    .replace(/^.*Renderer:\s*/i, "") // «ANGLE Metal Renderer: Apple M1» → «Apple M1»
    .replace(/\((R|TM)\)/gi, "")
    .replace(/\(0x[0-9a-f]+\)/gi, "")
    .replace(/\s(Direct3D|OpenGL|Vulkan|Metal).*$/i, "")
    .replace(/\bGraphics\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/** Строка, которую игрок пришлёт в поддержку. */
export function supportCode(
  reason: GraphicsHelpReason,
  info: GraphicsHelpInfo,
): string {
  const tag =
    reason === "giveup" ? "GL-2" : reason === "stuck" ? "GL-S" : "GL-R";
  const gpu = info.gpu ? shortGpuName(info.gpu) : "?";
  const parts = [
    tag,
    gpu,
    L(`сбоев: ${info.losses}`, `failures: ${info.losses}`),
  ];
  if (info.lightOn) parts.push(L("лёгкая вкл", "light on"));
  return parts.join(" · ");
}

/** Советы по порядку; `sec` — раздел гайда (`data-sec` в graphics-help.html). */
export function helpSteps(
  vendor: GpuVendor,
  lightOn: boolean,
): { sec: string; text: string }[] {
  const steps: { sec: string; text: string }[] = [];
  if (!lightOn) {
    steps.push({
      sec: "light",
      text: L(
        "Включить лёгкую графику — кнопка ниже.",
        "Turn on light graphics — button below.",
      ),
    });
  }
  steps.push({
    sec: "restart",
    text: L(
      "Полностью закрыть браузер и открыть снова.",
      "Fully close the browser and open it again.",
    ),
  });
  steps.push({
    sec: "tabs",
    text: L(
      "Закрыть другие вкладки с играми и видео.",
      "Close other tabs with games and videos.",
    ),
  });
  steps.push({
    sec: "hardware",
    text: L(
      "Включить аппаратное ускорение в настройках браузера.",
      "Turn on hardware acceleration in the browser settings.",
    ),
  });
  const driver =
    vendor === "apple"
      ? L(
          "Обновить macOS — драйвер обновится вместе с ней.",
          "Update macOS — the driver comes with it.",
        )
      : vendor === "intel"
        ? L(
            "Обновить драйвер видеокарты Intel.",
            "Update the Intel graphics driver.",
          )
        : vendor === "amd"
          ? L(
              "Обновить драйвер видеокарты AMD.",
              "Update the AMD graphics driver.",
            )
          : vendor === "nvidia"
            ? L(
                "Обновить драйвер видеокарты NVIDIA.",
                "Update the NVIDIA graphics driver.",
              )
            : L("Обновить драйвер видеокарты.", "Update the graphics driver.");
  steps.push({ sec: "driver", text: driver });
  return steps;
}

function headline(reason: GraphicsHelpReason): string {
  return reason === "giveup"
    ? L("Видеокарта сбросила графику", "The graphics card reset the graphics")
    : L("Графика не восстановилась", "Graphics did not recover");
}

function lead(vendor: GpuVendor): string {
  const base = L(
    "Матч идёт дальше — после перезагрузки вы вернётесь в него.",
    "The match keeps going — after a reload you'll be back in it.",
  );
  return vendor === "intel"
    ? L(
        "Так бывает со встроенной графикой Intel. ",
        "This happens with integrated Intel graphics. ",
      ) + base
    : base;
}

type Reporter = (choice: string) => void;

/**
 * Показать окно. Возвращает выбор игрока; перезагрузку и включение лёгкой
 * графики делает вызывающий (у него свой путь перезагрузки внутри площадки).
 */
export function showGraphicsHelp(
  reason: GraphicsHelpReason,
  info: GraphicsHelpInfo,
  report: Reporter = () => {},
): Promise<GraphicsHelpChoice> {
  return new Promise((resolve) => {
    const vendor = gpuVendorOf(info.gpu);
    const overlay = document.createElement("div");
    overlay.className = "terron-gfx-help";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:100001;display:flex;align-items:center;" +
      "justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);padding:16px";
    const card = document.createElement("div");
    card.style.cssText =
      "background:#fdfcf7;color:#2b2a24;border-radius:14px;padding:18px 20px;" +
      "width:min(92vw,400px);max-height:92vh;overflow-y:auto;" +
      "box-shadow:0 20px 60px rgba(0,0,0,.5);" +
      "font:400 14px/1.45 'Golos Text',system-ui,sans-serif";

    const h = document.createElement("div");
    h.textContent = headline(reason);
    h.style.cssText =
      "font:700 16px/1.3 'Golos Text',system-ui,sans-serif;margin-bottom:6px";
    const p = document.createElement("div");
    p.textContent = lead(vendor);
    p.style.cssText = "color:#5f5b50;margin-bottom:12px";
    const sub = document.createElement("div");
    sub.textContent = L("Что помогает", "What helps");
    sub.style.cssText = "font-weight:700;margin-bottom:6px";

    const ol = document.createElement("ol");
    ol.style.cssText = "margin:0 0 14px;padding-left:18px";
    for (const step of helpSteps(vendor, info.lightOn)) {
      const li = document.createElement("li");
      li.style.cssText = "margin-bottom:5px";
      li.append(document.createTextNode(step.text + " "));
      const how = document.createElement("button");
      how.type = "button";
      how.className = "terron-gfx-how";
      how.dataset.sec = step.sec;
      how.textContent = L("Как?", "How?");
      how.style.cssText =
        "border:none;background:none;padding:0;color:#b3261e;font:inherit;" +
        "font-weight:700;text-decoration:underline;cursor:pointer";
      how.onclick = () => {
        report(`guide:${step.sec}`);
        openLegalDoc("graphics", step.sec);
      };
      li.appendChild(how);
      ol.appendChild(li);
    }

    const mkBtn = (
      label: string,
      primary: boolean,
      choice: GraphicsHelpChoice,
    ) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.dataset.choice = choice;
      b.style.cssText =
        "padding:9px 14px;border:none;border-radius:9px;cursor:pointer;font-weight:700;" +
        "font-family:inherit;font-size:14px;" +
        (primary
          ? "background:#2b2a24;color:#fdfcf7"
          : "background:#e7e1cf;color:#2b2a24");
      b.onclick = () => close(choice);
      return b;
    };
    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;flex-direction:column;gap:8px";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px";
    if (!info.lightOn) {
      buttons.appendChild(
        mkBtn(
          L("Лёгкая графика и перезагрузить", "Light graphics and reload"),
          true,
          "light",
        ),
      );
      const reload = mkBtn(
        L("Просто перезагрузить", "Just reload"),
        false,
        "reload",
      );
      reload.style.flex = "1";
      row.append(reload, mkBtn(L("Позже", "Later"), false, "later"));
    } else {
      const reload = mkBtn(L("Перезагрузить", "Reload"), true, "reload");
      reload.style.flex = "1";
      row.append(reload, mkBtn(L("Позже", "Later"), false, "later"));
    }
    buttons.appendChild(row);

    const code = document.createElement("div");
    code.className = "terron-gfx-code";
    code.textContent =
      L("Код для поддержки: ", "Support code: ") + supportCode(reason, info);
    code.style.cssText =
      "margin-top:10px;font-size:12px;color:#8a8577;user-select:all";

    const onKey = (ev: KeyboardEvent) => {
      // Esc у открытого поверх гайда закрывает гайд, а не это окно.
      if (
        ev.key === "Escape" &&
        !document.querySelector(".terron-legal-overlay")
      ) {
        close("later");
      }
    };
    const close = (choice: GraphicsHelpChoice) => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      report(choice);
      resolve(choice);
    };
    window.addEventListener("keydown", onKey, true);

    card.append(h, p, sub, ol, buttons, code);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}

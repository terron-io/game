// terron 30.08: /download — десктопные версии игры.
//
// ⚠️ ПЕРЕДЕЛАНО ИЗ СПИСКА В ЛЕНДИНГ (репорт владельца: «голый список, не понимаю
// интуитивно, что нажимать, куча кнопок, винда и маки разбиты»). Причина была
// в равноправии: четыре одинаковые карточки с четырьмя одинаковыми кнопками
// заставляли игрока ВЫБИРАТЬ, хотя выбор у него ровно один — его система.
// Теперь: ОДНА крупная кнопка под угаданную систему, остальные — мелкой строкой,
// а инструкция первого запуска убрана под раскрывашку, чтобы не пугать заранее.
//
// ⚠️ ССЫЛКИ ВЕДУТ НА НАШ ДОМЕН (`/dl/<цель>`), а не прямо на файлы: раздаёт их
// GitHub Releases (200 МБ с VPS каждому — незачем), но игрок этого знать не
// обязан, а мы при обновлении правим один редирект вместо страницы и переводов.
import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../core/AssetUrls";
import { appleIcon } from "./components/AndroidPromo";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { linuxIcon, windowsIcon } from "./components/ui/OsIcons";
import { Host } from "./PlatformHost";
import { L, translateText } from "./Utils";

type Target = {
  id: string;
  title: string;
  note: string;
  size: string;
  hint: string;
  icon: (size?: number) => TemplateResult;
};

/**
 * ⚠️ ГЕЙТ ПЛОЩАДОК. Внутри чужого кадра (VK/Яндекс/Пикабу) уводить игрока на
 * скачивание НЕЛЬЗЯ — за внешние ссылки площадки карают, это то же требование
 * модерации, из-за которого в футере прячутся telegram и ссылки на сторы.
 * Признак — тот же класс `gp-embed`, что у всего остального гейта (второй
 * источник правды разъехался бы с первым); itch исключён, как и в теме.
 */
export function downloadsHiddenHere(): boolean {
  return !Host.externalLinksAllowed();
}

/** Что качать. Порядок — по ожидаемой доле игроков, не по алфавиту. */
function targets(): Target[] {
  return [
    {
      id: "win",
      title: "Windows",
      note: L("64-бит", "64-bit"),
      size: L("195 МБ", "195 MB"),
      hint: L(
        "Распакуй архив и запусти TERRON.exe. Windows может предупредить о неизвестном издателе — нажми «Подробнее», затем «Выполнить в любом случае».",
        "Unzip and run TERRON.exe. Windows may warn about an unknown publisher — click «More info», then «Run anyway».",
      ),
      icon: windowsIcon,
    },
    {
      id: "mac-arm",
      title: L("macOS · Apple Silicon", "macOS · Apple Silicon"),
      note: L("M1 и новее", "M1 and newer"),
      size: L("179 МБ", "179 MB"),
      hint: L(
        "Перетащи приложение в «Программы». При первом запуске нажми на значок правой кнопкой и выбери «Открыть» — обычный двойной клик macOS отклонит.",
        "Drag the app to Applications. On first launch right-click the icon and choose «Open» — a plain double-click will be refused by macOS.",
      ),
      icon: appleIcon,
    },
    {
      id: "mac-intel",
      title: L("macOS · Intel", "macOS · Intel"),
      note: L("до 2020 года", "pre-2020"),
      size: L("183 МБ", "183 MB"),
      hint: L(
        "Перетащи в «Программы». При первом запуске — правая кнопка по значку, «Открыть».",
        "Drag to Applications. On first launch right-click the icon and choose «Open».",
      ),
      icon: appleIcon,
    },
    {
      id: "linux",
      title: "Linux",
      note: "AppImage · x86_64",
      size: L("192 МБ", "192 MB"),
      hint: L(
        "Сделай файл исполняемым (chmod +x TERRON-linux-x86_64.AppImage) и запусти. Для arm64 есть отдельная сборка — спроси в чате.",
        "Make it executable (chmod +x TERRON-linux-x86_64.AppImage) and run. An arm64 build exists too — ask in the chat.",
      ),
      icon: linuxIcon,
    },
  ];
}

/**
 * Какая система у гостя. Нужна ради ГЛАВНОГО решения страницы: одна большая
 * кнопка вместо четырёх равноправных. Ошибиться не страшно — остальные системы
 * лежат строкой ниже.
 */
function guessTarget(): string {
  try {
    const ua = navigator.userAgent;
    const plat = navigator.platform ?? "";
    if (/Win/i.test(ua)) return "win";
    if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "linux";
    if (/Mac/i.test(plat) || /Mac OS X/i.test(ua)) {
      // Apple Silicon от Intel по UA не отличить — браузер врёт одинаково.
      // Спрашиваем железо: у M-процессоров ядер обычно 8+, у старых Intel 2–4.
      return (navigator.hardwareConcurrency ?? 0) >= 8
        ? "mac-arm"
        : "mac-intel";
    }
    return "";
  } catch {
    return "";
  }
}

/** Телефон: скачивать нечего, там сторы. Ведём в них, а не в тупик. */
function isHandheld(): boolean {
  try {
    return (
      window.matchMedia("(pointer: coarse)").matches &&
      Math.min(window.innerWidth, window.innerHeight) < 820
    );
  } catch {
    return false;
  }
}

@customElement("download-page")
export class DownloadPage extends BaseModal {
  protected routerName = "download";

  @state() private mine = "";
  @state() private handheld = false;
  @state() private openHint = false;

  protected modalConfig() {
    return { title: L("Скачать", "Download"), maxWidth: "720px" };
  }

  protected onOpen(): void {
    this.mine = guessTarget();
    this.handheld = isHandheld();
    this.openHint = false;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: this.modalConfig().title,
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  /**
   * Визуал «игра в своём окне»: рамка приложения с картой внутри.
   *
   * ⚠️ НЕ игровой скриншот, и это решение. `GameplayScreenshot.png` — абстрактная
   * OG-картинка апстрима: цветные пятна, по которым не понять, что это стратегия,
   * и на пергаментном листе она смотрится чужеродно. Снять свой кадр вживую в этот
   * заход не вышло (на полигоне без реальной партии карта пустая). Поэтому строим
   * из того, что и так есть: миниатюра карты мира в оконной рамке — она сразу
   * говорит и «это карта мира», и «это отдельное приложение».
   */
  private appWindow(): TemplateResult {
    const dot = (c: string) =>
      html`<span
        style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block"
      ></span>`;
    return html`<div
      style="border:0.5px solid rgba(0,0,0,.3);background:#fdfcf7;box-shadow:5px 5px 0 rgba(0,0,0,.10)"
    >
      <div
        style="display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:0.5px solid rgba(0,0,0,.18)"
      >
        ${dot("#c9564d")} ${dot("#d8b24a")} ${dot("#6f9b5f")}
        <span
          style="margin-left:6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.5"
          >TERRON</span
        >
      </div>
      <img
        src=${assetUrl("maps/world/thumbnail.webp")}
        alt=""
        loading="lazy"
        style="width:100%;max-height:210px;object-fit:cover;object-position:center;display:block;background:#dfe7ee"
      />
    </div>`;
  }

  /** Крупная кнопка под систему гостя — единственное решение на странице. */
  private hero(t: Target): TemplateResult {
    return html`<div
      style="display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center"
    >
      <a
        href="/dl/${t.id}"
        style="display:inline-flex;align-items:center;gap:10px;background:var(--t-ink,#2b2a24);color:#f5efdd;padding:15px 30px;font-weight:700;font-size:16px;letter-spacing:.05em;text-transform:uppercase;text-decoration:none;box-shadow:4px 4px 0 rgba(0,0,0,.18)"
      >
        ${t.icon(20)} ${L("Скачать для", "Download for")} ${t.title}
      </a>
      <div style="font-size:12px;opacity:.6">
        ${t.note} · ${t.size} ·
        ${L("бесплатно, как и в браузере", "free, same as in the browser")}
      </div>
    </div>`;
  }

  /** Остальные системы — строкой, а не четырьмя одинаковыми карточками. */
  private others(list: Target[], all = false): TemplateResult {
    if (!list.length) return html``;
    return html`<div
      style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px 14px;font-size:13px"
    >
      <span style="opacity:.55"
        >${all
          ? L("Версии для компьютера:", "Desktop builds:")
          : L("Другие системы:", "Other systems:")}</span
      >
      ${list.map(
        (t) =>
          html`<a
            href="/dl/${t.id}"
            style="display:inline-flex;align-items:center;gap:5px;color:var(--t-ink,#2b2a24);text-decoration:none;border-bottom:1px solid rgba(0,0,0,.3);padding-bottom:1px"
            >${t.icon(13)} ${t.title}
            <span style="opacity:.45">${t.size}</span></a
          >`,
      )}
    </div>`;
  }

  /** Зачем это вообще — три вещи, которых нет в браузерной версии. */
  private why(): TemplateResult {
    const items: Array<[string, string]> = [
      [
        L("Своё окно", "Its own window"),
        L(
          "Без вкладок и адресной строки — карта во весь экран.",
          "No tabs, no address bar — the map fills the screen.",
        ),
      ],
      [
        L("Работает без сети", "Works offline"),
        L(
          "Пропал интернет — остаётся одиночная игра против ботов.",
          "Lost your connection — single-player against bots stays.",
        ),
      ],
      [
        L("Все карты внутри", "Every map inside"),
        L(
          "93 карты уже в приложении, качать в матче нечего.",
          "All 93 maps ship with the app — nothing to download mid-match.",
        ),
      ],
    ];
    return html`<div
      style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px"
    >
      ${items.map(
        ([t, d]) =>
          html`<div
            style="border-left:2px solid rgba(0,0,0,.25);padding:2px 0 2px 11px"
          >
            <div style="font-weight:700;font-size:13.5px">${t}</div>
            <div style="font-size:12.5px;opacity:.7;line-height:1.45">${d}</div>
          </div>`,
      )}
    </div>`;
  }

  protected renderBody(): TemplateResult {
    // Внутри площадки страницы нет — вместо ссылок объясняем, где взять.
    // Молча пустой экран хуже: игрок решит, что у нас сломано.
    if (downloadsHiddenHere()) {
      return html`<div style="padding:0 4px 18px">
        <p style="font-size:13.5px;line-height:1.5;opacity:.85">
          ${L(
            "Десктопные версии доступны на сайте terron.io — в этом окне ссылки на скачивание не показываются.",
            "Desktop builds live on terron.io — download links are not shown inside this window.",
          )}
        </p>
      </div>`;
    }

    const list = targets();
    const mine = list.find((t) => t.id === this.mine) ?? list[0];
    const rest = list.filter((t) => t.id !== mine.id);

    return html`<div
      style="padding:0 4px 20px;display:flex;flex-direction:column;gap:20px"
    >
      <div style="text-align:center;display:flex;flex-direction:column;gap:6px">
        <div
          style="font-size:20px;font-weight:700;letter-spacing:.04em;text-transform:uppercase"
        >
          ${L("TERRON на компьютере", "TERRON on your computer")}
        </div>
        <div style="font-size:13.5px;opacity:.75;line-height:1.5">
          ${L(
            "Та же игра и тот же аккаунт — просто отдельным окном.",
            "The same game and the same account — just in its own window.",
          )}
        </div>
      </div>

      ${this.appWindow()}
      ${this.handheld
        ? html`<div
            style="text-align:center;font-size:13.5px;line-height:1.5;opacity:.85"
          >
            ${L(
              "Ты с телефона — версии ниже для компьютера. На телефоне игра живёт в браузере и в приложении из магазина.",
              "You are on a phone — the builds below are for computers. On mobile the game lives in the browser and in the app stores.",
            )}
          </div>`
        : this.hero(mine)}
      ${this.others(this.handheld ? list : rest, this.handheld)}

      <div
        style="border-top:1px solid rgba(0,0,0,.12);padding-top:16px;display:flex;flex-direction:column;gap:14px"
      >
        ${this.why()}
      </div>

      <div style="border-top:1px solid rgba(0,0,0,.12);padding-top:12px">
        <button
          @click=${() => (this.openHint = !this.openHint)}
          style="background:none;border:0;padding:0;cursor:pointer;font:inherit;font-size:13px;color:var(--t-ink,#2b2a24);opacity:.75;display:inline-flex;align-items:center;gap:6px"
        >
          <span style="font-size:11px">${this.openHint ? "▴" : "▾"}</span>
          ${L(
            "Система ругается при первом запуске?",
            "Your system complains on first launch?",
          )}
        </button>
        ${this.openHint
          ? html`<div
              style="margin-top:10px;display:flex;flex-direction:column;gap:9px"
            >
              <p style="margin:0;font-size:12.5px;opacity:.7;line-height:1.5">
                ${L(
                  "Так и есть: сборки пока не подписаны сертификатом, и система осторожничает. Это разовое действие — дальше приложение открывается обычным кликом.",
                  "Yes: the builds are not signed yet, so the system is cautious. It is a one-time step — after that the app opens with a normal click.",
                )}
              </p>
              ${targets().map(
                (t) =>
                  html`<div style="font-size:12.5px;line-height:1.5">
                    <b style="display:inline-flex;align-items:center;gap:5px"
                      >${t.icon(13)} ${t.title}</b
                    >
                    <span style="opacity:.75"> — ${t.hint}</span>
                  </div>`,
              )}
            </div>`
          : ""}
      </div>
    </div>`;
  }
}

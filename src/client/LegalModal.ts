// terron: политика конфиденциальности и пользовательское соглашение — В МОДАЛКЕ.
//
// ЗАЧЕМ. Ссылки футера вели на отдельные страницы через `target="_blank"`, то
// есть УВОДИЛИ ИГРОКА ИЗ ИГРЫ. Внутри площадки (VK/Яндекс) это прямое
// нарушение — замечание модерации VK 25.08.2026 («сторонние ссылки: политика,
// пользовательское»). Решение владельца: показывать текст модалкой, везде.
//
// ПОЧЕМУ НЕ КОПИЯ ТЕКСТА В КОДЕ. Источник правды один — те же
// `resources/{privacy-policy,terms-of-service}.html`, которые отдаёт сервер по
// /privacy и /terms (их требуют магазины приложений и юристы, они обязаны
// остаться отдельными страницами). Модалка ЗАБИРАЕТ их фетчем и показывает
// внутри игры: правишь документ — меняется в обоих местах.
//
// ВЕС. В бандл не попадает ни байта текста: качается по клику и только раз за
// сессию (~6 КБ сжатых). Отдельная страница, наоборот, перезагружала всё
// приложение и тянула шрифты со стороннего CDN.
//
// Стиль намеренно как у `Toast.confirmDialog` — обычный DOM без Lit: модалка
// нужна и на сайте, и поверх игрового HUD.

import { gameOrigin } from "./GameHost";
import { Host } from "./PlatformHost";
import { L, getCurrentLang } from "./Utils";

// terron 25.09: + "graphics" — гайд «сбоит графика» (/graphics-help). Окно сбоя
// графики открывает его этой же модалкой поверх матча: игрок читает инструкцию,
// не уходя из игры, а внутри площадки не появляется ссылки наружу.
export type LegalDoc = "privacy" | "terms" | "graphics";

// terron 07.09: АДРЕС ДОКУМЕНТА — АБСОЛЮТНЫЙ В ПЛАТФОРМЕННОЙ СБОРКЕ.
//
// Было `/privacy` и `/terms` — пути ОТ КОРНЯ. Пока страница лежит на нашем
// домене, это верно; но билд для дистрибуции лежит на хостинге GamePush
// (`s3.eponesh.com/games/draft/28774/v1/`), и запрос уходил на `s3.eponesh.com/terms`
// → 404 → модалка с «Не удалось загрузить документ». Именно это увидела
// модерация Яндекса 07.09 («ссылки снизу справа не работают»). Тот же класс, что
// уже чинили у `/exists`, `create_game` и кода воркера: относительный путь на
// чужом хостинге. `gameOrigin()` в обычной сборке пуст — поведение прежнее.
const DOC_PATH: Record<LegalDoc, string> = {
  privacy: "/privacy",
  terms: "/terms",
  graphics: "/graphics-help",
};

function docUrl(doc: LegalDoc): string {
  return `${gameOrigin()}${DOC_PATH[doc]}`;
}

/** Готовый (очищенный) HTML документа — качаем один раз за сессию. */
const cache = new Map<string, string>();

function docTitle(doc: LegalDoc): string {
  if (doc === "graphics")
    return L("Сбоит графика — что делать", "Graphics failing — what to do");
  return doc === "privacy"
    ? L("Политика конфиденциальности", "Privacy Policy")
    : L("Пользовательское соглашение", "Terms of Service");
}

/** Игра внутри iframe площадки — там уводить наружу нельзя вообще. */
function onPlatform(): boolean {
  return Host.inPlatformFrame();
}

/**
 * Достаём из страницы ровно блок нужного языка.
 *
 * ⚠️ Обе страницы двуязычные: внутри лежат `[data-lang="ru"]` и
 * `[data-lang="en"]`, а переключает их СВОЙ скрипт страницы. В модалке скриптов
 * нет — язык выбираем сами, лишний блок выкидываем, иначе документ показался бы
 * дважды подряд на двух языках.
 */
export function extractDoc(
  rawHtml: string,
  opts: { ru?: boolean; embedded?: boolean } = {},
): string {
  const parsed = new DOMParser().parseFromString(rawHtml, "text/html");
  const wantRu = opts.ru ?? getCurrentLang() === "ru";
  const embedded = opts.embedded ?? onPlatform();
  const block =
    parsed.querySelector(`[data-lang="${wantRu ? "ru" : "en"}"]`) ??
    parsed.querySelector("[data-lang]") ??
    parsed.body;

  const host = document.createElement("div");
  host.innerHTML = block.innerHTML;

  // Скрипты/стили/фреймы страницы модалке не нужны и не должны исполняться.
  host
    .querySelectorAll("script, style, link, iframe, object, embed")
    .forEach((el) => el.remove());

  // Внутри площадки ссылка наружу — то самое, из-за чего всё и затевалось:
  // оставляем текст, снимаем переход. Почта остаётся (это контакт оператора
  // данных, без него политика недействительна).
  if (embedded) {
    host.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("mailto:")) return;
      const span = document.createElement("span");
      // «terron.io/account/delete» текстом модерация тоже читает как ссылку —
      // внутри площадки называем страницу словами (она открывается из настроек
      // аккаунта, адрес там не нужен).
      span.textContent = /\/account\/delete$/.test(href)
        ? L(
            "удаления аккаунта (Настройки → Аккаунт)",
            "account deletion (Settings → Account)",
          )
        : (a.textContent ?? "");
      a.replaceWith(span);
    });
  } else {
    host.querySelectorAll("a[href^='http']").forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
  }
  return host.innerHTML;
}

async function loadDoc(doc: LegalDoc): Promise<string> {
  const key = `${doc}:${getCurrentLang() === "ru" ? "ru" : "en"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(docUrl(doc), { credentials: "omit" });
  if (!res.ok) throw new Error(`legal doc ${doc}: HTTP ${res.status}`);
  const html = extractDoc(await res.text());
  cache.set(key, html);
  return html;
}

/**
 * Открыть документ модалкой поверх игры/сайта. `section` — раздел гайда
 * (`data-sec` в разметке страницы): модалка сразу прокручивает к нему.
 */
export function openLegalDoc(doc: LegalDoc, section?: string): void {
  const overlay = document.createElement("div");
  overlay.className = "terron-legal-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:100002;display:flex;align-items:center;" +
    "justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);" +
    "padding:16px";

  const card = document.createElement("div");
  card.style.cssText =
    "background:#fdfcf7;color:#2b2a24;border-radius:14px;width:min(96vw,760px);" +
    "max-height:min(88vh,900px);display:flex;flex-direction:column;overflow:hidden;" +
    "box-shadow:0 20px 60px rgba(0,0,0,.5);" +
    "font:400 14px/1.55 'Golos Text',system-ui,sans-serif";

  const head = document.createElement("div");
  head.style.cssText =
    "display:flex;align-items:center;gap:12px;padding:14px 18px;flex:0 0 auto;" +
    "border-bottom:1px solid rgba(43,42,36,.14)";
  const title = document.createElement("div");
  title.textContent = docTitle(doc);
  title.style.cssText =
    "font:700 15px/1.2 'Oswald','Golos Text',system-ui,sans-serif;" +
    "text-transform:uppercase;letter-spacing:.06em;flex:1 1 auto;min-width:0";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", L("Закрыть", "Close"));
  closeBtn.style.cssText =
    "flex:0 0 auto;width:32px;height:32px;border:none;border-radius:8px;" +
    "background:#e7e1cf;color:#2b2a24;font-size:15px;font-weight:700;cursor:pointer";

  const body = document.createElement("div");
  body.className = "terron-legal-body";
  body.style.cssText =
    "padding:16px 20px 22px;overflow-y:auto;overscroll-behavior:contain;" +
    "-webkit-overflow-scrolling:touch";
  body.textContent = L("Загружаем…", "Loading…");

  const close = () => {
    window.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation(); // Esc в матче не должен заодно открыть настройки
      close();
    }
  };
  closeBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  window.addEventListener("keydown", onKey, true);

  head.append(title, closeBtn);
  card.append(head, body);
  overlay.appendChild(card);
  ensureStyles();
  document.body.appendChild(overlay);

  void loadDoc(doc)
    .then((html) => {
      body.innerHTML = html;
      body.scrollTop = 0;
      const target = section
        ? body.querySelector<HTMLElement>(`[data-sec="${CSS.escape(section)}"]`)
        : null;
      if (target) {
        body.scrollTop =
          target.getBoundingClientRect().top -
          body.getBoundingClientRect().top -
          8;
      }
    })
    .catch((e) => {
      console.warn("[legal] документ не загрузился:", e);
      body.textContent = L(
        "Не удалось загрузить документ. Он доступен на terron.io" +
          DOC_PATH[doc],
        "Failed to load the document. It is available at terron.io" +
          DOC_PATH[doc],
      );
      // Вне площадки честнее просто показать страницу; внутри — нельзя уводить.
      if (!onPlatform()) window.open(docUrl(doc), "_blank", "noopener");
    });
}

/** Типографика документа. Ставим один раз: у страниц свои стили не поедут. */
let stylesInstalled = false;
function ensureStyles(): void {
  if (stylesInstalled) return;
  stylesInstalled = true;
  const st = document.createElement("style");
  st.textContent = `
.terron-legal-body h1{font:700 20px/1.25 'Oswald','Golos Text',system-ui,sans-serif;margin:0 0 10px;text-transform:uppercase;letter-spacing:.04em}
.terron-legal-body h2{font:700 15px/1.3 'Oswald','Golos Text',system-ui,sans-serif;margin:20px 0 8px;text-transform:uppercase;letter-spacing:.04em}
.terron-legal-body h3{font:700 14px/1.3 'Golos Text',system-ui,sans-serif;margin:16px 0 6px}
.terron-legal-body p{margin:0 0 10px}
.terron-legal-body ul{margin:0 0 12px;padding-left:20px}
.terron-legal-body li{margin:0 0 6px}
.terron-legal-body a{color:#b3261e;font-weight:600}
.terron-legal-body .updated-date{opacity:.6;font-size:12px}
.terron-legal-body .lang-switch{display:none}
.terron-legal-body .langbar{display:none}
.terron-legal-body .sheet{background:#fffdf5;border:1px solid #d8cfa8;border-radius:6px;padding:10px 14px;margin:8px 0 12px}
.terron-legal-body ol{margin:0 0 12px;padding-left:20px}
.terron-legal-body code{background:#f1ead2;border:1px solid #d8cfa8;border-radius:3px;padding:0 5px;font:13px/1.4 ui-monospace,Consolas,monospace;user-select:all;word-break:break-word}
.terron-legal-body .note{opacity:.75;font-size:13px}
`;
  document.head.appendChild(st);
}

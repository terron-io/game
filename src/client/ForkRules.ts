import { L } from "./Utils";

/**
 * terron: ПАМЯТКА ФОРКНУВШЕМУ — всплывает перед уходом на GitHub (наш или
 * апстрима) со страницы авторства.
 *
 * Зачем: игра под AGPLv3, и форкать её МОЖНО — но у копилефта есть условия,
 * про которые люди узнают уже после письма от юристов. Апстрим по форкам
 * судится (дело frontwars.io, 2026: иск отклонён, но защита стоила четырёхзначной
 * суммы). Дешевле предупредить на входе, чем разбирать последствия.
 *
 * ⚠️ Пункт про товарный знак тут не для полноты — это САМАЯ ЧАСТАЯ причина
 * исков: лицензия отдаёт код, но НЕ имя и не логотип, и на этом ловят даже тех,
 * кто по коду чист.
 *
 * ТРИ ВАРИАНТА — памятка зависит от того, ЧЕЙ репозиторий открывают
 * (см. ForkVariant ниже): наш / апстрима / MIT-коммиты. Галочки и выдержка
 * по времени — только у AGPL-вариантов: MIT почти ничего не требует.
 */

/** Дата смены лицензии апстрима MIT → AGPL (коммит «Update license: AGPL & CC SA»). */
const MIT_CUTOFF = "05.09.2025";

// "ours"     — наш репозиторий: в списке обязанностей есть НАШ копирайт
//              (© TERRON.io, NOTICE.md) и НЕТ пункта про MIT — у TERRON
//              MIT-входа не существует, он форкнут уже из AGPL-эпохи.
// "upstream" — репозиторий апстрима: их нотисы БЕЗ нашего (наш вклад в их
//              коде не лежит), и MIT-подсказка ЕСТЬ — она про ИХ историю.
// "mit"      — ссылки на MIT-коммиты: отдельный текст без галочек.
export type ForkVariant = "ours" | "upstream" | "mit";

/** Держим кнопку заблокированной, пока текст не успели прочитать. */
const READ_SECONDS = 10;

const OUR_REPO = "https://github.com/terron-io/game";

interface Rule {
  n: string;
  text: string;
  warn?: boolean;
}

function agplRules(variant: "ours" | "upstream"): Rule[] {
  const ours = variant === "ours";
  const rules: Rule[] = [
    {
      n: "1",
      text: L(
        "Форк остаётся под AGPLv3. Закрыть его или сменить лицензию на более мягкую нельзя — это копилефт.",
        "Your fork stays under AGPLv3. You cannot close it or relicense under softer terms — this is copyleft.",
      ),
    },
    {
      n: "2",
      // ⚠️ Список нотисов зависит от того, ЧТО форкают: в нашем коде обязателен
      // и © TERRON.io (условия §7(b) — NOTICE.md рядом с кодом); в коде апстрима
      // нашего вклада нет, навязывать наш нотис их форкам было бы неправдой.
      text: ours
        ? L(
            "Сохрани копирайты: © OpenFront LLC and contributors, © 2024 WarFront.io Team и © TERRON.io (наши условия §7 — в NOTICE.md рядом с кодом). Снял атрибуцию — лицензия прекращается сама (§8), и ты уже нарушитель.",
            "Keep the copyright notices: © OpenFront LLC and contributors, © 2024 WarFront.io Team, and © TERRON.io (our Section 7 terms live in NOTICE.md next to the code). Strip attribution and your license terminates automatically (§8) — you become an infringer.",
          )
        : L(
            "Сохрани копирайты: © OpenFront and Contributors, © 2024 WarFront.io Team. Снял атрибуцию — лицензия прекращается сама (§8), и ты уже нарушитель.",
            "Keep the copyright notices: © OpenFront and Contributors, © 2024 WarFront.io Team. Strip attribution and your license terminates automatically (§8) — you become an infringer.",
          ),
    },
    {
      n: "3",
      text: L(
        "Держишь игру онлайн — обязан предложить исходник своим игрокам (§13).",
        "If you run it as a network service, you must offer the source to your players (§13).",
      ),
    },
    {
      n: "4",
      text: L(
        "Отметь, что менял: изменённые файлы должны нести пометку об изменении и дату (§5a).",
        "State your changes: modified files must carry a notice that you changed them, with the date (§5a).",
      ),
    },
    {
      n: "5",
      text: L(
        "Не выдавай форк за оригинал (§7c). Своё имя, свой бренд — иначе это уже введение в заблуждение.",
        "Do not misrepresent your fork as the original (§7c). Use your own name and branding.",
      ),
    },
  ];
  if (!ours) {
    // MIT-подсказка ТОЛЬКО у апстрима: это ИХ история была MIT до отсечки.
    // У TERRON MIT-входа нет — форк сделан уже из AGPL-эпохи, и обещать тут
    // «путь проще» значило бы врать.
    rules.push({
      n: "6",
      text: L(
        `Есть путь проще: до ${MIT_CUTOFF} этот апстрим был под MIT — там почти нет условий. Делаешь свою игру — бери ту версию, ссылки на MIT-коммиты есть на этой же странице.`,
        `There is an easier path: before ${MIT_CUTOFF} this upstream was MIT-licensed, with almost no conditions. Starting your own game — take that version; the MIT-era commit links are on this page.`,
      ),
    });
  }
  rules.push({
    n: "!",
    warn: true,
    text: ours
      ? L(
          "Имя и логотип лицензия НЕ даёт: «TERRON» — товарный знак, он вне копирайта. Именно на этом чаще всего и подают в суд, даже когда с кодом всё чисто.",
          "The license does NOT grant the name or logo: “TERRON” is a trademark, outside copyright. This is the most common basis for lawsuits — even against forks that are clean on the code.",
        )
      : L(
          "Имя и логотип лицензия НЕ даёт: «OpenFront» — их товарный знак, он вне копирайта. Именно на этом чаще всего и подают в суд, даже когда с кодом всё чисто.",
          "The license does NOT grant the name or logo: “OpenFront” is their trademark, outside copyright. This is the most common basis for lawsuits — even against forks that are clean on the code.",
        ),
  });
  return rules;
}

let stylesReady = false;
function ensureStyles(): void {
  if (stylesReady) return;
  stylesReady = true;
  const st = document.createElement("style");
  st.textContent = `
    .terron-fork-body::-webkit-scrollbar { width: 10px }
    .terron-fork-body::-webkit-scrollbar-thumb {
      background: rgba(43,42,36,.22); border-radius: 6px }
  `;
  document.head.appendChild(st);
}

/**
 * Показать памятку. Резолвится `true`, если игрок решил идти на GitHub.
 *
 * ⚠️ У AGPL-варианта кнопка открывается ТОЛЬКО когда выполнены оба условия:
 * отмечены все пункты И истёк отсчёт. Галочки без таймера прокликиваются не
 * читая, таймер без галочек — пережидается. Вместе они заставляют пройти по
 * тексту глазами, а это и есть смысл памятки.
 */
export function showForkRules(
  targetUrl: string,
  variant: ForkVariant = "ours",
): Promise<boolean> {
  ensureStyles();
  const isMit = variant === "mit";
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:100002;display:flex;align-items:center;" +
      "justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);" +
      "padding:16px";

    const card = document.createElement("div");
    card.style.cssText =
      "background:#fdfcf7;color:#2b2a24;border-radius:14px;width:min(96vw,620px);" +
      "max-height:min(88vh,900px);display:flex;flex-direction:column;overflow:hidden;" +
      "box-shadow:0 20px 60px rgba(0,0,0,.5);" +
      "font:400 14px/1.55 'Golos Text',system-ui,sans-serif";

    const head = document.createElement("div");
    head.style.cssText =
      "padding:16px 20px 12px;flex:0 0 auto;border-bottom:1px solid rgba(43,42,36,.14)";
    const title = document.createElement("div");
    title.textContent = isMit
      ? L("Это версия под MIT", "This is the MIT-licensed version")
      : L("Хочешь форкнуть? Прочти", "Forking? Read this first");
    title.style.cssText =
      "font:700 16px/1.2 'Oswald','Golos Text',system-ui,sans-serif;" +
      "text-transform:uppercase;letter-spacing:.06em";
    const sub = document.createElement("div");
    sub.textContent = isMit
      ? L(
          `До ${MIT_CUTOFF} апстрим был под MIT. Это самая свободная точка входа: делай что хочешь, даже закрытую коммерческую игру.`,
          `Before ${MIT_CUTOFF} upstream was under MIT. This is the freest entry point: do what you like, even a closed commercial game.`,
        )
      : L(
          "Игра открыта под AGPLv3 — форкать можно и это законно. Но у лицензии есть условия.",
          "The game is open under AGPLv3 — forking is allowed and legal. But the license has conditions.",
        );
    sub.style.cssText = "margin-top:6px;font-size:13px;opacity:.75";
    head.append(title, sub);

    const body = document.createElement("div");
    body.className = "terron-fork-body";
    body.style.cssText =
      "padding:14px 20px 8px;overflow-y:auto;overscroll-behavior:contain;" +
      "-webkit-overflow-scrolling:touch";

    const boxes: HTMLInputElement[] = [];

    if (isMit) {
      // MIT: обязательств почти нет — галочки и выдержка тут были бы
      // бессмысленной формальностью, человеку нечего «принимать».
      for (const line of [
        L(
          "Единственное требование MIT — сохранить текст лицензии и копирайт-нотис.",
          "MIT's only requirement is to keep the license text and the copyright notice.",
        ),
        L(
          "Открывать свой код не обязано. Продавать — можно. Менять лицензию производного — можно.",
          "You are not required to open your source. You may sell it. You may relicense your derivative.",
        ),
        L(
          "⚠️ Взял код ПОСЛЕ этой даты — это уже AGPL, и условия там совсем другие.",
          "⚠️ Take code from AFTER that date and it is AGPL — with entirely different conditions.",
        ),
        L(
          "Имя и логотип лицензия не даёт никогда — ни MIT, ни AGPL. Придумай своё.",
          "No license ever grants the name or logo — neither MIT nor AGPL. Pick your own.",
        ),
      ]) {
        const row = document.createElement("div");
        row.style.cssText = "margin-bottom:10px";
        row.textContent = line;
        body.appendChild(row);
      }
    } else {
      for (const r of agplRules(variant)) {
        const label = document.createElement("label");
        label.style.cssText =
          "display:flex;gap:10px;margin-bottom:12px;align-items:flex-start;cursor:pointer";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.style.cssText = "flex:0 0 auto;margin-top:3px;width:16px;height:16px;cursor:pointer";
        boxes.push(box);
        const badge = document.createElement("span");
        badge.textContent = r.n;
        badge.style.cssText =
          "flex:0 0 auto;width:22px;height:22px;border-radius:6px;display:flex;" +
          "align-items:center;justify-content:center;font-weight:800;font-size:12px;" +
          (r.warn
            ? "background:#a8432b;color:#fff"
            : "background:#e7e1cf;color:#2b2a24");
        const txt = document.createElement("span");
        txt.textContent = r.text;
        if (r.warn) txt.style.cssText = "font-weight:600";
        label.append(box, badge, txt);
        body.appendChild(label);
      }
    }

    const foot = document.createElement("div");
    foot.style.cssText =
      "padding:12px 20px 16px;flex:0 0 auto;display:flex;gap:10px;" +
      "border-top:1px solid rgba(43,42,36,.14)";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = L("Отмена", "Cancel");
    cancel.style.cssText =
      "flex:0 0 auto;padding:10px 16px;border:1px solid rgba(43,42,36,.3);" +
      "border-radius:8px;background:transparent;color:#2b2a24;font-weight:700;cursor:pointer";

    const go = document.createElement("button");
    go.type = "button";
    const goLabel = isMit
      ? L("Открыть MIT-версию", "Open the MIT version")
      : L("Понятно, открыть GitHub", "Got it, open GitHub");

    let left = isMit ? 0 : READ_SECONDS;
    const allChecked = () => boxes.every((b) => b.checked);
    const ready = () => left <= 0 && allChecked();
    const paint = () => {
      const ok = ready();
      go.disabled = !ok;
      go.style.opacity = ok ? "1" : ".45";
      go.style.cursor = ok ? "pointer" : "not-allowed";
      if (ok) {
        go.textContent = goLabel;
      } else if (left > 0) {
        // отсчёт виден всегда; про галочки пишем, только когда таймер истёк —
        // иначе кнопка ругается на то, что человек ещё физически не успел
        go.textContent = `${goLabel} · ${left}`;
      } else {
        go.textContent = L("Отметь все пункты", "Check every item");
      }
    };
    go.style.cssText =
      "flex:1 1 auto;padding:10px 16px;border:none;border-radius:8px;" +
      "background:#2b2a24;color:#fdfcf7;font-weight:700";
    for (const b of boxes) b.addEventListener("change", paint);
    paint();

    let tick: ReturnType<typeof setInterval> | undefined;
    if (left > 0) {
      tick = setInterval(() => {
        left -= 1;
        paint();
        if (left <= 0 && tick) clearInterval(tick);
      }, 1000);
    }

    foot.append(cancel, go);
    card.append(head, body, foot);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const done = (ok: boolean) => {
      if (tick) clearInterval(tick);
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(ok);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(false);
    };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(false);
    });
    cancel.addEventListener("click", () => done(false));
    go.addEventListener("click", () => {
      if (!ready()) return;
      done(true);
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    });
  });
}

export { OUR_REPO };

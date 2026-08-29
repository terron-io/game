import { html, TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  OUR_REPO,
  showForkRules,
  type ForkVariant,
} from "./ForkRules";
import { L, translateText } from "./Utils";

// terron: /copyrights — авторство и лицензии. Сохраняет требуемую атрибуцию
// (© OpenFront LLC and contributors), показывает родословную жанра и ссылки на
// апстримы, включая MIT-точки входа.
const OF_REPO = "https://github.com/openfrontio/OpenFrontIO";
const MIT_COMMIT_1 = "https://github.com/openfrontio/OpenFrontIO/commit/9866dbb";
const MIT_COMMIT_2 = "https://github.com/openfrontio/OpenFrontIO/commit/9d5c108";
const TERRITORIAL = "https://territorial.io";

@customElement("copyrights-page")
export class CopyrightsPage extends BaseModal {
  protected routerName = "copyrights";

  protected modalConfig() {
    return { title: L("Авторство и лицензии", "Credits & Licenses") };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: L("Авторство и лицензии", "Credits & Licenses"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  private section(t: string): TemplateResult {
    return html`<div
      style="display:flex;align-items:center;gap:8px;margin:20px 0 8px;font-family:var(--t-display,sans-serif);font-weight:800;font-size:16px;color:var(--t-ink)"
    >
      <span
        style="display:inline-block;width:4px;height:18px;border-radius:2px;background:var(--t-red,#a8432b)"
      ></span>
      ${t}
    </div>`;
  }

  // terron: nofollow — со страницы авторства мы никуда не передаём вес и не
  // подсказываем краулерам путь к репозиторию исходников. Полностью скрыть его
  // от индексации нельзя (у публичных репозиториев GitHub такой настройки нет),
  // но со своей стороны ссылку не скармливаем. SEO-смысла тут и так нет.
  private a(href: string, text: string): TemplateResult {
    // terron: ссылки на GitHub (наш репозиторий и апстрим) сначала показывают
    // памятку об условиях форка — см. ForkRules.ts. Обычный клик перехватываем,
    // но href оставляем настоящим: правый клик, «открыть в новой вкладке» и
    // краулеры должны видеть реальный адрес.
    // Памятка форкнувшему — только на ВХОДАХ В РЕПОЗИТОРИИ. Документные
    // ссылки (/blob/ — CREDITS.md и подобное) открываются напрямую: человек
    // идёт ЧИТАТЬ атрибуцию, а не форкать, и экран согласия там неуместен.
    // WarFront — тоже напрямую: он целиком MIT, предупреждать не о чем.
    const isRepo =
      /github\.com/i.test(href) &&
      !/\/blob\//i.test(href) &&
      !/WarFrontIO/i.test(href);
    // MIT-точки входа апстрима (ссылки на конкретные коммиты до смены лицензии)
    // получают ДРУГУЮ памятку: там обязательств почти нет, и человеку честнее
    // сказать «делаешь своё — начинай отсюда», чем пугать копилефтом.
    // Выбор памятки по адресату: MIT-коммиты → без галочек; наш репозиторий →
    // список с НАШИМ нотисом (© TERRON.io) и без MIT-подсказки (у TERRON
    // MIT-входа нет); всё остальное на github — репозиторий апстрима.
    const variant: ForkVariant = /\/commit\//i.test(href)
      ? "mit"
      : /terron-io\//i.test(href)
        ? "ours"
        : "upstream";
    return html`<a
      href=${href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      class="t-link"
      @click=${isRepo
        ? (e: MouseEvent) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            void showForkRules(href, variant);
          }
        : undefined}
      >${text}</a
    >`;
  }

  protected renderBody(): TemplateResult {
    return html`<div
      class="t-page"
      style="max-width:680px;font-size:14px;line-height:1.65;color:var(--t-ink)"
    >
      <div
        style="padding:12px 14px;border-radius:12px;background:var(--t-sheet);font-weight:700"
      >
        ${L(
          "TERRON.io — форк открытой игры OpenFront.io. Ниже — кому принадлежит код, на чём он основан и под какими лицензиями.",
          "TERRON.io is a fork of the open-source game OpenFront.io. Below: whose code this is, what it's based on, and under which licenses.",
        )}
      </div>

      ${this.section(L("Родословная", "Lineage"))}
      <!-- terron: в родословной все названия — ТЕКСТ, а не ссылки (решение
           владельца). Это справка о происхождении жанра, а не набор переходов;
           рабочие ссылки живут ниже, в разделе «Ссылки». -->
      <div style="line-height:1.9">
        <b>Territorial.io</b>
        ${L("(жанр-первоисточник)", "(genre origin)")} →
        <b>WarFront.io</b> ${L("(ранний открытый клон, MIT)", "(early open clone, MIT)")} →
        <b>OpenFront.io</b>
        ${L("(© OpenFront LLC, сейчас AGPLv3)", "(© OpenFront LLC, now AGPLv3)")} →
        <b>TERRON.io</b> ${L("(этот форк)", "(this fork)")}
      </div>

      ${this.section(L("Атрибуция (по лицензии)", "Attribution (per license)"))}
      <ul style="margin:0;padding-left:18px;line-height:1.8">
        <li>${L("Код игры: © OpenFront LLC and contributors, WarFront.io Team.", "Game code: © OpenFront LLC and contributors, WarFront.io Team.")}</li>
        <li>${L("Лицензия кода: GNU AGPLv3.", "Code license: GNU AGPLv3.")}</li>
        <li>${L("Ассеты (resources/): Creative Commons BY-SA 4.0 — «OpenFront» / «OpenFront Inc.».", "Assets (resources/): Creative Commons BY-SA 4.0 — “OpenFront” / “OpenFront Inc.”.")}</li>
        <li>
          ${L("Изменения, дополнения и собственные ассеты TERRON: ", "TERRON's changes, additions and original assets: ")}
          <b>© TERRON.io</b>
          ${L("(перечень — ниже).", "(listed below).")}
        </li>
      </ul>

      <!-- terron: НАШЕ требование по §7(b). Апстрим таким же блоком в LICENSE
           требует сохранять «© OpenFront and Contributors»; мы вправе поступить
           так же со СВОИМ вкладом — §7 прямо разрешает добавлять условия «for
           material you add to a covered work». ⚠️ Область строго ограничена:
           на код апстрима наши условия НЕ распространяются. Полный текст —
           NOTICE.md в репозитории исходников. Чтобы требование действовало,
           оно должно быть ВИДНО — потому и стоит здесь, а не только в файле. -->
      <div
        style="margin-top:12px;padding:12px 14px;border-radius:10px;background:var(--t-sheet);border-left:3px solid var(--t-red,#a8432b)"
      >
        <b>${L("Форкаешь TERRON?", "Forking TERRON?")}</b>
        ${L(
          "Сохрани «© TERRON.io» рядом с уведомлениями апстрима — это дополнительное условие по §7(b) AGPL на наш собственный вклад. И помни: имя и логотип лицензия не даёт — ни AGPL, ни MIT.",
          "Keep “© TERRON.io” alongside the upstream notices — an AGPL Section 7(b) additional term covering TERRON's own contributions. And remember: no license grants a name or logo — neither AGPL nor MIT.",
        )}
      </div>

      ${this.section(L("Что добавил TERRON", "What TERRON added"))}
      <!-- terron: AGPL §5(a) требует ОБОЗНАЧАТЬ свои изменения, а не только
           сохранять чужой копирайт. Плюс это и наше собственное авторство:
           перечисленное ниже написано с нуля и апстриму не принадлежит. -->
      <div class="t-muted" style="margin-bottom:8px">
        ${L(
          "Форк существенно переработан. Ниже — подсистемы, написанные с нуля: они не входят в апстрим и принадлежат TERRON.io.",
          "This fork is substantially reworked. Below are subsystems written from scratch: they are not part of upstream and belong to TERRON.io.",
        )}
      </div>
      <ul style="margin:0;padding-left:18px;line-height:1.8">
        <li>
          <b>${L("Ультимейты", "Ultimates")}</b> —
          ${L(
            "система выбора и построек-штабов, десятки ульт со своими механиками, дерево прокачки и разблокировки.",
            "the pick system, headquarters buildings, dozens of ultimates with their own mechanics, and the unlock tree.",
          )}
        </li>
        <li>
          <b>${L("Авиация", "Aviation")}</b> —
          ${L(
            "аэропорты, воздушный десант, беспилотники и связанная с ними экономика.",
            "airports, airborne assault, drones and the economy around them.",
          )}
        </li>
        <li>
          <b>${L("Оформление и интерфейс", "Design and interface")}</b> —
          ${L(
            "визуальный стиль, все страницы сайта, внутриигровой HUD и мобильное управление.",
            "the visual identity, every site page, the in-game HUD and mobile controls.",
          )}
        </li>
        <li>
          <b>${L("Скины", "Skins")}</b> —
          ${L(
            "редактор, реестр и отрисовка, включая скины ядерного пепла.",
            "the editor, registry and rendering, including nuclear fallout skins.",
          )}
        </li>
        <li>
          <b>${L("Обучение", "Tutorial")}</b> —
          ${L(
            "песочница с подсказками и собственный генератор карт.",
            "a guided sandbox and our own map generator.",
          )}
        </li>
        <li>
          <b>${L("Прогресс и социальное", "Progression and social")}</b> —
          ${L(
            "рейтинг, достижения, звания, кланы, друзья, событийные матчи и спидран.",
            "ratings, achievements, titles, clans, friends, event matches and speedrun.",
          )}
        </li>
        <li>
          <b>${L("Игровые режимы", "Game modes")}</b> —
          ${L(
            "туман войны, столицы и другие правила, которых в апстриме нет.",
            "fog of war, capitals and other rules absent from upstream.",
          )}
        </li>
        <li>
          <b>${L("Русская локализация", "Russian localization")}</b> —
          ${L(
            "перевод интерфейса, имена наций и названия стран.",
            "interface translation, nation names and country names.",
          )}
        </li>
      </ul>

      ${this.section(L("Картографические данные", "Map data"))}
      <ul style="margin:0;padding-left:18px;line-height:1.8">
        <li>
          ${this.a("https://www.openstreetmap.org/copyright", "OpenStreetMap")}
          © contributors — ODbL
        </li>
        <li>
          ${this.a("https://www.naturalearthdata.com/", "Natural Earth")} —
          ${L("общественное достояние", "public domain")}
        </li>
        <li>
          Copernicus DEM — © DLR / Airbus Defence and Space / ESA
        </li>
        <li>
          ${L("Bedmap3 (Антарктида)", "Bedmap3 (Antarctica)")} — CC BY 4.0
        </li>
        <li>
          ${L("Полный список:", "Full list:")}
          ${this.a(
            "https://github.com/openfrontio/OpenFrontIO/blob/main/CREDITS.md",
            "CREDITS.md",
          )}
        </li>
      </ul>

      ${this.section(L("Ссылки", "Links"))}
      <ul style="margin:0;padding-left:18px;line-height:1.8">
        <li>
          <b>${L("Исходный код TERRON:", "TERRON source code:")}</b>
          ${this.a(OUR_REPO, "github.com/terron-io/game")}
          <span class="t-muted"
            >— ${L(
              "полный исходник этой версии (AGPLv3 §13)",
              "complete source of this version (AGPLv3 §13)",
            )}</span
          >
        </li>
        <li>${L("Апстрим:", "Upstream:")} ${this.a(OF_REPO, "github.com/openfrontio/OpenFrontIO")}</li>
        <li>
          ${L("MIT-точки входа:", "MIT entry points:")}
          ${this.a(MIT_COMMIT_1, "9866dbb")}, ${this.a(MIT_COMMIT_2, "9d5c108")}
        </li>
        <li>
          ${L("Предок жанра (целиком MIT):", "Genre ancestor (MIT in full):")}
          ${this.a("https://github.com/WarFrontIO", "github.com/WarFrontIO")}
        </li>
        <li>${L("Первоисточник жанра:", "Genre origin:")} ${this.a(TERRITORIAL, "territorial.io")}</li>
      </ul>

      <div class="t-muted" style="font-size:12px;margin-top:18px;line-height:1.5">
        ${L(
          "Код игры распространяется под AGPLv3. Атрибуция и уведомления об авторстве сохранены согласно требованиям лицензий.",
          "The game code is distributed under AGPLv3. Attribution and copyright notices are preserved as required by the licenses.",
        )}
      </div>
    </div>`;
  }

  protected onClose(): void {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }
}

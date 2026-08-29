import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// terron: СТОРОЖ ПАМЯТКИ ФОРКНУВШЕМУ.
//
// Игра публикуется под AGPLv3, форкать её законно — но апстрим по форкам
// судится, и ловят чаще не на коде, а на снятой атрибуции и товарном знаке.
// Памятка на выходе к GitHub закрывает ровно это. Проверяем сканером исходника:
// живой DOM тут поднимать незачем, а вот «кто-то убрал перехват клика» —
// реальный риск при следующей правке страницы авторства.

const SRC = path.join(__dirname, "../../src/client");
const forkRules = fs.readFileSync(path.join(SRC, "ForkRules.ts"), "utf8");
const copyrights = fs.readFileSync(path.join(SRC, "CopyrightsPage.ts"), "utf8");

describe("памятка о правилах форка", () => {
  it("ссылки на GitHub со страницы авторства проходят через памятку", () => {
    // ⚠️ Проверяем ВЫЗОВ, а не импорт: первая версия теста искала просто
    // "showForkRules" и молчала, когда обработчик клика убрали, — имя всё ещё
    // стояло в строке import. Поймано обратным прогоном.
    expect(copyrights).toContain("showForkRules(href,");
    // перехват именно по признаку github-адреса, а не по одной зашитой ссылке:
    // иначе следующая добавленная ссылка на репозиторий памятку обойдёт
    expect(copyrights).toMatch(/github\\\.com/i);
  });

  it("обычный клик перехватывается, а модификаторы отдаются браузеру", () => {
    // cmd/ctrl+клик должен открывать вкладку штатно — иначе ломаем привычное
    // поведение ссылки ради попапа
    expect(copyrights).toContain("metaKey");
    expect(copyrights).toContain("ctrlKey");
    expect(copyrights).toContain("preventDefault");
  });

  it("href остаётся настоящим (правый клик и краулеры)", () => {
    expect(copyrights).toMatch(/href=\$\{href\}/);
  });

  it("памятка называет все обязательства AGPL", () => {
    // §8 — снятая атрибуция прекращает лицензию; §13 — исходник игрокам;
    // §5a — пометка об изменениях; §7c — не выдавать за оригинал
    for (const marker of ["§8", "§13", "§5a", "§7c", "AGPLv3"]) {
      expect(forkRules).toContain(marker);
    }
  });

  it("отдельно предупреждает про товарный знак", () => {
    // САМАЯ частая причина исков: лицензия отдаёт код, но не имя и не логотип
    expect(forkRules).toMatch(/товарный знак/i);
    expect(forkRules).toMatch(/trademark/i);
    // и этот пункт визуально выделен (warn), а не растворён в списке
    expect(forkRules).toContain("warn: true");
  });

  it("на GitHub уводит только по явному подтверждению", () => {
    // никаких автопереходов: window.open живёт в обработчике кнопки
    expect(forkRules).toContain("window.open");
    expect(forkRules).toMatch(/go\.addEventListener\("click"/);
  });

  it("пройти дальше можно только с галочками И по истечении таймера", () => {
    // порознь оба гейта обходятся: галочки прокликиваются не читая, таймер
    // пережидается. Смысл — только в связке.
    expect(forkRules).toContain("READ_SECONDS");
    expect(forkRules).toMatch(/left <= 0 && allChecked\(\)/);
    // и кнопка обязана СПРАШИВАТЬ этот гейт перед переходом, а не только
    // выглядеть выключенной
    expect(forkRules).toMatch(/if \(!ready\(\)\) return;/);
  });

  it("памятка различает адресата: mit / наш репозиторий / апстрим", () => {
    // Репорт владельца 29.08: «по контексту их и наш форк — разные галочки».
    expect(forkRules).toContain('variant === "mit"');
    expect(forkRules).toContain("MIT_CUTOFF");
    // маппинг в CopyrightsPage: коммиты → mit, terron-io → ours, прочее → upstream
    expect(copyrights).toMatch(/commit[\s\S]*"mit"[\s\S]*terron-io[\s\S]*"ours"[\s\S]*"upstream"/);
  });

  it("в НАШЕМ списке есть © TERRON.io и NOTICE.md, у апстрима MIT-подсказка", () => {
    // наш вклад защищён §7(b) — форкнувший НАС обязан видеть наш нотис;
    // а «путь проще через MIT» — только у апстрима: у TERRON MIT-входа нет
    // ⚠️ ОБЕ локали порознь И с якорем по куску ПОЛЬЗОВАТЕЛЬСКОЙ строки
    // («Team и/and © TERRON.io»): два прошлых варианта зеленели на поломке —
    // сперва ловили английский дубль, потом МОЙ ЖЕ КОММЕНТАРИЙ в коде.
    // Оба промаха пойманы обратным прогоном.
    expect(forkRules).toMatch(/Team и © TERRON\.io/);
    expect(forkRules).toMatch(/Team, and © TERRON\.io/);
    expect(forkRules).toContain("NOTICE.md");
    expect(forkRules).toMatch(/if \(!ours\)/);
  });

  it("подсказки «не обязательно GitHub» больше нет", () => {
    // репорт владельца: лишняя подсказка — учит форкеров прятаться от нас же
    expect(forkRules).not.toMatch(/выложить на GitHub/);
    expect(forkRules).not.toMatch(/publish on GitHub/);
  });

  it("AGPL-памятка называет MIT как более простой путь", () => {
    expect(forkRules).toMatch(/путь проще/i);
    expect(forkRules).toMatch(/easier path/i);
  });

  it("наше требование §7(b) видно в игре, а не только в файле", () => {
    // §7(b) работает, только если уведомление ВИДНО тому, кто форкает.
    // Апстрим тем же приёмом требует «© OpenFront and Contributors».
    expect(copyrights).toContain("© TERRON.io");
    expect(copyrights).toMatch(/Форкаешь TERRON/);
    // и обязательно оговорка про товарный знак — самая частая причина исков
    expect(copyrights).toMatch(/имя и логотип лицензия не даёт/i);
  });

  it("документные ссылки и WarFront — без экрана согласия", () => {
    // Памятка стоит на входах в репозитории; CREDITS.md (/blob/-путь) человек
    // открывает чтобы ПРОЧИТАТЬ атрибуцию, WarFront целиком MIT — предупреждать
    // не о чем. Репорт владельца 29.08: «это можно без экрана согласия».
    expect(copyrights).toMatch(/!\/\\\/blob\\\//);
    expect(copyrights).toContain("WarFrontIO");
  });

  it("родословная — текст, а не ссылки", () => {
    // решение владельца: блок происхождения жанра не должен быть набором
    // переходов на чужие сайты; рабочие ссылки живут в разделе «Ссылки».
    const from = copyrights.indexOf("Родословная");
    const to = copyrights.indexOf("Атрибуция");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(copyrights.slice(from, to)).not.toContain("this.a(");
  });

  it("перечислены собственные подсистемы TERRON (AGPL §5a)", () => {
    // §5(a) требует ОБОЗНАЧАТЬ изменения, а не только хранить чужой копирайт;
    // заодно это заявление нашего авторства на написанное с нуля.
    expect(copyrights).toContain("Что добавил TERRON");
    for (const subsystem of [
      "Ультимейты",
      "Авиация",
      "Оформление и интерфейс",
      "Скины",
      "Обучение",
    ]) {
      expect(copyrights).toContain(subsystem);
    }
  });

  it("ссылка на наш исходник указана (AGPLv3 §13)", () => {
    expect(copyrights).toContain("OUR_REPO");
    expect(forkRules).toContain("github.com/terron-io/game");
  });
});

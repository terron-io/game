// terron 25.08.2026: политика/соглашение показываются МОДАЛКОЙ внутри игры.
//
// Замечание модерации VK: «сторонние ссылки (политика, пользовательское)» —
// ссылки футера уводили игрока из мини-приложения новой вкладкой. Здесь
// сторожим разбор документа, где живут три живых грабли:
//   1) страницы ДВУЯЗЫЧНЫЕ (блоки [data-lang]) и переключаются СВОИМ скриптом —
//      в модалке скриптов нет, лишний блок дал бы текст дважды подряд;
//   2) скрипт страницы не должен исполниться в контексте игры;
//   3) внутри площадки ссылка наружу — ровно то, из-за чего всё затевалось.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { extractDoc } from "../../src/client/LegalModal";

const PAGE = `<!doctype html><html><head><style>body{color:red}</style></head>
<body>
  <div class="lang-switch"><a onclick="setLang('ru')">Рус</a></div>
  <div data-lang="ru">
    <style>h1{color:red}</style>
    <script>window.__legalRan = true;</script>
    <h1>Политика конфиденциальности</h1>
    <p>Пишите на <a href="mailto:legal@terron.io">legal@terron.io</a>
       или откройте <a href="https://terron.io">terron.io</a>.</p>
  </div>
  <div data-lang="en">
    <h1>Privacy Policy</h1>
    <p>English body</p>
  </div>
  <script>window.__legalRan = true;</script>
</body></html>`;

describe("разбор документа для модалки", () => {
  it("берёт блок текущего языка и НЕ тащит второй", () => {
    const ru = extractDoc(PAGE, { ru: true });
    expect(ru).toContain("Политика конфиденциальности");
    expect(ru).not.toContain("English body");

    const en = extractDoc(PAGE, { ru: false });
    expect(en).toContain("English body");
    expect(en).not.toContain("Политика конфиденциальности");
  });

  it("выбрасывает скрипты и стили страницы", () => {
    const out = extractDoc(PAGE, { ru: true });
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<style");
    expect((window as unknown as Record<string, unknown>).__legalRan).toBe(
      undefined,
    );
  });

  it("внутри площадки внешние ссылки становятся текстом, почта остаётся", () => {
    const out = extractDoc(PAGE, { ru: true, embedded: true });
    expect(out).not.toContain('href="https://terron.io"');
    expect(out).toContain("terron.io"); // текст на месте
    expect(out).toContain("mailto:legal@terron.io");
  });

  it("вне площадки ссылки живые и открываются новой вкладкой", () => {
    const out = extractDoc(PAGE, { ru: true, embedded: false });
    expect(out).toContain('href="https://terron.io"');
    expect(out).toContain('target="_blank"');
  });
});

describe("ссылки на документы не уводят из игры", () => {
  // ⚠️ Поймано НА ПРОДЕ 25.08: внутри площадки SoftNavigate ловит клики по
  // ссылкам в CAPTURE-фазе — то есть РАНЬШЕ обработчика самой ссылки — и
  // уводил адрес на /privacy ещё до открытия модалки. Спасает `data-hard-nav`
  // («перехватчик, руки прочь»), сам переход отменяет наш preventDefault.
  const FILES = [
    "src/client/components/Footer.ts",
    "src/client/AccountSettings.ts",
  ];

  for (const rel of FILES) {
    it(`${rel}: у каждой ссылки на /privacy и /terms есть data-hard-nav`, () => {
      const src = fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");
      const anchors = src.match(
        /<a[\s\S]{0,400}?href="\/(privacy|terms)"[\s\S]{0,200}?>/g,
      );
      expect(anchors, "ссылки на документы должны быть в файле").toBeTruthy();
      const naked = (anchors ?? []).filter((a) => !a.includes("data-hard-nav"));
      expect(naked).toEqual([]);
    });
  }
});

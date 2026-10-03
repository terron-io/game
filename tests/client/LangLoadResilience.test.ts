// terron 02.09: СЛОВАРЬ ПЕРЕВОДОВ НЕ УМИРАЕТ ОТ ОДНОГО УПАВШЕГО FETCH.
//
// Скриншот владельца из приложения ВК на телефоне: вся главная сырыми ключами
// (FLAG_INPUT.SHORT, LOBBY.ENTER, MAIN.CREATE, footer.terms…). Причина в двух
// строках: `loadLanguage` на неудачу отдавал `{}`, а `changeLanguage` этим `{}`
// ПОДМЕНЯЛ живой словарь. Один сбой мобильной сети — и интерфейс мёртв до
// перезагрузки. Теперь: fetch с повторами, а пустой результат прежний словарь
// не трогает.
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "src/client/LangSelector.ts"),
  "utf-8",
);

describe("дефолтный английский вшит", () => {
  it("en импортируется статически и не ходит в сеть", () => {
    expect(src).toContain('import enBundled from "../../resources/lang/en.json"');
    expect(src).toMatch(/if \(lang === "en" && this\.defaultTranslations\) \{/);
  });
  it("дефолт применяется и оверлей отпускается ДО fetch языка игрока", () => {
    const init = src.slice(src.indexOf("private async initializeLanguage("), src.indexOf("static notifyLangLoaded"));
    const first = init.indexOf("LangSelector.notifyLangLoaded()");
    const fetchUser = init.indexOf("this.loadLanguage(userLang)");
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(fetchUser);
  });
});

describe("флаги дефолтных языков вшиты", () => {
  it("ru и en — data-URI из бандла, остальные по манифесту", () => {
    expect(src).toContain('import flagRuRaw from "../../resources/flags/ru.svg?raw"');
    expect(src).toContain('import flagEnRaw from "../../resources/flags/uk_us_flag.svg?raw"');
    expect(src).toMatch(/INLINE_FLAGS\[currentLang\.svg\] \?\?\s*assetUrl\(`flags\//);
  });
});

describe("порядок загрузки", () => {
  it("словарь не ждёт язык площадки: platformLanguage() без await до загрузки", () => {
    const init = src.slice(
      src.indexOf("private async initializeLanguage("),
      src.indexOf("static notifyLangLoaded"),
    );
    // Раньше: `await platformLanguage()` ДО loadLanguage → до 3 с сырых ключей на
    // площадке (потолок SDK 1.5 с + синк игрока 1.5 с).
    // именно КОД, не комментарий: присваивание/тернарник с await
    expect(init).not.toMatch(/[:=]\s*await platformLanguage\(\)/);
    expect(init.indexOf("platformLangPromise")).toBeLessThan(init.indexOf("this.loadLanguage(userLang)"));
    expect(init).toContain("void platformLangPromise.then(");
  });
  it("язык площадки запоминается отдельно от явного выбора игрока", () => {
    expect(src).toContain('PLATFORM_LANG_KEY = "terron_platform_lang"');
    expect(src).toMatch(/lastPlatformLang\(\) \?\? browserLocale/);
  });
});

describe("загрузка языка", () => {
  it("fetch словаря повторяется, а не сдаётся с первого раза", () => {
    const body = src.slice(
      src.indexOf("private async loadLanguage("),
      src.indexOf("private async loadLanguageList("),
    );
    expect(body).toMatch(/const delays = \[0, \d+, \d+\]/);
    expect(body).toMatch(/for \(const wait of delays\)/);
  });

  it("пустой словарь не подменяет живой", () => {
    const body = src.slice(
      src.indexOf("private async changeLanguage("),
      src.indexOf("private applyTranslation("),
    );
    expect(body).toMatch(
      /Object\.keys\(loaded\)\.length === 0 && this\.translations[\s\S]*?return;/,
    );
    // прежняя форма — прямое присваивание результата — запрещена
    expect(body).not.toContain("this.translations = await this.loadLanguage(");
  });
});

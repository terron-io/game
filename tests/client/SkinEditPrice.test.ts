// terron 28.09: клиентское зеркало цены правки = серверному (platform-api
// tests/skinEditPrice.test.ts держит ту же таблицу).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { skinEditPrice } from "../../src/client/SkinsPage";

// [fromCatalog, newRaster, hd, wasHd, цена]
const CASES: [boolean, boolean, boolean, boolean, number][] = [
  // скин из каталога
  [true, true, false, false, 200], // своя картинка = свой скин
  [true, true, true, false, 400], // своя картинка в HD = свой HD
  [true, false, false, false, 50], // только ползунки/опции
  [true, false, true, false, 50], // HD у вектора ни к чему
  // свой скин
  [false, false, false, false, 50],
  [false, true, false, false, 50],
  [false, false, true, true, 100], // уже HD
  [false, true, true, true, 100],
  [false, false, true, false, 200], // 512 → HD: доплата до цены HD
  [false, true, true, false, 200],
  [false, false, false, true, 50], // HD → 512
];

describe("skinEditPrice (клиент)", () => {
  for (const [fromCatalog, newRaster, hd, wasHd, price] of CASES) {
    it(`catalog=${fromCatalog} raster=${newRaster} hd=${hd} wasHd=${wasHd} → ${price}`, () => {
      expect(skinEditPrice({ fromCatalog, newRaster, hd, wasHd })).toBe(price);
    });
  }
  it("редактор: каталожную картинку не шлёт заново, кнопка — по правилу", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/client/SkinsPage.ts"),
      "utf8",
    );
    expect(src).toMatch(/replaced = !this\.editFromCatalog;/);
    expect(src).toMatch(/Сохранить", "Save"\)\} \(\$\{this\.editPrice\(\)\}/);
    expect(src.match(/@customElement\("skins-page"\)/g)?.length).toBe(1);
  });
});

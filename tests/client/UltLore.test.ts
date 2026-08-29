import { describe, expect, it } from "vitest";
import {
  isSecretUltimate,
  ULTIMATE_REGISTRY,
  UnitType,
} from "../../src/core/game/Game";
import { ULT_LORE } from "../../src/client/UltLore";

// terron 26.08: сторож вкладки «История» в карточке ульты (/ults).
// Забыл написать историю новой ульте — вкладки у неё просто не будет, и никто
// этого не заметит; тест делает пропуск ВИДИМЫМ на гейте.
describe("UltLore — историческая справка у каждой ульты", () => {
  const open = ULTIMATE_REGISTRY.filter((u) => !isSecretUltimate(u.type));

  it("у каждой НЕсекретной ульты есть запись на обоих языках", () => {
    const missing = open.filter((u) => ULT_LORE[u.key] === undefined);
    expect(missing.map((u) => u.key)).toEqual([]);
    for (const u of open) {
      const e = ULT_LORE[u.key];
      for (const lang of [e.ru, e.en]) {
        expect(lang.about.length).toBeGreaterThan(3);
        // Рассказ, а не отписка: две-четыре фразы.
        expect(lang.text.length).toBeGreaterThan(120);
      }
      // Подпись-прототип — строка, а не абзац: она рисуется одной строкой
      // капсом над текстом и на телефоне обязана влезать.
      expect(e.ru.about.length).toBeLessThan(60);
      expect(e.en.about.length).toBeLessThan(60);
    }
  });

  it("у СЕКРЕТНЫХ ульт истории нет — она выдала бы скрытое имя", () => {
    const leaked = ULTIMATE_REGISTRY.filter(
      (u) => isSecretUltimate(u.type) && ULT_LORE[u.key] !== undefined,
    );
    expect(leaked.map((u) => u.key)).toEqual([]);
  });

  it("в словаре нет записей под несуществующие ульты", () => {
    const known = new Set(ULTIMATE_REGISTRY.map((u) => u.key));
    const orphans = Object.keys(ULT_LORE).filter((k) => !known.has(k));
    expect(orphans).toEqual([]);
  });

  it("русская и английская версии — разный текст (не копипаста)", () => {
    for (const u of open) {
      const e = ULT_LORE[u.key];
      expect(e.ru.text).not.toBe(e.en.text);
    }
  });

  it("ключи словаря — ключи реестра, а не значения UnitType", () => {
    // Ссылка на вики строится тем же ключом (`/wiki/ult/<key>`); перепутав
    // ключ со значением UnitType, получим и битую вкладку, и битую ссылку.
    const values = new Set<string>(Object.values(UnitType) as string[]);
    for (const k of Object.keys(ULT_LORE)) expect(values.has(k)).toBe(false);
  });
});

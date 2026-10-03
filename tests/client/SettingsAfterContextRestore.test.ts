import { readFileSync } from "fs";
import { describe, expect, test } from "vitest";

// terron 14.09: настройки рендера после потери графики.
// (1) Пока рендера нет, getSettings() отдаёт пустой объект, и пересчёт настроек
//     (смена тёмного режима/графики/стиля) падал на записи в settings.structure —
//     js_error «Cannot set properties of undefined (setting 'borderDarken')».
// (2) Пересобранный рендер создаёт настройки с нуля — без повторного пересчёта
//     на contextrestored у игрока до конца матча слетали тёмный режим, размер и
//     отсечка ников, классические иконки и твики стиля.
const runner = readFileSync("src/client/ClientGameRunner.ts", "utf8");
const glView = readFileSync("src/client/render/gl/GameView.ts", "utf8");

describe("настройки рендера после потери контекста", () => {
  test("пересчёт не пишет в пустые настройки, пока рендера нет", () => {
    const start = runner.indexOf("const regenerateRenderSettings = (): void => {");
    expect(start).toBeGreaterThan(0);
    const body = runner.slice(start, runner.indexOf("};", start));
    const guard = body.indexOf("if (!view.rendererReady) return;");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(body.indexOf("view.getSettings()"));
  });

  test("после пересборки рендера настройки игрока применяются заново", () => {
    expect(runner).toContain(
      'view.on("contextrestored", regenerateRenderSettings);',
    );
  });

  test("признак живого рендера смотрит на сам рендер", () => {
    expect(glView).toMatch(
      /get rendererReady\(\): boolean \{\s*return this\.renderer !== null;/,
    );
  });
});

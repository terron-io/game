/**
 * terron: превью узоров пепла — ЗЕРКАЛО шейдера falloutSkinMask.
 * Человек выбирает узор в магазине по картинке; если превью и шейдер разъедутся,
 * в матче он увидит другой узор — и заметит это только после покупки.
 */
import fs from "fs";
import path from "path";
import {
  FALLOUT_SKIN_COUNT,
  falloutSkinMask,
  falloutSkinTitle,
} from "../../src/client/FalloutSkinPreview";

const SHADER = path.join(
  __dirname,
  "../../src/client/render/gl/shaders/map-overlay/territory.frag.glsl",
);

describe("Fallout skin preview mirrors the shader", () => {
  const src = fs.readFileSync(SHADER, "utf8");

  test("shader still declares exactly FALLOUT_SKIN_COUNT patterns", () => {
    const body = src.slice(src.indexOf("float falloutSkinMask"));
    const end = body.indexOf("\n}");
    const branches = body.slice(0, end).match(/if \(idx == \d+u\)/g) ?? [];
    // разъедется — превью покажет узор, которого в игре нет (или наоборот)
    expect(branches).toHaveLength(FALLOUT_SKIN_COUNT);
  });

  test("every pattern index has a name in both languages", () => {
    for (let i = 1; i <= FALLOUT_SKIN_COUNT; i++) {
      expect(falloutSkinTitle(i, true).length).toBeGreaterThan(2);
      expect(falloutSkinTitle(i, false).length).toBeGreaterThan(2);
      // ru и en различаются — иначе кто-то забыл перевести
      expect(falloutSkinTitle(i, true)).not.toBe(falloutSkinTitle(i, false));
    }
  });

  test("each pattern actually paints something (and not everything)", () => {
    // Узор из одного тона = «покупатель платит за гладкий пепел».
    for (let i = 1; i <= FALLOUT_SKIN_COUNT; i++) {
      let on = 0;
      let total = 0;
      for (let y = 0; y < 40; y += 0.5) {
        for (let x = 0; x < 40; x += 0.5) {
          total++;
          if (falloutSkinMask(i, x, y) > 0.5) on++;
        }
      }
      const frac = on / total;
      expect(frac, `pattern ${i} covers ${(frac * 100) | 0}%`).toBeGreaterThan(
        0.01,
      );
      expect(frac, `pattern ${i} covers ${(frac * 100) | 0}%`).toBeLessThan(
        0.99,
      );
    }
  });

  test("index 0 and out-of-range are smooth ash (no pattern)", () => {
    expect(falloutSkinMask(0, 3, 7)).toBe(0);
    expect(falloutSkinMask(FALLOUT_SKIN_COUNT + 1, 3, 7)).toBe(0);
  });

  test("patterns are deterministic — same point, same value", () => {
    for (let i = 1; i <= FALLOUT_SKIN_COUNT; i++) {
      expect(falloutSkinMask(i, 12.5, 7.25)).toBe(falloutSkinMask(i, 12.5, 7.25));
    }
  });
});

/**
 * @vitest-environment jsdom
 */
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { loadAtlasImage } from "../../src/client/render/gl/utils/AtlasImage";

// terron 04.09: decode() атласа отказывал у скрытой вкладки, и юниты/здания/
// эффекты не рисовались весь матч (22 сессии/3 дня, по три атласа разом).
// Загрузчик обязан пережить отказ decode(), взять загруженную картинку по load,
// повторить с меткой при обрыве и назвать отказ, если не вышло совсем.
class FakeImage {
  static behaviour: (img: FakeImage) => void = () => {};
  static created: FakeImage[] = [];
  src = "";
  crossOrigin = "";
  complete = false;
  naturalWidth = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decodeResult: Promise<void> = Promise.resolve();
  constructor() {
    FakeImage.created.push(this);
    // Синхронно: loadAtlasImage зовёт decode() сразу после new Image().
    FakeImage.behaviour(this);
  }
  decode(): Promise<void> {
    return this.decodeResult;
  }
}

function install(): void {
  FakeImage.created = [];
  (globalThis as unknown as { Image: unknown }).Image = FakeImage;
}

afterEach(() => vi.useRealTimers());

describe("loadAtlasImage", () => {
  test("decode() rejected but the image is loaded → same image is returned", async () => {
    install();
    FakeImage.behaviour = (img) => {
      img.decodeResult = Promise.reject(
        new Error("The source image cannot be decoded."),
      );
      img.complete = true;
      img.naturalWidth = 64;
    };
    const img = await loadAtlasImage("/atlas.png");
    expect(img).toBe(FakeImage.created[0]);
    expect(FakeImage.created.length).toBe(1);
  });

  test("broken download → retries with a cache-busting mark, then succeeds", async () => {
    install();
    vi.useFakeTimers();
    let n = 0;
    FakeImage.behaviour = (img) => {
      n++;
      if (n === 1) {
        img.decodeResult = Promise.reject(new Error("broken"));
        img.complete = false;
        setTimeout(() => img.onerror?.(), 0);
      } else {
        img.decodeResult = Promise.resolve();
      }
    };
    const p = loadAtlasImage("/atlas.png");
    await vi.runAllTimersAsync();
    const img = await p;
    expect(FakeImage.created.length).toBe(2);
    expect(img.src).toContain("?retry=1");
  });

  test("never loads → rejects after all attempts (the pass reports it)", async () => {
    install();
    vi.useFakeTimers();
    FakeImage.behaviour = (img) => {
      img.decodeResult = Promise.reject(new Error("nope"));
      img.complete = true;
      img.naturalWidth = 0;
    };
    const p = loadAtlasImage("/atlas.png", 2);
    const settled = p.then(
      () => "ok",
      (e) => `err:${(e as Error).message}`,
    );
    await vi.runAllTimersAsync();
    expect(await settled).toBe("err:nope");
    expect(FakeImage.created.length).toBe(2);
  });
});

describe("atlas passes use the resilient loader", () => {
  const root = path.join(__dirname, "..", "..");
  for (const f of [
    "src/client/render/gl/passes/UnitPass.ts",
    "src/client/render/gl/passes/StructurePass.ts",
    "src/client/render/gl/passes/fx-pass/FxSpritePass.ts",
  ]) {
    test(f, () => {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect(src).toContain("await loadAtlasImage(");
      expect(src).not.toMatch(/await img\.decode\(\)/);
      expect(src).toMatch(
        /loadAtlas\(\)\.catch\(\(e\) => reportAtlasFailure\(/,
      );
    });
  }
  test("the health kind is whitelisted on the API", () => {
    const api = fs.readFileSync(
      path.join(root, "../platform-api/src/clientHealth.ts"),
      "utf8",
    );
    expect(api).toContain('"atlas_load_failed",');
  });
});

// terron 29.09: клик спавна проверяет «не прилипать» ДО отправки и говорит
// причину — иначе ядро молча отказало бы (tests/SpawnSpacing.test.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

describe("оба пути спавна проверяют дистанцию", () => {
  it("клик по карте", () => {
    expect(src("../../src/client/ClientGameRunner.ts")).toMatch(
      /if \(checkSpawnSpacing\(this\.gameView, tile\)\)\s*this\.eventBus\.emit\(new SendSpawnIntentEvent\(tile\)\)/,
    );
  });
  it("радиальное меню (телефон)", () => {
    expect(src("../../src/client/hud/layers/RadialMenuElements.ts")).toMatch(
      /handleSpawn\(params\.tile, params\.game\)/,
    );
    expect(src("../../src/client/hud/layers/PlayerActionHandler.ts")).toMatch(
      /if \(game && !checkSpawnSpacing\(game, tile\)\) return;/,
    );
  });
  it("подсказка гейтится тем же типом матча, что ядро", () => {
    expect(src("../../src/client/SpawnSpacingHint.ts")).toMatch(
      /gameType !== GameType\.Public\) return null/,
    );
    expect(src("../../src/core/execution/SpawnExecution.ts")).toMatch(
      /gameType === GameType\.Public &&/,
    );
  });
  it("подсказка и ядро считают одной функцией", () => {
    expect(src("../../src/client/SpawnSpacingHint.ts")).toMatch(
      /spawnBlocker\(/,
    );
    expect(src("../../src/core/execution/SpawnExecution.ts")).toMatch(
      /spawnBlocker\(/,
    );
  });
});

// terron 29.09: золотой — 5 + 1 за соперника-человека, до 10 (решение владельца).
// Числа решения прибиты руками; клиент — только зеркало для показа, платит API.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { goldenRewardFor } from "../../src/client/GoldenReward";

const src = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
describe("золотой: формула", () => {
  it("1 человек — 5, двое — 6, шестеро и больше — 10", () => {
    expect(goldenRewardFor(1)).toBe(5);
    expect(goldenRewardFor(2)).toBe(6);
    expect(goldenRewardFor(6)).toBe(10);
    expect(goldenRewardFor(30)).toBe(10);
  });
});

// terron 30.09 (владелец): «пиши реально сколько получит, а не +5–10». Точную
// сумму считает игровой сервер по пику лобби и кладёт в конфиг; все места показа
// берут её оттуда — ни вилки, ни своего пересчёта по игрокам.
describe("все места показа берут точную сумму из конфига", () => {
  it("витрина, лобби, лента и экран победы", () => {
    const sel = src("../../src/client/GameModeSelector.ts");
    expect(sel).toMatch(/golden-note-reward"\s*>\+\$\{reward\}/);
    expect(sel).not.toMatch(/goldenRangeLabel/);
    const lobby = src("../../src/client/JoinLobbyModal.ts");
    expect(lobby).toMatch(/\.value=\$\{html`\+\$\{eventRewardOf\(c\)\}/);
    expect(lobby).not.toMatch(/goldenRangeLabel/);
    const ev = src("../../src/client/hud/layers/EventsDisplay.ts");
    expect(ev).toMatch(/return eventPerPersonOf\(this\.game\.config\(\)\.gameConfig\(\)\)/);
    expect(ev).toMatch(
      /L\("Победитель получит", "The winner gets"\)\}\s*\+\$\{this\.eventPerPerson\(\)\}/,
    );
    const win = src("../../src/client/hud/layers/WinModal.ts");
    expect(win).toMatch(/return eventPerPersonOf\(this\.game\?\.config\(\)\?\.gameConfig\(\)\)/);
    expect(win).toMatch(/\+\$\{this\.eventPayout\(\)\}/);
    for (const f of [ev, win]) expect(f).not.toMatch(/humansInMatch/);
  });
});

describe("зеркало с API", () => {
  const api = join(
    __dirname,
    "..",
    "..",
    "..",
    "platform-api",
    "src",
    "eventPayout.ts",
  );
  it.runIf(existsSync(api))("те же три числа", () => {
    const a = readFileSync(api, "utf8");
    const c = src("../../src/client/GoldenReward.ts");
    for (const k of [
      "GOLDEN_BASE_PTS",
      "GOLDEN_PER_RIVAL_PTS",
      "GOLDEN_MAX_PTS",
    ]) {
      const re = new RegExp(`${k} = (\\d+)`);
      expect(a.match(re)?.[1], k).toBe(c.match(re)?.[1]);
    }
  });
});

// terron 28.09: честный бот подписан как бот на любом языке (репорт KDaniilW:
// «почему бот отображается как игрок?»).
import { describe, expect, it, vi } from "vitest";

const lang = { v: "ru" };
vi.mock("../../src/client/Utils", async (orig) => ({
  ...(await orig<object>()),
  getCurrentLang: () => lang.v,
}));

import { localizeAIName } from "../../src/client/LocalizeNames";
import { FAIR_BOT_ROSTER } from "../../src/core/execution/fairbot/FairBotRoster";

describe("пометка «бот» у честных ботов", () => {
  const p = FAIR_BOT_ROSTER[0];
  it("по-русски: русское имя + [бот]", () => {
    lang.v = "ru";
    expect(localizeAIName(p.en)).toBe(`${p.ru} [бот]`);
  });
  it("на других языках: имя + [bot]", () => {
    lang.v = "en";
    expect(localizeAIName(p.en)).toBe(`${p.en} [bot]`);
    lang.v = "vi";
    expect(localizeAIName(p.en)).toBe(`${p.en} [bot]`);
  });
  it("ник живого игрока не трогаем", () => {
    lang.v = "ru";
    expect(localizeAIName("Walt")).toBe("Walt");
  });
});

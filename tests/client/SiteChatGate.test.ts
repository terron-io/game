// terron 28.09: ЛС и чат клана — только на сайте (решение владельца). Внутри
// площадок и в приложениях из сторов их нет вовсе.
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  platform: false,
  pay: "site" as "site" | "platform" | "native",
};
vi.mock("../../src/client/PlatformHost", () => ({
  Host: { isPlatform: () => state.platform },
}));
vi.mock("../../src/client/PayGate", () => ({
  payHost: () =>
    state.pay === "native"
      ? { kind: "native", token: "native-ios" }
      : { kind: state.pay },
}));

import { siteChatAllowed } from "../../src/client/SiteChatGate";

describe("siteChatAllowed", () => {
  beforeEach(() => {
    state.platform = false;
    state.pay = "site";
  });
  it("сайт — да", () => expect(siteChatAllowed()).toBe(true));
  it("кадр площадки (ВК, ОК, Яндекс, Пикабу) — нет", () => {
    // признак площадки сам по себе (без помощи гейта оплаты)
    state.platform = true;
    expect(siteChatAllowed()).toBe(false);
  });
  it("приложение из стора — нет", () => {
    state.pay = "native";
    expect(siteChatAllowed()).toBe(false);
  });
});

const src = (f: string) =>
  fs.readFileSync(path.join(__dirname, "../../src/client", f), "utf8");

describe("все входы в чат идут через гейт", () => {
  it("панель: старт, отрисовка и доступ к экземпляру", () => {
    const s = src("SiteChatPanel.ts");
    expect(s).toMatch(/start\(\)[\s\S]{0,80}!siteChatAllowed\(\)/);
    expect(s).toMatch(/render\(\)\s*\{\s*if \([^)]*!siteChatAllowed\(\)/);
    expect(s).toMatch(
      /siteChat\(\)[^{]*\{\s*if \(!siteChatAllowed\(\)\) return null/,
    );
  });
  it("кнопки «Написать» и чат клана, строка ЛС в ленте", () => {
    expect(src("ProfilePage.ts")).toMatch(
      /siteChatAllowed\(\)\s*\?\s*html`<button\s+class="t-btn ghost profile-write-btn"/,
    );
    expect(src("FriendsPage.ts")).toMatch(
      /siteChatAllowed\(\)\s*\?\s*html`<button\s+class="t-btn ghost friend-write-btn"/,
    );
    expect(src("ClanPage.ts")).toMatch(
      /renderChatBtn\(\)[^{]*\{\s*if \(!siteChatAllowed\(\)\) return html``/,
    );
    expect(src("hud/layers/EventsDisplay.ts")).toMatch(
      /onSiteDm = [\s\S]{0,60}!siteChatAllowed\(\)/,
    );
  });
});

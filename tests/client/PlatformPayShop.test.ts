// terron 12.09: покупки через площадку — клиентская половина. Инварианты:
// витрина не трогает SDK напрямую, клиент ничего не начисляет сам, кнопка
// «купить» живёт только по слову сервера (provider = "gamepush"), а погашение
// идёт СТРОГО после начисления.
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("витрина площадки в магазине", () => {
  const shop = code("src/client/ShopPage.ts");

  it("магазин ходит к площадке только через фасад PlatformPay", () => {
    expect(shop).toMatch(/from "\.\/PlatformPay"/);
    expect(shop).not.toMatch(/GamePushSDK/);
  });

  it("кнопка «купить» выключена, пока сервер не сказал provider = gamepush", () => {
    expect(shop).toMatch(/const live = this\.pay\?\.provider === "gamepush";/);
    expect(shop).toMatch(/\?disabled=\$\{!live \|\| busy/);
    expect(shop).toMatch(/if \(!tag \|\| this\.platformBuying \|\| this\.pay\?\.provider !== "gamepush"\) return;/);
  });

  it("порядок: purchase → claim на сервере → consume; своих начислений нет", () => {
    const i = shop.indexOf("private async buyOnPlatform(");
    const body = shop.slice(i, shop.indexOf("private async loadPay(", i));
    const p = body.indexOf("platformPurchase(");
    const c = body.indexOf("claimPlatformPurchase(");
    const k = body.indexOf("platformConsume(");
    expect(p).toBeGreaterThan(0);
    expect(c).toBeGreaterThan(p);
    expect(k).toBeGreaterThan(c);
    expect(body).not.toMatch(/adjust|this\.pts\s*\+=|this\.pts\s*=\s*/);
  });

  it("витрина площадки видна только по слову сервера (provider = gamepush)", () => {
    const i = shop.indexOf("private get platformShop()");
    const j = shop.indexOf("private get topupAvailable()");
    expect(shop.slice(i, j)).toContain('this.pay?.provider === "gamepush"');
  });

  it("вкладка «Пополнить» на площадке появляется только с витриной площадки", () => {
    expect(shop).toMatch(/private get topupAvailable\(\): boolean \{\s*return !this\.embedded \|\| this\.platformShop;/);
    expect(shop).not.toMatch(/this\.embedded \? "" : navBtn\("topup"/);
  });
});

describe("фасад PlatformPay", () => {
  it("фильтрует каталог до наших пакетов и сортирует по номиналу", async () => {
    const m = await import("../../src/client/PlatformPay");
    expect(m.ptsOf({ id: 1, tag: "pts_260" })).toBe(260);
    expect(m.ptsOf({ id: 2, tag: "VIP" })).toBe(0);
    // без SDK площадки каталог пуст и покупки недоступны — витрина не рисуется
    expect(m.platformPurchasesAvailable()).toBe(false);
    expect(m.platformPtsProducts()).toEqual([]);
  });
});

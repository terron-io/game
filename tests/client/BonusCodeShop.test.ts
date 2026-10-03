// terron 16.09: поле бонус-кода в магазине. Сервер — platform-api/src/bonusCodes.ts
// (там свои тесты); здесь сторожим клиентскую обвязку сканером исходника.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const shop = readFileSync(path.join(root, "src/client/ShopPage.ts"), "utf8");
const api = readFileSync(path.join(root, "src/client/Api.ts"), "utf8");
const serverCodes = readFileSync(
  path.join(root, "../platform-api/src/bonusCodes.ts"),
  "utf8",
);

describe("бонус-код в магазине", () => {
  it("кнопка и прямая ссылка /shop/code — только вне нативных апок (App Store 3.1.1)", () => {
    expect(shop).toMatch(/get codesAvailable\(\): boolean \{\s*return payHost\(\)\.kind !== "native";/);
    expect(shop).toContain("${this.codesAvailable");
    expect(shop).toContain('args?.tab === "code" && this.codesAvailable');
  });

  it("у каждой причины отказа сервера есть свой текст (а не «такого кода нет»)", () => {
    const union = serverCodes.slice(
      serverCodes.indexOf("export type RedeemRefusal"),
      serverCodes.indexOf("/** Можно ли погасить код"),
    );
    const reasons = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(3);
    const texts = shop.slice(
      shop.indexOf("private static codeRefusalText"),
      shop.indexOf("private async submitCode"),
    );
    // not_found и disabled намеренно сливаются в «такого кода нет»: выключенный
    // код не должен подсказывать, что он существовал
    for (const r of reasons.filter((x) => x !== "not_found" && x !== "disabled")) {
      expect(texts, `нет текста для ${r}`).toContain(`case "${r}"`);
    }
    for (const r of ["skin_name_taken", "unauthorized", "too_many_attempts"]) {
      expect(texts).toContain(`case "${r}"`);
    }
  });

  it("клиентский тип отказов покрывает серверные причины", () => {
    const union = serverCodes.slice(
      serverCodes.indexOf("export type RedeemRefusal"),
      serverCodes.indexOf("/** Можно ли погасить код"),
    );
    const clientUnion = api.slice(
      api.indexOf("export type BonusCodeRefusal"),
      api.indexOf("export interface BonusCodeGranted"),
    );
    for (const m of union.matchAll(/"([a-z_]+)"/g)) {
      expect(clientUnion).toContain(`"${m[1]}"`);
    }
  });

  it("отказ показывается внутри окна кода, а не под затемнением", () => {
    const flow = shop.slice(
      shop.indexOf("private async submitCode"),
      shop.indexOf("private renderCodeReward"),
    );
    expect(flow.match(/this\.codeError = ShopPage\.codeFailureText/g)?.length).toBe(2);
    expect(flow).not.toMatch(/this\.msg = ShopPage\.code/);
    const input = shop.slice(shop.indexOf("private renderCodeInput"), shop.indexOf("private renderNameModal"));
    expect(input).toContain("${this.codeError");
  });

  it("два шага: «Проверить» ничего не выдаёт, награду забирает только «Забрать»", () => {
    const check = shop.slice(shop.indexOf("private async submitCode"), shop.indexOf("private async claimCode"));
    expect(check).toContain("checkBonusCode(");
    expect(check).not.toContain("redeemBonusCode(");
    const claim = shop.slice(shop.indexOf("private async claimCode"), shop.indexOf("private renderCodeReward"));
    expect(claim).toContain("redeemBonusCode(");
    const reward = shop.slice(shop.indexOf("private renderCodeReward"), shop.indexOf("private renderCodeModal"));
    expect(reward).toContain("this.claimCode()");
    expect(reward).toContain('L("Отказаться"');
    expect(api).toContain('"/me/bonus-code/check"');
  });

  it("отказ говорит, сколько попыток осталось и когда снова можно", () => {
    const f = shop.slice(shop.indexOf("private static codeFailureText"), shop.indexOf("private async submitCode"));
    expect(f).toContain("attemptsLeft");
    expect(f).toContain("retryAt");
  });

  it("выписка кошелька подписывает начисление по коду", () => {
    expect(shop).toMatch(/bonus_code: L\("Бонус-код"/);
  });
});

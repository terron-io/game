// terron 12.09: «везде, где отдаётся реальный id площадки, собирай» — ОК и
// Telegram добавлены к ВК/Яндексу. Инварианты те же, что у ВК-ветки (25.08):
// только числовой id, нет параметра → null (gp-id НЕ подставляется), и сервер
// принимает провайдера по белому списку.
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("нативный id площадки: ОК и Telegram", () => {
  const sdk = code("src/client/GamePushSDK.ts");
  const fn = sdk.slice(sdk.indexOf("async nativeIdentity("), sdk.indexOf("async getNativeId("));

  it("ОК — logged_user_id из параметров запуска, только число, без фолбэка на gp-id", () => {
    expect(fn).toMatch(/if \(type === "OK"\) \{[\s\S]*?LAUNCH_PARAMS\.get\("logged_user_id"\)[\s\S]*?provider: "ok"/);
    const ok = fn.slice(fn.indexOf('type === "OK"'), fn.indexOf('type === "TELEGRAM"'));
    expect(ok).toMatch(/\^\\d\+\$/);
    expect(ok).toMatch(/return null;/);
    expect(ok).not.toMatch(/player\?\.id|gpId/);
  });

  it("Telegram — initDataUnsafe.user.id, только число", () => {
    const tg = fn.slice(fn.indexOf('type === "TELEGRAM"'), fn.lastIndexOf("return null;"));
    expect(tg).toContain("initDataUnsafe");
    expect(tg).toMatch(/provider: "telegram"/);
    expect(tg).toMatch(/\^\\d\+\$/);
  });

  it("сервер принимает обоих провайдеров белым списком", () => {
    const srv = readFileSync("../platform-api/src/auth/nativeLink.ts", "utf8");
    expect(srv).toMatch(/NATIVE_PROVIDERS = new Set\(\[[^\]]*"ok"[^\]]*\]\)/);
    expect(srv).toMatch(/NATIVE_PROVIDERS = new Set\(\[[^\]]*"telegram"[^\]]*\]\)/);
  });
});

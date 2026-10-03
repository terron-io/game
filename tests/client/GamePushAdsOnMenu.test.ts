// terron 02.09: РЕКЛАМА ПЛОЩАДКИ GAMEPUSH — «стики и в конце».
//
// Модерация Одноклассников отклонила заявку: «в вашей игре нет рекламы». Их же
// рекомендация дословно — «лучше всего и стики, и в конце». Разбор показал два
// провала на нашей стороне:
//   • sticky звался только при `isStickyAvailable === true`, а этот флаг у
//     площадки на момент вызова бывает false — мы молча выходили (репорт
//     владельца с телефона: «рекламы не вижу, ты уверен, что триггеришь?»);
//   • fullscreen для GamePush не звался НИГДЕ — interstitial жил только в мосте
//     Playgama.
// Плюс датчик хелса gp_ads_caps: что из рекламы площадка вообще отдаёт — иначе
// «не вижу» не отличить от «не даёт».
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");
const sdk = read("src/client/GamePushSDK.ts");
const main = read("src/client/Main.ts");

describe("sticky-баннер", () => {
  it("не гейтится флагом доступности — решает их SDK", () => {
    const body = sdk.slice(
      sdk.indexOf("showStickyAd(): void {"),
      sdk.indexOf("showFullscreenAd(): void {"),
    );
    expect(body).toContain("ads.showSticky()");
    expect(body).not.toMatch(/isStickyAvailable !== true\) return/);
  });

  it("события баннера логируются — с телефона это единственный след", () => {
    for (const ev of ["sticky:start", "sticky:render", "sticky:close"]) {
      expect(sdk).toContain(`"${ev}"`);
    }
  });
});

describe("fullscreen в конце матча", () => {
  it("метод есть и зовёт showFullscreen площадки", () => {
    expect(sdk).toMatch(/showFullscreenAd\(\): void \{[\s\S]*?ads\.showFullscreen\(\)/);
  });

  it("зовётся при возврате из матча в меню, рядом с gameplayStop", () => {
    const i = main.indexOf("GamePushSDK.gameplayStop();");
    expect(i).toBeGreaterThan(0);
    const window = main.slice(i, i + 600);
    expect(window).toContain("GamePushSDK.showFullscreenAd();");
    expect(window).toContain("GamePushSDK.showStickyAd();");
  });

  it("НЕ зовётся на старте матча — там площадки ролик запрещают", () => {
    const i = main.indexOf("GamePushSDK.gameplayStart();");
    expect(i).toBeGreaterThan(0);
    expect(main.slice(i, i + 400)).not.toContain("showFullscreenAd");
  });
});

describe("датчик gp_ads_caps живёт в трёх местах", () => {
  it("клиент шлёт, оба union и вайтлист знают", () => {
    expect(sdk).toMatch(/reportHealth\(\s*"gp_ads_caps"/);
    expect(read("src/client/Health.ts")).toContain('"gp_ads_caps"');
    const api = read("../platform-api/src/clientHealth.ts");
    expect(api.split('"gp_ads_caps"').length - 1).toBe(2); // union + KINDS
  });
});

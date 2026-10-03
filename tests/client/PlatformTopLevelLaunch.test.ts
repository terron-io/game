// terron 02.09: ПЛОЩАДКА, ОТКРЫВШАЯ НАС ВЕРХНИМ ДОКУМЕНТОМ.
//
// Мобильные приложения ВК и Одноклассников грузят игру прямо в свой WebView:
// iframe там нет, `self === top`. Пока единственным признаком площадки был
// iframe, с телефона отваливалось ВСЁ сразу — SDK GamePush не грузился, а
// значит не было ни автовхода (игрок оставался анонимом), ни рекламы площадки,
// ни её запретов (видимые внешние ссылки).
//
// Цена ошибки — две претензии модерации в один день: Одноклассники «игра не
// запускается на моб. устройствах» + «в вашей игре нет рекламы», Яндекс —
// внешние ссылки. Диагноз подтверждён логами 02.09: заход из приложения ВК
// пришёл с referrer «terron.io/?vk_access_token_settings=…», то есть параметры
// запуска лежали в НАШЕМ адресе, а не у родительского окна.
//
// Поэтому второй признак — параметры запуска площадки в адресной строке, и он
// обязан жить в ОДНОМ месте: инлайн-скрипт index.html выставляет
// window.__platformLaunch, клиент только читает его.
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

const indexHtml = readFileSync(join(process.cwd(), "index.html"), "utf-8");

describe("запуск площадкой верхним документом", () => {
  it("SDK грузится не только в iframe: гейт учитывает флаг запуска", () => {
    // Голый `self === top → return` означал бы, что в мобильном приложении
    // площадки SDK не поднимется никогда.
    expect(indexHtml).toMatch(
      /window\.self === window\.top && !window\.__platformLaunch/,
    );
    expect(indexHtml).not.toMatch(
      /if \(window\.self === window\.top\) return;/,
    );
  });

  it("класс площадки ставится и при запуске верхним документом", () => {
    expect(indexHtml).toMatch(
      /if \(forced \|\| launched \|\| window\.self !== window\.top\)/,
    );
  });

  it("узнаёт параметры запуска и ВК, и Одноклассников", () => {
    // ВК шлёт vk_app_id/vk_user_id, ОК — api_server/application_key/logged_user_id.
    // Потеряешь любой — площадка снова станет «обычным сайтом».
    for (const p of [
      "vk_app_id",
      "vk_user_id",
      "api_server",
      "application_key",
      "logged_user_id",
    ]) {
      expect(indexHtml).toContain(p);
    }
  });

  it("признак переживает навигацию внутри вкладки", () => {
    // Адрес чистит наш роутер, и вторая загрузка осталась бы без параметров —
    // то есть снова без SDK, автовхода и рекламы.
    expect(indexHtml).toMatch(
      /sessionStorage\.setItem\("terron_platform_launch", "1"\)/,
    );
    expect(indexHtml).toMatch(
      /sessionStorage\.getItem\("terron_platform_launch"\) === "1"/,
    );
  });

  it("флаг публикуется для клиента одним источником правды", () => {
    expect(indexHtml).toMatch(/window\.__platformLaunch = launched;/);
  });
});

describe("клиент читает тот же флаг", () => {
  afterEach(() => {
    delete (window as unknown as { __platformLaunch?: boolean })
      .__platformLaunch;
  });

  it("isOnPlatform говорит «да» без iframe, если запустила площадка", async () => {
    const { GamePushSDK } = await import("../../src/client/GamePushSDK");
    // Верхний документ — ровно как в приложении ВК на телефоне.
    expect(window.self === window.top).toBe(true);
    expect(GamePushSDK.isOnPlatform()).toBe(false);

    (window as unknown as { __platformLaunch?: boolean }).__platformLaunch =
      true;
    expect(GamePushSDK.isOnPlatform()).toBe(true);
  });
});

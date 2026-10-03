import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// terron 05.09: «где мы запущены» решает ОДИН модуль — client/PlatformHost.ts.
// Всё остальное спрашивает Host, а не SDK/DOM/сборочные константы. Иначе каждая
// новая площадка (ВК, ОК, Яндекс, GamePush-хостинг, Playgama, itch, апки) снова
// расползётся по семи файлам, и половина отказов модерации — «одно место знало,
// другое нет» — вернётся.
const ROOT = "src/client";
// Модули, которым ЗНАТЬ положено: сам фасад, SDK, узкие фасады над ними, гейт
// оплаты, контекст сессии площадки, бутстрап-хелперы Utils (isItchEmbed, бренд),
// диагностические зонды и устаревшие SDK (CrazyGames/Yandex — выпиливаются).
const ALLOWED = new Set([
  "PlatformHost.ts",
  "GamePushSDK.ts",
  "PlaygamaBridge.ts",
  "PlatformAuth.ts",
  "PlatformAds.ts",
  "PlatformPay.ts", // покупки через площадку (12.09), тот же образец
  "PayGate.ts",
  "PlatformContext.ts",
  "Utils.ts",
  "LangStateProbe.ts",
  "CrazyGamesSDK.ts",
  "YandexGamesSDK.ts",
  "Offline.ts", // мост Capacitor (апка), не площадка
  // Шим History API для чужого хостинга (07.09, соседняя вкладка): ставится в
  // бутстрапе ДО всего и потому не тянет модульный граф фасада — иначе SDK
  // площадки уехал бы в стартовый чанк. Свой признак сборки тут осознан.
  "PlatformHistoryGuard.ts",
]);
const FORBIDDEN: RegExp[] = [
  /\bGamePushSDK\./,
  /from "\.{1,2}\/(?:\.\.\/)*GamePushSDK"/,
  /import\("[./]*\/GamePushSDK"\)/,
  /PlaygamaBridge/,
  /isPlaygamaBuild\(/,
  /isItchEmbed\(/,
  /["']gp-embed["']/,
  /__PLATFORM_BUILD__/,
  /__platformLaunch/,
  /self\s*!==?\s*(window\.)?top\b/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("PlatformHost is the only place that knows the platform", () => {
  test("no direct SDK / DOM-class / build-constant platform checks outside the allow-list", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const base = file.split("/").pop()!;
      if (ALLOWED.has(base)) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      for (const re of FORBIDDEN) {
        const m = src.match(re);
        if (m) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("Host answers the three different 'are we on a platform' questions", () => {
    const src = readFileSync("src/client/PlatformHost.ts", "utf8");
    for (const fn of [
      "inPlatformFrame()",
      "isPlatform()",
      "isGamePush()",
      "externalLinksAllowed()",
      "bootstrap()",
      "gameplayStart()",
      "gameplayStop(ads: boolean)",
    ]) {
      expect(src).toContain(fn);
    }
  });
});

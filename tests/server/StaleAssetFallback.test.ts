// terron 09.09: УСТАРЕВШИЙ ХЭШ АССЕТА → АКТУАЛЬНЫЙ ФАЙЛ, а не 404.
//
// Манифест ассетов вшит в бандл, а платформенные сборки (хостинг GamePush,
// черновик Яндекса, GD) тянут ассеты с прода. Каждый выкат, сменивший хэш,
// ломал их все: черновик Яндекса 09.09 просил `lang/ru.0f3d6c5eb913.json`,
// прод отвечал 404 без CORS и SPA-оболочкой — словарь не грузился, игрок видел
// сырые ключи и плашку «не удалось загрузить». За сутки 505 таких отказов на
// одну иконку и 32 на словарь.
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHashedPublicAssetFiles,
  latestPublicAssetPath,
} from "../../src/server/PublicAssetManifest";

const read = (p: string) =>
  fs.readFileSync(new URL(p, import.meta.url), "utf8");

describe("сборка кладёт «актуальную» ссылку без хэша", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("имя без хэша лежит рядом с хэшированным файлом", () => {
    expect(
      latestPublicAssetPath("static/_assets/lang/ru.0f3d6c5eb913.json", "lang/ru.json"),
    ).toBe(path.join("static/_assets/lang", "ru.json"));
    expect(
      latestPublicAssetPath(
        "static/_assets/maps/big/thumbnail-sm.abcdefabcdef.webp",
        "maps/big/thumbnail-sm.webp",
      ),
    ).toBe(path.join("static/_assets/maps/big", "thumbnail-sm.webp"));
  });

  it("после сборки актуальный файл читается по имени без хэша", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "terron-assets-"));
    tmp.push(root);
    const src = path.join(root, "resources");
    const out = path.join(root, "static");
    fs.mkdirSync(path.join(src, "lang"), { recursive: true });
    fs.writeFileSync(path.join(src, "lang", "ru.json"), '{"a":"первый"}');
    createHashedPublicAssetFiles([src], out, {
      "lang/ru.json": "/_assets/lang/ru.0f3d6c5eb913.json",
    });
    const latest = path.join(out, "_assets", "lang", "ru.json");
    expect(fs.existsSync(latest)).toBe(true);
    expect(fs.readFileSync(latest, "utf8")).toBe('{"a":"первый"}');

    // Пересборка с НОВЫМ хэшем: ссылка обязана переехать на новую версию,
    // иначе старый билд получит не актуальный словарь, а позапрошлый.
    fs.writeFileSync(path.join(src, "lang", "ru.json"), '{"a":"второй"}');
    createHashedPublicAssetFiles([src], out, {
      "lang/ru.json": "/_assets/lang/ru.b3f805977690.json",
    });
    expect(fs.readFileSync(latest, "utf8")).toBe('{"a":"второй"}');
  });
});

describe("nginx подменяет устаревший хэш на актуальный файл", () => {
  const conf = read("../../nginx.conf");
  const assets = conf.slice(
    conf.indexOf("location ^~ /_assets/ {"),
    conf.indexOf("location ~* ^/w(\\d+)"),
  );

  it("промах по /_assets/ перехватывается и уходит в @stale_asset", () => {
    expect(assets).toMatch(/^\s+proxy_intercept_errors on;/m);
    expect(assets).toMatch(/^\s+error_page 404 = @stale_asset;/m);
    // Второй промах (имени без хэша тоже нет) обязан снова уйти в @stale_asset,
    // иначе окончательный 404 уходит без CORS.
    expect(assets).toMatch(/^\s+recursive_error_pages on;/m);
    expect(conf).toMatch(/^\s+location @stale_asset \{/m);
  });

  it("правило переписывания снимает ровно 12-hex хэш перед расширением", () => {
    // ⚠️ Регулярка обязана быть В КАВЫЧКАХ: `{12}` без них nginx читает как
    // блок и не стартует вовсе. Сторож требует кавычки, а не просто наличие.
    const m = assets.match(/rewrite "([^"]+)" \$1\$2 last;/);
    expect(m).not.toBeNull();
    const re = new RegExp(m![1]);
    // Настоящие адреса из лога 404 за 09.09.
    const cases: [string, string][] = [
      ["/_assets/lang/ru.0f3d6c5eb913.json", "/_assets/lang/ru.json"],
      [
        "/_assets/images/ExitIconWhite.24c9ecfb680a.svg",
        "/_assets/images/ExitIconWhite.svg",
      ],
      ["/_assets/manifest.1450498af4f4.json", "/_assets/manifest.json"],
    ];
    for (const [from, to] of cases) {
      expect(from.replace(re, "$1$2")).toBe(to);
    }
    // Имя без хэша правилу не соответствует — иначе была бы петля.
    expect(re.test("/_assets/lang/ru.json")).toBe(false);
  });

  it("окончательный 404 всё равно несёт CORS — иначе на чужом хостинге это «blocked by CORS»", () => {
    const named = conf.slice(conf.indexOf("location @stale_asset {"));
    // ⚠️ Не первая `}` — она стоит внутри `{12}` в самой регулярке.
    const block = named.slice(0, named.indexOf("\n    }"));
    expect(block).toMatch(/Access-Control-Allow-Origin "\*" always/);
    expect(block).toMatch(/return 404;/);
  });
});

import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import { lookup as lookupMime } from "mrmime";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";
import {
  type AssetManifest,
  buildAssetUrl,
  rewriteAssetsForCdn,
} from "./src/core/AssetUrls";
import {
  buildPublicAssetManifest,
  copyRootPublicFiles,
  createHashedPublicAssetFiles,
  getProprietaryDir,
  getResourcesDir,
  writePublicAssetManifest,
} from "./src/server/PublicAssetManifest";

// Vite already handles these, but its good practice to define them explicitly
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function serveProprietaryDir(
  proprietaryDir: string,
  resourcesDir: string,
): Plugin {
  return {
    name: "serve-proprietary-dir",
    configureServer(server) {
      // Must run before Vite's htmlFallback; skip when resources/ has the file
      // so publicDir keeps precedence.
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const rel = decodeURIComponent(
          new URL(req.url, "http://x").pathname,
        ).replace(/^\//, "");
        if (rel.includes("..")) return next();
        if (fs.existsSync(path.join(resourcesDir, rel))) return next();
        const filePath = path.join(proprietaryDir, rel);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
          return next();
        const mime = lookupMime(filePath);
        if (mime) res.setHeader("Content-Type", mime);
        res.setHeader("Cache-Control", "no-store");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // terron: режим 'ya' — сборка под Яндекс/GamePush iframe. Как prod (абсолютный
  // бэкенд), но с относительными путями (base:'./') и в отдельный static-ya.
  const isYa = mode === "ya";
  // terron 30.08: сборка под Playgama (их дистрибуция на западные веб-порталы).
  // Как ya (относительные пути, абсолютный бэкенд), но с ДРУГИМ содержимым
  // index.html — см. playgamaHtml() ниже.
  const isPlaygama = mode === "playgama";
  // terron: офлайн нативный бандл (Apple 4.2) — prod-сборка (хеш/манифест/ассеты) +
  // ЗАПОЛНЕННЫЙ шаблон index.html (в апке нет сервера, чтобы рендерить BOOTSTRAP_CONFIG).
  const isBundle = mode === "bundle";
  const isProduction = mode === "production" || isYa || isBundle || isPlaygama;
  const resourcesDir = getResourcesDir(__dirname);
  const proprietaryDir = getProprietaryDir(__dirname);
  const sourceDirs = [resourcesDir, proprietaryDir];
  const assetManifest: AssetManifest = isProduction
    ? buildPublicAssetManifest(sourceDirs)
    : {};
  const cdnBase = env.CDN_BASE ?? "";
  const htmlAssetData = {
    assetManifest: JSON.stringify(assetManifest),
    cdnBase: JSON.stringify(cdnBase),
    gameEnv: JSON.stringify(env.GAME_ENV ?? "dev"),
    numWorkers: JSON.stringify(parseInt(env.NUM_WORKERS ?? "2", 10)),
    turnstileSiteKey: JSON.stringify(
      env.TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA",
    ),
    jwtAudience: JSON.stringify(env.DOMAIN ?? "localhost"),
    instanceId: JSON.stringify(env.INSTANCE_ID ?? "DEV_ID"),
    manifestHref: buildAssetUrl("manifest.json", assetManifest, cdnBase),
    faviconHref: buildAssetUrl("images/Favicon.svg", assetManifest, cdnBase),
    gameplayScreenshotUrl: buildAssetUrl(
      "images/GameplayScreenshot.png",
      assetManifest,
      cdnBase,
    ),
    backgroundImageUrl: buildAssetUrl(
      "images/background.webp",
      assetManifest,
      cdnBase,
    ),
    desktopLogoImageUrl: buildAssetUrl(
      "images/TerronLogo.png",
      assetManifest,
      cdnBase,
    ),
    mobileLogoImageUrl: buildAssetUrl(
      "images/TerronLogo.png",
      assetManifest,
      cdnBase,
    ),
  };

  // terron 30.08: index.html под Playgama.
  //
  // Их технические требования запрещают встроенную стороннюю аналитику и требуют
  // интеграции их Bridge SDK. Поэтому из шаблона ВЫРЕЗАЮТСЯ два блока —
  // Яндекс.Метрика и загрузчик GamePush (чужой агрегатор в их сборке не нужен и
  // прямо мешает), и добавляется скрипт Bridge.
  //
  // ⚠️ Каждое вырезание идёт с проверкой: не нашли маркер — СБОРКА ПАДАЕТ. Молча
  // собранный билд с Метрикой внутри — это отказ на модерации и потерянная неделя.
  const playgamaHtml = (): Plugin => ({
    name: "terron-playgama-html",
    transformIndexHtml: {
      order: "post" as const,
      handler(html: string) {
        const cut = (from: string, to: string, what: string) => {
          const a = html.indexOf(from);
          const b = html.indexOf(to, a + 1);
          if (a < 0 || b < 0) {
            throw new Error(
              `playgama-сборка: не найден блок ${what} (маркеры «${from}» … «${to}»). ` +
                `Шаблон изменился — проверь index.html, иначе билд уедет с ним внутри.`,
            );
          }
          html = html.slice(0, a) + html.slice(b + to.length);
        };
        cut(
          "<!-- Yandex.Metrika counter",
          "<!-- /Yandex.Metrika counter -->",
          "Яндекс.Метрика",
        );
        cut("<!-- terron: GamePush SDK", "</script>", "загрузчик GamePush");
        // ⚠️ Зонд РФ-throttle меряет ПОЛОСУ ДО НАШЕГО origin, а страница лежит на
        // ИХ хостинге: три запроса уходят на их домен, отвечают 404 и мусорят в
        // консоли на первых же секундах (видно в их QA-инструменте). Смысла там у
        // него нет вовсе. Парный ready-бикон в Main.ts гаснет сам — он висит на
        // `window.__tLbSid`, который ставит ровно этот блок.
        cut(
          "<!-- terron: RU-THROTTLE PROBES",
          "<!-- /terron: RU-THROTTLE PROBES -->",
          "зонд РФ-throttle",
        );
        const bridge =
          '<script src="https://bridge.playgama.com/v2/stable/playgama-bridge.js"></script>';
        if (!html.includes("</body>")) {
          throw new Error("playgama-сборка: в шаблоне нет </body>");
        }
        return html.replace("</body>", `    ${bridge}\n  </body>`);
      },
    },
  });

  // terron 29.08: в bundle-режиме шаблон index.html заполняем САМИ, а не через
  // vite-plugin-html. Причина: с 21.08 у сборки ДВА входа (index + simworker), а
  // vite-plugin-html при multi-entry теряет inject-данные и падает на первой же
  // подстановке («manifestHref is not defined», ejs:327) — то есть офлайн-бандл
  // (iOS/Android, а теперь и Steam) НЕ СОБИРАЛСЯ ВОВСЕ. Убрать второй вход для
  // бандла нельзя: файла assets/simworker.js тогда не будет, а blob-фолбэк в
  // WorkerClient ловит SecurityError, а не 404 — симуляция не поднялась бы.
  // Подстановок в шаблоне 13 штук и ни одной ветки логики, поэтому свой
  // transformIndexHtml надёжнее чужого EJS.
  const fillTemplate = (data: Record<string, string>): Plugin => ({
    name: "terron-fill-template",
    transformIndexHtml: {
      order: "pre" as const,
      handler(html: string) {
        return html.replace(
          /<%-\s*([A-Za-z_][A-Za-z0-9_]*)\s*%>/g,
          (_m: string, key: string) => {
            if (!(key in data)) {
              // Молча оставленный плейсхолдер уехал бы в статику как текст.
              throw new Error(
                `index.html: нет значения для подстановки <%- ${key} %>`,
              );
            }
            return data[key];
          },
        );
      },
    },
  });

  // Vite's HTML transform replaces the source <script src="/src/client/Main.ts">
  // with the hashed bundle URL and injects <link rel="modulepreload"> /
  // <link rel="stylesheet"> tags. rewriteAssetsForCdn rewrites those refs to
  // an EJS placeholder so RenderHtml.ts can prefix them with CDN_BASE at
  // request time.
  const injectCdnBaseTemplate = (): Plugin => ({
    name: "inject-cdn-base-template",
    apply: "build" as const,
    enforce: "post",
    transformIndexHtml: rewriteAssetsForCdn,
  });

  let viteBundleFiles: string[] = [];
  const syncHashedPublicAssets = (): Plugin => ({
    name: "sync-hashed-public-assets",
    apply: "build" as const,
    writeBundle(_options, bundle) {
      viteBundleFiles = Object.keys(bundle);
    },
    closeBundle() {
      const outDir = path.join(__dirname, "static");
      copyRootPublicFiles(resourcesDir, outDir);
      // Run the source→hashed copy first; createHashedPublicAssetFiles iterates
      // assetManifest and expects every key to resolve to a file in resources/
      // or proprietary/. Vite's bundle output (assets/...) doesn't, so it's
      // merged in after.
      createHashedPublicAssetFiles(sourceDirs, outDir, assetManifest);
      // Track Vite's own bundle output (vendor chunks, JS, CSS, workers under
      // static/assets/) in the manifest so the deploy-time R2 upload covers
      // them alongside the hashed source assets. Skip non-assets/ emits like
      // index.html — those are served by the app, not from R2.
      for (const fileName of viteBundleFiles) {
        if (!fileName.startsWith("assets/")) continue;
        assetManifest[fileName] = `/${fileName}`;
      }
      writePublicAssetManifest(outDir, assetManifest);
    },
  });

  // In dev, redirect visits to /w*/game/* to "/" so Vite serves the index.html.
  const devGameHtmlBypass = (req?: {
    url?: string;
    method?: string;
    headers?: { accept?: string | string[] };
  }) => {
    if (req?.method !== "GET") return undefined;
    const accept = req.headers?.accept;
    const acceptValue = Array.isArray(accept)
      ? accept.join(",")
      : (accept ?? "");
    if (!acceptValue.includes("text/html")) return undefined;
    if (!req.url) return undefined;
    if (/^\/w\d+\/game\/[^/]+/.test(req.url)) {
      return "/";
    }
    return undefined;
  };

  return {
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./tests/setup.ts",
    },
    root: "./",
    base: isYa || isPlaygama ? "./" : "/", // ya/playgama — относительные пути
    publicDir: isProduction ? false : "resources",

    resolve: {
      tsconfigPaths: true,
      alias: {
        resources: path.resolve(__dirname, "resources"),
      },
    },

    plugins: [
      coreHashFile(),
      ...(!isProduction
        ? [serveProprietaryDir(proprietaryDir, resourcesDir)]
        : []),
      // dev И офлайн-бандл заполняют шаблон index.html (BOOTSTRAP_CONFIG); чистый
      // прод — нет (рендерит сервер). В бандле gitCommit = 40 нулей (GameRecordSchema).
      ...(isPlaygama ? [playgamaHtml()] : []),
      ...(isBundle || isPlaygama
        ? [
            fillTemplate({
              gitCommit: JSON.stringify(
                "0000000000000000000000000000000000000000",
              ),
              ...htmlAssetData,
            }),
          ]
        : []),
      ...(!isProduction
        ? [
            createHtmlPlugin({
              minify: false,
              entry: "/src/client/Main.ts",
              template: "index.html",
              inject: {
                data: {
                  gitCommit: JSON.stringify("DEV"),
                  ...htmlAssetData,
                },
              },
            }),
          ]
        : []),
      ...(isProduction
        ? [
            // офлайн-бандл: CDN нет → пропускаем cdnBase-инжект (иначе в статике
            // остаётся неразрешённый <%- cdnBaseRaw %>); ассеты идут локально /assets/.
            ...(isBundle || isPlaygama ? [] : [injectCdnBaseTemplate()]),
            syncHashedPublicAssets(),
          ]
        : []),
      tailwindcss(),
    ],

    define: {
      __ASSET_MANIFEST__: JSON.stringify(assetManifest),
      // terron 30.08: ИГРОВОЙ ХОСТ, ВШИТЫЙ В СБОРКУ. Нужен там, где бандл лежит
      // на ЧУЖОМ хостинге (Playgama): `window.location.host` там — их домен, и
      // вебсокет уходил на `ws://<их-хост>/w0/lobbies`, то есть в никуда
      // (поймано живой проверкой сборки на локальном сервере). Пустая строка =
      // прежнее поведение «бери хост из адреса».
      __GAME_HOST__: JSON.stringify(isPlaygama ? (env.GAME_HOST || "terron.io") : ""),
      // Сборка ДЛЯ КОНКРЕТНОЙ ПЛОЩАДКИ. Пусто = обычный сайт/апка. Читают
      // PayGate (там своей платёжки быть не должно) и загрузчик их SDK.
      __PLATFORM_BUILD__: JSON.stringify(isPlaygama ? "playgama" : ""),
      // terron: время сборки клиента (для футера «last update … ago»)
      __BUILD_TIME__: JSON.stringify(Date.now()),
      // terron 28.09: отпечаток ЯДРА симуляции (хэш src/core). Сервер отдаёт в
      // старте матча отпечаток, на котором матч начался; не совпал с этим —
      // игрок загрузил новую сборку посреди матча, картина разойдётся.
      __CORE_HASH__: JSON.stringify(coreHash()),
      "process.env.WEBSOCKET_URL": JSON.stringify(
        isProduction ? "" : "localhost:3000",
      ),
      "process.env.GAME_ENV": JSON.stringify(isProduction ? "prod" : "dev"),
      "process.env.STRIPE_PUBLISHABLE_KEY": JSON.stringify(
        env.STRIPE_PUBLISHABLE_KEY,
      ),
      "process.env.API_DOMAIN": JSON.stringify(env.API_DOMAIN),
      // Add other process.env variables if needed, OR migrate code to import.meta.env
    },

    build: {
      outDir: isYa ? "static-ya" : isPlaygama ? "static-playgama" : "static",

      emptyOutDir: true,
      assetsDir: "assets", // Sub-directory for assets
      rollupOptions: {
        // terron ПЕРФ (21.08): воркер симуляции — ОТДЕЛЬНЫЙ entry, а не
        // `?worker&inline`. Инлайн вшивал 580 КБ base64-блоба в главный чанк
        // (−160 КБ gzip на критическом пути меню), а код ядра дублировался.
        // Второй entry делит чанки ядра с главным бандлом и грузится только
        // при входе в матч. Через `?worker` нельзя — rolldown падает на
        // эмиссии worker-чанка («Identifier `ps` has already been declared»).
        // ⚠️ ТОЛЬКО ДЛЯ СБОРКИ. При `npm run dev` второй entry ломал страницу
        // насмерть: vite-plugin-html при multi-entry теряет inject-данные
        // шаблона, и index.html падал на первой же подстановке
        // (`manifestHref is not defined`, ejs:327) — то есть локальная разработка
        // не работала вообще, а свежесклонированный репозиторий не запускался.
        // В dev второй entry не нужен: vite отдаёт модули напрямую, а WorkerClient
        // при отсутствии `assets/simworker.js` штатно уходит на blob-фолбэк.
        // Сборки (prod/ya/bundle) не затронуты — там command === "build".
        ...(command === "build"
          ? {
              input: {
                index: path.resolve(__dirname, "index.html"),
                simworker: path.resolve(
                  __dirname,
                  "src/core/worker/Worker.worker.ts",
                ),
              },
            }
          : {}),
        output: {
          // Имя воркера БЕЗ хэша: манифест ассетов для ya/bundle-режимов
          // собирается ДО бандла, так что хэш туда не положить; свежесть
          // обеспечивает `?v=__BUILD_TIME__` в WorkerClient.
          entryFileNames: (chunk) =>
            chunk.name === "simworker"
              ? "assets/simworker.js"
              : "assets/[name]-[hash].js",
          manualChunks: (id) => {
            const vendorModules = ["pixi.js", "howler", "zod"];
            if (vendorModules.some((module) => id.includes(module))) {
              return "vendor";
            }
          },
        },
      },
    },

    server: {
      port: 9000,
      host: process.env.VITE_HOST === "lan",
      // Automatically open the browser when the server starts
      open: process.env.SKIP_BROWSER_OPEN !== "true",
      proxy: {
        "/lobbies": {
          target: "ws://localhost:3000",
          ws: true,
          changeOrigin: true,
        },
        // Worker proxies
        "/w0": {
          target: "ws://localhost:3001",
          ws: true,
          secure: false,
          changeOrigin: true,
          bypass: (req) => devGameHtmlBypass(req),
          rewrite: (path) => path.replace(/^\/w0/, ""),
        },
        "/w1": {
          target: "ws://localhost:3002",
          ws: true,
          secure: false,
          changeOrigin: true,
          bypass: (req) => devGameHtmlBypass(req),
          rewrite: (path) => path.replace(/^\/w1/, ""),
        },
        // API proxies
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});


// terron 28.09: отпечаток ядра симуляции — хэш всех исходников src/core. Одна
// функция на клиент (define __CORE_HASH__) и на сервер (файл core-hash.txt
// рядом со статикой, его читает ServerEnv.coreHash). Правки интерфейса его не
// меняют — ложных тревог «версия матча другая» после patch-site не будет.
let coreHashCache: string | null = null;
function coreHash(): string {
  if (coreHashCache !== null) return coreHashCache;
  const root = path.resolve(__dirname, "src/core");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.ts$/.test(e.name)) files.push(f);
    }
  };
  walk(root);
  files.sort();
  const h = createHash("sha1");
  for (const f of files) {
    h.update(path.relative(root, f));
    h.update("\0");
    h.update(fs.readFileSync(f));
  }
  coreHashCache = h.digest("hex").slice(0, 16);
  return coreHashCache;
}

function coreHashFile(): Plugin {
  return {
    name: "terron-core-hash",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "core-hash.txt",
        source: coreHash(),
      });
    },
  };
}

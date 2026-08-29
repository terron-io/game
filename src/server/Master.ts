import cluster from "cluster";
import crypto from "crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { GameEnv } from "../core/configuration/Config";
import {
  TERRON_BALANCE_EPOCH,
  TERRON_BALANCE_LABEL,
} from "../core/configuration/TerronTuning";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { MasterLobbyService } from "./MasterLobbyService";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import {
  buildSitemapXml,
  clearAppShellContentCache,
  isKnownSpaRoute,
  ogLangFromUA,
  profileSlugFromPath,
  renderAppShell,
  wikiSeoFromPath,
} from "./RenderHtml";
import { clearRuntimeAssetManifestCache } from "./RuntimeAssetManifest";
import { disabledUltsFromEnv, ServerEnv } from "./ServerEnv";
import { applyStaticAssetCacheControl } from "./StaticAssetCache";

const playlist = new MapPlaylist();
let lobbyService: MasterLobbyService;

const app = express();
const server = http.createServer(app);

const log = logger.child({ comp: "m" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

// Serve the shared app shell for the root document.
app.use(async (req, res, next) => {
  if (req.path === "/") {
    try {
      await renderAppShell(
        res,
        path.join(__dirname, "../../static/index.html"),
        ogLangFromUA(req.headers["user-agent"]),
      );
    } catch (error) {
      log.error("Error rendering index.html:", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    next();
  }
});

app.use(
  express.static(path.join(__dirname, "../../static"), {
    maxAge: "1y", // Set max-age to 1 year for all static assets
    setHeaders: (res) => {
      applyStaticAssetCacheControl(
        res.setHeader.bind(res),
        res.req.originalUrl,
      );
    },
  }),
);

app.set("trust proxy", 3);
app.use(
  rateLimit({
    windowMs: 1000, // 1 second
    max: 20, // 20 requests per IP per second
  }),
);

app.use("/api", (_req, res, next) => {
  setNoStoreHeaders(res);
  next();
});

// Start the master process
export async function startMaster() {
  if (!cluster.isPrimary) {
    throw new Error(
      "startMaster() should only be called in the primary process",
    );
  }

  log.info(`Primary ${process.pid} is running`);
  log.info(`Setting up ${ServerEnv.numWorkers()} workers...`);

  lobbyService = new MasterLobbyService(playlist, log);

  // Generate admin token for worker authentication
  const ADMIN_TOKEN = crypto.randomBytes(16).toString("hex");
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;

  const INSTANCE_ID =
    ServerEnv.env() === GameEnv.Dev
      ? "DEV_ID"
      : crypto.randomBytes(4).toString("hex");
  process.env.INSTANCE_ID = INSTANCE_ID;

  log.info(`Instance ID: ${INSTANCE_ID}`);

  // Fork workers
  for (let i = 0; i < ServerEnv.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
      ADMIN_TOKEN,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(i, worker);
    log.info(`Started worker ${i} (PID: ${worker.process.pid})`);
  }

  // Handle worker crashes
  cluster.on("exit", (worker, code, signal) => {
    const workerId = (worker as any).process?.env?.WORKER_ID;
    if (workerId === undefined) {
      log.error(`worker crashed could not find id`);
      return;
    }

    const workerIdNum = parseInt(workerId);
    lobbyService.removeWorker(workerIdNum);

    log.warn(
      `Worker ${workerId} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`,
    );
    log.info(`Restarting worker ${workerId}...`);

    // Restart the worker with the same ID
    const newWorker = cluster.fork({
      WORKER_ID: workerId,
      ADMIN_TOKEN,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(workerIdNum, newWorker);
    log.info(
      `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
    );
  });

  const PORT = 3000;
  server.listen(PORT, () => {
    log.info(`Master HTTP server listening on port ${PORT}`);
  });
}

// terron: версия сборки игрового сервера. Публичный и дешёвый — чтобы можно
// было ответить «что сейчас крутится на проде/деве» без ssh: коммит (он же в
// архиве матча), эпоха баланса (по ней делится спидран-топ) и окружение.
// Клиентский бандл едет из этого же образа, отдельного номера у него нет —
// его версия = тот же gitCommit.
app.get("/api/version", (_req, res) => {
  setNoStoreHeaders(res);
  res.json({
    service: "game",
    env: ServerEnv.env(),
    gitCommit: ServerEnv.gitCommit(),
    balanceEpoch: TERRON_BALANCE_EPOCH,
    balanceLabel: TERRON_BALANCE_LABEL,
    // terron 24.08: рубильник раскатки ульт — карта /ults скрывает эти узлы.
    // На dev пусто (disabledUltsFromEnv возвращает [] при TERRON_ENV=dev).
    disabledUlts: disabledUltsFromEnv(),
  });
});

app.get("/api/health", (_req, res) => {
  const ready = lobbyService?.isHealthy() ?? false;
  if (ready) {
    res.json({ status: "ok" });
  } else {
    res.status(503).json({ status: "unavailable" });
  }
});

// terron: горячая перезагрузка app-shell БЕЗ рестарта процесса (фронт-деплой через
// patch-site без выкидывания игроков). Сбрасывает кеш отрендеренного index.html и
// asset-манифеста — следующий запрос «/» перечитает новый index.html с диска.
// Защита: заголовок x-api-key == API_KEY (внутренний, наружу не светим).
app.post("/api/reload-shell", (req, res) => {
  const key = req.get("x-api-key");
  if (!ServerEnv.apiKey() || key !== ServerEnv.apiKey()) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  clearAppShellContentCache();
  clearRuntimeAssetManifestCache();
  log.info("app-shell cache cleared via /api/reload-shell");
  res.json({ status: "reloaded" });
});

// terron: бикон загрузки клиента — детект «сорвался на входе» (первые байты HTML
// пришли, но игра так и не поднялась: DPI-throttle, из-за которого часть РФ не
// заходит без VPN). boot летит инлайн из <head> (первые байты), ready — из бандла
// (Main.initialize). Дроп = boot без ready. Реальный IP берём здесь (гейм-сервер
// за nginx→Caddy) и форвардим в platform-api, он геолоцирует. Страница /admin/ru-ban.
// Отдаём 1×1 gif, чтобы <img>-бикон на клиенте не ловил onerror.
const LB_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
// Близнец Worker.ts getClientIp (та же цепочка nginx→Caddy: предпоследний XFF =
// реальный клиент). Держать синхронно — при смене числа прокси-хопов править оба.
function lbNormalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/i, "").trim();
}
function lbClientIp(req: express.Request): string {
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp) return lbNormalizeIp(cfIp);
  const xffRaw = req.headers["x-forwarded-for"];
  const xff = Array.isArray(xffRaw) ? xffRaw.join(",") : xffRaw;
  if (typeof xff === "string" && xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) return lbNormalizeIp(parts[parts.length - 2]);
    if (parts.length === 1) return lbNormalizeIp(parts[0]);
  }
  return lbNormalizeIp(req.socket.remoteAddress ?? "unknown");
}
const LB_STAGES = new Set(["boot", "ready", "probe_small", "probe_large"]);
app.get("/api/lb", (req, res) => {
  const sid = typeof req.query.s === "string" ? req.query.s.slice(0, 40) : "";
  const e = typeof req.query.e === "string" ? req.query.e : "";
  const stage = LB_STAGES.has(e) ? e : "boot";
  // d = elapsed ms зонда (для probe_large — время докачки 256КБ).
  const ms =
    typeof req.query.d === "string"
      ? Math.min(600_000, Math.max(0, parseInt(req.query.d, 10) || 0))
      : null;
  if (sid && ServerEnv.apiKey()) {
    const ip = lbClientIp(req);
    const ua = req.headers["user-agent"] ?? null;
    void fetch(`${ServerEnv.jwtIssuer()}/internal/loadbeacon`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
      body: JSON.stringify({ sid, stage, ip, ua, ms }),
    }).catch(() => {
      /* fire-and-forget: аналитика не должна ничего ронять */
    });
  }
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store");
  res.end(LB_GIF);
});

// terron: зонд полосы для детекта РФ-throttle. Отдаёт sz КБ НЕСЖИМАЕМЫХ (random)
// байт с того же origin (тот же SNI → тот же DPI-throttle, что и бандл). small
// (~4КБ) просачивается сквозь замедление, large (~256КБ) — нет. no-store +
// клиентский ?r= обходят кеш; random не жмётся nginx-ом. Разбор: loadFunnel.ts.
app.get("/api/lbprobe", (req, res) => {
  const kb = Math.min(
    512,
    Math.max(1, parseInt(String(req.query.sz), 10) || 4),
  );
  const buf = crypto.randomBytes(kb * 1024);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", String(buf.length));
  res.end(buf);
});

// terron: статические страницы по чистым адресам — вход по логину/паролю (для
// ревьюеров/модерации) и удаление аккаунта. Файлы лежат в static/ (см.
// ROOT_PUBLIC_FILES). Эти GET идут ДО SPA-fallback, иначе /account/* перехватывал
// бы клиентский роутер (модалка аккаунта) и страница «ломалась».
// /account/delete отдаёт SPA (designed-страница в account-flow, только для
// залогиненных). /account-delete остаётся статикой — публичная версия (Google
// Play требует доступную без логина страницу удаления).
const STATIC_PAGES: Record<string, string> = {
  "/account/password": "password-login.html",
  "/password-login": "password-login.html",
  "/account-delete": "account-delete.html",
  // terron: гайд по ошибке «WebGL2 not supported» — чистая статика (у юзера как
  // раз не работает WebGL, страница должна открыться без него). Ссылка из модалки.
  "/webgl2-not-supported": "webgl2-not-supported.html",
  // terron: зонд графики — собирает варианты проблемного шейдера прямо у игрока
  // и называет причину отказа. Тоже чистая статика: страница обязана работать
  // тогда, когда игра как раз и не запускается.
  "/debug": "debug.html",
};
for (const [route, file] of Object.entries(STATIC_PAGES)) {
  app.get(route, (_req, res) => {
    res.sendFile(path.join(__dirname, "../../static", file));
  });
}

// Настоящий sitemap.xml — ДО SPA-fallback, иначе fallback отдаёт HTML-шелл (200)
// вместо XML-карты сайта.
app.get("/sitemap.xml", function (_req, res) {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(buildSitemapXml());
});

// SPA fallback route
app.get("/{*splat}", async function (req, res) {
  try {
    const htmlPath = path.join(__dirname, "../../static/index.html");
    // Неизвестный путь → корректный 404 (не soft-200). Шелл всё равно рендерим,
    // чтобы человек по битой ссылке увидел приложение (клиент покажет «не
    // найдено»), но статус 404 — краулеры не индексируют мусор и дубли.
    if (!isKnownSpaRoute(req.path)) {
      res.status(404);
    }
    const wikiSeo = wikiSeoFromPath(req.path);
    await renderAppShell(
      res,
      htmlPath,
      ogLangFromUA(req.headers["user-agent"]),
      wikiSeo ? undefined : profileSlugFromPath(req.path),
      wikiSeo,
    );
  } catch (error) {
    log.error("Error rendering SPA fallback:", error);
    res.status(500).send("Internal Server Error");
  }
});

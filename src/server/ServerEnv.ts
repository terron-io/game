import { JWK } from "jose";
import { z } from "zod";
import { GameEnv, parseGameEnv } from "../core/configuration/Config";
import {
  diamondRewardPts,
  diamondScheduleLabel,
  goldenPeriodMin,
  setDiamondDaily,
  setDiamondEvery,
  setDiamondRewardPts,
  setGoldenPeriodMin,
  TERRON_LOBBY_START_SECONDS,
} from "../core/configuration/TerronTuning";
import { GameID } from "../core/Schemas";
import { simpleHash } from "../core/Util";

const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});

export class ServerEnv {
  private static readonly gameEnv: GameEnv = parseGameEnv(process.env.GAME_ENV);
  private static publicKey: JWK | null = null;

  // Values that also flow to the client via index.html, but on the server
  // are read from process.env directly. Server code never reaches into
  // ClientEnv — that's reserved for the browser/worker hydrated path.
  //
  // TODO: the following methods are duplicated on ClientEnv. The two classes
  // read from different sources (process.env vs window.BOOTSTRAP_CONFIG) but
  // the derived logic is identical. Consolidate into a shared helper that
  // takes a source so we don't have to keep them in sync by hand.
  static env(): GameEnv {
    return ServerEnv.gameEnv;
  }
  static gameEnvName(): string {
    switch (ServerEnv.gameEnv) {
      case GameEnv.Dev:
        return "dev";
      case GameEnv.Preprod:
        return "staging";
      case GameEnv.Prod:
        return "prod";
    }
  }
  static numWorkers(): number {
    const raw = process.env.NUM_WORKERS;
    if (!raw) {
      throw new Error("NUM_WORKERS not set");
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Invalid NUM_WORKERS: ${raw}`);
    }
    return n;
  }
  static turnstileSiteKey(): string {
    const v = process.env.TURNSTILE_SITE_KEY;
    if (!v) {
      throw new Error("TURNSTILE_SITE_KEY not set");
    }
    return v;
  }
  static jwtAudience(): string {
    const v = process.env.DOMAIN;
    if (!v) {
      throw new Error("DOMAIN not set");
    }
    return v;
  }
  static instanceId(): string {
    return process.env.INSTANCE_ID ?? "";
  }
  static workerId(): number | undefined {
    const raw = process.env.WORKER_ID;
    if (raw === undefined) return undefined;
    return parseInt(raw, 10);
  }
  static hostname(): string {
    return process.env.HOSTNAME ?? "";
  }
  static host(): string {
    return process.env.HOST ?? "";
  }
  static cdnBase(): string {
    return process.env.CDN_BASE ?? "";
  }
  static jwtIssuer(): string {
    const audience = ServerEnv.jwtAudience();
    return audience === "localhost"
      ? "http://localhost:8787"
      : `https://api.${audience}`;
  }
  static async jwkPublicKey(): Promise<JWK> {
    if (ServerEnv.publicKey) return ServerEnv.publicKey;
    const jwksUrl = ServerEnv.jwtIssuer() + "/.well-known/jwks.json";
    console.log(`Fetching JWKS from ${jwksUrl}`);
    const response = await fetch(jwksUrl);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`JWKS fetch failed: ${response.status} ${body}`);
    }
    const result = JwksSchema.safeParse(await response.json());
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Error parsing JWKS", error);
      throw new Error("Invalid JWKS");
    }
    ServerEnv.publicKey = result.data.keys[0];
    return ServerEnv.publicKey;
  }
  static turnIntervalMs(): number {
    return 100;
  }
  static gameCreationRate(): number {
    // terron: время в лобби до старта — см. TerronTuning.
    return TERRON_LOBBY_START_SECONDS * 1000;
  }
  static workerIndex(gameID: GameID): number {
    return simpleHash(gameID) % ServerEnv.numWorkers();
  }
  static workerPath(gameID: GameID): string {
    return `w${ServerEnv.workerIndex(gameID)}`;
  }
  static workerPort(gameID: GameID): number {
    return ServerEnv.workerPortByIndex(ServerEnv.workerIndex(gameID));
  }
  static workerPortByIndex(index: number): number {
    return 3001 + index;
  }

  // Server-only env values
  static domain(): string {
    return process.env.DOMAIN ?? "";
  }
  static subdomain(): string {
    return process.env.SUBDOMAIN ?? "";
  }
  static otelEnabled(): boolean {
    return (
      ServerEnv.gameEnv !== GameEnv.Dev &&
      Boolean(ServerEnv.otelEndpoint()) &&
      Boolean(ServerEnv.otelAuthHeader())
    );
  }
  static otelEndpoint(): string {
    return process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "";
  }
  static otelAuthHeader(): string {
    return process.env.OTEL_AUTH_HEADER ?? "";
  }
  static gitCommit(): string {
    const v = process.env.GIT_COMMIT;
    if (!v) {
      throw new Error("GIT_COMMIT not set");
    }
    return v;
  }
  static apiKey(): string {
    return process.env.API_KEY ?? "";
  }
  static adminHeader(): string {
    return "x-admin-key";
  }
  static adminToken(): string {
    const token = process.env.ADMIN_TOKEN;
    if (!token) {
      throw new Error("ADMIN_TOKEN not set");
    }
    return token;
  }
  static allowedFlares(): string[] | undefined {
    const raw = process.env.ALLOWED_FLARES;
    if (!raw) return undefined;
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}

/**
 * terron: РАСПИСАНИЕ СОБЫТИЙ ИЗ ОКРУЖЕНИЯ — чтобы менять время БЕЗ ПЕРЕСБОРКИ
 * (требование владельца 10.08). Читается на импорте модуля, то есть и в мастере,
 * и в воркере; правка = `docker compose up -d game[-dev]`, секунды вместо билда.
 *
 *   TERRON_DIAMOND_AT="20:00"     раз в сутки в 20:00 ПО МОСКВЕ (дефолт)
 *   TERRON_DIAMOND_AT="*30"       каждые 30 минут — режим обкатки
 *   TERRON_DIAMOND_REWARD="30"    награда победителю, ПТС (дефолт 100)
 *   TERRON_GOLDEN_PERIOD_MIN="10" период золотого в минутах (дефолт 10)
 *
 * Мусор в переменной НЕ роняет сервер: пишем в лог и живём на дефолте — падать
 * из-за опечатки в compose нельзя, лобби нужны всегда.
 */
export function applyEventScheduleFromEnv(): void {
  // TERRON_DIAMOND_AT: "20:00" — раз в сутки по Москве; "*30" или "30m" — каждые N минут.
  const at = process.env.TERRON_DIAMOND_AT?.trim();
  if (at) {
    try {
      const every = /^(?:\*\/?|every )?(\d{1,3})\s*(?:m|min|мин)?$/i.exec(at);
      const daily = /^(\d{1,2}):(\d{2})$/.exec(at);
      if (daily) {
        setDiamondDaily(Number(daily[1]), Number(daily[2]));
      } else if (every) {
        setDiamondEvery(Number(every[1]));
      } else {
        throw new Error("не ЧЧ:ММ и не *N");
      }
    } catch (e) {
      console.warn(
        `[terron] TERRON_DIAMOND_AT="${at}" не понял (${e}), оставляю ${diamondScheduleLabel()}`,
      );
    }
  }
  const reward = process.env.TERRON_DIAMOND_REWARD?.trim();
  if (reward) {
    try {
      setDiamondRewardPts(Number(reward));
    } catch (e) {
      console.warn(
        `[terron] TERRON_DIAMOND_REWARD="${reward}" не понял (${e}), оставляю ${diamondRewardPts()}`,
      );
    }
  }
  const period = process.env.TERRON_GOLDEN_PERIOD_MIN?.trim();
  if (period) {
    try {
      setGoldenPeriodMin(Number(period));
    } catch (e) {
      console.warn(
        `[terron] TERRON_GOLDEN_PERIOD_MIN="${period}" не понял (${e}), оставляю ${goldenPeriodMin()} мин`,
      );
    }
  }
  console.log(
    `[terron] расписание событий: алмазный ${diamondScheduleLabel()} за ${diamondRewardPts()} ПТС, золотой раз в ${goldenPeriodMin()} мин`,
  );
}

applyEventScheduleFromEnv();

/**
 * terron 24.08: РУБИЛЬНИК ПОЭТАПНОЙ РАСКАТКИ УЛЬТ (решение владельца:
 * «сначала карта с тем, что уже на проде, потом по одной включаем»).
 *
 * TERRON_DISABLED_ULTS — строки UnitType через запятую, напр.
 * "Rail Gun,Train Depot". Выключенные юниты сервер принудительно вливает в
 * disabledUnits конфига КАЖДОГО матча (GameServer.enforceUltimateGate) — сим и
 * чузер гейтят их сами, — а карта /ults скрывает их узлы (список едет клиенту
 * в /api/version). Включить ульту на проде = убрать из .env + up -d game,
 * 2 секунды без пересборки.
 *
 * На DEV (TERRON_ENV=dev) рубильник не действует: дев видит и играет всё.
 * Мусор в переменной не роняет сервер — неизвестные имена в лог и мимо.
 */
export function disabledUltsFromEnv(): string[] {
  if (process.env.TERRON_ENV === "dev") return [];
  const raw = process.env.TERRON_DISABLED_ULTS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

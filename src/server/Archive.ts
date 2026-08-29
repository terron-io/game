import z from "zod";
import {
  TERRON_BALANCE_EPOCH,
  TERRON_BALANCE_LABEL,
} from "../core/configuration/TerronTuning";
import { GameType } from "../core/game/Game";
import {
  GameID,
  GameRecord,
  GameRecordSchema,
  ID,
  PartialGameRecord,
} from "../core/Schemas";
import { replacer } from "../core/Util";
import { logger } from "./Logger";
import { ServerEnv } from "./ServerEnv";

const log = logger.child({ component: "Archive" });

// terron: ЗАМКИ НА УЛЬТЫ — какие ЗАКРЫТЫЕ ульты открыты у аккаунта с этим
// persistentID (для залогиненного pid = users.id). null = API недоступен
// (вызывающий решает fail-open). Анониму API отдаёт пустой список.
export async function fetchUnlockedUlts(
  persistentId: string,
): Promise<string[] | null> {
  try {
    const url = `${ServerEnv.jwtIssuer()}/ults/unlocked/${encodeURIComponent(persistentId)}`;
    const response = await fetch(url, {
      headers: { "x-api-key": ServerEnv.apiKey() },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      log.warn(`ults unlocked lookup failed: ${response.status}`);
      return null;
    }
    const j = (await response.json()) as { ults?: string[] };
    return Array.isArray(j.ults) ? j.ults : [];
  } catch (e) {
    log.warn(`ults unlocked lookup error: ${String(e)}`);
    return null;
  }
}

// terron: in-game приглашение в клан. Гейм-сервер знает persistentID игроков
// (клиенты — нет), поэтому зовёт platform-api он, по persistentID. Лидерство
// и анон-pending проверяет platform-api. Fire-and-forget.
export type ClanInviteByPidResult = {
  status:
    | "invited"
    | "already_invited"
    | "pending"
    | "already_member"
    | "forbidden"
    | "not_found"
    | "error";
  clanName?: string;
};

export async function inviteToClanByPid(
  clanTag: string,
  inviterPersistentId: string,
  targetPersistentId: string,
): Promise<ClanInviteByPidResult> {
  try {
    const url = `${ServerEnv.jwtIssuer()}/clans/invite/by-pid`;
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        clanTag,
        inviterPersistentId,
        targetPersistentId,
      }),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    if (!response.ok) {
      log.warn(`clan invite by-pid failed: ${response.status}`, { clanTag });
      return { status: "error" };
    }
    const j = (await response.json()) as {
      status?: ClanInviteByPidResult["status"];
      clanName?: string | null;
    };
    return { status: j.status ?? "error", clanName: j.clanName ?? undefined };
  } catch (e) {
    log.warn(`clan invite by-pid error: ${String(e)}`, { clanTag });
    return { status: "error" };
  }
}

// terron: in-game заявка в друзья по persistentID (как clan invite). Гейм-сервер
// резолвит pid обоих и зовёт platform-api. Возвращает статус + id заявки (для
// пересылки адресату) + имя цели (для тоста отправителю). См. friends.md.
export type FriendRequestByPidResult = {
  status:
    | "sent"
    | "already_friends"
    | "already_pending"
    | "limit_reached"
    | "self"
    | "auto_accepted"
    | "target_not_found"
    | "error";
  requestId?: string;
  targetName?: string;
};

export async function friendRequestByPid(
  requesterPid: string,
  targetPid: string,
  gameId: string,
): Promise<FriendRequestByPidResult> {
  try {
    const url = `${ServerEnv.jwtIssuer()}/friends/request/by-pid`;
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ requesterPid, targetPid, gameId }),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    if (!response.ok) {
      log.warn(`friend request by-pid failed: ${response.status}`);
      return { status: "error" };
    }
    const j = (await response.json()) as {
      status?: FriendRequestByPidResult["status"];
      requestId?: string | null;
      targetName?: string | null;
    };
    return {
      status: j.status ?? "error",
      requestId: j.requestId ?? undefined,
      targetName: j.targetName ?? undefined,
    };
  } catch (e) {
    log.warn(`friend request by-pid error: ${String(e)}`);
    return { status: "error" };
  }
}

/**
 * terron 30.07: НАГРАДА СРАЗУ ПОСЛЕ СМЕРТИ. Раньше начисление жило только на
 * архиве матча — а он уезжает в конце партии, поэтому съеденный на третьей
 * минуте видел на экране смерти пустое место вместо заработка (и не мог
 * удвоить его рекламой). К моменту смерти результат игрока окончателен, так
 * что ждать нечего.
 *
 * Время (`turn`) берёт СЕРВЕР — оно у него точное. Съеденных присылает клиент;
 * API капит их по составу лобби, как уже делает для архива. Начисление
 * идемпотентно по (reason='match', ref=gameId): архив, приехав следом, ничего
 * не задвоит.
 */
export async function reportDeath(
  gameId: string,
  body: {
    clientID: string;
    persistentID: string;
    username: string | null;
    turn: number;
    eatenNations: number;
    eatenPlayers: number;
    // terron 01.08: карта/режим идущего матча — смерть приходит ПОСРЕДИ партии
    // и создаёт строку games раньше архива. Без них в досье строка матча висела
    // с прочерком вместо карты до конца партии.
    map?: string | null;
    mode?: string | null;
  },
): Promise<void> {
  try {
    const url = `${ServerEnv.jwtIssuer()}/game/${gameId}/death`;
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    if (!response.ok) {
      log.warn(`death report failed: ${response.status}`, { gameId });
    }
  } catch (e) {
    log.warn(`death report error: ${String(e)}`);
  }
}

// terron: резолв досье игрока по persistentID. Клиент знает игрока лишь по
// clientID; гейм-сервер резолвит pid → users.slug и отдаёт клиенту (кнопка
// «Досье» открывает /@slug). slug=null → аноним/нет аккаунта. См. friends.md.
export async function profileByPid(
  persistentId: string,
): Promise<{ slug: string | null; name: string | null }> {
  try {
    const url = `${ServerEnv.jwtIssuer()}/profile/by-pid`;
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ pid: persistentId }),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    if (!response.ok) return { slug: null, name: null };
    const j = (await response.json()) as {
      slug?: string | null;
      name?: string | null;
    };
    return { slug: j.slug ?? null, name: j.name ?? null };
  } catch (e) {
    log.warn(`profile by-pid error: ${String(e)}`);
    return { slug: null, name: null };
  }
}

// terron: in-game жалоба на игрока по persistentID. Клиент знает игрока только
// по clientID; гейм-сервер резолвит pid и зовёт platform-api. Best-effort.
export async function reportPlayerByPid(
  reporterPersistentId: string,
  targetPersistentId: string,
  targetName: string,
  gameId: string,
  reason: string,
): Promise<void> {
  try {
    const url = `${ServerEnv.jwtIssuer()}/moderation/report/by-pid`;
    await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        reporterPersistentId,
        targetPersistentId,
        targetName,
        gameId,
        reason,
      }),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    });
  } catch (e) {
    log.warn(`report by-pid error: ${String(e)}`);
  }
}

// terron ПЕРФ (21.08): archive() звался из WS-хендлера/тика и СИНХРОННО
// делал zod-парс ВСЕЙ записи (десятки тысяч ходов) + JSON.stringify с replacer
// — сотни мс стопора для всех матчей воркера. Теперь: (1) валидируем запись
// БЕЗ ходов (ходы собирает сам сервер из уже провалидированных интентов);
// (2) сериализация + POST уходят в setImmediate — вызывающий хендлер
// возвращается сразу; (3) если переданы готовые JSON-строки ходов
// (`turnsJson`, 1:1 с gameRecord.turns), тело собирается склейкой, а не
// повторным stringify. Порядок ключей в теле другой (turns — последним),
// для API-парсера это не значимо. Ошибки/логи — как прежде.
export function archive(
  gameRecord: GameRecord,
  trustedCosmeticFlagUrls: Set<string> = new Set(),
  turnsJson?: string[],
): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      archiveNow(gameRecord, trustedCosmeticFlagUrls, turnsJson).then(
        resolve,
        resolve,
      );
    });
  });
}

/** Тело архива: запись без ходов через replacer (bigint), ходы — склейкой. */
export function archiveBody(
  gameRecord: GameRecord,
  turnsJson?: string[],
): string {
  if (turnsJson === undefined || turnsJson.length !== gameRecord.turns.length) {
    return JSON.stringify(gameRecord, replacer);
  }
  const { turns: _turns, ...rest } = gameRecord;
  const head = JSON.stringify(rest, replacer);
  return (
    head.slice(0, -1) +
    (head.length > 2 ? "," : "") +
    '"turns":[' +
    turnsJson.join(",") +
    "]}"
  );
}

async function archiveNow(
  gameRecord: GameRecord,
  trustedCosmeticFlagUrls: Set<string>,
  turnsJson: string[] | undefined,
): Promise<void> {
  try {
    if (gameRecord.info.config.gameType === GameType.Singleplayer) {
      stripUntrustedFlagUrls(gameRecord, trustedCosmeticFlagUrls);
    }

    // Валидируем без ходов: массив ходов подменяем пустым, сами ходы не трогаем.
    const parsed = GameRecordSchema.safeParse({ ...gameRecord, turns: [] });
    if (!parsed.success) {
      log.error(`invalid game record: ${z.prettifyError(parsed.error)}`, {
        gameID: gameRecord.info.gameID,
      });
      return;
    }
    const url = `${ServerEnv.jwtIssuer()}/game/${gameRecord.info.gameID}`;
    const response = await fetch(url, {
      method: "POST",
      body: archiveBody(gameRecord, turnsJson),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
        // terron: ачивка «Тестер» — дев-сервер помечает свои архивы
        // (env TERRON_ENV=dev стоит ТОЛЬКО в compose у terron-game-dev;
        // GAME_ENV не годится — он dev у ОБОИХ контуров).
        "x-terron-env": process.env.TERRON_ENV ?? "prod",
      },
    });
    if (!response.ok) {
      log.error(`error archiving game record: ${response.statusText}`, {
        gameID: gameRecord.info.gameID,
      });
      return;
    }
  } catch (error) {
    log.error(`error archiving game record: ${error}`, {
      gameID: gameRecord.info.gameID,
    });
    return;
  }
}

export async function readGameRecord(
  gameId: GameID,
): Promise<GameRecord | null> {
  try {
    if (!ID.safeParse(gameId).success) {
      log.error(`invalid game ID: ${gameId}`);
      return null;
    }
    const url = `${ServerEnv.jwtIssuer()}/game/${gameId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    const record = await response.json();
    if (!response.ok) {
      log.error(`error reading game record: ${response.statusText}`, {
        gameID: gameId,
      });
      return null;
    }
    return GameRecordSchema.parse(record);
  } catch (error) {
    log.error(`error reading game record: ${error}`, {
      gameID: gameId,
    });
    return null;
  }
}

// terron: снять публичное пользовательское лобби с витрины главной (platform-api
// in-memory реестр /lobbies/public). Зовётся АВТОРИТЕТНО игровым сервером в момент
// старта игры (prestart) — надёжнее клиентского DELETE (хост мог отвалиться), и
// решает «зашёл в уже стартовавший матч, спавн закрыт» (репорт 17.07). Fire-and-
// forget: витрина не критична, ошибку глотаем.
export function removePublicLobby(gameId: GameID): void {
  try {
    const url = `${ServerEnv.jwtIssuer()}/lobbies/public/${encodeURIComponent(gameId)}`;
    void fetch(url, {
      method: "DELETE",
      headers: { "x-api-key": ServerEnv.apiKey() },
    }).catch(() => {});
  } catch {
    /* витрина не критична */
  }
}

export function finalizeGameRecord(
  clientRecord: PartialGameRecord,
): GameRecord {
  return {
    ...clientRecord,
    gitCommit: ServerEnv.gitCommit(),
    subdomain: ServerEnv.subdomain(),
    domain: ServerEnv.domain(),
    // terron: эпоха баланса СЕРВЕРНОЙ сборки — источник истины для деления
    // спидран-топа на актуальный/архив (см. TerronTuning.TERRON_BALANCE_EPOCH).
    // Ставим и на записи одиночной игры, присланные клиентом: значение всё
    // равно берётся из серверного билда, а не из тела запроса.
    balanceEpoch: TERRON_BALANCE_EPOCH,
    balanceLabel: TERRON_BALANCE_LABEL,
  };
}

function stripUntrustedFlagUrls(
  gameRecord: GameRecord,
  trustedCosmeticFlagUrls: Set<string>,
): void {
  for (const player of gameRecord.info.players) {
    const flag = player.cosmetics?.flag;
    if (
      flag === undefined ||
      !/^https?:\/\//i.test(flag) ||
      trustedCosmeticFlagUrls.has(flag)
    ) {
      continue;
    }
    log.warn("dropping untrusted singleplayer replay flag", {
      gameID: gameRecord.info.gameID,
      clientID: player.clientID,
    });
    player.cosmetics!.flag = undefined;
  }
}

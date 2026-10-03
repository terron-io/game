import { GameConfig, GameID, PartialGameRecord } from "../core/Schemas";
import { replacer } from "../core/Util";

export interface LocalStatsData {
  [key: GameID]: {
    lobby: Partial<GameConfig>;
    // Only once the game is over
    gameRecord?: PartialGameRecord;
  };
}

let _startTime: number;

const KEY = "game-records";

function getStats(): LocalStatsData {
  try {
    const statsStr = localStorage.getItem(KEY);
    return statsStr ? JSON.parse(statsStr) : {};
  } catch {
    // битая запись / хранилище недоступно — начинаем с чистого листа
    return {};
  }
}

// terron 04.09: запись росла бесконечно (по объекту на КАЖДЫЙ матч за жизнь
// устройства) и однажды упиралась в квоту — «QuotaExceededError … 'game-records'»
// летел из setTimeout НЕОБРАБОТАННЫМ (js_error, 3 сессии/3 дня). Теперь при
// отказе выбрасываем старшую половину записей (ключи объекта хранят порядок
// вставки) и пробуем ещё раз; не вышло — молчим, это локальная справка.
function save(stats: LocalStatsData) {
  // To execute asynchronously
  setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(stats, replacer));
    } catch {
      const ids = Object.keys(stats);
      if (ids.length <= 1) return;
      for (const id of ids.slice(0, Math.ceil(ids.length / 2))) {
        delete stats[id];
      }
      try {
        localStorage.setItem(KEY, JSON.stringify(stats, replacer));
      } catch {
        /* квота даже для половины — сдаёмся */
      }
    }
  }, 0);
}

// The user can quit the game anytime so better save the lobby as soon as the
// game starts.
export function startGame(id: GameID, lobby: Partial<GameConfig>) {
  if (localStorage === undefined) {
    return;
  }

  _startTime = Date.now();
  const stats = getStats();
  stats[id] = { lobby };
  save(stats);
}

export function startTime() {
  return _startTime;
}

export function endGame(gameRecord: PartialGameRecord) {
  if (localStorage === undefined) {
    return;
  }

  const stats = getStats();
  const gameStat = stats[gameRecord.info.gameID];

  if (!gameStat) {
    console.log("LocalPersistantStats: game not found");
    return;
  }

  gameStat.gameRecord = gameRecord;
  save(stats);
}

// terron 23.09: ЧЕСТНЫЙ БОТ — уровень РЕШЕНИЙ не зависит от сложности лобби.
//
// Поведения наций, которые бот переиспользует (атака, стройка, ядерки, флот,
// союзы), читают `game.config().gameConfig().difficulty` и на Medium играют
// заметно ленивее. Публичное FFA идёт на Medium, а бот обязан конкурировать со
// средним игроком (решение владельца 23.09: «не надо ослаблять»). Поэтому его
// поведения видят игру через этот вид, где сложность всегда FAIR_BOT_DIFFICULTY.
//
// ⚠️ Это ТОЛЬКО решения. Ресурсы бота сложность не трогает вовсе: он игрок типа
// Human, а Config считает прирост/потолок/доход по САМОЙ игре (свой _gameConfig),
// мимо этого вида. Проверяет tests/FairBot.test.ts.
import { Difficulty, Game } from "../../game/Game";
import { GameConfig } from "../../Schemas";

export const FAIR_BOT_DIFFICULTY = Difficulty.Hard;

/**
 * Прокси, где сменён ровно один ответ: `config().gameConfig().difficulty`.
 * Всё остальное — та же игра: методы привязаны к настоящему объекту, поэтому
 * внутренние вызовы игры в прокси не ходят. Та же сложность, что у лобби, —
 * отдаём игру как есть (без прокси и без его цены).
 */
export function gameWithBotDifficulty(game: Game): Game {
  const real = game.config();
  if (real.gameConfig().difficulty === FAIR_BOT_DIFFICULTY) return game;

  let cached: GameConfig | null = null;
  let cachedFrom: GameConfig | null = null;
  const gameConfig = (): GameConfig => {
    const src = real.gameConfig();
    if (cachedFrom !== src) {
      cachedFrom = src;
      cached = { ...src, difficulty: FAIR_BOT_DIFFICULTY };
    }
    return cached!;
  };
  const config = bindProxy(real, { gameConfig });
  return bindProxy(game, { config: () => config });
}

function bindProxy<T extends object>(
  target: T,
  overrides: Record<string, unknown>,
): T {
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop === "string" && prop in overrides) {
        return overrides[prop];
      }
      const hit = bound.get(prop);
      if (hit !== undefined) return hit;
      const v = Reflect.get(t, prop, t);
      if (typeof v !== "function") return v;
      const fn = (v as (...a: unknown[]) => unknown).bind(t);
      bound.set(prop, fn);
      return fn;
    },
  });
}

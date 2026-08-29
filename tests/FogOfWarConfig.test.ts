/**
 * terron: туман войны — опция лобби fogOfWar в GameConfig.
 * Проверяем схему (опциональное поле, обратная совместимость) и аксессор
 * Config.fogOfWar() (default false). Сам туман — клиентский рендер,
 * симуляцию не трогает.
 */
import { Game } from "../src/core/game/Game";
import { GameConfigSchema } from "../src/core/Schemas";
import { setup } from "./util/Setup";

describe("fogOfWar game config", () => {
  test("GameConfigSchema accepts fogOfWar and keeps it optional", async () => {
    const game: Game = await setup("plains");
    const base = { ...game.config().gameConfig() };

    // Без поля (старые клиенты/сервер) — валидно.
    delete (base as Record<string, unknown>).fogOfWar;
    expect(GameConfigSchema.safeParse(base).success).toBe(true);

    // С полем — валидно и сохраняется.
    const withFog = GameConfigSchema.safeParse({ ...base, fogOfWar: true });
    expect(withFog.success).toBe(true);
    if (withFog.success) {
      expect(withFog.data.fogOfWar).toBe(true);
    }
  });

  test("Config.fogOfWar() defaults to false and follows the option", async () => {
    const offGame: Game = await setup("plains");
    expect(offGame.config().fogOfWar()).toBe(false);

    const onGame: Game = await setup("plains", { fogOfWar: true });
    expect(onGame.config().fogOfWar()).toBe(true);
  });
});

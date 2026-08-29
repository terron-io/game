import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import {
  PLAYER_INDEX_BOT,
  PLAYER_INDEX_HUMAN,
  PLAYER_INDEX_NATION,
} from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

// terron: союзы пишутся в PlayerStats.alliances у ЛЮДЕЙ, индекс по типу союзника
// (человек/нация/племя). Питают статистику профиля и ачивки «Друг племени/нации».
const humanInfo = new PlayerInfo("human", PlayerType.Human, "humanC", "human");
const human2Info = new PlayerInfo("human2", PlayerType.Human, "human2C", "human2");
const botInfo = new PlayerInfo("bot", PlayerType.Bot, null, "bot");
const nationInfo = new PlayerInfo("nation", PlayerType.Nation, null, "nation");

describe("AllianceStats", () => {
  let game: Game;
  let human: Player;
  let human2: Player;
  let bot: Player;
  let nation: Player;

  beforeEach(async () => {
    game = await setup("plains", {}, [
      humanInfo,
      human2Info,
      botInfo,
      nationInfo,
    ]);
    human = game.player("human");
    human2 = game.player("human2");
    bot = game.player("bot");
    nation = game.player("nation");
  });

  const alliancesOf = (p: Player) =>
    game.stats().stats()[p.clientID()!]?.alliances;

  test("союз с племенем (Bot) пишется в индекс племени", () => {
    human.createAllianceRequest(bot)?.accept();
    expect(alliancesOf(human)?.[PLAYER_INDEX_BOT] ?? 0n).toBe(1n);
  });

  test("союз с нацией пишется в индекс нации", () => {
    human.createAllianceRequest(nation)?.accept();
    expect(alliancesOf(human)?.[PLAYER_INDEX_NATION] ?? 0n).toBe(1n);
  });

  test("союз человек-человек пишется обоим в индекс человека", () => {
    human.createAllianceRequest(human2)?.accept();
    expect(alliancesOf(human)?.[PLAYER_INDEX_HUMAN] ?? 0n).toBe(1n);
    expect(alliancesOf(human2)?.[PLAYER_INDEX_HUMAN] ?? 0n).toBe(1n);
  });
});

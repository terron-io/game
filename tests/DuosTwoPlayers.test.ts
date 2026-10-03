import { Duos, GameMode, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

// terron 04.09: «Дуэты» на двоих давали ceil(2/2) = 1 команду, конструктор
// GameImpl бросал «Too few teams: 1», и матч не поднимался НИ У КОГО
// (game_error_modal у обоих клиентов игры NFUFxNgi, 03.09). Команд меньше двух
// не бывает: при нехватке игроков составы просто короче.
describe("Duos with too few players", () => {
  test("two humans in Duos start the match on two teams", async () => {
    const game = await setup(
      "plains",
      { gameMode: GameMode.Team, playerTeams: Duos },
      [
        playerInfo("human1", PlayerType.Human),
        playerInfo("human2", PlayerType.Human),
      ],
    );
    expect(game.player("human1").isOnSameTeam(game.player("human2"))).toBe(
      false,
    );
  });
});

// terron: СТОЛИЦЫ (базовая версия) — первый построенный City становится столицей
// (золотой тинт + доход 50/тик), захват/снос снимают статус. Спека: CAPITALS.md
import {
  CAPITAL_POOL,
  NATION_CAPITAL,
  pickCapitalName,
} from "../src/core/game/CapitalNames";
import { CityExecution } from "../src/core/execution/CityExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { constructionExecution } from "./util/utils";

let game: Game;
let me: Player;
let enemy: Player;
let bot: Player;

function buildCity(owner: Player, x: number, y: number): Unit {
  const tile = game.ref(x, y);
  owner.conquer(tile);
  return owner.buildUnit(
    UnitType.City,
    owner.canBuild(UnitType.City, tile) as number,
    {},
  );
}

describe("Capitals (terron)", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("me", PlayerType.Human, null, "me_id"),
      new PlayerInfo("enemy", PlayerType.Human, null, "enemy_id"),
      new PlayerInfo("tribe", PlayerType.Bot, null, "bot_id"),
    ]);
    me = game.player("me_id");
    enemy = game.player("enemy_id");
    bot = game.player("bot_id");
    me.addGold(BigInt(50_000_000));
    enemy.addGold(BigInt(50_000_000));
    bot.addGold(BigInt(50_000_000));
    game.config().structureMinDist = () => 0;
  });

  test("nation with a real-country name gets its real capital; others get a pool name", () => {
    // Нация «Russia» → Москва (реальная столица)
    expect(pickCapitalName("Russia", true, "seed1")).toBe("Moscow");
    expect(NATION_CAPITAL["Russia"]).toBe("Moscow");
    // Нация без известной реальной столицы (выдуманное имя) → элемент пула
    expect(NATION_CAPITAL["Zzfakeland Republic"]).toBeUndefined();
    expect(CAPITAL_POOL).toContain(
      pickCapitalName("Zzfakeland Republic", true, "seed2"),
    );
    // Игрок (не нация) → элемент пула, даже если имя совпало со страной
    expect(CAPITAL_POOL).toContain(pickCapitalName("Russia", false, "seed3"));
    // Детерминизм: один seed → одно имя
    expect(pickCapitalName("X", false, "same")).toBe(
      pickCapitalName("Y", false, "same"),
    );
  });

  test("first built city becomes the capital; the second does not", () => {
    me.conquer(game.ref(5, 9));
    constructionExecution(game, me, 5, 9, UnitType.City);
    const first = me.units(UnitType.City)[0];
    expect(first.isCapital()).toBe(true);
    expect(me.capital()).toBe(first);
    // столица игрока получила имя из пула
    expect(first.capitalName()).toBeTruthy();
    expect(CAPITAL_POOL).toContain(first.capitalName());

    me.conquer(game.ref(7, 9));
    constructionExecution(game, me, 7, 9, UnitType.City);
    expect(me.units(UnitType.City)).toHaveLength(2);
    const second = me.units(UnitType.City).find((c) => c !== first)!;
    expect(second.isCapital()).toBe(false);
    expect(me.capital()).toBe(first); // столица не меняется
  });

  // terron (TZ-skin-capitals.md): у «государства»-скина своё имя столицы —
  // PlayerInfo.capitalName подменяет генератор; null → прежний pickCapitalName.
  test("custom capitalName from PlayerInfo overrides the generated one", async () => {
    const g = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo(
        "блумба",
        PlayerType.Human,
        null,
        "skin_id",
        false,
        null,
        [],
        "Хуюмба",
      ),
      new PlayerInfo("plain", PlayerType.Human, null, "plain_id"),
    ]);
    g.config().structureMinDist = () => 0;
    const skinned = g.player("skin_id");
    const plain = g.player("plain_id");
    skinned.addGold(BigInt(50_000_000));
    plain.addGold(BigInt(50_000_000));

    skinned.conquer(g.ref(5, 9));
    constructionExecution(g, skinned, 5, 9, UnitType.City);
    const cap = skinned.units(UnitType.City)[0];
    expect(cap.isCapital()).toBe(true);
    expect(cap.capitalName()).toBe("Хуюмба");

    // имя фиксируется на юните при основании — источник не перечитывается
    expect(CAPITAL_POOL).not.toContain(cap.capitalName());

    // без capitalName — прежний генератор из пула
    plain.conquer(g.ref(7, 9));
    constructionExecution(g, plain, 7, 9, UnitType.City);
    const plainCap = plain.units(UnitType.City)[0];
    expect(plainCap.isCapital()).toBe(true);
    expect(CAPITAL_POOL).toContain(plainCap.capitalName());
  });

  test("tribes (bots) do NOT get a capital", () => {
    bot.conquer(game.ref(3, 9));
    constructionExecution(game, bot, 3, 9, UnitType.City);
    const cities = bot.units(UnitType.City);
    expect(cities.length).toBeGreaterThanOrEqual(1);
    expect(cities.every((c) => !c.isCapital())).toBe(true);
    expect(bot.capital()).toBe(null);
  });

  test("capital pays a batch of gold every interval (5000 / 10s = 30000/min)", () => {
    const city = buildCity(me, 5, 9);
    city.setCapital(true);
    const exec = new CityExecution(city);
    exec.init(game, 0);

    const amount = game.config().CapitalGoldAmount();
    const interval = game.config().CapitalGoldIntervalTicks();
    expect(amount).toBe(5000n);
    expect(interval).toBe(100);

    const before = me.gold();
    let payouts = 0;
    for (let t = 0; t < 250; t++) {
      exec.tick(t);
      if (t % interval === 0) payouts++;
    }
    expect(me.gold() - before).toBe(amount * BigInt(payouts));
    expect(payouts).toBe(3); // t=0,100,200 → 3 выплаты по 5000
  });

  test("a non-capital city grants NO capital income", () => {
    const city = buildCity(me, 5, 9); // не столица (флаг не ставили)
    const exec = new CityExecution(city);
    exec.init(game, 0);
    const before = me.gold();
    for (let t = 0; t < 10; t++) exec.tick(t);
    expect(me.gold()).toBe(before);
  });

  test("capturing a capital transfers it to the new owner (ego hit, bonuses move)", () => {
    const city = buildCity(me, 5, 9);
    city.setCapital(true);
    me.setCapital(city);
    expect(me.capital()).toBe(city);

    city.setOwner(enemy);
    expect(city.isCapital()).toBe(true); // остаётся столицей
    expect(city.owner()).toBe(enemy);
    expect(me.capital()).toBe(null); // прежний владелец потерял
    expect(enemy.capital()).toBe(city); // бонусы новому владельцу

    // доход теперь капает ЗАХВАТЧИКУ
    const exec = new CityExecution(city);
    exec.init(game, 0);
    const interval = game.config().CapitalGoldIntervalTicks();
    const before = enemy.gold();
    for (let t = 0; t <= interval; t++) exec.tick(t); // t=0 и t=interval → 2 выплаты
    expect(enemy.gold() - before).toBe(game.config().CapitalGoldAmount() * 2n);
  });

  test("if the conqueror already has a capital, the captured one becomes a normal city", () => {
    const mine = buildCity(me, 5, 9);
    mine.setCapital(true);
    mine.setCapitalName("Moscow"); // имя присваивается в ConstructionExecution; тут вручную
    me.setCapital(mine);
    const theirs = buildCity(enemy, 7, 9);
    theirs.setCapital(true);
    enemy.setCapital(theirs);

    const nameBefore = mine.capitalName();
    mine.setOwner(enemy); // enemy захватывает мою столицу, а своя у него уже есть
    expect(mine.isCapital()).toBe(false); // захваченная → обычный город (серый)
    expect(me.capital()).toBe(null); // я потерял
    expect(enemy.capital()).toBe(theirs); // у захватчика осталась его прежняя
    // но ИМЯ сохраняется → игрок видит бывшую столицу на карте (куда десантиться)
    expect(mine.capitalName()).toBe(nameBefore);
    expect(mine.capitalName()).toBeTruthy();
  });

  test("destroying a capital clears the owner's pointer", () => {
    const city = buildCity(me, 5, 9);
    city.setCapital(true);
    me.setCapital(city);

    city.delete(false);
    expect(me.capital()).toBe(null);
  });

  test("after losing the capital, the next built city becomes the new capital", () => {
    const c1 = buildCity(me, 5, 9);
    c1.setCapital(true);
    me.setCapital(c1);
    c1.delete(false);
    expect(me.capital()).toBe(null);

    me.conquer(game.ref(7, 9));
    constructionExecution(game, me, 7, 9, UnitType.City);
    const cap = me.capital();
    expect(cap).not.toBe(null);
    expect(cap!.isCapital()).toBe(true);
  });
});

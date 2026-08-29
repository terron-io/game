import { MirvExecution } from "../src/core/execution/MIRVExecution";
import { PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";

// terron: ПВО-щит против МИРВ (см. MIRVExecution.prepareSamShield).
// Готовое враждебное ПВО «накрывает» свой радиус: боеголовки МИРВ не
// назначаются в зону, а батарея срабатывает — уходит в перезарядку.
//
// Боеголовки живут недолго (спавн → полёт → взрыв → delete), поэтому цели
// собираем ПО ТИКАМ, а не одним снапшотом в конце.
async function runMirvAndCollectTargets(opts: {
  samInCooldown: boolean;
  aimAtSam?: boolean; // целиться прямо в ПВО (для проверки «щита нет»)
}) {
  const game = await setup("big_plains", {
    infiniteGold: true,
    instantBuild: true,
  });

  game.addPlayer(new PlayerInfo("attacker", PlayerType.Human, null, "a_id"));
  game.addPlayer(new PlayerInfo("defender", PlayerType.Human, null, "d_id"));
  const attacker = game.player("a_id");
  const defender = game.player("d_id");

  for (let x = 10; x < 40; x++) {
    for (let y = 10; y < 40; y++) {
      const tile = game.ref(x, y);
      if (game.map().isLand(tile)) attacker.conquer(tile);
    }
  }
  for (let x = 55; x < 95; x++) {
    for (let y = 55; y < 95; y++) {
      const tile = game.ref(x, y);
      if (game.map().isLand(tile)) defender.conquer(tile);
    }
  }

  attacker.addGold(1_000_000_000n);
  attacker.buildUnit(UnitType.MissileSilo, game.ref(20, 20), {});

  // ПВО защитника в центре его блока. samRange(1) в TestConfig = 20.
  // SAMLauncherExecution НЕ регистрируем: юниту-щиту он не нужен, а его
  // перехваты замусорили бы проверку кулдауна.
  const samTile = game.ref(75, 75);
  const sam = defender.buildUnit(UnitType.SAMLauncher, samTile, {});
  if (opts.samInCooldown) {
    sam.launch(); // разряжена ДО пуска МИРВ
  }

  // Цель МИРВ: либо прямо в ПВО (aimAtSam — главная боеголовка легла бы в круг,
  // если щита нет), либо угол блока ВНЕ круга ((56,56)→(75,75) ≈ 27 > 20).
  const dst = opts.aimAtSam ? samTile : game.ref(56, 56);
  game.addExecution(new MirvExecution(attacker, dst));

  const targets = new Map<number, TileRef>(); // warhead unitId → targetTile
  for (let i = 0; i < 600; i++) {
    game.executeNextTick();
    for (const w of attacker.units(UnitType.MIRVWarhead)) {
      const t = w.targetTile();
      if (t !== undefined) targets.set(w.id(), t);
    }
    // МИРВ разделился и все боеголовки уже собраны → можно выходить
    if (
      targets.size > 0 &&
      attacker.units(UnitType.MIRV).length === 0 &&
      attacker.units(UnitType.MIRVWarhead).length === 0
    ) {
      break;
    }
  }

  return { game, sam, samTile, targets };
}

describe("MIRV vs SAM shield", () => {
  test("warheads avoid SAM coverage; covering SAM goes to cooldown", async () => {
    const { game, sam, samTile, targets } = await runMirvAndCollectTargets({
      samInCooldown: false,
    });

    // Атака состоялась (вне зоны ПВО есть куда падать).
    expect(targets.size).toBeGreaterThan(0);

    // НИ ОДНА боеголовка не нацелена внутрь круга ПВО.
    const samRange = game.config().samRange(sam.level());
    const sx = game.x(samTile);
    const sy = game.y(samTile);
    for (const t of targets.values()) {
      const dx = game.x(t) - sx;
      const dy = game.y(t) - sy;
      expect(dx * dx + dy * dy).toBeGreaterThan(samRange * samRange);
    }

    // ПВО «сработало» — ушло в перезарядку (level 1 → одна ракета в очереди).
    expect(sam.isInCooldown()).toBe(true);
  });

  test("SAM already in cooldown does not shield", async () => {
    const { game, sam, samTile, targets } = await runMirvAndCollectTargets({
      samInCooldown: true,
      aimAtSam: true,
    });

    expect(targets.size).toBeGreaterThan(0);

    // Щита нет → хотя бы одна боеголовка нацелена ВНУТРЬ круга.
    const samRange = game.config().samRange(sam.level());
    const sx = game.x(samTile);
    const sy = game.y(samTile);
    const inside = [...targets.values()].some((t) => {
      const dx = game.x(t) - sx;
      const dy = game.y(t) - sy;
      return dx * dx + dy * dy <= samRange * samRange;
    });
    expect(inside).toBe(true);
  });
});

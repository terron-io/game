// terron: ультимейты — Укрепления, апгрейд «поверх» (до 3 ур.). Каждый уровень
// +25% радиуса автозахвата бункеров поверх базового (×1/×1.25/×1.5), цена 5M за
// уровень, потолок 3. Спека: new-units/ULTIMATES.md
import {
  fortHqRangeMult,
  fortRangeMult,
} from "../src/core/configuration/TerronTuning";
import { FortificationsExecution } from "../src/core/execution/FortificationsExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;

/** Ищет центр суши с наибольшей долей земли в диске радиуса `r` вокруг. */
function findLandCenter(g: Game, r: number): { x: number; y: number } {
  let best = { x: -1, y: -1, land: -1 };
  const w = g.width();
  const h = g.height();
  for (let y = r; y < h - r; y += 3) {
    for (let x = r; x < w - r; x += 3) {
      if (!g.map().isLand(g.ref(x, y))) continue;
      let land = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (g.isValidCoord(nx, ny) && g.map().isLand(g.ref(nx, ny))) land++;
        }
      }
      if (land > best.land) best = { x, y, land };
    }
  }
  return { x: best.x, y: best.y };
}

describe("Fortifications leveling (terron)", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("player", PlayerType.Human, null, "player_id"),
    ]);
    player = game.player("player_id");
    player.addGold(100_000_000n);
    game.config().structureMinDist = () => 0;
    while (game.inSpawnPhase()) game.executeNextTick();
  });

  test("fortRangeMult is the shared radius formula: 1.2 / 1.5 / 1.8 by level", () => {
    // Единый множитель радиуса (захват + защита + визуал): база +20% × +25%/ур.
    expect(fortRangeMult(1)).toBeCloseTo(1.2, 5);
    expect(fortRangeMult(2)).toBeCloseTo(1.5, 5);
    expect(fortRangeMult(3)).toBeCloseTo(1.8, 5);
  });

  test("fortHqRangeMult: штаб — бункер ×2 от нормы (2.0 / 2.5 / 3.0 by level)", () => {
    expect(fortHqRangeMult(1)).toBeCloseTo(2.0, 5);
    expect(fortHqRangeMult(2)).toBeCloseTo(2.5, 5);
    expect(fortHqRangeMult(3)).toBeCloseTo(3.0, 5);
  });

  test("the HQ itself captures land (no defense post needed)", async () => {
    const g = await setup("big_plains", { instantBuild: true }, [
      new PlayerInfo("p", PlayerType.Human, null, "p_id"),
    ]);
    const p = g.player("p_id");
    p.addGold(100_000_000n);
    g.config().structureMinDist = () => 0;
    g.config().defensePostRange = () => 4; // штаб R = ×2 → 8
    while (g.inSpawnPhase()) g.executeNextTick();

    const cx = 100;
    const cy = 100;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const t = g.ref(cx + dx, cy + dy);
        if (g.map().isLand(t)) p.conquer(t);
      }
    }
    // ТОЛЬКО штаб, без единого бункера.
    const hq = p.buildUnit(UnitType.Fortifications, g.ref(cx, cy), {});
    expect(p.units(UnitType.DefensePost)).toHaveLength(0);
    const before = p.numTilesOwned();

    g.addExecution(new FortificationsExecution(hq));
    for (let i = 0; i < 200; i++) g.executeNextTick();

    // Штаб сам отжал землю вокруг.
    expect(p.numTilesOwned()).toBeGreaterThan(before);
  });

  test("Fortifications is upgradable to level 3, 5M per level, then capped", () => {
    const info = game.config().unitInfo(UnitType.Fortifications);
    expect(info.upgradable).toBe(true);
    expect(info.maxLevel).toBe(3);
    expect(info.cost(game, player)).toBe(5_000_000n);

    const c = findLandCenter(game, 1);
    const tile = game.ref(c.x, c.y);
    player.conquer(tile);
    const hq = player.buildUnit(UnitType.Fortifications, tile, {});
    expect(hq.level()).toBe(1);

    // Уровень 1 → 2 → 3, каждый апгрейд списывает 5M.
    for (const expected of [2, 3] as const) {
      expect(player.canUpgradeUnit(hq)).toBe(true);
      const before = player.gold();
      player.upgradeUnit(hq);
      expect(hq.level()).toBe(expected);
      expect(before - player.gold()).toBe(5_000_000n);
    }

    // Потолок 3 — дальше апгрейд недоступен.
    expect(player.canUpgradeUnit(hq)).toBe(false);
  });

  test("higher level captures more land (bigger radius)", async () => {
    // big_plains — сплошная суша, есть куда расти. Меньший базовый радиус —
    // компактнее и быстрее в тесте.
    async function run(level: number): Promise<number> {
      const g = await setup("big_plains", { instantBuild: true }, [
        new PlayerInfo("p", PlayerType.Human, null, "p_id"),
      ]);
      const p = g.player("p_id");
      p.addGold(100_000_000n);
      g.config().structureMinDist = () => 0;
      g.config().defensePostRange = () => 4; // R: ×1.2 → 5 (L1) … 7 (L3)
      while (g.inSpawnPhase()) g.executeNextTick();

      // Блок своей земли + бункер + штаб в центре карты (кругом ничейная суша).
      const cx = 100;
      const cy = 100;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const t = g.ref(cx + dx, cy + dy);
          if (g.map().isLand(t)) p.conquer(t);
        }
      }
      const center = g.ref(cx, cy);
      const hq = p.buildUnit(UnitType.Fortifications, center, {});
      p.buildUnit(UnitType.DefensePost, center, {});
      for (let i = 1; i < level; i++) p.upgradeUnit(hq);
      expect(hq.level()).toBe(level);

      g.addExecution(new FortificationsExecution(hq));
      for (let i = 0; i < 400; i++) g.executeNextTick();
      return p.numTilesOwned();
    }

    const ownedL1 = await run(1);
    const ownedL3 = await run(3);
    expect(ownedL3).toBeGreaterThan(ownedL1);
  });
});

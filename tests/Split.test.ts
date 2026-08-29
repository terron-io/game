// terron: ультимейты — РАСКОЛ. Таргетная «пропаганда»: вырезает у цели «флаг»
// (прямоугольник 3:2 с буквой Т внутри), основа флага → НАЦИИ-сепаратисту (иммунна к
// схлопыванию, короткий союз с обоими), буква Т ОСТАЁТСЯ ЖЕРТВЕ под окном защиты
// (союз+иммунитет). Не пробила коридор к своей земле — по истечении окна Т схлопывается
// к нации; пробила — осталась жертве. Спека: new-units/SPLIT.md
import { TERRON_SPLIT_BASE_GOLD } from "../src/core/configuration/TerronTuning";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { TribeExecution } from "../src/core/execution/TribeExecution";
import {
  BuildableAttacks,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Ultimates,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let attacker: Player;
let victim: Player;

// Заливает игроку прямоугольный блок земли [x0..x1]×[y0..y1].
function fillBlock(p: Player, x0: number, x1: number, y0: number, y1: number) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      p.conquer(game.ref(x, y));
    }
  }
}

function launchSplit(targetX: number, targetY: number, troops = 0) {
  game.addExecution(
    new ConstructionExecution(
      attacker,
      UnitType.Split,
      game.ref(targetX, targetY),
      undefined,
      troops,
    ),
  );
  // tick1: ConstructionExecution → addExecution(Split); tick2: Split.doSplit;
  // далее «вспышка» захватывает тайлы пачками за TERRON_SPLIT_PEEL_TICKS (15) —
  // крутим с запасом, чтобы захват основы и Т успел завершиться.
  for (let i = 0; i < 24; i++) game.executeNextTick();
}

describe("Split ultimate (terron)", () => {
  beforeEach(async () => {
    game = await setup("big_plains", { instantBuild: true }, [
      new PlayerInfo("attacker", PlayerType.Human, null, "attacker_id"),
      new PlayerInfo("victim", PlayerType.Human, null, "victim_id"),
    ]);
    attacker = game.player("attacker_id");
    victim = game.player("victim_id");
    attacker.addGold(BigInt(500_000_000));
    // Атакующий — маленький блок далеко от цели.
    fillBlock(attacker, 5, 12, 5, 12);
    // terron: Раскол разблокируется зданием МЕДИА (иначе каст недоступен).
    // Ставим штаб в углу блока атакующего — фиксирует выбор ульты = Media.
    attacker.buildUnit(UnitType.Media, game.ref(5, 5), {});
    // Жертва — блок вокруг (80,80), чуть больше флага (перф: removeClusters у
    // PlayerExecution — O(тайлов) каждый тик, а длинные тесты крутят 600+ тиков).
    fillBlock(victim, 66, 94, 70, 90);
    victim.addTroops(200_000);
    // Как в реальной игре: у жертвы есть PlayerExecution (крутит removeClusters —
    // схлопывание окружённых анклавов). Нужно, чтобы Т после окна ушла нации.
    // Атакующему НЕ добавляем (иначе доход/тик ломает точную проверку золота).
    game.addExecution(new PlayerExecution(victim));
  });

  test("Split is a targeted attack unlocked by the Media ultimate", () => {
    // terron: Раскол больше НЕ прямой выбор ульты — его разблокирует МЕДИА.
    expect(Ultimates.has(UnitType.Split)).toBe(false);
    expect(Ultimates.has(UnitType.Media)).toBe(true);
    expect(BuildableAttacks.has(UnitType.Split)).toBe(true);
  });

  test("base gold cost matches tuning", () => {
    const cost = game.config().unitInfo(UnitType.Split).cost(game, attacker);
    expect(cost).toBe(TERRON_SPLIT_BASE_GOLD);
  });

  test("split carves a separatist NATION that owns the base, allied with both sides", () => {
    const playersBefore = game.players().length;
    const victimTilesBefore = victim.numTilesOwned();
    const attackerGoldBefore = attacker.gold();

    launchSplit(80, 80);

    // Новая НАЦИЯ-сепаратист «{префикс} {ник}» появилась.
    const nation = game.players().find((p) => p.type() === PlayerType.Nation);
    expect(game.players().length).toBe(playersBefore + 1);
    expect(nation).toBeDefined();
    // Имя = «политический» префикс + имя жертвы (префикс варьируется по сиду).
    expect(nation!.name()).toMatch(/^\S+ victim$/);

    // Нация держит основу флага (много тайлов) и иммунна к схлопыванию.
    expect(nation!.numTilesOwned()).toBeGreaterThan(30);
    expect(nation!.isImmuneToCollapse()).toBe(true);

    // Основа — у нации; буква Т ОСТАЁТСЯ ЖЕРТВЕ (её лояльное ядро).
    // terron 06.08: размер флага = ДОЛЯ СУШИ карты. Тестовая big_plains — 40к
    // тайлов суши, при troops=0 (доля атаки 0) полу-высота упирается в
    // абсолютный пол MIN_HALF_HEIGHT=4 → флаг центр (80,80), y76..84, x74..86.
    // Т внутри с рамкой основы; ножка по центру x80, перекладина у верх-иннера.
    expect(game.owner(game.ref(75, 80))).toBe(nation); // основа (лево-центр, не Т)
    expect(game.owner(game.ref(80, 80))).toBe(victim); // ножка Т (центр)
    expect(game.owner(game.ref(80, 77))).toBe(victim); // перекладина Т

    // Новая нация СРАЗУ в союзе и с атакующим, и с жертвой.
    expect(attacker.isAlliedWith(nation!)).toBe(true);
    expect(victim.isAlliedWith(nation!)).toBe(true);

    // Жертва усохла (отдала основу), но не исчезла; золото списано.
    expect(victim.numTilesOwned()).toBeLessThan(victimTilesBefore);
    expect(victim.isAlive()).toBe(true);
    expect(attacker.gold()).toBe(attackerGoldBefore - TERRON_SPLIT_BASE_GOLD);

    // Выбор ульты зафиксирован зданием МЕДИА → МИРВ недоступен, а Раскол
    // (разблокирован МЕДИА) — доступен снова.
    expect(attacker.ultimateChoice()).toBe(UnitType.Media);
    expect(attacker.canBuild(UnitType.MIRV, game.ref(8, 8))).toBe(false);
    expect(attacker.canBuild(UnitType.Split, game.ref(80, 80))).not.toBe(false);
  });

  test("seceding population transfers to the nation proportionally", () => {
    const victimTroopsBefore = victim.troops();
    launchSplit(80, 80);
    const nation = game.players().find((p) => p.type() === PlayerType.Nation);
    expect(nation).toBeDefined();
    expect(nation!.troops()).toBeGreaterThan(0);
    expect(victim.troops()).toBeLessThan(victimTroopsBefore);
  });

  test("too small a target does not split or charge", () => {
    // Отдельная жалкая жертва в паре тайлов.
    const tiny = game.player("victim_id");
    // Освобождаем жертву и оставляем лишь 3 тайла — основа флага будет < минимума.
    for (const t of [...tiny.tiles()]) tiny.relinquish(t);
    tiny.conquer(game.ref(150, 150));
    tiny.conquer(game.ref(151, 150));
    tiny.conquer(game.ref(150, 151));
    const goldBefore = attacker.gold();
    const playersBefore = game.players().length;

    launchSplit(150, 150);

    expect(game.players().length).toBe(playersBefore); // бота нет
    expect(attacker.gold()).toBe(goldBefore); // не списано
    // Выбор ульты зафиксирован МЕДИА (в beforeEach) и неудачный каст его не трогает.
    expect(attacker.ultimateChoice()).toBe(UnitType.Media);
  });

  test("Т stays with victim during the window; unrescued → collapses to the nation when it ends", () => {
    launchSplit(80, 80);
    const tTile = game.ref(80, 80); // ножка Т
    // Сразу после раскола лояльное ядро — у ЖЕРТВЫ (защищено союзом+иммунитетом).
    expect(game.owner(tTile)).toBe(victim);

    const nation = game.players().find((p) => p.type() === PlayerType.Nation)!;

    // Т в окне защиты держится у жертвы.
    for (let i = 0; i < 300; i++) game.executeNextTick();
    expect(game.owner(tTile)).toBe(victim);

    // Жертва коридор к своей земле не пробила → по истечении окна (союз сеп.↔жертва +
    // иммунитет, ~600 тиков) окружённый анклав схлопывается к нации-сепаратисту.
    for (let i = 0; i < 360; i++) game.executeNextTick();
    expect(game.owner(tTile)).toBe(nation);
    expect(nation.isAlive()).toBe(true);
  }, 60000);

  test("reconnecting Т to victim's land before the window ends keeps it for the victim", () => {
    launchSplit(80, 80);
    const tTile = game.ref(80, 80); // ножка Т
    expect(game.owner(tTile)).toBe(victim);

    // Жертва пробивает коридор от ножки Т влево ЗА пределы флага (x71..89 → x70
    // снаружи всё ещё её земля): анклав соединён с основной территорией → не окружён
    // одной нацией → не схлопывается. Имитирует атаку по союзному сепаратисту.
    for (let x = 70; x <= 80; x++) victim.conquer(game.ref(x, 80));

    for (let i = 0; i < 640; i++) game.executeNextTick();

    // Дотянулись до своих → ядро осталось жертве.
    expect(game.owner(tTile)).toBe(victim);
  }, 60000);

  // Регресс: нация-сепаратист управляется TribeExecution (без emojiBehavior). Когда
  // она ОКРУЖЕНА игроками (нет terraNullius) и идёт в attackRandomTarget → атака
  // игрока нацией раньше падала «Error: not initialized» (emojiBehavior undefined).
  test("nation driven by TribeExecution attacking a player does not crash", () => {
    const nation = game.addPlayer(
      new PlayerInfo("Независимая X", PlayerType.Nation, null, "sep_id"),
    );
    const enemy = game.addPlayer(
      new PlayerInfo("enemy", PlayerType.Human, null, "enemy_id"),
    );
    // Враг большим блоком, нация — целиком ВНУТРИ него (окружена игроком, без terraNullius).
    fillBlock(enemy, 140, 180, 140, 180);
    enemy.addTroops(2000);
    fillBlock(nation, 150, 165, 150, 165);
    nation.addTroops(80_000);
    game.addExecution(new TribeExecution(nation));

    expect(() => {
      for (let i = 0; i < 200; i++) game.executeNextTick();
    }).not.toThrow();
  }, 20000);
});

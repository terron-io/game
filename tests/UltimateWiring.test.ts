// terron 06.08 — КАНОН УЛЬТ, ПРОВЕРЯЕМЫЙ АВТОМАТИЧЕСКИ.
//
// Повод (прямая просьба владельца): «сделай так, чтобы я больше никогда не
// напоминал о том, как работают ульты, какие кнопки куда добавить». За вечер
// одно и то же вылезло ЧЕТЫРЕ раза: новая ульта готова в ядре, а в интерфейсе
// её нет — то слот не превращается в каст, то строения нет в билд-меню, то у
// здания не звезда, то радиус не рисуется. Каждый раз это «забыл дописать
// строку в ручной список».
//
// Поэтому правила ульт живут ЗДЕСЬ как тесты, а не как память человека.
// Добавил ульту — прогнал `npm run test:gate` — он сам скажет, что не дописано.
// Словесный чек-лист (что и зачем) — `new-units/ULTIMATES.md` §ЧЕК-ЛИСТ.
import fs from "fs";
import path from "path";
import {
  ultimateOptions,
  unitOptions,
} from "../src/client/components/GameConfigSettings";
import { flattenedBuildTable } from "../src/client/hud/layers/BuildMenu";
import { UNIT_CATALOG } from "../src/client/UnitCatalog";
import { ULTS } from "../src/client/WikiContent";
import {
  BuildableAttacks,
  CAST_UNLOCKED_BY,
  Structures,
  Ultimates,
  UnitType,
} from "../src/core/game/Game";

const ROOT = path.join(__dirname, "..");

const renderSettings = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "src/client/render/gl/render-settings.json"),
    "utf8",
  ),
) as { structure: { shapes: Record<string, { scale?: number }> } };

const structurePassSrc = fs.readFileSync(
  path.join(ROOT, "src/client/render/gl/passes/StructurePass.ts"),
  "utf8",
);

const allUnitTypesSrc = fs.readFileSync(
  path.join(ROOT, "src/client/render/types/UnitType.ts"),
  "utf8",
);

const en = JSON.parse(
  fs.readFileSync(path.join(ROOT, "resources/lang/en.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

/** Все ульты, кроме МИРВ: он — чистая атака, здания у него нет. */
const ULT_BUILDINGS = Ultimates.types.filter((t) => Structures.has(t));

describe("Ultimate wiring canon (terron)", () => {
  test("registry is sane: every ultimate building is also a structure", () => {
    expect(ULT_BUILDINGS.length).toBeGreaterThan(5);
  });

  for (const type of ULT_BUILDINGS) {
    const meta = UNIT_CATALOG[type];

    describe(`${type}`, () => {
      // 1. HUD-реестр: иконка слота/чузера/ленты берётся отсюда.
      test("has a UnitCatalog entry marked as ultimate, with an icon", () => {
        expect(meta, `нет записи в UNIT_CATALOG`).toBeDefined();
        expect(meta!.ultimate).toBe(true);
        expect(meta!.icon.length).toBeGreaterThan(0);
        expect(meta!.key.length).toBeGreaterThan(0);
      });

      // 2. Ставится через СЛОТ УЛЬТЫ, а не кнопкой в баре/радиали.
      test("is NOT in the ordinary build table (ult slot only)", () => {
        const inTable = flattenedBuildTable.some((i) => i.unitType === type);
        expect(inTable).toBe(false);
      });

      // 3. Спрайт на карте: тип обязан быть в списке, который воркер шлёт
      //    рендеру, иначе здание молча НЕ РИСУЕТСЯ (ловили дважды).
      test("is listed in ALL_UNIT_TYPES + STRUCTURE_ORDER (or it won't render)", () => {
        expect(
          allUnitTypesSrc.includes(`"${type}"`),
          `тип не объявлен в render/types/UnitType.ts`,
        ).toBe(true);
        const constName = allUnitTypesSrc.match(
          new RegExp(`export const (UT_\\w+) = "${type}"`),
        )?.[1];
        expect(constName, `нет UT_-константы для ${type}`).toBeDefined();
        expect(
          structurePassSrc.includes(`${constName},`),
          `${constName} нет в STRUCTURE_ORDER (колонка атласа)`,
        ).toBe(true);
      });

      // 4. ВНЕШНИЙ ВИД: все ульт-здания — ЗВЕЗДА УВЕЛИЧЕННОГО РАЗМЕРА.
      //    Требование владельца, повторённое дважды. Звезду рисует шейдер всем
      //    колонкам после ультовой границы, а размер задаётся ЗДЕСЬ.
      test("renders as an enlarged star (render-settings scale 2.0)", () => {
        const shape = renderSettings.structure.shapes[type];
        expect(
          shape,
          `нет записи в render-settings.structure.shapes`,
        ).toBeDefined();
        expect(shape.scale, `звезда ульты обязана быть ×2`).toBe(2.0);
      });

      // 5. Тексты: без них в HUD и вики будут сырые ключи.
      test("has en.json names (unit_type + build_menu.desc)", () => {
        expect(
          en.unit_type?.[meta!.key],
          `нет unit_type.${meta!.key} в en.json`,
        ).toBeDefined();
        expect(
          (en.build_menu as Record<string, Record<string, unknown>>)?.desc?.[
            meta!.key
          ],
          `нет build_menu.desc.${meta!.key} в en.json`,
        ).toBeDefined();
      });

      // 6. Карточка в вики (/wiki/ult/<slug>).
      test("has a wiki card", () => {
        const card = ULTS.find((u) => u.type === type);
        expect(card, `нет карточки в WikiContent.ULTS`).toBeDefined();
        expect(card!.what.ru.length).toBeGreaterThan(40);
        expect(card!.what.en.length).toBeGreaterThan(40);
      });
    });
  }

  // 7. Ульты-КАСТЫ (Раскол, МИРВ, водяная ракета): пара «здание → каст» живёт в
  //    реестре, слот превращается в каст по нему же. Каст — не здание.
  describe("casts unlocked by an ultimate building", () => {
    for (const [cast, unlock] of Object.entries(CAST_UNLOCKED_BY) as [
      UnitType,
      { building: UnitType },
    ][]) {
      test(`${unlock.building} → ${cast}: wired end to end`, () => {
        expect(Ultimates.has(unlock.building)).toBe(true);
        expect(Structures.has(unlock.building)).toBe(true);
        expect(Structures.has(cast)).toBe(false);
        // Каст должен быть строимой атакой — иначе его нечем применить.
        expect(BuildableAttacks.has(cast)).toBe(true);
        // И у него обязана быть иконка в реестре (её показывает слот).
        expect(
          UNIT_CATALOG[cast],
          `нет записи UNIT_CATALOG[${cast}]`,
        ).toBeDefined();

        // ⚠️ САМОЕ ВАЖНОЕ (репорт тестера 07.08 «Раскола в мобильной менюшке
        // атаки нет»): каст ОБЯЗАН быть в билд-таблице — из неё строится
        // РАДИАЛЬНОЕ МЕНЮ АТАК, а на мобиле радиаль единственный интерфейс.
        // Нет записи → каст невозможно применить с телефона ВООБЩЕ.
        // (В десктопном баре его нет и не надо — там слот ульты.)
        expect(
          flattenedBuildTable.some((i) => i.unitType === cast),
          `${cast} нет в билд-таблице → его НЕТ в радиали атак (мобила не сможет кастовать)`,
        ).toBe(true);
      });
    }
  });

  // 8. ВЫКЛЮЧАТЕЛЬ В ЛОББИ. Хост обязан иметь возможность отключить ЛЮБОЙ юнит
  //    перед матчем. Список ульт выводится из реестра (новая ульта появляется
  //    сама), а вот список обычных юнитов — РУЧНОЙ, и его забыть легко.
  //    Вопрос владельца 06.08: «кнопка выключения в лобби не забыл?»
  describe("lobby unit-disable toggles", () => {
    const inUltList = new Set(ultimateOptions.map((o) => o.type));
    const inUnitList = new Set(unitOptions.map((o) => o.type));

    for (const type of Ultimates.types) {
      test(`${type} has a lobby toggle (ultimates section)`, () => {
        expect(inUltList.has(type)).toBe(true);
      });
    }

    for (const type of Structures.types) {
      if (Ultimates.has(type)) continue; // ульты — в своей секции, см. выше
      test(`${type} has a lobby toggle (ordinary units section)`, () => {
        expect(
          inUnitList.has(type),
          `нет карточки отключения в GameConfigSettings.unitOptions`,
        ).toBe(true);
      });
    }

    test("every toggle has an icon and a translation key", () => {
      for (const opt of [...unitOptions, ...ultimateOptions]) {
        expect(opt.icon.length, `${opt.type}: пустая иконка`).toBeGreaterThan(
          0,
        );
        expect(
          opt.translationKey.startsWith("unit_type."),
          `${opt.type}: кривой ключ перевода`,
        ).toBe(true);
      }
    });
  });
});

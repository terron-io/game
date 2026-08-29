import { assetUrl } from "../core/AssetUrls";
import { UnitType } from "../core/game/Game";
import { unitMeta } from "./UnitCatalog";
import {
  CFG,
  DERIVED,
  TUN,
  buildSec,
  costOf,
  gold,
  n,
  tradeGold,
  trainGold,
  troops,
} from "./WikiNumbers";

/**
 * terron: КОНТЕНТ ВИКИ — весь текст и структура разделов в одном месте.
 * `WikiPage.ts` рядом отвечает только за роутинг и вёрстку.
 *
 * Правила:
 *  • ЦИФРЫ НЕ ПИШЕМ РУКАМИ. Любое число — из `WikiNumbers.ts`, оно там живое
 *    (тянется из `Config.ts` / `TerronTuning.ts`). Поправили баланс — вики
 *    обновилась сама.
 *  • Двуязычие — литералами `bi("ру","en")`, без i18n-ключей (так уже было).
 *  • Упомянул объект, у которого есть иконка — ставь её (`iconOf`).
 *  • Вики — БАЗА ЗНАНИЙ («как устроено»), а не гайд («как играть»). Гайд живёт
 *    отдельно на /guide.
 */

export interface Bi {
  ru: string;
  en: string;
}
export const bi = (ru: string, en: string): Bi => ({ ru, en });

/** Активная способность, разблокируемая зданием (описывается на его странице). */
export interface Skill {
  type: UnitType;
  name: Bi;
  what: Bi;
}

/** Карточка-деталь: /wiki/ult/<slug>. Формат общий для ультов и зданий. */
export interface Entry {
  slug: string;
  type: UnitType;
  name: Bi;
  kind: Bi;
  cost: Bi;
  what: Bi;
  skill?: Skill;
  ref?: Bi;
}

// ── иконки ──────────────────────────────────────────────────────────────────

/**
 * Иконки объектов, которых нет в `UnitCatalog` (тот реестр — про HUD-отображение
 * и трогать его ради вики нельзя). Здесь — только чтение файлов ассетов.
 */
const WIKI_ICONS: Partial<Record<UnitType, string>> = {
  [UnitType.DefensePost]: "ShieldIconWhite.svg",
  [UnitType.Warship]: "DestroyerIconWhite.svg",
  [UnitType.TransportShip]: "BoatIconWhite.svg",
  [UnitType.TradeShip]: "TradingIconWhite.png",
  [UnitType.AtomBomb]: "NukeIconWhite.svg",
  [UnitType.HydrogenBomb]: "MushroomCloudIconWhite.svg",
  [UnitType.SuicideDrone]: "DroneIconWhite.svg",
  [UnitType.Airplane]: "AirportIconWhite.svg",
  [UnitType.AirborneAssault]: "AirportIconWhite.svg",
  [UnitType.Train]: "FactoryIconWhite.svg",
};

/** Отдельные картинки для понятий без своего UnitType. */
export const CONCEPT_ICONS = {
  capital: assetUrl("images/CrownIcon.svg"),
  alliance: assetUrl("images/AllianceIconWhite.svg"),
  traitor: assetUrl("images/TraitorIconWhite.svg"),
  ultimate: assetUrl("images/UltimateIconWhite.svg"),
  troops: assetUrl("images/TroopIconWhite.svg"),
  gold: assetUrl("images/GoldCoinIcon.svg"),
  land: assetUrl("images/LeaderboardIconSolidWhite.svg"),
  worker: assetUrl("images/WorkerIconWhite.svg"),
  sword: assetUrl("images/SwordIconWhite.svg"),
  shield: assetUrl("images/ShieldIconWhite.svg"),
  siren: assetUrl("images/SirenIconWhite.svg"),
  tree: assetUrl("images/TreeIconWhite.svg"),
  target: assetUrl("images/TargetIconWhite.svg"),
} as const;

/** URL иконки объекта: сперва общий реестр HUD, затем вики-локальный список. */
export function iconOf(type: UnitType): string | undefined {
  const fromCatalog = unitMeta(type)?.icon;
  if (fromCatalog) return fromCatalog;
  const local = WIKI_ICONS[type];
  return local ? assetUrl(`images/${local}`) : undefined;
}

// ── блоки текста раздела ────────────────────────────────────────────────────

export interface Row {
  /** Иконка слева: тип юнита либо готовый URL из CONCEPT_ICONS. */
  icon?: UnitType | string;
  k: Bi;
  v: Bi;
}

export type Block =
  | { kind: "lead"; text: Bi }
  | { kind: "h"; text: Bi }
  | { kind: "p"; text: Bi }
  | { kind: "ul"; items: Bi[] }
  | { kind: "rows"; rows: Row[] }
  | { kind: "note"; title?: Bi; text: Bi }
  | { kind: "cards"; slugs: string[] };

// Короткие помощники, чтобы текст читался, а не тонул в скобках.
const lead = (ru: string, en: string): Block => ({
  kind: "lead",
  text: bi(ru, en),
});
const h = (ru: string, en: string): Block => ({ kind: "h", text: bi(ru, en) });
const p = (ru: string, en: string): Block => ({ kind: "p", text: bi(ru, en) });
const ul = (items: Bi[]): Block => ({ kind: "ul", items });
const rows = (list: Row[]): Block => ({ kind: "rows", rows: list });
const note = (ru: string, en: string, title?: Bi): Block => ({
  kind: "note",
  title,
  text: bi(ru, en),
});
const cards = (slugs: string[]): Block => ({ kind: "cards", slugs });

// ════════════════════════════════════════════════════════════════════════════
// УЛЬТИМЕЙТЫ
// ════════════════════════════════════════════════════════════════════════════

export const ULTS: Entry[] = [
  {
    slug: "nuclear_factory",
    type: UnitType.NuclearFactory,
    name: bi("Ядерный завод", "Nuclear Factory"),
    kind: bi("Здание-штаб · разблокирует МИРВ", "HQ building · unlocks MIRV"),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build`,
    ),
    what: bi(
      "Пока завод стоит, тебе доступен пуск МИРВ — сколько угодно раз. Без завода (ульты выключены в лобби) МИРВ работает как в оригинале — из ракетной шахты.",
      "While the factory stands, you can launch MIRV — as many times as you like. Without the factory (ultimates off in the lobby), MIRV works as in the original — from a missile silo.",
    ),
    skill: {
      type: UnitType.MIRV,
      name: bi("МИРВ", "MIRV"),
      what: bi(
        `Разделяющаяся ядерная боеголовка: раскрывается над целью и накрывает её территорию 350 отдельными боеголовками (радиус каждой ${CFG.mirvWarhead.inner}/${CFG.mirvWarhead.outer} тайлов). Цена пуска = ${costOf(UnitType.MIRV)} и растёт на 15M за каждый уже запущенный в этом матче МИРВ: второй ${costOf(UnitType.MIRV, 0, 1)}, третий ${costOf(UnitType.MIRV, 0, 2)}. Готовое вражеское ПВО прикрывает свой радиус от боеголовок, тратя заряд.`,
        `A multiple-warhead nuke: it splits above the target and blankets its territory with 350 separate warheads (each ${CFG.mirvWarhead.inner}/${CFG.mirvWarhead.outer} tiles). Launch cost = ${costOf(UnitType.MIRV)}, rising by 15M per MIRV already launched this match: second ${costOf(UnitType.MIRV, 0, 1)}, third ${costOf(UnitType.MIRV, 0, 2)}. A ready enemy SAM shields its own radius from the warheads, spending its charge.`,
      ),
    },
  },
  // terron 06.08: Мин правды ВЛИТА В МЕДИА — отдельного здания больше нет,
  // карточка закомментирована (описание ауры переехало в карточку "media").
  // Вернуть = раскомментировать тут + проводку в Game.ts/ConstructionExecution.
  // {
  //   slug: "ministry_of_truth",
  //   type: UnitType.MinistryOfTruth,
  //   name: bi("Министерство правды", "Ministry of Truth"),
  //   kind: bi("Здание-штаб · аура", "HQ building · aura"),
  //   cost: bi(
  //     `${gold(TUN.ultCost)} золота (2-е — ${gold(TUN.ultCost * 2)}) · постройка ${TUN.ultBuildSec} с`,
  //     `${gold(TUN.ultCost)} gold (2nd — ${gold(TUN.ultCost * 2)}) · ${TUN.ultBuildSec}s build`,
  //   ),
  //   what: bi(
  //     `Аура радиусом ${TUN.ministryRadius} тайлов вокруг штаба. Раз в ${TUN.ministryPeriodSec} с высасывает ${TUN.ministryDrainPct} % войск у каждого враждебного игрока, чья территория попала в радиус (процент — «чем больше населения у жертвы, тем больше сосёт»), и ${TUN.ministryConvertPct} % высосанного отдаёт тебе. Можно построить ДВА министерства: второе стоит вдвое, но на 50 % эффективнее (×${TUN.ministrySecondMult} к высасыванию); второе открывается только после достройки первого.`,
  //     `A ${TUN.ministryRadius}-tile-radius aura around the HQ. Every ${TUN.ministryPeriodSec}s it drains ${TUN.ministryDrainPct}% of troops from every hostile player whose territory is in range (a percentage — "the bigger the victim's population, the more it drains") and converts ${TUN.ministryConvertPct}% of it to you. You can build TWO ministries: the second costs double but drains 50% harder (×${TUN.ministrySecondMult}); the second unlocks only after the first is finished.`,
  //   ),
  // },
  {
    slug: "fortifications",
    type: UnitType.Fortifications,
    name: bi("Укрепления", "Fortifications"),
    kind: bi("Здание-штаб · апгрейд до 3 ур.", "HQ building · up to lvl 3"),
    cost: bi(
      `${gold(TUN.ultCost)} золота за уровень · постройка ${TUN.ultBuildSec} с`,
      `${gold(TUN.ultCost)} gold per level · ${TUN.ultBuildSec}s build`,
    ),
    what: bi(
      `Пока штаб жив, раз в ${TUN.fortPeriodSec} с каждый твой достроенный бункер тихо захватывает вражеские/ничейные земельные тайлы в радиусе своей защиты — без «вас атакуют». Сила захвата зависит от расстояния до бункера: у кромки радиуса — базовые ~${DERIVED.fortTilesFar} тайлов за импульс, вплотную к бункеру — втрое больше (~${DERIVED.fortTilesNear}). Базовый радиус бункера ${CFG.defensePostRange} тайлов растёт с уровнем штаба: ×1,2 / ×1,5 / ×1,8 = 36 / 45 / 54 тайла. Сам штаб тоже «стреляет», но радиусом вдвое больше: 60 / 75 / 90. Бункеры владельцу дешевле на 20 %.`,
      `While the HQ stands, every ${TUN.fortPeriodSec}s each of your finished bunkers quietly captures enemy/neutral land tiles within its defense radius — no "you're under attack". Capture strength depends on distance to the bunker: at the radius edge it's the base ~${DERIVED.fortTilesFar} tiles per pulse, right next to the bunker three times as much (~${DERIVED.fortTilesNear}). A bunker's base ${CFG.defensePostRange}-tile radius grows with HQ level: ×1.2 / ×1.5 / ×1.8 = 36 / 45 / 54 tiles. The HQ itself also "fires", at double the radius: 60 / 75 / 90. Bunkers cost the owner 20% less.`,
    ),
  },
  {
    slug: "central_bank",
    type: UnitType.CentralBank,
    name: bi("Центробанк", "Central Bank"),
    kind: bi("Здание-штаб · пассив", "HQ building · passive"),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build`,
    ),
    what: bi(
      `Пока штаб стоит: твои корабли нельзя перехватить, а самолёты не платят комиссию за пролёт над чужой территорией (обычно ${TUN.airplaneTaxPct} % груза за каждый тик полёта).`,
      `While the HQ stands: your boats can't be intercepted, and your planes pay no toll for flying over foreign territory (normally ${TUN.airplaneTaxPct}% of cargo per flight tick).`,
    ),
  },
  {
    slug: "air_command",
    type: UnitType.AirCommand,
    name: bi("Авиаштаб", "Air Command"),
    kind: bi("Здание-штаб · пассив", "HQ building · passive"),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build`,
    ),
    what: bi(
      `Пока штаб стоит, твой воздушный десант: бесплатный (обычно платный), высаживается в полном составе (обычно доходит ${TUN.airborneLandingPct} % — половину «перестреливают на подлёте») и удерживает плацдарм ${TUN.beachheadUltSec} с (обычно ${TUN.beachheadSec} с) — всё это время точка высадки иммунна к авто-схлопыванию окружением.`,
      `While the HQ stands, your airborne assault is free (normally paid), lands at full strength (normally ${TUN.airborneLandingPct}% — half is "shot down on approach") and holds the beachhead for ${TUN.beachheadUltSec}s (normally ${TUN.beachheadSec}s) — during which the landing spot is immune to being auto-collapsed by encirclement.`,
    ),
  },
  {
    slug: "tank_factory",
    type: UnitType.TankFactory,
    name: bi("Танковый завод", "Tank Factory"),
    kind: bi("Здание-штаб · пассив", "HQ building · passive"),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build`,
    ),
    what: bi(
      `Пока штаб стоит, твои наземные атаки игнорируют бонус защиты вражеских бункеров и теряют на ${TUN.tankLossPct} % меньше войск (то есть примерно «+${TUN.tankLossPct} % силы атаки»).`,
      `While the HQ stands, your ground attacks ignore the enemy bunker defense bonus and lose ${TUN.tankLossPct}% fewer troops (≈ "+${TUN.tankLossPct}% attack power").`,
    ),
  },
  {
    slug: "religion",
    type: UnitType.Religion,
    name: bi("Религия", "Religion"),
    kind: bi(
      "Здание-храм · копий сколько угодно",
      "Temple building · unlimited copies",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · −${TUN.religionTithePct} % дохода за каждый храм`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · −${TUN.religionTithePct}% income per temple`,
    ),
    what: bi(
      `Пока стоит храм, ВСЯ твоя территория медленно расползается наружу — примерно одно кольцо за ${DERIVED.religionRingSec} с. Каждый пограничный тайл обращает ближайшие земельные тайлы в радиусе ${TUN.religionReach} тайлов, тихо (без «вас атакуют»). Сколько именно — зависит от числа храмов: ${DERIVED.religionTilesFor(1)} тайла при одном храме, ${DERIVED.religionTilesFor(2)} при двух, ${DERIVED.religionTilesFor(3)} при трёх и так далее (обход границы ОДИН на игрока, храмы не складываются в отдельные обходы). ПО СЛОЖНОЙ ЗЕМЛЕ ВЕРА ИДЁТ ТЯЖЕЛЕЕ: холмы и горы «стоят» дороже равнины (те же пропорции, что и в обычной атаке), поэтому в горах за тот же проход обращается меньше тайлов. Радиуса хватает перешагнуть узкую воду — реку или пролив, — но не океан к другому континенту. Вера НЕ трогает ничейную пустошь, радиоактивный пепел и тех, с кем у тебя сейчас идёт бой, — зато ест земли союзников и тиммейтов («вера не разбирает»). ПЛАТА: каждый храм режет ${TUN.religionTithePct} % от ТЕКУЩЕГО пассивного дохода — 100 → 90 → 81 → 73 и дальше.`,
      `While a temple stands, your ENTIRE territory slowly creeps outward — about one ring every ${DERIVED.religionRingSec}s. Each border tile converts the nearest land tiles within ${TUN.religionReach} tiles, quietly (no "you're under attack"). How many depends on your temple count: ${DERIVED.religionTilesFor(1)} tiles with one temple, ${DERIVED.religionTilesFor(2)} with two, ${DERIVED.religionTilesFor(3)} with three, and so on (there is ONE border sweep per player — temples do not each run their own). ROUGH GROUND SLOWS FAITH DOWN: highland and mountains cost more than plains (the same ratios a normal attack pays), so a pass converts fewer tiles in the mountains. The radius is enough to step over narrow water — a river or strait — but not an ocean to another continent. Faith does NOT touch empty wasteland, radioactive fallout, or anyone you are currently fighting — but it does eat allied and teammate land ("faith makes no distinction"). THE PRICE: every temple cuts ${TUN.religionTithePct}% off your CURRENT passive income — 100 → 90 → 81 → 73 and onward.`,
    ),
  },
  {
    slug: "submarine_base",
    type: UnitType.SubmarineBase,
    name: bi("Подводный флот", "Submarine Fleet"),
    kind: bi("Здание-штаб · пассив", "HQ building · passive"),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build`,
    ),
    what: bi(
      `Пока штаб стоит, ВСЕ твои боевые корабли — подлодки: другой силуэт на карте и главное — ФОРА. Пока подлодка не сделала первый выстрел, враг её не видит и не может взять в цель: вражеские корабли пройдут мимо, даже вплотную. Выстрелила — засветилась до конца матча (у каждой лодки свой счёт). Всё остальное как у обычного корабля: патруль, ремонт в порту, перехват чужих лодок, здоровье. ЧЕСТНО О ГЛАВНОМ: «не берёт в цель» — настоящее правило игры, одинаковое у всех. А «не видит» — это только отрисовка: расчёт матча идёт на каждом компьютере, поэтому переделанный клиент подлодку всё же увидит (так же устроен и туман войны).`,
      `While the HQ stands, ALL your warships are submarines: a different silhouette on the map and, above all, a HEAD START. Until a submarine fires its first shot, the enemy cannot see it or target it — enemy ships will sail right past. Once it fires, it stays revealed for the rest of the match (each boat separately). Everything else is a normal warship: patrol, repairs in port, intercepting trade ships, health. AN HONEST NOTE: "cannot target" is a real game rule, identical for everyone. "Cannot see", though, is only rendering: the match is simulated on every player's computer, so a modified client would still see the submarine (fog of war works the same way).`,
    ),
  },
  {
    slug: "oil_rig",
    type: UnitType.OilRig,
    name: bi("Нефтяная вышка", "Oil Rig"),
    kind: bi(
      "Ультимейт · строится только в океане · копий сколько угодно",
      "Ultimate · ocean only · unlimited copies",
    ),
    cost: bi(
      `${gold(TUN.oilRigBaseCost)} за каждую · постройка ${TUN.oilRigBuildSec} с`,
      `${gold(TUN.oilRigBaseCost)} each · ${TUN.oilRigBuildSec}s build`,
    ),
    what: bi(
      `Единственное строение, которое ставится НЕ на землю, а прямо в ОКЕАН — где угодно, хоть посреди моря (реки и озёра не годятся, и суши не должно быть ближе ${TUN.oilRigLandGuard} тайлов — это платформа в открытом море). Выплата за рейс у вышки в ${TUN.oilRigTradeMult} раз больше портовой, и лодки выбирают её целью в ${TUN.oilRigWeight} раз охотнее — рейсы идут потоком. Плюс она чинит твои корабли в ${TUN.oilRigHealMult} раз быстрее порта. ЧЕГО ОНА НЕ ДЕЛАЕТ: своих торговых кораблей вышка НЕ отправляет, только принимает — за это и подняты множители. Доход растёт с дальностью рейса, поэтому вышка подальше от берега кормит лучше. ЧЕГО У НЕЁ НЕТ: рельсов (в море их не проложить) и защиты территорией — земли вокруг не захватить, поэтому и саму вышку захватить нельзя, её убивает только ядерка. НО и вечной она не будет: проиграл, тайлов ноль — вышки идут ко дну вместе с тобой.`,
      `The only building that goes not on land but straight into the OCEAN — anywhere, even in the middle of the sea (rivers and lakes don't count, and no land within ${TUN.oilRigLandGuard} tiles — it is an open-sea platform). A rig pays ${TUN.oilRigTradeMult}× what a port pays per voyage, and trade ships pick it as a destination ${TUN.oilRigWeight}× more eagerly, so traffic never stops. It also repairs your warships ${TUN.oilRigHealMult}× faster than a port. WHAT IT DOES NOT DO: a rig never sends out its own trade ships, it only receives them — hence the boosted multipliers. Trade gold grows with distance, so a rig far from your shores feeds better. WHAT IT LACKS: rails (you can't lay track at sea) and the protection of territory — there is no land around it to capture, so the rig itself cannot be captured either, and only a nuke kills it. It is not eternal though: lose your last tile and your rigs go down with you.`,
    ),
  },
  {
    slug: "rivers_back",
    type: UnitType.RiversBack,
    name: bi("Реки вспять", "Rivers Back"),
    kind: bi(
      "Здание-штаб · разблокирует водяную ракету",
      "HQ building · unlocks the water missile",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · пуск ${gold(TUN.riversNukeCost)}`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · ${gold(TUN.riversNukeCost)} per launch`,
    ),
    what: bi(
      `Пока гидроузел стоит, из ракетной шахты можно пускать ВОДЯНУЮ РАКЕТУ. Там, где она рванёт, суша НАВСЕГДА становится водой: воронка радиусом ${TUN.riversNukeInner}–${TUN.riversNukeOuter} тайлов с неровной кромкой. Земля не выжигается и не зарастает — её просто больше нет. Здания на затопленных тайлах гибнут вместе с землёй, а сама вода становится проходимой для лодок: можно разрезать перешеек и завести флот туда, куда раньше пути не было. Пускается как атомная (та же шахта и её кулдаун), и ПВО сбивает её как обычную ракету.`,
      `While the hydro complex stands, your missile silo can launch a WATER MISSILE. Wherever it hits, land becomes water FOREVER: a crater of ${TUN.riversNukeInner}–${TUN.riversNukeOuter} tiles with a ragged edge. The ground is not burned and never grows back — it is simply gone. Buildings on flooded tiles die with the ground, and the new water is navigable: you can cut an isthmus and sail a fleet where there was no route before. It launches like an atom bomb (same silo and cooldown), and SAMs shoot it down like any missile.`,
    ),
  },
  {
    slug: "mining",
    type: UnitType.Mining,
    name: bi("Минирование", "Mining"),
    kind: bi("Здание-штаб · пассив", "HQ building · passive"),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build`,
    ),
    what: bi(
      `Пока штаб стоит, при высадке вражеского МОРСКОГО десанта на твой берег ${TUN.miningKillPct} % его войск гибнет на минах ещё до боя. Работает только против морского десанта — воздушный десант и сухопутные атаки мины не задевают.`,
      `While the HQ stands, when an enemy SEA landing hits your shore, ${TUN.miningKillPct}% of its troops die on the mines before the fight. Works only against sea landings — airborne assaults and ground attacks are unaffected.`,
    ),
  },
  {
    slug: "media",
    type: UnitType.Media,
    name: bi("МЕДИА", "Media"),
    kind: bi("Здание-штаб · аура + Раскол", "HQ building · aura + Split"),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build`,
    ),
    what: bi(
      `«Наши действия оправданы — убеждает международное сообщество.» Штаб даёт СРАЗУ ТРИ вещи. ПЕРВОЕ — аура радиусом ${TUN.ministryRadius} тайлов: раз в ${TUN.ministryPeriodSec} с высасывает ${TUN.ministryDrainPct} % войск у каждого враждебного игрока, чья территория попала в радиус (процент — «чем больше населения у жертвы, тем больше сосёт»), и ${TUN.ministryConvertPct} % высосанного отдаёт тебе. ВТОРОЕ — твоё предательство союзов НЕ карается меткой предателя. ТРЕТЬЕ — разблокирует каст «Раскол», сколько угодно раз, пока МЕДИА жива.`,
      `"Our actions are justified — it convinces the international community." The HQ gives THREE things at once. FIRST — a ${TUN.ministryRadius}-tile aura: every ${TUN.ministryPeriodSec}s it drains ${TUN.ministryDrainPct}% of troops from every hostile player whose territory is in range (a percentage — "the bigger the victim's population, the more it drains") and converts ${TUN.ministryConvertPct}% of it to you. SECOND — betraying alliances is NOT punished with the traitor mark. THIRD — it unlocks casting "Split", as many times as you like while Media stands.`,
    ),
    skill: {
      type: UnitType.Split,
      name: bi("Раскол", "Split"),
      what: bi(
        `Точечная «пропаганда» (не ракета). Наводишься на чужую страну — игра рисует «флаг» (прямоугольник 3:2 с буквой Т в центре). Размер флага зависит от ДОЛИ вложенных войск: от ~13 тайлов в высоту при малой доле до ~80 при полной. Тайлы цели внутри флага делятся: ОСНОВА флага (всё, кроме Т) уходит новому боту-сепаратисту «Независимая {ник}» — он навсегда иммунен к схлопыванию, в коротком союзе с тобой на ${TUN.splitAllyAttackerSec} с и с жертвой на ${TUN.splitAllyVictimSec} с. А буква Т — лояльное ядро — ОСТАЁТСЯ ЖЕРТВЕ с таймером ${TUN.splitRescueSec} с: жертва должна за это время пробить коридор от Т к своей основной земле — успела, кусок остался, не успела — окружённую Т поглощает сепаратист. Цена каста: ${gold(TUN.splitBaseGold)} золота плюс вложенные войска (они сгорают и задают размер флага; у сепаратиста население множится на ${TUN.splitTroopMult}, чтобы страна вышла жизнеспособной). Если в основе флага меньше ${TUN.splitMinTiles} тайлов цели, раскол не срабатывает и ничего не списывается.`,
        `A targeted "propaganda" strike (not a missile). Aim at a foreign country — the game draws a "flag" (a 3:2 rectangle with the letter T in the center). Flag size depends on the SHARE of troops invested: from ~13 tiles tall at a small share up to ~80 at full. The target's tiles inside the flag split up: the BASE of the flag (everything but the T) goes to a new separatist bot "Independent {nick}" — permanently immune to collapse, in a short alliance with you for ${TUN.splitAllyAttackerSec}s and with the victim for ${TUN.splitAllyVictimSec}s. And the letter T — the loyal core — STAYS WITH THE VICTIM on a ${TUN.splitRescueSec}s timer: the victim must carve a corridor from the T to their main land in time — succeed and they keep it, fail and the surrounded T is absorbed by the separatist. Cast cost: ${gold(TUN.splitBaseGold)} gold plus the invested troops (they burn and set the flag size; the separatist's population is multiplied by ${TUN.splitTroopMult} so the new country is viable). If fewer than ${TUN.splitMinTiles} target tiles fall in the flag base, the split doesn't fire and nothing is spent.`,
      ),
    },
  },
  {
    slug: "revanchism",
    type: UnitType.Revanchism,
    name: bi("Реваншизм", "Revanchism"),
    kind: bi("Здание-монумент · пассив", "Monument building · passive"),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build`,
    ),
    what: bi(
      `Теряя землю от своего исторического максимума (пика), ты получаешь бонус к защите ВСЕЙ территории. Бонус = потерянная доля × ${TUN.revanchismScale}, максимум +${TUN.revanchismMaxPct} %. Пример: потерял треть пика → примерно +66 % к защите. На пике (ничего не потерял) — ноль. Чем больше срезали от максимума, тем труднее тебя добить. Танковый завод этот бонус НЕ игнорирует — он снимает только защиту бункеров. ВТОРАЯ ПОЛОВИНА УЛЬТЫ — МЕСТЬ: все, кто напал на тебя ПЕРВЫМ, попадают в список обидчиков, и твои атаки по ним идут на +50 % эффективнее. Кого первым тронул ты — в список не попадает. Список ведётся ВСЕГДА, даже пока статуи нет: достроил её посреди чужого наступления — месть заработает сразу по всем, кто успел напасть.`,
      `As you lose land from your historic maximum (peak), you gain a defense bonus across your ENTIRE territory. Bonus = lost fraction × ${TUN.revanchismScale}, capped at +${TUN.revanchismMaxPct}%. Example: lost a third of the peak → roughly +66% defense. At the peak (nothing lost) — zero. The more they've cut from your maximum, the harder you are to finish off. A Tank Factory does NOT ignore this bonus — it only strips bunker defense. THE OTHER HALF OF THE ULTIMATE — REVENGE: everyone who attacked you FIRST goes on a grudge list, and your attacks against them are 50% more effective. Anyone you struck first does not count. The list is kept AT ALL TIMES, even before the statue exists: finish it in the middle of an invasion and the revenge applies immediately to everyone who already attacked you.`,
    ),
  },
  {
    slug: "our_sky",
    type: UnitType.OurSky,
    name: bi("Небо наше", "Our Sky"),
    kind: bi("Антиспутниковый штаб · ПВО", "Anti-satellite HQ · SAM"),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · ракета ${gold(TUN.satStrikeCost)}`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · rocket ${gold(TUN.satStrikeCost)}`,
    ),
    what: bi(
      `Постоянный штаб с тремя эффектами. Первый: штаб САМ является ПВО с радиусом перехвата ×${TUN.ourSkySamMult} от обычного — гигантский купол над страной. Второй: пока штаб стоит, ВСЕ твои ПВО перезаряжаются вдвое быстрее. Третий: штаб разблокирует ракету «Сбить спутники» (${gold(TUN.satStrikeCost)} за запуск): она ${TUN.ourSkyBuildSec} с собирается на твоей земле, и сборка с первой секунды видна ВСЕМ как тревога — носитель можно снести (в этом контрплей). Собралась → пуск → через ${TUN.ourSkyBlastSec} с волна тьмы → на ${TUN.ourSkyBlackoutSec} с у ВСЕХ, кроме тебя, включается туман войны (в командном режиме твои союзники видят). Под туманом видно только свою и союзную территорию плюс кольцо радиусом ${TUN.fogRadius} тайлов вокруг неё и вокруг своих юнитов.`,
      `A permanent HQ with three effects. First: the HQ ITSELF is a SAM with an intercept radius ×${TUN.ourSkySamMult} of a regular one — a giant dome over your country. Second: while it stands, ALL your SAMs reload twice as fast. Third: the HQ unlocks the "Shoot Down Satellites" rocket (${gold(TUN.satStrikeCost)} per launch): it assembles on your land for ${TUN.ourSkyBuildSec}s, broadcast to EVERYONE as an alarm from the first second — the carrier can be torn down (that's the counterplay). Once assembled → launch → ${TUN.ourSkyBlastSec}s later a wave of darkness → for ${TUN.ourSkyBlackoutSec}s fog of war falls over EVERYONE but you (in team mode your allies keep their sight). Under the fog you only see your and allied territory plus a ${TUN.fogRadius}-tile ring around it and around your units.`,
    ),
    ref: bi(
      "Идея ульты навеяна реальной историей — проектом «Вестфорд» (Project West Ford, 1961–1963): ради надёжной военной радиосвязи на орбиту вывели около 480 миллионов тонких медных игл, образовавших искусственное кольцо вокруг Земли. Часть этого материала до сих пор остаётся на орбите — пример того, как военная задача одной страны оставляет след в космосе на поколения вперёд. Буквально — небо наше.",
      "The ability is inspired by real history — Project West Ford (1961–1963): for reliable military radio communications, about 480 million thin copper needles were placed in orbit, forming an artificial ring around the Earth. Some of that material is still in orbit today — an example of how one country's wartime task leaves a mark in space for generations to come. Literally — the sky is ours.",
    ),
  },

  {
    slug: "closed_country",
    type: UnitType.ClosedCountry,
    name: bi("Закрытая страна", "Closed Country"),
    kind: bi(
      "Штаб · пассив · ЗАКРЫТАЯ ульта",
      "HQ · passive · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Пока штаб стоит, все остальные игроки видят вместо твоих параметров «???»: войска и золото в панели игрока и лидерборде, численность твоих атак, подпись войск под ником на карте. Территория, ник и флаг видны — страна закрытая, а не невидимая. Твоя команда (в командном режиме) видит всё. Скрытие — чисто видовое, как невидимость подлодок: симуляция честная, просто чужой интерфейс молчит. Снесли или захватили штаб — страна открывается. Это первая ЗАКРЫТАЯ ульта: в чузере она под замком, пока не открыта на аккаунте — ачивкой «Железный занавес» (победа в алмазном матче с запуском ракеты «Сбить спутники») или покупкой за 500 кровавых алмазов в досье.`,
      `While the HQ stands, every other player sees "???" instead of your numbers: troops and gold in the player panel and leaderboard, the size of your attacks, the troop label under your name on the map. Territory, name and flag stay visible — the country is closed, not invisible. Your team (in team mode) keeps full sight. The hiding is purely visual, like submarine stealth: the simulation is honest, only the enemy's interface goes silent. Raze or capture the HQ and the country opens up. This is the first LOCKED ultimate: it sits behind a padlock in the chooser until unlocked on your account — via the "Iron curtain" achievement (win a diamond match after launching the "Shoot Down Satellites" rocket) or for 500 blood diamonds in your dossier.`,
    ),
    ref: bi(
      "Прототип — любая «закрытая» держава XX века: официальная статистика засекречена, численность армии — государственная тайна, а миру достаётся только фасад. Противник вынужден гадать, что за ним.",
      "The prototype is any 'closed' state of the 20th century: official statistics classified, army size a state secret, and the world gets only the facade. The enemy is left guessing what stands behind it.",
    ),
  },

  {
    slug: "piracy",
    type: UnitType.Piracy,
    name: bi("Пиратство", "Piracy"),
    kind: bi(
      "Штаб · пассив · ЗАКРЫТАЯ ульта",
      "HQ · passive · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Пока штаб стоит, все твои боевые корабли — пиратские лодки: ходят вдвое быстрее (два шага за тик), стоят 100K фиксом (но одна лодка раз в 15 секунд — экономия золота ценой времени), снаряд бьёт вдвое слабее, а здоровья всего 200 — один снаряд обычного корабля или два пиратских. Стиль «рой»: много дешёвых быстрых лодок на торговлю и десант, но один на один линейный корабль их топит. ПАССИВ «тихие высадки»: десант отправляется ТОЛЬКО из своих портов (не дальше ${TUN.pirateStealthPortRadius} тайлов), зато не шлёт жертве тревогу, не оставляет след и невидим врагу, пока не подойдёт к берегу на ${TUN.pirateStealthRadius} тайлов. КАСТ «Блокада» (${gold(TUN.blockadeCost)} + лодки): точка в океане не дальше ${TUN.blockadePortRange} тайлов от своего порта, туда плывут твои пиратские лодки (сколько — по слайдеру атаки); доплыв, они встают на якорь и кружат, а вокруг поднимается зона-ФЛАГ, которую чужие корабли обходят, — Ормузский пролив. Размер от числа лодок: первые 10 по +10 %, дальше всё меньше; 15 лодок — полуширина ${TUN.blockadeHw15} тайлов. Убрать зону можно только перебив лодки (ядерка, дроны): меньше живых — меньше флаг. Снёс или потерял штаб — всё возвращается. Открывается ачивкой «Чёрный флаг» (потопи 500 кораблей И захвати 500 торговых) или за 500 кровавых алмазов.`,
      `While the HQ stands, all your warships are pirate boats: twice as fast (two steps per tick), a flat 100K each (but one boat per 15 seconds — saving gold at the cost of time), a shell hits half as hard, and they have only 200 HP — one shell from a regular warship or two pirate ones. A swarm style: many cheap fast boats against trade and landings, but a warship sinks them one on one. PASSIVE "silent landings": transports launch ONLY from your ports (within ${TUN.pirateStealthPortRadius} tiles) but send no alarm, leave no trail and stay invisible to the enemy until ${TUN.pirateStealthRadius} tiles from the shore. CAST "Blockade" (${gold(TUN.blockadeCost)} + boats): a spot in the ocean within ${TUN.blockadePortRange} tiles of your port; your pirate boats sail there (how many — by the attack slider); on arrival they anchor and circle, and a FLAG-shaped zone rises that other nations' ships route around — a Strait of Hormuz. Size grows with the boat count: the first 10 add 10% each, then less; 15 boats — half-width ${TUN.blockadeHw15} tiles. The only way to lift it is to kill the boats (nukes, drones): fewer alive — smaller flag. Raze or lose the HQ and everything reverts. Unlocked by the "Black flag" achievement (sink 500 ships AND capture 500 trade ships) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Карибские пираты XVII века редко принимали бой с линейным кораблём: шлюп и бригантина выигрывали ходом и брали торговца на абордаж, а не в артиллерийской дуэли.",
      "Caribbean pirates of the 17th century rarely fought a ship of the line: sloops and brigantines won on speed and boarded merchantmen rather than winning gunnery duels.",
    ),
  },

  {
    slug: "pride",
    type: UnitType.Pride,
    name: bi("Гордость", "Pride"),
    kind: bi(
      "Штаб · пассив + каст · ЗАКРЫТАЯ ульта",
      "HQ · passive + cast · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.prideCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.prideCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Ульта маленьких и гордых. Самый дешёвый штаб в игре (${gold(TUN.prideCost)}). Сила зависит от места в топе: k = 1 − твоя территория / территория лидера. Прирост населения и доход золота умножаются на (1 + k): последнему — вдвое, середняку с половиной земель лидера — в полтора, лидеру — ничего. Атаку и защиту не трогает. КАСТ «Передышка» (${gold(TUN.respiteCost)} + войска): мир вокруг тебя — тебя не атакуют и ты не атакуешь (ракеты и ПВО работают), идущие атаки отзываются. Слайдер атаки задаёт долю сгорающих войск и длительность: ${TUN.respite20} с за 20 %, ${TUN.respite50} с за 50 %, ${TUN.respite100} с за всё. На время передышки бонусы Гордости удваиваются — окно камбэка. Перезарядки нет. Открывается ачивкой «Феникс» (занять ${TUN.prideKeyPeak} % карты, упасть до ${TUN.prideKeyDip} % и всё равно выиграть) или за 500 кровавых алмазов.`,
      `The ultimate of the small and proud. The cheapest HQ in the game (${gold(TUN.prideCost)}). Its power depends on your place: k = 1 − your territory / the leader's. Population growth and gold income are multiplied by (1 + k): doubled for the last, ×1.5 for someone with half the leader's land, nothing for the leader. Attack and defense untouched. CAST "Respite" (${gold(TUN.respiteCost)} + troops): peace around you — nobody attacks you and you attack nobody (missiles and SAMs keep working), attacks under way are recalled. The attack slider sets the share of troops burned and the duration: ${TUN.respite20}s for 20%, ${TUN.respite50}s for 50%, ${TUN.respite100}s for all. Pride bonuses double for the duration — a comeback window. No cooldown. Unlocked by the "Phoenix" achievement (hold ${TUN.prideKeyPeak}% of the map, fall to ${TUN.prideKeyDip}%, still win) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Маленькие гордые страны XX века: чем сильнее давили, тем выше рождаемость и тем упрямее экономика — и передышка, выторгованная кровью, всегда шла на рост, а не на отдых.",
      "Small proud nations of the 20th century: the harder they were pressed, the higher the birth rate and the stubborner the economy — and a respite bought with blood always went into growth, not rest.",
    ),
  },

  {
    slug: "olympics",
    type: UnitType.Olympics,
    name: bi("Олимпийский стадион", "Olympic Stadium"),
    kind: bi(
      "Штаб · пассив + каст «Олимпийские игры» · ЗАКРЫТАЯ ульта",
      'HQ · passive + "Olympic Games" cast · LOCKED ultimate',
    ),
    cost: bi(
      `${gold(TUN.olympicsCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.olympicsCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Стадион: пока стоит, прирост населения и доход золота +${TUN.olympicsBonusPct} %. КАСТ «Олимпийские игры» (${gold(TUN.truceCost)}): мир во всём мире на ${TUN.truceSec} с — все всем друзья: никто никого не атакует, корабли не стреляют, ПВО не перехватывает (ракеты летят), идущие атаки отзываются. Бонус стадиона на это время — +${TUN.olympicsGamesBonusPct} %. Перезарядка ${TUN.truceCooldownMin} мин. Открывается ачивкой «Олимпийский резерв» (заработай ${gold(TUN.olympicsKeyGold)} золота за карьеру) или за 500 кровавых алмазов.`,
      `Stadium: while it stands, population growth and gold income are +${TUN.olympicsBonusPct}%. CAST "Olympic Games" (${gold(TUN.truceCost)}): world peace for ${TUN.truceSec}s — everyone is everyone's friend: no attacks, ships don't fire, SAMs don't intercept (missiles still fly), attacks under way are recalled. The stadium bonus rises to +${TUN.olympicsGamesBonusPct}% for the duration. ${TUN.truceCooldownMin} min cooldown. Unlocked by the "Olympic reserve" achievement (earn ${gold(TUN.olympicsKeyGold)} gold over your career) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Экехейрия — античное олимпийское перемирие: на время Игр греческие полисы прекращали войны, чтобы атлеты и зрители добрались до Олимпии.",
      "Ekecheiria — the ancient Olympic truce: for the Games, Greek city-states halted their wars so athletes and spectators could reach Olympia.",
    ),
  },

  {
    slug: "fanaticism",
    type: UnitType.Fanaticism,
    name: bi("Фанатизм", "Fanaticism"),
    kind: bi(
      "Штаб · пассив + каст · ЗАКРЫТАЯ ульта",
      "HQ · passive + cast · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Пока штаб стоит: население растёт ×${TUN.fanaticTroopsMult}, доход золота ×${TUN.fanaticGoldMult}, а атаки вдвое менее эффективны — твои атакующие теряют ×${TUN.fanaticAttackLoss} войск (как анти-Танковый завод). Стиль: толпа вместо качества — держишь землю числом и пугаешь соседей. КАСТ «Террор» (${gold(TUN.terrorCost)} + войска): укажи чужую страну — ${TUN.terrorSec} с у неё по одному взрываются случайные достроенные здания. Слайдер атаки задаёт долю сгорающих войск и число взрывов: ${TUN.terrorBlasts10} за 10 %, ${TUN.terrorBlasts50} за 50 %, ${TUN.terrorBlasts100} за всё. Рекаст в ту же цель — параллельно. Открывается ачивкой «Ветеран террора» (50 побед против живых ИЛИ 10 алмазных) или за 500 кровавых алмазов.`,
      `While the HQ stands: population grows ×${TUN.fanaticTroopsMult}, gold income ×${TUN.fanaticGoldMult}, and attacks are half as effective — your attackers lose ×${TUN.fanaticAttackLoss} troops (an anti-Tank Factory). The style: mass over quality — hold land by numbers and scare the neighbours. CAST "Terror" (${gold(TUN.terrorCost)} + troops): aim at an enemy country — for ${TUN.terrorSec}s its finished buildings blow up one by one. The attack slider sets the share of troops burned and the number of blasts: ${TUN.terrorBlasts10} for 10%, ${TUN.terrorBlasts50} for 50%, ${TUN.terrorBlasts100} for all. Recast on the same target stacks. Unlocked by the "Veteran of terror" achievement (50 wins against real players OR 10 diamond wins) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Режимы, ставившие идеологию выше экономики: рекордная рождаемость и мобилизация при пустой казне и армии, которую гнали в лоб.",
      "Regimes that put ideology above the economy: record birth rates and mobilisation with an empty treasury and an army sent in head-on.",
    ),
  },

  {
    slug: "peace_palace",
    type: UnitType.PeacePalace,
    name: bi("Дворец наций", "Palace of Nations"),
    kind: bi(
      "Штаб · пассив + каст · ЗАКРЫТАЯ ульта",
      "HQ · passive + cast · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Ведомство, которое занимается войной. КАСТ «Пакт» (${gold(TUN.pactCost)}): укажи страну живого игрока — между вами насильно заключается союз на ${TUN.pactMin} минут. Мир симметричный: ты тоже его не бьёшь. Идущие атаки докатываются, замораживаются только новые. Одна цель одновременно; на ту же цель снова — не раньше чем через ${TUN.pactRecastMin} минут после истечения. Ценность не в том, что тебя перестали бить, а в том, что противник теперь ОБЯЗАН воевать с кем-то другим: фронт с тобой заморожен, его армия разворачивается на соседа. Жертва может порвать пакт — как обычное предательство. ПАССИВ 1: кто предал тебя, ходит предателем ${TUN.peaceTraitorSec} с вместо 30 (метка глобальная — минуту его едят все). ПАССИВ 2: нации всегда принимают твой запрос союза, но не более ${TUN.peaceNationAllies} нацио-союзов одновременно. Нациям пакт навязывать незачем — для них пассив. Открывается ачивкой «Преданный» (тебя предали 20 раз за карьеру) или за 500 кровавых алмазов.`,
      `The ministry that handles war. CAST "Pact" (${gold(TUN.pactCost)}): aim at a living player's country — an alliance is forced between you for ${TUN.pactMin} minutes. Peace is symmetric: you can't hit them either. Attacks already under way roll on; only new ones are frozen. One target at a time; the same target again no sooner than ${TUN.pactRecastMin} minutes after the pact expires. The value isn't that they stopped hitting you — it's that they now MUST fight someone else: the front with you is frozen, their army turns on a neighbour. The victim may break the pact — as ordinary treason. PASSIVE 1: whoever betrays you stays a traitor for ${TUN.peaceTraitorSec}s instead of 30 (the mark is global — everyone feasts on them for a minute). PASSIVE 2: nations always accept your alliance request, up to ${TUN.peaceNationAllies} nation alliances at once. Nations don't need a pact forced on them — the passive covers them. Unlocked by the "Betrayed" achievement (be betrayed 20 times over your career) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Брестский мир 1918 года: навязанный договор, который один фронт закрыл, чтобы армия пошла на другой.",
      "The Treaty of Brest-Litovsk, 1918: an imposed treaty that closed one front so the army could march on another.",
    ),
  },
  {
    type: UnitType.Greens,
    slug: "greens",
    name: bi("Зелёные", "The Greens"),
    kind: bi(
      "Штаб · пассив + каст · ЗАКРЫТАЯ ульта",
      "HQ · passive + cast · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Партия, которая отказалась от атома и заставляет платить тех, кто не отказался. ПЛАТА: пока штаб стоит, ядерное оружие тебе недоступно ВООБЩЕ — ни своё, ни из захваченных у врага шахт, обойти запрет завоеванием нельзя. Плюс −${TUN.greensGoldPct}% дохода. ВЗАМЕН: ракетные шахты дают население как города (ракетную базу переделали в жилой городок), прирост +${TUN.greensTroopPct}%, радиация сама отступает от твоих границ вглубь пепельного поля, а выжженную землю ты забираешь в ${TUN.greensFalloutEase} раз дешевле по войскам. ВОЗМЕЗДИЕ: каждому, чья ядерка успешно сдетонировала, встаёт штраф к доходу — обычная 1 ступень, водородная 2, МИРВ сразу 3, водяная 0 (затопление экологически чисто). Ступень = ${TUN.catastropheStepPct}%, потолок ${TUN.catastropheMaxPct}%, ${TUN.catastropheSec} с, продлевается новыми взрывами. Штраф везёт ГРАЖДАНСКИЙ БОРТ: он вылетает из штаба к воронке, и наказание встаёт по прилёту. Сбить его нельзя — это торговый самолёт, а не ракета. Ответ ровно один: успеть снести штаб Зелёных, пока борт в воздухе. КАСТ «Это катастрофа!» (${gold(TUN.catastropheCost)}): травля ЛЮБОЙ страны, даже той, что вообще не бомбила — ступень в ту же общую шкалу. Кап общий, поэтому на закоренелого бомбилу каст тратить бессмысленно: он для мирных богачей. Прирост войск штраф не трогает намеренно — жертва остаётся с растущей армией без денег, и её выталкивает в атаку. Открывается ачивкой «Чистые руки» (50 побед без единой ядерки) или за 500 кровавых алмазов.`,
      `The party that gave up the atom and makes everyone who didn't pay for it. THE PRICE: while the HQ stands you cannot launch any nuclear weapon at all — not your own, not from silos captured off an enemy, so conquest is no loophole. Plus -${TUN.greensGoldPct}% income. IN EXCHANGE: your missile silos house people like cities do (the rocket base was turned into a housing estate), troop growth +${TUN.greensTroopPct}%, radiation retreats from your borders into the ash field on its own, and burnt land costs ${TUN.greensFalloutEase}x fewer troops to retake. RETRIBUTION: anyone whose nuke successfully detonates takes an income penalty — one step for an atom bomb, two for a hydrogen bomb, three at once for a MIRV, zero for a water nuke (flooding is ecologically clean). A step is ${TUN.catastropheStepPct}%, the cap ${TUN.catastropheMaxPct}%, lasting ${TUN.catastropheSec}s and refreshed by new blasts. The penalty is delivered by a CIVILIAN AIRLINER: it flies from the HQ to the crater and the punishment lands when it arrives. It cannot be shot down — it is a trade plane, not a missile. There is exactly one answer: destroy the Greens HQ while the plane is still in the air. CAST "It's a Catastrophe!" (${gold(TUN.catastropheCost)}): hound ANY country, even one that never bombed anybody — one step into the same shared scale. The cap is shared, so spending it on a habitual bomber is pointless: it is meant for peaceful rich neighbours. The penalty deliberately leaves troop growth alone — the victim keeps a growing army with no money, which pushes them to attack. Unlocked by the "Clean Hands" achievement (50 wins without launching a single nuke) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Зелёные партии Европы 1980-х: выросли на антиядерном движении и добились закрытия АЭС в целых странах.",
      "The European Green parties of the 1980s: they grew out of the anti-nuclear movement and got whole countries to shut their reactors down.",
    ),
  },

  {
    type: UnitType.NuclearPlant,
    slug: "nuclear_plant",
    name: bi("Ядерная энергетика", "Nuclear Power"),
    kind: bi(
      "Штаб · пассив + каст · ЗАКРЫТАЯ ульта",
      "HQ · passive + cast · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Прямой антипод Зелёных: те наказывают за радиацию, эта на ней живёт. ПАССИВЫ: ядерное оружие дешевле на ${TUN.nuclearDiscountPct}%, а выжженная земля забирается в ${TUN.nuclearFalloutEase} раза дешевле по войскам — «ликвидаторы». Второе важнее, чем кажется: свежая воронка обычно непроходима и её обходят, а для тебя она коридор. Кто-то бомбанул соседа — ты уже там, и особенно хорошо это работает с десантом прямо в пепел, куда враг не сунется. КАСТ «Рекультивация» (${gold(TUN.recultCost)}): мгновенно снимает пепел в радиусе ${TUN.recultRadius}, наводится куда угодно — на себя или на чужую страну, спрашивать не надо. За каждый убранный тайл ${TUN.recultPerTile} золота: со своей земли деньги печатаются, с чужой — списываются из казны того, чья это была земля. Платит ВЛАДЕЛЕЦ ЗЕМЛИ, а не тот, кто бомбил: прилетело чужой ракетой — счёт всё равно тебе. За ничейную пустошь не платит никто. Выплата за целую воронку намеренно НИЖЕ цены ракеты со скидкой, поэтому бомбить свою пустыню ради уборки — всегда в минус. «ЧЕРНОБЫЛЬ»: любая потеря станции — снёс враг, забрали вместе с землёй, подорвал сам — через ${TUN.chernobylSec} с даёт на её месте взрыв водородной мощности и радиоактивный след. Минута задержки честная: занявшие площадку успевают уйти, если сообразили. Открывается ачивкой «Атомщик» (500 ядерок за карьеру) или за 500 кровавых алмазов.`,
      `The direct antipode of the Greens: they punish radiation, this one lives off it. PASSIVES: nuclear weapons cost ${TUN.nuclearDiscountPct}% less, and burnt land takes ${TUN.nuclearFalloutEase}x fewer troops to retake — the "liquidators". The second matters more than it looks: a fresh crater is normally impassable and gets walked around, but for you it is a corridor. Somebody nuked their neighbour — you are already there, and it works especially well with an airborne drop straight into the ash, where no enemy will follow. CAST "Land Reclamation" (${gold(TUN.recultCost)}): instantly clears ash within radius ${TUN.recultRadius}, aimed anywhere — at yourself or at another country, no asking. Every tile cleared pays ${TUN.recultPerTile} gold: on your own land it is minted, on someone else's it is billed out of the treasury of whoever owned that ground. The LAND OWNER pays, not the bomber: hit by a stranger's missile, and the cleanup invoice is still yours. Nobody pays for open wasteland. The payout for a whole crater is deliberately BELOW the discounted price of the missile, so bombing your own desert to farm cleanup is always a loss. "CHERNOBYL": any loss of the plant — destroyed by an enemy, taken with the ground, or blown up by your own hand — produces a hydrogen-scale blast and fallout on the site ${TUN.chernobylSec}s later. The delay is honest: whoever took the site can still walk away if they work out what they took. Unlocked by the "Atomic" achievement (500 nukes launched over your career) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Чернобыль 1986 года и «ликвидаторы» — люди, которых посылали работать там, где остальные не могли находиться вовсе.",
      "Chernobyl, 1986, and the liquidators — people sent to work where nobody else could stand at all.",
    ),
  },

  {
    type: UnitType.Fuel,
    slug: "fuel",
    name: bi("Топливо", "Fuel"),
    kind: bi(
      "Штаб · пассив + каст · ЗАКРЫТАЯ ульта",
      "HQ · passive + cast · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Логистическая ульта. ПАССИВ: всё твоё, что едет своим ходом, движется в ${TUN.fuelSpeedMult} раза быстрее — боевые корабли, десантные лодки, торговые лодки, самолёты и вагоны. Дроны и ракеты НЕ ускоряются намеренно: ульта про перевозку, а не про оружие. Плюс твои торговые лодки нельзя перехватить. КАСТ «Индустриальная революция» (${gold(TUN.industrialCost)}): наводится на ЛЮБУЮ страну, включая СВОЮ — на ${TUN.industrialMin} минуты цель получает ×${TUN.industrialSpeedMult} скорость и −${TUN.industrialTroopPct}% прироста населения. Это первый каст в ростере с ДВОЙНЫМ СМЫСЛОМ, и в этом весь замысел: торговцу он подарок, союзнику — реальная услуга, о которой попросят в чате, а воюющему — удавка, потому что логистика ему не нужна, а половины прироста нет. На себя это окно рывка: перебросить десант через полкарты за минуту, заплатив армией. Отказаться нельзя. Не стакается: на стране, где революция уже идёт, второй каст не проходит. Открывается ачивкой «Нефтяник» (держать ${TUN.fuelKeyOilRigs} нефтяных вышек одновременно) или за 500 кровавых алмазов.`,
      `The logistics ultimate. PASSIVE: everything of yours that moves under its own power goes ${TUN.fuelSpeedMult}x faster — warships, landing craft, trade ships, aircraft and trains. Drones and missiles are deliberately excluded: this is about hauling, not weapons. Your trade ships also become impossible to intercept. CAST "Industrial Revolution" (${gold(TUN.industrialCost)}): aim at ANY country, including your own — for ${TUN.industrialMin} minutes the target moves ${TUN.industrialSpeedMult}x faster and loses ${TUN.industrialTroopPct}% of its population growth. This is the first cast in the roster that cuts BOTH WAYS, and that is the whole point: to a trader it is a gift, to an ally a real favour they will ask for in chat, and to a warmonger a noose — logistics are no use to them and half their growth is gone. On yourself it is a burst window: run a landing across half the map in a minute and pay for it in troops. It cannot be refused. It does not stack: a country already in revolution cannot be hit again. Unlocked by the "Oil Baron" achievement (hold ${TUN.fuelKeyOilRigs} oil rigs at once) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Ленд-лиз: война выигрывается не только пушками, но и тем, как быстро их довозят.",
      "Lend-Lease: wars are won not only by guns but by how fast they arrive.",
    ),
  },

  {
    type: UnitType.RailGun,
    slug: "rail_gun",
    name: bi("Дора", "Dora"),
    kind: bi(
      "Едущее здание · пассив + каст · ЗАКРЫТАЯ ульта",
      "Rolling structure · passive + cast · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Тяжёлое железнодорожное орудие — здание, которое ЕДЕТ. Само оно бьёт всего на ${TUN.railGunRange} тайлов, но ходит по железной дороге, а рельсы прорастают между твоими зданиями. Отсюда главное: ДАЛЬНОБОЙНОСТЬ ДОРЫ — ЭТО ТВОЯ ЗАСТРОЙКА. Хочешь достать соседа — двигай города к его границе; это не абстрактный радиус, а территориальная экспансия, за которую надо платить и которую видно всем. Враг смотрит на карту, видит ползущую к нему застройку и понимает, чем это кончится, — предупреждение делает сама география. КАСТ «Выстрел» (${gold(TUN.railGunShotCost)}): укажи цель на любой суше. В радиусе — орудие бьёт по готовности перезарядки (${TUN.railGunReloadSec} с); вне радиуса — само едет по рельсам, пока не достанет. Снаряд попадает МГНОВЕННО и не перехватывается: это артиллерия, а не ракета, и контрплея у снаряда быть не должно — вся защита вынесена на этап подвоза. КОНТРПЛЕЙ НЕ В ПУШКЕ, А В ПУТЯХ: снеси станцию ЗА орудием, и оно застрянет там, где стояло, отрезанное от сети. Убить можно и напрямую — захватить вместе с землёй, снести дроном или ядеркой. Дору разрешено возить по земле союзника, но разорвал союз — через ${TUN.railGunGraceSec} с она взрывается на месте. Открывается ачивкой «Осадный» (снести ${TUN.railGunKeyDroned} вражеских зданий дронами) или за 500 кровавых алмазов.`,
      `A heavy railway gun — a building that DRIVES. It only reaches ${TUN.railGunRange} tiles on its own, but it rolls along the railway network, and rails grow between your buildings. Hence the point: DORA'S RANGE IS YOUR CONSTRUCTION. To hit a neighbour, push your cities toward their border; that is not an abstract radius but territorial expansion you have to pay for and that everyone can see. The enemy looks at the map, watches your buildings creep closer, and knows what is coming — the warning is made by geography itself. CAST "Strike" (${gold(TUN.railGunShotCost)}): mark a target on any land. In range, the gun fires once its ${TUN.railGunReloadSec}s reload is done; out of range, it drives along the rails until it can reach. The shell lands INSTANTLY and cannot be intercepted: this is artillery, not a missile, and a shell should have no counterplay — all the defence lives in the haul. THE COUNTERPLAY IS NOT THE GUN BUT THE TRACKS: destroy the station behind it and it is stranded where it stands, cut off from the network. You can also kill it directly — capture it with the ground, or destroy it with drones or a nuke. Dora may be parked on allied land, but break that alliance and it detonates ${TUN.railGunGraceSec}s later. Unlocked by the "Siege" achievement (destroy ${TUN.railGunKeyDroned} enemy buildings with drones) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Schwerer Gustav, 1942: самое большое орудие в истории. На бумаге чудо-оружие, на деле — логистическая проблема, которой нужна была собственная железная дорога и тысячи людей.",
      "Schwerer Gustav, 1942: the largest gun ever built. A wonder weapon on paper; in practice a logistics problem that needed its own railway and thousands of men.",
    ),
  },

  {
    type: UnitType.Spaceport,
    slug: "spaceport",
    name: bi("Космодром", "Spaceport"),
    kind: bi(
      "Штаб · пассив · ЗАКРЫТАЯ ульта",
      "HQ · passive · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Единственная ульта, которая растёт на ЧУЖОМ богатстве, а не на своём. Раз в ${TUN.spaceportPeriodSec} с с площадки уходит запуск: ты получаешь ${gold(TUN.spaceportFlat)} плюс ${TUN.spaceportTaxPct}% дохода, который каждая другая страна заработала за эту минуту — и этот процент С НИХ СПИСЫВАЕТСЯ. Процент берётся именно от ДОХОДА за период, а не от баланса: доход величина ограниченная, поэтому ульта остаётся линейной и не превращается в снежный ком к концу матча. Каждый запуск объявляется в ленте ВСЕМ и с цифрой — ненависть к владельцу должна быть адресной, иначе процент никто не заметит. Ставится на своей земле или В ОКЕАНЕ, как нефтяная вышка: морская площадка дороже, но отдаёт в ${TUN.spaceportSeaMult} раза больше. Открывается ачивкой «Первый в космосе» (${gold(TUN.spaceportKeyGold)} золота за карьеру) или за 500 кровавых алмазов.`,
      `The only ultimate that grows on OTHER people's wealth rather than your own. Every ${TUN.spaceportPeriodSec}s a launch goes up: you collect ${gold(TUN.spaceportFlat)} plus ${TUN.spaceportTaxPct}% of the income every other country earned during that minute — taken straight out of their pockets. The cut is taken from INCOME over the period, not from balances: income is a bounded quantity, so the ultimate stays linear instead of snowballing late in a match. Every launch is announced to everyone with the figure attached — resentment should be aimed at you by name, or nobody would notice the tax at all. Build it on your own land or OUT AT SEA like an oil rig: the sea pad costs more but pays ${TUN.spaceportSeaMult}x. Unlocked by the "First in Space" achievement (${gold(TUN.spaceportKeyGold)} gold over your career) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Частные космодромы XXI века: запуски показывают всем, а платит за них в итоге кто-то другой.",
      "The private launch pads of the 21st century: everyone watches the rocket, and somebody else foots the bill.",
    ),
  },

  {
    type: UnitType.TrainDepot,
    slug: "train_depot",
    name: bi("Взрывные поезда", "Demolition Trains"),
    kind: bi("Штаб · пассив + каст", "HQ · passive + cast"),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build`,
    ),
    what: bi(
      `Депо, которое живёт на той же железной дороге, что и «Дора», но пользуется ею наоборот: не привозит орудие к цели, а отправляет к ней сам поезд. ПАССИВ: твои торговые составы ходят вдвое быстрее — больше рейсов, больше денег с тех же станций. КАСТ «Состав смерти» (${gold(TUN.trainsCost)}): укажи точку, и от депо по ТВОИМ рельсам уходит тикающий поезд. Он едет к ближайшей к цели точке твоей сети и там детонирует взрывом дронного калибра. Состав ВИДЕН ВСЕМ и над ним идёт отсчёт — это не диверсия исподтишка, а угроза, на которую можно ответить. КОНТРПЛЕЙ ПРЯМОЙ И ЧЕСТНЫЙ: рви пути перед ним. Потерял рельсу под следующим шагом — рванёт ТАМ, не доехав, и чем глубже ты его загнал, тем обиднее промах. По чужим рельсам состав не пойдёт: земля другого игрока перегон закрывает — иначе поезд превращался бы в неубиваемый сюрприз из ниоткуда.`,
      `A depot that lives on the same railway as Dora but uses it the other way round: instead of hauling a gun to the target it sends the train itself. PASSIVE: your trade trains run twice as fast — more runs, more gold from the same stations. CAST "Doom Train" (${gold(TUN.trainsCost)}): mark a spot and a ticking train leaves the depot along YOUR rails. It drives to the point of your network closest to the target and detonates there with a drone-sized blast. The train is VISIBLE to everyone and carries a countdown above it — this is a threat you can answer, not a sneak attack. THE COUNTERPLAY IS DIRECT: tear up the rails in front of it. Lose the rail under its next step and it blows up THERE, short of the target — the deeper you sent it, the worse the miss. It will not run on foreign rails: another player's ground closes the segment, otherwise the train would be an unkillable surprise out of nowhere.`,
    ),
    ref: bi(
      "Брандеры и «адские машины» XIX века: набить транспорт взрывчаткой и пустить по готовому пути — идея старше самих железных дорог.",
      "Fire ships and the infernal machines of the 19th century: fill a vehicle with explosives and send it down a track that already exists — an idea older than railways themselves.",
    ),
  },

  {
    type: UnitType.WalkingCity,
    slug: "walking_city",
    name: bi("Шагающий город", "Walking City"),
    kind: bi("Штаб · каст", "HQ · cast"),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build`,
    ),
    what: bi(
      `Архитектура, отвязанная от земли: твои здания умеют ХОДИТЬ. Каст «Перенос» (${gold(TUN.walkCost)}) — два клика: сначала зона (её размер задаёт ползунок войск, тратится до ${TUN.walkRatioMaxPct}% — поставил больше, спишется ровно кап), затем точка назначения на своей земле. Здания из зоны снимаются с фундамента и идут туда со скоростью 1 тайл в секунду, ПРОДОЛЖАЯ РАБОТАТЬ в пути: шахта на марше — всё ещё шахта. Порты ходят только вдоль воды, сухопутные здания в воду не заходят, всё движение — по СВОЕЙ территории: потерял землю под маршрутом — здание постоит, подождёт и останется там, где застало. На месте прибытия городок встаёт плотно, «битком». Второй перенос можно объявлять сразу, не дожидаясь, пока дойдёт первый.`,
      `Architecture untethered from the ground: your buildings can WALK. The "Relocation" cast (${gold(TUN.walkCost)}) takes two clicks: first a zone (its size follows the troop slider, spending up to ${TUN.walkRatioMaxPct}% — set more and exactly the cap is charged), then a destination on your own land. Buildings in the zone lift off their foundations and walk there at one tile per second, WORKING all the way: a silo on the march is still a silo. Ports only walk along the coast, land buildings never enter water, and every step is on YOUR territory — lose the ground under the route and the building waits, then settles where it stands. At the destination the town packs in tight. You may order the next relocation immediately, without waiting for the first to arrive.`,
    ),
    ref: bi(
      "Walking City Арчиграма (1964) — города-организмы на ногах — и Шанхай-2020, где школу весом 7600 тонн реально «прошагали» на новое место на двух сотнях гидравлических ног.",
      "Archigram's Walking City (1964) — leg-borne city organisms — and Shanghai 2020, where a 7,600-ton school was literally walked to a new site on two hundred hydraulic legs.",
    ),
  },

  {
    type: UnitType.PeacefulSky,
    slug: "peaceful_sky",
    name: bi("Мирное небо", "Peaceful Sky"),
    kind: bi(
      "Штаб · пассив · ЗАКРЫТАЯ ульта",
      "HQ · passive · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Твои ПВО стоят на ${TUN.skySamDiscountPct}% дешевле — можно накрыть зонтом всю страну, а не одно направление. ПЛАТА за это необычная: установки начинают сбивать ВСЁ чужое в радиусе, включая ракеты ТВОИХ СОЮЗНИКОВ. В обычной игре союзная ракета пролетает сквозь тебя свободно, здесь — нет: над тобой не летает никто, даже друзья. Значит коалиция больше не может бить «через твою территорию», и тебя перестанут звать коридором. Название буквальное. Открывается ачивкой «Зонт» (сбить ${TUN.skyKeyIntercepts} вражеских ракет за карьеру) или за 500 кровавых алмазов.`,
      `Your SAM launchers cost ${TUN.skySamDiscountPct}% less — enough to umbrella a whole country instead of one approach. The PRICE is unusual: they start shooting down EVERYTHING hostile in range, including YOUR ALLIES' missiles. Normally an allied missile passes over you freely; here it does not. Nobody flies above you any more, not even friends — which means a coalition can no longer strike through your territory, and they will stop treating you as a corridor. The name is literal. Unlocked by the "Umbrella" achievement (intercept ${TUN.skyKeyIntercepts} enemy missiles over your career) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Договор «Открытое небо» наоборот: небо мирное именно потому, что над тобой не летает вообще никто.",
      "The Open Skies Treaty inverted: the sky is peaceful precisely because nobody at all flies over you.",
    ),
  },


  {
    slug: "victory_banner",
    type: UnitType.VictoryBanner,
    name: bi("Знамя победы", "Victory Banner"),
    kind: bi(
      "Штаб · пассив · ЗАКРЫТАЯ ульта",
      "HQ · passive · LOCKED ultimate",
    ),
    cost: bi(
      `${gold(TUN.ultCost)} золота · постройка ${TUN.ultBuildSec} с · открыть: ачивка или 500 💎`,
      `${gold(TUN.ultCost)} gold · ${TUN.ultBuildSec}s build · unlock: achievement or 500 💎`,
    ),
    what: bi(
      `Ульта обезглавливания. Пока штаб стоит: все столицы под твоим контролем — своя и отжатые — платят ×${TUN.bannerCapitalMult} (${gold(TUN.bannerCapitalPerMin)} в минуту с каждой); захваченная столица ОСТАЁТСЯ столицей, а не становится обычным городом; жертва, чья столица под твоим знаменем, не может основать новую; атаки по каждой такой жертве на 50 % эффективнее (по каждой отдельно). Уровень штаба = число удерживаемых чужих столиц. Ничего постоянного: отбили столицу — её бонус ушёл, снесли штаб — погасло всё разом, трофеи демотируются. Жертва может снести свою столицу сама, чтобы не отдать её под знамя. Нации столицы имеют — их трофеи считаются; племена — нет. Открывается ачивкой «Знаменосец» (захвати 100 столиц за карьеру) или за 500 кровавых алмазов.`,
      `The beheading ultimate. While the HQ stands: every capital you hold — your own and the captured ones — pays ×${TUN.bannerCapitalMult} (${gold(TUN.bannerCapitalPerMin)} a minute each); a captured capital STAYS a capital instead of becoming a plain city; a victim whose capital is under your banner cannot found a new one; attacks against each such victim are 50% more effective (per victim). HQ level = number of foreign capitals held. Nothing is permanent: lose a capital and its bonus goes, lose the HQ and everything goes out at once, trophies are demoted. A victim may raze their own capital rather than hand it over. Nations have capitals — their trophies count; tribes don't. Unlocked by the "Standard-bearer" achievement (capture 100 capitals over your career) or for 500 blood diamonds.`,
    ),
    ref: bi(
      "Знамя над чужой столицей — самый старый символ победы: от штандартов на Капитолии до флага над Рейхстагом. Пока оно висит, побеждённый не правитель.",
      "A banner over a foreign capital is the oldest symbol of victory: from standards on the Capitol to the flag over the Reichstag. While it flies, the defeated does not rule.",
    ),
  },
];

// ════════════════════════════════════════════════════════════════════════════
// ЗДАНИЯ
// ════════════════════════════════════════════════════════════════════════════

/** Лестница цены: сколько стоит 1-е, 2-е, 3-е, 4-е здание этого типа. */
function priceLadder(type: UnitType): string {
  return [0, 1, 2, 3].map((i) => costOf(type, i)).join(" → ");
}

export const BUILDINGS: Entry[] = [
  {
    slug: "city",
    type: UnitType.City,
    name: bi("Город", "City"),
    kind: bi("Экономика · население", "Economy · population"),
    cost: bi(
      `${priceLadder(UnitType.City)} золота · постройка ${buildSec(UnitType.City)} с`,
      `${priceLadder(UnitType.City)} gold · ${buildSec(UnitType.City)}s build`,
    ),
    what: bi(
      `Поднимает твой потолок населения на ${troops(CFG.cityTroopIncrease)} за КАЖДЫЙ уровень — считается сумма уровней всех твоих городов. Ещё города работают станциями для торговых поездов: поезд платит золото за каждую остановку. Уровень НЕ увеличивает выплату за поезд, поэтому по населению город N-го уровня равен N отдельным городам ровно, а по поездному доходу отдельные города выгоднее — больше остановок в сети. Цена считается по СУММЕ уровней уже построенных городов и удваивается с каждым: ${priceLadder(UnitType.City)} и дальше потолок ${costOf(UnitType.City, 3)}. Первый построенный город становится СТОЛИЦЕЙ — см. отдельный раздел ниже.`,
      `Raises your population cap by ${troops(CFG.cityTroopIncrease)} per LEVEL — the sum of all your cities' levels. Cities also act as stations for trade trains: a train pays gold for every stop. Level does NOT increase the per-train payout, so for population a level-N city equals N separate cities exactly, while for train income separate cities are better — more stops in the network. Price is based on the SUM of levels already built and doubles each time: ${priceLadder(UnitType.City)}, capping at ${costOf(UnitType.City, 3)}. Your first city becomes the CAPITAL — see the separate block below.`,
    ),
  },
  {
    slug: "factory",
    type: UnitType.Factory,
    name: bi("Фабрика", "Factory"),
    kind: bi("Экономика · поезда", "Economy · trains"),
    cost: bi(
      `от ${costOf(UnitType.Factory)} золота, счётчик цены общий с портами · постройка ${buildSec(UnitType.Factory)} с`,
      `from ${costOf(UnitType.Factory)} gold, price counter shared with ports · ${buildSec(UnitType.Factory)}s build`,
    ),
    what: bi(
      `Строит железную дорогу и САМА запускает торговые поезда к твоим городам, портам и аэропортам в её ж/д-кластере — они везут золото. Каждая фабрика делает роллов спавна поезда столько, сколько у неё уровней, а сам шанс падает с общим числом фабрик — поэтому фабрика 5-го уровня и пять отдельных фабрик 1-го дают ОДИНАКОВОЕ число поездов. Разница в том, что отдельные фабрики дотягиваются рельсами до РАЗНЫХ узлов и делают сеть шире. Дальность связи по рельсам — от ${CFG.railMin} до ${CFG.railMax} тайлов. ВАЖНО: города, порты и аэропорты получают станцию, только если рядом стоит ТВОЯ фабрика; без фабрики поездов нет вообще.`,
      `Builds a railway and SPAWNS trade trains to your cities, ports and airports in its rail cluster — they carry gold. Each factory rolls train spawns as many times as it has levels, while the chance itself drops with your total factory count — so a level-5 factory and five separate level-1 factories spawn the SAME number of trains. The difference is that separate factories reach DIFFERENT nodes by rail and widen the network. Rail linking range is ${CFG.railMin} to ${CFG.railMax} tiles. IMPORTANT: cities, ports and airports only get a station if one of YOUR factories is near; with no factory there are no trains at all.`,
    ),
  },
  {
    slug: "port",
    type: UnitType.Port,
    name: bi("Порт", "Port"),
    kind: bi("Экономика · море", "Economy · sea"),
    cost: bi(
      `от ${costOf(UnitType.Port)} золота, счётчик цены общий с фабриками · постройка ${buildSec(UnitType.Port)} с`,
      `from ${costOf(UnitType.Port)} gold, price counter shared with factories · ${buildSec(UnitType.Port)}s build`,
    ),
    what: bi(
      `Запускает торговые корабли к портам других игроков — они везут золото, и сумма зависит от ДИСТАНЦИИ, а не от уровня. Уровень порта = сколько роллов спавна корабля он делает и сколько раз попадает в список целей чужих торговцев, поэтому порт 5-го уровня примерно равен пяти отдельным портам по обороту. Отдельные порты при этом покрывают разные акватории и дают разные дистанции — а дистанция и есть деньги. Порт ещё и ремонтирует твои боевые корабли: порт N-го уровня чинит до N кораблей разом, +${CFG.warshipPortHealPerLevel} к скорости лечения за уровень. Если торговать не с кем (остров, все чужие порты мертвы), порт начинает возить сам к себе — нужно минимум два своих порта, кулдаун ${DERIVED.portSelfTradeCooldownSec} с.`,
      `Spawns trade ships to other players' ports — they carry gold, and the amount scales with DISTANCE, not level. A port's level = how many ship-spawn rolls it makes and how many times it appears in others' trade-target lists, so a level-5 port is roughly five separate ports by throughput. Separate ports, though, cover different waters and give different distances — and distance is money. A port also repairs your warships: a level-N port heals up to N ships at once, +${CFG.warshipPortHealPerLevel} healing rate per level. With nobody to trade with (an island, all foreign ports dead) a port starts shipping to itself — you need at least two of your own ports, ${DERIVED.portSelfTradeCooldownSec}s cooldown.`,
    ),
  },
  {
    slug: "airport",
    type: UnitType.Airport,
    name: bi("Аэропорт", "Airport"),
    kind: bi("Экономика · авиация", "Economy · aviation"),
    cost: bi(
      `${priceLadder(UnitType.Airport)} золота · постройка ${buildSec(UnitType.Airport)} с`,
      `${priceLadder(UnitType.Airport)} gold · ${buildSec(UnitType.Airport)}s build`,
    ),
    what: bi(
      `Отправляет самолёты-транзиты к своим и чужим аэропортам. Доход рейса равен доходу торгового корабля на той же дистанции, но самолёт летит вдвое быстрее корабля (${CFG.airplaneSpeed} тайла за тик) и не зависит от воды. Радиус охвата — ${CFG.airportRange} тайлов. Борта уходят не часто: примерно один шанс из ${DERIVED.airportDispatchOneIn} за секундную проверку плюс случайная задержка вылета ${DERIVED.airportDelayMinSec}–${DERIVED.airportDelayMaxSec} с, около половины рейсов — на свои же аэропорты. Пролетая над территорией чужого живого игрока, самолёт платит ему ${TUN.airplaneTaxPct} % груза за каждый тик — так что длинный рейс через полматерика довозит меньше, чем ушло. Аэропорт цепляется к ж/д-кластеру фабрики наравне с городом и вдобавок запускает дроны-камикадзе: кулдаун ${CFG.droneCooldown} с на аэропорт.`,
      `Dispatches transit planes to your own and foreign airports. A flight earns the same as a trade ship over the same distance, but a plane flies twice as fast as a ship (${CFG.airplaneSpeed} tiles per tick) and ignores water. Coverage radius is ${CFG.airportRange} tiles. Flights are not frequent: roughly a 1-in-${DERIVED.airportDispatchOneIn} chance per one-second check plus a random ${DERIVED.airportDelayMinSec}–${DERIVED.airportDelayMaxSec}s departure delay, and about half the flights go to your own airports. Flying over another living player's territory, a plane pays them ${TUN.airplaneTaxPct}% of its cargo per tick — so a long haul across half a continent delivers less than it left with. An airport joins a factory's rail cluster like a city does, and it also launches suicide drones: ${CFG.droneCooldown}s cooldown per airport.`,
    ),
  },
  {
    slug: "defense_post",
    type: UnitType.DefensePost,
    name: bi("Бункер", "Defense Post"),
    kind: bi("Военное · оборона", "Military · defense"),
    cost: bi(
      `${priceLadder(UnitType.DefensePost)} золота · постройка ${buildSec(UnitType.DefensePost)} с`,
      `${priceLadder(UnitType.DefensePost)} gold · ${buildSec(UnitType.DefensePost)}s build`,
    ),
    what: bi(
      `Держит круг радиусом ${CFG.defensePostRange} тайлов вокруг себя. Любая вражеская наземная атака внутри этого круга обходится нападающему в ${CFG.defensePostDefenseBonus} раз дороже по потерям войск и идёт в ${CFG.defensePostSpeedBonus} раза медленнее. Бонус НЕ складывается: несколько бункеров на одном участке не дают ×10 — достаточно, чтобы тайл попадал в радиус хотя бы одного. Ещё бункер обстреливает вражеские корабли в радиусе ${CFG.defensePostTargetRange} тайлов, перезарядка ${CFG.defensePostShellRate} с. Танковый завод у нападающего этот бонус полностью снимает. И главное отличие бункера от остальных зданий: при потере тайла он НЕ достаётся врагу, а уничтожается.`,
      `Holds a ${CFG.defensePostRange}-tile radius around itself. Any enemy ground attack inside that circle costs the attacker ${CFG.defensePostDefenseBonus}× more troop losses and advances ${CFG.defensePostSpeedBonus}× slower. The bonus does NOT stack: several bunkers on one front don't give ×10 — it's enough for the tile to fall inside at least one radius. A bunker also shells enemy ships within ${CFG.defensePostTargetRange} tiles, reloading every ${CFG.defensePostShellRate}s. An attacker's Tank Factory strips this bonus entirely. And the key difference from every other building: when its tile is lost, a bunker is destroyed rather than captured.`,
    ),
  },
  {
    slug: "sam_launcher",
    type: UnitType.SAMLauncher,
    name: bi("ПВО", "SAM Launcher"),
    kind: bi("Военное · противоракетная оборона", "Military · missile defense"),
    cost: bi(
      `${priceLadder(UnitType.SAMLauncher)} золота · постройка ${buildSec(UnitType.SAMLauncher)} с`,
      `${priceLadder(UnitType.SAMLauncher)} gold · ${buildSec(UnitType.SAMLauncher)}s build`,
    ),
    what: bi(
      `Сбивает вражеские ракеты, дроны и воздушный десант. Дальность растёт с уровнем: ${CFG.samRangeL1} тайлов на 1-м, около ${CFG.samRangeL5} на 5-м, предел ${CFG.samRangeMax}. Перезарядка ${CFG.samCooldown} с. ПВО стреляет НА УПРЕЖДЕНИЕ: считает точку, где ракета войдёт в радиус, и бьёт туда, поэтому радиус соблюдается строго. Зенитная ракета летит со скоростью ${CFG.samMissileSpeed} — быстрее ядерной (${CFG.nukeSpeed}), поэтому и догоняет. Против МИРВ работает иначе: готовое ПВО прикрывает свой радиус от боеголовок целиком, но тратит на это заряд. Строится дольше всех обычных зданий — ${buildSec(UnitType.SAMLauncher)} с, снести её проще, чем дождаться.`,
      `Shoots down enemy missiles, drones and airborne assaults. Range grows with level: ${CFG.samRangeL1} tiles at level 1, about ${CFG.samRangeL5} at level 5, capped at ${CFG.samRangeMax}. Reload ${CFG.samCooldown}s. A SAM fires with LEAD: it computes where the missile will enter its radius and shoots there, so the radius is strictly enforced. Its interceptor flies at speed ${CFG.samMissileSpeed} — faster than a nuke (${CFG.nukeSpeed}), which is why it catches up. Against MIRV it works differently: a ready SAM shields its whole radius from the warheads, spending its charge to do it. It takes longer to build than any other regular building — ${buildSec(UnitType.SAMLauncher)}s — so tearing one down is easier than waiting it out.`,
    ),
  },
  {
    slug: "missile_silo",
    type: UnitType.MissileSilo,
    name: bi("Ракетная шахта", "Missile Silo"),
    kind: bi("Военное · пуск ракет", "Military · missile launches"),
    cost: bi(
      `${costOf(UnitType.MissileSilo)} золота · постройка ${buildSec(UnitType.MissileSilo)} с`,
      `${costOf(UnitType.MissileSilo)} gold · ${buildSec(UnitType.MissileSilo)}s build`,
    ),
    what: bi(
      `Единственное место, откуда стартуют атомные и водородные бомбы. Цена шахты не растёт с числом построенных — всегда ${costOf(UnitType.MissileSilo)}. После пуска шахта уходит на перезарядку ${CFG.siloCooldown} с; пока она занята, ракета уходит из следующей свободной, а если готовых нет — пуск просто недоступен. Размер залпа считается по УРОВНЯМ: шахта N-го уровня держит N ракет одновременно, ровно как N отдельных шахт. Дальность наведения ${CFG.nukeRange} тайлов от точки пуска.`,
      `The only place atom and hydrogen bombs launch from. A silo's price does not grow with how many you own — always ${costOf(UnitType.MissileSilo)}. After a launch it reloads for ${CFG.siloCooldown}s; while it's busy the next missile flies from another free one, and if none are ready the launch is simply unavailable. Salvo size counts LEVELS: a level-N silo holds N missiles at once, exactly like N separate silos. Targeting range is ${CFG.nukeRange} tiles from the launch point.`,
    ),
  },
];

// ════════════════════════════════════════════════════════════════════════════
// РАЗДЕЛЫ (текстовые)
// ════════════════════════════════════════════════════════════════════════════

export const BUILDINGS_BLOCKS: Block[] = [
  lead(
    "Здания привязаны к тайлу под собой. У них нет очков прочности: здание живёт, пока тайл твой, и переходит вместе с ним. Нажми на иконку — цифры и детали.",
    "Buildings belong to the tile beneath them. They have no hit points: a building lives while the tile is yours, and changes hands with it. Tap an icon for numbers and details.",
  ),
  h("Экономика", "Economy"),
  cards(["city", "factory", "port", "airport"]),
  h("Военные", "Military"),
  cards(["defense_post", "sam_launcher", "missile_silo"]),

  h("Стакинг: уровни зданий", "Stacking: building levels"),
  p(
    "Здания можно строить ДРУГ НА ДРУГА: постройка на своём здании поднимает его УРОВЕНЬ, а не ставит второе. Игра считает здание N-го уровня как N зданий — и по ЦЕНЕ, и по ВЫХЛОПУ. Поэтому стак из пяти уровней и пять отдельных зданий стоят и дают одинаково: денег больше не будет ни там, ни там.",
    "You can build buildings ON TOP of each other: building on your own building raises its LEVEL instead of placing a second one. The game counts a level-N building as N buildings — for both COST and OUTPUT. So a five-level stack and five separate buildings cost the same and yield the same: neither prints more money.",
  ),
  p(
    "Разница — чисто геометрическая, и она решает больше, чем кажется:",
    "The difference is purely geometric, and it decides more than it looks:",
  ),
  ul([
    bi(
      "стак занимает одну клетку — это одна цель. Одна ядерка, один прорыв фронта, и ты потерял все уровни разом.",
      "a stack occupies one tile — that's one target. One nuke, one front collapse, and you lose every level at once.",
    ),
    bi(
      "отдельные города дают поездам БОЛЬШЕ ОСТАНОВОК: поезд платит за каждую, а уровень выплату не меняет.",
      "separate cities give trains MORE STOPS: a train pays for each one, and level doesn't change the payout.",
    ),
    bi(
      "отдельные порты стоят у разных морей и дают разные ДИСТАНЦИИ — а деньги торгового корабля растут именно с дистанцией.",
      "separate ports sit on different seas and give different DISTANCES — and a trade ship's income grows precisely with distance.",
    ),
    bi(
      "отдельные фабрики тянут рельсы к разным узлам — сеть шире, а число поездов то же.",
      "separate factories run rails to different nodes — a wider network, the same number of trains.",
    ),
    bi(
      `минимальное расстояние между постройками — ${CFG.structureMinDist} тайлов, так что «раскидать» получится не везде.`,
      `minimum distance between structures is ${CFG.structureMinDist} tiles, so spreading out isn't always possible.`,
    ),
  ]),
  note(
    "Короткий ответ на вечный спор: по деньгам стак и отдельные здания РАВНЫ. Стак выбирают, когда некуда ставить или страшно за территорию; отдельные — когда есть безопасная земля и хочется устойчивости и длинных торговых плеч.",
    "The short answer to the eternal argument: by money, stacking and separate buildings are EQUAL. Stack when there's nowhere to put them or the land is unsafe; spread out when you have safe land and want resilience and longer trade legs.",
  ),

  h("Столица", "Capital"),
  rows([
    {
      icon: CONCEPT_ICONS.capital,
      k: bi("Как появляется", "How it appears"),
      v: bi(
        "Первый достроенный тобой ГОРОД автоматически становится столицей: золотой тинт и подпись-имя. Отдельно строить её нельзя. У племён столиц не бывает.",
        "The first CITY you finish automatically becomes the capital: a golden tint and a name label. You can't build one separately. Tribes never have capitals.",
      ),
    },
    {
      icon: CONCEPT_ICONS.gold,
      k: bi("Доход", "Income"),
      v: bi(
        `+${n(CFG.capitalAmount)} золота раз в ${CFG.capitalIntervalSec} с — это ${n(TUN.capitalPerMin)} в минуту, всплывающим текстом над городом. Столица не прокачивается: доход один и тот же, сколько бы уровней ни было у самого города.`,
        `+${n(CFG.capitalAmount)} gold every ${CFG.capitalIntervalSec}s — ${n(TUN.capitalPerMin)} per minute, shown as floating text above the city. A capital doesn't scale: the income is the same no matter how many levels the city itself has.`,
      ),
    },
    {
      icon: UnitType.City,
      k: bi("Откуда имя", "Where the name comes from"),
      v: bi(
        "Имя назначается игрой и не выбирается вручную. У нации, названной реальной страной или регионом, столица берётся настоящая — Россия получит Москву. Всем остальным (живым игрокам и нациям с выдуманными именами) имя достаётся из общего списка, но не случайно: оно вычисляется из идентификатора владельца, поэтому одинаково у всех в матче и не «прыгает» при пересчёте.",
        "The name is assigned by the game and can't be picked by hand. A nation named after a real country or region gets that country's real capital — Russia gets Moscow. Everyone else (human players and nations with invented names) draws from a shared pool, but not randomly: it's derived from the owner's identifier, so it's identical for everyone in the match and never shifts on recalculation.",
      ),
    },
    {
      icon: CONCEPT_ICONS.sword,
      k: bi("Что при захвате", "What happens on capture"),
      v: bi(
        "Столица переходит захватчику вместе с тайлом — и доход начинает капать ему. Если своя столица у него уже есть, захваченная становится обычным городом и доход не удваивается. Имя при этом НЕ меняется: Москва остаётся Москвой под чужим флагом.",
        "The capital changes hands with the tile — and the income starts flowing to the captor. If they already have a capital of their own, the captured one becomes an ordinary city and the income does not double. The name does NOT change: Moscow stays Moscow under a foreign flag.",
      ),
    },
    {
      icon: CONCEPT_ICONS.land,
      k: bi("Потерял столицу", "Losing the capital"),
      v: bi(
        "Снесённая или потерянная столица освобождает статус: следующий построенный тобой город снова станет столицей. Бывшая столица остаётся подписанной, но тускло-серым — это ориентир на карте, видно, куда высаживаться отбивать.",
        "A demolished or lost capital frees the status: the next city you build becomes the capital again. A former capital keeps its label but in dull grey — a landmark on the map showing where to land and take it back.",
      ),
    },
  ]),
];

export const ECONOMY_BLOCKS: Block[] = [
  lead(
    "Деньги в игре берутся из четырёх источников: пассивный доход, столица, торговля по земле (поезда) и торговля по воде и воздуху (корабли, самолёты). Захват чужой страны — пятый, разовый.",
    "Money comes from four sources: passive income, the capital, land trade (trains) and water/air trade (ships, planes). Conquering another country is a fifth, one-off one.",
  ),

  h("Пассивный доход и население", "Passive income and population"),
  rows([
    {
      icon: CONCEPT_ICONS.gold,
      k: bi("Пассив", "Passive"),
      v: bi(
        `${CFG.goldPerTickHuman} золота за тик, то есть ${n(DERIVED.goldPerSecond)} в секунду. У племён вдвое меньше. Это фон, на нём одном войну не выиграть.`,
        `${CFG.goldPerTickHuman} gold per tick — ${n(DERIVED.goldPerSecond)} per second. Tribes get half. It's background income; you won't win a war on it alone.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.troops,
      k: bi("Потолок войск", "Troop cap"),
      v: bi(
        `Растёт от территории (по затухающей: вдвое больше земли даёт заметно меньше, чем вдвое войск) плюс ${troops(CFG.cityTroopIncrease)} за каждый уровень города. Города — единственный способ поднять потолок без захвата земли.`,
        `Grows with territory (with diminishing returns: twice the land gives noticeably less than twice the troops) plus ${troops(CFG.cityTroopIncrease)} per city level. Cities are the only way to raise the cap without taking land.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.worker,
      k: bi("Прирост войск", "Troop growth"),
      v: bi(
        "Тем быстрее, чем больше у тебя уже есть, но гаснет по мере приближения к потолку — у самого потолка прирост почти нулевой. Значит, упёрся в потолок — либо строй города, либо иди воевать: копить дальше бессмысленно.",
        "Faster the more you already have, but it fades as you approach the cap — at the cap growth is nearly zero. So once you're capped: build cities or go to war, because hoarding does nothing.",
      ),
    },
    {
      icon: CONCEPT_ICONS.sword,
      k: bi("Захват страны", "Conquering a country"),
      v: bi(
        "Съел нацию или племя — забрал ВСЁ их золото. Съел живого игрока — забрал половину его золота.",
        "Eat a nation or tribe — you take ALL their gold. Eat a live player — you take half of theirs.",
      ),
    },
    {
      icon: CONCEPT_ICONS.capital,
      k: bi("Столица", "Capital"),
      v: bi(
        `${n(TUN.capitalPerMin)} золота в минуту, пока цела. Подробности — в разделе «Здания».`,
        `${n(TUN.capitalPerMin)} gold per minute while it stands. Details in the Buildings section.`,
      ),
    },
  ]),

  h("Поезда: торговля по земле", "Trains: land trade"),
  p(
    `Поезда появляются сами: фабрика строит рельсы, цепляет к ним твои города, порты и аэропорты в радиусе ${CFG.railMax} тайлов и запускает составы по кластеру. Поезд платит за КАЖДУЮ остановку, а сумма зависит от того, чей это узел. Важно: на ЧУЖОЙ станции деньги получают ОБЕ стороны — и хозяин поезда, и хозяин станции, каждый полную сумму. Именно поэтому пускать чужие рельсы через себя выгодно.`,
    `Trains appear on their own: a factory lays rails, links your cities, ports and airports within ${CFG.railMax} tiles, and runs trains through the cluster. A train pays for EVERY stop, and the amount depends on whose node it is. Important: at someone else's station BOTH sides are paid — the train's owner and the station's owner, each the full amount. That's exactly why letting foreign rails run through you is profitable.`,
  ),
  rows([
    {
      icon: UnitType.Train,
      k: bi("Остановка у союзника", "Stop at an ally's"),
      v: bi(
        `${trainGold("ally")} золота — самая жирная выплата в игре за остановку. Союз выгоден не только военно.`,
        `${trainGold("ally")} gold — the fattest per-stop payout in the game. An alliance pays off beyond the military side.`,
      ),
    },
    {
      icon: UnitType.Train,
      k: bi("Чужой или командный узел", "Foreign or team node"),
      v: bi(`${trainGold("other")} золота.`, `${trainGold("other")} gold.`),
    },
    {
      icon: UnitType.Train,
      k: bi("Свой узел", "Your own node"),
      v: bi(
        `${trainGold("self")} золота — вчетверо меньше союзной. Возить самому себе можно, но это пол дохода, а не экономика.`,
        `${trainGold("self")} gold — a quarter of the ally rate. Shipping to yourself works, but it's a floor, not an economy.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.land,
      k: bi("Штраф за длину маршрута", "Long-route penalty"),
      v: bi(
        `Первые десять остановок у городов и портов — без штрафа. Дальше каждая следующая срезает 5k с выплаты, но не ниже ${trainGold("ally", 40)}. Бесконечно наращивать одну гигантскую сеть смысла нет.`,
        `The first ten stops at cities and ports are penalty-free. After that each further stop cuts 5k off the payout, never below ${trainGold("ally", 40)}. Growing one giant network forever is pointless.`,
      ),
    },
  ]),
  p(
    "Темп поездов зависит от суммарного уровня фабрик, но с затуханием: чем больше у тебя фабрик, тем реже каждая из них выпускает состав. Это и есть встроенный тормоз против «залил карту фабриками».",
    "Train tempo depends on total factory levels, but with decay: the more factories you own, the rarer each one dispatches. That's the built-in brake against carpeting the map with factories.",
  ),

  h(
    "Корабли и самолёты: дистанция и есть деньги",
    "Ships and planes: distance is money",
  ),
  p(
    `Торговый корабль платит по S-образной кривой от пройденной дистанции с переломом около ${CFG.tradeShortRange} тайлов. Короткие рейсы наказываются жёстко, дальние выходят на насыщение. Самолёт зарабатывает столько же, сколько корабль на той же дистанции.`,
    `A trade ship pays along an S-curve of distance travelled, with the knee around ${CFG.tradeShortRange} tiles. Short hops are punished hard, long hauls saturate. A plane earns exactly what a ship earns over the same distance.`,
  ),
  rows([
    {
      icon: UnitType.TradeShip,
      k: bi("50 тайлов", "50 tiles"),
      v: bi(
        `${tradeGold(50)} золота — почти даром.`,
        `${tradeGold(50)} gold — almost nothing.`,
      ),
    },
    {
      icon: UnitType.TradeShip,
      k: bi("150 тайлов", "150 tiles"),
      v: bi(`${tradeGold(150)} золота.`, `${tradeGold(150)} gold.`),
    },
    {
      icon: UnitType.TradeShip,
      k: bi(`${CFG.tradeShortRange} тайлов`, `${CFG.tradeShortRange} tiles`),
      v: bi(
        `${tradeGold(CFG.tradeShortRange)} золота — точка перелома, дальше кривая идёт круто вверх.`,
        `${tradeGold(CFG.tradeShortRange)} gold — the knee; beyond it the curve climbs steeply.`,
      ),
    },
    {
      icon: UnitType.TradeShip,
      k: bi("600 тайлов", "600 tiles"),
      v: bi(`${tradeGold(600)} золота.`, `${tradeGold(600)} gold.`),
    },
    {
      icon: UnitType.TradeShip,
      k: bi("1000 тайлов", "1000 tiles"),
      v: bi(
        `${tradeGold(1000)} золота — дальше прибавка уже небольшая.`,
        `${tradeGold(1000)} gold — beyond this the gain flattens out.`,
      ),
    },
  ]),
  p(
    "Отсюда практический вывод, ради которого эта таблица и нужна: порт на противоположном берегу карты стоит столько же, сколько порт у соседа, а приносит в разы больше. География важнее числа зданий.",
    "Hence the practical point of this table: a port on the far side of the map costs the same as one next door and earns several times more. Geography beats building count.",
  ),
  rows([
    {
      icon: UnitType.Warship,
      k: bi("Пиратство", "Piracy"),
      v: bi(
        `Боевой корабль перехватывает чужие торговые в радиусе патруля ${CFG.warshipPatrolRange} тайлов (замечает с ${CFG.warshipTargetRange}) — груз уходит перехватчику целиком. Ульта Центробанк делает твои корабли неперехватываемыми.`,
        `A warship intercepts foreign trade ships within its ${CFG.warshipPatrolRange}-tile patrol radius (spotting from ${CFG.warshipTargetRange}) — the cargo goes to the interceptor in full. The Central Bank ultimate makes your ships un-interceptable.`,
      ),
    },
    {
      icon: UnitType.Airplane,
      k: bi("Комиссия за пролёт", "Overflight toll"),
      v: bi(
        `${TUN.airplaneTaxPct} % груза за КАЖДЫЙ тик над территорией чужого живого игрока — идёт хозяину земли. Длинный рейс над чужой страной довозит заметно меньше, чем вылетел.`,
        `${TUN.airplaneTaxPct}% of cargo for EVERY tick over another living player's territory — paid to the landowner. A long haul across foreign land delivers noticeably less than it left with.`,
      ),
    },
  ]),

  h("Что окупается", "What pays off"),
  ul([
    bi(
      "Города — не про деньги, а про потолок населения. Экономику они двигают только как остановки для поездов.",
      "Cities aren't about money, they're about the population cap. They move the economy only as train stops.",
    ),
    bi(
      "Фабрика без городов и портов рядом бесполезна: поездам некуда ехать. Фабрика — не источник, а транспорт.",
      "A factory with no cities or ports nearby is useless: the trains have nowhere to go. A factory is transport, not a source.",
    ),
    bi(
      "Порт и аэропорт зарабатывают дистанцией, поэтому первым делом смотри не «сколько», а «куда».",
      'Ports and airports earn through distance, so look at "where to" before "how many".',
    ),
    bi(
      "Союз с соседом, у которого много узлов, повышает выплату поездам в 3,5 раза против своих же перевозок.",
      "An alliance with a node-rich neighbour raises train payouts 3.5× over shipping to yourself.",
    ),
  ]),
];

export const COMBAT_BLOCKS: Block[] = [
  lead(
    "Бой в TERRON — это не сражение армий, а продавливание границы. Ты тратишь войска, чтобы забирать тайлы; сколько именно потратишь, решают рельеф, укрепления и размеры обеих сторон.",
    "Combat in TERRON isn't a clash of armies, it's pushing a border. You spend troops to take tiles; how much you spend is decided by terrain, fortifications and the size of both sides.",
  ),

  h("Сколько войск уходит в атаку", "How many troops go into an attack"),
  p(
    `Ползунком атаки ты задаёшь ДОЛЮ своих войск, которая пойдёт в удар — по умолчанию ${DERIVED.attackRatioDefaultPct} %, шаг ${DERIVED.attackRatioStepPct} %, меняется клавишами или колесом. Эта же доля уходит и в морской десант: лодка везёт ровно столько, сколько выставлено ползунком, а не фиксированную пятую часть. Войска списываются в момент отправки, а не по прибытии.`,
    `The attack slider sets the SHARE of your troops committed to a strike — ${DERIVED.attackRatioDefaultPct}% by default, ${DERIVED.attackRatioStepPct}% steps, changed with keys or the wheel. The same share goes into a sea landing: a boat carries exactly what the slider says, not a fixed fifth. Troops are deducted at departure, not on arrival.`,
  ),
  note(
    "Нации и племена ползунка не имеют: нация шлёт пятую часть войск, племя — двадцатую. Поэтому племена нападают часто и слабо, а нация бьёт редко и больно.",
    "Nations and tribes have no slider: a nation sends a fifth of its troops, a tribe a twentieth. That's why tribes attack often and weakly, while a nation strikes rarely and hard.",
  ),

  h("Рельеф", "Terrain"),
  p(
    "Каждый тайл суши — равнина, возвышенность или гора; это видно по рельефу карты. Рельеф решает и цену захвата, и скорость продвижения.",
    "Every land tile is plains, highland or mountain; you can read it off the map relief. Terrain decides both the price of capture and the speed of advance.",
  ),
  rows([
    {
      icon: CONCEPT_ICONS.land,
      k: bi("Равнина", "Plains"),
      v: bi(
        "Дешевле всего и быстрее всего. База для сравнения.",
        "Cheapest and fastest. The baseline for comparison.",
      ),
    },
    {
      icon: CONCEPT_ICONS.land,
      k: bi("Возвышенность", "Highland"),
      v: bi(
        "На четверть дороже равнины по потерям и примерно на столько же медленнее.",
        "A quarter more expensive than plains in losses, and about as much slower.",
      ),
    },
    {
      icon: CONCEPT_ICONS.land,
      k: bi("Горы", "Mountain"),
      v: bi(
        "В полтора раза дороже равнины и заметно медленнее. Горный хребет — естественная стена: враг влезет, но заплатит.",
        "Half again as expensive as plains and noticeably slower. A mountain ridge is a natural wall: the enemy gets through, but pays.",
      ),
    },
    {
      icon: CONCEPT_ICONS.tree,
      k: bi("Фоллаут", "Fallout"),
      v: bi(
        "Заражённая после ядерного взрыва земля защищается сама: захват такого тайла в разы дороже. Чем больше карты в фоллауте, тем слабее эффект на каждом отдельном тайле.",
        "Land contaminated by a nuclear blast defends itself: taking such a tile costs several times more. The more of the map is under fallout, the weaker the effect on each individual tile.",
      ),
    },
  ]),

  note(
    "РЕЛЬЕФ НЕ ИСЧЕЗАЕТ ПОД ФЛАГОМ. Высота — свойство самого тайла, а не его хозяина: гора остаётся горой и после того, как кто-то её захватил и закрасил своим цветом. Отбивать у соседа горный хребет ровно так же дорого и медленно, как брать его нейтральным. Поэтому «чужая земля» на карте — не однородная масса: у одного противника фронт по равнине и рассыпается за секунды, у другого по горам и держится втрое дольше при тех же войсках.",
    'TERRAIN DOESN\'T VANISH UNDER A FLAG. Elevation belongs to the tile, not to its owner: a mountain stays a mountain after someone has captured it and painted it their colour. Taking a mountain ridge from a neighbour costs exactly as much, and goes exactly as slowly, as taking it while it was neutral. So "enemy land" on the map is not a uniform mass: against one opponent the front runs over plains and crumbles in seconds, against another it runs over mountains and holds three times as long with the same troops.',
  ),
  p(
    "Отсюда и порядок, в котором расползается твоя атака: волна сама выбирает, куда идти дальше, и предпочитает дешёвое. Сначала берутся равнины и тайлы, уже окружённые твоей землёй с нескольких сторон, а возвышенности и горы откладываются напоследок. Именно поэтому фронт на карте не идёт ровной линией, а обтекает хребет и смыкается за ним.",
    "Hence the order in which your attack spreads: the wave picks its own next step and prefers the cheap one. Plains and tiles already surrounded by your land on several sides go first, while highlands and mountains are left for last. That's why the front doesn't advance as a straight line but flows around a ridge and closes behind it.",
  ),
  note(
    "КАК УВИДЕТЬ РЕЛЬЕФ ПОД ТЕРРИТОРИЕЙ. Цвет игрока — полупрозрачная заливка поверх карты (около 60 % плотности), так что высоты под ней просвечивают, но на светлых цветах читаются плохо. Чтобы посмотреть голую карту, ЗАЖМИ ПРОБЕЛ: пока клавиша держится, все захваченные территории скрываются и остаётся чистый рельеф — удобно перед тем, как выбирать направление удара.",
    "HOW TO SEE THE TERRAIN UNDER TERRITORY. A player's colour is a semi-transparent fill over the map (about 60% opacity), so elevation shows through — though it reads poorly under light colours. To look at the bare map, HOLD SPACE: while the key is down all captured territory is hidden and only the relief remains — handy right before you pick a direction to strike.",
  ),
  h("Кто держит удар лучше", "Who holds better"),
  ul([
    bi(
      `Бункер: ×${CFG.defensePostDefenseBonus} к потерям нападающего и ×${CFG.defensePostSpeedBonus} к замедлению в радиусе ${CFG.defensePostRange} тайлов. Не складывается — важно попадание в радиус, а не число бункеров.`,
      `Bunker: ×${CFG.defensePostDefenseBonus} attacker losses and ×${CFG.defensePostSpeedBonus} slowdown within ${CFG.defensePostRange} tiles. Doesn't stack — what matters is being inside a radius, not how many bunkers.`,
    ),
    bi(
      "Большая страна защищается ХУЖЕ: чем больше у обороняющегося тайлов, тем слабее держится каждый. Империя рыхлая по краям — это правило, а не баг.",
      "A big country defends WORSE: the more tiles a defender holds, the weaker each one holds. An empire is soft at the edges — by design, not by bug.",
    ),
    bi(
      "Большой нападающий тоже штрафуется: свыше ста тысяч тайлов и сила, и скорость наступления падают. Гигант не может катиться по карте бесконечно.",
      "A big attacker is penalised too: past a hundred thousand tiles both attack power and advance speed drop. A giant can't just roll across the map forever.",
    ),
    bi(
      "Атака человека или нации по ПЛЕМЕНИ стоит на 30 % дешевле — племена мягкие, на них и растут.",
      "Attacks by humans or nations against a TRIBE cost 30% less — tribes are soft, and everyone grows on them.",
    ),
    bi(
      `Предатель, разорвавший союз, ${CFG.traitorSec} с держит оборону вдвое хуже: атака по нему стоит нападающему вдвое меньше войск. Небольшая компенсация — землю у предателя отбирают на 20 % медленнее, так что время огрызнуться есть. Ульта МЕДИА снимает метку предателя совсем.`,
      `A traitor who broke an alliance defends half as well for ${CFG.traitorSec}s: attacking them costs the attacker half the troops. Small consolation — their land is taken 20% slower, so there's time to fight back. The Media ultimate removes the traitor mark entirely.`,
    ),
    bi(
      `Реваншизм даёт до +${TUN.revanchismMaxPct} % защиты по всей территории — тем больше, чем сильнее тебя срезали от исторического максимума.`,
      `Revanchism grants up to +${TUN.revanchismMaxPct}% defense across your whole territory — the more you've been cut back from your historic peak, the more you get.`,
    ),
  ]),

  h("Ядерное оружие", "Nuclear weapons"),
  p(
    `Атомные и водородные бомбы стартуют только из ракетных шахт, МИРВ — из Ядерного завода, дрон-камикадзе — с аэропорта. Взрыв стирает территорию и убивает население в радиусе, а ещё УНИЧТОЖАЕТ ВСЕ ЗДАНИЯ И ЮНИТЫ, попавшие во внешний радиус, без разбора — свои тоже. Ракета летит со скоростью ${CFG.nukeSpeed} тайлов за тик, навести можно на ${CFG.nukeRange} тайлов.`,
    `Atom and hydrogen bombs launch only from missile silos, MIRV from the Nuclear Factory, the suicide drone from an airport. A blast wipes territory and kills population in its radius — and DESTROYS EVERY BUILDING AND UNIT inside the outer radius, indiscriminately, yours included. A missile flies ${CFG.nukeSpeed} tiles per tick and can be aimed up to ${CFG.nukeRange} tiles away.`,
  ),
  rows([
    {
      icon: UnitType.SuicideDrone,
      k: bi("Дрон-камикадзе", "Suicide drone"),
      v: bi(
        `${costOf(UnitType.SuicideDrone)} золота, радиус ${CFG.drone.inner}/${CFG.drone.outer} тайлов, кулдаун аэропорта ${CFG.droneCooldown} с. Дешёвый точечный снос — например, вражеского ПВО или ульт-штаба.`,
        `${costOf(UnitType.SuicideDrone)} gold, ${CFG.drone.inner}/${CFG.drone.outer}-tile radius, ${CFG.droneCooldown}s airport cooldown. A cheap surgical demolition — an enemy SAM or ultimate HQ, say.`,
      ),
    },
    {
      icon: UnitType.AtomBomb,
      k: bi("Атомная бомба", "Atom bomb"),
      v: bi(
        `${costOf(UnitType.AtomBomb)} золота, радиус ${CFG.atom.inner}/${CFG.atom.outer} тайлов.`,
        `${costOf(UnitType.AtomBomb)} gold, ${CFG.atom.inner}/${CFG.atom.outer}-tile radius.`,
      ),
    },
    {
      icon: UnitType.HydrogenBomb,
      k: bi("Водородная бомба", "Hydrogen bomb"),
      v: bi(
        `${costOf(UnitType.HydrogenBomb)} золота, радиус ${CFG.hydrogen.inner}/${CFG.hydrogen.outer} тайлов — выжигает целую область.`,
        `${costOf(UnitType.HydrogenBomb)} gold, ${CFG.hydrogen.inner}/${CFG.hydrogen.outer}-tile radius — it burns out an entire region.`,
      ),
    },
    {
      icon: UnitType.MIRV,
      k: bi("МИРВ", "MIRV"),
      v: bi(
        `${costOf(UnitType.MIRV)} за первый пуск и +15M за каждый следующий. Раскрывается на 350 боеголовок по ${CFG.mirvWarhead.inner}/${CFG.mirvWarhead.outer} тайлов — накрывает страну целиком.`,
        `${costOf(UnitType.MIRV)} for the first launch, +15M for each next. Splits into 350 warheads of ${CFG.mirvWarhead.inner}/${CFG.mirvWarhead.outer} tiles — it blankets a whole country.`,
      ),
    },
    {
      icon: UnitType.SAMLauncher,
      k: bi("Защита", "Defense"),
      v: bi(
        `ПВО бьёт на упреждение в радиусе от ${CFG.samRangeL1} тайлов, зенитная ракета быстрее ядерной. Против МИРВ ПВО закрывает собой весь свой радиус, потратив заряд.`,
        `A SAM fires with lead from ${CFG.samRangeL1} tiles up, and its interceptor is faster than a nuke. Against MIRV a SAM shields its entire radius, spending its charge.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.alliance,
      k: bi("Удар по союзнику", "Nuking an ally"),
      v: bi(
        `Союз рвётся автоматически, если твой взрыв задел больше ${CFG.nukeAllianceBreak} тайлов союзника. Задел меньше — считается случайностью.`,
        `The alliance breaks automatically if your blast hits more than ${CFG.nukeAllianceBreak} of an ally's tiles. Fewer than that counts as an accident.`,
      ),
    },
  ]),

  h("Флот и десант", "Fleet and landings"),
  rows([
    {
      icon: UnitType.TransportShip,
      k: bi("Морской десант", "Sea landing"),
      v: bi(
        `Лодка бесплатна, но одновременно их может быть не больше ${CFG.boatMax}. Везёт долю войск с ползунка атаки. У защитника с ультой Минирование ${TUN.miningKillPct} % десанта гибнет на минах ещё до боя.`,
        `A boat is free, but you can have at most ${CFG.boatMax} at once. It carries the share set by the attack slider. Against a defender with the Mining ultimate, ${TUN.miningKillPct}% of the landing dies on mines before the fight.`,
      ),
    },
    {
      icon: UnitType.AirborneAssault,
      k: bi("Воздушный десант", "Airborne assault"),
      v: bi(
        `Цена растёт с каждой высадкой: ${costOf(UnitType.AirborneAssault)} за первую, ${costOf(UnitType.AirborneAssault, 1)} за вторую и так далее. В тыл доходит ${TUN.airborneLandingPct} % отправленных, точка высадки ${TUN.beachheadSec} с иммунна к схлопыванию окружением. Авиаштаб делает десант бесплатным, полным по составу и вдвое более живучим.`,
        `The price grows with each drop: ${costOf(UnitType.AirborneAssault)} for the first, ${costOf(UnitType.AirborneAssault, 1)} for the second and so on. ${TUN.airborneLandingPct}% of what you send arrives behind enemy lines, and the landing spot is immune to encirclement collapse for ${TUN.beachheadSec}s. Air Command makes the drop free, full-strength and twice as durable.`,
      ),
    },
    {
      icon: UnitType.Warship,
      k: bi("Боевой корабль", "Warship"),
      v: bi(
        `${priceLadder(UnitType.Warship)} золота. Прочность ${n(CFG.warshipHealth)}, снаряд бьёт на ${n(CFG.shellDamage)} — то есть четыре попадания топят корабль. Стреляет раз в ${CFG.warshipShellRate} с, патрулирует ${CFG.warshipPatrolRange} тайлов, при прочности ниже ${n(CFG.warshipRetreatHp)} уходит чиниться в порт.`,
        `${priceLadder(UnitType.Warship)} gold. ${n(CFG.warshipHealth)} health, a shell hits for ${n(CFG.shellDamage)} — four hits sink a ship. Fires every ${CFG.warshipShellRate}s, patrols ${CFG.warshipPatrolRange} tiles, and retreats to a port for repairs below ${n(CFG.warshipRetreatHp)} health.`,
      ),
    },
    {
      icon: UnitType.DefensePost,
      k: bi("Береговая оборона", "Coastal defense"),
      v: bi(
        `Бункер обстреливает вражеские корабли в радиусе ${CFG.defensePostTargetRange} тайлов раз в ${CFG.defensePostShellRate} с — берег, утыканный бункерами, топит десант ещё на подходе.`,
        `A bunker shells enemy ships within ${CFG.defensePostTargetRange} tiles every ${CFG.defensePostShellRate}s — a shore studded with bunkers sinks landings on approach.`,
      ),
    },
  ]),
];

export const WORLD_BLOCKS: Block[] = [
  lead(
    "Карта — это сетка тайлов. Всё в игре — территория, здания, бой — привязано к тайлу, поэтому правила мира стоит понять раньше, чем правила боя.",
    "The map is a grid of tiles. Everything — territory, buildings, combat — is anchored to a tile, so the rules of the world are worth understanding before the rules of combat.",
  ),

  h("Тайлы", "Tiles"),
  ul([
    bi(
      "Тайл — минимальная клетка карты. Он либо суша, либо вода; вода бывает океаном и озером, а озеро — это отдельный замкнутый водоём, по которому не пройти в океан.",
      "A tile is the smallest cell of the map. It's either land or water; water is either ocean or lake, and a lake is a closed body you can't sail out of into the ocean.",
    ),
    bi(
      "У каждого сухопутного тайла есть высота, и по ней он относится к равнине, возвышенности или горам — это и есть цена захвата (см. раздел «Бой»).",
      "Every land tile has an elevation, and that makes it plains, highland or mountain — which is its capture price (see the Combat section).",
    ),
    bi(
      "Береговой тайл — суша, соседствующая с океаном. Только с него уходят и на него высаживаются лодки, и только он даёт кластеру «выход к морю».",
      'A shore tile is land adjacent to ocean. Boats can only leave from and land on shore tiles, and only a shore tile gives a cluster its "outlet to the sea".',
    ),
    bi(
      "Порт ставится у воды, но торгуют между собой только те порты, чьи воды СВЯЗАНЫ: порт на закрытом озере или в отрезанном море не найдёт себе партнёра, сколько бы портов ни было на карте.",
      "A port is placed on water, but only ports whose waters are CONNECTED trade with each other: a port on a closed lake or a cut-off sea will find no partner, however many ports the map holds.",
    ),
  ]),

  h("Территория", "Territory"),
  p(
    `Территория — это просто множество принадлежащих тебе тайлов, без всяких «областей» и «провинций». Атака идёт по границе: ты перекрашиваешь соседние тайлы один за другим, платя за каждый войсками. Поэтому длинная рваная граница дорога в обороне, а компактная — дешева. Минимальное расстояние между твоими постройками — ${CFG.structureMinDist} тайлов, между стартовыми точками игроков — ${CFG.minPlayerDist}.`,
    `Territory is simply the set of tiles you own — no "regions" or "provinces". An attack runs along the border: you repaint adjacent tiles one by one, paying troops for each. That's why a long ragged border is expensive to defend and a compact one is cheap. Minimum distance between your structures is ${CFG.structureMinDist} tiles, and between players' starting points ${CFG.minPlayerDist}.`,
  ),
  note(
    "ОКРУЖЕНИЕ. Примерно раз в две секунды игра проверяет, не оказался ли кусок твоей территории полностью обёрнут ОДНИМ недружественным игроком (у совсем маленьких стран — вчетверо чаще, чтобы окружение ловилось сразу). Если да — кусок исчезает целиком и переходит окружившему, без боя за каждый тайл. Это работает и с самым большим твоим куском: замкнули кольцо — потерял всё внутри. Спасают три вещи: выход к морю или краю карты, свежий десантный плацдарм (он иммунен первые секунды) и статус бота-сепаратиста после Раскола — тот не схлопывается никогда.",
    "ENCIRCLEMENT. About twice a second the game checks whether a chunk of your territory has been completely wrapped by ONE hostile player. If so, the whole chunk vanishes and goes to whoever surrounded it — no tile-by-tile fight. This applies to your largest chunk too: close the ring and you lose everything inside. Three things save you: an outlet to the sea or the map edge, a fresh airborne beachhead (immune for its first seconds), and separatist-bot status after a Split — those never collapse.",
  ),

  h("Начало матча", "Match start"),
  rows([
    {
      icon: CONCEPT_ICONS.land,
      k: bi("Отсчёт в лобби", "Lobby countdown"),
      v: bi(
        `${TUN.lobbySec} с с момента, когда в лобби зашёл первый живой игрок. Пустое лобби ждёт и не стартует.`,
        `${TUN.lobbySec}s from the moment the first live player joins. An empty lobby waits and doesn't start.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.target,
      k: bi("Выбор точки спавна", "Choosing a spawn"),
      v: bi(
        `${TUN.spawnSec} с, а если живых игроков больше одного — ${TUN.spawnPvpSec} с. Опоздал — есть ещё ${TUN.spawnGraceSec} с после старта, всё равно сыграешь.`,
        `${TUN.spawnSec}s, or ${TUN.spawnPvpSec}s when there's more than one live player. Missed it? You get ${TUN.spawnGraceSec}s more after the start and still get to play.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.land,
      k: bi("Стартовая территория", "Starting territory"),
      v: bi(
        `Прямоугольник ${TUN.spawnW}×${TUN.spawnH} тайлов — «флаг». Форма не случайная: в прямоугольник ровно ложится твой скин.`,
        `A ${TUN.spawnW}×${TUN.spawnH} rectangle — a "flag". The shape isn't arbitrary: your skin fits a rectangle exactly.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.troops,
      k: bi("Стартовые войска", "Starting troops"),
      v: bi(
        `${troops(CFG.startManpowerHuman)} у живого игрока, ${troops(CFG.startManpowerBot)} у племени, у наций — по сложности (см. раздел про ИИ).`,
        `${troops(CFG.startManpowerHuman)} for a live player, ${troops(CFG.startManpowerBot)} for a tribe, and by difficulty for nations (see the AI section).`,
      ),
    },
    {
      icon: CONCEPT_ICONS.shield,
      k: bi("Иммунитет после спавна", "Spawn immunity"),
      v: bi(
        "Короткая неуязвимость сразу после появления, чтобы не убили в первую секунду. Длительность настраивается в лобби.",
        "A brief invulnerability right after you appear, so you're not killed in the first second. The duration is a lobby setting.",
      ),
    },
  ]),

  h("Конец матча", "Match end"),
  p(
    `Победа — ${CFG.winPercentFfa} % тайлов карты в режиме «каждый против каждого» и ${CFG.winPercentTeam} % в командном (там считается доля всей команды). Отдельно существует ЗОЛОТОЙ МАТЧ — публичное лобби по расписанию, раз в ${TUN.goldenPeriodMin} минут; его победитель получает ${TUN.goldenRewardPts} кровавых алмазов и ачивку. Зайти в золотое лобби и позвать друзей можно в любой момент по ссылке /gold, оно живёт постоянно. Раз в сутки, вечером по Москве, проходит АЛМАЗНЫЙ МАТЧ — то же самое, но награда победителю ${TUN.diamondRewardPts} кровавых алмазов; его лобби висит весь день по ссылке /diamond, так что подойти и позвать своих можно заранее.`,
    `Victory is ${CFG.winPercentFfa}% of the map's tiles in free-for-all and ${CFG.winPercentTeam}% in team mode (where the whole team's share counts). Separately there's the GOLDEN MATCH — a scheduled public lobby every ${TUN.goldenPeriodMin} minutes; its winner gets ${TUN.goldenRewardPts} blood diamonds and an achievement. You can enter the golden lobby and invite friends at any time via the /gold link — it lives permanently. Once a day, in the Moscow evening, there is a DIAMOND MATCH — the same thing, but the winner gets ${TUN.diamondRewardPts} blood diamonds; its lobby stays up all day at the /diamond link, so you can join and rally your friends well in advance.`,
  ),

  h("Туман войны", "Fog of war"),
  p(
    `Опция лобби, по умолчанию выключена. Под туманом видно только свою и союзную территорию плюс кольцо радиусом ${TUN.fogRadius} тайлов вокруг неё и вокруг каждого своего юнита. Свои удары приоткрывают карту: после прилёта ракеты или высадки вокруг точки события на ${TUN.fogRevealSec} с открывается окно видимости, потом круг схлопывается за ${TUN.fogCollapseSec} с. Туман не действует в фазе спавна, в реплеях и у наблюдателей. Тот же туман умеет включать всем ульта «Небо наше» — даже в матче, где опция выключена.`,
    `A lobby option, off by default. Under fog you only see your and allied territory plus a ${TUN.fogRadius}-tile ring around it and around each of your units. Your own strikes crack the map open: after a missile lands or troops disembark, a window of visibility opens around the event for ${TUN.fogRevealSec}s, then the circle collapses over ${TUN.fogCollapseSec}s. Fog is off during the spawn phase, in replays and for spectators. The Our Sky ultimate can impose the same fog on everyone — even in a match where the option is off.`,
  ),
];

export const AI_BLOCKS: Block[] = [
  lead(
    "Кроме живых игроков на карте два вида компьютерных соперников, и путать их не стоит: НАЦИИ — это именованные страны с настоящей внешней политикой, ПЛЕМЕНА — безымянная масса, на которой все растут.",
    "Besides live players there are two kinds of computer opponents, and they shouldn't be confused: NATIONS are named countries with real foreign policy, TRIBES are the nameless mass everyone grows on.",
  ),

  h("Племена", "Tribes"),
  ul([
    bi(
      `Стартуют с ${troops(CFG.startManpowerBot)} войск и без золота, потолок войск втрое ниже человеческого, прирост вдвое медленнее, пассивный доход вдвое меньше.`,
      `They start with ${troops(CFG.startManpowerBot)} troops and no gold, their troop cap is a third of a human's, growth is half as fast and passive income is half.`,
    ),
    bi(
      "Атакуют часто, но слабо: раз в несколько секунд и всего двадцатой частью войск. Дипломатии у них нет, зданий они не строят, столиц не имеют.",
      "They attack often but weakly: every few seconds, with just a twentieth of their troops. They have no diplomacy, build no buildings and have no capitals.",
    ),
    bi(
      "Атака человека или нации по племени на 30 % дешевле по потерям. Ранняя игра — это по сути поедание племён; их число задаётся настройкой лобби.",
      "Attacks by a human or nation against a tribe cost 30% less in losses. The early game is essentially eating tribes; their count is a lobby setting.",
    ),
  ]),

  h("Нации", "Nations"),
  p(
    "Нация — полноценный участник: строит здания, заключает и разрывает союзы, назначает цели, при случае пускает ядерное оружие и защищается по общим правилам. Её имя и место на карте заданы самой картой, поэтому нация «Франция» всегда появляется во Франции. У наций есть столицы, и это настоящие столицы их стран.",
    'A nation is a full participant: it builds, forms and breaks alliances, marks targets, will use nuclear weapons when it can, and defends by the same rules as anyone. Its name and place come from the map itself, so the nation "France" always appears in France. Nations have capitals, and those are their countries\' real capitals.',
  ),
  p(
    "Сложность из настроек лобби меняет нации сразу по четырём осям — стартовые войска, потолок населения, скорость прироста и скорость реакции. Живых игроков и племён сложность не касается.",
    "The lobby's difficulty setting changes nations along four axes at once — starting troops, population cap, growth rate and reaction speed. It doesn't touch live players or tribes.",
  ),
  rows([
    {
      icon: CONCEPT_ICONS.troops,
      k: bi("Лёгкая", "Easy"),
      v: bi(
        `Старт вдвое ниже человеческого по потолку населения, войск на старте меньше, реакция самая медленная. Часть агрессивных решений нация на этой сложности не принимает вообще.`,
        `Half a human's population cap, fewer starting troops, and the slowest reactions. At this difficulty a nation simply doesn't take some aggressive decisions at all.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.troops,
      k: bi("Средняя", "Medium"),
      v: bi(
        "Потолок населения три четверти от человеческого, прирост чуть медленнее, реакция средняя.",
        "Three quarters of a human's cap, slightly slower growth, average reactions.",
      ),
    },
    {
      icon: CONCEPT_ICONS.troops,
      k: bi("Сложная", "Hard"),
      v: bi(
        `Ровно как живой игрок: тот же потолок, тот же прирост, те же стартовые ${troops(CFG.startManpowerHuman)} войск. Открыты все линии поведения.`,
        `Exactly like a live player: same cap, same growth, the same ${troops(CFG.startManpowerHuman)} starting troops. Every behaviour is unlocked.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.troops,
      k: bi("Невозможная", "Impossible"),
      v: bi(
        "Потолок и прирост выше человеческих, стартовых войск больше всех, реакция вдвое быстрее, чем на лёгкой. Нация успевает ответить раньше, чем ты закрепишься.",
        "Cap and growth above a human's, the largest starting troops, and reactions twice as fast as on Easy. A nation answers before you've consolidated.",
      ),
    },
  ]),

  h("Когда ИИ сдаётся", "When the AI capitulates"),
  p(
    `Нация, ужатая до ${TUN.nationMinTiles} тайлов или меньше, капитулирует сама — иначе карта зарастает неубиваемыми огрызками на микро-островах. Второе правило ловит другой случай: нация, у которой когда-то было не меньше ${n(TUN.nationCollapsePeak)} тайлов, а осталось меньше ${TUN.nationCollapsePct} % от её собственного максимума, тоже капитулирует. Это лечит ситуацию «страна с нулевой территорией, но горой войск, висит посреди карты». Нации, которые всегда были маленькими, под второе правило не попадают — оно считает от СОБСТВЕННОГО пика.`,
    `A nation squeezed to ${TUN.nationMinTiles} tiles or fewer capitulates on its own — otherwise the map fills with unkillable scraps on micro-islands. A second rule catches a different case: a nation that once held at least ${n(TUN.nationCollapsePeak)} tiles but now holds less than ${TUN.nationCollapsePct}% of its own maximum also capitulates. That fixes the "country with no territory but a mountain of troops floating in the middle of the map" situation. Nations that were always small aren't caught by it — the rule measures against their OWN peak.`,
  ),
];

export const DIPLOMACY_BLOCKS: Block[] = [
  lead(
    "Дипломатия в TERRON короткая и с ценой за нарушение: союзы истекают сами, а разрыв бьёт по тому, кто разорвал.",
    "Diplomacy in TERRON is short-lived and has a price for breaking it: alliances expire on their own, and breaking one hurts the one who broke it.",
  ),
  rows([
    {
      icon: CONCEPT_ICONS.alliance,
      k: bi("Союз", "Alliance"),
      v: bi(
        `Длится ${CFG.allianceMin} минут, потом истекает сам; продлить предлагают заранее. Союзники не режут друг другу территорию и, что важнее, ПЛАТЯТ ДРУГ ДРУГУ БОЛЬШЕ ВСЕХ за остановки поездов — ${trainGold("ally")} против ${trainGold("self")} за свой узел.`,
        `Lasts ${CFG.allianceMin} minutes, then expires on its own; you're offered an extension in advance. Allies don't carve up each other's land and, more importantly, PAY EACH OTHER THE MOST for train stops — ${trainGold("ally")} versus ${trainGold("self")} for your own node.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.alliance,
      k: bi("Запрос союза", "Alliance request"),
      v: bi(
        `Висит ${CFG.allianceRequestSec} с, потом сгорает. Повторно просить того же — не раньше чем через ${CFG.allianceRequestCooldownSec} с.`,
        `Stands for ${CFG.allianceRequestSec}s, then lapses. You can ask the same player again no sooner than ${CFG.allianceRequestCooldownSec}s later.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.traitor,
      k: bi("Предательство", "Betrayal"),
      v: bi(
        `Разорвал союз досрочно — ${CFG.traitorSec} с ходишь с меткой предателя: твоя земля защищается вдвое хуже (хотя и захватывают её на 20 % медленнее). Ульта МЕДИА отменяет метку полностью — с ней предавать можно безнаказанно.`,
        `Break an alliance early and you wear the traitor mark for ${CFG.traitorSec}s: your land defends half as well (though it's taken 20% slower). The Media ultimate cancels the mark entirely — with it you can betray with impunity.`,
      ),
    },
    {
      icon: UnitType.MIRV,
      k: bi("Ядерка по союзнику", "Nuking an ally"),
      v: bi(
        `Задел больше ${CFG.nukeAllianceBreak} союзных тайлов — союз рвётся автоматически. Меньше — сходит за случайность.`,
        `Hit more than ${CFG.nukeAllianceBreak} allied tiles and the alliance breaks automatically. Fewer and it passes as an accident.`,
      ),
    },
    {
      icon: UnitType.TradeShip,
      k: bi("Эмбарго", "Embargo"),
      v: bi(
        `Запрет торговли с конкретным игроком: его корабли перестают возить тебе золото. Временное эмбарго держится ${CFG.embargoMin} минут; «эмбарго всем» можно переключать не чаще чем раз в ${CFG.embargoAllCooldownSec} с.`,
        `A trade ban against a specific player: their ships stop bringing you gold. A temporary embargo lasts ${CFG.embargoMin} minutes; the "embargo everyone" switch can be toggled once every ${CFG.embargoAllCooldownSec}s.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.troops,
      k: bi("Донат войск и золота", "Donating troops and gold"),
      v: bi(
        `Передача союзнику: по умолчанию треть своих войск, кулдаун ${CFG.donateCooldownSec} с. Донат золота включается настройкой лобби.`,
        `A transfer to an ally: by default a third of your troops, ${CFG.donateCooldownSec}s cooldown. Gold donation is enabled by a lobby setting.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.target,
      k: bi("Пометить цель", "Marking a target"),
      v: bi(
        `Публично указывает всем на игрока, метка держится ${CFG.targetSec} с, повторно — через ${CFG.targetCooldownSec} с. Способ скоординировать чужую агрессию, не воюя самому.`,
        `Publicly points everyone at a player; the mark holds for ${CFG.targetSec}s, repeatable after ${CFG.targetCooldownSec}s. A way to steer other people's aggression without fighting yourself.`,
      ),
    },
  ]),
];

export const ULT_RULES_BLOCKS: Block[] = [
  h("Общие правила ультимейтов", "General rules of ultimates"),
  rows([
    {
      icon: CONCEPT_ICONS.ultimate,
      k: bi("Один на матч", "One per match"),
      v: bi(
        "Выбор фиксируется НАВСЕГДА при первом применении — постройкой штаба или использованием пассива. До этого момента выбор можно менять.",
        "Your choice locks in FOREVER on first use — building the HQ or triggering the passive. Until then you can change it.",
      ),
    },
    {
      icon: CONCEPT_ICONS.ultimate,
      k: bi("Цена и постройка", "Price and build time"),
      v: bi(
        `Стандартный ульт-штаб — ${gold(TUN.ultCost)} золота и ${TUN.ultBuildSec} с постройки. Исключения: второе Министерство правды стоит вдвое, Укрепления берут ${gold(TUN.ultCost)} за каждый из трёх уровней, а ракета «Сбить спутники» (каст Неба нашего) стоит ${gold(TUN.satStrikeCost)} и собирается ${TUN.ourSkyBuildSec} с.`,
        `A standard ultimate HQ is ${gold(TUN.ultCost)} gold and ${TUN.ultBuildSec}s to build. Exceptions: a second Ministry of Truth costs double, Fortifications charge ${gold(TUN.ultCost)} for each of three levels, and the "Shoot Down Satellites" rocket (Our Sky's cast) costs ${gold(TUN.satStrikeCost)} and assembles for ${TUN.ourSkyBuildSec}s.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.shield,
      k: bi("Эффект живёт со зданием", "The effect lives with the building"),
      v: bi(
        "Почти все ульты — здания-штабы: снесли или захватили штаб, и эффект гаснет в тот же миг. Здание — это и есть уязвимое место ульты, у него нет прочности, как и у любого другого.",
        "Almost every ultimate is an HQ building: destroy or capture the HQ and the effect dies that instant. The building IS the ultimate's weak point — and it has no hit points, like any other.",
      ),
    },
    {
      icon: CONCEPT_ICONS.sword,
      k: bi("Сколько копий", "How many copies"),
      v: bi(
        "По одному штабу на игрока, кроме Министерства правды и Религии — их можно построить два, и вторая копия усилена. Следующая копия открывается только после того, как предыдущая ДОСТРОЕНА.",
        "One HQ per player, except the Ministry of Truth and Religion — you can build two, and the second copy is stronger. The next copy unlocks only after the previous one is FINISHED.",
      ),
    },
    {
      icon: CONCEPT_ICONS.siren,
      k: bi("Захватил чужой штаб", "Capturing someone else's HQ"),
      v: bi(
        `Чужой ульт-штаб достаётся тебе вместе с тайлом и работает — пассив действует, пока здание живо. Но ровно ${TUN.capturedUltSec} с спустя он САМОУНИЧТОЖАЕТСЯ ядерным взрывом с заражением вокруг, если ты не снесёшь его раньше. Над зданием тикает жёлтый таймер. Твоя собственная выбранная ульта, разумеется, не тикает.`,
        `A captured enemy ultimate HQ comes with the tile and works — the passive applies while the building stands. But exactly ${TUN.capturedUltSec}s later it SELF-DESTRUCTS in a nuclear blast with fallout around it, unless you tear it down first. A yellow timer ticks above the building. Your own chosen ultimate, of course, never ticks.`,
      ),
    },
    {
      icon: CONCEPT_ICONS.ultimate,
      k: bi("Активные способности", "Active abilities"),
      v: bi(
        "МИРВ и Раскол не выбираются напрямую — их разблокируют здания «Ядерный завод» и «МЕДИА». Пока здание стоит, кастовать можно сколько угодно раз. Захваченное чужое здание активку НЕ даёт — только свой выбор.",
        "MIRV and Split aren't chosen directly — the Nuclear Factory and Media buildings unlock them. While the building stands you can cast as often as you like. A captured enemy building does NOT grant the active — only your own choice does.",
      ),
    },
  ]),
];

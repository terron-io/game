/**
 * terron 23.08 — ЕДИНАЯ СИСТЕМА ОТКАТОВ (требование владельца: «чтобы если
 * кулдаун есть, он ВЕЗДЕ являлся кулдауном»).
 *
 * До этого откат жил в трёх независимых местах: циферблат над зданием на карте
 * рисовал свой список типов, панель строительства не рисовала ничего, а радиал
 * и мобильная панель — тем более. Получалось, что «Дора перезаряжается» видно
 * над орудием, но кнопка выстрела выглядит обычной.
 *
 * Здесь ОДИН реестр «что перезаряжается и сколько это длится» и две функции:
 *  • unitCooldown()   — откат конкретного здания (для карты);
 *  • actionCooldown() — откат ДЕЙСТВИЯ (для любой кнопки: ядерка, дрон,
 *    выстрел Доры), посчитанный по всем зданиям-источникам игрока.
 *
 * Новая перезаряжающаяся штука = строка в RELOAD_SOURCE, и она сразу
 * отображается и на карте, и на всех кнопках во всех интерфейсах.
 */
import {
  TERRON_PIRACY_SHIP_COOLDOWN_TICKS,
  TERRON_RAILGUN_RELOAD_TICKS,
} from "../core/configuration/TerronTuning";
import { samCooldownFrom } from "../core/execution/SAMLauncherExecution";
import { ULT_MAX_COUNT, Ultimates, UnitType } from "../core/game/Game";
import { GameView, UnitView } from "../core/game/GameView";
import { spaceportPeriodTicks } from "../core/game/SpaceportTiming";

export interface Cooldown {
  /** Тиков осталось. */
  remaining: number;
  /** Полная длительность отката (для сектора циферблата). */
  total: number;
  /** Доля оставшегося, 0..1. */
  frac: number;
  /** Секунд осталось (округление вверх — как на циферблате). */
  seconds: number;
}

/**
 * Действие → здание, которое им стреляет. Кнопка ядерки показывает откат
 * шахт, кнопка дрона — аэропортов, выстрел Доры — самого орудия.
 */
const RELOAD_SOURCE: Partial<Record<UnitType, UnitType>> = {
  // ⚠️ Пиратские лодки СЮДА НЕ ВПИСАТЬ: их откат висит на игроке, а не на
  // здании (см. ветку в actionCooldown ниже).
  [UnitType.AtomBomb]: UnitType.MissileSilo,
  [UnitType.HydrogenBomb]: UnitType.MissileSilo,
  [UnitType.MIRV]: UnitType.MissileSilo,
  [UnitType.WaterNuke]: UnitType.MissileSilo,
  // terron 25.08: терраформинг — три ракеты одной шахты, откат общий.
  [UnitType.LandNuke]: UnitType.MissileSilo,
  [UnitType.BlastNuke]: UnitType.MissileSilo,
  // ⚠️ ДРОН СЮДА НЕ ВПИСАН (решение владельца 23.08): откат аэропортов
  // показывается ТОЛЬКО на самих аэропортах на карте. На кнопке дрона он
  // сбивал с толку — аэропортов много, и «занят» один из них, а кнопка
  // выглядела заблокированной целиком.
  [UnitType.RailGunShell]: UnitType.RailGun,
};

/**
 * ⚠️ ПРАВИЛО ОТКАТОВ НА КНОПКАХ (решение владельца 23.08, дословно):
 * «если мы тыкаем единичный сценарий — кулдаун на кнопке И на здании; если
 * сценариев много (много зданий одновременно могут запустить кулдаун) — на
 * кнопке не пишем, пишем на здании».
 *
 * Смысл: когда у игрока ДЕСЯТЬ шахт и занята одна, откат на кнопке «ядерка»
 * врёт — кнопка выглядит заблокированной, хотя пуск возможен с девяти других.
 * Когда источник ровно один (Дора, откат пиратских лодок на самом игроке),
 * кнопка — единственное место, где откат вообще видно.
 *
 * Правило ВЫВОДИТСЯ, а не перечисляется руками: «источников может быть много»
 * = лимит копий у типа больше одного.
 */
function maxCopiesOf(source: UnitType): number {
  const lim = ULT_MAX_COUNT[source];
  if (lim !== undefined) return lim;
  return Ultimates.has(source) ? 1 : Number.POSITIVE_INFINITY;
}

/** Показывает ли КНОПКА действия его откат (см. правило выше). */
export function buttonShowsCooldown(action: UnitType): boolean {
  if (action === UnitType.Warship) return true; // откат висит на ИГРОКЕ — один
  const source = RELOAD_SOURCE[action] ?? action;
  if (!(RELOADING_TYPES as readonly UnitType[]).includes(source)) return false;
  return maxCopiesOf(source) === 1;
}

/** Есть ли у действия/здания откат вообще (для отрисовки НА КАРТЕ). */
export function hasCooldown(action: UnitType): boolean {
  if (action === UnitType.Warship) return true; // может быть пиратский откат
  const source = RELOAD_SOURCE[action] ?? action;
  return (RELOADING_TYPES as readonly UnitType[]).includes(source);
}

/**
 * ЕДИНСТВЕННЫЙ список «что перезаряжается и сколько это длится».
 *
 * ⚠️ terron 31.08 — БЫЛО ДВА СПИСКА: `switch` с длительностями и отдельный
 * массив `RELOADING_TYPES`, по которому карта решает, кому рисовать циферблат.
 * Совпадали они только потому, что их пока не забывали: добавь здание в switch
 * и не впиши в массив — откат считается, а на карте его нет (и наоборот —
 * циферблат с нулевой длительностью). Теперь массив ВЫВОДИТСЯ из таблицы.
 */
const RELOAD_TICKS: Partial<
  Record<UnitType, (game: GameView, unit?: UnitView) => number>
> = {
  // terron: КОСМОДРОМ — период зависит от МЕСТА (море вдвое чаще), поэтому
  // длительность отката спрашивают вместе с юнитом, если он известен.
  [UnitType.Spaceport]: (game, unit) =>
    spaceportPeriodTicks(
      game,
      unit?.tile() ??
        game.myPlayer()?.units(UnitType.Spaceport)[0]?.tile() ??
        0,
    ),
  [UnitType.MissileSilo]: (game) => game.config().SiloCooldown(),
  // ⚠️ 01.09: перезарядка ПВО зависит от пассива «Неба нашего» (вдвое быстрее).
  // Раньше циферблат рисовал БАЗОВУЮ и врал владельцу ульты вдвое.
  [UnitType.SAMLauncher]: (game) =>
    samCooldownFrom(
      game.config().SAMCooldown(),
      game.myPlayer()?.hasUltimate(UnitType.OurSky) ?? false,
    ),
  // ⚠️ Штаб «Неба нашего» САМ является ПВО (та же SAMLauncherExecution), но в
  // этой таблице его не было — над ним не рисовалось ничего, и игроки честно
  // читали его как «безлимитный купол» (репорт 01.09).
  [UnitType.OurSky]: (game) =>
    samCooldownFrom(
      game.config().SAMCooldown(),
      game.myPlayer()?.hasUltimate(UnitType.OurSky) ?? false,
    ),
  [UnitType.Airport]: (game) => game.config().AirportDroneCooldown(),
  [UnitType.RailGun]: () => TERRON_RAILGUN_RELOAD_TICKS,
};

/** Полная длительность отката здания. 0 — здание не перезаряжается. */
export function reloadTicks(
  game: GameView,
  type: UnitType,
  unit?: UnitView,
): number {
  return RELOAD_TICKS[type]?.(game, unit) ?? 0;
}

/** Все типы зданий, у которых есть откат (для обхода карты). */
export const RELOADING_TYPES: readonly UnitType[] = Object.keys(
  RELOAD_TICKS,
) as UnitType[];

function make(game: GameView, remaining: number, total: number): Cooldown {
  const ticksPerSec = Math.max(1, Math.round(1000 / game.config().msPerTick()));
  return {
    remaining,
    total,
    frac: total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0,
    seconds: Math.ceil(remaining / ticksPerSec),
  };
}

/** Откат конкретного здания (null — готово или откатов у типа нет). */
export function unitCooldown(game: GameView, u: UnitView): Cooldown | null {
  const total = reloadTicks(game, u.type(), u);
  if (total <= 0) return null;
  const q = u.missileTimerQueue();
  if (q.length === 0) return null;
  const remaining = q[0] + total - game.ticks();
  return remaining > 0 ? make(game, remaining, total) : null;
}

/**
 * Откат ДЕЙСТВИЯ у моего игрока: null — есть хотя бы один готовый ствол,
 * иначе ближайший к готовности. Именно это и рисуется на кнопке.
 */
export function actionCooldown(
  game: GameView,
  action: UnitType,
): Cooldown | null {
  // terron 23.08: ПИРАТСТВО — откат покупки лодок принадлежит ИГРОКУ, а не
  // зданию (репорт владельца: «у пиратских судов кулдауны есть, а я его не
  // вижу»). Считаем его тут же, чтобы кнопка корабля показывала откат тем же
  // циферблатом, что и все остальные.
  if (action === UnitType.Warship) {
    const me = game.myPlayer();
    if (me !== null && me.hasUltimate(UnitType.Piracy)) {
      const readyAt = me.pirateShipReadyAt();
      const remaining = readyAt - game.ticks();
      return remaining > 0
        ? make(game, remaining, TERRON_PIRACY_SHIP_COOLDOWN_TICKS)
        : null;
    }
  }
  // Правило «много источников — на кнопке не пишем» (см. buttonShowsCooldown):
  // отсекаем ЗДЕСЬ, в одной точке, чтобы все кнопки (панель, радиал, телефон)
  // подчинялись ему одинаково и не пришлось править их по одной.
  if (!buttonShowsCooldown(action)) return null;
  const source = RELOAD_SOURCE[action] ?? action;
  const total = reloadTicks(game, source);
  if (total <= 0) return null;
  const me = game.myPlayer();
  if (me === null) return null;
  let best: number | null = null;
  for (const u of me.units(source)) {
    if (!u.isActive() || u.isUnderConstruction()) continue;
    // Уровень здания = число стволов: пока хоть один свободен, отката нет.
    if (!u.isInCooldown()) return null;
    const q = u.missileTimerQueue();
    if (q.length === 0) return null;
    const remaining = q[0] + total - game.ticks();
    if (remaining <= 0) return null;
    if (best === null || remaining < best) best = remaining;
  }
  return best === null ? null : make(game, best, total);
}

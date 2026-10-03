// terron 22.09: ЧЕСТНЫЙ БОТ — плейбук ульт. Чистые функции без доступа к миру:
// сигналы карты → веса → выбор. Спека и решения владельца — new-units/FAIRBOT.md.
//
// Правила, которые держит этот модуль (их проверяет tests/FairBot.test.ts):
//  * бот выбирает ульту как ИГРОК БЕЗ ПРЕМА и без анлоков: только базовые
//    (locked === null), не секретные, не архивные, не выключенные в лобби
//    (`disabledUnits`, куда сервер вливает и рубильник TERRON_DISABLED_ULTS);
//  * и только из своей сетки на 6 слотов (Ядерный завод + 5 перемешанных) —
//    у живого игрока без према выбор тоже из шести, а не из всего реестра;
//  * брать можно лишь то, у чего есть плейбук. Ульты без плейбука бот не
//    берёт вовсе: «рандомная ульта крашит игру» (опасение владельца в чате).
import { Config } from "../../configuration/Config";
import {
  isBuildableType,
  isSecretUltimate,
  ULTIMATE_REGISTRY,
  UnitType,
} from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";

/** Что бот знает о своём положении к моменту выбора ульты. */
export interface FairBotSignals {
  /** Доля пограничных тайлов, смежных с сушей ДРУГИХ игроков (0..1). */
  landFront: number;
  /** Доля пограничных тайлов на берегу (0..1). */
  seaFront: number;
  /** Сколько бункеров видно у соседей по границе. */
  neighborBunkers: number;
  /** Сколько живых соседей-игроков (не племён) граничат с ботом. */
  neighbors: number;
}

/** Как бот обращается с ультой после выбора. */
export interface UltPlay {
  /** Вес выбора (≥0). 0 = в этой ситуации не брать. */
  weight(s: FairBotSignals): number;
  /**
   * Сколько копий штаба держать. У Религии храмов сколько угодно, но каждый
   * режет доход на 10 % (×0.9^N) — два это разумный потолок.
   */
  copies: number;
  /** Ставить ли бункеры у границы чаще обычного (Укрепления). */
  bunkerLine: boolean;
  /**
   * terron 28.09: что должно быть по карману ВМЕСТЕ со штабом, чтобы ульту
   * сразу пустить в дело (решение владельца: «ульту только когда готовы её
   * использовать»). Штаб ставится, лишь когда золота хватает на него И на эти
   * юниты; до того бот копит. Шахту для МИРВ добавляет FairBotExecution, если
   * своей ещё нет (это знание о мире, плейбук его не имеет).
   */
  readyWith?: UnitType[];
}

/**
 * ПЛЕЙБУКИ v1 — «односложные» пассивные штабы, с которых владелец велел начать.
 * Метод у всех один: штаб в глубине страны. Специфика — поле-флаг.
 * Наведённые касты (Раскол, Дора, Блокада…) — вторая волна.
 */
export const FAIR_BOT_PLAYBOOK: Partial<Record<UnitType, UltPlay>> = {
  // Бункеры у соседа — повод взять Танки (идея Kristante из беты).
  [UnitType.TankFactory]: {
    weight: (s) => 1 + s.landFront + (s.neighborBunkers >= 3 ? 1.5 : 0),
    copies: 1,
    bunkerLine: false,
  },
  // Бункер у самой границы «хавает» землю (chorbba/KDaniilW) — берём, когда
  // фронт сухопутный.
  [UnitType.Fortifications]: {
    weight: (s) => 0.5 + 2 * s.landFront,
    copies: 1,
    bunkerLine: true,
  },
  // Много соседей — землю будут отнимать, Реваншизм это окупает.
  [UnitType.Revanchism]: {
    weight: (s) => 0.8 + (s.neighbors >= 3 ? 1 : 0) + 0.5 * s.landFront,
    copies: 1,
    bunkerLine: false,
  },
  // Вера ест чужую границу — нужна сухопутная граница с людьми.
  [UnitType.Religion]: {
    weight: (s) => (s.neighbors === 0 ? 0 : 0.6 + s.landFront),
    copies: 2,
    bunkerLine: false,
  },
  // МИРВ нации умеют давно (NationMIRVBehavior) — запасной вариант.
  // Репорт tomsrn 24.09: завод ставили и МИРВ так и не пускали — 5M впустую.
  [UnitType.NuclearFactory]: {
    weight: () => 0.7,
    copies: 1,
    bunkerLine: false,
    readyWith: [UnitType.MIRV],
  },
};

/** Базовые ульты, доступные в этом матче, в порядке реестра. */
export function fairBotUltPool(config: Config): UnitType[] {
  return ULTIMATE_REGISTRY.filter(
    (u) =>
      u.locked === null &&
      !isSecretUltimate(u.type) &&
      isBuildableType(u.type) &&
      !config.isUnitDisabled(u.type),
  ).map((u) => u.type);
}

/** Слотов в сетке у игрока без према (3×3, нижний ряд — прем). */
export const FAIR_BOT_GRID_SLOTS = 6;

/**
 * Своя сетка бота: Ядерный завод первым (как у базового ролла игрока), дальше
 * перемешанный остаток. Перемешивание — ТОЛЬКО через PseudoRandom бота:
 * это симуляция, Math.random развёл бы клиентов.
 */
export function drawUltGrid(
  pool: readonly UnitType[],
  random: PseudoRandom,
  slots = FAIR_BOT_GRID_SLOTS,
): UnitType[] {
  const hasFactory = pool.includes(UnitType.NuclearFactory);
  const rest = pool.filter((t) => t !== UnitType.NuclearFactory);
  // Фишер–Йетс по детерминированному ГСЧ.
  for (let i = rest.length - 1; i > 0; i--) {
    const j = random.nextInt(0, i + 1);
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const grid = hasFactory ? [UnitType.NuclearFactory, ...rest] : rest;
  return grid.slice(0, slots);
}

/**
 * Выбор ульты из сетки. Вес — из плейбука; взвешенная рулетка по ГСЧ бота
 * (разные боты с одними сигналами берут разное — разнообразие и есть
 * ощущение живого онлайна). null — брать нечего.
 */
export function pickUltimate(
  grid: readonly UnitType[],
  signals: FairBotSignals,
  random: PseudoRandom,
): UnitType | null {
  const options: { type: UnitType; w: number }[] = [];
  for (const t of grid) {
    const play = FAIR_BOT_PLAYBOOK[t];
    if (play === undefined) continue;
    const w = play.weight(signals);
    if (w > 0) options.push({ type: t, w });
  }
  if (options.length === 0) return null;
  const total = options.reduce((s, o) => s + o.w, 0);
  // Целые шаги: веса дробные, а ГСЧ отдаёт целые — масштабируем на 1000.
  let roll = random.nextInt(0, Math.max(1, Math.floor(total * 1000)));
  for (const o of options) {
    roll -= Math.floor(o.w * 1000);
    if (roll < 0) return o.type;
  }
  return options[options.length - 1].type;
}

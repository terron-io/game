// terron: СЕТКА ВЫБОРА УЛЬТ 3×3. Единый источник раскладки для десктопа (чузер
// в UnitDisplay) и мобилы (радиал-звезда → та же сетка). Архитектура заложена под
// будущее (баны/ачивки/прем/рандом), сейчас — только базовая сетка.
//
// РАСКЛАДКА (решение владельца 09.07):
//  - слот 0 (лево-верх) — ВСЕГДА MIRV (база OpenFront);
//  - слоты 1-5 (остаток первых двух рядов) — доступны ВСЕМ;
//  - слоты 6-8 (нижний ряд) — TERRON Prime (премиум), серые/залочены если не прем;
//    итог: непрем выбирает из 6 ульт, прем из 9 — и рефреш этого НЕ меняет.
//
// ⚠️ terron 26.08 (решение владельца): МИРВ (Ядерный завод) закреплён слотом 0
// ТОЛЬКО В БАЗОВОМ НАБОРЕ. Начиная со второго набора (после платного рефреша)
// его в сетке нет вовсе — слот 0 занимает обычная ульта. Смысл: базовый ролл
// всегда даёт «как в оригинале», а за перекат игрок платит именно за то, чтобы
// уйти от МИРВа, а не получить его снова прибитым к углу.
//
// БУДУЩЕЕ (пока заглушки, см. TODO):
//  - pool = разблокировано ачивками − забанено в лобби (голосование при загрузке);
//  - при pool>8 — 8 СЛУЧАЙНЫХ детерминированно по seed матча (стабильно всем);
//  - anon: MIRV + 2 (напр. танки+религия); после логина +ряд2 (+пропаганда);
//    ачивки → слоты 5/6; прем → ряд3; платный бан 1 бесплатно / 2 ЛТС / 3 ПТС.
import { isSecretUltimate, UnitType } from "../core/game/Game";
import { revealedSecrets } from "./SecretCodes";
import { unitMeta } from "./UnitCatalog";

// terron: иконка (белый SVG) + i18n-ключ ульты. ОБЩЕЕ для десктоп-сетки
// (UnitDisplay) и мобил-радиала (RadialMenuElements). Тянет из единого реестра
// `UnitCatalog` — здесь больше НЕ хардкодим (fallback = MIRV для неизвестного).
export function ultimateMeta(t: UnitType): { icon: string; key: string } {
  const m = unitMeta(t) ?? unitMeta(UnitType.MIRV)!;
  return { icon: m.icon, key: m.key };
}

export const ULT_GRID_COLS = 3;
export const ULT_GRID_ROWS = 3;
export const ULT_GRID_SIZE = ULT_GRID_COLS * ULT_GRID_ROWS; // 9

// Индексы нижнего ряда — премиум (TERRON Prime).
export const ULT_PREMIUM_INDICES = new Set<number>([6, 7, 8]);

export interface UltGridSlot {
  type: UnitType | null; // null = пустой слот (пул меньше сетки)
  premium: boolean; // нижний ряд — TERRON Prime
}

// terron: ЕДИНСТВЕННАЯ проверка премиума (TERRON Prime) на клиенте.
// С 25.08 прем выдаётся автоматом за любой донат (лестница по пакетам, см.
// platform-api/src/orders.ts PTS_PACKS.primeDays), то есть у него появились
// живые владельцы — заглушкой это больше не является.
export function isTerronPrime(): boolean {
  try {
    // Реальный статус (кэш из /me, обновляется refreshPrimeStatus при старте) ИЛИ
    // dev-тумблер terron_prime=1 для локального теста нижнего ряда.
    return (
      localStorage.getItem("terron_prime_active") === "1" ||
      localStorage.getItem("terron_prime") === "1"
    );
  } catch {
    return false;
  }
}

// Детерминированный PRNG (mulberry32) — стабильная «случайность» по seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// terron: seed для перемешивания ульт — СТАБИЛЬНЫЙ на матч и на игрока (id матча из
// URL + smallID). Так набор/порядок не «прыгает» каждый рендер, но у каждого свой.
export function matchUltSeed(smallID: number): number {
  let gid = "";
  try {
    gid = location.pathname.split("/game/")[1] ?? "";
  } catch {
    /* нет location — seed по smallID */
  }
  return hashStr(gid + ":" + smallID);
}

// terron: ОБЩИЙ рефреш-оффсет ульт (переролл сетки за ЛТС) — один на матч, общий
// для десктоп-панели (UnitDisplay) и мобильного радиала. Сбрасывается при смене
// матча. Каждый рефреш меняет seed (новая сетка) И разблокирует прем-ряд.
// Спека: ult-refresh-economy. Цену назначает СЕРВЕР — тут только показ.
let _ultRefreshOffset = 0;
let _ultRefreshGid = "";
export function currentGid(): string {
  try {
    return location.pathname.split("/game/")[1] ?? "";
  } catch {
    return "";
  }
}
export function getUltRefreshOffset(): number {
  const gid = currentGid();
  if (gid !== _ultRefreshGid) {
    _ultRefreshGid = gid;
    _ultRefreshOffset = 0;
  }
  return _ultRefreshOffset;
}
export function bumpUltRefreshOffset(): void {
  getUltRefreshOffset(); // синхронизирует gid (сброс при смене матча)
  _ultRefreshOffset++;
}

/**
 * ⚠️ ПОДНЯТЬ СЧЁТЧИК ДО СЕРВЕРНОГО (26.08). Оффсет жил ТОЛЬКО в памяти вкладки,
 * а сервер считает рефреши по леджеру за этот gameId. F5 посреди матча обнулял
 * счётчик клиента, и получалось две беды сразу:
 *   • кнопка обещала 10 ЛТС, а списывалось 20 (потом 40 вместо 20 — с удвоением
 *     разрыв растёт);
 *   • сетка возвращалась к БАЗОВОМУ набору — то есть перезагрузкой откатывался
 *     уже оплаченный переролл, вместе с закреплённым МИРВом.
 * Значение приходит из `GET /me/ult-refresh` (client/UltRefreshSync.ts).
 *
 * ⚠️ Только ВВЕРХ: ответ мог уехать до того, как игрок нажал рефреш, и опустить
 * счётчик значило бы отдать ему оплаченный набор обратно.
 */
export function primeUltRefreshOffset(n: number): void {
  if (!Number.isFinite(n) || n <= 0) return;
  getUltRefreshOffset(); // синхронизирует gid
  if (n > _ultRefreshOffset) _ultRefreshOffset = Math.floor(n);
}
/** Seed сетки с учётом рефрешей (каждый рефреш — новая перемешка). */
export function effectiveUltSeed(smallID: number): number {
  return (matchUltSeed(smallID) ^ (getUltRefreshOffset() * 0x9e3779b1)) >>> 0;
}
/**
 * Прем-ряд разблокирован — ТОЛЬКО у TERRON Prime.
 *
 * ⚠️ terron 25.08 (решение владельца): «режем для не премов нижний ряд сетки,
 * т.е. реролл у премов 9 ультов, у остальных 6». Раньше здесь стояло
 * `|| getUltRefreshOffset() > 0` — то есть ряд открывал ЛЮБОЙ платный рефреш
 * за 10 ЛТС, и премиум-привилегия обходилась за копейки. Теперь рефреш делает
 * ровно то, за что заплачено: новая перемешка, а не +3 слота.
 */
export function ultPrimeUnlocked(): boolean {
  return isTerronPrime();
}
/**
 * Ориентировочная цена СЛЕДУЮЩЕГО рефреша для показа (сервер — источник истины).
 *
 * terron 26.08 (решение владельца): цена УДВАИВАЕТСЯ каждый раз — 10/20/40/80…
 * (был плоский шаг +10, и десятый переролл стоил почти как второй).
 * ⚠️ ЗЕРКАЛО серверной `ultRefreshPrice` (platform-api/src/wallet.ts), включая
 * потолок степени. Меняешь формулу — правь ОБЕ: иначе кнопка обещает одно, а
 * списывается другое.
 */
export const ULT_REFRESH_BASE_PRICE = 10;
export const ULT_REFRESH_PRICE_FACTOR = 2;
export const ULT_REFRESH_PRICE_MAX_POW = 16;
export function ultRefreshPriceFor(n: number): number {
  const k = Math.max(0, Math.min(Math.floor(n), ULT_REFRESH_PRICE_MAX_POW));
  return ULT_REFRESH_BASE_PRICE * ULT_REFRESH_PRICE_FACTOR ** k;
}
export function ultRefreshDisplayPrice(): number {
  return ultRefreshPriceFor(getUltRefreshOffset());
}

/**
 * Построить сетку 3×3 из пула доступных ульт. terron: слот 0 — ВСЕГДА «Ядерный
 * завод» (он разблокирует МИРВ; сам МИРВ БОЛЬШЕ НЕ выбор ульты). Остальные —
 * ПЕРЕМЕШАНЫ детерминированно по seed (стабильно на матч+игрока), при пуле >8 —
 * берутся первые 8 после перемешивания. seed=0 → без перемешки. ULTIMATES.md
 */
export function buildUltimateGrid(
  pool: UnitType[],
  seed = 0,
  /**
   * terron 23.08: ПОКАЗАТЬ ВСЁ. На полигоне (/test) сетка обязана показывать
   * ВЕСЬ список ульт целиком — он для того и заведён, чтобы щупать здания, а
   * не крутить рулетку из девяти слотов. Ни перемешивания, ни премиум-замков,
   * ни ограничения размером сетки. В обычном матче параметр не передаётся и
   * поведение прежнее.
   */
  showAll = false,
  /**
   * terron 24.08 (решение владельца): «слоты, которые я могу выбрать, — я
   * должен уметь выбирать». Замок аккаунта (ultLockedForMe) НЕ занимает
   * выбираемые слоты: свободные слоты заполняются только доступными ультами,
   * закрытые уходят в прем-слоты — они и так недоступны непрему. У према
   * (или после рефреша) выбираемы ВСЕ девять — закрытые не показываются вовсе.
   */
  lockedForMe?: (t: UnitType) => boolean,
  premiumUnlocked = false,
  /**
   * terron 26.08: ЗАКРЕПИТЬ МИРВ СЛОТОМ 0 — только для БАЗОВОГО набора.
   * Вызывающий передаёт `getUltRefreshOffset() === 0`: в базовом ролле Ядерный
   * завод (он же «МИРВ») стоит первым, в любом следующем наборе его в сетке
   * нет — он уже отфильтрован из `rest`, поэтому достаточно не подставлять его
   * в начало. Флагом, а не чтением оффсета внутри, чтобы функция осталась
   * чистой (её крутят тесты и полигон).
   */
  anchorNuclearFactory = true,
): UltGridSlot[] {
  // terron: Ядерный завод фиксируем слотом 0 (замена МИРВа), из «остальных» его
  // исключаем, чтобы не задублировать. МИРВ в пуле ульт больше нет.
  // terron 23.08: СЕКРЕТНЫЕ ПОСТРОЙКИ (new-units/CUBE.md) — в витрине их нет.
  // Раскрытая вводом кода возвращается в сетку ПОСЛЕДНИМ слотом (см. ниже):
  // «набрал код — в углу появилась кнопка». Это единственное место, которое
  // обязано знать о секретах: постройка, рендер и лимиты работают как обычно.
  const revealed = revealedSecrets();
  const rest = pool.filter(
    (t) =>
      t !== UnitType.NuclearFactory &&
      t !== UnitType.MIRV &&
      !isSecretUltimate(t),
  );
  // TODO(bans): вычесть забаненные из rest (голосование в лобби).
  // terron 23.08 (решение владельца): на полигоне порядок — КАК В ЛОББИ, то
  // есть порядок реестра (по времени появления ульты), а не рулетка. Поэтому
  // перемешивание пропускаем ДО него, а не после.
  if (seed && !showAll) {
    const rng = mulberry32(seed);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
  }
  // Ядерный завод идёт первым, НО только если он есть в пуле: пул уже отфильтрован
  // по isUnitDisabled, и безусловная вставка показывала завод даже в лобби, где
  // ульты отключены (а «список пуст» тогда не наступал никогда).
  const ordered: (UnitType | null)[] =
    anchorNuclearFactory && pool.includes(UnitType.NuclearFactory)
      ? [UnitType.NuclearFactory, ...rest]
      : [...rest];
  if (showAll) {
    // Порядок ровно как в пуле (реестр = хронология), без подъёма Ядерного
    // завода наверх: на полигоне это просто список, а не сетка выбора.
    return pool
      .filter((t) => t !== UnitType.MIRV)
      .map((t) => ({ type: t, premium: false }));
  }
  const slots: UltGridSlot[] = [];
  if (lockedForMe) {
    const present = ordered.filter((t): t is UnitType => t !== null);
    const usable = present.filter((t) => !lockedForMe(t));
    const lockedOnes = present.filter((t) => lockedForMe(t));
    if (premiumUnlocked) {
      // Все 9 слотов выбираемы → закрытым в сетке места нет вообще.
      for (let i = 0; i < ULT_GRID_SIZE; i++) {
        slots.push({
          type: usable[i] ?? null,
          premium: ULT_PREMIUM_INDICES.has(i),
        });
      }
      return slots;
    }
    // Непрем: свободные слоты — только доступные; прем-слоты добираются
    // остатком доступных, потом закрытыми (там они честно «недоступны»).
    const freeCount = ULT_GRID_SIZE - ULT_PREMIUM_INDICES.size;
    const freeList = usable.slice(0, freeCount);
    const premList = [...usable.slice(freeCount), ...lockedOnes];
    let fi = 0;
    let pi = 0;
    for (let i = 0; i < ULT_GRID_SIZE; i++) {
      const isPrem = ULT_PREMIUM_INDICES.has(i);
      slots.push({
        type: (isPrem ? premList[pi++] : freeList[fi++]) ?? null,
        premium: isPrem,
      });
    }
    return slots;
  }
  for (let i = 0; i < ULT_GRID_SIZE; i++) {
    slots.push({
      type: ordered[i] ?? null,
      premium: ULT_PREMIUM_INDICES.has(i),
    });
  }
  // ⚠️ terron 23.08 (уточнение владельца): раскрытая кодом постройка В СЕТКУ
  // НЕ ПОПАДАЕТ. Сперва она садилась последним слотом, но игроку приходилось
  // ещё и заметить подмену — а секрет должен ощущаться как «сработало».
  // Теперь код сразу армит гост (UnitDisplay.onSecretDigit), и раскладка
  // слотов вообще не меняется: позиции 1..9 остаются на месте, значит второй
  // код набирается по той же схеме.
  void revealed;
  return slots;
}

// terron 28.09: ДУБЛЬ-ЛОББИ СОБЫТИЯ, если прежнее ушло в матч РАНЬШЕ своего слота.
//
// Репорт tomsrn 28.09: алмазное на 19:00 МСК (Milky Way, 11 мест) забилось в
// 18:59:48, а полное публичное лобби стартует сразу (апстрим). Мастер увидел,
// что лобби нет, и создал новое на nextDiamondMatchAt(now) — это ВСЁ ЕЩЁ 19:00.
// Через 12 секунд второе «алмазное» стартовало с одним игроком на другой карте.
//
// Решение владельца: второе лобби тоже набирается и ждёт людей — к сроку
// прибавляется TERRON_EVENT_OVERFLOW_MIN минут. Золотой идёт раз в 10 минут,
// ему дубль не нужен: просто следующий слот после ушедшего.
//
// Модуль без состояния: мастер хранит слот последнего увиденного лобби и
// спрашивает здесь, на какое время ставить новое.

import {
  goldenPeriodMin,
  nextDiamondMatchAt,
  nextGoldenMatchAt,
  TERRON_DIAMOND_QUIET_MS,
} from "../core/configuration/TerronTuning";

export const TERRON_EVENT_OVERFLOW_MIN = 10;

export type EventType = "golden" | "diamond" | "fair";

/**
 * Лобби типа `type` было нацелено на `prevSlot`, а сейчас его нет (стартовало).
 * Если оно ушло раньше срока (`prevSlot > now`), возвращает время для нового
 * лобби; иначе null — действует обычное расписание.
 *
 * Алмазный: prevSlot + 10 мин, если дубль не упирается в следующий обычный слот
 * (ближе 10 минут до него — ставим сразу обычный). Золотой и /fair — обычный
 * слот ПОСЛЕ ушедшего, иначе они повторили бы баг с тем же слотом.
 */
export function slotAfterEarlyStart(
  type: EventType,
  prevSlot: number | undefined,
  now: number,
  nextFair: (t: number) => number,
): number | null {
  if (prevSlot === undefined || prevSlot <= now) return null;
  if (type === "diamond") {
    const regular = nextDiamondMatchAt(prevSlot);
    const overflow = prevSlot + TERRON_EVENT_OVERFLOW_MIN * 60_000;
    return overflow + TERRON_EVENT_OVERFLOW_MIN * 60_000 <= regular
      ? overflow
      : regular;
  }
  if (type === "fair") return nextFair(prevSlot);
  return nextGoldenMatchAt(prevSlot);
}

/**
 * Золотой слот не должен совпасть с дубль-лобби алмазного (оба растащили бы
 * онлайн): сдвигаем на период вперёд, как это уже делает тихое окно вокруг
 * обычного алмазного.
 */
export function goldenAvoidingOverflow(
  goldenAt: number,
  diamondOverflowAt: number | undefined,
): number {
  if (diamondOverflowAt === undefined) return goldenAt;
  const period = goldenPeriodMin() * 60_000;
  let at = goldenAt;
  for (
    let i = 0;
    i < 12 && Math.abs(at - diamondOverflowAt) <= TERRON_DIAMOND_QUIET_MS;
    i++
  ) {
    at += period;
  }
  return at;
}

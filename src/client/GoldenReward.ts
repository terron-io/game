// terron 29.09: НАГРАДА ЗОЛОТОГО МАТЧА — 5 за победу + 1 за каждого соперника-
// человека, но не больше 10 (решение владельца). Зеркало API
// (platform-api/src/eventPayout.ts goldenRewardFor) — меняешь числа, правь ОБА места.
// terron 30.09: по этой формуле ИГРОВОЙ СЕРВЕР считает точную сумму по пику
// разных IP в лобби и кладёт её в конфиг (GameServer.noteEventPeak); клиент
// показывает число из конфига, а не вилку. Модуль живёт вне core: награда не
// влияет на симуляцию, а правка core сменила бы отпечаток ядра.
export const GOLDEN_BASE_PTS = 5;
export const GOLDEN_PER_RIVAL_PTS = 1;
export const GOLDEN_MAX_PTS = 10;

/** Награда победителю золотого по числу людей в матче (с ним самим). */
export function goldenRewardFor(
  humansInMatch: number,
  cap = GOLDEN_MAX_PTS,
): number {
  const humans = Number.isFinite(humansInMatch) ? Math.floor(humansInMatch) : 0;
  const rivals = Math.max(0, humans - 1);
  return Math.max(
    0,
    Math.min(
      cap,
      GOLDEN_MAX_PTS,
      GOLDEN_BASE_PTS + rivals * GOLDEN_PER_RIVAL_PTS,
    ),
  );
}

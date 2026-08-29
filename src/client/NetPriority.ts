// terron: приоритет сети. Игровой трафик (бины карты в лобби, старт матча) —
// священен; фоновые прегревы (OfflinePrefetch и т.п.) обязаны уступать канал.
// Мобильный интернет узкий: фоновая качалка в первую минуту = игрок входит в
// матч с опозданием (реальный кейс владельца: догрузился на 5-й секунде игры).

let busyCount = 0;

/** Игровой сетевой путь занят (качаем бины карты / прочее критичное). */
export function pushNetBusy(): void {
  busyCount++;
}

export function popNetBusy(): void {
  busyCount = Math.max(0, busyCount - 1);
}

/** Фоновым качалкам сейчас нельзя: идёт матч или греется карта лобби. */
export function netBusy(): boolean {
  return (
    busyCount > 0 ||
    (typeof document !== "undefined" &&
      document.body.classList.contains("in-game"))
  );
}

/** Экономный режим сети: Save-Data или совсем медленное соединение (2g). */
export function netConstrained(): boolean {
  const c = (
    navigator as unknown as {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!c) return false;
  if (c.saveData === true) return true;
  const t = c.effectiveType ?? "";
  return t === "slow-2g" || t === "2g";
}

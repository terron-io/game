// terron 26.08: ПОДТЯНУТЬ СЧЁТЧИК РЕФРЕШЕЙ С СЕРВЕРА.
//
// Оффсет переролла ульт жил только в памяти вкладки, а платит за него сервер по
// леджеру. F5 посреди матча обнулял клиентский счётчик: кнопка обещала 10 ЛТС
// при реальных 20, а сетка откатывалась к базовому набору — то есть оплаченный
// переролл (и снятый с нулевого слота МИРВ) возвращались перезагрузкой.
//
// ⚠️ Живёт ОТДЕЛЬНЫМ модулем, а не внутри UltimateGrid: тот намеренно чистый
// (его крутят тесты и полигон), а сюда тянется Api со всей своей сетевой
// обвязкой.
import { getUltRefreshState } from "./Api";
import { currentGid, primeUltRefreshOffset } from "./UltimateGrid";

/** Матч, для которого уже спрашивали (одна попытка на матч, не на рендер). */
let askedGid: string | null = null;

/**
 * Спросить сервер один раз за матч и, если рефреши были, поднять счётчик.
 * Зовётся из ОБЕИХ поверхностей выбора ульты (панель и радиал) — какая
 * откроется первой, та и спросит.
 *
 * @param onUpdated перерисовать интерфейс, если счётчик изменился (у радиала
 *   его нет: колесо строится по открытию, ответ к тому моменту уже пришёл).
 */
export function syncUltRefreshOnce(onUpdated?: () => void): void {
  const gid = currentGid();
  if (!gid || askedGid === gid) return;
  askedGid = gid;
  void getUltRefreshState(gid).then((state) => {
    if (!state || state.n <= 0) return;
    primeUltRefreshOffset(state.n);
    onUpdated?.();
  });
}

/** Для тестов: забыть, что уже спрашивали. */
export function resetUltRefreshSync(): void {
  askedGid = null;
}

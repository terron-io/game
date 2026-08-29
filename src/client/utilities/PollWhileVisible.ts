/**
 * pollWhileVisible — периодический опрос, который молчит, пока вкладка скрыта.
 *
 * terron ПЕРФ (08.08). Обычный `setInterval` продолжает дёргать сеть у свёрнутой
 * вкладки. Браузер сам троттлит фоновые таймеры (примерно до одного срабатывания
 * в минуту), поэтому выигрыш по CPU скромный — но СЕТЕВЫЕ запросы при этом всё
 * равно уходят, а на телефоне это радио, трафик и батарея. Плюс, вернувшись во
 * вкладку, игрок всё равно получал устаревшие данные и ждал следующего тика.
 *
 * Здесь: пока скрыто — не опрашиваем; стало видно — опрашиваем СРАЗУ (данные
 * свежие в тот момент, когда на них наконец смотрят) и дальше по расписанию.
 *
 * Возвращает функцию остановки. Она идемпотентна и снимает и таймер, и
 * слушатель — забыть половину теперь нельзя.
 */
export function pollWhileVisible(
  fn: () => void,
  intervalMs: number,
  opts: { runImmediately?: boolean } = {},
): () => void {
  let timer: number | null = null;
  let stopped = false;

  const visible = (): boolean =>
    typeof document === "undefined" || document.visibilityState === "visible";

  const tick = (): void => {
    if (stopped || !visible()) return;
    fn();
  };

  const start = (): void => {
    if (stopped || timer !== null) return;
    timer = window.setInterval(tick, intervalMs);
  };

  const stopTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onVisibility = (): void => {
    if (stopped) return;
    if (visible()) {
      // Данные за время в фоне протухли — освежаем сразу, не дожидаясь тика.
      fn();
      start();
    } else {
      stopTimer();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);

  if (opts.runImmediately === true && visible()) fn();
  if (visible()) start();

  return () => {
    if (stopped) return;
    stopped = true;
    stopTimer();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

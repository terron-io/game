// terron: ПИРАТСТВО — геометрия зоны блокады «реющий флаг» (TZ-ult-unlocks.md).
// Единый источник для сима (проходимость воды) и клиента (превью/отрисовка):
// прямоугольник 3:2 с ВОЛНИСТЫМИ верхом и низом (синусоида), центр в точке
// якоря, древка нет. Размер растёт от числа лодок: первые 10 по +10 %, дальше
// +9, +8 … +1 % (после 19-й — ноль). Скопировано по духу с флага Раскола
// (SplitGeometry), только без буквы Т.
import {
  TERRON_BLOCKADE_ASPECT_H,
  TERRON_BLOCKADE_ASPECT_W,
  TERRON_BLOCKADE_BASE_HALF_HEIGHT,
  TERRON_BLOCKADE_WAVE_AMP_PCT,
} from "../configuration/TerronTuning";

/** Множитель размера от числа лодок: 1 + Σ приращений. */
export function blockadeSizeMult(ships: number): number {
  let mult = 1;
  for (let i = 1; i <= ships; i++) {
    const inc = i <= 10 ? 10 : Math.max(0, 10 - (i - 10));
    mult += inc / 100;
  }
  return mult;
}

/** Половина высоты и половина ширины флага для N лодок (целые тайлы). */
export function blockadeFlagSize(ships: number): { hh: number; hw: number } {
  if (ships <= 0) return { hh: 0, hw: 0 };
  const hh = Math.max(
    2,
    Math.round(TERRON_BLOCKADE_BASE_HALF_HEIGHT * blockadeSizeMult(ships)),
  );
  const hw = Math.round(
    (hh * TERRON_BLOCKADE_ASPECT_W) / TERRON_BLOCKADE_ASPECT_H,
  );
  return { hh, hw };
}

/**
 * Точка внутри флага? dx/dy — смещение от центра в тайлах. Кромки волнистые:
 * верх и низ сдвинуты на amp·hh·sin(π·dx/hw), как полотнище на ветру.
 * Детерминизм: Math.sin на одинаковых входах даёт одинаковый результат на всех
 * клиентах (IEEE, одна реализация V8/JSC для double — допущение, как у Раскола
 * с Math.sqrt); флаг используется только для проходимости воды и рисунка.
 */
// sin(π·k/32)·1000, k=0..32 — целочисленная таблица: Math.sin НЕ обязан быть
// бит-идентичным между движками (V8/SpiderMonkey/JSC), а кромка флага решает
// проходимость воды для чужих кораблей (= сим). Ревью 23.08.
const SIN_PI_1000 = [
  0, 98, 195, 290, 383, 471, 556, 634, 707, 773, 831, 882, 924, 957, 981, 995,
  1000, 995, 981, 957, 924, 882, 831, 773, 707, 634, 556, 471, 383, 290, 195,
  98, 0,
];

/** Сдвиг кромки флага в тайлах (целое) для смещения dx ∈ [-hw, hw]. */
export function blockadeWave(dx: number, hh: number, hw: number): number {
  const ax = Math.abs(dx);
  const num = ax * 32; // позиция в таблице ×hw
  const q = Math.min(31, Math.floor(num / hw));
  const rem = num - q * hw;
  // линейная интерполяция в целых: (a·(hw−rem) + b·rem) / hw
  const v = Math.floor(
    (SIN_PI_1000[q] * (hw - rem) + SIN_PI_1000[q + 1] * rem) / hw,
  );
  const w = Math.floor((TERRON_BLOCKADE_WAVE_AMP_PCT * hh * v) / 100_000);
  return dx < 0 ? -w : w;
}

export function inBlockadeFlag(
  dx: number,
  dy: number,
  hh: number,
  hw: number,
): boolean {
  if (hh <= 0 || hw <= 0) return false;
  if (dx < -hw || dx > hw) return false;
  const wave = blockadeWave(dx, hh, hw);
  return dy >= -hh + wave && dy <= hh + wave;
}

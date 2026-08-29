// terron 26.08: КУЧКА КРОВАВЫХ АЛМАЗОВ — спрайт пакета пополнения.
//
// Просьба владельца: «щас просто цифры, нарисуй хоть какие-то спрайты — мало
// алмазов, много алмазов». Число само по себе не даёт почувствовать разницу
// между 50 и 2000: глазом видно ГОРКУ, а не цифру.
//
// Рисуем ОДНИМ инлайновым SVG на карточку, без картинок: горка собирается из
// повторов одного самоцвета (`<use>`), а раскладка — данные, а не рука. Так
// новый пакет = новая строка в PILES, а не новый файл в resources.
//
// ⚠️ Огранка повторяет `resources/images/BloodDiamondIcon.svg` (та же палитра и
// те же грани, сдвинутые в нулевые координаты) — иконка валюты и горка обязаны
// читаться как один предмет. Меняешь иконку — правь и здесь.
import { html, svg, TemplateResult } from "lit";

/** Самоцвет в коробке 32×35 (крона до пояска на 10, шип в 16,35). */
const GEM = svg`
  <g id="g">
    <polygon points="10,0 22,0 26,10 6,10" fill="#C8394B" />
    <polygon points="0,10 10,0 6,10" fill="#A52A3B" />
    <polygon points="32,10 22,0 26,10" fill="#A52A3B" />
    <polygon points="0,10 16,35 16,10" fill="#6E0F1E" />
    <polygon points="32,10 16,35 16,10" fill="#7C1322" />
    <polygon points="6,10 16,10 16,35" fill="#8E1B2A" />
    <polygon points="26,10 16,10 16,35" fill="#9A2233" />
    <path
      d="M0,10 H32 M10,0 L16,10 L22,0 M6,10 L16,35 L26,10"
      stroke="#4E0A14"
      stroke-width="0.8"
      fill="none"
      opacity="0.6"
    />
    <path
      d="M12,3 l1.2,2.2 l2.2,1.2 l-2.2,1.2 l-1.2,2.2 l-1.2,-2.2 l-2.2,-1.2 l2.2,-1.2 z"
      fill="#ffffff"
      opacity="0.85"
    />
  </g>`;

/**
 * ⚠️ terron 26.08 (правка владельца): «размер должен быть у всех одинаковый,
 * меняется количество» и «1 алмаз = 50 ПТС, в остальных случаях честно
 * мультиплицируй — если гора, то прям гора».
 *
 * Поэтому камень тут ФИКСИРОВАННОГО размера (раньше горка ужималась в коробку,
 * и у мелких пакетов один камень выходил гигантским — разницу между пакетами
 * было не видно), а число камней = сумме ПТС, делённой на цену одного камня.
 * Считаем от ФАКТИЧЕСКОЙ суммы: включён бонус ×2 — куча честно вдвое больше.
 */
const PTS_PER_GEM = 50;
/** Потолок — защита раскладки, а не баланс: 2000 ПТС это 40 камней, с бонусом 80. */
const MAX_GEMS = 120;

const BOX_W = 100;
const BOX_H = 62;
/** Ширина камня в единицах коробки. ОДНА на все пакеты — в этом вся правка. */
const GEM_W = 13;
const GEM_H = (GEM_W * 35) / 32;
/** Шаг в ряду: камни лежат внахлёст, как в настоящей куче. */
const STEP = GEM_W * 0.62;
/** Сколько камней влезает в самый широкий ряд. */
const MAX_ROW = Math.max(
  1,
  Math.floor((BOX_W * 0.94 - GEM_W * 0.38) / STEP),
);

/** Сколько камней рисуем за эту сумму. */
export function gemsForPts(pts: number): number {
  const n = Math.round(pts / PTS_PER_GEM);
  return Math.max(1, Math.min(n, MAX_GEMS));
}

/**
 * Разложить N камней в кучу: ряды СНИЗУ ВВЕРХ, каждый следующий на камень уже
 * (обычная насыпь). Кончились ряды, а камни остались — начинаем новый слой от
 * самого широкого: куча просто становится выше, а не вылезает вбок.
 */
function heapRows(n: number): number[] {
  const rows: number[] = [];
  let left = n;
  let width = Math.min(MAX_ROW, Math.max(1, Math.ceil((Math.sqrt(8 * n + 1) - 1) / 2)));
  while (left > 0) {
    const take = Math.min(left, width);
    rows.push(take);
    left -= take;
    width = width > 1 ? width - 1 : Math.min(MAX_ROW, Math.max(1, Math.ceil((Math.sqrt(8 * left + 1) - 1) / 2)));
  }
  return rows;
}

/**
 * Спрайт кучи на `pts` алмазов. Размер камня одинаковый ВСЕГДА — меняется
 * только их число.
 */
export function gemPile(pts: number): TemplateResult {
  const rows = heapRows(gemsForPts(pts));
  // Этажи проседают в стыки нижнего; если этажей много — садятся плотнее,
  // чтобы куча не вылезала за верх коробки (камень при этом НЕ мельчает).
  const dy = Math.min(
    GEM_H * 0.52,
    rows.length > 1 ? (BOX_H - 3 - GEM_H) / (rows.length - 1) : GEM_H,
  );
  // ⚠️ Куча стоит ПО ЦЕНТРУ коробки, а не на нижней кромке. Камень теперь у
  // всех пакетов одного размера, поэтому «50 алмазов» — это один камешек: на
  // полу он выглядел бы обронённым в пустой витрине. Большие кучи занимают
  // коробку целиком, и центровка на них не сказывается.
  const pileH = (rows.length - 1) * dy + GEM_H;
  const top = Math.max(1, (BOX_H - pileH) / 2);
  const floor = top + pileH;

  const gems: TemplateResult[] = [];
  // ⚠️ ПОРЯДОК ОТРИСОВКИ — СВЕРХУ ВНИЗ, то есть от дальнего ряда к ближнему:
  // в куче передние камни закрывают задние, а не наоборот. Рисовали снизу вверх
  // — верхние ряды ложились поверх нижних, и горка читалась как плоский веер.
  for (let row = rows.length - 1; row >= 0; row--) {
    const n = rows[row];
    const y = floor - GEM_H - row * dy;
    // Дальние ряды чуть глуше: дешёвая глубина без теней и градиентов, в духе
    // плоской террон-графики.
    const dim = rows.length > 1 ? 1 - (row / (rows.length - 1)) * 0.25 : 1;
    for (let i = 0; i < n; i++) {
      const x = BOX_W / 2 + (i - (n - 1) / 2) * STEP - GEM_W / 2;
      gems.push(
        svg`<use
          href="#g"
          opacity=${dim.toFixed(2)}
          transform="translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${(
            GEM_W / 32
          ).toFixed(4)})"
        />`,
      );
    }
  }

  return html`<svg
    viewBox="0 0 ${BOX_W} ${BOX_H}"
    width="100%"
    height="100%"
    role="img"
    aria-hidden="true"
    style="display:block;overflow:visible"
  >
    <defs>${GEM}</defs>
    ${gems}
  </svg>`;
}

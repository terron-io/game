/**
 * terron: ПОЛИГОН `/v2` — та же песочница, что `/test`, плюс переключалка
 * ВИЗУАЛЬНЫХ СТИЛЕЙ карты (см. render/gl/VisualStyles.ts).
 *
 * Зачем отдельный адрес, а не флаг на `/test`: полигон — рабочий инструмент
 * для механик, и лишняя панель поверх карты там мешает. `/v2` — витрина: зашёл,
 * пощёлкал пять визуалов на живой карте, снял скриншоты, вышел.
 *
 * ⚠️ Конфиг матча НЕ дублируется: он один (TEST_GROUND_CONFIG) — иначе полигоны
 * разъехались бы по золоту/ботам/ультам, и сравнивать стили пришлось бы на
 * другой игре, чем щупаешь механики.
 *
 * `?style=neon` — открыть сразу в нужном стиле (удобно кидать ссылкой).
 */

import {
  mountVisualSwitcher,
  unmountVisualSwitcher,
} from "./hud/VisualSwitcher";
import { VISUAL_STYLES } from "./render/gl/VisualStyles";
import { launchTestGround } from "./TestGround";
import { setVisualStyleId } from "./VisualStyleStore";

/** Адрес полигона визуалов (с учётом префикса воркера, как у /test). */
export const VISUAL_LAB_PATH = /^\/(?:w\d+\/)?v2\/?$/;

/** `?style=` → стиль из каталога. Мусор игнорируем (останется прежний). */
export function applyVisualLabStyle(search: string): void {
  const want = new URLSearchParams(search).get("style");
  if (want === null) return;
  const found = VISUAL_STYLES.find((s) => s.id === want.toLowerCase());
  if (found) setVisualStyleId(found.id);
}

/**
 * Флаг «эта вкладка — полигон визуалов». Нужен потому, что при старте матча
 * адрес становится `/game/<id>`: после F5 (или HMR в деве) путь `/v2` уже не
 * совпадает, и панель не возвращалась бы — а именно на перезагрузке её ждут
 * больше всего (перезаход в тот же матч со свежей сборкой).
 */
const LAB_FLAG = "terron_v2_lab";

function markLab(): void {
  try {
    sessionStorage.setItem(LAB_FLAG, "1");
  } catch {
    /* приватный режим — панель просто не переживёт перезагрузку */
  }
}

/** Адрес идущего матча — сюда полигон уезжает сразу после старта игры. */
const GAME_PATH = /^\/(?:w\d+\/)?game\/[A-Za-z0-9_-]+\/?$/;

function clearLab(): void {
  try {
    sessionStorage.removeItem(LAB_FLAG);
  } catch {
    /* ignore */
  }
}

/**
 * Вернуть панель после перезагрузки, если вкладка всё ещё в лаборатории.
 *
 * ⚠️ Лаборатория — это `/v2` И матч, из неё запущенный (`/game/<id>`), но НЕ
 * весь остаток жизни вкладки: поймано на живом деве — после `/v2` панель
 * вылезала на `/test`, где она только мешает (там щупают механики, а не
 * картинку). Ушёл на другой адрес — флаг снимаем и панель убираем.
 */
export function remountVisualLabPanel(): void {
  let inLab = false;
  try {
    inLab = sessionStorage.getItem(LAB_FLAG) === "1";
  } catch {
    return;
  }
  if (!inLab) return;
  const path = window.location.pathname;
  if (VISUAL_LAB_PATH.test(path) || GAME_PATH.test(path)) {
    mountVisualSwitcher();
    return;
  }
  clearLab();
  unmountVisualSwitcher();
}

export async function launchVisualLab(
  target: EventTarget = document.body,
  search: string = window.location.search,
): Promise<void> {
  markLab();
  applyVisualLabStyle(search);
  mountVisualSwitcher();
  await launchTestGround(target, search);
}

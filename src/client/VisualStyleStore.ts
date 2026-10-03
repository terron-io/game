/**
 * terron: ХРАНИЛИЩЕ ВЫБРАННОГО ВИЗУАЛЬНОГО СТИЛЯ.
 *
 * Каталог стилей — чистые данные (`render/gl/VisualStyles.ts`), тут только
 * «что выбрано» и «кого разбудить при смене». Разведено намеренно: рендер не
 * должен знать ни про localStorage, ни про события окна.
 *
 * ⚠️ Стиль ГЛОБАЛЬНЫЙ и переживает перезагрузку: переключалка живёт на полигоне
 * `/v2`, но выбранный там стиль виден и в обычном матче — иначе «хорош ли
 * он на самом деле» нельзя проверить в бою. Сброс — «Классика».
 */

import {
  DEFAULT_VISUAL_STYLE_ID,
  visualStyleById,
  type VisualStyle,
  type VisualStyleId,
} from "./render/gl/VisualStyles";

const KEY = "terron_visual_style";
export const VISUAL_STYLE_CHANGED_EVENT = "terron-visual-style-changed";

let current: VisualStyleId | null = null;

function load(): VisualStyleId {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) return visualStyleById(raw).id;
  } catch {
    // Приватный режим / чужой кадр — не беда, работаем на классике.
  }
  return DEFAULT_VISUAL_STYLE_ID;
}

export function currentVisualStyleId(): VisualStyleId {
  current ??= load();
  return current;
}

export function currentVisualStyle(): VisualStyle {
  return visualStyleById(currentVisualStyleId());
}

/** Выбрать стиль: сохранить и разбудить подписчиков (рендер + панель). */
export function setVisualStyleId(id: VisualStyleId): void {
  const style = visualStyleById(id);
  if (current === style.id) return;
  current = style.id;
  try {
    localStorage.setItem(KEY, style.id);
  } catch {
    // Не сохранилось — стиль всё равно применится в этой вкладке.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<VisualStyleId>(VISUAL_STYLE_CHANGED_EVENT, {
        detail: style.id,
      }),
    );
  }
}

/** Подписка на смену стиля. `signal` — чтобы слушатель не пережил матч. */
export function onVisualStyleChange(
  fn: (style: VisualStyle) => void,
  signal?: AbortSignal,
): void {
  if (typeof window === "undefined") return;
  window.addEventListener(
    VISUAL_STYLE_CHANGED_EVENT,
    () => fn(currentVisualStyle()),
    { signal },
  );
}

// terron: аватарки пользователей. Дефолт — детерминированный ПИКСЕЛЬ-ПОРТРЕТ
// («граватар в нашем стиле», глаза+нос буквой Т — см. PortraitArt.ts), генерится
// на клиенте, без бэкенда и внешних сервисов (оффлайн-first). Кастомный аватар
// (data-URL) хранится в users.avatar. См. avatar.md, profiles.md.
// Идентикон 5×5 остался фолбэком на случай, если canvas недоступен (тесты/SSR).

import { getApiBase } from "./Api";
import { generatedPortraitDataUri } from "./PortraitArt";

/** Простой строковый хеш (FNV-1a-ish) → uint32. */
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Детерминированный идентикон seed → SVG-строка (5×5, зеркальный по вертикали). */
export function identiconSvg(seed: string, size = 64): string {
  const h = hashSeed(seed || "?");
  // цвет из хеша: приятный насыщенный тон на светлом фоне
  const hue = h % 360;
  const fg = `hsl(${hue} 58% 45%)`;
  const bg = `hsl(${hue} 40% 94%)`;
  const cells: string[] = [];
  const grid = 5;
  // 15 бит (3 колонки × 5 рядов), зеркалим 4-ю и 5-ю колонки
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < grid; row++) {
      const bit = (h >>> (col * grid + row)) & 1;
      if (!bit) continue;
      const cols = col === 2 ? [2] : [col, grid - 1 - col];
      for (const c of cols) {
        cells.push(
          `<rect x="${c}" y="${row}" width="1" height="1"/>`,
        );
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 5 5" shape-rendering="crispEdges"><rect width="5" height="5" fill="${bg}"/><g fill="${fg}">${cells.join("")}</g></svg>`;
}

/** Идентикон как data-URI (для <img src> / CSS background). */
export function identiconDataUri(seed: string, size = 64): string {
  return `data:image/svg+xml,${encodeURIComponent(identiconSvg(seed, size))}`;
}

/** Дефолтная аватарка по seed: пиксель-портрет, при сбое canvas — идентикон. */
export function defaultAvatar(seed: string, size = 64): string {
  try {
    return generatedPortraitDataUri(seed);
  } catch {
    return identiconDataUri(seed, size);
  }
}

/**
 * Ссылка на КАРТИНКУ чужой аватарки. Списки (топы, друзья) не таскают data-URL
 * в JSON — иначе таблица на 100 строк весила бы сотни килобайт; они отдают
 * флаг `hasAvatar`, а картинку браузер берёт отсюда и кеширует
 * (platform-api `GET /avatar/:slug`, ETag + max-age). Без своей аватарки роут
 * честно отдаёт 404 — поэтому зовём его ТОЛЬКО при hasAvatar.
 */
export function customAvatarUrl(slug: string): string {
  return `${getApiBase()}/avatar/${encodeURIComponent(slug)}`;
}

/**
 * Итоговый src аватарки. Приоритет:
 *   1) `avatar` — готовый data-URL/ссылка (свой профиль, чужой профиль);
 *   2) `hasAvatar` + `slug` — ссылка на картинку в API (списки, матч);
 *   3) портрет по seed — базовая аватарка любого нового игрока.
 */
export function avatarSrc(opts: {
  avatar?: string | null;
  hasAvatar?: boolean;
  slug?: string | null;
  seed: string;
  size?: number;
}): string {
  const a = opts.avatar?.trim();
  if (a && (a.startsWith("data:image/") || a.startsWith("http"))) return a;
  if (opts.hasAvatar && opts.slug) return customAvatarUrl(opts.slug);
  return defaultAvatar(opts.seed, opts.size ?? 64);
}

/**
 * terron 25.08: ПОДСТРАХОВКА ДЛЯ БИТОЙ КАРТИНКИ.
 *
 * Списки просят картинку по флагу `hasAvatar`, а он и реальная отдача файла —
 * разные системы: аватарку могли удалить между запросом списка и загрузкой
 * картинки, а до 25.08 сервер вообще не находил игроков с ЧИСЛОВЫМ слагом
 * (репорт: PYK, slug «4242») и честно отвечал 404. Итог был одинаковый — пустая
 * дырка в строке вместо лица. Теперь при отказе подставляем портрет по seed:
 * пусть будет сгенерированный, чем никакой.
 *
 * `onerror` снимаем сразу: если и портрет не нарисуется, второй заход устроит
 * бесконечный цикл событий.
 */
export function avatarFallback(seed: string, size = 64) {
  return (e: Event) => {
    const img = e.currentTarget as HTMLImageElement | null;
    if (!img) return;
    img.onerror = null;
    const portrait = defaultAvatar(seed, size);
    if (img.src !== portrait) img.src = portrait;
  };
}

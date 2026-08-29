// terron: с какого устройства играли. Нужно для спидран-топа — забег с
// телефона объективно сложнее (мелкие цели, нет хоткеев), и владелец хочет
// видеть это значком в таблице.
//
// ИСТОЧНИК — заголовок User-Agent WebSocket-апгрейда на игровом сервере
// (Worker.ts), а НЕ поле в join-сообщении: так значение не надо тащить через
// клиентскую схему и его сложнее подделать «мимоходом». Полностью честным оно
// всё равно не является — UA задаёт браузер, а его можно переключить
// (DevTools/десктопный режим). Значок = справка, не античит: категории топа
// по устройству НЕ делим, иначе появляется смысл врать.

export const DEVICE_KINDS = ["mobile", "tablet", "desktop"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export function isDeviceKind(v: unknown): v is DeviceKind {
  return typeof v === "string" && (DEVICE_KINDS as readonly string[]).includes(v);
}

/**
 * Классификация UA. Порядок проверок важен: планшет ловим ДО телефона
 * (Android-планшет = "Android" без "Mobile"; iPad с iPadOS 13+ притворяется
 * Mac'ом, но отдаёт "iPad" в UA только в мобильном режиме — десктопный режим
 * iPad неотличим от Mac, и это ок: считаем десктопом, раз он сам так себя
 * подаёт). Неизвестный/пустой UA → undefined (в БД NULL, значка нет).
 */
export function deviceFromUserAgent(ua: string | undefined): DeviceKind | undefined {
  if (typeof ua !== "string" || ua.length === 0) return undefined;
  const s = ua.toLowerCase();

  if (/ipad|tablet|playbook|silk|kindle/.test(s)) return "tablet";
  if (/android/.test(s) && !/mobile/.test(s)) return "tablet";
  if (/iphone|ipod|android|windows phone|iemobile|blackberry|bb10|opera mini|mobile safari|fennec/.test(s)) {
    return "mobile";
  }
  if (/windows nt|macintosh|mac os x|x11|linux|cros|electron/.test(s)) {
    return "desktop";
  }
  return undefined;
}

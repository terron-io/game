// terron 30.08: КУДА СЛАТЬ HTTP-ЗАПРОСЫ К ИГРОВОМУ СЕРВЕРУ.
//
// Обычно это тот же origin, что и страница, поэтому пути писались относительными
// (`/w0/api/game/<id>/exists`). Но когда бандл лежит на ЧУЖОМ хостинге (Playgama
// и подобные), относительный путь уходит на ИХ домен и отвечает 404 — проверка
// лобби рушится, а за ней и вход в матч (поймано живой проверкой бандла: в
// перехвате fetch первым же шло `404 /w0/api/game/.../exists`).
//
// Хост вшивается при сборке тем же `__GAME_HOST__`, что у вебсокетов
// (см. Transport.resolveRemoteWs) — один источник правды на оба протокола.
declare const __GAME_HOST__: string | undefined;

/** Префикс для путей игрового сервера: "" в вебе, "https://terron.io" в бандле. */
export function gameOrigin(): string {
  return typeof __GAME_HOST__ === "string" && __GAME_HOST__.length > 0
    ? `https://${__GAME_HOST__}`
    : "";
}

/**
 * ПУБЛИЧНЫЙ адрес сайта — для ссылок, которые уходят НАРУЖУ: приглашение в
 * лобби, «Позвать друзей», открытие досье в браузере.
 *
 * ⚠️ Нельзя брать `location.origin`: в апке страница живёт на `http://localhost`
 * (Android), `capacitor://localhost` (iOS) или `terron://localhost` (десктоп).
 * Оттуда получалось «скопируй другу http://localhost/game/ABC» и — главное —
 * `window.open("/@ник", "_blank")` уводил игрока в СИСТЕМНЫЙ БРАУЗЕР на
 * `http://localhost/@ник`, то есть на страницу ошибки. Ровно это репортили с
 * Android 06.09: «постоянно из приложения выкидывает в браузер localhost».
 *
 * Локальная разработка (`localhost:9000`) не задета: там есть порт, и origin
 * возвращается как есть.
 */
export const CANONICAL_SITE_ORIGIN = "https://terron.io";

/**
 * Чистая половина `publicSiteOrigin` — вынесена ради тестов (адрес страницы в
 * jsdom не подменить). Возвращает `null`, если по этому адресу ссылку наружу
 * давать НЕЛЬЗЯ: оболочка апки (`capacitor://`, `terron://`, `http://localhost`
 * без порта).
 */
export function publicOriginFromHref(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const localHost = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    // Локальная разработка живёт на порту (9000) — её origin годится.
    const devServer = localHost && u.port !== "" && u.port !== "80";
    if (localHost && !devServer) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function publicSiteOrigin(): string {
  if (typeof __GAME_HOST__ === "string" && __GAME_HOST__.length > 0) {
    return `https://${__GAME_HOST__}`;
  }
  return publicOriginFromHref(window.location.href) ?? CANONICAL_SITE_ORIGIN;
}

/**
 * Домен, от которого клиент считает адрес API и проверяет `aud` в токене.
 *
 * ⚠️ Обычно он ВЫВОДИТСЯ ИЗ АДРЕСА СТРАНИЦЫ (`getAudience`: две последние части
 * hostname). На чужом хостинге это даёт чужой домен: в QA-инструменте Playgama
 * страница живёт на `<id>.games.playgama.net`, и клиент честно шёл на
 * НЕСУЩЕСТВУЮЩИЙ `api.playgama.net` — оттуда лавина `ERR_NAME_NOT_RESOLVED`,
 * долгая загрузка на ретраях и мёртвый вход. Тот же класс, что был у
 * `terron://app` → `https://api.app` в десктопной сборке.
 *
 * Возвращает пустую строку вне платформенной сборки — там прежний вывод из
 * адреса верен и трогать его незачем.
 */
export function apiAudienceHost(): string {
  return typeof __GAME_HOST__ === "string" && __GAME_HOST__.length > 0
    ? __GAME_HOST__
    : "";
}

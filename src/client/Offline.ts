// terron: единый источник правды по офлайн-состоянию клиента + событие смены.
// Используется, чтобы: (1) показать предупреждение «офлайн — без наград» в
// одиночной игре, (2) погасить мультиплеер (он всё равно требует сервер),
// (3) подсветить недоступные офлайн карты.

export const OFFLINE_CHANGE_EVENT = "terron-offline-change";

// terron: navigator.onLine ВРЁТ (Windows + виртуальные адаптеры: браузер считает
// себя офлайн при живой сети) → у игроков лобби форсилось в «Оффлайн», а
// Приватно/Публично дизейблились («онлайн нельзя», жалобы 16.07). Лечим
// доказательством жизни: лобби-сокет репортит фактический трафик
// (reportNetworkAlive) — если он свежий, мы ОНЛАЙН, что бы ни думал браузер.
// Настоящий офлайн ловится по старению отметки (сокет молчит > окна).
let lastNetworkAliveAt = 0;
const NETWORK_ALIVE_WINDOW_MS = 15_000;

export function isOffline(): boolean {
  if (typeof navigator === "undefined" || navigator.onLine !== false) {
    return false;
  }
  return Date.now() - lastNetworkAliveAt > NETWORK_ALIVE_WINDOW_MS;
}

/** Зовётся из живых сетевых каналов (лобби-сокет) при реальном трафике. */
export function reportNetworkAlive(): void {
  const wasOffline = isOffline();
  lastNetworkAliveAt = Date.now();
  // navigator.onLine=false, но трафик пошёл → мнение isOffline() сменилось,
  // будим подписчиков (GameModeSelector, HostLobbyModal), как при событии online.
  if (wasOffline && typeof window !== "undefined" && isOffline() === false) {
    window.dispatchEvent(
      new CustomEvent(OFFLINE_CHANGE_EVENT, { detail: { offline: false } }),
    );
    // Телеметрия: сколько игроков реально ловят враньё navigator.onLine
    // (класс бага «онлайн нельзя» 16.07). Динамический импорт — разрыв цикла
    // Offline ← LobbySocket и нулевая цена на здоровом пути.
    void import("./Health").then(({ reportHealth }) =>
      reportHealth("online_lie"),
    );
  }
}

// terron: карты, ВШИТЫЕ в нативный офлайн-бандл (scripts/build-offline-bundle.sh).
// В апке это локальные файлы → фетчатся офлайн, даже если их нет в MapCache.
// Ключ — lowercase-имя папки карты (как folderOf / mapKey.toLowerCase()).
export const BUNDLED_OFFLINE_MAPS = new Set([
  "world",
  "europe",
  "northamerica",
  "southamerica",
  "asia",
  "africa",
  "japan",
]);

// Доступна ли карта офлайн за счёт нативного бандла (только в Capacitor-апке).
export function isBundledOfflineMap(key: string): boolean {
  try {
    const cap = (
      window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor;
    return !!cap?.isNativePlatform?.() && BUNDLED_OFFLINE_MAPS.has(key);
  } catch {
    return false;
  }
}

if (typeof window !== "undefined") {
  const emit = () =>
    window.dispatchEvent(
      new CustomEvent(OFFLINE_CHANGE_EVENT, {
        detail: { offline: isOffline() },
      }),
    );
  window.addEventListener("online", emit);
  window.addEventListener("offline", emit);
}

/** Подписаться на смену онлайн/офлайн. Возвращает функцию отписки. */
export function onOfflineChange(cb: (offline: boolean) => void): () => void {
  const handler = () => cb(isOffline());
  window.addEventListener(OFFLINE_CHANGE_EVENT, handler);
  return () => window.removeEventListener(OFFLINE_CHANGE_EVENT, handler);
}

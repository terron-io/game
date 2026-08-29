// terron: регистрация service worker'а офлайна (resources/sw.js → /sw.js).
// Прекеширует оболочку приложения, чтобы игра открывалась без сети. Сами карты
// кешируются отдельно (src/core/game/MapCache.ts). Side-effect import из Main.ts.

import { prefetchOfflineMaps } from "./OfflinePrefetch";

// terron: нативный бандл (iOS/Android) живёт на origin localhost — файлы вшиты в
// апку, WebView отдаёт их напрямую и свежими. SW тут не нужен и ВРЕДЕН (кеширует
// оболочку → после обновления апки отдаёт старую). Поэтому на нативе НЕ
// регистрируем SW, а наоборот сносим существующий + чистим shell-кэши.
const IS_NATIVE_BUNDLE =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" || location.hostname === "127.0.0.1");

/**
 * terron 23.08 (просьба владельца: «при входе на тест надо кэш локальный
 * ронять, чтобы я точно свежие правки получал»).
 *
 * ⚠️ ЗАЧЕМ. Полигон `/test` — инструмент проверки СВЕЖЕЙ сборки. А оболочку
 * приложения кеширует service worker, и после выката он может отдать СТАРЫЙ
 * бандл: игра выглядит обновлённой, но и интерфейс, и СИМУЛЯЦИЯ (она в том же
 * бандле, в воркере) остаются прежними. Полдня разбора «ты ничего не починил»
 * стоило ровно этого класса.
 *
 * Поэтому на `/test` перед стартом: сносим SW, чистим все его кэши и ОДИН раз
 * перезагружаемся. Гард в sessionStorage — чтобы не уйти в петлю перезагрузок.
 */
const TEST_PATH = /^\/(?:w\d+\/)?test\/?$/;
const FRESH_KEY = "terron_test_fresh";

async function dropCachesForTestGround(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Кэш почистить не удалось — не повод не пускать в игру.
  }
  sessionStorage.setItem(FRESH_KEY, "1");
  location.reload();
}

if (
  typeof location !== "undefined" &&
  TEST_PATH.test(location.pathname) &&
  typeof sessionStorage !== "undefined" &&
  sessionStorage.getItem(FRESH_KEY) === null
) {
  void dropCachesForTestGround();
}

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  const boot = () => {
    // На полигоне SW не регистрируем вовсе: он для офлайна, а тут нужна
    // гарантированно свежая сборка.
    if (typeof location !== "undefined" && TEST_PATH.test(location.pathname)) {
      return;
    }
    if (IS_NATIVE_BUNDLE) {
      // Снести любой ранее зарегистрированный SW и протухшие shell-кэши.
      void navigator.serviceWorker
        .getRegistrations()
        .then((rs) => rs.forEach((r) => void r.unregister()))
        .catch(() => {});
      if (typeof caches !== "undefined") {
        void caches
          .keys()
          .then((ks) =>
            ks
              .filter((k) => k.startsWith("terron-shell-"))
              .forEach((k) => void caches.delete(k)),
          )
          .catch(() => {});
      }
      // Прогрев офлайн-карты полезен, файлы в основном локальные — дёшево.
      setTimeout(() => void prefetchOfflineMaps(), 10_000);
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.warn("[sw] регистрация не удалась:", e);
    });
    // terron (2026-07-05): обычной веб-вкладке НЕ греем офлайн при заходе —
    // пассивный кэш (MapCache + SW по факту запроса) наполняется сам во время
    // игры, а полный прегрев дыр запускает Main ПОСЛЕ первого матча
    // (schedulePostGamePrefetch). Исключение — PWA с главного экрана
    // (standalone): это кандидаты на офлайн, им греем вскоре после запуска.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) {
      setTimeout(() => void prefetchOfflineMaps(), 10_000);
    }
  };
  if (document.readyState === "complete") {
    boot();
  } else {
    window.addEventListener("load", boot, { once: true });
  }
}

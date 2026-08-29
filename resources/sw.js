/* terron: service worker для офлайна. Кеширует ОБОЛОЧКУ приложения (HTML, JS,
 * CSS, wasm, шрифты, картинки) так, чтобы страница открывалась без сети.
 *
 * Разделение ответственности:
 *  - бинарники карт (/maps/.../map*.bin, manifest.json) кешируются НЕ здесь, а в
 *    приложении (src/core/game/MapCache.ts) с бюджетом 50 МБ и LRU. Поэтому SW
 *    их пропускает мимо — иначе хранилище раздуется.
 *  - мультиплеер/API (/api, /lobbies, /w0, /w1, вебсокеты) НИКОГДА не кешируется.
 *
 * Стратегии:
 *  - навигация (HTML) → network-first, фолбэк на закешированную оболочку «/».
 *  - статика оболочки (same-origin) → stale-while-revalidate (мгновенно из
 *    кеша + тихое обновление в фоне).
 *
 * Замечание: при включённом CDN (CDN_BASE) ассеты становятся cross-origin и SW
 * их не кеширует — на dev/прод-без-CDN всё same-origin, офлайн работает.
 */

// v4: bump → старый кэш протухнет на activate. Версию бампать при КАЖДОМ
// изменении логики кэширования / чтобы пробить залипшую оболочку (напр. инлайн
// иконок офлайн-фикса 28.06 — старый кэш отдавал прошлый JS без правок).
// v5 (29.06): эвикт ОТРАВЛЕННОЙ оболочки. В iOS-итерациях на лайв/дев временно
// уезжал бутстрап БЕЗ гарда `isNative` (см. index.html) — SW его закешировал, и
// на флакающей сети навигация падала в этот кэш → старый бутстрап исполнялся в
// ОБЫЧНОМ БРАУЗЕРЕ и делал location.replace("https://localhost/") (нет такого
// хоста → ERR_CONNECTION_REFUSED, «перекидывает само»). Бамп сносит её на activate.
const SHELL_CACHE = "terron-shell-v7";

// terron: НАТИВНЫЙ БАНДЛ (iOS/Android, origin=localhost) — файлы вшиты в апку,
// WKWebView отдаёт их НАПРЯМУЮ и всегда СВЕЖИЕ. SW тут не нужен и ВРЕДЕН: он
// кеширует оболочку и после обновления апки отдаёт СТАРУЮ (контейнер данных
// WKWebView переживает апдейт). Поэтому на localhost SW = no-op (см. fetch).
const NATIVE_BUNDLE =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1";

self.addEventListener("install", () => {
  // Активируемся сразу, не ждём закрытия старых вкладок.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Чистим оболочки прошлых версий. На нативе сносим ВСЕ terron-shell-*
      // (там SW отключён — кэш не нужен совсем).
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              k.startsWith("terron-shell-") &&
              (NATIVE_BUNDLE || k !== SHELL_CACHE),
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// Пути, которые нельзя кешировать (живые данные / мультиплеер).
function isBypassed(url) {
  const p = url.pathname;
  return (
    p.startsWith("/api/") ||
    p.startsWith("/lobbies") ||
    /^\/w\d+\//.test(p) || // воркер-прокси игросерверов
    /\/maps\/[^/]+\/[^/]*\.bin(\?|$)/.test(p) // большие бины карт (имя может быть
    // захешировано: map.07f4….bin) — их кешит MapCache (50МБ LRU). А тумбы
    // (thumbnail.webp) и manifest под /maps/ кешим здесь, чтобы оффлайн-выбор
    // карт не был «битым».
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Нативный бандл: ничего не перехватываем — WebView отдаёт вшитые файлы свежими.
  if (NATIVE_BUNDLE) return;

  const url = new URL(req.url);

  // Только same-origin. Cross-origin (CDN, аналитика, шрифты гугла) — мимо.
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url)) return;

  // Навигация (открытие страницы) → network-first, офлайн-фолбэк на оболочку.
  const isNavigation =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          // Сохраняем как «/», чтобы офлайн любая навигация отдала оболочку.
          const cache = await caches.open(SHELL_CACHE);
          cache.put("/", fresh.clone()).catch(() => {});
          return fresh;
        } catch (e) {
          const cache = await caches.open(SHELL_CACHE);
          const cached = (await cache.match("/")) || (await cache.match(req));
          if (cached) return cached;
          throw e;
        }
      })(),
    );
    return;
  }

  // Статика оболочки → stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    })(),
  );
});

/* ─────────────────────────── ПУШ-УВЕДОМЛЕНИЯ (25.08) ──────────────────────
 *
 * Показ уведомления и переход по клику. Логика «кому и когда слать» живёт на
 * сервере (platform-api/src/push.ts) — воркер только рисует то, что пришло.
 *
 * ⚠️ Обработчик push ОБЯЗАН показать видимое уведомление: подписка сделана с
 * userVisibleOnly, и «тихий» пуш браузер засчитает как нарушение — Chrome
 * покажет своё «сайт обновлён в фоне», а после нескольких таких отзовёт
 * подписку совсем. Поэтому даже на битой полезной нагрузке рисуем запасной
 * текст, а не выходим молча.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "TERRON.io";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon512_rounded.png",
    badge: data.badge || "/icons/icon512_maskable.png",
    // tag: свежее уведомление ЗАМЕНЯЕТ прошлое той же темы, а не копится
    // стопкой — «алмазный через 5 минут» ×3 в шторке выглядит как спам.
    tag: data.tag || "terron",
    renotify: Boolean(data.renotify),
    data: { url: data.url || "/", id: data.id || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  const id = event.notification.data && event.notification.data.id;
  event.waitUntil(
    (async () => {
      // Отметка открытия — вход в адаптивную частоту на сервере (три пуша
      // подряд без открытия → реже, ещё три → канал выключается сам).
      if (id) {
        try {
          await fetch(new URL("/push/opened", self.location.origin).toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
            keepalive: true,
          });
        } catch {
          /* статистика не должна мешать открыть игру */
        }
      }
      // Уже открытая вкладка игры лучше новой: у неё живой сокет и прогретая
      // карта, а вторая копия отберёт у неё лобби.
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

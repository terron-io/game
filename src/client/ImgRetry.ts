// terron 02.09: КАРТИНКИ ПО МАНИФЕСТУ ДОГРУЖАЮТСЯ ПОСЛЕ СБОЯ СЕТИ.
//
// Скриншот владельца из приложения ВК на телефоне: превью карты и флаг —
// значки «битая картинка». Зонд полосы показал, почему: в первые секунды после
// запуска WebView сеть мертва целиком, а браузер упавший <img> сам НИКОГДА не
// повторяет. Словарь переводов мы догружаем (LangSelector.retryUntilLoaded),
// картинки — здесь, тем же правилом: несколько повторов с бэкоффом.
//
// Один делегированный обработчик на документ, а не onerror в каждом шаблоне:
// картинок по манифесту десятки (превью карт, флаги, иконки валют), и
// следующая новая снова осталась бы без повтора. `error` не всплывает, поэтому
// ловим на фазе захвата. Только свои ассеты по хэшу (/_assets/, /assets/):
// чужие домены и data: не трогаем. Повторный запрос того же URL заставляет
// браузер сходить в сеть заново только после сброса src.
// ⚠️ ПЕРВЫЙ ПОВТОР — БЫСТРЫЙ. Полторы секунды пустой рамки на первом экране
// читаются как «игра сломалась»; сеть в WebView оживает за доли секунды.
const RETRY_DELAYS_MS = [400, 1200, 3000, 8000];
const OWN_ASSET = /^\/(_assets|assets)\//;

export function installImgRetry(doc: Document = document): void {
  doc.addEventListener(
    "error",
    (e) => {
      const img = e.target as HTMLImageElement | null;
      if (!img || img.tagName !== "IMG") return;
      let url: URL;
      try {
        url = new URL(img.currentSrc || img.src, location.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin || !OWN_ASSET.test(url.pathname))
        return;
      const n = Number(img.dataset.retry ?? "0");
      if (n >= RETRY_DELAYS_MS.length) return;
      img.dataset.retry = String(n + 1);
      const src = img.getAttribute("src") ?? url.href;
      // ⚠️ ВНУТРИ <picture> СБРОС src НИЧЕГО НЕ ДЕЛАЕТ, И ЭТО СЪЕДАЛО ВЕСЬ
      // МЕХАНИЗМ НА ТЕЛЕФОНЕ. Картинку там выбирает подходящий <source>, а он
      // остаётся прежним — браузер не идёт в сеть заново. Превью карт лежат
      // ровно в <picture> с мобильным <source media="(max-width:1024px)">, то
      // есть повтор не работал именно там, где сеть и падает (скрин владельца
      // из приложения ВК: «карта сначала битая загружается»). Пересобираем и
      // источники тоже.
      const parent = img.parentElement;
      const sources =
        parent && parent.tagName === "PICTURE"
          ? [...parent.querySelectorAll("source")].map((el) => ({
              el,
              srcset: el.getAttribute("srcset") ?? "",
            }))
          : [];
      setTimeout(() => {
        if (!img.isConnected) return;
        for (const s of sources) s.el.removeAttribute("srcset");
        img.removeAttribute("src");
        // Возвращаем ОТДЕЛЬНОЙ задачей: снятые и тут же возвращённые атрибуты
        // браузер может счесть за отсутствие изменений и в сеть не пойти.
        // ⚠️ Именно setTimeout, а НЕ requestAnimationFrame: у скрытой вкладки
        // кадры не идут вовсе, и повтор не случился бы никогда — а сеть чаще
        // всего оживает именно тогда, когда игрок вернулся к вкладке.
        setTimeout(() => {
          if (!img.isConnected) return;
          for (const s of sources) {
            if (s.srcset) s.el.setAttribute("srcset", s.srcset);
          }
          img.setAttribute("src", src);
        }, 0);
      }, RETRY_DELAYS_MS[n]);
    },
    true,
  );
}

import { nothing } from "lit";
import { modalRouter } from "./ModalRouter";

export function initNavigation() {
  const closeMobileSidebar = () => {
    const sidebar = document.getElementById("sidebar-menu");
    const backdrop = document.getElementById("mobile-menu-backdrop");
    if (sidebar?.classList.contains("open")) {
      sidebar.classList.remove("open");
      backdrop?.classList.remove("open");
      document.documentElement.classList.remove("overflow-hidden");
      sidebar.setAttribute("aria-hidden", "true");
      backdrop?.setAttribute("aria-hidden", "true");
      const hb = document.getElementById("hamburger-btn");
      if (hb) hb.setAttribute("aria-expanded", "false");
    }
  };

  const showPage = (pageId: string) => {
    window.currentPageId = pageId;

    // Close mobile sidebar if a nav item was clicked
    closeMobileSidebar();

    // terron: закрываем ВСЕ открытые модалки-страницы (кроме целевой), а не
    // только первую — иначе при быстром переключении (досье→помощь) они
    // стекаются. Гард _navClosing глушит реэнтранси: close() модалки сам зовёт
    // showPage("page-play"), что иначе ломало состояние.
    const w = window as unknown as { _navClosing?: boolean };
    if (!w._navClosing) {
      w._navClosing = true;
      try {
        document
          .querySelectorAll(".page-content:not(.hidden)")
          .forEach((el) => {
            if (el.id === pageId) return;
            const m = el as unknown as {
              isOpen?: () => boolean;
              close?: () => void;
              minimize?: () => void;
              prefersMinimize?: () => boolean;
            };
            if (typeof m.isOpen === "function" && m.isOpen() && m.close) {
              // terron 25.08: ЛИПКОЕ ЛОББИ. Окно лобби просит себя не
              // закрывать — его close() это «покинуть лобби». Игрок, ушедший
              // почитать вики или глянуть онлайн, обязан остаться в очереди;
              // внизу экрана его ждёт плашка <lobby-dock>.
              if (m.prefersMinimize?.() && m.minimize) m.minimize();
              else m.close();
            } else {
              el.classList.add("hidden");
              el.classList.remove("block");
            }
          });
      } finally {
        w._navClosing = false;
      }
    }

    // Handle page-play separately (it's not a page-content element)
    const pagePlayEl = document.getElementById("page-play");
    if (pageId === "page-play") {
      pagePlayEl?.classList.remove("hidden");
    } else {
      pagePlayEl?.classList.add("hidden");
    }

    // Show the target page if it's a modal
    if (pageId !== "page-play") {
      const target = document.getElementById(pageId);
      if (target) {
        target.classList.remove("hidden");
        // Modals need block display explicitly
        if (target.classList.contains("page-content")) {
          target.classList.add("block");
        }

        // If the target itself is a modal component with inline attribute, open it
        if (
          target.hasAttribute("inline") &&
          typeof (target as any).open === "function"
        ) {
          (target as any).open();
        }
      }
    }

    // Update active state on menu items
    document.querySelectorAll(".nav-menu-item").forEach((item) => {
      if ((item as HTMLElement).dataset.page === pageId) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    // Dispatch CustomEvent to notify listeners of page change
    window.dispatchEvent(new CustomEvent("showPage", { detail: pageId }));
  };

  window.showPage = showPage;

  // Use event delegation for navigation items (they may be inside Lit components)
  document.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest(
      ".nav-menu-item[data-page]",
    );
    if (!target) return;
    // Игрок сам просит новую вкладку (cmd/ctrl/shift/alt или средняя кнопка) —
    // не мешаем: пункт меню теперь настоящая ссылка, браузер справится сам.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    const pageId = (target as HTMLElement).dataset.page;
    if (!pageId) return;
    // Обычный клик — наш: раздел показываем без перезагрузки страницы.
    e.preventDefault();
    showPage(pageId);
  });

  // terron: УБРАНА «модалочная» методология — клик мимо карточки больше НЕ
  // закрывает раздел на главную. Разделы (skins/shop/rating/…) — это страницы-
  // роуты, persistent; уходим только через нав/кнопку «назад»/смену URL.

  // Ensure Play is the default visible/active page on load.
  showPage("page-play");
}

/**
 * terron 25.08: НАСТОЯЩИЙ АДРЕС ПУНКТА МЕНЮ.
 *
 * Пункты навбаров были `<button>`, поэтому cmd/ctrl+клик по ним не открывал
 * новую вкладку (репорт игрока 25.08) — браузеру нечего было открывать, клик
 * проваливался в обычный и уводил со страницы. Теперь это `<a href>`: с
 * модификатором вкладку открывает сам браузер, обычный клик перехватывает
 * обработчик выше (никакой перезагрузки, как и раньше).
 *
 * Путь берём у роутера — второй таблицы «страница → адрес» не заводим.
 * Раздела нет в роутере (или роутер ещё не зарегистрирован) → `nothing`,
 * то есть атрибут href просто не появится, и пункт ведёт себя как раньше.
 */
export function navPath(pageId: string): string | typeof nothing {
  return modalRouter.pathForPage(pageId) ?? nothing;
}

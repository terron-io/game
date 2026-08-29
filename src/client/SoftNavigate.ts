// terron 30.07: НАВИГАЦИЯ БЕЗ ПЕРЕЗАГРУЗКИ ВНУТРИ ИГРОВОЙ ПЛОЩАДКИ.
//
// Требование модерации GamePush дословно: «за всю сессию игрока SDK должен
// инициализироваться ОДИН раз, без исключений; место, где SDK проходит
// инициализацию, никогда не должно перезагружаться — это сломает прогресс».
//
// У нас перезагрузка живёт в десятке мест и почти везде исторически оправдана
// (проще всего гарантированно сбросить состояние). Внутри iframe площадки она
// недопустима: страница перезапускает их SDK — снова крутится прелоадер,
// рвётся синхронизация игрока и его сохранения. Модератор поймал это дважды:
// «проиграл забег → вернулся в меню → опять прелоадер» и «победил, играл, и
// вдруг выкинуло в меню с прелоадером» (второе — наш редирект по 1002
// «Game not found» из Transport).
//
// Поэтому все такие места зовут ЭТИ помощники: внутри площадки уходим мягко
// (событие leave-lobby останавливает матч, адрес правим через history), вне
// площадки — прежнее поведение, оно проверено годами.

/** Мы внутри iframe площадки? Класс ставит index.html синхронно, ещё до SDK. */
function onPlatform(): boolean {
  try {
    return document.documentElement.classList.contains("gp-embed");
  } catch {
    return false;
  }
}

/**
 * Уйти на главную. Внутри площадки — без перезагрузки: останавливаем матч,
 * снимаем игровой режим, показываем меню и правим адрес через history.
 * Возвращает true, если ушли мягко (значит вызывающему делать больше нечего).
 */
export function softHome(path = "/"): boolean {
  if (!onPlatform()) {
    window.location.href = path;
    return false;
  }
  try {
    // Матч (если он есть) останавливается тем же путём, что и «покинуть лобби»:
    // полный teardown графики, отписки, transport.leaveGame.
    // cause:"user-nav" — гейт «не выходить в окне старта» на ЯВНЫЙ уход игрока
    // не распространяется (репорт владельца 31.07: ушёл на главную ровно в
    // отсчёт «Starting in 4s» → leave проигнорирован → матч жил за кадром и
    // рисовал «Переподключение…» поверх меню).
    document.dispatchEvent(
      new CustomEvent("leave-lobby", { detail: { cause: "user-nav" } }),
    );
    document.body.classList.remove("in-game");
    history.replaceState(null, "", path);
    window.showPage?.("page-play");
    // Внутриигровые окна закрываем и здесь: Main.handleLeaveLobby выходит
    // раньше, если матч уже остановлен сервером, и тогда «обрубок меню»
    // оставался висеть поверх главной (замечание модерации).
    closeInGameOverlays();
    // Раунд для площадки закрываем и здесь: обычно это делает
    // Main.handleLeaveLobby, но он выходит раньше, если матч уже остановлен
    // сервером — тогда площадка считала бы раунд идущим. Вызов парный
    // (gameplayActive), повтор безвреден.
    void import("./GamePushSDK").then(({ GamePushSDK }) =>
      GamePushSDK.gameplayStop(),
    );
  } catch (e) {
    console.warn("[soft-nav] мягкий уход не удался:", e);
  }
  return true;
}

/**
 * Заменитель `location.reload()` для мест, которым нужно «перечитать себя»
 * после смены аккаунта или косметики. Внутри площадки перезагрузка запрещена,
 * поэтому вместо неё сбрасываем кэш профиля и рассылаем сигнал смены сессии —
 * компоненты перечитывают состояние сами.
 */
export async function softReload(): Promise<boolean> {
  if (!onPlatform()) {
    window.location.reload();
    return false;
  }
  try {
    const [{ invalidateUserMe }, { notifyAuthChanged }] = await Promise.all([
      import("./Api"),
      import("./Auth"),
    ]);
    invalidateUserMe();
    notifyAuthChanged();
    window.showPage?.("page-play");
  } catch (e) {
    console.warn("[soft-nav] мягкая перезагрузка не удалась:", e);
  }
  return true;
}

/**
 * Внутренний переход по адресу без перезагрузки страницы (вкладки меню,
 * профиль, клан, приглашение в матч). Вне площадки — обычная навигация.
 *
 * Порядок важен: сперва уводим из матча/лобби, потому что
 * `Main.handleLeaveLobby` сам возвращает адрес на «/» — свой адрес ставим
 * ПОСЛЕ него, иначе он его затрёт. Дальше `join-changed` заставляет Main
 * заново разобрать адрес: там и `/game/<id>`, и `/tutorial`, и модальные
 * страницы через ModalRouter.
 */
export function softGo(path: string): boolean {
  if (!onPlatform()) {
    window.location.assign(path);
    return false;
  }
  try {
    document.dispatchEvent(
      new CustomEvent("leave-lobby", { detail: { cause: "user-nav" } }),
    );
    document.body.classList.remove("in-game");
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("join-changed"));
    closeInGameOverlays();
  } catch (e) {
    console.warn("[soft-nav] мягкий переход не удался:", e);
  }
  return true;
}

/**
 * ПЕРЕХВАТ ВНУТРЕННИХ ССЫЛОК. Обычный `<a href="/wiki">` внутри iframe
 * площадки = полная загрузка страницы = ПОВТОРНАЯ инициализация их SDK, а это
 * прямой запрет модерации («за всю сессию игрока SDK должен инициализироваться
 * один раз»). Таких ссылок в клиенте больше десятка — логотип в шапке, «смотреть
 * реплей» в досье, ники в рейтинге, футер. Точечно править каждую бессмысленно:
 * следующая новая ссылка снова всё сломает. Поэтому один делегированный
 * перехватчик на весь документ.
 *
 * Не трогаем: другой origin, `target` (новая вкладка), `download`, не-http
 * схемы (mailto/tel), клики с модификаторами и средней кнопкой (игрок сам
 * просит новую вкладку), и всё, что помечено `data-hard-nav`.
 */
export function installSoftLinkInterceptor(): void {
  if (!onPlatform() || linkInterceptorInstalled) return;
  linkInterceptorInstalled = true;
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const path = e.composedPath?.() ?? [];
      const link = (path.find((n) => (n as HTMLElement)?.tagName === "A") ??
        (e.target as HTMLElement)?.closest?.("a")) as
        | HTMLAnchorElement
        | undefined;
      if (!link) return;
      if (link.target || link.hasAttribute("download")) return;
      if (link.dataset.hardNav !== undefined) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      softGo(url.pathname + url.search + url.hash);
    },
    true, // capture: успеть до собственных обработчиков компонентов
  );
}
let linkInterceptorInstalled = false;

// terron 01.08: ЗАКРЫТЬ ВНУТРИИГРОВЫЕ ОКНА ПРИ УХОДЕ В МЕНЮ.
//
// Замечание модерации: «иногда при выходе из игры в меню остаётся слепок
// (обрубок меню) поверх интерфейса главного меню». Причина: HUD-модалки —
// самостоятельные Lit-элементы в общем DOM, они НЕ уничтожаются вместе с
// графикой матча. Пока выход шёл только кнопкой в самой модалке, она закрывала
// себя сама; а после softHome/softGo (потеря контекста, «Game not found»,
// клик по ссылке, выход из игровых настроек) окно оставалось висеть.
//
// Поэтому гасим их ЦЕНТРАЛЬНО, на каждом уходе из матча. Метод у каждой свой
// (hide/close/closeModal), поэтому пробуем по очереди и молчим, если элемента
// на странице нет.
const IN_GAME_OVERLAYS = [
  "win-modal",
  "settings-modal",
  "graphics-settings-modal",
  "game-info-modal",
  "chat-modal",
  "player-panel",
  "player-moderation-modal",
  "send-resource-modal",
  "emoji-table",
  "build-menu",
  "multi-tab-modal",
];

export function closeInGameOverlays(): void {
  for (const tag of IN_GAME_OVERLAYS) {
    document.querySelectorAll(tag).forEach((el) => {
      const o = el as unknown as {
        hide?: () => void;
        close?: () => void;
        closeModal?: () => void;
        isVisible?: boolean;
      };
      try {
        o.hide?.();
        o.close?.();
        o.closeModal?.();
      } catch {
        /* окно уже закрыто или не умеет — не мешаем уходу */
      }
    });
  }
}

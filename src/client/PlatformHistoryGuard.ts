// terron 07.09: НА ЧУЖОМ ХОСТИНГЕ АДРЕС СТРАНИЦЫ НЕ ТРОГАЕМ ВООБЩЕ.
//
// Билд для дистрибуции лежит в ПОДПАПКЕ чужого домена
// (`s3.eponesh.com/games/draft/28774/v1/`), а все наши пути пишутся ОТ КОРНЯ.
// Клик по «вики» уводил адрес фрейма на `s3.eponesh.com/wiki`: страница
// открывалась (SPA), но F5 после этого убивал бы игру 404-й, а модерация
// Яндекса прочитала это как «ссылки снизу справа не работают и уводят из
// яндекса» (07.09).
//
// ⚠️ ПОЧЕМУ ШИМ, А НЕ ГЕЙТ В РОУТЕРЕ. Историю пишет не только ModalRouter:
// в клиенте больше двадцати мест (Main, WikiPage, ProfilePage, ShopPage,
// GuidePage, AccountSettings, JoinLobbyModal, SoftNavigate…). Гейт в одном из
// них закрывает один путь из двадцати — первая версия фикса так и промахнулась,
// адрес всё равно уезжал (проверено на живом черновике). Поэтому запрет стоит
// на самом History API: state пишется как прежде (кому он нужен — работает),
// а АДРЕС остаётся тем, что дала площадка.
//
// Вне платформенной сборки не делает ничего.
declare const __PLATFORM_BUILD__: string | undefined;

export function isPlatformBundle(): boolean {
  try {
    return (
      typeof __PLATFORM_BUILD__ === "string" && __PLATFORM_BUILD__.length > 0
    );
  } catch {
    return false;
  }
}

let installed = false;

export function installPlatformHistoryGuard(): void {
  if (installed || !isPlatformBundle()) return;
  if (typeof history === "undefined" || typeof location === "undefined") return;
  installed = true;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  // URL подменяем на текущий: история ведётся, адресная строка стоит на месте.
  history.pushState = (state: unknown, title: string) =>
    push(state, title, location.href);
  history.replaceState = (state: unknown, title: string) =>
    replace(state, title, location.href);
}

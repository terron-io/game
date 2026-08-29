// terron 26.08: ГДЕ НАМ ВООБЩЕ МОЖНО БРАТЬ ДЕНЬГИ — единственный ответ на клиенте.
//
// Решение владельца: внутри чужого магазина (VK, Яндекс.Игры, Пикабу и всё
// прочее через GamePush) и внутри НАШИХ приложений из Google Play / App Store
// своей платёжки быть не должно вообще. Это не косметика: предложить там оплату
// мимо их биллинга — прямое нарушение правил площадки, за которое снимают.
//
// Раньше ответ жил одной строкой в ShopPage (`html.gp-embed`), то есть:
//   • апки из сторов не гейтились ВООБЩЕ (там self === top, класс не ставится);
//   • сервер «подтверждал отказ» заголовком Sec-Fetch-Dest, который для fetch
//     всегда `empty` — то есть не подтверждал ничего (проверено на боевом API).
// Теперь хост считается ЗДЕСЬ, а сервер получает его заголовками и решает сам
// (platform-api/src/payGate.ts) — две независимые половины одного правила.
//
// ⚠️ СЮДА ЖЕ ВСТАНЕТ ПЕРЕКЛЮЧЕНИЕ ПЛАТЁЖКИ. Когда появятся покупки через
// площадку (GamePush → Яндекс и т.д.), меняется не гейт, а `payProvider()`:
// хост «платформа» перестанет значить «нельзя» и начнёт значить «через них».
// Поэтому хост и разрешение разведены: `payHost()` отвечает ГДЕ мы, а не что
// можно.
import { clientPlatform } from "./Analytics";
import { platformContext } from "./PlatformContext";

export type PayHost =
  /** Наш сайт в обычной вкладке (или наш же iframe на itch — см. ниже). */
  | { kind: "site" }
  /** Каталог площадки: игра в чужом iframe. `id` — VK/YANDEX/…, если SDK успел. */
  | { kind: "platform"; id: string | null }
  /** Наше приложение из стора (или неотличимый от него WebView). */
  | { kind: "native"; token: string };

/**
 * ⚠️ WEBVIEW СЧИТАЕМ АПКОЙ. `clientPlatform()` отдаёт `native-*` только когда
 * это ДОКАЗАНО (мост Capacitor или маркер `?from=..._app` в адресе). У апок,
 * установленных до появления маркера, доказательства нет — остаётся форма UA,
 * то есть `webview-ios` / `webview-android`. Ровно та же форма и у чужих
 * ин-апп браузеров (Telegram, ВК), поэтому выбор такой:
 *   • считать webview апкой — теряем донат тех, кто открыл нас из Telegram;
 *   • считать webview браузером — рискуем показать оплату внутри своей апки.
 * Цена ошибок несимметрична (снятие из App Store против нескольких донатов),
 * поэтому по умолчанию webview = апка. Флип — ровно эта константа.
 */
const TREAT_WEBVIEW_AS_NATIVE = true;

function framed(): boolean {
  // Класс ставит бутстрап в index.html СИНХРОННО (self !== top), ещё до рендера
  // и до любого SDK; `?embed=1` форсит его для проверки раскладки с сайта.
  // Живую проверку держим второй: класс могли не поставить (правка бутстрапа),
  // а деньги — не то место, где полагаются на один признак.
  try {
    if (document.documentElement.classList.contains("gp-embed")) return true;
  } catch {
    /* нет DOM — ниже */
  }
  try {
    return window.self !== window.top;
  } catch {
    return true; // кросс-доменный top кинул — значит мы точно в чужом кадре
  }
}

function nativeToken(): string | null {
  let t = "";
  try {
    t = clientPlatform();
  } catch {
    return null;
  }
  if (t.startsWith("native")) return t;
  if (TREAT_WEBVIEW_AS_NATIVE && t.startsWith("webview")) return t;
  return null;
}

/** Где мы сейчас. Считается на каждый вызов — признаки дешёвые и кэшируются ниже. */
export function payHost(): PayHost {
  // Порядок важен: апка внутри чужого iframe невозможна, а вот площадка внутри
  // WebView (наша апка открыла VK?) — тоже нет. Чужой кадр решает первым.
  if (framed()) return { kind: "platform", id: platformContext() };
  const token = nativeToken();
  if (token) return { kind: "native", token };
  return { kind: "site" };
}

/** Можно ли ПРЕДЛАГАТЬ нашу платёжку (Pally). Сервер проверяет это же сам. */
export function ourPaymentsAllowed(): boolean {
  return payHost().kind === "site";
}

/**
 * Чем платить в этом хосте. Сегодня: наша платёжка на сайте и НИЧЕГО в чужих
 * магазинах. Когда появятся покупки через площадку — здесь вернётся её id, а
 * `ourPaymentsAllowed` останется про нашу собственную.
 */
export function payProvider(): "pally" | null {
  return ourPaymentsAllowed() ? "pally" : null;
}

/** Токен хоста для заголовка `X-Terron-Client` — сервер решает по нему же. */
export function payHostHeaders(): Record<string, string> {
  const h = payHost();
  const token =
    h.kind === "native" ? h.token : h.kind === "platform" ? "embed" : "web";
  return { "X-Terron-Client": token };
}

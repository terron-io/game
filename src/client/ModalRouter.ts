/**
 * ModalRouter — two-way sync between real URL paths and modals.
 *
 * URL → modal: parse `location.pathname` (e.g. `/account/stats`), find the
 * registered modal, call `modal.open({ tab, ...query })`.
 * Modal → URL: when a router-managed modal opens/closes/switches tabs, update
 * the URL via `history.replaceState`. Opening remembers the underlying path
 * (e.g. `/` or `/game/<id>`) so closing restores it.
 *
 * Routing is purely client-side: the server already serves the SPA shell for
 * any unknown path (Master.ts SPA fallback), so deep links / refresh work.
 *
 * Legacy `#modal=<name>&tab=<key>` hash links are still accepted and upgraded
 * to the new path form, so old bookmarks/shares keep working.
 *
 * Lobby modals (join/host) own their own path state and are not registered.
 */

interface RegistryEntry {
  /** Custom element tag, e.g. "store-modal". */
  tag: string;
  /**
   * Optional page-content element id (e.g. "page-item-store"). When set, the
   * router calls `window.showPage(pageId)` for inline modals so the
   * page-content container becomes visible. For popup-style modals, omit.
   */
  pageId?: string;
  /**
   * terron (бандл-диета): ленивый импорт модуля страницы. Админ/модер-страницы
   * не входят в стартовый бандл — их модуль тянется динамическим import()
   * только при заходе на роут (99% визитов их не парсят). openRegistered ждёт
   * load() перед whenDefined(tag).
   */
  load?: () => Promise<unknown>;
}

/** Modals that the router can drive via the URL. */
interface RoutableModal extends HTMLElement {
  open(args?: Record<string, unknown>): void;
  close(args?: Record<string, unknown>): void;
}

/** name → URL segment overrides (default: the name itself). */
const SEGMENT_OVERRIDES: Record<string, string> = {
  leaderboard: "rating", // terron: рейтинг-таблицы вместо движкового лидерборда
};

/** Доп. входные сегменты-алиасы → имя (канонический URL — из SEGMENT_OVERRIDES). */
const SEGMENT_ALIASES: Record<string, string> = {
  "ffa-rating": "leaderboard",
  leaders: "leaderboard", // старые ссылки
  // Зал славы: канонический URL — /glory, плюс алиасы (в т.ч. кириллица /слава).
  слава: "glory",
  slava: "glory",
  fame: "glory",
  "hall-of-fame": "glory", // старый URL — не ломаем ссылки
};

class ModalRouter {
  private registry = new Map<string, RegistryEntry>();
  /** Name of the modal currently reflected in the URL, if any. */
  private currentName: string | null = null;
  /** True while we're routing from the URL (suppress modal→URL sync). */
  private routingFromUrl = false;
  /** Path to restore when the current modal closes (e.g. `/` or `/game/x`). */
  private underlyingPath = "/";

  constructor() {
    // Back/forward and manual URL edits land here.
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", () => void this.reconcile());
    }
  }

  register(name: string, entry: RegistryEntry): void {
    this.registry.set(name, entry);
  }

  // ---- segment <-> name ----

  private nameToSegment(name: string): string {
    return SEGMENT_OVERRIDES[name] ?? name;
  }

  private segmentToName(segment: string): string | null {
    // Кириллические алиасы (напр. /слава) приходят percent-encoded в pathname —
    // декодируем, чтобы сматчить с ключом SEGMENT_ALIASES.
    let seg = segment;
    try {
      seg = decodeURIComponent(segment);
    } catch {
      /* битый percent-encoding — оставляем как есть */
    }
    const alias = SEGMENT_ALIASES[seg] ?? SEGMENT_ALIASES[segment];
    if (alias && this.registry.has(alias)) return alias;
    for (const [name] of this.registry) {
      if (
        this.nameToSegment(name) === segment ||
        this.nameToSegment(name) === seg
      )
        return name;
    }
    return null;
  }

  /**
   * terron 25.08: КАНОНИЧЕСКИЙ ПУТЬ РАЗДЕЛА ПО id СТРАНИЦЫ (или null, если
   * раздел не зарегистрирован в роутере).
   *
   * Нужен навбарам: пункты меню были `<button>`, поэтому cmd+клик не открывал
   * их в новой вкладке (репорт игрока 25.08) — он проваливался в обычный клик
   * и уводил со страницы. С настоящим `href` браузер сам делает новую вкладку,
   * а обычный клик по-прежнему обрабатывает Navigation (без перезагрузки).
   */
  public pathForPage(pageId: string): string | null {
    for (const [name, entry] of this.registry) {
      if (entry.pageId === pageId) return this.pathFor(name);
    }
    return null;
  }

  /** Build `/segment[/tab][?query]` for a modal. */
  private pathFor(name: string, args?: Record<string, unknown>): string {
    // terron 28.08: вложенные админ-пути (/admin/petri-bonus, /admin/ru-ban,
    // /admin/balance, /admin/news) убраны вместе со страницами — админка живёт
    // отдельным внутренним приложением.
    // Создание клана — канонический путь `/clan/new`.
    if (name === "clan-create") return "/clan/new";
    // Редактирование — `/clan/<slug>`.
    if (name === "clan-edit") return "/clan/" + String(args?.slug ?? "");
    // Профиль живёт на `/@<slug>`, а не на `/profile`.
    if (name === "profile") {
      const slug =
        typeof args?.slug === "string" && args.slug ? args.slug : "me";
      return "/@" + String(slug).replace(/^@/, "");
    }
    let path = "/" + this.nameToSegment(name);
    const query = new URLSearchParams();
    if (args) {
      for (const [key, value] of Object.entries(args)) {
        if (value === undefined || value === null) continue;
        if (key === "tab") {
          if (value) path += "/" + String(value);
          continue;
        }
        if (typeof value === "object") continue;
        query.set(key, String(value));
      }
    }
    const qs = query.toString();
    return qs ? `${path}?${qs}` : path;
  }

  /** Parse the current pathname into a modal route, or null if it's not one. */
  private parsePath(): {
    name: string;
    args: Record<string, unknown>;
  } | null {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    // `/admin/petri-bonus` → отдельная страница петри-начислений (до общего
    // разбора, иначе segment `admin` перехватит и откроет админку балансов).
    if (parts[0] === "admin" && parts[1] === "petri-bonus") {
      return { name: "admin-petri-bonus", args: {} };
    }
    // `/admin/ru-ban` → страница РФ-блокировок (карта дропов). До общего разбора.
    if (parts[0] === "admin" && parts[1] === "ru-ban") {
      return { name: "admin-ru-ban", args: {} };
    }
    // `/admin/balance` → страница баланса/ROI (было `/balance`).
    if (parts[0] === "admin" && parts[1] === "balance") {
      return { name: "admin-balance", args: {} };
    }
    // `/admin/news` → управление новостями (баннер + страница /news).
    if (parts[0] === "admin" && parts[1] === "news") {
      return { name: "admin-news", args: {} };
    }

    // Создание клана: канонический `/clan/new` (+ алиасы `/clan/create`, `/new`)
    // → отдельная страница, а не clan-modal с tab=new. До общего разбора.
    if (
      (parts[0] === "clan" && (parts[1] === "new" || parts[1] === "create")) ||
      (parts[0] === "new" && !parts[1])
    ) {
      return { name: "clan-create", args: {} };
    }
    // `/clan/<slug>` (не new/create) → редактирование клана.
    if (parts[0] === "clan" && parts[1] && !parts[2]) {
      return { name: "clan-edit", args: { slug: parts[1] } };
    }

    // `/wiki/ult/<slug>` → вики, деталь ульта (третий сегмент общий парсер
    // роняет — берём его явно). `/wiki` и `/wiki/ult` открывают индекс.
    if (parts[0] === "wiki") {
      const args: Record<string, unknown> = {};
      if (parts[1] === "ult" && parts[2]) args.ult = parts[2];
      else if (parts[1]) args.section = parts[1];
      return { name: "wiki", args };
    }

    // `/@<slug>` → страница профиля.
    if (parts[0].startsWith("@")) {
      const slug = parts[0].slice(1);
      if (!slug) return null;
      return { name: "profile", args: { slug } };
    }

    const name = this.segmentToName(parts[0]);
    if (!name) return null;

    const args: Record<string, unknown> = {};
    new URLSearchParams(window.location.search).forEach((v, k) => {
      args[k] = v;
    });
    if (parts[1]) args.tab = parts[1];
    return { name, args };
  }

  // ---- URL → modal ----

  /**
   * Open the modal matching the current pathname, if any. Returns true if the
   * path was a recognized modal route (caller can skip other handlers).
   */
  routeFromPath(): boolean {
    const route = this.parsePath();
    if (!route) return false;
    const entry = this.registry.get(route.name);
    if (!entry) return false;
    void this.openRegistered(route.name, entry, route.args);
    return true;
  }

  /**
   * Legacy: parse `#modal=<name>&...`. If present and registered, open it and
   * upgrade the URL to the new path form. Returns true if it was a modal hash.
   */
  routeFromHash(): boolean {
    const hash = window.location.hash;
    if (!hash.startsWith("#")) return false;
    const params = new URLSearchParams(hash.slice(1));
    const name = params.get("modal");
    if (!name) return false;

    const entry = this.registry.get(name);
    if (!entry) {
      this.replacePath(window.location.pathname); // strip unknown hash
      return true;
    }

    params.delete("modal");
    const args: Record<string, unknown> = {};
    params.forEach((value, key) => {
      args[key] = value;
    });
    // Upgrade #modal=... to /segment[/tab] before opening.
    this.replacePath(this.pathFor(name, args));
    void this.openRegistered(name, entry, args);
    return true;
  }

  /** True if the current URL is a modal route (path or legacy hash). */
  isHashRouted(): boolean {
    const hash = window.location.hash;
    if (hash.startsWith("#") && new URLSearchParams(hash.slice(1)).has("modal"))
      return true;
    return this.parsePath() !== null;
  }

  /** Reconcile open modal to match the current path (popstate / manual nav). */
  private async reconcile(): Promise<void> {
    const route = this.parsePath();
    if (route && route.name !== this.currentName) {
      const entry = this.registry.get(route.name);
      if (entry) await this.openRegistered(route.name, entry, route.args);
      return;
    }
    if (!route && this.currentName) {
      const entry = this.registry.get(this.currentName);
      this.routingFromUrl = true;
      try {
        const el = entry
          ? (document.querySelector(entry.tag) as RoutableModal | null)
          : null;
        el?.close();
        this.currentName = null;
      } finally {
        this.routingFromUrl = false;
      }
    }
  }

  private async openRegistered(
    name: string,
    entry: RegistryEntry,
    args: Record<string, unknown>,
  ): Promise<void> {
    // Ленивые страницы: сперва подтянуть модуль (иначе whenDefined ждёт вечно).
    // Ошибка сети — просто не откроемся, не роняем роутер.
    if (entry.load) {
      try {
        await entry.load();
      } catch (e) {
        console.error(`ModalRouter: lazy load failed for ${entry.tag}`, e);
        return;
      }
    }
    // The custom element may not be upgraded yet (e.g. routed on initial load
    // before its module finished evaluating). Wait so el.open is defined.
    await customElements.whenDefined(entry.tag);

    this.routingFromUrl = true;
    try {
      if (this.currentName === null) {
        // Remember where we came from so close() can restore it. If we landed
        // directly on a modal path, fall back to home.
        this.underlyingPath = this.parsePath()
          ? "/"
          : window.location.pathname || "/";
      }
      this.currentName = name;
      if (entry.pageId) {
        window.showPage?.(entry.pageId);
      }
      const el = document.querySelector(entry.tag) as RoutableModal | null;
      el?.open(args);
    } finally {
      this.routingFromUrl = false;
    }
  }

  // ---- modal → URL (called by BaseModal) ----

  /** Called by BaseModal.open() when a router-managed modal opens. */
  syncOpened(name: string, args?: Record<string, unknown>): void {
    if (this.routingFromUrl) return; // URL is driving the modal; don't loop
    if (!this.registry.has(name)) return;
    if (this.currentName === null) {
      this.underlyingPath = this.parsePath()
        ? "/"
        : window.location.pathname + window.location.search || "/";
    }
    this.currentName = name;
    // pushState (не replace!) — добавляем запись в историю, чтобы аппаратный/
    // жестовый «назад» (Android: Capacitor делает webView.goBack() при наличии
    // истории, иначе выходит из приложения) ЗАКРЫВАЛ раздел и возвращал на
    // подложку, а не закрывал приложение. На десктопе back тоже закрывает модалку.
    this.pushPath(this.pathFor(name, args));
  }

  /** Called by BaseModal.close() when a router-managed modal closes. */
  syncClosed(name: string): void {
    if (this.routingFromUrl) return;
    if (this.currentName !== name) return;
    this.currentName = null;
    this.replacePath(this.underlyingPath || "/");
    this.underlyingPath = "/";
  }

  /** Called by BaseModal.setActiveTab() when a router-managed modal switches tabs. */
  syncTab(name: string, tab: string): void {
    if (this.routingFromUrl) return;
    if (this.currentName !== name) return;
    this.replacePath(this.pathFor(name, { tab }));
  }

  private replacePath(path: string): void {
    history.replaceState(history.state, "", path);
  }

  // Новая запись в истории (для back-навигации внутри приложения/браузера).
  private pushPath(path: string): void {
    history.pushState(history.state, "", path);
  }
}

export const modalRouter = new ModalRouter();

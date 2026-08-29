import { LitElement, html, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwindStyles from "../../styles.css?inline";

export type OModalTab = { key: string; label: string };

@customElement("o-modal")
export class OModal extends LitElement {
  static styles = [unsafeCSS(tailwindStyles)];

  @state() public isModalOpen = false;

  static openCount = 0;

  @property({ type: Boolean })
  public inline = false;

  @property({ type: Boolean })
  public alwaysMaximized = false;

  // terron 24.08: страница-модалка НА ВЕСЬ ЭКРАН (решение владельца для
  // /ults: «не вижу фулскрина»). Лист занимает весь вьюпорт без полей и
  // капа 900px; остальные модалки не трогаем (дефолт false).
  @property({ type: Boolean })
  public fullscreen = false;

  @property({ type: Boolean })
  public hideCloseButton = false;

  @property({ type: String })
  public title = "";

  @property({ type: Boolean })
  public hideHeader = false;

  @property({ type: String })
  public maxWidth = "";

  @property({ type: Array })
  public tabs: OModalTab[] = [];

  @property({ type: String })
  public activeTab = "";

  @property({ attribute: false })
  public onTabChange?: (key: string) => void;

  public onClose?: () => void;

  public open() {
    if (!this.isModalOpen) {
      if (!this.inline) {
        OModal.openCount = OModal.openCount + 1;
        if (OModal.openCount === 1) document.body.style.overflow = "hidden";
      }
      this.isModalOpen = true;
    }
  }

  public close() {
    if (this.isModalOpen) {
      this.isModalOpen = false;
      this.onClose?.();
      if (!this.inline) {
        OModal.openCount = Math.max(0, OModal.openCount - 1);
        if (OModal.openCount === 0) document.body.style.overflow = "";
      }
    }
  }

  disconnectedCallback() {
    // Ensure global counter is decremented if this modal is removed while open.
    if (this.isModalOpen && !this.inline) {
      OModal.openCount = Math.max(0, OModal.openCount - 1);
      if (OModal.openCount === 0) document.body.style.overflow = "";
    }
    super.disconnectedCallback();
  }

  private handleTabClick(key: string) {
    this.onTabChange?.(key);
  }

  private renderTabs() {
    return html`
      <div
        role="tablist"
        class="flex justify-center border-b border-white/10 px-4 lg:px-6 gap-1 shrink-0"
      >
        ${this.tabs.map((tab) => {
          const active = this.activeTab === tab.key;
          return html`
            <button
              type="button"
              role="tab"
              data-key=${tab.key}
              aria-selected=${active}
              class="px-4 py-3 text-sm font-bold uppercase tracking-wider transition-all relative cursor-pointer ${active
                ? "text-aquarius"
                : ""}"
              style=${active
                ? ""
                : "color: color-mix(in srgb, var(--t-modal-fg, #ffffff) 52%, transparent)"}
              @click=${() => this.handleTabClick(tab.key)}
            >
              ${tab.label}
              ${active
                ? html`<div
                    class="absolute bottom-0 left-0 right-0 h-0.5 bg-malibu-blue"
                  ></div>`
                : ""}
            </button>
          `;
        })}
      </div>
    `;
  }

  render() {
    const shouldRender = this.isModalOpen || this.inline;
    if (!shouldRender) {
      return html``;
    }

    const backdropClass = this.inline
      ? "relative z-10 w-full h-full flex items-stretch bg-transparent"
      : "fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center overflow-hidden";

    const wrapperClass = this.inline
      ? "relative flex flex-col w-full h-full m-0 max-w-full max-h-none shadow-none"
      : this.fullscreen
        ? "relative flex flex-col w-full h-full m-0 max-w-none max-h-none"
        : `relative flex flex-col w-full h-full lg:w-[90%] lg:h-auto lg:min-w-[400px] lg:max-w-[900px] lg:m-8 shadow-[0_20px_60px_rgba(0,0,0,0.8)] lg:max-h-[calc(100vh-4rem)] ${
            this.alwaysMaximized ? "h-auto" : ""
          }`;
    const wrapperStyle =
      !this.inline && !this.fullscreen && this.maxWidth
        ? `max-width: ${this.maxWidth};`
        : "";

    const hasTabs = this.tabs.length > 0;
    // terron: фон/цвет панели через CSS-переменные (наследуются в shadow DOM),
    // чтобы тема главной (body:not(.in-game)) делала панель светлой. В игре —
    // дефолт (тёмный).
    const sectionClass =
      "relative flex-1 min-h-0 flex flex-col backdrop-blur-xl lg:border border-white/10 overflow-hidden";
    const sectionStyle =
      // terron iOS: на iPad/iPhone статус-бар (часы/батарея) виден на страницах-
      // модалках → резервируем отступ сверху, иначе шапка лезет под него. На
      // вебе/десктопе safe-area-inset-top = 0 → ничего не меняется.
      // terron: --t-modal-border — рамка панели «по случаю» (золотой матч
      // ставит толстую золотую). Переменные наследуются в shadow DOM, поэтому
      // хватает style на элементе-модалке снаружи.
      "background: var(--t-modal-bg, rgba(8,8,10,0.72)); color: var(--t-modal-fg, #fff); padding-top: env(safe-area-inset-top); border: var(--t-modal-border, none);";

    return html`
      <aside
        class="${backdropClass}"
        @click=${this.inline
          ? null
          : () => {
              // terron: на главном сайте не закрываем по клику вне карточки
              // (страницы-разделы persistent); в игре — прежнее поведение.
              if (document.body.classList.contains("in-game")) this.close();
            }}
      >
        <div
          @click=${(e: Event) => e.stopPropagation()}
          class="${wrapperClass}"
          style="${wrapperStyle}"
        >
          ${this.inline || this.hideCloseButton
            ? html``
            : html`<div
                class="absolute top-5 right-5 z-10 text-white cursor-pointer"
                @click=${() => this.close()}
              >
                ✕
              </div>`}
          ${!this.hideHeader && this.title
            ? html`<div
                class="px-[1.4rem] py-[1rem] text-2xl font-bold text-white"
              >
                ${this.title}
              </div>`
            : html``}
          <section class="${sectionClass}" style="${sectionStyle}">
            <slot name="header"></slot>
            ${hasTabs ? this.renderTabs() : html``}
            <div class="flex-1 min-h-0 overflow-y-auto">
              <slot></slot>
            </div>
            <!-- terron: футер ВНЕ скролла (всегда виден). sticky внутри слота на
                 iPad-WKWebView ненадёжен. Модалки без slot="footer" не затрагиваются
                 (пустой слот = 0 высоты). -->
            <slot name="footer"></slot>
          </section>
        </div>
      </aside>
    `;
  }
}

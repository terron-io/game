import { html, LitElement, nothing } from "lit";
import { resolveMarkdown } from "lit-markdown";
import { customElement, property, query, state } from "lit/decorators.js";
import version from "resources/version.txt?raw";
import { L, translateText } from "../client/Utils";
import type { NewsItem } from "../core/ApiSchemas";
import { assetUrl } from "../core/AssetUrls";
import { getNews } from "./Api";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { normalizeNewsMarkdown } from "./NewsMarkdown";

@customElement("news-modal")
export class NewsModal extends BaseModal {
  protected routerName = "news";

  @property({ type: String }) markdown = "Loading...";

  // terron (/admin/news): новости из БД (page=true) — блоком над changelog.
  @state() private newsItems: NewsItem[] = [];

  private initialized: boolean = false;

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("news.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  // Локализация новости по id (news_items.<id>.title/.desc) — как в NewsBox,
  // фолбэк на сырой текст из БД/news.json.
  private itemTexts(item: NewsItem): { title: string; description: string } {
    const kTitle = `news_items.${item.id}.title`;
    const tTitle = translateText(kTitle);
    const title = tTitle === kTitle ? item.title : tTitle;
    const kDesc = `news_items.${item.id}.desc`;
    const tDesc = translateText(kDesc);
    const description =
      tDesc === kDesc
        ? item.descriptionTranslationKey
          ? translateText(item.descriptionTranslationKey)
          : (item.description ?? "")
        : tDesc;
    return { title, description };
  }

  // terron 22.07: раньше новости из БД шли КАРТОЧКАМИ — своя рамка, свой размер
  // шрифта, часть заголовков синими ссылками. Рядом лежал changelog в совсем
  // другой вёрстке, и страница выглядела как два разных документа («бардак»).
  // Теперь блок оформлен ТЕМ ЖЕ языком, что и changelog: заголовок-секция +
  // маркированный список «жирный заголовок — описание».
  // terron 25.08: ссылки «подробнее» в списке изменений БОЛЬШЕ НЕ РИСУЕМ
  // (решение владельца). Пользы от них немного, а на витринах площадок
  // (VK / OK / Яндекс.Игры) любая ссылка наружу и упоминание своего домена —
  // повод для отказа модерации: игра открыта в их iframe, уводить из него
  // нельзя. Поле `url` у новости ОСТАВЛЕНО — оно видно в админке
  // (NewsAdminPage) и переживёт решение вернуть ссылки обратно.

  private renderNewsItems() {
    if (this.newsItems.length === 0) return nothing;
    return html`
      <div
        class="px-6 pt-3
          [&_a]:text-blue-700 [&_a:hover]:text-blue-900 [&_a]:underline
          [&_p]:m-0 [&_p]:inline"
      >
        <h2
          class="text-xl font-bold mt-2 mb-3 text-blue-800"
          style="font-family:var(--t-head,inherit)"
        >
          ${L("Свежее", "Latest")}
        </h2>
        <ul class="pl-5 my-3 list-disc space-y-1.5">
          ${this.newsItems.map((item) => {
            const { title, description } = this.itemTexts(item);
            return html`
              <li class="text-gray-800 leading-relaxed text-[15px]">
                <strong class="text-gray-900 font-bold">${title}</strong
                >${description
                  ? html` — ${resolveMarkdown(description)}`
                  : nothing}
              </li>
            `;
          })}
        </ul>
      </div>
    `;
  }

  protected renderBody() {
    return html`
      ${this.renderNewsItems()}
      <div
        class="prose prose-base max-w-none px-6 py-3
          [&_a]:text-blue-700 [&_a:hover]:text-blue-900 [&_a]:underline transition-colors
          [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-gray-900 [&_h1]:border-b [&_h1]:border-black/10 [&_h1]:pb-2
          [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-blue-800
          [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-blue-700
          [&_ul]:pl-5 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5
          [&_li]:text-gray-800 [&_li]:leading-relaxed [&_li]:text-[15px]
          [&_p]:text-gray-800 [&_p]:mb-3 [&_p]:leading-relaxed [&_p]:text-[15px]
          [&_strong]:text-gray-900 [&_strong]:font-bold"
      >
        ${resolveMarkdown(this.markdown, {
          includeImages: true,
          includeCodeBlockClassNames: true,
        })}
      </div>
    `;
  }

  protected onOpen(): void {
    if (!this.initialized) {
      this.initialized = true;
      // Новости из БД: page=false — только баннер, на страницу не выводим.
      getNews()
        .then((items) => {
          this.newsItems = items.filter((i) => i.page !== false);
        })
        .catch(() => {});
      fetch(assetUrl("changelog.md"))
        .then((response) => (response.ok ? response.text() : "Failed to load"))
        .then((md) => {
          // terron: RU и EN секции в ОДНОМ файле через разделитель <!--EN-->.
          // Показываем на языке юзера; для всех не-RU — английская секция
          // (EN-фолбэк), если её нет — RU.
          const parts = md.split(/<!--\s*EN\s*-->/i);
          const ru = parts[0];
          const en = parts[1] ?? parts[0];
          const isRuLang = L("ru", "en") === "ru";
          return normalizeNewsMarkdown(isRuLang ? ru : en);
        })
        .then((markdown) => (this.markdown = markdown))
        .catch(() => (this.markdown = "Failed to load"));
    }
  }
}

@customElement("news-button")
export class NewsButton extends LitElement {
  @query("news-modal") private newsModal!: NewsModal;

  connectedCallback() {
    super.connectedCallback();
    this.checkForNewVersion();
  }

  private checkForNewVersion() {
    const lastSeenVersion = localStorage.getItem("last-seen-version");
    if (lastSeenVersion !== null && lastSeenVersion !== version) {
      setTimeout(() => {
        this.open();
      }, 500);
    }
  }

  public open() {
    localStorage.setItem("last-seen-version", version);
    this.newsModal.open();
  }

  render() {
    return html`
      <button
        class="border p-[4px] rounded-lg flex cursor-pointer border-black/30 dark:border-gray-300/60 bg-white/70 dark:bg-[rgba(55,65,81,0.7)] hidden"
        @click=${this.open}
      >
        <img
          class="size-[48px] dark:invert"
          src="${assetUrl("images/Megaphone.svg")}"
          alt=${translateText("news.title")}
        />
      </button>
      <news-modal></news-modal>
    `;
  }
}

import { LitElement, html, nothing } from "lit";
import { resolveMarkdown } from "lit-markdown";
import { customElement, state } from "lit/decorators.js";
import type { NewsItem } from "../../core/ApiSchemas";
import { getNews } from "../Api";
import { L, translateText } from "../Utils";

export type { NewsItem };

const DISMISSED_NEWS_KEY = "dismissedNewsItems";
const CYCLE_INTERVAL_MS = 5000;

function getDismissedIds(): Set<string> {
  const raw = localStorage.getItem(DISMISSED_NEWS_KEY);
  if (raw) return new Set(JSON.parse(raw));
  return new Set();
}

function saveDismissedIds(ids: Set<string>): void {
  localStorage.setItem(DISMISSED_NEWS_KEY, JSON.stringify([...ids]));
}

export function getVisibleNewsItems(items: NewsItem[]): NewsItem[] {
  const dismissed = getDismissedIds();
  return items.filter((item) => !dismissed.has(item.id));
}

const typeLabelKeys: Record<string, string> = {
  tournament: "news_box.tournament",
  tutorial: "news_box.tutorial",
  announcement: "news_box.news",
  warning: "news_box.warning",
};

const typeLabelColors: Record<string, string> = {
  tournament: "bg-amber-500/20 text-amber-300",
  tutorial: "bg-sky-500/20 text-sky-300",
  announcement: "bg-emerald-500/20 text-emerald-300",
  warning: "bg-red-500/20 text-red-300",
};

@customElement("news-box")
export class NewsBox extends LitElement {
  @state() private items: NewsItem[] = [];
  @state() private activeIndex = 0;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadNews();
  }

  private async loadNews() {
    try {
      const allItems = await getNews();
      // terron: скрытая новость больше НЕ возвращается — список dismissed не
      // сбрасываем (раньше при «все скрыты» он чистился и новости всплывали снова).
      // banner=false (/admin/news) — новость только для страницы /news.
      const visible = getVisibleNewsItems(
        allItems.filter((i) => i.banner !== false),
      );
      {
        this.items = visible;
      }
      this.startCycle();
    } catch (e) {
      console.error(e);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopCycle();
  }

  private startCycle() {
    this.stopCycle();
    if (this.items.length > 1) {
      this.cycleTimer = setInterval(() => {
        this.activeIndex = (this.activeIndex + 1) % this.items.length;
      }, CYCLE_INTERVAL_MS);
    }
  }

  private stopCycle() {
    if (this.cycleTimer !== null) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
  }

  private dismiss(id: string) {
    const dismissed = getDismissedIds();
    dismissed.add(id);
    saveDismissedIds(dismissed);
    this.items = this.items.filter((item) => item.id !== id);
    if (this.activeIndex >= this.items.length) {
      this.activeIndex = 0;
    }
    this.startCycle();
  }

  private goTo(index: number) {
    this.activeIndex = index;
    this.startCycle();
  }

  private next = () => {
    if (this.items.length < 2) return;
    this.goTo((this.activeIndex + 1) % this.items.length);
  };

  private prev = () => {
    if (this.items.length < 2) return;
    this.goTo((this.activeIndex - 1 + this.items.length) % this.items.length);
  };

  // Свайп пальцем влево/вправо на телефоне (где нет ховер-стрелок). Реагируем
  // только на горизонтальный жест (|dx|>|dy|), чтобы не мешать вертик. скроллу.
  private touchX = 0;
  private touchY = 0;
  private onTouchStart = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    this.touchX = t.clientX;
    this.touchY = t.clientY;
  };
  private onTouchEnd = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - this.touchX;
    const dy = t.clientY - this.touchY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) this.next();
      else this.prev();
    }
  };

  render() {
    if (this.items.length === 0) return nothing;

    const item = this.items[this.activeIndex];

    // terron: локализуем новость по id (ключи news_items.<id>.title/.desc),
    // фолбэк на сырой текст из news.json. Без правок схемы/json — чисто клиент.
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

    const multi = this.items.length > 1;

    return html`
      <div
        class="news-box group relative px-2 py-2 bg-surface border-y border-white/10 lg:border-y-0 lg:rounded-xl lg:p-3"
        @touchstart=${this.onTouchStart}
        @touchend=${this.onTouchEnd}
      >
        <div class="flex items-stretch gap-1.5 lg:gap-2">
          ${multi ? this.arrowBtn("prev") : nothing}
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <span
              class="shrink-0 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded ${typeLabelColors[
                item.type
              ] ?? typeLabelColors["announcement"]}"
              >${translateText(
                typeLabelKeys[item.type] ?? typeLabelKeys["announcement"],
              )}</span
            >
            <div class="flex-1 min-w-0">
              ${item.url
                ? html`<a
                    href="${item.url}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-sm font-medium text-white hover:text-blue-300 transition-colors truncate block"
                    >${title}</a
                  >`
                : html`<span
                    class="text-sm font-medium text-white truncate block"
                    >${title}</span
                  >`}
              <!-- фикс высоты: описание ровно в 2 строки (line-clamp + min-h),
                   иначе при перелистывании баннер скакал по высоте.
                   terron: если новость ведёт в Telegram — ссылка ИНЛАЙН в конце
                   описания (без переноса строки и отдельного чипа). -->
              <span
                class="text-xs text-white/50 line-clamp-2 [&_p]:inline [&_p]:m-0 [&_a]:text-[#3aa8e0] [&_a:hover]:text-[#5cc0f0] [&_a]:font-medium"
                style="min-height:2rem"
                >${resolveMarkdown(description)}${item.url &&
                /(?:t\.me|telegram)/i.test(item.url)
                  ? html` <a
                      href="${item.url}"
                      target="_blank"
                      rel="noopener noreferrer"
                      >${L(
                        "больше читайте в Telegram",
                        "more on Telegram",
                      )}</a
                    >`
                  : nothing}</span
              >
            </div>
            <!-- правый столбик: крестик сверху, счётчик слайда ВНИЗУ колонки
                 (self-stretch + justify-between → число на уровне нижней
                 строки текста, отдельный нижний ряд убран) -->
            <div
              class="shrink-0 flex flex-col items-end justify-between self-stretch"
            >
              <button
                @click=${() => this.dismiss(item.id)}
                class="p-0.5 text-white/30 hover:text-white/70 transition-colors"
                aria-label="${translateText("news_box.dismiss")}"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  class="w-3.5 h-3.5"
                >
                  <path
                    d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                  />
                </svg>
              </button>
              ${multi
                ? html`<span
                    class="text-[10px] tabular-nums leading-none"
                    style="color:var(--t-ink-soft,#6b6a62);font-family:var(--t-mono,monospace)"
                    >${this.activeIndex + 1}/${this.items.length}</span
                  >`
                : ""}
            </div>
          </div>
          ${multi ? this.arrowBtn("next") : nothing}
        </div>
      </div>
    `;
  }

  // Стрелка вправо/влево. На десктопе проявляется по ховеру (group-hover), на
  // телефоне скрыта — там листаем свайпом (onTouch*). Цвета — чернила темы.
  private arrowBtn(dir: "prev" | "next") {
    const path =
      dir === "prev" ? "M12.5 4.5 7 10l5.5 5.5" : "M7.5 4.5 13 10l-5.5 5.5";
    return html`<button
      @click=${dir === "prev" ? this.prev : this.next}
      class="hidden lg:flex shrink-0 w-7 self-stretch items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      style="color:var(--t-ink-soft,#6b6a62)"
      aria-label=${translateText(
        dir === "prev" ? "news_box.prev" : "news_box.next",
      )}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-4 h-4"
      >
        <path d=${path} />
      </svg>
    </button>`;
  }
}

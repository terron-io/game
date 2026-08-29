import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import medalIconRaw from "../../../../resources/images/MedalIconWhite.svg?raw";
import { Difficulty, GameMapType } from "../../../core/game/Game";
import { listCachedMapNames } from "../../../core/game/MapCache";
import { terrainMapFileLoader } from "../../TerrainMapFileLoader";
import { isBundledOfflineMap, isOffline } from "../../Offline";
import { L, translateText } from "../../Utils";

const medalMaskUrl = `url('data:image/svg+xml;utf8,${encodeURIComponent(medalIconRaw)}') no-repeat center / contain`;

@customElement("map-display")
export class MapDisplay extends LitElement {
  @property({ type: String }) mapKey = "";
  @property({ type: Boolean }) selected = false;
  @property({ type: String }) translation: string = "";
  @property({ type: Boolean }) showMedals = false;
  @property({ attribute: false }) wins: Set<Difficulty> = new Set();
  @state() private mapWebpPath: string | null = null;
  @state() private mapName: string | null = null;
  @state() private isLoading = true;
  @state() private hasNations = true;
  // terron: тумба/манифест не загрузились (чаще всего — офлайн и карта не в
  // кеше). Показываем аккуратный placeholder + гасим карточку, а не битый <img>.
  @state() private loadFailed = false;
  // terron: офлайн карта ИГРАБЕЛЬНА только если её map.bin в MapCache. Манифест/
  // тумба могут быть закешированы (смотрел пикер), а бинов нет → играть нельзя.
  // Тогда карточку гасим и помечаем, чтобы не было «вижу, но не запускается».
  @state() private offlineUnavailable = false;
  private observer: IntersectionObserver | null = null;
  private dataLoaded = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !this.dataLoaded) {
          this.dataLoaded = true;
          this.loadMapData();
          this.observer?.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.observer = null;
    super.disconnectedCallback();
  }

  // terron: карточку могут ПЕРЕИСПОЛЬЗОВАТЬ под другую карту — lit сопоставляет
  // узлы списка по позиции, а список featured меняет длину (выбранная не-featured
  // карта подставляется в начало, см. MapPicker.renderFeaturedMaps). Данные же
  // грузились ровно один раз (dataLoaded + observer.disconnect), поэтому у новой
  // карты оставался ПРЕЖНИЙ webp: название «Мир», а картинка Чёрного моря.
  // Ловим смену mapKey и перезагружаем.
  protected willUpdate(changed: Map<string, unknown>) {
    if (!changed.has("mapKey")) return;
    const prev = changed.get("mapKey") as string | undefined;
    if (prev === undefined || prev === this.mapKey) return;
    this.mapWebpPath = null;
    this.mapName = null;
    this.loadFailed = false;
    this.offlineUnavailable = false;
    this.isLoading = true;
    // Если карточку ещё не показывали, догрузит наблюдатель — уже новый ключ.
    if (this.dataLoaded) void this.loadMapData();
  }

  private async loadMapData() {
    if (!this.mapKey) return;

    // Ключ на момент запуска: пока грузится манифест, карточку могли переключить
    // на другую карту — тогда ответ ЧУЖОЙ и применять его нельзя.
    const requestedKey = this.mapKey;
    try {
      this.isLoading = true;
      const mapValue = GameMapType[requestedKey as keyof typeof GameMapType];
      const data = terrainMapFileLoader.getMapData(mapValue);
      this.mapWebpPath = data.webpPath;
      const manifest = await data.manifest();
      if (this.mapKey !== requestedKey) return; // карта сменилась — ответ протух
      this.mapName = manifest.name;
      this.hasNations =
        Array.isArray(manifest.nations) && manifest.nations.length > 0;
    } catch (error) {
      if (this.mapKey !== requestedKey) return;
      console.error("Failed to load map data:", error);
      this.loadFailed = true;
    } finally {
      if (this.mapKey === requestedKey) this.isLoading = false;
    }
    // Офлайн: проверяем, есть ли бины карты (только тогда она играбельна).
    if (isOffline()) {
      try {
        const key = requestedKey.toLowerCase();
        const cached = await listCachedMapNames();
        if (this.mapKey !== requestedKey) return; // карта сменилась за время await
        // вшитые в нативный бандл карты доступны офлайн, даже если их нет в MapCache
        this.offlineUnavailable = !cached.has(key) && !isBundledOfflineMap(key);
      } catch {
        /* нет доступа к кешу — оставляем как есть */
      }
    }
  }

  private handleKeydown(event: KeyboardEvent) {
    // Trigger the same activation logic as click when Enter or Space is pressed
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // Dispatch a click event to maintain compatibility with parent click handlers
      (event.target as HTMLElement).click();
    }
  }

  private preventImageDrag(event: DragEvent) {
    event.preventDefault();
  }

  render() {
    return html`
      <div
        role="button"
        tabindex="0"
        aria-selected="${this.selected}"
        aria-label="${this.translation ?? this.mapName ?? this.mapKey}"
        @keydown="${this.handleKeydown}"
        class="w-full h-full p-3 flex flex-col items-center justify-between rounded-xl border cursor-pointer transition-all duration-200 active:scale-95 gap-3 group ${this
          .loadFailed || this.offlineUnavailable
          ? "opacity-50"
          : ""} ${this.selected
          ? "bg-malibu-blue/20 border-malibu-blue/50 shadow-[var(--shadow-malibu-blue-strong)]"
          : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1"}"
      >
        ${this.isLoading
          ? html`<div
              class="w-full aspect-[2/1] text-white/40 transition-transform duration-200 rounded-lg bg-black/20 text-xs font-bold uppercase tracking-wider flex items-center justify-center animate-pulse"
            >
              ${translateText("map_component.loading")}
            </div>`
          : this.mapWebpPath && !this.loadFailed
            ? html`<div
                class="w-full aspect-[2/1] relative overflow-hidden rounded-lg bg-black/20"
              >
                <img
                  src="${this.mapWebpPath}"
                  alt="${this.translation || this.mapName}"
                  draggable="false"
                  @dragstart=${this.preventImageDrag}
                  @error=${() => {
                    this.loadFailed = true;
                  }}
                  class="w-full h-full object-cover ${this.selected
                    ? "opacity-100"
                    : "opacity-80"} group-hover:opacity-100 transition-opacity duration-200"
                />
                ${this.offlineUnavailable
                  ? html`<div
                      class="absolute inset-0 flex items-center justify-center bg-black/55 text-white/85 text-[10px] font-bold uppercase tracking-wider text-center px-1"
                    >
                      ${L("Недоступно офлайн", "Offline n/a")}
                    </div>`
                  : null}
              </div>`
            : html`<div
                class="w-full aspect-[2/1] text-white/40 rounded-lg bg-black/20 text-xs font-bold uppercase tracking-wider flex items-center justify-center text-center px-2"
              >
                ${isOffline()
                  ? L("Недоступно офлайн", "Unavailable offline")
                  : translateText("map_component.error")}
              </div>`}
        ${this.showMedals && this.hasNations
          ? html`<div class="flex gap-1 justify-center w-full">
              ${this.renderMedals()}
            </div>`
          : null}
        <div
          class="text-xs font-bold text-white uppercase tracking-wider text-center leading-tight break-words hyphens-auto"
        >
          ${this.translation || this.mapName}
        </div>
      </div>
    `;
  }

  private renderMedals() {
    const medalOrder: Difficulty[] = [
      Difficulty.Easy,
      Difficulty.Medium,
      Difficulty.Hard,
      Difficulty.Impossible,
    ];
    const colors: Record<Difficulty, string> = {
      [Difficulty.Easy]: "var(--medal-easy)",
      [Difficulty.Medium]: "var(--medal-medium)",
      [Difficulty.Hard]: "var(--medal-hard)",
      [Difficulty.Impossible]: "var(--medal-impossible)",
    };
    const wins = this.readWins();
    return medalOrder.map((medal) => {
      const earned = wins.has(medal);
      const mask = medalMaskUrl;
      return html`<div
        class="w-5 h-5 ${earned ? "opacity-100" : "opacity-25"}"
        style="background-color:${colors[
          medal
        ]}; mask: ${mask}; -webkit-mask: ${mask};"
        title=${translateText(`difficulty.${medal.toLowerCase()}`)}
      ></div>`;
    });
  }

  private readWins(): Set<Difficulty> {
    return this.wins ?? new Set();
  }
}

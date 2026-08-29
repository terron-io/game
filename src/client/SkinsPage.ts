import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../core/AssetUrls";
import {
  createNamedSkin,
  editNamedSkin,
  getMyNamedSkins,
  getSkinMaster,
  getWallet,
  nameSkin,
  setSkinCapitalName,
  setSkinFalloutSkin,
  type NamedSkin,
  type SkinBake,
} from "./Api";
import {
  FALLOUT_SKIN_COUNT,
  falloutSkinPreviewUrl,
  falloutSkinTitle,
} from "./FalloutSkinPreview";
import { BaseModal } from "./components/BaseModal";
import { coin } from "./components/ui/coin";
import { modalHeader } from "./components/ui/ModalHeader";
import { getPreviewGeo, renderSkinPreview } from "./SkinPreview";
import { L, translateText } from "./Utils";

const usernameKey = "username";

/**
 * /skins — чашка-модель: берёшь визуал (загрузка ИЛИ шаблон) → даёшь ИМЯ (ник) →
 * создаёшь публичный скин (реестр ник→скин). Играешь под этим ником → территория
 * надевается им. «Мои скины» — список (Надеть / Редактировать). Живой предпросмотр
 * на фейк-территории (как в игре). Создание 512=30 / HD=125 ПТС, правка=50.
 */
@customElement("skins-page")
export class SkinsPage extends BaseModal {
  protected routerName = "skins";

  @state() private lts = 0;
  @state() private pts = 0;
  @state() private mine: NamedSkin[] = [];
  @state() private loading = true; // скелетон списка «Мои скины» при загрузке
  @state() private mPreview: NamedSkin | null = null; // клик-превью (как в магазине)
  @state() private mPreviewUrl = "";
  @state() private busy = "";
  @state() private namingId = ""; // id черновика, которому задаём ник
  @state() private nameInput = "";
  // имя столицы «государства» (TZ-skin-capitals.md): модалка установки
  @state() private capitalId = ""; // id скина, которому задаём имя столицы
  @state() private capitalInput = "";
  // узор ядерного пепла: модалка выбора
  @state() private falloutId = ""; // id скина, которому выбираем узор
  @state() private falloutPick = 0; // 0 = случайный (по хэшу)
  @state() private msg = "";

  // редактор
  @state() private stagedUrl = "";
  @state() private skinName = "";
  @state() private hd = false;
  @state() private tilingS = 0;
  @state() private dimPct = 90;
  @state() private previewUrl = "";
  private previewSeed = 0; // форма территории/соседей в превью (⟳ меняет)
  private hoverOwner = -2; // последняя зона под курсором (-2 = нет)
  @state() private editingId = "";
  @state() private urlInput = ""; // загрузка картинки по ссылке
  @state() private dragOver = false; // подсветка зоны при drag-n-drop
  // мини-редактор: фильтры/трансформации (запекаются в сохранённый визуал-копию)
  @state() private fB = 100; // яркость %
  @state() private fC = 100; // контраст %
  @state() private fS = 100; // насыщенность %
  @state() private rot = 0; // поворот 0/90/180/270
  @state() private flip = false; // зеркало по горизонтали
  @state() private origW = 0; // размер исходника (для подсказки качества)
  @state() private origH = 0;
  @state() private bakedW = 0; // размер сохраняемой копии (установки)
  @state() private bakedH = 0;
  private stagedRaw = ""; // ЧИСТЫЙ оригинал ≤4K (мастер) — его и грузим на сервер
  private filterTimer = 0;
  private stagedVisual = ""; // ЛОКАЛЬНОЕ превью-запекание (CSS) — НЕ грузится
  // terron: на правке существующего скина — заменил ли юзер картинку. false →
  // шлём visual=null, сервер перегенерит sample из сохранённого мастера БЕЗ
  // перезаливки (смена HD/ползунков). true → шлём новый мастер.
  private imageReplaced = true;

  private static readonly RAW_CAP = 4096; // потолок мастера (4K — храним как «формат скина»)

  // terron: индикаторы «не молчим». processing = обрабатываем выбранную картинку
  // (тяжёлый canvas-ресайз/кодирование блокирует поток); busyPhase = фаза создания/
  // сохранения (сжатие→загрузка). Без них UI «висел» молча на больших картинках.
  @state() private processing = false;
  @state() private busyPhase = "";

  // Дать браузеру перерисоваться ПЕРЕД синхронной тяжёлой работой (двойной rAF —
  // первый ставит кадр в очередь, второй гарантирует, что он отрисован).
  private nextFrame(): Promise<void> {
    return new Promise((res) =>
      requestAnimationFrame(() => requestAnimationFrame(() => res())),
    );
  }

  private loadImg(src: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("img"));
      im.src = src.startsWith("data:") ? src : assetUrl(src);
    });
  }

  // 3 зоны ползунка: 0 = тянется за зоной (2); правый край ≥94 = СТАТИЧНЫЙ (4) —
  // картинка целиком вписана в карту (contain, без обрезки), за краями цвет игрока;
  // середина = настоящий тайл (3).
  private skinMode(): number {
    if (this.tilingS === 0) return 2;
    if (this.tilingS >= 94) return 4;
    return 3;
  }
  // размер тайла/масштаб картинки (в тайлах карты на повтор). Мельче = плотнее.
  private tileTiles(): number {
    const s = this.tilingS;
    if (s === 0) return 8; // не используется (стретч)
    if (s >= 94) return 30; // фикс: крупная картинка, вбитая в мир
    // тайл: крупно (s=2, ~14 тайлов/повтор) → мелко (s=92, ~2). Зона ~30 тайлов →
    // на середине ~4 повтора, явно видно замощение.
    return Math.min(14, Math.max(2, Math.round(14 - ((s - 2) / 90) * 12)));
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: L("Скины", "Skins"),
      // terron 21.08: пришли из магазина («+ Создать») → «назад» обязано вернуть
      // В МАГАЗИН, а не выбросить на главную (репорт владельца). Метку ставит
      // ShopPage.openEditor; читаем её один раз и снимаем, чтобы прямой заход на
      // /skins потом закрывался как обычно.
      onBack: () => {
        let backToShop = false;
        try {
          backToShop = sessionStorage.getItem("terron_skins_from_shop") === "1";
          sessionStorage.removeItem("terron_skins_from_shop");
        } catch {
          /* приватный режим — просто закроемся */
        }
        this.close();
        if (backToShop) window.showPage?.("page-shop");
      },
      ariaLabel: translateText("common.back"),
      rightContent: html`<div
        style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end"
      >
        <button
          class="t-btn"
          style="padding:5px 12px;font-size:13px"
          @click=${() => {
            this.close();
            window.showPage?.("page-shop");
          }}
        >
          ${L("Купить скин", "Buy skin")}
        </button>
        <span
          class="t-balance"
          style="display:inline-flex;align-items:center;gap:5px"
          title=${L("Золото · Серебро", "Gold · Silver")}
          >${coin("lts")} ${this.lts.toLocaleString("ru-RU")} ·
          ${coin("pts")} ${this.pts.toLocaleString("ru-RU")}</span
        >
      </div>`,
    });
  }

  protected renderBody(): TemplateResult {
    return html`<div class="t-page">
      ${this.msg
        ? html`<div
            style="margin-bottom:12px;padding:8px 12px;border-radius:8px;background:rgba(58,125,68,.12);color:#3a7d44;font-weight:600"
          >
            ${this.msg}
          </div>`
        : ""}

      ${this.renderEditor()}

      <h3 class="t-h3" style="margin-top:22px">${L("Мои скины", "My skins")}</h3>
      ${this.loading
        ? html`<div
            class="t-grid"
            style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-bottom:20px"
          >
            ${[0, 1, 2, 3].map(
              () => html`<div class="t-skincard">
                <div class="t-skinprev t-skel"></div>
                <div
                  class="t-skel"
                  style="height:12px;margin-top:8px;width:70%"
                ></div>
                <div class="t-skel" style="height:30px;margin-top:8px"></div>
              </div>`,
            )}
          </div>`
        : this.mine.length === 0
          ? html`<div class="t-muted" style="margin-bottom:16px">
              ${L("Пока нет — создай выше.", "None yet — create one above.")}
            </div>`
          : html`<div
              class="t-grid"
              style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-bottom:20px"
            >
              ${this.mine.map((s) => this.skinCard(s))}
            </div>`}
      ${this.namingId ? this.renderNameModal() : ""}
      ${this.capitalId ? this.renderCapitalModal() : ""}
      ${this.falloutId ? this.renderFalloutModal() : ""}
      ${this.mPreview ? this.renderCardPreview(this.mPreview) : ""}
    </div>`;
  }

  private skinCard(s: NamedSkin): TemplateResult {
    const named = !!s.name;
    const worn =
      named && this.currentNick().toLowerCase() === s.name!.toLowerCase();
    const src = s.data_url.startsWith("data:")
      ? s.data_url
      : assetUrl(s.data_url);
    // 4 статичный → contain (вся картинка, поля = фон); 2 стретч → cover; иначе тайл.
    const bgPos =
      s.mode === 4
        ? "center/contain no-repeat"
        : s.mode === 2
          ? "center/cover no-repeat"
          : "0 0 / 34px 34px repeat";
    const tiled = s.mode !== 2 && s.mode !== 4;
    return html`<div class="t-skincard">
      <div
        class="t-skinprev"
        style="cursor:pointer;background:#cdbb93;position:relative;overflow:hidden"
        title=${L("Открыть превью", "Open preview")}
        @click=${() => void this.openCardPreview(s)}
      >
        ${tiled
          ? html`<div
              style=${`position:absolute;inset:0;background:url("${src}") ${bgPos}`}
            ></div>`
          : html`<img
              loading="lazy"
              src=${src}
              style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain"
            />`}
      </div>
      ${named
        ? html`<div class="t-skinname">${s.name}${worn ? " ✓" : ""}</div>`
        : html`<button
            class="t-skinname"
            style="background:none;border:none;color:#c0392b;font-weight:700;cursor:pointer;padding:0;text-align:left"
            @click=${() => this.startNaming(s)}
          >
            ${L("Задай имя →", "Set a name →")}
          </button>`}
      <div style="display:flex;gap:6px;margin-top:6px">
        ${named
          ? html`<button
              class="t-btn"
              style="flex:1"
              ?disabled=${worn}
              @click=${() => this.wear(s)}
              title=${L(
                `играй под ником «${s.name}» — увидишь его`,
                `play under nick “${s.name}” to see it`,
              )}
            >
              ${worn ? L("Надет", "Worn") : L("Надеть", "Wear")}
            </button>`
          : html`<button
              class="t-btn"
              style="flex:1;background:#c0392b;color:#fff"
              @click=${() => this.startNaming(s)}
            >
              ${L("Задать имя", "Set name")}
            </button>`}
        <button
          class="t-btn"
          style="background:var(--t-sheet);color:var(--t-ink);flex:0 0 auto;width:40px;padding:0;display:flex;align-items:center;justify-content:center;align-self:stretch;font-size:15px;line-height:1"
          title=${L("Изменить", "Edit")}
          @click=${() => this.startEdit(s)}
        >
          ✎
        </button>
      </div>
    </div>`;
  }

  // Клик по карточке → территориальное превью (как в магазине). Тяжёлый рендер
  // (renderSkinPreview) — только по требованию, не для каждой карточки списка.
  private async openCardPreview(s: NamedSkin): Promise<void> {
    this.mPreview = s;
    this.mPreviewUrl = "";
    this.requestUpdate();
    const url = await renderSkinPreview({
      skinUrl: s.data_url.startsWith("data:")
        ? s.data_url
        : assetUrl(s.data_url),
      mode: s.mode,
      dim: s.dim,
      tileTiles: s.tile_tiles,
    });
    if (this.mPreview === s) {
      this.mPreviewUrl = url;
      this.requestUpdate();
    }
  }

  private closeCardPreview(): void {
    this.mPreview = null;
    this.mPreviewUrl = "";
  }

  private renderCardPreview(s: NamedSkin): TemplateResult {
    return html`<div
      style="position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px"
      @click=${() => this.closeCardPreview()}
    >
      <div
        style="background:var(--t-bg,#fdfcf7);color:var(--t-ink);padding:18px;max-width:min(92vw,520px);box-shadow:0 20px 60px rgba(0,0,0,.4)"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div style="font-weight:700;margin-bottom:10px">
          ${s.name ?? L("Превью скина", "Skin preview")}
          ${s.capital_name
            ? html`<span
                class="t-muted"
                style="font-weight:600;font-size:12px;margin-left:8px"
                >⭐ ${s.capital_name}</span
              >`
            : ""}
        </div>
        <div
          style="width:100%;aspect-ratio:148/66;background:#5e7fa3;overflow:hidden;display:flex;align-items:center;justify-content:center"
        >
          ${this.mPreviewUrl
            ? html`<img
                src=${this.mPreviewUrl}
                style="width:100%;height:100%;object-fit:cover"
              />`
            : html`<div class="t-muted">
                ${L("Рендер превью…", "Rendering preview…")}
              </div>`}
        </div>
        <button
          class="t-btn"
          style="margin-top:12px;width:100%"
          @click=${() => this.closeCardPreview()}
        >
          ${L("Закрыть", "Close")}
        </button>
      </div>
    </div>`;
  }

  // лёгкая кнопка-иконка (не чёрная): прозрачная, тонкая рамка, активная — подсветка.
  private iconBtn(
    icon: string,
    title: string,
    onClick: () => void,
    active = false,
  ): TemplateResult {
    return html`<button
      title=${title}
      @click=${onClick}
      style=${`width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border-radius:0;border:1px solid var(--t-line,rgba(0,0,0,.18));background:${
        active ? "rgba(0,0,0,.08)" : "transparent"
      };color:var(--t-ink);font-size:16px;cursor:pointer;line-height:1;box-shadow:none;text-transform:none;font-weight:500`}
    >
      ${icon}
    </button>`;
  }

  private filterSlider(
    label: string,
    val: number,
    set: (n: number) => void,
  ): TemplateResult {
    return html`<label class="t-label">${label}: <b>${val}%</b></label>
      <input
        type="range"
        min="50"
        max="150"
        step="5"
        .value=${String(val)}
        style="width:100%"
        @input=${(e: Event) => {
          set(Number((e.target as HTMLInputElement).value));
          this.onEdit();
        }}
      />`;
  }

  private renderEditor(): TemplateResult {
    const editing = this.editingId !== "";
    const staged = this.stagedUrl !== "";
    // compact=true — мелкая светлая (как кнопки-иконки), для «Заменить» в ряду правок.
    const fileInput = (label: string, compact = false) => html`<label
      class=${compact ? "" : "t-btn"}
      style=${compact
        ? "cursor:pointer;height:34px;display:inline-flex;align-items:center;padding:0 12px;border-radius:0;border:1px solid var(--t-line,rgba(0,0,0,.18));color:var(--t-ink);font-size:13px;background:transparent;box-shadow:none;font-weight:500;text-transform:none"
        : "cursor:pointer"}
      @click=${this.onFilePickerTap}
    >
      ${label}
      <input
        type="file"
        accept="image/*"
        style="display:none"
        @change=${(e: Event) => this.onPick(e)}
      />
    </label>`;
    return html`<h3
        class="t-h3"
        style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"
      >
        ${editing
          ? L("Редактировать скин", "Edit skin")
          : L("Создать свой скин", "Create your own skin")}
        ${editing
          ? html`<button
              @click=${() => this.startNew()}
              title=${L(
                "выйти из правки и начать новый скин",
                "leave editing and start a new skin",
              )}
              style="height:26px;padding:0 10px;border:1px solid var(--t-line,rgba(0,0,0,.18));background:transparent;color:var(--t-ink);font-size:12px;cursor:pointer;line-height:1;box-shadow:none;font-weight:500;text-transform:none"
            >
              ${L("＋ Новый", "＋ New")}
            </button>`
          : ""}
      </h3>
      <div
        style="display:flex;gap:18px;flex-wrap:wrap;align-items:stretch;margin-bottom:16px"
      >
        <!-- ЛЕВО: превью территории / зона загрузки -->
        <div
          style="flex:1 1 380px;min-width:300px;display:flex;flex-direction:column;gap:10px"
        >
          ${staged
            ? html`<div
                  style="position:relative;width:100%;flex:1;min-height:300px;overflow:hidden;background:#5e7fa3;line-height:0"
                  @mousemove=${(e: MouseEvent) => this.onPreviewHover(e)}
                  @mouseleave=${() => this.onPreviewLeave()}
                >
                  ${this.previewUrl
                    ? html`<img
                        src=${this.previewUrl}
                        style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;image-rendering:auto"
                      />`
                    : ""}
                  <canvas
                    id="prev-hover"
                    style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"
                  ></canvas>
                </div>
                ${this.origW > 0
                  ? html`<div style="font-size:12px;line-height:1.4">
                      <span class="t-muted">${this.origW}×${this.origH}px · </span>
                      <span
                        style="color:${this.qualityHint().color};font-weight:600"
                        >${this.qualityHint().text}</span
                      >
                      ${this.bakedW > 0
                        ? this.hd && Math.min(this.origW, this.origH) < 1024
                          ? html`<span style="color:#b8860b;font-weight:600">
                              ${L(
                                `· установка ${this.bakedW}×${this.bakedH} (меньше 1024 — HD не даст резкости)`,
                                `· baked ${this.bakedW}×${this.bakedH} (under 1024 — HD won't add sharpness)`,
                              )}</span
                            >`
                          : html`<span class="t-muted">
                              ${L(
                                `· установка ${this.bakedW}×${this.bakedH}`,
                                `· baked ${this.bakedW}×${this.bakedH}`,
                              )}</span
                            >`
                        : ""}
                    </div>`
                  : ""}
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                  ${fileInput(L("Заменить", "Replace"), true)}
                  ${this.iconBtn("↻", L("повернуть на 90°", "rotate 90°"), () => {
                    this.rot = (this.rot + 90) % 360;
                    void this.bake();
                  })}
                  ${this.iconBtn(
                    "⇄",
                    L("отразить по горизонтали", "flip horizontally"),
                    () => {
                      this.flip = !this.flip;
                      void this.bake();
                    },
                    this.flip,
                  )}
                  ${this.iconBtn(
                    "⟳",
                    L("другая форма территории в превью", "different territory shape in preview"),
                    () => this.randomizePreview(),
                  )}
                  ${this.iconBtn("✕", L("убрать картинку", "remove image"), () =>
                    this.resetEditor(),
                  )}
                </div>`
            : html`<div
                  @dragover=${(e: DragEvent) => {
                    e.preventDefault();
                    this.dragOver = true;
                  }}
                  @dragleave=${() => (this.dragOver = false)}
                  @drop=${(e: DragEvent) => this.onDrop(e)}
                  style=${`flex:1;min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;border:2px dashed ${
                    this.dragOver ? "var(--t-ink)" : "var(--t-line,rgba(0,0,0,.25))"
                  };background:${this.dragOver ? "rgba(0,0,0,.04)" : "var(--t-sheet)"}`}
                >
                  <div style="font-weight:700;color:var(--t-ink)">
                    ${L("Перетащи картинку сюда", "Drag an image here")}
                  </div>
                  <div class="t-muted" style="font-size:13px">
                    ${L("или вставь из буфера (⌘/Ctrl + V)", "or paste from clipboard (⌘/Ctrl + V)")}
                  </div>
                  ${fileInput(L("Выбрать файл", "Choose file"))}
                  <div
                    style="display:flex;gap:6px;width:100%;max-width:360px;margin-top:4px"
                  >
                    <input
                      class="t-input"
                      style="flex:1"
                      placeholder=${L("…или ссылка на картинку", "…or an image link")}
                      .value=${this.urlInput}
                      @input=${(e: Event) =>
                        (this.urlInput = (e.target as HTMLInputElement).value)}
                      @keydown=${(e: KeyboardEvent) => {
                        if (e.key === "Enter" && this.urlInput.trim())
                          void this.stageFromUrl(this.urlInput.trim());
                      }}
                    />
                    <button
                      class="t-btn"
                      ?disabled=${!this.urlInput.trim()}
                      @click=${() => void this.stageFromUrl(this.urlInput.trim())}
                    >
                      ${L("Загрузить", "Load")}
                    </button>
                  </div>
                </div>`}
        </div>

        <!-- ПРАВО: параметры -->
        <div
          style="flex:0 0 280px;min-width:260px;display:flex;flex-direction:column;gap:10px;opacity:${staged ? "1" : ".5"};pointer-events:${staged ? "auto" : "none"}"
        >
          <label class="t-label">
            ${this.tilingS === 0
              ? L("Режим: тянется за зоной (cover)", "Mode: stretches with the zone (cover)")
              : this.tilingS >= 94
                ? html`<span style="font-weight:700"
                    >${L("Статичный — вписан в карту", "Static — fit into the map")}</span
                  >`
                : L(
                    `Режим: плитка (${this.tilingS < 48 ? "крупно" : "мелко"})`,
                    `Mode: tiled (${this.tilingS < 48 ? "large" : "small"})`,
                  )}
          </label>
          <input
            type="range"
            min="0"
            max="100"
            step="2"
            .value=${String(this.tilingS)}
            style="width:100%"
            @input=${(e: Event) => {
              this.tilingS = Number((e.target as HTMLInputElement).value);
              this.regenPreview();
            }}
          />
          <div
            class="t-muted"
            style="display:flex;justify-content:space-between;font-size:11px"
          >
            <span>${L("тянется", "stretch")}</span><span>${L("плитка", "tiled")}</span
            ><span>${L("статик", "static")}</span>
          </div>
          <label class="t-label"
            >${L("Видимость", "Opacity")}: <b>${this.dimPct}%</b></label
          >
          <input
            type="range"
            min="30"
            max="100"
            step="5"
            .value=${String(this.dimPct)}
            style="width:100%"
            @input=${(e: Event) => {
              this.dimPct = Number((e.target as HTMLInputElement).value);
              this.regenPreview();
            }}
          />
          ${this.filterSlider(L("Яркость", "Brightness"), this.fB, (n) => (this.fB = n))}
          ${this.filterSlider(L("Контраст", "Contrast"), this.fC, (n) => (this.fC = n))}
          ${this.filterSlider(
            L("Насыщенность", "Saturation"),
            this.fS,
            (n) => (this.fS = n),
          )}
          <button
            title=${L(
              "сбросить настройки (режим/видимость/фильтры/поворот/зеркало)",
              "reset settings (mode/opacity/filters/rotation/flip)",
            )}
            @click=${() => this.resetParams()}
            style="align-self:flex-end;height:30px;padding:0 12px;border-radius:0;border:1px solid var(--t-line,rgba(0,0,0,.18));background:transparent;color:var(--t-ink);font-size:12px;cursor:pointer;line-height:1;box-shadow:none;font-weight:500;text-transform:none"
          >
            ${L("Сброс настроек", "Reset settings")}
          </button>
          <input
            class="t-input"
            placeholder=${L("Имя скина = ник (3–27)", "Skin name = nick (3–27)")}
            maxlength="27"
            ?disabled=${editing}
            .value=${this.skinName}
            @input=${(e: Event) =>
              (this.skinName = (e.target as HTMLInputElement).value)}
          />
          ${this.renderExtras()}
          ${html`<label
            class="t-muted"
            style="display:flex;align-items:center;gap:6px;cursor:pointer"
          >
            <input
              type="checkbox"
              .checked=${this.hd}
              @change=${(e: Event) => {
                this.hd = (e.target as HTMLInputElement).checked;
                void this.bake(); // перепечь копию в новый тир (512/1024)
              }}
            />
            ${L("HD 1024px (резче)", "HD 1024px (sharper)")}
          </label>`}
          <button
            class="t-btn"
            style="width:100%"
            ?disabled=${this.busy !== "" ||
            !staged ||
            this.skinName.trim() === ""}
            @click=${() => (editing ? this.saveEdit() : this.create())}
          >
            ${this.busy === "create" || this.busy === "edit"
              ? html`<span
                    class="animate-spin"
                    style="display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;vertical-align:-2px;margin-right:8px"
                  ></span
                  >${this.busyPhase ||
                  (editing
                    ? L("Сохраняю…", "Saving…")
                    : L("Создаю…", "Creating…"))}`
              : editing
                ? html`${L("Сохранить", "Save")} (${this.hd ? 100 : 50} ${coin("pts")})`
                : html`${L("Создать", "Create")} (${this.hd ? 400 : 200} ${coin("pts")})`}
          </button>
        </div>
      </div>`;
  }

  /**
   * ДОПЫ «государства» — платная косметика поверх ника (решение владельца 24.08:
   * ник бесплатно, имя столицы +50 ПТС, узор пепла +50 ПТС). Живут в РЕДАКТОРЕ
   * (не в карточках списка — там от них рябило), доступны только у уже
   * созданного скина: цена списывается сразу, привязывать её не к чему, пока
   * скина нет.
   */
  private renderExtras(): TemplateResult {
    const cur = this.editingId
      ? this.mine.find((s) => s.id === this.editingId)
      : undefined;
    const on = cur !== undefined;
    const row = (
      icon: string,
      label: string,
      value: TemplateResult | string | null,
      onClick: () => void,
    ) => html`<button
      ?disabled=${!on}
      @click=${onClick}
      title=${on
        ? label
        : L(
            "Сначала создай скин — потом добавишь",
            "Create the skin first — then add this",
          )}
      style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:1px solid var(--t-line,rgba(0,0,0,.18));background:transparent;color:var(--t-ink);font-size:13px;cursor:${on
        ? "pointer"
        : "not-allowed"};opacity:${on ? "1" : ".45"};text-align:left;line-height:1"
    >
      <img
        src=${assetUrl(icon)}
        style="width:16px;height:16px;flex:0 0 auto;object-fit:contain"
        alt=""
      />
      <span style="flex:1">${label}</span>
      <span style="font-weight:600;display:flex;align-items:center;gap:5px"
        >${value ?? L("+50 💎", "+50 💎")}</span
      >
    </button>`;
    return html`<div
      style="display:flex;flex-direction:column;gap:6px;margin-top:2px"
    >
      ${row(
        "images/CityIcon.svg",
        L("Имя столицы", "Capital name"),
        cur?.capital_name ?? null,
        () => cur && this.startCapital(cur),
      )}
      ${row(
        "images/NukeIconRed.svg",
        L("Узор пепла", "Fallout pattern"),
        cur?.fallout_skin
          ? html`<img
                src=${falloutSkinPreviewUrl(cur.fallout_skin, 32, 1.6)}
                style="width:14px;height:14px;image-rendering:pixelated"
                alt=""
              />${falloutSkinTitle(cur.fallout_skin, this.isRu())}`
          : null,
        () => cur && this.startFallout(cur),
      )}
    </div>`;
  }

  // ── визуал: 4 метода загрузки (файл / drag-n-drop / вставка ⌘V / ссылка) ──
  private async stageFile(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      this.msg = L("Это не картинка.", "That's not an image.");
      return;
    }
    // telegraph: большая картинка обрабатывается синхронно (ресайз до 4K + кодирование)
    // и блокирует поток → показываем «обрабатываю…» и даём кадр на отрисовку.
    this.msg = L("Обрабатываю картинку…", "Processing image…");
    this.processing = true;
    this.requestUpdate();
    await this.nextFrame();
    try {
      const fileUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onerror = () => rej(new Error("read"));
        r.onload = () => res(r.result as string);
        r.readAsDataURL(file);
      });
      const img = await this.loadImg(fileUrl);
      await this.nextFrame();
      this.stageImage(img);
    } catch {
      this.processing = false;
      this.msg = L("Не удалось обработать картинку.", "Couldn't process the image.");
    }
  }

  // новый исходник: держим в высоком разрешении (≤RAW_CAP, БЕЗ апскейла), запоминаем
  // оригинальный размер (для подсказки качества), сбрасываем правки, печём тир-копию.
  private stageImage(
    img: HTMLImageElement,
    opts: { reset?: boolean; replaced?: boolean } = {},
  ): void {
    const reset = opts.reset ?? true;
    const replaced = opts.replaced ?? true;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    // terron: защита от слишком вытянутых — соотношение не круче 2:1 (на территории
    // экстрим-панорама мылит/искажается). 2.05 — небольшой допуск.
    const ratio = Math.max(iw, ih) / Math.max(1, Math.min(iw, ih));
    if (ratio > 2.05) {
      this.msg = L(
        "Слишком вытянутая картинка (макс. 2:1). Обрежь ближе к квадрату.",
        "Image is too elongated (max 2:1). Crop it closer to a square.",
      );
      this.requestUpdate();
      return;
    }
    this.origW = iw;
    this.origH = ih;
    const cap = SkinsPage.RAW_CAP;
    const sc = Math.min(1, cap / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * sc));
    const h = Math.max(1, Math.round(img.naturalHeight * sc));
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    cv.getContext("2d")!.drawImage(img, 0, 0, w, h);
    // q0.85 (не 0.95): мастер — промежуточный, сервер его всё равно переоптимизирует;
    // меньше байт → быстрее аплоад (раньше 4K@0.95 = мегабайты → ~10с загрузки).
    this.stagedRaw = cv.toDataURL("image/webp", 0.85); // чистый мастер (≤4K)
    this.imageReplaced = replaced;
    if (reset) {
      this.fB = 100;
      this.fC = 100;
      this.fS = 100;
      this.rot = 0;
      this.flip = false;
    }
    void this.bake();
  }

  // запечь скин-КОПИЮ из исходника: тир-размер (512 / 1024 HD, без апскейла выше) +
  // поворот + зеркало + фильтры. Оригинал (stagedRaw) не меняется.
  private async bake(): Promise<void> {
    const raw = this.stagedRaw;
    if (!raw) return;
    try {
      const img = await this.loadImg(raw);
      const tier = this.hd ? 1024 : 512;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      // terron: масштаб по МЕНЬШЕЙ стороне → короткая сторона = тир (512/1024),
      // длинная пропорционально больше. Качество выше (раньше было по большей → мыло).
      const sc = Math.min(1, tier / Math.min(iw, ih)); // НЕ апскейлим выше тира
      const dw = Math.max(1, Math.round(iw * sc));
      const dh = Math.max(1, Math.round(ih * sc));
      const rotated = this.rot === 90 || this.rot === 270;
      const cv = document.createElement("canvas");
      cv.width = rotated ? dh : dw;
      cv.height = rotated ? dw : dh;
      const ctx = cv.getContext("2d")!;
      ctx.filter = `brightness(${this.fB}%) contrast(${this.fC}%) saturate(${this.fS}%)`;
      ctx.translate(cv.width / 2, cv.height / 2);
      if (this.rot) ctx.rotate((this.rot * Math.PI) / 180);
      if (this.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      this.bakedW = cv.width;
      this.bakedH = cv.height;
      this.stagedVisual = this.encodeUnderLimit(cv);
      this.loadStaged(this.stagedVisual);
    } catch {
      /* ignore */
    } finally {
      // обработка картинки завершена — снимаем индикатор
      if (this.processing) {
        this.processing = false;
        if (this.msg === L("Обрабатываю картинку…", "Processing image…")) {
          this.msg = "";
        }
        this.requestUpdate();
      }
    }
  }

  private onEdit(): void {
    clearTimeout(this.filterTimer);
    this.filterTimer = window.setTimeout(() => void this.bake(), 120);
  }

  // оценка качества по меньшей стороне исходника (цифры ориентировочные).
  private qualityHint(): { text: string; color: string } {
    const m = Math.min(this.origW, this.origH);
    if (m <= 0) return { text: "", color: "" };
    if (m < 400)
      return {
        text: L("низкое качество (можно, но мыльно)", "low quality (works, but blurry)"),
        color: "#c0392b",
      };
    if (m < 900)
      return { text: L("хорошее качество", "good quality"), color: "#3a7d44" };
    return { text: L("отличное качество", "excellent quality"), color: "#3a7d44" };
  }

  // terron: на iOS нативный файл-пикер открывается с задержкой → юзер думает «не
  // нажалось» и тапает повторно. Визуально подсвечиваем кнопку, что тап принят
  // (без текста). Подсветка снимается сама или когда пришёл/отменился выбор.
  private pickerTapTimer = 0;
  private pickerTapped = false; // подсветка «тап принят» (ручной requestUpdate)
  private onFilePickerTap = (): void => {
    this.pickerTapped = true;
    this.requestUpdate();
    clearTimeout(this.pickerTapTimer);
    this.pickerTapTimer = window.setTimeout(() => {
      this.pickerTapped = false;
      this.requestUpdate();
    }, 1200);
  };

  private onPick(e: Event): void {
    clearTimeout(this.pickerTapTimer);
    this.pickerTapped = false;
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void this.stageFile(file);
    else this.requestUpdate();
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      void this.stageFile(file);
    } else {
      const url = e.dataTransfer?.getData("text/uri-list") ||
        e.dataTransfer?.getData("text/plain");
      if (url) void this.stageFromUrl(url.trim());
    }
  }

  // вставка из буфера (⌘/Ctrl+V) — картинка или ссылка. Слушаем, пока редактор открыт.
  private onPaste = (e: ClipboardEvent): void => {
    // только когда страница скинов открыта (фулскрин = position:fixed → offsetParent
    // не годится; смотрим класс .hidden, который ставит showPage).
    if (this.classList.contains("hidden")) return;
    if (window.currentPageId && window.currentPageId !== "page-skins") return;
    const items = e.clipboardData?.items;
    if (items) {
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            void this.stageFile(f);
            return;
          }
        }
      }
    }
    const text = e.clipboardData?.getData("text")?.trim();
    if (text && /^https?:\/\//i.test(text)) {
      e.preventDefault();
      void this.stageFromUrl(text);
    }
  };

  // загрузка по ссылке → рисуем в canvas → data-URL (нормализуем; нужен CORS у хоста).
  private async stageFromUrl(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url) && !url.startsWith("data:")) {
      this.msg = L("Нужна ссылка http(s) на картинку.", "Need an http(s) image link.");
      return;
    }
    this.msg = L("Загружаю по ссылке…", "Loading from link…");
    this.requestUpdate();
    try {
      const img = await this.loadImg(url);
      this.msg = "";
      this.stageImage(img);
    } catch {
      this.msg = L(
        "Не удалось загрузить по ссылке (хост не отдаёт картинку / CORS). Скачай и перетащи файлом.",
        "Couldn't load from link (host blocks the image / CORS). Download and drag the file instead.",
      );
    }
    this.requestUpdate();
  }

  private loadStaged(displayUrl: string): void {
    this.stagedUrl = displayUrl;
    this.regenPreview();
    this.requestUpdate();
  }

  /**
   * Чистый лист: выйти из режима правки и начать НОВЫЙ скин. Зовёт магазин
   * («создать скин») и кнопка «Новый» в шапке редактора — до 25.08 такого входа
   * не было вовсе, и редактор залипал на прошлом редактируемом скине.
   */
  public startNew(): void {
    this.resetEditor();
    this.msg = "";
    this.requestUpdate();
  }

  // полный сброс: убрать картинку, вернуться к зоне загрузки.
  private resetEditor(): void {
    this.stagedUrl = "";
    this.stagedVisual = "";
    this.stagedRaw = "";
    this.previewUrl = "";
    this.skinName = "";
    this.editingId = "";
    this.urlInput = "";
    this.origW = 0;
    this.origH = 0;
    this.bakedW = 0;
    this.bakedH = 0;
    this.fB = 100;
    this.fC = 100;
    this.fS = 100;
    this.rot = 0;
    this.flip = false;
    this.requestUpdate();
  }

  // сбросить ПАРАМЕТРЫ (фильтры/поворот/зеркало/режим/видимость) — картинку оставить.
  private resetParams(): void {
    this.fB = 100;
    this.fC = 100;
    this.fS = 100;
    this.rot = 0;
    this.flip = false;
    this.dimPct = 90;
    this.tilingS = 0;
    void this.bake();
  }

  // ── создать / редактировать ──
  // текущие ползунки/поворот — сервер запечёт их в sample из чистого мастера
  private bakeParams(): SkinBake {
    return {
      b: this.fB,
      c: this.fC,
      s: this.fS,
      rot: this.rot,
      flip: this.flip,
    };
  }

  // ЧИСТЫЙ мастер (оригинал ≤4K, БЕЗ ползунков/поворота) для загрузки на сервер,
  // ужатый под лимит тела. Сервер сам оптимизирует и печёт sample с ползунками.
  private async masterForUpload(): Promise<string> {
    if (!this.stagedRaw) return "";
    // stagedRaw УЖЕ чистый webp ≤4K — если влезает в лимит, шлём как есть (БЕЗ
    // повторного декода+кодирования 4К-канваса, это и была лишняя секунда(ы)).
    if (this.stagedRaw.length <= 5_000_000) return this.stagedRaw;
    const img = await this.loadImg(this.stagedRaw);
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    cv.getContext("2d")!.drawImage(img, 0, 0);
    return this.encodeUnderLimit(cv, 5_000_000);
  }

  private async create(): Promise<void> {
    if (!this.stagedRaw || !this.skinName.trim()) return;
    this.busy = "create";
    this.msg = "";
    // фаза 1: сжатие мастера (тяжёлый canvas) — телеграфируем + даём кадр
    this.busyPhase = L("Сжимаю картинку…", "Compressing…");
    this.requestUpdate();
    await this.nextFrame();
    const master = await this.masterForUpload();
    // фаза 2: загрузка + серверная обработка
    this.busyPhase = L("Загружаю…", "Uploading…");
    this.requestUpdate();
    await this.nextFrame();
    const r = await createNamedSkin(
      master,
      this.skinName.trim(),
      this.skinMode(),
      this.dimPct / 100,
      this.tileTiles(),
      this.hd,
      this.bakeParams(),
    );
    this.busyPhase = "";
    if (!r.ok) this.msg = this.errText(r.error);
    else {
      this.msg = L(
        `Скин «${this.skinName.trim()}» создан. Играй под этим ником — увидишь его.`,
        `Skin “${this.skinName.trim()}” created. Play under this nick to see it.`,
      );
      this.resetEditor();
      await this.load();
    }
    this.busy = "";
    this.requestUpdate();
  }

  // публичный — чтобы открыть редактор конкретного скина из «Магазина» (Мои скины)
  public async startEdit(s: NamedSkin): Promise<void> {
    this.editingId = s.id;
    this.skinName = s.name ?? "";
    this.dimPct = Math.round(s.dim * 100);
    // mode 2 → стретч (0), 4 → статичный (правый край), иначе тайл (середина).
    this.tilingS = s.mode === 2 ? 0 : s.mode === 4 ? 100 : 50;
    // предзагрузка ползунков/поворота (сервер их запёк; в редакторе те же значения)
    const bp = s.bake_params;
    this.fB = bp?.b ?? 100;
    this.fC = bp?.c ?? 100;
    this.fS = bp?.s ?? 100;
    this.rot = bp?.rot ?? 0;
    this.flip = bp?.flip ?? false;
    this.msg = L("Загружаю…", "Loading…");
    this.requestUpdate();
    // тир (HD?) — по разрешению сохранённого игрового sample (не мастера!)
    try {
      const sample = await this.loadImg(s.data_url);
      this.hd = Math.min(sample.naturalWidth, sample.naturalHeight) > 512;
    } catch {
      this.hd = false;
    }
    // источник правки: предпочитаем ЧИСТЫЙ мастер (живое превью ползунков по
    // оригиналу + смена HD/размера без перезаливки). Нет мастера (legacy/пресет) →
    // материализуем текущий визуал (на сохранении зальётся как новый мастер).
    let src = "";
    let replaced = false;
    if (s.has_master) src = (await getSkinMaster(s.id)) ?? "";
    if (!src) {
      src = await this.materializeVisual(s.data_url);
      replaced = true;
    }
    try {
      const img = await this.loadImg(src);
      this.stageImage(img, { reset: false, replaced });
      this.msg = L(
        `Редактируешь «${s.name}». Меняй визуал/опции; сохранение = 50 алмазов (HD — 100).`,
        `Editing “${s.name}”. Change visuals/options; saving = 50 diamonds (HD — 100).`,
      );
    } catch {
      this.msg = L(
        "Не удалось загрузить скин для правки.",
        "Couldn't load the skin for editing.",
      );
    }
    this.requestUpdate();
  }

  // terron: купленный скин ссылается на ПРЕСЕТ (images/.. или flags/..). При правке
  // материализуем СВОЮ копию — растеризуем пресет в data:webp, чтобы юзер владел
  // картинкой и мог менять (и чтобы серверная валидация пускала). data: → как есть.
  private async materializeVisual(visual: string): Promise<string> {
    if (!visual || visual.startsWith("data:")) return visual;
    try {
      const img = await new Promise<HTMLImageElement | null>((res) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = assetUrl(visual);
      });
      if (!img || !img.naturalWidth) return visual;
      const cap = 1024;
      const sc = Math.min(1, cap / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * sc));
      const h = Math.max(1, Math.round(img.naturalHeight * sc));
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext("2d");
      if (!ctx) return visual;
      ctx.drawImage(img, 0, 0, w, h);
      return this.encodeUnderLimit(cv);
    } catch {
      return visual;
    }
  }

  // terron: гарантируем, что data-URL влезет в лимит тела API, иначе сервер
  // отвечает 413 «payload too large». ВАЖНО: на сервер уходит САМ data-URL как
  // СТРОКА внутри JSON — меряем длину строки (а не декодированные байты!). Раньше
  // считали байты после base64 (×0.75) → реальный JSON-payload был ~×1.33 больше
  // оценки → 900КБ «байт» = ~1.2МБ строки → перелёт лимита → 413. Цель — длина
  // строки с запасом под JSON-обёртку (name/mode/…) и серверный лимит.
  // Сначала роняем качество, потом размер — юзеру НЕ нужно жать вручную.
  private encodeUnderLimit(
    canvas: HTMLCanvasElement,
    maxChars = 900_000,
  ): string {
    // длина строки data-URL = размер поля в JSON-теле (ASCII → 1 символ = 1 байт)
    const sizeOf = (u: string) => u.length;
    for (const q of [0.92, 0.85, 0.78, 0.7, 0.6, 0.5]) {
      const url = canvas.toDataURL("image/webp", q);
      if (sizeOf(url) <= maxChars) return url;
    }
    let cv = canvas;
    let url = cv.toDataURL("image/webp", 0.6);
    while (sizeOf(url) > maxChars && Math.min(cv.width, cv.height) > 256) {
      const nw = Math.max(256, Math.round(cv.width * 0.85));
      const nh = Math.max(256, Math.round(cv.height * 0.85));
      const next = document.createElement("canvas");
      next.width = nw;
      next.height = nh;
      next.getContext("2d")!.drawImage(cv, 0, 0, nw, nh);
      cv = next;
      url = cv.toDataURL("image/webp", 0.6);
    }
    return url;
  }

  private async saveEdit(): Promise<void> {
    if (!this.editingId) return;
    this.busy = "edit";
    // картинку заменили → шлём новый чистый мастер; не меняли (смена HD/ползунков/
    // режима) → visual=null, сервер перегенерит sample из сохранённого мастера.
    this.busyPhase = this.imageReplaced
      ? L("Сжимаю картинку…", "Compressing…")
      : L("Сохраняю…", "Saving…");
    this.requestUpdate();
    await this.nextFrame();
    const visual = this.imageReplaced ? await this.masterForUpload() : null;
    this.busyPhase = L("Сохраняю…", "Saving…");
    this.requestUpdate();
    await this.nextFrame();
    const r = await editNamedSkin(
      this.editingId,
      visual,
      this.skinMode(),
      this.dimPct / 100,
      this.tileTiles(),
      this.hd,
      this.bakeParams(),
    );
    this.busyPhase = "";
    if (!r.ok) this.msg = this.errText(r.error);
    else {
      this.msg = L("Сохранено.", "Saved.");
      this.resetEditor();
      await this.load();
    }
    this.busy = "";
    this.requestUpdate();
  }

  private errText(e?: string): string {
    return e === "insufficient funds"
      ? L("Недостаточно алмазов.", "Not enough diamonds.")
      : e === "name taken"
        ? L("Это имя уже занято.", "That name is already taken.")
        : e === "bad name"
          ? L(
              "Имя = ник: 3–27 символов (буквы/цифры/_/пробел/./кириллица).",
              "Name = nick: 3–27 chars (letters/digits/_/space/./Cyrillic).",
            )
          : e === "unauthorized"
            ? L("Войди в аккаунт.", "Sign in to your account.")
            : L(`Ошибка: ${e ?? "?"}`, `Error: ${e ?? "?"}`);
  }

  private currentNick(): string {
    const ui = document.querySelector("username-input") as
      | (HTMLElement & { getUsername?: () => string })
      | null;
    if (ui?.getUsername) return ui.getUsername();
    try {
      return localStorage.getItem(usernameKey) ?? "";
    } catch {
      return "";
    }
  }

  // ── надеть = играть под этим ником ──
  private wear(s: NamedSkin): void {
    if (!s.name) return this.startNaming(s);
    const name = s.name;
    try {
      localStorage.setItem(usernameKey, name);
    } catch {
      /* ignore */
    }
    const ui = document.querySelector("username-input") as
      | (HTMLElement & { setUsername?: (n: string) => void })
      | null;
    ui?.setUsername?.(name);
    this.msg = L(
      `«${name}» надет — играй под этим ником.`,
      `“${name}” is on — play under this nick.`,
    );
    this.requestUpdate();
  }

  // именование купленного черновика (как в магазине, бесплатно)
  private startNaming(s: NamedSkin): void {
    this.namingId = s.id;
    this.nameInput = s.name ?? "";
    this.requestUpdate();
  }

  // ── имя столицы «государства» (TZ-skin-capitals.md) ──
  private startCapital(s: NamedSkin): void {
    this.capitalId = s.id;
    this.capitalInput = s.capital_name ?? "";
    this.requestUpdate();
  }

  private async saveCapital(): Promise<void> {
    const name = this.capitalInput.trim();
    this.busy = "capital";
    this.requestUpdate();
    const r = await setSkinCapitalName(this.capitalId, name);
    if (!r.ok) {
      this.msg = this.errText(r.error);
    } else {
      this.msg =
        name === ""
          ? L("Имя столицы снято.", "Capital name removed.")
          : L(`Столица: «${name}».`, `Capital: “${name}”.`);
      this.capitalId = "";
      await this.load();
    }
    this.busy = "";
    this.requestUpdate();
  }

  // ── узор ядерного пепла ──
  private isRu(): boolean {
    return L("ru", "en") === "ru";
  }

  private startFallout(s: NamedSkin): void {
    this.falloutId = s.id;
    this.falloutPick = s.fallout_skin ?? 0;
    this.requestUpdate();
  }

  private async saveFallout(): Promise<void> {
    this.busy = "fallout";
    this.requestUpdate();
    const r = await setSkinFalloutSkin(this.falloutId, this.falloutPick);
    if (!r.ok) {
      this.msg = this.errText(r.error);
    } else {
      this.msg =
        this.falloutPick === 0
          ? L("Узор снят — будет случайный.", "Pattern removed — random now.")
          : L(
              `Узор пепла: «${falloutSkinTitle(this.falloutPick, true)}».`,
              `Fallout pattern: “${falloutSkinTitle(this.falloutPick, false)}”.`,
            );
      this.falloutId = "";
      await this.load();
    }
    this.busy = "";
    this.requestUpdate();
  }

  private renderFalloutModal(): TemplateResult {
    const cur = this.mine.find((s) => s.id === this.falloutId);
    const changed = this.falloutPick !== (cur?.fallout_skin ?? 0);
    const ru = this.isRu();
    const tile = (idx: number) => {
      const on = this.falloutPick === idx;
      return html`<button
        style="padding:4px;border:2px solid ${on
          ? "#c0392b"
          : "transparent"};background:${on
          ? "rgba(192,57,43,.10)"
          : "none"};cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px"
        @click=${() => {
          this.falloutPick = idx;
          this.requestUpdate();
        }}
      >
        ${idx === 0
          ? html`<div
              style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;background:#4a4a42;color:#cfcabb;font-size:20px"
            >
              ?
            </div>`
          : html`<img
              src=${falloutSkinPreviewUrl(idx, 48, 1.6)}
              style="width:48px;height:48px;image-rendering:pixelated"
              alt=""
            />`}
        <span style="font-size:11px;color:var(--t-ink)"
          >${falloutSkinTitle(idx, ru)}</span
        >
      </button>`;
    };
    return html`<div
      style="position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);padding:16px"
      @click=${() => {
        this.falloutId = "";
      }}
    >
      <div
        @click=${(e: Event) => e.stopPropagation()}
        style="background:var(--t-bg,#fdfcf7);color:var(--t-ink);border-radius:14px;padding:18px;max-width:min(92vw,460px);max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.4)"
      >
        <div style="font-weight:800;margin-bottom:6px">
          ${L("Узор ядерного пепла", "Nuclear fallout pattern")}
        </div>
        <div class="t-muted" style="font-size:12px;margin-bottom:12px">
          ${L(
            "Так будет выглядеть пепел от ТВОИХ ядерок — его видят все игроки. Кайма воронки всегда твоего цвета.",
            "This is how fallout from YOUR nukes looks to everyone. The crater rim always uses your colour.",
          )}
        </div>
        <div
          style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;margin-bottom:12px"
        >
          ${[...Array(FALLOUT_SKIN_COUNT + 1).keys()].map((i) => tile(i))}
        </div>
        <div style="display:flex;gap:8px">
          <button
            class="t-btn"
            style="flex:1"
            ?disabled=${this.busy !== "" || !changed}
            @click=${() => this.saveFallout()}
          >
            ${this.falloutPick === 0
              ? L("Снять (бесплатно)", "Remove (free)")
              : html`${L("Выбрать", "Choose")} · 50 ${coin("pts")}`}
          </button>
          <button
            class="t-btn"
            style="background:var(--t-sheet);color:var(--t-ink)"
            @click=${() => {
              this.falloutId = "";
            }}
          >
            ${L("Отмена", "Cancel")}
          </button>
        </div>
      </div>
    </div>`;
  }

  private renderCapitalModal(): TemplateResult {
    const cur = this.mine.find((s) => s.id === this.capitalId);
    const changed = this.capitalInput.trim() !== (cur?.capital_name ?? "");
    const clearing = this.capitalInput.trim() === "";
    return html`<div
      style="position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)"
      @click=${() => {
        this.capitalId = "";
      }}
    >
      <div
        @click=${(e: Event) => e.stopPropagation()}
        style="background:var(--t-bg,#fdfcf7);color:var(--t-ink);border-radius:14px;padding:18px;max-width:min(92vw,420px);box-shadow:0 20px 60px rgba(0,0,0,.4)"
      >
        <div style="font-weight:800;margin-bottom:6px">
          ${L("Имя столицы", "Capital name")}
        </div>
        <div class="t-muted" style="font-size:12px;margin-bottom:10px">
          ${L(
            "Так будет подписана твоя столица на карте, когда играешь этим государством.",
            "Your capital on the map gets this name when you play as this state.",
          )}
        </div>
        <input
          class="t-input"
          style="width:100%;margin-bottom:10px"
          placeholder=${L("3–27 символов", "3–27 chars")}
          maxlength="27"
          .value=${this.capitalInput}
          @input=${(e: Event) =>
            (this.capitalInput = (e.target as HTMLInputElement).value)}
        />
        <div style="display:flex;gap:8px">
          <button
            class="t-btn"
            style="flex:1"
            ?disabled=${this.busy !== "" ||
            !changed ||
            (!clearing && this.capitalInput.trim().length < 3)}
            @click=${() => this.saveCapital()}
          >
            ${clearing
              ? L("Снять (бесплатно)", "Remove (free)")
              : html`${L("Сохранить", "Save")} · 50 ${coin("pts")}`}
          </button>
          <button
            class="t-btn"
            style="background:var(--t-sheet);color:var(--t-ink)"
            @click=${() => {
              this.capitalId = "";
            }}
          >
            ${L("Отмена", "Cancel")}
          </button>
        </div>
      </div>
    </div>`;
  }

  private async saveName(): Promise<void> {
    const name = this.nameInput.trim();
    if (name.length < 3) return;
    this.busy = "name";
    this.requestUpdate();
    const r = await nameSkin(this.namingId, name);
    if (!r.ok) {
      this.msg =
        r.error === "name taken"
          ? L("Это имя уже занято.", "That name is already taken.")
          : r.error === "bad name"
            ? L(
                "Имя = ник: 3–27 (буквы/цифры/_/пробел/./кириллица).",
                "Name = nick: 3–27 (letters/digits/_/space/./Cyrillic).",
              )
            : L(`Ошибка: ${r.error ?? "?"}`, `Error: ${r.error ?? "?"}`);
    } else {
      this.msg = L("Имя задано — скин готов.", "Name set — skin is ready.");
      this.namingId = "";
      await this.load();
    }
    this.busy = "";
    this.requestUpdate();
  }

  private renderNameModal(): TemplateResult {
    return html`<div
      style="position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)"
      @click=${() => {
        this.namingId = "";
      }}
    >
      <div
        @click=${(e: Event) => e.stopPropagation()}
        style="background:var(--t-bg,#fdfcf7);color:var(--t-ink);border-radius:14px;padding:18px;max-width:min(92vw,420px);box-shadow:0 20px 60px rgba(0,0,0,.4)"
      >
        <div style="font-weight:800;margin-bottom:6px">
          ${L("Задай имя скину", "Name your skin")}
        </div>
        <div class="t-muted" style="font-size:12px;margin-bottom:10px">
          ${L(
            "Скин надевается на ник: играя под этим именем, увидишь скин.",
            "A skin is tied to a nick: play under this name to see it.",
          )}
        </div>
        <input
          class="t-input"
          style="width:100%;margin-bottom:10px"
          placeholder=${L("Имя = ник (3–27)", "Name = nick (3–27)")}
          maxlength="27"
          .value=${this.nameInput}
          @input=${(e: Event) =>
            (this.nameInput = (e.target as HTMLInputElement).value)}
        />
        <div style="display:flex;gap:8px">
          <button
            class="t-btn"
            style="flex:1"
            ?disabled=${this.busy !== "" || this.nameInput.trim().length < 3}
            @click=${() => this.saveName()}
          >
            ${L("Сохранить", "Save")}
          </button>
          <button
            class="t-btn"
            style="flex:1;background:var(--t-sheet);color:var(--t-ink)"
            @click=${() => {
              this.namingId = "";
            }}
          >
            ${L("Позже", "Later")}
          </button>
        </div>
      </div>
    </div>`;
  }

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("paste", this.onPaste);
  }
  disconnectedCallback(): void {
    document.removeEventListener("paste", this.onPaste);
    super.disconnectedCallback();
  }

  protected onOpen(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.requestUpdate();
    try {
      const [mine, wallet] = await Promise.all([
        getMyNamedSkins(),
        getWallet(),
      ]);
      this.mine = mine;
      if (wallet) {
        this.lts = wallet.lts;
        this.pts = wallet.pts;
      }
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }

  protected onClose(): void {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }

  // ── живой предпросмотр (единый рендер SkinPreview.ts: карта + наша территория
  // с соседями и игровой границей, залитая скином по режиму) ──
  private regenPreview(): void {
    if (!this.stagedUrl) return;
    const url = this.stagedUrl;
    void renderSkinPreview({
      skinUrl: url,
      mode: this.skinMode(),
      dim: this.dimPct / 100,
      tileTiles: this.tileTiles(),
      seed: this.previewSeed,
    }).then((out) => {
      // гонка: пока рендерили, мог смениться визуал
      if (this.stagedUrl !== url) return;
      this.previewUrl = out;
      this.requestUpdate();
    });
  }

  // ⟳ — другая форма территории/соседей в превью
  private randomizePreview(): void {
    this.previewSeed = Math.floor(Math.random() * 10000);
    this.hoverOwner = -2;
    this.regenPreview();
  }

  // ховер по зонам (как в игре): подсветка территории под курсором.
  private onPreviewHover(e: MouseEvent): void {
    const wrap = e.currentTarget as HTMLElement;
    const cv = wrap.querySelector("#prev-hover") as HTMLCanvasElement | null;
    if (!cv) return;
    const { owners, ow, oh } = getPreviewGeo(this.previewSeed);
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * ow);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * oh);
    if (px < 0 || py < 0 || px >= ow || py >= oh) return this.onPreviewLeave();
    const owner = owners[py * ow + px];
    if (owner === this.hoverOwner) return;
    this.hoverOwner = owner;
    if (cv.width !== ow) cv.width = ow;
    if (cv.height !== oh) cv.height = oh;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, ow, oh);
    if (owner < 0) return; // океан — без подсветки
    const im = ctx.createImageData(ow, oh);
    const d = im.data;
    for (let i = 0; i < owners.length; i++) {
      if (owners[i] !== owner) continue;
      const o = i * 4;
      d[o] = 255;
      d[o + 1] = 255;
      d[o + 2] = 255;
      d[o + 3] = 46; // ~0.18 белым — подсветка зоны
    }
    ctx.putImageData(im, 0, 0);
  }

  private onPreviewLeave(): void {
    this.hoverOwner = -2;
    const cv = this.querySelector("#prev-hover") as HTMLCanvasElement | null;
    const ctx = cv?.getContext("2d");
    if (cv && ctx) ctx.clearRect(0, 0, cv.width, cv.height);
  }
}

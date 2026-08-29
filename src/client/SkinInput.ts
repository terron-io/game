import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../core/AssetUrls";
import { getMyNamedSkins, nameSkin, type NamedSkin } from "./Api";
import { renderSkinPreview } from "./SkinPreview";
import { toast } from "./Toast";
import { L, translateText } from "./Utils";

const usernameKey = "username";

// Кнопка «СКИН» в строке входа: по клику разворачивает СНИЗУ панель «Мои скины»
// (как на странице скинов, но без редактуры) — карточки квадратные, кнопка НАДЕТЬ
// заливает ник. Создание/правка — по ссылке «Управление скинами →» (страница /skins).
@customElement("skin-input")
export class SkinInput extends LitElement {
  @state() private open = false;
  @state() private mine: NamedSkin[] = [];
  @state() private loading = false;
  @state() private nick = localStorage.getItem(usernameKey) ?? "";
  @state() private nameDraft: Record<string, string> = {}; // id → черновик ника
  @state() private busyName = ""; // id скина, которому сейчас задаём имя
  @state() private prevSkin: NamedSkin | null = null; // превью «как в игре»
  @state() private prevUrl = "";

  // клик по КАРТИНКЕ скина → превью «как в игре» (единый renderSkinPreview, как в магазине/скинах)
  private async openPreview(s: NamedSkin): Promise<void> {
    this.prevSkin = s;
    this.prevUrl = "";
    const src = s.data_url.startsWith("data:") ? s.data_url : assetUrl(s.data_url);
    const url = await renderSkinPreview({
      skinUrl: src,
      mode: s.mode,
      dim: s.dim ?? 0.9,
      tileTiles: s.tile_tiles ?? 8,
    });
    if (this.prevSkin === s) this.prevUrl = url;
  }

  createRenderRoot() {
    return this;
  }

  private onNick = (e: Event) => {
    this.nick = (e as CustomEvent).detail?.nick ?? this.nick;
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("keydown", this.onKey);
    window.addEventListener("terron-nick-changed", this.onNick);
    // клик по превью-скину в полосе тоже открывает панель
    window.addEventListener("terron-open-skin-sheet", this.onOpenRequest);
    // terron: переводы грузятся асинхронно — перерисуем, чтобы translateText
    // подтянул значение (иначе кнопка залипала на сыром ключе SKIN_INPUT.TITLE).
    window.setTimeout(() => this.requestUpdate(), 600);
    window.setTimeout(() => this.requestUpdate(), 2000);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this.onKey);
    window.removeEventListener("terron-nick-changed", this.onNick);
    window.removeEventListener("terron-open-skin-sheet", this.onOpenRequest);
  }

  private onOpenRequest = () => {
    if (!this.open) void this.openSheet();
  };

  private async openSheet() {
    this.open = true;
    this.loading = true;
    try {
      // показываем ВСЕ, включая безымянные черновики — имя можно задать прямо тут.
      this.mine = await getMyNamedSkins();
    } catch {
      this.mine = [];
    }
    this.loading = false;
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.open = false;
  };

  private toggle(e: Event) {
    e.stopPropagation();
    if (this.open) {
      this.open = false;
      return;
    }
    void this.openSheet();
  }

  // надеть = играть под этим ником (территория наденется зарегистрированным скином)
  private wear(s: NamedSkin) {
    if (!s.name) return;
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
    this.nick = name;
    this.open = false;
  }

  private manage(e: Event) {
    e.stopPropagation();
    this.open = false;
    window.showPage?.("page-skins");
  }

  // задать имя (ник) безымянному скину прямо тут → станет носимым
  private async saveName(s: NamedSkin) {
    const name = (this.nameDraft[s.id] ?? "").trim();
    if (!name) return;
    this.busyName = s.id;
    const r = await nameSkin(s.id, name);
    this.busyName = "";
    if (!r.ok) {
      toast(
        r.error === "name taken"
          ? L("Имя уже занято", "Name already taken")
          : L("Не удалось задать имя", "Couldn't set name"),
        "error",
      );
      return;
    }
    await this.openSheet(); // перезагрузить список
    if (r.skin) this.wear(r.skin); // и сразу надеть
  }

  private card(s: NamedSkin) {
    const worn = this.nick.toLowerCase() === (s.name ?? "").toLowerCase();
    const src = s.data_url.startsWith("data:")
      ? s.data_url
      : assetUrl(s.data_url);
    // плитка (1/3) → повтор; флаг/статик (2/4) → contain (полный флаг)
    const bgPos =
      s.mode === 1 || s.mode === 3
        ? "0 0 / 34px 34px repeat"
        : "center/contain no-repeat";
    return html`<div class="t-skincard">
      <div
        class="t-skinprev"
        style=${`background:#cdbb93 url("${src}") ${bgPos};cursor:pointer`}
        title=${L("Превью как в игре", "In-game preview")}
        @click=${(e: Event) => {
          e.stopPropagation();
          void this.openPreview(s);
        }}
      ></div>
      ${s.name
        ? html`<div class="t-skinname">${s.name}${worn ? " ✓" : ""}</div>
            <button
              class="t-btn"
              style="width:100%;margin-top:6px"
              ?disabled=${worn}
              @click=${() => this.wear(s)}
            >
              ${worn ? L("Надет", "Worn") : L("Надеть", "Wear")}
            </button>`
        : html`<input
              class="t-input"
              style="width:100%;margin-top:6px"
              placeholder=${L("задай ник", "set a nick")}
              .value=${this.nameDraft[s.id] ?? ""}
              @click=${(e: Event) => e.stopPropagation()}
              @input=${(e: Event) => {
                this.nameDraft = {
                  ...this.nameDraft,
                  [s.id]: (e.target as HTMLInputElement).value,
                };
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") void this.saveName(s);
              }}
            />
            <button
              class="t-btn"
              style="width:100%;margin-top:6px"
              ?disabled=${this.busyName === s.id ||
              !(this.nameDraft[s.id] ?? "").trim()}
              @click=${() => this.saveName(s)}
            >
              ${this.busyName === s.id ? "…" : L("Задать имя", "Set name")}
            </button>`}
    </div>`;
  }

  render() {
    // до загрузки i18n translateText отдаёт СЫРОЙ ключ ("skin_input.title",
    // длинный) → ширина кнопки скакала при ре-рендере и строка мигала. Показываем
    // короткий фолбэк, пока ключ не разрешён — ширина стабильна, мигания нет.
    const t = translateText("skin_input.title");
    const label = t === "skin_input.title" ? L("Скин", "Skin") : t;
    return html`
      <div class="skin-input relative shrink-0 flex items-center h-full">
        <button
          class="skin-btn"
          title=${label}
          @click=${(e: Event) => this.toggle(e)}
        >
          ${label}
        </button>
      </div>
      ${this.open
        ? html`<div
            class="skin-sheet-backdrop"
            @click=${() => (this.open = false)}
          >
            <div class="skin-sheet" @click=${(e: Event) => e.stopPropagation()}>
              <div class="skin-sheet-head">
                <span class="skin-sheet-title">${L("Мои скины", "My skins")}</span>
                <div style="display:flex;gap:10px;align-items:center">
                  <button
                    class="skin-sheet-manage"
                    @click=${(e: Event) => this.manage(e)}
                  >
                    ${L("Управление скинами →", "Manage skins →")}
                  </button>
                  <button
                    class="skin-sheet-x"
                    @click=${() => (this.open = false)}
                  >
                    ✕
                  </button>
                </div>
              </div>
              ${this.loading
                ? html`<div class="t-muted" style="padding:14px 2px">
                    ${L("Загрузка…", "Loading…")}
                  </div>`
                : this.mine.length === 0
                  ? html`<div class="t-muted" style="padding:14px 2px">
                      ${L("Скинов пока нет.", "No skins yet.")}
                      <button
                        class="skin-sheet-manage"
                        @click=${(e: Event) => this.manage(e)}
                      >
                        ${L("Создать →", "Create →")}
                      </button>
                    </div>`
                  : html`<div
                      class="t-grid skin-sheet-grid"
                      style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))"
                    >
                      ${this.mine.map((s) => this.card(s))}
                    </div>`}
            </div>
          </div>`
        : null}
      ${this.prevSkin
        ? html`<div
            style="position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)"
            @click=${() => (this.prevSkin = null)}
          >
            <div
              @click=${(e: Event) => e.stopPropagation()}
              style="background:#fdfcf7;color:#1a1a1a;padding:18px;max-width:min(92vw,520px)"
            >
              <div style="font-weight:800;margin-bottom:10px">
                ${this.prevSkin.name ?? L("Скин", "Skin")} ${L("— как в игре", "— in game")}
              </div>
              <div
                style="width:100%;aspect-ratio:148/66;background:#5e7fa3;overflow:hidden;display:flex;align-items:center;justify-content:center"
              >
                ${this.prevUrl
                  ? html`<img
                      src=${this.prevUrl}
                      style="width:100%;height:100%;object-fit:contain"
                    />`
                  : html`<span class="t-muted" style="font-size:13px"
                      >${L("Рендер…", "Rendering…")}</span
                    >`}
              </div>
              <button
                class="t-btn"
                style="width:100%;margin-top:10px"
                @click=${() => (this.prevSkin = null)}
              >
                ${L("Закрыть", "Close")}
              </button>
            </div>
          </div>`
        : null}
    `;
  }
}

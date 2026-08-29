import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "resources/countries.json" with { type: "json" };
import { UserMeResponse } from "src/core/ApiSchemas";
import { assetUrl } from "src/core/AssetUrls";
import { Cosmetics } from "src/core/CosmeticSchemas";
import { UserSettings } from "src/core/game/UserSettings";
import { getUserMe } from "./Api";
import { type ClanMine, fetchMyClans } from "./ClanApi";
import { bracketPair } from "./ClanTerm";
import {
  fetchCosmetics,
  flagRelationship,
  primeClanFlag,
  translateCosmetic,
} from "./Cosmetics";
import { countryMatchesSearch, countryName } from "./CountryNames";
import { translateText } from "./Utils";
import { BaseModal } from "./components/BaseModal";
import "./components/NotLoggedInWarning";
import { modalHeader } from "./components/ui/ModalHeader";

/**
 * terron 25.08.2026: СВОЙ вид плиток вместо апстримового `<cosmetic-button>`.
 *
 * Тот рисует тёмные карточки с градиентами, свечением и «редкостью» — язык
 * магазина OpenFront. На нашем пергаментном листе это выглядело чужеродно
 * (замечание владельца), а выбор флага — не магазин: тут нет ни цен, ни
 * редкости, все флаги доступны. Плитка сделана в языке сайта: квадрат,
 * тонкая рамка чернилами, подпись Oswald-капсом, выбранная залита чернилами.
 *
 * Стили ставим ОДИН РАЗ отсюда, а не в terron-theme.css: модалка живёт в
 * светлом DOM, класс `.t-flag-*` больше нигде не нужен, а общий файл темы
 * правят параллельные сессии — незачем лезть туда ради одного экрана.
 */
let flagStylesInstalled = false;
function ensureFlagStyles(): void {
  if (flagStylesInstalled || typeof document === "undefined") return;
  flagStylesInstalled = true;
  const st = document.createElement("style");
  st.textContent = `
.t-flag-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(154px,1fr));gap:10px} /* 154 = 128 + 20 %: флаг занимает всю ширину плитки, так что «сделать флаги    крупнее» = растянуть саму плитку (просьба владельца 25.08). */
.t-flag-tile{display:flex;flex-direction:column;align-items:stretch;padding:0;overflow:hidden;
  background:var(--t-sheet,#fdfcf7);color:var(--t-ink,#2b2a24);
  border:1px solid rgba(43,42,36,.2);border-radius:0;cursor:pointer;
  transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}
.t-flag-tile:hover{border-color:rgba(43,42,36,.55);box-shadow:3px 3px 0 rgba(43,42,36,.14);transform:translateY(-1px)}
.t-flag-tile:focus-visible{outline:2px solid var(--t-red,#b3261e);outline-offset:2px}
.t-flag-tile.is-on{background:var(--t-ink,#2b2a24);color:var(--t-bg,#efe6c8);border-color:var(--t-ink,#2b2a24)}
/* Флаг — ВО ВСЮ ШИРИНУ плитки: рамка тут одна, у самой плитки (решение
   владельца 25.08). Отдельная подложка с бордюром вокруг картинки читалась
   как вторая рамка, а у флагов со своим контуром (Бенин, ССР) — как третья. */
.t-flag-pic{display:block;width:100%;line-height:0}
/* ⚠️ Место под картинку РЕЗЕРВИРУЕМ (aspect-ratio): грузим 554 флага лениво, и
   без резерва подпись сначала прыгает наверх, а потом её сталкивает вниз
   догрузившийся флаг. contain — потому что соотношения у флагов разные. */
.t-flag-pic img{display:block;width:100%;height:auto;aspect-ratio:3/2;
  object-fit:contain;pointer-events:none}
.t-flag-name{padding:8px 6px 9px;font:700 10.5px/1.25 'Oswald','Golos Text',system-ui,sans-serif;
  text-transform:uppercase;letter-spacing:.05em;text-align:center;overflow-wrap:anywhere}
`;
  document.head.appendChild(st);
}

@customElement("flag-input-modal")
export class FlagInputModal extends BaseModal {
  protected routerName = "flag-input";

  @state() private search = "";
  @state() private cosmetics: Cosmetics | null = null;
  @state() private userMe: UserMeResponse | false = false;
  @state() private myClans: ClanMine[] = [];
  public returnTo = "";

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
  }

  /** Одна плитка выбора — общий вид для стран, «без флага» и покупных флагов. */
  private flagTile(opts: {
    name: string;
    url: string;
    selected: boolean;
    onSelect: () => void;
  }) {
    return html`
      <button
        class="t-flag-tile ${opts.selected ? "is-on" : ""}"
        title=${opts.name}
        @click=${opts.onSelect}
      >
        <span class="t-flag-pic">
          <img
            src=${opts.url}
            alt=""
            loading="lazy"
            draggable="false"
            @error=${(e: Event) =>
              ((e.currentTarget as HTMLImageElement).style.visibility =
                "hidden")}
          />
        </span>
        <span class="t-flag-name">${opts.name}</span>
      </button>
    `;
  }

  private renderFlags() {
    ensureFlagStyles();
    const userSettings = new UserSettings();
    const selectedFlag = userSettings.getFlag() ?? "";

    const cosmeticFlags = Object.entries(this.cosmetics?.flags ?? {})
      .filter(([, flag]) => {
        if (!this.includedInSearch({ name: flag.name, code: flag.name }))
          return false;
        return flagRelationship(flag, this.userMe, null) === "owned";
      })
      .map(([key, flag]) =>
        this.flagTile({
          name: translateCosmetic("flags", flag.name),
          url: flag.url,
          selected: selectedFlag === `flag:${key}`,
          onSelect: () => {
            this.setFlag(`flag:${key}`);
            this.close();
          },
        }),
      );

    // «Без флага» — та же запись countries.json (code "xx"), чтобы подпись
    // переводилась общим механизмом, а не жила отдельной строкой.
    const noFlagEntry = Countries.find((c) => c.code === "xx");
    const noFlag = this.search
      ? null
      : this.flagTile({
          name: noFlagEntry ? countryName(noFlagEntry) : "None",
          url: assetUrl(`/flags/xx.svg`),
          selected: selectedFlag === "" || selectedFlag === "country:xx",
          onSelect: () => {
            this.setFlag("country:xx");
            this.close();
          },
        });

    const countryFlags = Countries.filter(
      (country) =>
        country.code !== "xx" &&
        !country.restricted &&
        this.includedInSearch(country),
    ).map((country) =>
      this.flagTile({
        name: countryName(country),
        url: assetUrl(`/flags/${country.code}.svg`),
        selected: selectedFlag === `country:${country.code}`,
        onSelect: () => {
          this.setFlag(`country:${country.code}`);
          this.close();
        },
      }),
    );

    return html`
      <div class="t-flag-grid">${noFlag} ${cosmeticFlags} ${countryFlags}</div>
    `;
  }

  protected renderHeaderSlot() {
    return html`
      <div
        class="relative flex flex-col border-b border-white/10 pb-4 shrink-0"
      >
        ${modalHeader({
          title: translateText("flag_input.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
          rightContent: html`<not-logged-in-warning></not-logged-in-warning>`,
        })}

        <div class="md:flex items-center gap-2 justify-center mt-4">
          <input
            class="h-12 w-full max-w-md border border-white/10 bg-black/60
              rounded-xl shadow-inner text-xl text-center focus:outline-none
              focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-white placeholder-white/30 transition-all"
            type="text"
            placeholder=${translateText("flag_input.search_flag")}
            .value=${this.search}
            @change=${this.handleSearch}
            @keyup=${this.handleSearch}
          />
        </div>
      </div>
    `;
  }

  // terron: выбрать клан как флаг — ставит И клан-флаг (`clan:<tag>` → картинка
  // клана), И клан-тег (через событие в username-input). Использовать тег может
  // только участник, поэтому показываем лишь МОИ кланы.
  private pickClan(c: ClanMine) {
    // флаг клана у нас уже есть → кладём в кэш, чтобы показался мгновенно
    primeClanFlag(c.tag, c.flag);
    this.setFlag(`clan:${c.tag}`);
    window.dispatchEvent(
      new CustomEvent("terron-clan-picked", { detail: { tag: c.tag } }),
    );
    this.close();
  }

  private renderMyClans() {
    if (this.myClans.length === 0 || this.search) return null;
    const selectedFlag = new UserSettings().getFlag() ?? "";
    return html`
      <div class="px-5 pt-4">
        <div
          class="text-xs font-black uppercase tracking-wider text-white/50 mb-3"
        >
          ${translateText("flag_input.my_clans")}
        </div>
        <div class="flex flex-wrap gap-3">
          ${this.myClans.map((c) => {
            const b = bracketPair(c.bracket);
            const selected = selectedFlag === `clan:${c.tag}`;
            return html`
              <button
                class="flex items-center gap-2 px-3 py-2 rounded-xl border transition-all
                  ${selected
                  ? "border-blue-500 bg-blue-500/15"
                  : "border-white/10 bg-black/40 hover:bg-white/10"}"
                title=${c.name}
                @click=${() => this.pickClan(c)}
              >
                ${c.flag
                  ? html`<img
                      src=${c.flag}
                      class="w-6 h-6 object-cover rounded pointer-events-none"
                      draggable="false"
                    />`
                  : html`<span
                      class="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px] text-white/60"
                      >⚑</span
                    >`}
                <span class="text-sm font-semibold text-white"
                  >${b.l}${c.tag}${b.r}</span
                >
                <span class="text-sm text-white/70 max-w-[10rem] truncate"
                  >${c.name}</span
                >
              </button>
            `;
          })}
        </div>
        <div class="border-b border-white/10 mt-4"></div>
      </div>
    `;
  }

  protected renderBody() {
    return html`
      <div class="flex justify-center py-3 shrink-0">
        <o-button
          class="no-crazygames"
          variant="primary"
          size="sm"
          translationKey="main.store"
          @click=${() => {
            this.close();
            window.showPage?.("page-item-store");
          }}
        ></o-button>
      </div>
      ${this.renderMyClans()}
      <div class="px-3 pb-3">${this.renderFlags()}</div>
    `;
  }

  private includedInSearch(country: {
    name: string;
    name_ru?: string;
    code: string;
  }): boolean {
    return countryMatchesSearch(country, this.search);
  }

  private handleSearch(event: Event) {
    this.search = (event.target as HTMLInputElement).value;
  }

  private setFlag(flag: string) {
    new UserSettings().setFlag(flag);
  }

  protected async onOpen(): Promise<void> {
    [this.cosmetics, this.userMe, this.myClans] = await Promise.all([
      fetchCosmetics(),
      getUserMe().then((r) => r || (false as const)),
      fetchMyClans().then((r) => r ?? []),
    ]);
  }

  protected onClose(): void {
    this.search = "";
    if (this.returnTo) {
      const returnEl = document.querySelector(this.returnTo) as any;
      if (returnEl?.open) {
        returnEl.open();
      }
      this.returnTo = "";
    }
  }
}

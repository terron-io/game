import { html, TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { getWallet } from "./Api";
import type {
  ClanFull,
  ClanInviteRow,
  ClanJoinRequest,
  ClanMember,
} from "./ClanApi";
import {
  approveClanRequest,
  cancelClanInvite,
  createClan,
  denyClanRequest,
  editClan,
  fetchClanBySlug,
  fetchClanInvites,
  fetchClanMembers,
  fetchClanRequests,
  inviteToClan,
  kickMember,
} from "./ClanApi";
import { BRACKETS, CT } from "./ClanTerm";
import { BaseModal } from "./components/BaseModal";
import { coin } from "./components/ui/coin";
import { modalHeader } from "./components/ui/ModalHeader";
import "./IdentifierInput";
import type { IdentifierInput } from "./IdentifierInput";
import { softGo } from "./SoftNavigate";
import { toast } from "./Toast";
import { L, translateText } from "./Utils";

// Цена создания ПЕРВОГО клана (одинаково за ЛТС или ПТС). Второй/следующий —
// дороже (решим позже, см. clans.md → «Экономика»).
const FIRST_CLAN_PRICE = 50;

// Тег: латиница/цифры/кириллица, 2–5 симв. — зеркало ClanTagSchema (Schemas.ts).
const TAG_RE = /^[a-zA-Z0-9Ѐ-ӿ]{2,5}$/u;
const TAG_STRIP = /[^a-zA-Z0-9Ѐ-ӿ]/gu;

// Грубая транслитерация RU→lat для красивого slug из русского имени.
const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function slugifyName(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const DRAFT_KEY = "terron_clan_draft";

/**
 * /clan/new (алиасы /clan/create, /new) — экран СОЗДАНИЯ клана. Без бэкенда: форма
 * валидируется и сохраняется черновиком в localStorage, реальное создание
 * подключим, когда будет API (см. clans.md). Живой предпросмотр — апстрим
 * <clan-card> (+ флаг). Термин «клан» выводится из ClanTerm.CT (одна точка
 * переименования).
 */
@customElement("clan-create-page")
export class ClanCreatePage extends BaseModal {
  protected routerName = "clan-create";

  @state() private lts = 0;
  @state() private pts = 0;

  // поля формы
  @state() private flagUrl = ""; // data-URL превью флага
  @state() private tag = "";
  @state() private bracket = 0; // индекс в BRACKETS
  @state() private name = "";
  @state() private nameRu = ""; // опц. RU-перевод имени (показ на ru-локали; иначе EN-база)
  @state() private slug = "";
  @state() private slugTouched = false; // юзер правил slug вручную → не перетираем
  @state() private description = "";
  @state() private descriptionRu = ""; // опц. RU-перевод описания
  @state() private joinOpen = true; // открытый вход / по заявке
  @state() private flagBusy = false;
  @state() private creating = false; // идёт запрос создания/сохранения
  // Режим редактирования: непустой = тег клана ДО правки (адресуем им PATCH).
  // Пусто = режим создания. Переключает форму (заголовок/футер/draft/submit).
  @state() private editTag = "";

  private get isEdit(): boolean {
    return this.editTag !== "";
  }

  @state() private requests: ClanJoinRequest[] = []; // заявки (режим правки)
  @state() private members: ClanMember[] = []; // участники (режим правки)
  @state() private invites: ClanInviteRow[] = []; // отправленные приглашения
  @state() private inviteInput = ""; // поле «пригласить игрока» (фолбэк-значение)
  @query("identifier-input") private inviteIdInput?: IdentifierInput;

  protected renderHeaderSlot() {
    return modalHeader({
      title: this.isEdit
        ? L(`Редактировать ${CT.acc}`, `Edit ${CT.en}`)
        : L(`Создать ${CT.acc}`, `Create a ${CT.en}`),
      // В правке «назад» → страница клана (а не на главную).
      onBack: () => (this.isEdit ? this.cancelEdit() : this.close()),
      ariaLabel: translateText("common.back"),
      rightContent: html`<span
        class="t-balance"
        style="display:inline-flex;align-items:center;gap:5px"
        title=${L("Золото · Серебро", "Gold · Silver")}
        >${coin("lts")} ${this.lts.toLocaleString("ru-RU")} · ${coin("pts")}
        ${this.pts.toLocaleString("ru-RU")}</span
      >`,
    });
  }

  // --- флаг (как скины: загрузка картинки → квадрат-превью) ---
  private async onFlagFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.flagBusy = true;
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("read"));
        r.readAsDataURL(file);
      });
      this.flagUrl = await this.downscaleSquare(dataUrl, 256);
      this.saveDraft();
    } catch {
      toast(
        L("Не удалось загрузить изображение", "Failed to load image"),
        "error",
      );
    } finally {
      this.flagBusy = false;
      input.value = "";
    }
  }

  // Вписываем ЦЕЛИКОМ в квадрат size×size (contain, без обрезки) — поле прозрачное,
  // так юзер сам делает любую форму (круг/половина/фигура с альфой). PNG хранит альфу.
  private downscaleSquare(src: string, size: number): Promise<string> {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = cv.height = size;
        const ctx = cv.getContext("2d");
        if (!ctx) return rej(new Error("ctx"));
        const scale = Math.min(size / im.width, size / im.height);
        const w = im.width * scale;
        const h = im.height * scale;
        ctx.drawImage(im, (size - w) / 2, (size - h) / 2, w, h);
        res(cv.toDataURL("image/png"));
      };
      im.onerror = () => rej(new Error("img"));
      im.src = src;
    });
  }

  // --- ввод полей ---
  private setTag(v: string) {
    this.tag = v.replace(TAG_STRIP, "").slice(0, 5);
    this.syncSlug();
    this.saveDraft();
  }
  private setName(v: string) {
    this.name = v.slice(0, 35);
    this.syncSlug();
    this.saveDraft();
  }
  private setSlug(v: string) {
    this.slugTouched = true;
    this.slug = v
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+/, "")
      .slice(0, 32);
    this.saveDraft();
  }
  // авто-slug = тег-имя (пока юзер сам не правил поле)
  private syncSlug() {
    if (this.slugTouched) return;
    const tagPart = slugifyName(this.tag);
    const namePart = slugifyName(this.name);
    this.slug = [tagPart, namePart].filter(Boolean).join("-").slice(0, 32);
  }

  // --- валидация ---
  private validate(): string | null {
    if (!TAG_RE.test(this.tag))
      return L("Тег: 2–5 символов (буквы/цифры).", "Tag: 2–5 letters/digits.");
    if (this.name.trim().length < 2)
      return L("Введите название.", "Enter a name.");
    if (this.slug.replace(/-/g, "").length < 3)
      return L("URL слишком короткий.", "URL is too short.");
    if (this.description.length > 200)
      return L("Описание ≤ 200 символов.", "Description ≤ 200 chars.");
    return null;
  }

  private async create(currency: "lts" | "pts") {
    if (this.creating) return;
    const err = this.validate();
    if (err) {
      toast(err, "error");
      return;
    }
    this.creating = true;
    try {
      const res = await createClan({
        tag: this.tag,
        slug: this.slug,
        name: this.name.trim(),
        description: this.description,
        nameRu: this.nameRu.trim() || null,
        descriptionRu: this.descriptionRu.trim() || null,
        flag: this.flagUrl || null,
        bracket: this.bracket,
        isOpen: this.joinOpen,
        currency,
      });
      if ("ok" in res) {
        toast(L("Клан создан!", "Clan created!"), "success");
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
        this.resetForm();
        // Редирект на страницу клана (/@<slug>). Полная навигация — надёжно
        // резолвится профиль-страницей в клан-вид (см. ProfilePage).
        softGo("/@" + encodeURIComponent(res.slug));
        return;
      }
      const map: Record<string, string> = {
        tag_taken: L("Тег уже занят.", "Tag already taken."),
        slug_taken: L("Этот адрес уже занят.", "That URL is taken."),
        insufficient_funds: L("Недостаточно средств.", "Insufficient balance."),
        unauthorized: L("Войдите в аккаунт.", "Sign in first."),
        bad_tag: L("Некорректный тег.", "Invalid tag."),
        bad_slug: L("Некорректный адрес.", "Invalid URL."),
        bad_name: L("Некорректное название.", "Invalid name."),
      };
      toast(
        map[res.error] ?? L("Не удалось создать.", "Failed to create."),
        "error",
      );
    } finally {
      this.creating = false;
    }
  }

  private resetForm() {
    this.tag = "";
    this.name = "";
    this.nameRu = "";
    this.slug = "";
    this.description = "";
    this.descriptionRu = "";
    this.flagUrl = "";
    this.slugTouched = false;
    this.bracket = 0;
    this.joinOpen = true;
  }

  // Сохранить правку существующего клана (PATCH; только лидер на сервере).
  private async save() {
    if (this.creating) return;
    const err = this.validate();
    if (err) {
      toast(err, "error");
      return;
    }
    this.creating = true;
    try {
      const res = await editClan(this.editTag, {
        tag: this.tag,
        slug: this.slug,
        name: this.name.trim(),
        description: this.description,
        nameRu: this.nameRu.trim() || null,
        descriptionRu: this.descriptionRu.trim() || null,
        flag: this.flagUrl || null,
        bracket: this.bracket,
        isOpen: this.joinOpen,
      });
      if ("ok" in res) {
        toast(L("Сохранено", "Saved"), "success");
        softGo("/@" + encodeURIComponent(res.slug));
        return;
      }
      const map: Record<string, string> = {
        tag_taken: L("Тег уже занят.", "Tag already taken."),
        slug_taken: L("Этот адрес уже занят.", "That URL is taken."),
        unauthorized: L("Войдите в аккаунт.", "Sign in first."),
        forbidden: L(
          "Редактировать может только лидер.",
          "Only the leader can edit.",
        ),
        not_found: L("Клан не найден.", "Clan not found."),
        bad_tag: L("Некорректный тег.", "Invalid tag."),
        bad_slug: L("Некорректный адрес.", "Invalid URL."),
        bad_name: L("Некорректное название.", "Invalid name."),
      };
      toast(
        map[res.error] ?? L("Не удалось сохранить.", "Failed to save."),
        "error",
      );
    } finally {
      this.creating = false;
    }
  }

  // Заполнить форму существующим кланом (режим правки).
  private prefill(c: ClanFull) {
    this.flagUrl = c.flag ?? "";
    this.tag = c.tag;
    this.slug = c.slug;
    this.name = c.name;
    this.nameRu = c.nameRu ?? "";
    this.description = c.description;
    this.descriptionRu = c.descriptionRu ?? "";
    this.bracket = c.bracket;
    this.joinOpen = c.isOpen;
    this.slugTouched = true; // не перетирать загруженный slug авто-генерацией
    this.editTag = c.tag;
  }

  private cancelEdit() {
    this.close();
    softGo("/@" + encodeURIComponent(this.slug));
  }

  // --- заявки на вступление (лидер одобряет/отклоняет) ---
  private async loadRequests() {
    if (!this.editTag) return;
    const r = await fetchClanRequests(this.editTag);
    this.requests = r ? r.results : [];
  }
  private async approveReq(publicId: string) {
    const r = await approveClanRequest(this.editTag, publicId);
    if (r === true) {
      toast(L("Принят", "Approved"), "success");
      void this.loadRequests();
    } else toast(L("Не удалось", "Failed"), "error");
  }
  private async denyReq(publicId: string) {
    const r = await denyClanRequest(this.editTag, publicId);
    if (r === true) {
      toast(L("Отклонён", "Denied"), "info");
      void this.loadRequests();
    } else toast(L("Не удалось", "Failed"), "error");
  }

  // --- участники (лидер может выгнать) ---
  private async loadMembers() {
    if (!this.editTag) return;
    const r = await fetchClanMembers(this.editTag);
    this.members = r ? r.results : [];
  }
  private async kick(publicId: string) {
    const r = await kickMember(this.editTag, publicId);
    if (r === true) {
      toast(L("Исключён", "Kicked"), "info");
      void this.loadMembers();
    } else toast(L("Не удалось", "Failed"), "error");
  }

  // --- приглашения (лидер зовёт игрока по id/@slug/имени) ---
  private async loadInvites() {
    if (!this.editTag) return;
    this.invites = (await fetchClanInvites(this.editTag)) ?? [];
  }
  private async sendInvite(raw?: string) {
    const id = (raw ?? this.inviteInput).trim();
    if (!id) return;
    const r = await inviteToClan(this.editTag, id);
    if ("ok" in r) {
      toast(
        L(
          `Приглашён: ${r.name || r.publicId}`,
          `Invited: ${r.name || r.publicId}`,
        ),
        "success",
      );
      this.inviteInput = "";
      this.inviteIdInput?.clear();
      void this.loadInvites();
      return;
    }
    const map: Record<string, string> = {
      user_not_found: L("Игрок не найден.", "Player not found."),
      already_member: L("Уже в клане.", "Already a member."),
      forbidden: L("Только лидер.", "Leader only."),
    };
    toast(
      map[r.error] ?? L("Не удалось пригласить.", "Couldn't invite."),
      "error",
    );
  }
  private async cancelInv(publicId: string) {
    const r = await cancelClanInvite(this.editTag, publicId);
    if (r === true) {
      toast(L("Приглашение отозвано", "Invite cancelled"), "info");
      void this.loadInvites();
    } else toast(L("Не удалось", "Failed"), "error");
  }

  // --- черновик в localStorage (только режим создания) ---
  private saveDraft() {
    if (this.isEdit) return; // в правке черновик не трогаем
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          flagUrl: this.flagUrl,
          tag: this.tag,
          bracket: this.bracket,
          name: this.name,
          nameRu: this.nameRu,
          slug: this.slug,
          slugTouched: this.slugTouched,
          description: this.description,
          descriptionRu: this.descriptionRu,
          isOpen: this.joinOpen,
        }),
      );
    } catch {
      /* ignore */
    }
  }
  private loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.flagUrl = d.flagUrl ?? "";
      this.tag = d.tag ?? "";
      this.bracket = d.bracket ?? 0;
      this.name = d.name ?? "";
      this.nameRu = d.nameRu ?? "";
      this.slug = d.slug ?? "";
      this.slugTouched = !!d.slugTouched;
      this.description = d.description ?? "";
      this.descriptionRu = d.descriptionRu ?? "";
      this.joinOpen = d.isOpen ?? true;
    } catch {
      /* ignore */
    }
  }

  protected async onOpen(args?: Record<string, unknown>) {
    const slug = typeof args?.slug === "string" ? args.slug : "";
    // routerName динамический: правка живёт на /clan/<slug>, создание на /clan/new.
    this.routerName = slug ? "clan-edit" : "clan-create";
    this.resetForm();
    this.editTag = "";
    this.requests = [];
    this.members = [];
    this.invites = [];
    this.inviteInput = "";
    if (slug) {
      const c = await fetchClanBySlug(slug);
      if (c) {
        this.prefill(c);
        void this.loadRequests();
        void this.loadMembers();
        void this.loadInvites();
      } else toast(L("Клан не найден.", "Clan not found."), "error");
    } else {
      this.loadDraft();
    }
    const w = await getWallet();
    if (w) {
      this.lts = w.lts;
      this.pts = w.pts;
    }
  }

  protected renderBody(): TemplateResult {
    const b = BRACKETS[this.bracket];
    return html`<div class="t-page clan-create">
      <!-- идентичность одной строкой: (флаг) [тег] имя — как клан в игре -->
      <label class="t-label">${L("Эмблема и название", "Identity")}</label>
      <div class="clan-identity">
        <label
          class="clan-flag-btn"
          title=${L("Загрузить флаг", "Upload flag")}
        >
          ${this.flagUrl
            ? html`<img src=${this.flagUrl} alt="flag" />`
            : html`<span class="ph">${this.flagBusy ? "…" : "＋"}</span>`}
          <input
            type="file"
            accept="image/*"
            hidden
            @change=${(e: Event) => this.onFlagFile(e)}
          />
        </label>
        <div class="clan-tag-wrap">
          <span class="br">${b.l}</span>
          <input
            class="clan-tag-input"
            maxlength="5"
            placeholder="TAG"
            .value=${this.tag}
            @input=${(e: Event) =>
              this.setTag((e.target as HTMLInputElement).value)}
          />
          <span class="br">${b.r}</span>
        </div>
        <input
          class="t-input clan-name-input"
          maxlength="35"
          placeholder=${L(`Название ${CT.gen} (EN)`, `${CT.enCap} name (EN)`)}
          .value=${this.name}
          @input=${(e: Event) =>
            this.setName((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="clan-hint">
        ${L("Так клан выглядит в игре.", "How the clan looks in game.")}
        ${this.flagUrl
          ? html`·
              <button
                class="t-link clan-rm"
                @click=${() => {
                  this.flagUrl = "";
                  this.saveDraft();
                }}
              >
                ${L("убрать флаг", "remove flag")}
              </button>`
          : ""}
      </div>

      <!-- русский перевод имени (опционально; EN-база выше — фолбэк) -->
      <div class="t-field">
        <span class="t-label">${L("Название (RU)", "Name (RU)")}</span>
        <input
          class="t-input"
          maxlength="35"
          placeholder=${L(
            "Русское название — показывается на ru-локали",
            "Russian name — shown to ru-locale players",
          )}
          .value=${this.nameRu}
          @input=${(e: Event) => {
            this.nameRu = (e.target as HTMLInputElement).value;
            this.saveDraft();
          }}
        />
        <div class="t-muted clan-mini">
          ${L(
            "Необязательно. Пусто → показываем английскую базу.",
            "Optional. Empty → the English base name is shown.",
          )}
        </div>
      </div>

      <!-- скобки тега -->
      <div class="clan-row">
        <span class="t-label">${L("Скобки", "Brackets")}</span>
        <div class="clan-brackets">
          ${BRACKETS.map(
            (bb, i) =>
              html`<button
                class="t-btn ${i === this.bracket ? "" : "ghost"} clan-br-btn"
                @click=${() => {
                  this.bracket = i;
                  this.saveDraft();
                }}
              >
                ${bb.l || "—"}${bb.r}
              </button>`,
          )}
        </div>
      </div>

      <!-- адрес -->
      <div class="t-field">
        <span class="t-label">${L("Адрес страницы", "Page URL")}</span>
        <div class="clan-url">
          <span class="t-slug">terron.io/@</span>
          <input
            class="t-input"
            placeholder="fs-fantastic"
            .value=${this.slug}
            @input=${(e: Event) =>
              this.setSlug((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="t-muted clan-mini">
          ${L(
            "⚠ формат tag-имя; схему адресов ещё уточняем.",
            "⚠ tag-name format; address scheme still TBD.",
          )}
        </div>
      </div>

      <!-- описание (EN — база/фолбэк) -->
      <div class="t-field">
        <span class="t-label">${L("Описание (EN)", "Description (EN)")}</span>
        <textarea
          class="t-input"
          rows="2"
          maxlength="200"
          .value=${this.description}
          @input=${(e: Event) => {
            this.description = (e.target as HTMLTextAreaElement).value;
            this.saveDraft();
          }}
        ></textarea>
        <div class="t-label clan-count">${this.description.length}/200</div>
      </div>

      <!-- русский перевод описания (опционально; EN-база выше — фолбэк) -->
      <div class="t-field">
        <span class="t-label">${L("Описание (RU)", "Description (RU)")}</span>
        <textarea
          class="t-input"
          rows="2"
          maxlength="200"
          placeholder=${L(
            "Русское описание — показывается на ru-локали",
            "Russian description — shown to ru-locale players",
          )}
          .value=${this.descriptionRu}
          @input=${(e: Event) => {
            this.descriptionRu = (e.target as HTMLTextAreaElement).value;
            this.saveDraft();
          }}
        ></textarea>
        <div class="t-label clan-count">${this.descriptionRu.length}/200</div>
      </div>

      <!-- вступление -->
      <div class="clan-row">
        <span class="t-label">${L("Вступление", "Joining")}</span>
        <div class="clan-join">
          <button
            class="t-btn ${this.joinOpen ? "" : "ghost"}"
            @click=${() => {
              this.joinOpen = true;
              this.saveDraft();
            }}
          >
            ${L("Открытый", "Open")}
          </button>
          <button
            class="t-btn ${this.joinOpen ? "ghost" : ""}"
            @click=${() => {
              this.joinOpen = false;
              this.saveDraft();
            }}
          >
            ${L("По заявке", "Invite-only")}
          </button>
        </div>
      </div>

      ${this.isEdit
        ? html`<h3 class="t-h3">
              ${L("Заявки на вступление", "Join requests")}
            </h3>
            ${this.requests.length === 0
              ? html`<div class="t-muted clan-mini">
                  ${L("Заявок нет.", "No requests.")}
                </div>`
              : html`<div class="clan-req-list">
                  ${this.requests.map(
                    (rq) =>
                      html`<div class="clan-req">
                        <a
                          class="clan-req-id"
                          href="/@${rq.publicId}"
                          @click=${(e: Event) => {
                            e.preventDefault();
                            softGo("/@" + encodeURIComponent(rq.publicId));
                          }}
                          >@${rq.publicId}</a
                        >
                        <div class="clan-req-act">
                          <button
                            class="t-btn"
                            style="padding:5px 12px"
                            @click=${() => this.approveReq(rq.publicId)}
                          >
                            ${L("Принять", "Approve")}
                          </button>
                          <button
                            class="t-btn ghost"
                            style="padding:5px 12px"
                            @click=${() => this.denyReq(rq.publicId)}
                          >
                            ${L("Отклонить", "Deny")}
                          </button>
                        </div>
                      </div>`,
                  )}
                </div>`}`
        : ""}
      ${this.isEdit
        ? html`<h3 class="t-h3">${L("Участники", "Members")}</h3>
            <div class="clan-req-list">
              ${this.members.map(
                (m) =>
                  html`<div class="clan-req">
                    <span class="clan-req-id">
                      ${m.name ? html`<b>${m.name}</b> ` : ""}@${m.publicId}
                      ${m.role === "leader"
                        ? html`<span class="t-muted">
                            · ${L("лидер", "leader")}</span
                          >`
                        : ""}
                    </span>
                    ${m.role === "leader"
                      ? ""
                      : html`<div class="clan-req-act">
                          <button
                            class="t-btn ghost"
                            style="padding:5px 12px"
                            @click=${() => this.kick(m.publicId)}
                          >
                            ${L("Исключить", "Kick")}
                          </button>
                        </div>`}
                  </div>`,
              )}
            </div>`
        : ""}
      ${this.isEdit
        ? html`<h3 class="t-h3">${L("Пригласить игрока", "Invite player")}</h3>
            <identifier-input
              .placeholder=${L(
                "id (1004), имя или @url",
                "id (1004), name or @url",
              )}
              .buttonLabel=${L("Пригласить", "Invite")}
              @submit=${(e: CustomEvent) => this.sendInvite(e.detail.value)}
            ></identifier-input>
            ${this.invites.length > 0
              ? html`<div class="clan-req-list" style="margin-top:10px">
                  ${this.invites.map(
                    (iv) =>
                      html`<div class="clan-req">
                        <span class="clan-req-id">
                          ${iv.name
                            ? html`<b>${iv.name}</b> `
                            : ""}@${iv.publicId}
                          <span class="t-muted">
                            · ${L("приглашён", "invited")}</span
                          >
                        </span>
                        <div class="clan-req-act">
                          <button
                            class="t-btn ghost"
                            style="padding:5px 12px"
                            @click=${() => this.cancelInv(iv.publicId)}
                          >
                            ${L("Отозвать", "Cancel")}
                          </button>
                        </div>
                      </div>`,
                  )}
                </div>`
              : ""}`
        : ""}

      <!-- футер: правка → Сохранить/Отмена; создание → цена + оплата -->
      <div class="clan-create-foot">
        ${this.isEdit
          ? html`<div style="display:flex;gap:8px">
              <button
                class="t-btn"
                ?disabled=${this.creating}
                @click=${() => this.save()}
              >
                ${this.creating
                  ? L("Сохранение…", "Saving…")
                  : L("Сохранить", "Save")}
              </button>
              <button class="t-btn ghost" @click=${() => this.cancelEdit()}>
                ${L("Отмена", "Cancel")}
              </button>
            </div>`
          : html`<div class="t-muted clan-mini">
                ${L(
                  `Первый ${CT.nom} — ${FIRST_CLAN_PRICE} золота или серебра.`,
                  `First ${CT.en} — ${FIRST_CLAN_PRICE} gold or silver.`,
                )}
              </div>
              <div class="shop-split">
                <button
                  class="shop-half lts"
                  ?disabled=${this.creating}
                  @click=${() => this.create("lts")}
                >
                  ${FIRST_CLAN_PRICE} ${coin("lts")}
                </button>
                <button
                  class="shop-half pts"
                  ?disabled=${this.creating}
                  @click=${() => this.create("pts")}
                >
                  ${FIRST_CLAN_PRICE} ${coin("pts")}
                </button>
              </div>`}
      </div>
    </div>`;
  }
}

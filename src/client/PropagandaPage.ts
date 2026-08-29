import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  adminDeletePropagandaBanner,
  adminUploadPropagandaBanner,
  deleteScreenshot,
  getMyScreenshots,
  getPropagandaBanners,
  getPublicScreenshots,
  getUserMe,
  isMeAdmin,
  publishScreenshot,
  type PropagandaBanner,
  type Screenshot,
} from "./Api";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { confirmDialog, toast } from "./Toast";
import { L, translateText } from "./Utils";

// Тип рамки-оверлея на скриншот (дропдаун). Центр прозрачный, оверлей поверх.
type FrameType = "none" | "frame" | "frame_vignette" | "vignette";
const PUBLISH_COST = 1000; // ЛТС за публикацию скрина в общую галерею

// terron: /propaganda — «пресскит + пинтерест баннеров». Две вкладки:
//  • «Баннеры» — галерея он-брендовых баннеров под популярные соц-форматы,
//    рисуются программно (SVG в стиле штабной карты), скачиваются PNG/SVG.
//  • «Тексты» — готовые слоганы / описания / хэштеги с копированием.
// Фаза 1: генерация + галерея + тексты. Фаза 2 (позже): админ-загрузка чужих
// картинок (реиспользуем форму скинов), кнопка-фотик в игре.

type View = "banners" | "texts" | "shots";

// Популярные форматы баннеров/соцсетей (w×h в px = натуральный размер PNG).
interface Fmt {
  id: string;
  w: number;
  h: number;
  label: string; // где применяется
}

// Один баннер галереи = формат + слоган + стиль (инверсия фона).
interface BannerItem {
  key: string;
  fmt: Fmt;
  slogan: string;
  invert: boolean;
}

const FORMATS: Record<string, Fmt> = {
  wide: { id: "wide", w: 1920, h: 1080, label: L("Широкий баннер 16:9", "Wide banner 16:9") },
  sq: { id: "sq", w: 1080, h: 1080, label: L("Пост · VK · Instagram", "Post · VK · Instagram") },
  story: { id: "story", w: 1080, h: 1920, label: L("Сторис · Reels · Shorts · TikTok", "Story · Reels · Shorts · TikTok") },
  yt: { id: "yt", w: 1280, h: 720, label: L("Превью YouTube", "YouTube thumbnail") },
  x: { id: "x", w: 1500, h: 500, label: L("Шапка X (Twitter)", "X (Twitter) header") },
  og: { id: "og", w: 1200, h: 630, label: L("Превью ссылки (OG)", "Link preview (OG)") },
  tg: { id: "tg", w: 800, h: 450, label: L("Пост в Telegram", "Telegram post") },
};

@customElement("propaganda-page")
export class PropagandaPage extends BaseModal {
  @state() private view: View = "banners";

  // Загруженные админом баннеры (публичная галерея) + админ-состояние загрузки.
  @state() private uploaded: PropagandaBanner[] = [];
  @state() private isAdmin = false;
  @state() private staged: {
    dataUrl: string;
    width: number;
    height: number;
    title: string;
  } | null = null;
  @state() private uploading = false;
  @state() private urlInput = "";
  @state() private dragOver = false;
  private loaded = false;

  // Скриншоты: под-вкладка «Все/Мои», выбор рамки, данные.
  @state() private shotView: "all" | "mine" = "all";
  @state() private frame: FrameType = "none";
  @state() private publicShots: Screenshot[] = [];
  @state() private myShots: Screenshot[] = [];
  @state() private loggedIn = false;
  @state() private publishing: string | null = null;

  protected onOpen(): void {
    if (this.loaded) return;
    this.loaded = true;
    void this.loadUploaded();
    void isMeAdmin().then((a) => (this.isAdmin = a));
    void getUserMe().then((me) => {
      this.loggedIn = !!me;
      if (me) void this.loadMyShots();
    });
    void this.loadPublicShots();
  }

  private async loadUploaded(): Promise<void> {
    this.uploaded = await getPropagandaBanners();
  }
  private async loadPublicShots(): Promise<void> {
    this.publicShots = await getPublicScreenshots();
  }
  private async loadMyShots(): Promise<void> {
    this.myShots = await getMyScreenshots();
  }

  private async publishShot(shot: Screenshot): Promise<void> {
    if (this.publishing) return;
    const ok = await confirmDialog(
      L(
        `Опубликовать скрин в общую галерею за ${PUBLISH_COST} ЛТС?`,
        `Publish this screenshot to the public gallery for ${PUBLISH_COST} LTS?`,
      ),
      L("Опубликовать", "Publish"),
      L("Отмена", "Cancel"),
    );
    if (!ok) return;
    this.publishing = shot.id;
    const res = await publishScreenshot(shot.id);
    this.publishing = null;
    if (res.ok) {
      toast(L("Опубликовано", "Published"), "success");
      await Promise.all([this.loadMyShots(), this.loadPublicShots()]);
    } else if (res.error === "insufficient") {
      toast(
        L(
          `Не хватает ЛТС (нужно ${PUBLISH_COST})`,
          `Not enough LTS (need ${PUBLISH_COST})`,
        ),
        "error",
      );
    } else {
      toast(L("Не удалось опубликовать", "Publish failed"), "error");
    }
  }

  private async removeShot(shot: Screenshot): Promise<void> {
    const ok = await confirmDialog(
      L("Удалить скрин?", "Delete screenshot?"),
      L("Удалить", "Delete"),
      L("Отмена", "Cancel"),
    );
    if (!ok) return;
    if (!(await deleteScreenshot(shot.id))) {
      toast(L("Не удалось удалить", "Delete failed"), "error");
      return;
    }
    this.myShots = this.myShots.filter((s) => s.id !== shot.id);
    this.publicShots = this.publicShots.filter((s) => s.id !== shot.id);
    toast(L("Удалено", "Deleted"), "success");
  }

  // Скачать скрин с наложенной рамкой (или без — frame="none").
  private async downloadShot(shot: Screenshot): Promise<void> {
    try {
      const blob = await composeWithFrame(
        shot.dataUrl,
        shot.width,
        shot.height,
        this.frame,
      );
      triggerDownload(blob, `terron-shot-${shot.width}x${shot.height}.png`);
      toast(L("Скачано", "Downloaded"), "success");
    } catch {
      toast(L("Не удалось скачать", "Download failed"), "error");
    }
  }

  private setView(v: View): void {
    if (this.view === v) return;
    this.view = v;
  }

  // ---- админ-загрузка (как у скинов: файл / ссылка / вставка ⌘V / перетаскивание) ----
  private onPickFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.stageFile(file);
    input.value = "";
  }

  private async stageFile(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      toast(L("Это не картинка", "Not an image"), "error");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onerror = () => rej(new Error("read"));
        r.onload = () => res(String(r.result ?? ""));
        r.readAsDataURL(file);
      });
      await this.stageSrc(dataUrl, file.name.replace(/\.[a-z0-9]+$/i, ""));
    } catch {
      toast(L("Не удалось прочитать файл", "Couldn't read file"), "error");
    }
  }

  private async stageFromUrl(): Promise<void> {
    const u = this.urlInput.trim();
    if (!/^https?:\/\//i.test(u) && !u.startsWith("data:")) {
      toast(
        L("Нужна ссылка http(s) на картинку", "Need an http(s) image link"),
        "error",
      );
      return;
    }
    await this.stageSrc(u, "");
    this.urlInput = "";
  }

  // Грузим из data-URL/URL → нормализуем через canvas в webp (≤2560 по длинной
  // стороне), чтобы влезть в лимит и не тащить гигантские PNG. Для чужих URL —
  // crossOrigin (иначе canvas «протухнет» и toDataURL кинет).
  private async stageSrc(src: string, title: string): Promise<void> {
    try {
      const img = new Image();
      if (/^https?:/i.test(src)) img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("img"));
        img.src = src;
      });
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const sc = Math.min(1, 2560 / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * sc));
      const h = Math.max(1, Math.round(ih * sc));
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      cv.getContext("2d")!.drawImage(img, 0, 0, w, h);
      this.staged = {
        dataUrl: cv.toDataURL("image/webp", 0.92),
        width: w,
        height: h,
        title,
      };
    } catch {
      toast(
        L(
          "Не удалось загрузить картинку (CORS?). Скачай и выбери файлом.",
          "Couldn't load image (CORS?). Download and pick as a file.",
        ),
        "error",
      );
    }
  }

  private onDropUpload(e: DragEvent): void {
    e.preventDefault();
    this.dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      void this.stageFile(file);
      return;
    }
    const url =
      e.dataTransfer?.getData("text/uri-list") ||
      e.dataTransfer?.getData("text/plain");
    if (url && /^https?:\/\//i.test(url.trim())) {
      this.urlInput = url.trim();
      void this.stageFromUrl();
    }
  }

  // Вставка ⌘/Ctrl+V — картинка или ссылка. Слушаем, пока открыта наша страница
  // на вкладке «Баннеры» и юзер админ.
  private onPaste = (e: ClipboardEvent): void => {
    if (!this.isAdmin || this.view !== "banners") return;
    if (this.classList.contains("hidden")) return;
    const pageId = (window as unknown as { currentPageId?: string })
      .currentPageId;
    if (pageId && pageId !== "page-propaganda") return;
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
      this.urlInput = text;
      void this.stageFromUrl();
    }
  };

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("paste", this.onPaste);
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("paste", this.onPaste);
  }

  private async submitUpload(): Promise<void> {
    if (!this.staged || this.uploading) return;
    this.uploading = true;
    const res = await adminUploadPropagandaBanner({
      title: this.staged.title,
      dataUrl: this.staged.dataUrl,
      width: this.staged.width,
      height: this.staged.height,
    });
    this.uploading = false;
    if (res) {
      toast(L("Загружено", "Uploaded"), "success");
      this.staged = null;
      await this.loadUploaded();
    } else {
      toast(L("Не удалось загрузить", "Upload failed"), "error");
    }
  }

  private async removeUploaded(id: string): Promise<void> {
    if (!(await adminDeletePropagandaBanner(id))) {
      toast(L("Не удалось удалить", "Delete failed"), "error");
      return;
    }
    this.uploaded = this.uploaded.filter((b) => b.id !== id);
    toast(L("Удалено", "Deleted"), "success");
  }

  private async downloadUploaded(b: PropagandaBanner): Promise<void> {
    try {
      const blob = await (await fetch(b.dataUrl)).blob();
      const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
      triggerDownload(blob, `terron-${b.width}x${b.height}.${ext}`);
      toast(L("Скачано", "Downloaded"), "success");
    } catch {
      toast(L("Не удалось скачать", "Download failed"), "error");
    }
  }

  // ---- содержимое галереи (слоганы захардкожены, следуют языку сайта) ----
  private get banners(): BannerItem[] {
    const S = {
      front: L("Захвати свой фронт", "Seize your front"),
      world: L("Один мир. Твоя армия.", "One world. Your army."),
      free: L("Играй бесплатно", "Play free"),
      rts: L("Стратегия в реальном времени", "Real-time strategy"),
      brand: "TERRON.IO",
      three: L("Захватывай. Расширяйся. Побеждай.", "Conquer. Expand. Win."),
      join: L("Вступай в бой", "Join the battle"),
      noreg: L("RTS без регистрации", "RTS, no signup"),
    };
    const list: [Fmt, string, boolean][] = [
      [FORMATS.wide, S.front, false],
      [FORMATS.sq, S.world, true],
      [FORMATS.story, S.free, false],
      [FORMATS.yt, S.rts, true],
      [FORMATS.x, S.brand, false],
      [FORMATS.og, S.three, false],
      [FORMATS.tg, S.join, true],
      [FORMATS.sq, S.noreg, false],
    ];
    return list.map(([fmt, slogan, invert], i) => ({
      key: `${fmt.id}-${i}`,
      fmt,
      slogan,
      invert,
    }));
  }

  // ---- генератор SVG-баннера (штабная карта: рамка/компас/кольца/штамп) ----
  private bannerSvg(fmt: Fmt, slogan: string, invert: boolean): string {
    const { w, h } = fmt;
    const minD = Math.min(w, h);
    const pad = Math.round(minD * 0.055);
    const bg = invert ? "#2b2a24" : "#efe6c8";
    const ink = invert ? "#efe6c8" : "#2b2a24";
    const inkSoft = invert ? "rgba(239,230,200,0.6)" : "rgba(43,42,36,0.6)";
    const red = "#c25a3f"; // чуть светлее --t-red для читабельности на тёмном
    const cx = w / 2;

    const titleF = Math.min(minD * 0.3, (w - pad * 2) / 3.5);
    const titleY = h * 0.46;
    const barW = Math.min(w * 0.62, titleF * 3.2);
    const barH = Math.max(4, Math.round(minD * 0.02));
    const barY = titleY + titleF * 0.16;
    const sF = Math.min(minD * 0.07, (w - pad * 2) / (slogan.length * 0.52));
    const sloganY = titleY + titleF * 0.5 + sF;
    const footF = Math.round(minD * 0.05);
    const stroke = Math.max(2, Math.round(minD * 0.006));

    // перенос слогана максимум в 2 строки
    const maxChars = Math.max(6, Math.floor((w - pad * 2) / (sF * 0.52)));
    const words = slogan.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const wd of words) {
      if ((cur + " " + wd).trim().length > maxChars && cur) {
        lines.push(cur);
        cur = wd;
      } else cur = (cur + " " + wd).trim();
    }
    if (cur) lines.push(cur);
    const sLines = lines.slice(0, 2);
    const sloganTspans = sLines
      .map(
        (ln, i) =>
          `<tspan x="${cx}" dy="${i === 0 ? 0 : sF * 1.12}">${esc(ln)}</tspan>`,
      )
      .join("");

    // декор: градусные засечки по верхней кромке
    const tickCount = Math.round(w / (minD * 0.09));
    let ticks = "";
    for (let i = 0; i <= tickCount; i++) {
      const x = pad + ((w - pad * 2) * i) / tickCount;
      const long = i % 5 === 0;
      ticks += `<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad + (long ? minD * 0.03 : minD * 0.016)}" stroke="${ink}" stroke-width="${stroke * 0.6}" opacity="0.5"/>`;
    }

    // компас (верх-право)
    const compR = minD * 0.06;
    const compCx = w - pad - compR - minD * 0.02;
    const compCy = pad + compR + minD * 0.02;
    const compass = `
      <g opacity="0.9">
        <circle cx="${compCx}" cy="${compCy}" r="${compR}" fill="none" stroke="${ink}" stroke-width="${stroke * 0.7}"/>
        <polygon points="${compCx},${compCy - compR * 0.7} ${compCx - compR * 0.22},${compCy} ${compCx},${compCy - compR * 0.15} ${compCx + compR * 0.22},${compCy}" fill="${red}"/>
        <text x="${compCx}" y="${compCy - compR - minD * 0.008}" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="${compR * 0.7}" fill="${ink}">N</text>
      </g>`;

    // концентрические кольца (низ-лево)
    const ringCx = pad + minD * 0.02;
    const ringCy = h - pad - minD * 0.02;
    let rings = "";
    for (let i = 1; i <= 3; i++) {
      rings += `<circle cx="${ringCx}" cy="${ringCy}" r="${minD * 0.05 * i}" fill="none" stroke="${ink}" stroke-width="${stroke * 0.6}" opacity="0.12"/>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="width:100%;height:auto;display:block" preserveAspectRatio="xMidYMid meet" font-family="'Oswald','Arial Narrow',Impact,sans-serif">
  <rect x="0" y="0" width="${w}" height="${h}" fill="${bg}"/>
  <rect x="${pad * 0.6}" y="${pad * 0.6}" width="${w - pad * 1.2}" height="${h - pad * 1.2}" fill="none" stroke="${ink}" stroke-width="${stroke}"/>
  ${ticks}
  ${rings}
  ${compass}
  <text x="${cx}" y="${titleY}" text-anchor="middle" font-size="${titleF}" font-weight="700" letter-spacing="${titleF * 0.02}" fill="${ink}">TERRON</text>
  <rect x="${cx - barW / 2}" y="${barY}" width="${barW}" height="${barH}" fill="${red}"/>
  <text x="${cx}" y="${sloganY}" text-anchor="middle" font-size="${sF}" font-weight="500" fill="${ink}" font-family="'IBM Plex Mono', monospace">${sloganTspans}</text>
  <text x="${pad}" y="${h - pad}" font-family="'IBM Plex Mono', monospace" font-size="${footF}" font-weight="700" fill="${red}">terron.io</text>
  <text x="${w - pad}" y="${h - pad}" text-anchor="end" font-family="'IBM Plex Mono', monospace" font-size="${footF * 0.8}" fill="${inkSoft}">${esc(L("ШТАБ · играй бесплатно", "HQ · play free"))}</text>
</svg>`;
  }

  private async download(item: BannerItem, kind: "png" | "svg"): Promise<void> {
    const svg = this.bannerSvg(item.fmt, item.slogan, item.invert);
    const name = `terron-${item.fmt.id}-${item.fmt.w}x${item.fmt.h}`;
    try {
      if (kind === "svg") {
        triggerDownload(
          new Blob([svg], { type: "image/svg+xml" }),
          `${name}.svg`,
        );
      } else {
        const blob = await svgToPng(svg, item.fmt.w, item.fmt.h);
        triggerDownload(blob, `${name}.png`);
      }
      toast(L("Скачано", "Downloaded"), "success");
    } catch {
      toast(L("Не удалось скачать", "Download failed"), "error");
    }
  }

  // Постеры-омаж (Юрий, RA2) — стилизованные SVG, без реальной картинки.
  private get posters(): {
    key: string;
    w: number;
    h: number;
    label: string;
    svg: string;
  }[] {
    return [
      {
        key: "yuri1",
        w: 1080,
        h: 1350,
        label: L("Постер: псионик I", "Poster: psychic I"),
        svg: yuriPosterSvg(0),
      },
      {
        key: "yuri2",
        w: 1080,
        h: 1350,
        label: L("Постер: псионик II", "Poster: psychic II"),
        svg: yuriPosterSvg(1),
      },
    ];
  }

  private async downloadRawSvg(
    svg: string,
    w: number,
    h: number,
    name: string,
    kind: "png" | "svg",
  ): Promise<void> {
    try {
      if (kind === "svg") {
        triggerDownload(new Blob([svg], { type: "image/svg+xml" }), `${name}.svg`);
      } else {
        triggerDownload(await svgToPng(svg, w, h), `${name}.png`);
      }
      toast(L("Скачано", "Downloaded"), "success");
    } catch {
      toast(L("Не удалось скачать", "Download failed"), "error");
    }
  }

  private renderPosterCard(p: {
    key: string;
    w: number;
    h: number;
    label: string;
    svg: string;
  }): TemplateResult {
    return html`<figure
      style="break-inside:avoid;margin:0 0 14px;border:1px solid var(--t-ink);background:var(--t-sheet);display:inline-block;width:100%"
    >
      <div style="line-height:0">${unsafeHTML(p.svg)}</div>
      <figcaption style="padding:8px 10px;border-top:1px solid var(--t-ink)">
        <div style="font-size:12.5px;color:var(--t-ink);font-weight:600">
          ${p.label}
        </div>
        <div
          style="font-size:11px;color:var(--t-ink-soft,rgba(43,42,36,.6));font-family:var(--t-mono,monospace);margin-bottom:8px"
        >
          ${p.w}×${p.h}
        </div>
        <div style="display:flex;gap:6px">
          <button
            class="t-btn"
            style="flex:1;padding:5px 8px;font-size:12px;background:var(--t-ink);color:var(--t-parchment,#fff)"
            @click=${() =>
              this.downloadRawSvg(p.svg, p.w, p.h, `terron-${p.key}`, "png")}
          >
            ${L("Скачать PNG", "Download PNG")}
          </button>
          <button
            class="t-btn"
            style="padding:5px 8px;font-size:12px;background:var(--t-sheet);color:var(--t-ink)"
            @click=${() =>
              this.downloadRawSvg(p.svg, p.w, p.h, `terron-${p.key}`, "svg")}
          >
            SVG
          </button>
        </div>
      </figcaption>
    </figure>`;
  }

  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast(L("Скопировано", "Copied"), "success");
    } catch {
      toast(L("Не удалось скопировать", "Copy failed"), "error");
    }
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: L("Пропаганда", "Propaganda"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent: html`<div style="display:flex;gap:6px">
        ${this.pill(this.view === "banners", L("Баннеры", "Banners"), () =>
          this.setView("banners"),
        )}
        ${this.pill(this.view === "shots", L("Скриншоты", "Screenshots"), () =>
          this.setView("shots"),
        )}
        ${this.pill(this.view === "texts", L("Тексты", "Texts"), () =>
          this.setView("texts"),
        )}
      </div>`,
    });
  }

  private pill(active: boolean, label: string, onClick: () => void) {
    return html`<button
      class="t-btn"
      style=${`padding:5px 12px;font-size:13px;${
        active
          ? "background:var(--t-ink);color:var(--t-parchment,#fff)"
          : "background:var(--t-sheet);color:var(--t-ink)"
      }`}
      @click=${onClick}
    >
      ${label}
    </button>`;
  }

  protected renderBody(): TemplateResult {
    return html`<div class="t-page" style="max-width:1080px">
      <p
        class="t-muted"
        style="font-size:12.5px;line-height:1.5;margin-bottom:14px"
      >
        ${L(
          "Помоги Террону расти: бери баннеры и тексты, публикуй где угодно — свои соцсети, каналы, форумы. Всё бесплатно и без ограничений.",
          "Help Terron grow: grab banners and copy, post them anywhere — your socials, channels, forums. Free to use, no strings attached.",
        )}
      </p>
      ${this.view === "banners"
        ? this.renderBanners()
        : this.view === "shots"
          ? this.renderShots()
          : this.renderTexts()}
    </div>`;
  }

  // ---- вкладка «Скриншоты»: под-вкладки Все/Мои + дропдаун рамки ----
  private renderShots(): TemplateResult {
    const shots = this.shotView === "all" ? this.publicShots : this.myShots;
    const frameOptions: { v: FrameType; label: string }[] = [
      { v: "none", label: L("Без рамки", "No frame") },
      { v: "frame", label: L("Рамка", "Frame") },
      { v: "frame_vignette", label: L("Рамка + виньетка", "Frame + vignette") },
      { v: "vignette", label: L("Виньетка", "Vignette") },
    ];
    return html`
      <div
        style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px"
      >
        <div style="display:flex;gap:6px">
          ${this.pill(this.shotView === "all", L("Все", "All"), () => {
            this.shotView = "all";
          })}
          ${this.pill(this.shotView === "mine", L("Мои", "Mine"), () => {
            this.shotView = "mine";
          })}
        </div>
        <div style="flex:1"></div>
        <label
          style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--t-ink)"
        >
          ${L("Рамка", "Frame")}:
          <select
            @change=${(e: Event) =>
              (this.frame = (e.target as HTMLSelectElement).value as FrameType)}
            style="padding:5px 8px;border:1px solid var(--t-ink);background:var(--t-parchment,#fff);color:var(--t-ink);font-size:12.5px"
          >
            ${frameOptions.map(
              (o) =>
                html`<option value=${o.v} ?selected=${this.frame === o.v}>
                  ${o.label}
                </option>`,
            )}
          </select>
        </label>
      </div>
      ${this.shotView === "mine" && !this.loggedIn
        ? html`<div class="t-muted" style="padding:20px 0">
            ${L(
              "Войдите, чтобы делать скриншоты в игре и собирать альбом.",
              "Sign in to take in-game screenshots and build your album.",
            )}
          </div>`
        : shots.length === 0
          ? html`<div class="t-muted" style="padding:20px 0">
              ${this.shotView === "mine"
                ? L(
                    "Пусто. Жми кнопку-фотик в игре — скрин попадёт сюда.",
                    "Empty. Hit the camera button in-game — the shot lands here.",
                  )
                : L(
                    "Пока никто ничего не опубликовал.",
                    "Nobody has published anything yet.",
                  )}
            </div>`
          : html`<div style="column-gap:14px;column-count:3;" class="propaganda-grid">
              ${shots.map((s) => this.renderShotCard(s))}
            </div>
            <style>
              @media (max-width: 820px) {
                .propaganda-grid {
                  column-count: 2 !important;
                }
              }
              @media (max-width: 520px) {
                .propaganda-grid {
                  column-count: 1 !important;
                }
              }
            </style>`}
    `;
  }

  private renderShotCard(s: Screenshot): TemplateResult {
    const mine = this.shotView === "mine";
    const overlay = frameOverlaySvg(s.width, s.height, this.frame);
    return html`<figure
      style="break-inside:avoid;margin:0 0 14px;border:1px solid var(--t-ink);background:var(--t-sheet);display:inline-block;width:100%"
    >
      <div style="position:relative;line-height:0">
        <img
          src=${s.dataUrl}
          alt="screenshot"
          loading="lazy"
          style="width:100%;height:auto;display:block"
        />
        ${overlay
          ? html`<div
              style="position:absolute;inset:0;pointer-events:none"
            >
              ${unsafeHTML(overlay)}
            </div>`
          : ""}
      </div>
      <figcaption style="padding:8px 10px;border-top:1px solid var(--t-ink)">
        <div
          style="font-size:11px;color:var(--t-ink-soft,rgba(43,42,36,.6));font-family:var(--t-mono,monospace);margin-bottom:8px"
        >
          ${s.width}×${s.height}${s.author && !mine
            ? html` · ${s.author.name || "#" + (s.author.number ?? "")}`
            : ""}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button
            class="t-btn"
            style="flex:1;padding:5px 8px;font-size:12px;background:var(--t-ink);color:var(--t-parchment,#fff)"
            @click=${() => this.downloadShot(s)}
          >
            ${L("Скачать", "Download")}
          </button>
          ${mine && !s.published
            ? html`<button
                class="t-btn"
                ?disabled=${this.publishing === s.id}
                style="padding:5px 8px;font-size:12px;background:var(--t-sheet);color:var(--t-ink)"
                @click=${() => this.publishShot(s)}
              >
                ${this.publishing === s.id
                  ? L("…", "…")
                  : L(`В галерею · ${PUBLISH_COST} ЛТС`, `Publish · ${PUBLISH_COST} LTS`)}
              </button>`
            : ""}
          ${mine && s.published
            ? html`<span
                style="padding:5px 8px;font-size:12px;color:var(--t-ink-soft,rgba(43,42,36,.6))"
                >${L("В галерее", "Published")}</span
              >`
            : ""}
          ${mine
            ? html`<button
                class="t-btn"
                style="padding:5px 8px;font-size:12px;background:var(--t-sheet);color:var(--t-red,#a8432b)"
                title=${L("Удалить", "Delete")}
                @click=${() => this.removeShot(s)}
              >
                ✕
              </button>`
            : ""}
        </div>
      </figcaption>
    </figure>`;
  }

  private renderBanners(): TemplateResult {
    return html`
      ${this.isAdmin ? this.renderAdminUpload() : ""}
      <div style="column-gap:14px;column-count:3;" class="propaganda-grid">
        ${this.uploaded.map((b) => this.renderUploadedCard(b))}
        ${this.posters.map((p) => this.renderPosterCard(p))}
        ${this.banners.map((item) => this.renderGeneratedCard(item))}
      </div>
      <style>
        @media (max-width: 820px) {
          .propaganda-grid {
            column-count: 2 !important;
          }
        }
        @media (max-width: 520px) {
          .propaganda-grid {
            column-count: 1 !important;
          }
        }
      </style>
    `;
  }

  private renderGeneratedCard(item: BannerItem): TemplateResult {
    const svg = this.bannerSvg(item.fmt, item.slogan, item.invert);
    return html`<figure
      style="break-inside:avoid;margin:0 0 14px;border:1px solid var(--t-ink);background:var(--t-sheet);display:inline-block;width:100%"
    >
      <div style="line-height:0">${unsafeHTML(svg)}</div>
      <figcaption style="padding:8px 10px;border-top:1px solid var(--t-ink)">
        <div style="font-size:12.5px;color:var(--t-ink);font-weight:600">
          ${item.fmt.label}
        </div>
        <div
          style="font-size:11px;color:var(--t-ink-soft,rgba(43,42,36,.6));font-family:var(--t-mono,monospace);margin-bottom:8px"
        >
          ${item.fmt.w}×${item.fmt.h}
        </div>
        <div style="display:flex;gap:6px">
          <button
            class="t-btn"
            style="flex:1;padding:5px 8px;font-size:12px;background:var(--t-ink);color:var(--t-parchment,#fff)"
            @click=${() => this.download(item, "png")}
          >
            ${L("Скачать PNG", "Download PNG")}
          </button>
          <button
            class="t-btn"
            style="padding:5px 8px;font-size:12px;background:var(--t-sheet);color:var(--t-ink)"
            @click=${() => this.download(item, "svg")}
          >
            SVG
          </button>
        </div>
      </figcaption>
    </figure>`;
  }

  private renderUploadedCard(b: PropagandaBanner): TemplateResult {
    return html`<figure
      style="break-inside:avoid;margin:0 0 14px;border:1px solid var(--t-ink);background:var(--t-sheet);display:inline-block;width:100%"
    >
      <img
        src=${b.dataUrl}
        alt=${b.title}
        loading="lazy"
        style="width:100%;height:auto;display:block"
      />
      <figcaption style="padding:8px 10px;border-top:1px solid var(--t-ink)">
        <div
          style="font-size:12.5px;color:var(--t-ink);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        >
          ${b.title || L("Баннер", "Banner")}
        </div>
        <div
          style="font-size:11px;color:var(--t-ink-soft,rgba(43,42,36,.6));font-family:var(--t-mono,monospace);margin-bottom:8px"
        >
          ${b.width}×${b.height}
        </div>
        <div style="display:flex;gap:6px">
          <button
            class="t-btn"
            style="flex:1;padding:5px 8px;font-size:12px;background:var(--t-ink);color:var(--t-parchment,#fff)"
            @click=${() => this.downloadUploaded(b)}
          >
            ${L("Скачать", "Download")}
          </button>
          ${this.isAdmin
            ? html`<button
                class="t-btn"
                style="padding:5px 8px;font-size:12px;background:var(--t-sheet);color:var(--t-red,#a8432b)"
                title=${L("Удалить", "Delete")}
                @click=${() => this.removeUploaded(b.id)}
              >
                ✕
              </button>`
            : ""}
        </div>
      </figcaption>
    </figure>`;
  }

  // Панель загрузки (только админ). Форма как у скинов: файл → превью → размеры
  // (автоопределяются) + название → «Загрузить».
  private renderAdminUpload(): TemplateResult {
    return html`<div
      @dragover=${(e: DragEvent) => {
        e.preventDefault();
        this.dragOver = true;
      }}
      @dragleave=${() => (this.dragOver = false)}
      @drop=${(e: DragEvent) => this.onDropUpload(e)}
      style="border:1px dashed var(--t-ink);background:${this.dragOver
        ? "rgba(43,42,36,0.08)"
        : "var(--t-sheet)"};padding:12px;margin-bottom:16px"
    >
      <div
        style="font-family:var(--t-display,Oswald);font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--t-ink);margin-bottom:8px"
      >
        ${L("Загрузить баннер (админ)", "Upload banner (admin)")}
      </div>
      ${this.staged
        ? html`<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">
            <img
              src=${this.staged.dataUrl}
              alt="preview"
              style="max-width:200px;max-height:140px;border:1px solid var(--t-ink)"
            />
            <div style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:8px">
              <label
                style="font-size:12px;color:var(--t-ink);display:flex;flex-direction:column;gap:4px"
              >
                ${L("Название", "Title")}
                <input
                  type="text"
                  .value=${this.staged.title}
                  @input=${(e: Event) => {
                    if (this.staged)
                      this.staged = {
                        ...this.staged,
                        title: (e.target as HTMLInputElement).value,
                      };
                  }}
                  style="padding:6px 8px;border:1px solid var(--t-ink);background:var(--t-parchment,#fff);color:var(--t-ink);font-size:13px"
                />
              </label>
              <div
                style="font-size:12px;color:var(--t-ink-soft,rgba(43,42,36,.6));font-family:var(--t-mono,monospace)"
              >
                ${L("Размер", "Size")}: ${this.staged.width}×${this.staged.height}
              </div>
              <div style="display:flex;gap:8px">
                <button
                  class="t-btn"
                  ?disabled=${this.uploading}
                  style="padding:6px 14px;font-size:13px;background:var(--t-ink);color:var(--t-parchment,#fff)"
                  @click=${() => this.submitUpload()}
                >
                  ${this.uploading
                    ? L("Загрузка…", "Uploading…")
                    : L("Загрузить", "Upload")}
                </button>
                <button
                  class="t-btn"
                  style="padding:6px 14px;font-size:13px;background:var(--t-sheet);color:var(--t-ink)"
                  @click=${() => (this.staged = null)}
                >
                  ${L("Отмена", "Cancel")}
                </button>
              </div>
            </div>
          </div>`
        : html`<div style="display:flex;flex-direction:column;gap:10px">
            <div
              style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"
            >
              <label
                class="t-btn"
                style="display:inline-block;padding:6px 14px;font-size:13px;background:var(--t-ink);color:var(--t-parchment,#fff);cursor:pointer;white-space:nowrap"
              >
                ${L("Выбрать файл", "Choose file")}
                <input
                  type="file"
                  accept="image/*"
                  @change=${(e: Event) => this.onPickFile(e)}
                  style="display:none"
                />
              </label>
              <input
                type="text"
                placeholder=${L(
                  "или вставь ссылку на картинку",
                  "or paste an image URL",
                )}
                .value=${this.urlInput}
                @input=${(e: Event) =>
                  (this.urlInput = (e.target as HTMLInputElement).value)}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") void this.stageFromUrl();
                }}
                style="flex:1;min-width:200px;padding:6px 8px;border:1px solid var(--t-ink);background:var(--t-parchment,#fff);color:var(--t-ink);font-size:13px"
              />
              <button
                class="t-btn"
                style="padding:6px 14px;font-size:13px;background:var(--t-sheet);color:var(--t-ink);white-space:nowrap"
                @click=${() => this.stageFromUrl()}
              >
                ${L("По ссылке", "From URL")}
              </button>
            </div>
            <div
              style="font-size:11.5px;color:var(--t-ink-soft,rgba(43,42,36,.6))"
            >
              ${L(
                "Можно перетащить файл сюда или вставить из буфера (⌘/Ctrl + V) — картинку или ссылку.",
                "Drag a file here, or paste from clipboard (⌘/Ctrl + V) — an image or a link.",
              )}
            </div>
          </div>`}
    </div>`;
  }

  private renderTexts(): TemplateResult {
    const sections: { title: string; items: string[] }[] = [
      {
        title: L("Короткие слоганы", "Short slogans"),
        items: [
          L("TERRON — захвати свой фронт.", "TERRON — seize your front."),
          L("Один мир. Твоя армия.", "One world. Your army."),
          L("Стратегия в реальном времени. Бесплатно.", "Real-time strategy. Free."),
          L("Захватывай. Расширяйся. Побеждай.", "Conquer. Expand. Win."),
        ],
      },
      {
        title: L("Короткое описание", "Short description"),
        items: [
          L(
            "TERRON — бесплатная браузерная стратегия в реальном времени. Захватывай территорию, строй армию и раздавай соседям на карте мира. Играй прямо сейчас на terron.io.",
            "TERRON is a free browser-based real-time strategy game. Grab territory, build an army and crush your neighbours on the world map. Play now at terron.io.",
          ),
        ],
      },
      {
        title: L("Развёрнутое описание", "Long description"),
        items: [
          L(
            "TERRON — многопользовательская территориальная стратегия в реальном времени прямо в браузере. Без установки и без регистрации: заходишь, выбираешь точку старта и начинаешь расширять свои границы. Заключай союзы, строй экономику, запускай ракеты и авиацию, добивай противников и становись последним, кто стоит на карте. Бесплатно на terron.io.",
            "TERRON is a browser-based multiplayer real-time territorial strategy game. No install, no signup: jump in, pick your spawn and start pushing your borders. Forge alliances, build an economy, launch missiles and aircraft, and be the last one standing on the map. Free at terron.io.",
          ),
        ],
      },
      {
        title: L("Хэштеги", "Hashtags"),
        items: [
          "#terron #terronio #rts #strategy #iogame #браузерныеигры #стратегия",
        ],
      },
      {
        title: L("Ссылки", "Links"),
        items: ["https://terron.io", "https://t.me/terron_chat"],
      },
    ];

    return html`<div style="display:flex;flex-direction:column;gap:18px">
      ${sections.map(
        (sec) => html`<section>
          <h3
            style="font-family:var(--t-display,Oswald);font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:var(--t-ink);margin:0 0 8px;border-bottom:2px solid var(--t-ink);padding-bottom:4px"
          >
            ${sec.title}
          </h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${sec.items.map(
              (txt) => html`<div
                style="display:flex;gap:8px;align-items:flex-start;border:1px solid var(--t-ink);background:var(--t-sheet);padding:8px 10px"
              >
                <span
                  style="flex:1;font-size:13px;line-height:1.5;color:var(--t-ink)"
                  >${txt}</span
                >
                <button
                  class="t-btn"
                  style="padding:4px 10px;font-size:12px;background:var(--t-ink);color:var(--t-parchment,#fff);white-space:nowrap"
                  @click=${() => this.copy(txt)}
                >
                  ${L("Копировать", "Copy")}
                </button>
              </div>`,
            )}
          </div>
        </section>`,
      )}
    </div>`;
  }
}

// ---- утилиты (модульного уровня, вне компонента) ----
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Растеризация SVG → PNG через <img> + canvas на натуральном размере.
async function svgToPng(svg: string, w: number, h: number): Promise<Blob> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg load"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no ctx");
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("img load"));
    img.src = src;
  });
}

// Оверлей-рамка поверх скриншота (штаб-стиль). Центр прозрачный. "" = без рамки.
// width/height в px (для растеризации) + style width/height 100% (для превью).
function frameOverlaySvg(w: number, h: number, type: FrameType): string {
  if (type === "none") return "";
  const minD = Math.min(w, h);
  const ink = "#2b2a24";
  const pad = Math.round(minD * 0.03);
  const sw = Math.max(3, Math.round(minD * 0.006));
  const wantFrame = type === "frame" || type === "frame_vignette";
  const wantVig = type === "vignette" || type === "frame_vignette";
  let defs = "";
  let body = "";
  if (wantVig) {
    defs += `<radialGradient id="tvig" cx="50%" cy="50%" r="72%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>
    </radialGradient>`;
    body += `<rect x="0" y="0" width="${w}" height="${h}" fill="url(#tvig)"/>`;
  }
  if (wantFrame) {
    body += `<rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="${h - pad * 2}" fill="none" stroke="${ink}" stroke-width="${sw}"/>`;
    const gap = Math.round(minD * 0.012);
    body += `<rect x="${pad + gap}" y="${pad + gap}" width="${w - (pad + gap) * 2}" height="${h - (pad + gap) * 2}" fill="none" stroke="${ink}" stroke-width="${Math.max(1, Math.round(sw * 0.4))}"/>`;
    const tick = Math.round(minD * 0.035);
    const corners: [number, number, number, number][] = [
      [pad, pad, 1, 1],
      [w - pad, pad, -1, 1],
      [pad, h - pad, 1, -1],
      [w - pad, h - pad, -1, -1],
    ];
    for (const [x, y, dx, dy] of corners) {
      body += `<line x1="${x}" y1="${y}" x2="${x + dx * tick}" y2="${y}" stroke="${ink}" stroke-width="${sw}"/>`;
      body += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + dy * tick}" stroke="${ink}" stroke-width="${sw}"/>`;
    }
    const fs = Math.round(minD * 0.028);
    const label = "terron.io";
    const lw = Math.round(fs * label.length * 0.62);
    body += `<rect x="${w - pad - lw - fs}" y="${h - pad - Math.round(fs * 1.7)}" width="${lw + fs}" height="${Math.round(fs * 1.7)}" fill="${ink}"/>`;
    body += `<text x="${w - pad - Math.round(fs * 0.5)}" y="${h - pad - Math.round(fs * 0.5)}" text-anchor="end" font-family="'IBM Plex Mono', monospace" font-size="${fs}" fill="#efe6c8">${label}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" style="width:100%;height:100%;display:block"><defs>${defs}</defs>${body}</svg>`;
}

// Композит: скриншот + рамка → PNG-Blob на натуральном размере.
async function composeWithFrame(
  dataUrl: string,
  w: number,
  h: number,
  type: FrameType,
): Promise<Blob> {
  const base = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no ctx");
  ctx.drawImage(base, 0, 0, w, h);
  const ov = frameOverlaySvg(w, h, type);
  if (ov) {
    const blob = new Blob([ov], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      ctx.drawImage(await loadImage(url), 0, 0, w, h);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob"))),
      "image/png",
    ),
  );
}

// Стилизованный постер-омаж (лысый псионик, фиолет, советская вёрстка). Без
// реальной картинки Юрия — только векторный силуэт (авторское право).
function yuriPosterSvg(variant: number): string {
  const w = 1080;
  const h = 1350;
  const cx = w / 2;
  const palettes = [
    {
      bg: "#241041",
      glow: "#8a3fd6",
      accent: "#b5271b",
      text: "#efe6c8",
      eye: "#7ef0ff",
      title: "ПСИОНИКА",
      slogan: "ТВОЙ РАЗУМ — МОЁ ОРУЖИЕ",
    },
    {
      bg: "#1a0b2e",
      glow: "#b23bd0",
      accent: "#e04a2f",
      text: "#efe6c8",
      eye: "#ff5cf0",
      title: "КОНТРОЛЬ",
      slogan: "СОПРОТИВЛЕНИЕ БЕСПОЛЕЗНО",
    },
  ];
  const p = palettes[((variant % 2) + 2) % 2];
  const sil = "#120720";
  const headCy = h * 0.42;
  const rings = [0.26, 0.34, 0.42]
    .map(
      (r) =>
        `<circle cx="${cx}" cy="${headCy}" r="${w * r}" fill="none" stroke="${p.glow}" stroke-width="3" opacity="0.14"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="width:100%;height:auto;display:block" font-family="'Oswald','Arial Narrow',Impact,sans-serif">
  <defs>
    <radialGradient id="pg" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="${p.glow}" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="${p.bg}" stop-opacity="1"/>
      <stop offset="100%" stop-color="#08040f" stop-opacity="1"/>
    </radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="16"/></filter>
  </defs>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${p.bg}"/>
  <rect x="0" y="0" width="${w}" height="${h}" fill="url(#pg)"/>
  ${rings}
  <!-- силуэт-бюст -->
  <path d="M ${cx - 360} ${h} Q ${cx - 380} ${h * 0.72} ${cx - 150} ${h * 0.63} Q ${cx} ${h * 0.58} ${cx + 150} ${h * 0.63} Q ${cx + 380} ${h * 0.72} ${cx + 360} ${h} Z" fill="${sil}"/>
  <rect x="${cx - 70}" y="${h * 0.5}" width="140" height="${h * 0.18}" fill="${sil}"/>
  <ellipse cx="${cx - 176}" cy="${headCy}" rx="26" ry="46" fill="${sil}"/>
  <ellipse cx="${cx + 176}" cy="${headCy}" rx="26" ry="46" fill="${sil}"/>
  <ellipse cx="${cx}" cy="${headCy}" rx="178" ry="212" fill="${sil}"/>
  <ellipse cx="${cx}" cy="${headCy}" rx="178" ry="212" fill="none" stroke="${p.glow}" stroke-width="6" opacity="0.5" filter="url(#blur)"/>
  <!-- светящиеся глаза -->
  <ellipse cx="${cx - 72}" cy="${headCy}" rx="40" ry="11" fill="${p.eye}" filter="url(#blur)"/>
  <ellipse cx="${cx + 72}" cy="${headCy}" rx="40" ry="11" fill="${p.eye}" filter="url(#blur)"/>
  <ellipse cx="${cx - 72}" cy="${headCy}" rx="30" ry="5" fill="#ffffff"/>
  <ellipse cx="${cx + 72}" cy="${headCy}" rx="30" ry="5" fill="#ffffff"/>
  <!-- тексты -->
  <rect x="${cx - 260}" y="${h * 0.07}" width="520" height="10" fill="${p.accent}"/>
  <text x="${cx}" y="${h * 0.135}" text-anchor="middle" font-size="120" font-weight="700" letter-spacing="6" fill="${p.text}">${esc(p.title)}</text>
  <text x="${cx}" y="${h * 0.83}" text-anchor="middle" font-size="46" font-weight="600" fill="${p.text}" font-family="'IBM Plex Mono', monospace">${esc(p.slogan)}</text>
  <text x="${cx}" y="${h * 0.92}" text-anchor="middle" font-size="88" font-weight="700" letter-spacing="8" fill="${p.text}">TERRON</text>
  <text x="${cx}" y="${h * 0.955}" text-anchor="middle" font-size="34" fill="${p.glow}" font-family="'IBM Plex Mono', monospace">terron.io</text>
</svg>`;
}

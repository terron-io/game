// Скины территории (тест-фаза, локально). Скин = градиент ИЛИ загруженная
// картинка с разным тайлингом. Кастомные скины хранятся в localStorage как
// data-URL (бэкенд косметики ещё пустой). Выбранный скин заливает зону ника
// через CSS-переменную --t-skin (см. .play-id в terron-theme.css).

export type SkinKind = "gradient" | "image";
export type Tiling = "tile" | "cover" | "tile-x" | "tile-y";

export interface Skin {
  id: string;
  name: string;
  kind: SkinKind;
  value: string; // gradient CSS или data:URL
  tiling: Tiling; // только для image
  size: number; // px плитки для tile/tile-x/tile-y
  builtin?: boolean;
}

export const BUILTIN_SKINS: Skin[] = [
  { id: "graphite", name: "Графит", kind: "gradient", value: "linear-gradient(135deg,#3a3a33,#2b2a24)", tiling: "tile", size: 48, builtin: true },
  { id: "clay", name: "Глина", kind: "gradient", value: "linear-gradient(135deg,#a8432b,#6e2c1d)", tiling: "tile", size: 48, builtin: true },
  { id: "olive", name: "Олива", kind: "gradient", value: "linear-gradient(135deg,#6b6f4e,#3f4230)", tiling: "tile", size: 48, builtin: true },
  { id: "slate", name: "Сланец", kind: "gradient", value: "linear-gradient(135deg,#4a5a6a,#2c3540)", tiling: "tile", size: 48, builtin: true },
  { id: "sand", name: "Песок", kind: "gradient", value: "linear-gradient(135deg,#caa86f,#8a7a55)", tiling: "tile", size: 48, builtin: true },
];

const CUSTOM_KEY = "terronSkins";
const SELECTED_KEY = "terronSkin";

function loadCustom(): Skin[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Skin[]) : [];
  } catch {
    return [];
  }
}

function saveCustom(list: Skin[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn("skins: failed to save (quota?)", e);
  }
}

export function allSkins(): Skin[] {
  return [...BUILTIN_SKINS, ...loadCustom()];
}

export function getSkin(id: string): Skin | undefined {
  return allSkins().find((s) => s.id === id);
}

export function selectedSkinId(): string {
  try {
    const id = localStorage.getItem(SELECTED_KEY);
    if (id && getSkin(id)) return id;
  } catch {
    /* ignore */
  }
  return BUILTIN_SKINS[0].id;
}

/** CSS-значение для свойства background (shorthand) данного скина. */
export function skinBackground(skin: Skin): string {
  if (skin.kind === "gradient") return skin.value;
  const url = `url("${skin.value}")`;
  switch (skin.tiling) {
    case "cover":
      return `${url} center / cover no-repeat`;
    case "tile-x":
      return `${url} center / auto ${skin.size}px repeat-x`;
    case "tile-y":
      return `${url} center / ${skin.size}px auto repeat-y`;
    case "tile":
    default:
      return `${url} 0 0 / ${skin.size}px ${skin.size}px repeat`;
  }
}

/** Превью-стиль для свотча/карточки (квадрат). */
export function skinSwatchStyle(skin: Skin): string {
  return `background:${skinBackground(skin)}`;
}

// ---- интеграция с движком: скин-картинка → 1-битный тайл-паттерн территории ----
// OpenFront красит территорию монохромным паттерном (см. core/PatternDecoder).
// Полноцветную картинку движок не кладёт — конвертим в 2 цвета + битовый тайл и
// пишем в localStorage["dev-pattern"] (getDevOnlyPattern → getPlayerCosmetics).

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("img load"));
    img.src = src;
  });
}

/** Картинка → patternData (32×32 1-бит) + два репрезентативных цвета. */
async function imageToPattern(
  dataUrl: string,
  tilePx: number,
): Promise<{ patternData: string; primary: string; secondary: string }> {
  const w = 32;
  const h = 32;
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no ctx");
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const n = w * h;
  const lum = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += lum[i];
  }
  const thr = sum / n;

  const bits = new Uint8Array(Math.ceil(n / 8));
  let lr = 0, lg = 0, lb = 0, ln = 0, dr = 0, dg = 0, db = 0, dn = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    if (lum[i] < thr) {
      bits[i >> 3] |= 1 << (i & 7); // bit=1 → вторичный (тёмный)
      dr += r; dg += g; db += b; dn++;
    } else {
      lr += r; lg += g; lb += b; ln++;
    }
  }
  const hex = (r: number, g: number, b: number, c: number) => {
    const f = (x: number) =>
      Math.round(x / Math.max(1, c)).toString(16).padStart(2, "0");
    return `#${f(r)}${f(g)}${f(b)}`;
  };
  const primary = ln ? hex(lr, lg, lb, ln) : "#e8e0c8";
  const secondary = dn ? hex(dr, dg, db, dn) : "#2b2a24";
  const scale = Math.min(3, Math.max(0, Math.round(tilePx / 45)));

  const out = new Uint8Array(3 + bits.length);
  out[0] = 0; // version
  out[1] = (scale & 0x07) | (((w - 2) & 0x1f) << 3);
  out[2] = (((w - 2) >> 5) & 0x03) | (((h - 2) & 0x3f) << 2);
  out.set(bits, 3);
  return { patternData: base64urlEncode(out), primary, secondary };
}

/** Синхронизировать выбранный скин с движком (паттерн территории). */
async function syncEnginePattern(skin: Skin): Promise<void> {
  try {
    if (skin.kind === "image") {
      const p = await imageToPattern(skin.value, skin.size);
      localStorage.setItem("dev-pattern", p.patternData);
      localStorage.setItem("dev-primary", p.primary);
      localStorage.setItem("dev-secondary", p.secondary);
    } else {
      // градиент/нет картинки → убрать паттерн территории
      localStorage.removeItem("dev-pattern");
      localStorage.removeItem("dev-primary");
      localStorage.removeItem("dev-secondary");
    }
  } catch (e) {
    console.warn("skin→pattern failed", e);
  }
}

/** Применить скин: --t-skin (зона ника) + паттерн территории + сохранить. */
export function applySkin(id: string): void {
  const skin = getSkin(id) ?? BUILTIN_SKINS[0];
  document.documentElement.style.setProperty("--t-skin", skinBackground(skin));
  try {
    localStorage.setItem(SELECTED_KEY, skin.id);
  } catch {
    /* private mode */
  }
  void syncEnginePattern(skin);
  window.dispatchEvent(new CustomEvent("terron-skin-changed", { detail: skin.id }));
}

export function addSkin(skin: Skin): void {
  const list = loadCustom();
  list.push(skin);
  saveCustom(list);
}

export function removeSkin(id: string): void {
  saveCustom(loadCustom().filter((s) => s.id !== id));
  if (selectedSkinId() === id) applySkin(BUILTIN_SKINS[0].id);
}

/** Уменьшить картинку до maxPx по большей стороне → компактный data-URL. */
export function fileToScaledDataUrl(file: File, maxPx = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no ctx"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/webp", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// Применить сохранённый скин сразу при загрузке модуля.
applySkin(selectedSkinId());

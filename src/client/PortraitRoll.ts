// terron 25.08: «ПЕРЕГЕНЕРИРОВАТЬ ПОРТРЕТ» + ходьба между вариантами
// (просьба владельца: «добавь кнопку перегенерировать», «кнопку назад после
// этого и вперёд, ну чтобы между генерациями двигаться»).
//
// Портрет детерминирован SEED'ом (PortraitArt.generatePortrait), а базовый seed
// у игрока один — его слаг. Поэтому «ещё вариант» = взять СЛУЧАЙНЫЙ seed и
// испечь по нему картинку. Сохраняем результат обычной аватаркой (data-URL):
// так его увидят и в топах, и в матче, не заводя отдельного «поля портрета».
//
// История ведёт себя как в браузере: шаг назад возвращает к предыдущему, а
// новая генерация ПОСЛЕ отката обрезает то, что было впереди. Нулевой элемент —
// то, что у игрока уже стоит, чтобы «назад» всегда возвращало к исходному.
import { bakeDataUrl, generatePortrait } from "./PortraitArt";
import { L } from "./Utils";

export type RollEntry = { url: string; original: boolean };

/** История вариантов. Вынесена отдельно от окна, чтобы поведение кнопок
 *  ←/→/«ещё» проверялось тестом, а не глазами по десять раз. */
export class RollHistory {
  private items: RollEntry[];
  private idx = 0;

  constructor(currentUrl: string) {
    this.items = [{ url: currentUrl, original: true }];
  }

  get current(): RollEntry {
    return this.items[this.idx];
  }
  /** Номер варианта для подписи: 0 — «текущий», дальше 1, 2, 3… */
  get position(): number {
    return this.idx;
  }
  get total(): number {
    return this.items.length - 1;
  }
  get canBack(): boolean {
    return this.idx > 0;
  }
  get canForward(): boolean {
    return this.idx < this.items.length - 1;
  }
  /** Менять нечего, пока игрок не ушёл с исходного варианта. */
  get changed(): boolean {
    return !this.current.original;
  }

  roll(seed: string): RollEntry {
    // Откатились и сгенерировали заново — то, что было впереди, теряется.
    this.items = this.items.slice(0, this.idx + 1);
    this.items.push({
      url: bakeDataUrl(generatePortrait(seed)),
      original: false,
    });
    this.idx = this.items.length - 1;
    return this.current;
  }
  back(): RollEntry {
    if (this.canBack) this.idx -= 1;
    return this.current;
  }
  forward(): RollEntry {
    if (this.canForward) this.idx += 1;
    return this.current;
  }
}

function randomSeed(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Окно выбора. Возвращает data-URL выбранного портрета или null (отмена). */
export function openPortraitRoll(opts: {
  current: string;
}): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const hist = new RollHistory(opts.current);

    const back = document.createElement("div");
    back.style.cssText =
      "position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.5);" +
      "display:flex;align-items:center;justify-content:center;padding:16px";
    const sheet = document.createElement("div");
    // Квадрат без скруглений и жёсткая тень — язык интерфейса ТЕРРОНа.
    sheet.style.cssText =
      "background:var(--t-sheet,#fff);color:var(--t-ink,#2b2a24);" +
      "border:1px solid rgba(0,0,0,.25);box-shadow:4px 4px 0 rgba(0,0,0,.2);" +
      "padding:16px;min-width:260px;max-width:92vw;text-align:center";
    back.appendChild(sheet);

    const title = document.createElement("div");
    title.style.cssText =
      "font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px";
    title.textContent = L("Новый портрет", "New portrait");

    const img = document.createElement("img");
    img.width = 160;
    img.height = 160;
    // pixelated: портрет 64×64, без него апскейл превращается в мыло.
    img.style.cssText =
      "width:160px;height:160px;image-rendering:pixelated;display:block;margin:0 auto;" +
      "border:1px solid rgba(0,0,0,.25)";

    const nav = document.createElement("div");
    nav.style.cssText =
      "display:flex;align-items:center;justify-content:center;gap:10px;margin:12px 0 4px";
    const mk = (label: string, wide = false) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        "font-family:inherit;font-size:12px;font-weight:700;text-transform:uppercase;" +
        "padding:7px 12px;border:1px solid rgba(0,0,0,.35);background:var(--t-bg,#efe6c8);" +
        "color:inherit;cursor:pointer" +
        (wide ? ";flex:1" : "");
      return b;
    };
    const prev = mk("←");
    const label = document.createElement("span");
    label.style.cssText = "font-size:12px;min-width:96px";
    const next = mk("→");
    nav.append(prev, label, next);

    const rollBtn = mk(L("🎲 Ещё вариант", "🎲 One more"), true);
    const rollRow = document.createElement("div");
    rollRow.style.cssText = "display:flex;margin:8px 0 12px";
    rollRow.appendChild(rollBtn);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px";
    const cancel = mk(L("Отмена", "Cancel"), true);
    const save = mk(L("Поставить", "Use it"), true);
    actions.append(cancel, save);

    sheet.append(title, img, nav, rollRow, actions);

    const paint = () => {
      img.src = hist.current.url;
      label.textContent = hist.current.original
        ? L("текущий", "current")
        : `${hist.position} / ${hist.total}`;
      prev.disabled = !hist.canBack;
      next.disabled = !hist.canForward;
      save.disabled = !hist.changed;
      for (const b of [prev, next, save]) {
        b.style.opacity = b.disabled ? "0.4" : "1";
        b.style.cursor = b.disabled ? "default" : "pointer";
      }
    };

    const close = (result: string | null) => {
      window.removeEventListener("keydown", onKey);
      back.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
      else if (e.key === "ArrowLeft") (hist.back(), paint());
      else if (e.key === "ArrowRight") (hist.forward(), paint());
      else if (e.key === "Enter" && hist.changed) close(hist.current.url);
    };

    prev.onclick = () => (hist.back(), paint());
    next.onclick = () => (hist.forward(), paint());
    rollBtn.onclick = () => (hist.roll(randomSeed()), paint());
    cancel.onclick = () => close(null);
    save.onclick = () => {
      if (hist.changed) close(hist.current.url);
    };
    // Клик мимо окна = отмена; клик по самому окну не закрывает.
    back.onclick = (e) => {
      if (e.target === back) close(null);
    };
    window.addEventListener("keydown", onKey);

    // Первый вариант показываем сразу: игрок нажал «перегенерировать», а не
    // «покажи, что уже стоит».
    hist.roll(randomSeed());
    paint();
    document.body.appendChild(back);
  });
}

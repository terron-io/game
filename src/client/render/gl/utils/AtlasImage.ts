/**
 * terron 04.09: УСТОЙЧИВАЯ ЗАГРУЗКА АТЛАСА.
 *
 * Три пасса (юниты, здания, эффекты) грузили свой атлас как
 * `img.src = url; await img.decode(); texImage2D(img)` — и на отказе decode()
 * текстура оставалась ПУСТОЙ на весь матч: юниты, здания и эффекты не рисовались.
 * В хелсе это «The source image cannot be decoded.» — 22 сессии за 3 дня, всегда
 * по ТРИ события на матч (все три атласа разом), всегда десктоп.
 *
 * Причина не в картинке: Chromium отказывает в decode() у СКРЫТОЙ вкладки
 * (игрок ушёл на другую вкладку, пока грузился матч) и при обрыве загрузки.
 * Поэтому: (1) decode() отказал — ждём обычный `load`, загруженная картинка
 * годится для texImage2D и без decode (браузер декодирует при загрузке в
 * текстуру); (2) не загрузилась — повтор с меткой в адресе (обход битой записи
 * кэша), до трёх попыток с паузой; (3) совсем не вышло — бросаем, а пасс шлёт
 * датчик `atlas_load_failed`, чтобы класс не молчал.
 */
export async function loadAtlasImage(
  url: string,
  attempts = 3,
): Promise<HTMLImageElement> {
  let lastErr: unknown = new Error("atlas: no attempts");
  for (let i = 0; i < attempts; i++) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src =
      i === 0 ? url : `${url}${url.includes("?") ? "&" : "?"}retry=${i}`;
    try {
      await img.decode();
      return img;
    } catch (e) {
      lastErr = e;
    }
    const loaded = await waitLoaded(img);
    if (loaded) return img;
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  throw lastErr;
}

function waitLoaded(img: HTMLImageElement): Promise<boolean> {
  return new Promise((resolve) => {
    if (img.complete) {
      resolve(img.naturalWidth > 0);
      return;
    }
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
  });
}

/** Обёртка для пассов: отказ не молчит, а уезжает в хелс с именем атласа. */
export function reportAtlasFailure(name: string, err: unknown): void {
  void import("../../../Health").then(({ reportHealth }) =>
    reportHealth("atlas_load_failed", `${name}: ${String(err)}`.slice(0, 200)),
  );
}

import { assetUrl } from "../core/AssetUrls";
import { CustomSkinRef } from "../core/Schemas";
import { getSkinByNameResult, type NamedSkin } from "./Api";

/**
 * terron (чашка-виральность): резолв НИК → зарегистрированный скин.
 *
 * Живёт отдельным модулем, потому что нужен ТРЁМ путям старта: онлайн-джойн
 * (Main.ts) и локальные старты (SinglePlayerModal / HostLobbyModal / Tutorial).
 * Раньше был приватной функцией в Main.ts — локальные старты скин не резолвили
 * вовсе, и в одиночке территория надевалась протухшим dev-skin от прошлого
 * онлайн-входа (или не надевалась совсем).
 */

const DEV_SKIN_KEY = "dev-skin";
/**
 * Метка «этот dev-skin положил резолв ника, а не человек руками из консоли».
 * Снимаем активный скин ТОЛЬКО если метка стоит — иначе затрём ручной dev-скин
 * разработчика.
 */
const DEV_SKIN_OWNER_KEY = "dev-skin-nick";

// terron: aspect (imgW/imgH) считаем на клиенте из самой картинки — надёжно для
// старых и новых скинов, не зависит от того, что лежит в БД.
function imageAspect(src: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () =>
        resolve(
          img.naturalWidth > 0 && img.naturalHeight > 0
            ? img.naturalWidth / img.naturalHeight
            : 1,
        );
      img.onerror = () => resolve(1);
      img.src = src.startsWith("data:") ? src : assetUrl(src);
    } catch {
      resolve(1);
    }
  });
}

/** Named-скин → косметик-реф, который сервер раздаёт ВСЕМ клиентам. */
export function namedSkinRef(s: NamedSkin): CustomSkinRef {
  // url = сам data_url (base64) либо путь-пресет — каждый клиент резолвит его
  // локально (data:/assetUrl), без кросс-ориджин и редиректов.
  const cap = (s.capital_name ?? "").trim();
  const fs = Number(s.fallout_skin);
  return {
    url: s.data_url,
    mode: s.mode,
    dim: s.dim,
    tileTiles: s.tile_tiles,
    aspect: s.aspect ?? 1,
    // имя столицы «государства» — сим прочтёт его из start info при основании
    ...(cap !== "" ? { capitalName: cap } : {}),
    // узор ядерного пепла — читает только рендер (GameView.applyFalloutOwners)
    ...(Number.isFinite(fs) && fs >= 1 && fs <= 10 ? { falloutSkin: fs } : {}),
  };
}

/**
 * Резолвит ник → скин и кладёт его в активный скин (localStorage["dev-skin"]),
 * который читает рендер.
 *
 * Если сервер ТОЧНО сказал «за этим ником скина нет» — активный скин СНИМАЕТСЯ
 * (если его ставил резолв ника). Без этого был рассинхрон: сменил ник на
 * незарегистрированный — сам у себя видишь старую текстуру (локальный фолбэк в
 * WebGLFrameBuilder), а все остальные — нет, потому что в косметику ничего не
 * уехало. При обрыве связи не снимаем ничего (см. getSkinByNameResult).
 */
export async function applyNamedSkinForNick(
  nick: string,
): Promise<NamedSkin | null> {
  try {
    const res = await getSkinByNameResult(nick);
    if (!res.ok) return null; // не дозвонились — оставляем как есть
    const s = res.skin;
    if (s === null) {
      if (localStorage.getItem(DEV_SKIN_OWNER_KEY) !== null) {
        localStorage.removeItem(DEV_SKIN_KEY);
        localStorage.removeItem(DEV_SKIN_OWNER_KEY);
      }
      return null;
    }
    // истинные пропорции нужны всем режимам кроме штампа: mode 4 (contain),
    // 2 (cover-зона), 1/3 (тайл прямоугольной ячейкой).
    if (s.mode !== 0) s.aspect = await imageAspect(s.data_url);
    localStorage.setItem(DEV_SKIN_KEY, JSON.stringify(namedSkinRef(s)));
    localStorage.setItem(DEV_SKIN_OWNER_KEY, nick);
    localStorage.setItem("settings.territoryPatterns", "true");
    return s;
  } catch {
    return null;
  }
}

/**
 * То же, но с гонкой таймера — ОБЯЗАТЕЛЬНО для всех путей старта игры.
 * Грабля 19.07 (память offline-start-cosmetics-hang): голый сетевой await перед
 * стартом = «игра не стартует с первого раза», игрок жмёт ещё раз, два джойна
 * выстреливают одновременно. Не успели за timeoutMs — играем без named-скина.
 */
export async function applyNamedSkinWithTimeout(
  nick: string,
  timeoutMs = 1500,
): Promise<NamedSkin | null> {
  try {
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    );
    return await Promise.race([applyNamedSkinForNick(nick), timeout]);
  } catch {
    return null;
  }
}

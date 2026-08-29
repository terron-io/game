import { assetUrl } from "../../../core/AssetUrls";
// terron (офлайн iOS): иконки радиалки рисуются как SVG <image xlink:href=URL>.
// В WKWebView внешне-ссылочный SVG внутри <image> мигает / не прорисовывается
// в офлайн-бандле (онлайн это маскируется HTTP-кэшем абсолютных terron.io URL).
// Фикс: вшиваем содержимое SVG в data:-URL на этапе сборки (?raw) → <image>
// становится самодостаточным, без сетевой загрузки и без перерисовочного
// мигания. Поведение онлайн НЕ меняется (тот же визуал, без внешнего запроса).
// Вшиваем ТОЛЬКО иконки радиалки (мелкие, ~30КБ суммарно) — НЕ весь images/*
// (там есть 2-МБ фоны). Если в радиалке появятся новые иконки — добавить сюда.
import allianceRaw from "../../../../resources/images/AllianceIconWhite.svg?raw";
import backRaw from "../../../../resources/images/BackIconWhite.svg?raw";
import boatRaw from "../../../../resources/images/BoatIconWhite.svg?raw";
import buildRaw from "../../../../resources/images/BuildIconWhite.svg?raw";
import chatRaw from "../../../../resources/images/ChatIconWhite.svg?raw";
import donateGoldRaw from "../../../../resources/images/DonateGoldIconWhite.svg?raw";
import donateTroopRaw from "../../../../resources/images/DonateTroopIconWhite.svg?raw";
import emojiRaw from "../../../../resources/images/EmojiIconWhite.svg?raw";
import infoRaw from "../../../../resources/images/InfoIcon.svg?raw";
import infoSolidRaw from "../../../../resources/images/InfoIconSolidWhite.svg?raw";
import swordRaw from "../../../../resources/images/SwordIconWhite.svg?raw";
import targetRaw from "../../../../resources/images/TargetIconWhite.svg?raw";
import traitorRaw from "../../../../resources/images/TraitorIconWhite.svg?raw";
import xRaw from "../../../../resources/images/XIcon.svg?raw";

// путь ассета → сырой SVG. Ключи совпадают с тем, что зовёт радиалка
// (assetUrl("images/X.svg") в RadialMenuElements/MainRadialMenu/RadialMenu).
const ICON_RAW: Record<string, string> = {
  "images/AllianceIconWhite.svg": allianceRaw,
  "images/BackIconWhite.svg": backRaw,
  "images/BoatIconWhite.svg": boatRaw,
  "images/BuildIconWhite.svg": buildRaw,
  "images/ChatIconWhite.svg": chatRaw,
  "images/DonateGoldIconWhite.svg": donateGoldRaw,
  "images/DonateTroopIconWhite.svg": donateTroopRaw,
  "images/EmojiIconWhite.svg": emojiRaw,
  "images/InfoIcon.svg": infoRaw,
  "images/InfoIconSolidWhite.svg": infoSolidRaw,
  "images/SwordIconWhite.svg": swordRaw,
  "images/TargetIconWhite.svg": targetRaw,
  "images/TraitorIconWhite.svg": traitorRaw,
  "images/XIcon.svg": xRaw,
};

// уже-резолвнутый assetUrl(...) → data:-URL вшитой иконки.
const byResolved = new Map<string, string>();
for (const [path, svg] of Object.entries(ICON_RAW)) {
  byResolved.set(assetUrl(path), "data:image/svg+xml," + encodeURIComponent(svg));
}

/**
 * Для уже-резолвнутого URL иконки вернуть data:-URL вшитой копии (если это
 * известная иконка радиалки), иначе вернуть URL как есть. Безопасно для
 * emoji / нестандартных иконок — они проходят без изменений.
 */
export function inlineIconHref(url: string | undefined | null): string {
  if (!url) return url ?? "";
  return byResolved.get(url) ?? url;
}

import { html, TemplateResult } from "lit";
import { assetUrl } from "../../../core/AssetUrls";

// terron: ЕДИНЫЙ ИСТОЧНИК иконок игровых показателей — войска / золото /
// территория. Те же файлы, что уже висят в лидерборде и панели управления,
// поэтому иконка на экране итогов совпадает с иконкой в бою.
//
// ⚠️ Менять картинку показателя — ТОЛЬКО здесь. Раньше пути к иконкам были
// раскиданы по слоям HUD (Leaderboard, ControlPanel, PlayerInfoOverlay,
// EventsDisplay…), и одна замена превращалась в обход десятка файлов.
// Валюты (ценная бумага / кровавый алмаз) живут по соседству — см. coin.ts.

export type StatKind = "troops" | "gold" | "land";

const ICONS: Record<StatKind, string> = {
  troops: assetUrl("images/TroopIconWhite.svg"),
  gold: assetUrl("images/GoldCoinIcon.svg"),
  // Территорию в лидерборде обозначает эта же иконка (колонка доли карты).
  land: assetUrl("images/LeaderboardIconSolidWhite.svg"),
};

const TITLES: Record<StatKind, { ru: string; en: string }> = {
  troops: { ru: "Войска", en: "Army" },
  gold: { ru: "Золото", en: "Gold" },
  land: { ru: "Территория", en: "Land" },
};

/** Название показателя — для alt/title и подписей там, где текст уместен. */
export function statLabel(kind: StatKind, lang: "ru" | "en" = "ru"): string {
  return TITLES[kind][lang];
}

// Войска и территория нарисованы одним тоном и частично через `currentColor`,
// а в <img> он не наследуется — на тёмном HUD такая иконка уходит в чёрное
// пятно (так и выглядит сейчас в лидерборде). Перекрашиваем фильтром в белый.
// Монета золота цветная и в перекраске не нуждается.
const MONOCHROME: Record<StatKind, boolean> = {
  troops: true,
  gold: false,
  land: true,
};

/** Иконка показателя. Подпись уходит в alt/title: на экране итогов иконка
 *  говорит сама за себя, а скринридер и наведение остаются с текстом. */
export function statIcon(kind: StatKind, size = 16): TemplateResult {
  const label = statLabel(kind);
  const tint = MONOCHROME[kind] ? "filter:brightness(0) invert(1);" : "";
  return html`<img
    src=${ICONS[kind]}
    alt=${label}
    title=${label}
    style="display:inline-block;width:${size}px;height:${size}px;vertical-align:-2px;flex:0 0 auto;object-fit:contain;${tint}"
  />`;
}

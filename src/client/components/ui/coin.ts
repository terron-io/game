import { html, TemplateResult } from "lit";
import { assetUrl } from "../../../core/AssetUrls";

// terron: иконки валют. Внутренние коды lts/pts остаются в коде, наружу —
// только иконки (от названий «ЛТС/ПТС» уходим):
//   lts → облигация/расписка (BondIcon) · pts → кровавый алмаз (BloodDiamondIcon).
// coin() — только иконка; price() — «число + иконка».

const ICONS: Record<"lts" | "pts", string> = {
  lts: assetUrl("images/BondIcon.svg"),
  pts: assetUrl("images/BloodDiamondIcon.svg"),
};

export function coin(kind: "lts" | "pts", size = 16): TemplateResult {
  const pts = kind === "pts";
  return html`<img
    src=${ICONS[kind]}
    title=${pts ? "Кровавый алмаз" : "Ценная бумага"}
    alt=${pts ? "Кровавый алмаз" : "Ценная бумага"}
    style="display:inline-block;width:${size}px;height:${size}px;vertical-align:-3px;flex:0 0 auto;object-fit:contain"
  />`;
}

export function price(n: number, kind: "lts" | "pts"): TemplateResult {
  return html`${n}&nbsp;${coin(kind)}`;
}

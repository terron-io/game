import type { GraphicsOverrides } from "./GraphicsOverrides";
import type { RenderSettings } from "./RenderSettings";
import type { VisualStyle } from "./VisualStyles";

const DARK_AMBIENT = 0.35;

/**
 * Классический вид зданий: светлая фигура цветом игрока + тёмный глиф.
 * ⚠️ ОДНА функция на два входа (настройка игрока и визуальный стиль) — две
 * копии этих шести чисел разъехались бы на первой же правке.
 */
function applyClassicIcons(settings: RenderSettings): void {
  settings.structure.borderDarken = 0.7;
  settings.structure.fillDarken = 1.0;
  settings.structure.iconR = 0;
  settings.structure.iconG = 0;
  settings.structure.iconB = 0;
  settings.structure.iconAlpha = 0.75;
}

/**
 * Ники: dark = чёрная заливка + цветная обводка, иначе цветная заливка + белая
 * обводка. Обводке принудительно чёрный RGB, иначе рампа defaultFill в шейдере
 * не схлопнется в чистый чёрный.
 */
function applyDarkNames(settings: RenderSettings, dark: boolean): void {
  settings.name.fillUsePlayerColor = !dark;
  settings.name.outlineUsePlayerColor = dark;
  const channel = dark ? 0 : 1;
  settings.name.outlineR = channel;
  settings.name.outlineG = channel;
  settings.name.outlineB = channel;
}

export function applyGraphicsOverrides(
  settings: RenderSettings,
  overrides: GraphicsOverrides,
): void {
  if (overrides.name?.nameScaleFactor !== undefined) {
    settings.name.nameScaleFactor = overrides.name.nameScaleFactor;
  }
  if (overrides.name?.cullThreshold !== undefined) {
    settings.name.cullThreshold = overrides.name.cullThreshold;
  }
  if (overrides.structure?.classicIcons === true) {
    applyClassicIcons(settings);
  }
  if (overrides.mapOverlay?.highlightFillBrighten !== undefined) {
    settings.mapOverlay.highlightFillBrighten =
      overrides.mapOverlay.highlightFillBrighten;
  }
  if (overrides.mapOverlay?.highlightBrighten !== undefined) {
    settings.mapOverlay.highlightBrighten =
      overrides.mapOverlay.highlightBrighten;
  }
  if (overrides.mapOverlay?.highlightThicken !== undefined) {
    settings.mapOverlay.highlightThicken =
      overrides.mapOverlay.highlightThicken;
  }
  if (overrides.railroad?.railMinZoom !== undefined) {
    settings.railroad.railMinZoom = overrides.railroad.railMinZoom;
  }
  if (overrides.passEnabled?.fx !== undefined) {
    settings.passEnabled.fx = overrides.passEnabled.fx;
  }
  if (overrides.name?.darkNames !== undefined) {
    applyDarkNames(settings, overrides.name.darkNames);
  }
}

/**
 * terron: применить визуальный стиль к настройкам рендера.
 *
 * ⚠️ ПОРЯДОК НАЛОЖЕНИЯ (ClientGameRunner.regenerateRenderSettings):
 * дефолты → СТИЛЬ → оверрайды игрока → тёмный режим. То есть явная настройка
 * игрока (размер ников, отсечка, иконки) СИЛЬНЕЕ стиля — стиль задаёт вид, но
 * не отменяет того, что человек выкрутил руками.
 */
export function applyVisualStyle(
  settings: RenderSettings,
  style: VisualStyle,
): void {
  const t = style.tweaks;
  if (t.lighting !== undefined) settings.lighting.enabled = t.lighting;
  if (t.ambient !== undefined) settings.lighting.ambient = t.ambient;
  if (t.trailAlpha !== undefined) settings.mapOverlay.trailAlpha = t.trailAlpha;
  if (t.highlightBrighten !== undefined) {
    settings.mapOverlay.highlightBrighten = t.highlightBrighten;
    settings.mapOverlay.highlightFillBrighten = t.highlightBrighten * 0.6;
  }
  if (t.staleNuke !== undefined) {
    settings.mapOverlay.staleNukeR = t.staleNuke[0] / 255;
    settings.mapOverlay.staleNukeG = t.staleNuke[1] / 255;
    settings.mapOverlay.staleNukeB = t.staleNuke[2] / 255;
  }
  if (t.classicIcons === true) applyClassicIcons(settings);
  if (t.darkNames !== undefined) applyDarkNames(settings, t.darkNames);
}

export function applyDarkModeOverride(
  settings: RenderSettings,
  isDark: boolean,
): void {
  if (!isDark) return;
  settings.lighting.ambient = DARK_AMBIENT;
  settings.lighting.enabled = true;
}

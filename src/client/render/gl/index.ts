export type { AttackRingInput } from "../types";
export { createDebugGui } from "./debug/index";
export type {
  GameViewEventMap,
  GameViewEventType,
  MapPointerEvent,
  MapScrollEvent,
  RadialMenuItem,
  RadialMenuSelectEvent,
} from "./Events";
export { GameView } from "./GameView";
export { glContextStats, probeGlContext, releaseGlContext } from "./GlContext";
export { GraphicsOverridesSchema } from "./GraphicsOverrides";
export type { GraphicsOverrides } from "./GraphicsOverrides";
export type { SpawnCenter } from "./passes/SpawnOverlayPass";
export {
  applyDarkModeOverride,
  applyGraphicsOverrides,
  applyVisualStyle,
} from "./RenderOverrides";
export { createRenderSettings, dumpSettings } from "./RenderSettings";
export type { RenderSettings } from "./RenderSettings";
export { deepAssign, deepDiff } from "./SettingsUtils";
export { buildTerrainRGBA, getPaletteSize } from "./utils/ColorUtils";
export { buildNukeTrajectory, samRange } from "./utils/NukeTrajectory";
export type { SAMInfo } from "./utils/NukeTrajectory";
export {
  DEFAULT_TERRITORY_ALPHA,
  DEFAULT_VISUAL_STYLE_ID,
  VISUAL_STYLES,
  visualStyleById,
} from "./VisualStyles";
export type {
  PlayerColorGrade,
  VisualStyle,
  VisualStyleId,
} from "./VisualStyles";

// Re-export shared types used in the public API
export type {
  NameEntry,
  PlayerState,
  PlayerStatic,
  RendererConfig,
  TilePair,
  UnitState,
} from "../types";

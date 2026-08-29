#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;

// Per-instance: x, y, ownerID, underConstruction, atlasIdx, markedForDeletion, level, isCapital
layout(location = 1) in vec4 aInst0; // x, y, ownerID, underConstruction
layout(location = 2) in vec4 aInst1; // atlasIdx, markedForDeletion, level, isCapital (terron СТОЛИЦЫ)

uniform mat3  uCamera;
uniform float uZoom;

uniform float uIconSize;
uniform float uDotsThreshold;
uniform float uDotScale;
uniform float uScaleFactor;
uniform float uIconGrowZoom;
uniform float uShapeScales[ATLAS_COLS];
uniform float uIconFills[ATLAS_COLS];
uniform float uFortIdx; // terron: колонка Укреплений — их штамп растёт с уровнем

out vec2  vLocalPos;
out vec2  vAtlasUV;
flat out float vOwnerID;
flat out float vUnderConstruction;
flat out float vMarkedForDeletion;
flat out float vZoom;
flat out float vAtlasIdx;
flat out float vShapeScale;
flat out float vIsCapital; // terron: СТОЛИЦЫ — золотой тинт City

void main() {
  float worldX = aInst0.x;
  float worldY = aInst0.y;
  vOwnerID = aInst0.z;
  vUnderConstruction = aInst0.w;
  vMarkedForDeletion = aInst1.y;
  vZoom = uZoom;
  vAtlasIdx = aInst1.x;
  vIsCapital = aInst1.w; // terron: СТОЛИЦЫ

  float iconScale;
  if (uZoom <= uDotsThreshold) {
    iconScale = uDotScale;
  } else if (uZoom >= uIconGrowZoom) {
    // World-anchored: grow proportionally to zoom so the structure covers a
    // fixed area of the map. Past this zoom, structures should feel like
    // they're "on" the canvas rather than overlaid at constant pixel size.
    iconScale = uZoom / uIconGrowZoom;
  } else {
    iconScale = min(1.0, uZoom / uScaleFactor);
  }

  int shapeIdx = int(aInst1.x);
  float shapeScale = uShapeScales[shapeIdx];
  vShapeScale = shapeScale;

  // terron: Укрепления растут размером с уровнем. Базовый scale форта = 2.0,
  // цель 2.0/2.5/3.0 на ур.1/2/3 → множитель 1 + 0.25*(level-1). Масштабируем
  // только halfSize (весь штамп целиком), uvExpand не трогаем. Прочие типы —
  // множитель 1.0 (level по умолчанию 1). new-units/ULTIMATES.md
  float levelMult = 1.0;
  if (shapeIdx == int(uFortIdx)) {
    levelMult = 1.0 + 0.25 * max(0.0, aInst1.z - 1.0);
  }

  float halfSize = uIconSize * iconScale * 0.5 / uZoom * shapeScale * levelMult;

  vec2 center = vec2(worldX + 0.5, worldY + 0.5);
  vec2 worldPos = center + (aPos - 0.5) * halfSize * 2.0;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vLocalPos = aPos - 0.5;

  // Atlas UV: icons stay the same world size regardless of shape scaling,
  // and are further shrunk by per-shape iconFill (0-1) to add padding inside the frame.
  float uvExpand = shapeScale / uIconFills[shapeIdx];
  float scaledX = 0.5 + (aPos.x - 0.5) * uvExpand;
  float scaledY = 0.5 + (aPos.y - 0.5) * uvExpand;
  float colU = (aInst1.x + scaledX) / float(ATLAS_COLS);
  vAtlasUV = vec2(colU, scaledY);
}

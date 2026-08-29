#version 300 es
// terron ПЕРФ (память, 12.07): террейн хранится СЫРЫМ байтом (R8UI, 1 байт/px
// вместо RGBA8 4 байта/px), цвет берётся из LUT 256×1 (encodeTerrainTile,
// посчитанный один раз на CPU). Минус 3 байта/px GPU + минус transient
// RGBA-массив 4 байта/px на старте (32МБ на гигантской карте).
precision highp float;
precision highp usampler2D;

uniform usampler2D uTerrain; // R8UI — сырой terrain-байт
uniform sampler2D uTerrainLut; // 256×1 RGBA — байт → цвет

in vec2 vUV;
out vec4 fragColor;

void main() {
  uint tb = texture(uTerrain, vUV).r;
  fragColor = texelFetch(uTerrainLut, ivec2(int(tb), 0), 0);
}

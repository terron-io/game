#version 300 es
// terron: туман войны — финальный композит. Рисуется ПОВЕРХ всех карто-пассов
// (территория, юниты, здания, имена, телеграфы): слой НЕПРОЗРАЧЕН (alpha=fog),
// чтобы происходящее не просвечивало, но вместо черноты рисуем ЗАТЕМНЁННЫЙ
// РЕЛЬЕФ (uTerrainTex × uTerrainDim) — карту «примерно видно», а кто чем
// владеет и что происходит — нет (решение владельца 11.07). LINEAR-фильтр
// текстуры видимости + smoothstep дают мягкую кромку в ~1 тайл.
precision highp float;
precision highp usampler2D;

uniform sampler2D uVisTex; // R8, LINEAR — 1 видно, 0 туман
// terron ПЕРФ (память, 12.07): рельеф — общая R8UI-текстура сырых байтов,
// цвет через LUT 256×1 (как в terrain.frag) — своей RGBA-копии больше нет.
uniform usampler2D uTerrainTex; // R8UI — сырой terrain-байт
uniform sampler2D uTerrainLut; // 256×1 RGBA — байт → цвет
uniform float uTerrainDim; // 0..1 — насколько приглушить рельеф под туманом
// terron: «Небо наше» — волна из эпицентра запуска (TERRON_OURSKY_WAVE_MS):
// uWaveMode 0 = нет, 1 = тьма расходится (туман только ВНУТРИ круга),
// 2 = свет расходится (туман только СНАРУЖИ). uWave = (cx, cy, radius) в
// тайлах; схлоп-анимация = радиус убывает CPU-стороной (FogPass.draw).
uniform int uWaveMode;
uniform vec3 uWave;
// terron: ревилы — окна видимости после своих ударов/высадок (x, y, r в
// тайлах, радиус уже анимирован CPU). vis = max(vis, круги).
uniform int uRevealCount;
uniform vec3 uReveals[16];

in vec2 vUV;
out vec4 fragColor;

void main() {
  vec2 mapPos = vUV * vec2(float(MAP_W), float(MAP_H));
  float vis = texture(uVisTex, vUV).r;

  for (int i = 0; i < 16; i++) {
    if (i >= uRevealCount) break;
    float d = distance(mapPos, uReveals[i].xy);
    float reveal = 1.0 - smoothstep(uReveals[i].z - 6.0, uReveals[i].z, d);
    vis = max(vis, reveal);
  }

  float fog = 1.0 - smoothstep(0.25, 0.75, vis);

  if (uWaveMode != 0) {
    float d = distance(mapPos, uWave.xy);
    float soft = 12.0; // мягкий фронт волны, тайлов
    float inside = 1.0 - smoothstep(uWave.z - soft, uWave.z + soft, d);
    fog *= (uWaveMode == 1) ? inside : (1.0 - inside);
  }

  if (fog <= 0.0) discard;
  uint tb = texture(uTerrainTex, vUV).r;
  vec3 terr = texelFetch(uTerrainLut, ivec2(int(tb), 0), 0).rgb * uTerrainDim;
  fragColor = vec4(terr, fog);
}

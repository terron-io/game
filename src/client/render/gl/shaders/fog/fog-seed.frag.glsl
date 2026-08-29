#version 300 es
// terron: туман войны — seed-маска видимости. 1 = тайл принадлежит мне или
// союзнику (LUT по smallID), 0 = всё остальное. Дальше маска дилатируется
// на радиус обзора (fog-dilate) и штампуются свои юниты (fog-units).
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex; // R16UI — состояние тайла (owner в младших битах)
uniform usampler2D uFriendlyTex; // R8UI 4096×1 — 1 для меня/союзников

out vec4 fragColor;

void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  uint owner = texelFetch(uTileTex, tc, 0).r & uint(OWNER_MASK);
  float vis = 0.0;
  if (owner != 0u) {
    vis = texelFetch(uFriendlyTex, ivec2(int(owner), 0), 0).r > 0u ? 1.0 : 0.0;
  }
  fragColor = vec4(vis, 0.0, 0.0, 1.0);
}

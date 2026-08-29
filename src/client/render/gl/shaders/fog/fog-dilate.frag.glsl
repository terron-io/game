#version 300 es
// terron: туман войны — сепарабельная дилатация seed-маски (max по линии).
// Два прохода (uDir = (1,0), затем (0,1)) дают квадрат Чебышева радиуса
// FOG_R — радиус обзора вокруг своей территории/юнитов. FOG_R — define.
precision highp float;

uniform sampler2D uSrc;
uniform ivec2 uDir; // (1,0) или (0,1)

out vec4 fragColor;

void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  ivec2 maxC = textureSize(uSrc, 0) - 1;
  float m = 0.0;
  for (int i = -FOG_R; i <= FOG_R; i++) {
    ivec2 c = clamp(tc + uDir * i, ivec2(0), maxC);
    m = max(m, texelFetch(uSrc, c, 0).r);
  }
  fragColor = vec4(m, 0.0, 0.0, 1.0);
}

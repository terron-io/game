#version 300 es
precision highp float;

// terron: Укрепления — снаряд-«выстрел» бункера. Залитая белая точка (не кольцо,
// как shockwave) — визуально ближе к реальному Shell (белый пиксель). Мягкий край.
in vec2  vLocalPos;
flat in float vAlpha;

out vec4 fragColor;

void main() {
  float d = length(vLocalPos);
  // Залитый диск: ядро d<0.6 полное, к краю (d→1.0) плавно в ноль.
  float a = 1.0 - smoothstep(0.6, 1.0, d);
  if (a < 0.01) discard;
  fragColor = vec4(1.0, 1.0, 1.0, a * vAlpha);
}

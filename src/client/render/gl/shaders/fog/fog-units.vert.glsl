#version 300 es
// terron: туман войны — точки своих/союзных юнитов в seed-маску (по 1 тайлу;
// радиус обзора добавляет общая дилатация). aPos — тайловые координаты.
precision highp float;

layout(location = 0) in vec2 aPos;

void main() {
  vec2 clip =
      (aPos + 0.5) / vec2(float(MAP_W), float(MAP_H)) * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = 1.0;
}

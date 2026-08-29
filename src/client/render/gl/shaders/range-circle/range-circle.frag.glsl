#version 300 es
precision highp float;

in vec2 vLocal; // [-1, +1]

uniform float uRadius;
uniform vec3 uColor;
uniform float uMinRadius; // terron: >0 → режим градиента (фабрика): мёртвая зона + green→yellow

out vec4 fragColor;

void main() {
  float dist = length(vLocal) * (uRadius + 1.0); // world-space distance from center
  float edge = uRadius;

  // Smooth fill: inside the circle
  float fill = 1.0 - smoothstep(edge - 0.5, edge + 0.5, dist);

  // Stroke: 1-tile-wide ring at the edge
  float strokeInner = edge - 1.0;
  float strokeOuter = edge;
  float stroke = smoothstep(strokeInner - 0.5, strokeInner + 0.5, dist)
               * (1.0 - smoothstep(strokeOuter - 0.5, strokeOuter + 0.5, dist));

  // terron: ОДИН сплошной диск-градиент «качества» подключения (фабрика):
  //  - ближе uMinRadius — «мёртвая зона», станция НЕ свяжется (красный);
  //  - дальше — плавно зелёный (отлично, короткий путь) → жёлтый у края (длиннее).
  // Заливка одинаковой плотности → читается как ОДИН круг (без внутреннего
  // кольца, которое раньше создавало вид «двух кругов»).
  vec3 col = uColor;
  float fillMul = 0.2;
  if (uMinRadius > 0.5) {
    if (dist < uMinRadius) {
      col = vec3(0.93, 0.28, 0.24); // мёртвая зона
    } else {
      float t = clamp((dist - uMinRadius) / max(1.0, uRadius - uMinRadius), 0.0, 1.0);
      col = mix(vec3(0.32, 0.82, 0.42), vec3(0.95, 0.78, 0.22), t); // зелёный→жёлтый
    }
    fillMul = 0.15; // одинаковая видимая заливка по всему диску (снижена в 2× — менее яркое забеливание)
  }

  float alpha = fill * fillMul + stroke * 0.5;
  if (alpha < 0.001) discard;

  fragColor = vec4(col, alpha);
}

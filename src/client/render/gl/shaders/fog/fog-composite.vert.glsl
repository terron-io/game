#version 300 es
// terron: туман войны — квад на всю карту, трансформ камерой (как terrain).
precision highp float;

layout(location = 0) in vec2 aPos;

uniform mat3 uCamera;

out vec2 vUV;

void main() {
  vec3 clip = uCamera * vec3(aPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vUV = aPos / vec2(float(MAP_W), float(MAP_H));
}

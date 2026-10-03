#version 300 es
// terron: ПОСТ-ОБРАБОТКА ЗЕМЛИ (визуальные стили, см. VisualStyles.ts).
//
// Что на входе: uSceneTex — уже сведённые «рельеф + территория» (базовый слой
// матча), снятые в FBO. Всё остальное (юниты, здания, ники, эффекты) рисуется
// ПОСЛЕ и этим шейдером не трогается — читаемость интерфейса не страдает.
//
// ⚠️ Шейдер ОДИН на все стили и НЕ ветвится по id: каждая сила — юниформа,
// ноль = эффект выключен. Новый стиль = новые числа, а не новый код.
//
// ⚠️ Линии (изолинии/берег) считаются по СОСЕДНИМ ТАЙЛАМ рельефа, а не по
// цвету: цвет уже испорчен территорией игрока, а рельеф — исходные данные.
// Шаг соседа не меньше пикселя (см. off) — иначе на отдалении линия тоньше
// пикселя и рассыпается в шум.
precision highp float;
precision highp usampler2D;

uniform sampler2D uSceneTex;
uniform usampler2D uTerrainTex; // R8UI — сырой байт рельефа

uniform vec2 uMapSize;    // карта в тайлах
uniform vec2 uCamOffset;  // мировая точка в центре экрана
uniform vec2 uViewWorld;  // сколько тайлов влезает по ширине/высоте экрана
uniform vec2 uPixelSize;  // 1 / размер канваса (в пикселях)
uniform float uTime;      // секунды, для анимированного зерна/развёртки

uniform float uSat;
uniform float uContrast;
uniform float uBrightness;
uniform vec3 uShadow;
uniform vec3 uHighlight;
uniform float uDuotone;
uniform float uPosterize;
uniform float uContour;
uniform float uContourStep;
uniform float uCoast;
uniform vec3 uLineColor;
uniform float uHatch;
uniform float uGrid;
uniform float uGridStep;
uniform float uGrain;
uniform float uGrainSpeed;
uniform float uScan;
uniform float uVignette;
uniform float uGlow;
uniform float uAberration;

in vec2 vUV;
out vec4 fragColor;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/** Мировая позиция пикселя. Экран вверх = мир вниз, отсюда минус по Y. */
vec2 worldAt(vec2 uv) {
  return uCamOffset + (uv - 0.5) * vec2(uViewWorld.x, -uViewWorld.y);
}

/** Байт рельефа в мировой точке (за краем карты — 0, «глубокая вода»). */
uint terrainAt(vec2 world) {
  vec2 uv = world / uMapSize;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0u;
  return texture(uTerrainTex, uv).r;
}

/**
 * Сглаженная высота: среднее пяти проб (центр + четыре по диагонали).
 *
 * ⚠️ ЗАЧЕМ. Рельеф у нас фрактальный и шумит ОТ ТАЙЛА К ТАЙЛУ: изолиния по
 * сырой magnitude превращается в сыпь по всей суше (первая версия «Чертежа»
 * именно так и выглядела). Среднее по пятну гасит шум, оставляя настоящий
 * перепад высот — линии идут по склонам, как на топокарте.
 */
float heightAt(vec2 world) {
  float r = 2.5;
  float sum = float(terrainAt(world) & 31u);
  sum += float(terrainAt(world + vec2(r, r)) & 31u);
  sum += float(terrainAt(world + vec2(-r, r)) & 31u);
  sum += float(terrainAt(world + vec2(r, -r)) & 31u);
  sum += float(terrainAt(world + vec2(-r, -r)) & 31u);
  return sum * 0.2;
}

void main() {
  vec2 uv = vUV;
  vec3 col;

  // --- Хроматическая аберрация: радиальный развод каналов ---
  if (uAberration > 0.001) {
    vec2 dir = (uv - 0.5);
    vec2 shift = dir * uAberration * uPixelSize * 2.0;
    col.r = texture(uSceneTex, uv + shift).r;
    col.g = texture(uSceneTex, uv).g;
    col.b = texture(uSceneTex, uv - shift).b;
  } else {
    col = texture(uSceneTex, uv).rgb;
  }

  // --- Свечение: восемь проб по кольцу, в дело идёт только яркая часть ---
  if (uGlow > 0.001) {
    vec3 acc = vec3(0.0);
    float r = 3.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853981634; // 2π/8
      vec2 o = vec2(cos(a), sin(a)) * r * uPixelSize;
      vec3 s = texture(uSceneTex, uv + o).rgb;
      acc += max(s - 0.45, vec3(0.0));
    }
    col += acc * (uGlow * 0.28);
  }

  // --- Грейд: насыщенность → контраст → яркость ---
  col = mix(vec3(luma(col)), col, uSat);
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
  col = clamp(col + uBrightness, 0.0, 1.0);

  // --- Дуотон: яркость раскладывается на два фирменных цвета ---
  if (uDuotone > 0.001) {
    vec3 duo = mix(uShadow, uHighlight, smoothstep(0.0, 1.0, luma(col)));
    col = mix(col, duo, uDuotone);
  }

  // --- Постеризация: ступени яркости вместо плавного градиента ---
  if (uPosterize > 0.5) {
    col = floor(col * uPosterize + 0.5) / uPosterize;
  }

  vec2 world = worldAt(uv);
  // Шаг пробы соседа: минимум тайл, но не меньше пикселя экрана.
  float px = uViewWorld.x * uPixelSize.x;
  vec2 off = vec2(max(1.0, px));
  uint tb = terrainAt(world);
  bool land = (tb & 128u) != 0u;

  // --- Береговая линия: сосед по суше/воде отличается → чернила ---
  if (uCoast > 0.001) {
    bool l1 = (terrainAt(world + vec2(off.x, 0.0)) & 128u) != 0u;
    bool l2 = (terrainAt(world - vec2(off.x, 0.0)) & 128u) != 0u;
    bool l3 = (terrainAt(world + vec2(0.0, off.y)) & 128u) != 0u;
    bool l4 = (terrainAt(world - vec2(0.0, off.y)) & 128u) != 0u;
    if (land != l1 || land != l2 || land != l3 || land != l4) {
      col = mix(col, uLineColor, uCoast);
    }
  }

  // --- Изолинии: граница «полос высоты» по magnitude ---
  // ⚠️ Гаснут на дальнем зуме: там тайл мельче пикселя, и «линии» вырождаются
  // в шум по всей суше (на большой карте это выглядит как грязь, а не рельеф).
  float contourAmt = uContour * smoothstep(0.45, 1.1, 1.0 / max(px, 0.0001));
  if (contourAmt > 0.001 && land) {
    // Шаг пробы — не меньше пятна сглаживания, иначе линия «двоится».
    vec2 coff = vec2(max(off.x, 3.0));
    float step0 = max(uContourStep, 1.0);
    float band = floor(heightAt(world) / step0);
    float b1 = floor(heightAt(world + vec2(coff.x, 0.0)) / step0);
    float b2 = floor(heightAt(world + vec2(0.0, coff.y)) / step0);
    bool nb1Land = (terrainAt(world + vec2(coff.x, 0.0)) & 128u) != 0u;
    bool nb2Land = (terrainAt(world + vec2(0.0, coff.y)) & 128u) != 0u;
    if ((nb1Land && band != b1) || (nb2Land && band != b2)) {
      col = mix(col, uLineColor, contourAmt);
    }
  }

  // --- Штриховка воды: диагональ в ЭКРАННЫХ пикселях ---
  // ⚠️ Именно в экранных, а не в мировых: штриховка — свойство ПЕЧАТИ, а не
  // местности. В мировых координатах она пропадала на дальнем зуме (шаг мельче
  // пикселя) и разъезжалась в полосы на ближнем — проверено глазами.
  if (uHatch > 0.001 && !land) {
    vec2 sp = uv / uPixelSize;
    float line = smoothstep(0.34, 0.5, abs(fract((sp.x + sp.y) / 9.0) - 0.5));
    col = mix(col, uLineColor, uHatch * line);
  }

  // --- Координатная сетка: тонкие линии каждые uGridStep тайлов ---
  if (uGrid > 0.001) {
    float step1 = max(uGridStep, 2.0);
    vec2 g = abs(fract(world / step1 + 0.5) - 0.5) * step1;
    float w = max(px, 0.35);
    float line = 1.0 - smoothstep(0.0, w, min(g.x, g.y));
    col = mix(col, uLineColor, uGrid * line);
  }

  // --- Строки развёртки ---
  if (uScan > 0.001) {
    float y = uv.y / uPixelSize.y;
    float s = 0.5 + 0.5 * sin(y * 2.2 + uTime * 2.0);
    col *= 1.0 - uScan * 0.5 * s;
  }

  // --- Зерно (бумага — статичное, ЭЛТ — бегущее) ---
  if (uGrain > 0.001) {
    vec2 seed = uv / uPixelSize + floor(uTime * uGrainSpeed * 24.0);
    col += (hash21(seed) - 0.5) * uGrain;
  }

  // --- Виньетка ---
  if (uVignette > 0.001) {
    vec2 p = (uv - 0.5) * 2.0;
    col *= 1.0 - uVignette * clamp(dot(p, p) * 0.55, 0.0, 1.0);
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}

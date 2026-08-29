#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

// Unit quad vertex position [0,0]→[1,1]
layout(location = 0) in vec2 aPos;

// Data textures
uniform sampler2D  uGlyphMetrics;  // CHAR_RANGE × 2, RGBA32F
uniform sampler2D  uCursorX;       // MAX_CHARS × (MAX_PLAYERS*2), R32F — pre-computed centered cursor X
uniform usampler2D uStrings;       // MAX_CHARS × (MAX_PLAYERS*2), R16UI — compact glyph index per slot
uniform sampler2D  uPlayerData;    // 4 × MAX_PLAYERS, RGBA32F

// Uniforms
uniform mat3  uCamera;
uniform float uTime;
uniform float uFontSize;    // atlas reference font size
uniform float uAtlasScaleW; // atlas texture width
uniform float uAtlasScaleH; // atlas texture height
uniform float uBase;        // atlas baseline height

const int MAX_CHARS_PER_LINE = MAX_CHARS;
const int LINES = LINES_PER_PLAYER;
uniform float uLerpSpeed;
uniform float uCullThreshold;
// terron: порог для ботов/наций — строже людского, чтобы их подписи гасли раньше.
uniform float uCullThresholdBots;
// terron: нации (Франция, Россия…) — отдельно от племён, порог мягче.
uniform float uCullThresholdNations;
uniform float uNameScaleFactor;
uniform float uNameScaleCap;
uniform float uTroopSizeMultiplier;
uniform float uHighlightOwnerID;
// terron: СВОЙ ник видно ВСЕГДА — он не отсекается порогом зума и не мельчает
// ниже читаемого (иначе на дальнем зуме превращается в точку). 0 = своего нет
// (спектатор/реплей/до спавна).
uniform float uMyOwnerID;
// terron: фейд КРУПНОГО ника — когда имя занимает много экрана (близкий зум своей
// большой страны), делаем его полупрозрачным, чтобы не закрывало здания/счётчики.
uniform float uFadeBigStart;    // screenSize, с которого начинаем фейд
uniform float uFadeBigEnd;      // screenSize, на котором минимальная альфа
uniform float uFadeBigMinAlpha; // минимальная альфа (0 = невидим)
// terron: ФЕЙД НИКА ПОД КУРСОРОМ — когда мышь рядом с именем, делаем его
// полупрозрачным, чтобы увидеть здания под ним. Курсор в МИРОВЫХ координатах.
uniform vec2  uCursorWorld;          // позиция курсора (мир). Далеко = фейда нет.
uniform float uCursorFadeRadiusFactor; // радиус фейда = factor × высота ника (0 = выкл)
uniform float uCursorFadeMinAlpha;   // альфа ника под курсором

out vec2 vUV;
out vec4 vPlayerColor;  // player territory color (rgb) + alpha
out float vIsHuman;     // 1.0 for human, 0.0 for bot/nation
out float vBigFade;     // множитель альфы для крупного ника (terron)

void main() {
  // 1. Decode instance ID → playerIdx, lineIdx, charPos
  int slotsPerPlayer = LINES * MAX_CHARS_PER_LINE;
  int playerIdx = gl_InstanceID / slotsPerPlayer;
  int remainder = gl_InstanceID - playerIdx * slotsPerPlayer;
  int lineIdx   = remainder / MAX_CHARS_PER_LINE;
  int charPos   = remainder - lineIdx * MAX_CHARS_PER_LINE;

  // 2. Read player data
  vec4 pd0 = texelFetch(uPlayerData, ivec2(0, playerIdx), 0); // srcX, srcY, srcScale, startTime
  vec4 pd1 = texelFetch(uPlayerData, ivec2(1, playerIdx), 0); // tgtX, tgtY, tgtScale, alive
  vec4 pd2 = texelFetch(uPlayerData, ivec2(2, playerIdx), 0); // r, g, b, a
  vec4 pd3 = texelFetch(uPlayerData, ivec2(3, playerIdx), 0); // nameLen, troopLen, isHuman, 0
  vec4 pd4 = texelFetch(uPlayerData, ivec2(4, playerIdx), 0); // flagLayerIdx, emojiAtlasIdx, smallID, 0
  float smallID = pd4.z;

  // Early out: dead player
  if (pd1.w <= 0.0) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vPlayerColor = vec4(0.0);
    vIsHuman = 0.0;
    return;
  }

  // String length for this line
  int len = (lineIdx == 0) ? int(pd3.x) : int(pd3.y);
  if (charPos >= len) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vPlayerColor = vec4(0.0);
    vIsHuman = 0.0;
    return;
  }

  // 3. Read char code at this position
  int stringRow = playerIdx * LINES + lineIdx;
  uint charCode = texelFetch(uStrings, ivec2(charPos, stringRow), 0).r;
  if (charCode == 0u) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vPlayerColor = vec4(0.0);
    vIsHuman = 0.0;
    return;
  }

  // 4. Compute lerped world position and size
  float elapsed = uTime - pd0.w;
  float t = clamp(1.0 - exp(-uLerpSpeed * elapsed), 0.0, 1.0);
  float wx = mix(pd0.x, pd1.x, t);
  float wy = mix(pd0.y, pd1.y, t);
  float ws = mix(pd0.z, pd1.z, t);

  // 5. Sizing pipeline (matches NameLayer.ts)
  float baseSize  = max(1.0, floor(ws));
  float nameSize  = max(4.0, floor(baseSize * uNameScaleFactor));
  // terron: размер ника растёт от размера страны НЕЛИНЕЙНО (корень). Линейный
  // baseSize*0.25 давал крошечной стране ник в 0.76 тайла (2-3 пикселя на
  // дефолтном зуме) — его не было видно, пока не приблизишься вплотную.
  // Корень подтягивает мелкие страны и почти не трогает крупные: точка выхода
  // на потолок та же (uNameScaleCap/0.25), выше неё формулы совпадают, так что
  // подстройка под территорию сохраняется — просто кривая круче внизу.
  // terron: knee — размер страны, на котором ник выходит на потолок. Держим
  // его ФИКСИРОВАННЫМ (0.25 * 8.4 = базовый cap 2.1), чтобы nameScaleCap
  // работал чистым множителем «все ники крупнее во столько-то раз», а не
  // растягивал заодно и саму кривую.
  float nameKnee      = 8.4;
  float nameScale = min(uNameScaleCap, uNameScaleCap * sqrt(baseSize / nameKnee));
  float nameWorldScale = (nameSize * nameScale) / uFontSize;
  float worldScale = nameWorldScale;

  bool isHighlighted = uHighlightOwnerID > 0.0 && smallID == uHighlightOwnerID;

  // Troop count is smaller
  if (lineIdx == 1) {
    worldScale *= uTroopSizeMultiplier;
  }

  // Zoom-based culling: compute screen-space size and skip if too small.
  // Highlighted (hovered) names bypass the cull so they're always visible.
  // uCamera[0][0] is the x-scale component of the camera matrix
  float cameraScale = length(vec2(uCamera[0][0], uCamera[1][0]));
  float screenSize = nameWorldScale * uBase * cameraScale;
  // terron: свой ник держит минимальный ЭКРАННЫЙ размер — растягиваем его в
  // мире так, чтобы на экране он был не мельче двойного порога отсечения.
  // Только для своего: чужие по-прежнему живут по размеру территории.
  bool isMine = uMyOwnerID > 0.0 && smallID == uMyOwnerID;
  if (isMine && screenSize > 0.0) {
    float minScreen = uCullThreshold * 2.0;
    if (screenSize < minScreen) {
      float k = minScreen / screenSize;
      nameWorldScale *= k;
      worldScale *= k;
      screenSize = minScreen;
    }
  }
  // terron: чем БЛИЖЕ зум (крупнее ник на экране), тем ПРОЗРАЧНЕЕ — до
  // uFadeBigMinAlpha (тот же уровень, что и ховер-фейд). Применяется ВСЕГДА, в т.ч.
  // к наведённому игроку (раньше highlight обходил фейд и ник оставался непрозрачным
  // при наведении на территорию — владелец просил убрать это).
  vBigFade =
    mix(1.0, uFadeBigMinAlpha, smoothstep(uFadeBigStart, uFadeBigEnd, screenSize));
  // terron: люди живут по uCullThreshold, боты/нации — по своему, более строгому.
  // terron: три класса — человек / нация / племя-бот, у каждого свой порог.
  float cullT = (pd3.z > 0.5)
    ? uCullThreshold
    : ((pd4.w > 0.5) ? uCullThresholdNations : uCullThresholdBots);
  if (screenSize < cullT && !isHighlighted && !isMine) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vPlayerColor = vec4(0.0);
    vIsHuman = 0.0;
    return;
  }

  // 6. Read pre-computed centered cursor X position
  float cursorX = texelFetch(uCursorX, ivec2(charPos, stringRow), 0).r;

  // 7. Glyph metrics for this character
  vec4 m0 = texelFetch(uGlyphMetrics, ivec2(int(charCode), 0), 0); // xadvance, xoffset, yoffset, width
  vec4 m1 = texelFetch(uGlyphMetrics, ivec2(int(charCode), 1), 0); // height, atlasU0, atlasV0, atlasU1
  // atlasV1 packed: we need 5 values from 2 RGBA texels (8 slots), so atlasV1 is in m0 slot?
  // Actually let's use: m0=(xadvance, xoffset, yoffset, width), m1=(height, u0, v0, u1), and compute v1
  float glyphW = m0.w;
  float glyphH = m1.x;
  float u0 = m1.y;
  float v0 = m1.z;
  float u1 = m1.w;
  float v1 = v0 + glyphH / uAtlasScaleH;

  // Degenerate if glyph has no size (e.g. space)
  if (glyphW <= 0.0 || glyphH <= 0.0) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vPlayerColor = vec4(0.0);
    vIsHuman = 0.0;
    return;
  }

  // 8. Compute world-space quad position
  float baselineY = -uBase * 0.5; // center vertically
  // Use name-line scale for offset so troops sit below the name, not overlapping
  float lineOffsetY = (lineIdx == 1) ? uBase * nameWorldScale * 1.1 : 0.0;

  // terron: фейд ника под курсором. Радиус масштабируется высотой ника → чем
  // крупнее имя (закрывает больше), тем шире зона наведения. Якорь — центр строки
  // (wx = центр по X, wy+offset = базовая линия). Наводишь мышь → имя тускнеет.
  if (uCursorFadeRadiusFactor > 0.0) {
    float nameWorldHeight = uBase * nameWorldScale;
    // terron: пол радиуса (в тайлах) — чтобы фейд работал и на МЕЛКИХ (чужих) никах,
    // у которых nameWorldHeight маленький и зона наведения была бы крошечной.
    float fadeR = max(4.0, uCursorFadeRadiusFactor * nameWorldHeight);
    vec2 anchor = vec2(wx, wy + lineOffsetY);
    float dCursor = distance(anchor, uCursorWorld);
    float cursorFade =
      mix(uCursorFadeMinAlpha, 1.0, smoothstep(fadeR * 0.5, fadeR, dCursor));
    // terron: обе прозрачности (зум + ховер) сведены к ОДНОМУ уровню — берём более
    // прозрачную из двух (min), а не перемножаем, чтобы не уходить в 0.05.
    vBigFade = min(vBigFade, cursorFade);
  }

  vec2 glyphOrigin = vec2(
    cursorX + m0.y,  // + xoffset
    baselineY + m0.z // + yoffset
  ) * worldScale;

  vec2 glyphSize = vec2(glyphW, glyphH) * worldScale;

  vec2 worldPos = vec2(wx, wy + lineOffsetY) + glyphOrigin + aPos * glyphSize;

  // 9. Camera transform
  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  // 10. UV interpolation across quad
  vUV = vec2(mix(u0, u1, aPos.x), mix(v0, v1, aPos.y));
  vPlayerColor = pd2;       // player territory color (rgb) + alpha
  vIsHuman = pd3.z;         // 1.0 = human, 0.0 = bot/nation
}

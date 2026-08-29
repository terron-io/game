#version 300 es
precision highp float;
precision highp usampler2D;
precision highp sampler2DArray;

uniform usampler2D uTileTex;      // R16UI — tile state per cell
uniform sampler2D  uPalette;      // RGBA32F — player colors
uniform sampler2D  uPatternMeta;  // RGBA32F — 1D buffer, 1 px per owner. R=hasPattern, G=width, B=height, A=scale
uniform usampler2D uPatternData;  // R8UI    — 2D buffer, row per owner, bytes for bitmask
uniform sampler2DArray uSkinAtlas; // RGBA8 — per-skin PNG layer, tiled via REPEAT wrap
uniform usampler2D uSkinLayer;    // R8UI — 1D buffer, 1 px per owner. 0=no skin, otherwise layer+1
uniform usampler2D uSkinAnchor;   // RG16UI — 1D buffer, anchor tile (cx, cy) per owner. (0,0) = world origin
uniform int uShowPatterns;
uniform int uIsTeamMode;          // 1 = teams (tint skin by team color), 0 = FFA (raw skin colors)
const float SKIN_DIM = 1024.0;    // atlas cell size in tiles — must match SkinAtlasArray.SKIN_DIM

// terron: глобальный режим отрисовки скина (демо/dev — реальных image-скинов нет,
// потому один набор uniform'ов на всех; mode=0 = прежнее поведение).
// terron виральность: режим/тайлинг/dim и bbox — ПЕР-ВЛАДЕЛЕЦ (как uSkinLayer/uSkinAnchor),
// чтобы у каждого игрока свой скин/режим одновременно. R8UI/RGBA32F, 1px на владельца.
uniform sampler2D uSkinParams;  // RGBA32F per owner: R=mode(0..3), G=tileTiles, B=dim
uniform sampler2D uSkinBBoxTex; // RGBA32F per owner: minX,minY,maxX,maxY (для mode 2 stretch)
uniform int   uSkinTrueColor;  // terron: 1 = истинные цвета (raw rgb, full alpha, без тинта)

uniform vec2 uMapSize;
uniform int uAltView;
uniform float uStaleNukeBase;
uniform float uStaleNukeVariation;
uniform float uStaleNukeAlpha;
uniform vec3 uStaleNukeColor;
uniform uint uHighlightOwner;      // 0 = no highlight; otherwise smallID of hovered owner
uniform float uHighlightBrighten;  // hover contrast boost strength; 0 = disabled
uniform sampler2D uDefenseCoverageTex; // R8 — 1.0 = tile defended by same-owner post
uniform float uDefenseDarken;      // multiplier applied to fill on defended tiles
uniform sampler2D uBorderTex;      // RG8 — border flags; R > 0.25 = border tile

// terron: скины пепла — «чей пепел» per tile: биты 0-11 smallID бомбившего
// (цвет каймы из uPalette), биты 12-15 индекс узора (falloutSkinMask, 1..10;
// 0 = гладкий пепел). До первой ядерки — 1×1-заглушка, читается 0.
uniform usampler2D uFalloutOwnerTex;

in vec2 vWorldPos;
out vec4 fragColor;

// terron: скины пепла — value-noise для «трещин»/«камуфляжа» (4 хэша+билинейка).
float foHash(vec2 c) {
  return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
}
float foNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u2 = f * f * (3.0 - 2.0 * f);
  float a = foHash(i);
  float b = foHash(i + vec2(1.0, 0.0));
  float c = foHash(i + vec2(0.0, 1.0));
  float d = foHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u2.x), mix(c, d, u2.x), u2.y);
}

// terron: скины пепла — 10 процедурных узоров. Возвращает маску 0..1
// («второй тон» пепла). Всё — дешёвая математика по непрерывной мировой
// координате: ноль текстур, резкость на любом зуме. Ветвление по константной
// малой цепочке if — без динамической индексации (грабли Intel/ANGLE).
float falloutSkinMask(uint idx, vec2 p) {
  if (idx == 1u) {                       // «Аварийка»: диагональные полосы
    return step(0.5, fract((p.x + p.y) / 9.0));
  }
  if (idx == 2u) {                       // «Клетка»
    vec2 c = floor(p / 5.0);
    return mod(c.x + c.y, 2.0);
  }
  if (idx == 3u) {                       // «Рябь»: интерференция волн
    return step(0.0, sin(p.x * 0.9) * sin(p.y * 0.9));
  }
  if (idx == 4u) {                       // «Кирпичи»
    float row = floor(p.y / 4.0);
    float xx = p.x + mod(row, 2.0) * 4.0;
    float mx = fract(xx / 8.0);
    float my = fract(p.y / 4.0);
    return (mx < 0.08 || my < 0.14) ? 1.0 : 0.0;
  }
  if (idx == 5u) {                       // «Трещины»: тонкие линии по шуму
    float n = foNoise(p * 0.35);
    return 1.0 - smoothstep(0.0, 0.06, abs(n - 0.5));
  }
  if (idx == 6u) {                       // «Горох»: круги по сетке
    vec2 cell = fract(p / 6.0) - vec2(0.5);
    return 1.0 - step(0.30, length(cell));
  }
  if (idx == 7u) {                       // «Камуфляж»: пятна-кляксы
    return step(0.55, foNoise(p * 0.22));
  }
  if (idx == 8u) {                       // «Сетка»: тонкие линии обеих осей
    vec2 g = fract(p / 6.0);
    return (g.x < 0.12 || g.y < 0.12) ? 1.0 : 0.0;
  }
  if (idx == 9u) {                       // «Зигзаг»
    float t = abs(fract(p.x / 8.0) * 2.0 - 1.0);
    return step(0.5, fract((p.y + t * 4.0) / 6.0));
  }
  if (idx == 10u) {                      // «Помехи»: потайловый статик
    return step(0.5, foHash(floor(p)));
  }
  return 0.0;
}

// terron: скины пепла — сосед (dx,dy) существует и БЕЗ пепла → мы на кайме
// воронки. Край карты каймой не считается.
bool foNeighborClear(ivec2 tc, int dx, int dy, ivec2 mapMax) {
  ivec2 n = tc + ivec2(dx, dy);
  if (n.x < 0 || n.y < 0 || n.x > mapMax.x || n.y > mapMax.y) return false;
  return (texelFetch(uTileTex, n, 0).r & (1u << FALLOUT_BIT)) == 0u;
}

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y))
    discard;

  uint raw = texelFetch(uTileTex, tc, 0).r;
  uint owner = raw & uint(OWNER_MASK);
  bool fallout = (raw & (1u << FALLOUT_BIT)) != 0u;

  if (owner == 0u && !fallout) discard;

  // --- Stale-nuke ground (any fallout tile, owned or not) ---
  // Renders for owned tiles too so the player's territory color can't bleed
  // through dim/transparent spots in the fallout bloom above.
  // terron: скины пепла — кайма воронки цветом бомбившего + узор скина во
  // внутрянке. «Язык радиации» не трогаем: тёмная выжженная база остаётся
  // (узор — лишь два тона пепла + лёгкий тинт), угольки/зелёное свечение
  // (FalloutBloom/FalloutLight) рисуются ПОВЕРХ и не скинятся никогда.
  if (fallout) {
    float h = fract(sin(float(tc.x) * 12.9898 + float(tc.y) * 78.233) * 43758.5453);
    float noise = uStaleNukeBase + h * uStaleNukeVariation;
    vec3 ash = uStaleNukeColor + vec3(noise);
    uint fo = texelFetch(uFalloutOwnerTex, tc, 0).r;
    uint fOwner = fo & uint(OWNER_MASK);
    if (fOwner != 0u) {
      vec3 pcol = texture(
        uPalette,
        vec2((float(fOwner) + 0.5) / float(PALETTE_SIZE), 0.25)
      ).rgb;
      ivec2 mapMax = ivec2(int(uMapSize.x) - 1, int(uMapSize.y) - 1);
      bool edge = foNeighborClear(tc, -1, 0, mapMax) ||
                  foNeighborClear(tc, 1, 0, mapMax) ||
                  foNeighborClear(tc, 0, -1, mapMax) ||
                  foNeighborClear(tc, 0, 1, mapMax);
      if (edge) {
        // Кайма: цвет бомбившего, чуть присыпан пеплом — читается и как
        // граница воронки, и как принадлежность.
        fragColor = vec4(mix(pcol, ash, 0.30), uStaleNukeAlpha);
        return;
      }
      uint skinIdx = (fo >> 12) & 15u;
      float m = falloutSkinMask(skinIdx, vWorldPos);
      // Узор = два тона пепла (потолок яркости фиксирован — ярче обычной
      // территории пепел стать не может) + тинт владельца ~16%.
      vec3 basec = mix(ash - vec3(0.035), ash + vec3(0.055), m);
      basec = mix(basec, pcol, 0.16);
      fragColor = vec4(basec, uStaleNukeAlpha);
      return;
    }
    fragColor = vec4(ash, uStaleNukeAlpha);
    return;
  }

  // Alt-view: hide owned non-fallout tiles
  if (uAltView != 0) discard;

  // --- Territory fill (owned, not fallout) ---
  float u = (float(owner) + 0.5) / float(PALETTE_SIZE);
  vec4 color = texture(uPalette, vec2(u, 0.25));

  // uShowPatterns gates both skins and patterns — they're the same
  // "decorate the territory fill" feature from the user's perspective.
  uint skinLayerPlus1 =
    uShowPatterns == 1
      ? texelFetch(uSkinLayer, ivec2(int(owner), 0), 0).r
      : 0u;
  if (skinLayerPlus1 > 0u) {
    // Skin overrides pattern entirely (mutually exclusive). The image is a
    // single stamp centered at the player's spawn tile — UVs outside [0,1]
    // are treated as transparent so tiles beyond the image bounds fall back
    // to the regular palette color. (0,0) anchor sentinel = world origin.
    uvec2 anchor = texelFetch(uSkinAnchor, ivec2(int(owner), 0), 0).rg;
    vec2 anchorOffset = (anchor == uvec2(0u)) ? vec2(0.0) : vec2(anchor);

    // terron: per-owner параметры скина (режим/тайлинг/dim).
    vec4 sp = texelFetch(uSkinParams, ivec2(int(owner), 0), 0);
    int   skinMode  = int(sp.r + 0.5);
    float skinTiles = sp.g;
    float skinDimP  = sp.b;
    float skinAspect = sp.a; // imgW/imgH (для статичного mode 4)

    vec2 skinUV;
    // skinGrad — координата для выбора мипа (textureGrad): для тайла это НЕПРЕРЫВНАЯ
    // координата (до fract), иначе на стыке плиток fract скачет 0→1 → огромная
    // производная → GPU берёт нижний мип → линия-шов между плитками.
    vec2 skinGrad;
    bool inBounds;
    // terron: семплим по НЕПРЕРЫВНОЙ позиции (vWorldPos), а не по целому тайлу
    // (vec2(tc)) — иначе скин блочный (1 тексель на тайл) и не похож на превью.
    if (skinMode == 1) {
      // TILE: картинка тайлится в ПЕРВОЗДАННОМ виде (любой aspect). В атласе она
      // stretch-в-квадрат, тут восстанавливаем форму прямоугольной ячейкой a:1
      // (период по X = t тайлов, по Y = t/a) → ни обрезки, ни искажения. Повтор —
      // НЕПРЕРЫВНОЙ координатой + REPEAT-обёртка атласа (GPU оборачивает билинейку и
      // мип через стык → бесшовно; fract давал шов). Мип берётся по той же cont.
      float t = max(skinTiles, 1.0);
      float a = skinAspect > 0.01 ? skinAspect : 1.0;
      vec2 cont = vec2((vWorldPos.x - anchorOffset.x) / t,
                       (vWorldPos.y - anchorOffset.y) * a / t);
      skinUV = cont;
      skinGrad = cont;
      inBounds = true;
    } else if (skinMode == 2) {
      // COVER истинных пропорций: картинка (aspect=sp.a) ВСЕГДА полностью закрывает
      // AABB зоны (по меньшей стороне), лишнее обрезается территорией. Картинка в
      // атласе хранится stretch-в-квадрат → прямоугольник истинных пропорций тут
      // восстанавливает её. Растёт зона → меняется форма прямоугольника (видно больше).
      vec4 bb = texelFetch(uSkinBBoxTex, ivec2(int(owner), 0), 0);
      vec2 mn = bb.xy;
      vec2 mx = bb.zw;
      vec2 zsz = max(mx - mn, vec2(1.0));
      vec2 ctr = (mn + mx) * 0.5;
      float a = skinAspect > 0.01 ? skinAspect : 1.0; // imgW/imgH
      float za = zsz.x / zsz.y;
      // cover: прямоугольник с пропорцией a покрывает зону (по меньшей стороне).
      vec2 rect = (a >= za) ? vec2(zsz.y * a, zsz.y) : vec2(zsz.x, zsz.x / a);
      skinUV = (vWorldPos - ctr) / rect + vec2(0.5);
      skinGrad = skinUV;
      inBounds = true; // зона всегда заполнена целиком
    } else if (skinMode == 3) {
      // TILE: то же, что mode 1 — тайл в первозданном виде, прямоугольная ячейка a:1,
      // бесшовно через непрерывную координату + REPEAT-обёртку атласа (без fract).
      float t = max(skinTiles, 1.0);
      float a = skinAspect > 0.01 ? skinAspect : 1.0;
      vec2 cont = vec2((vWorldPos.x - anchorOffset.x) / t,
                       (vWorldPos.y - anchorOffset.y) * a / t);
      skinUV = cont;
      skinGrad = cont;
      inBounds = true;
    } else if (skinMode == 4) {
      // СТАТИЧНЫЙ (terron): картинка натуральных пропорций (aspect=sp.a=imgW/imgH),
      // вписана в размер КАРТЫ (contain — без обрезки/искажения), привязана к спавну.
      // В атласе она letterbox-вписана в квадрат слоя (прозрачные поля), поэтому вне
      // картинки (поля/за границей) skin.a=0 → проступает цвет игрока.
      float a = skinAspect > 0.01 ? skinAspect : 1.0;
      // сторона квадрата-контейнера на карте: картинка занимает его по contain, а сам
      // контейнер не больше карты по обеим осям.
      float D = (a >= 1.0)
        ? min(uMapSize.x, uMapSize.y * a)
        : min(uMapSize.y, uMapSize.x / a);
      vec2 sqOrigin = anchorOffset - vec2(D * 0.5);
      skinUV = (vWorldPos - sqOrigin) / D;
      skinGrad = skinUV;
      inBounds = skinUV.x >= 0.0 && skinUV.x <= 1.0 &&
                 skinUV.y >= 0.0 && skinUV.y <= 1.0;
    } else {
      // STAMP (прежнее): один штамп шириной SKIN_DIM тайлов у якоря.
      skinUV = (vWorldPos - anchorOffset) / vec2(SKIN_DIM) + vec2(0.5);
      skinGrad = skinUV;
      inBounds = skinUV.x >= 0.0 && skinUV.x <= 1.0 &&
                 skinUV.y >= 0.0 && skinUV.y <= 1.0;
    }
    // textureGrad с производной от непрерывной координаты — мип выбирается гладко,
    // на стыке плиток (fract) шва нет.
    vec4 skin = textureGrad(
      uSkinAtlas, vec3(skinUV, float(skinLayerPlus1) - 1.0),
      dFdx(skinGrad), dFdy(skinGrad));
    float dim = skinDimP > 0.001 ? skinDimP : 1.0; // 0/неуст. → полная непрозрачность
    // terron: «истинные цвета скина» (uSkinTrueColor==1) — рисуем raw rgb на ПОЛНОЙ
    // непрозрачности (без подмешивания цвета игрока через dim и без team-тинта),
    // чтобы цвета скина/флага не искажались. Тоггл в настройках.
    float dimEff = (uSkinTrueColor == 1) ? 1.0 : dim;
    float skinAlpha = (inBounds ? skin.a : 0.0) * dimEff;
    // Transparent (or out-of-bounds) pixels fall through to the player color;
    // opaque pixels show the skin (tinted by team color in team games, unless true-color).
    vec3 skinColor =
      (uIsTeamMode == 1 && uSkinTrueColor == 0) ? color.rgb * skin.rgb : skin.rgb;
    color.rgb = mix(color.rgb, skinColor, skinAlpha);
  } else if (uShowPatterns == 1) {
    vec4 meta = texelFetch(uPatternMeta, ivec2(int(owner), 0), 0);
    if (meta.r > 0.0) {
      int pWidth = int(meta.g);
      int pHeight = int(meta.b);
      int pScale = int(meta.a);

      int px = tc.x >> pScale;
      int py = tc.y >> pScale;
      int mx = ((px % pWidth) + pWidth) % pWidth;
      int my = ((py % pHeight) + pHeight) % pHeight;
      int bitIndex = my * pWidth + mx;
      int byteIndex = bitIndex >> 3;

      uint patternByte = texelFetch(uPatternData, ivec2(byteIndex, int(owner)), 0).r;
      bool isPrimary = (patternByte & (1u << uint(bitIndex & 7))) == 0u;

      if (!isPrimary) {
        color = texture(uPalette, vec2(u, 0.75));
      }
    }
  }

  // Hover highlight: boost contrast on the hovered player's tiles, pushing
  // channels away from mid-gray. uHighlightBrighten is the strength; 0 disables.
  if (uHighlightOwner != 0u && owner == uHighlightOwner && uHighlightBrighten > 0.0) {
    float contrast = 1.0 + uHighlightBrighten;
    color.rgb = clamp((color.rgb - 0.5) * contrast + 0.5, 0.0, 1.0);
  }

  // Defense bonus: darken the fill on interior tiles defended by a same-owner
  // post. Border tiles are skipped — they get the checkerboard overlay from
  // BorderStampPass instead. Coverage is tested first so the (rarer) defended
  // tiles are the only ones that pay for the extra border fetch (&& short-
  // circuits in GLSL ES 3.00; texelFetch is derivative-free so this is safe).
  if (texelFetch(uDefenseCoverageTex, tc, 0).r > 0.5 &&
      texelFetch(uBorderTex, tc, 0).r <= 0.25) {
    color.rgb *= uDefenseDarken;
  }

  fragColor = color;
}

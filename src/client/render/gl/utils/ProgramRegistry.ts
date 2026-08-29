/**
 * ProgramRegistry — какие GL-программы отправить на линковку ЗАРАНЕЕ.
 *
 * terron ПЕРФ (08.08). Зачем это нужно, коротко: `linkOnce` в GlUtils
 * спрашивает LINK_STATUS сразу после `linkProgram`, а это точка синхронизации —
 * драйвер обязан долинковать программу прямо сейчас. Пассы строятся по очереди,
 * значит и линковка идёт по очереди. Замер из комментария к `prewarmShaders`:
 * компиляция 802мс + ЛИНКОВКА 609мс. Компиляцию уже вылечили прогревом,
 * линковка осталась.
 *
 * ⚠️ Выигрыш даёт ХРОНОЛОГИЯ, а не отказ от проверки статуса. Отправляем все
 * `linkProgram` ДО конструирования пассов — драйвер молотит их параллельно,
 * а первый блокирующий запрос ждёт одну программу вместо очереди из всех.
 * Статус проверяется как раньше, при выдаче из кэша, вместе со всей
 * диагностикой (тег шейдера, вторая попытка, счётчик программ).
 *
 * ПОЧЕМУ РЕЕСТР, А НЕ ГЛОБ КАК У ШЕЙДЕРОВ. Прогрев шейдеров обходит
 * `shaders/**.glsl` и опознаёт тип по имени файла. С программами так нельзя:
 * ПАРА (vert, frag) из имён не выводится, а часть пассов ещё и правит исходник
 * через `shaderSrc()` (#define) — такой текст в глобе не встречается вовсе.
 *
 * РЕЖИМ ОТКАЗА БЕЗОПАСНЫЙ. Ключ кэша — полные тексты обоих исходников. Если
 * запись здесь разойдётся с тем, что реально строит пасс, программа просто не
 * найдётся в кэше и соберётся обычным путём: теряется ускорение, не
 * корректность. Подсунуть пассу чужую программу нельзя.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Только ЖАДНЫЕ пассы — те, что строятся в
 * конструкторе `GPURenderer`. Ленивые (туман, освещение, блум, ж/д, радиаль,
 * превью-постройки, телеграф и траектория ядерки, сетка координат, рамка
 * выделения, индикатор движения) с критического пути уже ушли: они собираются
 * по действию игрока, когда старт давно позади. Греть их — вернуть в старт ту
 * самую работу, от которой мы уходим.
 *
 * ПРИ ДОБАВЛЕНИИ ЖАДНОГО ПАССА впиши сюда его пару, иначе он молча выпадет из
 * прогрева (гейт это заметит: `tests/client/graphics/ProgramRegistry.test.ts`).
 * Если у пасса приватные для модуля константы в #define — не копируй их сюда,
 * а экспортируй из пасса функцию-источник, как сделано у Unit/Structure/
 * SpawnOverlay/FxSprite. Тогда выражение остаётся в одном месте.
 */
import attackRingFragSrc from "../shaders/fx/attack-ring.frag.glsl?raw";
import attackRingVertSrc from "../shaders/fx/attack-ring.vert.glsl?raw";
import projectileFragSrc from "../shaders/fx/projectile.frag.glsl?raw";
import shockwaveFragSrc from "../shaders/fx/shockwave.frag.glsl?raw";
import shockwaveVertSrc from "../shaders/fx/shockwave.vert.glsl?raw";

import barFragSrc from "../shaders/bar/bar.frag.glsl?raw";
import barVertSrc from "../shaders/bar/bar.vert.glsl?raw";

import borderComputeFragSrc from "../shaders/border-compute/border-compute.frag.glsl?raw";
import borderScatterVertSrc from "../shaders/border-compute/border-scatter.vert.glsl?raw";
import fullscreenNoUvVertSrc from "../shaders/shared/fullscreen-no-uv.vert.glsl?raw";

import borderStampFragSrc from "../shaders/day-night/border-stamp.frag.glsl?raw";
import borderStampVertSrc from "../shaders/day-night/border-stamp.vert.glsl?raw";
import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import territoryFragSrc from "../shaders/map-overlay/territory.frag.glsl?raw";
import trailFragSrc from "../shaders/map-overlay/trail.frag.glsl?raw";

import coverageFragSrc from "../shaders/defense-coverage/defense-coverage.frag.glsl?raw";
import coverageVertSrc from "../shaders/defense-coverage/defense-coverage.vert.glsl?raw";

import samRadiusFragSrc from "../shaders/sam-radius/sam-radius.frag.glsl?raw";
import samRadiusVertSrc from "../shaders/sam-radius/sam-radius.vert.glsl?raw";
import structureLevelFragSrc from "../shaders/structure-level/structure-level.frag.glsl?raw";
import structureLevelVertSrc from "../shaders/structure-level/structure-level.vert.glsl?raw";
import worldTextFragSrc from "../shaders/world-text/world-text.frag.glsl?raw";
import worldTextVertSrc from "../shaders/world-text/world-text.vert.glsl?raw";

import terrainFragSrc from "../shaders/terrain/terrain.frag.glsl?raw";
import terrainVertSrc from "../shaders/terrain/terrain.vert.glsl?raw";

import { getPaletteSize } from "./ColorUtils";
import { shaderSrc } from "./GlUtils";
import { TILE_DEFINES } from "./TileCodec";

// Пассы с приватными для модуля #define отдают источники сами — так выражение
// живёт в одном месте и не может разойтись с тем, что строит конструктор.
import { spawnOverlayProgramSources } from "../passes/SpawnOverlayPass";
import { structureProgramSources } from "../passes/StructurePass";
import { unitProgramSources } from "../passes/UnitPass";
import { fxSpriteProgramSources } from "../passes/fx-pass/FxSpritePass";

export type ProgramPair = readonly [string, string];

/**
 * Пары (vert, frag) жадных пассов. mapW/mapH нужны террейну — на момент вызова
 * (конструктор GPURenderer) они уже известны.
 */
export function eagerProgramPairs(
  mapW: number,
  mapH: number,
): readonly ProgramPair[] {
  const palette = getPaletteSize();
  return [
    // --- карта и границы ---
    [shaderSrc(terrainVertSrc, { MAP_W: mapW, MAP_H: mapH }), terrainFragSrc],
    [overlayVertSrc, shaderSrc(territoryFragSrc, { PALETTE_SIZE: palette, ...TILE_DEFINES })],
    [fullscreenNoUvVertSrc, shaderSrc(borderComputeFragSrc, { ...TILE_DEFINES })],
    [borderScatterVertSrc, shaderSrc(borderComputeFragSrc, { ...TILE_DEFINES })],
    [borderStampVertSrc, shaderSrc(borderStampFragSrc, { PALETTE_SIZE: palette, ...TILE_DEFINES })],
    [overlayVertSrc, shaderSrc(trailFragSrc, { PALETTE_SIZE: palette, ...TILE_DEFINES })],
    [coverageVertSrc, shaderSrc(coverageFragSrc, { OWNER_MASK: TILE_DEFINES.OWNER_MASK })],

    // --- объекты на карте ---
    structureProgramSources(),
    unitProgramSources(),
    spawnOverlayProgramSources(),

    // --- эффекты ---
    fxSpriteProgramSources(),
    [attackRingVertSrc, attackRingFragSrc],
    [shockwaveVertSrc, shockwaveFragSrc],
    [shockwaveVertSrc, projectileFragSrc],

    // --- полоски над юнитами ---
    [barVertSrc, barFragSrc],

    // --- надписи и радиусы (жадные, нашёл страж-тест 08.08) ---
    [worldTextVertSrc, worldTextFragSrc],
    [samRadiusVertSrc, samRadiusFragSrc],
    [structureLevelVertSrc, structureLevelFragSrc],
  ];
}

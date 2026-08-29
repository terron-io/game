/**
 * WebGL2 utility functions: shader compilation, texture creation, VAO helpers.
 */
import { camDiag } from "../../../CamDiag";
// terron: репорт 20.07 (Intel UHD / ANGLE D3D11) пришёл как голое «Shader
// compile error:» с ПУСТЫМ логом — понять, какой из ~30 пассов упал, было
// нечем. Тег вытаскиваем из самого исходника: первый комментарий или первое
// объявление uniform/in — по нему шейдер находится грепом за секунду.
function shaderTag(source: string): string {
  const comment = source.match(/^\s*\/\/\s*(.+)$/m);
  if (comment) return comment[1].trim().slice(0, 80);
  // Без комментария опознаём по первым объявлениям — имена уникальны почти
  // везде, а вместе с типом шейдера дают точное попадание при грепе.
  const names = [
    ...source.matchAll(/^\s*(?:uniform|in|out)\s+\w+\s+(\w+)/gm),
  ].map((m) => m[1]);
  return names.length > 0 ? `~${names.slice(0, 3).join(",")}` : "?";
}

// terron: сколько программ уже собрано за жизнь страницы. Репорты 20.07
// (Intel UHD / ANGLE D3D11): падают РАЗНЫЕ пассы и по-разному (то компиляция,
// то линковка), лог пустой, контекст жив, glError=0, лимиты железа с запасом —
// значит дело не в GLSL, а в том, что драйвер сдаётся на N-й программе подряд.
// Номер в тексте ошибки показывает, упёрлись мы в потолок или отказ случайный.
let programsBuilt = 0;

export function shaderProgramsBuilt(): number {
  return programsBuilt;
}

// terron ПЕРФ 16.08: сколько программ реально взято из прогрева, а сколько
// слинковано мимо него (прогрев не покрыл пару или программа была бракованной).
// Едет в meta датчика slow_renderer_build: «сборка медленная» при hits≈0 значит
// «прогрев не сработал вовсе», при hits≈все — «медленно само железо».
let prewarmHits = 0;
let prewarmMisses = 0;

export function prewarmStats(): { hits: number; misses: number } {
  return { hits: prewarmHits, misses: prewarmMisses };
}

// terron 20.07 ПЕРФ СТАРТА. Замер: сборка рендера = 1.4с, и это ЦЕЛИКОМ шейдеры
// (37 программ, 74 шейдера, компиляция 802мс + линковка 609мс). Две причины:
//   1) один и тот же исходник компилировался повторно — из 74 шейдеров
//      уникальны 61, 13 были дублями;
//   2) главное: после каждой компиляции сразу спрашивался COMPILE_STATUS. Это
//      точка синхронизации: драйвер обязан ДОСОБРАТЬ шейдер прямо сейчас, и 74
//      компиляции выстраиваются в очередь вместо параллельной сборки.
// Лечим кэшем по исходнику + прогревом: перед сборкой пассов отправляем ВСЕ
// исходники на компиляцию, НЕ спрашивая статус (см. prewarmShaders). Драйвер
// разбирает их своими потоками, а пассы потом забирают готовое из кэша.
const shaderCache = new Map<string, WebGLShader>();
let shaderCacheGl: WebGL2RenderingContext | null = null;

/**
 * terron ПЕРФ (08.08). ТА ЖЕ БОЛЕЗНЬ, ЧТО ВЫШЕ, НО ДЛЯ ЛИНКОВКИ.
 * Замер из комментария к прогреву шейдеров: компиляция 802мс + ЛИНКОВКА 609мс.
 * Компиляцию вылечили прогревом, линковка осталась строго последовательной:
 * `linkOnce` спрашивает LINK_STATUS сразу после linkProgram — точка
 * синхронизации на КАЖДУЮ из ~26 программ.
 *
 * ⚠️ ГЛАВНОЕ ПРО ЭТОТ ФИКС: выигрыш даёт НЕ отказ от проверки статуса, а
 * ХРОНОЛОГИЯ. Убрать статус-чек и ничего не менять больше = ноль пользы: сразу
 * за createProgram идёт getUniformLocation, и он всё равно дожидается линковки
 * той же программы. Поэтому prewarmPrograms отправляет ВСЕ linkProgram ДО того,
 * как построен первый пасс, — драйвер молотит их своими потоками, а первый
 * блокирующий запрос ждёт только одну программу вместо очереди из всех.
 * Статус при выдаче из кэша проверяется как раньше, вся диагностика цела.
 */
const programCache = new Map<string, WebGLProgram>();

function programKey(vertSrc: string, fragSrc: string): string {
  // Ключ — полные тексты обоих исходников: коллизия исключена, а промах
  // (например, если реестр разошёлся с пассом) просто вернёт нас на обычный
  // путь сборки. Режим отказа безопасный: теряется ускорение, не корректность.
  return `${vertSrc}\u0000${fragSrc}`;
}

function cacheKey(type: number, source: string): string {
  return `${type}\u0000${source}`;
}

/** Кэш привязан к контексту: при новом/восстановленном GL старые шейдеры мертвы. */
function ensureCacheContext(gl: WebGL2RenderingContext): void {
  if (shaderCacheGl !== gl) {
    shaderCache.clear();
    programCache.clear();
    shaderCacheGl = gl;
  }
}

/**
 * Выбросить весь кэш шейдеров. ОБЯЗАТЕЛЬНО звать при пересоздании рендера:
 * после потери контекста браузер отдаёт ТОТ ЖЕ объект WebGL2RenderingContext,
 * поэтому сверка по ссылке (ensureCacheContext) подмену не увидит, а лежащие
 * в кэше шейдеры уже мертвы — все программы молча не слинкуются, и графика не
 * восстановится. Чистим явно.
 */
export function clearShaderCache(): void {
  shaderCache.clear();
  // Программы держат мёртвые шейдеры и сами мертвы после потери контекста —
  // выбрасываем вместе, иначе раздадим нерабочие и графика не восстановится.
  programCache.clear();
  shaderCacheGl = null;
}

/** Забыть исходник — чтобы пересобрать его с полной проверкой при разборе ошибки. */
function purgeFromCache(gl: WebGL2RenderingContext, source: string): void {
  ensureCacheContext(gl);
  shaderCache.delete(cacheKey(gl.VERTEX_SHADER, source));
  shaderCache.delete(cacheKey(gl.FRAGMENT_SHADER, source));
}

/**
 * Отправить все GLSL-исходники проекта на компиляцию ЗАРАНЕЕ и НЕ спрашивать
 * статус — тогда драйвер компилирует их параллельно, пока мы заняты другим.
 * Зовётся один раз перед сборкой пассов. Список собирается автоматически из
 * `shaders/**.glsl` по именованию `*.vert.glsl` / `*.frag.glsl`, поэтому новый
 * шейдер попадает в прогрев сам, без правки этого файла.
 * Пассы, которые правят исходник через shaderSrc() (#define), в кэш не попадут
 * и соберутся как раньше — это не поломка, просто без ускорения.
 */
export function prewarmShaders(gl: WebGL2RenderingContext): void {
  ensureCacheContext(gl);
  try {
    const mods = import.meta.glob("../shaders/**/*.glsl", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    for (const [path, source] of Object.entries(mods)) {
      const type = path.endsWith(".vert.glsl")
        ? gl.VERTEX_SHADER
        : path.endsWith(".frag.glsl")
          ? gl.FRAGMENT_SHADER
          : null;
      if (type === null || typeof source !== "string") continue;
      const key = cacheKey(type, source);
      if (shaderCache.has(key)) continue;
      const shader = gl.createShader(type);
      if (!shader) continue;
      gl.shaderSource(shader, source);
      gl.compileShader(shader); // СТАТУС НЕ СПРАШИВАЕМ — в этом весь смысл
      shaderCache.set(key, shader);
    }
  } catch (e) {
    // Прогрев — только ускорение. Не вышло — собираем как раньше.
    console.warn("[GL] прогрев шейдеров пропущен", e);
  }
}

/**
 * Отправить на ЛИНКОВКУ все программы, которые точно понадобятся, и НЕ
 * спрашивать статус — драйвер линкует их параллельно, пока мы строим пассы.
 * Зовётся один раз, СРАЗУ ПОСЛЕ prewarmShaders и ДО конструирования пассов
 * (иначе смысла нет — см. большой комментарий у programCache).
 *
 * Пары даёт реестр `ProgramRegistry.ts`: вывести их из имён файлов нельзя,
 * потому что часть пассов правит исходник через shaderSrc() (#define).
 * Разошёлся реестр с пассом — программа просто не найдётся в кэше и соберётся
 * обычным путём. Ошибки линковки здесь НЕ ловим намеренно: их разберёт
 * createProgram при выдаче, с полным логом и тегом шейдера.
 */
export function prewarmPrograms(
  gl: WebGL2RenderingContext,
  pairs: readonly (readonly [string, string])[],
): void {
  ensureCacheContext(gl);
  try {
    for (const [vertSrc, fragSrc] of pairs) {
      const key = programKey(vertSrc, fragSrc);
      if (programCache.has(key)) continue;
      const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
      const program = gl.createProgram();
      if (!program) continue;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program); // СТАТУС НЕ СПРАШИВАЕМ — в этом весь смысл
      programCache.set(key, program);
    }
  } catch (e) {
    // Прогрев — только ускорение. Не вышло — пассы соберут всё сами.
    console.warn("[GL] прогрев программ пропущен", e);
  }
}

function compileOnce(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): { shader: WebGLShader } | { error: string } {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return { shader };
  }
  const log = gl.getShaderInfoLog(shader) ?? "";
  gl.deleteShader(shader);
  return { error: log };
}

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const kind = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
  ensureCacheContext(gl);
  const key = cacheKey(type, source);
  const cached = shaderCache.get(key);
  // Готовое из прогрева/предыдущей программы. Статус НЕ спрашиваем: если
  // компиляция всё же не удалась, это всплывёт на линковке, и разбор ошибки
  // (createProgram) вычистит кэш и пересоберёт шейдер с полной проверкой.
  if (cached !== undefined) return cached;

  let first = compileOnce(gl, type, source);
  if ("shader" in first) {
    shaderCache.set(key, first.shader);
    return first.shader;
  }

  // Пустой лог = не «плохой GLSL», а разовый отказ драйвера. Даём вторую
  // попытку: битый шейдер так и так не соберётся, а сорвавшийся ANGLE часто
  // отдаёт программу со второго раза. Дешевле, чем потерять игроку весь матч.
  if (first.error.trim() === "" && !gl.isContextLost()) {
    const retry = compileOnce(gl, type, source);
    if ("shader" in retry) {
      console.warn(
        `[GL] шейдер [${kind}: ${shaderTag(source)}] собрался со 2-й попытки`,
      );
      shaderCache.set(key, retry.shader);
      return retry.shader;
    }
    first = retry;
  }

  const why =
    first.error.trim() === ""
      ? `(пустой лог; contextLost=${gl.isContextLost()}, glError=${gl.getError()}, программа #${programsBuilt + 1})`
      : "";
  throw new Error(
    `Shader compile error [${kind}: ${shaderTag(source)}] ${why}\n${first.error}`,
  );
}

function linkOnce(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): { program: WebGLProgram } | { error: string } {
  const tc = camDiag.enabled ? performance.now() : 0;
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (camDiag.enabled) {
    camDiag.steps["_компиляция"] =
      (camDiag.steps["_компиляция"] ?? 0) + (performance.now() - tc);
    camDiag.steps["_шейдеров_скомпилено"] =
      (camDiag.steps["_шейдеров_скомпилено"] ?? 0) + 2;
    const seen =
      (camDiag as unknown as { _srcSeen?: Set<string> })._srcSeen ??
      ((camDiag as unknown as { _srcSeen?: Set<string> })._srcSeen = new Set());
    const before = seen.size;
    seen.add(vertSrc);
    seen.add(fragSrc);
    camDiag.steps["_уникальных_исходников"] = seen.size;
    camDiag.steps["_повторных_исходников"] =
      (camDiag.steps["_повторных_исходников"] ?? 0) +
      (2 - (seen.size - before));
  }
  const tl = camDiag.enabled ? performance.now() : 0;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // НЕ удаляем: шейдеры общие (кэш по исходнику), их переиспользуют другие
  // программы. Раньше удаление было безопасно, т.к. шейдер жил у одной программы.
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (camDiag.enabled) {
    camDiag.steps["_линковка"] =
      (camDiag.steps["_линковка"] ?? 0) + (performance.now() - tl);
  }
  if (linked) {
    return { program };
  }
  const log = gl.getProgramInfoLog(program) ?? "";
  gl.deleteProgram(program);
  return { error: log };
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const t0 = camDiag.enabled ? performance.now() : 0;

  // terron ПЕРФ (08.08): готовое из прогрева программ. Статус спрашиваем ТУТ,
  // а не в прогреве: к этому моменту все linkProgram уже отправлены, поэтому
  // ждём завершения ОДНОЙ программы, а не очереди из всех. Если она всё же не
  // слинковалась — выбрасываем её и исходники из кэшей и идём обычным путём,
  // который выдаст точную ошибку с тегом шейдера (по ним ловили Intel/ANGLE).
  const cachedKey = programKey(vertSrc, fragSrc);
  const cachedProgram = programCache.get(cachedKey);
  if (cachedProgram !== undefined) {
    programCache.delete(cachedKey); // одна программа — одному потребителю
    if (gl.getProgramParameter(cachedProgram, gl.LINK_STATUS)) {
      programsBuilt++;
      prewarmHits++;
      if (camDiag.enabled) {
        camDiag.steps["шейдеры_всего"] =
          (camDiag.steps["шейдеры_всего"] ?? 0) + (performance.now() - t0);
        camDiag.steps["_шейдерных_программ"] =
          (camDiag.steps["_шейдерных_программ"] ?? 0) + 1;
        camDiag.steps["_из_прогрева"] =
          (camDiag.steps["_из_прогрева"] ?? 0) + 1;
      }
      return cachedProgram;
    }
    gl.deleteProgram(cachedProgram);
    purgeFromCache(gl, vertSrc);
    purgeFromCache(gl, fragSrc);
  }

  let first = linkOnce(gl, vertSrc, fragSrc);
  if ("program" in first) {
    programsBuilt++;
    prewarmMisses++;
    if (camDiag.enabled) {
      camDiag.steps["шейдеры_всего"] =
        (camDiag.steps["шейдеры_всего"] ?? 0) + (performance.now() - t0);
      camDiag.steps["_шейдерных_программ"] =
        (camDiag.steps["_шейдерных_программ"] ?? 0) + 1;
    }
    return first.program;
  }

  // Та же вторая попытка, что и для компиляции (см. compileShader). Перед ней
  // выбрасываем исходники из кэша: если виновата компиляция (прогрев статус не
  // проверяет), пересборка даст ТОЧНУЮ ошибку компиляции вместо общей «link error».
  if (first.error.trim() === "" && !gl.isContextLost()) {
    purgeFromCache(gl, vertSrc);
    purgeFromCache(gl, fragSrc);
    const retry = linkOnce(gl, vertSrc, fragSrc);
    if ("program" in retry) {
      programsBuilt++;
      prewarmMisses++;
      console.warn(
        `[GL] программа [${shaderTag(fragSrc)}] слинковалась со 2-й попытки`,
      );
      return retry.program;
    }
    first = retry;
  }

  const why =
    first.error.trim() === ""
      ? `(пустой лог; contextLost=${gl.isContextLost()}, glError=${gl.getError()}, программа #${programsBuilt + 1})`
      : "";
  throw new Error(
    `Program link error [${shaderTag(fragSrc)}] ${why}\n${first.error}`,
  );
}

export interface TextureOpts {
  width: number;
  height: number;
  internalFormat: number;
  format: number;
  type: number;
  data: ArrayBufferView | null;
  filter?: number;
  wrap?: number;
}

export function createTexture2D(
  gl: WebGL2RenderingContext,
  opts: TextureOpts,
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    opts.filter ?? gl.NEAREST,
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MAG_FILTER,
    opts.filter ?? gl.NEAREST,
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_S,
    opts.wrap ?? gl.CLAMP_TO_EDGE,
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_T,
    opts.wrap ?? gl.CLAMP_TO_EDGE,
  );
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    opts.internalFormat,
    opts.width,
    opts.height,
    0,
    opts.format,
    opts.type,
    opts.data,
  );
  return tex;
}

/**
 * Create a VAO with a quad covering [0,0]→[mapWidth, mapHeight] in world coords.
 * Two triangles, positions only. Attribute location 0.
 */
/**
 * Create a VAO with a [0,1]² fullscreen quad. Two triangles, positions only.
 * Attribute location 0. Used for post-process passes (blur, composite, etc.).
 */
export function createFullscreenQuad(
  gl: WebGL2RenderingContext,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
  return vao;
}

/**
 * Inject `#define` constants into a GLSL shader source string.
 * Inserts definitions immediately after the `#version` line.
 *
 * Usage:
 *   shaderSrc(blurFrag, { PALETTE_SIZE: 4096 })
 *   // → "#version 300 es\n#define PALETTE_SIZE 4096\n..."
 */
export function shaderSrc(
  source: string,
  defines: Record<string, number>,
): string {
  const defs = Object.entries(defines)
    .map(([k, v]) => `#define ${k} ${v}`)
    .join("\n");
  return source.replace("#version 300 es", `#version 300 es\n${defs}`);
}

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

/**
 * Bind a render target FBO, set viewport, clear, run draw callback, then
 * restore the default framebuffer. Returns the target texture for chaining.
 */
export function toTarget(
  gl: WebGL2RenderingContext,
  target: RenderTarget,
  draw: () => void,
): WebGLTexture {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.viewport(0, 0, target.w, target.h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  draw();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return target.tex;
}

/**
 * Bind the screen (default framebuffer), set viewport, run draw callback.
 */
export function toScreen(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  draw: () => void,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  draw();
}

export function createMapQuad(
  gl: WebGL2RenderingContext,
  mapWidth: number,
  mapHeight: number,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const positions = new Float32Array([
    0,
    0,
    mapWidth,
    0,
    0,
    mapHeight,
    0,
    mapHeight,
    mapWidth,
    0,
    mapWidth,
    mapHeight,
  ]);

  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
  return vao;
}

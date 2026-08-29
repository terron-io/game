// terron: всё, что касается ЖИЗНИ WebGL-контекста в одном месте — освобождение,
// счётчики за вкладку и ПРИЧИНА отказа браузера.
//
// Почему модуль отдельный (10.08): раньше `releaseGlContext` жил в
// ClientGameRunner, и render/gl импортировал его ОТТУДА — то есть слой рендера
// зависел от слоя запуска матча (круговой импорт). Плюс счётчики контекстов
// нужны сразу двоим (Renderer их растит, отчёт об ошибке их читает).
//
// Главное здесь — `probeGlContext`. Отказ `getContext("webgl2")` возвращает
// ГОЛЫЙ null: по нему нельзя отличить «нет WebGL2 на этом железе» от «браузер
// выключил ускорение прямо сейчас» и от «мы сожгли лимит контекстов». Причину
// браузер сообщает ТОЛЬКО событием `webglcontextcreationerror` (поле
// statusMessage) — его надо подписать ДО вызова getContext, иначе оно теряется.
// Firefox пишет туда осмысленный текст, Chrome — почти всегда пустой.

/** Сколько GL-контекстов создано за жизнь вкладки (лимит браузера ~16). */
let contextsCreated = 0;
/** Сколько раз контекст терялся (сигнатура падения GPU-процесса браузера). */
let contextsLost = 0;
/** Причины отказов от браузера, без дублей — для отчёта об ошибке. */
const creationFailures: string[] = [];

export function noteGlContextCreated(): number {
  return ++contextsCreated;
}

export function noteGlContextLost(): void {
  contextsLost++;
}

export function noteGlCreationFailures(reasons: readonly string[]): void {
  for (const r of reasons) {
    if (r && !creationFailures.includes(r) && creationFailures.length < 5) {
      creationFailures.push(r);
    }
  }
}

export function glContextStats(): {
  created: number;
  lost: number;
  failures: readonly string[];
} {
  return {
    created: contextsCreated,
    lost: contextsLost,
    failures: creationFailures,
  };
}

/**
 * Подписаться на причину отказа в создании контекста. Возвращает функцию,
 * которую надо позвать ПОСЛЕ getContext — она снимает слушатель и отдаёт
 * собранные сообщения (браузер может прислать несколько).
 */
export function captureCreationErrors(
  canvas: HTMLCanvasElement,
): () => string[] {
  const reasons: string[] = [];
  const onError = (ev: Event) => {
    const msg = (ev as Event & { statusMessage?: string }).statusMessage;
    if (msg && !reasons.includes(msg)) reasons.push(msg);
  };
  canvas.addEventListener("webglcontextcreationerror", onError, false);
  return () => {
    canvas.removeEventListener("webglcontextcreationerror", onError);
    return reasons;
  };
}

export interface GlProbe {
  ok: boolean;
  /** Причина отказа словами браузера (пусто = браузер промолчал). */
  reason: string;
  /** UNMASKED_RENDERER — реальное железо (если контекст всё же создался). */
  renderer?: string;
  vendor?: string;
  version?: string;
  /** Признак софтверного растеризатора: ускорения по факту нет. */
  software?: boolean;
}

/**
 * Одноразовая проба доступности WebGL. Контекст СРАЗУ отпускается —
 * проба не должна отъедать слот из браузерного лимита.
 *
 * ⚠️ Канвас каждый раз НОВЫЙ: по спеке повторный getContext того же типа на
 * канвасе, где создание уже провалилось, обязан снова вернуть null, даже если
 * браузер тем временем починился. Ретрай на старом канвасе бессмысленен.
 */
export function probeGlContext(type: "webgl2" | "webgl"): GlProbe {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const takeReasons = captureCreationErrors(canvas);
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let thrown = "";
  try {
    gl = canvas.getContext(type) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
  } catch (e) {
    thrown = String((e as Error)?.message ?? e);
  }
  const reason = takeReasons().join(" | ") || thrown;
  if (!gl) {
    if (reason) noteGlCreationFailures([reason]);
    return { ok: false, reason };
  }
  const probe: GlProbe = { ok: true, reason: "" };
  try {
    const dbg = gl.getExtension("WEBGL_debug_renderer_info") as {
      UNMASKED_RENDERER_WEBGL: number;
      UNMASKED_VENDOR_WEBGL: number;
    } | null;
    probe.renderer = String(
      dbg
        ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    );
    if (dbg) probe.vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL));
    probe.version = String(gl.getParameter(gl.VERSION));
    probe.software = /swiftshader|llvmpipe|software|basic render/i.test(
      probe.renderer ?? "",
    );
  } catch {
    /* параметры не критичны — главное, что контекст создался */
  }
  releaseGlContext(gl);
  return probe;
}

// terron: явное освобождение WebGL-контекста. Браузер держит жёсткий лимит
// живых контекстов на вкладку (~16) и, исчерпав его, перестаёт выдавать новые —
// со стороны это выглядит как «WebGL2 not supported» на машине, где WebGL
// исправен. Сборщик мусора освобождает контексты недетерминированно, поэтому
// одноразовые (диагностика, пробы) и сорвавшиеся (упавшая инициализация
// рендера) гасим руками.
export function releaseGlContext(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null,
): void {
  try {
    (
      gl?.getExtension("WEBGL_lose_context") as {
        loseContext?: () => void;
      } | null
    )?.loseContext?.();
  } catch {
    /* освобождение — best effort, ронять из-за него ничего нельзя */
  }
}

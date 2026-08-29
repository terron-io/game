import { InputMode } from "../core/Schemas";

// terron: ЧЕМ игрок реально играет — пальцем или мышью. Нужно для значка
// «забег с телефона» в спидран-топе.
//
// Почему не User-Agent: UA мы и так знаем на сервере (server/Device.ts), но он
// переключается в браузере в два клика — как справка сойдёт, как основание для
// отметки в топе слабовато. Живые pointer-события подделать «мимоходом» уже
// нельзя: нужен не тумблер в DevTools, а эмуляция тача весь матч.
//
// Считаем ТОЛЬКО pointerdown по игровому канвасу и ТОЛЬКО pointerType. Клавиши
// сознательно не учитываем: на телефоне ввод в чат поднимает виртуальную
// клавиатуру, и матч с телефона уехал бы в «смешанный».
//
// Совместимостные mouse-события (их браузер шлёт следом за тачем) сюда не
// попадают: слушаем pointerdown, а тач приходит в нём с pointerType "touch".

// Сколько событий одного вида считаем «человек так играет», а не случайностью
// (шальной клик мышью на планшете с подключённым трекпадом и наоборот).
const SIGNIFICANT = 3;

let touchCount = 0;
let mouseCount = 0;
let reported: InputMode | null = null;
let reporter: ((mode: InputMode) => void) | null = null;

function classify(): InputMode | null {
  const touch = touchCount >= SIGNIFICANT;
  const mouse = mouseCount >= SIGNIFICANT;
  if (touch && mouse) return "mixed";
  if (touch) return "touch";
  if (mouse) return "mouse";
  // До порога — по тому, что вообще было (первые тапы матча тоже сигнал).
  if (touchCount > 0 && mouseCount === 0) return "touch";
  if (mouseCount > 0 && touchCount === 0) return "mouse";
  if (touchCount > 0 && mouseCount > 0) return "mixed";
  return null;
}

/** Хук из InputHandler: одно нажатие по игровому канвасу. */
export function recordPointerInput(pointerType: string): void {
  if (pointerType === "touch") touchCount++;
  else if (pointerType === "mouse") mouseCount++;
  else return; // pen и прочая экзотика — не наш вопрос
  const mode = classify();
  if (mode === null || mode === reported) return;
  reported = mode;
  reporter?.(mode);
}

/**
 * Начало матча: обнуляем счётчики и подписываем отправку. Репортер зовётся
 * только на СМЕНУ классификации — за матч это максимум 3 сообщения
 * (mouse/touch → mixed), спамить сервер нечем.
 */
export function startInputModeTracking(send: (mode: InputMode) => void): void {
  touchCount = 0;
  mouseCount = 0;
  reported = null;
  reporter = send;
}

/** Конец матча/выход: перестаём слать (транспорт уже мёртв). */
export function stopInputModeTracking(): void {
  reporter = null;
}

/** Для тестов. */
export function currentInputMode(): InputMode | null {
  return reported;
}

import { Howler } from "howler";
import { UserSettings } from "../../core/game/UserSettings";

// terron 01.08: ЕДИНАЯ ШИНА ЗВУКА — СКВОЗНАЯ СИНХРОНИЗАЦИЯ С ПЛОЩАДКОЙ.
//
// ⚠️ ПРАВИЛО ВЛАДЕЛЬЦА, НЕ НАРУШАТЬ: НИКАКИХ ЛОКАЛЬНЫХ СОСТОЯНИЙ МУТА.
// На всю игру ОДИН выключатель музыки и ОДИН выключатель эффектов; их
// состояние = состояние площадки. Любая кнопка (настройки, пауза, ♫ в лобби)
// пишет сюда, шина применяет ко всем плеерам, обновляет все иконки И
// докладывает площадке. Любое изменение на площадке (её панель, пауза,
// реклама) прилетает сюда и применяется так же. Локально в UserSettings
// держится только ЗЕРКАЛО (нужно вне площадки: terron.io, Capacitor).
//
// Что НЕ синхронизируется: ГРОМКОСТЬ (ползунки) — у площадки такого API нет,
// это чисто наша величина. Мут — только через эту шину.
//
// Кладбище провалов (01.08), чтобы не повторять: оверлей с «памятью об эхе»
// (протухал), выпиливание обратного канала (нарушало ТЗ), отдельная галка
// лобби-музыки (расходилась с площадкой), фейды/жонглирование громкостью
// (залипало на нуле).

export type AudioTrack = "music" | "sfx";

/** Приёмник шины: применить мут дорожки к своим источникам звука. */
export interface AudioSink {
  applyPlatformMute(track: AudioTrack, muted: boolean): void;
}

// Состояние — глобальный синглтон: бандлер кладёт копию модуля в каждый чанк.
interface BusState {
  sinks: Set<AudioSink>;
  /** ЕДИНОЕ состояние мута дорожек (оно же — состояние площадки). */
  muted: { music: boolean; sfx: boolean };
  /** Временный общий мут ОТ ПЛОЩАДКИ (пауза, реклама, «Все звуки»). */
  transientAll: boolean;
  /** Доклад площадке (регистрирует GamePushSDK). */
  reporter: ((track: AudioTrack, muted: boolean) => void) | null;
  /** Когда мы сами писали дорожку — чтобы отличить своё эхо от её действия. */
  selfWrite: { music: number; sfx: number };
  ready: boolean;
}
const bus: BusState = ((
  globalThis as { __terronAudioBus?: BusState }
).__terronAudioBus ??= {
  sinks: new Set<AudioSink>(),
  muted: { music: false, sfx: false },
  transientAll: false,
  reporter: null,
  selfWrite: { music: 0, sfx: 0 },
  ready: false,
});

function boot(): void {
  if (bus.ready) return;
  bus.ready = true;
  // Стартовое зеркало: вне площадки это и есть источник правды, на площадке —
  // первый же тик сторожа перепишет его состоянием площадки.
  try {
    const s = new UserSettings();
    bus.muted.music = s.musicMuted();
    bus.muted.sfx = s.soundEffectsMuted();
  } catch {
    /* ssr/тесты */
  }
}

/** Заглушена ли дорожка СЕЙЧАС (настройка ∨ временный мут площадки). */
export function isMuted(track: AudioTrack): boolean {
  boot();
  return bus.muted[track] || bus.transientAll;
}

/** Совместимость с плеерами/иконками: то же самое. */
export const platformMuted = isMuted;

/** Регистрация плеера: сразу получает актуальное состояние. */
export function registerAudioSink(sink: AudioSink): void {
  boot();
  bus.sinks.add(sink);
  pushTo(sink);
}

export function unregisterAudioSink(sink: AudioSink): void {
  bus.sinks.delete(sink);
}

/** GamePushSDK регистрирует доклад площадке. Вне площадки — null (no-op). */
export function setPlatformReporter(
  r: ((track: AudioTrack, muted: boolean) => void) | null,
): void {
  bus.reporter = r;
}

/** ЛЮБАЯ наша кнопка мута. Применяем сразу, зеркалим в настройки и ДОКЛАДЫВАЕМ
 *  площадке — сквозная синхронизация (ТЗ владельца). */
export function setMutedByUser(track: AudioTrack, muted: boolean): void {
  boot();
  // ⚠️ ПОТОЛКА БОЛЬШЕ НЕТ (ответ саппорта GamePush 01.08). Их модель: кнопка
  // звука в игре ВСЕГДА зовёт mute/unmute, статус хранит и синхронизирует сам
  // SDK, а мут на время рекламы и сворачивания вкладки он ставит и снимает
  // тоже сам. Раньше мы не давали снять мут, поставленный из их панели, — но
  // это не «запрет площадки», а та же сохранённая настройка, и игрок вправе
  // её поменять из игры. Временный мут (реклама) остаётся поверх: он живёт
  // в transientAll и снимется, когда площадка скажет.
  bus.selfWrite[track] = Date.now();
  applyMuted(track, muted);
  try {
    bus.reporter?.(track, muted);
  } catch {
    /* вне площадки — некому докладывать */
  }
}

/** Событие дорожки ОТ SDK (mute:music/unmute:sfx и т.п.). Отличаем действие
 *  площадки от эха на наш собственный вызов по времени: наш вызов и его эхо
 *  происходят в один момент, а клик в её панели — сам по себе. */
export function platformTrackEvent(track: AudioTrack, muted: boolean): void {
  boot();
  applyMuted(track, muted);
}

/** Звук сейчас глушит САМА площадка (реклама, пауза, «все звуки») — снять это
 *  из игры нельзя, она снимет сама. Обычную настройку мута игрок меняет
 *  кнопкой в любую сторону, поэтому дорожка здесь больше не участвует. */
export function mutedByPlatform(_track: AudioTrack): boolean {
  return bus.transientAll;
}

/** СОСТОЯНИЕ ПЛОЩАДКИ (сторож GamePushSDK раз в секунду + её события).
 *  stored — её сохранённые настройки, pub — они же с временными мутами.
 *  Площадка — истина: расхождение всегда решается в её пользу. */
export function syncFromPlatform(
  stored: { music: boolean; sfx: boolean },
  pub: { music: boolean; sfx: boolean },
): void {
  boot();
  for (const track of ["music", "sfx"] as const) {
    // Расходимся с площадкой — она права: её настройка и есть состояние.
    // Своё эхо (мы только что писали) не мешает: значение уже совпадёт.
    if (bus.muted[track] !== stored[track]) applyMuted(track, stored[track]);
  }
  // Временный общий мут: площадка глушит ВСЁ поверх настроек.
  const transient = pub.music && pub.sfx && !(stored.music && stored.sfx);
  setTransientAll(transient);
}

/** Мгновенная реакция на pause/resume и рекламу (до тика сторожа). */
export function setTransientAll(muted: boolean): void {
  boot();
  if (bus.transientAll === muted) return;
  bus.transientAll = muted;
  try {
    Howler.mute(muted);
  } catch {
    /* ignore */
  }
  pushAll();
}

function applyMuted(track: AudioTrack, muted: boolean): void {
  if (bus.muted[track] === muted) return;
  bus.muted[track] = muted;
  try {
    const s = new UserSettings();
    if (track === "music") s.setMusicMuted(muted);
    else s.setSoundEffectsMuted(muted);
  } catch {
    /* ssr/тесты */
  }
  pushAll();
}

function pushAll(): void {
  for (const s of bus.sinks) pushTo(s);
  notifyUi();
}

function pushTo(sink: AudioSink): void {
  try {
    sink.applyPlatformMute("music", isMuted("music"));
    sink.applyPlatformMute("sfx", isMuted("sfx"));
  } catch {
    /* ignore */
  }
}

/** Видимая диагностика: одна строка на КАЖДОЕ изменение звука. Нужна, чтобы
 *  вопрос «дошёл ли сигнал площадки до игры» закрывался фактом, а не спором
 *  (01.08). Смотреть в консоли песочницы. */
function logState(): void {
  try {
    const on = (m: boolean) => (m ? "ВЫКЛ" : "вкл");
    console.log(
      `[звук] музыка: ${on(isMuted("music"))} · эффекты: ${on(isMuted("sfx"))}` +
        ` · общий мут площадки: ${bus.transientAll ? "ДА" : "нет"}` +
        ` · плееров: ${bus.sinks.size}`,
    );
  } catch {
    /* ignore */
  }
}

/** Любое изменение звука → ВСЕ звуковые UI перерисовываются по факту. */
function notifyUi(): void {
  logState();
  try {
    window.dispatchEvent(new CustomEvent("platform-audio-changed"));
  } catch {
    /* ssr/тесты */
  }
}

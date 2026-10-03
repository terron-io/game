import { Howl } from "howler";
import { assetUrl } from "../../core/AssetUrls";
import { EventBus } from "../../core/EventBus";
import { UserSettings } from "../../core/game/UserSettings";
import { isMuted, registerAudioSink, unregisterAudioSink } from "./AudioBus";
import {
  PlaySoundEffectEvent,
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
  SoundEffect,
  soundEffectUrls,
} from "./Sounds";

export const MAX_CONCURRENT_SOUNDS = 8;

// terron 11.09: ПОТОЛОК ОЧЕРЕДИ HOWLER. Пока звук не скачан/не декодирован или
// AudioContext спит (нет жеста, фон, реклама площадки), Howler НЕ играет, а
// кладёт КАЖДЫЙ play()/stop()/volume() в свою `_queue` и возвращает id как ни в
// чём не бывало. Мы честно копили activeSounds до 8 и дальше на каждый эффект
// звали ещё и stop(oldest) — всё в ту же очередь: лента событий + клики
// радиала за пару минут дают тысячи задач. На resume/load Howler раскручивает
// очередь ОДНОЙ синхронной рекурсией (`_loadQueue → stop → _emit → _loadQueue
// → …`) → «Maximum call stack size exceeded» в vendor-чанке (15 сессий/нед;
// верхние кадры `_clearTimer ← stop` и `_emit ← _ended` — две точки одной и
// той же раскрутки). Эффект — вещь сиюминутная: клик, прозвучавший через две
// минуты, хуже пропущенного, поэтому при заполненной очереди не играем вовсе.
// Первые задачи пускаем — именно play() будит контекст (Howler._autoResume).
export const MAX_HOWL_QUEUE = 16;

/** Сколько задач Howler уже держит в очереди у этого Howl (приватное поле
 *  howler 2.2 — читаем осторожно, нет поля = очереди нет). */
export function howlQueueLength(howl: unknown): number {
  const q = (howl as { _queue?: unknown })?._queue;
  return Array.isArray(q) ? q.length : 0;
}

// terron: тёплый прогрев ДЕФОЛТНОГО (самого маленького) трека в HTTP-кэш браузера.
// Зовётся из лобби ПОСЛЕ префетча карты и ТОЛЬКО при включённой музыке — карта
// всегда приоритетнее музыки. Повторные вызовы — no-op.
let musicWarmed = false;
export function warmDefaultMusic(): void {
  if (musicWarmed) return;
  musicWarmed = true;
  try {
    void fetch(assetUrl("sounds/music/tactical-glaciers.mp3")).catch(() => {});
  } catch {
    // ignore — прогрев best-effort
  }
}

// terron: мьют по требованию ПЛОЩАДКИ (GamePush: mute/unmute/pause/resume —
// реклама, сворачивание вкладки). Чек-лист модерации требует, чтобы звук
// управлялся методами SDK. Пользовательские настройки громкости НЕ трогаем →
// после unmute возвращается ровно то, что игрок выставил сам.
//
// terron 29.07: площадка различает ДОРОЖКИ — шлёт `mute:music` и `mute:sfx`
// отдельно (у нас в настройках тоже две галочки: musicMuted / soundEffectsMuted),
// поэтому глушим ровно ту, о которой попросили:
//   "all"   → Howler.mute() поверх всего (общий mute/pause);
//   "music" → только фоновые треки;
//   "sfx"   → только звуковые эффекты.
// Для точечных дорожек нужен живой SoundManager матча — его регистрирует
// конструктор (в меню инстанса нет, и глушить там нечего).

// Мут площадки идёт через ЕДИНУЮ ШИНУ (см. AudioBus.ts): менеджер
// регистрируется приёмником в конструкторе и рождается уже с актуальным
// состоянием — «выключил звук в лобби → следующий матч начался со звуком»
// больше невозможен.

export class SoundManager {
  private backgroundMusic: Howl[] = [];
  private currentTrack: number = 0;
  private soundEffects: Map<SoundEffect, Howl> = new Map();
  private soundEffectsVolume: number = 1;
  private backgroundMusicVolume: number = 0;
  private activeSounds: { howl: Howl; id: number }[] = [];
  private eventBus: EventBus;
  private onPlaySoundEffect: (e: PlaySoundEffectEvent) => void;
  private onSetBackgroundMusicVolume: (
    e: SetBackgroundMusicVolumeEvent,
  ) => void;
  private onSetSoundEffectsVolume: (e: SetSoundEffectsVolumeEvent) => void;

  constructor(eventBus: EventBus, userSettings: UserSettings) {
    this.eventBus = eventBus;
    // terron: своя фоновая музыка (AI-сген, лицензия чистая). Проприетарные
    // треки OpenFront (of4/openfront/war из /proprietary) удалены.
    // terron: preload:false + html5:true — иначе Howler качает оба mp3 (~6.3МБ)
    // сразу в конструкторе, т.е. в окно загрузки матча (конкурирует с картой/
    // воркером/скинами, ест мобильный трафик даже при выключенной музыке).
    // play() сам догружает трек; html5 = стриминг, звук начинается с буфера.
    this.safely("initialize background music", () => {
      this.backgroundMusic = [
        new Howl({
          src: [assetUrl("sounds/music/tactical-glaciers.mp3")],
          loop: false,
          onend: this.playNext.bind(this),
          volume: 0,
          preload: false,
          html5: true,
        }),
        new Howl({
          src: [assetUrl("sounds/music/war-map-hum.mp3")],
          loop: false,
          onend: this.playNext.bind(this),
          volume: 0,
          preload: false,
          html5: true,
        }),
      ];
    });
    // terron 01.08: ГРОМКОСТЬ И МУТ — РАЗНЫЕ ВЕЛИЧИНЫ, не смешивать.
    // Раньше здесь при заглушённой дорожке ставилась громкость 0, а мут
    // площадки снимался через Howl.mute() — то есть unmute поднимал мут, но
    // громкость оставалась нулевой, и звук не возвращался НИКОГДА. Ровно этот
    // сценарий поймал владелец: выключил звук площадкой в лобби → зашёл в матч
    // → включил обратно → тишина. Громкость теперь всегда пользовательская,
    // глушит только шина (registerAudioSink ниже применит текущее состояние).
    this.setBackgroundMusicVolume(userSettings.backgroundMusicVolume());
    this.setSoundEffectsVolume(userSettings.soundEffectsVolume());
    this.onPlaySoundEffect = (e) => this.playSoundEffect(e.effect);
    this.onSetBackgroundMusicVolume = (e) =>
      this.setBackgroundMusicVolume(e.volume);
    this.onSetSoundEffectsVolume = (e) => this.setSoundEffectsVolume(e.volume);
    eventBus.on(PlaySoundEffectEvent, this.onPlaySoundEffect);
    eventBus.on(SetBackgroundMusicVolumeEvent, this.onSetBackgroundMusicVolume);
    eventBus.on(SetSoundEffectsVolumeEvent, this.onSetSoundEffectsVolume);
    // Шина мута площадки: регистрация сразу применяет текущее состояние.
    registerAudioSink(this);
  }

  /** Приёмник шины звука (см. AudioBus). */
  public applyPlatformMute(track: "music" | "sfx", muted: boolean): void {
    this.setPlatformTrackMuted(track, muted);
    // Музыку могли включить, когда матч уже идёт: пока она была заглушена, мы
    // её НЕ ЗАПУСКАЛИ (политика владельца — при выключенной музыке ни одного
    // скачанного mp3). Снять мут мало, цепочку надо ещё и стартовать.
    if (track === "music" && !muted && this.musicRequested) {
      this.playBackgroundMusic();
    }
  }

  /** Слышна ли музыка прямо сейчас: и ползунок не в нуле, и никто не глушит. */
  private musicAudible(): boolean {
    return this.backgroundMusicVolume > 0 && !isMuted("music");
  }

  /** Заглушить ОДНУ дорожку по команде площадки (mute:music / mute:sfx).
   *  Пользовательскую громкость не трогаем — Howl.mute() накладывается поверх и
   *  снимается сам, поэтому после unmute звучит ровно то, что выставил игрок. */
  public setPlatformTrackMuted(kind: "music" | "sfx", muted: boolean): void {
    this.safely(`platform mute ${kind}`, () => {
      const targets =
        kind === "music"
          ? this.backgroundMusic
          : [...this.soundEffects.values()];
      for (const howl of targets) howl.mute(muted);
      if (kind === "sfx") this.platformSfxMuted = muted;
    });
  }

  // Эффекты создаются ЛЕНИВО (getOrLoadSoundEffect) — те, что родятся уже во
  // время рекламы, должны быть замьючены сразу, иначе прорвутся сквозь mute:sfx.
  private platformSfxMuted = false;

  public dispose(): void {
    unregisterAudioSink(this);
    this.eventBus.off(PlaySoundEffectEvent, this.onPlaySoundEffect);
    this.eventBus.off(
      SetBackgroundMusicVolumeEvent,
      this.onSetBackgroundMusicVolume,
    );
    this.eventBus.off(SetSoundEffectsVolumeEvent, this.onSetSoundEffectsVolume);
    this.backgroundMusic.forEach((track) => {
      this.safely("stop background track", () => track.stop());
      this.safely("unload background track", () => track.unload());
    });
    this.soundEffects.forEach((sound) => {
      this.safely("stop sound effect", () => sound.stop());
      this.safely("unload sound effect", () => sound.unload());
    });
    this.soundEffects.clear();
    this.activeSounds = [];
  }

  private safely(action: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`SoundManager: failed to ${action}`, err);
    }
  }

  // terron: флаг «матч попросил музыку». При выключенной музыке (volume 0) НЕ
  // зовём play() — иначе Howler при preload:false скачал бы трек ради беззвучного
  // проигрывания. Если игрок включит музыку в настройках mid-game — стартуем
  // из setBackgroundMusicVolume по этому флагу.
  private musicRequested = false;

  public playBackgroundMusic(): void {
    this.musicRequested = true;
    if (!this.musicAudible()) return;
    this.safely("play background music", () => {
      if (
        this.backgroundMusic.length > 0 &&
        !this.backgroundMusic[this.currentTrack].playing()
      ) {
        this.backgroundMusic[this.currentTrack].play();
      }
    });
    this.warmNextTrack();
  }

  // terron: пока играет текущий трек — тихо догружаем следующий в фоне, чтобы
  // playNext() переключился без паузы. Только при слышимой музыке.
  private warmNextTrack(): void {
    if (this.backgroundMusic.length < 2 || !this.musicAudible()) {
      return;
    }
    const next =
      this.backgroundMusic[
        (this.currentTrack + 1) % this.backgroundMusic.length
      ];
    this.safely("warm next track", () => {
      if (next.state() === "unloaded") {
        next.load();
      }
    });
  }

  public stopBackgroundMusic(): void {
    this.musicRequested = false;
    this.safely("stop background music", () => {
      if (this.backgroundMusic.length > 0) {
        this.backgroundMusic[this.currentTrack].stop();
      }
    });
  }

  public setBackgroundMusicVolume(volume: number): void {
    const wasSilent = this.backgroundMusicVolume <= 0;
    this.backgroundMusicVolume = Math.max(0, Math.min(1, volume));
    this.safely("set background music volume", () => {
      this.backgroundMusic.forEach((track) => {
        track.volume(this.backgroundMusicVolume);
      });
    });
    // terron: музыку включили во время матча — запускаем (цепочка могла
    // не стартовать или заглохнуть на конце трека при volume 0).
    if (wasSilent && this.musicAudible() && this.musicRequested) {
      this.playBackgroundMusic();
    }
  }

  // terron 04.09: Howler зовёт onend СИНХРОННО из своего _ended → _emit. Если
  // следующий трек «кончается» мгновенно (html5-дорожка с нулевой длиной:
  // оборванная догрузка, битый ответ), play() → _ended → onend → playNext →
  // play() → … без единого выхода из стека → «Maximum call stack size
  // exceeded» в vendor-чанке (5 сессий за 3 дня, всегда r._emit ← r._ended).
  // Переключаемся в СЛЕДУЮЩЕМ макротаске, а два конца подряд быстрее секунды
  // считаем битой дорожкой и выжидаем 5 с — плеер не крутится вхолостую.
  private lastPlayNextAt = 0;
  private playNext(): void {
    const now = Date.now();
    const tooFast = now - this.lastPlayNextAt < 1000;
    this.lastPlayNextAt = now;
    this.currentTrack = (this.currentTrack + 1) % this.backgroundMusic.length;
    window.setTimeout(
      () => {
        if (this.musicRequested) this.playBackgroundMusic();
      },
      tooFast ? 5000 : 0,
    );
  }

  private getOrLoadSoundEffect(name: SoundEffect): Howl | null {
    let sound = this.soundEffects.get(name);
    if (sound) return sound;
    const src = soundEffectUrls.get(name);
    if (!src) return null;
    try {
      sound = new Howl({ src: [src], volume: this.soundEffectsVolume });
      // Родился во время рекламы (площадка держит mute:sfx) — сразу глушим,
      // иначе новый эффект прорвётся сквозь мьют.
      if (this.platformSfxMuted) sound.mute(true);
      this.soundEffects.set(name, sound);
      return sound;
    } catch (err) {
      console.error(`SoundManager: failed to load sound ${name}`, err);
      return null;
    }
  }

  private removeActiveSoundById(id: number): void {
    this.activeSounds = this.activeSounds.filter((s) => s.id !== id);
  }

  public playSoundEffect(name: SoundEffect): void {
    this.safely(`play sound ${name}`, () => {
      const howl = this.getOrLoadSoundEffect(name);
      if (!howl) return;
      // Очередь Howler переполнена (звук не готов / контекст спит) — эффект
      // пропускаем, иначе кормим рекурсию на resume. См. MAX_HOWL_QUEUE.
      if (howlQueueLength(howl) >= MAX_HOWL_QUEUE) return;

      if (this.activeSounds.length >= MAX_CONCURRENT_SOUNDS) {
        const oldest = this.activeSounds[0];
        oldest.howl.stop(oldest.id);
        this.removeActiveSoundById(oldest.id);
      }

      const id = howl.play();
      this.activeSounds.push({ howl, id });
      howl.once("end", () => this.removeActiveSoundById(id), id);
      howl.once("stop", () => this.removeActiveSoundById(id), id);
    });
  }

  public setSoundEffectsVolume(volume: number): void {
    this.soundEffectsVolume = Math.max(0, Math.min(1, volume));
    this.safely("set sound effects volume", () => {
      this.soundEffects.forEach((sound) => {
        sound.volume(this.soundEffectsVolume);
      });
    });
  }

  public stopSoundEffect(name: SoundEffect): void {
    this.safely(`stop sound ${name}`, () => {
      const howl = this.soundEffects.get(name);
      if (howl) {
        howl.stop();
        this.activeSounds = this.activeSounds.filter((s) => s.howl !== howl);
      }
    });
  }
}

import { Howl } from "howler";
import { assetUrl } from "../../core/AssetUrls";
import { UserSettings } from "../../core/game/UserSettings";
import {
  isMuted,
  registerAudioSink,
  setMutedByUser,
  unregisterAudioSink,
} from "./AudioBus";

// terron: МУЗЫКА В ЛОББИ — отдельный плеер от игрового SoundManager. Один
// зацикленный трек (дефолтный `tactical-glaciers`, он же прогревается в лобби).
// ⚠️ СВОЕЙ ГАЛКИ У ЛОББИ БОЛЬШЕ НЕТ (ТЗ владельца 01.08: сквозная
// синхронизация звука с площадкой, никаких локальных параметров). Тумблер ♫ —
// это ОБЩИЙ выключатель музыки из AudioBus, тот же, что в настройках игры и в
// паузе, синхронный с площадкой. При выключенной музыке mp3 НЕ качается
// (preload:false + play только когда реально играем) — политика
// «карта важнее музыки».
//
// ⚠️ БЕЗ ФЕЙДОВ И БЕЗ ЖОНГЛИРОВАНИЯ ГРОМКОСТЬЮ. Два провала 01.08:
//   1) fade→fade при быстрых кликах оставлял живой интервал и залипшую
//      нулевую громкость — «иконка вкл, музыка мертва»;
//   2) Howler ставит вызовы в ОЧЕРЕДЬ, пока трек грузится, а stop() эту
//      очередь чистит — после серии переключений трек играл с volume 0.
// Поэтому: громкость задаётся ОДИН раз при создании и больше не трогается,
// переключение = play/pause, мут площадки = mute(). Рассинхронизироваться
// нечему (воспроизведено и проверено на стенде).

const TARGET_VOLUME = 0.45; // громкость лобби-музыки (крутить здесь)
const FADE_OUT_MS = 140; // мягкий спад перед паузой, чтобы не щёлкало

export class LobbyMusic {
  private howl: Howl | null = null;
  private playing = false;
  /** Музыку просили играть, но её держал мут площадки — включим при снятии. */
  private wantPlaying = false;
  /** Модалка подписывается, чтобы иконка ♫ показывала ФАКТ, а не желание. */
  onStateChange: (() => void) | null = null;

  constructor(private readonly userSettings: UserSettings) {
    registerAudioSink(this);
  }

  /** Своя галка игрока (тумблер ♫ в лобби). */
  get muted(): boolean {
    return isMuted("music");
  }

  /** Фактически ли сейчас звучит музыка — для иконки в шапке лобби. */
  get effectivelyOn(): boolean {
    return this.playing && !isMuted("music");
  }

  /** Приёмник шины звука (AudioBus). Лобби-музыка — дорожка music. */
  applyPlatformMute(track: "music" | "sfx", muted: boolean): void {
    if (track !== "music") return;
    try {
      if (this.playing) {
        this.howl?.mute(muted);
      } else if (!muted && this.wantPlaying) {
        this.wantPlaying = false;
        this.start();
      }
    } catch {
      /* best-effort */
    }
    this.onStateChange?.();
  }

  private ensureHowl(): Howl {
    if (this.howl) return this.howl;
    this.howl = new Howl({
      src: [assetUrl("sounds/music/tactical-glaciers.mp3")],
      loop: true,
      volume: TARGET_VOLUME, // ставится ОДИН раз и больше не меняется
      preload: false, // качаем mp3 только когда реально играем
      html5: true,
    });
    return this.howl;
  }

  /** Вход в лобби / тумблер «включить». */
  start(): void {
    registerAudioSink(this);
    if (this.muted) {
      // музыка выключена (нами или площадкой — состояние ОДНО): mp3 не качаем,
      // запоминаем желание и включимся, когда мут снимут.
      this.wantPlaying = true;
      this.onStateChange?.();
      return;
    }
    if (this.playing) return;
    this.wantPlaying = false;
    this.playing = true;
    this.gen++; // отменяет отложенную паузу от предыдущего выключения
    try {
      const h = this.ensureHowl();
      h.mute(false);
      h.volume(TARGET_VOLUME); // снимает висящий фейд и восстанавливает уровень
      if (!h.playing()) h.play();
    } catch {
      /* best-effort — музыка не критична */
    }
    this.onStateChange?.();
  }

  /** Выход из лобби / старт матча / тумблер «выключить».
   *  Короткий спад громкости перед паузой — иначе резкий обрыв щёлкает
   *  («слегка пукает», репорт владельца 01.08). Отложенная пауза защищена
   *  счётчиком поколений: повторное включение отменяет её, а громкость всегда
   *  возвращается к целевой в start() — залипнуть на нуле нечему. */
  stop(): void {
    this.wantPlaying = false;
    if (!this.howl || !this.playing) return;
    this.playing = false;
    const h = this.howl;
    const token = ++this.gen;
    try {
      h.fade(h.volume() as number, 0, FADE_OUT_MS);
      window.setTimeout(() => {
        if (token !== this.gen) return; // отменено новым включением
        try {
          h.pause();
          h.volume(TARGET_VOLUME); // вернуть на место для следующего пуска
        } catch {
          /* ignore */
        }
      }, FADE_OUT_MS + 20);
    } catch {
      try {
        h.pause();
      } catch {
        /* ignore */
      }
    }
    this.onStateChange?.();
  }
  private gen = 0;

  /** Кнопка-иконка: включить/выключить. */
  toggle(): void {
    // Тумблер ♫ = ОБЩИЙ выключатель музыки: пишем в шину, она применяет ко
    // всем плеерам, обновляет иконки и докладывает площадке (ТЗ: сквозная
    // синхронизация, никаких локальных параметров).
    const turnOn = isMuted("music");
    setMutedByUser("music", !turnOn);
    if (turnOn) this.start();
    else this.stop();
    this.onStateChange?.();
  }

  dispose(): void {
    unregisterAudioSink(this);
    this.stop();
    if (this.howl) {
      try {
        this.howl.unload();
      } catch {
        /* ignore */
      }
      this.howl = null;
    }
  }
}

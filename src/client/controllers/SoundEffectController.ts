import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { GameView, UnitView } from "../../core/game/GameView";
import { Controller } from "../Controller";
import { buzz } from "../Haptics";
import { PlaySoundEffectEvent, SoundEffect } from "../sound/Sounds";

export class SoundEffectController implements Controller {
  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
  ) {}

  private mapLoadedFanfare = false;

  tick(): void {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    // terron: фанфара — (1) когда карта загрузилась (первый тик, видишь карту),
    // (2) когда раунд стартовал (конец фазы спавна). Военный горн «к атаке».
    if (!this.mapLoadedFanfare) {
      this.mapLoadedFanfare = true;
      this.emit("game-start");
    }
    if ((updates[GameUpdateType.SpawnPhaseEnd] ?? []).length > 0) {
      this.emit("game-start");
    }

    for (const u of updates[GameUpdateType.Unit] ?? []) {
      const unit = this.game.unit(u.id);
      if (unit === undefined) continue;
      this.handleUnit(unit);
    }

    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) return;
    for (const c of updates[GameUpdateType.ConquestEvent] ?? []) {
      if (c.conquerorId === myPlayer.id()) {
        this.emit("ka-ching");
        buzz("light"); // terron: короткий тик, когда ТЫ кого-то съел (+голда)
      }
    }
  }

  private handleUnit(unit: UnitView): void {
    if (unit.isActive() && unit.createdAt() === this.game.ticks()) {
      this.onCreated(unit);
    }
    switch (unit.type()) {
      case UnitType.AtomBomb:
      case UnitType.MIRVWarhead:
        this.onNukeDetonation(unit, "atom-hit");
        break;
      case UnitType.HydrogenBomb:
        this.onNukeDetonation(unit, "hydrogen-hit");
        break;
    }
  }

  private onCreated(unit: UnitView): void {
    const myPlayer = this.game.myPlayer();
    // terron: вибро при запуске СВОЕЙ ядерки (чужие не считаем — иначе спам).
    const myNuke = unit.owner() === myPlayer;
    switch (unit.type()) {
      case UnitType.AtomBomb:
        this.emit("atom-launch");
        if (myNuke) buzz("heavy");
        break;
      case UnitType.HydrogenBomb:
        this.emit("hydrogen-launch");
        if (myNuke) buzz("heavy");
        break;
      case UnitType.MIRV:
        this.emit("mirv-launch");
        if (myNuke) buzz("heavy");
        break;
      case UnitType.Warship:
        if (unit.owner() === myPlayer) this.emit("build-warship");
        break;
      case UnitType.City:
        if (unit.owner() === myPlayer) this.emit("build-city");
        break;
      case UnitType.Port:
        if (unit.owner() === myPlayer) this.emit("build-port");
        break;
      case UnitType.DefensePost:
        if (unit.owner() === myPlayer) this.emit("build-defense-post");
        break;
      case UnitType.SAMLauncher:
        if (unit.owner() === myPlayer) this.emit("sam-built");
        break;
    }
  }

  private onNukeDetonation(unit: UnitView, sound: SoundEffect): void {
    if (unit.isActive()) return;
    if (!unit.reachedTarget()) return;
    this.emit(sound);
  }

  private emit(sound: SoundEffect): void {
    this.eventBus.emit(new PlaySoundEffectEvent(sound));
  }
}

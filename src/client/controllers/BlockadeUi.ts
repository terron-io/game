// terron: ПИРАТСТВО — клиентские помощники каста «Блокада» (TZ-ult-unlocks.md).
import { UnitType } from "../../core/game/Game";
import { GameView } from "../../core/game/GameView";

/** Свободные пиратские лодки (не на миссии): subState 3 — обычная пиратская. */
export function freePirateBoats(game: GameView): number {
  const me = game.myPlayer();
  if (!me) return 0;
  return me.units(UnitType.Warship).filter((u) => u.subState() === 3).length;
}

/** Сколько лодок уйдёт в блокаду при текущем слайдере атаки (минимум одна). */
export function blockadeShipsToSend(game: GameView, ratio: number): number {
  const free = freePirateBoats(game);
  if (free === 0) return 0;
  return Math.max(1, Math.min(free, Math.round(free * ratio)));
}

import { PlayerType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { L } from "../../Utils";

// terron 22.08: донат СОЮЗНИКУ-ЧЕЛОВЕКУ гейтится настройкой лобби
// (donateGold/donateTroops), а НАЦИЯМ разрешён всегда — проверка в
// PlayerImpl.canDonate* смотрит только на PlayerType.Human. В публичных FFA
// (включая золотой и алмазный) настройка выключена — см. MapPlaylist.gameConfig
// (`donateGold: mode === GameMode.Team`). Раньше кнопка в такой ситуации просто
// исчезала: игрок видел донат у нации, не видел у союзника-человека и считал
// это багом (два репорта в ТГ 22.08). Здесь — общий детект «выключено режимом»
// и единый текст объяснения для панели игрока и радиального меню.

/** Донат этому получателю невозможен ИМЕННО из-за настройки лобби. */
export function donateOffByMode(
  game: GameView,
  my: PlayerView,
  other: PlayerView,
  kind: "gold" | "troops",
): boolean {
  if (other === my || other.type() !== PlayerType.Human) return false;
  if (!my.isFriendly(other)) return false;
  return kind === "gold"
    ? !game.config().donateGold()
    : !game.config().donateTroops();
}

export function donateOffText(): string {
  return L(
    "В этом режиме донат игрокам отключён — делиться можно только с нациями",
    "Donations between players are off in this mode — nations only",
  );
}

/**
 * MyNameController — сообщает WebGL-виду, кто из игроков «я», чтобы СВОЙ ник
 * рисовался всегда: не отсекался порогом зума и не мельчал ниже читаемого
 * (логика в name.vert.glsl / icon.vert.glsl / status-icon.vert.glsl).
 *
 * Свой игрок появляется не сразу (спавн-фаза, реконнект), а в реплее и у
 * спектатора его нет вовсе — поэтому просто опрашиваем раз в секунду и шлём
 * во вью только при СМЕНЕ. Ставится smallID: в рендере игроки живут под ним.
 */

import { GameView } from "../../core/game/GameView";
import { Controller } from "../Controller";
import { GameView as WebGLGameView } from "../render/gl";

export class MyNameController implements Controller {
  private lastOwnerID = -1;

  constructor(
    private game: GameView,
    private view: WebGLGameView,
  ) {}

  getTickIntervalMs(): number {
    return 1000;
  }

  tick(): void {
    const me = this.game.myPlayer();
    const ownerID = me ? me.smallID() : 0;
    if (ownerID === this.lastOwnerID) return;
    this.lastOwnerID = ownerID;
    this.view.setMyOwner(ownerID);
  }
}

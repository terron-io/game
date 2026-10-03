// terron 22.09: ЧЕСТНЫЙ БОТ — восприятие. Единственное окно, через которое
// СОБСТВЕННАЯ логика бота (выбор ульты, реакции) смотрит на мир: только то,
// что видит живой игрок на экране. new-units/FAIRBOT.md
//
// Что закрыто, ровно как у человека:
//  * «Закрытая страна» — войск не видно («???» в панели и на карте), зданий и
//    техники тоже (ClosedCountryFilter на клиенте прячет юниты);
//  * туман войны (опция лобби) — бот видит только тех, с кем граничит, и
//    союзников. Грубее настоящего радиуса видимости, но никогда не ЗОРЧЕ.
//
// ⚠️ ЧЕСТНО ПРО v1: переиспользованные поведения наций (атака, стройка,
// ядерки, флот) по-прежнему читают мир целиком — это их устройство. Сюда
// переезжает только НОВАЯ логика. Перевод старых поведений на восприятие —
// вторая волна (см. FAIRBOT.md, «Что не сделано»).
import {
  Game,
  Player,
  PlayerType,
  TerraNullius,
  Unit,
  UnitType,
} from "../../game/Game";
import { FairBotSignals } from "./FairBotPlaybook";

export class FairBotPerception {
  constructor(
    private readonly game: Game,
    private readonly me: Player,
  ) {}

  /** Скрыта ли страна от меня «Закрытой страной». Себя и команду видно. */
  private closedTo(p: Player): boolean {
    return (
      p !== this.me &&
      !this.me.isOnSameTeam(p) &&
      p.hasUltimate(UnitType.ClosedCountry)
    );
  }

  /** Видна ли мне страна вообще (туман войны). */
  canSee(p: Player): boolean {
    if (p === this.me) return true;
    if (!this.game.config().fogOfWar()) return true;
    return this.me.isFriendly(p) || this.me.sharesBorderWith(p);
  }

  /** Войска страны, как их видит игрок. null — «???» или не видно. */
  troopsOf(p: Player): number | null {
    if (!this.canSee(p) || this.closedTo(p)) return null;
    return p.troops();
  }

  /** Чужие (не мои, не союзные, не командные) юниты типа, видимые мне. */
  visibleEnemyUnits(type: UnitType): Unit[] {
    const out: Unit[] = [];
    for (const u of this.game.units(type)) {
      const owner = u.owner();
      if (owner === this.me) continue;
      if (this.me.isFriendly(owner) || this.me.isOnSameTeam(owner)) continue;
      if (!this.canSee(owner) || this.closedTo(owner)) continue;
      out.push(u);
    }
    return out;
  }

  /**
   * Соседи-игроки по СУХОПУТНОЙ границе, в порядке обхода границы
   * (порядок детерминирован — от него зависят решения бота, то есть хэш).
   */
  landNeighbors(): Player[] {
    const me = this.me.smallID();
    const seen = new Set<Player>();
    for (const t of this.me.borderTiles()) {
      for (const n of this.game.neighbors(t)) {
        if (!this.game.isLand(n)) continue;
        const oid = this.game.ownerID(n);
        if (oid === me || oid === 0) continue;
        const o = this.game.playerBySmallID(oid) as Player | TerraNullius;
        if (o.isPlayer() && o.isAlive()) seen.add(o);
      }
    }
    return [...seen];
  }

  /** Сигналы для выбора ульты. Считаются по своей границе и видимым соседям. */
  signals(): FairBotSignals {
    const me = this.me.smallID();
    let border = 0;
    let landFront = 0;
    let seaFront = 0;
    for (const t of this.me.borderTiles()) {
      border++;
      if (this.game.isShore(t)) seaFront++;
      for (const n of this.game.neighbors(t)) {
        if (!this.game.isLand(n)) continue;
        const oid = this.game.ownerID(n);
        if (oid !== me && oid !== 0) {
          landFront++;
          break;
        }
      }
    }
    const neighbors = this.landNeighbors().filter(
      (p) => p.type() !== PlayerType.Bot,
    );
    let neighborBunkers = 0;
    for (const n of neighbors) {
      if (!this.canSee(n) || this.closedTo(n)) continue;
      neighborBunkers += n.units(UnitType.DefensePost).length;
    }
    return {
      landFront: border === 0 ? 0 : landFront / border,
      seaFront: border === 0 ? 0 : seaFront / border,
      neighborBunkers,
      neighbors: neighbors.length,
    };
  }
}

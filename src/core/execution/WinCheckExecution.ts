import { GameEvent } from "../EventBus";
import {
  ColoredTeams,
  Execution,
  Game,
  GameMode,
  MessageType,
  Player,
  PlayerType,
  RankedType,
  Team,
} from "../game/Game";
import { GameUpdateType } from "../game/GameUpdates";

export class WinEvent implements GameEvent {
  constructor(public readonly winner: Player) {}
}

export class WinCheckExecution implements Execution {
  private active = true;

  private mg: Game | null = null;

  // Hard time limit (in seconds) to force a winner before the server's
  // maxGameDuration hard kill. 170mins (10 mins before 3hrs)
  private static readonly HARD_TIME_LIMIT_SECONDS = 170 * 60;

  // ─── terron 26.08: ПОБЕДА С УДЕРЖАНИЕМ ────────────────────────────────────
  // Порог территории надо продержать N секунд (Config.victoryHoldTurns), и всё
  // это время сверху идёт полоса-отсчёт. Упал ниже порога — отсчёт сброшен.
  //
  // ⚠️ Состояние живёт В ЭКЗЕКУЦИИ и считается В ТИКАХ — ни Date, ни random,
  // поэтому симуляция остаётся детерминированной и реплеи воспроизводятся.
  //
  // ⚠️ Ключ — СТРОКА («p:<id>» / «t:<team>»), потому что в ФФА держит игрок, а
  // в командном — команда. Сменился держатель — отсчёт начинается заново.
  private holdKey: string | null = null;
  private holdStartTick = 0;

  // terron 01.09: отсчёт объявляется ЛЕНТОЙ, а не только полосой сверху.
  // Репорт тестера: панель наведённого игрока накрывает плашку, и что
  // происходит — прочитать негде. Лента переживает наведение и остаётся в
  // истории, то есть отвечает на «а что это было» и через минуту.
  //
  // ⚠️ Объявляем НЕ ЧАЩЕ раза в VICTORY_ANNOUNCE_COOLDOWN на одного и того же
  // держателя: у порога лидер обычно колеблется (отбили пару тайлов — отсчёт
  // сброшен, вернул — начался заново), и без этого лента забьётся одной
  // строкой. Сменился держатель — объявляем сразу, это уже другая новость.
  private static readonly VICTORY_ANNOUNCE_COOLDOWN = 30 * 10;
  private announcedKey: string | null = null;
  private announcedTick = 0;
  private announcedName = "";
  // «Старт объявляли — значит про отмену тоже обязаны сказать». Отдельный флаг,
  // а не обнуление announcedKey: обнулив ключ, мы бы сняли и кулдаун, и лидер,
  // качающийся у порога, объявлялся бы заново каждые пару секунд.
  private stopPending = false;

  constructor() {}

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (ticks % 10 !== 0) {
      return;
    }
    if (this.mg === null) throw new Error("Not initialized");

    if (this.mg.config().gameConfig().gameMode === GameMode.FFA) {
      this.checkWinnerFFA();
    } else {
      this.checkWinnerTeam();
    }
  }

  /**
   * Победа по ЧАСАМ (лимит лобби или общий потолок матча) — мгновенная.
   * Удерживать тут нечего: время вышло у всех сразу, а лишние секунды
   * неопределённости в конце по таймеру только путают.
   */
  private timeIsUp(): boolean {
    if (this.mg === null) throw new Error("Not initialized");
    const timeElapsed = this.mg.elapsedGameSeconds();
    const maxTimer = this.mg.config().gameConfig().maxTimerValue;
    return (
      (maxTimer !== undefined &&
        maxTimer !== null &&
        timeElapsed - maxTimer * 60 >= 0) ||
      timeElapsed >= WinCheckExecution.HARD_TIME_LIMIT_SECONDS
    );
  }

  /** Снять отсчёт (лидер упал ниже порога, сменился или матч кончился). */
  private clearHold(): void {
    if (this.mg === null) throw new Error("Not initialized");
    if (this.holdKey === null) return;
    // Отбили — говорим об этом, иначе игрок видит «победа через 10» и тишину.
    // Только если старт РЕАЛЬНО объявляли (иначе строка-сирота).
    if (this.stopPending) {
      this.stopPending = false;
      this.mg.displayMessage(
        "events_display.victory_countdown_stopped",
        MessageType.VICTORY_COUNTDOWN,
        null,
        undefined,
        { name: this.announcedName },
      );
    }
    this.holdKey = null;
    this.mg.addUpdate({
      type: GameUpdateType.VictoryCountdown,
      active: false,
      playerSmallID: 0,
      teamName: "",
      thresholdPct: 0,
      startTick: 0,
      endTick: 0,
    });
  }

  /**
   * Порог взят. Возвращает true, если удержание УЖЕ добрано и победу пора
   * объявлять; false — если отсчёт только идёт.
   *
   * ⚠️ Отсчёт публикуется ОДИН раз при старте: клиент получает окно и считает
   * остаток сам. Повторно слать нечего — окно не двигается.
   */
  private holdSatisfied(
    key: string,
    leaderSmallID: number,
    teamName: string,
  ): boolean {
    if (this.mg === null) throw new Error("Not initialized");
    const holdTurns = this.mg.config().victoryHoldTurns();
    if (holdTurns <= 0) return true;

    const now = this.mg.ticks();
    if (this.holdKey !== key) {
      this.holdKey = key;
      this.holdStartTick = now;
      this.mg.addUpdate({
        type: GameUpdateType.VictoryCountdown,
        active: true,
        playerSmallID: leaderSmallID,
        teamName,
        thresholdPct: Math.round(this.mg.config().percentageTilesOwnedToWin()),
        startTick: now,
        endTick: now + holdTurns,
      });
      this.announceCountdown(key, leaderSmallID, teamName, holdTurns, now);
      return false;
    }
    return now - this.holdStartTick >= holdTurns;
  }

  /**
   * Строка в ленту: «<держатель> победит через N с — отбей у него больше X%».
   *
   * ⚠️ Имя держателя берём ИЗ СИМУЛЯЦИИ (`player.name()` / название команды), а
   * не с клиента: строка одна на всех, и подставлять её должен тот, кто знает
   * правду. Перевод и порядок слов доделает клиент по ключу — поэтому в params
   * едут ГОЛЫЕ значения, без склеенного текста.
   */
  private announceCountdown(
    key: string,
    leaderSmallID: number,
    teamName: string,
    holdTurns: number,
    now: number,
  ): void {
    if (this.mg === null) throw new Error("Not initialized");
    if (
      this.announcedKey === key &&
      now - this.announcedTick < WinCheckExecution.VICTORY_ANNOUNCE_COOLDOWN
    ) {
      return;
    }
    const name =
      teamName !== ""
        ? teamName
        : ((
            this.mg.playerBySmallID(leaderSmallID) as Player | undefined
          )?.name?.() ?? "");
    if (name === "") return;
    this.announcedKey = key;
    this.announcedTick = now;
    this.announcedName = name;
    this.stopPending = true;
    this.mg.displayMessage(
      "events_display.victory_countdown",
      MessageType.VICTORY_COUNTDOWN,
      null,
      undefined,
      {
        name,
        seconds: Math.ceil(holdTurns / 10),
        pct: Math.round(this.mg.config().percentageTilesOwnedToWin()),
      },
    );
  }

  checkWinnerFFA(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const sorted = this.mg
      .players()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    if (sorted.length === 0) {
      return;
    }

    if (this.mg.config().gameConfig().rankedType === RankedType.OneVOne) {
      const humans = sorted.filter(
        (p) => p.type() === PlayerType.Human && !p.isDisconnected(),
      );
      if (humans.length === 1) {
        // Соперник вышел — ждать удержания не перед кем.
        this.clearHold();
        this.mg.setWinner(humans[0], this.mg.stats().stats());
        console.log(`${humans[0].name()} has won the game`);
        this.active = false;
        return;
      }
    }

    const max = sorted[0];

    if (this.timeIsUp()) {
      this.clearHold();
      this.mg.setWinner(max, this.mg.stats().stats());
      console.log(`${max.name()} has won the game (time limit)`);
      this.active = false;
      return;
    }

    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();
    const percentage =
      numTilesWithoutFallout > 0
        ? (max.numTilesOwned() / numTilesWithoutFallout) * 100
        : 0;

    if (percentage <= this.mg.config().percentageTilesOwnedToWin()) {
      this.clearHold();
      return;
    }

    // Некому смотреть на отсчёт: живых соперников не осталось вовсе.
    const rivalsAlive = sorted.some((p) => p !== max && p.isAlive());
    if (
      !rivalsAlive ||
      this.holdSatisfied(`p:${max.id()}`, max.smallID(), "")
    ) {
      this.mg.setWinner(max, this.mg.stats().stats());
      console.log(`${max.name()} has won the game`);
      this.active = false;
    }
  }

  checkWinnerTeam(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const teamToTiles = new Map<Team, number>();
    for (const player of this.mg.players()) {
      const team = player.team();
      // Sanity check, team should not be null here
      if (team === null) continue;
      teamToTiles.set(
        team,
        (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
      );
    }
    const sorted = Array.from(teamToTiles.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    if (sorted.length === 0) {
      return;
    }
    const max = sorted[0];
    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();
    const percentage =
      numTilesWithoutFallout > 0 ? (max[1] / numTilesWithoutFallout) * 100 : 0;

    if (this.timeIsUp()) {
      this.clearHold();
      if (max[0] === ColoredTeams.Bot) return;
      this.mg.setWinner(max[0], this.mg.stats().stats());
      console.log(`${max[0]} has won the game (time limit)`);
      this.active = false;
      return;
    }

    if (percentage <= this.mg.config().percentageTilesOwnedToWin()) {
      this.clearHold();
      return;
    }
    if (max[0] === ColoredTeams.Bot) {
      this.clearHold();
      return;
    }

    // Лидер команды — для подписи над полосой (у команды нет своего smallID).
    const leader = this.mg
      .players()
      .filter((p) => p.team() === max[0])
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0];

    if (
      this.holdSatisfied(`t:${max[0]}`, leader?.smallID() ?? 0, `${max[0]}`)
    ) {
      this.mg.setWinner(max[0], this.mg.stats().stats());
      console.log(`${max[0]} has won the game`);
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

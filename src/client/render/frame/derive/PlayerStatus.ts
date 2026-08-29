import type { PlayerState, PlayerStatusData, UnitState } from "../../types";
import { NUKE_TYPES, UT_MIRV_WARHEAD } from "../../types";

/** Unit types that indicate an active nuke is in flight. */
const NUKE_ACTIVE_TYPES: ReadonlySet<string> = new Set([
  ...NUKE_TYPES,
  UT_MIRV_WARHEAD,
]);

const OWNER_MASK = 0xfff;

export interface ComputePlayerStatusOptions {
  /**
   * Local player smallID for computing relative flags. Omit (or set to 0)
   * for replay mode — relative flags will all be false.
   */
  localPlayerSmallID?: number;
  /**
   * Local player string ID for matching outgoing alliance requests.
   */
  localPlayerID?: string;
  /**
   * Во время фазы спавна «лидер по тайлам» бессмысленен — корону не выдаём
   * (иначе она висит над игроком ещё до старта матча).
   */
  inSpawnPhase?: boolean;
  /**
   * Tile state buffer (the same Uint16Array exposed via FrameData.tileState).
   * Used to determine if a nuke's target tile is owned by the local player
   * for the `nukeTargetsMe` flag. If omitted, `nukeTargetsMe` stays false.
   */
  tileState?: Uint16Array;
  /**
   * Current game tick to evaluate alliance progress.
   */
  tick?: number;
  /**
   * Static duration of an alliance to evaluate fraction.
   */
  allianceDuration?: number;
  /**
   * Predicate testing if the local player considers `sid` a transitive target.
   */
  isTransitiveTarget?: (sid: number) => boolean;
}

/**
 * Compute per-player status flags for the name/status-icon pass.
 *
 * Without `opts.localPlayerSmallID`: replay-path mode. Crown/traitor/disconnected/
 * nukeActive are populated; relative flags (alliance/target/embargo/
 * nukeTargetsMe) are all false.
 *
 * With `opts.localPlayerSmallID`: live mode. Relative flags compare each player
 * against the local player's state to determine alliance/target/embargo;
 * if `opts.tileState` is also given, `nukeTargetsMe` is set for players
 * whose in-flight nuke is targeting one of the local player's tiles.
 */
export function computePlayerStatus(
  players: ReadonlyMap<number, PlayerState>,
  units: ReadonlyMap<number, UnitState>,
  opts: ComputePlayerStatusOptions = {},
): Map<number, PlayerStatusData> {
  const result = new Map<number, PlayerStatusData>();
  const localPlayerSmallID = opts.localPlayerSmallID ?? 0;
  const localPlayerID = opts.localPlayerID ?? "";
  const localPlayer =
    localPlayerSmallID > 0 ? players.get(localPlayerSmallID) : undefined;
  const tileState = opts.tileState;

  // Crown: alive player with most tiles owned. В фазе спавна короны нет.
  let crownSmallID = -1;
  if (!opts.inSpawnPhase) {
    let maxTiles = 0;
    for (const ps of players.values()) {
      if (!ps.isAlive) continue;
      if (ps.tilesOwned > maxTiles) {
        maxTiles = ps.tilesOwned;
        crownSmallID = ps.smallID;
      }
    }
  }

  // terron ПЕРФ (08.08): ОДИН ПРЕДПРОХОД ПО ЮНИТАМ ВМЕСТО N.
  // Раньше для КАЖДОГО живого игрока здесь шёл полный скан units.values() —
  // O(живых × юнитов) на тик, и не в воркере, а в ГЛАВНОМ потоке: при 100 живых
  // и 1-2 тыс. юнитов это 100-200 тыс. итераций каждый тик, то есть прямой удар
  // по плавности кадра и по времени догона после F5.
  // Обе метки зависят ТОЛЬКО от владельца юнита, поэтому считаются разом:
  //   nukeActive     — у владельца есть активная ядерка;
  //   nukeTargetsMe  — у владельца есть активная ядерка, нацеленная на меня.
  // Семантика прежняя: старый цикл выставлял те же два флага по ЛЮБОМУ
  // подходящему юниту (ранний break лишь прекращал поиск, когда оба уже верны).
  const nukeOwners = new Set<number>();
  const nukeTargetsMeOwners = new Set<number>();
  const canTargetMe = localPlayerSmallID > 0 && tileState !== undefined;
  for (const u of units.values()) {
    if (!u.isActive || !NUKE_ACTIVE_TYPES.has(u.unitType)) continue;
    nukeOwners.add(u.ownerID);
    if (
      canTargetMe &&
      u.targetTile !== null &&
      (tileState![u.targetTile] & OWNER_MASK) === localPlayerSmallID
    ) {
      nukeTargetsMeOwners.add(u.ownerID);
    }
  }

  for (const ps of players.values()) {
    if (!ps.isAlive) continue;
    const sid = ps.smallID;
    const crown = sid === crownSmallID;
    const traitor = ps.isTraitor;
    const disconnected = ps.isDisconnected;
    const traitorRemainingTicks = ps.traitorRemainingTicks;

    // Relative flags
    let nukeActive = false;
    let nukeTargetsMe = false;
    let alliance = false;
    let target = false;
    let embargo = false;
    let allianceReq = false;
    let allianceFraction = 0;

    // Nukes: обе метки уже посчитаны ОДНИМ предпроходом выше (см. nukeOwners).
    nukeActive = nukeOwners.has(sid);
    nukeTargetsMe = nukeTargetsMeOwners.has(sid);

    // Flags which are only meaningful when there's a local player,
    // and we're not looking at the local player itself.
    if (localPlayer !== undefined && sid !== localPlayerSmallID) {
      alliance = localPlayer.allies.includes(sid);
      allianceReq = ps.outgoingAllianceRequests.includes(localPlayerID);
      target = opts.isTransitiveTarget
        ? opts.isTransitiveTarget(sid)
        : localPlayer.targets.includes(sid);
      // Embargo is bilateral: either side embargoes the other.
      embargo =
        localPlayer.embargoes.includes(sid) ||
        ps.embargoes.includes(localPlayerSmallID);

      if (
        alliance &&
        opts.tick !== undefined &&
        opts.allianceDuration !== undefined &&
        opts.localPlayerID
      ) {
        const foundAlliance = ps.alliances.find(
          (a) => a.other === opts.localPlayerID,
        );
        if (foundAlliance) {
          // e.g. expiresAt = 100, tick = 60, diff = 40. duration = 100. fraction = 0.4.
          const remainingTicks = Math.max(
            0,
            foundAlliance.expiresAt - opts.tick,
          );
          allianceFraction = Math.max(
            0,
            Math.min(1, remainingTicks / Math.max(1, opts.allianceDuration)),
          );
        }
      }
    }

    if (
      crown ||
      traitor ||
      disconnected ||
      traitorRemainingTicks > 0 ||
      nukeActive ||
      alliance ||
      allianceReq ||
      target ||
      embargo ||
      nukeTargetsMe
    ) {
      result.set(sid, {
        crown,
        traitor,
        disconnected,
        alliance,
        allianceReq,
        target,
        embargo,
        nukeActive,
        nukeTargetsMe,
        traitorRemainingTicks,
        allianceFraction,
      });
    }
  }
  return result;
}

import {
  NAV_GOAL_HYSTERESIS_TILES,
  NAV_REPLAN_INTERVAL_MS,
  NAV_STALL_COOLDOWN_MS,
  NAV_STALL_MS,
  NAV_WAYPOINT_REACH_X_PX,
  NAV_WAYPOINT_REACH_Y_PX,
} from '../constants';
import type { EnemyHelperScene } from './enemyHelperScene';
import { TILE_PX } from './enemyLeapProbes';

// A* nav path-following bookkeeping (NavGraph / NavPathfinder), one instance
// per Enemy. When aggro but blind to the target, the enemy follows an A*
// route toward the target's standable cell instead of grinding straight at
// it. navPath holds the world-px waypoints; navPathIdx is the current one;
// the rest throttle replans and detect when the goal has moved to a new
// tile. Shared by the chase and last-seen-search code (only one runs per
// frame). Steering toward the returned waypoint (velocity/facing writes)
// stays in Enemy — this class owns only the route state. Mirrors the
// TeleportCoordinator / EnemyRespawnManager precedent of a small
// state-owning helper class.
export class EnemyNavFollower {
  private navPath: ReadonlyArray<{ x: number; y: number }> | null = null;
  private navPathIdx = 0;
  private navReplanAt = 0;
  private navGoalCellX = Number.NaN;
  private navGoalCellY = Number.NaN;
  // Stall watchdog: wall-clock time of the last waypoint ADVANCE. If no
  // waypoint advances for NAV_STALL_MS the route is abandoned (see follow).
  private navProgressAt = 0;
  // After a stall-abandon, path-following is suppressed until this time so the
  // enemy doesn't immediately re-path an unmakeable route (anti-bounce).
  private navSuppressUntil = 0;

  // Maintains and advances an A* path from the follower's foot point
  // (startX, startY) toward (goalX, goalY) — the target's foot point —
  // returning the world-px waypoint to steer toward this frame, or null
  // when no route exists or the path is exhausted (caller falls back to
  // reactive steering). Replans on a throttle, when the goal moves to a new
  // tile, or when the path runs out. Grounded callers only.
  follow(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    now: number,
    helper: Pick<EnemyHelperScene, 'findEnemyPath'>,
  ): { x: number; y: number } | null {
    // Post-stall cooldown: after abandoning a route it couldn't make progress on,
    // don't immediately re-path the same way — use reactive locomotion for a beat
    // so the enemy doesn't oscillate on an unmakeable jump.
    if (now < this.navSuppressUntil) return null;
    const goalCellX = Math.floor(goalX / TILE_PX);
    const goalCellY = Math.floor(goalY / TILE_PX);
    // Replan on the throttle, when the path is gone/exhausted, or when the goal
    // has drifted at least NAV_GOAL_HYSTERESIS_TILES from the cell the current
    // path targets. The hysteresis stops a walking player thrashing the path (and
    // the follow direction) every tile crossed. The `!(... < ...)` form replans
    // when the prior goal cell is NaN (first call), too.
    const goalShift = Math.max(
      Math.abs(goalCellX - this.navGoalCellX),
      Math.abs(goalCellY - this.navGoalCellY),
    );
    if (
      this.navPath === null ||
      now >= this.navReplanAt ||
      !(goalShift < NAV_GOAL_HYSTERESIS_TILES)
    ) {
      this.navReplanAt = now + NAV_REPLAN_INTERVAL_MS;
      this.navGoalCellX = goalCellX;
      this.navGoalCellY = goalCellY;
      this.navPath = helper.findEnemyPath(startX, startY, goalX, goalY);
      this.navPathIdx = 0;
      this.navProgressAt = now;
    }
    const path = this.navPath;
    if (path === null || path.length === 0) return null;
    // Advance past waypoints already reached (the first is usually the enemy's
    // own start cell, cleared immediately).
    const prevIdx = this.navPathIdx;
    while (this.navPathIdx < path.length) {
      const wp = path[this.navPathIdx];
      if (
        Math.abs(wp.x - startX) <= NAV_WAYPOINT_REACH_X_PX &&
        Math.abs(wp.y - startY) <= NAV_WAYPOINT_REACH_Y_PX
      ) {
        this.navPathIdx++;
      } else {
        break;
      }
    }
    if (this.navPathIdx >= path.length) {
      // Reached the goal cell — within a tile of the target. Clear so the caller
      // steers directly from here.
      this.navPath = null;
      return null;
    }
    // Stall watchdog: progress is ADVANCING A WAYPOINT (not raw body movement — an
    // up/down bounce on an unmakeable jump moves without getting anywhere). If no
    // waypoint advances for NAV_STALL_MS, abandon the route and arm the cooldown
    // so the enemy stops retrying it and falls back to reactive steering.
    if (this.navPathIdx > prevIdx) {
      this.navProgressAt = now;
    } else if (now - this.navProgressAt > NAV_STALL_MS) {
      this.clear();
      this.navSuppressUntil = now + NAV_STALL_COOLDOWN_MS;
      return null;
    }
    return path[this.navPathIdx];
  }

  // Drops the current nav path so the next pursuit replans from a clean state.
  clear(): void {
    if (this.navPath === null) return;
    this.navPath = null;
    this.navPathIdx = 0;
    this.navGoalCellX = Number.NaN;
    this.navGoalCellY = Number.NaN;
  }

  // True while a route is held — the chase's LOS-grace check keeps following
  // briefly after sight returns only if there is still a path to follow.
  hasPath(): boolean {
    return this.navPath !== null;
  }

  // True while the post-stall cooldown is active (the return-to-post hold
  // uses this to stand still instead of reactive-beelining against a route
  // that just stalled).
  isSuppressed(now: number): boolean {
    return now < this.navSuppressUntil;
  }

  // The current route's world-px waypoints for the debug overlay, or null
  // when not path-following.
  getPathForDebug(): ReadonlyArray<{ x: number; y: number }> | null {
    return this.navPath;
  }
}

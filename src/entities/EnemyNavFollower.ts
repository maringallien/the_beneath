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

/**
 * EnemyNavFollower — A* route bookkeeping for a chasing/searching enemy.
 *
 * One instance per Enemy. When aggro but blind to the target, the enemy follows
 * an A* route (via NavGraph / NavPathfinder) toward the target's standable cell
 * instead of grinding straight into a wall. This class owns ONLY the route
 * state — the held path's world-px waypoints, the current waypoint index, the
 * replan throttle, the moved-goal-cell tracking, and the stall watchdog.
 * Steering toward the returned waypoint (velocity/facing writes) stays in Enemy.
 * Shared by the chase and last-seen-search code (only one runs per frame), and
 * grounded-only — airborne enemies never path. Mirrors the small state-owning
 * helper-class precedent (TeleportCoordinator / EnemyRespawnManager).
 *
 * Inputs:  per-frame foot points (follower + goal), the wall-clock now, and the
 *          scene's A* pathfinding helper.
 * Outputs: the next waypoint to steer toward (or null → caller uses reactive
 *          steering); plus path-state predicates for the chase/return logic and
 *          the debug overlay.
 * @calledby the grounded chase and last-seen-search locomotion, each frame.
 * @calls    the scene's A* path query; otherwise pure self-state bookkeeping.
 */
export class EnemyNavFollower {
  private navPath: ReadonlyArray<{ x: number; y: number }> | null = null;
  private navPathIdx = 0;
  private navReplanAt = 0;
  private navGoalCellX = Number.NaN;
  private navGoalCellY = Number.NaN;
  // Wall-clock time of the last waypoint advance; stall watchdog resets on progress.
  private navProgressAt = 0;
  // Path-following suppressed until this time after a stall-abandon (anti-bounce).
  private navSuppressUntil = 0;

  // Advances the A* route each frame, replanning when stale, and returns the next waypoint (or null to fall back to reactive steering).
  follow(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    now: number,
    helper: Pick<EnemyHelperScene, 'findEnemyPath'>,
  ): { x: number; y: number } | null {
    // Don't immediately re-path after a stall — let reactive locomotion run for a beat.
    if (now < this.navSuppressUntil) return null;
    const goalCellX = Math.floor(goalX / TILE_PX);
    const goalCellY = Math.floor(goalY / TILE_PX);
    // Replan on throttle, path exhaustion, or goal drift beyond the hysteresis band (also handles NaN on first call).
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
    // Skip waypoints already within reach (the first is usually the enemy's own cell).
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
      // Reached the goal cell; clear so the caller steers directly.
      this.navPath = null;
      return null;
    }
    // Stall watchdog: counts waypoint advances, not raw movement — a bounce on an
    // unmakeable jump moves but never advances. Abandon + cooldown on timeout.
    if (this.navPathIdx > prevIdx) {
      this.navProgressAt = now;
    } else if (now - this.navProgressAt > NAV_STALL_MS) {
      this.clear();
      this.navSuppressUntil = now + NAV_STALL_COOLDOWN_MS;
      return null;
    }
    return path[this.navPathIdx];
  }

  // Drops the held route so the next pursuit replans clean.
  clear(): void {
    if (this.navPath === null) return;
    this.navPath = null;
    this.navPathIdx = 0;
    this.navGoalCellX = Number.NaN;
    this.navGoalCellY = Number.NaN;
  }

  // True while a route is held.
  hasPath(): boolean {
    return this.navPath !== null;
  }

  // True while the post-stall cooldown is active.
  isSuppressed(now: number): boolean {
    return now < this.navSuppressUntil;
  }
}

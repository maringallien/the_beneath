import type Phaser from 'phaser';
import { GRAVITY_Y, PLAYER_JUMP_VELOCITY } from '../constants';
import type { EnemyHelperScene } from './enemyHelperScene';

/**
 * @file entities/enemyLeapProbes.ts
 * @description Pure, read-only wall/ledge detection, wall-mount launch solving, and the swept-AABB leap simulator shared by grounded-enemy locomotion; every function reads body geometry and scene collision through a LeapProbeContext and mutates nothing (steering stays in the enemy).
 * @module entities
 */

// Probe geometry (world px). TILE_PX matches the LDtk collision grid; sampling every 8px (half a
// tile) guarantees no 16px collider slips between samples; a chaser scans UP_LEAP_SCAN_REACH_PX
// ahead for a mountable platform; the footstep probe sits +4px below body.bottom, inside the tile.
export const TILE_PX = 16;
export const LEAP_PROBE_SAMPLE_PX = 8;
export const UP_LEAP_SCAN_REACH_PX = 96;
export const FOOTSTEP_TILE_PROBE_OFFSET_Y = 4;

// Leap simulator integration: a 60Hz Euler step, capped at 1.3s of flight; a landing must advance
// at least LEAP_MIN_ADVANCE_PX from takeoff so the solver never "lands" back where it launched.
const LEAP_PROBE_STEP_S = 1 / 60;
const LEAP_PROBE_MAX_TIME_S = 1.3;
const LEAP_MIN_ADVANCE_PX = 16;

// Velocity ladder for the leap solver, gentlest hop → player-grade max.
const LEAP_MIN_LAUNCH_VELOCITY = -160;
const LEAP_LAUNCH_STEP = 15;

// Landing/wall-mount margins (world px): clear LEAP_LANDING_MARGIN_PX past a platform edge so the
// body settles on top, not the lip; scan the wall column in WALL_MOUNT_SCAN_STEP_PX steps.
const LEAP_LANDING_MARGIN_PX = 12;
const WALL_MOUNT_SCAN_STEP_PX = 4;

// Read-only snapshot of the enemy's body, collision queries, position, and facing — the handle
// every probe in this module takes; functions read it and never write back.
export interface LeapProbeContext {
  readonly body: Phaser.Physics.Arcade.Body;
  readonly helper: Pick<EnemyHelperScene, 'isTileSolidAt' | 'getLevelBoundsAt'>;
  readonly x: number;
  readonly y: number;
  readonly facingDirection: 1 | -1;
}

/**
 * @function    shouldJumpOverObstacle
 * @description True when a short wall (≤2 tiles) stands ahead that the enemy should hop over.
 * @returns false unless grounded with gravity and a one-tile-tall block ahead.
 * @calledby src/entities/Enemy.ts → grounded chase/wander/search locomotion
 * @calls    the scene helper's tile-solidity probe at two heights ahead
 */
export function shouldJumpOverObstacle(probe: LeapProbeContext): boolean {
  if (!probe.body.allowGravity) return false;
  if (!probe.body.blocked.down) return false;
  const aheadX =
    probe.facingDirection === 1
      ? probe.body.right + 4
      : probe.body.left - 4;
  const probeY = probe.body.bottom - 8;
  if (!probe.helper.isTileSolidAt(aheadX, probeY)) return false;
  if (probe.helper.isTileSolidAt(aheadX, probeY - 32)) return false;
  return true;
}

/**
 * @function    isBlockedByWall
 * @description True when an impassable wall (too tall to hop) stands ahead in dir.
 * @param   dir  Facing to test: 1 = right, -1 = left.
 * @returns true only when grounded and solid at both foot and head height ahead.
 * @calledby src/entities/Enemy.ts → grounded locomotion deciding to turn back rather than walk into a wall
 * @calls    the scene helper's tile-solidity probe at two heights ahead
 */
export function isBlockedByWall(probe: LeapProbeContext, dir: 1 | -1): boolean {
  if (!probe.body.blocked.down) return false;
  const aheadX = dir === 1 ? probe.body.right + 4 : probe.body.left - 4;
  const probeY = probe.body.bottom - 8;
  return (
    probe.helper.isTileSolidAt(aheadX, probeY) &&
    probe.helper.isTileSolidAt(aheadX, probeY - 32)
  );
}

/**
 * @function    isLedgeAhead
 * @description True when the floor drops away one step ahead in dir (the enemy is at a ledge).
 * @param   dir  Facing to test: 1 = right, -1 = left.
 * @returns true only when grounded and no floor tile sits just ahead-below.
 * @calledby src/entities/Enemy.ts → grounded locomotion avoiding a walk off a platform edge
 * @calls    the scene helper's tile-solidity probe below the foot ahead
 */
export function isLedgeAhead(probe: LeapProbeContext, dir: 1 | -1): boolean {
  if (!probe.body.blocked.down) return false;
  const aheadX = dir === 1 ? probe.body.right + 2 : probe.body.left - 2;
  const probeY = probe.body.bottom + FOOTSTEP_TILE_PROBE_OFFSET_Y;
  return !probe.helper.isTileSolidAt(aheadX, probeY);
}

/**
 * @function    findWallMountLaunch
 * @description Launch velocity to hop onto a flush wall ahead; null when there is no wall, no standing clearance on top, or the lift exceeds a player-grade jump.
 * @param   dir  Facing to test: 1 = right, -1 = left.
 * @returns negative launch vy (px/s, capped at player jump), or null.
 * @calledby src/entities/Enemy.ts → a chaser mounting the ledge above a flush wall
 * @calls    the scene helper's tile-solidity probe up the wall column
 */
export function findWallMountLaunch(
  probe: LeapProbeContext,
  dir: 1 | -1,
): number | null {
  const aheadX = dir === 1 ? probe.body.right + 2 : probe.body.left - 2;
  // Sample a hair above the floor (like shouldJumpOverObstacle) so the tile
  // underfoot isn't mistaken for the wall.
  const footProbeY = probe.body.bottom - 8;
  if (!probe.helper.isTileSolidAt(aheadX, footProbeY)) return null;
  // highest the foot can be lifted by a player-grade jump
  const maxRise =
    (PLAYER_JUMP_VELOCITY * PLAYER_JUMP_VELOCITY) / (2 * GRAVITY_Y);
  // scan column for the wall's top edge — the first clear sample
  let topY: number | null = null;
  for (
    let probeY = footProbeY - WALL_MOUNT_SCAN_STEP_PX;
    probeY >= footProbeY - maxRise;
    probeY -= WALL_MOUNT_SCAN_STEP_PX
  ) {
    if (!probe.helper.isTileSolidAt(aheadX, probeY)) {
      topY = probeY;
      break;
    }
  }
  if (topY === null) return null;
  // require body-height of clearance so the enemy doesn't mount into a ceiling
  if (probe.helper.isTileSolidAt(aheadX, topY - probe.body.height)) return null;
  const liftNeeded = probe.body.bottom - topY + LEAP_LANDING_MARGIN_PX;
  if (liftNeeded > maxRise) return null;
  return Math.max(
    -Math.sqrt(2 * GRAVITY_Y * liftNeeded),
    PLAYER_JUMP_VELOCITY,
  );
}

/**
 * @function    hasReachablePlatformAhead
 * @description True when a solid tile sits within the forward-up jump box — a cheap tile-grid gate before the full leap probe (no arc simulation).
 * @param   dir  Facing to test: 1 = right, -1 = left.
 * @returns true if any solid tile lies in the forward-up scan region.
 * @calledby src/entities/Enemy.ts → grounded locomotion, a cheap pre-check before the full leap solver
 * @calls    the scene helper's tile-solidity probe across the forward-up region
 */
export function hasReachablePlatformAhead(
  probe: LeapProbeContext,
  dir: 1 | -1,
): boolean {
  const maxRise =
    (PLAYER_JUMP_VELOCITY * PLAYER_JUMP_VELOCITY) / (2 * GRAVITY_Y);
  const lead = dir === 1 ? probe.body.right : probe.body.left;
  const foot = probe.body.bottom;
  for (let up = TILE_PX; up <= maxRise + TILE_PX; up += TILE_PX) {
    for (let fwd = 0; fwd <= UP_LEAP_SCAN_REACH_PX; fwd += TILE_PX) {
      if (probe.helper.isTileSolidAt(lead + dir * fwd, foot - up)) return true;
    }
  }
  return false;
}

/**
 * @function    overheadEscapeDir
 * @description Direction toward the nearer edge of the platform overhead, so a trapped enemy can side-step out and jump up.
 * @returns -1 / 1 toward the nearer open edge, or 0 if nothing is overhead or no edge is reachable.
 * @calledby src/entities/Enemy.ts → a chaser stuck under a platform that needs a clear column
 * @calls    the scene helper's tile-solidity probe overhead and outward both ways
 */
export function overheadEscapeDir(probe: LeapProbeContext): 1 | -1 | 0 {
  const maxRise =
    (PLAYER_JUMP_VELOCITY * PLAYER_JUMP_VELOCITY) / (2 * GRAVITY_Y);
  const cx = probe.body.center.x;
  // Find the underside of the platform directly overhead, if any.
  let level = Number.NaN;
  for (let up = TILE_PX; up <= maxRise; up += LEAP_PROBE_SAMPLE_PX) {
    if (probe.helper.isTileSolidAt(cx, probe.body.top - up)) {
      level = probe.body.top - up;
      break;
    }
  }
  if (Number.isNaN(level)) return 0;
  const maxScan = UP_LEAP_SCAN_REACH_PX + TILE_PX * 4;
  let leftDist = 0;
  let rightDist = 0;
  for (let d = TILE_PX; d <= maxScan; d += TILE_PX) {
    if (rightDist === 0 && !probe.helper.isTileSolidAt(cx + d, level)) rightDist = d;
    if (leftDist === 0 && !probe.helper.isTileSolidAt(cx - d, level)) leftDist = d;
    if (leftDist !== 0 && rightDist !== 0) break;
  }
  if (leftDist === 0 && rightDist === 0) return 0;
  if (leftDist !== 0 && (rightDist === 0 || leftDist <= rightDist)) return -1;
  return 1;
}

/**
 * @function    columnSolid
 * @description True if any solid tile lies on the vertical segment at xEdge — the body's leading side hitting a wall.
 * @param   xEdge    World-px column to sample.
 * @param   yTop     Top of the world-px vertical span.
 * @param   yBottom  Bottom of the world-px vertical span.
 * @returns true if any sample (every LEAP_PROBE_SAMPLE_PX, plus the exact bottom) is solid.
 * @calledby src/entities/enemyLeapProbes.ts → simulateLeapArc, testing the leading edge each step
 * @calls    the scene helper's tile-solidity probe down the column
 */
function columnSolid(
  probe: LeapProbeContext,
  xEdge: number,
  yTop: number,
  yBottom: number,
): boolean {
  for (let y = yTop; y < yBottom; y += LEAP_PROBE_SAMPLE_PX) {
    if (probe.helper.isTileSolidAt(xEdge, y)) return true;
  }
  return probe.helper.isTileSolidAt(xEdge, yBottom);
}

/**
 * @function    rowSolid
 * @description True if any solid tile lies on the horizontal segment at yEdge — floors to land on and ceilings to bonk.
 * @param   yEdge   World-px row to sample.
 * @param   xLeft   Left of the world-px horizontal span.
 * @param   xRight  Right of the world-px horizontal span.
 * @returns true if any sample (every LEAP_PROBE_SAMPLE_PX, plus the exact right edge) is solid.
 * @calledby src/entities/enemyLeapProbes.ts → simulateLeapArc, testing for a landing floor or ceiling each step
 * @calls    the scene helper's tile-solidity probe across the row
 */
function rowSolid(
  probe: LeapProbeContext,
  yEdge: number,
  xLeft: number,
  xRight: number,
): boolean {
  for (let x = xLeft; x < xRight; x += LEAP_PROBE_SAMPLE_PX) {
    if (probe.helper.isTileSolidAt(x, yEdge)) return true;
  }
  return probe.helper.isTileSolidAt(xRight, yEdge);
}

/**
 * @function    simulateLeapArc
 * @description Simulate one jump arc (Euler step; tests walls, ceilings, floors) and return the landing foot point, or null.
 * @param   dir       Horizontal direction of travel: 1 = right, -1 = left.
 * @param   launchVx  Horizontal launch speed (px/s, magnitude).
 * @param   launchVy  Vertical launch speed (px/s; negative = up).
 * @returns the landing foot point {x, y} (world px), or null if it leaves bounds, never lands with headroom, or barely advances from takeoff.
 * @calledby src/entities/enemyLeapProbes.ts → findLeapLanding, evaluating one candidate launch velocity
 * @calls    the column/row solidity helpers and the scene helper's level-bounds query
 */
export function simulateLeapArc(
  probe: LeapProbeContext,
  dir: 1 | -1,
  launchVx: number,
  launchVy: number,
): { x: number; y: number } | null {
  const bounds = probe.helper.getLevelBoundsAt(probe.x, probe.y);
  const hw = probe.body.width / 2;
  const hh = probe.body.height / 2;
  let cx = probe.body.center.x;
  let cy = probe.body.center.y;
  let vy = launchVy;
  const vx = launchVx * dir;
  const startFootX = cx + dir * hw;
  const startFootY = cy + hh;
  for (let t = 0; t < LEAP_PROBE_MAX_TIME_S; t += LEAP_PROBE_STEP_S) {
    vy += GRAVITY_Y * LEAP_PROBE_STEP_S;
    // advance x unless the leading edge would enter solid; slide up the wall face instead
    const newCx = cx + vx * LEAP_PROBE_STEP_S;
    if (!columnSolid(probe, newCx + dir * hw, cy - hh, cy + hh)) {
      cx = newCx;
    }
    const newCy = cy + vy * LEAP_PROBE_STEP_S;
    if (bounds) {
      if (cx < bounds.worldX || cx > bounds.worldX + bounds.pxWid) return null;
      if (newCy + hh > bounds.worldY + bounds.pxHei) return null;
    }
    if (vy >= 0) {
      // descending: solid row under the foot is a landing if there's headroom and we've moved
      const footY = newCy + hh;
      if (rowSolid(probe, footY, cx - hw, cx + hw)) {
        // inset by 1 px so a flush wall-face doesn't read as "no headroom"
        const headClear =
          !rowSolid(probe, footY - probe.body.height + 2, cx - hw + 1, cx + hw - 1) &&
          !rowSolid(probe, footY - hh, cx - hw + 1, cx + hw - 1);
        const lx = cx + dir * hw;
        const advanced =
          Math.abs(lx - startFootX) >= LEAP_MIN_ADVANCE_PX ||
          Math.abs(footY - startFootY) >= TILE_PX;
        if (headClear && advanced) return { x: lx, y: footY };
        return null;
      }
      cy = newCy;
    } else {
      // ascending: ceiling bonk zeroes the rise and gravity returns the body
      if (rowSolid(probe, newCy - hh, cx - hw, cx + hw)) {
        vy = 0;
      } else {
        cy = newCy;
      }
    }
  }
  return null;
}

/**
 * @function    findLeapLanding
 * @description Try launch velocities up to maxLaunchVelocity and return the one whose landing best advances toward target.
 * @param   dir                Horizontal direction: 1 = right, -1 = left.
 * @param   launchVx           Horizontal launch speed (px/s, magnitude).
 * @param   target             World-px goal to minimize landing distance to.
 * @param   maxLaunchVelocity  Most-negative vy allowed; defaults to a player-grade jump.
 * @returns the best {x, y, vy} landing solidly atop a platform nearest target, or null.
 * @calledby src/entities/Enemy.ts → a chaser/searcher choosing whether and how hard to jump
 * @calls    the arc simulator per velocity and the scene helper's tile-solidity lip check
 */
export function findLeapLanding(
  probe: LeapProbeContext,
  dir: 1 | -1,
  launchVx: number,
  target: { x: number; y: number },
  maxLaunchVelocity: number = PLAYER_JUMP_VELOCITY,
): { x: number; y: number; vy: number } | null {
  const steps = Math.ceil(
    (LEAP_MIN_LAUNCH_VELOCITY - maxLaunchVelocity) / LEAP_LAUNCH_STEP,
  );
  let best: { x: number; y: number; vy: number; dist: number } | null = null;
  for (let i = 0; i <= steps; i++) {
    const vy = Math.max(
      LEAP_MIN_LAUNCH_VELOCITY - i * LEAP_LAUNCH_STEP,
      maxLaunchVelocity,
    );
    const landing = simulateLeapArc(probe, dir, launchVx, vy);
    if (!landing) continue;
    if (
      !probe.helper.isTileSolidAt(landing.x - LEAP_LANDING_MARGIN_PX * dir, landing.y)
    ) {
      continue; // lands on the lip, not solidly on top
    }
    const dist = Math.hypot(landing.x - target.x, landing.y - target.y);
    if (best === null || dist < best.dist - TILE_PX) {
      best = { x: landing.x, y: landing.y, vy, dist };
    }
  }
  return best ? { x: best.x, y: best.y, vy: best.vy } : null;
}

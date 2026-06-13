import type Phaser from 'phaser';
import { GRAVITY_Y, PLAYER_JUMP_VELOCITY } from '../constants';
import type { EnemyHelperScene } from './enemyHelperScene';

/**
 * enemyLeapProbes — pure, read-only locomotion probes for grounded-enemy AI.
 *
 * Wall and ledge detection, wall-mount launch solving, and the swept-AABB leap
 * simulator shared by the enemy chase / wander / search / nav-following code.
 * Every function reads the enemy's body geometry and the scene's collision
 * queries through a LeapProbeContext and mutates nothing — steering
 * (velocity/facing writes) stay in the enemy. Mirrors the enemyDetection
 * precedent: free functions over enemy-owned state.
 *
 * Inputs:  a LeapProbeContext per call (body, collision-query helper, position,
 *          facing) plus jump/gravity tuning from ../constants.
 * Outputs: booleans, launch velocities, and landing points — never mutation.
 * @calledby the grounded enemy locomotion paths, when deciding whether to hop,
 *           turn back at a wall, or where a jump would land.
 * @calls    only the scene helper's read-only tile-solidity and level-bounds probes.
 */

// world-grid tile size in pixels, matching the LDtk collision grid
export const TILE_PX = 16;

// 8 px (half a tile) — guarantees no 16 px collider slips between samples
export const LEAP_PROBE_SAMPLE_PX = 8;

// how far ahead a chaser looks for a mountable platform
export const UP_LEAP_SCAN_REACH_PX = 96;

// +4 px below body.bottom lands safely inside the tile beneath (body.bottom is at the tile top edge)
export const FOOTSTEP_TILE_PROBE_OFFSET_Y = 4;

const LEAP_PROBE_STEP_S = 1 / 60;
const LEAP_PROBE_MAX_TIME_S = 1.3;

// landing must have left the takeoff spot so the solver never "lands" back where it launched
const LEAP_MIN_ADVANCE_PX = 16;

// velocity ladder for the leap solver, from gentlest hop to player-grade max
const LEAP_MIN_LAUNCH_VELOCITY = -160;
const LEAP_LAUNCH_STEP = 15;

// landing must clear this many px past the platform edge so the body settles on top, not the lip
const LEAP_LANDING_MARGIN_PX = 12;

const WALL_MOUNT_SCAN_STEP_PX = 4;

// read-only snapshot of the enemy's body, collision queries, position, and facing
export interface LeapProbeContext {
  readonly body: Phaser.Physics.Arcade.Body;
  readonly helper: Pick<EnemyHelperScene, 'isTileSolidAt' | 'getLevelBoundsAt'>;
  readonly x: number;
  readonly y: number;
  readonly facingDirection: 1 | -1;
}

// true when a short wall (≤2 tiles) stands ahead that the enemy should hop over
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

// true when an impassable wall (too tall to hop) stands ahead in dir
export function isBlockedByWall(probe: LeapProbeContext, dir: 1 | -1): boolean {
  if (!probe.body.blocked.down) return false;
  const aheadX = dir === 1 ? probe.body.right + 4 : probe.body.left - 4;
  const probeY = probe.body.bottom - 8;
  return (
    probe.helper.isTileSolidAt(aheadX, probeY) &&
    probe.helper.isTileSolidAt(aheadX, probeY - 32)
  );
}

// true when the floor drops away one step ahead in dir (the enemy is at a ledge)
export function isLedgeAhead(probe: LeapProbeContext, dir: 1 | -1): boolean {
  if (!probe.body.blocked.down) return false;
  const aheadX = dir === 1 ? probe.body.right + 2 : probe.body.left - 2;
  const probeY = probe.body.bottom + FOOTSTEP_TILE_PROBE_OFFSET_Y;
  return !probe.helper.isTileSolidAt(aheadX, probeY);
}

// find the launch velocity to hop onto a flush wall ahead; null if unreachable or no standing clearance
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

// true when a solid tile sits within the forward-up jump box (cheap gate before the full probe)
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

// direction toward the nearer edge of the platform above, so the enemy can walk out and jump up
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

// true if any solid tile lies on the vertical segment at xEdge — the body's leading side hitting a wall
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

// true if any solid tile lies on the horizontal segment at yEdge — floors to land on and ceilings to bonk
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

// simulate one jump arc (Euler, walls/ceilings/floors) and return the landing point, or null
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

// try launch velocities up to maxLaunchVelocity and return the one whose landing best advances toward target
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

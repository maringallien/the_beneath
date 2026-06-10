import type Phaser from 'phaser';
import { GRAVITY_Y, PLAYER_JUMP_VELOCITY } from '../constants';
import type { EnemyHelperScene } from './enemyHelperScene';

// Pure, read-only locomotion probes shared by the enemy chase / wander /
// search / nav-following code: wall and ledge detection, wall-mount launch
// solving, and the swept-AABB leap simulator. Every function reads the
// enemy's body geometry plus the scene's collision queries through a
// LeapProbeContext and mutates nothing — steering (velocity/facing writes)
// stays in Enemy. Follows the enemyDetection.ts precedent: free functions,
// Enemy-owned state.

// World-grid tile size in pixels. Matches the LDtk collision grid.
export const TILE_PX = 16;

// Sample stride for the column/row solidity sweeps and the overhead scan.
// 8 px (half a tile) guarantees no 16 px collider slips between samples.
export const LEAP_PROBE_SAMPLE_PX = 8;

// Forward reach (px) of the ahead-and-above platform scan — how far ahead a
// chaser looks for a platform worth mounting. Also bounds the overhead
// escape walk-out and the search-stall escape hop.
export const UP_LEAP_SCAN_REACH_PX = 96;

// Sample offset below body.bottom when probing the tile under the feet.
// Same value as Player.ts FOOTSTEP_TILE_PROBE_OFFSET_Y — body.bottom sits at
// the top edge of the floor tile while grounded; +4 px lands safely inside
// the tile beneath.
export const FOOTSTEP_TILE_PROBE_OFFSET_Y = 4;

// Leap-arc integration: Arcade-physics-step-sized increments over a budget
// long enough to cover the largest jump arc the solver may pick.
const LEAP_PROBE_STEP_S = 1 / 60;
const LEAP_PROBE_MAX_TIME_S = 1.3;

// A landing must have left the takeoff spot — moved at least a body-step
// horizontally or changed level by a tile — so the solver never "lands"
// back where it launched.
const LEAP_MIN_ADVANCE_PX = 16;

// Launch-velocity ladder for the leap solver: from the gentlest one-tile hop
// down (more negative = stronger) toward the player-grade max, in steps.
const LEAP_MIN_LAUNCH_VELOCITY = -160;
const LEAP_LAUNCH_STEP = 15;

// A landing must clear this many px past the platform's near edge so the
// body settles on top instead of clipping the lip.
const LEAP_LANDING_MARGIN_PX = 12;

// Vertical stride when scanning a wall's column for its top edge.
const WALL_MOUNT_SCAN_STEP_PX = 4;

// Read-only view of the probing enemy: its physics body, the scene's
// collision queries, the sprite position (level-bounds lookup), and the
// current facing (shouldJumpOverObstacle probes ahead of the face).
// Enemy builds this via its probeCtx getter.
export interface LeapProbeContext {
  readonly body: Phaser.Physics.Arcade.Body;
  readonly helper: Pick<EnemyHelperScene, 'isTileSolidAt' | 'getLevelBoundsAt'>;
  readonly x: number;
  readonly y: number;
  readonly facingDirection: 1 | -1;
}

// True when a chasing ground enemy is standing in front of a wall ≤ 2
// tiles tall and should hop over it. Gravity-off enemies skip this
// entirely — they have no useful "jump" semantics. Sampling at
// body.bottom - 8 avoids hitting the floor tile the enemy is standing
// on; the +4 px offset ahead avoids self-collision with the body's own
// bounding box. probeY - 32 (two tiles up + one tile clearance) must
// be empty so a 3-tile wall is rejected.
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

// True when an impassable wall stands directly ahead in `dir`: a solid tile at
// mid-foot height that is STILL solid a hop up (probeY - 32), so it's taller
// than shouldJumpOverObstacle can clear. The inverse of that probe — used by
// the wander and last-seen-search locomotion (neither mounts walls) to stop
// and turn back / scan instead of grinding a wall they can't pass. Grounded
// only; the chase loop uses its own wedged-headway tracker (CHASE_STILL_GRACE_MS)
// instead.
export function isBlockedByWall(probe: LeapProbeContext, dir: 1 | -1): boolean {
  if (!probe.body.blocked.down) return false;
  const aheadX = dir === 1 ? probe.body.right + 4 : probe.body.left - 4;
  const probeY = probe.body.bottom - 8;
  return (
    probe.helper.isTileSolidAt(aheadX, probeY) &&
    probe.helper.isTileSolidAt(aheadX, probeY - 32)
  );
}

// True when the floor stops just ahead of the leading foot — i.e. the enemy
// is standing at a ledge with open air in its travel direction. Mirrors
// shouldJumpOverObstacle's probe geometry: a point a hair past the leading
// body edge, one footstep-probe offset below the feet (inside the tile the
// enemy would step onto). No solid tile there → a gap the chaser must leap or
// stop short of. Grounded-only; airborne callers never ask.
export function isLedgeAhead(probe: LeapProbeContext, dir: 1 | -1): boolean {
  if (!probe.body.blocked.down) return false;
  const aheadX = dir === 1 ? probe.body.right + 2 : probe.body.left - 2;
  const probeY = probe.body.bottom + FOOTSTEP_TILE_PROBE_OFFSET_Y;
  return !probe.helper.isTileSolidAt(aheadX, probeY);
}

// Vertical-reach probe for mounting a step/ledge whose vertical face is
// directly ahead (no gap to arc over) — the "climb onto the platform above"
// case the ballistic gap-probe can't handle, because to it the forward wall
// reads as a ceiling and aborts the arc. Confirms a wall is flush ahead, scans
// its column upward for the top edge, and — if that top is within a player-
// grade jump and offers body-height standing clearance — returns the launch
// velocity that lifts the foot just past it (the chaser then jumps, slides up
// the wall face, and its held forward speed carries it onto the platform).
// Returns null when there's no wall ahead, its top is out of reach, or the
// surface isn't standable. Grounded-only; the caller guarantees blocked.down.
export function findWallMountLaunch(
  probe: LeapProbeContext,
  dir: 1 | -1,
): number | null {
  const aheadX = dir === 1 ? probe.body.right + 2 : probe.body.left - 2;
  // Sample a hair above the floor (like shouldJumpOverObstacle) so the tile
  // underfoot isn't mistaken for the wall.
  const footProbeY = probe.body.bottom - 8;
  if (!probe.helper.isTileSolidAt(aheadX, footProbeY)) return null; // no wall ahead
  // Highest the foot can be lifted by a player-grade jump (the arc apex).
  const maxRise =
    (PLAYER_JUMP_VELOCITY * PLAYER_JUMP_VELOCITY) / (2 * GRAVITY_Y);
  // Walk up the column ahead to the wall's top — the first clear sample.
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
  if (topY === null) return null; // wall taller than a max jump can clear
  // Require a body's height of standing clearance above the surface, else the
  // chaser would mount into a ceiling and couldn't actually perch there.
  if (probe.helper.isTileSolidAt(aheadX, topY - probe.body.height)) return null;
  // Lift the foot to the top plus the landing margin so it comes down onto the
  // surface instead of clipping the lip; reject if that exceeds the max jump,
  // and clamp the magnitude to the player max as a safety net.
  const liftNeeded = probe.body.bottom - topY + LEAP_LANDING_MARGIN_PX;
  if (liftNeeded > maxRise) return null;
  return Math.max(
    -Math.sqrt(2 * GRAVITY_Y * liftNeeded),
    PLAYER_JUMP_VELOCITY,
  );
}

// Cheap gate for the climb-from-under search: is there a platform within jump
// reach AHEAD-AND-ABOVE (in the travel direction) to leap onto? Scans a
// forward-up box from the leading foot. This is the crux of the fix for an
// enemy stranding itself under a platform: the only place a jump can land on
// top is BEFORE the platform's near edge, where the platform is ahead — not
// overhead — so a "directly above" test never fires in time. fwd starts at 0
// so terrain straight up (e.g. mounting toward a higher next platform) counts
// too. Doesn't check standability; that's the full probe's job.
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

// When the chaser is stranded directly under a platform (can't launch onto a
// surface it's beneath), returns the direction toward that platform's NEAREST
// edge so it walks out from under and can jump up onto it on the next approach.
// Returns 0 when not under a platform (the caller then just closes on the
// player) or when the overhead solid is too wide to escape within reach (a
// ceiling, not a moundable ledge).
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
  if (Number.isNaN(level)) return 0; // not under a platform
  // Walk out along that level to find the nearer edge.
  const maxScan = UP_LEAP_SCAN_REACH_PX + TILE_PX * 4;
  let leftDist = 0;
  let rightDist = 0;
  for (let d = TILE_PX; d <= maxScan; d += TILE_PX) {
    if (rightDist === 0 && !probe.helper.isTileSolidAt(cx + d, level)) rightDist = d;
    if (leftDist === 0 && !probe.helper.isTileSolidAt(cx - d, level)) leftDist = d;
    if (leftDist !== 0 && rightDist !== 0) break;
  }
  if (leftDist === 0 && rightDist === 0) return 0; // too wide — a ceiling
  if (leftDist !== 0 && (rightDist === 0 || leftDist <= rightDist)) return -1;
  return 1;
}

// True if any solid tile lies on the vertical segment at xEdge from yTop to
// yBottom — i.e. the body's leading side would hit a wall there. Sampled every
// LEAP_PROBE_SAMPLE_PX (plus the bottom endpoint) so no 16 px collider slips
// between samples.
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

// True if any solid tile lies on the horizontal segment at yEdge from xLeft to
// xRight — used to test the body's foot row (a floor to land on) and head row
// (a ceiling). Same sampling guarantee as columnSolid.
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

// Swept-AABB reachability probe for a SINGLE launch velocity. Integrates the
// body's box as Arcade would (semi-implicit Euler, X and Y resolved
// separately) so it behaves exactly like the real jump: it SLIDES along a wall
// in its path instead of stopping (the key to vertical-shaft climbs — launch
// toward a wall-attached platform, ride up its face, land on top), bonks
// ceilings (vy zeroed, then falls), and rests its foot on the first floor it
// descends onto that it can actually stand on (clear headroom). Returns the
// leading-foot landing point, or null if nothing standable is reached within
// the level and time budget. A landing must have left the takeoff spot — moved
// a body-step horizontally OR changed level by a tile — so it never "lands"
// back where it launched. Handles up / down / across uniformly.
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
    // Horizontal: advance unless the leading vertical edge would enter solid —
    // then hold x and let the body slide vertically along the wall.
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
      // Descending: a solid row under the foot is a landing if the body can
      // stand there (head + mid rows clear) and it has left the takeoff spot.
      const footY = newCy + hh;
      if (rowSolid(probe, footY, cx - hw, cx + hw)) {
        // Inset the headroom samples by 1 px so a wall flush against the
        // body's side (e.g. a shaft platform reached by riding up its face)
        // doesn't read as "no headroom" — only solids genuinely above count.
        const headClear =
          !rowSolid(probe, footY - probe.body.height + 2, cx - hw + 1, cx + hw - 1) &&
          !rowSolid(probe, footY - hh, cx - hw + 1, cx + hw - 1);
        const lx = cx + dir * hw;
        const advanced =
          Math.abs(lx - startFootX) >= LEAP_MIN_ADVANCE_PX ||
          Math.abs(footY - startFootY) >= TILE_PX;
        if (headClear && advanced) return { x: lx, y: footY };
        return null; // fell back onto takeoff, or can't stand here
      }
      cy = newCy;
    } else {
      // Ascending: a solid row at the head is a ceiling — the real body's rise
      // is zeroed here (then gravity returns it), so stop rising and hold cy.
      if (rowSolid(probe, newCy - hh, cx - hw, cx + hw)) {
        vy = 0;
      } else {
        cy = newCy;
      }
    }
  }
  return null;
}

// Chase-leap solver. Tries launch velocities from the gentlest
// (LEAP_MIN_LAUNCH_VELOCITY, a one-tile hop) up to the player max
// (PLAYER_JUMP_VELOCITY) and returns the launch whose landing best advances
// toward `target` (the player). Each candidate must clear
// LEAP_LANDING_MARGIN_PX past the landing platform's near edge so the body
// settles on top instead of clipping the lip. Selection ascends the ladder and
// only switches to a stronger arc when it lands a full tile closer to the
// target — so a flat gap or drop keeps its minimum-sufficient hop, while a
// climb onto a platform above (which gets dramatically closer to a player up
// there) is taken when one exists. Returns null when nothing lands with margin
// (caller parks or reroutes). launchVx must be the SAME horizontal speed the
// takeoff applies so the predicted arc matches the real one. maxLaunchVelocity
// caps how hard the search may jump (default = the player's jump, used by
// chase); the spawn-anchored wander passes a stronger ceiling so a stroller
// can clear up to ~4 tiles.
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

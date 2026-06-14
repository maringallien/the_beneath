import { PLAYER_JUMP_VELOCITY } from '../constants';

/**
 * @file level/navProbe.ts
 * @description Pure, Phaser-free ballistic reachability probe answering "can a body get from here to there with one jump?" — the shared jump oracle the NavGraph builder uses for jump edges, and a faithful MIRROR of Enemy.ts's chase-leap solver (arc simulation, landing search, column/row solidity) kept algorithm-identical ON PURPOSE so the graph plans jumps with exactly the physics the live enemy executes; INVARIANT: change the arc math in BOTH places; stays Phaser-free and unit-testable in isolation (Enemy keeps its own copy because its constants are entangled with other locomotion helpers).
 * @module level
 */

// World grid size (px). LDtk authors this game on a 16 px tile.
export const TILE_PX = 16;

// ── Leap probe tuning (mirror of Enemy.ts) ─────────────────────────────────
// Arc integration + velocity-ladder + landing knobs, kept value-identical to the live enemy's
// chase-leap solver so a planned jump edge is always one the body can actually execute.
// Probe step matches 60 Hz physics; budget exceeds the player's airtime so long arcs and shaft climbs are found.
const LEAP_PROBE_STEP_S = 1 / 60;
const LEAP_PROBE_MAX_TIME_S = 1.3;
// Sample stride when testing a body edge; half a tile catches every 16px collider without per-pixel queries.
const LEAP_PROBE_SAMPLE_PX = 8;
// Minimum horizontal advance for a landing to count, so the probe can't "land" back on the takeoff platform.
const LEAP_MIN_ADVANCE_PX = 16;
// Minimum launch velocity: a one-tile hop (v = √(2·g·h), g=800, h=16).
const LEAP_MIN_LAUNCH_VELOCITY = -160;
// Velocity ladder step; produces ~13 candidates between the one-tile floor and player-max.
const LEAP_LAUNCH_STEP = 15;
// Foot must clear this many px past the platform's near edge so Arcade resolves the touch on Y, not X.
const LEAP_LANDING_MARGIN_PX = 12;

// True iff a solid tile exists at the given world pixel.
export type SolidAt = (x: number, y: number) => boolean;

// Level rect an arc is confined to; arcs leaving it are abandoned so jump edges stay within one level.
export interface LevelBounds {
  readonly worldX: number;
  readonly worldY: number;
  readonly pxWid: number;
  readonly pxHei: number;
}

// Everything the arc integrator needs that isn't a per-call launch parameter.
export interface ArcContext {
  readonly solidAt: SolidAt;
  readonly bounds: LevelBounds | null;
  readonly gravityY: number;
  readonly bodyW: number;
  readonly bodyH: number;
}

export interface LeapLanding {
  readonly x: number;
  readonly y: number;
  readonly vy: number;
}

/**
 * @function    columnSolid
 * @description True if any solid tile lies on the vertical segment at xEdge — the body's leading side hitting a wall.
 * @param   solidAt  Tile-solidity predicate.
 * @param   xEdge    World-px column to test.
 * @param   yTop     Top of the world-px vertical span.
 * @param   yBottom  Bottom of the world-px vertical span.
 * @returns true if any sample (every LEAP_PROBE_SAMPLE_PX, plus the exact bottom) is solid.
 * @calledby src/level/navProbe.ts → simulateLeapArc, deciding whether horizontal advance is blocked by a wall
 * @calls    the supplied solidity predicate at half-tile sample steps
 */
function columnSolid(
  solidAt: SolidAt,
  xEdge: number,
  yTop: number,
  yBottom: number,
): boolean {
  for (let y = yTop; y < yBottom; y += LEAP_PROBE_SAMPLE_PX) {
    if (solidAt(xEdge, y)) return true;
  }
  return solidAt(xEdge, yBottom);
}

/**
 * @function    rowSolid
 * @description True if any solid tile lies on the horizontal segment at yEdge — used for floor landings and ceiling bonks.
 * @param   solidAt  Tile-solidity predicate.
 * @param   yEdge    World-px row to test.
 * @param   xLeft    Left of the world-px horizontal span.
 * @param   xRight   Right of the world-px horizontal span.
 * @returns true if any sample (every LEAP_PROBE_SAMPLE_PX, plus the exact right edge) is solid.
 * @calledby src/level/navProbe.ts → simulateLeapArc, testing for a floor landing, a ceiling bonk, or headroom clearance
 * @calls    the supplied solidity predicate at half-tile sample steps
 */
function rowSolid(
  solidAt: SolidAt,
  yEdge: number,
  xLeft: number,
  xRight: number,
): boolean {
  for (let x = xLeft; x < xRight; x += LEAP_PROBE_SAMPLE_PX) {
    if (solidAt(x, yEdge)) return true;
  }
  return solidAt(xRight, yEdge);
}

/**
 * @function    simulateLeapArc
 * @description Swept-AABB arc probe for one launch velocity: slides along walls, bonks ceilings, returns the first floor landing or null.
 * @param   ctx       ArcContext: solidity, optional bounds, gravity, body w/h.
 * @param   centerX   Launch body-center x (world px).
 * @param   centerY   Launch body-center y (world px).
 * @param   dir       Horizontal direction of travel: 1 = right, -1 = left.
 * @param   launchVx  Horizontal launch speed (px/s, magnitude).
 * @param   launchVy  Vertical launch speed (px/s; negative = up).
 * @returns the landing foot point {x, y}, or null if the arc leaves bounds, finds no standable floor, or only falls back onto the takeoff spot.
 * @calledby src/level/navProbe.ts → findLeapLanding / collectLeapLandings, once per candidate launch velocity
 * @calls    the column/row solidity tests as it integrates the arc step by step
 */
export function simulateLeapArc(
  ctx: ArcContext,
  centerX: number,
  centerY: number,
  dir: 1 | -1,
  launchVx: number,
  launchVy: number,
): { x: number; y: number } | null {
  const { solidAt, bounds, gravityY, bodyW, bodyH } = ctx;
  const hw = bodyW / 2;
  const hh = bodyH / 2;
  let cx = centerX;
  let cy = centerY;
  let vy = launchVy;
  const vx = launchVx * dir;
  const startFootX = cx + dir * hw;
  const startFootY = cy + hh;
  for (let t = 0; t < LEAP_PROBE_MAX_TIME_S; t += LEAP_PROBE_STEP_S) {
    vy += gravityY * LEAP_PROBE_STEP_S;
    // Horizontal: advance unless the leading vertical edge would enter solid —
    // then hold x and let the body slide vertically along the wall.
    const newCx = cx + vx * LEAP_PROBE_STEP_S;
    if (!columnSolid(solidAt, newCx + dir * hw, cy - hh, cy + hh)) {
      cx = newCx;
    }
    const newCy = cy + vy * LEAP_PROBE_STEP_S;
    if (bounds) {
      if (cx < bounds.worldX || cx > bounds.worldX + bounds.pxWid) return null;
      if (newCy + hh > bounds.worldY + bounds.pxHei) return null;
    }
    if (vy >= 0) {
      // Descending: land if the floor row is solid, the body has headroom, and it has left the takeoff spot.
      const footY = newCy + hh;
      if (rowSolid(solidAt, footY, cx - hw, cx + hw)) {
        // Inset headroom samples 1px so a wall flush against the body's side doesn't falsely block it.
        const headClear =
          !rowSolid(solidAt, footY - bodyH + 2, cx - hw + 1, cx + hw - 1) &&
          !rowSolid(solidAt, footY - hh, cx - hw + 1, cx + hw - 1);
        const lx = cx + dir * hw;
        const advanced =
          Math.abs(lx - startFootX) >= LEAP_MIN_ADVANCE_PX ||
          Math.abs(footY - startFootY) >= TILE_PX;
        if (headClear && advanced) return { x: lx, y: footY };
        return null; // fell back onto takeoff, or can't stand here
      }
      cy = newCy;
    } else {
      // Ascending: a solid row at the head is a ceiling — zero vy and hold cy.
      if (rowSolid(solidAt, newCy - hh, cx - hw, cx + hw)) {
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
 * @description Tries launch velocities from gentlest to maxLaunchVelocity and returns the landing that best advances toward the target.
 * @param   ctx                ArcContext: solidity, optional bounds, gravity, body w/h.
 * @param   centerX            Launch body-center x (world px).
 * @param   centerY            Launch body-center y (world px).
 * @param   dir                Horizontal direction: 1 = right, -1 = left.
 * @param   launchVx           Horizontal launch speed (px/s, magnitude).
 * @param   target             World-px goal to minimize landing distance to.
 * @param   maxLaunchVelocity  Most-negative vy allowed; defaults to a player-grade jump.
 * @returns the LeapLanding (x, y, launch vy) closest to the target, or null if no velocity in the ladder lands solidly.
 * @calledby src/entities/Enemy.ts → the live enemy's chase-leap solver path (mirrored here), choosing a jump toward a target
 * @calls    the per-velocity arc probe and a solid-top check at each candidate landing
 */
export function findLeapLanding(
  ctx: ArcContext,
  centerX: number,
  centerY: number,
  dir: 1 | -1,
  launchVx: number,
  target: { x: number; y: number },
  maxLaunchVelocity: number = PLAYER_JUMP_VELOCITY,
): LeapLanding | null {
  const { solidAt } = ctx;
  const steps = Math.ceil(
    (LEAP_MIN_LAUNCH_VELOCITY - maxLaunchVelocity) / LEAP_LAUNCH_STEP,
  );
  let best: { x: number; y: number; vy: number; dist: number } | null = null;
  for (let i = 0; i <= steps; i++) {
    const vy = Math.max(
      LEAP_MIN_LAUNCH_VELOCITY - i * LEAP_LAUNCH_STEP,
      maxLaunchVelocity,
    );
    const landing = simulateLeapArc(ctx, centerX, centerY, dir, launchVx, vy);
    if (!landing) continue;
    if (!solidAt(landing.x - LEAP_LANDING_MARGIN_PX * dir, landing.y)) {
      continue; // lands on the lip, not solidly on top
    }
    const dist = Math.hypot(landing.x - target.x, landing.y - target.y);
    if (best === null || dist < best.dist - TILE_PX) {
      best = { x: landing.x, y: landing.y, vy, dist };
    }
  }
  return best ? { x: best.x, y: best.y, vy: best.vy } : null;
}

/**
 * @function    collectLeapLandings
 * @description Graph-build variant: returns every distinct standable landing across the velocity ladder (one per tile cell) for jump edges.
 * @param   ctx                ArcContext: solidity, optional bounds, gravity, body w/h.
 * @param   centerX            Launch body-center x (world px).
 * @param   centerY            Launch body-center y (world px).
 * @param   dir                Horizontal direction: 1 = right, -1 = left.
 * @param   launchVx           Horizontal launch speed (px/s, magnitude).
 * @param   maxLaunchVelocity  Most-negative vy allowed; defaults to a player-grade jump.
 * @returns the list of distinct standable LeapLandings (deduplicated to one per tile cell).
 * @calledby src/level/NavGraph.ts → computeEdges, generating the jump edges out of a node
 * @calls    the per-velocity arc probe and a solid-top check, deduplicating landings by tile cell
 */
export function collectLeapLandings(
  ctx: ArcContext,
  centerX: number,
  centerY: number,
  dir: 1 | -1,
  launchVx: number,
  maxLaunchVelocity: number = PLAYER_JUMP_VELOCITY,
): LeapLanding[] {
  const { solidAt } = ctx;
  const steps = Math.ceil(
    (LEAP_MIN_LAUNCH_VELOCITY - maxLaunchVelocity) / LEAP_LAUNCH_STEP,
  );
  const out: LeapLanding[] = [];
  const seen = new Set<number>();
  for (let i = 0; i <= steps; i++) {
    const vy = Math.max(
      LEAP_MIN_LAUNCH_VELOCITY - i * LEAP_LAUNCH_STEP,
      maxLaunchVelocity,
    );
    const landing = simulateLeapArc(ctx, centerX, centerY, dir, launchVx, vy);
    if (!landing) continue;
    if (!solidAt(landing.x - LEAP_LANDING_MARGIN_PX * dir, landing.y)) continue;
    const key =
      Math.floor(landing.x / TILE_PX) * 100000 + Math.floor(landing.y / TILE_PX);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: landing.x, y: landing.y, vy });
  }
  return out;
}

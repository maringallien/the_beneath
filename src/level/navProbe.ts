// Pure, Phaser-free ballistic reachability probe — the shared "can a body get
// from here to there with one jump?" oracle that the NavGraph builder uses to
// generate jump edges.
//
// IMPORTANT: this is a faithful MIRROR of Enemy.ts's chase-leap solver
// (simulateLeapArc / findLeapLanding / columnSolid / rowSolid). The two are kept
// algorithm-identical ON PURPOSE: the graph plans jumps with exactly the physics
// the live enemy executes, so every jump edge the pathfinder emits is one the
// body can actually land — the executor never stalls on a waypoint it can't
// reach. If you change the arc math in one place, change it in BOTH. (Enemy keeps
// its own copy rather than importing this because its constants are entangled
// with other locomotion helpers; this module stays Phaser-free and unit-testable
// in isolation and is reusable from the graph builder with a canonical body.)

import { PLAYER_JUMP_VELOCITY } from '../constants';

// World grid size (px). LDtk authors this game on a 16 px tile.
export const TILE_PX = 16;

// Ballistic-probe integration step (matches the 60 Hz physics tick) and time
// budget (exceeds the player's flat airtime so long downward arcs / wall-slide
// shaft climbs are still found).
const LEAP_PROBE_STEP_S = 1 / 60;
const LEAP_PROBE_MAX_TIME_S = 1.3;
// Sample stride (px) when testing a body edge against the tile grid. Half a tile
// catches every 16 px collider along a body span without a query per pixel.
const LEAP_PROBE_SAMPLE_PX = 8;
// A landing must clear at least this far (px) past the takeoff edge to count, so
// the probe never "lands" the body back on the platform it leapt from.
const LEAP_MIN_ADVANCE_PX = 16;
// Gentlest cross-gap leap (rises exactly one tile). v = √(2·g·h), g=800, h=16.
const LEAP_MIN_LAUNCH_VELOCITY = -160;
// Search granularity for the minimum-sufficient launch velocity (~13 candidate
// arcs between the one-tile floor and the player max).
const LEAP_LAUNCH_STEP = 15;
// Horizontal safety margin (px) the descending foot must clear past the landing
// platform's near edge, so Arcade resolves the touch on Y (rest on top) not X.
const LEAP_LANDING_MARGIN_PX = 12;

// True iff a solid tile exists at the given world pixel.
export type SolidAt = (x: number, y: number) => boolean;

// World rect a ballistic arc is confined to (the level it launched from). Mirrors
// Enemy's getLevelBoundsAt: an arc that leaves these bounds is abandoned, so
// graph jump edges stay within a single level and cross-level travel is walk-only.
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

// True if any solid tile lies on the vertical segment at xEdge from yTop to
// yBottom (the body's leading side hitting a wall). Sampled every
// LEAP_PROBE_SAMPLE_PX plus the bottom endpoint so no 16 px collider slips by.
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

// True if any solid tile lies on the horizontal segment at yEdge from xLeft to
// xRight (a foot row to land on, or a head row / ceiling).
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

// Swept-AABB reachability probe for a SINGLE launch velocity. Integrates the body
// box as Arcade would (semi-implicit Euler, X and Y resolved separately): it
// SLIDES along a wall in its path (the key to vertical-shaft climbs), bonks
// ceilings (vy zeroed, then falls), and rests its foot on the first standable
// floor it descends onto. Returns the leading-foot landing point, or null if
// nothing standable is reached within the bounds + time budget. A landing must
// have left the takeoff spot — moved a body-step horizontally OR changed level by
// a tile — so it never "lands" back where it launched.
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
      // Descending: a solid row under the foot is a landing if the body can
      // stand there (head + mid rows clear) and it has left the takeoff spot.
      const footY = newCy + hh;
      if (rowSolid(solidAt, footY, cx - hw, cx + hw)) {
        // Inset the headroom samples by 1 px so a wall flush against the body's
        // side (a shaft platform reached by riding up its face) doesn't read as
        // "no headroom" — only solids genuinely above count.
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
      // Ascending: a solid row at the head is a ceiling — the real body's rise is
      // zeroed here (then gravity returns it), so stop rising and hold cy.
      if (rowSolid(solidAt, newCy - hh, cx - hw, cx + hw)) {
        vy = 0;
      } else {
        cy = newCy;
      }
    }
  }
  return null;
}

// Leap solver. Tries launch velocities from the gentlest (a one-tile hop) up to
// `maxLaunchVelocity` (default = the player's jump) and returns the launch whose
// landing best advances toward `target`, ascending the ladder and only switching
// to a stronger arc when it lands a full tile closer. Returns null when nothing
// lands with margin. launchVx must be the SAME horizontal speed the takeoff
// applies so the predicted arc matches the real one.
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

// Graph-build variant of findLeapLanding: instead of the single best landing
// toward a target, returns EVERY distinct standable landing reachable off this
// edge across the launch ladder (deduped by tile cell). Each becomes a jump edge
// in the NavGraph, so a node can branch to several platforms it can hop to.
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

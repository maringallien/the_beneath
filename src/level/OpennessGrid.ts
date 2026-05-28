import {
  OPENNESS_CONTRAST_POWER,
  OPENNESS_REGION_RADIUS_CELLS,
  OPENNESS_SATURATION_CELLS,
} from '../constants';
import type { IntGridData } from '../ldtk/parseLdtk';

// Pre-computed per-cell openness scores for one level. Values are in [0, 1]
// — 0 means "fully enclosed by walls" (e.g. inside a wall, or in a single
// tile pocket), 1 means "fully open" (every direction reaches at least
// OPENNESS_SATURATION_CELLS before hitting a wall or the level edge).
// Stored row-major: index = y * cWid + x.
export interface OpennessGrid {
  readonly cWid: number;
  readonly cHei: number;
  readonly values: Float32Array;
}

// Eight cardinal/diagonal direction vectors used for the wall-distance
// raycast. Order matches the convention in many roguelike line-of-sight
// algorithms (N, NE, E, SE, S, SW, W, NW); only the magnitudes matter for
// openness — direction labels are documentation.
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

// Cells that fail the walkable test still need an openness value so the
// lighting texture has no holes at wall pixels — without this, the additive
// overlay's per-pixel alpha drops to 0 at wall cells, leaving a dark seam
// around every doorway. Solid cells inherit the max openness of their
// 4-neighbors, so the room-side wall lifts with the room while the
// corridor-side wall lifts with the corridor — no hard cliff.
//
// Returns null for inputs that can't yield a meaningful grid: zero-sized
// levels (which the renderer skips anyway) or grids with no walkable cells
// at all (pure-solid blockers — also not lit). Callers treat null as "skip
// the lighting overlay for this level" and the existing dim still applies.
export function computeOpennessGrid(intGrid: IntGridData): OpennessGrid | null {
  const { cWid, cHei, csv } = intGrid;
  if (cWid <= 0 || cHei <= 0) return null;
  if (csv.length !== cWid * cHei) {
    throw new Error(
      `IntGrid CSV length ${csv.length} does not match cWid*cHei = ${cWid * cHei}`,
    );
  }

  // Pre-build a walkable mask so the inner raycast loop branches once per
  // cell rather than re-checking IntGrid semantics. LDtk convention: CSV 0
  // = empty/walkable, any non-zero = some IntGrid value (typically a wall).
  const walkable = new Uint8Array(cWid * cHei);
  let anyWalkable = false;
  for (let i = 0; i < csv.length; i++) {
    if (csv[i] === 0) {
      walkable[i] = 1;
      anyWalkable = true;
    }
  }
  if (!anyWalkable) return null;

  const values = new Float32Array(cWid * cHei);
  const saturation = Math.max(1, OPENNESS_SATURATION_CELLS);

  // Pass 1: walkable cells get the 8-direction raycast openness.
  for (let y = 0; y < cHei; y++) {
    for (let x = 0; x < cWid; x++) {
      const idx = y * cWid + x;
      if (!walkable[idx]) continue;
      values[idx] = rayCastOpennessAt(x, y, walkable, cWid, cHei, saturation);
    }
  }

  // Pass 2: region average. Each walkable cell's score is replaced with the
  // mean openness of the *walkable* cells within OPENNESS_REGION_RADIUS_CELLS.
  // This is the key step that makes brightness reflect the surrounding
  // region's openness instead of the player's exact tile — a player at the
  // edge of a big room samples the room's average rather than just their
  // own (low, wall-adjacent) cell. Wall cells are excluded from the average
  // so a 10×10 room surrounded by thick walls doesn't have its score
  // dragged toward 0 by the wall pixels.
  regionAverageOverWalkable(
    values,
    walkable,
    cWid,
    cHei,
    OPENNESS_REGION_RADIUS_CELLS,
  );

  // Pass 3: solid cells inherit max openness from their walkable 4-neighbors
  // so the wall-to-room boundary isn't a brightness cliff. Runs AFTER the
  // region average so walls inherit the region-averaged values that
  // walkable cells now hold. Solids with no walkable neighbor (e.g.
  // interior of a thick wall) stay at 0 — the player can't sample those.
  fillSolidsFromNeighbors(values, walkable, cWid, cHei);

  // Pass 4: contrast power curve. Applied AFTER region averaging so it
  // sharpens the final per-cell scores without first being smeared away.
  // With power < 1 the curve lifts mid-range values toward 1, widening
  // the perceived gap between cramped corridors and open rooms. With
  // power = 1.0 this pass is a no-op. Skipped at exactly 1 so the
  // production path doesn't pay for Math.pow on every cell when disabled.
  if (OPENNESS_CONTRAST_POWER !== 1) {
    for (let i = 0; i < values.length; i++) {
      values[i] = Math.pow(values[i], OPENNESS_CONTRAST_POWER);
    }
  }

  return { cWid, cHei, values };
}

// Walks outward from (x, y) along each of the 8 direction vectors until it
// hits a non-walkable cell or the level edge, recording the distance in
// cells. Openness = min(distances) / saturation, clamped to [0, 1]. Using
// min (not avg/max) makes a tile that is 12 cells from the ceiling but 1
// cell from a wall count as "tight" — matching the physical feel of a
// corridor regardless of its length.
function rayCastOpennessAt(
  x: number,
  y: number,
  walkable: Uint8Array,
  cWid: number,
  cHei: number,
  saturation: number,
): number {
  let minDist = saturation; // Cap walks at the saturation point — distances
  // beyond it don't change the openness score, and stopping early caps the
  // worst-case loop count at 8 * saturation per cell instead of 8 * max(w,h).
  for (const [dx, dy] of DIRS) {
    let dist = 0;
    let cx = x;
    let cy = y;
    while (dist < saturation) {
      cx += dx;
      cy += dy;
      if (cx < 0 || cx >= cWid || cy < 0 || cy >= cHei) break;
      if (!walkable[cy * cWid + cx]) break;
      dist++;
    }
    if (dist < minDist) minDist = dist;
    if (minDist === 0) return 0; // 1-cell pocket — no need to check other dirs.
  }
  return minDist / saturation;
}

// Solid cells inherit the maximum openness of their 4-neighbors. Using max
// (not avg) makes the brightness transition feel like it "spills" out of
// the room across the wall edge rather than fading into it — which is what
// real light scattering looks like at a doorway. Iterates over a copy so
// the source values don't shift mid-pass.
function fillSolidsFromNeighbors(
  values: Float32Array,
  walkable: Uint8Array,
  cWid: number,
  cHei: number,
): void {
  const source = new Float32Array(values);
  for (let y = 0; y < cHei; y++) {
    for (let x = 0; x < cWid; x++) {
      const idx = y * cWid + x;
      if (walkable[idx]) continue;
      let best = 0;
      if (x > 0) best = Math.max(best, source[idx - 1]);
      if (x < cWid - 1) best = Math.max(best, source[idx + 1]);
      if (y > 0) best = Math.max(best, source[idx - cWid]);
      if (y < cHei - 1) best = Math.max(best, source[idx + cWid]);
      values[idx] = best;
    }
  }
}

// Replaces each cell's value with the mean openness of the WALKABLE cells
// within `radius` cells in both axes. Walls are excluded so a small room
// surrounded by thick walls doesn't have its score dragged toward 0 by the
// surrounding wall pixels; only the room itself contributes to the average.
//
// Net effect: every walkable cell ends up with a "region openness" score —
// the same score for every cell in a uniform room — which removes the
// per-cell variation the user was seeing. The radius controls the effective
// "region" size: too small → still per-cell-ish; too large → smears
// across multiple rooms. The temporary source copy makes the pass order-
// independent (writing into values during the loop would let earlier
// writes pollute later neighborhood reads).
//
// Walls (non-walkable cells) are written 0 here; the wall-fill pass that
// runs after restores them from walkable neighbors.
//
// Complexity: O(cWid * cHei * (2*radius+1)^2). For a 256-cell level with
// radius 10, that's ~115k ops — negligible at world load time.
function regionAverageOverWalkable(
  values: Float32Array,
  walkable: Uint8Array,
  cWid: number,
  cHei: number,
  radius: number,
): void {
  const source = new Float32Array(values);
  for (let y = 0; y < cHei; y++) {
    const yMin = Math.max(0, y - radius);
    const yMax = Math.min(cHei - 1, y + radius);
    for (let x = 0; x < cWid; x++) {
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(cWid - 1, x + radius);
      let sum = 0;
      let count = 0;
      for (let ny = yMin; ny <= yMax; ny++) {
        const rowBase = ny * cWid;
        for (let nx = xMin; nx <= xMax; nx++) {
          const nidx = rowBase + nx;
          if (!walkable[nidx]) continue;
          sum += source[nidx];
          count++;
        }
      }
      values[y * cWid + x] = count > 0 ? sum / count : 0;
    }
  }
}

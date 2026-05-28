import type { OpennessGrid } from './OpennessGrid';

interface LookupEntry {
  readonly identifier: string;
  readonly worldX: number;
  readonly worldY: number;
  readonly pxWid: number;
  readonly pxHei: number;
  readonly gridSize: number;
  readonly grid: OpennessGrid;
}

// Spatial lookup over per-level openness grids. Built once during world load
// from each level's IntGrid + computed OpennessGrid, then queried each frame
// with the player's world-space (x, y) to get the current local openness
// score in [0, 1]. Returns null when (x, y) lies outside every level (e.g.
// mid-jump across an inter-level seam) — callers can hold the last known
// value to avoid the screen flashing dark in the gap.
export class OpennessLookup {
  private readonly entries: LookupEntry[] = [];

  add(entry: LookupEntry): void {
    this.entries.push(entry);
  }

  // Sample openness at a world point. Linear search over levels — LDtk world
  // has tens of levels at most, and the player can only be inside one at a
  // time, so the first hit wins. Cell index is computed by integer-dividing
  // the level-local offset by the IntGrid's gridSize.
  sample(worldX: number, worldY: number): number | null {
    for (const e of this.entries) {
      if (
        worldX < e.worldX ||
        worldX >= e.worldX + e.pxWid ||
        worldY < e.worldY ||
        worldY >= e.worldY + e.pxHei
      ) {
        continue;
      }
      const cx = Math.floor((worldX - e.worldX) / e.gridSize);
      const cy = Math.floor((worldY - e.worldY) / e.gridSize);
      // Defensive bounds check: in practice (cx, cy) is always in range
      // because the outer rect check covered the level extent, but rounding
      // at the level edge can land cx == cWid (cell index == count). Clamp
      // rather than crash; the wall-fill pass guarantees a valid value at
      // every in-range cell.
      const ccx = cx < 0 ? 0 : cx >= e.grid.cWid ? e.grid.cWid - 1 : cx;
      const ccy = cy < 0 ? 0 : cy >= e.grid.cHei ? e.grid.cHei - 1 : cy;
      return e.grid.values[ccy * e.grid.cWid + ccx];
    }
    return null;
  }

  clear(): void {
    this.entries.length = 0;
  }
}

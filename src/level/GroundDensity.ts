import type { IntGridData } from '../ldtk/parseLdtk';

// One sampleable level: its world-space origin plus its IntGrid (null for
// levels that have no IntGrid layer — those contribute nothing but their
// footprint still reads as open space). Structurally satisfied by GameScene's
// LevelSlot, so the sampler can take the live slot array directly.
export interface DensitySlot {
  readonly worldX: number;
  readonly worldY: number;
  readonly intGrid: IntGridData | null;
}

// Fraction of a fixed cell window — centered on (centerX, centerY) in world
// px — that is filled with solid terrain (non-zero IntGrid cells). Returns a
// value in [0, 1]: 0 = the window is entirely open air (wide cavern / mid-air
// between levels), 1 = solid rock to every edge (the player wedged in a tight
// tunnel).
//
// The window is sized in CELLS, not viewport pixels, so the result is
// independent of the player's window size — keeping the density calibration
// (VIGNETTE_REFERENCE_DENSITY) stable across resolutions. Cells that fall
// outside every level (inter-level whitespace) are simply never counted as
// solid, so they read as open and the divisor stays the full window area.
//
// Allocation-free: it indexes each overlapping level's CSV directly rather
// than materializing Phaser Tile objects, so it is cheap enough to run every
// frame (~450 integer reads for the default 28×16 window).
export function sampleSolidDensity(
  slots: ReadonlyArray<DensitySlot>,
  centerX: number,
  centerY: number,
  halfWidthCells: number,
  halfHeightCells: number,
  gridSize: number,
): number {
  const totalCells = halfWidthCells * 2 * (halfHeightCells * 2);
  if (totalCells <= 0 || gridSize <= 0) return 0;

  const halfWpx = halfWidthCells * gridSize;
  const halfHpx = halfHeightCells * gridSize;
  const left = centerX - halfWpx;
  const right = centerX + halfWpx;
  const top = centerY - halfHpx;
  const bottom = centerY + halfHpx;

  let solid = 0;
  for (const slot of slots) {
    const ig = slot.intGrid;
    if (!ig) continue;

    // Clip the sample rect to this level's footprint (world px).
    const levelRight = slot.worldX + ig.cWid * ig.gridSize;
    const levelBottom = slot.worldY + ig.cHei * ig.gridSize;
    const clipL = Math.max(left, slot.worldX);
    const clipT = Math.max(top, slot.worldY);
    const clipR = Math.min(right, levelRight);
    const clipB = Math.min(bottom, levelBottom);
    if (clipR <= clipL || clipB <= clipT) continue;

    // Overlap → this level's cell-index range (clamped to grid bounds).
    const cx0 = Math.max(0, Math.floor((clipL - slot.worldX) / ig.gridSize));
    const cy0 = Math.max(0, Math.floor((clipT - slot.worldY) / ig.gridSize));
    const cx1 = Math.min(ig.cWid, Math.ceil((clipR - slot.worldX) / ig.gridSize));
    const cy1 = Math.min(ig.cHei, Math.ceil((clipB - slot.worldY) / ig.gridSize));

    for (let cy = cy0; cy < cy1; cy += 1) {
      const rowBase = cy * ig.cWid;
      for (let cx = cx0; cx < cx1; cx += 1) {
        if (ig.csv[rowBase + cx] !== 0) solid += 1;
      }
    }
  }

  return solid / totalCells;
}

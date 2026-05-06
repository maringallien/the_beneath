import Phaser from 'phaser';
import type { IntGridData } from '../ldtk/parseLdtk';

const SOLID_TILE_INDEX = 1;
const EMPTY_TILE_INDEX = -1;

// Builds an invisible Phaser tilemap layer whose collision shape mirrors the
// IntGrid CSV. Decoupled from the visual rendering (LevelRenderer) so we don't
// fight Tilemap's grid-locked, one-tile-per-cell constraints when LDtk auto-
// rules emit off-grid or stacked decorations. Caller passes a tileset texture
// key purely to satisfy the Tilemap API — the layer is never drawn.
// `worldOffsetX/Y` shifts the layer to its level's world position, so multiple
// per-level collision tilemaps coexist in the same scene without overlap.
export function buildIntGridCollision(
  scene: Phaser.Scene,
  intGrid: IntGridData,
  tilesetTextureKey: string,
  worldOffsetX = 0,
  worldOffsetY = 0,
): Phaser.Tilemaps.TilemapLayer {
  const { csv, cWid, cHei, gridSize } = intGrid;

  const data: number[][] = [];
  for (let gy = 0; gy < cHei; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < cWid; gx++) {
      // Treat any non-zero IntGrid value as solid for now. When new IntGrid
      // values gain semantics (hazards, one-way platforms), branch here and
      // emit different tile indices, then setCollision per index below.
      row.push(csv[gy * cWid + gx] !== 0 ? SOLID_TILE_INDEX : EMPTY_TILE_INDEX);
    }
    data.push(row);
  }

  const map = scene.make.tilemap({
    data,
    tileWidth: gridSize,
    tileHeight: gridSize,
  });

  const tileset = map.addTilesetImage(
    'collision',
    tilesetTextureKey,
    gridSize,
    gridSize,
  );
  if (!tileset) {
    throw new Error(
      `buildIntGridCollision: failed to create tileset from texture "${tilesetTextureKey}"`,
    );
  }

  const layer = map.createLayer(0, tileset, worldOffsetX, worldOffsetY);
  if (!layer) {
    throw new Error('buildIntGridCollision: failed to create collision layer');
  }
  layer.setVisible(false);
  layer.setCollision([SOLID_TILE_INDEX]);
  return layer;
}

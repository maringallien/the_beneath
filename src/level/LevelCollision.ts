import Phaser from 'phaser';
import type { IntGridData } from '../ldtk/parseLdtk';

const EMPTY_TILE_INDEX = -1;

// Builds an invisible Phaser tilemap layer whose collision shape mirrors the
// IntGrid CSV. Decoupled from the visual rendering (LevelRenderer) so we don't
// fight Tilemap's grid-locked, one-tile-per-cell constraints when LDtk auto-
// rules emit off-grid or stacked decorations. Caller passes a tileset texture
// key purely to satisfy the Tilemap API — the layer is never drawn.
// `worldOffsetX/Y` shifts the layer to its level's world position, so multiple
// per-level collision tilemaps coexist in the same scene without overlap.
//
// Tile indices on the layer are the raw IntGrid values (1=ground, 2=bridge,
// ...). Callers like GameScene.getIntGridValueAt read tile.index to decide
// surface-specific behavior (e.g. pebble footsteps on ground only). Empty
// cells are EMPTY_TILE_INDEX so Phaser returns null for getTileAtWorldXY.
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
      const v = csv[gy * cWid + gx];
      row.push(v !== 0 ? v : EMPTY_TILE_INDEX);
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
  // Every non-empty IntGrid value is solid for now. setCollisionByExclusion
  // future-proofs against new IntGrid values being added in LDtk without
  // having to thread the value set through here.
  layer.setCollisionByExclusion([EMPTY_TILE_INDEX]);
  return layer;
}

import Phaser from 'phaser';
import type { IntGridData } from '../ldtk/parseLdtk';

/**
 * @file level/LevelCollision.ts
 * @description Builds the invisible per-level collision tilemap from IntGrid; turns the LDtk IntGrid CSV into an undrawn Phaser tilemap layer whose solidity mirrors the grid; deliberately separate from the visual renderer so it doesn't inherit Tilemap's grid-locked one-tile-per-cell constraints; layer tile indices are the raw IntGrid values so surface-aware callers can read them back.
 * @module level
 */

// Sentinel index for empty cells; Phaser then returns null for tile lookups there.
const EMPTY_TILE_INDEX = -1;

/**
 * @function    buildIntGridCollision
 * @description Builds an invisible collision TilemapLayer from the IntGrid CSV; non-zero values are solid and carry their raw value for surface-aware callers.
 * @param   scene              The scene.
 * @param   intGrid            CSV + cWid/cHei/gridSize.
 * @param   tilesetTextureKey  The tileset texture key.
 * @param   worldOffsetX       World px X offset (default 0).
 * @param   worldOffsetY       World px Y offset (default 0).
 * @returns a hidden, collision-enabled TilemapLayer positioned at the world offset; throws if the tileset or layer can't be created.
 * @calledby src/scenes/GameScene.ts → world build, once per level during scene setup
 * @calls    Phaser's tilemap factory (make / addTilesetImage / createLayer) and exclude-based collision setup
 */
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
  // Exclude-based so new IntGrid values added in LDtk are solid by default without updating this code.
  layer.setCollisionByExclusion([EMPTY_TILE_INDEX]);
  return layer;
}

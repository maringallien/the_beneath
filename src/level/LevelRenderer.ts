import Phaser from 'phaser';
import { getRenderableLayers, getTilesetDefs } from '../ldtk/parseLdtk';
import type {
  LdtkLayerType,
  LdtkLevel,
  LdtkProject,
} from '../ldtk/types';
import { tilesetTextureKey } from './TilesetRegistry';

const FLIP_HORIZONTAL = 1;
const FLIP_VERTICAL = 2;

export interface RenderedLayer {
  identifier: string;
  type: Exclude<LdtkLayerType, 'Entities'>;
  // One Container per LDtk layer. Children are added in autoLayerTiles order
  // so stacked tiles paint bottom-to-top, matching LDtk's editor behavior.
  container: Phaser.GameObjects.Container;
}

export interface RenderedLevel {
  widthPx: number;
  heightPx: number;
  layers: ReadonlyArray<RenderedLayer>;
}

// Renders each LDtk tile as an individual Image at its exact px position.
// Why not Phaser Tilemap: LDtk auto-rules can produce sub-grid placements
// (rule pivot offsets) and per-cell stacks (Stamp rules with multi-tile
// outputs). Tilemap is grid-locked and one-tile-per-cell, so it silently
// drops both. Image-per-tile preserves what the LDtk editor shows. Collision
// is handled separately by LevelCollision (IntGrid CSV → invisible tilemap),
// so visual fidelity here doesn't have to compromise with physics structure.
export function renderLevel(
  scene: Phaser.Scene,
  project: LdtkProject,
  level: LdtkLevel,
): RenderedLevel {
  const tilesetDefs = getTilesetDefs(project);
  const renderable = getRenderableLayers(level);
  const out: RenderedLayer[] = [];

  renderable.forEach((src, depthIndex) => {
    const tilesetDef = tilesetDefs.get(src.tilesetUid);
    if (!tilesetDef) {
      throw new Error(
        `Layer "${src.identifier}" references tileset uid=${src.tilesetUid}, which is not defined`,
      );
    }
    const textureKey = tilesetTextureKey(tilesetDef.uid);
    if (!scene.textures.exists(textureKey)) {
      throw new Error(
        `Tileset texture "${textureKey}" not loaded — was preloadTilesets() called for level "${level.identifier}"?`,
      );
    }

    const container = scene.add.container(0, 0);
    container.setDepth(depthIndex);

    for (const t of src.tiles) {
      const img = scene.add.image(t.px[0], t.px[1], textureKey, t.t);
      img.setOrigin(0, 0);
      if ((t.f & FLIP_HORIZONTAL) !== 0) img.setFlipX(true);
      if ((t.f & FLIP_VERTICAL) !== 0) img.setFlipY(true);
      container.add(img);
    }

    out.push({ identifier: src.identifier, type: src.type, container });
  });

  return {
    widthPx: level.pxWid,
    heightPx: level.pxHei,
    layers: out,
  };
}

export function findRenderedLayer(
  rendered: RenderedLevel,
  identifier: string,
): RenderedLayer | undefined {
  return rendered.layers.find((l) => l.identifier === identifier);
}

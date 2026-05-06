import Phaser from 'phaser';
import {
  getRenderableEntityLayers,
  getRenderableLayers,
  getTilesetDefs,
  type RenderableEntityTile,
} from '../ldtk/parseLdtk';
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
  type: LdtkLayerType;
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

  for (const src of renderable) {
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

    // Place each level's container at its world coordinates so multiple
    // levels rendered in the same scene line up like LDtk's world view.
    const container = scene.add.container(level.worldX, level.worldY);
    // Depth comes from the layer's position in level.layerInstances so
    // layers stack at the LDtk-authored position.
    container.setDepth(src.depth);

    for (const t of src.tiles) {
      const img = scene.add.image(t.px[0], t.px[1], textureKey, t.t);
      img.setOrigin(0, 0);
      if ((t.f & FLIP_HORIZONTAL) !== 0) img.setFlipX(true);
      if ((t.f & FLIP_VERTICAL) !== 0) img.setFlipY(true);
      container.add(img);
    }

    out.push({ identifier: src.identifier, type: src.type, container });
  }

  // Decoration entities (LDtk entities with embedded __tile references) live
  // in Entities-type layers and need their own rendering pass. Same Container-
  // per-layer + depth-by-layer-index scheme as the tile layers above, so the
  // user's LDtk-authored stacking between tile layers and decoration layers
  // is preserved.
  const entityLayers = getRenderableEntityLayers(level);
  for (const src of entityLayers) {
    const container = scene.add.container(level.worldX, level.worldY);
    container.setDepth(src.depth);
    for (const dec of src.decorations) {
      const tilesetDef = tilesetDefs.get(dec.tilesetUid);
      if (!tilesetDef) {
        throw new Error(
          `Layer "${src.identifier}" entity tile references tileset uid=${dec.tilesetUid}, which is not defined`,
        );
      }
      const textureKey = tilesetTextureKey(tilesetDef.uid);
      if (!scene.textures.exists(textureKey)) {
        throw new Error(
          `Tileset texture "${textureKey}" not loaded — was preloadTilesets() called for level "${level.identifier}"?`,
        );
      }
      const img = createEntityTileImage(scene, textureKey, dec);
      container.add(img);
    }
    out.push({ identifier: src.identifier, type: 'Entities', container });
  }

  return {
    widthPx: level.pxWid,
    heightPx: level.pxHei,
    layers: out,
  };
}

// LDtk entity tiles use arbitrary src rects (tile.w/h can be larger than the
// tileset's tileGridSize). Phaser's spritesheet loader only produces fixed-
// size frames, so we register a custom-rect frame on the same texture for
// each unique entity-tile crop and reference it by name. Frames are cached
// across renders by their (uid + src rect) key — re-rendering after HMR
// reuses existing frames instead of duplicating them.
function createEntityTileImage(
  scene: Phaser.Scene,
  textureKey: string,
  dec: RenderableEntityTile,
): Phaser.GameObjects.Image {
  const frameName = `entityTile_${dec.srcX}_${dec.srcY}_${dec.srcW}_${dec.srcH}`;
  const texture = scene.textures.get(textureKey);
  if (!texture.has(frameName)) {
    texture.add(frameName, 0, dec.srcX, dec.srcY, dec.srcW, dec.srcH);
  }
  const img = scene.add.image(dec.px, dec.py, textureKey, frameName);
  img.setOrigin(dec.pivotX, dec.pivotY);
  return img;
}

export function findRenderedLayer(
  rendered: RenderedLevel,
  identifier: string,
): RenderedLayer | undefined {
  return rendered.layers.find((l) => l.identifier === identifier);
}

// Symmetric teardown for renderLevel. Container.destroy(true) recursively
// destroys child Images, which is safe here because tile Images have no
// physics bodies (renderLevel uses scene.add.image, not physics.add.image).
// Collision tilemaps are owned by GameScene/LevelCollision and torn down
// separately — they don't appear in RenderedLevel.layers.
export function destroyRenderedLevel(rendered: RenderedLevel): void {
  for (const layer of rendered.layers) {
    layer.container.destroy(true);
  }
}

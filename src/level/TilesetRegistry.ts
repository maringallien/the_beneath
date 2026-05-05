import Phaser from 'phaser';
import {
  getRenderableLayers,
  getTilesetDefs,
} from '../ldtk/parseLdtk';
import type {
  LdtkLevel,
  LdtkProject,
  LdtkTilesetDef,
} from '../ldtk/types';

// Deterministic Phaser texture key per tileset. Sharing the same scheme between
// preload and render keeps the two ends decoupled — the renderer doesn't need
// to know how the asset was loaded, only what key it lives under.
export function tilesetTextureKey(uid: number): string {
  return `ldtkTileset_${uid}`;
}

// Tileset relPaths in the LDtk file are relative to the project root (e.g.
// "public/DarkSpriteLib/..."). Vite serves files in `public/` at the document
// root, so the runtime URL is the path with the `public/` prefix stripped.
function relPathToUrl(relPath: string): string {
  return relPath.startsWith('public/')
    ? '/' + relPath.slice('public/'.length)
    : '/' + relPath;
}

export function collectTilesetsForLevel(
  project: LdtkProject,
  level: LdtkLevel,
): LdtkTilesetDef[] {
  const defs = getTilesetDefs(project);
  const usedUids = new Set<number>();
  for (const layer of getRenderableLayers(level)) {
    usedUids.add(layer.tilesetUid);
  }
  const out: LdtkTilesetDef[] = [];
  for (const uid of usedUids) {
    const def = defs.get(uid);
    if (!def) {
      throw new Error(
        `Level "${level.identifier}" references tileset uid=${uid}, but no tileset def with that uid exists`,
      );
    }
    if (!def.relPath) {
      throw new Error(
        `Tileset uid=${uid} ("${def.identifier}") has no relPath — cannot preload`,
      );
    }
    out.push(def);
  }
  return out;
}

// Loaded as a spritesheet (not a plain image) so each tile is addressable as a
// numeric frame index — required for Image-based rendering of off-grid and
// stacked tiles. Phaser's Tilemap can still consume a spritesheet-loaded
// texture if a layer ever wants tilemap rendering, so this strictly upgrades
// what we can do with the same underlying texture.
export function preloadTilesets(
  scene: Phaser.Scene,
  tilesets: ReadonlyArray<LdtkTilesetDef>,
): void {
  for (const ts of tilesets) {
    if (!ts.relPath) continue;
    const key = tilesetTextureKey(ts.uid);
    if (scene.textures.exists(key)) continue;
    scene.load.spritesheet(key, relPathToUrl(ts.relPath), {
      frameWidth: ts.tileGridSize,
      frameHeight: ts.tileGridSize,
      margin: ts.padding,
      spacing: ts.spacing,
    });
  }
}

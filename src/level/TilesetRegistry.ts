import Phaser from 'phaser';
import { GENERAL_ENEMY_SPAWN_IDENTIFIER } from '../constants';
import {
  getRenderableEntityLayers,
  getRenderableLayers,
  getTilesetDefs,
} from '../ldtk/parseLdtk';

// Logic-only marker entities that are never rendered (see LevelRenderer's
// skip set). Their LDtk def may carry a preview-tile reference to a tileset
// that doesn't exist in this project, so they must also be excluded from
// tileset collection — otherwise the "references tileset uid=… but no def"
// guard below would throw on a level that only "uses" that tileset via a
// marker preview.
const NON_RENDERED_MARKER_IDENTIFIERS: ReadonlySet<string> = new Set([
  GENERAL_ENEMY_SPAWN_IDENTIFIER,
]);
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
  // Entity-tile decorations reference tilesets via inst.__tile.tilesetUid,
  // which is independent of the layer's __tilesetDefUid (layer is Entities-
  // type, so its own tileset is null). Collect those too — otherwise the
  // renderer throws "Tileset texture not loaded" the first time it walks a
  // level whose decorations point at a tileset no tile layer happens to use.
  for (const layer of getRenderableEntityLayers(
    level,
    NON_RENDERED_MARKER_IDENTIFIERS,
  )) {
    for (const dec of layer.decorations) {
      usedUids.add(dec.tilesetUid);
    }
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

// Aggregates tilesets used across every level in the project, deduplicated.
// Used when the scene renders multiple levels at once so all required textures
// are preloaded up front (no on-demand loading mid-walk between levels).
export function collectTilesetsForAllLevels(
  project: LdtkProject,
): LdtkTilesetDef[] {
  const seen = new Set<number>();
  const out: LdtkTilesetDef[] = [];
  for (const level of project.levels) {
    for (const def of collectTilesetsForLevel(project, level)) {
      if (seen.has(def.uid)) continue;
      seen.add(def.uid);
      out.push(def);
    }
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

// Mid-game tileset loader. Used by HMR when an LDtk reload references a
// tileset that wasn't part of the initial preload (e.g. user added a new
// layer using a brand-new PNG). Resolves once Phaser's loader finishes, so
// callers can safely render the new texture without "Tileset texture not
// loaded" errors. Resolves immediately if every tileset is already in cache.
export function loadTilesetsAtRuntime(
  scene: Phaser.Scene,
  tilesets: ReadonlyArray<LdtkTilesetDef>,
): Promise<void> {
  const toLoad = tilesets.filter(
    (ts) =>
      ts.relPath != null &&
      !scene.textures.exists(tilesetTextureKey(ts.uid)),
  );
  if (toLoad.length === 0) {
    return Promise.resolve();
  }

  for (const ts of toLoad) {
    if (!ts.relPath) continue;
    scene.load.spritesheet(
      tilesetTextureKey(ts.uid),
      relPathToUrl(ts.relPath),
      {
        frameWidth: ts.tileGridSize,
        frameHeight: ts.tileGridSize,
        margin: ts.padding,
        spacing: ts.spacing,
      },
    );
  }

  return new Promise<void>((resolve, reject) => {
    const onComplete = (): void => {
      scene.load.off('loaderror', onError);
      resolve();
    };
    const onError = (file: Phaser.Loader.File): void => {
      scene.load.off('complete', onComplete);
      reject(
        new Error(
          `Failed to load tileset asset "${file.key}" from "${file.url}". ` +
            'Vite serves files under public/ at the document root — make sure ' +
            'the tileset PNG referenced by LDtk lives under public/.',
        ),
      );
    };
    scene.load.once('complete', onComplete);
    scene.load.once('loaderror', onError);
    scene.load.start();
  });
}

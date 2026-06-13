import Phaser from 'phaser';
import { GENERAL_ENEMY_SPAWN_IDENTIFIER } from '../constants';
import {
  getRenderableEntityLayers,
  getRenderableLayers,
  getTilesetDefs,
} from '../ldtk/parseLdtk';

// Marker entities excluded from tileset collection; their preview tiles may reference tilesets that don't exist here.
const NON_RENDERED_MARKER_IDENTIFIERS: ReadonlySet<string> = new Set([
  GENERAL_ENEMY_SPAWN_IDENTIFIER,
]);
import type {
  LdtkLevel,
  LdtkProject,
  LdtkTilesetDef,
} from '../ldtk/types';

/**
 * TilesetRegistry — the texture-key contract and tileset preload path for LDtk levels.
 *
 * Owns the deterministic uid→Phaser-key scheme that decouples preload from render,
 * the collection of which tilesets a level (or the whole project) actually uses,
 * and the loaders that bring those PNGs into the scene texture cache. Tilesets are
 * loaded as spritesheets so individual tiles are addressable by frame index.
 * Collection walks both tile layers and entity-tile decorations (whose tilesets
 * are independent of any layer), while excluding non-rendered marker entities
 * whose preview tile may point at a tileset that doesn't exist here — so a level
 * never throws "references tileset uid=… but no def" over a marker preview.
 *
 * Inputs:  a parsed LDtk project/level, a scene, and tileset defs (uid, relPath,
 *          grid size, padding, spacing).
 * Outputs: stable texture keys; spritesheet loads into the scene texture cache;
 *          throws on a level that references a tileset with no def or no relPath.
 * @calledby the level preload and render paths, plus the HMR reload path.
 * @calls    the LDtk parse helpers and the scene's spritesheet loader.
 */

// Deterministic Phaser texture key for a tileset uid (shared by preload + render).
export function tilesetTextureKey(uid: number): string {
  return `ldtkTileset_${uid}`;
}

// LDtk relPath (project-root-relative, e.g. "public/...") → runtime URL. Vite
// serves public/ at the document root, so strip that prefix.
function relPathToUrl(relPath: string): string {
  return relPath.startsWith('public/')
    ? '/' + relPath.slice('public/'.length)
    : '/' + relPath;
}

// Collects the deduplicated tileset defs used by a level's tile layers and entity decorations.
export function collectTilesetsForLevel(
  project: LdtkProject,
  level: LdtkLevel,
): LdtkTilesetDef[] {
  const defs = getTilesetDefs(project);
  const usedUids = new Set<number>();
  for (const layer of getRenderableLayers(level)) {
    usedUids.add(layer.tilesetUid);
  }
  // Decorations reference tilesets independently of their layer; collect them too or the renderer throws on first use.
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

// Aggregates deduplicated tileset defs across all project levels for a full up-front preload.
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

// Queues tilesets as spritesheets in the scene loader, skipping any already cached.
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

// Loads any tilesets not already cached (HMR path); resolves when done or immediately if all cached.
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

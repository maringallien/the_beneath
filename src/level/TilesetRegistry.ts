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
 * @file level/TilesetRegistry.ts
 * @description The texture-key contract + tileset preload path; deterministic uid→Phaser-key scheme decoupling preload from render; collects which tilesets a level/project uses (walks tile layers AND entity-tile decorations, excluding non-rendered markers whose preview tile may point at a missing tileset); loads them as spritesheets so tiles are frame-addressable.
 * @module level
 */

/** Deterministic Phaser texture key for a tileset uid (shared by preload + render). */
export function tilesetTextureKey(uid: number): string {
  return `ldtkTileset_${uid}`;
}

/** LDtk relPath (project-root-relative, e.g. "public/...") → runtime URL; Vite serves public/ at the document root, so strip that prefix. */
function relPathToUrl(relPath: string): string {
  return relPath.startsWith('public/')
    ? '/' + relPath.slice('public/'.length)
    : '/' + relPath;
}

/**
 * @function    collectTilesetsForLevel
 * @description Collects the deduplicated tileset defs used by a level's tile layers and entity decorations.
 * @param   project  Parsed LDtk, for the tileset defs.
 * @param   level    The level to scan.
 * @returns the deduplicated tileset defs the level needs; throws if a referenced uid has no def or a def has no relPath.
 * @calledby src/level/TilesetRegistry.ts → collectTilesetsForAllLevels (same file; no external caller)
 * @calls    the LDtk parse helpers for renderable tile layers and entity decorations
 */
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

/**
 * @function    collectTilesetsForAllLevels
 * @description Aggregates deduplicated tileset defs across all project levels for a full up-front preload.
 * @param   project  Parsed LDtk with all levels.
 * @returns the deduplicated tileset defs used anywhere in the project; throws via the per-level scan on a bad reference.
 * @calledby src/scenes/PreloadScene.ts and src/scenes/GameScene.ts → boot/preload flow that loads every tileset up front
 * @calls    the per-level tileset collection, deduplicating by uid across levels
 */
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

/**
 * @function    preloadTilesets
 * @description Queues tilesets as spritesheets in the scene loader, skipping any already cached.
 * @param   scene     Its loader/texture cache.
 * @param   tilesets  Defs to queue: uid, relPath, grid size, padding, spacing.
 * @calledby src/scenes/PreloadScene.ts and src/level/LevelRenderer.ts → scene preload phase, before the loader runs
 * @calls    the rel-path-to-URL mapper and the scene's spritesheet loader
 */
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

/**
 * @function    loadTilesetsAtRuntime
 * @description Loads any tilesets not already cached (HMR path); resolves when done or immediately if all cached.
 * @param   scene     Its loader/texture cache.
 * @param   tilesets  Candidate defs.
 * @returns a Promise that resolves once the uncached tilesets finish loading (immediately if none), rejecting with a path-hint message on a load error.
 * @calledby src/scenes/GameScene.ts → HMR reload path, when a live world rebuild may reference new tilesets
 * @calls    the rel-path-to-URL mapper, the scene's spritesheet loader, and its complete/loaderror events
 */
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

import type {
  LdtkAutoLayerTile,
  LdtkEntityDef,
  LdtkEntityInstance,
  LdtkFieldInstance,
  LdtkLayerType,
  LdtkLevel,
  LdtkPointValue,
  LdtkProject,
  LdtkTilesetDef,
  LoiterPathPoint,
} from './types';

/**
 * @file ldtk/parseLdtk.ts
 * @description Stateless query layer turning a parsed LdtkProject into the game's level model (parse/validate JSON, look up a level by name, index tileset/entity defs, project layers into render-ready tile/decoration/IntGrid structs plus a spawnable-entity list); three load-bearing conventions live here — LDtk stores layers front-most-first so render order is the reversed array with back-to-front depth over the original indices; decoration alpha composites the entity-def tileOpacity onto the layer __opacity; getEntities enriches each instance in place with a world-px loiterPath and its source __levelId (neither native to LDtk).
 * @module ldtk
 */

/**
 * @function    parseLdtkProject
 * @description Parses the raw LDtk JSON and sanity-checks that a levels array is present, so a malformed or wrong-shaped file fails loudly here rather than crashing deep in the renderer.
 * @param   rawJson  The LDtk project file as a string.
 * @returns the parsed LdtkProject; throws a tagged Error on bad JSON or a missing "levels" array.
 * @calledby src/scenes/PreloadScene.ts, src/scenes/GameScene.ts → level load at startup and dev-server .ldtk hot-reload
 * @calls    JSON.parse, then a structural guard that rejects a missing levels array
 */
export function parseLdtkProject(rawJson: string): LdtkProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`Invalid LDtk JSON: ${message}`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as LdtkProject).levels)) {
    throw new Error('LDtk project missing "levels" array');
  }
  return parsed as LdtkProject;
}

/**
 * @function    getLevel
 * @description Finds a level by its LDtk identifier; throws with the available names on a miss so a level-id typo is obvious.
 * @param   project     Parsed LdtkProject.
 * @param   identifier  Level name, e.g. "Level_5".
 * @returns the matching LdtkLevel; throws an Error naming the available levels on a miss.
 * @calledby src/scenes/GameScene.ts → world build / tileset preload resolving the level to render
 * @calls    a linear search over project.levels; builds the available-names list on failure
 */
export function getLevel(project: LdtkProject, identifier: string): LdtkLevel {
  const level = project.levels.find((candidate) => candidate.identifier === identifier);
  if (!level) {
    const available = project.levels.map((l) => l.identifier).join(', ') || '<none>';
    throw new Error(`Level "${identifier}" not found in LDtk project. Available: ${available}`);
  }
  return level;
}

/** Tileset definitions keyed by uid (matches a layer's __tilesetDefUid). */
export function getTilesetDefs(project: LdtkProject): Map<number, LdtkTilesetDef> {
  const map = new Map<number, LdtkTilesetDef>();
  for (const ts of project.defs.tilesets) {
    map.set(ts.uid, ts);
  }
  return map;
}

/** Entity definitions keyed by uid (matches an instance's defUid); resolves per-entity render props (e.g. tileOpacity) that live on the def, not the instance. */
export function getEntityDefs(project: LdtkProject): Map<number, LdtkEntityDef> {
  const map = new Map<number, LdtkEntityDef>();
  for (const def of project.defs.entities) {
    map.set(def.uid, def);
  }
  return map;
}

export interface RenderableTileLayer {
  identifier: string;
  type: Exclude<LdtkLayerType, 'Entities'>;
  cWid: number;
  cHei: number;
  gridSize: number;
  tilesetUid: number;
  tiles: ReadonlyArray<LdtkAutoLayerTile>;
  // Render depth derived from the layer's position in level.layerInstances.
  // LDtk stores layers front-most first; back-most-first depth (0 = back) is
  // computed across the *original* array (not the filtered renderable subset)
  // so layers stack at the positions LDtk authoring intended.
  depth: number;
}

/**
 * @function    getRenderableLayers
 * @description Projects a level's tile layers into back-to-front render structs, skipping Entities layers and any empty or tileset-less layer; depth is computed over the ORIGINAL layer index (LDtk stores front-most-first), then the result is reversed so the renderer draws back-to-front.
 * @param   level  The LdtkLevel whose layers to project.
 * @returns an array of RenderableTileLayer in back-to-front draw order.
 * @calledby src/level/LevelRenderer.ts, src/level/TilesetRegistry.ts → building a level's tile-layer draw lists
 * @calls    walks the layer instances pulling autoLayer/grid tiles and computing a back-to-front depth, then reverses the collected layers
 */
export function getRenderableLayers(level: LdtkLevel): RenderableTileLayer[] {
  const total = level.layerInstances.length;
  const layers: RenderableTileLayer[] = [];
  level.layerInstances.forEach((li, originalIndex) => {
    if (li.__type === 'Entities') return;
    const tiles = li.autoLayerTiles ?? li.gridTiles ?? [];
    if (tiles.length === 0) return;
    if (li.__tilesetDefUid == null) return;
    layers.push({
      identifier: li.__identifier,
      type: li.__type,
      cWid: li.__cWid,
      cHei: li.__cHei,
      gridSize: li.__gridSize,
      tilesetUid: li.__tilesetDefUid,
      tiles,
      depth: total - 1 - originalIndex,
    });
  });
  return layers.reverse();
}

// Decoration entities placed via LDtk's "entity with embedded tile" pattern:
// the entity carries a __tile reference (tilesetUid + src rect) and is meant
// to be drawn as a static image at its position. No game logic — purely
// visual. Common for parallax columns, props, signs, etc.
export interface RenderableEntityTile {
  // LDtk entity identifier (e.g. "Sign1"). Carried through so the renderer
  // can attach per-identifier behavior to specific decorations (e.g. flicker
  // tweens on neon signs) without re-querying the LDtk model.
  identifier: string;
  tilesetUid: number;
  // Source rect in tileset px (LDtk's __tile.x/y/w/h). Width and height can
  // be larger than the tileset's tileGridSize — these are arbitrary crops.
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  // Position of the entity's pivot point in level-local px (LDtk's px[]).
  // The renderer pairs this with the pivot fractions below to anchor the
  // tile correctly regardless of pivot configuration.
  px: number;
  py: number;
  pivotX: number;
  pivotY: number;
  // Entity bounding box in px (LDtk's instance.width/height). Required for
  // tileRenderMode=FitInside — the source tile is uniformly scaled into this
  // box, then anchored at the pivot relative to the box (not relative to the
  // tile's own size). Without this, decorations whose entity bounds differ
  // from their source tile size render at the wrong scale and position.
  entityW: number;
  entityH: number;
  // Final render opacity in [0,1]: the entity definition's tileOpacity times
  // the owning layer's __opacity, mirroring how LDtk composites the decoration
  // in its editor. Applied as the sprite's alpha by the renderer (falls back to
  // the layer opacity alone when no entity-def map is supplied).
  alpha: number;
  // Mirror of the entity def's "Can be out of level bounds" flag. The renderer
  // routes a true decoration into an unmasked container so it can bleed past
  // the level rect. Defaults to false when no entity-def map is supplied (the
  // tileset-collection pass), which is correct — that pass never renders.
  allowOutOfBounds: boolean;
}

export interface RenderableEntityLayer {
  identifier: string;
  decorations: ReadonlyArray<RenderableEntityTile>;
  depth: number;
}

/**
 * @function    getRenderableEntityLayers
 * @description Projects Entities-type layers into back-to-front decoration draw lists, keeping only instances that carry an embedded __tile and aren't in the skip-set; each decoration's alpha composites its entity-def tileOpacity onto the layer __opacity (mirroring LDtk), and depth follows the same original-index reversed convention as the tile layers.
 * @param   level            The LdtkLevel.
 * @param   skipIdentifiers  Optional set of entity ids to omit — e.g. ones spawned as live entities instead of decorations.
 * @param   entityDefs       Optional uid→def map; when absent, tileOpacity defaults to 1 and out-of-bounds to false (the tileset-collection pass).
 * @returns an array of RenderableEntityLayer in back-to-front draw order.
 * @calledby src/level/LevelRenderer.ts, src/level/TilesetRegistry.ts → building decoration draw lists and the tileset-collection pass
 * @calls    walks each Entities layer's instances, resolving the entity def for the opacity composite and out-of-bounds flag, then reverses the layers
 */
export function getRenderableEntityLayers(
  level: LdtkLevel,
  skipIdentifiers?: ReadonlySet<string>,
  entityDefs?: ReadonlyMap<number, LdtkEntityDef>,
): RenderableEntityLayer[] {
  const total = level.layerInstances.length;
  const layers: RenderableEntityLayer[] = [];
  level.layerInstances.forEach((li, originalIndex) => {
    if (li.__type !== 'Entities') return;
    if (!li.entityInstances || li.entityInstances.length === 0) return;
    // Composite each decoration's own tileOpacity onto the layer opacity, the
    // way LDtk renders it. entityDefs is optional (the tileset-collection pass
    // doesn't need opacity), so tileOpacity falls back to 1 when it's absent.
    const layerOpacity = li.__opacity;
    const decorations: RenderableEntityTile[] = [];
    for (const inst of li.entityInstances) {
      if (!inst.__tile) continue;
      if (skipIdentifiers?.has(inst.__identifier)) continue;
      // Resolve the def once for both the opacity composite and the
      // out-of-bounds flag. ?? defaults cover a missing def map (tileset pass)
      // or an older LDtk file authored before the field existed.
      const def = entityDefs?.get(inst.defUid);
      const tileOpacity = def?.tileOpacity ?? 1;
      const allowOutOfBounds = def?.allowOutOfBounds ?? false;
      decorations.push({
        identifier: inst.__identifier,
        tilesetUid: inst.__tile.tilesetUid,
        srcX: inst.__tile.x,
        srcY: inst.__tile.y,
        srcW: inst.__tile.w,
        srcH: inst.__tile.h,
        px: inst.px[0],
        py: inst.px[1],
        pivotX: inst.__pivot[0],
        pivotY: inst.__pivot[1],
        entityW: inst.width,
        entityH: inst.height,
        alpha: layerOpacity * tileOpacity,
        allowOutOfBounds,
      });
    }
    if (decorations.length === 0) return;
    layers.push({
      identifier: li.__identifier,
      decorations,
      depth: total - 1 - originalIndex,
    });
  });
  return layers.reverse();
}

export interface IntGridData {
  cWid: number;
  cHei: number;
  gridSize: number;
  csv: ReadonlyArray<number>;
}

/**
 * @function    getIntGrid
 * @description Returns the level's first IntGrid layer as a flat CSV grid — the collision/metadata source the physics and nav layers read — or null when the level has no IntGrid layer (or it carries no CSV).
 * @param   level  The LdtkLevel to scan.
 * @returns an IntGridData (cell dims, grid size, row-major CSV), or null.
 * @calledby src/scenes/GameScene.ts → collision/navigation build deriving the solid grid for a level
 * @calls    finds the first IntGrid layer instance; no further delegation
 */
export function getIntGrid(level: LdtkLevel): IntGridData | null {
  const li = level.layerInstances.find((l) => l.__type === 'IntGrid');
  if (!li || !li.intGridCsv) return null;
  return {
    cWid: li.__cWid,
    cHei: li.__cHei,
    gridSize: li.__gridSize,
    csv: li.intGridCsv,
  };
}

/**
 * @function    getEntities
 * @description Flattens all entity instances across a level's layers into one list, enriching each in place with a world-px loiterPath (resolved from its "loiterPath" field) and its source __levelId — neither native to LDtk — so downstream spawning code needn't re-derive level offsets or track which level a flattened instance came from.
 * @param   level  The LdtkLevel whose entities to gather.
 * @returns the array of LdtkEntityInstance, each mutated with loiterPath and __levelId.
 * @calledby src/scenes/GameScene.ts → entity factory/spawner populating a built level with entities
 * @calls    resolves each instance's loiter path via the local path resolver and stamps the level identifier
 */
export function getEntities(level: LdtkLevel): LdtkEntityInstance[] {
  const out: LdtkEntityInstance[] = [];
  for (const li of level.layerInstances) {
    if (!li.entityInstances) continue;
    for (const inst of li.entityInstances) {
      // Resolve the optional "loiterPath" Point-Array field to world-space px
      // here so downstream code (EntityFactory, Enemy) doesn't need access to
      // the owning level/layer to convert cell coords. Cell coords sit on the
      // entity's own layer, so the layer's gridSize is the right divisor.
      inst.loiterPath = resolveLoiterPath(inst, level, li.__gridSize);
      // Stamp the source level identifier so EntityFactory can tell which level
      // a flattened instance came from (the instances are merged across all
      // levels before spawning). Used to mark key-locked doors by level.
      inst.__levelId = level.identifier;
      out.push(inst);
    }
  }
  return out;
}

/**
 * @function    resolveLoiterPath
 * @description Converts an entity's optional "loiterPath" Point-Array field into world-px patrol waypoints, anchoring each at the clicked cell's center (matching LDtk's editor) and shifting by the level's worldX/Y; bails to null on any non-array shape so a misconfigured field disables the patrol rather than crashing.
 * @param   instance  The LdtkEntityInstance.
 * @param   level     Its owning LdtkLevel, for the world offset.
 * @param   gridSize  The layer's cell size in px (the divisor).
 * @returns a world-px LoiterPathPoint array, or null when the field is absent, wrong-typed, or empty.
 * @calledby src/ldtk/parseLdtk.ts → getEntities, while enriching each instance with its path
 * @calls    finds and type-checks the loiterPath field, then maps cell coords to world px
 */
function resolveLoiterPath(
  instance: LdtkEntityInstance,
  level: LdtkLevel,
  gridSize: number,
): ReadonlyArray<LoiterPathPoint> | null {
  const fields = instance.fieldInstances;
  if (!fields || fields.length === 0) return null;
  const field = fields.find(
    (f): f is LdtkFieldInstance =>
      typeof f === 'object' &&
      f !== null &&
      (f as LdtkFieldInstance).__identifier === 'loiterPath',
  );
  if (!field) return null;
  // LDtk's __type for an array-of-Point field is the literal "Array<Point>".
  // Bail on any other shape so a misconfigured field (e.g. single Point or
  // Int) doesn't crash — it just disables the patrol.
  if (field.__type !== 'Array<Point>') return null;
  const raw = field.__value;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const points: LoiterPathPoint[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue;
    const p = item as Partial<LdtkPointValue>;
    if (typeof p.cx !== 'number' || typeof p.cy !== 'number') continue;
    // Cell-center anchoring: places the waypoint at the middle of the cell
    // the user clicked, which matches what the LDtk editor visually renders.
    // worldX/worldY on the level shifts level-local coords into the world
    // frame the renderer uses.
    points.push({
      x: level.worldX + (p.cx + 0.5) * gridSize,
      y: level.worldY + (p.cy + 0.5) * gridSize,
    });
  }
  if (points.length === 0) return null;
  return points;
}

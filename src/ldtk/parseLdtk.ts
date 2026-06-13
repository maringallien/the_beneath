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
 * parseLdtk — turns a raw LDtk project into the game's level model.
 *
 * Stateless query functions over a parsed LdtkProject: validate/parse the JSON,
 * look up a level by name, index the tileset/entity definitions, and project
 * each level's layers into render-ready view structs (tile layers, decoration-
 * entity layers, IntGrid) plus its spawnable entity list. Three load-bearing
 * conventions live here: LDtk stores layers front-most-first so render order is
 * the *reversed* array with a back-to-front depth computed over the original
 * indices; decoration alpha is the entity-def tileOpacity composited onto the
 * layer __opacity; and getEntities enriches each instance in place with a
 * world-px loiterPath and its source __levelId (neither native to LDtk).
 *
 * Inputs:  a raw LDtk JSON string, then the parsed LdtkProject / LdtkLevel; an
 *          optional skip-set and entity-def map for the decoration pass.
 * Outputs: the parsed project, lookup maps, render-view arrays, and the
 *          per-level entity list (mutated with loiterPath / __levelId).
 * @calledby the level-loading and rendering pipeline, when a level is built.
 * @calls    only JSON.parse and the LDtk type accessors — no engine or I/O.
 */

// parses the raw LDtk JSON and sanity-checks that a levels array is present
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

// finds a level by name, throwing with the full available list if it's missing
export function getLevel(project: LdtkProject, identifier: string): LdtkLevel {
  const level = project.levels.find((candidate) => candidate.identifier === identifier);
  if (!level) {
    const available = project.levels.map((l) => l.identifier).join(', ') || '<none>';
    throw new Error(`Level "${identifier}" not found in LDtk project. Available: ${available}`);
  }
  return level;
}

// Tileset definitions keyed by uid (matches a layer's __tilesetDefUid).
export function getTilesetDefs(project: LdtkProject): Map<number, LdtkTilesetDef> {
  const map = new Map<number, LdtkTilesetDef>();
  for (const ts of project.defs.tilesets) {
    map.set(ts.uid, ts);
  }
  return map;
}

// Entity definitions keyed by uid (matches an instance's defUid). Used to
// resolve per-entity render properties — currently tileOpacity — that live on
// the definition rather than the instance.
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

// projects a level's tile layers into back-to-front render structs, skipping empty/tileset-less layers
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

// projects Entities-type layers into decoration draw lists (back-to-front); composites tileOpacity onto layer opacity
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

// The level's first IntGrid layer as a flat CSV grid (collision/metadata
// source), or null if the level has none.
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

// flattens all entity instances across a level's layers, stamping each with world-px loiterPath and __levelId
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

// converts the "loiterPath" Point-Array field to world-px waypoints; returns null when absent or empty
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

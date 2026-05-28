import type {
  LdtkAutoLayerTile,
  LdtkEntityInstance,
  LdtkFieldInstance,
  LdtkLayerType,
  LdtkLevel,
  LdtkPointValue,
  LdtkProject,
  LdtkTilesetDef,
  LoiterPathPoint,
} from './types';

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

export function getLevel(project: LdtkProject, identifier: string): LdtkLevel {
  const level = project.levels.find((candidate) => candidate.identifier === identifier);
  if (!level) {
    const available = project.levels.map((l) => l.identifier).join(', ') || '<none>';
    throw new Error(`Level "${identifier}" not found in LDtk project. Available: ${available}`);
  }
  return level;
}

export function getTilesetDefs(project: LdtkProject): Map<number, LdtkTilesetDef> {
  const map = new Map<number, LdtkTilesetDef>();
  for (const ts of project.defs.tilesets) {
    map.set(ts.uid, ts);
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

// LDtk stores layer instances top-to-bottom (front-most first). Returns them
// in render order (back-to-front) so callers iterate and depth-stack
// consistently. Entity-only layers and tile-empty layers are filtered out.
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
}

export interface RenderableEntityLayer {
  identifier: string;
  decorations: ReadonlyArray<RenderableEntityTile>;
  depth: number;
}

// Entities-type layers whose entity instances carry __tile references.
// Returned in render order (back-to-front), parallel to getRenderableLayers,
// so callers can render decorations using the same depth scheme as tile
// layers — preserving the LDtk-authored stacking between tile layers and
// entity-decoration layers.
//
// `skipIdentifiers` lets the caller suppress entities whose visual is owned
// by gameplay code (e.g. Player spawns) — LDtk includes a __tile preview on
// every entity def, so without this filter the live sprite would render
// alongside a frozen decoration of itself.
export function getRenderableEntityLayers(
  level: LdtkLevel,
  skipIdentifiers?: ReadonlySet<string>,
): RenderableEntityLayer[] {
  const total = level.layerInstances.length;
  const layers: RenderableEntityLayer[] = [];
  level.layerInstances.forEach((li, originalIndex) => {
    if (li.__type !== 'Entities') return;
    if (!li.entityInstances || li.entityInstances.length === 0) return;
    const decorations: RenderableEntityTile[] = [];
    for (const inst of li.entityInstances) {
      if (!inst.__tile) continue;
      if (skipIdentifiers?.has(inst.__identifier)) continue;
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
      out.push(inst);
    }
  }
  return out;
}

// Reads the "loiterPath" Point-Array field (if authored) and converts its
// cell coords to world-space px. Returns null when the field is absent,
// not an array, or empty — callers treat null as "no path, use default
// loiter behavior". Single-Point and non-array values are intentionally
// ignored: a one-waypoint path isn't a path, and silently falling back
// keeps the runtime tolerant of partial authoring.
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

/**
 * ldtk/types — the subset of LDtk's level-JSON schema the game reads.
 *
 * Plain structural interfaces mirroring LDtk's exported project/level/layer/
 * entity/tileset shapes — only the fields the parser and renderer consume, not
 * the full editor schema. LDtk's own field names are kept verbatim (the `__`-
 * prefixed ones are LDtk-computed; `px`/`src`/`f`/`t` are its terse tile keys)
 * so this maps 1:1 onto the raw JSON with no renaming. Three shapes are NOT
 * native LDtk and are stamped on by parseLdtk as a convenience for downstream
 * code: LoiterPathPoint, plus the loiterPath and __levelId enrichments on
 * LdtkEntityInstance (each marked below).
 *
 * Inputs:  none — type declarations only.
 * Outputs: the interfaces below, consumed by the parser and the level renderer.
 * @calledby the LDtk parsing layer and every consumer of the parsed level model.
 * @calls    nothing — a leaf type module.
 */

export type LdtkLayerType = 'Entities' | 'IntGrid' | 'AutoLayer' | 'Tiles';

export interface LdtkAutoLayerTile {
  // Pixel position of the tile's top-left within the layer.
  px: [number, number];
  // Pixel position of the source tile within the tileset image.
  src: [number, number];
  // Flip bits: 1 = horizontal, 2 = vertical, 3 = both.
  f: number;
  // Tile index within the tileset (row-major: gy * tilesetCols + gx).
  t: number;
  // LDtk debug/rule-source coords; unused by the game.
  d?: number[];
  // Per-tile alpha; unused by the game.
  a?: number;
}

// An entity's embedded tile preview (LDtk's __tile): which tileset and the
// source crop rect, used to render decoration entities as static images.
export interface LdtkEntityTileRef {
  tilesetUid: number;
  // Source crop in tileset px (top-left x/y, width/height — arbitrary, may
  // exceed the tile grid size).
  x: number;
  y: number;
  w: number;
  h: number;
}

// LDtk stores Point field values as level-local cell coordinates. A single
// Point becomes one of these; a Point Array becomes an array of these.
export interface LdtkPointValue {
  cx: number;
  cy: number;
}

// Subset of LDtk's FieldInstance schema we actually read. __type is the LDtk
// type string (e.g. "Point", "Array<Point>", "Int", "String") and __value is
// the deserialized JS value. We narrow on __type at parse time.
export interface LdtkFieldInstance {
  __identifier: string;
  __type: string;
  __value: unknown;
  // UID of the field definition this instance came from; unused by the game.
  defUid?: number;
}

// Resolved waypoint in world-space pixels. Derived by parseLdtk from a Point
// Array field named "loiterPath" — kept off the raw LDtk schema so consumers
// (Enemy, EntityFactory) get world-px coordinates without re-resolving the
// level offset themselves.
export interface LoiterPathPoint {
  x: number;
  y: number;
}

export interface LdtkEntityInstance {
  // LDtk entity identifier (the def name, e.g. "Door_spawn", "Ghoul").
  __identifier: string;
  // Grid cell [cx, cy] of the entity on its layer.
  __grid: [number, number];
  // Pivot fractions [0..1] within the entity's bounds.
  __pivot: [number, number];
  // Entity-def tags (LDtk "Tags"); unused by the game.
  __tags?: string[];
  // Embedded tile preview, present when the entity carries a __tile.
  __tile?: LdtkEntityTileRef;
  // Level-local pixel position [x, y] of the pivot.
  px: [number, number];
  width: number;
  height: number;
  // Globally-unique instance id.
  iid: string;
  // UID of the entity definition (matches LdtkEntityDef.uid).
  defUid: number;
  // World-space px (LDtk-computed); unused — the game derives world coords itself.
  __worldX?: number;
  __worldY?: number;
  // Custom field values authored on this instance (read for "loiterPath").
  fieldInstances?: ReadonlyArray<LdtkFieldInstance>;
  // Enrichment (not native LDtk): world-px patrol path from the "loiterPath"
  // Point-Array field, or null when absent/empty. Resolved by getEntities so
  // consumers needn't re-derive it from the level worldX/Y/gridSize.
  loiterPath?: ReadonlyArray<LoiterPathPoint> | null;
  // Enrichment (not native LDtk): source level identifier (e.g. "Level_6").
  // Stamped by getEntities because instances are flattened across all levels
  // before spawning, so this is how a Door's level is known (to mark the
  // Level_6 / Level_12 doors key-locked via LOCKED_DOOR_KEYS).
  __levelId?: string;
}

export interface LdtkLayerInstance {
  // Layer name (e.g. "Entities", "Collision", "Background").
  __identifier: string;
  // Which of the four LDtk layer kinds this is.
  __type: LdtkLayerType;
  // Layer size in cells (width, height).
  __cWid: number;
  __cHei: number;
  // Cell size in px.
  __gridSize: number;
  // Layer opacity in [0,1] (LDtk's per-layer-instance "__opacity"). Decoration
  // entities on this layer composite their own tileOpacity on top of it.
  __opacity: number;
  // Tileset UID backing this layer's tiles, or null (e.g. Entities layers).
  __tilesetDefUid: number | null;
  // Globally-unique layer-instance id.
  iid: string;
  // UID of the owning level.
  levelId: number;
  // UID of the layer definition.
  layerDefUid: number;
  // Entities placed on this layer (Entities-type layers only).
  entityInstances?: LdtkEntityInstance[];
  // Filled by AutoLayer and IntGrid layers (post auto-rule evaluation).
  autoLayerTiles?: LdtkAutoLayerTile[];
  // Filled by manual Tiles layers.
  gridTiles?: LdtkAutoLayerTile[];
  // IntGrid CSV: row-major, 0 = empty, non-zero = a defined IntGrid value.
  intGridCsv?: number[];
}

export interface LdtkLevel {
  uid: number;
  // Level name (e.g. "Level_6") — the game's stable per-level key.
  identifier: string;
  iid: string;
  // Level size in px.
  pxWid: number;
  pxHei: number;
  // Top-left of the level in the world frame; added to level-local coords to
  // place tiles/entities/waypoints in world space.
  worldX: number;
  worldY: number;
  // Layers, stored front-most first (see getRenderableLayers for the flip).
  layerInstances: LdtkLayerInstance[];
}

// A tileset definition: the source image and its grid geometry, keyed by uid
// (a tile layer's __tilesetDefUid / an entity tile's tilesetUid points here).
export interface LdtkTilesetDef {
  uid: number;
  identifier: string;
  // Path to the tileset image, relative to the project file; null if embedded.
  relPath: string | null;
  // Tileset image size in px.
  pxWid: number;
  pxHei: number;
  // One tile's size in px.
  tileGridSize: number;
  // Outer margin and inter-tile gap in the image, for src-rect math.
  padding: number;
  spacing: number;
}

// Subset of an LDtk entity definition. tileOpacity is the per-entity render
// opacity authored in the editor (Entity settings → "Tile opacity"); the game
// applies it as the decoration sprite's alpha so rendering matches LDtk.
export interface LdtkEntityDef {
  // Definition UID (matches an instance's defUid).
  uid: number;
  // Definition name (e.g. "Sign1").
  identifier: string;
  tileOpacity: number;
  // LDtk's per-entity "Can be out of level bounds" setting. When true, the
  // renderer exempts this entity's decoration from the per-level mask so its
  // overhang spills past the level rect and bleeds into the adjacent level
  // (matching how LDtk's editor draws it) instead of being clipped at the edge.
  allowOutOfBounds: boolean;
}

// Project-wide definition tables (the "defs" section), shared across all levels.
export interface LdtkProjectDefs {
  tilesets: LdtkTilesetDef[];
  entities: LdtkEntityDef[];
}

// Root of a parsed LDtk project file.
export interface LdtkProject {
  // LDtk file-format version string.
  jsonVersion: string;
  // Globally-unique project id.
  iid: string;
  levels: LdtkLevel[];
  defs: LdtkProjectDefs;
}

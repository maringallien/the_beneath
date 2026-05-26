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
  d?: number[];
  a?: number;
}

export interface LdtkEntityTileRef {
  tilesetUid: number;
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
  __identifier: string;
  __grid: [number, number];
  __pivot: [number, number];
  __tags?: string[];
  __tile?: LdtkEntityTileRef;
  px: [number, number];
  width: number;
  height: number;
  iid: string;
  defUid: number;
  __worldX?: number;
  __worldY?: number;
  fieldInstances?: ReadonlyArray<LdtkFieldInstance>;
  // Populated by parseLdtk.getEntities — world-space px points from the
  // entity's "loiterPath" Point-Array field, or null if the field is absent
  // / empty. Not part of LDtk's native schema; this is an internal
  // enrichment so downstream code doesn't need the level worldX/Y/gridSize.
  loiterPath?: ReadonlyArray<LoiterPathPoint> | null;
}

export interface LdtkLayerInstance {
  __identifier: string;
  __type: LdtkLayerType;
  __cWid: number;
  __cHei: number;
  __gridSize: number;
  __tilesetDefUid: number | null;
  iid: string;
  levelId: number;
  layerDefUid: number;
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
  identifier: string;
  iid: string;
  pxWid: number;
  pxHei: number;
  worldX: number;
  worldY: number;
  layerInstances: LdtkLayerInstance[];
}

export interface LdtkTilesetDef {
  uid: number;
  identifier: string;
  relPath: string | null;
  pxWid: number;
  pxHei: number;
  tileGridSize: number;
  padding: number;
  spacing: number;
}

export interface LdtkProjectDefs {
  tilesets: LdtkTilesetDef[];
}

export interface LdtkProject {
  jsonVersion: string;
  iid: string;
  levels: LdtkLevel[];
  defs: LdtkProjectDefs;
}

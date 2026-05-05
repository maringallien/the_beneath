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
  fieldInstances?: ReadonlyArray<unknown>;
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

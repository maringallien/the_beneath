export type LdtkLayerType = 'Entities' | 'IntGrid' | 'AutoLayer' | 'Tiles';

export interface LdtkEntityInstance {
  __identifier: string;
  __grid: [number, number];
  __pivot: [number, number];
  px: [number, number];
  width: number;
  height: number;
  iid: string;
  defUid: number;
  __worldX?: number;
  __worldY?: number;
}

export interface LdtkLayerInstance {
  __identifier: string;
  __type: LdtkLayerType;
  iid: string;
  levelId: number;
  layerDefUid: number;
  entityInstances?: LdtkEntityInstance[];
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

export interface LdtkProject {
  jsonVersion: string;
  iid: string;
  levels: LdtkLevel[];
}

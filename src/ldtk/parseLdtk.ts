import type {
  LdtkAutoLayerTile,
  LdtkEntityInstance,
  LdtkLayerType,
  LdtkLevel,
  LdtkProject,
  LdtkTilesetDef,
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
}

// LDtk stores layer instances top-to-bottom (front-most first). Returns them
// in render order (back-to-front) so callers iterate and depth-stack
// consistently. Entity-only layers and tile-empty layers are filtered out.
export function getRenderableLayers(level: LdtkLevel): RenderableTileLayer[] {
  const layers: RenderableTileLayer[] = [];
  for (const li of level.layerInstances) {
    if (li.__type === 'Entities') continue;
    const tiles = li.autoLayerTiles ?? li.gridTiles ?? [];
    if (tiles.length === 0) continue;
    if (li.__tilesetDefUid == null) continue;
    layers.push({
      identifier: li.__identifier,
      type: li.__type,
      cWid: li.__cWid,
      cHei: li.__cHei,
      gridSize: li.__gridSize,
      tilesetUid: li.__tilesetDefUid,
      tiles,
    });
  }
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
    out.push(...li.entityInstances);
  }
  return out;
}

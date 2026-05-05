import type { LdtkEntityInstance, LdtkLevel, LdtkProject } from './types';

export const PLAYER_SPAWN_ENTITY = 'PlayerSpawn';

export interface SpawnPoint {
  x: number;
  y: number;
}

export interface ParsedLevel {
  id: string;
  widthPx: number;
  heightPx: number;
  playerSpawn: SpawnPoint;
}

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

export function findSpawn(level: LdtkLevel, entityIdentifier: string): SpawnPoint {
  const matches: LdtkEntityInstance[] = [];
  for (const layer of level.layerInstances) {
    if (layer.__type !== 'Entities' || !layer.entityInstances) {
      continue;
    }
    for (const entity of layer.entityInstances) {
      if (entity.__identifier === entityIdentifier) {
        matches.push(entity);
      }
    }
  }
  if (matches.length === 0) {
    throw new Error(`Entity "${entityIdentifier}" not found in level "${level.identifier}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Expected exactly one "${entityIdentifier}" in level "${level.identifier}", found ${matches.length}`,
    );
  }
  const [entity] = matches;
  const [x, y] = entity.px;
  return { x, y };
}

export function parseLevel(
  rawJson: string,
  levelIdentifier: string,
  spawnEntityIdentifier: string = PLAYER_SPAWN_ENTITY,
): ParsedLevel {
  const project = parseLdtkProject(rawJson);
  const level = getLevel(project, levelIdentifier);
  const playerSpawn = findSpawn(level, spawnEntityIdentifier);
  return {
    id: level.identifier,
    widthPx: level.pxWid,
    heightPx: level.pxHei,
    playerSpawn,
  };
}

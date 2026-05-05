import Phaser from 'phaser';
import type { LdtkEntityInstance } from '../ldtk/types';
import { Player } from './Player';

export type EntityFactoryFn = (
  scene: Phaser.Scene,
  instance: LdtkEntityInstance,
) => Phaser.GameObjects.GameObject;

// Single source of truth for "LDtk entity identifier → in-game spawn".
// Adding a new entity type means registering one entry here; no other file
// in the entity pipeline needs to change.
const FACTORIES: Readonly<Record<string, EntityFactoryFn>> = {
  Sword_master_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new Player(scene, x, y);
  },
};

export interface SpawnedEntities {
  player: Player | null;
  others: ReadonlyArray<Phaser.GameObjects.GameObject>;
}

export function spawnEntities(
  scene: Phaser.Scene,
  instances: ReadonlyArray<LdtkEntityInstance>,
): SpawnedEntities {
  let player: Player | null = null;
  const others: Phaser.GameObjects.GameObject[] = [];
  const unhandled = new Set<string>();

  for (const instance of instances) {
    const factory = FACTORIES[instance.__identifier];
    if (!factory) {
      unhandled.add(instance.__identifier);
      continue;
    }
    const obj = factory(scene, instance);
    if (obj instanceof Player) {
      if (player) {
        throw new Error(
          `Multiple Player spawns from entity "${instance.__identifier}" — expected exactly one`,
        );
      }
      player = obj;
    } else {
      others.push(obj);
    }
  }

  if (unhandled.size > 0) {
    // Once-per-load summary keeps logs tidy as more LDtk entities exist than
    // are wired up in code. Per-entity factories should be added incrementally.
    console.warn(
      `[EntityFactory] No factory registered for: ${[...unhandled].sort().join(', ')}`,
    );
  }

  return { player, others };
}

// Translate an LDtk entity instance position (anchored at its def's pivot)
// into the center of its bounding box. LDtk's `px` is computed as
// (boxTopLeft + pivot * size); reverse it so spawned sprites land at the
// box center regardless of pivot configuration.
function pivotCenter(e: LdtkEntityInstance): { x: number; y: number } {
  return {
    x: e.px[0] + (0.5 - e.__pivot[0]) * e.width,
    y: e.px[1] + (0.5 - e.__pivot[1]) * e.height,
  };
}

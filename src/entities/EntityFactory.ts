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
      // Decoration entities (LDtk entity-with-embedded-__tile pattern) are
      // rendered by LevelRenderer and intentionally have no factory here.
      // Skip silently so they don't pollute the "unhandled" warning, which
      // is reserved for genuinely-missing game-entity factories.
      if (instance.__tile) continue;
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

// Symmetric teardown for spawnEntities. Optionally preserves the player so
// callers (e.g. HMR reloads) can keep the existing Player instance and just
// re-attach colliders to a freshly-built world. Player has its own DESTROY
// listener that detaches input handlers, so destroying it here is safe.
export function destroyEntities(
  spawned: SpawnedEntities,
  options: { preservePlayer?: boolean } = {},
): void {
  for (const obj of spawned.others) {
    obj.destroy();
  }
  if (!options.preservePlayer && spawned.player) {
    spawned.player.destroy();
  }
}

// Translate an LDtk entity instance position (anchored at its def's pivot)
// into the center of its bounding box, in world coordinates. LDtk's `px` is
// computed as (boxTopLeft + pivot * size); reverse it so spawned sprites land
// at the box center regardless of pivot configuration. Prefer `__worldX/Y`
// (set by LDtk for Free world layouts) so entities from any level land in the
// same coordinate space the renderer uses.
function pivotCenter(e: LdtkEntityInstance): { x: number; y: number } {
  const baseX = e.__worldX ?? e.px[0];
  const baseY = e.__worldY ?? e.px[1];
  return {
    x: baseX + (0.5 - e.__pivot[0]) * e.width,
    y: baseY + (0.5 - e.__pivot[1]) * e.height,
  };
}

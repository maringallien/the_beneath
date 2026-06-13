import Phaser from 'phaser';
import { LOCKED_DOOR_KEYS } from '../constants';
import type { LdtkEntityInstance, LoiterPathPoint } from '../ldtk/types';
import { AnimatedEntity } from './AnimatedEntity';
import { Chest } from './Chest';
import { Door } from './Door';
import { Enemy, type EnemySpawnOverrides } from './Enemy';
import { getEntityRegistryEntry, listEntityRegistryEntries } from './entityRegistryLoader';
import type { AnimatedEntityConfig } from './entityRegistryTypes';
import { MushroomMerchant } from './MushroomMerchant';
import { Player } from './Player';
import { Portal } from './Portal';
import { Save } from './Save';
import { TechShop } from './TechShop';
import { Trap } from './Trap';

/**
 * EntityFactory — turns LDtk entity instances into live game objects.
 *
 * The FACTORIES table is the single source of truth for "LDtk identifier →
 * spawn": hand-written SPECIAL_FACTORIES for gameplay entities (player, doors,
 * chests, saves, merchants, portal) merged with an auto-generated AnimatedEntity
 * factory for every registry identifier (behavior → Enemy, trap → Trap, neither
 * → static decoration). On collision a special factory wins. spawnEntities walks
 * a level's instances and sorts the results into pre-typed lists so GameScene
 * wires colliders/interactions once at build time without per-frame instanceof;
 * destroyEntities is its symmetric teardown. Two placement helpers
 * (pivotCenter / floorAlignedSpawnPosition) reconcile LDtk's pivot-anchored
 * coordinates with Phaser's centered sprite origin so spawns land where the
 * editor shows them.
 *
 * Inputs:  LDtk entity instances (pivot, size, world coords, level id, loiter
 *          path) and the entity registry (animation/physics/behavior config).
 * Outputs: constructed game objects sorted into SpawnedEntities; a DYNAMIC_
 *          ENTITY_IDENTIFIERS set; a single rebuilt Enemy from respawnEnemyAt.
 * @calledby world build at level load, HMR/world teardown, and enemy respawn.
 * @calls    the entity constructors and the registry lookup/listing helpers.
 */
export type EntityFactoryFn = (
  scene: Phaser.Scene,
  instance: LdtkEntityInstance,
) => Phaser.GameObjects.GameObject;

// hand-written factories for entities whose spawn behavior needs gameplay code (not just registry config)
const SPECIAL_FACTORIES: Readonly<Record<string, EntityFactoryFn>> = {
  Sword_master_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new Player(scene, x, y);
  },
  // key-locked when the level appears in LOCKED_DOOR_KEYS; plain proximity door otherwise
  Door_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    const requiredKey = instance.__levelId
      ? LOCKED_DOOR_KEYS[instance.__levelId] ?? null
      : null;
    return new Door(scene, x, y, requiredKey);
  },
  // Save drives a multi-state machine that a plain AnimatedEntity can't express
  Save_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new Save(scene, x, y);
  },
  // Chests freeze on frame 0; play() runs the one-shot open animation on interact
  Chest1_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new Chest(scene, x, y, 'Chest1_spawn', instance.iid);
  },
  Chest2_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new Chest(scene, x, y, 'Chest2_spawn', instance.iid);
  },
  // gravity:false, so uses floorAlignedSpawnPosition to match the pivotY=1 LDtk placement
  Tech_shop_spawn: (scene, instance) => {
    const config = getEntityRegistryEntry('Tech_shop_spawn');
    const { x, y } = config
      ? floorAlignedSpawnPosition(instance, config)
      : pivotCenter(instance);
    return new TechShop(scene, x, y);
  },
  Mushroom_merchant_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new MushroomMerchant(scene, x, y);
  },
  // gravity:false victory exit; floorAlignedSpawnPosition honors the LDtk pivot
  Portal_spawn: (scene, instance) => {
    const config = getEntityRegistryEntry('Portal_spawn');
    const { x, y } = config
      ? floorAlignedSpawnPosition(instance, config)
      : pivotCenter(instance);
    return new Portal(scene, x, y);
  },
};

// SPECIAL_FACTORIES merged with auto-generated AnimatedEntity factories for every registry identifier;
// special wins on collision — intentional for entities like Door that need hand-written spawn logic
const FACTORIES: Readonly<Record<string, EntityFactoryFn>> = (() => {
  const out: Record<string, EntityFactoryFn> = { ...SPECIAL_FACTORIES };
  for (const { identifier, config } of listEntityRegistryEntries()) {
    if (identifier in out) continue;
    // behavior → Enemy, trap → Trap, neither → static decoration
    if (config.behavior) {
      out[identifier] = (scene, instance) => {
        const { x, y } = floorAlignedSpawnPosition(instance, config);
        return new Enemy(
          scene,
          x,
          y,
          identifier,
          instance.iid,
          instance.loiterPath ?? null,
        );
      };
    } else if (config.trap) {
      out[identifier] = (scene, instance) => {
        const { x, y } = floorAlignedSpawnPosition(instance, config);
        return new Trap(scene, x, y, identifier);
      };
    } else {
      out[identifier] = (scene, instance) => {
        const { x, y } = floorAlignedSpawnPosition(instance, config);
        return new AnimatedEntity(scene, x, y, identifier);
      };
    }
  }
  return out;
})();

// suppresses LDtk's static __tile preview for identifiers handled by this factory
export const DYNAMIC_ENTITY_IDENTIFIERS: ReadonlySet<string> = new Set(
  Object.keys(FACTORIES),
);

export interface SpawnedEntities {
  player: Player | null;
  enemies: ReadonlyArray<Enemy>;
  doors: ReadonlyArray<Door>;
  traps: ReadonlyArray<Trap>;
  chests: ReadonlyArray<Chest>;
  saves: ReadonlyArray<Save>;
  merchants: ReadonlyArray<TechShop | MushroomMerchant>;
  portals: ReadonlyArray<Portal>;
  // pure-decoration AnimatedEntities (ambient animals, lamps, etc.)
  others: ReadonlyArray<Phaser.GameObjects.GameObject>;
}

// spawn all level entities and sort them into the typed SpawnedEntities buckets
export function spawnEntities(
  scene: Phaser.Scene,
  instances: ReadonlyArray<LdtkEntityInstance>,
): SpawnedEntities {
  let player: Player | null = null;
  const enemies: Enemy[] = [];
  const doors: Door[] = [];
  const traps: Trap[] = [];
  const chests: Chest[] = [];
  const saves: Save[] = [];
  const merchants: Array<TechShop | MushroomMerchant> = [];
  const portals: Portal[] = [];
  const others: Phaser.GameObjects.GameObject[] = [];
  const unhandled = new Set<string>();

  for (const instance of instances) {
    const factory = FACTORIES[instance.__identifier];
    if (!factory) {
      // decoration entities rendered by LevelRenderer — skip silently
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
    } else if (obj instanceof Enemy) {
      enemies.push(obj);
    } else if (obj instanceof Door) {
      doors.push(obj);
    } else if (obj instanceof Trap) {
      traps.push(obj);
    } else if (obj instanceof Chest) {
      chests.push(obj);
    } else if (obj instanceof Save) {
      saves.push(obj);
    } else if (obj instanceof TechShop || obj instanceof MushroomMerchant) {
      merchants.push(obj);
    } else if (obj instanceof Portal) {
      portals.push(obj);
    } else {
      others.push(obj);
    }
  }

  if (unhandled.size > 0) {
    console.warn(
      `[EntityFactory] No factory registered for: ${[...unhandled].sort().join(', ')}`,
    );
  }

  return {
    player,
    enemies,
    doors,
    traps,
    chests,
    saves,
    merchants,
    portals,
    others,
  };
}

// destroy every spawned object; preservePlayer keeps the Player instance across HMR/world rebuilds
export function destroyEntities(
  spawned: SpawnedEntities,
  options: { preservePlayer?: boolean } = {},
): void {
  for (const enemy of spawned.enemies) {
    enemy.destroy();
  }
  for (const door of spawned.doors) {
    door.destroy();
  }
  for (const trap of spawned.traps) {
    trap.destroy();
  }
  for (const chest of spawned.chests) {
    chest.destroy();
  }
  for (const save of spawned.saves) {
    save.destroy();
  }
  for (const merchant of spawned.merchants) {
    merchant.destroy();
  }
  for (const portal of spawned.portals) {
    portal.destroy();
  }
  for (const obj of spawned.others) {
    obj.destroy();
  }
  if (!options.preservePlayer && spawned.player) {
    spawned.player.destroy();
  }
}

// convert LDtk pivot-anchored position to the bounding-box center in world coordinates
export function pivotCenter(e: LdtkEntityInstance): { x: number; y: number } {
  const baseX = e.__worldX ?? e.px[0];
  const baseY = e.__worldY ?? e.px[1];
  return {
    x: baseX + (0.5 - e.__pivot[0]) * e.width,
    y: baseY + (0.5 - e.__pivot[1]) * e.height,
  };
}

// like pivotCenter but aligns the sprite edge matching the LDtk pivot, so floor/wall/ceiling
// anchored entities land exactly where the editor shows them rather than floating or sinking
function floorAlignedSpawnPosition(
  instance: LdtkEntityInstance,
  config: AnimatedEntityConfig,
): { x: number; y: number } {
  const { x, y } = pivotCenter(instance);
  const defaultAnim = config.animations[config.defaultAnimation];
  if (!defaultAnim) return { x, y };
  const scale = defaultAnim.displayScale ?? 1;
  const frameWidth = defaultAnim.frameWidth * scale;
  const frameHeight = defaultAnim.frameHeight * scale;
  const pivotX = instance.__pivot[0];
  const pivotY = instance.__pivot[1];
  // 0 for centered pivot or same-width box/frame; non-zero shifts the edge into alignment
  const correctionX = (pivotX - 0.5) * (instance.width - frameWidth);
  let correctionY = 0;
  if (defaultAnim.spawnAnchorY !== undefined) {
    // land the spawnAnchorY frame row on the LDtk pivot Y (for oversized frames like heart hoarder)
    const spawnAnchorY = defaultAnim.spawnAnchorY * scale;
    const pivotYWorld = instance.__worldY ?? instance.px[1];
    correctionY = pivotYWorld - y + frameHeight / 2 - spawnAnchorY;
  } else if (pivotY === 1) {
    const anchorY = (defaultAnim.anchorY ?? defaultAnim.frameHeight) * scale;
    // shift down to the box bottom, then up so the anchor row lands at the box bottom
    correctionY = instance.height / 2 - (anchorY - frameHeight / 2);
  } else if (pivotY === 0) {
    // align the sprite's top edge with the LDtk box top (e.g. ceiling-mounted hive)
    correctionY = (frameHeight - instance.height) / 2;
  }
  return { x: x + correctionX, y: y + correctionY };
}

// rebuild a single Enemy at the given (already floor-aligned) coords; null if the identifier lost its behavior
export function respawnEnemyAt(
  scene: Phaser.Scene,
  identifier: string,
  x: number,
  y: number,
  iid: string,
  loiterPath: ReadonlyArray<LoiterPathPoint> | null,
  spawnOverrides: EnemySpawnOverrides | null = null,
): Enemy | null {
  const entry = getEntityRegistryEntry(identifier);
  if (!entry || !entry.behavior) return null;
  return new Enemy(scene, x, y, identifier, iid, loiterPath, spawnOverrides);
}

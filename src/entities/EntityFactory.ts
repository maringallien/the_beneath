import Phaser from 'phaser';
import type { LdtkEntityInstance } from '../ldtk/types';
import { AnimatedEntity } from './AnimatedEntity';
import { Door } from './Door';
import { Enemy } from './Enemy';
import { listEntityRegistryEntries } from './entityRegistryLoader';
import type { AnimatedEntityConfig } from './entityRegistryTypes';
import { Player } from './Player';
import { Save } from './Save';
import { Trap } from './Trap';

export type EntityFactoryFn = (
  scene: Phaser.Scene,
  instance: LdtkEntityInstance,
) => Phaser.GameObjects.GameObject;

// LDtk identifiers handled by gameplay code rather than the JSON-authored
// entity registry. Currently just the player; future gameplay-bearing
// entities (interactive NPCs, doors with logic, etc.) get hand-written
// factories here.
const SPECIAL_FACTORIES: Readonly<Record<string, EntityFactoryFn>> = {
  Sword_master_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new Player(scene, x, y);
  },
  // Door has gameplay logic (proximity-driven open/close + slam SFX) that
  // generic AnimatedEntity can't express, so it gets a hand-written factory
  // here. The Door subclass extends AnimatedEntity, so the registry's
  // animation config still drives its sprite — only the per-frame update
  // hook is added.
  Door_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new Door(scene, x, y);
  },
  // Save crystal needs a custom factory because its sequence
  // (start_up → idle hold → down → repeat) can't be expressed by the
  // single-anim baseline AnimatedEntity. The Save subclass drives the
  // state machine while still using the registry's animation config.
  Save_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new Save(scene, x, y);
  },
};

// Single source of truth for "LDtk entity identifier → in-game spawn".
// Composed of SPECIAL_FACTORIES (hand-authored) plus an auto-generated
// AnimatedEntity factory for every identifier in the entity registry.
// Adding a new animated entity is one JSON entry; adding a new gameplay
// entity is one entry in SPECIAL_FACTORIES.
//
// When an identifier is in both SPECIAL_FACTORIES and entityRegistry.json,
// the special factory wins — that combination is intentional for entities
// like Door whose animation/physics live in the registry but whose spawn
// behavior needs hand-written logic.
const FACTORIES: Readonly<Record<string, EntityFactoryFn>> = (() => {
  const out: Record<string, EntityFactoryFn> = { ...SPECIAL_FACTORIES };
  for (const { identifier, config } of listEntityRegistryEntries()) {
    if (identifier in out) continue;
    // Three-way switch on the registry blocks (validator guarantees `behavior`
    // and `trap` are mutually exclusive):
    //   behavior present → Enemy (health/AI/attacks)
    //   trap present     → Trap (overlap-based passive damage)
    //   neither          → AnimatedEntity (pure decoration)
    // Capture the branch at factory-build time so spawn-time work is just a
    // constructor call.
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

// Identifiers of entities spawned dynamically by this factory. Exposed so the
// LDtk renderer can suppress the static decoration tile that LDtk includes for
// these (every entity def carries a __tile preview rect for the editor) —
// otherwise the entity would render twice: once as the live sprite and once
// as a frozen image at the spawn location. Auto-derived from FACTORIES so
// registry additions update the suppression set without a manual sync point.
export const DYNAMIC_ENTITY_IDENTIFIERS: ReadonlySet<string> = new Set(
  Object.keys(FACTORIES),
);

export interface SpawnedEntities {
  player: Player | null;
  enemies: ReadonlyArray<Enemy>;
  // Doors with proximity-driven open/close logic. Pulled out of `others`
  // so GameScene's per-frame loop can call door.update(playerX, playerY)
  // without an instanceof check on every decoration entity.
  doors: ReadonlyArray<Door>;
  // Passive damage sources. Pulled out of `others` so GameScene can wire
  // the player↔traps overlap once at buildWorld time without iterating a
  // mixed group on every collision check.
  traps: ReadonlyArray<Trap>;
  // Pure-decoration AnimatedEntities (chests, ambient animals, lamps).
  // Kept distinct from `enemies`/`traps` so GameScene can iterate enemies
  // per-frame without an instanceof check.
  others: ReadonlyArray<Phaser.GameObjects.GameObject>;
}

export function spawnEntities(
  scene: Phaser.Scene,
  instances: ReadonlyArray<LdtkEntityInstance>,
): SpawnedEntities {
  let player: Player | null = null;
  const enemies: Enemy[] = [];
  const doors: Door[] = [];
  const traps: Trap[] = [];
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
    } else if (obj instanceof Enemy) {
      enemies.push(obj);
    } else if (obj instanceof Door) {
      doors.push(obj);
    } else if (obj instanceof Trap) {
      traps.push(obj);
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

  return { player, enemies, doors, traps, others };
}

// Symmetric teardown for spawnEntities. Optionally preserves the player so
// callers (e.g. HMR reloads) can keep the existing Player instance and just
// re-attach colliders to a freshly-built world. Player has its own DESTROY
// listener that detaches input handlers, so destroying it here is safe.
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
export function pivotCenter(e: LdtkEntityInstance): { x: number; y: number } {
  const baseX = e.__worldX ?? e.px[0];
  const baseY = e.__worldY ?? e.px[1];
  return {
    x: baseX + (0.5 - e.__pivot[0]) * e.width,
    y: baseY + (0.5 - e.__pivot[1]) * e.height,
  };
}

// Spawn position that aligns the sprite to the LDtk pivot per axis rather
// than centering it in the entity box. pivotCenter put the sprite at the
// box center (so the default Phaser origin renders it centered); for axes
// whose LDtk pivot is non-centered, shift back so the sprite edge matching
// the pivot direction lands on the box edge — matching what the LDtk editor
// shows (preview tile is anchored at the entity pivot, not centered in the
// box). Examples:
//   pivotY=1 (floor-anchored): sprite's anchor row sits on box bottom. When
//     anchorY is specified, the visible-bottom row of the device (e.g.
//     shocker_ejector ends at row 47 of a 64-row frame) lands on the floor;
//     otherwise the frame bottom does. Without this, the sprite floats
//     above the floor (box taller than sprite) or extends below the
//     placement point (sprite taller than box).
//   pivotX=0 (left-anchored, e.g. Light_with_bugs wall-mounted lamp): the
//     sprite's left edge sits at the box left edge, matching where the LDtk
//     preview tile renders.
//   pivotX=1 (right-anchored): mirror of the above on the right side.
// pivotX/Y=0.5 cases are no-ops (sprite already centered correctly).
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
  // X axis: shift the sprite so the frame edge matching pivotX (left for
  // pivotX=0, right for pivotX=1) aligns with the box edge on that side.
  // (pivotX - 0.5) * (boxWidth - frameWidth) = +/-(slack/2) for left/right
  // pivots; zero for pivotX=0.5 (no shift). When the box and frame are the
  // same width this is also zero so floor-anchored entities don't move.
  const correctionX = (pivotX - 0.5) * (instance.width - frameWidth);
  let correctionY = 0;
  if (defaultAnim.spawnAnchorY !== undefined) {
    // Explicit spawn anchor: shift the sprite so the spawnAnchorY row of
    // the default frame lands at the LDtk pivot Y (not the box center).
    // pivotCenter put y at the box center, so undo that offset first
    // (box center → LDtk pivot Y) and then add the per-axis shift needed
    // to land the anchor row at the pivot. Used for entities like the
    // heart hoarder where the visible figure sits in part of an oversized
    // frame and a default centered placement misses the intended position.
    const spawnAnchorY = defaultAnim.spawnAnchorY * scale;
    const pivotYWorld = instance.__worldY ?? instance.px[1];
    correctionY = pivotYWorld - y + frameHeight / 2 - spawnAnchorY;
  } else if (pivotY === 1) {
    const anchorY = (defaultAnim.anchorY ?? defaultAnim.frameHeight) * scale;
    // Sprite renders with origin (0.5, 0.5). pivotCenter put y at the box
    // center; shift down by half the box height to reach the box bottom,
    // then back up by (anchorY - frameHeight/2) so the anchor row lands at
    // the box bottom rather than the frame bottom.
    correctionY = instance.height / 2 - (anchorY - frameHeight / 2);
  }
  return { x: x + correctionX, y: y + correctionY };
}

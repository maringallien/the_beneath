import Phaser from 'phaser';
import type { LdtkEntityInstance, LoiterPathPoint } from '../ldtk/types';
import { AnimatedEntity } from './AnimatedEntity';
import { Chest } from './Chest';
import { Door } from './Door';
import { Enemy } from './Enemy';
import { getEntityRegistryEntry, listEntityRegistryEntries } from './entityRegistryLoader';
import type { AnimatedEntityConfig } from './entityRegistryTypes';
import { MushroomMerchant } from './MushroomMerchant';
import { Player } from './Player';
import { Save } from './Save';
import { TechShop } from './TechShop';
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
  // Door is a static, immovable wall. The Door subclass extends
  // AnimatedEntity so the registry still drives its sprite/body; the
  // hand-written factory exists so the player↔doors collider can be
  // wired up against a concrete subclass.
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
  // Chests share AnimatedEntity's spritesheet wiring but freeze on frame 0
  // instead of looping. A future interaction hook will call play() on the
  // returned Chest to run the open animation through once (loops:false in
  // the registry, so it settles on the last frame).
  Chest1_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new Chest(scene, x, y, 'Chest1_spawn');
  },
  Chest2_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new Chest(scene, x, y, 'Chest2_spawn');
  },
  // Merchants override the auto-factory's plain-AnimatedEntity path so they
  // can implement Interactable and emit SHOP_REQUESTED_EVENT on hold-E commit.
  // Same pattern as Save: the registry drives sprite/body/animation while
  // hand-written code owns the interaction. pivotCenter mirrors the Save /
  // Chest entries; gravity (mushroom merchant only) settles the body on the
  // floor via the staticEntities collider wired in GameScene.
  Tech_shop_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new TechShop(scene, x, y);
  },
  Mushroom_merchant_spawn: (scene, instance) => {
    const { x, y } = pivotCenter(instance);
    return new MushroomMerchant(scene, x, y);
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
  // Static, immovable doors. Pulled out of `others` so GameScene can
  // wire the player↔doors collider once at buildWorld time without
  // iterating a mixed group on every collision check.
  doors: ReadonlyArray<Door>;
  // Passive damage sources. Pulled out of `others` so GameScene can wire
  // the player↔traps overlap once at buildWorld time without iterating a
  // mixed group on every collision check.
  traps: ReadonlyArray<Trap>;
  // Hold-E interactable chests. Pulled out of `others` so InteractionManager
  // gets a pre-typed list at registration time without per-frame instanceof
  // filtering. Future interactables (NPCs, levers, save crystals) either
  // graduate similarly out of `others` or stay there and are picked up via
  // the Interactable type guard at registration time.
  chests: ReadonlyArray<Chest>;
  // Hold-E interactable save crystals. Pulled out of `others` for the same
  // reason as `chests` — InteractionManager gets a pre-typed list. Saves
  // also need a terrain collider (gravity:true in the registry) so GameScene
  // adds them to staticEntities explicitly now that they're no longer in
  // `others`.
  saves: ReadonlyArray<Save>;
  // Hold-E interactable merchants (TechShop, MushroomMerchant). Same
  // graduate-out-of-`others` rationale as `saves`/`chests`. Mushroom merchant
  // has gravity:true so GameScene adds these to staticEntities for the
  // terrain collider; tech shop has gravity:false but the collider is a
  // no-op for non-moving bodies.
  merchants: ReadonlyArray<TechShop | MushroomMerchant>;
  // Pure-decoration AnimatedEntities (ambient animals, lamps, etc.).
  // Kept distinct from `enemies`/`traps`/`chests`/`saves` so GameScene can
  // iterate typed lists per-frame without an instanceof check.
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
  const chests: Chest[] = [];
  const saves: Save[] = [];
  const merchants: Array<TechShop | MushroomMerchant> = [];
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
    } else if (obj instanceof Chest) {
      chests.push(obj);
    } else if (obj instanceof Save) {
      saves.push(obj);
    } else if (obj instanceof TechShop || obj instanceof MushroomMerchant) {
      merchants.push(obj);
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

  return { player, enemies, doors, traps, chests, saves, merchants, others };
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
  for (const chest of spawned.chests) {
    chest.destroy();
  }
  for (const save of spawned.saves) {
    save.destroy();
  }
  for (const merchant of spawned.merchants) {
    merchant.destroy();
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
  } else if (pivotY === 0) {
    // Top-anchored entity (e.g. ceiling-mounted hive). Mirror the pivotX=0
    // X-axis behavior: align the sprite's top edge with the LDtk box top,
    // matching where the LDtk preview tile renders. Without this, the sprite
    // centers within the box and appears lower than the placement point.
    correctionY = (frameHeight - instance.height) / 2;
  }
  return { x: x + correctionX, y: y + correctionY };
}

// Rebuild a single Enemy at the given coords without re-running the full
// LDtk-driven spawn pass. Used by EnemyRespawnManager when a killed enemy's
// timer elapses: spawn coords come from the original Enemy.getSpawnX/Y
// (already floor-aligned at first spawn, so no re-alignment here), and
// iid + loiterPath round-trip through Enemy.getIid/getLoiterPath so the
// rebuilt instance behaves identically to the original.
//
// Returns null when the identifier doesn't resolve to a behavior-bearing
// registry entry — defensive against a registry edit that flips an entity
// from enemy to decoration between the initial spawn and the respawn.
// Caller (GameScene.handleRespawn) is responsible for the post-spawn
// hookup that buildWorld also does: depth, group membership, audio anchors.
export function respawnEnemyAt(
  scene: Phaser.Scene,
  identifier: string,
  x: number,
  y: number,
  iid: string,
  loiterPath: ReadonlyArray<LoiterPathPoint> | null,
): Enemy | null {
  const entry = getEntityRegistryEntry(identifier);
  if (!entry || !entry.behavior) return null;
  return new Enemy(scene, x, y, identifier, iid, loiterPath);
}

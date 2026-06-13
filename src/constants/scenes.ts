/**
 * scenes constants — scene keys, level routing, spawn markers, and cross-scene
 * event names.
 *
 * The registry keys every Phaser scene is launched under, the LDtk level/entity
 * identifiers that anchor where the world renders and where the player spawns,
 * and the string names of the events emitted on the gameplay scene's event bus.
 * The CURRENT/STARTING level ids are single sources of truth — the world build
 * and tileset preload both read them, so they must stay aligned.
 *
 * Inputs:  none — compile-time constants.
 * Outputs: SCENE_KEYS, the *_LEVEL_/*_SPAWN_IDENTIFIER strings, and the *_EVENT names.
 * @calledby the scene manager when registering/launching scenes, the world
 *           builder and preloader resolving levels, and the publishers and
 *           listeners on the gameplay scene's event bus (save, boss, doors, shops).
 * @calls    nothing — a leaf data module.
 */

// Registry keys each Phaser scene is launched under.
export const SCENE_KEYS = {
  BOOT: 'BootScene',
  PRELOAD: 'PreloadScene',
  GAME: 'GameScene',
  PAUSE: 'PauseScene',
  LANDING: 'LandingScene',
  VICTORY: 'VictoryScene',
} as const;

// PreloadScene must use the same identifier when picking tilesets — keep them aligned.
export const CURRENT_LEVEL_IDENTIFIER = 'Level_5';

// buildWorld uses the spawn marker only in this level; single source of truth for the start location.
export const STARTING_LEVEL_IDENTIFIER = 'Level_3';

// buildWorld keeps only the marker in STARTING_LEVEL_IDENTIFIER to avoid tripping the "multiple players" guard.
export const PLAYER_SPAWN_IDENTIFIER = 'Sword_master_spawn';

// Payload is the Save instance so the scene can place the toast above the right crystal.
export const SAVE_REQUESTED_EVENT = 'save-requested';

// Payload is the boss's LDtk identifier; GameScene fires the victory flow once all required bosses are down.
export const BOSS_DEFEATED_EVENT = 'boss-defeated';

export const KEY_DOOR_LOCKED_EVENT = 'key-door-locked';

// Payload `{ kind: 'tech' | 'mushroom' }` so the ShopOverlay picks the right inventory.
export const SHOP_REQUESTED_EVENT = 'shop-requested';

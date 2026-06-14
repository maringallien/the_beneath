/**
 * @file constants/scenes.ts
 * @description Scene registry keys, LDtk level/spawn identifiers, and gameplay-scene event-bus names — the routing and world-anchor ids shared across scenes.
 * @module constants
 */

// ── Scene registry keys ────────────────────────────────────────────────────
// The keys each Phaser scene is registered and launched under via the scene manager.
export const SCENE_KEYS = {
  BOOT: 'BootScene',
  PRELOAD: 'PreloadScene',
  GAME: 'GameScene',
  PAUSE: 'PauseScene',
  LANDING: 'LandingScene',
  VICTORY: 'VictoryScene',
} as const;

// ── Level & spawn identifiers ──────────────────────────────────────────────
// LDtk ids anchoring where the world renders and where the player spawns. CURRENT_LEVEL is the single source
// of truth for both world build and tileset preload (they must stay aligned). buildWorld reads the player-spawn
// marker only in STARTING_LEVEL — keeping the marker to that one level avoids tripping the "multiple players" guard.
export const CURRENT_LEVEL_IDENTIFIER = 'Level_5';
export const STARTING_LEVEL_IDENTIFIER = 'Level_3';
export const PLAYER_SPAWN_IDENTIFIER = 'Sword_master_spawn';

// ── Gameplay event-bus names ───────────────────────────────────────────────
// Events published/consumed on the gameplay scene's bus (save, boss, doors, shops). Payloads: SAVE = the Save
// instance (toast placed above its crystal); BOSS_DEFEATED = the boss's LDtk id (victory flow once all required
// bosses fall); SHOP = `{ kind: 'tech' | 'mushroom' }` so the ShopOverlay picks the right inventory.
export const SAVE_REQUESTED_EVENT = 'save-requested';
export const BOSS_DEFEATED_EVENT = 'boss-defeated';
export const KEY_DOOR_LOCKED_EVENT = 'key-door-locked';
export const SHOP_REQUESTED_EVENT = 'shop-requested';

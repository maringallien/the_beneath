// Scene keys, level routing, spawn markers, and the cross-scene event
// names emitted on the GameScene event bus.

export const SCENE_KEYS = {
  BOOT: 'BootScene',
  PRELOAD: 'PreloadScene',
  GAME: 'GameScene',
  PAUSE: 'PauseScene',
  LANDING: 'LandingScene',
  VICTORY: 'VictoryScene',
} as const;

// LDtk level identifier rendered by GameScene. The PreloadScene must inspect
// the same identifier when picking which tilesets to load — keep them aligned.
export const CURRENT_LEVEL_IDENTIFIER = 'Level_5';

// LDtk level the player spawns into on a fresh boot. buildWorld selects the
// PLAYER_SPAWN_IDENTIFIER marker in THIS level as the player and ignores spawn
// markers in any other level, so this constant is the single source of truth
// for the start location. Triggers the landing page overlay (LandingScene) at
// first launch so the player is framed for the start screen.
export const STARTING_LEVEL_IDENTIFIER = 'Level_3';

// LDtk entity identifier for the player's spawn marker. buildWorld keeps only
// the one in STARTING_LEVEL_IDENTIFIER, so test markers placed in other levels
// are ignored rather than tripping the "multiple players" guard in spawnEntities.
export const PLAYER_SPAWN_IDENTIFIER = 'Sword_master_spawn';

// Emitted by a Save crystal when the player commits its hold-E interaction.
// GameScene listens on its own scene event bus (not on the Player) so the
// listener is scoped to the world build/teardown lifecycle. Payload is the
// Save instance so the scene can place the "Game Saved" toast above the
// specific crystal that was interacted with.
export const SAVE_REQUESTED_EVENT = 'save-requested';

// Emitted on the GameScene event bus by Enemy.enterDeadState when a boss dies,
// with the boss's LDtk identifier as payload. GameScene records the defeat and
// fires the victory flow once all REQUIRED_BOSS_IDENTIFIERS are down.
export const BOSS_DEFEATED_EVENT = 'boss-defeated';

// Emitted on the GameScene event bus by a key-locked Door when the player
// completes a hold-E without the matching key. GameScene shows the fade message.
export const KEY_DOOR_LOCKED_EVENT = 'key-door-locked';

// Merchant shops. Tech_shop_spawn sells ammo; Mushroom_merchant_spawn sells
// magic orbs. The merchant entity emits SHOP_REQUESTED_EVENT on hold-E commit
// and GameScene shows a DOM-based ShopOverlay (src/ui/ShopOverlay) over the
// canvas. Payload is `{ kind: 'tech' | 'mushroom' }` so the overlay picks
// the right inventory.
export const SHOP_REQUESTED_EVENT = 'shop-requested';

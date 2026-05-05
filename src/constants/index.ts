export const GAME_WIDTH = 800;
export const GAME_HEIGHT = 600;
export const GRAVITY_Y = 800;

export const PLAYER_WALK_SPEED = 120;
export const PLAYER_RUN_SPEED = 200;
export const PLAYER_SPRINT_SPEED = 300;
// Walk auto-promotes to run after this hold time. Sprint is opt-in via
// double-tap-and-hold of a direction key.
export const WALK_TO_RUN_MS = 400;
export const DOUBLE_TAP_WINDOW_MS = 250;
export const PLAYER_JUMP_VELOCITY = -380;
// Jump-cut: releasing W while still rising scales the upward velocity.
// Smaller = snappier short-hop. Lower than 1 to actually cut the jump.
export const JUMP_CUT_VELOCITY_MULTIPLIER = 0.4;
// Extra gravity (additive to GRAVITY_Y) applied while the player is falling,
// so the descent feels heavier than the ascent — kills the "floaty" feel.
export const FALL_BONUS_GRAVITY = 500;
export const PLAYER_DASH_SPEED = 335;
export const PLAYER_DASH_DURATION_MS = 200;
export const PLAYER_ROLL_SPEED = 224;
// Wall slide: max downward velocity while sliding against a wall in air.
export const WALL_SLIDE_MAX_VY = 90;
// Mouse-wheel cooldown between character mode swaps. Suppresses trackpad
// spam (a single swipe can fire many wheel events) without feeling laggy.
export const WHEEL_COOLDOWN_MS = 150;

// Projectile tuning. Speed and muzzle offset are per-mode because gun1 fires
// a small bullet while gun2 charges and lobs a larger energy shot.
export const PROJECTILE_GUN1_SPEED = 600;
export const PROJECTILE_GUN2_SPEED = 480;
// Lifetime ceiling so projectiles can't accumulate if they slip past world
// bounds or never collide with anything.
export const PROJECTILE_MAX_LIFETIME_MS = 2500;
// Muzzle offsets are relative to player sprite center (sprite.x, sprite.y).
// X is unsigned and gets flipped by Player when facing left. Y is below
// sprite center because the gun sits at waist level in both gun1 and gun2
// attack1 sheets — the actual barrel rests at frame y≈32-33, while the
// sprite origin (originY=0.5) lands at frame y=24.
export const PROJECTILE_GUN1_MUZZLE_OFFSET_X = 22;
export const PROJECTILE_GUN1_MUZZLE_OFFSET_Y = 9;
export const PROJECTILE_GUN2_MUZZLE_OFFSET_X = 22;
export const PROJECTILE_GUN2_MUZZLE_OFFSET_Y = 9;

export const SCENE_KEYS = {
  BOOT: 'BootScene',
  PRELOAD: 'PreloadScene',
  GAME: 'GameScene'
} as const;

export const ASSET_KEYS = {
  PLATFORM: 'platform'
} as const;

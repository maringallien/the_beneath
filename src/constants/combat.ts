/**
 * combat constants — player melee, health, hurt, and fall-damage tuning.
 *
 * Pure tuning data (no logic): sword damage and hitbox reach, max health and the
 * respawn delay, the hurt invulnerability window and knockback, and the
 * fall-damage curve. Re-exported through the constants barrel, so call sites
 * import from '../constants'.
 *
 * Inputs:  none — compile-time constants.
 * Outputs: the named tuning values below.
 * @calledby the player's attack/hurt/landing code and the respawn flow.
 * @calls    nothing — a leaf data module.
 */

// Melee hits harder than a projectile to offset the close-range risk.
export const SWORD_ATTACK_DAMAGE = 15;
// Magic swing costs one orb and hits 2× harder; downgrades to SWORD_ATTACK_DAMAGE when no orb is available.
export const SWORD_MAGIC_ATTACK_DAMAGE = 30;
// Forward reach: 40 px covers a generous swing on the 16px-wide physics body.
export const SWORD_ATTACK_REACH_X = 40;
// Vertical extent centered on the player — covers full body height plus a bit.
export const SWORD_ATTACK_REACH_Y = 30;

export const PLAYER_MAX_HEALTH = 100;
// Long enough for the death animation to finish before the world resets.
export const RESPAWN_DELAY_MS = 1500;
// Long enough to prevent stunlock, short enough that multi-hit combos still land both hits.
export const PLAYER_INVULN_MS = 500;
// X scaled by direction (away from source); Y always negative for an upward pop.
export const PLAYER_HURT_KNOCKBACK_X = 180;
export const PLAYER_HURT_KNOCKBACK_Y = -180;

// Safe threshold above a normal jump landing; wall-slides always stay below it.
// 500 px/s ≈ a 10-tile drop; terminal 900 px/s ≈ a 31-tile plunge.
export const FALL_DAMAGE_SAFE_SPEED = 500;
// px/s of excess speed per 1 HP; at terminal velocity raw hit ≈ 50 HP.
export const FALL_DAMAGE_SPEED_PER_HP = 8;
// Cap so even a terminal-velocity plunge is survivable from full health.
export const FALL_DAMAGE_MAX = 50;

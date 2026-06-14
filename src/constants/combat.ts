/**
 * @file constants/combat.ts
 * @description Player-combat tuning — sword damage/reach, max health, respawn delay, hurt i-frames/knockback, and the fall-damage curve.
 * @module constants
 */

// ── Sword ──────────────────────────────────────────────────────────────────
// Melee out-damages a projectile to offset close-range risk; the magic swing costs one orb and
// hits 2× (downgrades to SWORD_ATTACK_DAMAGE with no orb). Reach is a generous 40px swing on the
// 16px body, 30px tall (full body height plus a bit).
export const SWORD_ATTACK_DAMAGE = 15;
export const SWORD_MAGIC_ATTACK_DAMAGE = 30;
export const SWORD_ATTACK_REACH_X = 40;
export const SWORD_ATTACK_REACH_Y = 30;

// ── Health & hurt ──────────────────────────────────────────────────────────
// Respawn waits for the death animation to finish before the world resets; i-frames prevent
// stunlock yet stay short enough that multi-hit combos still land both hits. Knockback scales X
// by direction (away from source); Y is always negative (an upward pop).
export const PLAYER_MAX_HEALTH = 100;
export const RESPAWN_DELAY_MS = 1500;
export const PLAYER_INVULN_MS = 500;
export const PLAYER_HURT_KNOCKBACK_X = 180;
export const PLAYER_HURT_KNOCKBACK_Y = -180;

// ── Fall damage ────────────────────────────────────────────────────────────
// Nothing under the safe speed (500 px/s ≈ a 10-tile drop; wall-slides stay below it), then 1 HP
// per 8 px/s of excess — raw hit ≈ 50 HP at terminal 900 px/s (≈ a 31-tile plunge) — capped so
// even a terminal plunge is survivable from full health.
export const FALL_DAMAGE_SAFE_SPEED = 500;
export const FALL_DAMAGE_SPEED_PER_HP = 8;
export const FALL_DAMAGE_MAX = 50;

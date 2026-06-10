// Player combat: sword damage and reach, health, hurt invulnerability.

// Sword melee damage per swing. Melee is close-range, so the per-hit value
// is higher than a single projectile to compensate for the increased risk.
export const SWORD_ATTACK_DAMAGE = 15;
// Magic sword swing damage. A magic swing spends one orb (MAGIC_COST_PER_SWING)
// from the capped orb inventory, so it hits substantially harder than a free
// regular swing — 2× here. When the player has no orb to spend the swing
// downgrades to a regular hit (see startAttackAnim) and deals
// SWORD_ATTACK_DAMAGE instead.
export const SWORD_MAGIC_ATTACK_DAMAGE = 30;
// Forward reach of the sword hitbox in source pixels (player frame is 90x37
// with a 16px-wide physics body, so 40px forward covers a generous swing).
export const SWORD_ATTACK_REACH_X = 40;
// Hitbox vertical extent in source pixels, centered on the player. Covers
// the full body height plus a bit to catch slightly above/below enemies.
export const SWORD_ATTACK_REACH_Y = 30;

// Player health and hurt-state tuning.
export const PLAYER_MAX_HEALTH = 100;
// Delay before the scene restarts after PLAYER_DIED_EVENT. Long enough for
// the death animation to play to completion (sword_master death is the
// longest at ~10 frames @ 12 fps ≈ 830ms) plus a brief beat so the corpse
// lingers before the world resets.
export const RESPAWN_DELAY_MS = 1500;
// Invulnerability window after taking a hit, in ms. Long enough to prevent
// multi-hit stunlock from a single enemy attack frame but short enough that
// multi-strike combos (e.g. The_heart_hoarder attack2's frame-2 + frame-9
// slams, ~583 ms apart at 12 fps) land both hits and the player can be
// punished by repeated attacks.
export const PLAYER_INVULN_MS = 500;
// Knockback velocity applied on hurt. X is scaled by direction (away from
// the source); Y is always negative (upward pop) for a satisfying feel.
export const PLAYER_HURT_KNOCKBACK_X = 180;
export const PLAYER_HURT_KNOCKBACK_Y = -180;

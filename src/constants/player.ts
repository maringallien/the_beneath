/**
 * player constants — movement, resources, projectile, and gun-overlay tuning.
 *
 * Pure tuning data (no logic): player run/jump/dash/roll movement, the resource
 * economy (ammo / magic / healing / stamina / coins), projectile speeds and
 * lifetimes, and gun-overlay attachment offsets. Re-exported through the
 * constants barrel, so call sites import from '../constants'.
 *
 * Inputs:  none — compile-time constants.
 * Outputs: the named tuning values below.
 * @calledby the player entity and its movement/combat code, the HUD, and the
 *           projectile/gun systems that read these thresholds.
 * @calls    nothing — a leaf data module.
 */

export const PLAYER_RUN_SPEED = 120;
export const PLAYER_JUMP_VELOCITY = -330;
// Smaller = snappier short-hop; must be < 1 to cut the jump at all.
export const JUMP_CUT_VELOCITY_MULTIPLIER = 0.4;
// Zero = symmetric rise/fall; positive makes descent snappier than the ascent.
export const FALL_BONUS_GRAVITY = 0;
// 900 px/s leaves margin below the tile-skip threshold (16px × 60fps = 960 px/s).
export const PLAYER_MAX_FALL_SPEED = 900;
export const PLAYER_DASH_SPEED = 220;
export const PLAYER_DASH_DURATION_MS = 200;
export const PLAYER_ROLL_SPEED = 224;
export const WALL_SLIDE_MAX_VY = 90;
// Suppresses trackpad spam (one swipe fires many wheel events) without feeling laggy.
export const WHEEL_COOLDOWN_MS = 150;

// gun2 is slower — it's a charged energy shot, not a rapid bullet.
export const PROJECTILE_GUN1_SPEED = 600;
export const PROJECTILE_GUN2_SPEED = 480;
// Generous ceiling so distant enemies are hittable; the old 2.5s cap made bullets appear to pass through them.
export const PROJECTILE_MAX_LIFETIME_MS = 15000;
// Grip-to-muzzle distance; rotates with aim angle to spawn the projectile at the visible muzzle.
export const PROJECTILE_BARREL_LENGTH_PX = 24;
// >1 = faster: divides the attack animation duration, shortening the locked-attack window.
export const GUNSLINGER_GUN1_FIRE_RATE_MULTIPLIER = 1.3;

// Gun2 hits 50% harder than gun1 to compensate for its slower fire rate.
export const PROJECTILE_GUN1_DAMAGE = 10;
export const PROJECTILE_GUN2_DAMAGE = 15;

// Deliberately scarce — guns out-DPS the sword, so caps keep melee the default and guns an emergency burst.
// Fully upgraded: BASE + 3×step = 30 pistol / 20 shotgun. Live cap adds purchased-upgrade count from runProgress.
export const INITIAL_GUN1_AMMO = 8;
export const BASE_MAX_GUN1_AMMO = 12;
export const INITIAL_GUN2_AMMO = 3;
export const BASE_MAX_GUN2_AMMO = 8;
// One Ammo Storage upgrade bumps both guns. Three tiers: gun1 12→30, gun2 8→20.
export const GUN1_CAPACITY_UPGRADE_STEP = 6;
export const GUN2_CAPACITY_UPGRADE_STEP = 4;
// Small grant so a drop/buy adds a couple of shots rather than refilling the magazine.
export const AMMO_PICKUP_GUN1_AMOUNT = 3;
export const AMMO_PICKUP_GUN2_AMOUNT = 1;
export const AMMO_COST_PER_SHOT = 1;

// Counted orb inventory; no regen. Orb Pouch upgrades climb the cap 3→6→8→10.
// Live cap is summed per purchased tier because the steps are uneven.
export const INITIAL_MAGIC = 3;
export const BASE_MAX_MAGIC = 3;
export const MAGIC_PICKUP_AMOUNT = 1;
export const MAGIC_COST_PER_SWING = 1;

// Cooldown is an anti-spam guard so key-repeat can't dump the whole stash in one frame.
export const INITIAL_HEAL_ITEMS = 0;
export const MAX_HEAL_ITEMS = 5;
export const HEAL_ITEM_RESTORE_AMOUNT = 25;
export const HEAL_PICKUP_AMOUNT = 1;
export const HEAL_ITEM_USE_COOLDOWN_MS = 400;

// Discrete 3-bar dash meter; regens one bar per interval while not dashing.
export const INITIAL_STAMINA = 3;
export const MAX_STAMINA = 3;
export const DASH_STAMINA_COST = 1;
export const STAMINA_REGEN_INTERVAL_MS = 2000;

// MAX_COINS is a HUD digit-budget sentinel, not a real cap.
export const INITIAL_COINS = 0;
export const MAX_COINS = 9999;
export const COIN_PICKUP_AMOUNT = 1;
// Drop tiers (N independent chancePct:100 entries in entityRegistry.json):
//   Ghoul 1 · regular 2 · Chest1 4 · Chest2 8 · boss 20
// Lean enough that ~3 kills fund a gun1 pack; a boss ≈ one magic orb.

// Pivot offset to the idle hand pixel on the 48×48 frame; flipX is mirrored automatically.
export const GUN_OVERLAY_PIVOT_OFFSET_X = -2;
export const GUN_OVERLAY_PIVOT_OFFSET_Y = 8;

// Grip at frame x≈3/32 so the rotation pivot lands on the grip, not the empty left edge.
export const GUN_OVERLAY_GRIP_ORIGIN_X = 3 / 32;

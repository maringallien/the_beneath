/**
 * @file constants/player.ts
 * @description Player tuning — run/jump/dash/roll movement, the ammo/magic/healing/stamina/coin economy, projectile speeds/damage/lifetimes, and gun-overlay attachment offsets.
 * @module constants
 */

// ── Movement ───────────────────────────────────────────────────────────────
// Run/jump/dash/roll/wall-slide kinematics. JUMP_CUT (<1, smaller = snappier short-hop) trims jump height on
// early release; FALL_BONUS_GRAVITY 0 keeps rise/fall symmetric (positive would make descent snappier). Max fall
// speed 900 px/s leaves margin below the tile-skip threshold (16px × 60fps = 960 px/s). WHEEL_COOLDOWN suppresses
// trackpad spam (one swipe fires many wheel events) without feeling laggy.
export const PLAYER_RUN_SPEED = 120;
export const PLAYER_JUMP_VELOCITY = -330;
export const JUMP_CUT_VELOCITY_MULTIPLIER = 0.4;
export const FALL_BONUS_GRAVITY = 0;
export const PLAYER_MAX_FALL_SPEED = 900;
export const PLAYER_DASH_SPEED = 220;
export const PLAYER_DASH_DURATION_MS = 200;
export const PLAYER_ROLL_SPEED = 224;
export const WALL_SLIDE_MAX_VY = 90;
export const WHEEL_COOLDOWN_MS = 150;

// ── Projectiles & firing ───────────────────────────────────────────────────
// gun2 is slower (a charged energy shot, not a rapid bullet) but hits 50% harder to compensate for its fire rate.
// The generous lifetime ceiling keeps distant enemies hittable (the old 2.5s cap made bullets appear to pass
// through them). Barrel length is the grip-to-muzzle distance, rotated with aim angle to spawn at the visible
// muzzle. The gunslinger fire-rate multiplier (>1 = faster) divides the attack-animation duration, shortening
// the locked-attack window.
export const PROJECTILE_GUN1_SPEED = 600;
export const PROJECTILE_GUN2_SPEED = 480;
export const PROJECTILE_MAX_LIFETIME_MS = 15000;
export const PROJECTILE_BARREL_LENGTH_PX = 24;
export const GUNSLINGER_GUN1_FIRE_RATE_MULTIPLIER = 1.3;
export const PROJECTILE_GUN1_DAMAGE = 10;
export const PROJECTILE_GUN2_DAMAGE = 15;

// ── Ammo economy ───────────────────────────────────────────────────────────
// Deliberately scarce — guns out-DPS the sword, so caps keep melee the default and guns an emergency burst.
// One Ammo Storage upgrade bumps both guns across three tiers (gun1 12→30, gun2 8→20); fully upgraded is
// BASE + 3×step, and the live cap adds the purchased-upgrade count from runProgress. Pickup grants are small so
// a drop/buy adds a couple of shots rather than refilling the magazine.
export const INITIAL_GUN1_AMMO = 8;
export const BASE_MAX_GUN1_AMMO = 12;
export const INITIAL_GUN2_AMMO = 3;
export const BASE_MAX_GUN2_AMMO = 8;
export const GUN1_CAPACITY_UPGRADE_STEP = 6;
export const GUN2_CAPACITY_UPGRADE_STEP = 4;
export const AMMO_PICKUP_GUN1_AMOUNT = 3;
export const AMMO_PICKUP_GUN2_AMOUNT = 1;
export const AMMO_COST_PER_SHOT = 1;

// ── Magic economy ──────────────────────────────────────────────────────────
// Counted orb inventory with no regen. Orb Pouch upgrades climb the cap 3→6→8→10; because the steps are uneven,
// the live cap is summed per purchased tier rather than counted.
export const INITIAL_MAGIC = 3;
export const BASE_MAX_MAGIC = 3;
export const MAGIC_PICKUP_AMOUNT = 1;
export const MAGIC_COST_PER_SWING = 1;

// ── Healing ────────────────────────────────────────────────────────────────
// Counted heal-item inventory; the use cooldown is an anti-spam guard so key-repeat can't dump the whole stash
// in one frame.
export const INITIAL_HEAL_ITEMS = 0;
export const MAX_HEAL_ITEMS = 5;
export const HEAL_ITEM_RESTORE_AMOUNT = 25;
export const HEAL_PICKUP_AMOUNT = 1;
export const HEAL_ITEM_USE_COOLDOWN_MS = 400;

// ── Stamina ────────────────────────────────────────────────────────────────
// Discrete 3-bar dash meter; regens one bar per interval while not dashing.
export const INITIAL_STAMINA = 3;
export const MAX_STAMINA = 3;
export const DASH_STAMINA_COST = 1;
export const STAMINA_REGEN_INTERVAL_MS = 2000;

// ── Coins ──────────────────────────────────────────────────────────────────
// MAX_COINS is a HUD digit-budget sentinel, not a real cap. Drop tiers live in entityRegistry.json as N
// independent chancePct:100 entries (Ghoul 1 · regular 2 · Chest1 4 · Chest2 8 · boss 20) — lean enough that
// ~3 kills fund a gun1 pack and a boss ≈ one magic orb.
export const INITIAL_COINS = 0;
export const MAX_COINS = 9999;
export const COIN_PICKUP_AMOUNT = 1;

// ── Gun overlay attachment ─────────────────────────────────────────────────
// Pivot offset to the idle hand pixel on the 48×48 frame (flipX mirrors automatically); the grip origin at frame
// x≈3/32 lands the rotation pivot on the grip, not the empty left edge.
export const GUN_OVERLAY_PIVOT_OFFSET_X = -2;
export const GUN_OVERLAY_PIVOT_OFFSET_Y = 8;
export const GUN_OVERLAY_GRIP_ORIGIN_X = 3 / 32;

// Player movement, resources (ammo / magic / healing / stamina / coins),
// projectile tuning, and gun-overlay attachment.

export const PLAYER_RUN_SPEED = 120;
export const PLAYER_JUMP_VELOCITY = -330;
// Jump-cut: releasing W while still rising scales the upward velocity.
// Smaller = snappier short-hop. Lower than 1 to actually cut the jump.
export const JUMP_CUT_VELOCITY_MULTIPLIER = 0.4;
// Extra gravity (additive to GRAVITY_Y) applied while the player is falling.
// Zero = symmetric rise/fall acceleration; a positive value makes the descent
// snappier than the ascent.
export const FALL_BONUS_GRAVITY = 0;
// Terminal fall speed. Arcade Physics is discrete: a body that moves more
// than one tile (16 px) per physics step can skip past floor colliders. At
// 60 FPS that's 16 * 60 = 960 px/s; 900 leaves a small margin.
export const PLAYER_MAX_FALL_SPEED = 900;
export const PLAYER_DASH_SPEED = 220;
export const PLAYER_DASH_DURATION_MS = 200;
export const PLAYER_ROLL_SPEED = 224;
// Wall slide: max downward velocity while sliding against a wall in air.
export const WALL_SLIDE_MAX_VY = 90;
// Mouse-wheel cooldown between character mode swaps. Suppresses trackpad
// spam (a single swipe can fire many wheel events) without feeling laggy.
export const WHEEL_COOLDOWN_MS = 150;

// Projectile tuning. Speed is per-mode because gun1 fires a small bullet
// while gun2 charges and lobs a larger energy shot.
export const PROJECTILE_GUN1_SPEED = 600;
export const PROJECTILE_GUN2_SPEED = 480;
// Lifetime ceiling so projectiles can't accumulate if they slip past world
// bounds or never collide with anything. Generous (15s × 600 px/s ≈ 9000
// px of travel) so distant enemies are still hittable — the previous
// 2.5s cap silently capped effective range at ≈ 1500 px and made bullets
// appear to "pass through" enemies that sat just past the timeout.
export const PROJECTILE_MAX_LIFETIME_MS = 15000;
// Distance from gun pivot (grip) to muzzle along the barrel axis. The barrel
// extends along the gun's local +X, so this offset rotates with the aim angle
// to place the projectile spawn at the visible muzzle for any firing
// direction. Derived from the gun's grip-to-muzzle pixel distance in the
// 32px overlay sprite (grip at frame x≈3, muzzle at frame x≈21 + the gun
// pivot's −2px shift relative to player center → ~24).
export const PROJECTILE_BARREL_LENGTH_PX = 24;
// Fire-rate multiplier applied to gun1's attack animation. >1 = faster: the
// body and overlay anims both have their playback duration divided by this,
// shortening the locked-attack window proportionally and increasing the rate
// at which the player can re-fire.
export const GUNSLINGER_GUN1_FIRE_RATE_MULTIPLIER = 1.3;

// Damage dealt by a player projectile. Gun2 (charged shot) hits 40% harder
// than gun1 (rapid fire) to compensate for its slower fire rate.
export const PROJECTILE_GUN1_DAMAGE = 10;
export const PROJECTILE_GUN2_DAMAGE = 15;

// Ammo capacity and starting values. Deliberately scarce: guns out-DPS and
// out-range the sword, so without tight caps the player can just shoot through
// every fight. The BASE_MAX is the unupgraded magazine cap — low so guns read
// as an emergency burst to be saved for trouble (with melee as the default),
// and INITIAL spawns BELOW it. The player widens the cap by buying the "Ammo
// Storage" upgrade at the three tech shops (Level_23/21/16); each tier adds the
// CAPACITY_UPGRADE_STEP below, so a fully-upgraded run carries
// BASE + 3·step = 30 pistol / 20 shotgun. The live cap is derived in
// Player.getMaxGun1Ammo()/getMaxGun2Ammo() from this base plus the purchased-
// upgrade count in runProgress (so it survives death/respawn). Tune these (with
// the 25% regular-enemy ammo drop chance in entityRegistry.json and the
// per-pickup grants below) to set how gun-reliant a run can be.
export const INITIAL_GUN1_AMMO = 8;
export const BASE_MAX_GUN1_AMMO = 12;
export const INITIAL_GUN2_AMMO = 3;
export const BASE_MAX_GUN2_AMMO = 8;
// Per-tier capacity increment for the Ammo Storage upgrade. One upgrade bumps
// BOTH guns at once. Three tiers reach the ceilings noted above (gun1 12→30 at
// +6, gun2 8→20 at +4).
export const GUN1_CAPACITY_UPGRADE_STEP = 6;
export const GUN2_CAPACITY_UPGRADE_STEP = 4;
// Per-pickup grant — also the per-purchase shop grant (SHOP_GUN*_GRANT aliases
// these). Kept small so a single drop/buy tops you up by a couple of shots
// rather than refilling the magazine, reinforcing the scarcity above. Gun2
// grants fewer to keep heavier ammo scarce.
export const AMMO_PICKUP_GUN1_AMOUNT = 3;
export const AMMO_PICKUP_GUN2_AMOUNT = 1;
// Ammo consumed per gunshot. Same for both guns — capacity differences
// already encode the relative scarcity.
export const AMMO_COST_PER_SHOT = 1;

// Magic resource: a counted orb inventory (like coins / heal items), capped at
// the player's current orb cap. Each magic sword swing spends one orb
// (MAGIC_COST_PER_SWING). No regen — orbs are gained only from MAGIC_ORB
// pickups (chest2 and boss drops, plus the shop), one orb per pickup. The HUD
// renders this as an orb icon + carried count (see PlayerHudOverlay), matching
// the coin and heal counters rather than the old three-segment bar.
// BASE_MAX_MAGIC is the unupgraded cap. The three mushroom merchants
// (Level_23/21/16, encountered in that order while descending) each sell one
// "Orb Pouch" upgrade; MAGIC_UPGRADE_CAPACITY_STEPS (below, index-aligned with
// MAGIC_UPGRADE_LEVELS) lists the per-tier cap gain, so the cap climbs
// 3 → 6 → 8 → 10 once all three are bought. The live cap is summed per purchased
// tier in Player.getMaxMagic() — the steps are uneven, so it can't just count.
export const INITIAL_MAGIC = 3;
export const BASE_MAX_MAGIC = 3;
export const MAGIC_PICKUP_AMOUNT = 1;
export const MAGIC_COST_PER_SWING = 1;

// Healing item: a counted consumable. Pickups (chest/enemy drops, mushroom
// merchant) raise the carried count up to MAX_HEAL_ITEMS; pressing Q spends
// one to restore HEAL_ITEM_RESTORE_AMOUNT health (clamped to PLAYER_MAX_HEALTH).
// Mirrors the magic resource's "stockpile then consume" shape, so it rides the
// same PickupKind / addPickup / shop-purchase seams. HEAL_ITEM_USE_COOLDOWN_MS
// is a light anti-spam guard so key-repeat can't dump the whole stash in one
// frame. HUD renders this as a heart icon + count (see PlayerHud).
export const INITIAL_HEAL_ITEMS = 0;
export const MAX_HEAL_ITEMS = 5;
export const HEAL_ITEM_RESTORE_AMOUNT = 25;
export const HEAL_PICKUP_AMOUNT = 1;
export const HEAL_ITEM_USE_COOLDOWN_MS = 400;

// Stamina resource: discrete 3-bar meter, mirrors the magic shape. Each dash
// costs one bar (DASH_STAMINA_COST). Stamina regenerates one bar every
// STAMINA_REGEN_INTERVAL_MS while the player is not actively dashing.
export const INITIAL_STAMINA = 3;
export const MAX_STAMINA = 3;
export const DASH_STAMINA_COST = 1;
export const STAMINA_REGEN_INTERVAL_MS = 2000;

// Gold coin currency: integer counter accumulated from chest/enemy drops.
// Currently a pure score — a future shop will spend coins on ammo/magic.
// MAX_COINS is a sentinel for HUD digit-width budgeting; not a real cap.
export const INITIAL_COINS = 0;
export const MAX_COINS = 9999;
export const COIN_PICKUP_AMOUNT = 1;
// Per-source drop counts. Each coin is one COIN_PICKUP_AMOUNT (1), so the
// drop count doubles as the gold value of each kill. Tuned per-entity in
// entityRegistry.json as N independent `chancePct: 100` drop entries — the
// JSON is the source of truth; this table documents the tiers.
//   Weakest mook (Ghoul) ............... 1
//   Regular enemy / bandit ............. 2
//   Small chest (Chest1) ............... 4
//   Large chest (Chest2) ............... 8
//   Boss ............................... 20
// Deliberately lean (~⅓ of the original tiers) so the player can't buy their
// way past every fight. Against shop prices (gun1 pack 10, gun2 pack 15, magic
// orb 25): ~3 regular kills fund a gun1 pack, a small chest is most of one, a
// large chest ≈ a gun1 pack, and a boss ≈ one magic orb (was two).

// Gun overlay pivot offset relative to the player's sprite center (player
// origin is 0.5,0.5 on a 48x48 frame). Positive X is forward (the sprite's
// flipX is mirrored automatically in PlayerGun); positive Y is down. Tuned to
// the no_gun idle hand pixel: bbox of the body sprite is x=17..29, y=21..47,
// hand at frame (28, 33) ≈ sprite center (24,24) + (+4, +9).
export const GUN_OVERLAY_PIVOT_OFFSET_X = -2;
export const GUN_OVERLAY_PIVOT_OFFSET_Y = 8;

// Origin fraction inside the 32x32 gun overlay frame for the grip pixel. The
// gun graphic occupies frame x=3..21, so the grip sits at frame x≈3. Setting
// origin X = 3/32 ≈ 0.094 makes the rotation pivot land on the grip itself
// instead of the empty left edge, so the visible grip stays attached to the
// player's hand under rotation.
export const GUN_OVERLAY_GRIP_ORIGIN_X = 3 / 32;

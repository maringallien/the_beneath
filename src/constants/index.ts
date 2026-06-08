export const GRAVITY_Y = 800;

// Camera zoom multiplier in GameScene. Higher = more zoomed-in on the player.
// Pixel-art sprites are small (sword_master frame is 90x37); zoom 3 keeps the
// character readable across typical desktop window sizes.
export const CAMERA_ZOOM = 3;

// Vertical follow offset in world units. Phaser subtracts this from the
// target's position when computing scroll, so a positive value pulls the
// camera up and the player renders below screen center. 36 ≈ one character
// length (sword_master frame is 37 px tall) — the player sits roughly one
// body below the vertical midpoint, leaving most of the viewport as headroom.
export const CAMERA_VERTICAL_OFFSET_PX = 36;

// Maximum world-pixel distance the camera is allowed to drift from its
// follow-offset target. The slow lerp (0.08) feels buttery on jumps but
// can't keep up with terminal-velocity falls — at ~15 px/frame the steady
// lag would push the player off screen. Per-frame clamp to this radius
// guarantees the player stays visible regardless of fall speed.
export const CAMERA_MAX_VERTICAL_LAG_PX = 50;

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
// Storage" upgrade at the three tech shops (Level_9/11/18); each tier adds the
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
// BASE_MAX_MAGIC is the unupgraded cap; the "Orb Pouch" upgrade sold at the
// three mushroom merchants (Level_9/11/18) adds MAGIC_CAPACITY_UPGRADE_STEP per
// tier, so BASE + 3·step = 20 carried orbs once fully upgraded. The live cap is
// derived in Player.getMaxMagic() from the purchased-upgrade count.
export const INITIAL_MAGIC = 3;
export const BASE_MAX_MAGIC = 8;
export const MAGIC_CAPACITY_UPGRADE_STEP = 4;
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
// Per-source drop counts. Each coin is one COIN_PICKUP_AMOUNT (1), so these
// double as the gold value of each kill. Tuned per-entity in
// entityRegistry.json as N independent `chancePct: 100` drop entries — these
// constants document the tiers, the JSON is the source of truth.
//   Weakest mook (Ghoul) ............... 1
//   Regular enemy / bandit ............. 2
//   Small chest (Chest1) ............... 4
//   Large chest (Chest2) ............... 8
//   Boss ............................... 20
// Deliberately lean (~⅓ of the original tiers) so the player can't buy their
// way past every fight. Against shop prices (gun1 pack 10, gun2 pack 15, magic
// orb 25): ~3 regular kills fund a gun1 pack, a small chest is most of one, a
// large chest ≈ a gun1 pack, and a boss ≈ one magic orb (was two).
export const COIN_DROP_WEAK_ENEMY_COUNT = 1;
export const COIN_DROP_REGULAR_ENEMY_COUNT = 2;
export const COIN_DROP_CHEST_SMALL_COUNT = 4;
export const COIN_DROP_CHEST_LARGE_COUNT = 8;
export const COIN_DROP_BOSS_COUNT = 20;

// Gold coin placeholder: generated procedurally in PreloadScene as a small
// gold disc with an inset highlight ring. Mirrors the magic orb pattern —
// LINEAR-filtered so it stays smooth at CAMERA_ZOOM. Swap for a real PNG
// by loading at COIN_TEXTURE_KEY in preload() and removing the generator.
export const COIN_TEXTURE_KEY = 'gold_coin';
// Source-pixel size. Authored larger than the final display size so LINEAR
// sampling has enough resolution to stay crisp in the HUD (where the icon
// renders at ~9.6 world units × CAMERA_ZOOM = 28.8 canvas px); world-drop
// scale (COIN_DROP_DISPLAY_SCALE) and HUD icon scale (PlayerHud's
// COIN_ICON_SCALE) compensate to keep on-screen sizes unchanged.
export const COIN_TEXTURE_SIZE_PX = 32;
// World-drop scale: 32 × 0.125 = 4 world units, matching the previous coin
// footprint when the source texture was 8 px at 0.5× scale. Coin-specific
// (not AMMO_DROP_DISPLAY_SCALE) because the larger source texture would
// otherwise make world coins balloon.
export const COIN_DROP_DISPLAY_SCALE = 0.125;
// Coin burst spawn. A chest with 20 coin drops spawns 20 AmmoDrop sprites
// at the same XY; without these the tight ammo-drop jitter (±30 px/s drag
// 400) collapses them onto a single tile and looks like one coin worth N.
// Wider X velocity range + lower drag spreads the burst across ~80-100 px
// so each coin lands at a visibly distinct spot. Y velocity range gives
// each coin a different arc so they don't all peak at the same height.
export const COIN_SPAWN_VELOCITY_X_JITTER = 140;
export const COIN_SPAWN_VELOCITY_Y_MIN = -200;
export const COIN_SPAWN_VELOCITY_Y_MAX = -90;
export const COIN_DRAG_X = 90;
// Warm gold body and a brighter highlight ring inset from the edge. The
// highlight is rendered slightly off-center to give the disc a faint 3D
// read at small sizes without needing a real sprite.
export const COIN_FILL_COLOR = 0xffcc33;
export const COIN_HIGHLIGHT_COLOR = 0xfff2a8;

// Heal-item pickup: generated procedurally in PreloadScene as a flat white "+"
// cross, matching the heal-counter glyph in the player HUD (hudIcons.ts) so the
// item reads identically in the world drop, the HUD, and the shop. LINEAR-
// filtered so it stays smooth at CAMERA_ZOOM and renders smoothly in the DOM
// shop (intentionally excluded from ShopOverlay's PIXEL_ART_TEXTURE_KEYS). Swap
// for a real PNG by loading at HEAL_CROSS_TEXTURE_KEY in preload() and removing
// the generator call.
export const HEAL_CROSS_TEXTURE_KEY = 'heal_cross';
// Source-pixel size, authored larger than the world-drop footprint (like the
// coin) so the straight arms stay crisp when LINEAR-sampled at zoom.
export const HEAL_CROSS_TEXTURE_SIZE_PX = 32;
// World-drop scale: 32 × 0.25 = 8 world units, a touch larger than ammo/orb so
// the rarer healing pickup reads as more important at a glance.
export const HEAL_CROSS_DROP_DISPLAY_SCALE = 0.25;
// Flat white, matching the HUD heal glyph — a clean modern mark, so no faux-3D
// highlight (unlike the shaded coin/orb).
export const HEAL_CROSS_COLOR = 0xffffff;

// Boss-key placeholder: generated procedurally in PreloadScene as a small gold
// key (round bow + shaft + two teeth) with a brighter highlight on the bow —
// the same faux-3D idiom as the coin/heart. LINEAR-filtered so it stays smooth
// at CAMERA_ZOOM. Both boss keys share one texture (they're visually identical;
// the door-matching is by pickup kind, not appearance). Swap for a real PNG by
// loading at KEY_TEXTURE_KEY in preload() and removing the generator call.
export const KEY_TEXTURE_KEY = 'boss_key';
// Source-pixel size, authored larger than the world-drop footprint so LINEAR
// sampling keeps the bow's curve and the teeth crisp at zoom.
export const KEY_TEXTURE_SIZE_PX = 16;
// World-drop scale: 16 × 0.5 = 8 world units, matching the heart so the rare
// key reads as an important pickup at a glance.
export const KEY_DROP_DISPLAY_SCALE = 0.5;
// Each successful key drop grants exactly one key (it's a unique unlock, not a
// stackable resource). Kept as a constant for parity with the other pickups.
export const KEY_PICKUP_AMOUNT = 1;
// Warm gold body + a brighter highlight, mirroring the coin's palette so the
// key reads as the same "treasure" material family.
export const KEY_FILL_COLOR = 0xffcc33;
export const KEY_HIGHLIGHT_COLOR = 0xfff2a8;

// Magic orb placeholder: generated procedurally in PreloadScene as a pure
// black smooth circle. No highlight, no pulse — the visual "magic" comes from
// the mist particle emitter that follows each spawned orb (see below). Swap
// for a real PNG by loading at MAGIC_ORB_TEXTURE_KEY in preload() and
// removing the generator call.
export const MAGIC_ORB_TEXTURE_KEY = 'magic_orb';
// Source-pixel size of the generated orb texture. Authored larger than the
// final display size so LINEAR sampling at the camera's zoom has enough
// resolution to keep the edge smooth. Reduced from 16 → 12 so the orb reads
// as slightly smaller than ammo drops.
export const MAGIC_ORB_TEXTURE_SIZE_PX = 12;
// Cyan body. The orb itself carries no detail — the mist emitter is
// what makes it read as magical rather than as a plain dot. Keep
// MIST_PARTICLE_COLOR in sync so the orb's aura matches its body.
export const MAGIC_ORB_FILL_COLOR = 0x00ffff;

// Magic orbs don't fall — they loiter near their spawn point with a slow
// sinusoidal drift on both axes. Different X/Y periods produce an open
// Lissajous figure so the motion never repeats a straight line; per-orb random
// phase prevents multiple co-located orbs from moving in lockstep.
export const MAGIC_ORB_LOITER_X_AMPLITUDE_PX = 8;
export const MAGIC_ORB_LOITER_Y_AMPLITUDE_PX = 5;
export const MAGIC_ORB_LOITER_X_PERIOD_MS = 2400;
export const MAGIC_ORB_LOITER_Y_PERIOD_MS = 1800;
// Lifts the orb's anchor above the source's body surface (chest body.top or
// enemy body.center) so it visibly hovers in the air rather than resting on
// the lid / corpse.
export const MAGIC_ORB_SPAWN_Y_OFFSET_PX = -10;

// Mist particle emitter: each magic orb has one attached, emitting a slow
// stream of tiny dark puffs that drift upward and fade. "Discrete" means low
// emission rate so individual particles read separately rather than as a
// continuous fog.
export const MIST_PARTICLE_TEXTURE_KEY = 'magic_mist';
// 6x6 source pixels: small enough to feel like a discrete particle, large
// enough for LINEAR filtering to soften the edge into something mist-like.
export const MIST_PARTICLE_TEXTURE_SIZE_PX = 6;
// Cyan to match MAGIC_ORB_FILL_COLOR so the orb's mist aura reads as one piece.
export const MIST_PARTICLE_COLOR = 0x00ffff;
// Lifespan window per particle (ms). Random within range so the cloud doesn't
// pulse in a uniform rhythm.
export const MIST_PARTICLE_LIFESPAN_MIN_MS = 900;
export const MIST_PARTICLE_LIFESPAN_MAX_MS = 1500;
// Emit cadence: one particle per ~400ms. Higher = sparser. Low quantity per
// emission keeps the "discrete" feel.
export const MIST_PARTICLE_EMIT_FREQUENCY_MS = 400;
// Drift speed range (px/s). Slow — the mist rises rather than shoots.
export const MIST_PARTICLE_SPEED_MIN = 6;
export const MIST_PARTICLE_SPEED_MAX = 14;
// Particle alpha lifecycle: spawn faint, fade to invisible. Starting below 1
// keeps individual particles from punching through the dim backgrounds too
// hard, reinforcing the "wisp" feel.
export const MIST_PARTICLE_ALPHA_START = 0.55;
export const MIST_PARTICLE_ALPHA_END = 0;
// Slight scale-up over lifespan to feel like dissipating vapor.
export const MIST_PARTICLE_SCALE_START = 0.7;
export const MIST_PARTICLE_SCALE_END = 1.4;
// Emission area around the orb's anchor (source px). Particles spawn within
// this radius of the orb's position, so the mist appears to surround it rather
// than fountain out of a single point.
export const MIST_PARTICLE_EMIT_RADIUS_PX = 4;

// World-drop physics body. Smaller than the 16x16 sprite frame so the drop
// nestles into floor corners and the player's 16x24 body easily overlaps it
// walking past.
export const AMMO_DROP_BODY_WIDTH_PX = 10;
export const AMMO_DROP_BODY_HEIGHT_PX = 10;
// Sprite scale applied on top of the 16x16 source frame. 0.5 renders the icon
// at ~8 source px (24 canvas px at zoom 3), readable but not tile-sized.
export const AMMO_DROP_DISPLAY_SCALE = 0.5;
// Initial pop on spawn. Negative Y is upward; X gets a uniform ±jitter so a
// chest dropping two pickups doesn't stack them perfectly.
export const AMMO_DROP_SPAWN_VELOCITY_Y = -100;
export const AMMO_DROP_SPAWN_VELOCITY_X_JITTER = 30;
// Linear X drag (px/s²). Arcade Physics has no surface friction, so without
// drag the spawn-jitter X velocity persists indefinitely and the drop slides
// along the floor forever. 400 stops a 30 px/s slide in ~0.08s — the drop
// settles where it lands without a visible glide.
export const AMMO_DROP_DRAG_X = 400;
// Drops despawn after this window to avoid littering arenas where the player
// over-farmed; 30s is enough to retrace a few rooms but not whole zones.
export const AMMO_DROP_LIFETIME_MS = 30_000;
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

// Render depth for the player and other dynamic entities (enemies, projectiles,
// traps, drops). Most tile layers occupy depth 0..N (back→front) by their LDtk
// layer position and sit BELOW this, so entities render in front of the ground
// and background. The exception is the foreground overlay band below: tile
// layers authored ABOVE the Entities layer in LDtk are lifted past this depth
// so they occlude entities (the player passes behind them).
export const ENTITY_DEPTH = 100;
// Player renders one step above other entities so decoration sprites
// (Tech_shop_spawn, Mushroom_merchant, etc.) never occlude the player when
// they overlap. Without this the player and entities tie at ENTITY_DEPTH and
// Phaser falls back to display-list insertion order, which depends on LDtk
// entity processing order and put the shop in front.
export const PLAYER_DEPTH = ENTITY_DEPTH + 1;

// Foreground overlay depth band — sits between the entity bodies above and the
// world-space UI band (ENEMY_HEALTH_BAR_DEPTH and friends) below. The LDtk
// stack places the Entities layer BENEATH Foreground2 and Foreground3, so those
// two tile layers are meant to render IN FRONT of the player and enemies
// (foreground pillars, hanging roots, etc. the player walks behind). But
// dynamic entities use the fixed ENTITY_DEPTH above, which outranks every tile
// layer's natural 0..N depth — so without this lift the foreground renders
// wrongly behind the player. LevelRenderer maps these identifiers to the depths
// here instead of their natural layer depth. Foreground1 is deliberately NOT
// listed: it's authored below the Entities layer, so entities correctly render
// in front of it. Values preserve the LDtk front-to-back order (Foreground3 is
// front-most, so it sits above Foreground2) and stay below the UI band so
// health bars and prompts remain readable over foreground tiles.
const FOREGROUND_OVERLAY_BASE_DEPTH = ENTITY_DEPTH + 10;
export const FOREGROUND_OVERLAY_LAYER_DEPTHS: Readonly<Record<string, number>> = {
  Foreground2: FOREGROUND_OVERLAY_BASE_DEPTH,
  Foreground3: FOREGROUND_OVERLAY_BASE_DEPTH + 1,
};

// Global multiplier applied to every non-boss enemy's authored
// behavior.health to set its effective max HP (Enemy computes
// round(health × this) at construction). A single knob to make regular
// fights tougher without re-tuning all ~40 registry entries. Bosses
// (behavior.isBoss) are exempt — their health is hand-tuned around the
// round-fight thresholds. Set to 1 to disable the bump.
export const ENEMY_HEALTH_MULTIPLIER = 1.5;

// Time window (ms) an enemy stays "in combat" after its last player-dealt
// damage. Once the window lapses, HP snaps back to its max and the floating
// health bar hides. Trap/fall damage does not refresh the timer.
export const ENEMY_COMBAT_TIMEOUT_MS = 20_000;

// Respawn is gated on BOTH a time cooldown and a travel distance: a killed
// non-boss enemy comes back only once at least ENEMY_RESPAWN_MIN_TIME_MS has
// elapsed since its death AND the player is at least
// ENEMY_RESPAWN_MIN_DISTANCE_PX (source px) from the enemy's original spawn
// point. Whichever gate clears last wins, so the two compound into a strictly
// less-frequent respawn. Bosses (behavior.isBoss === true) opt out entirely.
//
// Distance ~3600 px ≈ eight screens at the 28-tile-wide view (gridSize 16,
// CAMERA_ZOOM 3): you must clearly leave the region, not just step into the
// next room. The manager compares squared distance, so there is no sqrt per
// scan. Keep this comfortably above the on-screen half-extent (~225 px) so a
// respawn can never materialize within view. Tradeoff: in a small/enclosed
// area where the player can't get this far, those enemies effectively never
// respawn — lower it if that proves too strict.
export const ENEMY_RESPAWN_MIN_DISTANCE_PX = 3600;
// Minimum time (ms) after death before a killed non-boss enemy is eligible to
// respawn, enforced together with ENEMY_RESPAWN_MIN_DISTANCE_PX. Five minutes
// keeps a cleared area cleared even if the player sprints out of range —
// without a time floor, crossing the distance threshold quickly made enemies
// feel like they returned instantly.
export const ENEMY_RESPAWN_MIN_TIME_MS = 300_000;
// Throttle (ms) for the respawn manager's per-tick scan. 1Hz is enough to
// notice the threshold within a perceptible window without burning CPU on a
// per-frame Map iteration that almost always returns "not yet".
export const ENEMY_RESPAWN_CHECK_INTERVAL_MS = 1000;
// Floating health-bar visuals. Width sized so the bar reads cleanly above
// small bandit-sized bodies (~16-32 px wide) and doesn't overpower tall boss
// frames; height kept thin so the bar feels like UI overlay rather than part
// of the sprite. Source pixels — camera zoom scales the final visible size.
export const ENEMY_HEALTH_BAR_WIDTH_PX = 24;
export const ENEMY_HEALTH_BAR_HEIGHT_PX = 3;
// Gap (source px) between body.top and the bar's bottom edge. Just enough to
// keep the bar clear of the sprite outline.
export const ENEMY_HEALTH_BAR_OFFSET_Y_PX = 6;
export const ENEMY_HEALTH_BAR_FG_COLOR = 0xff3333;
export const ENEMY_HEALTH_BAR_BG_COLOR = 0x000000;
export const ENEMY_HEALTH_BAR_BG_ALPHA = 0.7;
export const ENEMY_HEALTH_BAR_OUTLINE_COLOR = 0x000000;
// Sits above the player AND the foreground overlay band so a health bar stays
// legible whether its enemy jumps in front of the player or stands behind a
// foreground tile layer. The interaction icon, save toast, and key-door message
// all chain off this, so the whole world-space UI band rides above the
// foreground overlay and stays readable over foreground tiles.
export const ENEMY_HEALTH_BAR_DEPTH = FOREGROUND_OVERLAY_BASE_DEPTH + 10;

// ── Stealth / enemy detection ───────────────────────────────────────────
// A stealth-enabled enemy spots the player within a detection radius AND inside
// its forward vision cone (it faces left/right, so a turned back is a blind
// spot), with a clear line — no collision tile between them.
//
// Default sight range (world px). Used when an entity authors no
// behavior.detectionRange and has no chaseRange to derive one from. ~14 tiles.
export const ENEMY_DETECTION_RANGE_PX = 220;
// Half-angle (degrees) of the forward vision cone — the player is spotted just
// inside ±this of the facing direction. 55° ≈ a 110° frontal cone. Per-enemy
// override: behavior.visionHalfAngleDeg.
export const ENEMY_VISION_HALF_ANGLE_DEG = 55;
// Point-blank radius (world px) inside which an enemy notices the player
// regardless of facing — you can't stand on its head undetected. Evaluated
// below the cone test, so a player pressed against the enemy is always seen.
export const ENEMY_VISION_NEAR_RADIUS_PX = 26;
// Stop-and-investigate telegraph: ms a freshly-spotting enemy holds still
// (showing the yellow "?") before it rushes to investigate. The readable "stop,
// then rush" beat — long enough to notice, short enough to feel reactive.
export const ENEMY_SPOT_STOP_MS = 500;
// Active-combat window: ms after an attack / contact hit during which the enemy
// reads as "conflict" (red "!") rather than merely "investigating" (yellow
// "?"). Refreshed on each blow, so a sustained fight stays red and only relaxes
// to yellow once the enemy stops landing hits. Keeps the red state off mere
// approach so enemies don't snap straight to "!".
export const ENEMY_CONFLICT_WINDOW_MS = 1500;
// On-the-hunt chase speed multiplier applied on top of an enemy's moveSpeed once
// it has detected the player, so the hunt visibly quickens versus its walk.
// Bosses are exempt (movement is hand-tuned). Per-enemy override:
// behavior.alertSpeedMul.
export const ENEMY_ALERT_SPEED_MUL = 1.25;
// Search-after-losing-sight: how long (ms) an enemy hunts the player's
// last-seen spot — walking to it, then scanning — before giving up and
// returning to its post. Capped by the aggro window (ENEMY_COMBAT_TIMEOUT_MS).
export const ENEMY_SEARCH_LOOK_MS = 2500;
// Cadence (ms) at which a searching enemy flips to face the other way while
// scanning its last-seen area ("looks around").
export const ENEMY_SEARCH_FLIP_MS = 600;
// Distance (world px) within which a searching/returning enemy counts as having
// reached its last-seen or post target and advances to the next behavior.
export const ENEMY_SEARCH_REACH_DIST_PX = 20;
// Sound id (soundRegistry) for the one-shot detection sting played the instant
// an enemy spots the player. A no-op when the id isn't registered (playOneShot
// returns null), so the system runs fine until an asset is wired in.
export const ENEMY_ALERT_STING_SOUND_ID = 'enemy_alert';

// Transient overhead "?"/"!" glyph painted above an enemy's head, mirroring the
// health-bar band. One step above the bar so the two stack cleanly.
export const ENEMY_ALERT_ICON_DEPTH = ENEMY_HEALTH_BAR_DEPTH + 2;
// Gap (source px) between body.top and the bottom of the glyph. Larger than the
// health bar's gap so the glyph clears the bar when both are visible.
export const ENEMY_ALERT_ICON_OFFSET_Y_PX = 13;
// Glyph height (source px) → font size; camera zoom scales the visible size.
export const ENEMY_ALERT_ICON_HEIGHT_PX = 9;
// How long (ms) a flashed glyph stays up before auto-hiding. The "?"/"!" are
// momentary tells, not persistent labels — they pop on an escalation then clear
// even while the enemy stays aware (the HUD corners are the lasting readout).
export const ENEMY_ALERT_ICON_HOLD_MS = 1200;
// Investigating = amber "?", conflict = red "!". Red matches the health-bar
// crimson so "spotted" reads as danger.
export const ENEMY_ALERT_ICON_SUSPECT_COLOR = 0xffd23f;
export const ENEMY_ALERT_ICON_DETECT_COLOR = 0xff3b30;

// Player HUD: now a DOM/HTML overlay (src/ui/PlayerHudOverlay.ts) styled in
// src/ui/playerHud.css, so its layout and typography live in CSS rather than
// here. Only the depth anchor remains — the boss HUD (still canvas-rendered)
// stacks BOSS_HUD_DEPTH / BOSS_BANNER_DEPTH relative to it, and the value sits
// above every gameplay object including enemy health bars.
export const PLAYER_HUD_DEPTH = 10_000;

// ── Boss round-fight system ─────────────────────────────────────────────
// The round/section count (BOSS_ROUND_COUNT) lives in entities/bossRounds.ts
// next to the pure round math; the presentation + timing constants below
// live here.
// How long the boss freezes + is invulnerable while the "Round N" banner
// plays on each round transition. The banner's fade-in + hold + fade-out
// below sum to this so the boss resumes exactly as the banner clears.
export const BOSS_ROUND_BREAK_MS = 1200;

// ── Boss round-fight reinforcements ─────────────────────────────────────
// LDtk marker entity identifier whose placed instances mark where a round-
// fight boss's reinforcement waves spawn. The markers carry no game logic
// (no factory) — GameScene reads their world positions at world-build time
// and the LevelRenderer skips drawing them. Place them on the arena floor.
export const GENERAL_ENEMY_SPAWN_IDENTIFIER = 'General_enemy_spawn';
// LDtk entity identifier for the player's spawn marker. buildWorld keeps only
// the one in STARTING_LEVEL_IDENTIFIER, so test markers placed in other levels
// are ignored rather than tripping the "multiple players" guard in spawnEntities.
export const PLAYER_SPAWN_IDENTIFIER = 'Sword_master_spawn';
// Fallback reinforcement roster, used for any round-fight boss/round NOT listed
// in src/entities/bossWaves.ts (the per-boss source of truth). Registry
// identifier of the enemy spawned at each marker per wave.
export const BOSS_ROUND_REINFORCEMENT_IDENTIFIER = 'Ghoul_spawn';
// Fallback count: how many reinforcements spawn at each marker per wave when the
// boss/round has no explicit roster in bossWaves.ts.
export const BOSS_ROUND_REINFORCEMENTS_PER_SITE = 2;
// First round whose start triggers a reinforcement wave. Round 1 is the
// arena's pre-placed enemies; waves begin at round 2 so each threshold the
// player crosses brings fresh pressure.
export const BOSS_ROUND_FIRST_REINFORCED_ROUND = 2;
// Horizontal spacing (world px) between the multiple reinforcements spawned
// at one marker so they don't materialize stacked on the same pixel.
export const REINFORCEMENT_SPAWN_SPACING_PX = 18;
// How far (world px) above the projected floor a reinforcement is placed at
// spawn. Small, so it settles onto the floor in a frame or two without the
// fall registering as fall damage even when its marker sits high in the arena.
export const REINFORCEMENT_SPAWN_LIFT_PX = 20;
// Delay (ms) between one spawn site's wave and the next when a round's
// reinforcements go out. Enemies at a single site still all appear together;
// only the sites are staggered, so a round doesn't dump the whole arena's
// reinforcements in one frame.
export const REINFORCEMENT_SITE_STAGGER_MS = 350;

// ── Boss self-copies (round-fight "split" mechanic) ─────────────────────
// Some round-fight bosses split on a later round into harmless copies of
// themselves (see src/entities/bossSelfCopies.ts and
// GameScene.spawnBossSelfCopies). The copies inherit the boss's animations,
// attacks, and AI but deal no damage and use a hand-set low max HP.
// The Heart Hoarder's round-3 copies' max HP (the boss itself has 700). Kept
// low so a copy reads as a regular enemy — a few hits with its floating bar
// visible — rather than a damage sponge.
export const HEART_HOARDER_COPY_HEALTH = 40;
// Horizontal distance (world px) between adjacent self-copy slots when a boss
// splits, so the copies flank the boss instead of overlapping it.
export const BOSS_SELF_COPY_SPAWN_OFFSET_PX = 90;
// Horizontal stand-off (world px) each self-copy holds from the player while
// converging. Without it every horizontal-movement-only copy homes to the exact
// same player.x and the whole family collapses into one visual blob; with it
// each copy parks on its own X slot beside the player. Slightly wider than the
// spawn offset so the oversized hoarder frames stay clearly distinct.
export const BOSS_SELF_COPY_CHASE_STANDOFF_PX = 110;
// Settle band (world px) around a horizontal-chase target: once the enemy is
// this close to its target X it parks (velocityX = 0) instead of flip-flopping
// Math.sign(dx) every frame, which would jitter a copy sitting on its slot.
export const HORIZONTAL_CHASE_STANDOFF_DEADZONE_PX = 10;
// Lateral separation for grouped self-copies (heart hoarder family). The chase
// stand-off slots only spread members during an active chase; teleport landings,
// arena-edge slot clamping, and the zero-velocity attack/recover/idle states can
// still leave two hoarders overlapping. Each frame a member within MIN_DX of
// another nudges away on X by up to PUSH_SPEED px so the family never collapses
// into one sprite. MIN_DX is a touch wider than the 48 px body so a small gap
// shows between them; PUSH_SPEED is small so it polishes spacing without fighting
// the stand-off slots or reading as a shove.
export const HOARDER_SEPARATION_MIN_DX_PX = 64;
export const HOARDER_SEPARATION_PUSH_SPEED = 2.5;

// Screen-wide boss health bar pinned to the top of the viewport. Like
// PlayerHud, positions/sizes are authored in SCREEN px and converted to world
// space at CAMERA_ZOOM each frame, so these read as on-screen pixels.
// Distance from the viewport top to the boss NAME (the bar sits below it).
export const BOSS_BAR_TOP_MARGIN_PX = 12;
// Bar width as a fraction of the viewport width (centered horizontally).
export const BOSS_BAR_WIDTH_FRACTION = 0.6;
export const BOSS_BAR_HEIGHT_PX = 8;
// Gap between the name's bottom and the bar's top.
export const BOSS_BAR_NAME_GAP_PX = 3;
export const BOSS_BAR_BG_COLOR = 0x1a0d0d;
export const BOSS_BAR_BG_ALPHA = 0.85;
export const BOSS_BAR_FRAME_COLOR = 0xffffff;
export const BOSS_BAR_FRAME_STROKE_PX = 1;
// Section dividers drawn at each 1/BOSS_ROUND_COUNT mark.
export const BOSS_BAR_DIVIDER_COLOR = 0x000000;
export const BOSS_BAR_DIVIDER_WIDTH_PX = 1;
// Fill color per round (index 0 = round 1). Crimson → amber → blood-red, so
// the bar visibly shifts as the player breaks each section.
export const BOSS_BAR_ROUND_COLORS: ReadonlyArray<number> = [
  0xc81e1e, 0xe0860d, 0x7a0a0a,
];
export const BOSS_BAR_NAME_FONT_SIZE_PX = 7;
export const BOSS_BAR_NAME_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const BOSS_BAR_NAME_COLOR = '#f5e6c8';

// "Round N" banner — big centered text that fades in, holds, and fades out.
// Uses the apocalyptic Nosifer display face (self-hosted via @font-face in
// index.html) to match the landing title and options headers. Single-weight
// font, so weight stays 'normal' — fake-bold would smear the dripping glyphs.
export const BOSS_BANNER_FONT_SIZE_PX = 20;
export const BOSS_BANNER_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const BOSS_BANNER_FONT_WEIGHT = 'normal';
export const BOSS_BANNER_COLOR = '#f5e6c8';
export const BOSS_BANNER_STROKE_COLOR = '#3a0a0a';
export const BOSS_BANNER_STROKE_PX = 2;
// Vertical placement as a fraction of viewport height (above center so it
// doesn't cover the player during the fight).
export const BOSS_BANNER_VIEWPORT_FRACTION_Y = 0.34;
// Lifecycle timings (sum == BOSS_ROUND_BREAK_MS).
export const BOSS_BANNER_FADE_IN_MS = 200;
export const BOSS_BANNER_HOLD_MS = 700;
export const BOSS_BANNER_FADE_OUT_MS = 300;
// Depths: above the player HUD so the boss UI always reads on top; the
// banner sits above the bar.
export const BOSS_HUD_DEPTH = PLAYER_HUD_DEPTH + 10;
export const BOSS_BANNER_DEPTH = PLAYER_HUD_DEPTH + 11;

// ── Leaving the combat zone (boss-fight escape) ──────────────────────────
// When the player crosses out of a boss's arena mid-fight, a centered warning
// + countdown appears; if they don't return before the grace window lapses the
// fight resets (boss home at full HP, reinforcements despawn, enemies break
// off). Screen-pinned and CAMERA_ZOOM-resolved like the rest of the boss UI.
export const BOSS_ESCAPE_GRACE_MS = 3000;
export const BOSS_ESCAPE_WARNING_TEXT = 'LEAVING COMBAT ZONE';
export const BOSS_ESCAPE_SUBTEXT = 'Return to continue the fight';
// Headline reuses the Nosifer display face so the escape moment shares the
// round banner's visual language; single-weight font, so no fake-bold.
export const BOSS_ESCAPE_WARNING_FONT_SIZE_PX = 14;
export const BOSS_ESCAPE_WARNING_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const BOSS_ESCAPE_WARNING_COLOR = '#f3d27a';
export const BOSS_ESCAPE_WARNING_STROKE_COLOR = '#3a0a0a';
export const BOSS_ESCAPE_WARNING_STROKE_PX = 2;
// Countdown digit sits below the headline — larger so it reads as the urgent
// element.
export const BOSS_ESCAPE_COUNTDOWN_FONT_SIZE_PX = 28;
export const BOSS_ESCAPE_COUNTDOWN_COLOR = '#ffffff';
// Hint line below the counter.
export const BOSS_ESCAPE_SUBTEXT_FONT_SIZE_PX = 7;
export const BOSS_ESCAPE_SUBTEXT_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const BOSS_ESCAPE_SUBTEXT_COLOR = '#d8c4a0';
// Vertical anchor as a fraction of viewport height — a touch above center so it
// doesn't sit on the player while they flee.
export const BOSS_ESCAPE_VIEWPORT_FRACTION_Y = 0.4;
// Screen-px gap between the three stacked lines.
export const BOSS_ESCAPE_LINE_GAP_PX = 4;
// Fade-in when the warning first appears (it snaps off on cancel/reset).
export const BOSS_ESCAPE_FADE_IN_MS = 150;
// Above the round banner so the warning always reads on top of the boss UI.
export const BOSS_ESCAPE_DEPTH = BOSS_BANNER_DEPTH + 1;

// Default proximity range (source px) at which an interactable advertises its
// E icon. Chests are small (14-22 px wide bodies) — at 36 px the icon appears
// about one body-width before the player would naturally bump the chest, so
// the prompt reads as "you're close" rather than "you're already there".
// Squared form is consumed by InteractionManager; recompute when changing.
export const INTERACTION_RANGE_PX = 36;
export const INTERACTION_RANGE_SQ = INTERACTION_RANGE_PX * INTERACTION_RANGE_PX;

// Hold time (ms) to commit an interaction. 500 ms is short enough to feel
// responsive on a chest but long enough to defeat accidental brushes against
// the E key while running.
export const INTERACTION_HOLD_DURATION_MS = 500;

// E icon dimensions (source px). Sized to sit beside chests without
// overlapping the lid; at CAMERA_ZOOM=3 a 9 px box renders ~27 canvas px.
export const INTERACTION_ICON_SIZE_PX = 9;
// Source-px gap above the interactable's anchor point. Stacks the icon
// clear of the closed chest lid (chest1 is 19 px tall, body top sits a few
// px above world center) with a small breathing margin.
export const INTERACTION_ICON_OFFSET_Y_PX = 6;
// Visual styling. The black border was removed in favor of the progress
// outline being the sole framing element while held.
export const INTERACTION_ICON_BG_COLOR = 0xffffff;
export const INTERACTION_ICON_LETTER_COLOR = '#000000';
// Authored at 2× the visible size so the source canvas has enough resolution
// for LINEAR filtering to anti-alias the glyph. Combined with
// INTERACTION_ICON_LETTER_SCALE the on-screen letter ends up the same visual
// size as the prior 7px monospace render but with smooth edges.
export const INTERACTION_ICON_FONT_SIZE_PX = 14;
export const INTERACTION_ICON_LETTER_SCALE = 0.5;
// Sans-serif stack rasterizes smoother than monospace at small sizes and
// keeps the glyph readable across OSes (Arial on Win/macOS, Helvetica on
// macOS, the platform sans-serif fallback elsewhere).
export const INTERACTION_ICON_FONT_FAMILY = 'Arial, Helvetica, sans-serif';

// Progress outline drawn around the box while E is held. Cyan reads as
// "active" against the white box and isn't claimed by any other UI element
// in this project (HP red, MAG dark-red, STA teal — none of them cyan).
export const INTERACTION_ICON_PROGRESS_COLOR = 0x66ddff;
export const INTERACTION_ICON_PROGRESS_STROKE_PX = 1;
// Gap between the icon's box edge and the progress outline (source px).
// Keeps the outline from visually merging with the white background.
export const INTERACTION_ICON_PROGRESS_EDGE_OFFSET_PX = 2;

// Alpha lerp rate (per ms) for icon fade in/out. 1/120 ≈ ~120 ms to fully
// fade — quick enough that walking past a chest doesn't leave the icon
// hovering, slow enough to read as a deliberate UI element rather than a
// pop. Manager does its own approach() per frame; no tweens (HMR-safe).
export const INTERACTION_ICON_FADE_RATE = 1 / 120;

// Renders one step above enemy health bars so the icon is always legible
// when standing next to an enemy that happens to be next to an interactable.
export const INTERACTION_ICON_DEPTH = ENEMY_HEALTH_BAR_DEPTH + 1;

// Emitted by a Save crystal when the player commits its hold-E interaction.
// GameScene listens on its own scene event bus (not on the Player) so the
// listener is scoped to the world build/teardown lifecycle. Payload is the
// Save instance so the scene can place the "Game Saved" toast above the
// specific crystal that was interacted with.
export const SAVE_REQUESTED_EVENT = 'save-requested';

// Floating "Game Saved" text shown above a Save crystal on successful save.
// Source-px font size — the toast text uses CAMERA_ZOOM resolution like the
// HUD so it stays crisp at zoom. Lifespan is the total time before destroy;
// alpha tweens from 1 to 0 over the same window for a smooth fade-out.
export const SAVE_TOAST_TEXT = 'Game Saved';
export const SAVE_TOAST_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const SAVE_TOAST_FONT_SIZE_PX = 6;
export const SAVE_TOAST_COLOR = '#ffffff';
export const SAVE_TOAST_DURATION_MS = 1500;
// Source-px gap above the crystal's body.top so the text floats clear of the
// sprite silhouette.
export const SAVE_TOAST_OFFSET_Y_PX = 12;
// Source-px upward drift over the toast's lifetime — gentle "rises and fades"
// motion rather than a static pop.
export const SAVE_TOAST_RISE_PX = 6;
// Renders above the interaction icon so a toast spawned while another save
// is in proximity still reads cleanly.
export const SAVE_TOAST_DEPTH = INTERACTION_ICON_DEPTH + 1;

// ── Boss-key progression system ──────────────────────────────────────────
//
// The game is won by defeating all three bosses. Two of them (Shadow of Storms,
// The Tarnished Widow) drop a key on death that unlocks a specific key-locked
// door; the third (The Heart Hoarder) drops no key but must be defeated to win.
// Run progress (collected keys, defeated bosses) lives in src/state/runProgress
// so it survives death/respawn — bosses don't auto-respawn, so a key lost on
// death would otherwise soft-lock the run.

// Identifiers of the bosses that must all be defeated to win. Order is
// irrelevant — the win check is "every one of these is in the defeated set".
export const REQUIRED_BOSS_IDENTIFIERS = [
  'Shadow_of_storms_spawn',
  'The_tarnished_widow_spawn',
  'The_heart_hoarder_spawn',
] as const;

// The final boss. Its defeat ends the run and triggers the victory screen on
// its own — it's reached only after the other two (behind their key-locked
// doors), so killing it is the win, no separate all-bosses check required.
export const FINAL_BOSS_IDENTIFIER = 'The_heart_hoarder_spawn';

// Maps a key-locked door's LDtk level identifier to the pickup kind that opens
// it. A Door spawned in one of these levels is created locked and only opens on
// a hold-E interaction once the player holds the matching key; every other door
// keeps the default proximity auto-open behavior. Each of these levels contains
// exactly one door (verified against the_beneath.ldtk). The values mirror the
// PickupKind string literals (kept inline rather than imported to avoid a
// constants→Player import cycle).
export const LOCKED_DOOR_KEYS: Readonly<Record<string, 'key_storms' | 'key_widow'>> = {
  Level_6: 'key_storms',
  Level_12: 'key_widow',
};

// Maps a boss's LDtk identifier to the key its defeat grants. On defeat the key
// is recorded in run-progress directly (in addition to the physical key the boss
// still drops) so the matching key-locked door stays openable even if the player
// dies before walking over the drop — defeated bosses never respawn, so that
// dropped key would otherwise be the run's only copy. Bosses with no entry (The
// Heart Hoarder) grant no key.
export const BOSS_KEYS: Readonly<Record<string, 'key_storms' | 'key_widow'>> = {
  Shadow_of_storms_spawn: 'key_storms',
  The_tarnished_widow_spawn: 'key_widow',
};

// Emitted on the GameScene event bus by Enemy.enterDeadState when a boss dies,
// with the boss's LDtk identifier as payload. GameScene records the defeat and
// fires the victory flow once all REQUIRED_BOSS_IDENTIFIERS are down.
export const BOSS_DEFEATED_EVENT = 'boss-defeated';

// Emitted on the GameScene event bus by a key-locked Door when the player
// completes a hold-E without the matching key. GameScene shows the fade message.
export const KEY_DOOR_LOCKED_EVENT = 'key-door-locked';

// Source-px gap above a key-locked door's body.top for the E icon anchor —
// mirrors Chest's ICON_ANCHOR_GAP_PX so the prompt floats clear of the lintel.
export const KEY_DOOR_ICON_ANCHOR_GAP_PX = 2;
// Slightly wider interaction range than the default (door bodies are 21×24 and
// the player stands flush against the solid leaf) so the E prompt reliably
// appears when the player is pressed up to the locked door.
export const KEY_DOOR_INTERACTION_RANGE_PX = 44;
export const KEY_DOOR_INTERACTION_RANGE_SQ =
  KEY_DOOR_INTERACTION_RANGE_PX * KEY_DOOR_INTERACTION_RANGE_PX;

// Bottom-of-screen fade message shown when the player tries a locked door
// without its key. World-anchored to the camera's view (like SAVE_TOAST) and
// rendered at CAMERA_ZOOM resolution so it stays crisp; fades in, holds, fades
// out, then destroys.
export const KEY_DOOR_MESSAGE_TEXT = 'You must find the key to open this door';
export const KEY_DOOR_MESSAGE_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const KEY_DOOR_MESSAGE_FONT_SIZE_PX = 7;
export const KEY_DOOR_MESSAGE_COLOR = '#ffffff';
// Source-px gap from the camera view's bottom edge so the line sits just inside
// the frame rather than flush against it.
export const KEY_DOOR_MESSAGE_BOTTOM_MARGIN_PX = 18;
export const KEY_DOOR_MESSAGE_FADE_IN_MS = 200;
export const KEY_DOOR_MESSAGE_HOLD_MS = 1500;
export const KEY_DOOR_MESSAGE_FADE_OUT_MS = 400;
export const KEY_DOOR_MESSAGE_DEPTH = SAVE_TOAST_DEPTH + 1;

// ── Victory screen ───────────────────────────────────────────────────────
// Shown (full-screen, over the frozen game) when the final boss (the Heart
// Hoarder) dies: the screen fades to solid black, "YOU WON" reveals in big
// white letters, and after a short hold the run returns to the home/title page
// (a click / Enter / Space skips the wait).
export const VICTORY_DIM_COLOR = 0x000000;
// Solid black — the win screen fully hides the frozen world behind it.
export const VICTORY_DIM_ALPHA = 1;
// Beat held between the final boss's death (which also clears its arena, so
// every other enemy in the level dies at the same moment) and the victory flow
// freezing the world to fade to black. Without it the screen would cut to black
// on the same frame the boss/adds start dying, so their death animations are
// never seen. The actual hold is derived from the boss's death-animation length
// at runtime (see GameScene.onBossDefeated) so it always covers the full clip;
// this constant is only the fallback used when that duration can't be resolved.
export const VICTORY_DELAY_MS = 3000;
// The boss reaps its own corpse the instant its death animation completes
// (Enemy.onAnimComplete → destroy). So the victory flow freezes the world this
// many ms BEFORE that completion — the boss stays visible on a late death frame
// under the win fade instead of the screen cutting to black over an empty arena.
// ~2.5 frames at the 12fps character rate: enough margin that the freeze always
// wins the race against the self-reap, while the near-final pose reads as done.
export const VICTORY_FREEZE_MARGIN_MS = 200;
export const VICTORY_FADE_IN_MS = 900;
// How long "YOU WON" holds on the black screen before auto-returning home.
export const VICTORY_HOLD_MS = 2500;
export const VICTORY_TITLE_TEXT = 'YOU WON';
export const VICTORY_TITLE_COLOR = '#ffffff';
export const VICTORY_TITLE_FONT_SIZE_PX = 64;
// Centered vertically on the black screen.
export const VICTORY_TITLE_VIEWPORT_FRACTION_Y = 0.5;

// Pause menu. Lives in its own scene (SCENE_KEYS.PAUSE) launched on top of
// GameScene via scene.launch + scene.pause — the idiomatic Phaser pause
// pattern halts physics, tweens, timers, and update() in one call. Word
// sprites are loaded as plain PNGs with LINEAR filtering (matching
// InteractionIcon and the magic orb) so they render smoothly at zoom rather
// than nearest-sampled by the global pixelArt:true config.
export const PAUSE_CONTINUE_TEXTURE_KEY = 'pause_word_continue';
export const PAUSE_NEW_GAME_TEXTURE_KEY = 'pause_word_new_game';
export const PAUSE_OPTIONS_TEXTURE_KEY = 'pause_word_options';
export const PAUSE_QUIT_TEXTURE_KEY = 'pause_word_quit';
export const PAUSE_CONTINUE_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words1.png';
export const PAUSE_NEW_GAME_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words2.png';
export const PAUSE_OPTIONS_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words9.png';
export const PAUSE_QUIT_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words3.png';

// Full-viewport dim drawn under the menu. 0.5 alpha dims gameplay enough to
// pull focus to the menu while still letting the world read through.
export const PAUSE_DIM_COLOR = 0x000000;
export const PAUSE_DIM_ALPHA = 0.5;

// Source-pixel scale for the word sprites.
export const PAUSE_WORD_DISPLAY_SCALE = 1.5;
// Canvas-pixel gap between adjacent word sprites once rendered. The pause menu
// stacks them vertically, so this is the vertical spacing between each option.
export const PAUSE_WORD_GAP_PX = 32;

// Bounding box around the two word sprites. Drawn with Phaser.Graphics using
// the same lineStyle+strokeRect approach as PlayerHud.drawGroupFrame; "decor"
// is achieved with four small filled squares sitting just outside the outer
// stroke at each corner.
export const PAUSE_FRAME_COLOR = 0xffffff;
export const PAUSE_FRAME_STROKE_PX = 2;
export const PAUSE_FRAME_PADDING_PX = 16;
export const PAUSE_FRAME_CORNER_ACCENT_SIZE_PX = 4;
export const PAUSE_FRAME_CORNER_ACCENT_OFFSET_PX = 6;

// Selection tint. Selected = no tint (white passthrough); unselected dims
// the sprite via setTint. Default selection on open is Continue (index 0)
// so a reflex Enter keeps the player in the game.
export const PAUSE_SELECTED_TINT = 0xffffff;
export const PAUSE_UNSELECTED_TINT = 0x808080;

// Options panel, opened from the pause menu's OPTIONS button. Rendered as a DOM
// overlay that reuses the merchant shop's grey framed-panel idiom (see
// src/ui/OptionsOverlay + shop.css) so it reads as the same piece of in-world
// UI. Lists the game's controls and exposes a music on/off toggle. The toggle
// swaps between a speaker icon (music on) and a muted-speaker icon (music off);
// both ship in /public and are referenced as plain <img>, so unlike the pause
// word banners they need no Phaser texture preloading.
export const OPTIONS_SOUND_ON_ICON_PATH =
  '/DarkSpriteLib/general/ui/icons/ui_-_icons6.png';
export const OPTIONS_SOUND_OFF_ICON_PATH =
  '/DarkSpriteLib/general/ui/icons/ui_-_icons7.png';

// Menu / UI feedback sound ids. Registered in soundRegistry.json as
// non-spatial sfx one-shots and played via playOneShot from the menu scenes
// and the player. Shared here (rather than defined locally per scene) because
// each is referenced from more than one call site:
//   - UI_BUTTON_HOVER_SOUND_ID: a digital click that fires on pointer-over of
//     any menu button (landing START, pause Continue/Quit).
//   - UI_BOOM_SOUND_ID: a heavy low-impact stinger played when the player
//     commits to Start on the landing page and when the player dies.
export const UI_BUTTON_HOVER_SOUND_ID = 'button_hover';
export const UI_BOOM_SOUND_ID = 'boom_low_hit';

// Merchant shops. Tech_shop_spawn sells ammo; Mushroom_merchant_spawn sells
// magic orbs. The merchant entity emits SHOP_REQUESTED_EVENT on hold-E commit
// and GameScene shows a DOM-based ShopOverlay (src/ui/ShopOverlay) over the
// canvas. Payload is `{ kind: 'tech' | 'mushroom' }` so the overlay picks
// the right inventory.
export const SHOP_REQUESTED_EVENT = 'shop-requested';

// Per-item coin price. Tuned so a few cleared rooms (each enemy drops ≥1
// coin, chests 5, bosses 20) can fund a small restock without trivializing
// pickups. Gun2 charges more per shell because gun2 hits harder; magic orbs
// are the priciest because each orb refills one of only 3 magic bars.
export const SHOP_PRICE_GUN1_AMMO = 10;
export const SHOP_PRICE_GUN2_AMMO = 15;
export const SHOP_PRICE_MAGIC_ORB = 25;
// Healing heart: priced between an ammo pack and a magic orb. Each heart
// restores HEAL_ITEM_RESTORE_AMOUNT (25) health, so a full top-up from near
// death costs ~3-4 hearts — a meaningful coin sink without being punishing.
export const SHOP_PRICE_HEAL_ITEM = 20;

// Per-purchase grant. Aliased to the existing pickup amounts so buying a
// gun1 magazine grants the same N bullets as walking into a gun1 drop —
// keeps the value-per-unit consistent across drop and shop economies.
export const SHOP_GUN1_GRANT_PER_PURCHASE = AMMO_PICKUP_GUN1_AMOUNT;
export const SHOP_GUN2_GRANT_PER_PURCHASE = AMMO_PICKUP_GUN2_AMOUNT;
export const SHOP_MAGIC_GRANT_PER_PURCHASE = MAGIC_PICKUP_AMOUNT;
export const SHOP_HEAL_GRANT_PER_PURCHASE = HEAL_PICKUP_AMOUNT;

// ── Capacity upgrades (Ammo Storage / Orb Pouch) ─────────────────────────
// One-time purchases that permanently raise the player's carry cap, sold
// alongside the normal restock items. Each tech shop (Tech_shop_spawn) sells
// one Ammo Storage tier; each mushroom merchant (Mushroom_merchant_spawn) sells
// one Orb Pouch tier. The SELLING LEVEL is the identity of the upgrade — a given
// shop's tier can be bought exactly once — so these arrays list which levels
// sell a tier and the index-aligned price charged there (Level_9 cheapest,
// Level_18 priciest, since later tiers are reached with more coins in hand).
// Purchases are recorded in runProgress (so they survive death/respawn) and the
// COUNT of purchases per line drives the derived caps in Player; the specific
// tiers bought don't matter, so any visiting order works.
export const AMMO_UPGRADE_LEVELS: ReadonlyArray<string> = [
  'Level_9',
  'Level_11',
  'Level_18',
];
export const MAGIC_UPGRADE_LEVELS: ReadonlyArray<string> = [
  'Level_9',
  'Level_11',
  'Level_18',
];
export const AMMO_UPGRADE_PRICES: ReadonlyArray<number> = [30, 45, 60];
export const MAGIC_UPGRADE_PRICES: ReadonlyArray<number> = [30, 45, 60];

// Landing page. Shown on first boot via a LandingScene overlay launched on
// top of GameScene. The START word sprite uses the same word-banner pattern
// as PauseScene (LINEAR-filtered PNG inside a white bounding box). Clicking
// or pressing Enter/Space fades both cameras to black, hands off to
// GameScene.beginGameplay(), then fades back in.
export const LANDING_START_TEXTURE_KEY = 'landing_word_start';
export const LANDING_START_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words5.png';
export const LANDING_START_DISPLAY_SCALE = 1.5;
// Hover tint applied to the START sprite via setTint while the pointer
// is over it. Phaser multiplies the texture's RGB by the tint, so a gray
// value darkens uniformly without changing the silhouette. Cleared on
// pointer-out (clearTint) to restore full brightness.
export const LANDING_BUTTON_HOVER_TINT = 0x808080;
// Scale multipliers applied on top of LANDING_START_DISPLAY_SCALE for
// the hover (grow) and press (shrink) animations. HOVER eases the sprite
// outward when the pointer enters, PRESS yoyos a brief inward pulse on
// click/Enter/Space so the confirm feels physical even before the
// 600ms fade-out begins. TWEEN_MS is the duration of each half-cycle.
export const LANDING_BUTTON_HOVER_SCALE_MULTIPLIER = 1.05;
export const LANDING_BUTTON_PRESS_SCALE_MULTIPLIER = 0.92;
export const LANDING_BUTTON_TWEEN_MS = 120;

// Landing-page game title rendered above the START button. Defaults to
// the working title pulled from the project folder name; override
// LANDING_TITLE_TEXT if the project gets a final name. Centered on the
// same column as the START button so the two elements read as a single
// stacked composition. Y fraction places the title above the button
// (LANDING_BUTTON_VIEWPORT_FRACTION_Y) — keep some clearance between
// them or the title and button will visually merge.
export const LANDING_TITLE_TEXT = 'THE BENEATH';
// Internal family name of the self-hosted apocalyptic display face (declared
// via @font-face in index.html). Phaser rasterizes canvas Text synchronously
// at creation, so a font still downloading at that moment bakes in the
// fallback face. PreloadScene gates the game boot on the Font Loading API
// reporting THIS family ready (see bootGameWhenFontReady), and LandingScene
// re-renders the title against it as a fallback. Kept separate from
// LANDING_TITLE_FONT_FAMILY (which carries the fallback stack) so the Font
// Loading API is asked for exactly the family it should fetch.
export const DISPLAY_FONT_NAME = 'Nosifer';
// Hard cap on how long PreloadScene waits for DISPLAY_FONT_NAME before booting
// anyway, so a slow or failed font download can never hang startup. The woff2
// is a tiny (~15 KB) self-hosted latin subset, so this only matters on a cold
// cache or an outright load failure (then the title shows its fallback face).
export const FONT_BOOT_TIMEOUT_MS = 2000;
// Apocalyptic display font (self-hosted via @font-face in index.html). Falls
// back to Impact, then a generic display face, if the woff2 fails to load.
// Single-weight font, so the title renders at normal weight (fake-bold would
// smear the dripping glyphs).
export const LANDING_TITLE_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const LANDING_TITLE_FONT_SIZE_PX = 55;
export const LANDING_TITLE_FONT_WEIGHT = 'normal';
export const LANDING_TITLE_COLOR = '#ffffff';
export const LANDING_TITLE_VIEWPORT_FRACTION_Y = 0.18;

// Home-screen menu banners stacked beneath START: OPTIONS (opens the same
// OptionsOverlay the pause menu uses) and CREDITS (opens CreditsOverlay). The
// OPTIONS word reuses the pause menu's already-loaded PAUSE_OPTIONS texture;
// CREDITS loads its own banner (ui_-_words6 = the "CREDITS" word), LINEAR-
// filtered in PreloadScene like the other word banners.
export const LANDING_CREDITS_TEXTURE_KEY = 'landing_word_credits';
export const LANDING_CREDITS_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words6.png';
// OPTIONS + CREDITS render smaller than START so the primary action stays
// visually dominant; GAP_PX is the canvas-pixel gap between stacked banners.
export const LANDING_MENU_BUTTON_DISPLAY_SCALE = 1.0;
export const LANDING_MENU_BUTTON_GAP_PX = 22;

// Credits panel title (CreditsOverlay). Reuses the game name; the individual
// credit lines are presentation data defined alongside the overlay itself
// (mirroring OptionsOverlay's CATEGORIES).
export const CREDITS_TITLE_TEXT = LANDING_TITLE_TEXT;

// Fade durations for the click → black → gameplay transition. Matched in
// and out so the visible pulse feels symmetric.
export const LANDING_FADE_OUT_MS = 600;
export const LANDING_FADE_IN_MS = 600;
// Dwell on full black between the fade-out landing and the fade-in starting.
// gameplay is set up under the black at the start of this hold (ambience kicks
// in), then the world reveals once it elapses — a beat of darkness that makes
// the descent into the level feel more dramatic.
export const LANDING_BLACK_HOLD_MS = 1400;

// Viewport fractions for the landing-page layout. Player is anchored at 25%
// from the left of the screen; START button at BUTTON_FRACTION_X across and
// BUTTON_FRACTION_Y down. GameScene positions the camera (via centerOn) so
// the player lands on PLAYER_FRACTION_X; LandingScene positions the button
// at the BUTTON_FRACTION values on the overlay camera's canvas dimensions.
// Smaller BUTTON_FRACTION_Y = higher on screen.
export const LANDING_PLAYER_VIEWPORT_FRACTION_X = 0.25;
export const LANDING_BUTTON_VIEWPORT_FRACTION_X = 0.25;
export const LANDING_BUTTON_VIEWPORT_FRACTION_Y = 0.32;
// World-px shift applied to the landing camera's centerY on top of the
// spawn level's vertical midpoint. Positive = camera moves down in world
// space (the visible area shifts down, so anything anchored above —
// including the player — reads HIGHER on screen). Tune to compose the
// shot; 0 leaves the camera exactly at the level midpoint.
export const LANDING_CAMERA_Y_OFFSET_PX = 50;

// Screen-edge corner brackets. Each corner of the viewport gets a thin
// white L-shape (two perpendicular line segments meeting at the corner).
// No connecting strokes between corners — the brackets alone frame the
// shot without imposing a full rectangle. MARGIN_PX pulls the bracket
// vertices off the canvas edge so the lines aren't clipped; LENGTH_PX
// is the leg length of each L.
export const LANDING_SCREEN_FRAME_MARGIN_PX = 28;
export const LANDING_SCREEN_FRAME_COLOR = 0xffffff;
export const LANDING_SCREEN_FRAME_STROKE_PX = 2;
export const LANDING_SCREEN_BRACKET_LENGTH_PX = 72;

// Screen-edge vignette: four black gradient strips fading from opaque at
// the viewport edge to transparent at THICKNESS_PX inward, painted by the
// LandingScene above the world but below the START button and screen
// frame. Reads as soft darkening at the edges so the eye is drawn toward
// the player + button composition.
export const LANDING_VIGNETTE_COLOR = 0x000000;
export const LANDING_VIGNETTE_THICKNESS_PX = 380;
export const LANDING_VIGNETTE_EDGE_ALPHA = 0.8;

// Per-tileset brightness lift applied at preload (RGB multiplier on each
// opaque pixel, clamped to 255). Used to compensate for tilesets whose source
// art ships visibly darker than peers stacked in the same level. uid=2
// (The_beneath_tileset1) backs every level's Foreground2 layer; the average-
// luminance ratio against uid=4 is ~1.24, but the eye perceives brightness
// non-linearly so the visible match lands well below that — tuned by feel.
export const TILESET_BRIGHTNESS_FACTORS: Readonly<Record<number, number>> = {
  2: 1.1,
};

// Per-LAYER brightness lift applied at render time via an ADD-blended sibling
// overlay. Use this when a foreground decoration layer needs to read brighter
// than the IntGrid ground it sits on, but they share the same tileset uid so
// TILESET_BRIGHTNESS_FACTORS can't differentiate them (lifting the tileset
// would brighten the ground too). The value is the total multiplier — 1.10 =
// 10% brighter — and the renderer derives the overlay alpha as (factor - 1).
// Cost: one extra draw call per tile in the listed layer.
export const LAYER_BRIGHTNESS_FACTORS: Readonly<Record<string, number>> = {
  Foreground1: 1.1,
};

// Foreground bright-pixel glow. Each tileset used by a Foreground* layer gets
// a sibling "glow" texture pre-baked at preload: every source pixel whose
// luminance exceeds FOREGROUND_GLOW_LUMINANCE_THRESHOLD has a soft radial halo
// painted at its position in the glow atlas. LevelRenderer then draws a second
// Image per foreground tile from that atlas with ADD blend, so bright dots
// emit a halo while the surrounding tile pixels stay unchanged against the
// darker background art. Toggle this flag to disable the effect entirely (no
// bake, no extra draw calls).
export const FOREGROUND_GLOW_ENABLED = true;
// LDtk layer identifier prefix that opts a layer into the glow pass. Matches
// "Foreground1", "Foreground2", "Foreground3" in the_beneath.ldtk. Other
// tile layers (Parallax*, IntGrid, Background*) are unaffected.
export const FOREGROUND_GLOW_LAYER_PREFIX = 'Foreground';
// Suffix appended to a tileset's texture key to address its sibling glow
// atlas. GlowAtlasBaker writes the atlas under `${tilesetTextureKey(uid)}${SUFFIX}`;
// LevelRenderer reads from the same key. Keep them in sync.
export const FOREGROUND_GLOW_TEXTURE_SUFFIX = '_glow';
// Luminance threshold (0..1, Rec.601 weights) above which a source pixel is
// treated as "bright" and gets a halo. 0.85 catches near-white dots (stars,
// candle highlights, lamp cores) while leaving stone/grass mid-tones alone.
// Raise if too many incidental highlights glow; lower to catch dimmer dots.
export const FOREGROUND_GLOW_LUMINANCE_THRESHOLD = 0.78;
// Halo radius in *source* pixels. Camera zoom multiplies the on-screen
// radius — at CAMERA_ZOOM=3, RADIUS_PX=3 becomes 9 canvas px. Smaller =
// tighter pinpricks; larger = soft bloom. The atlas is LINEAR-filtered so
// the halo stays smooth at any zoom.
export const FOREGROUND_GLOW_RADIUS_PX = 3;
// Alpha at the very center of a halo (r=0). The radial falloff fades from
// this value to 0 across RADIUS_PX. Overlapping halos accumulate additively
// in the bake, so a tight cluster of bright pixels reads brighter than a
// single isolated dot without each individual halo punching through.
// Multiplied at runtime by the container's flicker alpha, so this is the
// peak brightness of a single isolated halo when the flicker is at its
// maximum — the visible average sits lower (see FLICKER_* below).
export const FOREGROUND_GLOW_CORE_ALPHA = 0.4;
// Falloff curve exponent. alpha(r) = CORE_ALPHA * (1 - r/RADIUS)^EXPONENT.
// 1 = linear, 2 = quadratic (softer center → harder edge), 0.5 = sqrt
// (bright plateau, fast outer fade). 1.6 reads as a smooth wisp rather than
// a hard ring or a foggy blob.
export const FOREGROUND_GLOW_FALLOFF_EXPONENT = 1.6;

// Flicker: each foreground glow container gets a yoyo'd alpha tween between
// MIN and MAX, with a random duration in [DURATION_MIN, DURATION_MAX] and a
// random initial delay so neighboring containers fall out of phase. Visual
// effect: the dots breathe like candlelight rather than glowing steadily.
// Since the glow images use BlendModes.ADD, multiplying the container alpha
// directly scales the additive contribution per pixel.
export const FOREGROUND_GLOW_FLICKER_MIN_ALPHA = 0.45;
export const FOREGROUND_GLOW_FLICKER_MAX_ALPHA = 1.0;
// Period range per yoyo half-cycle (ms). A full bright→dim→bright loop
// takes DURATION × 2. Short enough to read as flicker, long enough to feel
// organic rather than strobed. Per-container random sample within the range
// is paired with a per-container random initial delay so the overall world
// never has every dot pulsing in lockstep.
export const FOREGROUND_GLOW_FLICKER_DURATION_MIN_MS = 280;
export const FOREGROUND_GLOW_FLICKER_DURATION_MAX_MS = 720;

// Neon sign flicker. Sign entities whose identifier is registered in
// SignTextureBaker get split into two textures at first render — a static
// "structure" image (frame, mounts) and a "lit" overlay (the colored
// letters/icons). Only the lit overlay receives the flicker tween, so the
// frame stays visible while the light buzzes on/off. The tween is a chain
// of randomized pulses: each "burst" plays 1-N rapid on/off pulses, then
// holds at full brightness for a random idle interval, then loops. Both
// the burst size, each pulse duration, and the idle interval are sampled
// independently per cycle — no two cycles look identical, and no two sign
// instances share a schedule.
//
// Alpha at the bottom of a flicker pulse. 0 cuts the lit overlay entirely
// (true off — the structure carries the sign through the dark beat); a small
// non-zero residual would keep a faint ghost glow visible at all times.
export const SIGN_FLICKER_DIM_ALPHA = 0.0;
// One "burst" is a sequence of 1-N rapid dim/bright pulses, separated by
// longer idle periods at full brightness. Larger max → noisier/more-broken
// neon; smaller max → calmer single-pulse flickers. Sampled per cycle.
export const SIGN_FLICKER_BURST_SIZE_MIN = 1;
export const SIGN_FLICKER_BURST_SIZE_MAX = 4;
// Per-pulse duration range in ms (one alpha transition, e.g. bright→dim or
// dim→bright). Short = abrupt strobe; long = soft pulse. 18-90ms reads as
// a buzzing fluorescent. Sampled independently for every transition so a
// single burst contains a mix of fast and slow pulses.
export const SIGN_FLICKER_PULSE_DURATION_MIN_MS = 18;
export const SIGN_FLICKER_PULSE_DURATION_MAX_MS = 90;
// Idle hold at full brightness between bursts. Lower bound caps the max
// flicker frequency. Sampled per cycle so the pattern stays irregular —
// a steady period would read as a metronome rather than a faulty light.
export const SIGN_FLICKER_INTERVAL_MIN_MS = 250;
export const SIGN_FLICKER_INTERVAL_MAX_MS = 1400;

// Pulsate: smooth sine-eased yoyo between MIN and MAX alpha on a lit
// overlay. Used by lit decorations whose config.mode is 'pulsate' (e.g.
// the small teal window dots on House2..House5) — visually a slow,
// organic "breathing" glow rather than the abrupt sign flicker. MIN > 0
// keeps the light visible at all times (a true off would read as a
// flicker, not a pulsate).
export const SIGN_PULSATE_MIN_ALPHA = 0.25;
export const SIGN_PULSATE_MAX_ALPHA = 1.0;
// Half-cycle duration (ms). One full breath (dim → bright → dim) takes
// DURATION × 2. Random per-instance sample within this range so neighboring
// house lights drift apart in phase and period — without the variance, a
// city block reads as a single synchronized strobe. Wider range = stronger
// drift over time; narrower = more uniform breathing.
export const SIGN_PULSATE_DURATION_MIN_MS = 550;
export const SIGN_PULSATE_DURATION_MAX_MS = 1300;

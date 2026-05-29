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

// Ammo capacity and starting values. INITIAL == MAX so the player spawns with
// a full magazine. Gun2's smaller capacity reflects its heavier shells.
export const INITIAL_GUN1_AMMO = 30;
export const MAX_GUN1_AMMO = 30;
export const INITIAL_GUN2_AMMO = 10;
export const MAX_GUN2_AMMO = 10;
// Per-pickup grant. Gun2 grants fewer to compensate for the smaller magazine
// and to keep heavier ammo scarce.
export const AMMO_PICKUP_GUN1_AMOUNT = 5;
export const AMMO_PICKUP_GUN2_AMOUNT = 2;
// Ammo consumed per gunshot. Same for both guns — capacity differences
// already encode the relative scarcity.
export const AMMO_COST_PER_SHOT = 1;

// Magic resource: discrete 3-bar meter. Each magic sword swing costs one bar
// (MAGIC_COST_PER_SWING). No regen — refilled only by MAGIC_ORB pickups, which
// grant one bar per pickup. HUD renders this as three independent segments.
export const INITIAL_MAGIC = 3;
export const MAX_MAGIC = 3;
export const MAGIC_PICKUP_AMOUNT = 1;
export const MAGIC_COST_PER_SWING = 1;

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
//   Weakest mook (Ghoul) ............... 3
//   Regular enemy / bandit ............. 5
//   Small chest (Chest1) ............... 10
//   Large chest (Chest2) ............... 20
//   Boss ............................... 50
// Against shop prices (gun1 pack 10, gun2 pack 15, magic orb 25): a single
// bandit funds half a gun1 pack, two bandits fund a gun1 pack, a small chest
// = a magic orb almost, a large chest = a magic orb + ammo, a boss = 2
// magic orbs.
export const COIN_DROP_WEAK_ENEMY_COUNT = 3;
export const COIN_DROP_REGULAR_ENEMY_COUNT = 5;
export const COIN_DROP_CHEST_SMALL_COUNT = 10;
export const COIN_DROP_CHEST_LARGE_COUNT = 20;
export const COIN_DROP_BOSS_COUNT = 50;

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
// Gold-yellow body. The orb itself carries no detail — the mist emitter is
// what makes it read as magical rather than as a plain dot.
export const MAGIC_ORB_FILL_COLOR = 0xffd700;

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
export const MIST_PARTICLE_COLOR = 0xffd700;
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
} as const;

// LDtk level identifier rendered by GameScene. The PreloadScene must inspect
// the same identifier when picking which tilesets to load — keep them aligned.
export const CURRENT_LEVEL_IDENTIFIER = 'Level_5';

// LDtk level the player spawns into on a fresh boot. Triggers the landing
// page overlay (LandingScene) at first launch so the player is framed for
// the start screen. Distinct from CURRENT_LEVEL_IDENTIFIER so the legacy
// reference can still point at the prior testing level if needed.
export const STARTING_LEVEL_IDENTIFIER = 'Level_3';

// Render depth for the player and other dynamic entities. Tile layers occupy
// depth 0..N (back→front) using their LDtk layer position; this sits above
// all of them.
export const ENTITY_DEPTH = 100;
// Player renders one step above other entities so decoration sprites
// (Tech_shop_spawn, Mushroom_merchant, etc.) never occlude the player when
// they overlap. Without this the player and entities tie at ENTITY_DEPTH and
// Phaser falls back to display-list insertion order, which depends on LDtk
// entity processing order and put the shop in front.
export const PLAYER_DEPTH = ENTITY_DEPTH + 1;

// Time window (ms) an enemy stays "in combat" after its last player-dealt
// damage. Once the window lapses, HP snaps back to behavior.health (max) and
// the floating health bar hides. Trap/fall damage does not refresh the timer.
export const ENEMY_COMBAT_TIMEOUT_MS = 20_000;

// Time after death before a non-boss enemy is eligible to respawn at its
// original spawn point. Bosses (behavior.isBoss === true) opt out entirely.
// Two minutes lands between "fresh encounter" and "you've moved on" — short
// enough that backtracking through cleared rooms isn't empty, long enough
// that the player isn't fighting refilled spawns mid-exploration.
export const ENEMY_RESPAWN_DELAY_MS = 120_000;
// Throttle (ms) for the respawn manager's per-tick scan. 1Hz is enough to
// notice the threshold within a perceptible window without burning CPU on a
// per-frame Map iteration that almost always returns "not yet".
export const ENEMY_RESPAWN_CHECK_INTERVAL_MS = 1000;
// Camera-rect padding (source px) added when checking whether a respawn point
// is off-screen. A spawn point inside (camera rect + this padding) defers
// the respawn so the player never sees an enemy materialize at the edge of
// view. 64 ≈ four tiles — comfortably outside the visible band even on the
// frame the player turns the camera.
export const ENEMY_RESPAWN_OFFSCREEN_PADDING_PX = 64;
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
// Sits above the player so a player jumping in front of an enemy still leaves
// the bar legible. Tile layers stop at ENTITY_DEPTH, so this is always on top
// of world geometry too.
export const ENEMY_HEALTH_BAR_DEPTH = ENTITY_DEPTH + 2;

// Player HUD: two stacked groups. HP/STA/MAG anchor top-left; G1/G2 ammo
// anchor top-right with the row's right edge against the margin. HP/STA/MAG
// render art assets; G1/G2 render an ammo icon + count. ORIGIN_*_PX and
// ROW_PITCH_PX are CANVAS pixels (final screen coords).
// Margin from the viewport edge to the HUD content's left/top. Sized so the
// frame's outer corner accents (which extend ~10 canvas px past the content
// edge at CAMERA_ZOOM=3) still have a few canvas px of clearance from the
// viewport border instead of clipping into the corner.
export const PLAYER_HUD_ORIGIN_X_PX = 18;
export const PLAYER_HUD_ORIGIN_Y_PX = 18;
// Vertical pitch between HP and the row below it. Sized for the tallest
// asset (HP slider ~37 canvas px tall at HP_SLIDER_SCALE=0.78) with a small
// gap below.
export const PLAYER_HUD_ROW_PITCH_PX = 44;
// Tighter pitch for the STA→MAG gap. The stamina and magic bars are short
// (~9 canvas px) so they can sit closer together than HP's row.
export const PLAYER_HUD_STA_MAG_PITCH_PX = 22;
// World-unit gap between a row's label and its content sprite/icon, used by
// the right-aligned ammo group (each row is sized to its own label).
export const PLAYER_HUD_LABEL_CONTENT_GAP_WORLD_UNITS = 1;
// World-unit padding between the widest label in the left group and the bar
// column. All three bars (HP/STA/MAG) are pinned to the same X by computing
// `worldX + maxLabelWidth + this padding`, so they line up regardless of
// per-row label size differences.
export const PLAYER_HUD_LEFT_BAR_INDENT_WORLD_UNITS = 4;
// Matches the depth the legacy healthText used so the HUD reliably renders on
// top of every gameplay object including the enemy health bars.
export const PLAYER_HUD_DEPTH = 10_000;
export const PLAYER_HUD_LABEL_FONT_FAMILY = 'monospace';
// Default font size for HUD text (HP label, G1/G2 labels, ammo counts).
export const PLAYER_HUD_LABEL_FONT_SIZE_PX = 6;
// Smaller font for STA/MAG labels so they read closer to the short 3-source-
// pixel bar height and don't tower over their content.
export const PLAYER_HUD_SMALL_LABEL_FONT_SIZE_PX = 4;
export const PLAYER_HUD_LABEL_COLOR = '#ffffff';

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

// Pause menu. Lives in its own scene (SCENE_KEYS.PAUSE) launched on top of
// GameScene via scene.launch + scene.pause — the idiomatic Phaser pause
// pattern halts physics, tweens, timers, and update() in one call. Word
// sprites are loaded as plain PNGs with LINEAR filtering (matching
// InteractionIcon and the magic orb) so they render smoothly at zoom rather
// than nearest-sampled by the global pixelArt:true config.
export const PAUSE_CONTINUE_TEXTURE_KEY = 'pause_word_continue';
export const PAUSE_QUIT_TEXTURE_KEY = 'pause_word_quit';
export const PAUSE_CONTINUE_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words1.png';
export const PAUSE_QUIT_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words3.png';

// Full-viewport dim drawn under the menu. 0.5 alpha dims gameplay enough to
// pull focus to the menu while still letting the world read through.
export const PAUSE_DIM_COLOR = 0x000000;
export const PAUSE_DIM_ALPHA = 0.5;

// Source-pixel scale for the word sprites.
export const PAUSE_WORD_DISPLAY_SCALE = 1.5;
// Canvas-pixel gap between the two word sprites once rendered.
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

// Per-purchase grant. Aliased to the existing pickup amounts so buying a
// gun1 magazine grants the same N bullets as walking into a gun1 drop —
// keeps the value-per-unit consistent across drop and shop economies.
export const SHOP_GUN1_GRANT_PER_PURCHASE = AMMO_PICKUP_GUN1_AMOUNT;
export const SHOP_GUN2_GRANT_PER_PURCHASE = AMMO_PICKUP_GUN2_AMOUNT;
export const SHOP_MAGIC_GRANT_PER_PURCHASE = MAGIC_PICKUP_AMOUNT;

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
export const LANDING_TITLE_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const LANDING_TITLE_FONT_SIZE_PX = 48;
export const LANDING_TITLE_FONT_WEIGHT = 'bold';
export const LANDING_TITLE_COLOR = '#ffffff';
export const LANDING_TITLE_VIEWPORT_FRACTION_Y = 0.18;

// Fade durations for the click → black → gameplay transition. Matched in
// and out so the visible pulse feels symmetric.
export const LANDING_FADE_OUT_MS = 600;
export const LANDING_FADE_IN_MS = 600;

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
// emit a halo while the surrounding tile pixels stay unchanged. Combined with
// WORLD_DIM_* below, the contrast pulls focus to the lit dots. Toggle this
// flag to disable the effect entirely (no bake, no extra draw calls).
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

// World dim overlay. Camera-pinned black Rectangle drawn at a depth below
// the lowest IntGrid/Foreground* layer, so background + parallax visuals are
// darkened but ground (IntGrid) and foreground tiles (and their glow) are
// not. IntGrid is kept bright alongside Foreground* because they share a
// tileset — splitting them across the dim makes the same source pixel render
// at two different brightnesses where Foreground1 tiles overlay IntGrid
// ground. Entities (ENTITY_DEPTH=100) sit above the dim, so the
// player/enemies/HUD render at full brightness too.
//
// Alpha is dynamic when LIGHTING_ENABLED is true: GameScene samples openness
// at the player's position and lerps the dim alpha between
// WORLD_DIM_ALPHA_OPEN (in wide caves) and WORLD_DIM_ALPHA_ENCLOSED (in
// tight tunnels). When LIGHTING_ENABLED is false, the dim stays at the
// static WORLD_DIM_ALPHA value. Set WORLD_DIM_ALPHA=0 and LIGHTING_ENABLED
// =false to disable the dim entirely without removing the wiring.
export const WORLD_DIM_COLOR = 0x000000;
export const WORLD_DIM_ALPHA = 0.15;

// Openness-based dynamic lighting. For each walkable IntGrid cell in a
// level, the system walks outward in 8 directions until it hits a solid
// cell (or the level edge), takes the min distance, and normalizes it to a
// 0..1 "openness" score. Each frame GameScene samples openness at the
// player's current world position and modulates the screen-wide dim alpha
// between OPEN and ENCLOSED. Net effect: the whole screen brightens in
// open caves and dims in tight corridors. Set ENABLED=false to disable
// the modulation (dim stays at static WORLD_DIM_ALPHA).
export const LIGHTING_ENABLED = true;
// Cells beyond this radius are treated as fully open. Lower = small rooms
// also register as "fully open". 4 cells (64 px at 16-px gridSize) means
// roughly an 8×8 px room counts as fully open. Higher pushes the bright end
// further toward genuinely large caves.
export const OPENNESS_SATURATION_CELLS = 4;
// Half-extent (in cells) of the region-averaging kernel applied after the
// per-cell raycast. Every cell's final openness = mean openness of the
// walkable cells within this radius. The point is that screen brightness
// reflects the surrounding *region's* openness, not the player's exact
// tile — so standing next to a wall inside a big room still reads as
// "big room" rather than "next to a wall". Larger = more uniform within
// rooms but smears across multiple rooms (and on small levels can collapse
// the entire level into one uniform value); smaller = more variation
// within rooms but sharper room-to-room contrast. 5 cells ≈ an 11×11 cell
// window (176 px) which captures local region without swallowing an
// entire small level.
export const OPENNESS_REGION_RADIUS_CELLS = 5;
// Contrast power applied to the openness score after smoothing. Values < 1
// lift mid-range openness toward 1.0 — i.e. modestly open rooms register as
// "very open" and the brightness gap between corridor and cave widens. At
// 0.4 a 50%-open room reads as ~76% open. Set to 1.0 to disable the curve.
// Tune lower (e.g. 0.25) for an even more dramatic gap; higher (e.g. 0.8)
// for a gentler ramp. Type-annotated as `number` so the consumer can
// compare against 1 to short-circuit the no-op case without TS narrowing
// the constant to its literal value.
export const OPENNESS_CONTRAST_POWER: number = 0.25;
// Dim alpha when the player is in a fully-open area (openness = 1). 0.15
// leaves the brightest areas slightly tinted rather than at full asset
// brightness — sets a darker floor for the whole range.
export const WORLD_DIM_ALPHA_OPEN = 0.15;
// Dim alpha when the player is in a fully-enclosed area (openness = 0).
// Tracks the OPEN endpoint at a constant +0.4 offset so the dynamic range
// stays the same; raising both endpoints by 0.15 from the previous pair
// (0.0 / 0.55) makes the world uniformly 15% darker.
export const WORLD_DIM_ALPHA_ENCLOSED = 0.7;
// Lerp rate (per second) used to ease the current alpha toward the
// openness-derived target. 4.0 ≈ ~250 ms to traverse most of the gap. Lower
// = slower fade (more cinematic); higher = snappier response to crossing a
// doorway. The smoothing is what keeps screen brightness from flickering as
// the player walks between cells of different openness scores.
export const LIGHTING_LERP_RATE_PER_SEC = 4.0;
// Camera-pinned text overlay showing live lighting state (raw openness
// sample, target alpha, smoothed alpha) for diagnostics during tuning.
// Disable once the lighting curve feels right.
export const LIGHTING_DEBUG_HUD = true;

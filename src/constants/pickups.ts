// World-drop pickups: coin / heal cross / boss key / magic orb textures,
// spawn physics, and the orb's mist emitter.

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

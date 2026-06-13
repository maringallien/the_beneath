/**
 * pickups constants — world-drop pickup visuals, spawn physics, and emitter tuning.
 *
 * Pure tuning data (no logic) for the four world-drop pickups (coin, heal cross,
 * boss key, magic orb): their procedurally-generated placeholder textures and
 * colors, the shared drop-body / spawn-pop / drag / lifetime physics, the orb's
 * idle loiter drift, and the orb's attached mist particle emitter. Re-exported
 * through the constants barrel, so call sites import from '../constants'.
 *
 * Inputs:  none — compile-time constants.
 * Outputs: the named texture keys, colors, sizes, physics, and emitter values below.
 * @calledby the preload texture generators, the world-drop pickup entity and its
 *           spawn/loiter/despawn physics, the orb's mist emitter, and the HUD/shop
 *           that reuse these icon keys and scales.
 * @calls    nothing — a leaf data module.
 */

// Procedural gold disc; swap for a real PNG by loading at COIN_TEXTURE_KEY and removing the generator.
export const COIN_TEXTURE_KEY = 'gold_coin';
// Larger source texture so LINEAR sampling stays crisp in the HUD; display scale compensates.
export const COIN_TEXTURE_SIZE_PX = 32;
// 32 × 0.125 = 4 world units, matching the old footprint. Coin-specific or the larger texture would balloon world coins.
export const COIN_DROP_DISPLAY_SCALE = 0.125;
// Wider jitter spreads a chest's burst so 20 coins don't collapse onto one tile.
export const COIN_SPAWN_VELOCITY_X_JITTER = 140;
export const COIN_SPAWN_VELOCITY_Y_MIN = -200;
export const COIN_SPAWN_VELOCITY_Y_MAX = -90;
export const COIN_DRAG_X = 90;
// Warm gold + off-center highlight for a faint 3D read at small sizes.
export const COIN_FILL_COLOR = 0xffcc33;
export const COIN_HIGHLIGHT_COLOR = 0xfff2a8;

// Procedural white "+" cross; matches the HUD glyph so it reads identically in world, HUD, and shop.
export const HEAL_CROSS_TEXTURE_KEY = 'heal_cross';
// Larger source so LINEAR sampling keeps the arms crisp at zoom.
export const HEAL_CROSS_TEXTURE_SIZE_PX = 32;
// 8 world units — slightly larger than ammo/orb so the rarer heal reads as more important.
export const HEAL_CROSS_DROP_DISPLAY_SCALE = 0.25;
// Flat white matching the HUD glyph; no faux-3D highlight.
export const HEAL_CROSS_COLOR = 0xffffff;

// Procedural gold key; both boss keys share one texture — door-matching is by pickup kind, not appearance.
export const KEY_TEXTURE_KEY = 'boss_key';
export const KEY_TEXTURE_SIZE_PX = 16;
// 8 world units, matching the heal cross so rare keys read as important.
export const KEY_DROP_DISPLAY_SCALE = 0.5;
// Unique unlock — kept as a constant for parity with other pickups.
export const KEY_PICKUP_AMOUNT = 1;
// Warm gold matching the coin palette so the key reads as "treasure".
export const KEY_FILL_COLOR = 0xffcc33;
export const KEY_HIGHLIGHT_COLOR = 0xfff2a8;

// Procedural black circle; the mist emitter is what makes it read as magical.
export const MAGIC_ORB_TEXTURE_KEY = 'magic_orb';
// Reduced from 16→12 so the orb reads slightly smaller than ammo drops.
export const MAGIC_ORB_TEXTURE_SIZE_PX = 12;
// Keep MIST_PARTICLE_COLOR in sync so the aura matches the body.
export const MAGIC_ORB_FILL_COLOR = 0x00ffff;

// Different X/Y periods produce a Lissajous figure so the motion never repeats a straight line.
export const MAGIC_ORB_LOITER_X_AMPLITUDE_PX = 8;
export const MAGIC_ORB_LOITER_Y_AMPLITUDE_PX = 5;
export const MAGIC_ORB_LOITER_X_PERIOD_MS = 2400;
export const MAGIC_ORB_LOITER_Y_PERIOD_MS = 1800;
// Lifts the orb above the chest lid / corpse so it visibly hovers.
export const MAGIC_ORB_SPAWN_Y_OFFSET_PX = -10;

// Slow stream of discrete upward puffs — low rate so particles read individually, not as a continuous fog.
export const MIST_PARTICLE_TEXTURE_KEY = 'magic_mist';
export const MIST_PARTICLE_TEXTURE_SIZE_PX = 6;
// Match MAGIC_ORB_FILL_COLOR so the aura reads as one piece.
export const MIST_PARTICLE_COLOR = 0x00ffff;
// Random lifespan so the cloud doesn't pulse in a uniform rhythm.
export const MIST_PARTICLE_LIFESPAN_MIN_MS = 900;
export const MIST_PARTICLE_LIFESPAN_MAX_MS = 1500;
export const MIST_PARTICLE_EMIT_FREQUENCY_MS = 400;
// Slow drift — rises rather than shoots.
export const MIST_PARTICLE_SPEED_MIN = 6;
export const MIST_PARTICLE_SPEED_MAX = 14;
// Spawn faint so particles don't punch through dark backgrounds.
export const MIST_PARTICLE_ALPHA_START = 0.55;
export const MIST_PARTICLE_ALPHA_END = 0;
// Slight scale-up feels like dissipating vapor.
export const MIST_PARTICLE_SCALE_START = 0.7;
export const MIST_PARTICLE_SCALE_END = 1.4;
// Particles spawn within this radius so mist surrounds the orb rather than fountaining from one point.
export const MIST_PARTICLE_EMIT_RADIUS_PX = 4;

// Smaller than the 16x16 frame so drops nestle into corners and the player's body easily overlaps them.
export const AMMO_DROP_BODY_WIDTH_PX = 10;
export const AMMO_DROP_BODY_HEIGHT_PX = 10;
export const AMMO_DROP_DISPLAY_SCALE = 0.5;
export const AMMO_DROP_SPAWN_VELOCITY_Y = -100;
// X jitter so a chest dropping two pickups doesn't stack them perfectly.
export const AMMO_DROP_SPAWN_VELOCITY_X_JITTER = 30;
// Arcade Physics has no surface friction; drag stops the jitter slide in ~0.08s.
export const AMMO_DROP_DRAG_X = 400;
// 30s to retrace a few rooms without littering arenas where the player over-farmed.
export const AMMO_DROP_LIFETIME_MS = 30_000;

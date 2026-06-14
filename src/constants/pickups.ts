/**
 * @file constants/pickups.ts
 * @description World-drop pickup tuning (coin, heal cross, boss key, magic orb, ammo) — procedural placeholder textures/colors, shared drop-body/spawn-pop/drag/lifetime physics, the orb's loiter drift, and its mist emitter.
 * @module constants
 */

// ── Coin ───────────────────────────────────────────────────────────────────
// Procedural gold disc (swap for a real PNG by loading at COIN_TEXTURE_KEY and removing the generator). Source
// texture is larger so LINEAR sampling stays crisp in the HUD; the display scale compensates (32 × 0.125 = 4
// world units, matching the old footprint — a coin-specific scale, as the larger texture would balloon world
// coins). Wider X jitter spreads a chest's burst so 20 coins don't collapse onto one tile. Warm gold + an
// off-center highlight give a faint 3D read at small sizes.
export const COIN_TEXTURE_KEY = 'gold_coin';
export const COIN_TEXTURE_SIZE_PX = 32;
export const COIN_DROP_DISPLAY_SCALE = 0.125;
export const COIN_SPAWN_VELOCITY_X_JITTER = 140;
export const COIN_SPAWN_VELOCITY_Y_MIN = -200;
export const COIN_SPAWN_VELOCITY_Y_MAX = -90;
export const COIN_DRAG_X = 90;
export const COIN_FILL_COLOR = 0xffcc33;
export const COIN_HIGHLIGHT_COLOR = 0xfff2a8;

// ── Heal cross ─────────────────────────────────────────────────────────────
// Procedural white "+" cross matching the HUD glyph so it reads identically in world, HUD, and shop; flat white
// with no faux-3D highlight. Larger source keeps the arms crisp at zoom, and 8 world units is slightly larger
// than ammo/orb so the rarer heal reads as more important.
export const HEAL_CROSS_TEXTURE_KEY = 'heal_cross';
export const HEAL_CROSS_TEXTURE_SIZE_PX = 32;
export const HEAL_CROSS_DROP_DISPLAY_SCALE = 0.25;
export const HEAL_CROSS_COLOR = 0xffffff;

// ── Boss key ───────────────────────────────────────────────────────────────
// Procedural gold key; both boss keys share one texture — door-matching is by pickup kind, not appearance. 8
// world units matches the heal cross so rare keys read as important. PICKUP_AMOUNT (a unique unlock) is kept as
// a constant for parity with the other pickups. Warm gold matches the coin palette so the key reads as "treasure".
export const KEY_TEXTURE_KEY = 'boss_key';
export const KEY_TEXTURE_SIZE_PX = 16;
export const KEY_DROP_DISPLAY_SCALE = 0.5;
export const KEY_PICKUP_AMOUNT = 1;
export const KEY_FILL_COLOR = 0xffcc33;
export const KEY_HIGHLIGHT_COLOR = 0xfff2a8;

// ── Magic orb (body & loiter) ──────────────────────────────────────────────
// Procedural black circle — the mist emitter is what makes it read as magical. Size reduced 16→12 so the orb
// reads slightly smaller than ammo drops; keep FILL_COLOR in sync with MIST_PARTICLE_COLOR so the aura matches
// the body. Idle loiter uses different X/Y amplitudes/periods to trace a Lissajous figure so the motion never
// repeats a straight line, and the spawn Y offset lifts the orb above the chest lid / corpse so it visibly hovers.
export const MAGIC_ORB_TEXTURE_KEY = 'magic_orb';
export const MAGIC_ORB_TEXTURE_SIZE_PX = 12;
export const MAGIC_ORB_FILL_COLOR = 0x00ffff;
export const MAGIC_ORB_LOITER_X_AMPLITUDE_PX = 8;
export const MAGIC_ORB_LOITER_Y_AMPLITUDE_PX = 5;
export const MAGIC_ORB_LOITER_X_PERIOD_MS = 2400;
export const MAGIC_ORB_LOITER_Y_PERIOD_MS = 1800;
export const MAGIC_ORB_SPAWN_Y_OFFSET_PX = -10;

// ── Orb mist emitter ───────────────────────────────────────────────────────
// Slow stream of discrete upward puffs — low emit rate so particles read individually, not as continuous fog.
// Match COLOR to MAGIC_ORB_FILL_COLOR so the aura reads as one piece. Randomized lifespan stops the cloud
// pulsing in a uniform rhythm; speeds drift (rise rather than shoot); alpha starts faint so puffs don't punch
// through dark backgrounds and fades to nothing; a slight scale-up feels like dissipating vapor; and particles
// spawn within EMIT_RADIUS so mist surrounds the orb rather than fountaining from one point.
export const MIST_PARTICLE_TEXTURE_KEY = 'magic_mist';
export const MIST_PARTICLE_TEXTURE_SIZE_PX = 6;
export const MIST_PARTICLE_COLOR = 0x00ffff;
export const MIST_PARTICLE_LIFESPAN_MIN_MS = 900;
export const MIST_PARTICLE_LIFESPAN_MAX_MS = 1500;
export const MIST_PARTICLE_EMIT_FREQUENCY_MS = 400;
export const MIST_PARTICLE_SPEED_MIN = 6;
export const MIST_PARTICLE_SPEED_MAX = 14;
export const MIST_PARTICLE_ALPHA_START = 0.55;
export const MIST_PARTICLE_ALPHA_END = 0;
export const MIST_PARTICLE_SCALE_START = 0.7;
export const MIST_PARTICLE_SCALE_END = 1.4;
export const MIST_PARTICLE_EMIT_RADIUS_PX = 4;

// ── Ammo drop ──────────────────────────────────────────────────────────────
// Body is smaller than the 16x16 frame so drops nestle into corners and the player's body easily overlaps them.
// X jitter keeps a chest dropping two pickups from stacking them perfectly; Arcade Physics has no surface
// friction so drag stops the jitter slide in ~0.08s. The 30s lifetime gives time to retrace a few rooms without
// littering arenas where the player over-farmed.
export const AMMO_DROP_BODY_WIDTH_PX = 10;
export const AMMO_DROP_BODY_HEIGHT_PX = 10;
export const AMMO_DROP_DISPLAY_SCALE = 0.5;
export const AMMO_DROP_SPAWN_VELOCITY_Y = -100;
export const AMMO_DROP_SPAWN_VELOCITY_X_JITTER = 30;
export const AMMO_DROP_DRAG_X = 400;
export const AMMO_DROP_LIFETIME_MS = 30_000;

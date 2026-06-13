/**
 * rendering constants — tileset/level visual-effect tuning.
 *
 * Pure tuning data (no logic) for the world's lighting effects: per-tileset and
 * per-layer brightness lifts, the foreground bright-pixel glow bake + flicker,
 * and the neon-sign flicker / lit-decoration pulsate. Re-exported through the
 * constants barrel, so call sites import from '../constants'.
 *
 * Inputs:  none — compile-time constants.
 * Outputs: the named brightness, glow, flicker, and pulsate values below.
 * @calledby the preload-time texture bakers (brightness/glow-atlas/sign-split),
 *           the level renderer's foreground overlay/glow draw passes, and the
 *           flicker/pulsate tween rigs on glow containers and lit sign overlays.
 * @calls    nothing — a leaf data module.
 */

// RGB multiplier per opaque pixel to compensate for tilesets that ship darker than peers; tuned by feel.
export const TILESET_BRIGHTNESS_FACTORS: Readonly<Record<number, number>> = {
  2: 1.1,
};

// Per-layer ADD-blended lift for layers that share a tileset uid but need to differ in brightness; alpha = (factor - 1).
export const LAYER_BRIGHTNESS_FACTORS: Readonly<Record<string, number>> = {
  Foreground1: 1.1,
};

// Pre-baked ADD-blend glow atlas for bright Foreground pixels; toggle to disable bake + draw calls.
export const FOREGROUND_GLOW_ENABLED = true;
// Prefix that opts a layer into the glow pass; other layers (Parallax*, Background*) are unaffected.
export const FOREGROUND_GLOW_LAYER_PREFIX = 'Foreground';
// Suffix for the sibling glow atlas key; GlowAtlasBaker writes it, LevelRenderer reads it — keep in sync.
export const FOREGROUND_GLOW_TEXTURE_SUFFIX = '_glow';
// Catches near-white dots (stars, candle highlights) while leaving stone/grass mid-tones alone.
export const FOREGROUND_GLOW_LUMINANCE_THRESHOLD = 0.78;
// Source-px halo radius; at CAMERA_ZOOM=3, radius 3 becomes 9 canvas px.
export const FOREGROUND_GLOW_RADIUS_PX = 3;
// Peak alpha at halo center; multiplied by flicker alpha at runtime so the visible average sits lower.
export const FOREGROUND_GLOW_CORE_ALPHA = 0.4;
// alpha(r) = CORE × (1 − r/R)^EXP; 1.6 reads as a smooth wisp rather than a hard ring or foggy blob.
export const FOREGROUND_GLOW_FALLOFF_EXPONENT = 1.6;

// Yoyo alpha tween on each glow container; random delay offsets neighbors so they don't pulse in lockstep.
export const FOREGROUND_GLOW_FLICKER_MIN_ALPHA = 0.45;
export const FOREGROUND_GLOW_FLICKER_MAX_ALPHA = 1.0;
// Per half-cycle; full loop = DURATION × 2. Short enough to read as flicker, long enough to feel organic.
export const FOREGROUND_GLOW_FLICKER_DURATION_MIN_MS = 280;
export const FOREGROUND_GLOW_FLICKER_DURATION_MAX_MS = 720;

// Neon sign flicker: lit overlay (letters/icons) gets the tween; the structure (frame, mounts) stays visible.
// Tween = randomized bursts of rapid pulses then an idle hold, all sampled independently per cycle.
// 0 cuts the lit overlay entirely (true off); non-zero would leave a faint ghost glow.
export const SIGN_FLICKER_DIM_ALPHA = 0.0;
// Larger max = more broken neon; smaller = calmer single pulses.
export const SIGN_FLICKER_BURST_SIZE_MIN = 1;
export const SIGN_FLICKER_BURST_SIZE_MAX = 4;
// 18-90ms reads as a buzzing fluorescent; sampled per transition for a mix within one burst.
export const SIGN_FLICKER_PULSE_DURATION_MIN_MS = 18;
export const SIGN_FLICKER_PULSE_DURATION_MAX_MS = 90;
// Random idle hold so no two signs share a schedule; a fixed period would read as a metronome.
export const SIGN_FLICKER_INTERVAL_MIN_MS = 250;
export const SIGN_FLICKER_INTERVAL_MAX_MS = 1400;

// Slow sine-eased "breathing" glow; MIN > 0 keeps the light visible (true off would read as a flicker).
export const SIGN_PULSATE_MIN_ALPHA = 0.25;
export const SIGN_PULSATE_MAX_ALPHA = 1.0;
// Per half-cycle; random per instance so neighboring lights drift in phase and don't strobe in unison.
export const SIGN_PULSATE_DURATION_MIN_MS = 550;
export const SIGN_PULSATE_DURATION_MAX_MS = 1300;

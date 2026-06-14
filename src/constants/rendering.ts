/**
 * @file constants/rendering.ts
 * @description Tileset/level lighting tuning — per-tileset and per-layer brightness lifts, the foreground bright-pixel glow bake + flicker, and the neon-sign flicker / lit-decoration pulsate.
 * @module constants
 */

// ── Brightness lifts ───────────────────────────────────────────────────────
// TILESET factors are an RGB multiplier per opaque pixel to compensate for tilesets that ship darker than peers
// (tuned by feel). LAYER factors are a per-layer ADD-blended lift for layers that share a tileset uid but need to
// differ in brightness (alpha = factor - 1).
export const TILESET_BRIGHTNESS_FACTORS: Readonly<Record<number, number>> = {
  2: 1.1,
};
export const LAYER_BRIGHTNESS_FACTORS: Readonly<Record<string, number>> = {
  Foreground1: 1.1,
};

// ── Foreground glow bake ───────────────────────────────────────────────────
// Pre-baked ADD-blend glow atlas for bright Foreground pixels; ENABLED toggles the whole bake + draw. Only layers
// with the FOREGROUND prefix opt in (Parallax*, Background* unaffected); the TEXTURE_SUFFIX keys the sibling atlas
// (GlowAtlasBaker writes it, LevelRenderer reads it — keep in sync). The luminance threshold catches near-white
// dots (stars, candle highlights) while leaving stone/grass mid-tones alone. RADIUS is in source px (radius 3 →
// 9 canvas px at CAMERA_ZOOM=3); CORE_ALPHA is the peak at halo center (multiplied by flicker alpha at runtime so
// the visible average sits lower); falloff is alpha(r) = CORE × (1 − r/R)^EXP, with 1.6 reading as a smooth wisp
// rather than a hard ring or foggy blob.
export const FOREGROUND_GLOW_ENABLED = true;
export const FOREGROUND_GLOW_LAYER_PREFIX = 'Foreground';
export const FOREGROUND_GLOW_TEXTURE_SUFFIX = '_glow';
export const FOREGROUND_GLOW_LUMINANCE_THRESHOLD = 0.78;
export const FOREGROUND_GLOW_RADIUS_PX = 3;
export const FOREGROUND_GLOW_CORE_ALPHA = 0.4;
export const FOREGROUND_GLOW_FALLOFF_EXPONENT = 1.6;

// ── Glow flicker ───────────────────────────────────────────────────────────
// Yoyo alpha tween on each glow container; a random delay offsets neighbors so they don't pulse in lockstep.
// Duration is per half-cycle (full loop = DURATION × 2) — short enough to read as flicker, long enough to feel organic.
export const FOREGROUND_GLOW_FLICKER_MIN_ALPHA = 0.45;
export const FOREGROUND_GLOW_FLICKER_MAX_ALPHA = 1.0;
export const FOREGROUND_GLOW_FLICKER_DURATION_MIN_MS = 280;
export const FOREGROUND_GLOW_FLICKER_DURATION_MAX_MS = 720;

// ── Neon-sign flicker ──────────────────────────────────────────────────────
// Only the lit overlay (letters/icons) gets the tween; the structure (frame, mounts) stays visible. The tween is
// randomized bursts of rapid pulses then an idle hold, all sampled independently per cycle. DIM_ALPHA 0 cuts the
// lit overlay entirely (true off; non-zero would leave a faint ghost glow). Larger burst max = more broken neon;
// the 18-90ms pulse range (sampled per transition for a mix within one burst) reads as a buzzing fluorescent; and
// the randomized idle interval keeps no two signs on the same schedule (a fixed period would read as a metronome).
export const SIGN_FLICKER_DIM_ALPHA = 0.0;
export const SIGN_FLICKER_BURST_SIZE_MIN = 1;
export const SIGN_FLICKER_BURST_SIZE_MAX = 4;
export const SIGN_FLICKER_PULSE_DURATION_MIN_MS = 18;
export const SIGN_FLICKER_PULSE_DURATION_MAX_MS = 90;
export const SIGN_FLICKER_INTERVAL_MIN_MS = 250;
export const SIGN_FLICKER_INTERVAL_MAX_MS = 1400;

// ── Sign pulsate ───────────────────────────────────────────────────────────
// Slow sine-eased "breathing" glow for lit decorations; MIN > 0 keeps the light visible (true off would read as
// a flicker). Duration is per half-cycle, randomized per instance so neighboring lights drift in phase and don't
// strobe in unison.
export const SIGN_PULSATE_MIN_ALPHA = 0.25;
export const SIGN_PULSATE_MAX_ALPHA = 1.0;
export const SIGN_PULSATE_DURATION_MIN_MS = 550;
export const SIGN_PULSATE_DURATION_MAX_MS = 1300;

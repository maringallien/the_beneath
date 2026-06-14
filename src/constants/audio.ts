/**
 * @file constants/audio.ts
 * @description Shared sound ids referenced from more than one call site — menu feedback sfx and the soundtrack; each must exist in soundRegistry.json.
 * @module constants
 */

// ── UI feedback sfx ────────────────────────────────────────────────────────
// One-shot non-spatial ids: hover click for menu buttons, heavy stinger on Start/death.
export const UI_BUTTON_HOVER_SOUND_ID = 'button_hover';
export const UI_BOOM_SOUND_ID = 'boom_low_hit';

// ── Soundtrack ─────────────────────────────────────────────────────────────
// Looping theme under the registry's "music" category; the only sound gated by the OPTIONS music volume bar.
export const MUSIC_MAIN_THEME_SOUND_ID = 'main_theme';

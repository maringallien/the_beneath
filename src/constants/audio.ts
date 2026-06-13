/**
 * audio constants — shared sound ids for menu feedback and the soundtrack.
 *
 * The string ids of sounds referenced from more than one call site, kept here
 * (rather than inline per scene) so the shared references stay in one place.
 * Each id must exist in soundRegistry.json — the UI ids as non-spatial sfx
 * one-shots, the theme under the "music" category.
 *
 * Inputs:  none — compile-time constants.
 * Outputs: UI_BUTTON_HOVER_SOUND_ID, UI_BOOM_SOUND_ID, MUSIC_MAIN_THEME_SOUND_ID.
 * @calledby the menu scenes and the player when playing one-shot feedback, and
 *           the music player that starts and persists the looping soundtrack.
 * @calls    nothing — a leaf data module.
 */

// One-shot non-spatial sfx: hover click for menu buttons, heavy stinger on Start/death.
export const UI_BUTTON_HOVER_SOUND_ID = 'button_hover';
export const UI_BOOM_SOUND_ID = 'boom_low_hit';

// Looping soundtrack; the only sound gated by the OPTIONS music volume bar.
export const MUSIC_MAIN_THEME_SOUND_ID = 'main_theme';

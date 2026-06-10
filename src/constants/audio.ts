// Shared sound ids (menu feedback, soundtrack). Registered in
// soundRegistry.json; referenced from more than one call site each.

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

// The game's looping soundtrack ("ES_Distressed - Hanna Ekstrom"). Started once
// from GameScene.create() via the MusicPlayer (src/audio/MusicPlayer.ts) so it
// plays on the home screen as the game loads and persists across the whole
// session — through the landing→gameplay handoff, level transitions, respawns,
// and New Game. It is the ONLY sound gated by the music volume preference (the
// OPTIONS volume bar); ambience and SFX play regardless. Registered in
// soundRegistry.json under the "music" category.
export const MUSIC_MAIN_THEME_SOUND_ID = 'main_theme';

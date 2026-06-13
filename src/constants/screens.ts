/**
 * screens constants — full-screen scene/overlay visual and timing tuning.
 *
 * Pure tuning data (no logic) for the game's full-screen UI: the victory "YOU
 * WON" flow, the pause menu (word-sprite keys/paths, frame, selection tint), the
 * options-panel speaker icons, and the landing/title page (title font, START and
 * menu banners, fade timings, layout fractions, screen-frame, vignette).
 * Re-exported through the constants barrel, so call sites import from
 * '../constants'.
 *
 * Inputs:  none — compile-time constants.
 * Outputs: the named texture keys, asset paths, colors, fonts, fades, and layout
 *          fractions below.
 * @calledby the victory, pause, landing, options, and credits scenes/overlays, plus
 *           the preloader that loads their word/icon sprites and gates boot on the
 *           display font.
 * @calls    nothing — a leaf data module.
 */

// ── Victory screen ───────────────────────────────────────────────────────
export const VICTORY_DIM_COLOR = 0x000000;
export const VICTORY_DIM_ALPHA = 1;
// Fallback delay before freezing the world; at runtime the actual boss death-anim length is used.
export const VICTORY_DELAY_MS = 3000;
// Freeze this many ms before the death-anim completes so the boss stays visible under the fade, not an empty arena.
export const VICTORY_FREEZE_MARGIN_MS = 200;
export const VICTORY_FADE_IN_MS = 900;
export const VICTORY_HOLD_MS = 2500;
export const VICTORY_TITLE_TEXT = 'YOU WON';
export const VICTORY_TITLE_COLOR = '#ffffff';
export const VICTORY_TITLE_FONT_SIZE_PX = 64;
// Centered vertically on the black screen.
export const VICTORY_TITLE_VIEWPORT_FRACTION_Y = 0.5;

// Pause menu — word sprites are LINEAR-filtered so they render smoothly at zoom (not nearest-sampled).
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

// 0.5 dims gameplay enough to pull focus without hiding the world entirely.
export const PAUSE_DIM_COLOR = 0x000000;
export const PAUSE_DIM_ALPHA = 0.5;

export const PAUSE_WORD_DISPLAY_SCALE = 1.5;
export const PAUSE_WORD_GAP_PX = 32;

// Corner-accented bounding box drawn with Phaser.Graphics.
export const PAUSE_FRAME_COLOR = 0xffffff;
export const PAUSE_FRAME_STROKE_PX = 2;
export const PAUSE_FRAME_PADDING_PX = 16;
export const PAUSE_FRAME_CORNER_ACCENT_SIZE_PX = 4;
export const PAUSE_FRAME_CORNER_ACCENT_OFFSET_PX = 6;

// Default selection is Continue (index 0) so a reflex Enter stays in the game.
export const PAUSE_SELECTED_TINT = 0xffffff;
export const PAUSE_UNSELECTED_TINT = 0x808080;

// Options overlay — plain <img> icons need no Phaser preloading.
export const OPTIONS_SOUND_ON_ICON_PATH =
  '/DarkSpriteLib/general/ui/icons/ui_-_icons6.png';
export const OPTIONS_SOUND_OFF_ICON_PATH =
  '/DarkSpriteLib/general/ui/icons/ui_-_icons7.png';

// Landing page — START click/Enter fades to black, hands off to beginGameplay(), then fades back in.
export const LANDING_START_TEXTURE_KEY = 'landing_word_start';
export const LANDING_START_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words5.png';
export const LANDING_START_DISPLAY_SCALE = 1.5;
// Gray tint darkens uniformly via RGB multiply; cleared on pointer-out.
export const LANDING_BUTTON_HOVER_TINT = 0x808080;
// Hover grows, press yoyos a brief inward pulse so the confirm feels physical.
export const LANDING_BUTTON_HOVER_SCALE_MULTIPLIER = 1.05;
export const LANDING_BUTTON_PRESS_SCALE_MULTIPLIER = 0.92;
export const LANDING_BUTTON_TWEEN_MS = 120;

export const LANDING_TITLE_TEXT = 'THE BENEATH';
// Used by the Font Loading API to gate boot; kept separate from LANDING_TITLE_FONT_FAMILY which carries the fallback stack.
export const DISPLAY_FONT_NAME = 'Nosifer';
// If Nosifer never loads, boot anyway — the woff2 is tiny so this only bites on a cold cache or load failure.
export const FONT_BOOT_TIMEOUT_MS = 2000;
// Nosifer at normal weight — fake-bold smears the dripping glyphs.
export const LANDING_TITLE_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const LANDING_TITLE_FONT_SIZE_PX = 55;
export const LANDING_TITLE_FONT_WEIGHT = 'normal';
export const LANDING_TITLE_COLOR = '#ffffff';
export const LANDING_TITLE_VIEWPORT_FRACTION_Y = 0.18;

// OPTIONS reuses the pause texture; CREDITS loads its own banner.
export const LANDING_CREDITS_TEXTURE_KEY = 'landing_word_credits';
export const LANDING_CREDITS_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words6.png';
// Smaller than START so the primary action stays visually dominant.
export const LANDING_MENU_BUTTON_DISPLAY_SCALE = 1.0;
export const LANDING_MENU_BUTTON_GAP_PX = 22;

export const CREDITS_TITLE_TEXT = LANDING_TITLE_TEXT;

// Matched in/out for a symmetric pulse.
export const LANDING_FADE_OUT_MS = 600;
export const LANDING_FADE_IN_MS = 600;
// Gameplay spins up under the black; the world reveals after to make the descent feel dramatic.
export const LANDING_BLACK_HOLD_MS = 1400;

// Player and button share the same X column; smaller Y = higher on screen.
export const LANDING_PLAYER_VIEWPORT_FRACTION_X = 0.25;
export const LANDING_BUTTON_VIEWPORT_FRACTION_X = 0.25;
export const LANDING_BUTTON_VIEWPORT_FRACTION_Y = 0.32;
// Positive shifts camera down in world space, so the player reads higher on screen; 0 = level midpoint.
export const LANDING_CAMERA_Y_OFFSET_PX = 50;

// L-shaped corner brackets; MARGIN_PX keeps vertices off the edge so they aren't clipped.
export const LANDING_SCREEN_FRAME_MARGIN_PX = 28;
export const LANDING_SCREEN_FRAME_COLOR = 0xffffff;
export const LANDING_SCREEN_FRAME_STROKE_PX = 2;
export const LANDING_SCREEN_BRACKET_LENGTH_PX = 72;

// Four edge-fading black strips draw the eye toward the player + button composition.
export const LANDING_VIGNETTE_COLOR = 0x000000;
export const LANDING_VIGNETTE_THICKNESS_PX = 380;
export const LANDING_VIGNETTE_EDGE_ALPHA = 0.8;

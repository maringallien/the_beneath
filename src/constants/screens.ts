/**
 * @file constants/screens.ts
 * @description Full-screen scene/overlay tuning — the victory "YOU WON" flow, the pause menu (word sprites, frame, selection), the options speaker icons, and the landing/title page (font, banners, fades, layout, frame, vignette).
 * @module constants
 */

// ── Victory screen ─────────────────────────────────────────────────────────
// "YOU WON" flow over a black dim. DELAY is a fallback before freezing the world (at runtime the actual boss
// death-anim length is used); FREEZE_MARGIN freezes that many ms before the death-anim completes so the boss
// stays visible under the fade, not an empty arena. Title is centered vertically.
export const VICTORY_DIM_COLOR = 0x000000;
export const VICTORY_DIM_ALPHA = 1;
export const VICTORY_DELAY_MS = 3000;
export const VICTORY_FREEZE_MARGIN_MS = 200;
export const VICTORY_FADE_IN_MS = 900;
export const VICTORY_HOLD_MS = 2500;
export const VICTORY_TITLE_TEXT = 'YOU WON';
export const VICTORY_TITLE_COLOR = '#ffffff';
export const VICTORY_TITLE_FONT_SIZE_PX = 64;
export const VICTORY_TITLE_VIEWPORT_FRACTION_Y = 0.5;

// ── Pause menu — word sprites ──────────────────────────────────────────────
// Word sprites are LINEAR-filtered so they render smoothly at zoom (not nearest-sampled).
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

// ── Pause menu — dim, layout, frame, selection ─────────────────────────────
// Dim 0.5 pulls focus without hiding the world entirely. The frame is a corner-accented bounding box drawn with
// Phaser.Graphics. Default selection is Continue (index 0) so a reflex Enter stays in the game.
export const PAUSE_DIM_COLOR = 0x000000;
export const PAUSE_DIM_ALPHA = 0.5;
export const PAUSE_WORD_DISPLAY_SCALE = 1.5;
export const PAUSE_WORD_GAP_PX = 32;
export const PAUSE_FRAME_COLOR = 0xffffff;
export const PAUSE_FRAME_STROKE_PX = 2;
export const PAUSE_FRAME_PADDING_PX = 16;
export const PAUSE_FRAME_CORNER_ACCENT_SIZE_PX = 4;
export const PAUSE_FRAME_CORNER_ACCENT_OFFSET_PX = 6;
export const PAUSE_SELECTED_TINT = 0xffffff;
export const PAUSE_UNSELECTED_TINT = 0x808080;

// ── Options overlay ────────────────────────────────────────────────────────
// Speaker on/off icons; plain <img> elements that need no Phaser preloading.
export const OPTIONS_SOUND_ON_ICON_PATH =
  '/DarkSpriteLib/general/ui/icons/ui_-_icons6.png';
export const OPTIONS_SOUND_OFF_ICON_PATH =
  '/DarkSpriteLib/general/ui/icons/ui_-_icons7.png';

// ── Landing — START button ─────────────────────────────────────────────────
// START click/Enter fades to black, hands off to beginGameplay(), then fades back in. The gray hover tint
// darkens uniformly via RGB multiply (cleared on pointer-out); hover grows and press yoyos a brief inward pulse
// so the confirm feels physical.
export const LANDING_START_TEXTURE_KEY = 'landing_word_start';
export const LANDING_START_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words5.png';
export const LANDING_START_DISPLAY_SCALE = 1.5;
export const LANDING_BUTTON_HOVER_TINT = 0x808080;
export const LANDING_BUTTON_HOVER_SCALE_MULTIPLIER = 1.05;
export const LANDING_BUTTON_PRESS_SCALE_MULTIPLIER = 0.92;
export const LANDING_BUTTON_TWEEN_MS = 120;

// ── Landing — title & display font ─────────────────────────────────────────
// DISPLAY_FONT_NAME is used by the Font Loading API to gate boot, kept separate from TITLE_FONT_FAMILY which
// carries the fallback stack. If Nosifer never loads, boot anyway after the timeout — the woff2 is tiny so this
// only bites on a cold cache or load failure. Nosifer renders at normal weight (fake-bold smears the dripping glyphs).
export const LANDING_TITLE_TEXT = 'THE BENEATH';
export const DISPLAY_FONT_NAME = 'Nosifer';
export const FONT_BOOT_TIMEOUT_MS = 2000;
export const LANDING_TITLE_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const LANDING_TITLE_FONT_SIZE_PX = 55;
export const LANDING_TITLE_FONT_WEIGHT = 'normal';
export const LANDING_TITLE_COLOR = '#ffffff';
export const LANDING_TITLE_VIEWPORT_FRACTION_Y = 0.18;

// ── Landing — menu buttons & credits ───────────────────────────────────────
// OPTIONS reuses the pause texture; CREDITS loads its own banner and shares the landing title text. Menu buttons
// are smaller than START so the primary action stays visually dominant.
export const LANDING_CREDITS_TEXTURE_KEY = 'landing_word_credits';
export const LANDING_CREDITS_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words6.png';
export const LANDING_MENU_BUTTON_DISPLAY_SCALE = 1.0;
export const LANDING_MENU_BUTTON_GAP_PX = 22;
export const CREDITS_TITLE_TEXT = LANDING_TITLE_TEXT;

// ── Landing — fade & reveal timing ─────────────────────────────────────────
// Matched in/out for a symmetric pulse. Gameplay spins up under the black, and the world reveals only after the
// hold so the descent feels dramatic.
export const LANDING_FADE_OUT_MS = 600;
export const LANDING_FADE_IN_MS = 600;
export const LANDING_BLACK_HOLD_MS = 1400;

// ── Landing — layout ───────────────────────────────────────────────────────
// Player and button share the same X column; smaller Y = higher on screen. A positive camera Y offset shifts the
// camera down in world space so the player reads higher on screen (0 = level midpoint).
export const LANDING_PLAYER_VIEWPORT_FRACTION_X = 0.25;
export const LANDING_BUTTON_VIEWPORT_FRACTION_X = 0.25;
export const LANDING_BUTTON_VIEWPORT_FRACTION_Y = 0.32;
export const LANDING_CAMERA_Y_OFFSET_PX = 50;

// ── Landing — screen frame & vignette ──────────────────────────────────────
// L-shaped corner brackets, with MARGIN keeping the vertices off the edge so they aren't clipped. The vignette is
// four edge-fading black strips that draw the eye toward the player + button composition.
export const LANDING_SCREEN_FRAME_MARGIN_PX = 28;
export const LANDING_SCREEN_FRAME_COLOR = 0xffffff;
export const LANDING_SCREEN_FRAME_STROKE_PX = 2;
export const LANDING_SCREEN_BRACKET_LENGTH_PX = 72;
export const LANDING_VIGNETTE_COLOR = 0x000000;
export const LANDING_VIGNETTE_THICKNESS_PX = 380;
export const LANDING_VIGNETTE_EDGE_ALPHA = 0.8;

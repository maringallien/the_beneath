// Full-screen scenes: victory, pause menu, options icons, and the
// landing/title page.

// ── Victory screen ───────────────────────────────────────────────────────
// Shown (full-screen, over the frozen game) when the final boss (the Heart
// Hoarder) dies: the screen fades to solid black, "YOU WON" reveals in big
// white letters, and after a short hold the run returns to the home/title page
// (a click / Enter / Space skips the wait).
export const VICTORY_DIM_COLOR = 0x000000;
// Solid black — the win screen fully hides the frozen world behind it.
export const VICTORY_DIM_ALPHA = 1;
// Beat held between the final boss's death (which also clears its arena, so
// every other enemy in the level dies at the same moment) and the victory flow
// freezing the world to fade to black. Without it the screen would cut to black
// on the same frame the boss/adds start dying, so their death animations are
// never seen. The actual hold is derived from the boss's death-animation length
// at runtime (see GameScene.onBossDefeated) so it always covers the full clip;
// this constant is only the fallback used when that duration can't be resolved.
export const VICTORY_DELAY_MS = 3000;
// The boss reaps its own corpse the instant its death animation completes
// (Enemy.onAnimComplete → destroy). So the victory flow freezes the world this
// many ms BEFORE that completion — the boss stays visible on a late death frame
// under the win fade instead of the screen cutting to black over an empty arena.
// ~2.5 frames at the 12fps character rate: enough margin that the freeze always
// wins the race against the self-reap, while the near-final pose reads as done.
export const VICTORY_FREEZE_MARGIN_MS = 200;
export const VICTORY_FADE_IN_MS = 900;
// How long "YOU WON" holds on the black screen before auto-returning home.
export const VICTORY_HOLD_MS = 2500;
export const VICTORY_TITLE_TEXT = 'YOU WON';
export const VICTORY_TITLE_COLOR = '#ffffff';
export const VICTORY_TITLE_FONT_SIZE_PX = 64;
// Centered vertically on the black screen.
export const VICTORY_TITLE_VIEWPORT_FRACTION_Y = 0.5;

// Pause menu. Lives in its own scene (SCENE_KEYS.PAUSE) launched on top of
// GameScene via scene.launch + scene.pause — the idiomatic Phaser pause
// pattern halts physics, tweens, timers, and update() in one call. Word
// sprites are loaded as plain PNGs with LINEAR filtering (matching
// InteractionIcon and the magic orb) so they render smoothly at zoom rather
// than nearest-sampled by the global pixelArt:true config.
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

// Full-viewport dim drawn under the menu. 0.5 alpha dims gameplay enough to
// pull focus to the menu while still letting the world read through.
export const PAUSE_DIM_COLOR = 0x000000;
export const PAUSE_DIM_ALPHA = 0.5;

// Source-pixel scale for the word sprites.
export const PAUSE_WORD_DISPLAY_SCALE = 1.5;
// Canvas-pixel gap between adjacent word sprites once rendered. The pause menu
// stacks them vertically, so this is the vertical spacing between each option.
export const PAUSE_WORD_GAP_PX = 32;

// Bounding box around the two word sprites. Drawn with Phaser.Graphics using
// the same lineStyle+strokeRect approach as PlayerHud.drawGroupFrame; "decor"
// is achieved with four small filled squares sitting just outside the outer
// stroke at each corner.
export const PAUSE_FRAME_COLOR = 0xffffff;
export const PAUSE_FRAME_STROKE_PX = 2;
export const PAUSE_FRAME_PADDING_PX = 16;
export const PAUSE_FRAME_CORNER_ACCENT_SIZE_PX = 4;
export const PAUSE_FRAME_CORNER_ACCENT_OFFSET_PX = 6;

// Selection tint. Selected = no tint (white passthrough); unselected dims
// the sprite via setTint. Default selection on open is Continue (index 0)
// so a reflex Enter keeps the player in the game.
export const PAUSE_SELECTED_TINT = 0xffffff;
export const PAUSE_UNSELECTED_TINT = 0x808080;

// Options panel, opened from the pause menu's OPTIONS button. Rendered as a DOM
// overlay that reuses the merchant shop's grey framed-panel idiom (see
// src/ui/OptionsOverlay + shop.css) so it reads as the same piece of in-world
// UI. Lists the game's controls and exposes a music volume bar with a
// mute-toggle speaker icon, which swaps between a speaker icon (audible) and a
// muted-speaker icon (volume 0); both ship in /public and are referenced as
// plain <img>, so unlike the pause word banners they need no Phaser texture
// preloading.
export const OPTIONS_SOUND_ON_ICON_PATH =
  '/DarkSpriteLib/general/ui/icons/ui_-_icons6.png';
export const OPTIONS_SOUND_OFF_ICON_PATH =
  '/DarkSpriteLib/general/ui/icons/ui_-_icons7.png';

// Landing page. Shown on first boot via a LandingScene overlay launched on
// top of GameScene. The START word sprite uses the same word-banner pattern
// as PauseScene (LINEAR-filtered PNG inside a white bounding box). Clicking
// or pressing Enter/Space fades both cameras to black, hands off to
// GameScene.beginGameplay(), then fades back in.
export const LANDING_START_TEXTURE_KEY = 'landing_word_start';
export const LANDING_START_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words5.png';
export const LANDING_START_DISPLAY_SCALE = 1.5;
// Hover tint applied to the START sprite via setTint while the pointer
// is over it. Phaser multiplies the texture's RGB by the tint, so a gray
// value darkens uniformly without changing the silhouette. Cleared on
// pointer-out (clearTint) to restore full brightness.
export const LANDING_BUTTON_HOVER_TINT = 0x808080;
// Scale multipliers applied on top of LANDING_START_DISPLAY_SCALE for
// the hover (grow) and press (shrink) animations. HOVER eases the sprite
// outward when the pointer enters, PRESS yoyos a brief inward pulse on
// click/Enter/Space so the confirm feels physical even before the
// 600ms fade-out begins. TWEEN_MS is the duration of each half-cycle.
export const LANDING_BUTTON_HOVER_SCALE_MULTIPLIER = 1.05;
export const LANDING_BUTTON_PRESS_SCALE_MULTIPLIER = 0.92;
export const LANDING_BUTTON_TWEEN_MS = 120;

// Landing-page game title rendered above the START button. Defaults to
// the working title pulled from the project folder name; override
// LANDING_TITLE_TEXT if the project gets a final name. Centered on the
// same column as the START button so the two elements read as a single
// stacked composition. Y fraction places the title above the button
// (LANDING_BUTTON_VIEWPORT_FRACTION_Y) — keep some clearance between
// them or the title and button will visually merge.
export const LANDING_TITLE_TEXT = 'THE BENEATH';
// Internal family name of the self-hosted apocalyptic display face (declared
// via @font-face in index.html). Phaser rasterizes canvas Text synchronously
// at creation, so a font still downloading at that moment bakes in the
// fallback face. PreloadScene gates the game boot on the Font Loading API
// reporting THIS family ready (see bootGameWhenFontReady), and LandingScene
// re-renders the title against it as a fallback. Kept separate from
// LANDING_TITLE_FONT_FAMILY (which carries the fallback stack) so the Font
// Loading API is asked for exactly the family it should fetch.
export const DISPLAY_FONT_NAME = 'Nosifer';
// Hard cap on how long PreloadScene waits for DISPLAY_FONT_NAME before booting
// anyway, so a slow or failed font download can never hang startup. The woff2
// is a tiny (~15 KB) self-hosted latin subset, so this only matters on a cold
// cache or an outright load failure (then the title shows its fallback face).
export const FONT_BOOT_TIMEOUT_MS = 2000;
// Apocalyptic display font (self-hosted via @font-face in index.html). Falls
// back to Impact, then a generic display face, if the woff2 fails to load.
// Single-weight font, so the title renders at normal weight (fake-bold would
// smear the dripping glyphs).
export const LANDING_TITLE_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const LANDING_TITLE_FONT_SIZE_PX = 55;
export const LANDING_TITLE_FONT_WEIGHT = 'normal';
export const LANDING_TITLE_COLOR = '#ffffff';
export const LANDING_TITLE_VIEWPORT_FRACTION_Y = 0.18;

// Home-screen menu banners stacked beneath START: OPTIONS (opens the same
// OptionsOverlay the pause menu uses) and CREDITS (opens CreditsOverlay). The
// OPTIONS word reuses the pause menu's already-loaded PAUSE_OPTIONS texture;
// CREDITS loads its own banner (ui_-_words6 = the "CREDITS" word), LINEAR-
// filtered in PreloadScene like the other word banners.
export const LANDING_CREDITS_TEXTURE_KEY = 'landing_word_credits';
export const LANDING_CREDITS_ASSET_PATH =
  '/DarkSpriteLib/general/ui/words/words_with_bg/ui_-_words6.png';
// OPTIONS + CREDITS render smaller than START so the primary action stays
// visually dominant; GAP_PX is the canvas-pixel gap between stacked banners.
export const LANDING_MENU_BUTTON_DISPLAY_SCALE = 1.0;
export const LANDING_MENU_BUTTON_GAP_PX = 22;

// Credits panel title (CreditsOverlay). Reuses the game name; the individual
// credit lines are presentation data defined alongside the overlay itself
// (mirroring OptionsOverlay's CATEGORIES).
export const CREDITS_TITLE_TEXT = LANDING_TITLE_TEXT;

// Fade durations for the click → black → gameplay transition. Matched in
// and out so the visible pulse feels symmetric.
export const LANDING_FADE_OUT_MS = 600;
export const LANDING_FADE_IN_MS = 600;
// Dwell on full black between the fade-out landing and the fade-in starting.
// gameplay is set up under the black at the start of this hold (ambience kicks
// in), then the world reveals once it elapses — a beat of darkness that makes
// the descent into the level feel more dramatic.
export const LANDING_BLACK_HOLD_MS = 1400;

// Viewport fractions for the landing-page layout. Player is anchored at 25%
// from the left of the screen; START button at BUTTON_FRACTION_X across and
// BUTTON_FRACTION_Y down. GameScene positions the camera (via centerOn) so
// the player lands on PLAYER_FRACTION_X; LandingScene positions the button
// at the BUTTON_FRACTION values on the overlay camera's canvas dimensions.
// Smaller BUTTON_FRACTION_Y = higher on screen.
export const LANDING_PLAYER_VIEWPORT_FRACTION_X = 0.25;
export const LANDING_BUTTON_VIEWPORT_FRACTION_X = 0.25;
export const LANDING_BUTTON_VIEWPORT_FRACTION_Y = 0.32;
// World-px shift applied to the landing camera's centerY on top of the
// spawn level's vertical midpoint. Positive = camera moves down in world
// space (the visible area shifts down, so anything anchored above —
// including the player — reads HIGHER on screen). Tune to compose the
// shot; 0 leaves the camera exactly at the level midpoint.
export const LANDING_CAMERA_Y_OFFSET_PX = 50;

// Screen-edge corner brackets. Each corner of the viewport gets a thin
// white L-shape (two perpendicular line segments meeting at the corner).
// No connecting strokes between corners — the brackets alone frame the
// shot without imposing a full rectangle. MARGIN_PX pulls the bracket
// vertices off the canvas edge so the lines aren't clipped; LENGTH_PX
// is the leg length of each L.
export const LANDING_SCREEN_FRAME_MARGIN_PX = 28;
export const LANDING_SCREEN_FRAME_COLOR = 0xffffff;
export const LANDING_SCREEN_FRAME_STROKE_PX = 2;
export const LANDING_SCREEN_BRACKET_LENGTH_PX = 72;

// Screen-edge vignette: four black gradient strips fading from opaque at
// the viewport edge to transparent at THICKNESS_PX inward, painted by the
// LandingScene above the world but below the START button and screen
// frame. Reads as soft darkening at the edges so the eye is drawn toward
// the player + button composition.
export const LANDING_VIGNETTE_COLOR = 0x000000;
export const LANDING_VIGNETTE_THICKNESS_PX = 380;
export const LANDING_VIGNETTE_EDGE_ALPHA = 0.8;

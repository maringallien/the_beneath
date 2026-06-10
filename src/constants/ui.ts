// World-space interaction UI: the hold-E icon, save toast, and the
// key-door prompt/message.

// Default proximity range (source px) at which an interactable advertises its
// E icon. Chests are small (14-22 px wide bodies) — at 36 px the icon appears
// about one body-width before the player would naturally bump the chest, so
// the prompt reads as "you're close" rather than "you're already there".
// Squared form is consumed by InteractionManager; recompute when changing.
export const INTERACTION_RANGE_PX = 36;
export const INTERACTION_RANGE_SQ = INTERACTION_RANGE_PX * INTERACTION_RANGE_PX;

// Hold time (ms) to commit an interaction. 500 ms is short enough to feel
// responsive on a chest but long enough to defeat accidental brushes against
// the E key while running.
export const INTERACTION_HOLD_DURATION_MS = 500;

// E icon dimensions (source px). Sized to sit beside chests without
// overlapping the lid; at CAMERA_ZOOM=3 a 9 px box renders ~27 canvas px.
export const INTERACTION_ICON_SIZE_PX = 9;
// Source-px gap above the interactable's anchor point. Stacks the icon
// clear of the closed chest lid (chest1 is 19 px tall, body top sits a few
// px above world center) with a small breathing margin.
export const INTERACTION_ICON_OFFSET_Y_PX = 6;
// Visual styling. The black border was removed in favor of the progress
// outline being the sole framing element while held.
export const INTERACTION_ICON_BG_COLOR = 0xffffff;
export const INTERACTION_ICON_LETTER_COLOR = '#000000';
// Authored at 2× the visible size so the source canvas has enough resolution
// for LINEAR filtering to anti-alias the glyph. Combined with
// INTERACTION_ICON_LETTER_SCALE the on-screen letter ends up the same visual
// size as the prior 7px monospace render but with smooth edges.
export const INTERACTION_ICON_FONT_SIZE_PX = 14;
export const INTERACTION_ICON_LETTER_SCALE = 0.5;
// Sans-serif stack rasterizes smoother than monospace at small sizes and
// keeps the glyph readable across OSes (Arial on Win/macOS, Helvetica on
// macOS, the platform sans-serif fallback elsewhere).
export const INTERACTION_ICON_FONT_FAMILY = 'Arial, Helvetica, sans-serif';

// Progress outline drawn around the box while E is held. Cyan reads as
// "active" against the white box and isn't claimed by any other UI element
// in this project (HP red, MAG dark-red, STA teal — none of them cyan).
export const INTERACTION_ICON_PROGRESS_COLOR = 0x66ddff;
export const INTERACTION_ICON_PROGRESS_STROKE_PX = 1;
// Gap between the icon's box edge and the progress outline (source px).
// Keeps the outline from visually merging with the white background.
export const INTERACTION_ICON_PROGRESS_EDGE_OFFSET_PX = 2;

// Alpha lerp rate (per ms) for icon fade in/out. 1/120 ≈ ~120 ms to fully
// fade — quick enough that walking past a chest doesn't leave the icon
// hovering, slow enough to read as a deliberate UI element rather than a
// pop. Manager does its own approach() per frame; no tweens (HMR-safe).
export const INTERACTION_ICON_FADE_RATE = 1 / 120;


// Floating "Game Saved" text shown above a Save crystal on successful save.
// Source-px font size — the toast text uses CAMERA_ZOOM resolution like the
// HUD so it stays crisp at zoom. Lifespan is the total time before destroy;
// alpha tweens from 1 to 0 over the same window for a smooth fade-out.
export const SAVE_TOAST_TEXT = 'Game Saved';
export const SAVE_TOAST_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const SAVE_TOAST_FONT_SIZE_PX = 6;
export const SAVE_TOAST_COLOR = '#ffffff';
export const SAVE_TOAST_DURATION_MS = 1500;
// Source-px gap above the crystal's body.top so the text floats clear of the
// sprite silhouette.
export const SAVE_TOAST_OFFSET_Y_PX = 12;
// Source-px upward drift over the toast's lifetime — gentle "rises and fades"
// motion rather than a static pop.
export const SAVE_TOAST_RISE_PX = 6;

// Source-px gap above a key-locked door's body.top for the E icon anchor —
// mirrors Chest's ICON_ANCHOR_GAP_PX so the prompt floats clear of the lintel.
export const KEY_DOOR_ICON_ANCHOR_GAP_PX = 2;
// Slightly wider interaction range than the default (door bodies are 21×24 and
// the player stands flush against the solid leaf) so the E prompt reliably
// appears when the player is pressed up to the locked door.
export const KEY_DOOR_INTERACTION_RANGE_PX = 44;
export const KEY_DOOR_INTERACTION_RANGE_SQ =
  KEY_DOOR_INTERACTION_RANGE_PX * KEY_DOOR_INTERACTION_RANGE_PX;

// Bottom-of-screen fade message shown when the player tries a locked door
// without its key. World-anchored to the camera's view (like SAVE_TOAST) and
// rendered at CAMERA_ZOOM resolution so it stays crisp; fades in, holds, fades
// out, then destroys.
export const KEY_DOOR_MESSAGE_TEXT = 'You must find the key to open this door';
export const KEY_DOOR_MESSAGE_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const KEY_DOOR_MESSAGE_FONT_SIZE_PX = 7;
export const KEY_DOOR_MESSAGE_COLOR = '#ffffff';
// Source-px gap from the camera view's bottom edge so the line sits just inside
// the frame rather than flush against it.
export const KEY_DOOR_MESSAGE_BOTTOM_MARGIN_PX = 18;
export const KEY_DOOR_MESSAGE_FADE_IN_MS = 200;
export const KEY_DOOR_MESSAGE_HOLD_MS = 1500;
export const KEY_DOOR_MESSAGE_FADE_OUT_MS = 400;

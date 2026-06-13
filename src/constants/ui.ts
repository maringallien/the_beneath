/**
 * ui constants — world-space interaction UI tuning.
 *
 * Layout, timing, color, and text for the in-world prompts: the hold-E icon
 * (proximity range, hold duration, fade, progress outline), the floating
 * "Game Saved" toast, and the key-door anchor plus "find the key" message.
 * Sizes are authored in source pixels and scale up at CAMERA_ZOOM; squared
 * range forms are precomputed here so callers skip the per-frame multiply.
 *
 * Inputs:  none — compile-time constants.
 * Outputs: the INTERACTION_*, SAVE_TOAST_*, and KEY_DOOR_* tuning values below.
 * @calledby the interaction manager and the hold-E icon renderer, the save-toast
 *           spawner, and the key-locked door's prompt anchor and fade message.
 * @calls    nothing — a leaf data module.
 */

// Icon appears ~one body-width before the player bumps the chest, so it reads as "close" not "there".
// Squared form consumed by InteractionManager; recompute when changing.
export const INTERACTION_RANGE_PX = 36;
export const INTERACTION_RANGE_SQ = INTERACTION_RANGE_PX * INTERACTION_RANGE_PX;

// Long enough to beat accidental key brushes while running; short enough to feel responsive.
export const INTERACTION_HOLD_DURATION_MS = 500;

// 9 px sits beside a chest without overlapping the lid; renders ~27 canvas px at zoom 3.
export const INTERACTION_ICON_SIZE_PX = 9;
export const INTERACTION_ICON_OFFSET_Y_PX = 6;
export const INTERACTION_ICON_BG_COLOR = 0xffffff;
export const INTERACTION_ICON_LETTER_COLOR = '#000000';
// 2× visible size so LINEAR filtering anti-aliases the glyph; LETTER_SCALE halves it back down.
export const INTERACTION_ICON_FONT_SIZE_PX = 14;
export const INTERACTION_ICON_LETTER_SCALE = 0.5;
export const INTERACTION_ICON_FONT_FAMILY = 'Arial, Helvetica, sans-serif';

// Cyan isn't used elsewhere in the UI so "active hold" reads unambiguously.
export const INTERACTION_ICON_PROGRESS_COLOR = 0x66ddff;
export const INTERACTION_ICON_PROGRESS_STROKE_PX = 1;
// Keeps the outline from merging with the white background.
export const INTERACTION_ICON_PROGRESS_EDGE_OFFSET_PX = 2;

// ~120ms fade; no tweens so it's HMR-safe (manager does its own lerp per frame).
export const INTERACTION_ICON_FADE_RATE = 1 / 120;


// Rises and fades over DURATION_MS — source px, CAMERA_ZOOM-rendered like the HUD.
export const SAVE_TOAST_TEXT = 'Game Saved';
export const SAVE_TOAST_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const SAVE_TOAST_FONT_SIZE_PX = 6;
export const SAVE_TOAST_COLOR = '#ffffff';
export const SAVE_TOAST_DURATION_MS = 1500;
export const SAVE_TOAST_OFFSET_Y_PX = 12;
export const SAVE_TOAST_RISE_PX = 6;

// Wider than default so the prompt reliably shows when the player is pressed flush against the door.
export const KEY_DOOR_ICON_ANCHOR_GAP_PX = 2;
export const KEY_DOOR_INTERACTION_RANGE_PX = 44;
export const KEY_DOOR_INTERACTION_RANGE_SQ =
  KEY_DOOR_INTERACTION_RANGE_PX * KEY_DOOR_INTERACTION_RANGE_PX;

export const KEY_DOOR_MESSAGE_TEXT = 'You must find the key to open this door';
export const KEY_DOOR_MESSAGE_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const KEY_DOOR_MESSAGE_FONT_SIZE_PX = 7;
export const KEY_DOOR_MESSAGE_COLOR = '#ffffff';
// Sits just inside the bottom frame rather than flush against the edge.
export const KEY_DOOR_MESSAGE_BOTTOM_MARGIN_PX = 18;
export const KEY_DOOR_MESSAGE_FADE_IN_MS = 200;
export const KEY_DOOR_MESSAGE_HOLD_MS = 1500;
export const KEY_DOOR_MESSAGE_FADE_OUT_MS = 400;

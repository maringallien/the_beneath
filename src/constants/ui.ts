/**
 * @file constants/ui.ts
 * @description World-space interaction-prompt tuning — the hold-E icon (range, hold, glyph, progress outline, fade), the "Game Saved" toast, and the key-door anchor plus "find the key" message. Sizes are source px, scaled at CAMERA_ZOOM.
 * @module constants
 */

// ── Hold-E interaction icon ────────────────────────────────────────────────
// The icon appears ~one body-width before the player bumps the chest so it reads as "close" not "there"; the
// squared range is precomputed for InteractionManager (recompute when changing). Hold duration is long enough to
// beat accidental key brushes while running, short enough to feel responsive. The 9px icon sits beside a chest
// without overlapping the lid (~27 canvas px at zoom 3); the glyph is authored at 2× then LETTER_SCALE halves it
// so LINEAR filtering anti-aliases it. Cyan progress isn't used elsewhere in the UI so "active hold" reads
// unambiguously, and its edge offset keeps the outline from merging with the white background. The ~120ms fade
// uses no tweens so it's HMR-safe (the manager does its own per-frame lerp).
export const INTERACTION_RANGE_PX = 36;
export const INTERACTION_RANGE_SQ = INTERACTION_RANGE_PX * INTERACTION_RANGE_PX;
export const INTERACTION_HOLD_DURATION_MS = 500;
export const INTERACTION_ICON_SIZE_PX = 9;
export const INTERACTION_ICON_OFFSET_Y_PX = 6;
export const INTERACTION_ICON_BG_COLOR = 0xffffff;
export const INTERACTION_ICON_LETTER_COLOR = '#000000';
export const INTERACTION_ICON_FONT_SIZE_PX = 14;
export const INTERACTION_ICON_LETTER_SCALE = 0.5;
export const INTERACTION_ICON_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const INTERACTION_ICON_PROGRESS_COLOR = 0x66ddff;
export const INTERACTION_ICON_PROGRESS_STROKE_PX = 1;
export const INTERACTION_ICON_PROGRESS_EDGE_OFFSET_PX = 2;
export const INTERACTION_ICON_FADE_RATE = 1 / 120;

// ── "Game Saved" toast ─────────────────────────────────────────────────────
// Rises and fades over DURATION — source px, CAMERA_ZOOM-rendered like the HUD.
export const SAVE_TOAST_TEXT = 'Game Saved';
export const SAVE_TOAST_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const SAVE_TOAST_FONT_SIZE_PX = 6;
export const SAVE_TOAST_COLOR = '#ffffff';
export const SAVE_TOAST_DURATION_MS = 1500;
export const SAVE_TOAST_OFFSET_Y_PX = 12;
export const SAVE_TOAST_RISE_PX = 6;

// ── Key-door prompt & message ──────────────────────────────────────────────
// The interaction range is wider than the default so the prompt reliably shows when the player is pressed flush
// against the door; the squared form is precomputed. The "find the key" message sits just inside the bottom frame
// (not flush to the edge) and fades in/holds/fades out.
export const KEY_DOOR_ICON_ANCHOR_GAP_PX = 2;
export const KEY_DOOR_INTERACTION_RANGE_PX = 44;
export const KEY_DOOR_INTERACTION_RANGE_SQ =
  KEY_DOOR_INTERACTION_RANGE_PX * KEY_DOOR_INTERACTION_RANGE_PX;
export const KEY_DOOR_MESSAGE_TEXT = 'You must find the key to open this door';
export const KEY_DOOR_MESSAGE_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const KEY_DOOR_MESSAGE_FONT_SIZE_PX = 7;
export const KEY_DOOR_MESSAGE_COLOR = '#ffffff';
export const KEY_DOOR_MESSAGE_BOTTOM_MARGIN_PX = 18;
export const KEY_DOOR_MESSAGE_FADE_IN_MS = 200;
export const KEY_DOOR_MESSAGE_HOLD_MS = 1500;
export const KEY_DOOR_MESSAGE_FADE_OUT_MS = 400;

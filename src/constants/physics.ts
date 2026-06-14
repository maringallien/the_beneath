/**
 * @file constants/physics.ts
 * @description World gravity and camera framing — the Arcade world's gravity, plus camera zoom, vertical follow offset, and the per-frame lag clamp for fast falls.
 * @module constants
 */

// ── World gravity ──────────────────────────────────────────────────────────
// Global downward gravity the Arcade world runs under; movement and leap code integrate against it.
export const GRAVITY_Y = 800;

// ── Camera framing ─────────────────────────────────────────────────────────
// Sprites are small (90x37) so zoom 3 keeps the character readable on typical desktops. The positive
// vertical offset pulls the camera up (player sits one body below center with headroom); the slow follow
// lerp can't keep up with terminal-velocity falls, so the per-frame lag clamp keeps the player on screen.
export const CAMERA_ZOOM = 3;
export const CAMERA_VERTICAL_OFFSET_PX = 36;
export const CAMERA_MAX_VERTICAL_LAG_PX = 50;

/**
 * physics constants — world gravity and camera framing.
 *
 * Pure tuning data: the global gravity the Arcade world runs under, plus the
 * camera zoom, vertical follow offset, and the per-frame lag clamp that keeps
 * the player on screen through fast falls. Re-exported through the constants
 * barrel, so call sites import from '../constants'.
 *
 * Inputs:  none — compile-time constants.
 * Outputs: GRAVITY_Y and the CAMERA_* framing values below.
 * @calledby the gameplay scene's world/physics setup and camera follow rig, and
 *           any movement or leap code that integrates against world gravity.
 * @calls    nothing — a leaf data module.
 */

export const GRAVITY_Y = 800;

// Sprites are small (90x37); zoom 3 keeps the character readable on typical desktops.
export const CAMERA_ZOOM = 3;

// Positive value pulls camera up, so the player sits one body below center with headroom above.
export const CAMERA_VERTICAL_OFFSET_PX = 36;

// The slow lerp can't keep up with terminal-velocity falls; this per-frame clamp keeps the player on screen.
export const CAMERA_MAX_VERTICAL_LAG_PX = 50;

// World physics and camera framing.

export const GRAVITY_Y = 800;

// Camera zoom multiplier in GameScene. Higher = more zoomed-in on the player.
// Pixel-art sprites are small (sword_master frame is 90x37); zoom 3 keeps the
// character readable across typical desktop window sizes.
export const CAMERA_ZOOM = 3;

// Vertical follow offset in world units. Phaser subtracts this from the
// target's position when computing scroll, so a positive value pulls the
// camera up and the player renders below screen center. 36 ≈ one character
// length (sword_master frame is 37 px tall) — the player sits roughly one
// body below the vertical midpoint, leaving most of the viewport as headroom.
export const CAMERA_VERTICAL_OFFSET_PX = 36;

// Maximum world-pixel distance the camera is allowed to drift from its
// follow-offset target. The slow lerp (0.08) feels buttery on jumps but
// can't keep up with terminal-velocity falls — at ~15 px/frame the steady
// lag would push the player off screen. Per-frame clamp to this radius
// guarantees the player stays visible regardless of fall speed.
export const CAMERA_MAX_VERTICAL_LAG_PX = 50;

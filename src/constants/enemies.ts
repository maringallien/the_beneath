/**
 * enemies constants — non-boss enemy combat, AI, and HUD tuning.
 *
 * Pure tuning data (no logic) for regular enemies: health scaling, the in-combat
 * window and respawn gating (time + distance), the floating health bar, the
 * stealth/vision detection model, A* grid navigation thresholds, and the
 * transient alert ("?"/"!") icons. Re-exported through the constants barrel, so
 * call sites import from '../constants'.
 *
 * Inputs:  none — compile-time constants.
 * Outputs: the named health, combat, respawn, detection, nav, and icon values below.
 * @calledby the enemy entity and its detection/locomotion code, the respawn
 *           manager, the floating health-bar and alert-icon rigs, and the A*
 *           grid pathfinder.
 * @calls    nothing — a leaf data module.
 */

// Single knob to scale all non-boss HP without touching ~40 registry entries; bosses are exempt.
export const ENEMY_HEALTH_MULTIPLIER = 1.5;

// After this window without player-dealt damage, HP resets and the health bar hides. Trap/fall don't refresh it.
export const ENEMY_COMBAT_TIMEOUT_MS = 20_000;

// Respawn requires BOTH gates to clear; bosses are always exempt.
// ~3600 px ≈ eight screens — you must clearly leave the region, not just the next room.
export const ENEMY_RESPAWN_MIN_DISTANCE_PX = 3600;
// 5-min time floor so a fast sprint out of range doesn't make enemies feel like they returned instantly.
export const ENEMY_RESPAWN_MIN_TIME_MS = 300_000;
// 1Hz scan throttle — frequent enough to notice the threshold, cheap enough to run every tick.
export const ENEMY_RESPAWN_CHECK_INTERVAL_MS = 1000;
// Source pixels; camera zoom scales the visible size.
export const ENEMY_HEALTH_BAR_WIDTH_PX = 24;
export const ENEMY_HEALTH_BAR_HEIGHT_PX = 3;
// Gap above body.top — just enough to clear the sprite outline.
export const ENEMY_HEALTH_BAR_OFFSET_Y_PX = 6;
export const ENEMY_HEALTH_BAR_FG_COLOR = 0xff3333;
export const ENEMY_HEALTH_BAR_BG_COLOR = 0x000000;
export const ENEMY_HEALTH_BAR_BG_ALPHA = 0.7;
export const ENEMY_HEALTH_BAR_OUTLINE_COLOR = 0x000000;

// ── Stealth / enemy detection ───────────────────────────────────────────
// Detection = within range + inside forward cone + clear LOS; near-radius bypasses the cone.

// Default sight range when behavior.detectionRange is unset. ~14 tiles.
export const ENEMY_DETECTION_RANGE_PX = 220;
// Half-angle of the forward vision cone — 55° ≈ a 110° frontal cone. Per-enemy override: behavior.visionHalfAngleDeg.
export const ENEMY_VISION_HALF_ANGLE_DEG = 55;
// Inside this radius the player is always seen regardless of facing.
export const ENEMY_VISION_NEAR_RADIUS_PX = 26;
// Hold-still + "?" beat before rushing to investigate; long enough to notice, short enough to feel reactive.
export const ENEMY_SPOT_STOP_MS = 500;
// After this window without a hit, enemy relaxes from red "!" back to yellow "?".
export const ENEMY_CONFLICT_WINDOW_MS = 1500;
// Chase speed boost on detection; bosses are exempt. Per-enemy override: behavior.alertSpeedMul.
export const ENEMY_ALERT_SPEED_MUL = 1.25;
// Faster than ENEMY_ALERT_SPEED_MUL so a faraway gunshot is closed on urgently.
export const ENEMY_HUNT_SPEED_MUL = 1.6;
// How long the enemy scans the last-seen area before giving up and returning to post.
export const ENEMY_SEARCH_LOOK_MS = 2500;
// Travel backstop — only fires if the spot is unreachable; normal termination is arrival.
export const ENEMY_SEARCH_TRAVEL_TIMEOUT_MS = 20_000;
// If heading home makes no headway for this long, the enemy settles rather than pacing forever.
export const ENEMY_RETURN_POST_TIMEOUT_MS = 5_000;
// ── Enemy navigation (A* grid pathfinding over the IntGrid) ──────────────────
// Caps the cost of a hopeless search so the enemy bails and falls back to reactive locomotion.
export const NAV_MAX_EXPANSIONS = 2000;
// Replan cadence; between replans the enemy follows cached waypoints (~3 Hz, not per-frame).
export const NAV_REPLAN_INTERVAL_MS = 350;
// Y is looser so a landing slightly above/below the node still counts as reached.
export const NAV_WAYPOINT_REACH_X_PX = 12;
export const NAV_WAYPOINT_REACH_Y_PX = 28;
// Stall = no waypoint advanced for this long; catches bouncing on unmakeable jumps or a now-closed door.
export const NAV_STALL_MS = 900;
// After a stall, use reactive locomotion for this beat instead of immediately re-pathing the same bad route.
export const NAV_STALL_COOLDOWN_MS = 1200;
// Don't replan until the target has drifted this many tiles — stops a walking player from thrashing the path.
export const NAV_GOAL_HYSTERESIS_TILES = 2;
// Keep following the nav route this long after LOS returns — avoids dropping the path on a single clear frame at a jump apex.
export const NAV_LOS_GRACE_MS = 200;
// How often a searching enemy flips direction while scanning the last-seen area.
export const ENEMY_SEARCH_FLIP_MS = 600;
export const ENEMY_SEARCH_REACH_DIST_PX = 20;
// Much larger than vision range so gunshots are conspicuous; the sword/magic stay the stealthy options.
export const ENEMY_GUNSHOT_HEARING_RADIUS_PX = 700;
// No-op when the id isn't registered — the system runs fine until the asset is wired in.
export const ENEMY_ALERT_STING_SOUND_ID = 'enemy_alert';

// Larger gap than the health bar so the glyph clears it when both are visible.
export const ENEMY_ALERT_ICON_OFFSET_Y_PX = 13;
export const ENEMY_ALERT_ICON_HEIGHT_PX = 9;
// Momentary tell — pops on escalation then clears; HUD corners are the lasting readout.
export const ENEMY_ALERT_ICON_HOLD_MS = 1200;
// Amber "?" investigating, red "!" conflict; red matches health-bar crimson.
export const ENEMY_ALERT_ICON_SUSPECT_COLOR = 0xffd23f;
export const ENEMY_ALERT_ICON_DETECT_COLOR = 0xff3b30;

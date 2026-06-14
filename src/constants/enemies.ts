/**
 * @file constants/enemies.ts
 * @description Non-boss enemy combat/AI/HUD tuning — HP scaling, the in-combat window, time+distance respawn gating, the floating health bar, the stealth/vision model, A* grid-nav thresholds, and the transient "?"/"!" alert icons.
 * @module constants
 */

// ── Health scaling ─────────────────────────────────────────────────────────
// Single knob to scale all non-boss HP without touching ~40 registry entries; bosses are exempt.
export const ENEMY_HEALTH_MULTIPLIER = 1.5;

// ── Combat window & respawn gating ─────────────────────────────────────────
// After ENEMY_COMBAT_TIMEOUT without player-dealt damage, HP resets and the health bar hides (trap/fall don't
// refresh it). Respawn requires BOTH gates to clear (bosses always exempt): ~3600 px ≈ eight screens, so you
// must clearly leave the region, not just the next room; and a 5-min time floor so sprinting out of range
// doesn't make enemies feel like they returned instantly. The check runs at 1 Hz — frequent enough to notice
// the threshold, cheap enough to run every tick.
export const ENEMY_COMBAT_TIMEOUT_MS = 20_000;
export const ENEMY_RESPAWN_MIN_DISTANCE_PX = 3600;
export const ENEMY_RESPAWN_MIN_TIME_MS = 300_000;
export const ENEMY_RESPAWN_CHECK_INTERVAL_MS = 1000;

// ── Floating health bar ────────────────────────────────────────────────────
// Source pixels; camera zoom scales the visible size. OFFSET_Y is the gap above body.top — just enough to clear
// the sprite outline.
export const ENEMY_HEALTH_BAR_WIDTH_PX = 24;
export const ENEMY_HEALTH_BAR_HEIGHT_PX = 3;
export const ENEMY_HEALTH_BAR_OFFSET_Y_PX = 6;
export const ENEMY_HEALTH_BAR_FG_COLOR = 0xff3333;
export const ENEMY_HEALTH_BAR_BG_COLOR = 0x000000;
export const ENEMY_HEALTH_BAR_BG_ALPHA = 0.7;
export const ENEMY_HEALTH_BAR_OUTLINE_COLOR = 0x000000;

// ── Stealth / detection ────────────────────────────────────────────────────
// Detection = within range + inside the forward cone + clear LOS; the near-radius bypasses the cone (player
// always seen inside it regardless of facing). Default sight range (~14 tiles) and the 55° half-angle (≈110°
// frontal cone) have per-enemy overrides (behavior.detectionRange / .visionHalfAngleDeg). On spotting, the enemy
// holds still for a "?" beat before rushing (long enough to notice, short enough to feel reactive); after the
// conflict window with no hit it relaxes red "!" → yellow "?". Alert speed boosts the chase (bosses exempt,
// override behavior.alertSpeedMul); hunt speed is faster still so a faraway gunshot is closed on urgently.
// When investigating it scans the last-seen area for SEARCH_LOOK before giving up; the travel timeout is a
// backstop that only fires if the spot is unreachable (normal termination is arrival); and if heading home
// makes no headway for RETURN_POST it settles rather than pacing forever.
export const ENEMY_DETECTION_RANGE_PX = 220;
export const ENEMY_VISION_HALF_ANGLE_DEG = 55;
export const ENEMY_VISION_NEAR_RADIUS_PX = 26;
export const ENEMY_SPOT_STOP_MS = 500;
export const ENEMY_CONFLICT_WINDOW_MS = 1500;
export const ENEMY_ALERT_SPEED_MUL = 1.25;
export const ENEMY_HUNT_SPEED_MUL = 1.6;
export const ENEMY_SEARCH_LOOK_MS = 2500;
export const ENEMY_SEARCH_TRAVEL_TIMEOUT_MS = 20_000;
export const ENEMY_RETURN_POST_TIMEOUT_MS = 5_000;

// ── Navigation (A* grid pathfinding over the IntGrid) ──────────────────────
// MAX_EXPANSIONS caps the cost of a hopeless search so the enemy bails to reactive locomotion. Between replans
// (~3 Hz, not per-frame) it follows cached waypoints; the Y reach tolerance is looser than X so a landing
// slightly above/below the node still counts as reached. A stall (no waypoint advanced for NAV_STALL_MS) catches
// bouncing on unmakeable jumps or a now-closed door, after which it uses reactive locomotion for a cooldown
// instead of immediately re-pathing the same bad route. Goal hysteresis stops a walking player from thrashing
// the path, and the LOS grace keeps the route briefly after LOS returns so a single clear frame at a jump apex
// doesn't drop it. The search flip/reach govern how a searching enemy sweeps the last-seen area. Gunshot hearing
// is much larger than vision range so gunshots are conspicuous — sword/magic stay the stealthy options. The
// alert sting id is a no-op until the asset is wired in (the system runs fine without it).
export const NAV_MAX_EXPANSIONS = 2000;
export const NAV_REPLAN_INTERVAL_MS = 350;
export const NAV_WAYPOINT_REACH_X_PX = 12;
export const NAV_WAYPOINT_REACH_Y_PX = 28;
export const NAV_STALL_MS = 900;
export const NAV_STALL_COOLDOWN_MS = 1200;
export const NAV_GOAL_HYSTERESIS_TILES = 2;
export const NAV_LOS_GRACE_MS = 200;
export const ENEMY_SEARCH_FLIP_MS = 600;
export const ENEMY_SEARCH_REACH_DIST_PX = 20;
export const ENEMY_GUNSHOT_HEARING_RADIUS_PX = 700;
export const ENEMY_ALERT_STING_SOUND_ID = 'enemy_alert';

// ── Alert icons ("?"/"!") ──────────────────────────────────────────────────
// Momentary tell — pops on escalation then clears; the HUD corners are the lasting readout. OFFSET_Y is a larger
// gap than the health bar so the glyph clears it when both show. Amber "?" = investigating, red "!" = conflict
// (red matches the health-bar crimson).
export const ENEMY_ALERT_ICON_OFFSET_Y_PX = 13;
export const ENEMY_ALERT_ICON_HEIGHT_PX = 9;
export const ENEMY_ALERT_ICON_HOLD_MS = 1200;
export const ENEMY_ALERT_ICON_SUSPECT_COLOR = 0xffd23f;
export const ENEMY_ALERT_ICON_DETECT_COLOR = 0xff3b30;

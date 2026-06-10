// Enemy tuning: health scaling, combat windows, respawn gating, the
// floating health bar, stealth/detection, A* navigation, and alert icons.

// Global multiplier applied to every non-boss enemy's authored
// behavior.health to set its effective max HP (Enemy computes
// round(health × this) at construction). A single knob to make regular
// fights tougher without re-tuning all ~40 registry entries. Bosses
// (behavior.isBoss) are exempt — their health is hand-tuned around the
// round-fight thresholds. Set to 1 to disable the bump.
export const ENEMY_HEALTH_MULTIPLIER = 1.5;

// Time window (ms) an enemy stays "in combat" after its last player-dealt
// damage. Once the window lapses, HP snaps back to its max and the floating
// health bar hides. Trap/fall damage does not refresh the timer.
export const ENEMY_COMBAT_TIMEOUT_MS = 20_000;

// Respawn is gated on BOTH a time cooldown and a travel distance: a killed
// non-boss enemy comes back only once at least ENEMY_RESPAWN_MIN_TIME_MS has
// elapsed since its death AND the player is at least
// ENEMY_RESPAWN_MIN_DISTANCE_PX (source px) from the enemy's original spawn
// point. Whichever gate clears last wins, so the two compound into a strictly
// less-frequent respawn. Bosses (behavior.isBoss === true) opt out entirely.
//
// Distance ~3600 px ≈ eight screens at the 28-tile-wide view (gridSize 16,
// CAMERA_ZOOM 3): you must clearly leave the region, not just step into the
// next room. The manager compares squared distance, so there is no sqrt per
// scan. Keep this comfortably above the on-screen half-extent (~225 px) so a
// respawn can never materialize within view. Tradeoff: in a small/enclosed
// area where the player can't get this far, those enemies effectively never
// respawn — lower it if that proves too strict.
export const ENEMY_RESPAWN_MIN_DISTANCE_PX = 3600;
// Minimum time (ms) after death before a killed non-boss enemy is eligible to
// respawn, enforced together with ENEMY_RESPAWN_MIN_DISTANCE_PX. Five minutes
// keeps a cleared area cleared even if the player sprints out of range —
// without a time floor, crossing the distance threshold quickly made enemies
// feel like they returned instantly.
export const ENEMY_RESPAWN_MIN_TIME_MS = 300_000;
// Throttle (ms) for the respawn manager's per-tick scan. 1Hz is enough to
// notice the threshold within a perceptible window without burning CPU on a
// per-frame Map iteration that almost always returns "not yet".
export const ENEMY_RESPAWN_CHECK_INTERVAL_MS = 1000;
// Floating health-bar visuals. Width sized so the bar reads cleanly above
// small bandit-sized bodies (~16-32 px wide) and doesn't overpower tall boss
// frames; height kept thin so the bar feels like UI overlay rather than part
// of the sprite. Source pixels — camera zoom scales the final visible size.
export const ENEMY_HEALTH_BAR_WIDTH_PX = 24;
export const ENEMY_HEALTH_BAR_HEIGHT_PX = 3;
// Gap (source px) between body.top and the bar's bottom edge. Just enough to
// keep the bar clear of the sprite outline.
export const ENEMY_HEALTH_BAR_OFFSET_Y_PX = 6;
export const ENEMY_HEALTH_BAR_FG_COLOR = 0xff3333;
export const ENEMY_HEALTH_BAR_BG_COLOR = 0x000000;
export const ENEMY_HEALTH_BAR_BG_ALPHA = 0.7;
export const ENEMY_HEALTH_BAR_OUTLINE_COLOR = 0x000000;

// ── Stealth / enemy detection ───────────────────────────────────────────
// A stealth-enabled enemy spots the player within a detection radius AND inside
// its forward vision cone (it faces left/right, so a turned back is a blind
// spot), with a clear line — no collision tile between them.
//
// Default sight range (world px). Used when an entity authors no
// behavior.detectionRange and has no chaseRange to derive one from. ~14 tiles.
export const ENEMY_DETECTION_RANGE_PX = 220;
// Half-angle (degrees) of the forward vision cone — the player is spotted just
// inside ±this of the facing direction. 55° ≈ a 110° frontal cone. Per-enemy
// override: behavior.visionHalfAngleDeg.
export const ENEMY_VISION_HALF_ANGLE_DEG = 55;
// Point-blank radius (world px) inside which an enemy notices the player
// regardless of facing — you can't stand on its head undetected. Evaluated
// below the cone test, so a player pressed against the enemy is always seen.
export const ENEMY_VISION_NEAR_RADIUS_PX = 26;
// Stop-and-investigate telegraph: ms a freshly-spotting enemy holds still
// (showing the yellow "?") before it rushes to investigate. The readable "stop,
// then rush" beat — long enough to notice, short enough to feel reactive.
export const ENEMY_SPOT_STOP_MS = 500;
// Active-combat window: ms after an attack / contact hit during which the enemy
// reads as "conflict" (red "!") rather than merely "investigating" (yellow
// "?"). Refreshed on each blow, so a sustained fight stays red and only relaxes
// to yellow once the enemy stops landing hits. Keeps the red state off mere
// approach so enemies don't snap straight to "!".
export const ENEMY_CONFLICT_WINDOW_MS = 1500;
// On-the-hunt chase speed multiplier applied on top of an enemy's moveSpeed once
// it has detected the player, so the hunt visibly quickens versus its walk.
// Bosses are exempt (movement is hand-tuned). Per-enemy override:
// behavior.alertSpeedMul.
export const ENEMY_ALERT_SPEED_MUL = 1.25;
// Travel pace while hunting a last-seen / heard spot the enemy can't currently
// see (updateSearch), applied on top of moveSpeed. Higher than
// ENEMY_ALERT_SPEED_MUL so a faraway gunshot is closed on urgently — the hunt is
// a committed beeline to the spot, not the cautious in-sight chase. Kept separate
// so the chase tuning (alertSpeedMul, per-enemy overridable) is untouched.
export const ENEMY_HUNT_SPEED_MUL = 1.6;
// Look-around budget (ms): once a hunting enemy ARRIVES at the last-seen / heard
// spot (or is walled off from it), how long it scans the area — flipping to look
// each way — before giving up and returning to its post. Times the scan ONLY;
// travel to the spot is budgeted separately (ENEMY_SEARCH_TRAVEL_TIMEOUT_MS) so a
// distant gunshot is actually reached instead of the timer lapsing mid-walk.
export const ENEMY_SEARCH_LOOK_MS = 2500;
// Travel backstop (ms): the longest a hunt spends walking toward the spot before
// it stops and runs the look-around scan regardless. Normal termination is
// arrival; this only bites when the spot can't be reached by the hop-only hunt
// locomotion (no path). The aggro window is refreshed every travel step so a long
// trek to a distant shot never times out mid-walk — this is the real upper bound.
export const ENEMY_SEARCH_TRAVEL_TIMEOUT_MS = 20_000;
// Backstop for returning to post after a hunt: if an enemy heading home makes no
// headway toward its spawn for this long (route stalled, or the post is now
// unreachable — e.g. behind a closed door), it stops and settles where it is
// instead of pacing in place forever. The timer resets whenever it gets
// meaningfully closer, so a long legitimate walk home is never cut short.
export const ENEMY_RETURN_POST_TIMEOUT_MS = 5_000;
// ── Enemy navigation (A* grid pathfinding over the IntGrid) ──────────────────
// Max A* node expansions per path query. Caps the cost of a hopeless search (goal
// walled off / unreachable) so it bails in bounded time and the enemy falls back
// to reactive locomotion instead of scanning the whole world graph.
export const NAV_MAX_EXPANSIONS = 2000;
// How often (ms) an enemy re-runs A* while following a path. Between replans it
// follows its cached waypoints, so the search cost is ~3 Hz per blind enemy, not
// per frame.
export const NAV_REPLAN_INTERVAL_MS = 350;
// A waypoint counts as reached when the foot is within this horizontal / vertical
// world-px box of it, advancing the path to the next node. Y is looser so a
// landing a touch above/below the node still counts.
export const NAV_WAYPOINT_REACH_X_PX = 12;
export const NAV_WAYPOINT_REACH_Y_PX = 28;
// If a path-following enemy doesn't ADVANCE A WAYPOINT for this long, the route is
// abandoned. Progress is measured by waypoint advancement, NOT raw body movement —
// an enemy bouncing up and down on an unmakeable graph jump moves the body without
// getting anywhere, and a displacement-based check would never fire. Also catches a
// path through a now-closed door (doors are separate colliders the static graph
// can't see). Long enough that one slow walk/jump edge never false-trips it.
export const NAV_STALL_MS = 900;
// After abandoning a stalled route, suppress path-following for this long so the
// enemy uses reactive locomotion for a beat instead of immediately re-pathing the
// same unmakeable way — turning a continuous up/down bounce into, at worst, a brief
// occasional one.
export const NAV_STALL_COOLDOWN_MS = 1200;
// A moving target only forces a replan once it has drifted at least this many tiles
// from the cell the current path targets. Stops a walking player from thrashing the
// path (and the follow direction) every single tile it crosses.
export const NAV_GOAL_HYSTERESIS_TILES = 2;
// Grace window: once line-of-sight to the target returns, keep following the nav
// route for this long before dropping to direct homing. Bridges the momentary
// sightline an enemy gets at a jump's apex, so a single clear frame mid-route
// doesn't abandon the path and bounce.
export const NAV_LOS_GRACE_MS = 200;
// Cadence (ms) at which a searching enemy flips to face the other way while
// scanning its last-seen area ("looks around").
export const ENEMY_SEARCH_FLIP_MS = 600;
// Distance (world px) within which a searching/returning enemy counts as having
// reached its last-seen or post target and advances to the next behavior.
export const ENEMY_SEARCH_REACH_DIST_PX = 20;
// Gunfire is loud. Any stealth-enabled enemy within this radius (world px) of a
// shot the player fires is alerted to it — no line of sight needed, sound
// carries through walls — and investigates the exact spot it was fired from.
// Deliberately much larger than the vision range (ENEMY_DETECTION_RANGE_PX, 220)
// so guns are conspicuous and the silent sword/magic stay the stealthy option.
export const ENEMY_GUNSHOT_HEARING_RADIUS_PX = 1400;
// Sound id (soundRegistry) for the one-shot detection sting played the instant
// an enemy spots the player. A no-op when the id isn't registered (playOneShot
// returns null), so the system runs fine until an asset is wired in.
export const ENEMY_ALERT_STING_SOUND_ID = 'enemy_alert';

// Gap (source px) between body.top and the bottom of the glyph. Larger than the
// health bar's gap so the glyph clears the bar when both are visible.
export const ENEMY_ALERT_ICON_OFFSET_Y_PX = 13;
// Glyph height (source px) → font size; camera zoom scales the visible size.
export const ENEMY_ALERT_ICON_HEIGHT_PX = 9;
// How long (ms) a flashed glyph stays up before auto-hiding. The "?"/"!" are
// momentary tells, not persistent labels — they pop on an escalation then clear
// even while the enemy stays aware (the HUD corners are the lasting readout).
export const ENEMY_ALERT_ICON_HOLD_MS = 1200;
// Investigating = amber "?", conflict = red "!". Red matches the health-bar
// crimson so "spotted" reads as danger.
export const ENEMY_ALERT_ICON_SUSPECT_COLOR = 0xffd23f;
export const ENEMY_ALERT_ICON_DETECT_COLOR = 0xff3b30;

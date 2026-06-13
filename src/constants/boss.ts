/**
 * boss constants — boss-fight system, presentation, and key-progression tuning.
 *
 * Pure tuning data (no logic) for the boss encounters: the round/section fight's
 * timing, reinforcement waves, and self-copy split mechanic; the screen-pinned
 * boss health bar, "Round N" banner, and arena-escape warning; and the boss-key
 * progression that maps bosses → keys → locked doors and defines the win
 * condition. Re-exported through the constants barrel, so call sites import from
 * '../constants'. (The round COUNT lives next to the round math in
 * entities/bossRounds.ts, not here.)
 *
 * Inputs:  none — compile-time constants.
 * Outputs: the named round/reinforcement/self-copy, HUD, escape, and key-mapping
 *          values below.
 * @calledby the boss encounter controller and round/wave logic, the boss HUD
 *           bar/banner and arena-escape overlay rigs, the door-lock and run-progress
 *           systems, and the victory check.
 * @calls    nothing — a leaf data module.
 */

// ── Boss round-fight system ─────────────────────────────────────────────
// How long the boss freezes/is invulnerable during the "Round N" banner; fade-in+hold+fade-out below sum to this.
export const BOSS_ROUND_BREAK_MS = 1200;

// ── Boss round-fight reinforcements ─────────────────────────────────────
// LDtk marker for reinforcement spawn positions — no game logic, just world positions read at build time.
export const GENERAL_ENEMY_SPAWN_IDENTIFIER = 'General_enemy_spawn';

// Fallback enemy/count when no explicit roster is in bossWaves.ts.
export const BOSS_ROUND_REINFORCEMENT_IDENTIFIER = 'Ghoul_spawn';
export const BOSS_ROUND_REINFORCEMENTS_PER_SITE = 2;
// Round 1 uses pre-placed arena enemies; waves start at round 2.
export const BOSS_ROUND_FIRST_REINFORCED_ROUND = 2;
// Horizontal spread so multiple reinforcements at one site don't overlap.
export const REINFORCEMENT_SPAWN_SPACING_PX = 18;
// Small lift above the floor so the drop doesn't register as fall damage.
export const REINFORCEMENT_SPAWN_LIFT_PX = 20;
// Stagger between sites so a whole round's wave doesn't land in one frame.
export const REINFORCEMENT_SITE_STAGGER_MS = 350;

// ── Boss self-copies (round-fight "split" mechanic) ─────────────────────
// Copies deal no damage; low HP so they read as a regular enemy, not a sponge.
export const HEART_HOARDER_COPY_HEALTH = 40;
// Lateral spread so copies flank the boss instead of overlapping at spawn.
export const BOSS_SELF_COPY_SPAWN_OFFSET_PX = 90;
// Each copy chases toward its own X slot beside the player instead of all collapsing to the same point.
export const BOSS_SELF_COPY_CHASE_STANDOFF_PX = 110;
// Dead-zone around a horizontal-chase target; prevents jitter when a copy is already parked.
export const HORIZONTAL_CHASE_STANDOFF_DEADZONE_PX = 10;
// Per-frame nudge to keep hoarder family members from stacking; MIN_DX is wider than the body so a gap shows.
export const HOARDER_SEPARATION_MIN_DX_PX = 64;
export const HOARDER_SEPARATION_PUSH_SPEED = 2.5;

// Screen-wide boss bar pinned to viewport top; all sizes are screen px resolved at CAMERA_ZOOM.
// Distance from the viewport top to the boss name.
export const BOSS_BAR_TOP_MARGIN_PX = 12;
export const BOSS_BAR_WIDTH_FRACTION = 0.6;
export const BOSS_BAR_HEIGHT_PX = 8;
// Gap between the name's bottom and the bar's top.
export const BOSS_BAR_NAME_GAP_PX = 3;
export const BOSS_BAR_BG_COLOR = 0x1a0d0d;
export const BOSS_BAR_BG_ALPHA = 0.85;
export const BOSS_BAR_FRAME_COLOR = 0xffffff;
export const BOSS_BAR_FRAME_STROKE_PX = 1;
// Section dividers drawn at each 1/BOSS_ROUND_COUNT mark.
export const BOSS_BAR_DIVIDER_COLOR = 0x000000;
export const BOSS_BAR_DIVIDER_WIDTH_PX = 1;
// Crimson → amber → blood-red so the bar visibly shifts each section.
export const BOSS_BAR_ROUND_COLORS: ReadonlyArray<number> = [
  0xc81e1e, 0xe0860d, 0x7a0a0a,
];
export const BOSS_BAR_NAME_FONT_SIZE_PX = 7;
export const BOSS_BAR_NAME_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const BOSS_BAR_NAME_COLOR = '#f5e6c8';

// "Round N" banner — Nosifer display face, weight 'normal' (fake-bold smears the dripping glyphs).
export const BOSS_BANNER_FONT_SIZE_PX = 20;
export const BOSS_BANNER_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const BOSS_BANNER_FONT_WEIGHT = 'normal';
export const BOSS_BANNER_COLOR = '#f5e6c8';
export const BOSS_BANNER_STROKE_COLOR = '#3a0a0a';
export const BOSS_BANNER_STROKE_PX = 2;
// Above center so it doesn't cover the player.
export const BOSS_BANNER_VIEWPORT_FRACTION_Y = 0.34;
// Lifecycle timings (sum == BOSS_ROUND_BREAK_MS).
export const BOSS_BANNER_FADE_IN_MS = 200;
export const BOSS_BANNER_HOLD_MS = 700;
export const BOSS_BANNER_FADE_OUT_MS = 300;

// ── Leaving the combat zone (boss-fight escape) ──────────────────────────
// Countdown to fight reset when the player leaves the arena; screen-pinned like the rest of the boss UI.
export const BOSS_ESCAPE_GRACE_MS = 3000;
export const BOSS_ESCAPE_WARNING_TEXT = 'LEAVING COMBAT ZONE';
export const BOSS_ESCAPE_SUBTEXT = 'Return to continue the fight';
// Nosifer display face to match the round banner; no fake-bold.
export const BOSS_ESCAPE_WARNING_FONT_SIZE_PX = 14;
export const BOSS_ESCAPE_WARNING_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const BOSS_ESCAPE_WARNING_COLOR = '#f3d27a';
export const BOSS_ESCAPE_WARNING_STROKE_COLOR = '#3a0a0a';
export const BOSS_ESCAPE_WARNING_STROKE_PX = 2;
// Larger than the headline so it reads as the urgent element.
export const BOSS_ESCAPE_COUNTDOWN_FONT_SIZE_PX = 28;
export const BOSS_ESCAPE_COUNTDOWN_COLOR = '#ffffff';
// Hint line below the counter.
export const BOSS_ESCAPE_SUBTEXT_FONT_SIZE_PX = 7;
export const BOSS_ESCAPE_SUBTEXT_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const BOSS_ESCAPE_SUBTEXT_COLOR = '#d8c4a0';
// Above center so it doesn't sit on the player while they flee.
export const BOSS_ESCAPE_VIEWPORT_FRACTION_Y = 0.4;
// Screen-px gap between the three stacked lines.
export const BOSS_ESCAPE_LINE_GAP_PX = 4;
// Fades in on appear; snaps off instantly on cancel/reset.
export const BOSS_ESCAPE_FADE_IN_MS = 150;

// ── Boss-key progression system ──────────────────────────────────────────
// Keys persist in runProgress so a key lost on death doesn't soft-lock the run.

// All three must be in the defeated set to win; order doesn't matter.
export const REQUIRED_BOSS_IDENTIFIERS = [
  'Shadow_of_storms_spawn',
  'The_tarnished_widow_spawn',
  'The_heart_hoarder_spawn',
] as const;

// Win is gated on the portal warp, not this boss's death — kept as the canonical last-boss id.
export const FINAL_BOSS_IDENTIFIER = 'The_heart_hoarder_spawn';

// Maps a level's LDtk id to the pickup kind that unlocks its one key-locked door.
// Values are inline string literals to avoid a constants→Player import cycle.
export const LOCKED_DOOR_KEYS: Readonly<
  Record<string, 'key_storms' | 'key_widow' | 'key_heart'>
> = {
  Level_6: 'key_storms',
  Level_12: 'key_widow',
  Level_13: 'key_heart',
};

// Key recorded in run-progress on defeat so the door stays openable even if the player dies before picking up the drop.
export const BOSS_KEYS: Readonly<
  Record<string, 'key_storms' | 'key_widow' | 'key_heart'>
> = {
  Shadow_of_storms_spawn: 'key_storms',
  The_tarnished_widow_spawn: 'key_widow',
  The_heart_hoarder_spawn: 'key_heart',
};

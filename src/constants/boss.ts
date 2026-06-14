/**
 * @file constants/boss.ts
 * @description Boss-encounter tuning — round-fight timing, reinforcement waves, the self-copy split, the screen-pinned bar/banner/escape UI, and the boss→key→door win progression. (Round COUNT lives in entities/bossRounds.ts.)
 * @module constants
 */

// ── Round-fight timing ─────────────────────────────────────────────────────
// How long the boss freezes/is invulnerable during the "Round N" banner; the banner's fade-in+hold+fade-out
// (below) sum to this.
export const BOSS_ROUND_BREAK_MS = 1200;

// ── Round-fight reinforcements ─────────────────────────────────────────────
// GENERAL_ENEMY_SPAWN is the LDtk marker for reinforcement positions (just world positions read at build time).
// REINFORCEMENT_IDENTIFIER/PER_SITE are the fallback enemy + count when bossWaves.ts has no explicit roster;
// round 1 uses pre-placed arena enemies, so waves start at round 2. Spacing keeps reinforcements at one site
// from overlapping, the lift keeps the drop from registering as fall damage, and the stagger spreads a whole
// round's wave across frames instead of landing it in one.
export const GENERAL_ENEMY_SPAWN_IDENTIFIER = 'General_enemy_spawn';
export const BOSS_ROUND_REINFORCEMENT_IDENTIFIER = 'Ghoul_spawn';
export const BOSS_ROUND_REINFORCEMENTS_PER_SITE = 2;
export const BOSS_ROUND_FIRST_REINFORCED_ROUND = 2;
export const REINFORCEMENT_SPAWN_SPACING_PX = 18;
export const REINFORCEMENT_SPAWN_LIFT_PX = 20;
export const REINFORCEMENT_SITE_STAGGER_MS = 350;

// ── Self-copies (round-fight "split" mechanic) ─────────────────────────────
// Copies deal no damage and have low HP so they read as a regular enemy, not a sponge. The spawn offset spreads
// them laterally so they flank the boss instead of overlapping, and each chases its own X slot beside the player
// (with a dead-zone so a parked copy doesn't jitter) rather than all collapsing to one point. The separation
// nudge keeps hoarder-family members from stacking — MIN_DX is wider than the body so a visible gap remains.
export const HEART_HOARDER_COPY_HEALTH = 40;
export const BOSS_SELF_COPY_SPAWN_OFFSET_PX = 90;
export const BOSS_SELF_COPY_CHASE_STANDOFF_PX = 110;
export const HORIZONTAL_CHASE_STANDOFF_DEADZONE_PX = 10;
export const HOARDER_SEPARATION_MIN_DX_PX = 64;
export const HOARDER_SEPARATION_PUSH_SPEED = 2.5;

// ── Boss health bar ────────────────────────────────────────────────────────
// Screen-wide bar pinned to the viewport top; all sizes are screen px resolved at CAMERA_ZOOM. TOP_MARGIN is the
// gap from the viewport top to the boss name, NAME_GAP the gap from the name to the bar. Section dividers draw at
// each 1/BOSS_ROUND_COUNT mark, and ROUND_COLORS (crimson → amber → blood-red) make the bar visibly shift each section.
export const BOSS_BAR_TOP_MARGIN_PX = 12;
export const BOSS_BAR_WIDTH_FRACTION = 0.6;
export const BOSS_BAR_HEIGHT_PX = 8;
export const BOSS_BAR_NAME_GAP_PX = 3;
export const BOSS_BAR_BG_COLOR = 0x1a0d0d;
export const BOSS_BAR_BG_ALPHA = 0.85;
export const BOSS_BAR_FRAME_COLOR = 0xffffff;
export const BOSS_BAR_FRAME_STROKE_PX = 1;
export const BOSS_BAR_DIVIDER_COLOR = 0x000000;
export const BOSS_BAR_DIVIDER_WIDTH_PX = 1;
export const BOSS_BAR_ROUND_COLORS: ReadonlyArray<number> = [
  0xc81e1e, 0xe0860d, 0x7a0a0a,
];
export const BOSS_BAR_NAME_FONT_SIZE_PX = 7;
export const BOSS_BAR_NAME_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const BOSS_BAR_NAME_COLOR = '#f5e6c8';

// ── "Round N" banner ───────────────────────────────────────────────────────
// Nosifer display face at weight 'normal' (fake-bold smears the dripping glyphs); placed above center so it
// doesn't cover the player. The fade-in/hold/fade-out lifecycle timings sum to BOSS_ROUND_BREAK_MS.
export const BOSS_BANNER_FONT_SIZE_PX = 20;
export const BOSS_BANNER_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const BOSS_BANNER_FONT_WEIGHT = 'normal';
export const BOSS_BANNER_COLOR = '#f5e6c8';
export const BOSS_BANNER_STROKE_COLOR = '#3a0a0a';
export const BOSS_BANNER_STROKE_PX = 2;
export const BOSS_BANNER_VIEWPORT_FRACTION_Y = 0.34;
export const BOSS_BANNER_FADE_IN_MS = 200;
export const BOSS_BANNER_HOLD_MS = 700;
export const BOSS_BANNER_FADE_OUT_MS = 300;

// ── Arena-escape warning ───────────────────────────────────────────────────
// Countdown to fight reset when the player leaves the arena; screen-pinned like the rest of the boss UI and
// placed above center so it doesn't sit on the fleeing player. The warning uses the Nosifer round-banner face;
// the countdown is larger than the headline so it reads as the urgent element, with the subtext as a hint below.
// LINE_GAP is the screen-px gap between the three stacked lines; it fades in on appear and snaps off on cancel/reset.
export const BOSS_ESCAPE_GRACE_MS = 3000;
export const BOSS_ESCAPE_WARNING_TEXT = 'LEAVING COMBAT ZONE';
export const BOSS_ESCAPE_SUBTEXT = 'Return to continue the fight';
export const BOSS_ESCAPE_WARNING_FONT_SIZE_PX = 14;
export const BOSS_ESCAPE_WARNING_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const BOSS_ESCAPE_WARNING_COLOR = '#f3d27a';
export const BOSS_ESCAPE_WARNING_STROKE_COLOR = '#3a0a0a';
export const BOSS_ESCAPE_WARNING_STROKE_PX = 2;
export const BOSS_ESCAPE_COUNTDOWN_FONT_SIZE_PX = 28;
export const BOSS_ESCAPE_COUNTDOWN_COLOR = '#ffffff';
export const BOSS_ESCAPE_SUBTEXT_FONT_SIZE_PX = 7;
export const BOSS_ESCAPE_SUBTEXT_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const BOSS_ESCAPE_SUBTEXT_COLOR = '#d8c4a0';
export const BOSS_ESCAPE_VIEWPORT_FRACTION_Y = 0.4;
export const BOSS_ESCAPE_LINE_GAP_PX = 4;
export const BOSS_ESCAPE_FADE_IN_MS = 150;

// ── Boss-key progression ───────────────────────────────────────────────────
// Maps bosses → keys → locked doors and defines the win condition. Keys persist in runProgress so one lost on
// death doesn't soft-lock the run. All three REQUIRED bosses must be in the defeated set to win (order-agnostic);
// FINAL_BOSS is kept as the canonical last-boss id even though the win is gated on the portal warp, not its death.
// LOCKED_DOOR_KEYS maps a level's LDtk id to the pickup kind that unlocks its one key-locked door; BOSS_KEYS is
// the key recorded on defeat so the door stays openable even if the player dies before grabbing the drop. Both
// maps use inline string-literal values to avoid a constants→Player import cycle.
export const REQUIRED_BOSS_IDENTIFIERS = [
  'Shadow_of_storms_spawn',
  'The_tarnished_widow_spawn',
  'The_heart_hoarder_spawn',
] as const;

export const FINAL_BOSS_IDENTIFIER = 'The_heart_hoarder_spawn';

export const LOCKED_DOOR_KEYS: Readonly<
  Record<string, 'key_storms' | 'key_widow' | 'key_heart'>
> = {
  Level_6: 'key_storms',
  Level_12: 'key_widow',
  Level_13: 'key_heart',
};

export const BOSS_KEYS: Readonly<
  Record<string, 'key_storms' | 'key_widow' | 'key_heart'>
> = {
  Shadow_of_storms_spawn: 'key_storms',
  The_tarnished_widow_spawn: 'key_widow',
  The_heart_hoarder_spawn: 'key_heart',
};

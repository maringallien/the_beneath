// Boss systems: round fights, reinforcements, self-copies, the boss HUD
// bar/banner, arena-escape rules, and the boss-key progression.

// ── Boss round-fight system ─────────────────────────────────────────────
// The round/section count (BOSS_ROUND_COUNT) lives in entities/bossRounds.ts
// next to the pure round math; the presentation + timing constants below
// live here.
// How long the boss freezes + is invulnerable while the "Round N" banner
// plays on each round transition. The banner's fade-in + hold + fade-out
// below sum to this so the boss resumes exactly as the banner clears.
export const BOSS_ROUND_BREAK_MS = 1200;

// ── Boss round-fight reinforcements ─────────────────────────────────────
// LDtk marker entity identifier whose placed instances mark where a round-
// fight boss's reinforcement waves spawn. The markers carry no game logic
// (no factory) — GameScene reads their world positions at world-build time
// and the LevelRenderer skips drawing them. Place them on the arena floor.
export const GENERAL_ENEMY_SPAWN_IDENTIFIER = 'General_enemy_spawn';

// Fallback reinforcement roster, used for any round-fight boss/round NOT listed
// in src/entities/bossWaves.ts (the per-boss source of truth). Registry
// identifier of the enemy spawned at each marker per wave.
export const BOSS_ROUND_REINFORCEMENT_IDENTIFIER = 'Ghoul_spawn';
// Fallback count: how many reinforcements spawn at each marker per wave when the
// boss/round has no explicit roster in bossWaves.ts.
export const BOSS_ROUND_REINFORCEMENTS_PER_SITE = 2;
// First round whose start triggers a reinforcement wave. Round 1 is the
// arena's pre-placed enemies; waves begin at round 2 so each threshold the
// player crosses brings fresh pressure.
export const BOSS_ROUND_FIRST_REINFORCED_ROUND = 2;
// Horizontal spacing (world px) between the multiple reinforcements spawned
// at one marker so they don't materialize stacked on the same pixel.
export const REINFORCEMENT_SPAWN_SPACING_PX = 18;
// How far (world px) above the projected floor a reinforcement is placed at
// spawn. Small, so it settles onto the floor in a frame or two without the
// fall registering as fall damage even when its marker sits high in the arena.
export const REINFORCEMENT_SPAWN_LIFT_PX = 20;
// Delay (ms) between one spawn site's wave and the next when a round's
// reinforcements go out. Enemies at a single site still all appear together;
// only the sites are staggered, so a round doesn't dump the whole arena's
// reinforcements in one frame.
export const REINFORCEMENT_SITE_STAGGER_MS = 350;

// ── Boss self-copies (round-fight "split" mechanic) ─────────────────────
// Some round-fight bosses split on a later round into harmless copies of
// themselves (see src/entities/bossSelfCopies.ts and
// GameScene.spawnBossSelfCopies). The copies inherit the boss's animations,
// attacks, and AI but deal no damage and use a hand-set low max HP.
// The Heart Hoarder's round-3 copies' max HP (the boss itself has 700). Kept
// low so a copy reads as a regular enemy — a few hits with its floating bar
// visible — rather than a damage sponge.
export const HEART_HOARDER_COPY_HEALTH = 40;
// Horizontal distance (world px) between adjacent self-copy slots when a boss
// splits, so the copies flank the boss instead of overlapping it.
export const BOSS_SELF_COPY_SPAWN_OFFSET_PX = 90;
// Horizontal stand-off (world px) each self-copy holds from the player while
// converging. Without it every horizontal-movement-only copy homes to the exact
// same player.x and the whole family collapses into one visual blob; with it
// each copy parks on its own X slot beside the player. Slightly wider than the
// spawn offset so the oversized hoarder frames stay clearly distinct.
export const BOSS_SELF_COPY_CHASE_STANDOFF_PX = 110;
// Settle band (world px) around a horizontal-chase target: once the enemy is
// this close to its target X it parks (velocityX = 0) instead of flip-flopping
// Math.sign(dx) every frame, which would jitter a copy sitting on its slot.
export const HORIZONTAL_CHASE_STANDOFF_DEADZONE_PX = 10;
// Lateral separation for grouped self-copies (heart hoarder family). The chase
// stand-off slots only spread members during an active chase; teleport landings,
// arena-edge slot clamping, and the zero-velocity attack/recover/idle states can
// still leave two hoarders overlapping. Each frame a member within MIN_DX of
// another nudges away on X by up to PUSH_SPEED px so the family never collapses
// into one sprite. MIN_DX is a touch wider than the 48 px body so a small gap
// shows between them; PUSH_SPEED is small so it polishes spacing without fighting
// the stand-off slots or reading as a shove.
export const HOARDER_SEPARATION_MIN_DX_PX = 64;
export const HOARDER_SEPARATION_PUSH_SPEED = 2.5;

// Screen-wide boss health bar pinned to the top of the viewport. Like
// PlayerHud, positions/sizes are authored in SCREEN px and converted to world
// space at CAMERA_ZOOM each frame, so these read as on-screen pixels.
// Distance from the viewport top to the boss NAME (the bar sits below it).
export const BOSS_BAR_TOP_MARGIN_PX = 12;
// Bar width as a fraction of the viewport width (centered horizontally).
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
// Fill color per round (index 0 = round 1). Crimson → amber → blood-red, so
// the bar visibly shifts as the player breaks each section.
export const BOSS_BAR_ROUND_COLORS: ReadonlyArray<number> = [
  0xc81e1e, 0xe0860d, 0x7a0a0a,
];
export const BOSS_BAR_NAME_FONT_SIZE_PX = 7;
export const BOSS_BAR_NAME_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const BOSS_BAR_NAME_COLOR = '#f5e6c8';

// "Round N" banner — big centered text that fades in, holds, and fades out.
// Uses the apocalyptic Nosifer display face (self-hosted via @font-face in
// index.html) to match the landing title and options headers. Single-weight
// font, so weight stays 'normal' — fake-bold would smear the dripping glyphs.
export const BOSS_BANNER_FONT_SIZE_PX = 20;
export const BOSS_BANNER_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const BOSS_BANNER_FONT_WEIGHT = 'normal';
export const BOSS_BANNER_COLOR = '#f5e6c8';
export const BOSS_BANNER_STROKE_COLOR = '#3a0a0a';
export const BOSS_BANNER_STROKE_PX = 2;
// Vertical placement as a fraction of viewport height (above center so it
// doesn't cover the player during the fight).
export const BOSS_BANNER_VIEWPORT_FRACTION_Y = 0.34;
// Lifecycle timings (sum == BOSS_ROUND_BREAK_MS).
export const BOSS_BANNER_FADE_IN_MS = 200;
export const BOSS_BANNER_HOLD_MS = 700;
export const BOSS_BANNER_FADE_OUT_MS = 300;

// ── Leaving the combat zone (boss-fight escape) ──────────────────────────
// When the player crosses out of a boss's arena mid-fight, a centered warning
// + countdown appears; if they don't return before the grace window lapses the
// fight resets (boss home at full HP, reinforcements despawn, enemies break
// off). Screen-pinned and CAMERA_ZOOM-resolved like the rest of the boss UI.
export const BOSS_ESCAPE_GRACE_MS = 3000;
export const BOSS_ESCAPE_WARNING_TEXT = 'LEAVING COMBAT ZONE';
export const BOSS_ESCAPE_SUBTEXT = 'Return to continue the fight';
// Headline reuses the Nosifer display face so the escape moment shares the
// round banner's visual language; single-weight font, so no fake-bold.
export const BOSS_ESCAPE_WARNING_FONT_SIZE_PX = 14;
export const BOSS_ESCAPE_WARNING_FONT_FAMILY = "'Nosifer', 'Impact', cursive";
export const BOSS_ESCAPE_WARNING_COLOR = '#f3d27a';
export const BOSS_ESCAPE_WARNING_STROKE_COLOR = '#3a0a0a';
export const BOSS_ESCAPE_WARNING_STROKE_PX = 2;
// Countdown digit sits below the headline — larger so it reads as the urgent
// element.
export const BOSS_ESCAPE_COUNTDOWN_FONT_SIZE_PX = 28;
export const BOSS_ESCAPE_COUNTDOWN_COLOR = '#ffffff';
// Hint line below the counter.
export const BOSS_ESCAPE_SUBTEXT_FONT_SIZE_PX = 7;
export const BOSS_ESCAPE_SUBTEXT_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const BOSS_ESCAPE_SUBTEXT_COLOR = '#d8c4a0';
// Vertical anchor as a fraction of viewport height — a touch above center so it
// doesn't sit on the player while they flee.
export const BOSS_ESCAPE_VIEWPORT_FRACTION_Y = 0.4;
// Screen-px gap between the three stacked lines.
export const BOSS_ESCAPE_LINE_GAP_PX = 4;
// Fade-in when the warning first appears (it snaps off on cancel/reset).
export const BOSS_ESCAPE_FADE_IN_MS = 150;

// ── Boss-key progression system ──────────────────────────────────────────
//
// The game is won by defeating all three bosses. Two of them (Shadow of Storms,
// The Tarnished Widow) drop a key on death that unlocks a specific key-locked
// door; the third (The Heart Hoarder) drops no key but must be defeated to win.
// Run progress (collected keys, defeated bosses) lives in src/state/runProgress
// so it survives death/respawn — bosses don't auto-respawn, so a key lost on
// death would otherwise soft-lock the run.

// Identifiers of the bosses that must all be defeated to win. Order is
// irrelevant — the win check is "every one of these is in the defeated set".
export const REQUIRED_BOSS_IDENTIFIERS = [
  'Shadow_of_storms_spawn',
  'The_tarnished_widow_spawn',
  'The_heart_hoarder_spawn',
] as const;

// The final boss. Its defeat ends the run and triggers the victory screen on
// its own — it's reached only after the other two (behind their key-locked
// doors), so killing it is the win, no separate all-bosses check required.
export const FINAL_BOSS_IDENTIFIER = 'The_heart_hoarder_spawn';

// Maps a key-locked door's LDtk level identifier to the pickup kind that opens
// it. A Door spawned in one of these levels is created locked and only opens on
// a hold-E interaction once the player holds the matching key; every other door
// keeps the default proximity auto-open behavior. Each of these levels contains
// exactly one door (verified against the_beneath.ldtk). The values mirror the
// PickupKind string literals (kept inline rather than imported to avoid a
// constants→Player import cycle).
export const LOCKED_DOOR_KEYS: Readonly<Record<string, 'key_storms' | 'key_widow'>> = {
  Level_6: 'key_storms',
  Level_12: 'key_widow',
};

// Maps a boss's LDtk identifier to the key its defeat grants. On defeat the key
// is recorded in run-progress directly (in addition to the physical key the boss
// still drops) so the matching key-locked door stays openable even if the player
// dies before walking over the drop — defeated bosses never respawn, so that
// dropped key would otherwise be the run's only copy. Bosses with no entry (The
// Heart Hoarder) grant no key.
export const BOSS_KEYS: Readonly<Record<string, 'key_storms' | 'key_widow'>> = {
  Shadow_of_storms_spawn: 'key_storms',
  The_tarnished_widow_spawn: 'key_widow',
};

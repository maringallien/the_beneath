// Pure round-math for the boss round-fight system. Kept Phaser-free and
// import-free so the threshold logic stays simple and self-contained — the
// rest of the feature is UI/physics glue that only makes sense inside a
// running scene.

// Number of equal HP sections a round-fight boss's health is split into.
// Losing one section advances the round, so this is also the round count.
// Lives here (the round "model") rather than in constants/index.ts so this
// module stays import-free; the presentation-side boss constants (bar colors,
// banner timings) live in constants/index.ts.
export const BOSS_ROUND_COUNT = 3;

// Tiny tolerance so an exact threshold (e.g. health landing precisely on
// 2/3 of max) resolves to "advanced" rather than flickering on floating-point
// rounding. With the in-scope bosses' HP divisible by BOSS_ROUND_COUNT the
// boundaries land cleanly, but a future odd HP value shouldn't change which
// side of the line the boundary falls on.
const BOUNDARY_EPSILON = 1e-9;

// Maps a boss's remaining-HP fraction to its 1-based round number. The HP
// pool is split into `sections` equal slices; each full slice the player
// removes advances the round. Full HP (ratio 1) = round 1; removing 1/N of
// the total enters round 2, removing 2/N enters round 3, etc. The result is
// clamped to [1, sections].
//
// Callers latch the value upward (the round never decreases) so a boss that
// heals back across a threshold — e.g. Shadow of Storms' self-heal — doesn't
// rewind its round or re-fire the round banner. See Enemy.getRound().
export function roundForRatio(
  ratio: number,
  sections: number = BOSS_ROUND_COUNT,
): number {
  if (!Number.isFinite(ratio) || sections < 1) return 1;
  const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
  const lostSections = Math.floor((1 - clamped) * sections + BOUNDARY_EPSILON);
  const round = 1 + lostSections;
  if (round < 1) return 1;
  if (round > sections) return sections;
  return round;
}

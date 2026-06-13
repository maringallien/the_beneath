/**
 * bossRounds — pure round-math for the boss round-fight system.
 *
 * Maps a round-fight boss's remaining-HP fraction to a 1-based round number by
 * splitting its HP pool into equal sections — each section the player removes
 * advances the round. Kept Phaser-free and import-free so the threshold logic
 * stays simple and self-contained; the rest of the feature is UI/physics glue
 * that only makes sense inside a running scene.
 *
 * Inputs:  a remaining-HP ratio (0..1) and an optional section count.
 * Outputs: a clamped 1-based round number; exports the canonical section count.
 * @calledby the boss's per-frame round tracking, when re-deriving the current
 *           round from the boss's live health.
 * @calls    nothing — pure arithmetic over the passed-in ratio.
 */

// HP sections (= round count) for the round-fight system; lives here to keep this module import-free.
export const BOSS_ROUND_COUNT = 3;

// Tiny epsilon so an exact HP boundary resolves to "advanced" rather than flickering on float rounding.
const BOUNDARY_EPSILON = 1e-9;

// Maps a remaining-HP fraction to a 1-based round number, splitting the pool into equal sections.
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

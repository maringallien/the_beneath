/**
 * @file entities/bossRounds.ts
 * @description Pure, Phaser-free round-math for the round-fight boss system — maps a boss's remaining-HP fraction to a 1-based round by splitting its HP pool into equal sections, and exports the canonical section count.
 * @module entities
 */

// HP sections (= round count) for the round-fight system; lives here to keep this module import-free.
export const BOSS_ROUND_COUNT = 3;

// Tiny epsilon so an exact HP boundary resolves to "advanced" rather than flickering on float rounding.
const BOUNDARY_EPSILON = 1e-9;

/**
 * @function    roundForRatio
 * @description Maps a remaining-HP fraction to a 1-based round number, splitting the pool into equal sections.
 * @param   ratio     Remaining HP, clamped to 0..1; non-finite falls back to round 1.
 * @param   sections  Section count (default BOSS_ROUND_COUNT); <1 falls back to round 1.
 * @returns a 1-based round number clamped to [1, sections].
 * @calledby src/entities/Enemy.ts → per-frame round tracking, re-deriving the round from live HP
 * @calls    nothing — pure arithmetic over the passed-in ratio
 */
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

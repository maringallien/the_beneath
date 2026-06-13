import { HEART_HOARDER_COPY_HEALTH } from '../constants';

/**
 * bossSelfCopies — per-boss, per-round "self-copy" specs for the round-fight system.
 *
 * The "boss splits into copies" mechanic: when a round-fight boss crosses into a
 * configured round, the scene spawns `count` harmless copies of the boss itself,
 * each built from the boss's own registry entry (inheriting every animation,
 * attack, and AI behavior) but dealing no damage and using `maxHealth` in place
 * of the boss's full HP. Distinct from the per-site reinforcement rosters in
 * bossWaves.ts (which spawn *other* enemy types); a boss may use either, both,
 * or neither on a given round.
 *
 * Inputs:  a boss registry identifier and its 1-based latched round.
 * Outputs: a self-copy spec (count + per-copy max HP), or null.
 * @calledby the boss encounter flow, when a boss crosses a round threshold and
 *           the scene decides whether to split it into copies.
 * @calls    nothing — a static table lookup.
 */

// How a boss splits on a given round.
export interface BossSelfCopySpec {
  // Total copies to spawn (not per-site).
  readonly count: number;
  // Each copy's max HP, applied via EnemySpawnOverrides (no separate registry entry needed).
  readonly maxHealth: number;
}

// bossId → round → spec.
const BOSS_SELF_COPIES: Readonly<
  Record<string, Readonly<Record<number, BossSelfCopySpec>>>
> = {
  The_heart_hoarder_spawn: {
    3: { count: 2, maxHealth: HEART_HOARDER_COPY_HEALTH },
  },
};

// Returns the self-copy spec for (boss, round), or null if this boss doesn't split on this round.
export function selfCopiesFor(
  bossId: string,
  round: number,
): BossSelfCopySpec | null {
  return BOSS_SELF_COPIES[bossId]?.[round] ?? null;
}

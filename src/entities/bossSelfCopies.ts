import { HEART_HOARDER_COPY_HEALTH } from '../constants';

/**
 * @file entities/bossSelfCopies.ts
 * @description Static per-boss/per-round "self-copy" split specs — when a round-fight boss crosses a configured round it spawns harmless copies of itself (its own registry entry, dealing no damage, with an overridden maxHealth); distinct from the other-enemy rosters in bossWaves.ts, and a boss may use either, both, or neither.
 * @module entities
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

/**
 * @function    selfCopiesFor
 * @description Returns the self-copy spec for (boss, round), or null if this boss doesn't split on this round.
 * @param   bossId  Registry identifier.
 * @param   round   1-based latched round.
 * @returns a BossSelfCopySpec (count + per-copy max HP), or null when unconfigured.
 * @calledby src/level/BossEncounterController.ts → on a round-threshold crossing, deciding a split
 * @calls    nothing — a static nested-table lookup
 */
export function selfCopiesFor(
  bossId: string,
  round: number,
): BossSelfCopySpec | null {
  return BOSS_SELF_COPIES[bossId]?.[round] ?? null;
}

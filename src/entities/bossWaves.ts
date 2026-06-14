import {
  BOSS_ROUND_REINFORCEMENT_IDENTIFIER,
  BOSS_ROUND_REINFORCEMENTS_PER_SITE,
} from '../constants';

/**
 * @file entities/bossWaves.ts
 * @description Static per-boss/per-round reinforcement rosters (which enemy types, and how many per site) a named boss summons on a wave-round crossing; spawned at every General_enemy_spawn marker in its arena. Unlisted bosses/rounds fall back to the legacy global default. The round model itself lives in bossRounds.ts.
 * @module entities
 */

// One enemy type and its per-site spawn count for a given wave.
export interface ReinforcementSpawn {
  // Entity registry id (must exist in entityRegistry.json).
  readonly enemy: string;
  // How many of this enemy spawn at each arena marker.
  readonly count: number;
}

// bossId → round → per-site roster.
const BOSS_ROUND_WAVES: Readonly<
  Record<string, Readonly<Record<number, readonly ReinforcementSpawn[]>>>
> = {
  Shadow_of_storms_spawn: {
    2: [
      { enemy: 'Evil_crow_spawn', count: 2 },
      { enemy: 'Caged_shocker_spawn', count: 1 },
    ],
    3: [{ enemy: 'Dagger_bandit_spawn', count: 3 }],
  },
  The_tarnished_widow_spawn: {
    2: [{ enemy: 'Caged_spider_spawn', count: 5 }],
    3: [{ enemy: 'Wasp_spawn', count: 7 }],
  },
  The_heart_hoarder_spawn: {
    2: [{ enemy: 'Ghoul_spawn', count: 3 }],
    // Round 3 spawns only self-copies (see bossSelfCopies.ts); empty array suppresses the fallback wave.
    3: [],
  },
};

/**
 * @function    reinforcementsFor
 * @description Returns the per-site roster for (boss, round), falling back to the global default for unlisted entries.
 * @param   bossId  Registry identifier.
 * @param   round   1-based latched round.
 * @returns a readonly ReinforcementSpawn array (possibly empty to suppress the fallback wave); the single-entry global default when unlisted.
 * @calledby src/level/BossEncounterController.ts → on a wave-round crossing, spawning at each arena marker
 * @calls    nothing — a static nested-table lookup with a constant fallback
 */
export function reinforcementsFor(
  bossId: string,
  round: number,
): readonly ReinforcementSpawn[] {
  return (
    BOSS_ROUND_WAVES[bossId]?.[round] ?? [
      {
        enemy: BOSS_ROUND_REINFORCEMENT_IDENTIFIER,
        count: BOSS_ROUND_REINFORCEMENTS_PER_SITE,
      },
    ]
  );
}

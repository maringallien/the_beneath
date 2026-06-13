import {
  BOSS_ROUND_REINFORCEMENT_IDENTIFIER,
  BOSS_ROUND_REINFORCEMENTS_PER_SITE,
} from '../constants';

/**
 * bossWaves — per-boss, per-round reinforcement rosters for the round-fight system.
 *
 * The *roster* model: which enemy types, and how many per site, each named boss
 * summons when it crosses into a wave round (the round model — HP thirds ->
 * round number — lives in bossRounds.ts). The scene spawns the returned roster
 * at every General_enemy_spawn marker inside the boss's arena. Bosses/rounds not
 * listed here fall back to the legacy global default, so unlisted round-fight
 * bosses keep their existing reinforcement behavior.
 *
 * Inputs:  a boss registry identifier and its 1-based latched round; the
 *          legacy default enemy id and per-site count from ../constants.
 * Outputs: a per-site roster (enemy id + count entries), possibly empty.
 * @calledby the boss encounter flow, when a boss crosses into a wave round and
 *           the scene needs the reinforcements to spawn at each arena marker.
 * @calls    nothing — a static table lookup with a constant fallback.
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

// Returns the per-site roster for (boss, round), falling back to the global default for unlisted entries.
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

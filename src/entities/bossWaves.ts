// Per-boss, per-round reinforcement rosters for the boss round-fight system.
// When a round-fight boss crosses into a wave round, GameScene spawns the roster
// returned by reinforcementsFor() at every General_enemy_spawn marker inside the
// boss's arena.
//
// The round model (HP thirds -> round number) lives in bossRounds.ts; this is
// the *roster* model — which enemies, and how many per site, each named boss
// summons per round. Bosses/rounds not listed here fall back to the legacy
// global default in constants/index.ts, so other round-fight bosses keep their
// existing reinforcement behavior.
import {
  BOSS_ROUND_REINFORCEMENT_IDENTIFIER,
  BOSS_ROUND_REINFORCEMENTS_PER_SITE,
} from '../constants';

// One enemy type and how many of it spawn at each marker for a given wave.
export interface ReinforcementSpawn {
  // Entity registry identifier (e.g. 'Crow_spawn'); passed straight to
  // respawnEnemyAt, so it must exist in entityRegistry.json.
  readonly enemy: string;
  // How many of `enemy` spawn at EACH General_enemy_spawn marker this round.
  readonly count: number;
}

// bossId -> round -> per-site roster. Keyed by the boss's registry identifier
// (Enemy.getIdentifier()) and its 1-based latched round (Enemy.getRound()).
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
    // Round 2: each arena spawn site emits a 3-ghoul swarm.
    2: [{ enemy: 'Ghoul_spawn', count: 3 }],
    // Round 3 has no roster wave — the boss instead splits into harmless,
    // low-HP copies of itself (see bossSelfCopies.ts and
    // GameScene.spawnBossSelfCopies). The explicit empty array suppresses the
    // legacy fallback ghoul wave so round 3 is *only* the copies.
    3: [],
  },
};

// Per-site roster for (boss, round). Returns the hand-authored roster when the
// boss/round is listed above, otherwise the legacy global default (one entry of
// BOSS_ROUND_REINFORCEMENTS_PER_SITE x BOSS_ROUND_REINFORCEMENT_IDENTIFIER) so
// unlisted round-fight bosses keep their existing behavior.
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

// Per-boss, per-round "self-copy" specs for the round-fight system. When a
// round-fight boss crosses into a configured round, GameScene spawns `count`
// harmless copies of the boss itself (see GameScene.spawnBossSelfCopies): each
// copy is built from the boss's own registry entry — so it inherits every
// animation, attack, and AI behavior — but deals no damage and uses `maxHealth`
// in place of the boss's full HP.
//
// This is the "boss splits into copies" mechanic, distinct from the per-site
// reinforcement rosters in bossWaves.ts (which spawn *other* enemy types at the
// arena's General_enemy_spawn markers). A boss may use either, both, or neither
// on a given round.
import { HEART_HOARDER_COPY_HEALTH } from '../constants';

// How a boss splits on a given round.
export interface BossSelfCopySpec {
  // Number of copies to spawn (total, not per-site). The Heart Hoarder spawns
  // 2 so the arena holds 3 hoarder-characters: the boss plus 2 copies.
  readonly count: number;
  // Each copy's max (and starting) health, applied via EnemySpawnOverrides so
  // the copy is "relatively low health" without a separate registry entry.
  readonly maxHealth: number;
}

// bossId -> round -> spec. Keyed by the boss's registry identifier
// (Enemy.getIdentifier()) and its 1-based latched round (Enemy.getRound()).
const BOSS_SELF_COPIES: Readonly<
  Record<string, Readonly<Record<number, BossSelfCopySpec>>>
> = {
  The_heart_hoarder_spawn: {
    3: { count: 2, maxHealth: HEART_HOARDER_COPY_HEALTH },
  },
};

// Self-copy spec for (boss, round), or null when the boss doesn't split that
// round. Bosses/rounds absent from the table never spawn copies.
export function selfCopiesFor(
  bossId: string,
  round: number,
): BossSelfCopySpec | null {
  return BOSS_SELF_COPIES[bossId]?.[round] ?? null;
}

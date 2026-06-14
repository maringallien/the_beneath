import {
  ENEMY_RESPAWN_CHECK_INTERVAL_MS,
  ENEMY_RESPAWN_MIN_DISTANCE_PX,
  ENEMY_RESPAWN_MIN_TIME_MS,
} from '../constants';
import type { Enemy } from '../entities/Enemy';
import type { LoiterPathPoint } from '../ldtk/types';

/**
 * @file level/EnemyRespawnManager.ts
 * @description Per-scene registry that brings killed non-boss enemies back; an entry fires only after BOTH gates clear (≥ ENEMY_RESPAWN_MIN_TIME_MS since death AND player ≥ ENEMY_RESPAWN_MIN_DISTANCE_PX from its spawn point) — the time floor stops a cleared area refilling the instant the player sprints out of range, the distance floor stops it refilling while the player lingers nearby (that distance far exceeds the on-screen radius so an eligible spawn is always off-camera); transient state cleared on world teardown, so save→death→respawn rebuilds every non-boss fresh from LDtk, matching the "save reloads a clean world" semantic.
 * @module level
 */

// Death snapshot; everything the rebuild needs without holding a ref to the destroyed sprite.
export interface PendingRespawn {
  readonly identifier: string;
  readonly iid: string;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly loiterPath: ReadonlyArray<LoiterPathPoint> | null;
  // Earliest scene-time the entry can return; distance gate is still also required.
  readonly respawnAt: number;
}

export type RespawnCallback = (entry: PendingRespawn) => void;

// Registry of killed non-boss enemies awaiting return.
export class EnemyRespawnManager {
  // iid-keyed so a re-killed enemy replaces its slot without double-tracking.
  private readonly pending = new Map<string, PendingRespawn>();
  // Sentinel 0 means "scan on first call"; subsequent ticks gate on the interval.
  private lastTickAt = 0;

  /**
   * @function    recordDeath
   * @description Snapshots a killed enemy's spawn data into an iid-keyed pending entry for later respawn; no-ops for bosses.
   * @param   enemy  The just-killed enemy.
   * @param   now    Current scene-time ms; sets the time gate at now + min-time.
   * @calledby src/scenes/GameScene.ts → a non-boss enemy's death event
   * @calls    reads the enemy's identifier/iid/spawn/loiter data; no further delegation
   */
  recordDeath(enemy: Enemy, now: number): void {
    if (enemy.isBoss()) return;
    this.pending.set(enemy.getIid(), {
      identifier: enemy.getIdentifier(),
      iid: enemy.getIid(),
      spawnX: enemy.getSpawnX(),
      spawnY: enemy.getSpawnY(),
      loiterPath: enemy.getLoiterPath(),
      respawnAt: now + ENEMY_RESPAWN_MIN_TIME_MS,
    });
  }

  /** Drops the pending entry for an iid, called after the scene rebuilds the enemy. */
  removeByIid(iid: string): void {
    this.pending.delete(iid);
  }

  /**
   * @function    tick
   * @description Throttled scan; removes and fires the respawn callback for every entry past both time and distance gates; no-op until the interval elapses or while the registry is empty.
   * @param   playerX    Player world-px x.
   * @param   playerY    Player world-px y.
   * @param   now        Scene-time ms; throttles to the check interval.
   * @param   onRespawn  Callback invoked per eligible entry.
   * @calledby src/scenes/GameScene.ts → the per-frame update tick
   * @calls    the supplied respawn callback (the entity-rebuild path) once both gates open
   */
  tick(
    playerX: number,
    playerY: number,
    now: number,
    onRespawn: RespawnCallback,
  ): void {
    if (now < this.lastTickAt + ENEMY_RESPAWN_CHECK_INTERVAL_MS) return;
    this.lastTickAt = now;
    if (this.pending.size === 0) return;

    // Squared distance comparison avoids a per-entry sqrt.
    const minDistSq =
      ENEMY_RESPAWN_MIN_DISTANCE_PX * ENEMY_RESPAWN_MIN_DISTANCE_PX;

    // Two-pass: collect then process — never delete from the Map mid-iteration.
    const ready: PendingRespawn[] = [];
    for (const entry of this.pending.values()) {
      // Time gate first: cheap scalar check before the distance math.
      if (now < entry.respawnAt) continue;
      const dx = entry.spawnX - playerX;
      const dy = entry.spawnY - playerY;
      if (dx * dx + dy * dy < minDistSq) continue;
      ready.push(entry);
    }
    for (const entry of ready) {
      this.pending.delete(entry.iid);
      onRespawn(entry);
    }
  }

  /** Clears all pending entries and resets the throttle on world teardown. */
  clear(): void {
    this.pending.clear();
    this.lastTickAt = 0;
  }
}

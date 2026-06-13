import {
  ENEMY_RESPAWN_CHECK_INTERVAL_MS,
  ENEMY_RESPAWN_MIN_DISTANCE_PX,
  ENEMY_RESPAWN_MIN_TIME_MS,
} from '../constants';
import type { Enemy } from '../entities/Enemy';
import type { LoiterPathPoint } from '../ldtk/types';

/**
 * EnemyRespawnManager — per-scene registry that brings killed non-boss enemies back.
 *
 * Death events push a value snapshot of each kill here; tick() runs a throttled
 * scan and fires the respawn callback once an entry has cleared BOTH gates — at
 * least ENEMY_RESPAWN_MIN_TIME_MS elapsed since death AND the player at least
 * ENEMY_RESPAWN_MIN_DISTANCE_PX from its spawn point. The time floor stops a
 * cleared area refilling the instant the player sprints out of range; the
 * distance floor stops it refilling while the player lingers nearby. That
 * distance far exceeds the on-screen radius, so an eligible spawn is always
 * off-camera and respawns never pop into view. State is transient: cleared on
 * world teardown, so save→death→respawn rebuilds every non-boss fresh from LDtk
 * — matching the "save reloads a clean world" semantic.
 *
 * Inputs:  enemy death snapshots; per-frame player position + scene-time.
 * Outputs: invokes a respawn callback per eligible entry (the rebuild trigger).
 * @calledby the gameplay scene — fed kills on death, ticked each frame, cleared
 *           on world teardown.
 * @calls    the supplied respawn callback (the entity-rebuild path) when both gates open.
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

  // Snapshots a killed enemy's spawn data for later respawn; no-ops for bosses.
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

  // Drops the pending entry for an iid, called after the scene rebuilds the enemy.
  removeByIid(iid: string): void {
    this.pending.delete(iid);
  }

  // Throttled scan; fires the respawn callback for every entry past both time and distance gates.
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

  // Clears all pending entries and resets the throttle on world teardown.
  clear(): void {
    this.pending.clear();
    this.lastTickAt = 0;
  }
}

import Phaser from 'phaser';
import {
  ENEMY_RESPAWN_CHECK_INTERVAL_MS,
  ENEMY_RESPAWN_DELAY_MS,
  ENEMY_RESPAWN_OFFSCREEN_PADDING_PX,
} from '../constants';
import type { Enemy } from '../entities/Enemy';
import type { LoiterPathPoint } from '../ldtk/types';

// One queued respawn. Captured at the moment of death so the rebuild path
// (EntityFactory.respawnEnemyAt) has everything it needs without holding a
// reference to the destroyed Enemy sprite.
export interface PendingRespawn {
  readonly identifier: string;
  readonly iid: string;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly loiterPath: ReadonlyArray<LoiterPathPoint> | null;
  // Scene-time at which the respawn becomes eligible. Compared against
  // scene.time.now in tick(); off-camera gating runs only after this passes.
  readonly respawnAt: number;
}

export type RespawnCallback = (entry: PendingRespawn) => void;

// Per-scene registry of killed non-boss enemies waiting to come back. Death
// events from GameScene push entries here; tick() runs a throttled scan and
// invokes the callback when an entry is both past its delay AND its spawn
// point is off-camera.
//
// State is transient: cleared on tearDownWorld. After save→death→respawn-
// from-save, the world rebuilds from LDtk and all non-bosses come back fresh
// — matching the existing "save reloads a clean world" semantic.
export class EnemyRespawnManager {
  // iid → pending entry. iid keying means a respawned enemy that's killed
  // again replaces the same slot (the new death enqueues, then we look up by
  // its iid which equals the original) — no double-tracking across cycles.
  private readonly pending = new Map<string, PendingRespawn>();
  // Scene-time of the last tick scan. Sentinel 0 means "scan on first call"
  // so a freshly-built world doesn't have to wait an interval before
  // checking. Subsequent ticks gate on now >= lastTickAt + interval.
  private lastTickAt = 0;

  // Queue a death for respawn. No-ops for bosses (so a future code change
  // that forgets to filter bosses at the call site still does the right
  // thing). The enemy reference is read here, not stored — once recordDeath
  // returns the manager holds only the captured value snapshot.
  recordDeath(enemy: Enemy, now: number): void {
    if (enemy.isBoss()) return;
    this.pending.set(enemy.getIid(), {
      identifier: enemy.getIdentifier(),
      iid: enemy.getIid(),
      spawnX: enemy.getSpawnX(),
      spawnY: enemy.getSpawnY(),
      loiterPath: enemy.getLoiterPath(),
      respawnAt: now + ENEMY_RESPAWN_DELAY_MS,
    });
  }

  // Drop the queued entry for an iid, if any. Called when the manager-owner
  // (GameScene) successfully respawns an enemy and wants to start tracking
  // the fresh instance for its own future death. Not used by tick() itself
  // — that path mutates the Map via delete during iteration before invoking
  // the callback so removeByIid is a pure ergonomic for external callers.
  removeByIid(iid: string): void {
    this.pending.delete(iid);
  }

  // Per-frame entry point. Throttled internally so callers can call this
  // unconditionally from scene.update(). Iterates pending entries, fires the
  // callback for any whose delay has elapsed AND whose spawn point sits
  // outside the camera rect (padded). Eligible entries are removed from the
  // Map BEFORE the callback to keep the manager's view consistent if the
  // callback re-records the freshly-respawned enemy for its next death.
  tick(
    camera: Phaser.Cameras.Scene2D.Camera,
    now: number,
    onRespawn: RespawnCallback,
  ): void {
    if (now < this.lastTickAt + ENEMY_RESPAWN_CHECK_INTERVAL_MS) return;
    this.lastTickAt = now;
    if (this.pending.size === 0) return;

    // Camera rect in world coords, derived from midPoint + displayWidth/Height
    // — same construction GameScene.cullOffscreenLevels uses, for the same
    // reason: cam.scrollX/Y + width/zoom undershoots the actual visible right
    // edge by `(cam.width/2)(1 - 1/zoom)` (Phaser stores scrollX as raw canvas
    // half-width). Pad outward so respawns happen comfortably off-screen even
    // if the camera lerp catches up to the player on the very next frame.
    const halfDispW = camera.displayWidth * 0.5;
    const halfDispH = camera.displayHeight * 0.5;
    const pad = ENEMY_RESPAWN_OFFSCREEN_PADDING_PX;
    const visibleLeft = camera.midPoint.x - halfDispW - pad;
    const visibleTop = camera.midPoint.y - halfDispH - pad;
    const visibleRight = camera.midPoint.x + halfDispW + pad;
    const visibleBottom = camera.midPoint.y + halfDispH + pad;

    // Two-pass to avoid mutating the Map during the for..of: first collect
    // every eligible iid this tick, then process them in order. Cheaper than
    // copying values and avoids the "iterator invalidated by delete during
    // its own iteration" pitfall in JS Maps.
    const ready: PendingRespawn[] = [];
    for (const entry of this.pending.values()) {
      if (now < entry.respawnAt) continue;
      const onScreen =
        entry.spawnX >= visibleLeft &&
        entry.spawnX <= visibleRight &&
        entry.spawnY >= visibleTop &&
        entry.spawnY <= visibleBottom;
      if (onScreen) continue;
      ready.push(entry);
    }
    for (const entry of ready) {
      this.pending.delete(entry.iid);
      onRespawn(entry);
    }
  }

  // Drop every queued entry. Called from GameScene.tearDownWorld so HMR /
  // respawn-from-save start with a clean slate (the world they rebuild from
  // LDtk already contains every enemy alive, so any stale entries would
  // queue a duplicate respawn on top of the live one).
  clear(): void {
    this.pending.clear();
    this.lastTickAt = 0;
  }
}

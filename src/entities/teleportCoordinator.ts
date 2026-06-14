import type { Enemy } from './Enemy';

/**
 * @file entities/teleportCoordinator.ts
 * @description Group-scoped shared state for the heart-hoarder split (boss + its round-3 self-copies): a solo-teleport lock so only one member blinks onto the player at a time, plus a live-member registry that the per-enemy lateral separation reads to push overlapping copies apart. One instance per active split; rounds 1-2 (boss alone) never build one, so the gates stay inert.
 * @module entities
 */
export class TeleportCoordinator {
  // Member currently mid-teleport, or null when the lock is free.
  private holder: Enemy | null = null;
  // Live hoarders in this group (boss + copies).
  private readonly members = new Set<Enemy>();

  /** Add a hoarder to the group (idempotent). */
  register(member: Enemy): void {
    this.members.add(member);
  }

  /**
   * @function    unregister
   * @description Remove a hoarder; also frees the lock if it held it.
   * @calledby src/entities/Enemy.ts → when a member dies or despawns; src/level/BossEncounterController.ts → split teardown
   * @calls    nothing — set delete plus a lock-holder check
   */
  unregister(member: Enemy): void {
    this.members.delete(member);
    if (this.holder === member) this.holder = null;
  }

  /** The live hoarder set, read by the lateral separation code. */
  getMembers(): ReadonlySet<Enemy> {
    return this.members;
  }

  /** True when a different member holds the lock; caller skips its teleport. */
  isLockedByOther(claimant: Enemy): boolean {
    return this.holder !== null && this.holder !== claimant;
  }

  /** Claim the solo-teleport lock. */
  acquire(claimant: Enemy): void {
    this.holder = claimant;
  }

  /**
   * @function    release
   * @description Release the lock; safe to call unconditionally from any attack-exit path.
   * @calledby src/entities/Enemy.ts → on exiting any attack state
   * @calls    nothing — a guarded holder reset
   */
  release(claimant: Enemy): void {
    if (this.holder === claimant) this.holder = null;
  }
}

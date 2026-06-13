import type { Enemy } from './Enemy';

/**
 * teleportCoordinator — group-scoped shared state for the heart hoarder split.
 *
 * Shared by the heart hoarder boss and its round-3 self-copies. Without it every
 * hoarder runs its AI in isolation, so the trio would (a) all blink onto the
 * player at once — each `teleport` attack repositions to the player's spot,
 * reading as one stacked sprite and letting all three land attack1 together —
 * and (b) drift into a single pile between attacks. It supplies just enough
 * shared state to avoid both: a solo-teleport lock (only one member may be
 * mid-teleport at a time) and a member registry (the live hoarder set, read by
 * each enemy's lateral separation so overlapping members push apart). One
 * instance exists per active split; rounds 1-2 (boss alone) never build one, so
 * the gates are inert there.
 *
 * Inputs:  member enemies registering/unregistering and claiming the lock.
 * Outputs: the live member set and the solo-teleport gate state.
 * @calledby the hoarder AI, when a member spawns/dies, attempts a teleport, or
 *           exits any attack state, and when separating overlapping members.
 * @calls    nothing — holds a member Set and a single lock-holder reference.
 */
export class TeleportCoordinator {
  // Member currently mid-teleport, or null when the lock is free.
  private holder: Enemy | null = null;
  // Live hoarders in this group (boss + copies).
  private readonly members = new Set<Enemy>();

  // Add a hoarder to the group (idempotent).
  register(member: Enemy): void {
    this.members.add(member);
  }

  // Remove a hoarder; also frees the lock if it held it.
  unregister(member: Enemy): void {
    this.members.delete(member);
    if (this.holder === member) this.holder = null;
  }

  // The live hoarder set, read by the lateral separation code.
  getMembers(): ReadonlySet<Enemy> {
    return this.members;
  }

  // True when a different member holds the lock; caller skips its teleport.
  isLockedByOther(claimant: Enemy): boolean {
    return this.holder !== null && this.holder !== claimant;
  }

  // Claim the solo-teleport lock.
  acquire(claimant: Enemy): void {
    this.holder = claimant;
  }

  // Release the lock; safe to call unconditionally from any attack-exit path.
  release(claimant: Enemy): void {
    if (this.holder === claimant) this.holder = null;
  }
}

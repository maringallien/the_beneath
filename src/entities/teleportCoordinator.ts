import type { Enemy } from './Enemy';

// Group-scoped coordinator shared by the heart hoarder boss and its round-3
// self-copies (see GameScene.spawnBossSelfCopies). Without it every hoarder
// runs its AI in isolation, so the trio (a) all blink onto the player at once —
// every `teleport` attack repositions to the player's spot, reading as one
// stacked sprite and letting all three land attack1 simultaneously — and (b)
// drifts into a single pile between attacks. This object gives them just enough
// shared state to avoid both:
//
//   1. Solo-teleport lock — only one member may be mid-teleport at any moment.
//   2. Member registry — the live hoarder set, read by Enemy's lateral
//      separation so overlapping members push apart.
//
// One instance exists per active split (created when the boss enters round 3);
// rounds 1-2 (boss alone) never construct one, so the gates are inert there.
export class TeleportCoordinator {
  // The member currently executing a teleport attack, or null when the lock is
  // free. Cleared on release() and on unregister() (covers a holder that dies
  // mid-teleport without an explicit release).
  private holder: Enemy | null = null;
  // Live hoarders in this group (boss + copies). A Set so repeated register()
  // calls are idempotent and unregister() is O(1).
  private readonly members = new Set<Enemy>();

  register(member: Enemy): void {
    this.members.add(member);
  }

  unregister(member: Enemy): void {
    this.members.delete(member);
    if (this.holder === member) this.holder = null;
  }

  getMembers(): ReadonlySet<Enemy> {
    return this.members;
  }

  // True when a different live member holds the teleport lock — the caller
  // should skip its own teleport this tick. False when the lock is free or
  // already held by the caller (so an in-flight teleporter isn't blocked by
  // its own lock).
  isLockedByOther(claimant: Enemy): boolean {
    return this.holder !== null && this.holder !== claimant;
  }

  // Claim the lock for `claimant`. Callers gate on isLockedByOther first, so a
  // claim only overwrites a stale/own holder. Updates run single-threaded, so
  // there's no check-then-act race between the gate and this call.
  acquire(claimant: Enemy): void {
    this.holder = claimant;
  }

  // Release the lock iff `claimant` currently holds it. Safe to call
  // unconditionally from every attack-exit path (recover / hurt / dead /
  // round-break / idle / loiter) — a non-holder calling release is a no-op,
  // so a leaked lock is impossible as long as one of those paths runs.
  release(claimant: Enemy): void {
    if (this.holder === claimant) this.holder = null;
  }
}

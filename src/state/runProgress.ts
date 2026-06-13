import { REQUIRED_BOSS_IDENTIFIERS } from '../constants';

/**
 * runProgress — the persistent per-run progress store (the win condition's memory).
 *
 * Four module-scope sets tracking what the player has achieved this run:
 * collected boss keys, defeated bosses (the win gate), opened chests, and
 * purchased capacity upgrades. It lives at module scope (not on GameScene) so it
 * survives the world rebuilds that death/respawn and HMR perform — a
 * respawn-from-save tears down and re-parses the LDtk project, re-spawning every
 * boss/chest from scratch. Bosses opt out of the auto-respawn system, but a
 * respawn-from-save rebuild revives them anyway, so the *fact* of a defeat (and
 * its key) must live somewhere the rebuild doesn't touch. Keeping it here means a
 * player who grabs a key then dies without saving still owns it, so a key-locked
 * door can never become permanently unopenable (which would soft-lock the run:
 * the boss is gone on the no-death timeline and only re-spawns on a death the
 * player is avoiding). A fresh boot starts clean (sets initialize empty); the
 * store is wiped only when a run is abandoned (New Game / Quit / Return to Title).
 *
 * Inputs:  record/query calls from the gameplay scene and entities; the required
 *          boss roster from ../constants.
 * Outputs: mutates the in-memory sets and answers boolean/count queries.
 * @calledby the boss/key/chest/shop systems recording or gating on run progress,
 *           and the run lifecycle (abandon → reset).
 * @calls    nothing — pure in-memory Set bookkeeping.
 */

// The two boss keys, matching the PickupKind string literals in Player.ts. A
// door declares which one it needs via LOCKED_DOOR_KEYS (constants).
export type BossKeyId = 'key_storms' | 'key_widow' | 'key_heart';

const collectedKeys = new Set<BossKeyId>();
const defeatedBosses = new Set<string>();

// Chests the player has opened this run, keyed by LDtk entity iid. The iid is
// stable across the LDtk re-parse that respawn/HMR performs, so a chest keeps
// the same id when the world is rebuilt. Lives here for the same reason as the
// boss state above: respawnFromSave() tears down and re-spawns every chest from
// scratch, which would otherwise revert opened chests to closed (and let the
// player re-loot them). Recording the open here keeps looted chests open across
// death/respawn for the rest of the run.
const openedChests = new Set<string>();

// Capacity upgrades the player has bought this run. Two lines: 'ammo' (the tech
// shops' Ammo Storage upgrade, which widens both gun caps) and 'magic' (the
// mushroom merchants' Orb Pouch upgrade). Stored as a set of ids that encode
// both the line and the selling level (see upgradeId, e.g. "ammo@Level_9"), so
// each shop's upgrade is a distinct one-time purchase. The COUNT of ids per line
// is what drives the player's derived ammo/magic caps (Player.getMax*), so the
// order levels are visited in is irrelevant. Lives here for the same reason as
// the state above: a permanent capacity boost must survive the world rebuilds
// that death/respawn and HMR perform, and is wiped only by resetRunProgress()
// when the run is abandoned.
export type UpgradeType = 'ammo' | 'magic';
const purchasedUpgrades = new Set<string>();

// Records that the player picked up the given boss key this run.
export function recordKeyCollected(key: BossKeyId): void {
  collectedKeys.add(key);
}

// True if the player currently holds the given boss key.
export function hasKey(key: BossKeyId): boolean {
  return collectedKeys.has(key);
}

// Records a boss (by LDtk identifier) as defeated this run.
export function recordBossDefeated(identifier: string): void {
  defeatedBosses.add(identifier);
}

// True if the named boss has been defeated this run.
export function isBossDefeated(identifier: string): boolean {
  return defeatedBosses.has(identifier);
}

// Records a chest (by stable LDtk iid) as looted this run.
export function recordChestOpened(iid: string): void {
  openedChests.add(iid);
}

// True if the chest with this iid has already been looted this run.
export function isChestOpened(iid: string): boolean {
  return openedChests.has(iid);
}

// Stable id for one shop's capacity upgrade: the upgrade line plus the level
// that sells it. Each tech shop / mushroom merchant lives in a distinct level
// (Level_9/11/18), so this is unique per shop and lets a shop's upgrade be
// recorded — and refused on re-purchase — independently of the others.
export function upgradeId(type: UpgradeType, levelId: string): string {
  return `${type}@${levelId}`;
}

// Records one shop's capacity upgrade (by upgradeId) as purchased this run.
export function recordUpgradePurchased(id: string): void {
  purchasedUpgrades.add(id);
}

// True if this specific shop's upgrade (by upgradeId) was already bought.
export function hasUpgrade(id: string): boolean {
  return purchasedUpgrades.has(id);
}

// counts how many upgrades of one line the player owns (drives ammo/magic cap math)
export function countUpgrades(type: UpgradeType): number {
  const prefix = `${type}@`;
  let count = 0;
  for (const id of purchasedUpgrades) {
    if (id.startsWith(prefix)) count += 1;
  }
  return count;
}

// True once every required boss has been recorded as defeated — the win gate.
export function allBossesDefeated(): boolean {
  return REQUIRED_BOSS_IDENTIFIERS.every((id) => defeatedBosses.has(id));
}

// wipes all progress so the next run starts fresh; NOT called on respawn or HMR by design
export function resetRunProgress(): void {
  collectedKeys.clear();
  defeatedBosses.clear();
  openedChests.clear();
  purchasedUpgrades.clear();
}

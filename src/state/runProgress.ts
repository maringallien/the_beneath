import { REQUIRED_BOSS_IDENTIFIERS } from '../constants';

/**
 * @file state/runProgress.ts
 * @description Persistent per-run progress store at module scope — four Sets (collected boss keys, defeated bosses, opened chests, purchased capacity upgrades) that survive the world rebuilds death/respawn and HMR perform, so a key grabbed then lost to an unsaved death is still owned and a key-locked door can never soft-lock; starts empty on boot, wiped only when a run is abandoned.
 * @module state
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

/** Records that the player picked up the given boss key this run. */
export function recordKeyCollected(key: BossKeyId): void {
  collectedKeys.add(key);
}

/** True if the player currently holds the given boss key. */
export function hasKey(key: BossKeyId): boolean {
  return collectedKeys.has(key);
}

/** Records a boss (by LDtk identifier) as defeated this run. */
export function recordBossDefeated(identifier: string): void {
  defeatedBosses.add(identifier);
}

/** True if the named boss has been defeated this run. */
export function isBossDefeated(identifier: string): boolean {
  return defeatedBosses.has(identifier);
}

/** Records a chest (by stable LDtk iid) as looted this run. */
export function recordChestOpened(iid: string): void {
  openedChests.add(iid);
}

/** True if the chest with this iid has already been looted this run. */
export function isChestOpened(iid: string): boolean {
  return openedChests.has(iid);
}

/**
 * @function    upgradeId
 * @description Stable id for one shop's capacity upgrade: the line plus the level that sells it. Each shop lives in a distinct level, so this is unique per shop and lets its upgrade be recorded — and refused on re-purchase — independently of the others.
 * @param   type     The 'ammo' or 'magic' upgrade line.
 * @param   levelId  LDtk level id of the selling shop.
 * @returns the composite id string "type@levelId".
 * @calledby src/entities/shop/shopTypes.ts → upgrade-item builders, src/entities/Player.ts → upgrade gating
 * @calls    a template-string format only; no further delegation
 */
export function upgradeId(type: UpgradeType, levelId: string): string {
  return `${type}@${levelId}`;
}

/** Records one shop's capacity upgrade (by upgradeId) as purchased this run. */
export function recordUpgradePurchased(id: string): void {
  purchasedUpgrades.add(id);
}

/** True if this specific shop's upgrade (by upgradeId) was already bought. */
export function hasUpgrade(id: string): boolean {
  return purchasedUpgrades.has(id);
}

/**
 * @function    countUpgrades
 * @description Counts how many upgrades of one line the player owns this run; drives the derived ammo/magic cap math (magic steps are uneven, so the cap is summed per owned tier).
 * @param   type  The 'ammo' or 'magic' upgrade line.
 * @returns the integer count of purchased upgrades whose id starts with the line prefix.
 * @calledby src/entities/Player.ts → getMaxGun1Ammo / getMaxGun2Ammo carry-cap derivation
 * @calls    iterates the purchased-upgrades set, prefix-matching ids; no delegation
 */
export function countUpgrades(type: UpgradeType): number {
  const prefix = `${type}@`;
  let count = 0;
  for (const id of purchasedUpgrades) {
    if (id.startsWith(prefix)) count += 1;
  }
  return count;
}

/**
 * @function    allBossesDefeated
 * @description True once every boss in the required roster has been recorded defeated this run — the all-bosses win gate (the run is actually won via the Level_13 portal warp; the boss roster only gates the key-heart door).
 * @returns true only when all required bosses are present in the set.
 * @calledby —
 * @calls    tests the defeated-boss set against every required boss identifier
 */
export function allBossesDefeated(): boolean {
  return REQUIRED_BOSS_IDENTIFIERS.every((id) => defeatedBosses.has(id));
}

/**
 * @function    resetRunProgress
 * @description Wipes all four progress sets so the next run starts fresh. NOT called on respawn or HMR by design — only on abandon, since death/respawn rebuilds must preserve keys/defeats to avoid soft-locks.
 * @calledby src/scenes/GameScene.ts → run reset on abandon (New Game / Quit / Return to Title)
 * @calls    clears each in-memory set; no further delegation
 */
export function resetRunProgress(): void {
  collectedKeys.clear();
  defeatedBosses.clear();
  openedChests.clear();
  purchasedUpgrades.clear();
}

import { REQUIRED_BOSS_IDENTIFIERS } from '../constants';

// Persistent per-run progress for the boss-key win condition.
//
// Lives at module scope (not on GameScene) so it survives the world rebuilds
// that death/respawn and HMR perform: GameScene.respawnFromSave() tears down and
// re-parses the LDtk project, which re-spawns every boss from scratch. Bosses
// opt out of the auto-respawn system (Enemy.isBoss), but a respawn-from-save
// rebuild revives them anyway — so the *fact* that the player already defeated a
// boss (and collected its key) must live somewhere the rebuild doesn't touch.
// Keeping it here means a player who grabs a key and then dies without saving
// still owns the key, so a key-locked door can never become permanently
// unopenable (which would soft-lock the run, since the boss is gone on the
// no-death timeline and only re-spawns on a death the player is trying to avoid).
//
// Reset explicitly by GameScene.restartRun() (New Game / Quit / Return to Title)
// so a fresh run starts with no progress. A brand-new boot starts clean because
// the sets initialize empty.

// The two boss keys, matching the PickupKind string literals in Player.ts. A
// door declares which one it needs via LOCKED_DOOR_KEYS (constants).
export type BossKeyId = 'key_storms' | 'key_widow';

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

export function recordKeyCollected(key: BossKeyId): void {
  collectedKeys.add(key);
}

export function hasKey(key: BossKeyId): boolean {
  return collectedKeys.has(key);
}

export function recordBossDefeated(identifier: string): void {
  defeatedBosses.add(identifier);
}

export function isBossDefeated(identifier: string): boolean {
  return defeatedBosses.has(identifier);
}

export function recordChestOpened(iid: string): void {
  openedChests.add(iid);
}

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

export function recordUpgradePurchased(id: string): void {
  purchasedUpgrades.add(id);
}

export function hasUpgrade(id: string): boolean {
  return purchasedUpgrades.has(id);
}

// How many upgrades of a line the player owns. Drives the derived cap: e.g.
// gun1 max = BASE_MAX_GUN1_AMMO + countUpgrades('ammo') * GUN1_CAPACITY_UPGRADE_STEP.
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

// Wipes all progress. Called when abandoning a run (New Game / Quit / Return to
// Title) so the next run starts fresh. Deliberately NOT called on respawn or HMR.
export function resetRunProgress(): void {
  collectedKeys.clear();
  defeatedBosses.clear();
  openedChests.clear();
  purchasedUpgrades.clear();
}

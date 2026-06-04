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
}

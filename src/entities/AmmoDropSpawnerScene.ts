import type { PickupKind } from './Player';

// Structural interface implemented by GameScene. Lets entity classes (Chest,
// Enemy) request a pickup drop without importing GameScene directly — same
// pattern as ProjectileSpawnerScene / NearestEnemyScene. Keeps the
// dependency one-directional and avoids import cycles.
export interface AmmoDropSpawnerScene {
  spawnAmmoDrop(kind: PickupKind, x: number, y: number): void;
}

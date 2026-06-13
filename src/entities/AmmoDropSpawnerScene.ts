import type { PickupKind } from './Player';

// Narrow scene interface so entities can request a pickup drop without importing the concrete scene.
export interface AmmoDropSpawnerScene {
  spawnAmmoDrop(kind: PickupKind, x: number, y: number): void;
}

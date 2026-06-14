import type { PickupKind } from './Player';

/**
 * @file entities/AmmoDropSpawnerScene.ts
 * @description Minimal scene interface so entities (chests, dying enemies) can request a pickup drop without importing the concrete GameScene — keeps the dependency one-way and avoids a cycle.
 * @module entities
 */

// Narrow scene interface so entities can request a pickup drop without importing the concrete scene.
export interface AmmoDropSpawnerScene {
  spawnAmmoDrop(kind: PickupKind, x: number, y: number): void;
}

import type { Enemy } from './Enemy';
import type { EnemyProjectileSpawnOptions } from './EnemyProjectile';

/**
 * enemyHelperScene — the read/spawn surface an Enemy needs from its scene.
 *
 * A structural interface so Enemy doesn't import GameScene directly (avoids an
 * Enemy <-> GameScene circular dependency); the gameplay scene implements every
 * member. Bundles the collision/nav probes, projectile and minion spawning, the
 * enemy-iteration callback, and the fight-wide stealth flag that the enemy AI
 * reaches back into the world for.
 *
 * Inputs:  the implementing scene supplies these capabilities; callers pass
 *          world coords, spawn options, identifiers, and visitor callbacks.
 * Outputs: spawns (projectiles/minions), collision/nav/level query results,
 *          and the boss-fight stealth flag.
 * @calledby the enemy AI, when it spawns, probes terrain, routes, scans peers,
 *           or checks whether stealth is suppressed during a boss fight.
 * @calls    the implementing scene, which owns the physics, nav graph, and
 *           enemy group these members read and mutate.
 */
export interface EnemyHelperScene {
  spawnEnemyProjectile(options: EnemyProjectileSpawnOptions): void;
  // Spawns a summon-attack minion at (x, y), drops it to the floor, and forces immediate pursuit; returns null if the identifier isn't a behavior entry.
  summonEnemyAt(identifier: string, x: number, y: number): Enemy | null;
  // True when the pixel segment intersects a solid tile (used to gate chase and ranged attacks).
  isLineBlocked(x1: number, y1: number, x2: number, y2: number): boolean;
  // True when a solid tile exists at the given world coords (enemy uses it to decide whether to jump).
  isTileSolidAt(x: number, y: number): boolean;
  // Raw IntGrid value at world coords (1=ground, 2=bridge, 0=empty); used to pick the right footstep loop.
  getIntGridValueAt(x: number, y: number): number;
  // A* route as world-px waypoints, or null when no route exists.
  findEnemyPath(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
  ): ReadonlyArray<{ x: number; y: number }> | null;
  // LDtk level rect containing (x, y), or null; arena bosses use this to clamp movement.
  getLevelBoundsAt(
    x: number,
    y: number,
  ): { worldX: number; worldY: number; pxWid: number; pxHei: number } | null;
  // Calls cb for every live enemy; callers throttle since it's O(enemy count).
  forEachEnemy(cb: (enemy: Enemy) => void): void;
  // True during any boss fight — stealth is fully disabled so the player can't sneak in an arena.
  isStealthDisabled(): boolean;
}

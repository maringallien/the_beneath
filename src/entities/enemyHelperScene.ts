import type { Enemy } from './Enemy';
import type { EnemyProjectileSpawnOptions } from './EnemyProjectile';

// Structural interface so Enemy doesn't need to import GameScene (avoids a
// circular dependency between Enemy ↔ GameScene). GameScene implements every
// member directly.
export interface EnemyHelperScene {
  spawnEnemyProjectile(options: EnemyProjectileSpawnOptions): void;
  // Spawns a summoned minion of `identifier` at (x, y), drops it onto the
  // floor beneath that point, wires it into the world as a normal enemy
  // (no respawn tracking), and forces it into immediate pursuit. Returns the
  // new Enemy, or null when the identifier doesn't resolve to a behavior-
  // bearing registry entry. Used by 'summon' attacks (e.g. the summoner).
  summonEnemyAt(identifier: string, x: number, y: number): Enemy | null;
  // True when the world-pixel segment from (x1,y1) to (x2,y2) intersects a
  // solid collision tile. Used to gate chase and ranged-attack initiation.
  isLineBlocked(x1: number, y1: number, x2: number, y2: number): boolean;
  // True iff a solid collision tile exists at the given world coords. Used
  // for obstacle detection: enemy chase samples a point just ahead/up to
  // decide whether to jump.
  isTileSolidAt(x: number, y: number): boolean;
  // Raw IntGrid value at the given world coords (1=ground, 2=bridge, 0=empty).
  // Used to gate surface-specific footstep loops during chase — mirrors the
  // probe Player.ts uses to switch between pebble and metal-stairs slots.
  getIntGridValueAt(x: number, y: number): number;
  // A* a grounded route over the nav graph from a start foot point to a goal foot
  // point, returned as world-px waypoints (node foot centers), or null when
  // there's no graph / no route / either endpoint can't snap to a node. The enemy
  // follows the waypoints with its existing hop/leap/mount locomotion; the caller
  // falls back to reactive steering on null.
  findEnemyPath(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
  ): ReadonlyArray<{ x: number; y: number }> | null;
  // World rect of the LDtk level containing (x, y), or null if the point sits
  // outside any level. Used by arena-bound bosses to snapshot their spawn
  // level on construction so movement/teleport can be clamped to the arena.
  getLevelBoundsAt(
    x: number,
    y: number,
  ): { worldX: number; worldY: number; pxWid: number; pxHei: number } | null;
  // Invokes `cb` once for every live enemy in the world (the scene's enemies
  // group), including the caller. Used by the wander greeting to find a nearby
  // same-group partner; callers do their own group/proximity/self filtering and
  // throttle the scan since this is O(enemy count).
  forEachEnemy(cb: (enemy: Enemy) => void): void;
  // True while a boss fight is active anywhere in the world. Stealth is
  // disabled entirely during boss fights — every enemy is always detectable
  // (the vision-cone / cover gate is bypassed and pursuit falls back to the
  // legacy always-on aggro), so the player can't sneak inside an arena. Cheaply
  // recomputed once per frame in GameScene.updateEnemies (one-frame latency,
  // which is fine for a fight-wide flag).
  isStealthDisabled(): boolean;
}

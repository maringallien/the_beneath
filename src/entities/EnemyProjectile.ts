import Phaser from 'phaser';
import { PROJECTILE_MAX_LIFETIME_MS } from '../constants';

/**
 * @file entities/EnemyProjectile.ts
 * @description Player-targeting projectile fired by ranged enemies. Symmetric with the player's Projectile (terrain/world-bounds collider into onImpact, lifetime cap, body disabled on impact to stop multi-hit ticks) but with two per-instance fields — damage and the entity-namespaced animation keys — so any ranged enemy type spawns one without a dedicated subclass. Invariant: once it explodes it is inert (body disabled, timers/listeners torn down) and self-destructs when the explode anim ends.
 * @module entities
 */
export interface EnemyProjectileSpawnOptions {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  // copied off the enemy at fire time so the projectile is self-contained if the enemy dies mid-flight
  damage: number;
  // full keys (already prefixed) so multiple enemy types can share this class with different art
  idleAnimKey: string;
  explodeAnimKey: string;
}

export class EnemyProjectile extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  private exploded = false;
  private lifetimeTimer: Phaser.Time.TimerEvent | null = null;
  private readonly damage: number;
  private readonly idleAnimKey: string;
  private readonly explodeAnimKey: string;
  private readonly worldBoundsHandler: (
    body: Phaser.Physics.Arcade.Body,
  ) => void;

  /**
   * @function    constructor
   * @description Spawns and launches the projectile along its velocity, rotates it to face travel, and wires the world-bounds collider, lifetime cap, and destroy cleanup; throws if the idle texture isn't loaded.
   * @param   scene    Owning Phaser scene.
   * @param   options  Position, velocity, damage, and full idle/explode anim keys.
   * @calledby src/scenes/GameScene.ts → spawnEnemyProjectile, when a ranged enemy looses a shot (via src/entities/Enemy.ts)
   * @calls    Arcade physics setup, the scene lifetime timer, and the world-bounds/destroy hooks
   */
  constructor(scene: Phaser.Scene, options: EnemyProjectileSpawnOptions) {
    if (!scene.textures.exists(options.idleAnimKey)) {
      throw new Error(
        `EnemyProjectile idle texture missing: "${options.idleAnimKey}". ` +
          'Did the entity registry validator miss this key, or is the texture not preloaded?',
      );
    }
    super(scene, options.x, options.y, options.idleAnimKey);
    this.damage = options.damage;
    this.idleAnimKey = options.idleAnimKey;
    this.explodeAnimKey = options.explodeAnimKey;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setAllowGravity(false);
    // bounce 0,0 halts it cleanly at the world edge; 4th arg enables the world-bounds event
    this.body.setCollideWorldBounds(true, 0, 0, true);

    this.body.setVelocity(options.velocityX, options.velocityY);
    const angle = Math.atan2(options.velocityY, options.velocityX);
    this.setRotation(angle);
    // mirror Y in the left half-plane so the sprite never renders upside-down
    this.setFlipY(Math.abs(angle) > Math.PI / 2);

    this.play(this.idleAnimKey);

    this.lifetimeTimer = scene.time.delayedCall(
      PROJECTILE_MAX_LIFETIME_MS,
      () => this.onImpact(),
    );

    this.worldBoundsHandler = (body) => {
      if (body !== this.body) return;
      this.onImpact();
    };
    scene.physics.world.on(
      Phaser.Physics.Arcade.Events.WORLD_BOUNDS,
      this.worldBoundsHandler,
    );

    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.physics.world.off(
        Phaser.Physics.Arcade.Events.WORLD_BOUNDS,
        this.worldBoundsHandler,
      );
      if (this.lifetimeTimer) {
        this.lifetimeTimer.remove(false);
        this.lifetimeTimer = null;
      }
    });
  }

  /** Per-shot damage to apply to the player on overlap. */
  getDamage(): number {
    return this.damage;
  }

  /** True once it has impacted (and is being torn down) — overlap checks skip it. */
  hasExploded(): boolean {
    return this.exploded;
  }

  /**
   * @function    onImpact
   * @description Detonates exactly once: clears the lifetime timer, halts and disables the body so no damage ticks stack during the explode clip, then plays the explode clip and self-destroys on completion.
   * @calledby Phaser physics overlap on the player or terrain (registered in world build), a world-bounds hit, or the lifetime cap
   * @calls    the Arcade body, then tears the projectile down
   */
  onImpact(): void {
    if (this.exploded) return;
    this.exploded = true;

    if (this.lifetimeTimer) {
      this.lifetimeTimer.remove(false);
      this.lifetimeTimer = null;
    }

    this.setVelocity(0, 0);
    this.body.enable = false;

    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.destroy();
    });
    this.play(this.explodeAnimKey);
  }
}

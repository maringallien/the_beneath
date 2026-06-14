import Phaser from 'phaser';
import { PROJECTILE_MAX_LIFETIME_MS } from '../constants';
import {
  projectileAnimKey,
  type GunslingerProjectileMode,
} from '../sprites/characterLoader';

/**
 * @file entities/Projectile.ts
 * @description Gun-fired Arcade projectile (gravity off) that flies along its launch velocity, rotates to face it (mirrored Y in the left half-plane so it never renders upside-down), and detonates exactly once — on the first overlap-driven impact, a world-bounds hit, or a lifetime-timeout fallback. The single-detonation guard plus disabling the body on impact is load-bearing: it stops the body re-overlapping its target every frame of the explode clip (which would stack damage and one-shot any enemy). Tidies its world-bounds listener and lifetime timer on destroy.
 * @module entities
 */
export interface ProjectileSpawnOptions {
  x: number;
  y: number;
  mode: GunslingerProjectileMode;
  velocityX: number;
  velocityY: number;
  damage: number;
}

export class Projectile extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  private exploded = false;
  private lifetimeTimer: Phaser.Time.TimerEvent | null = null;
  private readonly mode: GunslingerProjectileMode;
  private readonly damage: number;
  private readonly worldBoundsHandler: (
    body: Phaser.Physics.Arcade.Body,
  ) => void;

  /**
   * @function    constructor
   * @description Spawns and launches the projectile along its velocity, rotates it to face travel, and wires the world-bounds collider, lifetime cap, and destroy cleanup; throws if the idle texture isn't loaded.
   * @param   scene    Owning Phaser scene.
   * @param   options  Position, gun mode, velocity, and damage.
   * @calledby src/scenes/GameScene.ts → spawnProjectile, when the player's gun looses a shot
   * @calls    src/sprites/characterLoader.ts → projectileAnimKey, Arcade physics setup, the scene lifetime timer, and the world-bounds/destroy hooks
   */
  constructor(scene: Phaser.Scene, options: ProjectileSpawnOptions) {
    const idleKey = projectileAnimKey(options.mode, 'idle');
    if (!scene.textures.exists(idleKey)) {
      throw new Error(
        `Projectile idle texture missing: "${idleKey}". ` +
          'Did PreloadScene register projectile animations?',
      );
    }
    super(scene, options.x, options.y, idleKey);
    this.mode = options.mode;
    this.damage = options.damage;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setAllowGravity(false);
    // bounce 0,0 halts it cleanly at a wall; 4th arg enables the world-bounds event
    this.body.setCollideWorldBounds(true, 0, 0, true);

    this.body.setVelocity(options.velocityX, options.velocityY);
    // mirror Y in the left half-plane so the sprite never renders upside-down
    const angle = Math.atan2(options.velocityY, options.velocityX);
    this.setRotation(angle);
    this.setFlipY(Math.abs(angle) > Math.PI / 2);

    this.play(idleKey);

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

  /** True once the projectile has detonated (overlap callers gate on this). */
  hasExploded(): boolean {
    return this.exploded;
  }

  /** Damage this projectile deals on a hit (set at spawn, per gun mode). */
  getDamage(): number {
    return this.damage;
  }

  /**
   * @function    onImpact
   * @description Detonates exactly once: clears the lifetime timer, halts and disables the body immediately so no damage ticks stack during the explode clip, then plays the explode clip and self-destroys on its completion.
   * @calledby Phaser physics overlap on an enemy (registered in world build), a world-bounds hit, or the lifetime cap
   * @calls    src/sprites/characterLoader.ts → projectileAnimKey and the Arcade body, then tears itself down
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

    const explodeKey = projectileAnimKey(this.mode, 'explode');
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.destroy();
    });
    this.play(explodeKey);
  }
}

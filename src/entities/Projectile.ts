import Phaser from 'phaser';
import { PROJECTILE_MAX_LIFETIME_MS } from '../constants';
import {
  projectileAnimKey,
  type GunslingerProjectileMode,
} from '../sprites/characterLoader';

/**
 * Projectile — a gun-fired bullet/energy shot sprite with one-shot impact.
 *
 * An Arcade sprite (gravity off) that flies along its launch velocity, rotates
 * to face it (mirrored Y in the left half-plane so it never renders upside-down),
 * and detonates exactly once — on the first overlap-driven impact, a world-bounds
 * hit, or a lifetime-timeout fallback. The single-detonation guard plus disabling
 * the body on impact is load-bearing: it stops the body re-overlapping its target
 * for every frame of the explode clip (which would stack damage and one-shot any
 * enemy). Tidies its world-bounds listener and lifetime timer on destroy.
 *
 * Inputs:  scene + spawn options (position, mode, velocity, damage); registry-
 *          loaded projectile animations; physics overlap/world-bounds events.
 * Outputs: a moving sprite that deals `damage` on overlap, plays its explode clip,
 *          and self-destroys.
 * @calledby the player's gun-firing code, when a shot is loosed.
 * @calls    the projectile animation-key helper, Arcade physics (velocity, world-
 *           bounds), and the scene timer for the lifetime cap.
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

  // spawns and launches the projectile; throws if the idle texture isn't loaded
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

  // True once the projectile has detonated (overlap callers gate on this).
  hasExploded(): boolean {
    return this.exploded;
  }

  // Damage this projectile deals on a hit (set at spawn, per gun mode).
  getDamage(): number {
    return this.damage;
  }

  // detonates once; disables the body immediately so no damage ticks stack during the explode clip
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

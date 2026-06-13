import Phaser from 'phaser';
import { PROJECTILE_MAX_LIFETIME_MS } from '../constants';

/**
 * EnemyProjectile — the player-targeting projectile any ranged enemy fires.
 *
 * Symmetric with the player's Projectile (terrain/world-bounds collider →
 * onImpact, lifetime cap, body disabled on impact to stop multi-hit ticks) but
 * with two per-instance fields — damage and the entity-namespaced animation
 * keys — so any ranged enemy type spawns one without a dedicated subclass. The
 * invariant the reader must hold: once it explodes it is inert (body disabled,
 * timers/listeners torn down) and self-destructs when the explode anim ends.
 *
 * Inputs:  scene, a spawn-options bundle (position, velocity, damage, the full
 *          idle/explode anim keys); world-bounds and lifetime-timer events.
 * Outputs: a moving sprite that overlaps the player for `damage`, plays its
 *          explode anim on impact, and destroys itself.
 * @calledby a ranged enemy's attack, when it looses a shot at the player.
 * @calls    Phaser physics/animation/timer systems and the scene's world-bounds
 *           event bus.
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

  // spawns and launches the projectile; throws if the idle texture isn't loaded
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

  // Per-shot damage to apply to the player on overlap.
  getDamage(): number {
    return this.damage;
  }

  // True once it has impacted (and is being torn down) — overlap checks skip it.
  hasExploded(): boolean {
    return this.exploded;
  }

  // detonates once; disables the body so no damage ticks stack during the explode clip
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

import Phaser from 'phaser';
import { PROJECTILE_MAX_LIFETIME_MS } from '../constants';
import {
  projectileAnimKey,
  type GunslingerProjectileMode,
} from '../sprites/characterLoader';

export type ProjectileDirection = 1 | -1;

export interface ProjectileSpawnOptions {
  x: number;
  y: number;
  mode: GunslingerProjectileMode;
  direction: ProjectileDirection;
  speed: number;
}

export class Projectile extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  private exploded = false;
  private lifetimeTimer: Phaser.Time.TimerEvent | null = null;
  private readonly mode: GunslingerProjectileMode;
  private readonly worldBoundsHandler: (
    body: Phaser.Physics.Arcade.Body,
  ) => void;

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

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setAllowGravity(false);
    // Bounce 0,0 so worldbounds collision halts the projectile cleanly
    // before our handler swaps to the explode animation. The 4th arg enables
    // the worldbounds event for this body.
    this.body.setCollideWorldBounds(true, 0, 0, true);
    this.setFlipX(options.direction === -1);
    this.setVelocityX(options.speed * options.direction);

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

  onImpact(): void {
    if (this.exploded) return;
    this.exploded = true;

    if (this.lifetimeTimer) {
      this.lifetimeTimer.remove(false);
      this.lifetimeTimer = null;
    }

    this.setVelocity(0, 0);

    const explodeKey = projectileAnimKey(this.mode, 'explode');
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.destroy();
    });
    this.play(explodeKey);
  }
}

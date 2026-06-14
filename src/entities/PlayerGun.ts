import Phaser from 'phaser';
import {
  ENTITY_DEPTH,
  GUN_OVERLAY_GRIP_ORIGIN_X,
  GUN_OVERLAY_PIVOT_OFFSET_X,
  GUN_OVERLAY_PIVOT_OFFSET_Y,
} from '../constants';
import {
  type GunslingerProjectileMode,
  gunOverlayAnimKey,
  getSpriteAnchor,
} from '../sprites/characterLoader';

/**
 * @file entities/PlayerGun.ts
 * @description Purely visual gun overlay sprite for gunslinger modes (no physics body). The owning Player drives its position/rotation every frame and toggles its visibility (shown over no_gun body art, hidden over baked-gun art). Owns the grip-pivot convention — rotation pivots on the gun's grip pixel, not its center, and the sprite mirrors vertically in the left aim half-plane so the trigger always points down. Renders one depth above the player body.
 * @module entities
 */
export class PlayerGun extends Phaser.GameObjects.Sprite {
  private gunMode: GunslingerProjectileMode;

  /**
   * @function    constructor
   * @description Build the overlay sprite for a gunslinger mode, setting the grip-pixel pivot and the above-body depth; throws if the idle texture is missing.
   * @param   scene  Owning Phaser scene.
   * @param   x, y   Spawn position (world px).
   * @param   mode   Which gun spritesheet to render.
   * @calledby src/entities/Player.ts → ensurePlayerGunForMode, when the player first enters a gunslinger mode
   * @calls    the gun-overlay anim-key builder and the Phaser add/play setup
   */
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    mode: GunslingerProjectileMode,
  ) {
    const idleKey = gunOverlayAnimKey(mode, 'idle');
    if (!scene.textures.exists(idleKey)) {
      throw new Error(
        `Gun overlay texture missing: "${idleKey}". ` +
          'Did PreloadScene register all character animations?',
      );
    }
    super(scene, x, y, idleKey);
    this.gunMode = mode;

    scene.add.existing(this);
    // pivot on the grip pixel so cursor-tracking rotation looks right
    this.setOrigin(GUN_OVERLAY_GRIP_ORIGIN_X, 0.5);
    this.setDepth(ENTITY_DEPTH + 1);
    this.on(
      Phaser.Animations.Events.ANIMATION_START,
      this.applyOverlayScale,
      this,
    );
    this.play(idleKey);
  }

  /**
   * @function    applyOverlayScale
   * @description Apply the per-anim display scale resolved from the anchor data.
   * @param   animation  The anim that just started.
   * @calledby Phaser ANIMATION_START event (registered in the constructor)
   * @calls    the per-anim sprite-anchor resolver
   */
  private applyOverlayScale(animation: Phaser.Animations.Animation): void {
    const { displayScale } = getSpriteAnchor(animation.key, 0, 0);
    this.setScale(displayScale);
  }

  /** The gunslinger mode (which spritesheet) this overlay is currently rendering. */
  getMode(): GunslingerProjectileMode {
    return this.gunMode;
  }

  /**
   * @function    setMode
   * @description Swap to a different gun spritesheet; replays attack1 on the new sheet if the overlay was mid-fire on the old one, else idles. No-op if already in that mode.
   * @param   mode  The gun spritesheet to switch to.
   * @calledby src/entities/Player.ts → ensurePlayerGunForMode, when the equipped gun changes
   * @calls    the gun-overlay anim-key builder and src/entities/PlayerGun.ts → playOverlay
   */
  setMode(mode: GunslingerProjectileMode): void {
    if (mode === this.gunMode) return;
    this.gunMode = mode;
    const currentKey = this.anims.currentAnim?.key;
    const wasFiring =
      currentKey === gunOverlayAnimKey(
        mode === 'gunslinger_gun1' ? 'gunslinger_gun2' : 'gunslinger_gun1',
        'attack1',
      );
    this.playOverlay(wasFiring ? 'attack1' : 'idle');
  }

  /**
   * @function    playOverlay
   * @description Play idle (ignoreIfPlaying) or attack1 (always restart); an optional durationMs overrides the stored anim length so the fire clip matches the player's fire cadence.
   * @param   kind        'idle' or 'attack1'.
   * @param   durationMs  Optional play-duration override (ms).
   * @calledby src/entities/Player.ts → startAttackAnim / endLockedAction / syncGunOverlayForBodyAnim, and src/entities/PlayerGun.ts → setMode
   * @calls    the gun-overlay anim-key builder and the Phaser sprite animation play
   */
  playOverlay(kind: 'idle' | 'attack1', durationMs?: number): void {
    const key = gunOverlayAnimKey(this.gunMode, kind);
    if (durationMs !== undefined) {
      // frameRate: null forces Phaser to honor `duration` rather than falling back to the stored rate
      const playArgs = {
        key,
        duration: durationMs,
        frameRate: null,
      } as unknown as Phaser.Types.Animations.PlayAnimationConfig;
      this.play(playArgs, kind === 'idle');
    } else {
      this.play(key, kind === 'idle');
    }
  }

  /**
   * @function    syncToOwner
   * @description Snap the overlay to the player's grip pivot and rotate it to aim at the cursor, mirroring vertically when aiming left so the trigger always points toward the ground.
   * @param   ownerX, ownerY              Player world position.
   * @param   ownerFlipX                  Player facing (true = facing left).
   * @param   ownerScale                  Player display scale, applied to the pivot offset.
   * @param   cursorWorldX, cursorWorldY  Aim target in world space.
   * @calledby src/entities/Player.ts → syncPlayerGun, each frame while a gun overlay is shown
   * @calls    Math.atan2 and the sprite position/flip/rotation setters only
   */
  syncToOwner(
    ownerX: number,
    ownerY: number,
    ownerFlipX: boolean,
    ownerScale: number,
    cursorWorldX: number,
    cursorWorldY: number,
  ): void {
    const pivotSign = ownerFlipX ? -1 : 1;
    const pivotX = ownerX + GUN_OVERLAY_PIVOT_OFFSET_X * pivotSign * ownerScale;
    const pivotY = ownerY + GUN_OVERLAY_PIVOT_OFFSET_Y * ownerScale;
    this.setPosition(pivotX, pivotY);

    const dx = cursorWorldX - pivotX;
    const dy = cursorWorldY - pivotY;
    const angle = Math.atan2(dy, dx);
    // mirror vertically when aiming left so the trigger always points toward the ground
    const flipY = Math.abs(angle) > Math.PI / 2;
    this.setFlipY(flipY);
    this.setRotation(angle);
  }
}

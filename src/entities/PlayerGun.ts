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
 * PlayerGun — the gun overlay sprite layered on the player body in gunslinger modes.
 *
 * Purely visual: no physics body. The owning Player drives its position and
 * rotation every frame and toggles its visibility (shown when the body plays a
 * no_gun animation, hidden when the body plays a baked-gun animation). It owns
 * the grip-pivot convention — rotation pivots on the gun's grip pixel, not its
 * center, and the sprite mirrors vertically in the left aim half-plane so the
 * trigger always points down. Renders one depth above the player body.
 *
 * Inputs:  scene, spawn x/y, the gunslinger mode (which spritesheet); per-frame
 *          owner position/facing/scale and the cursor world position.
 * Outputs: a rotated, depth-sorted overlay sprite tracking the player's hand.
 * @calledby the player entity, when it enters a gunslinger mode and each frame after.
 * @calls    the gun-overlay anim-key builder and the per-anim sprite-anchor resolver.
 */
export class PlayerGun extends Phaser.GameObjects.Sprite {
  private gunMode: GunslingerProjectileMode;

  // build the overlay sprite for a gunslinger mode; throws if the idle texture is missing
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

  // apply the per-anim display scale on each ANIMATION_START
  private applyOverlayScale(animation: Phaser.Animations.Animation): void {
    const { displayScale } = getSpriteAnchor(animation.key, 0, 0);
    this.setScale(displayScale);
  }

  // The gunslinger mode (which spritesheet) this overlay is currently rendering.
  getMode(): GunslingerProjectileMode {
    return this.gunMode;
  }

  // swap to a different gun spritesheet; if mid-fire, replays attack1 on the new sheet
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

  // play idle (ignoreIfPlaying) or attack1 (always restart); durationMs overrides the anim length
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

  // snap the overlay to the player's grip and rotate it to aim at the cursor
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

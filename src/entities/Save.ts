import Phaser from 'phaser';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';

const SAVE_IDENTIFIER = 'Save_spawn';
const SAVE_ANIM_START_UP = 'start_up';
const SAVE_ANIM_IDLE = 'idle';
const SAVE_ANIM_DOWN = 'down';

// How long the looping idle plays between the one-shot start_up and down
// animations. The full cycle is start_up → idle (this long) → down → repeat.
const SAVE_IDLE_HOLD_MS = 2500;

// Save crystal driven by a three-phase cycle: start_up (one-shot) → idle
// (looping for SAVE_IDLE_HOLD_MS) → down (one-shot) → repeat. The registry
// flags start_up and down as loops:false so ANIMATION_COMPLETE fires at the
// end of each clip and drives the state transitions; idle keeps loops:true
// so it plays continuously until the hold timer schedules the down phase.
export class Save extends AnimatedEntity {
  private readonly startUpFullKey: string;
  private readonly downFullKey: string;
  private idleHoldTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, SAVE_IDENTIFIER);
    this.startUpFullKey = entityAnimFullKey(SAVE_IDENTIFIER, SAVE_ANIM_START_UP);
    this.downFullKey = entityAnimFullKey(SAVE_IDENTIFIER, SAVE_ANIM_DOWN);

    this.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.onAnimComplete,
      this,
    );
    this.once(Phaser.GameObjects.Events.DESTROY, this.cancelIdleHoldTimer, this);

    // AnimatedEntity's constructor kicked off the default ('idle') with a
    // random phase offset. Override that immediately so each spawn reliably
    // starts at frame 0 of start_up.
    this.playLogical(SAVE_ANIM_START_UP);
  }

  private onAnimComplete(animation: Phaser.Animations.Animation): void {
    if (animation.key === this.startUpFullKey) {
      this.playLogical(SAVE_ANIM_IDLE);
      this.cancelIdleHoldTimer();
      this.idleHoldTimer = this.scene.time.delayedCall(
        SAVE_IDLE_HOLD_MS,
        this.onIdleHoldExpired,
        undefined,
        this,
      );
    } else if (animation.key === this.downFullKey) {
      this.playLogical(SAVE_ANIM_START_UP);
    }
  }

  private onIdleHoldExpired(): void {
    this.idleHoldTimer = null;
    this.playLogical(SAVE_ANIM_DOWN);
  }

  private cancelIdleHoldTimer(): void {
    if (this.idleHoldTimer) {
      this.idleHoldTimer.remove(false);
      this.idleHoldTimer = null;
    }
  }
}

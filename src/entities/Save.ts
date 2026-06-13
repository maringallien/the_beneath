import Phaser from 'phaser';
import { INTERACTION_RANGE_SQ, SAVE_REQUESTED_EVENT } from '../constants';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';
import type { Interactable } from './Interactable';

const SAVE_IDENTIFIER = 'Save_spawn';
const SAVE_ANIM_START_UP = 'start_up';
const SAVE_ANIM_IDLE = 'idle';
const SAVE_ANIM_DOWN = 'down';

// how long the idle loop plays between start_up and down in the animation cycle
const SAVE_IDLE_HOLD_MS = 2500;

// gap so the icon floats just above the silhouette (matches chest/door convention)
const ICON_ANCHOR_GAP_PX = 2;

/**
 * Save — the interactable save crystal.
 *
 * Runs a self-perpetuating three-phase animation cycle: start_up (one-shot) →
 * idle (looping for SAVE_IDLE_HOLD_MS) → down (one-shot) → repeat. The registry
 * marks start_up and down loops:false so ANIMATION_COMPLETE fires at each clip's
 * end and drives the transitions, while idle loops until the hold timer schedules
 * the down phase. Implements Interactable so the interaction manager handles
 * hold-E commit, proximity, and icon rendering. Unlike Chest, a crystal is
 * reusable — canInteract() is always true, so the player may re-save freely; the
 * actual snapshot work lives in the scene, reached via the emitted event.
 *
 * Inputs:  scene + spawn x/y; registry-driven animation clips; the interaction
 *          manager polls the contract methods.
 * Outputs: drives its own animation cycle and emits SAVE_REQUESTED_EVENT (with
 *          itself as payload) on the scene event bus.
 * @calledby the gameplay scene — spawned at level load and driven by the
 *           hold-to-interact system when the player is in range.
 * @calls    the entity animation helper and the scene event bus (save request).
 */
export class Save extends AnimatedEntity implements Interactable {
  private readonly startUpFullKey: string;
  private readonly downFullKey: string;
  private idleHoldTimer: Phaser.Time.TimerEvent | null = null;

  // overrides the base random-phase idle so every spawn begins at frame 0 of start_up
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

    this.playLogical(SAVE_ANIM_START_UP);
  }

  // Where the hold-E prompt icon floats: centered just above the crystal's top.
  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.body.top - ICON_ANCHOR_GAP_PX };
  }

  // Squared player-distance within which the E prompt is offered.
  getInteractionRangeSq(): number {
    return INTERACTION_RANGE_SQ;
  }

  // crystals are never consumed; the player can re-save against the same one freely
  canInteract(): boolean {
    return true;
  }

  // emits the save request with itself as payload so the scene can anchor the toast here
  onInteract(): void {
    this.scene.events.emit(SAVE_REQUESTED_EVENT, this);
  }

  // drives the start_up → idle (timed) → down → start_up cycle on each one-shot completion
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

  // Idle hold elapsed: clear the timer handle and play the one-shot down clip,
  // which on completion loops the cycle back to start_up.
  private onIdleHoldExpired(): void {
    this.idleHoldTimer = null;
    this.playLogical(SAVE_ANIM_DOWN);
  }

  // Cancels any pending idle-hold timer (on destroy or before re-arming).
  private cancelIdleHoldTimer(): void {
    if (this.idleHoldTimer) {
      this.idleHoldTimer.remove(false);
      this.idleHoldTimer = null;
    }
  }
}

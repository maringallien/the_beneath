import Phaser from 'phaser';
import { INTERACTION_RANGE_SQ, SAVE_REQUESTED_EVENT } from '../constants';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';
import type { Interactable } from './Interactable';

/**
 * @file entities/Save.ts
 * @description Interactable save crystal running a self-perpetuating three-phase cycle: start_up (one-shot) → idle (looping for SAVE_IDLE_HOLD_MS) → down (one-shot) → repeat. The registry marks start_up/down loops:false so ANIMATION_COMPLETE fires at each clip's end and drives the transitions, while idle loops until the hold timer schedules the down phase. Implements Interactable so the interaction manager handles hold-E commit, proximity, and icon rendering. Unlike Chest, a crystal is reusable — canInteract() is always true; the actual snapshot work lives in the scene, reached via the emitted event.
 * @module entities
 */

const SAVE_IDENTIFIER = 'Save_spawn';
const SAVE_ANIM_START_UP = 'start_up';
const SAVE_ANIM_IDLE = 'idle';
const SAVE_ANIM_DOWN = 'down';

// how long the idle loop plays between start_up and down in the animation cycle
const SAVE_IDLE_HOLD_MS = 2500;

// gap so the icon floats just above the silhouette (matches chest/door convention)
const ICON_ANCHOR_GAP_PX = 2;

export class Save extends AnimatedEntity implements Interactable {
  private readonly startUpFullKey: string;
  private readonly downFullKey: string;
  private idleHoldTimer: Phaser.Time.TimerEvent | null = null;

  /**
   * @function    constructor
   * @description Builds the crystal, overriding the base random-phase idle so every spawn begins at frame 0 of start_up, and wires the anim-complete cycle plus an idle-timer cleanup on destroy.
   * @param   scene  Owning Phaser scene.
   * @param   x, y   Spawn position (world px).
   * @calledby src/entities/EntityFactory.ts → spawning each crystal at level load
   * @calls    the AnimatedEntity base setup, src/entities/entityRegistryLoader.ts → entityAnimFullKey, the Phaser animation/destroy hooks, and playLogical
   */
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

  /** Where the hold-E prompt icon floats: centered just above the crystal's top. */
  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.body.top - ICON_ANCHOR_GAP_PX };
  }

  /** Squared player-distance within which the E prompt is offered. */
  getInteractionRangeSq(): number {
    return INTERACTION_RANGE_SQ;
  }

  /** Crystals are never consumed; the player can re-save against the same one freely. */
  canInteract(): boolean {
    return true;
  }

  /**
   * @function    onInteract
   * @description Emits the save request with itself as payload so the scene can anchor the save toast at the crystal.
   * @calledby src/entities/InteractionManager.ts → when the player completes a hold
   * @calls    the scene event bus (SAVE_REQUESTED_EVENT)
   */
  onInteract(): void {
    this.scene.events.emit(SAVE_REQUESTED_EVENT, this);
  }

  /**
   * @function    onAnimComplete
   * @description Drives the start_up → idle (timed) → down → start_up cycle on each one-shot completion: start_up schedules the down phase after the idle hold, down loops back to start_up.
   * @param   animation  The one-shot clip that just completed.
   * @calledby Phaser ANIMATION_COMPLETE event (registered in the constructor) on the start_up and down clips
   * @calls    playLogical and the scene's delayed-call timer
   */
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

  /**
   * @function    onIdleHoldExpired
   * @description Idle hold elapsed: clear the timer handle and play the one-shot down clip, which on completion loops the cycle back to start_up.
   * @calledby the idle-hold delayed-call timer, after SAVE_IDLE_HOLD_MS
   * @calls    playLogical
   */
  private onIdleHoldExpired(): void {
    this.idleHoldTimer = null;
    this.playLogical(SAVE_ANIM_DOWN);
  }

  /** Cancels any pending idle-hold timer (on destroy or before re-arming). */
  private cancelIdleHoldTimer(): void {
    if (this.idleHoldTimer) {
      this.idleHoldTimer.remove(false);
      this.idleHoldTimer = null;
    }
  }
}

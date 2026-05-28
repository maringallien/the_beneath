import Phaser from 'phaser';
import { INTERACTION_RANGE_SQ, SAVE_REQUESTED_EVENT } from '../constants';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';
import type { Interactable } from './Interactable';

const SAVE_IDENTIFIER = 'Save_spawn';
const SAVE_ANIM_START_UP = 'start_up';
const SAVE_ANIM_IDLE = 'idle';
const SAVE_ANIM_DOWN = 'down';

// How long the looping idle plays between the one-shot start_up and down
// animations. The full cycle is start_up → idle (this long) → down → repeat.
const SAVE_IDLE_HOLD_MS = 2500;

// Source-px gap between the crystal's body.top and the E icon anchor point.
// Matches the chest's gap so the icon hovers a touch above the silhouette
// rather than flush against it.
const ICON_ANCHOR_GAP_PX = 2;

// Save crystal driven by a three-phase cycle: start_up (one-shot) → idle
// (looping for SAVE_IDLE_HOLD_MS) → down (one-shot) → repeat. The registry
// flags start_up and down as loops:false so ANIMATION_COMPLETE fires at the
// end of each clip and drives the state transitions; idle keeps loops:true
// so it plays continuously until the hold timer schedules the down phase.
//
// Implements Interactable so the existing InteractionManager handles the
// hold-E commit, proximity detection, and icon rendering. Unlike Chest, a
// save crystal is reusable — canInteract() always returns true so the
// player can re-save freely. The actual snapshot work lives in GameScene,
// triggered by the SAVE_REQUESTED_EVENT this entity emits on commit.
export class Save extends AnimatedEntity implements Interactable {
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

  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.body.top - ICON_ANCHOR_GAP_PX };
  }

  getInteractionRangeSq(): number {
    return INTERACTION_RANGE_SQ;
  }

  // Save crystals never become "consumed" — the player can re-save against
  // the same crystal repeatedly, overwriting the slot each time.
  canInteract(): boolean {
    return true;
  }

  // Emit on the scene's event bus so GameScene can run its snapshot logic
  // without Save needing to import the scene. The Save instance is passed
  // as the payload so the scene can anchor the "Game Saved" toast above
  // this specific crystal.
  onInteract(): void {
    this.scene.events.emit(SAVE_REQUESTED_EVENT, this);
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

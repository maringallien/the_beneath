import Phaser from 'phaser';
import {
  PORTAL_INTERACTION_RANGE_SQ,
  PORTAL_WARP_COMPLETE_EVENT,
  PORTAL_WARP_STARTED_EVENT,
  PORTAL_WARP_VANISH_EVENT,
  PORTAL_WARP_VANISH_FRAME,
} from '../constants';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';
import type { Interactable } from './Interactable';

/**
 * @file entities/Portal.ts
 * @description Victory-exit portal (hold-E interactable): idles on AnimatedEntity's default loop until the player completes a hold-E, then plays the one-shot warp clip and emits three scene-bus signals (warp started, mid-warp vanish frame, warp complete); the scene owns the cutscene concerns (player-freeze, body-hide, victory launch) driven off those signals, mirroring how Save and the merchants are wired.
 * @module entities
 */

// gap between body.top and the E-icon anchor, matching chest/save/door convention
const ICON_ANCHOR_GAP_PX = 2;

const PORTAL_IDENTIFIER = 'Portal_spawn';
const PORTAL_ANIM_WARP = 'warp';

export class Portal extends AnimatedEntity implements Interactable {
  // latched on interact so the warp plays exactly once and canInteract() flips false
  private warping = false;
  // guards the vanish signal so it fires only once per warp
  private vanishEmitted = false;

  /**
   * @function    constructor
   * @description Build the portal and register the per-frame vanish check and the completion win-signal on the warp animation.
   * @param   scene  Owning Phaser scene.
   * @param   x, y   Spawn position (world px).
   * @calledby src/entities/EntityFactory.ts → portal spawning at level load
   * @calls    the AnimatedEntity base setup and the Phaser animation hooks
   */
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, PORTAL_IDENTIFIER);
    this.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      this.onAnimUpdate,
      this,
    );
    this.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.onAnimComplete,
      this,
    );
  }

  /** Where the hold-E prompt floats: centred just above the portal's top edge. */
  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.body.top - ICON_ANCHOR_GAP_PX };
  }

  /** Squared player-distance within which the E prompt is offered. */
  getInteractionRangeSq(): number {
    return PORTAL_INTERACTION_RANGE_SQ;
  }

  /** The portal stops advertising the prompt once a warp has been committed. */
  canInteract(): boolean {
    return !this.warping;
  }

  /**
   * @function    onInteract
   * @description Latch the warp so it plays exactly once, signal the scene to begin the victory cutscene, and start the one-shot warp clip; no-op if a warp is already underway.
   * @calledby src/entities/InteractionManager.ts → update, when the player completes a hold-E
   * @calls    the scene event bus (PORTAL_WARP_STARTED_EVENT) and src/entities/AnimatedEntity.ts → playLogical
   */
  onInteract(): void {
    if (this.warping) return;
    this.warping = true;
    this.scene.events.emit(PORTAL_WARP_STARTED_EVENT);
    this.playLogical(PORTAL_ANIM_WARP);
  }

  /**
   * @function    onAnimUpdate
   * @description Fire the vanish event once when the warp clip reaches the vanish frame (>=, not ===, so a skipped frame still triggers it); ignores non-warp animations.
   * @param   animation  The playing animation.
   * @param   frame      Its current frame.
   * @calledby Phaser ANIMATION_UPDATE event (registered in the constructor)
   * @calls    src/entities/entityRegistryLoader.ts → entityAnimFullKey and the scene event bus (PORTAL_WARP_VANISH_EVENT)
   */
  private onAnimUpdate(
    animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void {
    if (
      animation.key !== entityAnimFullKey(PORTAL_IDENTIFIER, PORTAL_ANIM_WARP)
    ) {
      return;
    }
    if (this.vanishEmitted) return;
    if (frame.index < PORTAL_WARP_VANISH_FRAME) return;
    this.vanishEmitted = true;
    this.scene.events.emit(PORTAL_WARP_VANISH_EVENT);
  }

  /**
   * @function    onAnimComplete
   * @description Emit the win event when the warp clip finishes; the idle loop never completes, so only the warp ever reaches here.
   * @param   animation  The animation that just completed.
   * @calledby Phaser ANIMATION_COMPLETE event (registered in the constructor)
   * @calls    src/entities/entityRegistryLoader.ts → entityAnimFullKey and the scene event bus (PORTAL_WARP_COMPLETE_EVENT)
   */
  private onAnimComplete(animation: Phaser.Animations.Animation): void {
    if (
      animation.key !== entityAnimFullKey(PORTAL_IDENTIFIER, PORTAL_ANIM_WARP)
    ) {
      return;
    }
    this.scene.events.emit(PORTAL_WARP_COMPLETE_EVENT);
  }
}
